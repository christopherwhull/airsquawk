const fs = require('fs');
const readline = require('readline');

async function processAirlines() {
    const airlineDatabase = {};
    const fileStream = fs.createReadStream('airlines.dat');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        // The file is in a CSV-like format, but not strictly compliant (e.g., quotes)
        const parts = line.split(',');
        
        if (parts.length >= 8) {
            const name = parts[1].replace(/"/g, ''); // Airline Name
            const iata = parts[3].replace(/"/g, ''); // IATA Code
            const icao = parts[4].replace(/"/g, ''); // ICAO Code
            
            // We prioritize the 3-letter ICAO code, but will use IATA if ICAO is not present
            const code = (icao && icao.length === 3 && /^[A-Z]{3}$/.test(icao)) ? icao : null;
            
            if (code && name) {
                airlineDatabase[code] = name;
            }
        }
    }

    fs.writeFileSync('airline_database.json', JSON.stringify(airlineDatabase, null, 2));
    console.log(`Successfully processed airlines and created airline_database.json with ${Object.keys(airlineDatabase).length} entries.`);
}

processAirlines();
