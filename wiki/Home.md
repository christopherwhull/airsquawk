# Aircraft Dashboard Wiki

Turn PiAware ADS‑B data into real-time flight intelligence and analytics. Aircraft Dashboard is an open-source platform for live tracking, playback, and analytics — ideal for hobbyists, operators, and organizations that need on-premise situational awareness and secure data retention.

Who it's for:
- Hobbyists and Enthusiasts: Visualize local aircraft and track flights in real time.
- Operators & Airports: Monitor fleet movements and squawk transitions for operations.
- Analysts & Researchers: Access granular position history and aggregated datasets for analysis.

Key benefits:
- Rapid Deployment: Simple PiAware + Node.js setup with optional MinIO/S3 archival.
- Privacy & Control: Run locally to keep data within your network.
- Rich Analytics: Flight reconstruction, airline summaries, reception analysis, and squawk tracking.
- Extensible: Customizable, open-source code base for building integrations and automation.

---

> Getting started (2 minutes):
>
> ```bash
> git clone https://github.com/christopherwhull/aircraft-dashboard.git
> cd aircraft-dashboard
> npm install
> export PIAWARE_URL=http://your-piaware:8080/data/aircraft.json
> npm start
> 
> # Open: http://localhost:3002
> ```

> See the docs for advanced setup: [LINUX_SETUP.md](../LINUX_SETUP.md), [MINIO_SETUP.md](../MINIO_SETUP.md), and [CONFIGURATION.md](../CONFIGURATION.md).

---

## Quick Links
- [Types Database](Types_Database.md) — How the curated `aircraft_types.json` is built & used.
- [Cache Status](Cache_Status.md) — Details and examples for `/api/cache-status` including `typeDatabase` summary.
- [API Summary](API.md) — New fields in endpoints (manufacturer, bodyType, aircraft_model) and examples.
- [Official Release Notes](https://github.com/christopherwhull/aircraft-dashboard/blob/main/CHANGELOG.md) — Changelog & release summaries.

## Recent Documentation Updates
- November 2025: Added a curated types database with UI & API enrichment for Manufacturer/Model/Body Type.
- November 2025: Cache Status includes `typeDatabase` summary and was added to the Cache tab.

## Contributing
Want to improve the wiki? Clone the wiki git repo and submit PRs or file issues on the main repository.

