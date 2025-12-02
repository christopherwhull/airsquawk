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
    console.log('='.repeat(90));
    console.log('COMPARISON: SAME DAY ONLY (2025-12-01)');
    console.log('='.repeat(90));
    
    // Local file for 2025-12-01
    const localFile = 'piaware_aircraft_log_20251201_0600.json';
    const filePath = path.join(__dirname, localFile);
    
    let localFlights = new Set();
    let localRecords = 0;
    
    if (fs.existsSync(filePath)) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.trim().split('\n');
            const records = lines.map(line => {
                try {
                    return JSON.parse(line.trim());
                } catch (e) {
                    return null;
                }
            }).filter(r => r !== null);
            
            localFlights = getFlightsFromJson(records);
            localRecords = records.length;
            
            console.log(`\n📁 LOCAL FILE: ${localFile}`);
            console.log(`   Records: ${localRecords}`);
            console.log(`   Unique Flights: ${localFlights.size}`);
            console.log(`   All flights: ${Array.from(localFlights).sort().join(', ')}`);
        } catch (e) {
            console.error(`❌ Error reading local file: ${e.message}`);
            return;
        }
    } else {
        console.log(`❌ Local file not found: ${localFile}`);
        return;
    }
    
    // S3 files for same day
    console.log('\n' + '='.repeat(90));
    console.log('S3 AIRCRAFT-DATA BUCKET (2025-12-01)');
    console.log('='.repeat(90));
    
    try {
        const s3Files = await listS3Files(s3, config.buckets.readBucket, '');
        
        // Filter for 20251201 files only
        const sameDayS3Files = s3Files.filter(f => f.Key.includes('20251201'));
        
        console.log(`\n Found ${sameDayS3Files.length} files in S3 for 2025-12-01\n`);
        sameDayS3Files.slice(0, 20).forEach(f => {
            console.log(`  📦 ${f.Key}`);
        });
        
        if (sameDayS3Files.length > 20) {
            console.log(`  ... and ${sameDayS3Files.length - 20} more files`);
        }
        
        // Compare all S3 files for this day
        console.log('\n' + '='.repeat(90));
        console.log('DETAILED COMPARISON - ALL 2025-12-01 FILES');
        console.log('='.repeat(90));
        
        let totalS3Records = 0;
        let allS3Flights = new Set();
        const fileComparisons = [];
        
        for (const s3File of sameDayS3Files) {
            try {
                const s3Data = await downloadAndParseS3File(s3, config.buckets.readBucket, s3File.Key);
                const s3Flights = getFlightsFromJson(s3Data);
                const recordCount = Array.isArray(s3Data) ? s3Data.length : 0;
                
                totalS3Records += recordCount;
                s3Flights.forEach(f => allS3Flights.add(f));
                
                const commonFlights = new Set([...localFlights].filter(x => s3Flights.has(x)));
                
                fileComparisons.push({
                    file: s3File.Key,
                    records: recordCount,
                    flights: s3Flights.size,
                    commonFlights: commonFlights.size,
                    commonList: Array.from(commonFlights)
                });
            } catch (e) {
                console.error(`❌ Error processing ${s3File.Key}: ${e.message}`);
            }
        }
        
        // Display file-by-file comparison
        fileComparisons.forEach(comp => {
            console.log(`\n📦 ${comp.file}`);
            console.log(`   Records: ${comp.records} | Unique Flights: ${comp.flights}`);
            console.log(`   ✓ Common with local: ${comp.commonFlights}/${localFlights.size} flights`);
            if (comp.commonList.length > 0) {
                console.log(`   Common flights: ${comp.commonList.sort().join(', ')}`);
            }
        });
        
        // Summary statistics
        console.log('\n' + '='.repeat(90));
        console.log('SUMMARY STATISTICS');
        console.log('='.repeat(90));
        
        console.log(`\n📊 LOCAL FILE (piaware_aircraft_log_20251201_0600.json):`);
        console.log(`   Total Records: ${localRecords}`);
        console.log(`   Unique Flights: ${localFlights.size}`);
        
        console.log(`\n📊 S3 BUCKET (All 2025-12-01 files combined):`);
        console.log(`   Total Records: ${totalS3Records}`);
        console.log(`   Unique Flights: ${allS3Flights.size}`);
        
        const commonAll = new Set([...localFlights].filter(x => allS3Flights.has(x)));
        console.log(`\n✓ OVERLAP:`);
        console.log(`   Common Flights: ${commonAll.size}/${localFlights.size} (${(commonAll.size / localFlights.size * 100).toFixed(1)}%)`);
        console.log(`   Common flights: ${Array.from(commonAll).sort().join(', ')}`);
        
        const onlyLocal = new Set([...localFlights].filter(x => !allS3Flights.has(x)));
        const onlyS3 = new Set([...allS3Flights].filter(x => !localFlights.has(x)));
        
        if (onlyLocal.size > 0) {
            console.log(`\n📍 ONLY IN LOCAL FILE:`);
            console.log(`   ${Array.from(onlyLocal).sort().join(', ')}`);
        }
        
        if (onlyS3.size > 0) {
            console.log(`\n📍 ONLY IN S3 (recent flights not in 0600 snapshot):`);
            console.log(`   Count: ${onlyS3.size}`);
            console.log(`   Flights: ${Array.from(onlyS3).sort().slice(0, 20).join(', ')}${onlyS3.size > 20 ? '...' : ''}`);
        }
        
    } catch (e) {
        console.error(`Error accessing S3: ${e.message}`);
    }
}

compareFiles().catch(e => console.error('Fatal error:', e.message));
