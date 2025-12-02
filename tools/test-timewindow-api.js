// Test script to verify API returns different data for different time windows
const axios = require('axios');

const baseUrl = 'http://localhost:3002';

async function testTimeWindows() {
    console.log('Testing /api/heatmap endpoint with different time windows...\n');

    const windows = ['1h', '4h', '12h', '24h', '7d', 'all'];
    
    for (const window of windows) {
        try {
            const response = await axios.get(`${baseUrl}/api/heatmap?window=${window}`);
            const data = response.data;
            
            // Calculate total positions
            let totalPositions = 0;
            let cellsWithData = 0;
            let maxCount = 0;
            
            data.forEach(cell => {
                if (cell.count > 0) {
                    totalPositions += cell.count;
                    cellsWithData++;
                    maxCount = Math.max(maxCount, cell.count);
                }
            });
            
            console.log(`Window: ${window.padEnd(4)} | Total Positions: ${totalPositions.toString().padStart(8)} | Cells: ${cellsWithData.toString().padStart(6)} | Max Density: ${maxCount.toString().padStart(5)}`);
            
        } catch (error) {
            console.error(`Error testing window ${window}:`, error.message);
        }
    }
}

testTimeWindows().catch(console.error);
