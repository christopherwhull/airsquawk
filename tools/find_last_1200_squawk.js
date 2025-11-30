
const { listS3Files, downloadAndParseS3File } = require('./lib/s3-helpers');
const AWS = require('@aws-sdk/client-s3');
const config = require('./config');

const s3 = new AWS.S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: config.s3.credentials,
  forcePathStyle: config.s3.forcePathStyle
});

async function findLast1200Squawk() {
  try {
    console.log('--- Finding Last "1200" Squawk Record ---');
    
    let last1200Timestamp = 0;
    let last1200Record = null;
    let sourceFile = null;
    
    console.log('Step 1: Listing all piaware log files from S3...');
    const files = await listS3Files(s3, config.buckets.readBucket, 'piaware_aircraft_log');
    // Process files in reverse chronological order to find the latest faster
    files.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
    console.log(`Step 2: Found ${files.length} total files. Processing in reverse order...`);

    let processedCount = 0;
    for (const file of files) {
      processedCount++;
      if (processedCount % 500 === 0) {
        console.log(`  ...processed ${processedCount} of ${files.length} files...`);
      }

      const aircraftData = await downloadAndParseS3File(s3, config.buckets.readBucket, file.Key);
      if (!Array.isArray(aircraftData)) continue;

      for (const aircraft of aircraftData) {
        const squawk = aircraft.squawk || aircraft.Squawk;
        if (squawk === '1200') {
          let timestamp = aircraft.lastSeen || aircraft.Last_Seen || new Date(file.LastModified).getTime();
          if (typeof timestamp === 'string') timestamp = new Date(timestamp).getTime();
          else if (timestamp < 9999999999) timestamp = timestamp * 1000;

          if (timestamp > last1200Timestamp) {
            last1200Timestamp = timestamp;
            last1200Record = aircraft;
            sourceFile = file.Key;
          }
        }
      }
    }
    
    console.log('---------------------------------');
    console.log('✅ SEARCH COMPLETE');
    if (last1200Timestamp > 0) {
      const lastDate = new Date(last1200Timestamp);
      console.log(`The last record with a squawk of "1200" was found in file "${sourceFile}"`);
      console.log(`Timestamp:`);
      console.log(`  ${lastDate.toUTCString()}`);
      console.log(`  (${lastDate.toLocaleString()})`);
      console.log('\nFull Record Details:');
      console.log(JSON.stringify(last1200Record, null, 2));
    } else {
      console.log('No records with a squawk of "1200" were found in the S3 data.');
    }
    console.log('---------------------------------');

  } catch (err) {
    console.error('❌ An error occurred while searching for the last 1200 squawk:', err);
  }
}

findLast1200Squawk();
