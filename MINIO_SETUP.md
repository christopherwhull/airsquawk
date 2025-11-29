# MinIO S3 Storage - Installation & Setup Guide

MinIO is an S3-compatible object storage server used by the Aircraft Dashboard for data persistence. This guide covers installation across all platforms.

## Quick Start (Docker - Recommended)

Docker is the easiest way to get MinIO running quickly:

```bash
docker run -d \
  --name minio \
  -p 9000:9000 \
  -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin123 \
  -v minio_data:/data \
  minio/minio:latest \
  server /data --console-address ":9001"
```

Access MinIO console at: `http://localhost:9001`
- Login: minioadmin / minioadmin123

S3 endpoint: `http://localhost:9000`

## Installation by Platform

### Docker (All Platforms)

**Prerequisites:**
- Docker installed and running

**Installation:**

1. **Start MinIO with persistent storage:**
```bash
docker run -d \
  --name minio \
  -p 9000:9000 \
  -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin123 \
  -v minio_data:/data \
  minio/minio:latest \
  server /data --console-address ":9001"
```

2. **Verify it's running:**
```bash
docker ps
docker logs minio
```

3. **Access console:**
- URL: http://localhost:9001
- User: minioadmin
- Password: minioadmin123

**Docker Compose (Better for Long-Term):**

Create `docker-compose.yml`:
```yaml
version: '3.8'

services:
  minio:
    image: minio/minio:latest
    container_name: minio
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin123
    volumes:
      - minio_data:/data
    command: server /data --console-address ":9001"
    restart: unless-stopped

volumes:
  minio_data:
```

Start with:
```bash
docker-compose up -d
```

Stop with:
```bash
docker-compose down
```

View logs:
```bash
docker-compose logs -f minio
```

### Windows (Standalone)

**Prerequisites:**
- Windows 10/11
- Administrator access
- ~500MB disk space

**Installation:**

1. **Download MinIO:**
```powershell
# Create minio directory
mkdir C:\minio
cd C:\minio

# Download latest MinIO binary
$url = "https://dl.min.io/server/minio/release/windows-amd64/minio.exe"
Invoke-WebRequest -Uri $url -OutFile minio.exe
```

2. **Create data directory:**
```powershell
mkdir C:\minio\data
```

3. **Create startup script** (`start_minio.ps1`):
```powershell
# Set working directory
Set-Location C:\minio

# Set credentials
$env:MINIO_ROOT_USER = "minioadmin"
$env:MINIO_ROOT_PASSWORD = "minioadmin123"

# Start MinIO
.\minio.exe server C:\minio\data --console-address ":9001"
```

4. **Run the script:**
```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
.\start_minio.ps1
```

5. **Create Windows Scheduled Task (Optional - Auto-Start):**
```powershell
# Run as Administrator
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\minio\start_minio.ps1"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -TaskName "MinIO" -Description "MinIO S3 Storage Server"
```

Start MinIO manually:
```powershell
cd C:\minio
.\start_minio.ps1
```

Access console: `http://localhost:9001`

### Linux (Standalone)

**Ubuntu/Debian:**

1. **Install MinIO:**
```bash
wget https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x minio
sudo mv minio /usr/local/bin/
```

2. **Create data directory:**
```bash
sudo mkdir -p /data/minio
sudo chown -R $USER:$USER /data/minio
```

3. **Start MinIO (Development):**
```bash
minio server /data/minio --console-address ":9001"
```

**Linux (Systemd Service - Production):**

1. **Install MinIO:**
```bash
wget https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x minio
sudo mv minio /usr/local/bin/
```

2. **Create user:**
```bash
sudo useradd -r -s /bin/false minio
```

3. **Create data directories:**
```bash
sudo mkdir -p /data/minio
sudo chown -R minio:minio /data/minio
```

4. **Create systemd service** (`/etc/systemd/system/minio.service`):
```ini
[Unit]
Description=MinIO S3 Object Storage
Documentation=https://docs.min.io
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=minio
Group=minio
WorkingDirectory=/data/minio

Environment="MINIO_ROOT_USER=minioadmin"
Environment="MINIO_ROOT_PASSWORD=minioadmin123"
Environment="MINIO_VOLUMES=/data/minio"
Environment="MINIO_OPTS=--console-address :9001"

ExecStart=/usr/local/bin/minio server /data/minio --console-address ":9001"

# Restart policy
Restart=on-failure
RestartSec=10

# Resource limits
MemoryMax=2G
CPUQuota=50%

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=minio

# Security
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```

5. **Enable and start:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable minio
sudo systemctl start minio
sudo systemctl status minio
```

6. **View logs:**
```bash
sudo journalctl -u minio -f
```

**Fedora/RHEL/CentOS:**

```bash
# Install MinIO
wget https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x minio
sudo mv minio /usr/local/bin/

# Follow Linux (Systemd Service) steps above
```

**Arch:**

```bash
# Install from AUR
yay -S minio
# OR
paru -S minio

# Start service
sudo systemctl enable minio
sudo systemctl start minio
```

### macOS (Standalone)

**Homebrew:**

```bash
# Install MinIO
brew install minio/stable/minio

# Create data directory
mkdir -p ~/minio_data

# Start MinIO
minio server ~/minio_data --console-address ":9001"
```

**Manual Installation:**

```bash
# Download
wget https://dl.min.io/server/minio/release/darwin-amd64/minio
chmod +x minio
sudo mv minio /usr/local/bin/

# Start
mkdir -p ~/minio_data
minio server ~/minio_data --console-address ":9001"
```

**Launch Agent (Auto-Start on Login):**

Create `~/Library/LaunchAgents/io.min.minio.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>io.min.minio</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/minio</string>
        <string>server</string>
        <string>/Users/$(whoami)/minio_data</string>
        <string>--console-address</string>
        <string>:9001</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/minio.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/minio.err</string>
</dict>
</plist>
```

Load it:
```bash
launchctl load ~/Library/LaunchAgents/io.min.minio.plist
```

## Post-Installation Setup

### Access MinIO Console

Open your browser to: `http://localhost:9001`

**Default credentials:**
- Username: `minioadmin`
- Password: `minioadmin123`

⚠️ **IMPORTANT:** Change these credentials in production!

### Create Required Buckets

1. Login to MinIO console
2. Click "Create bucket"
3. Create these buckets:

| Bucket Name | Purpose |
|------------|---------|
| `aircraft-data` | Historical position data |
| `aircraft-data-new` | Current/live position data |
| `output-kmls` | KML files for Google Earth |
| `flighturls` | FlightAware URLs |
| `piaware-reception-data` | Reception records |
| `icao-hex-cache` | Aircraft type database |

Or use the MinIO CLI:

```bash
# Set alias (after installing mc)
mc alias set myminio http://localhost:9000 minioadmin minioadmin123

# Create buckets
mc mb myminio/aircraft-data
mc mb myminio/aircraft-data-new
mc mb myminio/output-kmls
mc mb myminio/flighturls
mc mb myminio/piaware-reception-data
mc mb myminio/icao-hex-cache
```

### Configure Retention Policies

For reception data archival:

```bash
# Set lifecycle policy (keep 90 days)
mc ilm import myminio/piaware-reception-data < retention-policy.json
```

### Change Default Credentials

**Via Console:**
1. Click settings (⚙️)
2. Select "Users"
3. Change `minioadmin` password

**Via CLI:**
```bash
mc admin user passwd myminio minioadmin
```

## Integration with Aircraft Dashboard

### Update Configuration

Edit `config.js`:

```javascript
s3: {
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
    region: process.env.S3_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin123',
    },
    forcePathStyle: true, // Required for MinIO
},
```

Or use environment variables:

```bash
export S3_ENDPOINT=http://localhost:9000
export S3_ACCESS_KEY=minioadmin
export S3_SECRET_KEY=minioadmin123
```

### Verify Connection

The dashboard will show errors on `/api/config` if connection fails:

```bash
curl http://localhost:3002/api/config
```

## Monitoring & Maintenance

### Check Storage Usage

**Console:**
- Login to http://localhost:9001
- Dashboard shows storage stats

**CLI:**
```bash
mc du myminio/aircraft-data
mc du myminio/aircraft-data-new
```

### Backup Data

**Docker:**
```bash
# Backup volume
docker run --rm -v minio_data:/data -v $(pwd):/backup alpine tar czf /backup/minio_backup.tar.gz /data

# Restore
docker run --rm -v minio_data:/data -v $(pwd):/backup alpine tar xzf /backup/minio_backup.tar.gz -C /data
```

**Standalone:**
```bash
# Backup
tar czf minio_backup.tar.gz /data/minio

# Restore
tar xzf minio_backup.tar.gz -C /
```

### View Logs

**Docker:**
```bash
docker logs minio
docker logs -f minio  # Follow logs
```

**Docker Compose:**
```bash
docker-compose logs -f minio
```

**Systemd:**
```bash
sudo journalctl -u minio -f
```

**Standalone:**
Check console output or redirect to file:
```bash
minio server /data/minio > minio.log 2>&1 &
```

## Performance Tuning

### Increase Resource Limits

**Docker:**
```bash
docker run -d \
  --memory=2g \
  --cpus=2 \
  --name minio \
  ...
```

**Systemd:**
Edit `/etc/systemd/system/minio.service`:
```ini
MemoryMax=4G
CPUQuota=200%  # 2 cores
```

### Enable HTTP/2

MinIO supports HTTP/2. Most clients automatically use it.

### SSD Storage

MinIO performs best with SSD storage for `/data/minio`:

```bash
# Check current disk
df -h /data/minio

# Move to SSD if on HDD
sudo rsync -av /data/minio /mnt/ssd/minio
```

## Troubleshooting

### MinIO Won't Start

**Windows:**
```powershell
# Check if port is in use
netstat -ano | findstr :9000

# Kill process
taskkill /PID <PID> /F
```

**Linux:**
```bash
# Check port
sudo netstat -tlnp | grep :9000

# Kill process
sudo kill -9 <PID>
```

### Cannot Connect from Dashboard

1. Verify MinIO is running:
```bash
curl http://localhost:9000
```

2. Check firewall:
```bash
# Linux
sudo ufw allow 9000
sudo ufw allow 9001
```

3. Check credentials in config.js

### Out of Disk Space

```bash
# Check usage
df -h /data/minio

# Clean old data
mc rm myminio/aircraft-data --recursive --older-than 30d
```

### High Memory Usage

Set memory limits:
```bash
# Docker
docker update --memory=1g minio

# Standalone - restart with limits (Linux)
ulimit -m 1000000  # ~1GB
minio server /data/minio
```

## Security Best Practices

### Change Default Credentials

```bash
# Via CLI
mc admin user passwd myminio minioadmin newpassword

# Update config.js or environment variables
export S3_ACCESS_KEY=newuser
export S3_SECRET_KEY=newsecretpassword
```

### Use HTTPS

Create self-signed certificate:
```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /data/minio/private.key \
  -out /data/minio/public.crt
```

Set environment:
```bash
export MINIO_SERVER_URL=https://minio.example.com
export MINIO_BROWSER_REDIRECT_URL=https://minio.example.com:9001
```

### Restrict Access

Use firewall to limit who can access:
```bash
# Linux - only allow local network
sudo ufw allow from 192.168.0.0/24 to any port 9000
```

### Enable Object Locking

For immutable data (compliance):
```bash
mc mb --with-lock myminio/compliance-bucket
```

## Next Steps

1. **Start MinIO** using your preferred installation method
2. **Create buckets** using the console or CLI
3. **Update Dashboard config.js** with S3 endpoint and credentials
4. **Verify connection** by accessing `/api/config` endpoint
5. **Monitor storage** using the MinIO console

## Additional Resources

- MinIO Documentation: https://docs.min.io/
- MinIO CLI (mc): https://docs.min.io/docs/minio-client-quickstart-guide.html
- S3 Compatibility: https://docs.min.io/docs/how-to-use-aws-sdk-for-go-with-minio-server.html
- Health Check: https://docs.min.io/docs/minio-health-check-guide.html
