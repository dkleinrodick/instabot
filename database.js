const Database = require('better-sqlite3');
const path = require('path');

class FlightsDatabase {
  constructor(dbPath = './flights.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initializeDatabase();
  }

  initializeDatabase() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS flights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        origin TEXT NOT NULL,
        destination TEXT NOT NULL,
        date TEXT NOT NULL,
        departure_time TEXT,
        arrival_time TEXT,
        stops TEXT,
        price REAL,
        duration TEXT,
        available INTEGER DEFAULT 1,
        scrape_method TEXT,
        scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(origin, destination, date, departure_time, price)
      );

      CREATE INDEX IF NOT EXISTS idx_route_date ON flights(origin, destination, date);
      CREATE INDEX IF NOT EXISTS idx_scraped_at ON flights(scraped_at);
      CREATE INDEX IF NOT EXISTS idx_origin_date ON flights(origin, date);

      CREATE TABLE IF NOT EXISTS scrape_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        origin TEXT,
        destination TEXT,
        date TEXT,
        method TEXT,
        status TEXT,
        error_message TEXT,
        proxy_used TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_scrape_date ON scrape_log(created_at);
    `);
  }

  // Get cached flights for a specific route and date
  getCachedFlights(origin, destination, date, cacheHours = 6) {
    const stmt = this.db.prepare(`
      SELECT * FROM flights
      WHERE origin = ? AND destination = ? AND date = ?
      AND scraped_at >= datetime('now', '-${cacheHours} hours')
      ORDER BY departure_time
    `);
    return stmt.all(origin, destination, date);
  }

  // Get all cached flights from a specific origin on a date
  getCachedFlightsByOrigin(origin, date, cacheHours = 6) {
    const stmt = this.db.prepare(`
      SELECT * FROM flights
      WHERE origin = ? AND date = ?
      AND scraped_at >= datetime('now', '-${cacheHours} hours')
      ORDER BY destination, departure_time
    `);
    return stmt.all(origin, date);
  }

  // Insert or update flight
  upsertFlight(flight) {
    const stmt = this.db.prepare(`
      INSERT INTO flights (
        origin, destination, date, departure_time, arrival_time,
        stops, price, duration, available, scrape_method
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(origin, destination, date, departure_time, price)
      DO UPDATE SET
        arrival_time = excluded.arrival_time,
        stops = excluded.stops,
        duration = excluded.duration,
        available = excluded.available,
        scraped_at = CURRENT_TIMESTAMP
    `);

    return stmt.run(
      flight.origin,
      flight.destination,
      flight.date,
      flight.departure_time,
      flight.arrival_time,
      flight.stops,
      flight.price,
      flight.duration,
      flight.available ? 1 : 0,
      flight.scrape_method || 'direct'
    );
  }

  // Clear flights for a specific route and date
  clearFlights(origin, destination, date) {
    const stmt = this.db.prepare(`
      DELETE FROM flights
      WHERE origin = ? AND destination = ? AND date = ?
    `);
    return stmt.run(origin, destination, date);
  }

  // Clear all flights from an origin on a specific date
  clearFlightsByOrigin(origin, date) {
    const stmt = this.db.prepare(`
      DELETE FROM flights
      WHERE origin = ? AND date = ?
    `);
    return stmt.run(origin, date);
  }

  // Log scraping activity
  logScrape(origin, destination, date, method, status, errorMessage = null, proxyUsed = null) {
    const stmt = this.db.prepare(`
      INSERT INTO scrape_log (origin, destination, date, method, status, error_message, proxy_used)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(origin, destination, date, method, status, errorMessage, proxyUsed);
  }

  // Get all unique routes
  getAllRoutes() {
    const stmt = this.db.prepare(`
      SELECT DISTINCT origin, destination, COUNT(*) as flight_count,
             MAX(scraped_at) as last_scraped
      FROM flights
      GROUP BY origin, destination
      ORDER BY last_scraped DESC
    `);
    return stmt.all();
  }

  // Get recent scrape logs
  getRecentScrapeLogs(limit = 50) {
    const stmt = this.db.prepare(`
      SELECT * FROM scrape_log
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(limit);
  }

  // Get scrape statistics
  getScrapeStats() {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_scrapes,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_scrapes,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failed_scrapes,
        COUNT(DISTINCT proxy_used) as unique_proxies_used
      FROM scrape_log
      WHERE created_at >= datetime('now', '-24 hours')
    `);
    return stmt.get();
  }

  // Close database connection
  close() {
    this.db.close();
  }
}

module.exports = FlightsDatabase;
