# Tools Directory

This directory contains all the utility scripts and tools for the AirSquawk project.

## Categories

### Data Analysis & Processing
- `aircraft-tracker.py` - **DEPRECATED**: Use `aircraft_tracker.py` in root directory instead. Main aircraft tracking script with S3 uploads, KML generation, and optional TSDB writes
- `aircraft_tracker.py` - Main aircraft tracking script with S3 uploads, KML generation, and optional TSDB writes (in root directory)
- `backfill_tsdb_from_s3.py` - Backfill historical position data from S3 minute files to TSDB
- `analyze_readonly_source.py` - Analyze readonly data sources
- `analyze_squawk_local.py` - Analyze squawk codes locally
- `analyze_squawk_s3.py` - Analyze squawk codes from S3
- `check_hex_cache.py` - Check hex cache data
- `check_hourly_positions.py` - Validate hourly position data
- `check_minute_vs_hourly.py` - Compare minute vs hourly data
- `check_readonly_overwrites.py` - Check for readonly data overwrites
- `compare_readonly_vs_hourly.py` - Compare readonly vs hourly data
- `compare_server_vs_tracker.py` - Compare server vs tracker data
- `count_readonly_positions.py` - Count readonly positions
- `count_squawk_1200.py` - Count squawk 1200 occurrences
- `count_squawk_7days.py` - Count squawk codes over 7 days
- `count_squawk_7days_detailed.py` - Detailed 7-day squawk analysis
- `count_squawk_transitions_by_hour.py` - Hourly squawk transitions
- `flights_per_hour_chart.py` - Generate flight charts

### Database & Data Management
- `airline_lookup.py` - Airline data lookup utilities
- `build_aircraft_types_db.js` - Build aircraft types database
- `check_buckets.py` - Check S3 bucket contents
- `check_s3_types.js` - Validate S3 data types
- `config_reader.py` - Configuration file reader
- `create-bucket.js` - Create S3 buckets
- `dashboard_utils.py` - Dashboard utility functions
- `download_opensky_db.py` - Download OpenSky database
- `populate-flight-history.js` - Populate flight history data
- `process-airlines.js` - Process airline data
- `registration_lookup.py` - Aircraft registration lookup
- `upload-airline-db.js` - Upload airline database to S3
- `upload-media-pack.js` - Upload logo media pack ZIP to S3
- `upload-to-s3.js` - General S3 upload utility
- `upload-types.js` - Upload aircraft types to S3

### Logo Management
- `process-airlines.js` - Process airline data (includes logo processing)

### Testing & Validation
- `check-latest-data.js` - Check latest data availability
- `check_tracker_output.js` - Validate tracker output
- `count-s3-records.js` - Count S3 records
- `test_all.py` - Run all tests (Python)
- `test-api-endpoints.js` - Test API endpoints
- `test_endpoints.py` - Test endpoints (Python)
- `test_aircraft_api.js` - Test aircraft API
- `test_aircraft_lookup.js` - Test aircraft lookup
- `test_squawk_api.js` - Test squawk API
- `test_workflow.py` - Complete testing workflow
- `run-tests.ps1` - Run tests (deprecated; moved to stashed/powershell-scripts; use `run_tests.py`)
- `run_tests.py` - Run tests (Python)
- `validate_kml.py` - Validate KML data
- `verify_backend_data.js` - Verify backend data integrity

### Server Management
- `tools/manage_services.py` - Cross-platform Python helper to start/stop/restart/status the development Node servers.

Usage examples:

```powershell
# Start all services (server, geotiff, tile-proxy) in background
python tools/manage_services.py start

# Start and wait for health endpoints (wait up to 30s)
python tools/manage_services.py start --wait --timeout 30

# Restart services
python tools/manage_services.py restart --wait

# Stop services
python tools/manage_services.py stop

# Show status
python tools/manage_services.py status
```

Notes:
- The manager writes PID files and logs to `runtime/<service>.pid` and `runtime/<service>.log`.
- This tool is intended for developer workflows and CI helpers; for production use a real
	process supervisor such as `pm2`, `systemd`, or Docker.

## MinIO safety note

- This project may rely on a local MinIO server for multiple services. Do **not** restart
	or stop the system-wide MinIO instance unless you understand the impact on other
	services running on your machine.
- `tools/manage_services.py` will not manage any service named `minio` by default. To
	explicitly allow managing a `minio` service entry you must pass the explicit
	`--force-minio` flag (or the deprecated `--manage-minio` alias). Example:

```pwsh
# Only do this if you are certain you want the manager to start/stop MinIO
python .\tools\manage_services.py start --force-minio --wait --timeout 30
```

If you are unsure, avoid passing `--force-minio` and use your system's MinIO control
scripts instead (e.g. the project's `start_minio.ps1` or your OS service manager).

### Investigation & Debugging

## All Tests Kickoff

To run all test suites (Jest unit tests, Python integration tests, and platform-specific tests) use the cross-platform wrapper:

```bash
# Run all tests (Jest, Python runner, PS/batch tests) via Node wrapper
npm run test:all
```

This wrapper is implemented as `tools/test-all.js` and invokes the existing tests in sequence:
- `npm test` (Jest unit tests)
- `python tools/run_tests.py` (integration tests; will use `python3` or `python` if available)
- Python (`tools/stashed/test_all.py`) on all platforms or `tools/run-tests.sh` on Unix if present

It returns an exit code of `0` if all test groups pass, otherwise non-zero and prints a summary.
- `find_last_1200_squawk.js` - Find last squawk 1200
- `find_last_transition.js` - Find last squawk transition
- `investigate_last_transition.js` - Investigate transitions
- `list_minio.py` - List MinIO contents

## Usage

Most scripts can be run directly with Node.js or Python:

```bash
# JavaScript tools
node tools/check_airline_stocks.js

# Python tools
python aircraft_tracker.py  # Main tracker (in root directory)

# Backfill TSDB from S3 minute files
python tools/backfill_tsdb_from_s3.py --dry-run  # Preview what would be backfilled
python tools/backfill_tsdb_from_s3.py --limit 10  # Process first 10 files of each type
python tools/backfill_tsdb_from_s3.py --start-date 2025-12-01  # From specific date
python tools/backfill_tsdb_from_s3.py --skip-hourly  # Only process minute files

# Python tools
python tools/stashed/test_all.py
```

## Leaflet test harness (Puppeteer)

The `tools/leaflet-test.js` script is a Puppeteer-based capture harness for the live Leaflet heatmap (`heatmap-leaflet.html`). Use it to:
- Select overlay layers
- Collect popups for visible aircraft
- Check that per-hex polylines (live/long/persistent/temp) exist

Command example (full run):

```bash
node tools/leaflet-test.js "http://localhost:3002/heatmap-leaflet.html" screenshots/testplan/leaflet-test-full --select-overlays --collect-popups --ignore-console="mesonet.agron.iastate.edu/cache/tile.py/.*sfc_analysis/.*" --ignore-console="http://localhost:3002/api/v2logos/.*"
```

This will produce the following artifacts in the `screenshots/testplan/leaflet-test-full` directory (or the `outdir` you supply):
- `leaflet-screenshot.png` — full-page screenshot
- `leaflet-console.json` — captured console logs
- `leaflet-network.json` — captured network requests & responses
- `leaflet-pane-summary.json` — counts of drawn paths, svgs, etc.
- `popups.json` — collected popup HTML for visible aircraft
- `hex-check-results.json` — auto-detected or explicit hex check results
- `run-info.json` — instrumentation summary with flags, Node version, counts, and the hex-check results

Test Plan & Artifacts
---------------------
This harness implements the following test plan (integration-style):

- Boot the Leaflet production heatmap page: `heatmap-leaflet.html`.
- Optionally select all overlay tile layers and ensure the `show-live` and `show-heatmap` toggles are enabled.
- Move the map center 30 miles west, zoom in 4 levels and back out 4 levels (to exercise tile loading, overlays and multiscale rendering).
- Optionally collect popup contents for all visible aircraft (if `--collect-popups` is supplied); click each marker or DOM icon to open the popup and capture the HTML.
- Auto-select up to 3 visible hexes (or use `--check-hex=aabbcc`) and check for polylines in `live`, `long`, `persistent` or `temp` layers for each hex.
- Assert that at least one auto-selected hex has a polyline (if auto-selected), or that each explicit `--check-hex` supplied has a polyline.
- Record any assertion failures (fatal) or warnings (non-fatal) and write them to `assertion-failures.json` and `assertion-warnings.json` respectively.

Writes the artifacts to `screenshots/testplan/<outdir>` by default, along with `run-info.json` which is useful for summarizing the run.  The `run-info.json` contains a `summary` object which includes `paneSummary`, `gridHasCells`, `layerCounts`, `selectedHexes`, `autoSelectedHexes`, `consoleErrorCount`, `pageErrorCount`, and `hexCheckSummary`.

Tips & Troubleshooting
----------------------
- If the harness fails due to a console error from an external service (e.g., Mesonet tile 404), pass an `--ignore-console` pattern using `--ignore-console=PATTERN`.
- For a deterministic hex-check run, pass explicit `--check-hex=hex1,hex2` to force strict assertions for those hexes.
- Use `npm run test:leaflet:full` to run the harness with typical options and write artifacts to `screenshots/testplan/leaflet-test-full`.

Use `test-heatmap.ps1 -FullRun` or `npm run test:all` and the `tools/test-all.js` wrapper to run the full Leaflet harness as part of the broader test suite. The harness will auto-select visible hexes if `--check-hex` is omitted.


## Restart Workflow (AI Agent)

This project includes scripts and utilities to help an AI agent or automation safely restart the Node.js server when code is updated. Follow the steps below.

- `tabs-time-summary.json` — optional artifact created by `--tabs` containing measured latency and response metadata for the `reception`, `flights`, and `squawk` tabs
- `tabs-time-summary-aggregate.json` — if you run the `leaflet-tabs-aggregate.js` script, you'll get aggregated summary stats for min/avg/max/median per tab and overall
- `--assert-v2logo` — When set, the harness asserts that all `/api/v2logos/*` requests map to codes in the airline database and will fail (exit non-zero) with `assertion-failures.json` if any mismatch is found.
- `--assert-reuse` — When set, the harness asserts that `reuseRate` (measured across `--reuse-repeats`) is >= `--reuse-threshold` and that `logoChangeRate` is 0. If this check fails, the harness will fail (exit non-zero) and write `leaflet-reuse-report.json` and `assertion-failures.json`.
 - `--assert-no-304` — When set, the harness asserts that repeated `304 Not Modified` responses for `/api/*` endpoints don't exceed a threshold and will fail if they do, writing `leaflet-304-report.json` and `assertion-failures.json`.
	 - `--max-304=<n>` sets the maximum allowed 304 responses per API path across the run; defaults to `1`.
 - `--assert-airline-db-storage` — When set, the harness asserts that the client has written `airlineDB-v1` into localStorage and that it contains a JSON with a `ts` and `data` property. If present, the harness will write `leaflet-airline-db.json` containing the snapshot.
	 - `--max-airline-db-age-min=<n>` sets the maximum acceptable age (in minutes) for the stored airline DB; if the stored timestamp is older than this value an assertion warning (not failure) will be emitted; defaults to `60`.

	Note: UI improvements include a small airline DB indicator in the page header and a "Clear Airline DB Cache" button in the Cache Status tab which clears the `airlineDB-v1` entry in localStorage and clears the in-memory `window.airlineDB` state.

	## Time-Series DB helper (InfluxDB 3)

	We included a lightweight helper `tools/tsdb-check.py` to create databases and tokens and to perform a write/query test using the InfluxDB 3 CLI; you can also use the Python v3 client (`influxdb3-python`) for tests with `--use-python-client`.

	Example usage:

	```pwsh
	# Create database (requires admin token)
	C:\influxdb3-core-3.7.0-windows_amd64\influxdb3.exe create database aircraft --host http://127.0.0.1:8181 --token <ADMIN_TOKEN>

	# Use helper to create DB, create a token, write a test point and query it
	python tools/tsdb-check.py --cli-path "C:\\influxdb3-core-3.7.0-windows_amd64\\influxdb3.exe" --host http://127.0.0.1:8181 --database aircraft --admin-token "<ADMIN_TOKEN>" --create-token --write-token-from-admin

	# Use helper to write test point using existing token
	python tools/tsdb-check.py --cli-path "C:\\influxdb3-core-3.7.0-windows_amd64\\influxdb3.exe" --host http://127.0.0.1:8181 --database aircraft --write-token "<TRACKER_TOKEN>"

	# Use the Python v3 client instead of the CLI (requires installing `influxdb3-python`)
	python tools/tsdb-check.py --host http://127.0.0.1:8181 --database aircraft --write-token "<TRACKER_TOKEN>" --use-python-client
	```

	Tracker: Start with REST to InfluxDB v3 on port 8181 (direct token usage)
	```pwsh
	# Start the aircraft tracker and write to InfluxDB v3 via REST on port 8181
	python aircraft_tracker.py --enable-tsdb --tsdb-type influxdb3 --tsdb-url http://127.0.0.1:8181 --tsdb3-token apiv3_zfjnod7a-_LaE9RFBQ80xdzuxW7NVQxJ0pGcbzLr-42gOJ57SmL1l8D-HHAiDxJciG6vUl0Uw0LxYWjRKT3aiQ
	```

	Notes:
	- The helper accepts the admin token via the `--admin-token` flag or `INFLUXDB3_ADMIN_TOKEN` environment variable.
	- To run tests using the Python v3 client, install the client package:

	```pwsh
	pip install influxdb3-python
	```
	- The CLI path default is `influxdb3`, but you can pass a full path using `--cli-path` if your environment doesn't have it in PATH.
	- For production use, create a dedicated least-privilege token and specify with `--write-token`.

	- The InfluxDB write now includes additional aircraft fields in the `aircraft_positions` measurement:
	  - numeric fields: `heading`, `rssi`, `first_seen`, `last_seen`, `squawk_changed` (as 0/1)
	  - string field: `data_quality` (e.g., GPS, GPS approx, No position)

### TimescaleDB (Postgres) configuration & test

- You can configure TimescaleDB connection details under the `tsdb` block in `config.json` to store aircraft positions in a PostgreSQL/TimescaleDB database. Example:

```jsonc
"tsdb": {
	"type": "timescale",
	"url": "postgresql://timescale_user:tsPwd2025!@192.168.0.100:5432/aircraft_test",
	"db": "aircraft_test",
	"user": "timescale_user",
	"password": "tsPwd2025!",
	"measurement": "aircraft_positions"
}
```

- Use `tools/timescale-check.py` to test connectivity and writes. It accepts `--host`, `--port`, `--db`, `--user`, `--password`, and flags like `--create-table`, `--insert-test` and `--query-test`.

- Example usage (if using Postgres default port 5432):

```pwsh
python tools/timescale-check.py --create-table --insert-test --query-test --host 192.168.0.100 --port 5432 --db aircraft_test --user timescale_user --password "tsPwd2025!"
```

Notes:
- If your Timescale server uses a non-standard port (e.g., 8181) and speaks the Postgres protocol there, you can configure that port in `tsdb.url` (use the `postgresql://` scheme). The tracker will attempt to connect using `psycopg2` and will fail if the server doesn't speak Postgres protocol on that port.
- If your Timescale instance exposes an HTTP REST write endpoint, configure `tsdb.url` with the HTTP write URL and keep `tsdb.type` as `timescale`; the tracker will detect an `http` scheme and POST JSON rows (with optional Basic Auth using `tsdb.user` and `tsdb.password`). See the example below:

```jsonc
"tsdb": {
	"type": "timescale",
	"url": "http://192.168.0.100:8181/timescale_write",
	"db": "aircraft_test",
	"user": "timescale_user",
	"password": "tsPwd2025!",
	"measurement": "aircraft_positions"
}
```

Use the `--use-http` flag with the `tools/timescale-check.py` helper to test HTTP writes:

```pwsh
python tools/timescale-check.py --use-http --endpoint "http://192.168.0.100:8181/timescale_write" --user timescale_user --password "tsPwd2025!"
```
- When using the `tsdb.url` field with a URL, include the `postgresql://` scheme and credentials and use a safe password (avoid `@` within the password or percent-encode it properly).
 

	Positions timescale
	-------------------
	- The positions timeseries graph now follows the top-of-page timescale control (`id=time-window` on the index page or `id=heatmap-window` on the heatmap page). When present, this control is authoritative and overrides per-tab manual start/end inputs.
	- The positions UI now includes a small label (`#positions-timescale-indicator`) showing the active timescale (e.g., `24h`, `1h`, `7d`, or human friendly `All time`).
	- A new integration test `__tests__/positions-timescale.test.js` validates that changing the global timescale updates the positions timeseries times window.
1. Check the running server status and compare with local commit:

```pwsh
# Show the running server commit & uptime
node tools/check_server_restart.js --server http://localhost:3002
```

2. Force an automatic restart if the server commit differs from local (safe mode):

```pwsh
# Auto-restart the server if local commit differs from running server
npm run restart:auto
```

3. For direct restarts using the Node runtime, start the server using a dedicated script that avoids opening an interactive terminal:

```pwsh
# Start Node server in a background window (Windows)
npm run restart:node

# Use headless option (no visible terminal if supported)
npm run restart:headless
```

4. PM2-managed server (recommended for production):

```bash
# Start server with pm2 (install pm2 first: `npm i -g pm2`)
npm run start:pm2
# Restart server via pm2
npm run restart:pm2
```

See the main [PM2_GUIDE.md](../PM2_GUIDE.md) for comprehensive PM2 documentation including multi-service management, monitoring, and troubleshooting.

Notes:
- The `restart:auto` script runs `tools/check_and_restart_server.js` which checks server status and restarts it only when the commit SHA differs from the running server. It waits for the server to return healthy status before exiting.
- Use `ENFORCE_GIT_CLEAN=true` if you want to fail CI when local working tree is dirty.
- The scripts are intentionally conservative: they prefer to kill/restart the server gracefully and verify `/api/health` before proceeding.

### Secure remote restart via POST /api/restart

You can call a secure HTTP endpoint to trigger a server restart. Set the server's environment variable `RESTART_API_TOKEN` and then use the token to authorize the request.

Example (curl):

```bash
# With Bearer token
curl -X POST http://localhost:3002/api/restart -H "Authorization: Bearer $RESTART_API_TOKEN"

# With X-Restart-Token header
curl -X POST http://localhost:3002/api/restart -H "X-Restart-Token: $RESTART_API_TOKEN"

# Or JSON body
curl -X POST http://localhost:3002/api/restart -H "Content-Type: application/json" -d '{"token": "'$RESTART_API_TOKEN'" }'
```

CI example (GitHub Actions step):

```yaml
- name: Trigger remote restart (if needed)
	run: |
		curl -X POST -H "Authorization: Bearer ${{ secrets.RESTART_API_TOKEN }}" http://staging.example.com/api/restart
```


## Dependencies

- Node.js (for .js files)
- Python 3 (for .py files)
- AWS CLI/S3 access (for upload/download scripts)
- Appropriate permissions for file system and network access