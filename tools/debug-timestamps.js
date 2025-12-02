// Debug script to check timestamps in position data
const axios = require('axios');

const baseUrl = 'http://localhost:3002';

async function debugTimestamps() {
    console.log('Fetching sample positions to check timestamps...\n');

    try {
        const response = await axios.get(`${baseUrl}/api/heatmap?window=1h`);
        const data = response.data;
        
        console.log(`Total cells returned: ${data.length}`);
        console.log(`Cells with data: ${data.filter(c => c.count > 0).length}`);
        
        // Sample first few cells
        console.log('\nSample cells (first 5 with data):');
        const cellsWithData = data.filter(c => c.count > 0).slice(0, 5);
        cellsWithData.forEach((cell, idx) => {
            console.log(`\nCell ${idx + 1}:`);
            console.log(`  Lat: ${cell.lat_min.toFixed(4)} to ${cell.lat_max.toFixed(4)}`);
            console.log(`  Lon: ${cell.lon_min.toFixed(4)} to ${cell.lon_max.toFixed(4)}`);
            console.log(`  Count: ${cell.count}`);
            console.log(`  Timestamp: ${cell.timestamp || 'NOT PRESENT'}`);
        });
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

debugTimestamps().catch(console.error);
