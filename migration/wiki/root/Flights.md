# Flights Tab

The Flights tab provides detailed historical flight tracking and reconstruction.

## Features

- **Time-based Filtering**: Preset buttons for 1 hour, 6 hours, 24 hours, or custom date ranges
- **Gap Configuration**: Adjustable gap minutes to define flight segments
- **Comprehensive Flight Data**: Each flight includes:
  - Aircraft ICAO, callsign, airline information with logos
  - Registration, aircraft type, manufacturer, body type with logos
  - Start/end times, duration, start/end positions
  - Maximum altitude, number of reports, slant ranges
- **Flight Summary**: Total flights and statistics for the selected period

## Usage

1. Select a time period using preset buttons or custom start/end times
2. Adjust the gap minutes if needed (default 5 minutes)
3. Click "Refresh" to load flight data
4. Sort the table by any column to analyze patterns

## API Endpoints

- `/api/flights`: Returns reconstructed flight data for the specified time range and gap settings

## Data Sources

- Position data from S3 storage (piaware_aircraft_log files)
- Aircraft database for type and manufacturer information
- Logo database for airline and manufacturer branding

## Flight Reconstruction

Flights are reconstructed by grouping consecutive position reports from the same aircraft with gaps no larger than the specified minutes. This allows tracking of complete flight paths and durations.