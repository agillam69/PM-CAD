const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const nconf = require('nconf');
const bcrypt = require('bcryptjs');

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
  try { cadDb.run(`ALTER TABLE cases ADD COLUMN incident_level INTEGER DEFAULT 1`); } catch (e) {}
  try { cadDb.run(`ALTER TABLE cases ADD COLUMN is_major INTEGER DEFAULT 0`); } catch (e) {}
  try { cadDb.run(`ALTER TABLE cases ADD COLUMN message_count INTEGER DEFAULT 0`); } catch (e) {}
  try { cadDb.run(`ALTER TABLE cases ADD COLUMN related_cases TEXT`); } catch (e) {}
  try { cadDb.run(`ALTER TABLE cases ADD COLUMN radio_channel TEXT`); } catch (e) {}
  try { cadDb.run(`ALTER TABLE cases ADD COLUMN is_afem INTEGER DEFAULT 0`); } catch (e) {}
  try { cadDb.run(`ALTER TABLE cases ADD COLUMN is_afprs INTEGER DEFAULT 0`); } catch (e) {}
  
  // Auto-print settings table
  cadDb.run(`
    CREATE TABLE IF NOT EXISTS auto_print_capcodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capcode TEXT NOT NULL UNIQUE,
      alias TEXT,
      print_dispatch INTEGER DEFAULT 1,
      print_log INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
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
    CREATE TABLE IF NOT EXISTS case_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      note TEXT NOT NULL,
      author TEXT,
      timestamp INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (case_id) REFERENCES cases(id)
    )
  `);
  
  cadDb.run(`CREATE INDEX IF NOT EXISTS idx_case_notes_case_id ON case_notes(case_id)`);
  
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
  
  // Users table for authentication
  cadDb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT DEFAULT 'viewer',
      is_active INTEGER DEFAULT 1,
      last_login INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  cadDb.run(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
  
  // Create default admin user if no users exist
  const userCount = getOne(cadDb.exec('SELECT COUNT(*) as count FROM users'));
  if (!userCount || userCount.count === 0) {
    const defaultPassword = bcrypt.hashSync('admin', 10);
    cadDb.run(`INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)`,
      ['admin', defaultPassword, 'Administrator', 'admin']);
    console.log('Created default admin user (username: admin, password: admin)');
  }
  
  // Add alias_name column if it doesn't exist (migration for existing DBs)
  try {
    cadDb.run(`ALTER TABLE case_resources ADD COLUMN alias_name TEXT`);
  } catch (e) {
    // Column already exists
  }
  
  // Fire unit codes lookup table (user-editable)
  cadDb.run(`
    CREATE TABLE IF NOT EXISTS fire_unit_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'unit',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  cadDb.run(`CREATE INDEX IF NOT EXISTS idx_fire_unit_codes_code ON fire_unit_codes(code)`);
  
  // Seed some default fire unit codes if table is empty
  const unitCount = getOne(cadDb.exec('SELECT COUNT(*) as count FROM fire_unit_codes'));
  if (!unitCount || unitCount.count === 0) {
    const defaultUnits = [
      // Pumper Tankers
      ['PT1', 'Pumper Tanker 1', 'appliance'],
      ['PT2', 'Pumper Tanker 2', 'appliance'],
      ['PT3', 'Pumper Tanker 3', 'appliance'],
      ['PT4', 'Pumper Tanker 4', 'appliance'],
      ['PT5', 'Pumper Tanker 5', 'appliance'],
      ['PT6', 'Pumper Tanker 6', 'appliance'],
      // Pumpers
      ['P1', 'Pumper 1', 'appliance'],
      ['P2', 'Pumper 2', 'appliance'],
      ['P12', 'Pumper 12', 'appliance'],
      ['P13', 'Pumper 13', 'appliance'],
      ['P43', 'Pumper 43', 'appliance'],
      // Tankers
      ['T1', 'Tanker 1', 'appliance'],
      ['T2', 'Tanker 2', 'appliance'],
      // Rescue
      ['R1', 'Rescue 1', 'appliance'],
      ['R44', 'Rescue 44', 'appliance'],
      // Aerial
      ['LP1', 'Ladder Platform 1', 'appliance'],
      ['HP1', 'Hazmat Pumper 1', 'appliance'],
      // BA Support
      ['BS38', 'BA Support 38', 'appliance'],
      // CFA Stations
      ['CPKHM', 'CFA Pakenham', 'appliance'],
      ['CMONT', 'CFA Montrose', 'appliance'],
      // SES Units
      ['NARNR', 'Nar Nar Goon Rescue', 'appliance'],
      ['PAKE1', 'Pakenham SES 1', 'appliance'],
      // More Pumpers
      ['P93', 'Pumper 93', 'appliance'],
      ['P26A', 'Pumper 26A', 'appliance'],
      // Commanders (add your own via Settings)
      ['DWOO', 'Commander D Wood', 'commander'],
      // Case type indicators
      ['AFPR', 'Ambulance/Fire/Police/Rescue', 'unit'],
      // Radio channels (excluded from resources)
      ['FGD', 'Fireground Channel', 'radio']
    ];
    
    for (const [code, name, type] of defaultUnits) {
      try {
        cadDb.run('INSERT INTO fire_unit_codes (code, name, type) VALUES (?, ?, ?)', [code, name, type]);
      } catch (e) {
        // Ignore duplicates
      }
    }
    console.log('Created default fire unit codes');
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
        related_cases = COALESCE(?, related_cases),
        radio_channel = COALESCE(?, radio_channel),
        is_afem = COALESCE(?, is_afem),
        is_afprs = COALESCE(?, is_afprs),
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
      caseData.relatedCases || null,
      caseData.radioChannel || null,
      caseData.isAFEM ? 1 : 0,
      caseData.isAFPRS ? 1 : 0,
      caseData.timestamp,
      caseData.caseNumber
    ]);
  } else {
    // Insert
    cadDb.run(`
      INSERT INTO cases (case_number, service, address, latitude, longitude, map_ref, status, is_priority, priority_reason, incident_type, incident_description, signal_code, response_code, patient_info, related_cases, radio_channel, is_afem, is_afprs, first_seen, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      caseData.relatedCases || null,
      caseData.radioChannel || null,
      caseData.isAFEM ? 1 : 0,
      caseData.isAFPRS ? 1 : 0,
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
  const testMode = false;
  
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
  
  // Update message count and check for Level 2 escalation
  // Count UNIQUE messages only (exclude duplicates from different sources)
  const uniqueMessageCount = getOne(cadDb.exec(`SELECT COUNT(DISTINCT message) as count FROM case_messages WHERE case_id = ?`, [caseId]));
  const uniqueCount = uniqueMessageCount ? uniqueMessageCount.count : 1;
  
  // Total message count (for display)
  const totalMessageCount = getOne(cadDb.exec(`SELECT COUNT(*) as count FROM case_messages WHERE case_id = ?`, [caseId]));
  const totalCount = totalMessageCount ? totalMessageCount.count : 1;
  
  // Auto-escalate to Level 2 if 6+ UNIQUE messages (not duplicates from different sources)
  const newLevel = uniqueCount >= 6 ? 2 : 1;
  cadDb.run(`UPDATE cases SET message_count = ?, incident_level = MAX(incident_level, ?) WHERE id = ?`, [totalCount, newLevel, caseId]);
  
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

// Note operations
function addCaseNote(caseId, note, author = null) {
  const timestamp = Math.floor(Date.now() / 1000);
  cadDb.run(`
    INSERT INTO case_notes (case_id, note, author, timestamp)
    VALUES (?, ?, ?, ?)
  `, [caseId, note, author, timestamp]);
  saveDb();
  return { changes: 1, timestamp };
}

function getCaseNotes(caseId) {
  return resultToObjects(cadDb.exec(`
    SELECT * FROM case_notes 
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

// Mark/unmark case as major incident
function setMajorIncident(caseNumber, isMajor) {
  cadDb.run('UPDATE cases SET is_major = ? WHERE case_number = ?', [isMajor ? 1 : 0, caseNumber]);
  saveDb();
  return { changes: 1 };
}

// Get major incidents (never timeout)
function getMajorIncidents() {
  return resultToObjects(cadDb.exec(`
    SELECT * FROM cases 
    WHERE is_major = 1 AND status = 'active'
    ORDER BY last_updated DESC
  `));
}

// Get Level 2+ incidents
function getEscalatedIncidents() {
  return resultToObjects(cadDb.exec(`
    SELECT * FROM cases 
    WHERE incident_level >= 2 AND status = 'active'
    ORDER BY last_updated DESC
  `));
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
// Major incidents and Level 2+ incidents have longer timeout (4 hours)
function closeOldCases(timeoutSeconds = 3600) {
  const cutoffTime = Math.floor(Date.now() / 1000) - timeoutSeconds;
  const majorCutoffTime = Math.floor(Date.now() / 1000) - (timeoutSeconds * 4); // 4x longer for major/level2
  
  // Close regular cases after normal timeout
  cadDb.run(`
    UPDATE cases SET status = 'closed' 
    WHERE status = 'active' AND last_updated < ? AND is_major = 0 AND incident_level < 2
  `, [cutoffTime]);
  
  // Close Level 2 incidents after extended timeout (but not major incidents)
  cadDb.run(`
    UPDATE cases SET status = 'closed' 
    WHERE status = 'active' AND last_updated < ? AND is_major = 0 AND incident_level >= 2
  `, [majorCutoffTime]);
  
  // Major incidents are NEVER auto-closed - must be manually disabled
  
  saveDb();
}

// User management functions
function getUserByUsername(username) {
  return getOne(cadDb.exec('SELECT * FROM users WHERE username = ?', [username]));
}

function getUserById(id) {
  return getOne(cadDb.exec('SELECT * FROM users WHERE id = ?', [id]));
}

function getAllUsers() {
  return resultToObjects(cadDb.exec('SELECT id, username, display_name, role, is_active, last_login, created_at FROM users ORDER BY username'));
}

function createUser(username, password, displayName, role = 'viewer') {
  const passwordHash = bcrypt.hashSync(password, 10);
  try {
    cadDb.run(`INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)`,
      [username, passwordHash, displayName, role]);
    saveDb();
    return { success: true };
  } catch (e) {
    return { success: false, error: 'Username already exists' };
  }
}

function updateUser(id, updates) {
  const fields = [];
  const values = [];
  
  if (updates.displayName !== undefined) {
    fields.push('display_name = ?');
    values.push(updates.displayName);
  }
  if (updates.role !== undefined) {
    fields.push('role = ?');
    values.push(updates.role);
  }
  if (updates.isActive !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.isActive ? 1 : 0);
  }
  if (updates.password) {
    fields.push('password_hash = ?');
    values.push(bcrypt.hashSync(updates.password, 10));
  }
  
  if (fields.length === 0) return { success: false, error: 'No fields to update' };
  
  values.push(id);
  cadDb.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
  saveDb();
  return { success: true };
}

function deleteUser(id) {
  cadDb.run('DELETE FROM users WHERE id = ?', [id]);
  saveDb();
  return { success: true };
}

function validatePassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}

function updateLastLogin(userId) {
  const now = Math.floor(Date.now() / 1000);
  cadDb.run('UPDATE users SET last_login = ? WHERE id = ?', [now, userId]);
  saveDb();
}

// Fire unit codes management
function getAllFireUnitCodes() {
  return resultToObjects(cadDb.exec('SELECT * FROM fire_unit_codes ORDER BY type, code'));
}

function getFireUnitCode(code) {
  return getOne(cadDb.exec('SELECT * FROM fire_unit_codes WHERE code = ?', [code.toUpperCase()]));
}

function addFireUnitCode(code, name, type = 'unit') {
  try {
    cadDb.run('INSERT INTO fire_unit_codes (code, name, type) VALUES (?, ?, ?)', 
      [code.toUpperCase(), name, type]);
    saveDb();
    return { success: true };
  } catch (e) {
    return { success: false, error: 'Code already exists' };
  }
}

function updateFireUnitCode(id, code, name, type) {
  cadDb.run('UPDATE fire_unit_codes SET code = ?, name = ?, type = ? WHERE id = ?',
    [code.toUpperCase(), name, type, id]);
  saveDb();
  return { success: true };
}

function deleteFireUnitCode(id) {
  cadDb.run('DELETE FROM fire_unit_codes WHERE id = ?', [id]);
  saveDb();
  return { success: true };
}

// Lookup unit code and return display name
function lookupFireUnitCode(code) {
  const unit = getOne(cadDb.exec('SELECT * FROM fire_unit_codes WHERE code = ?', [code.toUpperCase()]));
  return unit ? unit.name : null;
}

// Auto-print capcode management
function getAllAutoPrintCapcodes() {
  return resultToObjects(cadDb.exec('SELECT * FROM auto_print_capcodes ORDER BY alias, capcode'));
}

function getAutoPrintCapcode(capcode) {
  return getOne(cadDb.exec('SELECT * FROM auto_print_capcodes WHERE capcode = ?', [capcode]));
}

function addAutoPrintCapcode(capcode, alias, printDispatch = true, printLog = false) {
  try {
    cadDb.run('INSERT INTO auto_print_capcodes (capcode, alias, print_dispatch, print_log, enabled) VALUES (?, ?, ?, ?, 1)', 
      [capcode, alias || null, printDispatch ? 1 : 0, printLog ? 1 : 0]);
    saveDb();
    return { success: true };
  } catch (e) {
    return { success: false, error: 'Capcode already exists' };
  }
}

function updateAutoPrintCapcode(id, capcode, alias, printDispatch, printLog, enabled) {
  cadDb.run('UPDATE auto_print_capcodes SET capcode = ?, alias = ?, print_dispatch = ?, print_log = ?, enabled = ? WHERE id = ?',
    [capcode, alias || null, printDispatch ? 1 : 0, printLog ? 1 : 0, enabled ? 1 : 0, id]);
  saveDb();
  return { success: true };
}

function deleteAutoPrintCapcode(id) {
  cadDb.run('DELETE FROM auto_print_capcodes WHERE id = ?', [id]);
  saveDb();
  return { success: true };
}

// Check if a capcode should auto-print and return settings
function isCapcodeAutoPrint(capcode) {
  const setting = getOne(cadDb.exec('SELECT * FROM auto_print_capcodes WHERE capcode = ? AND enabled = 1', [capcode]));
  return setting || null;
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
  setMajorIncident,
  getMajorIncidents,
  getEscalatedIncidents,
  getGeocodedCases,
  addUnknownMessage,
  getUnknownMessages,
  addMessage,
  getMessages,
  getMessagesByDateRange,
  closeOldCases,
  fixCaseServiceFromPrefix,
  addCaseNote,
  getCaseNotes,
  // User management
  getUserByUsername,
  getUserById,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  validatePassword,
  updateLastLogin,
  // Fire unit codes
  getAllFireUnitCodes,
  getFireUnitCode,
  addFireUnitCode,
  updateFireUnitCode,
  deleteFireUnitCode,
  lookupFireUnitCode,
  // Auto-print capcodes
  getAllAutoPrintCapcodes,
  getAutoPrintCapcode,
  addAutoPrintCapcode,
  updateAutoPrintCapcode,
  deleteAutoPrintCapcode,
  isCapcodeAutoPrint
};
