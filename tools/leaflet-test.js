#!/usr/bin/env node
// Robust Leaflet page test tool using Puppeteer
// Usage: node tools/leaflet-test.js [url] [outdir]
// Defaults: url=http://localhost:3002/heatmap-leaflet.html, outdir=screenshots/testplan/leaflet-test-<timestamp>

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

async function run() {
    const url = process.argv[2] || 'http://localhost:3002/heatmap-leaflet.html';
    const maybeOutdir = process.argv[3] || '';
    const outdir = (maybeOutdir && !maybeOutdir.startsWith('--')) ? maybeOutdir : path.join('screenshots', 'testplan', `leaflet-test-${Date.now()}`);
        const selectOverlays = (process.argv.indexOf('--select-overlays') !== -1);
        const collectPopups = (process.argv.indexOf('--collect-popups') !== -1);
        const checkHexArgs = process.argv.filter(arg => arg.startsWith('--check-hex='));
        const checkHexes = [];
        const explicitCheckHexes = checkHexArgs.length > 0;
        for (const a of checkHexArgs) {
            const v = a.split('=')[1];
            if (v && v.length) {
                const parts = v.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
                for (const p of parts) checkHexes.push(p);
            }
        }
        // default ignore pattern list for console errors
        const ignoreConsoleArgs = process.argv.filter(arg => arg.startsWith('--ignore-console='));
        const defaultIgnorePatterns = [
            /https?:\/\/mesonet\.agron\.iastate\.edu\/.*sfc_analysis\/.*$/i
        ];
        // Chicago bbox to filter vfr-sectional tiles outside this region
        const chicagoBbox = { minLat: 41.0, maxLat: 42.5, minLon: -88.0, maxLon: -86.0 };

        function tile2lon(x, z) { return (x / Math.pow(2, z)) * 360 - 180; }
        function tile2lat(y, z) { const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z); return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }
        function tileBbox(z, x, y) {
            const lon1 = tile2lon(x, z);
            const lon2 = tile2lon(x + 1, z);
            const lat1 = tile2lat(y + 1, z);
            const lat2 = tile2lat(y, z);
            return { minLat: Math.min(lat1, lat2), maxLat: Math.max(lat1, lat2), minLon: Math.min(lon1, lon2), maxLon: Math.max(lon1, lon2) };
        }
        function bboxIntersects(b1, b2) { return !(b2.minLon > b1.maxLon || b2.maxLon < b1.minLon || b2.minLat > b1.maxLat || b2.maxLat < b1.minLat); }

        function parseVfrTileUrl(url) {
            // match patterns like /tile/vfr-sectional/{z}/{x}/{y} or /vfr-sectional/{z}/{x}/{y}
            const m = url.match(/vfr-sectional\/(\d+)\/(\d+)\/(\d+)/i);
            if (!m) return null; return { z: parseInt(m[1], 10), x: parseInt(m[2], 10), y: parseInt(m[3], 10) };
        }
        const ignoreConsolePatterns = defaultIgnorePatterns.slice();
        for (const a of ignoreConsoleArgs) {
            const pat = a.split('=')[1];
            try { ignoreConsolePatterns.push(new RegExp(pat)); } catch (e) { console.warn('Invalid ignore-console regex:', pat); }
        }
    fs.mkdirSync(outdir, { recursive: true });

    const consoleMessages = [];
    const consoleErrors = [];
    const pageErrors = [];
    const network = [];

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    // capture run metadata
    const runIdArgs = process.argv.filter(arg => arg.startsWith('--run-id='));
    const runId = (runIdArgs.length ? runIdArgs[0].split('=')[1] : `run-${Date.now()}`);

    page.on('console', msg => {
        try {
            const text = msg.text();
            const entry = { type: msg.type(), text, location: msg.location() };
            consoleMessages.push(entry);
            console[msg.type()]('[PAGE]', text);
            // treat 'error' console messages as failures
            if (msg.type() === 'error') {
                const url = (entry.location && entry.location.url) ? entry.location.url : '';
                // If it's a vfr-sectional tile 404, evaluate tile coords and only consider it an error if it's over Chicago bbox
                const v = parseVfrTileUrl(url);
                if (v) {
                    try {
                        const tb = tileBbox(v.z, v.x, v.y);
                        if (!bboxIntersects(tb, chicagoBbox)) {
                            // Ignore this error - tile out of Chicago area
                            return;
                        }
                    } catch (e) {}
                }
                // If the error comes from an ignored URL or matches a pattern, skip it
                if (!ignoreConsolePatterns.some(rx => rx.test(url) || rx.test(entry.text))) {
                    consoleErrors.push(entry);
                }
            } else if (typeof text === 'string' && /Uncaught|ReferenceError|TypeError|SyntaxError|Error\b/.test(text)) {
                const url2 = (entry.location && entry.location.url) ? entry.location.url : '';
                if (!ignoreConsolePatterns.some(rx => rx.test(url2) || rx.test(entry.text))) {
                    consoleErrors.push(entry);
                }
            } else if (typeof text === 'string' && /Uncaught|ReferenceError|TypeError|SyntaxError|Error\b/.test(text)) {
                // Also capture strings that look like JS errors
                consoleErrors.push(entry);
            }
        } catch (e) {}
    });

    page.on('pageerror', err => {
        pageErrors.push({ message: err.message, stack: err.stack });
        console.error('[PAGE ERROR]', err.message);
    });

    page.on('request', req => {
        network.push({ id: req._requestId || null, url: req.url(), method: req.method(), resourceType: req.resourceType(), ts: Date.now(), event: 'request' });
    });

    page.on('response', async res => {
        try {
            const url = res.url();
            const status = res.status();
            const headers = res.headers();
            const rec = { url, status, headers, ts: Date.now(), event: 'response' };
            // capture JSON bodies for API endpoints of interest
            if (url.includes('/api/track') || url.includes('/api/positions') || url.includes('/api/heatmap') || url.includes('/api/flights')) {
                try { rec.body = await res.json(); } catch (e) { try { rec.bodyText = await res.text(); } catch (e2) {} }
            }
            network.push(rec);
            console.log('[RES]', status, url);
        } catch (e) {}
    });

    console.log('Loading', url);
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (err) {
        console.error('Initial page.goto failed:', err.message);
    }

    // Waiting some time to allow polling and rendering (tunable)
    await new Promise(r => setTimeout(r, 8000));
        // If requested, ensure all overlay checkboxes are checked before capturing
        if (selectOverlays) {
            console.log('Selecting overlay checkboxes...');
            await page.evaluate(() => {
                const inputs = Array.from(document.querySelectorAll('.leaflet-control-layers-selector'));
                inputs.forEach(i => {
                    try {
                        // Only click overlays (checkbox inputs), not base layer radios
                        if (i.type && i.type.toLowerCase() === 'checkbox' && !i.checked) {
                            i.click();
                        }
                    } catch (e) {}
                });
            });
            await new Promise(r => setTimeout(r, 1500)); // let layers render
        }

        // Also ensure show-live and show-heatmap toggles are enabled if present
        try {
            await page.evaluate(() => {
                try {
                    const showLive = document.getElementById('show-live');
                    if (showLive && !showLive.checked) {
                        showLive.click();
                    }
                    const showHeatmap = document.getElementById('show-heatmap');
                    if (showHeatmap && !showHeatmap.checked) {
                        showHeatmap.click();
                    }
                } catch (e) {}
            });
            await new Promise(r => setTimeout(r, 1200));
        } catch (e) {}

        // If requested, move center 30 miles west, zoom in 4, zoom out 4
        let collectedPopups = null;
        if (collectPopups) {
            console.log('Moving center 30 miles west and zooming');
            await page.evaluate(() => {
                function milesToKm(m) { return m * 1.609344; }
                const miles = 30;
                const km = milesToKm(miles);
                const center = window.map.getCenter();
                const lat = center.lat;
                const lon = center.lng;
                const lonDegPerKm = 1 / (111.32 * Math.cos(lat * Math.PI / 180));
                const deltaLon = km * lonDegPerKm;
                const newLon = lon - deltaLon;
                window.map.setView([lat, newLon], window.map.getZoom());
            });
            await new Promise(r => setTimeout(r, 1500));
            // zoom in 4
            await page.evaluate(() => { window.map.setZoom(window.map.getZoom() + 4); });
            await new Promise(r => setTimeout(r, 1500));
            // zoom out 4
            await page.evaluate(() => { window.map.setZoom(window.map.getZoom() - 4); });
            await new Promise(r => setTimeout(r, 1500));

            // Collect popups for each visible aircraft marker (use window.liveMarkers if available)
            console.log('Collecting popups for visible aircraft...');
            const popups = await page.evaluate(() => {
                const results = [];
                try {
                    const bounds = window.map.getBounds();
                    if (window.liveMarkers && window.liveMarkers.size) {
                        for (const [hex, marker] of window.liveMarkers) {
                            try {
                                const latlng = marker.getLatLng();
                                if (bounds.contains(latlng)) {
                                    try { marker.fire('click'); } catch (e) { try { marker.openPopup(); } catch (e) {} }
                                    const popup = marker.getPopup && marker.getPopup();
                                    const content = popup ? (popup.getContent ? popup.getContent() : null) : null;
                                    results.push({ hex, lat: latlng.lat, lon: latlng.lng, popup: content });
                                }
                            } catch (e) {}
                        }
                    } else {
                        // fallback: find icon elements in marker pane and attempt click
                        // Try to find any marker icons in the livePane if possible
                        const livePane = document.querySelector('.leaflet-pane.leaflet-live-pane');
                        let icons = [];
                        if (livePane) icons = Array.from(livePane.querySelectorAll('.leaflet-marker-icon'));
                        if (!icons.length) icons = Array.from(document.querySelectorAll('.leaflet-marker-icon'));
                        for (const el of icons) {
                            try {
                                // attempt to click to open popup
                                el.click();
                                // gather any newly visible popups
                                const popup = document.querySelector('.leaflet-popup-content');
                                results.push({ popup: popup ? popup.innerHTML : null });
                            } catch (e) {}
                        }
                    }
                } catch (err) { /* ignore */ }
                return results;
            });
            // save popups to disk
            collectedPopups = popups;
            if (popups && popups.length) {
                const out = path.join(outdir, 'popups.json');
                fs.writeFileSync(out, JSON.stringify(popups, null, 2));
                console.log('Saved popups to', out);
            } else {
                console.log('No popups collected');
            }
            // Give the page some time to process click events (e.g., draw temp tracks)
            await new Promise(r => setTimeout(r, 1200));
        }

    // Evaluate DOM to find leaflet panes and counts of SVG paths/circles inside panes
    const paneSummary = await page.evaluate(() => {
        const panes = Array.from(document.querySelectorAll('.leaflet-pane'));
        return panes.map(p => {
            const z = p.style && p.style.zIndex ? p.style.zIndex : null;
            const paths = p.querySelectorAll('path').length;
            const circles = p.querySelectorAll('circle').length;
            const svgs = p.querySelectorAll('svg').length;
            return { className: p.className, zIndex: z, paths, circles, svgs };
        });
    });

    // Additional page-level checks: count elements that look like polylines added by leaflet
    const layerCounts = await page.evaluate(() => {
        const results = {};
        try {
            // try to find map panes by zIndex values used by the app
            const panes = Array.from(document.querySelectorAll('.leaflet-pane'));
            panes.forEach(p => {
                const z = p.style && p.style.zIndex ? p.style.zIndex : '';
                results[`pane_z_${z}`] = {
                    pathCount: p.querySelectorAll('path').length,
                    circleCount: p.querySelectorAll('circle').length
                };
            });
        } catch (e) {}
        return results;
    });

    // Determine if grid-layer (heatmap) has any grid cells in DOM
    const gridHasCells = await page.evaluate(() => {
        try { return document.querySelectorAll('.grid-cell').length > 0; } catch (e) { return false; }
    });

    // Save screenshot
    const screenshotPath = path.join(outdir, 'leaflet-screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Save logs and network
    fs.writeFileSync(path.join(outdir, 'leaflet-console.json'), JSON.stringify(consoleMessages, null, 2));
    fs.writeFileSync(path.join(outdir, 'leaflet-page-errors.json'), JSON.stringify(pageErrors, null, 2));
    fs.writeFileSync(path.join(outdir, 'leaflet-network.json'), JSON.stringify(network, null, 2));
    fs.writeFileSync(path.join(outdir, 'leaflet-pane-summary.json'), JSON.stringify(paneSummary, null, 2));
    fs.writeFileSync(path.join(outdir, 'leaflet-layer-counts.json'), JSON.stringify(layerCounts, null, 2));

    // We will write run metadata after hex checks and assertions so selectedHexes/hex-check file are present.

    // If the user didn't provide hexes, auto-pick a few visible hexes from the current screen
    if (!checkHexes.length) {
        try {
            console.log('Auto-selecting visible hexes from page for checks...');
            const autoHexes = await page.evaluate(() => {
                const results = [];
                try {
                    const bounds = window.map && window.map.getBounds ? window.map.getBounds() : null;
                    const cand = [];
                    const tryPushFromMap = (m) => {
                        try {
                            for (const [hex, marker] of m) {
                                try { if (!marker || !marker.getLatLng) continue; const latlng = marker.getLatLng(); if (!bounds || bounds.contains(latlng)) cand.push(hex); }
                                catch(e) {}
                            }
                        } catch(e) {}
                    };
                    const liveMap = (typeof window !== 'undefined' && typeof window.liveMarkers !== 'undefined') ? window.liveMarkers : (typeof liveMarkers !== 'undefined' ? liveMarkers : null);
                    if (liveMap) tryPushFromMap(liveMap);
                    if (!cand.length && liveMap) {
                        try {
                            for (const [hex] of liveMap) { cand.push(hex); if (cand.length >= 3) break; }
                        } catch(e) {}
                    }
                    const persistentMap = (typeof window !== 'undefined' && typeof window.persistentTracks !== 'undefined') ? window.persistentTracks : (typeof persistentTracks !== 'undefined' ? persistentTracks : null);
                    if (!cand.length && persistentMap) {
                        try {
                            for (const k of persistentMap.keys()) { cand.push(k); if (cand.length >= 3) break; }
                        } catch(e) {}
                    }
                    for (const h of cand) { if (h && !results.includes(h)) results.push(h); if (results.length >= 3) break; }
                } catch (e) {}
                return results.slice(0, 3);
            });
            if (autoHexes && autoHexes.length) {
                autoHexes.forEach(h => checkHexes.push(h.toString().toLowerCase()));
                console.log('Auto-selected hexes:', checkHexes);
            } else {
                console.log('No visible hexes found during auto-selection');
            }
        } catch (e) { console.warn('Auto-select hexes failed', e.message); }
    }

    // If the user asked for hex checks, evaluate presence of polylines for those hexes
    let hexCheckResults = null;
    if (checkHexes.length) {
        hexCheckResults = await page.evaluate(async (hexes) => {
            const results = {};
            function latLonDist(a, b) {
                // simple approx: degrees squared threshold
                if (!a || !b) return Infinity;
                const dlat = a.lat - b.lat;
                const dlon = a.lng - b.lng;
                return Math.sqrt(dlat * dlat + dlon * dlon);
            }
            try {
                hexes.forEach(h => { results[h] = { persistent: false, live: false, long: false, temp: false }; });
                // Check persistentTracks Map if present
                if (window.persistentTracks && typeof window.persistentTracks === 'object') {
                    hexes.forEach(h => {
                        try {
                            if (window.persistentTracks.has(h)) {
                                const lg = window.persistentTracks.get(h);
                                if (lg && typeof lg.getLayers === 'function') {
                                    const layers = lg.getLayers();
                                    if (layers && layers.some(l => l instanceof L.Polyline)) results[h].persistent = true;
                                }
                            }
                        } catch(e) {}
                    });
                }
                // Check liveTracksLayer for polylines near marker (if marker available)
                hexes.forEach(h => {
                    try {
                        if (window.liveMarkers && window.liveMarkers.has(h)) {
                            const marker = window.liveMarkers.get(h);
                            if (marker && marker.getLatLng && typeof marker.getLatLng === 'function') {
                                const latlng = marker.getLatLng();
                                if (window.liveTracksLayer && typeof window.liveTracksLayer.getLayers === 'function') {
                                    const layers = window.liveTracksLayer.getLayers();
                                    if (layers && layers.some(poly => {
                                        try {
                                            if (!(poly instanceof L.Polyline)) return false;
                                            const latlngs = poly.getLatLngs ? poly.getLatLngs() : [];
                                            if (!latlngs || !latlngs.length) return false;
                                            // poly.getLatLngs may return nested arrays for segments
                                            const flat = (function flatten(arr){ return arr.reduce((acc, v) => acc.concat(Array.isArray(v) ? flatten(v) : v), []); })(latlngs);
                                            return flat.some(pt => latLonDist(pt, latlng) < 0.02); // ~0.02 deg threshold
                                        } catch(e) { return false; }
                                    })) results[h].live = true;
                                }
                            }
                        }
                    } catch (e) {}
                });
                // For hexes still not found, try to compute their track (via fetchTrackWithCache) and test upline overlap
                for (const h of hexes) {
                    try {
                        if (results[h].persistent || results[h].live || results[h].long) continue;
                        let minutes = 10;
                        if (typeof window.fetchTrackWithCache === 'function') {
                            try {
                                const { points } = await window.fetchTrackWithCache(h, minutes);
                                if (points && points.length >= 2) {
                                    // Use either liveTracksLayer or longTracksLayer to find overlapping polylines
                                    const trees = [];
                                    if (window.liveTracksLayer && window.liveTracksLayer.getLayers) trees.push(...window.liveTracksLayer.getLayers());
                                    if (window.longTracksLayer && window.longTracksLayer.getLayers) trees.push(...window.longTracksLayer.getLayers());
                                    if (window.persistentTracks && window.persistentTracks.has(h)) {
                                        const lg = window.persistentTracks.get(h);
                                        if (lg && lg.getLayers) trees.push(...lg.getLayers());
                                    }
                                    if (window.tempPersistentLayer && window.tempPersistentLayer.getLayers) trees.push(...window.tempPersistentLayer.getLayers());
                                    const pts = points.map(p => ({ lat: p.lat, lng: p.lon }));
                                    // simple check: does any polyline in trees have a latlng near any track point
                                    trees.forEach(t => {
                                        try {
                                            const inner = (t.getLayers && t.getLayers()) || [t];
                                            inner.forEach(poly => {
                                                if (!(poly instanceof L.Polyline)) return;
                                                const latlngs = poly.getLatLngs ? poly.getLatLngs() : [];
                                                const flat = (function flatten(arr){ return arr.reduce((acc, v) => acc.concat(Array.isArray(v) ? flatten(v) : v), []); })(latlngs);
                                                if (flat && flat.length) {
                                                    for (const trpt of pts) {
                                                        for (const pt of flat) {
                                                            const dlat = pt.lat - trpt.lat;
                                                            const dlon = pt.lng - trpt.lng;
                                                            const dist = Math.sqrt(dlat * dlat + dlon * dlon);
                                                            if (dist < 0.03) { // ~0.03 deg threshold
                                                                                if (trees === (window.liveTracksLayer && window.liveTracksLayer.getLayers && window.liveTracksLayer.getLayers())) results[h].live = true;
                                                                                if (trees === (window.longTracksLayer && window.longTracksLayer.getLayers && window.longTracksLayer.getLayers())) results[h].long = true;
                                                                                if (trees === (window.tempPersistentLayer && window.tempPersistentLayer.getLayers && window.tempPersistentLayer.getLayers())) results[h].temp = true;
                                                                if (window.persistentTracks && window.persistentTracks.has(h)) results[h].persistent = true;
                                                            }
                                                        }
                                                    }
                                                }
                                            });
                                        } catch (e) {}
                                    });
                                }
                            } catch (e) {}
                        }
                    } catch (e) {}
                }
                // Check longTracksLayer similarly (these are historical tracks from longTracksLayer)
                hexes.forEach(h => {
                    try {
                        if (window.liveMarkers && window.liveMarkers.has(h)) {
                            const marker = window.liveMarkers.get(h);
                            if (marker && marker.getLatLng && typeof marker.getLatLng === 'function') {
                                const latlng = marker.getLatLng();
                                if (window.longTracksLayer && typeof window.longTracksLayer.getLayers === 'function') {
                                    const layers = window.longTracksLayer.getLayers();
                                    if (layers && layers.some(lg => {
                                        try {
                                            // lg may be a LayerGroup containing a polyline
                                            const inner = (lg.getLayers && lg.getLayers()) || [lg];
                                            return inner.some(poly => {
                                                if (!(poly instanceof L.Polyline)) return false;
                                                const latlngs = poly.getLatLngs ? poly.getLatLngs() : [];
                                                const flat = (function flatten(arr){ return arr.reduce((acc, v) => acc.concat(Array.isArray(v) ? flatten(v) : v), []); })(latlngs);
                                                return flat.some(pt => latLonDist(pt, latlng) < 0.02);
                                            });
                                        } catch(e) { return false; }
                                    })) results[h].long = true;
                                }
                            }
                        }
                    } catch (e) {}
                });
            } catch(e) {}
            return results;
        }, checkHexes);
        fs.writeFileSync(path.join(outdir, 'hex-check-results.json'), JSON.stringify(hexCheckResults, null, 2));
        console.log('Hex check results:', JSON.stringify(hexCheckResults));
    }

    console.log('Artifacts written to', outdir);
    console.log('Pane summary:', paneSummary);
    console.log('Layer counts:', layerCounts);

    // If any page errors or console errors were found, fail the process with a non-zero exit code
    if (pageErrors.length > 0 || consoleErrors.length > 0) {
        const errSummary = {
            pageErrors: pageErrors.length,
            consoleErrors: consoleErrors.length
        };
        fs.writeFileSync(path.join(outdir, 'leaflet-errors-summary.json'), JSON.stringify({ pageErrors, consoleErrors }, null, 2));
        console.error('Errors detected during page capture:', JSON.stringify(errSummary));
        await browser.close();
        process.exit(2);
    }

    // Now, optional additional assertions for popups and pane counts
    const assertionFailures = [];
    const assertionWarnings = [];
    try {
        if (collectPopups) {
            const pp = collectedPopups || [];
            // dedupe popups by normalized HTML
            const uniq = {};
            for (const p of pp) {
                const raw = (p.popup || p.html || p.content || '').toString();
                // normalize by trimming and stripping numeric whitespace and repeated spaces
                const norm = raw.replace(/\s+/g, ' ').trim();
                uniq[norm] = p;
            }
            const uniqueCount = Object.keys(uniq).length;
            if (uniqueCount === 0) {
                assertionFailures.push('collect-popups requested but no popups were captured (uniqueCount=0)');
            } else {
                // verify that every popup string contains important fields: "Alt" and "Speed" and "Pos"
                for (const k of Object.keys(uniq)) {
                    if (!/\bAlt:\b|\bAlt<|>Alt<|\bAlt\b/i.test(k)) assertionFailures.push('Popup missing Alt field: ' + k.slice(0, 80));
                    if (!/\bSpeed:\b|\bSpeed<|>Speed<|\bSpeed\b/i.test(k)) assertionFailures.push('Popup missing Speed field: ' + k.slice(0, 80));
                    if (!/\bPos:\b|\bPos<|>Pos<|\bPos\b/i.test(k)) assertionFailures.push('Popup missing Pos field: ' + k.slice(0, 80));
                }
            }
        }
    } catch (e) {
        assertionFailures.push('Error running popup assertions: ' + e.message);
    }

    try {
        // Assert that heatmap pane has paths > 0
        const heatmapPane = paneSummary.find(p => p.className && p.className.indexOf('leaflet-heatmap-pane') !== -1);
        if (heatmapPane && gridHasCells) {
            if (!(heatmapPane.paths > 0 || heatmapPane.svgs > 0)) {
                assertionFailures.push('heatmap pane should contain paths or svgs when grid cells (.grid-cell) are present');
            }
        }
        // Assert live pane has at least one circle (live markers)
        const livePane = paneSummary.find(p => p.className && p.className.indexOf('leaflet-live-pane') !== -1);
        if (livePane) {
            if (!(livePane.paths > 0 || livePane.circles > 0 || livePane.svgs > 0)) {
                assertionFailures.push('live pane should contain markers (paths/circles/svgs)');
            }
        }
    } catch (e) {
        assertionFailures.push('Error running pane assertions: ' + e.message);
    }

    // If checkHexes were supplied, add per-hex assertion results to failures
    try {
        if (checkHexes && checkHexes.length && hexCheckResults) {
            if (explicitCheckHexes) {
                // User explicitly requested hex checks; these should be strict
                for (const h of checkHexes) {
                    const res = (hexCheckResults[h] || {});
                    if (!(res.persistent || res.live || res.long)) {
                        assertionFailures.push(`No polyline found for hex ${h} in persistent, live, or long tracks`);
                    }
                }
            } else {
                // Auto-selected hexes are opportunistic; assert there is at least one hex that does have a polyline
                const anyWithTrack = checkHexes.some(h => {
                    const r = hexCheckResults[h] || {};
                    return (r.persistent || r.live || r.long);
                });
                if (!anyWithTrack) {
                    // Not fatal — record a warning so CI doesn't fail on expected-empty auto selection
                    assertionWarnings.push(`Auto-selected hexes (${checkHexes.join(',')}) had no polylines in persistent/live/long tracks; skipping strict hex assertions`);
                }
            }
        }
    } catch (e) { assertionFailures.push('Error running hex checks: ' + e.message); }

    // Build run metadata for instrumentation (after hex checks and assertions so all data present)
    try {
        const runInfo = {
            runId: runId,
            timestamp: new Date().toISOString(),
            url: url,
            flags: { selectOverlays, collectPopups, checkHexes },
            artifacts: {
                screenshot: screenshotPath,
                popupsFile: (collectedPopups && collectedPopups.length) ? path.join(outdir, 'popups.json') : null,
                consoleFile: path.join(outdir, 'leaflet-console.json'),
                networkFile: path.join(outdir, 'leaflet-network.json'),
                paneSummaryFile: path.join(outdir, 'leaflet-pane-summary.json'),
                hexCheckFile: (checkHexes && checkHexes.length) ? path.join(outdir, 'hex-check-results.json') : null
            },
            summary: {
                paneSummary: paneSummary,
                gridHasCells: gridHasCells,
                layerCounts: layerCounts,
                selectedHexes: (checkHexes || []),
                autoSelectedHexes: (hexCheckResults ? Object.keys(hexCheckResults) : []),
                consoleErrorCount: consoleErrors.length,
                pageErrorCount: pageErrors.length,
                hexCheckSummary: hexCheckResults
            },
            environment: { nodeVersion: process.version }
        };
        fs.writeFileSync(path.join(outdir, 'run-info.json'), JSON.stringify(runInfo, null, 2));
    } catch (e) { /* ignore */ }

    if (assertionWarnings.length) {
        fs.writeFileSync(path.join(outdir, 'assertion-warnings.json'), JSON.stringify(assertionWarnings, null, 2));
        console.warn('One or more assertion warnings:', assertionWarnings);
    }

    if (assertionFailures.length) {
        fs.writeFileSync(path.join(outdir, 'assertion-failures.json'), JSON.stringify(assertionFailures, null, 2));
        console.error('One or more assertions failed:', assertionFailures);
        await browser.close();
        process.exit(3);
    }

    await browser.close();
}

run().catch(err => { console.error(err); process.exit(1); });
