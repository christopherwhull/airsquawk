#!/usr/bin/env python3
"""
Aircraft tracker - monitors aircraft and reports longest visible
Tracks first position report time and removes aircraft not seen for 5 minutes
"""

import argparse
import csv
import json
import math
import os
import requests
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

# --- Environment Setup ---
# Add the script's directory to the Python path to ensure local modules are found
import sys
import platform
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from registration_lookup import registration_from_hexid
from airline_lookup import get_airline_from_callsign
try:
    from config_reader import get_config
    CONFIG_READER_AVAILABLE = True
except ImportError:
    CONFIG_READER_AVAILABLE = False
    print("Warning: config_reader not available, using command-line defaults")

# Ensure UTF-8 console encoding on Windows to avoid UnicodeEncodeError
try:
    if os.name == 'nt':
        try:
            # Python 3.7+: reconfigure stdout/stderr to utf-8
            sys.stdout.reconfigure(encoding='utf-8')
            sys.stderr.reconfigure(encoding='utf-8')
        except Exception:
            # Fallback: set PYTHONIOENCODING for subprocesses (best-effort)
            os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
except Exception:
    pass

import re
import glob
import subprocess
try:
    import boto3
    from botocore.exceptions import ClientError
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False
    print("Warning: boto3 not available, S3 uploads will be disabled")
try:
    import matplotlib
    matplotlib.use('Agg')  # Use non-interactive backend
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d import Axes3D
    import numpy as np
    MATPLOTLIB_AVAILABLE = True
except ImportError:
    MATPLOTLIB_AVAILABLE = False
    print("Warning: matplotlib not available, 3D visualization will be disabled")
TIMEOUT_SECONDS = 30  # 30 seconds
POLL_INTERVAL = 1  # seconds
REPORT_INTERVAL = 1  # iterations (1 second)

aircraft_tracking: Dict[str, dict] = {}
piaware_url: str = ""
output_filename: str = "aircraft_log.csv"
output_format: str = "csv"
current_hour: int = -1
total_log_size: float = 0.0  # in MB
pending_aircraft: List[dict] = []  # Buffer for aircraft data
last_write_time: float = 0.0
db_cache: Dict[str, dict] = {}  # Cache for aircraft database
flightaware_urls_file: str = "flightaware_urls.txt"
receiver_lat: float = 0.0
receiver_lon: float = 0.0
receiver_version: str = "unknown"
history_cache: Dict[str, dict] = {}  # Cached history data
max_slant_range_record: Optional[dict] = None  # All-time longest slant range
sector_altitude_records: Dict[tuple, dict] = {}  # Record for each sector+altitude zone combination
# --- Output File Configuration ---
OUTPUT_SUBDIR = "aircraft-tracker-outputs"
reception_record_file: str = os.path.join(OUTPUT_SUBDIR, "piaware.reception.record")
kml_output_file: str = os.path.join(OUTPUT_SUBDIR, "piaware.reception.kml")
jpg_output_file: str = os.path.join(OUTPUT_SUBDIR, "piaware.reception.3d.jpg")
heatmap_output_file: str = os.path.join(OUTPUT_SUBDIR, "aircraft_heatmap.jpg")
heatmap_cell_size: int = 5  # Cell size in nautical miles for heatmap
last_kml_write_time: float = 0.0
last_jpg_write_time: float = 0.0
last_heatmap_write_time: float = 0.0
position_reports_24h: int = 0  # Position reports from past 24 hours
running_position_count: int = 0  # Running total of position reports
s3_client = None  # S3 client for uploads
last_s3_upload_time: float = 0.0  # Last S3 upload timestamp
last_minute_upload_time: float = 0.0  # Last minute file upload timestamp
s3_upload_enabled: bool = False  # Whether S3 uploads are enabled
last_flightaware_upload_time: float = 0.0  # Last FlightAware URL upload timestamp
flightaware_urls_buffer: List[str] = []  # Buffer for FlightAware URLs to upload
aircraft_type_cache_age_days: int = 30  # Days before refreshing type database cache
s3_upload_count: int = 0  # Number of S3 uploads
last_uploaded_file: str = ""  # Last uploaded S3 file key

# Real-time position tracking (for current run only)
positions_last_minute: List[float] = []  # Timestamps of positions in last minute
positions_last_10min: List[float] = []  # Timestamps of positions in last 10 minutes
positions_last_hour: List[float] = []  # Timestamps of positions in last hour
positions_last_day: List[float] = []  # Timestamps of positions in last day
tracker_start_time: float = 0.0  # When tracker started


# Make args global so it's accessible in all functions
args = None

# Runtime directory for temporary files and minute log files
RUNTIME_DIR = 'runtime'
# Pattern for piaware minute files inside runtime
PIAWARE_MINUTE_GLOB = os.path.join(RUNTIME_DIR, 'piaware_aircraft_log_*.json')
PIAWARE_MINUTE_PREFIX = 'piaware_aircraft_log_'

def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate positional distance between two coordinates in nautical miles using Haversine formula."""
    R = 3440.065  # Radius of Earth in nautical miles
    
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c


def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate bearing from point 1 to point 2 in degrees (0-360)."""
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lon = math.radians(lon2 - lon1)
    
    x = math.sin(delta_lon) * math.cos(lat2_rad)
    y = math.cos(lat1_rad) * math.sin(lat2_rad) - math.sin(lat1_rad) * math.cos(lat2_rad) * math.cos(delta_lon)
    
    bearing_rad = math.atan2(x, y)
    bearing_deg = math.degrees(bearing_rad)
    
    # Normalize to 0-360
    return (bearing_deg + 360) % 360


def get_sector(bearing: float) -> int:
    """Get sector number (0-11) for a bearing. Each sector is 30 degrees."""
    # Sector 0 = 0-29°, Sector 1 = 30-59°, etc.
    return int(bearing // 30) % 12


def get_altitude_zone(altitude_ft: float) -> int:
    """Get altitude zone (0, 1, 2, ...) for an altitude. Each zone is 5000 ft."""
    # Zone 0 = 0-4999 ft, Zone 1 = 5000-9999 ft, Zone 2 = 10000-14999 ft, etc.
    if altitude_ft < 0:
        return 0
    return int(altitude_ft // 5000)


def calculate_slant_distance(positional_distance: float, altitude_ft: float, receiver_alt_ft: float = 0) -> float:
    """Calculate slant distance (3D distance) including altitude."""
    # Convert altitude difference to nautical miles (1 NM = 6076.12 feet)
    altitude_diff_nm = (altitude_ft - receiver_alt_ft) / 6076.12
    
    # Pythagorean theorem: slant = sqrt(positional² + altitude²)
    slant = math.sqrt(positional_distance**2 + altitude_diff_nm**2)
    return slant


def is_valid_position(lat, lon) -> bool:
    """Return True if lat/lon appear to be valid numeric coordinates.

    Accepts numeric types or numeric strings. Rejects None and the string 'N/A'.
    Ensures latitude is between -90 and 90 and longitude between -180 and 180.
    """
    if lat in (None, 'N/A') or lon in (None, 'N/A'):
        return False
    try:
        latf = float(lat)
        lonf = float(lon)
    except (TypeError, ValueError):
        return False
    if not (-90.0 <= latf <= 90.0 and -180.0 <= lonf <= 180.0):
        return False
    return True


def output_value(v):
    """Return a canonical output value for writing/printing.

    - Converts internal None to the legacy 'N/A' string for human-readable outputs.
    - Leaves other values unchanged.
    """
    return 'N/A' if v is None else v


def get_receiver_info() -> dict:
    """Fetch receiver configuration information."""
    try:
        receiver_url = piaware_url.replace('/data/aircraft.json', '/data/receiver.json')
        response = requests.get(receiver_url, timeout=5)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        print(f"Warning: Failed to fetch receiver info: {e}")
        return {}


def load_history_data() -> Dict[str, dict]:
    """Load recent history to get callsigns and squawk codes."""
    history_data = {}
    try:
        # Load last few history files (recent 2 minutes)
        for i in range(0, 8):  # history_0 to history_7 (last 4 minutes)
            history_url = piaware_url.replace('/data/aircraft.json', f'/data/history_{i}.json')
            try:
                response = requests.get(history_url, timeout=3)
                response.raise_for_status()
                data = response.json()
                
                # History files contain aircraft as a list
                if 'aircraft' in data and isinstance(data['aircraft'], list):
                    for aircraft_data in data['aircraft']:
                        hex_code = aircraft_data.get('hex')
                        if not hex_code:
                            continue
                        
                        # Store or update with most complete data
                        if hex_code not in history_data:
                            history_data[hex_code] = {}
                        
                        # Merge data, preferring non-null values
                        for key in ['flight', 'squawk', 'r', 't']:
                            if key in aircraft_data and aircraft_data[key]:
                                value = aircraft_data[key]
                                # Strip whitespace from flight callsigns
                                if key == 'flight' and isinstance(value, str):
                                    value = value.strip()
                                if value:  # Only store non-empty values
                                    history_data[hex_code][key] = value
            except:
                continue
    except Exception as e:
        print(f"Warning: Failed to load history: {e}")
    
    return history_data


def get_aircraft_data() -> List[dict]:
    """Fetch aircraft data from PiAware server."""
    try:
        response = requests.get(piaware_url, timeout=5)
        response.raise_for_status()
        data = response.json()
        return data.get('aircraft', [])
    except requests.RequestException as e:
        print(f"Warning: Failed to fetch aircraft data: {e}")
        return []


# Global cache for aircraft type database from S3
_aircraft_type_db = None

def _load_aircraft_type_database_from_s3():
    """Load aircraft type database from S3."""
    global _aircraft_type_db
    if _aircraft_type_db is not None:
        return _aircraft_type_db
    
    try:
        obj_data = s3_client.get_object(Bucket=s3_bucket_name, Key='aircraft_type_database.json')
        content = obj_data['Body'].read().decode('utf-8')
        data = json.loads(content)
        _aircraft_type_db = data.get('aircraft', {})
        print(f"\033[92mLoaded aircraft type database from S3 with {len(_aircraft_type_db)} entries\033[0m")
        return _aircraft_type_db
    except ClientError as e:
        print(f"\033[91mError loading aircraft type database from S3: {e}\033[0m")
        _aircraft_type_db = {}
        return _aircraft_type_db
    except Exception as e:
        print(f"\033[91mUnexpected error loading aircraft type database: {e}\033[0m")
        _aircraft_type_db = {}
        return _aircraft_type_db

def get_aircraft_type_from_s3_db(hex_code: str) -> dict:
    """Get aircraft type and registration from S3 database."""
    if not s3_upload_enabled or not s3_client:
        return {}
    
    # Load database if not already loaded
    db = _load_aircraft_type_database_from_s3()
    
    # Normalize hex_code to lowercase for lookup
    hex_code_lower = hex_code.lower()
    entry = db.get(hex_code_lower)
    
    if entry and isinstance(entry, dict):
        return {
            'registration': entry.get('registration'),
            'type': entry.get('type')
        }
    
    return {}


def get_db_info(hex_code: str) -> dict:
    """Lookup aircraft registration and type from static database."""
    global db_cache
    
    # Check cache first
    if hex_code in db_cache:
        return db_cache[hex_code]
    
    if len(hex_code) < 1:
        return {}
    
    # Try progressively longer prefixes (3, 2, 1 chars)
    # Files are uppercase, keys are lowercase
    for prefix_len in [3, 2, 1]:
        if len(hex_code) <= prefix_len:
            continue
            
        db_prefix = hex_code[:prefix_len].upper()
        suffix = hex_code[prefix_len:]
        db_url = piaware_url.replace('/data/aircraft.json', f'/db/{db_prefix}.json')
        
        try:
            response = requests.get(db_url, timeout=3)
            response.raise_for_status()
            db_data = response.json()
            
            # Check if suffix exists in database
            if suffix in db_data:
                info = db_data[suffix]
                db_cache[hex_code] = info
                return info
        except (requests.RequestException, json.JSONDecodeError, KeyError):
            continue
    
    # Cache empty result to avoid repeated lookups
    db_cache[hex_code] = {}
    return {}


def track_position_for_stats(timestamp: float) -> None:
    """Track position timestamp for real-time statistics."""
    global positions_last_minute, positions_last_10min, positions_last_hour, positions_last_day
    
    # Add to all lists
    positions_last_minute.append(timestamp)
    positions_last_10min.append(timestamp)
    positions_last_hour.append(timestamp)
    positions_last_day.append(timestamp)
    
    # Cleanup old timestamps
    cutoff_minute = timestamp - 60
    cutoff_10min = timestamp - 600
    cutoff_hour = timestamp - 3600
    cutoff_day = timestamp - 86400
    
    positions_last_minute = [t for t in positions_last_minute if t >= cutoff_minute]
    positions_last_10min = [t for t in positions_last_10min if t >= cutoff_10min]
    positions_last_hour = [t for t in positions_last_hour if t >= cutoff_hour]
    positions_last_day = [t for t in positions_last_day if t >= cutoff_day]


def update_aircraft_tracking(current_aircraft: List[dict]) -> None:
    """Update tracking information for all aircraft."""
    global running_position_count
    now = datetime.now(timezone.utc)
    current_timestamp = time.time()
    current_hex_codes = set()
    
    # Process current aircraft
    for aircraft in current_aircraft:
        hex_code = aircraft.get('hex')
        if not hex_code:
            continue
            
        current_hex_codes.add(hex_code)
        
        # Add new aircraft to tracking
        if hex_code not in aircraft_tracking:
            flight = aircraft.get('flight', '').strip() if aircraft.get('flight') else 'N/A'
            squawk = aircraft.get('squawk', 'N/A')
            
            # Check history cache for flight/squawk if not in current data
            if hex_code in history_cache:
                hist = history_cache[hex_code]
                if flight == 'N/A' and 'flight' in hist:
                    flight = hist['flight']
                if squawk == 'N/A' and 'squawk' in hist:
                    squawk = hist['squawk']
            
            # Get registration and type from live data first
            registration = aircraft.get('r', 'N/A')
            aircraft_type = aircraft.get('t', 'N/A')
            
            # Check history cache for registration/type
            if hex_code in history_cache:
                hist = history_cache[hex_code]
                if registration == 'N/A' and 'r' in hist:
                    registration = hist['r']
                if aircraft_type == 'N/A' and 't' in hist:
                    aircraft_type = hist['t']
            
            # Try S3 aircraft type database first (most comprehensive)
            s3_db_data = get_aircraft_type_from_s3_db(hex_code)
            if s3_db_data:
                if registration in (None, 'N/A', '') and 'registration' in s3_db_data:
                    registration = s3_db_data['registration']
                if aircraft_type in (None, 'N/A', '') and 'type' in s3_db_data:
                    aircraft_type = s3_db_data['type']
            
            # If not in live data, history, or S3 database, try the S3 ICAO cache.
            # Prefer cached values when the live value is missing or 'N/A'.
            cached_data = get_icao_cache_from_s3(hex_code)
            if cached_data:
                # Prefer cached registration if live registration is missing
                if registration in (None, 'N/A', ''):
                    registration = cached_data.get('registration', registration)

                # Prefer cached aircraft type if live type is missing
                if aircraft_type in (None, 'N/A', ''):
                    aircraft_type = cached_data.get('type', aircraft_type)
            
            # If not in live data, history, S3 database, or cache, lookup from PiAware static database
            if registration == 'N/A' or aircraft_type == 'N/A':
                db_info = get_db_info(hex_code)
                if registration == 'N/A' and 'r' in db_info:
                    registration = db_info['r']
                if aircraft_type == 'N/A' and 't' in db_info:
                    aircraft_type = db_info['t']
            
            # After all lookups, if we have a definitive registration or type, cache it to S3
            if registration != 'N/A' or aircraft_type != 'N/A':
                set_icao_cache_to_s3(hex_code, registration, aircraft_type)
            
            # Calculate distance if we have coordinates
            distance = aircraft.get('r_dst', 'N/A')
            if distance == 'N/A' or distance is None:
                if is_valid_position(aircraft.get('lat'), aircraft.get('lon')) and \
                   receiver_lat != 0.0 and receiver_lon != 0.0:
                    try:
                        distance = round(calculate_distance(receiver_lat, receiver_lon,
                                                          aircraft['lat'], aircraft['lon']), 2)
                    except Exception:
                        distance = 'N/A'
            
            now_dt = datetime.now(timezone.utc)
            now_ts = time.time()
            aircraft_tracking[hex_code] = {
                'first_seen': now_dt,
                'last_seen': now_dt,
                'hex': hex_code,
                'flight': flight,
                'registration': registration if registration != 'N/A' else None,
                'type': aircraft_type if aircraft_type != 'N/A' else None,
                'squawk': squawk if squawk != 'N/A' else None,
                'alt_baro': (aircraft.get('alt_baro') if aircraft.get('alt_baro') not in (None, 'N/A') else None),
                'gs': (aircraft.get('gs') if aircraft.get('gs') not in (None, 'N/A') else None),
                'baro_rate': (aircraft.get('baro_rate') if aircraft.get('baro_rate') not in (None, 'N/A') else None),
                'track': (aircraft.get('track') if aircraft.get('track') not in (None, 'N/A') else None),
                'messages': aircraft.get('messages', 0),
                'seen': (aircraft.get('seen') if aircraft.get('seen') not in (None, 'N/A') else None),
                'rssi': (aircraft.get('rssi') if aircraft.get('rssi') not in (None, 'N/A') else None),
                'lat': (aircraft.get('lat') if aircraft.get('lat') not in (None, 'N/A') else None),
                'lon': (aircraft.get('lon') if aircraft.get('lon') not in (None, 'N/A') else None),
                'r_dst': (distance if distance not in (None, 'N/A') else None),
                'dbFlags': aircraft.get('dbFlags', 0),
                'position_timestamp': now_ts,
                'data_quality': None
            }
            flight_str = f"({flight})" if flight != 'N/A' else ""
            
            # Count this position report if aircraft has valid position
            if is_valid_position(aircraft.get('lat'), aircraft.get('lon')):
                running_position_count += 1
                track_position_for_stats(current_timestamp)
            
            # Add to pending buffer for both JSON and CSV (all aircraft, not just those with positions)
            pending_aircraft.append(aircraft_tracking[hex_code].copy())
        else:
            # Update last seen time and all current data
            aircraft_tracking[hex_code]['last_seen'] = now
            
            # Update flight/ident if available (may appear after initial detection)
            # Only update if new value is not empty - preserve existing ident
            if aircraft.get('flight'):
                flight = aircraft.get('flight').strip()
                if flight:  # Only update if we have a non-empty value
                    aircraft_tracking[hex_code]['flight'] = flight
            # If current stored value is 'N/A' and we now have a flight, update it
            elif aircraft_tracking[hex_code]['flight'] == 'N/A' and aircraft.get('flight', '').strip():
                aircraft_tracking[hex_code]['flight'] = aircraft.get('flight').strip()
            # Store the old squawk before updating
            old_squawk = aircraft_tracking[hex_code].get('squawk', 'N/A')
            
            aircraft_tracking[hex_code]['registration'] = aircraft.get('r', aircraft_tracking[hex_code].get('registration', 'N/A'))
            aircraft_tracking[hex_code]['type'] = aircraft.get('t', aircraft_tracking[hex_code].get('type', 'N/A'))
            aircraft_tracking[hex_code]['squawk'] = aircraft.get('squawk', old_squawk)
            
            # Check if squawk has changed
            new_squawk = aircraft_tracking[hex_code]['squawk']
            squawk_has_changed = (new_squawk is not None and old_squawk != new_squawk)
            
            aircraft_tracking[hex_code]['alt_baro'] = aircraft.get('alt_baro', aircraft_tracking[hex_code].get('alt_baro', 'N/A'))
            aircraft_tracking[hex_code]['gs'] = aircraft.get('gs', aircraft_tracking[hex_code].get('gs', 'N/A'))
            aircraft_tracking[hex_code]['baro_rate'] = aircraft.get('baro_rate', aircraft_tracking[hex_code].get('baro_rate', 'N/A'))
            aircraft_tracking[hex_code]['track'] = aircraft.get('track', aircraft_tracking[hex_code].get('track', 'N/A'))
            aircraft_tracking[hex_code]['messages'] = aircraft.get('messages', aircraft_tracking[hex_code].get('messages', 0))
            aircraft_tracking[hex_code]['seen'] = aircraft.get('seen', aircraft_tracking[hex_code].get('seen', 'N/A'))
            aircraft_tracking[hex_code]['rssi'] = aircraft.get('rssi', aircraft_tracking[hex_code].get('rssi', 'N/A'))
            
            # Check if position changed (new lat/lon) before updating
            old_lat = aircraft_tracking[hex_code].get('lat', 'N/A')
            old_lon = aircraft_tracking[hex_code].get('lon', 'N/A')
            new_lat = aircraft.get('lat')
            new_lon = aircraft.get('lon')
            
            # Update lat/lon - use new value if present, otherwise keep old value
            if new_lat is not None:
                aircraft_tracking[hex_code]['lat'] = new_lat
            elif aircraft_tracking[hex_code].get('lat') is None:
                aircraft_tracking[hex_code]['lat'] = 'N/A'
            
            if new_lon is not None:
                aircraft_tracking[hex_code]['lon'] = new_lon
            elif aircraft_tracking[hex_code].get('lon') is None:
                aircraft_tracking[hex_code]['lon'] = 'N/A'
            
            # Count new position if lat/lon changed and is valid
            position_changed = (is_valid_position(new_lat, new_lon) and
                               (old_lat != new_lat or old_lon != new_lon))
            
            if position_changed:
                running_position_count += 1
                track_position_for_stats(current_timestamp)
            
            # Recalculate distance if coordinates changed
            distance = aircraft.get('r_dst', 'N/A')
            if distance == 'N/A' or distance is None:
                if is_valid_position(aircraft.get('lat'), aircraft.get('lon')) and \
                   receiver_lat != 0.0 and receiver_lon != 0.0:
                    try:
                        distance = round(calculate_distance(receiver_lat, receiver_lon,
                                                          aircraft['lat'], aircraft['lon']), 2)
                    except Exception:
                        distance = aircraft_tracking[hex_code].get('r_dst', 'N/A')
            aircraft_tracking[hex_code]['r_dst'] = distance
            aircraft_tracking[hex_code]['dbFlags'] = aircraft.get('dbFlags', aircraft_tracking[hex_code].get('dbFlags', 0))
            
            # Add update to pending buffer (all aircraft updates, not just position changes)
            tracked_info = aircraft_tracking[hex_code]
            output_record = tracked_info.copy()
            output_record['squawk_changed'] = squawk_has_changed

            # Position and Data Quality Handling
            new_lat = aircraft.get('lat')
            new_lon = aircraft.get('lon')

            if is_valid_position(new_lat, new_lon):
                output_record['lat'] = new_lat
                output_record['lon'] = new_lon
                output_record['data_quality'] = 'GPS'
                tracked_info['lat'] = new_lat
                tracked_info['lon'] = new_lon
                tracked_info['position_timestamp'] = current_timestamp
            else:
                # No valid position in current record, check for recent position to backfill
                time_since_last_pos = current_timestamp - tracked_info.get('position_timestamp', 0)
                if time_since_last_pos <= 5 and is_valid_position(tracked_info.get('lat'), tracked_info.get('lon')):
                    output_record['lat'] = tracked_info['lat']
                    output_record['lon'] = tracked_info['lon']
                    output_record['data_quality'] = 'GPS approx'
                else:
                    output_record['data_quality'] = 'No position'

            pending_aircraft.append(output_record)
    
    # Remove aircraft not seen for 5 minutes (30 seconds timeout)
    # But save FlightAware URLs after 5 minutes
    to_remove = []
    to_save_urls = []
    
    for hex_code, info in aircraft_tracking.items():
        last_seen = info['last_seen']
        time_since_last_seen = (now - last_seen).total_seconds()
        
        if time_since_last_seen > TIMEOUT_SECONDS:
            duration = (last_seen - info['first_seen']).total_seconds() / 60
            print(f"\033[93mAircraft {hex_code} lost (visible for {duration:.1f} minutes)\033[0m")
            to_remove.append(hex_code)
            
            # Check if it's been 5 minutes since first seen
            total_time = (now - info['first_seen']).total_seconds()
            if total_time >= 300:  # 5 minutes
                to_save_urls.append(info)
    
    # Save FlightAware URLs for aircraft that were tracked for 5+ minutes
    if to_save_urls:
        save_flightaware_urls(to_save_urls)
    
    for hex_code in to_remove:
        del aircraft_tracking[hex_code]


def get_nationality(dbflags: int) -> str:
    """Determine nationality from dbFlags."""
    if dbflags == 0 or dbflags == 'N/A':
        return 'Unknown'
    # dbFlags bit 0 indicates military
    # This is a simplified mapping - actual nationality would need ICAO prefix lookup
    return 'Military' if (dbflags & 1) else 'Civil'





def calculate_total_log_size() -> float:
    """Calculate total size of all aircraft log files in MB."""
    try:
        total_bytes = 0
        
        # Find all piaware_aircraft_log files (both JSON and CSV) in runtime directory
        if not os.path.exists(RUNTIME_DIR):
            return 0.0
        for filename in os.listdir(RUNTIME_DIR):
            # Match files that start with piaware_aircraft_log and end with .json or .csv
            if filename.startswith(PIAWARE_MINUTE_PREFIX) and (filename.endswith('.json') or filename.endswith('.csv')):
                filepath = os.path.join(RUNTIME_DIR, filename)
                if os.path.isfile(filepath):
                    total_bytes += os.path.getsize(filepath)
        
        # Convert to MB
        return total_bytes / (1024 * 1024)
    except Exception as e:
        print(f"\033[91mError calculating log size: {e}\033[0m")
        return 0.0


def save_flightaware_urls(aircraft_list: List[dict]) -> None:
    """Save FlightAware URLs for departed aircraft to buffer."""
    global flightaware_urls_buffer
    
    try:
        for aircraft_info in aircraft_list:
            flight = aircraft_info.get('flight', 'N/A')
            hex_code = aircraft_info['hex']
            registration = aircraft_info.get('registration', 'N/A')
            aircraft_type = aircraft_info.get('type', 'N/A')
            
            # Use flight callsign if available, otherwise registration
            if flight != 'N/A' and flight.strip():
                identifier = flight.strip()
            elif registration != 'N/A':
                identifier = registration
            else:
                identifier = hex_code
            
            url = f"https://flightaware.com/live/flight/{identifier}"
            timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
            duration = (aircraft_info['last_seen'] - aircraft_info['first_seen']).total_seconds() / 60
            
            # Add to buffer: timestamp, hex, flight, registration, type, duration, URL
            url_line = f"{timestamp}\t{hex_code}\t{flight}\t{registration}\t{aircraft_type}\t{duration:.1f}min\t{url}"
            flightaware_urls_buffer.append(url_line)
    except Exception as e:
        print(f"\033[91mError buffering FlightAware URLs: {e}\033[0m")


def cleanup_old_files() -> None:
    """Delete aircraft log files (JSON and CSV) older than 31 days."""
    global total_log_size
    
    try:
        cutoff_time = time.time() - (31 * 24 * 60 * 60)  # 31 days in seconds
        deleted_count = 0
        
        # Find all piaware_aircraft_log files (both JSON and CSV) in runtime directory
        if not os.path.exists(RUNTIME_DIR):
            return
        for filename in os.listdir(RUNTIME_DIR):
            # Match files that start with piaware_aircraft_log and end with .json or .csv
            if filename.startswith(PIAWARE_MINUTE_PREFIX) and (filename.endswith('.json') or filename.endswith('.csv')):
                filepath = os.path.join(RUNTIME_DIR, filename)
                if os.path.isfile(filepath):
                    file_mtime = os.path.getmtime(filepath)
                    if file_mtime < cutoff_time:
                        os.remove(filepath)
                        deleted_count += 1
                        print(f"\033[90mDeleted old file: {filename}\033[0m")
        
        if deleted_count > 0:
            print(f"\033[93mCleaned up {deleted_count} file(s) older than 31 days\033[0m")
            # Recalculate total size after cleanup
            total_log_size = calculate_total_log_size()
    except Exception as e:
        print(f"\033[91mError during cleanup: {e}\033[0m")














def get_longest_visible_aircraft() -> Optional[dict]:
    """Find the aircraft that has been visible the longest."""
    if not aircraft_tracking:
        return None
    
    now = datetime.now(timezone.utc)
    longest = None
    max_duration = 0
    
    for info in aircraft_tracking.values():
        duration = (now - info['first_seen']).total_seconds() / 60
        if duration > max_duration:
            max_duration = duration
            longest = {
                'aircraft': info,
                'duration': duration
            }
    
    return longest


def get_longest_visible_with_type() -> Optional[dict]:
    """Find the aircraft with known type that has been visible the longest."""
    if not aircraft_tracking:
        return None
    
    now = datetime.now(timezone.utc)
    longest = None
    max_duration = 0
    
    for info in aircraft_tracking.values():
        # Only consider aircraft with known type
        if info.get('type') and info.get('type') != 'N/A':
            duration = (now - info['first_seen']).total_seconds() / 60
            if duration > max_duration:
                max_duration = duration
                longest = {
                    'aircraft': info,
                    'duration': duration
                }
    
    return longest


def update_sector_altitude_records(aircraft_info: dict, slant_dist: float, bearing: float) -> None:
    """Update sector+altitude-based range records and save to file."""
    global sector_altitude_records
    
    altitude = aircraft_info.get('alt_baro', 0)
    if altitude == 'N/A':
        altitude = 0
    
    sector = get_sector(bearing)
    altitude_zone = get_altitude_zone(altitude)
    
    # Create key from sector and altitude zone
    record_key = (sector, altitude_zone)
    
    # Update record if this is the longest for this sector+altitude combination
    if record_key not in sector_altitude_records or slant_dist > sector_altitude_records[record_key]['slant_distance']:
        sector_altitude_records[record_key] = {
            'aircraft': aircraft_info.copy(),
            'slant_distance': slant_dist,
            'positional_distance': aircraft_info.get('r_dst', 'N/A'),
            'bearing': bearing,
            'altitude_zone': altitude_zone,
            'timestamp': datetime.now(timezone.utc)
        }
        
        # Rewrite entire file with all current records
        write_reception_records()


def load_reception_records() -> None:
    """Load existing reception records from S3 or local file."""
    global sector_altitude_records
    
    # Try loading from S3 first if enabled
    if s3_upload_enabled and s3_client:
        try:
            # S3 keys should use forward slashes, even on Windows
            s3_key = reception_record_file.replace('\\', '/')
            print(f"Attempting to load reception records from S3 bucket: {s3_reception_bucket_name}, key: {s3_key}")
            obj = s3_client.get_object(Bucket=s3_reception_bucket_name, Key=s3_key)
            content = obj['Body'].read().decode('utf-8')
            lines = content.splitlines()
            print(f"Successfully loaded {len(lines)} lines from S3.")
        except ClientError as e:
            if e.response['Error']['Code'] == 'NoSuchKey':
                print(f"Reception record file not found in S3, will start fresh.")
                lines = []
            else:
                print(f"\033[91mError loading from S3: {e}\033[0m")
                lines = []
    else:
        # Fallback to local file
        if not os.path.exists(reception_record_file):
            print("No existing reception record file found, starting fresh")
            return
        
        try:
            with open(reception_record_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()
        except Exception as e:
            print(f"\033[91mError loading local record file: {e}\033[0m")
            return

    try:
        loaded_count = 0
        
        # Skip header
        for line in lines[1:]:
            line = line.strip()
            if not line:
                continue
            
            parts = line.split('\t')
            if len(parts) < 11:
                continue
            
            # Parse the record
            timestamp_str = parts[0]
            sector_str = parts[1]
            alt_zone_str = parts[2]
            bearing_str = parts[3]
            slant_str = parts[4]
            pos_str = parts[5]
            alt_str = parts[6]
            hex_str = parts[7]
            flight_str = parts[8]
            reg_str = parts[9]
            type_str = parts[10]
            
            # Extract values
            sector_match = re.search(r'Sector (\d+)', sector_str)
            alt_zone_match = re.search(r'Alt Zone (\d+)', alt_zone_str)
            bearing_match = re.search(r'Bearing: ([\d.]+)', bearing_str)
            slant_match = re.search(r'Slant: ([\d.]+)', slant_str)
            pos_match = re.search(r'Pos: ([\d.]+)', pos_str)
            alt_match = re.search(r'Alt: ([\d.]+)', alt_str)
            hex_match = re.search(r'Hex: (\w+)', hex_str)
            flight_match = re.search(r'Flight: (.+)', flight_str)
            reg_match = re.search(r'Reg: (.+)', reg_str)
            type_match = re.search(r'Type: (.+)', type_str)
            
            if not (sector_match and alt_zone_match and bearing_match and slant_match):
                continue
            
            sector = int(sector_match.group(1))
            altitude_zone = int(alt_zone_match.group(1))
            bearing = float(bearing_match.group(1))
            slant_dist = float(slant_match.group(1))
            pos_dist = float(pos_match.group(1)) if pos_match else 0.0
            altitude = float(alt_match.group(1)) if alt_match else 0.0
            hex_val = hex_match.group(1) if hex_match else 'N/A'
            flight_val = flight_match.group(1).strip() if flight_match else 'N/A'
            reg_val = reg_match.group(1).strip() if reg_match else 'N/A'
            type_val = type_match.group(1).strip() if type_match else 'N/A'
            
            # Parse timestamp
            try:
                # Try parsing with UTC suffix first
                if timestamp_str.endswith(' UTC'):
                    timestamp = datetime.strptime(timestamp_str, '%Y-%m-%d %H:%M:%S UTC').replace(tzinfo=timezone.utc)
                else:
                    timestamp = datetime.strptime(timestamp_str, '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
            except:
                timestamp = datetime.now(timezone.utc)
            
            # Create record key
            record_key = (sector, altitude_zone)
            
            # Store in memory
            sector_altitude_records[record_key] = {
                'aircraft': {
                    'hex': hex_val,
                    'flight': flight_val,
                    'registration': reg_val,
                    'type': type_val,
                    'alt_baro': altitude,
                    'r_dst': pos_dist
                },
                'slant_distance': slant_dist,
                'positional_distance': pos_dist,
                'bearing': bearing,
                'altitude_zone': altitude_zone,
                'timestamp': timestamp
            }
            loaded_count += 1
        
        print(f"Loaded {loaded_count} existing reception records from file")
    except Exception as e:
        print(f"\033[91mError loading reception records: {e}\033[0m")
        import traceback
        traceback.print_exc()


def write_reception_records() -> None:
    """Write all sector+altitude records to file and upload to S3."""
    try:
        # Write to a temporary string buffer first
        import io
        string_buffer = io.StringIO()
        
        # Write header
        string_buffer.write("Timestamp\tSector\tAlt Zone\tBearing\tSlant\tPos\tAlt\tHex\tFlight\tReg\tType\n")
        
        # Sort by sector, then altitude zone
        sorted_keys = sorted(sector_altitude_records.keys())
        
        for record_key in sorted_keys:
            record = sector_altitude_records[record_key]
            sector, altitude_zone = record_key
            aircraft_info = record['aircraft']
            slant_dist = record['slant_distance']
            bearing = record['bearing']
            timestamp = record['timestamp'].strftime('%Y-%m-%d %H:%M:%S UTC')
            
            sector_range = f"{sector*30}-{(sector+1)*30-1}°"
            alt_zone_min = altitude_zone * 5000
            alt_zone_max = (altitude_zone + 1) * 5000 - 1
            alt_zone_str = f"{alt_zone_min}-{alt_zone_max} ft"
            
            # Build line as list and join with tabs to ensure proper formatting
            fields = [
                timestamp,
                f"Sector {sector} ({sector_range})",
                f"Alt Zone {altitude_zone} ({alt_zone_str})",
                f"Bearing: {bearing:.1f}°",
                f"Slant: {slant_dist:.2f} nm",
                f"Pos: {record['positional_distance']} nm",
                f"Alt: {aircraft_info.get('alt_baro', 'N/A')} ft",
                f"Hex: {aircraft_info['hex']}",
                f"Flight: {aircraft_info.get('flight', 'N/A')}",
                f"Reg: {aircraft_info.get('registration', 'N/A')}",
                f"Type: {aircraft_info.get('type', 'N/A')}"
            ]
            line = '\t'.join(fields) + '\n'
            string_buffer.write(line)
            
        # Get the complete content
        content = string_buffer.getvalue()
        
        # Write to local file
        with open(reception_record_file, 'w', encoding='utf-8', newline='') as f:
            f.write(content)

        # Upload to S3 if enabled
        if s3_upload_enabled and s3_client:
            try:
                # S3 keys should use forward slashes, even on Windows
                s3_key = reception_record_file.replace('\\', '/')
                s3_client.put_object(
                    Bucket=s3_reception_bucket_name,
                    Key=s3_key,
                    Body=content.encode('utf-8'),
                    ContentType='text/plain'
                )
            except Exception as e:
                print(f"\033[91mError uploading reception record to S3: {e}\033[0m")
                
    except Exception as e:
        print(f"\033[91mError writing to reception record: {e}\033[0m")


def generate_kml_from_records() -> None:
    """Generate KML file from reception record file."""
    try:
        # Check if record file exists
        if not os.path.exists(reception_record_file):
            print(f"\033[93mWarning: Reception record file not found, creating empty KML\033[0m")
            # Create empty KML with just receiver location
            kml_content = ['<?xml version="1.0" encoding="UTF-8"?>']
            kml_content.append('<kml xmlns="http://www.opengis.net/kml/2.2">')
            kml_content.append('<Document>')
            kml_content.append('<name>PiAware Reception Records</name>')
            kml_content.append('<description>Longest range records by sector and altitude zone</description>')
            if receiver_lat != 0.0 and receiver_lon != 0.0:
                kml_content.append('<Placemark>')
                kml_content.append('<name>Receiver</name>')
                kml_content.append(f'<description>PiAware Receiver at {receiver_lat:.6f}, {receiver_lon:.6f}</description>')
                kml_content.append('<Point>')
                kml_content.append(f'<coordinates>{receiver_lon:.6f},{receiver_lat:.6f},0</coordinates>')
                kml_content.append('</Point>')
                kml_content.append('</Placemark>')
            kml_content.append('</Document>')
            kml_content.append('</kml>')
            with open(kml_output_file, 'w', encoding='utf-8') as f:
                f.write('\n'.join(kml_content))
            return
        
        # Start KML document
        kml_content = ['<?xml version="1.0" encoding="UTF-8"?>']
        kml_content.append('<kml xmlns="http://www.opengis.net/kml/2.2">')
        kml_content.append('<Document>')
        kml_content.append('<name>PiAware Reception Records</name>')
        kml_content.append('<description>Longest range records by sector and altitude zone</description>')
        
        # Add styles for different altitude zones (color coded)
        altitude_colors = [
            ('zone0', 'ff0000ff'),   # Red - 0-4999 ft
            ('zone1', 'ff00ffff'),   # Yellow - 5000-9999 ft
            ('zone2', 'ff00ff00'),   # Green - 10000-14999 ft
            ('zone3', 'ffff0000'),   # Blue - 15000-19999 ft
            ('zone4', 'ffff00ff'),   # Magenta - 20000-24999 ft
            ('zone5', 'ffffff00'),   # Cyan - 25000-29999 ft
            ('zone6', 'ff00a5ff'),   # Orange - 30000-34999 ft
            ('zone7', 'ffff6600'),   # Deep sky blue - 35000-39999 ft
            ('zone8', 'ff8000ff'),   # Purple - 40000+ ft
        ]
        
        for style_id, color in altitude_colors:
            kml_content.append(f'<Style id="{style_id}">')
            kml_content.append('<LineStyle>')
            kml_content.append(f'<color>{color}</color>')
            kml_content.append('<width>3</width>')
            kml_content.append('</LineStyle>')
            kml_content.append('<IconStyle>')
            kml_content.append(f'<color>{color}</color>')
            kml_content.append('<scale>1.2</scale>')
            kml_content.append('<Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>')
            kml_content.append('</IconStyle>')
            kml_content.append('<LabelStyle>')
            kml_content.append(f'<color>{color}</color>')
            kml_content.append('<scale>0.8</scale>')
            kml_content.append('</LabelStyle>')
            kml_content.append('</Style>')
        
        # Add receiver location as a placemark
        if receiver_lat != 0.0 and receiver_lon != 0.0:
            kml_content.append('<Placemark>')
            kml_content.append('<name>Receiver</name>')
            kml_content.append(f'<description>PiAware Receiver at {receiver_lat:.6f}, {receiver_lon:.6f}</description>')
            kml_content.append('<Point>')
            kml_content.append(f'<coordinates>{receiver_lon:.6f},{receiver_lat:.6f},0</coordinates>')
            kml_content.append('</Point>')
            kml_content.append('</Placemark>')
        
        # Read and parse the reception record file
        import re
        with open(reception_record_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        # Skip header line if it exists
        start_line = 1 if lines and lines[0].startswith('Timestamp') else 0
        
        for line in lines[start_line:]:
            line = line.strip()
            if not line:
                continue
            
            # Parse tab-separated values
            parts = line.split('\t')
            if len(parts) < 11:
                continue
            
            timestamp = parts[0]
            sector_str = parts[1]  # e.g., "Sector 3 (90-119°)"
            alt_zone_str = parts[2]  # e.g., "Alt Zone 7 (35000-39999 ft)"
            bearing_str = parts[3]  # e.g., "Bearing: 95.3°"
            slant_str = parts[4]    # e.g., "Slant: 145.32 nm"
            pos_str = parts[5]      # e.g., "Pos: 140.2 nm"
            alt_str = parts[6]      # e.g., "Alt: 38000 ft"
            hex_code = parts[7]     # e.g., "Hex: a4493a"
            flight = parts[8]       # e.g., "Flight: UAL2424"
            registration = parts[9] # e.g., "Reg: N37532"
            aircraft_type = parts[10] # e.g., "Type: B39M"
            
            # Extract numeric values using regex
            sector_match = re.search(r'Sector (\d+)', sector_str)
            alt_zone_match = re.search(r'Alt Zone (\d+)', alt_zone_str)
            bearing_match = re.search(r'Bearing: ([\d.]+)', bearing_str)
            slant_match = re.search(r'Slant: ([\d.]+)', slant_str)
            pos_match = re.search(r'Pos: ([\d.]+)', pos_str)
            alt_match = re.search(r'Alt: ([\d.]+)', alt_str)
            hex_match = re.search(r'Hex: (\w+)', hex_code)
            flight_match = re.search(r'Flight: (.+)', flight)
            reg_match = re.search(r'Reg: (.+)', registration)
            type_match = re.search(r'Type: (.+)', aircraft_type)
            
            if not (sector_match and alt_zone_match and bearing_match and slant_match):
                continue
            
            sector = int(sector_match.group(1))
            altitude_zone = int(alt_zone_match.group(1))
            bearing = float(bearing_match.group(1))
            slant_dist = float(slant_match.group(1)) if slant_match else 0.0
            pos_dist = float(pos_match.group(1)) if pos_match else 0.0
            altitude = float(alt_match.group(1)) if alt_match else 0.0
            hex_val = hex_match.group(1) if hex_match else 'N/A'
            flight_val = flight_match.group(1).strip() if flight_match else 'N/A'
            reg_val = reg_match.group(1).strip() if reg_match else 'N/A'
            type_val = type_match.group(1).strip() if type_match else 'N/A'
            
            # We need to get the aircraft coordinates - use the bearing and distance to calculate
            # Calculate aircraft position from receiver using bearing and positional distance
            if receiver_lat != 0.0 and receiver_lon != 0.0 and pos_dist > 0:
                # Convert distance from NM to radians
                R = 3440.065  # Earth radius in NM
                d = pos_dist / R
                
                # Convert bearing to radians
                bearing_rad = math.radians(bearing)
                lat1_rad = math.radians(receiver_lat)
                lon1_rad = math.radians(receiver_lon)
                
                # Calculate destination point
                lat2_rad = math.asin(math.sin(lat1_rad) * math.cos(d) + 
                                     math.cos(lat1_rad) * math.sin(d) * math.cos(bearing_rad))
                lon2_rad = lon1_rad + math.atan2(math.sin(bearing_rad) * math.sin(d) * math.cos(lat1_rad),
                                                 math.cos(d) - math.sin(lat1_rad) * math.sin(lat2_rad))
                
                aircraft_lat = math.degrees(lat2_rad)
                aircraft_lon = math.degrees(lon2_rad)
            else:
                continue
            
            # Determine style based on altitude zone
            style_index = min(altitude_zone, len(altitude_colors) - 1)
            style_ref = altitude_colors[style_index][0]
            
            sector_range = f"{sector*30}-{(sector+1)*30-1}°"
            alt_zone_min = altitude_zone * 5000
            alt_zone_max = (altitude_zone + 1) * 5000 - 1
            
            # Create description
            description = (
                f"Sector: {sector} ({sector_range})<br/>"
                f"Altitude Zone: {altitude_zone} ({alt_zone_min}-{alt_zone_max} ft)<br/>"
                f"Bearing: {bearing:.1f}°<br/>"
                f"Slant Distance: {slant_dist:.2f} nm<br/>"
                f"Positional Distance: {pos_dist:.2f} nm<br/>"
                f"Altitude: {altitude:.0f} ft<br/>"
                f"Hex: {hex_val}<br/>"
                f"Flight: {flight_val}<br/>"
                f"Registration: {reg_val}<br/>"
                f"Type: {type_val}<br/>"
                f"Timestamp: {timestamp}"
            )
            
            # Add placemark for aircraft position with altitude
            kml_content.append('<Placemark>')
            kml_content.append(f'<name>S{sector} Z{altitude_zone}: {flight_val}</name>')
            kml_content.append(f'<description>{description}</description>')
            kml_content.append(f'<styleUrl>#{style_ref}</styleUrl>')
            kml_content.append('<Point>')
            kml_content.append('<extrude>1</extrude>')
            kml_content.append('<altitudeMode>absolute</altitudeMode>')
            # Convert feet to meters for KML (1 ft = 0.3048 m)
            altitude_meters = altitude * 0.3048
            kml_content.append(f'<coordinates>{aircraft_lon:.6f},{aircraft_lat:.6f},{altitude_meters:.2f}</coordinates>')
            kml_content.append('</Point>')
            kml_content.append('</Placemark>')
            
            # Add vertical line from ground to aircraft position for 3D effect
            kml_content.append('<Placemark>')
            kml_content.append(f'<name>Alt Line S{sector} Z{altitude_zone}</name>')
            kml_content.append(f'<styleUrl>#{style_ref}</styleUrl>')
            kml_content.append('<LineString>')
            kml_content.append('<extrude>0</extrude>')
            kml_content.append('<altitudeMode>absolute</altitudeMode>')
            kml_content.append('<coordinates>')
            kml_content.append(f'{aircraft_lon:.6f},{aircraft_lat:.6f},0 ')
            kml_content.append(f'{aircraft_lon:.6f},{aircraft_lat:.6f},{altitude_meters:.2f}')
            kml_content.append('</coordinates>')
            kml_content.append('</LineString>')
            kml_content.append('</Placemark>')
        
        # Close KML document
        kml_content.append('</Document>')
        kml_content.append('</kml>')
        
        # Write to file
        with open(kml_output_file, 'w', encoding='utf-8') as f:
            f.write('\n'.join(kml_content))
        
    except Exception as e:
        print(f"\033[91mError generating KML: {e}\033[0m")


def generate_3d_jpg_from_records() -> None:
    """Generate 3D JPG visualization from reception records."""
    if not MATPLOTLIB_AVAILABLE:
        print("\033[93mWarning: matplotlib not available, skipping 3D JPG generation\033[0m")
        return
    
    try:
        # Check if record file exists
        if not os.path.exists(reception_record_file):
            print(f"\033[93mWarning: Reception record file not found, skipping 3D JPG\033[0m")
            return
        
        # Read and parse the reception record file
        records = []
        skipped = 0
        with open(reception_record_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        # Skip header line if it exists
        start_line = 1 if lines and lines[0].startswith('Timestamp') else 0
        
        for line_num, line in enumerate(lines[start_line:], start=start_line+1):
            line = line.strip()
            if not line:
                continue
            
            # Parse tab-separated values
            parts = line.split('\t')
            if len(parts) < 7:  # Need at least timestamp, sector, alt zone, bearing, slant, pos, alt
                skipped += 1
                continue
            
            # Extract the fields we need - some may be in wrong positions due to formatting
            sector_str = parts[1] if len(parts) > 1 else ''
            alt_zone_str = parts[2] if len(parts) > 2 else ''
            bearing_str = parts[3] if len(parts) > 3 else ''
            slant_str = parts[4] if len(parts) > 4 else ''
            pos_str = parts[5] if len(parts) > 5 else ''
            alt_str = parts[6] if len(parts) > 6 else ''
            
            # Extract numeric values using regex
            sector_match = re.search(r'Sector (\d+)', sector_str)
            alt_zone_match = re.search(r'Alt Zone (\d+)', alt_zone_str)
            bearing_match = re.search(r'Bearing: ([\d.]+)', bearing_str)
            pos_match = re.search(r'Pos: ([\d.]+)', pos_str)
            alt_match = re.search(r'Alt: ([\d.]+)', alt_str)
            
            if not (sector_match and bearing_match and pos_match and alt_match):
                skipped += 1
                continue
            
            sector = int(sector_match.group(1))
            altitude_zone = int(alt_zone_match.group(1)) if alt_zone_match else 0
            bearing = float(bearing_match.group(1))
            pos_dist = float(pos_match.group(1))
            altitude = float(alt_match.group(1))
            
            records.append({
                'sector': sector,
                'altitude_zone': altitude_zone,
                'bearing': bearing,
                'distance': pos_dist,
                'altitude': altitude
            })
        
        print(f"3D JPG: Parsed {len(records)} records from file ({skipped} skipped)")
        
        if not records:
            print("\033[93mWarning: No records to plot\033[0m")
            return
        
        # Create 3D plot
        fig = plt.figure(figsize=(16, 12))
        ax = fig.add_subplot(111, projection='3d')
        
        # Receiver at origin
        ax.scatter([0], [0], [0], color='red', s=200, marker='*', label='Receiver', zorder=5)
        
        # Color map for altitude zones
        altitude_zone_colors = [
            '#FF0000',  # Red
            '#FFFF00',  # Yellow
            '#00FF00',  # Green
            '#0000FF',  # Blue
            '#FF00FF',  # Magenta
            '#00FFFF',  # Cyan
            '#FFA500',  # Orange
            '#0066FF',  # Deep sky blue
            '#8000FF',  # Purple
        ]
        
        # Collect data points for surface fitting
        x_points = []
        y_points = []
        z_points = []
        
        # Convert polar coordinates (bearing, distance) to Cartesian (x, y)
        for record in records:
            bearing_rad = math.radians(record['bearing'])
            distance = record['distance']
            altitude = record['altitude'] / 1000.0  # Convert to thousands of feet for better scale
            altitude_zone = record['altitude_zone']
            
            # Convert to x, y coordinates (bearing from North, clockwise)
            # East is positive X, North is positive Y
            # Bearing: 0°=N, 90°=E, 180°=S, 270°=W
            # With Y-axis inverted: need to negate X to get correct East/West
            x = -distance * math.sin(bearing_rad)  # Negative to correct East/West
            y = distance * math.cos(bearing_rad)
            z = altitude
            
            x_points.append(x)
            y_points.append(y)
            z_points.append(z)
            
            # Select color based on altitude zone
            color_idx = min(altitude_zone, len(altitude_zone_colors) - 1)
            color = altitude_zone_colors[color_idx]
            
            # Plot point
            ax.scatter([x], [y], [z], color=color, s=100, alpha=0.8, zorder=5)
            
            # Draw vertical line from ground to point
            ax.plot([x, x], [y, y], [0, z], color=color, alpha=0.5, linewidth=2)
        
        # Create surface mesh if we have enough points
        if len(records) >= 4:
            try:
                # Create a radial grid
                bearings = np.linspace(0, 2*np.pi, 72)  # 5-degree resolution
                
                # For each bearing, find the maximum distance at different altitudes
                # We'll create a surface by interpolating between known points
                surface_points = []
                
                for bearing_angle in bearings:
                    # Find records near this bearing (within 30 degrees)
                    nearby_records = []
                    for record in records:
                        record_bearing = math.radians(record['bearing'])
                        angle_diff = abs(bearing_angle - record_bearing)
                        # Handle wrap-around
                        if angle_diff > np.pi:
                            angle_diff = 2*np.pi - angle_diff
                        if angle_diff < np.pi/6:  # Within 30 degrees
                            nearby_records.append(record)
                    
                    if nearby_records:
                        # Use the maximum distance from nearby records
                        max_dist = max([r['distance'] for r in nearby_records])
                        max_alt = max([r['altitude'] / 1000.0 for r in nearby_records])
                        surface_points.append((bearing_angle, max_dist, max_alt))
                
                # Convert surface points to mesh
                if len(surface_points) >= 3:
                    surf_x = [-p[1] * np.sin(p[0]) for p in surface_points]  # Negative for correct East/West
                    surf_y = [p[1] * np.cos(p[0]) for p in surface_points]
                    surf_z = [p[2] for p in surface_points]
                    
                    # Close the loop
                    surf_x.append(surf_x[0])
                    surf_y.append(surf_y[0])
                    surf_z.append(surf_z[0])
                    
                    # Create triangulated surface using scipy
                    try:
                        from scipy.spatial import Delaunay
                        from scipy.interpolate import griddata
                    except ImportError as e:
                        print(f"\033[93mWarning: scipy not available for surface mesh: {e}\033[0m")
                        raise
                    
                    # Create a regular grid
                    xi = np.linspace(min(x_points + surf_x), max(x_points + surf_x), 50)
                    yi = np.linspace(min(y_points + surf_y), max(y_points + surf_y), 50)
                    Xi, Yi = np.meshgrid(xi, yi)
                    
                    # Interpolate z values on the grid
                    Zi = griddata((x_points, y_points), z_points, (Xi, Yi), method='linear', fill_value=0)
                    
                    # Plot the surface
                    surf = ax.plot_surface(Xi, Yi, Zi, alpha=0.3, cmap='viridis', 
                                         edgecolor='none', antialiased=True, zorder=1)
                    
                    # Add colorbar
                    fig.colorbar(surf, ax=ax, shrink=0.5, aspect=5, label='Altitude (1000 ft)')
            except Exception as e:
                print(f"Note: Could not generate surface mesh: {e}")
                pass
        
        # Set labels and title
        ax.set_xlabel('West-East Distance (nm)', fontsize=12, labelpad=10)
        ax.set_ylabel('North-South Distance (nm)', fontsize=12, labelpad=10)
        ax.set_zlabel('Altitude (1000 ft)', fontsize=12, labelpad=10)
        ax.set_title('PiAware Reception Coverage - 3D Visualization\nExtreme Range Records by Sector and Altitude', 
                     fontsize=16, pad=20)
        
        # Set aspect ratio - use same range for X and Y axes
        max_range = max([r['distance'] for r in records]) if records else 100
        max_alt = max([r['altitude'] / 1000.0 for r in records]) if records else 40
        
        # Determine the z-axis limit. Default to 50k ft, but extend if higher aircraft are seen.
        z_upper_limit = 50  # 50,000 feet
        if max_alt > z_upper_limit:
            z_upper_limit = max_alt * 1.1

        # Set limits to show all quadrants with origin at center
        # Use same range for both X and Y to create square aspect
        ax.set_xlim(-max_range * 1.1, max_range * 1.1)
        ax.set_ylim(-max_range * 1.1, max_range * 1.1)
        ax.set_zlim(0, z_upper_limit)
        
        # Correct the aspect ratio for a true-to-scale representation.
        # This makes the vertical scale (altitude) proportional to the horizontal
        # scale (distance), resulting in a much flatter, but more realistic, plot.
        if hasattr(ax, 'set_box_aspect'):
            try:
                z_range_kft = ax.get_zlim()[1] - ax.get_zlim()[0]
                # Convert Z range from thousands of feet to nautical miles
                z_range_nm = (z_range_kft * 1000) / 6076.12
                xy_range_nm = ax.get_xlim()[1] - ax.get_xlim()[0]
                ax.set_box_aspect((xy_range_nm, xy_range_nm, z_range_nm))
            except Exception as e:
                print(f"\033[93mWarning: Could not set true-to-scale aspect ratio: {e}\033[0m")
        
        # Invert Y-axis so North is at top (positive Y = North)
        ax.invert_yaxis()
        
        # Make axis tick labels show absolute values
        # This keeps the grid data with North+ and East+, but displays distances as positive
        x_ticks = ax.get_xticks()
        ax.set_xticklabels([f'{abs(int(x))}' for x in x_ticks])
        
        y_ticks = ax.get_yticks()
        ax.set_yticklabels([f'{abs(int(y))}' for y in y_ticks])
        
        # Add grid
        ax.grid(True, alpha=0.3)
        
        # Set viewing angle for better 3D perspective
        ax.view_init(elev=25, azim=45)
        
        # Add legend for altitude zones
        from matplotlib.patches import Patch
        legend_elements = [Patch(facecolor='red', label='Receiver')]
        for i, color in enumerate(altitude_zone_colors[:min(9, len(set([r['altitude_zone'] for r in records])))]):
            alt_min = i * 5000
            alt_max = (i + 1) * 5000 - 1
            legend_elements.append(Patch(facecolor=color, label=f'{alt_min}-{alt_max} ft'))
        ax.legend(handles=legend_elements, loc='upper left', fontsize=10)
        
        # Add text with stats
        stats_text = f"Total Records: {len(records)}\n"
        stats_text += f"Max Range: {max_range:.1f} nm\n"
        stats_text += f"Max Altitude: {max_alt * 1000:.0f} ft"
        fig.text(0.02, 0.02, stats_text, fontsize=10, 
                bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))
        
        # Save figure
        plt.tight_layout()
        plt.savefig(jpg_output_file, dpi=150, bbox_inches='tight', format='jpg')
        plt.close()
        
    except Exception as e:
        print(f"\033[91mError generating 3D JPG: {e}\033[0m")
        import traceback
        traceback.print_exc()


def count_position_reports_24h() -> int:
    """Count position reports from JSON files in the past 24 hours."""
    try:
        import glob
        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=24)
        total_positions = 0
        
        # Find all JSON log files in runtime dir
        if not os.path.exists(RUNTIME_DIR):
            return 0
        json_files = glob.glob(PIAWARE_MINUTE_GLOB)
        
        for json_file in json_files:
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    # Read line-delimited JSON (JSONL format)
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            aircraft = json.loads(line)
                            # Check if record has valid position and timestamp within 24h
                            if is_valid_position(aircraft.get('Latitude'), aircraft.get('Longitude')):
                                # Check timestamp if available
                                last_seen_str = aircraft.get('Last_Seen')
                                if last_seen_str:
                                    try:
                                        # Try parsing with UTC suffix first
                                        if last_seen_str.endswith(' UTC'):
                                            last_seen = datetime.strptime(last_seen_str, '%Y-%m-%d %H:%M:%S UTC').replace(tzinfo=timezone.utc)
                                        else:
                                            last_seen = datetime.strptime(last_seen_str, '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
                                        if last_seen >= cutoff_time:
                                            total_positions += 1
                                    except KeyboardInterrupt:
                                        # Re-raise keyboard interrupt
                                        raise
                                    except ValueError:
                                        # If timestamp parse fails, count it anyway
                                        total_positions += 1
                                else:
                                    # No timestamp, count it
                                    total_positions += 1
                        except json.JSONDecodeError:
                            # Skip invalid JSON lines
                            continue
            except IOError as e:
                print(f"\033[93mWarning: Could not read {json_file}: {e}\033[0m")
                continue
        
        return total_positions
    except KeyboardInterrupt:
        # If interrupted during counting, return what we have so far
        print(f"\033[93mPosition count interrupted, returning partial count: {total_positions}\033[0m")
        return total_positions
    except Exception as e:
        print(f"\033[91mError counting position reports: {e}\033[0m")
        return 0


def check_and_start_minio() -> bool:
    """
    Check if MinIO server is running, optionally try to start it on Windows.
    
    Note: Automatic startup only works on Windows with MinIO installed at C:\\minio\\
    On Linux, ensure MinIO is running manually or via systemd service.
    """
    try:
        # Try to connect to MinIO endpoint
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        result = sock.connect_ex(('localhost', 9000))
        sock.close()
        
        if result == 0:
            # Port is open, MinIO is likely running
            print("\033[92mMinIO server is already running\033[0m")
            return True
        else:
            # MinIO not running
            system_platform = platform.system()
            print(f"\033[93mMinIO server not detected on {system_platform}...\033[0m")
            
            if system_platform == 'Windows':
                # Try to start MinIO on Windows
                minio_start_script = r"C:\minio\start_minio.ps1"
                if not os.path.exists(minio_start_script):
                    print(f"\033[91mError: MinIO start script not found at {minio_start_script}\033[0m")
                    print("Please start MinIO manually or install it at C:\\minio\\")
                    return False
                
                # Start MinIO in a new hidden PowerShell process
                start_command = f"Start-Process powershell -ArgumentList '-ExecutionPolicy Bypass -File {minio_start_script}' -WindowStyle Hidden"
                subprocess.Popen(
                    ['powershell', '-Command', start_command],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
                
                # Wait for MinIO to start
                print("Waiting for MinIO to start...")
                time.sleep(5)
                
                # Verify it started
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(2)
                result = sock.connect_ex(('localhost', 9000))
                sock.close()
                
                if result == 0:
                    print("\033[92mMinIO server started successfully\033[0m")
                    return True
                else:
                    print("\033[91mFailed to start MinIO server\033[0m")
                    return False
            else:
                # Linux/Mac - provide instructions
                print("\033[93mPlease start MinIO manually:\033[0m")
                print("  Linux: sudo systemctl start minio")
                print("  Docker: docker run -p 9000:9000 minio/minio server /data")
                print("  Manual: ./minio server /data")
                return False
                
    except Exception as e:
        print(f"\033[91mError checking/starting MinIO: {e}\033[0m")
        return False


def initialize_s3_client(endpoint_url: str, access_key: str, secret_key: str) -> bool:
    """Initialize S3 client for MinIO uploads."""
    global s3_client, s3_upload_enabled
    
    if not BOTO3_AVAILABLE:
        print("\033[93mWarning: boto3 not available, S3 uploads disabled\033[0m")
        s3_upload_enabled = False
        return False
    
    print(f"Initializing S3 client with endpoint: {endpoint_url}, access_key: {access_key[:4]}****")
    try:
        s3_client = boto3.client(
            's3',
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key
        )
        
        # Test connection by listing buckets
        s3_client.list_buckets()
        s3_upload_enabled = True
        print(f"\033[92mS3 client initialized: {endpoint_url}\033[0m")
        return True
    except Exception as e:
        print(f"\033[91mError initializing S3 client: {e}\033[0m")
        s3_upload_enabled = False
        return False


def ensure_s3_bucket_exists(bucket_name: str) -> bool:
    """Ensure S3 bucket exists, create if it doesn't."""
    if not s3_upload_enabled or s3_client is None:
        return False
    
    try:
        # Check if bucket exists by trying to head it
        s3_client.head_bucket(Bucket=bucket_name)
        return True
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == '404':
            # Bucket doesn't exist, create it
            try:
                s3_client.create_bucket(Bucket=bucket_name)
                print(f"\033[92mCreated S3 bucket: {bucket_name}\033[0m")
                return True
            except Exception as create_error:
                print(f"\033[91mError creating bucket {bucket_name}: {create_error}\033[0m")
                return False
        else:
            print(f"\033[91mError checking bucket {bucket_name}: {e}\033[0m")
            return False
    except Exception as e:
        print(f"\033[91mError checking bucket {bucket_name}: {e}\033[0m")
        return False


def check_aircraft_type_cache_age(bucket_name: str) -> bool:
    """Check if aircraft type cache needs refresh (older than 30 days)."""
    if not s3_upload_enabled or s3_client is None:
        return False
    
    try:
        # Check if cache file exists and get its age
        response = s3_client.head_object(Bucket=bucket_name, Key='aircraft_type_database.json')
        last_modified = response['LastModified']
        
        # Calculate age in days
        now = datetime.now(timezone.utc)
        age_days = (now - last_modified).days
        
        return age_days >= aircraft_type_cache_age_days
    except ClientError as e:
        # File doesn't exist, needs refresh
        if e.response['Error']['Code'] == '404':
            return True
        return False
    except Exception:
        return False


def update_aircraft_type_cache(bucket_name: str) -> None:
    """Download PiAware aircraft type database and cache to S3."""
    if not s3_upload_enabled or s3_client is None:
        return
    
    print("\033[96mUpdating aircraft type database cache...\033[0m")
    
    try:
        hex_chars = '0123456789abcdef'
        type_lookup = {}
        files_found = 0
        total_aircraft = 0
        
        # Download from PiAware database
        for c1 in hex_chars:
            for c2 in hex_chars:
                for c3 in hex_chars:
                    prefix = f"{c1}{c2}{c3}"
                    url = f"{piaware_url.replace('/data/aircraft.json', '')}/db/{prefix.upper()}.json"
                    
                    try:
                        response = requests.get(url, timeout=3)
                        if response.status_code == 200:
                            db_data = response.json()
                            files_found += 1
                            
                            for suffix, info in db_data.items():
                                icao_hex = prefix.lower() + suffix.lower()
                                aircraft_type = info.get('t', 'N/A')
                                registration = info.get('r', 'N/A')
                                
                                if aircraft_type != 'N/A':
                                    type_lookup[icao_hex] = {
                                        'type': aircraft_type,
                                        'registration': registration
                                    }
                                    total_aircraft += 1
                    except:
                        continue
        
        # Create database document
        type_database = {
            'metadata': {
                'source': 'PiAware Local Database',
                'cached_at': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC'),
                'total_aircraft': len(type_lookup),
                'files_found': files_found
            },
            'aircraft': type_lookup
        }
        
        # Upload to S3
        json_data = json.dumps(type_database)
        s3_client.put_object(
            Bucket=bucket_name,
            Key='aircraft_type_database.json',
            Body=json_data.encode('utf-8'),
            ContentType='application/json'
        )
        
        print(f"\033[92mCached {total_aircraft:,} aircraft types from {files_found} database files\033[0m")
        
    except Exception as e:
        print(f"\033[91mError updating aircraft type cache: {e}\033[0m")


def upload_flightaware_urls_to_s3(bucket_name: str) -> None:
    """Upload buffered FlightAware URLs to S3 bucket."""
    global last_flightaware_upload_time, flightaware_urls_buffer
    
    if not s3_upload_enabled or s3_client is None:
        return
    
    if not flightaware_urls_buffer:
        return  # Nothing to upload
    
    try:
        # Ensure bucket exists
        if not ensure_s3_bucket_exists(bucket_name):
            print(f"\033[91mCannot upload FlightAware URLs: bucket {bucket_name} not available\033[0m")
            return
        
        # Generate filename with current timestamp
        now = datetime.now(timezone.utc)
        filename = f"flightaware_urls_{now.strftime('%Y%m%d_%H%M%S')}.txt"
        
        # Create content from buffer
        content = "\n".join(flightaware_urls_buffer) + "\n"
        
        # Upload to S3
        s3_client.put_object(
            Bucket=bucket_name,
            Key=filename,
            Body=content.encode('utf-8'),
            ContentType='text/plain'
        )
        
        print(f"\033[92mUploaded {len(flightaware_urls_buffer)} FlightAware URL(s) to S3 bucket '{bucket_name}' as {filename}\033[0m")
        
        # Clear buffer after successful upload
        flightaware_urls_buffer.clear()
        last_flightaware_upload_time = time.time()
        
    except Exception as e:
        print(f"\033[91mError uploading FlightAware URLs to S3: {e}\033[0m")


def load_current_hour_from_s3(bucket_name: str) -> None:
    """Load all minute files from S3 for current hour and reconcile with local file."""
    
    if not s3_upload_enabled or s3_client is None:
        return
    
    try:
        now = datetime.now(timezone.utc)
        current_hour_prefix = f"piaware_aircraft_log_{now.strftime('%Y%m%d_%H')}"
        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=24) # Define cutoff_time locally
        
        print(f"Loading S3 minute files for current hour: {now.strftime('%Y-%m-%d %H:00')} UTC")
        
        # List all minute files for current hour from S3
        try:
            response = s3_client.list_objects_v2(
                Bucket=bucket_name,
                Prefix=current_hour_prefix
            )
            
            if 'Contents' not in response:
                print("No minute files found in S3 for current hour")
                return
            
            minute_files = [obj['Key'] for obj in response['Contents']
                           if obj['Key'].endswith('.json') and not obj['Key'].endswith('00.json')]
            
            if not minute_files:
                print("No minute files found in S3 for current hour")
                return
            
            print(f"Found {len(minute_files)} minute file(s) in S3")
            
            # Load all S3 records into a set (using ICAO+timestamp as key to avoid duplicates)
            s3_records = {}  # key: (icao, last_seen), value: aircraft_data
            total_positions = 0 # Initialize total_positions for this function's scope
            
            for minute_file in sorted(minute_files):
                try:
                    obj = s3_client.get_object(Bucket=bucket_name, Key=minute_file)
                    content = obj['Body'].read().decode('utf-8')
                    
                    for line in content.strip().split('\n'):
                        if line.strip():
                            try:
                                aircraft_data = json.loads(line)
                                # Check if record has valid position and timestamp within 24h
                                if is_valid_position(aircraft_data.get('Latitude'), aircraft_data.get('Longitude')):
                                    # Check timestamp if available
                                    last_seen_str = aircraft_data.get('Last_Seen')
                                    if last_seen_str:
                                        try:
                                            # Try parsing with UTC suffix first
                                            if last_seen_str.endswith(' UTC'):
                                                last_seen = datetime.strptime(last_seen_str, '%Y-%m-%d %H:%M:%S UTC').replace(tzinfo=timezone.utc)
                                            else:
                                                last_seen = datetime.strptime(last_seen_str, '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
                                            if last_seen >= cutoff_time:
                                                total_positions += 1
                                        except KeyboardInterrupt:
                                            # Re-raise keyboard interrupt
                                            raise
                                        except ValueError:
                                            # If timestamp parse fails, count it anyway
                                            total_positions += 1
                                    else:
                                        # No timestamp, count it
                                        total_positions += 1
                            except json.JSONDecodeError:
                                # Skip invalid JSON lines
                                continue
                except Exception as e:
                    print(f"\033[91mError reading {minute_file}: {e}\033[0m")
                    continue
            
            print(f"Loaded {len(s3_records)} unique records from S3")
                
        except ClientError as e:
            if e.response['Error']['Code'] == 'NoSuchBucket':
                print(f"\033[91mBucket {bucket_name} does not exist\033[0m")
            else:
                print(f"\033[91mError listing S3 objects: {e}\033[0m")
                
    except Exception as e:
        print(f"\033[91mError loading current hour from S3: {e}\033[0m")


def upload_minute_file_to_s3(bucket_name: str, aircraft_buffer: List[dict]) -> None:
    """Upload a buffer of aircraft data as a per-minute file to S3."""
    global last_minute_upload_time, s3_upload_count, last_uploaded_file
    
    if not s3_upload_enabled or s3_client is None:
        return
    
    if not aircraft_buffer:
        return  # Nothing to upload
    
    try:
        # Generate minute filename with optional prefix
        now = datetime.now(timezone.utc)
        from config_reader import get_config
        config = get_config()
        s3_prefix = config.get('s3_prefix', '')
        minute_filename = f"{s3_prefix}piaware_aircraft_log_{now.strftime('%Y%m%d_%H%M')}.json"
        
        # Create JSON content from the provided buffer
        json_lines = []
        for aircraft_info in aircraft_buffer:
            # Get lat/lon, keeping as-is (may be 'N/A' or numeric)
            lat = aircraft_info.get('lat')
            lon = aircraft_info.get('lon')

            nationality = get_nationality(aircraft_info.get('dbFlags', 0))

            # Standardize timestamps to ISO 8601 Z
            first_seen_iso = aircraft_info['first_seen'].astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
            last_seen_iso = aircraft_info['last_seen'].astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
            # Per-position timestamp: use 'position_timestamp' if present, else fallback to last_seen
            position_ts = aircraft_info.get('position_timestamp', None)
            if position_ts:
                position_dt = datetime.fromtimestamp(position_ts, tz=timezone.utc)
                position_iso = position_dt.strftime('%Y-%m-%dT%H:%M:%SZ')
            else:
                position_iso = last_seen_iso
            
            aircraft_data = {
                'ICAO': aircraft_info['hex'],
                'Ident': aircraft_info['flight'],
                'Airline': get_airline_from_callsign(aircraft_info['flight']),
                'Registration': aircraft_info.get('registration', 'N/A'),
                'Aircraft_type': aircraft_info.get('type', 'N/A'),
                'Squawk': aircraft_info['squawk'],
                'squawk_changed': aircraft_info.get('squawk_changed', False),
                'Altitude_ft': aircraft_info['alt_baro'],
                'Speed_kt': aircraft_info['gs'],
                'Vertical_Rate_ft_min': aircraft_info.get('baro_rate', 'N/A'),
                'Distance_NM': aircraft_info['r_dst'],
                'Heading': aircraft_info['track'],
                'Messages': aircraft_info['messages'],
                'Age': aircraft_info['seen'],
                'RSSI': aircraft_info.get('rssi', 'N/A'),
                'Latitude': lat,
                'Longitude': lon,
                'Nationality': nationality,
                'First_Seen': first_seen_iso,
                'Last_Seen': last_seen_iso,
                'Position_Timestamp': position_iso,
                'Data_Quality': aircraft_info.get('data_quality', 'N/A')
            }
            json_lines.append(json.dumps(aircraft_data))
        
        content = '\n'.join(json_lines) + '\n'
        
        # Upload to S3
        s3_client.put_object(
            Bucket=bucket_name,
            Key=minute_filename,
            Body=content.encode('utf-8'),
            ContentType='application/x-ndjson'
        )
        
        last_minute_upload_time = time.time()
        s3_upload_count += 1
        last_uploaded_file = minute_filename
        print(f"\033[96mUploaded minute file to S3: s3://{bucket_name}/{minute_filename} ({len(aircraft_buffer)} records, total uploads: {s3_upload_count})\033[0m")
        
    except Exception as e:
        print(f"\033[91mError uploading minute file to S3: {e}\033[0m")


def rollup_and_cleanup_s3_files(bucket_name: str) -> None:
    """Consolidate minute files into hourly file and cleanup."""
    global last_hourly_rollup_hour
    
    if not s3_upload_enabled or s3_client is None:
        return
    
    try:
        now = datetime.now(timezone.utc)
        current_hour = now.hour
        
        # Only rollup when we transition to a new hour
        if current_hour == last_hourly_rollup_hour:
            return
        
        # Determine the previous hour to rollup
        prev_hour_dt = now - timedelta(hours=1)
        prev_hour_prefix = f"piaware_aircraft_log_{prev_hour_dt.strftime('%Y%m%d_%H')}"
        hourly_filename = f"{prev_hour_prefix}00.json"
        
        print(f"\033[96mPerforming hourly rollup for {prev_hour_dt.strftime('%Y-%m-%d %H:00')} UTC...\033[0m")
        
        # List all minute files for the previous hour
        response = s3_client.list_objects_v2(
            Bucket=bucket_name,
            Prefix=prev_hour_prefix
        )
        
        if 'Contents' not in response:
            print(f"\033[93mNo minute files found for rollup\033[0m")
            last_hourly_rollup_hour = current_hour
            return
        
        minute_files = [obj['Key'] for obj in response['Contents'] 
                       if obj['Key'] != hourly_filename and obj['Key'].endswith('.json')]
        
        if not minute_files:
            print(f"\033[93mNo minute files to rollup\033[0m")
            last_hourly_rollup_hour = current_hour
            return
        
        # Download and consolidate all minute files with deduplication
        all_records = {}  # key: (icao, last_seen), value: json_line
        original_count = 0
        
        for minute_file in sorted(minute_files):
            try:
                obj = s3_client.get_object(Bucket=bucket_name, Key=minute_file)
                content = obj['Body'].read().decode('utf-8')
                
                for line in content.strip().split('\n'):
                    if line.strip():
                        original_count += 1
                        try:
                            # Parse to extract key for deduplication
                            aircraft_data = json.loads(line)
                            icao = aircraft_data.get('ICAO')
                            last_seen = aircraft_data.get('Last_Seen')
                            
                            if icao and last_seen:
                                key = (icao, last_seen)
                                # Keep only unique records (last one wins if duplicates)
                                all_records[key] = line.strip()
                        except json.JSONDecodeError:
                            # Keep unparseable lines as-is
                            all_records[len(all_records)] = line.strip()
                            
            except Exception as e:
                print(f"\033[91mError reading {minute_file}: {e}\033[0m")
                continue
        
        duplicate_count = original_count - len(all_records)
        if duplicate_count > 0:
            print(f"\033[93mRemoved {duplicate_count} duplicate record(s) during rollup\033[0m")
        
        # Upload consolidated and deduplicated hourly file
        if all_records:
            # Sort by key for consistent ordering
            sorted_lines = [all_records[key] for key in sorted(all_records.keys(), 
                           key=lambda x: x if isinstance(x, tuple) else (str(x),))]
            consolidated_content = '\n'.join(sorted_lines) + '\n'
            
            s3_client.put_object(
                Bucket=bucket_name,
                Key=hourly_filename,
                Body=consolidated_content.encode('utf-8'),
                ContentType='application/x-ndjson'
            )
            print(f"\033[92mCreated hourly rollup: {hourly_filename} ({len(all_records)} unique records)\033[0m")
        
        # Delete minute files after successful rollup
        deleted_count = 0
        for minute_file in minute_files:
            try:
                s3_client.delete_object(Bucket=bucket_name, Key=minute_file)
                deleted_count += 1
            except Exception as e:
                print(f"\033[91mError deleting {minute_file}: {e}\033[0m")
        
        if deleted_count > 0:
            print(f"\033[92mCleaned up {deleted_count} minute file(s)\033[0m")
        
        last_hourly_rollup_hour = current_hour
        
    except Exception as e:
        print(f"\033[91mError during hourly rollup: {e}\033[0m")


def upload_to_s3(bucket_name: str, kml_bucket_name: str) -> None:
    """Upload KML outputs to S3 bucket (JSON now handled per-minute)."""
    global last_s3_upload_time
    
    if not s3_upload_enabled or s3_client is None:
        return
    
    try:
        
        # Upload KML output files to separate bucket
        kml_files = glob.glob('*.kml')
        kml_uploaded = 0
        kml_failed = 0
        
        for kml_file in kml_files:
            try:
                # Get file modification time
                file_mtime = os.path.getmtime(kml_file)
                
                # Upload if modified since last upload
                if file_mtime > last_s3_upload_time:
                    s3_key = os.path.basename(kml_file)
                    s3_client.upload_file(kml_file, kml_bucket_name, s3_key)
                    kml_uploaded += 1
            except ClientError as e:
                print(f"\033[91mError uploading {kml_file} to S3: {e}\033[0m")
                kml_failed += 1
            except Exception as e:
                print(f"\033[91mUnexpected error uploading {kml_file}: {e}\033[0m")
                kml_failed += 1
        
        if kml_uploaded > 0:
            print(f"\033[92mUploaded {kml_uploaded} KML file(s) to S3 bucket '{kml_bucket_name}'\033[0m")
        if kml_failed > 0:
            print(f"\033[93m{kml_failed} KML file(s) failed to upload\033[0m")
        
        # Update last upload time
        last_s3_upload_time = time.time()
        
    except Exception as e:
        print(f"\033[91mError during S3 upload: {e}\033[0m")


def generate_heatmap() -> None:
    """Generate heatmap strip with 1, 10, 25, and 100 NM cell sizes from S3 data."""
    try:
        import subprocess
        import tempfile
        import shutil

        if not s3_upload_enabled or not s3_client:
            print("\033[93mS3 is not enabled, skipping heatmap generation from S3.\033[0m")
            return

        with tempfile.TemporaryDirectory() as temp_dir:
            print(f"Created temporary directory for heatmap data: {temp_dir}")

            # Download last 24 hours of logs from S3
            cutoff_time = datetime.now(timezone.utc) - timedelta(hours=24)
            all_log_files = []
            for h in range(25):
                dt = datetime.now(timezone.utc) - timedelta(hours=h)
                prefix = f"piaware_aircraft_log_{dt.strftime('%Y%m%d_%H')}"
                try:
                    response = s3_client.list_objects_v2(Bucket=s3_bucket_name, Prefix=prefix)
                    if 'Contents' in response:
                        all_log_files.extend([obj['Key'] for obj in response['Contents'] if obj['Key'].endswith('.json')])
                except ClientError:
                    continue
            
            downloaded_count = 0
            for log_file in set(all_log_files):
                try:
                    local_path = os.path.join(temp_dir, os.path.basename(log_file))
                    s3_client.download_file(s3_bucket_name, log_file, local_path)
                    downloaded_count += 1
                except Exception as e:
                    print(f"\033[91mFailed to download {log_file} from S3: {e}\033[0m")
            
            if downloaded_count == 0:
                print("\033[93mNo log files found in S3 for heatmap generation.\033[0m")
                return

            print(f"Downloaded {downloaded_count} log files from S3 to temporary directory.")

            # Cell sizes to generate
            cell_sizes = [1, 10, 25, 100]
            heatmap_files = []
            
            # Generate heatmaps for each cell size
            for cell_size in cell_sizes:
                output_file = f'aircraft_heatmap_{cell_size}nm.jpg'
                heatmap_files.append(output_file)
                
                cmd = [
                    'python',
                    'aircraft_heatmap.py',
                    '--piaware-server', piaware_url.replace('http://', '').replace('/data/aircraft.json', ''),
                    '--output', output_file,
                    '--cell-size', str(cell_size),
                    '--pattern', os.path.join(temp_dir, '*.json'),
                    '--receiver-lat', str(receiver_lat),
                    '--receiver-lon', str(receiver_lon)
                ]
                
                result = subprocess.run(cmd, capture_output=True, text=True)
                
                if result.returncode != 0:
                    print(f"\033[91mError generating {cell_size}NM heatmap: {result.stderr}\033[0m")
                    return
            
            # Combine all 4 heatmaps into a strip
            if len(heatmap_files) == 4:
                combine_cmd = [
                    'python',
                    'combine_heatmaps.py',
                    heatmap_files[0], heatmap_files[1], heatmap_files[2], heatmap_files[3],
                    heatmap_output_file
                ]
                
                result = subprocess.run(combine_cmd, capture_output=True, text=True)
                
                if result.returncode == 0:
                    print(f"\033[92mHeatmap strip generated: {heatmap_output_file}\033[0m")
                else:
                    print(f"\033[91mError combining heatmaps: {result.stderr}\033[0m")
        
    except Exception as e:
        print(f"\033[91mError generating heatmap: {e}\033[0m")


def get_longest_slant_range() -> Optional[dict]:
    """Find the aircraft with the longest slant range currently being tracked."""
    global max_slant_range_record
    
    if not aircraft_tracking:
        return max_slant_range_record
    
    longest = None
    max_slant = 0
    
    for info in aircraft_tracking.values():
        # Only consider aircraft with numeric r_dst and altitude and a valid position
        if (info.get('r_dst') not in (None, 'N/A') and info.get('alt_baro') not in (None, 'N/A') and
            is_valid_position(info.get('lat'), info.get('lon')) and
            receiver_lat != 0.0 and receiver_lon != 0.0):
            try:
                pos_dist = info['r_dst']
                slant_dist = calculate_slant_distance(pos_dist, info['alt_baro'])
                
                # Calculate bearing for sector tracking
                bearing = calculate_bearing(receiver_lat, receiver_lon, info['lat'], info['lon'])
                
                # Update sector+altitude records
                update_sector_altitude_records(info, slant_dist, bearing)
                
                if slant_dist > max_slant:
                    max_slant = slant_dist
                    longest = {
                        'aircraft': info.copy(),  # Copy to preserve data
                        'slant_distance': slant_dist
                    }
                
                # Update all-time record if this is the longest ever
                if max_slant_range_record is None or slant_dist > max_slant_range_record['slant_distance']:
                    max_slant_range_record = {
                        'aircraft': info.copy(),
                        'slant_distance': slant_dist,
                        'timestamp': datetime.now(timezone.utc)
                    }
            except:
                continue
    
    # Return the all-time record
    return max_slant_range_record


def populate_reception_records_from_s3(history_hours: int):
    """Scan S3 history to populate reception records with historical maximums."""
    if not s3_upload_enabled or not s3_client:
        return
    
    print(f"\nScanning last {history_hours} hours of S3 history for reception records...")
    
    cutoff_time = datetime.now(timezone.utc) - timedelta(hours=history_hours)
    
    try:
        # List all hourly log files within the time window
        all_log_files = []
        for h in range(history_hours + 1):
            dt = datetime.now(timezone.utc) - timedelta(hours=h)
            prefix = f"piaware_aircraft_log_{dt.strftime('%Y%m%d_%H')}"
            
            try:
                response = s3_client.list_objects_v2(Bucket=s3_bucket_name, Prefix=prefix)
                if 'Contents' in response:
                    all_log_files.extend([obj['Key'] for obj in response['Contents'] if obj['Key'].endswith('.json')])
            except ClientError:
                continue

        processed_records = 0
        for log_file in set(all_log_files):
            try:
                obj = s3_client.get_object(Bucket=s3_bucket_name, Key=log_file)
                content = obj['Body'].read().decode('utf-8')
                
                for line in content.splitlines():
                    try:
                        record = json.loads(line)
                        processed_records += 1
                        
                        # Check if record is within the time window and has a valid position
                        last_seen_str = record.get('Last_Seen')
                        if last_seen_str:
                            try:
                                # Try different datetime formats
                                if last_seen_str.endswith('Z'):
                                    last_seen_dt = datetime.strptime(last_seen_str, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
                                else:
                                    last_seen_dt = datetime.strptime(last_seen_str, '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc)
                                if last_seen_dt < cutoff_time:
                                    continue
                            except ValueError:
                                # Skip records with invalid datetime format
                                continue

                        if is_valid_position(record.get('Latitude'), record.get('Longitude')):
                            lat = record['Latitude']
                            lon = record['Longitude']
                            alt = record.get('Altitude_ft')
                            
                            if alt is not None and alt != 'N/A' and receiver_lat != 0.0 and receiver_lon != 0.0:
                                pos_dist = calculate_distance(receiver_lat, receiver_lon, lat, lon)
                                slant_dist = calculate_slant_distance(pos_dist, alt)
                                bearing = calculate_bearing(receiver_lat, receiver_lon, lat, lon)
                                
                                # Create a mock aircraft_info dict to pass to update_sector_altitude_records
                                mock_info = {
                                    'hex': record.get('ICAO'),
                                    'flight': record.get('Ident'),
                                    'registration': record.get('Registration'),
                                    'type': record.get('Aircraft_type'),
                                    'alt_baro': alt,
                                    'r_dst': pos_dist
                                }
                                update_sector_altitude_records(mock_info, slant_dist, bearing)

                    except (json.JSONDecodeError, TypeError, ValueError):
                        continue
            except (ClientError, IOError):
                continue
        
        print(f"Scanned {len(set(all_log_files))} log files and processed {processed_records} records.")
        print(f"Populated {len(sector_altitude_records)} reception records from S3 history.")
        
    except Exception as e:
        print(f"\033[91mError scanning S3 history: {e}\033[0m")

def get_icao_cache_from_s3(hex_code: str) -> Optional[dict]:
    """Get aircraft details from S3 ICAO cache."""
    if not s3_upload_enabled or not s3_client:
        return None
    
    try:
        obj = s3_client.get_object(Bucket=s3_icao_cache_bucket_name, Key=f"{hex_code}.json")
        data = json.loads(obj['Body'].read().decode('utf-8'))
        
        # Check if cache entry is still valid (within 7 days)
        timestamp_str = data.get('timestamp')
        if timestamp_str:
            timestamp = datetime.strptime(timestamp_str, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
            if (datetime.now(timezone.utc) - timestamp).days < 7:
                return data
        
        return None
    except ClientError as e:
        if e.response['Error']['Code'] == 'NoSuchKey':
            return None
        print(f"\033[91mError getting ICAO cache for {hex_code}: {e}\033[0m")
        return None
    except (json.JSONDecodeError, TypeError, ValueError) as e:
        print(f"\033[91mError decoding ICAO cache for {hex_code}: {e}\033[0m")
        return None

def set_icao_cache_to_s3(hex_code: str, registration: str, aircraft_type: str):
    """Set aircraft details in S3 ICAO cache."""
    if not s3_upload_enabled or not s3_client:
        return

    data = {
        'registration': registration,
        'type': aircraft_type,
        'timestamp': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    }
    
    try:
        s3_client.put_object(
            Bucket=s3_icao_cache_bucket_name,
            Key=f"{hex_code}.json",
            Body=json.dumps(data).encode('utf-8'),
            ContentType='application/json'
        )
    except Exception as e:
        print(f"\033[91mError setting ICAO cache for {hex_code}: {e}\033[0m")


def main():
    """Main monitoring loop."""
    global piaware_url, output_filename, output_format, current_hour, total_log_size
    global receiver_lat, receiver_lon, receiver_version, history_cache, last_kml_write_time, last_jpg_write_time, last_heatmap_write_time
    global position_reports_24h, running_position_count, heatmap_cell_size, last_s3_upload_time, last_flightaware_upload_time, last_minute_upload_time
    global tracker_start_time
    global s3_bucket_name, s3_kml_bucket_name, s3_flightaware_bucket_name, s3_reception_bucket_name, s3_icao_cache_bucket_name
    global s3_upload_count, last_uploaded_file
    s3_upload_enabled = False # Initialize to False to prevent UnboundLocalError

    # Create an on-disk dated backup of this script before runtime execution
    try:
        import shutil, pathlib
        src_path = pathlib.Path(__file__).resolve()
        ts = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
        backup_name = f"{src_path.stem}.backup_{ts}.py"
        backup_path = src_path.with_name(backup_name)
        if not backup_path.exists():
            shutil.copy2(src_path, backup_path)
            print(f"Created backup of aircraft_tracker.py at: {backup_path}")
    except Exception as e:
        print(f"Warning: could not create backup of aircraft_tracker.py: {e}")

    parser = argparse.ArgumentParser(
        description='Track aircraft from PiAware server with S3 archival',
        epilog='''
================================================================================
S3 UPLOAD STRATEGY:
================================================================================

Per-Minute Uploads:
  - Every 60 seconds, uploads current aircraft data as a minute file
  - Format: piaware_aircraft_log_YYYYMMDD_HHMM.json
  - Example: piaware_aircraft_log_20251116_1623.json
  - Small, incremental uploads (~50-500 records per file)

Hourly Rollup:
  - At the top of each hour, consolidates previous hour's minute files
  - Downloads all 60 minute files from S3
  - Deduplicates using (ICAO, Last_Seen) as unique key
  - Uploads single hourly file: piaware_aircraft_log_YYYYMMDD_HH00.json
  - Deletes minute files after successful rollup
  - Hourly file is immutable and ready for long-term storage

Startup Reconciliation:
  - On startup, loads all minute files for current hour from S3
  - Compares with local hourly file
  - Appends any missing records to local file
  - Ensures consistency after crashes/restarts

Aircraft Type Cache:
  - Downloads PiAware aircraft type database on first run
  - Caches to S3 as aircraft_type_database.json
  - Auto-refreshes every 30 days
  - Contains 200,000+ ICAO hex codes mapped to aircraft types

Additional S3 Uploads:
  - KML files: Updated every 10 minutes to output-kmls bucket
  - FlightAware URLs: Tracked aircraft URLs to flighturls bucket
  - All uploads use UTC timestamps

Benefits:
  - No data loss on crashes (S3 has minute-level backups)
  - Efficient bandwidth (small incremental uploads)
  - Clean data (deduplication before immutable storage)
  - Easy analysis (consolidated hourly files)
================================================================================
        ''',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('server', nargs='?', default='192.168.0.178:8080',
                        help='PiAware server address (default: 192.168.0.178:8080)')
    parser.add_argument('--output', '-o', help='[DEPRECATED] Local output is disabled.', default=None)
    parser.add_argument('--format', '-f', help='[DEPRECATED] Only JSON format is used for S3.', default=None)
    parser.add_argument('--heatmap-cell-size', type=int, default=5,
                        help='Heatmap grid cell size in nautical miles (default: 5)')
    # Get S3 defaults from config_reader if available, otherwise use hardcoded defaults
    if CONFIG_READER_AVAILABLE:
        try:
            config = get_config()
            default_endpoint = config.get('s3Endpoint', 'http://localhost:9000')
            default_access = config.get('s3AccessKeyId', 'minioadmin')
            default_secret = config.get('s3SecretAccessKey', 'minioadmin123')
            # Use readBucket from config.js for default S3 bucket
            default_bucket = config.get('readBucket', 'aircraft-data')
        except Exception as e:
            print(f"Warning: Could not read config.js: {e}")
            default_endpoint = 'http://localhost:9000'
            default_access = 'minioadmin'
            default_secret = 'minioadmin123'
            default_bucket = 'aircraft-data'
    else:
        default_endpoint = 'http://localhost:9000'
        default_access = 'minioadmin'
        default_secret = 'minioadmin123'
        default_bucket = 'aircraft-data'
    
    parser.add_argument('--s3-endpoint', default=default_endpoint,
                        help=f'S3/MinIO endpoint URL (default: {default_endpoint})')
    parser.add_argument('--s3-access-key', default=default_access,
                        help=f'S3 access key (default: {default_access})')
    parser.add_argument('--s3-secret-key', default=default_secret,
                        help=f'S3 secret key (default: {default_secret})')
    parser.add_argument('--s3-bucket', default=default_bucket,
                        help=f'S3 bucket for aircraft JSON data (default: {default_bucket})')
    parser.add_argument('--s3-kml-bucket', default='output-kmls',
                        help='S3 bucket for KML outputs (default: output-kmls)')
    parser.add_argument('--s3-flightaware-bucket', default='flighturls',
                        help='S3 bucket for FlightAware URLs (default: flighturls)')
    parser.add_argument('--s3-reception-bucket', default='piawarereceptiondata',
                        help='S3 bucket for reception records (default: piaware-reception-data)')
    parser.add_argument('--s3-icao-cache-bucket', default='icao-hex-cache',
                        help='S3 bucket for ICAO hex code cache (default: icao-hex-cache)')
    parser.add_argument('--s3-history-hours', type=int, default=24,
                        help='How many hours of S3 history to scan for reception records on startup (default: 24)')
    parser.add_argument('--test-run', action='store_true',
                        help='Run for a few iterations and exit (for testing purposes)')
    parser.add_argument('--read-only', action='store_true',
                        help='Run in read-only mode, disabling all local and S3 file writes')
    
    # Explicit enable/disable flags for S3 behavior. Default is enabled.
    s3_group = parser.add_mutually_exclusive_group()
    s3_group.add_argument('--enable-s3', dest='enable_s3', action='store_true',
                          help='Enable per-minute S3 uploads with hourly rollup')
    s3_group.add_argument('--disable-s3', dest='enable_s3', action='store_false',
                          help='Disable per-minute S3 uploads')
    global args
    parser.set_defaults(enable_s3=True)
    args = parser.parse_args()
    
    piaware_url = f"http://{args.server}/data/aircraft.json"
    # Only override defaults if explicit args were provided
    output_filename = args.output if args.output is not None else output_filename
    output_format = args.format if args.format is not None else output_format
    heatmap_cell_size = args.heatmap_cell_size
    s3_bucket_name = args.s3_bucket
    s3_kml_bucket_name = args.s3_kml_bucket
    s3_flightaware_bucket_name = args.s3_flightaware_bucket
    s3_reception_bucket_name = args.s3_reception_bucket
    s3_icao_cache_bucket_name = args.s3_icao_cache_bucket
    
    # Create the output directory for local files like KML and reception records
    if not os.path.exists(OUTPUT_SUBDIR):
        os.makedirs(OUTPUT_SUBDIR)
        print(f"Created output directory: {OUTPUT_SUBDIR}")
    # Create runtime directory for minute files and temp files
    if not os.path.exists(RUNTIME_DIR):
        os.makedirs(RUNTIME_DIR)
        print(f"Created runtime directory: {RUNTIME_DIR}")
    
    # Print S3 path and log size at startup
    from config_reader import get_config
    config = get_config()
    s3_bucket = config.get('s3_bucket', 'aircraft-data')
    s3_prefix = config.get('s3_prefix', '')
    print(f"S3 log path: s3://{s3_bucket}/{s3_prefix}piaware_aircraft_log_*.json")
    def calculate_s3_log_size(bucket_name: str, prefix: str) -> float:
        """Calculate total size of all aircraft log files in S3 bucket (MB)."""
        if not BOTO3_AVAILABLE or s3_client is None:
            return 0.0
        try:
            total_bytes = 0
            paginator = s3_client.get_paginator('list_objects_v2')
            for page in paginator.paginate(Bucket=bucket_name, Prefix=prefix):
                for obj in page.get('Contents', []):
                    key = obj['Key']
                    if key.startswith(prefix) and (key.endswith('.json') or key.endswith('.csv')):
                        total_bytes += obj['Size']
            return total_bytes / (1024 * 1024)
        except Exception as e:
            print(f"\033[91mError calculating S3 log size: {e}\033[0m")
            return 0.0
    s3_log_size = calculate_s3_log_size(s3_bucket, s3_prefix)
    print(f"Total S3 log size: \033[96m{s3_log_size:.2f} MB\033[0m")
    
    # Initialize S3 client if enabled, before loading records
    if args.enable_s3:
        print("Checking MinIO server status...")
        if check_and_start_minio():
            print("Initializing S3 client...")
            if initialize_s3_client(args.s3_endpoint, args.s3_access_key, args.s3_secret_key):
                s3_upload_enabled = True  # Enable S3 uploads
                print(f"S3 uploads enabled:")
                print(f"  - JSON bucket: {args.s3_bucket}")
                print(f"  - KML bucket: {args.s3_kml_bucket}")
                print(f"  - FlightAware URLs bucket: {args.s3_flightaware_bucket}")
                
                # Ensure the reception records bucket exists
                print("\nEnsuring S3 reception records bucket exists...")
                if not ensure_s3_bucket_exists(s3_reception_bucket_name):
                    print(f"\033[91mError: Reception records S3 bucket '{s3_reception_bucket_name}' could not be created or accessed.\033[0m")
                    s3_upload_enabled = False # Disable S3 if this critical bucket is unavailable

                # Ensure the ICAO hex cache bucket exists (optional cache)
                print("\nEnsuring S3 ICAO cache bucket exists...")
                if not ensure_s3_bucket_exists(s3_icao_cache_bucket_name):
                    print(f"\033[93mWarning: ICAO cache S3 bucket '{s3_icao_cache_bucket_name}' could not be created or accessed. ICAO cache will be disabled.\033[0m")

                # Ensure the ICAO hex cache bucket exists (optional cache)
                print("\nEnsuring S3 ICAO cache bucket exists...")
                if not ensure_s3_bucket_exists(s3_icao_cache_bucket_name):
                    print(f"\033[93mWarning: ICAO cache S3 bucket '{s3_icao_cache_bucket_name}' could not be created or accessed. ICAO cache will be disabled.\033[0m")
                
                # Check aircraft type cache age
                print("\nChecking aircraft type database cache...")
                if check_aircraft_type_cache_age(args.s3_bucket):
                    print("Cache is older than 30 days or missing, updating...")
                    update_aircraft_type_cache(args.s3_bucket)
                else:
                    print("Cache is current (less than 30 days old)")
                
                # Load and reconcile current hour data from S3
                print("\nReconciling current hour data with S3...")
                load_current_hour_from_s3(args.s3_bucket)
                
                # Populate reception records from S3 history
                populate_reception_records_from_s3(args.s3_history_hours)
            else:
                print("S3 uploads disabled due to initialization failure")
                import sys
                sys.exit(1)
        else:
            print("S3 uploads disabled - MinIO server could not be started")
            import sys
            sys.exit(1)
    else:
        print("S3 uploads disabled (use --disable-s3 to disable)")
    
    print(f"S3 bucket connected: {s3_bucket_name if s3_upload_enabled else 'None'}")
    print(f"S3 files uploaded: {s3_upload_count}")
    print(f"Last uploaded file: {last_uploaded_file if last_uploaded_file else 'None'}")
    
    # Auto-adjust extension if needed
    if output_format == 'json' and not output_filename.endswith('.json'):
        output_filename = output_filename.rsplit('.', 1)[0] + '.json'
    elif output_format == 'csv' and not output_filename.endswith('.csv'):
        output_filename = output_filename.rsplit('.', 1)[0] + '.csv'
    
    # Create the output directory if it doesn't exist
    if not os.path.exists(OUTPUT_SUBDIR):
        os.makedirs(OUTPUT_SUBDIR)
        print(f"Created output directory: {OUTPUT_SUBDIR}")

    # Get receiver information
    receiver_info = get_receiver_info()
    if receiver_info:
        receiver_lat = receiver_info.get('lat', 0.0)
        receiver_lon = receiver_info.get('lon', 0.0)
        receiver_version = receiver_info.get('version', 'unknown')
    
    # Load history to get callsigns and squawk codes
    print("Loading history data...")
    history_cache = load_history_data()
    print(f"Loaded history for {len(history_cache)} aircraft")
    
    # Load existing reception records
    print("Loading existing reception records...")
    load_reception_records()
    print()
    
    # Calculate initial total log size
    total_log_size = calculate_total_log_size()
    
    # Count position reports from past 24 hours (skip during test runs)
    if args.test_run:
        print("Skipping 24-hour position count for test run...")
        position_reports_24h = 0
        running_position_count = 0
        print("Test run: position counts are disabled.\n")
    else:
        print("Counting position reports from past 24 hours...")
        position_reports_24h = count_position_reports_24h()
        running_position_count = position_reports_24h
        print(f"Found {position_reports_24h:,} position reports in past 24 hours\n")
    
    # Generate initial KML file
    print("Generating initial KML file...")
    generate_kml_from_records()
    last_kml_write_time = time.time()
    print(f"KML file created: {kml_output_file}")
    
    # Generate initial 3D JPG visualization
    print("Generating initial 3D JPG visualization...")
    generate_3d_jpg_from_records()
    last_jpg_write_time = time.time()
    print(f"3D JPG created: {jpg_output_file}")
    
    # Skip initial heatmap generation (can hang on startup)
    # print("Generating initial heatmap...")
    # generate_heatmap()
    last_heatmap_write_time = time.time()
    # print(f"Heatmap created: {heatmap_output_file}\n")
    # Set tracker start time
    tracker_start_time = time.time()
    
    print("\n\033[96mAircraft Tracker Started\033[0m")
    print(f"Monitoring: {piaware_url}")
    print(f"Receiver: {receiver_version} @ {receiver_lat:.2f}, {receiver_lon:.2f}")
    print("Timeout: 30 seconds")
    print("\033[90mPress Ctrl+C to stop\033[0m\n")
    
    iteration = 0
    
    try:
        while True:
            iteration += 1

            if args.test_run and iteration > 5:  # Run for 5 iterations and exit if --test-run is enabled
                print("\n\033[93mTest run complete. Exiting.\033[0m")
                break
            
            # Fetch current aircraft
            current_aircraft = get_aircraft_data()
            
            if current_aircraft:
                # Update tracking
                update_aircraft_tracking(current_aircraft)
                
                # In read-only mode, skip all file I/O and S3 operations
                if args.read_only:
                    if iteration % 10 == 0: # Print a reminder every 10 seconds
                        print("\033[90m[Read-Only Mode: All file writing is disabled]\033[0m")
                    time.sleep(POLL_INTERVAL)
                    continue

                current_time = time.time()
                
                # Upload minute file to S3 every 60 seconds
                if s3_upload_enabled and current_time - last_minute_upload_time >= 60:
                    upload_minute_file_to_s3(args.s3_bucket, pending_aircraft)
                    pending_aircraft.clear() # Clear buffer after upload
                
                # Check if 10 minutes have passed since last KML write
                if current_time - last_kml_write_time >= 600:  # 600 seconds = 10 minutes
                    generate_kml_from_records()
                    last_kml_write_time = current_time
                
                # Check if 1 hour has passed since last JPG write
                if current_time - last_jpg_write_time >= 3600:  # 3600 seconds = 1 hour
                    generate_3d_jpg_from_records()
                    last_jpg_write_time = current_time
                
                # Check if 1 hour has passed since last heatmap write
                if current_time - last_heatmap_write_time >= 3600:  # 3600 seconds = 1 hour
                    generate_heatmap()
                    last_heatmap_write_time = current_time
                
                # Upload minute file to S3 (after pending aircraft flushed)
                if s3_upload_enabled and current_time - last_minute_upload_time >= 60:  # 60 seconds = 1 minute
                    upload_minute_file_to_s3(args.s3_bucket, pending_aircraft)
                    pending_aircraft.clear()  # Clear buffer after upload
                
                # Check if 1 minute has passed since last KML/other uploads
                if s3_upload_enabled and current_time - last_s3_upload_time >= 60:  # 60 seconds = 1 minute
                    upload_to_s3(args.s3_bucket, args.s3_kml_bucket)
                    # Also check for hourly rollup
                    rollup_and_cleanup_s3_files(args.s3_bucket)
                
                # Check if 1 minute has passed since last FlightAware URL upload
                if s3_upload_enabled and current_time - last_flightaware_upload_time >= 60:  # 60 seconds = 1 minute
                    if flightaware_urls_buffer:
                        upload_flightaware_urls_to_s3(args.s3_flightaware_bucket)
                
                # Report every iteration (1 second)
                if iteration % REPORT_INTERVAL == 0:
                    # Clear screen
                    os.system('cls' if os.name == 'nt' else 'clear')
                    
                    result = get_longest_visible_aircraft()
                    result_with_type = get_longest_visible_with_type()
                    result_slant = get_longest_slant_range()
                    
                    print("\033[96m=" * 70)
                    print("Aircraft Tracker - Live View")
                    print(f"Monitoring: {piaware_url}")
                    print(f"Update: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
                    print(f"S3: {s3_bucket_name} | Uploads: {s3_upload_count} | Last: {last_uploaded_file}")
                    print("=" * 70 + "\033[0m\n")
                    
                    print(f"Currently tracking: \033[93m{len(aircraft_tracking)}\033[0m aircraft")
                    print(f"Reception records: \033[95m{len(sector_altitude_records)}\033[0m sector+altitude combinations")
                    print(f"Position reports (24h): \033[96m{position_reports_24h:,}\033[0m")
                    print(f"Running position total: \033[96m{running_position_count:,}\033[0m")
                    print()
                    
                    # Real-time position statistics (this run only)
                    runtime = current_time - tracker_start_time if tracker_start_time > 0 else 0
                    positions_1min = len(positions_last_minute)
                    positions_10min = len(positions_last_10min)
                    positions_1hour = len(positions_last_hour)
                    positions_1day = len(positions_last_day)
                    
                    # Calculate rates (positions per minute)
                    rate_1min = positions_1min  # Already per minute
                    rate_10min = positions_10min / 10.0 if positions_10min > 0 else 0
                    rate_1hour = positions_1hour / 60.0 if positions_1hour > 0 else 0
                    rate_1day = positions_1day / 1440.0 if positions_1day > 0 else 0
                    
                    print(f"\033[96m┌─ Position Statistics (This Run) ────────────────────────┐\033[0m")
                    print(f"\033[96m│\033[0m Runtime:          {int(runtime//60)}m {int(runtime%60)}s{' '*(35)} \033[96m│\033[0m")
                    print(f"\033[96m│\033[0m Last minute:      {positions_1min:>5} positions  ({rate_1min:>6.1f}/min){' '*(10)} \033[96m│\033[0m")
                    print(f"\033[96m│\033[0m Last 10 minutes:  {positions_10min:>5} positions  ({rate_10min:>6.1f}/min){' '*(10)} \033[96m│\033[0m")
                    print(f"\033[96m│\033[0m Last hour:        {positions_1hour:>5} positions  ({rate_1hour:>6.1f}/min){' '*(10)} \033[96m│\033[0m")
                    print(f"\033[96m│\033[0m Last day:         {positions_1day:>5} positions  ({rate_1day:>6.1f}/min){' '*(10)} \033[96m│\033[0m")
                    print(f"\033[96m└─────────────────────────────────────────────────────────┘\033[0m")
                    print()
                    
                    # Display last S3 upload time
                    if s3_upload_enabled and last_s3_upload_time > 0:
                        last_upload_dt = datetime.fromtimestamp(last_s3_upload_time, tz=timezone.utc)
                        time_since_upload = current_time - last_s3_upload_time
                        print(f"Last S3 upload: \033[94m{last_upload_dt.strftime('%Y-%m-%d %H:%M:%S UTC')}\033[0m ({int(time_since_upload)}s ago)")
                    elif s3_upload_enabled:
                        print(f"Last S3 upload: \033[90mNever\033[0m")
                    
                    print(f"Total log size: \033[96m{total_log_size:.2f} MB\033[0m")
                    print()
                    
                    if result:
                        aircraft_info = result['aircraft']
                        duration_minutes = result['duration']
                        
                        # Convert duration to hr:min:sec
                        total_seconds = int(duration_minutes * 60)
                        hours = total_seconds // 3600
                        minutes = (total_seconds % 3600) // 60
                        seconds = total_seconds % 60
                        duration_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
                        
                        print("\033[92m┌─ Longest Visible Aircraft ─────────────────────────────────────┐\033[0m")
                        print(f"\033[92m│\033[0m Hex:          {aircraft_info['hex']:<48} \033[92m│\033[0m")
                        print(f"\033[92m│\033[0m Callsign:     {str(aircraft_info['flight']):<48} \033[92m│\033[0m")
                        print(f"\033[92m│\033[0m Airline:      {get_airline_from_callsign(str(aircraft_info['flight'])):<48} \033[92m│\033[0m")
                        print(f"\033[92m│\033[0m Registration: {str(aircraft_info.get('registration', 'N/A')):<48} \033[92m│\033[0m")
                        print(f"\033[92m│\033[0m Type:         {str(aircraft_info.get('type', 'N/A')):<48} \033[92m│\033[0m")
                        print(f"\033[92m│\033[0m Squawk:       {str(aircraft_info['squawk']):<48} \033[92m│\033[0m")
                        
                        alt_str = f"{aircraft_info['alt_baro']} ft" if aircraft_info['alt_baro'] != 'N/A' else "N/A"
                        print(f"\033[92m│\033[0m Altitude:     {alt_str:<48} \033[92m│\033[0m")
                        
                        spd_str = f"{aircraft_info['gs']} kt" if aircraft_info['gs'] != 'N/A' else "N/A"
                        print(f"\033[92m│\033[0m Speed:        {spd_str:<48} \033[92m│\033[0m")
                        
                        vs_str = f"{aircraft_info['baro_rate']} ft/min" if aircraft_info['baro_rate'] != 'N/A' else "N/A"
                        print(f"\033[92m│\033[0m Vertical Spd: {vs_str:<48} \033[92m│\033[0m")
                        
                        hdg_str = f"{aircraft_info['track']}°" if aircraft_info['track'] != 'N/A' else "N/A"
                        print(f"\033[92m│\033[0m Heading:      {hdg_str:<48} \033[92m│\033[0m")
                        
                        # Calculate bearing if we have coordinates
                        bearing_str = "N/A"
                        if is_valid_position(aircraft_info.get('lat'), aircraft_info.get('lon')) and \
                           receiver_lat != 0.0 and receiver_lon != 0.0:
                            try:
                                bearing = calculate_bearing(receiver_lat, receiver_lon,
                                                            aircraft_info['lat'], aircraft_info['lon'])
                                bearing_str = f"{bearing:.1f}°"
                            except Exception:
                                pass
                        print(f"\033[92m│\033[0m Bearing:      {bearing_str:<48} \033[92m│\033[0m")

                        # Display Lat/Lon (only if both are valid)
                        if is_valid_position(aircraft_info.get('lat'), aircraft_info.get('lon')):
                            lat_str = f"{float(aircraft_info['lat']):.6f}"
                            lon_str = f"{float(aircraft_info['lon']):.6f}"
                        else:
                            lat_str = 'N/A'
                            lon_str = 'N/A'
                        print(f"\033[92m│\033[0m Latitude:     {lat_str:<48} \033[92m│\033[0m")
                        print(f"\033[92m│\033[0m Longitude:    {lon_str:<48} \033[92m│\033[0m")
                        
                        # Display both positional and slant distance
                        if aircraft_info['r_dst'] != 'N/A':
                            pos_dist = aircraft_info['r_dst']
                            print(f"\033[92m│\033[0m Pos Distance: {pos_dist} nm{' ':<38} \033[92m│\033[0m")
                            # Calculate slant distance if we have altitude
                            if aircraft_info.get('alt_baro') != 'N/A':
                                try:
                                    slant_dist = calculate_slant_distance(pos_dist, aircraft_info['alt_baro'])
                                    print(f"\033[92m│\033[0m Slant Dist:   {slant_dist:.2f} nm{' ':<38} \033[92m│\033[0m")
                                except:
                                    pass
                        
                        print(f"\033[92m│\033[0m Messages:     {str(aircraft_info['messages']):<48} \033[92m│\033[0m")
                        
                        age_str = f"{aircraft_info['seen']}s" if aircraft_info['seen'] != 'N/A' else "N/A"
                        print(f"\033[92m│\033[0m Last Age:     {age_str:<48} \033[92m│\033[0m")
                        
                        print(f"\033[92m│\033[0m First Seen:   {aircraft_info['first_seen'].strftime('%Y-%m-%d %H:%M:%S UTC'):<48} \033[92m│\033[0m")
                        print(f"\033[92m│\033[0m Last Seen:    {aircraft_info['last_seen'].strftime('%Y-%m-%d %H:%M:%S UTC'):<48} \033[92m│\033[0m")
                        print(f"\033[92m│\033[0m Duration:     {duration_str}{' ':<40} \033[92m│\033[0m")
                        print("\033[92m└────────────────────────────────────────────────────────────────┘\033[0m")
                    
                    # Display longest visible aircraft WITH known type
                    if result_with_type:
                        aircraft_info2 = result_with_type['aircraft']
                        duration_minutes2 = result_with_type['duration']
                        
                        # Convert duration to hr:min:sec
                        total_seconds2 = int(duration_minutes2 * 60)
                        hours2 = total_seconds2 // 3600
                        minutes2 = (total_seconds2 % 3600) // 60
                        seconds2 = total_seconds2 % 60
                        duration_str2 = f"{hours2:02d}:{minutes2:02d}:{seconds2:02d}"
                        
                        print()
                        print("\033[94m┌─ Longest Visible Aircraft (With Type) ────────────────────────┐\033[0m")
                        print(f"\033[94m│\033[0m Hex:          {aircraft_info2['hex']:<48} \033[94m│\033[0m")
                        print(f"\033[94m│\033[0m Callsign:     {str(aircraft_info2['flight']):<48} \033[94m│\033[0m")
                        print(f"\033[94m│\033[0m Airline:      {get_airline_from_callsign(str(aircraft_info2['flight'])):<48} \033[94m│\033[0m")
                        print(f"\033[94m│\033[0m Registration: {str(aircraft_info2.get('registration', 'N/A')):<48} \033[94m│\033[0m")
                        print(f"\033[94m│\033[0m Type:         {str(aircraft_info2.get('type', 'N/A')):<48} \033[94m│\033[0m")
                        print(f"\033[94m│\033[0m Squawk:       {str(aircraft_info2['squawk']):<48} \033[94m│\033[0m")
                        
                        alt_str2 = f"{aircraft_info2['alt_baro']} ft" if aircraft_info2['alt_baro'] != 'N/A' else "N/A"
                        print(f"\033[94m│\033[0m Altitude:     {alt_str2:<48} \033[94m│\033[0m")
                        
                        spd_str2 = f"{aircraft_info2['gs']} kt" if aircraft_info2['gs'] != 'N/A' else "N/A"
                        print(f"\033[94m│\033[0m Speed:        {spd_str2:<48} \033[94m│\033[0m")
                        
                        vs_str2 = f"{aircraft_info2['baro_rate']} ft/min" if aircraft_info2['baro_rate'] != 'N/A' else "N/A"
                        print(f"\033[94m│\033[0m Vertical Spd: {vs_str2:<48} \033[94m│\033[0m")
                        
                        hdg_str2 = f"{aircraft_info2['track']}°" if aircraft_info2['track'] != 'N/A' else "N/A"
                        print(f"\033[94m│\033[0m Heading:      {hdg_str2:<48} \033[94m│\033[0m")
                        
                        # Calculate bearing if we have coordinates
                        bearing_str2 = "N/A"
                        if is_valid_position(aircraft_info2.get('lat'), aircraft_info2.get('lon')) and \
                           receiver_lat != 0.0 and receiver_lon != 0.0:
                            try:
                                bearing2 = calculate_bearing(receiver_lat, receiver_lon,
                                                            aircraft_info2['lat'], aircraft_info2['lon'])
                                bearing_str2 = f"{bearing2:.1f}°"
                            except Exception:
                                pass
                        print(f"\033[94m│\033[0m Bearing:      {bearing_str2:<48} \033[94m│\033[0m")

                        # Display Lat/Lon (only if both are valid)
                        if is_valid_position(aircraft_info2.get('lat'), aircraft_info2.get('lon')):
                            lat_str2 = f"{float(aircraft_info2['lat']):.6f}"
                            lon_str2 = f"{float(aircraft_info2['lon']):.6f}"
                        else:
                            lat_str2 = 'N/A'
                            lon_str2 = 'N/A'
                        print(f"\033[94m│\033[0m Latitude:     {lat_str2:<48} \033[94m│\033[0m")
                        print(f"\033[94m│\033[0m Longitude:    {lon_str2:<48} \033[94m│\033[0m")
                        
                        # Display both positional and slant distance
                        if aircraft_info2['r_dst'] != 'N/A':
                            pos_dist2 = aircraft_info2['r_dst']
                            print(f"\033[94m│\033[0m Pos Distance: {pos_dist2} nm{' ':<38} \033[94m│\033[0m")
                            # Calculate slant distance if we have altitude
                            if aircraft_info2.get('alt_baro') != 'N/A':
                                try:
                                    slant_dist2 = calculate_slant_distance(pos_dist2, aircraft_info2['alt_baro'])
                                    print(f"\033[94m│\033[0m Slant Dist:   {slant_dist2:.2f} nm{' ':<38} \033[94m│\033[0m")
                                except:
                                    pass
                        
                        print(f"\033[94m│\033[0m Messages:     {str(aircraft_info2['messages']):<48} \033[94m│\033[0m")
                        
                        age_str2 = f"{aircraft_info2['seen']}s" if aircraft_info2['seen'] != 'N/A' else "N/A"
                        print(f"\033[94m│\033[0m Last Age:     {age_str2:<48} \033[94m│\033[0m")
                        
                        print(f"\033[94m│\033[0m First Seen:   {aircraft_info2['first_seen'].strftime('%Y-%m-%d %H:%M:%S UTC'):<48} \033[94m│\033[0m")
                        print(f"\033[94m│\033[0m Last Seen:    {aircraft_info2['last_seen'].strftime('%Y-%m-%d %H:%M:%S UTC'):<48} \033[94m│\033[0m")
                        print(f"\033[94m│\033[0m Duration:     {duration_str2}{' ':<40} \033[94m│\033[0m")
                        print("\033[94m└────────────────────────────────────────────────────────────────┘\033[0m")
                    
                    # Display longest slant range aircraft
                    if result_slant:
                        aircraft_info3 = result_slant['aircraft']
                        slant_distance = result_slant['slant_distance']
                        
                        print()
                        print("\033[93m┌─ Longest Slant Range Aircraft ──────────────────────────────┐\033[0m")
                        print(f"\033[93m│\033[0m Hex:          {aircraft_info3['hex']:<48} \033[93m│\033[0m")
                        print(f"\033[93m│\033[0m Callsign:     {str(aircraft_info3['flight']):<48} \033[93m│\033[0m")
                        print(f"\033[93m│\033[0m Airline:      {get_airline_from_callsign(str(aircraft_info3['flight'])):<48} \033[93m│\033[0m")
                        print(f"\033[93m│\033[0m Registration: {str(aircraft_info3.get('registration', 'N/A')):<48} \033[93m│\033[0m")
                        print(f"\033[93m│\033[0m Type:         {str(aircraft_info3.get('type', 'N/A')):<48} \033[93m│\033[0m")
                        
                        alt_str3 = f"{aircraft_info3['alt_baro']} ft" if aircraft_info3['alt_baro'] != 'N/A' else "N/A"
                        print(f"\033[93m│\033[0m Altitude:     {alt_str3:<48} \033[93m│\033[0m")
                        
                        vs_str3 = f"{aircraft_info3['baro_rate']} ft/min" if aircraft_info3['baro_rate'] != 'N/A' else "N/A"
                        print(f"\033[93m│\033[0m Vertical Spd: {vs_str3:<48} \033[93m│\033[0m")
                        
                        hdg_str3 = f"{aircraft_info3['track']}°" if aircraft_info3['track'] != 'N/A' else "N/A"
                        print(f"\033[93m│\033[0m Heading:      {hdg_str3:<48} \033[93m│\033[0m")
                        
                        # Calculate bearing if we have coordinates
                        bearing_str3 = "N/A"
                        if is_valid_position(aircraft_info3.get('lat'), aircraft_info3.get('lon')) and \
                           receiver_lat != 0.0 and receiver_lon != 0.0:
                            try:
                                bearing3 = calculate_bearing(receiver_lat, receiver_lon,
                                                            aircraft_info3['lat'], aircraft_info3['lon'])
                                bearing_str3 = f"{bearing3:.1f}°"
                            except Exception:
                                pass
                        print(f"\033[93m│\033[0m Bearing:      {bearing_str3:<48} \033[93m│\033[0m")

                        # Display Lat/Lon (only if both are valid)
                        if is_valid_position(aircraft_info3.get('lat'), aircraft_info3.get('lon')):
                            lat_str3 = f"{float(aircraft_info3['lat']):.6f}"
                            lon_str3 = f"{float(aircraft_info3['lon']):.6f}"
                        else:
                            lat_str3 = 'N/A'
                            lon_str3 = 'N/A'
                        print(f"\033[93m│\033[0m Latitude:     {lat_str3:<48} \033[93m│\033[0m")
                        print(f"\033[93m│\033[0m Longitude:    {lon_str3:<48} \033[93m│\033[0m")
                        
                        # Show both positional and slant for this aircraft
                        pos_dist3 = aircraft_info3.get('r_dst', 'N/A')
                        if pos_dist3 != 'N/A':
                            print(f"\033[93m│\033[0m Pos Distance: {pos_dist3} nm{' ':<38} \033[93m│\033[0m")
                            print(f"\033[93m│\033[0m Slant Dist:   {slant_distance:.2f} nm{' ':<38} \033[93m│\033[0m")
                        
                        spd_str3 = f"{aircraft_info3['gs']} kt" if aircraft_info3['gs'] != 'N/A' else "N/A"
                        print(f"\033[93m│\033[0m Speed:        {spd_str3:<48} \033[93m│\033[0m")
                        
                        vs_str3b = f"{aircraft_info3['baro_rate']} ft/min" if aircraft_info3['baro_rate'] != 'N/A' else "N/A"
                        print(f"\033[93m│\033[0m Vertical Spd: {vs_str3b:<48} \033[93m│\033[0m")
                        
                        record_time = result_slant.get('timestamp')
                        if record_time:
                            time_str = record_time.strftime('%Y-%m-%d %H:%M:%S UTC')
                            print(f"\033[93m│\033[0m Record Set:   {time_str:<48} \033[93m│\033[0m")
                        print("\033[93m└────────────────────────────────────────────────────────────────┘\033[0m")
                    
                    print("\n\033[90mPress Ctrl+C to stop\033[0m")
            
            time.sleep(POLL_INTERVAL)
            
    except KeyboardInterrupt:
        print("\n\n\033[93mShutting down...\033[0m")
        
        # In read-only mode, skip all final file write operations
        if not args.read_only:
            # Upload any remaining data in the buffer one last time
            if s3_upload_enabled and pending_aircraft:
                print(f"Uploading {len(pending_aircraft)} pending aircraft records to S3...")
                upload_minute_file_to_s3(args.s3_bucket, pending_aircraft)
            
            # Recalculate 24-hour position count after writing
            print("Recalculating 24-hour position count...")
            position_reports_24h = count_position_reports_24h()
            
            # Generate final outputs
            print("Generating final KML file...")
            generate_kml_from_records()
            print("Generating final 3D JPG visualization...")
            generate_3d_jpg_from_records()
            print("Generating final heatmap...")
            generate_heatmap()

            # Upload final KMLs to S3
            if s3_upload_enabled:
                print("Uploading final KML files to S3...")
                upload_to_s3(s3_bucket_name, s3_kml_bucket_name)
        
        # Clear buffer at shutdown
            pending_aircraft.clear()
        print("\n\033[92mAircraft Tracker Stopped\033[0m")
        print(f"Total aircraft tracked: {len(aircraft_tracking)}")
        print(f"Position reports (24h): {position_reports_24h:,}")
        print(f"Running position total: {running_position_count:,}")


if __name__ == "__main__":
    main()
