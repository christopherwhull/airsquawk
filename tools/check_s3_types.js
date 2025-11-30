const { S3Client } = require('@aws-sdk/client-s3');
const { listS3Files, downloadAndParseS3File } = require('./lib/s3-helpers');
const config = require('./config');

const s3 = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    credentials: config.s3.credentials,
    forcePathStyle: config.s3.forcePathStyle
});

async function checkS3Types() {
    try {
        console.log('Fetching S3 files from aircraft-data-new...');
        const files = await listS3Files(s3, 'aircraft-data-new', 'data/piaware_aircraft_log');
        
        console.log(`Found ${files.length} files. Checking recent files...`);
        
        // Check the most recent 10 files
        const recentFiles = files.slice(-10);
        const typeCounts = {};
        let totalAircraft = 0;
        let aircraftWithType = 0;
        let aircraftWithAircraftType = 0;
        
        for (const file of recentFiles) {
            console.log(`\nChecking file: ${file.Key}`);
            const data = await downloadAndParseS3File(s3, 'aircraft-data-new', file.Key);
            
            console.log(`  - Data type: ${typeof data}, isArray: ${Array.isArray(data)}`);
            
            // Handle both array format and {aircraft: [...]} format
            const aircraftArray = Array.isArray(data) ? data : (data && data.aircraft ? data.aircraft : []);
            
            if (aircraftArray.length > 0) {
                console.log(`  - Contains ${aircraftArray.length} aircraft records`);
                
                for (const ac of aircraftArray) {
                    totalAircraft++;
                    
                    // Check for aircraft_type field
                    if (ac.aircraft_type) {
                        aircraftWithAircraftType++;
                        typeCounts[ac.aircraft_type] = (typeCounts[ac.aircraft_type] || 0) + 1;
                    }
                    
                    // Check for t field
                    if (ac.t) {
                        aircraftWithType++;
                        if (!ac.aircraft_type) {
                            typeCounts[ac.t] = (typeCounts[ac.t] || 0) + 1;
                        }
                    }
                    
                    // Show first aircraft as sample
                    if (totalAircraft === 1) {
                        console.log('  - Sample aircraft fields:', Object.keys(ac).sort().join(', '));
                    }
                }
            }
        }
        
        console.log('\n=== SUMMARY ===');
        console.log(`Total aircraft checked: ${totalAircraft}`);
        console.log(`Aircraft with 'aircraft_type' field: ${aircraftWithAircraftType} (${((aircraftWithAircraftType/totalAircraft)*100).toFixed(1)}%)`);
        console.log(`Aircraft with 't' field: ${aircraftWithType} (${((aircraftWithType/totalAircraft)*100).toFixed(1)}%)`);
        console.log(`\nUnique types found: ${Object.keys(typeCounts).length}`);
        
        // Show top 10 types
        const sortedTypes = Object.entries(typeCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
        
        console.log('\nTop 10 aircraft types:');
        sortedTypes.forEach(([type, count]) => {
            console.log(`  ${type}: ${count}`);
        });
        
    } catch (error) {
        console.error('Error:', error);
    }
}

checkS3Types();
