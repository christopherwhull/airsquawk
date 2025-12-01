# Squawk Tab

The Squawk tab analyzes squawk code transitions to understand aircraft operational modes and emergency situations.

## Features

- **Time-based Filtering**: Preset buttons for 1 hour, 6 hours, 24 hours, or custom date ranges
- **Categorized Transitions**: Squawk codes organized by aviation categories:
  - **VFR (1200)**: Visual Flight Rules
  - **IFR LOW (0000-1777)**: Instrument Flight Rules - Low altitude
  - **IFR HIGH (2000-7777)**: Instrument Flight Rules - High altitude
  - **SPECIAL (7500/7600/7700)**: Emergency codes (hijacking, radio failure, medical emergency)
  - **OTHER**: Non-standard or unidentified codes
- **Transition Lists**: Shows aircraft changing from one squawk code to another within the time period

## Usage

1. Select a time period using preset buttons or custom start/end times
2. Click "Refresh" to load squawk transition data
3. Review transitions by category to identify operational patterns or emergencies
4. Each transition shows the aircraft ICAO, old code, new code, and timestamp

## API Endpoints

- `/api/squawk-transitions`: Returns squawk code transition data for the specified time range

## Squawk Code Categories

- **1200**: VFR (Visual Flight Rules)
- **0000-1777**: IFR Low altitude operations
- **2000-7777**: IFR High altitude operations
- **7500**: Hijacking
- **7600**: Radio failure
- **7700**: Medical emergency
- **Other codes**: Various operational or non-standard codes

## Aviation Significance

Squawk codes provide important information about aircraft status and intentions. Monitoring transitions helps identify:
- Changes in flight rules (VFR to IFR)
- Emergency situations
- Air traffic control communications
- Operational procedures