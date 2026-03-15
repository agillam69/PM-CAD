# Deploying PagerMon CAD Add-on

This guide covers deploying the CAD add-on to an existing PagerMon system.

## Prerequisites

- Node.js 14.x or higher
- Access to PagerMon's database (SQLite or MySQL)
- Network access to PagerMon's WebSocket (port 3000)

---

## Option 1: Same Server as PagerMon (Recommended)

### Step 1: Copy Files

Copy the `cad-addon` folder to your PagerMon server:

```bash
# Example: copy to /opt/pagermon-cad
scp -r cad-addon user@your-server:/opt/pagermon-cad
```

### Step 2: Configure Database Path

Edit `config/config.json` (copy from `config/default.json` if it doesn't exist):

```json
{
  "pagermon": {
    "url": "http://localhost:3000",
    "database": {
      "type": "sqlite3",
      "file": "/opt/pagermon/server/messages.db"
    }
  }
}
```

### Step 3: Install Dependencies

```bash
cd /opt/pagermon-cad
npm install --production
```

### Step 4: Run with PM2

```bash
# Start with PM2 (same as PagerMon)
pm2 start process.json

# Save PM2 configuration
pm2 save

# View logs
pm2 logs pagermon-cad
```

### Step 5: Configure Nginx (Optional)

Add to your existing PagerMon nginx config:

```nginx
# CAD Add-on
location /cad {
    proxy_pass http://localhost:3001/cad;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}

location /map {
    proxy_pass http://localhost:3001/map;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}
```

---

## Option 2: Docker Deployment

### Step 1: Build Image

```bash
cd cad-addon
docker build -t pagermon-cad .
```

### Step 2: Configure docker-compose.yml

Edit `docker-compose.yml` to set the correct path to PagerMon's database:

```yaml
volumes:
  - /opt/pagermon/server/messages.db:/app/pagermon.db:ro
```

### Step 3: Update Config

Edit `config/config.json`:

```json
{
  "pagermon": {
    "url": "http://pagermon:3000",
    "database": {
      "type": "sqlite3",
      "file": "/app/pagermon.db"
    }
  }
}
```

### Step 4: Run

```bash
docker-compose up -d
```

---

## Option 3: Windows Service

### Using NSSM (Non-Sucking Service Manager)

1. Download NSSM from https://nssm.cc/
2. Install as service:

```batch
nssm install PagerMonCAD "C:\Program Files\nodejs\node.exe"
nssm set PagerMonCAD AppDirectory "C:\path\to\cad-addon"
nssm set PagerMonCAD AppParameters "app.js"
nssm start PagerMonCAD
```

---

## Configuration Reference

### config/config.json

```json
{
  "server": {
    "port": 3001
  },
  "pagermon": {
    "url": "http://localhost:3000",
    "database": {
      "type": "sqlite3",
      "file": "/path/to/messages.db"
    }
  },
  "geocoding": {
    "provider": "nominatim",
    "nominatim": {
      "defaultState": "VIC",
      "defaultCountry": "Australia"
    }
  },
  "caseTimeout": 14400
}
```

### Environment Variables (Optional)

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3001 |
| `NODE_ENV` | Environment | development |

---

## Accessing the CAD Add-on

Once deployed:

- **Dispatch Board**: http://your-server:3001/cad
- **Live Map**: http://your-server:3001/map
- **Case Detail**: http://your-server:3001/cad/case/{caseNumber}

---

## Troubleshooting

### Database Connection Issues

```bash
# Test database access
sqlite3 /path/to/messages.db "SELECT COUNT(*) FROM messages;"
```

### WebSocket Connection Issues

Check that PagerMon is running and accessible:

```bash
curl http://localhost:3000
```

### View Logs

```bash
# PM2
pm2 logs pagermon-cad

# Docker
docker logs pagermon-cad
```
