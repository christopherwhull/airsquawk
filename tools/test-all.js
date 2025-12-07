#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

function runCmd(label, cmd, args = [], opts = {}) {
  console.log(`\n=== Running: ${label} ===`);
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
    child.on('close', (code) => {
      console.log(`=== ${label} exited with code ${code} ===`);
      resolve(code || 0);
    });
    child.on('error', (err) => {
      console.log(`=== ${label} failed to start: ${err} ===`);
      resolve(1);
    });
  });
}

async function main() {
  const rootDir = path.join(__dirname, '..');
  let failures = 0;

  // 1) Run Jest tests (npm test)
  const jestExit = await runCmd('Jest (npm test)', 'npm', ['test']);
  failures += jestExit ? 1 : 0;

  // 2) Run time window API test
  const timeWindowExit = await runCmd('Time Window API Test', 'node', ['tools/test-timewindow-api.js'], { cwd: rootDir });
  failures += timeWindowExit ? 1 : 0;

  // 3) Run positions per hour test
  const positionsPerHourExit = await runCmd('Positions Per Hour Test', 'node', ['tools/test-positions-per-hour.js'], { cwd: rootDir });
  failures += positionsPerHourExit ? 1 : 0;

  // 4) Run track API test
  const trackApiExit = await runCmd('Track API Test', 'node', ['tools/test-track-api.js'], { cwd: rootDir });
  failures += trackApiExit ? 1 : 0;

  // 5) Run squawk API test
  const squawkApiExit = await runCmd('Squawk API Test', 'node', ['tools/test-squawk-api.js'], { cwd: rootDir });
  failures += squawkApiExit ? 1 : 0;

  // 6) Run logo server test
  const logoServerExit = await runCmd('Logo Server Test', 'node', ['tools/test-logo-server.js'], { cwd: rootDir });
  failures += logoServerExit ? 1 : 0;

  // 7) Run SVG icons test
  const svgIconsExit = await runCmd('SVG Icons Test', 'node', ['tools/test-svg-icons.js'], { cwd: rootDir });
  failures += svgIconsExit ? 1 : 0;

  // 8) Run Leaflet Puppeteer full harness (select overlays, collect popups, auto-check hexes)
  const leafFullOut = path.join('screenshots', 'testplan', 'leaflet-test-full-' + Date.now().toString());
  const leafFullExit = await runCmd('Leaflet Puppeteer Full Harness', 'node', ['tools/leaflet-test.js', 'http://localhost:3002/heatmap-leaflet.html', leafFullOut, '--select-overlays', '--collect-popups', "--ignore-console=mesonet.agron.iastate.edu/cache/tile.py/.*sfc_analysis/.*", "--ignore-console=http://localhost:3002/api/v2logos/.*"], { cwd: rootDir });
  failures += leafFullExit ? 1 : 0;

  // 3) Python test suite (integration, endpoint and all-scripts) - detect python if present

  // 4) On Windows run the Python-based test script (cross-platform)
  const pythonCmds = ['python3', 'python'];
  let pythonCmd = null;
  const { execSync } = require('child_process');
  for (const p of pythonCmds) {
    try { execSync(`${p} --version`, { stdio: 'ignore' }); pythonCmd = p; break; } catch (e) {}
  }
  if (pythonCmd) {
    const runTestsPyExit = await runCmd('Python integration tests (tools/run_tests.py)', pythonCmd, ['tools/run_tests.py', '-r', '2', '-d', '1'], { cwd: rootDir });
    failures += runTestsPyExit ? 1 : 0;
    const allPyExit = await runCmd('Python tests (tools/test_all.py)', pythonCmd, ['tools/test_all.py', '-r', '1', '-d', '1'], { cwd: rootDir });
    failures += allPyExit ? 1 : 0;
    // Also run the endpoint-focused Python tests
    const endpointsExit = await runCmd('Python endpoint tests (tools/test_endpoints.py)', pythonCmd, ['tools/test_endpoints.py'], { cwd: rootDir });
    failures += endpointsExit ? 1 : 0;
  } else {
    // If a bash test script exists, run it (not required)
    if (require('fs').existsSync(path.join(rootDir, 'tools', 'run-tests.sh'))) {
      const shExit = await runCmd('Shell tests (tools/run-tests.sh)', 'bash', ['tools/run-tests.sh'], { cwd: rootDir });
      failures += shExit ? 1 : 0;
    } else {
      console.log('Skipping shell/PowerShell tests on non-Windows platform.');
    }
  }

  if (failures === 0) {
    console.log('\nOK: All tests passed (or were skipped).');
    process.exit(0);
  } else {
    console.error(`\nFAILED: ${failures} test group(s) failed.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unhandled error running tests:', err);
  process.exit(2);
});
