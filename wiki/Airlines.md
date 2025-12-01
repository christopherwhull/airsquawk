# Airlines Tab

The Airlines tab provides comprehensive statistics and analysis of airline activity over time periods.

## Features

- **Time-based Filtering**: Quick buttons for 1 hour, 6 hours, 24 hours, or custom date ranges
- **Airline Statistics Table**: Shows per-airline metrics including:
  - Airline code and name with logos
  - Number of flights and unique aircraft
  - Last seen timestamp
  - Top manufacturers with logos
- **Flight Drilldown**: Click on any airline to see detailed flight information for that airline

## Usage

1. Select a time period using the preset buttons or set custom start/end times
2. Click "Refresh" to load airline statistics
3. Click on any airline row to drill down into individual flights for that airline
4. Use the sortable table columns to organize data

## API Endpoints

- `/api/airline-stats`: Returns airline statistics for the specified time range
- `/api/airline-flights`: Returns detailed flight data for a specific airline

## Data Sources

- Historical flight data from S3 storage
- Aircraft database for manufacturer and type information
- Logo database for airline and manufacturer branding