const https = require('https');
const fs = require('fs');

async function scrapeFlightAwareAircraft(aircraftType) {
    const baseUrl = `https://www.flightaware.com/live/aircrafttype/${aircraftType}`;
    const registrations = new Set();
    let offset = 0;
    const step = 25;
    let hasMoreData = true;
    let totalPages = 0;
    let consecutiveLowCount = 0;

    console.log(`Starting to scrape ${aircraftType} aircraft from FlightAware...`);

    while (hasMoreData && totalPages < 200) { // Allow more pages for B738
        try {
            const url = `${baseUrl}?;offset=${offset};order=ident;sort=DESC`;
            console.log(`Scraping offset ${offset}...`);

            const html = await fetchPage(url);
            totalPages++;

            // Extract aircraft registrations using multiple regex patterns
            const regPatterns = [
                /\/live\/flight\/([A-Z0-9-]+)"/g,
                /registration[^>]*>([A-Z0-9-]+)</g,
                /([A-Z]{2}-[A-Z0-9]{3,5})/g,
                /([A-Z]{3}[0-9]{3,4})/g,
                /([A-Z]{4}[0-9]{3})/g,
                /([A-Z]{2}[0-9]{4})/g,
                /([A-Z]{3}[0-9]{4})/g
            ];

            let foundInThisPage = 0;
            const pageRegs = new Set();

            for (const pattern of regPatterns) {
                let match;
                while ((match = pattern.exec(html)) !== null) {
                    const reg = match[1];
                    // More lenient filtering for aircraft registrations
                    if (reg && reg.length >= 4 && reg.length <= 10 && /^[A-Z0-9-]+$/.test(reg) && /[A-Z]/.test(reg)) {
                        // Additional validation - should contain at least one letter and be reasonable format
                        if (reg.includes('-') || /^[A-Z]{2,4}[0-9]/.test(reg)) {
                            pageRegs.add(reg);
                            foundInThisPage++;
                        }
                    }
                }
            }

            // Add all found registrations to main set
            pageRegs.forEach(reg => registrations.add(reg));

            console.log(`Found ${foundInThisPage} registrations at offset ${offset} (total unique: ${registrations.size})`);

            // Check for duplicates - if we're getting very few new registrations, we might be at the end
            const newRegs = pageRegs.size;
            if (newRegs < 3) { // Lower threshold for B738 since there are more flights
                consecutiveLowCount++;
            } else {
                consecutiveLowCount = 0;
            }

            // Stop if we get 5 consecutive pages with very few new registrations
            if (consecutiveLowCount >= 5) {
                console.log('Reached end of data (consecutive low registration counts)');
                hasMoreData = false;
            }

            offset += step;

            // Add a delay to be respectful to the server
            await new Promise(resolve => setTimeout(resolve, 1500));

        } catch (error) {
            console.error(`Error scraping offset ${offset}:`, error.message);
            hasMoreData = false;
        }
    }

    const registrationArray = Array.from(registrations).sort();
    console.log(`\nTotal unique ${aircraftType} registrations found: ${registrationArray.length}`);

    // Save to file
    const output = {
        scraped_date: new Date().toISOString(),
        aircraft_type: aircraftType,
        total_registrations: registrationArray.length,
        registrations: registrationArray
    };

    fs.writeFileSync(`${aircraftType.toLowerCase()}_flightaware_registrations.json`, JSON.stringify(output, null, 2));
    console.log(`Saved registrations to ${aircraftType.toLowerCase()}_flightaware_registrations.json`);

    return registrationArray;
}
    const baseUrl = 'https://www.flightaware.com/live/aircrafttype/B38M';
    const registrations = new Set();
    let offset = 0;
    const step = 25;
    let hasMoreData = true;
    let totalPages = 0;
    let consecutiveLowCount = 0;

    console.log('Starting to scrape B38M aircraft from FlightAware...');

    while (hasMoreData && totalPages < 100) { // Allow more pages
        try {
            const url = `${baseUrl}?;offset=${offset};order=actualdeparturetime;sort=DESC`;
            console.log(`Scraping offset ${offset}...`);

            const html = await fetchPage(url);
            totalPages++;

            // Extract aircraft registrations using multiple regex patterns
            const regPatterns = [
                /\/live\/flight\/([A-Z0-9-]+)"/g,
                /registration[^>]*>([A-Z0-9-]+)</g,
                /([A-Z]{2}-[A-Z0-9]{3,5})/g,
                /([A-Z]{3}[0-9]{3,4})/g,
                /([A-Z]{4}[0-9]{3})/g,
                /([A-Z]{2}[0-9]{4})/g,
                /([A-Z]{3}[0-9]{4})/g
            ];

            let foundInThisPage = 0;
            const pageRegs = new Set();

            for (const pattern of regPatterns) {
                let match;
                while ((match = pattern.exec(html)) !== null) {
                    const reg = match[1];
                    // More lenient filtering for aircraft registrations
                    if (reg && reg.length >= 4 && reg.length <= 10 && /^[A-Z0-9-]+$/.test(reg) && /[A-Z]/.test(reg)) {
                        // Additional validation - should contain at least one letter and be reasonable format
                        if (reg.includes('-') || /^[A-Z]{2,4}[0-9]/.test(reg)) {
                            pageRegs.add(reg);
                            foundInThisPage++;
                        }
                    }
                }
            }

            // Add all found registrations to main set
            pageRegs.forEach(reg => registrations.add(reg));

            console.log(`Found ${foundInThisPage} registrations at offset ${offset} (total unique: ${registrations.size})`);

            // Check for duplicates - if we're getting very few new registrations, we might be at the end
            const newRegs = pageRegs.size;
            if (newRegs < 2) {
                consecutiveLowCount++;
            } else {
                consecutiveLowCount = 0;
            }

            // Stop if we get 3 consecutive pages with very few new registrations
            if (consecutiveLowCount >= 3) {
                console.log('Reached end of data (consecutive low registration counts)');
                hasMoreData = false;
            }

            offset += step;

            // Add a delay to be respectful to the server
            await new Promise(resolve => setTimeout(resolve, 1500));

        } catch (error) {
            console.error(`Error scraping offset ${offset}:`, error.message);
            hasMoreData = false;
        }
    }

    const registrationArray = Array.from(registrations).sort();
    console.log(`\nTotal unique B38M registrations found: ${registrationArray.length}`);

    // Save to file
    const output = {
        scraped_date: new Date().toISOString(),
        aircraft_type: 'B38M',
        total_registrations: registrationArray.length,
        registrations: registrationArray
    };

    fs.writeFileSync('b38m_flightaware_registrations.json', JSON.stringify(output, null, 2));
    console.log('Saved registrations to b38m_flightaware_registrations.json');

    return registrationArray;
}

function fetchPage(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve(data);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

// Check against our database
function checkDatabaseMatches(scrapedRegistrations) {
    const db = JSON.parse(fs.readFileSync('opensky_aircraft_cache.json', 'utf8'));
    const matches = [];
    const notInDb = [];

    for (const reg of scrapedRegistrations) {
        let found = false;
        for (const [id, aircraft] of Object.entries(db.aircraft)) {
            if (aircraft.registration === reg) {
                matches.push({
                    registration: reg,
                    type: aircraft.type,
                    manufacturer: aircraft.manufacturer,
                    body_type: aircraft.body_type
                });
                found = true;
                break;
            }
        }
        if (!found) {
            notInDb.push(reg);
        }
    }

    console.log(`\nDatabase check results:`);
    console.log(`Found in database: ${matches.length}`);
    console.log(`Not in database: ${notInDb.length}`);

    if (matches.length > 0) {
        console.log('\nFirst 10 matches:');
        matches.slice(0, 10).forEach(match => {
            console.log(`${match.registration}: ${match.manufacturer} ${match.type} (${match.body_type} body)`);
        });
    }

    if (notInDb.length > 0) {
        console.log('\nFirst 10 not in database:');
        console.log(notInDb.slice(0, 10).join(', '));
    }

    return { matches, notInDb };
}

// Run the scraper
scrapeFlightAwareAircraft('B738')
    .then(registrations => {
        console.log(`Scraping completed. Found ${registrations.length} unique registrations.`);
    })
    .catch(error => {
        console.error('Scraping failed:', error);
    });