const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const logger = require('./lib/logger');
const { logW3C, initializeW3CLogger } = logger;

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Store the latest live data with a TTL so stale updates are not replayed forever
const LIVE_DATA_TTL_MS = Number(process.env.LIVE_DATA_TTL_MS || 60 * 1000);
let latestLiveData = null; // shape: { payload, ts }

function setLatestLiveData(payload) {
    latestLiveData = { payload, ts: Date.now() };
}

function getFreshLiveData() {
    if (!latestLiveData) return null;
    if ((Date.now() - latestLiveData.ts) > LIVE_DATA_TTL_MS) {
        latestLiveData = null;
        return null;
    }
    return latestLiveData.payload;
}

initializeW3CLogger({ server: { w3cLogDir: 'logs' } });
app.use(logW3C);

// WebSocket connection handling
io.on('connection', (socket) => {
    logger.info('WebSocket client connected');

    // Send latest data immediately on connection
    const fresh = getFreshLiveData();
    if (fresh) {
        socket.emit('liveUpdate', fresh);
    }

    socket.on('disconnect', () => {
        logger.info('WebSocket client disconnected');
    });
});

// Endpoint for main server to push live updates
app.post('/api/live-update', express.json(), (req, res) => {
    try {
        const payload = req.body;
        setLatestLiveData(payload);
        io.emit('liveUpdate', payload);
        res.json({ success: true });
    } catch (error) {
        logger.error('Error processing live update:', error);
        res.status(500).json({ error: 'Failed to process live update' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        clients: io.engine.clientsCount,
        uptime: process.uptime()
    });
});

setInterval(() => {
    if (!latestLiveData) return;
    if ((Date.now() - latestLiveData.ts) > LIVE_DATA_TTL_MS) {
        latestLiveData = null;
        logger.debug ? logger.debug('Cleared stale WebSocket live data cache') : logger.info('Cleared stale WebSocket live data cache');
    }
}, Math.min(LIVE_DATA_TTL_MS, 5000));

const WEBSOCKET_PORT = process.env.WEBSOCKET_PORT || 3003;

server.listen(WEBSOCKET_PORT, () => {
    logger.info(`WebSocket server listening on port ${WEBSOCKET_PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('WebSocket server shutting down');
    server.close(() => {
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info('WebSocket server shutting down');
    server.close(() => {
        process.exit(0);
    });
});

module.exports = { io, app };