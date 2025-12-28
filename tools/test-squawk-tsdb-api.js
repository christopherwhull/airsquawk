// Test script to verify the TSDB squawk API (/api/squawk-transitions-tsdb)
const axios = require('axios');

const baseUrl = 'http://localhost:3002';

async function getServerUptime() {
    try {
        const response = await axios.get(`${baseUrl}/api/server-status`);
        const uptimeMs = response.data.serverUptimeMs;
        const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
        const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
        return `${uptimeHours}h ${uptimeMinutes}m`;
    } catch (error) {
        return 'Unknown';
    }
}

async function testSquawkTSDBAPI() {
    console.log('Testing /api/squawk-transitions-tsdb (TSDB Squawk API)...\n');

    const uptime = await getServerUptime();
    console.log(`Server Uptime: ${uptime}\n`);

    // Test different time windows
    const testWindows = [
        { param: 'hours=6', desc: '6 hours' },
        { param: 'hours=6&limit=50', desc: '6 hours (limit 50)' }
    ];

    for (const test of testWindows) {
        try {
            console.log(`Testing ${test.desc} window...`);
            const response = await axios.get(`${baseUrl}/api/squawk-transitions-tsdb?${test.param}`);
            const data = response.data;

            console.log(`  ✓ Response received`);
            console.log(`    Source: ${data.source || 'unknown'}`);
            console.log(`    Total transitions: ${data.totalTransitions || 0}`);
            console.log(`    Transitions array length: ${data.transitions ? data.transitions.length : 0}`);

            if (data.error) {
                console.log(`    ⚠️  Error in response: ${data.error}`);
            }

            if (data.transitions && data.transitions.length > 0) {
                console.log(`    Sample transition:`, JSON.stringify(data.transitions[0], null, 2).substring(0, 200) + '...');
            }
            console.log('');

        } catch (error) {
            console.log(`  ✗ Error testing ${test.desc}:`, error.message);
            console.log('');
        }
    }

    // Test time range query
    try {
        console.log('Testing time range query...');
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);

        const response = await axios.get(`${baseUrl}/api/squawk-transitions-tsdb?startTime=${oneHourAgo}&endTime=${now}`);
        const data = response.data;

        console.log(`  ✓ Time range response received`);
        console.log(`    Source: ${data.source || 'unknown'}`);
        console.log(`    Total transitions: ${data.totalTransitions || 0}`);
        console.log(`    Time range: ${data.timeRange ? JSON.stringify(data.timeRange) : 'none'}`);

        if (data.error) {
            console.log(`    ⚠️  Error in response: ${data.error}`);
        }

    } catch (error) {
        console.log(`  ✗ Error testing time range:`, error.message);
    }
}

// Run the test
testSquawkTSDBAPI().catch(console.error);