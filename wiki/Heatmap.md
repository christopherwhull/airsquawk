# Heatmap Tab

The Heatmap tab provides access to aircraft position density visualizations.

## Features

- **Leaflet Heatmap Viewer**: Link to interactive Leaflet-based heatmap
- **Time Window Filtering**: Configurable time periods for position data
- **Aircraft Type Filtering**: Filter by manufacturer or aircraft type
- **Interactive Map**: Zoom, pan, and layer controls
- **Aviation Chart Overlays**: Optional sectional charts and airspace information

## Usage

1. Click "Open Leaflet Heatmap Viewer" to launch the interactive map
2. Use time window controls to filter positions by recency
3. Apply manufacturer or type filters to focus on specific aircraft
4. Use map controls to zoom and navigate
5. Toggle aviation chart overlays for additional context

## External Viewer

The heatmap uses a separate Leaflet-based viewer (`/heatmap-leaflet`) for better performance and interactivity compared to the main dashboard.

## API Endpoints

- `/api/heatmap-data`: Returns position data for heatmap rendering
- `/api/heatmap-stats`: Returns cache statistics and available data ranges

## Data Sources

- Cached position data from S3 storage
- Aircraft type database for filtering
- Aviation chart tiles (optional overlays)

## Performance

The heatmap viewer is optimized for large datasets with:
- Client-side clustering for dense areas
- Progressive loading of position data
- Efficient caching of rendered tiles