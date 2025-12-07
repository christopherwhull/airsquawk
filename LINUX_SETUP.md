# Aircraft Dashboard - Linux Installation & Setup Guide

This guide covers installation and setup of the Aircraft Dashboard on Linux systems.

## Prerequisites

- **Node.js** 14+ (check: `node --version`)
- **npm** (usually comes with Node.js)
- **MinIO/S3** running and accessible
- **PiAware** running on your network

### Install Node.js on Linux

**Ubuntu/Debian:**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Fedora/RHEL/CentOS:**
```bash
sudo dnf install nodejs
```

**Arch:**
```bash
sudo pacman -S nodejs npm
```

## Installation Steps

1. **Clone the repository:**
```bash
git clone https://github.com/christopherwhull/aircraft-dashboard.git
cd aircraft-dashboard
```

2. **Install dependencies:**
```bash
npm install
```

3. **Configure the dashboard:**
Edit `config.js` with your settings:
```bash
nano config.js
```

Or use environment variables:
```bash
export PIAWARE_URL="http://your-piaware:8080/data/aircraft.json"
export S3_ENDPOINT="http://localhost:9000"
export S3_ACCESS_KEY="your-key"
export S3_SECRET_KEY="your-secret"
```

4. **Test the server:**
```bash
node server.js
```

Access at `http://localhost:3002` and check for errors. Press Ctrl+C to stop.

## Running as a Systemd Service

For production deployments, run the dashboard as a systemd service.

### 1. Install to system directory

```bash
# Copy files to /opt/
sudo mkdir -p /opt/aircraft-dashboard
sudo cp -r . /opt/aircraft-dashboard/
cd /opt/aircraft-dashboard
sudo npm install --production
```

### 2. Create service user (optional but recommended)

```bash
sudo useradd -r -s /bin/false piaware
sudo chown -R piaware:piaware /opt/aircraft-dashboard
```

If MinIO is running locally and needs access:
```bash
sudo usermod -a -G minio piaware
```

### 3. Install systemd service file

```bash
sudo cp aircraft-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### 4. Configure environment variables

Edit the service file to add configuration:
```bash
sudo nano /etc/systemd/system/aircraft-dashboard.service
```

Add environment variables under `[Service]`:
```ini
[Service]
...
Environment="PIAWARE_URL=http://192.168.0.161:8080/data/aircraft.json"
Environment="S3_ENDPOINT=http://localhost:9000"
Environment="S3_ACCESS_KEY=minioadmin"
Environment="S3_SECRET_KEY=minioadmin123"
...
```

Or use an environment file:
```bash
# Create /etc/default/aircraft-dashboard
sudo nano /etc/default/aircraft-dashboard
```

Add:
```bash
PIAWARE_URL=http://192.168.0.161:8080/data/aircraft.json
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin123
```

Then in service file, add:
```ini
EnvironmentFile=/etc/default/aircraft-dashboard
```

### 5. Start and enable the service

```bash
# Start the service
sudo systemctl start aircraft-dashboard

# Enable on boot
sudo systemctl enable aircraft-dashboard

# Check status
sudo systemctl status aircraft-dashboard

# View logs
sudo journalctl -u aircraft-dashboard -f
```

## Running with Docker

### Using Docker Compose

Create `docker-compose.yml`:
```yaml
version: '3.8'

services:
  dashboard:
    image: node:18-alpine
    working_dir: /app
    volumes:
      - .:/app
    environment:
      - PIAWARE_URL=http://piaware:8080/data/aircraft.json
      - S3_ENDPOINT=http://minio:9000
      - S3_ACCESS_KEY=minioadmin
      - S3_SECRET_KEY=minioadmin123
    ports:
      - "3002:3002"
    command: sh -c "npm install && node server.js"
    restart: unless-stopped
    depends_on:
      - minio
      - piaware

  minio:
    image: minio/minio:latest
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      - MINIO_ROOT_USER=minioadmin
      - MINIO_ROOT_PASSWORD=minioadmin123
    volumes:
      - minio_data:/data
    command: server /data --console-address ":9001"
    restart: unless-stopped

volumes:
  minio_data:

networks:
  default:
    name: aircraft-network
```

Start with:
```bash
docker-compose up -d
```

## Development vs Production

### Development (local testing)

```bash
# Terminal 1: Start MinIO
docker run -p 9000:9000 -p 9001:9001 minio/minio server /data

# Terminal 2: Start dashboard
node server.js
```

### Production (Linux/systemd)

```bash
# Install and enable service
sudo systemctl enable aircraft-dashboard
sudo systemctl start aircraft-dashboard

# Monitor
sudo journalctl -u aircraft-dashboard -f
```

### Production (Docker)

```bash
# Use docker-compose
docker-compose up -d

# Check logs
docker-compose logs -f dashboard
```

## Troubleshooting

### "Cannot connect to PiAware"
```bash
# Test PiAware connectivity
curl http://192.168.0.161:8080/data/aircraft.json

# Check PIAWARE_URL in config.js or env vars
echo $PIAWARE_URL
```

### "Cannot connect to MinIO"
```bash
# Test MinIO connectivity
curl http://localhost:9000

# Check MinIO is running
docker ps | grep minio
# OR
ps aux | grep minio
```

### "Service fails to start"
```bash
# Check service status
sudo systemctl status aircraft-dashboard

# View detailed logs
sudo journalctl -u aircraft-dashboard -n 50

# Try running manually to see errors
cd /opt/aircraft-dashboard
node server.js
```

### "Permission denied" on files
```bash
# Fix ownership (if using piaware user)
sudo chown -R piaware:piaware /opt/aircraft-dashboard
```

### "Out of memory"
The service file includes memory limits. Adjust if needed:
```bash
sudo nano /etc/systemd/system/aircraft-dashboard.service
# Change: MemoryMax=1G
sudo systemctl daemon-reload
sudo systemctl restart aircraft-dashboard
```

## Manual Startup Scripts

### For interactive testing
```bash
# Make script executable
chmod +x restart-server.sh

# Run it
./restart-server.sh
```

### For background operation
```bash
# Start in background
nohup node server.js > aircraft-dashboard.log 2>&1 &

# Stop
pkill -f "node server.js"
```

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3002 | Server port |
| `PIAWARE_URL` | http://192.168.0.161:8080/data/aircraft.json | PiAware data endpoint |
| `S3_ENDPOINT` | http://localhost:9000 | MinIO/S3 endpoint |
| `S3_ACCESS_KEY` | minioadmin | S3 access key |
| `S3_SECRET_KEY` | minioadmin123 | S3 secret key |
| `READ_BUCKET` | aircraft-data | Historical data bucket |
| `WRITE_BUCKET` | aircraft-data-new | Current data bucket |

## Performance Tips

1. **Use SSD storage** for MinIO data directory
2. **Allocate sufficient memory** (1GB recommended minimum)
3. **Monitor with** `top` or `htop`:
   ```bash
   watch -n 1 'ps aux | grep node'
   ```
4. **Enable log rotation** for production:
   ```bash
   sudo nano /etc/logrotate.d/aircraft-dashboard
   ```

   Add:
   ```
   /var/log/aircraft-dashboard.log {
       daily
       missingok
       rotate 7
       compress
       delaycompress
   }
   ```

## Support

For issues or questions:
1. Check logs: `sudo journalctl -u aircraft-dashboard -f`
2. Review [CONFIGURATION.md](CONFIGURATION.md)
3. Open an issue on GitHub: https://github.com/christopherwhull/aircraft-dashboard/issues
