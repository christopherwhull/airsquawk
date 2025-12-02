# Pull Request: Leaflet Heatmap Time Window and Scaling Controls Fix

## Summary
Fixed critical issues with the leaflet heatmap page where time window changes were not updating position counts and scaling mode changes had no effect on the visualization.

## Problems Identified

### 1. Time Window Not Updating Position Counts
**Issue**: When users changed the time window dropdown (1h, 4h, 12h, 24h, 7d, all), the displayed position count and grid visualization remained unchanged.

**Root Cause**: The server's in-memory position cache (`allHeatmapPositions`) didn't have valid timestamps or was loaded with stale data, causing the time filtering logic to fail silently.

**Evidence**:
```javascript
// API test showed identical results across all time windows
Window: 1h   | Total Positions:    75792 | Cells:   9419
Window: 4h   | Total Positions:    75792 | Cells:   9419
Window: 24h  | Total Positions:    75792 | Cells:   9419
Window: 7d   | Total Positions:    75792 | Cells:   9419
```

### 2. Scaling Mode Dropdown Not Working
**Issue**: Changing the scaling mode (Linear, Logarithmic, Square Root, Power) had no visual effect on the heatmap.

**Root Cause**: The event listener for `scaling-mode` was incorrectly placed **inside** the `getColorForIntensity()` function at line 404, causing:
- Event listener to be registered multiple times (memory leak)
- Placement in unreachable code that never executed during page initialization

**Code Location**:
```javascript
// WRONG - inside getColorForIntensity function
function getColorForIntensity(value, max, mode = 'intensity') {
    // ... color calculation code ...
    document.getElementById('scaling-mode').addEventListener('change', () => {
        if (currentData) updateGridDisplay();
    });
}
```

## Solutions Implemented

### 1. Server Restart to Reload Position Data
- Restarted the server using `npm run restart:node` to reload the position cache with proper timestamp enrichment
- Verified time filtering now works correctly:
```javascript
Window: 1h   | Total Positions:      996 | Cells:    684
Window: 4h   | Total Positions:     3774 | Cells:   2007
Window: 12h  | Total Positions:     7732 | Cells:   3357
Window: 24h  | Total Positions:    14153 | Cells:   4974
Window: 7d   | Total Positions:    88232 | Cells:   9678
Window: all  | Total Positions:    88525 | Cells:   9694
```

### 2. Fixed Scaling Mode Event Listener
**Changes Made**:
```javascript
// Removed misplaced event listener from inside getColorForIntensity()
// Added to proper location with other event listeners:

document.getElementById('scaling-mode').addEventListener('change', () => {
    saveSettings();
    if (currentData) updateGridDisplay();
});
```

### 3. Added Cookie-Based Settings Persistence
Implemented complete settings persistence across browser sessions:

**Features**:
- `setCookie()` / `getCookie()` functions for 1-year persistence
- `saveSettings()` - Saves all control values on change
- `loadSettings()` - Restores settings on page load
- Automatic save when any control changes

**Settings Persisted**:
- Time Window
- Color Mode
- Scaling Mode
- Opacity value
- Show Borders checkbox

### 4. Changed Default Scaling to Logarithmic
- Updated HTML default from `linear` to `log`
- Provides better visualization of high-density areas
- Falls back to logarithmic if no saved settings exist

### 5. Improved Restart Script
**Problem**: Previous PowerShell script killed ALL node processes
```powershell
# OLD - Too aggressive
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'server.js' }
```

**Solution**: Python script now targets only process on port 3002
```python
def find_process_on_port(port):
    """Find the process ID listening on the specified port."""
    # Uses netstat on Windows, lsof on Unix
    # Only stops the specific PID on port 3002
```

**Benefits**:
- No longer kills unrelated node processes
- Safer for development environments
- Cross-platform compatible

### 6. Added Test Coverage
Created `tools/test-timewindow-api.js` to verify API filtering:
```javascript
// Tests all time windows and validates different position counts
const windows = ['1h', '4h', '12h', '24h', '7d', 'all'];
// Integrated into npm run test:all
```

## Files Modified

1. **public/heatmap-leaflet.html**
   - Fixed scaling mode event listener placement
   - Added cookie management functions
   - Implemented settings persistence
   - Changed default scaling to logarithmic
   - Added console logging for debugging

2. **package.json**
   - Changed `restart:node` from PowerShell to Python script

3. **tools/restart_server.py**
   - Refactored to use port-based process detection
   - Added `find_process_on_port()` function
   - Improved cross-platform support

4. **tools/restart-node-server.ps1** (not tracked)
   - Updated to find processes by port instead of command line

5. **tools/test-all.js**
   - Added time window API test as step 2

6. **tools/test-timewindow-api.js** (new)
   - Tests API filtering across all time windows

7. **tools/debug-timestamps.js** (new)
   - Debug utility for checking timestamp data

8. **lib/api-routes.js**
   - Removed debug logging (was temporarily added)

## Testing Results

### Unit Tests
```
Test Suites: 6 passed, 6 total
Tests:       31 passed, 31 total
Time:        4.065 s
```

### API Integration Test
```
Window: 1h   | Total Positions:      996 | Cells:    684 | Max Density:    13
Window: 4h   | Total Positions:     3774 | Cells:   2007 | Max Density:    46
Window: 12h  | Total Positions:     7732 | Cells:   3357 | Max Density:    93
Window: 24h  | Total Positions:    14153 | Cells:   4974 | Max Density:    93
Window: 7d   | Total Positions:    88232 | Cells:   9678 | Max Density:   625
Window: all  | Total Positions:    88525 | Cells:   9694 | Max Density:   625
```

## User Impact

**Before**:
- Time window changes had no effect
- Scaling mode changes had no effect
- Settings reset on every page reload
- Restart killed all node processes

**After**:
- Time window correctly filters data with visible position count changes
- Scaling mode changes immediately update visualization
- User preferences persist across sessions
- Restart only affects the server process on port 3002
- Better default visualization with logarithmic scaling

## Breaking Changes
None. All changes are backward compatible.

## Deployment Notes
- Server restart required to reload position cache with timestamps
- Cookie format: `leafletHeatmapSettings` with 1-year expiration
- No database migrations needed
- No configuration changes required

## Related Issues
- Fixes leaflet heatmap time filtering
- Fixes scaling mode control
- Improves user experience with persistent settings
- Safer restart process for development

## Commit
```
commit aec0c50
Fix leaflet heatmap time window and scaling controls

- Fixed time window dropdown not updating position counts
- Fixed scaling mode dropdown not triggering visual updates
- Added cookie-based settings persistence for all controls
- Changed default scaling mode to logarithmic
- Improved Python restart script to only stop process on port 3002
- Updated package.json to use Python restart script instead of PowerShell
- Added time window API test to test suite
- Moved test scripts to tools directory
```
