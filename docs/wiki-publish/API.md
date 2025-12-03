# API Summary

Key endpoints now return `manufacturer`, `bodyType`, and `aircraft_model` when the types database or the OpenSky aircraft DB contains that information.

## /api/flights
Fields added to flight objects (when available):
- `manufacturer` - Manufacturer name (e.g., "Boeing")
- `bodyType` - Category like "Narrow Body" or "Regional Jet"
- `aircraft_model` - Full model string (e.g., "Boeing 737-800")

Example flight snippet:
```json
{
  "icao": "3c6481",
  "callsign": "DLH400",
  "registration": "D-ABYB",
  "start_time": "2025-11-28T23:15:00Z",
  "end_time": "2025-11-28T23:50:00Z",
  "duration_min": 35,
  "aircraft_model": "Boeing 737-800",
  "manufacturer": "Boeing",
  "bodyType": "Narrow Body"
}
```

## /api/squawk-transitions
Squawk records are enriched with the same type fields:
- `manufacturer`
- `bodyType`
- `aircraft_model`

## /api/position-timeseries-live
When present, the `manufacturer` and `bodyType` fields are included in each aircraft's timeseries records.

## /api/cache-status
See the Cache Status page for `typeDatabase` summary (see Cache_Status page).

