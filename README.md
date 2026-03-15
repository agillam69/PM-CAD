# PagerMon CAD Add-on

A standalone CAD (Computer-Aided Dispatch) add-on for PagerMon that provides:

1. **Dispatch Board** - Real-time view of active cases filtered by service (Ambulance, Fire, NEPT, SES)
2. **Case Details** - View all messages and assigned resources for a case
3. **Live Map** - Interactive map showing geocoded incident locations

## Requirements

- Node.js 14.x or higher
- Running PagerMon server (default: http://localhost:3000)
- PagerMon database access (SQLite3 supported)

## Installation

```bash
cd cad-addon
npm install
```

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
