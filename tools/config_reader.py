"""
Config Reader for config.json
Reads configuration values from the main config.json file
"""
import json
import os
import re

_config = None  # Global config cache

def read_config():
    """
    Parse config.json and extract configuration values
    Returns a dictionary with configuration settings
    """
    config_path = os.path.join(os.path.dirname(__file__), '..', 'config.json')

    config = {
        's3_endpoint': 'http://localhost:9000',
        's3_region': 'us-east-1',
        's3_access_key': 'minioadmin',
        's3_secret_key': 'minioadmin123',
        'read_bucket': 'aircraft-data',
        'write_bucket': 'aircraft-data-new',
        'piaware_url': 'http://192.168.0.161:8080/data/aircraft.json'
    }

    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            content = f.read()
            # Remove comments more carefully - only // not inside quotes
            # This regex matches // followed by anything until end of line, but only if not inside quotes
            content = re.sub(r'//(?=(?:(?:[^"]*"){2})*[^"]*$).*', '', content)
            # Remove trailing commas before } or ]
            content = re.sub(r',(\s*[}\]])', r'\1', content)
            data = json.loads(content)

            # Extract S3 settings
            s3 = data.get('s3', {})
            config['s3_endpoint'] = s3.get('endpoint', config['s3_endpoint'])
            config['s3_region'] = s3.get('region', config['s3_region'])
            credentials = s3.get('credentials', {})
            config['s3_access_key'] = credentials.get('accessKeyId', config['s3_access_key'])
            config['s3_secret_key'] = credentials.get('secretAccessKey', config['s3_secret_key'])

            # Extract bucket settings
            buckets = data.get('buckets', {})
            config['read_bucket'] = buckets.get('readBucket', config['read_bucket'])
            config['write_bucket'] = buckets.get('writeBucket', config['write_bucket'])

            # Extract server settings
            server = data.get('server', {})
            config['server'] = server

            # Extract PiAware URL
            data_source = data.get('dataSource', {})
            config['piaware_url'] = data_source.get('piAwareUrl', config['piaware_url'])

    except FileNotFoundError:
        print(f"Warning: config.json not found at {config_path}, using defaults")
    except Exception as e:
        print(f"Warning: Error reading config.json: {e}, using defaults")

    # Check for environment variable overrides
    config['s3_endpoint'] = os.environ.get('S3_ENDPOINT', config['s3_endpoint'])
    config['s3_region'] = os.environ.get('S3_REGION', config['s3_region'])
    config['s3_access_key'] = os.environ.get('S3_ACCESS_KEY', config['s3_access_key'])
    config['s3_secret_key'] = os.environ.get('S3_SECRET_KEY', config['s3_secret_key'])
    config['read_bucket'] = os.environ.get('READ_BUCKET', config['read_bucket'])
    config['write_bucket'] = os.environ.get('WRITE_BUCKET', config['write_bucket'])
    config['piaware_url'] = os.environ.get('PIAWARE_URL', config['piaware_url'])

    return config

# Singleton instance
_config = None

def get_config():
    """Get or create configuration singleton"""
    global _config
    if _config is None:
        _config = read_config()
    return _config

if __name__ == '__main__':
    # Test the config reader
    cfg = get_config()
    print("Configuration loaded from config.json:")
    for key, value in cfg.items():
        if 'secret' in key or 'key' in key:
            print(f"  {key}: {'*' * len(str(value))}")
        else:
            print(f"  {key}: {value}")
