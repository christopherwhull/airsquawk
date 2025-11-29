/**
 * Aircraft Types Database Module
 * 
 * Provides lookup for aircraft type information including:
 * - Manufacturer (Boeing, Airbus, etc.)
 * - Body Type (Wide/Narrow/Regional/Business)
 * - Full Model Name
 * - Engine Count
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class AircraftTypesDB {
    constructor(dbFilePath) {
        this.dbFile = dbFilePath;
        this.data = null;
        this.metadata = null;
        this.loaded = false;
    }

    /**
     * Load the aircraft types database from disk
     */
    load() {
        if (this.loaded) {
            return;
        }

        try {
            const filePath = path.resolve(this.dbFile);
            
            if (!fs.existsSync(filePath)) {
                logger.warn(`Aircraft types database not found: ${filePath}`);
                logger.info('Run: node build_aircraft_types_db.js to create the database');
                this.data = {};
                this.metadata = { count: 0 };
                return;
            }

            logger.info(`Loading aircraft types database from ${filePath}...`);
            const content = fs.readFileSync(filePath, 'utf-8');
            const db = JSON.parse(content);
            
            this.metadata = db.metadata || {};
            this.data = db.types || {};
            this.loaded = true;

            logger.info(`Aircraft types database loaded: ${Object.keys(this.data).length} types`);
            
            if (this.metadata.created) {
                logger.info(`Database created: ${this.metadata.created}`);
            }
        } catch (error) {
            logger.error(`Error loading aircraft types database: ${error.message}`);
            this.data = {};
            this.metadata = { count: 0 };
        }
    }

    /**
     * Get aircraft type information
     * 
     * @param {string} typeCode - Aircraft type code (e.g., 'B738', 'A320')
     * @returns {object|null} Type data or null if not found
     */
    lookup(typeCode) {
        if (!this.loaded) {
            this.load();
        }

        if (!typeCode) {
            return null;
        }

        // Normalize to uppercase
        const normalized = typeCode.toUpperCase().trim();
        return this.data[normalized] || null;
    }

    /**
     * Get manufacturer for a type code
     * 
     * @param {string} typeCode - Aircraft type code
     * @returns {string|null} Manufacturer or null
     */
    getManufacturer(typeCode) {
        const type = this.lookup(typeCode);
        return type ? type.manufacturer : null;
    }

    /**
     * Get body type for a type code
     * 
     * @param {string} typeCode - Aircraft type code
     * @returns {string|null} Body type or null
     */
    getBodyType(typeCode) {
        const type = this.lookup(typeCode);
        return type ? type.bodyType : null;
    }

    /**
     * Get full model name for a type code
     * 
     * @param {string} typeCode - Aircraft type code
     * @returns {string|null} Model name or null
     */
    getModel(typeCode) {
        const type = this.lookup(typeCode);
        return type ? type.model : null;
    }

    /**
     * Get engine count for a type code
     * 
     * @param {string} typeCode - Aircraft type code
     * @returns {number|null} Engine count or null
     */
    getEngineCount(typeCode) {
        const type = this.lookup(typeCode);
        return type ? type.engines : null;
    }

    /**
     * Get category for a type code
     * 
     * @param {string} typeCode - Aircraft type code
     * @returns {string|null} Category or null
     */
    getCategory(typeCode) {
        const type = this.lookup(typeCode);
        return type ? type.category : null;
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
            typeCount: Object.keys(this.data).length,
            created: this.metadata.created || 'Unknown',
            version: this.metadata.version || 'Unknown'
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

    /**
     * Get all types by manufacturer
     * 
     * @param {string} manufacturer - Manufacturer name
     * @returns {object} Object with type codes as keys
     */
    getByManufacturer(manufacturer) {
        if (!this.loaded) {
            this.load();
        }

        const results = {};
        for (const [code, data] of Object.entries(this.data)) {
            if (data.manufacturer && data.manufacturer.toLowerCase().includes(manufacturer.toLowerCase())) {
                results[code] = data;
            }
        }
        return results;
    }

    /**
     * Get all types by body type
     * 
     * @param {string} bodyType - Body type (Wide Body, Narrow Body, etc.)
     * @returns {object} Object with type codes as keys
     */
    getByBodyType(bodyType) {
        if (!this.loaded) {
            this.load();
        }

        const results = {};
        for (const [code, data] of Object.entries(this.data)) {
            if (data.bodyType && data.bodyType.toLowerCase().includes(bodyType.toLowerCase())) {
                results[code] = data;
            }
        }
        return results;
    }
}

// Create singleton instance
const aircraftTypesDB = new AircraftTypesDB(
    path.join(__dirname, '..', 'aircraft_types.json')
);

module.exports = aircraftTypesDB;
