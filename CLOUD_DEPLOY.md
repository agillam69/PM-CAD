# Google Cloud Deployment Guide

This guide covers deploying the PagerMon CAD Add-on to Google Cloud.

## Architecture

```
┌─────────────────────┐         ┌─────────────────────────────────┐
│   Your PagerMon     │         │      Google Cloud               │
│   Server            │         │                                 │
│                     │  HTTP   │   ┌─────────────────────────┐   │
│   Message Repeat ───┼────────►│   │   CAD Add-on            │   │
│   Plugin            │  POST   │   │   (Cloud Run / GCE)     │   │
│                     │         │   │                         │   │
└─────────────────────┘         │   │   /ingest/message       │   │
                                │   └─────────────────────────┘   │
                                └─────────────────────────────────┘
```

## Quick Deploy Steps

### 1. Upload and Extract

```bash
# Upload cad-addon.zip to your Cloud instance
# Then extract:
unzip cad-addon.zip
cd cad-addon
```

### 2. Configure

Edit `config/config.json`:

```json
{
  "server": {
    "port": 3001
  },
  "mode": "standalone",
  "ingest": {
    "apiKey": "YOUR_SECURE_API_KEY_HERE"
  }
}
```

### 3. Install and Run

```bash
npm install --production
npm start
```

### 4. Configure PagerMon Message Repeat

In your PagerMon server, go to Admin > Settings > Plugins > Message Repeat:

- **Enable**: Yes
- **repeatURI**: `http://YOUR_CLOUD_IP:3001/ingest/message`
- **repeatAPIKEY**: `YOUR_SECURE_API_KEY_HERE` (same as config)
- **repeatUUID**: Any unique identifier (e.g., `cad-addon-1`)

---

## Google Cloud Run Deployment

### Build Container

```bash
# Build Docker image
docker build -t gcr.io/YOUR_PROJECT/pagermon-cad .

# Push to Google Container Registry
docker push gcr.io/YOUR_PROJECT/pagermon-cad
```

### Deploy to Cloud Run

```bash
gcloud run deploy pagermon-cad \
  --image gcr.io/YOUR_PROJECT/pagermon-cad \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 3001 \
  --memory 512Mi
```

---

## Google Compute Engine Deployment

### 1. Create VM

```bash
gcloud compute instances create pagermon-cad \
  --zone=us-central1-a \
  --machine-type=e2-small \
  --image-family=debian-11 \
  --image-project=debian-cloud
```

### 2. SSH and Setup

```bash
gcloud compute ssh pagermon-cad

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Upload and extract cad-addon.zip
cd /opt
sudo unzip /tmp/cad-addon.zip
cd cad-addon

# Install dependencies
sudo npm install --production

# Install PM2
sudo npm install -g pm2

# Start with PM2
pm2 start process.json
pm2 save
sudo pm2 startup
```

### 3. Open Firewall

```bash
gcloud compute firewall-rules create allow-cad \
  --allow tcp:3001 \
  --target-tags=pagermon-cad
```

---

## Environment Variables

Instead of config.json, you can use environment variables:

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3001) |
| `MODE` | `standalone` or `connected` |
| `INGEST_API_KEY` | API key for message ingestion |

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ingest/message` | POST | Receive single message from Message Repeat |
| `/ingest/batch` | POST | Batch import messages |
| `/ingest/health` | GET | Health check |
| `/cad` | GET | Dispatch board |
| `/map` | GET | Live map |

---

## Testing the Connection

From your PagerMon server, test the connection:

```bash
curl -X POST http://YOUR_CLOUD_IP:3001/ingest/message \
  -H "Content-Type: application/json" \
  -H "apikey: YOUR_API_KEY" \
  -d '{"address":"1234567","message":"Test message","source":"TEST"}'
```

Expected response:
```json
{"success":true,"caseNumber":null}
```

---

## Monitoring

View logs:
```bash
# PM2
pm2 logs pagermon-cad

# Docker
docker logs pagermon-cad
```
