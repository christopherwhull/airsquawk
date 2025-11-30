const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { downloadAndParseS3File } = require('./lib/s3-helpers.js');

const s3 = new S3Client({
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    credentials: {
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin123',
    },
    forcePathStyle: true,
});

const BUCKET_NAME = 'aircraft-data';

async function countRecentRecords() {
    try {
        const command = new ListObjectsV2Command({ Bucket: BUCKET_NAME });
        const data = await s3.send(command);
        const allFiles = data.Contents || [];

        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);

        const recentFiles = allFiles.filter(file =>
            file.Key.includes('piaware_aircraft_log') &&
            new Date(file.LastModified).getTime() > oneHourAgo
        );

        if (recentFiles.length === 0) {
            console.log('No flight log files found in the last hour.');
            return;
        }

        console.log(`Found ${recentFiles.length} files from the last hour to process.`);
        let totalRecords = 0;

        const processingPromises = recentFiles.map(async file => {
            const fileData = await downloadAndParseS3File(s3, BUCKET_NAME, file.Key);
            if (fileData && Array.isArray(fileData)) {
                return fileData.length;
            }
            return 0;
        });

        const counts = await Promise.all(processingPromises);
        totalRecords = counts.reduce((sum, count) => sum + count, 0);

        console.log(`Total flight records in the last hour: ${totalRecords}`);

    } catch (error) {
        console.error('Error counting S3 records:', error);
    }
}

countRecentRecords();
