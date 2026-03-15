const db = require('../db');
const messageParser = require('./messageParser');
const geocoder = require('./geocoder');
const nconf = require('nconf');
const logger = require('./logger');

async function processMessage(messageData) {
  // Use alias from the API packet if available
  const alias = messageData.alias || null;
  
  // Debug: log alias for troubleshooting
  if (alias) {
    console.log(`Processing message with alias: ${alias}`);
  }
  
  const parsed = messageParser.parseMessage(messageData.message, messageData.agency, alias);
  
  const timestamp = messageData.timestamp || Math.floor(Date.now() / 1000);
  
  // Skip filtered messages (EAS Time Updates, etc.)
  if (parsed.isFiltered) {
    logger.logFilter(parsed.filterReason, parsed.filterPattern, { alias, agency: messageData.agency });
    return { parsed, case: null, messageType: parsed.messageType, filtered: true };
  }
  
  // Handle unknown/unspecified aliases - store separately
  if (parsed.isUnknownAlias) {
    db.addUnknownMessage({
      message: messageData.message,
      address: messageData.address,
      timestamp: timestamp,
      source: messageData.source,
      alias: alias
    });
  }
  
  // Use associatedCaseNumber for unit messages, or caseNumber for dispatch messages
  const effectiveCaseNumber = parsed.associatedCaseNumber || parsed.caseNumber;
  
  if (!effectiveCaseNumber) {
    // No case number - store as general message (group pages, info, etc.)
    console.log(`Storing as general message (no case number): ${alias || 'unknown alias'}`);
    db.addMessage({
      message: messageData.message,
      address: messageData.address,
      timestamp: timestamp,
      source: messageData.source,
      alias: alias,
      agency: messageData.agency,
      service: parsed.service
    });
    return { parsed, case: null, messageType: 'message', stored: true };
  }
  
  // Upsert the case
  const caseData = {
    caseNumber: effectiveCaseNumber,
    service: parsed.service,
    address: parsed.address,
    mapRef: parsed.mapRef,
    timestamp: timestamp,
    status: 'active',
    isPriority: parsed.isPriority || false,
    priorityReason: parsed.priorityReason || null
  };
  
  // Handle GPS coordinates directly
  if (parsed.isGPSLocation && parsed.gpsCoordinates) {
    caseData.latitude = parsed.gpsCoordinates.lat;
    caseData.longitude = parsed.gpsCoordinates.lng;
  } else if (parsed.address && !parsed.isGPSLocation) {
    // Try to geocode regular addresses, with SVVB map reference fallback
    try {
      const geoResult = await geocoder.geocodeWithMapRef(parsed.address, parsed.mapRef);
      if (geoResult) {
        caseData.latitude = geoResult.lat;
        caseData.longitude = geoResult.lng;
        if (geoResult.source) {
          logger.debug('Geocoded via ' + geoResult.source, { address: parsed.address, mapRef: parsed.mapRef });
        }
      }
    } catch (error) {
      logger.error('Geocoding failed', { address: parsed.address, error: error.message });
    }
  }
  
  db.upsertCase(caseData);
  logger.logCase('upsert', effectiveCaseNumber, { service: parsed.service, address: parsed.address, isPriority: parsed.isPriority });
  
  // Log priority cases
  if (parsed.isPriority) {
    logger.logPriority(effectiveCaseNumber, parsed.priorityReason, { service: parsed.service });
  }
  
  // Get the case ID
  const caseRecord = db.getCaseByNumber(effectiveCaseNumber);
  
  if (caseRecord) {
    // Add the message to case history with dispatch info
    db.addCaseMessage(caseRecord.id, {
      pagermonId: messageData.id,
      message: messageData.message,
      address: parsed.address,
      timestamp: timestamp,
      source: messageData.source,
      alias: alias,
      messageType: parsed.messageType,
      signal: parsed.signal,
      requestTime: parsed.requestTime,
      dispatchTime: parsed.dispatchTime,
      respondingUnit: parsed.respondingUnit,
      isEmergency: parsed.isEmergency,
      // NEPT specific
      isNEPT: parsed.isNEPT,
      pickup: parsed.pickup,
      pickupMapRef: parsed.pickupMapRef,
      destination: parsed.destination,
      destinationMapRef: parsed.destinationMapRef,
      appointment: parsed.appointment,
      callPhone: parsed.callPhone,
      // Ambulance specific
      isAmbulance: parsed.isAmbulance,
      crossStreet1: parsed.crossStreet1,
      crossStreet2: parsed.crossStreet2,
      priorityLocation: parsed.priorityLocation,
      caseType: parsed.caseType,
      caseTypeCode: parsed.caseTypeCode,
      mapArea: parsed.mapArea,
      // Fire/CFA specific
      isFire: parsed.isFire,
      responseArea: parsed.responseArea,
      incidentType: parsed.incidentType,
      incidentTypeCode: parsed.incidentTypeCode,
      gridRef: parsed.gridRef,
      respondingAgencies: parsed.respondingAgencies
    });
    
    // Add resource from alias (unit name from PagerMon capcode table)
    // Disabled: extracted resource codes from message text to avoid duplication
    if (alias) {
      console.log(`Adding resource for case ${effectiveCaseNumber}: ${alias}`);
      db.upsertResource(caseRecord.id, alias, timestamp, alias);
    } else {
      console.log(`No alias for case ${effectiveCaseNumber}`);
    }
    
    // DISABLED: Resources extracted from message text - using alias instead
    // if (parsed.resources && parsed.resources.length > 0) {
    //   for (const resource of parsed.resources) {
    //     db.upsertResource(caseRecord.id, resource, timestamp, null);
    //   }
    // }
    
    // DISABLED: Responding agencies - using alias instead
    // if (parsed.respondingAgencies && parsed.respondingAgencies.length > 0) {
    //   for (const agency of parsed.respondingAgencies) {
    //     db.upsertResource(caseRecord.id, agency, timestamp, null);
    //   }
    // }
  }
  
  return {
    case: caseRecord,
    parsed: parsed,
    messageType: parsed.messageType
  };
}

function getCaseWithDetails(caseNumber) {
  const caseRecord = db.getCaseByNumber(caseNumber);
  
  if (!caseRecord) {
    return null;
  }
  
  const messages = db.getCaseMessages(caseRecord.id);
  const resources = db.getCaseResources(caseRecord.id);
  const services = nconf.get('services') || {};
  const serviceConfig = services[caseRecord.service] || {};
  
  return {
    ...caseRecord,
    messages,
    resources,
    serviceConfig
  };
}

function getActiveCasesByService(service = null) {
  const cases = db.getActiveCases(service);
  const services = nconf.get('services') || {};
  
  return cases.map(c => ({
    ...c,
    serviceConfig: services[c.service] || {},
    resourceCount: db.getCaseResources(c.id).length
  }));
}

function getPriorityCases() {
  const cases = db.getPriorityCases();
  const services = nconf.get('services') || {};
  
  return cases.map(c => ({
    ...c,
    serviceConfig: services[c.service] || {},
    resourceCount: db.getCaseResources(c.id).length
  }));
}

function getCasesForMap(service = null) {
  const cases = db.getGeocodedCases(service);
  const services = nconf.get('services') || {};
  
  return cases.map(c => ({
    caseNumber: c.case_number,
    service: c.service,
    address: c.address,
    latitude: c.latitude,
    longitude: c.longitude,
    lastUpdated: c.last_updated,
    serviceConfig: services[c.service] || {}
  }));
}

async function syncFromPagermon(hoursBack = 4, startTime = null, endTime = null) {
  const pagermonDb = db.getPagermonDb();
  
  if (!pagermonDb) {
    console.log('PagerMon database not available for sync');
    return { synced: 0 };
  }
  
  // Calculate time range
  let fromTime, toTime;
  
  if (startTime && endTime) {
    fromTime = Math.floor(new Date(startTime).getTime() / 1000);
    toTime = Math.floor(new Date(endTime).getTime() / 1000);
  } else {
    toTime = Math.floor(Date.now() / 1000);
    fromTime = toTime - (hoursBack * 3600);
  }
  
  // Get messages from PagerMon within date range (sql.js API)
  const result = pagermonDb.exec(`
    SELECT m.id, m.address, m.message, m.source, m.timestamp, m.alias_id, c.agency, c.alias 
    FROM messages m
    LEFT JOIN capcodes c ON m.alias_id = c.id
    WHERE m.timestamp >= ? AND m.timestamp <= ?
    ORDER BY m.timestamp ASC
    LIMIT 5000
  `, [fromTime, toTime]);
  
  // Convert sql.js result to array of objects
  let messages = [];
  if (result && result.length > 0) {
    const columns = result[0].columns;
    const values = result[0].values;
    messages = values.map(row => {
      const obj = {};
      columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    });
  }
  
  console.log(`Found ${messages.length} messages to sync from PagerMon (${new Date(fromTime * 1000).toISOString()} to ${new Date(toTime * 1000).toISOString()})`);
  
  let synced = 0;
  for (const msg of messages) {
    const result = await processMessage(msg);
    if (result) {
      synced++;
    }
  }
  
  console.log(`Synced ${synced} cases from PagerMon`);
  return { synced, total: messages.length, fromTime, toTime };
}

// Get cases within a specific date range (for historical queries)
function getCasesByDateRange(startTime, endTime, service = null) {
  const cadDb = db.getCadDb();
  const services = nconf.get('services') || {};
  
  const fromTime = Math.floor(new Date(startTime).getTime() / 1000);
  const toTime = Math.floor(new Date(endTime).getTime() / 1000);
  
  let query = `
    SELECT * FROM cases 
    WHERE first_seen >= ? AND first_seen <= ?
  `;
  
  const params = [fromTime, toTime];
  
  if (service) {
    query += ' AND service = ?';
    params.push(service);
  }
  
  query += ' ORDER BY last_updated DESC';
  
  // sql.js API
  const result = cadDb.exec(query, params);
  let cases = [];
  if (result && result.length > 0) {
    const columns = result[0].columns;
    const values = result[0].values;
    cases = values.map(row => {
      const obj = {};
      columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    });
  }
  
  return cases.map(c => ({
    ...c,
    serviceConfig: services[c.service] || {},
    resourceCount: db.getCaseResources(c.id).length
  }));
}

// Sync historical data from PagerMon for a specific date range
async function syncDateRange(startDate, endDate) {
  return await syncFromPagermon(0, startDate, endDate);
}

function closeOldCases() {
  const caseTimeout = nconf.get('caseTimeout') || 14400; // 4 hours
  const cutoffTime = Math.floor(Date.now() / 1000) - caseTimeout;
  
  const cadDb = db.getCadDb();
  cadDb.run(`
    UPDATE cases SET status = 'closed' 
    WHERE status = 'active' AND last_updated < ?
  `, [cutoffTime]);
  
  const result = { changes: 0 };
  
  if (result.changes > 0) {
    console.log(`Closed ${result.changes} old cases`);
  }
  
  return result.changes;
}

module.exports = {
  processMessage,
  getCaseWithDetails,
  getActiveCasesByService,
  getPriorityCases,
  getCasesForMap,
  syncFromPagermon,
  syncDateRange,
  getCasesByDateRange,
  closeOldCases
};
