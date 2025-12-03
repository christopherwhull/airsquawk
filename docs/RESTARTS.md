**Server Restarts**

This document explains how to restart the project services (app server and tile server), the helper scripts available, where restart logs are stored, and how the repository captures HTML snapshots before commits.

1) Services and ports
 - App server: `server.js` — default port `3002`.
 - Tile / GeoTIFF server: `geotiff-server.js` — default port `3003`.

2) Restart helper: `tools/restart_server.py`
 - Purpose: cross-platform helper to stop processes listening on the configured ports and start the Node services in the repository root.
 - Location: `tools/restart_server.py`
 - Key options:
   - `--server` : restart only the app server (port 3002)
   - `--tiles`  : restart only the tile server (port 3003)
   - `--all`    : restart both (default if no targets specified)
   - `--use-api` plus `--token` : attempt to call the server's `POST /api/restart` endpoint (if configured) instead of doing a local restart
   - `--wait`   : wait for `GET /api/health` to return ok (useful in automation)
   - `--server-url` : override the server base URL used for API calls (default `http://localhost:3002`)

Example usage (PowerShell / bash):

```powershell
python .\tools\restart_server.py --all --wait
```

Or trigger API restart (when the server exposes `POST /api/restart` and you have a token):

```powershell
python .\tools\restart_server.py --use-api --token YOUR_TOKEN --wait
```

Notes about behavior
 - The script performs a best-effort lookup of processes listening on the configured ports and attempts to stop them (Windows uses `taskkill`, POSIX uses `kill`).
 - The services are started detached and their stdout/stderr are appended to the `logs/` files (see next section).
 - The script prints a short reminder about running the project test suite after the restart and writes that reminder to `logs/restart_reminder.txt`.

3) Logs and reminders
 - Logs directory: `logs/`
 - App server log: `logs/server.log` (stdout/stderr for `server.js` when started by the helper)
 - Tile server log: `logs/geotiff.log` (stdout/stderr for `geotiff-server.js` when started by the helper)
 - Restart reminder: `logs/restart_reminder.txt` — the helper appends a timestamped reminder recommending `npm test` / `node tools/test-all.js` after every restart.

4) Repo-level helper scripts and npm shortcuts
 - `package.json` includes several restart-related scripts; the most relevant are:
   - `restart:windows` — runs a PowerShell restart script (if present)
   - `restart:node` — previously used to call `tools/restart_server.py` (the repository now contains `tools/restart_server.py`)
   - `enable-git-hooks` — convenience script to configure Git to use the versioned `.githooks` directory in this repo (runs `git config core.hooksPath .githooks`).

Use `npm run enable-git-hooks` once after cloning to ensure the repository's `.githooks` directory is used for hooks on this machine.

5) HTML snapshot archive (safety for HTML edits)
 - We added a small pre-commit hook that archives staged `.html` files into `html-archive/` with a timestamped filename before the commit proceeds.
 - Hook location: `.githooks/pre-commit` (the repo's `core.hooksPath` is set to `.githooks` by the `enable-git-hooks` script).
 - Archiver helper: `tools/archive-staged-html.js` — finds staged `.html` files and copies them to `html-archive/YYYYMMDD_HHMMSS__path__to__file.html`.
 - The pre-commit hook intentionally does not block commits if the archiver fails (it warns but returns success), so commits are not impeded.

6) Quick troubleshooting checklist
 - If the Leaflet UI is missing tiles or chart overlays, confirm the tile server is reachable on port `3003`:

```powershell
Invoke-WebRequest http://localhost:3003 -UseBasicParsing -TimeoutSec 5
```

 - Confirm both services are listening:

```powershell
netstat -ano | Select-String ":3002"  # app server
netstat -ano | Select-String ":3003"  # tile server
```

 - View runtime logs:

```powershell
Get-Content logs\server.log -Tail 200 -Wait
Get-Content logs\geotiff.log -Tail 200 -Wait
```

 - Use the `tools/restart_server.py` helper when you want one command to stop and start both services and to leave a restart reminder in `logs/restart_reminder.txt`.

7) If you want stricter behavior
 - Currently the pre-commit archiver is non-fatal. If you prefer to **fail a commit** when archiving fails (so no HTML change goes in without an archive), the pre-commit hook can be changed to exit non-zero on errors — we can update that policy on request.

8) Contact
 - If anything fails or you want me to wire the server restart into a CI/CD workflow, tell me which behavior you prefer (local detach vs. pm2 vs. Windows service) and I can implement it.

---

File locations referenced above
- `tools/restart_server.py`
- `tools/archive-staged-html.js`
- `.githooks/pre-commit`
- `html-archive/` (created on-demand by the hook)
- `logs/restart_reminder.txt`, `logs/server.log`, `logs/geotiff.log`
