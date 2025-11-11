# Frontier GoWild Flight Scraper

A full-stack web application that scrapes Frontier Airlines' booking website to extract GoWild fare prices using intelligent proxy rotation with automatic bot detection, blacklisting, and cooldown management.

## Features

- **Intelligent Proxy Rotation**: Automatically rotates through premium proxies with smart state management
- **Bot Detection**: Detects PerimeterX and other bot protection mechanisms
- **Automatic Cooldown**: Proxies detected as bots are placed in 5-minute cooldown
- **Blacklisting**: Proxies with excessive errors or bot detections are automatically blacklisted
- **Route Validation**: Only allows valid Frontier Airlines routes
- **Dual Search Modes**:
  - Single route search (e.g., ORD → CUN)
  - All routes from origin (e.g., all flights from ORD)
- **Caching**: Results cached for 6 hours to reduce scraping load
- **Clean UI**: Modern, responsive web interface

## Technology Stack

- **Backend**: Node.js, Express.js
- **Database**: SQLite3 (flights.db, proxies.db)
- **Scraping**: Playwright with Chromium
- **Parsing**: Cheerio
- **Frontend**: Pure HTML/CSS/JavaScript

## Installation

### Prerequisites

- Node.js v16 or higher
- npm

### Steps

1. **Clone/Navigate to Repository**
```bash
cd /path/to/frontier-gowild-scraper
```

2. **Install Dependencies**
```bash
npm install
```

3. **Install Playwright Browsers**
```bash
npx playwright install chromium
```

4. **Add Your Proxies**
   - Start the server (see below)
   - Open the web interface at http://localhost:3000
   - Paste your proxy list in the "Proxy Management" section
   - Format: `IP:PORT` (one per line)
   - Click "Update Proxy List"

5. **Start the Server**
```bash
npm start
```

6. **Open Browser**
   - Navigate to http://localhost:3000
   - You should see the Frontier GoWild Flight Scraper interface

## Usage

### Adding Proxies

1. In the web interface, locate the "Proxy Management" card
2. Paste your proxies in the textarea (one per line, format: `IP:PORT`)
3. Click "Update Proxy List"
4. The system will validate and store your proxies

### Searching Flights

**Single Route Search:**
1. Select "Single Route" mode
2. Choose origin airport
3. Choose destination airport (only valid routes shown)
4. Select travel date
5. Click "Search Flights"

**All Routes from Origin:**
1. Select "All Routes from Origin" mode
2. Choose origin airport
3. Select travel date
4. Click "Search Flights"
5. The system will scrape all available routes from that origin

### Proxy Management

**View Proxy Status:**
- Click "View Detailed Status" to see all proxies with their states, success rates, and statistics

**Clear Blacklist:**
- Click "Clear Blacklist" to reset all blacklisted proxies to active state

**Reset Cooldowns:**
- Click "Reset Cooldowns" to manually reset all cooldown proxies to active

### Understanding Proxy States

- **Active**: Proxy is ready to use
- **Cooldown**: Proxy detected as bot, waiting 5 minutes before reuse
- **Blacklisted**: Proxy has excessive errors or bot detections (≥5)

## Database Schema

### flights.db

**flights table:**
- Stores scraped flight data
- Indexed by route and date
- Cached results for 6 hours

**scrape_log table:**
- Logs all scraping attempts
- Tracks success/error rates
- Records proxy usage

### proxies.db

**proxy_states table:**
- Tracks proxy state (active, cooldown, blacklisted)
- Records success/error counts
- Manages cooldown timers
- Stores bot detection counts

## API Endpoints

### Flight Search
- `POST /api/search` - Search flights

### Airports & Routes
- `GET /api/airports` - Get all airports
- `GET /api/routes` - Get all routes
- `GET /api/routes/:origin` - Get destinations for origin

### Proxy Management
- `GET /api/proxies` - Get all proxies
- `POST /api/proxies` - Update proxy list
- `POST /api/proxies/add` - Add single proxy
- `DELETE /api/proxies/:proxy` - Delete proxy
- `GET /api/proxy-stats` - Get proxy statistics
- `POST /api/proxies/clear-blacklist` - Clear blacklist
- `POST /api/proxies/reset-cooldowns` - Reset cooldowns

### Health
- `GET /api/health` - Health check
- `GET /api/scrape-stats` - Get scrape statistics

## Configuration

### Environment Variables

Create a `.env` file (optional):

```bash
PORT=3000
FLIGHTS_DB_PATH=./flights.db
PROXIES_DB_PATH=./proxies.db
```

### Proxy Settings

Modify in `proxy-manager.js`:
- `cooldownDurationMs`: Default 300000 (5 minutes)
- `maxBotDetections`: Default 5
- `maxErrors`: Default 3

## Proxy Requirements

- **Format**: IP:PORT
- **Protocol**: HTTP proxies
- **Recommended**: Premium residential or datacenter proxies
- **Minimum**: 20-30 active proxies for reliability

## Bot Detection

The scraper detects the following bot protection mechanisms:
- PerimeterX CAPTCHA
- Access denied messages
- Human verification challenges
- Cloudflare challenges

When detected:
1. Proxy enters 5-minute cooldown
2. Debug HTML saved to `debug/` folder
3. Next proxy automatically selected
4. After 5 bot detections, proxy is blacklisted

## Troubleshooting

### ❌ Getting 403 Forbidden Errors?

**This is the most common issue.** PerimeterX (Frontier's bot protection) is blocking your requests.

**Quick Diagnosis:**

1. **Test without proxies first:**
   ```bash
   node test-simple-scrape.js ORD ATL 2025-11-20
   ```
   - If this works: Your proxies are the problem
   - If this fails: Your IP might be flagged OR code needs updating

2. **Test your proxies:**
   ```bash
   # Create proxies.txt with your proxy list (one per line: IP:PORT)
   node test-proxies.js
   ```
   This will identify which proxies work and save them to `working-proxies.txt`

3. **Read the full troubleshooting guide:**
   ```bash
   cat TROUBLESHOOTING.md
   ```

**Common Causes:**
- ❌ Low-quality proxies (free, datacenter, burned)
- ❌ Proxies already blacklisted by Frontier
- ❌ Scraping too fast (need delays)
- ❌ Your IP got flagged

**Solutions:**
- ✅ Get premium residential proxies (Smartproxy, Bright Data)
- ✅ Use only proxies that pass `test-proxies.js`
- ✅ Add delays between requests (30+ seconds)
- ✅ Monitor proxy stats and replace bad ones

### No Available Proxies Error
- Add more proxies via the web interface
- Run `node test-proxies.js` to find working ones
- Clear blacklist if many proxies are blacklisted
- Reset cooldowns if many proxies are in cooldown
- Wait for cooldown timers to expire (5 minutes)

### Element Not Found Error
- Frontier's website structure may have changed
- Check `debug/latest_scrape_output.html` for actual page content
- Update `.ibe-flight-info` selector in `scraper.js` if needed

### Connection Errors
- Verify proxy format is correct (IP:PORT)
- Run `node test-proxies.js` to test proxies
- Check if proxies require authentication (not currently supported)

### Slow Scraping
- Reduce number of destinations in bulk search
- Increase delay between requests in `server.js` (currently 10 seconds)
- Use faster proxies (test with `node test-proxies.js`)

## File Structure

```
frontier-gowild-scraper/
├── server.js                 # Express server
├── database.js              # Flights database operations
├── proxy-manager.js         # Proxy state management
├── scraper.js               # Playwright scraper
├── routes-data.js           # Airport codes and routes
├── premium-proxies.js       # Default proxy list
├── package.json             # Dependencies
├── .gitignore              # Git ignore rules
├── README.md               # This file
├── public/
│   └── index.html          # Frontend UI
├── flights.db              # SQLite database (auto-created)
├── proxies.db              # SQLite database (auto-created)
└── debug/                  # Debug output (auto-created)
```

## Development

### Adding New Routes

Edit `routes-data.js` and add to the `ROUTES` object:

```javascript
'ORD': ['CUN', 'LAX', 'MIA', ...],
```

### Modifying Bot Detection

Edit `detectBotProtection()` in `scraper.js` to add new patterns:

```javascript
if (pageContent.includes('new-pattern')) {
  return { detected: true, reason: 'new_pattern' };
}
```

## Performance

- **Single Route**: 30-60 seconds
- **All Routes from Origin**: 5-15 minutes (depending on number of destinations)
- **Cache Hit**: Instant (if within 6 hours)

## Limitations

- Only scrapes GoWild fares (not standard fares)
- Requires working proxies to bypass bot detection
- Rate limited by 10-second delay between bulk requests
- Frontier website structure changes may break scraper

## Legal & Ethical Considerations

This tool is for educational purposes. Ensure you:
- Respect Frontier Airlines' Terms of Service
- Use proxies legally and ethically
- Don't overload their servers with requests
- Only use for personal research

## Support

For issues or questions:
1. Check the debug files in `debug/` folder
2. Review proxy statistics in web interface
3. Check server console logs
4. Verify proxy list is valid and working

## License

MIT License - See LICENSE file for details

## Version

Version 2.0.0 - Complete rebuild with intelligent proxy management
