/**
 * Aircraft Database Lookup Module
 * 
 * Provides fast ICAO24 to registration/type lookups using the OpenSky aircraft database cache.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class AircraftDatabase {
    constructor(cacheFilePath) {
        this.cacheFile = cacheFilePath;
        this.data = null;
        this.metadata = null;
        this.loaded = false;
    }

    /**
     * Load the aircraft database cache from disk
     */
    load() {
        if (this.loaded) {
            return;
        }

        try {
            const filePath = path.resolve(this.cacheFile);
            
            if (!fs.existsSync(filePath)) {
                logger.warn(`Aircraft database cache not found: ${filePath}`);
                logger.info('Run: python download_opensky_db.py to create the cache');
                this.data = {};
                this.metadata = { aircraft_count: 0 };
                return;
            }

            logger.info(`Loading aircraft database from ${filePath}...`);
            const content = fs.readFileSync(filePath, 'utf-8');
            const cache = JSON.parse(content);
            
            this.metadata = cache.metadata || {};
            this.data = cache.aircraft || {};
            this.loaded = true;

            logger.info(`Aircraft database loaded: ${this.metadata.aircraft_count || Object.keys(this.data).length} aircraft`);
            
            if (this.metadata.downloaded) {
                logger.info(`Database downloaded: ${this.metadata.downloaded}`);
            }
        } catch (error) {
            logger.error(`Error loading aircraft database: ${error.message}`);
            this.data = {};
            this.metadata = { aircraft_count: 0 };
        }
    }

    /**
     * Get aircraft information by ICAO24 code
     * 
     * @param {string} icao24 - ICAO24 hex code (e.g., 'a12345')
     * @returns {object|null} Aircraft data or null if not found
     */
    lookup(icao24) {
        if (!this.loaded) {
            this.load();
        }

        if (!icao24) {
            return null;
        }

        // Normalize to lowercase
        const normalized = icao24.toLowerCase().trim();
        return this.data[normalized] || null;
    }

    /**
     * Get registration (tail number) for an ICAO24 code
     * 
     * @param {string} icao24 - ICAO24 hex code
     * @returns {string|null} Registration or null if not found
     */
    getRegistration(icao24) {
        const aircraft = this.lookup(icao24);
        return aircraft ? aircraft.registration : null;
    }

    /**
     * Get aircraft type code for an ICAO24 code
     * 
     * @param {string} icao24 - ICAO24 hex code
     * @returns {string|null} Type code or null if not found
     */
    getTypeCode(icao24) {
        const aircraft = this.lookup(icao24);
        return aircraft ? aircraft.typecode : null;
    }

    /**
     * Get full aircraft model name for an ICAO24 code
     * 
     * @param {string} icao24 - ICAO24 hex code
     * @returns {string|null} Model name or null if not found
     */
    getModel(icao24) {
        const aircraft = this.lookup(icao24);
        return aircraft ? aircraft.model : null;
    }

    /**
     * Get operator name for an ICAO24 code
     * 
     * @param {string} icao24 - ICAO24 hex code
     * @returns {string|null} Operator name or null if not found
     */
    getOperator(icao24) {
        const aircraft = this.lookup(icao24);
        return aircraft ? aircraft.operator : null;
    }

    /**
     * Get database statistics
     * 
     * @returns {object} Database metadata
     */
    getStats() {
        if (!this.loaded) {
            this.load();
        }

        return {
            loaded: this.loaded,
            aircraftCount: Object.keys(this.data).length,
            source: this.metadata.source || 'Unknown',
            downloaded: this.metadata.downloaded || 'Unknown'
        };
    }

    /**
     * Check if database is loaded and ready
     * 
     * @returns {boolean} True if loaded
     */
    isReady() {
        return this.loaded && Object.keys(this.data).length > 0;
    }
}

// Create singleton instance
const aircraftDB = new AircraftDatabase(
    path.join(__dirname, '..', 'opensky_aircraft_cache.json')
);

module.exports = aircraftDB;
