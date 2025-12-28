// live-moving-map-refactor.js — modular, test-friendly rewrite
// ===== SECTION START: module header =====
// Purpose: Provide a small, well-scoped subset of the live-moving-map logic
// for safer iterative refactor and testing. Keep functions small and commented.
// ===== SECTION END: module header =====

// Minimal setup: create map on #map
const map = L.map('map').setView([39.5, -98.0], 5);
try { window.refactorMap = map; if (!window.map) window.map = map; } catch (e) {}

// Base map layers from the legacy page
const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 18
});
const openTopoLayer = L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', {
  attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)',
  maxZoom: 17
});
const cartoVoyagerLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  attribution: '© OpenStreetMap contributors © CARTO',
  maxZoom: 19,
  subdomains: 'abcd'
});
const arcgisImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles © Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
  maxZoom: 18
});
const arcgisStreet = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles © Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, 2012',
  maxZoom: 18
});
const arcgisTopo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles © Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community',
  maxZoom: 18
});
osmLayer.addTo(map);

const baseLayers = {
  'OpenStreetMap (Internet)': osmLayer,
  'CartoDB Voyager (Internet)': cartoVoyagerLayer,
  'OpenTopoMap (Internet)': openTopoLayer,
  'ArcGIS World Imagery': arcgisImagery,
  'ArcGIS World Street Map': arcgisStreet,
  'ArcGIS World Topo': arcgisTopo
};

// FAA aviation overlays via local proxy
const tileProxyBase = window._refactor_tileProxyBase || 'http://localhost:3004/tile';
const transparentTile = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
function buildFaaLayer(path) {
  return L.tileLayer(`${tileProxyBase}/${path}/{z}/{x}/{y}`, {
    attribution: '© FAA',
    maxZoom: 12,
    minZoom: 8,
    zIndex: 200,
    opacity: 0.8,
    errorTileUrl: transparentTile
  });
}
const faaVfrTerminal = buildFaaLayer('vfr-terminal');
const faaVfrSectional = buildFaaLayer('vfr-sectional');
const faaIfrAreaLow = buildFaaLayer('ifr-arealow');
const faaIfrHigh = buildFaaLayer('ifr-enroute-high');

// Weather overlays from Iowa State University Mesonet
const weatherRadarUrl = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png';
const surfaceAnalysisUrl = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/sfc_analysis/{z}/{x}/{y}.png';
const satelliteWvUrl = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/goes-wv-4km-900913/{z}/{x}/{y}.png';
const weatherRadar = L.tileLayer(weatherRadarUrl, { attribution: 'Weather © Iowa State University', opacity: 0.25, zIndex: 250 });
const surfaceAnalysis = L.tileLayer(surfaceAnalysisUrl, { attribution: 'Weather © Iowa State University', opacity: 0.25, zIndex: 251 });
const satelliteWv = L.tileLayer(satelliteWvUrl, { attribution: 'Weather © Iowa State University', opacity: 0.25, zIndex: 249 });

const overlayLayers = {
  'Weather Radar Internet': weatherRadar,
  'Surface Analysis Internet': surfaceAnalysis,
  'Satellite Water Vapor Internet': satelliteWv,
  'FAA VFR Terminal': faaVfrTerminal,
  'FAA VFR Sectional': faaVfrSectional,
  'FAA IFR Area Low': faaIfrAreaLow,
  'FAA IFR Enroute High': faaIfrHigh
};

let layersControl = null;
try {
  layersControl = L.control.layers(baseLayers, overlayLayers, { collapsed: false }).addTo(map);
  window.baseLayers = baseLayers;
  window.overlayLayers = overlayLayers;
  window.layersControl = layersControl;
} catch (e) {
  console.debug('layers control init failed', e);
}

// Periodically refresh weather overlays when visible to force tile cache busting
try {
  const weatherLayers = [
    { layer: weatherRadar, url: weatherRadarUrl },
    { layer: surfaceAnalysis, url: surfaceAnalysisUrl },
    { layer: satelliteWv, url: satelliteWvUrl }
  ];
  setInterval(() => {
    const timestamp = Date.now();
    weatherLayers.forEach(entry => {
      try {
        if (entry.layer && map.hasLayer(entry.layer)) {
          entry.layer.setUrl(`${entry.url}?t=${timestamp}`);
        }
      } catch (err) { /* non-fatal */ }
    });
  }, 5 * 60 * 1000);
} catch (e) { console.debug('weather overlay refresh setup failed', e); }
// Create panes used by track drawing so layers have expected DOM parents
try {
  map.createPane('livePane'); map.getPane('livePane').style.zIndex = 650;
  map.createPane('persistentPane'); map.getPane('persistentPane').style.zIndex = 680;
  map.createPane('markerPane'); map.getPane('markerPane').style.zIndex = 690;
} catch (e) { console.warn('Failed to create panes (already present?)', e); }

// ===== SECTION START: fetchWithTimeout =====
// Purpose: fetch wrapper that supports timeout and returns a normalized TimeoutError
class TimeoutError extends Error { constructor(message){ super(message); this.name='TimeoutError'; } }
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000){
  const controller = new AbortController();
  const signal = controller.signal;
  if (options.signal){ options.signal.addEventListener('abort', ()=>controller.abort()); }
  const timer = setTimeout(()=> controller.abort(), timeoutMs);
  try{
    const res = await fetch(url, {...options, signal});
    clearTimeout(timer);
    return res;
  }catch(e){
    clearTimeout(timer);
    if (e && e.name === 'AbortError') throw new TimeoutError('fetch timeout or aborted');
    throw e;
  }
}
// ===== SECTION END: fetchWithTimeout =====

// ===== SECTION START: aircraftHelpers loader =====
// Purpose: Lazy-load richer icon/popup helpers from /aircraftHelpers.js if available
let _refactor_helpers_loaded = false;
async function tryLoadAircraftHelpers(){
  try{
    const mod = await import('/aircraftHelpers.js');
    if (mod) {
      if (mod.createAircraftLogoIcon) {
        // prefer richer logo icon
        window._refactor_createAircraftLogoIcon = mod.createAircraftLogoIcon;
        createAircraftLogoIcon = mod.createAircraftLogoIcon; // override local stub
      }
      if (mod.getVerticalRateColor) {
        window._refactor_getVerticalRateColor = mod.getVerticalRateColor;
        getVerticalRateColor = mod.getVerticalRateColor;
      }
      if (mod.buildPopupHTML) {
        window._refactor_buildPopupHTML = mod.buildPopupHTML;
      }
      _refactor_helpers_loaded = true;
      console.debug('Aircraft helpers loaded from /aircraftHelpers.js');
    }
  }catch(e){
    console.debug('Aircraft helpers not available:', e && (e.message || e));
  }
}
// Start loading asynchronously but do not block module init
tryLoadAircraftHelpers();
// ===== SECTION END: aircraftHelpers loader =====

// ===== SECTION START: fetchTracksBatch =====
// Purpose: Accepts an array of {hex, minutes} requests and returns an array of arrays (one per request)
async function fetchTracksBatch(requests, options = {}){
  // NOTE: Try the real batch endpoint; if it fails or returns unexpected shape,
  // return empty arrays so callers can decide how to handle missing data.
  try {
    const body = JSON.stringify({ requests });
    const res = await fetchWithTimeout('/api/v2/track', { method: 'POST', headers:{'Content-Type':'application/json'}, body, signal: options.signal }, 15000);
    // If v2 endpoint exists and returned JSON in expected shape, use it
    if (res && res.ok) {
      try {
        const json = await res.json();
        if (json && Array.isArray(json.results)){
          const out = requests.map(_ => null);
          json.results.forEach(r => { if (r && (r.index !== undefined)) out[r.index] = r.track || []; });
          return out;
        }
      } catch (e) {
        // fall through to legacy fetch below
      }
    }

    // If we reached here, either v2 isn't available or returned unexpected data.
    // Fallback: fetch per-hex via legacy `/api/track?hex=...&minutes=...` endpoint.
    const results = [];
    for (const req of requests) {
      try {
        const hx = encodeURIComponent(req.hex || '');
        const mins = Number(req.minutes || 10);
        if (!hx) { results.push([]); continue; }
        const r = await fetchWithTimeout(`/api/track?hex=${hx}&minutes=${mins}`, { signal: options.signal }, 15000);
        if (!r.ok) { results.push([]); continue; }
        const payload = await r.json();
        // Normalize expected array shape: sometimes 'track' or top-level array
        const pts = payload && (payload.track || payload.positions || payload) || [];
        // Ensure array of point objects
        results.push(Array.isArray(pts) ? pts : []);
      } catch (err) {
        results.push([]);
      }
    }
    return results;
  } catch (err) {
    const msg = 'fetchTracksBatch: returning empty data ' + (err && (err.message || ''));
    _refactor_logNetworkDebug('fetchTracksBatch', msg);
  }

  return requests.map(() => []);
}
// ===== SECTION END: fetchTracksBatch =====

// ===== SECTION START: helpers for live tracks =====
// Purpose: Split large try-body work into a helper so the outer function stays tiny.
// This implementation is a faithful, test-friendly extraction of the original behavior:
//  - computes visible hexes (from `liveMarkers` if present)
//  - uses per-hex batching via `fetchTracksBatch`
//  - processes chunks incrementally and draws polylines on `longTracksLayer`
// The helper keeps localized try/catch blocks so a problem with one hex or chunk does not break the whole flow.

// Lightweight stubs used by the refactor page so this module is self-contained and safe to run.
// Use a global liveMarkers map so tests and other modules can access it easily
const liveMarkers = (window.liveMarkers = window.liveMarkers || new Map()); // hex -> { marker, lastSeen, enriched }
const liveTrackGroups = new Map();
const liveTrackFetchedAt = new Map();
const LIVE_TRACK_FETCH_RETRY_MS = 15 * 1000; // 15 seconds
const liveTracksLayer = L.layerGroup().addTo(map);
try { window.liveTracksLayer = liveTracksLayer; } catch (e) {}
const longTracksLayer = L.layerGroup().addTo(map);
try { window.longTracksLayer = longTracksLayer; } catch (e) {}

// Set window._refactor_autoTrackFetchEnabled=true before this bundle loads to restore legacy auto-fetching.
window._refactor_autoTrackFetchEnabled = true;
function autoTrackFetchEnabled(){
  return !!window._refactor_autoTrackFetchEnabled;
}

function requestManualTrackFetch(reason){
  try {
    if (typeof fetchAndDrawLiveTracks === 'function') {
      const result = fetchAndDrawLiveTracks();
      if (result && typeof result.catch === 'function') {
        result.catch(err => console.debug('manual track fetch failed', reason, err && (err.message || err)));
      }
    }
  } catch (err) {
    console.debug('requestManualTrackFetch failed', reason, err && (err.message || err));
  }
}
try { window._refactor_requestManualTrackFetch = requestManualTrackFetch; } catch (e) {}
// Marker layer and maps for live markers & trails
const liveMarkersLayer = L.layerGroup().addTo(map);
if (!window.liveMarkers) window.liveMarkers = new Map(); // hex -> { marker, lastSeen, enriched }
if (!window.liveTrails) window.liveTrails = new Map();
window.liveMarkersLayer = liveMarkersLayer;

function enforceUniqueLiveMarkersLayer(){
  try {
    if (!liveMarkersLayer || !liveMarkersLayer.eachLayer) return;
    const keep = new Set();
    try { liveMarkers.forEach(md => { if (md && md.marker) keep.add(md.marker); }); } catch(e){ return; }
    const toRemove = [];
    liveMarkersLayer.eachLayer(layer => { if (!keep.has(layer)) toRemove.push(layer); });
    toRemove.forEach(layer => { try { liveMarkersLayer.removeLayer(layer); } catch(e){} });
  } catch (e) { console.debug('enforceUniqueLiveMarkersLayer failed', e); }
}

const pendingFlightEnrichmentHexes = new Set();
let flightEnrichmentTimer = null;
let _refactor_overlayEventHooked = false;

function scheduleFlightEnrichment(hexesSet){
  try {
    if (!hexesSet || !hexesSet.size) return;
    hexesSet.forEach(h => { if (h) pendingFlightEnrichmentHexes.add(h); });
    if (flightEnrichmentTimer) return;
    const debounceMs = Number(window._refactor_flightFetchDebounceMs || 500);
    flightEnrichmentTimer = setTimeout(() => {
      flightEnrichmentTimer = null;
      flushFlightEnrichmentQueue();
    }, debounceMs);
  } catch (e) { console.debug('scheduleFlightEnrichment failed', e); }
}

async function flushFlightEnrichmentQueue(){
  try {
    if (!pendingFlightEnrichmentHexes.size) return;
    const chunkSize = Math.max(1, Number(window._refactor_maxHexesPerFlightFetch || 25));
    const hexes = Array.from(pendingFlightEnrichmentHexes);
    pendingFlightEnrichmentHexes.clear();
    for (let i = 0; i < hexes.length; i += chunkSize) {
      const chunk = hexes.slice(i, i + chunkSize);
      try {
        const res = await fetchFlightsBatch(chunk);
        mergeFlightBatch(res);
      } catch (err) {
        console.debug('flight enrichment chunk failed', err && (err.message || err));
      }
    }
  } catch (e) { console.debug('flushFlightEnrichmentQueue failed', e); }
}

// Config: whether to show start/end endpoint markers for tracks. Default ON.
if (typeof window._refactor_show_track_endpoints === 'undefined') window._refactor_show_track_endpoints = true;

let _refactor_liveOverlayRegistered = false;
function registerRefactorOverlayLayers(){
  try {
    if (_refactor_liveOverlayRegistered) return;
    const control = (window && window.layersControl) ? window.layersControl : null;
    if (!control) return;
    const overlayList = [
      ['Live Markers', liveMarkersLayer],
      ['Live Tracks (short)', liveTracksLayer],
      ['Long Tracks (history)', longTracksLayer]
    ];
    overlayList.forEach(([label, layer]) => {
      if (!layer) return;
      try { control.addOverlay(layer, label); } catch (err) {}
      try { if (window.overlayLayers) window.overlayLayers[label] = layer; } catch (err) {}
    });
    if (!_refactor_overlayEventHooked && map && typeof map.on === 'function') {
      _refactor_overlayEventHooked = true;
      map.on('overlayadd', evt => {
        try {
          if (!evt || !evt.layer) return;
          if (evt.layer === longTracksLayer || evt.layer === liveTracksLayer) {
            const reason = evt.layer === longTracksLayer ? 'leaflet-overlayadd-long' : 'leaflet-overlayadd-live';
            requestManualTrackFetch(reason);
          }
        } catch (e) { console.debug('overlayadd handler failed', e); }
      });
    }
    _refactor_liveOverlayRegistered = true;
  } catch (e) { console.debug('registerRefactorOverlayLayers failed', e); }
}
registerRefactorOverlayLayers();
function setTrackStatus(label, state){ console.debug('[track-status]', label, state); }
function addVerticalRatesToTrackPoints(pts){ if(!Array.isArray(pts)) return; pts.forEach(p=>{ if(p && typeof p === 'object' && p.vertical_rate === undefined) p.vertical_rate = 0; }); }
function maxTrackAngularChange(pts){ return 999; /* simplified for refactor */ }
function densifyTrackPoints(points){ return points.map(p=>[p.lat, p.lon]); }
function getVerticalRateColor(v){
  const climbThreshold = Number(window._refactor_climbThresholdFpm || 200);
  const descentThreshold = Number(window._refactor_descentThresholdFpm || 200);
  const rate = Number(v) || 0;
  if (rate > climbThreshold) return 'green';
  if (rate < -Math.abs(descentThreshold)) return 'red';
  return 'yellow';
}
function getHeadingDegrees(data){
  try {
    if (!data || typeof data !== 'object') return null;
    const candidates = [data.track, data.heading, data.course, data.true_track, data.trueTrack, data.trak, data.bearing];
    for (const val of candidates) {
      const num = Number(val);
      if (Number.isFinite(num)) {
        const normalized = ((num % 360) + 360) % 360;
        return normalized;
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}
function computeBearing(lat1, lon1, lat2, lon2){
  try {
    const a = Number(lat1), b = Number(lon1), c = Number(lat2), d = Number(lon2);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) return null;
    if (Math.abs(a - c) < 1e-9 && Math.abs(b - d) < 1e-9) return null;
    const φ1 = a * Math.PI / 180;
    const φ2 = c * Math.PI / 180;
    const Δλ = (d - b) * Math.PI / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
    const θ = Math.atan2(y, x);
    const deg = (θ * 180 / Math.PI + 360) % 360;
    return Number.isFinite(deg) ? deg : null;
  } catch (e) { return null; }
}
function resolveHeadingDegrees(data, md, fallbackLatLon){
  const apiHeading = getHeadingDegrees(data);
  if (apiHeading !== null) return apiHeading;
  const prev = fallbackLatLon || null;
  if (prev && Number.isFinite(prev.lat) && Number.isFinite(prev.lon)) {
    const derived = computeBearing(prev.lat, prev.lon, data.lat, data.lon);
    if (derived !== null) return derived;
  }
  if (md && typeof md.lastHeading === 'number' && Number.isFinite(md.lastHeading)) return md.lastHeading;
  return 0;
}
function getPositionTimestamp(data, fallback){
  try {
    if (!data || typeof data !== 'object') return fallback;
    const candidates = [data.timestamp, data.time, data.ts, data.seen, data.received_at];
    for (const val of candidates) {
      if (val === undefined || val === null) continue;
      const num = Number(val);
      if (Number.isFinite(num) && num > 0) return num;
      const parsed = Date.parse(val);
      if (Number.isFinite(parsed)) return parsed;
    }
  } catch (e) { /* ignore */ }
  return fallback;
}

// Rate-limited network debug logger to avoid noisy repeated messages.
// Config: window._refactor_networkLogWindowMs (default 60s), window._refactor_networkLogMaxPerWindow (default 5)
function _refactor_logNetworkDebug(key, msg) {
  try {
    window._refactor_networkErrorCounts = window._refactor_networkErrorCounts || {};
    const now = Date.now();
    const windowMs = Number(window._refactor_networkLogWindowMs || 60*1000);
    const maxPerWindow = Number(window._refactor_networkLogMaxPerWindow || 5);
    const entry = window._refactor_networkErrorCounts[key] || { timestamps: [] };
    entry.timestamps = entry.timestamps.filter(ts => (now - ts) <= windowMs);
    if (entry.timestamps.length < maxPerWindow) {
      entry.timestamps.push(now);
      window._refactor_networkErrorCounts[key] = entry;
      console.debug(msg);
    } else {
      // increment a suppressed counter (kept for testing/visibility)
      entry.suppressed = (entry.suppressed || 0) + 1;
      window._refactor_networkErrorCounts[key] = entry;
    }
  } catch (e) { /* ignore logging errors */ }
}

async function _fetchAndDrawLiveTracks_body(){
  setTrackStatus('Loading...', 'loading');

  // Respect map zoom and a global rate-limit to avoid frequent aborts of track batch requests
  const minZoom = Number(window._refactor_minZoomForTracks || 8);
  const globalRateLimitMs = Number(window._refactor_globalTrackFetchRateMs || (15 * 1000));
  try {
    if (map.getZoom && map.getZoom() < minZoom) { setTrackStatus('Zoom out to see tracks', 'idle'); console.debug('Skipped track fetch: zoom level too low', map.getZoom(), '<', minZoom); return; }
    const now = Date.now();

    // Rolling-window global rate limiting: permit at most N fetch rounds per window
    try {
      const windowMs = Number(window._refactor_trackFetchWindowMs || 60*1000);
      const maxPerWindow = Number(window._refactor_maxGlobalFetchesPerWindow || 3);
      // prune old timestamps
      window._refactor_trackFetchTimestamps = (window._refactor_trackFetchTimestamps || []).filter(ts => (now - ts) <= windowMs);
      if (window._refactor_trackFetchTimestamps.length >= maxPerWindow) {
        setTrackStatus('Rate limited', 'idle');
        console.debug('Global rolling-window limit active, skipping fetch;', window._refactor_trackFetchTimestamps.length, 'in last', windowMs, 'ms');
        return;
      }
      // reserve this fetch round timestamp now so concurrent callers do not all issue requests
      window._refactor_trackFetchTimestamps.push(now);
      // also record a simple lastTs so older callers still work with fallback logic
      window._refactor_lastGlobalTrackFetchTs = now;
    } catch (e) { console.debug('track-fetch windowing failed', e); }

  } catch (e) { console.debug('track-fetch pre-check failed', e); }

  // Gather visible hexes from live markers only
  const bounds = map.getBounds();
  const visible = [];
  const activeThresholdMs = Number(window._refactor_trackLiveThresholdMs || 5000); // only consider hexes with recent positions
  if (liveMarkers && liveMarkers.size) {
    liveMarkers.forEach((md, hex) => {
      try {
        const marker = (md && md.marker) ? md.marker : md;
        const latlng = marker && marker.getLatLng ? marker.getLatLng() : null;
        const lastSeen = md && (md.lastSeen || (marker && marker._posData && marker._posData.timestamp)) || 0;
        if (latlng && bounds.contains(latlng) && lastSeen && (Date.now() - lastSeen) <= activeThresholdMs) visible.push((hex||'').toString().toLowerCase());
      } catch (e) { /* ignore per-marker failures */ }
    });
  }

  if (visible.length === 0) {
    console.debug('Visible hexes for track fetch: none (waiting for live data)');
    setTrackStatus('Waiting for live positions', 'idle');
    // If nothing live, prune long track groups that are stale
    try {
      const nowCleanup = Date.now();
      for (const hk of Array.from(liveTrackGroups.keys())) {
        const md = liveMarkers.get(hk);
        const last = md && (md.lastSeen || (md.marker && md.marker._posData && md.marker._posData.timestamp)) || 0;
        if (!last || (nowCleanup - last) > activeThresholdMs) {
          try { const lg = liveTrackGroups.get(hk); if (lg) longTracksLayer.removeLayer(lg); } catch(e){}
          try { liveTrackGroups.delete(hk); } catch(e){}
          try { liveTrackFetchedAt.delete(hk); } catch(e){}
        }
      }
    } catch(e) {}
    return;
  }

  // Clear any current live tracks before redrawing
  try { liveTracksLayer.clearLayers(); } catch (e) {}

  // Use a reasonable minutes window for batch requests in the real implementation; here just 10
  const minutes = 10;

  // Only fetch tracks for hexes that need it
  const nowTs = Date.now();
  const needFetch = visible.filter(hx => {
    const md = liveMarkers.get(hx);
    const lastPos = md && (md.lastSeen || (md.marker && md.marker._posData && md.marker._posData.timestamp)) || 0;
    if (!lastPos || (nowTs - lastPos) > activeThresholdMs) return false; // require recent position
    if (liveTrackGroups.has(hx)) return false;
    if (window.liveTrackFetchInProgress && window.liveTrackFetchInProgress.has(hx)) return false; // already being fetched
    const last = liveTrackFetchedAt.get(hx) || 0;
    if (last && (nowTs - last) < LIVE_TRACK_FETCH_RETRY_MS) return false;
    return true;
  });
  console.debug('needFetch candidates:', needFetch);

  // Limit global concurrent fetches: avoid excessive requests when lots of visible hexes
  const MAX_VISIBLE_FOR_TRACK_FETCH = Number(window._refactor_maxVisibleForTrackFetch || 40);
  if (needFetch.length > MAX_VISIBLE_FOR_TRACK_FETCH) {
    // keep the first N (visible order) - could be randomized or prioritized by recency
    console.debug('Trimming needFetch from', needFetch.length, 'to', MAX_VISIBLE_FOR_TRACK_FETCH);
    needFetch.length = MAX_VISIBLE_FOR_TRACK_FETCH;
  }

  let anyDrawn = false;

  if (needFetch.length === 0) {
    if (!map.hasLayer(liveTracksLayer) && liveTrackGroups.size > 0) liveTracksLayer.addTo(map);
    try { /* best-effort */ } catch(e){}
    setTrackStatus('OK (Live)', 'ok');
    return;
  }

  // Prevent overlapping global fetch rounds
  if (window._refactor_track_fetch_in_progress) {
    console.debug('Track fetch already in progress - skipping this round');
    setTrackStatus('OK (Live)', 'ok');
    return;
  }
  window._refactor_track_fetch_in_progress = true;

  // Cancel previous fetch if any
  let controller = new AbortController();
  const chunkPromises = [];

  for (let i = 0; i < needFetch.length; i += 20) {
    const chunk = needFetch.slice(i, i + 20);
    const trackRequests = chunk.map(hx => ({ hex: hx, minutes }));
    const p = (async () => {
      // mark these hexes as in-progress
      try { chunk.forEach(hx => window.liveTrackFetchInProgress.add(hx)); } catch(e){}
      try {
        const trackArrays = await fetchTracksBatch(trackRequests, { signal: controller.signal });
        try {
          trackArrays.forEach((pts, idx) => {
            try {
              const hx = chunk[idx];
              // If a group already exists for this hex, append into it rather than replacing.
              let targetGroup = null;
              try {
                if (liveTrackGroups.has(hx)) targetGroup = liveTrackGroups.get(hx);
              } catch (e) { /* ignore */ }

              // If remote API fails to return data for this hex, skip
              if (!pts || !Array.isArray(pts) || pts.length < 2) return;

              // add vertical rates and maybe simplify
              addVerticalRatesToTrackPoints(pts);
              if (maxTrackAngularChange(pts) < 10) pts = [pts[0], pts[pts.length - 1]];

              // build segments by color
              const segments = [];
              let currentSegment = { points: [pts[0]], color: getVerticalRateColor(pts[0].vertical_rate || 0) };
              for (let j = 1; j < pts.length; j++) {
                const point = pts[j];
                const color = getVerticalRateColor(point.vertical_rate || 0);
                if (color === currentSegment.color) currentSegment.points.push(point);
                else { segments.push(currentSegment); currentSegment = { points: [point], color }; }
              }
              segments.push(currentSegment);

              const lg = targetGroup || L.layerGroup();
              segments.forEach(segment => {
                if (segment.points.length >= 2) {
                  const latlngs = densifyTrackPoints(segment.points, 0.1);
                  const poly = L.polyline(latlngs, { color: segment.color, weight: 3, opacity: 0.95, pane: 'persistentPane', interactive: false });
                  console.log(`Drawing track for ${hx}: ${latlngs.length} points, color: ${segment.color}, layer on map: ${map.hasLayer(liveTracksLayer)}`);
                  lg.addLayer(poly);
                  // If this hex has been persisted by the user, also append a copy
                  // of the newly-fetched segment into the persistent tracks group.
                  try {
                    const appendEnabled = (window._refactor_appendLiveToPersistent === undefined) ? true : !!window._refactor_appendLiveToPersistent;
                    if (appendEnabled && window.persistentTracks && window.persistentTracks.has(hx)) {
                      const pgroup = window.persistentTracks.get(hx);
                      const ppoly = L.polyline(latlngs, { color: segment.color, weight: 3, opacity: 0.95, pane: 'persistentPane', interactive: false });
                      try {
                        if (pgroup && typeof pgroup.addLayer === 'function') pgroup.addLayer(ppoly);
                        else if (window.persistentTracksLayer && typeof window.persistentTracksLayer.addLayer === 'function') window.persistentTracksLayer.addLayer(ppoly);
                      } catch (e) { /* non-fatal */ }
                    }
                  } catch (e) { /* ignore persistence append errors */ }
                }
              });

              // start/end markers (optional, controlled by UI)
              try {
                if (window._refactor_show_track_endpoints) {
                  const startLatLng = [pts[0].lat, pts[0].lon];
                  const endLatLng = [pts[pts.length - 1].lat, pts[pts.length - 1].lon];
                  const start = L.circleMarker(startLatLng, { radius: 4, fillColor: '#00ff00', color: '#006600', weight: 1, fillOpacity: 0.95, pane: 'persistentPane' });
                  const end = L.circleMarker(endLatLng, { radius: 4, fillColor: '#ff0000', color: '#660000', weight: 1, fillOpacity: 0.95, pane: 'persistentPane' });
                  lg.addLayer(start); lg.addLayer(end);
                }
              } catch (e) {}

              // If we created a new group, add it to the longTracksLayer. Always keep a reference
              try { if (!targetGroup) longTracksLayer.addLayer(lg); } catch (e) {}
              try { liveTrackGroups.set(hx, lg); } catch (e) {}
              anyDrawn = true;
              // record successful fetch timestamp
              try { liveTrackFetchedAt.set(hx, Date.now()); } catch(e){}
            } catch (e) { console.warn('Long track chunk draw error:', e && (e.message || e)); if (e && e.stack) console.debug(e.stack); }
          });
        } catch (e) { console.warn('Track chunk processing failed:', e && (e.message || e)); if (e && e.stack) console.debug(e.stack); }
      } catch (err) {
        // Demote expected network/timeout/abort failures to debug level to avoid noisy logs
        const msg = err && (err.message || '');
        if (err && (err.name === 'TimeoutError' || err.name === 'AbortError' || /abort|timeout|failed to fetch|net::ERR_ABORTED/i.test(msg))) {
          _refactor_logNetworkDebug('trackBatch_'+(chunk||[]).slice(0,3).join(','), 'Track batch network/timeout/abort for chunk ' + (chunk||[]).join(',') + ' ' + msg);
        } else {
          console.warn('Track batch failed for chunk:', chunk, msg);
          if (err && err.stack) console.debug(err.stack);
        }
      } finally {
        // cleanup in-progress markers for these hexes
        try { chunk.forEach(hx => window.liveTrackFetchInProgress.delete(hx)); } catch(e){}
      }
    })();
    chunkPromises.push(p);
  }

  await Promise.allSettled(chunkPromises);
  // mark global fetch round finished
  try { window._refactor_track_fetch_in_progress = false; } catch(e){}

  // Remove long tracks for hexes that are no longer live (expired beyond threshold) or not currently visible
  try {
    const nowCleanup = Date.now();
    for (const hk of Array.from(liveTrackGroups.keys())) {
      try {
        const md = liveMarkers.get(hk);
        const last = md && (md.lastSeen || (md.marker && md.marker._posData && md.marker._posData.timestamp)) || 0;
        if (!last || (nowCleanup - last) > activeThresholdMs || !visible.includes(hk)) {
          const lg = liveTrackGroups.get(hk);
          try { if (lg) longTracksLayer.removeLayer(lg); } catch(e){}
          try { liveTrackGroups.delete(hk); } catch(e){}
          try { liveTrackFetchedAt.delete(hk); } catch(e){}
          try { if (window.liveTrails && window.liveTrails.has(hk)) { const tr = window.liveTrails.get(hk); try { tr.remove(); } catch(e){}; window.liveTrails.delete(hk); } } catch(e){}
        }
      } catch(e){}
    }
  } catch(e) { /* ignore cleanup failures */ }

  if (!anyDrawn) { longTracksLayer.clearLayers(); setTrackStatus('Idle', 'idle'); }
  if (!map.hasLayer(longTracksLayer) && anyDrawn) longTracksLayer.addTo(map);
  setTrackStatus(anyDrawn ? 'OK (Long)' : 'Idle', anyDrawn ? 'ok' : 'idle');
  if (!map.hasLayer(liveTracksLayer)) liveTracksLayer.addTo(map);
}

async function fetchAndDrawLiveTracks(){
  console.log('fetchAndDrawLiveTracks called');
  try{ await _fetchAndDrawLiveTracks_body(); }
  catch(e){
    if (e && (e.name === 'AbortError' || e.name === 'TimeoutError' || (e.message && /abort|timeout|failed to fetch|net::ERR_ABORTED/i.test(e.message)))) {
      console.debug('fetchAndDrawLiveTracks aborted/timeout:', e && (e.message || e));
    } else {
      console.warn('fetchAndDrawLiveTracks failed:', e && (e.message || e));
    }
  }
}
// Expose fetchAndDrawLiveTracks for tests and console
window._refactor_fetchAndDrawLiveTracks = fetchAndDrawLiveTracks;
window.fetchAndDrawLiveTracks = fetchAndDrawLiveTracks;
// ===== SECTION END: helpers for live tracks =====

// ===== SECTION START: processPositions =====
// Purpose: Safely process an array of position records and update in-memory liveMarkers and lastPositions.
// All errors are caught locally so this helper can be called from outside the module without risking syntax fragility.

// --- Live position polling control ---
let _refactor_position_poll_interval = null;
let _refactor_position_poll_controller = null;
let _refactor_live_socket = null;
let _refactor_live_socket_connected = false;
let _refactor_lastPollIntervalMs = 1000;

function updateRefactorStatus(text){
  try {
    const el = document.getElementById('ref-status');
    if (el) el.textContent = text;
  } catch (e) {}
}

function ensurePollingFallback(){
  if (_refactor_position_poll_interval || _refactor_live_socket_connected) return;
  const interval = _refactor_lastPollIntervalMs || 1000;
  startPositionPolling(interval);
}

async function fetchLivePositions(options={}){
  const params = new URLSearchParams();
  // short window for live data
  params.set('hours', String(options.hours || 0.05));
  params.set('limit', String(options.limit || 2000));
  const url = '/api/positions?' + params.toString();
  const res = await fetchWithTimeout(url, { method: 'GET', signal: (options.signal || undefined) }, 10000);
  if (!res.ok) throw new Error('positions fetch failed: ' + res.status);
  const json = await res.json();
  return json && json.positions ? json.positions : [];
}

function startPositionPolling(intervalMs = 1000){
  _refactor_lastPollIntervalMs = intervalMs;
  if (_refactor_live_socket_connected) {
    console.debug('Skipping HTTP polling because live socket is connected');
    updateRefactorStatus('socket live');
    return;
  }
  stopPositionPolling();
  _refactor_position_poll_controller = new AbortController();
  const controller = _refactor_position_poll_controller;
  const doPoll = async () => {
    console.log('doPoll called');
    try{
      const positions = await fetchLivePositions({ hours: 0.02, limit: 1000, signal: controller.signal });
      console.log('doPoll received', positions ? positions.length : 0, 'positions');
      if (positions && positions.length) {
        try { processPositions(positions); } catch(e){ console.debug('processPositions failed', e); }
      }
    }catch(e){ console.debug('position poll failed', e && (e.message || e)); }
  };
  // immediate
  doPoll();
  _refactor_position_poll_interval = setInterval(doPoll, intervalMs);
  console.debug('position polling started @', intervalMs, 'ms');
  updateRefactorStatus('polling');
}

function stopPositionPolling(){
  try{ if (_refactor_position_poll_interval) clearInterval(_refactor_position_poll_interval); }catch(e){}
  try{ if (_refactor_position_poll_controller) _refactor_position_poll_controller.abort(); }catch(e){}
  _refactor_position_poll_interval = null; _refactor_position_poll_controller = null;
  console.debug('position polling stopped');
  if (!_refactor_live_socket_connected) updateRefactorStatus('stopped');
}

function handleSocketLiveUpdate(payload){
  try {
    let positions = null;
    if (payload && Array.isArray(payload.positions)) positions = payload.positions;
    else if (payload && Array.isArray(payload.aircraft)) positions = payload.aircraft;
    else if (Array.isArray(payload)) positions = payload;
    if (!positions || !positions.length) return;

    const now = Date.now();
    const recencyMs = Number(window._refactor_socketRecencyMs || 15000);
    const byHex = new Map();
    positions.forEach(p => {
      try {
        const hex = (p.hex || p.icao || p.icao24 || '').toString().toLowerCase();
        if (!hex) return;
        const lat = Number(p.lat ?? p.latitude ?? p.Latitude);
        const lon = Number(p.lon ?? p.longitude ?? p.Longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        const ts = getPositionTimestamp(p, now);
        if (recencyMs && ts && (now - ts) > recencyMs) return;
        const normalized = { ...p, hex, lat, lon, timestamp: ts || now };
        const existing = byHex.get(hex);
        if (!existing || ((normalized.timestamp || 0) > (existing.timestamp || 0))) {
          byHex.set(hex, normalized);
        }
      } catch (err) { /* ignore */ }
    });

    const filtered = Array.from(byHex.values());
    if (!filtered.length) return;
    processPositions(filtered);
  } catch (err) {
    console.warn('handleSocketLiveUpdate failed', err && (err.message || err));
  }
}

function initLiveSocket(){
  if (typeof io !== 'function') {
    console.debug('socket.io client not available; using HTTP polling');
    ensurePollingFallback();
    return;
  }

  if (_refactor_live_socket) {
    try { _refactor_live_socket.off('liveUpdate'); } catch (e) {}
    try { _refactor_live_socket.close(); } catch (e) {}
  }

  const defaultHost = `${window.location.protocol}//${window.location.hostname}:3003`;
  const socketUrl = window._refactor_socketServerUrl || defaultHost;
  try {
    _refactor_live_socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelayMax: 5000,
      timeout: Number(window._refactor_socketTimeoutMs || 5000)
    });
  } catch (err) {
    console.warn('Failed to initialize live socket', err && (err.message || err));
    ensurePollingFallback();
    return;
  }

  _refactor_live_socket.on('connect', () => {
    _refactor_live_socket_connected = true;
    console.debug('Live socket connected');
    updateRefactorStatus('socket live');
    stopPositionPolling();
  });

  _refactor_live_socket.on('disconnect', (reason) => {
    _refactor_live_socket_connected = false;
    console.debug('Live socket disconnected', reason);
    updateRefactorStatus('socket retry');
    ensurePollingFallback();
  });

  _refactor_live_socket.on('connect_error', (err) => {
    _refactor_live_socket_connected = false;
    console.debug('Live socket connect_error', err && (err.message || err));
    updateRefactorStatus('socket error');
    ensurePollingFallback();
  });

  _refactor_live_socket.on('liveUpdate', handleSocketLiveUpdate);
}

window._refactor_handleSocketLiveUpdate = handleSocketLiveUpdate;
window._refactor_initLiveSocket = initLiveSocket;

// Expose polling controls
window._refactor_startPositionPolling = startPositionPolling;
window._refactor_stopPositionPolling = stopPositionPolling;

async function ensureLiveTrackForHex(hex, minutes) {
  try {
    // Enforce "live only" policy: do not draw a long track unless the hex has a recent position
    const activeThresholdMs = Number(window._refactor_trackLiveThresholdMs || 5000);
    const md = liveMarkers.get(hex);
    const lastSeen = md && (md.lastSeen || (md.marker && md.marker._posData && md.marker._posData.timestamp)) || 0;
    if (!lastSeen || (Date.now() - lastSeen) > activeThresholdMs) {
      console.debug('ensureLiveTrackForHex: skipping draw for stale or missing marker', hex);
      // Remove any previously drawn long tracks/trails for this hex
      try {
        const has = (typeof liveTrackGroups !== 'undefined' && liveTrackGroups.has && liveTrackGroups.has(hex));
        console.debug('ensureLiveTrackForHex: liveTrackGroups.has', hex, has);
        if (has) {
          const lg = liveTrackGroups.get(hex);
          try { console.debug('ensureLiveTrackForHex: longTracksLayer hasLayer before remove?', longTracksLayer && longTracksLayer.hasLayer && longTracksLayer.hasLayer(lg)); } catch(e){}
          try { longTracksLayer.removeLayer(lg); console.debug('ensureLiveTrackForHex: removed group for', hex); } catch(e){ console.debug('ensureLiveTrackForHex: remove failed', e && (e.message||e)); }
          try { liveTrackGroups.delete(hex); } catch(e){}
        }
      } catch(e){ console.debug('ensureLiveTrackForHex: stale cleanup error', e && (e.message||e)); }
      try { liveTrackFetchedAt.delete(hex); } catch(e){}
      try { if (window.liveTrails && window.liveTrails.has(hex)) { const tr = window.liveTrails.get(hex); try { tr.remove(); } catch(e){}; window.liveTrails.delete(hex); } } catch(e){}
      return;
    }

    const res = await fetchTracksBatch([{ hex, minutes }]);
    // The batch API returns an array-of-arrays; take the first
    let pts = Array.isArray(res) ? res[0] : null;
    console.debug('ensureLiveTrackForHex fetched pts for', hex, 'len=', pts && pts.length);

    if (!pts || !Array.isArray(pts) || pts.length < 2) return;

    // Record that we've fetched this hex once
    liveTrackFetchedAt.set(hex, Date.now());

    // Build colored segments just like the legacy page
    try {
      addVerticalRatesToTrackPoints(pts);
      if (maxTrackAngularChange(pts) < 10 && pts.length > 2) pts = [pts[0], pts[pts.length - 1]];
    } catch (e) { /* keep pts as-is on failure */ }

    const segments = [];
    try {
      let currentSegment = { points: [pts[0]], color: getVerticalRateColor(pts[0].vertical_rate || 0) };
      for (let j = 1; j < pts.length; j++) {
        const point = pts[j];
        const color = getVerticalRateColor(point.vertical_rate || 0);
        if (color === currentSegment.color) currentSegment.points.push(point);
        else { segments.push(currentSegment); currentSegment = { points: [point], color }; }
      }
      segments.push(currentSegment);
    } catch (e) { console.debug('ensureLiveTrackForHex: segment build failed', e); }

    const lg = L.layerGroup();
    try {
      segments.forEach(segment => {
        if (!segment || !segment.points || segment.points.length < 2) return;
        const latlngs = densifyTrackPoints(segment.points, 0.1);
        const poly = L.polyline(latlngs, { color: segment.color || '#00aaff', weight: 3, opacity: 0.95, pane: 'persistentPane', interactive: false });
        lg.addLayer(poly);
      });

      if (window._refactor_show_track_endpoints) {
        const startLatLng = [pts[0].lat, pts[0].lon];
        const endLatLng = [pts[pts.length - 1].lat, pts[pts.length - 1].lon];
        const start = L.circleMarker(startLatLng, { radius: 4, fillColor: '#00ff00', color: '#006600', weight: 1, fillOpacity: 0.95, pane: 'persistentPane' });
        const end = L.circleMarker(endLatLng, { radius: 4, fillColor: '#ff0000', color: '#660000', weight: 1, fillOpacity: 0.95, pane: 'persistentPane' });
        lg.addLayer(start); lg.addLayer(end);
      }

      longTracksLayer.addLayer(lg);
      liveTrackGroups.set(hex, lg);
    } catch (e) { console.debug('ensureLiveTrackForHex: draw failed', e); }
  } catch (e) {
    console.debug('ensureLiveTrackForHex: failed', hex, e && (e.message || e));
  }
}

async function processPositions(positions) {
  console.log('processPositions called with', positions ? positions.length : 0, 'positions');
  try {
    if (!Array.isArray(positions)) return;
    // Ensure global lastPositions map exists for testing
    if (!window.lastPositions) window.lastPositions = new Map();
    if (!window.flightsCache) window.flightsCache = new Map();

    // Track which hexes are present in this update for strict display filtering
    const seenHexes = new Set();
    const hexesNeedingEnrichment = new Set();
    const flightTtlMs = Number(window._refactor_flight_ttl_ms || (5 * 60 * 1000));
    const nowGlobal = Date.now();
    const liveMarkerThresholdMs = Number(window._refactor_markerLiveThresholdMs || 5000);
    for (const p of positions) {
      try {
        const hex = (p.hex || '').toString().toLowerCase();
        if (!hex) continue;
        const posTs = getPositionTimestamp(p, null);
        if (!posTs) continue;
        if ((nowGlobal - posTs) > liveMarkerThresholdMs) {
          try { window._refactor_skippedStalePositions = (window._refactor_skippedStalePositions || 0) + 1; } catch(e){}
          continue;
        }
        seenHexes.add(hex);

        // Update or create marker
        const nowTs = posTs;
        let md = liveMarkers.get(hex);
        const historyArr = window.lastPositions.get(hex) || [];
        const historyPrev = historyArr.length ? { lat: historyArr[historyArr.length - 1][0], lon: historyArr[historyArr.length - 1][1] } : null;
        const fallbackLatLon = historyPrev || (md && md.marker && md.marker._posData ? { lat: md.marker._posData.lat, lon: md.marker._posData.lon } : null);
        const rot = resolveHeadingDegrees(p, md || {}, fallbackLatLon);
        const vr = Number(p && p.vertical_rate) || 0;
        if (!md) {
          // Prefer richer logo icon (may be overridden asynchronously by aircraftHelpers loader)
          const icon = createAircraftLogoIcon(p || {}, rot, 30, vr);
          const marker = L.marker([p.lat, p.lon], { icon, pane: 'markerPane', zIndexOffset: 1000 });
          marker._refactorHex = hex;
          // bind popups/tooltips with the full data snapshot we currently know
          try { bindPopupAndTooltip(marker, Object.assign({}, p, { hex })); } catch (e) { console.debug('initial bind failed', e); }
          liveMarkersLayer.addLayer(marker);
          md = { marker, lastSeen: nowTs };
        } else {
          // update existing marker lat/lon and icon if orientation/vertical_rate present
          try {
            if (md.marker) md.marker._refactorHex = hex;
            if (md.marker && md.marker.setLatLng) md.marker.setLatLng([p.lat, p.lon]);
          } catch(e){}
          try {
            const icon = createAircraftLogoIcon(p || {}, rot, 30, vr);
            if (md.marker && md.marker.setIcon) md.marker.setIcon(icon);
          } catch(e) { /* non-fatal */ }
          md.lastSeen = nowTs;
        }
        md.lastHeading = rot;
        md.marker._posData = { lat: p.lat, lon: p.lon, timestamp: nowTs, heading: rot };
        md.seenInUpdate = true; // mark for cleanup
        liveMarkers.set(hex, md);

        // Try to hydrate enrichment data from cache; otherwise schedule a fetch
        try {
          const cacheEntry = window.flightsCache.get(hex);
          const cacheFresh = cacheEntry && cacheEntry.ts && ((nowGlobal - cacheEntry.ts) <= flightTtlMs);
          if (cacheFresh && cacheEntry.data) {
            md.enriched = cacheEntry.data;
            bindPopupAndTooltip(md.marker, cacheEntry.data);
          } else if (!md.enriched) {
            hexesNeedingEnrichment.add(hex);
          }
        } catch(e){ console.debug('processPositions flight cache check failed', e); }

        // Maintain a tiny lastPositions history
        historyArr.push([p.lat, p.lon]);
        if (historyArr.length > 20) historyArr.shift();
        window.lastPositions.set(hex, historyArr);

        // Refresh popup/tooltip content with the most recent position plus any enrichment
        try {
          const popupPayload = Object.assign({}, md.enriched || {}, p, { hex });
          bindPopupAndTooltip(md.marker, popupPayload);
        } catch (e) { console.debug('popup refresh failed', e); }

        // Fire ensureLiveTrackForHex once per hex if not fetched yet
        if (autoTrackFetchEnabled()) {
          const fetched = liveTrackFetchedAt.get(hex) || 0;
          if (!fetched) {
            // Fire-and-forget; ensure errors are non-fatal
            ensureLiveTrackForHex(hex, 10).catch(e => console.debug('ensureLiveTrackForHex failed', e && (e.message || e)));
          }
        }
      } catch (e) { /* ignore individual position errors */ }
    }

    // Trigger live tracks update if we have visible aircraft
    if (seenHexes.size > 0) {
      // Debounce the live tracks fetch to avoid too frequent calls
      const now = Date.now();
      const lastFetch = window._refactor_lastLiveTracksFetch || 0;
      const debounceMs = 5000; // Only fetch live tracks every 5 seconds max
      if (now - lastFetch > debounceMs) {
        window._refactor_lastLiveTracksFetch = now;
        console.log('Triggering automatic track fetch from processPositions');
        fetchAndDrawLiveTracks().catch(e => console.debug('fetchAndDrawLiveTracks failed', e && (e.message || e)));
      }
    }

    // Cleanup: remove markers/tracks for hexes not present in this update if strict mode enabled
    try {
      const strict = (window._refactor_strict_current_positions === undefined) ? false : !!window._refactor_strict_current_positions;
      const now = Date.now();
      const markerTtlMs = Number(window._refactor_markerTtlMs || 30 * 1000);
      for (const [hk, md] of Array.from(liveMarkers.entries())) {
        if (seenHexes.has(hk)) continue; // keep current
        // If strict mode, remove any marker not in this update immediately
        if (strict) {
          try {
            // remove marker from layer
            if (md.marker && liveMarkersLayer && liveMarkersLayer.hasLayer(md.marker)) liveMarkersLayer.removeLayer(md.marker);
          } catch(e){}
          try { liveMarkers.delete(hk); } catch(e){}
          // Remove trails and long tracks for this hex
          try { if (window.liveTrails && window.liveTrails.has(hk)) { const tr = window.liveTrails.get(hk); try { tr.remove(); } catch(e){}; window.liveTrails.delete(hk); } } catch(e){}
          try { if (liveTrackGroups.has(hk)) { const lg = liveTrackGroups.get(hk); try { longTracksLayer.removeLayer(lg); } catch(e){}; liveTrackGroups.delete(hk); } } catch(e){}
          try { liveTrackFetchedAt.delete(hk); } catch(e){}
          try { if (window.flightsCache) window.flightsCache.delete(hk); } catch(e){}
        } else {
          // Non-strict: remove if older than configured TTL
          const age = (md && md.lastSeen) ? (now - md.lastSeen) : Infinity;
          if (age > markerTtlMs) {
            try { if (md.marker && liveMarkersLayer && liveMarkersLayer.hasLayer(md.marker)) liveMarkersLayer.removeLayer(md.marker); } catch(e){}
            try { liveMarkers.delete(hk); } catch(e){}
            try { if (window.liveTrails && window.liveTrails.has(hk)) { const tr = window.liveTrails.get(hk); try { tr.remove(); } catch(e){}; window.liveTrails.delete(hk); } } catch(e){}
            try { if (liveTrackGroups.has(hk)) { const lg = liveTrackGroups.get(hk); try { longTracksLayer.removeLayer(lg); } catch(e){}; liveTrackGroups.delete(hk); } } catch(e){}
            try { liveTrackFetchedAt.delete(hk); } catch(e){}
            try { if (window.flightsCache) window.flightsCache.delete(hk); } catch(e){}
          }
        }
      }
    } catch(e) { console.debug('cleanup stale markers failed', e); }

    enforceUniqueLiveMarkersLayer();
  } catch (e) {
    console.warn('processPositions failed:', e && (e.message || e));
  }
}
// Expose helpers for manual testing
window._refactor_processPositions = processPositions;
window._refactor_ensureLiveTrackForHex = ensureLiveTrackForHex;
window._refactor_scheduleFlightEnrichment = scheduleFlightEnrichment;
window._refactor_flushFlightEnrichmentQueue = flushFlightEnrichmentQueue;

// ===== SECTION START: enrichment & popups =====
// Purpose: Build and attach tooltip/popup content and enrich flight metadata.
// These helpers are small, isolated, and safe to run repeatedly in tests.
function buildTooltipHtml(data){
  // data: {hex, callsign, squawk, alt, speed}
  try{
    const cs = data.callsign || 'N/A';
    const sq = data.squawk || '----';
    const alt = data.alt === undefined ? '-' : String(data.alt);
    const sp = data.speed === undefined ? '-' : String(data.speed);
    return `<div style="font-family: Arial, sans-serif; font-size:12px;">`+
           `<strong>${cs}</strong><br/>Sqk: ${sq}<br/>Alt: ${alt}<br/>Spd: ${sp}</div>`;
  }catch(e){ return `<div>Flight: ${data.hex || 'unknown'}</div>`; }
}

function escapeHtml(value){
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPopupValue(value){
  if (value === null) return '<span style="color:#777;">null</span>';
  if (value === undefined) return '<span style="color:#777;">undefined</span>';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? escapeHtml(value.toLocaleString()) : escapeHtml(String(value));
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    return value.trim() ? escapeHtml(value) : '<span style="color:#777;">(empty)</span>';
  }
  if (Array.isArray(value) || typeof value === 'object') {
    try {
      return `<pre style="margin:0;font-size:11px;white-space:pre-wrap;">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
    } catch (e) {
      return '<span style="color:#777;">[object]</span>';
    }
  }
  return escapeHtml(String(value));
}

function buildPopupDataTableHtml(data){
  try {
    if (!data || typeof data !== 'object') {
      return '<div class="popup-data-table" style="margin-top:8px;font-size:12px;">No data available</div>';
    }
    const entries = Object.entries(data);
    if (!entries.length) {
      return '<div class="popup-data-table" style="margin-top:8px;font-size:12px;">No data available</div>';
    }
    entries.sort(([a], [b]) => a.localeCompare(b));
    const rows = entries.map(([key, value]) => `
      <tr>
        <th style="text-align:left;padding:4px 6px;font-size:11px;color:#555;white-space:nowrap;">${escapeHtml(key)}</th>
        <td style="padding:4px 6px;font-size:11px;color:#111;word-break:break-word;">${formatPopupValue(value)}</td>
      </tr>
    `).join('');
    return `
      <div class="popup-data-table" style="margin-top:8px;max-height:260px;overflow:auto;border-top:1px solid #eee;padding-top:6px;">
        <div style="font-weight:bold;font-size:12px;margin-bottom:4px;">All Data</div>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
      </div>`;
  } catch (e) {
    return '<div class="popup-data-table" style="margin-top:8px;font-size:12px;">Unable to render data</div>';
  }
}

// Minimal icon helpers (simple SVG divIcons) so refactor page shows realistic markers
function createAircraftIcon(color = '#ff3300', size = 28, rotation = 0){
  const svg = `<?xml version="1.0"?><svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' width='${size}' height='${size}'><g transform='rotate(${rotation},32,32)'><path d='M32 2 L37 22 L54 27 L37 33 L32 62 L27 33 L10 27 L27 22 Z' fill='${color}'/></g></svg>`;
  return L.divIcon({ html: `<div class='aircraft-icon'>${svg}</div>`, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

function createAircraftLogoIcon(info = {}, rotation = 0, size = 28, verticalRate = 0){
  // If info.logo exists, place image, otherwise fallback to simple icon
  const color = verticalRate > 0 ? '#ff9900' : (verticalRate < 0 ? '#0099ff' : '#ff3300');
  if (info && info.logo) {
    const imgHtml = `<div class='aircraft-logo-icon' style='width:${size}px;height:${size}px;transform:rotate(${rotation}deg);'><img src='${info.logo}' width='${size}' height='${size}'/></div>`;
    return L.divIcon({ html: imgHtml, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
  }
  return createAircraftIcon(color, size, rotation);
}

// Expose icons for testing
window._refactor_createAircraftIcon = createAircraftIcon;
window._refactor_createAircraftLogoIcon = createAircraftLogoIcon;
function bindPopupAndTooltip(marker, data){
  try{
    const existing = (marker && marker._popupData && typeof marker._popupData === 'object') ? marker._popupData : {};
    const merged = Object.assign({}, existing);
    if (marker && marker._posData && typeof marker._posData === 'object') {
      const posData = marker._posData;
      ['lat', 'lon', 'timestamp', 'heading'].forEach(key => {
        if (posData[key] !== undefined) merged[key] = posData[key];
      });
    }
    if (marker && marker._refactorHex) merged.hex = marker._refactorHex;
    if (data && typeof data === 'object') Object.assign(merged, data);
    if (marker) marker._popupData = merged;

    const tooltipHtml = buildTooltipHtml(merged);
    const popupSummary = (window._refactor_buildPopupHTML && typeof window._refactor_buildPopupHTML === 'function')
      ? window._refactor_buildPopupHTML(merged)
      : tooltipHtml;
    const popupHtml = `${popupSummary}${buildPopupDataTableHtml(merged)}`;

    if (marker && marker.bindPopup) try{ marker.bindPopup(popupHtml); }catch(e){}
    if (marker && marker.bindTooltip) try{ marker.bindTooltip(tooltipHtml, { direction: 'top' }); }catch(e){}
  }catch(e){ console.debug('bindPopupAndTooltip failed', e); }
}

// ===== SECTION START: flight batch helpers =====
// Purpose: Fetch flights in batch and merge them into liveMarkers/flightsCache.
async function fetchFlightsBatch(hexes, options={}){
  try{
    if (!Array.isArray(hexes)) return {};
    // Try real endpoint first
    const body = JSON.stringify({ requests: hexes.map(h => ({ icao: h })) });
    const res = await fetchWithTimeout('/api/v2/flight', { method: 'POST', headers: {'Content-Type':'application/json'}, body, signal: options.signal }, 10000);
    if (res && res.ok){
      const json = await res.json();
      // Expected shape: { results: [{ index, flight }, ...] }
      if (json && Array.isArray(json.results)){
        const out = {};
        json.results.forEach(r => { if (r && r.index !== undefined) { const h = (hexes[r.index]||'').toString(); out[h] = r.flight || null; } });
        return out;
      }
      // Fallback: if server returned map directly
      if (json && typeof json === 'object') return json;
    }
  }catch(e){ console.debug('fetchFlightsBatch: returning empty data', e && (e.message || e)); }

  return {};
}

// Merge the flight data map into internal caches and markers
function updateTooltipsForBatch(hexes, flightMap){
  try{
    if (!Array.isArray(hexes) || !flightMap) return;
    hexes.forEach(h => {
      try{
        const lk = (h||'').toString().toLowerCase();
        const md = liveMarkers.get(lk);
        const data = flightMap && flightMap[h];
        if (md && data) {
          try{
            md.enriched = data;
            // Update marker icon if we can
            try {
              const rot = ((data && data.heading) || 0) % 360;
              const vr = (data && data.vertical_rate) || 0;
              const icon = createAircraftLogoIcon(data, rot, 30, vr);
              if (md.marker && md.marker.setIcon) md.marker.setIcon(icon);
            } catch(e){ /* non-fatal */ }
            bindPopupAndTooltip(md.marker, data);
          } catch(e){ console.debug('updateTooltipsForBatch entry failed', h, e); }
        }
      }catch(e){ console.debug('updateTooltipsForBatch per-entry failed', h, e); }
    });
  }catch(e){ console.debug('updateTooltipsForBatch failed', e); }
}
    // Kick off flight enrichment for any hexes still missing popup data (rate limited)
    try {
      scheduleFlightEnrichment(hexesNeedingEnrichment);
    } catch(e){ console.debug('processPositions enrichment trigger failed', e); }


function mergeFlightBatch(resMap){
  try{
    if (!resMap || typeof resMap !== 'object') return;
    if (!window.flightsCache) window.flightsCache = new Map();
    const keys = Object.keys(resMap);
    keys.forEach(k => {
      try{
        const lk = (k||'').toString().toLowerCase();
        const data = resMap[k];
        flightsCache.set(lk, { ts: Date.now(), data });
      }catch(e){ console.debug('mergeFlightBatch entry failed', k, e); }
    });
    // Bulk update tooltips/popups after cache merge
    try { updateTooltipsForBatch(keys, resMap); } catch(e) { console.debug('mergeFlightBatch post-update failed', e); }
  }catch(e){ console.debug('mergeFlightBatch failed', e); }
}

// Expose flight helpers for testing
window._refactor_fetchFlightsBatch = fetchFlightsBatch;
window._refactor_mergeFlightBatch = mergeFlightBatch;
window._refactor_updateTooltipsForBatch = updateTooltipsForBatch;
// ===== SECTION END: flight batch helpers =====

window._refactor_buildTooltipHtml = buildTooltipHtml;
window._refactor_bindPopupAndTooltip = bindPopupAndTooltip;
// ===== SECTION END: enrichment & popups =====

// ===== SECTION START: processPositions =====n// Note: rest of file continues...

// ===== SECTION START: doUpdateLiveMarkers =====
// Purpose: Central runner to process position updates, merge markers/trails, and trigger track fetching.
function doUpdateLiveMarkers(positions) {
  try {
    if (!Array.isArray(positions)) return;
    // Ensure liveTrails map exists
    if (!window.liveTrails) window.liveTrails = new Map();

    const now = Date.now();
    const liveMarkerThresholdMs = Number(window._refactor_markerLiveThresholdMs || 5000);
    positions.forEach(p => {
      try {
        const hex = (p.hex || '').toString().toLowerCase();
        if (!hex) return;
        const posTs = getPositionTimestamp(p, null);
        if (!posTs) return;
        if ((now - posTs) > liveMarkerThresholdMs) {
          try { window._refactor_skippedStalePositions = (window._refactor_skippedStalePositions || 0) + 1; } catch (e) {}
          return;
        }

        // update in-memory marker + lastPositions
        const md = liveMarkers.get(hex) || { marker: { _posData: null, getLatLng: () => ({ lat: p.lat, lng: p.lon }) }, lastSeen: now };
        md.lastSeen = posTs;
        md.marker._posData = { lat: p.lat, lon: p.lon, timestamp: md.lastSeen };
        try {
          if (md.marker && md.marker.setLatLng) md.marker.setLatLng([p.lat, p.lon]);
        } catch(e){}
        try {
          const rot = getHeadingDegrees(p);
          const vr = Number(p.vertical_rate || p.vert_rate || 0);
          const icon = createAircraftLogoIcon(p || {}, rot, 30, vr);
          if (md.marker && md.marker.setIcon) md.marker.setIcon(icon);
        } catch(e){ }
        try { if (md.marker) md.marker._refactorHex = hex; } catch(e){}
        liveMarkers.set(hex, md);

        // Update trail polyline - create lazily
        try {
          let tr = window.liveTrails.get(hex);
          if (!tr) {
            const poly = L.polyline([[p.lat, p.lon]], { color: '#888', weight: 2, opacity: 0.8, pane: 'livePane', interactive: false });
            const lg = L.layerGroup([poly]);
            liveTracksLayer.addLayer(lg);
            window.liveTrails.set(hex, poly);
            tr = poly;
          } else {
            // append a point
            try { tr.addLatLng([p.lat, p.lon]); } catch(e) { console.debug('trail addLatLng failed', e); }
          }
        } catch (e) { console.debug('trail update error', e); }

        // Fire-and-forget ensureLiveTrackForHex to load initial long track
        try { ensureLiveTrackForHex(hex, 10).catch(()=>{}); } catch(e) {}
      } catch (e) { /* ignore per-position errors */ }
    });

    // Age updater: refresh Age strings in tooltips/popups periodically
    try {
      if (!window._refactor_age_interval) {
        window._refactor_age_interval = setInterval(() => {
          try {
            window.liveMarkers.forEach((md, hx) => {
              try {
                const marker = md && md.marker;
                if (!marker) return;
                const pd = (marker._posData) || {};
                const age = pd.timestamp ? Math.round((Date.now() - pd.timestamp)/1000) : null;
                const html = buildTooltipHtml(Object.assign({}, md.enriched || {}, { age }));
                try { const pp = marker.getPopup && marker.getPopup(); if (pp && pp.setContent) pp.setContent(html); } catch (e) {}
                try { const tt = marker.getTooltip && marker.getTooltip(); if (tt && tt.setContent) tt.setContent && tt.setContent(html); } catch (e) {}
              } catch(e){}
            });
          } catch(e){}
        }, 5000);
      }
    } catch(e){}


    if (autoTrackFetchEnabled()) {
      // Optionally trigger fetchAndDrawLiveTracks to refresh visible tracks (debounce would be better)
      try { fetchAndDrawLiveTracks().catch(() => {}); } catch(e) {}
    }
  } catch (e) {
    console.warn('doUpdateLiveMarkers failed:', e && (e.message || e));
  }
}

// Expose runner for testing
window._refactor_doUpdateLiveMarkers = doUpdateLiveMarkers;
// ===== SECTION END: doUpdateLiveMarkers =====

// Auto-run a single validation pass when module loads
(async function runSmoke(){
  try{
    if (autoTrackFetchEnabled()) {
      await fetchAndDrawLiveTracks();
    }

    // Prefer realtime socket updates; fall back to HTTP polling when unavailable.
    initLiveSocket();
    if (!_refactor_live_socket_connected) {
      try { startPositionPolling(1000); } catch(e) { console.debug('startPositionPolling failed', e); }
    }

    console.log('Refactor page smoke run successful');
  }catch(e){ console.error('Smoke run failed', e); }
})();

// Boundary layer references for toggling
let boundaryLayers = [];
let artccLayer, countryLayer, firLayer, stateLayer, provinceLayer, oceanicLayer;

// Load ARTCC boundaries from FAA Open Data
fetch('https://adds-faa.opendata.arcgis.com/datasets/67885972e4e940b2aa6d74024901c561_0.geojson')
    .then(response => response.json())
    .then(data => {
        artccLayer = L.geoJSON(data, {
            style: {
                color: 'red',
                weight: 2,
                fillOpacity: 0
            }
        });
        layersControl.addOverlay(artccLayer, "ARTCC Boundaries");
        boundaryLayers.push(artccLayer);
    })
    .catch(error => console.error('Failed to load ARTCC boundaries:', error));

// Load World Country Boundaries
fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json')
    .then(response => response.json())
    .then(data => {
        countryLayer = L.geoJSON(data, {
            style: {
                color: '#666',
                weight: 1,
                fillOpacity: 0
            }
        });
        layersControl.addOverlay(countryLayer, "Country Borders");
        boundaryLayers.push(countryLayer);
    })
    .catch(error => console.error('Failed to load country boundaries:', error));

// Load FIR and Oceanic Boundaries from VATSIM data
fetch('https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/Boundaries.geojson')
    .then(response => response.json())
    .then(data => {
        // Filter FIR boundaries (non-oceanic)
        const firFeatures = data.features.filter(feature => feature.properties.oceanic !== "1");
        firLayer = L.geoJSON({ type: "FeatureCollection", features: firFeatures }, {
            style: {
                color: '#00ff00',
                weight: 1.5,
                fillOpacity: 0
            }
        });
        layersControl.addOverlay(firLayer, "FIR Boundaries");
        boundaryLayers.push(firLayer);

        // Filter Oceanic boundaries
        const oceanicFeatures = data.features.filter(feature => feature.properties.oceanic === "1");
        oceanicLayer = L.geoJSON({ type: "FeatureCollection", features: oceanicFeatures }, {
            style: {
                color: '#0080ff',
                weight: 2,
                fillOpacity: 0
            }
        });
        layersControl.addOverlay(oceanicLayer, "Oceanic Boundaries");
        boundaryLayers.push(oceanicLayer);
    })
    .catch(error => console.error('Failed to load VATSIM boundaries:', error));

// Load US State Boundaries
fetch('https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json')
    .then(response => response.json())
    .then(data => {
        stateLayer = L.geoJSON(data, {
            style: {
                color: '#ffa500',
                weight: 1,
                fillOpacity: 0
            }
        });
        layersControl.addOverlay(stateLayer, "US State Borders");
        boundaryLayers.push(stateLayer);
    })
    .catch(error => console.error('Failed to load US state boundaries:', error));

// Load Canadian Province Boundaries
fetch('https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/canada.geojson')
    .then(response => response.json())
    .then(data => {
        provinceLayer = L.geoJSON(data, {
            style: {
                color: '#ff4500',
                weight: 1,
                fillOpacity: 0
            }
        });
        layersControl.addOverlay(provinceLayer, "Canadian Provinces");
        boundaryLayers.push(provinceLayer);
    })
    .catch(error => console.error('Failed to load Canadian province boundaries:', error));

// Load Oceanic Control Areas (CTA/FIR boundaries for oceanic airspace) - DISABLED: oceanic boundaries are now loaded from main boundaries file
// fetch('https://raw.githubusercontent.com/vatsimnetwork/OceanicDataProject/master/OceanicBoundaries.geojson')
//     .then(response => response.json())
//     .then(data => {
//         oceanicLayer = L.geoJSON(data, {
//             style: {
//                 color: '#0080ff',
//                 weight: 2,
//                 fillOpacity: 0
//             }
//         });
//         layersControl.addOverlay(oceanicLayer, "Oceanic Boundaries");
//         boundaryLayers.push(oceanicLayer);
//     })
//     .catch(error => console.error('Failed to load oceanic boundaries:', error));

// Add event listener for show-boundaries checkbox
document.getElementById('show-boundaries').addEventListener('change', () => {
    const showBoundaries = document.getElementById('show-boundaries').checked;
    boundaryLayers.forEach(layer => {
        if (showBoundaries) {
            if (!map.hasLayer(layer)) {
                map.addLayer(layer);
            }
        } else {
            if (map.hasLayer(layer)) {
                map.removeLayer(layer);
            }
        }
    });
});

// Helper function to toggle individual boundary layers
function toggleBoundaryLayer(checkboxId, layer) {
    document.getElementById(checkboxId).addEventListener('change', () => {
        const isChecked = document.getElementById(checkboxId).checked;
        if (isChecked && layer) {
            if (!map.hasLayer(layer)) {
                map.addLayer(layer);
            }
        } else if (layer) {
            if (map.hasLayer(layer)) {
                map.removeLayer(layer);
            }
        }
    });
}

// Add event listeners for individual boundary checkboxes using helper function
toggleBoundaryLayer('show-artcc', artccLayer);
toggleBoundaryLayer('show-countries', countryLayer);
toggleBoundaryLayer('show-fir', firLayer);
toggleBoundaryLayer('show-us-states', stateLayer);
toggleBoundaryLayer('show-canada', provinceLayer);
toggleBoundaryLayer('show-oceanic', oceanicLayer);

// Wire up simple UI controls (start/stop, interval)
try{
  const startBtn = document.getElementById('ref-start');
  const stopBtn = document.getElementById('ref-stop');
  const intervalInput = document.getElementById('ref-interval');
  const statusSpan = document.getElementById('ref-status');

  if (startBtn) startBtn.addEventListener('click', () => {
    const ms = Math.max(100, Number(intervalInput.value) || 1000);
    startPositionPolling(ms);
    if (statusSpan) statusSpan.textContent = 'polling';
  });
  if (stopBtn) stopBtn.addEventListener('click', () => { stopPositionPolling(); if (statusSpan) statusSpan.textContent = 'stopped'; });
  // Show/hide start/end endpoint markers for tracks
  try{
    const showEndChk = document.getElementById('ref-show-end');
    if (showEndChk) {
      showEndChk.checked = !!window._refactor_show_track_endpoints;
      showEndChk.addEventListener('change', (ev) => {
        window._refactor_show_track_endpoints = !!ev.target.checked;
        // trigger a redraw of tracks so endpoints follow the new setting
        try { fetchAndDrawLiveTracks().catch(()=>{}); } catch(e) {}
      });
    }
  }catch(e){ console.debug('show-end wiring failed', e); }
} catch(e){ console.debug('control wiring failed', e); }
