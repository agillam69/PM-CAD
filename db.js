const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const nconf = require('nconf');

let cadDb = null;
let pagermonDb = null;
let SQL = null;
let cadDbPath = null;

async function init() {
  // Initialize SQL.js
  SQL = await initSqlJs();
  
  // Initialize CAD database (our own)
  cadDbPath = path.join(__dirname, 'data', 'cad.db');
  
  // Ensure data directory exists
  const dataDir = path.dirname(cadDbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // Load existing database or create new one
  if (fs.existsSync(cadDbPath)) {
    const buffer = fs.readFileSync(cadDbPath);
    cadDb = new SQL.Database(buffer);
  } else {
    cadDb = new SQL.Database();
  }
  
  // Create tables
  cadDb.run(`
    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_number TEXT UNIQUE NOT NULL,
      service TEXT NOT NULL,
      address TEXT,
      latitude REAL,
      longitude REAL,
      map_ref TEXT,
      status TEXT DEFAULT 'active',
      is_priority INTEGER DEFAULT 0,
      priority_reason TEXT,
      incident_type TEXT,
      incident_description TEXT,
      signal_code TEXT,
      response_code TEXT,
      patient_info TEXT,
      first_seen INTEGER NOT NULL,
      last_updated INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Add new columns if they don't exist (migration)
  try { cadDb.run(`ALTER TABLE cases ADD COLUMN incident_type TEXT`); } catch (e) {}
  try { cadDb.run(`ALTER TABLE cases ADD COLUMN incident_description TEXT`); } catch (e) {}
  try { cadDb.run(`ALTER TABLE cases ADD COLUMN signal_code TEXT`); } catch (e) {}
  try { cadDb.run(`ALTER TABLE cases ADD COLUMN response_code TEXT`); } catch (e) {}
  try { cadDb.run(`ALTER TABLE cases ADD COLUMN patient_info TEXT`); } catch (e) {}
  
  cadDb.run(`CREATE INDEX IF NOT EXISTS idx_cases_case_number ON cases(case_number)`);
  cadDb.run(`CREATE INDEX IF NOT EXISTS idx_cases_service ON cases(service)`);
  cadDb.run(`CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status)`);
  cadDb.run(`CREATE INDEX IF NOT EXISTS idx_cases_last_updated ON cases(last_updated)`);
  
  cadDb.run(`
    CREATE TABLE IF NOT EXISTS case_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      pagermon_message_id INTEGER,
      message TEXT NOT NULL,
      address TEXT,
      timestamp INTEGER NOT NULL,
      source TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (case_id) REFERENCES cases(id)
    )
  `);
  
  cadDb.run(`CREATE INDEX IF NOT EXISTS idx_case_messages_case_id ON case_messages(case_id)`);
  
  cadDb.run(`
    CREATE TABLE IF NOT EXISTS case_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      resource_code TEXT NOT NULL,
      alias_name TEXT,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      status TEXT DEFAULT 'assigned',
      FOREIGN KEY (case_id) REFERENCES cases(id),
      UNIQUE(case_id, resource_code)
    )
  `);
  
  cadDb.run(`CREATE INDEX IF NOT EXISTS idx_case_resources_case_id ON case_resources(case_id)`);
  
  // Add alias_name column if it doesn't exist (migration for existing DBs)
  try {
    cadDb.run(`ALTER TABLE case_resources ADD COLUMN alias_name TEXT`);
  } catch (e) {
    // Column already exists
  }
  
  // Unknown/unspecified alias messages table
  cadDb.run(`
    CREATE TABLE IF NOT EXISTS unknown_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT NOT NULL,
      address TEXT,
      timestamp INTEGER NOT NULL,
      source TEXT,
      alias TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // General messages table (messages without case numbers - group pages, info, etc.)
  cadDb.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT NOT NULL,
      address TEXT,
      timestamp INTEGER NOT NULL,
      source TEXT,
      alias TEXT,
      agency TEXT,
      service TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  cadDb.run(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)`);
  
  // Save initial state
  saveDb();
  
  console.log('CAD database initialized');
  
  // Connect to PagerMon database (read-only)
  const pagermonDbType = nconf.get('pagermon:database:type');
  const pagermonDbFile = nconf.get('pagermon:database:file');
  
  if (pagermonDbType === 'sqlite3' && pagermonDbFile) {
    const pagermonDbPath = path.resolve(__dirname, pagermonDbFile);
    if (fs.existsSync(pagermonDbPath)) {
      const buffer = fs.readFileSync(pagermonDbPath);
      pagermonDb = new SQL.Database(buffer);
      console.log('Connected to PagerMon database (read-only)');
    } else {
      console.warn('PagerMon database not found at:', pagermonDbPath);
    }
  }
  
  return { cadDb, pagermonDb };
}

// Save CAD database to disk
function saveDb() {
  if (cadDb && cadDbPath) {
    const data = cadDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(cadDbPath, buffer);
  }
}

// Helper to convert sql.js results to array of objects
function resultToObjects(result) {
  if (!result || result.length === 0) return [];
  const columns = result[0].columns;
  const values = result[0].values;
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

// Helper to get single row
function getOne(result) {
  const rows = resultToObjects(result);
  return rows.length > 0 ? rows[0] : null;
}

function getCadDb() {
  return cadDb;
}

function getPagermonDb() {
  return pagermonDb;
}

// Case operations
function upsertCase(caseData) {
  // Check if case exists
  const existing = getOne(cadDb.exec('SELECT id FROM cases WHERE case_number = ?', [caseData.caseNumber]));
  
  if (existing) {
    // Update - also update service and priority (priority can be upgraded but not downgraded)
    cadDb.run(`
      UPDATE cases SET
        service = ?,
        address = COALESCE(?, address),
        latitude = COALESCE(?, latitude),
        longitude = COALESCE(?, longitude),
        map_ref = COALESCE(?, map_ref),
        is_priority = CASE WHEN ? = 1 THEN 1 ELSE is_priority END,
        priority_reason = CASE WHEN ? = 1 THEN ? ELSE priority_reason END,
        incident_type = COALESCE(?, incident_type),
        incident_description = COALESCE(?, incident_description),
        signal_code = COALESCE(?, signal_code),
        response_code = COALESCE(?, response_code),
        patient_info = COALESCE(?, patient_info),
        last_updated = ?
      WHERE case_number = ?
    `, [
      caseData.service,
      caseData.address || null,
      caseData.latitude || null,
      caseData.longitude || null,
      caseData.mapRef || null,
      caseData.isPriority ? 1 : 0,
      caseData.isPriority ? 1 : 0,
      caseData.priorityReason || null,
      caseData.incidentType || null,
      caseData.incidentDescription || null,
      caseData.signalCode || null,
      caseData.responseCode || null,
      caseData.patientInfo || null,
      caseData.timestamp,
      caseData.caseNumber
    ]);
  } else {
    // Insert
    cadDb.run(`
      INSERT INTO cases (case_number, service, address, latitude, longitude, map_ref, status, is_priority, priority_reason, incident_type, incident_description, signal_code, response_code, patient_info, first_seen, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      caseData.caseNumber,
      caseData.service,
      caseData.address || null,
      caseData.latitude || null,
      caseData.longitude || null,
      caseData.mapRef || null,
      caseData.status || 'active',
      caseData.isPriority ? 1 : 0,
      caseData.priorityReason || null,
      caseData.incidentType || null,
      caseData.incidentDescription || null,
      caseData.signalCode || null,
      caseData.responseCode || null,
      caseData.patientInfo || null,
      caseData.timestamp,
      caseData.timestamp
    ]);
  }
  
  saveDb();
  return { changes: 1 };
}

function getCaseByNumber(caseNumber) {
  // First try exact match
  let result = getOne(cadDb.exec('SELECT * FROM cases WHERE case_number = ?', [caseNumber]));
  if (result) return result;
  
  // If case number has a prefix (E, N, F, J, S), try without prefix for legacy cases
  if (/^[ENFJS]\d+$/i.test(caseNumber)) {
    const numericPart = caseNumber.substring(1);
    result = getOne(cadDb.exec('SELECT * FROM cases WHERE case_number = ?', [numericPart]));
    if (result) {
      // Update the case number to include the prefix
      cadDb.run('UPDATE cases SET case_number = ? WHERE case_number = ?', [caseNumber, numericPart]);
      saveDb();
      result.case_number = caseNumber;
    }
  }
  
  return result;
}

// Fix existing cases that are missing the prefix
function fixCaseServiceFromPrefix() {
  // Get all cases and check if they need service update based on messages
  const cases = resultToObjects(cadDb.exec('SELECT c.id, c.case_number, c.service, cm.message FROM cases c LEFT JOIN case_messages cm ON c.id = cm.case_id'));
  
  for (const caseRow of cases) {
    if (!caseRow.message) continue;
    
    try {
      // Check for N prefix in message (NEPT)
      const neptMatch = caseRow.message.match(/(?:@@?|Hb)N(\d{9})/i);
      if (neptMatch && caseRow.service !== 'nept') {
        const newCaseNumber = 'N' + neptMatch[1];
        // Check if new case number already exists
        const existing = getOne(cadDb.exec('SELECT id FROM cases WHERE case_number = ?', [newCaseNumber]));
        if (existing && existing.id !== caseRow.id) {
          // Merge: delete this case and keep the existing one
          cadDb.run('DELETE FROM cases WHERE id = ?', [caseRow.id]);
          console.log(`Merged duplicate case ${caseRow.case_number} into ${newCaseNumber}`);
        } else if (!existing) {
          cadDb.run('UPDATE cases SET service = ?, case_number = ? WHERE id = ?', ['nept', newCaseNumber, caseRow.id]);
          console.log(`Fixed case ${caseRow.case_number} -> ${newCaseNumber} (NEPT)`);
        } else {
          // Same case, just update service
          cadDb.run('UPDATE cases SET service = ? WHERE id = ?', ['nept', caseRow.id]);
          console.log(`Fixed service for case ${caseRow.case_number} (NEPT)`);
        }
        continue;
      }
      
      // Check for E prefix in message (Ambulance)
      const ambMatch = caseRow.message.match(/(?:@@?|Hb)E(\d{11})/i);
      if (ambMatch && !caseRow.case_number.startsWith('E')) {
        const newCaseNumber = 'E' + ambMatch[1];
        const existing = getOne(cadDb.exec('SELECT id FROM cases WHERE case_number = ?', [newCaseNumber]));
        if (existing && existing.id !== caseRow.id) {
          cadDb.run('DELETE FROM cases WHERE id = ?', [caseRow.id]);
          console.log(`Merged duplicate case ${caseRow.case_number} into ${newCaseNumber}`);
        } else if (!existing) {
          cadDb.run('UPDATE cases SET case_number = ? WHERE id = ?', [newCaseNumber, caseRow.id]);
          console.log(`Fixed case ${caseRow.case_number} -> ${newCaseNumber}`);
        }
        continue;
      }
      
      // Check for F prefix in message (Fire)
      const fireMatch = caseRow.message.match(/(?:@@?|Hb)?F(\d{9})/i);
      if (fireMatch && caseRow.service !== 'fire' && !caseRow.case_number.startsWith('F')) {
        const newCaseNumber = 'F' + fireMatch[1];
        const existing = getOne(cadDb.exec('SELECT id FROM cases WHERE case_number = ?', [newCaseNumber]));
        if (existing && existing.id !== caseRow.id) {
          cadDb.run('DELETE FROM cases WHERE id = ?', [caseRow.id]);
          console.log(`Merged duplicate case ${caseRow.case_number} into ${newCaseNumber}`);
        } else if (!existing) {
          cadDb.run('UPDATE cases SET service = ?, case_number = ? WHERE id = ?', ['fire', newCaseNumber, caseRow.id]);
          console.log(`Fixed case ${caseRow.case_number} -> ${newCaseNumber} (Fire)`);
        }
      }
    } catch (err) {
      console.error(`Error fixing case ${caseRow.case_number}:`, err.message);
    }
  }
  
  saveDb();
}

function getActiveCases(service = null) {
  // TEST MODE: Disable time filtering for historical data testing
  const testMode = true;
  
  if (testMode) {
    if (service) {
      return resultToObjects(cadDb.exec(`
        SELECT * FROM cases 
        WHERE status = 'active' AND service = ?
        ORDER BY last_updated DESC
        LIMIT 500
      `, [service]));
    }
    
    return resultToObjects(cadDb.exec(`
      SELECT * FROM cases 
      WHERE status = 'active'
      ORDER BY last_updated DESC
      LIMIT 500
    `));
  }
  
  // LIVE MODE: Filter by time
  const caseTimeout = nconf.get('caseTimeout') || 14400;
  const cutoffTime = Math.floor(Date.now() / 1000) - caseTimeout;
  
  if (service) {
    return resultToObjects(cadDb.exec(`
      SELECT * FROM cases 
      WHERE status = 'active' AND last_updated > ? AND service = ?
      ORDER BY last_updated DESC
    `, [cutoffTime, service]));
  }
  
  return resultToObjects(cadDb.exec(`
    SELECT * FROM cases 
    WHERE status = 'active' AND last_updated > ?
    ORDER BY last_updated DESC
  `, [cutoffTime]));
}

function getAllCases(limit = 100, offset = 0) {
  return resultToObjects(cadDb.exec(`
    SELECT * FROM cases 
    ORDER BY last_updated DESC
    LIMIT ? OFFSET ?
  `, [limit, offset]));
}

function getPriorityCases() {
  const caseTimeout = nconf.get('caseTimeout') || 3600;
  const cutoffTime = Math.floor(Date.now() / 1000) - caseTimeout;
  
  return resultToObjects(cadDb.exec(`
    SELECT * FROM cases 
    WHERE status = 'active' AND is_priority = 1 AND last_updated > ?
    ORDER BY last_updated DESC
  `, [cutoffTime]));
}

// Message operations
function addCaseMessage(caseId, messageData) {
  cadDb.run(`
    INSERT INTO case_messages (case_id, pagermon_message_id, message, address, timestamp, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    caseId,
    messageData.pagermonId || null,
    messageData.message,
    messageData.address || null,
    messageData.timestamp,
    messageData.source || null
  ]);
  saveDb();
  return { changes: 1 };
}

function getCaseMessages(caseId) {
  return resultToObjects(cadDb.exec(`
    SELECT * FROM case_messages 
    WHERE case_id = ?
    ORDER BY timestamp ASC
  `, [caseId]));
}

// Resource operations
function upsertResource(caseId, resourceCode, timestamp, aliasName = null) {
  // Skip empty or invalid resource codes
  if (!resourceCode || resourceCode.trim() === '') return { changes: 0 };
  
  const existing = getOne(cadDb.exec(
    'SELECT id FROM case_resources WHERE case_id = ? AND resource_code = ?', 
    [caseId, resourceCode]
  ));
  
  if (existing) {
    cadDb.run('UPDATE case_resources SET last_seen = ?, alias_name = COALESCE(?, alias_name) WHERE case_id = ? AND resource_code = ?',
      [timestamp, aliasName, caseId, resourceCode]);
  } else {
    cadDb.run(`
      INSERT INTO case_resources (case_id, resource_code, alias_name, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?)
    `, [caseId, resourceCode, aliasName, timestamp, timestamp]);
  }
  saveDb();
  return { changes: 1 };
}

function getCaseResources(caseId) {
  return resultToObjects(cadDb.exec(`
    SELECT * FROM case_resources 
    WHERE case_id = ?
    ORDER BY first_seen ASC
  `, [caseId]));
}

// Close case
function closeCase(caseNumber) {
  cadDb.run('UPDATE cases SET status = ? WHERE case_number = ?', ['closed', caseNumber]);
  saveDb();
  return { changes: 1 };
}

// Get cases with geocoding for map
function getGeocodedCases(service = null) {
  // For test mode, don't filter by time
  if (service) {
    return resultToObjects(cadDb.exec(`
      SELECT * FROM cases 
      WHERE status = 'active' 
        AND latitude IS NOT NULL 
        AND longitude IS NOT NULL
        AND service = ?
      ORDER BY last_updated DESC
    `, [service]));
  }
  
  return resultToObjects(cadDb.exec(`
    SELECT * FROM cases 
    WHERE status = 'active' 
      AND latitude IS NOT NULL 
      AND longitude IS NOT NULL
    ORDER BY last_updated DESC
  `));
}

// Add unknown message
function addUnknownMessage(messageData) {
  cadDb.run(`
    INSERT INTO unknown_messages (message, address, timestamp, source, alias)
    VALUES (?, ?, ?, ?, ?)
  `, [
    messageData.message,
    messageData.address || null,
    messageData.timestamp,
    messageData.source || null,
    messageData.alias || null
  ]);
  saveDb();
  return { changes: 1 };
}

// Get unknown messages
function getUnknownMessages(limit = 100) {
  return resultToObjects(cadDb.exec(`
    SELECT * FROM unknown_messages 
    ORDER BY timestamp DESC
    LIMIT ?
  `, [limit]));
}

// Add general message (non-case messages like group pages, info, etc.)
function addMessage(messageData) {
  cadDb.run(`
    INSERT INTO messages (message, address, timestamp, source, alias, agency, service)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    messageData.message,
    messageData.address || null,
    messageData.timestamp,
    messageData.source || null,
    messageData.alias || null,
    messageData.agency || null,
    messageData.service || null
  ]);
  saveDb();
  return { changes: 1 };
}

// Get general messages
function getMessages(limit = 100, service = null) {
  if (service) {
    return resultToObjects(cadDb.exec(`
      SELECT * FROM messages 
      WHERE service = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `, [service, limit]));
  }
  return resultToObjects(cadDb.exec(`
    SELECT * FROM messages 
    ORDER BY timestamp DESC
    LIMIT ?
  `, [limit]));
}

// Get messages by date range
function getMessagesByDateRange(startTime, endTime, service = null) {
  const fromTime = Math.floor(new Date(startTime).getTime() / 1000);
  const toTime = Math.floor(new Date(endTime).getTime() / 1000);
  
  if (service) {
    return resultToObjects(cadDb.exec(`
      SELECT * FROM messages 
      WHERE timestamp >= ? AND timestamp <= ? AND service = ?
      ORDER BY timestamp DESC
    `, [fromTime, toTime, service]));
  }
  return resultToObjects(cadDb.exec(`
    SELECT * FROM messages 
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp DESC
  `, [fromTime, toTime]));
}

// Close old cases (1 hour timeout unless activity)
function closeOldCases(timeoutSeconds = 3600) {
  const cutoffTime = Math.floor(Date.now() / 1000) - timeoutSeconds;
  cadDb.run(`
    UPDATE cases SET status = 'closed' 
    WHERE status = 'active' AND last_updated < ?
  `, [cutoffTime]);
  saveDb();
}

module.exports = {
  init,
  getCadDb,
  getPagermonDb,
  upsertCase,
  getCaseByNumber,
  getActiveCases,
  getAllCases,
  getPriorityCases,
  addCaseMessage,
  getCaseMessages,
  upsertResource,
  getCaseResources,
  closeCase,
  getGeocodedCases,
  addUnknownMessage,
  getUnknownMessages,
  addMessage,
  getMessages,
  getMessagesByDateRange,
  closeOldCases,
  fixCaseServiceFromPrefix
};
