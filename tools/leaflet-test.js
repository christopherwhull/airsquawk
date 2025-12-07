#!/usr/bin/env node
// Robust Leaflet page test tool using Puppeteer
// Usage: node tools/leaflet-test.js [url] [outdir]
// Defaults: url=http://localhost:3002/heatmap-leaflet.html, outdir=tools/leaflet-test-<timestamp>

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

async function run() {
    const url = process.argv[2] || 'http://localhost:3002/heatmap-leaflet.html';
    const outdir = process.argv[3] || path.join('tools', `leaflet-test-${Date.now()}`);
        const selectOverlays = (process.argv.indexOf('--select-overlays') !== -1);
    fs.mkdirSync(outdir, { recursive: true });

    const consoleMessages = [];
    const consoleErrors = [];
    const pageErrors = [];
    const network = [];

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    page.on('console', msg => {
        try {
            const text = msg.text();
            const entry = { type: msg.type(), text, location: msg.location() };
            consoleMessages.push(entry);
            console[msg.type()]('[PAGE]', text);
            // treat 'error' console messages as failures
            if (msg.type() === 'error') {
                consoleErrors.push(entry);
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

    // Save screenshot
    const screenshotPath = path.join(outdir, 'leaflet-screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Save logs and network
    fs.writeFileSync(path.join(outdir, 'leaflet-console.json'), JSON.stringify(consoleMessages, null, 2));
    fs.writeFileSync(path.join(outdir, 'leaflet-page-errors.json'), JSON.stringify(pageErrors, null, 2));
    fs.writeFileSync(path.join(outdir, 'leaflet-network.json'), JSON.stringify(network, null, 2));
    fs.writeFileSync(path.join(outdir, 'leaflet-pane-summary.json'), JSON.stringify(paneSummary, null, 2));
    fs.writeFileSync(path.join(outdir, 'leaflet-layer-counts.json'), JSON.stringify(layerCounts, null, 2));

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

    await browser.close();
}

run().catch(err => { console.error(err); process.exit(1); });
