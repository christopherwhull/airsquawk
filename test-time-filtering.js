const axios = require('axios');

async function testTimeWindows() {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║  Time Window Filtering Test                            ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    try {
        const tests = [
            { window: 'all', label: 'All Time' },
            { window: '7d', label: '7 Days' },
            { window: '24h', label: '24 Hours' },
            { window: '6h', label: '6 Hours' },
            { window: '1h', label: '1 Hour' }
        ];

        for (const test of tests) {
            const res = await axios.get(`http://localhost:3002/api/heatmap?window=${test.window}`);
            const total = res.data.reduce((sum, cell) => sum + (cell.count || 0), 0);
            const cells = res.data.length;
            console.log(`${test.label.padEnd(12)}: ${total.toLocaleString().padStart(6)} positions in ${cells.toLocaleString().padStart(5)} cells`);
        }

        console.log('\n╔════════════════════════════════════════════════════════╗');
        console.log('║  Expected Results (Data: Nov 21-25)                    ║');
        console.log('╚════════════════════════════════════════════════════════╝\n');
        console.log('All Time:    Should show ALL 75,792 positions');
        console.log('7 Days:      Should show last 7 days (newest from Nov 25)');
        console.log('24 Hours:    Should show last 24 hours before Nov 25 23:25');
        console.log('6 Hours:     Should show last 6 hours before Nov 25 23:25');
        console.log('1 Hour:      Should show last 1 hour before Nov 25 23:25\n');

    } catch (error) {
        console.error('Error:', error.message);
    }
}

testTimeWindows();
