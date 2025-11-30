const util = require('util');

const VERBOSE = !!(process.env.VERBOSE && process.env.VERBOSE !== '0' && process.env.VERBOSE.toLowerCase() !== 'false');

function debug(...args) {
  if (VERBOSE) {
    if (console.debug) console.debug(...args);
    else console.log('[DEBUG]', ...args);
  }
}

function info(...args) {
  console.log(...args);
}

function warn(...args) {
  console.warn(...args);
}

function error(...args) {
  console.error(...args);
}

// W3C Extended Log Format logging
function logW3C(req, res, next) {
  const startTime = process.hrtime.bigint(); // High-resolution start time

  // Wait for response to finish
  res.on('finish', () => {
    const endTime = process.hrtime.bigint(); // High-resolution end time
    const durationNs = endTime - startTime; // Duration in nanoseconds
    const durationMs = Number(durationNs) / 1_000_000; // Convert to milliseconds
    const durationUs = Number(durationNs) / 1_000; // Convert to microseconds

    const now = new Date();

    // W3C Extended Log Format fields with enhanced timing
    const logEntry = {
      date: now.toISOString().split('T')[0], // YYYY-MM-DD
      time: now.toISOString().split('T')[1].split('.')[0], // HH:MM:SS
      'c-ip': req.ip || req.connection.remoteAddress || '-', // Client IP
      'cs-method': req.method, // Request method
      'cs-uri-stem': req.path || '/', // URI stem
      'cs-uri-query': req.query && Object.keys(req.query).length > 0 ? '?' + new URLSearchParams(req.query).toString() : '-', // Query string
      'sc-status': res.statusCode, // Status code
      'sc-bytes': res.get('Content-Length') || '-', // Response size
      'cs(User-Agent)': req.get('User-Agent') || '-', // User agent
      'cs(Referer)': req.get('Referer') || '-', // Referer
      'time-taken-ms': durationMs.toFixed(2), // Time taken in milliseconds (2 decimal places)
      'time-taken-us': Math.round(durationUs), // Time taken in microseconds (rounded)
      'time-taken-ns': durationNs.toString(), // Time taken in nanoseconds
      'cs-host': req.get('Host') || '-', // Host header
      'sc-content-type': res.get('Content-Type') || '-' // Content type
    };

    // Format as W3C Extended Log Format
    const w3cLine = Object.values(logEntry).join(' ');
    console.log(`[W3C] ${w3cLine}`);
  });

  next();
}

module.exports = { debug, info, warn, error, VERBOSE, logW3C };
