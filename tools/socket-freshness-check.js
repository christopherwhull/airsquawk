#!/usr/bin/env node
const { io } = require('socket.io-client');

const url = process.argv[2] || process.env.WEBSOCKET_URL || 'http://localhost:3003';
const eventName = process.argv[3] || process.env.WEBSOCKET_EVENT || 'liveUpdate';

const socket = io(url, {
  transports: ['websocket'],
  timeout: 5000,
  reconnection: false
});

const AGE_WARN_MS = Number(process.env.FRESHNESS_WARN_MS || 3000);
const COLORS = {
  red: '\x1b[31m',
  reset: '\x1b[0m'
};

const abortTimer = setTimeout(() => {
  console.error('Timed out waiting for liveUpdate payload');
  try { socket.close(); } catch (err) {}
  process.exit(1);
}, 10000);

socket.on('connect', () => {
  console.log(`[freshness] Connected to ${url} (event=${eventName})`);
});

socket.on(eventName, (payload) => {
  clearTimeout(abortTimer);
  const now = Date.now();
  const positions = Array.isArray(payload?.positions)
    ? payload.positions
    : Array.isArray(payload?.aircraft)
      ? payload.aircraft
      : Array.isArray(payload)
        ? payload
        : [];

  const rows = positions.map((p) => {
    const timestamp = typeof p.timestamp === 'number'
      ? p.timestamp
      : typeof p.receiver_timestamp === 'number'
        ? p.receiver_timestamp
        : null;
    const isoTimestamp = timestamp ? new Date(timestamp).toISOString() : null;
    const ageMs = timestamp ? now - timestamp : null;
    return {
      hex: p.hex || p.icao || p.icao24 || 'unknown',
      flight: p.flight || '',
      timestamp,
      isoTimestamp,
      ageMs,
      ageSeconds: ageMs != null ? ageMs / 1000 : null
    };
  });

  const receivedIso = new Date(now).toISOString();
  console.log(`\n[freshness] ${receivedIso} ${eventName} (${rows.length} positions, warn>${AGE_WARN_MS/1000}s)`);

  if (!rows.length) {
    console.log('No positions in payload.');
  } else {
    rows.forEach(row => {
      const ageSeconds = row.ageSeconds != null ? row.ageSeconds : null;
      const ageStr = ageSeconds != null ? ageSeconds.toFixed(3).padStart(8) : '   n/a ';
      const iso = row.isoTimestamp || 'n/a';
      const flight = (row.flight || '').padEnd(8).substring(0, 8);
      const hex = (row.hex || '').padEnd(8).substring(0, 8);
      const stale = ageSeconds != null && ageSeconds * 1000 > AGE_WARN_MS;
      const colorPrefix = stale ? COLORS.red : '';
      const colorSuffix = stale ? COLORS.reset : '';
      console.log(`${colorPrefix}${hex} ${flight} ts=${iso} age=${ageStr}s${colorSuffix}`);
    });
  }

  try { socket.close(); } catch (err) {}
  process.exit(0);
});

socket.on('connect_error', (err) => {
  clearTimeout(abortTimer);
  console.error(`[freshness] Connection error: ${err?.message || String(err)}`);
  try { socket.close(); } catch (closeErr) {}
  process.exit(1);
});
