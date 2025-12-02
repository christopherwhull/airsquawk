const http = require('http');
const fs = require('fs');

const baseUrl = 'http://localhost:3002';

async function fetchJSON(path) {
    return new Promise((resolve, reject) => {
        http.get(`${baseUrl}${path}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function analyzePositions() {
    try {
        console.log('Loading all position data...\n');
        
        const allData = await fetchJSON('/api/heatmap?window=all');
        
        if (!Array.isArray(allData)) {
            console.error('Unexpected response format:', allData);
            return;
        }

        let totalPositions = 0;
        allData.forEach(cell => {
            if (cell.count > 0) {
                totalPositions += cell.count;
            }
        });
        
        console.log(`Total positions across all cells: ${totalPositions.toLocaleString()}`);
        console.log(`Grid cells with data: ${allData.filter(c => c.count > 0).length}\n`);

        // Try to get detailed position history to calculate bins
        console.log('Fetching position history from server state file...\n');
        
        try {
            // Read the state file directly
            const stateFilePath = './runtime/dashboard-state.json';
            if (!fs.existsSync(stateFilePath)) {
                console.log('State file not found at', stateFilePath);
                return;
            }
            
            const stateContent = fs.readFileSync(stateFilePath, 'utf-8');
            const state = JSON.parse(stateContent);
            
            if (!state.positionHistory || !Array.isArray(state.positionHistory)) {
                console.log('No position history in state file');
                return;
            }
            
            console.log(`Found ${state.positionHistory.length.toLocaleString()} positions in state file\n`);
            
            // Find min and max timestamps
            let minTime = Infinity;
            let maxTime = 0;
            
            state.positionHistory.forEach(pos => {
                if (pos.timestamp) {
                    // Timestamp is already in milliseconds
                    const ts = typeof pos.timestamp === 'string' ? new Date(pos.timestamp).getTime() : pos.timestamp;
                    minTime = Math.min(minTime, ts);
                    maxTime = Math.max(maxTime, ts);
                }
            });
            
            if (minTime === Infinity) {
                console.log('No valid timestamps found');
                return;
            }
            
            const minDate = new Date(minTime);
            const maxDate = new Date(maxTime);
            
            console.log(`Data spans from ${minDate.toISOString()} to ${maxDate.toISOString()}`);
            console.log(`Total span: ${((maxTime - minTime) / (60 * 60 * 1000)).toFixed(1)} hours\n`);
            
            // Create 2-hour bins
            const bins = {};
            const binDuration = 2 * 60 * 60 * 1000; // 2 hours in ms
            
            // Initialize bins
            let currentBinTime = Math.floor(minTime / binDuration) * binDuration;
            while (currentBinTime <= maxTime) {
                const binDate = new Date(currentBinTime);
                const key = binDate.toISOString().slice(0, 16); // e.g., "2025-12-01T06"
                bins[key] = 0;
                currentBinTime += binDuration;
            }
            
            // Count positions in each bin
            state.positionHistory.forEach(pos => {
                if (pos.timestamp) {
                    // Timestamp is already in milliseconds
                    const ts = typeof pos.timestamp === 'string' ? new Date(pos.timestamp).getTime() : pos.timestamp;
                    const binTime = Math.floor(ts / binDuration) * binDuration;
                    const binDate = new Date(binTime);
                    const key = binDate.toISOString().slice(0, 16);
                    if (bins[key] !== undefined) {
                        bins[key]++;
                    }
                }
            });
            
            // Sort and display
            const sortedBins = Object.keys(bins).sort();
            
            console.log('Positions by 2-Hour Bin (All Data):');
            console.log('='.repeat(70));
            console.log('Time Range (UTC)                  | Count\n');
            
            let totalBinned = 0;
            sortedBins.forEach((key, idx) => {
                const count = bins[key];
                const binStart = new Date(key + ':00Z');
                const binEnd = new Date(binStart.getTime() + 2 * 60 * 60 * 1000);
                
                const startStr = `${binStart.toISOString().slice(0, 16)}Z`;
                const endStr = `${binEnd.toISOString().slice(0, 16)}Z`;
                const bar = '█'.repeat(Math.floor(count / 50));
                
                console.log(`${startStr} to ${endStr} | ${count.toLocaleString().padStart(8)} ${bar}`);
                totalBinned += count;
            });
            
            console.log('\n' + '='.repeat(70));
            console.log(`Total positions accounted for: ${totalBinned.toLocaleString()}`);
            console.log(`Total 2-hour bins: ${sortedBins.length}`);
            console.log(`Average per bin: ${(totalBinned / sortedBins.length).toFixed(0)}`);
            
        } catch (e) {
            console.log('Error reading state file:', e.message);
            console.log('\nMake sure the server is running and state.json exists in ./runtime/');
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

analyzePositions();
