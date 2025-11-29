# Aircraft Database Integration

This project integrates the OpenSky Network Aircraft Database to provide ICAO24 to tail number (registration) lookups.

## Overview

The aircraft database provides mappings from ICAO24 hex codes (transponder addresses) to:
- **Registration** (tail number, e.g., N12345)
- **Type Code** (e.g., B738)
- **Model** (e.g., Boeing 737-800)
- **Operator** (airline/company name)
- **Owner** (registered owner)

## Setup

### 1. Download the Database

Run the Python script to download and cache the OpenSky aircraft database:

```bash
python download_opensky_db.py --output opensky_aircraft_cache.json
```

This will:
- Download the latest aircraft database from OpenSky Network (~95 MB)
- Parse the CSV data
- Create a JSON cache file (~89 MB) with 516,000+ aircraft records
- The cache file is excluded from git via `.gitignore`

### 2. Update Regularly

The OpenSky database is updated regularly. Re-run the download script periodically to get the latest data:

```bash
# Weekly or monthly update recommended
python download_opensky_db.py
```

## Usage

### Node.js API

The aircraft database is automatically loaded by the server and available through the API:

```javascript
const aircraftDB = require('./lib/aircraft-database');

// Lookup by ICAO24
const aircraft = aircraftDB.lookup('ac96b8');
console.log(aircraft);
// {
//   registration: 'N910AN',
//   typecode: 'B738',
//   model: '737-823',
//   operator: 'American Airlines',
//   owner: 'American Airlines Inc'
// }

// Get just the registration
const registration = aircraftDB.getRegistration('ac96b8');
console.log(registration); // 'N910AN'

// Get type code
const typeCode = aircraftDB.getTypeCode('ac96b8');
console.log(typeCode); // 'B738'

// Get stats
const stats = aircraftDB.getStats();
console.log(stats);
// {
//   loaded: true,
//   aircraftCount: 516660,
//   source: 'OpenSky Network',
//   downloaded: '2025-11-29T03:32:02.711043Z'
// }
```

### REST API Endpoints

#### Get Aircraft by ICAO24

```bash
GET /api/aircraft/:icao24

# Example
curl http://localhost:8080/api/aircraft/ac96b8
```

Response:
```json
{
  "icao24": "ac96b8",
  "registration": "N910AN",
  "typecode": "B738",
  "model": "737-823",
  "operator": "American Airlines",
  "owner": "American Airlines Inc"
}
```

#### Batch Lookup

```bash
POST /api/aircraft/batch
Content-Type: application/json

{
  "icao24": ["ac96b8", "4ca7b5", "a00001"]
}
```

Response:
```json
{
  "requested": 3,
  "found": 3,
  "results": {
    "ac96b8": {
      "registration": "N910AN",
      "typecode": "B738",
      "model": "737-823",
      "operator": "American Airlines",
      "owner": "American Airlines Inc"
    },
    "4ca7b5": {
      "registration": "EI-EFZ",
      "typecode": "B738",
      "model": "BOEING 737-8AS",
      "operator": "Ryanair",
      "owner": "Ryanair"
    },
    "a00001": {
      "registration": "N1",
      "typecode": "C680",
      "model": "680",
      "operator": null,
      "owner": null
    }
  }
}
```

#### Database Status

```bash
GET /api/aircraft-database/status
```

Response:
```json
{
  "loaded": true,
  "aircraftCount": 516660,
  "source": "OpenSky Network",
  "downloaded": "2025-11-29T03:32:02.711043Z"
}
```

## Testing

Test the aircraft lookup functionality:

```bash
node test_aircraft_lookup.js
```

This will test various ICAO24 codes and display the results.

## Integration with Your Application

The aircraft database is automatically integrated with your server. To enrich your flight data with tail numbers:

```javascript
// In your flight tracking code
const aircraftDB = require('./lib/aircraft-database');

function processAircraftData(hex, data) {
    // Get registration for display
    const registration = aircraftDB.getRegistration(hex);
    
    // Add to flight data
    data.registration = registration;
    data.tail_number = registration;
    
    // Optionally get full aircraft details
    const aircraft = aircraftDB.lookup(hex);
    if (aircraft) {
        data.aircraft_type = aircraft.typecode;
        data.aircraft_model = aircraft.model;
        data.operator = aircraft.operator;
    }
    
    return data;
}
```

## Data Source

- **Source**: OpenSky Network Aircraft Database
- **URL**: https://opensky-network.org/datasets/metadata/aircraftDatabase.csv
- **Updates**: Regularly updated by OpenSky Network contributors
- **Coverage**: 516,000+ aircraft worldwide
- **License**: Free for non-commercial use (cite OpenSky Network)

## Citation

If you use this data in publications or presentations:

> Matthias Schäfer, Martin Strohmeier, Vincent Lenders, Ivan Martinovic and Matthias Wilhelm.
> "Bringing Up OpenSky: A Large-scale ADS-B Sensor Network for Research".
> In Proceedings of the 13th IEEE/ACM International Symposium on Information Processing in Sensor Networks (IPSN), pages 83-94, April 2014.

URL: https://opensky-network.org

## Files

- `download_opensky_db.py` - Script to download and cache the database
- `lib/aircraft-database.js` - Node.js module for aircraft lookups
- `opensky_aircraft_cache.json` - Cached database (not in git, ~89 MB)
- `test_aircraft_lookup.js` - Test script
- `AIRCRAFT_DATABASE.md` - This documentation

## Aircraft Types Database (Typecode → Manufacturer / Model / BodyType)

In addition to the OpenSky aircraft database, the project includes a curated aircraft types database (`aircraft_types.json`) which provides the following fields for common ICAO type codes:
- **manufacturer**: e.g., Boeing, Airbus
- **model**: Full model description, e.g., "Boeing 737-800"
- **bodyType**: e.g., Narrow Body, Wide Body, Regional Jet, Turboprop, Helicopter, Business Jet

### Build the Types DB
Run the Node.js helper to build the types database from a curated mapping file and upload to S3 (optional):
```bash
node build_aircraft_types_db.js
node upload-types.js
```

### How to rebuild the types DB (step-by-step)

1. Run the build script from the project root:

```bash
node build_aircraft_types_db.js
```

2. Example output from the script (your path may differ):

```text
✓ Created aircraft types database with 123 types
✓ Saved to: /path/to/repo/aircraft_types.json

Sample entries:
{
  "B731": { "manufacturer": "Boeing", "model": "Boeing 737-100", "bodyType": "Narrow Body", "engines": 2 }
}
```

3. Upload the file to S3/MinIO using one of the following options (edit the endpoint/credentials as needed):

- Node upload helper (edit credentials in `upload-types.js` if required):
```bash
node upload-types.js
```

- AWS CLI:
```bash
aws s3 cp aircraft_types.json s3://aircraft-data/aircraft_types.json --endpoint-url http://localhost:9000
```

- MinIO client:
```bash
mc alias set local http://localhost:9000 minioadmin minioadmin123
mc cp aircraft_types.json local/aircraft-data/aircraft_types.json
```

4. Verify:
- Check your server logs to see `Attempting to download and parse s3://.../aircraft_types.json` and successful parsing.
- Call `/api/cache-status` in the server and confirm `typeDatabase.loaded: true` and `typeDatabase.typeCount` reflects the number in the file.


### Usage
The types database is exposed in the server via `lib/aircraft-types-db.js`. Use it to enrich flight and aircraft records with manufacturer and body type information. Example:
```javascript
const aircraftTypesDB = require('./lib/aircraft-types-db');
const typeInfo = aircraftTypesDB.lookup('B738');
console.log(typeInfo);
// { manufacturer: 'Boeing', model: 'Boeing 737-800', bodyType: 'Narrow Body', engines: 2 }
```

### Integration
The server uses the types DB to enrich responses:
- Live aircraft (`/api/live` updates) include `manufacturer`, `bodyType`, and `aircraft_model` when available.
- Flights saved to S3 include `manufacturer`, `bodyType`, `aircraft_model` fields.
- `cache-status` returns a `typeDatabase` summary consisting of `loaded`, `typeCount`, `created`, and `version`.

## Troubleshooting

### Database Not Found

If you see "Aircraft database cache not found" in the logs:

```bash
python download_opensky_db.py
```

### Database Out of Date

Update the cache periodically:

```bash
python download_opensky_db.py --output opensky_aircraft_cache.json
```

### Memory Usage

The cache file is ~89 MB and loads into memory (~90-100 MB). This provides fast lookups but requires sufficient RAM. For memory-constrained environments, consider:
- Using a SQLite database instead of JSON
- Loading only specific countries/regions
- Using an external API service

## Future Enhancements

- [ ] Automatic periodic updates
- [ ] SQLite backend option for lower memory usage
- [ ] Country/region filtering
- [ ] Integration with flight display UI
- [ ] Cache tail numbers in flight records
