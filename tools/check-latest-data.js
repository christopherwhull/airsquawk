const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  endpoint: 'http://localhost:9000',
  credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin123' },
  region: 'us-east-1',
  forcePathStyle: true
});

(async () => {
  const list = await s3.send(new ListObjectsV2Command({
    Bucket: 'aircraft-data-new',
    Prefix: 'piaware_aircraft_log_',
    MaxKeys: 10
  }));
  
  const sorted = (list.Contents || []).sort((a,b) => b.LastModified - a.LastModified);
  if (!sorted[0]) {
    console.log('No files found');
    return;
  }
  
  console.log('Latest file:', sorted[0].Key, 'Modified:', sorted[0].LastModified);
  
  const obj = await s3.send(new GetObjectCommand({
    Bucket: 'aircraft-data-new',
    Key: sorted[0].Key
  }));
  
  const str = await obj.Body.transformToString();
  const data = JSON.parse(str);
  
  const withCallsigns = data.aircraft.filter(a => a.flight && a.flight.trim());
  console.log('Aircraft with callsigns:', withCallsigns.length);
  
  const swa = withCallsigns.filter(a => a.flight.startsWith('SWA'));
  console.log('Southwest flights:', swa.length);
  
  if (swa.length > 0) {
    console.log('\nSample SWA flight:');
    console.log(JSON.stringify(swa[0], null, 2));
  }
  
  // Check how current this data is
  const now = Date.now();
  console.log('\nCurrent time:', new Date(now).toISOString());
  if (data.aircraft[0] && data.aircraft[0].lastSeen) {
    const age = (now - data.aircraft[0].lastSeen) / 1000 / 60;
    console.log('Data age:', age.toFixed(1), 'minutes');
  }
})().catch(console.error);
