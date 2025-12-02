const fs = require('fs').promises;
const axios = require('axios');

/**
 * Test heatmap filtering for each manufacturer
 * Tests 24-hour window for all manufacturers found in the data
 */
async function testHeatmapManufacturers() {
    const baseUrl = 'http://localhost:3002';
    const window = '24h'; // Test 24-hour window
    
    try {
        console.log('╔════════════════════════════════════════════════════════╗');
        console.log('║  Heatmap Manufacturer Filtering Test (24-hour window)  ║');
        console.log('╚════════════════════════════════════════════════════════╝\n');
        
        // Load aircraft types to get list of manufacturers
        const typesData = await fs.readFile('aircraft_types.json', 'utf8');
        const types = JSON.parse(typesData);
        
        // Extract unique manufacturers
        const manufacturers = new Set();
        Object.values(types.types).forEach(type => {
            if (type.manufacturer) {
                manufacturers.add(type.manufacturer);
            }
        });
        
        const manufacturerList = Array.from(manufacturers).sort();
        console.log(`Found ${manufacturerList.length} manufacturers\n`);
        console.log('Testing each manufacturer:\n');
        
        // Test each manufacturer
        const results = [];
        for (const manufacturer of manufacturerList) {
            try {
                const startTime = Date.now();
                const response = await axios.get(`${baseUrl}/api/heatmap`, {
                    params: {
                        manufacturer,
                        window
                    }
                });
                const duration = Date.now() - startTime;
                
                const positionCount = response.data ? response.data.length : 0;
                const status = positionCount > 0 ? '✓' : '○';
                
                results.push({
                    manufacturer,
                    positions: positionCount,
                    duration,
                    status
                });
                
                console.log(`  ${status} ${manufacturer.padEnd(25)} ${positionCount.toLocaleString().padStart(10)} positions (${duration}ms)`);
                
            } catch (error) {
                const errorMsg = error.response?.statusText || error.message || 'Unknown error';
                console.log(`  ✗ ${manufacturer.padEnd(25)} ERROR: ${errorMsg}`);
                results.push({
                    manufacturer,
                    positions: 0,
                    duration: 0,
                    status: '✗',
                    error: errorMsg
                });
            }
        }
        
        // Summary
        console.log('\n╔════════════════════════════════════════════════════════╗');
        console.log('║  Summary                                               ║');
        console.log('╚════════════════════════════════════════════════════════╝\n');
        
        const totalPositions = results.reduce((sum, r) => sum + r.positions, 0);
        const manufacturersWithData = results.filter(r => r.positions > 0).length;
        const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
        
        console.log(`Total manufacturers tested: ${manufacturerList.length}`);
        console.log(`Manufacturers with data:   ${manufacturersWithData}`);
        console.log(`Total positions found:     ${totalPositions.toLocaleString()}`);
        console.log(`Average query time:        ${avgDuration.toFixed(0)}ms\n`);
        
        // Top manufacturers by position count
        const top10 = results
            .filter(r => r.positions > 0)
            .sort((a, b) => b.positions - a.positions)
            .slice(0, 10);
        
        if (top10.length > 0) {
            console.log('Top 10 manufacturers by position count:\n');
            top10.forEach((result, index) => {
                console.log(`  ${String(index + 1).padStart(2)}. ${result.manufacturer.padEnd(25)} ${result.positions.toLocaleString().padStart(10)} positions`);
            });
        }
        
        console.log('\n');
        
    } catch (error) {
        console.error('Fatal error:', error.message);
        process.exit(1);
    }
}

// Run the test
testHeatmapManufacturers()
    .then(() => {
        console.log('Test completed successfully');
        process.exit(0);
    })
    .catch(error => {
        console.error('Test failed:', error);
        process.exit(1);
    });
