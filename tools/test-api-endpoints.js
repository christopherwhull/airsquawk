/**
 * API Endpoint Tests
 * Run with: node test-api-endpoints.js
 */

const http = require('http');

const BASE_URL = 'http://localhost:3002';
let testsPassed = 0;
let testsFailed = 0;

function request(path) {
    return new Promise((resolve, reject) => {
        http.get(`${BASE_URL}${path}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        }).on('error', reject);
    });
}

async function test(name, fn) {
    try {
        await fn();
        console.log(`✅ ${name}`);
        testsPassed++;
    } catch (error) {
        console.error(`❌ ${name}`);
        console.error(`   Error: ${error.message}`);
        testsFailed++;
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

async function runTests() {
    console.log('='.repeat(80));
    console.log('API ENDPOINT TESTS');
    console.log('='.repeat(80));
    console.log('');

    // Test 1: Health endpoint
    await test('Health endpoint returns OK', async () => {
        const res = await request('/api/health');
        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        assert(res.data.status === 'ok', 'Expected status ok');
    });

    // Test 2: Cache status endpoint
    await test('Cache status endpoint returns data', async () => {
        const res = await request('/api/cache-status');
        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        assert(res.data.positionCache !== undefined, 'Expected positionCache in response');
        assert(res.data.s3Operations !== undefined, 'Expected s3Operations in response');
        assert(res.data.lastProcessing !== undefined, 'Expected lastProcessing in response');
    });

    // Test 2b: Cache status includes type database stats
    await test('Cache status includes type database stats', async () => {
        const res = await request('/api/cache-status');
        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        assert(res.data.typeDatabase !== undefined, 'Expected typeDatabase in response');
        const td = res.data.typeDatabase;
        assert(td.loaded !== undefined, 'Expected typeDatabase.loaded');
        assert(td.typeCount !== undefined, 'Expected typeDatabase.typeCount');
    });

    // Test 3: Reception range endpoint
    await test('Reception range endpoint returns data', async () => {
        const res = await request('/api/reception-range?hours=24');
        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        assert(res.data.sectors !== undefined, 'Expected sectors in response');
    });

    // Test 4: Heatmap data endpoint
    await test('Heatmap data endpoint returns data', async () => {
        const res = await request('/api/heatmap-data?hours=24');
        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        assert(res.data.grid !== undefined, 'Expected grid in response');
    });

    // Test 5: Airline stats endpoint
    await test('Airline stats endpoint returns data', async () => {
        const res = await request('/api/airline-stats?window=24h');
        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        assert(res.data.hourly !== undefined, 'Expected hourly data in response');
    });

    // Test 6: Squawk transitions with time range
    await test('Squawk transitions endpoint (24h) returns data', async () => {
        const now = Date.now();
        const start = now - (24 * 60 * 60 * 1000);
        const res = await request(`/api/squawk-transitions?startTime=${start}&endTime=${now}`);
        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        assert(res.data.transitions !== undefined, 'Expected transitions in response');
        assert(res.data.totalTransitions !== undefined, 'Expected totalTransitions in response');
        assert(Array.isArray(res.data.transitions), 'Expected transitions to be an array');
        console.log(`   Found ${res.data.totalTransitions} transitions in last 24 hours`);
        
        // Verify transition structure if any exist
        if (res.data.transitions.length > 0) {
            const transition = res.data.transitions[0];
            assert(transition.from !== undefined, 'Expected from squawk code');
            assert(transition.to !== undefined, 'Expected to squawk code');
            assert(transition.timestamp !== undefined, 'Expected timestamp');
            assert(transition.registration !== undefined, 'Expected registration');
            assert(transition.flight !== undefined, 'Expected flight field');
            assert(transition.type !== undefined, 'Expected type field');
            assert(transition.airlineCode !== undefined, 'Expected airlineCode field');
            assert(transition.airlineName !== undefined, 'Expected airlineName field');
            assert(transition.altitude !== undefined, 'Expected altitude');
            assert(transition.minutesSinceLast !== undefined, 'Expected minutesSinceLast');
            console.log(`   Sample: ${transition.registration} (${transition.flight || 'N/A'}) [${transition.type || 'N/A'}]: ${transition.from} → ${transition.to} @ ${transition.altitude || 'N/A'} ft`);
            if (transition.airlineName) {
                console.log(`   Airline: ${transition.airlineCode} - ${transition.airlineName}`);
            }
        }
    });
    
    // Test 6b: Squawk transitions filtering (flight changes excluded)
    await test('Squawk transitions correctly filters flight changes', async () => {
        const now = Date.now();
        const start = now - (7 * 24 * 60 * 60 * 1000); // 7 days
        const res = await request(`/api/squawk-transitions?startTime=${start}&endTime=${now}`);
        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        
        // Check that all transitions have minutesSinceLast < 15 (our filtering threshold)
        if (res.data.transitions.length > 0) {
            const invalidTransitions = res.data.transitions.filter(t => t.minutesSinceLast >= 15);
            assert(invalidTransitions.length === 0, `Found ${invalidTransitions.length} transitions with 15+ minute gaps`);
            console.log(`   ✓ All ${res.data.totalTransitions} transitions have < 15 min gaps`);
        }
    });

    // Test 7: Position timeseries live endpoint
    await test('Position timeseries live endpoint returns data', async () => {
        const res = await request('/api/position-timeseries-live?minutes=10&resolution=1');
        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        assert(Array.isArray(res.data), 'Expected array response');
    });

    // Test 8: Historical stats endpoint
    await test('Historical stats endpoint returns data', async () => {
        const res = await request('/api/historical-stats?hours=24&resolution=60');
        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        assert(res.data.timeSeries !== undefined, 'Expected timeSeries in response');
        assert(res.data.totals !== undefined, 'Expected totals in response');
    });
    
    // Test 9: Flights endpoint with gap parameter
    await test('Flights endpoint returns data with gap parameter', async () => {
        const res = await request('/api/flights?gap=5&window=24h');
        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        assert(res.data.flights !== undefined || res.data.active !== undefined, 'Expected flights or active in response');
        
        const totalFlights = (res.data.flights || []).length + (res.data.active || []).length;
        console.log(`   Found ${totalFlights} flights (${(res.data.active || []).length} active, ${(res.data.flights || []).length} completed)`);
        
        // Verify flight structure if any exist
        if (res.data.flights && res.data.flights.length > 0) {
            const flight = res.data.flights[0];
            assert(flight.icao !== undefined, 'Expected icao field');
            assert(flight.callsign !== undefined, 'Expected callsign field');
            assert(flight.start_time !== undefined, 'Expected start_time field');
        }
    });

    // Test 9b: Flights endpoint returns unique flights (no duplicates between active/completed)
    await test('Flights endpoint returns unique flights (no duplicate entries)', async () => {
        const res = await request('/api/flights?gap=5&window=24h');
        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        const all = [...(res.data.active || []), ...(res.data.flights || [])];
        const keys = new Set();
        for (const f of all) {
            const key = `${(f.icao||f.hex||'').toLowerCase()}|${(f.callsign||'').toUpperCase()}|${f.start_time||''}|${f.end_time||''}|${(f.registration||'').toUpperCase()}`;
            assert(!keys.has(key), `Duplicate flight found: ${key}`);
            keys.add(key);
        }
    });
    
    // Test 10: Reception range with different time windows
    await test('Reception range works with various time windows', async () => {
        for (const hours of [1, 24, 168]) {
            const res = await request(`/api/reception-range?hours=${hours}`);
            assert(res.status === 200, `Expected status 200 for ${hours}h, got ${res.status}`);
            assert(res.data.sectors !== undefined, 'Expected sectors in response');
            assert(res.data.maxRange !== undefined, 'Expected maxRange in response');
            assert(res.data.positionCount !== undefined, 'Expected positionCount in response');
            assert(typeof res.data.receiverLat === 'number', 'Expected receiverLat to be a number');
            assert(typeof res.data.receiverLon === 'number', 'Expected receiverLon to be a number');
        }
        console.log('   ✓ Tested 1h, 24h, and 168h time windows');
    });
    
    // Test 11: Cache status includes all processing timestamps
    await test('Cache status includes all processing timestamps', async () => {
        const res = await request('/api/cache-status');
        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        
        const lastProcessing = res.data.lastProcessing || {};
        const expectedFields = ['flights', 'airlines', 'squawks', 'heatmap', 'positions', 'hourlyRollup'];
        
        for (const field of expectedFields) {
            assert(lastProcessing[field] !== undefined, `Expected lastProcessing.${field} to exist`);
        }
        
        console.log(`   ✓ All ${expectedFields.length} processing timestamps present`);
    });

    // Test 12: Airline stats include top type and manufacturer
    await test('Airline stats include top type and manufacturer', async () => {
        const res = await request('/api/airline-stats?window=24h');
        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        assert(res.data.hourly && res.data.hourly.byAirline, 'Expected hourly.byAirline in response');
        const airlines = res.data.hourly.byAirline;
        const airlinesKeys = Object.keys(airlines || {});
        if (airlinesKeys.length > 0) {
            const first = airlines[airlinesKeys[0]];
            assert(first.topType !== undefined, 'Expected topType in airline stats');
            assert(first.topManufacturer !== undefined, 'Expected topManufacturer in airline stats');
        }
    });

    // Test 13: Flights include manufacturer and bodyType
    await test('Flights include manufacturer and bodyType', async () => {
        const res = await request('/api/flights?gap=5&window=24h');
        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        const flight = (res.data.flights || res.data.active || [])[0];
        if (flight) {
            assert(flight.manufacturer !== undefined, 'Expected manufacturer in flight');
            assert(flight.bodyType !== undefined, 'Expected bodyType in flight');
        }
    });

    // Test 14: Squawk transitions include manufacturer
    await test('Squawk transitions include manufacturer', async () => {
        const now = Date.now();
        const start = now - (24 * 60 * 60 * 1000);
        const res = await request(`/api/squawk-transitions?startTime=${start}&endTime=${now}`);
        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        if (res.data.transitions && res.data.transitions.length > 0) {
            assert(res.data.transitions[0].manufacturer !== undefined, 'Expected manufacturer in transition');
        }
    });
    
    // Test 12: Heatmap returns grid with proper structure
    await test('Heatmap grid has proper structure', async () => {
        const res = await request('/api/heatmap-data?hours=24');
        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        assert(res.data.grid !== undefined, 'Expected grid in response');
        
        if (Object.keys(res.data.grid).length > 0) {
            const firstKey = Object.keys(res.data.grid)[0];
            const cell = res.data.grid[firstKey];
            assert(cell.count !== undefined, 'Expected count in grid cell');
            assert(cell.lat_min !== undefined, 'Expected lat_min in grid cell');
            assert(cell.lat_max !== undefined, 'Expected lat_max in grid cell');
            assert(cell.lon_min !== undefined, 'Expected lon_min in grid cell');
            assert(cell.lon_max !== undefined, 'Expected lon_max in grid cell');
            console.log(`   ✓ Grid has ${Object.keys(res.data.grid).length} cells with proper structure`);
        } else {
            console.log('   ⚠ No grid data available for this time period');
        }
    });

    console.log('');
    console.log('='.repeat(80));
    console.log(`RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('='.repeat(80));

    process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests
console.log('Starting API endpoint tests...');
console.log('Make sure the server is running on port 3002');
console.log('');

setTimeout(() => {
    runTests().catch(err => {
        console.error('Test runner error:', err);
        process.exit(1);
    });
}, 1000);
