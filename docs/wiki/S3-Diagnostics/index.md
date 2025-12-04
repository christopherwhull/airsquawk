# S3 Diagnostics

Validate bucket structure, freshness, and continuity using built-in tools.

## Buckets
- `aircraft-data` (read): raw minute-by-minute logs
- `aircraft-data-new` (write): processed hourly positions, flights, stats

## Script
`tools/test_s3_structure.py` outputs UTC timestamps and highlights gaps > 1 hour.

### Examples
```powershell
# Structure only (latest files per type)
python tools/test_s3_structure.py --structure-only

# Date sanity (freshness + gaps)
python tools/test_s3_structure.py --dates-only

# Logo coverage (S3 vs database)
python tools/test_s3_structure.py --logos-only

# Export missing logos list to CSV
python tools/test_s3_structure.py --logos-only --logos-csv missing_logos.csv

# Gaps only
python tools/test_s3_structure.py --gaps-only

# Full run
python tools/test_s3_structure.py
```

## Typical Findings
- Large gaps indicate tracker/service outages (e.g., 5.8-day gap Nov 25–Dec 1)
- Short gaps (1–3h) during maintenance windows are common
- Compare newest timestamps across both buckets to ensure processing keeps up
