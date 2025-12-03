# Types Database

The repository includes a curated aircraft types database (`aircraft_types.json`) mapping ICAO type codes to manufacturer, model, and body type. Use this database to enrich flight and aircraft data shown in the UI and included in API responses.

## What is included
- manufacturer: e.g., Boeing, Airbus
- model: Full model string (e.g. "Boeing 737-800")
- bodyType: e.g., Narrow Body, Wide Body, Regional Jet, Turboprop

## How the server uses the types DB
- Live aircraft (`/api/live`) are enriched with `manufacturer`, `bodyType`, and `aircraft_model` from the types DB.
- Flight records saved to S3 and returned by `/api/flights` include `manufacturer`, `bodyType`, and `aircraft_model` fields.
- Airline stats are computed using the types DB to determine `topManufacturer` and `topType`.

## Build & Upload
You can locally re-build the types DB (curated mapping) using the included build script.

```bash
# Build output: writes aircraft_types.json and optionally uploads to S3 if configured
node build_aircraft_types_db.js
# optional upload script
node upload-types.js
```

### How to rebuild the types DB (step-by-step)

1. Run the build script to recreate `aircraft_types.json` from the curated mapping in code:

```bash
# Run from the project root
node build_aircraft_types_db.js
```

2. Expected sample output from the build script (your path may differ):

```text
✓ Created aircraft types database with 123 types
✓ Saved to: C:\Users\chris\aircraft-dashboard-new\aircraft_types.json

Sample entries:
{
	"B731": {
		"manufacturer": "Boeing",
		"model": "Boeing 737-100",
		"bodyType": "Narrow Body",
		"engines": 2,
		"category": "Commercial Jet"
	},
	"B732": { ... }
}
```

3. Upload the resulting file to your S3/MinIO bucket so the server can load it on startup. You can use the included `upload-types.js` or any S3 client (AWS CLI or MinIO `mc`).

Using the included Node upload helper (edit endpoints/credentials as needed):

```bash
node upload-types.js
```

Using AWS CLI (example for MinIO local endpoint):

```bash
# Set env vars or credentials as appropriate; replace endpoint and bucket
aws s3 cp aircraft_types.json s3://aircraft-data/aircraft_types.json --endpoint-url http://localhost:9000
```

Using MinIO `mc` client:

```bash
# Add alias for your MinIO instance once
mc alias set local http://localhost:9000 minioadmin minioadmin123
mc cp aircraft_types.json local/aircraft-data/aircraft_types.json
```

4. Verify on the server

Once uploaded, the server will attempt to load `aircraft_types.json` from your configured S3 bucket on startup (or periodically if configured). Check:

- Server logs: you should see messages indicating `Attempting to download and parse s3://.../aircraft_types.json` and successful parsing.
- `/api/cache-status` should include `typeDatabase.loaded: true` and `typeCount: <n>`.

If the server still shows the old DB or `loaded: false`, restart the Node server or adjust the `upload-types.js` endpoint/credentials and re-upload.


## Example Usage
```javascript
const aircraftTypesDB = require('../lib/aircraft-types-db');
const info = aircraftTypesDB.lookup('B738');
console.log(info); // { manufacturer: 'Boeing', model: 'Boeing 737-800', bodyType: 'Narrow Body' }
```
