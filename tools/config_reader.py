"""
Config Reader for Node.js config.js
Reads configuration values from the main config.js file
"""
import re
import os

_config = None  # Global config cache

def read_config():
    """
    Parse config.js and extract configuration values
    Returns a dictionary with configuration settings
    """
    config_path = os.path.join(os.path.dirname(__file__), '..', 'config.js')
    
    config = {
        's3_endpoint': 'http://localhost:9000',
        's3_region': 'us-east-1',
        's3_access_key': 'minioadmin',
        's3_secret_key': 'minioadmin123',
        'read_bucket': 'aircraft-data',
        'write_bucket': 'aircraft-data-new',
        'piaware_url': 'http://192.168.0.178:8080/data/aircraft.json'
    }
    
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
            # Extract S3 endpoint
            match = re.search(r"endpoint:\s*process\.env\.S3_ENDPOINT\s*\|\|\s*'([^']+)'", content)
            if match:
                config['s3_endpoint'] = match.group(1)
            
            # Extract S3 region
            match = re.search(r"region:\s*process\.env\.S3_REGION\s*\|\|\s*'([^']+)'", content)
            if match:
                config['s3_region'] = match.group(1)
            
            # Extract S3 access key
            match = re.search(r"accessKeyId:\s*process\.env\.S3_ACCESS_KEY\s*\|\|\s*'([^']+)'", content)
            if match:
                config['s3_access_key'] = match.group(1)
            
            # Extract S3 secret key
            match = re.search(r"secretAccessKey:\s*process\.env\.S3_SECRET_KEY\s*\|\|\s*'([^']+)'", content)
            if match:
                config['s3_secret_key'] = match.group(1)
            
            # Extract read bucket
            match = re.search(r"readBucket:\s*process\.env\.READ_BUCKET\s*\|\|\s*'([^']+)'", content)
            if match:
                config['read_bucket'] = match.group(1)
            
            # Extract write bucket
            match = re.search(r"writeBucket:\s*process\.env\.WRITE_BUCKET\s*\|\|\s*'([^']+)'", content)
            if match:
                config['write_bucket'] = match.group(1)
            
            # Extract PiAware URL
            match = re.search(r"piAwareUrl:\s*process\.env\.PIAWARE_URL\s*\|\|\s*'([^']+)'", content)
            if match:
                config['piaware_url'] = match.group(1)
                
    except FileNotFoundError:
        print(f"Warning: config.js not found at {config_path}, using defaults")
    except Exception as e:
        print(f"Warning: Error reading config.js: {e}, using defaults")
    
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
    print("Configuration loaded from config.js:")
    for key, value in cfg.items():
        if 'secret' in key or 'key' in key:
            print(f"  {key}: {'*' * len(str(value))}")
        else:
            print(f"  {key}: {value}")
