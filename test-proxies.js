/**
 * Proxy Testing Utility
 * Tests which proxies can successfully access Frontier without 403
 *
 * Run: node test-proxies.js
 */

const { chromium } = require('playwright');
const fs = require('fs');

const TEST_URL = 'https://booking.flyfrontier.com/Flight/InternalSelect?o1=ORD&d1=ATL&dd1=2025-11-20&adt=1&umnr=false&loy=false&mon=true&ftype=GW';

async function testProxy(proxy, index, total) {
  console.log(`\n[${index + 1}/${total}] Testing proxy: ${proxy}`);

  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      proxy: {
        server: `http://${proxy}`
      },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox'
      ],
      timeout: 15000
    });

    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    });

    const startTime = Date.now();

    const response = await page.goto(TEST_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    const loadTime = Date.now() - startTime;
    const status = response.status();

    if (status === 403) {
      console.log(`  ❌ 403 Forbidden - Proxy is blocked by PerimeterX`);
      await browser.close();
      return {
        proxy,
        status: 'blocked',
        httpStatus: 403,
        loadTime
      };
    }

    // Check for bot detection
    const content = await page.content();
    const title = await page.title();

    let botDetected = false;
    let botReason = null;

    if (content.includes('px-captcha') || content.includes('PerimeterX')) {
      botDetected = true;
      botReason = 'perimeterx_captcha';
    } else if (content.includes('Access to this page has been denied')) {
      botDetected = true;
      botReason = 'access_denied';
    } else if (title.toLowerCase().includes('access denied')) {
      botDetected = true;
      botReason = 'access_denied_title';
    }

    if (botDetected) {
      console.log(`  🤖 Bot detected: ${botReason}`);
      await browser.close();
      return {
        proxy,
        status: 'bot_detected',
        httpStatus: status,
        botReason,
        loadTime
      };
    }

    // Check if flight selector exists
    try {
      await page.waitForSelector('.ibe-flight-info', { timeout: 10000 });
      console.log(`  ✅ SUCCESS - Proxy works! (${loadTime}ms)`);
      await browser.close();
      return {
        proxy,
        status: 'working',
        httpStatus: status,
        loadTime
      };
    } catch (e) {
      console.log(`  ⚠️ Selector not found - Page loaded but no flights`);
      await browser.close();
      return {
        proxy,
        status: 'no_selector',
        httpStatus: status,
        loadTime
      };
    }

  } catch (error) {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // Ignore close errors
      }
    }

    if (error.message.includes('ERR_PROXY_CONNECTION_FAILED') ||
        error.message.includes('ERR_TUNNEL_CONNECTION_FAILED') ||
        error.message.includes('net::ERR_CONNECTION')) {
      console.log(`  ❌ Connection failed - Proxy is dead/unreachable`);
      return {
        proxy,
        status: 'connection_failed',
        error: 'Connection failed'
      };
    }

    if (error.message.includes('Timeout')) {
      console.log(`  ⏱️ Timeout - Proxy is too slow`);
      return {
        proxy,
        status: 'timeout',
        error: 'Timeout'
      };
    }

    console.log(`  ❌ Error: ${error.message.substring(0, 100)}`);
    return {
      proxy,
      status: 'error',
      error: error.message
    };
  }
}

async function testAllProxies() {
  console.log('\n' + '='.repeat(60));
  console.log('FRONTIER PROXY TESTER');
  console.log('='.repeat(60));

  // Load proxies from file or command line
  let proxies = [];

  // Option 1: Read from proxies.txt
  if (fs.existsSync('./proxies.txt')) {
    const content = fs.readFileSync('./proxies.txt', 'utf-8');
    proxies = content.split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 0 && p.includes(':'));
    console.log(`\n📁 Loaded ${proxies.length} proxies from proxies.txt`);
  }

  // Option 2: From command line
  if (process.argv.length > 2) {
    proxies = process.argv.slice(2);
    console.log(`\n💻 Testing ${proxies.length} proxies from command line`);
  }

  // Option 3: Load from premium-proxies.js
  if (proxies.length === 0) {
    try {
      const premiumProxies = require('./premium-proxies.js');
      proxies = premiumProxies.PREMIUM_PROXIES;
      console.log(`\n📦 Loaded ${proxies.length} proxies from premium-proxies.js`);
    } catch (e) {
      console.log('\n⚠️ Could not load proxies from premium-proxies.js');
    }
  }

  if (proxies.length === 0) {
    console.log('\n❌ No proxies to test!');
    console.log('\nUsage:');
    console.log('  1. Create proxies.txt with one proxy per line (IP:PORT)');
    console.log('  2. Run: node test-proxies.js');
    console.log('  OR');
    console.log('  3. Run: node test-proxies.js 1.2.3.4:8080 5.6.7.8:8080');
    process.exit(1);
  }

  console.log(`\n🔍 Testing ${proxies.length} proxies...\n`);

  const results = [];

  // Test each proxy
  for (let i = 0; i < proxies.length; i++) {
    const result = await testProxy(proxies[i], i, proxies.length);
    results.push(result);

    // Small delay between tests
    await new Promise(r => setTimeout(r, 2000));
  }

  // Summary
  console.log('\n\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const working = results.filter(r => r.status === 'working');
  const blocked = results.filter(r => r.status === 'blocked');
  const botDetected = results.filter(r => r.status === 'bot_detected');
  const connectionFailed = results.filter(r => r.status === 'connection_failed');
  const timeout = results.filter(r => r.status === 'timeout');
  const other = results.filter(r => !['working', 'blocked', 'bot_detected', 'connection_failed', 'timeout'].includes(r.status));

  console.log(`\n✅ Working: ${working.length}/${results.length} (${(working.length / results.length * 100).toFixed(1)}%)`);
  console.log(`❌ Blocked (403): ${blocked.length}`);
  console.log(`🤖 Bot Detected: ${botDetected.length}`);
  console.log(`🔌 Connection Failed: ${connectionFailed.length}`);
  console.log(`⏱️ Timeout: ${timeout.length}`);
  console.log(`❓ Other Issues: ${other.length}`);

  if (working.length > 0) {
    console.log('\n✅ WORKING PROXIES:');
    working.forEach(r => {
      console.log(`  ${r.proxy} (${r.loadTime}ms)`);
    });

    // Save working proxies to file
    const workingProxies = working.map(r => r.proxy).join('\n');
    fs.writeFileSync('./working-proxies.txt', workingProxies);
    console.log('\n💾 Saved to: working-proxies.txt');
  } else {
    console.log('\n❌ NO WORKING PROXIES FOUND');
    console.log('\nRecommendations:');
    console.log('  1. Get fresh residential proxies (datacenter proxies often blocked)');
    console.log('  2. Use premium proxy services (Smartproxy, Oxylabs, Bright Data)');
    console.log('  3. Rotate proxies frequently');
    console.log('  4. Consider using a proxy service with automatic rotation');
  }

  // Save full results
  fs.writeFileSync('./proxy-test-results.json', JSON.stringify(results, null, 2));
  console.log('\n📊 Full results saved to: proxy-test-results.json');

  console.log('\n' + '='.repeat(60) + '\n');
}

testAllProxies().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
