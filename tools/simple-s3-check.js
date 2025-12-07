
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const config = require('../config');

async function simpleS3Check() {
    console.log('--- Running simplified S3 check ---');

    const s3 = new S3Client({
        region: config.s3.region,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    });

    const readBucket = config.s3.readBucket;
    console.log(`Checking bucket: ${readBucket}`);

    try {
        const command = new ListObjectsV2Command({
            Bucket: readBucket,
            Prefix: 'data/piaware_aircraft_log',
            MaxKeys: 10
        });
        const data = await s3.send(command);

        console.log(`Successfully connected to S3. Found ${data.Contents.length} files.`);
        if (data.Contents.length > 0) {
            console.log('Sample files:');
            data.Contents.forEach(f => console.log(`  - ${f.Key}`));
        } else {
            console.log('No files found with that prefix.');
        }

    } catch (error) {
        console.error('Error connecting to S3 or listing files:', error);
    }
}

simpleS3Check();
