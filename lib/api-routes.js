const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { listS3Files, downloadAndParseS3File } = require('./s3-helpers');
const { registration_from_hexid } = require('./registration');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const TSDB_REQUEST_TIMEOUT_MS = 15000;

// Helper function to extract timestamp from S3 filename
function extractTimestampFromFilename(filename) {
    // Expected formats:
    // data/piaware_aircraft_log_20251201_0600.json
    // data/piaware_aircraft_log_20251201_0601.json
    // hourly_20251201_06.json
    // positions_20251201_06.json

    const timestampMatch = filename.match(/(\d{8})_(\d{2})(\d{2})?\.json$/);
    if (timestampMatch) {
        const dateStr = timestampMatch[1]; // YYYYMMDD
        const hourStr = timestampMatch[2]; // HH
        const minuteStr = timestampMatch[3] || '00'; // MM (optional)

        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(4, 6)) - 1; // JS months are 0-based
        const day = parseInt(dateStr.substring(6, 8));
        const hour = parseInt(hourStr);
        const minute = parseInt(minuteStr);

        return new Date(Date.UTC(year, month, day, hour, minute)).getTime();
    }
    return null;
}

// Helper function to calculate distance between two lat/lon points in nautical miles
function calculateDistanceNM(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distanceKm = R * c;
    // Convert km to nautical miles (1 NM = 1.852 km)
    return distanceKm / 1.852;
}

// Helper function to filter track points by minimum distance
function filterTrackByDistance(points, minDistanceNM) {
    if (points.length <= 1) return points;

    const filtered = [points[0]]; // Always include the first point

    for (let i = 1; i < points.length; i++) {
        const lastIncluded = filtered[filtered.length - 1];
        const current = points[i];

        // Skip points without valid coordinates
        if (!current.lat || !current.lon || !lastIncluded.lat || !lastIncluded.lon) {
            filtered.push(current);
            continue;
        }

        const distance = calculateDistanceNM(lastIncluded.lat, lastIncluded.lon, current.lat, current.lon);

        // Include point if it's far enough from the last included point
        if (distance >= minDistanceNM) {
            filtered.push(current);
        }
    }

    return filtered;
}

// Function to check if any server files have been modified after server start
function checkServerFilesModified() {
    const serverFiles = [
        'server.js',
        'lib/api-routes.js',
        'lib/s3-helpers.js',
        'lib/logger.js',
        'lib/databases.js'
    ];

    for (const file of serverFiles) {
        try {
            const filePath = path.join(__dirname, '..', file);
            const stats = fs.statSync(filePath);
            if (stats.mtime.getTime() > serverStartTs) {
                return true; // File was modified after server started
            }
        } catch (err) {
            // File doesn't exist or can't be read, continue checking others
            continue;
        }
    }
    return false; // No files modified after server start
}

// Server startup metadata (calculated at module load)
let serverStartTs = Date.now();
let serverStartIso = new Date(serverStartTs).toISOString();
let serverGitCommit = '';
let serverGitDirty = false;
// Allow tests and environments to override git status via env vars
if (process.env.GIT_COMMIT_OVERRIDE) {
    serverGitCommit = process.env.GIT_COMMIT_OVERRIDE;
    serverGitDirty = (process.env.GIT_DIRTY_OVERRIDE && process.env.GIT_DIRTY_OVERRIDE.toLowerCase() === 'true') || false;
} else if (process.env.NODE_ENV === 'test') {
    // In tests, default to non-dirty test commit to avoid flakiness
    serverGitCommit = 'test';
    serverGitDirty = false;
} else {
    try {
        serverGitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
        const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
        serverGitDirty = status.length > 0;
    } catch (err) {
        // If git is not available or error occurs, leave empty and continue
        serverGitCommit = '';
        serverGitDirty = false;
    }
}
const { getAirlineDatabase } = require('./databases');
const { computeAirlineStatsData, computeSquawkTransitionsData, computeSquawkTransitionsDataByTimeRange, computeHistoricalStatsData, getAircraftPositionsInTimeRange } = require('./aggregators');
const aircraftDB = require('./aircraft-database');

// Function to query InfluxDB using SQL
async function queryInfluxDB(sqlQuery) {
    return new Promise((resolve, reject) => {
        const config = require('../config.json');
        const tsdbConfig = config.tsdb;

        if (!tsdbConfig || !tsdbConfig.url || !tsdbConfig.db) {
            reject(new Error('InfluxDB configuration not found in config.json'));
            return;
        }

        const url = `${tsdbConfig.url}/api/v3/query_sql`;

        // Use http or https based on the URL protocol
        const isHttps = tsdbConfig.url.startsWith('https://');
        const httpModule = isHttps ? https : http;

        const payload = {
            db: tsdbConfig.db,
            format: 'json',
            q: sqlQuery
        };

        const postData = JSON.stringify(payload);

        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'Connection': 'close'
        };

        // Only add Authorization header if token is provided
        if (tsdbConfig.token) {
            headers['Authorization'] = `Bearer ${tsdbConfig.token}`;
        }

        const timeoutMs = tsdbConfig.timeoutMs || TSDB_REQUEST_TIMEOUT_MS;
        const options = {
            method: 'POST',
            headers,
            agent: new (isHttps ? https : http).Agent({ keepAlive: false }),
            timeout: timeoutMs
        };

        const req = httpModule.request(url, options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const result = JSON.parse(data);
                        resolve(result);
                    } catch (parseError) {
                        reject(new Error(`Failed to parse InfluxDB response: ${parseError.message}`));
                    }
                } else {
                    reject(new Error(`InfluxDB query failed with status ${res.statusCode}: ${data}`));
                }
            });
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`InfluxDB request timeout after ${timeoutMs} ms`));
        });

        req.on('error', (error) => {
            reject(new Error(`InfluxDB request failed: ${error.message}`));
        });

        try {
            req.write(postData);
            req.end();
        } catch (writeErr) {
            reject(new Error(`InfluxDB request failed: ${writeErr.message}`));
        }
    });
}
const aircraftTypesDB = require('./aircraft-types-db');

// Simple LRU Cache implementation
class LRUCache {
    constructor(maxSize = 1000, ttlMs = 60000) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        if (Date.now() - item.timestamp > this.ttlMs) {
            this.cache.delete(key);
            return null;
        }
        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, item);
        return item.value;
    }

    set(key, value) {
        // Remove oldest if at capacity
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, { value, timestamp: Date.now() });
    }

    clear() {
        this.cache.clear();
    }
}

let aircraftCache = null;
let heatmapCache = new Map();
let allHeatmapPositions = null;
let heatmapPositionsLastLoaded = null;
let heatmapLoadInProgress = false;

// In-memory ICAO index for fast flight lookups
let icaoFlightIndex = new Map(); // Map<icao_lower, { flight, positions, lastUpdate }>
let icaoIndexLastLoaded = null;
let flightApiCache = new LRUCache(500, 30000); // 500 items, 30s TTL

// Helper to clear cache
function clearHeatmapCache() {
    heatmapCache.clear();
    allHeatmapPositions = null; // Also clear positions cache
    heatmapPositionsLastLoaded = null;
    console.log('[heatmap] Cache cleared');
}

// Load in-memory ICAO index from recent hourly flight files
async function loadIcaoFlightIndex(s3, readBucket, writeBucket) {
    const startTime = Date.now();
    console.log('[icao-index] Loading in-memory ICAO index from recent hourly files...');
    
    try {
        const now = Date.now();
        const cutoff = now - (4 * 60 * 60 * 1000); // Last 4 hours
        
        // List hourly flight files
        const allFiles = await listS3Files(s3, writeBucket || readBucket, 'flights/hourly/');
        
        // Filter to recent files by parsing timestamps from filenames
        const recentFiles = allFiles.filter(f => {
            const ts = extractTimestampFromFilename(f.Key);
            return ts && ts >= cutoff;
        }).sort((a, b) => {
            const tsA = extractTimestampFromFilename(a.Key) || 0;
            const tsB = extractTimestampFromFilename(b.Key) || 0;
            return tsB - tsA; // Most recent first
        });
        
        console.log(`[icao-index] Found ${recentFiles.length} recent hourly flight files (last 4h)`);
        
        const newIndex = new Map();
        let totalFlights = 0;
        
        // Load up to 8 most recent files (2 hours worth if saved every 15 min)
        const filesToLoad = recentFiles.slice(0, 8);
        
        for (const file of filesToLoad) {
            try {
                const data = await downloadAndParseS3File(s3, writeBucket || readBucket, file.Key);
                if (!data) continue;
                
                const flights = data.flights || [];
                const active = data.active || [];
                
                [...flights, ...active].forEach(flt => {
                    if (!flt.icao) return;
                    const icaoLower = flt.icao.toLowerCase();
                    
                    // Store flight metadata for quick lookup
                    if (!newIndex.has(icaoLower)) {
                        newIndex.set(icaoLower, {
                            icao: flt.icao,
                            callsign: flt.callsign || '',
                            registration: flt.registration || '',
                            type: flt.type || '',
                            start_time: flt.start_time,
                            end_time: flt.end_time,
                            lastUpdate: Date.now()
                        });
                        totalFlights++;
                    }
                });
            } catch (err) {
                console.warn(`[icao-index] Failed to load ${file.Key}:`, err.message);
            }
        }
        
        icaoFlightIndex = newIndex;
        icaoIndexLastLoaded = Date.now();
        
        const elapsed = Date.now() - startTime;
        console.log(`[icao-index] ✓ Loaded ${totalFlights} unique aircraft in ${elapsed}ms`);
        
        return newIndex;
    } catch (err) {
        console.error('[icao-index] Error loading index:', err);
        return new Map();
    }
}

async function loadAircraftCache() {
    if (aircraftCache) return aircraftCache;
    try {
        const fs = require('fs').promises;
        const data = await fs.readFile('opensky_aircraft_cache.json', 'utf8');
        aircraftCache = JSON.parse(data);
        const aircraftCount = Object.keys(aircraftCache.aircraft || {}).length;
        console.log('✓ Loaded aircraft cache with', aircraftCount, 'entries');
        return aircraftCache;
    } catch (error) {
        console.error('✗ Error loading aircraft cache:', error.message);
        return {};
    }
}

async function loadRecentHeatmapPositions(s3, readBucket, writeBucket, cutoffTimestamp) {
    console.log(`Loading recent heatmap positions (since ${new Date(cutoffTimestamp).toISOString()})...`);
    const startTime = Date.now();

    // Load aircraft cache first
    await loadAircraftCache();

    // Only load minute files (most recent data) - not hourly files
    const minuteFiles = await listS3Files(s3, readBucket, 'data/piaware_aircraft_log');
    console.log(`Found ${minuteFiles.length} minute files to check for recent data.`);

    const recentPositions = [];
    let totalRecords = 0;

    // Sort files by name (most recent first)
    const sortedFiles = [...minuteFiles].sort((a, b) => b.Key.localeCompare(a.Key));

    for (const file of sortedFiles) {
        try {
            // Check if file is recent enough by parsing filename timestamp
            const fileTimestamp = extractTimestampFromFilename(file.Key);
            if (fileTimestamp && fileTimestamp < cutoffTimestamp) {
                // File is too old, skip it
                continue;
            }

            const records = await downloadAndParseS3File(s3, readBucket, file.Key);
            totalRecords += records.length;

            for (const record of records) {
                // Only include records newer than cutoff
                const recordTimestamp = record.Timestamp || record.First_Seen || record.Last_Seen || record.firstSeen || record.lastSeen;
                if (recordTimestamp && recordTimestamp < cutoffTimestamp) {
                    continue; // Skip old records
                }

                // Normalize keys
                const icao = record.ICAO || record.hex || record.icao;
                const lat = record.Latitude || record.lat;
                const lon = record.Longitude || record.lon;
                const flight = record.Flight || record.Ident || record.flight;
                const registration = record.Registration || record.registration;

                // Enrich with aircraft database data
                const aircraft = aircraftCache.aircraft ? aircraftCache.aircraft[icao] : null;
                if (aircraft && aircraft.typecode) {
                    record.Aircraft_type = aircraft.typecode;
                }

                // Enrich with type info
                if (record.Aircraft_type && record.Aircraft_type !== 'N/A') {
                    const typeInfo = aircraftTypesDB.lookup(record.Aircraft_type);
                    if (typeInfo) {
                        record.manufacturer = typeInfo.manufacturer;
                        record.bodyType = typeInfo.bodyType;
                    }
                }

                if (lat && lon && typeof lat === 'number' && typeof lon === 'number') {
                    recentPositions.push({
                        lat,
                        lon,
                        timestamp: recordTimestamp,
                        hex: icao,
                        Aircraft_type: record.Aircraft_type,
                        aircraft_type: record.Aircraft_type,
                        Flight: flight,
                        manufacturer: record.manufacturer,
                        bodyType: record.bodyType,
                        ICAO: icao,
                        Registration: registration
                    });
                }
            }

            // Limit to prevent excessive memory usage
            if (recentPositions.length > 50000) {
                console.log(`Reached position limit (50k), stopping early`);
                break;
            }

        } catch (error) {
            console.warn(`Error loading recent file ${file.Key}:`, error.message);
        }
    }

    const loadTime = Date.now() - startTime;
    console.log(`Loaded ${recentPositions.length} recent positions from ${totalRecords} records in ${loadTime}ms`);
    return recentPositions;
}

// Function to query heatmap data from TSDB
async function queryHeatmapFromTSDB(hours = 24, gridSizeNm = 1) {
    try {
        // Load TSDB configuration
        const configPath = path.join(__dirname, '..', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const tsdbConfig = config.tsdb;

        if (!tsdbConfig || !tsdbConfig.url || !tsdbConfig.token) {
            throw new Error('TSDB configuration not found or incomplete');
        }

        // Build SQL query based on the tools/plot_heatmap.py pattern
        const query = `
        WITH grid_params AS (
            SELECT ${gridSizeNm} * 1.852 / 111.0 AS grid_size
        ),
        time_filtered AS (
            SELECT
                lat,
                lon,
                icao,
                time,
                flight
            FROM ${tsdbConfig.tsdb_measurement || 'aircraft_positions_v2'}
            WHERE time >= NOW() - INTERVAL '${hours} hours'
              AND lat IS NOT NULL
              AND lon IS NOT NULL
        ),
        grid_aggregated AS (
            SELECT
                FLOOR(lat / (SELECT grid_size FROM grid_params)) AS lat_idx,
                FLOOR(lon / (SELECT grid_size FROM grid_params)) AS lon_idx,
                COUNT(*) AS count
            FROM time_filtered
            GROUP BY
                FLOOR(lat / (SELECT grid_size FROM grid_params)),
                FLOOR(lon / (SELECT grid_size FROM grid_params))
        )
        SELECT
            lat_idx * (SELECT grid_size FROM grid_params) AS lat_min,
            (lat_idx + 1) * (SELECT grid_size FROM grid_params) AS lat_max,
            lon_idx * (SELECT grid_size FROM grid_params) AS lon_min,
            (lon_idx + 1) * (SELECT grid_size FROM grid_params) AS lon_max,
            count
        FROM grid_aggregated
        WHERE count >= 1
        ORDER BY count DESC
        `;

        const url = `${tsdbConfig.url}/api/v3/query_sql`;
        const payload = {
            db: tsdbConfig.db,
            format: 'json',
            q: query.trim()
        };

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tsdbConfig.token}`,
            'Connection': 'close'
        };

        return new Promise((resolve, reject) => {
            const isHttps = tsdbConfig.url.startsWith('https:');
            const protocol = isHttps ? https : http;
            const timeoutMs = tsdbConfig.timeoutMs || TSDB_REQUEST_TIMEOUT_MS;
            const req = protocol.request(url, {
                method: 'POST',
                headers,
                agent: new (isHttps ? https : http).Agent({ keepAlive: false }),
                timeout: timeoutMs
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            const result = JSON.parse(data);
                            resolve(result);
                        } else {
                            reject(new Error(`TSDB query failed: ${res.statusCode} - ${data}`));
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse TSDB response: ${e.message}`));
                    }
                });
            });

            req.setTimeout(timeoutMs, () => {
                req.destroy(new Error(`TSDB request timeout after ${timeoutMs} ms`));
            });

            req.on('error', (err) => {
                reject(new Error(`TSDB request failed: ${err.message}`));
            });

            try {
                req.write(JSON.stringify(payload));
                req.end();
            } catch (writeErr) {
                reject(new Error(`TSDB request failed: ${writeErr.message}`));
            }
        });

    } catch (error) {
        console.error('Error querying heatmap from TSDB:', error);
        throw error;
    }
}

async function queryPositionsFromTSDB(hours = 24) {
    try {
        // Load TSDB configuration
        const configPath = path.join(__dirname, '..', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const tsdbConfig = config.tsdb;

        if (!tsdbConfig || !tsdbConfig.url || !tsdbConfig.token) {
            throw new Error('TSDB configuration not found or incomplete');
        }

        // Build SQL query for positions
        const query = `
        SELECT
            time,
            icao,
            lat,
            lon,
            flight
        FROM ${tsdbConfig.tsdb_measurement || 'aircraft_positions_v2'}
        WHERE time >= NOW() - INTERVAL '${hours} hours'
          AND lat IS NOT NULL
          AND lon IS NOT NULL
          AND icao IS NOT NULL
        ORDER BY time DESC
        LIMIT 50000
        `;

        const url = `${tsdbConfig.url}/api/v3/query_sql`;
        const payload = {
            db: tsdbConfig.db,
            format: 'json',
            q: query.trim()
        };

        const positions = await new Promise((resolve, reject) => {
            const isHttps = url.startsWith('https://');
            const httpModule = isHttps ? https : http;
            const agent = isHttps ? new https.Agent({ keepAlive: false }) : new http.Agent({ keepAlive: false });
            const timeoutMs = tsdbConfig.timeoutMs || TSDB_REQUEST_TIMEOUT_MS;
            const req = httpModule.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tsdbConfig.token}`,
                    'Connection': 'close'
                },
                agent,
                timeout: timeoutMs
            });

            req.setTimeout(timeoutMs, () => {
                req.destroy(new Error(`TSDB request timeout after ${timeoutMs} ms`));
            });

            let data = '';
            req.on('response', (res) => {
                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            const result = JSON.parse(data);
                            // Transform TSDB result to position format
                            const positions = result.map(row => ({
                                timestamp: typeof row.time === 'number' ? row.time / 1000000 : new Date(row.time).getTime(),
                                icao: row.icao,
                                lat: parseFloat(row.lat),
                                lon: parseFloat(row.lon),
                                flight: row.flight,
                                hex: row.icao // Use ICAO as hex for compatibility
                            }));
                            resolve(positions);
                        } else {
                            reject(new Error(`TSDB query failed: ${res.statusCode} - ${data}`));
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse TSDB response: ${e.message}`));
                    }
                });
            });

            req.on('error', (err) => {
                reject(new Error(`TSDB request failed: ${err.message}`));
            });

            try {
                req.write(JSON.stringify(payload));
                req.end();
            } catch (writeErr) {
                reject(new Error(`TSDB request failed: ${writeErr.message}`));
            }
        });

        return positions;

    } catch (error) {
        console.error('Error querying positions from TSDB:', error);
        throw error;
    }
}

// Function to reconstruct flights from TSDB position data
async function reconstructFlightsFromTSDB(hours = 24, timeCutoff, options = {}) {
    try {
        const airlineDatabase = options.airlineDatabase || {};
        // Load TSDB configuration
        const configPath = path.join(__dirname, '..', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const tsdbConfig = config.tsdb;

        if (!tsdbConfig || !tsdbConfig.url || !tsdbConfig.token) {
            throw new Error('TSDB configuration not found or incomplete');
        }

        // Query TSDB for position data with flight information
        const query = `
        SELECT
            time,
            icao,
            flight,
            lat,
            lon,
            altitude_ft,
            speed_kt,
            heading,
            registration,
            type
        FROM ${tsdbConfig.tsdb_measurement || 'aircraft_positions_v2'}
        WHERE time >= NOW() - INTERVAL '${hours} hours'
          AND flight IS NOT NULL
          AND icao IS NOT NULL
        ORDER BY icao, flight, time ASC
        `;

        const url = `${tsdbConfig.url}/api/v3/query_sql`;
        const payload = {
            db: tsdbConfig.db,
            format: 'json',
            q: query.trim()
        };

        const tsdbData = await new Promise((resolve, reject) => {
            const isHttps = url.startsWith('https://');
            const httpModule = isHttps ? https : http;
            const agent = isHttps ? new https.Agent({ keepAlive: false }) : new http.Agent({ keepAlive: false });
            const timeoutMs = tsdbConfig.timeoutMs || TSDB_REQUEST_TIMEOUT_MS;
            const req = httpModule.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tsdbConfig.token}`,
                    'Connection': 'close'
                },
                agent,
                timeout: timeoutMs
            });

            req.setTimeout(timeoutMs, () => {
                req.destroy(new Error(`TSDB request timeout after ${timeoutMs} ms`));
            });

            let data = '';
            req.on('response', (res) => {
                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const result = JSON.parse(data);
                        resolve(result);
                    } catch (parseError) {
                        reject(new Error(`Failed to parse TSDB response: ${parseError.message}`));
                    }
                });
            });

            req.on('error', (err) => {
                reject(new Error(`TSDB request failed: ${err.message}`));
            });

            try {
                req.write(JSON.stringify(payload));
                req.end();
            } catch (writeErr) {
                reject(new Error(`TSDB request failed: ${writeErr.message}`));
            }
        });

        // Process TSDB data to reconstruct flights
        const flights = [];
        const flightGroups = new Map();

        // Group positions by ICAO + flight combination
        for (const row of tsdbData || []) {
            const icao = (row.icao || '').toLowerCase();
            const flight = (row.flight || '').toUpperCase().trim();
            
            if (!icao || !flight) continue;
            
            const key = `${icao}|${flight}`;
            if (!flightGroups.has(key)) {
                flightGroups.set(key, {
                    icao,
                    callsign: flight,
                    positions: [],
                    start_time: null,
                    end_time: null,
                    registration: null,
                    type: null,
                    max_altitude: 0,
                    max_speed: 0
                });
            }
            
            const group = flightGroups.get(key);
            const timestamp = new Date(row.time).getTime();
            
            // Track time range
            if (!group.start_time || timestamp < group.start_time) {
                group.start_time = timestamp;
            }
            if (!group.end_time || timestamp > group.end_time) {
                group.end_time = timestamp;
            }
            
            // Track max values
            if (row.altitude_ft && row.altitude_ft > group.max_altitude) {
                group.max_altitude = row.altitude_ft;
            }
            if (row.speed_kt && row.speed_kt > group.max_speed) {
                group.max_speed = row.speed_kt;
            }
            
            // Store registration and type (take first non-null values)
            if (!group.registration && row.registration) {
                group.registration = row.registration;
            }
            if (!group.type && row.type) {
                group.type = row.type;
            }
            
            // Store position for gap analysis
            group.positions.push({
                timestamp,
                lat: row.lat,
                lon: row.lon
            });
        }

        // Convert groups to flight objects
        for (const [key, group] of flightGroups) {
            // Calculate flight duration and check for gaps
            const duration = group.end_time - group.start_time;
            const positionCount = group.positions.length;
            
            // Simple gap detection: if positions are too spread out, it might not be a continuous flight
            // For now, include all flights with at least 2 positions and reasonable duration
            if (positionCount >= 2 && duration > 60000) { // At least 1 minute
                if (typeof timeCutoff === 'number') {
                    const startsAfterCutoff = group.start_time >= timeCutoff;
                    const endsAfterCutoff = group.end_time >= timeCutoff;
                    if (!startsAfterCutoff && !endsAfterCutoff) {
                        continue;
                    }
                }

                const validPositions = group.positions.filter(pos => Number.isFinite(pos.lat) && Number.isFinite(pos.lon));
                const firstPosition = validPositions[0] || null;
                const lastPosition = validPositions[validPositions.length - 1] || firstPosition || null;
                const durationMinutes = duration > 0 ? duration / 60000 : 0;

                const flight = {
                    icao: group.icao,
                    callsign: group.callsign,
                    start_time: new Date(group.start_time).toISOString(),
                    end_time: new Date(group.end_time).toISOString(),
                    start_ts: group.start_time,
                    end_ts: group.end_time,
                    duration_seconds: Math.floor(duration / 1000),
                    duration_min: Number(durationMinutes.toFixed(2)),
                    position_count: positionCount,
                    reports: positionCount,
                    registration: group.registration || 'N/A',
                    type: group.type || 'N/A',
                    max_alt_ft: group.max_altitude || null,
                    max_altitude_ft: group.max_altitude || null,
                    max_speed_kt: group.max_speed || null,
                    start_lat: firstPosition ? firstPosition.lat : null,
                    start_lon: firstPosition ? firstPosition.lon : null,
                    end_lat: lastPosition ? lastPosition.lat : null,
                    end_lon: lastPosition ? lastPosition.lon : null
                };

                enrichFlightRecordFromDatabases(flight, airlineDatabase);
                flights.push(flight);
            }
        }

        return flights;

    } catch (error) {
        console.error('Error reconstructing flights from TSDB:', error);
        throw error;
    }
}

function enrichFlightRecordFromDatabases(flight, airlineDatabase = {}) {
    if (!flight || typeof flight !== 'object') {
        return;
    }

    const callsign = (flight.callsign || '').trim();
    const isTailNumber = /^N\d{1,5}[A-Z]{0,2}$/i.test(callsign);

    if (!flight.airline_code && callsign && !isTailNumber) {
        const match = callsign.match(/^([A-Z]{2,3})/i);
        if (match) {
            flight.airline_code = match[1].toUpperCase();
        }
    }

    if (flight.airline_code) {
        const dbEntry = airlineDatabase[flight.airline_code];
        if (dbEntry) {
            if (!flight.airline_name) {
                flight.airline_name = typeof dbEntry === 'string' ? dbEntry : (dbEntry.name || flight.airline_code);
            }
            if (!flight.airlineLogo && typeof dbEntry === 'object' && dbEntry.logo) {
                flight.airlineLogo = dbEntry.logo;
            }
        }
    }

    if (flight.icao) {
        const aircraftData = aircraftDB.lookup(flight.icao);
        if (aircraftData) {
            if ((!flight.registration || flight.registration === 'N/A') && aircraftData.registration && aircraftData.registration !== 'N/A') {
                flight.registration = aircraftData.registration;
            }
            if ((!flight.type || flight.type === 'N/A') && aircraftData.typecode && aircraftData.typecode !== 'N/A') {
                flight.type = aircraftData.typecode;
            }
            if (!flight.aircraft_model && aircraftData.model) {
                flight.aircraft_model = aircraftData.model;
            }
        }

        if ((!flight.registration || flight.registration === 'N/A')) {
            const lookupReg = registration_from_hexid(flight.icao);
            if (lookupReg && lookupReg !== 'N/A') {
                flight.registration = lookupReg;
            }
        }
    }

    if ((!flight.registration || flight.registration === 'N/A') && isTailNumber) {
        flight.registration = callsign.toUpperCase();
    }

    if (flight.type && flight.type !== 'N/A') {
        const typeInfo = aircraftTypesDB.lookup(flight.type);
        if (typeInfo) {
            if (!flight.manufacturer && typeInfo.manufacturer) {
                flight.manufacturer = typeInfo.manufacturer;
            }
            if (!flight.bodyType && typeInfo.bodyType) {
                flight.bodyType = typeInfo.bodyType;
            }
            if (!flight.aircraft_model && typeInfo.model) {
                flight.aircraft_model = typeInfo.model;
            }
            if (!flight.manufacturerLogo && typeInfo.manufacturerLogo) {
                flight.manufacturerLogo = typeInfo.manufacturerLogo;
            }
        }
    }
}

// Function to query positions per hour per receiver from TSDB
async function queryPositionsPerHourPerReceiver(hours = 24) {
    try {
        // Load TSDB configuration
        const configPath = path.join(__dirname, '..', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const tsdbConfig = config.tsdb;

        if (!tsdbConfig || !tsdbConfig.url) {
            throw new Error('TSDB configuration not found or incomplete');
        }

        // Build SQL query to aggregate positions by hour and receiver
        const query = `
        SELECT
            DATE_BIN(INTERVAL '1 hour', time) AS hour_bucket,
            receiver_id,
            COUNT(*) AS position_count
        FROM ${tsdbConfig.tsdb_measurement || 'aircraft_positions_v2'}
        WHERE time >= NOW() - INTERVAL '${hours} hours'
          AND receiver_id IS NOT NULL
          AND lat IS NOT NULL
          AND lon IS NOT NULL
        GROUP BY
            DATE_BIN(INTERVAL '1 hour', time),
            receiver_id
        ORDER BY
            hour_bucket ASC,
            receiver_id ASC
        `;

        const url = `${tsdbConfig.url}/api/v3/query_sql`;
        const payload = {
            db: tsdbConfig.db,
            format: 'json',
            q: query.trim()
        };

        return new Promise((resolve, reject) => {
            const isHttps = tsdbConfig.url.startsWith('https:');
            const protocol = isHttps ? https : http;
            const headers = {
                'Content-Type': 'application/json',
                'Connection': 'close'
            };
            const timeoutMs = tsdbConfig.timeoutMs || TSDB_REQUEST_TIMEOUT_MS;
            
            // Only add Authorization header if token is provided
            if (tsdbConfig.token) {
                headers['Authorization'] = `Bearer ${tsdbConfig.token}`;
            }
            
            const req = protocol.request(url, {
                method: 'POST',
                headers,
                agent: new (isHttps ? https : http).Agent({ keepAlive: false }),
                timeout: timeoutMs
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            const result = JSON.parse(data);
                            // Transform the result to a more usable format
                            const transformed = result.map(row => ({
                                hour: new Date(row.hour_bucket).getTime(),
                                receiver_id: row.receiver_id,
                                position_count: parseInt(row.position_count)
                            }));
                            resolve(transformed);
                        } else {
                            reject(new Error(`TSDB query failed: ${res.statusCode} - ${data}`));
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse TSDB response: ${e.message}`));
                    }
                });
            });

            req.setTimeout(timeoutMs, () => {
                req.destroy(new Error(`TSDB request timeout after ${timeoutMs} ms`));
            });

            req.on('error', (err) => {
                reject(new Error(`TSDB request failed: ${err.message}`));
            });

            try {
                req.write(JSON.stringify(payload));
                req.end();
            } catch (writeErr) {
                reject(new Error(`TSDB request failed: ${writeErr.message}`));
            }
        });

    } catch (error) {
        console.error('Error querying positions per hour per receiver from TSDB:', error);
        throw error;
    }
}

function setupApiRoutes(app, s3, readBucket, writeBucket, getInMemoryState, cache = {}, positionCache = null, tsdbWriteCount = 0, opts = {}) {
    // Load ICAO flight index on startup (non-blocking)
    if (!icaoIndexLastLoaded) {
        loadIcaoFlightIndex(s3, readBucket, writeBucket).catch(err => {
            console.error('[icao-index] Startup load failed:', err);
        });
    }
    
    // --- Heatmap Data Endpoint ---
    app.get('/api/heatmap-data', async (req, res) => {
        try {
            const config = require('../config.json');
            const defaultSource = config.storage?.positions === 'tsdb' ? 'tsdb' : 'memory';
            const source = req.query.source || defaultSource; // 'memory' or 'tsdb'
            const hours = parseFloat(req.query.hours || '24');
            const gridSizeNm = parseFloat(req.query.gridSizeNm || '1'); // Grid size in nautical miles

            let gridData = [];

            if (source === 'tsdb') {
                // Query heatmap data from TSDB
                console.log(`[heatmap] Querying TSDB for ${hours} hours with ${gridSizeNm} NM grid`);
                const tsdbResult = await queryHeatmapFromTSDB(hours, gridSizeNm);
                console.log(`[heatmap] Raw TSDB result:`, JSON.stringify(tsdbResult, null, 2));
                
                // Extract data from InfluxDB response format
                let gridData = [];
                if (tsdbResult && tsdbResult.results && tsdbResult.results[0] && tsdbResult.results[0].series && tsdbResult.results[0].series[0]) {
                    const series = tsdbResult.results[0].series[0];
                    const columns = series.columns;
                    const values = series.values;
                    
                    // Convert InfluxDB format to grid cell objects
                    gridData = values.map(row => {
                        const cell = {};
                        columns.forEach((col, index) => {
                            cell[col] = row[index];
                        });
                        return cell;
                    });
                }
                
                console.log(`[heatmap] Parsed ${gridData.length} grid cells`);
            } else {
                // Use in-memory position data (original logic)
                let positions = positionCache?.getPositionsByTimeWindow(hours) || getInMemoryState()?.positions || [];
                
                // Filter out positions older than 90 seconds to exclude timed-out aircraft
                const now = Date.now();
                const maxAgeMs = 90 * 1000; // 90 seconds
                positions = positions.filter(p => (now - p.timestamp) <= maxAgeMs);
                
                // For performance, sample positions if there are too many
                const maxPositionsForGrid = 100000; // Allow more for grid aggregation than raw positions
                if (positions.length > maxPositionsForGrid) {
                    console.log(`[heatmap] Sampling ${maxPositionsForGrid} positions from ${positions.length} total for ${hours}h window`);
                    const sampled = [];
                    const step = Math.floor(positions.length / maxPositionsForGrid);
                    for (let i = 0; i < positions.length && sampled.length < maxPositionsForGrid; i += step) {
                        sampled.push(positions[i]);
                    }
                    positions = sampled;
                }

                const grid = {};
                // Convert nautical miles to degrees: 1 NM = 1.852 km, 1 degree ≈ 111 km
                const gridSize = gridSizeNm * 1.852 / 111; // Grid size in degrees
                cache.lastHeatmapProcessing = Date.now();

                for (const pos of positions) {
                    if (!pos.lat || !pos.lon || typeof pos.lat !== 'number' || typeof pos.lon !== 'number') continue;

                    const latIdx = Math.floor(pos.lat / gridSize);
                    const lonIdx = Math.floor(pos.lon / gridSize);
                    const key = `${latIdx},${lonIdx}`;

                    if (!grid[key]) {
                        grid[key] = {
                            lat_min: latIdx * gridSize,
                            lat_max: (latIdx + 1) * gridSize,
                            lon_min: lonIdx * gridSize,
                            lon_max: (lonIdx + 1) * gridSize,
                            count: 0
                        };
                    }
                    grid[key].count++;
                }

                gridData = Object.values(grid);
                console.log(`[heatmap] Memory source returned ${gridData.length} grid cells from ${positions.length} positions`);
            }

            res.json({
                grid: gridData,
                source: source,
                hours: hours,
                gridSizeNm: gridSizeNm,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Error in heatmap endpoint:', error);
            res.status(500).json({
                error: 'Failed to generate heatmap data',
                details: error.message,
                source: req.query.source || 'memory'
            });
        }
    });

    // --- Positions Per Hour Per Receiver Endpoint ---
    app.get('/api/positions-per-hour', async (req, res) => {
        try {
            const hours = parseFloat(req.query.hours || '24');

            console.log(`[positions-per-hour] Querying TSDB for ${hours} hours of receiver position data`);

            const data = await queryPositionsPerHourPerReceiver(hours);

            console.log(`[positions-per-hour] Returning ${data.length} hourly receiver position records`);

            res.json({
                data: data,
                hours: hours,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Error in positions-per-hour endpoint:', error);
            res.status(500).json({
                error: 'Failed to query positions per hour per receiver',
                details: error.message
            });
        }
    });

    // --- Position Timeseries Live Endpoint (from position cache) ---
    app.get('/api/position-timeseries-live', async (req, res) => {
        try {
            const resolution = parseInt(req.query.resolution || '1', 10);
            
            // Get state from in-memory tracking
            const state = getInMemoryState ? getInMemoryState() : {};
            const positionHistory = state.positionHistory || [];
            
            // Determine time window
            let cutoff, now;
            if (req.query.startTime && req.query.endTime) {
                // Use explicit time range
                cutoff = parseInt(req.query.startTime, 10);
                now = parseInt(req.query.endTime, 10);
            } else {
                // Fall back to minutes parameter
                const minutes = parseInt(req.query.minutes || '10', 10);
                now = Date.now();
                cutoff = now - (minutes * 60 * 1000);
            }
            
            // Filter positions by time window
            const windowPositions = positionHistory.filter(p => p.timestamp && p.timestamp >= cutoff && p.timestamp <= now);
            
            // Group by resolution buckets
            const buckets = {};
            for (const pos of windowPositions) {
                const bucketTime = Math.floor(pos.timestamp / (resolution * 60 * 1000)) * (resolution * 60 * 1000);
                if (!buckets[bucketTime]) {
                        buckets[bucketTime] = {
                            timestamp: bucketTime,
                            positionCount: 0,
                            aircraftCount: new Set(),
                            flightCount: new Set(),
                            airlineCount: new Set(),
                            manufacturerCounts: {}
                        };
                }
                
                buckets[bucketTime].positionCount++;
                if (pos.hex) buckets[bucketTime].aircraftCount.add(pos.hex);
                if (pos.flight && pos.flight.trim()) buckets[bucketTime].flightCount.add(pos.flight);
                if (pos.airline && pos.airline.trim()) buckets[bucketTime].airlineCount.add(pos.airline);
            }
            
            // Convert to array and compute final counts
            // Convert manufacturerCounts sets to object counts
            for (const bucket of Object.values(buckets)) {
                // For each aircraft in the bucket, attempt to resolve manufacturer
                for (const hex of bucket.aircraftCount) {
                    try {
                        const ac = aircraftDB.lookup(hex);
                        const tcode = ac?.typecode || '';
                        const ti = aircraftTypesDB.lookup(tcode);
                        const manu = ti?.manufacturer || null;
                        if (manu) bucket.manufacturerCounts[manu] = (bucket.manufacturerCounts[manu] || 0) + 1;
                    } catch (err) {
                        // ignore lookup errors
                    }
                }
            }

            const timeseries = Object.values(buckets)
                .map(bucket => ({
                    timestamp: bucket.timestamp,
                    positionCount: bucket.positionCount,
                    aircraft: Array.from(bucket.aircraftCount),
                    flights: Array.from(bucket.flightCount),
                    airlines: Array.from(bucket.airlineCount)
                    , manufacturers: bucket.manufacturerCounts || {}
                }))
                .sort((a, b) => a.timestamp - b.timestamp);
            
            res.json(timeseries);
        } catch (error) {
            console.error('Error in position-timeseries-live endpoint:', error);
            res.status(500).json({ error: 'Failed to generate position timeseries' });
        }
    });

    // --- Reception Range Endpoint ---
    app.get('/api/reception-range', async (req, res) => {
        try {
            const hours = parseInt(req.query.hours || '24', 10);
            
            // Get receiver coordinates from config or state
            const fs = require('fs');
            const configData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
            let receiverLat = configData.dataSource?.receiverLat || configData.receiverLat || 41.52;
            let receiverLon = configData.dataSource?.receiverLon || configData.receiverLon || -86.68;
            
            // Try to get from in-memory state if available (runtime override)
            // Only use state values if they're non-zero (valid coordinates)
            const state = getInMemoryState ? getInMemoryState() : {};
            if (typeof state.receiver_lat === 'number' && state.receiver_lat !== 0) receiverLat = state.receiver_lat;
            if (typeof state.receiver_lon === 'number' && state.receiver_lon !== 0) receiverLon = state.receiver_lon;
            
            // Prefer flights data with real altitudes (alt_baro) over position cache (which has alt: 0)
            let positions = [];
            console.log('[reception] Loading positions from flights data...');
            
            // Load flight files from S3
            try {
                const timeCutoff = Date.now() - (hours * 60 * 60 * 1000);
                
                // List hourly flight files
                const s3Files = await listS3Files(s3, writeBucket, 'flights/hourly/', 1000, 3);
                cache.s3Reads = (cache.s3Reads || 0) + 1;
                cache.lastRead = Date.now();
                
                // Filter files by timestamp parsed from filename
                const flightFiles = (s3Files || []).filter(f => {
                    if (!f.Key || !f.Key.startsWith('flights/hourly/')) return false;
                    const fileTime = extractTimestampFromFilename(f.Key);
                    return fileTime && fileTime >= timeCutoff;
                });
                
                console.log(`[reception] Found ${flightFiles.length} recent hourly flight files for ${hours}h window`);
                
                const { GetObjectCommand } = require('@aws-sdk/client-s3');
                
                // Limit to most recent 8 files to avoid overloading (about 2 hours of data)
                const filesToLoad = flightFiles.sort((a, b) => {
                    const tsA = extractTimestampFromFilename(a.Key) || 0;
                    const tsB = extractTimestampFromFilename(b.Key) || 0;
                    return tsB - tsA;
                }).slice(0, 8);
                
                console.log(`[reception] Loading ${filesToLoad.length} flight files...`);
                
                for (const file of filesToLoad) {
                    try {
                        const command = new GetObjectCommand({ Bucket: writeBucket, Key: file.Key });
                        const response = await s3.send(command);
                        const chunks = [];
                        for await (const chunk of response.Body) {
                            chunks.push(chunk);
                        }
                        const body = Buffer.concat(chunks).toString('utf-8');
                        const data = JSON.parse(body);
                        
                        const flights = data.flights || data;
                        const active = data.active || [];
                        
                        for (const flight of [...flights, ...active]) {
                            if (!flight.start_lat || !flight.start_lon || !flight.start_time) continue;
                            const startTime = new Date(flight.start_time).getTime();
                            if (startTime < timeCutoff) continue;
                            
                            // Use flight start position with max altitude
                            positions.push({
                                lat: flight.start_lat,
                                lon: flight.start_lon,
                                alt_baro: flight.max_alt_ft || 0
                            });
                            
                            // Also use end position if available
                            if (flight.end_lat && flight.end_lon) {
                                positions.push({
                                    lat: flight.end_lat,
                                    lon: flight.end_lon,
                                    alt_baro: flight.max_alt_ft || 0
                                });
                            }
                        }
                    } catch (err) {
                        continue;
                    }
                }
                console.log('[reception] Loaded', positions.length, 'positions from flights');
            } catch (err) {
                console.warn('Failed to load flights for reception data:', err.message);
            }
            
            // If flights data is empty, fall back to position cache
            if (positions.length === 0) {
                console.log('[reception] No flights data, using position cache');
                positions = positionCache?.getPositionsByTimeWindow(hours) || [];
                console.log('[reception] Positions from cache:', positions.length);
            }
            
            // Calculate bearing and altitude bands for each position
            const sectorMap = {};
            let maxRange = 0;
            
            // Only process if we have receiver coordinates
            if (typeof receiverLat !== 'number' || typeof receiverLon !== 'number') {
                console.warn('Receiver coordinates not available:', { receiverLat, receiverLon });
                // Return empty structure if we can't calculate
                return res.json({ 
                    sectors: {},
                    maxRange: 0,
                    positionCount: 0,
                    receiverLat,
                    receiverLon
                });
            }
            
            // Debug: Check first position structure
            if (positions.length > 0) {
                const firstPos = positions[0];
                console.log('[reception] First position fields:', Object.keys(firstPos).sort());
                console.log('[reception] First position sample:', JSON.stringify(firstPos).substring(0, 200));
            }
            
            for (const pos of positions) {
                // Skip invalid positions (missing lat/lon or at 0,0)
                if (!pos.lat || !pos.lon) {
                    continue;
                }
                
                // Skip positions at or very close to 0,0 (invalid data)
                if (Math.abs(pos.lat) < 0.01 && Math.abs(pos.lon) < 0.01) {
                    continue;
                }
                
                // Calculate horizontal distance first to filter out positions > 400 NM
                const R = 3440.065; // nm per radian
                const toRad = deg => deg * Math.PI / 180;
                const lat1_rad = toRad(receiverLat);
                const lat2_rad = toRad(pos.lat);
                const delta_lat = toRad(pos.lat - receiverLat);
                const delta_lon = toRad(pos.lon - receiverLon);
                const a = Math.sin(delta_lat / 2) ** 2 + Math.cos(lat1_rad) * Math.cos(lat2_rad) * Math.sin(delta_lon / 2) ** 2;
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                const horiz = R * c;
                
                // Skip positions beyond 400 NM horizontal distance
                if (horiz > 400) {
                    continue;
                }
                
                // Handle both 'alt' (from aircraft cache) and 'alt_baro' (from flights)
                // If no altitude data, use a placeholder band instead of rejecting the position
                let altitude = pos.alt ?? pos.alt_baro;
                if (!altitude || altitude <= 0) {
                    altitude = 0; // Will be placed in "0-1000 ft" band as unknown altitude
                }
                
                // Calculate bearing from receiver to aircraft
                const lat1 = receiverLat * Math.PI / 180;
                const lat2 = pos.lat * Math.PI / 180;
                const dLon = (pos.lon - receiverLon) * Math.PI / 180;
                const bearing = Math.atan2(Math.sin(dLon), Math.cos(lat1) * Math.tan(lat2) - Math.sin(lat1) * Math.cos(dLon)) * 180 / Math.PI;
                const normalizedBearing = (bearing + 360) % 360;
                
                // Round bearing to nearest 15° (sector)
                const sectorBearing = Math.floor(normalizedBearing / 15) * 15;
                
                // Altitude band (0-5000, 5000-10000, etc.)
                const altBand = Math.floor(altitude / 5000) * 5000;
                
                // Calculate slant range (horiz already calculated above)
                const alt_nm = altitude / 6076.12;
                const slantRange = Math.sqrt(horiz ** 2 + alt_nm ** 2);
                
                const sectorKey = `${sectorBearing}_${altBand}`;
                if (!sectorMap[sectorKey]) {
                    sectorMap[sectorKey] = { bearing: sectorBearing, altBand, maxRange: 0, count: 0 };
                }
                sectorMap[sectorKey].maxRange = Math.max(sectorMap[sectorKey].maxRange, slantRange);
                sectorMap[sectorKey].count++;
                maxRange = Math.max(maxRange, slantRange);
            }
            
            res.json({ 
                sectors: sectorMap,
                maxRange,
                positionCount: positions.length,
                receiverLat,
                receiverLon
            });
        } catch (error) {
            console.error('Error in reception-range endpoint:', error);
            // Return empty but valid structure on error
            res.json({ 
                sectors: {},
                maxRange: 0,
                positionCount: 0,
                receiverLat: undefined,
                receiverLon: undefined
            });
        }
    });

    // --- Flights Endpoint ---
    // Track warnings we've logged during runtime to avoid repeated logs
    const warnSeenCalls = new Set();
    app.get('/api/flights', async (req, res) => {
        try {
            const windowStr = req.query.window || '24h';
            let hours = 24;
            if (windowStr.endsWith('h')) {
                hours = parseInt(windowStr.slice(0, -1), 10);
            } else if (windowStr.endsWith('d')) {
                hours = parseInt(windowStr.slice(0, -1), 10) * 24;
            }
            const timeCutoff = Date.now() - (hours * 60 * 60 * 1000);
            
            // Check source parameter
            const source = req.query.source || 'tsdb'; // 'tsdb' or 's3'
            
            let allFlights = [];
            
            if (source === 'tsdb') {
                // Query TSDB for flight data and reconstruct flights
                let airlineDatabase = {};
                try {
                    airlineDatabase = (opts && opts.airlineDB) ? opts.airlineDB : await getAirlineDatabase(s3, readBucket);
                } catch (error) {
                    console.warn('[flights-tsdb] Failed to load airline database:', error.message);
                }

                try {
                    allFlights = await reconstructFlightsFromTSDB(hours, timeCutoff, { airlineDatabase });
                } catch (error) {
                    console.warn('[flights-tsdb] Failed to query TSDB for flights:', error.message);
                    allFlights = [];
                }
            } else {
                // Default S3 logic
                // Load airline database for enrichment; allow overriding via opts (useful for tests)
                const airlineDatabase = (opts && opts.airlineDB) ? opts.airlineDB : await getAirlineDatabase(s3, readBucket);
                
                // Read more pages to ensure we get enough files for the time window
                const maxPages = Math.max(5, Math.ceil(hours / 24)); // At least 5 pages, more for longer windows
                const s3Files = await listS3Files(s3, writeBucket, 'flights/', 1000, maxPages);
                cache.s3Reads = (cache.s3Reads || 0) + 1;
                cache.lastRead = Date.now();
                cache.lastFlightsProcessing = Date.now();
                const flightFiles = (s3Files || []).filter(f => 
                    f.Key && (f.Key.startsWith('flights/hourly/') || f.Key.startsWith('flights/daily/'))
                );
                
                const seenFlightKeys = new Map();

                function makeFlightKey(flt) {
                    const icao = (flt.icao || flt.hex || '').toLowerCase();
                    const callsign = (flt.callsign || '').toUpperCase();
                    // Round start/end times to the nearest minute for dedupe stability
                    const startRaw = flt.start_time || flt.start_ts || '';
                    const endRaw = flt.end_time || flt.end_ts || '';
                    const start = startRaw ? Math.floor(new Date(startRaw).getTime() / 60000) : '';
                    const end = endRaw ? Math.floor(new Date(endRaw).getTime() / 60000) : '';
                    const reg = (flt.registration || '').toUpperCase();
                    return `${icao}|${callsign}|${start}|${end}|${reg}`;
                }
                for (const file of flightFiles) {
                    try {
                        const command = new GetObjectCommand({ Bucket: writeBucket, Key: file.Key });
                        const response = await s3.send(command);
                        const chunks = [];
                        for await (const chunk of response.Body) {
                            chunks.push(chunk);
                        }
                        const body = Buffer.concat(chunks).toString('utf-8');
                        const flights = JSON.parse(body);
                        
                        for (const fl of flights) {
                            // Normalize key identifiers to avoid duplicates caused by casing/formatting
                            try {
                                fl.callsign = (fl.callsign || '').toUpperCase();
                            } catch (e) {}
                            try {
                                if (fl.icao) fl.icao = String(fl.icao).toLowerCase();
                            } catch (e) {}
                            try {
                                if (fl.registration) fl.registration = String(fl.registration).toUpperCase();
                            } catch (e) {}

                            const startTime = new Date(fl.start_time).getTime();
                            const endTime = new Date(fl.end_time).getTime();
                            
                            // Include flights that were active during the time window
                            // (started before cutoff and ended after, OR started within window)
                            if (endTime > timeCutoff || startTime > timeCutoff) {
                                // Enrich with airline name
                                const callsign = fl.callsign || '';
                                // Derive an airline code only when the callsign contains a leading 2- or 3-letter airline
                                // identifier (e.g., DAL123). Avoid using registrations/callsigns like N1234.
                                let airlineCode = '';
                                const m = callsign.match(/^([A-Z]{2,3})/i);
                                if (m) airlineCode = m[1].toUpperCase();
                                let airlineName = '';
                                if (airlineCode && airlineDatabase && airlineDatabase[airlineCode]) {
                                    const dbEntry = airlineDatabase[airlineCode];
                                    airlineName = typeof dbEntry === 'string' ? dbEntry : (dbEntry.name || '');
                                    fl.airline_code = airlineCode;
                                    fl.airline_name = airlineName;
                                } else {
                                    // Don't set airline_code if we couldn't find a sensible mapping
                                    fl.airline_code = undefined;
                                    fl.airline_name = null;
                                    // Log a warning once per unique callsign/code to help diagnostics
                                    const key = `${callsign}|${airlineCode}`;
                                    if ((callsign || airlineCode) && !warnSeenCalls.has(key)) {
                                        warnSeenCalls.add(key);
                                        console.warn(`[flights] callsign '${callsign}' parsed as '${airlineCode}' but no airline DB entry found; icao='${fl.icao || ''}', registration='${fl.registration || ''}'`);
                                    }
                                }
                                
                                // Enrich with aircraft database info if not already present
                                if (fl.icao && (!fl.registration || fl.registration === 'N/A' || !fl.type || fl.type === 'N/A')) {
                                    const aircraftData = aircraftDB.lookup(fl.icao);
                                        if (aircraftData) {
                                        if (!fl.registration || fl.registration === 'N/A') {
                                            // Only use aircraftData.registration if it's not N/A
                                            if (aircraftData.registration && aircraftData.registration !== 'N/A') {
                                                fl.registration = aircraftData.registration;
                                            }
                                        }
                                        if (!fl.type || fl.type === 'N/A') {
                                            // Only use aircraftData.typecode if it's not N/A
                                            if (aircraftData.typecode && aircraftData.typecode !== 'N/A') {
                                                fl.type = aircraftData.typecode;
                                            }
                                        }
                                        // Add model info if available
                                        if (aircraftData.model && !fl.aircraft_model) {
                                            fl.aircraft_model = aircraftData.model;
                                        }
                                    }
                                    
                                    // If still no registration after OpenSky, try S3 database
                                    if ((!fl.registration || fl.registration === 'N/A') && fl.icao) {
                                        const s3Registration = registration_from_hexid(fl.icao);
                                        if (s3Registration && s3Registration !== 'N/A') {
                                            fl.registration = s3Registration;
                                        }
                                    }
                                }
                                
                                // Enrich with type info (manufacturer, body type)
                                if (fl.type && fl.type !== 'N/A') {
                                    const typeInfo = aircraftTypesDB.lookup(fl.type);
                                    if (typeInfo) {
                                        fl.manufacturer = typeInfo.manufacturer;
                                        fl.bodyType = typeInfo.bodyType;
                                        if (!fl.aircraft_model) {
                                            fl.aircraft_model = typeInfo.model;
                                        }
                                    }
                                }
                                // If still missing registration, but the callsign looks like an FAA tail number
                                // use it as a registration so the frontend displays a tail instead of 'N/A'.
                                if ((!fl.registration || fl.registration === 'N/A') && fl.callsign && /^N\d{1,5}[A-Z]{0,2}$/i.test(fl.callsign)) {
                                    fl.registration = fl.callsign.toUpperCase();
                                }
                                
                                // Add manufacturer logo if available
                                if (fl.airline_code && airlineDatabase && airlineDatabase[fl.airline_code]) {
                                    const dbEntry = airlineDatabase[fl.airline_code];
                                    if (typeof dbEntry === 'object' && dbEntry.logo) {
                                        fl.airline_logo = dbEntry.logo;
                                    }
                                }
                                
                                // Add manufacturer logo from manufacturer database
                                if (fl.manufacturer) {
                                    const manufacturerEntry = Object.entries(manufacturerDB || {}).find(
                                        ([code, data]) => data.name === fl.manufacturer
                                    );
                                    if (manufacturerEntry) {
                                        const [manufacturerCode, manufacturerData] = manufacturerEntry;
                                        fl.manufacturerLogo = manufacturerData.logo;
                                    }
                                }
                                
                                const key = makeFlightKey(fl);
                                if (!seenFlightKeys.has(key)) {
                                    seenFlightKeys.set(key, fl);
                                    allFlights.push(fl);
                                } else {
                                    // If we already have a record, prefer the one with later end_time
                                    const existing = seenFlightKeys.get(key);
                                    try {
                                        const existingEnd = existing && existing.end_time ? new Date(existing.end_time).getTime() : 0;
                                        const newEnd = fl && fl.end_time ? new Date(fl.end_time).getTime() : 0;
                                        if (newEnd > existingEnd) {
                                            // Replace in map and array
                                            seenFlightKeys.set(key, fl);
                                            const idx = allFlights.findIndex(a => makeFlightKey(a) === key);
                                            if (idx !== -1) allFlights[idx] = fl;
                                        }
                                    } catch (err) {
                                        // ignore parse errors, keep first
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        console.warn(`Failed to read flight file ${file.Key}:`, err.message);
                    }
                }
            }
            const maxPages = Math.max(5, Math.ceil(hours / 24)); // At least 5 pages, more for longer windows
            const s3Files = await listS3Files(s3, writeBucket, 'flights/', 1000, maxPages);
            cache.s3Reads = (cache.s3Reads || 0) + 1;
            cache.lastRead = Date.now();
            cache.lastFlightsProcessing = Date.now();
            const flightFiles = (s3Files || []).filter(f => 
                f.Key && (f.Key.startsWith('flights/hourly/') || f.Key.startsWith('flights/daily/'))
            );
            
            const seenFlightKeys = new Map();

            function makeFlightKey(flt) {
                const icao = (flt.icao || flt.hex || '').toLowerCase();
                const callsign = (flt.callsign || '').toUpperCase();
                // Round start/end times to the nearest minute for dedupe stability
                const startRaw = flt.start_time || flt.start_ts || '';
                const endRaw = flt.end_time || flt.end_ts || '';
                const start = startRaw ? Math.floor(new Date(startRaw).getTime() / 60000) : '';
                const end = endRaw ? Math.floor(new Date(endRaw).getTime() / 60000) : '';
                const reg = (flt.registration || '').toUpperCase();
                return `${icao}|${callsign}|${start}|${end}|${reg}`;
            }
            for (const file of flightFiles) {
                try {
                    const command = new GetObjectCommand({ Bucket: writeBucket, Key: file.Key });
                    const response = await s3.send(command);
                    const chunks = [];
                    for await (const chunk of response.Body) {
                        chunks.push(chunk);
                    }
                    const body = Buffer.concat(chunks).toString('utf-8');
                    const flights = JSON.parse(body);
                    
                    for (const fl of flights) {
                        // Normalize key identifiers to avoid duplicates caused by casing/formatting
                        try {
                            fl.callsign = (fl.callsign || '').toUpperCase();
                        } catch (e) {}
                        try {
                            if (fl.icao) fl.icao = String(fl.icao).toLowerCase();
                        } catch (e) {}
                        try {
                            if (fl.registration) fl.registration = String(fl.registration).toUpperCase();
                        } catch (e) {}

                        const startTime = new Date(fl.start_time).getTime();
                        const endTime = new Date(fl.end_time).getTime();
                        
                        // Include flights that were active during the time window
                        // (started before cutoff and ended after, OR started within window)
                        if (endTime > timeCutoff || startTime > timeCutoff) {
                            // Enrich with airline name
                            const callsign = fl.callsign || '';
                            // Derive an airline code only when the callsign contains a leading 2- or 3-letter airline
                            // identifier (e.g., DAL123). Avoid using registrations/callsigns like N1234.
                            let airlineCode = '';
                            const m = callsign.match(/^([A-Z]{2,3})/i);
                            if (m) airlineCode = m[1].toUpperCase();
                            let airlineName = '';
                            if (airlineCode && airlineDatabase && airlineDatabase[airlineCode]) {
                                const dbEntry = airlineDatabase[airlineCode];
                                airlineName = typeof dbEntry === 'string' ? dbEntry : (dbEntry.name || '');
                                fl.airline_code = airlineCode;
                                fl.airline_name = airlineName;
                            } else {
                                // Don't set airline_code if we couldn't find a sensible mapping
                                fl.airline_code = undefined;
                                fl.airline_name = null;
                                // Log a warning once per unique callsign/code to help diagnostics
                                const key = `${callsign}|${airlineCode}`;
                                if ((callsign || airlineCode) && !warnSeenCalls.has(key)) {
                                    warnSeenCalls.add(key);
                                    console.warn(`[flights] callsign '${callsign}' parsed as '${airlineCode}' but no airline DB entry found; icao='${fl.icao || ''}', registration='${fl.registration || ''}'`);
                                }
                            }
                            
                            // Enrich with aircraft database info if not already present
                            if (fl.icao && (!fl.registration || fl.registration === 'N/A' || !fl.type || fl.type === 'N/A')) {
                                const aircraftData = aircraftDB.lookup(fl.icao);
                                    if (aircraftData) {
                                    if (!fl.registration || fl.registration === 'N/A') {
                                        // Only use aircraftData.registration if it's not N/A
                                        if (aircraftData.registration && aircraftData.registration !== 'N/A') {
                                            fl.registration = aircraftData.registration;
                                        }
                                    }
                                    if (!fl.type || fl.type === 'N/A') {
                                        // Only use aircraftData.typecode if it's not N/A
                                        if (aircraftData.typecode && aircraftData.typecode !== 'N/A') {
                                            fl.type = aircraftData.typecode;
                                        }
                                    }
                                    // Add model info if available
                                    if (aircraftData.model && !fl.aircraft_model) {
                                        fl.aircraft_model = aircraftData.model;
                                    }
                                }
                                
                                // If still no registration after OpenSky, try S3 database
                                if ((!fl.registration || fl.registration === 'N/A') && fl.icao) {
                                    const s3Registration = registration_from_hexid(fl.icao);
                                    if (s3Registration && s3Registration !== 'N/A') {
                                        fl.registration = s3Registration;
                                    }
                                }
                            }
                            
                            // Enrich with type info (manufacturer, body type)
                            if (fl.type && fl.type !== 'N/A') {
                                const typeInfo = aircraftTypesDB.lookup(fl.type);
                                if (typeInfo) {
                                    fl.manufacturer = typeInfo.manufacturer;
                                    fl.bodyType = typeInfo.bodyType;
                                    if (!fl.aircraft_model) {
                                        fl.aircraft_model = typeInfo.model;
                                    }
                                }
                            }
                            // If still missing registration, but the callsign looks like an FAA tail number
                            // use it as a registration so the frontend displays a tail instead of 'N/A'.
                            if ((!fl.registration || fl.registration === 'N/A') && fl.callsign && /^N\d{1,5}[A-Z]{0,2}$/i.test(fl.callsign)) {
                                fl.registration = fl.callsign.toUpperCase();
                            }

                            // Enrich with logos
                            // Airline logo
                            if (airlineDatabase && airlineCode && airlineDatabase[airlineCode]) {
                                const airlineData = airlineDatabase[airlineCode];
                                if (airlineData && airlineData.logo) {
                                    fl.airlineLogo = typeof airlineData === 'string' ? airlineData.logo : airlineData.logo;
                                }
                                // Warn if airline exists in DB but has no logo; help to identify missing assets
                                if ((!airlineData || !airlineData.logo) && !warnSeenCalls.has(`noLogo|${airlineCode}`)) {
                                    warnSeenCalls.add(`noLogo|${airlineCode}`);
                                    console.warn(`[flights] airline '${airlineCode}' found in DB but has no logo property; airlineName='${(airlineData && airlineData.name) || ''}'`);
                                }
                            }
                            // Manufacturer logo
                            if (fl.manufacturer && airlineDatabase) {
                                const manufacturerEntry = Object.entries(airlineDatabase).find(([code, data]) => 
                                    data.name === fl.manufacturer
                                );
                                if (manufacturerEntry) {
                                    const [manufacturerCode, manufacturerData] = manufacturerEntry;
                                    fl.manufacturerLogo = manufacturerData.logo;
                                }
                            }
                            
                            const key = makeFlightKey(fl);
                            if (!seenFlightKeys.has(key)) {
                                seenFlightKeys.set(key, fl);
                                allFlights.push(fl);
                            } else {
                                // If we already have a record, prefer the one with later end_time
                                const existing = seenFlightKeys.get(key);
                                try {
                                    const existingEnd = existing && existing.end_time ? new Date(existing.end_time).getTime() : 0;
                                    const newEnd = fl && fl.end_time ? new Date(fl.end_time).getTime() : 0;
                                    if (newEnd > existingEnd) {
                                        // Replace in map and array
                                        seenFlightKeys.set(key, fl);
                                        const idx = allFlights.findIndex(a => makeFlightKey(a) === key);
                                        if (idx !== -1) allFlights[idx] = fl;
                                    }
                                } catch (err) {
                                    // ignore parse errors, keep first
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.warn(`Failed to read flight file ${file.Key}:`, err.message);
                }
            }
            
            const gapMinutes = parseInt(req.query.gap || '5', 10);
            const gapMs = gapMinutes * 60 * 1000;
            const now = Date.now();
            
            const active = [];
            const completed = [];
            
            for (const fl of allFlights) {
                // If end_time is missing or invalid, treat as active
                if (!fl.end_time) {
                    active.push(fl);
                    continue;
                }
                const endTime = new Date(fl.end_time).getTime();
                if (isNaN(endTime)) {
                    active.push(fl);
                } else if (now - endTime <= gapMs) {
                    active.push(fl);
                } else {
                    completed.push(fl);
                }
            }
            
            if (getInMemoryState) {
                const state = getInMemoryState();
                const liveFlights = Object.values(state.activeFlights || {});
                
                // Enrich live flights with aircraft database
                for (const fl of liveFlights) {
                    if (fl.icao && (!fl.registration || fl.registration === 'N/A' || !fl.type || fl.type === 'N/A')) {
                        const aircraftData = aircraftDB.lookup(fl.icao);
                        if (aircraftData) {
                            if (!fl.registration || fl.registration === 'N/A') {
                                // Only use aircraftData.registration if it's not N/A
                                if (aircraftData.registration && aircraftData.registration !== 'N/A') {
                                    fl.registration = aircraftData.registration;
                                }
                            }
                            if (!fl.type || fl.type === 'N/A') {
                                // Only use aircraftData.typecode if it's not N/A
                                if (aircraftData.typecode && aircraftData.typecode !== 'N/A') {
                                    fl.type = aircraftData.typecode;
                                }
                            }
                            if (aircraftData.model && !fl.aircraft_model) {
                                fl.aircraft_model = aircraftData.model;
                            }
                        }
                        
                        // If still no registration after OpenSky, try S3 database
                        if ((!fl.registration || fl.registration === 'N/A') && fl.icao) {
                            const s3Registration = registration_from_hexid(fl.icao);
                            if (s3Registration && s3Registration !== 'N/A') {
                                fl.registration = s3Registration;
                            }
                        }
                    }
                    const key = makeFlightKey(fl);
                    if (seenFlightKeys.has(key)) {
                        // If the live flight is more recent (end_time later or ongoing), replace
                        const existing = seenFlightKeys.get(key);
                        try {
                            const existingEnd = existing && existing.end_time ? new Date(existing.end_time).getTime() : 0;
                            const newEnd = fl && fl.end_time ? new Date(fl.end_time).getTime() : Date.now();
                            if (newEnd >= existingEnd) {
                                seenFlightKeys.set(key, fl);
                                const idx = allFlights.findIndex(a => makeFlightKey(a) === key);
                                if (idx !== -1) allFlights[idx] = fl;
                            }
                        } catch (err) {
                            // ignore parse errors; fallback to leaving existing
                        }
                    } else {
                        seenFlightKeys.set(key, fl);
                        allFlights.push(fl);
                    }
                    // If still missing registration, but the callsign looks like an FAA tail number
                    // (starts with 'N' and follows N-number pattern), use it as registration so the
                    // frontend always has a tail number value to display.
                    if ((!fl.registration || fl.registration === 'N/A') && fl.callsign && /^N\d{1,5}[A-Z]{0,2}$/i.test(fl.callsign)) {
                        fl.registration = fl.callsign.toUpperCase();
                    }
                }
                
                // liveFlights were added to allFlights and handled in the loop above; no need to push again
            }

            // Recompute active/completed after merging live (in-memory) flights into allFlights.
            // Previously active/completed were computed before merging live flights, which could
            // cause active flights to be omitted from the response. Recompute here to ensure
            // the merged live flights are classified correctly.
            active.length = 0;
            completed.length = 0;
            for (const fl of allFlights) {
                if (!fl.end_time) {
                    active.push(fl);
                    continue;
                }
                const endTime = new Date(fl.end_time).getTime();
                if (isNaN(endTime)) {
                    active.push(fl);
                } else if (now - endTime <= gapMs) {
                    active.push(fl);
                } else {
                    completed.push(fl);
                }
            }

            completed.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
            active.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));

            res.json({ flights: completed, active });
        } catch (error) {
            console.error('Error in flights endpoint:', error);
            res.status(500).json({ flights: [], active: [], error: error.message });
        }
    });

    // --- Airline Stats Endpoint ---
    app.get('/api/airline-stats', async (req, res) => {
        try {
            const windowStr = req.query.window || '1h';
            let hours = 1;
            if (windowStr.endsWith('h')) {
                hours = parseInt(windowStr.slice(0, -1), 10);
            } else if (windowStr.endsWith('d')) {
                hours = parseInt(windowStr.slice(0, -1), 10) * 24;
            }
            
            const cacheKey = `airline_${hours}h`;
            if (cache.airlineStats && cache.airlineStats[cacheKey]) {
                return res.json(cache.airlineStats[cacheKey]);
            }
            
            const statsData = await computeAirlineStatsData(s3, readBucket, writeBucket, windowStr);
            
            // Check active flights and update lastSeen to now for airlines with current activity
            const inMemoryState = getInMemoryState();
            const activeFlights = inMemoryState?.activeFlights || {};
            const now = Date.now();
            
            // Build map of airline codes to airline names from statsData
            const airlineCodeToName = {};
            for (const [airlineName, stats] of Object.entries(statsData.byAirline || {})) {
                if (stats.code) {
                    airlineCodeToName[stats.code] = airlineName;
                }
            }
            
            // Check which airlines have active flights right now
            const activeAirlineCodes = new Set();
            for (const flight of Object.values(activeFlights)) {
                if (flight.callsign && flight.callsign.length >= 3) {
                    const airlineCode = flight.callsign.substring(0, 3).toUpperCase();
                    // Filter out N-numbers (tail numbers start with N)
                    if (!airlineCode.startsWith('N')) {
                        activeAirlineCodes.add(airlineCode);
                    }
                }
            }
            
            // Update lastSeen to now for airlines with active flights
            for (const [airlineName, stats] of Object.entries(statsData.byAirline || {})) {
                if (stats.code && activeAirlineCodes.has(stats.code)) {
                    stats.lastSeen = now;
                }
            }
            
            // Wrap in expected structure for UI
            const data = {
                minute: { byAirline: {} },
                hourly: { byAirline: statsData.byAirline || {} },
                memory: { byAirline: {} }
            };
            
            if (!cache.airlineStats) cache.airlineStats = {};
            cache.airlineStats[cacheKey] = data;
            cache.lastAirlinesProcessing = Date.now();
            
            res.json(data);
        } catch (error) {
            console.error('Error computing airline stats:', error);
            res.status(500).json({ error: 'Failed to compute airline statistics' });
        }
    });

    // --- Squawk Transitions Endpoint ---
    app.get('/api/squawk-transitions', async (req, res) => {
        try {
            let startTime, endTime, hours;
            
            console.log('[squawk-api] Request params:', req.query);
            
            // Check if time range parameters are provided
            if (req.query.startTime && req.query.endTime) {
                startTime = parseInt(req.query.startTime, 10);
                endTime = parseInt(req.query.endTime, 10);
                hours = Math.round((endTime - startTime) / (60 * 60 * 1000));
            } else {
                hours = parseInt(req.query.hours || '6', 10);
                endTime = Date.now();
                startTime = endTime - (hours * 60 * 60 * 1000);
            }
                
            console.log('[squawk-api] Using time range:', new Date(startTime).toISOString(), 'to', new Date(endTime).toISOString());
            
            // Round timestamps to nearest minute for better cache hit rate
            const roundedStart = Math.floor(startTime / 60000) * 60000;
            const roundedEnd = Math.floor(endTime / 60000) * 60000;
            const cacheKey = `tsdb_${hours}h_${roundedStart}-${roundedEnd}`;
            
            if (cache.squawkTransitions && cache.squawkTransitions[cacheKey]) {
                console.log('[squawk-api] Cache hit for key:', cacheKey);
                return res.json(cache.squawkTransitions[cacheKey]);
            }
            
            console.log('[squawk-api] Cache miss for key:', cacheKey);

            // Load airline database for enrichment
            const airlineDatabase = await getAirlineDatabase(s3, readBucket);

            // Query TSDB for squawk transitions using SQL window functions
            const startTimeISO = new Date(startTime).toISOString();
            const endTimeISO = new Date(endTime).toISOString();

            console.log('[squawk-api] Querying TSDB for squawk transitions...');

            // Get all squawk changes by using LAG to compare previous squawk value
            const sqlQuery = `
                WITH ordered_positions AS (
                    SELECT
                        icao,
                        flight,
                        squawk,
                        lat,
                        lon,
                        altitude_ft,
                        time,
                        LAG(squawk) OVER (PARTITION BY icao ORDER BY time) as prev_squawk,
                        LAG(flight) OVER (PARTITION BY icao ORDER BY time) as prev_flight,
                        LAG(time) OVER (PARTITION BY icao ORDER BY time) as prev_time
                    FROM aircraft_positions_v2
                    WHERE
                        time >= '${startTimeISO}'
                        AND time <= '${endTimeISO}'
                        AND squawk IS NOT NULL
                    ORDER BY icao, time
                )
                SELECT
                    icao,
                    flight,
                    prev_squawk as from_squawk,
                    squawk as to_squawk,
                    lat,
                    lon,
                    altitude_ft,
                    time,
                    prev_time,
                    prev_flight
                FROM ordered_positions
                WHERE
                    prev_squawk IS NOT NULL
                    AND prev_squawk != squawk
                    AND (prev_flight = flight OR prev_flight IS NULL OR flight IS NULL)
                    AND (EXTRACT(EPOCH FROM (time - prev_time)) / 60) < 15
                ORDER BY time DESC
                LIMIT 1000
            `;

            try {
                const influxResult = await queryInfluxDB(sqlQuery);

                const transitions = [];

                if (influxResult && Array.isArray(influxResult)) {
                    for (const row of influxResult) {
                        const hex = row.icao;
                        const flight = (row.flight || '').trim();
                        
                        // Lookup aircraft in OpenSky database
                        const aircraftData = aircraftDB.lookup(hex);
                        let registration = (aircraftData?.registration && aircraftData.registration !== 'N/A') ? aircraftData.registration : null;
                        if (!registration) {
                            registration = registration_from_hexid(hex) || 'N/A';
                        }
                        const aircraft_type = (aircraftData?.typecode && aircraftData.typecode !== 'N/A') ? aircraftData.typecode : 'N/A';
                        const aircraft_model = aircraftData?.model || null;
                        
                        // Lookup type information (manufacturer, body type)
                        const typeInfo = aircraftTypesDB.lookup(aircraft_type);
                        const manufacturer = typeInfo?.manufacturer || 'N/A';
                        const bodyType = typeInfo?.bodyType || 'N/A';
                        
                        // Extract airline code from flight callsign
                        let airlineCode = '';
                        let airlineName = '';
                        if (flight && flight.length >= 3) {
                            airlineCode = flight.substring(0, 3).toUpperCase();
                            if (airlineDatabase[airlineCode]) {
                                airlineName = airlineDatabase[airlineCode].airline || airlineDatabase[airlineCode].name || '';
                            } else {
                                airlineName = null;
                            }
                        }

                        const timestamp = new Date(row.time).getTime();
                        const prevTimestamp = row.prev_time ? new Date(row.prev_time).getTime() : timestamp;
                        const minutesSinceLast = (timestamp - prevTimestamp) / (60 * 1000);

                        transitions.push({
                            hex,
                            flight,
                            registration,
                            type: aircraft_type,
                            aircraft_model,
                            manufacturer,
                            bodyType,
                            airlineCode,
                            airlineName,
                            from: row.from_squawk,
                            to: row.to_squawk,
                            timestamp,
                            lat: row.lat,
                            lon: row.lon,
                            altitude: Math.round(row.altitude_ft || 0),
                            minutesSinceLast: Math.round(minutesSinceLast * 10) / 10
                        });
                    }
                }

                console.log(`[squawk-api] Found ${transitions.length} squawk transitions from TSDB`);

                const data = {
                    transitions,
                    totalTransitions: transitions.length,
                    timeRange: { startTime, endTime, hours },
                    source: 'tsdb'
                };

                if (!cache.squawkTransitions) cache.squawkTransitions = {};
                cache.squawkTransitions[cacheKey] = data;
                cache.lastSquawksProcessing = Date.now();

                return res.json(data);

            } catch (influxError) {
                console.error('[squawk-api] TSDB query failed:', influxError);
                return res.json({
                    transitions: [],
                    totalTransitions: 0,
                    timeRange: { startTime, endTime, hours },
                    source: 'tsdb',
                    error: influxError.message
                });
            }
        } catch (error) {
            console.error('Error computing squawk transitions:', error);
            // Return default structure on error instead of error object
            res.json({ 
                transitions: [],
                totalTransitions: 0
            });
        }
    });

    // --- Squawk Transitions Map Endpoint (with position data) ---
    app.get('/api/squawk-transitions-map', async (req, res) => {
        try {
            let startTime, endTime, hours;
            
            console.log('[squawk-map-api] Request params:', req.query);
            
            // Check if time range parameters are provided
            if (req.query.startTime && req.query.endTime) {
                startTime = parseInt(req.query.startTime, 10);
                endTime = parseInt(req.query.endTime, 10);
                hours = Math.round((endTime - startTime) / (60 * 60 * 1000));
            } else {
                // Fallback to hours parameter
                hours = parseInt(req.query.hours || '1', 10);
                endTime = Date.now();
                startTime = endTime - (hours * 60 * 60 * 1000);
            }
            
            console.log('[squawk-map-api] Using time range:', new Date(startTime).toISOString(), 'to', new Date(endTime).toISOString());
            
            // Round timestamps to nearest minute for better cache hit rate
            const roundedStart = Math.floor(startTime / 60000) * 60000;
            const roundedEnd = Math.floor(endTime / 60000) * 60000;
            const cacheKey = `map_tsdb_${hours}h_${roundedStart}-${roundedEnd}`;
            
            if (cache.squawkTransitionsMap && cache.squawkTransitionsMap[cacheKey]) {
                console.log('[squawk-map-api] Cache hit for key:', cacheKey);
                return res.json(cache.squawkTransitionsMap[cacheKey]);
            }
            
            console.log('[squawk-map-api] Cache miss for key:', cacheKey);

            // Load airline database for enrichment
            const airlineDatabase = await getAirlineDatabase(s3, readBucket);

            // Query TSDB for squawk transitions
            const startTimeISO = new Date(startTime).toISOString();
            const endTimeISO = new Date(endTime).toISOString();

            console.log('[squawk-map-api] Querying TSDB for squawk transitions...');

            const sqlQuery = `
                WITH ordered_positions AS (
                    SELECT
                        icao,
                        flight,
                        squawk,
                        lat,
                        lon,
                        altitude_ft,
                        time,
                        LAG(squawk) OVER (PARTITION BY icao ORDER BY time) as prev_squawk,
                        LAG(flight) OVER (PARTITION BY icao ORDER BY time) as prev_flight,
                        LAG(time) OVER (PARTITION BY icao ORDER BY time) as prev_time
                    FROM aircraft_positions_v2
                    WHERE
                        time >= '${startTimeISO}'
                        AND time <= '${endTimeISO}'
                        AND squawk IS NOT NULL
                        AND lat IS NOT NULL
                        AND lon IS NOT NULL
                    ORDER BY icao, time
                )
                SELECT
                    icao,
                    flight,
                    prev_squawk as from_squawk,
                    squawk as to_squawk,
                    lat,
                    lon,
                    altitude_ft,
                    time,
                    prev_time,
                    prev_flight
                FROM ordered_positions
                WHERE
                    prev_squawk IS NOT NULL
                    AND prev_squawk != squawk
                    AND (prev_flight = flight OR prev_flight IS NULL OR flight IS NULL)
                    AND (EXTRACT(EPOCH FROM (time - prev_time)) / 60) < 15
                ORDER BY time DESC
                LIMIT 10000000
            `;

            try {
                const influxResult = await queryInfluxDB(sqlQuery);
                const transitions = [];

                if (influxResult && Array.isArray(influxResult)) {
                    for (const row of influxResult) {
                        const hex = row.icao;
                        const flight = (row.flight || '').trim();
                        
                        // Lookup aircraft in OpenSky database
                        const aircraftData = aircraftDB.lookup(hex);
                        let registration = (aircraftData?.registration && aircraftData.registration !== 'N/A') ? aircraftData.registration : null;
                        if (!registration) {
                            registration = registration_from_hexid(hex) || 'N/A';
                        }
                        const aircraft_type = (aircraftData?.typecode && aircraftData.typecode !== 'N/A') ? aircraftData.typecode : 'N/A';
                        const aircraft_model = aircraftData?.model || null;
                        
                        // Lookup type information (manufacturer, body type)
                        const typeInfo = aircraftTypesDB.lookup(aircraft_type);
                        const manufacturer = typeInfo?.manufacturer || 'N/A';
                        const bodyType = typeInfo?.bodyType || 'N/A';
                        
                        // Extract airline code from flight callsign
                        let airlineCode = '';
                        let airlineName = '';
                        if (flight && flight.length >= 3) {
                            airlineCode = flight.substring(0, 3).toUpperCase();
                            if (airlineDatabase[airlineCode]) {
                                airlineName = airlineDatabase[airlineCode].airline || airlineDatabase[airlineCode].name || '';
                            } else {
                                airlineName = null;
                            }
                        }

                        const timestamp = new Date(row.time).getTime();
                        const prevTimestamp = row.prev_time ? new Date(row.prev_time).getTime() : timestamp;
                        const minutesSinceLast = (timestamp - prevTimestamp) / (60 * 1000);

                        transitions.push({
                            hex,
                            flight,
                            registration,
                            type: aircraft_type,
                            aircraft_model,
                            manufacturer,
                            bodyType,
                            airlineCode,
                            airlineName,
                            from: row.from_squawk,
                            to: row.to_squawk,
                            timestamp,
                            lat: row.lat,
                            lon: row.lon,
                            altitude: Math.round(row.altitude_ft || 0),
                            minutesSinceLast: Math.round(minutesSinceLast * 10) / 10
                        });
                    }
                }

                console.log(`[squawk-map-api] Found ${transitions.length} squawk transitions from TSDB`);

                const result = {
                    transitions,
                    totalTransitions: transitions.length,
                    timeRange: { startTime, endTime, hours },
                    source: 'tsdb'
                };

                // Cache the result
                if (!cache.squawkTransitionsMap) cache.squawkTransitionsMap = {};
                cache.squawkTransitionsMap[cacheKey] = result;
                cache.lastSquawksProcessing = Date.now();

                return res.json(result);

            } catch (influxError) {
                console.error('[squawk-map-api] TSDB query failed:', influxError);
                return res.json({
                    transitions: [],
                    totalTransitions: 0,
                    timeRange: { startTime, endTime, hours },
                    source: 'tsdb',
                    error: influxError.message
                });
            }
            
        } catch (error) {
            console.error('Error computing squawk transitions map data:', error);
            res.json({ 
                transitions: [],
                totalTransitions: 0,
                timeRange: null
            });
        }
    });

    // --- Squawk Transitions TSDB Endpoint (SQL-based) ---
    app.get('/api/squawk-transitions-tsdb', async (req, res) => {
        try {
            let startTime, endTime, hours, limit;

            console.log('[squawk-tsdb-api] Request params:', req.query);

            // Parse time parameters
            if (req.query.startTime && req.query.endTime) {
                startTime = parseInt(req.query.startTime, 10);
                endTime = parseInt(req.query.endTime, 10);
                hours = Math.round((endTime - startTime) / (60 * 60 * 1000));
            } else {
                hours = parseInt(req.query.hours || '24', 10);
                endTime = Date.now();
                startTime = endTime - (hours * 60 * 60 * 1000);
            }

            limit = parseInt(req.query.limit || '100', 10);

            const cacheKey = `tsdb_${startTime}-${endTime}_${limit}`;
            if (cache.squawkTransitionsTSDB && cache.squawkTransitionsTSDB[cacheKey]) {
                return res.json(cache.squawkTransitionsTSDB[cacheKey]);
            }

            // Load airline database for airline name lookup
            const airlineDatabase = await getAirlineDatabase(s3, readBucket);

            // Build SQL query based on the existing squawk_transitions_query.sql
            const startTimeISO = new Date(startTime).toISOString();
            const endTimeISO = new Date(endTime).toISOString();

            console.log('[squawk-tsdb-api] Executing SQL query...');

            // Since InfluxDB doesn't support window functions for transition analysis,
            // return aircraft positions that have squawk codes instead
            const sqlQuery = `
                SELECT
                    icao,
                    flight,
                    squawk,
                    lat,
                    lon,
                    altitude,
                    time
                FROM aircraft_positions_v2
                WHERE
                    time >= '${startTimeISO}'
                    AND time <= '${endTimeISO}'
                    AND squawk IS NOT NULL
                    AND squawk != 'N/A'
                    AND squawk ~ '^[0-9]+\\.?[0-9]*$'
                ORDER BY time DESC
                LIMIT ${limit}
            `;

            try {
                const influxResult = await queryInfluxDB(sqlQuery);

                if (!influxResult || !Array.isArray(influxResult)) {
                    console.log('[squawk-tsdb-api] No results from InfluxDB');
                    const result = {
                        transitions: [],
                        totalTransitions: 0,
                        timeRange: { startTime, endTime, hours },
                        source: 'tsdb',
                        note: 'No aircraft with squawk codes found in the specified time range'
                    };
                    if (!cache.squawkTransitionsTSDB) cache.squawkTransitionsTSDB = {};
                    cache.squawkTransitionsTSDB[cacheKey] = result;
                    return res.json(result);
                }

                // Process results and enrich with airline and aircraft data
                const positionsWithSquawk = [];

                for (const row of influxResult) {
                    const hex = row.icao;
                    const flight = (row.flight || '').trim();
                    const registration = hex; // Use ICAO as fallback since registration not available in TSDB
                    const aircraftType = ''; // Type not available in TSDB

                    // Extract airline code from flight callsign
                    let airlineCode = '';
                    let airlineName = '';
                    if (flight && flight.length >= 3) {
                        airlineCode = flight.substring(0, 3).toUpperCase();
                        if (airlineDatabase[airlineCode]) {
                            airlineName = airlineDatabase[airlineCode].airline || airlineDatabase[airlineCode].name || '';
                        } else {
                            airlineName = null;
                        }
                    }

                    // Get aircraft type information (not available in TSDB, so use empty)
                    const typeInfo = aircraftDB.lookup(aircraftType || '');

                    // Convert time to timestamp
                    const timestamp = new Date(row.time).getTime();

                    positionsWithSquawk.push({
                        hex,
                        registration: registration || hex,
                        flight,
                        type: aircraftType,
                        aircraft_model: typeInfo?.model || null,
                        manufacturer: typeInfo?.manufacturer || null,
                        bodyType: typeInfo?.bodyType || null,
                        airlineCode,
                        airlineName,
                        squawk: row.squawk,
                        lat: row.lat,
                        lon: row.lon,
                        altitude: Math.round(row.altitude || 0),
                        timestamp,
                        positionTimestamp: timestamp,
                        timeDiff: 0 // Not applicable for individual positions
                    });
                }

                console.log(`[squawk-tsdb-api] Found ${positionsWithSquawk.length} aircraft positions with squawk codes from TSDB`);

                const result = {
                    transitions: positionsWithSquawk,
                    totalTransitions: positionsWithSquawk.length,
                    timeRange: { startTime, endTime, hours },
                    source: 'tsdb',
                    note: 'TSDB contains position data but very limited squawk codes. Only 1 record with squawk found out of 11.9M total. Use /api/squawk-transitions (S3-based) for complete squawk transition analysis.'
                };

                // Cache the result
                if (!cache.squawkTransitionsTSDB) cache.squawkTransitionsTSDB = {};
                cache.squawkTransitionsTSDB[cacheKey] = result;
                cache.lastSquawksProcessing = Date.now();

                return res.json(result);

            } catch (influxError) {
                console.log('[squawk-tsdb-api] InfluxDB query failed, returning informative error');
                const result = {
                    transitions: [],
                    totalTransitions: 0,
                    timeRange: { startTime, endTime, hours },
                    source: 'tsdb',
                    error: 'InfluxDB does not support window functions required for squawk transition analysis. Use /api/squawk-transitions (S3-based) instead.',
                    note: 'TSDB is optimized for time-series storage but lacks analytical query capabilities needed for transition detection.'
                };

                // Cache the result
                if (!cache.squawkTransitionsTSDB) cache.squawkTransitionsTSDB = {};
                cache.squawkTransitionsTSDB[cacheKey] = result;
                cache.lastSquawksProcessing = Date.now();

                return res.json(result);
            }

        } catch (error) {
            console.error('Error querying squawk transitions from TSDB:', error);
            // Return default structure on error instead of error object
            res.json({
                transitions: [],
                totalTransitions: 0,
                timeRange: null,
                source: 'tsdb',
                error: error.message
            });
        }
    });

    // --- Historical Stats Endpoint ---
    app.get('/api/historical-stats', async (req, res) => {
        try {
            let hours = parseInt(req.query.hours || '168', 10);
            const resolution = parseInt(req.query.resolution || '60', 10);
            let startTime = null;
            let endTime = null;
            
            // Support time range query (startTime and endTime in milliseconds)
            if (req.query.startTime && req.query.endTime) {
                startTime = parseInt(req.query.startTime, 10);
                endTime = parseInt(req.query.endTime, 10);
                hours = Math.ceil((endTime - startTime) / (60 * 60 * 1000));
            }
            
            const cacheKey = `h${hours}_r${resolution}`;
            let data = cache.historicalStats && cache.historicalStats[cacheKey] ? cache.historicalStats[cacheKey] : null;
            
            if (!data) {
                data = await computeHistoricalStatsData(s3, readBucket, hours, resolution, getInMemoryState, startTime, endTime);
                if (!cache.historicalStats) cache.historicalStats = {};
                cache.historicalStats[cacheKey] = data;
                cache.lastPositionsProcessing = Date.now();
            }
            
            // If time range was specified, filter the time series to only include that range
            if (startTime && endTime && data.timeSeries) {
                const filtered = {
                    ...data,
                    timeSeries: data.timeSeries.filter(point => {
                        const pointTime = new Date(point.timestamp).getTime();
                        return pointTime >= startTime && pointTime <= endTime;
                    })
                };
                return res.json(filtered);
            }
            
            res.json(data);
        } catch (error) {
            console.error('Error computing historical stats:', error);
            res.status(500).json({ error: 'Failed to compute historical statistics' });
        }
    });

    // --- Restart Endpoint ---
    // Secure restart endpoint used by CI. Requires `RESTART_API_TOKEN` to be set in the server environment.
    // Accepts Authorization: Bearer <token> or X-Restart-Token header or JSON body { token: '<token>' }
    app.post('/api/restart', (req, res) => {
        try {
            const expectedToken = process.env.RESTART_API_TOKEN || '';
            if (!expectedToken) {
                logger.warn('[restart] Restart endpoint disabled: no RESTART_API_TOKEN set');
                return res.status(403).json({ error: 'Restart endpoint disabled on this server' });
            }

            const authHeader = (req.headers && req.headers.authorization) ? req.headers.authorization : '';
            logger.info('[restart] authHeader=' + authHeader);
            let providedToken = '';
            if (authHeader.toLowerCase().startsWith('bearer ')) {
                providedToken = authHeader.substring(7).trim();
            }
            if (!providedToken && req.headers['x-restart-token']) {
                providedToken = req.headers['x-restart-token'];
            }
            if (!providedToken && req.body && req.body.token) {
                providedToken = req.body.token;
            }

            if (!providedToken) {
                logger.warn('[restart] Missing restart token in request');
                return res.status(401).json({ error: 'Missing token' });
            }
            if (providedToken !== expectedToken) {
                logger.warn('[restart] Invalid restart token');
                return res.status(403).json({ error: 'Invalid token' });
            }

            // Authorized - perform restart
            res.json({ message: 'Server restarting (authorized) ...' });
            logger.info('[restart] Authorized restart triggered via API');

            // In test environment do not actually spawn or exit - just confirm authorization
            if (process.env.NODE_ENV === 'test') {
                logger.info('[restart] Test environment: simulated restart (no spawn)');
                return; // don't spawn or exit in tests
            }

            const { spawn } = require('child_process');
            const path = require('path');
            setTimeout(() => {
                const scriptPath = path.join(__dirname, '..', 'restart-server.ps1');
                // Execute PowerShell script in detached mode (cross-platform scripts may be chosen based on platform)
                if (process.platform === 'win32') {
                    const child = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath], { detached: true, stdio: 'ignore' });
                    child.unref();
                } else {
                    // Try bash restart script on unix-like
                    const scriptPathUnix = path.join(__dirname, '..', 'restart-server.sh');
                    const child = spawn('bash', [scriptPathUnix], { detached: true, stdio: 'ignore' });
                    child.unref();
                }
                setTimeout(() => process.exit(0), 500);
            }, 1000);
        } catch (err) {
            logger.error('[restart] Error while handling restart request:', err);
            console.error('[restart] Error stack:', err && err.stack);
            res.status(500).json({ error: 'Failed to trigger restart' });
        }
    });

    // --- PiAware Connectivity Status Endpoint ---
    app.get('/api/piaware-status', async (req, res) => {
        const config = require('../config-loader');
        const piAwareUrl = config.data.piAwareUrls[0];
        let originUrl = piAwareUrl;
        try {
            const u = new URL(piAwareUrl);
            originUrl = u.origin;
        } catch (err) {
            // if URL parsing fails, fall back to configured value
            originUrl = piAwareUrl;
        }

        try {
            const fetch = (await import('node-fetch')).default;
            
            // Fetch aircraft.json directly to get live aircraft count
            const aircraftJsonUrl = `${originUrl}/data/aircraft.json`;
            let aircraftCount = 0;
            let isConnected = false;
            
            try {
                const aircraftResponse = await fetch(aircraftJsonUrl, { timeout: 3000 });
                if (aircraftResponse.ok) {
                    const data = await aircraftResponse.json();
                    aircraftCount = data?.aircraft?.length || 0;
                    isConnected = true;
                    console.log(`PiAware aircraft.json: ${aircraftCount} aircraft`);
                }
            } catch (e) {
                console.log(`PiAware aircraft.json fetch failed: ${e.message}`);
                // Try root as fallback to check connectivity
                const response = await fetch(originUrl, { timeout: 3000 });
                isConnected = response.ok;
            }

            if (isConnected) {
                const state = getInMemoryState ? getInMemoryState() : {};
                res.json({
                    status: 'connected',
                    aircraft_count: aircraftCount,
                    url: originUrl,
                    receiver_lat: state.receiver_lat,
                    receiver_lon: state.receiver_lon
                });
            } else {
                res.status(response.status).json({
                    status: 'error',
                    message: `PiAware returned HTTP status ${response.status}`,
                    url: originUrl
                });
            }
        } catch (error) {
            console.error('PiAware status check failed:', error);
            let message = 'Failed to connect to PiAware.';
            if (error.name === 'AbortError') {
                message = 'Connection to PiAware timed out.';
            } else if (error.code === 'ECONNREFUSED') {
                message = 'Connection refused by PiAware device.';
            }
            res.status(500).json({
                status: 'unreachable',
                message: message,
                details: error.message,
                url: originUrl
            });
        }
    });

    // --- Health Check ---
    app.get('/api/health', (req, res) => {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            positionCacheReady: !!positionCache && positionCache.isReady(),
            serverFilesModified: checkServerFilesModified()
        });
    });

    // --- Server Status: start time and commit info ---
    app.get('/api/server-status', (req, res) => {
        res.json({
            status: 'ok',
            serverStartIso,
            serverUptimeMs: Date.now() - serverStartTs,
            gitCommit: serverGitCommit,
            gitDirty: serverGitDirty,
            timestamp: new Date().toISOString()
        });
    });

    // --- Receiver Location Endpoint ---
    app.get('/api/receiver-location', (req, res) => {
        const state = getInMemoryState();
        res.json({
            lat: state.receiver_lat || 0,
            lon: state.receiver_lon || 0,
            available: typeof state.receiver_lat === 'number' && typeof state.receiver_lon === 'number'
        });
    });

    // --- Cache Status Endpoint ---
    app.get('/api/cache-status', async (req, res) => {
        console.log('Cache status endpoint called');
        console.log('positionCache exists:', !!positionCache);
        try {
            console.log('positionCache exists:', !!positionCache);
            console.log('positionCache type:', typeof positionCache);
            if (positionCache) {
                console.log('positionCache.getStats exists:', typeof positionCache.getStats);
            }
            let cacheStats = {};
            try {
                cacheStats = positionCache?.getStats() || {};
                console.log('positionCache.getStats() succeeded:', Object.keys(cacheStats));
            } catch (cacheError) {
                console.error('Error getting position cache stats:', cacheError);
                cacheStats = { error: cacheError.message };
            }
            console.log('cacheStats:', cacheStats);
            
            console.log('Getting aircraftDB stats...');
            const aircraftDbStats = aircraftDB.getStats();
            console.log('aircraftDB stats succeeded');
            
            console.log('Getting aircraftTypesDB stats...');
            const aircraftTypesStats = aircraftTypesDB.getStats();
            console.log('aircraftTypesDB stats succeeded');
            
            // Calculate logo coverage statistics
            console.log('Getting airline database...');
            const airlineDatabase = (opts && opts.airlineDB) ? opts.airlineDB : await getAirlineDatabase(s3, readBucket);
            console.log('airlineDatabase loaded:', !!airlineDatabase);
            let airlinesWithLogos = 0;
            let cargoWithLogos = 0;
            let manufacturersWithLogos = 0;
            let totalAirlines = 0;
            let totalCargo = 0;
            let totalManufacturers = 0;
            
            if (airlineDatabase) {
                const manufacturerSet = new Set();
                for (const [code, data] of Object.entries(airlineDatabase)) {
                    if (data && typeof data === 'object' && data.name) {
                        const name = data.name.toLowerCase();
                        const isCargo = name.includes('cargo');
                        
                        if (isCargo) {
                            totalCargo++;
                            if (data.logo) {
                                cargoWithLogos++;
                            }
                        } else {
                            totalAirlines++;
                            if (data.logo) {
                                airlinesWithLogos++;
                            }
                        }
                    }
                    
                    // Check for manufacturer logos (entries that are manufacturer names)
                    if (data && typeof data === 'object' && data.name && !/^[A-Z]{3}$/.test(code)) {
                        manufacturerSet.add(data.name);
                        if (data.logo) {
                            manufacturersWithLogos++;
                        }
                    }
                }
                totalManufacturers = manufacturerSet.size;
            }
            
            // Count actual logos stored in S3
            let s3LogoCount = 0;
            try {
                const logoFiles = await listS3Files(s3, readBucket, 'logos/', 1000);
                s3LogoCount = logoFiles.length;
            } catch (error) {
                console.warn('Failed to count logos in S3:', error.message);
            }
            
            const stats = {
                positionCache: {
                    totalPositions: cacheStats.totalPositions || 0,
                    uniqueAircraft: cacheStats.uniqueAircraft || 0,
                    uniqueFlights: cacheStats.uniqueFlights || 0,
                    uniqueAirlines: cacheStats.uniqueAirlines || 0,
                    lastRefresh: cacheStats.lastRefresh || 'Never',
                    cacheMemoryMb: cacheStats.cacheMemoryMb || 0,
                    data: {} // SQLite-based cache doesn't store positionsByHex in memory
                },
                aircraftDatabase: {
                    loaded: aircraftDbStats.loaded,
                    aircraftCount: aircraftDbStats.aircraftCount,
                    source: aircraftDbStats.source,
                    downloaded: aircraftDbStats.downloaded
                },
                typeDatabase: {
                    loaded: aircraftTypesStats.loaded,
                    typeCount: aircraftTypesStats.typeCount,
                    created: aircraftTypesStats.created,
                    version: aircraftTypesStats.version
                },
                apiCache: {
                    historicalStats: Object.keys(cache.historicalStats || {}).length,
                    squawkTransitions: Object.keys(cache.squawkTransitions || {}).length,
                    airlineStats: Object.keys(cache.airlineStats || {}).length
                },
                logoCache: {
                    cachedLogos: Object.keys(cache.logoCache || {}).length,
                    totalRequests: cache.logoRequests || 0,
                    cacheHits: cache.logoCacheHits || 0,
                    cacheMisses: cache.logoCacheMisses || 0
                },
                logoCoverage: {
                    airlinesWithLogos: airlinesWithLogos,
                    totalAirlines: totalAirlines,
                    cargoWithLogos: cargoWithLogos,
                    totalCargo: totalCargo,
                    manufacturersWithLogos: manufacturersWithLogos,
                    totalManufacturers: totalManufacturers,
                    logosInS3: s3LogoCount
                },
                s3Operations: {
                    reads: cache.s3Reads || 0,
                    writes: cache.s3Writes || 0,
                    errors: cache.s3Errors || 0,
                    lastRead: cache.lastRead ? new Date(cache.lastRead).toISOString() : 'Never',
                    lastWrite: cache.lastWrite ? new Date(cache.lastWrite).toISOString() : 'Never'
                },
                tsdbOperations: {
                    writes: tsdbWriteCount || 0
                },
                lastProcessing: {
                    flights: cache.lastFlightsProcessing ? new Date(cache.lastFlightsProcessing).toISOString() : 'Never',
                    airlines: cache.lastAirlinesProcessing ? new Date(cache.lastAirlinesProcessing).toISOString() : 'Never',
                    squawks: cache.lastSquawksProcessing ? new Date(cache.lastSquawksProcessing).toISOString() : 'Never',
                    heatmap: cache.lastHeatmapProcessing ? new Date(cache.lastHeatmapProcessing).toISOString() : 'Never',
                    positions: cache.lastPositionsProcessing ? new Date(cache.lastPositionsProcessing).toISOString() : 'Never',
                    hourlyRollup: cache.lastHourlyRollup ? new Date(cache.lastHourlyRollup).toISOString() : 'Never'
                }
            };
            res.json(stats);
        } catch (error) {
            console.error('Error getting cache status:', error);
            res.status(500).json({ error: 'Failed to get cache status' });
        }
    });

    // --- Cache Status V2 (Improved) ---
    app.get('/api/v2/cache-status', async (req, res) => {
        try {
            const stats = {
                timestamp: new Date().toISOString(),
                version: '2.0',
                positionCache: {},
                aircraftDatabase: {},
                typeDatabase: {},
                apiCache: {},
                logoCache: {},
                logoCoverage: {},
                s3Operations: {},
                tsdbOperations: {},
                lastProcessing: {},
                health: {}
            };

            // Position Cache Stats (with error handling)
            try {
                if (positionCache && typeof positionCache.getStats === 'function') {
                    const cacheStats = positionCache.getStats();
                    stats.positionCache = {
                        totalPositions: cacheStats.totalPositions || 0,
                        uniqueAircraft: cacheStats.uniqueAircraft || 0,
                        uniqueFlights: cacheStats.uniqueFlights || 0,
                        uniqueAirlines: cacheStats.uniqueAirlines || 0,
                        lastRefresh: cacheStats.lastRefresh || 'Never',
                        cacheMemoryMb: cacheStats.cacheMemoryMb || '0.00',
                        oldestPositionAge: cacheStats.oldestPositionAge || 0,
                        oldestPositionDate: cacheStats.oldestPositionDate || 'N/A',
                        ready: positionCache.isReady ? positionCache.isReady() : false
                    };
                } else {
                    stats.positionCache = {
                        error: 'PositionCache not available',
                        ready: false
                    };
                }
            } catch (error) {
                stats.positionCache = {
                    error: error.message,
                    ready: false
                };
            }

            // Aircraft Database Stats
            try {
                const aircraftDbStats = aircraftDB.getStats();
                stats.aircraftDatabase = {
                    loaded: aircraftDbStats.loaded,
                    aircraftCount: aircraftDbStats.aircraftCount,
                    source: aircraftDbStats.source,
                    downloaded: aircraftDbStats.downloaded,
                    ready: aircraftDB.isReady ? aircraftDB.isReady() : false
                };
            } catch (error) {
                stats.aircraftDatabase = {
                    error: error.message,
                    ready: false
                };
            }

            // Type Database Stats
            try {
                const aircraftTypesStats = aircraftTypesDB.getStats();
                stats.typeDatabase = {
                    loaded: aircraftTypesStats.loaded,
                    typeCount: aircraftTypesStats.typeCount,
                    created: aircraftTypesStats.created,
                    version: aircraftTypesStats.version,
                    ready: aircraftTypesDB.isReady ? aircraftTypesDB.isReady() : false
                };
            } catch (error) {
                stats.typeDatabase = {
                    error: error.message,
                    ready: false
                };
            }

            // API Cache Stats
            stats.apiCache = {
                historicalStats: Object.keys(cache.historicalStats || {}).length,
                squawkTransitions: Object.keys(cache.squawkTransitions || {}).length,
                airlineStats: Object.keys(cache.airlineStats || {}).length
            };

            // Logo Cache Stats
            stats.logoCache = {
                cachedLogos: Object.keys(cache.logoCache || {}).length,
                totalRequests: cache.logoRequests || 0,
                cacheHits: cache.logoCacheHits || 0,
                cacheMisses: cache.logoCacheMisses || 0
            };

            // Logo Coverage (simplified for v2)
            try {
                const airlineDatabase = (opts && opts.airlineDB) ? opts.airlineDB : await getAirlineDatabase(s3, readBucket);
                let airlinesWithLogos = 0;
                let totalAirlines = 0;

                if (airlineDatabase && typeof airlineDatabase === 'object') {
                    for (const [code, data] of Object.entries(airlineDatabase)) {
                        if (data && typeof data === 'object' && data.name && /^[A-Z]{3}$/.test(code)) {
                            totalAirlines++;
                            if (data.logo) {
                                airlinesWithLogos++;
                            }
                        }
                    }
                }

                stats.logoCoverage = {
                    airlinesWithLogos: airlinesWithLogos,
                    totalAirlines: totalAirlines,
                    coveragePercent: totalAirlines > 0 ? Math.round((airlinesWithLogos / totalAirlines) * 100) : 0
                };
            } catch (error) {
                stats.logoCoverage = {
                    error: error.message
                };
            }

            // S3 Operations
            stats.s3Operations = {
                reads: cache.s3Reads || 0,
                writes: cache.s3Writes || 0,
                errors: cache.s3Errors || 0,
                lastRead: cache.lastRead ? new Date(cache.lastRead).toISOString() : 'Never',
                lastWrite: cache.lastWrite ? new Date(cache.lastWrite).toISOString() : 'Never'
            };

            // TSDB Operations
            stats.tsdbOperations = {
                writes: tsdbWriteCount || 0
            };

            // Last Processing Times
            stats.lastProcessing = {
                flights: cache.lastFlightsProcessing ? new Date(cache.lastFlightsProcessing).toISOString() : 'Never',
                airlines: cache.lastAirlinesProcessing ? new Date(cache.lastAirlinesProcessing).toISOString() : 'Never',
                squawks: cache.lastSquawksProcessing ? new Date(cache.lastSquawksProcessing).toISOString() : 'Never',
                heatmap: cache.lastHeatmapProcessing ? new Date(cache.lastHeatmapProcessing).toISOString() : 'Never',
                positions: cache.lastPositionsProcessing ? new Date(cache.lastPositionsProcessing).toISOString() : 'Never',
                hourlyRollup: cache.lastHourlyRollup ? new Date(cache.lastHourlyRollup).toISOString() : 'Never'
            };

            // Health Check
            stats.health = {
                overall: 'healthy',
                issues: []
            };

            // Check for issues
            if (!stats.positionCache.ready) {
                stats.health.issues.push('PositionCache not ready');
                stats.health.overall = 'degraded';
            }
            if (!stats.aircraftDatabase.ready) {
                stats.health.issues.push('Aircraft database not ready');
                stats.health.overall = 'degraded';
            }
            if (!stats.typeDatabase.ready) {
                stats.health.issues.push('Type database not ready');
                stats.health.overall = 'degraded';
            }
            if (stats.s3Operations.errors > 10) {
                stats.health.issues.push('High S3 error count');
                stats.health.overall = 'warning';
            }

            res.json(stats);
        } catch (error) {
            console.error('Error getting cache status v2:', error);
            res.status(500).json({
                error: 'Failed to get cache status',
                timestamp: new Date().toISOString(),
                version: '2.0'
            });
        }
    });

    // --- Airline Database Endpoint ---
    app.get('/api/airline-database', async (req, res) => {
        try {
            const airlineDatabase = (opts && opts.airlineDB) ? opts.airlineDB : await getAirlineDatabase(s3, readBucket);
            // Airline DB is a fairly large JSON object; allow the client to cache it for a short time
            // to avoid repeated downloads and browser conditional requests. We keep the TTL at 1 hour.
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.json(airlineDatabase || {});
        } catch (error) {
            console.error('Error getting airline database:', error);
            res.status(500).json({ error: 'Failed to get airline database' });
        }
    });

    // --- UI Config Endpoint ---
    app.get('/api/config', (req, res) => {
        try {
            const config = require('../config-loader');
            console.log('Config loaded, accessing UI properties...');
            const result = {
                defaultTimeRanges: config.get('ui', 'defaultTimeRanges'),
                quickTimeButtons: config.get('ui', 'quickTimeButtons'),
                graph: config.get('ui', 'graph'),
                reception: config.get('ui', 'reception'),
                heatmap: {
                    ...config.get('ui', 'heatmap'),
                    mapCenter: config.mapCenter
                },
                table: config.get('ui', 'table'),
                flightAware: {
                    enabled: config.get('flightaware', 'enabled') || false
                }
            };
            console.log('Config result:', JSON.stringify(result, null, 2));
            res.json(result);
        } catch (error) {
            console.error('Error loading config:', error);
            res.status(500).json({ error: 'Failed to load config' });
        }
    });

    // --- Aircraft Lookup Endpoint (ICAO24 to Registration) ---
    app.get('/api/aircraft/:icao24', (req, res) => {
        try {
            const icao24 = req.params.icao24;
            const aircraft = aircraftDB.lookup(icao24);
            
            if (!aircraft) {
                // Return 200 with null data instead of 404 to avoid browser network errors
                return res.json({ 
                    icao24: icao24.toLowerCase(),
                    error: 'Aircraft not found in database'
                });
            }
            
            res.json({
                icao24: icao24.toLowerCase(),
                ...aircraft
            });
        } catch (error) {
            console.error('Error looking up aircraft:', error);
            res.status(500).json({ error: 'Failed to lookup aircraft' });
        }
    });

    // --- Aircraft Database Status ---
    app.get('/api/aircraft-database/status', (req, res) => {
        try {
            const stats = aircraftDB.getStats();
            res.json(stats);
        } catch (error) {
            console.error('Error getting aircraft database status:', error);
            res.status(500).json({ error: 'Failed to get database status' });
        }
    });

    // --- Batch Aircraft Lookup ---
    app.post('/api/aircraft/batch', (req, res) => {
        try {
            const icao24List = req.body.icao24 || [];
            
            if (!Array.isArray(icao24List)) {
                return res.status(400).json({ error: 'Request body must contain an array of icao24 codes' });
            }
            
            const results = {};
            for (const icao24 of icao24List) {
                const aircraft = aircraftDB.lookup(icao24);
                if (aircraft) {
                    results[icao24.toLowerCase()] = aircraft;
                }
            }
            
            res.json({
                requested: icao24List.length,
                found: Object.keys(results).length,
                results: results
            });
        } catch (error) {
            console.error('Error in batch aircraft lookup:', error);
            res.status(500).json({ error: 'Failed to lookup aircraft' });
        }
    });

        // --- Batch Flights Lookup (lightweight) ---
        // Accepts { icao24: ['a1b2c3', ...] } and returns { results: { '<icao>': { ... } } }
        // This endpoint is intentionally lightweight: it prefers in-memory active flights,
        // then falls back to aircraft DB entries. It avoids expensive S3 scans to keep
        // responses fast for frontend batch enrichment.
        app.post('/api/flights/batch', (req, res) => {
            try {
                const icao24List = req.body && req.body.icao24 ? req.body.icao24 : [];
                if (!Array.isArray(icao24List)) {
                    return res.status(400).json({ error: 'Request body must contain an array of icao24 codes' });
                }

                const results = {};
                const state = getInMemoryState ? getInMemoryState() : {};
                const activeFlights = state.activeFlights || {};

                for (const raw of icao24List) {
                    if (!raw) continue;
                    const lk = raw.toString().toLowerCase();

                    // Prefer an active flight if available
                    if (activeFlights && activeFlights[lk]) {
                        results[lk] = activeFlights[lk];
                        continue;
                    }

                    // Fallback to aircraft DB lookup (registration/type info)
                    try {
                        const aircraft = aircraftDB.lookup(raw);
                        if (aircraft) {
                            results[lk] = aircraft;
                            continue;
                        }
                    } catch (err) {
                        // ignore individual lookup errors
                    }
                }

                res.json({ requested: icao24List.length, found: Object.keys(results).length, results });
            } catch (error) {
                console.error('Error in batch flights lookup:', error);
                res.status(500).json({ error: 'Failed to lookup flights' });
            }
        });

    // --- Logo Serving Endpoint ---
    app.get('/api/v1logos/:airlineCode', async (req, res) => {
        try {
            // Initialize logo cache stats if not exists
            if (!cache.logoRequests) cache.logoRequests = 0;
            if (!cache.logoCacheHits) cache.logoCacheHits = 0;
            if (!cache.logoCacheMisses) cache.logoCacheMisses = 0;
            
            cache.logoRequests++;
            
            const airlineCode = req.params.airlineCode.toUpperCase();
            let logoKey = `logos/${airlineCode}.png`;

            // Check if logo is cached in memory
            if (!cache.logoCache) {
                cache.logoCache = {};
            }

            // Clear cache for CESSNA (temporary fix)
            if (airlineCode === 'CESSNA') {
                delete cache.logoCache[airlineCode];
            }

            if (cache.logoCache[airlineCode]) {
                // Serve from cache - handle both old and new cache formats
                cache.logoCacheHits++;
                const cached = cache.logoCache[airlineCode];
                if (cached.buffer && cached.contentType) {
                    // New format
                    res.setHeader('Content-Type', cached.contentType);
                    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
                    res.setHeader('X-Cache', 'HIT'); // Indicate cache hit
                    res.send(cached.buffer);
                } else {
                    // Old format (buffer only)
                    res.setHeader('Content-Type', 'image/png');
                    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
                    res.setHeader('X-Cache', 'HIT'); // Indicate cache hit
                    res.send(cached);
                }
                return;
            }

            // Cache miss - increment counter
            cache.logoCacheMisses++;

            // Try PNG first, then SVG
            let data;
            let contentType = 'image/png';
            try {
                const params = {
                    Bucket: readBucket,
                    Key: logoKey
                };
                data = await s3.send(new GetObjectCommand(params));
            } catch (pngError) {
                // Try SVG
                logoKey = `logos/${airlineCode}.svg`;
                contentType = 'image/svg+xml';
                const params = {
                    Bucket: readBucket,
                    Key: logoKey
                };
                data = await s3.send(new GetObjectCommand(params));
            }

            // Read the entire logo into memory as buffer
            const chunks = [];
            for await (const chunk of data.Body) {
                chunks.push(chunk);
            }
            const logoBuffer = Buffer.concat(chunks);

            // Cache the logo buffer with content type
            cache.logoCache[airlineCode] = { buffer: logoBuffer, contentType };

            // Set appropriate headers
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
            res.setHeader('X-Cache', 'MISS'); // Indicate cache miss

            // Send the logo data
            res.send(logoBuffer);

        } catch (error) {
            // If logo not found, return a default response
            res.status(404).json({ error: 'Logo not found' });
        }
    });

    // --- Logo Serving Endpoint v2 ---
    app.get('/api/v2logos/:airlineCode', async (req, res) => {
        try {
            // Initialize logo cache stats if not exists
            if (!cache.logoRequests) cache.logoRequests = 0;
            if (!cache.logoCacheHits) cache.logoCacheHits = 0;
            if (!cache.logoCacheMisses) cache.logoCacheMisses = 0;
            
            cache.logoRequests++;
            
            const airlineCode = req.params.airlineCode.toUpperCase();
            let logoKey = `logos/${airlineCode}.png`;

            // Check if logo is cached in memory
            if (!cache.logoCache) {
                cache.logoCache = {};
            }

            // Clear cache for CESSNA (temporary fix)
            if (airlineCode === 'CESSNA') {
                delete cache.logoCache[airlineCode];
            }

            if (cache.logoCache[airlineCode]) {
                // Serve from cache - handle both old and new cache formats
                cache.logoCacheHits++;
                const cached = cache.logoCache[airlineCode];
                if (cached.buffer && cached.contentType) {
                    // New format
                    res.setHeader('Content-Type', cached.contentType);
                    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
                    res.setHeader('X-Cache', 'HIT'); // Indicate cache hit
                    res.send(cached.buffer);
                } else {
                    // Old format (buffer only)
                    res.setHeader('Content-Type', 'image/png');
                    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
                    res.setHeader('X-Cache', 'HIT'); // Indicate cache hit
                    res.send(cached);
                }
                return;
            }

            // Cache miss - increment counter
            cache.logoCacheMisses++;

            // Try PNG first, then SVG
            let data;
            let contentType = 'image/png';
            try {
                const params = {
                    Bucket: readBucket,
                    Key: logoKey
                };
                data = await s3.send(new GetObjectCommand(params));
            } catch (pngError) {
                // Try SVG
                logoKey = `logos/${airlineCode}.svg`;
                contentType = 'image/svg+xml';
                const params = {
                    Bucket: readBucket,
                    Key: logoKey
                };
                data = await s3.send(new GetObjectCommand(params));
            }

            // Read the entire logo into memory as buffer
            const chunks = [];
            for await (const chunk of data.Body) {
                chunks.push(chunk);
            }
            const logoBuffer = Buffer.concat(chunks);

            // Cache the logo buffer with content type
            cache.logoCache[airlineCode] = { buffer: logoBuffer, contentType };

            // Set appropriate headers
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
            res.setHeader('X-Cache', 'MISS'); // Indicate cache miss

            // Send the logo data
            res.send(logoBuffer);

        } catch (error) {
            // If logo not found, return a default response
            res.status(404).json({ error: 'Logo not found' });
        }
    });

    // --- Aircraft Types Endpoint ---
    app.get('/api/aircraft-types', async (req, res) => {
        try {
            const fs = require('fs').promises;
            const data = await fs.readFile('aircraft_types.json', 'utf8');
            const aircraftTypes = JSON.parse(data);
            res.json(aircraftTypes);
        } catch (error) {
            console.error('Error loading aircraft types:', error);
            res.status(500).json({ error: 'Failed to load aircraft types' });
        }
    });

    // --- Airlines Endpoint ---
    app.get('/api/airlines', async (req, res) => {
        try {
            // Prefer the S3-backed airline database (keeps logos up-to-date).
            const airlineDatabase = (opts && opts.airlineDB) ? opts.airlineDB : await getAirlineDatabase(s3, readBucket);
            // Return the airline database object (fallback to empty object handled in getAirlineDatabase)
            // Allow the browser to cache for a short time; avoid unnecessary repeated downloads
            res.setHeader('Cache-Control', 'public, max-age=3600');
            return res.json(airlineDatabase);
        } catch (error) {
            console.error('Error loading airlines:', error);
            res.status(500).json({ error: 'Failed to load airlines' });
        }
    });

    // --- Heatmap Endpoint (uses cached in-memory data) ---
    app.get('/api/heatmap', async (req, res) => {
        try {
            const { airline, type, manufacturer, window } = req.query;

            // Convert window to hours for TSDB query
            let hours = 168; // Default to 7 days
            if (window && window !== 'all') {
                if (window === '1h') hours = 1;
                else if (window === '4h') hours = 4;
                else if (window === '6h') hours = 6;
                else if (window === '12h') hours = 12;
                else if (window === '24h') hours = 24;
                else if (window === '7d') hours = 168;
            } else if (window === 'all') {
                hours = 168; // Use 7 days for 'all' to avoid excessive data
            }

            console.log(`[heatmap] Querying TSDB for ${hours}h window`);

            // Query TSDB for positions, fall back to S3 if no data
            let positions = [];
            try {
                const tsdbResult = await queryPositionsFromTSDB(hours);
                positions = tsdbResult || [];
                console.log(`[heatmap] Retrieved ${positions.length} positions from TSDB`);
                
                // If TSDB returns no data, fall back to S3
                if (positions.length === 0) {
                    console.log('[heatmap] TSDB returned no data, falling back to S3');
                    const recentCutoff = Date.now() - (hours * 60 * 60 * 1000);
                    positions = (await loadRecentHeatmapPositions(s3, writeBucket, writeBucket, recentCutoff)) || [];
                    console.log(`[heatmap] S3 fallback returned ${positions.length} positions`);
                }
            } catch (error) {
                console.warn('[heatmap] TSDB query failed, falling back to S3:', error.message);
                // Fall back to S3 if TSDB fails
                const recentCutoff = Date.now() - (hours * 60 * 60 * 1000);
                positions = (await loadRecentHeatmapPositions(s3, writeBucket, writeBucket, recentCutoff)) || [];
                console.log(`[heatmap] S3 fallback returned ${positions.length} positions`);
            }

            if (positions.length === 0) {
                console.log('[heatmap] No positions available from TSDB');
                return res.json([]);
            }

            // Apply additional filters (airline, type, manufacturer) if specified
            if (airline) {
                positions = positions.filter(pos => {
                    const callsign = (pos.flight || pos.Flight || '').trim().toUpperCase();
                    return callsign.length >= 3 && callsign.startsWith(airline.toUpperCase());
                });
                console.log(`[heatmap] Filtered to ${positions.length} positions for airline ${airline}`);
            }

            if (type) {
                positions = positions.filter(pos => (pos.aircraft_type || '').toLowerCase().includes(type.toLowerCase()));
                console.log(`[heatmap] Filtered to ${positions.length} positions for type ${type}`);
            }

            if (manufacturer) {
                positions = positions.filter(pos => (pos.manufacturer || '').toLowerCase().includes(manufacturer.toLowerCase()));
                console.log(`[heatmap] Filtered to ${positions.length} positions for manufacturer ${manufacturer}`);
            }

            // Filter and aggregate positions
            const grid = {};
            const gridSize = 1.852 / 111; // ~1 nautical mile
            let filtered = 0;

            for (const pos of positions) {
                // Apply type filter
                if (type && (!pos.aircraft_type || !pos.aircraft_type.toLowerCase().includes(type.toLowerCase()))) {
                    continue;
                }

                // Apply manufacturer filter
                if (manufacturer && (!pos.manufacturer || !pos.manufacturer.toLowerCase().includes(manufacturer.toLowerCase()))) {
                    continue;
                }

                // Aggregate into grid cell
                const latIdx = Math.floor(pos.lat / gridSize);
                const lonIdx = Math.floor(pos.lon / gridSize);
                const key = `${latIdx},${lonIdx}`;

                if (!grid[key]) {
                    grid[key] = {
                        lat_min: latIdx * gridSize,
                        lat_max: (latIdx + 1) * gridSize,
                        lon_min: lonIdx * gridSize,
                        lon_max: (lonIdx + 1) * gridSize,
                        count: 0
                    };
                }
                grid[key].count++;
                filtered++;
            }

            const gridData = Object.values(grid);
            console.log(`[heatmap] Window=${window} (${hours}h) → Filtered ${filtered}/${positions.length} → ${gridData.length} cells (mfg=${manufacturer}, type=${type}, airline=${airline})`);

            res.json(gridData);
            
        } catch (error) {
            console.error('Error in heatmap endpoint:', error);
            res.status(500).json({ error: 'Failed to generate heatmap data', details: error.message });
        }
    });
    
    // Helper function to load positions from S3 files into memory
    async function loadHeatmapPositionsFromFiles(s3, bucket, minuteFiles) {
        if (!minuteFiles || minuteFiles.length === 0) {
            console.log('[heatmap] No minute files provided');
            return [];
        }
        
        const allPositions = [];
        const sortedFiles = minuteFiles.sort((a, b) => b.Key.localeCompare(a.Key));
        const filesToLoad = sortedFiles.slice(0, Math.min(sortedFiles.length, 10000));
        
        console.log(`[heatmap] Loading ${filesToLoad.length} files into memory with enrichment...`);
        
        // Load aircraft cache for enrichment
        const cache = await loadAircraftCache();
        
        let loadedCount = 0;
        let enrichedCount = 0;
        
        for (const file of filesToLoad) {
            try {
                const data = await downloadAndParseS3File(s3, bucket, file.Key);
                if (data) {
                    const positions = Array.isArray(data) ? data : [data];
                    const validPositions = positions.filter(pos => {
                        if (!pos) return false;
                        const lat = pos.lat || pos.Latitude || pos.latitude;
                        const lon = pos.lon || pos.Longitude || pos.longitude;
                        return lat && lon && typeof lat === 'number' && typeof lon === 'number';
                    }).map(pos => {
                        // Normalize position data
                        const icao = pos.ICAO || pos.hex || pos.icao;
                        let aircraftType = pos.Aircraft_type || pos.type || pos.aircraft_type;
                        
                        // Enrich with aircraft database (get typecode)
                        if (icao && cache.aircraft && cache.aircraft[icao] && cache.aircraft[icao].typecode) {
                            aircraftType = cache.aircraft[icao].typecode;
                            enrichedCount++;
                        }
                        
                        // Enrich with type info (manufacturer, body type)
                        let manufacturer = pos.manufacturer;
                        let bodyType = pos.bodyType;
                        if (aircraftType && aircraftType !== 'N/A') {
                            const typeInfo = aircraftTypesDB.lookup(aircraftType);
                            if (typeInfo) {
                                manufacturer = typeInfo.manufacturer;
                                bodyType = typeInfo.bodyType;
                            }
                        }
                        
                        return {
                            lat: pos.lat || pos.Latitude || pos.latitude,
                            lon: pos.lon || pos.Longitude || pos.longitude,
                            timestamp: pos.timestamp || pos.Timestamp || pos.First_Seen || pos.Last_Seen || file.LastModified,
                            Aircraft_type: aircraftType,
                            Flight: pos.Flight || pos.flight || pos.callsign,
                            manufacturer: manufacturer,
                            bodyType: bodyType,
                            ICAO: icao,
                            // Provide a normalized hex field for downstream lookups (lowercase)
                            hex: icao ? String(icao).toLowerCase() : undefined,
                            // Preserve common squawk field names if present
                            squawk: pos.squawk || pos.Squawk || pos.sqk || null,
                            Registration: pos.Registration || pos.registration
                        };
                    });
                    
                    allPositions.push(...validPositions);
                    loadedCount++;
                }
            } catch (err) {
                console.warn(`[heatmap] Error loading ${file.Key}: ${err.message}`);
            }
        }
        
        console.log(`[heatmap] Loaded ${allPositions.length} positions from ${loadedCount} files (enriched ${enrichedCount} with aircraft DB)`);
        return allPositions;
    }

    // Endpoint to clear heatmap cache
    app.get('/api/heatmap-cache-clear', (req, res) => {
        clearHeatmapCache();
        res.json({ message: 'Heatmap cache cleared' });
    });

    // Debug endpoint to check heatmap data loading stats
    app.get('/api/heatmap-stats', async (req, res) => {
        try {
            // Use 30-day cutoff for stats (instead of loading all historical data)
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            const allPositions = await loadRecentHeatmapPositions(s3, readBucket, writeBucket, thirtyDaysAgo);
            
            // Count positions with and without aircraft type
            let withType = 0, withoutType = 0, withManufacturer = 0;
            const manufacturerCounts = {};
            const typeCounts = {};
            let minTimestamp = Infinity, maxTimestamp = -Infinity;
            
            for (const pos of allPositions) {
                if (pos.Aircraft_type && pos.Aircraft_type !== 'N/A') {
                    withType++;
                    typeCounts[pos.Aircraft_type] = (typeCounts[pos.Aircraft_type] || 0) + 1;
                } else {
                    withoutType++;
                }
                
                if (pos.manufacturer) {
                    withManufacturer++;
                    manufacturerCounts[pos.manufacturer] = (manufacturerCounts[pos.manufacturer] || 0) + 1;
                }
                
                // Track timestamp range
                if (pos.timestamp) {
                    let ts;
                    if (typeof pos.timestamp === 'number') {
                        ts = pos.timestamp < 10000000000 ? pos.timestamp * 1000 : pos.timestamp;
                    } else if (typeof pos.timestamp === 'string') {
                        ts = new Date(pos.timestamp).getTime();
                    }
                    if (ts && !isNaN(ts)) {
                        minTimestamp = Math.min(minTimestamp, ts);
                        maxTimestamp = Math.max(maxTimestamp, ts);
                    }
                }
            }
            
            // Get top manufacturers
            const topManufacturers = Object.entries(manufacturerCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10);
            
            // Get top types
            const topTypes = Object.entries(typeCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10);
            
            // Calculate date range
            let dateRangeInfo = {
                hasTimestamps: minTimestamp !== Infinity && maxTimestamp !== -Infinity
            };
            if (dateRangeInfo.hasTimestamps) {
                dateRangeInfo.minDate = new Date(minTimestamp).toISOString();
                dateRangeInfo.maxDate = new Date(maxTimestamp).toISOString();
                dateRangeInfo.spanDays = Math.round((maxTimestamp - minTimestamp) / (1000 * 60 * 60 * 24));
                dateRangeInfo.spanHours = Math.round((maxTimestamp - minTimestamp) / (1000 * 60 * 60));
            }
            
            res.json({
                totalPositions: allPositions.length,
                positionsWithType: withType,
                positionsWithoutType: withoutType,
                positionsWithManufacturer: withManufacturer,
                topManufacturers: Object.fromEntries(topManufacturers),
                topTypes: Object.fromEntries(topTypes),
                dateRange: dateRangeInfo
            });
        } catch (error) {
            console.error('Error in heatmap-stats endpoint:', error);
            res.status(500).json({ error: 'Failed to get heatmap stats', details: error.message });
        }
    });

    // --- Positions Endpoint ---
    app.get('/api/positions', async (req, res) => {
        try {
            const hours = parseFloat(req.query.hours || '24');
            const config = require('../config.json');
            const defaultSource = config.storage?.positions || 's3';
            const source = req.query.source || defaultSource; // memory, sqlite, tsdb, s3
            
            // Dynamic limit based on time window to prevent excessive data
            let defaultLimit = 50000;
            if (hours <= 1) defaultLimit = 10000; // 10k for 1 hour
            else if (hours <= 4) defaultLimit = 25000; // 25k for 4 hours
            else if (hours <= 12) defaultLimit = 35000; // 35k for 12 hours
            // 50k for longer periods
            
            const maxPositions = parseInt(req.query.limit || defaultLimit.toString(), 10);
            
            let positions = [];
            
            switch (source) {
                case 'memory':
                    // Fall back to in-memory position history
                    positions = getInMemoryState()?.positionHistory || [];
                    break;
                    
                case 'sqlite':
                    // Get positions from SQLite cache
                    positions = positionCache?.getPositionsByTimeWindow(hours) || [];
                    break;
                    
                case 'tsdb':
                    // Query TSDB for positions
                    try {
                        const tsdbResult = await queryPositionsFromTSDB(hours);
                        positions = tsdbResult || [];
                    } catch (error) {
                        console.warn('TSDB query failed:', error.message);
                        positions = [];
                    }
                    break;
                    
                case 's3':
                    // Use TSDB for recent data (up to 1.5 hours) - no S3 fallback
                    if (hours <= 1.5) {
                        try {
                            console.log(`Using TSDB for ${hours} hours of positions (no fallback)`);
                            positions = await queryPositionsFromTSDB(hours) || [];
                            console.log(`TSDB returned ${positions.length} positions`);
                        } catch (error) {
                            console.warn('TSDB query failed:', error.message);
                            positions = [];
                        }
                    } else {
                        // Use S3 for older data (> 1.5 hours)
                        const recentCutoff = Date.now() - (hours * 60 * 60 * 1000);
                        positions = (await loadRecentHeatmapPositions(s3, writeBucket, writeBucket, recentCutoff)) || [];
                    }
                    break;
                    
                default:
                    positions = getInMemoryState()?.positionHistory || [];
            }
            
            // Filter out positions older than 90 seconds to exclude timed-out aircraft
            const now = Date.now();
            // const maxAgeMs = 90 * 1000; // 90 seconds
            // positions = positions.filter(p => (now - p.timestamp) <= maxAgeMs);
            
            // Limit to maximum 100 positions per aircraft, keeping the most recent
            const positionsByHex = new Map();
            for (const pos of positions) {
                const hex = pos.hex || pos.HEX || pos.icao || pos.icao24 || '';
                if (!hex) continue;
                
                if (!positionsByHex.has(hex)) {
                    positionsByHex.set(hex, []);
                }
                positionsByHex.get(hex).push(pos);
            }
            
            // Apply decaying retention: keep more recent positions with higher resolution
            const limitedPositions = [];
            
            for (const [hex, posList] of positionsByHex.entries()) {
                // Sort by timestamp descending (most recent first)
                posList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                
                const selectedPositions = [];
                
                // Track how many positions we've seen in each age bracket for sampling
                let recentCount = 0;
                let mediumCount = 0; 
                let oldCount = 0;
                let ancientCount = 0;
                
                // Apply decaying sampling based on age ranges
                for (const pos of posList) {
                    if (selectedPositions.length >= 100) break; // Max 100 positions per aircraft
                    
                    const ageSeconds = (now - pos.timestamp) / 1000;
                    
                    let shouldKeep = false;
                    
                    if (ageSeconds <= 10) {
                        // Keep all positions from last 10 seconds
                        shouldKeep = true;
                    } else if (ageSeconds <= 30) {
                        // Keep every 2nd position from 10-30 seconds ago
                        shouldKeep = (mediumCount % 2 === 0);
                        mediumCount++;
                    } else if (ageSeconds <= 60) {
                        // Keep every 5th position from 30-60 seconds ago
                        shouldKeep = (oldCount % 5 === 0);
                        oldCount++;
                    } else {
                        // Keep every 10th position from 60-90 seconds ago
                        shouldKeep = (ancientCount % 10 === 0);
                        ancientCount++;
                    }
                    
                    if (shouldKeep) {
                        selectedPositions.push(pos);
                    }
                }
                
                limitedPositions.push(...selectedPositions);
            }
            
            positions = limitedPositions;
            
            // Deduplicate positions by hex, lat, lon, alt (keep most recent)
            const seen = new Set();
            const deduplicated = [];
            for (const pos of positions) {
                const key = `${pos.hex || pos.ICAO || ''}_${pos.lat}_${pos.lon}_${pos.alt || 0}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    deduplicated.push(pos);
                }
            }
            positions = deduplicated;
            console.log(`Deduplicated positions: ${positions.length} unique from ${limitedPositions.length} total`);
            
            // If too many positions, sample them to prevent browser slowdown
            if (positions.length > maxPositions) {
                console.log(`Sampling ${maxPositions} positions from ${positions.length} total for ${hours}h window`);
                // Sample evenly across the time window
                const sampled = [];
                const step = Math.floor(positions.length / maxPositions);
                for (let i = 0; i < positions.length && sampled.length < maxPositions; i += step) {
                    sampled.push(positions[i]);
                }
                positions = sampled;
            }
            
            const aircraftCount = positionsByHex.size;
            // Prevent caching of live position data
            res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.set('Pragma', 'no-cache');
            res.set('Expires', '0');
            res.json({
                aircraftCount,
                positions,
                totalPositions: positions.length,
                sampled: positions.length < maxPositions ? false : true
            });
        } catch (error) {
            console.error('Error in positions endpoint:', error);
            res.status(500).json({ error: 'Failed to get positions' });
        }
    });

    // --- Squawk Lookup Endpoint ---
    // Returns the most-recent squawk value known for a given hex (icao24)
    app.get('/api/squawk', async (req, res) => {
        try {
            const hexRaw = (req.query.hex || '').toString().trim();
            if (!hexRaw) return res.status(400).json({ error: 'Missing hex parameter' });
            const hex = hexRaw.toLowerCase();

            // Attempt to find recent positions for this hex and return the newest squawk
            const positions = positionCache?.getAircraftPositions(hex) || [];
            let squawk = null;
            if (Array.isArray(positions) && positions.length > 0) {
                for (const p of positions) {
                    if (p && (p.squawk || p.sqk)) {
                        squawk = p.squawk || p.sqk || null;
                        if (squawk) break; // Found a squawk, no need to look further
                    }
                }
            }

            // If no squawk found in live data, check historical data
            if (!squawk && allHeatmapPositions) {
                const historicalPositions = allHeatmapPositions.filter(p => {
                    // Match either normalized `hex` or the original `ICAO` field (case-insensitive)
                    const pHex = p.hex || (p.ICAO ? String(p.ICAO).toLowerCase() : null);
                    const hasSquawk = p.squawk || p.sqk || p.Squawk;
                    return pHex === hex && hasSquawk;
                });
                if (historicalPositions.length > 0) {
                    // Sort by timestamp descending to get the most recent
                    historicalPositions.sort((a, b) => ( (b.timestamp || 0) - (a.timestamp || 0) ));
                    squawk = historicalPositions[0].squawk || historicalPositions[0].sqk || historicalPositions[0].Squawk || null;
                }
            }

            return res.json({ squawk });
        } catch (err) {
            console.error('[squawk-api] Error:', err);
            res.status(500).json({ error: 'Failed to lookup squawk' });
        }
    });

    // --- Lightweight Flight Lookup (single aircraft) ---
    // Returns a small `flight` object for a given icao/hex to support client-side polling
    app.get('/api/flight', async (req, res) => {
        try {
            const icaoRaw = (req.query.icao || req.query.hex || '').toString().trim();
            if (!icaoRaw) return res.status(400).json({ error: 'Missing icao/hex parameter' });
            const icao = icaoRaw.toLowerCase();

            // 1. Check LRU cache first (fastest)
            const cached = flightApiCache.get(icao);
            if (cached) {
                return res.json({ flight: cached });
            }

            let flight = null;

            // 2. Check positionCache (in-memory SQLite)
            const positions = positionCache?.getAircraftPositions(icao) || [];
            if (positions && positions.length > 0) {
                const recent = positions[0];
                flight = {
                    icao: recent.hex,
                    flight: recent.callsign || recent.flight || '',
                    callsign: recent.callsign || recent.flight || '',
                    registration: recent.registration || recent.Reg || '',
                    squawk: recent.squawk || recent.sqk || null,
                    sqk: recent.squawk || recent.sqk || null,
                    lat: recent.lat,
                    lon: recent.lon,
                    alt: recent.alt,
                    gs: recent.gs,
                    track: recent.track || recent.heading || null,
                    timestamp: recent.timestamp
                };
            }

            // 3. Check in-memory ICAO flight index (from recent hourly files)
            if (!flight && icaoFlightIndex.has(icao)) {
                const indexedFlight = icaoFlightIndex.get(icao);
                flight = {
                    icao: indexedFlight.icao,
                    flight: indexedFlight.callsign || '',
                    callsign: indexedFlight.callsign || '',
                    registration: indexedFlight.registration || '',
                    type: indexedFlight.type || '',
                    squawk: null,
                    sqk: null,
                    lat: null,
                    lon: null,
                    alt: null,
                    gs: null,
                    track: null,
                    timestamp: null,
                    source: 'index'
                };
            }

            // 4. Check heatmap positions as fallback
            if (!flight && allHeatmapPositions) {
                const heatmapMatch = allHeatmapPositions.find(p => {
                    const pHex = (p.hex || p.ICAO || '').toLowerCase();
                    return pHex === icao;
                });
                if (heatmapMatch) {
                    flight = {
                        icao: heatmapMatch.hex || heatmapMatch.ICAO,
                        flight: heatmapMatch.callsign || '',
                        callsign: heatmapMatch.callsign || '',
                        registration: heatmapMatch.registration || '',
                        squawk: heatmapMatch.squawk || null,
                        sqk: heatmapMatch.squawk || null,
                        lat: heatmapMatch.lat,
                        lon: heatmapMatch.lon,
                        alt: heatmapMatch.alt,
                        gs: heatmapMatch.gs,
                        track: heatmapMatch.track || null,
                        timestamp: heatmapMatch.timestamp,
                        source: 'heatmap'
                    };
                }
            }

            if (!flight) {
                return res.status(404).json({ error: 'No data' });
            }

            // Cache the result
            flightApiCache.set(icao, flight);

            return res.json({ flight });
        } catch (err) {
            console.error('[flight-api] Error:', err);
            res.status(500).json({ error: 'Failed to fetch flight' });
        }
    });

    // --- Track endpoint ---
    // Returns recent track points for an aircraft hex over the requested minutes window
    app.get('/api/track', async (req, res) => {
        try {
            const hexRaw = (req.query.hex || req.query.icao || '').toString().trim();
            if (!hexRaw) return res.status(400).json({ error: 'Missing hex parameter' });
            const hex = hexRaw.toLowerCase();
            const minutes = Math.max(1, parseInt(req.query.minutes || '10', 10));

            // Retrieve positions for this aircraft from the in-memory cache
            const positions = positionCache?.getAircraftPositions(hex) || [];
            if (!positions || positions.length === 0) return res.status(404).json({ track: [] });

            const cutoff = Date.now() - (minutes * 60 * 1000);
            // Filter positions by cutoff (if timestamp present) and normalize fields
            let pts = positions
                .filter(p => !p.timestamp || p.timestamp >= cutoff)
                .map(p => ({ lat: p.lat, lon: p.lon, alt: (p.alt || p.altitude || null), timestamp: p.timestamp }))
                .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

            // Filter track points to only include those at least 0.1 NM apart
            pts = filterTrackByDistance(pts, 0.1); // 0.1 nautical miles minimum separation

            // Calculate vertical rates for each point (feet per minute)
            for (let i = 0; i < pts.length; i++) {
                if (i === 0) {
                    pts[i].vertical_rate = 0; // No previous point to calculate from
                } else {
                    const prev = pts[i - 1];
                    const curr = pts[i];
                    const timeDiffSeconds = (curr.timestamp - prev.timestamp) / 1000;
                    const altDiffFeet = (curr.alt || 0) - (prev.alt || 0);

                    if (timeDiffSeconds > 0 && timeDiffSeconds < 300) { // Valid time diff (max 5 minutes)
                        pts[i].vertical_rate = (altDiffFeet / timeDiffSeconds) * 60; // Convert to feet per minute
                    } else {
                        pts[i].vertical_rate = 0;
                    }
                }
            }

            return res.json({ track: pts });
        } catch (err) {
            console.error('[track-api] Error:', err);
            res.status(500).json({ error: 'Failed to fetch track' });
        }
    });

    // --- V2 APIs for batch operations ---

    // V2 Flight endpoint - supports multiple aircraft in single request
    app.post('/api/v2/flight', async (req, res) => {
        try {
            const requests = req.body.requests || [];
            if (!Array.isArray(requests) || requests.length === 0) {
                return res.status(400).json({ error: 'Missing or invalid requests array' });
            }

            if (requests.length > 50) {
                return res.status(400).json({ error: 'Too many requests (max 50)' });
            }

            const results = [];
            const errors = [];

            for (let i = 0; i < requests.length; i++) {
                const request = requests[i];
                try {
                    const icaoRaw = (request.icao || request.hex || '').toString().trim();
                    if (!icaoRaw) {
                        errors.push({ index: i, error: 'Missing icao/hex parameter' });
                        continue;
                    }
                    const icao = icaoRaw.toLowerCase();

                    // Pull recent positions for this aircraft
                    const positions = positionCache?.getAircraftPositions(icao) || [];
                    if (!positions || positions.length === 0) {
                        results.push({ index: i, flight: null });
                        continue;
                    }

                    // Use the most recent position as the source of basic flight metadata
                    const recent = positions[0];
                    const flight = {
                        icao: recent.hex,
                        flight: recent.callsign || recent.flight || '',
                        callsign: recent.callsign || recent.flight || '',
                        registration: recent.registration || recent.Reg || '',
                        squawk: recent.squawk || recent.sqk || null,
                        sqk: recent.squawk || recent.sqk || null,
                        lat: recent.lat,
                        lon: recent.lon,
                        alt: recent.alt,
                        gs: recent.gs,
                        track: recent.track || recent.heading || null,
                        timestamp: recent.timestamp
                    };

                    results.push({ index: i, flight });
                } catch (err) {
                    errors.push({ index: i, error: err.message });
                }
            }

            return res.json({ results, errors: errors.length > 0 ? errors : undefined });
        } catch (err) {
            console.error('[flight-v2-api] Error:', err);
            res.status(500).json({ error: 'Failed to fetch flights' });
        }
    });

    // V2 Track endpoint - supports multiple aircraft in single request
    app.post('/api/v2/track', async (req, res) => {
        try {
            const requests = req.body.requests || [];
            if (!Array.isArray(requests) || requests.length === 0) {
                return res.status(400).json({ error: 'Missing or invalid requests array' });
            }

            if (requests.length > 20) {
                return res.status(400).json({ error: 'Too many requests (max 20)' });
            }

            const results = [];
            const errors = [];

            for (let i = 0; i < requests.length; i++) {
                const request = requests[i];
                try {
                    const hexRaw = (request.hex || request.icao || '').toString().trim();
                    if (!hexRaw) {
                        errors.push({ index: i, error: 'Missing hex parameter' });
                        continue;
                    }
                    const hex = hexRaw.toLowerCase();
                    const minutes = Math.max(1, parseInt(request.minutes || '10', 10));

                    // Retrieve positions for this aircraft from the in-memory cache
                    const positions = positionCache?.getAircraftPositions(hex) || [];
                    if (!positions || positions.length === 0) {
                        results.push({ index: i, track: [] });
                        continue;
                    }

                    const cutoff = Date.now() - (minutes * 60 * 1000);
                    // Filter positions by cutoff (if timestamp present) and normalize fields
                    const pts = positions
                        .filter(p => !p.timestamp || p.timestamp >= cutoff)
                        .map(p => ({ lat: p.lat, lon: p.lon, alt: (p.alt || p.altitude || null), timestamp: p.timestamp }))
                        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

                    // Calculate vertical rates for each point (feet per minute)
                    for (let j = 0; j < pts.length; j++) {
                        if (j === 0) {
                            pts[j].vertical_rate = 0; // No previous point to calculate from
                        } else {
                            const prev = pts[j - 1];
                            const curr = pts[j];
                            const timeDiffSeconds = (curr.timestamp - prev.timestamp) / 1000;
                            const altDiffFeet = (curr.alt || 0) - (prev.alt || 0);

                            if (timeDiffSeconds > 0 && timeDiffSeconds < 300) { // Valid time diff (max 5 minutes)
                                pts[j].vertical_rate = Math.round((altDiffFeet / timeDiffSeconds) * 60); // Convert to feet per minute
                            } else {
                                pts[j].vertical_rate = 0; // Invalid time difference
                            }
                        }
                    }

                    results.push({ index: i, track: pts });
                } catch (err) {
                    errors.push({ index: i, error: err.message });
                }
            }

            return res.json({ results, errors: errors.length > 0 ? errors : undefined });
        } catch (err) {
            console.error('[track-v2-api] Error:', err);
            res.status(500).json({ error: 'Failed to fetch tracks' });
        }
    });

    // Track cache API endpoints
    if (opts.trackCache) {
        app.get('/api/track-cache/stats', (req, res) => {
            res.json(opts.trackCache.getStats());
        });

        app.get('/api/track-cache/track/:hex', (req, res) => {
            const hex = req.params.hex;
            const track = opts.trackCache.getTrack(hex);
            res.json({ hex, positions: track, count: track.length });
        });

        app.get('/api/track-cache/latest', (req, res) => {
            const latest = opts.trackCache.getLatestPositions();
            res.json({ positions: latest, count: Object.keys(latest).length });
        });

        app.get('/api/track-cache/all', (req, res) => {
            const all = opts.trackCache.getAllTracks();
            res.json({ tracks: all, aircraftCount: Object.keys(all).length });
        });

        // --- FlightAware API Routes ---
        app.get('/api/flightaware/flight/:callsign', async (req, res) => {
            try {
                const { callsign } = req.params;
                // Clear require cache to get fresh config
                delete require.cache[require.resolve('./flightaware-api')];
                const flightAware = require('./flightaware-api');

                if (!flightAware.enabled) {
                    return res.json({ error: 'FlightAware API not enabled' });
                }

                const flightData = await flightAware.getFlightByCallsign(callsign);
                res.json(flightData || { error: 'Flight not found' });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        app.get('/api/flightaware/aircraft/:registration', async (req, res) => {
            try {
                const { registration } = req.params;
                const flightAware = require('./flightaware-api');

                if (!flightAware.enabled) {
                    return res.json({ error: 'FlightAware API not enabled' });
                }

                const aircraftData = await flightAware.getAircraftInfo(registration);
                res.json(aircraftData || { error: 'Aircraft not found' });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        app.get('/api/flightaware/airport/:code', async (req, res) => {
            try {
                const { code } = req.params;
                const flightAware = require('./flightaware-api');

                if (!flightAware.enabled) {
                    return res.json({ error: 'FlightAware API not enabled' });
                }

                const airportData = await flightAware.getAirportInfo(code);
                res.json(airportData || { error: 'Airport not found' });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        app.get('/api/flightaware/search', async (req, res) => {
            try {
                const { query, type = 'flight' } = req.query;
                const flightAware = require('./flightaware-api');

                if (!flightAware.enabled) {
                    return res.json({ error: 'FlightAware API not enabled' });
                }

                const searchData = await flightAware.searchFlights(query, type);
                res.json(searchData || { error: 'No results found' });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }
}


module.exports = { setupApiRoutes, loadRecentHeatmapPositions };
