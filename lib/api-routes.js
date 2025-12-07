const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { listS3Files, downloadAndParseS3File } = require('./s3-helpers');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Function to check if server files have been modified since server start
function checkServerFilesModified() {
    const serverFiles = [
        'server.js',
        'lib/api-routes.js',
        'lib/s3-helpers.js',
        'lib/logger.js',
        'lib/databases.js'
    ];

    for (const file of serverFiles) {
        try {
            const filePath = path.join(__dirname, '..', file);
            const stats = fs.statSync(filePath);
            if (stats.mtime.getTime() > serverStartTs) {
                return true; // File was modified after server started
            }
        } catch (err) {
            // File doesn't exist or can't be read, continue checking others
            continue;
        }
    }
    return false; // No files modified after server start
}

// Server startup metadata (calculated at module load)
let serverStartTs = Date.now();
let serverStartIso = new Date(serverStartTs).toISOString();
let serverGitCommit = '';
let serverGitDirty = false;
// Allow tests and environments to override git status via env vars
if (process.env.GIT_COMMIT_OVERRIDE) {
    serverGitCommit = process.env.GIT_COMMIT_OVERRIDE;
    serverGitDirty = (process.env.GIT_DIRTY_OVERRIDE && process.env.GIT_DIRTY_OVERRIDE.toLowerCase() === 'true') || false;
} else if (process.env.NODE_ENV === 'test') {
    // In tests, default to non-dirty test commit to avoid flakiness
    serverGitCommit = 'test';
    serverGitDirty = false;
} else {
    try {
        serverGitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
        const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
        serverGitDirty = status.length > 0;
    } catch (err) {
        // If git is not available or error occurs, leave empty and continue
        serverGitCommit = '';
        serverGitDirty = false;
    }
}
const { getAirlineDatabase } = require('./databases');
const { computeAirlineStatsData, computeSquawkTransitionsData, computeSquawkTransitionsDataByTimeRange, computeHistoricalStatsData } = require('./aggregators');
const aircraftDB = require('./aircraft-database');
const aircraftTypesDB = require('./aircraft-types-db');

let aircraftCache = null;
let heatmapCache = new Map();
let allHeatmapPositions = null;
let heatmapPositionsLastLoaded = null;
let heatmapLoadInProgress = false;

// Helper to clear cache
function clearHeatmapCache() {
    heatmapCache.clear();
    allHeatmapPositions = null; // Also clear positions cache
    heatmapPositionsLastLoaded = null;
    console.log('[heatmap] Cache cleared');
}

async function loadAircraftCache() {
    if (aircraftCache) return aircraftCache;
    try {
        const fs = require('fs').promises;
        const data = await fs.readFile('opensky_aircraft_cache.json', 'utf8');
        aircraftCache = JSON.parse(data);
        const aircraftCount = Object.keys(aircraftCache.aircraft || {}).length;
        console.log('✓ Loaded aircraft cache with', aircraftCount, 'entries');
        return aircraftCache;
    } catch (error) {
        console.error('✗ Error loading aircraft cache:', error.message);
        return {};
    }
}

async function loadAllHeatmapPositions(s3, readBucket) {
    if (allHeatmapPositions) return allHeatmapPositions;
    
    console.log('Loading heatmap positions into memory (last 7 days first)...');
    const startTime = Date.now();
    
    // Load aircraft cache first
    await loadAircraftCache();
    
    // Get all files from both minute and hourly directories
    console.log('--- Loading heatmap data from all available sources (minute + hourly) ---');
    const minuteFiles = await listS3Files(s3, readBucket, 'data/piaware_aircraft_log');
    const hourlyFiles = await listS3Files(s3, readBucket, 'data/hourly/positions_');
    const files = [...minuteFiles, ...hourlyFiles];
    console.log(`Found ${minuteFiles.length} minute files and ${hourlyFiles.length} hourly files. Total: ${files.length} files.`);
    
    allHeatmapPositions = [];
    let totalRecords = 0;
    let globalEnrichedCount = 0;
    
    // Determine cutoff for last 7 days
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    // Sort files by name (most recent first for better UX - load recent data first)
    const sortedFiles = [...files].sort((a, b) => b.Key.localeCompare(a.Key));
    
    console.log(`[heatmap] Loading last 7 days first, then remaining historical data...`);
    
    for (const file of sortedFiles) {
        try {
            const records = await downloadAndParseS3File(s3, readBucket, file.Key);
            totalRecords += records.length;
            
            let enrichedCount = 0;
            for (const record of records) {
                // Normalize keys - S3 files use lowercase, piaware uses uppercase
                const icao = record.ICAO || record.hex || record.icao;
                const aircraftType = record.Aircraft_type || record.aircraft_type;
                
                // Enrich with aircraft database data
                const aircraft = aircraftCache.aircraft ? aircraftCache.aircraft[icao] : null;
                if (aircraft && aircraft.typecode) {
                    record.Aircraft_type = aircraft.typecode;
                    enrichedCount++;
                    globalEnrichedCount++;
                }
                
                // Enrich with type info (manufacturer, body type) - same as flights page
                if (record.Aircraft_type && record.Aircraft_type !== 'N/A') {
                    const typeInfo = aircraftTypesDB.lookup(record.Aircraft_type);
                    if (typeInfo) {
                        record.manufacturer = typeInfo.manufacturer;
                        record.bodyType = typeInfo.bodyType;
                    }
                }
                
                // Get position data
                const lat = record.Latitude || record.lat;
                const lon = record.Longitude || record.lon;
                const timestamp = record.Timestamp || record.First_Seen || record.Last_Seen || record.firstSeen || record.lastSeen;
                const flight = record.Flight || record.Ident || record.flight;
                const registration = record.Registration || record.registration;
                
                if (lat && lon && typeof lat === 'number' && typeof lon === 'number') {
                    allHeatmapPositions.push({
                        lat,
                        lon,
                        timestamp,
                        hex: icao,
                        Aircraft_type: record.Aircraft_type,
                        aircraft_type: record.Aircraft_type,
                        Flight: flight,
                        manufacturer: record.manufacturer,
                        bodyType: record.bodyType,
                        ICAO: icao,
                        Registration: registration
                    });
                }
            }
            if (enrichedCount > 0) {
                console.log(`[heatmap] File ${file.Key}: enriched ${enrichedCount}/${records.length} records`);
            }
        } catch (error) {
            console.warn(`Error loading file ${file.Key}:`, error.message);
        }
    }
    
    const duration = Date.now() - startTime;
    
    // Count positions with enrichment
    let withType = 0, withManufacturer = 0, withTimestamp = 0;
    for (const pos of allHeatmapPositions) {
        if (pos.Aircraft_type && pos.Aircraft_type !== 'N/A') withType++;
        if (pos.manufacturer) withManufacturer++;
        if (pos.timestamp) withTimestamp++;
    }
    
    console.log(`✓ Loaded ${allHeatmapPositions.length} positions from ${totalRecords} records in ${duration}ms`);
    console.log(`  - Enriched during loading: ${globalEnrichedCount} records`);
    console.log(`  - With Aircraft_type: ${withType} (${(withType/allHeatmapPositions.length*100).toFixed(1)}%)`);
    console.log(`  - With Manufacturer: ${withManufacturer} (${(withManufacturer/allHeatmapPositions.length*100).toFixed(1)}%)`);
    console.log(`  - With Timestamp: ${withTimestamp} (${(withTimestamp/allHeatmapPositions.length*100).toFixed(1)}%)`);
    console.log(`[heatmap] Ready for 31-day historical queries (currently loaded up to 31 days)`);
    return allHeatmapPositions;
}

function setupApiRoutes(app, s3, readBucket, writeBucket, getInMemoryState, cache = {}, positionCache = null) {
    
    // --- Heatmap Data Endpoint ---
    app.get('/api/heatmap-data', async (req, res) => {
        try {
            const hours = parseInt(req.query.hours || '24', 10);
            const positions = positionCache?.getPositionsByTimeWindow(hours) || getInMemoryState()?.positions || [];
            
            const grid = {};
            // 1 NM = 1.852 km, 1 degree ≈ 111 km, so 1 NM ≈ 0.0167 degrees
            const gridSize = 1.852 / 111; // ~0.0167 degrees = 1 nautical mile
            cache.lastHeatmapProcessing = Date.now();
            
            for (const pos of positions) {
                if (!pos.lat || !pos.lon || typeof pos.lat !== 'number' || typeof pos.lon !== 'number') continue;
                
                const latIdx = Math.floor(pos.lat / gridSize);
                const lonIdx = Math.floor(pos.lon / gridSize);
                const key = `${latIdx},${lonIdx}`;
                
                if (!grid[key]) {
                    grid[key] = {
                        lat_min: latIdx * gridSize,
                        lat_max: (latIdx + 1) * gridSize,
                        lon_min: lonIdx * gridSize,
                        lon_max: (lonIdx + 1) * gridSize,
                        count: 0
                    };
                }
                grid[key].count++;
            }
            
            res.json({ grid: Object.values(grid) });
        } catch (error) {
            console.error('Error in heatmap endpoint:', error);
            res.status(500).json({ error: 'Failed to generate heatmap data' });
        }
    });

    // --- Position Timeseries Live Endpoint (from position cache) ---
    app.get('/api/position-timeseries-live', async (req, res) => {
        try {
            const resolution = parseInt(req.query.resolution || '1', 10);
            
            // Get state from in-memory tracking
            const state = getInMemoryState ? getInMemoryState() : {};
            const positionHistory = state.positionHistory || [];
            
            // Determine time window
            let cutoff, now;
            if (req.query.startTime && req.query.endTime) {
                // Use explicit time range
                cutoff = parseInt(req.query.startTime, 10);
                now = parseInt(req.query.endTime, 10);
            } else {
                // Fall back to minutes parameter
                const minutes = parseInt(req.query.minutes || '10', 10);
                now = Date.now();
                cutoff = now - (minutes * 60 * 1000);
            }
            
            // Filter positions by time window
            const windowPositions = positionHistory.filter(p => p.timestamp && p.timestamp >= cutoff && p.timestamp <= now);
            
            // Group by resolution buckets
            const buckets = {};
            for (const pos of windowPositions) {
                const bucketTime = Math.floor(pos.timestamp / (resolution * 60 * 1000)) * (resolution * 60 * 1000);
                if (!buckets[bucketTime]) {
                        buckets[bucketTime] = {
                            timestamp: bucketTime,
                            positionCount: 0,
                            aircraftCount: new Set(),
                            flightCount: new Set(),
                            airlineCount: new Set(),
                            manufacturerCounts: {}
                        };
                }
                
                buckets[bucketTime].positionCount++;
                if (pos.hex) buckets[bucketTime].aircraftCount.add(pos.hex);
                if (pos.flight && pos.flight.trim()) buckets[bucketTime].flightCount.add(pos.flight);
                if (pos.airline && pos.airline.trim()) buckets[bucketTime].airlineCount.add(pos.airline);
            }
            
            // Convert to array and compute final counts
            // Convert manufacturerCounts sets to object counts
            for (const bucket of Object.values(buckets)) {
                // For each aircraft in the bucket, attempt to resolve manufacturer
                for (const hex of bucket.aircraftCount) {
                    try {
                        const ac = aircraftDB.lookup(hex);
                        const tcode = ac?.typecode || '';
                        const ti = aircraftTypesDB.lookup(tcode);
                        const manu = ti?.manufacturer || null;
                        if (manu) bucket.manufacturerCounts[manu] = (bucket.manufacturerCounts[manu] || 0) + 1;
                    } catch (err) {
                        // ignore lookup errors
                    }
                }
            }

            const timeseries = Object.values(buckets)
                .map(bucket => ({
                    timestamp: bucket.timestamp,
                    positionCount: bucket.positionCount,
                    aircraft: Array.from(bucket.aircraftCount),
                    flights: Array.from(bucket.flightCount),
                    airlines: Array.from(bucket.airlineCount)
                    , manufacturers: bucket.manufacturerCounts || {}
                }))
                .sort((a, b) => a.timestamp - b.timestamp);
            
            res.json(timeseries);
        } catch (error) {
            console.error('Error in position-timeseries-live endpoint:', error);
            res.status(500).json({ error: 'Failed to generate position timeseries' });
        }
    });

    // --- Reception Range Endpoint ---
    app.get('/api/reception-range', async (req, res) => {
        try {
            const hours = parseInt(req.query.hours || '24', 10);
            
            // Get receiver coordinates if available
            const state = getInMemoryState ? getInMemoryState() : {};
            const receiverLat = state.receiver_lat;
            const receiverLon = state.receiver_lon;
            
            // Prefer flights data with real altitudes (alt_baro) over position cache (which has alt: 0)
            let positions = [];
            console.log('[reception] Loading positions from flights data...');
            
            // Load flight files from S3
            try {
                const s3Files = await listS3Files(s3, writeBucket, 'flights/', 1000, 1);
                cache.s3Reads = (cache.s3Reads || 0) + 1;
                cache.lastRead = Date.now();
                const flightFiles = (s3Files || []).filter(f => 
                    f.Key && (f.Key.startsWith('flights/hourly/') || f.Key.startsWith('flights/daily/'))
                );
                
                const timeCutoff = Date.now() - (hours * 60 * 60 * 1000);
                const { GetObjectCommand } = require('@aws-sdk/client-s3');
                
                for (const file of flightFiles) {
                    try {
                        const command = new GetObjectCommand({ Bucket: writeBucket, Key: file.Key });
                        const response = await s3.send(command);
                        const chunks = [];
                        for await (const chunk of response.Body) {
                            chunks.push(chunk);
                        }
                        const body = Buffer.concat(chunks).toString('utf-8');
                        const flights = JSON.parse(body);
                        
                        for (const flight of flights) {
                            if (!flight.start_lat || !flight.start_lon || !flight.start_time) continue;
                            const startTime = new Date(flight.start_time).getTime();
                            if (startTime < timeCutoff) continue;
                            
                            // Use flight start position with max altitude
                            positions.push({
                                lat: flight.start_lat,
                                lon: flight.start_lon,
                                alt_baro: flight.max_alt_ft || 0
                            });
                            
                            // Also use end position if available
                            if (flight.end_lat && flight.end_lon) {
                                positions.push({
                                    lat: flight.end_lat,
                                    lon: flight.end_lon,
                                    alt_baro: flight.max_alt_ft || 0
                                });
                            }
                        }
                    } catch (err) {
                        continue;
                    }
                }
                console.log('[reception] Loaded', positions.length, 'positions from flights');
            } catch (err) {
                console.warn('Failed to load flights for reception data:', err.message);
            }
            
            // If flights data is empty, fall back to position cache
            if (positions.length === 0) {
                console.log('[reception] No flights data, using position cache');
                positions = positionCache?.getPositionsByTimeWindow(hours) || [];
                console.log('[reception] Positions from cache:', positions.length);
            }
            
            // Calculate bearing and altitude bands for each position
            const sectorMap = {};
            let maxRange = 0;
            
            // Only process if we have receiver coordinates
            if (typeof receiverLat !== 'number' || typeof receiverLon !== 'number') {
                console.warn('Receiver coordinates not available:', { receiverLat, receiverLon });
                // Return empty structure if we can't calculate
                return res.json({ 
                    sectors: {},
                    maxRange: 0,
                    positionCount: 0,
                    receiverLat,
                    receiverLon
                });
            }
            
            // Debug: Check first position structure
            if (positions.length > 0) {
                const firstPos = positions[0];
                console.log('[reception] First position fields:', Object.keys(firstPos).sort());
                console.log('[reception] First position sample:', JSON.stringify(firstPos).substring(0, 200));
            }
            
            for (const pos of positions) {
                // Skip invalid positions (missing lat/lon)
                if (!pos.lat || !pos.lon) {
                    continue;
                }
                
                // Handle both 'alt' (from aircraft cache) and 'alt_baro' (from flights)
                // If no altitude data, use a placeholder band instead of rejecting the position
                let altitude = pos.alt ?? pos.alt_baro;
                if (!altitude || altitude <= 0) {
                    altitude = 0; // Will be placed in "0-1000 ft" band as unknown altitude
                }
                
                // Calculate bearing from receiver to aircraft
                const lat1 = receiverLat * Math.PI / 180;
                const lat2 = pos.lat * Math.PI / 180;
                const dLon = (pos.lon - receiverLon) * Math.PI / 180;
                const bearing = Math.atan2(Math.sin(dLon), Math.cos(lat1) * Math.tan(lat2) - Math.sin(lat1) * Math.cos(dLon)) * 180 / Math.PI;
                const normalizedBearing = (bearing + 360) % 360;
                
                // Round bearing to nearest 15° (sector)
                const sectorBearing = Math.floor(normalizedBearing / 15) * 15;
                
                // Altitude band (0-5000, 5000-10000, etc.)
                const altBand = Math.floor(altitude / 5000) * 5000;
                
                // Calculate slant range
                const R = 3440.065; // nm per radian
                const toRad = deg => deg * Math.PI / 180;
                const lat1_rad = toRad(receiverLat);
                const lat2_rad = toRad(pos.lat);
                const delta_lat = toRad(pos.lat - receiverLat);
                const delta_lon = toRad(pos.lon - receiverLon);
                const a = Math.sin(delta_lat / 2) ** 2 + Math.cos(lat1_rad) * Math.cos(lat2_rad) * Math.sin(delta_lon / 2) ** 2;
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                const horiz = R * c;
                const alt_nm = altitude / 6076.12;
                const slantRange = Math.sqrt(horiz ** 2 + alt_nm ** 2);
                
                const sectorKey = `${sectorBearing}_${altBand}`;
                if (!sectorMap[sectorKey]) {
                    sectorMap[sectorKey] = { bearing: sectorBearing, altBand, maxRange: 0, count: 0 };
                }
                sectorMap[sectorKey].maxRange = Math.max(sectorMap[sectorKey].maxRange, slantRange);
                sectorMap[sectorKey].count++;
                maxRange = Math.max(maxRange, slantRange);
            }
            
            res.json({ 
                sectors: sectorMap,
                maxRange,
                positionCount: positions.length,
                receiverLat,
                receiverLon
            });
        } catch (error) {
            console.error('Error in reception-range endpoint:', error);
            // Return empty but valid structure on error
            res.json({ 
                sectors: {},
                maxRange: 0,
                positionCount: 0,
                receiverLat: undefined,
                receiverLon: undefined
            });
        }
    });

    // --- Flights Endpoint ---
    app.get('/api/flights', async (req, res) => {
        try {
            const windowStr = req.query.window || '24h';
            let hours = 24;
            if (windowStr.endsWith('h')) {
                hours = parseInt(windowStr.slice(0, -1), 10);
            } else if (windowStr.endsWith('d')) {
                hours = parseInt(windowStr.slice(0, -1), 10) * 24;
            }
            const timeCutoff = Date.now() - (hours * 60 * 60 * 1000);
            
            // Load airline database for enrichment
            const airlineDatabase = await getAirlineDatabase(s3, readBucket);
            
            // Read more pages to ensure we get enough files for the time window
            const maxPages = Math.max(5, Math.ceil(hours / 24)); // At least 5 pages, more for longer windows
            const s3Files = await listS3Files(s3, writeBucket, 'flights/', 1000, maxPages);
            cache.s3Reads = (cache.s3Reads || 0) + 1;
            cache.lastRead = Date.now();
            cache.lastFlightsProcessing = Date.now();
            const flightFiles = (s3Files || []).filter(f => 
                f.Key && (f.Key.startsWith('flights/hourly/') || f.Key.startsWith('flights/daily/'))
            );
            
            let allFlights = [];
            const seenFlightKeys = new Map();

            function makeFlightKey(flt) {
                const icao = (flt.icao || flt.hex || '').toLowerCase();
                const callsign = (flt.callsign || '').toUpperCase();
                const start = flt.start_time || flt.start_ts || '';
                const end = flt.end_time || flt.end_ts || '';
                const reg = (flt.registration || '').toUpperCase();
                return `${icao}|${callsign}|${start}|${end}|${reg}`;
            }
            for (const file of flightFiles) {
                try {
                    const command = new GetObjectCommand({ Bucket: writeBucket, Key: file.Key });
                    const response = await s3.send(command);
                    const chunks = [];
                    for await (const chunk of response.Body) {
                        chunks.push(chunk);
                    }
                    const body = Buffer.concat(chunks).toString('utf-8');
                    const flights = JSON.parse(body);
                    
                    for (const fl of flights) {
                        const startTime = new Date(fl.start_time).getTime();
                        const endTime = new Date(fl.end_time).getTime();
                        
                        // Include flights that were active during the time window
                        // (started before cutoff and ended after, OR started within window)
                        if (endTime > timeCutoff || startTime > timeCutoff) {
                            // Enrich with airline name
                            const callsign = fl.callsign || '';
                            const airlineCode = callsign.substring(0, 3).toUpperCase();
                            let airlineName = '';
                            if (airlineDatabase && airlineDatabase[airlineCode]) {
                                const dbEntry = airlineDatabase[airlineCode];
                                airlineName = typeof dbEntry === 'string' ? dbEntry : (dbEntry.name || '');
                            }
                            fl.airline_name = airlineName;
                            fl.airline_code = airlineCode;
                            
                            // Enrich with aircraft database info if not already present
                            if (fl.icao && (!fl.registration || fl.registration === 'N/A' || !fl.type || fl.type === 'N/A')) {
                                const aircraftData = aircraftDB.lookup(fl.icao);
                                    if (aircraftData) {
                                    if (!fl.registration || fl.registration === 'N/A') {
                                        fl.registration = aircraftData.registration || fl.registration;
                                    }
                                    if (!fl.type || fl.type === 'N/A') {
                                        fl.type = aircraftData.typecode || fl.type;
                                    }
                                    // Add model info if available
                                    if (aircraftData.model && !fl.aircraft_model) {
                                        fl.aircraft_model = aircraftData.model;
                                    }
                                }
                            }
                            
                            // Enrich with type info (manufacturer, body type)
                            if (fl.type && fl.type !== 'N/A') {
                                const typeInfo = aircraftTypesDB.lookup(fl.type);
                                if (typeInfo) {
                                    fl.manufacturer = typeInfo.manufacturer;
                                    fl.bodyType = typeInfo.bodyType;
                                    if (!fl.aircraft_model) {
                                        fl.aircraft_model = typeInfo.model;
                                    }
                                }
                            }
                            // If still missing registration, but the callsign looks like an FAA tail number
                            // use it as a registration so the frontend displays a tail instead of 'N/A'.
                            if ((!fl.registration || fl.registration === 'N/A') && fl.callsign && /^N\d{1,5}[A-Z]{0,2}$/i.test(fl.callsign)) {
                                fl.registration = fl.callsign.toUpperCase();
                            }

                            // Enrich with logos
                            // Airline logo
                            if (airlineDatabase && airlineDatabase[airlineCode]) {
                                const airlineData = airlineDatabase[airlineCode];
                                fl.airlineLogo = typeof airlineData === 'string' ? null : airlineData.logo;
                            }
                            // Manufacturer logo
                            if (fl.manufacturer && airlineDatabase) {
                                const manufacturerEntry = Object.entries(airlineDatabase).find(([code, data]) => 
                                    data.name === fl.manufacturer
                                );
                                if (manufacturerEntry) {
                                    const [manufacturerCode, manufacturerData] = manufacturerEntry;
                                    fl.manufacturerLogo = manufacturerData.logo;
                                }
                            }
                            
                            const key = makeFlightKey(fl);
                            if (!seenFlightKeys.has(key)) {
                                seenFlightKeys.set(key, fl);
                                allFlights.push(fl);
                            } else {
                                // If we already have a record, prefer the one with later end_time
                                const existing = seenFlightKeys.get(key);
                                try {
                                    const existingEnd = existing && existing.end_time ? new Date(existing.end_time).getTime() : 0;
                                    const newEnd = fl && fl.end_time ? new Date(fl.end_time).getTime() : 0;
                                    if (newEnd > existingEnd) {
                                        // Replace in map and array
                                        seenFlightKeys.set(key, fl);
                                        const idx = allFlights.findIndex(a => makeFlightKey(a) === key);
                                        if (idx !== -1) allFlights[idx] = fl;
                                    }
                                } catch (err) {
                                    // ignore parse errors, keep first
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.warn(`Failed to read flight file ${file.Key}:`, err.message);
                }
            }
            
            const gapMinutes = parseInt(req.query.gap || '5', 10);
            const gapMs = gapMinutes * 60 * 1000;
            const now = Date.now();
            
            const active = [];
            const completed = [];
            
            for (const fl of allFlights) {
                // If end_time is missing or invalid, treat as active
                if (!fl.end_time) {
                    active.push(fl);
                    continue;
                }
                const endTime = new Date(fl.end_time).getTime();
                if (isNaN(endTime)) {
                    active.push(fl);
                } else if (now - endTime <= gapMs) {
                    active.push(fl);
                } else {
                    completed.push(fl);
                }
            }
            
            if (getInMemoryState) {
                const state = getInMemoryState();
                const liveFlights = Object.values(state.activeFlights || {});
                
                // Enrich live flights with aircraft database
                for (const fl of liveFlights) {
                    if (fl.icao && (!fl.registration || fl.registration === 'N/A' || !fl.type || fl.type === 'N/A')) {
                        const aircraftData = aircraftDB.lookup(fl.icao);
                        if (aircraftData) {
                            if (!fl.registration || fl.registration === 'N/A') {
                                fl.registration = aircraftData.registration || fl.registration;
                            }
                            if (!fl.type || fl.type === 'N/A') {
                                fl.type = aircraftData.typecode || fl.type;
                            }
                            if (aircraftData.model && !fl.aircraft_model) {
                                fl.aircraft_model = aircraftData.model;
                            }
                        }
                    }
                    const key = makeFlightKey(fl);
                    if (seenFlightKeys.has(key)) {
                        // If the live flight is more recent (end_time later or ongoing), replace
                        const existing = seenFlightKeys.get(key);
                        try {
                            const existingEnd = existing && existing.end_time ? new Date(existing.end_time).getTime() : 0;
                            const newEnd = fl && fl.end_time ? new Date(fl.end_time).getTime() : Date.now();
                            if (newEnd >= existingEnd) {
                                seenFlightKeys.set(key, fl);
                                const idx = allFlights.findIndex(a => makeFlightKey(a) === key);
                                if (idx !== -1) allFlights[idx] = fl;
                            }
                        } catch (err) {
                            // ignore parse errors; fallback to leaving existing
                        }
                    } else {
                        seenFlightKeys.set(key, fl);
                        allFlights.push(fl);
                    }
                    // If still missing registration, but the callsign looks like an FAA tail number
                    // (starts with 'N' and follows N-number pattern), use it as registration so the
                    // frontend always has a tail number value to display.
                    if ((!fl.registration || fl.registration === 'N/A') && fl.callsign && /^N\d{1,5}[A-Z]{0,2}$/i.test(fl.callsign)) {
                        fl.registration = fl.callsign.toUpperCase();
                    }
                }
                
                // liveFlights were added to allFlights and handled in the loop above; no need to push again
            }

            // Recompute active/completed after merging live (in-memory) flights into allFlights.
            // Previously active/completed were computed before merging live flights, which could
            // cause active flights to be omitted from the response. Recompute here to ensure
            // the merged live flights are classified correctly.
            active.length = 0;
            completed.length = 0;
            for (const fl of allFlights) {
                if (!fl.end_time) {
                    active.push(fl);
                    continue;
                }
                const endTime = new Date(fl.end_time).getTime();
                if (isNaN(endTime)) {
                    active.push(fl);
                } else if (now - endTime <= gapMs) {
                    active.push(fl);
                } else {
                    completed.push(fl);
                }
            }

            completed.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
            active.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));

            res.json({ flights: completed, active });
        } catch (error) {
            console.error('Error in flights endpoint:', error);
            res.status(500).json({ flights: [], active: [], error: error.message });
        }
    });

    // --- Airline Stats Endpoint ---
    app.get('/api/airline-stats', async (req, res) => {
        try {
            const windowStr = req.query.window || '1h';
            let hours = 1;
            if (windowStr.endsWith('h')) {
                hours = parseInt(windowStr.slice(0, -1), 10);
            } else if (windowStr.endsWith('d')) {
                hours = parseInt(windowStr.slice(0, -1), 10) * 24;
            }
            
            const cacheKey = `airline_${hours}h`;
            if (cache.airlineStats && cache.airlineStats[cacheKey]) {
                return res.json(cache.airlineStats[cacheKey]);
            }
            
            const statsData = await computeAirlineStatsData(s3, readBucket, writeBucket, windowStr);
            
            // Check active flights and update lastSeen to now for airlines with current activity
            const inMemoryState = getInMemoryState();
            const activeFlights = inMemoryState?.activeFlights || {};
            const now = Date.now();
            
            // Build map of airline codes to airline names from statsData
            const airlineCodeToName = {};
            for (const [airlineName, stats] of Object.entries(statsData.byAirline || {})) {
                if (stats.code) {
                    airlineCodeToName[stats.code] = airlineName;
                }
            }
            
            // Check which airlines have active flights right now
            const activeAirlineCodes = new Set();
            for (const flight of Object.values(activeFlights)) {
                if (flight.callsign && flight.callsign.length >= 3) {
                    const airlineCode = flight.callsign.substring(0, 3).toUpperCase();
                    // Filter out N-numbers (tail numbers start with N)
                    if (!airlineCode.startsWith('N')) {
                        activeAirlineCodes.add(airlineCode);
                    }
                }
            }
            
            // Update lastSeen to now for airlines with active flights
            for (const [airlineName, stats] of Object.entries(statsData.byAirline || {})) {
                if (stats.code && activeAirlineCodes.has(stats.code)) {
                    stats.lastSeen = now;
                }
            }
            
            // Wrap in expected structure for UI
            const data = {
                minute: { byAirline: {} },
                hourly: { byAirline: statsData.byAirline || {} },
                memory: { byAirline: {} }
            };
            
            if (!cache.airlineStats) cache.airlineStats = {};
            cache.airlineStats[cacheKey] = data;
            cache.lastAirlinesProcessing = Date.now();
            
            res.json(data);
        } catch (error) {
            console.error('Error computing airline stats:', error);
            res.status(500).json({ error: 'Failed to compute airline statistics' });
        }
    });

    // --- Squawk Transitions Endpoint ---
    app.get('/api/squawk-transitions', async (req, res) => {
        try {
            let startTime, endTime, hours;
            
            console.log('[squawk-api] Request params:', req.query);
            
            // Check if time range parameters are provided
            if (req.query.startTime && req.query.endTime) {
                startTime = parseInt(req.query.startTime, 10);
                endTime = parseInt(req.query.endTime, 10);
                hours = Math.round((endTime - startTime) / (60 * 60 * 1000));
                
                console.log('[squawk-api] Using time range:', new Date(startTime).toISOString(), 'to', new Date(endTime).toISOString());
                
                const cacheKey = `${startTime}-${endTime}`;
                if (cache.squawkTransitions && cache.squawkTransitions[cacheKey]) {
                    return res.json(cache.squawkTransitions[cacheKey]);
                }
                
                // Use writeBucket since that's where current aircraft log files are stored
                const data = await computeSquawkTransitionsDataByTimeRange(s3, writeBucket, startTime, endTime, 'both');
                if (!cache.squawkTransitions) cache.squawkTransitions = {};
                cache.squawkTransitions[cacheKey] = data;
                cache.lastSquawksProcessing = Date.now();
                
                return res.json(data);
            } else {
                // Fallback to hours parameter for backward compatibility
                hours = 0.1667; // 10 minutes (600 seconds) default
                const hourParam = req.query.hours;
                const windowParam = req.query.window;
                
                if (hourParam) {
                    hours = parseInt(hourParam, 10);
                } else if (windowParam) {
                    if (windowParam.endsWith('h')) {
                        hours = parseInt(windowParam.slice(0, -1), 10);
                    } else if (windowParam.endsWith('d')) {
                        hours = parseInt(windowParam.slice(0, -1), 10) * 24;
                    }
                }
                
                const cacheKey = `h${hours}`;
                if (cache.squawkTransitions && cache.squawkTransitions[cacheKey]) {
                    return res.json(cache.squawkTransitions[cacheKey]);
                }
                
                // Use writeBucket since that's where current aircraft log files are stored
                const data = await computeSquawkTransitionsData(s3, writeBucket, hours, 'both');
                if (!cache.squawkTransitions) cache.squawkTransitions = {};
                cache.squawkTransitions[cacheKey] = data;
                cache.lastSquawksProcessing = Date.now();
                
                return res.json(data);
            }
        } catch (error) {
            console.error('Error computing squawk transitions:', error);
            // Return default structure on error instead of error object
            res.json({ 
                transitions: [],
                totalTransitions: 0
            });
        }
    });

    // --- Historical Stats Endpoint ---
    app.get('/api/historical-stats', async (req, res) => {
        try {
            let hours = parseInt(req.query.hours || '168', 10);
            const resolution = parseInt(req.query.resolution || '60', 10);
            let startTime = null;
            let endTime = null;
            
            // Support time range query (startTime and endTime in milliseconds)
            if (req.query.startTime && req.query.endTime) {
                startTime = parseInt(req.query.startTime, 10);
                endTime = parseInt(req.query.endTime, 10);
                hours = Math.ceil((endTime - startTime) / (60 * 60 * 1000));
            }
            
            const cacheKey = `h${hours}_r${resolution}`;
            let data = cache.historicalStats && cache.historicalStats[cacheKey] ? cache.historicalStats[cacheKey] : null;
            
            if (!data) {
                data = await computeHistoricalStatsData(s3, readBucket, hours, resolution, getInMemoryState, startTime, endTime);
                if (!cache.historicalStats) cache.historicalStats = {};
                cache.historicalStats[cacheKey] = data;
                cache.lastPositionsProcessing = Date.now();
            }
            
            // If time range was specified, filter the time series to only include that range
            if (startTime && endTime && data.timeSeries) {
                const filtered = {
                    ...data,
                    timeSeries: data.timeSeries.filter(point => {
                        const pointTime = new Date(point.timestamp).getTime();
                        return pointTime >= startTime && pointTime <= endTime;
                    })
                };
                return res.json(filtered);
            }
            
            res.json(data);
        } catch (error) {
            console.error('Error computing historical stats:', error);
            res.status(500).json({ error: 'Failed to compute historical statistics' });
        }
    });

    // --- Restart Endpoint ---
    // Secure restart endpoint used by CI. Requires `RESTART_API_TOKEN` to be set in the server environment.
    // Accepts Authorization: Bearer <token> or X-Restart-Token header or JSON body { token: '<token>' }
    app.post('/api/restart', (req, res) => {
        try {
            const expectedToken = process.env.RESTART_API_TOKEN || '';
            if (!expectedToken) {
                logger.warn('[restart] Restart endpoint disabled: no RESTART_API_TOKEN set');
                return res.status(403).json({ error: 'Restart endpoint disabled on this server' });
            }

            const authHeader = (req.headers && req.headers.authorization) ? req.headers.authorization : '';
            logger.info('[restart] authHeader=' + authHeader);
            let providedToken = '';
            if (authHeader.toLowerCase().startsWith('bearer ')) {
                providedToken = authHeader.substring(7).trim();
            }
            if (!providedToken && req.headers['x-restart-token']) {
                providedToken = req.headers['x-restart-token'];
            }
            if (!providedToken && req.body && req.body.token) {
                providedToken = req.body.token;
            }

            if (!providedToken) {
                logger.warn('[restart] Missing restart token in request');
                return res.status(401).json({ error: 'Missing token' });
            }
            if (providedToken !== expectedToken) {
                logger.warn('[restart] Invalid restart token');
                return res.status(403).json({ error: 'Invalid token' });
            }

            // Authorized - perform restart
            res.json({ message: 'Server restarting (authorized) ...' });
            logger.info('[restart] Authorized restart triggered via API');

            // In test environment do not actually spawn or exit - just confirm authorization
            if (process.env.NODE_ENV === 'test') {
                logger.info('[restart] Test environment: simulated restart (no spawn)');
                return; // don't spawn or exit in tests
            }

            const { spawn } = require('child_process');
            const path = require('path');
            setTimeout(() => {
                const scriptPath = path.join(__dirname, '..', 'restart-server.ps1');
                // Execute PowerShell script in detached mode (cross-platform scripts may be chosen based on platform)
                if (process.platform === 'win32') {
                    const child = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath], { detached: true, stdio: 'ignore' });
                    child.unref();
                } else {
                    // Try bash restart script on unix-like
                    const scriptPathUnix = path.join(__dirname, '..', 'restart-server.sh');
                    const child = spawn('bash', [scriptPathUnix], { detached: true, stdio: 'ignore' });
                    child.unref();
                }
                setTimeout(() => process.exit(0), 500);
            }, 1000);
        } catch (err) {
            logger.error('[restart] Error while handling restart request:', err);
            console.error('[restart] Error stack:', err && err.stack);
            res.status(500).json({ error: 'Failed to trigger restart' });
        }
    });

    // --- PiAware Connectivity Status Endpoint ---
    app.get('/api/piaware-status', async (req, res) => {
        const config = require('../config');
        const piAwareUrl = config.dataSource.piAwareUrl;
        let originUrl = piAwareUrl;
        try {
            const u = new URL(piAwareUrl);
            originUrl = u.origin;
        } catch (err) {
            // if URL parsing fails, fall back to configured value
            originUrl = piAwareUrl;
        }

        try {
            const fetch = (await import('node-fetch')).default;
            
            // Fetch aircraft.json directly to get live aircraft count
            const aircraftJsonUrl = `${originUrl}/data/aircraft.json`;
            let aircraftCount = 0;
            let isConnected = false;
            
            try {
                const aircraftResponse = await fetch(aircraftJsonUrl, { timeout: 3000 });
                if (aircraftResponse.ok) {
                    const data = await aircraftResponse.json();
                    aircraftCount = data?.aircraft?.length || 0;
                    isConnected = true;
                    console.log(`PiAware aircraft.json: ${aircraftCount} aircraft`);
                }
            } catch (e) {
                console.log(`PiAware aircraft.json fetch failed: ${e.message}`);
                // Try root as fallback to check connectivity
                const response = await fetch(originUrl, { timeout: 3000 });
                isConnected = response.ok;
            }

            if (isConnected) {
                const state = getInMemoryState ? getInMemoryState() : {};
                res.json({
                    status: 'connected',
                    aircraft_count: aircraftCount,
                    url: originUrl,
                    receiver_lat: state.receiver_lat,
                    receiver_lon: state.receiver_lon
                });
            } else {
                res.status(response.status).json({
                    status: 'error',
                    message: `PiAware returned HTTP status ${response.status}`,
                    url: originUrl
                });
            }
        } catch (error) {
            console.error('PiAware status check failed:', error);
            let message = 'Failed to connect to PiAware.';
            if (error.name === 'AbortError') {
                message = 'Connection to PiAware timed out.';
            } else if (error.code === 'ECONNREFUSED') {
                message = 'Connection refused by PiAware device.';
            }
            res.status(500).json({
                status: 'unreachable',
                message: message,
                details: error.message,
                url: originUrl
            });
        }
    });

    // --- Health Check ---
    app.get('/api/health', (req, res) => {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            positionCacheReady: !!positionCache && positionCache.positions.length > 0,
            serverFilesModified: checkServerFilesModified()
        });
    });

    // --- Server Status: start time and commit info ---
    app.get('/api/server-status', (req, res) => {
        res.json({
            status: 'ok',
            serverStartIso,
            serverUptimeMs: Date.now() - serverStartTs,
            gitCommit: serverGitCommit,
            gitDirty: serverGitDirty,
            timestamp: new Date().toISOString()
        });
    });

    // --- Receiver Location Endpoint ---
    app.get('/api/receiver-location', (req, res) => {
        const state = getInMemoryState();
        res.json({
            lat: state.receiver_lat || 0,
            lon: state.receiver_lon || 0,
            available: typeof state.receiver_lat === 'number' && typeof state.receiver_lon === 'number'
        });
    });

    // --- Cache Status Endpoint ---
    app.get('/api/cache-status', async (req, res) => {
        try {
            const cacheStats = positionCache?.getStats() || {};
            const aircraftDbStats = aircraftDB.getStats();
            const aircraftTypesStats = aircraftTypesDB.getStats();
            
            // Calculate logo coverage statistics
            const airlineDatabase = await getAirlineDatabase(s3, readBucket);
            let airlinesWithLogos = 0;
            let cargoWithLogos = 0;
            let manufacturersWithLogos = 0;
            let totalAirlines = 0;
            let totalCargo = 0;
            let totalManufacturers = 0;
            
            if (airlineDatabase) {
                const manufacturerSet = new Set();
                for (const [code, data] of Object.entries(airlineDatabase)) {
                    if (data && typeof data === 'object' && data.name) {
                        const name = data.name.toLowerCase();
                        const isCargo = name.includes('cargo');
                        
                        if (isCargo) {
                            totalCargo++;
                            if (data.logo) {
                                cargoWithLogos++;
                            }
                        } else {
                            totalAirlines++;
                            if (data.logo) {
                                airlinesWithLogos++;
                            }
                        }
                    }
                    
                    // Check for manufacturer logos (entries that are manufacturer names)
                    if (data && typeof data === 'object' && data.name && !/^[A-Z]{3}$/.test(code)) {
                        manufacturerSet.add(data.name);
                        if (data.logo) {
                            manufacturersWithLogos++;
                        }
                    }
                }
                totalManufacturers = manufacturerSet.size;
            }
            
            // Count actual logos stored in S3
            let s3LogoCount = 0;
            try {
                const logoFiles = await listS3Files(s3, readBucket, 'logos/', 1000);
                s3LogoCount = logoFiles.length;
            } catch (error) {
                console.warn('Failed to count logos in S3:', error.message);
            }
            
            const stats = {
                positionCache: {
                    totalPositions: cacheStats.totalPositions || 0,
                    uniqueAircraft: cacheStats.uniqueAircraft || 0,
                    uniqueFlights: cacheStats.uniqueFlights || 0,
                    uniqueAirlines: cacheStats.uniqueAirlines || 0,
                    lastRefresh: cacheStats.lastRefresh || 'Never',
                    cacheMemoryMb: cacheStats.cacheMemoryMb || 0,
                    data: positionCache?.positionsByHex || {}
                },
                aircraftDatabase: {
                    loaded: aircraftDbStats.loaded,
                    aircraftCount: aircraftDbStats.aircraftCount,
                    source: aircraftDbStats.source,
                    downloaded: aircraftDbStats.downloaded
                },
                typeDatabase: {
                    loaded: aircraftTypesStats.loaded,
                    typeCount: aircraftTypesStats.typeCount,
                    created: aircraftTypesStats.created,
                    version: aircraftTypesStats.version
                },
                apiCache: {
                    historicalStats: Object.keys(cache.historicalStats || {}).length,
                    squawkTransitions: Object.keys(cache.squawkTransitions || {}).length,
                    airlineStats: Object.keys(cache.airlineStats || {}).length
                },
                logoCache: {
                    cachedLogos: Object.keys(cache.logoCache || {}).length,
                    totalRequests: cache.logoRequests || 0,
                    cacheHits: cache.logoCacheHits || 0,
                    cacheMisses: cache.logoCacheMisses || 0
                },
                logoCoverage: {
                    airlinesWithLogos: airlinesWithLogos,
                    totalAirlines: totalAirlines,
                    cargoWithLogos: cargoWithLogos,
                    totalCargo: totalCargo,
                    manufacturersWithLogos: manufacturersWithLogos,
                    totalManufacturers: totalManufacturers,
                    logosInS3: s3LogoCount
                },
                s3Operations: {
                    reads: cache.s3Reads || 0,
                    writes: cache.s3Writes || 0,
                    errors: cache.s3Errors || 0,
                    lastRead: cache.lastRead ? new Date(cache.lastRead).toISOString() : 'Never',
                    lastWrite: cache.lastWrite ? new Date(cache.lastWrite).toISOString() : 'Never'
                },
                lastProcessing: {
                    flights: cache.lastFlightsProcessing ? new Date(cache.lastFlightsProcessing).toISOString() : 'Never',
                    airlines: cache.lastAirlinesProcessing ? new Date(cache.lastAirlinesProcessing).toISOString() : 'Never',
                    squawks: cache.lastSquawksProcessing ? new Date(cache.lastSquawksProcessing).toISOString() : 'Never',
                    heatmap: cache.lastHeatmapProcessing ? new Date(cache.lastHeatmapProcessing).toISOString() : 'Never',
                    positions: cache.lastPositionsProcessing ? new Date(cache.lastPositionsProcessing).toISOString() : 'Never',
                    hourlyRollup: cache.lastHourlyRollup ? new Date(cache.lastHourlyRollup).toISOString() : 'Never'
                }
            };
            res.json(stats);
        } catch (error) {
            console.error('Error getting cache status:', error);
            res.status(500).json({ error: 'Failed to get cache status' });
        }
    });

    // --- Airline Database Endpoint ---
    app.get('/api/airline-database', async (req, res) => {
        try {
            const airlineDatabase = await getAirlineDatabase(s3, readBucket);
            res.json(airlineDatabase || {});
        } catch (error) {
            console.error('Error getting airline database:', error);
            res.status(500).json({ error: 'Failed to get airline database' });
        }
    });

    // --- UI Config Endpoint ---
    app.get('/api/config', (req, res) => {
        try {
            const config = require('../config-loader');
            console.log('Config loaded, accessing UI properties...');
            const result = {
                defaultTimeRanges: config.get('ui', 'defaultTimeRanges'),
                quickTimeButtons: config.get('ui', 'quickTimeButtons'),
                graph: config.get('ui', 'graph'),
                reception: config.get('ui', 'reception'),
                heatmap: {
                    ...config.get('ui', 'heatmap'),
                    mapCenter: config.mapCenter
                },
                table: config.get('ui', 'table'),
            };
            console.log('Config result:', JSON.stringify(result, null, 2));
            res.json(result);
        } catch (error) {
            console.error('Error loading config:', error);
            res.status(500).json({ error: 'Failed to load config' });
        }
    });

    // --- Aircraft Lookup Endpoint (ICAO24 to Registration) ---
    app.get('/api/aircraft/:icao24', (req, res) => {
        try {
            const icao24 = req.params.icao24;
            const aircraft = aircraftDB.lookup(icao24);
            
            if (!aircraft) {
                return res.status(404).json({ 
                    error: 'Aircraft not found',
                    icao24: icao24
                });
            }
            
            res.json({
                icao24: icao24.toLowerCase(),
                ...aircraft
            });
        } catch (error) {
            console.error('Error looking up aircraft:', error);
            res.status(500).json({ error: 'Failed to lookup aircraft' });
        }
    });

    // --- Aircraft Database Status ---
    app.get('/api/aircraft-database/status', (req, res) => {
        try {
            const stats = aircraftDB.getStats();
            res.json(stats);
        } catch (error) {
            console.error('Error getting aircraft database status:', error);
            res.status(500).json({ error: 'Failed to get database status' });
        }
    });

    // --- Batch Aircraft Lookup ---
    app.post('/api/aircraft/batch', (req, res) => {
        try {
            const icao24List = req.body.icao24 || [];
            
            if (!Array.isArray(icao24List)) {
                return res.status(400).json({ error: 'Request body must contain an array of icao24 codes' });
            }
            
            const results = {};
            for (const icao24 of icao24List) {
                const aircraft = aircraftDB.lookup(icao24);
                if (aircraft) {
                    results[icao24.toLowerCase()] = aircraft;
                }
            }
            
            res.json({
                requested: icao24List.length,
                found: Object.keys(results).length,
                results: results
            });
        } catch (error) {
            console.error('Error in batch aircraft lookup:', error);
            res.status(500).json({ error: 'Failed to lookup aircraft' });
        }
    });

        // --- Batch Flights Lookup (lightweight) ---
        // Accepts { icao24: ['a1b2c3', ...] } and returns { results: { '<icao>': { ... } } }
        // This endpoint is intentionally lightweight: it prefers in-memory active flights,
        // then falls back to aircraft DB entries. It avoids expensive S3 scans to keep
        // responses fast for frontend batch enrichment.
        app.post('/api/flights/batch', (req, res) => {
            try {
                const icao24List = req.body && req.body.icao24 ? req.body.icao24 : [];
                if (!Array.isArray(icao24List)) {
                    return res.status(400).json({ error: 'Request body must contain an array of icao24 codes' });
                }

                const results = {};
                const state = getInMemoryState ? getInMemoryState() : {};
                const activeFlights = state.activeFlights || {};

                for (const raw of icao24List) {
                    if (!raw) continue;
                    const lk = raw.toString().toLowerCase();

                    // Prefer an active flight if available
                    if (activeFlights && activeFlights[lk]) {
                        results[lk] = activeFlights[lk];
                        continue;
                    }

                    // Fallback to aircraft DB lookup (registration/type info)
                    try {
                        const aircraft = aircraftDB.lookup(raw);
                        if (aircraft) {
                            results[lk] = aircraft;
                            continue;
                        }
                    } catch (err) {
                        // ignore individual lookup errors
                    }
                }

                res.json({ requested: icao24List.length, found: Object.keys(results).length, results });
            } catch (error) {
                console.error('Error in batch flights lookup:', error);
                res.status(500).json({ error: 'Failed to lookup flights' });
            }
        });

    // --- Logo Serving Endpoint ---
    app.get('/api/v1logos/:airlineCode', async (req, res) => {
        try {
            // Initialize logo cache stats if not exists
            if (!cache.logoRequests) cache.logoRequests = 0;
            if (!cache.logoCacheHits) cache.logoCacheHits = 0;
            if (!cache.logoCacheMisses) cache.logoCacheMisses = 0;
            
            cache.logoRequests++;
            
            const airlineCode = req.params.airlineCode.toUpperCase();
            let logoKey = `logos/${airlineCode}.png`;

            // Check if logo is cached in memory
            if (!cache.logoCache) {
                cache.logoCache = {};
            }

            // Clear cache for CESSNA (temporary fix)
            if (airlineCode === 'CESSNA') {
                delete cache.logoCache[airlineCode];
            }

            if (cache.logoCache[airlineCode]) {
                // Serve from cache - handle both old and new cache formats
                cache.logoCacheHits++;
                const cached = cache.logoCache[airlineCode];
                if (cached.buffer && cached.contentType) {
                    // New format
                    res.setHeader('Content-Type', cached.contentType);
                    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
                    res.setHeader('X-Cache', 'HIT'); // Indicate cache hit
                    res.send(cached.buffer);
                } else {
                    // Old format (buffer only)
                    res.setHeader('Content-Type', 'image/png');
                    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
                    res.setHeader('X-Cache', 'HIT'); // Indicate cache hit
                    res.send(cached);
                }
                return;
            }

            // Cache miss - increment counter
            cache.logoCacheMisses++;

            // Try PNG first, then SVG
            let data;
            let contentType = 'image/png';
            try {
                const params = {
                    Bucket: readBucket,
                    Key: logoKey
                };
                data = await s3.send(new GetObjectCommand(params));
            } catch (pngError) {
                // Try SVG
                logoKey = `logos/${airlineCode}.svg`;
                contentType = 'image/svg+xml';
                const params = {
                    Bucket: readBucket,
                    Key: logoKey
                };
                data = await s3.send(new GetObjectCommand(params));
            }

            // Read the entire logo into memory as buffer
            const chunks = [];
            for await (const chunk of data.Body) {
                chunks.push(chunk);
            }
            const logoBuffer = Buffer.concat(chunks);

            // Cache the logo buffer with content type
            cache.logoCache[airlineCode] = { buffer: logoBuffer, contentType };

            // Set appropriate headers
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
            res.setHeader('X-Cache', 'MISS'); // Indicate cache miss

            // Send the logo data
            res.send(logoBuffer);

        } catch (error) {
            // If logo not found, return a default response
            res.status(404).json({ error: 'Logo not found' });
        }
    });

    // --- Logo Serving Endpoint v2 ---
    app.get('/api/v2logos/:airlineCode', async (req, res) => {
        try {
            // Initialize logo cache stats if not exists
            if (!cache.logoRequests) cache.logoRequests = 0;
            if (!cache.logoCacheHits) cache.logoCacheHits = 0;
            if (!cache.logoCacheMisses) cache.logoCacheMisses = 0;
            
            cache.logoRequests++;
            
            const airlineCode = req.params.airlineCode.toUpperCase();
            let logoKey = `logos/${airlineCode}.png`;

            // Check if logo is cached in memory
            if (!cache.logoCache) {
                cache.logoCache = {};
            }

            // Clear cache for CESSNA (temporary fix)
            if (airlineCode === 'CESSNA') {
                delete cache.logoCache[airlineCode];
            }

            if (cache.logoCache[airlineCode]) {
                // Serve from cache - handle both old and new cache formats
                cache.logoCacheHits++;
                const cached = cache.logoCache[airlineCode];
                if (cached.buffer && cached.contentType) {
                    // New format
                    res.setHeader('Content-Type', cached.contentType);
                    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
                    res.setHeader('X-Cache', 'HIT'); // Indicate cache hit
                    res.send(cached.buffer);
                } else {
                    // Old format (buffer only)
                    res.setHeader('Content-Type', 'image/png');
                    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
                    res.setHeader('X-Cache', 'HIT'); // Indicate cache hit
                    res.send(cached);
                }
                return;
            }

            // Cache miss - increment counter
            cache.logoCacheMisses++;

            // Try PNG first, then SVG
            let data;
            let contentType = 'image/png';
            try {
                const params = {
                    Bucket: readBucket,
                    Key: logoKey
                };
                data = await s3.send(new GetObjectCommand(params));
            } catch (pngError) {
                // Try SVG
                logoKey = `logos/${airlineCode}.svg`;
                contentType = 'image/svg+xml';
                const params = {
                    Bucket: readBucket,
                    Key: logoKey
                };
                data = await s3.send(new GetObjectCommand(params));
            }

            // Read the entire logo into memory as buffer
            const chunks = [];
            for await (const chunk of data.Body) {
                chunks.push(chunk);
            }
            const logoBuffer = Buffer.concat(chunks);

            // Cache the logo buffer with content type
            cache.logoCache[airlineCode] = { buffer: logoBuffer, contentType };

            // Set appropriate headers
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
            res.setHeader('X-Cache', 'MISS'); // Indicate cache miss

            // Send the logo data
            res.send(logoBuffer);

        } catch (error) {
            // If logo not found, return a default response
            res.status(404).json({ error: 'Logo not found' });
        }
    });

    // --- Aircraft Types Endpoint ---
    app.get('/api/aircraft-types', async (req, res) => {
        try {
            const fs = require('fs').promises;
            const data = await fs.readFile('aircraft_types.json', 'utf8');
            const aircraftTypes = JSON.parse(data);
            res.json(aircraftTypes);
        } catch (error) {
            console.error('Error loading aircraft types:', error);
            res.status(500).json({ error: 'Failed to load aircraft types' });
        }
    });

    // --- Airlines Endpoint ---
    app.get('/api/airlines', async (req, res) => {
        try {
            // Prefer the S3-backed airline database (keeps logos up-to-date).
            const airlineDatabase = await getAirlineDatabase(s3, readBucket);
            // Return the airline database object (fallback to empty object handled in getAirlineDatabase)
            return res.json(airlineDatabase);
        } catch (error) {
            console.error('Error loading airlines:', error);
            res.status(500).json({ error: 'Failed to load airlines' });
        }
    });

    // --- Heatmap Endpoint (uses cached in-memory data) ---
    app.get('/api/heatmap', async (req, res) => {
        try {
            const { airline, type, manufacturer, window } = req.query;
            
            // Load positions into memory if not already loaded (happens once at startup via background task)
            if (!allHeatmapPositions) {
                console.log('[heatmap] Positions not yet loaded in memory, loading now...');
                
                // Try to load from write bucket first (most recent data)
                try {
                    const minuteFiles = await listS3Files(s3, writeBucket, 'data/piaware_aircraft_log');
                    if (minuteFiles && minuteFiles.length > 0) {
                        console.log(`[heatmap] Found ${minuteFiles.length} minute files in write bucket`);
                        allHeatmapPositions = await loadHeatmapPositionsFromFiles(s3, writeBucket, minuteFiles);
                    }
                } catch (writeErr) {
                    console.log('[heatmap] Write bucket load failed, trying read bucket...');
                    const minuteFiles = await listS3Files(s3, readBucket, 'data/piaware_aircraft_log');
                    allHeatmapPositions = await loadHeatmapPositionsFromFiles(s3, readBucket, minuteFiles);
                }
                
                heatmapPositionsLastLoaded = Date.now();
                console.log(`[heatmap] Loaded ${allHeatmapPositions.length} positions into memory cache`);
            }
            
            if (!allHeatmapPositions || allHeatmapPositions.length === 0) {
                console.log('[heatmap] No positions available');
                return res.json([]);
            }
            
            // Use cached positions - no need to re-scan S3
            const combinedPositions = [...allHeatmapPositions];
            
            // Determine time window - use NOW as reference (not max timestamp in data)
            let cutoffTime = null;
            if (window && window !== 'all') {
                const now = Date.now();
                
                if (window === '1h') {
                    cutoffTime = new Date(now - 1 * 60 * 60 * 1000);
                } else if (window === '4h') {
                    cutoffTime = new Date(now - 4 * 60 * 60 * 1000);
                } else if (window === '6h') {
                    cutoffTime = new Date(now - 6 * 60 * 60 * 1000);
                } else if (window === '12h') {
                    cutoffTime = new Date(now - 12 * 60 * 60 * 1000);
                } else if (window === '24h') {
                    cutoffTime = new Date(now - 24 * 60 * 60 * 1000);
                } else if (window === '7d') {
                    cutoffTime = new Date(now - 7 * 24 * 60 * 60 * 1000);
                }
            }
            
            // Filter and aggregate positions
            const grid = {};
            const gridSize = 1.852 / 111; // ~1 nautical mile
            let filtered = 0;
            let windowFiltered = 0;
            
            for (const pos of combinedPositions) {
                // Apply time filter
                if (cutoffTime && pos.timestamp) {
                    let recordTime;
                    if (typeof pos.timestamp === 'string') {
                        recordTime = new Date(pos.timestamp);
                    } else if (typeof pos.timestamp === 'number') {
                        recordTime = new Date(pos.timestamp * 1000);
                    } else if (pos.timestamp instanceof Date) {
                        recordTime = pos.timestamp;
                    }
                    if (recordTime && recordTime < cutoffTime) {
                        windowFiltered++;
                        continue;
                    }
                }
                
                // Apply airline filter
                if (airline) {
                    const callsign = (pos.Flight || '').trim().toUpperCase();
                    if (callsign.length < 3 || !callsign.startsWith(airline.toUpperCase())) {
                        continue;
                    }
                }
                
                // Apply type filter
                if (type && (!pos.Aircraft_type || pos.Aircraft_type !== type)) {
                    continue;
                }
                
                // Apply manufacturer filter
                if (manufacturer && (!pos.manufacturer || pos.manufacturer !== manufacturer)) {
                    continue;
                }
                
                // Aggregate into grid cell
                const latIdx = Math.floor(pos.lat / gridSize);
                const lonIdx = Math.floor(pos.lon / gridSize);
                const key = `${latIdx},${lonIdx}`;
                
                if (!grid[key]) {
                    grid[key] = {
                        lat_min: latIdx * gridSize,
                        lat_max: (latIdx + 1) * gridSize,
                        lon_min: lonIdx * gridSize,
                        lon_max: (lonIdx + 1) * gridSize,
                        count: 0
                    };
                }
                grid[key].count++;
                filtered++;
            }
            
            const gridData = Object.values(grid);
            console.log(`[heatmap] Window=${window} cutoff=${cutoffTime ? cutoffTime.toISOString() : 'none'} → Filtered ${filtered}/${combinedPositions.length} (${windowFiltered} outside window) → ${gridData.length} cells (mfg=${manufacturer}, type=${type}, airline=${airline})`);
            
            res.json(gridData);
            
        } catch (error) {
            console.error('Error in heatmap endpoint:', error);
            res.status(500).json({ error: 'Failed to generate heatmap data', details: error.message });
        }
    });
    
    // Helper function to load positions from S3 files into memory
    async function loadHeatmapPositionsFromFiles(s3, bucket, minuteFiles) {
        if (!minuteFiles || minuteFiles.length === 0) {
            console.log('[heatmap] No minute files provided');
            return [];
        }
        
        const allPositions = [];
        const sortedFiles = minuteFiles.sort((a, b) => b.Key.localeCompare(a.Key));
        const filesToLoad = sortedFiles.slice(0, Math.min(sortedFiles.length, 10000));
        
        console.log(`[heatmap] Loading ${filesToLoad.length} files into memory with enrichment...`);
        
        // Load aircraft cache for enrichment
        const cache = await loadAircraftCache();
        
        let loadedCount = 0;
        let enrichedCount = 0;
        
        for (const file of filesToLoad) {
            try {
                const data = await downloadAndParseS3File(s3, bucket, file.Key);
                if (data) {
                    const positions = Array.isArray(data) ? data : [data];
                    const validPositions = positions.filter(pos => {
                        if (!pos) return false;
                        const lat = pos.lat || pos.Latitude || pos.latitude;
                        const lon = pos.lon || pos.Longitude || pos.longitude;
                        return lat && lon && typeof lat === 'number' && typeof lon === 'number';
                    }).map(pos => {
                        // Normalize position data
                        const icao = pos.ICAO || pos.hex || pos.icao;
                        let aircraftType = pos.Aircraft_type || pos.type || pos.aircraft_type;
                        
                        // Enrich with aircraft database (get typecode)
                        if (icao && cache.aircraft && cache.aircraft[icao] && cache.aircraft[icao].typecode) {
                            aircraftType = cache.aircraft[icao].typecode;
                            enrichedCount++;
                        }
                        
                        // Enrich with type info (manufacturer, body type)
                        let manufacturer = pos.manufacturer;
                        let bodyType = pos.bodyType;
                        if (aircraftType && aircraftType !== 'N/A') {
                            const typeInfo = aircraftTypesDB.lookup(aircraftType);
                            if (typeInfo) {
                                manufacturer = typeInfo.manufacturer;
                                bodyType = typeInfo.bodyType;
                            }
                        }
                        
                        return {
                            lat: pos.lat || pos.Latitude || pos.latitude,
                            lon: pos.lon || pos.Longitude || pos.longitude,
                            timestamp: pos.timestamp || pos.Timestamp || pos.First_Seen || pos.Last_Seen || file.LastModified,
                            Aircraft_type: aircraftType,
                            Flight: pos.Flight || pos.flight || pos.callsign,
                            manufacturer: manufacturer,
                            bodyType: bodyType,
                            ICAO: icao,
                            Registration: pos.Registration || pos.registration
                        };
                    });
                    
                    allPositions.push(...validPositions);
                    loadedCount++;
                }
            } catch (err) {
                console.warn(`[heatmap] Error loading ${file.Key}: ${err.message}`);
            }
        }
        
        console.log(`[heatmap] Loaded ${allPositions.length} positions from ${loadedCount} files (enriched ${enrichedCount} with aircraft DB)`);
        return allPositions;
    }

    // Endpoint to clear heatmap cache
    app.get('/api/heatmap-cache-clear', (req, res) => {
        clearHeatmapCache();
        res.json({ message: 'Heatmap cache cleared' });
    });

    // Debug endpoint to check heatmap data loading stats
    app.get('/api/heatmap-stats', async (req, res) => {
        try {
            const allPositions = await loadAllHeatmapPositions(s3, readBucket);
            
            // Count positions with and without aircraft type
            let withType = 0, withoutType = 0, withManufacturer = 0;
            const manufacturerCounts = {};
            const typeCounts = {};
            let minTimestamp = Infinity, maxTimestamp = -Infinity;
            
            for (const pos of allPositions) {
                if (pos.Aircraft_type && pos.Aircraft_type !== 'N/A') {
                    withType++;
                    typeCounts[pos.Aircraft_type] = (typeCounts[pos.Aircraft_type] || 0) + 1;
                } else {
                    withoutType++;
                }
                
                if (pos.manufacturer) {
                    withManufacturer++;
                    manufacturerCounts[pos.manufacturer] = (manufacturerCounts[pos.manufacturer] || 0) + 1;
                }
                
                // Track timestamp range
                if (pos.timestamp) {
                    let ts;
                    if (typeof pos.timestamp === 'number') {
                        ts = pos.timestamp < 10000000000 ? pos.timestamp * 1000 : pos.timestamp;
                    } else if (typeof pos.timestamp === 'string') {
                        ts = new Date(pos.timestamp).getTime();
                    }
                    if (ts && !isNaN(ts)) {
                        minTimestamp = Math.min(minTimestamp, ts);
                        maxTimestamp = Math.max(maxTimestamp, ts);
                    }
                }
            }
            
            // Get top manufacturers
            const topManufacturers = Object.entries(manufacturerCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10);
            
            // Get top types
            const topTypes = Object.entries(typeCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10);
            
            // Calculate date range
            let dateRangeInfo = {
                hasTimestamps: minTimestamp !== Infinity && maxTimestamp !== -Infinity
            };
            if (dateRangeInfo.hasTimestamps) {
                dateRangeInfo.minDate = new Date(minTimestamp).toISOString();
                dateRangeInfo.maxDate = new Date(maxTimestamp).toISOString();
                dateRangeInfo.spanDays = Math.round((maxTimestamp - minTimestamp) / (1000 * 60 * 60 * 24));
                dateRangeInfo.spanHours = Math.round((maxTimestamp - minTimestamp) / (1000 * 60 * 60));
            }
            
            res.json({
                totalPositions: allPositions.length,
                positionsWithType: withType,
                positionsWithoutType: withoutType,
                positionsWithManufacturer: withManufacturer,
                topManufacturers: Object.fromEntries(topManufacturers),
                topTypes: Object.fromEntries(topTypes),
                dateRange: dateRangeInfo
            });
        } catch (error) {
            console.error('Error in heatmap-stats endpoint:', error);
            res.status(500).json({ error: 'Failed to get heatmap stats', details: error.message });
        }
    });

    // --- Positions Endpoint ---
    app.get('/api/positions', async (req, res) => {
        try {
            const hours = parseInt(req.query.hours || '24', 10);
            // Try to get positions from cache first, fall back to enriched historical positions
            let positions = positionCache?.getPositionsByTimeWindow(hours);
            if (!positions || positions.length === 0) {
                // Fall back to enriched historical positions from heatmap loading
                positions = (await loadAllHeatmapPositions(s3, readBucket)) || [];
            }
            const aircraftCount = new Set(positions.map(p => p.hex)).size;
            res.json({
                aircraftCount,
                positions
            });
        } catch (error) {
            console.error('Error in positions endpoint:', error);
            res.status(500).json({ error: 'Failed to get positions' });
        }
    });

    // --- Squawk Lookup Endpoint ---
    // Returns the most-recent squawk value known for a given hex (icao24)
    app.get('/api/squawk', async (req, res) => {
        try {
            const hexRaw = (req.query.hex || '').toString().trim();
            if (!hexRaw) return res.status(400).json({ error: 'Missing hex parameter' });
            const hex = hexRaw.toLowerCase();

            // Attempt to find recent positions for this hex and return the newest squawk
            const positions = positionCache?.getAircraftPositions(hex) || [];
            let squawk = null;
            if (Array.isArray(positions) && positions.length > 0) {
                for (const p of positions) {
                    if (p && (p.squawk || p.sqk)) {
                        squawk = p.squawk || p.sqk || null;
                        if (squawk) break; // Found a squawk, no need to look further
                    }
                }
            }

            // If no squawk found in live data, check historical data
            if (!squawk && allHeatmapPositions) {
                const historicalPositions = allHeatmapPositions.filter(p => p.hex === hex && (p.squawk || p.sqk));
                if (historicalPositions.length > 0) {
                    // Sort by timestamp descending to get the most recent
                    historicalPositions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                    squawk = historicalPositions[0].squawk || historicalPositions[0].sqk || null;
                }
            }

            return res.json({ squawk });
        } catch (err) {
            console.error('[squawk-api] Error:', err);
            res.status(500).json({ error: 'Failed to lookup squawk' });
        }
    });

    // --- Lightweight Flight Lookup (single aircraft) ---
    // Returns a small `flight` object for a given icao/hex to support client-side polling
    app.get('/api/flight', async (req, res) => {
        try {
            const icaoRaw = (req.query.icao || req.query.hex || '').toString().trim();
            if (!icaoRaw) return res.status(400).json({ error: 'Missing icao/hex parameter' });
            const icao = icaoRaw.toLowerCase();

            // Pull recent positions for this aircraft
            const positions = positionCache?.getAircraftPositions(icao) || [];
            if (!positions || positions.length === 0) return res.status(404).json({ error: 'No data' });

            // Use the most recent position as the source of basic flight metadata
            const recent = positions[0];
            const flight = {
                icao: recent.hex,
                flight: recent.callsign || recent.flight || '',
                callsign: recent.callsign || recent.flight || '',
                registration: recent.registration || recent.Reg || '',
                squawk: recent.squawk || recent.sqk || null,
                sqk: recent.squawk || recent.sqk || null,
                lat: recent.lat,
                lon: recent.lon,
                alt: recent.alt,
                gs: recent.gs,
                track: recent.track || recent.heading || null,
                timestamp: recent.timestamp
            };

            return res.json({ flight });
        } catch (err) {
            console.error('[flight-api] Error:', err);
            res.status(500).json({ error: 'Failed to fetch flight' });
        }
    });

    // --- Track endpoint ---
    // Returns recent track points for an aircraft hex over the requested minutes window
    app.get('/api/track', async (req, res) => {
        try {
            const hexRaw = (req.query.hex || req.query.icao || '').toString().trim();
            if (!hexRaw) return res.status(400).json({ error: 'Missing hex parameter' });
            const hex = hexRaw.toLowerCase();
            const minutes = Math.max(1, parseInt(req.query.minutes || '10', 10));

            // Retrieve positions for this aircraft from the in-memory cache
            const positions = positionCache?.getAircraftPositions(hex) || [];
            if (!positions || positions.length === 0) return res.status(404).json({ track: [] });

            const cutoff = Date.now() - (minutes * 60 * 1000);
            // Filter positions by cutoff (if timestamp present) and normalize fields
            const pts = positions
                .filter(p => !p.timestamp || p.timestamp >= cutoff)
                .map(p => ({ lat: p.lat, lon: p.lon, alt: (p.alt || p.altitude || null), timestamp: p.timestamp }))
                .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

            // Calculate vertical rates for each point (feet per minute)
            for (let i = 0; i < pts.length; i++) {
                if (i === 0) {
                    pts[i].vertical_rate = 0; // No previous point to calculate from
                } else {
                    const prev = pts[i - 1];
                    const curr = pts[i];
                    const timeDiffSeconds = (curr.timestamp - prev.timestamp) / 1000;
                    const altDiffFeet = (curr.alt || 0) - (prev.alt || 0);

                    if (timeDiffSeconds > 0 && timeDiffSeconds < 300) { // Valid time diff (max 5 minutes)
                        pts[i].vertical_rate = (altDiffFeet / timeDiffSeconds) * 60; // Convert to feet per minute
                    } else {
                        pts[i].vertical_rate = 0;
                    }
                }
            }

            return res.json({ track: pts });
        } catch (err) {
            console.error('[track-api] Error:', err);
            res.status(500).json({ error: 'Failed to fetch track' });
        }
    });
}


module.exports = { setupApiRoutes };
