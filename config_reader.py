# config_reader.py
"""
Provides get_config() for reading configuration values for S3 and other services.
"""
import os

def get_config():
    """
    Returns a dictionary of configuration values for S3 and related services.
    Reads from environment variables if set, otherwise uses defaults.
    """
    import json
    import re
    config_js_path = os.path.join(os.path.dirname(__file__), '..', 'config.js')
    config = {}
    try:
        with open(config_js_path, 'r', encoding='utf-8') as f:
            js = f.read()
            # Remove comments and module.exports
            js = re.sub(r'/\*.*?\*/', '', js, flags=re.DOTALL)
            js = re.sub(r'module\.exports\s*=\s*', '', js)
            # Replace JS true/false/null with Python equivalents
            js = js.replace('true', 'True').replace('false', 'False').replace('null', 'None')
            # Replace single quotes with double quotes for JSON compatibility
            js = js.replace("'", '"')
            # Remove trailing commas
            js = re.sub(r',([\s\}\]])', r'\1', js)
            # Try to parse as dict
            config = eval(js)
    except Exception:
        config = {}
    # S3 settings
    s3 = config.get('s3', {})
    buckets = config.get('buckets', {})
    return {
        's3_endpoint': s3.get('endpoint', 'http://localhost:9000'),
        's3_access_key': s3.get('credentials', {}).get('accessKeyId', 'minioadmin'),
        's3_secret_key': s3.get('credentials', {}).get('secretAccessKey', 'minioadmin123'),
        's3_bucket': buckets.get('readBucket', 'aircraft-data'),
        's3_prefix': buckets.get('s3Prefix', ''),
        's3_kml_bucket': os.environ.get('S3_KML_BUCKET', 'output-kmls'),
        's3_flightaware_bucket': os.environ.get('S3_FLIGHTAWARE_BUCKET', 'flighturls'),
        's3_reception_bucket': os.environ.get('S3_RECEPTION_BUCKET', 'piaware-reception-data'),
        's3_icao_cache_bucket': os.environ.get('S3_ICAO_CACHE_BUCKET', 'icao-hex-cache'),
        's3_history_hours': int(os.environ.get('S3_HISTORY_HOURS', '24')),
    }
