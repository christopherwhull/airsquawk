# Issue: FAA Aviation Chart Layers Not Working on Leaflet Heatmap Page

## Problem Description
The leaflet heatmap page includes layer controls for aviation charts (FAA Sectional and Terminal Area Charts), but these layers fail to display tiles while the OpenStreetMap base layer works correctly.

## Current Implementation

### Layer Configuration
```javascript
// OpenStreetMap - WORKS
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 18
});

// FAA Sectional Charts - FAILS
const skyVectorIFRLayer = L.tileLayer('https://wms.chartbundle.com/tms/1.0.0/sec/{z}/{x}/{y}.png', {
    attribution: 'FAA Sectional Charts © ChartBundle',
    maxZoom: 12,
    tms: true
});

// Terminal Area Charts - FAILS
const skyVectorVFRLayer = L.tileLayer('https://wms.chartbundle.com/tms/1.0.0/tac/{z}/{x}/{y}.png', {
    attribution: 'FAA Terminal Area Charts © ChartBundle',
    maxZoom: 12,
    tms: true
});
```

## Symptoms
- ✅ OpenStreetMap layer displays correctly
- ❌ FAA Sectional Charts layer shows blank/no tiles
- ❌ Terminal Area Charts layer shows blank/no tiles
- Layer control widget appears and allows toggling
- No console errors reported (layers fail silently)

## Root Cause Analysis

### Issue 1: ChartBundle Service Status
The ChartBundle tile service at `wms.chartbundle.com` may be:
- Offline or discontinued
- Requires authentication/API key
- Changed URL structure
- Rate-limited or blocked

### Issue 2: TMS Flag Configuration
The `tms: true` option inverts the Y-axis for TMS (Tile Map Service) coordinate system, which differs from standard XYZ tiles. If ChartBundle changed their tile format, this could cause mismatched tile requests.

### Issue 3: Zoom Level Restrictions
`maxZoom: 12` limits the chart layers to zoom level 12, which may:
- Not match the current map zoom level
- Be too restrictive for the default view (zoom level 4)
- Prevent tiles from being requested at common zoom levels

## Investigation Steps Needed

1. **Test ChartBundle URLs directly**
   - Visit tile URLs in browser
   - Check for 404, 403, or authentication errors
   - Example: `https://wms.chartbundle.com/tms/1.0.0/sec/4/3/6.png`

2. **Check browser console**
   - Open DevTools Network tab
   - Filter for `chartbundle` requests
   - Look for HTTP status codes and error responses

3. **Verify TMS coordinate system**
   - Try removing `tms: true` flag
   - Test with standard XYZ tile format
   - Check ChartBundle documentation for current tile URL format

4. **Test zoom level compatibility**
   - Adjust `maxZoom` and `minZoom` parameters
   - Verify tiles exist at the default zoom level 4

## Potential Solutions

### Solution 1: Update to Working Aviation Chart Service
Replace ChartBundle with alternative aviation chart providers:

**Option A: VFRMap.com**
```javascript
const vfrMapLayer = L.tileLayer('https://vfrmap.com/tiles/{z}/{x}/{y}.jpg', {
    attribution: '© VFRMap.com',
    maxZoom: 13,
    minZoom: 3
});
```

**Option B: OpenAIP (Free, requires registration)**
```javascript
const openAIPLayer = L.tileLayer('https://2.tile.maps.openaip.net/geowebcache/service/tms/1.0.0/openaip_basemap@EPSG:900913@png/{z}/{x}/{y}.png', {
    attribution: '© OpenAIP',
    maxZoom: 14,
    tms: true
});
```

**Option C: ArcGIS Aviation Charts**
```javascript
const arcgisAviation = L.tileLayer('https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Esri, FAA',
    maxZoom: 12
});
```

### Solution 2: Fix ChartBundle Configuration
If ChartBundle is still operational:
```javascript
// Try without TMS flag
const sectionalCharts = L.tileLayer('https://wms.chartbundle.com/tms/1.0.0/sec/{z}/{x}/{y}.png', {
    attribution: 'FAA Sectional Charts © ChartBundle',
    maxZoom: 12,
    minZoom: 3,  // Add minZoom
    tms: false   // Try without TMS
});

// Add error handler
sectionalCharts.on('tileerror', function(error, tile) {
    console.error('Tile loading error:', error, tile.src);
});
```

### Solution 3: Add Multiple Chart Providers
Implement fallback options:
```javascript
const chartProviders = {
    "VFRMap": L.tileLayer('https://vfrmap.com/tiles/{z}/{x}/{y}.jpg', {
        attribution: '© VFRMap.com',
        maxZoom: 13
    }),
    "ChartBundle Sectional": L.tileLayer('https://wms.chartbundle.com/tms/1.0.0/sec/{z}/{x}/{y}.png', {
        attribution: 'FAA Sectional © ChartBundle',
        maxZoom: 12,
        tms: true
    }),
    "OpenAIP": L.tileLayer('https://2.tile.maps.openaip.net/geowebcache/service/tms/1.0.0/openaip_basemap@EPSG:900913@png/{z}/{x}/{y}.png', {
        attribution: '© OpenAIP',
        maxZoom: 14,
        tms: true
    })
};
```

## Recommended Action Plan

1. **Immediate**: Add error handler to debug tile loading failures
2. **Test**: Verify ChartBundle service availability
3. **Research**: Find reliable, free aviation chart tile services
4. **Implement**: Replace non-working layers with verified alternatives
5. **Document**: Update attribution and service requirements
6. **Test**: Verify new layers work at various zoom levels
7. **Deploy**: Update production with working chart layers

## Impact Assessment

**Current State**:
- Users expect aviation charts but get blank overlay
- Layer control appears functional but layers don't work
- Confusing user experience
- No error feedback

**After Fix**:
- Working aviation chart overlays
- Proper error handling if service unavailable
- Multiple chart provider options
- Better user experience

## Related Files
- `public/heatmap-leaflet.html` (lines 310-333)

## Testing Checklist
- [ ] Verify tile URLs are accessible
- [ ] Check browser console for tile loading errors
- [ ] Test at zoom levels 3-12
- [ ] Verify attribution text
- [ ] Test layer switching
- [ ] Verify overlay transparency
- [ ] Test on different geographic locations
- [ ] Document API key requirements (if any)
- [ ] Test on mobile devices
- [ ] Verify performance with overlay enabled

## References
- [Leaflet TileLayer Documentation](https://leafletjs.com/reference.html#tilelayer)
- [Leaflet TMS Support](https://leafletjs.com/reference.html#tilelayer-tms)
- [ChartBundle Service](https://wms.chartbundle.com/)
- [VFRMap Tiles](https://vfrmap.com/)
- [OpenAIP](https://www.openaip.net/)
- [ArcGIS Aviation Maps](https://www.arcgis.com/home/item.html?id=...)

## Priority
**Medium-High** - Feature is visible to users but non-functional, creating poor user experience.

## Estimated Effort
- Investigation: 1-2 hours
- Implementation: 2-3 hours
- Testing: 1 hour
- **Total**: 4-6 hours
