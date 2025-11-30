const { listS3Files, downloadAndParseS3File } = require('./s3-helpers');
const { getAirlineDatabase } = require('./databases');
const aircraftTypesDB = require('./aircraft-types-db');

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

        const [airlineDatabase, s3Files] = await Promise.all([
            getAirlineDatabase(s3, readBucket),
            listS3Files(s3, writeBucket, 'flights/', 1000, 1)
        ]);

        const airlineStats = {};
        const seenFlights = new Set();
        const { GetObjectCommand } = require('@aws-sdk/client-s3');

        const flightFiles = (s3Files || []).filter(f => 
            f.Key && (f.Key.startsWith('flights/hourly/') || f.Key.startsWith('flights/daily/'))
        );

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
                    if (!flight.callsign || !flight.icao) continue;
                    
                    const startTime = new Date(flight.start_time).getTime();
                    if (startTime < timeCutoff) continue;
                    
                    const flightIdentifier = `${flight.callsign}|${flight.icao}`;
                    if (seenFlights.has(flightIdentifier)) continue;
                    seenFlights.add(flightIdentifier);
                    
                    const airlineCode = flight.callsign.substring(0, 3).toUpperCase();
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
                            const manu = (typeInfo && typeInfo.manufacturer) ? typeInfo.manufacturer : '';
                            if (manu) airlineStats[airlineName].manufacturerCounts[manu] = (airlineStats[airlineName].manufacturerCounts[manu] || 0) + 1;
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
                topManufacturer: topManufacturer,
                logo: (airlineDatabase && airlineDatabase[airlineStats[airline].code]) ? 
                    (typeof airlineDatabase[airlineStats[airline].code] === 'string' ? null : airlineDatabase[airlineStats[airline].code].logo) : null
            };
        }

        return { byAirline: finalStats };
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
        
        // Function to extract timestamp from filename (assumes local time, not UTC)
        const getTimestampFromKey = (key) => {
            const match = key.match(/_(\d{8})_(\d{4})\.json$/);
            if (!match) return null;
            const [, date, time] = match;
            const year = parseInt(date.substring(0, 4));
            const month = parseInt(date.substring(4, 6)) - 1; // Month is 0-indexed
            const day = parseInt(date.substring(6, 8));
            const hour = parseInt(time.substring(0, 2));
            const minute = parseInt(time.substring(2, 4));
            return new Date(year, month, day, hour, minute, 0, 0).getTime();
        };

        // Get files from S3
        const allFiles = await listS3Files(s3, readBucket, 'data/piaware_aircraft_log', 1000, 10);
        
        // Filter files based on the timestamp in their filename
        const relevantFiles = allFiles
            .map(f => ({ ...f, fileTime: getTimestampFromKey(f.Key) || new Date(f.LastModified).getTime() }))
            .filter(f => f.fileTime && f.fileTime >= startTime && f.fileTime <= endTime)
            .sort((a, b) => a.fileTime - b.fileTime);

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

async function computeSquawkTransitionsData(s3, readBucket, hours = 24, source = 'read') {
    try {
        let cutoff = Date.now() - (hours * 60 * 60 * 1000);
        const transitions = [];
        const lastSquawkPerAircraft = {}; // Track across ALL files

        const s3Files = await listS3Files(s3, readBucket, 'data/piaware_aircraft_log', 1000, 10);
        let minuteFiles = (s3Files || [])
            .filter(f => f.Key && f.Key.includes('piaware_aircraft_log'))
            .filter(f => new Date(f.LastModified).getTime() > cutoff)
            .sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified));
        
        console.log(`[squawk-debug] After time filter: ${minuteFiles.length} files with recent data`);
        
        let usingFallback = false;
        // If no recent files found, fall back to using all available files (for test data)
        // This applies to any query window when no recent data exists
        if (minuteFiles.length === 0) {
            console.log(`[squawk-debug] No recent files, using fallback for test data`);
            minuteFiles = (s3Files || [])
                .filter(f => f.Key && f.Key.includes('piaware_aircraft_log'))
                .sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified));
            usingFallback = true;
            console.log(`[squawk-debug] Fallback loaded ${minuteFiles.length} files`);
        }

        for (const file of minuteFiles) {
            const aircraftData = await downloadAndParseS3File(s3, readBucket, file.Key);
            if (!Array.isArray(aircraftData)) continue;
            const fileTime = new Date(file.LastModified).getTime();
            let fileTransitions = 0;
            for (const aircraft of aircraftData) {
                const hex = aircraft.hex || aircraft.ICAO;
                const squawk = aircraft.squawk || aircraft.Squawk;
                const flight = aircraft.flight || aircraft.Ident || '';
                const registration = aircraft.registration || aircraft.Registration || '';
                const aircraftType = aircraft.aircraft_type || aircraft.type || aircraft.Type || '';
                const altitude = aircraft.alt_baro || aircraft.alt || aircraft.altitude || 0;
                if (!hex || !squawk) continue;

                // Detect transition if this aircraft has changed squawk from last time we saw it
                if (lastSquawkPerAircraft[hex] && lastSquawkPerAircraft[hex].code !== squawk) {
                    let timestamp = aircraft.lastSeen || aircraft.Last_Seen || aircraft.last_seen || fileTime;
                    // Convert timestamp to milliseconds if needed
                    if (typeof timestamp === 'string') {
                        timestamp = new Date(timestamp).getTime();
                    } else if (typeof timestamp === 'number' && timestamp < 9999999999) {
                        // If it looks like seconds (less than year 2286), convert to ms
                        timestamp = timestamp * 1000;
                    }
                    const typeInfo2 = aircraftTypesDB.lookup(aircraftType || '');
                    transitions.push({ hex, flight: flight.trim(), type: aircraftType, aircraft_model: typeInfo2?.model || null, manufacturer: typeInfo2?.manufacturer || null, bodyType: typeInfo2?.bodyType || null, from: lastSquawkPerAircraft[hex].code, to: squawk, timestamp, altitude: Math.round(altitude) });
                    fileTransitions++;
                }
                // Update last known squawk for this aircraft (persists across files)
                lastSquawkPerAircraft[hex] = { code: squawk, timestamp: fileTime };
            }
        }

        console.log(`[squawk-debug] Processed ${minuteFiles.length} files, found ${transitions.length} transitions`);

        transitions.sort((a, b) => b.timestamp - a.timestamp);
        
        // Filter transitions to only those within the requested time window
        // (unless we're using fallback data, in which case use all transitions)
        const filteredTransitions = usingFallback ? transitions : transitions.filter(t => t.timestamp >= cutoff);

        return {
            transitions: filteredTransitions,
            totalTransitions: filteredTransitions.length
        };
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

module.exports = { computeAirlineStatsData, computeSquawkTransitionsData, computeSquawkTransitionsDataByTimeRange, computeHistoricalStatsData, remakeHourlyRollup };
