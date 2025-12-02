def clear_pending_aircraft():
	"""Clear the buffer of pending aircraft position records."""
	global pending_aircraft
	pending_aircraft.clear()
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
current_file: str = ""
previous_file: str = ""
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
s3_upload_enabled: bool = False  # Whether S3 uploads are enabled
last_flightaware_upload_time: float = 0.0  # Last FlightAware URL upload timestamp
flightaware_urls_buffer: List[str] = []  # Buffer for FlightAware URLs to upload
aircraft_type_cache_age_days: int = 30  # Days before refreshing type database cache
last_minute_upload_time: float = 0.0  # Last per-minute file upload timestamp
last_hourly_rollup_hour: int = -1  # Last hour when rollup was performed

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
            
			# If not in live data or history, try the S3 ICAO cache.
			# Prefer cached values when the live value is missing or 'N/A'.
			cached_data = get_icao_cache_from_s3(hex_code)
			if cached_data:
				# Prefer cached registration if live registration is missing
				if registration in (None, 'N/A', ''):
					registration = cached_data.get('registration', registration)

				# Prefer cached aircraft type if live type is missing
				if aircraft_type in (None, 'N/A', ''):
					aircraft_type = cached_data.get('type', aircraft_type)
            
			# If not in live data, history, or cache, lookup from static database
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
            
			aircraft_tracking[hex_code] = {
				'first_seen': now,
				'last_seen': now,
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
				'position_timestamp': 0,
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
	"""Calculate total size of all aircraft log files in S3 bucket from last 24 hours in MB."""
	try:
		if not s3_upload_enabled or s3_client is None:
			return 0.0
			
		total_bytes = 0
		cutoff_time = datetime.now(timezone.utc) - timedelta(hours=24)
		
		# List all objects in the aircraft-data bucket
		paginator = s3_client.get_paginator('list_objects_v2')
		page_iterator = paginator.paginate(Bucket='aircraft-data')
		
		for page in page_iterator:
			if 'Contents' in page:
				for obj in page['Contents']:
					# Check if file was modified within last 24 hours
					if obj['LastModified'] >= cutoff_time:
						total_bytes += obj['Size']
		
		# Convert to MB
		return total_bytes / (1024 * 1024)
	except Exception as e:
		print(f"\033[91mError calculating log size from S3: {e}\033[0m")
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
			print(f"Attempting to load reception records from S3 bucket: {s3_reception_bucket_name}")
			obj = s3_client.get_object(Bucket=s3_reception_bucket_name, Key=reception_record_file)
			content = obj['Body'].read().decode('utf-8')
			lines = content.splitlines()
			print(f"Successfully loaded {reception_record_file} from S3.")
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
            
			# Process current aircraft
			for aircraft in current_aircraft:
				hex_code = aircraft.get('hex')
				if not hex_code:
					continue

				current_hex_codes.add(hex_code)

				# Always create a new position record for every aircraft in every polling cycle
				flight = aircraft.get('flight', '').strip() if aircraft.get('flight') else 'N/A'
				squawk = aircraft.get('squawk', 'N/A')
				registration = aircraft.get('r', 'N/A')
				aircraft_type = aircraft.get('t', 'N/A')
				distance = aircraft.get('r_dst', 'N/A')
				lat = aircraft.get('lat') if aircraft.get('lat') not in (None, 'N/A') else None
				lon = aircraft.get('lon') if aircraft.get('lon') not in (None, 'N/A') else None
				alt_baro = aircraft.get('alt_baro') if aircraft.get('alt_baro') not in (None, 'N/A') else None
				gs = aircraft.get('gs') if aircraft.get('gs') not in (None, 'N/A') else None
				baro_rate = aircraft.get('baro_rate') if aircraft.get('baro_rate') not in (None, 'N/A') else None
				track_val = aircraft.get('track') if aircraft.get('track') not in (None, 'N/A') else None
				messages = aircraft.get('messages', 0)
				seen = aircraft.get('seen') if aircraft.get('seen') not in (None, 'N/A') else None
				rssi = aircraft.get('rssi') if aircraft.get('rssi') not in (None, 'N/A') else None
				dbFlags = aircraft.get('dbFlags', 0)
				position_timestamp = current_timestamp

				# Count this position report if aircraft has valid position
				if is_valid_position(lat, lon):
					running_position_count += 1
					track_position_for_stats(current_timestamp)

				# Build a new position record for this polling cycle
				position_record = {
					'timestamp': now,
					'hex': hex_code,
					'flight': flight,
					'registration': registration if registration != 'N/A' else None,
					'type': aircraft_type if aircraft_type != 'N/A' else None,
					'squawk': squawk if squawk != 'N/A' else None,
					'alt_baro': alt_baro,
					'gs': gs,
					'baro_rate': baro_rate,
					'track': track_val,
					'messages': messages,
					'seen': seen,
					'rssi': rssi,
					'lat': lat,
					'lon': lon,
					'r_dst': distance if distance not in (None, 'N/A') else None,
					'dbFlags': dbFlags,
					'position_timestamp': position_timestamp,
					'data_quality': 'GPS' if is_valid_position(lat, lon) else 'No position'
				}
				pending_aircraft.append(position_record)
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

		kml_content.append('</Document>')
		kml_content.append('</kml>')
		with open(kml_output_file, 'w', encoding='utf-8') as f:
			f.write('\n'.join(kml_content))
	except Exception as e:
		print(f"\033[91mError generating KML: {e}\033[0m")
