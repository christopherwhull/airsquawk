#!/usr/bin/env node
/**
 * WebSocket watcher for the AirSquawk websocket-server.
 *
 * Usage:
 *   node tools/watch-websocket.js [--url http://localhost:3003] [--event liveUpdate]
 *                                  [--compact] [--max 10]
 *
 * Flags:
 *   --url / -u       Override the websocket-server URL (default http://localhost:3003)
 *   --event / -e     Socket.IO event name to watch (default liveUpdate)
 *   --compact        Print one-line summaries instead of the full JSON payload
 *   --max / -m       Exit after N events have been received (useful for tests)
 *   --help           Show this message
 */

const { io } = require('socket.io-client');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
    console.log(`Watch websocket-server events\n\nUsage:\n  node tools/watch-websocket.js [options]\n\nOptions:\n  -u, --url <url>      Websocket server base URL (default http://localhost:3003)\n  -e, --event <name>   Socket.IO event to listen for (default liveUpdate)\n  --compact            Print compact one-line summaries\n  -m, --max <count>    Exit after receiving <count> events\n  -h, --help           Show this help\n`);
    process.exit(0);
}

function readArg(longFlag, shortFlag) {
    let idx = args.indexOf(longFlag);
    if (idx === -1 && shortFlag) {
        idx = args.indexOf(shortFlag);
    }
    if (idx !== -1 && idx + 1 < args.length) {
        return args[idx + 1];
    }
    return null;
}

function readNumberArg(longFlag, shortFlag) {
    const value = readArg(longFlag, shortFlag);
    if (value === null) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

const url = readArg('--url', '-u') || process.env.WEBSOCKET_URL || 'http://localhost:3003';
const eventName = readArg('--event', '-e') || process.env.WEBSOCKET_EVENT || 'liveUpdate';
const compact = args.includes('--compact');
const maxEvents = readNumberArg('--max', '-m');

const socket = io(url, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 5000
});

let eventCount = 0;

function ts() {
    return new Date().toISOString();
}

console.log(`[watch-websocket] Connecting to ${url} (event: ${eventName})`);

socket.on('connect', () => {
    console.log(`[${ts()}] Connected (socket id=${socket.id})`);
});

socket.on('disconnect', (reason) => {
    console.log(`[${ts()}] Disconnected (${reason})`);
});

socket.on('connect_error', (error) => {
    console.error(`[${ts()}] Connection error: ${error.message || error}`);
});

socket.on(eventName, (payload) => {
    eventCount += 1;
    if (compact) {
        const summary = summaryFromPayload(payload);
        console.log(`[${ts()}] #${eventCount} ${eventName} ${summary}`);
    } else {
        console.log(`\n[${ts()}] #${eventCount} ${eventName} payload:`);
        try {
            console.log(JSON.stringify(payload, null, 2));
        } catch (err) {
            console.log(payload);
        }
    }

    if (maxEvents && eventCount >= maxEvents) {
        console.log(`[watch-websocket] Reached max events (${maxEvents}); exiting.`);
        cleanupAndExit(0);
    }
});

socket.io.on('reconnect_attempt', (attempt) => {
    console.log(`[${ts()}] Reconnect attempt ${attempt}`);
});

socket.io.on('reconnect', (attempt) => {
    console.log(`[${ts()}] Reconnected after ${attempt} attempt(s)`);
});

socket.io.on('reconnect_failed', () => {
    console.error(`[${ts()}] Reconnect failed`);
});

function summaryFromPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return '(non-object payload)';
    }
    const parts = [];
    if (payload.trackingCount !== undefined) parts.push(`tracking=${payload.trackingCount}`);
    if (payload.aircraft && Array.isArray(payload.aircraft)) parts.push(`aircraft=${payload.aircraft.length}`);
    if (payload.runningPositionCount !== undefined) parts.push(`positions=${payload.runningPositionCount}`);
    if (payload.receiverCount !== undefined) parts.push(`receivers=${payload.receiverCount}`);
    if (!parts.length) {
        const keys = Object.keys(payload).slice(0, 5).join(', ');
        return `(keys: ${keys || 'none'})`;
    }
    return parts.join(' ');
}

function cleanupAndExit(code) {
    try {
        socket.close();
    } catch (err) {
        // ignore
    }
    process.exit(code);
}

process.on('SIGINT', () => {
    console.log('\n[watch-websocket] Caught SIGINT, shutting down.');
    cleanupAndExit(0);
});

process.on('SIGTERM', () => {
    console.log('\n[watch-websocket] Caught SIGTERM, shutting down.');
    cleanupAndExit(0);
});