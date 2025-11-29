/**
 * Aircraft Dashboard Configuration
 * All configurable parameters in one place
 */

module.exports = {
    // --- Server Configuration ---
    server: {
        port: process.env.PORT || 3002,
        logFile: process.env.LOG_FILE || 'runtime/server.log',
        accessLogFile: process.env.ACCESS_LOG_FILE || 'runtime/access.log',
    },

    // --- Data Source Configuration ---
    dataSource: {
        piAwareUrl: process.env.PIAWARE_URL || 'http://192.168.0.178:8080/data/aircraft.json',
        receiverTimeout: 5000, // milliseconds
    },

    // --- S3 / MinIO Configuration ---
    s3: {
        endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
        region: process.env.S3_REGION || 'us-east-1',
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
            secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin123',
        },
        forcePathStyle: true, // Required for MinIO
    },

    // --- S3 Buckets ---
    buckets: {
        readBucket: process.env.READ_BUCKET || 'aircraft-data',           // Historical data
        writeBucket: process.env.WRITE_BUCKET || 'aircraft-data-new',     // Current data
    },

    // --- State Management ---
    state: {
        stateFile: process.env.STATE_FILE || 'runtime/dashboard-state.json',
        lastDailyFlightBuildFile: process.env.LAST_DAILY_FILE || 'runtime/.last-daily-flight-build',
    },

    // --- Time Windows and Retention ---
    retention: {
        positionRetentionMs: 24 * 60 * 60 * 1000,     // 24 hours
        gapMs: 5 * 60 * 1000,                          // 5 minutes gap to close flight
        minFlightDurationMs: 0.5 * 60 * 1000,          // 0.5 minutes
        squawkRetentionDays: 7,                         // Keep last 7 days of squawk transitions
        aircraftTrackingTimeoutMs: 60 * 1000,          // 1 minute timeout for active aircraft
    },

    // --- Data Aggregation and Calculations ---
    aggregation: {
        gridSizeForHeatmap: 0.01,                      // Grid cell size for heatmap (degrees)
        sectorDegrees: 10,                             // Sector size for bearing calculations
        altitudeZoneSizeFeet: 5000,                    // Altitude band size (feet)
    },

    // --- Background Job Intervals (milliseconds) ---
    backgroundJobs: {
        fetchDataInterval: 1000,                       // Fetch live aircraft data every 1 second
        saveStateInterval: 30 * 1000,                  // Save state every 30 seconds
        saveAircraftDataInterval: 60 * 1000,           // Save aircraft data to S3 every 1 minute
        buildFlightsInterval: 120 * 1000,              // Build flights from S3 every 2 minutes
        buildHourlyPositionsInterval: 300 * 1000,     // Build hourly positions every 5 minutes
        aggregateAirlinesInterval: 5 * 60 * 1000,     // Aggregate airline stats every 5 minutes
        aggregateSquawkInterval: 5 * 60 * 1000,       // Aggregate squawk transitions every 5 minutes
        aggregateHistoricalInterval: 30 * 60 * 1000,  // Aggregate historical data every 30 minutes
        remakeHourlyRollupInterval: 60 * 60 * 1000, // Remake hourly rollup every hour
    },

    // --- Initial Job Delays (milliseconds) ---
    initialJobDelays: {
        buildFlightsDelay: 5000,                       // Run first build after 5 seconds
        buildHourlyPositionsDelay: 10000,              // Run first hourly aggregation after 10 seconds
        remakeHourlyRollupDelay: 15000,                // Run first rollup after 15 seconds
    },

    // --- Position Cache Configuration ---
    positionCache: {
        lookbackDays: 7,                               // Keep 7 days of historical position data
    },

    // --- API Endpoint Defaults ---
    api: {
        heatmap: {
            defaultHours: 24,                          // Default time window
        },
        positionTimeseries: {
            defaultMinutes: 10,                        // Default time window
            defaultResolution: 1,                      // Default resolution in minutes
        },
        receptionRange: {
            defaultHours: 24,                          // Default time window
        },
        squawkTransitions: {
            defaultHours: 24,                          // Default time window
        },
        historicalStats: {
            defaultHours: 168,                         // 7 days
            defaultResolution: 60,                     // 1 hour buckets
        },
        flights: {
            defaultWindow: '24h',                      // Time window
            defaultGap: 5,                             // Minutes to consider flights separate
        },
    },

    // --- S3 List Operation Limits ---
    s3ListLimits: {
        maxKeys: 1000,                                 // Max objects per list call
        maxPages: null,                                // Max pages to iterate (null = unlimited)
    },

    // --- Data Processing Configuration ---
    dataProcessing: {
        // When building flights from S3, include only last 24 hours by default
        flightsLookbackHours: 24,
        // Save positions aggregated by hour
        hourlyPositionLookbackDays: 7,
        // CSV export
        exportToCSV: true,                             // Save flights to CSV in addition to S3
    },

    // --- Logging ---
    logging: {
        level: process.env.LOG_LEVEL || 'info',      // 'debug', 'info', 'warn', 'error'
        format: 'combined',                            // Morgan format for access logs
    },

    // --- Reception Tracking (KML Export) ---
    reception: {
        enableKML: true,                               // Generate KML for reception records
        enableHeatmap: true,                           // Generate heatmap data
    },

    // --- UI / Frontend Defaults ---
    ui: {
        // Default time ranges for each tab (in hours)
        defaultTimeRanges: {
            airlines: 1,
            flights: 1,
            squawk: 1,
            heatmap: 24,
            reception: 24,
            positions: 24,
        },
        // Quick time buttons available on each tab
        quickTimeButtons: [
            { label: '1 Hour', hours: 1 },
            { label: '6 Hours', hours: 6 },
            { label: '24 Hours', hours: 24 },
            { label: '7 Days', hours: 168 },
            { label: '31 Days', hours: 744 },
        ],
        // Graph settings
        graph: {
            positionTimeBins: 15,                      // Minutes per time bin for position graph
            showPositionsOnLeftAxis: true,             // Use dual Y-axes (positions on left)
            defaultMetrics: {                          // Which metrics to show by default
                positions: true,
                aircraft: true,
                flights: true,
                airlines: true,
            },
        },
        // Reception settings
        reception: {
            bearingSectorSize: 15,                     // Degrees per bearing sector
            altitudeBinSize: 5000,                     // Feet per altitude bin
            ringIntervals: 25,                         // Nautical miles per ring on bearing chart
        },
        // Heatmap settings
        heatmap: {
            gridCellSize: 1,                           // Nautical miles per grid cell (1 NM × 1 NM)
        },
        // Table settings
        table: {
            defaultSortColumn: 'count',                // Default sort for airline stats
            defaultSortDirection: 'desc',              // 'asc' or 'desc'
        },
    }
};
