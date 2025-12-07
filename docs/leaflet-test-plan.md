# Leaflet Heatmap Test Plan

This document describes the Leaflet Puppeteer test plan, harness usage, and artifacts for automated and manual runs. Artifacts are written by default to `screenshots/testplan/<outdir>`.

## Overview

The harness (`tools/leaflet-test.js`) performs an end-to-end capture of the Leaflet heatmap (`heatmap-leaflet.html`) using Puppeteer to:

- Select overlay tile layers
- Ensure `show-live` and `show-heatmap` are enabled
- Move the map center 30 miles west, zoom in/out to exercise tile loading
- Optionally collect popups for visible aircraft
- Auto-select a few visible hexes (or use explicit `--check-hex`) and verify presence of polylines in live/long/persistent/temp track layers
- Record console logs, network traces, pane summaries, artifacts, and a `run-info.json` for instrumentation

## How to run (example)

```bash
# Full run with overlays selected, popups collected, and instrumented output
npm run test:leaflet:full

# Run harness directly and write artifacts to a custom outdir
node tools/leaflet-test.js "http://localhost:3002/heatmap-leaflet.html" screenshots/testplan/my-run --select-overlays --collect-popups --run-id=my-run
```

## CLI Flags

- `--select-overlays`: Select all overlay layers in the Layers control
- `--collect-popups`: Click visible markers to collect popup HTML (saves `popups.json`)
- `--check-hex=hex1,hex2`: Explicit hex IDs to check for polylines (strict assertions)
- `--ignore-console=pattern`: Add regex to ignore console error/warning messages (useful for external tile 404s)
- `--run-id=identifier`: Friendly run identifier that appears in `run-info.json`

## Artifacts

Artifacts are written to `screenshots/testplan/<outdir>` by default and include:

- `leaflet-screenshot.png` — full-page screenshot
- `leaflet-console.json` — captured console logs and messages
- `leaflet-network.json` — captured network events including API call responses
- `leaflet-pane-summary.json` — DOM counts for paths, circles, and svgs in Leaflet panes
- `popups.json` — collected popup HTML for visible aircraft (if `--collect-popups`)
- `hex-check-results.json` — per-hex object indicating which polylines exist in live, long, persistent, temp layers
- `assertion-failures.json` — list of fatal assertion messages (harness exits with code 3)
- `assertion-warnings.json` — list of non-fatal warnings (auto-selection didn't find any tracks)
- `run-info.json` — run metadata including flags, Node version and the `summary` object

## Interpretation

- `run-info.json.summary.autoSelectedHexes` — list of hexes the harness checked automatically
- `hex-check-results.json` — object e.g. `{ "a7f434": { "persistent":false, "live":true, "long":true, "temp":false } }`
- `assertion-failures.json` — any non-empty file means the harness failed with a fatal assertion
- `assertion-warnings.json` — non-fatal warnings (e.g., auto-selected hexes had no polylines)

## Tips

- If you want deterministic results, pass `--check-hex` explicitly for hex IDs you know have tracks
- For expected benign failures (e.g., Mesonet `sfc_analysis` tile 404s), pass `--ignore-console` with the HTTP pattern to avoid false positives
- For CI, include the harness run in `tools/test-all.js` and gate failures on `assertion-failures.json` only

## Adding Checks

If you add new assertions to the harness, update `tools/leaflet-test.js` and add documentation here describing:

- How to enable/disable the check via CLI flag
- What artifacts will show results
- Whether the check is a warning or a fatal failure

---

This plan is intended to provide reliable, reproducible checks and diagnostics for the heatmap UI. If you need a fully deterministic regression test (e.g., for CI enforcement), use `--check-hex=` for a known, stable hex that has persistent tracks (can be created on demand during the test run).