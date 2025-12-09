const puppeteer = require('puppeteer');

describe('Heatmap overlay layers persistence', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });
    // Attach page console events for debugging
    page.on('console', (msg) => {
      try { console.log('PAGE LOG:', msg.text()); } catch (e) { console.log('PAGE LOG: [unprintable]'); }
    });
  }, 20000);

  afterAll(async () => {
    if (browser) await browser.close();
  }, 20000);

  test.skip('overlay toggles persist across reload for heatmap grid layer', async () => {
    try {
      await page.goto('http://localhost:3002/heatmap-leaflet.html', { waitUntil: 'networkidle2', timeout: 60000 });
    } catch(err) {
      console.warn('Server not available; skipping heatmap overlays persistence test');
      return;
    }

    // Wait for layers control, and the overlay event indicating overlays are registered
    await page.waitForSelector('.leaflet-control-layers');
    // Prefer the custom event marker if available for determinism; otherwise fall back to DOM label.
    try {
      await page.waitForFunction(() => window.heatmapOverlaysReady === true, { timeout: 30000 });
    } catch (e) {
      await page.waitForFunction(() => {
        const labels = Array.from(document.querySelectorAll('.leaflet-control-layers-overlays label'));
        return labels.some(label => (label.textContent || '').trim().indexOf('Heatmap Grid') !== -1);
      }, { timeout: 30000 });
    }

    // Debug: report whether gridLayer was created on page
    const gridDefined = await page.evaluate(() => !!(window.gridLayer));
    console.log('DEBUG: gridLayer defined on page?', gridDefined);

    // Find 'Heatmap Grid' overlay input and toggle it
    const overlayFound = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('.leaflet-control-layers-overlays label'));
      for (const label of labels) {
        if ((label.textContent || '').trim().indexOf('Heatmap Grid') !== -1) {
          const input = label.querySelector('input');
          if (input) {
            input.click();
            return true;
          }
        }
      }
      return false;
    });
    expect(overlayFound).toBeTruthy();

    // After toggling, saved settings should be in localStorage
    const saved = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('leafletHeatmapSettings') || 'null'); } catch (e) { return null; }
    });
    expect(saved).not.toBeNull();
    expect(Array.isArray(saved.overlays)).toBeTruthy();
    expect(saved.overlays.includes('Heatmap Grid')).toBeTruthy();

    // Reload and ensure the overlay remains enabled
    await page.reload({ waitUntil: 'networkidle2' });
    // Wait for the overlays-ready event or grid cells being drawn
    try {
      await page.waitForFunction(() => window.heatmapOverlaysReady === true, { timeout: 5000 });
    } catch (e) {
      // fallback: wait until at least one grid cell exists
      await page.waitForFunction(() => document.querySelectorAll('.grid-cell').length > 0, { timeout: 5000 });
    }
    const stillEnabled = await page.evaluate(() => {
      // find grid cells or overlay's presence
      const cells = document.querySelectorAll('.grid-cell');
      return cells && cells.length > 0;
    });
    expect(stillEnabled).toBeTruthy();
  }, 60000);
});
