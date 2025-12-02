# Types Database

The repository includes a curated aircraft types database (`aircraft_types.json`) mapping ICAO type codes to manufacturer, model, and body type. Use this database to enrich flight and aircraft data shown in the UI and included in API responses.

## S3 Database Enrichment (NEW)

**Primary Enrichment System**: The aircraft tracker now uses comprehensive S3-stored databases for aircraft intelligence:

### Aircraft Type Database
- **File**: `aircraft_type_database.json` in `aircraft-data` S3 bucket
- **Coverage**: 236,752 aircraft entries worldwide
- **Data**: ICAO hex code → aircraft type + registration mappings
- **Usage**: Primary source for aircraft type and registration enrichment

### Airline Database  
- **File**: `airline_database.json` in `aircraft-data` S3 bucket
- **Coverage**: 5,774 airline entries worldwide
- **Data**: Airline codes → full names + logo URLs
- **Usage**: Primary source for airline name lookup from callsigns

### Enrichment Priority
1. **S3 Databases** (NEW - primary source)
2. **ICAO Cache** (individual aircraft files)
3. **PiAware API** (external fallback)
4. **Local Files** (emergency fallback)

## Legacy Types Database

The original curated types database provides manufacturer/model information:

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

## What are ICAO Type Codes?

ICAO Aircraft Type Codes are standardized alphanumeric codes maintained by the International Civil Aviation Organization; they uniquely identify aircraft models and families (as defined in ICAO DOC 8643). Examples include `B738` for Boeing 737-800, `A320` for Airbus A320, and `C172` for Cessna 172.

- Format: Usually 3–4 characters (letters/numbers), case-insensitive.
- Where they appear: OpenSky/Flightradar/ADS‑B data sources may include a `typecode` field; the OpenSky aircraft database uses these codes for many records.
- Special codes: Some datasets use `ZZZZ`, `PARA`, or other non-standard tokens where the model is unknown or a parachute/balloon/rotorcraft is reported.

How the Types DB uses them:
- Keys in the `aircraft_types.json` are uppercase ICAO Type Codes (e.g., `B738`).
- The types DB maps the code to an object with `manufacturer`, `model`, `bodyType`, `engines`, and `category`.
- The server normalizes incoming type codes to uppercase for lookup; if no mapping exists, the server may fallback to the `model` text from the OpenSky database or leave the fields blank.

Contributing & extending the DB:
- To add missing codes or improve mappings, edit `build_aircraft_types_db.js` to add your entries, then run `node build_aircraft_types_db.js` to regenerate `aircraft_types.json` and upload using `node upload-types.js` (or manually upload to S3).
- Please follow the existing format in `build_aircraft_types_db.js` and keep keys uppercase.

Limitations & Notes:
- Not all aircraft types are included (the curated DB contains the most common types); aviation isn't perfectly standardized across sources — registration/airline/callsign data can sometimes be more reliable for model inference.
- For general aviation or regional/micro builds, model text fields may differ between sources — prefer type codes where available.
