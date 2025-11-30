# Aircraft Dashboard Functions Documentation

## Frontend Functions (public/app.js)

### Reception Range Functions

#### `loadReceptionRange(hoursBack = null)`
**Purpose:** Loads and displays reception range data showing maximum detection range by bearing and altitude bands.

**Parameters:**
- `hoursBack` (number|null): Number of hours to look back, or null to use custom datetime range

**Functionality:**
- Fetches reception data from `/api/reception-range` endpoint
- Aggregates data by bearing (azimuth) and altitude bands
- Displays 3 visualizations:
  - Polar chart of range by bearing
  - Bar chart of range by altitude
  - 3D scatter plot combining bearing × altitude × range
- Updates summary statistics and detailed sector table

---

#### `drawBearingChart(bearingData, maxRange)`
**Purpose:** Draws a polar/circular chart showing reception range by compass bearing.

**Parameters:**
- `bearingData` (object): Map of bearing → {maxRange, count}
- `maxRange` (number): Maximum range value for scaling

**Features:**
- 24 bearing sectors (15° each)
- Concentric rings at 25 NM intervals
- Color-coded by range (blue to red gradient)
- Cardinal direction labels (N, E, S, W)

---

#### `drawAltitudeChart(altitudeData, maxRange)`
**Purpose:** Draws a bar chart showing reception range by altitude band.

**Parameters:**
- `altitudeData` (object): Map of altitude → {maxRange, count}
- `maxRange` (number): Maximum range value for scaling

**Features:**
- Horizontal bars for each 1000 ft altitude band
- Color gradient from blue (low) to red (high altitude)
- Labels show altitude range in feet

---

#### `draw3DReceptionPlot(sectors)`
**Purpose:** Creates a 3D scatter plot using Plotly showing bearing, altitude, and range.

**Parameters:**
- `sectors` (array): Array of sector objects with {bearing, altBand, maxRange}

**Features:**
- X-axis: Bearing (0-360°)
- Y-axis: Altitude (feet)
- Z-axis: Range (nautical miles)
- Color-coded markers by range

---

### Server Control Functions

#### `restartServer()`
**Purpose:** Initiates a server restart via the `/api/restart` endpoint.

**Functionality:**
- Prompts user for confirmation
- Sends POST request to restart endpoint
- Automatically reloads page after 3 seconds

---

### Utility Functions

#### `formatTimeAgo(timestamp)`
**Purpose:** Formats a timestamp as human-readable "time ago" string.

**Parameters:**
- `timestamp` (number): Unix timestamp in milliseconds

**Returns:** String like "2 minutes ago", "3 hours ago", "5 days ago"

---

#### `showTab(tabName)`
**Purpose:** Switches between dashboard tabs and manages tab button states.

**Parameters:**
- `tabName` (string): Name of tab to show ('live', 'airlines', 'flights', etc.)

**Functionality:**
- Hides all tab content divs
- Shows selected tab content
- Updates tab button active states

---

### Airline Statistics Functions

#### `loadAirlineStats(hoursBack = null)`
**Purpose:** Loads airline flight statistics for the specified time window.

**Parameters:**
- `hoursBack` (number|null): Hours to look back, or null for custom range

**Data Sources:**
- Minute-by-minute files
- Hourly rollup files
- Current memory

**Display:**
- Summary counts per source
- Sortable table with airline code, name, flight count, unique aircraft, last seen
 - Each airline entry now includes `topType` and `topManufacturer` fields to indicate the most common aircraft type and manufacturer observed for that airline in the selected time window.

---

#### `loadAirlineFlights(airlineCode, airlineName, windowVal)`
**Purpose:** Drill-down view showing all flights for a specific airline.

**Parameters:**
- `airlineCode` (string): 3-letter airline code
- `airlineName` (string): Full airline name
- `windowVal` (string): Time window (e.g., '24h')

**Features:**
- Filters flights by airline code from callsign
- Shows flight details: callsign, hex, registration, type, times, duration, status
- Distinguishes active vs "no longer seen" flights
- Sortable table with datetime-aware sorting

---

#### `closeAirlineFlightsDrilldown()`
**Purpose:** Closes the airline flights drill-down panel.

---

### Position Statistics Functions

#### `loadUnifiedPositionStats(hoursBack = null)`
**Purpose:** Unified view of position statistics across all data sources.

**Parameters:**
- `hoursBack` (number|null): Hours to look back, or null for custom range

**Data Sources:**
1. **Live Memory**: Real-time data from active tracking
2. **Cache**: Position cache data
3. **S3 Buckets**: Historical data from storage

**Metrics Displayed:**
- Total positions
- Unique aircraft count
- Unique flights count
- Unique airlines count

**Visualization:**
- Three stat cards (memory, cache, buckets)
- Time series graph with 4 metrics

---

#### `drawPositionsTimeSeriesGraph(memoryData)`
**Purpose:** Draws multi-line time series graph for position metrics.

**Parameters:**
- `memoryData` (array): Array of time buckets with position statistics

**Metrics:**
- Positions (blue)
- Aircraft (green)
- Flights (orange)
- Airlines (red)

**Features:**
- Auto-scaling Y-axis
- Time-based X-axis with formatted labels
- Toggle checkboxes for each metric
- Grid lines and legend

---

### Squawk Code Functions

#### `loadSquawkTransitions(hoursBack = null)`
**Purpose:** Loads and displays squawk code transitions for aircraft.

**Parameters:**
- `hoursBack` (number|null): Hours to look back, or null for custom range

**Filtering:**
- Excludes transitions when flight changes (different aircraft)
- Excludes transitions with 15+ minute gaps
- Filters by timestamp range

**Categories:**
- VFR (1200)
- IFR LOW (0000-1777)
- IFR HIGH (2000-7777)
- SPECIAL (7500/7600/7700 - emergency codes)
- OTHER

**Display:**
- Shows flight, type, airline, from/to squawk, altitude, time gap
 - Shows flight, type, manufacturer, airline, from/to squawk, altitude, time gap
- Color-coded by category
- Dark mode styled cells

---

### Flights Functions

#### `loadFlights(hoursBack = null)`
**Purpose:** Loads flight data showing active and "no longer seen" flights.

**Parameters:**
- `hoursBack` (number|null): Hours to look back, or null for custom range

**Determination of Status:**
- Active: Last position within gap threshold (default 5 minutes)
- No Longer Seen: Last position exceeded gap threshold

**Display Fields:**
- Callsign, hex, registration, type
 - Callsign, hex, registration, type, manufacturer, bodyType
- Start/end coordinates and times
- Max altitude, report count
- Slant range at start/end

---

### Heatmap Functions

#### `loadHeatmap(hoursBack = null)`
**Purpose:** Generates and displays position density heatmap.

**Parameters:**
- `hoursBack` (number|null): Hours to look back, or null for custom range

**Grid Specifications:**
- Cell size: 1 NM × 1 NM (approximately 0.0167° × 0.0167°)
- Uses latitude/longitude bounding boxes
- Each cell stores position count

**Information Panel:**
- Grid cell dimensions (degrees, km, NM)
- Total grid cells
- Coverage area (lat/lon span)
- Coordinate bounds

**Color Scale:**
- Blue (low density) to red (high density)
- HSL hue: 240° → 0°
- Labels show min (0) and max position count

---

### Cache Status Functions

#### `loadCacheStatus()`
**Purpose:** Displays current cache status and S3 operation statistics.

**Metrics:**
- Position cache size and memory usage
- Unique aircraft in cache
- API cache sizes (historical stats, squawk transitions, airline stats)
- S3 read/write/error counts
- Last processing timestamps for each data type

---

### Table Sorting Functions

#### `sortTable(table, column, isNumeric, asc)`
**Purpose:** Generic table sorting function for all sortable tables.

**Parameters:**
- `table` (HTMLElement): Table element to sort
- `column` (number): Column index (0-based)
- `isNumeric` (boolean): Whether to sort numerically
- `asc` (boolean): True for ascending, false for descending

**Features:**
- Handles both text and numeric sorting
- Supports data-sort-value attributes for custom sort values (e.g., timestamps)
- Updates column header indicators (sort-asc/sort-desc classes)
- Event delegation for all tables with `sortable` class

---

## Backend Functions (lib/api-routes.js)

### API Endpoints

#### `GET /api/reception-range?hours=<n>`
Returns reception range data aggregated by bearing and altitude bands.

**Response:**
```json
{
  "sectors": {
    "bearing_altitude": {
      "bearing": number,
      "altBand": number,
      "maxRange": number,
      "count": number
    }
  },
  "maxRange": number,
  "positionCount": number,
  "receiverLat": number,
  "receiverLon": number
}
```

---

#### `GET /api/airline-stats?window=<n>h`
Returns airline statistics from multiple data sources.

**Response:**
```json
{
  "minute": {
    "byAirline": {
      "ABC": { "count": number, "code": string, "aircraft": number, "lastSeen": number }
    }
  },
  "hourly": { ... },
  "memory": { ... }
}
```

---

#### `GET /api/flights?window=<n>h&gap=<n>`
Returns flight data categorized as active or no longer seen.

**Parameters:**
- `window`: Time window (e.g., '24h')
- `gap`: Gap threshold in minutes (default 5)

**Response:**
```json
{
  "active": [ /* flights still being tracked */ ],
  "flights": [ /* flights no longer seen */ ]
}
```

---

#### `GET /api/heatmap-data?hours=<n>`
Returns position density grid data.

**Grid Structure:**
```json
{
  "grid": [
    {
      "lat_min": number,
      "lat_max": number,
      "lon_min": number,
      "lon_max": number,
      "count": number
    }
  ]
}
```

---

#### `GET /api/squawk-transitions?hours=<n>`
Returns squawk code transitions with filtering applied.

**Filters:**
- Flight change detection
- 15-minute time gap exclusion
- Timestamp range

**Response:**
```json
{
  "transitions": [
    {
      "hex": string,
      "registration": string,
      "flight": string,
      "type": string,
      "airlineCode": string,
      "airlineName": string,
      "from": string,
      "to": string,
      "timestamp": number,
      "altitude": number,
      "minutesSinceLast": number
    }
  ]
}
```

---

#### `POST /api/restart`
Initiates server restart by executing restart-server.ps1 script.

**Functionality:**
- Spawns PowerShell process in detached mode
- Executes restart-server.ps1 which:
  1. Stops existing Node.js processes
  2. Waits 2 seconds
  3. Starts new server in separate terminal window

---

## Data Flow

### Position Data Pipeline
1. **Live Memory** ← Real-time updates from PiAware/dump1090
2. **Position Cache** ← Periodic snapshots from memory
3. **S3 Minute Files** ← Written every minute
4. **S3 Hourly Rollup** ← Aggregated from minute files

### Flight Tracking
1. Aircraft detected → Added to `activeFlights` in memory
2. Position updates → Flight record updated
3. No updates for gap threshold → Moved to "no longer seen"
4. Flight files written to S3 (hourly and daily)

### Squawk Transition Detection
1. Monitor squawk code changes per aircraft
2. Compare with previous observation
3. Exclude if:
   - Flight identifier changed (different aircraft)
   - Time gap ≥ 15 minutes
   - Outside time range
4. Record transition with metadata

---

## Configuration

### Time Range Controls
All major tabs use consistent time selection:
- Quick buttons: 1h, 6h, 24h, 7d, 31d
- Custom datetime-local inputs (start/end)
- Auto-refresh: End time updates if within 2 minutes of "now"

### Grid Specifications
- **Heatmap**: 1 NM × 1 NM cells
- **Reception Bearing**: 24 sectors (15° each)
- **Reception Altitude**: 1000 ft bands
- **Slant Range**: 25 NM ring intervals

### Styling
- **Dark Mode**: #1e1e1e backgrounds, #e0e0e0 text, #42a5f5 accents
- **Status Colors**:
  - Active/Success: #4caf50 (green)
  - Warning: #ff9800 (orange)
  - Error/Critical: #f44336 (red)
  - Info: #2196f3 (blue)

---

## Testing

### Unit Tests (test-api-endpoints.js)
13 comprehensive endpoint tests covering:
1. Health check
2. Cache status
3. Reception range
4. Heatmap data and grid structure
5. Airline statistics
6. Squawk transitions (structure and filtering)
7. Position timeseries
8. Historical stats
9. Flights with gap parameter
10. Reception with multiple time windows
11. Cache processing timestamps
12. All endpoints with various parameters

**Run tests:** `node test-api-endpoints.js`

Expected: All 13 tests pass

---

## Performance Considerations

### Caching Strategy
- API responses cached by time window
- Cache invalidated on new data arrival
- S3 operations minimized via memory cache

### Data Aggregation
- Minute files: Real-time, high-resolution
- Hourly files: Reduced size, faster queries
- Daily files: Long-term storage, minimal queries

### Frontend Optimization
- Event delegation for table sorting
- Canvas rendering for charts (no DOM overhead)
- Lazy loading of historical data
- Auto-refresh only for recent data

---

## Logo Management Functions (logo-tools/logo-manager.js)

### `isManufacturer(name)`
**Purpose:** Determines if a company name represents an aircraft manufacturer rather than an airline.

**Parameters:**
- `name` (string): Company name to check

**Returns:** boolean - true if manufacturer, false if airline

**Logic:**
- Checks against known manufacturer names (Boeing, Airbus, Embraer, etc.)
- Used to route logos to appropriate S3 buckets (manufacturer-logos vs airline-logos)

---

### `loadDatabase()`
**Purpose:** Loads the airline database from airline_database.json file.

**Returns:** Promise<object> - Parsed JSON database object

**Features:**
- Asynchronous file reading with error handling
- Validates JSON structure
- Used by all database operations

---

### `saveDatabase(db)`
**Purpose:** Saves the updated database back to airline_database.json.

**Parameters:**
- `db` (object): Database object to save

**Features:**
- Pretty-printed JSON output
- Atomic write operation
- Backup creation before overwrite

---

### `isShippingCompany(name)` / `isNotPassengerAirline(name)`
**Purpose:** Classifies airlines by type for logo processing prioritization.

**Parameters:**
- `name` (string): Airline name to classify

**Returns:** boolean

**Categories:**
- Shipping companies (FedEx, UPS, DHL)
- Cargo airlines
- Military/charter operators
- Regional airlines

---

### `checkLogoExistsInS3(code)`
**Purpose:** Checks if a logo already exists in the S3 bucket.

**Parameters:**
- `code` (string): Airline/manufacturer code

**Returns:** Promise<boolean>

**Implementation:**
- Uses AWS SDK HeadObjectCommand
- Checks both airline-logos and manufacturer-logos buckets
- Prevents duplicate downloads

---

### `downloadLogoFromGitHub(code, source)`
**Purpose:** Downloads logos from GitHub repositories.

**Parameters:**
- `code` (string): Airline code
- `source` (object): GitHub repository source info

**Returns:** Promise<Buffer|null>

**Sources:**
- Open-source aviation logo repositories
- Community-maintained collections

---

### `downloadLogoFromStock(companyName)`
**Purpose:** Downloads logos from stock photo APIs.

**Parameters:**
- `companyName` (string): Company name for search

**Returns:** Promise<Buffer|null>

**APIs:**
- Multiple stock photo services
- Fallback for Clearbit failures

---

### `downloadLogoFromClearbit(companyName)`
**Purpose:** Downloads logos using Clearbit API with domain guessing.

**Parameters:**
- `companyName` (string): Company name

**Returns:** Promise<Buffer|null>

**Process:**
- Generates multiple domain variations
- Tests each domain with Clearbit API
- Returns highest quality logo found

---

### `guessDomainsFromName(companyName)`
**Purpose:** Generates multiple domain variations for logo lookup.

**Parameters:**
- `companyName` (string): Company name

**Returns:** Array<string> - List of potential domains

**Patterns:**
- Direct: companyname.com
- Aviation: flycompanyname.com, companynameair.com
- Variations: companynameairlines.com, companyname-group.com
- 10+ patterns total for comprehensive coverage

---

### `uploadLogoToS3(code, logoBuffer)`
**Purpose:** Uploads logo to appropriate S3 bucket.

**Parameters:**
- `code` (string): Airline/manufacturer code
- `logoBuffer` (Buffer): Logo image data

**Features:**
- Automatic bucket selection (airline-logos/manufacturer-logos)
- Content-type detection
- Public read access
- Error handling and retries

---

### `updateDatabaseWithLogo(db, code)`
**Purpose:** Updates database entry with logo URL.

**Parameters:**
- `db` (object): Database object
- `code` (string): Airline code

**Updates:**
- logoUrl field with S3 URL
- Timestamp tracking
- Maintains data integrity

---

### `downloadLogosToFolder(db, folderPath, limit, type)`
**Purpose:** Downloads logos for preview and approval workflow.

**Parameters:**
- `db` (object): Airline database
- `folderPath` (string): Output folder path
- `limit` (number|null): Maximum downloads (null for all)
- `type` (string): Filter by airline type ('all', 'passenger', 'cargo')

**Features:**
- Parallel processing (5 concurrent downloads)
- Progress reporting
- Quality filtering
- Local file storage for review

---

### `approveLogosFromFolder(db, folderPath)`
**Purpose:** Approves and uploads logos from preview folder.

**Parameters:**
- `db` (object): Database object
- `folderPath` (string): Folder containing approved logos

**Process:**
- Uploads all PNG files to S3
- Updates database with logo URLs
- Generates processing report
- Cleanup of local files

---

### `generateReport(db)`
**Purpose:** Generates comprehensive logo coverage report.

**Parameters:**
- `db` (object): Database object

**Output:**
- Total airlines count
- Logos present/missing percentages
- Breakdown by airline type
- Processing statistics

---

## Error Handling

### Frontend
- Try-catch blocks in all async functions
- Console logging for debugging
- User-friendly error messages
- Graceful degradation when data unavailable

### Backend
- Validation of query parameters
- S3 error handling and logging
- Fallback to alternative data sources
- HTTP status codes (200, 400, 500)

---

## Future Enhancements

### Potential Features
- Real-time websocket updates for all tabs
- Exportable reports (CSV, PDF)
- User preferences (theme, default time ranges)
- Alert system for specific aircraft/airlines
- Historical comparison views
- Mobile-responsive design improvements

### Performance Optimizations
- Database integration for faster queries
- Indexed search capabilities
- Progressive data loading
- WebWorker for heavy computations
