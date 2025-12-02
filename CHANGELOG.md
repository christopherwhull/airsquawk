# Changelog

All notable changes to the Aircraft Dashboard project will be documented in this file.

## [1.2.0] - 2025-12-01

### Added
- **S3 Database Enrichment**: Complete overhaul of aircraft data enrichment to use comprehensive S3-stored databases instead of local files and external APIs
- **Aircraft Type Database Integration**: Added `aircraft_type_database.json` (236,752 entries) from S3 for primary aircraft type and registration lookup
- **Airline Database Integration**: Added `airline_database.json` (5,774 entries) from S3 for comprehensive airline name lookup
- **Enhanced Enrichment Pipeline**: Reordered enrichment priority to use S3 databases first, then ICAO cache, then PiAware API as fallback
- **Database Caching**: In-memory caching of S3 databases for improved performance and reduced API calls

### Changed
- **Aircraft Tracker Enrichment**: Modified `aircraft_tracker.py` to load and use S3 aircraft type database as primary enrichment source
- **Lookup Functions**: Updated `airline_lookup.py` and `registration_lookup.py` (both root and tools versions) to load from S3 databases
- **Enrichment Priority**: S3 databases now take precedence over individual ICAO cache files and external API calls

### Technical Details
- **Database Sources**: `aircraft_type_database.json` and `airline_database.json` from `aircraft-data` S3 bucket
- **Coverage**: 236K+ aircraft registrations/types, 5.7K+ airline codes with comprehensive global coverage
- **Performance**: Single database load vs. individual file fetches, reduced external dependencies
- **Reliability**: Automatic fallback to local files and PiAware API when S3 unavailable

## [1.1.1] - 2025-12-01

### Fixed
- **Cache Status Tab**: Fixed non-functional Cache Status Tab by adding missing HTML content, JavaScript handlers, and API integration for displaying heatmap cache statistics and cache clearing functionality.
- **Tab Documentation**: Added comprehensive tab inventory comment in index.html documenting all 8 dashboard tabs for future maintenance.

### Changed
- **Dashboard Tabs**: All tabs now fully functional with proper content loading and user interactions.

## [1.1.0] - 2025-11-30

### Added
- **Logo Media Pack Generator**: New script (`tools/create-logo-media-pack.js`) to download all logos from S3 and create ZIP archives for backup/distribution
- **Media Pack S3 Uploader**: New script (`tools/upload-media-pack.js`) to extract and upload individual logo files from media packs to S3 (uses `media-pack-test` bucket by default)
- **Archiver Dependency**: Added `archiver` package for ZIP file creation
- **Media Pack Documentation**: Comprehensive README for the logo media pack generator and uploader
- **S3 Pagination Support**: Fixed logo listing to handle large S3 buckets with proper pagination (now finds all 3,149 logos)

### Fixed
- **Airline Flights Header**: Added time window information to drilldown headers (e.g., "Flights for ABC - Airline Name (Last 24 Hours)")
- **Manufacturer Logo Display**: Separated manufacturer name and logo into distinct table columns in airline flights drilldown
- **Table Column Structure**: Fixed missing manufacturer logo column causing display concatenation issues

### Changed
- **Airline Flights Table**: Improved column organization with separate Manufacturer and Manufacturer Logo columns

## [1.1.0] - 2025-11-30

### Added
- **Comprehensive Logo Management System**: Complete airline logo download, preview, and approval workflow
- **Parallel Logo Processing**: Batch processing with 5 concurrent downloads for efficient bulk operations
- **Multi-Source Logo Retrieval**: Support for GitHub repos, stock APIs, and Clearbit domain guessing
- **Enhanced Domain Guessing**: Intelligent domain generation with 10+ variations per airline name
- **Logo Preview and Approval**: Download to local folders for manual review before S3 upload
- **Bulk Logo Operations**: Process entire backlog of 4352 airlines, successfully finding 2099 logos
- **Manufacturer Logo Support**: Extended logo system to support aircraft manufacturers
- **Logo Quality Validation**: Automatic filtering of low-quality or placeholder logos

### Changed
- **README.md**: Updated with logo management features and usage instructions
- **FUNCTIONS_DOCUMENTATION.md**: Added comprehensive documentation for all logo management functions
- **airline_database.json**: Updated with 1711 new logo URLs for previously missing airlines

### Technical Details
- Parallel processing: Promise.all with batches of 5 concurrent downloads
- Domain guessing algorithm: Generates patterns like fly[name], [name]air, [name]airlines.com
- Logo sources: Clearbit API primary, GitHub repos secondary, stock APIs tertiary
- Quality filtering: Rejects logos smaller than 64x64 pixels or with low entropy
- S3 integration: Automatic upload to airline-logos bucket with proper content-type
- Database updates: Automatic logo URL field updates in airline_database.json

### Performance
- Bulk processing: 4352 airlines processed in parallel batches
- Success rate: 48% logo discovery rate (2099 found, 1711 approved)
- Processing time: Significantly reduced with parallel processing vs sequential

### Documentation
- `logo-tools/logo-manager.js`: Complete logo management script with all functions documented
- Logo workflow: Download → Preview → Approve → Upload → Database Update
- Command examples: `node logo-manager.js download 100`, `node logo-manager.js approve ./previews`

## [1.0.2] - 2025-11-28

### Added
- **Cross-Platform Server Scripts**: Added `restart-server.sh` for Linux/Mac and improved `restart-server.ps1` for Windows
- **Linux Production Setup**: Created `aircraft-dashboard.service` systemd unit file with security hardening
- **Comprehensive Linux Documentation**: Added `LINUX_SETUP.md` with complete installation and deployment guide
- **Docker Support**: Full Docker and docker-compose examples in LINUX_SETUP.md
- **MinIO Documentation**: Added `MINIO_SETUP.md` with complete installation for all platforms
- **Automatic Bucket Creation**: Node server now auto-creates S3 buckets on startup (matching aircraft_tracker.py)
- **npm Run Scripts**: Added `npm run restart:windows` and `npm run restart:unix` for easy server restart

### Changed
- **README.md**: Updated with platform-specific installation guidance and MinIO quick start
- **restart-server.ps1**: Now uses dynamic project directory instead of hardcoded path
- **Cross-Platform Ready**: Both Node server and aircraft_tracker.py are fully cross-platform compatible
- **Bucket Management**: Both server and tracker verify and create required S3 buckets on startup

### Technical Details
- Server bucket creation: `ensureBucketsExist()` checks/creates `aircraft-data` and `aircraft-data-new`
- Uses AWS SDK `HeadBucketCommand` and `CreateBucketCommand`
- Server exits with error if bucket creation fails (fail-fast approach)
- Aircraft tracker creates tracker-specific buckets: `output-kmls`, `flighturls`, `piaware-reception-data`, `icao-hex-cache`
- Platform detection via `platform.system()` in Python, PowerShell and Bash for Node

### Documentation
- `CROSSPLATFORM_SUMMARY.md`: Overview of cross-platform implementation
- `AIRCRAFT_TRACKER.md`: Comprehensive Python tracker documentation
- `LINUX_SETUP.md`: Complete Linux/Mac setup with systemd and Docker
- `MINIO_SETUP.md`: MinIO installation for Windows, Linux, macOS (standalone and Docker)

### Infrastructure
- Windows: Systemd service concept adapted as Windows Scheduled Task
- Linux: Full systemd integration with resource limits and logging
- macOS: Homebrew installation and LaunchAgent auto-start
- Docker: Complete docker-compose configuration for full stack

## [1.0.1] - 2025-11-28

### Added
- **Aircraft Type Display**: Type field now displays in Flights table and Airlines drill-down
- **Type Extraction**: Enhanced extraction logic to read `aircraft_type` field from S3 position records
- **Last Seen Enhancement**: Airlines with active flights now show "Now" (0 seconds) in Last Seen column
- **Active Airline Detection**: Backend checks active flights and updates airline Last Seen timestamps to current time
- **Time Range Controls**: Position graph now respects datetime controls for custom time ranges
- **Position API Time Range**: `/api/position-timeseries-live` endpoint supports `startTime` and `endTime` parameters

### Changed
- **Airline Stats Sorting**: Last Seen column now properly sorts chronologically with data-sort-value attributes
- **Type Data Persistence**: Flight type field now saved to S3 flight files for persistence
- **Error Logging**: NoSuchKey errors suppressed for expected cases (missing hourly stats files)
- **N-Number Filtering**: Callsigns starting with 'N' excluded from airline code extraction (tail numbers)
- **Configuration Centralization**: All UI defaults moved to config.js with `/api/config` endpoint

### Fixed
- **Type Field Missing**: Resolved issue where aircraft type was blank for all flights
- **Reception Page Display**: Fixed display issues with altitude binning (now 5000-foot bins)
- **Airline Table Sorting**: Last Seen column now sorts correctly by timestamp instead of text
- **Position Graph Data Source**: Fixed switching between memory/cache/S3 data sources
- **Cache Population**: Fixed S3 data structure parsing to extract {aircraft: [...]} correctly

### Technical Details
- Type extraction checks: `r.aircraft_type || r.t || r.type || r.Type`
- Airlines with active flights get `lastSeen = Date.now()` for "Now" display
- Position time range: Frontend passes startTime/endTime to backend API
- Flight type saved in `saveFlightsToS3()` function mapping
- NoSuchKey errors only logged for non-expected cases

### Data Quality
- S3 position records: 100% have `aircraft_type` field (verified via diagnostic)
- 8+ unique aircraft types tracked (B738, FA50, E75L, B772, A321, B38M, P28A, etc.)
- ~80% show N/A due to type database lookup misses (normal for unregistered/military aircraft)

## [1.0.0] - 2025-11-27
## [1.0.3] - 2025-11-28

### Added
- **Aircraft Types Database**: Added `aircraft_types.json` (123 curated types) with Manufacturer, Model, BodyType and engines metadata.
- **UI Enrichments**: Added Manufacturer and Body Type fields to Live, Flights, Positions, and Squawk dashboard views; Flights saved to S3 now include `manufacturer`, `bodyType`, and `aircraft_model` fields.
- **API Enhancements**: `/api/cache-status` includes `typeDatabase` metadata; `/api/flights` and `/api/squawk-transitions` now include `manufacturer` and `bodyType`; `/api/position-timeseries-live` includes optional `manufacturers` counts per time bucket.

### Changed
- Updated `README.md`, `API.md`, `FUNCTIONS_DOCUMENTATION.md`, and `AIRCRAFT_DATABASE.md` to document the new types database and fields.


### Initial Release
- Live aircraft tracking dashboard
- Position caching (7-day retention)
- S3 data storage and retrieval
- Multiple data visualizations (heatmap, reception, squawk transitions)
- Airline and flight statistics
- Real-time WebSocket updates
- Background aggregation jobs
