const express = require('express');
const router = express.Router();
const nconf = require('nconf');
const caseManager = require('../services/caseManager');

// Map view - all services
router.get('/', (req, res) => {
  const services = nconf.get('services') || {};
  const serviceFilter = req.query.service || null;
  
  res.render('map/index', {
    pageTitle: 'Live Incident Map',
    services,
    serviceFilter
  });
});

// Map view - single service
router.get('/service/:service', (req, res) => {
  const services = nconf.get('services') || {};
  const serviceKey = req.params.service;
  const serviceConfig = services[serviceKey] || { name: serviceKey, color: '#6c757d', icon: 'question' };
  
  res.render('map/index', {
    pageTitle: `${serviceConfig.name} Map`,
    services,
    serviceFilter: serviceKey,
    serviceConfig
  });
});

// API: Get geocoded cases for map
router.get('/api/markers', (req, res) => {
  const serviceFilter = req.query.service || null;
  const cases = caseManager.getCasesForMap(serviceFilter);
  
  // Transform to marker format
  const markers = cases.map(c => ({
    id: c.caseNumber,
    lat: c.latitude,
    lng: c.longitude,
    title: c.caseNumber,
    address: c.address,
    service: c.service,
    color: c.serviceConfig.color || '#6c757d',
    icon: c.serviceConfig.icon || 'question',
    lastUpdated: c.lastUpdated
  }));
  
  res.json(markers);
});

module.exports = router;
