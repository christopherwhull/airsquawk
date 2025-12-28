#!/usr/bin/env python3
"""
Python endpoint tests for aircraft dashboard API

This script exercises the main API endpoints (GETs) and a safe POST to
`/api/aircraft/batch` with a small sample. It attempts to pick sensible
sample parameters by querying list endpoints first (e.g., `/api/airlines` or
`/api/positions`) and falls back to known samples.
"""
import sys
import os
import json
import time
import traceback

DEFAULT_PORT = 3002
DEFAULT_HOST = 'localhost'


def import_requests_or_exit():
    try:
        import requests
        return requests
    except ImportError:
        print("❌ 'requests' module not available — install with 'pip install requests'")
        sys.exit(2)


def load_config_server():
    try:
        config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config.json')
        with open(config_path, 'r') as f:
            config = json.load(f)
        server_port = config.get('server', {}).get('port', DEFAULT_PORT)
        server_host = config.get('server', {}).get('host', DEFAULT_HOST)
    except Exception:
        server_port = DEFAULT_PORT
        server_host = DEFAULT_HOST
    return server_host, server_port


def ok_status(code):
    return code in (200, 204, 301, 302)


def test_get(requests, url, timeout=10):
    try:
        r = requests.get(url, timeout=timeout)
        if ok_status(r.status_code):
            print(f"✅ {url} - Status: {r.status_code}")
            return True, r
        else:
            print(f"❌ {url} - Unexpected status: {r.status_code}")
            return False, r
    except Exception as e:
        print(f"❌ {url} - Request failed: {e}")
        return False, None


def test_post(requests, url, payload, timeout=10):
    headers = {'Content-Type': 'application/json'}
    try:
        r = requests.post(url, data=json.dumps(payload), headers=headers, timeout=timeout)
        if r.status_code in (200, 201, 202, 204):
            print(f"✅ POST {url} - Status: {r.status_code}")
            return True, r
        else:
            print(f"❌ POST {url} - Unexpected status: {r.status_code}")
            return False, r
    except Exception as e:
        print(f"❌ POST {url} - Request failed: {e}")
        return False, None


def main():
    print("Running Python endpoint tests...")
    requests = import_requests_or_exit()

    host, port = load_config_server()
    base = f"http://{host}:{port}"

    # Try to discover sensible sample parameters
    sample_airline = 'DAL'
    sample_hex = 'ac1988'

    # Try to obtain an airline code from /api/airlines
    ok, r = test_get(requests, f"{base}/api/airlines")
    if ok and r is not None:
        try:
            body = r.json()
            # body may be dict mapping names->code or list of objects
            if isinstance(body, dict):
                # pick a value that looks like a 3-letter code
                for v in body.values():
                    if isinstance(v, str) and len(v) >= 2:
                        sample_airline = v
                        break
            elif isinstance(body, list) and len(body) > 0:
                first = body[0]
                if isinstance(first, dict):
                    for k in ('code', 'icao', 'iata'):
                        if k in first:
                            sample_airline = first[k]
                            break
        except Exception:
            pass

    # Try to obtain a sample hex from /api/positions
    ok, r = test_get(requests, f"{base}/api/positions?hours=1")
    if ok and r is not None:
        try:
            body = r.json()
            if isinstance(body, list) and len(body) > 0:
                # position records often include 'hex' or 'icao24'
                first = body[0]
                if isinstance(first, dict):
                    for k in ('hex', 'icao24'):
                        if k in first:
                            sample_hex = first[k]
                            break
        except Exception:
            pass

    # Define endpoints to test (GET)
    get_endpoints = [
        '/api/health',
        '/api/server-status',
        '/api/cache-status',
        '/api/config',
        '/api/receiver-location',
        '/api/airlines',
        '/api/airline-database',
        '/api/airline-stats?window=24h',
        '/api/historical-stats?hours=24&resolution=60',
        '/api/position-timeseries-live?minutes=10&resolution=1',
        '/api/reception-range?hours=24',
        '/api/heatmap-data?hours=24',
        '/api/heatmap-stats',
        '/api/heatmap-cache-clear',
        '/api/positions?hours=24',
        '/api/flights?gap=5&window=24h',
        f'/api/aircraft/{sample_hex}',
        f'/api/squawk?hex={sample_hex}',
        '/api/aircraft-database/status',
        '/api/aircraft-types',
        f'/api/v1logos/{sample_airline}',
        f'/api/v2logos/{sample_airline}',
    ]

    tests_total = 0
    tests_passed = 0

    for ep in get_endpoints:
        url = base + ep
        tests_total += 1
        ok, _ = test_get(requests, url, timeout=20)
        if ok:
            tests_passed += 1

    # Safe POST: /api/aircraft/batch expects an array of hexes
    tests_total += 1
    post_payload = [sample_hex]
    ok, _ = test_post(requests, f"{base}/api/aircraft/batch", post_payload)
    if ok:
        tests_passed += 1

    # Some servers expose POST /api/flights/batch — try a minimal POST but don't fail the whole run if it errors
    tests_total += 1
    try:
        flight_payload = [{"hex": sample_hex, "callsign": "TEST", "firstSeen": int(time.time()), "lastSeen": int(time.time())}]
        ok, _ = test_post(requests, f"{base}/api/flights/batch", flight_payload)
        if ok:
            tests_passed += 1
    except Exception:
        print("⚠️  Skipping /api/flights/batch POST (error building payload)")

    print(f"\nEndpoint Test Results: {tests_passed}/{tests_total} tests passed")

    if tests_passed == tests_total:
        print("✅ All Python endpoint tests passed!")
        return 0
    else:
        print("❌ Some Python endpoint tests failed!")
        return 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)