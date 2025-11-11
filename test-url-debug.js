/**
 * Debug script to investigate URL and redirect issues
 *
 * This script tests different URL formats and configurations
 * to understand why we're getting redirect pages
 */

const axios = require('axios');
const fs = require('fs');

// Test configuration
const origin = 'ORD';
const destination = 'ATL';
const date = '2025-11-20';

console.log('🔍 URL Debug Tool');
console.log('================\n');

async function testURL(testName, url, config = {}) {
  console.log(`\n📝 Test: ${testName}`);
  console.log(`   URL: ${url}`);

  try {
    const defaultConfig = {
      url: url,
      method: 'GET',
      timeout: 30000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.flyfrontier.com/',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      validateStatus: () => true
    };

    const finalConfig = { ...defaultConfig, ...config };

    const response = await axios(finalConfig);

    console.log(`   ✓ Status: ${response.status}`);
    console.log(`   ✓ Content-Length: ${response.data.length} bytes`);

    const html = response.data;

    // Check what we got
    if (html.includes('Redirecting...')) {
      console.log(`   ⚠ Got redirect page`);

      // Try to find redirect URL
      const match = html.match(/location\.replace\('([^']+)'\)/);
      if (match) {
        console.log(`   → Redirect target: ${match[1]}`);
      }
    }

    if (html.includes('FlightData = ')) {
      console.log(`   ✅ Found FlightData!`);

      // Extract a sample
      const match = html.match(/FlightData = '({.{0,100})/);
      if (match) {
        console.log(`   → Sample: ${match[1]}...`);
      }
    } else {
      console.log(`   ❌ No FlightData found`);
    }

    if (html.includes('px-captcha') || html.includes('PerimeterX')) {
      console.log(`   🤖 PerimeterX detected`);
    }

    // Save HTML for inspection
    const filename = `./debug/${testName.replace(/\s+/g, '_')}.html`;
    fs.writeFileSync(filename, html);
    console.log(`   💾 Saved to: ${filename}`);

    return { success: true, hasFlightData: html.includes('FlightData = ') };

  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  // Create debug directory
  if (!fs.existsSync('./debug')) {
    fs.mkdirSync('./debug');
  }

  // Test 1: Original URL format
  await testURL(
    'Test 1 - InternalSelect',
    `https://booking.flyfrontier.com/Flight/InternalSelect?o1=${origin}&d1=${destination}&dd1=${date}&adt=1&umnr=false&loy=false&mon=true&ftype=GW`
  );

  // Test 2: Try without ftype parameter
  await testURL(
    'Test 2 - Without ftype',
    `https://booking.flyfrontier.com/Flight/InternalSelect?o1=${origin}&d1=${destination}&dd1=${date}&adt=1&umnr=false&loy=false&mon=true`
  );

  // Test 3: Try Select instead of InternalSelect
  await testURL(
    'Test 3 - Select endpoint',
    `https://booking.flyfrontier.com/Flight/Select?o1=${origin}&d1=${destination}&dd1=${date}&adt=1&mon=true`
  );

  // Test 4: Try with different date format
  const dateAlt = date.replace(/-/g, '');  // 20251120
  await testURL(
    'Test 4 - Different date format',
    `https://booking.flyfrontier.com/Flight/InternalSelect?o1=${origin}&d1=${destination}&dd1=${dateAlt}&adt=1&mon=true`
  );

  // Test 5: Try main flyfrontier.com
  await testURL(
    'Test 5 - Main site booking',
    `https://www.flyfrontier.com/flight/search?o1=${origin}&d1=${destination}&dd1=${date}&adt=1&mon=true`
  );

  // Test 6: Try with no redirect following
  await testURL(
    'Test 6 - No redirects',
    `https://booking.flyfrontier.com/Flight/InternalSelect?o1=${origin}&d1=${destination}&dd1=${date}&adt=1&umnr=false&loy=false&mon=true&ftype=GW`,
    { maxRedirects: 0 }
  );

  console.log('\n\n📊 Tests Complete!');
  console.log('================');
  console.log('Check the ./debug/ folder for saved HTML files');
  console.log('\nIf any test found FlightData, that URL format works!');
  console.log('If all tests show redirects, the site may require:');
  console.log('  - Session cookies from visiting main site first');
  console.log('  - JavaScript execution (browser required)');
  console.log('  - Different API endpoint');
}

// Run the tests
runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
