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
    const screenshot = process.argv[3] || 'tools/leaflet-screenshot.png';
    console.log('Opening', url);
    const browser = await puppeteer.launch({ 
        headless: false,  // Make browser visible for watching
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1200,800'] 
    });
    const page = await browser.newPage();
    const consoleLogs = [];
    const networkRequests = [];

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

    // Save logs to files
    try {
        const logDir = 'runtime/screenshots';
        const consolePath = require('path').join(logDir, 'laporte-leaflet-console.log');
        const networkPath = require('path').join(logDir, 'laporte-leaflet-network.log');
        fs.writeFileSync(consolePath, JSON.stringify(consoleLogs, null, 2));
        fs.writeFileSync(networkPath, JSON.stringify(networkRequests, null, 2));
        console.log('Saved logs to', consolePath, 'and', networkPath);
    } catch (e) {
        console.error('Failed to write logs:', e);
    }

    await browser.close();
    rl.close();
})();
