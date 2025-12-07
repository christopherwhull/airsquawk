# Configuration Management

## Overview

All configuration is centralized in `config.js`. Both Node.js and Python scripts read from this single source of truth.

## Configuration File

**Location:** `config.js`

Contains:
- Server settings (port, log files)
- Data source (PiAware URL)
- S3/MinIO connection details
- Bucket names
- Time windows and retention policies
- Background job intervals
- UI defaults

## Environment Variables

All settings can be overridden via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3002 | Server port |
| `PIAWARE_URL` | http://192.168.0.161:8080/data/aircraft.json | PiAware data source |
| `S3_ENDPOINT` | http://localhost:9000 | MinIO/S3 endpoint |
| `S3_REGION` | us-east-1 | S3 region |
| `S3_ACCESS_KEY` | minioadmin | S3 access key |
| `S3_SECRET_KEY` | minioadmin123 | S3 secret key |
| `READ_BUCKET` | aircraft-data | Historical data bucket |
| `WRITE_BUCKET` | aircraft-data-new | Current data bucket |

## Python Scripts Configuration

Python scripts use `config_reader.py` to read values from `config.js`:

```python
from config_reader import get_config

config = get_config()
S3_ENDPOINT = config['s3_endpoint']
ACCESS_KEY = config['s3_access_key']
SECRET_KEY = config['s3_secret_key']
BUCKET_NAME = config['write_bucket']
```

### Updated Python Scripts

The following scripts now read from `config.js`:
- `count_squawk_transitions_by_hour.py`
- `count_squawk_1200.py`
- `count_squawk_7days.py`
- `count_squawk_7days_detailed.py`

### Testing Configuration Reader

Test that config values are being read correctly:

```bash
python config_reader.py
```

Output shows all configuration values (secrets are masked with asterisks).

## Security Best Practices

1. **Development:** Use default values in `config.js`
2. **Production:** Override via environment variables
3. **Never commit:** Production credentials to version control
4. **Use .env files:** For local environment-specific overrides (add to .gitignore)

## Default Credentials

The default MinIO credentials (`minioadmin` / `minioadmin123`) are:
- Standard for local MinIO installations
- Fine for development environments
- **MUST be changed for production**

## Changing Configuration

1. **For all environments:** Edit `config.js`
2. **For specific environment:** Set environment variables
3. **Restart required:** Changes require server/script restart

## Example: Production Setup

Create `.env` file (not committed):
```bash
S3_ACCESS_KEY=production_key
S3_SECRET_KEY=production_secret
S3_ENDPOINT=https://s3.amazonaws.com
READ_BUCKET=prod-aircraft-data
WRITE_BUCKET=prod-aircraft-data-new
```

Load environment variables before starting:
```bash
# Linux/Mac
export $(cat .env | xargs)
node server.js

# Windows PowerShell
Get-Content .env | ForEach-Object { $_ -split '=' | Set-Item -Path Env:$($_[0]) -Value $_[1] }
node server.js
```

## Configuration Priority

1. Environment variables (highest priority)
2. `config.js` defaults
3. Hardcoded fallbacks (lowest priority)
