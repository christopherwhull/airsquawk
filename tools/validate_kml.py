#!/usr/bin/env python3
"""Simple KML validator: checks basic structure and coordinate formats."""
import sys
import xml.etree.ElementTree as ET

def validate_kml(path: str) -> int:
    try:
        tree = ET.parse(path)
        root = tree.getroot()
    except ET.ParseError as e:
        print(f"XML parse error: {e}")
        return 2
    except Exception as e:
        print(f"Error reading file: {e}")
        return 2

    # KML namespace handling
    ns = {'kml': 'http://www.opengis.net/kml/2.2'}
    if not root.tag.endswith('kml'):
        print('Root element is not <kml>')
        return 1

    doc = root.find('kml:Document', ns) or root.find('Document')
    if doc is None:
        print('No <Document> element found')
        return 1

    placemarks = doc.findall('.//kml:Placemark', ns) or doc.findall('.//Placemark')
    if not placemarks:
        print('Warning: no <Placemark> elements found')

    errors = 0
    for i, pm in enumerate(placemarks, start=1):
        coord = None
        # Robustly find coordinates element regardless of namespace
        for e in pm.iter():
            if e.tag.endswith('coordinates'):
                coord = e
                break
        if coord is None or not coord.text:
            print(f'Placemark {i}: missing <coordinates>')
            errors += 1
            continue
        # Validate comma-separated lon,lat[,alt]
        parts = coord.text.strip().split(',')
        if len(parts) < 2:
            print(f'Placemark {i}: coordinates malformed: "{coord.text.strip()}"')
            errors += 1
            continue
        try:
            lon = float(parts[0])
            lat = float(parts[1])
            if len(parts) >= 3 and parts[2].strip() != '':
                float(parts[2])
        except ValueError:
            print(f'Placemark {i}: coordinates contain non-numeric values: "{coord.text.strip()}"')
            errors += 1

    if errors:
        print(f'Validation completed with {errors} error(s).')
        return 1

    print('KML basic validation: OK')
    return 0

def main():
    if len(sys.argv) < 2:
        print('Usage: validate_kml.py <file.kml>')
        sys.exit(2)
    path = sys.argv[1]
    rc = validate_kml(path)
    sys.exit(rc)

if __name__ == '__main__':
    main()
