# Logo Media Pack Generator

This script downloads all airline and manufacturer logos from the S3 storage and creates a ZIP archive for distribution, backup, or offline use.

## Features

- **Complete Logo Collection**: Downloads all logos from S3 with proper pagination support (handles large collections like 3,149+ logos)
- **Multiple Formats**: Supports both PNG and SVG logo formats
- **ZIP Compression**: Creates compressed archives for efficient storage and distribution
- **Metadata Generation**: Includes detailed metadata file with file information and statistics
- **Progress Tracking**: Real-time progress reporting during download and compression
- **Error Handling**: Robust error handling for missing files or network issues
- **Memory Efficient**: Streams large files without excessive memory usage

## Usage

```bash
# Install dependencies (if not already installed)
npm install

# Run the script
node tools/create-logo-media-pack.js
```

## Output

The script creates files in the `media-packs/` directory:

- **`aircraft-dashboard-logos-YYYY-MM-DDTHH-MM-SS.zip`** - ZIP archive containing all logos
- **`logos-metadata-YYYY-MM-DDTHH-MM-SS.json`** - Metadata file with file information

## Metadata File Format

The metadata JSON file contains:

```json
{
  "generated": "2025-11-30T12:34:56.789Z",
  "totalFiles": 2150,
  "totalSize": 157286400,
  "files": [
    {
      "filename": "logos/AAL.png",
      "size": 24576,
      "lastModified": "2025-11-30T10:15:30.000Z"
    }
  ]
}
```

## Requirements

- **Node.js** - Version 14 or higher
- **S3/MinIO access** - Configured in `config.js`
- **Archiver package** - Automatically included in dependencies

## Configuration

The script uses the S3 configuration from `config.js`:

- **Bucket**: Uses `config.buckets.readBucket`
- **Endpoint**: Uses `config.s3.endpoint`
- **Credentials**: Uses `config.s3.credentials`

## Logo Storage Structure

Logos are stored in S3 with the following structure:
- **Airline logos**: `logos/{AIRLINE_CODE}.png` or `logos/{AIRLINE_CODE}.svg`
- **Manufacturer logos**: `logos/{MANUFACTURER_CODE}.png` or `logos/{MANUFACTURER_CODE}.svg`

## Error Handling

The script handles various error conditions:
- Missing S3 connectivity
- Corrupted logo files
- Permission issues
- Disk space limitations

Failed downloads are logged but don't stop the overall process.

## Performance

- **Concurrent downloads**: Downloads are performed sequentially to avoid overwhelming S3
- **Progress reporting**: Shows progress every 50 files downloaded
- **Memory efficient**: Streams large files without loading everything into memory
- **Compression**: Uses maximum ZIP compression for smaller archive size

## Use Cases

- **Backup**: Create offline backups of all logos
- **Distribution**: Package logos for other applications or users
- **Migration**: Transfer logos to different storage systems
- **Analysis**: Examine logo collection statistics and metadata