# Aircraft Dashboard Wiki

Welcome to the project wiki. Start here for an overview and quick links.

## Quick Links
- [Live](Live) — Live aircraft tracking and table
- [Heatmap](Heatmap) — Leaflet heatmap viewer
- [Flights](Flights) — Flight list and details
- [Airlines](Airlines) — Airline statistics
- [Positions](Positions) — Position data and timeseries
- [Squawk](Squawk) — Squawk lookup and examples
- [Reception](Reception) — Piaware reception maps
- [Cache Status](Cache-Status) — Cache & enrichment status
 
## All Pages
A full list of wiki pages for quick navigation:

- [Home](Home)
- [Live](Live)
- [Heatmap](Heatmap)
- [Flights](Flights)
- [Airlines](Airlines)
- [Positions](Positions)
- [Squawk](Squawk)
- [Reception](Reception)
- [Cache Status](Cache-Status)
- [HTML Pages](HTML_PAGES)
- [TABS Index](TABS)
- [AI Helper](AI-Helper)
- [S3 Diagnostics](S3-Diagnostics)
- [Release Process](Release-Process)

 
## All Pages
A full list of wiki pages for quick navigation:

- [Home](Home)
- [Live](Live)
- [Heatmap](Heatmap)
- [Flights](Flights)
- [Airlines](Airlines)
- [Positions](Positions)
- [Squawk](Squawk)
- [Reception](Reception)
- [Cache Status](Cache-Status)
- [HTML Pages](HTML_PAGES)
- [TABS Index](TABS)
- [AI Helper](AI-Helper)
- [S3 Diagnostics](S3-Diagnostics)
- [Release Process](Release-Process)

- Getting Started: see README.md (install, configure, run)
- Configuration: `CONFIGURATION.md` and `MINIO_SETUP.md`
- Linux production: `LINUX_SETUP.md` and `aircraft-dashboard.service`
- AI Helper: AI collaboration guide (see AI-Helper page)
- S3 Diagnostics: How to validate bucket structure, freshness, and gaps
- Release Process: Versioning, changelog, and tagging

## Key Components
- Server: `server.js`, `lib/api-routes.js`
- Config: `config.js` (single source of truth)
- Tests: `__tests__/`, `tools/test_all.py`, `tools/test_s3_structure.py`
- Data: Buckets `aircraft-data` (read) and `aircraft-data-new` (write)

## Recent Highlights (v2.0.0)
- Fixed PiAware zero-aircraft issue by querying `/data/aircraft.json`
- Robust S3 diagnostics with UTC gap analysis (> 1 hour)
- Test runner fixes and improved stability
- Docs and AI helper guide added
