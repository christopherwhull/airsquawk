const axios = require('axios');

async function testBoeingHeatmap() {
    const baseUrl = 'http://localhost:3002';
    
    try {
        console.log('╔════════════════════════════════════════════════════════╗');
        console.log('║  Testing Boeing Heatmap Filtering                      ║');
        console.log('╚════════════════════════════════════════════════════════╝\n');
        
        // First, get stats to understand what data we have
        console.log('1. Getting heatmap statistics...\n');
        const statsResponse = await axios.get(`${baseUrl}/api/heatmap-stats`);
        const stats = statsResponse.data;
        
        console.log(`   Total Positions: ${stats.totalPositions.toLocaleString()}`);
        console.log(`   Positions with Aircraft Type: ${stats.positionsWithType.toLocaleString()}`);
        console.log(`   Positions without Aircraft Type: ${stats.positionsWithoutType.toLocaleString()}`);
        console.log(`   Positions with Manufacturer: ${stats.positionsWithManufacturer.toLocaleString()}`);
        
        console.log('\n   Top 10 Manufacturers:');
        Object.entries(stats.topManufacturers).forEach(([mfr, count], idx) => {
            console.log(`     ${String(idx + 1).padStart(2)}. ${mfr.padEnd(25)} ${count.toLocaleString().padStart(10)} positions`);
        });
        
        console.log('\n   Top 10 Aircraft Types:');
        Object.entries(stats.topTypes).forEach(([type, count], idx) => {
            console.log(`     ${String(idx + 1).padStart(2)}. ${type.padEnd(10)} ${count.toLocaleString().padStart(10)} positions`);
        });
        
        // Test Boeing filtering with different time windows
        console.log('\n\n2. Testing Boeing manufacturer filter with different time windows:\n');
        
        const windows = ['1h', '6h', '24h', '7d', 'all'];
        
        for (const window of windows) {
            try {
                const startTime = Date.now();
                const response = await axios.get(`${baseUrl}/api/heatmap`, {
                    params: {
                        manufacturer: 'Boeing',
                        window
                    }
                });
                const duration = Date.now() - startTime;
                const positionCount = response.data ? response.data.length : 0;
                
                const status = positionCount > 0 ? '✓' : '○';
                console.log(`   ${status} Window ${window.padEnd(5)}: ${positionCount.toLocaleString().padStart(10)} positions (${duration}ms)`);
            } catch (error) {
                console.log(`   ✗ Window ${window.padEnd(5)}: ERROR - ${error.message}`);
            }
        }
        
        console.log('\n');
        
    } catch (error) {
        console.error('Fatal error:', error.message);
        process.exit(1);
    }
}

testBoeingHeatmap()
    .then(() => {
        console.log('Test completed');
        process.exit(0);
    })
    .catch(error => {
        console.error('Test failed:', error);
        process.exit(1);
    });
