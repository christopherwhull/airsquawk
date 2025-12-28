// lib/registration.js
/**
 * Registration lookup using S3 aircraft database
 * Loads aircraft_type_database.json from S3/MinIO for ICAO hex to registration mapping
 */

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const config = require('../config-loader');
const logger = require('./logger');

// Global cache for aircraft database
let _AIRCRAFT_DB = null;
let _DB_LOADING = false;

/**
 * Load aircraft database from S3
 */
async function _loadAircraftDatabaseFromS3() {
    if (_AIRCRAFT_DB !== null) {
        return _AIRCRAFT_DB;
    }
    
    if (_DB_LOADING) {
        // Wait for existing load to complete
        while (_DB_LOADING) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return _AIRCRAFT_DB;
    }
    
    _DB_LOADING = true;
    
    try {
        logger.info(`Attempting to load S3 aircraft database from ${config.buckets.readBucket}/aircraft_type_database.json`);
        
        const s3Client = new S3Client({
            endpoint: config.s3.endpoint,
            credentials: config.s3.credentials,
            region: config.s3.region,
            forcePathStyle: true,
        });
        
        const command = new GetObjectCommand({
            Bucket: config.buckets.readBucket,
            Key: 'aircraft_type_database.json'
        });
        
        const response = await s3Client.send(command);
        const chunks = [];
        for await (const chunk of response.Body) {
            chunks.push(chunk);
        }
        const content = Buffer.concat(chunks).toString('utf-8');
        const data = JSON.parse(content);
        
        _AIRCRAFT_DB = data.aircraft || {};
        logger.info(`Loaded S3 aircraft database with ${Object.keys(_AIRCRAFT_DB).length} entries`);
        _DB_LOADING = false;
        return _AIRCRAFT_DB;
        
    } catch (error) {
        logger.warn(`Could not load S3 aircraft database: ${error.message}`);
        _AIRCRAFT_DB = {};
        _DB_LOADING = false;
        return _AIRCRAFT_DB;
    }
}

/**
 * Convert ICAO hex code to registration using S3 aircraft database
 * @param {string} hexid - ICAO hex code
 * @returns {string|null} Registration or null if not found
 */
function registration_from_hexid(hexid) {
    if (!hexid) return null;
    
    // Synchronous fallback for immediate calls before database loads
    if (_AIRCRAFT_DB === null) {
        // Start loading in background if not already loading
        if (!_DB_LOADING) {
            _loadAircraftDatabaseFromS3().catch(err => {
                logger.warn(`Background S3 database load failed: ${err.message}`);
            });
        }
        
        // Use US N-number calculation as fallback
        try {
            const hexVal = parseInt(hexid, 16);
            if (hexVal >= 0xA00001 && hexVal <= 0xADF7C7) {
                return `N${hexVal - 0xA00000}`;
            }
        } catch (e) {
            // Invalid hex
        }
        return null;
    }
    
    // Normalize hexid to lowercase
    const hexidLower = hexid.toLowerCase();
    const entry = _AIRCRAFT_DB[hexidLower];
    
    if (entry && typeof entry === 'object') {
        return entry.registration || null;
    }
    
    // Fallback to US N-number calculation
    try {
        const hexVal = parseInt(hexid, 16);
        if (hexVal >= 0xA00001 && hexVal <= 0xADF7C7) {
            return `N${hexVal - 0xA00000}`;
        }
    } catch (e) {
        // Invalid hex
    }
    
    return null;
}

/**
 * Initialize the database by loading it immediately
 */
async function initialize() {
    logger.info('[Registration] Initializing S3 aircraft database...');
    await _loadAircraftDatabaseFromS3();
    logger.info('[Registration] Initialization complete');
}

module.exports = { 
    registration_from_hexid,
    initialize
};
