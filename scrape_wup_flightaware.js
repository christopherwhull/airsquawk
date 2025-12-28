const https = require('https');
const fs = require('fs');

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

function scrapeWheelsUpFleet() {
    const baseUrl = 'https://www.flightaware.com/live/fleet/WUP';
    const registrations = new Set();
    let offset = 0;
    const step = 25;
    let hasMoreData = true;
    let totalPages = 0;
    let consecutiveLowCount = 0;

    console.log('Starting to scrape Wheels Up (WUP) fleet from FlightAware...');

    function processPage() {
        if (!hasMoreData || totalPages >= 200) {
            const registrationArray = Array.from(registrations).sort();
            console.log(`\nTotal unique Wheels Up registrations found: ${registrationArray.length}`);

            const output = {
                scraped_date: new Date().toISOString(),
                airline: 'WUP',
                airline_name: 'Wheels Up',
                total_registrations: registrationArray.length,
                registrations: registrationArray
            };

            fs.writeFileSync('wup_flightaware_registrations.json', JSON.stringify(output, null, 2));
            console.log('Saved registrations to wup_flightaware_registrations.json');
            return;
        }

        const url = `${baseUrl}?;offset=${offset};order=ident;sort=DESC`;
        console.log(`Scraping offset ${offset}...`);

        fetchPage(url).then(html => {
            totalPages++;

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
                    if (reg && reg.length >= 4 && reg.length <= 10 && /^[A-Z0-9-]+$/.test(reg) && /[A-Z]/.test(reg)) {
                        if (reg.includes('-') || /^[A-Z]{2,4}[0-9]/.test(reg)) {
                            pageRegs.add(reg);
                            foundInThisPage++;
                        }
                    }
                }
            }

            pageRegs.forEach(reg => registrations.add(reg));
            console.log(`Found ${foundInThisPage} registrations at offset ${offset} (total unique: ${registrations.size})`);

            const newRegs = pageRegs.size;
            if (newRegs < 3) {
                consecutiveLowCount++;
            } else {
                consecutiveLowCount = 0;
            }

            if (consecutiveLowCount >= 5) {
                console.log('Reached end of data (consecutive low registration counts)');
                hasMoreData = false;
            }

            offset += step;

            setTimeout(processPage, 1500);
        }).catch(error => {
            console.error(`Error scraping offset ${offset}:`, error.message);
            hasMoreData = false;
            processPage();
        });
    }

    processPage();
}

scrapeWheelsUpFleet();