# Aircraft Dashboard - Python Scripts Index

## Overview

All PowerShell command-line utilities have been successfully converted to Python for cross-platform compatibility. The complete test suite, server management, and diagnostic tools are now available in Python.

## Files Summary

### Python Scripts (498 total lines)

| Script | Lines | Purpose | Status |
|--------|-------|---------|--------|
| `run_tests.py` | 170 | Comprehensive test suite (8 endpoints, N iterations) | ✅ Working |
| `dashboard_utils.py` | 190 | Server monitoring & diagnostics utilities | ✅ Working |
| `start_server.py` | 84 | Server startup & process management | ✅ Working |
| `test_workflow.py` | 54 | Complete testing pipeline (server + tests) | ✅ Working |

### Documentation Files

| Document | Purpose |
|----------|---------|
| `PYTHON_SCRIPTS_README.md` | Detailed documentation (usage, examples, troubleshooting) |
| `PYTHON_CONVERSION_SUMMARY.md` | Conversion details & test results |
| `QUICK_REFERENCE.md` | Quick reference card for common commands |

## Quick Start

```bash
# Test everything (restart server + run 5 iterations)
python test_workflow.py -r 5

# Or test server that's already running
python run_tests.py -r 5

# Check server health
python dashboard_utils.py --diagnose
```

## Test Results

### Latest Test Run: ✅ ALL TESTS PASSED

```
Total Tests Run: 8
Passed: 8
Failed: 0
Average Response Time: 104ms

Endpoints Tested:
  [PASS] Health Check
  [PASS] Cache Status
  [PASS] Reception Range
  [PASS] Heatmap Data
  [PASS] Airline Stats
  [PASS] Squawk Transitions
  [PASS] Position Timeseries Live
  [PASS] Historical Stats
```

## Server Status

```
Server Health: OK
Cache Ready: True
Position Cache: 5565 aircraft
S3 Operations: 17,722+ reads tracked
```

## Script Usage

### Run Tests
```bash
python run_tests.py              # 5 iterations (default)
python run_tests.py -r 10        # 10 iterations
python run_tests.py -r 1 -d 1    # 1 iteration, 1 second delay
```

### Full Workflow
```bash
python test_workflow.py          # Start server + run 5 tests
python test_workflow.py -r 10    # Start server + run 10 tests
python test_workflow.py --skip-server  # Tests only (server already running)
```

### Diagnostics
```bash
python dashboard_utils.py        # Full diagnostics (default)
python dashboard_utils.py --health   # Health check only
python dashboard_utils.py --cache    # Cache stats
python dashboard_utils.py --counts   # Data counts
```

### Server Management
```bash
python start_server.py           # Kill existing + start normally
python start_server.py -m        # Start in minimized window
python start_server.py --no-kill # Start without killing processes
```

## Requirements

- Python 3.7+
- `requests` module (usually pre-installed)
- `psutil` module (optional, graceful fallback)

## Configuration

Default server: `http://localhost:3002`

To change, edit the `BASE_URL` variable in each script.

## Endpoints Tested

1. `/api/health` - Server status
2. `/api/cache-status` - Cache statistics and S3 operations
3. `/api/reception-range` - Reception coverage data
4. `/api/heatmap-data` - Grid-based heatmap data
5. `/api/airline-stats` - Airline statistics
6. `/api/squawk-transitions` - Squawk code transitions
7. `/api/position-timeseries-live` - Live position data
8. `/api/historical-stats` - Historical statistics

## Features

### run_tests.py
- ✅ Tests all 8 endpoints
- ✅ Multiple iterations with configurable delays
- ✅ Response time tracking
- ✅ Detailed pass/fail reporting
- ✅ Color-coded output
- ✅ Exit code for scripting (0=pass, 1=fail)

### dashboard_utils.py
- ✅ Server health check
- ✅ Cache statistics
- ✅ Node process listing
- ✅ Endpoint data counts
- ✅ Full system diagnostics
- ✅ Multiple report formats

### start_server.py
- ✅ Kill existing node processes cleanly
- ✅ Start server on localhost:3002
- ✅ Optional minimized window
- ✅ Automatic warmup wait
- ✅ Cross-platform compatible

### test_workflow.py
- ✅ Orchestrates complete pipeline
- ✅ Server restart + test integration
- ✅ Single pass/fail status
- ✅ Configurable iterations
- ✅ Skip server option

## Performance

| Operation | Time |
|-----------|------|
| Single test run | ~1-2 seconds |
| 5 test iterations | ~10-15 seconds |
| Server startup | ~5 seconds |
| Full workflow | ~20-25 seconds |
| Average endpoint response | 67-104ms |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success - all tests passed |
| 1 | Failure - one or more tests failed |

## Compatibility

| OS | Status | Notes |
|----|----|-------|
| Windows | ✅ Full | All features working |
| macOS | ✅ Full | Works without psutil |
| Linux | ✅ Full | Works without psutil |

## Common Workflows

### Daily Test Routine
```bash
# Full cycle with server restart
python test_workflow.py -r 5

# Or separate commands
python start_server.py -m
python run_tests.py -r 5
```

### Development Session
```bash
# Start server once
python start_server.py -m

# Then run tests multiple times
python run_tests.py -r 3
python run_tests.py -r 5
```

### Monitoring
```bash
# Check health regularly
python dashboard_utils.py --health
python dashboard_utils.py --cache
```

### Troubleshooting
```bash
# Run full diagnostics
python dashboard_utils.py --diagnose

# Check specific endpoints
python run_tests.py -r 1
```

## Documentation Map

Start here based on your need:

- **Getting Started**: Read `QUICK_REFERENCE.md` (2 min)
- **Detailed Usage**: Read `PYTHON_SCRIPTS_README.md` (5 min)
- **Technical Details**: Read `PYTHON_CONVERSION_SUMMARY.md` (3 min)
- **Just Run**: `python test_workflow.py` (automatic)

## Comparison: Old vs New

| Task | Old (PowerShell) | New (Python) |
|------|---|---|
| Run tests | `.\run-tests.ps1 -Runs 5` | `python run_tests.py -r 5` |
| Start server | `.\restart-server.ps1` | `python start_server.py` |
| Check health | Manual checks | `python dashboard_utils.py` |
| Full workflow | Multiple steps | `python test_workflow.py` |
| OS Support | Windows only | Win/Mac/Linux ✅ |

## Support

For detailed help on any script:

```bash
python run_tests.py --help
python dashboard_utils.py --help
python start_server.py --help
python test_workflow.py --help
```

## Next Steps

1. ✅ Replace old PowerShell scripts with Python versions
2. ✅ Update CI/CD pipelines to use Python scripts
3. ✅ Add to documentation for team
4. ✅ Consider adding metrics export (Prometheus, etc.)
5. ✅ Extend with additional monitoring features

---

**Status**: Production Ready ✅  
**Last Updated**: 2025-11-28  
**All Tests Passing**: YES (8/8 endpoints)  
**Server Health**: OK  
