const axios = require('axios');
const nconf = require('nconf');

// Simple in-memory cache for geocoding results
const geocodeCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Rate limiting for Nominatim (max 1 request per second)
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1100; // 1.1 seconds between requests
const requestQueue = [];
let isProcessingQueue = false;

async function geocode(address) {
  if (!address) return null;
  
  // Check cache first
  const cacheKey = address.toLowerCase().trim();
  const cached = geocodeCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.result;
  }
  
  const provider = nconf.get('geocoding:provider') || 'nominatim';
  
  // For Nominatim, use rate-limited queue
  if (provider === 'nominatim') {
    return new Promise((resolve) => {
      requestQueue.push({ address, cacheKey, resolve });
      processQueue();
    });
  }
  
  // For other providers, proceed directly
  return executeGeocode(address, cacheKey, provider);
}

async function processQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  while (requestQueue.length > 0) {
    const { address, cacheKey, resolve } = requestQueue.shift();
    
    // Check cache again (might have been cached while waiting)
    const cached = geocodeCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      resolve(cached.result);
      continue;
    }
    
    // Rate limit: wait if needed
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }
    
    lastRequestTime = Date.now();
    const result = await executeGeocode(address, cacheKey, 'nominatim');
    resolve(result);
  }
  
  isProcessingQueue = false;
}

async function executeGeocode(address, cacheKey, provider) {
  let result = null;
  
  try {
    switch (provider) {
      case 'google':
        result = await geocodeGoogle(address);
        break;
      case 'vicmaps':
        result = await geocodeVicMaps(address);
        // Fall back to Nominatim if VicMaps fails
        if (!result) {
          result = await geocodeNominatim(address);
        }
        break;
      case 'nominatim':
      default:
        result = await geocodeNominatim(address);
        break;
    }
    
    // Cache the result (even null to avoid repeated failed lookups)
    geocodeCache.set(cacheKey, {
      result,
      timestamp: Date.now()
    });
    
    return result;
  } catch (error) {
    // Cache null result to avoid hammering the API
    geocodeCache.set(cacheKey, {
      result: null,
      timestamp: Date.now()
    });
    console.error('Geocoding error:', error.message);
    return null;
  }
}

async function geocodeNominatim(address) {
  const config = nconf.get('geocoding:nominatim') || {};
  const baseUrl = config.url || 'https://nominatim.openstreetmap.org/search';
  const defaultState = config.defaultState || 'Victoria';
  const defaultCountry = config.defaultCountry || 'Australia';
  
  // Build full address
  let fullAddress = address;
  if (defaultState && !address.toLowerCase().includes(defaultState.toLowerCase())) {
    fullAddress += `, ${defaultState}`;
  }
  if (defaultCountry && !address.toLowerCase().includes(defaultCountry.toLowerCase())) {
    fullAddress += `, ${defaultCountry}`;
  }
  
  console.log(`Geocoding: Trying Nominatim for "${fullAddress}"`);
  
  // Try the full address first
  let result = await tryNominatimSearch(baseUrl, fullAddress);
  if (result) {
    console.log(`Geocoding: Success for "${address}" -> ${result.lat}, ${result.lng}`);
    return result;
  }
  
  // For remote locations, try extracting landmark/park names
  const remoteKeywords = ['WALKING TRK', 'TRACK', 'TRAIL', 'CAMPSITE', 'NATIONAL PARK', 'STATE FOREST', 'RESERVE', 'PROMONTORY'];
  const isRemote = remoteKeywords.some(kw => address.toUpperCase().includes(kw));
  
  if (isRemote) {
    // Try to extract the main landmark (e.g., "WILSONS PROMONTORY" from the address)
    const landmarkPatterns = [
      /(?:WILSONS?\s*PROMONTORY|GRAMPIANS|ALPINE|DANDENONG|YARRA\s*RANGES|GREAT\s*OCEAN|OTWAY)/i,
      /([A-Z][A-Z\s]+(?:NATIONAL\s*PARK|STATE\s*FOREST|RESERVE|PROMONTORY))/i,
      /(?:@|:)([A-Z][A-Z\s]+)/  // Text after @ or : often contains location name
    ];
    
    for (const pattern of landmarkPatterns) {
      const match = address.match(pattern);
      if (match) {
        const landmark = (match[1] || match[0]).trim();
        const searchTerm = `${landmark}, ${defaultState || 'Victoria'}, ${defaultCountry}`;
        result = await tryNominatimSearch(baseUrl, searchTerm);
        if (result) return result;
      }
    }
    
    // Try just the last significant words (often the park/area name)
    const words = address.split(/\s+/).filter(w => w.length > 2);
    if (words.length >= 2) {
      // Try last 2-3 words as they often contain the location name
      const lastWords = words.slice(-3).join(' ');
      const searchTerm = `${lastWords}, ${defaultState || 'Victoria'}, ${defaultCountry}`;
      result = await tryNominatimSearch(baseUrl, searchTerm);
      if (result) return result;
    }
  }
  
  return null;
}

async function tryNominatimSearch(baseUrl, query) {
  const params = {
    q: query,
    format: 'json',
    limit: 1,
    addressdetails: 1
  };
  
  try {
    const response = await axios.get(baseUrl, {
      params,
      headers: {
        'User-Agent': 'PagerMon-CAD-Addon/1.0'
      },
      timeout: 10000
    });
    
    if (response.data && response.data.length > 0) {
      const result = response.data[0];
      return {
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon),
        displayName: result.display_name,
        confidence: parseFloat(result.importance) || 0.5,
        source: 'nominatim'
      };
    }
    console.log(`Geocoding: No results from Nominatim for "${query}"`);
  } catch (e) {
    console.log(`Geocoding: Nominatim error for "${query}": ${e.message}`);
  }
  
  return null;
}

// VicMaps ArcGIS Geocoder - Best for Victorian addresses
async function geocodeVicMaps(address) {
  const config = nconf.get('geocoding:vicmaps') || {};
  const baseUrl = config.url || 'https://services.land.vic.gov.au/SpatialDatamart/rest/services/Geocoding/VicMapAddress/GeocodeServer/findAddressCandidates';
  
  // Clean up address for VicMaps
  let searchAddress = address
    .replace(/\s+/g, ' ')
    .trim();
  
  // Add Victoria if not present
  if (!searchAddress.toLowerCase().includes('vic') && !searchAddress.toLowerCase().includes('victoria')) {
    searchAddress += ', VIC';
  }
  
  const params = {
    SingleLine: searchAddress,
    f: 'json',
    outFields: '*',
    maxLocations: 1
  };
  
  try {
    const response = await axios.get(baseUrl, {
      params,
      timeout: 10000
    });
    
    if (response.data && response.data.candidates && response.data.candidates.length > 0) {
      const result = response.data.candidates[0];
      // VicMaps returns coordinates in GDA94 (EPSG:4283) which is close to WGS84
      return {
        lat: result.location.y,
        lng: result.location.x,
        displayName: result.address,
        confidence: result.score / 100,
        source: 'vicmaps'
      };
    }
  } catch (e) {
    console.error('VicMaps geocoding error:', e.message);
  }
  
  return null;
}

// Convert SVVB map reference to coordinates
// Format: SE 572 F13 (Region, Page, Grid)
async function geocodeSVVB(mapRef) {
  // SVVB map grid lookup - approximate center points for each map page
  // This is a simplified lookup - full implementation would need the actual grid data
  const svvbRegions = {
    'NW': { latBase: -36.5, lngBase: 141.0 },
    'NE': { latBase: -36.5, lngBase: 145.0 },
    'SW': { latBase: -38.5, lngBase: 141.0 },
    'SE': { latBase: -38.5, lngBase: 145.0 },
    'N': { latBase: -36.0, lngBase: 143.0 },
    'S': { latBase: -38.0, lngBase: 143.0 },
    'E': { latBase: -37.0, lngBase: 146.0 },
    'W': { latBase: -37.0, lngBase: 142.0 },
    'M': { latBase: -37.8, lngBase: 145.0 }  // Melbourne metro
  };
  
  // Parse map reference: SE 572 F13
  const match = mapRef.match(/([NSEW]{1,2}|M)\s*(\d+)\s*([A-Z])(\d+)/i);
  if (!match) return null;
  
  const region = match[1].toUpperCase();
  const page = parseInt(match[2]);
  const gridCol = match[3].toUpperCase();
  const gridRow = parseInt(match[4]);
  
  const regionData = svvbRegions[region];
  if (!regionData) return null;
  
  // Approximate calculation (each page covers roughly 0.1 degrees)
  // This is a rough estimate - actual SVVB grid is more complex
  const pageOffset = (page % 100) * 0.01;
  const colOffset = (gridCol.charCodeAt(0) - 65) * 0.005; // A=0, B=1, etc.
  const rowOffset = gridRow * 0.002;
  
  return {
    lat: regionData.latBase - pageOffset - rowOffset,
    lng: regionData.lngBase + pageOffset + colOffset,
    displayName: `SVVB ${mapRef}`,
    confidence: 0.3, // Low confidence - approximate
    source: 'svvb-grid'
  };
}

async function geocodeGoogle(address) {
  const apiKey = nconf.get('geocoding:google:apiKey');
  
  if (!apiKey) {
    console.error('Google Geocoding API key not configured');
    return null;
  }
  
  const config = nconf.get('geocoding:nominatim') || {};
  const defaultState = config.defaultState || '';
  const defaultCountry = config.defaultCountry || 'Australia';
  
  // Build full address
  let fullAddress = address;
  if (defaultState && !address.toLowerCase().includes(defaultState.toLowerCase())) {
    fullAddress += `, ${defaultState}`;
  }
  if (defaultCountry && !address.toLowerCase().includes(defaultCountry.toLowerCase())) {
    fullAddress += `, ${defaultCountry}`;
  }
  
  const url = 'https://maps.googleapis.com/maps/api/geocode/json';
  
  const response = await axios.get(url, {
    params: {
      address: fullAddress,
      key: apiKey
    },
    timeout: 10000
  });
  
  if (response.data.status === 'OK' && response.data.results.length > 0) {
    const result = response.data.results[0];
    return {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      displayName: result.formatted_address,
      confidence: getGoogleConfidence(result.geometry.location_type)
    };
  }
  
  return null;
}

function getGoogleConfidence(locationType) {
  switch (locationType) {
    case 'ROOFTOP':
      return 1.0;
    case 'RANGE_INTERPOLATED':
      return 0.8;
    case 'GEOMETRIC_CENTER':
      return 0.6;
    case 'APPROXIMATE':
      return 0.4;
    default:
      return 0.5;
  }
}

// Batch geocode multiple addresses with rate limiting
async function geocodeBatch(addresses, delayMs = 1000) {
  const results = [];
  
  for (const address of addresses) {
    const result = await geocode(address);
    results.push({
      address,
      result
    });
    
    // Rate limiting for Nominatim (1 request per second)
    if (nconf.get('geocoding:provider') === 'nominatim') {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return results;
}

// Clear the cache
function clearCache() {
  geocodeCache.clear();
}

// Geocode with SVVB map reference fallback
async function geocodeWithMapRef(address, mapRef) {
  // Try address first
  let result = await geocode(address);
  
  // If address geocoding failed and we have a map reference, try SVVB
  if (!result && mapRef) {
    result = await geocodeSVVB(mapRef);
  }
  
  return result;
}

module.exports = {
  geocode,
  geocodeBatch,
  geocodeWithMapRef,
  geocodeSVVB,
  geocodeVicMaps,
  clearCache
};
