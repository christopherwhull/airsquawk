
const { listS3Files, downloadAndParseS3File } = require('./lib/s3-helpers');
const AWS = require('@aws-sdk/client-s3');
const config = require('./config');

const s3 = new AWS.S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: config.s3.credentials,
  forcePathStyle: config.s3.forcePathStyle
});

async function findLastTransition() {
  try {
    console.log('--- Finding Last Squawk Transition ---');
    
    let lastTransitionTimestamp = 0;
    let lastTransitionDetails = null;
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

          if (timestamp > lastTransitionTimestamp) {
            lastTransitionTimestamp = timestamp;
            lastTransitionDetails = {
              hex,
              flight: (aircraft.flight || aircraft.Ident || '').trim(),
              from: lastSquawkPerAircraft[hex].code,
              to: squawk,
              timestamp
            };
          }
        }
        lastSquawkPerAircraft[hex] = { code: squawk };
      }
    }
    
    console.log('---------------------------------');
    console.log('✅ SEARCH COMPLETE');
    if (lastTransitionTimestamp > 0) {
      const lastDate = new Date(lastTransitionTimestamp);
      console.log(`The last squawk transition in the S3 data occurred on:`);
      console.log(`  ${lastDate.toUTCString()}`);
      console.log(`  (${lastDate.toLocaleString()})`);
      console.log('\nDetails:');
      console.log(lastTransitionDetails);
    } else {
      console.log('No transitions were found in the S3 data.');
    }
    console.log('---------------------------------');

  } catch (err) {
    console.error('❌ An error occurred while searching for the last transition:', err);
  }
}

findLastTransition();
