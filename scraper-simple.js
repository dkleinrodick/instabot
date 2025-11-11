/**
 * Simple HTTP-based Flight Scraper
 *
 * This scraper uses simple HTTP requests to extract embedded JSON data
 * from Frontier's booking page, avoiding browser automation detection.
 *
 * The flight data is embedded in the HTML as:
 * FlightData = '{...}';
 *
 * We extract this JSON directly without executing JavaScript.
 */

const axios = require('axios');

/**
 * Extract FlightData JSON from HTML content
 * @param {string} html - Raw HTML content
 * @returns {Object|null} Parsed flight data or null if not found
 */
function extractFlightData(html) {
  try {
    // Find FlightData = '{...}'; pattern
    const regex = /FlightData = '({.*?})';/s;
    const match = html.match(regex);

    if (!match || !match[1]) {
      console.log('FlightData pattern not found in HTML');
      return null;
    }

    // Get the JSON string and clean it
    let jsonString = match[1];

    // Replace HTML entities
    jsonString = jsonString.replace(/&quot;/g, '"');
    jsonString = jsonString.replace(/&amp;/g, '&');
    jsonString = jsonString.replace(/&lt;/g, '<');
    jsonString = jsonString.replace(/&gt;/g, '>');
    jsonString = jsonString.replace(/&#39;/g, "'");

    // Parse the JSON
    const flightData = JSON.parse(jsonString);
    return flightData;

  } catch (error) {
    console.error('Error extracting FlightData:', error.message);
    return null;
  }
}

/**
 * Parse flight information from FlightData JSON
 * @param {Object} flightData - Parsed FlightData object
 * @returns {Array} Array of flight objects with price and details
 */
function parseFlights(flightData) {
  const flights = [];

  try {
    // Navigate the JSON structure based on the Python example
    // The structure is: journeys.flights array
    if (!flightData || !flightData.journeys || !flightData.journeys.flights) {
      console.log('No flights found in FlightData structure');
      return flights;
    }

    const flightsList = flightData.journeys.flights;

    // Extract flight information
    for (const flight of flightsList) {
      if (!flight) continue;

      try {
        // Extract GoWild fare price
        let price = null;
        let currency = 'USD';

        // Look for fare information in different possible locations
        if (flight.fares && Array.isArray(flight.fares)) {
          for (const fare of flight.fares) {
            // Look for GoWild fare type
            if (fare.fareType && fare.fareType.includes('GOWILD')) {
              price = fare.amount || fare.price || fare.totalAmount;
              currency = fare.currency || 'USD';
              break;
            }
          }
        }

        // If no specific GoWild fare, try generic fare info
        if (!price && flight.price) {
          price = flight.price.amount || flight.price.total || flight.price;
        }

        if (!price && flight.fare) {
          price = flight.fare.amount || flight.fare.total || flight.fare;
        }

        // Extract flight details
        const flightInfo = {
          price: price ? parseFloat(price) : null,
          currency: currency,
          flightNumber: flight.flightNumber || flight.number || null,
          departureTime: flight.departureTime || flight.departure || null,
          arrivalTime: flight.arrivalTime || flight.arrival || null,
          duration: flight.duration || null,
          stops: flight.stops || 0,
          origin: flight.origin || flight.from || null,
          destination: flight.destination || flight.to || null,
          rawData: flight
        };

        flights.push(flightInfo);
      } catch (error) {
        console.error('Error parsing individual flight:', error.message);
        continue;
      }
    }

  } catch (error) {
    console.error('Error parsing flights:', error.message);
  }

  return flights;
}

/**
 * Check if the response indicates bot detection
 * @param {string} html - HTML content
 * @param {number} statusCode - HTTP status code
 * @returns {Object} { detected: boolean, reason: string }
 */
function detectBotProtection(html, statusCode) {
  if (statusCode === 403) {
    return { detected: true, reason: '403_forbidden' };
  }

  if (html.includes('px-captcha') || html.includes('PerimeterX')) {
    return { detected: true, reason: 'perimeterx_captcha' };
  }

  if (html.includes('Access to this page has been denied')) {
    return { detected: true, reason: 'access_denied' };
  }

  if (html.includes('cf-browser-verification')) {
    return { detected: true, reason: 'cloudflare_challenge' };
  }

  if (html.includes('Please verify you are a human')) {
    return { detected: true, reason: 'human_verification' };
  }

  return { detected: false, reason: null };
}

/**
 * Build Frontier booking URL
 * @param {string} origin - Origin airport code
 * @param {string} destination - Destination airport code
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {string} Booking URL
 */
function buildURL(origin, destination, date) {
  const baseURL = 'https://booking.flyfrontier.com/Flight/InternalSelect';
  const params = new URLSearchParams({
    o1: origin,
    d1: destination,
    dd1: date,
    adt: '1',
    umnr: 'false',
    loy: 'false',
    mon: 'true',
    ftype: 'GW'  // GoWild fare type
  });

  return `${baseURL}?${params.toString()}`;
}

/**
 * Scrape flight data using simple HTTP request
 * @param {string} origin - Origin airport code
 * @param {string} destination - Destination airport code
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {Object} options - Scraping options
 * @param {string} options.proxy - Proxy in format IP:PORT (optional)
 * @param {boolean} options.testMode - If true, don't use proxy
 * @param {number} options.timeout - Request timeout in ms (default: 30000)
 * @returns {Promise<Object>} { success: boolean, flights: Array, error: string, botDetected: boolean }
 */
async function scrapeFlights(origin, destination, date, options = {}) {
  const {
    proxy = null,
    testMode = false,
    timeout = 30000
  } = options;

  const url = buildURL(origin, destination, date);

  console.log(`\n🔍 Scraping: ${origin} → ${destination} on ${date}`);
  if (proxy && !testMode) {
    console.log(`📡 Using proxy: ${proxy}`);
  } else {
    console.log(`🏠 Using direct connection (no proxy)`);
  }

  try {
    // Prepare axios config
    const axiosConfig = {
      url: url,
      method: 'GET',
      timeout: timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      },
      validateStatus: function (status) {
        // Accept any status code to handle 403 ourselves
        return true;
      }
    };

    // Add proxy if provided and not in test mode
    if (proxy && !testMode) {
      axiosConfig.proxy = {
        host: proxy.split(':')[0],
        port: parseInt(proxy.split(':')[1])
      };
    }

    // Make the request
    const startTime = Date.now();
    const response = await axios(axiosConfig);
    const loadTime = Date.now() - startTime;

    console.log(`📥 Response: ${response.status} (${loadTime}ms)`);

    const html = response.data;

    // Check for bot detection
    const botCheck = detectBotProtection(html, response.status);
    if (botCheck.detected) {
      console.log(`🤖 Bot detected: ${botCheck.reason}`);

      // Save debug file
      const fs = require('fs');
      const debugDir = './debug';
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${debugDir}/bot_detected_${botCheck.reason}_${timestamp}.html`;
      fs.writeFileSync(filename, html);
      console.log(`💾 Debug HTML saved: ${filename}`);

      return {
        success: false,
        flights: [],
        error: `Bot detected: ${botCheck.reason}`,
        botDetected: true,
        botReason: botCheck.reason
      };
    }

    // Extract FlightData JSON from HTML
    console.log('🔎 Extracting FlightData from HTML...');
    const flightData = extractFlightData(html);

    if (!flightData) {
      // Save debug file
      const fs = require('fs');
      const debugDir = './debug';
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${debugDir}/no_flightdata_${timestamp}.html`;
      fs.writeFileSync(filename, html);
      console.log(`💾 Debug HTML saved: ${filename}`);

      return {
        success: false,
        flights: [],
        error: 'FlightData not found in HTML',
        botDetected: false
      };
    }

    console.log('✅ FlightData extracted successfully');

    // Parse flights from FlightData
    console.log('📊 Parsing flight information...');
    const flights = parseFlights(flightData);

    console.log(`✈️ Found ${flights.length} flights`);

    if (flights.length === 0) {
      return {
        success: true,
        flights: [],
        error: null,
        botDetected: false,
        message: 'No flights available for this route/date'
      };
    }

    // Log first flight for verification
    if (flights.length > 0) {
      const firstFlight = flights[0];
      console.log(`💰 Sample flight: ${firstFlight.flightNumber || 'N/A'} - $${firstFlight.price || 'N/A'}`);
    }

    return {
      success: true,
      flights: flights,
      error: null,
      botDetected: false,
      loadTime: loadTime
    };

  } catch (error) {
    console.error('❌ Scraping error:', error.message);

    // Check for proxy connection errors
    if (error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.message.includes('proxy')) {
      return {
        success: false,
        flights: [],
        error: `Proxy connection failed: ${error.message}`,
        botDetected: false,
        proxyError: true
      };
    }

    // Generic error
    return {
      success: false,
      flights: [],
      error: error.message,
      botDetected: false
    };
  }
}

module.exports = {
  scrapeFlights,
  extractFlightData,
  parseFlights,
  detectBotProtection,
  buildURL
};
