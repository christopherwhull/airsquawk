#!/usr/bin/env python3
"""
Combine Heatmaps Script

Combines multiple heatmap images into a single horizontal strip.
Used by aircraft_tracker.py to create visualization strips from individual cell-size heatmaps.
"""

import argparse
import sys
from typing import List

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    print("Error: Pillow (PIL) is required for image processing")
    print("Install with: pip install Pillow")
    sys.exit(1)

def combine_heatmaps(image_files: List[str], output_file: str) -> None:
    """Combine multiple heatmap images into a horizontal strip."""

    if len(image_files) != 4:
        print(f"Error: Expected 4 images, got {len(image_files)}")
        sys.exit(1)

    # Open all images
    images = []
    for img_file in image_files:
        try:
            img = Image.open(img_file)
            images.append(img)
        except Exception as e:
            print(f"Error opening {img_file}: {e}")
            sys.exit(1)

    # Assume all images have the same dimensions
    width, height = images[0].size

    # Create a new image wide enough for all 4 images side by side
    combined_width = width * 4
    combined_height = height

    # Create new image with white background
    combined_image = Image.new('RGB', (combined_width, combined_height), 'white')

    # Paste each image side by side
    for i, img in enumerate(images):
        x_offset = i * width
        combined_image.paste(img, (x_offset, 0))

    # Save the combined image
    combined_image.save(output_file, 'JPEG', quality=95)
    print(f"Combined heatmap strip saved to {output_file}")

    # Close all images
    for img in images:
        img.close()
    combined_image.close()

def main():
    parser = argparse.ArgumentParser(description='Combine multiple heatmap images into a strip')
    parser.add_argument('images', nargs=4,
                       help='Four heatmap image files to combine (1nm, 10nm, 25nm, 100nm)')
    parser.add_argument('output',
                       help='Output combined image file')

    args = parser.parse_args()

    print(f"Combining {len(args.images)} heatmaps into strip...")
    combine_heatmaps(args.images, args.output)

if __name__ == '__main__':
    main()