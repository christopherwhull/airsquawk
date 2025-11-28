const { listS3Files, downloadAndParseS3File } = require('./s3-helpers');
const logger = require('./logger');

/**
 * Position Cache Manager
 * Maintains an in-memory cache of all position data for the last 7 days
 * Refreshes periodically in the background
 */
class PositionCache {
    constructor(s3, buckets = {}) {
        this.s3 = s3;
        this.readBucket = buckets.read || 'aircraft-data';
        this.writeBucket = buckets.write || 'aircraft-data-new';
        
        // Cache storage: array of position records
        this.positions = [];
        this.positionsByHex = {}; // Index by ICAO hex for fast lookup
        
        // Cache metadata
        this.lastRefresh = 0;
        this.refreshInterval = 5 * 60 * 1000; // 5 minutes
        this.isRefreshing = false;
        
        // Retention
        this.retentionMs = 7 * 24 * 60 * 60 * 1000; // 7 days
        
        // Start background refresh
        this._startBackgroundRefresh();
    }
    
    /**
     * Load all position data from S3 for the last 7 days
     */
    async loadAllPositions() {
        if (this.isRefreshing) {
            logger.info('[PositionCache] Already refreshing, skipping...');
            return this.positions;
        }
        
        this.isRefreshing = true;
        const startTime = Date.now();
        
        try {
            const now = Date.now();
            const cutoff = now - this.retentionMs;
            
            logger.info(`[PositionCache] Loading positions from last 7 days (cutoff: ${new Date(cutoff).toISOString()})`);
            
            const allPositions = [];
            
            // Load from both buckets
            for (const bucket of [this.readBucket, this.writeBucket]) {
                try {
                    // Load minute files first page (most recent files)
                    const s3Files = await listS3Files(this.s3, bucket, 'data/piaware_aircraft_log', 1000, 10);
                    
                    const minuteFiles = (s3Files || [])
                        .filter(f => f.Key && f.Key.includes('piaware_aircraft_log'))
                        .sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
                    
                    logger.info(`[PositionCache] Processing ${minuteFiles.length} minute files from ${bucket}`);
                    
                    for (const file of minuteFiles) {
                        try {
                            const records = await downloadAndParseS3File(this.s3, bucket, file.Key);
                            if (!Array.isArray(records)) continue;
                            
                            for (const rec of records) {
                                if (!rec.lat || !rec.lon || typeof rec.lat !== 'number' || typeof rec.lon !== 'number') continue;
                                
                                // Use timestamp from record or file modification time
                                let timestamp = rec.timestamp;
                                if (typeof timestamp === 'string') {
                                    timestamp = new Date(timestamp).getTime();
                                } else if (typeof timestamp !== 'number') {
                                    timestamp = new Date(file.LastModified).getTime();
                                }
                                
                                // Filter by age
                                if (timestamp < cutoff) continue;
                                
                                allPositions.push({
                                    hex: rec.hex || rec.ICAO,
                                    callsign: rec.callsign || rec.flight || '',
                                    lat: rec.lat,
                                    lon: rec.lon,
                                    alt: rec.alt || rec.altitude || 0,
                                    gs: rec.gs || rec.ground_speed || 0,
                                    timestamp: timestamp,
                                    rssi: rec.rssi || null,
                                    squawk: rec.squawk || null
                                });
                            }
                        } catch (err) {
                            logger.error(`[PositionCache] Error processing ${file.Key}: ${err.message}`);
                        }
                    }
                } catch (err) {
                    logger.error(`[PositionCache] Error loading from bucket ${bucket}: ${err.message}`);
                }
            }
            
            // Sort by timestamp (newest first) and deduplicate
            allPositions.sort((a, b) => b.timestamp - a.timestamp);
            
            // Deduplicate: keep only unique timestamp+hex combinations (keep first/newest)
            const seen = new Set();
            const deduplicated = [];
            for (const pos of allPositions) {
                const key = `${pos.hex}:${pos.timestamp}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    deduplicated.push(pos);
                }
            }
            
            // Build index by hex
            this.positionsByHex = {};
            for (const pos of deduplicated) {
                if (!this.positionsByHex[pos.hex]) {
                    this.positionsByHex[pos.hex] = [];
                }
                this.positionsByHex[pos.hex].push(pos);
            }
            
            this.positions = deduplicated;
            this.lastRefresh = now;
            
            const duration = Date.now() - startTime;
            logger.info(`[PositionCache] Loaded ${this.positions.length} unique positions in ${duration}ms`);
            
            return this.positions;
        } catch (err) {
            logger.error(`[PositionCache] Error loading positions: ${err.message}`, err);
            return this.positions; // Return existing cache on error
        } finally {
            this.isRefreshing = false;
        }
    }
    
    /**
     * Get all positions (from cache)
     */
    getPositions(filterFn = null) {
        if (filterFn) {
            return this.positions.filter(filterFn);
        }
        return this.positions;
    }
    
    /**
     * Get positions for a specific aircraft
     */
    getAircraftPositions(hex) {
        return this.positionsByHex[hex] || [];
    }
    
    /**
     * Get positions within a time window
     */
    getPositionsByTimeWindow(hours) {
        const cutoff = Date.now() - (hours * 60 * 60 * 1000);
        return this.positions.filter(p => p.timestamp >= cutoff);
    }
    
    /**
     * Get positions within a geographic bounding box
     */
    getPositionsByBounds(minLat, maxLat, minLon, maxLon) {
        return this.positions.filter(p => 
            p.lat >= minLat && p.lat <= maxLat && 
            p.lon >= minLon && p.lon <= maxLon
        );
    }
    
    /**
     * Get cache statistics
     */
    getStats() {
        const now = Date.now();
        const ages = this.positions.map(p => now - p.timestamp);
        const oldestAge = ages.length > 0 ? Math.max(...ages) : 0;
        
        return {
            totalPositions: this.positions.length,
            uniqueAircraft: Object.keys(this.positionsByHex).length,
            oldestPositionAge: oldestAge,
            oldestPositionDate: new Date(now - oldestAge).toISOString(),
            lastRefresh: new Date(this.lastRefresh).toISOString(),
            cacheMemoryMb: (JSON.stringify(this.positions).length / 1024 / 1024).toFixed(2)
        };
    }
    
    /**
     * Start background refresh
     */
    _startBackgroundRefresh() {
        setInterval(async () => {
            try {
                logger.debug('[PositionCache] Background refresh starting...');
                await this.loadAllPositions();
                logger.debug('[PositionCache] Background refresh completed');
            } catch (err) {
                logger.error('[PositionCache] Background refresh error:', err.message);
            }
        }, this.refreshInterval);
        
        // Initial load
        this.loadAllPositions().catch(err => logger.error('[PositionCache] Initial load error:', err.message));
    }
    
    /**
     * Force immediate refresh
     */
    async refresh() {
        return this.loadAllPositions();
    }
    
    /**
     * Clear cache
     */
    clear() {
        this.positions = [];
        this.positionsByHex = {};
        logger.info('[PositionCache] Cache cleared');
    }
}

module.exports = PositionCache;
