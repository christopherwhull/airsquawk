# Tools Directory

This directory contains all the utility scripts and tools for the Aircraft Dashboard project.

## Categories

### Data Analysis & Processing
- `aircraft_tracker.py` - Main aircraft tracking script
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
- `check_airline_stocks.js` - Check airlines with stock tickers
- `create-logo-media-pack.js` - Download all logos and create ZIP media pack
- `find_airlines_without_logos.js` - Find airlines missing logos
- `process-airlines.js` - Process airline data (includes logo processing)

### Testing & Validation
- `check-latest-data.js` - Check latest data availability
- `check_tracker_output.js` - Validate tracker output
- `count-s3-records.js` - Count S3 records
- `test-all.ps1` - Run all tests (PowerShell)
- `test-api-endpoints.js` - Test API endpoints
- `test-endpoints.ps1` - Test endpoints (PowerShell)
- `test_aircraft_api.js` - Test aircraft API
- `test_aircraft_lookup.js` - Test aircraft lookup
- `test_squawk_api.js` - Test squawk API
- `test_workflow.py` - Complete testing workflow
- `run-tests.ps1` - Run tests (PowerShell)
- `run_tests.py` - Run tests (Python)
- `validate_kml.py` - Validate KML data
- `verify_backend_data.js` - Verify backend data integrity

### Server Management
- `restart-server.ps1` - Restart server (PowerShell)
- `restart-server.sh` - Restart server (Bash)
- `restart_server.bat` - Restart server (Batch)
- `restart_server.ps1` - Restart server (PowerShell)
- `start_server.py` - Start server script

### Investigation & Debugging
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
python tools/aircraft_tracker.py

# PowerShell scripts
.\tools\test-all.ps1
```

## Dependencies

- Node.js (for .js files)
- Python 3 (for .py files)
- PowerShell (for .ps1 files)
- AWS CLI/S3 access (for upload/download scripts)
- Appropriate permissions for file system and network access