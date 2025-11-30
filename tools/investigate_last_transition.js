
const { listS3Files, downloadAndParseS3File } = require('./lib/s3-helpers');
const AWS = require('@aws-sdk/client-s3');
const config = require('./config');

const s3 = new AWS.S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: config.s3.credentials,
  forcePathStyle: config.s3.forcePathStyle
});

async function investigateLastTransition() {
  try {
    console.log('--- Investigating Last Squawk Transition to "N/A" ---');
    
    let lastTransitionTimestamp = 0;
    let lastTransitionDetails = null;
    let sourceFile = null;
    const lastSquawkPerAircraft = {};
    
    console.log('Step 1: Re-scanning all S3 files to find the source of the "N/A" transition...');
    const files = await listS3Files(s3, config.buckets.readBucket, 'piaware_aircraft_log');
    
    for (const file of files) {
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
            lastTransitionDetails = { hex, from: lastSquawkPerAircraft[hex].code, to: squawk };
            sourceFile = file.Key; // <--- Store the source file key
          }
        }
        lastSquawkPerAircraft[hex] = { code: squawk };
      }
    }
    
    if (!sourceFile) {
        console.log('Could not find any transitions.');
        return;
    }

    console.log(`Step 2: The problematic transition was found in file: "${sourceFile}"`);

    console.log('Step 3: Analyzing the contents of this file for the specific aircraft record...');
    const problematicData = await downloadAndParseS3File(s3, config.buckets.readBucket, sourceFile);
    const targetAircraftRecords = problematicData.filter(rec => (rec.hex || rec.ICAO) === lastTransitionDetails.hex);
    
    console.log('---------------------------------');
    console.log('✅ INVESTIGATION COMPLETE');
    if (targetAircraftRecords.length > 0) {
      console.log(`Found ${targetAircraftRecords.length} records for aircraft ${lastTransitionDetails.hex} in the source file.`);
      console.log('The last record, which caused the "to: N/A" transition, is:');
      console.log(JSON.stringify(targetAircraftRecords[targetAircraftRecords.length - 1], null, 2));
    } else {
      console.log(`Could not find the specific aircraft record in the file, which is unexpected.`);
    }
    console.log('---------------------------------');

  } catch (err) {
    console.error('❌ An error occurred during the investigation:', err);
  }
}

investigateLastTransition();
