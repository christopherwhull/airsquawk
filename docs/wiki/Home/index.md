# Aircraft Dashboard Wiki

Welcome to the project wiki. Start here for an overview and quick links.

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
