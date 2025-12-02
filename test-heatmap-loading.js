#!/usr/bin/env node
/**
 * Heatmap Data Loading Test Script - Streaming Mode
 * Pulls data from the heatmap API in chunks of 1000 lines
 * Reports loading statistics and data points in real-time
 */

const http = require('http');

// Configuration
const API_HOST = 'localhost';
const API_PORT = 3002;
const API_PATH = '/api/heatmap';
const CHUNK_SIZE = 1000; // Process 1000 grid cells at a time

// Helper function to make HTTP requests with streaming
function makeStreamingRequest(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: API_HOST,
            port: API_PORT,
            path: path,
            method: 'GET',
            timeout: 60000
        };

        const req = http.request(options, (res) => {
            let data = '';
            let totalData = '';
            let chunkCount = 0;
            let cellCount = 0;
            let totalPositions = 0;

            // Process chunks as they arrive
            res.on('data', (chunk) => {
                data += chunk.toString();
                totalData += chunk.toString();

                // Try to parse complete JSON objects
                while (data.includes('\n') || data.includes('}')) {
                    try {
                        // Try to extract complete grid cell objects
                        if (data.startsWith('[')) {
                            data = data.slice(1);
                        } else if (data.startsWith(',')) {
                            data = data.slice(1);
                        }

                        if (!data.trim()) break;

                        // Find the end of a grid cell object
                        const endIdx = data.indexOf('}');
                        if (endIdx === -1) break;

                        const cellStr = data.substring(0, endIdx + 1);
                        const cell = JSON.parse(cellStr);

                        cellCount++;
                        totalPositions += cell.count || 0;

                        // Report progress every 1000 cells
                        if (cellCount % CHUNK_SIZE === 0) {
                            chunkCount++;
                            process.stdout.write(`  📦 Chunk ${chunkCount}: ${cellCount} cells, ${totalPositions.toLocaleString()} positions\n`);
                        }

                        data = data.substring(endIdx + 1);
                    } catch (e) {
                        break;
                    }
                }
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const allData = JSON.parse(totalData);
                        resolve({
                            data: allData,
                            cellCount: allData.length,
                            totalPositions: allData.reduce((sum, cell) => sum + (cell.count || 0), 0)
                        });
                    } catch (e) {
                        reject(new Error('Failed to parse response: ' + e.message));
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.end();
    });
}

// Main test function
async function testHeatmapLoading() {
    console.log('🔍 Heatmap Data Loading Test - Streaming Mode (1000 lines/chunk)');
    console.log('=' .repeat(70));
    console.log(`Testing API: http://${API_HOST}:${API_PORT}${API_PATH}`);
    console.log(`Chunk size: ${CHUNK_SIZE} grid cells per report\n`);

    const tests = [
        { window: '1h', label: '1 Hour' },
        { window: '4h', label: '4 Hours' },
        { window: '12h', label: '12 Hours' },
        { window: '24h', label: '24 Hours' },
        { window: '7d', label: '7 Days' },
        { window: 'all', label: 'All Time' }
    ];

    const results = [];

    for (const test of tests) {
        try {
            const startTime = Date.now();
            console.log(`📊 Loading ${test.label}...`);

            const path = `${API_PATH}?window=${test.window}`;
            const result = await makeStreamingRequest(path);

            const loadTime = Date.now() - startTime;
            const data = result.data;

            // Calculate statistics
            const totalPositions = data.reduce((sum, cell) => sum + (cell.count || 0), 0);
            const gridCells = data.length;
            let minLat = Infinity, maxLat = -Infinity;
            let minLon = Infinity, maxLon = -Infinity;

            data.forEach(cell => {
                if (cell.count) {
                    minLat = Math.min(minLat, cell.lat_min);
                    maxLat = Math.max(maxLat, cell.lat_max);
                    minLon = Math.min(minLon, cell.lon_min);
                    maxLon = Math.max(maxLon, cell.lon_max);
                }
            });

            // Find min/max counts
            const counts = data.map(c => c.count || 0).filter(c => c > 0);
            const minCount = counts.length > 0 ? Math.min(...counts) : 0;
            const maxCount = counts.length > 0 ? Math.max(...counts) : 0;
            const avgCount = counts.length > 0 ? (counts.reduce((a, b) => a + b) / counts.length).toFixed(2) : 0;

            // Calculate density
            const dataRate = (totalPositions / (loadTime / 1000)).toFixed(0);

            results.push({
                window: test.window,
                label: test.label,
                loadTime,
                totalPositions,
                gridCells,
                occupiedCells: counts.length,
                minCount,
                maxCount,
                avgCount,
                bounds: { minLat, maxLat, minLon, maxLon },
                dataRate
            });

            console.log(`  ✓ Completed in ${loadTime}ms`);
            console.log(`  📍 Total Positions: ${totalPositions.toLocaleString()}`);
            console.log(`  🔲 Grid Cells: ${gridCells} (occupied: ${counts.length})`);
            console.log(`  📈 Position Count Range: ${minCount} - ${maxCount} (avg: ${avgCount})`);
            console.log(`  ⚡ Data Rate: ${dataRate.toLocaleString()} positions/sec`);
            console.log(`  🗺️  Coverage: Lat ${minLat.toFixed(2)}° to ${maxLat.toFixed(2)}°, Lon ${minLon.toFixed(2)}° to ${maxLon.toFixed(2)}°`);
            console.log('');

        } catch (error) {
            console.error(`  ✗ Error: ${error.message}`);
            results.push({
                window: test.window,
                label: test.label,
                error: error.message
            });
            console.log('');
        }
    }

    // Summary Report
    console.log('📋 SUMMARY REPORT');
    console.log('=' .repeat(70));

    const successfulTests = results.filter(r => !r.error);
    const failedTests = results.filter(r => r.error);

    console.log(`✓ Successful: ${successfulTests.length}/${results.length}`);
    console.log(`✗ Failed: ${failedTests.length}/${results.length}`);
    console.log('');

    if (successfulTests.length > 0) {
        console.log('📊 Data Loading Statistics:');
        console.log('');

        console.log('Window     | Load Time | Total Pos | Grid Cells | Occupied | Avg/Cell | Data Rate');
        console.log('-'.repeat(95));

        successfulTests.forEach(r => {
            const loadTimeStr = `${r.loadTime}ms`.padEnd(9);
            const totalPosStr = r.totalPositions.toLocaleString().padEnd(9);
            const gridStr = r.gridCells.toString().padEnd(10);
            const occupiedStr = r.occupiedCells.toString().padEnd(8);
            const avgStr = r.avgCount.padEnd(8);
            const rateStr = `${r.dataRate}/s`.padEnd(8);

            console.log(`${r.label.padEnd(10)} | ${loadTimeStr} | ${totalPosStr} | ${gridStr} | ${occupiedStr} | ${avgStr} | ${rateStr}`);
        });

        console.log('');
        console.log('Performance Analysis:');
        const times = successfulTests.map(r => r.loadTime);
        console.log(`  Fastest: ${Math.min(...times)}ms (${successfulTests.find(r => r.loadTime === Math.min(...times)).label})`);
        console.log(`  Slowest: ${Math.max(...times)}ms (${successfulTests.find(r => r.loadTime === Math.max(...times)).label})`);
        console.log(`  Average: ${(times.reduce((a, b) => a + b) / times.length).toFixed(0)}ms`);

        console.log('');
        console.log('Data Volume Analysis:');
        const maxPosTest = successfulTests.reduce((max, r) => r.totalPositions > max.totalPositions ? r : max);
        const minPosTest = successfulTests.reduce((min, r) => r.totalPositions < min.totalPositions ? r : min);
        console.log(`  Most Data: ${maxPosTest.label} - ${maxPosTest.totalPositions.toLocaleString()} positions`);
        console.log(`  Least Data: ${minPosTest.label} - ${minPosTest.totalPositions.toLocaleString()} positions`);
        console.log(`  Total: ${successfulTests.reduce((sum, r) => sum + r.totalPositions, 0).toLocaleString()} positions across all time windows`);

        console.log('');
        console.log('Grid Resolution Analysis:');
        successfulTests.forEach(r => {
            const coverage = r.occupiedCells / r.gridCells * 100;
            console.log(`  ${r.label}: ${r.gridCells} total cells, ${r.occupiedCells} occupied (${coverage.toFixed(1)}%)`);
        });

        console.log('');
        console.log('Coverage:');
        const allBounds = successfulTests.map(r => r.bounds);
        console.log(`  Combined Bounds:`);
        console.log(`    Latitude: ${Math.min(...allBounds.map(b => b.minLat)).toFixed(2)}° to ${Math.max(...allBounds.map(b => b.maxLat)).toFixed(2)}°`);
        console.log(`    Longitude: ${Math.min(...allBounds.map(b => b.minLon)).toFixed(2)}° to ${Math.max(...allBounds.map(b => b.maxLon)).toFixed(2)}°`);

        console.log('');
        console.log('Data Quality:');
        const avgDataRate = successfulTests.reduce((sum, r) => sum + parseInt(r.dataRate), 0) / successfulTests.length;
        console.log(`  Average Data Rate: ${avgDataRate.toFixed(0).toLocaleString()} positions/sec`);
        const avgDensity = successfulTests.reduce((sum, r) => sum + parseFloat(r.avgCount), 0) / successfulTests.length;
        console.log(`  Average Density: ${avgDensity.toFixed(1)} positions per grid cell`);
    }

    if (failedTests.length > 0) {
        console.log('❌ Failed Tests:');
        failedTests.forEach(r => {
            console.log(`  ${r.label}: ${r.error}`);
        });
    }

    console.log('');
    console.log('=' .repeat(70));
    console.log('✅ Test Complete');
    process.exit(failedTests.length > 0 ? 1 : 0);
}

// Run the test
testHeatmapLoading().catch(error => {
    console.error('Fatal Error:', error);
    process.exit(1);
});
