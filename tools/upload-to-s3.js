const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

const s3 = new AWS.S3({
    endpoint: 'http://localhost:9000',
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin123',
    s3ForcePathStyle: true,
    signatureVersion: 'v4'
});

const BUCKET_NAME = 'aircraft-data';
const FILE_PATH = path.join(__dirname, 'airline_database.json');
const OBJECT_NAME = 'airline_database.json';

async function uploadToS3() {
    try {
        // Ensure the bucket exists
        try {
            await s3.headBucket({ Bucket: BUCKET_NAME }).promise();
        } catch (e) {
            console.log(`Bucket does not exist. Creating bucket: ${BUCKET_NAME}`);
            await s3.createBucket({ Bucket: BUCKET_NAME }).promise();
        }

        console.log(`Uploading ${FILE_PATH} to S3 bucket ${BUCKET_NAME}...`);

        const fileContent = fs.readFileSync(FILE_PATH);

        const params = {
            Bucket: BUCKET_NAME,
            Key: OBJECT_NAME,
            Body: fileContent,
            ContentType: 'application/json'
        };

        await s3.putObject(params).promise();
        console.log('Successfully uploaded airline_database.json to S3.');
    } catch (error) {
        console.error('Error uploading to S3:', error);
    }
}

uploadToS3();
