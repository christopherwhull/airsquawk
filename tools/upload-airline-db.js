const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');

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
const FILE_PATH = 'C:/Users/chris/aircraft-dashboard-new/airline_database.json';
const OBJECT_KEY = 'airline_database.json';

async function uploadFile() {
    try {
        const fileContent = fs.readFileSync(FILE_PATH);
        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: OBJECT_KEY,
            Body: fileContent,
        });
        await s3.send(command);
        console.log('File uploaded successfully.');
    } catch (error) {
        console.error('Error uploading file:', error);
    }
}

uploadFile();
