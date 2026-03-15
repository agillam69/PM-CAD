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
  
  const params = {
    q: fullAddress,
    format: 'json',
    limit: 1,
    addressdetails: 1
  };
  
  // Nominatim requires a User-Agent
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
      confidence: parseFloat(result.importance) || 0.5
    };
  }
  
  return null;
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

module.exports = {
  geocode,
  geocodeBatch,
  clearCache
};
