// --- Reception Tab Loader ---
async function loadReceptionRange(hoursBack = null) {
    try {
        const startElem = document.getElementById('reception-start-time');
        const endElem = document.getElementById('reception-end-time');
        
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
        
        // If hoursBack is provided, use it (from quick buttons)
        if (hoursBack !== null) {
            const now = new Date();
            const endTime = now.getTime();
            const startTime = endTime - (hoursBack * 60 * 60 * 1000);
            
            // Update input fields
            startElem.value = formatLocalDateTime(startTime);
            endElem.value = formatLocalDateTime(endTime);
            
            hours = hoursBack;
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
            
            hours = Math.ceil((endTime - startTime) / (60 * 60 * 1000));
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
        
        summaryDiv.innerHTML = `<strong>Max Range:</strong> ${maxRange.toFixed(2)} nm | <strong>Positions:</strong> ${positionCount.toLocaleString()} | <strong>Sector/Altitude Cells:</strong> ${Object.keys(sectors).length}`;
        
        // Sort sectors by bearing, then altitude band
        const sortedSectors = Object.entries(sectors)
            .map(([key, sector]) => ({ key, ...sector }))
            .sort((a, b) => {
                if (a.bearing !== b.bearing) return a.bearing - b.bearing;
                return a.altBand - b.altBand;
            });
        
        // Aggregate by bearing (ignore altitude)
        const bearingData = {};
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
    }
}

function drawBearingChart(bearingData, maxRange) {
    const canvas = document.getElementById('reception-bearing-canvas');
    const ctx = canvas.getContext('2d');
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
    const ctx = canvas.getContext('2d');
    
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

const socket = io();

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
function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`${tabName}-tab`).classList.add('active');
    event.target.classList.add('active');

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
        if (tabName === 'reception') loadReceptionRange();
}

async function loadHistoricalStats() {
    try {
        const startTime = document.getElementById('historical-start-time').value;
        const endTime = document.getElementById('historical-end-time').value;

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


// --- Socket.IO Handlers ---
socket.on('connect', () => {
    document.getElementById('connection-status').textContent = '● Connected';
    document.getElementById('connection-status').className = 'status-connected';
});

socket.on('disconnect', () => {
    document.getElementById('connection-status').textContent = '● Disconnected';
    document.getElementById('connection-status').className = 'status-disconnected';
});

// More granular connection/error handlers to help debugging connectivity
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
    updateLiveStats(data);
    updateAircraftTable(data.aircraft);
});

// --- UI Update Functions ---
function updateLiveStats(data) {
    document.getElementById('tracking-count').textContent = data.trackingCount;
    document.getElementById('position-total').textContent = data.runningPositionCount;
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

function updateAircraftTable(aircraft) {
    const tableBody = document.getElementById('aircraft-table-body');
    
    // Save current sort state before clearing table
    const table = tableBody.closest('table');
    saveTableSortState(table);
    
    tableBody.innerHTML = '';
    if (!aircraft) return;
    
    // Load airline database once
    const loadAirlineDB = async () => {
        if (window.airlineDB) return window.airlineDB;
        try {
            const response = await fetch('/api/airline-database');
            if (response.ok) {
                window.airlineDB = await response.json();
                return window.airlineDB;
            }
        } catch (err) {
            console.warn('Could not load airline database:', err);
        }
        return {};
    };
    
    aircraft.forEach(ac => {
        const row = document.createElement('tr');
        // Color vertical speed
        let vertRate = ac.baro_rate || 0;
        let vertRateDisplay = vertRate === undefined || vertRate === null ? 'N/A' : vertRate;
        let vertRateColor = '';
        if (typeof vertRate === 'number') {
            if (vertRate < 0) vertRateColor = 'color:red;font-weight:bold;';
            else if (vertRate > 0) vertRateColor = 'color:green;font-weight:bold;';
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
        hexCell.textContent = ac.hex;
        
        const flightCell = document.createElement('td');
        flightCell.textContent = ac.flight || 'N/A';
        
        const airlineCell = document.createElement('td');
        airlineCell.textContent = airlineDisplay;
        
        const airlineLogoCell = document.createElement('td');
        if (ac.airlineLogo) {
            airlineLogoCell.innerHTML = `<img src="${ac.airlineLogo}" alt="${airlineName} logo" style="height: 30px; max-width: 60px; object-fit: contain;">`;
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
            manufacturerLogoCell.innerHTML = `<img src="${ac.manufacturerLogo}" alt="${ac.manufacturer} logo" style="height: 30px; max-width: 60px; object-fit: contain;">`;
        } else {
            manufacturerLogoCell.textContent = '—';
        }
        
        const bodyTypeCell = document.createElement('td');
        bodyTypeCell.textContent = ac.bodyType || 'N/A';
        
        const squawkCell = document.createElement('td');
        squawkCell.textContent = ac.squawk || 'N/A';
        
        const altCell = document.createElement('td');
        altCell.textContent = ac.alt_baro || 'N/A';
        
        const speedCell = document.createElement('td');
        speedCell.textContent = ac.gs || 'N/A';
        
        const vertRateCell = document.createElement('td');
        vertRateCell.style.cssText = vertRateColor;
        vertRateCell.textContent = vertRateDisplay;
        
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
        row.appendChild(speedCell);
        row.appendChild(vertRateCell);
        row.appendChild(latCell);
        row.appendChild(lonCell);
        row.appendChild(messagesCell);
        row.appendChild(rssiCell);
        row.appendChild(slantRangeCell);
        
        tableBody.appendChild(row);
    });
    
    // Restore sort state after populating table
    restoreTableSortState(table);
}

async function loadAirlineStats(hoursBack = null) {
    try {
        const startElem = document.getElementById('airline-start-time');
        const endElem = document.getElementById('airline-end-time');
        
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
                    logoCell.innerHTML = `<img src="${airline.logo}" alt="${airline.name} logo" style="height: 30px; max-width: 60px; object-fit: contain;">`;
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
                const topManuCell = document.createElement('td'); topManuCell.textContent = airline.topManufacturer || 'N/A'; row.appendChild(topManuCell);
                const topManuLogoCell = document.createElement('td');
                topManuLogoCell.className = 'logo-cell';
                if (airline.topManufacturerLogo) {
                    topManuLogoCell.innerHTML = `<img src="${airline.topManufacturerLogo}" alt="${airline.topManufacturer} logo" style="height: 30px; max-width: 60px; object-fit: contain; margin-right: 8px;" onerror="this.style.display='none';">`;
                } else {
                    topManuLogoCell.textContent = '';
                }
                row.appendChild(topManuLogoCell);
                
                tableBody.appendChild(row);
            }
        });
        
        // Restore sort state after populating table
        restoreTableSortState(table);
    } catch (error) {
        console.error('Error loading or processing airline stats:', error);
    }
}

async function loadAirlineFlights(airlineCode, airlineName, windowVal) {
    try {
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
        summaryElem.innerHTML = '<span style="color: #888;">Loading...</span>';
        
        // Save current sort state before clearing table
        const table = tableBody.closest('table');
        saveTableSortState(table);
        
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
        
        // Update summary
        summaryElem.innerHTML = `
            <strong>Total Flights:</strong> ${allFlights.length} 
            (${activeFlights.length} active, ${completedFlights.length} no longer seen)
        `;
        
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
            hexCell.textContent = airlineCode;
            hexCell.setAttribute('data-sort-value', airlineCode);
            
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
    } catch (error) {
        console.error('Error loading airline flights:', error);
        const summaryElem = document.getElementById('airline-flights-summary');
        summaryElem.innerHTML = `<span style="color: #f44336;">Error loading flights: ${error.message}</span>`;
    }
}

function closeAirlineFlightsDrilldown() {
    const drilldownDiv = document.getElementById('airline-flights-drilldown');
    drilldownDiv.style.display = 'none';
}

// Global storage for position data sources
let positionDataSources = {
    memory: null,
    cache: null,
    s3: null,
    active: 'memory'
};

async function loadUnifiedPositionStats(hoursBack = null) {
    try {
        const startElem = document.getElementById('positions-start-time');
        const endElem = document.getElementById('positions-end-time');
        
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
        }
        // Use custom times if set
        else if (startElem && startElem.value && endElem && endElem.value) {
            startTime = parseLocalDateTime(startElem.value);
            endTime = parseLocalDateTime(endElem.value);
            
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
        
        // Fetch data from all three sources in parallel
        // Use startTime/endTime if available, otherwise fall back to hours
        const [memoryResp, cacheResp, airlineResp, flightsResp] = await Promise.all([
            fetch(`/api/position-timeseries-live?startTime=${startTime}&endTime=${endTime}&resolution=15`),
            fetch('/api/cache-status'),
            fetch(`/api/airline-stats?window=${hours}h`),
            fetch(`/api/flights?window=${hours}h`)
        ]);
        
        const memoryData = await memoryResp.json();
        const cacheData = await cacheResp.json();
        const airlineData = await airlineResp.json();
        const flightsData = await flightsResp.json();
        
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
        
        // === CACHE STATS (from cache status) ===
        const cachePositions = cacheData.positionCache?.totalPositions || 0;
        const cacheAircraft = cacheData.positionCache?.uniqueAircraft || 0;
        const cacheFlights = cacheData.positionCache?.uniqueFlights || 0;
        const cacheAirlines = cacheData.positionCache?.uniqueAirlines || 0;
        
        // === S3 BUCKET STATS (from airline and flight APIs) ===
        let bucketAircraft = new Set();
        let bucketFlights = new Set();
        let bucketAirlines = new Set();
        
        // Count airlines from airline stats
        if (airlineData.minute && airlineData.minute.byAirline) {
            Object.keys(airlineData.minute.byAirline).forEach(airline => bucketAirlines.add(airline));
        }
        if (airlineData.hourly && airlineData.hourly.byAirline) {
            Object.keys(airlineData.hourly.byAirline).forEach(airline => bucketAirlines.add(airline));
        }
        
        // Count flights and aircraft from flights API
        const allFlights = [...(flightsData.active || []), ...(flightsData.flights || [])];
        allFlights.forEach(flight => {
            if (flight.hex) bucketAircraft.add(flight.hex);
            if (flight.callsign) bucketFlights.add(flight.callsign);
        });
        
        // Estimate positions: assume average flight has 100 position reports
        const bucketPositions = allFlights.length * 100;
        
        // Update UI
        document.getElementById('memory-positions').textContent = memoryPositions.toLocaleString();
        document.getElementById('memory-aircraft').textContent = memoryAircraft.size.toLocaleString();
        document.getElementById('memory-flights').textContent = memoryFlights.size.toLocaleString();
        document.getElementById('memory-airlines').textContent = memoryAirlines.size.toLocaleString();
        
        document.getElementById('cache-positions').textContent = cachePositions.toLocaleString();
        document.getElementById('cache-aircraft').textContent = cacheAircraft.toLocaleString();
        document.getElementById('cache-flights').textContent = cacheFlights.toLocaleString();
        document.getElementById('cache-airlines').textContent = cacheAirlines.toLocaleString();
        
        document.getElementById('bucket-positions').textContent = bucketPositions.toLocaleString();
        document.getElementById('bucket-aircraft').textContent = bucketAircraft.size.toLocaleString();
        document.getElementById('bucket-flights').textContent = bucketFlights.size.toLocaleString();
        document.getElementById('bucket-airlines').textContent = bucketAirlines.size.toLocaleString();
        
        // === STORE DATA SOURCES ===
        positionDataSources.memory = memoryData;
        positionDataSources.cache = Array.isArray(memoryData) ? memoryData.map(bucket => ({
            ...bucket,
            positionCount: Math.round(bucket.positionCount * (cachePositions / Math.max(memoryPositions, 1)))
        })) : [];
        positionDataSources.s3 = Array.isArray(memoryData) ? memoryData.map(bucket => ({
            ...bucket,
            positionCount: Math.round(bucket.positionCount * (bucketPositions / Math.max(memoryPositions, 1))),
            aircraft: bucket.aircraft?.slice(0, Math.round(bucket.aircraft.length * (bucketAircraft.size / Math.max(memoryAircraft.size, 1)))),
            flights: bucket.flights?.slice(0, Math.round(bucket.flights.length * (bucketFlights.size / Math.max(memoryFlights.size, 1)))),
            airlines: bucket.airlines?.slice(0, Math.round(bucket.airlines.length * (bucketAirlines.size / Math.max(memoryAirlines.size, 1))))
        })) : [];
        
        // Update active stat card styling
        updateActiveDataSource();
        
        // === DRAW TIME SERIES GRAPH ===
        drawPositionsTimeSeriesGraph(positionDataSources[positionDataSources.active]);
        
    } catch (error) {
        console.error('Error loading unified position stats:', error);
    }
}

function switchPositionDataSource(source) {
    if (!['memory', 'cache', 's3'].includes(source)) return;
    positionDataSources.active = source;
    updateActiveDataSource();
    drawPositionsTimeSeriesGraph(positionDataSources[source]);
}

function updateActiveDataSource() {
    // Reset all cards to default styling by finding them through their child stats divs
    const memoryCard = document.getElementById('memory-stats')?.parentElement;
    const cacheCard = document.getElementById('cache-stats')?.parentElement;
    const s3Card = document.getElementById('bucket-stats')?.parentElement;
    
    if (memoryCard) {
        memoryCard.style.border = positionDataSources.active === 'memory' ? '3px solid #4caf50' : '2px solid #4caf50';
        memoryCard.style.boxShadow = positionDataSources.active === 'memory' ? '0 0 15px rgba(76, 175, 80, 0.5)' : 'none';
    }
    if (cacheCard) {
        cacheCard.style.border = positionDataSources.active === 'cache' ? '3px solid #2196f3' : '2px solid #2196f3';
        cacheCard.style.boxShadow = positionDataSources.active === 'cache' ? '0 0 15px rgba(33, 150, 243, 0.5)' : 'none';
    }
    if (s3Card) {
        s3Card.style.border = positionDataSources.active === 's3' ? '3px solid #ff9800' : '2px solid #ff9800';
        s3Card.style.boxShadow = positionDataSources.active === 's3' ? '0 0 15px rgba(255, 152, 0, 0.5)' : 'none';
    }
}

function drawPositionsTimeSeriesGraph(memoryData) {
    const canvas = document.getElementById('positions-timeseries-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (!Array.isArray(memoryData) || memoryData.length === 0) {
        ctx.fillStyle = '#888';
        ctx.font = '16px sans-serif';
        ctx.fillText('No timeseries data available', 20, 200);
        return;
    }
    
    // Check which metrics to display
    const showPositions = document.getElementById('graph-positions')?.checked ?? true;
    const showAircraft = document.getElementById('graph-aircraft')?.checked ?? true;
    const showFlights = document.getElementById('graph-flights')?.checked ?? true;
    const showAirlines = document.getElementById('graph-airlines')?.checked ?? true;
    
    const padding = { top: 40, right: 150, bottom: 60, left: 80 };
    const chartWidth = canvas.width - padding.left - padding.right;
    const chartHeight = canvas.height - padding.top - padding.bottom;
    
    // Extract data points
    const dataPoints = memoryData.map(bucket => ({
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
    const numLabels = Math.min(6, dataPoints.length);
    for (let i = 0; i < numLabels; i++) {
        const idx = Math.floor(i * (dataPoints.length - 1) / (numLabels - 1));
        const point = dataPoints[idx];
        const x = padding.left + (idx / (dataPoints.length - 1)) * chartWidth;
        const time = new Date(point.timestamp);
        const label = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
    ctx.fillText('Position Statistics Over Time', canvas.width / 2, 25);
}

async function loadPositionStatsLive() {
    try {
        const minutes = parseInt(document.getElementById('positions-live-minutes').value || '10', 10);
        const resolution = parseInt(document.getElementById('positions-live-resolution').value || '1', 10);
        const resp = await fetch(`/api/position-timeseries-live?minutes=${minutes}&resolution=${resolution}`);
        const timeseries = await resp.json();

        const canvas = document.getElementById('position-timeseries-live-canvas');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!timeseries || !timeseries.length) {
            ctx.fillStyle = '#666';
            ctx.font = '14px sans-serif';
            ctx.fillText('No live data available.', 10, 20);
            return;
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
        const numLabels = Math.min(6, timeseries.length);
        const divisor = Math.max(1, timeseries.length - 1);
        for (let i = 0; i < numLabels; i++) {
            const idx = Math.floor((timeseries.length - 1) * i / Math.max(1, numLabels - 1));
            const pt = timeseries[idx];
            const x = padLeft + (w * idx / divisor);
            const time = new Date(pt.timestamp);
            const timeStr = time.getHours().toString().padStart(2, '0') + ':' + time.getMinutes().toString().padStart(2, '0');
            ctx.fillText(timeStr, x, padTop + h + 14);
        }
        ctx.textAlign = 'left';

        primaryMetrics.forEach(metric => {
            ctx.strokeStyle = colors[metric];
            ctx.lineWidth = 2;
            ctx.beginPath();
            timeseries.forEach((pt, idx) => {
                const x = padLeft + (w * idx / divisor);
                const y = padTop + h - (pt[metric] / maxVPrimary) * h;
                if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
            
            // Draw dots for each point
            ctx.fillStyle = colors[metric];
            timeseries.forEach((pt, idx) => {
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

    } catch (error) {
        console.error('Error loading live position stats:', error);
    }
}

async function loadCachePositionStats() {
    try {
        const resp = await fetch('/api/cache-status');
        const data = await resp.json();
        
        // Get the total positions count from the cache
        const totalCachedPositions = data.positionCache?.totalPositions || 0;
        const uniqueAircraft = data.positionCache?.uniqueAircraft || 0;
        
        if (totalCachedPositions === 0) {
            document.getElementById('cache-position-stats-summary').innerHTML = '<strong>No cache data available</strong>';
            const canvas = document.getElementById('cache-position-stats-canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
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
        document.getElementById('cache-position-stats-summary').innerHTML = summaryHtml;
        
        // Draw a simple bar chart showing cache composition
        const canvas = document.getElementById('cache-position-stats-canvas');
        const ctx = canvas.getContext('2d');
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
        
    } catch (error) {
        console.error('Error loading cache position stats:', error);
        document.getElementById('cache-position-stats-summary').innerHTML = `<strong style="color: red;">Error: ${error.message}</strong>`;
    }
}

async function loadPositionStats() {
    try {
        // Check if time range inputs are provided
        const startElem = document.getElementById('positions-start-time');
        const endElem = document.getElementById('positions-end-time');
        
        let hours = parseInt(document.getElementById('positions-hours').value || '24', 10);
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
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!timeseries || !timeseries.length) {
            ctx.fillStyle = '#666';
            ctx.font = '14px sans-serif';
            ctx.fillText('No data available for this time period.', 10, 20);
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

    } catch (error) {
        console.error('Error loading position stats:', error);
    }
}

async function loadSquawkTransitions(hoursBack = null) {
    try {
        const startElem = document.getElementById('squawk-start-time');
        const endElem = document.getElementById('squawk-end-time');
        
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
        }

        // Helper to format transitions
        const formatTransition = (t) => {
            if (!t) return '';
            const dt = new Date(t.timestamp || Date.now());
            const timeStr = dt.toLocaleString('en-US', { 
                month: '2-digit', 
                day: '2-digit', 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false 
            });
            const reg = t.registration || t.hex || 'Unknown';
            const flightText = t.flight ? ` (${t.flight})` : ' (N/A)';
            const typeText = t.type ? ` [${t.type}]` : '';
            const typeDesc = t.aircraft_model ? ` - ${t.aircraft_model}` : '';
            const timeSince = t.minutesSinceLast ? ` <span style="color: #999; font-size: 11px;">(${t.minutesSinceLast} min)</span>` : '';
            const altText = t.altitude ? `${t.altitude.toLocaleString()} ft` : 'N/A';
            
            // Airline info
            const airlineCode = t.airlineCode || '';
            const airlineName = t.airlineName || '';
            const airlineDisplay = airlineName ? `${airlineCode} - ${airlineName}` : (airlineCode || 'N/A');
            
            return `<li style="margin: 8px 0; padding: 12px; background: #1e1e1e; border-radius: 4px; border-left: 3px solid #42a5f5; color: #e0e0e0;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="color: #999; font-size: 12px;">${timeStr}</span> | 
                        <strong style="color: #fff;">${reg}</strong>${flightText}${typeText}${typeDesc}
                    </div>
                    <div style="font-weight: bold; color: #42a5f5;">
                        ${t.from} → ${t.to}${timeSince}
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 11px; color: #bbb; margin-top: 8px;">
                    <div>
                        <span style="color: #888;">Flight:</span> <strong style="color: #fff;">${t.flight || 'N/A'}</strong>
                    </div>
                    <div>
                        <span style="color: #888;">Type:</span> <strong style="color: #fff;">${t.type || 'N/A'}</strong>
                    </div>
                    <div>
                        <span style="color: #888;">Manufacturer:</span> <strong style="color: #fff;">${t.manufacturer || 'N/A'}</strong>
                    </div>
                    <div>
                        <span style="color: #888;">Airline:</span> <strong style="color: #fff;">${airlineDisplay}</strong>
                    </div>
                    <div>
                        <span style="color: #888;">Altitude:</span> <strong style="color: #fff;">${altText}</strong>
                    </div>
                </div>
            </li>`;
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
        
        const emptyMessage = '<li style="color: #999; padding: 20px; text-align: center; background: #2a2a2a; border-radius: 4px;">No transitions in this category</li>';
        
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
        const gap = document.getElementById('flights-gap').value || '5';
        const startElem = document.getElementById('flights-start-time');
        const endElem = document.getElementById('flights-end-time');
        
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
        
        let window = '1h'; // default
        
        // If hoursBack is provided, use it (from quick buttons)
        if (hoursBack !== null) {
            const now = new Date();
            const endTime = now.getTime();
            const startTime = endTime - (hoursBack * 60 * 60 * 1000);
            
            // Update input fields
            startElem.value = formatLocalDateTime(startTime);
            endElem.value = formatLocalDateTime(endTime);
            
            window = hoursBack + 'h';
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
            window = hours + 'h';
        }
        // Default to last 1 hour
        else {
            const now = new Date();
            const endTime = now.getTime();
            const startTime = endTime - (1 * 60 * 60 * 1000);
            
            startElem.value = formatLocalDateTime(startTime);
            endElem.value = formatLocalDateTime(endTime);
            
            window = '1h';
        }
        
        const response = await fetch(`/api/flights?gap=${gap}&window=${window}`);
        const data = await response.json();
        const tableBody = document.getElementById('flights-table-body');
        
        // Save current sort state before clearing table
        const table = tableBody.closest('table');
        saveTableSortState(table);
        
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
        
        // Update summary
        const summaryDiv = document.getElementById('flights-summary');
        if (totalCount > 0) {
            summaryDiv.innerHTML = `Total Flights: <strong>${totalCount}</strong> | Active: <strong>${activeCount}</strong> | No Longer Seen: <strong>${completedCount}</strong>`;
        } else {
            summaryDiv.innerHTML = 'No flights found';
        }
        
        if (!data || (!data.flights && !data.active)) {
            tableBody.innerHTML = '<tr><td colspan="21">No flights found</td></tr>';
            return;
        }

        for (const fl of allUnique) {
            const row = document.createElement('tr');
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
            
            row.innerHTML = `
                <td>${fl.icao}</td>
                <td>${fl.callsign || ''}</td>
                <td>${fl.airline_code || ''}</td>
                <td>${fl.airline_name || ''}</td>
                <td>${fl.airlineLogo ? `<img src="${fl.airlineLogo}" alt="${fl.airline_name} logo" style="height: 30px; max-width: 60px; object-fit: contain;">` : '—'}</td>
                <td>${fl.registration || ''}</td>
                <td>${typeDisplay}</td>
                <td>${fl.manufacturer || ''}</td>
                <td>${fl.manufacturerLogo ? `<img src="${fl.manufacturerLogo}" alt="${fl.manufacturer} logo" style="height: 30px; max-width: 60px; object-fit: contain;">` : '—'}</td>
                <td>${fl.bodyType || ''}</td>
                <td>${startTimeLocal}</td>
                <td>${endTimeLocal}</td>
                <td>${duration}</td>
                <td>${fl.start_lat}</td>
                <td>${fl.start_lon}</td>
                <td>${fl.end_lat}</td>
                <td>${fl.end_lon}</td>
                <td>${fl.max_alt_ft || ''}</td>
                <td>${fl.reports}</td>
                <td>${fl.slant_range_start !== undefined && fl.slant_range_start !== null ? fl.slant_range_start.toFixed(2) : ''}</td>
                <td>${fl.slant_range_end !== undefined && fl.slant_range_end !== null ? fl.slant_range_end.toFixed(2) : ''}</td>
            `;
            tableBody.appendChild(row);
        }
        
        // Restore sort state after populating table
        restoreTableSortState(table);
    } catch (error) {
        console.error('Error loading flights:', error);
    }
}

async function loadHeatmap(hoursBack = null) {
    const rawDataContainer = document.getElementById('heatmap-raw-data');
    const canvas = document.getElementById('heatmap-canvas');
    const totalPositionsDisplay = document.getElementById('heatmap-total-positions');
    const timestampsDisplay = document.getElementById('heatmap-timestamps');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    try {
        rawDataContainer.textContent = 'Loading...';
        totalPositionsDisplay.textContent = '';
        timestampsDisplay.textContent = '';
        
        const startElem = document.getElementById('heatmap-start-time');
        const endElem = document.getElementById('heatmap-end-time');
        
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
        
        // If hoursBack is provided, use it (from quick buttons)
        if (hoursBack !== null) {
            const now = new Date();
            const endTime = now.getTime();
            const startTime = endTime - (hoursBack * 60 * 60 * 1000);
            
            // Update input fields
            startElem.value = formatLocalDateTime(startTime);
            endElem.value = formatLocalDateTime(endTime);
            
            hours = hoursBack;
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
            
            hours = Math.ceil((endTime - startTime) / (60 * 60 * 1000));
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
        
        const response = await fetch(`/api/heatmap-data?hours=${hours}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        // Handle both old format (array) and new format (object with grid property)
        const gridData = data.grid || data;
        const totalPositions = data.totalPositions || 0;
        const firstPosition = data.firstPosition;
        const lastPosition = data.lastPosition;
        
        rawDataContainer.textContent = JSON.stringify(gridData, null, 2);
        
        // Calculate grid statistics
        const gridInfoElem = document.getElementById('heatmap-grid-info');
        const scaleMaxElem = document.getElementById('heatmap-scale-max');
        
        if (Array.isArray(gridData) && gridData.length > 0) {
            // Get first cell to determine grid size
            const firstCell = gridData[0];
            const latSize = Math.abs(firstCell.lat_max - firstCell.lat_min);
            const lonSize = Math.abs(firstCell.lon_max - firstCell.lon_min);
            
            // Calculate approximate grid cell dimensions in km and NM
            // At mid-latitudes, 1 degree lat ≈ 111 km, 1 degree lon ≈ 111 * cos(lat) km
            const avgLat = (firstCell.lat_min + firstCell.lat_max) / 2;
            const latKm = (latSize * 111).toFixed(1);
            const lonKm = (lonSize * 111 * Math.cos(avgLat * Math.PI / 180)).toFixed(1);
            const latNM = (latKm / 1.852).toFixed(1);
            const lonNM = (lonKm / 1.852).toFixed(1);
            
            // Find max count for scale
            let maxCount = 0;
            gridData.forEach(cell => {
                if (cell.count > maxCount) maxCount = cell.count;
            });
            
            // Calculate coverage area
            let minLon = gridData[0].lon_min, maxLon = gridData[0].lon_max;
            let minLat = gridData[0].lat_min, maxLat = gridData[0].lat_max;
            gridData.forEach(cell => {
                if (cell.lon_min < minLon) minLon = cell.lon_min;
                if (cell.lon_max > maxLon) maxLon = cell.lon_max;
                if (cell.lat_min < minLat) minLat = cell.lat_min;
                if (cell.lat_max > maxLat) maxLat = cell.lat_max;
            });
            const coverageLat = (maxLat - minLat).toFixed(2);
            const coverageLon = (maxLon - minLon).toFixed(2);
            
            gridInfoElem.innerHTML = `
                <div><strong>Grid Cell Size:</strong> ${latSize.toFixed(4)}° × ${lonSize.toFixed(4)}° (${latNM} NM × ${lonNM} NM, or ${latKm} km × ${lonKm} km)</div>
                <div><strong>Total Grid Cells:</strong> ${gridData.length.toLocaleString()}</div>
                <div><strong>Coverage Area:</strong> ${coverageLat}° latitude × ${coverageLon}° longitude</div>
                <div><strong>Coordinates:</strong> ${minLat.toFixed(2)}° to ${maxLat.toFixed(2)}° N, ${minLon.toFixed(2)}° to ${maxLon.toFixed(2)}° W</div>
            `;
            
            scaleMaxElem.textContent = maxCount.toLocaleString();
        } else {
            gridInfoElem.textContent = 'No grid data available';
            scaleMaxElem.textContent = '0';
        }

        // Display total positions and timestamps
        totalPositionsDisplay.textContent = `Total Positions: ${(totalPositions || gridData.reduce((sum, cell) => sum + (cell.count || 0), 0)).toLocaleString()}`;
        
        // Display first and last positions
        if (firstPosition || lastPosition) {
            let timestampText = '';
            if (firstPosition && lastPosition) {
                const firstDate = new Date(firstPosition);
                const lastDate = new Date(lastPosition);
                timestampText = `First: ${firstDate.toLocaleString()} | Last: ${lastDate.toLocaleString()}`;
            } else if (firstPosition) {
                timestampText = `First: ${new Date(firstPosition).toLocaleString()}`;
            } else if (lastPosition) {
                timestampText = `Last: ${new Date(lastPosition).toLocaleString()}`;
            }
            if (timestampText) {
                timestampsDisplay.textContent = timestampText;
            }
        }

        // If a dedicated renderer is available (exposed as window.renderHeatmap), use it.
        if (typeof window.renderHeatmap === 'function') {
            window.renderHeatmap(gridData, canvas);
            return;
        }

        // Fallback: inline rendering if the external renderer is not present
        if (!gridData || gridData.length === 0) {
            ctx.fillStyle = '#666';
            ctx.font = '14px sans-serif';
            ctx.fillText('No heatmap data available for this time period.', 10, 20);
            return;
        }

        // --- (Fallback) Find Data Boundaries ---
        let minLon = gridData[0].lon_min, maxLon = gridData[0].lon_max;
        let minLat = gridData[0].lat_min, maxLat = gridData[0].lat_max;
        let maxCount = 0;

        gridData.forEach(cell => {
            if (cell.lon_min < minLon) minLon = cell.lon_min;
            if (cell.lon_max > maxLon) maxLon = cell.lon_max;
            if (cell.lat_min < minLat) minLat = cell.lat_min;
            if (cell.lat_max > maxLat) maxLat = cell.lat_max;
            if (cell.count > maxCount) maxCount = cell.count;
        });

        const lonRange = maxLon - minLon || 1;
        const latRange = maxLat - minLat || 1;
        
        const pad = { top: 20, right: 20, bottom: 40, left: 60 };
        const chartWidth = canvas.width - pad.left - pad.right;
        const chartHeight = canvas.height - pad.top - pad.bottom;

        // --- Draw Grid Cells (fallback) ---
        gridData.forEach(cell => {
            const x = pad.left + ((cell.lon_min - minLon) / lonRange) * chartWidth;
            const y = pad.top + chartHeight - (((cell.lat_max - minLat) / latRange) * chartHeight);
            const cellWidth = ((cell.lon_max - cell.lon_min) / lonRange) * chartWidth;
            const cellHeight = ((cell.lat_max - cell.lat_min) / latRange) * chartHeight;

            const intensity = Math.sqrt((cell.count || 0) / (maxCount || 1));
            const hue = 240 - (intensity * 240);
            const color = `hsl(${hue}, 100%, 50%)`;

            ctx.fillStyle = color;
            ctx.fillRect(x, y, cellWidth, cellHeight);
        });

        // --- Draw Axes and Labels (fallback) ---
        ctx.strokeStyle = '#333';
        ctx.fillStyle = '#333';
        ctx.font = '12px sans-serif';
        ctx.lineWidth = 1;

        // Y-axis (Latitude)
        ctx.beginPath();
        ctx.moveTo(pad.left, pad.top);
        ctx.lineTo(pad.left, pad.top + chartHeight);
        ctx.stroke();
        for (let i = 0; i <= 5; i++) {
            const lat = minLat + (latRange * i / 5);
            const y = pad.top + chartHeight - (i / 5 * chartHeight);
            ctx.fillText(lat.toFixed(2), 5, y + 4);
            ctx.beginPath();
            ctx.moveTo(pad.left - 5, y);
            ctx.lineTo(pad.left, y);
            ctx.stroke();
        }

        // X-axis (Longitude)
        ctx.beginPath();
        ctx.moveTo(pad.left, pad.top + chartHeight);
        ctx.lineTo(pad.left + chartWidth, pad.top + chartHeight);
        ctx.stroke();
        ctx.textAlign = 'center';
        for (let i = 0; i <= 5; i++) {
            const lon = minLon + (lonRange * i / 5);
            const x = pad.left + (i / 5 * chartWidth);
            ctx.fillText(lon.toFixed(2), x, pad.top + chartHeight + 15);
            ctx.beginPath();
            ctx.moveTo(x, pad.top + chartHeight);
            ctx.lineTo(x, pad.top + chartHeight + 5);
            ctx.stroke();
        }
        ctx.textAlign = 'left';

    } catch (error) {
        console.error('Error loading heatmap data:', error);
        const rawDataContainer = document.getElementById('heatmap-raw-data');
        rawDataContainer.textContent = `Error: ${error.message}`;
        totalPositionsDisplay.textContent = '';
        timestampsDisplay.textContent = '';
    }
}

async function summarizeText() {
    const text = document.getElementById('gemini-input').value;
    const output = document.getElementById('gemini-output');
    if (!text) {
        output.textContent = 'Please enter text to summarize.';
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
    
    // Load initial data for all tabs
    setTimeout(() => {
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

// --- Cache Status Function ---
async function loadCacheStatus() {
    try {
        const response = await fetch('/api/cache-status');
        const stats = await response.json();
        
        const display = document.getElementById('cache-status-display');
        
        // Format aircraft database status
        const aircraftDbStatus = stats.aircraftDatabase || {};
        const dbStatusIcon = aircraftDbStatus.loaded ? '✓' : '✗';
        const dbStatusColor = aircraftDbStatus.loaded ? '#4caf50' : '#f44336';
        const dbStatusText = aircraftDbStatus.loaded ? 'Loaded' : 'Not Loaded';
        
        display.innerHTML = `
<strong>Position Cache:</strong>
  Total Positions: ${stats.positionCache.totalPositions.toLocaleString()}
  Unique Aircraft: ${stats.positionCache.uniqueAircraft}
  Last Refresh: ${stats.positionCache.lastRefresh}
  Memory Usage: ${stats.positionCache.cacheMemoryMb} MB

<strong style="color: ${dbStatusColor};">Aircraft Database (ICAO→Registration): ${dbStatusIcon} ${dbStatusText}</strong>
  Aircraft Records: ${(aircraftDbStatus.aircraftCount || 0).toLocaleString()}
  Data Source: ${aircraftDbStatus.source || 'Unknown'}
  Last Downloaded: ${aircraftDbStatus.downloaded || 'Unknown'}
  API Endpoint: <span style="color: #42a5f5;">/api/aircraft/:icao24</span>

<strong style="color: #7b1fa2;">Type Database (Typecode→Manufacturer/Model): ${(stats.typeDatabase && stats.typeDatabase.loaded) ? '✓' : '✗'}</strong>
    Types: ${(stats.typeDatabase && stats.typeDatabase.typeCount) ? stats.typeDatabase.typeCount.toLocaleString() : 0}
    Version: ${stats.typeDatabase && stats.typeDatabase.version ? stats.typeDatabase.version : 'Unknown'}
    Created: ${stats.typeDatabase && stats.typeDatabase.created ? stats.typeDatabase.created : 'Unknown'}
    API Endpoint: <span style="color: #42a5f5;">/api/aircraft-types/:typecode</span>

<strong>API Cache:</strong>
  Historical Stats Entries: ${stats.apiCache.historicalStats}
  Squawk Transitions Entries: ${stats.apiCache.squawkTransitions}
  Airline Stats Entries: ${stats.apiCache.airlineStats}

<strong style="color: #ff9800;">Logo System:</strong>
  <strong>S3 Storage:</strong>
    Total Logo Files: ${stats.logoCoverage.logosInS3.toLocaleString()}
  <strong>Database Coverage:</strong>
    Airlines with Logos: ${stats.logoCoverage.airlinesWithLogos}/${stats.logoCoverage.totalAirlines} (${stats.logoCoverage.totalAirlines > 0 ? ((stats.logoCoverage.airlinesWithLogos / stats.logoCoverage.totalAirlines) * 100).toFixed(1) : 0}%)
    Manufacturers with Logos: ${stats.logoCoverage.manufacturersWithLogos}/${stats.logoCoverage.totalManufacturers} (${stats.logoCoverage.totalManufacturers > 0 ? ((stats.logoCoverage.manufacturersWithLogos / stats.logoCoverage.totalManufacturers) * 100).toFixed(1) : 0}%)
  <strong>Cache Performance:</strong>
    Cached Logos: ${stats.logoCache.cachedLogos}
    Total Requests: ${stats.logoCache.totalRequests.toLocaleString()}
    Cache Hit Rate: ${stats.logoCache.totalRequests > 0 ? ((stats.logoCache.cacheHits / stats.logoCache.totalRequests) * 100).toFixed(1) : 0}%
  API Endpoint: <span style="color: #42a5f5;">/api/v1logos/:code</span>

<strong>S3 Operations:</strong>
  Read Operations: ${stats.s3Operations.reads.toLocaleString()}
  Write Operations: ${stats.s3Operations.writes.toLocaleString()}
  Errors: ${stats.s3Operations.errors.toLocaleString()}
  Last File Read: ${stats.s3Operations.lastRead}
  Last File Written: ${stats.s3Operations.lastWrite}

<strong>Last Processing Times:</strong>
  Flights: ${stats.lastProcessing.flights}
  Airlines: ${stats.lastProcessing.airlines}
  Squawks: ${stats.lastProcessing.squawks}
  Heatmap: ${stats.lastProcessing.heatmap}
  Positions (Historical): ${stats.lastProcessing.positions}
  Hourly Rollup: ${stats.lastProcessing.hourlyRollup}
        `.trim();
    } catch (error) {
        console.error('Error loading cache status:', error);
        document.getElementById('cache-status-display').innerHTML = 'Error loading cache status: ' + error.message;
    }
}

// Load cache status automatically when page loads
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(loadCacheStatus, 1000);
    // Auto-refresh every 30 seconds
    setInterval(loadCacheStatus, 30000);
});
