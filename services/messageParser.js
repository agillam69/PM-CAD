const nconf = require('nconf');

// Track recent cases for unit message association
let recentCases = [];
const MAX_RECENT_CASES = 50;

function parseMessage(message, agency, alias = null) {
  const config = nconf.get('parsing') || {};
  const services = nconf.get('services') || {};
  const messageFilters = nconf.get('messageFilters') || {};
  
  // Check configurable exclude patterns first (before stripping prefixes)
  const excludePatterns = messageFilters.excludePatterns || [];
  const excludeReasons = messageFilters.excludeReasons || {};
  
  for (const pattern of excludePatterns) {
    try {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(message)) {
        const reason = excludeReasons[pattern] || 'Filtered by pattern';
        return {
          caseNumber: null,
          service: 'other',
          address: null,
          mapRef: null,
          resources: [],
          messageType: 'system',
          isFiltered: true,
          filterReason: reason,
          filterPattern: pattern,
          pagerMode: 'unknown'
        };
      }
    } catch (e) {
      console.error('Invalid filter regex pattern:', pattern, e);
    }
  }
  
  // Check priority patterns
  const priorityPatterns = messageFilters.priorityPatterns || [];
  const priorityReasons = messageFilters.priorityReasons || {};
  let isPriority = false;
  let priorityReason = null;
  let priorityPattern = null;
  
  for (const pattern of priorityPatterns) {
    try {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(message)) {
        isPriority = true;
        priorityReason = priorityReasons[pattern] || 'Priority match';
        priorityPattern = pattern;
        break;
      }
    } catch (e) {
      console.error('Invalid priority regex pattern:', pattern, e);
    }
  }
  
  // Detect and strip pager mode prefixes (first 2 characters)
  // @@ = Emergency, )& = Data/OTAP, Hb = Non-Emergency, QD = Admin
  let pagerMode = 'unknown';
  let cleanMessage = message || '';
  
  if (cleanMessage.startsWith('@@')) {
    pagerMode = 'emergency';
    cleanMessage = cleanMessage.substring(2);
  } else if (cleanMessage.startsWith(')&')) {
    pagerMode = 'data';
    cleanMessage = cleanMessage.substring(2);
  } else if (cleanMessage.startsWith('Hb')) {
    pagerMode = 'non-emergency';
    cleanMessage = cleanMessage.substring(2);
  } else if (cleanMessage.startsWith('QD')) {
    pagerMode = 'admin';
    cleanMessage = cleanMessage.substring(2);
  }
  
  // Filter out admin messages (QD prefix)
  if (pagerMode === 'admin') {
    return {
      caseNumber: null,
      service: 'other',
      address: null,
      mapRef: null,
      resources: [],
      messageType: 'admin',
      isFiltered: true,
      filterReason: 'Admin Message',
      pagerMode: pagerMode
    };
  }
  
  // Determine service type from agency
  let service = determineService(agency, services);
  
  // Check if this is an unknown/unspecified alias
  const isUnknownAlias = !alias || alias === '' || 
    alias.toLowerCase().includes('unknown') || 
    alias.toLowerCase().includes('unspecified');
  
  // Extract case number (use cleanMessage without pager prefix)
  const caseNumber = extractCaseNumber(cleanMessage, config.caseNumberPatterns);
  
  // Determine case type flags based on prefix
  let isREFCOM = false;  // J cases - Referral/non-emergency ambulance
  let isERTCOM = false;  // E cases - Emergency ambulance
  let isNETCOM = false;  // N cases - NEPT
  
  // Override service based on case number prefix
  // E = ERTCOM (Emergency Ambulance), N = NETCOM (NEPT), F = Fire, J = REFCOM, S = SES
  if (caseNumber && caseNumber.startsWith('N')) {
    service = 'nept';
    isNETCOM = true;
  } else if (caseNumber && caseNumber.startsWith('F')) {
    service = 'fire';
  } else if (caseNumber && caseNumber.startsWith('S')) {
    service = 'ses';
  } else if (caseNumber && caseNumber.startsWith('J')) {
    service = 'ambulance'; // REFCOM - referral/non-emergency ambulance
    isREFCOM = true;
  } else if (caseNumber && caseNumber.startsWith('E')) {
    service = 'ambulance'; // ERTCOM - emergency ambulance
    isERTCOM = true;
  }
  
  // Extract address (including GPS coordinates) - use cleanMessage
  const addressResult = extractAddressWithGPS(cleanMessage, config.addressPatterns);
  
  // Extract map reference - use cleanMessage
  const mapRef = extractMapRef(cleanMessage, config.mapRefPatterns);
  
  // Extract resources/units - use cleanMessage
  const resources = extractResources(cleanMessage, config.resourcePatterns);
  
  // Extract additional dispatch info - use cleanMessage
  const dispatchInfo = extractDispatchInfo(cleanMessage);
  
  // Check for multi-part message (Part X of Y)
  const multiPartMatch = cleanMessage.match(/\(Part\s*(\d+)\s*of\s*(\d+)\)/i);
  const isMultiPart = !!multiPartMatch;
  const partNumber = multiPartMatch ? parseInt(multiPartMatch[1]) : null;
  const totalParts = multiPartMatch ? parseInt(multiPartMatch[2]) : null;
  
  // Determine message type
  let messageType = 'dispatch'; // default
  if (!caseNumber && resources.length > 0) {
    messageType = 'unit'; // Unit message without case number
  } else if (!caseNumber && !addressResult.address) {
    messageType = 'status'; // Status/admin message
  }
  
  // Multi-part continuation messages should be associated with the alias's recent case
  if (isMultiPart && !caseNumber && alias) {
    messageType = 'continuation';
  }
  
  // For unit messages or continuation messages WITHOUT a case number, try to associate with recent case
  // IMPORTANT: If the message has its own case number, use that - don't associate with another case
  let associatedCaseNumber = caseNumber;
  if (!caseNumber && (messageType === 'unit' || messageType === 'continuation')) {
    // First try to find by alias
    if (alias) {
      associatedCaseNumber = findRecentCaseForAlias(alias, service);
    }
    // Fall back to resource matching
    if (!associatedCaseNumber && resources.length > 0) {
      associatedCaseNumber = findRecentCaseForUnit(resources, service);
    }
  }
  
  // Track this case if it has a case number (include alias for multi-part message tracking)
  if (caseNumber) {
    trackRecentCase(caseNumber, service, resources, alias);
  }
  
  // Determine if emergency (N-coded cases are NEPT = non-emergency)
  const isEmergency = caseNumber && !caseNumber.startsWith('N');
  
  // For NEPT, use destination as primary address if no address extracted
  let finalAddress = addressResult.address;
  if (dispatchInfo.isNEPT && !finalAddress && dispatchInfo.destination) {
    finalAddress = dispatchInfo.destination;
  }
  
  // Use appropriate map ref based on message type
  let finalMapRef = mapRef;
  if (dispatchInfo.isNEPT && dispatchInfo.destinationMapRef) {
    finalMapRef = dispatchInfo.destinationMapRef;
  } else if (dispatchInfo.isFire && dispatchInfo.destinationMapRef) {
    finalMapRef = dispatchInfo.destinationMapRef;
  }
  
  return {
    caseNumber,
    associatedCaseNumber,
    service,
    address: finalAddress,
    isGPSLocation: addressResult.isGPS,
    gpsCoordinates: addressResult.gpsCoordinates,
    mapRef: finalMapRef,
    resources,
    raw: message,
    agency,
    alias,
    isUnknownAlias,
    messageType,
    isEmergency,
    // Multi-part message info
    isMultiPart,
    partNumber,
    totalParts,
    // Emergency dispatch info
    signal: dispatchInfo.signal,
    requestTime: dispatchInfo.requestTime,
    dispatchTime: dispatchInfo.dispatchTime,
    respondingUnit: dispatchInfo.respondingUnit,
    // Ambulance specific
    isAmbulance: dispatchInfo.isAmbulance,
    crossStreet1: dispatchInfo.crossStreet1,
    crossStreet2: dispatchInfo.crossStreet2,
    priorityLocation: dispatchInfo.priorityLocation,
    caseType: dispatchInfo.caseType,
    caseTypeCode: dispatchInfo.caseTypeCode,
    mapArea: dispatchInfo.mapArea,
    // NEPT specific
    isNEPT: dispatchInfo.isNEPT,
    pickup: dispatchInfo.pickup,
    pickupMapRef: dispatchInfo.pickupMapRef,
    destination: dispatchInfo.destination,
    destinationMapRef: dispatchInfo.destinationMapRef,
    appointment: dispatchInfo.appointment,
    callPhone: dispatchInfo.callPhone,
    // Fire/CFA specific
    isFire: dispatchInfo.isFire,
    responseArea: dispatchInfo.responseArea,
    incidentType: dispatchInfo.incidentType,
    incidentTypeCode: dispatchInfo.incidentTypeCode,
    gridRef: dispatchInfo.gridRef,
    respondingAgencies: dispatchInfo.respondingAgencies,
    // Case type flags
    isREFCOM,   // J cases - Referral ambulance
    isERTCOM,   // E cases - Emergency ambulance  
    isNETCOM,   // N cases - NEPT
    // Pager mode
    pagerMode,  // emergency, non-emergency, data, admin, unknown
    // Priority flags
    isPriority,
    priorityReason,
    priorityPattern
  };
}

// Extract dispatch info (SIG, REQ, DSP times, responding unit)
function extractDispatchInfo(message) {
  const info = {
    signal: null,
    requestTime: null,
    dispatchTime: null,
    respondingUnit: null,
    // Ambulance specific fields
    isAmbulance: false,
    crossStreet1: null,
    crossStreet2: null,
    priorityLocation: null,
    caseType: null,
    caseTypeCode: null,
    mapArea: null,
    // NEPT specific fields
    isNEPT: false,
    pickup: null,
    pickupMapRef: null,
    destination: null,
    destinationMapRef: null,
    appointment: null,
    callPhone: null,
    // Fire/CFA specific fields
    isFire: false,
    responseArea: null,
    incidentType: null,
    incidentTypeCode: null,
    gridRef: null,
    respondingAgencies: null
  };
  
  // Check if this is a Fire/CFA message (contains F followed by 9 digits at end, or starts with response area code)
  const fireMatch = message.match(/\bF(\d{9})\b/);
  if (fireMatch) {
    info.isFire = true;
    
    // Response area (first word, e.g., MINH3)
    const areaMatch = message.match(/^([A-Z]{2,5}\d?)\s/);
    if (areaMatch) {
      info.responseArea = areaMatch[1];
    }
    
    // Incident type code (e.g., G&SC1, ALAR1, STRU1)
    const incidentMatch = message.match(/\s([A-Z&]{1,6}\d)\s/);
    if (incidentMatch) {
      info.incidentTypeCode = incidentMatch[1];
      info.incidentType = getFireIncidentType(incidentMatch[1]);
    }
    
    // Map reference (e.g., 474 K11)
    const mapMatch = message.match(/\b(\d{2,3}\s*[A-Z]\d{1,2})\b/);
    if (mapMatch) {
      info.destinationMapRef = mapMatch[1];
    }
    
    // Grid reference (6 digits in parentheses)
    const gridMatch = message.match(/\((\d{6})\)/);
    if (gridMatch) {
      info.gridRef = gridMatch[1];
    }
    
    // Responding agencies (single letter before case number: F, A, S)
    const agencyMatch = message.match(/\s([FAS])\s+[A-Z]{3,}/);
    if (agencyMatch) {
      const agencies = [];
      if (message.includes(' F ')) agencies.push('Fire');
      if (message.includes(' A ')) agencies.push('Ambulance');
      if (message.includes(' S ')) agencies.push('SES');
      info.respondingAgencies = agencies.join(', ');
    }
    
    return info;
  }
  
  // Check if this is a NEPT message (starts with N followed by digits)
  if (/^N\d{9}/.test(message)) {
    info.isNEPT = true;
    
    // DT: Dispatch Time (DT:1152 = 11:52)
    const dtMatch = message.match(/DT[:\s]*(\d{4})/i);
    if (dtMatch) {
      const time = dtMatch[1];
      info.dispatchTime = time.substring(0, 2) + ':' + time.substring(2);
    }
    
    // PU: Pickup location
    const puMatch = message.match(/PU[:\s]*([^P]+?)(?=PURef|APT|DST|$)/i);
    if (puMatch) {
      info.pickup = puMatch[1].trim().replace(/\s+/g, ' ');
    }
    
    // PURef: Pickup map reference (Melways format: 74 G7)
    const puRefMatch = message.match(/PURef[:\s]*(\d+\s*[A-Z]\d+)/i);
    if (puRefMatch) {
      info.pickupMapRef = puRefMatch[1].trim();
    }
    
    // APT: Appointment time
    const aptMatch = message.match(/APT[:\s]*([^D]+?)(?=DST|$)/i);
    if (aptMatch) {
      const apt = aptMatch[1].trim();
      if (apt && apt.length > 0) {
        info.appointment = apt;
      }
    }
    
    // DST: Destination (everything between DST: and M or CallPh)
    const dstMatch = message.match(/DST[:\s]*(.+?)(?=\sM\s+\d|CallPh|$)/i);
    if (dstMatch) {
      info.destination = dstMatch[1].trim().replace(/\s+/g, ' ');
    }
    
    // M: Destination map reference (Melways format: 73 D3)
    const mapMatch = message.match(/\sM\s+(\d+\s*[A-Z]\d+)/i);
    if (mapMatch) {
      info.destinationMapRef = mapMatch[1].trim();
    }
    
    // CallPh: Phone number
    const phoneMatch = message.match(/CallPh[:\s]*(\d+)/i);
    if (phoneMatch) {
      info.callPhone = phoneMatch[1];
    }
    
    return info;
  }
  
  // Emergency (E-coded) Ambulance message parsing
  // Check if this is an E-coded ambulance message
  if (/^E\d{11}/.test(message)) {
    info.isAmbulance = true;
  }
  
  // Signal (SIG1 = Lights & Sirens/Code 1, SIG2 = No lights/Code 2, etc.)
  const sigMatch = message.match(/SIG(\d)/i);
  if (sigMatch) {
    info.signal = parseInt(sigMatch[1]);
  }
  
  // Responding unit - typically 4 letters + 4 digits (e.g., EPSM7881, KYNN7517)
  const unitMatch = message.match(/SIG\d\s+([A-Z]{4}\d{4})/i);
  if (unitMatch) {
    info.respondingUnit = unitMatch[1];
  }
  
  // Request time (REQ1129 = 11:29)
  const reqMatch = message.match(/REQ(\d{4})/i);
  if (reqMatch) {
    const time = reqMatch[1];
    info.requestTime = time.substring(0, 2) + ':' + time.substring(2);
  }
  
  // Dispatch time (DSP1150 = 11:50)
  const dspMatch = message.match(/DSP(\d{4})/i);
  if (dspMatch) {
    const time = dspMatch[1];
    info.dispatchTime = time.substring(0, 2) + ':' + time.substring(2);
  }
  
  // Cross streets (/ = first cross street, // = second cross street)
  const crossMatch = message.match(/\/([A-Z0-9\s]+?)(?=\s*\/\/|\s*:@)/i);
  if (crossMatch) {
    info.crossStreet1 = crossMatch[1].trim();
  }
  const cross2Match = message.match(/\/\/([A-Z0-9\s]+?)(?=\s*:@)/i);
  if (cross2Match) {
    info.crossStreet2 = cross2Match[1].trim();
  }
  
  // Priority location (:@PT.UNKNOWN, :@PT.KNOWN, etc.)
  const priorityMatch = message.match(/:@(PT\.[A-Z]+)/i);
  if (priorityMatch) {
    info.priorityLocation = priorityMatch[1];
  }
  
  // Map area and reference (SVVB NW 8205 C9)
  const mapAreaMatch = message.match(/\s(SV[A-Z]{2})\s+([A-Z]{1,2})\s+(\d{4})\s+([A-Z]\d+)/i);
  if (mapAreaMatch) {
    info.mapArea = mapAreaMatch[1];
    info.destinationMapRef = `${mapAreaMatch[2]} ${mapAreaMatch[3]} ${mapAreaMatch[4]}`;
  }
  
  // Case type code (CC: AMB~ASST~R - A AMBULANCE ASSIST - RESPONSE)
  const caseTypeMatch = message.match(/CC:\s*([A-Z~]+)\s*-\s*([A-Z])\s+(.+?)$/i);
  if (caseTypeMatch) {
    info.caseTypeCode = caseTypeMatch[1];
    info.caseType = caseTypeMatch[3].trim();
  }
  
  return info;
}

// Get human-readable fire incident type from code
function getFireIncidentType(code) {
  const types = {
    'G&SC': 'Grass & Scrub Fire',
    'STRU': 'Structure Fire',
    'ALAR': 'Alarm',
    'ALARC': 'Alarm Code',
    'INCA': 'Incident Alarm',
    'INCIC': 'Incident Code',
    'RESC': 'Rescue',
    'HAZM': 'Hazmat',
    'ASST': 'Assist Other Agency',
    'TREE': 'Tree Down',
    'WASH': 'Washaway',
    'FLOO': 'Flood',
    'STOR': 'Storm Damage',
    'BURN': 'Burn Off',
    'INVE': 'Investigation',
    'SERV': 'Service Call',
    'VEHI': 'Vehicle Fire',
    'OTHR': 'Other',
    'SF': 'Structure Fire',
    'NOSTC': 'Non-Structure Fire',
    'AAFIP': 'AFIP FIP Activation',
    'IN': 'Incident'
  };
  
  // Remove trailing number/letter from code (e.g., G&SC1 -> G&SC, SF1A -> SF)
  const baseCode = code.replace(/\d+[A-Z]?$/, '').replace(/\d+$/, '');
  return types[baseCode] || code;
}

// Get signal code description
function getSignalDescription(signal) {
  const signals = {
    0: 'Priority 0 - Highest Priority',
    1: 'Code 1 - Lights & Sirens',
    2: 'Code 2 - No Lights & Sirens',
    3: 'Code 3 - Non-Emergency',
    27: 'Peer Support Request',
    40: 'DURESS Activation',
    83: 'Death'
  };
  return signals[signal] || `Signal ${signal}`;
}

// Track recent cases for unit message association
// Also track by alias for multi-part message association
let recentCasesByAlias = new Map();

function trackRecentCase(caseNumber, service, resources, alias = null) {
  // Remove if already exists
  recentCases = recentCases.filter(c => c.caseNumber !== caseNumber);
  
  // Add to front
  recentCases.unshift({
    caseNumber,
    service,
    resources: new Set(resources),
    timestamp: Date.now()
  });
  
  // Trim to max size
  if (recentCases.length > MAX_RECENT_CASES) {
    recentCases = recentCases.slice(0, MAX_RECENT_CASES);
  }
  
  // Track by alias for continuation messages
  if (alias) {
    recentCasesByAlias.set(alias.toUpperCase(), {
      caseNumber,
      service,
      timestamp: Date.now()
    });
  }
}

// Find recent case for an alias (for multi-part/continuation messages)
function findRecentCaseForAlias(alias, service) {
  if (!alias) return null;
  
  const recent = recentCasesByAlias.get(alias.toUpperCase());
  if (recent && Date.now() - recent.timestamp < 60 * 60 * 1000) { // Within 1 hour
    return recent.caseNumber;
  }
  
  return null;
}

// Find recent case that a unit message might belong to
function findRecentCaseForUnit(resources, service) {
  if (resources.length === 0) return null;
  
  // Look for a recent case with matching resources ONLY
  // Do NOT match by service alone - that causes unrelated cases to merge
  for (const recentCase of recentCases) {
    // Check if any resource matches
    for (const resource of resources) {
      if (recentCase.resources.has(resource)) {
        return recentCase.caseNumber;
      }
    }
  }
  
  return null;
}

// Extract address including GPS coordinate detection
function extractAddressWithGPS(message, patterns) {
  // Check for GPS coordinates first
  const gpsPatterns = [
    /(-?\d{1,3}\.\d{4,})\s*[,\/]\s*(-?\d{1,3}\.\d{4,})/,  // -37.8136, 144.9631
    /LAT[:\s]*(-?\d{1,3}\.\d+)\s*(?:LON|LNG|LONG)[:\s]*(-?\d{1,3}\.\d+)/i,
    /GPS[:\s]*(-?\d{1,3}\.\d+)\s*[,\/]\s*(-?\d{1,3}\.\d+)/i
  ];
  
  for (const gpsPattern of gpsPatterns) {
    const match = message.match(gpsPattern);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      // Validate coordinates (roughly Australia)
      if (lat >= -45 && lat <= -10 && lng >= 110 && lng <= 155) {
        return {
          address: `GPS: ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
          isGPS: true,
          gpsCoordinates: { lat, lng }
        };
      }
    }
  }
  
  // Fall back to regular address extraction
  const address = extractAddress(message, patterns);
  return {
    address,
    isGPS: false,
    gpsCoordinates: null
  };
}

function determineService(agency, services) {
  if (!agency) return 'unknown';
  
  const agencyUpper = agency.toUpperCase();
  
  for (const [serviceKey, serviceConfig] of Object.entries(services)) {
    if (serviceConfig.agencyMatch) {
      for (const match of serviceConfig.agencyMatch) {
        if (agencyUpper.includes(match.toUpperCase())) {
          return serviceKey;
        }
      }
    }
  }
  
  return 'unknown';
}

function extractCaseNumber(message, patterns) {
  if (!patterns || !Array.isArray(patterns)) {
    patterns = [
      '@@?E(\\d{11})',
      '@@?N(\\d{9})',
      '@@?J(\\d{11})',
      '@@?S(\\d{9})',
      'HbE(\\d{11})',
      'HbN(\\d{9})',
      'HbJ(\\d{11})',
      'HbS(\\d{9})',
      '(?:^|\\s)E(\\d{11})',
      '(?:^|\\s)N(\\d{9})',
      '(?:^|\\s)J(\\d{11})',
      '(?:^|\\s)S(\\d{9})',
      '\\bF(\\d{9})\\b'
    ];
  }
  
  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, 'i');
      const match = message.match(regex);
      if (match && match[1]) {
        // Preserve the prefix (E, N, F, J, S) for service detection
        const fullMatch = match[0].trim();
        // Look for the prefix immediately before the digits
        const prefixMatch = fullMatch.match(/([ENFJS])(\d+)$/i);
        if (prefixMatch) {
          return prefixMatch[1].toUpperCase() + prefixMatch[2];
        }
        // Fallback: look for any prefix in the match
        const prefix = fullMatch.match(/[ENFJS](?=\d)/i);
        if (prefix) {
          return prefix[0].toUpperCase() + match[1].trim();
        }
        return match[1].trim();
      }
    } catch (e) {
      console.error('Invalid regex pattern:', pattern, e);
    }
  }
  
  return null;
}

function extractAddress(message, patterns) {
  // Try specific ambulance LOC format first:
  // LOC 7 / 178 NORMANBY ST WARRAGUL /ALEXANDER ST //EISENHOWER ST SVVB SE 8606 A7
  // Format: LOC [address] /[cross1] //[cross2] SVVB [mapref]
  const ambLocMatch = message.match(/LOC\s+(.+?)(?=\s+SVVB\s+|\s+Prob\s+|\s+CC:\s*CC:|\s+Pat:|\s*$)/i);
  if (ambLocMatch) {
    let address = ambLocMatch[1].trim();
    // Extract main address (before first /)
    const parts = address.split(/\s+\/(?!\/)/).map(p => p.trim());
    if (parts.length > 0) {
      // Main address is the first part
      let mainAddress = parts[0];
      // Clean up any trailing cross street markers
      mainAddress = mainAddress.replace(/\s*\/\/.*$/, '').trim();
      return mainAddress;
    }
    return address;
  }
  
  if (!patterns || !Array.isArray(patterns)) {
    patterns = ['(?:AT|LOC|@|ADDR)\\s*[:]?\\s*(.+?)(?=\\s*(?:MAP|XST|UNITS|SVVB|Prob|CC:|$))'];
  }
  
  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, 'i');
      const match = message.match(regex);
      if (match && match[1]) {
        // Clean up the address
        let address = match[1].trim();
        // Remove trailing punctuation and common suffixes
        address = address.replace(/[,;]+$/, '').trim();
        // Remove cross streets (after /)
        address = address.replace(/\s+\/.*$/, '').trim();
        return address;
      }
    } catch (e) {
      console.error('Invalid regex pattern:', pattern, e);
    }
  }
  
  return null;
}

function extractMapRef(message, patterns) {
  // Try SVVB format first: SVVB SE 8606 A7 or SVVB NE 8399 E4
  const svvbMatch = message.match(/SVVB\s+([NSEW]{1,2}\s+\d+\s+[A-Z]\d*)/i);
  if (svvbMatch) {
    return svvbMatch[1].trim();
  }
  
  if (!patterns || !Array.isArray(patterns)) {
    patterns = ['MAP\\s*(\\d+[A-Z]?\\s*\\d+)', 'M\\s+(\\d+\\s+[A-Z]\\d+)'];
  }
  
  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, 'i');
      const match = message.match(regex);
      if (match && match[1]) {
        return match[1].trim();
      }
    } catch (e) {
      console.error('Invalid regex pattern:', pattern, e);
    }
  }
  
  return null;
}

function extractResources(message, patterns) {
  const resources = [];
  
  if (!patterns || !Array.isArray(patterns)) {
    patterns = ['([A-Z]{2,4}\\d{2,4})'];
  }
  
  // Common resource code pattern (e.g., P421, MFB23, CFA01)
  const resourceRegex = /\b([A-Z]{1,4}\d{1,4}[A-Z]?)\b/g;
  let match;
  
  while ((match = resourceRegex.exec(message)) !== null) {
    const code = match[1];
    // Filter out common false positives
    if (!isLikelyResource(code)) continue;
    if (!resources.includes(code)) {
      resources.push(code);
    }
  }
  
  return resources;
}

function isLikelyResource(code) {
  // Filter out things that look like resources but aren't
  const falsePositives = [
    /^MAP\d/i,      // Map references
    /^XST\d/i,      // Cross street
    /^LOC\d/i,      // Location
    /^INC\d/i,      // Incident
    /^JOB\d/i,      // Job number
    /^CAD\d/i,      // CAD reference
    /^REQ\d/i,      // Request time (e.g., REQ1425)
    /^DSP\d/i,      // Dispatch time (e.g., DSP1426)
    /^SIG\d/i,      // Signal code (e.g., SIG1, SIG2)
    /^CC\d/i,       // Call code
    /^M\d/i,        // Map area (e.g., M 402)
    /^[A-Z]\d{1,2}$/i,  // Grid reference (e.g., P4, J10, C9)
    /^PT\d/i,       // Point reference
    /^[ENJFS]\d{9,11}$/i,  // Case numbers
    /^\d{6,}$/      // Pure numbers (likely case numbers)
  ];
  
  for (const fp of falsePositives) {
    if (fp.test(code)) return false;
  }
  
  // Must have at least one letter and one number
  if (!/[A-Z]/i.test(code) || !/\d/.test(code)) return false;
  
  // Reasonable length - resources are typically 4-8 chars (e.g., WTTN7457, EPSM7881)
  if (code.length < 4 || code.length > 10) return false;
  
  return true;
}

function parseMultipleMessages(messages) {
  const cases = new Map();
  
  for (const msg of messages) {
    const parsed = parseMessage(msg.message, msg.agency);
    
    if (parsed.caseNumber) {
      if (!cases.has(parsed.caseNumber)) {
        cases.set(parsed.caseNumber, {
          caseNumber: parsed.caseNumber,
          service: parsed.service,
          address: parsed.address,
          mapRef: parsed.mapRef,
          resources: new Set(parsed.resources),
          messages: [],
          firstSeen: msg.timestamp,
          lastUpdated: msg.timestamp
        });
      }
      
      const caseData = cases.get(parsed.caseNumber);
      
      // Update with latest info
      if (parsed.address && !caseData.address) {
        caseData.address = parsed.address;
      }
      if (parsed.mapRef && !caseData.mapRef) {
        caseData.mapRef = parsed.mapRef;
      }
      
      // Add resources
      parsed.resources.forEach(r => caseData.resources.add(r));
      
      // Add message
      caseData.messages.push({
        id: msg.id,
        message: msg.message,
        timestamp: msg.timestamp,
        source: msg.source
      });
      
      // Update timestamps
      if (msg.timestamp < caseData.firstSeen) {
        caseData.firstSeen = msg.timestamp;
      }
      if (msg.timestamp > caseData.lastUpdated) {
        caseData.lastUpdated = msg.timestamp;
      }
    }
  }
  
  // Convert Sets to Arrays
  for (const caseData of cases.values()) {
    caseData.resources = Array.from(caseData.resources);
  }
  
  return Array.from(cases.values());
}

module.exports = {
  parseMessage,
  parseMultipleMessages,
  determineService,
  extractCaseNumber,
  extractAddress,
  extractMapRef,
  extractResources
};
