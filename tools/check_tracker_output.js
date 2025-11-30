
const { listS3Files, downloadAndParseS3File } = require('./lib/s3-helpers');
const AWS = require('@aws-sdk/client-s3');
const config = require('./config');

const s3 = new AWS.S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: config.s3.credentials,
  forcePathStyle: config.s3.forcePathStyle
});

async function checkLatestOutputFile() {
  try {
    console.log(`--- Checking latest output file in bucket: "${config.buckets.writeBucket}" ---`);
    
    console.log('Step 1: Listing files in the write bucket...');
    const files = await listS3Files(s3, config.buckets.writeBucket);
    if (!files || files.length === 0) {
      console.log('No files found in the output bucket.');
      return;
    }

    // Sort files by last modified to find the most recent one
    files.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
    const latestFile = files[0];
    console.log(`Step 2: The most recent output file is "${latestFile.Key}" (Modified: ${latestFile.LastModified})`);

    console.log('Step 3: Downloading and analyzing its content...');
    const data = await downloadAndParseS3File(s3, config.buckets.writeBucket, latestFile.Key);
    
    if (!Array.isArray(data) || data.length === 0) {
        console.log('The latest file is empty or not in the expected format.');
        return;
    }

    console.log('---------------------------------');
    console.log('✅ ANALYSIS COMPLETE');
    console.log(`The file contains ${data.length} aircraft records.`);
    console.log('Here is a sample of the first record in the file:');
    console.log(JSON.stringify(data[0], null, 2));
    console.log('---------------------------------');

    // Verification
    const sample = data[0];
    const hasIdent = sample.hasOwnProperty('Ident') && sample.Ident !== 'N/A';
    const hasSquawk = sample.hasOwnProperty('Squawk') && sample.Squawk !== 'N/A';
    const hasType = sample.hasOwnProperty('Aircraft_type') && sample.Aircraft_type !== 'N/A';

    console.log('Verification Results:');
    console.log(`  - Has 'Ident' field: ${hasIdent}`);
    console.log(`  - Has 'Squawk' field: ${hasSquawk}`);
    console.log(`  - Has 'Aircraft_type' field: ${hasType}`);
    console.log('---------------------------------');


  } catch (err) {
    console.error('❌ An error occurred during the analysis:', err);
  }
}

checkLatestOutputFile();
