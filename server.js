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
const { registration_from_hexid } = require('./lib/registration');
const { setupApiRoutes } = require('./lib/api-routes');
const { computeAirlineStatsData, computeSquawkTransitionsData, computeHistoricalStatsData, remakeHourlyRollup } = require('./lib/aggregators');
const logger = require('./lib/logger');
const { listS3Files, downloadAndParseS3File } = require('./lib/s3-helpers');
const { loadRecentHeatmapPositions } = require('./lib/api-routes');
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

// NOTE: Restart workflow details — This server supports a secure /api/restart endpoint
// which can be triggered by CI or other automation using a token set in the RESTART_API_TOKEN
// environment variable. Restart scripts are located in /tools/. If you update node code,
// call the endpoint (or run `npm run restart:node`/`npm run restart:auto`) to apply changes.

// --- Load Configuration ---
const PORT = config.server.mainPort;
const PIAWARE_URLS = Array.isArray(config.dataSource.piAwareUrls) ? config.dataSource.piAwareUrls : [];
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

// Dedicated HTTP client for the WebSocket bridge so live-update posts do not create new
// connections each poll. Timeout is configurable via WEBSOCKET_TIMEOUT_MS (default 5s).
const WEBSOCKET_SERVER_URL = process.env.WEBSOCKET_SERVER_URL || 'http://localhost:3003';
const WEBSOCKET_TIMEOUT_MS = Number(process.env.WEBSOCKET_TIMEOUT_MS || 5000);
const websocketHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 2, keepAliveMsecs: 30000 });
const websocketHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 2, keepAliveMsecs: 30000 });
const websocketClient = axios.create({
    baseURL: WEBSOCKET_SERVER_URL.replace(/\/$/, ''),
    timeout: WEBSOCKET_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
    httpAgent: websocketHttpAgent,
    httpsAgent: websocketHttpsAgent
});
const WEBSOCKET_ERROR_LOG_WINDOW_MS = Number(process.env.WEBSOCKET_ERROR_LOG_WINDOW_MS || 60000);
let lastWebsocketErrorLogTs = 0;
let websocketErrorSuppressedCount = 0;

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
    preloadedPositions: null, // Preloaded 1-hour positions
    preloadedPositionsLastUpdate: null,
    s3Reads: 0,
    s3Writes: 0,
    s3Errors: 0,
    lastRead: null,
    lastWrite: null
};

// --- Worker Management ---
let maxWorkerId = 0;
let fetchDataWorkerId = null;

// Primary worker detection for PM2 cluster mode
const isPrimaryWorker = !process.env.INSTANCE_ID && !process.env.NODE_APP_INSTANCE || (process.env.INSTANCE_ID === '0' || process.env.NODE_APP_INSTANCE === '0');

// --- TSDB Write Counter ---
let tsdbWriteCount = 0;

const PI_AWARE_WATCHDOG_INTERVAL_MS = 10000;
const pendingPiAwareFetches = new Map();
const piAwareAgentPool = new Map();
const piAwareHistoryAgentPool = new Map();
const tsdbAgentPool = new Map();
const PIAWARE_FETCH_TIMEOUT_MS = Number(process.env.PIAWARE_FETCH_TIMEOUT_MS || 3000);
const PIAWARE_HISTORY_FETCH_INTERVAL_MS = Number(process.env.PIAWARE_HISTORY_FETCH_INTERVAL_MS || 30000);
const lastPiAwareHistoryFetch = new Map();
const lastPiAwareHistoryData = new Map();

function sanitizeHistoryPayload(data) {
    if (!data || !Array.isArray(data.aircraft)) {
        return { aircraft: [] };
    }

    return {
        ...data,
        aircraft: data.aircraft.map(ac => ({
            hex: ac.hex,
            flight: ac.flight,
            squawk: ac.squawk,
            registration: ac.registration,
            r: ac.r,
            t: ac.t,
            manufacturer: ac.manufacturer,
            manufacturerLogo: ac.manufacturerLogo
        }))
    };
}

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

function getPiAwareHistoryAgent(url) {
    if (piAwareHistoryAgentPool.has(url)) {
        return piAwareHistoryAgentPool.get(url);
    }

    const isHttps = url.startsWith('https://');
    const AgentClass = isHttps ? https.Agent : http.Agent;
    const agent = new AgentClass({
        keepAlive: true,
        maxSockets: 1,
        maxFreeSockets: 1,
        keepAliveMsecs: 30000
    });

    piAwareHistoryAgentPool.set(url, agent);
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

async function fetchPiAwareJson(fetchImpl, { url, agent, timeoutMs = PIAWARE_FETCH_TIMEOUT_MS, label }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        logger.warn(`[fetchData] PiAware ${label} fetch timeout for ${url}`);
        controller.abort();
    }, timeoutMs);
    const fetchId = trackPiAwareFetch({ url, agent, controller, timeoutId });

    try {
        const response = await fetchImpl(url, {
            agent,
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
    } catch (err) {
        if (err.name === 'AbortError') {
            logger.warn(`PiAware ${label} fetch aborted for ${url}: ${err.message}`);
        } else {
            logger.warn(`Failed to fetch ${label} data from ${url}: ${err.message}`);
        }
        return { aircraft: [] };
    } finally {
        finalizePiAwareFetch(fetchId);
    }
}

async function fetchPiAwareReceiverPair(fetchImpl, url) {
    const agent = getPiAwareAgent(url);
    const currentData = await fetchPiAwareJson(fetchImpl, {
        url,
        agent,
        timeoutMs: PIAWARE_FETCH_TIMEOUT_MS,
        label: 'current'
    });

    let historyData = lastPiAwareHistoryData.has(url)
        ? sanitizeHistoryPayload(lastPiAwareHistoryData.get(url))
        : { aircraft: [] };
    const now = Date.now();
    const lastFetch = lastPiAwareHistoryFetch.get(url) || 0;

    if ((now - lastFetch) >= PIAWARE_HISTORY_FETCH_INTERVAL_MS || !historyData || !historyData.aircraft) {
        const historyAgent = getPiAwareHistoryAgent(url);
        const freshHistory = await fetchPiAwareJson(fetchImpl, {
            url: `${url}?history=120`,
            agent: historyAgent,
            timeoutMs: PIAWARE_FETCH_TIMEOUT_MS,
            label: 'historical'
        });
        historyData = sanitizeHistoryPayload(freshHistory);
        lastPiAwareHistoryFetch.set(url, now);
        lastPiAwareHistoryData.set(url, historyData);
    }

    return {
        url,
        currentData,
        historyData
    };
}

// --- TSDB Write Functions ---
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

async function writeLinesToTSDB(lines) {
    const tsdbConfig = config.tsdb;
    if (!tsdbConfig || !tsdbConfig.url || !tsdbConfig.token || !tsdbConfig.db) {
        return 0;
    }

    const urls = [
        `${tsdbConfig.url}/api/v2/write?bucket=${tsdbConfig.db}&precision=ns`,
        `${tsdbConfig.url}/api/v3/write_lp?db=${tsdbConfig.db}`,
        `${tsdbConfig.url}/api/v3/write_lp?bucket=${tsdbConfig.db}`
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
    if (receiverLat !== 0.0 || receiverLon !== 0.0) {
        fields.receiver_lat = receiverLat;
        fields.receiver_lon = receiverLon;
    }

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

// --- Reception Records for Visualization ---
let maxSlantRangeRecord = null; // All-time longest slant range

// --- Visualization Functions ---
function getSector(bearing) {
    // Sector 0 = 0-29°, Sector 1 = 30-59°, etc.
    return Math.floor(bearing / 30) % 12;
}

function getAltitudeZone(altitudeFt) {
    // Zone 0 = 0-4999 ft, Zone 1 = 5000-9999 ft, etc.
    if (altitudeFt < 0) return 0;
    return Math.floor(altitudeFt / 5000);
}

function updateSectorAltitudeRecords(aircraftInfo, slantDist, bearing) {
    const altitude = aircraftInfo.alt_baro || 0;
    const sector = getSector(bearing);
    const altitudeZone = getAltitudeZone(altitude);
    
    const recordKey = `${sector}_${altitudeZone}`;
    
    if (!sectorAltitudeRecords[recordKey] || slantDist > sectorAltitudeRecords[recordKey].slantDistance) {
        sectorAltitudeRecords[recordKey] = {
            aircraft: { ...aircraftInfo },
            slantDistance: slantDist,
            positionalDistance: aircraftInfo.r_dst || 'N/A',
            bearing: bearing,
            altitudeZone: altitudeZone,
            timestamp: new Date().toISOString()
        };
    }
    
    // Update max slant range
    if (!maxSlantRangeRecord || slantDist > maxSlantRangeRecord.slantDistance) {
        maxSlantRangeRecord = {
            aircraft: { ...aircraftInfo },
            slantDistance: slantDist,
            positionalDistance: aircraftInfo.r_dst || 'N/A',
            bearing: bearing,
            timestamp: new Date().toISOString()
        };
    }
}

function generateKML() {
    let kmlContent = ['<?xml version="1.0" encoding="UTF-8"?>'];
    kmlContent.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
    kmlContent.push('<Document>');
    kmlContent.push('<name>PiAware Reception Records</name>');
    kmlContent.push('<description>Longest range records by sector and altitude zone</description>');
    
    // Add styles for different altitude zones
    const altitudeColors = [
        ['zone0', 'ff0000ff'], // Blue
        ['zone1', 'ff00ffff'], // Yellow  
        ['zone2', 'ff00ff00'], // Green
        ['zone3', 'ffff0000'], // Red
        ['zone4', 'ffff00ff'], // Magenta
        ['zone5', 'ffffff00'], // Cyan
        ['zone6', 'ff00a5ff'], // Orange
        ['zone7', 'ffff6600'], // Purple
        ['zone8', 'ff8000ff']  // Pink
    ];
    
    altitudeColors.forEach(([styleId, color]) => {
        kmlContent.push(`<Style id="${styleId}">`);
        kmlContent.push('<IconStyle>');
        kmlContent.push(`<color>${color}</color>`);
        kmlContent.push('<Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>');
        kmlContent.push('</IconStyle>');
        kmlContent.push('</Style>');
    });
    
    // Add receiver location
    if (receiver_lat !== 0.0 && receiver_lon !== 0.0) {
        kmlContent.push('<Placemark>');
        kmlContent.push('<name>Receiver</name>');
        kmlContent.push('<Point>');
        kmlContent.push(`<coordinates>${receiver_lon},${receiver_lat},0</coordinates>`);
        kmlContent.push('</Point>');
        kmlContent.push('</Placemark>');
    }
    
    // Add reception records
    Object.entries(sectorAltitudeRecords).forEach(([recordKey, record]) => {
        const aircraft = record.aircraft;
        const lat = aircraft.lat;
        const lon = aircraft.lon;
        
        if (!lat || !lon) return;
        
        kmlContent.push('<Placemark>');
        kmlContent.push(`<name>${aircraft.flight || aircraft.hex || 'Unknown'}</name>`);
        kmlContent.push(`<description>Sector: ${recordKey.split('_')[0]}, Alt Zone: ${record.altitudeZone}, Slant: ${record.slantDistance.toFixed(1)} nm</description>`);
        kmlContent.push(`<styleUrl>#zone${record.altitudeZone}</styleUrl>`);
        kmlContent.push('<Point>');
        kmlContent.push(`<coordinates>${lon},${lat},${(aircraft.alt_baro || 0) * 0.3048}</coordinates>`); // Convert ft to meters
        kmlContent.push('</Point>');
        kmlContent.push('</Placemark>');
    });
    
    kmlContent.push('</Document>');
    kmlContent.push('</kml>');
    
    return kmlContent.join('\n');
}

function generateHeatmapData() {
    // Generate heatmap grid data from position history
    const gridSize = 5; // 5 NM cells
    const heatmap = {};
    
    positionHistory.forEach(pos => {
        if (!pos.lat || !pos.lon) return;
        
        // Skip positions at or very close to 0,0 (invalid data)
        if (Math.abs(pos.lat) < 0.01 && Math.abs(pos.lon) < 0.01) return;
        
        // Convert to grid coordinates (simplified)
        const gridX = Math.floor(pos.lon * 10); // Rough grid
        const gridY = Math.floor(pos.lat * 10);
        const key = `${gridX}_${gridY}`;
        
        if (!heatmap[key]) {
            heatmap[key] = { count: 0, lat: pos.lat, lon: pos.lon };
        }
        heatmap[key].count++;
    });
    
    return Object.values(heatmap);
}

// --- Middleware ---
// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Serve a no-content response for favicon requests to avoid 404 spam in logs
app.get('/favicon.ico', (req, res) => { res.status(204).end(); });
app.use(express.static(path.join(__dirname, 'public')));
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

// --- API Routes (will be set up in initialize()) ---

// --- Helper Functions ---
const dbCache = new Map();
async function getDbInfo(hex) {
    if (!hex || hex.length < 1) return null;
    if (dbCache.has(hex)) return dbCache.get(hex);

    for (let prefixLen = 3; prefixLen >= 1; prefixLen--) {
        if (hex.length <= prefixLen) continue;

        const prefix = hex.substring(0, prefixLen).toUpperCase();
        const suffix = hex.substring(prefixLen);
        const url = `${PIAWARE_URL.replace('/data/aircraft.json', '')}/db/${prefix}.json`;

        try {
            const response = await axios.get(url, { timeout: 3000 });
            if (response.data && response.data[suffix]) {
                const info = response.data[suffix];
                dbCache.set(hex, info);
                return info;
            }
        } catch (error) {
            continue;
        }
    }
    dbCache.set(hex, null);
    return null;
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

async function saveState() {
    try {
        const state = {
            aircraftTracking,
            positionHistory: positionHistory.slice(-1000000), // Save last 1M positions to limit file size
            runningPositionCount,
            trackerStartTime,
            receiver_lat,
            receiver_lon
        };
        await fs.promises.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        logger.error('Error saving state:', error);
    }
}

async function saveAircraftDataToS3() {
    const aircraftToSave = Object.values(aircraftTracking);
    if (aircraftToSave.length === 0) {
        logger.debug('No aircraft data to save to S3.');
        return;
    }

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = now.getUTCDate().toString().padStart(2, '0');
    const hours = now.getUTCHours().toString().padStart(2, '0');
    const minutes = now.getUTCMinutes().toString().padStart(2, '0');

    const fileName = `data/piaware_aircraft_log_${year}${month}${day}_${hours}${minutes}.json`;
    const fileContent = JSON.stringify({ aircraft: aircraftToSave });

    try {
        const command = new PutObjectCommand({
            // Save to the write bucket where current data is stored
            Bucket: WRITE_BUCKET_NAME,
            Key: fileName,
            Body: fileContent,
            ContentType: 'application/json'
        });
        await s3.send(command);
        globalCache.s3Writes = (globalCache.s3Writes || 0) + 1;
        globalCache.lastWrite = Date.now();
        logger.info(`Successfully saved ${aircraftToSave.length} aircraft records to ${fileName} in bucket ${WRITE_BUCKET_NAME}`);
    } catch (error) {
        globalCache.s3Errors = (globalCache.s3Errors || 0) + 1;
        logger.error(`Failed to save aircraft data to S3:`, error);
    }
}

async function saveAggregatedStatsToS3() {
    try {
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
        const day = now.getUTCDate().toString().padStart(2, '0');
        const hours = now.getUTCHours().toString().padStart(2, '0');
        
        const fileName = `aggregated/hourly_stats_${year}${month}${day}_${hours}.json`;
        
        // Try to download existing file
        let existingData = {
            aircraft: new Set(),
            flights: new Set(),
            airlines: new Set()
        };
        
        try {
            const existing = await downloadAndParseS3File(s3, WRITE_BUCKET_NAME, fileName);
            if (existing) {
                if (Array.isArray(existing.aircraft)) {
                    existing.aircraft.forEach(hex => existingData.aircraft.add(hex));
                }
                if (Array.isArray(existing.flights)) {
                    existing.flights.forEach(flight => existingData.flights.add(flight));
                }
                if (Array.isArray(existing.airlines)) {
                    existing.airlines.forEach(airline => existingData.airlines.add(airline));
                }
                logger.debug(`Loaded existing aggregated stats: ${existingData.aircraft.size} aircraft, ${existingData.flights.size} flights, ${existingData.airlines.size} airlines`);
            }
        } catch (err) {
            // File doesn't exist yet, start fresh
            logger.debug(`No existing aggregated stats file, creating new one: ${fileName}`);
        }
        
        // Collect unique aircraft from position history
        positionHistory.forEach(pos => {
            if (pos.hex) existingData.aircraft.add(pos.hex);
            if (pos.callsign && pos.callsign.trim()) {
                const callsign = pos.callsign.trim();
                existingData.flights.add(callsign);
                // Extract airline code (skip N-numbers which are tail numbers, not airline callsigns)
                if (callsign.length >= 3 && !callsign.startsWith('N')) {
                    existingData.airlines.add(callsign.substring(0, 3).toUpperCase());
                }
            }
        });
        
        // Also add from active flights
        Object.values(activeFlights).forEach(flight => {
            if (flight.hex) existingData.aircraft.add(flight.hex);
            if (flight.callsign && flight.callsign.trim()) {
                const callsign = flight.callsign.trim();
                existingData.flights.add(callsign);
                // Extract airline code (skip N-numbers which are tail numbers, not airline callsigns)
                if (callsign.length >= 3 && !callsign.startsWith('N')) {
                    existingData.airlines.add(callsign.substring(0, 3).toUpperCase());
                }
            }
        });
        
        const aggregatedData = {
            timestamp: now.toISOString(),
            aircraft: Array.from(existingData.aircraft).sort(),
            flights: Array.from(existingData.flights).sort(),
            airlines: Array.from(existingData.airlines).sort(),
            counts: {
                aircraft: existingData.aircraft.size,
                flights: existingData.flights.size,
                airlines: existingData.airlines.size,
                positions: positionHistory.length
            }
        };
        
        const fileContent = JSON.stringify(aggregatedData);
        
        const command = new PutObjectCommand({
            Bucket: WRITE_BUCKET_NAME,
            Key: fileName,
            Body: fileContent,
            ContentType: 'application/json'
        });
        
        await s3.send(command);
        globalCache.s3Writes = (globalCache.s3Writes || 0) + 1;
        logger.info(`Saved hourly aggregated stats: ${existingData.aircraft.size} aircraft, ${existingData.flights.size} flights, ${existingData.airlines.size} airlines to ${fileName}`);
    } catch (error) {
        globalCache.s3Errors = (globalCache.s3Errors || 0) + 1;
        logger.error('Failed to save aggregated stats to S3:', error);
    }
}

async function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = await fs.promises.readFile(STATE_FILE, 'utf8');
            let state = {};
            try {
                state = JSON.parse(data);
            } catch (parseErr) {
                // Backup corrupt state file so operator can inspect it, then continue with empty state
                try {
                    const backupName = STATE_FILE + `.corrupt_${Date.now()}`;
                    await fs.promises.rename(STATE_FILE, backupName);
                    logger.warn(`Corrupt state file detected. Backed up to ${backupName}`);
                } catch (bakErr) {
                    logger.error('Failed to move corrupt state file:', bakErr);
                }
                state = {};
            }

            aircraftTracking = state.aircraftTracking || {};
            positionHistory = state.positionHistory || [];
            runningPositionCount = state.runningPositionCount || 0;
            trackerStartTime = state.trackerStartTime || Date.now();
            receiver_lat = state.receiver_lat || 0.0;
            receiver_lon = state.receiver_lon || 0.0;
            logger.info(`Dashboard state loaded. Position history: ${positionHistory.length} records`);
        }
    } catch (error) {
        logger.error('Error loading state:', error);
    }
}

async function buildHourlyPositionsFromS3() {
    try {
        // Skip S3 aggregation when using TSDB for position storage
        if (config.storage?.positions === 'tsdb') {
            logger.info('Skipping S3 hourly aggregation - using TSDB for position storage');
            return;
        }
        
        logger.info('Building hourly position aggregations from S3 minute files...');
        
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);
        
        // Build for the past 7 days if they don't exist, rebuild for the past 24 hours
        for (let hoursBack = 167; hoursBack >= 0; hoursBack--) {
            const targetTime = now - (hoursBack * 60 * 60 * 1000);
            const targetDate = new Date(targetTime);
            const year = targetDate.getUTCFullYear();
            const month = (targetDate.getUTCMonth() + 1).toString().padStart(2, '0');
            const day = targetDate.getUTCDate().toString().padStart(2, '0');
            const hour = targetDate.getUTCHours().toString().padStart(2, '0');
            
            const hourStart = new Date(Date.UTC(year, targetDate.getUTCMonth(), targetDate.getUTCDate(), targetDate.getUTCHours())).getTime();
            const hourEnd = hourStart + (60 * 60 * 1000);
            
            // Check if this hour's file already exists
            const hourlyKey = `data/hourly/positions_${year}${month}${day}_${hour}00.json`;
            let existingData = null;
            let shouldSkip = false;
            try {
                const { GetObjectCommand } = require('@aws-sdk/client-s3');
                const getCommand = new GetObjectCommand({
                    Bucket: WRITE_BUCKET_NAME,
                    Key: hourlyKey
                });
                const existingFile = await s3.send(getCommand);
                const chunks = [];
                for await (const chunk of existingFile.Body) {
                    chunks.push(chunk);
                }
                existingData = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                // For past 7 days (but older than 24 hours), skip if file exists
                // For past 24 hours, always rebuild
                shouldSkip = (hoursBack > 23) && existingData && existingData.total_positions > 0;
            } catch (err) {
                // File doesn't exist, need to build it
            }
            
            if (shouldSkip) {
                continue; // Skip if already built and not in rebuild window
            }
            
            // List all minute files for this hour from both buckets
            const writeFiles = (await listS3Files(s3, WRITE_BUCKET_NAME, 'data/piaware_aircraft_log') || []).map(f => ({ ...f, bucket: WRITE_BUCKET_NAME }));
            const readFiles = (await listS3Files(s3, BUCKET_NAME, 'data/piaware_aircraft_log') || []).map(f => ({ ...f, bucket: BUCKET_NAME }));
            const allS3Files = [...writeFiles, ...readFiles];
            const hourMinuteFiles = allS3Files
                .filter(f => f.Key && f.Key.includes('piaware_aircraft_log'))
                .filter(f => {
                    const fileTime = new Date(f.LastModified).getTime();
                    return fileTime >= hourStart && fileTime < hourEnd;
                })
                .sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified)); // Sort by time
            
            if (hourMinuteFiles.length === 0) {
                logger.debug(`No minute files found for hour ${year}${month}${day}_${hour}00 to aggregate`);
                continue;
            }
            
            // Aggregate positions from all minute files in this hour
            const hourlyAggregation = {
                hour_start: new Date(hourStart).toISOString(),
                hour_end: new Date(hourEnd).toISOString(),
                total_positions: 0,
                unique_aircraft: new Set(),
                unique_callsigns: new Set(),
                airlines: {},
                positions: []
            };
            
            // Use a Map to deduplicate positions by hex + timestamp
            const positionMap = new Map();
            
            for (const file of hourMinuteFiles) {
                try {
                    const recs = await downloadAndParseS3File(s3, file.bucket, file.Key);
                    for (const r of recs || []) {
                        const hex = (r.hex || r.ICAO || r.icao || '').toString().toLowerCase();
                        const lat = r.lat || r.Latitude || r.latitude;
                        const lon = r.lon || r.Longitude || r.longitude;
                        
                        if (!hex || lat == null || lon == null) continue;
                        
                        const timestamp = r.Last_Seen || r.LastSeen || r.last_seen || new Date(file.LastModified).getTime();
                        const key = `${hex}_${timestamp}`;
                        
                        if (!positionMap.has(key)) {
                            positionMap.set(key, {
                                hex,
                                callsign: (r.flight || r.Ident || r.ident || '').toString().trim(),
                                lat: parseFloat(lat),
                                lon: parseFloat(lon),
                                alt: r.alt_baro || r.Altitude_ft || r.altitude || null,
                                gs: r.gs || r.Speed_kt || null,
                                timestamp
                            });
                        }
                    }
                } catch (err) {
                    logger.warn(`Failed to process ${file.Key} for hourly aggregation:`, err.message);
                }
            }
            
            // Now populate the aggregation from the deduplicated positions
            for (const pos of positionMap.values()) {
                hourlyAggregation.total_positions++;
                hourlyAggregation.unique_aircraft.add(pos.hex);
                
                if (pos.callsign) {
                    hourlyAggregation.unique_callsigns.add(pos.callsign);
                    const airlineCode = pos.callsign.startsWith('N') ? null : pos.callsign.substring(0, 3).toUpperCase();
                    if (!hourlyAggregation.airlines[airlineCode]) {
                        hourlyAggregation.airlines[airlineCode] = 0;
                    }
                    hourlyAggregation.airlines[airlineCode]++;
                }
                
                // Store position data
                hourlyAggregation.positions.push(pos);
            }
            
            // Convert sets to counts
            const summary = {
                hour_start: hourlyAggregation.hour_start,
                hour_end: hourlyAggregation.hour_end,
                total_positions: hourlyAggregation.total_positions,
                unique_aircraft: hourlyAggregation.unique_aircraft.size,
                unique_callsigns: hourlyAggregation.unique_callsigns.size,
                airlines: hourlyAggregation.airlines,
                positions: hourlyAggregation.positions
            };
            
            // Get previous count for logging
            let previousPositionCount = 0;
            let previousAircraftCount = 0;
            if (existingData) {
                previousPositionCount = existingData.total_positions || 0;
                previousAircraftCount = existingData.unique_aircraft || 0;
            }
            
            // Save to S3
            if (summary.total_positions > 0) {
                try {
                    const command = new PutObjectCommand({
                        Bucket: WRITE_BUCKET_NAME,
                        Key: hourlyKey,
                        Body: JSON.stringify(summary, null, 2),
                        ContentType: 'application/json'
                    });
                    await s3.send(command);
                    globalCache.s3Writes = (globalCache.s3Writes || 0) + 1;
                    globalCache.lastWrite = Date.now();
                    
                    if (previousPositionCount > 0) {
                        logger.info(`Saved hourly position file: ${hourlyKey} (${summary.total_positions} positions, ${summary.unique_aircraft} aircraft) [was: ${previousPositionCount} positions, ${previousAircraftCount} aircraft]`);
                    } else {
                        logger.info(`Saved hourly position file: ${hourlyKey} (${summary.total_positions} positions, ${summary.unique_aircraft} aircraft)`);
                    }
                } catch (err) {
                    logger.error(`Failed to save hourly position file ${hourlyKey}:`, err);
                }
            }
        }
        
    } catch (error) {
        logger.error('Error building hourly positions from S3:', error);
    }
}

async function buildFlightsFromS3() {
    try {
        logger.info('Building flights from S3 minute files...');
        
        const now = Date.now();
        const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
        
        // List ALL minute files and filter by record timestamps (not file modification time)
        // This is critical - files may have old modification times but contain recent data
        const s3Files = await listS3Files(s3, WRITE_BUCKET_NAME, 'data/piaware_aircraft_log'); // Use prefix, but fetch ALL pages
        globalCache.s3Reads = (globalCache.s3Reads || 0) + 1;
        globalCache.lastRead = Date.now();
        logger.info(`[buildFlights] Listed ${(s3Files || []).length} total files in ${WRITE_BUCKET_NAME}`);
        
        const allMinuteFiles = (s3Files || [])
            .filter(f => f.Key && f.Key.includes('piaware_aircraft_log'))
            .sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified));
        
        logger.info(`[buildFlights] Found ${allMinuteFiles.length} minute files matching pattern 'piaware_aircraft_log'`);
        
        if (allMinuteFiles.length === 0) {
            logger.info('No minute files found for flight building');
            // Log first few file names to debug
            const sampleFiles = (s3Files || []).slice(0, 5).map(f => f.Key);
            logger.info(`[buildFlights] Sample files in bucket: ${sampleFiles.join(', ')}`);
            return;
        }
        
        logger.info(`Found ${allMinuteFiles.length} minute files total, loading all to process`);
        
        // Load records from all files
        const allRecords = [];
        for (const file of allMinuteFiles) {
            try {
                const recs = await downloadAndParseS3File(s3, WRITE_BUCKET_NAME, file.Key);
                globalCache.s3Reads = (globalCache.s3Reads || 0) + 1;
                globalCache.lastRead = Date.now();
                for (const r of recs || []) {
                    const hex = (r.hex || r.ICAO || r.icao || '').toString().toLowerCase();
                    const lat = r.lat || r.Latitude || r.latitude;
                    const lon = r.lon || r.Longitude || r.longitude;
                    
                    if (!hex || lat == null || lon == null) continue;
                    
                    // Parse timestamp from record
                    const tsCandidate = r.Last_Seen || r.LastSeen || r.last_seen || r.seen || r.seen_time;
                    let ts = new Date(file.LastModified).getTime();
                    if (typeof tsCandidate === 'number') {
                        ts = tsCandidate > 9999999999 ? tsCandidate : tsCandidate * 1000;
                    } else if (typeof tsCandidate === 'string') {
                        const parsed = new Date(tsCandidate).getTime();
                        if (!isNaN(parsed)) ts = parsed;
                    }
                    
                    // Only include records from last 24 hours
                    if (ts < twentyFourHoursAgo) continue;
                    
                    allRecords.push({
                        hex,
                        ident: (r.flight || r.Ident || r.ident || '').toString().trim(),
                        registration: (r.Registration || r.r || r.registration || r.Reg || '').toString().trim(),
                        airline: (r.Airline || '').toString().trim(),
                        type: (r.aircraft_type || r.t || r.type || r.Type || '').toString().trim(),
                        ts,
                        lat: parseFloat(lat),
                        lon: parseFloat(lon),
                        alt: r.alt_baro || r.Altitude_ft || r.altitude || null,
                        spd: r.gs || r.Speed_kt || null
                    });
                }
            } catch (err) {
                logger.warn(`Failed to process ${file.Key} for flight building:`, err.message);
            }
        }
        
        logger.info(`Loaded ${allRecords.length} position records from ${allMinuteFiles.length} S3 files`);
        
        if (allRecords.length === 0) return;
        
        // Group by ICAO and build flights
        const byIcao = {};
        for (const r of allRecords) {
            if (!byIcao[r.hex]) byIcao[r.hex] = [];
            byIcao[r.hex].push(r);
        }
        
        const GAP_MS = 5 * 60 * 1000; // 5 minutes
        const MIN_DURATION_MS = 0.5 * 60 * 1000; // 0.5 minutes
        const flights = [];
        const activeFlights = [];
        
        for (const hex in byIcao) {
            const recs = byIcao[hex].sort((a, b) => a.ts - b.ts);
            let currentFlight = [];
            
            for (const r of recs) {
                if (currentFlight.length === 0) {
                    currentFlight.push(r);
                    continue;
                }
                
                const prev = currentFlight[currentFlight.length - 1];
                const delta = r.ts - prev.ts;
                
                if (delta > GAP_MS) {
                    // Finalize previous flight
                    const flight = summarizeFlightData(currentFlight);
                    if (flight && (flight.end_ts - flight.start_ts) >= MIN_DURATION_MS) {
                        if (now - flight.end_ts <= GAP_MS) {
                            activeFlights.push(flight);
                        } else {
                            flights.push(flight);
                        }
                    }
                    currentFlight = [r];
                } else {
                    currentFlight.push(r);
                }
            }
            
            // Finalize last flight
            if (currentFlight.length > 0) {
                const flight = summarizeFlightData(currentFlight);
                if (flight && (flight.end_ts - flight.start_ts) >= MIN_DURATION_MS) {
                    if (now - flight.end_ts <= GAP_MS) {
                        activeFlights.push(flight);
                    } else {
                        flights.push(flight);
                    }
                }
            }
        }
        
        // Enrich with airline data
        const airlineDb = await getAirlineDatabase(s3, BUCKET_NAME);
        for (const fl of [...flights, ...activeFlights]) {
            const airlineCode = fl.callsign.startsWith('N') ? null : fl.callsign.substring(0, 3).toUpperCase();
            fl.airline_code = airlineCode;
            fl.airline_name = (airlineDb && airlineDb[airlineCode]) ? (airlineDb[airlineCode].name || airlineDb[airlineCode]) : null;
            // Enrich each flight with manufacturer and body type using the types DB
            try {
                const typeInfo = aircraftTypesDB.lookup(fl.type);
                if (typeInfo) {
                    fl.manufacturer = typeInfo.manufacturer;
                    fl.bodyType = typeInfo.bodyType;
                    if (!fl.aircraft_model) {
                        fl.aircraft_model = typeInfo.model;
                    }
                }
            } catch (err) {
                // continue if type DB not available
            }
        }
        
        // Save hourly files for each hour represented in the flights
        // This ensures flights from historical data are persisted properly
        const flightsByHour = {};
        
        for (const fl of [...flights, ...activeFlights]) {
            const flightDate = new Date(fl.start_ts);
            const flYear = flightDate.getUTCFullYear();
            const flMonth = (flightDate.getUTCMonth() + 1).toString().padStart(2, '0');
            const flDay = flightDate.getUTCDate().toString().padStart(2, '0');
            const flHour = flightDate.getUTCHours().toString().padStart(2, '0');
            const hourlyKey = `flights/hourly/flights_${flYear}${flMonth}${flDay}_${flHour}00.json`;
            
            if (!flightsByHour[hourlyKey]) flightsByHour[hourlyKey] = [];
            flightsByHour[hourlyKey].push(fl);
        }
        
        // Save each hour's flights
        for (const [hourlyKey, hourlyFlights] of Object.entries(flightsByHour)) {
            if (hourlyFlights.length > 0) {
                await saveFlightsToS3(hourlyFlights, hourlyKey);
                logger.info(`Saved ${hourlyFlights.length} flights to hourly file: ${hourlyKey}`);
            }
        }
        
        // Check if we need to write daily file (once per day at hour rollover)
        const nowDate = new Date();
        const year = nowDate.getUTCFullYear();
        const month = (nowDate.getUTCMonth() + 1).toString().padStart(2, '0');
        const day = nowDate.getUTCDate().toString().padStart(2, '0');
        
        const lastDailyFile = path.join(__dirname, '.last-daily-flight-build');
        const todayDateStr = `${year}${month}${day}`;
        let shouldBuildDaily = false;
        
        try {
            if (fs.existsSync(lastDailyFile)) {
                const lastDate = await fs.promises.readFile(lastDailyFile, 'utf8');
                shouldBuildDaily = lastDate.trim() !== todayDateStr;
            } else {
                shouldBuildDaily = true;
            }
        } catch (err) {
            shouldBuildDaily = true;
        }
        
        if (shouldBuildDaily) {
            // Build daily file for yesterday (complete day)
            const now = Date.now();
            const yesterday = new Date(now - (24 * 60 * 60 * 1000));
            const yYear = yesterday.getUTCFullYear();
            const yMonth = (yesterday.getUTCMonth() + 1).toString().padStart(2, '0');
            const yDay = yesterday.getUTCDate().toString().padStart(2, '0');
            
            const dayStart = new Date(Date.UTC(yYear, yesterday.getUTCMonth(), yesterday.getUTCDate(), 0)).getTime();
            const dayEnd = dayStart + (24 * 60 * 60 * 1000);
            
            const dailyFlights = [...flights, ...activeFlights].filter(fl => {
                return fl.start_ts >= dayStart && fl.start_ts < dayEnd;
            });
            
            if (dailyFlights.length > 0) {
                const dailyKey = `flights/daily/flights_${yYear}${yMonth}${yDay}.json`;
                await saveFlightsToS3(dailyFlights, dailyKey);
                logger.info(`Saved ${dailyFlights.length} flights to daily file: ${dailyKey}`);
            }
            
            await fs.promises.writeFile(lastDailyFile, todayDateStr, 'utf8');
        }
        
        // Save to local CSV files (backward compatibility)
        const completedPath = path.join(__dirname, 'flights.csv');
        const activePath = path.join(__dirname, 'active_flights.csv');
        
        await writeFlightsCSV(flights, completedPath);
        await writeFlightsCSV(activeFlights, activePath);
        
        logger.info(`Built ${flights.length} completed flights, ${activeFlights.length} active flights`);
        
    } catch (error) {
        logger.error('Error building flights from S3:', error);
    }
}

function summarizeFlightData(recs) {
    if (!recs || recs.length === 0) return null;

    const start = recs[0];
    const end = recs[recs.length - 1];
    const maxAlt = recs.map(r => r.alt).filter(a => a != null).reduce((m, v) => Math.max(m, v), null);
    const maxSpd = recs.map(r => r.spd).filter(s => s != null).reduce((m, v) => Math.max(m, v), null);

    // Helper to find the most common non-empty value in an array
    const mostCommon = (arr) => {
        if (!arr.length) return '';
        const counts = arr.reduce((acc, val) => {
            acc[val] = (acc[val] || 0) + 1;
            return acc;
        }, {});
        return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
    };

    const callsign = mostCommon(recs.map(r => r.ident).filter(Boolean));
    
    // Lookup aircraft in OpenSky database for registration and type
    const aircraftData = aircraftDB.lookup(start.hex);
    
    const registration = mostCommon(recs.map(r => r.registration).filter(Boolean)) 
        || aircraftData?.registration 
        || registration_from_hexid(start.hex) 
        || 'N/A';
    
    const airline = mostCommon(recs.map(r => r.airline).filter(Boolean));
    
    const type = mostCommon(recs.map(r => r.type).filter(Boolean)) 
        || aircraftData?.typecode 
        || 'N/A';
    const typeInfo = aircraftTypesDB.lookup(type);
    const manufacturer = typeInfo?.manufacturer || null;
    const bodyType = typeInfo?.bodyType || null;
    const fullModel = typeInfo?.model || aircraftData?.model || null;

    // Find a distinct end position if we have multiple records with different coordinates
    let endForCoords = end;
    if (recs.length > 1) {
        for (let i = recs.length - 1; i >= 0; i--) {
            if (recs[i].lat !== start.lat || recs[i].lon !== start.lon) {
                endForCoords = recs[i];
                break;
            }
        }
    }
    
    // Compute slant range from receiver to start/end positions
    let slant_start = null, slant_end = null;
    if (receiver_lat && receiver_lon && start.lat && start.lon && start.alt) {
        const horiz_start = calculate_distance(receiver_lat, receiver_lon, start.lat, start.lon);
        slant_start = calculate_slant_distance(horiz_start, start.alt);
    }
    if (receiver_lat && receiver_lon && endForCoords.lat && endForCoords.lon && endForCoords.alt) {
        const horiz_end = calculate_distance(receiver_lat, receiver_lon, endForCoords.lat, endForCoords.lon);
        slant_end = calculate_slant_distance(horiz_end, endForCoords.alt);
    }
    return {
        icao: start.hex,
        callsign,
        registration,
        airline,
        type,
        start_time: new Date(start.ts).toISOString(),
        end_time: new Date(end.ts).toISOString(),
        start_ts: start.ts,
        end_ts: end.ts,
        start_lat: start.lat,
        start_lon: start.lon,
        end_lat: endForCoords.lat,
        end_lon: endForCoords.lon,
        max_alt_ft: maxAlt,
        max_speed_kt: maxSpd,
        reports: recs.length,
        slant_range_start: slant_start,
        slant_range_end: slant_end,
        aircraft_model: fullModel || null,
        manufacturer: manufacturer,
        bodyType: bodyType
    };
}

async function writeFlightsCSV(flights, filePath) {
    const headers = ['ICAO', 'Callsign', 'Registration', 'Start_Time', 'End_Time', 'Duration_min', 
                     'Start_Lat', 'Start_Lon', 'End_Lat', 'End_Lon', 'Max_Alt_ft', 'Max_Speed_kt', 'Reports', 
                     'Airline_Code', 'Airline_Name', 'Manufacturer', 'BodyType'];
    
    const rows = flights.map(fl => {
        const duration = ((fl.end_ts - fl.start_ts) / 60000).toFixed(2);
        return [
            fl.icao,
            fl.callsign,
            fl.registration,
            fl.start_time,
            fl.end_time,
            duration,
            fl.start_lat,
            fl.start_lon,
            fl.end_lat,
            fl.end_lon,
            fl.max_alt_ft || '',
            fl.max_speed_kt || '',
            fl.reports,
            fl.airline_code || '',
            fl.airline_name || '',
            fl.manufacturer || '',
            fl.bodyType || ''
        ].join(',');
    });
    
    const csv = [headers.join(','), ...rows].join('\n');
    await fs.promises.writeFile(filePath, csv, 'utf8');
}

async function saveFlightsToS3(flights, key) {
    try {
        const flightsData = flights.map(fl => ({
            icao: fl.icao,
            callsign: fl.callsign,
            registration: fl.registration,
            type: fl.type,
            start_time: fl.start_time,
            end_time: fl.end_time,
            duration_min: ((fl.end_ts - fl.start_ts) / 60000).toFixed(2),
            start_lat: fl.start_lat,
            start_lon: fl.start_lon,
            end_lat: fl.end_lat,
            end_lon: fl.end_lon,
            max_alt_ft: fl.max_alt_ft,
            max_speed_kt: fl.max_speed_kt,
            reports: fl.reports,
            airline_code: fl.airline_code,
            airline_name: fl.airline_name,
            manufacturer: fl.manufacturer || null,
            aircraft_model: fl.aircraft_model || null,
            bodyType: fl.bodyType || null,
            slant_range_start: fl.slant_range_start !== undefined ? fl.slant_range_start : null,
            slant_range_end: fl.slant_range_end !== undefined ? fl.slant_range_end : null
        }));
        
        const command = new PutObjectCommand({
            Bucket: WRITE_BUCKET_NAME,
            Key: key,
            Body: JSON.stringify(flightsData, null, 2),
            ContentType: 'application/json'
        });
        
        await s3.send(command);
        globalCache.s3Writes = (globalCache.s3Writes || 0) + 1;
        globalCache.lastWrite = Date.now();
        logger.info(`✓ Saved ${flights.length} flights to S3: ${WRITE_BUCKET_NAME}/${key}`);
    } catch (error) {
        globalCache.s3Errors = (globalCache.s3Errors || 0) + 1;
        logger.error(`Failed to save flights to S3 key ${key}:`, error.message);
    }
}


// --- Helper Functions ---
function updateActiveFlights(now) {
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
            end_time: new Date(now).toISOString(),
            start_ts: aircraft.firstSeen,
            end_ts: now,
            start_lat: aircraft.lat,
            start_lon: aircraft.lon,
            end_lat: aircraft.lat,
            end_lon: aircraft.lon,
            max_alt_ft: aircraft.alt_baro,
            max_speed_kt: aircraft.gs,
            reports: 1,
            airline_code: aircraft.flight.substring(0, 3).toUpperCase(),
            airline_name: aircraft.airline || '',
            slant_range_start,
            slant_range_end
        };
    }
    
    activeFlights = newActiveFlights;
}

// --- Visualization Functions ---
function calculate_slant_distance(horizontal_dist, altitude_ft) {
    // Convert altitude to feet, then to nautical miles for consistency
    const alt_nm = altitude_ft / 6076.12; // feet to nautical miles
    return Math.sqrt(horizontal_dist ** 2 + alt_nm ** 2);
}

function calculate_bearing(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => deg * Math.PI / 180;
    const toDeg = (rad) => rad * 180 / Math.PI;
    
    const lat1_rad = toRad(lat1);
    const lat2_rad = toRad(lat2);
    const delta_lon = toRad(lon2 - lon1);
    
    const x = Math.sin(delta_lon) * Math.cos(lat2_rad);
    const y = Math.cos(lat1_rad) * Math.sin(lat2_rad) - Math.sin(lat1_rad) * Math.cos(lat2_rad) * Math.cos(delta_lon);
    
    const bearing_rad = Math.atan2(x, y);
    return (toDeg(bearing_rad) + 360) % 360; // Normalize to 0-360
}

// Sector-based altitude tracking for reception range
let sectorAltitudeRecords = {}; // {sector: {maxRange: number, maxAlt: number, count: number, lastSeen: timestamp}}

function updateSectorAltitudeRecords(aircraft, slantDist, bearing) {
    const sector = Math.floor(bearing / 10) * 10; // 10-degree sectors
    const alt = aircraft.alt_baro || 0;
    
    if (!sectorAltitudeRecords[sector]) {
        sectorAltitudeRecords[sector] = {
            maxRange: 0,
            maxAlt: 0,
            count: 0,
            lastSeen: Date.now()
        };
    }
    
    const record = sectorAltitudeRecords[sector];
    if (slantDist > record.maxRange) {
        record.maxRange = slantDist;
    }
    if (alt > record.maxAlt) {
        record.maxAlt = alt;
    }
    record.count++;
    record.lastSeen = Date.now();
}

function generateKML(positions) {
    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Aircraft Tracks</name>
    <description>Real-time aircraft position tracks</description>
    
    <Style id="aircraftTrack">
      <LineStyle>
        <color>ff0000ff</color>
        <width>2</width>
      </LineStyle>
      <PolyStyle>
        <color>7f0000ff</color>
      </PolyStyle>
    </Style>
    
    <Style id="aircraftPoint">
      <IconStyle>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/shapes/airports.png</href>
        </Icon>
      </IconStyle>
    </Style>
`;

    // Group positions by aircraft
    const aircraftTracks = {};
    positions.forEach(pos => {
        if (!aircraftTracks[pos.hex]) {
            aircraftTracks[pos.hex] = {
                callsign: pos.flight || pos.hex,
                positions: []
            };
        }
        aircraftTracks[pos.hex].positions.push(pos);
    });

    // Create tracks for each aircraft
    Object.values(aircraftTracks).forEach(track => {
        if (track.positions.length < 2) return; // Need at least 2 points for a track
        
        // Sort by timestamp
        track.positions.sort((a, b) => a.timestamp - b.timestamp);
        
        // Create placemark for the track
        kml += `
    <Placemark>
      <name>${track.callsign}</name>
      <description>Aircraft track for ${track.callsign}</description>
      <styleUrl>#aircraftTrack</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>`;
        
        track.positions.forEach(pos => {
            kml += `${pos.lon},${pos.lat},${pos.alt || 0} `;
        });
        
        kml += `</coordinates>
      </LineString>
    </Placemark>`;
        
        // Add current position point
        const currentPos = track.positions[track.positions.length - 1];
        kml += `
    <Placemark>
      <name>${track.callsign} (current)</name>
      <styleUrl>#aircraftPoint</styleUrl>
      <Point>
        <coordinates>${currentPos.lon},${currentPos.lat},${currentPos.alt || 0}</coordinates>
      </Point>
    </Placemark>`;
    });

    kml += `
  </Document>
</kml>`;
    
    return kml;
}

function generateHeatmapData(positions, gridSize = 0.01) {
    const grid = {};
    let maxCount = 0;
    
    positions.forEach(pos => {
        if (!pos.lat || !pos.lon) return;
        
        // Skip positions at or very close to 0,0 (invalid data)
        if (Math.abs(pos.lat) < 0.01 && Math.abs(pos.lon) < 0.01) return;
        
        const latKey = Math.floor(pos.lat / gridSize) * gridSize;
        const lonKey = Math.floor(pos.lon / gridSize) * gridSize;
        const key = `${latKey},${lonKey}`;
        
        if (!grid[key]) {
            grid[key] = {
                lat: latKey + gridSize / 2,
                lon: lonKey + gridSize / 2,
                count: 0,
                maxAlt: 0,
                minAlt: Infinity
            };
        }
        
        grid[key].count++;
        if (pos.alt > grid[key].maxAlt) grid[key].maxAlt = pos.alt;
        if (pos.alt < grid[key].minAlt) grid[key].minAlt = pos.alt;
        
        if (grid[key].count > maxCount) maxCount = grid[key].count;
    });
    
    const heatmap = Object.values(grid).map(cell => ({
        lat: cell.lat,
        lon: cell.lon,
        count: cell.count,
        intensity: cell.count / maxCount,
        maxAlt: cell.maxAlt,
        minAlt: cell.minAlt === Infinity ? 0 : cell.minAlt
    }));
    
    return {
        grid: heatmap,
        maxCount: maxCount,
        gridSize: gridSize,
        totalPositions: positions.length
    };
}

function toNumeric(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function hasValidPosition(record) {
    return record && Number.isFinite(record.lat) && Number.isFinite(record.lon);
}

function shouldUseReceiverSample(existing, candidate) {
    if (!existing) return true;
    const candidateHasPos = hasValidPosition(candidate);
    const existingHasPos = hasValidPosition(existing);

    if (candidateHasPos && !existingHasPos) return true;
    if (!candidateHasPos && existingHasPos) return false;

    const existingRssi = toNumeric(existing.rssi);
    const candidateRssi = toNumeric(candidate.rssi);

    if (candidateRssi != null && existingRssi != null) {
        if (candidateRssi === existingRssi) {
            return (candidate.receiver_timestamp || 0) > (existing.receiver_timestamp || 0);
        }
        return candidateRssi > existingRssi;
    }

    if (candidateRssi != null && existingRssi == null) return true;
    if (candidateRssi == null && existingRssi != null) return false;

    return (candidate.receiver_timestamp || 0) > (existing.receiver_timestamp || 0);
}

// --- Core Logic ---
const fetchData = async () => {
    if (!isPrimaryWorker) {
        return; // Only primary worker should fetch data
    }
    console.log(`[${new Date().toISOString()}] [fetchData] Starting fetchData`);
    try {
        // Fetch from all PiAware receivers using a single sequential connection per receiver
        const fetch = (await import('node-fetch')).default;

        const [receiverPayloads, airlineDb, typesDb] = await Promise.all([
            Promise.all(PIAWARE_URLS.map(url => fetchPiAwareReceiverPair(fetch, url))),
            getAirlineDatabase(s3, BUCKET_NAME),
            getAircraftTypesDatabase(s3, BUCKET_NAME)
        ]);

        const currentResponses = receiverPayloads.map(result => ({ url: result.url, data: result.currentData }));
        const historyResponses = receiverPayloads.map(result => ({ url: result.url, data: result.historyData }));

        // Log latest position datetime from each PiAware receiver
        for (const response of currentResponses) {
            const receiverId = PIAWARE_RECEIVER_IDS.get(response.url) || DEFAULT_RECEIVER_ID;
            const latestTimestamp = response.data.now ? new Date(response.data.now * 1000).toISOString() : 'N/A';
            const aircraftCount = (response.data.aircraft || []).length;
            console.log(`[${new Date().toISOString()}] [PiAware] ${receiverId} (${response.url}): ${aircraftCount} aircraft, latest position: ${latestTimestamp}`);
        }

        if (!airlineDb || typeof airlineDb !== 'object' || !typesDb || typeof typesDb !== 'object') {
            // Skip data enrichment when databases are not available
        }

        // Aggregate aircraft data from all receivers (current only)
        const aircraftMap = new Map(); // Use Map to deduplicate by hex code
        
        // Process current data first
        for (const response of currentResponses) {
            const aircraftList = response.data.aircraft || [];
            const receiverId = PIAWARE_RECEIVER_IDS.get(response.url) || DEFAULT_RECEIVER_ID;
            const receiverTimestamp = response.data.now * 1000; // Convert to milliseconds
            for (const aircraft of aircraftList) {
                if (!aircraft.hex) continue;

                const hexNorm = aircraft.hex.toString().toLowerCase();
                const latValue = toNumeric(aircraft.lat);
                const lonValue = toNumeric(aircraft.lon);
                if (latValue !== null) aircraft.lat = latValue;
                if (lonValue !== null) aircraft.lon = lonValue;
                const rssiValue = toNumeric(aircraft.rssi);
                if (rssiValue !== null) aircraft.rssi = rssiValue;

                const candidate = {
                    ...aircraft,
                    hex: hexNorm,
                    dataSource: 'current',
                    receiver_id: receiverId,
                    receiver_timestamp: receiverTimestamp
                };

                const existing = aircraftMap.get(hexNorm);
                if (!existing) {
                    aircraftMap.set(hexNorm, candidate);
                    continue;
                }

                if (shouldUseReceiverSample(existing, candidate)) {
                    aircraftMap.set(hexNorm, { ...existing, ...candidate });
                } else {
                    // Merge select metadata even if we keep the existing positional sample
                    if ((!existing.flight || existing.flight === 'N/A') && candidate.flight) existing.flight = candidate.flight;
                    if ((!existing.squawk || existing.squawk === 'N/A') && candidate.squawk) existing.squawk = candidate.squawk;
                    if ((!existing.registration || existing.registration === 'N/A') && candidate.registration) existing.registration = candidate.registration;
                    if ((existing.rssi === undefined || existing.rssi === null) && candidate.rssi !== undefined && candidate.rssi !== null) {
                        existing.rssi = candidate.rssi;
                    }
                    aircraftMap.set(hexNorm, existing);
                }
            }
        }
        
        // Apply historical data to any aircraft we already have so fields such as callsign/squawk/registration stay filled
        for (const response of historyResponses) {
            const aircraftList = response.data.aircraft || [];
            for (const aircraft of aircraftList) {
                if (!aircraft.hex) continue;
                // Normalize hex to lowercase so history matches current records
                const hexNorm = aircraft.hex.toString().toLowerCase();
                aircraft.hex = hexNorm;
                const existing = aircraftMap.get(hexNorm);
                if (!existing) continue;

                const merged = { ...existing };
                if ((!merged.flight || merged.flight === 'N/A') && aircraft.flight) {
                    merged.flight = aircraft.flight;
                }
                if ((!merged.squawk || merged.squawk === 'N/A') && aircraft.squawk) {
                    merged.squawk = aircraft.squawk;
                }
                const historyRegistration = aircraft.registration || aircraft.r;
                if ((!merged.registration || merged.registration === 'N/A') && historyRegistration) {
                    merged.registration = historyRegistration;
                }
                if (!merged.aircraft_type || merged.aircraft_type === 'N/A') {
                    merged.aircraft_type = aircraft.t || merged.aircraft_type;
                }
                if (!merged.manufacturer && aircraft.manufacturer) {
                    merged.manufacturer = aircraft.manufacturer;
                }
                if (!merged.manufacturerLogo && aircraft.manufacturerLogo) {
                    merged.manufacturerLogo = aircraft.manufacturerLogo;
                }
                if (!merged.flight && aircraft.flight) {
                    merged.flight = aircraft.flight;
                }
                aircraftMap.set(aircraft.hex, merged);
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
                const airlineCode = flight.substring(0, 3);
                
                // Lookup aircraft in OpenSky database
                const aircraftData = aircraftDB.lookup(aircraft.hex);
                
                // Use OpenSky data as primary source, fall back to old methods
                const registration = aircraftData?.registration 
                    || aircraft.r 
                    || registration_from_hexid(aircraft.hex) 
                    || 'N/A';
                
                const aircraft_type = aircraftData?.typecode 
                    || aircraft.t 
                    || 'N/A';
                
                const aircraft_model = aircraftData?.model || null;
                
                // Lookup type information (manufacturer, body type)
                const typeInfo = aircraftTypesDB.lookup(aircraft_type);
                const manufacturer = typeInfo?.manufacturer || 'N/A';
                const bodyType = typeInfo?.bodyType || 'N/A';
                const manufacturerLogo = typeInfo?.manufacturerLogo || 
                    (manufacturer && manufacturer !== 'N/A' ? `/api/v2logos/${encodeURIComponent(manufacturer)}` : null);
                
                // Create full model name
                const fullModel = aircraft_model || typeInfo?.model || 'N/A';
                
                // Lookup airline information
                let airlineLogo = null;
                if (airlineCode && airlineDb[airlineCode]) {
                    const airlineData = airlineDb[airlineCode];
                    airlineLogo = typeof airlineData === 'string' ? null : airlineData.logo;
                }

                // Update aircraft with enriched data
                aircraft.flight = flight;
                aircraft.airline = (airlineDb[airlineCode]?.name || airlineDb[airlineCode]) || null;
                aircraft.registration = registration;
                aircraft.aircraft_type = aircraft_type;
                aircraft.aircraft_model = fullModel;
                aircraft.manufacturer = manufacturer;
                aircraft.bodyType = bodyType;
                aircraft.manufacturerLogo = manufacturerLogo;
                aircraft.airlineLogo = airlineLogo;
                if (Number.isFinite(aircraft.lat) && Number.isFinite(aircraft.lon) && receiver_lat !== 0.0 && receiver_lon !== 0.0) {
                    const distanceNm = calculate_distance(receiver_lat, receiver_lon, aircraft.lat, aircraft.lon);
                    aircraft.distance = Number.isFinite(distanceNm) ? Math.round(distanceNm * 10) / 10 : null;
                } else {
                    aircraft.distance = null;
                }
            }
        }

        const now = Date.now();

        // Collect positions for TSDB write
        const positionsForTSDB = [];
        const socketPositions = [];

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
                    timestamp: ac.receiver_timestamp - (ac.seen_pos ? ac.seen_pos * 1000 : ac.seen ? ac.seen * 1000 : 0),
                    registration: ac.registration,
                    aircraft_type: ac.aircraft_type,
                    airline: ac.airline,
                    squawk: ac.squawk,
                    rssi: ac.rssi,
                    receiver_id: ac.receiver_id || DEFAULT_RECEIVER_ID
                };
                positionHistory.push(position);

                // Prepare enriched payload for websocket consumers
                socketPositions.push({
                    ...position,
                    vert_rate: ac.vert_rate ?? ac.baro_rate ?? null,
                    distance: typeof ac.distance === 'number' ? ac.distance : null,
                    bodyType: ac.bodyType || null,
                    aircraft_model: ac.aircraft_model || null,
                    manufacturer: ac.manufacturer || null,
                    manufacturerLogo: ac.manufacturerLogo || null,
                    airlineLogo: ac.airlineLogo || null,
                    dataSource: ac.dataSource || 'current'
                });
                
                // Store position based on configured storage backend
                const storageMode = config.storage?.positions || 's3';
                
                // Always add to position cache for track API access
                positionCache.addPosition(position);
                
                if (storageMode === 's3') {
                    // Add to position cache for S3 long-term storage (already done above)
                } else if (storageMode === 'tsdb') {
                    // Collect for TSDB write
                    positionsForTSDB.push(position);
                }
                
                // Track squawk code changes
                if (ac.squawk) {
                    if (lastSquawkSeen[ac.hex] && lastSquawkSeen[ac.hex] !== ac.squawk) {
                        squawkTransitions.push({
                            hex: ac.hex,
                            flight: ac.flight || '',
                            from: lastSquawkSeen[ac.hex],
                            to: ac.squawk,
                            timestamp: now
                        });
                    }
                    lastSquawkSeen[ac.hex] = ac.squawk;
                }
                
                if (!aircraftTracking[ac.hex]) {
                    // New aircraft, add firstSeen timestamp
                    aircraftTracking[ac.hex] = { ...ac, firstSeen: now, lastSeen: now };
                    runningPositionCount++;
                } else {
                    // Existing aircraft, preserve firstSeen and update lastSeen
                    aircraftTracking[ac.hex] = { ...ac, firstSeen: aircraftTracking[ac.hex].firstSeen, lastSeen: now };
                }
            }
        });

        // Update active flights based on current aircraft
        updateActiveFlights(now);
        
        // Cleanup old aircraft from active tracking (1 minute window)
        for (const hex in aircraftTracking) {
            if (now - aircraftTracking[hex].lastSeen > 60000) { // 1 minute timeout
                delete aircraftTracking[hex];
            }
        }
        
        // Cleanup old positions from history (24 hour window)
        const cutoffTime = now - POSITION_RETENTION_MS;
        positionHistory = positionHistory.filter(pos => pos.timestamp > cutoffTime);
        
        // Cleanup old squawk transitions (keep last 7 days)
        const squawkCutoff = now - (7 * 24 * 60 * 60 * 1000);
        squawkTransitions = squawkTransitions.filter(t => t.timestamp > squawkCutoff);

        // Calculate RSSI/Range stats
        let maxRssi = null, minRssi = null, maxRange = null, minRange = null;
        Object.values(aircraftTracking).forEach(ac => {
            if (typeof ac.rssi === 'number') {
                if (maxRssi === null || ac.rssi > maxRssi) maxRssi = ac.rssi;
                if (minRssi === null || ac.rssi < minRssi) minRssi = ac.rssi;
            }
            if (typeof ac.distance === 'number') {
                if (maxRange === null || ac.distance > maxRange) maxRange = ac.distance;
                if (minRange === null || ac.distance < minRange) minRange = ac.distance;
            }
        });

        // Write positions to TSDB from one process only (when TSDB storage is enabled)
        const storageMode = config.storage?.positions || 's3';
        if (storageMode === 'tsdb' && positionsForTSDB.length > 0 && fetchDataWorkerId === 1) {
            console.log(`TSDB: Processing ${positionsForTSDB.length} positions for TSDB write`);
            try {
                const lines = positionsForTSDB.map(pos => formatPositionAsLineProtocol(pos, receiver_lat, receiver_lon, pos.receiver_id || DEFAULT_RECEIVER_ID, PIAWARE_RECEIVER_VERSION)).filter(line => line !== null);
                console.log(`TSDB: Generated ${lines.length} line protocol entries`);
                if (lines.length > 0) {
                    // Write in batches of 100 to avoid request size limits
                    const batchSize = 100;
                    for (let i = 0; i < lines.length; i += batchSize) {
                        const batch = lines.slice(i, i + batchSize);
                        const written = await writeLinesToTSDB(batch);
                        if (written === 0) {
                            console.log(`TSDB: Failed to write batch of ${batch.length} records`);
                        }
                    }
                }
            } catch (error) {
                console.log(`TSDB: Write error: ${error.message}`);
            }
        } else if (storageMode === 'tsdb' && positionsForTSDB.length > 0 && fetchDataWorkerId !== 1) {
            // Skip TSDB write from non-worker-1 processes
            console.log(`TSDB: Skipping write from worker ${fetchDataWorkerId}, only worker 1 writes to TSDB`);
        } else if (storageMode === 'tsdb') {
            console.log('TSDB: No positions to write');
        }

        // Send live update to WebSocket server
        const liveData = {
            trackingCount: Object.keys(aircraftTracking).length,
            runningPositionCount,
            aircraft: liveAircraft,
            runtime: Math.floor((Date.now() - trackerStartTime) / 1000),
            maxRssi,
            minRssi,
            maxRange,
            minRange,
            receiver_lat,
            receiver_lon,
            receiverCount: PIAWARE_URLS.length,
            positions: socketPositions
        };

        // Send to WebSocket server via HTTP POST
        try {
            await websocketClient.post('/api/live-update', liveData);
        } catch (error) {
            const now = Date.now();
            if (!lastWebsocketErrorLogTs || (now - lastWebsocketErrorLogTs) > WEBSOCKET_ERROR_LOG_WINDOW_MS) {
                logger.warn('Failed to send live update to WebSocket server:', error.message);
                if (websocketErrorSuppressedCount > 0) {
                    logger.warn(`WebSocket live-update suppressed errors: ${websocketErrorSuppressedCount}`);
                    websocketErrorSuppressedCount = 0;
                }
                lastWebsocketErrorLogTs = now;
            } else {
                websocketErrorSuppressedCount += 1;
            }
        }

        // Force cleanup of any remaining HTTP connections
        setTimeout(() => {
            try {
                // Force destroy all HTTP agents to prevent connection leaks
                if (typeof http !== 'undefined' && http.globalAgent) {
                    http.globalAgent.destroy();
                }
                if (typeof https !== 'undefined' && https.globalAgent) {
                    https.globalAgent.destroy();
                }
            } catch (cleanupError) {
                logger.warn(`Connection cleanup warning: ${cleanupError.message}`);
            }
        }, 5000); // Cleanup 5 seconds after fetch completes

    } catch (error) {
        logger.error(`Fetch error: ${error.message}`);
    }
};


// --- S3 Bucket Management ---
async function ensureBucketsExist() {
    /**
     * Ensure all required S3 buckets exist, creating them if necessary.
     * This runs on server startup to prevent upload failures later.
     */
    const requiredBuckets = [
        { name: BUCKET_NAME, purpose: 'Historical read data' },
        { name: WRITE_BUCKET_NAME, purpose: 'Current write data' }
    ];
    
    logger.info('Checking S3 buckets...');
    
    for (const bucket of requiredBuckets) {
        try {
            // Try to head the bucket to check if it exists
            const headCommand = new HeadBucketCommand({ Bucket: bucket.name });
            await s3.send(headCommand);
            logger.info(`✓ Bucket exists: ${bucket.name} (${bucket.purpose})`);
        } catch (error) {
            const errorCode = error.$metadata?.httpStatusCode;
            
            if (errorCode === 404) {
                // Bucket doesn't exist, create it
                try {
                    const createCommand = new CreateBucketCommand({ Bucket: bucket.name });
                    await s3.send(createCommand);
                    logger.info(`✓ Created bucket: ${bucket.name} (${bucket.purpose})`);
                } catch (createError) {
                    logger.error(`✗ Error creating bucket ${bucket.name}: ${createError.message}`);
                    throw createError;
                }
            } else if (errorCode === 403) {
                logger.error(`✗ Permission denied accessing bucket ${bucket.name}. Check S3 credentials.`);
                throw error;
            } else {
                logger.error(`✗ Error checking bucket ${bucket.name}: ${error.message}`);
                throw error;
            }
        }
    }
    
    logger.info('All S3 buckets verified and ready');
}

// --- Initialization ---
const getInMemoryState = () => ({
    aircraftTracking,
    activeFlights,
    squawkTransitions,
    positionHistory,
    runningPositionCount,
    trackerStartTime,
    receiver_lat,
    receiver_lon,
    sectorAltitudeRecords
});

async function initialize() {
    // Set worker ID for PM2 cluster mode (0-based, so worker 1 is INSTANCE_ID 0)
    fetchDataWorkerId = parseInt(process.env.INSTANCE_ID || process.env.NODE_APP_INSTANCE || '0') + 1;
    logger.info(`Worker ID: ${fetchDataWorkerId} (PM2 INSTANCE_ID: ${process.env.INSTANCE_ID || 'N/A'})`);
    
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
    
    // Use BUCKET_NAME for read-only (historical) endpoints, WRITE_BUCKET_NAME for write endpoints
    setupApiRoutes(app, s3, BUCKET_NAME, WRITE_BUCKET_NAME, getInMemoryState, globalCache, positionCache, tsdbWriteCount, { trackCache }); // Pass positionCache for fast position lookups

    // --- 404 Handler ---
    app.use((req, res) => {
        logger.warn(`404 Not Found: ${req.method} ${req.path} from ${req.ip}`);
        res.status(404).json({ error: 'Not Found', path: req.path, method: req.method });
    });

    // --- Startup: Compare minute vs hourly file position counts in write bucket ---
    if (process.env.NODE_ENV !== 'test' && config.storage?.positions !== 'tsdb') {
        (async () => {
            try {
                const minuteFiles = await listS3Files(s3, WRITE_BUCKET_NAME, 'data/piaware_aircraft_log');
                const hourlyFiles = await listS3Files(s3, WRITE_BUCKET_NAME, 'data/hourly/positions_');
                let minuteCount = 0, hourlyCount = 0;
                for (const file of minuteFiles) {
                    try {
                        const data = await downloadAndParseS3File(s3, WRITE_BUCKET_NAME, file.Key);
                        if (Array.isArray(data)) minuteCount += data.length;
                        else if (data) minuteCount++;
                    } catch {}
                }
                for (const file of hourlyFiles) {
                    try {
                        const data = await downloadAndParseS3File(s3, WRITE_BUCKET_NAME, file.Key);
                        if (Array.isArray(data)) hourlyCount += data.length;
                        else if (data) hourlyCount++;
                    } catch {}
                }
                const logMsg = `[startup] Write bucket: Minute files ${minuteFiles.length} files, ${minuteCount} positions | Hourly files ${hourlyFiles.length} files, ${hourlyCount} positions`;
                console.log(logMsg);
                fs.appendFileSync('startup-bucket-compare.log', logMsg + '\n');
            } catch (err) {
                console.warn('[startup] Error comparing minute/hourly file positions:', err.message);
            }
        })();
    }

    // --- Startup: Compare read/write bucket position counts ---
    if (process.env.NODE_ENV !== 'test') {
        (async () => {
            try {
                const readFiles = await listS3Files(s3, BUCKET_NAME, 'data/piaware_aircraft_log');
                const writeFiles = await listS3Files(s3, WRITE_BUCKET_NAME, 'data/piaware_aircraft_log');
                let readCount = 0, writeCount = 0;
                for (const file of readFiles) {
                    try {
                        const data = await downloadAndParseS3File(s3, BUCKET_NAME, file.Key);
                        if (Array.isArray(data)) readCount += data.length;
                        else if (data) readCount++;
                    } catch {}
                }
                for (const file of writeFiles) {
                    try {
                        const data = await downloadAndParseS3File(s3, WRITE_BUCKET_NAME, file.Key);
                        if (Array.isArray(data)) writeCount += data.length;
                        else if (data) writeCount++;
                    } catch {}
                }
                const logMsg = `[startup] Read bucket: ${readFiles.length} files, ${readCount} positions | Write bucket: ${writeFiles.length} files, ${writeCount} positions`;
                console.log(logMsg);
                fs.appendFileSync('startup-bucket-compare.log', logMsg + '\n');
            } catch (err) {
                console.warn('[startup] Error comparing read/write bucket positions:', err.message);
            }
        })();
    }

    // --- Startup: Compare read/write bucket file counts ---
    if (process.env.NODE_ENV !== 'test') {
        (async () => {
            try {
                const readFiles = await listS3Files(s3, BUCKET_NAME, 'data/piaware_aircraft_log');
                const writeFiles = await listS3Files(s3, WRITE_BUCKET_NAME, 'data/piaware_aircraft_log');
                console.log(`[startup] Read bucket: ${readFiles.length} files, Write bucket: ${writeFiles.length} files`);
            } catch (err) {
                console.warn('[startup] Error comparing read/write bucket files:', err.message);
            }
        })();
    }

    // Background jobs to compute heavy aggregations and populate globalCache
    let aggRunning = { airlines: false, squawk: false, historical: false, positions: false };

    const preloadPositions = async () => {
        if (aggRunning.positions) return;
        aggRunning.positions = true;
        try {
            logger.info('[Preload] Starting preload of 1-hour positions...');
            const startTime = Date.now();
            
            // Load 1-hour positions from S3
            const recentCutoff = Date.now() - (1 * 60 * 60 * 1000); // 1 hour ago
            const positions = await loadRecentHeatmapPositions(s3, WRITE_BUCKET_NAME, WRITE_BUCKET_NAME, recentCutoff);
            
            // Store in global cache
            globalCache.preloadedPositions = positions;
            globalCache.preloadedPositionsLastUpdate = new Date();
            
            const loadTime = Date.now() - startTime;
            logger.info(`[Preload] Preloaded ${positions.length} positions in ${loadTime}ms`);
        } catch (err) {
            logger.error('Positions preload error:', err);
        } finally {
            aggRunning.positions = false;
        }
    };

    const runAirlineAgg = async () => {
        if (aggRunning.airlines) return;
        aggRunning.airlines = true;
        try {
            const keys = ['1h', '6h', '24h'];
            for (const k of keys) {
                const data = await computeAirlineStatsData(s3, BUCKET_NAME, WRITE_BUCKET_NAME, k);
                globalCache.airlineStats[k] = data;
            }
        } catch (err) {
            logger.error('Airline aggregator error:', err);
        } finally {
            aggRunning.airlines = false;
        }
    };

    const runSquawkAgg = async () => {
        if (aggRunning.squawk) return;
        aggRunning.squawk = true;
        try {
            const hoursList = [1, 6, 24];
            for (const h of hoursList) {
                const key = `h${h}`;
                const data = await computeSquawkTransitionsData(s3, BUCKET_NAME, h, 'read');
                globalCache.squawkTransitions[key] = data;
            }
        } catch (err) {
            logger.error('Squawk aggregator error:', err);
        } finally {
            aggRunning.squawk = false;
        }
    };

    const runHistoricalAgg = async () => {
        if (aggRunning.historical) return;
        aggRunning.historical = true;
        try {
            const hours = 168; const resolution = 60;
            const key = `h${hours}_r${resolution}`;
            const data = await computeHistoricalStatsData(s3, BUCKET_NAME, hours, resolution, getInMemoryState);
            globalCache.historicalStats[key] = data;
        } catch (err) {
            logger.error('Historical aggregator error:', err);
        } finally {
            aggRunning.historical = false;
        }
    };

    // Schedule background jobs
    preloadPositions();
    runAirlineAgg();
    runSquawkAgg();
    runHistoricalAgg();
    setInterval(preloadPositions, 5 * 60 * 1000); // Reload positions every 5 minutes
    setInterval(runAirlineAgg, config.backgroundJobs.aggregateAirlinesInterval);
    setInterval(runSquawkAgg, config.backgroundJobs.aggregateSquawkInterval);
    setInterval(runHistoricalAgg, config.backgroundJobs.aggregateHistoricalInterval);
    setInterval(saveState, config.backgroundJobs.saveStateInterval);
    setInterval(saveAircraftDataToS3, config.backgroundJobs.saveAircraftDataInterval);
    setInterval(buildFlightsFromS3, config.backgroundJobs.buildFlightsInterval);
    setInterval(buildHourlyPositionsFromS3, config.backgroundJobs.buildHourlyPositionsInterval);
    setInterval(() => remakeHourlyRollup(s3, BUCKET_NAME, WRITE_BUCKET_NAME, globalCache), config.backgroundJobs.remakeHourlyRollupInterval);
    
    // Initial builds
    setTimeout(() => buildFlightsFromS3(), config.initialJobDelays.buildFlightsDelay);
    setTimeout(() => buildHourlyPositionsFromS3(), config.initialJobDelays.buildHourlyPositionsDelay);
    setTimeout(() => remakeHourlyRollup(s3, BUCKET_NAME, WRITE_BUCKET_NAME, globalCache), config.initialJobDelays.remakeHourlyRollupDelay);
    
    logger.info('Background jobs scheduled');
    
    // Start fetchData for live aircraft updates
    setInterval(fetchData, config.backgroundJobs.fetchDataInterval);
    logger.info('fetchData scheduled for live updates');
}

initialize();

server.listen(PORT, () => {
    logger.info(`Server on port ${PORT}`);
    
    // Start track cache service after server is listening
    (async () => {
        try {
            await trackCache.start();
            logger.info('Track cache service started successfully');
        } catch (err) {
            logger.error('Failed to start track cache service:', err);
        }
    })();
});
