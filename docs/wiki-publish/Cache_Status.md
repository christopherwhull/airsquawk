# Cache Status

`/api/cache-status` exposes the status of local caches used by the server including the position cache, aircraft database status, and types DB summary.

## Type Database in Cache Status
The response includes a `typeDatabase` object with the following keys:
- `loaded`: boolean - whether the types DB is loaded
- `typeCount`: integer - number of typecodes in the DB
- `created`: ISO timestamp - when the DB was generated
- `version`: string - version of the DB (if provided)

## Example
```json
{
  "positionCache": {
    "totalPositions": 1234,
    "uniqueAircraft": 45,
    "lastRefresh": "2025-11-28T14:00:00Z"
  },
  "aircraftDatabase": {
    "loaded": true,
    "aircraftCount": 82927,
    "source": "opensky",
    "downloaded": "2025-11-28T01:23:45Z"
  },
  "typeDatabase": {
    "loaded": true,
    "typeCount": 123,
    "created": "2025-11-28T12:00:00Z",
    "version": "1.0"
  }
}
```

Use the Cache tab in the UI to display this summary; the `Type Database` block shows whether types are loaded and the DB version/size.
