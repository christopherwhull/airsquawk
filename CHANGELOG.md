# Changelog

All notable changes to the Aircraft Dashboard project will be documented in this file.

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

### Initial Release
- Live aircraft tracking dashboard
- Position caching (7-day retention)
- S3 data storage and retrieval
- Multiple data visualizations (heatmap, reception, squawk transitions)
- Airline and flight statistics
- Real-time WebSocket updates
- Background aggregation jobs
