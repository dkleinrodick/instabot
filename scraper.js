const { chromium } = require('playwright');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

/**
 * Detect bot protection mechanisms
 */
function detectBotProtection(pageContent, pageTitle) {
  // Pattern 1: PerimeterX CAPTCHA
  if (pageContent.includes('px-captcha') ||
      pageContent.includes('_pxCaptcha') ||
      pageContent.includes('pxApps')) {
    return { detected: true, reason: 'perimeterx_captcha' };
  }

  // Pattern 2: Access Denied Message
  if (pageContent.includes('Access to this page has been denied') ||
      pageContent.includes('access to this page has been blocked')) {
    return { detected: true, reason: 'access_denied_message' };
  }

  // Pattern 3: Page Title
  if (pageTitle.toLowerCase().includes('access denied') ||
      pageTitle.toLowerCase().includes('blocked')) {
    return { detected: true, reason: 'access_denied_title' };
  }

  // Pattern 4: PerimeterX Script
  if (pageContent.includes('PerimeterX') ||
      pageContent.includes('perimeterx')) {
    return { detected: true, reason: 'perimeterx_script' };
  }

  // Pattern 5: Human Verification
  if (pageContent.includes('Please verify you are a human') ||
      pageContent.includes('verify that you are human') ||
      pageContent.includes('are you a robot')) {
    return { detected: true, reason: 'human_verification' };
  }

  // Pattern 6: Cloudflare Challenge
  if (pageContent.includes('Checking your browser') ||
      pageContent.includes('cf-browser-verification')) {
    return { detected: true, reason: 'cloudflare_challenge' };
  }

  return { detected: false };
}

/**
 * Parse flights from HTML content
 */
function parseFlightsFromHTML(html, origin, destination, date) {
  const $ = cheerio.load(html);
  let flightDataJSON = null;

  // Method 1: Look for injected element (if we injected it)
  const extractedData = $('#extracted-flight-data').text();
  if (extractedData) {
    try {
      let jsonString = extractedData.replace(/&quot;/g, '"');
      flightDataJSON = JSON.parse(jsonString);
      console.log('✓ Parsed FlightData from injected element');
    } catch (e) {
      console.log('✗ Failed to parse injected FlightData');
    }
  }

  // Method 2: Search script tags for FlightData variable
  if (!flightDataJSON) {
    console.log('Searching script tags for FlightData...');

    $('script').each((i, elem) => {
      const scriptContent = $(elem).html();

      if (scriptContent && scriptContent.includes('FlightData')) {
        // Match: FlightData = '{ ... }';
        const match = scriptContent.match(/FlightData\s*=\s*['"]({[^'"]+})['"]/);

        if (match && match[1]) {
          let jsonString = match[1];
          jsonString = jsonString.replace(/&quot;/g, '"');

          try {
            flightDataJSON = JSON.parse(jsonString);
            console.log('✓ Parsed FlightData from script tag');
            return false; // Break out of each loop
          } catch (e) {
            console.log('✗ Failed to parse FlightData JSON');
          }
        }
      }
    });
  }

  if (!flightDataJSON) {
    console.log('⚠️ FlightData not found');
    return [];
  }

  // Parse flights from JSON structure
  const flights = [];

  for (const journey of flightDataJSON.journeys || []) {
    for (const flight of journey.flights || []) {
      const goWildFare = flight.goWildFare;

      // Only include flights with GoWild fares
      if (!goWildFare || goWildFare <= 0) {
        continue;
      }

      flights.push({
        origin,
        destination,
        date,
        departure_time: flight.departureTime || flight.depTime || 'N/A',
        arrival_time: flight.arrivalTime || flight.arrTime || 'N/A',
        stops: flight.stopsText || 'Unknown',
        price: goWildFare,
        duration: flight.duration || 'Unknown',
        available: true,
        scrape_method: 'direct'
      });
    }
  }

  console.log(`✓ Extracted ${flights.length} GoWild flights`);
  return flights;
}

/**
 * Main scraping function with intelligent proxy rotation
 */
async function scrapeFrontierDirect(origin, destination, date, options = {}) {
  const proxyManager = options.proxyManager;
  const maxRetries = options.maxRetries || 5;
  const timeout = options.timeout || 60000;
  const elementWaitTimeout = options.elementWaitTimeout || 30000;

  if (!proxyManager) {
    throw new Error('proxyManager is required in options');
  }

  let attempts = 0;
  let lastError = null;

  // Retry loop
  while (attempts < maxRetries) {
    attempts++;
    console.log(`\n=== Attempt ${attempts}/${maxRetries} ===`);

    // Get next available proxy
    let selectedProxy;
    try {
      selectedProxy = await proxyManager.getNextAvailableProxy();
    } catch (error) {
      throw new Error(`No available proxies: ${error.message}`);
    }

    console.log(`Using proxy: ${selectedProxy.proxy}`);
    console.log(`Proxy stats: ${selectedProxy.success_count} successes, ${selectedProxy.bot_detections} bot detections, ${selectedProxy.error_count} errors`);

    let browser;
    try {
      // ========== STEP 1: Launch Browser ==========
      console.log('Launching browser...');
      browser = await chromium.launch({
        headless: true,
        proxy: {
          server: `http://${selectedProxy.proxy}`
        },
        args: [
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled'
        ]
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
        ignoreHTTPSErrors: true
      });

      const page = await context.newPage();

      // ========== STEP 2: Navigate to URL ==========
      const url = `https://booking.flyfrontier.com/Flight/InternalSelect?o1=${origin}&d1=${destination}&dd1=${date}&adt=1&umnr=false&loy=false&mon=true&ftype=GW`;

      console.log(`Navigating to: ${url}`);
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeout
      });

      // ========== CHECK 1: HTTP Status ==========
      const status = response.status();
      console.log(`HTTP Status: ${status}`);

      if (status === 403) {
        console.log('❌ 403 Forbidden - Blacklisting proxy');
        await proxyManager.markProxyBlacklisted(selectedProxy.proxy, '403_forbidden');
        await browser.close();
        continue; // Try next proxy
      }

      // ========== STEP 3: Wait for Flight Container ==========
      console.log('Waiting for .ibe-flight-info selector...');

      try {
        await page.waitForSelector('.ibe-flight-info', { timeout: elementWaitTimeout });
        console.log('✓ Flight container found!');
      } catch (timeoutError) {
        console.log('⚠️ .ibe-flight-info not found - checking for bot detection...');

        // Get page content and title for analysis
        const pageContent = await page.content();
        const pageTitle = await page.title();

        // ========== CHECK 2: Bot Detection Patterns ==========
        const botDetected = detectBotProtection(pageContent, pageTitle);

        if (botDetected.detected) {
          console.log(`🤖 Bot detected: ${botDetected.reason}`);
          console.log('Setting proxy cooldown for 5 minutes');

          // Save debug output
          const debugDir = path.join(__dirname, 'debug');
          if (!fs.existsSync(debugDir)) {
            fs.mkdirSync(debugDir);
          }

          const debugFilename = path.join(debugDir, `bot_detected_${selectedProxy.proxy.replace(/[:.]/g, '_')}_${Date.now()}.html`);
          fs.writeFileSync(debugFilename, pageContent);
          console.log(`Debug HTML saved: ${debugFilename}`);

          await proxyManager.markProxyBotDetected(selectedProxy.proxy);
          await browser.close();
          continue; // Try next proxy immediately
        }

        // No bot detected, but element not found - other issue
        console.log('❌ Unknown error - element not found but no bot detected');
        await proxyManager.markProxyError(selectedProxy.proxy, 'Element not found');
        await browser.close();
        lastError = timeoutError;
        continue;
      }

      // ========== STEP 4: Extract HTML Content ==========
      console.log('Extracting page content...');
      const htmlContent = await page.content();

      // Save output for debugging
      const debugDir = path.join(__dirname, 'debug');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir);
      }

      fs.writeFileSync(path.join(debugDir, 'latest_scrape_output.html'), htmlContent);
      await page.screenshot({ path: path.join(debugDir, 'latest_scrape_screenshot.png') });
      console.log('✓ Debug files saved');

      await browser.close();

      // ========== STEP 5: Parse Flight Data ==========
      console.log('Parsing flight data...');
      const flights = parseFlightsFromHTML(htmlContent, origin, destination, date);

      // Success (even if 0 flights found)
      console.log(`✅ Success! Found ${flights.length} flights`);
      await proxyManager.markProxySuccess(selectedProxy.proxy);
      return {
        flights,
        proxyUsed: selectedProxy.proxy
      };

    } catch (error) {
      // Browser/network errors
      if (browser) {
        await browser.close();
      }

      console.error(`Error: ${error.message}`);

      // ========== CHECK 3: Connection Errors ==========
      if (error.message.includes('ERR_PROXY_CONNECTION_FAILED') ||
          error.message.includes('ERR_TUNNEL_CONNECTION_FAILED') ||
          error.message.includes('net::ERR_CONNECTION_REFUSED')) {
        console.log('❌ Proxy connection failed - Blacklisting');
        await proxyManager.markProxyBlacklisted(selectedProxy.proxy, 'connection_failed');
        continue;
      }

      // ========== CHECK 4: Timeout Errors ==========
      if (error.message.includes('Timeout') || error.message.includes('timeout')) {
        console.log('⏱️ Timeout - marking error');
        await proxyManager.markProxyError(selectedProxy.proxy, 'timeout');
        lastError = error;
        continue;
      }

      // Generic error
      await proxyManager.markProxyError(selectedProxy.proxy, error.message);
      lastError = error;
    }
  }

  // All retries exhausted
  throw new Error(`Failed after ${maxRetries} attempts. Last error: ${lastError?.message || 'Unknown'}`);
}

module.exports = {
  scrapeFrontierDirect,
  detectBotProtection,
  parseFlightsFromHTML
};
