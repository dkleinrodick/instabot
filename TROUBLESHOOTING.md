# Troubleshooting 403 Forbidden Errors

## Why Am I Getting 403 Errors?

The 403 Forbidden error means **PerimeterX** (Frontier's bot protection service) has detected and blocked your request. This can happen for several reasons:

### 1. **Proxy Quality Issues**
- ✅ **Good:** Fresh residential proxies from premium services
- ❌ **Bad:** Datacenter proxies, free proxies, shared proxies
- ❌ **Bad:** Proxies that have been used heavily (burned/flagged)

### 2. **Detection Signals**
PerimeterX looks for:
- Browser automation markers (webdriver flags)
- Unusual request patterns
- Known proxy IP ranges
- Missing browser fingerprints
- Consistent timing patterns
- Lack of mouse/keyboard events

### 3. **Why It Worked Before But Not Now**
- Your proxies got flagged/blacklisted
- PerimeterX updated their detection rules
- Your IP address got flagged
- Proxies reached rate limits

---

## 🔧 Step-by-Step Diagnosis

### Step 1: Test Without Proxy (Your Local IP)

This tells you if the scraper code works at all:

```bash
node test-simple-scrape.js ORD ATL 2025-11-20
```

**Results:**
- ✅ **Success:** Code works, you need better proxies
- ❌ **403 Error:** Even your IP is blocked (unusual) or code needs fixing
- 🤖 **CAPTCHA:** PerimeterX is active but might work with delays

### Step 2: Test Your Proxies

Find out which proxies actually work:

```bash
# Create a file with your proxies (one per line)
echo "104.207.44.112:3129" > proxies.txt
echo "192.168.1.1:8080" >> proxies.txt

# Test them
node test-proxies.js
```

This will:
- Test each proxy individually
- Identify which are blocked (403)
- Identify which are dead (connection failed)
- Save working proxies to `working-proxies.txt`

### Step 3: Check Debug Files

Look at the saved HTML to understand the error:

```bash
# After running test-simple-scrape.js
# Check these files:
- 403_error.html           # If you got 403
- failed_scrape.html       # If selector not found
- failed_scrape.png        # Screenshot of what happened
```

Open these in a browser to see what PerimeterX is showing.

---

## 🛠️ Solutions

### Solution 1: Get Better Proxies

**Premium Residential Proxy Services:**

1. **Smartproxy** (Recommended)
   - Residential IPs
   - Automatic rotation
   - ~$8/GB
   - https://smartproxy.com

2. **Bright Data** (Oxylabs)
   - Largest proxy network
   - More expensive
   - Very reliable

3. **Soax**
   - Good for sneaker/scraping
   - Residential + mobile IPs

**What to Look For:**
- ✅ Residential IPs (not datacenter)
- ✅ Sticky sessions (same IP for 5-30 minutes)
- ✅ US-based IPs
- ✅ Rotation capability
- ✅ High success rate (>90%)

### Solution 2: Use Headless=false (Visual Mode)

Sometimes visible browsers bypass detection better:

```javascript
// In test-simple-scrape.js, change:
headless: false  // You'll see the browser window
```

This uses a real browser window which is harder to detect.

### Solution 3: Add Delays and Human Behavior

Edit `scraper.js` to add:

```javascript
// After page load
await page.waitForTimeout(3000);  // Wait 3 seconds

// Move mouse randomly
await page.mouse.move(
  Math.random() * 500,
  Math.random() * 500
);

// Scroll page
await page.evaluate(() => {
  window.scrollBy(0, 300);
});
```

### Solution 4: Use Playwright Stealth

Install stealth plugin:

```bash
npm install playwright-extra playwright-extra-plugin-stealth
```

Update scraper:

```javascript
const { chromium } = require('playwright-extra');
const StealthPlugin = require('playwright-extra-plugin-stealth');
chromium.use(StealthPlugin());
```

### Solution 5: Reduce Request Frequency

In `server.js`, increase delay between requests:

```javascript
// Change from 10 seconds to 30 seconds
await new Promise(resolve => setTimeout(resolve, 30000));
```

### Solution 6: Rotate User Agents

```javascript
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/122.0'
];

const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
```

---

## 📊 Understanding Proxy Test Results

### Working Proxy
```
✅ SUCCESS - Proxy works! (2500ms)
```
**Action:** Use this proxy! Add to your active list.

### 403 Forbidden
```
❌ 403 Forbidden - Proxy is blocked by PerimeterX
```
**Meaning:** This IP is blacklisted by Frontier.
**Action:** Remove from your list, it's burned.

### Bot Detected
```
🤖 Bot detected: perimeterx_captcha
```
**Meaning:** PerimeterX showed a CAPTCHA challenge.
**Action:** This proxy might work with better stealth, but probably burned.

### Connection Failed
```
❌ Connection failed - Proxy is dead/unreachable
```
**Meaning:** Proxy server is offline or wrong credentials.
**Action:** Check proxy format, verify it's still active.

### Timeout
```
⏱️ Timeout - Proxy is too slow
```
**Meaning:** Proxy is responding but too slow.
**Action:** Remove unless you increase timeout settings.

---

## 🎯 Recommended Workflow

1. **Test locally first:**
   ```bash
   node test-simple-scrape.js
   ```

2. **If that works, test your proxies:**
   ```bash
   node test-proxies.js
   ```

3. **Use only working proxies:**
   - Copy proxies from `working-proxies.txt`
   - Paste into the web UI
   - Start scraping

4. **Monitor proxy health:**
   - Check stats in web UI
   - Re-test proxies weekly
   - Replace blacklisted ones

5. **Start small:**
   - Test with 1-2 routes first
   - Don't bulk scrape immediately
   - Gradually increase volume

---

## 🚨 Common Mistakes

### ❌ Using Free Proxies
Free proxies are almost always:
- Already blacklisted
- Shared by thousands
- Unreliable
- Slow

### ❌ Scraping Too Fast
```javascript
// DON'T DO THIS
for (let i = 0; i < 100; i++) {
  await scrape(); // Instant = banned
}

// DO THIS
for (let i = 0; i < 100; i++) {
  await scrape();
  await sleep(30000); // 30 second delay
}
```

### ❌ Reusing Burned Proxies
Once a proxy is blacklisted, it stays blacklisted.
Don't keep retrying the same proxy hoping it'll work.

### ❌ Not Rotating Proxies
Using the same proxy for 100+ requests = detection.
Rotate every 5-10 requests.

---

## 💡 When All Else Fails

### Option 1: Manual Scraping
1. Open Frontier in a real browser
2. Search for flights manually
3. Use browser dev tools to extract FlightData
4. Copy/paste into your app

### Option 2: Use Their API (if available)
Check network tab - they might have an internal API you can call directly.

### Option 3: Scraping Service
Use a service like:
- ScraperAPI
- Apify
- Zyte (formerly Scrapinghub)

They handle proxies and detection for you.

### Option 4: Reduce Scope
Instead of scraping all routes:
- Focus on top 10 routes
- Scrape once per day
- Cache aggressively

---

## 📞 Getting Help

If you're still stuck:

1. **Check debug files:**
   ```bash
   ls -la debug/
   cat debug/latest_scrape_output.html
   ```

2. **Share proxy test results:**
   ```bash
   cat proxy-test-results.json
   ```

3. **Check server logs:**
   Look for patterns in when 403s occur

4. **Verify Frontier's site:**
   - Is it working normally in a real browser?
   - Did they change their URL structure?
   - Is there maintenance?

---

## 📈 Success Metrics

**Good Proxy Performance:**
- ✅ >80% success rate
- ✅ <5 second load times
- ✅ <10% bot detections
- ✅ Works for 100+ requests

**Bad Proxy Performance:**
- ❌ <50% success rate
- ❌ Frequent 403 errors
- ❌ High bot detection rate
- ❌ Gets blacklisted quickly

**Replace proxies when:**
- Success rate drops below 70%
- More than 5 bot detections
- More than 10 consecutive errors
- Blacklisted status

---

## 🔄 Maintenance Schedule

**Daily:**
- Check proxy stats in web UI
- Replace blacklisted proxies

**Weekly:**
- Run full proxy test
- Update proxy list
- Clear old cache data

**Monthly:**
- Review scraping patterns
- Update user agents
- Check for Frontier site changes
- Rotate proxy provider if needed
