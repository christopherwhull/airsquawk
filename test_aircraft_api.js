#!/usr/bin/env node
/**
 * Quick test of aircraft database API endpoints
 * Run this after starting the server
 */

const http = require('http');

const BASE_URL = 'http://localhost:8080';

function makeRequest(path, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: {}
        };

        if (data) {
            const body = JSON.stringify(data);
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(body);
        }

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });

        req.on('error', reject);

        if (data) {
            req.write(JSON.stringify(data));
        }

        req.end();
    });
}

async function runTests() {
    console.log('='.repeat(70));
    console.log('Aircraft Database API Test');
    console.log('='.repeat(70));
    console.log();

    try {
        // Test 1: Database Status
        console.log('1. Testing database status endpoint...');
        const status = await makeRequest('/api/aircraft-database/status');
        console.log(`   Status: ${status.status}`);
        console.log(`   Data:`, JSON.stringify(status.data, null, 2));
        console.log();

        // Test 2: Single Aircraft Lookup
        console.log('2. Testing single aircraft lookup (ac96b8)...');
        const aircraft1 = await makeRequest('/api/aircraft/ac96b8');
        console.log(`   Status: ${aircraft1.status}`);
        console.log(`   Data:`, JSON.stringify(aircraft1.data, null, 2));
        console.log();

        // Test 3: Another Aircraft Lookup
        console.log('3. Testing another aircraft (4ca7b5)...');
        const aircraft2 = await makeRequest('/api/aircraft/4ca7b5');
        console.log(`   Status: ${aircraft2.status}`);
        console.log(`   Data:`, JSON.stringify(aircraft2.data, null, 2));
        console.log();

        // Test 4: Not Found
        console.log('4. Testing not found case (invalid)...');
        const notFound = await makeRequest('/api/aircraft/invalid');
        console.log(`   Status: ${notFound.status}`);
        console.log(`   Data:`, JSON.stringify(notFound.data, null, 2));
        console.log();

        // Test 5: Batch Lookup
        console.log('5. Testing batch lookup...');
        const batch = await makeRequest('/api/aircraft/batch', 'POST', {
            icao24: ['ac96b8', '4ca7b5', 'a00001', 'invalid']
        });
        console.log(`   Status: ${batch.status}`);
        console.log(`   Data:`, JSON.stringify(batch.data, null, 2));
        console.log();

        console.log('='.repeat(70));
        console.log('✓ All tests completed successfully');
        console.log('='.repeat(70));

    } catch (error) {
        console.error('❌ Error running tests:', error.message);
        console.error('Make sure the server is running on port 8080');
        process.exit(1);
    }
}

runTests();
