const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const path = require('path');

async function checkPageErrors() {
    let browser;
    let server;
    try {
        console.log('Starting server...');
        server = spawn('node', ['server.js']);

        // Wait for the server to start
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log('Launching browser...');
        browser = await puppeteer.launch();
        const page = await browser.newPage();

        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.log(`Error: ${msg.text()}`);
            } else if (msg.type() === 'warning') {
                console.log(`Warning: ${msg.text()}`);
            }
        });
        page.on('response', response => {
            const status = response.status();
            if (status >= 400) {
                console.log(`HTTP ${status}: ${response.url()}`);
            }
        });
        page.on('requestfailed', request => {
            const failure = request.failure();
            console.log(`Request failed: ${request.url()} (${failure && failure.errorText})`);
        });

        const defaultPath = '/live-moving-map.html';
        const cliArg = process.argv[2];
        const target = cliArg ? (cliArg.startsWith('http') ? cliArg : `http://localhost:3002${cliArg}`) : `http://localhost:3002${defaultPath}`;
        const url = target;
        console.log(`Navigating to ${url}`);
        
        await page.goto(url, { waitUntil: 'networkidle2' });

        console.log('Page loaded. Waiting for errors...');

        // Wait for a few seconds to catch any async errors
        await new Promise(resolve => setTimeout(resolve, 5000));

    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        if (browser) {
            await browser.close();
            console.log('Browser closed.');
        }
        if (server) {
            server.kill();
            console.log('Server stopped.');
        }
    }
}

checkPageErrors();
