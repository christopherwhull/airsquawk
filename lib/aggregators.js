const { listS3Files, downloadAndParseS3File } = require('./s3-helpers');
const { getAirlineDatabase } = require('./databases');
const aircraftTypesDB = require('./aircraft-types-db');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

async function computeAirlineStatsFromTSDB(s3, readBucket, writeBucket, windowStr, timeCutoff) {
    try {
        let hours = 1;
        if (windowStr.endsWith('h')) {
            hours = parseInt(windowStr.slice(0, -1), 10);
        } else if (windowStr.endsWith('d')) {
            hours = parseInt(windowStr.slice(0, -1), 10) * 24;
        }

        // Load TSDB configuration
        const configPath = path.join(__dirname, '..', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const tsdbConfig = config.tsdb;

        if (!tsdbConfig || !tsdbConfig.url || !tsdbConfig.token) {
            throw new Error('TSDB configuration not found or incomplete');
        }

        // Load airline database
        let airlineDatabase = {};
        try {
            airlineDatabase = await Promise.race([
                getAirlineDatabase(s3, readBucket),
                new Promise((resolve) => setTimeout(() => resolve({}), 5000))
            ]);
            if (!airlineDatabase || Object.keys(airlineDatabase).length === 0) {
                console.warn('[airline-stats-tsdb] Airline database unavailable or empty; proceeding without it');
                airlineDatabase = {};
            }
        } catch (err) {
            console.warn('[airline-stats-tsdb] Failed to load airline database:', err && err.message ? err.message : err);
            airlineDatabase = {};
        }

        // Query TSDB for flight data
        const query = `
        SELECT
            time,
            icao,
            flight,
            type
        FROM ${tsdbConfig.tsdb_measurement || 'aircraft_positions_v2'}
        WHERE time >= NOW() - INTERVAL '${hours} hours'
          AND flight IS NOT NULL
          AND icao IS NOT NULL
        ORDER BY time DESC
        `;

        const url = `${tsdbConfig.url}/api/v3/query_sql`;
        const payload = {
            db: tsdbConfig.db,
            format: 'json',
            q: query.trim()
        };

        const tsdbData = await new Promise((resolve, reject) => {
            const httpModule = url.startsWith('https://') ? https : http;
            const req = httpModule.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tsdbConfig.token}`,
                    'Connection': 'keep-alive'
                }
            });

            let data = '';
            req.on('response', (res) => {
                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        if (res.statusCode === 200 && data) {
                            resolve(JSON.parse(data));
                        } else {
                            resolve([]);
                        }
                    } catch (e) {
                        console.warn('[airline-stats-tsdb] Failed to parse TSDB response:', e.message);
                        resolve([]);
                    }
                });
            });

            req.on('error', (err) => {
                console.warn('[airline-stats-tsdb] TSDB query failed:', err.message);
                resolve([]);
            });

            req.write(JSON.stringify(payload));
            req.end();
        });

        console.log(`[airline-stats-tsdb] Retrieved ${tsdbData.length} records from TSDB`);

        // Process TSDB data into airline stats
        const airlineStats = {};
        const seenFlights = new Set();

        for (const record of tsdbData) {
            const flight = record.flight || '';
            const icao = record.icao || '';
            const recordTime = new Date(record.time).getTime();

            if (!flight || !icao || recordTime < timeCutoff) continue;

            const flightIdentifier = `${flight}|${icao}`;
            if (seenFlights.has(flightIdentifier)) continue;
            seenFlights.add(flightIdentifier);

            const airlineCode = flight.substring(0, 3).toUpperCase();
            if (airlineCode.length === 3) {
                let airlineName = 'Unknown';
                if (airlineDatabase && airlineDatabase[airlineCode]) {
                    const dbEntry = airlineDatabase[airlineCode];
                    airlineName = typeof dbEntry === 'string' ? dbEntry : (dbEntry.name || 'Unknown');
                }

                if (!airlineStats[airlineName]) {
                    airlineStats[airlineName] = { code: airlineCode, count: 0, aircraft: new Set(), lastSeen: 0, typeCounts: {}, manufacturerCounts: {} };
                }

                airlineStats[airlineName].count++;
                airlineStats[airlineName].aircraft.add(icao);
                if (recordTime > airlineStats[airlineName].lastSeen) {
                    airlineStats[airlineName].lastSeen = recordTime;
                }

                // Track types and manufacturers
                const flightType = record.type || '';
                if (flightType) {
                    airlineStats[airlineName].typeCounts[flightType] = (airlineStats[airlineName].typeCounts[flightType] || 0) + 1;
                    const typeInfo = aircraftTypesDB.lookup(flightType);
                    const manu = (typeInfo && typeInfo.manufacturer) ? typeInfo.manufacturer : 'Unknown';
                    airlineStats[airlineName].manufacturerCounts[manu] = (airlineStats[airlineName].manufacturerCounts[manu] || 0) + 1;
                } else {
                    airlineStats[airlineName].manufacturerCounts['Unknown'] = (airlineStats[airlineName].manufacturerCounts['Unknown'] || 0) + 1;
                }
            }
        }

        // Build final stats object
        const finalStats = {};
        for (const airline in airlineStats) {
            const typeCounts = airlineStats[airline].typeCounts || {};
            const manufacturerCounts = airlineStats[airline].manufacturerCounts || {};
            const topType = Object.keys(typeCounts).length ? Object.keys(typeCounts).reduce((a, b) => typeCounts[a] > typeCounts[b] ? a : b) : null;
            const topManufacturer = Object.keys(manufacturerCounts).length ? Object.keys(manufacturerCounts).reduce((a, b) => manufacturerCounts[a] > manufacturerCounts[b] ? a : b) : null;

            finalStats[airline] = {
                code: airlineStats[airline].code,
                count: airlineStats[airline].count,
                aircraft: airlineStats[airline].aircraft.size,
                lastSeen: airlineStats[airline].lastSeen,
                topType: topType,
                manufacturers: manufacturerCounts,
                topManufacturer: topManufacturer,
                logo: (airlineDatabase && airlineDatabase[airlineStats[airline].code]) ?
                    (typeof airlineDatabase[airlineStats[airline].code] === 'string' ? null : airlineDatabase[airlineStats[airline].code].logo) : null,
                topManufacturerLogo: topManufacturer ? (() => {
                    const manufacturerEntry = Object.entries(airlineDatabase || {}).find(([code, data]) =>
                        data.name === topManufacturer
                    );
                    return manufacturerEntry ? (typeof manufacturerEntry[1] === 'string' ? null : manufacturerEntry[1].logo) : null;
                })() : null
            };
        }

        return {
            byAirline: finalStats,
            uniqueAirlines: Object.keys(finalStats).length,
            totalFlights: Object.values(finalStats).reduce((sum, airline) => sum + airline.count, 0),
            totalAircraft: Object.values(finalStats).reduce((sum, airline) => sum + airline.aircraft, 0)
        };

    } catch (error) {
        console.error('[airline-stats-tsdb] Error computing airline stats from TSDB:', error);
        throw error;
    }
}

async function computeAirlineStatsData(s3, readBucket, writeBucket, windowStr = '1h') {
    try {
        let hours = 1;
        if (windowStr.endsWith('h')) {
            hours = parseInt(windowStr.slice(0, -1), 10);
        } else if (windowStr.endsWith('d')) {
            hours = parseInt(windowStr.slice(0, -1), 10) * 24;
        }
        const now = Date.now();
        const timeCutoff = now - (hours * 60 * 60 * 1000);

        // Check if TSDB has data before the time cutoff - if so, use TSDB instead of S3 files
        let useTSDB = false;
        try {
            const configPath = path.join(__dirname, '..', 'config.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const tsdbConfig = config.tsdb;

            if (tsdbConfig && tsdbConfig.url && tsdbConfig.token && tsdbConfig.db) {
                // Query for the earliest record in TSDB
                const earliestQuery = `
                SELECT time
                FROM ${tsdbConfig.tsdb_measurement || 'aircraft_positions_v2'}
                WHERE time >= NOW() - INTERVAL '${hours} hours'
                  AND flight IS NOT NULL
                ORDER BY time ASC
                LIMIT 1
                `;

                const url = `${tsdbConfig.url}/api/v3/query_sql`;
                const payload = {
                    db: tsdbConfig.db,
                    format: 'json',
                    q: earliestQuery.trim()
                };

                const earliestRecord = await new Promise((resolve, reject) => {
                    const httpModule = url.startsWith('https://') ? https : http;
                    const req = httpModule.request(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${tsdbConfig.token}`,
                            'Connection': 'keep-alive'
                        }
                    });

                    let data = '';
                    req.on('response', (res) => {
                        res.on('data', (chunk) => {
                            data += chunk;
                        });

                        res.on('end', () => {
                            try {
                                if (res.statusCode === 200 && data) {
                                    const result = JSON.parse(data);
                                    resolve(result.length > 0 ? result[0] : null);
                                } else {
                                    resolve(null);
                                }
                            } catch (e) {
                                resolve(null);
                            }
                        });
                    });

                    req.on('error', (err) => {
                        resolve(null);
                    });

                    req.write(JSON.stringify(payload));
                    req.end();
                });

                if (earliestRecord && earliestRecord.time) {
                    // Parse the timestamp - TSDB returns nanosecond precision
                    const earliestTime = new Date(earliestRecord.time).getTime();
                    if (earliestTime < timeCutoff) {
                        console.log(`[airline-stats] TSDB has data before cutoff (${new Date(earliestTime).toISOString()}), using TSDB for airline stats`);
                        useTSDB = true;
                    }
                }
            }
        } catch (tsdbError) {
            console.warn('[airline-stats] Failed to check TSDB availability:', tsdbError.message);
        }

        if (useTSDB) {
            return await computeAirlineStatsFromTSDB(s3, readBucket, writeBucket, windowStr, timeCutoff);
        }

        // List flight files (limited to 1 page) first, then try to load airline DB with a short timeout
        const s3Files = await listS3Files(s3, writeBucket, 'flights/', 1000, 1);

        let airlineDatabase = {};
        try {
            // If getAirlineDatabase takes too long (e.g., many SDK requests queued), fall back to empty DB
            airlineDatabase = await Promise.race([
                getAirlineDatabase(s3, readBucket),
                new Promise((resolve) => setTimeout(() => resolve({}), 5000))
            ]);
            if (!airlineDatabase || Object.keys(airlineDatabase).length === 0) {
                console.warn('[airline-stats] Airline database unavailable or empty; proceeding without it');
                airlineDatabase = {};
            }
        } catch (err) {
            console.warn('[airline-stats] Failed to load airline database:', err && err.message ? err.message : err);
            airlineDatabase = {};
        }

        const airlineStats = {};
        const seenFlights = new Set();
        const { GetObjectCommand } = require('@aws-sdk/client-s3');

        // Determine file timestamps from key (matches 20251114_1900 style)
        function getFlightFileTimestamp(key) {
            const match = key.match(/(\d{8})_(\d{4})/);
            if (!match) return null;
            const date = match[1]; const time = match[2];
            const year = parseInt(date.substring(0,4), 10);
            const month = parseInt(date.substring(4,6), 10) - 1;
            const day = parseInt(date.substring(6,8), 10);
            const hour = parseInt(time.substring(0,2), 10);
            const minute = parseInt(time.substring(2,4), 10);
            return Date.UTC(year, month, day, hour, minute, 0);
        }

        let flightFiles = (s3Files || []).filter(f => 
            f.Key && (f.Key.startsWith('flights/hourly/') || f.Key.startsWith('flights/daily/'))
        ).map(f => ({ ...f, fileTime: getFlightFileTimestamp(f.Key) || new Date(f.LastModified).getTime() }));

        // Filter flight files to only those within the requested time window to avoid downloading older data
        flightFiles = flightFiles.filter(f => f.fileTime && f.fileTime >= timeCutoff).sort((a,b) => a.fileTime - b.fileTime);

        console.log(`[airline-stats] Found ${flightFiles.length} flight files to process for window ${windowStr}`);

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
                    // Normalize callsign and icao to avoid duplicate entries across files
                    const rawCallsign = (flight.callsign || '').toString();
                    const callsign = rawCallsign.trim().toUpperCase();
                    const icao = (flight.icao || '').toString().toLowerCase();
                    if (!callsign || !icao) continue;

                    const startTime = new Date(flight.start_time).getTime();
                    if (startTime < timeCutoff) continue;

                    const flightIdentifier = `${callsign}|${icao}`;
                    if (seenFlights.has(flightIdentifier)) continue;
                    seenFlights.add(flightIdentifier);

                    const airlineCode = callsign.substring(0, 3).toUpperCase();
                    if (airlineCode.length === 3) {
                        let airlineName = 'Unknown';
                        if (airlineDatabase && airlineDatabase[airlineCode]) {
                            const dbEntry = airlineDatabase[airlineCode];
                            airlineName = typeof dbEntry === 'string' ? dbEntry : (dbEntry.name || 'Unknown');
                        }
                        if (!airlineStats[airlineName]) {
                            airlineStats[airlineName] = { code: airlineCode, count: 0, aircraft: new Set(), lastSeen: 0, typeCounts: {}, manufacturerCounts: {} };
                        }
                        airlineStats[airlineName].count++;
                        airlineStats[airlineName].aircraft.add(flight.icao);
                        // Use the most recent timestamp: end_time, last_seen, or start_time
                        const endTime = flight.end_time ? new Date(flight.end_time).getTime() : 0;
                        const lastSeenTime = flight.last_seen ? new Date(flight.last_seen).getTime() : 0;
                        const startTime = flight.start_time ? new Date(flight.start_time).getTime() : 0;
                        const mostRecentTime = Math.max(endTime, lastSeenTime, startTime);
                        if (mostRecentTime > airlineStats[airlineName].lastSeen) {
                            airlineStats[airlineName].lastSeen = mostRecentTime;
                        }
                        // Track types and manufacturers
                        const flightType = flight.type || '';
                        if (flightType) {
                            airlineStats[airlineName].typeCounts[flightType] = (airlineStats[airlineName].typeCounts[flightType] || 0) + 1;
                            const typeInfo = aircraftTypesDB.lookup(flightType);
                            const manu = (typeInfo && typeInfo.manufacturer) ? typeInfo.manufacturer : 'Unknown';
                            airlineStats[airlineName].manufacturerCounts[manu] = (airlineStats[airlineName].manufacturerCounts[manu] || 0) + 1;
                        } else {
                            // Flight without type information
                            airlineStats[airlineName].manufacturerCounts['Unknown'] = (airlineStats[airlineName].manufacturerCounts['Unknown'] || 0) + 1;
                        }
                    }
                }
            } catch (err) {
                console.warn(`Failed to process flight file ${file.Key}:`, err.message);
                continue;
            }
        }

        const finalStats = {};
        for (const airline in airlineStats) {
            // Determine top type/manufacturer
            const typeCounts = airlineStats[airline].typeCounts || {};
            const manufacturerCounts = airlineStats[airline].manufacturerCounts || {};
            const topType = Object.keys(typeCounts).length ? Object.keys(typeCounts).reduce((a, b) => typeCounts[a] > typeCounts[b] ? a : b) : null;
            const topManufacturer = Object.keys(manufacturerCounts).length ? Object.keys(manufacturerCounts).reduce((a, b) => manufacturerCounts[a] > manufacturerCounts[b] ? a : b) : null;

            finalStats[airline] = {
                code: airlineStats[airline].code,
                count: airlineStats[airline].count,
                aircraft: airlineStats[airline].aircraft.size,
                lastSeen: airlineStats[airline].lastSeen,
                topType: topType,
                manufacturers: manufacturerCounts, // Include all manufacturers with counts
                topManufacturer: topManufacturer,
                logo: (airlineDatabase && airlineDatabase[airlineStats[airline].code]) ? 
                    (typeof airlineDatabase[airlineStats[airline].code] === 'string' ? null : airlineDatabase[airlineStats[airline].code].logo) : null,
                topManufacturerLogo: topManufacturer ? (() => {
                    const manufacturerEntry = Object.entries(airlineDatabase || {}).find(([code, data]) => 
                        data.name === topManufacturer
                    );
                    return manufacturerEntry ? (typeof manufacturerEntry[1] === 'string' ? null : manufacturerEntry[1].logo) : null;
                })() : null
            };
        }

        return { 
            byAirline: finalStats,
            uniqueAirlines: Object.keys(finalStats).length,
            totalFlights: Object.values(finalStats).reduce((sum, airline) => sum + airline.count, 0),
            totalAircraft: Object.values(finalStats).reduce((sum, airline) => sum + airline.aircraft, 0)
        };
    } catch (error) {
        console.error('computeAirlineStatsData error:', error);
        return { byAirline: {} };
    }
}

// New function that filters by actual timestamp range instead of hours
async function computeSquawkTransitionsDataByTimeRange(s3, readBucket, startTime, endTime, source = 'read') {
    try {
        const transitions = [];
        const lastSquawkPerAircraft = {}; // Track across ALL files

        console.log(`[squawk-debug] computeSquawkTransitionsDataByTimeRange called for ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);
        
        // Load airline database for airline name lookup
        const airlineDatabase = await getAirlineDatabase(s3, readBucket);
        
        // Function to extract timestamp from filename (filenames use UTC timestamps)
        const getTimestampFromKey = (key) => {
            const match = key.match(/_(\d{8})_(\d{4})\.json$/);
            if (!match) return null;
            const [, date, time] = match;
            const year = parseInt(date.substring(0, 4));
            const month = parseInt(date.substring(4, 6)) - 1; // Month is 0-indexed
            const day = parseInt(date.substring(6, 8));
            const hour = parseInt(time.substring(0, 2));
            const minute = parseInt(time.substring(2, 4));
            return Date.UTC(year, month, day, hour, minute, 0, 0);
        };

        // Get files from S3 - use unlimited pages to get all files
        const allFiles = await listS3Files(s3, readBucket, 'data/piaware_aircraft_log', 1000);
        
        console.log(`[squawk-debug] Total files from S3: ${allFiles.length}`);
        console.log(`[squawk-debug] Looking for files between ${new Date(startTime).toISOString()} and ${new Date(endTime).toISOString()}`);
        
        // Filter files based on the timestamp in their filename
        const relevantFiles = allFiles
            .map(f => ({ ...f, fileTime: getTimestampFromKey(f.Key) || new Date(f.LastModified).getTime() }))
            .filter(f => f.fileTime && f.fileTime >= startTime && f.fileTime <= endTime)
            .sort((a, b) => a.fileTime - b.fileTime);

        if (relevantFiles.length === 0 && allFiles.length > 0) {
            const sample = allFiles[0];
            const sampleTime = getTimestampFromKey(sample.Key);
            console.log(`[squawk-debug] Sample file: ${sample.Key}, extracted time: ${sampleTime ? new Date(sampleTime).toISOString() : 'null'}, LastModified: ${new Date(sample.LastModified).toISOString()}`);
        }
        
        console.log(`[squawk-debug] Found ${relevantFiles.length} relevant log files to process based on filename`);

        let totalAircraft = 0;
        let aircraftWithSquawk = 0;
        
        for (const file of relevantFiles) {
            const aircraftData = await downloadAndParseS3File(s3, readBucket, file.Key);
            if (!Array.isArray(aircraftData)) {
                console.log(`[squawk-debug] File ${file.Key} did not return array, got type: ${typeof aircraftData}`);
                continue;
            }
            totalAircraft += aircraftData.length;

            for (const aircraft of aircraftData) {
                const hex = aircraft.hex || aircraft.ICAO;
                const squawk = aircraft.squawk || aircraft.Squawk;
                const flight = (aircraft.flight || aircraft.Ident || '').trim();
                const registration = aircraft.registration || aircraft.Registration || '';
                const aircraftType = aircraft.aircraft_type || aircraft.type || aircraft.Type || '';
                const altitude = aircraft.alt_baro || aircraft.alt || aircraft.altitude || 0;
                
                
                if (squawk) aircraftWithSquawk++;
                
                if (!hex || !squawk) continue;

                // Use file timestamp consistently (like Python script) instead of lastSeen
                const timestamp = file.fileTime;

                // Detect transition if this aircraft has changed squawk
                if (lastSquawkPerAircraft[hex] && lastSquawkPerAircraft[hex].code !== squawk) {
                    const lastTimestamp = lastSquawkPerAircraft[hex].timestamp;
                    const lastFlight = lastSquawkPerAircraft[hex].flight;
                    const minutesSinceLast = (timestamp - lastTimestamp) / (60 * 1000);
                    
                    // Skip if flight changed (not a real squawk change)
                    // Only check if both have non-empty flight identifiers
                    if (lastFlight && flight && lastFlight !== flight) {
                        // Flight changed, update tracking but don't record as squawk transition
                        lastSquawkPerAircraft[hex] = { code: squawk, timestamp, flight };
                        continue;
                    }
                    
                    // Skip if observations are 15+ minutes apart (likely different flight)
                    if (minutesSinceLast >= 15) {
                        // Too much time elapsed, update tracking but don't record as squawk transition
                        lastSquawkPerAircraft[hex] = { code: squawk, timestamp, flight };
                        continue;
                    }
                    
                    // Valid transition: ensure within requested time window
                    if (timestamp >= startTime && timestamp <= endTime) {
                        // Extract airline code from flight callsign (first 3 characters)
                        let airlineCode = '';
                        let airlineName = '';
                        if (flight && flight.length >= 3) {
                            airlineCode = flight.substring(0, 3).toUpperCase();
                            if (airlineDatabase[airlineCode]) {
                                airlineName = airlineDatabase[airlineCode].airline || airlineDatabase[airlineCode].name || '';
                            } else {
                                airlineName = null;
                            }
                        }
                        
                        const typeInfo = aircraftTypesDB.lookup(aircraftType || '');
                        transitions.push({ 
                            hex, 
                            registration: registration || hex,
                            flight,
                            type: aircraftType,
                            aircraft_model: typeInfo?.model || null,
                            manufacturer: typeInfo?.manufacturer || null,
                            bodyType: typeInfo?.bodyType || null,
                            airlineCode,
                            airlineName,
                            from: lastSquawkPerAircraft[hex].code, 
                            to: squawk, 
                            timestamp, 
                            altitude: Math.round(altitude),
                            minutesSinceLast: Math.round(minutesSinceLast * 10) / 10
                        });
                    }
                }
                // Update last known squawk for this aircraft
                lastSquawkPerAircraft[hex] = { code: squawk, timestamp, flight };
            }
        }
        
        console.log(`[squawk-debug] Processed ${totalAircraft} aircraft records, ${aircraftWithSquawk} had squawk codes`);
        console.log(`[squawk-debug] Tracked ${Object.keys(lastSquawkPerAircraft).length} unique aircraft`);
        console.log(`[squawk-debug] Found ${transitions.length} transitions`);
        
        // Debug: Check a specific aircraft
        const debugHex = 'a9e93b';
        if (lastSquawkPerAircraft[debugHex]) {
            console.log(`[squawk-debug] Sample aircraft ${debugHex}:`, lastSquawkPerAircraft[debugHex]);
        }
        
        transitions.sort((a, b) => b.timestamp - a.timestamp);

        return {
            transitions: transitions,
            totalTransitions: transitions.length
        };
    } catch (error) {
        console.error('computeSquawkTransitionsDataByTimeRange error:', error);
        return { transitions: [], totalTransitions: 0 };
    }
}

async function computeSquawkTransitionsData(s3, readBucket, hours = 0.1667, source = 'read') {
    try {
        const now = Date.now();
        const cutoff = now - (hours * 60 * 60 * 1000);
        return await computeSquawkTransitionsDataByTimeRange(s3, readBucket, cutoff, now, source);
    } catch (error) {
        console.error('computeSquawkTransitionsData error:', error);
        return { transitions: [], totalTransitions: 0 };
    }
}

async function computeHistoricalStatsData(s3, readBucket, hours = 168, resolution = 60, getInMemoryState = null, startTime = null, endTime = null) {
    try {
        const now = Date.now();
        const cutoff = startTime ? startTime : (now - (hours * 60 * 60 * 1000));
        const startDate = cutoff;
        const endDate = endTime ? endTime : now;

        const [airlineDb, s3Files] = await Promise.all([getAirlineDatabase(s3, readBucket), listS3Files(s3, readBucket)]);

        const stats = {
            timeSeries: [],
            totals: { totalPositions: 0, uniqueAircraft: new Set(), uniqueFlights: new Set(), uniqueAirlines: new Set(), totalFlights: 0, totalSquawkTransitions: 0 },
            altitudeDistribution: {},
            speedDistribution: {},
            airlineStats: {},
            geographicCoverage: { latMin: 90, latMax: -90, lonMin: 180, lonMax: -180, coverage: [] },
            receptionRange: { sectors: {}, maxRange: 0 },
            squawkStats: { toVfr: 0, fromVfr: 0, ifrToIfr: 0, toSpecial: 0, fromSpecial: 0, lowToHigh: 0, highToLow: 0 }
        };

        // Auto-adjust resolution based on time window to ensure reasonable granularity
        let effectiveResolution = resolution;
        if (hours <= 24 && resolution >= 60) {
            // For 24 hours or less with 60+ minute resolution, use 5-minute buckets for better granularity
            effectiveResolution = 5;
        } else if (hours <= 168 && resolution >= 60) {
            // For 7 days or less with 60+ minute resolution, use 15-minute buckets
            effectiveResolution = 15;
        }

        const timeBuckets = {};
        const bucketSize = effectiveResolution * 60 * 1000;

        // Parse timestamp from filename like 'piaware_aircraft_log_20251114_1900.json' -> 202511141900
        function getFileTimestamp(key) {
            const match = key.match(/_(\d{8})_(\d{4})/);
            if (match) {
                return new Date(match[1].substring(0,4) + '-' + match[1].substring(4,6) + '-' + match[1].substring(6,8) + 'T' + match[2].substring(0,2) + ':' + match[2].substring(2,4) + ':00Z').getTime();
            }
            return null;
        }

        const logFiles = (s3Files || [])
            .filter(f => f.Key && f.Key.includes('piaware_aircraft_log'))
            .map(f => {
                const fileTime = getFileTimestamp(f.Key);
                return { ...f, fileTime };
            })
            .filter(f => f.fileTime && f.fileTime >= startDate && f.fileTime <= endDate)
            .sort((a, b) => a.fileTime - b.fileTime);

        const lastSquawkPerAircraft = {};

        for (const file of logFiles) {
            try {
                const aircraftData = await downloadAndParseS3File(s3, readBucket, file.Key);
                if (!Array.isArray(aircraftData)) continue;
                const fileTime = file.fileTime;

                for (const aircraft of aircraftData) {
                    const hex = aircraft.hex || aircraft.ICAO;
                    if (!hex) continue;
                    const flight = (aircraft.flight || aircraft.Ident || '').trim();
                    const lat = aircraft.lat; const lon = aircraft.lon; const alt = aircraft.alt_baro || aircraft.altitude; const speed = aircraft.gs || aircraft.groundspeed; const squawk = aircraft.squawk || aircraft.Squawk;

                    stats.totals.totalPositions++;
                    stats.totals.uniqueAircraft.add(hex);
                    if (flight) {
                        stats.totals.uniqueFlights.add(flight);
                        const airlineCode = flight.substring(0, 3).toUpperCase();
                        if (airlineCode.length === 3) {
                            stats.totals.uniqueAirlines.add(airlineCode);
                            if (!stats.airlineStats[airlineCode]) stats.airlineStats[airlineCode] = { code: airlineCode, name: airlineDb && airlineDb[airlineCode] ? (typeof airlineDb[airlineCode] === 'string' ? airlineDb[airlineCode] : airlineDb[airlineCode].name || 'Unknown') : 'Unknown', count: 0, aircraft: new Set() };
                            stats.airlineStats[airlineCode].count++; stats.airlineStats[airlineCode].aircraft.add(hex);
                        }
                    }

                    const bucketTime = Math.floor(fileTime / bucketSize) * bucketSize;
                    if (!timeBuckets[bucketTime]) timeBuckets[bucketTime] = { timestamp: bucketTime, positions: 0, aircraft: new Set(), flights: new Set(), airlines: new Set() };
                    timeBuckets[bucketTime].positions++; timeBuckets[bucketTime].aircraft.add(hex);
                    if (flight) { timeBuckets[bucketTime].flights.add(flight); const airlineCode = flight.substring(0, 3).toUpperCase(); if (airlineCode.length === 3) timeBuckets[bucketTime].airlines.add(airlineCode); }

                    if (alt != null) { const altBand = Math.floor(alt / 5000) * 5000; stats.altitudeDistribution[altBand] = (stats.altitudeDistribution[altBand] || 0) + 1; }
                    if (speed != null) { const speedBand = Math.floor(speed / 50) * 50; stats.speedDistribution[speedBand] = (stats.speedDistribution[speedBand] || 0) + 1; }

                    if (lat != null && lon != null) {
                        stats.geographicCoverage.latMin = Math.min(stats.geographicCoverage.latMin, lat);
                        stats.geographicCoverage.latMax = Math.max(stats.geographicCoverage.latMax, lat);
                        stats.geographicCoverage.lonMin = Math.min(stats.geographicCoverage.lonMin, lon);
                        stats.geographicCoverage.lonMax = Math.max(stats.geographicCoverage.lonMax, lon);
                        const gridKey = `${Math.floor(lat)},${Math.floor(lon)}`;
                        if (!stats.geographicCoverage.coverage.includes(gridKey)) stats.geographicCoverage.coverage.push(gridKey);
                    }

                    if (squawk && lastSquawkPerAircraft[hex] && lastSquawkPerAircraft[hex].code !== squawk) {
                        stats.totals.totalSquawkTransitions++;
                        if (squawk === '1200') stats.squawkStats.toVfr++; else if (lastSquawkPerAircraft[hex].code === '1200') stats.squawkStats.fromVfr++; else if (!['7500','7600','7700'].includes(lastSquawkPerAircraft[hex].code) && !['7500','7600','7700'].includes(squawk)) stats.squawkStats.ifrToIfr++;
                        if (['7500','7600','7700'].includes(squawk)) stats.squawkStats.toSpecial++; else if (['7500','7600','7700'].includes(lastSquawkPerAircraft[hex].code)) stats.squawkStats.fromSpecial++;
                        const fromVal = parseInt(lastSquawkPerAircraft[hex].code); const toVal = parseInt(squawk); if (!isNaN(fromVal) && !isNaN(toVal)) { if (fromVal < 4000 && toVal >= 4000) stats.squawkStats.lowToHigh++; else if (fromVal >= 4000 && toVal < 4000) stats.squawkStats.highToLow++; }
                    }
                    if (squawk) lastSquawkPerAircraft[hex] = { code: squawk, timestamp: fileTime };
                }
            } catch (err) {
                console.warn(`Failed to process ${file.Key}:`, err.message);
            }
        }

        if (getInMemoryState) {
            const state = getInMemoryState();
            const memoryPositions = (state.positionHistory || []).filter(pos => pos.timestamp >= startDate && pos.timestamp <= endDate);
            memoryPositions.forEach(pos => {
                stats.totals.totalPositions++; stats.totals.uniqueAircraft.add(pos.hex); if (pos.flight) { stats.totals.uniqueFlights.add(pos.flight); const airlineCode = pos.flight.substring(0,3).toUpperCase(); if (airlineCode.length===3) stats.totals.uniqueAirlines.add(airlineCode); }
                const bucketTime = Math.floor(pos.timestamp / bucketSize) * bucketSize; if (!timeBuckets[bucketTime]) timeBuckets[bucketTime] = { timestamp: bucketTime, positions: 0, aircraft: new Set(), flights: new Set(), airlines: new Set() }; timeBuckets[bucketTime].positions++; timeBuckets[bucketTime].aircraft.add(pos.hex); if (pos.flight) { timeBuckets[bucketTime].flights.add(pos.flight); const airlineCode = pos.flight.substring(0,3).toUpperCase(); if (airlineCode.length===3) timeBuckets[bucketTime].airlines.add(airlineCode); }
                if (pos.alt != null) { const altBand = Math.floor(pos.alt / 5000) * 5000; stats.altitudeDistribution[altBand] = (stats.altitudeDistribution[altBand] || 0) + 1; }
                if (pos.gs != null) { const speedBand = Math.floor(pos.gs / 50) * 50; stats.speedDistribution[speedBand] = (stats.speedDistribution[speedBand] || 0) + 1; }
                if (pos.lat != null && pos.lon != null) { stats.geographicCoverage.latMin = Math.min(stats.geographicCoverage.latMin, pos.lat); stats.geographicCoverage.latMax = Math.max(stats.geographicCoverage.latMax, pos.lat); stats.geographicCoverage.lonMin = Math.min(stats.geographicCoverage.lonMin, pos.lon); stats.geographicCoverage.lonMax = Math.max(stats.geographicCoverage.lonMax, pos.lon); const gridKey = `${Math.floor(pos.lat)},${Math.floor(pos.lon)}`; if (!stats.geographicCoverage.coverage.includes(gridKey)) stats.geographicCoverage.coverage.push(gridKey); }
            });

            stats.receptionRange.sectors = state.sectorAltitudeRecords || {};
            Object.values(stats.receptionRange.sectors).forEach(sector => { if (sector.maxRange > stats.receptionRange.maxRange) stats.receptionRange.maxRange = sector.maxRange; });
            stats.totals.totalFlights += Object.values(state.activeFlights || {}).length;
        }

        stats.timeSeries = Object.values(timeBuckets).map(bucket => ({ timestamp: bucket.timestamp, positions: bucket.positions, aircraft: bucket.aircraft.size, flights: bucket.flights.size, airlines: bucket.airlines.size })).sort((a,b) => a.timestamp - b.timestamp);
        stats.totals.uniqueAircraft = stats.totals.uniqueAircraft.size; stats.totals.uniqueFlights = stats.totals.uniqueFlights.size; stats.totals.uniqueAirlines = stats.totals.uniqueAirlines.size;
        Object.values(stats.airlineStats).forEach(a => { a.aircraft = a.aircraft.size; });
        stats.altitudeDistribution = Object.fromEntries(Object.entries(stats.altitudeDistribution).sort(([a],[b]) => parseInt(a)-parseInt(b)));
        stats.speedDistribution = Object.fromEntries(Object.entries(stats.speedDistribution).sort(([a],[b]) => parseInt(a)-parseInt(b)));
        stats.resolutionUsed = effectiveResolution;

        return stats;
    } catch (error) {
        console.error('computeHistoricalStatsData error:', error);
        return {};
    }
}

// Remake hourly rollup using read-only data
async function remakeHourlyRollup(s3, readBucket, writeBucket, cache = null) {
    // List all piaware_aircraft_log files from read-only bucket
    const s3Files = await listS3Files(s3, readBucket);
    const logFiles = (s3Files || []).filter(f => f.Key && f.Key.includes('piaware_aircraft_log'));
    // Group logs by hour
    const logsByHour = {};
    for (const file of logFiles) {
        const fileTime = new Date(file.LastModified).getTime();
        const hourBucket = Math.floor(fileTime / (60 * 60 * 1000)) * (60 * 60 * 1000);
        if (!logsByHour[hourBucket]) logsByHour[hourBucket] = [];
        logsByHour[hourBucket].push(file);
    }
    // For each hour, aggregate positions and write to hourly file in writeBucket
    for (const hour of Object.keys(logsByHour)) {
        const positions = [];
        for (const file of logsByHour[hour]) {
            const aircraftData = await downloadAndParseS3File(s3, readBucket, file.Key);
            if (Array.isArray(aircraftData)) {
                positions.push(...aircraftData.filter(a => a.lat && a.lon));
            }
        }
        // Write hourly rollup file to writeBucket
        const key = `data/hourly/positions_${new Date(parseInt(hour)).toISOString().replace(/[:.]/g, '-')}.json`;
        const body = JSON.stringify({ positions });
        // Use S3 putObject
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        await s3.send(new PutObjectCommand({ Bucket: writeBucket, Key: key, Body: body, ContentType: 'application/json' }));
    }
    // Track last hourly rollup time in cache
    if (cache) cache.lastHourlyRollup = Date.now();
    return { message: 'Hourly rollup remake completed.' };
}

// Get position data for a specific aircraft within a time range
async function getAircraftPositionsInTimeRange(s3, readBucket, hex, startTime, endTime) {
    try {
        const positions = [];
        
        // Get files from S3 within the time range - unlimited pages
        const allFiles = await listS3Files(s3, readBucket, 'data/piaware_aircraft_log', 1000);
        
        // Function to extract timestamp from filename
        const getTimestampFromKey = (key) => {
            const match = key.match(/_(\d{8})_(\d{4})\.json$/);
            if (!match) return null;
            const [, date, time] = match;
            const year = parseInt(date.substring(0, 4));
            const month = parseInt(date.substring(4, 6)) - 1;
            const day = parseInt(date.substring(6, 8));
            const hour = parseInt(time.substring(0, 2));
            const minute = parseInt(time.substring(2, 4));
            return new Date(year, month, day, hour, minute, 0, 0).getTime();
        };
        
        // Filter files based on the timestamp in their filename
        const relevantFiles = allFiles
            .map(f => ({ ...f, fileTime: getTimestampFromKey(f.Key) || new Date(f.LastModified).getTime() }))
            .filter(f => f.fileTime && f.fileTime >= startTime - (10 * 60 * 1000) && f.fileTime <= endTime + (10 * 60 * 1000))
            .sort((a, b) => a.fileTime - b.fileTime);
        
        for (const file of relevantFiles) {
            const aircraftData = await downloadAndParseS3File(s3, readBucket, file.Key);
            if (!Array.isArray(aircraftData)) continue;
            
            for (const aircraft of aircraftData) {
                const aircraftHex = aircraft.hex || aircraft.ICAO;
                if (aircraftHex !== hex) continue;
                
                const lat = aircraft.lat || aircraft.Latitude;
                const lon = aircraft.lon || aircraft.Longitude;
                const timestamp = file.fileTime;
                
                if (lat && lon && !isNaN(lat) && !isNaN(lon) && timestamp >= startTime && timestamp <= endTime) {
                    positions.push({
                        lat: parseFloat(lat),
                        lon: parseFloat(lon),
                        timestamp: timestamp,
                        altitude: aircraft.alt_baro || aircraft.alt || aircraft.altitude || 0,
                        speed: aircraft.speed || aircraft.gs || 0,
                        heading: aircraft.heading || aircraft.track || 0
                    });
                }
            }
        }
        
        return positions;
    } catch (error) {
        console.error('Error getting aircraft positions:', error);
        return [];
    }
}

module.exports = { computeAirlineStatsData, computeSquawkTransitionsData, computeSquawkTransitionsDataByTimeRange, computeHistoricalStatsData, remakeHourlyRollup, getAircraftPositionsInTimeRange };
