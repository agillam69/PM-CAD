const express = require('express');
const router = express.Router();
const nconf = require('nconf');
const moment = require('moment');
const caseManager = require('../services/caseManager');
const db = require('../db');

// CAD Dispatch Board - Main view
router.get('/', (req, res) => {
  const services = nconf.get('services') || {};
  const serviceFilter = req.query.service || null;
  
  const cases = caseManager.getActiveCasesByService(serviceFilter);
  
  // Group cases by service
  const casesByService = {};
  for (const [key, config] of Object.entries(services)) {
    casesByService[key] = {
      config,
      cases: cases.filter(c => c.service === key)
    };
  }
  
  // Add unknown service if any
  const unknownCases = cases.filter(c => c.service === 'unknown');
  if (unknownCases.length > 0) {
    casesByService['unknown'] = {
      config: { name: 'Unknown', color: '#6c757d', icon: 'question' },
      cases: unknownCases
    };
  }
  
  res.render('cad/index', {
    pageTitle: 'CAD Dispatch Board',
    services,
    casesByService,
    serviceFilter,
    totalCases: cases.length,
    moment
  });
});

// Priority cases view
router.get('/priority', (req, res) => {
  const services = nconf.get('services') || {};
  const cases = caseManager.getPriorityCases();
  
  res.render('cad/priority', {
    pageTitle: 'Priority Cases - CAD',
    services,
    cases,
    moment
  });
});

// Single service view
router.get('/service/:service', (req, res) => {
  const services = nconf.get('services') || {};
  const serviceKey = req.params.service;
  const serviceConfig = services[serviceKey] || { name: serviceKey, color: '#6c757d', icon: 'question' };
  
  const cases = caseManager.getActiveCasesByService(serviceKey);
  
  res.render('cad/service', {
    pageTitle: `${serviceConfig.name} - CAD`,
    service: serviceKey,
    serviceConfig,
    cases,
    moment
  });
});

// Case detail view
router.get('/case/:caseNumber', (req, res) => {
  const caseNumber = req.params.caseNumber;
  const caseDetails = caseManager.getCaseWithDetails(caseNumber);
  
  if (!caseDetails) {
    return res.status(404).render('cad/error', {
      pageTitle: 'Case Not Found',
      message: `Case ${caseNumber} not found`
    });
  }
  
  const services = nconf.get('services') || {};
  
  res.render('cad/case', {
    pageTitle: `Case ${caseNumber}`,
    case: caseDetails,
    services,
    moment
  });
});

// API: Get active cases
router.get('/api/cases', (req, res) => {
  const serviceFilter = req.query.service || null;
  const cases = caseManager.getActiveCasesByService(serviceFilter);
  res.json(cases);
});

// API: Get single case
router.get('/api/case/:caseNumber', (req, res) => {
  const caseDetails = caseManager.getCaseWithDetails(req.params.caseNumber);
  
  if (!caseDetails) {
    return res.status(404).json({ error: 'Case not found' });
  }
  
  res.json(caseDetails);
});

// API: Get cases for map
router.get('/api/map-cases', (req, res) => {
  const serviceFilter = req.query.service || null;
  const cases = caseManager.getCasesForMap(serviceFilter);
  res.json(cases);
});

// API: Sync from PagerMon
router.post('/api/sync', async (req, res) => {
  try {
    const hoursBack = parseInt(req.query.hours) || 4;
    const result = await caseManager.syncFromPagermon(hoursBack);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Sync specific date range from PagerMon
router.post('/api/sync-range', async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    
    const result = await caseManager.syncDateRange(startDate, endDate);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get cases by date range
router.get('/api/cases-range', (req, res) => {
  try {
    const { startDate, endDate, service } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate query params are required' });
    }
    
    const cases = caseManager.getCasesByDateRange(startDate, endDate, service || null);
    res.json(cases);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Historical view - browse cases by date
router.get('/history', (req, res) => {
  const services = nconf.get('services') || {};
  const serviceFilter = req.query.service || null;
  const startDate = req.query.startDate || moment().subtract(24, 'hours').format('YYYY-MM-DDTHH:mm');
  const endDate = req.query.endDate || moment().format('YYYY-MM-DDTHH:mm');
  
  const cases = caseManager.getCasesByDateRange(startDate, endDate, serviceFilter);
  
  // Group cases by service
  const casesByService = {};
  for (const [key, config] of Object.entries(services)) {
    casesByService[key] = {
      config,
      cases: cases.filter(c => c.service === key)
    };
  }
  
  res.render('cad/history', {
    pageTitle: 'Case History',
    services,
    casesByService,
    serviceFilter,
    startDate,
    endDate,
    totalCases: cases.length,
    moment
  });
});

// API: Close old cases
router.post('/api/close-old', (req, res) => {
  try {
    const closed = caseManager.closeOldCases();
    res.json({ success: true, closed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
