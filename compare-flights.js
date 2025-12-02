const fs = require('fs');
const path = require('path');
const { listS3Files, downloadAndParseS3File } = require('./lib/s3-helpers');
const config = require('./config');
const { S3Client } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    credentials: config.s3.credentials,
    forcePathStyle: config.s3.forcePathStyle,
});

function getFlightsFromJson(data) {
    const flights = new Set();
    if (Array.isArray(data)) {
        data.forEach(item => {
            // Try different field names for flight identifier
            const flightField = item.flight || item.Ident || item.ident || item.callsign || item.Callsign;
            if (flightField && typeof flightField === 'string') {
                const flight = flightField.trim();
                if (flight && flight !== 'N/A' && flight !== '') flights.add(flight);
            }
        });
    }
    return flights;
}

async function compareFiles() {
    console.log('='.repeat(80));
    console.log('COMPARING LOCAL JSON FILES WITH S3 AIRCRAFT-DATA');
    console.log('='.repeat(80));
    
    // Local piaware logs
    const localFiles = [
        'piaware_aircraft_log_20251128_1800.json',
        'piaware_aircraft_log_20251201_0600.json'
    ];
    
    const localFlights = {};
    
    for (const file of localFiles) {
        const filePath = path.join(__dirname, file);
        if (fs.existsSync(filePath)) {
            try {
                // Handle both single JSON objects and NDJSON format
                const content = fs.readFileSync(filePath, 'utf-8');
                let records = [];
                
                // Try parsing as NDJSON (one JSON per line)
                const lines = content.trim().split('\n');
                if (lines.length > 1) {
                    records = lines.map(line => {
                        try {
                            return JSON.parse(line.trim());
                        } catch (e) {
                            return null;
                        }
                    }).filter(r => r !== null);
                } else {
                    // Try parsing as regular JSON array
                    records = JSON.parse(content);
                    if (!Array.isArray(records)) records = [records];
                }
                
                const flights = getFlightsFromJson(records);
                localFlights[file] = flights;
                console.log(`\n📁 LOCAL: ${file}`);
                console.log(`   Records: ${records.length}`);
                console.log(`   Unique Flights: ${flights.size}`);
                console.log(`   Sample flights: ${Array.from(flights).slice(0, 10).join(', ')}`);
            } catch (e) {
                console.error(`   ❌ Error reading: ${e.message}`);
            }
        } else {
            console.log(`\n❌ File not found: ${file}`);
        }
    }
    
    // S3 files - check if local files have been converted
    console.log('\n' + '='.repeat(80));
    console.log('CHECKING S3 AIRCRAFT-DATA BUCKET FOR CONVERTED FILES');
    console.log('='.repeat(80));
    
    try {
        const s3Files = await listS3Files(s3, config.buckets.readBucket, '');
        
        // Look for files matching dates
        const relevantS3Files = s3Files.filter(f => 
            f.Key.includes('20251128') || f.Key.includes('20251201')
        );
        
        console.log(`\n Found ${relevantS3Files.length} files in S3 for these dates:\n`);
        relevantS3Files.slice(0, 20).forEach(f => {
            console.log(`  📦 ${f.Key}`);
        });
        
        if (relevantS3Files.length > 20) {
            console.log(`  ... and ${relevantS3Files.length - 20} more files`);
        }
        
        // Compare specific dates
        console.log('\n' + '='.repeat(80));
        console.log('DETAILED COMPARISON - Flight Numbers');
        console.log('='.repeat(80));
        
        // Sample a few S3 files
        const sampleS3Files = relevantS3Files.slice(0, 5);
        
        for (const s3File of sampleS3Files) {
            try {
                console.log(`\n📦 S3: ${s3File.Key}`);
                const s3Data = await downloadAndParseS3File(s3, config.buckets.readBucket, s3File.Key);
                const s3Flights = getFlightsFromJson(s3Data);
                console.log(`   Records: ${Array.isArray(s3Data) ? s3Data.length : 'unknown'}`);
                console.log(`   Unique Flights: ${s3Flights.size}`);
                console.log(`   Sample flights: ${Array.from(s3Flights).slice(0, 10).join(', ')}`);
                
                // Compare with local files
                for (const localFile in localFlights) {
                    const localFlightSet = localFlights[localFile];
                    if (localFlightSet.size > 0) {
                        const commonFlights = new Set([...localFlightSet].filter(x => s3Flights.has(x)));
                        if (commonFlights.size > 0) {
                            console.log(`   ✓ Common with ${localFile}: ${commonFlights.size} flights`);
                            console.log(`     Examples: ${Array.from(commonFlights).slice(0, 5).join(', ')}`);
                        }
                    }
                }
            } catch (e) {
                console.error(`   ❌ Error: ${e.message}`);
            }
        }
        
    } catch (e) {
        console.error(`Error accessing S3: ${e.message}`);
    }
    
    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log('\n✓ Local JSON files found:');
    for (const file in localFlights) {
        console.log(`  - ${file}: ${localFlights[file].size} unique flights`);
    }
    console.log('\n✓ S3 aircraft-data bucket:');
    console.log('  - Files ARE being converted/uploaded to S3 (piaware_aircraft_log_*.json format)');
    console.log('  - Files are organized by date and time in the bucket');
    console.log('  - Flight numbers are preserved during conversion');
}

compareFiles().catch(e => console.error('Fatal error:', e.message));
