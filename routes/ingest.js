const express = require('express');
const router = express.Router();
const nconf = require('nconf');
const caseManager = require('../services/caseManager');
const logger = require('../services/logger');

// API endpoint to receive messages from PagerMon's Message Repeat plugin
// Configure Message Repeat in PagerMon with:
//   repeatURI: http://your-cad-server:3001/ingest/message
//   repeatAPIKEY: your-api-key-here

router.post('/message', async (req, res) => {
  // Validate API key
  const configuredApiKey = nconf.get('ingest:apiKey');
  const providedApiKey = req.headers['apikey'] || req.headers['x-api-key'];
  
  if (configuredApiKey && configuredApiKey !== 'changeme') {
    if (!providedApiKey || providedApiKey !== configuredApiKey) {
      logger.warn('Unauthorized ingest request - invalid API key', { ip: req.ip });
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  
  // Support both MessageRepeat format and extended format with alias/agency
  const { 
    address, 
    message, 
    source, 
    datetime,
    timestamp,  // Alternative to datetime
    UUID,
    // Extended fields (from SimpleWebhook or modified MessageRepeat)
    alias,
    alias_id,
    agency,
    icon,
    color
  } = req.body;
  
  if (!address || !message) {
    logger.warn('Invalid ingest request - missing address or message', { address, hasMessage: !!message });
    return res.status(400).json({ error: 'address and message are required' });
  }
  
  logger.logIngest('received', { alias: alias || source || 'unknown', agency: agency || 'unknown', address });
  
  try {
    // Process the message through the case manager
    const messageData = {
      id: null, // No PagerMon ID since this came via API
      address: address,
      message: message,
      source: source || 'API_INGEST',
      timestamp: datetime ? parseInt(datetime) : (timestamp ? parseInt(timestamp) : Math.floor(Date.now() / 1000)),
      agency: agency || determineAgencyFromAddress(address),
      alias: alias || null,  // Unit identifier (e.g., FSCC, EPSM7881)
      alias_id: alias_id || null,
      icon: icon || null,
      color: color || null
    };
    
    const result = await caseManager.processMessage(messageData);
    
    if (result && result.case) {
      // Broadcast to connected CAD clients
      const io = req.app.get('io');
      if (io) {
        const caseDetails = caseManager.getCaseWithDetails(result.case.case_number);
        io.emit('caseUpdate', {
          type: 'update',
          case: caseDetails
        });
      }
      
      console.log(`Ingest: Processed case ${result.case.case_number}`);
      res.status(200).json({ 
        success: true, 
        caseNumber: result.case.case_number,
        service: result.parsed.service
      });
    } else {
      // Message didn't match a case pattern - still OK
      res.status(200).json({ success: true, caseNumber: null });
    }
  } catch (error) {
    console.error('Ingest: Error processing message:', error);
    res.status(500).json({ error: error.message });
  }
});

// Batch ingest endpoint for importing multiple messages
router.post('/batch', async (req, res) => {
  const configuredApiKey = nconf.get('ingest:apiKey');
  const providedApiKey = req.headers['apikey'] || req.headers['x-api-key'];
  
  if (configuredApiKey && configuredApiKey !== 'changeme') {
    if (!providedApiKey || providedApiKey !== configuredApiKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  
  const messages = req.body.messages;
  
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }
  
  console.log(`Ingest: Batch processing ${messages.length} messages`);
  
  let processed = 0;
  let errors = 0;
  
  for (const msg of messages) {
    try {
      const messageData = {
        id: msg.id || null,
        address: msg.address,
        message: msg.message,
        source: msg.source || 'BATCH_IMPORT',
        timestamp: msg.datetime || msg.timestamp || Math.floor(Date.now() / 1000),
        agency: msg.agency || determineAgencyFromAddress(msg.address),
        alias: msg.alias || null
      };
      
      const result = await caseManager.processMessage(messageData);
      if (result) processed++;
    } catch (error) {
      errors++;
      console.error('Ingest: Batch error:', error.message);
    }
  }
  
  res.json({ success: true, processed, errors, total: messages.length });
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Helper function to determine agency from address patterns
function determineAgencyFromAddress(address) {
  if (!address) return 'unknown';
  
  const addr = address.toString();
  
  // Common address patterns for Victorian emergency services
  // These are based on capcode address ranges - adjust as needed
  if (addr.startsWith('1') && addr.length === 7) {
    // 1xxxxxx range - often Ambulance
    return 'Ambulance Vic';
  } else if (addr.startsWith('0')) {
    // 0xxxxxx range - varies
    return 'unknown';
  }
  
  return 'unknown';
}

module.exports = router;
