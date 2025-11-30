#!/usr/bin/env node

/**
 * Comprehensive Logo Management Tool
 *
 * This script provides complete logo management functionality for the aircraft dashboard:
 * - Analyze and identify shipping companies
 * - Download logos from multiple sources (GitHub repositories)
 * - Check S3 bucket for missing logos
 * - Update airline database
 * - Generate reports
 *
 * Usage:
 *   node logo-manager.js analyze          # Analyze shipping companies
 *   node logo-manager.js download         # Download all missing logos
 *   node logo-manager.js download --check-s3  # Only download missing S3 files
 *   node logo-manager.js report           # Generate logo coverage report
 *   node logo-manager.js clean            # Clean up temporary files
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

// Configuration
const CONFIG = {
    s3: {
        endpoint: 'http://localhost:9000',
        region: 'us-east-1',
        credentials: {
            accessKeyId: 'minioadmin',
            secretAccessKey: 'minioadmin123',
        },
        forcePathStyle: true,
    },
    bucket: 'aircraft-data',
    dbPath: path.join(__dirname, '..', 'airline_database.json'),
    sources: ['flightaware_logos', 'radarbox_logos', 'custom_logos', 'stock_logos', 'manufacturers', 'clearbit']
};

// Initialize S3 client
const s3 = new S3Client(CONFIG.s3);

// Shipping company detection keywords
const SHIPPING_KEYWORDS = [
    'cargo', 'express', 'freight', 'shipping', 'delivery', 'logistics',
    'parcel', 'package', 'mail', 'postal', 'dhl', 'fedex', 'ups'
];

// Manufacturer company names
const MANUFACTURER_NAMES = [
    'Boeing', 'Airbus', 'Bombardier', 'Embraer', 'Lockheed Martin',
    'RTX Corporation', 'Northrop Grumman', 'General Dynamics',
    'Spirit AeroSystems', 'TransDigm Group', 'Textron', 'Gulfstream',
    'Antonov', 'Ilyushin', 'Tupolev', 'Sukhoi', 'Mitsubishi Aircraft',
    'Comac', 'AVIC'
];

// Airline indicators (to exclude passenger airlines)
const AIRLINE_INDICATORS = [
    'airlines', 'airline', 'airways', 'air line', 'avia', 'jet', 'wings',
    'air transport', 'air service', 'regional', 'international', 'atlantic',
    'pacific', 'europe', 'america', 'asia', 'africa', 'australia'
];

/**
 * Check if company is an aircraft manufacturer
 */
function isManufacturer(name) {
    const lowerName = name.toLowerCase();
    return MANUFACTURER_NAMES.some(manufacturer =>
        lowerName.includes(manufacturer.toLowerCase())
    );
}

// Stock ticker mapping for publicly traded companies (keyed by company name)
const STOCK_TICKERS = {
    // Major Airlines
    'American Airlines': 'AAL',
    'Delta Air Lines': 'DAL',
    'Southwest Airlines': 'LUV',
    'United Airlines': 'UAL',
    'Spirit Airlines': 'SAVE',
    'Alaska Airlines': 'ALK',
    'JetBlue Airways': 'JBLU',
    'Hawaiian Airlines': 'HA',
    'Ryanair': 'RYAAY',
    'EasyJet': 'EZJ',
    'International Consolidated Airlines Group': 'IAG',
    'Air France': 'AF',
    'British Airways': 'BA',

    // Shipping/Logistics Companies
    'United Parcel Service': 'UPS',
    'Federal Express': 'FDX',
    'Expeditors International': 'EXPD',
    'C.H. Robinson': 'CHRW',
    'J.B. Hunt Transport': 'JBHT',
    'Old Dominion Freight Line': 'ODFL',
    'Knight Transportation': 'KNX',
    'Landstar System': 'LSTR',
    'Werner Enterprises': 'WERN',
    'Saia Inc': 'SAIA',
    'ArcBest Corporation': 'ARCB',
    'Marten Transport': 'MRTN',
    'Heartland Express': 'HTLD',
    'Covenant Transportation Group': 'CVTI',

    // Aircraft Manufacturers
    'Boeing': 'BA',
    'Lockheed Martin': 'LMT',
    'RTX Corporation': 'RTX',
    'Northrop Grumman': 'NOC',
    'General Dynamics': 'GD',
    'Bombardier Inc': 'BBD.B',
    'Embraer': 'ERJ',
    'Textron Inc': 'TXT',
    'Spirit AeroSystems': 'SPR',
    'TransDigm Group': 'TDG',
    'Piper': 'PIPR',
    'Learjet': 'LEA',
    'Hawker Beechcraft': 'TXT',
    'Airbus': 'EAD.PA',
    'Beechcraft': 'TXT',

    // Additional mappings can be added here
};

/**
 * Load airline database
 */
function loadDatabase() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG.dbPath, 'utf8'));
    } catch (error) {
        console.error('Error loading database:', error.message);
        process.exit(1);
    }
}

/**
 * Save airline database
 */
function saveDatabase(db) {
    try {
        fs.writeFileSync(CONFIG.dbPath, JSON.stringify(db, null, 2));
        console.log('✅ Database updated successfully');
    } catch (error) {
        console.error('Error saving database:', error.message);
        process.exit(1);
    }
}

/**
 * Check if company is a shipping/cargo company
 */
function isShippingCompany(name) {
    const lowerName = name.toLowerCase();
    return SHIPPING_KEYWORDS.some(keyword => lowerName.includes(keyword));
}

/**
 * Check if company is NOT a passenger airline
 */
function isNotPassengerAirline(name) {
    const lowerName = name.toLowerCase();
    const hasAirlineIndicators = AIRLINE_INDICATORS.some(indicator => lowerName.includes(indicator));
    const hasStrongShippingIndicators = ['cargo', 'express', 'freight', 'dhl', 'fedex', 'ups'].some(indicator => lowerName.includes(indicator));

    if (hasStrongShippingIndicators) return true;
    if (hasAirlineIndicators && SHIPPING_KEYWORDS.some(keyword => lowerName.includes(keyword))) {
        return lowerName.includes('cargo') || lowerName.includes('express') || lowerName.includes('freight');
    }
    return !hasAirlineIndicators;
}

/**
 * Check if logo exists in S3
 */
async function checkLogoExistsInS3(code) {
    try {
        const command = new HeadObjectCommand({
            Bucket: CONFIG.bucket,
            Key: `logos/${code}.png`
        });
        await s3.send(command);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Download logo from GitHub
 */
async function downloadLogoFromGitHub(code, source) {
    try {
        const url = `https://raw.githubusercontent.com/Jxck-S/airline-logos/main/${source}/${code}.png`;
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(response.data);
    } catch (error) {
        return null;
    }
}

/**
 * Download logo from stock/company APIs
 */
async function downloadLogoFromStock(companyName) {
    const ticker = STOCK_TICKERS[companyName];
    if (!ticker) return null;

    try {
        // Try Clearbit API (free tier available)
        const domain = getDomainFromTicker(ticker);
        const clearbitUrl = `https://logo.clearbit.com/${domain}?size=200`;

        const response = await axios.get(clearbitUrl, {
            responseType: 'arraybuffer',
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; LogoFetcher/1.0)'
            }
        });

        return Buffer.from(response.data);
    } catch (error) {
        // Try alternative sources if Clearbit fails
        try {
            // Try IEX Cloud API (requires API key, but let's try public endpoint)
            const iexUrl = `https://storage.googleapis.com/iex/api/logos/${ticker}.png`;
            const response = await axios.get(iexUrl, {
                responseType: 'arraybuffer',
                timeout: 5000
            });
            return Buffer.from(response.data);
        } catch (iexError) {
            return null;
        }
    }
}

/**
 * Get domain from stock ticker
 */
function getDomainFromTicker(ticker) {
    const domainMap = {
        'AAL': 'aa.com',
        'DAL': 'delta.com',
        'LUV': 'southwest.com',
        'UAL': 'united.com',
        'SAVE': 'spirit.com',
        'ALK': 'alaskaair.com',
        'JBLU': 'jetblue.com',
        'HA': 'hawaiianairlines.com',
        'RYAAY': 'ryanair.com',
        'EZJ': 'easyjet.com',
        'IAG': 'iairgroup.com',
        'UPS': 'ups.com',
        'FDX': 'fedex.com',
        'EXPD': 'expeditors.com',
        'CHRW': 'chrobinson.com',
        'JBHT': 'jbhunt.com',
        'ODFL': 'odfl.com',
        'KNX': 'knights.com',
        'LSTR': 'landstar.com',
        'WERN': 'werner.com',
        'SAIA': 'saia.com',
        'ARCB': 'arcb.com',
        'MRTN': 'marten.com',
        'HTLD': 'heartlandexpress.com',
        'CVTI': 'covenantlogistics.com'
    };

    return domainMap[ticker] || `${ticker.toLowerCase()}.com`;
}

/**
 * Download logo from Clearbit using guessed domain
 */
async function downloadLogoFromClearbit(companyName) {
    // Try to guess domain from company name
    const domains = guessDomainsFromName(companyName);

    for (const domain of domains) {
        try {
            const clearbitUrl = `https://logo.clearbit.com/${domain}?size=200`;
            const response = await axios.get(clearbitUrl, {
                responseType: 'arraybuffer',
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; LogoFetcher/1.0)'
                }
            });
            return Buffer.from(response.data);
        } catch (error) {
            // Continue to next domain
            continue;
        }
    }

    return null;
}

/**
 * Guess possible domains from company name
 */
function guessDomainsFromName(companyName) {
    const domains = [];
    const name = companyName.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

    // Common patterns
    const words = name.split(/\s+/);
    const tlds = ['.com', '.net', '.org', '.co.uk', '.ca', '.au'];

    // Try full name as domain
    domains.push(name.replace(/\s+/g, '') + '.com');

    // Try first word + airline/airlines variations
    if (words.length > 0) {
        const firstWord = words[0];
        domains.push(firstWord + 'airlines.com');
        domains.push(firstWord + 'air.com');
        domains.push(firstWord + 'airways.com');
        domains.push(firstWord + 'avia.com');
        domains.push(firstWord + 'aviation.com');
        domains.push(firstWord + 'aero.com');
        domains.push('fly' + firstWord + '.com');
        domains.push(firstWord + 'airlines.net');
        domains.push(firstWord + 'air.net');
    }

    // Try combinations of first two words
    if (words.length >= 2) {
        const firstTwo = words[0] + words[1];
        domains.push(firstTwo + '.com');
        domains.push(firstTwo + 'air.com');
        domains.push(firstTwo + 'airlines.com');
        domains.push('fly' + firstTwo + '.com');
    }

    // Try combinations of all words
    if (words.length >= 3) {
        const allWords = words.join('');
        domains.push(allWords + '.com');
        domains.push(allWords + 'air.com');
    }

    // Try removing common suffixes like "Airlines", "Airways", etc.
    const cleanName = name
        .replace(/\b(airlines?|airways?|avia(tion)?|aero)\b/g, '')
        .trim()
        .replace(/\s+/g, '');

    if (cleanName && cleanName !== name.replace(/\s+/g, '')) {
        domains.push(cleanName + '.com');
        domains.push(cleanName + 'air.com');
    }

    // Remove duplicates and limit to reasonable number
    return [...new Set(domains)].slice(0, 10); // Limit to 10 attempts per airline
}

/**
 * Upload logo to S3
 */
async function uploadLogoToS3(code, logoBuffer) {
    try {
        const command = new PutObjectCommand({
            Bucket: CONFIG.bucket,
            Key: `logos/${code}.png`,
            Body: logoBuffer,
            ContentType: 'image/png'
        });
        await s3.send(command);
        return true;
    } catch (error) {
        console.error(`❌ Error uploading ${code}.png:`, error.message);
        return false;
    }
}

/**
 * Update database with logo URL
 */
function updateDatabaseWithLogo(db, code) {
    if (db[code]) {
        db[code].logo = `/api/v1logos/${code}`;
        return true;
    }
    return false;
}

/**
 * Analyze shipping companies
 */
function analyzeShippingCompanies(db) {
    console.log('\n=== SHIPPING COMPANY ANALYSIS ===\n');

    const shippingCompanies = [];
    const passengerAirlines = [];

    Object.entries(db).forEach(([code, data]) => {
        if (isShippingCompany(data.name) && isNotPassengerAirline(data.name)) {
            shippingCompanies.push({
                code,
                name: data.name,
                hasLogo: data.logo !== null
            });
        } else if (!isShippingCompany(data.name)) {
            passengerAirlines.push({
                code,
                name: data.name,
                hasLogo: data.logo !== null
            });
        }
    });

    console.log(`📊 Total companies: ${Object.keys(db).length}`);
    console.log(`🚚 Shipping companies: ${shippingCompanies.length}`);
    console.log(`✈️  Passenger airlines: ${passengerAirlines.length}`);

    const shippingWithLogos = shippingCompanies.filter(c => c.hasLogo);
    const shippingWithoutLogos = shippingCompanies.filter(c => !c.hasLogo);

    console.log(`\n📈 Shipping company logos:`);
    console.log(`   ✅ With logos: ${shippingWithLogos.length}`);
    console.log(`   ❌ Without logos: ${shippingWithoutLogos.length}`);
    console.log(`   📊 Coverage: ${Math.round(shippingWithLogos.length / shippingCompanies.length * 100)}%`);

    if (shippingWithoutLogos.length > 0) {
        console.log(`\n📋 Shipping companies without logos:`);
        shippingWithoutLogos.slice(0, 10).forEach(company => {
            console.log(`   ${company.code}: ${company.name}`);
        });
        if (shippingWithoutLogos.length > 10) {
            console.log(`   ... and ${shippingWithoutLogos.length - 10} more`);
        }
    }

    return { shippingCompanies, passengerAirlines };
}

/**
 * Generate logo coverage report
 */
function generateReport(db) {
    console.log('\n=== LOGO COVERAGE REPORT ===\n');

    const stats = {
        total: 0,
        withLogos: 0,
        withoutLogos: 0,
        shipping: { total: 0, withLogos: 0, withoutLogos: 0 },
        airlines: { total: 0, withLogos: 0, withoutLogos: 0 }
    };

    Object.entries(db).forEach(([code, data]) => {
        stats.total++;
        const hasLogo = data.logo !== null;
        const isShipping = isShippingCompany(data.name) && isNotPassengerAirline(data.name);

        if (hasLogo) stats.withLogos++;
        else stats.withoutLogos++;

        if (isShipping) {
            stats.shipping.total++;
            if (hasLogo) stats.shipping.withLogos++;
            else stats.shipping.withoutLogos++;
        } else {
            stats.airlines.total++;
            if (hasLogo) stats.airlines.withLogos++;
            else stats.airlines.withoutLogos++;
        }
    });

    console.log(`📊 OVERALL STATISTICS:`);
    console.log(`   Total companies: ${stats.total}`);
    console.log(`   With logos: ${stats.withLogos} (${Math.round(stats.withLogos/stats.total*100)}%)`);
    console.log(`   Without logos: ${stats.withoutLogos} (${Math.round(stats.withoutLogos/stats.total*100)}%)`);

    console.log(`\n🚚 SHIPPING COMPANIES:`);
    console.log(`   Total: ${stats.shipping.total}`);
    console.log(`   With logos: ${stats.shipping.withLogos} (${Math.round(stats.shipping.withLogos/stats.shipping.total*100)}%)`);
    console.log(`   Without logos: ${stats.shipping.withoutLogos} (${Math.round(stats.shipping.withoutLogos/stats.shipping.total*100)}%)`);

    console.log(`\n✈️  PASSENGER AIRLINES:`);
    console.log(`   Total: ${stats.airlines.total}`);
    console.log(`   With logos: ${stats.airlines.withLogos} (${Math.round(stats.airlines.withLogos/stats.airlines.total*100)}%)`);
    console.log(`   Without logos: ${stats.airlines.withoutLogos} (${Math.round(stats.airlines.withoutLogos/stats.airlines.total*100)}%)`);

    return stats;
}

/**
 * Download logos to local folder for approval
 */
async function downloadLogosToFolder(db, folderPath = './logo-previews', limit = null, type = 'all') {
    let companiesWithoutLogos = Object.entries(db)
        .filter(([code, data]) => data.logo === null)
        .map(([code, data]) => ({
            code,
            name: data.name,
            isShipping: isShippingCompany(data.name) && isNotPassengerAirline(data.name),
            isManufacturer: isManufacturer(data.name)
        }));

    // Filter by type
    if (type === 'airlines') {
        companiesWithoutLogos = companiesWithoutLogos.filter(c => !c.isShipping && !c.isManufacturer);
    } else if (type === 'shipping') {
        companiesWithoutLogos = companiesWithoutLogos.filter(c => c.isShipping);
    } else if (type === 'manufacturers') {
        companiesWithoutLogos = companiesWithoutLogos.filter(c => c.isManufacturer);
    }
    // type === 'all' keeps all companies

    // Create the folder if it doesn't exist
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }

    console.log(`\n=== DOWNLOADING ${type.toUpperCase()} LOGOS TO FOLDER: ${folderPath} ===\n`);
    console.log(`Found ${companiesWithoutLogos.length} ${type} companies without logos`);

    if (limit) {
        console.log(`Limiting to first ${limit} companies for preview`);
    } else {
        console.log(`Processing ALL ${companiesWithoutLogos.length} companies`);
    }

    const companiesToProcess = limit ? companiesWithoutLogos.slice(0, limit) : companiesWithoutLogos;
    let downloadedCount = 0;
    const batchSize = 5; // Process 5 companies at a time

    // Process companies in batches
    for (let i = 0; i < companiesToProcess.length; i += batchSize) {
        const batch = companiesToProcess.slice(i, i + batchSize);
        console.log(`\n--- Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(companiesToProcess.length/batchSize)} (${batch.length} companies) ---\n`);

        // Process batch in parallel
        const batchPromises = batch.map(async (company) => {
            let downloaded = false;
            let sourceUsed = null;

            // Try each source
            for (const source of CONFIG.sources) {
                let logoBuffer = null;

                if (source === 'stock_logos') {
                    // Use stock API for publicly traded companies
                    logoBuffer = await downloadLogoFromStock(company.name);
                } else if (source === 'clearbit' && !company.isShipping && !company.isManufacturer) {
                    // Use Clearbit for airlines
                    logoBuffer = await downloadLogoFromClearbit(company.name);
                } else {
                    // Use GitHub repositories for other sources
                    logoBuffer = await downloadLogoFromGitHub(company.code, source);
                }

                if (logoBuffer) {
                    const filePath = path.join(folderPath, `${company.code}.png`);
                    fs.writeFileSync(filePath, logoBuffer);
                    downloaded = true;
                    sourceUsed = source;
                    downloadedCount++;
                    break;
                }
            }

            return { company, downloaded, sourceUsed };
        });

        // Wait for all promises in the batch to complete
        const results = await Promise.all(batchPromises);

        // Log results
        results.forEach(({ company, downloaded, sourceUsed }) => {
            if (downloaded) {
                console.log(`✅ Downloaded ${company.code}: ${company.name} (from ${sourceUsed})`);
            } else {
                console.log(`❌ No logo found for ${company.code}: ${company.name}`);
            }
        });

        // Small delay between batches to be respectful to APIs
        if (i + batchSize < companiesToProcess.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    console.log(`\n=== DOWNLOAD SUMMARY ===`);
    console.log(`Downloaded ${downloadedCount} ${type} logos to ${folderPath}`);
    console.log(`Review the logos in the folder and run:`);
    console.log(`  node logo-tools/logo-manager.js approve ${folderPath}`);

    return { downloadedCount, folderPath };
}
async function downloadLogos(db, checkS3Only = false) {
    const companiesWithoutLogos = Object.entries(db)
        .filter(([code, data]) => data.logo === null)
        .map(([code, data]) => ({
            code,
            name: data.name,
            isShipping: isShippingCompany(data.name) && isNotPassengerAirline(data.name)
        }));

    console.log(`\n=== ${checkS3Only ? 'DOWNLOADING MISSING S3 LOGOS' : 'DOWNLOADING ALL LOGOS'} ===\n`);
    console.log(`Found ${companiesWithoutLogos.length} companies without logos`);
    console.log(`- Shipping companies: ${companiesWithoutLogos.filter(c => c.isShipping).length}`);
    console.log(`- Passenger airlines: ${companiesWithoutLogos.filter(c => !c.isShipping).length}`);

    if (checkS3Only) {
        console.log('\n🔍 Mode: Only downloading logos missing from S3 bucket\n');
    } else {
        console.log('\n📥 Mode: Downloading all missing logos\n');
    }

    let downloadedCount = 0;
    let shippingDownloaded = 0;
    let airlineDownloaded = 0;
    let skippedCount = 0;

    for (const company of companiesWithoutLogos) {
        // Check S3 if requested
        if (checkS3Only) {
            const existsInS3 = await checkLogoExistsInS3(company.code);
            if (existsInS3) {
                skippedCount++;
                console.log(`⏭️  Skipped ${company.code}: ${company.name} (logo exists in S3)`);
                continue;
            }
        }

        let downloaded = false;

        // Try each source
        for (const source of CONFIG.sources) {
            let logoBuffer = null;

            if (source === 'stock_logos') {
                // Use stock API for publicly traded companies
                logoBuffer = await downloadLogoFromStock(company.name);
            } else {
                // Use GitHub repositories for other sources
                logoBuffer = await downloadLogoFromGitHub(company.code, source);
            }

            if (logoBuffer) {
                const uploaded = await uploadLogoToS3(company.code, logoBuffer);
                if (uploaded) {
                    updateDatabaseWithLogo(db, company.code);
                    downloaded = true;
                    downloadedCount++;

                    if (company.isShipping) {
                        shippingDownloaded++;
                        console.log(`✅ Downloaded shipping logo for ${company.code}: ${company.name} (from ${source})`);
                    } else {
                        airlineDownloaded++;
                        console.log(`✅ Downloaded airline logo for ${company.code}: ${company.name} (from ${source})`);
                    }
                    break;
                }
            }
        }

        if (!downloaded) {
            if (company.isShipping) {
                console.log(`❌ No logo found for shipping company ${company.code}: ${company.name}`);
            } else {
                console.log(`❌ No logo found for airline ${company.code}: ${company.name}`);
            }
        }
    }

    // Save database if changes were made
    if (downloadedCount > 0) {
        saveDatabase(db);
    }

    console.log(`\n=== DOWNLOAD SUMMARY ===`);
    console.log(`Total companies checked: ${companiesWithoutLogos.length}`);
    if (checkS3Only) {
        console.log(`Logos skipped (already in S3): ${skippedCount}`);
    }
    console.log(`Logos downloaded and uploaded: ${downloadedCount}`);
    console.log(`- Shipping companies: ${shippingDownloaded}`);
    console.log(`- Passenger airlines: ${airlineDownloaded}`);
    console.log(`Still need logos: ${companiesWithoutLogos.length - downloadedCount - skippedCount}`);

    return { downloadedCount, skippedCount };
}

/**
 * Approve logos from folder and upload to S3
 */
async function approveLogosFromFolder(db, folderPath) {
    if (!fs.existsSync(folderPath)) {
        console.error(`❌ Folder ${folderPath} does not exist`);
        return;
    }

    console.log(`\n=== APPROVING LOGOS FROM FOLDER: ${folderPath} ===\n`);

    const files = fs.readdirSync(folderPath).filter(file => file.endsWith('.png'));
    let approvedCount = 0;

    for (const file of files) {
        const code = path.parse(file).name; // Remove .png extension

        if (db[code]) {
            const filePath = path.join(folderPath, file);
            const logoBuffer = fs.readFileSync(filePath);

            // Upload to S3
            const uploaded = await uploadLogoToS3(code, logoBuffer);
            if (uploaded) {
                // Update database
                updateDatabaseWithLogo(db, code);
                approvedCount++;
                console.log(`✅ Approved and uploaded ${code}: ${db[code].name}`);
            }
        } else {
            console.log(`⚠️  Code ${code} not found in database, skipping`);
        }
    }

    // Save database if changes were made
    if (approvedCount > 0) {
        saveDatabase(db);
    }

    console.log(`\n=== APPROVAL SUMMARY ===`);
    console.log(`Approved and uploaded ${approvedCount} logos`);

    return approvedCount;
}
function cleanup() {
    console.log('\n=== CLEANUP ===\n');

    const filesToClean = [
        'download_all_logos.js',
        'download_and_update_logos.js',
        'download_shipping_logos.js',
        'find_shipping_logos.js',
        'upload_logos_github.js',
        'upload_logos_png.js',
        'upload-logos.js'
    ];

    let cleanedCount = 0;

    filesToClean.forEach(filename => {
        const filepath = path.join(__dirname, '..', filename);
        try {
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
                console.log(`🗑️  Removed ${filename}`);
                cleanedCount++;
            } else {
                console.log(`⚠️  ${filename} not found`);
            }
        } catch (error) {
            console.log(`❌ Error removing ${filename}: ${error.message}`);
        }
    });

    console.log(`\n✅ Cleanup complete: ${cleanedCount} files removed`);
}

/**
 * Main function
 */
async function main() {
    const command = process.argv[2];
    const db = loadDatabase();

    switch (command) {
        case 'analyze':
            analyzeShippingCompanies(db);
            break;

        case 'download':
            const checkS3 = process.argv.includes('--check-s3') || process.argv.includes('--only-missing');
            await downloadLogos(db, checkS3);
            break;

        case 'preview':
            // Parse arguments: preview [limit] [type] [folder]
            let limit = 10;
            let type = 'all';
            let folderPath = './logo-previews';

            if (process.argv[3]) {
                if (!isNaN(process.argv[3]) || process.argv[3] === 'all') {
                    limit = process.argv[3] === 'all' ? null : parseInt(process.argv[3]);
                    if (process.argv[4]) {
                        if (['all', 'airlines', 'shipping', 'manufacturers'].includes(process.argv[4])) {
                            type = process.argv[4];
                            folderPath = process.argv[5] || './logo-previews';
                        } else {
                            folderPath = process.argv[4];
                        }
                    }
                } else if (['all', 'airlines', 'shipping', 'manufacturers'].includes(process.argv[3])) {
                    type = process.argv[3];
                    folderPath = process.argv[4] || './logo-previews';
                } else {
                    folderPath = process.argv[3];
                }
            }

            await downloadLogosToFolder(db, folderPath, limit, type);
            break;

        case 'approve':
            const approveFolder = process.argv[3] || './logo-previews';
            await approveLogosFromFolder(db, approveFolder);
            break;

        case 'report':
            generateReport(db);
            break;

        case 'clean':
            cleanup();
            break;

        default:
            console.log(`
🤖 Logo Management Tool

Usage:
  node logo-manager.js analyze                    # Analyze shipping companies
  node logo-manager.js download                   # Download all missing logos
  node logo-manager.js download --check-s3        # Only download missing S3 files
  node logo-manager.js preview [limit] [type] [folder]  # Download logos to folder for approval
  node logo-manager.js approve [folder]           # Approve and upload logos from folder
  node logo-manager.js report                     # Generate logo coverage report
  node logo-manager.js clean                      # Clean up temporary files

Types for preview:
  all          # All companies without logos (default)
  airlines     # Only passenger airlines
  shipping     # Only shipping/cargo companies
  manufacturers # Only aircraft manufacturers

Examples:
  node logo-tools/logo-manager.js analyze
  node logo-tools/logo-manager.js download --check-s3
  node logo-tools/logo-manager.js preview 20 airlines ./airline-logos
  node logo-tools/logo-manager.js preview 10 manufacturers ./manufacturer-logos
  node logo-tools/logo-manager.js approve ./airline-logos
  node logo-tools/logo-manager.js report
            `);
            break;
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = {
    analyzeShippingCompanies,
    generateReport,
    downloadLogos,
    downloadLogosToFolder,
    approveLogosFromFolder,
    cleanup
};