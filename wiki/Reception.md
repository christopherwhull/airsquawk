# Reception Tab

The Reception tab analyzes ADS-B signal reception range and quality from your PiAware receiver.

## Features

- **Time-based Filtering**: Preset buttons from 1 hour to 31 days, or custom date ranges
- **Receiver Position Display**: Shows your receiver's coordinates
- **Multi-dimensional Analysis**:
  - **Bearing Analysis**: Reception range by compass direction (all altitudes)
  - **Altitude Analysis**: Reception range by altitude (all bearings)
  - **3D Visualization**: Interactive Plotly chart showing bearing × altitude × range
- **Statistical Summary**: Total positions, unique aircraft, time range coverage

## Usage

1. Select a time period using preset buttons or custom start/end times
2. Click "Refresh" to load reception data
3. Review the bearing and altitude charts for coverage patterns
4. Use the 3D plot to understand reception characteristics in three dimensions
5. Adjust time ranges to see how reception changes over different periods

## API Endpoints

- `/api/reception-range`: Returns reception analysis data for the specified time range

## Charts and Visualizations

- **Bearing Chart**: Polar plot showing maximum reception distance in each compass direction
- **Altitude Chart**: Shows reception coverage at different altitudes
- **3D Plot**: Interactive three-dimensional visualization using Plotly.js

## Reception Analysis

Understanding reception patterns helps optimize antenna placement and identify:
- Coverage gaps in certain directions
- Altitude-dependent signal strength
- Long-term reception trends
- Equipment performance over time

## Data Sources

- Historical position data from S3 storage
- Receiver location configuration
- Signal strength and position metadata