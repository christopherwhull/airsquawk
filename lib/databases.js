// lib/databases.js
const { downloadAndParseS3File } = require('./s3-helpers');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

let airlineDatabase = null;
let aircraftTypesDatabase = null;
let lastFetchTime = 0;

async function getAirlineDatabase(s3, bucketName) {
    const now = Date.now();
    if (airlineDatabase && (now - lastFetchTime < 24 * 60 * 60 * 1000)) {
        return airlineDatabase;
    }

    try {
        logger.info('Fetching airline database from S3...');
        let data = await downloadAndParseS3File(s3, bucketName, 'airline_database.json');
        // downloadAndParseS3File can return an array (JSONL) or a single parsed object wrapped in an array.
        if (Array.isArray(data)) {
            if (data.length === 1 && typeof data[0] === 'object' && !Array.isArray(data[0])) {
                data = data[0];
            } else {
                // If the file contained multiple JSON lines, attempt to merge into one object
                const merged = {};
                for (const item of data) {
                    if (item && typeof item === 'object') Object.assign(merged, item);
                }
                data = merged;
            }
        }
        
        // Check if we got valid data
        if (!data || Object.keys(data).length === 0) {
            throw new Error('S3 returned empty airline database');
        }
        
        airlineDatabase = data || {};
        lastFetchTime = now;
        logger.info('Successfully loaded airline database from S3.');
        return airlineDatabase;
    } catch (error) {
        logger.error('Failed to load airline database from S3:', error.message);
        
        // Fallback to local file
        try {
            const localPath = path.join(__dirname, '..', 'airline_database.json');
            if (fs.existsSync(localPath)) {
                logger.info('Loading airline database from local file...');
                const fileContent = fs.readFileSync(localPath, 'utf-8');
                airlineDatabase = JSON.parse(fileContent);
                lastFetchTime = now;
                logger.info(`Successfully loaded airline database from local file. Found ${Object.keys(airlineDatabase).length} airlines.`);
                return airlineDatabase;
            }
        } catch (localErr) {
            logger.error('Failed to load from local file:', localErr.message);
        }
        
        return airlineDatabase || {}; // Return stale data or empty object
    }
}

async function getAircraftTypesDatabase(s3, bucketName) {
    const now = Date.now();
    if (aircraftTypesDatabase && (now - lastFetchTime < 24 * 60 * 60 * 1000)) {
        return aircraftTypesDatabase;
    }
    try {
        logger.info('Fetching aircraft types database from S3...');
        let data = await downloadAndParseS3File(s3, bucketName, 'aircraft_types.json');
        if (Array.isArray(data)) {
            if (data.length === 1 && typeof data[0] === 'object' && !Array.isArray(data[0])) {
                data = data[0];
            } else {
                const merged = {};
                for (const item of data) {
                    if (item && typeof item === 'object') Object.assign(merged, item);
                }
                data = merged;
            }
        }
        if (!data) {
            throw new Error("S3 file is empty or could not be parsed.");
        }
        aircraftTypesDatabase = data;
        lastFetchTime = now;
        logger.info('Successfully loaded aircraft types database from S3.');
        return aircraftTypesDatabase;
    } catch (error) {
        logger.error('CRITICAL: Failed to load aircraft types database from S3. Using stale data if available.', error);
        logger.error('Error details:', error.stack);
        return aircraftTypesDatabase || {};
    }
}

module.exports = { getAirlineDatabase, getAircraftTypesDatabase };
