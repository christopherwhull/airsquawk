#!/usr/bin/env node
/**
 * populate-flight-history.js
 * 
 * Backfill hourly and daily flight files from historical position data in S3.
 * Reads all minute files, builds flights, and writes aggregated hourly/daily files.
 * 
 * Usage:
 *   node populate-flight-history.js [--days=7] [--gap-minutes=15]
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { listS3Files, downloadS3AircraftRecords } = require('./lib/s3-helpers');
const { getAirlineDatabase } = require('./lib/databases');
const logger = require('./lib/logger');

// Parse command line arguments
const args = process.argv.slice(2);
const daysArg = args.find(a => a.startsWith('--days='));
const gapArg = args.find(a => a.startsWith('--gap-minutes='));

const DAYS_TO_PROCESS = daysArg ? parseInt(daysArg.split('=')[1]) : 7;
const GAP_MINUTES = gapArg ? parseInt(gapArg.split('=')[1]) : 5;

const s3 = new S3Client({
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    credentials: {
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin123',
    },
    forcePathStyle: true,
});

const READ_BUCKET = 'aircraft-data';
const WRITE_BUCKET = 'aircraft-data-new';

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
        reports: recs.length
    };
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
            airline_name: fl.airline_name
        }));
        
        const command = new PutObjectCommand({
            Bucket: WRITE_BUCKET,
            Key: key,
            Body: JSON.stringify(flightsData, null, 2),
            ContentType: 'application/json'
        });
        
        await s3.send(command);
        logger.info(`✓ Saved ${flights.length} flights to ${key}`);
    } catch (error) {
        logger.error(`Failed to save flights to S3 key ${key}:`, error.message);
    }
}

async function processTimeRange(startTime, endTime, airlineDb) {
    logger.info(`Processing time range: ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);
    
    // List all minute files in this range
    const s3Files = await listS3Files(s3, READ_BUCKET);
    const relevantFiles = (s3Files || [])
        .filter(f => f.Key && f.Key.includes('piaware_aircraft_log'))
        .filter(f => {
            const fileTime = new Date(f.LastModified).getTime();
            return fileTime >= startTime && fileTime < endTime;
        })
        .sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified));
    
    if (relevantFiles.length === 0) {
        logger.info(`No files found in this time range`);
        return [];
    }
    
    logger.info(`Found ${relevantFiles.length} minute files to process`);
    
    // Load all records
    const allRecords = [];
    let filesProcessed = 0;
    
    for (const file of relevantFiles) {
        try {
            const recs = await downloadS3AircraftRecords(s3, READ_BUCKET, file.Key);
            for (const r of recs || []) {
                const hex = (r.hex || r.ICAO || r.icao || '').toString().toLowerCase();
                const lat = r.lat || r.Latitude || r.latitude;
                const lon = r.lon || r.Longitude || r.longitude;
                
                if (!hex || lat == null || lon == null) continue;
                
                // Parse timestamp
                const tsCandidate = r.Last_Seen || r.LastSeen || r.last_seen || r.seen || r.seen_time;
                let ts = new Date(file.LastModified).getTime();
                if (typeof tsCandidate === 'number') {
                    ts = tsCandidate > 9999999999 ? tsCandidate : tsCandidate * 1000;
                } else if (typeof tsCandidate === 'string') {
                    const parsed = new Date(tsCandidate).getTime();
                    if (!isNaN(parsed)) ts = parsed;
                }
                
                // Only include records within our time range
                if (ts < startTime || ts >= endTime) continue;
                
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
            
            filesProcessed++;
            if (filesProcessed % 50 === 0) {
                logger.info(`  Processed ${filesProcessed}/${relevantFiles.length} files, ${allRecords.length} records so far`);
            }
        } catch (err) {
            logger.warn(`Failed to process ${file.Key}:`, err.message);
        }
    }
    
    logger.info(`Loaded ${allRecords.length} position records`);
    
    if (allRecords.length === 0) return [];
    
    // Group by ICAO and build flights
    const byIcao = {};
    for (const r of allRecords) {
        if (!byIcao[r.hex]) byIcao[r.hex] = [];
        byIcao[r.hex].push(r);
    }
    
    const GAP_MS = GAP_MINUTES * 60 * 1000;
    const MIN_DURATION_MS = 0.5 * 60 * 1000;
    const flights = [];
    
    let icaoCount = 0;
    const totalIcaos = Object.keys(byIcao).length;
    
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
                const flight = summarizeFlightData(currentFlight);
                if (flight && (flight.end_ts - flight.start_ts) >= MIN_DURATION_MS) {
                    flights.push(flight);
                }
                currentFlight = [r];
            } else {
                currentFlight.push(r);
            }
        }
        
        if (currentFlight.length > 0) {
            const flight = summarizeFlightData(currentFlight);
            if (flight && (flight.end_ts - flight.start_ts) >= MIN_DURATION_MS) {
                flights.push(flight);
            }
        }
        
        icaoCount++;
        if (icaoCount % 100 === 0) {
            logger.info(`  Built flights for ${icaoCount}/${totalIcaos} aircraft, ${flights.length} flights total`);
        }
    }
    
    // Enrich with airline data
    for (const fl of flights) {
        const airlineCode = fl.callsign.substring(0, 3).toUpperCase();
        fl.airline_code = airlineCode;
        fl.airline_name = (airlineDb && airlineDb[airlineCode]) ? (airlineDb[airlineCode].name || airlineDb[airlineCode]) : '';
    }
    
    logger.info(`Built ${flights.length} flights for this time range`);
    return flights;
}

async function main() {
    logger.info('=== Flight History Population Script ===');
    logger.info(`Processing last ${DAYS_TO_PROCESS} days with ${GAP_MINUTES}-minute gap`);
    logger.info(`Read bucket: ${READ_BUCKET}`);
    logger.info(`Write bucket: ${WRITE_BUCKET}`);
    
    // Load airline database
    logger.info('Loading airline database...');
    const airlineDb = await getAirlineDatabase(s3, READ_BUCKET);
    logger.info(`Loaded airline database with ${Object.keys(airlineDb || {}).length} entries`);
    
    const now = Date.now();
    const startDate = now - (DAYS_TO_PROCESS * 24 * 60 * 60 * 1000);
    
    // Process day by day
    for (let day = 0; day < DAYS_TO_PROCESS; day++) {
        const dayStart = startDate + (day * 24 * 60 * 60 * 1000);
        const dayEnd = dayStart + (24 * 60 * 60 * 1000);
        const dayDate = new Date(dayStart);
        const year = dayDate.getUTCFullYear();
        const month = (dayDate.getUTCMonth() + 1).toString().padStart(2, '0');
        const dayStr = dayDate.getUTCDate().toString().padStart(2, '0');
        
        logger.info('');
        logger.info(`======== Day ${day + 1}/${DAYS_TO_PROCESS}: ${year}-${month}-${dayStr} ========`);
        
        // Process each hour of the day
        const hourlyFlightsByHour = {};
        
        for (let hour = 0; hour < 24; hour++) {
            const hourStart = dayStart + (hour * 60 * 60 * 1000);
            const hourEnd = hourStart + (60 * 60 * 1000);
            
            logger.info(`Processing hour ${hour.toString().padStart(2, '0')}:00...`);
            
            const flights = await processTimeRange(hourStart, hourEnd, airlineDb);
            
            if (flights.length > 0) {
                const hourKey = `flights/hourly/flights_${year}${month}${dayStr}_${hour.toString().padStart(2, '0')}00.json`;
                await saveFlightsToS3(flights, hourKey);
                hourlyFlightsByHour[hour] = flights;
            }
        }
        
        // Aggregate all flights for the day
        const allDayFlights = [];
        for (const hour in hourlyFlightsByHour) {
            allDayFlights.push(...hourlyFlightsByHour[hour]);
        }
        
        if (allDayFlights.length > 0) {
            logger.info(`Aggregating ${allDayFlights.length} flights for daily file...`);
            const dailyKey = `flights/daily/flights_${year}${month}${dayStr}.json`;
            await saveFlightsToS3(allDayFlights, dailyKey);
        }
        
        logger.info(`Day ${year}-${month}-${dayStr} complete: ${allDayFlights.length} flights total`);
    }
    
    logger.info('');
    logger.info('=== Population Complete ===');
}

// Run the script
main().catch(err => {
    logger.error('Fatal error:', err);
    process.exit(1);
});
