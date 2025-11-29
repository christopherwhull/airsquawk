# Python Scripts - Quick Reference

## All Scripts Working ✅

### Test the Dashboard
```bash
# Quick test (1 iteration)
python run_tests.py -r 1

# Full test (5 iterations, default)
python run_tests.py

# Comprehensive workflow (restart server + test)
python test_workflow.py -r 3
```

### Check Server Health
```bash
# Full diagnostics
python dashboard_utils.py

# Health only
python dashboard_utils.py --health

# Cache stats
python dashboard_utils.py --cache

# All endpoint counts
python dashboard_utils.py --counts
```

### Manage Server
```bash
# Start server (kill existing first)
python start_server.py

# Start in minimized window
python start_server.py -m

# Start without killing existing
python start_server.py --no-kill
```

## Script Descriptions

| Script | Purpose | Time | Output |
|--------|---------|------|--------|
| `run_tests.py` | Test 8 endpoints N times | ~5-20s | PASS/FAIL per endpoint |
| `dashboard_utils.py` | Monitor server health | ~2-5s | Stats & diagnostics |
| `start_server.py` | Start/restart server | ~5-10s | Ready/Error message |
| `test_workflow.py` | Full pipeline test | ~20-30s | Workflow success/fail |

## Common Commands

```bash
# Daily testing routine
python test_workflow.py -r 5

# Check if server is healthy
python dashboard_utils.py --health

# Monitor cache without restarting
python run_tests.py --skip-server -r 3

# Get current stats
python dashboard_utils.py --cache --counts

# Full diagnostics
python dashboard_utils.py --diagnose
```

## Exit Codes

- `0` = Success (all tests passed)
- `1` = Failure (one or more tests failed)

## Performance

- Average response time: 67-104ms per endpoint
- 8 endpoints per iteration
- ~5 seconds per test iteration
- ~5 seconds server startup

## Endpoints Tested

1. `/api/health` - Server status
2. `/api/cache-status` - Cache & S3 operations
3. `/api/reception-range` - Reception coverage
4. `/api/heatmap-data` - Heatmap grid data
5. `/api/airline-stats` - Airline statistics
6. `/api/squawk-transitions` - Squawk transitions
7. `/api/position-timeseries-live` - Live positions
8. `/api/historical-stats` - Historical data

Note: Several endpoints now include enriched type information (manufacturer, bodyType, aircraft_model): `/api/flights`, `/api/squawk-transitions`, `/api/position-timeseries-live` (timeseries buckets may include `manufacturers` counts) and `/api/cache-status` includes a `typeDatabase` summary.

## Current Status

✅ All 8 endpoints: **PASS**  
✅ Server health: **OK**  
✅ Cache ready: **True**  
✅ S3 reads: **17,722+**  
✅ Aircraft cached: **5,565**  

## File Locations

```
c:\Users\chris\aircraft-dashboard-new\
├── run_tests.py               # Main test suite
├── dashboard_utils.py          # Utilities & diagnostics
├── start_server.py             # Server manager
├── test_workflow.py            # Full workflow
├── PYTHON_SCRIPTS_README.md    # Detailed documentation
└── PYTHON_CONVERSION_SUMMARY.md # Conversion details
```

## Need Help?

1. Run diagnostics: `python dashboard_utils.py`
2. Check logs: See server console output
3. Review docs: `PYTHON_SCRIPTS_README.md`
4. Run single test: `python run_tests.py -r 1`

---
Last updated: 2025-11-28
All scripts tested and verified ✅
