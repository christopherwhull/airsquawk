const axios = require('axios');

async function checkDateRange() {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║  Heatmap Data Date Range Analysis                      ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    try {
        // Get stats which now includes date range
        const statsResponse = await axios.get('http://localhost:3002/api/heatmap-stats');
        const stats = statsResponse.data;

        console.log('Overall Data Statistics:');
        console.log(`   Total Positions: ${stats.totalPositions.toLocaleString()}`);
        console.log(`   Enriched with Type: ${stats.positionsWithType.toLocaleString()}`);
        console.log(`   Enriched with Manufacturer: ${stats.positionsWithManufacturer.toLocaleString()}\n`);

        if (stats.dateRange && stats.dateRange.hasTimestamps) {
            console.log('Date Range:');
            console.log(`   Earliest: ${stats.dateRange.minDate}`);
            console.log(`   Latest:   ${stats.dateRange.maxDate}`);
            console.log(`   Span:     ${stats.dateRange.spanDays} days (${stats.dateRange.spanHours} hours)\n`);
        } else {
            console.log('Date Range: Unable to determine from data\n');
        }

        console.log('Top 10 Manufacturers:');
        Object.entries(stats.topManufacturers).forEach(([manu, count], idx) => {
            console.log(`   ${String(idx + 1).padStart(2)}. ${manu.padEnd(25)} ${count.toLocaleString().padStart(8)} positions`);
        });

    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkDateRange();
