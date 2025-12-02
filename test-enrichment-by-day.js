const AWS = require('@aws-sdk/client-s3');
const config = require('./config.js');

async function listAndAnalyzeFiles() {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║  S3 Data by Day Analysis                               ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    try {
        const s3 = new AWS.S3Client(config.s3);
        
        // List files from aircraft-data
        console.log('Listing files from aircraft-data bucket...\n');
        
        let dateFiles = {};
        let continuationToken = null;
        let filesProcessed = 0;

        do {
            const command = new AWS.ListObjectsV2Command({
                Bucket: 'aircraft-data',
                Prefix: 'data/piaware_aircraft_log_',
                MaxKeys: 1000,
                ContinuationToken: continuationToken
            });

            const response = await s3.send(command);
            
            if (response.Contents) {
                response.Contents.forEach(file => {
                    const match = file.Key.match(/piaware_aircraft_log_(\d{8})_(\d{4})/);
                    if (match) {
                        const date = match[1];
                        const hour = match[2];
                        if (!dateFiles[date]) {
                            dateFiles[date] = { count: 0, hours: new Set() };
                        }
                        dateFiles[date].count++;
                        dateFiles[date].hours.add(hour);
                        filesProcessed++;
                    }
                });
            }

            continuationToken = response.NextContinuationToken;
        } while (continuationToken);

        const dates = Object.keys(dateFiles).sort().reverse();

        console.log('Date           Files   Hours   Files/Hr   Hour Range');
        console.log('─'.repeat(60));

        let totalFiles = 0;
        for (const date of dates) {
            const info = dateFiles[date];
            const dateStr = `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`;
            const hours = info.hours.size;
            const avgPerHour = (info.count / hours).toFixed(1);
            const hourArray = Array.from(info.hours).sort();
            const hourRange = `${hourArray[0]}-${hourArray[hourArray.length - 1]}`;

            console.log(
                dateStr.padEnd(15) +
                info.count.toString().padStart(7) +
                hours.toString().padStart(8) +
                avgPerHour.padStart(10) +
                '  ' +
                hourRange
            );

            totalFiles += info.count;
        }

        console.log('─'.repeat(60));
        console.log(`Total: ${totalFiles} files across ${dates.length} unique days\n`);

        // Date range
        if (dates.length > 0) {
            const earliest = dates[dates.length - 1];
            const latest = dates[0];
            console.log(`Coverage: ${earliest.substring(0,4)}-${earliest.substring(4,6)}-${earliest.substring(6,8)} to ${latest.substring(0,4)}-${latest.substring(4,6)}-${latest.substring(6,8)}`);
            console.log(`Days: ${dates.length}`);
        }

        console.log('\nNote: Each file contains one minute of ADS-B data\n');

    } catch (error) {
        console.error('Error:', error.message);
    }
}

listAndAnalyzeFiles();
