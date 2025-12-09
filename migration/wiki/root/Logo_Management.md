# Logo Management

AirSquawk includes a comprehensive logo management system for airlines and aircraft manufacturers. This page covers the logo media pack generator, logo storage, and how logos are used throughout the system.

## Logo Media Pack Generator

The logo media pack generator (`tools/create-logo-media-pack.js`) creates downloadable ZIP archives containing all airline and manufacturer logos for backup, distribution, or offline use.

### Features

- **Complete Collection**: Downloads all logos from S3 storage (currently 3,149+ logos)
- **S3 Pagination**: Properly handles large S3 buckets with continuation tokens
- **Multiple Formats**: Supports both PNG and SVG logo formats
- **ZIP Compression**: Creates optimized archives for efficient storage
- **Metadata Generation**: Includes detailed JSON metadata with file information
- **Progress Tracking**: Real-time progress reporting during download and compression

### Usage

```bash
# Install dependencies
npm install

# Generate media pack
node tools/create-logo-media-pack.js

# Upload to S3 (optional)
node tools/upload-media-pack.js
```

### Output

The script creates files in the `media-packs/` directory:

- **`aircraft-dashboard-logos-YYYY-MM-DDTHH-MM-SS.zip`** - ZIP archive containing all logos
- **`logos-metadata-YYYY-MM-DDTHH-MM-SS.json`** - Metadata file with file information

## Media Pack S3 Uploader

The media pack uploader (`tools/upload-media-pack.js`) extracts logos from the ZIP archive and uploads each logo file individually to S3 for direct serving.

### Upload Features

- **ZIP Extraction**: Automatically extracts logos from the media pack ZIP file
- **Individual Uploads**: Uploads each logo file separately to S3 with proper content types
- **Progress Tracking**: Shows upload progress for large batches of files (e.g., "Uploaded 100/3149 files...")
- **Error Handling**: Continues uploading even if individual files fail
- **Content Type Detection**: PNG → `image/png`, SVG → `image/svg+xml`
- **Metadata Preservation**: Includes generation timestamp and upload metadata
- **Dry Run Support**: Test extractions and uploads without transferring data

### Upload Usage

```bash
# Extract and upload all logos from the latest media pack
node tools/upload-media-pack.js

# Test upload (dry run)
node tools/upload-media-pack.js --dry-run
```

### S3 Storage Structure

After upload, logos are available individually at:
```
s3://media-pack-test/logos/AAL.png
s3://media-pack-test/logos/DLH.svg
s3://media-pack-test/logos/BOEING.png
```

*Note: Uses `media-pack-test` bucket by default for testing. Set `MEDIA_PACK_BUCKET=aircraft-data` for production use.*

### Metadata Format

```json
{
  "generated": "2025-11-30T23:53:28.000Z",
  "totalFiles": 3149,
  "totalSize": 41920000,
  "files": [
    {
      "filename": "logos/AAL.png",
      "size": 24576,
      "lastModified": "2025-11-30T10:15:30.000Z"
    }
  ]
}
```

## Logo Storage Structure

Logos are stored in S3 with the following organization:

- **Airline logos**: `logos/{AIRLINE_CODE}.png` or `logos/{AIRLINE_CODE}.svg`
- **Manufacturer logos**: `logos/{MANUFACTURER_CODE}.png` or `logos/{MANUFACTURER_CODE}.svg`

### Examples
- `logos/AAL.png` - American Airlines logo
- `logos/DLH.svg` - Lufthansa logo
- `logos/BOEING.png` - Boeing manufacturer logo
- `logos/DASSAULT.png` - Dassault manufacturer logo

## Logo System Architecture

### API Endpoints

- **Airline Logos**: `/api/v1logos/{AIRLINE_CODE}` - Serves airline logos
- **Manufacturer Logos**: `/api/v2logos/{MANUFACTURER_CODE}` - Serves manufacturer logos

### Caching

Logos are cached in memory for performance:
- **Cache Duration**: 1 hour (Cache-Control: public, max-age=3600)
- **Fallback**: PNG primary, SVG fallback
- **Error Handling**: Graceful fallback to placeholder on missing logos

### Database Integration

Logos are referenced in the airline database (`airline_database.json`):

```json
{
  "AAL": {
    "name": "American Airlines",
    "logo": "/api/v1logos/AAL"
  },
  "DASSAULT": {
    "name": "Dassault",
    "logo": "/api/v2logos/DASSAULT"
  }
}
```

## Logo Usage in UI

### Live Aircraft Table
- Airline logos displayed next to airline names
- Manufacturer logos shown in manufacturer column
- Separate columns for manufacturer name and logo

### Airline Flights Drilldown
- Time-window aware headers (e.g., "Flights for AAL - American Airlines (Last 24 Hours)")
- Separate manufacturer and logo columns
- Logo images with proper sizing and fallbacks

### Cache Status
- Logo cache statistics in `/api/cache-status`
- Hit/miss ratios and performance metrics
- S3 storage coverage information

## Logo Acquisition Pipeline

The system supports multiple logo acquisition methods:

1. **Bulk Processing**: Automated download from multiple sources
2. **Manual Upload**: Direct upload to S3 storage
3. **API Integration**: Clearbit, GitHub repos, and stock APIs
4. **Quality Validation**: Automatic filtering of low-quality logos

### Sources
- **Primary**: Clearbit API for domain-based logo lookup
- **Secondary**: GitHub repositories and aviation databases
- **Tertiary**: Stock photo APIs and web scraping
- **Fallback**: Manual curation and upload

## Maintenance and Operations

### Regular Tasks
- **Media Pack Generation**: Monthly or quarterly ZIP creation
- **Logo Quality Review**: Periodic review of logo quality and relevance
- **Cache Management**: Monitor cache hit rates and memory usage
- **Storage Optimization**: Compress and optimize logo files

### Troubleshooting
- **Missing Logos**: Check S3 bucket and API endpoints
- **Cache Issues**: Clear logo cache for specific airlines
- **Performance**: Monitor download times and compression ratios
- **Storage**: Track S3 usage and costs

## Configuration

Logo system configuration is in `config.js`:

```javascript
// S3 bucket for logo storage
buckets: {
  readBucket: 'aircraft-data'
}

// Logo cache settings (in server code)
logoCache: {},
logoRequests: 0,
logoCacheHits: 0,
logoCacheMisses: 0
```

## Related Files

- `tools/create-logo-media-pack.js` - Media pack generator script
- `tools/create-logo-media-pack.README.md` - Detailed script documentation
- `lib/api-routes.js` - Logo serving endpoints (v1logos, v2logos)
- `airline_database.json` - Logo URL references
- `media-packs/` - Generated ZIP archives and metadata