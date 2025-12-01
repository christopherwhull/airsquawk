# Live Tab

The Live tab provides real-time aircraft tracking and statistics from your PiAware receiver.

## Features

- **Live Statistics**: Current tracking counts, server uptime, RSSI ranges, and distance ranges
- **Aircraft Table**: Real-time list of all currently tracked aircraft with detailed information including:
  - ICAO code, flight number, airline, registration
  - Aircraft type, manufacturer, body type with logos
  - Altitude, speed, vertical rate, position coordinates
  - Message count, RSSI, slant range

## Usage

The Live tab automatically updates via WebSocket connections. Data refreshes in real-time as aircraft are detected and tracked.

## API Endpoints

- `/api/live-stats`: Returns current live statistics
- `/api/aircraft`: Returns current aircraft data

## Data Sources

- Direct connection to PiAware dump1090 data
- Real-time WebSocket updates