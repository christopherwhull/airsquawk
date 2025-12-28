const http = require('http');
const https = require('https');
const config = require('./config.json');

async function queryPositionsCount() {
    const tsdbConfig = config.tsdb;

    if (!tsdbConfig || !tsdbConfig.url || !tsdbConfig.token) {
        console.error('TSDB configuration not found');
        return;
    }

    // Query for count of positions in the last hour
    const query = `
    SELECT COUNT(*) as total_positions
    FROM ${tsdbConfig.tsdb_measurement || 'aircraft_positions_v2'}
    WHERE time >= NOW() - INTERVAL '1 hours'
    `;

    const payload = {
        db: tsdbConfig.db,
        format: 'json',
        q: query.trim()
    };

    console.log('Querying TSDB for positions count in last hour...');

    return new Promise((resolve, reject) => {
        const url = new URL(tsdbConfig.url);
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: '/api/v3/query_sql',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tsdbConfig.token}`,
                'Content-Length': Buffer.byteLength(JSON.stringify(payload))
            }
        };

        const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    if (res.statusCode === 200) {
                        const result = JSON.parse(data);
                        console.log('Raw TSDB response:', JSON.stringify(result, null, 2));

                        // Extract count from InfluxDB3 response (direct array format)
                        if (Array.isArray(result) && result.length > 0 && result[0].total_positions !== undefined) {
                            const count = result[0].total_positions;
                            console.log(`✅ Total positions in TSDB for last hour: ${count}`);
                        } else {
                            console.log('❌ No position data found in TSDB for the last hour');
                        }
                    } else {
                        console.error(`❌ TSDB query failed: ${res.statusCode} - ${data}`);
                    }
                    resolve();
                } catch (error) {
                    console.error('❌ Error parsing TSDB response:', error.message);
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ Request error:', error.message);
            reject(error);
        });

        req.write(JSON.stringify(payload));
        req.end();
    });
}

async function queryUniqueAircraftCount() {
    const tsdbConfig = config.tsdb;

    if (!tsdbConfig || !tsdbConfig.url || !tsdbConfig.token) {
        console.error('TSDB configuration not found');
        return;
    }

    // Query for count of unique ICAO codes in the last hour
    const query = `
    SELECT COUNT(DISTINCT icao) as unique_aircraft
    FROM ${tsdbConfig.tsdb_measurement || 'aircraft_positions_v2'}
    WHERE time >= NOW() - INTERVAL '1 hours'
    AND icao IS NOT NULL
    `;

    const payload = {
        db: tsdbConfig.db,
        format: 'json',
        q: query.trim()
    };

    console.log('\nQuerying TSDB for unique aircraft count in last 24 hours...');

    return new Promise((resolve, reject) => {
        const url = new URL(tsdbConfig.url);
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: '/api/v3/query_sql',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tsdbConfig.token}`,
                'Content-Length': Buffer.byteLength(JSON.stringify(payload))
            }
        };

        const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    if (res.statusCode === 200) {
                        const result = JSON.parse(data);
                        console.log('Raw TSDB response:', JSON.stringify(result, null, 2));

                        // Extract count from InfluxDB3 response (direct array format)
                        if (Array.isArray(result) && result.length > 0 && result[0].unique_aircraft !== undefined) {
                            const count = result[0].unique_aircraft;
                            console.log(`✅ Unique aircraft in TSDB for last hour: ${count}`);
                        } else {
                            console.log('❌ No aircraft data found in TSDB for the last hour');
                        }
                    } else {
                        console.error(`❌ TSDB query failed: ${res.statusCode} - ${data}`);
                    }
                    resolve();
                } catch (error) {
                    console.error('❌ Error parsing TSDB response:', error.message);
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ Request error:', error.message);
            reject(error);
        });

        req.write(JSON.stringify(payload));
        req.end();
    });
}

async function queryLatestTimestamp() {
    const tsdbConfig = config.tsdb;

    if (!tsdbConfig || !tsdbConfig.url || !tsdbConfig.token) {
        console.error('TSDB configuration not found');
        return;
    }

    // Query for the most recent timestamp
    const query = `
    SELECT time, icao
    FROM ${tsdbConfig.tsdb_measurement || 'aircraft_positions_v2'}
    ORDER BY time DESC
    LIMIT 1
    `;

    const payload = {
        db: tsdbConfig.db,
        format: 'json',
        q: query.trim()
    };

    console.log('\nQuerying TSDB for most recent timestamp...');

    return new Promise((resolve, reject) => {
        const url = new URL(tsdbConfig.url);
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: '/api/v3/query_sql',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tsdbConfig.token}`,
                'Content-Length': Buffer.byteLength(JSON.stringify(payload))
            }
        };

        const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    if (res.statusCode === 200) {
                        const result = JSON.parse(data);
                        console.log('Raw TSDB response:', JSON.stringify(result, null, 2));

                        // Extract timestamp from InfluxDB3 response
                        if (Array.isArray(result) && result.length > 0 && result[0].time) {
                            const timestamp = result[0].time;
                            const date = new Date(timestamp);
                            console.log(`✅ Most recent position timestamp in TSDB: ${timestamp} (${date.toLocaleString()})`);
                        } else {
                            console.log('❌ No timestamp data found in TSDB');
                        }
                    } else {
                        console.error(`❌ TSDB query failed: ${res.statusCode} - ${data}`);
                    }
                    resolve();
                } catch (error) {
                    console.error('❌ Error parsing TSDB response:', error.message);
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ Request error:', error.message);
            reject(error);
        });

        req.write(JSON.stringify(payload));
        req.end();
    });
}

async function main() {
    try {
        await queryPositionsCount();
        await queryUniqueAircraftCount();
        await queryLatestTimestamp();
    } catch (error) {
        console.error('Script failed:', error);
    }
}

main();