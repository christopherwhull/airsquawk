# Aircraft Dashboard — Real-time Flight Intelligence for PiAware

Turn raw ADS‑B feeds from a PiAware receiver into actionable, real-time flight intelligence. Aircraft Dashboard provides live tracking, fleet and airline analytics, historical playback, and reception analysis—on-premise or in the cloud—making it ideal for hobbyists, operators, small airports, and engineers who need reliable, low-latency situational awareness and flexible analytics.

Why it matters:
- Real-time situational awareness: See live aircraft positions and telemetry with minimal latency.
- **Comprehensive Aircraft Intelligence**: Automatic enrichment with aircraft types, registrations, and airline data from 236K+ aircraft database.
- Deep analytics: Track flights, squawk transitions, and aggregate per-airline statistics.
- Secure & private: Run fully on-premise with MinIO/S3 for optional archival and controlled data retention.
- Extensible & open source: Integrate with PiAware and customize the data pipeline to meet your needs.

---

> Getting started (2 minutes)
>
> 1) Clone the repo and install dependencies
>
> ```bash
> git clone https://github.com/christopherwhull/aircraft-dashboard.git
> cd aircraft-dashboard
> npm install
> ```
>
> 2) Configure a PiAware endpoint in `config.js` or env var `PIAWARE_URL`
>
> 3) Start the server
>
> ```bash
> npm start
> ```
>
> You’ll have a working local dashboard at http://localhost:3002 — see all tabs including Cache Status, Live, Heatmap, and more for comprehensive flight data and analytics.

---

## Requirements

- **PiAware Server** - Running and accessible on your local network (provides ADS-B data)
- **Node.js** - Version 14 or higher
- **MinIO S3 Storage** - For historical data storage and caching (or compatible S3 service)
- **Python 3.x** - Optional, for utility scripts and data analysis

## Project Structure

- **`server.js`** - Main Node.js web server
- **`config.js`** - Centralized configuration file
- **`api-routes.js`** - API endpoint definitions
- **`tools/`** - Utility scripts for data analysis, testing, and maintenance (see `tools/README.md`)
- **`logo-tools/`** - Logo management and download utilities
- **`public/`** - Static web assets (HTML, CSS, JavaScript)
- **`runtime/`** - Generated files and logs (created at runtime)

## Features

- **Live Aircraft Tracking** - Real-time display of aircraft positions from PiAware
- **Position History** - 7-day rolling cache with 24-hour in-memory history
- **Flight Statistics** - Track completed and active flights
- **Airline Analytics** - Statistics by airline with drill-down capabilities
- **Aircraft Types & Metadata** - Enriched aircraft data showing Manufacturer and Body Type across Live, Flights, Positions and Squawk views
- **Logo Management System** - Comprehensive airline and manufacturer logo download, preview, and approval workflow with parallel processing
- **Reception Analysis** - Visualize reception range by bearing and altitude
- **Squawk Transitions** - Monitor squawk code changes
- **Heatmap Visualization** - Geographic density of aircraft positions
- **S3 Data Persistence** - Automatic archival of historical data

## AI Assistant

This repo is AI-friendly. Use GitHub Copilot (GPT-5) in VS Code to help with coding, tests, and release tasks.

- Start with a clear request, include file paths and expected outcomes
- Prefer small, reviewable changes; ask for a plan on multi-step work
- The AI can run tests and S3 diagnostics and will report results

See `docs/AI_HELPER.md` for collaboration tips, commands, and release steps.

## Code Update Workflow

When updating the server with new code, follow these steps to ensure a smooth transition:

1. **Pull the latest code:**
   ```bash
   git pull
   ```
2. **Install any new dependencies:**
   ```bash
   npm install
   ```
3. **Run the test suite to ensure everything is working as expected:**
   ```bash
   npm run test:all
   ```
4. **Restart the server:**
   - **For local development:**
     ```bash
     npm run restart:node
     ```
   - **For production (using PM2):**
     ```bash
     npm run restart:pm2
     ```
   - **On Unix-like systems (if not using PM2):**
     ```bash
     bash restart-server.sh
     ```

**Service Manager (Python)**

- **Purpose:** A small cross-platform Python helper is provided to start/stop/restart the local Node services used for development (main server, GeoTIFF server, tile proxy). It creates PID and log files under `runtime/` and can wait for health endpoints.
- **Commands (from project root):**
   - `python tools/manage_services.py start` — start all services in the background
   - `python tools/manage_services.py stop` — stop running services
   - `python tools/manage_services.py restart` — restart services
   - `python tools/manage_services.py status` — show PID and health status
- **npm wrappers:** the project exposes convenient npm scripts that call the Python manager:
   - `npm run services:start`
   - `npm run services:stop`
   - `npm run services:restart`
   - `npm run services:status`
- **Notes:**
   - This helper is intended for local development and convenience only. For production use a proper process manager (`systemd`, `pm2`, containers, etc.).
   
   **MinIO safety:**

   - The service manager will not manage a service named `minio` by default to avoid
     accidentally starting or stopping a system-wide MinIO instance which may be used
     by other tooling on your machine. To manage MinIO explicitly pass the
     `--force-minio` flag (or the deprecated `--manage-minio` alias). See
     `tools/README.md` for details and examples.

## Installation

### Quick Start (All Platforms)

1. Clone the repository:
```bash
git clone https://github.com/christopherwhull/aircraft-dashboard.git
cd aircraft-dashboard
```

2. Install dependencies:
```bash
npm install
```

3. Configure settings in `config.js` or environment variables:
   - Set your PiAware URL (default: `http://192.168.0.178:8080/data/aircraft.json`)
   - Configure S3/MinIO connection details (default: `http://localhost:9000`)
   - Adjust server port (default: 3002)
   - See [CONFIGURATION.md](CONFIGURATION.md) for detailed configuration options

4. Start the server:

**Option 1: Using npm (single terminal)**
```bash
npm start
```

**Option 2: Using Python script (separate windows)**
```bash
python start_servers.py
```
This starts both the API server (port 3002) and tile proxy server (port 3004) in separate console windows for better log visibility.

5. Access the dashboard:
```
http://localhost:3002
```

### Platform-Specific Setup

**Windows:**
- Use `restart-server.sh` script for easy restart
- Run: `npm run restart:windows`
- See embedded restart instructions in the script

**Linux/Mac:**
- Follow [LINUX_SETUP.md](LINUX_SETUP.md) for comprehensive setup guide
- Includes systemd service, Docker, and manual startup options
- Run: `npm run restart:unix` or `bash restart-server.sh`
- For production, use systemd service: `sudo systemctl start aircraft-dashboard`

## Configuration

All configuration is centralized in `config.js`. Both Node.js server and Python utility scripts read from this single source.

### Quick Configuration

Use the interactive config helper (recommended):
```powershell
python tools/config_helper.py
```

Or edit `config.js` directly to customize:

- **Data Source**: PiAware server URL
- **S3 Storage**: MinIO/S3 endpoint and credentials
- **Server Port**: Default 3002
- **Buckets**: Read (historical) and write (current) bucket names
- **Update Intervals**: Data fetch and cache refresh rates
- **UI Settings**: Time ranges, graph settings, reception parameters

### Environment Variables

Override any setting using environment variables:
```bash
export S3_ACCESS_KEY=your_key
export S3_SECRET_KEY=your_secret
export PIAWARE_URL=http://your-piaware:8080/data/aircraft.json
node server.js
```

See [CONFIGURATION.md](CONFIGURATION.md) for complete configuration documentation.

## PiAware Setup

Ensure your PiAware server is:
1. Running and accessible on your network
2. Providing ADS-B data via the JSON API
3. Default URL: `http://piaware.local:8080/data/aircraft.json`

## MinIO S3 Storage Setup

MinIO is required for data persistence. Follow [MINIO_SETUP.md](MINIO_SETUP.md) for:
- **Quick Start**: Docker installation (recommended)
- **Platform-Specific**: Windows, Linux, macOS standalone installations
- **Production**: Systemd service setup for Linux
- **Configuration**: Bucket creation (or let the apps auto-create them)

**Quick Docker Start:**
```bash
docker run -d -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin123 \
  -v minio_data:/data \
  minio/minio:latest server /data --console-address ":9001"
```

Access console at: `http://localhost:9001`

**Note:** Buckets are automatically created by the Node server and aircraft tracker on startup, so you may not need to manually create them.

## Usage

### Tabs

- **Live**: Real-time aircraft currently being tracked
- **Airlines**: Statistics by airline with active flight counts
- **Flights**: Completed and active flight history
- **Positions**: Time series analysis of positions, aircraft, flights, and airlines
- **Squawk**: Squawk code transition tracking
- **Heatmap**: Geographic density visualization
- **Reception**: Range analysis by bearing and altitude

**Console / Unicode**

- The `aircraft_tracker.py` utility prints box-drawing characters for framed output. If your terminal does not use UTF-8, Python may raise a `UnicodeEncodeError`.
- Recommended ways to run with UTF-8 rendering:
   - `python -X utf8 aircraft_tracker.py` — enable Python's UTF-8 mode
   - In PowerShell: `chcp 65001` then `python aircraft_tracker.py`
   - Or set the environment for the session: ``$env:PYTHONIOENCODING='utf-8'`` then run the script
- The script also supports a strict flag: `python aircraft_tracker.py --utf8-strict` — in strict mode the script will exit if the console cannot be configured for UTF-8. The default behavior is tolerant: unsupported characters are replaced so the script does not crash.
- **Cache**: Position cache status and statistics

### Time Controls

Most tabs include time range controls:
- Quick buttons: 1h, 6h, 24h, 7d, 31d
- Custom datetime range selection
- Automatic refresh when end time is near current time

### Data Sources

Position statistics can switch between:
- **Memory**: Last 24 hours of in-memory data
- **Cache**: 7-day rolling cache
- **S3**: Historical data from MinIO/S3 storage

## API Endpoints

For comprehensive API documentation, see [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md).

### Core Endpoints
- `/api/positions` - Live aircraft positions
- `/api/heatmap-data` - Geographic density grid (1nm resolution)
- `/api/aircraft/:icao24` - Individual aircraft details
- `/api/aircraft/batch` - Bulk aircraft enrichment
- `/api/airlines` - Airline database
- `/api/v2logos/:code` - Logo serving

### Analytics Endpoints
- `/api/airline-stats` - Airline statistics
- `/api/flights` - Flight data
- `/api/squawk-transitions` - Squawk code changes
- `/api/reception-range` - Reception range analysis

### System Endpoints
- `/api/health` - System health status
- `/api/cache-status` - Cache statistics
- `/api/server-status` - Server performance metrics
- `/api/config` - UI configuration

## Background Jobs

The server runs several background processes:

- **Aircraft Data Logging**: Save position data to S3 every 1 minute
- **Flight Building**: Reconstruct flights from position data every 5 minutes
- **Aggregated Stats**: Save hourly statistics every 5 minutes
- **Cache Refresh**: Update position cache every 5 minutes
- **Hourly Rollups**: Aggregate position data into hourly files

## Python Utility Scripts

Several Python scripts are included for data analysis and diagnostics:

- `tools/count_squawk_transitions_by_hour.py` - Analyze squawk transitions by hour
- `tools/count_squawk_1200.py` - Count VFR (1200) squawk codes
- `tools/count_squawk_7days.py` - 7-day squawk transition analysis
- `tools/count_squawk_7days_detailed.py` - Detailed squawk statistics

All Python scripts use `tools/config_reader.py` to read configuration from `config.js`.

## Logo Management

The dashboard includes a comprehensive logo management system for airlines and aircraft manufacturers. Logos enhance the visual experience across all dashboard views.

### Features

- **Multi-Source Logo Retrieval**: Downloads from Clearbit API, GitHub repositories, and stock photo services
- **Intelligent Domain Guessing**: Generates 10+ domain variations per company name (e.g., fly[name], [name]air, [name]airlines.com)
- **Parallel Processing**: Batch downloads with 5 concurrent connections for efficient bulk operations
- **Quality Filtering**: Automatic rejection of low-quality or placeholder logos
- **Preview and Approval**: Download to local folders for manual review before S3 upload
- **Manufacturer Support**: Separate handling for aircraft manufacturers vs airlines

### Usage

**Download logos for preview:**
```bash
# Download 100 missing logos
node logo-tools/logo-manager.js download 100

# Download all missing logos (parallel processing)
node logo-tools/logo-manager.js download all
```

**Approve and upload logos:**
```bash
# Approve logos from preview folder
node logo-tools/logo-manager.js approve ./airline-logo-previews
```

**Check coverage:**
```bash
# Generate logo coverage report
node logo-tools/logo-manager.js report
```

### Logo Sources

1. **Clearbit API** (Primary): Domain-based logo lookup with intelligent guessing
2. **GitHub Repositories**: Open-source aviation logo collections
3. **Stock APIs**: Commercial stock photo services as fallback

### Storage

Logos are stored in the read bucket in S3 (defaults shown, configurable via `config.js`):
- `aircraft-data/logos/` — Airline and manufacturer logos (e.g., `logos/AAL.png`, `logos/CESSNA.png`)
- `aircraft-data/manufacturer-logos/` — Optional prefix (currently unused in this setup)

API access paths:
- `GET /api/v1logos/:code` — Serves `logos/:code.(png|svg)` from S3
- `GET /api/v2logos/:code` — Alternate handler (same storage); some DB entries reference this path

Examples:
- Airline: `/api/v1logos/AAL` → `logos/AAL.png`
- Manufacturer: `/api/v1logos/CESSNA` → `logos/CESSNA.png`

All logos are publicly accessible and automatically linked in the airline database.

## Logo Maintenance Scripts

The repository includes a comprehensive set of maintenance scripts for managing airline and manufacturer logos:

### Core Logo Management
- **`logo-tools/logo-manager.js`** - Main logo management tool with parallel processing
  - Downloads logos from multiple sources (Clearbit, GitHub, stock APIs)
  - Bulk operations for logo approval and S3 upload
  - Manufacturer logo support

### Analysis Scripts
- **`check_airline_stocks.js`** - Identifies airlines with stock tickers missing logos
- **`find_airlines_without_logos.js`** - Analyzes current logo coverage across all airlines

### Processing Scripts
- **`process-airlines.js`** - Processes raw airline data into structured database format
- **`build_aircraft_types_db.js`** - Builds aircraft type database from source files

### Upload Utilities
- **`upload-airline-db.js`** - Uploads airline database to S3
- **`upload-to-s3.js`** - General S3 upload utility
- **`upload-types.js`** - Uploads aircraft types database to S3

### Server Management
- **`tools/restart_server.bat`** - Windows batch script for server restart operations

### Usage Examples

```bash
# Check for airlines missing logos
node tools/check_airline_stocks.js

# Find all airlines without logos
node tools/find_airlines_without_logos.js

# Process airline data
node tools/process-airlines.js

# Upload databases to S3
node tools/upload-airline-db.js
node tools/upload-types.js
```

All logo maintenance scripts are now included in the git repository for version control and collaboration.

## Data Storage

### S3 Bucket Structure

```
aircraft-data-new/ (write bucket - current data)
├── data/
│   ├── piaware_aircraft_log_*.json    # Minute-by-minute position records
│   └── hourly/
│       └── positions_*.json           # Hourly position aggregates
├── flights/
│   ├── hourly/
│   │   └── flights_*.json            # Hourly flight records
│   └── daily/
│       └── flights_*.json            # Daily flight records
└── aggregated/
    └── hourly_stats_*.json           # Hourly aggregated statistics

aircraft-data/ (read bucket - historical data)
└── data/
    └── piaware_aircraft_log_*.json    # Historical position records
```

### Media Packs

**Media packs** are compressed ZIP archives containing all the visual and reference data needed for the Aircraft Dashboard system. They serve as complete, self-contained data packages for distribution and deployment.

#### What's Included in a Media Pack

- **Logo Collection**: All airline and manufacturer logos (PNG, SVG formats) organized in a `logos/` directory
- **Aircraft Types Database**: `aircraft_types.json` containing manufacturer/model mappings for aircraft identification
- **Metadata File**: JSON file with pack details, file counts, sizes, and generation timestamp

#### Media Pack Structure

```
aircraft-dashboard-logos-YYYY-MM-DDTHH-MM-SS.zip
├── logos/
│   ├── AAL.png          # American Airlines logo
│   ├── DAL.svg          # Delta Airlines logo
│   ├── CESSNA.png       # Cessna manufacturer logo
│   └── ...              # 3000+ logo files
├── aircraft_types.json  # Aircraft type database
└── metadata.json        # Pack information and statistics
```

#### Purpose and Benefits

- **Complete Data Distribution**: Single file contains all logos and reference data
- **Version Control**: Timestamped packs track data versions and updates
- **Efficient Storage**: Compressed format reduces bandwidth and storage costs
- **S3 Integration**: Individual files can be extracted and uploaded to S3 for direct serving
- **Backup & Recovery**: Complete data snapshots for system restoration

#### Media Pack Workflow

1. **Generation**: `tools/create-logo-media-pack.js` downloads logos from S3 and creates ZIP archive
2. **Distribution**: ZIP file committed to git repository for version control
3. **Deployment**: `tools/upload-media-pack.js` extracts and uploads individual files to S3
4. **Serving**: Logos served directly from S3 via CDN or direct URLs

#### Tools

- **`tools/create-logo-media-pack.js`**: Generate new media pack from S3 logo collection
- **`tools/upload-media-pack.js`**: Extract and upload individual files to S3
- **`tools/upload-media-pack.README.md`**: Detailed usage documentation

#### Example Usage

```bash
# Generate new media pack
node tools/create-logo-media-pack.js

# Upload to S3 (dry run first)
DRY_RUN=1 node tools/upload-media-pack.js
node tools/upload-media-pack.js
```

Media packs ensure consistent, complete data distribution across deployments and provide an efficient way to manage the growing collection of airline and manufacturer visual assets.

## runtime/

- `runtime/` is used for temporary files, minute log files and runtime state by the server and tracker.
- Files written here include:
  - `runtime/server.log` — Node server log (default)
  - `runtime/access.log` — HTTP access log (default)
  - `runtime/dashboard-state.json` — server state file
  - `runtime/piaware_aircraft_log_YYYYMMDD_HHMM.json` — per-minute NDJSON files produced/consumed by the tracker
- The directory is created at service start. The repo `.gitignore` excludes generated runtime files so they won't be committed.

If you prefer a different location, set the corresponding environment variables or edit `config.js`:

- `LOG_FILE`, `ACCESS_LOG_FILE`, and `STATE_FILE` environment variables control the file paths.


## Version History

### v1.0.2 (2025-11-28)
- **Cross-Platform**: Fully compatible with Windows, Linux, and macOS
- **Auto-Bucket Creation**: S3 buckets automatically created on startup
- **Production Ready**: Systemd service for Linux, startup scripts for all platforms
- **Complete Documentation**: Setup guides for all platforms and installation methods
- **Docker Support**: Full Docker/docker-compose examples included

### v1.0.1 (2025-11-28)
- Added aircraft type display in Flights and Airlines tabs
- Enhanced airline statistics with "Now" indicator for active flights
- Added time range controls for position graph
- Improved sorting and filtering
- Fixed type field persistence to S3

### v1.0.0 (2025-11-27)
### v1.0.3 (2025-11-28)
- **Type Database & Metadata**: Added aircraft types database with Typecode → Manufacturer/Model/BodyType mapping. Types DB (123 entries) built and uploaded to S3.
- **UI Enhancements**: Live, Flights, Positions and Squawk tabs now show Manufacturer and Body Type; Flights saved to S3 include Manufacturer, Body Type, and Model.
- **API Enhancements**: `/api/cache-status` reports `typeDatabase` summary; `/api/flights`, `/api/squawk-transitions`, and `/api/position-timeseries-live` contain `manufacturer`/`bodyType` data where applicable.

- Initial release
- Live tracking, position caching, S3 storage
- Multiple visualizations and analytics tabs

## License

MIT License

## Author

Christopher Hull

## Documentation

- [CHANGELOG.md](CHANGELOG.md) - Version history and release notes
- [CONFIGURATION.md](CONFIGURATION.md) - Detailed configuration guide
- [MINIO_SETUP.md](MINIO_SETUP.md) - MinIO S3 storage installation for all platforms
- [LINUX_SETUP.md](LINUX_SETUP.md) - Linux/Mac installation and systemd setup
- [AIRCRAFT_TRACKER.md](AIRCRAFT_TRACKER.md) - Python tracker script documentation
- [CROSSPLATFORM_SUMMARY.md](CROSSPLATFORM_SUMMARY.md) - Cross-platform implementation details
- [FUNCTIONS_DOCUMENTATION.md](FUNCTIONS_DOCUMENTATION.md) - API and function reference
- [Project Wiki](./wiki/Home.md) - Detailed multi-page documentation and guides

## Troubleshooting

### Common Issues

1. **"Cannot connect to PiAware"**
   - Verify PiAware is running and accessible
   - Check PIAWARE_URL in config.js matches your setup
   - Test: `curl http://piaware.local:8080/data/aircraft.json`

2. **"S3/MinIO connection failed"**
   - Ensure MinIO is running: `docker ps` or check MinIO service
   - Verify S3_ENDPOINT in config.js
   - Check credentials are correct

3. **"No data in dashboard"**
   - Wait 1-2 minutes for initial data collection
   - Check server logs for errors
   - Verify PiAware is receiving aircraft

4. **"Position cache empty"**
   - Cache fills from S3 on startup (may take several minutes)
   - Check S3 buckets contain data files
   - Review cache status in Cache tab

## Performance Notes

- **Memory Usage**: ~200-500MB depending on aircraft density and cache size
- **CPU Usage**: Minimal (~1-5%) during normal operation, spikes during background jobs
- **Storage**: ~100MB per day of position data, ~50MB per day of flight data
- **Network**: ~1-10 KB/s from PiAware (varies with traffic)

## Contributing

Issues and pull requests are welcome on GitHub.

## Support

For issues or questions, please open an issue on the GitHub repository.
