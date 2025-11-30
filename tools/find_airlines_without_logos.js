const fs = require('fs');

console.log('Checking for airlines without logos...');

try {
    const airlineData = JSON.parse(fs.readFileSync('airline_database.json', 'utf8'));
    const airlinesWithoutLogos = [];

    for (const [icao, airline] of Object.entries(airlineData)) {
        if (!airline.logo || airline.logo.trim() === '') {
            airlinesWithoutLogos.push({
                icao: icao,
                name: airline.name || 'Unknown',
                country: airline.country || 'Unknown'
            });
        }
    }

    if (airlinesWithoutLogos.length === 0) {
        console.log('All airlines have logos!');
    } else {
        console.log(`Found ${airlinesWithoutLogos.length} airlines without logos:`);
        airlinesWithoutLogos.forEach(airline => {
            console.log(`${airline.icao}: ${airline.name} (${airline.country})`);
        });
    }

} catch (error) {
    console.error('Error reading airline database:', error.message);
}