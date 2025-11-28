const { listS3Files, downloadAndParseS3File } = require('./s3-helpers');

// Maintains a rolling in-memory cache of parsed minute files and builds
// airline stats for windows: 1h,4h,12h,24h,7d. Designed to download each
// S3 file only once and rebuild in-memory aggregates efficiently.

function createAggregator(s3, bucketName) {
    // in-memory store: fileKey -> { fileTime: ms, entries: [ { flightKey, airlineName, hex } ] }
    const files = new Map();

    const windows = {
        '1h': 60 * 60 * 1000,
        '4h': 4 * 60 * 60 * 1000,
        '12h': 12 * 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000
    };

    // airline database mapping (code -> { name, ... })
    let airlineDb = null;

    // track last list time to avoid overly frequent listing
    let lastListTime = 0;
    const LIST_COOLDOWN_MS = 30 * 1000; // 30s

    async function refresh() {
        const now = Date.now();
        if (now - lastListTime < LIST_COOLDOWN_MS) return; // rate-limit
        lastListTime = now;

        // List candidate files within 7d
        const maxWindowMs = windows['7d'];
        const cutoff = now - maxWindowMs;

        let s3Files = [];
        try {
            s3Files = await listS3Files(s3, bucketName) || [];
        } catch (e) {
            console.error('Error listing S3 files in aggregator:', e);
            return;
        }

        // Add new files (only those newer than cutoff)
        for (const f of s3Files) {
            try {
                if (!f.Key || f.Key.indexOf('piaware_aircraft_log') === -1) continue;
                const fileTime = new Date(f.LastModified).getTime();
                if (fileTime <= cutoff) continue;
                if (files.has(f.Key)) continue; // already processed

                // download and parse
                const recs = await downloadAndParseS3File(s3, bucketName, f.Key);
                const entries = [];
                for (const r of recs || []) {
                    const flight = (r.flight || r.Ident || r.ident || r.r || '').toString().trim();
                    const hex = (r.hex || r.ICAO || r.icao || '').toString();
                    
                    // Skip records without a flight identifier
                    if (!flight || !hex) continue;
                    
                    const airlineCode = flight.substring(0, 3).toUpperCase();
                    const flightKey = `${flight}|${hex}`;
                    
                    // Extract record timestamp (prefer lastSeen/seen fields, fallback to file time)
                    let recordTime = fileTime;
                    const tsCandidate = r.Last_Seen || r.LastSeen || r.last_seen || r.seen || r.seen_time || r.lastSeen || null;
                    if (typeof tsCandidate === 'number') {
                        recordTime = tsCandidate > 9999999999 ? tsCandidate : tsCandidate * 1000;
                    } else if (typeof tsCandidate === 'string') {
                        const parsed = new Date(tsCandidate).getTime();
                        if (!isNaN(parsed)) recordTime = parsed;
                    }
                    
                    entries.push({ flightKey, airlineCode, hex, recordTime });
                }

                files.set(f.Key, { fileTime, entries });
            } catch (e) {
                console.error(`Aggregator failed to process ${f.Key}:`, e);
                // don't throw; continue with other files
            }
        }

        // Optionally prune files older than 7d from the files map
        for (const [key, info] of files.entries()) {
            if (info.fileTime <= cutoff) files.delete(key);
        }
    }

    function computeStatsNow() {
        const now = Date.now();
        const statsByWindow = {};
        for (const w of Object.keys(windows)) statsByWindow[w] = {};

        for (const info of files.values()) {
            for (const e of info.entries) {
                const recordTime = e.recordTime || info.fileTime;
                
                // Check each window to see if this record falls within it
                for (const [wlabel, wms] of Object.entries(windows)) {
                    const windowCutoff = now - wms;
                    if (recordTime <= windowCutoff) continue; // Skip records older than this window
                    
                    const stats = statsByWindow[wlabel];
                    const fk = e.flightKey;
                    const airlineCode = e.airlineCode || 'UNK';
                    const hex = e.hex || '';
                    if (!stats[airlineCode]) stats[airlineCode] = { flights: new Set(), aircraft: new Set() };
                    // Track unique flight keys and aircraft
                    stats[airlineCode].flights.add(fk);
                    if (hex) stats[airlineCode].aircraft.add(hex);
                }
            }
        }

        // convert sets to sizes
        const out = {};
        for (const [wlabel, stats] of Object.entries(statsByWindow)) {
            const converted = {};
            for (const [airlineCode, s] of Object.entries(stats)) {
                const fullName = (airlineDb && airlineDb[airlineCode]) ? (airlineDb[airlineCode].name || airlineDb[airlineCode]) : null;
                converted[airlineCode] = { count: s.flights.size, aircraft: s.aircraft.size, full_name: fullName || airlineCode };
            }
            out[wlabel] = { byAirline: converted };
        }
        out.lastHour = out['1h'];
        return out;
    }

    return {
        refresh,
        computeStatsNow,
        setAirlineDatabase: (db) => { airlineDb = db; },
        airlineDb: () => airlineDb
    };
}

module.exports = { createAggregator };
