const { S3Client, CreateBucketCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    credentials: {
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin123',
    },
    forcePathStyle: true,
});

const BUCKET_NAME = 'aircraft-data-new';

async function createBucket() {
    try {
        const command = new CreateBucketCommand({
            Bucket: BUCKET_NAME,
        });
        await s3.send(command);
        console.log('Bucket created successfully.');
    } catch (error) {
        console.error('Error creating bucket:', error);
    }
}

createBucket();
