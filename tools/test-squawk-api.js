// Test script to verify the squawk API (/api/squawk-transitions)
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

async function testSquawkAPI() {
    console.log('Testing /api/squawk-transitions (Squawk API)...\n');

    const uptime = await getServerUptime();
    console.log(`Server Uptime: ${uptime}\n`);

    // Test different time windows
    const testWindows = [
        { param: 'hours=6', desc: '6 hours' }
    ];

    for (const test of testWindows) {
        try {
            console.log(`Testing ${test.desc} window...`);
            const response = await axios.get(`${baseUrl}/api/squawk-transitions?${test.param}`);
            const data = response.data;

            console.log(`  ✓ Response received`);
            console.log(`    Total transitions: ${data.totalTransitions || 0}`);
            console.log(`    Transitions array length: ${data.transitions ? data.transitions.length : 0}`);

            if (data.transitions && data.transitions.length > 0) {
                console.log(`    Sample transition:`, JSON.stringify(data.transitions[0], null, 2).substring(0, 200) + '...');
            }
            console.log('');

        } catch (error) {
            console.log(`  ✗ Error testing ${test.desc}:`, error.message);
            console.log('');
        }
    }

    // Test with time range parameters
    try {
        console.log('Testing with explicit time range...');
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);

        const response = await axios.get(`${baseUrl}/api/squawk-transitions?startTime=${oneHourAgo}&endTime=${now}`);
        const data = response.data;

        console.log(`  ✓ Time range response received`);
        console.log(`    Total transitions: ${data.totalTransitions || 0}`);
        console.log(`    Transitions array length: ${data.transitions ? data.transitions.length : 0}`);
        console.log('');

    } catch (error) {
        console.log(`  ✗ Error testing time range:`, error.message);
        console.log('');
    }
}

testSquawkAPI().catch(console.error);