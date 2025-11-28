# Aircraft Dashboard - Python Scripts

This directory contains Python utilities for managing and testing the Aircraft Dashboard server. All PowerShell scripts have been converted to Python for cross-platform compatibility.

## Scripts Overview

### 1. `run_tests.py` - Comprehensive Test Suite
Tests all 8 API endpoints with multiple iterations and detailed reporting.

**Usage:**
```bash
python run_tests.py -r 5           # Run 5 test iterations (default)
python run_tests.py --runs 2        # Run 2 iterations
python run_tests.py --help          # Show all options
```

**Features:**
- Tests 8 endpoints: Health, Cache, Reception, Heatmap, Airline, Squawk, Position Live, Historical
- Validates response structure and counts
- Reports response times per endpoint
- Color-coded pass/fail status
- Aggregated results with endpoint breakdown
- Exit code 0 for all pass, 1 for any failure

**Output Example:**
```
TEST RUN 1
  [PASS] Health Check: ok, cache ready: True (24.0ms)
  [PASS] Cache Status: 5563 aircraft cached, 10622 S3 reads (293.2ms)
  ...
  Run Summary: 8 passed, 0 failed

OVERALL: 16/16 tests passed, avg 77ms
```

### 2. `start_server.py` - Server Startup Manager
Manages the Node.js server process with intelligent process handling.

**Usage:**
```bash
python start_server.py               # Kill existing, start server normally
python start_server.py -m            # Start in minimized window
python start_server.py --no-kill     # Start without killing existing processes
```

**Features:**
- Kills existing node processes cleanly
- Starts server on localhost:3002
- Optional minimized window mode (Windows)
- Includes warmup wait time
- Exit code indicates success/failure

### 3. `test_workflow.py` - Full Testing Workflow
Complete pipeline: start server → run tests → report results.

**Usage:**
```bash
python test_workflow.py              # Full workflow with 5 test iterations
python test_workflow.py -r 10        # Run 10 iterations
python test_workflow.py --skip-server -r 3  # Skip startup, run 3 tests
```

**Features:**
- Orchestrates complete testing workflow
- Restarts server before testing
- Runs comprehensive test suite
- Provides single pass/fail status
- Best for automated testing and CI/CD

**Output:**
```
AIRCRAFT DASHBOARD - FULL TESTING WORKFLOW

Step 1: Starting server...
✓ Server started on localhost:3002

Step 2: Running comprehensive test suite...
[Test output...]

✅ WORKFLOW COMPLETED SUCCESSFULLY
```

### 4. `dashboard_utils.py` - Diagnostics & Utilities
Common helper tasks and server diagnostics.

**Usage:**
```bash
python dashboard_utils.py            # Run full diagnostics (default)
python dashboard_utils.py --health   # Check server health only
python dashboard_utils.py --cache    # Show cache statistics
python dashboard_utils.py --processes  # List running Node processes
python dashboard_utils.py --counts   # Show endpoint data counts
python dashboard_utils.py --diagnose # Full diagnostics
```

**Available Commands:**
- `--health`: Server status and uptime
- `--cache`: Cache stats (aircraft count, S3 reads/writes)
- `--processes`: List running Node processes
- `--counts`: Data counts from all endpoints
- `--diagnose`: Complete system diagnostics

**Output Example:**
```
Server Health Check:
  Status: ok
  Cache Ready: True
  ✓ Server is healthy

Cache Statistics:
  Aircraft in Cache: 5565
  Total Positions: 0
  S3 Reads: 11864
  S3 Writes: 117

Endpoint Data Summary:
  Positions: 21
  Heatmap Cells: 5104
  Squawk Transitions (1h): 4323
```

## Common Workflows

### Quick Test (Server Already Running)
```bash
python run_tests.py -r 3
```

### Full Test Cycle (With Server Restart)
```bash
python test_workflow.py -r 5
```

### Development Diagnostics
```bash
python dashboard_utils.py --diagnose
```

### Check Server Health Without Tests
```bash
python dashboard_utils.py --health --cache
```

### Monitor Server After Restart
```bash
python start_server.py -m
Start-Sleep -Seconds 5  # or: python -c "import time; time.sleep(5)"
python run_tests.py
```

## Requirements

**Python 3.7+** with these packages:
- `requests` - HTTP client (usually pre-installed)
- `psutil` - Process management (optional, graceful fallback on Windows)

**Install requirements:**
```bash
pip install requests
pip install psutil  # Optional for process listing
```

## Configuration

All scripts use `http://localhost:3002` as the default server. To change:
- Edit the `BASE_URL` variable at the top of each script
- Or set as environment variable: `DASHBOARD_URL=http://example.com:3002`

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success - all tests passed |
| 1 | Failure - one or more tests failed |

## Comparison: PowerShell → Python

| Operation | PowerShell | Python |
|-----------|-----------|--------|
| Run tests | `./run-tests.ps1 -Runs 5` | `python run_tests.py -r 5` |
| Start server | `./restart-server.ps1` | `python start_server.py` |
| Full workflow | Manual steps | `python test_workflow.py` |
| Diagnostics | Manual commands | `python dashboard_utils.py` |
| Cross-platform | Windows only | Windows, macOS, Linux |

## Tips

1. **Minimize console output**: Use `--skip-server` with `test_workflow.py` if server is already running
2. **CI/CD integration**: Use `test_workflow.py` for automated testing pipelines
3. **Development**: Run `dashboard_utils.py` periodically to monitor server health
4. **Troubleshooting**: Start with `dashboard_utils.py --diagnose` to identify issues
5. **Performance**: First test run may be slower (cache warmup), subsequent runs faster

## Troubleshooting

**"Cannot reach server" error:**
- Ensure server is running: `python start_server.py`
- Check server is on port 3002: `python dashboard_utils.py --health`

**Tests timing out:**
- Server may be loading data from S3, wait for warmup
- Try again with `python run_tests.py`

**Process listing shows nothing:**
- psutil module not installed, but diagnostics still work
- Check manually with: `tasklist | findstr node` (Windows)

## API Endpoints Tested

1. `/api/health` - Server status
2. `/api/cache-status` - Cache statistics and S3 operations
3. `/api/reception-range` - Reception coverage data
4. `/api/heatmap-data` - Grid-based heatmap data
5. `/api/airline-stats` - Airline statistics
6. `/api/squawk-transitions` - Squawk code transitions
7. `/api/position-timeseries-live` - Live position data
8. `/api/historical-stats` - Historical statistics
