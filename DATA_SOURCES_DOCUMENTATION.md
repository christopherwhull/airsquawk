# Aircraft Dashboard - Data Sources & Architecture Documentation

## Overview
The Aircraft Dashboard heatmap provides real-time and historical flight tracking with multiple data sources, a local tile proxy system, and a 1 nautical mile grid layout system.

## Data Sources

### 1. Live Aircraft Positions (`/api/positions`)
- **Source**: Real-time position cache from aircraft tracker
- **Data**: Live aircraft positions with lat/lon coordinates, altitude, speed, heading
- **Update Frequency**: Continuous (via aircraft tracker polling PiAware)
- **Time Window**: Configurable (default 24 hours, supports custom hours)
- **Format**: JSON array of position objects with aircraft metadata

### 2. Historical Heatmap Data (`/api/heatmap-data`)
- **Source**: Position cache aggregated into grid cells
- **Data**: Aircraft position density aggregated into 1nm × 1nm grid cells
- **Grid Size**: 1 nautical mile squares (~0.0167° × ~0.0167°)
- **Purpose**: Visual density heatmap showing flight patterns
- **Format**: JSON with grid cell boundaries and position counts

### 3. Aircraft Enrichment Data (`/api/aircraft/batch`, `/api/aircraft/:icao24`)
- **Source**: S3-stored aircraft database (236K+ aircraft records)
- **Data**: Aircraft type, registration, manufacturer, operator/airline
- **Purpose**: Provides aircraft metadata for icons and tooltips
- **Cache**: Client-side TTL cache (60 seconds) to reduce API calls

### 4. Airline Database (`/api/airlines`)
- **Source**: Static airline code mapping database
- **Data**: Airline name ↔ IATA/ICAO code mappings (e.g., "American Airlines" → "AAL")
- **Purpose**: Logo lookup and airline identification
- **Format**: JSON object with airline codes as keys

### 5. Logo Assets (`/api/v2logos/:code`)
- **Source**: S3-stored manufacturer and airline logos
- **Data**: PNG/SVG logo files keyed by airline codes or manufacturer names
- **Purpose**: Aircraft icon display on heatmap
- **Fallback**: Generic aircraft SVG if logo not found

### 6. Flight Tracking (`/api/flight`, `/api/flights/batch`)
- **Source**: Position history analysis
- **Data**: Individual flight paths, squawk codes, altitude profiles
- **Purpose**: Detailed aircraft tracking and flight history
- **Features**: Bearing/distance calculations, altitude tracking

### 7. Squawk Code Lookup (`/api/squawk`)
- **Source**: Recent position data analysis
- **Data**: Current transponder codes for active aircraft
- **Purpose**: Emergency/safety monitoring (1200=emergency, 7500=hijack, etc.)
- **Format**: JSON with squawk codes per aircraft

## Tile Proxy Server Architecture

### Server Details
- **File**: `tile-proxy-server.js`
- **Port**: 3004 (configurable via PORT env var)
- **Purpose**: Local caching proxy for map tiles to reduce bandwidth and improve performance

### Supported Tile Sources

#### Aviation Charts (FAA)
- **VFR Terminal Area**: `http://localhost:3004/tile/vfr-terminal/{z}/{x}/{y}`
  - Source: ArcGIS FAA VFR Terminal MapServer
  - Coverage: Airport approach/departure areas
  - Max Zoom: 12

- **VFR Sectional**: `http://localhost:3004/tile/vfr-sectional/{z}/{x}/{y}`
  - Source: ArcGIS FAA VFR Sectional MapServer
  - Coverage: En-route navigation charts
  - Max Zoom: 12

- **IFR Area Low**: `http://localhost:3004/tile/ifr-arealow/{z}/{x}/{y}`
  - Source: ArcGIS FAA IFR Area Low MapServer
  - Coverage: Low altitude instrument procedures
  - Max Zoom: 12

- **IFR Enroute High**: `http://localhost:3004/tile/ifr-enroute-high/{z}/{x}/{y}`
  - Source: ArcGIS FAA IFR High MapServer
  - Coverage: High altitude airways
  - Max Zoom: 12

#### General Base Maps
- **OpenStreetMap**: `http://localhost:3004/tile/osm/{z}/{x}/{y}.png`
- **Carto Voyager**: `http://localhost:3004/tile/carto/{z}/{x}/{y}{r}.png`
- **OpenTopoMap**: `http://localhost:3004/tile/opentopo/{z}/{x}/{y}.png`

#### ArcGIS Base Maps
- **World Imagery**: `http://localhost:3004/tile/arcgis-imagery/{z}/{y}/{x}`
- **World Street Map**: `http://localhost:3004/tile/arcgis-street/{z}/{y}/{x}`
- **World Topo Map**: `http://localhost:3004/tile/arcgis-topo/{z}/{y}/{x}`

### Caching System
- **Cache Location**: `./tile_cache/` directory (configurable)
- **Cache Size**: 5GB default (configurable via TILE_CACHE_MAX_BYTES)
- **Pruning**: Automatic cleanup every hour (configurable)
- **Format**: Disk-backed with file path structure: `{layer}/{z}/{x}/{y}.png`

### Configuration
- **Environment Variables**:
  - `PORT`: Server port (default: 3004)
  - `TILE_CACHE_DIR`: Cache directory path
  - `TILE_CACHE_MAX_BYTES`: Max cache size in bytes
  - `TILE_PRUNE_INTERVAL_SECONDS`: Cache cleanup interval
  - `GIS_TILE_BASES`: Upstream tile server URLs
  - `REQUEST_TIMEOUT_MS`: Request timeout (default: 10s)

## Grid Layout System

### Grid Cell Structure
- **Size**: 1 nautical mile × 1 nautical mile squares
- **Coordinate System**: Geographic (latitude/longitude)
- **Resolution**: ~0.0167° × ~0.0167° (1 NM = 1.852 km, 1° ≈ 111 km)
- **Indexing**: Floor division of coordinates by grid size

### Grid Cell Properties
```javascript
{
    lat_min: number,    // Bottom latitude boundary
    lat_max: number,    // Top latitude boundary
    lon_min: number,    // Left longitude boundary
    lon_max: number,    // Right longitude boundary
    count: number       // Aircraft position count in this cell
}
```

### Grid Generation Algorithm
1. **Input**: Array of aircraft positions with lat/lon coordinates
2. **Processing**:
   - Calculate grid indices: `latIdx = Math.floor(lat / gridSize)`
   - Create unique key: `${latIdx},${lonIdx}`
   - Aggregate position counts per grid cell
3. **Output**: Array of grid cell objects with boundaries and counts

### Visualization
- **Color Coding**: Position count determines opacity/intensity
- **Layer**: Dedicated heatmap pane (z-index: 400)
- **Interaction**: Clickable cells show position counts and boundaries
- **Performance**: Client-side rendering with Leaflet rectangles

## Data Flow Architecture

### Real-time Pipeline
1. **Aircraft Tracker** (`tools/aircraft_tracker.py`)
   - Polls PiAware dump1090 JSON every 5 seconds
   - Enriches aircraft data from S3 databases
   - Uploads to S3/MinIO with minute-by-minute rollup

2. **Position Cache** (in-memory)
   - Stores recent positions from tracker
   - Provides time-windowed data to API endpoints
   - Supports live position queries

3. **API Server** (`server.js`)
   - Serves heatmap data from position cache
   - Provides aircraft enrichment and logo serving
   - Handles client requests for live/historical data

4. **Client Heatmap** (`public/heatmap-leaflet.html`)
   - Fetches live positions and grid data
   - Renders aircraft markers with logos
   - Displays density heatmap overlay

### Storage Layers
- **S3/MinIO**: Historical data, aircraft databases, logos
- **Local Cache**: Tile cache, position cache, aircraft metadata
- **In-Memory**: Live position tracking, airline mappings

## Performance Optimizations

### Client-Side Caching
- Aircraft info: 60-second TTL cache
- Flight data: 5-second TTL cache
- Squawk codes: 5-second TTL cache

### Server-Side Caching
- Position cache: Time-windowed in-memory storage
- Tile cache: Disk-backed with LRU pruning
- Aircraft database: S3-backed with local enrichment

### Network Optimizations
- Batch API calls for aircraft enrichment
- Compressed tile responses
- Debounced hover/fetch operations (150ms delay)

## Configuration Files
- `config.js`: Main server configuration (S3 endpoints, ports, etc.)
- `tile-proxy-server.js`: Tile proxy settings
- `aircraft_tracker.py`: Data collection parameters
- Environment variables for all services

## Monitoring & Health Checks
- `/api/health`: System health status
- `/api/cache-status`: Cache statistics and S3 connectivity
- `/api/server-status`: Server performance metrics
- Tile proxy logs: `tile-proxy.log`
- Aircraft tracker logs: `logs/aircraft-tracker.log`