# API Summary

This page documents the most commonly used server API endpoints and their basic request/response shapes. Use these examples when calling endpoints directly, writing tests, or asking the AI to modify behavior.

## Key endpoints

- `GET /api/heatmap-data?hours=<n>`
  - Returns a 1nm grid heatmap for the requested past `<n>` hours.
  - Response: `{ grid: [ { lat_min, lat_max, lon_min, lon_max, count }, ... ] }`.

- `GET /api/positions?hours=<n>`
  - Returns recent aircraft positions. The UI uses this for live markers; prefer small `hours` for live UX.

- `GET /api/position-timeseries-live?minutes=<n>&resolution=<m>`
  - Returns time-bucketed position counts and per-bucket aircraft lists for recent minutes.

- `GET /api/track?hex=<hex>&minutes=<n>`
  - Returns recent track points for an aircraft hex (short-tail drawing).
  - Response: `{ track: [ { lat, lon, alt, timestamp }, ... ] }`.

- `GET /api/flights` and `POST /api/flights/batch`
  - `GET /api/flights` lists flights; fields may include `aircraft_model`, `manufacturer`, and `bodyType` when available.
  - `POST /api/flights/batch` accepts `{ icao24: [...] }` and returns a lightweight batch of flight/enriched data (used to avoid many per-marker calls in the UI).

- `POST /api/aircraft/batch` and `GET /api/aircraft/:icao24`
  - Batch and per-aircraft metadata endpoints for registration, model, and other lookup fields.

- `GET /api/squawk-transitions`
  - Aggregated squawk transition data; returned records are enriched when type data is available.

- `GET /api/airlines`, `GET /api/aircraft-types`, `GET /api/airline-database`
  - Return reference lists used by the UI and enrichment flows.

- `GET /api/v1logos/:airlineCode` and `GET /api/v2logos/:airlineCode`
  - Logo image endpoints used by the UI (calls return image content or 404).

- `GET /api/health`, `GET /api/server-status`, `GET /api/cache-status`
  - Health and runtime status endpoints; useful for automated checks and headless captures.

- `POST /api/restart`
  - Controlled restart endpoint for CI/ops. Requires `RESTART_API_TOKEN` environment variable to be set on the server.

## Enrichment fields (when present)

Many endpoints return enriched aircraft fields when the types database or the OpenSky aircraft DB contains that information. Common fields:

- `manufacturer` — e.g. `"Boeing"`
- `bodyType` — e.g. `"Narrow Body"`, `"Regional Jet"`
- `aircraft_model` — e.g. `"Boeing 737-800"`

These appear on flight records, squawk records, and some position-timeseries responses where enrichment is merged.

## Notes for developers

- Prefer the batch endpoints (`/api/flights/batch`, `/api/aircraft/batch`) for UI enrichment to avoid S3 scans or per-marker requests.
- Use `/api/track` and `positionCache` for short-tail drawing in the client; the endpoint is optimized to read from in-memory cache rather than heavy S3 operations.
- When adding/changing endpoints, update `lib/api-routes.js`, then update this page and `docs/AI_HELPER.md` so the AI assistant and the wiki stay in sync.

Example: curl the track API for a hex `a0a644` over the last 15 minutes:

```bash
curl "http://localhost:3002/api/track?hex=a0a644&minutes=15" | jq
```

See also: `Cache_Status`, `Heatmap`, and `Positions` wiki pages for more operational tips.

