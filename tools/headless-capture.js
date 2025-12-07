// Simple interactive capture script using Puppeteer
// Usage: node tools/headless-capture.js <url> [screenshot-path]
// Press Enter to capture each step

const fs = require('fs');
const puppeteer = require('puppeteer');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function waitForEnter(message) {
    return new Promise((resolve) => {
        rl.question(message, () => {
            resolve();
        });
    });
}

(async () => {
    const url = process.argv[2] || 'http://localhost:3002/heatmap-leaflet.html';
    // Simple ignore list via query param: ?ignore_console=regex1&ignore_console=regex2
    const ignoreConsoleParams = new URL(url, 'http://localhost').searchParams.getAll('ignore_console');
    const ignoreConsolePatterns = ignoreConsoleParams.map(p => { try { return new RegExp(p); } catch (e) { return null; } }).filter(Boolean);
    const screenshot = process.argv[3] || 'tools/leaflet-screenshot.png';
    console.log('Opening', url);
    const browser = await puppeteer.launch({ 
        headless: false,  // Make browser visible for watching
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1200,800'] 
    });
    const page = await browser.newPage();
    const consoleLogs = [];
    const networkRequests = [];
    const networkResponses = [];

    page.on('console', msg => {
        try {
            const text = msg.text();
            consoleLogs.push({ type: msg.type(), text });
            console.log(`[PAGE ${msg.type()}] ${text}`);
        } catch (e) {}
    });

    page.on('request', req => {
        networkRequests.push({ url: req.url(), method: req.method(), resourceType: req.resourceType() });
        console.log(`[REQ] ${req.method()} ${req.url()} (${req.resourceType()})`);
    });

    page.on('response', async res => {
        try {
            const url = res.url();
            const status = res.status();
            console.log(`[RES] ${status} ${url}`);
            networkResponses.push({ url, status });
        } catch (e) {}
    });

    try {
        await page.goto(url, { waitUntil: 'networkidle2' });
        // Wait a bit to allow live polling to run
        await new Promise(r => setTimeout(r, 3000)); // Initial load time

        // If requested via query param `select_overlays=1`, check overlay checkboxes
        try {
            const u = new URL(page.url());
            if (u.searchParams.get('select_overlays') === '1') {
                console.log('Selecting overlay checkboxes (interactive)');
                await page.evaluate(() => {
                    const inputs = Array.from(document.querySelectorAll('.leaflet-control-layers-selector'));
                    inputs.forEach(i => {
                        try { if (i.type && i.type.toLowerCase() === 'checkbox' && !i.checked) i.click(); } catch (e) {}
                    });
                });
                await new Promise(r => setTimeout(r, 1500));
            }
        } catch (e) {}

        // Set view to LaPorte Indiana
        console.log('Setting view to LaPorte Indiana');
        await page.evaluate(() => {
            if (window.map) {
                window.map.setView([41.6114, -86.7228], 10);
            }
        });
        await waitForEnter('Press Enter to start capturing FAA layers...');

        // Cycle through FAA layers
        const faaLayers = ['FAA VFR Terminal', 'FAA VFR Sectional', 'FAA IFR Area Low', 'FAA IFR Enroute High'];
        for (const layerName of faaLayers) {
            console.log(`Switching to layer: ${layerName}`);
            await page.evaluate((name) => {
                // Assuming layers are in layer control
                const inputs = document.querySelectorAll('.leaflet-control-layers-selector');
                for (const input of inputs) {
                    if (input.nextSibling && input.nextSibling.textContent.includes(name)) {
                        input.click();
                        break;
                    }
                }
            }, layerName);
            await waitForEnter(`Layer "${layerName}" loaded. Press Enter to capture screenshot...`);
            await page.screenshot({ path: `runtime/screenshots/laporte-${layerName.replace(/\s+/g, '-').toLowerCase()}.png`, fullPage: true });
            console.log(`Screenshot saved for ${layerName}`);
        }

        // Zoom out to demonstrate ARTCC Boundaries
        console.log('Zooming out to show ARTCC boundaries');
        await page.evaluate(() => {
            if (window.map) {
                window.map.setZoom(6);
            }
        });
        await waitForEnter('Zoomed out for ARTCC boundaries. Press Enter to enable ARTCC layer...');
        // Enable ARTCC layer
        await page.evaluate(() => {
            const inputs = document.querySelectorAll('.leaflet-control-layers-selector');
            for (const input of inputs) {
                if (input.nextSibling && input.nextSibling.textContent.includes('ARTCC Boundaries')) {
                    input.click();
                    break;
                }
            }
        });
        await waitForEnter('ARTCC boundaries loaded. Press Enter to capture screenshot...');
        await page.screenshot({ path: 'runtime/screenshots/laporte-artcc-boundaries.png', fullPage: true });
        console.log('Screenshot saved for ARTCC boundaries');

        // Go to Cherry Point and show weather
        console.log('Setting view to Cherry Point (MCAS Cherry Point)');
        await page.evaluate(() => {
            if (window.map) {
                window.map.setView([34.9, -76.9], 8);
            }
        });
        await waitForEnter('Moved to Cherry Point. Press Enter to enable weather radar...');
        // Enable weather layer
        await page.evaluate(() => {
            const inputs = document.querySelectorAll('.leaflet-control-layers-selector');
            for (const input of inputs) {
                if (input.nextSibling && input.nextSibling.textContent.includes('Weather Radar Internet')) {
                    input.click();
                    break;
                }
            }
        });
        await waitForEnter('Weather radar loaded. Press Enter to capture final screenshot...');
        await page.screenshot({ path: 'runtime/screenshots/laporte-cherry-point-weather.png', fullPage: true });
        console.log('Screenshot saved for Cherry Point weather');

    } catch (err) {
        console.error('Error loading page:', err);
    }

    // Compute ignored 'vfr-sectional' 404 entries outside Chicago
    const chicagoBbox = { minLat: 41.0, maxLat: 42.5, minLon: -88.0, maxLon: -86.0 };
    function tile2lon(x, z) { return (x / Math.pow(2, z)) * 360 - 180; }
    function tile2lat(y, z) { const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z); return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }
    function tileBbox(z, x, y) { const lon1 = tile2lon(x, z); const lon2 = tile2lon(x + 1, z); const lat1 = tile2lat(y + 1, z); const lat2 = tile2lat(y, z); return { minLat: Math.min(lat1, lat2), maxLat: Math.max(lat1, lat2), minLon: Math.min(lon1, lon2), maxLon: Math.max(lon1, lon2) }; }
    function bboxIntersects(b1, b2) { return !(b2.minLon > b1.maxLon || b2.maxLon < b1.minLon || b2.minLat > b1.maxLat || b2.maxLat < b1.minLat); }
    function parseVfrTileUrl(url) { const m = url.match(/vfr-sectional\/(\d+)\/(\d+)\/(\d+)/i); if (!m) return null; return { z: parseInt(m[1], 10), x: parseInt(m[2], 10), y: parseInt(m[3], 10) }; }

    const vfr404OutsideChicago = networkResponses.some(r => r.status === 404 && /vfr-sectional/i.test(r.url) && (() => { const v = parseVfrTileUrl(r.url); if (!v) return false; const tb = tileBbox(v.z, v.x, v.y); return !bboxIntersects(tb, chicagoBbox); })());

    // Save logs to files
    try {
        const logDir = 'runtime/screenshots';
        const consolePath = require('path').join(logDir, 'laporte-leaflet-console.log');
        const networkPath = require('path').join(logDir, 'laporte-leaflet-network.log');
        // Optionally filter console logs: remove 'Failed to load resource' if vfr404OutsideChicago
        let filteredConsoleLogs = consoleLogs;
        if (vfr404OutsideChicago) {
            filteredConsoleLogs = consoleLogs.filter(c => !(/Failed to load resource/i.test(c.text)));
        }
        fs.writeFileSync(consolePath, JSON.stringify(filteredConsoleLogs, null, 2));
        fs.writeFileSync(networkPath, JSON.stringify(networkRequests, null, 2));
        console.log('Saved logs to', consolePath, 'and', networkPath);
    } catch (e) {
        console.error('Failed to write logs:', e);
    }

    await browser.close();
    rl.close();
})();
