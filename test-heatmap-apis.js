#!/usr/bin/env node

/**
 * Test script to verify all heatmap APIs respond within 10 seconds
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3002';
const TIMEOUT = 10000; // 10 seconds

const apis = [
    { name: 'Positions API (1h)', url: '/api/positions?hours=1', method: 'GET' },
    { name: 'Heatmap API (1h)', url: '/api/heatmap?window=1h', method: 'GET' },
    { name: 'Heatmap Stats API', url: '/api/heatmap-stats', method: 'GET' },
    { name: 'Config API', url: '/api/config', method: 'GET' },
    { name: 'Receiver Location API', url: '/api/receiver-location', method: 'GET' },
    { name: 'Airlines API', url: '/api/airlines', method: 'GET' },
    { name: 'Aircraft Batch API', url: '/api/aircraft/batch', method: 'POST', data: { icaos: ['a835af', 'a0f4b6'] } },
];

async function testApi(api) {
    const startTime = Date.now();

    try {
        const config = {
            method: api.method,
            url: BASE_URL + api.url,
            timeout: TIMEOUT,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (api.data) {
            config.data = api.data;
        }

        const response = await axios(config);
        const duration = Date.now() - startTime;

        return {
            name: api.name,
            status: 'PASS',
            statusCode: response.status,
            duration: duration,
            withinLimit: duration <= TIMEOUT
        };

    } catch (error) {
        const duration = Date.now() - startTime;

        if (error.code === 'ECONNABORTED' || duration > TIMEOUT) {
            return {
                name: api.name,
                status: 'TIMEOUT',
                statusCode: null,
                duration: duration,
                withinLimit: false,
                error: 'Request timed out'
            };
        }

        return {
            name: api.name,
            status: error.response ? 'ERROR' : 'FAIL',
            statusCode: error.response?.status || null,
            duration: duration,
            withinLimit: duration <= TIMEOUT,
            error: error.message
        };
    }
}

async function runTests() {
    console.log('🧪 Testing heatmap APIs for response time (< 10 seconds)\n');
    console.log('=' .repeat(70));

    const results = [];

    for (const api of apis) {
        console.log(`Testing: ${api.name}`);
        const result = await testApi(api);
        results.push(result);

        const statusIcon = result.status === 'PASS' ? '✅' : result.status === 'TIMEOUT' ? '⏰' : '❌';
        const timeColor = result.withinLimit ? '32' : '31'; // Green for good, red for bad

        console.log(`${statusIcon} ${result.name}`);
        console.log(`   Status: ${result.status}${result.statusCode ? ` (${result.statusCode})` : ''}`);
        console.log(`   Time: \x1b[${timeColor}m${result.duration}ms\x1b[0m`);
        if (result.error) {
            console.log(`   Error: ${result.error}`);
        }
        console.log('');
    }

    console.log('=' .repeat(70));
    console.log('📊 SUMMARY:');

    const passed = results.filter(r => r.status === 'PASS' && r.withinLimit).length;
    const failed = results.length - passed;

    console.log(`✅ Passed: ${passed}/${results.length}`);
    if (failed > 0) {
        console.log(`❌ Failed: ${failed}/${results.length}`);
        console.log('\nFailed APIs:');
        results.filter(r => !(r.status === 'PASS' && r.withinLimit)).forEach(r => {
            console.log(`   - ${r.name}: ${r.status} (${r.duration}ms)`);
        });
    }

    const allWithinLimit = results.every(r => r.withinLimit);
    console.log(`\n🎯 All APIs respond within 10 seconds: ${allWithinLimit ? '✅ YES' : '❌ NO'}`);

    process.exit(allWithinLimit ? 0 : 1);
}

runTests().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
});