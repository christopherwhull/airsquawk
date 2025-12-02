const { downloadAndParseS3File } = require('./lib/s3-helpers');
const config = require('./config');
const { S3Client } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    credentials: config.s3.credentials,
    forcePathStyle: config.s3.forcePathStyle,
});

(async () => {
  const records = await downloadAndParseS3File(s3, config.buckets.readBucket, 'data/piaware_aircraft_log_20251121_2337.json');
  console.log('Sample record structure:');
  if (records.length > 0) {
    console.log(JSON.stringify(records[0], null, 2));
  }
})();
