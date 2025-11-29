# Aircraft Dashboard for PiAware

A real-time aircraft tracking and analytics dashboard that connects to a PiAware server to monitor ADS-B aircraft data.

## Requirements

- **PiAware Server** - Running and accessible on your local network (provides ADS-B data)
- **Node.js** - Version 14 or higher
- **MinIO S3 Storage** - For historical data storage and caching (or compatible S3 service)
- **Python 3.x** - Optional, for utility scripts and data analysis

## Features

- **Live Aircraft Tracking** - Real-time display of aircraft positions from PiAware
- **Position History** - 7-day rolling cache with 24-hour in-memory history
- **Flight Statistics** - Track completed and active flights
- **Airline Analytics** - Statistics by airline with drill-down capabilities
- **Reception Analysis** - Visualize reception range by bearing and altitude
- **Squawk Transitions** - Monitor squawk code changes
- **Heatmap Visualization** - Geographic density of aircraft positions
- **S3 Data Persistence** - Automatic archival of historical data

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
```bash
npm start
```

5. Access the dashboard:
```
http://localhost:3002
```

### Platform-Specific Setup

**Windows:**
- Use `restart-server.ps1` script for easy restart
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

Edit `config.js` to customize:

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
- **Configuration**: Bucket creation and integration with dashboard

**Quick Docker Start:**
```bash
docker run -d -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin123 \
  -v minio_data:/data \
  minio/minio:latest server /data --console-address ":9001"
```

Access console at: `http://localhost:9001`

## Usage

### Tabs

- **Live**: Real-time aircraft currently being tracked
- **Airlines**: Statistics by airline with active flight counts
- **Flights**: Completed and active flight history
- **Positions**: Time series analysis of positions, aircraft, flights, and airlines
- **Squawk**: Squawk code transition tracking
- **Heatmap**: Geographic density visualization
- **Reception**: Range analysis by bearing and altitude
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

- `/api/position-timeseries-live` - Position time series data
- `/api/airline-stats` - Airline statistics
- `/api/flights` - Flight data
- `/api/squawk-transitions` - Squawk code changes
- `/api/heatmap-data` - Geographic density grid
- `/api/reception-range` - Reception range analysis
- `/api/cache-status` - Cache statistics
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

- `count_squawk_transitions_by_hour.py` - Analyze squawk transitions by hour
- `count_squawk_1200.py` - Count VFR (1200) squawk codes
- `count_squawk_7days.py` - 7-day squawk transition analysis
- `count_squawk_7days_detailed.py` - Detailed squawk statistics

All Python scripts use `config_reader.py` to read configuration from `config.js`.

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

## Version History

### v1.0.1 (2025-11-28)
- Added aircraft type display in Flights and Airlines tabs
- Enhanced airline statistics with "Now" indicator for active flights
- Added time range controls for position graph
- Improved sorting and filtering
- Fixed type field persistence to S3

### v1.0.0 (2025-11-27)
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
