const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const socketIo = require('socket.io');
const axios = require('axios');
const morgan = require('morgan');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const config = require('./config');
const { getAirlineDatabase, getAircraftTypesDatabase } = require('./lib/databases');
const { registration_from_hexid } = require('./lib/registration');
const { setupApiRoutes } = require('./lib/api-routes');
const { computeAirlineStatsData, computeSquawkTransitionsData, computeHistoricalStatsData } = require('./lib/aggregators');
const logger = require('./lib/logger');
const { listS3Files, downloadAndParseS3File } = require('./lib/s3-helpers');
const PositionCache = require('./lib/position-cache');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- Load Configuration ---
const PORT = config.server.port;
const PIAWARE_URL = config.dataSource.piAwareUrl;
const BUCKET_NAME = config.buckets.readBucket;
const WRITE_BUCKET_NAME = config.buckets.writeBucket;
const STATE_FILE = path.join(__dirname, config.state.stateFile);

const s3 = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    credentials: config.s3.credentials,
    forcePathStyle: config.s3.forcePathStyle,
});

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

// --- Position Cache (7 days of historical data in memory) ---
const positionCache = new PositionCache(s3, {
    read: BUCKET_NAME,
    write: WRITE_BUCKET_NAME
});

// --- In-memory state ---
let aircraftTracking = {}; // Current active aircraft (1 minute window)
let activeFlights = {}; // Active flights in progress (keyed by ICAO hex)
let positionHistory = []; // All positions from last 24 hours
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
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
const accessLogStream = fs.createWriteStream(path.join(__dirname, config.logging.accessLogFile), { flags: 'a' });
app.use(morgan(config.logging.format, { stream: accessLogStream }));

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
            positionHistory: positionHistory.slice(-10000), // Save last 10k positions to limit file size
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

async function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = await fs.promises.readFile(STATE_FILE, 'utf8');
            const state = JSON.parse(data);
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
                    const airlineCode = pos.callsign.substring(0, 3).toUpperCase();
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
                        registration: (r.r || r.registration || r.Reg || '').toString().trim(),
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
            const airlineCode = fl.callsign.substring(0, 3).toUpperCase();
            fl.airline_code = airlineCode;
            fl.airline_name = (airlineDb && airlineDb[airlineCode]) ? (airlineDb[airlineCode].name || airlineDb[airlineCode]) : '';
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
    
    // Find most common ident
    const idents = recs.map(r => r.ident).filter(Boolean);
    const identCounts = {};
    for (const id of idents) {
        identCounts[id] = (identCounts[id] || 0) + 1;
    }
    let callsign = '';
    if (Object.keys(identCounts).length > 0) {
        callsign = Object.entries(identCounts).sort((a, b) => b[1] - a[1])[0][0];
    }
    
    const registration = recs.map(r => r.registration).filter(Boolean).pop() || '';
    
    // Find a distinct end position if we have multiple records with different coordinates
    let endForCoords = end;
    if (recs.length > 1) {
        // Look backwards for a record with different coordinates than start
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
        slant_range_end: slant_end
    };
}

async function writeFlightsCSV(flights, filePath) {
    const headers = ['ICAO', 'Callsign', 'Registration', 'Start_Time', 'End_Time', 'Duration_min', 
                     'Start_Lat', 'Start_Lon', 'End_Lat', 'End_Lon', 'Max_Alt_ft', 'Max_Speed_kt', 'Reports', 
                     'Airline_Code', 'Airline_Name'];
    
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
            fl.airline_name || ''
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

// --- Core Logic ---
const fetchData = async () => {
    try {
        const [response, airlineDb, typesDb] = await Promise.all([
            axios.get(PIAWARE_URL),
            getAirlineDatabase(s3, BUCKET_NAME),
            getAircraftTypesDatabase(s3, BUCKET_NAME)
        ]);

        if (!airlineDb || typeof airlineDb !== 'object' || !typesDb || typeof typesDb !== 'object') {
            logger.error('CRITICAL: Databases not loaded. Skipping data enrichment.');
            // Continue without enrichment if databases fail to load
            const liveAircraft = response.data.aircraft || [];
            io.emit('liveUpdate', {
                trackingCount: Object.keys(aircraftTracking).length,
                runningPositionCount,
                aircraft: liveAircraft,
                runtime: Math.floor((Date.now() - trackerStartTime) / 1000)
            });
            return;
        }

        const liveAircraft = response.data.aircraft || [];
        const now = Date.now();

        const enrichedAircraft = await Promise.all(liveAircraft.map(async (ac) => {
            const flight = (ac.flight || '').trim();
            const airlineCode = flight.substring(0, 3);
            let dbInfo = await getDbInfo(ac.hex);
            if (!dbInfo) dbInfo = {};

            return {
                ...ac,
                flight,
                airline: airlineDb[airlineCode] || 'N/A',
                registration: ac.r || dbInfo.r || registration_from_hexid(ac.hex) || 'N/A',
                aircraft_type: ac.t || dbInfo.t || 'N/A',
                distance: (ac.lat && ac.lon && receiver_lat !== 0.0) ? calculate_distance(receiver_lat, receiver_lon, ac.lat, ac.lon).toFixed(1) : 'N/A',
            };
        }));

        enrichedAircraft.forEach(ac => {
            if (ac.lat !== undefined && ac.lon !== undefined) {
                // Calculate slant distance for reception records
                if (receiver_lat !== 0.0 && receiver_lon !== 0.0 && ac.alt_baro && ac.alt_baro !== 'N/A') {
                    const positionalDist = calculate_distance(receiver_lat, receiver_lon, ac.lat, ac.lon);
                    const slantDist = calculate_slant_distance(positionalDist, ac.alt_baro);
                    const bearing = calculate_bearing(receiver_lat, receiver_lon, ac.lat, ac.lon);
                    updateSectorAltitudeRecords(ac, slantDist, bearing);
                }

                // Add to 24-hour position history
                positionHistory.push({
                    hex: ac.hex,
                    flight: ac.flight,
                    lat: ac.lat,
                    lon: ac.lon,
                    alt: ac.alt_baro,
                    gs: ac.gs,
                    track: ac.track,
                    timestamp: now,
                    registration: ac.registration,
                    aircraft_type: ac.aircraft_type,
                    airline: ac.airline
                });
                
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
        io.emit('liveUpdate', {
            trackingCount: Object.keys(aircraftTracking).length,
            runningPositionCount,
            aircraft: Object.values(aircraftTracking),
            runtime: Math.floor((Date.now() - trackerStartTime) / 1000),
            maxRssi,
            minRssi,
            maxRange,
            minRange,
            receiver_lat,
            receiver_lon
        });

    } catch (error) {
        logger.error(`Fetch error: ${error.message}`);
    }
};


// --- Initialization ---
async function initialize() {
    await loadState();
    try {
        const receiverUrl = PIAWARE_URL.replace('/data/aircraft.json', '/data/receiver.json');
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
        receiver_lon,
        sectorAltitudeRecords
    });
    // Use BUCKET_NAME for read-only (historical) endpoints, WRITE_BUCKET_NAME for write endpoints
    setupApiRoutes(app, s3, BUCKET_NAME, WRITE_BUCKET_NAME, getInMemoryState, globalCache, positionCache); // Pass positionCache for fast position lookups

    // Background jobs to compute heavy aggregations and populate globalCache
    let aggRunning = { airlines: false, squawk: false, historical: false };

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
    runAirlineAgg();
    runSquawkAgg();
    runHistoricalAgg();
    setInterval(runAirlineAgg, config.backgroundJobs.aggregateAirlinesInterval);
    setInterval(runSquawkAgg, config.backgroundJobs.aggregateSquawkInterval);
    setInterval(runHistoricalAgg, config.backgroundJobs.aggregateHistoricalInterval);

    setInterval(fetchData, config.backgroundJobs.fetchDataInterval);
    setInterval(saveState, config.backgroundJobs.saveStateInterval);
    setInterval(saveAircraftDataToS3, config.backgroundJobs.saveAircraftDataInterval);
    setInterval(buildFlightsFromS3, config.backgroundJobs.buildFlightsInterval);
    setInterval(buildHourlyPositionsFromS3, config.backgroundJobs.buildHourlyPositionsInterval);
    
    // Initial builds
    setTimeout(() => buildFlightsFromS3(), config.initialJobDelays.buildFlightsDelay);
    setTimeout(() => buildHourlyPositionsFromS3(), config.initialJobDelays.buildHourlyPositionsDelay);
}

initialize();

io.on('connection', (socket) => {
    logger.info('Client connected');
    socket.on('disconnect', () => logger.info('Client disconnected'));
});

server.listen(PORT, () => logger.info(`Server on port ${PORT}`));
