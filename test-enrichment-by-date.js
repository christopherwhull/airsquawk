const fs = require('fs').promises;
const AWS = require('@aws-sdk/client-s3');
const config = require('./config.js');

async function analyzeEnrichmentByDay() {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║  Detailed Enrichment Analysis by Day                   ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    try {
        // Load aircraft database
        const aircraftData = await fs.readFile('opensky_aircraft_cache.json', 'utf8');
        const aircraftCache = JSON.parse(aircraftData);
        const aircraftDB = aircraftCache.aircraft || {};

        // Load aircraft types
        const typesData = await fs.readFile('aircraft_types.json', 'utf8');
        const typesJson = JSON.parse(typesData);

        // Analyze S3 files directly
        const s3 = new AWS.S3Client(config.s3);
        
        // List files from aircraft-data
        const listCommand = new AWS.ListObjectsV2Command({
            Bucket: 'aircraft-data',
            Prefix: 'data/piaware_aircraft_log',
            MaxKeys: 100
        });

        const response = await s3.send(listCommand);
        const files = response.Contents || [];
        
        // Extract unique dates from filenames
        const dateMap = {};
        
        files.forEach(file => {
            const match = file.Key.match(/piaware_aircraft_log_(\d{8})/);
            if (match) {
                const date = match[1];
                if (!dateMap[date]) {
                    dateMap[date] = [];
                }
                dateMap[date].push(file.Key);
            }
        });

        const dates = Object.keys(dateMap).sort().reverse();
        
        console.log(`Found ${files.length} files across ${dates.length} unique dates:\n`);
        console.log('Date          Files    Records    Enriched    Type%     Mfr%');
        console.log('─'.repeat(65));

        // Analyze each day
        for (const date of dates) {
            const fileList = dateMap[date];
            let totalRecords = 0;
            let enrichedCount = 0;
            let withType = 0;
            let withManu = 0;

            // Sample a few files from this date
            const sampleSize = Math.min(3, fileList.length);
            for (let i = 0; i < sampleSize; i++) {
                try {
                    const getCommand = new AWS.GetObjectCommand({
                        Bucket: 'aircraft-data',
                        Key: fileList[i]
                    });

                    const getResponse = await s3.send(getCommand);
                    const chunks = [];

                    for await (const chunk of getResponse.Body) {
                        chunks.push(chunk);
                    }

                    const body = Buffer.concat(chunks).toString('utf-8');
                    const records = JSON.parse(body);
                    totalRecords += records.length;

                    // Check enrichment
                    for (const record of records) {
                        const icao = record.ICAO || record.hex || record.icao;
                        const aircraft = aircraftDB[icao];

                        if (aircraft && aircraft.typecode) {
                            enrichedCount++;
                            withType++;
                            const typeInfo = typesJson.types[aircraft.typecode];
                            if (typeInfo && typeInfo.manufacturer) {
                                withManu++;
                            }
                        } else {
                            // Check if record already has type
                            if (record.Aircraft_type && record.Aircraft_type !== 'N/A') {
                                withType++;
                                const typeInfo = typesJson.types[record.Aircraft_type];
                                if (typeInfo && typeInfo.manufacturer) {
                                    withManu++;
                                }
                            }
                        }
                    }
                } catch (err) {
                    // Skip problematic files
                }
            }

            const dateStr = `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`;
            const typePercent = totalRecords > 0 ? ((withType / totalRecords) * 100).toFixed(1) : '0.0';
            const manufPercent = totalRecords > 0 ? ((withManu / totalRecords) * 100).toFixed(1) : '0.0';
            
            console.log(
                dateStr.padEnd(14) +
                fileList.length.toString().padStart(8) +
                totalRecords.toString().padStart(9) +
                enrichedCount.toString().padStart(12) +
                typePercent.padStart(9) + '%' +
                manufPercent.padStart(8) + '%'
            );
        }

        console.log('\n✓ Enrichment analysis complete\n');

    } catch (error) {
        console.error('Error:', error.message);
    }
}

analyzeEnrichmentByDay();
