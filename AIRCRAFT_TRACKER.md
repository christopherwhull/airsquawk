# Aircraft Tracker

> **⚠️ DEPRECATED**: The `aircraft-tracker.py` file has been renamed to `aircraft_tracker.py` to follow Python naming conventions. The old filename now shows a deprecation warning.

Python script that monitors PiAware aircraft data and uploads to S3/MinIO for the Aircraft Dashboard.

## Features

- Real-time aircraft tracking from PiAware dump1090
- Minute-by-minute S3 uploads with hourly rollup files
- Reception range analysis with bearing/altitude tracking
- KML file generation for Google Earth visualization
- **TSDB Integration**: Optional time-series database writes to InfluxDB 3 for historical position data
- **S3 Database Enrichment**: Comprehensive aircraft type and registration lookup from S3-stored databases (236K+ aircraft, 5.7K+ airlines)
- **Multi-Source Enrichment Pipeline**: Prioritized enrichment from S3 databases → ICAO cache → PiAware API → local fallbacks
- Aircraft type database integration
- Automatic deduplication and data quality checks
- Cross-platform support (Windows/Linux)

## Requirements

- Python 3.8+
- PiAware dump1090 running (default: `192.168.0.178:8080`)
- MinIO/S3 server (default: `localhost:9000`)
- Optional: InfluxDB 3 server for TSDB integration (default: `http://127.0.0.1:8181`)
- Required Python packages: `boto3`, `requests`

## Installation

1. Install Python dependencies:
```bash
pip install boto3 requests
```

2. Ensure MinIO is running:

**Windows:**
The script will detect MinIO on startup but will NOT attempt to start it automatically by default.
If you explicitly want the script to start a local MinIO instance (Windows-only automatic start), run the tracker with `--allow-minio-start` and ensure the startup script exists at `C:\minio\start_minio.ps1`.

**Linux:**
Start MinIO manually before running the tracker:
```bash
# Via systemd
sudo systemctl start minio

# Via Docker
docker run -p 9000:9000 -p 9001:9001 minio/minio server /data --console-address ":9001"

# Manual
./minio server /data
```

## Usage

Basic usage with defaults from `config.json`:
```bash
python aircraft_tracker.py
```

Enable TSDB writes to InfluxDB 3:
```bash
python aircraft_tracker.py --enable-tsdb
```

Specify custom PiAware server:
```bash
python aircraft_tracker.py --piaware-url http://192.168.1.100:8080
```

Override S3 credentials:
```bash
python aircraft_tracker.py --s3-access-key mykey --s3-secret-key mysecret
```

Read-only mode (no writes):
```bash
python aircraft_tracker.py --read-only
```

Test run (2 minutes or 100 updates):
```bash
python aircraft_tracker.py --enable-tsdb --test-run
```

## Configuration

The script reads S3 credentials from `config.json` by default, which can be overridden by:
1. Environment variables (see `CONFIGURATION.md`)
2. Command-line arguments (see `--help`)

### Command-Line Options

- `--piaware-url URL` - PiAware server URL (default: http://localhost:8080)
- `--s3-endpoint URL` - S3/MinIO endpoint (default from config.json)
- `--s3-access-key KEY` - S3 access key (default from config.json)
- `--s3-secret-key SECRET` - S3 secret key (default from config.json)
- `--s3-bucket NAME` - Main data bucket (default: aircraft-data)
- `--s3-kml-bucket NAME` - KML output bucket (default: output-kmls)
- `--s3-reception-bucket NAME` - Reception data bucket (default: piaware-reception-data)
- `--heatmap-cell-size NM` - Grid cell size in nautical miles (default: 5)
- `--s3-history-hours HOURS` - Hours of history to scan on startup (default: 24)
- `--enable-tsdb` - Enable TSDB writes to InfluxDB 3
- `--tsdb-url URL` - TSDB server URL (default: http://127.0.0.1:8181)
- `--tsdb3-token TOKEN` - TSDB authentication token
- `--read-only` - Disable all file writes
- `--disable-s3` - Disable S3 uploads
- `--test-run` - Run for a few iterations and exit

Run `python aircraft_tracker.py --help` for complete options.

## How It Works

### Data Flow

1. **Poll PiAware** - Queries dump1090 JSON every 5 seconds
2. **Track Aircraft** - Maintains in-memory state of all active aircraft
3. **Calculate Reception** - Tracks bearing, altitude, and range for reception analysis
4. **Minute Files** - Saves position snapshots to S3 every minute
5. **Hourly Rollup** - Consolidates minute files into hourly archives with deduplication
6. **KML Generation** - Creates Google Earth visualizations every 10 minutes

### S3 Structure

```
aircraft-data/
  ├── minute_YYYY-MM-DD_HH-MM.json      # Per-minute position snapshots
  └── hourly_YYYY-MM-DD_HH.json         # Hourly consolidated data

output-kmls/
  └── piaware.reception.kml             # Reception range visualization

piaware-reception-data/
  └── YYYY/MM/DD/HH/reception_YYYY-MM-DD_HH.txt  # Reception records

icao-hex-cache/
  └── aircraft_type_database.json       # Aircraft type mappings
```

## TSDB Integration

The tracker can optionally write aircraft position data to InfluxDB 3 for time-series analysis and historical queries.

### TSDB Setup

1. **Install InfluxDB 3**:
   - Download from https://www.influxdata.com/products/influxdb/
   - Windows: Extract and run `influxdb3.exe serve`
   - Linux: Follow installation instructions

2. **Create Database**:
   ```bash
   influxdb3 create database airsquawk --node-id local
   ```

3. **Configure Authentication**:

   #### Admin Token Generation
   Generate an admin token for full database access:
   ```bash
   # Windows
   C:\influxdb3-core-3.7.0-windows_amd64\influxdb3.exe admin create-token --name "airsquawk-admin"

   # Linux/Mac
   influxdb3 admin create-token --name "airsquawk-admin"
   ```
   This will output a token like: `apiv3_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

   #### Token Update to JSON
   Add the generated token to your `config.json`:
   ```json
   {
     "tsdb": {
       "token": "apiv3_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
     }
   }
   ```

   #### Starting TSDB with Authentication
   Start InfluxDB 3 with authentication enabled:
   ```bash
   # Windows
   C:\influxdb3-core-3.7.0-windows_amd64\influxdb3.exe serve --auth-token "your_admin_token_here"

   # Linux/Mac
   influxdb3 serve --auth-token "your_admin_token_here"
   ```

   #### Use of Normal (Write) Token
   For production, create a least-privilege write token:
   ```bash
   # Create write-only token for aircraft_positions_new table
   influxdb3 admin create-token --name "airsquawk-write" --write-table "aircraft_positions_new"
   ```
   Use this token in `config.json` for the tracker - it can only write data, not read or delete.

### TSDB Data Flow

When `--enable-tsdb` is specified:
1. **Position Collection** - Captures lat/lon/altitude for each aircraft
2. **Line Protocol Formatting** - Converts to InfluxDB line protocol format
3. **Batch Writes** - Sends data via REST API every poll cycle
4. **Authentication** - Uses Bearer token for secure writes

### TSDB Schema

Data is stored in the `aircraft_positions_new` measurement with:
- **Tags**: `icao` (aircraft ID), `flight` (callsign)
- **Fields**: `lat`, `lon`, `altitude`, `speed`, `heading`
- **Timestamp**: Nanosecond precision from ADS-B data

### Querying TSDB Data

Use the InfluxDB CLI to query historical data (requires admin token for read access):

```bash
# Total position records
influxdb3 query --database airsquawk --token YOUR_ADMIN_TOKEN "SELECT count(*) FROM aircraft_positions_new"

# Unique aircraft
influxdb3 query --database airsquawk --token YOUR_ADMIN_TOKEN "SELECT count(distinct icao) FROM aircraft_positions_new"

# Recent positions for specific aircraft
influxdb3 query --database airsquawk --token YOUR_ADMIN_TOKEN "SELECT * FROM aircraft_positions_new WHERE icao = 'ABC123' ORDER BY time DESC LIMIT 10"
```

### TSDB Benefits

- **Historical Analysis**: Query position history over time
- **Performance Metrics**: Track reception quality and coverage
- **Real-time Monitoring**: Live position updates for multiple aircraft
- **Data Retention**: Configurable retention policies for long-term storage

### Startup Reconciliation

On startup, the script:
1. Loads all minute files from the current hour
2. Compares with existing hourly file
3. Appends any missing records to avoid duplicates
4. Resumes tracking with full context

This ensures no data loss after crashes or restarts.

## Aircraft Enrichment

The tracker automatically enriches aircraft data with type, registration, and airline information using a multi-source pipeline:

### Enrichment Sources (Priority Order)

1. **S3 Aircraft Type Database** - Primary source with 236,752 aircraft entries
   - File: `aircraft_type_database.json` in `aircraft-data` bucket
   - Contains: ICAO hex → aircraft type + registration mappings
   - Coverage: Global fleet with comprehensive type information

2. **S3 Airline Database** - Airline name lookup from callsigns
   - File: `airline_database.json` in `aircraft-data` bucket  
   - Contains: 5,774 airline codes → full names + logos
   - Coverage: IATA/ICAO airline codes worldwide

3. **S3 ICAO Cache** - Individual aircraft cache files
   - Files: `{hex_code}.json` in `icao-hex-cache` bucket
   - Contains: Cached enrichment data per aircraft
   - Updated: When new aircraft discovered

4. **PiAware Static Database** - External API fallback
   - Source: PiAware aircraft database API
   - Used: When S3 sources unavailable
   - Rate-limited: External dependency

5. **Local Fallbacks** - Emergency local databases
   - Files: `airline_database.json`, `registration_db.json`
   - Used: When all remote sources fail

### Enrichment Process

For each aircraft, the tracker:
1. Extracts callsign, hex code, and basic data from ADS-B
2. Looks up airline from callsign (first 3 characters)
3. Looks up aircraft type and registration from hex code
4. Caches successful lookups to S3 for future use
5. Stores enriched data in position records

### Performance Benefits

- **Comprehensive Coverage**: 236K+ aircraft in primary database
- **Reduced API Calls**: S3 databases eliminate external dependencies  
- **Fast Lookups**: In-memory caching of database files
- **Reliability**: Multiple fallback sources ensure enrichment always works

## Platform Notes

### Windows
- MinIO auto-start is supported but disabled by default. To allow automatic startup, pass `--allow-minio-start` when running the script. The startup script should be located at `C:\minio\start_minio.ps1`.
- PowerShell is used for hidden window startup when auto-start is enabled
- Paths automatically converted for S3 (backslash → forward slash)

### Linux
- Manual MinIO startup required (systemd recommended)
- Use forward slashes in all paths
- Consider running as a systemd service for automatic startup

## Monitoring

The script provides colorized console output:
- 🟢 Green: Success messages (MinIO started, data saved)
- 🟡 Yellow: Warnings (connection issues, missing data)
- 🔴 Red: Errors (S3 failures, missing buckets)

When TSDB is enabled, output includes:
- Total REST writes to InfluxDB
- Current active aircraft count
- Position update frequency (every 0.25 seconds)

## Troubleshooting

**MinIO not starting on Windows:**
- Verify `C:\minio\start_minio.ps1` exists
- Check PowerShell execution policy: `Set-ExecutionPolicy RemoteSigned`
- Start MinIO manually and the script will detect it

**MinIO not detected on Linux:**
- Start MinIO before running the tracker
- Verify port 9000 is accessible: `curl http://localhost:9000`
- Check firewall rules if using remote MinIO

**S3 upload failures:**
- Verify credentials in `config.json` match MinIO
- Check bucket exists: Use MinIO console at `http://localhost:9001`
- Ensure sufficient disk space for MinIO data directory

**TSDB connection failures:**
- Verify InfluxDB 3 is running: `curl http://127.0.0.1:8181/health`
- Check token in `config.json` matches InfluxDB admin token
- Ensure database exists: `influxdb3 query --database airsquawk --token YOUR_ADMIN_TOKEN "SHOW TABLES"`
- Test write manually: Use the test commands in the TSDB section
- **Authentication errors**: Ensure InfluxDB was started with `--auth-token` flag
- **Token permissions**: Use admin token for setup, write token for production
- **Token format**: Should start with `apiv3_` and be properly quoted in commands

**No aircraft data:**
- Verify PiAware dump1090 is running and accessible
- Check correct IP:port for your PiAware: `curl http://192.168.0.161:8080/data/aircraft.json`
- Ensure network connectivity to PiAware

## Integration with Dashboard

The dashboard server automatically reads from the S3 buckets populated by this tracker:
- Position cache loads 7 days of minute files on startup
- Live stats query current hour's data
- Reception page visualizes the reception records
- Airline/flight statistics aggregate from hourly files

Both the tracker and dashboard should use the same S3 credentials configured in `config.json`.

## License

Part of the Aircraft Dashboard for PiAware project.
