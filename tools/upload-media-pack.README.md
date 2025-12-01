# Media Pack S3 Uploader

Extract and upload individual logo files from the media pack ZIP to S3 storage for direct serving.

## Overview

The media pack uploader extracts logos from the ZIP archive created by the media pack generator and uploads each logo file individually to S3. This allows logos to be served directly from S3 without requiring clients to download and extract ZIP files.

## Features

- **ZIP Extraction**: Automatically extracts logos from the media pack ZIP file
- **Individual Uploads**: Uploads each logo file separately to S3 with proper content types
- **Progress Tracking**: Shows upload progress for large batches of files
- **Error Handling**: Continues uploading even if individual files fail
- **Content Type Detection**: Automatically sets correct MIME types (PNG, SVG, etc.)
- **Metadata Preservation**: Includes generation timestamp and upload metadata
- **Dry Run Support**: Test extractions and uploads without actually transferring data

## Usage

### Basic Upload

```bash
# Extract and upload all logos from the latest media pack
node tools/upload-media-pack.js
```

### Dry Run (Test Mode)

```bash
# Preview what would be uploaded without actually uploading
node tools/upload-media-pack.js --dry-run
```

Or using environment variable:

```bash
DRY_RUN=1 node tools/upload-media-pack.js
```

## Configuration

The script uses the same S3 configuration as other tools. Configure via environment variables:

### S3 Connection
- `S3_ENDPOINT` - S3 endpoint URL (default: `http://localhost:9000` for MinIO)
- `S3_REGION` - AWS region (default: `us-east-1`)
- `S3_ACCESS_KEY` - Access key ID (default: `minioadmin`)
- `S3_SECRET_KEY` - Secret access key (default: `minioadmin123`)
- `S3_FORCE_PATH_STYLE` - Use path-style URLs (default: `true` for MinIO)

### Upload Settings
- `MEDIA_PACK_BUCKET` - S3 bucket name (default: `media-pack-test` for testing, set to `aircraft-data` for production)
- `MEDIA_PACK_DIR` - Directory containing media packs (default: `../media-packs`)

## File Processing

The script automatically:

1. **Finds Latest Media Pack**: Locates the most recent ZIP file by timestamp
2. **Extracts Logos**: Unzips only files in the `logos/` directory
3. **Uploads Individually**: Each logo gets its own S3 object with proper metadata
4. **Sets Content Types**: PNG files get `image/png`, SVG files get `image/svg+xml`
5. **Preserves Structure**: Maintains the `logos/filename.ext` path in S3

## S3 Storage Structure

After upload, logos are available at:
```
s3://media-pack-test/logos/AAL.png
s3://media-pack-test/logos/DLH.svg
s3://media-pack-test/logos/BOEING.png
```

## Example Output

```
Aircraft Dashboard Media Pack S3 Uploader
==========================================
Target bucket: media-pack-test

Found media pack: aircraft-dashboard-logos-2025-11-30T23-53-28.zip (41.94 MB)
Generated: 2025-11-30T23-53-28
Target bucket: s3://media-pack-test/logos/

Extracting and uploading logo files...
Uploaded 100/3149 files...
Uploaded 200/3149 files...
...
Uploaded 3149/3149 files...

Extraction complete:
✓ Uploaded: 3149 files

✓ All logo files uploaded successfully!

Upload complete!
```

## Prerequisites

Ensure the target S3 bucket exists. For testing:

```bash
# Using MinIO client (if available)
mc mb local/media-pack-test

# Or using AWS CLI
aws s3 mb s3://media-pack-test --endpoint-url=http://localhost:9000

# Or create manually in MinIO console at http://localhost:9000
```

For production use, ensure the `aircraft-data` bucket exists.

## Integration

### Automated Workflows

Add to cron jobs or CI/CD pipelines:

```bash
# Generate and upload logos weekly
0 2 * * 1 /path/to/aircraft-dashboard/node tools/create-logo-media-pack.js && /path/to/aircraft-dashboard/node tools/upload-media-pack.js
```

### API Integration

After upload, logos can be served directly from S3:

```javascript
// Logo URLs for API responses
const logoUrl = `https://your-s3-endpoint/media-pack-test/logos/${airlineCode}.png`;
```

## Troubleshooting

### No Media Pack Files Found
- Ensure `tools/create-logo-media-pack.js` has been run
- Check `MEDIA_PACK_DIR` path is correct
- Verify files exist in `media-packs/` directory

### ZIP Extraction Errors
- Ensure the ZIP file is not corrupted
- Check file permissions
- Verify sufficient disk space for extraction

### S3 Upload Errors
- Verify S3 credentials and endpoint
- Check bucket exists and is writable
- Ensure network connectivity to S3 endpoint
- Monitor for rate limiting on large uploads

### Performance Considerations
- Large uploads (3000+ files) may take several minutes
- Consider increasing timeout settings for slow connections
- Monitor S3 costs for large numbers of objects

## Dependencies

- `yauzl` - For ZIP file extraction
- `@aws-sdk/client-s3` - For S3 uploads

## Related Tools

- `create-logo-media-pack.js` - Generate media pack ZIP files
- `upload-types.js` - Upload aircraft types database
- `upload-airline-db.js` - Upload airline database