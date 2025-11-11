/**
 * Simple test script - NO PROXIES
 * Tests if scraping works from your local IP address
 *
 * Run: node test-simple-scrape.js
 */

const { chromium } = require('playwright');

async function testSimpleScrape(origin, destination, date) {
  console.log('\n🧪 TESTING SIMPLE SCRAPE (NO PROXY)');
  console.log(`Route: ${origin} → ${destination} on ${date}\n`);

  const url = `https://booking.flyfrontier.com/Flight/InternalSelect?o1=${origin}&d1=${destination}&dd1=${date}&adt=1&umnr=false&loy=false&mon=true&ftype=GW`;

  let browser;

  try {
    console.log('1️⃣ Launching browser...');

    // Simple browser launch - exactly like Python example
    browser = await chromium.launch({
      headless: false,  // SET TO false TO SEE BROWSER (helps debug)
      args: [
        '--disable-blink-features=AutomationControlled'
      ]
    });

    console.log('2️⃣ Creating new page...');
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    });

    console.log('3️⃣ Navigating to URL...');
    console.log(`   ${url}`);

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    const status = response.status();
    console.log(`4️⃣ HTTP Status: ${status}`);

    if (status === 403) {
      console.log('\n❌ 403 FORBIDDEN - PerimeterX is blocking this request');
      console.log('   This means:');
      console.log('   - Your IP might be flagged');
      console.log('   - PerimeterX detected automation');
      console.log('   - You need to use high-quality residential proxies');

      // Save the page for inspection
      const content = await page.content();
      require('fs').writeFileSync('./403_error.html', content);
      console.log('\n   Saved page to: 403_error.html');

      await browser.close();
      return { error: '403 Forbidden' };
    }

    console.log('5️⃣ Waiting for flight info selector (.ibe-flight-info)...');

    try {
      await page.waitForSelector('.ibe-flight-info', { timeout: 30000 });
      console.log('   ✅ Flight info found!');
    } catch (e) {
      console.log('   ⚠️ Flight info selector not found');

      // Check what we got instead
      const title = await page.title();
      const content = await page.content();

      console.log(`   Page title: ${title}`);

      if (content.includes('px-captcha') || content.includes('PerimeterX')) {
        console.log('   🤖 PerimeterX CAPTCHA detected');
      } else if (content.includes('Access to this page has been denied')) {
        console.log('   🚫 Access explicitly denied');
      } else {
        console.log('   ❓ Unknown error - check saved HTML');
      }

      require('fs').writeFileSync('./failed_scrape.html', content);
      await page.screenshot({ path: './failed_scrape.png' });
      console.log('   Saved debug files: failed_scrape.html, failed_scrape.png');

      await browser.close();
      return { error: 'Selector not found' };
    }

    console.log('6️⃣ Extracting HTML content...');
    const htmlContent = await page.content();

    console.log('7️⃣ Parsing FlightData...');

    // Extract FlightData variable
    const match = htmlContent.match(/FlightData\s*=\s*['"]({[^'"]+})['"]/);

    if (!match) {
      console.log('   ❌ FlightData variable not found in HTML');
      require('fs').writeFileSync('./no_flightdata.html', htmlContent);
      console.log('   Saved HTML to: no_flightdata.html');
      await browser.close();
      return { error: 'FlightData not found' };
    }

    let jsonString = match[1].replace(/&quot;/g, '"');
    const data = JSON.parse(jsonString);

    console.log('8️⃣ Extracting GoWild flights...');

    const gowildFlights = [];

    for (const journey of data.journeys || []) {
      for (const flight of journey.flights || []) {
        if (flight.goWildFare && flight.goWildFare > 0) {
          gowildFlights.push({
            price: flight.goWildFare,
            duration: flight.duration,
            stops: flight.stopsText,
            departure: flight.departureTime || flight.depTime,
            arrival: flight.arrivalTime || flight.arrTime
          });
        }
      }
    }

    console.log(`\n✅ SUCCESS! Found ${gowildFlights.length} GoWild flights\n`);

    if (gowildFlights.length > 0) {
      console.log('Sample flights:');
      gowildFlights.slice(0, 3).forEach((f, i) => {
        console.log(`  ${i + 1}. $${f.price} - ${f.departure} → ${f.arrival} (${f.stops})`);
      });
    } else {
      console.log('  No GoWild flights available for this route/date');
    }

    await browser.close();
    return { flights: gowildFlights };

  } catch (error) {
    console.log(`\n❌ ERROR: ${error.message}`);

    if (browser) {
      await browser.close();
    }

    return { error: error.message };
  }
}

// Run test
const origin = process.argv[2] || 'ORD';
const destination = process.argv[3] || 'ATL';
const date = process.argv[4] || '2025-11-20';

testSimpleScrape(origin, destination, date)
  .then(result => {
    console.log('\n' + '='.repeat(60));
    console.log('FINAL RESULT:');
    console.log(JSON.stringify(result, null, 2));
    console.log('='.repeat(60) + '\n');
    process.exit(result.error ? 1 : 0);
  });
