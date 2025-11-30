const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { listS3Files, downloadAndParseS3File } = require('./s3-helpers');
const { getAirlineDatabase } = require('./databases');
const { computeAirlineStatsData, computeSquawkTransitionsData, computeSquawkTransitionsDataByTimeRange, computeHistoricalStatsData } = require('./aggregators');
const aircraftDB = require('./aircraft-database');
const aircraftTypesDB = require('./aircraft-types-db');

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
                }
                
                // liveFlights were added to allFlights and handled in the loop above; no need to push again
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
                hours = 24;
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
    app.post('/api/restart', (req, res) => {
        res.json({ message: 'Server restarting...' });
        
        // Use child_process to execute the restart script
        const { spawn } = require('child_process');
        const path = require('path');
        
        setTimeout(() => {
            const scriptPath = path.join(__dirname, '..', 'restart-server.ps1');
            
            // Execute PowerShell script in detached mode
            const child = spawn('powershell.exe', [
                '-ExecutionPolicy', 'Bypass',
                '-File', scriptPath
            ], {
                detached: true,
                stdio: 'ignore'
            });
            
            child.unref();
            
            // Exit current process after spawning restart script
            setTimeout(() => process.exit(0), 500);
        }, 1000);
    });

    // --- PiAware Connectivity Status Endpoint ---
    app.get('/api/piaware-status', async (req, res) => {
        const config = require('../config');
        const piAwareUrl = config.dataSource.piAwareUrl;

        try {
            const fetch = (await import('node-fetch')).default;
            const response = await fetch(piAwareUrl, { timeout: 3000 });

            if (response.ok) {
                const data = await response.json();
                res.json({
                    status: 'connected',
                    aircraft_count: data?.aircraft?.length || 0,
                    url: piAwareUrl
                });
            } else {
                res.status(response.status).json({
                    status: 'error',
                    message: `PiAware returned HTTP status ${response.status}`,
                    url: piAwareUrl
                });
            }
        } catch (error) {
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
                url: piAwareUrl
            });
        }
    });

    // --- Health Check ---
    app.get('/api/health', (req, res) => {
        res.json({ 
            status: 'ok', 
            timestamp: new Date().toISOString(),
            positionCacheReady: !!positionCache && positionCache.positions.length > 0
        });
    });

    // --- Cache Status Endpoint ---
    app.get('/api/cache-status', (req, res) => {
        try {
            const cacheStats = positionCache?.getStats() || {};
            const aircraftDbStats = aircraftDB.getStats();
            const aircraftTypesStats = aircraftTypesDB.getStats();
            
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
            const config = require('../config');
            res.json({
                defaultTimeRanges: config.ui.defaultTimeRanges,
                quickTimeButtons: config.ui.quickTimeButtons,
                graph: config.ui.graph,
                reception: config.ui.reception,
                heatmap: config.ui.heatmap,
                table: config.ui.table,
            });
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

    // --- Logo Serving Endpoint ---
    app.get('/api/v1logos/:airlineCode', async (req, res) => {
        try {
            const airlineCode = req.params.airlineCode.toUpperCase();
            const logoKey = `logos/${airlineCode}.png`;

            // Check if logo is cached in memory
            if (!cache.logoCache) {
                cache.logoCache = {};
            }

            if (cache.logoCache[airlineCode]) {
                // Serve from cache
                res.setHeader('Content-Type', 'image/png');
                res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
                res.setHeader('X-Cache', 'HIT'); // Indicate cache hit
                res.send(cache.logoCache[airlineCode]);
                return;
            }

            // Try to get the logo from S3
            const params = {
                Bucket: readBucket,
                Key: logoKey
            };

            const data = await s3.send(new GetObjectCommand(params));

            // Read the entire logo into memory as buffer
            const chunks = [];
            for await (const chunk of data.Body) {
                chunks.push(chunk);
            }
            const logoBuffer = Buffer.concat(chunks);

            // Cache the logo buffer in memory
            cache.logoCache[airlineCode] = logoBuffer;

            // Set appropriate headers for PNG
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
            res.setHeader('X-Cache', 'MISS'); // Indicate cache miss

            // Send the logo data
            res.send(logoBuffer);

        } catch (error) {
            // If logo not found, return a default response
            res.status(404).json({ error: 'Logo not found' });
        }
    });

}

module.exports = { setupApiRoutes };
