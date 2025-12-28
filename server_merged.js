const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const express = require('express');
const axios = require('axios');
const morgan = require('morgan');
const { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand } = require('@aws-sdk/client-s3');

const config = require('./config-loader');
const { getAirlineDatabase, getAircraftTypesDatabase } = require('./lib/databases');
const { registration_from_hexid, initialize: initializeRegistrationDB } = require('./lib/registration');
const { setupApiRoutes } = require('./lib/api-routes');
const { computeAirlineStatsData, computeSquawkTransitionsData, computeHistoricalStatsData, remakeHourlyRollup } = require('./lib/aggregators');
const logger = require('./lib/logger');
const { listS3Files, downloadAndParseS3File } = require('./lib/s3-helpers');
const PositionCache = require('./lib/position-cache');
const aircraftDB = require('./lib/aircraft-database');
const aircraftTypesDB = require('./lib/aircraft-types-db');
const trackCache = require('./track-cache-service');

function deriveReceiverIdFromUrl(url) {
    if (!url) {
        return 'server';
    }

    try {
        const parsed = new URL(url);
        const host = parsed.hostname;
        if (!host) {
            return 'server';
        }

        const defaultPort = parsed.protocol === 'https:' ? '443' : '80';
        const port = parsed.port || defaultPort;
        const sanitizedHost = host.replace(/[.:]/g, '_');
        return `${sanitizedHost}_${port}`;
    } catch (err) {
        logger.warn(`[Server] Unable to derive receiver_id from ${url}: ${err.message}`);
        return 'server';
    }
}

const app = express();
const server = http.createServer(app);
app.use(express.static(path.join(__dirname, 'public')));

// Determine if this is the primary worker process
const isPrimaryWorker = (process.env.INSTANCE_ID === '0' || process.env.NODE_APP_INSTANCE === '0');
if (isPrimaryWorker) {
    logger.info('[Server] This process is the primary worker. Will handle data fetching and writing.');
} else {
    logger.info(`[Server] This is a secondary worker (INSTANCE_ID: ${process.env.INSTANCE_ID || process.env.NODE_APP_INSTANCE}). API only.`);
}

// NOTE: Restart workflow details — This server supports a secure /api/restart endpoint
// which can be triggered by CI or other automation using a token set in the RESTART_API_TOKEN
// environment variable. Restart scripts are located in /tools/. If you update node code,
// call the endpoint (or run `npm run restart:node`/`npm run restart:auto`) to apply changes.

// --- Load Configuration ---
const PORT = config.server.mainPort;
const PIAWARE_URLS = Array.isArray(config.data.piAwareUrls) ? config.data.piAwareUrls : [];
const PIAWARE_RECEIVER_VERSION = '1.0';
const PIAWARE_RECEIVER_IDS = new Map(PIAWARE_URLS.map(url => [url, deriveReceiverIdFromUrl(url)]));
const DEFAULT_RECEIVER_ID = PIAWARE_RECEIVER_IDS.get(PIAWARE_URLS[0]) || 'server';
logger.info(`[Server] TSDB receiver_ids: ${Array.from(PIAWARE_RECEIVER_IDS.entries()).map(([url, id]) => `${url}=>${id}`).join(', ')}`);
const BUCKET_NAME = config.buckets.readBucket;
const WRITE_BUCKET_NAME = config.buckets.writeBucket;
const STATE_FILE = path.join(__dirname, config.state.stateFile);

const s3 = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    credentials: config.s3.credentials,
    forcePathStyle: config.s3.forcePathStyle,
});

// Ensure runtime directory exists for logs/state
try {
    const accessLogPath = path.join(__dirname, config.server.accessLogFile);
    const stateFilePath = path.join(__dirname, config.state.stateFile);
    const runtimeDir = path.dirname(accessLogPath);
    if (!fs.existsSync(runtimeDir)) {
        fs.mkdirSync(runtimeDir, { recursive: true });
        logger.info(`Created runtime directory: ${runtimeDir}`);
    }
    // Also ensure state file parent dir exists (in case different)
    const stateDir = path.dirname(stateFilePath);
    if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
        logger.info(`Created state directory: ${stateDir}`);
    }
} catch (err) {
    console.error('Failed to ensure runtime directory exists:', err);
}

// --- Global Cache for S3 Operations and Stats ---
let globalCache = {
    airlineStats: {},
    squawkTransitions: {},
    historicalStats: {},
    s3Reads: 0,
    s3Writes: 0,
    s3Errors: 0,
    lastRead: null,
    lastWrite: null
};

// --- TSDB Write Counter ---
let tsdbWriteCount = 0;

const PI_AWARE_WATCHDOG_INTERVAL_MS = 10000;
const pendingPiAwareFetches = new Map();
const piAwareAgentPool = new Map();
const tsdbAgentPool = new Map();

function trackPiAwareFetch({ url, agent, controller, timeoutId }) {
    const id = Symbol(url);
    pendingPiAwareFetches.set(id, {
        url,
        agent,
        controller,
        timeoutId,
        startedAt: Date.now()
    });
    return id;
}

function finalizePiAwareFetch(id) {
    const entry = pendingPiAwareFetches.get(id);
    if (!entry) {
        return;
    }

    clearTimeout(entry.timeoutId);
    pendingPiAwareFetches.delete(id);
}

function getPiAwareAgent(url) {
    if (piAwareAgentPool.has(url)) {
        return piAwareAgentPool.get(url);
    }

    const isHttps = url.startsWith('https://');
    const AgentClass = isHttps ? https.Agent : http.Agent;
    const agent = new AgentClass({
        keepAlive: true,
        maxSockets: 1,
        maxFreeSockets: 1,
        keepAliveMsecs: 30000
    });

    piAwareAgentPool.set(url, agent);
    return agent;
}

function startPiAwareFetchWatchdog() {
    const interval = setInterval(() => {
        const outstanding = pendingPiAwareFetches.size;
        if (outstanding === 0) {
            logger.debug('[fetchData] PiAware watchdog: no outstanding connections');
            return;
        }

        logger.warn(`[fetchData] PiAware watchdog detected ${outstanding} hung connection(s); aborting`);
        for (const id of Array.from(pendingPiAwareFetches.keys())) {
            const entry = pendingPiAwareFetches.get(id);
            if (!entry) {
                continue;
            }

            entry.controller.abort();
            finalizePiAwareFetch(id);
        }
    }, PI_AWARE_WATCHDOG_INTERVAL_MS);

    interval.unref();
}

startPiAwareFetchWatchdog();

function getTSDBAgent(url) {
    if (tsdbAgentPool.has(url)) {
        return tsdbAgentPool.get(url);
    }

    const isHttps = url.startsWith('https://');
    const AgentClass = isHttps ? https.Agent : http.Agent;
    const agent = new AgentClass({
        keepAlive: true,
        maxSockets: 2,
        maxFreeSockets: 2,
        keepAliveMsecs: 30000
    });

    tsdbAgentPool.set(url, agent);
    return agent;
}

// --- TSDB Write Functions ---
async function writeLinesToTSDB(lines) {
    const tsdbConfig = config.tsdb;
    if (!tsdbConfig || !tsdbConfig.url || !tsdbConfig.token || !tsdbConfig.db) {
        return 0;
    }

    const urls = [
        `${tsdbConfig.url}/api/v2/write?bucket=${tsdbConfig.db}&precision=ns`,
        `${tsdbConfig.url}/api/v3/write_lp?db=${tsdbConfig.db}`
    ];

    const headers = {
        'Content-Type': 'text/plain',
        'Authorization': `Bearer ${tsdbConfig.token}`
    };

    const body = lines.join('\n') + '\n';
    console.log(`TSDB: Attempting to write ${lines.length} lines`);

    for (const url of urls) {
        try {
            const agent = getTSDBAgent(url);
            const isHttps = url.startsWith('https://');
            const axiosOptions = {
                headers,
                timeout: 10000,
                httpAgent: isHttps ? undefined : agent,
                httpsAgent: isHttps ? agent : undefined
            };

            const response = await axios.post(url, body, axiosOptions);
            if (response.status === 200 || response.status === 204) {
                const written = lines.length;
                tsdbWriteCount += written;
                console.log(`TSDB: Successfully wrote ${written} records to ${url}`);
                return written;
            }
        } catch (error) {
            console.log(`TSDB: Write to ${url} failed: ${error.message}`);
        }
    }

    console.log('TSDB: All write attempts failed');
    return 0;
}

function formatPositionAsLineProtocol(position, receiverLat = 0.0, receiverLon = 0.0, receiverId = 'server', receiverVersion = '1.0') {
    const { hex, flight, lat, lon, alt, gs, track, timestamp, registration, aircraft_type, squawk, rssi } = position;

    // Validate required fields
    if (!lat || !lon || lat === 'N/A' || lon === 'N/A') {
        return null;
    }

    // Build tags
    const tags = {
        icao: hex,
        flight: flight || 'N/A',
        registration: registration || 'N/A',
        type: aircraft_type || 'N/A',
        data_source: 'piaware',
        receiver_id: receiverId,
        receiver_version: receiverVersion
    };

    // Build fields
    const fields = {};
    fields.lat = parseFloat(lat) || 0.0;
    fields.lon = parseFloat(lon) || 0.0;

    if (squawk && squawk !== 'N/A') {
        const squawkNum = parseInt(squawk);
        if (!isNaN(squawkNum)) {
            fields.squawk = squawkNum;
        }
    }

    if (alt && alt !== 'N/A') {
        const altNum = parseInt(alt);
        if (!isNaN(altNum)) {
            fields.altitude_ft = altNum;
        }
    }

    if (gs && gs !== 'N/A') {
        const gsNum = parseFloat(gs);
        if (!isNaN(gsNum)) {
            fields.speed_kt = gsNum;
        }
    }

    if (track && track !== 'N/A') {
        const trackNum = parseFloat(track);
        if (!isNaN(trackNum)) {
            fields.heading = trackNum;
        }
    }

    if (rssi && rssi !== 'N/A') {
        const rssiNum = parseFloat(rssi);
        if (!isNaN(rssiNum)) {
            fields.rssi = rssiNum;
        }
    }

    // Add receiver location information
    fields.receiver_lat = receiverLat;
    fields.receiver_lon = receiverLon;

    // Format as line protocol
    const tagsStr = Object.entries(tags).map(([k, v]) => `${k}=${v}`).join(',');
    const fieldsStr = Object.entries(fields).map(([k, v]) => {
        if (typeof v === 'string') {
            return `${k}="${v.replace(/"/g, '\\"')}"`;
        }
        return `${k}=${v}`;
    }).join(',');

    const timeNs = timestamp * 1000000; // Convert milliseconds to nanoseconds
    return `aircraft_positions_v2,${tagsStr} ${fieldsStr} ${timeNs}`;
}

// --- Position Cache (7 days of historical data in memory) ---
const positionCache = new PositionCache(s3, 
    {
        read: BUCKET_NAME,
        write: WRITE_BUCKET_NAME
    },
    {
        onLoadComplete: (positions) => {
            // Populate live memory with last 24 hours from cache
            const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
            const recentPositions = positions.filter(p => p.timestamp >= twentyFourHoursAgo);
            
            logger.info(`[Server] Populating live memory with ${recentPositions.length} positions from cache`);
            
            // Populate positionHistory
            positionHistory = recentPositions.map(p => ({
                hex: p.hex,
                callsign: p.callsign || '',
                lat: p.lat,
                lon: p.lon,
                alt: p.alt,
                gs: p.gs,
                timestamp: p.timestamp,
                rssi: p.rssi,
                squawk: p.squawk
            }));
            
            // Populate activeFlights from recent positions (last hour)
            const oneHourAgo = Date.now() - (60 * 60 * 1000);
            const veryRecentPositions = positions.filter(p => p.timestamp >= oneHourAgo);
            
            // Group by hex and create flight records
            const flightsByHex = {};
            for (const pos of veryRecentPositions) {
                if (!flightsByHex[pos.hex]) {
                    flightsByHex[pos.hex] = {
                        hex: pos.hex,
                        callsign: pos.callsign || '',
                        firstSeen: pos.timestamp,
                        lastSeen: pos.timestamp,
                        positions: []
                    };
                }
                const flight = flightsByHex[pos.hex];
                flight.firstSeen = Math.min(flight.firstSeen, pos.timestamp);
                flight.lastSeen = Math.max(flight.lastSeen, pos.timestamp);
                flight.positions.push(pos);
            }
            
            // Add to activeFlights
            for (const hex in flightsByHex) {
                const flight = flightsByHex[hex];
                if (flight.positions.length > 0) {
                    activeFlights[hex] = flight;
                }
            }
            
            logger.info(`[Server] Live memory populated: ${positionHistory.length} positions, ${Object.keys(activeFlights).length} active flights`);
            
            // Save aggregated stats to S3 now that cache is loaded
            saveAggregatedStatsToS3().catch(err => logger.error('[Server] Error saving aggregated stats after cache load:', err));
        },
        isBackgroundLoader: false // Single process mode
    }
);

// --- In-memory state ---
let aircraftTracking = {}; // Current active aircraft (1 minute window)
let activeFlights = {}; // Active flights in progress (keyed by ICAO hex) - will be populated from cache
let positionHistory = []; // All positions from last 24 hours - will be populated from cache
let squawkTransitions = []; // Squawk code changes
let lastSquawkSeen = {}; // Track last squawk per aircraft
let runningPositionCount = 0;
let trackerStartTime = Date.now();
let receiver_lat = 0.0, receiver_lon = 0.0;

const POSITION_RETENTION_MS = config.retention.positionRetentionMs;
const GAP_MS = config.retention.gapMs;

// --- Helper Functions ---
function updateActiveFlights() {
    // Update active flights based on currently tracked aircraft
    const newActiveFlights = {};
    
    for (const hex in aircraftTracking) {
        const aircraft = aircraftTracking[hex];
        if (!aircraft.flight || aircraft.flight.trim() === '') continue;
        
        // Calculate slant range from receiver to aircraft position
        let slant_range_start = null, slant_range_end = null;
        if (receiver_lat && receiver_lon && aircraft.lat && aircraft.lon && aircraft.alt_baro) {
            const horiz_dist = calculate_distance(receiver_lat, receiver_lon, aircraft.lat, aircraft.lon);
            slant_range_start = calculate_slant_distance(horiz_dist, aircraft.alt_baro);
            slant_range_end = slant_range_start;
        }
        newActiveFlights[hex] = {
            icao: hex,
            callsign: aircraft.flight,
            registration: aircraft.registration || '',
            start_time: new Date(aircraft.firstSeen).toISOString(),
            end_time: new Date(aircraft.lastSeen).toISOString(),
            start_ts: aircraft.firstSeen,
            end_ts: aircraft.lastSeen,
            start_lat: aircraft.lat,
            start_lon: aircraft.lon,
            end_lat: aircraft.lat,
            end_lon: aircraft.lon,
            max_alt_ft: aircraft.alt_baro,
            max_speed_kt: aircraft.gs,
            reports: 1, // This is a snapshot, so report count is 1
            airline_code: aircraft.flight.substring(0, 3).toUpperCase(),
            airline_name: aircraft.airline || '',
            slant_range_start,
            slant_range_end
        };
    }
    
    activeFlights = newActiveFlights;
}

function calculate_distance(lat1, lon1, lat2, lon2) {
    const R = 3440.065; // Radius of Earth in nautical miles
    const toRad = (deg) => deg * Math.PI / 180;

    const lat1_rad = toRad(lat1);
    const lat2_rad = toRad(lat2);
    const delta_lat = toRad(lat2 - lat1);
    const delta_lon = toRad(lon2 - lon1);

    const a = Math.sin(delta_lat / 2) ** 2 + Math.cos(lat1_rad) * Math.cos(lat2_rad) * Math.sin(delta_lon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

// --- Middleware ---
app.get('/favicon.ico', (req, res) => { res.status(204).end(); });
app.use(express.json());
const accessLogStream = fs.createWriteStream(path.join(__dirname, config.server.accessLogFile), { flags: 'a' });

// Use W3C Extended Log Format if enabled, otherwise use Morgan format
if (config.logging.enableW3C) {
    const { logW3C, initializeW3CLogger } = require('./lib/logger');
    initializeW3CLogger(config);
    app.use(logW3C);
} else {
    app.use(morgan(config.logging.format, { stream: accessLogStream }));
}

// --- Heatmap Viewer Routes ---
app.get('/heatmap-leaflet', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'heatmap-leaflet.html'));
});

// --- Core Logic ---
const fetchData = async () => {
    // This entire function should only run on the primary worker
    if (!isPrimaryWorker) {
        return;
    }
    console.log(`[fetchData] Starting fetchData`);
    try {
        // Fetch from all PiAware receivers (current data only)
        const fetch = (await import('node-fetch')).default;

        const currentPromises = PIAWARE_URLS.map(url => {
            const agent = getPiAwareAgent(url);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                logger.warn(`[fetchData] PiAware current fetch timeout for ${url}`);
                controller.abort();
            }, 3000);
            const fetchId = trackPiAwareFetch({ url, agent, controller, timeoutId });

            return fetch(url, {
                agent: agent,
                signal: controller.signal
            })
            .then(res => res.json())
            .then(data => {
                return { data, url };
            })
            .catch(err => {
                if (err.name === 'AbortError') {
                    logger.warn(`PiAware current fetch aborted for ${url}: ${err.message}`);
                } else {
                    logger.warn(`Failed to fetch current data from ${url}: ${err.message}`);
                }
                return { data: { aircraft: [] }, url }; // Return empty data on failure
            })
            .finally(() => finalizePiAwareFetch(fetchId));
        });

        const historyPromises = PIAWARE_URLS.map(url => {
            const agent = getPiAwareAgent(url);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                logger.warn(`[fetchData] PiAware historical fetch timeout for ${url}`);
                controller.abort();
            }, 10000);
            const fetchId = trackPiAwareFetch({ url, agent, controller, timeoutId });

            return fetch(`${url}?history=120`, {
                agent,
                signal: controller.signal
            })
            .then(res => res.json())
            .then(data => ({ data, url }))
            .catch(err => {
                if (err.name === 'AbortError') {
                    logger.warn(`PiAware historical fetch aborted for ${url}: ${err.message}`);
                } else {
                    logger.warn(`Failed to fetch historical data from ${url}: ${err.message}`);
                }
                return { data: { aircraft: [] }, url };
            })
            .finally(() => finalizePiAwareFetch(fetchId));
        });

        const [currentResponses, historyResponses, airlineDb, typesDb] = await Promise.all([
            Promise.all(currentPromises),
            Promise.all(historyPromises),
            getAirlineDatabase(s3, BUCKET_NAME),
            getAircraftTypesDatabase(s3, BUCKET_NAME)
        ]);

        if (!airlineDb || typeof airlineDb !== 'object' || !typesDb || typeof typesDb !== 'object') {
            // Skip data enrichment when databases are not available
        }

        // Aggregate aircraft data from all receivers (current only)
        const aircraftMap = new Map(); // Use Map to deduplicate by hex code
        
        // Process current data - merge data from multiple receivers intelligently
        for (const response of currentResponses) {
            const aircraftList = response.data.aircraft || [];
            const receiverId = PIAWARE_RECEIVER_IDS.get(response.url) || DEFAULT_RECEIVER_ID;
            const receiverNow = response.data.now;

            // Log the timestamp from the receiver's data payload for diagnostics
            if (response.data.now) {
                logger.info(`[fetchData] Receiver ${receiverId} (${response.url}) reported timestamp: ${response.data.now}`);
            }

            for (const aircraft of aircraftList) {
                if (aircraft.hex) {
                    // Normalize hex/icao to lowercase for consistent deduplication
                    const hexNorm = aircraft.hex.toString().toLowerCase();
                    aircraft.hex = hexNorm;

                    // Calculate the actual timestamp of the position report in milliseconds
                    const timestamp = (receiverNow && typeof aircraft.seen === 'number') ? (receiverNow - aircraft.seen) * 1000 : 0;
                    aircraft.timestamp = timestamp;

                    const existing = aircraftMap.get(hexNorm);
                    if (!existing || timestamp > (existing.timestamp || 0)) {
                        // This new report is newer, so it becomes the authority.
                        const merged = { ...aircraft, dataSource: 'current', receiver_id: receiverId };
                        if (existing) {
                            merged.flight = merged.flight || existing.flight;
                            merged.squawk = merged.squawk || existing.squawk;
                            merged.registration = merged.registration || existing.registration || existing.r;
                            merged.aircraft_type = merged.aircraft_type || existing.aircraft_type || existing.t;
                        }
                        aircraftMap.set(hexNorm, merged);
                    } else if (timestamp === (existing.timestamp || 0)) {
                        // Timestamps are identical, use signal strength (RSSI) as a tie-breaker.
                        const currentRssi = aircraft.rssi || -100;
                        const existingRssi = existing.rssi || -100;
                        if (currentRssi > existingRssi) {
                            const merged = { ...aircraft, dataSource: 'current', receiver_id: receiverId };
                            merged.flight = merged.flight || existing.flight;
                            merged.squawk = merged.squawk || existing.squawk;
                            merged.registration = merged.registration || existing.registration || existing.r;
                            merged.aircraft_type = merged.aircraft_type || existing.aircraft_type || existing.t;
                            aircraftMap.set(hexNorm, merged);
                        }
                    }
                }
            }
        }
        
        // Apply historical data to enrich fields like callsign, squawk, and registration,
        // but only if those fields are missing from the current, most up-to-date record.
        for (const response of historyResponses) {
            const aircraftList = response.data.aircraft || [];
            for (const aircraft of aircraftList) {
                if (!aircraft.hex) continue;
                const hexNorm = aircraft.hex.toString().toLowerCase();
                const existing = aircraftMap.get(hexNorm);
                
                // Only enrich if we have a current record for this aircraft
                if (!existing) continue;

                // Create a copy to modify
                const merged = { ...existing };
                let wasEnriched = false;

                if ((!merged.flight || merged.flight === 'N/A') && aircraft.flight) {
                    merged.flight = aircraft.flight;
                    wasEnriched = true;
                }
                if ((!merged.squawk || merged.squawk === 'N/A') && aircraft.squawk) {
                    merged.squawk = aircraft.squawk;
                    wasEnriched = true;
                }
                const historyRegistration = aircraft.registration || aircraft.r;
                if ((!merged.registration || merged.registration === 'N/A') && historyRegistration) {
                    merged.registration = historyRegistration;
                    wasEnriched = true;
                }
                const historyType = aircraft.t || aircraft.aircraft_type;
                if ((!merged.aircraft_type || merged.aircraft_type === 'N/A') && historyType) {
                    merged.aircraft_type = historyType;
                    wasEnriched = true;
                }
                
                // If any fields were added, update the map
                if (wasEnriched) {
                    aircraftMap.set(hexNorm, merged);
                }
            }
        }

        // Convert map to array for further processing
        const allAircraft = Array.from(aircraftMap.values());
        
        // Separate current aircraft for further processing
        const liveAircraft = allAircraft.filter(ac => ac.dataSource === 'current');
        
        // Enrich aircraft data if databases are available
        if (airlineDb && typesDb) {
            for (const aircraft of allAircraft) {
                const flight = (aircraft.flight || '').trim();
                let airlineCode = null;
                const airlineMatch = flight.match(/^([A-Z]{3})/);
                if (airlineMatch) {
                    airlineCode = airlineMatch[1];
                }

                const aircraftData = aircraftDB.lookup(aircraft.hex);
                
                const registration = aircraftData?.registration 
                    || aircraft.r 
                    || registration_from_hexid(aircraft.hex) 
                    || '';
                
                const aircraft_type = aircraftData?.typecode 
                    || aircraft.t 
                    || '';
                
                const aircraft_model = aircraftData?.model || null;
                
                const typeInfo = aircraftTypesDB.lookup(aircraft_type);
                const manufacturer = typeInfo?.manufacturer || '';
                const bodyType = typeInfo?.bodyType || '';
                const manufacturerLogo = typeInfo?.manufacturerLogo || 
                    (manufacturer ? `/api/v2logos/${encodeURIComponent(manufacturer)}` : null);
                
                const fullModel = aircraft_model || typeInfo?.model || '';
                
                let airlineName = '';
                let airlineLogo = null;

                // Prioritize airline code lookup
                if (airlineCode && airlineDb[airlineCode]) {
                    const airlineData = airlineDb[airlineCode];
                    airlineName = typeof airlineData === 'string' ? airlineData : (airlineData.name || '');
                    airlineLogo = typeof airlineData === 'string' ? null : airlineData.logo;
                } 
                // Fallback for general aviation / private flights
                else if (registration && registration.startsWith('N')) {
                    airlineName = 'Private';
                }

                aircraft.flight = flight;
                aircraft.airline = airlineName;
                aircraft.registration = registration;
                aircraft.aircraft_type = aircraft_type;
                aircraft.aircraft_model = fullModel;
                aircraft.manufacturer = manufacturer;
                aircraft.bodyType = bodyType;
                aircraft.manufacturerLogo = manufacturerLogo;
                aircraft.airlineLogo = airlineLogo;
                aircraft.distance = (aircraft.lat && aircraft.lon && receiver_lat !== 0.0) ? calculate_distance(receiver_lat, receiver_lon, aircraft.lat, aircraft.lon).toFixed(1) : '';
            }
        }

        // Update tracking and position history
        liveAircraft.forEach(ac => {
            if (ac.lat !== undefined && ac.lon !== undefined) {
                // Calculate slant distance for reception records
                if (receiver_lat !== 0.0 && receiver_lon !== 0.0 && ac.alt_baro && ac.alt_baro !== 'N/A') {
                    const positionalDist = calculate_distance(receiver_lat, receiver_lon, ac.lat, ac.lon);
                    const slantDist = calculate_slant_distance(positionalDist, ac.alt_baro);
                    const bearing = calculate_bearing(receiver_lat, receiver_lon, ac.lat, ac.lon);
                    updateSectorAltitudeRecords(ac, slantDist, bearing);
                }

                // Add to 24-hour position history
                const position = {
                    hex: ac.hex,
                    flight: ac.flight,
                    lat: ac.lat,
                    lon: ac.lon,
                    alt: ac.alt_baro,
                    gs: ac.gs,
                    track: ac.track,
                    timestamp: ac.timestamp, // Ensure the correct, calculated timestamp is used here
                    registration: ac.registration,
                    aircraft_type: ac.aircraft_type,
                    airline: ac.airline,
                    squawk: ac.squawk,
                    rssi: ac.rssi,
                    receiver_id: ac.receiver_id || DEFAULT_RECEIVER_ID
                };
                positionHistory.push(position);
                
                // Add to position cache for long-term storage
                positionCache.addPosition(position);
                
                // Collect for TSDB write
                positionsForTSDB.push(position);
                
                // Track squawk code changes
                if (ac.squawk) {
                    if (lastSquawkSeen[ac.hex] && lastSquawkSeen[ac.hex] !== ac.squawk) {
                        squawkTransitions.push({
                            hex: ac.hex,
                            flight: ac.flight || '',
                            from: lastSquawkSeen[ac.hex],
                            to: ac.squawk,
                            timestamp: ac.timestamp // Use position timestamp for transition
                        });
                    }
                    lastSquawkSeen[ac.hex] = ac.squawk;
                }
                
                if (!aircraftTracking[ac.hex]) {
                    // New aircraft, add firstSeen timestamp
                    aircraftTracking[ac.hex] = { ...ac, firstSeen: ac.timestamp, lastSeen: ac.timestamp };
                    runningPositionCount++;
                } else {
                    // Existing aircraft, preserve firstSeen and update lastSeen
                    aircraftTracking[ac.hex] = { ...ac, firstSeen: aircraftTracking[ac.hex].firstSeen, lastSeen: ac.timestamp };
                }
            }
        });

        // Update active flights based on current aircraft
        updateActiveFlights();
        
        // Cleanup old aircraft from active tracking (1 minute window)
        for (const hex in aircraftTracking) {
            if (Date.now() - aircraftTracking[hex].lastSeen > 60000) { // 1 minute timeout
                delete aircraftTracking[hex];
            }
        }
        
        // Cleanup old positions from history (24 hour window)
        const cutoffTime = Date.now() - POSITION_RETENTION_MS;
        positionHistory = positionHistory.filter(pos => pos.timestamp > cutoffTime);
        
        // Cleanup old squawk transitions (keep last 7 days)
        const squawkCutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
        squawkTransitions = squawkTransitions.filter(t => t.timestamp > squawkCutoff);

        // Send live update to WebSocket server
        const liveData = {
            trackingCount: Object.keys(aircraftTracking).length,
            runningPositionCount,
            aircraft: liveAircraft,
            runtime: Math.floor((Date.now() - trackerStartTime) / 1000),
            receiver_lat,
            receiver_lon,
            receiverCount: PIAWARE_URLS.length
        };

        // Send to WebSocket server via HTTP POST
        try {
            await axios.post('http://localhost:3003/api/live-update', liveData, {
                timeout: 1000,
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            logger.warn('Failed to send live update to WebSocket server:', error.message);
        }

    } catch (error) {
        logger.error(`Fetch error: ${error.message}`);
    }
};

// --- Initialization ---
async function initialize() {
    await loadState();
    
    // Ensure S3 buckets exist before any operations
    try {
        await ensureBucketsExist();
    } catch (error) {
        logger.error('Failed to verify/create S3 buckets. Server cannot start.');
        process.exit(1);
    }
    
    try {
        // Try to get receiver location from the first PiAware URL
        const receiverUrl = PIAWARE_URLS[0].replace('/data/aircraft.json', '/data/receiver.json');
        const response = await axios.get(receiverUrl, { timeout: 5000 });
        receiver_lat = response.data.lat || 0.0;
        receiver_lon = response.data.lon || 0.0;
        logger.info(`Receiver at: ${receiver_lat}, ${receiver_lon}`);
    } catch (error) {
        logger.warn(`Receiver fetch error: ${error.message}`);
    }
    
    // Pass in-memory state to API routes for live endpoints
    const getInMemoryState = () => ({
        aircraftTracking,
        activeFlights,
        squawkTransitions,
        positionHistory,
        runningPositionCount,
        trackerStartTime,
        receiver_lat,
        receiver_lon
    });
    // Use BUCKET_NAME for read-only (historical) endpoints, WRITE_BUCKET_NAME for write endpoints
    setupApiRoutes(app, s3, BUCKET_NAME, WRITE_BUCKET_NAME, getInMemoryState, globalCache, positionCache, tsdbWriteCount); // Pass positionCache for fast position lookups

    // Schedule background jobs only on the primary worker
    if (isPrimaryWorker) {
        setInterval(saveState, config.backgroundJobs.saveStateInterval);
        trackCache.start().catch(err => {
            logger.error('Failed to start track cache service:', err);
        });
        setInterval(saveAircraftDataToS3, config.backgroundJobs.saveAircraftDataInterval);
        setInterval(buildFlightsFromS3, config.backgroundJobs.buildFlightsInterval);
        setInterval(buildHourlyPositionsFromS3, config.backgroundJobs.buildHourlyPositionsInterval);
        
        // Initial builds
        setTimeout(() => buildFlightsFromS3(), config.initialJobDelays.buildFlightsDelay);
        setTimeout(() => buildHourlyPositionsFromS3(), config.initialJobDelays.buildHourlyPositionsDelay);
        
        // Initialize S3 registration database
        initializeRegistrationDB().catch(err => {
            logger.warn(`Failed to initialize S3 registration database: ${err.message}`);
        });
        
        logger.info('Background jobs scheduled');
        
        // Start fetchData for live aircraft updates
        setInterval(fetchData, config.backgroundJobs.fetchDataInterval);
        logger.info('fetchData scheduled for live updates on primary worker.');
    }
}

initialize();

server.listen(PORT, () => logger.info(`Server on port ${PORT}`));
