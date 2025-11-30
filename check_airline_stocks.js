#!/usr/bin/env node

/**
 * Check for airlines with stock tickers that don't have logos
 */

const fs = require('fs');
const path = require('path');

// Load database
const dbPath = path.join(__dirname, 'airline_database.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

// Stock ticker mapping for airlines
const airlineStockTickers = {
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
    'British Airways': 'BA'
};

console.log('Checking for airlines with stock tickers that might not have logos...\n');

const missingLogos = [];

Object.entries(db).forEach(([code, data]) => {
    if (airlineStockTickers[data.name] && data.logo === null) {
        missingLogos.push({
            code,
            name: data.name,
            ticker: airlineStockTickers[data.name]
        });
    }
});

if (missingLogos.length > 0) {
    console.log(`Found ${missingLogos.length} airlines with stock tickers but no logos:\n`);
    missingLogos.forEach(airline => {
        console.log(`${airline.code}: ${airline.name} (${airline.ticker})`);
    });
} else {
    console.log('All airlines with stock tickers already have logos.');
}

// Also check if any airlines have logos but different names
console.log('\nChecking for airlines that have logos but different names from stock tickers...\n');
Object.entries(db).forEach(([code, data]) => {
    if (data.logo !== null) {
        Object.entries(airlineStockTickers).forEach(([stockName, ticker]) => {
            if (data.name !== stockName && data.name.toLowerCase().includes(stockName.toLowerCase().split(' ')[0])) {
                console.log(`Possible match: ${code}: ${data.name} has logo, stock ticker for "${stockName}" (${ticker})`);
            }
        });
    }
});