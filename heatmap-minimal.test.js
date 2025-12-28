const puppeteer = require('puppeteer');

describe('Minimal Heatmap Page', () => {
  let browser;
  let page;
  const consoleErrors = [];

  beforeAll(async () => {
    browser = await puppeteer.launch({ headless: true });
    page = await browser.newPage();

    page.on('console', msg => {
      if (msg.type() === 'error') {
        const errorText = msg.text();
        console.log(`BROWSER CONSOLE ERROR: ${errorText}`);
        if (msg.location()) {
            console.log(`    at ${msg.location().url}:${msg.location().lineNumber}:${msg.location().columnNumber}`);
        }
        consoleErrors.push(errorText);
      }
    });

    page.on('pageerror', error => {
        console.log(`BROWSER PAGE ERROR: ${error.message}`);
        consoleErrors.push(error.message);
    });

    page.on('response', response => {
        if (response.status() >= 400) { // Only log 4xx and 5xx errors
            const errorText = `${response.status()} ${response.statusText()}: ${response.url()}`;
            console.log(`BROWSER NETWORK ERROR: ${errorText}`);
            consoleErrors.push(errorText);
        }
    });
  });

  afterAll(async () => {
    await browser.close();
  });

  test('should load and run without console errors for 5 seconds', async () => {
    try {
      await page.goto('http://localhost:3002/heatmap-minimal.html', { waitUntil: 'load' });
    } catch (e) {
      throw new Error('Failed to navigate to the page. Is the server running with `npm start`? ' + e.message);
    }

    await new Promise(resolve => setTimeout(resolve, 5000));

    expect(consoleErrors).toHaveLength(0);
  }, 30000); // Increased timeout to 30 seconds
});
