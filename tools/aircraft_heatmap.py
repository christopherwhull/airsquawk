#!/usr/bin/env python3
"""
Aircraft Heatmap Generator

Generates 2D heatmaps from aircraft position data stored in JSON files.
Used by aircraft_tracker.py to create visualization strips.
"""

import argparse
import glob
import json
import math
import os
import sys
from typing import Dict, List, Tuple, Optional

try:
    import matplotlib
    matplotlib.use('Agg')  # Use non-interactive backend
    import matplotlib.pyplot as plt
    import matplotlib.patches as patches
    from matplotlib.colors import LinearSegmentedColormap
    MATPLOTLIB_AVAILABLE = True
except ImportError:
    MATPLOTLIB_AVAILABLE = False
    print("Error: matplotlib is required for heatmap generation")
    sys.exit(1)

def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two points using Haversine formula."""
    R = 6371  # Earth's radius in kilometers

    lat1_rad = math.radians(lat1)
    lon1_rad = math.radians(lon1)
    lat2_rad = math.radians(lat2)
    lon2_rad = math.radians(lon2)

    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad

    a = math.sin(dlat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

    return R * c * 0.539957  # Convert to nautical miles

def load_position_data(pattern: str, piaware_server: str) -> List[Dict]:
    """Load position data from JSON files matching the pattern."""
    positions = []

    # Parse piaware server to get receiver coordinates
    # This is a simplified approach - in reality you'd need to query the server
    receiver_lat = 0.0  # Default, should be passed or looked up
    receiver_lon = 0.0

    try:
        # Try to get receiver position from the first file
        files = glob.glob(pattern)
        if files:
            with open(files[0], 'r') as f:
                sample_data = json.load(f)
                if isinstance(sample_data, list) and sample_data:
                    # Look for receiver position in the data
                    for record in sample_data:
                        if 'receiver_lat' in record and 'receiver_lon' in record:
                            receiver_lat = record['receiver_lat']
                            receiver_lon = record['receiver_lon']
                            break
    except Exception as e:
        print(f"Warning: Could not determine receiver position: {e}")

    for filepath in glob.glob(pattern):
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)

                if isinstance(data, list):
                    for record in data:
                        if isinstance(record, dict) and 'lat' in record and 'lon' in record:
                            # Calculate distance from receiver if we have coordinates
                            if receiver_lat != 0.0 and receiver_lon != 0.0:
                                distance = calculate_distance(
                                    receiver_lat, receiver_lon,
                                    record['lat'], record['lon']
                                )
                                record['distance_nm'] = distance

                            positions.append(record)

        except Exception as e:
            print(f"Warning: Could not load {filepath}: {e}")
            continue

    return positions

def create_heatmap(positions: List[Dict], cell_size_nm: int, output_file: str) -> None:
    """Create a heatmap from position data."""

    if not positions:
        print("No position data to create heatmap")
        return

    # Extract coordinates
    lats = [p['lat'] for p in positions if 'lat' in p]
    lons = [p['lon'] for p in positions if 'lon' in p]

    if not lats or not lons:
        print("No valid coordinates found")
        return

    # Calculate bounds with some padding
    lat_min, lat_max = min(lats), max(lats)
    lon_min, lon_max = min(lons), max(lons)

    # Add padding (about 10% of the range)
    lat_padding = (lat_max - lat_min) * 0.1
    lon_padding = (lon_max - lon_min) * 0.1

    lat_min -= lat_padding
    lat_max += lat_padding
    lon_min -= lon_padding
    lon_max += lon_padding

    # Convert cell size from nautical miles to approximate degrees
    # 1 degree latitude ≈ 60 NM, 1 degree longitude varies with latitude
    avg_lat = (lat_min + lat_max) / 2
    cell_size_lat = cell_size_nm / 60.0  # 1 degree lat = 60 NM
    cell_size_lon = cell_size_nm / (60.0 * math.cos(math.radians(avg_lat)))  # Adjust for longitude

    # Create grid
    lat_bins = math.ceil((lat_max - lat_min) / cell_size_lat)
    lon_bins = math.ceil((lon_max - lon_min) / cell_size_lon)

    # Initialize grid
    grid = [[0 for _ in range(lon_bins)] for _ in range(lat_bins)]

    # Count positions in each cell
    max_count = 0
    for pos in positions:
        if 'lat' not in pos or 'lon' not in pos:
            continue

        lat, lon = pos['lat'], pos['lon']

        if not (lat_min <= lat <= lat_max and lon_min <= lon <= lon_max):
            continue

        lat_idx = int((lat - lat_min) / cell_size_lat)
        lon_idx = int((lon - lon_min) / cell_size_lon)

        # Ensure indices are within bounds
        lat_idx = min(max(lat_idx, 0), lat_bins - 1)
        lon_idx = min(max(lon_idx, 0), lon_bins - 1)

        grid[lat_idx][lon_idx] += 1
        max_count = max(max_count, grid[lat_idx][lon_idx])

    # Create plot
    fig, ax = plt.subplots(figsize=(12, 8))

    # Create custom colormap (blue to red)
    colors = ['#000080', '#0000FF', '#0080FF', '#00FFFF', '#80FF80', '#FFFF00', '#FF8000', '#FF0000', '#800000']
    cmap = LinearSegmentedColormap.from_list('custom_blues', colors, N=256)

    # Plot heatmap
    im = ax.imshow(grid, extent=[lon_min, lon_max, lat_min, lat_max],
                   origin='lower', cmap=cmap, aspect='auto', alpha=0.7)

    # Add colorbar
    cbar = plt.colorbar(im, ax=ax, shrink=0.8)
    cbar.set_label('Aircraft Positions')

    # Add grid lines
    ax.grid(True, alpha=0.3, color='white')

    # Set labels and title
    ax.set_xlabel('Longitude')
    ax.set_ylabel('Latitude')
    ax.set_title(f'Aircraft Position Heatmap\n{len(positions)} positions, {cell_size_nm} NM cells')

    # Add statistics text
    stats_text = f'Total Positions: {len(positions)}\nMax per cell: {max_count}\nCell size: {cell_size_nm} NM'
    ax.text(0.02, 0.98, stats_text, transform=ax.transAxes,
            verticalalignment='top', fontsize=10,
            bbox=dict(boxstyle='round', facecolor='white', alpha=0.8))

    plt.tight_layout()
    plt.savefig(output_file, dpi=150, bbox_inches='tight')
    plt.close()

    print(f"Heatmap saved to {output_file}")

def main():
    parser = argparse.ArgumentParser(description='Generate aircraft position heatmap')
    parser.add_argument('--piaware-server', required=True,
                       help='PiAware server address (host:port)')
    parser.add_argument('--output', required=True,
                       help='Output image file path')
    parser.add_argument('--cell-size', type=int, default=5,
                       help='Cell size in nautical miles (default: 5)')
    parser.add_argument('--pattern', required=True,
                       help='File pattern for JSON position data files')

    args = parser.parse_args()

    print(f"Generating heatmap with {args.cell_size} NM cells...")
    print(f"Loading data from: {args.pattern}")

    # Load position data
    positions = load_position_data(args.pattern, args.piaware_server)

    if not positions:
        print("No position data found")
        sys.exit(1)

    print(f"Loaded {len(positions)} positions")

    # Create heatmap
    create_heatmap(positions, args.cell_size, args.output)

if __name__ == '__main__':
    main()