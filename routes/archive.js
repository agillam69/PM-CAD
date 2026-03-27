const express = require('express');
const router = express.Router();
const moment = require('moment');
const caseManager = require('../services/caseManager');
const db = require('../db');

// Archive Page - Show archived cases
router.get('/', (req, res) => {
  const services = require('nconf').get('services') || {};
  const serviceFilter = req.query.service || null;
  const searchQuery = req.query.search || null;
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;
  
  // Get archived cases
  let allArchived = db.getArchivedCases();
  
  // Apply search filter if provided
  if (searchQuery) {
    const searchLower = searchQuery.toLowerCase();
    allArchived = allArchived.filter(c => 
      c.case_number.toLowerCase().includes(searchLower) ||
      (c.address && c.address.toLowerCase().includes(searchLower)) ||
      (c.incident_type && c.incident_type.toLowerCase().includes(searchLower)) ||
      (c.incident_description && c.incident_description.toLowerCase().includes(searchLower))
    );
  }
  
  // Apply service filter
  if (serviceFilter) {
    allArchived = allArchived.filter(c => c.service === serviceFilter);
  }
  
  const totalCases = allArchived.length;
  const totalPages = Math.ceil(totalCases / limit);
  
  // Get cases for current page
  const cases = allArchived.slice(offset, offset + limit).map(c => ({
    ...c,
    serviceConfig: services[c.service] || {},
    resourceCount: db.getCaseResources(c.id).length
  }));
  
  // Group by service
  const casesByService = {};
  for (const [key, config] of Object.entries(services)) {
    casesByService[key] = cases.filter(c => c.service === key);
  }
  casesByService.all = cases;
  
  res.render('cad/archive', {
    title: 'Case Archive',
    cases: casesByService,
    services: services,
    currentService: serviceFilter,
    currentPage: page,
    totalPages: totalPages,
    totalCases: totalCases,
    moment: moment,
    req: req, // Pass req object to access query params in view
    messages: req.flash ? { success: req.flash('success')[0], error: req.flash('error')[0] } : {}
  });
});

// Restore archived case to active
router.post('/restore/:caseNumber', (req, res) => {
  const caseNumber = req.params.caseNumber;
  
  try {
    db.run(`
      UPDATE cases 
      SET status = 'active', last_updated = ?
      WHERE case_number = ?
    `, [Math.floor(Date.now() / 1000), caseNumber]);
    
    req.flash('success', `Case ${caseNumber} restored to active`);
  } catch (error) {
    req.flash('error', `Failed to restore case: ${error.message}`);
  }
  
  res.redirect('/cad/archive');
});

// Permanently delete archived case
router.post('/delete/:caseNumber', (req, res) => {
  const caseNumber = req.params.caseNumber;
  
  try {
    // Delete case messages first
    db.run(`
      DELETE FROM case_messages 
      WHERE case_id IN (SELECT id FROM cases WHERE case_number = ?)
    `, [caseNumber]);
    
    // Delete case resources
    db.run(`
      DELETE FROM case_resources 
      WHERE case_id IN (SELECT id FROM cases WHERE case_number = ?)
    `, [caseNumber]);
    
    // Delete case notes
    db.run(`
      DELETE FROM case_notes 
      WHERE case_id IN (SELECT id FROM cases WHERE case_number = ?)
    `, [caseNumber]);
    
    // Delete the case
    db.run(`
      DELETE FROM cases 
      WHERE case_number = ?
    `, [caseNumber]);
    
    req.flash('success', `Case ${caseNumber} permanently deleted`);
  } catch (error) {
    req.flash('error', `Failed to delete case: ${error.message}`);
  }
  
  res.redirect('/cad/archive');
});

module.exports = router;
