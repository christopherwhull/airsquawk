
const { S3Client } = require('@aws-sdk/client-s3');
const { listS3Files } = require('../lib/s3-helpers');
const config = require('../config');

async function checkS3Layout() {
    console.log('Checking S3 data layout...');

    // Use the endpoint and credentials from the main config file
    const s3 = new S3Client({
        endpoint: config.s3.endpoint,
        region: config.s3.region,
        credentials: config.s3.credentials,
        forcePathStyle: config.s3.forcePathStyle,
    });

    const readBucket = config.buckets.readBucket;

    try {
        console.log(`\n--- Checking for minute-by-minute data in read bucket (${readBucket}) ---`);
        const minutePrefix = 'data/piaware_aircraft_log';
        const minuteFiles = await listS3Files(s3, readBucket, minutePrefix);
        console.log(`Found ${minuteFiles.length} files under '${minutePrefix}'`);
        if (minuteFiles.length > 0) {
            console.log('Sample files:');
            minuteFiles.slice(0, 5).forEach(f => console.log(`  - ${f.Key}`));
        }

        console.log(`\n--- Checking for hourly aggregated data in read bucket (${readBucket}) ---`);
        const hourlyPrefix = 'data/hourly/positions_';
        const hourlyFiles = await listS3Files(s3, readBucket, hourlyPrefix);
        console.log(`Found ${hourlyFiles.length} files under '${hourlyPrefix}'`);
        if (hourlyFiles.length > 0) {
            console.log('Sample files:');
            hourlyFiles.slice(0, 5).forEach(f => console.log(`  - ${f.Key}`));
        }

        if (hourlyFiles.length > 0 && minuteFiles.length > 0) {
            console.log('\nConclusion: Both minute and hourly data files were found in the expected locations.');
        } else if (hourlyFiles.length > 0) {
            console.log('\nConclusion: Only hourly data was found. The minute-by-minute files may be missing or in a different location.');
        } else if (minuteFiles.length > 0) {
            console.log('\nConclusion: Only minute-by-minute data was found. The hourly aggregated files are not in the expected location.');
        } else {
            console.log('\nConclusion: No data files were found in the common locations. Please check your S3 bucket and prefixes.');
        }

    } catch (error) {
        console.error('\nAn error occurred while checking the S3 data layout:', error);
    }
}

checkS3Layout();
