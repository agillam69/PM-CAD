const express = require('express');
const router = express.Router();
const nconf = require('nconf');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');

const configPath = path.join(__dirname, '..', 'config', 'config.json');

// Settings page
router.get('/', (req, res) => {
  const services = nconf.get('services') || {};
  const mode = nconf.get('mode') || 'standalone';
  const port = nconf.get('server:port') || 3001;
  const apiKey = nconf.get('ingest:apiKey') || 'changeme';
  const pagermonUrl = nconf.get('pagermon:url') || 'http://localhost:3000';
  const pagermonDbFile = nconf.get('pagermon:database:file') || '';
  const caseTimeout = nconf.get('caseTimeout') || 3600;
  const refreshInterval = nconf.get('refreshInterval') || 30;
  const aliasTimeout = nconf.get('aliasTimeout') || 3600;
  const geocodingTimeout = nconf.get('geocodingTimeout') || 10000;
  
  // Get server's external URL (best guess)
  const host = req.headers.host || `localhost:${port}`;
  const protocol = req.protocol || 'http';
  const serverUrl = `${protocol}://${host}`;
  
  res.render('settings/index', {
    pageTitle: 'Settings',
    services,
    mode,
    port,
    apiKey,
    pagermonUrl,
    pagermonDbFile,
    caseTimeout,
    refreshInterval,
    aliasTimeout,
    geocodingTimeout,
    serverUrl,
    ingestEndpoint: `${serverUrl}/ingest/message`
  });
});

// Generate new API key
router.post('/api/generate-key', (req, res) => {
  const newKey = crypto.randomBytes(32).toString('hex');
  
  // Update config
  nconf.set('ingest:apiKey', newKey);
  saveConfig();
  
  res.json({ success: true, apiKey: newKey });
});

// Set API key
router.post('/api/set-key', (req, res) => {
  const { apiKey } = req.body;
  
  if (!apiKey || apiKey.length < 8) {
    return res.status(400).json({ error: 'API key must be at least 8 characters' });
  }
  
  nconf.set('ingest:apiKey', apiKey);
  saveConfig();
  
  res.json({ success: true });
});

// Set mode (standalone or connected)
router.post('/api/set-mode', (req, res) => {
  const { mode } = req.body;
  
  if (!['standalone', 'connected'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }
  
  nconf.set('mode', mode);
  saveConfig();
  
  res.json({ success: true, message: 'Mode updated. Restart server to apply changes.' });
});

// Set PagerMon database path
router.post('/api/set-database', (req, res) => {
  const { dbPath } = req.body;
  
  nconf.set('pagermon:database:file', dbPath);
  saveConfig();
  
  res.json({ success: true, message: 'Database path updated. Restart server to apply changes.' });
});

// Update service/agency configuration
router.post('/api/set-service', (req, res) => {
  const { serviceKey, name, color, icon, agencyMatch } = req.body;
  
  if (!serviceKey || !name) {
    return res.status(400).json({ error: 'serviceKey and name are required' });
  }
  
  const services = nconf.get('services') || {};
  services[serviceKey] = {
    name,
    color: color || '#6c757d',
    icon: icon || 'question',
    agencyMatch: Array.isArray(agencyMatch) ? agencyMatch : agencyMatch.split(',').map(s => s.trim())
  };
  
  nconf.set('services', services);
  saveConfig();
  
  res.json({ success: true });
});

// Delete service
router.post('/api/delete-service', (req, res) => {
  const { serviceKey } = req.body;
  
  const services = nconf.get('services') || {};
  delete services[serviceKey];
  
  nconf.set('services', services);
  saveConfig();
  
  res.json({ success: true });
});

// Sync historical data
router.post('/api/sync-history', async (req, res) => {
  const { startDate, endDate } = req.body;
  
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }
  
  try {
    const caseManager = require('../services/caseManager');
    const result = await caseManager.syncDateRange(startDate, endDate);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set timeout settings (generic handler for all timeout values)
router.post('/api/set-timeout', (req, res) => {
  const { key, value, timeout } = req.body;
  
  // Support both old format (timeout) and new format (key, value)
  const settingKey = key || 'caseTimeout';
  const settingValue = value || timeout;
  
  // Validate allowed keys
  const allowedKeys = ['caseTimeout', 'refreshInterval', 'aliasTimeout', 'geocodingTimeout'];
  if (!allowedKeys.includes(settingKey)) {
    return res.status(400).json({ error: 'Invalid setting key' });
  }
  
  // Validate minimum values
  const minValues = {
    caseTimeout: 300,
    refreshInterval: 10,
    aliasTimeout: 300,
    geocodingTimeout: 5000
  };
  
  if (!settingValue || settingValue < minValues[settingKey]) {
    return res.status(400).json({ error: `${settingKey} must be at least ${minValues[settingKey]}` });
  }
  
  nconf.set(settingKey, settingValue);
  saveConfig();
  
  res.json({ success: true });
});

// Get unknown messages
router.get('/unknown-messages', (req, res) => {
  const db = require('../db');
  const messages = db.getUnknownMessages(100);
  
  res.render('settings/unknown', {
    pageTitle: 'Unknown Messages',
    messages
  });
});

// Import aliases from CSV
router.post('/api/import-aliases', (req, res) => {
  const { csvData } = req.body;
  
  if (!csvData) {
    return res.status(400).json({ error: 'No CSV data provided' });
  }
  
  try {
    // Parse CSV
    const lines = csvData.split('\n');
    const header = lines[0].split(',');
    
    // Find column indices
    const aliasIdx = header.findIndex(h => h.trim().toLowerCase() === 'alias');
    const agencyIdx = header.findIndex(h => h.trim().toLowerCase() === 'agency');
    
    if (aliasIdx === -1 || agencyIdx === -1) {
      return res.status(400).json({ error: 'CSV must have "alias" and "agency" columns' });
    }
    
    // Extract unique agencies and their aliases
    const agencyAliases = {};
    let importedCount = 0;
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      
      // Simple CSV parsing (handles basic cases)
      const cols = parseCSVLine(line);
      const alias = cols[aliasIdx]?.trim();
      const agency = cols[agencyIdx]?.trim();
      
      if (alias && agency && agency !== 'null') {
        if (!agencyAliases[agency]) {
          agencyAliases[agency] = new Set();
        }
        agencyAliases[agency].add(alias);
        importedCount++;
      }
    }
    
    // Update services with new agency matches
    const services = nconf.get('services') || {};
    let updatedServices = 0;
    
    for (const [serviceKey, serviceConfig] of Object.entries(services)) {
      const currentMatches = new Set(serviceConfig.agencyMatch || []);
      let updated = false;
      
      // Check if any agency in CSV matches this service
      for (const agency of Object.keys(agencyAliases)) {
        if (currentMatches.has(agency)) {
          updated = true;
        }
      }
      
      if (updated) {
        updatedServices++;
      }
    }
    
    res.json({ 
      success: true, 
      imported: importedCount,
      agencies: Object.keys(agencyAliases).length,
      agencyList: Object.keys(agencyAliases).sort()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current aliases/agencies summary
router.get('/api/aliases', (req, res) => {
  const services = nconf.get('services') || {};
  const summary = {};
  
  for (const [key, config] of Object.entries(services)) {
    summary[key] = {
      name: config.name,
      color: config.color,
      agencyCount: (config.agencyMatch || []).length,
      agencies: config.agencyMatch || []
    };
  }
  
  res.json(summary);
});

// Simple CSV line parser
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  
  return result;
}

// Helper to save config
function saveConfig() {
  const config = {
    server: nconf.get('server'),
    mode: nconf.get('mode'),
    caseTimeout: nconf.get('caseTimeout'),
    refreshInterval: nconf.get('refreshInterval'),
    geocodingTimeout: nconf.get('geocodingTimeout'),
    aliasTimeout: nconf.get('aliasTimeout'),
    ingest: nconf.get('ingest'),
    pagermon: nconf.get('pagermon'),
    geocoding: nconf.get('geocoding'),
    services: nconf.get('services'),
    messageFilters: nconf.get('messageFilters'),
    parsing: nconf.get('parsing')
  };
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// Get message filters
router.get('/api/get-filters', (req, res) => {
  const filters = nconf.get('messageFilters') || { excludePatterns: [], excludeReasons: {} };
  res.json(filters);
});

// Add a message filter
router.post('/api/add-filter', (req, res) => {
  const { pattern, reason } = req.body;
  
  if (!pattern) {
    return res.json({ success: false, error: 'Pattern is required' });
  }
  
  // Validate regex
  try {
    new RegExp(pattern);
  } catch (e) {
    return res.json({ success: false, error: 'Invalid regex pattern: ' + e.message });
  }
  
  const filters = nconf.get('messageFilters') || { excludePatterns: [], excludeReasons: {} };
  
  // Check if pattern already exists
  if (filters.excludePatterns.includes(pattern)) {
    return res.json({ success: false, error: 'Pattern already exists' });
  }
  
  filters.excludePatterns.push(pattern);
  filters.excludeReasons[pattern] = reason || 'Filtered';
  
  nconf.set('messageFilters', filters);
  saveConfig();
  
  res.json({ success: true });
});

// Delete a message filter
router.post('/api/delete-filter', (req, res) => {
  const { index } = req.body;
  
  const filters = nconf.get('messageFilters') || { excludePatterns: [], excludeReasons: {} };
  
  if (index < 0 || index >= filters.excludePatterns.length) {
    return res.json({ success: false, error: 'Invalid index' });
  }
  
  const pattern = filters.excludePatterns[index];
  filters.excludePatterns.splice(index, 1);
  delete filters.excludeReasons[pattern];
  
  nconf.set('messageFilters', filters);
  saveConfig();
  
  res.json({ success: true });
});

// Add a priority pattern
router.post('/api/add-priority', (req, res) => {
  const { pattern, reason } = req.body;
  
  if (!pattern) {
    return res.json({ success: false, error: 'Pattern is required' });
  }
  
  // Validate regex
  try {
    new RegExp(pattern);
  } catch (e) {
    return res.json({ success: false, error: 'Invalid regex pattern: ' + e.message });
  }
  
  const filters = nconf.get('messageFilters') || { priorityPatterns: [], priorityReasons: {} };
  if (!filters.priorityPatterns) filters.priorityPatterns = [];
  if (!filters.priorityReasons) filters.priorityReasons = {};
  
  // Check if pattern already exists
  if (filters.priorityPatterns.includes(pattern)) {
    return res.json({ success: false, error: 'Pattern already exists' });
  }
  
  filters.priorityPatterns.push(pattern);
  filters.priorityReasons[pattern] = reason || 'Priority';
  
  nconf.set('messageFilters', filters);
  saveConfig();
  
  res.json({ success: true });
});

// Delete a priority pattern
router.post('/api/delete-priority', (req, res) => {
  const { index } = req.body;
  
  const filters = nconf.get('messageFilters') || { priorityPatterns: [], priorityReasons: {} };
  if (!filters.priorityPatterns) filters.priorityPatterns = [];
  
  if (index < 0 || index >= filters.priorityPatterns.length) {
    return res.json({ success: false, error: 'Invalid index' });
  }
  
  const pattern = filters.priorityPatterns[index];
  filters.priorityPatterns.splice(index, 1);
  delete filters.priorityReasons[pattern];
  
  nconf.set('messageFilters', filters);
  saveConfig();
  
  res.json({ success: true });
});

// Get list of log files
router.get('/api/logs', (req, res) => {
  try {
    const logger = require('../services/logger');
    const files = logger.getLogFiles();
    res.json({ success: true, files });
  } catch (e) {
    res.json({ success: false, error: e.message, files: [] });
  }
});

// Get log file content (last N lines)
router.get('/api/logs/:filename', (req, res) => {
  try {
    const logger = require('../services/logger');
    const lines = parseInt(req.query.lines) || 500;
    const content = logger.getLogContent(req.params.filename, lines);
    
    if (content === null) {
      return res.status(404).json({ success: false, error: 'Log file not found' });
    }
    
    res.json({ success: true, content, filename: req.params.filename });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Download log file
router.get('/api/logs/:filename/download', (req, res) => {
  try {
    const logger = require('../services/logger');
    const filePath = logger.getLogPath(req.params.filename);
    
    if (!filePath) {
      return res.status(404).json({ error: 'Log file not found' });
    }
    
    res.download(filePath, req.params.filename);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fire Unit Codes Management
router.get('/fire-units', (req, res) => {
  const unitCodes = db.getAllFireUnitCodes();
  res.render('settings/fire-units', {
    pageTitle: 'Fire Unit Codes',
    unitCodes
  });
});

// API: Get all fire unit codes
router.get('/api/fire-units', (req, res) => {
  const unitCodes = db.getAllFireUnitCodes();
  res.json({ success: true, unitCodes });
});

// API: Add fire unit code
router.post('/api/fire-units', (req, res) => {
  const { code, name, type } = req.body;
  
  if (!code || !name) {
    return res.status(400).json({ error: 'Code and name are required' });
  }
  
  const result = db.addFireUnitCode(code, name, type || 'unit');
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

// API: Update fire unit code
router.put('/api/fire-units/:id', (req, res) => {
  const { code, name, type } = req.body;
  const { id } = req.params;
  
  if (!code || !name) {
    return res.status(400).json({ error: 'Code and name are required' });
  }
  
  const result = db.updateFireUnitCode(parseInt(id), code, name, type || 'unit');
  res.json(result);
});

// API: Delete fire unit code
router.delete('/api/fire-units/:id', (req, res) => {
  const { id } = req.params;
  const result = db.deleteFireUnitCode(parseInt(id));
  res.json(result);
});

// API: Lookup unit code
router.get('/api/fire-units/lookup/:code', (req, res) => {
  const name = db.lookupFireUnitCode(req.params.code);
  res.json({ code: req.params.code, name: name || req.params.code });
});

// Auto-Print Capcodes Management
router.get('/auto-print', (req, res) => {
  const capcodes = db.getAllAutoPrintCapcodes();
  res.render('settings/auto-print', {
    pageTitle: 'Auto-Print Settings',
    capcodes
  });
});

// API: Get all auto-print capcodes
router.get('/api/auto-print', (req, res) => {
  const capcodes = db.getAllAutoPrintCapcodes();
  res.json({ success: true, capcodes });
});

// API: Add auto-print capcode
router.post('/api/auto-print', (req, res) => {
  const { capcode, alias, printDispatch, printLog } = req.body;
  
  if (!capcode) {
    return res.status(400).json({ error: 'Capcode is required' });
  }
  
  const result = db.addAutoPrintCapcode(capcode, alias, printDispatch !== false, printLog === true);
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

// API: Update auto-print capcode
router.put('/api/auto-print/:id', (req, res) => {
  const { capcode, alias, printDispatch, printLog, enabled } = req.body;
  const { id } = req.params;
  
  if (!capcode) {
    return res.status(400).json({ error: 'Capcode is required' });
  }
  
  const result = db.updateAutoPrintCapcode(parseInt(id), capcode, alias, printDispatch, printLog, enabled);
  res.json(result);
});

// API: Delete auto-print capcode
router.delete('/api/auto-print/:id', (req, res) => {
  const { id } = req.params;
  const result = db.deleteAutoPrintCapcode(parseInt(id));
  res.json(result);
});

// Known Locations Management
router.get('/known-locations', (req, res) => {
  const locations = db.getAllKnownLocations();
  res.render('settings/known-locations', {
    pageTitle: 'Known Locations',
    locations
  });
});

// API: Get all known locations
router.get('/api/known-locations', (req, res) => {
  const locations = db.getAllKnownLocations();
  res.json(locations);
});

// API: Add known location
router.post('/api/known-locations', (req, res) => {
  const { code, name, address, latitude, longitude, notes } = req.body;
  
  if (!code || !name || !address) {
    return res.status(400).json({ error: 'Code, name, and address are required' });
  }
  
  const result = db.addKnownLocation(code, name, address, 
    latitude ? parseFloat(latitude) : null, 
    longitude ? parseFloat(longitude) : null, 
    notes);
  
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

// API: Update known location
router.put('/api/known-locations/:id', (req, res) => {
  const { code, name, address, latitude, longitude, notes, enabled } = req.body;
  const { id } = req.params;
  
  if (!code || !name || !address) {
    return res.status(400).json({ error: 'Code, name, and address are required' });
  }
  
  const result = db.updateKnownLocation(parseInt(id), code, name, address,
    latitude ? parseFloat(latitude) : null,
    longitude ? parseFloat(longitude) : null,
    notes, enabled !== false);
  
  res.json(result);
});

// API: Delete known location
router.delete('/api/known-locations/:id', (req, res) => {
  const { id } = req.params;
  const result = db.deleteKnownLocation(parseInt(id));
  res.json(result);
});

// API: Geocode an address (for getting lat/long when adding known location)
router.post('/api/geocode', async (req, res) => {
  const { address } = req.body;
  
  if (!address) {
    return res.status(400).json({ error: 'Address is required' });
  }
  
  try {
    const geocoder = require('../services/geocoder');
    const result = await geocoder.geocode(address);
    if (result) {
      res.json({ success: true, lat: result.lat, lon: result.lon, displayName: result.displayName });
    } else {
      res.json({ success: false, error: 'Could not geocode address' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
