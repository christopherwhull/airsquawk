const AWS = require('@aws-sdk/client-s3');
const s3Client = require('aws-sdk');

// Load config
const config = require('./config.js');

async function checkTimestamps() {
    console.log('Checking S3 files for timestamp format...\n');
    
    const s3 = new AWS.S3Client(config.s3);
    
    try {
        // List a few recent files
        const command = new AWS.ListObjectsV2Command({
            Bucket: 'aircraft-data',
            Prefix: 'data/piaware_aircraft_log',
            MaxKeys: 5
        });
        
        const response = await s3.send(command);
        const files = response.Contents || [];
        
        if (files.length > 0) {
            console.log(`Found ${files.length} recent files. Checking first file for timestamp fields...\n`);
            
            // Get first file
            const firstFile = files[0];
            console.log(`Checking file: ${firstFile.Key}`);
            
            const getCommand = new AWS.GetObjectCommand({
                Bucket: 'aircraft-data',
                Key: firstFile.Key
            });
            
            const getResponse = await s3.send(getCommand);
            const chunks = [];
            
            for await (const chunk of getResponse.Body) {
                chunks.push(chunk);
            }
            
            const body = Buffer.concat(chunks).toString('utf-8');
            const records = JSON.parse(body);
            
            if (records.length > 0) {
                const firstRecord = records[0];
                console.log('\nFirst record structure:');
                console.log(JSON.stringify(firstRecord, null, 2).substring(0, 800));
                
                // Check what timestamp fields exist
                const timestampFields = ['Timestamp', 'timestamp', 'First_Seen', 'firstSeen', 'Last_Seen', 'lastSeen', 'Time'];
                console.log('\nTimestamp fields present:');
                timestampFields.forEach(field => {
                    if (field in firstRecord) {
                        console.log(`   ✓ ${field}: ${firstRecord[field]}`);
                    }
                });
            }
        }
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkTimestamps();
