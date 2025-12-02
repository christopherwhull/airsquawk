const util = require('util');
const fs = require('fs');
const path = require('path');

const VERBOSE = !!(process.env.VERBOSE && process.env.VERBOSE !== '0' && process.env.VERBOSE.toLowerCase() !== 'false');

let w3cLogPath = null;

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

// Initialize W3C logger with config
function initializeW3CLogger(config) {
  // Get log directory from config, default to 'runtime'
  const logDir = config?.server?.w3cLogDir || process.env.W3C_LOG_DIR || 'runtime';
  
  // Create directory if it doesn't exist
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  } catch (err) {
    console.error('Failed to create W3C log directory:', err.message);
    return false;
  }
  
  // Generate log file path with timestamp
  const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  w3cLogPath = path.join(logDir, `access-${dateStr}.log`);
  
  // Write W3C header if file is new
  try {
    if (!fs.existsSync(w3cLogPath)) {
      const header = [
        '#Software: aircraft-dashboard',
        `#Version: 1.0`,
        `#Date: ${new Date().toISOString()}`,
        '#Fields: date time c-ip cs-method cs-uri-stem cs-uri-query sc-status sc-bytes cs(User-Agent) cs(Referer) time-taken-ms time-taken-us time-taken-ns cs-host sc-content-type',
        ''
      ].join('\n');
      fs.appendFileSync(w3cLogPath, header);
      console.log(`✓ W3C logger initialized: ${w3cLogPath}`);
    }
  } catch (err) {
    console.error('Failed to initialize W3C log file:', err.message);
    w3cLogPath = null;
    return false;
  }
  
  return true;
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
    
    // Log to console
    console.log(`[W3C] ${w3cLine}`);
    
    // Log to file if initialized
    if (w3cLogPath) {
      try {
        fs.appendFileSync(w3cLogPath, w3cLine + '\n');
      } catch (err) {
        console.error('Failed to write W3C log:', err.message);
      }
    }
  });

  next();
}

module.exports = { debug, info, warn, error, VERBOSE, logW3C, initializeW3CLogger };
