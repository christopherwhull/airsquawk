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

module.exports = { debug, info, warn, error, VERBOSE };
