export function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.classList.add('show');
    setTimeout(() => errorDiv.classList.remove('show'), 5000);
}

export function showLoading(show) {
    document.getElementById('loading').classList.toggle('active', show);
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: options.signal || controller.signal });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

export function setLiveStatus(text, state) {
    const el = document.getElementById('live-fetch-status');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('status-ok', 'status-loading', 'status-error', 'status-success', 'status-warning', 'status-idle');
    if (state === 'ok') el.classList.add('status-ok');
    else if (state === 'loading') el.classList.add('status-loading');
    else if (state === 'error') el.classList.add('status-error');
    else if (state === 'success') el.classList.add('status-success');
    else if (state === 'warning') el.classList.add('status-warning');
    else if (state === 'idle') el.classList.add('status-idle');
}

export function updateLivePositionsFromSocket(data) {
    try {
        const positions = (data && Array.isArray(data.aircraft)) ? data.aircraft : (Array.isArray(data) ? data : null);

        if (!positions) {
            console.warn('Invalid socket data received:', data);
            return;
        }
        const RECENT_MS = 10 * 1000;
        const nowTs = Date.now();
        const positionsByHex = new Map();
        
        positions.forEach(p => {
            const hx = (p.hex || p.HEX || p.icao || p.icao24 || '').toLowerCase();
            const ts = p.timestamp || p.ts || p.time || 0;
            if (!hx) return;
            if (!positionsByHex.has(hx)) positionsByHex.set(hx, []);
            positionsByHex.get(hx).push(Object.assign({}, p, { timestamp: ts }));
        });

        const filtered = [];
        for (const [hex, arr] of positionsByHex.entries()) {
            arr.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            const latest = arr[0];
            if (!latest) continue;
            
            const hours = 1;
            if (hours <= 1 && (latest.timestamp || nowTs) < (nowTs - RECENT_MS)) continue;

            try {
                const pts = arr.slice(0, 3).map(p => [p.lat ?? p.Latitude ?? p.latitude, p.lon ?? p.Longitude ?? p.longitude]).reverse();
                if (pts && pts.length) window.lastPositions.set(hex, pts);
            } catch (e) {}

            filtered.push(latest);
        }

        positions = filtered;

        updateLiveMarkers(positions);
        
        setLiveStatus(formatOkWithTime(`Socket (${positions.length})`), 'success');
        
    } catch (e) {
        console.error('Error processing socket liveUpdate:', e);
        setLiveStatus('Socket Error', 'error');
    }
}

export function updateLiveMarkers(positions) {
    try {
        if (!positions || !positions.length) return;
        if (!window._positionsQueue) window._positionsQueue = [];
        window._positionsQueue.push(positions);
        if (window && typeof window.scheduleProcessPositions === 'function') {
            try { window.scheduleProcessPositions(); } catch (e) { console.warn('scheduleProcessPositions failed', e); }
            return;
        }

        // fallback synchronous update
        const now = Date.now();
        const TIMEOUT_MS = 15 * 1000;
        
        for (const [hex, markerData] of window.liveMarkers.entries()) {
            markerData.seenInUpdate = false;
        }
        
        positions.forEach(p => {
            const lat = p.lat ?? p.Latitude ?? p.latitude;
            const lon = p.lon ?? p.Longitude ?? p.longitude;
            if (typeof lat !== 'number' || typeof lon !== 'number') return;
            const hex = (p.hex || '').toLowerCase();

            let verticalRate = 0;
            try {
                const alt = p.alt || p.altitude || p.Alt || p.Altitude || null;
                if (alt !== null && typeof alt === 'number') {
                    const prevData = window.verticalRateCache.get(hex);
                    if (prevData) {
                        const timeDiff = (now - prevData.timestamp) / 1000;
                        if (timeDiff > 30 && timeDiff < 300) {
                            const altDiff = alt - prevData.altitude;
                            verticalRate = (altDiff / timeDiff) * 60;
                        }
                    }
                    window.verticalRateCache.set(hex, { altitude: alt, timestamp: now });
                }
            } catch (e) {}

            const existingMarkerData = window.liveMarkers.get(hex);
            if (existingMarkerData) {
                existingMarkerData.marker.setLatLng([lat, lon]);
                existingMarkerData.marker._posData = p;
                existingMarkerData.lastSeen = now;
                existingMarkerData.seenInUpdate = true;

                const tooltipHtml = window.buildHoverTooltipHTML(p);
                try { existingMarkerData.marker.getTooltip().setContent(tooltipHtml); } catch (e) {}
                try { existingMarkerData.marker.getPopup().setContent(tooltipHtml); } catch (e) {}

                try {
                    const aircraftInfo = {
                        manufacturer: p.manufacturer || p.airline || null,
                        typecode: p.aircraft_type || null
                    };
                    if (aircraftInfo.typecode) {
                        const track = p.heading || p.track || p.course || 0;
                        const rot = (track - 90 + 360) % 360;
                        const newIcon = window.createAircraftLogoIcon(aircraftInfo, rot, 50, verticalRate);
                        existingMarkerData.marker.setIcon(newIcon);
                    }
                } catch (e) {}
            } else {
                let icon;
                const track = p.heading || p.track || p.course || 0;
                const rot = (track - 90 + 360) % 360;
                
                try {
                    const aircraftInfo = {
                        manufacturer: p.manufacturer || p.airline || null,
                        typecode: p.aircraft_type || null
                    };
                    icon = window.createAircraftLogoIcon(aircraftInfo, rot, 50, verticalRate);
                } catch (e) {
                    let fallbackColor = '#ff3300';
                    if (verticalRate > 500) {
                        fallbackColor = '#00ff00';
                    } else if (verticalRate < -300) {
                        fallbackColor = '#ff0000';
                    }
                    icon = window.createAircraftIcon(fallbackColor, 50, rot);
                }

                const marker = L.marker([lat, lon], { icon, pane: 'livePane', zIndexOffset: 1000 });

                const tooltipHtml = window.buildHoverTooltipHTML(p);
                marker.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -10], sticky: true });
                marker.bindPopup(tooltipHtml);

                try {
                    const v = p.sqk || p.squawk || p.transponder || p.transponder_code || p.squawk_code || null;
                    if (v) { p.sqk = v; p.squawk = p.squawk || v; }
                    else if (window.lastSquawk.has(hex)) { const ls = window.lastSquawk.get(hex); if (ls) { p.sqk = ls; p.squawk = p.squawk || ls; } }
                } catch (e) {}
                try { window.lastPositions.set(hex, [[lat, lon]]); } catch (e) {}

                marker._posData = p;

                window.liveLayer.addLayer(marker);
                window.liveMarkers.set(hex, { marker, lastSeen: now, seenInUpdate: true });
            }
        });

        for (const [hex, markerData] of window.liveMarkers.entries()) {
            if (!markerData.seenInUpdate && (now - markerData.lastSeen > TIMEOUT_MS)) {
                try {
                    window.liveLayer.removeLayer(markerData.marker);
                    window.liveMarkers.delete(hex);
                    window.liveTrails.delete(hex);
                } catch (e) {
                    console.warn('Failed to remove timed out marker for', hex, e);
                }
            }
        }

        if (!window.map.hasLayer(window.liveLayer)) window.liveLayer.addTo(window.map);
        
    } catch (e) {
        console.error('Error updating live markers:', e);
    }
}

export function setTrackStatus(text, state) {
    const el = document.getElementById('track-fetch-status');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('status-ok', 'status-loading', 'status-error');
    if (state === 'ok') el.classList.add('status-ok');
    else if (state === 'loading') el.classList.add('status-loading');
    else if (state === 'error') el.classList.add('status-error');
}

export function formatOkWithTime(baseText) {
    try {
        const now = new Date();
        return `${baseText} — ${now.toLocaleTimeString()}`;
    } catch (e) {
        return baseText;
    }
}

export function nmToDegrees(nm) {
    return nm / 60;
}

export function computeBearing(lat1, lon1, lat2, lon2) {
    try {
        const toRad = v => v * Math.PI / 180;
        const toDeg = v => v * 180 / Math.PI;
        const φ1 = toRad(lat1);
        const φ2 = toRad(lat2);
        const Δλ = toRad(lon2 - lon1);
        const y = Math.sin(Δλ) * Math.cos(φ2);
        const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
        let θ = Math.atan2(y, x);
        θ = toDeg(θ);
        if (θ < 0) θ += 360;
        return Math.round(θ);
    } catch (e) { return null; }
}

export function centralAngleDeg(lat1, lon1, lat2, lon2) {
    const toRad = v => v * Math.PI / 180;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lon2 - lon1);
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return c * 180 / Math.PI;
}

export function interpolateGreatCircle(lat1, lon1, lat2, lon2, f) {
    const toRad = v => v * Math.PI / 180;
    const toDeg = v => v * 180 / Math.PI;
    const φ1 = toRad(lat1), λ1 = toRad(lon1);
    const φ2 = toRad(lat2), λ2 = toRad(lon2);

    const sinφ1 = Math.sin(φ1), cosφ1 = Math.cos(φ1);
    const sinφ2 = Math.sin(φ2), cosφ2 = Math.cos(φ2);

    const Δλ = λ2 - λ1;
    const cosΔλ = Math.cos(Δλ);
    const δ = Math.acos(Math.max(-1, Math.min(1, sinφ1 * sinφ2 + cosφ1 * cosφ2 * cosΔλ)));
    if (δ === 0) return [lat1, lon1];
    const sinδ = Math.sin(δ);
    const A = Math.sin((1 - f) * δ) / sinδ;
    const B = Math.sin(f * δ) / sinδ;

    const x = A * cosφ1 * Math.cos(λ1) + B * cosφ2 * Math.cos(λ2);
    const y = A * cosφ1 * Math.sin(λ1) + B * cosφ2 * Math.sin(λ2);
    const z = A * sinφ1 + B * sinφ2;

    const φi = Math.atan2(z, Math.sqrt(x * x + y * y));
    const λi = Math.atan2(y, x);
    return [toDeg(φi), toDeg(λi)];
}

export function densifyTrackPoints(points, maxDeg = 0.25) {
    if (!Array.isArray(points) || points.length < 2) return (points || []).map(p => [p.lat, p.lon]);
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i+1];
        if (!a || !b) continue;
        const lat1 = Number(a.lat), lon1 = Number(a.lon);
        const lat2 = Number(b.lat), lon2 = Number(b.lon);
        out.push([lat1, lon1]);
        const ang = centralAngleDeg(lat1, lon1, lat2, lon2);
        const steps = Math.max(1, Math.ceil(ang / maxDeg));
        for (let s = 1; s < steps; s++) {
            const f = s / steps;
            try {
                const ip = interpolateGreatCircle(lat1, lon1, lat2, lon2, f);
                out.push(ip);
            } catch (e) {
                const ilat = lat1 + (lat2 - lat1) * (s / steps);
                const ilon = lon1 + (lon2 - lon1) * (s / steps);
                out.push([ilat, ilon]);
            }
        }
    }
    const last = points[points.length - 1];
    out.push([Number(last.lat), Number(last.lon)]);
    return out;
}

export function maxTrackAngularChange(points) {
    try {
        if (!Array.isArray(points) || points.length < 3) return 0;
        const bearings = [];
        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i];
            const b = points[i+1];
            if (a == null || b == null) { bearings.push(null); continue; }
            const ba = computeBearing(a.lat, a.lon, b.lat, b.lon);
            bearings.push(typeof ba === 'number' ? ba : null);
        }

        let maxDelta = 0;
        for (let i = 0; i < bearings.length - 1; i++) {
            const b1 = bearings[i];
            const b2 = bearings[i+1];
            if (b1 == null || b2 == null) continue;
            let diff = Math.abs(b2 - b1) % 360;
            if (diff > 180) diff = 360 - diff;
            if (diff > maxDelta) maxDelta = diff;
        }
        return maxDelta;
    } catch (e) { return 0; }
}

export function getColorForIntensity(value, max, mode = 'intensity') {
    const scalingModeElem = document.getElementById('scaling-mode');
    const scalingMode = scalingModeElem ? scalingModeElem.value : 'linear';
    let normalized = 0;
    if (scalingMode === 'log') {
        normalized = Math.log(value + 1) / Math.log(max + 1);
    } else if (scalingMode === 'sqrt') {
        normalized = Math.sqrt(value) / Math.sqrt(max);
    } else if (scalingMode === 'power') {
        normalized = Math.pow(value, 1/2.2) / Math.pow(max, 1/2.2);
    } else {
        normalized = value / max;
    }
    if (mode === 'intensity') {
        if (normalized < 0.25) {
            return `rgb(0, 0, ${Math.floor(255 * (normalized / 0.25))})`;
        } else if (normalized < 0.5) {
            return `rgb(0, ${Math.floor(255 * ((normalized - 0.25) / 0.25))}, 255)`;
        } else if (normalized < 0.75) {
            return `rgb(0, 255, ${Math.floor(255 * (1 - (normalized - 0.5) / 0.25))})`;
        } else {
            return `rgb(${Math.floor(255 * ((normalized - 0.75) / 0.25))}, 255, 0)`;
        }
    } else if (mode === 'density') {
        const red = Math.floor(255 * normalized);
        return `rgb(${red}, 0, 0)`;
    }
    return 'rgb(100, 100, 100)';
}

export function setTimeWindowAndLoad(windowValue) {
    const select = document.getElementById('time-window');
    if (select) {
        const displayValue = windowValue === '30m' ? '1h' : windowValue;
        select.value = displayValue;
        loadGridData(windowValue === '30m' ? 0.5 : null);
    }
}

export async function loadGridData(hoursOverride = null) {
    try {
        showLoading(true);
        const timeWindow = document.getElementById('time-window').value;
        const startTime = Date.now();

        const urlParams = new URLSearchParams(window.location.search);
        const sourceParam = urlParams.get('source');
        const hoursParam = urlParams.get('hours');
        const gridSizeParam = urlParams.get('gridSizeNm');

        function windowToHours(w) {
            if (!w) return 24;
            if (w === 'all') return 744;
            if (w.endsWith('d')) {
                const days = parseInt(w.replace('d',''), 10);
                return isNaN(days) ? 24 : days * 24;
            }
            if (w.endsWith('w')) {
                const weeks = parseInt(w.replace('w',''), 10);
                return isNaN(weeks) ? 24 : weeks * 7 * 24;
            }
            if (w.endsWith('h')) {
                const hrs = parseInt(w.replace('h',''), 10);
                return isNaN(hrs) ? 24 : hrs;
            }
            if (w.endsWith('m')) {
                const mins = parseInt(w.replace('m',''), 10);
                return isNaN(mins) ? 24 : mins / 60;
            }
            return 24;
        }

        const hours = hoursOverride !== null ? hoursOverride : 
                     (hoursParam ? parseInt(hoursParam, 10) : windowToHours(timeWindow));
        
        const source = sourceParam || 'tsdb';

        const gridSizeControl = document.getElementById('grid-size');
        const gridSizeNm = gridSizeControl ? parseFloat(gridSizeControl.value) : 
                           (gridSizeParam ? parseFloat(gridSizeParam) : 1.0);

        const params = new URLSearchParams({
            hours: hours.toString(),
            source: source,
            gridSizeNm: gridSizeNm.toString()
        });
        const url = `/api/heatmap-data?${params.toString()}`;
        console.log(`Loading grid data with URL params: source=${source}, hours=${hours}, gridSizeNm=${gridSizeNm}; fetching ${url}`);

        const response = await fetchWithTimeout(url);
        if (!response.ok) throw new Error(`API error: ${response.status}`);

        const payload = await response.json();
        const gridData = Array.isArray(payload) ? payload : (payload.grid || []);
        const loadTime = Date.now() - startTime;
        console.log(`Received ${gridData.length} grid cells from API`);

        let totalPositions = 0;
        let minLat = Infinity, maxLat = -Infinity;
        let minLon = Infinity, maxLon = -Infinity;
        let maxCount = 0;

        gridData.forEach(cell => {
            if (cell.count > 0) {
                totalPositions += cell.count;
                maxCount = Math.max(maxCount, cell.count);
                minLat = Math.min(minLat, cell.lat_min);
                maxLat = Math.max(maxLat, cell.lat_max);
                minLon = Math.min(minLon, cell.lon_min);
                maxLon = Math.max(maxLon, cell.lon_max);
            }
        });

        window.currentData = {
            gridCells: gridData,
            totalPositions,
            maxCount,
            bounds: { minLat, maxLat, minLon, maxLon }
        };

        console.log(`Total positions calculated: ${totalPositions}, Max count: ${maxCount}, Cells with data: ${gridData.filter(c => c.count > 0).length}`);

        updateGridDisplay();

        document.getElementById('cell-count').textContent = gridData.filter(c => c.count > 0).length;
        document.getElementById('point-count').textContent = totalPositions.toLocaleString();
        document.getElementById('load-time').textContent = `${loadTime}ms`;
        document.getElementById('max-density').textContent = maxCount;
        
        const latSpan = (maxLat - minLat).toFixed(2);
        const lonSpan = (maxLon - minLon).toFixed(2);
        document.getElementById('coverage-area').textContent = 
            `${latSpan}° × ${lonSpan}° (${gridData.filter(c => c.count > 0).length} cells)`;

        document.getElementById('config-source').textContent = source;
        document.getElementById('config-hours').textContent = hours;
        document.getElementById('config-grid-size').textContent = gridSizeNm;

        showLoading(false);

    } catch (error) {
        showLoading(false);
        showError(`Failed to load grid data: ${error.message}`);
    }
}

export function updateGridDisplay() {
    if (!window.currentData || window.currentData.gridCells.length === 0) return;

    try {
        if (!window.gridLayer) window.gridLayer = L.layerGroup();
        window.gridLayer.clearLayers();
    } catch (e) {
        try { if (window.gridLayer) window.map.removeLayer(window.gridLayer); } catch(e) {}
    }

    const opacity = parseFloat(document.getElementById('opacity').value);
    const colorMode = document.getElementById('color-mode').value;
    const showBorders = document.getElementById('show-borders').checked;

    try { if (!window.gridLayer) window.gridLayer = L.layerGroup(); } catch(e) { window.gridLayer = L.layerGroup(); }

    window.currentData.gridCells.forEach(cell => {
        if (cell.count === 0) return;

        const bounds = [
            [cell.lat_min, cell.lon_min],
            [cell.lat_max, cell.lon_max]
        ];

        const color = getColorForIntensity(cell.count, window.currentData.maxCount, colorMode);

        const rectangle = L.rectangle(bounds, {
            pane: 'heatmapPane',
            color: showBorders ? '#333' : color,
            weight: showBorders ? 1 : 0,
            fillColor: color,
            fillOpacity: opacity,
            className: 'grid-cell'
        });

        rectangle.bindPopup(`
            <strong>Grid Cell</strong><br>
            Lat: ${cell.lat_min.toFixed(4)}° to ${cell.lat_max.toFixed(4)}°<br>
            Lon: ${cell.lon_min.toFixed(4)}° to ${cell.lon_max.toFixed(4)}°<br>
            <strong>Positions: ${cell.count}</strong>
        `);

        window.gridLayer.addLayer(rectangle);
    });

    try { if (!window.map.hasLayer(window.gridLayer)) window.gridLayer.addTo(window.map); } catch(e) {}

    try { window.heatmapOverlaysReady = true; window.dispatchEvent(new Event('heatmap-overlays-ready')); } catch (e) { console.warn('Failed to dispatch heatmap-overlays-ready event', e); }

    try {
        window.map.on('overlayadd', () => { window.saveSettings(); });
        window.map.on('overlayremove', () => { window.saveSettings(); });
        window.map.on('baselayerchange', () => { window.saveSettings(); });
    } catch (e) { console.warn('Failed to register layer change persistence', e); }

    try {
        if (!window.liveIntervalId) {
            window.toggleLivePositions();
        }
    } catch (e) {
        console.warn('Auto-start live after grid load failed', e);
    }
    try {
        window.fetchLivePositions();
    } catch (e) {
        console.warn('One-time fetch of live positions failed', e);
    }

    if (window.currentData.bounds.minLat !== Infinity) {
        window.map.fitBounds([
            [window.currentData.bounds.minLat, window.currentData.bounds.minLon],
            [window.currentData.bounds.maxLat, window.currentData.bounds.maxLon]
        ]);
    }
    try {
        if (!window._heatmapSettingsApplied) {
            window.loadSettings();
            window._heatmapSettingsApplied = true;
        }
    } catch (e) { /* ignore */ }
}

export async function resetMap() {
    try {
        const [configResponse, receiverResponse] = await Promise.all([
            fetch('/api/config'),
            fetch('/api/receiver-location')
        ]);

        const config = await configResponse.json();
        const receiver = await receiverResponse.json();

        let centerLat, centerLon, zoomLevel;

        if (config.heatmap && config.heatmap.mapCenter && config.heatmap.mapCenter.enabled) {
            centerLat = config.heatmap.mapCenter.lat;
            centerLon = config.heatmap.mapCenter.lon;
            zoomLevel = config.heatmap.mapCenter.zoom;
        } else if (receiver.available) {
            centerLat = receiver.lat;
            centerLon = receiver.lon;
            zoomLevel = 8;
        } else {
            centerLat = 39.5;
            centerLon = -98.0;
            zoomLevel = 4;
        }

        window.map.setView([centerLat, centerLon], zoomLevel);
    } catch (error) {
        console.error('Failed to reset map:', error);
        window.map.setView([39.5, -98.0], 4);
    }
}

export function toggleLegend() {
    const legend = document.getElementById('legend');
    legend.style.display = legend.style.display === 'none' ? 'block' : 'none';
}

export function initializeConfigDisplay() {
    const urlParams = new URLSearchParams(window.location.search);
    const source = urlParams.get('source') || 'tsdb';
    const hours = urlParams.get('hours') || '24';
    const gridSizeNm = urlParams.get('gridSizeNm') || '1.0';

    document.getElementById('config-source').textContent = source;
    document.getElementById('config-hours').textContent = hours;
    document.getElementById('config-grid-size').textContent = gridSizeNm;
}
