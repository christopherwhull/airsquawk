const http = require('http');

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
        console.log('Analyzing heatmap data by 2-hour bins...\n');
        
        // Fetch data for different time windows
        const windows = ['1h', '4h', '12h', '24h', '7d', 'all'];
        const results = {};
        
        console.log('Fetching data for each time window...');
        
        for (const window of windows) {
            try {
                const data = await fetchJSON(`/api/heatmap?window=${window}`);
                const cellsWithData = data.filter(c => c.count > 0).length;
                const totalPos = data.reduce((sum, c) => sum + c.count, 0);
                results[window] = totalPos;
                console.log(`  ${window.padEnd(5)}: ${totalPos.toLocaleString().padStart(8)} positions in ${cellsWithData} cells`);
            } catch (e) {
                console.log(`  ${window.padEnd(5)}: ERROR - ${e.message}`);
            }
        }
        
        console.log('\n' + '='.repeat(70));
        console.log('2-Hour Bin Analysis (Derived from Window Differences):');
        console.log('='.repeat(70) + '\n');
        
        // Calculate positions in each 2-hour bin by comparing windows
        const bins = [];
        
        // Most recent 2 hours (0-2h)
        bins.push({
            range: 'Last 0-2h',
            positions: results['1h'],
            description: 'Based on 1h window'
        });
        
        // 2-4h
        bins.push({
            range: '2-4h ago',
            positions: Math.max(0, results['4h'] - results['1h']),
            description: 'Calculated from (4h - 1h)'
        });
        
        // 4-12h
        bins.push({
            range: '4-12h ago',
            positions: Math.max(0, results['12h'] - results['4h']),
            description: 'Calculated from (12h - 4h)'
        });
        
        // 12-24h
        bins.push({
            range: '12-24h ago',
            positions: Math.max(0, results['24h'] - results['12h']),
            description: 'Calculated from (24h - 12h)'
        });
        
        // 24h+
        bins.push({
            range: '24h+ ago',
            positions: Math.max(0, results['all'] - results['24h']),
            description: 'Calculated from (all - 24h)'
        });
        
        let totalBinned = 0;
        bins.forEach((bin, idx) => {
            const bar = '█'.repeat(Math.floor(bin.positions / 500));
            console.log(`${bin.range.padEnd(15)}: ${bin.positions.toLocaleString().padStart(8)} positions ${bar}`);
            totalBinned += bin.positions;
        });
        
        console.log('\n' + '-'.repeat(70));
        console.log(`Total accounted for: ${totalBinned.toLocaleString()}`);
        console.log(`All positions ever:  ${results['all'].toLocaleString()}`);
        
        console.log('\n' + '='.repeat(70));
        console.log('Summary by Time Window:');
        console.log('='.repeat(70) + '\n');
        
        const timeWindows = [
            { window: '1h', label: 'Last 1 Hour' },
            { window: '4h', label: 'Last 4 Hours' },
            { window: '12h', label: 'Last 12 Hours' },
            { window: '24h', label: 'Last 24 Hours' },
            { window: '7d', label: 'Last 7 Days' },
            { window: 'all', label: 'All Time' }
        ];
        
        timeWindows.forEach(tw => {
            const count = results[tw.window];
            const pct = ((count / results['all']) * 100).toFixed(1);
            console.log(`${tw.label.padEnd(20)}: ${count.toLocaleString().padStart(8)} (${pct.padStart(5)}%)`);
        });

    } catch (error) {
        console.error('Error:', error.message);
    }
}

analyzePositions();
