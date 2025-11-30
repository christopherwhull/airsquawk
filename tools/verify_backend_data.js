
const { listS3Files, downloadAndParseS3File } = require('./lib/s3-helpers');
const AWS = require('@aws-sdk/client-s3');
const config = require('./config');

// --- Time Range Configuration ---
// Assuming EST for local time (UTC-5)
const startTime = Date.parse('2025-11-28T05:53:00.000-05:00');
const endTime = Date.parse('2025-11-28T11:53:00.000-05:00');

const s3 = new AWS.S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: config.s3.credentials,
  forcePathStyle: config.s3.forcePathStyle
});

async function verifyTransitions() {
  try {
    console.log('--- Backend Data Verification ---');
    console.log(`Checking for squawk transitions between:`);
    console.log(`  Start: ${new Date(startTime).toISOString()} (UTC)`);
    console.log(`  End:   ${new Date(endTime).toISOString()} (UTC)`);
    console.log('---------------------------------');

    const allTransitions = [];
    const lastSquawkPerAircraft = {};
    
    console.log('Step 1: Listing all piaware log files from S3...');
    const files = await listS3Files(s3, config.buckets.readBucket, 'piaware_aircraft_log');
    console.log(`Step 2: Found ${files.length} total files. Processing now...`);

    let processedCount = 0;
    for (const file of files) {
      processedCount++;
      if (processedCount % 500 === 0) {
        console.log(`  ...processed ${processedCount} of ${files.length} files...`);
      }

      const aircraftData = await downloadAndParseS3File(s3, config.buckets.readBucket, file.Key);
      if (!Array.isArray(aircraftData)) continue;

      for (const aircraft of aircraftData) {
        const hex = aircraft.hex || aircraft.ICAO;
        const squawk = aircraft.squawk || aircraft.Squawk;
        if (!hex || !squawk) continue;

        if (lastSquawkPerAircraft[hex] && lastSquawkPerAircraft[hex].code !== squawk) {
          let timestamp = aircraft.lastSeen || aircraft.Last_Seen || new Date(file.LastModified).getTime();
          if (typeof timestamp === 'string') timestamp = new Date(timestamp).getTime();
          else if (timestamp < 9999999999) timestamp = timestamp * 1000;
          allTransitions.push({ timestamp });
        }
        lastSquawkPerAircraft[hex] = { code: squawk };
      }
    }
    
    console.log(`Step 3: Found a total of ${allTransitions.length} transitions in all S3 data.`);
    
    const transitionsInWindow = allTransitions.filter(t => t.timestamp >= startTime && t.timestamp <= endTime);
    
    console.log('---------------------------------');
    console.log('✅ VERIFICATION COMPLETE');
    console.log(`Found ${transitionsInWindow.length} transitions within the specified time window.`);
    console.log('---------------------------------');

  } catch (err) {
    console.error('❌ An error occurred during backend data check:', err);
  }
}

verifyTransitions();
