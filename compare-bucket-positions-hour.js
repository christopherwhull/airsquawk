const { S3Client } = require('@aws-sdk/client-s3');
const { listS3Files, downloadAndParseS3File } = require('./lib/s3-helpers');
const config = require('./config');

const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: config.s3.credentials,
  forcePathStyle: config.s3.forcePathStyle,
});

const readBucket = config.buckets.readBucket;
const writeBucket = config.buckets.writeBucket;
const prefix = 'data/piaware_aircraft_log';



function isHourlyFile(key) {
  // Matches piaware_aircraft_log_YYYYMMDD_HH00.json
  return /^data\/piaware_aircraft_log_\d{8}_\d{2}00\.json$/.test(key);
}




function isMinuteFile(key) {
  // Matches piaware_aircraft_log_YYYYMMDD_HHMM.json (not HH00.json)
  return /^data\/piaware_aircraft_log_\d{8}_\d{4}\.json$/.test(key) && !key.endsWith('00.json');
}

async function scanMinuteFiles(bucket, label) {
  const files = await listS3Files(s3, bucket, prefix);
  const minuteFiles = files.filter(f => isMinuteFile(f.Key));
  console.log(`[${label}] Found ${minuteFiles.length} minute files in bucket.`);
  if (minuteFiles.length > 0) {
    console.log(`[${label}] Minute file names:`);
    minuteFiles.forEach(f => console.log(f.Key));
  }
  return minuteFiles.length;
}






async function countPositionsLast6Hours(bucket, label) {
  const files = await listS3Files(s3, bucket, prefix);
  const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
  let count = 0;
  let fileCount = 0;
  for (const file of files) {
    const lastMod = new Date(file.LastModified).getTime();
    if (lastMod >= sixHoursAgo && isMinuteFile(file.Key)) {
      fileCount++;
      try {
        const data = await downloadAndParseS3File(s3, bucket, file.Key);
        if (Array.isArray(data)) count += data.length;
        else if (data) count++;
      } catch (err) {
        console.warn(`[${label}] Error loading ${file.Key}: ${err.message}`);
      }
    }
  }
  console.log(`[${label}] Found ${fileCount} minute files in last 6 hours.`);
  console.log(`[${label}] Total positions in last 6 hours: ${count}`);
  return count;
}




function isHourlyFile(key) {
  // Matches piaware_aircraft_log_YYYYMMDD_HH00.json
  return /^data\/piaware_aircraft_log_\d{8}_\d{2}00\.json$/.test(key);
}

async function countPositionsPerAircraftInHourlyFiles(bucket, label) {
  const files = await listS3Files(s3, bucket, prefix);
  const hourlyFiles = files.filter(f => isHourlyFile(f.Key));
  console.log(`[${label}] Found ${hourlyFiles.length} hourly files.`);
  for (const file of hourlyFiles) {
    try {
      const data = await downloadAndParseS3File(s3, bucket, file.Key);
      let aircraftList = [];
      if (Array.isArray(data)) {
        aircraftList = data;
      } else if (data && typeof data === 'object' && data.aircraft) {
        aircraftList = Array.isArray(data.aircraft) ? data.aircraft : [data.aircraft];
      }
      // Count positions per aircraft ICAO
      const positionsPerAircraft = {};
      for (const ac of aircraftList) {
        const icao = ac.ICAO || ac.icao || ac.hex || 'UNKNOWN';
        positionsPerAircraft[icao] = (positionsPerAircraft[icao] || 0) + 1;
      }
      console.log(`File: ${file.Key}`);
      Object.entries(positionsPerAircraft).forEach(([icao, count]) => {
        console.log(`  Aircraft ${icao}: ${count} positions`);
      });
    } catch (err) {
      console.warn(`[${label}] Error loading ${file.Key}: ${err.message}`);
    }
  }
}

(async () => {
  await countPositionsPerAircraftInHourlyFiles(readBucket, 'read');
})();
