# AI Helper (GitHub Copilot – GPT-5)

Use the AI to accelerate development while keeping changes safe and reviewable.

## How to Ask
- Be specific: goal, files, APIs, acceptance criteria.
- Prefer small patches; request a plan for multi-step work.
- Ask the AI to run tests and share results.

## Handy Commands (PowerShell)
```powershell
npm start
npm test
python tools/test_all.py
python tools/test_s3_structure.py --dates-only
python tools/test_s3_structure.py --gaps-only
```

### Aviation Charts & Tile Proxy

Start and pre-cache aviation chart tiles for offline or low-latency use:

```powershell
# Start the local tile proxy (listens on port 3003)
npm run proxy:tiles

# Pre-cache tiles (proxy must be running in a separate terminal)
npm run precache:tiles
```

If chart tiles show as blank or grey:
- Confirm the proxy is running and reachable at `http://localhost:3003`.
- Inspect `tile_cache/` for cached files and check their timestamps.
- Review `AVIATION_CHARTS_WIKI.md` for deeper debugging steps.

## Patterns
- Endpoint fixes: specify route, input/output, and a sample curl.
- Data checks: point to buckets, prefixes, and time windows.
- Releases: request version bump, CHANGELOG update, commit/tag/push.

See `docs/AI_HELPER.md` for the full guide.
