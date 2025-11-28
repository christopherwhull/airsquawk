const { listS3Files, downloadAndParseS3File } = require('./s3-helpers');
const { getAirlineDatabase } = require('./databases');

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
                            airlineStats[airlineName] = { code: airlineCode, count: 0, aircraft: new Set(), lastSeen: 0 };
                        }
                        airlineStats[airlineName].count++;
                        airlineStats[airlineName].aircraft.add(flight.icao);
                        const flightEndTime = new Date(flight.end_time).getTime();
                        if (flightEndTime > airlineStats[airlineName].lastSeen) {
                            airlineStats[airlineName].lastSeen = flightEndTime;
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
            finalStats[airline] = {
                code: airlineStats[airline].code,
                count: airlineStats[airline].count,
                aircraft: airlineStats[airline].aircraft.size,
                lastSeen: airlineStats[airline].lastSeen
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
        
        // Get files from both buckets (read and alternate)
        let allFiles = [];
        try {
            const readFiles = await listS3Files(s3, readBucket, 'data/piaware_aircraft_log', 1000, 10);
            console.log(`[squawk-debug] listS3Files returned ${readFiles?.length || 0} files for time range`);
            allFiles = allFiles.concat(readFiles || []);
        } catch (e) {
            // silently continue if read bucket fails
        }

        // Filter files by time range
        let minuteFiles = (allFiles || [])
            .filter(f => f.Key && f.Key.includes('piaware_aircraft_log'))
            .filter(f => new Date(f.LastModified).getTime() >= startTime && new Date(f.LastModified).getTime() <= endTime)
            .sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified));

        console.log(`[squawk-debug] After time range filter: ${minuteFiles.length} files`);

        let usingFallback = false;
        // If no files found in range, use all available files (for test data)
        if (minuteFiles.length === 0) {
            console.log(`[squawk-debug] No files in time range, using all available files as fallback`);
            minuteFiles = (allFiles || [])
                .filter(f => f.Key && f.Key.includes('piaware_aircraft_log'))
                .sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified));
            usingFallback = true;
            console.log(`[squawk-debug] Fallback loaded ${minuteFiles.length} files`);
        }

        for (const file of minuteFiles) {
            const aircraftData = await downloadAndParseS3File(s3, readBucket, file.Key);
            if (!Array.isArray(aircraftData)) continue;
            const fileTime = new Date(file.LastModified).getTime();
            
            for (const aircraft of aircraftData) {
                const hex = aircraft.hex || aircraft.ICAO;
                const squawk = aircraft.squawk || aircraft.Squawk;
                const flight = aircraft.flight || aircraft.Ident || '';
                const altitude = aircraft.alt_baro || aircraft.alt || aircraft.altitude || 0;
                if (!hex || !squawk) continue;

                // Detect transition if this aircraft has changed squawk from last time we saw it
                if (lastSquawkPerAircraft[hex] && lastSquawkPerAircraft[hex].code !== squawk) {
                    let timestamp = aircraft.lastSeen || aircraft.Last_Seen || aircraft.last_seen || fileTime;
                    // Convert timestamp to milliseconds if needed
                    if (typeof timestamp === 'string') {
                        timestamp = new Date(timestamp).getTime();
                    } else if (typeof timestamp === 'number' && timestamp < 9999999999) {
                        timestamp = timestamp * 1000;
                    }
                    transitions.push({ hex, flight: flight.trim(), from: lastSquawkPerAircraft[hex].code, to: squawk, timestamp, altitude: Math.round(altitude) });
                }
                // Update last known squawk for this aircraft (persists across files)
                lastSquawkPerAircraft[hex] = { code: squawk, timestamp: fileTime };
            }
        }

        console.log(`[squawk-debug] Time range filter found ${transitions.length} transitions (fallback: ${usingFallback})`);
        transitions.sort((a, b) => b.timestamp - a.timestamp);

        // Filter transitions by timestamp if not using fallback
        const filteredTransitions = usingFallback ? transitions : transitions.filter(t => t.timestamp >= startTime && t.timestamp <= endTime);

        const toVfr = filteredTransitions.filter(t => t.to === '1200');
        const fromVfr = filteredTransitions.filter(t => t.from === '1200');
        const ifr = filteredTransitions.filter(t => t.from !== '1200' && t.to !== '1200' && !['7500', '7600', '7700'].includes(t.from) && !['7500', '7600', '7700'].includes(t.to));
        const toSpecial = filteredTransitions.filter(t => ['7500', '7600', '7700'].includes(t.to));
        const fromSpecial = filteredTransitions.filter(t => ['7500', '7600', '7700'].includes(t.from));
        const lowToHigh = filteredTransitions.filter(t => { const fromVal = parseInt(t.from); const toVal = parseInt(t.to); return fromVal < 4000 && toVal >= 4000; });
        const highToLow = filteredTransitions.filter(t => { const fromVal = parseInt(t.from); const toVal = parseInt(t.to); return fromVal >= 4000 && toVal < 4000; });

        return {
            toVfrCount: toVfr.length,
            fromVfrCount: fromVfr.length,
            ifrToIfrCount: ifr.length,
            toSpecialCount: toSpecial.length,
            fromSpecialCount: fromSpecial.length,
            recentToVfr: toVfr.slice(0, 20),
            recentFromVfr: fromVfr.slice(0, 20),
            recentIfr: ifr.slice(0, 20),
            recentLowToHigh: lowToHigh.slice(0, 20),
            recentHighToLow: highToLow.slice(0, 20),
            recentToSpecial: toSpecial.slice(0, 20),
            recentFromSpecial: fromSpecial.slice(0, 20),
            totalTransitions: filteredTransitions.length
        };
    } catch (error) {
        console.error('computeSquawkTransitionsDataByTimeRange error:', error);
        return {};
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
                    transitions.push({ hex, flight: flight.trim(), from: lastSquawkPerAircraft[hex].code, to: squawk, timestamp, altitude: Math.round(altitude) });
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

        const toVfr = filteredTransitions.filter(t => t.to === '1200');
        const fromVfr = filteredTransitions.filter(t => t.from === '1200');
        const ifr = filteredTransitions.filter(t => t.from !== '1200' && t.to !== '1200' && !['7500', '7600', '7700'].includes(t.from) && !['7500', '7600', '7700'].includes(t.to));
        const toSpecial = filteredTransitions.filter(t => ['7500', '7600', '7700'].includes(t.to));
        const fromSpecial = filteredTransitions.filter(t => ['7500', '7600', '7700'].includes(t.from));
        const lowToHigh = filteredTransitions.filter(t => { const fromVal = parseInt(t.from); const toVal = parseInt(t.to); return fromVal < 4000 && toVal >= 4000; });
        const highToLow = filteredTransitions.filter(t => { const fromVal = parseInt(t.from); const toVal = parseInt(t.to); return fromVal >= 4000 && toVal < 4000; });

        return {
            toVfrCount: toVfr.length,
            fromVfrCount: fromVfr.length,
            ifrToIfrCount: ifr.length,
            toSpecialCount: toSpecial.length,
            fromSpecialCount: fromSpecial.length,
            windowHours: hours,
            recentToVfr: toVfr.slice(0, 20),
            recentFromVfr: fromVfr.slice(0, 20),
            recentIfr: ifr.slice(0, 20),
            recentLowToHigh: lowToHigh.slice(0, 20),
            recentHighToLow: highToLow.slice(0, 20),
            recentToSpecial: toSpecial.slice(0, 20),
            recentFromSpecial: fromSpecial.slice(0, 20),
            totalTransitions: filteredTransitions.length
        };
    } catch (error) {
        console.error('computeSquawkTransitionsData error:', error);
        return {};
    }
}

async function computeHistoricalStatsData(s3, readBucket, hours = 168, resolution = 60, getInMemoryState = null) {
    try {
        const cutoff = Date.now() - (hours * 60 * 60 * 1000);
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

        const timeBuckets = {};
        const bucketSize = resolution * 60 * 1000;

        const logFiles = (s3Files || []).filter(f => f.Key && f.Key.includes('piaware_aircraft_log')).filter(f => new Date(f.LastModified).getTime() > cutoff).sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified));

        const lastSquawkPerAircraft = {};

        for (const file of logFiles) {
            try {
                const aircraftData = await downloadAndParseS3File(s3, readBucket, file.Key);
                if (!Array.isArray(aircraftData)) continue;
                const fileTime = new Date(file.LastModified).getTime();

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
            const memoryPositions = (state.positionHistory || []).filter(pos => pos.timestamp > cutoff);
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

        return stats;
    } catch (error) {
        console.error('computeHistoricalStatsData error:', error);
        return {};
    }
}

// Remake hourly rollup using read-only data
async function remakeHourlyRollup(s3, readBucket, writeBucket) {
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
    return { message: 'Hourly rollup remake completed.' };
}

module.exports = { computeAirlineStatsData, computeSquawkTransitionsData, computeSquawkTransitionsDataByTimeRange, computeHistoricalStatsData, remakeHourlyRollup };
