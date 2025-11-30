// Test script to debug squawk transitions
const { S3Client } = require('@aws-sdk/client-s3');
const { computeSquawkTransitionsDataByTimeRange } = require('./lib/aggregators');

const s3 = new S3Client({
    endpoint: 'http://localhost:9000',
    credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin123' },
    region: 'us-east-1',
    forcePathStyle: true
});

const now = Date.now();
const startTime = now - (24 * 60 * 60 * 1000);

console.log('Testing squawk transitions...');
console.log('Start:', new Date(startTime).toISOString());
console.log('End:', new Date(now).toISOString());

computeSquawkTransitionsDataByTimeRange(s3, 'aircraft-data-new', startTime, now, 'both')
    .then(result => {
        console.log('\nResults:');
        console.log('Total transitions:', result.totalTransitions);
        if (result.transitions && result.transitions.length > 0) {
            console.log('\nSample transitions:');
            result.transitions.slice(0, 5).forEach(t => {
                const date = new Date(t.timestamp).toLocaleString();
                console.log(`${date} | ${t.registration} (${t.flight}): ${t.from} -> ${t.to} @ ${t.altitude} ft (${t.minutesSinceLast} min)`);
            });
        }
    })
    .catch(err => {
        console.error('Error:', err);
    });
