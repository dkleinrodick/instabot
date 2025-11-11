const express = require('express');
const cors = require('cors');
const path = require('path');
const FlightsDatabase = require('./database');
const ProxyManager = require('./proxy-manager');
const { scrapeFlights } = require('./scraper-simple');
const { AIRPORTS, ROUTES } = require('./routes-data');
const { PREMIUM_PROXIES } = require('./premium-proxies');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize databases
const flightsDb = new FlightsDatabase('./flights.db');
const proxyManager = new ProxyManager('./proxies.db');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize default proxies if database is empty
(async () => {
  const stats = await proxyManager.getStats();
  if (stats.total === 0 && PREMIUM_PROXIES.length > 0) {
    console.log('Initializing default proxy list...');
    for (const proxy of PREMIUM_PROXIES) {
      await proxyManager.addProxy(proxy);
    }
    console.log(`Added ${PREMIUM_PROXIES.length} default proxies`);
  }
})();

// ========== HELPER FUNCTIONS ==========

/**
 * Scrape flights with automatic proxy rotation and retry logic
 * @param {string} origin - Origin airport code
 * @param {string} destination - Destination airport code
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {Object} options - Options
 * @param {ProxyManager} options.proxyManager - Proxy manager instance
 * @param {number} options.maxRetries - Maximum retry attempts (default: 5)
 * @param {number} options.timeout - Request timeout in ms (default: 30000)
 * @param {boolean} options.testMode - If true, scrape without proxy (default: false)
 * @returns {Promise<Object>} { flights: Array, proxyUsed: string }
 */
async function scrapeWithProxyRotation(origin, destination, date, options = {}) {
  const {
    proxyManager: pm,
    maxRetries = 5,
    timeout = 30000,
    testMode = false
  } = options;

  let lastError = null;
  let proxyUsed = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let currentProxy = null;

    try {
      // Get proxy if not in test mode
      if (!testMode && pm) {
        currentProxy = await pm.getNextAvailableProxy();
        if (!currentProxy) {
          throw new Error('No available proxies. All proxies are blacklisted or in cooldown.');
        }
        console.log(`🔄 Attempt ${attempt}/${maxRetries} using proxy: ${currentProxy}`);
      } else {
        console.log(`🔄 Attempt ${attempt}/${maxRetries} (no proxy - test mode)`);
      }

      // Scrape using simple HTTP method
      const result = await scrapeFlights(origin, destination, date, {
        proxy: currentProxy,
        testMode: testMode,
        timeout: timeout
      });

      // Handle success
      if (result.success) {
        if (currentProxy && pm) {
          await pm.markProxySuccess(currentProxy);
        }
        return {
          flights: result.flights || [],
          proxyUsed: currentProxy || 'direct'
        };
      }

      // Handle bot detection
      if (result.botDetected) {
        console.log(`🤖 Bot detected: ${result.botReason}`);
        if (currentProxy && pm) {
          await pm.markProxyBotDetected(currentProxy, result.botReason);
        }
        lastError = new Error(`Bot detected: ${result.botReason}`);
        continue; // Try next proxy
      }

      // Handle proxy connection errors
      if (result.proxyError) {
        console.log(`🔌 Proxy connection failed: ${result.error}`);
        if (currentProxy && pm) {
          await pm.markProxyError(currentProxy, result.error);
        }
        lastError = new Error(result.error);
        continue; // Try next proxy
      }

      // Handle other errors
      console.log(`❌ Scraping error: ${result.error}`);
      if (currentProxy && pm) {
        await pm.markProxyError(currentProxy, result.error);
      }
      lastError = new Error(result.error);

    } catch (error) {
      console.error(`❌ Attempt ${attempt} failed:`, error.message);
      if (currentProxy && pm) {
        await pm.markProxyError(currentProxy, error.message);
      }
      lastError = error;
    }

    // Wait before retry (except on last attempt)
    if (attempt < maxRetries) {
      const delay = 2000; // 2 second delay between retries
      console.log(`⏳ Waiting ${delay}ms before next attempt...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // All retries failed
  throw lastError || new Error('Scraping failed after all retry attempts');
}

// ========== API ENDPOINTS ==========

/**
 * GET /api/airports
 * Returns list of all airports
 */
app.get('/api/airports', (req, res) => {
  res.json(AIRPORTS);
});

/**
 * GET /api/routes
 * Returns all valid routes
 */
app.get('/api/routes', (req, res) => {
  res.json(ROUTES);
});

/**
 * GET /api/routes/:origin
 * Returns valid destinations for a given origin
 */
app.get('/api/routes/:origin', (req, res) => {
  const { origin } = req.params;
  const destinations = ROUTES[origin] || [];
  res.json({
    origin,
    destinations
  });
});

/**
 * POST /api/search
 * Main flight search endpoint
 * Body: { origin, destination?, date, useCache, searchAllFromOrigin? }
 */
app.post('/api/search', async (req, res) => {
  try {
    const { origin, destination, date, useCache = true, searchAllFromOrigin = false } = req.body;

    // Validate input
    if (!origin || !date) {
      return res.status(400).json({
        error: 'Missing required fields: origin and date'
      });
    }

    if (!searchAllFromOrigin && !destination) {
      return res.status(400).json({
        error: 'destination is required when searchAllFromOrigin is false'
      });
    }

    // Validate airport codes
    if (!AIRPORTS[origin]) {
      return res.status(400).json({
        error: `Invalid origin airport code: ${origin}`
      });
    }

    if (!searchAllFromOrigin && destination && !AIRPORTS[destination]) {
      return res.status(400).json({
        error: `Invalid destination airport code: ${destination}`
      });
    }

    // Validate route
    if (!searchAllFromOrigin && destination && !ROUTES[origin]?.includes(destination)) {
      return res.status(400).json({
        error: `No route exists from ${origin} to ${destination}`
      });
    }

    // ========== SEARCH MODE: Single Route ==========
    if (!searchAllFromOrigin) {
      // Check cache first
      if (useCache) {
        const cached = flightsDb.getCachedFlights(origin, destination, date);
        if (cached.length > 0) {
          console.log(`✓ Returning ${cached.length} cached flights for ${origin} → ${destination} on ${date}`);
          return res.json({
            flights: cached,
            cached: true,
            cachedAt: cached[0]?.scraped_at,
            route: `${origin} → ${destination}`,
            date
          });
        }
      }

      // Scrape fresh data
      console.log(`\n🔍 Scraping ${origin} → ${destination} on ${date}...`);

      try {
        const result = await scrapeWithProxyRotation(origin, destination, date, {
          proxyManager,
          maxRetries: 5,
          timeout: 30000
        });

        const flights = result.flights;
        const proxyUsed = result.proxyUsed;

        // Clear old flights and store new ones
        flightsDb.clearFlights(origin, destination, date);

        for (const flight of flights) {
          flightsDb.upsertFlight(flight);
        }

        // Log success
        flightsDb.logScrape(origin, destination, date, 'direct', 'success', null, proxyUsed);

        console.log(`✅ Successfully scraped ${flights.length} flights`);

        return res.json({
          flights,
          cached: false,
          scrapedAt: new Date().toISOString(),
          proxyUsed,
          route: `${origin} → ${destination}`,
          date
        });

      } catch (error) {
        console.error('❌ Scraping failed:', error.message);

        // Log error
        flightsDb.logScrape(origin, destination, date, 'direct', 'error', error.message, null);

        // Check if it's a proxy availability error
        if (error.message.includes('No available proxies')) {
          const proxyStats = await proxyManager.getStats();
          return res.status(503).json({
            error: 'No available proxies',
            details: {
              active: proxyStats.active,
              cooldown: proxyStats.cooldown,
              blacklisted: proxyStats.blacklisted,
              message: 'All proxies are either in cooldown or blacklisted. Please add more proxies or wait for cooldowns to expire.'
            }
          });
        }

        return res.status(500).json({
          error: 'Failed to scrape flights',
          message: error.message
        });
      }
    }

    // ========== SEARCH MODE: All Routes from Origin ==========
    else {
      const validDestinations = ROUTES[origin] || [];

      if (validDestinations.length === 0) {
        return res.status(400).json({
          error: `No routes available from ${origin}`
        });
      }

      console.log(`\n🔍 Scraping all routes from ${origin} on ${date}...`);
      console.log(`Found ${validDestinations.length} possible destinations`);

      // Check cache first
      if (useCache) {
        const cached = flightsDb.getCachedFlightsByOrigin(origin, date);
        if (cached.length > 0) {
          console.log(`✓ Returning ${cached.length} cached flights from ${origin} on ${date}`);
          return res.json({
            flights: cached,
            cached: true,
            cachedAt: cached[0]?.scraped_at,
            origin,
            date,
            destinationsCount: new Set(cached.map(f => f.destination)).size
          });
        }
      }

      // Scrape each destination
      const allFlights = [];
      let successCount = 0;
      let errorCount = 0;
      const errors = [];

      for (const dest of validDestinations) {
        console.log(`\n--- Scraping ${origin} → ${dest} ---`);

        try {
          const result = await scrapeWithProxyRotation(origin, dest, date, {
            proxyManager,
            maxRetries: 5,
            timeout: 30000
          });

          const flights = result.flights;
          const proxyUsed = result.proxyUsed;

          // Store flights
          for (const flight of flights) {
            flightsDb.upsertFlight(flight);
            allFlights.push(flight);
          }

          // Log success
          flightsDb.logScrape(origin, dest, date, 'direct', 'success', null, proxyUsed);
          successCount++;

          console.log(`✅ ${origin} → ${dest}: Found ${flights.length} flights`);

          // Small delay between requests (10 seconds)
          await new Promise(resolve => setTimeout(resolve, 10000));

        } catch (error) {
          console.error(`❌ ${origin} → ${dest}: ${error.message}`);

          // Log error
          flightsDb.logScrape(origin, dest, date, 'direct', 'error', error.message, null);
          errorCount++;
          errors.push({
            destination: dest,
            error: error.message
          });

          // If no proxies available, stop immediately
          if (error.message.includes('No available proxies')) {
            console.log('⚠️ No available proxies - stopping bulk scrape');
            break;
          }
        }
      }

      console.log(`\n✅ Bulk scrape complete: ${successCount} successful, ${errorCount} errors`);

      return res.json({
        flights: allFlights,
        cached: false,
        scrapedAt: new Date().toISOString(),
        origin,
        date,
        destinationsScraped: successCount,
        totalDestinations: validDestinations.length,
        errors: errorCount > 0 ? errors : undefined
      });
    }

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/proxies
 * Get all proxies with their states
 */
app.get('/api/proxies', async (req, res) => {
  try {
    const proxies = await proxyManager.getAllProxies();
    res.json(proxies);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch proxies',
      message: error.message
    });
  }
});

/**
 * POST /api/proxies
 * Update entire proxy list
 * Body: { proxies: ["IP:PORT", ...] }
 */
app.post('/api/proxies', async (req, res) => {
  try {
    const { proxies } = req.body;

    if (!Array.isArray(proxies)) {
      return res.status(400).json({
        error: 'proxies must be an array'
      });
    }

    // Validate and clean proxies
    const validProxies = proxies
      .map(p => p.trim())
      .filter(p => p.length > 0 && p.includes(':'));

    if (validProxies.length === 0) {
      return res.status(400).json({
        error: 'No valid proxies provided. Format: IP:PORT'
      });
    }

    const result = await proxyManager.updateProxyList(validProxies);

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    res.status(500).json({
      error: 'Failed to update proxies',
      message: error.message
    });
  }
});

/**
 * POST /api/proxies/add
 * Add single proxy
 * Body: { proxy: "IP:PORT" }
 */
app.post('/api/proxies/add', async (req, res) => {
  try {
    const { proxy } = req.body;

    if (!proxy || !proxy.includes(':')) {
      return res.status(400).json({
        error: 'Invalid proxy format. Expected: IP:PORT'
      });
    }

    await proxyManager.addProxy(proxy.trim());

    res.json({
      success: true,
      proxy: proxy.trim()
    });

  } catch (error) {
    res.status(500).json({
      error: 'Failed to add proxy',
      message: error.message
    });
  }
});

/**
 * DELETE /api/proxies/:proxy
 * Delete single proxy
 */
app.delete('/api/proxies/:proxy', async (req, res) => {
  try {
    const proxy = decodeURIComponent(req.params.proxy);
    await proxyManager.removeProxy(proxy);

    res.json({
      success: true,
      proxy
    });

  } catch (error) {
    res.status(500).json({
      error: 'Failed to delete proxy',
      message: error.message
    });
  }
});

/**
 * GET /api/proxy-stats
 * Get proxy statistics
 */
app.get('/api/proxy-stats', async (req, res) => {
  try {
    const stats = await proxyManager.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch proxy stats',
      message: error.message
    });
  }
});

/**
 * POST /api/proxies/clear-blacklist
 * Clear all blacklisted proxies
 */
app.post('/api/proxies/clear-blacklist', async (req, res) => {
  try {
    const cleared = await proxyManager.clearBlacklist();

    res.json({
      success: true,
      cleared
    });

  } catch (error) {
    res.status(500).json({
      error: 'Failed to clear blacklist',
      message: error.message
    });
  }
});

/**
 * POST /api/proxies/reset-cooldowns
 * Reset all cooldown proxies to active
 */
app.post('/api/proxies/reset-cooldowns', async (req, res) => {
  try {
    const reset = await proxyManager.resetAllCooldowns();

    res.json({
      success: true,
      reset
    });

  } catch (error) {
    res.status(500).json({
      error: 'Failed to reset cooldowns',
      message: error.message
    });
  }
});

// ========== TESTING ENDPOINTS ==========

/**
 * POST /api/test/scrape
 * Test scraping without proxy (from server's IP)
 * Body: { origin, destination, date }
 */
app.post('/api/test/scrape', async (req, res) => {
  try {
    const { origin, destination, date } = req.body;

    if (!origin || !destination || !date) {
      return res.status(400).json({
        error: 'Missing required fields: origin, destination, date'
      });
    }

    console.log(`\n🧪 Testing scrape without proxy: ${origin} → ${destination} on ${date}`);

    // Create a mock proxy manager that doesn't actually use proxies
    const mockProxyManager = {
      getNextAvailableProxy: async () => ({ proxy: 'TEST_MODE' }),
      markProxySuccess: async () => {},
      markProxyBotDetected: async () => {},
      markProxyError: async () => {},
      markProxyBlacklisted: async () => {}
    };

    const result = await scrapeWithProxyRotation(origin, destination, date, {
      proxyManager: null,
      maxRetries: 1,
      timeout: 30000,
      testMode: true  // Special flag to skip proxy usage
    });

    console.log(`✅ Test successful: ${result.flights.length} flights found`);

    res.json({
      success: true,
      flights: result.flights,
      testMode: true,
      message: 'Successfully scraped without proxy'
    });

  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);

    res.status(500).json({
      success: false,
      error: error.message,
      testMode: true,
      message: 'Test scrape failed - check if your server IP is blocked or if site structure changed'
    });
  }
});

/**
 * POST /api/test/proxy
 * Test a single proxy
 * Body: { proxy: "IP:PORT", origin?, destination?, date? }
 */
app.post('/api/test/proxy', async (req, res) => {
  try {
    const { proxy, origin = 'ORD', destination = 'ATL', date = '2025-11-20' } = req.body;

    if (!proxy) {
      return res.status(400).json({
        error: 'Missing required field: proxy'
      });
    }

    console.log(`\n🧪 Testing proxy: ${proxy}`);

    // Create a temporary proxy manager for testing
    const tempProxyManager = {
      getNextAvailableProxy: async () => ({
        proxy,
        success_count: 0,
        bot_detections: 0,
        error_count: 0
      }),
      markProxySuccess: async () => {},
      markProxyBotDetected: async (p) => {
        console.log(`🤖 Bot detected for ${p}`);
      },
      markProxyError: async (p) => {
        console.log(`❌ Error for ${p}`);
      },
      markProxyBlacklisted: async (p, reason) => {
        console.log(`🚫 Blacklisted ${p}: ${reason}`);
      }
    };

    const startTime = Date.now();

    try {
      const result = await scrapeWithProxyRotation(origin, destination, date, {
        proxyManager: tempProxyManager,
        maxRetries: 1,
        timeout: 30000
      });

      const loadTime = Date.now() - startTime;

      console.log(`✅ Proxy works: ${result.flights.length} flights found in ${loadTime}ms`);

      res.json({
        success: true,
        proxy,
        status: 'working',
        flights: result.flights.length,
        loadTime,
        message: `Proxy works! Found ${result.flights.length} flights in ${(loadTime / 1000).toFixed(1)}s`
      });

    } catch (error) {
      const loadTime = Date.now() - startTime;

      let status = 'error';
      let reason = error.message;

      if (error.message.includes('403')) {
        status = 'blocked';
        reason = '403 Forbidden - Proxy is blocked by PerimeterX';
      } else if (error.message.includes('Bot detected')) {
        status = 'bot_detected';
        reason = 'Bot detection triggered';
      } else if (error.message.includes('ERR_PROXY_CONNECTION_FAILED') ||
                 error.message.includes('ERR_TUNNEL_CONNECTION_FAILED')) {
        status = 'connection_failed';
        reason = 'Cannot connect to proxy';
      } else if (error.message.includes('Timeout') || error.message.includes('timeout')) {
        status = 'timeout';
        reason = 'Proxy response timeout';
      }

      console.log(`❌ Proxy test failed: ${reason}`);

      res.json({
        success: false,
        proxy,
        status,
        reason,
        loadTime,
        message: reason
      });
    }

  } catch (error) {
    res.status(500).json({
      error: 'Failed to test proxy',
      message: error.message
    });
  }
});

/**
 * POST /api/test/proxies/batch
 * Test multiple proxies
 * Body: { proxies: ["IP:PORT", ...] }
 */
app.post('/api/test/proxies/batch', async (req, res) => {
  try {
    const { proxies } = req.body;

    if (!Array.isArray(proxies) || proxies.length === 0) {
      return res.status(400).json({
        error: 'Missing or invalid field: proxies (must be array)'
      });
    }

    console.log(`\n🧪 Testing ${proxies.length} proxies in batch...`);

    const results = [];

    for (let i = 0; i < proxies.length; i++) {
      const proxy = proxies[i];
      console.log(`\n[${i + 1}/${proxies.length}] Testing ${proxy}...`);

      // Test each proxy with a simple scrape
      const tempProxyManager = {
        getNextAvailableProxy: async () => ({
          proxy,
          success_count: 0,
          bot_detections: 0,
          error_count: 0
        }),
        markProxySuccess: async () => {},
        markProxyBotDetected: async () => {},
        markProxyError: async () => {},
        markProxyBlacklisted: async () => {}
      };

      const startTime = Date.now();

      try {
        const result = await scrapeWithProxyRotation('ORD', 'ATL', '2025-11-20', {
          proxyManager: tempProxyManager,
          maxRetries: 1,
          timeout: 30000
        });

        const loadTime = Date.now() - startTime;

        results.push({
          proxy,
          status: 'working',
          flights: result.flights.length,
          loadTime,
          success: true
        });

        console.log(`  ✅ Works (${loadTime}ms)`);

      } catch (error) {
        const loadTime = Date.now() - startTime;

        let status = 'error';
        if (error.message.includes('403')) status = 'blocked';
        else if (error.message.includes('Bot detected')) status = 'bot_detected';
        else if (error.message.includes('ERR_PROXY_CONNECTION')) status = 'connection_failed';
        else if (error.message.includes('Timeout')) status = 'timeout';

        results.push({
          proxy,
          status,
          error: error.message.substring(0, 100),
          loadTime,
          success: false
        });

        console.log(`  ❌ ${status}`);
      }

      // Small delay between tests
      if (i < proxies.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Calculate summary
    const working = results.filter(r => r.status === 'working');
    const blocked = results.filter(r => r.status === 'blocked');
    const failed = results.filter(r => !r.success);

    console.log(`\n✅ Summary: ${working.length}/${proxies.length} working`);

    res.json({
      success: true,
      total: proxies.length,
      working: working.length,
      blocked: blocked.length,
      failed: failed.length,
      workingProxies: working.map(r => r.proxy),
      results
    });

  } catch (error) {
    res.status(500).json({
      error: 'Failed to test proxies',
      message: error.message
    });
  }
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/scrape-stats
 * Get scraping statistics
 */
app.get('/api/scrape-stats', (req, res) => {
  try {
    const stats = flightsDb.getScrapeStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch scrape stats',
      message: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Frontier GoWild Flight Scraper`);
  console.log(`📡 Server running on http://localhost:${PORT}`);
  console.log(`\n📊 Status:`);

  proxyManager.getStats().then(stats => {
    console.log(`   Proxies: ${stats.total} total (${stats.active} active, ${stats.cooldown} cooldown, ${stats.blacklisted} blacklisted)`);
  });

  console.log(`   Airports: ${Object.keys(AIRPORTS).length} airports`);
  console.log(`   Routes: ${Object.keys(ROUTES).length} origin airports with routes`);
  console.log(`\n💻 Open http://localhost:${PORT} in your browser\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down...');
  flightsDb.close();
  proxyManager.close();
  process.exit(0);
});
