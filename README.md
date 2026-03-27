# PagerMon CAD Add-on

A standalone CAD (Computer-Aided Dispatch) add-on for PagerMon that provides:

1. **Dispatch Board** - Real-time view of active cases filtered by service (Ambulance, Fire, NEPT, SES, AFEM/EMR, RESCUE)
2. **Case Details** - View all messages, assigned resources, and geocoded coordinates
3. **Live Map** - Interactive map showing geocoded incident locations
4. **Archive System** - Search and manage historical cases
5. **Auto-Print** - Automatic printing of dispatch slips
6. **Known Locations** - Map location codes to actual addresses

## Requirements

- Node.js 18.x or higher (recommended)
- Running PagerMon server (default: http://localhost:3000)
- PagerMon database access (SQLite3 supported)

---

## Linux Installation (Ubuntu/Debian)

### 1. Install Node.js

```bash
# Update package list
sudo apt update

# Install Node.js 18.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version
npm --version
```

### 2. Install PM2 (Process Manager)

```bash
sudo npm install -g pm2
```

### 3. Clone and Install CAD Add-on

```bash
# Navigate to your preferred directory
cd /opt

# Clone the repository (or copy files)
sudo git clone https://github.com/agillam69/PM-CAD.git
cd PM-CAD

# Install dependencies
sudo npm install

# Create data directory
sudo mkdir -p data
sudo chmod 755 data
```

### 4. Configure the Application

```bash
# Copy default config
sudo cp config/default.json config/config.json

# Edit configuration
sudo nano config/config.json
```

Key settings to configure:
- `server.port` - Port to run on (default: 3001)
- `pagermon.database.file` - Path to PagerMon's messages.db
- `ingest.apiKey` - API key for message ingestion

### 5. Create First User

```bash
# Start the app temporarily to create database
node app.js &

# Wait a few seconds, then stop it
kill %1

# The app will prompt for user creation on first web access
# Or you can create one via the settings page
```

### 6. Start with PM2

```bash
# Start the application
pm2 start app.js --name "PM-CAD"

# Save PM2 configuration
pm2 save

# Enable PM2 to start on boot
pm2 startup
# Follow the instructions printed by the command above
```

### 7. Configure Nginx (Optional - Reverse Proxy)

```bash
sudo apt install nginx

sudo nano /etc/nginx/sites-available/pm-cad
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name cad.yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/pm-cad /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 8. Configure PagerMon Message Repeat

In PagerMon's Message Repeat plugin settings:
- **repeatURI**: `http://localhost:3001/ingest/message`
- **repeatAPIKEY**: Your configured API key from config.json

---

## Linux Installation (CentOS/RHEL/Rocky)

### 1. Install Node.js

```bash
# Install Node.js 18.x
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# Verify
node --version
```

### 2. Install PM2 and Clone

```bash
sudo npm install -g pm2

cd /opt
sudo git clone https://github.com/agillam69/PM-CAD.git
cd PM-CAD
sudo npm install
```

### 3. Configure and Start

```bash
sudo cp config/default.json config/config.json
sudo nano config/config.json

pm2 start app.js --name "PM-CAD"
pm2 save
pm2 startup
```

---

## Google Cloud Platform (GCP) Deployment

### 1. Create VM Instance

```bash
# Using gcloud CLI
gcloud compute instances create pm-cad \
  --zone=australia-southeast1-b \
  --machine-type=e2-small \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=20GB \
  --tags=http-server,https-server
```

### 2. SSH and Install

```bash
gcloud compute ssh pm-cad --zone=australia-southeast1-b

# Then follow Linux installation steps above
```

### 3. Open Firewall

```bash
gcloud compute firewall-rules create allow-cad \
  --allow tcp:3001 \
  --target-tags=http-server
```

---

## PM2 Commands Reference

```bash
# View status
pm2 status

# View logs
pm2 logs PM-CAD

# Restart application
pm2 restart PM-CAD

# Stop application
pm2 stop PM-CAD

# Monitor resources
pm2 monit
```

---

## Updating the Application

```bash
cd /opt/PM-CAD
git pull
npm install
pm2 restart PM-CAD
```

---

## Troubleshooting

### Application won't start
```bash
# Check logs
pm2 logs PM-CAD --lines 50

# Check if port is in use
sudo lsof -i :3001
```

### Database errors
```bash
# Ensure data directory exists and is writable
sudo mkdir -p /opt/PM-CAD/data
sudo chmod 755 /opt/PM-CAD/data
```

### PagerMon database not found
```bash
# Check the path in config.json
# Common locations:
# - /opt/pagermon/server/messages.db
# - /home/user/pagermon/server/messages.db
```

### Permission denied errors
```bash
# Fix ownership
sudo chown -R $USER:$USER /opt/PM-CAD
```

---

## Configuration

Edit `config/config.json` to configure:

### PagerMon Connection
```json
{
  "pagermon": {
    "url": "http://localhost:3000",
    "database": {
      "type": "sqlite3",
      "file": "../server/messages.db"
    }
  }
}
```

### Service Types
Configure which agencies map to which services:
```json
{
  "services": {
    "ambulance": {
      "name": "Ambulance",
      "color": "#28a745",
      "icon": "ambulance",
      "agencyMatch": ["AMBULANCE", "AV", "AMBUL"]
    },
    "fire": {
      "name": "Fire",
      "color": "#dc3545",
      "icon": "fire",
      "agencyMatch": ["FIRE", "CFA", "MFB", "FRV"]
    }
  }
}
```

### Message Parsing
Configure regex patterns to extract case numbers, addresses, and resources:
```json
{
  "parsing": {
    "caseNumberPatterns": [
      "(?:INC|JOB|CAD)?[#:]?\\s*(\\d{6,10})"
    ],
    "addressPatterns": [
      "(?:AT|LOC|@)\\s*[:]?\\s*(.+?)(?=\\s*(?:MAP|XST|$))"
    ]
  }
}
```

### Geocoding
Choose between Nominatim (free) or Google Geocoding API:
```json
{
  "geocoding": {
    "provider": "nominatim",
    "nominatim": {
      "defaultState": "VIC",
      "defaultCountry": "Australia"
    }
  }
}
```

For Google Geocoding:
```json
{
  "geocoding": {
    "provider": "google",
    "google": {
      "apiKey": "YOUR_API_KEY"
    }
  }
}
```

## Running

```bash
# Development
npm run dev

# Production
npm start
```

The CAD add-on runs on port 3001 by default (configurable in config.json).

## URLs

- **Dispatch Board**: http://localhost:3001/cad
- **Live Map**: http://localhost:3001/map
- **Case Detail**: http://localhost:3001/cad/case/{caseNumber}

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/cad/api/cases` | GET | Get all active cases |
| `/cad/api/cases?service=fire` | GET | Get cases filtered by service |
| `/cad/api/case/:caseNumber` | GET | Get single case with details |
| `/cad/api/map-cases` | GET | Get geocoded cases for map |
| `/cad/api/sync` | POST | Manually sync from PagerMon |
| `/map/api/markers` | GET | Get map markers |

## How It Works

1. **Real-time Updates**: Connects to PagerMon's WebSocket and listens for new messages
2. **Message Parsing**: Extracts case numbers, addresses, and resource codes using regex
3. **Geocoding**: Converts addresses to lat/lng coordinates for mapping
4. **Case Grouping**: Groups messages by case number and tracks assigned resources
5. **Auto-cleanup**: Closes cases that haven't been updated in 4 hours (configurable)

## Customizing Regex Patterns

The default patterns are designed for Australian emergency services. You'll need to customize them for your specific pager message format.

Example message:
```
F123456789 STRUCTURE FIRE AT 123 MAIN ST SUBURB MAP 45 A6 UNITS P421 P422
```

Would be parsed as:
- Case Number: `123456789`
- Address: `123 MAIN ST SUBURB`
- Map Ref: `45 A6`
- Resources: `P421`, `P422`

## License

Same as PagerMon - The Unlicense
