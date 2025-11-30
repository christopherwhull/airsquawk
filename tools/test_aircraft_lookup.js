#!/usr/bin/env node
/**
 * Test script for aircraft database lookup functionality
 */

const aircraftDB = require('./lib/aircraft-database');

console.log('='.repeat(70));
console.log('Aircraft Database Lookup Test');
console.log('='.repeat(70));
console.log();

// Load the database
console.log('Loading aircraft database...');
aircraftDB.load();

// Get stats
const stats = aircraftDB.getStats();
console.log('Database Stats:');
console.log(`  Loaded: ${stats.loaded}`);
console.log(`  Aircraft Count: ${stats.aircraftCount.toLocaleString()}`);
console.log(`  Source: ${stats.source}`);
console.log(`  Downloaded: ${stats.downloaded}`);
console.log();

if (!aircraftDB.isReady()) {
    console.error('❌ Aircraft database is not ready!');
    process.exit(1);
}

// Test some known ICAO24 codes
console.log('Testing aircraft lookups:');
console.log('-'.repeat(70));

const testCases = [
    'a12345',  // Random test
    'ac96b8',  // Common US aircraft
    '4ca7b5',  // Common Irish aircraft
    'a00001',  // Low number
    '3c6444',  // Example from OpenSky docs
    'invalid', // Should not be found
];

for (const icao24 of testCases) {
    const aircraft = aircraftDB.lookup(icao24);
    
    if (aircraft) {
        console.log(`✓ ${icao24}:`);
        console.log(`    Registration: ${aircraft.registration || 'N/A'}`);
        console.log(`    Type: ${aircraft.typecode || 'N/A'} (${aircraft.model || 'N/A'})`);
        console.log(`    Operator: ${aircraft.operator || 'N/A'}`);
    } else {
        console.log(`✗ ${icao24}: Not found`);
    }
    console.log();
}

console.log('='.repeat(70));
console.log('Test Complete');
console.log('='.repeat(70));
