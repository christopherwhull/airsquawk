const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { listS3Files, downloadAndParseS3File } = require('./s3-helpers');
const { getAirlineDatabase } = require('./databases');
const { computeAirlineStatsData, computeSquawkTransitionsData, computeSquawkTransitionsDataByTimeRange, computeHistoricalStatsData } = require('./aggregators');

function setupApiRoutes(app, s3, readBucket, writeBucket, getInMemoryState, cache = {}, positionCache = null) {
    
    // --- Heatmap Data Endpoint ---
    app.get('/api/heatmap-data', async (req, res) => {
        try {
            const hours = parseInt(req.query.hours || '24', 10);
            const positions = positionCache?.getPositionsByTimeWindow(hours) || getInMemoryState()?.positions || [];
            
            const grid = {};
            const gridSize = 0.01;
            
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
            const minutes = parseInt(req.query.minutes || '10', 10);
            const resolution = parseInt(req.query.resolution || '1', 10);
            
            // Get positions from live memory (last N minutes)
            const now = Date.now();
            const cutoff = now - (minutes * 60 * 1000);
            
            // Get state from in-memory tracking
            const state = getInMemoryState ? getInMemoryState() : {};
            const positionHistory = state.positionHistory || [];
            
            // Filter positions by time window
            const windowPositions = positionHistory.filter(p => p.timestamp && p.timestamp > cutoff);
            
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
                        airlineCount: new Set()
                    };
                }
                
                buckets[bucketTime].positionCount++;
                if (pos.hex) buckets[bucketTime].aircraftCount.add(pos.hex);
                if (pos.flight && pos.flight.trim()) buckets[bucketTime].flightCount.add(pos.flight);
                if (pos.airline && pos.airline.trim()) buckets[bucketTime].airlineCount.add(pos.airline);
            }
            
            // Convert to array and compute final counts
            const timeseries = Object.values(buckets)
                .map(bucket => ({
                    timestamp: bucket.timestamp,
                    positionCount: bucket.positionCount,
                    aircraftCount: bucket.aircraftCount.size,
                    flightCount: bucket.flightCount.size,
                    airlineCount: bucket.airlineCount.size
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
                
                // Altitude band (0-1000, 1000-2000, etc.)
                const altBand = Math.floor(altitude / 1000) * 1000;
                
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
            
            const s3Files = await listS3Files(s3, writeBucket, 'flights/', 1000, 1);
            cache.s3Reads = (cache.s3Reads || 0) + 1;
            cache.lastRead = Date.now();
            const flightFiles = (s3Files || []).filter(f => 
                f.Key && (f.Key.startsWith('flights/hourly/') || f.Key.startsWith('flights/daily/'))
            );
            
            let allFlights = [];
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
                        if (startTime > timeCutoff) {
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
                            allFlights.push(fl);
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
                const endTime = new Date(fl.end_time).getTime();
                if (now - endTime <= gapMs) {
                    active.push(fl);
                } else {
                    completed.push(fl);
                }
            }
            
            if (getInMemoryState) {
                const state = getInMemoryState();
                const liveFlights = Object.values(state.activeFlights || {});
                active.push(...liveFlights);
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
            
            // Wrap in expected structure for UI
            const data = {
                minute: { byAirline: {} },
                hourly: { byAirline: statsData.byAirline || {} },
                memory: { byAirline: {} }
            };
            
            if (!cache.airlineStats) cache.airlineStats = {};
            cache.airlineStats[cacheKey] = data;
            
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
            
            // Check if time range parameters are provided
            if (req.query.startTime && req.query.endTime) {
                startTime = parseInt(req.query.startTime, 10);
                endTime = parseInt(req.query.endTime, 10);
                hours = Math.round((endTime - startTime) / (60 * 60 * 1000));
                
                const cacheKey = `${startTime}-${endTime}`;
                if (cache.squawkTransitions && cache.squawkTransitions[cacheKey]) {
                    return res.json(cache.squawkTransitions[cacheKey]);
                }
                
                const data = await computeSquawkTransitionsDataByTimeRange(s3, readBucket, startTime, endTime, 'both');
                if (!cache.squawkTransitions) cache.squawkTransitions = {};
                cache.squawkTransitions[cacheKey] = data;
                
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
                
                const data = await computeSquawkTransitionsData(s3, readBucket, hours, 'both');
                if (!cache.squawkTransitions) cache.squawkTransitions = {};
                cache.squawkTransitions[cacheKey] = data;
                
                return res.json(data);
            }
        } catch (error) {
            console.error('Error computing squawk transitions:', error);
            // Return default structure on error instead of error object
            res.json({ 
                toVfrCount: 0,
                fromVfrCount: 0,
                ifrToIfrCount: 0,
                toSpecialCount: 0,
                fromSpecialCount: 0,
                recentToVfr: [],
                recentFromVfr: [],
                recentIfr: [],
                recentLowToHigh: [],
                recentHighToLow: [],
                recentToSpecial: [],
                recentFromSpecial: [],
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
                data = await computeHistoricalStatsData(s3, readBucket, hours, resolution, getInMemoryState);
                if (!cache.historicalStats) cache.historicalStats = {};
                cache.historicalStats[cacheKey] = data;
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
        setTimeout(() => process.exit(0), 1000);
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
            const stats = {
                positionCache: {
                    totalPositions: positionCache?.positions?.length || 0,
                    uniqueAircraft: Object.keys(positionCache?.positionsByHex || {}).length,
                    lastRefresh: positionCache?.lastRefresh ? new Date(positionCache.lastRefresh).toISOString() : 'Never',
                    cacheMemoryMb: positionCache ? (JSON.stringify(positionCache.positions).length / 1024 / 1024).toFixed(2) : 0,
                    data: positionCache?.positionsByHex || {}
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
}

module.exports = { setupApiRoutes };
