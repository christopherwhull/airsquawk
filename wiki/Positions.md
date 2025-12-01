# Positions Tab

The Positions tab provides statistical analysis and time-series visualization of aircraft position data.

## Features

- **Multiple Data Sources**: Switch between Live Memory, Cache, and S3 Buckets
- **Time-based Filtering**: Preset buttons for 1 hour, 6 hours, 24 hours, 7 days, or custom ranges
- **Statistics Cards**: Visual cards showing positions, aircraft, flights, and airlines counts
- **Time Series Graph**: Interactive chart showing trends over time with toggleable metrics:
  - Positions count
  - Unique aircraft count
  - Flights count
  - Airlines count

## Usage

1. Select a data source by clicking the corresponding card (Live Memory, Cache, or S3)
2. Choose a time period using preset buttons or custom start/end times
3. Click "Refresh" to load statistics
4. Use checkboxes above the graph to show/hide different metrics
5. The graph updates automatically when switching data sources or time periods

## Data Sources

- **Live Memory**: Current in-memory position data
- **Cache**: Cached position data for faster access
- **S3 Buckets**: Historical position data stored in MinIO/S3

## API Endpoints

- `/api/position-stats`: Returns position statistics for the specified time range and data source

## Graph Features

The time series graph uses Canvas rendering for smooth performance with large datasets. Hover over data points to see exact values and timestamps.