// --- Reception Tab Loader ---

// --- Day/Night helper functions (global) ---
const _daynight_rad = Math.PI / 180;
const _daynight_J2000 = 2451545;
function _toJulian(date) { return (date.getTime() / 86400000) + 2440587.5; }
function _fromJulian(j) { return new Date((j - 2440587.5) * 86400000); }
function _solarMeanAnomaly(d) { return _daynight_rad * (357.5291 + 0.98560028 * d); }
function _eclipticLongitude(M) {
    const C = _daynight_rad * (1.9148 * Math.sin(M) + 0.0200 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const P = _daynight_rad * 102.9372;
    return M + C + P + Math.PI;
}

function getSunriseSunsetForDate(lat, lon, date) {
    // Compute approximate sunrise/sunset (UTC ms) for the UTC calendar day containing `date`.
    const midnightUtc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const jd = _toJulian(midnightUtc);
    const d = jd - _daynight_J2000;
    const M = _solarMeanAnomaly(d);
    const L = _eclipticLongitude(M);
    const dec = Math.asin(Math.sin(L) * Math.sin(_daynight_rad * 23.4397));
    const Jtransit = _daynight_J2000 + d + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L) - (lon / 360);
    const latRad = lat * _daynight_rad;
    const cosw0 = (Math.sin(-0.83 * _daynight_rad) - Math.sin(latRad) * Math.sin(dec)) / (Math.cos(latRad) * Math.cos(dec));
    if (cosw0 > 1) return { sunrise: null, sunset: null, alwaysNight: true, alwaysDay: false };
    if (cosw0 < -1) return { sunrise: null, sunset: null, alwaysNight: false, alwaysDay: true };
    const w0 = Math.acos(cosw0);
    const Jrise = Jtransit - w0 / (2 * Math.PI);
    const Jset = Jtransit + w0 / (2 * Math.PI);
    return { sunrise: _fromJulian(Jrise).getTime(), sunset: _fromJulian(Jset).getTime(), alwaysNight: false, alwaysDay: false };
}

function getChartLatLon() {
    try {
        const el = document.getElementById('receiver-coords');
        if (el && el.innerText) {
            const m = el.innerText.match(/Lat:\s*([\-0-9.]+)[^0-9\-]+Lon:\s*([\-0-9.]+)/i);
            if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
        }
    } catch (e) {}
    try {
        if (typeof positionDataSources !== 'undefined' && positionDataSources.receiverLat && positionDataSources.receiverLon) {
            return { lat: positionDataSources.receiverLat, lon: positionDataSources.receiverLon };
        }
    } catch (e) {}
    return null;
}

function computeNightIntervals(startMs, endMs, lat, lon) {
    const intervals = [];
    const startDay = new Date(startMs);
    startDay.setUTCHours(0, 0, 0, 0);
    for (let d = new Date(startDay.getTime()); d.getTime() <= endMs; d.setUTCDate(d.getUTCDate() + 1)) {
        const { sunrise, sunset, alwaysNight, alwaysDay } = getSunriseSunsetForDate(lat, lon, d);
        const dayStart = d.getTime();
        const dayEnd = dayStart + (24 * 60 * 60 * 1000) - 1;
        if (alwaysNight) {
            intervals.push({ start: Math.max(dayStart, startMs), end: Math.min(dayEnd, endMs) });
        } else if (alwaysDay) {
            // nothing
        } else {
            if (sunrise !== null) {
                const s = Math.max(dayStart, startMs);
                const e = Math.min(sunrise, endMs);
                if (e > s) intervals.push({ start: s, end: e });
            }
            if (sunset !== null) {
                const s = Math.max(sunset, startMs);
                const e = Math.min(dayEnd, endMs);
                if (e > s) intervals.push({ start: s, end: e });
            }
        }
    }
    return intervals;
}

// Compute sun altitude (degrees) at a given UTC ms for latitude/longitude
function sunAltitudeAtMs(lat, lon, ms) {
    try {
        const date = new Date(ms);
        const jd = _toJulian(date);
        const d = jd - _daynight_J2000;
        const M = _solarMeanAnomaly(d);
        const L = _eclipticLongitude(M);
        const dec = Math.asin(Math.sin(L) * Math.sin(_daynight_rad * 23.4397));
        const Jtransit = _daynight_J2000 + d + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L) - (lon / 360);
        const H = 2 * Math.PI * (jd - Jtransit);
        const latRad = lat * _daynight_rad;
        const altitude = Math.asin(Math.sin(latRad) * Math.sin(dec) + Math.cos(latRad) * Math.cos(dec) * Math.cos(H));
        return altitude / _daynight_rad;
    } catch (e) {
        return null;
    }
}

// Find time (ms) between leftMs and rightMs where sun altitude crosses targetAltDeg.
// Returns null if no crossing found. Assumes altitude is monotonic between bounds (reasonable for small intervals).
function findCrossingTimeForAltitude(lat, lon, targetAltDeg, leftMs, rightMs) {
    const aLeft = sunAltitudeAtMs(lat, lon, leftMs);
    const aRight = sunAltitudeAtMs(lat, lon, rightMs);
    if (aLeft === null || aRight === null) return null;
    // If both sides are on the same side of target, no crossing
    if ((aLeft < targetAltDeg && aRight < targetAltDeg) || (aLeft > targetAltDeg && aRight > targetAltDeg)) return null;

    let lo = leftMs, hi = rightMs;
    for (let i = 0; i < 60 && (hi - lo) > 60000; i++) { // iterate until ~1 minute precision
        const mid = Math.floor((lo + hi) / 2);
        const aMid = sunAltitudeAtMs(lat, lon, mid);
        if (aMid === null) break;
        if ((aLeft <= targetAltDeg && aMid >= targetAltDeg) || (aLeft >= targetAltDeg && aMid <= targetAltDeg)) {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    return Math.floor((lo + hi) / 2);
}

function drawDayNightBackground(ctx, startMs, endMs, padding, chartW, chartH) {
    const coords = getChartLatLon();
    ctx.save();
    // subtle day background
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(padding.left, padding.top, chartW, chartH);
    if (!coords) { ctx.restore(); return; }
    // Draw night and twilight bands per-day using altitude-based twilight times
    const total = endMs - startMs;
    if (total <= 0) { ctx.restore(); return; }

    const dayColor = '#f2f2f2';
    const nightColor = '#000';
    const twilightTargetDeg = -6; // civil twilight

    // iterate through calendar days overlapping the requested range
    const startDay = new Date(startMs);
    startDay.setUTCHours(0, 0, 0, 0);
    for (let d = new Date(startDay.getTime()); d.getTime() <= endMs; d.setUTCDate(d.getUTCDate() + 1)) {
        const dayStart = d.getTime();
        const dayEnd = dayStart + (24 * 60 * 60 * 1000) - 1;
        const { sunrise, sunset, alwaysNight, alwaysDay } = getSunriseSunsetForDate(coords.lat, coords.lon, d);

        const clampToRange = (s, e) => {
            const s2 = Math.max(s, startMs);
            const e2 = Math.min(e, endMs);
            return (e2 > s2) ? { s: s2, e: e2 } : null;
        };

        if (alwaysNight) {
            const band = clampToRange(dayStart, dayEnd);
            if (band) {
                const x1 = padding.left + ((band.s - startMs) / total) * chartW;
                const x2 = padding.left + ((band.e - startMs) / total) * chartW;
                ctx.fillStyle = nightColor;
                ctx.fillRect(x1, padding.top, x2 - x1, chartH);
            }
            continue;
        }
        if (alwaysDay) continue;

        // Dawn: find time when sun altitude crosses twilightTargetDeg before sunrise
        if (sunrise) {
            const dawnCross = findCrossingTimeForAltitude(coords.lat, coords.lon, twilightTargetDeg, Math.max(dayStart, sunrise - 12 * 60 * 60 * 1000), sunrise);
            const dawnStart = dawnCross || Math.max(dayStart, sunrise - 30 * 60 * 1000);
            const dawnEnd = sunrise;
            const band = clampToRange(dawnStart, dawnEnd);
            if (band) {
                const x1 = padding.left + ((band.s - startMs) / total) * chartW;
                const x2 = padding.left + ((band.e - startMs) / total) * chartW;
                const g = ctx.createLinearGradient(x1, 0, x2, 0);
                g.addColorStop(0, nightColor);
                g.addColorStop(1, dayColor);
                ctx.fillStyle = g;
                ctx.fillRect(x1, padding.top, Math.max(1, x2 - x1), chartH);
            }
            const nightBefore = clampToRange(dayStart, dawnStart);
            if (nightBefore) {
                const x1 = padding.left + ((nightBefore.s - startMs) / total) * chartW;
                const x2 = padding.left + ((nightBefore.e - startMs) / total) * chartW;
                ctx.fillStyle = nightColor;
                ctx.fillRect(x1, padding.top, x2 - x1, chartH);
            }
        }

        // Dusk: find time when sun altitude crosses twilightTargetDeg after sunset
        if (sunset) {
            const duskCross = findCrossingTimeForAltitude(coords.lat, coords.lon, twilightTargetDeg, sunset, Math.min(dayEnd, sunset + 12 * 60 * 60 * 1000));
            const duskEnd = duskCross || Math.min(dayEnd, sunset + 30 * 60 * 1000);
            const duskStart = sunset;
            const band = clampToRange(duskStart, duskEnd);
            if (band) {
                const x1 = padding.left + ((band.s - startMs) / total) * chartW;
                const x2 = padding.left + ((band.e - startMs) / total) * chartW;
                const g = ctx.createLinearGradient(x1, 0, x2, 0);
                g.addColorStop(0, dayColor);
                g.addColorStop(1, nightColor);
                ctx.fillStyle = g;
                ctx.fillRect(x1, padding.top, Math.max(1, x2 - x1), chartH);
            }
            const nightAfter = clampToRange(duskEnd, dayEnd);
            if (nightAfter) {
                const x1 = padding.left + ((nightAfter.s - startMs) / total) * chartW;
                const x2 = padding.left + ((nightAfter.e - startMs) / total) * chartW;
                ctx.fillStyle = nightColor;
                ctx.fillRect(x1, padding.top, x2 - x1, chartH);
            }
        }
    }
    ctx.restore();
}
async function loadReceptionRange(hoursBack = null) {
    try {
    try { showSpinnerForTab('reception'); } catch (e) {}
        const startElem = document.getElementById('reception-start-time') || document.getElementById('positions-start-time');
        const endElem = document.getElementById('reception-end-time') || document.getElementById('positions-end-time');
        
        // Helper function to format timestamp as local datetime string
        const formatLocalDateTime = (timestamp) => {
            const d = new Date(timestamp);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const minutes = String(d.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        };
        
        let hours = 24; // default
        let isCustomRange = false;
        let startTime, endTime;
        
        // If hoursBack is provided, use it (from quick buttons)
        if (hoursBack !== null) {
            const now = new Date();
            endTime = now.getTime();
            startTime = endTime - (hoursBack * 60 * 60 * 1000);
            
            // Update input fields
            startElem.value = formatLocalDateTime(startTime);
            endElem.value = formatLocalDateTime(endTime);
            
            hours = hoursBack;
            try { setActivePositionButton(hours); } catch (e) {}
        }
        // Use custom times if set
        else if (startElem && startElem.value && endElem && endElem.value) {
            // Calculate hours difference for window parameter
            const parseLocalDateTime = (localDateTimeStr) => {
                const parts = localDateTimeStr.split('T');
                const [year, month, day] = parts[0].split('-');
                const [hours, minutes] = parts[1].split(':');
                return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
            };
            
            startTime = parseLocalDateTime(startElem.value);
            let _endTime = parseLocalDateTime(endElem.value);
            
            // Auto-update end time if it's recent
            const now = Date.now();
            const twoMinutesAgo = now - (2 * 60 * 1000);
            if (_endTime >= twoMinutesAgo) {
                endTime = now;
                endElem.value = formatLocalDateTime(endTime);
            }
            
            // ensure endTime variable set for historical end time
            if (typeof endTime === 'undefined') endTime = _endTime;
            hours = Math.ceil((endTime - startTime) / (60 * 60 * 1000));
            isCustomRange = true;
        }
        // Default to last 24 hours
        else {
            const now = new Date();
            const endTime = now.getTime();
            const startTime = endTime - (24 * 60 * 60 * 1000);
            
            startElem.value = formatLocalDateTime(startTime);
            endElem.value = formatLocalDateTime(endTime);
            
            hours = 24;
        }
        
        const response = await fetch(`/api/reception-range?hours=${hours}`);
        const data = await response.json();
        
        const summaryDiv = document.getElementById('reception-summary');
        const receiverInfoDiv = document.getElementById('receiver-coords');
        
        const sectors = data.sectors || {};
        const maxRange = data.maxRange || 0;
        const positionCount = data.positionCount || 0;
        const receiverLat = data.receiverLat;
        const receiverLon = data.receiverLon;
        
        // Display receiver coordinates
        if (typeof receiverLat === 'number' && typeof receiverLon === 'number') {
            receiverInfoDiv.innerHTML = `Lat: <strong>${receiverLat.toFixed(6)}</strong>, Lon: <strong>${receiverLon.toFixed(6)}</strong>`;
        } else {
            receiverInfoDiv.innerHTML = `Lat: N/A, Lon: N/A`;
        }
        
        try {
            const summaryDiv = document.getElementById('reception-summary');
            if (summaryDiv) {
                try {
                    const summaryHtml = `<strong>Max Range:</strong> ${maxRange.toFixed(2)} nm | <strong>Positions:</strong> ${positionCount.toLocaleString()} | <strong>Sector/Altitude Cells:</strong> ${Object.keys(sectors).length}`;
                    summaryDiv.dataset._previousHtml = summaryHtml;
                    if (isCustomRange && typeof startTime !== 'undefined' && typeof endTime !== 'undefined') {
                        summaryDiv.dataset.filterCriteria = `Range: ${formatLocalDateTime(startTime)} → ${formatLocalDateTime(endTime)}`;
                    } else {
                        summaryDiv.dataset.filterCriteria = `Window: ${hours}h`;
                    }
                } catch (e) {}
            }
        } catch (e) {}
        try { setComputedRangeUI('reception', startTime, endTime, isCustomRange); } catch (e) {}
        try { hideSpinnerForTab('reception'); } catch (e) {}
        
        // Sort sectors by bearing, then altitude band
        const sortedSectors = Object.entries(sectors)
            .map(([key, sector]) => ({ key, ...sector }))
            .sort((a, b) => {
                if (a.bearing !== b.bearing) return a.bearing - b.bearing;
                return a.altBand - b.altBand;
            });
        
        // Aggregate by bearing (ignore altitude)
        // Initialize all bearings from 0 to 345 (15° increments) to ensure full coverage
        const bearingData = {};
        for (let bearing = 0; bearing < 360; bearing += 15) {
            bearingData[bearing] = { maxRange: 0, count: 0 };
        }
        sortedSectors.forEach(sector => {
            if (!bearingData[sector.bearing]) {
                bearingData[sector.bearing] = { maxRange: 0, count: 0 };
            }
            bearingData[sector.bearing].maxRange = Math.max(bearingData[sector.bearing].maxRange, sector.maxRange);
            bearingData[sector.bearing].count += sector.count;
        });
        
        // Aggregate by altitude (ignore bearing)
        const altitudeData = {};
        sortedSectors.forEach(sector => {
            if (!altitudeData[sector.altBand]) {
                altitudeData[sector.altBand] = { maxRange: 0, count: 0 };
            }
            altitudeData[sector.altBand].maxRange = Math.max(altitudeData[sector.altBand].maxRange, sector.maxRange);
            altitudeData[sector.altBand].count += sector.count;
        });
        
        // Draw bearing vs range chart (polar-like)
        drawBearingChart(bearingData, maxRange);
        
        // Draw altitude vs range chart (bar)
        drawAltitudeChart(altitudeData, maxRange);
        
        // Draw 3D plot
        draw3DReceptionPlot(sortedSectors);
    } catch (error) {
        console.error('Error loading reception range:', error);
        try { hideSpinnerForTab('reception', `<span style="color:#f44336;">Error loading reception</span>`); } catch (e) {}
    }
}

function drawBearingChart(bearingData, maxRange) {
    const canvas = document.getElementById('reception-bearing-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const maxRadius = Math.min(canvas.width, canvas.height) / 2 - 40;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw background circles at 25nm intervals
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    const ringInterval = 25; // nm
    const numRings = Math.ceil(maxRange / ringInterval);
    for (let r = 1; r <= numRings; r++) {
        const rangeNm = r * ringInterval;
        const radius = (rangeNm / maxRange) * maxRadius;
        if (radius <= maxRadius) {
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
            ctx.stroke();
        }
    }
    
    // Draw compass directions
    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', centerX, centerY - maxRadius - 15);
    ctx.fillText('S', centerX, centerY + maxRadius + 15);
    ctx.fillText('E', centerX + maxRadius + 15, centerY);
    ctx.fillText('W', centerX - maxRadius - 15, centerY);
    
    // Draw bearing data as bars radiating from center
    const bearings = Object.keys(bearingData).map(Number).sort((a, b) => a - b);
    bearings.forEach(bearing => {
        const range = bearingData[bearing].maxRange;
        const radius = (range / maxRange) * maxRadius;
        
        // Convert bearing to radians (0° = North, increases clockwise)
        const angle = (bearing - 90) * Math.PI / 180; // Convert to standard angle
        const nextAngle = (bearing + 15 - 90) * Math.PI / 180;
        
        const x1 = centerX + Math.cos(angle) * radius;
        const y1 = centerY + Math.sin(angle) * radius;
        const x2 = centerX + Math.cos(nextAngle) * radius;
        const y2 = centerY + Math.sin(nextAngle) * radius;
        
        // Draw sector fill
        ctx.fillStyle = `hsla(${bearing}, 70%, 50%, 0.6)`;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(x1, y1);
        ctx.arc(centerX, centerY, radius, angle, nextAngle);
        ctx.fill();
        
        // Draw outline
        ctx.strokeStyle = `hsl(${bearing}, 70%, 50%)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(x1, y1);
        ctx.stroke();
    });
    
    // Draw center marker
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 4, 0, 2 * Math.PI);
    ctx.fill();
    
    // Draw range scale labels at 25nm intervals
    ctx.fillStyle = '#bbb';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let r = 1; r <= numRings; r++) {
        const rangeNm = r * ringInterval;
        const radius = (rangeNm / maxRange) * maxRadius;
        if (radius <= maxRadius) {
            ctx.fillText(rangeNm + ' nm', centerX + radius - 5, centerY - 5);
        }
    }
}

function drawAltitudeChart(altitudeData, maxRange) {
    const canvas = document.getElementById('reception-altitude-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const altitudes = Object.keys(altitudeData).map(Number).sort((a, b) => a - b);
    if (altitudes.length === 0) return;
    
    const padLeft = 50, padRight = 20, padTop = 20, padBottom = 60;
    const chartWidth = canvas.width - padLeft - padRight;
    const chartHeight = canvas.height - padTop - padBottom;
    const barWidth = chartWidth / altitudes.length;
    
    // Draw axes
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop);
    ctx.lineTo(padLeft, canvas.height - padBottom);
    ctx.lineTo(canvas.width - padRight, canvas.height - padBottom);
    ctx.stroke();
    
    // Draw grid lines and labels
    ctx.strokeStyle = '#ddd';
    ctx.fillStyle = '#666';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    
    for (let i = 0; i <= 5; i++) {
        const y = canvas.height - padBottom - (chartHeight / 5) * i;
        const value = (maxRange / 5) * i;
        
        // Grid line
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(canvas.width - padRight, y);
        ctx.stroke();
        
        // Y-axis label
        ctx.textAlign = 'right';
        ctx.fillText(value.toFixed(0), padLeft - 10, y + 4);
    }
    
    // Draw bars
    altitudes.forEach((alt, idx) => {
        const data = altitudeData[alt];
        const barHeight = (data.maxRange / maxRange) * chartHeight;
        const x = padLeft + idx * barWidth + barWidth / 2;
        const y = canvas.height - padBottom - barHeight;
        
        // Bar
        ctx.fillStyle = `hsl(${120 - (alt / 50000) * 120}, 70%, 50%)`;
        ctx.fillRect(x - barWidth / 2 + 2, y, barWidth - 4, barHeight);
        
        // X-axis label
        ctx.fillStyle = '#666';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const label = `${alt.toLocaleString()}-${(alt + 1000).toLocaleString()}`;
        ctx.save();
        ctx.translate(x, canvas.height - padBottom + 10);
        ctx.rotate(-Math.PI / 4);
        ctx.fillText(label, 0, 0);
        ctx.restore();
    });
    
    // Y-axis label
    ctx.fillStyle = '#666';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.save();
    ctx.translate(15, canvas.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Range (nm)', 0, 0);
    ctx.restore();
    
    // X-axis label
    ctx.fillStyle = '#666';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Altitude Band (ft)', canvas.width / 2, canvas.height - 15);
}

function draw3DReceptionPlot(sectors) {
    const container = document.getElementById('reception-3d-plot');
    if (!container) return;
    
    // Altitude zone colors matching aircraft_tracker.py
    const altitudeZoneColors = [
        '#FF0000',  // Red - 0-4999 ft
        '#FFFF00',  // Yellow - 5000-9999 ft
        '#00FF00',  // Green - 10000-14999 ft
        '#0000FF',  // Blue - 15000-19999 ft
        '#FF00FF',  // Magenta - 20000-24999 ft
        '#00FFFF',  // Cyan - 25000-29999 ft
        '#FFA500',  // Orange - 30000-34999 ft
        '#0066FF',  // Deep sky blue - 35000-39999 ft
        '#8000FF',  // Purple - 40000+ ft
    ];
    
    // Convert polar coordinates (bearing, distance) to Cartesian (x, y)
    // and prepare 3D scatter data
    const x = [];  // East-West distance (nm)
    const y = [];  // North-South distance (nm)
    const z = [];  // Altitude (thousands of feet)
    const color = [];  // Color by altitude zone
    const text = [];  // Hover text
    
    const maxDist = Math.max(...sectors.map(s => s.maxRange));
    const maxAlt = Math.max(...sectors.map(s => s.altBand)) / 1000;
    
    sectors.forEach(sector => {
        // Convert bearing to radians (0°=N, 90°=E, 180°=S, 270°=W)
        const bearingRad = (sector.bearing * Math.PI) / 180;
        const distance = sector.maxRange;
        const altitude = sector.altBand / 1000;  // Convert to thousands of feet
        
        // Convert to Cartesian coordinates (East is +X, North is +Y)
        // Negative X to get correct East/West orientation
        const x_coord = -distance * Math.sin(bearingRad);
        const y_coord = distance * Math.cos(bearingRad);
        
        x.push(x_coord);
        y.push(y_coord);
        z.push(altitude);
        
        // Get color based on altitude zone
        const colorIdx = Math.min(sector.altBand / 1000 / 5, altitudeZoneColors.length - 1);
        const zoneColor = altitudeZoneColors[Math.floor(colorIdx)];
        color.push(zoneColor);
        
        // Create hover text with all details
        const bearingRange = `${sector.bearing.toFixed(1)}°-${(sector.bearing + 15).toFixed(1)}°`;
        const altRange = `${sector.altBand.toLocaleString()}-${(sector.altBand + 1000).toLocaleString()} ft`;
        text.push(
            `<b>Bearing:</b> ${bearingRange}<br>` +
            `<b>Altitude:</b> ${altRange}<br>` +
            `<b>Range:</b> ${sector.maxRange.toFixed(2)} nm<br>` +
            `<b>Positions:</b> ${sector.count}`
        );
    });
    
    // Create 3D scatter trace
    const trace = {
        x: x,
        y: y,
        z: z,
        mode: 'markers',
        marker: {
            size: 10,
            color: color,
            opacity: 0.8,
            line: {
                width: 1,
                color: '#fff'
            }
        },
        text: text,
        hovertemplate: '%{text}<extra></extra>',
        type: 'scatter3d'
    };


    // Create a surface trace at z=0 to act as an outline
    const surfaceTrace = {
        x: x,
        y: y,
        z: x.map(() => 0), // Set all z-coordinates to 0
        mode: 'lines',
        type: 'scatter3d',
        opacity: 0.8,
        line: {
            width: 4,
            color: '#333'
        },
        hoverinfo: 'none'
    };
    
    // Add receiver point at origin
    const receiverTrace = {
        x: [0],
        y: [0],
        z: [0],
        mode: 'markers',
        marker: {
            size: 15,
            color: '#FF0000',
            symbol: 'diamond',
            line: {
                width: 2,
                color: '#fff'
            }
        },
        name: 'Receiver',
        hovertemplate: '<b>Receiver</b><br>Position: (0, 0, 0)<extra></extra>',
        type: 'scatter3d'
    };
    
    const layout = {
        title: {
            text: 'PiAware Reception Coverage - 3D Visualization<br><sub>Bearing × Altitude × Range (Cartesian Projection)</sub>',
            font: { size: 16 }
        },
        scene: {
            xaxis: {
                title: 'West-East Distance (nm)',
                gridcolor: '#ccc',
                zerolinecolor: '#999'
            },
            yaxis: {
                title: 'North-South Distance (nm)',
                gridcolor: '#ccc',
                zerolinecolor: '#999'
            },
            zaxis: {
                title: 'Altitude (1000 ft)',
                gridcolor: '#ccc',
                zerolinecolor: '#999',
                range: [0, Math.max(maxAlt * 1.1, 50)]
            },
            camera: {
                eye: { x: 1.5, y: 1.5, z: 1.3 }
            },
            aspectmode: 'manual',
            aspectratio: { x: 1, y: 1, z: 0.4 }
        },
        margin: {
            l: 0,
            r: 0,
            t: 60,
            b: 0
        },
        height: 600,
        showlegend: true,
        hovermode: 'closest',
        paper_bgcolor: '#f8f9fa',
        plot_bgcolor: '#fff'
    };
    
    // Add legend items for altitude zones
    const legendTraces = [];
    for (let i = 0; i < Math.min(9, altitudeZoneColors.length); i++) {
        const altMin = i * 5000;
        const altMax = (i + 1) * 5000 - 1;
        
        legendTraces.push({
            x: [null],
            y: [null],
            z: [null],
            mode: 'markers',
            marker: {
                size: 8,
                color: altitudeZoneColors[i]
            },
            name: `${altMin.toLocaleString()}-${altMax.toLocaleString()} ft`,
            type: 'scatter3d',
            hoverinfo: 'none'
        });
    }
    
    const allTraces = [trace, surfaceTrace, receiverTrace, ...legendTraces];
    
    Plotly.newPlot(container, allTraces, layout, { responsive: true });
}

const socket = io('http://localhost:3003');
const LIVE_FUSION_WINDOW_MS = 3000; // Keep a short window of observations for front-end fusion
const LIVE_REFRESH_DELAY_MS = 1000;
const liveAircraftObservations = [];
let liveTableTimer = null;
let liveTablePending = false;

function addLiveUpdateToBuffer(data) {
    const timestamp = Date.now();
    const aircraft = Array.isArray(data && data.aircraft) ? data.aircraft.slice() : [];
    liveAircraftObservations.push({ timestamp, aircraft });
    const cutoff = timestamp - LIVE_FUSION_WINDOW_MS;
    while (liveAircraftObservations.length > 0 && liveAircraftObservations[0].timestamp < cutoff) {
        liveAircraftObservations.shift();
    }
}

function getFusedAircraftSnapshot() {
    const fusedMap = new Map();
    liveAircraftObservations.forEach(entry => {
        const list = Array.isArray(entry.aircraft) ? entry.aircraft : [];
        list.forEach(ac => {
            if (!ac || !ac.hex) return;
            const existing = fusedMap.get(ac.hex);
            if (!existing || entry.timestamp >= existing.ts) {
                fusedMap.set(ac.hex, { ac, ts: entry.timestamp });
            }
        });
    });
    return Array.from(fusedMap.values()).map(item => item.ac);
}

function isLiveTabActive() {
    const liveTab = document.getElementById('live-tab');
    return liveTab && liveTab.classList.contains('active');
}

function updateLiveTableIfNeeded() {
    liveTablePending = false;
    if (!isLiveTabActive()) {
        liveTablePending = true;
        return;
    }
    const fusedAircraft = getFusedAircraftSnapshot();
    updateAircraftTable(fusedAircraft);
}

function scheduleLiveTableUpdate() {
    if (liveTableTimer) {
        clearTimeout(liveTableTimer);
    }
    liveTableTimer = setTimeout(() => {
        liveTableTimer = null;
        updateLiveTableIfNeeded();
    }, LIVE_REFRESH_DELAY_MS);
}

// --- Server Restart Function ---
function restartServer() {
    if (confirm('Are you sure you want to restart the server? This will disconnect all clients briefly.')) {
        fetch('/api/restart', { method: 'POST' })
            .then(response => response.json())
            .then(data => {
                alert(data.message || 'Server restart initiated');
                setTimeout(() => {
                    location.reload();
                }, 3000);
            })
            .catch(error => {
                console.error('Restart error:', error);
                alert('Failed to restart server');
            });
    }
}

// --- Helper Functions ---
function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Never';
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (seconds < 10) return 'Now';
    if (seconds < 60) return `${seconds}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

// --- Tab Management ---
function showTab(tabName, event) {
    try { /* flights-specific detach removed; global handler manages custom ranges */ } catch (e) {}
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`${tabName}-tab`).classList.add('active');
    if (event && event.target) {
        event.target.classList.add('active');
    }

    if (tabName === 'airlines') {
        loadAirlineStats();
    }
    if (tabName === 'positions') {
        loadPositionStatsLive();
        loadPositionStats();
        loadHistoricalStats();
    }
    if (tabName === 'flights') {
        loadFlights();
    }
    if (tabName === 'squawk') {
        loadSquawkTransitions();
    }
    if (tabName === 'heatmap') {
        loadHeatmap();
    }
    if (tabName === 'reception') {
        loadReceptionRange();
    }
    if (tabName === 'cache') {
        loadCacheStatus();
    }
    // Hide global time controls for tabs that do not use time ranges
    try {
        const globalControl = document.getElementById('global-time-controls');
        if (globalControl) {
            // Live tab does not have a time-window control
            const visibleTabs = ['airlines','positions','flights','squawk','heatmap','reception'];
            if (visibleTabs.includes(tabName)) globalControl.style.display = 'block'; else globalControl.style.display = 'none';
        }
        // Hide the top `time-window` select when on Flights tab (Flights uses its own inputs)
        try {
            const timeSelect = document.getElementById('time-window');
            if (timeSelect) {
                // Hide the top select on Flights and Positions (they have their own controls)
                if (tabName === 'flights' || tabName === 'positions') timeSelect.style.display = 'none'; else timeSelect.style.display = '';
            }
        } catch (e) {}
    } catch (e) {}
    if (tabName === 'live' && liveTablePending) {
        if (liveTableTimer) {
            clearTimeout(liveTableTimer);
            liveTableTimer = null;
        }
        updateLiveTableIfNeeded();
    }
}

// Attach change/enter listeners to flights custom range inputs so that
// exiting the custom time control triggers an automatic refresh of flights.
// Deprecated: per-tab flights-specific listener removed in favor of global listeners

// Deprecated: detachFlightsCustomRangeListeners removed in favor of global listener

async function loadHistoricalStats() {
    try {
        const startTime = document.getElementById('historical-start-time')?.value || '';
        const endTime = document.getElementById('historical-end-time')?.value || '';

        let url = '/api/historical-stats';
        if (startTime && endTime) {
            url += `?startTime=${new Date(startTime).getTime()}&endTime=${new Date(endTime).getTime()}`;
        }

        const response = await fetch(url);
        const data = await response.json();
        drawHistoricalStatsChart(data);
    } catch (error) {
        console.error('Error loading historical stats:', error);
    }
}

function drawHistoricalStatsChart(data) {
    const chartContainer = document.getElementById('historical-stats-chart-container');
    if (!chartContainer) return;

    const allData = [
        {
            x: data.timeSeries.map(d => new Date(d.timestamp)),
            y: data.timeSeries.map(d => d.positions),
            name: 'Positions',
            type: 'scatter',
            mode: 'lines+markers'
        },
        {
            x: data.timeSeries.map(d => new Date(d.timestamp)),
            y: data.timeSeries.map(d => d.aircraft),
            name: 'Aircraft',
            type: 'scatter',
            mode: 'lines+markers'
        },
        {
            x: data.timeSeries.map(d => new Date(d.timestamp)),
            y: data.timeSeries.map(d => d.airlines),
            name: 'Airlines',
            type: 'scatter',
            mode: 'lines+markers'
        },
        {
            x: data.timeSeries.map(d => new Date(d.timestamp)),
            y: data.timeSeries.map(d => d.flights),
            name: 'Flights',
            type: 'scatter',
            mode: 'lines+markers'
        }
    ];

    const selectedMetrics = Array.from(document.querySelectorAll('#historical-chart-controls input:checked')).map(cb => cb.value);

    const traces = allData.filter(trace => selectedMetrics.includes(trace.name.toLowerCase()));

    const layout = {
        title: '7-Day Historical Data',
        xaxis: {
            title: 'Time'
        },
        yaxis: {
            title: 'Count'
        }
    };

    Plotly.newPlot(chartContainer, traces, layout);
}


// --- Logo Cache Management ---
// Enhanced logo cache to prevent duplicate HTTP requests
if (!window._logoCache) {
    window._logoCache = new Map();
}

// Check if a logo URL has been loaded recently (within 1 hour)
function isLogoRecentlyLoaded(url) {
    const cached = window._logoCache.get(url);
    if (!cached) return false;

    const now = Date.now();
    const oneHour = 3600000; // 1 hour in milliseconds
    return (now - cached.timestamp) < oneHour;
}

// Mark a logo URL as loaded
function markLogoAsLoaded(url) {
    window._logoCache.set(url, { timestamp: Date.now() });
}

// Clean up expired logo cache entries to prevent memory leaks
function cleanupExpiredLogoCache() {
    const now = Date.now();
    const oneHour = 3600000; // 1 hour in milliseconds
    let cleaned = 0;

    for (const [url, cached] of window._logoCache.entries()) {
        if ((now - cached.timestamp) > oneHour) {
            window._logoCache.delete(url);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        console.debug(`Cleaned up ${cleaned} expired logo cache entries`);
    }
}

// More granular connection/error handlers to help debugging connectivity
socket.on('connect', () => {
    console.info('Socket connected successfully');
    const el = document.getElementById('connection-status');
    if (el) {
        el.textContent = '● Connected';
        el.className = 'status-connected';
    }
});

socket.on('disconnect', (reason) => {
    console.warn('Socket disconnected:', reason);
    const el = document.getElementById('connection-status');
    if (el) {
        el.textContent = '● Disconnected';
        el.className = 'status-disconnected';
    }
});

socket.on('connect_error', (err) => {
    console.error('Socket connect_error:', err);
    const el = document.getElementById('connection-status');
    if (el) {
        el.textContent = '● Connect Error';
        el.className = 'status-disconnected';
    }
});

socket.on('reconnect_attempt', (attempt) => {
    console.info('Socket reconnect attempt', attempt);
    const el = document.getElementById('connection-status');
    if (el) {
        el.textContent = `● Reconnecting (${attempt})`;
        el.className = 'status-connecting';
    }
});

socket.on('reconnect_failed', () => {
    console.warn('Socket reconnect failed');
    const el = document.getElementById('connection-status');
    if (el) {
        el.textContent = '● Reconnect Failed';
        el.className = 'status-disconnected';
    }
});

socket.on('connect_timeout', () => {
    console.warn('Socket connect timeout');
    const el = document.getElementById('connection-status');
    if (el) {
        el.textContent = '● Connect Timeout';
        el.className = 'status-disconnected';
    }
});

socket.on('liveUpdate', (data) => {
    console.log('Received liveUpdate:', data);
    updateLiveStats(data);
    addLiveUpdateToBuffer(data);
    scheduleLiveTableUpdate();
});

// --- UI Update Functions ---
function updateLiveStats(data) {
    document.getElementById('tracking-count').textContent = data.trackingCount;
    document.getElementById('position-total').textContent = data.runningPositionCount;
    document.getElementById('receiver-count').textContent = data.receiverCount || 0;
    // Expose receiver position for slant range calculation
    if (typeof data.receiver_lat === 'number' && typeof data.receiver_lon === 'number') {
        window.receiver_lat = data.receiver_lat;
        window.receiver_lon = data.receiver_lon;
    }
    // Format runtime as Days, Hours, Min, Sec
    let totalSec = Number(data.runtime) || 0;
    const days = Math.floor(totalSec / 86400);
    totalSec %= 86400;
    const hours = Math.floor(totalSec / 3600);
    totalSec %= 3600;
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    let runtimeStr = '';
    if (days > 0) runtimeStr += `${days}d `;
    if (hours > 0 || days > 0) runtimeStr += `${hours}h `;
    if (minutes > 0 || hours > 0 || days > 0) runtimeStr += `${minutes}m `;
    runtimeStr += `${seconds}s`;
    document.getElementById('runtime').textContent = runtimeStr.trim();

    // Show Max/Min RSSI and Range
    document.getElementById('max-rssi').textContent = (data.maxRssi !== null && data.maxRssi !== undefined) ? data.maxRssi : 'N/A';
    document.getElementById('min-rssi').textContent = (data.minRssi !== null && data.minRssi !== undefined) ? data.minRssi : 'N/A';
    
    // Compute Max/Min Range from aircraft data
    let maxRange = 'N/A';
    let minRange = 'N/A';
    
    if (data.aircraft && Array.isArray(data.aircraft) && data.aircraft.length > 0) {
        const R = 3440.065; // nm per radian
        const toRad = deg => deg * Math.PI / 180;
        let ranges = [];
        
        for (const ac of data.aircraft) {
            if (ac.lat && ac.lon && ac.alt_baro && typeof ac.lat === 'number' && typeof ac.lon === 'number' && typeof ac.alt_baro === 'number' && window.receiver_lat && window.receiver_lon) {
                const lat1 = toRad(window.receiver_lat);
                const lat2 = toRad(ac.lat);
                const delta_lat = toRad(ac.lat - window.receiver_lat);
                const delta_lon = toRad(ac.lon - window.receiver_lon);
                const a = Math.sin(delta_lat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(delta_lon / 2) ** 2;
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                const horiz = R * c;
                const alt_nm = ac.alt_baro / 6076.12;
                const slantRange = Math.sqrt(horiz ** 2 + alt_nm ** 2);
                ranges.push(slantRange);
            }
        }
        
        if (ranges.length > 0) {
            maxRange = Math.max(...ranges).toFixed(2);
            minRange = Math.min(...ranges).toFixed(2);
        }
    }
    
    document.getElementById('max-range').textContent = maxRange;
    document.getElementById('min-range').textContent = minRange;
}

// TTL for local airline DB cache in ms (default 1 hour)
const AIRLINE_DB_TTL_MS = (60 * 60 * 1000);

function updateAirlineDBIndicator() {
    const el = document.getElementById('airline-db-indicator');
    if (!el) return;
    try {
        const item = localStorage.getItem('airlineDB-v1');
        if (window.airlineDB) {
            // Prefer window copy
            el.innerHTML = `Airline DB: <em>loaded (in-memory)</em>`;
            try { hideSpinnerForTab('cache', 'No cache data available'); } catch (e) {}
            return;
        }
        if (item) {
            const parsed = JSON.parse(item);
            if (parsed && parsed.ts) {
                const ageMs = Date.now() - parsed.ts;
                const ageMinutes = Math.round(ageMs / 60000);
                const ageStr = ageMinutes < 60 ? `${ageMinutes}m` : `${(ageMinutes / 60).toFixed(1)}h`;
                el.innerHTML = `Airline DB: <em>local (${ageStr} old)</em>`;
                return;
            }
        }
    } catch (err) {
        // ignore
    }
    el.innerHTML = `Airline DB: <em>not loaded</em>`;
}

function updateAircraftTable(aircraft) {
    const tableBody = document.getElementById('aircraft-table-body');

    // Save current sort state before updating table
    const table = tableBody.closest('table');
    saveTableSortState(table);

    // Build a map of existing rows keyed by hex so we can reuse nodes and avoid blinking
    const existingAircraftRows = new Map();
    const rows = tableBody.querySelectorAll('tr');
    rows.forEach(r => {
        if (r.dataset && r.dataset.hex) {
            existingAircraftRows.set(r.dataset.hex, r);
        }
    });

    if (!aircraft) return;
    
    // Load airline database once (supports window cache and localStorage persistence)
    const loadAirlineDB = async () => {
        if (window.airlineDB) return window.airlineDB;
        // Try localStorage first
        try {
            const item = localStorage.getItem('airlineDB-v1');
            if (item) {
                const parsed = JSON.parse(item);
                if (parsed && parsed.ts && (Date.now() - parsed.ts) < AIRLINE_DB_TTL_MS && parsed.data) {
                    window.airlineDB = parsed.data;
                    try { updateAirlineDBIndicator(); } catch (e) { /* ignore */ }
                    return window.airlineDB;
                }
            }
        } catch (err) {
            // localStorage may be disabled or unavailable - ignore
            console.warn('localStorage airlineDB read failed', err);
        }
        try {
            const response = await fetch('/api/airline-database');
                if (response.ok) {
                    window.airlineDB = await response.json();
                    try { updateAirlineDBIndicator(); } catch (e) { /* ignore */ }
                    // persist to localStorage
                    try {
                        localStorage.setItem('airlineDB-v1', JSON.stringify({ ts: Date.now(), data: window.airlineDB }));
                    } catch (err) {
                        console.warn('localStorage airlineDB write failed', err);
                    }
                    return window.airlineDB;
            }
            // If the server returns 304 Not Modified, try to use a previously cached copy
                if (response.status === 304) {
                if (window.airlineDB) return window.airlineDB;
                    // try localStorage if we haven't yet
                    try {
                        const item = localStorage.getItem('airlineDB-v1');
                        if (item) {
                            const parsed = JSON.parse(item);
                            if (parsed && parsed.ts && (Date.now() - parsed.ts) < AIRLINE_DB_TTL_MS && parsed.data) {
                                window.airlineDB = parsed.data;
                                try { updateAirlineDBIndicator(); } catch (e) { /* ignore */ }
                                return window.airlineDB;
                            }
                        }
                    } catch (err) {
                        console.warn('localStorage airlineDB read failed (304 fallback)', err);
                    }
                // If we don't already have a cached copy, re-fetch
                const forced = await fetch('/api/airline-database');
                if (forced.ok) {
                    window.airlineDB = await forced.json();
                    try { updateAirlineDBIndicator(); } catch (e) { /* ignore */ }
                        try {
                            localStorage.setItem('airlineDB-v1', JSON.stringify({ ts: Date.now(), data: window.airlineDB }));
                        } catch (err) { console.warn('localStorage airlineDB write failed', err); }
                    return window.airlineDB;
                }
            }
        } catch (err) {
            console.warn('Could not load airline database:', err);
        }
        return {};
    };
    
    aircraft.forEach(ac => {
        // Try to reuse existing row for this aircraft
        let row = existingAircraftRows.get(ac.hex);
        if (row) {
            // Reuse row element, but clear its contents to avoid appending duplicate cells
            existingAircraftRows.delete(ac.hex);
            try { while (row.firstChild) row.removeChild(row.firstChild); } catch (e) { row.innerHTML = ''; }
        } else {
            // Create new row
            row = document.createElement('tr');
        }
        // Set data attribute for row identification
        row.dataset.hex = ac.hex;
        // Color vertical speed (prefer baro_rate, fall back to vert_rate if present)
        const verticalRateValue = (typeof ac.baro_rate === 'number' && !Number.isNaN(ac.baro_rate))
            ? ac.baro_rate
            : (typeof ac.vert_rate === 'number' && !Number.isNaN(ac.vert_rate) ? ac.vert_rate : null);

        let vertRateDisplay = 'N/A';
        let vertRateColor = '';
        if (verticalRateValue !== null) {
            const roundedRate = Math.round(verticalRateValue);
            if (roundedRate > 0) {
                vertRateDisplay = `+${roundedRate}`;
                vertRateColor = 'color:#4caf50;font-weight:bold;';
            } else if (roundedRate < 0) {
                vertRateDisplay = `${roundedRate}`;
                vertRateColor = 'color:#f44336;font-weight:bold;';
            } else {
                vertRateDisplay = '0';
            }
        }
        
        // Get airline name from flight callsign
        let airlineName = 'N/A';
        let airlineDisplay = 'N/A';
        const flight = ac.flight || '';
        if (flight) {
            const airlineCode = flight.substring(0, 3).toUpperCase();
            if (window.airlineDB && window.airlineDB[airlineCode]) {
                const dbEntry = window.airlineDB[airlineCode];
                const fullName = typeof dbEntry === 'string' ? dbEntry : (dbEntry.name || airlineCode);
                airlineName = fullName;
                airlineDisplay = `${airlineCode} - ${fullName}`;
            } else {
                airlineName = airlineCode || 'N/A';
                airlineDisplay = airlineCode || 'N/A';
            }
        }
        
        // Calculate slant range
        let slantRange = '';
        if (ac.lat && ac.lon && ac.alt_baro && typeof ac.lat === 'number' && typeof ac.lon === 'number' && typeof ac.alt_baro === 'number' && window.receiver_lat && window.receiver_lon) {
            const R = 3440.065;
            const toRad = deg => deg * Math.PI / 180;
            const lat1 = toRad(window.receiver_lat);
            const lat2 = toRad(ac.lat);
            const delta_lat = toRad(ac.lat - window.receiver_lat);
            const delta_lon = toRad(ac.lon - window.receiver_lon);
            const a = Math.sin(delta_lat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(delta_lon / 2) ** 2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const horiz = R * c;
            const alt_nm = ac.alt_baro / 6076.12;
            slantRange = Math.sqrt(horiz ** 2 + alt_nm ** 2).toFixed(2);
        }
        // Format type with model
        let typeDisplay = ac.aircraft_type || 'N/A';
        if (ac.aircraft_model && ac.aircraft_model !== 'N/A') {
            typeDisplay = `<span title="${ac.aircraft_model}">${ac.aircraft_type}</span>`;
        }
        
        // Create cells individually for better control
        const hexCell = document.createElement('td');
        const acHexVal = ac.icao || ac.hex || '';
        if (acHexVal) {
            if (ac.flight) {
                const a = document.createElement('a');
                a.href = `https://flightaware.com/live/flight/${encodeURIComponent(ac.flight)}`;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = acHexVal;
                hexCell.appendChild(a);
            } else {
                hexCell.textContent = acHexVal;
            }
        } else {
            hexCell.textContent = '';
        }
        
        const flightCell = document.createElement('td');
        flightCell.textContent = ac.flight || 'N/A';
        
        const airlineCell = document.createElement('td');
        airlineCell.textContent = airlineDisplay;
        
        const airlineLogoCell = document.createElement('td');
        if (ac.airlineLogo) {
            const logoImg = document.createElement('img');
            logoImg.alt = `${airlineName} logo`;
            logoImg.style.height = '30px';
            logoImg.style.maxWidth = '60px';
            logoImg.style.objectFit = 'contain';
            logoImg.style.opacity = '0';
            logoImg.style.transition = 'opacity 180ms ease-in';

            if (isLogoRecentlyLoaded(ac.airlineLogo)) {
                // Logo was loaded recently, set src directly (browser should cache)
                logoImg.src = ac.airlineLogo;
                logoImg.style.opacity = '1';
            } else {
                // First time loading this logo
                logoImg.onload = () => {
                    logoImg.style.opacity = '1';
                    markLogoAsLoaded(ac.airlineLogo);
                };
                logoImg.onerror = () => {
                    airlineLogoCell.textContent = '—';
                };
                logoImg.src = ac.airlineLogo;
            }
            airlineLogoCell.appendChild(logoImg);
        } else {
            airlineLogoCell.textContent = '—';
        }
        
        const regCell = document.createElement('td');
        regCell.textContent = ac.registration || 'N/A';
        
        const typeCell = document.createElement('td');
        typeCell.innerHTML = typeDisplay;
        
        const manufacturerCell = document.createElement('td');
        manufacturerCell.textContent = ac.manufacturer || 'N/A';
        
        const manufacturerLogoCell = document.createElement('td');
        if (ac.manufacturerLogo) {
            const logoImg = document.createElement('img');
            logoImg.alt = `${ac.manufacturer} logo`;
            logoImg.style.height = '30px';
            logoImg.style.maxWidth = '60px';
            logoImg.style.objectFit = 'contain';
            logoImg.style.opacity = '0';
            logoImg.style.transition = 'opacity 180ms ease-in';

            if (isLogoRecentlyLoaded(ac.manufacturerLogo)) {
                // Logo was loaded recently, set src directly (browser should cache)
                logoImg.src = ac.manufacturerLogo;
                logoImg.style.opacity = '1';
            } else {
                // First time loading this logo
                logoImg.onload = () => {
                    logoImg.style.opacity = '1';
                    markLogoAsLoaded(ac.manufacturerLogo);
                };
                logoImg.onerror = () => {
                    manufacturerLogoCell.textContent = '—';
                };
                logoImg.src = ac.manufacturerLogo;
            }
            manufacturerLogoCell.appendChild(logoImg);
        } else {
            manufacturerLogoCell.textContent = '—';
        }
        
        const bodyTypeCell = document.createElement('td');
        bodyTypeCell.textContent = ac.bodyType || 'N/A';
        
        const squawkCell = document.createElement('td');
        squawkCell.textContent = ac.squawk || 'N/A';
        
        const altCell = document.createElement('td');
        altCell.textContent = ac.alt_baro || 'N/A';
        
        const vertRateCell = document.createElement('td');
        vertRateCell.style.cssText = vertRateColor;
        vertRateCell.textContent = vertRateDisplay;
        if (verticalRateValue !== null) {
            vertRateCell.dataset.sortValue = verticalRateValue;
        }

        const speedCell = document.createElement('td');
        speedCell.textContent = ac.gs || 'N/A';
        
        const latCell = document.createElement('td');
        latCell.textContent = ac.lat || 'N/A';
        
        const lonCell = document.createElement('td');
        lonCell.textContent = ac.lon || 'N/A';
        
        const messagesCell = document.createElement('td');
        messagesCell.textContent = ac.messages || 'N/A';
        
        const rssiCell = document.createElement('td');
        rssiCell.textContent = ac.rssi || 'N/A';
        
        const slantRangeCell = document.createElement('td');
        slantRangeCell.textContent = slantRange;
        
        // Append all cells to row
        row.appendChild(hexCell);
        row.appendChild(flightCell);
        row.appendChild(airlineCell);
        row.appendChild(airlineLogoCell);
        row.appendChild(regCell);
        row.appendChild(typeCell);
        row.appendChild(manufacturerCell);
        row.appendChild(manufacturerLogoCell);
        row.appendChild(bodyTypeCell);
        row.appendChild(squawkCell);
        row.appendChild(altCell);
        row.appendChild(vertRateCell);
        row.appendChild(speedCell);
        row.appendChild(latCell);
        row.appendChild(lonCell);
        row.appendChild(messagesCell);
        row.appendChild(rssiCell);
        row.appendChild(slantRangeCell);
        
        tableBody.appendChild(row);
    });
    
    // Remove any leftover nodes in existingAircraftRows (they were not present in current dataset)
    existingAircraftRows.forEach((r, k) => { try { r.remove(); } catch (e) {} });
    
    // Restore sort state after populating table
    restoreTableSortState(table);
}

async function loadAirlineStats(hoursBack = null) {
    try {
        try { window._lastLoadAirlineStats = Date.now(); } catch (e) {}
        try { showSpinnerForTab('airlines'); } catch (e) {}
        const startElem = document.getElementById('airline-start-time') || document.getElementById('positions-start-time');
        const endElem = document.getElementById('airline-end-time') || document.getElementById('positions-end-time');
        
        // Helper function to format timestamp as local datetime string
        const formatLocalDateTime = (timestamp) => {
            const d = new Date(timestamp);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const minutes = String(d.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        };
        
        let windowVal = '1h'; // default
        let startTime, endTime;
        let isCustomRange = false;
        
        // If hoursBack is provided, use it (from quick buttons)
        if (hoursBack !== null) {
            const now = new Date();
            endTime = now.getTime();
            startTime = endTime - (hoursBack * 60 * 60 * 1000);
            
            // Update input fields
            startElem.value = formatLocalDateTime(startTime);
            endElem.value = formatLocalDateTime(endTime);
            
            windowVal = hoursBack + 'h';
        }
        // Use custom times if set
        else if (startElem && startElem.value && endElem && endElem.value) {
            // Calculate hours difference for window parameter
            const parseLocalDateTime = (localDateTimeStr) => {
                const parts = localDateTimeStr.split('T');
                const [year, month, day] = parts[0].split('-');
                const [hours, minutes] = parts[1].split(':');
                return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
            };
            
            startTime = parseLocalDateTime(startElem.value);
            endTime = parseLocalDateTime(endElem.value);
            
            // Auto-update end time if it's recent
            const now = Date.now();
            const twoMinutesAgo = now - (2 * 60 * 1000);
            if (endTime >= twoMinutesAgo) {
                endTime = now;
                endElem.value = formatLocalDateTime(endTime);
            }
            
            const hours = Math.ceil((endTime - startTime) / (60 * 60 * 1000));
            isCustomRange = true;
            windowVal = hours + 'h';
        }
        // Default to last 1 hour
        else {
            const now = new Date();
            endTime = now.getTime();
            startTime = endTime - (1 * 60 * 60 * 1000);
            
            startElem.value = formatLocalDateTime(startTime);
            endElem.value = formatLocalDateTime(endTime);
            
            windowVal = '1h';
        }
        // Update Flights title with current filter criteria (window or custom range)
        try {
            const titleEl = document.getElementById('flights-main-title');
            if (titleEl) {
                // remove any existing filter criteria span
                try { Array.from(titleEl.querySelectorAll('.filter-criteria')).forEach(n => n.remove()); } catch (e) {}
                const fc = document.createElement('span');
                fc.className = 'filter-criteria';
                fc.style.color = '#bdbdbd';
                fc.style.fontWeight = 'normal';
                fc.style.fontSize = '0.9em';
                fc.style.marginLeft = '8px';
                if (isCustomRange && typeof startTime !== 'undefined' && typeof endTime !== 'undefined') {
                    fc.textContent = `- Range: ${formatLocalDateTime(startTime)} → ${formatLocalDateTime(endTime)}`;
                } else {
                    fc.textContent = `- Window: ${windowVal}`;
                }
                titleEl.appendChild(fc);
            }
        } catch (e) {}

        // Record filter criteria for UI summary (so hideSpinnerForTab can show it)
        try {
            const summaryEl = document.getElementById('airline-stats-summary-last-hour');
            if (summaryEl) {
                if (isCustomRange && typeof startTime !== 'undefined' && typeof endTime !== 'undefined') {
                    summaryEl.dataset.filterCriteria = `Range: ${formatLocalDateTime(startTime)} → ${formatLocalDateTime(endTime)}`;
                } else {
                    summaryEl.dataset.filterCriteria = `Window: ${windowVal}`;
                }
            }
        } catch (e) {}

        const response = await fetch(`/api/airline-stats?window=${windowVal}`);
        const data = await response.json();
        console.log('Received airline stats data:', JSON.stringify(data, null, 2));

        // Expect: { minute: {byAirline: {...}}, hourly: {byAirline: {...}}, memory: {byAirline: {...}} }
        const sources = [
            { label: 'Minute Files', key: 'minute' },
            { label: null, key: 'hourly' },
            { label: 'Current Memory', key: 'memory' }
        ];

        const summaryDiv = document.getElementById('airline-stats-summary-last-hour');
        let summaryHtml = '';
        sources.forEach(src => {
            const byAirline = (data[src.key] && data[src.key].byAirline) ? data[src.key].byAirline : {};
            const totalFlights = Object.values(byAirline).reduce((sum, stats) => sum + (stats.count || 0), 0);
            const totalAirlines = Object.keys(byAirline).length;
            summaryHtml += `<strong>${src.label}:</strong> ${totalFlights.toLocaleString()} flights, ${totalAirlines.toLocaleString()} airlines<br>`;
        });
        summaryDiv.innerHTML = summaryHtml;

        const tableBody = document.getElementById('airline-stats-table-body-last-hour');
        
        // Save current sort state before clearing table
        const table = tableBody.closest('table');
        saveTableSortState(table);
        
        // Build a map of existing rows keyed by flight key so we can reuse nodes and avoid blinking
        const existingFlightRows = new Map();
        try {
            const rows = Array.from(tableBody.querySelectorAll('tr'));
            rows.forEach(r => { if (r.dataset && r.dataset.flightKey) existingFlightRows.set(r.dataset.flightKey, r); });
        } catch (e) { /* ignore */ }
        // We'll clear tableBody and re-append reused/new rows; the old nodes are either reused or removed
        tableBody.innerHTML = '';

        sources.forEach(src => {
            const byAirline = (data[src.key] && data[src.key].byAirline) ? data[src.key].byAirline : {};
            if (Object.keys(byAirline).length === 0) return;
            // Add a header row for each source (skip if label is null)
            if (src.label) {
                const headerRow = document.createElement('tr');
                headerRow.innerHTML = `<td colspan="8" style="background:#eee;font-weight:bold;">${src.label}</td>`;
                tableBody.appendChild(headerRow);
            }

            // Sort airlines by flight count
            const airlines = [];
            for (const [airlineName, stats] of Object.entries(byAirline)) {
                airlines.push({
                    name: airlineName,
                    code: stats.code || '---',
                    logo: stats.logo || null,
                    count: stats.count || 0,
                    aircraft: stats.aircraft || 0,
                    lastSeen: stats.lastSeen || 0
                    , topType: stats.topType || null,
                    manufacturers: stats.manufacturers || {},
                    topManufacturer: stats.topManufacturer || null,
                    topManufacturerLogo: stats.topManufacturerLogo || null
                });
            }
            airlines.sort((a, b) => b.count - a.count);

            for (const airline of airlines) {
                const row = document.createElement('tr');
                const timeAgo = formatTimeAgo(airline.lastSeen);
                row.style.cursor = 'pointer';
                row.style.transition = 'background-color 0.2s';
                row.onmouseenter = () => row.style.backgroundColor = '#2a2a2a';
                row.onmouseleave = () => row.style.backgroundColor = '';
                row.onclick = () => loadAirlineFlights(airline.code, airline.name, windowVal);
                
                // Create cells with data attributes for sorting
                const codeCell = document.createElement('td');
                codeCell.innerHTML = `<strong>${airline.code}</strong>`;
                
                const logoCell = document.createElement('td');
                logoCell.className = 'logo-cell';
                if (airline.logo) {
                    const logoImg = document.createElement('img');
                    logoImg.alt = `${airline.name} logo`;
                    logoImg.style.height = '30px';
                    logoImg.style.maxWidth = '60px';
                    logoImg.style.objectFit = 'contain';
                    logoImg.style.opacity = '0';
                    logoImg.style.transition = 'opacity 180ms ease-in';

                    if (isLogoRecentlyLoaded(airline.logo)) {
                        // Logo was loaded recently, set src directly (browser should cache)
                        logoImg.src = airline.logo;
                        logoImg.style.opacity = '1';
                    } else {
                        // First time loading this logo
                        logoImg.onload = () => {
                            logoImg.style.opacity = '1';
                            markLogoAsLoaded(airline.logo);
                        };
                        logoImg.onerror = () => {
                            logoCell.textContent = '—';
                        };
                        logoImg.src = airline.logo;
                    }
                    logoCell.appendChild(logoImg);
                } else {
                    logoCell.textContent = '—';
                }
                
                const nameCell = document.createElement('td');
                nameCell.textContent = airline.name;
                
                const countCell = document.createElement('td');
                countCell.textContent = airline.count.toLocaleString();
                countCell.setAttribute('data-sort-value', airline.count);
                
                const aircraftCell = document.createElement('td');
                aircraftCell.textContent = airline.aircraft.toLocaleString();
                aircraftCell.setAttribute('data-sort-value', airline.aircraft);
                
                const lastSeenCell = document.createElement('td');
                lastSeenCell.textContent = timeAgo;
                lastSeenCell.setAttribute('data-sort-value', airline.lastSeen);
                
                row.appendChild(codeCell);
                row.appendChild(logoCell);
                row.appendChild(nameCell);
                row.appendChild(countCell);
                row.appendChild(aircraftCell);
                row.appendChild(lastSeenCell);
                const topManuCell = document.createElement('td');
                // Display all manufacturers with their percentages
                const manufacturers = airline.manufacturers || {};
                const totalFlights = airline.count || 1; // Avoid division by zero
                const manufacturerList = Object.entries(manufacturers)
                    .sort(([,a], [,b]) => b - a) // Sort by count descending
                    .map(([name, count]) => {
                        const percentage = Math.round((count / totalFlights) * 100);
                        return `${name} (${percentage}%)`;
                    })
                    .join(', ');
                topManuCell.textContent = manufacturerList || 'N/A';
                topManuCell.title = manufacturerList; // Tooltip for full list
                row.appendChild(topManuCell);
                const topManuLogoCell = document.createElement('td');
                topManuLogoCell.className = 'logo-cell';
                if (airline.topManufacturerLogo) {
                    const logoImg = document.createElement('img');
                    logoImg.alt = `${airline.topManufacturer} logo`;
                    logoImg.style.height = '30px';
                    logoImg.style.maxWidth = '60px';
                    logoImg.style.objectFit = 'contain';
                    logoImg.style.marginRight = '8px';
                    logoImg.style.opacity = '0';
                    logoImg.style.transition = 'opacity 180ms ease-in';
                    logoImg.onerror = function() { this.style.display = 'none'; };

                    if (isLogoRecentlyLoaded(airline.topManufacturerLogo)) {
                        // Logo was loaded recently, set src directly (browser should cache)
                        logoImg.src = airline.topManufacturerLogo;
                        logoImg.style.opacity = '1';
                    } else {
                        // First time loading this logo
                        logoImg.onload = () => {
                            logoImg.style.opacity = '1';
                            markLogoAsLoaded(airline.topManufacturerLogo);
                        };
                        logoImg.onerror = () => {
                            // Logo will be hidden by onerror handler
                        };
                        logoImg.src = airline.topManufacturerLogo;
                    }
                    topManuLogoCell.appendChild(logoImg);
                } else {
                    topManuLogoCell.textContent = '';
                }
                row.appendChild(topManuLogoCell);
                
                tableBody.appendChild(row);
            }
        });
        
        // Restore sort state after populating table
        restoreTableSortState(table);
        try { setComputedRangeUI('airlines', startTime, endTime, isCustomRange); } catch (e) {}
        try { hideSpinnerForTab('airlines'); } catch (e) {}

        // If an airline drilldown is currently open for a specific airline, refresh it
        try {
            const drill = window._currentAirlineDrill;
            if (drill && document.getElementById('airline-flights-drilldown') && document.getElementById('airline-flights-drilldown').style.display !== 'none') {
                // Re-run the drill loader with the stored params
                try { loadAirlineFlights(drill.code, drill.name, drill.window); } catch (e) {}
            }
        } catch (e) {}
    } catch (error) {
        console.error('Error loading or processing airline stats:', error);
        try { hideSpinnerForTab('airlines', `<span style="color:#f44336;">Error loading airlines</span>`); } catch (e) {}
    }
}

async function loadAirlineFlights(airlineCode, airlineName, windowVal) {
    try {
        try { window._lastLoadAirlineFlights = Date.now(); } catch (e) {}
        try { showSpinnerForTab('airline-flights', 'Loading flights…'); } catch (e) {}
        // Remember current drilldown state so parent reloads can refresh it
        try { window._currentAirlineDrill = { code: airlineCode, name: airlineName, window: windowVal }; } catch (e) {}
        const drilldownDiv = document.getElementById('airline-flights-drilldown');
        const titleElem = document.getElementById('airline-flights-title');
        const summaryElem = document.getElementById('airline-flights-summary');
        const tableBody = document.getElementById('airline-flights-table-body');
        
        // Show the drilldown section
        drilldownDiv.style.display = 'block';
        
        // Format the time window for display
        let timeWindowText = '';
        if (windowVal.endsWith('h')) {
            const hours = parseInt(windowVal);
            if (hours === 1) {
                timeWindowText = 'Last Hour';
            } else {
                timeWindowText = `Last ${hours} Hours`;
            }
        } else {
            timeWindowText = windowVal; // fallback
        }
        
        titleElem.textContent = `Flights for ${airlineCode} - ${airlineName} (${timeWindowText})`;
        // showSpinnerForTab has already placed a spinner into this element; avoid overwriting it
        
        // Save current sort state before clearing table
        const table = tableBody.closest('table');
        saveTableSortState(table);
        
        // Build a map of existing rows keyed by flight key so we can reuse nodes and avoid blinking
        const existingFlightRows = new Map();
        try {
            const rows = Array.from(tableBody.querySelectorAll('tr'));
            rows.forEach(r => { if (r.dataset && r.dataset.flightKey) existingFlightRows.set(r.dataset.flightKey, r); });
        } catch (e) { /* ignore */ }
        // We'll clear tableBody and re-append reused/new rows; the old nodes are either reused or removed
        tableBody.innerHTML = '';
        
        // Scroll to the drilldown section
        drilldownDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        // Fetch flights data
        const response = await fetch(`/api/flights?window=${windowVal}`);
        const data = await response.json();
        
        // Filter flights for this airline (API returns 'flights' for completed, 'active' for active)
        const completedFlights = (data.flights || []).filter(flight => {
            const callsign = flight.callsign || '';
            const flightAirlineCode = callsign.substring(0, 3).toUpperCase();
            return flightAirlineCode === airlineCode;
        });
        
        const activeFlights = (data.active || []).filter(flight => {
            const callsign = flight.callsign || '';
            const flightAirlineCode = callsign.substring(0, 3).toUpperCase();
            return flightAirlineCode === airlineCode;
        });
        
        const allFlights = [...activeFlights, ...completedFlights];
        
        // Update summary data: store previous HTML and filter criteria so hideSpinnerForTab can render them
        try {
            const summaryHtml = `<strong>Total Flights:</strong> ${allFlights.length}`;
            summaryElem.dataset._previousHtml = summaryHtml;
            summaryElem.dataset.filterCriteria = `Active: ${activeFlights.length} • No Longer Seen: ${completedFlights.length}`;
        } catch (e) {}
        
        // Sort by start time (most recent first)
        allFlights.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
        
        // Populate table
        for (const flight of allFlights) {
            const row = document.createElement('tr');
            const isActive = activeFlights.includes(flight);
            
            const startTime = new Date(flight.start_time);
            const endTime = new Date(flight.end_time);
            const duration = Math.round((endTime - startTime) / 60000); // minutes
            
            row.style.backgroundColor = isActive ? '#1a3a1a' : '#1e1e1e';
            
            // Create cells with data attributes for proper sorting
            const callsignCell = document.createElement('td');
            callsignCell.style.color = '#e0e0e0';
            callsignCell.innerHTML = `<strong>${flight.callsign || 'N/A'}</strong>`;
            
            const hexCell = document.createElement('td');
            hexCell.style.color = '#bbb';
            const flightHex = flight.icao || flight.hex || '';
            if (flightHex) {
                if (flight.callsign) {
                    const a = document.createElement('a');
                    a.href = `https://flightaware.com/live/flight/${encodeURIComponent(flight.callsign)}`;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    a.textContent = flightHex;
                    hexCell.appendChild(a);
                } else {
                    hexCell.textContent = flightHex;
                }
                hexCell.setAttribute('data-sort-value', flightHex);
            } else {
                hexCell.textContent = '';
                hexCell.setAttribute('data-sort-value', '');
            }
            
            const regCell = document.createElement('td');
            regCell.style.color = '#bbb';
            regCell.textContent = flight.registration || 'N/A';
            
            const typeCell = document.createElement('td');
            typeCell.style.color = '#bbb';
            typeCell.textContent = flight.type || 'N/A';
            
            const manufacturerCell = document.createElement('td');
            manufacturerCell.style.color = '#bbb';
            manufacturerCell.textContent = flight.manufacturer || 'N/A';
            
            const manufacturerLogoCell = document.createElement('td');
            manufacturerLogoCell.className = 'logo-cell';
            if (flight.manufacturerLogo) {
                manufacturerLogoCell.innerHTML = `<img src="${flight.manufacturerLogo}" alt="${flight.manufacturer} logo" style="height: 30px; max-width: 60px; object-fit: contain;" onerror="this.style.display='none';">`;
            } else {
                manufacturerLogoCell.textContent = '—';
            }
            
            const btCell = document.createElement('td');
            btCell.style.color = '#bbb';
            btCell.textContent = flight.bodyType || 'N/A';
            
            const startCell = document.createElement('td');
            startCell.style.color = '#bbb';
            startCell.textContent = startTime.toLocaleString();
            startCell.setAttribute('data-sort-value', startTime.getTime());
            
            const endCell = document.createElement('td');
            endCell.style.color = '#bbb';
            endCell.textContent = endTime.toLocaleString();
            endCell.setAttribute('data-sort-value', endTime.getTime());
            
            const durationCell = document.createElement('td');
            durationCell.style.color = '#bbb';
            durationCell.textContent = `${duration} min`;
            
            const statusCell = document.createElement('td');
            statusCell.style.color = isActive ? '#4caf50' : '#888';
            statusCell.style.fontWeight = 'bold';
            statusCell.textContent = isActive ? 'ACTIVE' : 'No Longer Seen';
            
            row.appendChild(callsignCell);
            row.appendChild(hexCell);
            row.appendChild(regCell);
            row.appendChild(typeCell);
            row.appendChild(manufacturerCell);
            row.appendChild(manufacturerLogoCell);
            row.appendChild(btCell);
            row.appendChild(startCell);
            row.appendChild(endCell);
            row.appendChild(durationCell);
            row.appendChild(statusCell);
            
            tableBody.appendChild(row);
        }
        
        if (allFlights.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="11" style="text-align: center; color: #888; padding: 20px;">No flights found for this airline in the selected time period.</td></tr>';
        }
        
        // Restore sort state after populating table
        restoreTableSortState(table);
        try { hideSpinnerForTab('airline-flights'); } catch (e) {}
    } catch (error) {
        console.error('Error loading airline flights:', error);
        const summaryElem = document.getElementById('airline-flights-summary');
        summaryElem.innerHTML = `<span style="color: #f44336;">Error loading flights: ${error.message}</span>`;
    }
}

function closeAirlineFlightsDrilldown() {
    const drilldownDiv = document.getElementById('airline-flights-drilldown');
    drilldownDiv.style.display = 'none';
    try { delete window._currentAirlineDrill; } catch (e) {}
}

// Global storage for position data sources
let positionDataSources = {
    memory: null,
    sqlite: null,
    tsdb: null,
    s3: null,
    active: 'memory'
};

async function loadUnifiedPositionStats(hoursBack = null) {
    try {
    try { showSpinnerForTab('positions'); } catch (e) {}
        const startElem = document.getElementById('positions-start-time');
        const endElem = document.getElementById('positions-end-time');
        // If a global time-window control exists on the page (heatmap or time-window), prefer it
        const timeWindowSelect = document.getElementById('time-window') || document.getElementById('heatmap-window');
        if (timeWindowSelect) {
            const val = timeWindowSelect.value;
            if (val) {
                        switch (val) {
                            case '1h': hoursBack = 1; break;
                            case '4h': hoursBack = 4; break;
                            case '6h': hoursBack = 6; break;
                            case '8h': hoursBack = 8; break;
                            case '12h': hoursBack = 12; break;
                            case '24h': hoursBack = 24; break;
                            case '1w': hoursBack = 168; break; // 7 * 24
                            case '4w': hoursBack = 672; break; // 4 * 7 * 24
                            case 'all': hoursBack = null; break;
                        }
            }
                // Persist the time-window select if present
                try { localStorage.setItem('positionsTimescale', String(timeWindowSelect.value || '24h')); } catch (e) {}
        }
        
        // Helper function to format timestamp as local datetime string
        const formatLocalDateTime = (timestamp) => {
            const d = new Date(timestamp);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const minutes = String(d.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        };
        
        const parseLocalDateTime = (localDateTimeStr) => {
            const parts = localDateTimeStr.split('T');
            const [year, month, day] = parts[0].split('-');
            const [hrs, mins] = parts[1].split(':');
            return new Date(year, month - 1, day, hrs, mins, 0, 0).getTime();
        };
        
        let hours = 24; // default
        let startTime, endTime;
        
        // If hoursBack is provided, use it (from quick buttons)
        if (hoursBack !== null) {
            const now = new Date();
            endTime = now.getTime();
            startTime = endTime - (hoursBack * 60 * 60 * 1000);
            
            // Update input fields
            startElem.value = formatLocalDateTime(startTime);
            endElem.value = formatLocalDateTime(endTime);
            
            hours = hoursBack;
            // Update top-of-page select value if present and persist
            try {
                const sel = document.getElementById('time-window');
                if (sel) {
                    sel.value = hoursToSelectVal(hoursBack);
                    localStorage.setItem('positionsTimescale', String(sel.value));
                }
            } catch (e) {}
        }
        // Use custom times if set
        else if (startElem && startElem.value && endElem && endElem.value) {
            startTime = parseLocalDateTime(startElem.value);
            endTime = parseLocalDateTime(endElem.value);
                        isCustomRange = true;
            
            // Auto-update end time if it's recent
            const now = Date.now();
            const twoMinutesAgo = now - (2 * 60 * 1000);
            if (endTime >= twoMinutesAgo) {
                endTime = now;
                endElem.value = formatLocalDateTime(endTime);
            }
            
            hours = Math.ceil((endTime - startTime) / (60 * 60 * 1000));
        }
        // Default to last 24 hours
        else {
            const now = new Date();
            endTime = now.getTime();
            startTime = endTime - (24 * 60 * 60 * 1000);
            
            startElem.value = formatLocalDateTime(startTime);
            endElem.value = formatLocalDateTime(endTime);
            
            hours = 24;
        }
        
        // Fetch data from all four sources in parallel
        // Use startTime/endTime if available, otherwise fall back to hours
        const [memoryResp, sqliteResp, tsdbResp, s3Resp] = await Promise.all([
            fetch(`/api/position-timeseries-live?startTime=${startTime}&endTime=${endTime}&resolution=15`),
            fetch(`/api/positions?hours=${hours}&source=sqlite`),
            fetch(`/api/positions?hours=${hours}&source=tsdb`),
            fetch('/api/v2/cache-status')
        ]);
        
        const memoryData = await memoryResp.json();
        const sqliteData = await sqliteResp.json();
        const tsdbData = await tsdbResp.json();
        const s3Data = await s3Resp.json();
        
        // === MEMORY STATS (from live timeseries) ===
        let memoryPositions = 0, memoryAircraft = new Set(), memoryFlights = new Set(), memoryAirlines = new Set();
        if (Array.isArray(memoryData)) {
            memoryData.forEach(bucket => {
                memoryPositions += bucket.positionCount || 0;
                if (Array.isArray(bucket.aircraft)) {
                    bucket.aircraft.forEach(a => memoryAircraft.add(a));
                }
                if (Array.isArray(bucket.flights)) {
                    bucket.flights.forEach(f => memoryFlights.add(f));
                }
                if (Array.isArray(bucket.airlines)) {
                    bucket.airlines.forEach(a => memoryAirlines.add(a));
                }
            });
        }
        
        // === SQLITE STATS (from positions API with source=sqlite) ===
        let sqlitePositions = 0, sqliteAircraft = new Set(), sqliteFlights = new Set(), sqliteAirlines = new Set();
        if (Array.isArray(sqliteData)) {
            sqlitePositions = sqliteData.length;
            sqliteData.forEach(pos => {
                if (pos.hex) sqliteAircraft.add(pos.hex);
                if (pos.flight) sqliteFlights.add(pos.flight);
                // Airlines would need to be derived from flight codes or additional data
            });
        }
        
        // === TSDB STATS (from positions API with source=tsdb) ===
        let tsdbPositions = 0, tsdbAircraft = new Set(), tsdbFlights = new Set(), tsdbAirlines = new Set();
        if (Array.isArray(tsdbData)) {
            tsdbPositions = tsdbData.length;
            tsdbData.forEach(pos => {
                if (pos.icao) tsdbAircraft.add(pos.icao);
                if (pos.flight) tsdbFlights.add(pos.flight);
                // Airlines would need to be derived from flight codes or additional data
            });
        }
        
        // === S3 STATS (from cache status - represents S3-derived data) ===
        const s3Positions = s3Data.positionCache?.totalPositions || 0;
        const s3Aircraft = s3Data.positionCache?.uniqueAircraft || 0;
        const s3Flights = s3Data.positionCache?.uniqueFlights || 0;
        const s3Airlines = s3Data.positionCache?.uniqueAirlines || 0;
        
        // Update UI
        document.getElementById('memory-positions').textContent = memoryPositions.toLocaleString();
        document.getElementById('memory-aircraft').textContent = memoryAircraft.size.toLocaleString();
        document.getElementById('memory-flights').textContent = memoryFlights.size.toLocaleString();
        document.getElementById('memory-airlines').textContent = memoryAirlines.size.toLocaleString();
        
        document.getElementById('sqlite-positions').textContent = sqlitePositions.toLocaleString();
        document.getElementById('sqlite-aircraft').textContent = sqliteAircraft.size.toLocaleString();
        document.getElementById('sqlite-flights').textContent = sqliteFlights.size.toLocaleString();
        document.getElementById('sqlite-airlines').textContent = sqliteAirlines.size.toLocaleString();
        
        document.getElementById('tsdb-positions').textContent = tsdbPositions.toLocaleString();
        document.getElementById('tsdb-aircraft').textContent = tsdbAircraft.size.toLocaleString();
        document.getElementById('tsdb-flights').textContent = tsdbFlights.size.toLocaleString();
        document.getElementById('tsdb-airlines').textContent = tsdbAirlines.size.toLocaleString();
        
        document.getElementById('s3-positions').textContent = s3Positions.toLocaleString();
        document.getElementById('s3-aircraft').textContent = s3Aircraft.toLocaleString();
        document.getElementById('s3-flights').textContent = s3Flights.toLocaleString();
        document.getElementById('s3-airlines').textContent = s3Airlines.toLocaleString();
        
        // === STORE DATA SOURCES ===
        positionDataSources.memory = memoryData;
        positionDataSources.sqlite = sqliteData;
        positionDataSources.tsdb = tsdbData;
        positionDataSources.s3 = Array.isArray(memoryData) ? memoryData.map(bucket => ({
            ...bucket,
            positionCount: Math.round(bucket.positionCount * (s3Positions / Math.max(memoryPositions, 1)))
        })) : [];
        
        // Store current time range for graph filtering
        positionDataSources.startTime = startTime;
        positionDataSources.endTime = endTime;
        
        // Update active stat card styling
        updateActiveDataSource();
        
        // === DRAW TIME SERIES GRAPH ===
        drawPositionsTimeSeriesGraph(positionDataSources[positionDataSources.active]);
        try { setActivePositionButton(hours); } catch (e) {}
        try { updatePositionsTimescaleIndicator(); } catch (e) {}
        try { setComputedRangeUI('positions', startTime, endTime, isCustomRange); } catch (e) {}
        try {
            // Record summary counts so hideSpinnerForTab can render them next to Last lookup
            const summaryEl = document.getElementById('positions-timescale-indicator');
            if (summaryEl) {
                try {
                    const summaryHtml = `<strong>Memory:</strong> ${memoryPositions.toLocaleString()} pos • ${memoryAircraft.size.toLocaleString()} AC`;
                    summaryEl.dataset._previousHtml = summaryHtml;
                    // Store filter criteria (range or window)
                    if (isCustomRange && typeof startTime !== 'undefined' && typeof endTime !== 'undefined') {
                        summaryEl.dataset.filterCriteria = `Range: ${formatLocalDateTime(startTime)} → ${formatLocalDateTime(endTime)}`;
                    } else {
                        summaryEl.dataset.filterCriteria = `Window: ${hours}h`;
                    }
                } catch (e) {}
            }
        } catch (e) {}
        try { hideSpinnerForTab('positions'); } catch (e) {}
        
        } catch (error) {
        console.error('Error loading unified position stats:', error);
            try { hideSpinnerForTab('positions', `<span style=\"color:#f44336;\">Error loading positions</span>`); } catch (e) {}
    }
}

function switchPositionDataSource(source) {
    if (!['memory', 'sqlite', 'tsdb', 's3'].includes(source)) return;
    positionDataSources.active = source;
    updateActiveDataSource();
    drawPositionsTimeSeriesGraph(positionDataSources[source]);
}

function updateActiveDataSource() {
    // Reset all cards to default styling by finding them through their child stats divs
    const memoryCard = document.getElementById('memory-stats')?.parentElement;
    const sqliteCard = document.getElementById('sqlite-stats')?.parentElement;
    const tsdbCard = document.getElementById('tsdb-stats')?.parentElement;
    const s3Card = document.getElementById('s3-stats')?.parentElement;
    
    if (memoryCard) {
        memoryCard.style.border = positionDataSources.active === 'memory' ? '3px solid #4caf50' : '2px solid #4caf50';
        memoryCard.style.boxShadow = positionDataSources.active === 'memory' ? '0 0 15px rgba(76, 175, 80, 0.5)' : 'none';
    }
    if (sqliteCard) {
        sqliteCard.style.border = positionDataSources.active === 'sqlite' ? '3px solid #2196f3' : '2px solid #2196f3';
        sqliteCard.style.boxShadow = positionDataSources.active === 'sqlite' ? '0 0 15px rgba(33, 150, 243, 0.5)' : 'none';
    }
    if (tsdbCard) {
        tsdbCard.style.border = positionDataSources.active === 'tsdb' ? '3px solid #9c27b0' : '2px solid #9c27b0';
        tsdbCard.style.boxShadow = positionDataSources.active === 'tsdb' ? '0 0 15px rgba(156, 39, 176, 0.5)' : 'none';
    }
    if (s3Card) {
        s3Card.style.border = positionDataSources.active === 's3' ? '3px solid #ff9800' : '2px solid #ff9800';
        s3Card.style.boxShadow = positionDataSources.active === 's3' ? '0 0 15px rgba(255, 152, 0, 0.5)' : 'none';
    }
}

// Highlight the positions quickbutton matching the selected hours value (or clear highlighting for 'all')
function setActivePositionButton(hours) {
    try {
        const btns = document.querySelectorAll('.positions-window-btn');
        if (!btns || !btns.length) return;
        btns.forEach(b => b.classList.remove('active'));
        // Clear aria-pressed for all buttons
        btns.forEach(b => { try { b.setAttribute('aria-pressed', 'false'); } catch (e) {} });
        if (hours === null || typeof hours === 'undefined') {
            // Highlight 'All' if present
            const allMatch = Array.from(btns).find(b => String(b.dataset.hours) === 'all');
            if (allMatch) { allMatch.classList.add('active'); allMatch.setAttribute('aria-pressed', 'true'); }
            return;
        }
        const match = Array.from(btns).find(b => String(b.dataset.hours) === String(hours) || (String(hours) === '24' && String(b.dataset.hours) === '24'));
        if (match) match.classList.add('active');
        try { if (match) match.setAttribute('aria-pressed', 'true'); } catch (e) {}
    } catch (e) { /* ignore errors */ }
}

// Map numeric hours (and null for 'all') to 'time-window' select value strings
function hoursToSelectVal(hours) {
    if (hours === null || typeof hours === 'undefined') return 'all';
    switch (String(hours)) {
        case '1': return '1h';
        case '4': return '4h';
        case '6': return '6h';
        case '8': return '8h';
        case '12': return '12h';
        case '24': return '24h';
        case '168': return '1w';
        case '672': return '4w';
        default: return '24h';
    }
}

function selectValToHours(val) {
    if (!val) return 24;
    switch (val) {
        case '1h': return 1;
        case '4h': return 4;
        case '6h': return 6;
        case '8h': return 8;
        case '12h': return 12;
        case '24h': return 24;
        case '1w': return 168;
        case '4w': return 672;
        case 'all': return null;
        default: return 24;
    }
}

// Handle global time control selection; dispatches to the appropriate loader for the active tab
function handleGlobalTimeSelection(hours) {
    try {
        // Hours may be null for 'all'
        const activeTabElem = document.querySelector('.tab-content.active');
        let tabName = null;
        if (activeTabElem && activeTabElem.id) {
            tabName = activeTabElem.id.replace(/-tab$/, '');
        }
        // If no active tab found, default to positions
        if (!tabName) tabName = 'positions';
        // Set global time-window select value and persist
        try {
            const sel = document.getElementById('time-window');
            if (sel) {
                sel.value = hoursToSelectVal(hours);
                localStorage.setItem('positionsTimescale', String(sel.value));
            }
        } catch (e) {}

        // Map to loader functions
        switch (tabName) {
            case 'positions':
                try { loadUnifiedPositionStats(hours); } catch (e) {}
                break;
            case 'reception':
                try { loadReceptionRange(hours); } catch (e) {}
                break;
            case 'airlines':
                try { loadAirlineStats(hours); } catch (e) {}
                break;
            case 'flights':
                try { loadFlights(hours); } catch (e) {}
                break;
            case 'squawk':
                try { loadSquawkTransitions(hours); } catch (e) {}
                break;
            case 'heatmap':
                try { 
                    // Set the select's value in the top-of-page control
                    const sel = document.getElementById('time-window');
                    if (sel) sel.value = hoursToSelectVal(hours);
                    loadHeatmap(hours);
                } catch (e) {}
                break;
            default:
                try { loadUnifiedPositionStats(hours); } catch (e) {}
                break;
        }
        // Update storage and UI highlighting
        try { const sel = document.getElementById('time-window'); if (sel) { localStorage.setItem('positionsTimescale', String(sel.value)); } } catch (e) {}
        try { setActivePositionButton(hours); } catch (e) {}
        try { setCustomRangeUI(false); } catch (e) {}
    } catch (e) { /* ignore */ }
}

// Clear active quick buttons
function clearActivePositionButtons() {
    try {
        const btns = document.querySelectorAll('.positions-window-btn');
        btns.forEach(b => { b.classList.remove('active'); try { b.setAttribute('aria-pressed','false'); } catch (e) {} });
    } catch (e) {}
}

// Apply or remove the green border around global start/end input to indicate custom range is active/returned
function setCustomRangeUI(active) {
    try {
        // Apply the custom-range-active class to any known global start/end inputs
        const ids = [
            'positions-start-time','positions-end-time',
            'flights-start-time','flights-end-time','flights-gap',
            'airline-start-time','airline-end-time',
            'squawk-start-time','squawk-end-time',
            'reception-start-time','reception-end-time'
        ];
        ids.forEach(id => {
            try {
                const el = document.getElementById(id);
                if (!el) return;
                if (active) el.classList.add('custom-range-active'); else el.classList.remove('custom-range-active');
            } catch (e) {}
        });
    } catch (e) {}
}

// Update computed range display for a given tab; startMS / endMS are millisecond timestamps
function setComputedRangeUI(tabName, startMS, endMS, isCustom) {
    try {
        if (!startMS || !endMS) return;
        const fmt = (ms) => {
            const d = new Date(ms);
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        };
        const rangeText = `${fmt(startMS)} → ${fmt(endMS)}`;
        // Map tabName to summary element ids
        const mapping = {
            'positions': 'positions-timescale-indicator',
            'flights': 'flights-summary',
            'airlines': 'airline-stats-summary-last-hour',
            'squawk': 'squawk-summary',
            'reception': 'reception-summary',
            'heatmap': 'heatmap-total-positions'
        };
        const id = mapping[tabName] || null;
        if (!id) return;
        const el = document.getElementById(id);
        if (!el) return;
        // For positions, replace the timescale indicator text if this is custom
        if (tabName === 'positions') {
            try { el.textContent = isCustom ? `Custom: ${rangeText}` : el.textContent; } catch (e) {}
            try { setCustomRangeUI(isCustom); } catch (e) {}
            return;
        }
        // For others, append or create a computed-range span
        let cr = el.querySelector('.computed-range');
        if (!cr) {
            cr = document.createElement('span');
            cr.className = 'computed-range';
            el.appendChild(cr);
        }
        cr.textContent = `Range: ${rangeText}`;
        // Add green border on the main summary area if custom
        if (isCustom) el.classList.add('custom-range-active'); else el.classList.remove('custom-range-active');
        // Also ensure global custom inputs reflect custom state
        try { setCustomRangeUI(isCustom); } catch (e) {}
    } catch (e) {}
}

// Mapping of tabName to a summary element ID for showing spinner/last-lookup
const TAB_SUMMARY_ID_MAP = {
    'positions': 'positions-timescale-indicator',
    'flights': 'flights-summary',
    'airlines': 'airline-stats-summary-last-hour',
    'squawk': 'squawk-summary',
    'reception': 'reception-summary',
    'heatmap': 'heatmap-total-positions',
    'cache': 'cache-summary'
};
TAB_SUMMARY_ID_MAP['airline-flights'] = 'airline-flights-summary';

window._lastLookupTimes = window._lastLookupTimes || {};

function formatTimeForUI(ts) {
    if (!ts) return 'N/A';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

function showSpinnerForTab(tabName, message = 'Loading…') {
    try {
        const id = TAB_SUMMARY_ID_MAP[tabName] || null;
        if (!id) return;
        const el = document.getElementById(id);
        if (!el) return;
        el.dataset._previousHtml = el.innerHTML; // save existing
        el.innerHTML = `<span class="spinner" aria-hidden="true"></span><span class="loading-text">${message}</span>`;
    } catch (e) { /* ignore */ }
}

function hideSpinnerForTab(tabName, replacementText = null) {
    try {
        const id = TAB_SUMMARY_ID_MAP[tabName] || null;
        if (!id) return;
        const el = document.getElementById(id);
        if (!el) return;
        // Set last lookup timestamp
        const ts = Date.now();
        window._lastLookupTimes[tabName] = ts;
        // Build DOM nodes to avoid duplicate text nodes or repeated HTML
        const computedText = `Last lookup: ${formatTimeForUI(ts)}`;

        // Clear existing content entirely to avoid duplicates
        while (el.firstChild) el.removeChild(el.firstChild);

        // Insert replacement or previous HTML if provided
        if (replacementText !== null) {
            const rep = document.createElement('span');
            rep.className = 'loading-text-replacement';
            rep.innerHTML = replacementText;
            el.appendChild(rep);
        } else if (el.dataset._previousHtml) {
            const prev = document.createElement('span');
            prev.className = 'previous-html';
            prev.innerHTML = el.dataset._previousHtml;
            el.appendChild(prev);
            delete el.dataset._previousHtml;
        }

        // Add stored filter criteria if available
        if (el.dataset && el.dataset.filterCriteria) {
            if (el.childNodes.length) el.appendChild(document.createTextNode(' '));
            const f = document.createElement('span');
            f.className = 'filter-criteria';
            f.textContent = el.dataset.filterCriteria;
            el.appendChild(f);
        }

        // Finally add the computed last lookup span
        if (el.childNodes.length) el.appendChild(document.createTextNode(' '));
        const last = document.createElement('span');
        last.className = 'computed-range';
        last.textContent = computedText;
        el.appendChild(last);
    } catch (e) { /* ignore */ }
}

// Attach global listeners to the positions start/end inputs so a custom range
// will trigger the appropriate loader for the active tab.
function attachGlobalCustomRangeListeners() {
    try {
        const start = document.getElementById('positions-start-time');
        const end = document.getElementById('positions-end-time');
        if (!start || !end) return;
        if (start.dataset._globalListenersAttached) return;

        const handler = async (e) => {
            try {
                if (!start.value || !end.value) return;
                if (window._ignoreGlobalCustomRangeRefresher) return;
                window._ignoreGlobalCustomRangeRefresher = true;
                const activeTabElem = document.querySelector('.tab-content.active');
                const tabName = activeTabElem && activeTabElem.id ? activeTabElem.id.replace(/-tab$/,'') : 'positions';
                switch (tabName) {
                    case 'positions': try { await loadPositionStats(); } catch (e) {} break;
                    case 'flights': try { await loadFlights(); } catch (e) {} break;
                    case 'airlines': try { await loadAirlineStats(); } catch (e) {} break;
                    case 'squawk': try { await loadSquawkTransitions(); } catch (e) {} break;
                    case 'reception': try { await loadReceptionRange(); } catch (e) {} break;
                    case 'heatmap': try { await loadHeatmap(); } catch (e) {} break;
                    case 'cache': try { await loadCachePositionStats(); } catch (e) {} break;
                    default: break;
                }
            } finally { window._ignoreGlobalCustomRangeRefresher = false; }
        };

        start.addEventListener('change', handler);
        end.addEventListener('change', handler);
        start.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') handler(ev); });
        end.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') handler(ev); });
        start.dataset._globalListenersAttached = '1';
    } catch (e) {}
}

// Optionally call attach on script load - ensure it's available when DOM ready
try { window.addEventListener('DOMContentLoaded', () => { try { attachGlobalCustomRangeListeners(); } catch (e) {} }); } catch (e) {}

function drawPositionsTimeSeriesGraph(memoryData) {
    const canvas = document.getElementById('positions-timeseries-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (!Array.isArray(memoryData) || memoryData.length === 0) {
        ctx.fillStyle = '#888';
        ctx.font = '16px sans-serif';
        ctx.fillText('No timeseries data available', 20, 200);
        return;
    }
    
    // Determine time extents for this chart. Preference order:
    // 1) Per-tab inputs `positions-start-time` / `positions-end-time`
    // 2) `positionDataSources.startTime` / `positionDataSources.endTime` set by loaders
    // 3) Global `time-window` select mapped to hours back from now
    let startMS = null;
    let endMS = null;
    try {
        const startVal = document.getElementById('positions-start-time')?.value;
        const endVal = document.getElementById('positions-end-time')?.value;
        if (startVal && endVal) {
            startMS = new Date(startVal).getTime();
            endMS = new Date(endVal).getTime();
        }
    } catch (e) {}

    if (!startMS || !endMS) {
        if (positionDataSources.startTime && positionDataSources.endTime) {
            startMS = positionDataSources.startTime;
            endMS = positionDataSources.endTime;
        }
    }

    if (!startMS || !endMS) {
        try {
            const timeWindowSelect = document.getElementById('time-window') || document.getElementById('heatmap-window');
            if (timeWindowSelect && timeWindowSelect.value) {
                const now = Date.now();
                const map = {
                    '1h': 1, '4h': 4, '6h': 6, '8h': 8, '12h': 12, '24h': 24,
                    '1w': 168, '4w': 672
                };
                const hours = map[timeWindowSelect.value] ?? null;
                if (hours) {
                    endMS = now;
                    startMS = now - (hours * 60 * 60 * 1000);
                }
            }
        } catch (e) {}
    }

    // Apply time filtering if we have valid extents
    let filteredData = memoryData;
    if (startMS && endMS) {
        filteredData = memoryData.filter(bucket => {
            const timestamp = bucket.timestamp;
            return timestamp >= startMS && timestamp <= endMS;
        });
    }

    

    
    // Check which metrics to display
    const showPositions = document.getElementById('graph-positions')?.checked ?? true;
    const showAircraft = document.getElementById('graph-aircraft')?.checked ?? true;
    const showFlights = document.getElementById('graph-flights')?.checked ?? true;
    const showAirlines = document.getElementById('graph-airlines')?.checked ?? true;
    
    const padding = { top: 40, right: 150, bottom: 60, left: 80 };
    const chartWidth = canvas.width - padding.left - padding.right;
    const chartHeight = canvas.height - padding.top - padding.bottom;
    // Draw day/night background bands (uses receiver coordinates if available)
    try { if (startMS && endMS && chartWidth > 0 && chartHeight > 0) drawDayNightBackground(ctx, startMS, endMS, padding, chartWidth, chartHeight); } catch (e) {}
    
    // Extract data points from filtered data
    const dataPoints = filteredData.map(bucket => ({
        timestamp: bucket.timestamp,
        positions: bucket.positionCount || 0,
        aircraft: bucket.aircraft?.length || 0,
        flights: bucket.flights?.length || 0,
        airlines: bucket.airlines?.length || 0
    }));
    
    // Find max values for scaling - separate for positions and other metrics
    const maxPositions = Math.max(...dataPoints.map(d => d.positions), 1);
    const maxAircraft = Math.max(...dataPoints.map(d => d.aircraft), 1);
    const maxFlights = Math.max(...dataPoints.map(d => d.flights), 1);
    const maxAirlines = Math.max(...dataPoints.map(d => d.airlines), 1);
    const maxOtherMetrics = Math.max(maxAircraft, maxFlights, maxAirlines);
    
    // Draw axes
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, canvas.height - padding.bottom);
    ctx.lineTo(canvas.width - padding.right, canvas.height - padding.bottom);
    ctx.stroke();
    
    // Draw Y-axis labels - Left axis (Positions)
    ctx.fillStyle = '#42a5f5';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
        const y = canvas.height - padding.bottom - (chartHeight * i / 5);
        const value = Math.round(maxPositions * i / 5);
        ctx.fillText(value.toLocaleString(), padding.left - 10, y + 4);
        
        // Grid lines
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(canvas.width - padding.right, y);
        ctx.stroke();
    }
    
    // Draw Y-axis labels - Right axis (Aircraft/Flights/Airlines)
    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    for (let i = 0; i <= 5; i++) {
        const y = canvas.height - padding.bottom - (chartHeight * i / 5);
        const value = Math.round(maxOtherMetrics * i / 5);
        ctx.fillText(value.toLocaleString(), canvas.width - padding.right + 10, y + 4);
    }
    
    // Draw X-axis labels (time)
    ctx.textAlign = 'center';
    const totalPoints = dataPoints.length;
    const numLabels = Math.min(6, totalPoints);
    const labelDenominator = numLabels > 1 ? numLabels - 1 : 1;
    const divisor = totalPoints > 1 ? totalPoints - 1 : 1;
    for (let i = 0; i < numLabels; i++) {
        const idx = Math.floor(i * (totalPoints - 1) / labelDenominator);
        const clampedIdx = Math.max(0, Math.min(totalPoints - 1, idx));
        const point = dataPoints[clampedIdx];
        if (!point) continue;
        const x = padding.left + (clampedIdx / divisor) * chartWidth;
        if (typeof point.timestamp !== 'number') continue;
        const d = new Date(point.timestamp);
        const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        ctx.fillText(label, x, canvas.height - padding.bottom + 20);
    }
    
    // Function to draw a line with appropriate Y-axis scale
    const drawLine = (data, color, label, usePositionsScale = false) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        const maxScale = usePositionsScale ? maxPositions : maxOtherMetrics;
        
        dataPoints.forEach((point, idx) => {
            const x = padding.left + (idx / (dataPoints.length - 1)) * chartWidth;
            const y = canvas.height - padding.bottom - (point[data] / maxScale) * chartHeight;
            
            if (idx === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        
        ctx.stroke();
    };
    
    // Draw lines for selected metrics
    if (showPositions) drawLine('positions', '#42a5f5', 'Positions', true);
    if (showAircraft) drawLine('aircraft', '#4caf50', 'Aircraft', false);
    if (showFlights) drawLine('flights', '#ff9800', 'Flights', false);
    if (showAirlines) drawLine('airlines', '#f44336', 'Airlines', false);
    
    // Draw legend
    ctx.textAlign = 'left';
    ctx.font = 'bold 14px sans-serif';
    let legendY = padding.top + 10;
    
    if (showPositions) {
        ctx.fillStyle = '#42a5f5';
        ctx.fillRect(canvas.width - padding.right + 10, legendY - 10, 20, 3);
        ctx.fillText('Positions', canvas.width - padding.right + 35, legendY);
        legendY += 25;
    }
    if (showAircraft) {
        ctx.fillStyle = '#4caf50';
        ctx.fillRect(canvas.width - padding.right + 10, legendY - 10, 20, 3);
        ctx.fillText('Aircraft', canvas.width - padding.right + 35, legendY);
        legendY += 25;
    }
    if (showFlights) {
        ctx.fillStyle = '#ff9800';
        ctx.fillRect(canvas.width - padding.right + 10, legendY - 10, 20, 3);
        ctx.fillText('Flights', canvas.width - padding.right + 35, legendY);
        legendY += 25;
    }
    if (showAirlines) {
        ctx.fillStyle = '#f44336';
        ctx.fillRect(canvas.width - padding.right + 10, legendY - 10, 20, 3);
        ctx.fillText('Airlines', canvas.width - padding.right + 35, legendY);
    }
    
    // Y-axis labels
    ctx.save();
    ctx.translate(15, canvas.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#42a5f5';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Positions', 0, 0);
    ctx.restore();
    
    ctx.save();
    ctx.translate(canvas.width - 15, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Aircraft / Flights / Airlines', 0, 0);
    ctx.restore();
    
    // Title
    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    const titleText = (startMS && endMS)
        ? `Position Statistics (${new Date(startMS).toLocaleString()} - ${new Date(endMS).toLocaleString()})`
        : 'Position Statistics Over Time';
    ctx.fillText(titleText, canvas.width / 2, 25);
}

// Update the positions timeseries timescale indicator element with a human-readable timescale
function updatePositionsTimescaleIndicator() {
    try {
        const el = document.getElementById('positions-timescale-indicator');
        if (!el) return;
        const timeWindowSelect = document.getElementById('time-window') || document.getElementById('heatmap-window');
        if (timeWindowSelect && timeWindowSelect.value) {
            const map = {
                '1h': '1h', '4h': '4h', '6h': '6h', '8h': '8h', '12h': '12h', '24h': '24h', '1w': '1w', '4w': '4w', 'all': 'All time'
            };
            el.textContent = map[timeWindowSelect.value] || timeWindowSelect.value;
            return;
        }
        // Otherwise show the manual start/end window
        if (positionDataSources.startTime && positionDataSources.endTime) {
            const ageMinutes = Math.round((positionDataSources.endTime - positionDataSources.startTime) / 60000);
            if (ageMinutes < 60) el.textContent = `${ageMinutes}m`; else el.textContent = `${(ageMinutes/60).toFixed(0)}h`;
            return;
        }
        el.textContent = 'Unknown';
    } catch (e) { /* ignore */ }
}

async function loadPositionStatsLive() {
    try {
        try { showSpinnerForTab('positions', 'Loading live stats…'); } catch (e) {}
        const minutes = parseInt((document.getElementById('positions-live-minutes')?.value) || '10', 10);
        const resolution = parseInt((document.getElementById('positions-live-resolution')?.value) || '1', 10);
        const resp = await fetch(`/api/position-timeseries-live?minutes=${minutes}&resolution=${resolution}`);
        const timeseries = await resp.json();

        const canvas = document.getElementById('position-timeseries-live-canvas');
        if (!canvas) {
            console.warn('Live position stats canvas not found, skipping live stats display');
            try { hideSpinnerForTab('positions', 'Live stats canvas not available'); } catch (e) {}
            return;
        }
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!timeseries || !timeseries.length) {
            ctx.fillStyle = '#666';
            ctx.font = '14px sans-serif';
            ctx.fillText('No live data available.', 10, 20);
            try { hideSpinnerForTab('positions', 'No live data available'); } catch (e) {}
            return;
        }

        // Determine time extents for the live chart (prefer per-tab inputs)
        let liveStart = null, liveEnd = null;
        try {
            const s = document.getElementById('positions-start-time')?.value;
            const e = document.getElementById('positions-end-time')?.value;
            if (s && e) { liveStart = new Date(s).getTime(); liveEnd = new Date(e).getTime(); }
        } catch (err) {}

        if (!liveStart || !liveEnd) {
            if (positionDataSources.startTime && positionDataSources.endTime) {
                liveStart = positionDataSources.startTime;
                liveEnd = positionDataSources.endTime;
            }
        }

        if (!liveStart || !liveEnd) {
            // fall back to minutes window
            const now = Date.now();
            liveEnd = now;
            liveStart = now - (minutes * 60 * 1000);
        }

        // Filter timeseries to requested extents
        let filteredTimeseries = timeseries;
        if (liveStart && liveEnd) {
            filteredTimeseries = timeseries.filter(pt => pt.timestamp >= liveStart && pt.timestamp <= liveEnd);
            if (!filteredTimeseries.length) filteredTimeseries = timeseries; // fall back if filter emptied
        }

        const selectedMetrics = Array.from(document.querySelectorAll('#position-chart-live-controls input:checked')).map(cb => cb.value);
        if (selectedMetrics.length === 0) {
            ctx.fillStyle = '#666';
            ctx.font = '14px sans-serif';
            ctx.fillText('Please select a metric to display.', 10, 20);
            return;
        }

        const colors = {
            positionCount: '#007bff',
            aircraftCount: '#28a745',
            flightCount: '#ffc107',
            airlineCount: '#dc3545'
        };
        const labels = {
            positionCount: 'Positions (Right Axis)',
            aircraftCount: 'Aircraft (Left Axis)',
            flightCount: 'Flights (Left Axis)',
            airlineCount: 'Airlines (Left Axis)'
        };

        const primaryMetrics = selectedMetrics.filter(m => m !== 'positionCount');
        const secondaryMetrics = selectedMetrics.filter(m => m === 'positionCount');

        let maxVPrimary = 1;
        primaryMetrics.forEach(metric => {
            const values = timeseries.map(d => d[metric]);
            const metricMax = Math.max(...values, 1);
            if (metricMax > maxVPrimary) maxVPrimary = metricMax;
        });

        let maxVSecondary = 1;
        secondaryMetrics.forEach(metric => {
            const values = timeseries.map(d => d[metric]);
            const metricMax = Math.max(...values, 1);
            if (metricMax > maxVSecondary) maxVSecondary = metricMax;
        });

        const padLeft = 40, padRight = 40, padTop = 10, padBottom = 24;
        const w = canvas.width - padLeft - padRight;
        const h = canvas.height - padTop - padBottom;
        // Draw day/night background for live chart if coordinates available
        try {
            const padding = { left: padLeft, top: padTop, right: padRight, bottom: padBottom };
            if (liveStart && liveEnd && w > 0 && h > 0) drawDayNightBackground(ctx, liveStart, liveEnd, padding, w, h);
        } catch (e) {}

        ctx.strokeStyle = '#ccc';
        ctx.fillStyle = '#444';
        ctx.font = '12px sans-serif';

        for (let i = 0; i <= 4; i++) {
            const y = padTop + (h * i / 4);
            const val = Math.round(maxVPrimary - (i * maxVPrimary / 4));
            ctx.fillText(val.toString(), 4, y + 4);
            ctx.beginPath();
            ctx.moveTo(padLeft, y);
            ctx.lineTo(padLeft + w, y);
            ctx.stroke();
        }

        if (secondaryMetrics.length > 0) {
            ctx.textAlign = "right";
            for (let i = 0; i <= 4; i++) {
                const y = padTop + (h * i / 4);
                const val = Math.round(maxVSecondary - (i * maxVSecondary / 4));
                ctx.fillText(val.toString(), canvas.width - 4, y + 4);
            }
            ctx.textAlign = "left";
        }
        
        ctx.beginPath();
        ctx.moveTo(padLeft, padTop);
        ctx.lineTo(padLeft, padTop + h);
        ctx.lineTo(padLeft + w, padTop + h);
        ctx.stroke();

        // Draw x-axis time labels
        ctx.fillStyle = '#999';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        const numLabels = Math.min(6, filteredTimeseries.length);
        const divisor = Math.max(1, filteredTimeseries.length - 1);
        for (let i = 0; i < numLabels; i++) {
            const idx = Math.floor((filteredTimeseries.length - 1) * i / Math.max(1, numLabels - 1));
            const pt = filteredTimeseries[idx];
            const x = padLeft + (w * idx / divisor);
            const d = new Date(pt.timestamp);
            const timeStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
            ctx.fillText(timeStr, x, padTop + h + 14);
        }
        ctx.textAlign = 'left';

        primaryMetrics.forEach(metric => {
            ctx.strokeStyle = colors[metric];
            ctx.lineWidth = 2;
            ctx.beginPath();
            filteredTimeseries.forEach((pt, idx) => {
                const x = padLeft + (w * idx / divisor);
                const y = padTop + h - (pt[metric] / maxVPrimary) * h;
                if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
            
            // Draw dots for each point
            ctx.fillStyle = colors[metric];
            filteredTimeseries.forEach((pt, idx) => {
                const x = padLeft + (w * idx / divisor);
                const y = padTop + h - (pt[metric] / maxVPrimary) * h;
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, 2 * Math.PI);
                ctx.fill();
            });
        });

        secondaryMetrics.forEach(metric => {
            ctx.strokeStyle = colors[metric];
            ctx.lineWidth = 2;
            ctx.beginPath();
            timeseries.forEach((pt, idx) => {
                const x = padLeft + (w * idx / divisor);
                const y = padTop + h - (pt[metric] / maxVSecondary) * h;
                if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
            
            // Draw dots for each point
            ctx.fillStyle = colors[metric];
            timeseries.forEach((pt, idx) => {
                const x = padLeft + (w * idx / divisor);
                const y = padTop + h - (pt[metric] / maxVSecondary) * h;
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, 2 * Math.PI);
                ctx.fill();
            });
        });
        
        let legendX = padLeft + 10;
        selectedMetrics.forEach(metric => {
            ctx.fillStyle = colors[metric];
            ctx.fillRect(legendX, padTop + h + 10, 10, 10);
            ctx.fillStyle = '#333';
            ctx.fillText(labels[metric], legendX + 15, padTop + h + 18);
            legendX += ctx.measureText(labels[metric]).width + 30;
        });

            // Store a compact summary (positions & aircraft counts) for the positions UI
            try {
                const summaryEl = document.getElementById('positions-timescale-indicator');
                if (summaryEl) {
                    try {
                        let totalPositions = 0;
                        const acSet = new Set();
                        filteredTimeseries.forEach(pt => {
                            totalPositions += pt.positionCount || 0;
                            if (Array.isArray(pt.aircraft)) pt.aircraft.forEach(a => acSet.add(a));
                        });
                        const summaryHtml = `<strong>Positions:</strong> ${totalPositions.toLocaleString()} • <strong>Aircraft:</strong> ${acSet.size.toLocaleString()}`;
                        summaryEl.dataset._previousHtml = summaryHtml;
                        if (liveStart && liveEnd) {
                            const s = new Date(liveStart).toLocaleString();
                            const e = new Date(liveEnd).toLocaleString();
                            summaryEl.dataset.filterCriteria = `Range: ${s} → ${e}`;
                        } else {
                            summaryEl.dataset.filterCriteria = `Window: ${minutes}m`;
                        }
                    } catch (e) {}
                }
            } catch (e) {}

    } catch (error) {
        console.error('Error loading live position stats:', error);
    }
}

async function loadCachePositionStats() {
    try {
    try { showSpinnerForTab('cache'); } catch (e) {}
        const resp = await fetch('/api/v2/cache-status');
        const data = await resp.json();
        
        // Get the total positions count from the cache
        const totalCachedPositions = data.positionCache?.totalPositions || 0;
        const uniqueAircraft = data.positionCache?.uniqueAircraft || 0;
        
        if (totalCachedPositions === 0) {
            document.getElementById('cache-position-stats-summary').innerHTML = '<strong>No cache data available</strong>';
            const canvas = document.getElementById('cache-position-stats-canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#999';
                ctx.font = '14px sans-serif';
                ctx.fillText('No position data in cache', 50, canvas.height / 2);
            }
            return;
        }

        // Since we don't have individual timestamps for cached positions,
        // we'll show a simple summary based on the cache status
        const summaryHtml = `
            <strong>Position Cache Statistics:</strong><br>
            Total Positions: ${totalCachedPositions} | Unique Aircraft: ${uniqueAircraft} | 
            Last Refresh: ${data.positionCache?.lastRefresh || 'N/A'} | 
            Cache Size: ${data.positionCache?.cacheMemoryMb || 0} MB
        `;
        try {
            // Write to the detailed summary area
            const detailed = document.getElementById('cache-position-stats-summary');
            if (detailed) detailed.innerHTML = summaryHtml;
            // Also store compact summary for the top-of-tab summary area
            const summaryEl = document.getElementById('cache-summary');
            if (summaryEl) {
                try {
                    const compact = `<strong>Positions:</strong> ${totalCachedPositions.toLocaleString()} • <strong>Aircraft:</strong> ${uniqueAircraft.toLocaleString()}`;
                    summaryEl.dataset._previousHtml = compact;
                    summaryEl.dataset.filterCriteria = `Last Refresh: ${data.positionCache?.lastRefresh || 'N/A'}`;
                } catch (e) {}
            }
        } catch (e) {}
        
        // Draw a simple bar chart showing cache composition
        const canvas = document.getElementById('cache-position-stats-canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw title
        ctx.fillStyle = '#333';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText('Position Cache Distribution', 10, 20);
        
        // Calculate average positions per aircraft
        const avgPerAircraft = uniqueAircraft > 0 ? (totalCachedPositions / uniqueAircraft).toFixed(1) : 0;
        
        // Draw bars
        const barWidth = 80;
        const barHeight = 100;
        const startX = 50;
        const startY = canvas.height - 80;
        
        // Bar 1: Total Positions
        ctx.fillStyle = '#1976d2';
        const posBar = Math.min((totalCachedPositions / 10000) * barHeight, barHeight);
        ctx.fillRect(startX, startY - posBar, barWidth, posBar);
        ctx.fillStyle = '#333';
        ctx.font = '12px sans-serif';
        ctx.fillText('Positions', startX + 15, startY + 20);
        ctx.fillText(totalCachedPositions, startX + 25, startY + 40);
        
        // Bar 2: Unique Aircraft
        ctx.fillStyle = '#2e7d32';
        const aircraftBar = Math.min((uniqueAircraft / 100) * barHeight, barHeight);
        ctx.fillRect(startX + 120, startY - aircraftBar, barWidth, aircraftBar);
        ctx.fillStyle = '#333';
        ctx.fillText('Aircraft', startX + 135, startY + 20);
        ctx.fillText(uniqueAircraft, startX + 145, startY + 40);
        
        // Bar 3: Average per aircraft
        ctx.fillStyle = '#f57c00';
        const avgBar = Math.min((avgPerAircraft / 20) * barHeight, barHeight);
        ctx.fillRect(startX + 240, startY - avgBar, barWidth, avgBar);
        ctx.fillStyle = '#333';
        ctx.fillText('Avg/AC', startX + 255, startY + 20);
        ctx.fillText(avgPerAircraft, startX + 255, startY + 40);
        
        // Draw scale
        ctx.fillStyle = '#999';
        ctx.font = '10px sans-serif';
        ctx.fillText('0', startX - 10, startY + 5);
        ctx.fillText('Max', startX - 15, startY - barHeight + 5);
        
        try { hideSpinnerForTab('cache'); } catch (e) {}
    } catch (error) {
        console.error('Error loading cache position stats:', error);
        document.getElementById('cache-position-stats-summary').innerHTML = `<strong style="color: red;">Error: ${error.message}</strong>`;
        try { hideSpinnerForTab('cache', `<span style=\"color:#f44336;\">Error loading cache stats</span>`); } catch (e) {}
    }
}

async function loadPositionStats() {
    try {
        try { showSpinnerForTab('positions', 'Loading historical stats…'); } catch (e) {}
        // Check if time range inputs are provided
        const startElem = document.getElementById('positions-start-time');
        const endElem = document.getElementById('positions-end-time');
        
        let hours = parseInt((document.getElementById('positions-hours')?.value) || '24', 10);
        let queryUrl = `/api/historical-stats?hours=${hours}`;
        let usingTimeRange = false;
        
        // If time range is specified, use it instead
        if (startElem && startElem.value && endElem && endElem.value) {
            const startTime = new Date(startElem.value).getTime();
            const endTime = new Date(endElem.value).getTime();
            queryUrl = `/api/historical-stats?startTime=${startTime}&endTime=${endTime}`;
            hours = Math.ceil((endTime - startTime) / (60 * 60 * 1000));
            usingTimeRange = true;
        }
        
        // Custom bucket logic:
        // 10 or 30 min = 1 min buckets, 1 hour = 10 min buckets, longer = previous scaling, max 60 min
        let resolution = 60;
        if (hours * 60 === 10 || hours * 60 === 30) {
            resolution = 1;
        } else if (hours === 1) {
            resolution = 10;
        } else if (hours <= 6) {
            resolution = 10;
        } else if (hours <= 12) {
            resolution = 30;
        }
        if (resolution > 60) resolution = 60;
        
        queryUrl += `&resolution=${resolution}`;
        
        const resp = await fetch(queryUrl);
        const data = await resp.json();
        const timeseries = Array.isArray(data.timeSeries) ? data.timeSeries : [];

        const canvas = document.getElementById('position-timeseries-canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!timeseries || !timeseries.length) {
            ctx.fillStyle = '#666';
            ctx.font = '14px sans-serif';
            ctx.fillText('No data available for this time period.', 10, 20);
            try { hideSpinnerForTab('positions', 'No data available for this time period'); } catch (e) {}
            return;
        }

        // Display time range text if using time range
        if (usingTimeRange && startElem && startElem.value && endElem && endElem.value) {
            const startTime = new Date(startElem.value);
            const endTime = new Date(endElem.value);
            const startStr = startTime.toLocaleString();
            const endStr = endTime.toLocaleString();
            ctx.fillStyle = '#333';
            ctx.font = 'bold 12px sans-serif';
            ctx.fillText(`Range: ${startStr} → ${endStr}`, 10, 15);
        }

        // Map metrics to new data structure
        const selectedMetrics = Array.from(document.querySelectorAll('#position-chart-controls input:checked')).map(cb => cb.value);
        if (selectedMetrics.length === 0) {
            ctx.fillStyle = '#666';
            ctx.font = '14px sans-serif';
            ctx.fillText('Please select a metric to display.', 10, 20);
            try { hideSpinnerForTab('positions', 'Please select a metric to display'); } catch (e) {}
            return;
        }

        // Map old metric names to new keys
        const metricMap = {
            positionCount: 'positions',
            aircraftCount: 'aircraft',
            flightCount: 'flights',
            airlineCount: 'airlines'
        };
        const colors = {
            positionCount: '#007bff',
            aircraftCount: '#28a745',
            flightCount: '#ffc107',
            airlineCount: '#dc3545'
        };
        const labels = {
            positionCount: 'Positions (Right Axis)',
            aircraftCount: 'Aircraft (Left Axis)',
            flightCount: 'Flights (Left Axis)',
            airlineCount: 'Airlines (Left Axis)'
        };

        // Separate metrics for each axis
        const primaryMetrics = selectedMetrics.filter(m => m !== 'positionCount');
        const secondaryMetrics = selectedMetrics.filter(m => m === 'positionCount');

        // Calculate max values for each axis
        let maxVPrimary = 1;
        primaryMetrics.forEach(metric => {
            const key = metricMap[metric];
            const values = timeseries.map(d => d[key]);
            const metricMax = Math.max(...values, 1);
            if (metricMax > maxVPrimary) maxVPrimary = metricMax;
        });

        let maxVSecondary = 1;
        secondaryMetrics.forEach(metric => {
            const key = metricMap[metric];
            const values = timeseries.map(d => d[key]);
            const metricMax = Math.max(...values, 1);
            if (metricMax > maxVSecondary) maxVSecondary = metricMax;
        });

        const padLeft = 40, padRight = 40, padTop = 10, padBottom = 24;
        const w = canvas.width - padLeft - padRight;
        const h = canvas.height - padTop - padBottom;

        // --- Draw Axes and Grids ---
        ctx.strokeStyle = '#ccc';
        ctx.fillStyle = '#444';
        ctx.font = '12px sans-serif';

        // Primary Y-axis (Left)
        for (let i = 0; i <= 4; i++) {
            const y = padTop + (h * i / 4);
            const val = Math.round(maxVPrimary - (i * maxVPrimary / 4));
            ctx.fillText(val.toString(), 4, y + 4);
            ctx.beginPath();
            ctx.moveTo(padLeft, y);
            ctx.lineTo(padLeft + w, y);
            ctx.stroke();
        }

        // Secondary Y-axis (Right)
        if (secondaryMetrics.length > 0) {
            ctx.textAlign = "right";
            for (let i = 0; i <= 4; i++) {
                const y = padTop + (h * i / 4);
                const val = Math.round(maxVSecondary - (i * maxVSecondary / 4));
                ctx.fillText(val.toString(), canvas.width - 4, y + 4);
            }
            ctx.textAlign = "left";
        }

        ctx.beginPath();
        ctx.moveTo(padLeft, padTop);
        ctx.lineTo(padLeft, padTop + h);
        ctx.lineTo(padLeft + w, padTop + h);
        ctx.stroke();

        // Draw x-axis time labels
        ctx.fillStyle = '#999';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        const numLabels = Math.min(8, timeseries.length);
        const divisor = Math.max(1, timeseries.length - 1);
        for (let i = 0; i < numLabels; i++) {
            const idx = Math.floor((timeseries.length - 1) * i / Math.max(1, numLabels - 1));
            const pt = timeseries[idx];
            const x = padLeft + (w * idx / divisor);
            const time = new Date(pt.timestamp);
            const timeStr = `${time.getMonth() + 1}/${time.getDate()} ${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;
            
            // Rotate the labels for better readability
            ctx.save();
            ctx.translate(x, padTop + h + 14);
            ctx.rotate(-Math.PI / 4);
            ctx.fillText(timeStr, 0, 0);
            ctx.restore();
        }
        ctx.textAlign = 'left';

        // --- Draw Data Lines ---
        // Primary metrics
        primaryMetrics.forEach(metric => {
            const key = metricMap[metric];
            ctx.strokeStyle = colors[metric];
            ctx.lineWidth = 2;
            ctx.beginPath();
            timeseries.forEach((pt, idx) => {
                const x = padLeft + (w * idx / divisor);
                const y = padTop + h - (pt[key] / maxVPrimary) * h;
                if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
            // Draw dots for each point
            ctx.fillStyle = colors[metric];
            timeseries.forEach((pt, idx) => {
                const x = padLeft + (w * idx / divisor);
                const y = padTop + h - (pt[key] / maxVPrimary) * h;
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, 2 * Math.PI);
                ctx.fill();
            });
        });

        // Secondary metrics
        secondaryMetrics.forEach(metric => {
            const key = metricMap[metric];
            ctx.strokeStyle = colors[metric];
            ctx.lineWidth = 2;
            ctx.beginPath();
            timeseries.forEach((pt, idx) => {
                const x = padLeft + (w * idx / divisor);
                const y = padTop + h - (pt[key] / maxVSecondary) * h;
                if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
            // Draw dots for each point
            ctx.fillStyle = colors[metric];
            timeseries.forEach((pt, idx) => {
                const x = padLeft + (w * idx / divisor);
                const y = padTop + h - (pt[key] / maxVSecondary) * h;
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, 2 * Math.PI);
                ctx.fill();
            });
        });

        // Draw legend
        let legendX = padLeft + 10;
        selectedMetrics.forEach(metric => {
            ctx.fillStyle = colors[metric];
            ctx.fillRect(legendX, padTop + h + 10, 10, 10);
            ctx.fillStyle = '#333';
            ctx.fillText(labels[metric], legendX + 15, padTop + h + 18);
            legendX += ctx.measureText(labels[metric]).width + 30;
        });

        // Build and store a compact summary for the positions summary area
        try {
            const summaryEl = document.getElementById('positions-timescale-indicator');
            if (summaryEl) {
                try {
                    // Compute aggregated counts from timeseries
                    let totalPositions = 0;
                    const acSet = new Set();
                    const flSet = new Set();
                    const alSet = new Set();
                    timeseries.forEach(pt => {
                        totalPositions += pt.positions || 0;
                        if (Array.isArray(pt.aircraft)) pt.aircraft.forEach(a => acSet.add(a));
                        if (Array.isArray(pt.flights)) pt.flights.forEach(f => flSet.add(f));
                        if (Array.isArray(pt.airlines)) pt.airlines.forEach(a => alSet.add(a));
                    });
                    const summaryHtml = `<strong>Positions:</strong> ${totalPositions.toLocaleString()} • <strong>Aircraft:</strong> ${acSet.size.toLocaleString()}`;
                    summaryEl.dataset._previousHtml = summaryHtml;
                    if (usingTimeRange && startElem && startElem.value && endElem && endElem.value) {
                        summaryEl.dataset.filterCriteria = `Range: ${new Date(startElem.value).toLocaleString()} → ${new Date(endElem.value).toLocaleString()}`;
                    } else {
                        summaryEl.dataset.filterCriteria = `Window: ${hours}h`;
                    }
                } catch (e) {}
            }
        } catch (e) {}
        try { hideSpinnerForTab('positions'); } catch (e) {}

        try { hideSpinnerForTab('positions'); } catch (e) {}
    } catch (error) {
        console.error('Error loading position stats:', error);
        try { hideSpinnerForTab('positions', `<span style="color:#f44336;">Error loading positions</span>`); } catch (e) {}
    }
}

async function loadSquawkTransitions(hoursBack = null) {
    try {
        try { showSpinnerForTab('squawk'); } catch (e) {}
        const startElem = document.getElementById('squawk-start-time') || document.getElementById('positions-start-time');
        const endElem = document.getElementById('squawk-end-time') || document.getElementById('positions-end-time');
        
        // Helper function to format timestamp as local datetime string
        const formatLocalDateTime = (timestamp) => {
            const d = new Date(timestamp);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const minutes = String(d.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        };
        
        // Helper function to parse local datetime string to timestamp
        const parseLocalDateTime = (localDateTimeStr) => {
            const parts = localDateTimeStr.split('T');
            const [year, month, day] = parts[0].split('-');
            const [hours, minutes] = parts[1].split(':');
            return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
        };
        
        let startTime, endTime;
        
        // If hoursBack is provided, use it (from quick buttons) - always use current time as end
        if (hoursBack !== null) {
            const now = new Date();
            endTime = now.getTime();
            startTime = endTime - (hoursBack * 60 * 60 * 1000);
            
            // Update input fields to reflect the selection (in local time)
            startElem.value = formatLocalDateTime(startTime);
            endElem.value = formatLocalDateTime(endTime);
        }
        // User clicked refresh with custom times
        else if (startElem && startElem.value && endElem && endElem.value) {
            // User provided times via datetime-local input (in LOCAL timezone)
            startTime = parseLocalDateTime(startElem.value);
            const userEndTime = parseLocalDateTime(endElem.value);
            
            // If the user's end time is in the future or within 2 minutes of now, update it to now
            const now = Date.now();
            const twoMinutesAgo = now - (2 * 60 * 1000);
            
            if (userEndTime >= twoMinutesAgo) {
                // End time is current or very recent, update it to now
                endTime = now;
                endElem.value = formatLocalDateTime(endTime);
            } else {
                // End time is in the past (historical query), keep it as-is
                endTime = userEndTime;
            }
            isCustomRange = true;
        }
        // Default to last 1 hour if no times are set
        else {
            const now = new Date();
            endTime = now.getTime();
            startTime = endTime - (1 * 60 * 60 * 1000); // 1 hour ago
            
            // Set the input values to reflect the default range (in local time)
            startElem.value = formatLocalDateTime(startTime);
            endElem.value = formatLocalDateTime(endTime);
        }
        
        // Fetch squawk transition data
        const response = await fetch(`/api/squawk-transitions?startTime=${startTime}&endTime=${endTime}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        // Display summary
        const summaryDiv = document.getElementById('squawk-summary');
        if (summaryDiv) {
            const startDate = new Date(startTime);
            const endDate = new Date(endTime);
            const timeRangeText = `${startDate.toLocaleString()} to ${endDate.toLocaleString()}`;
            
            summaryDiv.innerHTML = `
                <div style="padding: 12px; background: #1e1e1e; border-radius: 4px; margin: 12px 0; border-left: 4px solid #42a5f5; color: #e0e0e0;">
                    <strong style="color: #fff;">Total Transitions: ${data.totalTransitions ?? 0}</strong>
                    <div style="font-size: 12px; color: #bbb; margin-top: 6px;">Time Range: ${timeRangeText}</div>
                </div>
            `;
            try { setComputedRangeUI('squawk', startTime, endTime, isCustomRange); } catch (e) {}
        }

        // Helper to format transitions as table rows
        const formatTransition = (t) => {
            if (!t) return '';
            const dt = new Date(t.timestamp || Date.now());
            const timeStr = dt.toLocaleString('en-US', { 
                month: '2-digit', 
                day: '2-digit',
                year: 'numeric',
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit',
                hour12: false 
            });
            const reg = t.registration || t.hex || 'Unknown';
            const flight = t.flight || 'N/A';
            const type = t.type || 'N/A';
            const manufacturer = t.manufacturer || 'N/A';
            const altText = t.altitude ? t.altitude.toLocaleString() : 'N/A';
            const minutesSince = t.minutesSinceLast || 0;
            
            // Airline info
            const airlineCode = t.airlineCode || '';
            const airlineName = t.airlineName || '';
            const airlineDisplay = airlineName ? `${airlineCode} - ${airlineName}` : (airlineCode || 'N/A');
            
                        const hexVal = t.hex || t.icao || '';
                        let hexCell = 'N/A';
                        if (hexVal) {
                            if (t.flight) {
                                hexCell = `<a href="https://flightaware.com/live/flight/${encodeURIComponent(t.flight)}" target="_blank" rel="noopener noreferrer">${hexVal}</a>`;
                            } else {
                                hexCell = `${hexVal}`;
                            }
                        }

            return `<tr data-timestamp="${t.timestamp || 0}" data-hex="${t.hex || ''}" data-flight="${flight}" data-reg="${reg}" data-type="${type}" data-manufacturer="${manufacturer}" data-airline="${airlineDisplay}" data-from="${t.from}" data-to="${t.to}" data-altitude="${t.altitude || 0}" data-minutes="${minutesSince}">
                <td>${timeStr}</td>
                <td>${hexCell}</td>
                <td>${flight}</td>
                <td>${reg}</td>
                <td>${type}</td>
                <td>${manufacturer}</td>
                <td>${airlineDisplay}</td>
                <td>${t.from}</td>
                <td>${t.to}</td>
                <td>${altText}</td>
                <td>${minutesSince}</td>
            </tr>`;
        };

        // Categorize transitions
        const allTransitions = data.transitions || [];
        const vfr = [];
        const ifrLow = [];
        const ifrHigh = [];
        const special = [];
        const other = [];
        
        allTransitions.forEach(t => {
            const from = t.from;
            const to = t.to;
            
            // Check if either from or to involves special codes
            if (from === '7500' || to === '7500' || from === '7600' || to === '7600' || from === '7700' || to === '7700') {
                special.push(t);
            }
            // Check if either from or to is VFR (1200)
            else if (from === '1200' || to === '1200') {
                vfr.push(t);
            }
            // IFR LOW: 0000-1777 (excluding 1200)
            else if ((parseInt(from) >= 0 && parseInt(from) <= 1777) || (parseInt(to) >= 0 && parseInt(to) <= 1777)) {
                ifrLow.push(t);
            }
            // IFR HIGH: 2000-7777 (excluding special codes)
            else if ((parseInt(from) >= 2000 && parseInt(from) <= 7777) || (parseInt(to) >= 2000 && parseInt(to) <= 7777)) {
                ifrHigh.push(t);
            }
            // Everything else
            else {
                other.push(t);
            }
        });
        
        // Display categorized transitions
        const vfrList = document.getElementById('vfr-transitions');
        const ifrLowList = document.getElementById('ifr-low-transitions');
        const ifrHighList = document.getElementById('ifr-high-transitions');
        const specialList = document.getElementById('special-transitions');
        const otherList = document.getElementById('other-transitions');
        
        const emptyMessage = '<tr><td colspan="11" style="color: #999; padding: 20px; text-align: center; background: #2a2a2a;">No transitions in this category</td></tr>';
        
        if (vfrList) {
            vfrList.innerHTML = vfr.length > 0 ? vfr.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).map(formatTransition).join('') : emptyMessage;
        }
        if (ifrLowList) {
            ifrLowList.innerHTML = ifrLow.length > 0 ? ifrLow.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).map(formatTransition).join('') : emptyMessage;
        }
        if (ifrHighList) {
            ifrHighList.innerHTML = ifrHigh.length > 0 ? ifrHigh.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).map(formatTransition).join('') : emptyMessage;
        }
        if (specialList) {
            specialList.innerHTML = special.length > 0 ? special.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).map(formatTransition).join('') : emptyMessage;
        }
        if (otherList) {
            otherList.innerHTML = other.length > 0 ? other.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).map(formatTransition).join('') : emptyMessage;
        }
        
        // Make tables sortable
        try {
            makeSortable(document.getElementById('vfr-transitions-table'));
            makeSortable(document.getElementById('ifr-low-transitions-table'));
            makeSortable(document.getElementById('ifr-high-transitions-table'));
            makeSortable(document.getElementById('special-transitions-table'));
            makeSortable(document.getElementById('other-transitions-table'));
        } catch (e) {
            console.warn('Failed to make squawk tables sortable:', e);
        }
        
        try { hideSpinnerForTab('squawk'); } catch (e) {}
            
    } catch (error) {
        console.error('Error loading squawk transitions:', error);
        const summaryDiv = document.getElementById('squawk-summary');
        if (summaryDiv) {
            summaryDiv.innerHTML = `<div style="color: #d32f2f; padding: 12px; background: #ffebee; border-radius: 4px;">Error loading data: ${error.message}</div>`;
        }
    }
}

async function loadFlights(hoursBack = null) {
    try {
        try { window._lastLoadFlights = Date.now(); } catch (e) {}
        try { showSpinnerForTab('flights'); } catch (e) {}
        let isCustomRange = false;
        const gap = document.getElementById('flights-gap').value || '5';
        const startElem = document.getElementById('flights-start-time') || document.getElementById('positions-start-time');
        const endElem = document.getElementById('flights-end-time') || document.getElementById('positions-end-time');
        
        // Helper function to format timestamp as local datetime string
        const formatLocalDateTime = (timestamp) => {
            const d = new Date(timestamp);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const minutes = String(d.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        };
        
        let windowVal = '1h'; // default
        
        // If hoursBack is provided, use it (from quick buttons)
        if (hoursBack !== null) {
            const now = new Date();
            const endTime = now.getTime();
            const startTime = endTime - (hoursBack * 60 * 60 * 1000);
            
            // Update input fields
            startElem.value = formatLocalDateTime(startTime);
            endElem.value = formatLocalDateTime(endTime);
            
            windowVal = hoursBack + 'h';
        }
        // Use custom times if set
        else if (startElem && startElem.value && endElem && endElem.value) {
            // Calculate hours difference for window parameter
            const parseLocalDateTime = (localDateTimeStr) => {
                const parts = localDateTimeStr.split('T');
                const [year, month, day] = parts[0].split('-');
                const [hours, minutes] = parts[1].split(':');
                return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
            };
            
            const startTime = parseLocalDateTime(startElem.value);
            let endTime = parseLocalDateTime(endElem.value);
            
            // Auto-update end time if it's recent
            const now = Date.now();
            const twoMinutesAgo = now - (2 * 60 * 1000);
            if (endTime >= twoMinutesAgo) {
                endTime = now;
                endElem.value = formatLocalDateTime(endTime);
            }
            
            const hours = Math.ceil((endTime - startTime) / (60 * 60 * 1000));
            isCustomRange = true;
            windowVal = hours + 'h';
        }
        // Default to last 1 hour
        else {
            const now = new Date();
            const endTime = now.getTime();
            const startTime = endTime - (1 * 60 * 60 * 1000);
            
            startElem.value = formatLocalDateTime(startTime);
            endElem.value = formatLocalDateTime(endTime);
            
            windowVal = '1h';
        }
        
        // Show loading indicator in the flights summary area
        try {
            const summaryDiv = document.getElementById('flights-summary');
            if (summaryDiv) summaryDiv.innerHTML = `<span class="spinner" aria-hidden="true"></span><span class="loading-text">Loading flights…</span>`;
        } catch (err) {}
        const response = await fetch(`/api/flights?gap=${gap}&window=${windowVal}`);
        const data = await response.json();
        const tableBody = document.getElementById('flights-table-body');
        
        // Save current sort state before clearing table
        const table = tableBody.closest('table');
        saveTableSortState(table);
        
        // Build a map of existing rows keyed by flight key so we can reuse nodes and avoid blinking
        const existingFlightRows = new Map();
        try {
            const rows = Array.from(tableBody.querySelectorAll('tr'));
            rows.forEach(r => { if (r.dataset && r.dataset.flightKey) existingFlightRows.set(r.dataset.flightKey, r); });
        } catch (e) { /* ignore */ }
        
        tableBody.innerHTML = '';
        
        const all = (data.active || []).concat(data.flights || []);
        // Deduplicate flights on the frontend in case of duplicates from the API/live updates
        const unique = [];
        const seen = new Set();
        for (const fl of all) {
            const key = `${(fl.icao||fl.hex||'').toLowerCase()}|${(fl.callsign||'').toUpperCase()}|${fl.start_time||''}|${fl.end_time||''}|${(fl.registration||'').toUpperCase()}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(fl);
            }
        }
        const allUnique = unique;
        const completedCount = (data.flights || []).length;
        const activeCount = (data.active || []).length;
        const totalCount = allUnique.length;
        
        // Update summary: store as dataset values so hideSpinnerForTab can render counts + last lookup
        try {
            const summaryDiv = document.getElementById('flights-summary');
            if (summaryDiv) {
                try {
                    const summaryHtml = totalCount > 0
                        ? `Total Flights: <strong>${totalCount}</strong> | Active: <strong>${activeCount}</strong> | No Longer Seen: <strong>${completedCount}</strong>`
                        : 'No flights found';
                    summaryDiv.dataset._previousHtml = summaryHtml;
                    if (isCustomRange && typeof startTime !== 'undefined' && typeof endTime !== 'undefined') {
                        summaryDiv.dataset.filterCriteria = `Range: ${formatLocalDateTime(startTime)} → ${formatLocalDateTime(endTime)}`;
                    } else {
                        summaryDiv.dataset.filterCriteria = `Window: ${windowVal}`;
                    }
                } catch (e) {}
            }
        } catch (e) {}
        
            if (!data || (!data.flights && !data.active)) {
            tableBody.innerHTML = '<tr><td colspan="21">No flights found</td></tr>';
                try { setComputedRangeUI('flights', startTime, endTime, isCustomRange); } catch (e) {}
                try { if (summaryDiv) summaryDiv.innerHTML = 'No flights found'; } catch (e) {}
            return;
        }

        // Load airline DB for fallback validations
        const loadAirlineDB = async () => {
            if (window.airlineDB) return window.airlineDB;
            // Try localStorage first
            try {
                const item = localStorage.getItem('airlineDB-v1');
                if (item) {
                    const parsed = JSON.parse(item);
                    if (parsed && parsed.ts && (Date.now() - parsed.ts) < AIRLINE_DB_TTL_MS && parsed.data) {
                        window.airlineDB = parsed.data;
                        try { updateAirlineDBIndicator(); } catch (e) { /* ignore */ }
                        return window.airlineDB;
                    }
                }
            } catch (error) {
                try { console.error('Error loading airline flights:', error); } catch (e) {}
                const summaryElem = document.getElementById('airline-flights-summary');
                if (summaryElem) summaryElem.innerHTML = `<span style="color: #f44336;">Error loading flights: ${error.message}</span>`;
                try { hideSpinnerForTab('airline-flights', `<span style=\"color:#f44336;\">Error loading flights</span>`); } catch (e) {}
            }
            // Try fetching airline database from server
            try {
                const resp = await fetch('/api/airline-database');
                if (resp.ok) {
                    window.airlineDB = await resp.json();
                    try { updateAirlineDBIndicator(); } catch (e) { /* ignore */ }
                    try { localStorage.setItem('airlineDB-v1', JSON.stringify({ ts: Date.now(), data: window.airlineDB })); } catch (err) { console.warn('localStorage airlineDB write failed', err); }
                    return window.airlineDB;
                }
                if (resp.status === 304) {
                    if (window.airlineDB) return window.airlineDB;
                    // try localStorage if we haven't yet
                    try {
                        const item = localStorage.getItem('airlineDB-v1');
                        if (item) {
                            const parsed = JSON.parse(item);
                            if (parsed && parsed.ts && (Date.now() - parsed.ts) < AIRLINE_DB_TTL_MS && parsed.data) {
                                window.airlineDB = parsed.data;
                                try { updateAirlineDBIndicator(); } catch (e) { /* ignore */ }
                                return window.airlineDB;
                            }
                        }
                    } catch (err) { console.warn('localStorage airlineDB read failed (304 fallback)', err); }
                    const forced = await fetch('/api/airline-database', { cache: 'no-cache' });
                    if (forced.ok) {
                        window.airlineDB = await forced.json();
                        try { updateAirlineDBIndicator(); } catch (e) { /* ignore */ }
                        try { localStorage.setItem('airlineDB-v1', JSON.stringify({ ts: Date.now(), data: window.airlineDB })); } catch (err) { console.warn('localStorage airlineDB write failed', err); }
                        return window.airlineDB;
                    }
                }
            } catch (err) {
                console.warn('Could not load airline database for flights table:', err);
            }
            return {};
        };
        const airlineDB = await loadAirlineDB();

        for (const fl of allUnique) {
            // Compute row key to support reusing rows across updates
            const rowKey = `${(fl.icao||fl.hex||'').toLowerCase()}|${(fl.callsign||'').toUpperCase()}|${fl.start_time||''}|${fl.end_time||''}|${(fl.registration||'').toUpperCase()}`;
            let row = existingFlightRows.get(rowKey);
            if (row) {
                // Reuse row element, but clear its contents to avoid appending duplicate cells
                existingFlightRows.delete(rowKey);
                try { while (row.firstChild) row.removeChild(row.firstChild); } catch (e) { row.innerHTML = ''; }
            } else {
                row = document.createElement('tr');
            }
            // Compute duration if missing
            let duration = fl.duration_min;
            if (duration === undefined || duration === null) {
                if (fl.start_ts && fl.end_ts) {
                    duration = ((fl.end_ts - fl.start_ts) / 60000).toFixed(2);
                } else {
                    duration = '';
                }
            }
            
            // Convert start_time and end_time from Zulu to local time
            let startTimeLocal = fl.start_time;
            let endTimeLocal = fl.end_time;
            if (fl.start_time) {
                const startDate = new Date(fl.start_time);
                startTimeLocal = startDate.toLocaleString();
            }
            if (fl.end_time) {
                const endDate = new Date(fl.end_time);
                endTimeLocal = endDate.toLocaleString();
            }
            
            // Format type with model
            let typeDisplay = fl.type || '';
            if (fl.aircraft_model && fl.aircraft_model !== 'N/A') {
                typeDisplay = `<span title="${fl.aircraft_model}">${fl.type || ''}</span>`;
            }
            
            // Determine airline logo: prefer API-provided path, but only fall back to /api/v2logos/{airline_code}
            // when the airline code exists in the loaded `airlineDB` to avoid N-number fallbacks.
            const code = (fl.airline_code || '').toUpperCase();
            const hasApiLogo = (fl.airlineLogo && fl.airlineLogo.length);
            let logoSrc = hasApiLogo ? fl.airlineLogo : null;
            if (!logoSrc && code && airlineDB && airlineDB[code] && airlineDB[code].logo) {
                logoSrc = `/api/v2logos/${encodeURIComponent(code)}`;
            }

            // Build row elements to allow graceful image preload/fade-in and avoid layout blinks
            const hexCell = document.createElement('td'); hexCell.textContent = fl.icao || '';
            const callsignCell = document.createElement('td'); callsignCell.textContent = fl.callsign || '';
            const airlineCodeCell = document.createElement('td'); airlineCodeCell.textContent = fl.airline_code || '';
            const airlineNameCell = document.createElement('td'); airlineNameCell.textContent = fl.airline_name || '';
            const airlineLogoCell = document.createElement('td');
            // Create an image element but don't set src until it is preloaded so we don't flash
            if (logoSrc) {
                const logoImg = document.createElement('img');
                logoImg.alt = `${(fl.airline_name || fl.airline_code) + ' logo'}`;
                logoImg.style.height = '30px';
                logoImg.style.maxWidth = '60px';
                logoImg.style.objectFit = 'contain';
                logoImg.style.opacity = '0';
                logoImg.style.transition = 'opacity 180ms ease-in';
                logoImg.width = 60;
                logoImg.height = 30;

                if (isLogoRecentlyLoaded(logoSrc)) {
                    // Logo was loaded recently, set src directly (browser should cache)
                    logoImg.src = logoSrc;
                    logoImg.style.opacity = '1';
                } else {
                    // First time loading this logo
                    logoImg.onload = () => {
                        logoImg.style.opacity = '1';
                        markLogoAsLoaded(logoSrc);
                    };
                    logoImg.onerror = () => {
                        // If it fails, show a placeholder instead of leaving a broken image
                        airlineLogoCell.textContent = '—';
                    };
                    logoImg.src = logoSrc;
                }
                airlineLogoCell.appendChild(logoImg);
            } else {
                airlineLogoCell.textContent = '—';
            }
            const regCell = document.createElement('td'); regCell.textContent = fl.registration || '';
            const typeCell = document.createElement('td'); typeCell.innerHTML = typeDisplay;
            const manufacturerCell = document.createElement('td'); manufacturerCell.textContent = fl.manufacturer || '';
            const manufacturerLogoCell = document.createElement('td');
            if (fl.manufacturerLogo) {
                const logoImg = document.createElement('img');
                logoImg.alt = `${(fl.manufacturer || '') + ' logo'}`;
                logoImg.style.height = '30px';
                logoImg.style.maxWidth = '60px';
                logoImg.style.objectFit = 'contain';
                logoImg.style.opacity = '0';
                logoImg.style.transition = 'opacity 180ms ease-in';

                if (isLogoRecentlyLoaded(fl.manufacturerLogo)) {
                    // Logo was loaded recently, set src directly (browser should cache)
                    logoImg.src = fl.manufacturerLogo;
                    logoImg.style.opacity = '1';
                } else {
                    // First time loading this logo
                    logoImg.onload = () => {
                        logoImg.style.opacity = '1';
                        markLogoAsLoaded(fl.manufacturerLogo);
                    };
                    logoImg.onerror = () => {
                        manufacturerLogoCell.textContent = '—';
                    };
                    logoImg.src = fl.manufacturerLogo;
                }
                manufacturerLogoCell.appendChild(logoImg);
            } else {
                manufacturerLogoCell.textContent = '—';
            }
            const bodyTypeCell = document.createElement('td'); bodyTypeCell.textContent = fl.bodyType || '';
            const startTimeCell = document.createElement('td'); startTimeCell.textContent = startTimeLocal || '';
            const endTimeCell = document.createElement('td'); endTimeCell.textContent = endTimeLocal || '';
            const durationCell = document.createElement('td'); durationCell.textContent = duration || '';
            const startLatCell = document.createElement('td'); startLatCell.textContent = fl.start_lat || '';
            const startLonCell = document.createElement('td'); startLonCell.textContent = fl.start_lon || '';
            const endLatCell = document.createElement('td'); endLatCell.textContent = fl.end_lat || '';
            const endLonCell = document.createElement('td'); endLonCell.textContent = fl.end_lon || '';
            const maxAltCell = document.createElement('td'); maxAltCell.textContent = fl.max_alt_ft || '';
            const reportsCell = document.createElement('td'); reportsCell.textContent = fl.reports || '';
            const slantStartCell = document.createElement('td'); slantStartCell.textContent = (fl.slant_range_start !== undefined && fl.slant_range_start !== null) ? fl.slant_range_start.toFixed(2) : '';
            const slantEndCell = document.createElement('td'); slantEndCell.textContent = (fl.slant_range_end !== undefined && fl.slant_range_end !== null) ? fl.slant_range_end.toFixed(2) : '';

            // Append constructed cells in the expected order
            row.appendChild(hexCell);
            row.appendChild(callsignCell);
            row.appendChild(airlineCodeCell);
            row.appendChild(airlineNameCell);
            row.appendChild(airlineLogoCell);
            row.appendChild(regCell);
            row.appendChild(typeCell);
            row.appendChild(manufacturerCell);
            row.appendChild(manufacturerLogoCell);
            row.appendChild(bodyTypeCell);
            row.appendChild(startTimeCell);
            row.appendChild(endTimeCell);
            row.appendChild(durationCell);
            row.appendChild(startLatCell);
            row.appendChild(startLonCell);
            row.appendChild(endLatCell);
            row.appendChild(endLonCell);
            row.appendChild(maxAltCell);
            row.appendChild(reportsCell);
            row.appendChild(slantStartCell);
            row.appendChild(slantEndCell);

            // Ensure dataset key for future reuse
            row.dataset.flightKey = rowKey;
            tableBody.appendChild(row);
        }
        try { setComputedRangeUI('flights', startTime, endTime, isCustomRange); } catch (e) {}
        try { if (summaryDiv) { /* update summary handled already */ } } catch (e) {}
        try { hideSpinnerForTab('flights'); } catch (e) {}
        // Ensure loading indicator removed if present
        try { if (summaryDiv && summaryDiv.querySelector('.spinner')) { /* already updated above */ } } catch (e) {}
        // Remove any leftover nodes in existingFlightRows (they were not present in current dataset)
        existingFlightRows.forEach((r, k) => { try { r.remove(); } catch (e) {} });
        
        // Restore sort state after populating table
        restoreTableSortState(table);
    } catch (error) {
        try { console.error('Error loading flights:', (error && error.message) ? error.message : String(error), (error && error.stack) ? error.stack : ''); } catch (e) {}
        try { hideSpinnerForTab('flights', `<span style="color:#f44336;">Error loading flights</span>`); } catch (e) {}
    }
}

async function summarizeText() {
    const text = document.getElementById('gemini-input').value;
    const output = document.getElementById('gemini-output');
    if (!text) {
        output.textContent = 'Please enter text to summarize.';
        try { hideSpinnerForTab('positions'); } catch (e) {}
        return;
    }
    try {
        const response = await fetch('/api/gemini/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        const data = await response.json();
        output.textContent = data.summary;
    } catch (error) {
        console.error('Error summarizing text:', error);
        output.textContent = 'An error occurred while summarizing the text.';
    }
}

// --- Table Sorting Logic ---

// Store sort state for each table to preserve sorting after data refresh
const tableSortStates = new Map();

// Cookie utility functions for sort state persistence
function setSortStateCookie() {
    const sortStates = {};
    tableSortStates.forEach((state, tableId) => {
        sortStates[tableId] = state;
    });
    const cookieValue = JSON.stringify(sortStates);
    // Set cookie to expire in 30 days
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);
    document.cookie = `tableSortStates=${encodeURIComponent(cookieValue)}; expires=${expiryDate.toUTCString()}; path=/`;
}

function getSortStateFromCookie() {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'tableSortStates') {
            try {
                const sortStates = JSON.parse(decodeURIComponent(value));
                // Load cookie data into memory Map
                Object.entries(sortStates).forEach(([tableId, state]) => {
                    tableSortStates.set(tableId, state);
                });
                return true;
            } catch (e) {
                console.warn('Failed to parse sort state cookie:', e);
                return false;
            }
        }
    }
    return false;
}

// Load sort states from cookie on page load
getSortStateFromCookie();

function saveTableSortState(table) {
    const tableId = table.id || table.className || 'default';
    const sortedHeader = table.querySelector('th.sort-asc, th.sort-desc');
    if (sortedHeader) {
        const columnIndex = Array.from(sortedHeader.parentNode.children).indexOf(sortedHeader);
        const isAsc = sortedHeader.classList.contains('sort-asc');
        const isNumeric = sortedHeader.dataset.sortNumeric === 'true';
        tableSortStates.set(tableId, { columnIndex, isAsc, isNumeric });
        // Save to cookie for persistence between sessions
        setSortStateCookie();
    } else {
        tableSortStates.delete(tableId);
        // Update cookie after deletion
        setSortStateCookie();
    }
}

function restoreTableSortState(table) {
    const tableId = table.id || table.className || 'default';
    const sortState = tableSortStates.get(tableId);
    if (sortState) {
        const { columnIndex, isAsc, isNumeric } = sortState;
        const headerCell = table.querySelector(`th:nth-child(${columnIndex + 1})`);
        if (headerCell) {
            // Clear existing sort indicators
            table.querySelectorAll('th').forEach(th => {
                th.classList.remove('sort-asc', 'sort-desc');
                delete th.dataset.sortDir;
            });
            
            // Apply saved sort state
            headerCell.dataset.sortDir = isAsc ? 'asc' : 'desc';
            headerCell.classList.add(isAsc ? 'sort-asc' : 'sort-desc');
            sortTable(table, columnIndex, isNumeric, isAsc);
        }
    }
}

function sortTable(table, column, isNumeric, asc) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return; // Exit if no table body
    const rows = Array.from(tbody.querySelectorAll('tr'));

    const sortedRows = rows.sort((a, b) => {
        const aCellElem = a.querySelector(`td:nth-child(${column + 1})`);
        const bCellElem = b.querySelector(`td:nth-child(${column + 1})`);
        
        // Check for data-sort-value attribute first
        const aSortVal = aCellElem?.getAttribute('data-sort-value');
        const bSortVal = bCellElem?.getAttribute('data-sort-value');
        
        if (aSortVal && bSortVal) {
            const aNum = parseFloat(aSortVal);
            const bNum = parseFloat(bSortVal);
            return asc ? aNum - bNum : bNum - aNum;
        }
        
        const aVal = aCellElem?.textContent.trim() || '';
        const bVal = bCellElem?.textContent.trim() || '';

        if (isNumeric) {
            // Handle non-numeric values gracefully in numeric columns
            const aNum = parseFloat(aVal) || 0;
            const bNum = parseFloat(bVal) || 0;
            return asc ? aNum - bNum : bNum - aNum;
        } else {
            return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
    });

    // Re-append sorted rows
    sortedRows.forEach(row => tbody.appendChild(row));
}

// Attach a single delegated event listener to the document
document.addEventListener('click', (event) => {
    // Check if a sortable header was clicked
    const headerCell = event.target.closest('.sortable th[data-sort]');
    if (!headerCell) return;

    const table = headerCell.closest('table');
    const columnIndex = Array.from(headerCell.parentNode.children).indexOf(headerCell);
    const isNumeric = headerCell.dataset.sortNumeric === 'true';
    
    // Toggle sort direction
    const currentIsAsc = headerCell.dataset.sortDir === 'asc';
    const newAsc = !currentIsAsc;
    
    // Remove direction indicators from all headers in this table
    table.querySelectorAll('th').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        delete th.dataset.sortDir;
    });

    // Set new direction on the clicked header
    headerCell.dataset.sortDir = newAsc ? 'asc' : 'desc';
    headerCell.classList.add(newAsc ? 'sort-asc' : 'sort-desc');

    sortTable(table, columnIndex, isNumeric, newAsc);
});

// --- Initialization & Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialize squawk time range inputs to last hour
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));
    
    const startInput = document.getElementById('squawk-start-time');
    const endInput = document.getElementById('squawk-end-time');
    
    if (startInput && endInput) {
        // Convert to local time format for datetime-local input
        // datetime-local expects YYYY-MM-DDTHH:mm in LOCAL time
        const toLocalDateTime = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        };
        
        startInput.value = toLocalDateTime(oneHourAgo);
        endInput.value = toLocalDateTime(now);
    }
    
    // Add event listeners for position graph checkboxes
    ['graph-positions', 'graph-aircraft', 'graph-flights', 'graph-airlines'].forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox) {
            checkbox.addEventListener('change', () => {
                // Redraw graph with current data
                loadUnifiedPositionStats();
            });
        }
    });

    // Event listeners for custom global start/end inputs
    try {
        const positionsStart = document.getElementById('positions-start-time');
        const positionsEnd = document.getElementById('positions-end-time');
        if (positionsStart && positionsEnd) {
            const onCustomRangeChanged = () => {
                try { clearActivePositionButtons(); } catch (e) {}
                try { setCustomRangeUI(false); } catch (e) {}

                // Debounce refresh for a short period to avoid flooding loaders
                try { if (window._airlinesRefreshTimer) clearTimeout(window._airlinesRefreshTimer); } catch (e) {}
                window._airlinesRefreshTimer = setTimeout(() => {
                    try {
                        const activeTabElem = document.querySelector('.tab-content.active');
                        const tabName = activeTabElem && activeTabElem.id ? activeTabElem.id.replace(/-tab$/, '') : null;
                        if (tabName === 'airlines') {
                            try { loadAirlineStats(); } catch (e) {}
                        }
                    } catch (e) {}
                }, 250);
            };
            positionsStart.addEventListener('input', onCustomRangeChanged);
            positionsEnd.addEventListener('input', onCustomRangeChanged);
            // Also listen for change event (when user finishes editing)
            positionsStart.addEventListener('change', onCustomRangeChanged);
            positionsEnd.addEventListener('change', onCustomRangeChanged);
        }
    } catch (e) {}

    // Add event listener for global time-window changes (index & heatmap 'time-window')
    try {
        const timeWindowSelect = document.getElementById('time-window') || document.getElementById('heatmap-window');
        if (timeWindowSelect) {
            timeWindowSelect.addEventListener('change', () => {
                try { localStorage.setItem('positionsTimescale', String(timeWindowSelect.value)); } catch (e) {}
                // Update active quick button
                try { const hours = selectValToHours(timeWindowSelect.value); setActivePositionButton(hours); } catch (e) {}
                // On change, dispatch the selection to the active tab loader
                try { handleGlobalTimeSelection(selectValToHours(timeWindowSelect.value)); } catch (e) {}
            });
        }
    } catch (e) {}

    // Flights 'gap minutes' input should trigger a reload of the flights table when changed
    try {
        const flightsGap = document.getElementById('flights-gap');
        if (flightsGap) {
            const onGapChanged = () => {
                try { if (window._flightsGapTimer) clearTimeout(window._flightsGapTimer); } catch (e) {}
                window._flightsGapTimer = setTimeout(() => {
                    try { const activeTabElem = document.querySelector('.tab-content.active');
                          const tabName = activeTabElem && activeTabElem.id ? activeTabElem.id.replace(/-tab$/,'') : null;
                          // Only refresh if user is on flights tab; otherwise just leave value stored
                          if (tabName === 'flights') {
                              try { loadFlights(); } catch (e) {}
                          }
                    } catch (e) {}
                }, 250);
            };
            flightsGap.addEventListener('input', onGapChanged);
            flightsGap.addEventListener('change', onGapChanged);
        }
    } catch (e) {}

    // Enhance quick buttons with keyboard support and accessible attributes
    try {
        const btns = document.querySelectorAll('.positions-window-btn');
            if (btns && btns.length) {
            btns.forEach(b => {
                // Add keyboard activation
                b.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        b.click();
                        return false;
                    }
                    return true;
                });
                // Ensure aria-pressed is set correctly on click
                b.addEventListener('click', () => {
                    try {
                        const hoursVal = b.dataset.hours === 'all' ? null : Number(b.dataset.hours);
                        const sel = document.getElementById('time-window');
                        if (sel) {
                            const savedVal = hoursToSelectVal(hoursVal);
                            sel.value = savedVal;
                            try { localStorage.setItem('positionsTimescale', String(savedVal)); } catch (e) {}
                        }
                        try { setActivePositionButton(hoursVal); } catch (e) {}
                        // Dispatch selection to the active tab loader so the UI updates immediately
                        try { handleGlobalTimeSelection(hoursVal); } catch (e) {}
                    } catch (e) {}
                });
                // Mark button as having JS attachment so auto-hide logic can reveal it
                try { b.dataset.attached = '1'; } catch (e) {}
            });
        }
    } catch (e) {}
    
    // Load initial data for all tabs
    setTimeout(() => {
        // Restore saved positions timescale if present (applies to index page 'time-window' and heatmap page too)
        try {
                const saved = localStorage.getItem('positionsTimescale');
                if (saved) {
                    const sel = document.getElementById('time-window') || document.getElementById('heatmap-window');
                    if (sel) {
                        try { sel.value = saved; } catch (e) {}
                        const hours = selectValToHours(saved);
                        try { setActivePositionButton(hours); } catch (e) {}
                        // Dispatch the saved selection so the active tab loader updates accordingly
                        try { handleGlobalTimeSelection(hours); } catch (e) {}
                    }
                }
        } catch (e) {}
        loadFlights();
        loadAirlineStats();
        loadUnifiedPositionStats();
        loadHeatmap();
        loadSquawkTransitions();
        loadReceptionRange();
    }, 500);
});

// --- Remake Hourly Rollup Handler ---
async function remakeHourlyRollup() {
    if (!confirm('Remake all hourly rollup files for position data? This may take a while.')) return;
    try {
        const btn = document.getElementById('remake-hourly-rollup-btn');
        btn.disabled = true;
        btn.textContent = 'Remaking...';
        const resp = await fetch('/api/remake-hourly-rollup', { method: 'POST' });
        const result = await resp.json();
        alert(result.message || 'Hourly rollup remake started.');
    } catch (err) {
        alert('Error starting hourly rollup remake: ' + err.message);
    } finally {
        const btn = document.getElementById('remake-hourly-rollup-btn');
        btn.disabled = false;
        btn.textContent = 'Remake Hourly Rollup';
    }
}

// --- Heatmap Filtering Functionality ---
async function loadHeatmap() {
    const canvas = document.getElementById('heatmap-canvas');
    if (!canvas) return; // Don't run on pages without heatmap canvas
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const positionsElem = document.getElementById('heatmap-total-positions');
    
    try {
        positionsElem.textContent = 'Loading...';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const timeWindow = document.getElementById('time-window').value;
        const airline = document.getElementById('heatmap-airline').value;
        const type = document.getElementById('heatmap-type').value;
        const manufacturer = document.getElementById('heatmap-manufacturer').value;
        
        // Build query parameters
        const params = new URLSearchParams({ window: timeWindow });
        if (airline) params.append('airline', airline);
        if (type) params.append('type', type);
        if (manufacturer) params.append('manufacturer', manufacturer);
        
        console.log('Loading heatmap with params:', Object.fromEntries(params));
        
        const response = await fetch(`/api/heatmap?${params}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const gridData = await response.json();
        console.log(`Received ${gridData.length} grid cells for heatmap`);
        console.log('First 3 grid cells:', gridData.slice(0, 3));
        
        // Calculate total positions across all grid cells
        let totalPositions = 0;
        for (const cell of gridData) {
            totalPositions += cell.count || 0;
        }
        
        // Render the heatmap
        if (typeof window.renderHeatmap === 'function') {
            console.log('Calling renderHeatmap with', gridData.length, 'grid cells containing', totalPositions, 'positions');
            window.renderHeatmap(gridData, canvas);
        } else {
            console.warn('renderHeatmap function not available, using fallback');
            ctx.fillStyle = '#666';
            ctx.font = '14px sans-serif';
            ctx.fillText(`Heatmap with ${gridData.length} grid cells (${totalPositions} positions)`, 10, 20);
        }
        
        positionsElem.textContent = `${totalPositions.toLocaleString()} positions in ${gridData.length} grid cells`;
        
    } catch (error) {
        console.error('Error loading heatmap:', error);
        positionsElem.textContent = `Error: ${error.message}`;
        ctx.fillStyle = '#f44336';
        ctx.font = '14px sans-serif';
        ctx.fillText(`Error: ${error.message}`, 10, 20);
    }
}

// --- Heatmap Filtering Functionality ---

async function populateHeatmapFilters() {
    try {
        // Populate airline dropdown with common airlines
        const airlineSelect = document.getElementById('heatmap-airline');
        if (airlineSelect) {
            const commonAirlines = ['UAL', 'AAL', 'DAL', 'SWA', 'JBU', 'ENY', 'RPA'];
            commonAirlines.forEach(code => {
                const option = document.createElement('option');
                option.value = code;
                option.textContent = code;
                airlineSelect.appendChild(option);
            });
        }
        
        // Populate type dropdown with common types
        const typeSelect = document.getElementById('heatmap-type');
        if (typeSelect) {
            const commonTypes = ['B737', 'B738', 'A320', 'A321', 'C172', 'BE36'];
            commonTypes.forEach(type => {
                const option = document.createElement('option');
                option.value = type;
                option.textContent = type;
                typeSelect.appendChild(option);
            });
        }
        
        // Populate manufacturer dropdown
        const manufacturerSelect = document.getElementById('heatmap-manufacturer');
        if (manufacturerSelect) {
            const commonManufacturers = ['Boeing', 'Airbus', 'Cessna', 'Beechcraft', 'Piper'];
            commonManufacturers.forEach(manu => {
                const option = document.createElement('option');
                option.value = manu;
                option.textContent = manu;
                manufacturerSelect.appendChild(option);
            });
            // Set Boeing as default for testing
            manufacturerSelect.value = 'Boeing';
        }
        
        console.log('Heatmap filters populated');
        
    } catch (error) {
        console.warn('Could not populate heatmap filters:', error.message);
    }
}

// --- Cache Status Functions ---
async function loadCacheStatus() {
    try {
        const response = await fetch('/api/heatmap-stats');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        const statusDiv = document.getElementById('cache-status');
        if (statusDiv) {
            let html = `<div style="margin-bottom: 10px;"><strong>📈 Total Positions:</strong> ${data.totalPositions.toLocaleString()}</div>`;
            html += `<div style="margin-bottom: 10px;"><strong>✈️ With Aircraft Type:</strong> ${data.positionsWithType.toLocaleString()} (${((data.positionsWithType / data.totalPositions) * 100).toFixed(1)}%)</div>`;
            html += `<div style="margin-bottom: 10px;"><strong>🏭 With Manufacturer:</strong> ${data.positionsWithManufacturer.toLocaleString()} (${((data.positionsWithManufacturer / data.totalPositions) * 100).toFixed(1)}%)</div>`;
            
            if (data.dateRange && data.dateRange.hasTimestamps) {
                html += `<div style="margin-bottom: 10px;"><strong>📅 Date Range:</strong> ${data.dateRange.minDate} to ${data.dateRange.maxDate}</div>`;
                html += `<div style="margin-bottom: 10px;"><strong>⏱️ Span:</strong> ${data.dateRange.spanDays} days (${data.dateRange.spanHours} hours)</div>`;
            } else {
                html += `<div style="margin-bottom: 10px; color: #ff9800;"><strong>⚠️ No Timestamps:</strong> Position data lacks timestamp information</div>`;
            }
            
            html += `<div style="margin-bottom: 10px;"><strong>🔝 Top Manufacturers:</strong></div>`;
            html += `<div style="margin-left: 20px; margin-bottom: 10px;">`;
            Object.entries(data.topManufacturers).slice(0, 5).forEach(([manufacturer, count]) => {
                html += `<div>${manufacturer}: ${count.toLocaleString()}</div>`;
            });
            html += `</div>`;
            
            html += `<div style="margin-bottom: 10px;"><strong>🛩️ Top Aircraft Types:</strong></div>`;
            html += `<div style="margin-left: 20px;">`;
            Object.entries(data.topTypes).slice(0, 5).forEach(([type, count]) => {
                html += `<div>${type}: ${count.toLocaleString()}</div>`;
            });
            html += `</div>`;

            // Airline DB cache status (localStorage)
            try {
                const item = localStorage.getItem('airlineDB-v1');
                if (item) {
                    const parsed = JSON.parse(item);
                    if (parsed && parsed.ts) {
                        const ageMs = Date.now() - parsed.ts;
                        const ageMinutes = Math.round(ageMs / 60000);
                        const ageStr = ageMinutes < 60 ? `${ageMinutes}m` : `${(ageMinutes / 60).toFixed(1)}h`;
                        html += `<div style="margin-top: 10px;"><strong>📚 Airline DB cache:</strong> stored locally <em>(${ageStr} old)</em></div>`;
                    } else {
                        html += `<div style="margin-top: 10px;"><strong>📚 Airline DB cache:</strong> present but missing timestamp</div>`;
                    }
                } else {
                    html += `<div style="margin-top: 10px;"><strong>📚 Airline DB cache:</strong> not present in localStorage</div>`;
                }
            } catch (err) {
                html += `<div style="margin-top: 10px; color: #ff9800;"><strong>📚 Airline DB cache:</strong> localStorage unavailable</div>`;
            }
            
            statusDiv.innerHTML = html;
            try { updateAirlineDBIndicator(); } catch (e) { /* ignore */ }
        }
    } catch (error) {
        console.error('Error loading cache status:', error);
        const statusDiv = document.getElementById('cache-status');
        if (statusDiv) {
            statusDiv.innerHTML = `<div style="color: #f44336;">❌ Error loading cache status: ${error.message}</div>`;
        }
        try { updateAirlineDBIndicator(); } catch (e) { /* ignore */ }
    }
}

async function clearHeatmapCache() {
    try {
        const response = await fetch('/api/heatmap-cache-clear', {
            method: 'GET'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Show success message
        const statusDiv = document.getElementById('cache-status');
        if (statusDiv) {
            statusDiv.innerHTML = `<div style="color: #4caf50;">✅ ${data.message}</div>`;
        }
        
        // Reload cache status after a short delay
        setTimeout(loadCacheStatus, 2000);
        
    } catch (error) {
        console.error('Error clearing cache:', error);
        const statusDiv = document.getElementById('cache-status');
        if (statusDiv) {
            statusDiv.innerHTML = `<div style="color: #f44336;">❌ Error clearing cache: ${error.message}</div>`;
        }
    }
}

// Clear local airline DB cache stored in localStorage
function clearAirlineDBCache() {
    try {
        localStorage.removeItem('airlineDB-v1');
    } catch (err) { console.warn('Error clearing airlineDB localStorage', err); }
    try { window.airlineDB = null; } catch (e) {}
    try { updateAirlineDBIndicator(); } catch (e) {}
}

// Load cache status automatically when page loads
window.addEventListener('DOMContentLoaded', () => {
    try { updateAirlineDBIndicator(); } catch (e) { /* ignore */ }
    setTimeout(loadCacheStatus, 1000);
    // Auto-refresh every 30 seconds
    setInterval(loadCacheStatus, 30000);
    
    // Add event listeners for dropdown changes to auto-load heatmap
    const dropdowns = ['time-window', 'heatmap-airline', 'heatmap-type', 'heatmap-manufacturer'];
    dropdowns.forEach(id => {
        const elem = document.getElementById(id);
        if (elem) {
            elem.addEventListener('change', () => {
                console.log(`${id} changed, loading heatmap...`);
                loadHeatmap();
            });
        }
    });
    
    // Populate heatmap filters
    populateHeatmapFilters();
    
    // Load initial heatmap with 7 days default
    loadHeatmap();
    // If a global time-window control exists on this page, attach an event listener to update positions graph
    try {
        const timeWindowSelect = document.getElementById('time-window') || document.getElementById('heatmap-window');
        if (timeWindowSelect) {
            timeWindowSelect.addEventListener('change', () => {
                console.log('Global time-window changed, reloading unified position stats...');
                loadUnifiedPositionStats();
            });
        }
    } catch (e) { /* ignore */ }
    
    // Initialize heatmap configuration controls
    initializeHeatmapConfigControls();
});

// --- Initialize Heatmap Configuration Controls ---
function initializeHeatmapConfigControls() {
    const sourceSelect = document.getElementById('heatmap-source');
    const hoursSelect = document.getElementById('heatmap-hours');
    const gridSizeSelect = document.getElementById('heatmap-grid-size');
    
    if (sourceSelect && hoursSelect && gridSizeSelect) {
        // Add event listeners to update the Leaflet link when controls change
        sourceSelect.addEventListener('change', updateLeafletLink);
        hoursSelect.addEventListener('change', updateLeafletLink);
        gridSizeSelect.addEventListener('change', updateLeafletLink);
        
        // Initialize the link with current values
        updateLeafletLink();
    }
}

// --- Heatmap Configuration Functions ---
function testHeatmapConfiguration() {
    const source = document.getElementById('heatmap-source').value;
    const hours = document.getElementById('heatmap-hours').value;
    const gridSizeNm = document.getElementById('heatmap-grid-size').value;
    
    const resultDiv = document.getElementById('heatmap-config-result');
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<div style="color: #42a5f5;">🔄 Testing heatmap configuration...</div>';
    
    const url = `/api/heatmap-data?hours=${hours}&source=${source}&gridSizeNm=${gridSizeNm}`;
    
    fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
            // Handle both array response and object with grid property
            const gridArray = Array.isArray(data) ? data : (data.grid || []);
            const gridCount = gridArray.length;
            const totalPositions = gridArray.reduce((sum, cell) => sum + (cell.count || 0), 0);
            
            resultDiv.innerHTML = `
                <div style="color: #4caf50; margin-bottom: 8px;">✅ Configuration test successful!</div>
                <div style="color: #e0e0e0;">
                    <strong>API URL:</strong> ${url}<br>
                    <strong>Data Source:</strong> ${source === 'memory' ? 'Memory (Live)' : 'TSDB (Historical)'}<br>
                    <strong>Time Window:</strong> ${hours} hours<br>
                    <strong>Grid Size:</strong> ${gridSizeNm} NM<br>
                    <strong>Grid Cells:</strong> ${gridCount}<br>
                    <strong>Total Positions:</strong> ${totalPositions.toLocaleString()}
                </div>
            `;
        })
        .catch(error => {
            resultDiv.innerHTML = `
                <div style="color: #f44336; margin-bottom: 8px;">❌ Configuration test failed!</div>
                <div style="color: #e0e0e0;">
                    <strong>API URL:</strong> ${url}<br>
                    <strong>Error:</strong> ${error.message}
                </div>
            `;
        });
}

function resetHeatmapConfig() {
    document.getElementById('heatmap-source').value = 'tsdb';
    document.getElementById('heatmap-hours').value = '24';
    document.getElementById('heatmap-grid-size').value = '1';
    
    const resultDiv = document.getElementById('heatmap-config-result');
    resultDiv.style.display = 'none';
    resultDiv.innerHTML = '';
    
    updateLeafletLink();
}

function updateLeafletLink() {
    const source = document.getElementById('heatmap-source').value;
    const hours = document.getElementById('heatmap-hours').value;
    const gridSizeNm = document.getElementById('heatmap-grid-size').value;
    
    const link = document.getElementById('leaflet-heatmap-link');
    if (link) {
        const params = new URLSearchParams({
            source: source,
            hours: hours,
            gridSizeNm: gridSizeNm
        });
        link.href = `/heatmap-leaflet?${params.toString()}`;
    }
}
