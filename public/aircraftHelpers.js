// Helper functions for aircraft dashboard

// Color coding for track segments by vertical rate
function getVerticalRateColor(verticalRate) {
  // Use feet per minute units and ignore small fluctuations (<= 200 fpm)
  const climbThreshold = 200; // fpm
  const descentThreshold = 200; // fpm
  if (typeof verticalRate !== 'number') verticalRate = Number(verticalRate) || 0;
  if (verticalRate > climbThreshold) return 'green';
  if (verticalRate < -descentThreshold) return 'red';
  return 'yellow';
}

// Icon mappings
const TypeDesignatorIcons = {
  'A21N': 'airliner', 'A388': 'heavy_4e', 'B738': 'airliner', 'B763': 'airliner', 'B77W': 'heavy_2e',
  'C172': 'cessna', 'SR22': 'hi_perf', 'CRJ7': 'jet_swept', 'CRJ9': 'jet_swept', 'E75L': 'airliner',
  'H500': 'helicopter', 'B350': 'twin_small', 'B190': 'twin_small', 'B25': 'twin_large',
  // ...add more as needed
};
const CategoryIcons = {
  'A1': 'cessna', 'A2': 'jet_nonswept', 'A3': 'airliner', 'A4': 'heavy_2e', 'A5': 'heavy_4e', 'A6': 'hi_perf', 'A7': 'helicopter',
};

function getIconForAircraft(pos) {
  if (pos.aircraft_type && TypeDesignatorIcons[pos.aircraft_type]) return TypeDesignatorIcons[pos.aircraft_type];
  if (pos.category && CategoryIcons[pos.category]) return CategoryIcons[pos.category];
  return 'aircraft';
}

function createAircraftLogoIcon(pos = {}, rotation = 0, size = 40, verticalRate = 0) {
  const icon = getIconForAircraft(pos);
  const src = `icons/${icon}.svg`;
  // Determine glow/border and background fill color based on vertical rate
  let glowStyle = '';
  let bgStyle = '';
  try {
    if (typeof verticalRate === 'number') {
      if (verticalRate > 500) {
        // climbing: light green glow and background fill
        glowStyle = `box-shadow: 0 0 8px rgba(0, 255, 128, 0.6); border: 2px solid rgba(0, 200, 80, 0.5); border-radius:8px;`;
        bgStyle = `background-color: rgba(0,255,128,0.10); border-radius:8px; padding:2px;`;
      } else if (verticalRate < -300) {
        // descending: light red glow and background fill
        glowStyle = `box-shadow: 0 0 8px rgba(255, 80, 80, 0.6); border: 2px solid rgba(255, 60, 60, 0.45); border-radius:8px;`;
        bgStyle = `background-color: rgba(255,80,80,0.10); border-radius:8px; padding:2px;`;
      } else {
        glowStyle = `border: 2px solid transparent;`;
        bgStyle = '';
      }
    }
  } catch (e) { glowStyle = `border: 2px solid transparent;`; bgStyle = ''; }

  return L.divIcon({
    html: `<div style="transform: rotate(${rotation}deg); width: ${size}px; height:${size}px; display:flex; align-items:center; justify-content:center; ${bgStyle} ${glowStyle}"><img src='${src}' style='width:${size}px;height:${size}px;object-fit:contain;'/></div>`,
    className: 'aircraft-logo-icon',
    iconSize: [size, size],
    iconAnchor: [size/2, size/2]
  });
}

function buildPopupHTML(pos) {
  const callsign = pos.flight || pos.callsign || pos.call || pos.callsign_icao || pos.flight_ident || '';
  const hex = (pos.hex || pos.HEX || pos.icao || pos.icao24 || '').toUpperCase();
  const squawk = pos.sqk || pos.squawk || pos.transponder || pos.transponder_code || pos.squawk_code || '';
  const reg = pos.registration || pos.reg || pos.tail || '';
  const airline = pos.airline || pos.operator || pos.operator_name || pos.airline_name || '';
  const altNum = Number(pos.alt || pos.altitude || '');
  const alt = (altNum && Number.isFinite(altNum)) ? `${altNum.toLocaleString()} ft` : (pos.alt || pos.altitude || '');
  const speedNum = Number(pos.gs || pos.speed || pos.groundSpeed || pos.max_speed_kt || '');
  const speed = (speedNum && Number.isFinite(speedNum)) ? `${speedNum.toLocaleString()} kt` : (pos.gs || pos.speed || pos.groundSpeed || pos.max_speed_kt || '');
  const trackVal = (typeof pos.track === 'number' ? pos.track : (typeof pos.heading === 'number' ? pos.heading : (typeof pos.course === 'number' ? pos.course : '')));
  const track = (trackVal !== '' && trackVal != null) ? trackVal : '';
  const lat = pos.lat;
  const lon = pos.lon;

  // Check if FlightAware integration is enabled (you can set this via a global config or localStorage)
  const flightAwareEnabled = window.flightAwareEnabled || false;

  if (flightAwareEnabled) {
    // Use enhanced popup with FlightAware data
    return createAircraftPopupEnhanced(pos, hex, callsign, reg, airline, squawk, alt, speed, track, lat, lon);
  } else {
    // Use basic popup
    const timeStr = pos.timestamp ? (() => {
      const timestamp = isNaN(Number(pos.timestamp)) ? new Date(pos.timestamp).getTime() : Number(pos.timestamp);
      const ageSeconds = Math.floor((Date.now() - timestamp * 1000) / 1000);
      return ageSeconds >= 0 ? `${ageSeconds}s ago` : '—';
    })() : '—';
    const aircraftType = pos.type || pos.aircraft_type || pos.t || '';
    const flightAwareUrl = callsign
      ? `https://flightaware.com/live/flight/${encodeURIComponent(callsign)}`
      : `https://flightaware.com/live/modes/${encodeURIComponent(hex.toLowerCase())}/ident`;
    const displayText = `${hex}${callsign ? ' — ' + callsign : ''}`;
    return `
      <div style=\"min-width:200px; background-color:#fff; border-radius:6px; padding:8px;\">
        <strong><a href=\"${flightAwareUrl}\" onclick=\"window.open('${flightAwareUrl}', '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes'); return false;\" style=\"color:inherit;text-decoration:none;cursor:pointer;\">${displayText}</a></strong>
        <div>Registration: <em>${reg || '—'}</em></div>
        <div>Type: <em>${aircraftType || '—'}</em></div>
        <div>Airline: <em>${airline || '—'}</em></div>
        <div>Squawk: <em>${squawk || '—'}</em></div>
        <div>Alt: <em>${alt || '—'}</em></div>
        <div>Speed: <em>${speed || '—'}</em></div>
        <div>Track: <em>${track !== '' ? track + '°' : '—'}</em></div>
        <div>Pos: <em>${lat ? (typeof lat === 'number' ? lat.toFixed(5) : lat) : '—'}, ${lon ? (typeof lon === 'number' ? lon.toFixed(5) : lon) : '—'}</em></div>
        <div>Age: <em>${timeStr}</em></div>
      </div>`;
  }
}

export { getVerticalRateColor, getIconForAircraft, createAircraftLogoIcon, buildPopupHTML };

// Enhanced aircraft popup with FlightAware data
async function createAircraftPopupEnhanced(pos, hex, callsign, reg, airline, squawk, alt, speed, track, lat, lon) {
  const timeStr = pos.timestamp ? (() => {
    const timestamp = isNaN(Number(pos.timestamp)) ? new Date(pos.timestamp).getTime() : Number(pos.timestamp);
    const ageSeconds = Math.floor((Date.now() - timestamp * 1000) / 1000);
    return ageSeconds >= 0 ? `${ageSeconds}s ago` : '—';
  })() : '—';

  const aircraftType = pos.type || pos.aircraft_type || pos.t || '';
  const flightAwareUrl = callsign
    ? `https://flightaware.com/live/flight/${encodeURIComponent(callsign)}`
    : `https://flightaware.com/live/modes/${encodeURIComponent(hex.toLowerCase())}/ident`;

  const displayText = `${hex}${callsign ? ' — ' + callsign : ''}`;

  // Try to get enhanced FlightAware data
  let flightAwareData = null;
  let aircraftData = null;

  if (callsign) {
    try {
      const flightResponse = await fetch(`/api/flightaware/flight/${encodeURIComponent(callsign)}`);
      if (flightResponse.ok) {
        flightAwareData = await flightResponse.json();
      }
    } catch (e) {
      console.log('FlightAware flight data not available');
    }
  }

  if (reg) {
    try {
      const aircraftResponse = await fetch(`/api/flightaware/aircraft/${encodeURIComponent(reg)}`);
      if (aircraftResponse.ok) {
        aircraftData = await aircraftResponse.json();
      }
    } catch (e) {
      console.log('FlightAware aircraft data not available');
    }
  }

  // Build enhanced content
  let enhancedContent = '';

  if (flightAwareData && flightAwareData.flights && flightAwareData.flights.length > 0) {
    const flight = flightAwareData.flights[0];
    enhancedContent += `
      <div style="margin-top: 8px; padding: 6px; background-color: #f0f8ff; border-radius: 4px; border-left: 3px solid #007acc;">
        <strong>FlightAware Data:</strong><br>
        <div>Status: <em>${flight.status || 'Unknown'}</em></div>
        ${flight.departure_delay ? `<div>Departure Delay: <em>${flight.departure_delay} min</em></div>` : ''}
        ${flight.arrival_delay ? `<div>Arrival Delay: <em>${flight.arrival_delay} min</em></div>` : ''}
        ${flight.route ? `<div>Route: <em>${flight.route}</em></div>` : ''}
      </div>`;
  }

  if (aircraftData && aircraftData.length > 0) {
    const aircraft = aircraftData[0];
    enhancedContent += `
      <div style="margin-top: 8px; padding: 6px; background-color: #fff8f0; border-radius: 4px; border-left: 3px solid #ff9500;">
        <strong>Aircraft Details:</strong><br>
        <div>Model: <em>${aircraft.model || 'Unknown'}</em></div>
        <div>Year: <em>${aircraft.year || 'Unknown'}</em></div>
        ${aircraft.owner ? `<div>Owner: <em>${aircraft.owner}</em></div>` : ''}
      </div>`;
  }

  return `
    <div style="min-width:200px; background-color:#fff; border-radius:6px; padding:8px;">
      <strong><a href="${flightAwareUrl}" onclick="window.open('${flightAwareUrl}', '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes'); return false;" style="color:inherit;text-decoration:none;cursor:pointer;">${displayText}</a></strong>
      <div>Registration: <em>${reg || '—'}</em></div>
      <div>Type: <em>${aircraftType || '—'}</em></div>
      <div>Airline: <em>${airline || '—'}</em></div>
      <div>Squawk: <em>${squawk || '—'}</em></div>
      <div>Alt: <em>${alt || '—'}</em></div>
      <div>Speed: <em>${speed || '—'}</em></div>
      <div>Track: <em>${track !== '' ? track + '°' : '—'}</em></div>
      <div>Pos: <em>${lat ? (typeof lat === 'number' ? lat.toFixed(5) : lat) : '—'}, ${lon ? (typeof lon === 'number' ? lon.toFixed(5) : lon) : '—'}</em></div>
      <div>Age: <em>${timeStr}</em></div>
      ${enhancedContent}
    </div>`;
}
