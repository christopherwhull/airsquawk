const { downloadAndParseS3File } = require('./lib/s3-helpers');
const config = require('./config');
const { S3Client } = require('@aws-sdk/client-s3');
const fs = require('fs');

const s3 = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    credentials: config.s3.credentials,
    forcePathStyle: config.s3.forcePathStyle,
});

const aircraftCache = JSON.parse(fs.readFileSync('opensky_aircraft_cache.json'));

(async () => {
  const records = await downloadAndParseS3File(s3, config.buckets.readBucket, 'data/piaware_aircraft_log_20251121_2337.json');
  console.log('ICAOs in S3 file:');
  records.forEach(rec => {
    const inCache = aircraftCache.aircraft[rec.ICAO];
    const status = inCache ? 'YES' : 'NO';
    const typecode = inCache ? inCache.typecode : 'N/A';
    console.log(status + ' ' + rec.ICAO + ' => ' + typecode);
  });
})();
