// Track Cache Service - Maintains rolling 15-minute window of aircraft positions from TSDB
const config = require('./config.json');
const axios = require('axios');
const http = require('http');
const https = require('https');

// In-memory cache for last 15 minutes of positions
const trackCache = new Map(); // hex -> array of positions
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const REFRESH_INTERVAL_MS = 60 * 1000; // Refresh every 60 seconds (reduced from 10s to reduce CPU load)

// TSDB configuration
const tsdbConfig = config.tsdb;
const TSDB_URL = tsdbConfig.url;
const TSDB_TOKEN = tsdbConfig.token;
const TSDB_DB = tsdbConfig.db;

// Statistics
let lastUpdate = null;
let totalPositions = 0;
let uniqueAircraft = 0;
let updateCount = 0;
let lastError = null;

const AGENT_OPTIONS = {
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 5,
    maxFreeSockets: 1,
    timeout: 31000
};

const axiosInflux = axios.create({
    timeout: 30000,
    httpAgent: new http.Agent(AGENT_OPTIONS),
    httpsAgent: new https.Agent(AGENT_OPTIONS)
});

async function queryInfluxDB(sql) {
    const payload = { q: sql, db: TSDB_DB };
    const url = `${TSDB_URL}/api/v3/query_sql`;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await axiosInflux.post(url, payload, {
                headers: {
                    Authorization: `Bearer ${TSDB_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error) {
            const retriable =
                error.code === 'ECONNRESET' ||
                error.code === 'ETIMEDOUT' ||
                (typeof error.message === 'string' && error.message.includes('socket hang up'));

            console.error(`[track-cache] InfluxDB query error (attempt ${attempt}/${maxAttempts}):`, error.message);
            if (!retriable || attempt === maxAttempts) {
                throw error;
            }

            const backoffMs = attempt * 500;
            await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
    }
}

async function refreshCache() {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;
    
    const startTimeISO = new Date(windowStart).toISOString();
    const endTimeISO = new Date(now).toISOString();
    
    console.log(`[track-cache] Refreshing cache from ${startTimeISO} to ${endTimeISO}`);
    
    try {
        // Query all positions from last 15 minutes
        const sqlQuery = `
            SELECT
                icao,
                flight,
                lat,
                lon,
                altitude_ft,
                speed_kt,
                heading,
                squawk,
                time
            FROM aircraft_positions_v2
            WHERE
                time >= '${startTimeISO}'
                AND time <= '${endTimeISO}'
                AND lat IS NOT NULL
                AND lon IS NOT NULL
            ORDER BY icao, time ASC
        `;
        
        const result = await queryInfluxDB(sqlQuery);
        
        if (!result || !Array.isArray(result)) {
            console.log('[track-cache] No data returned from TSDB');
            return;
        }
        
        // Clear existing cache
        trackCache.clear();
        
        // Group positions by ICAO
        for (const row of result) {
            const hex = row.icao.toLowerCase();
            
            if (!trackCache.has(hex)) {
                trackCache.set(hex, []);
            }
            
            trackCache.get(hex).push({
                lat: row.lat,
                lon: row.lon,
                altitude: row.altitude_ft || 0,
                speed: row.speed_kt || 0,
                heading: row.heading || 0,
                squawk: row.squawk || null,
                flight: row.flight || '',
                timestamp: new Date(row.time).getTime()
            });
        }
        
        // Update statistics
        totalPositions = result.length;
        uniqueAircraft = trackCache.size;
        lastUpdate = now;
        updateCount++;
        lastError = null;
        
        console.log(`[track-cache] Updated cache: ${totalPositions} positions, ${uniqueAircraft} aircraft`);
        
    } catch (error) {
        console.error('[track-cache] Error refreshing cache:', error.message);
        lastError = error.message;
    }
}

// API to get track for specific aircraft
function getTrack(hex) {
    const lowerHex = hex.toLowerCase();
    return trackCache.get(lowerHex) || [];
}

// API to get all tracks
function getAllTracks() {
    const tracks = {};
    for (const [hex, positions] of trackCache.entries()) {
        tracks[hex] = positions;
    }
    return tracks;
}

// API to get statistics
function getStats() {
    return {
        lastUpdate: lastUpdate ? new Date(lastUpdate).toISOString() : null,
        totalPositions,
        uniqueAircraft,
        updateCount,
        windowMinutes: WINDOW_MS / 60000,
        refreshIntervalSeconds: REFRESH_INTERVAL_MS / 1000,
        lastError
    };
}

// API to get latest position for each aircraft
function getLatestPositions() {
    const latest = {};
    for (const [hex, positions] of trackCache.entries()) {
        if (positions.length > 0) {
            latest[hex] = positions[positions.length - 1];
        }
    }
    return latest;
}

// Start the refresh loop
async function start() {
    console.log('[track-cache] Starting track cache service...');
    console.log(`[track-cache] Window: ${WINDOW_MS / 60000} minutes`);
    console.log(`[track-cache] Refresh interval: ${REFRESH_INTERVAL_MS / 1000} seconds`);
    
    // Initial refresh
    await refreshCache();
    
    // Set up periodic refresh
    setInterval(refreshCache, REFRESH_INTERVAL_MS);
    
    console.log('[track-cache] Service started');
}

module.exports = {
    start,
    getTrack,
    getAllTracks,
    getLatestPositions,
    getStats
};

// If run directly, start the service
if (require.main === module) {
    start().catch(console.error);
}
