const fs = require('fs');
const path = require('path');

/**
 * Debug script to inspect heatmap data loading and enrichment
 */
async function debugHeatmapLoading() {
    const config = require('./config');
    const { S3Client } = require('@aws-sdk/client-s3');
    const { listS3Files, downloadAndParseS3File } = require('./lib/s3-helpers');
    const aircraftTypesDB = require('./lib/aircraft-types-db');
    
    const s3 = new S3Client({
        endpoint: config.s3.endpoint,
        region: config.s3.region,
        credentials: config.s3.credentials,
        forcePathStyle: config.s3.forcePathStyle,
    });
    
    // Load aircraft cache
    console.log('\n1. Loading aircraft cache...');
    const aircraftCache = JSON.parse(fs.readFileSync('opensky_aircraft_cache.json'));
    const aircraftCount = Object.keys(aircraftCache.aircraft || {}).length;
    console.log(`   ✓ Loaded ${aircraftCount} aircraft in cache`);
    
    // Get first few S3 files
    console.log('\n2. Getting S3 files...');
    const files = await listS3Files(s3, config.buckets.readBucket, 'data/piaware_aircraft_log', 1, 5);
    console.log(`   ✓ Found ${files.length} total S3 files`);
    
    // Sort by most recent
    const sorted = files.sort((a, b) => b.Key.localeCompare(a.Key));
    
    // Test enrichment on most recent file
    console.log('\n3. Testing enrichment on most recent file...');
    const testFile = sorted[0];
    console.log(`   File: ${testFile.Key}`);
    
    try {
        const records = await downloadAndParseS3File(s3, config.buckets.readBucket, testFile.Key);
        console.log(`   ✓ Loaded ${records.length} records`);
        
        // Test enrichment
        let enrichedCount = 0;
        let manufacturerCounts = {};
        const samples = [];
        
        for (let i = 0; i < Math.min(50, records.length); i++) {
            const record = records[i];
            const aircraft = aircraftCache.aircraft[record.ICAO];
            
            if (aircraft && aircraft.typecode) {
                enrichedCount++;
                const typeInfo = aircraftTypesDB.lookup(aircraft.typecode);
                if (typeInfo && typeInfo.manufacturer) {
                    manufacturerCounts[typeInfo.manufacturer] = (manufacturerCounts[typeInfo.manufacturer] || 0) + 1;
                    if (samples.length < 5) {
                        samples.push({
                            icao: record.ICAO,
                            typecode: aircraft.typecode,
                            manufacturer: typeInfo.manufacturer,
                            model: typeInfo.model
                        });
                    }
                }
            }
        }
        
        console.log(`\n   Enrichment stats (first 50 records):`);
        console.log(`   - Enriched: ${enrichedCount}/50`);
        console.log(`   - Manufacturers found: ${Object.keys(manufacturerCounts).length}`);
        
        if (Object.keys(manufacturerCounts).length > 0) {
            console.log(`   - Breakdown:`);
            Object.entries(manufacturerCounts).forEach(([mfr, count]) => {
                console.log(`     ${mfr}: ${count}`);
            });
        }
        
        if (samples.length > 0) {
            console.log(`\n   Sample enriched records:`);
            samples.forEach(s => {
                console.log(`   - ${s.icao} => ${s.typecode} (${s.manufacturer} ${s.model})`);
            });
        }
        
        // Check if any records have lat/lon
        console.log(`\n   Position validity (first 20 records):`);
        let validPositions = 0;
        for (let i = 0; i < Math.min(20, records.length); i++) {
            const record = records[i];
            const lat = record.Latitude || record.lat;
            const lon = record.Longitude || record.lon;
            if (lat && lon && typeof lat === 'number' && typeof lon === 'number') {
                validPositions++;
            }
        }
        console.log(`   - Valid positions: ${validPositions}/20`);
        
    } catch (e) {
        console.error('   ✗ Error:', e.message);
    }
}

debugHeatmapLoading()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
