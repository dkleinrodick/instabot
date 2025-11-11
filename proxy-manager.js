const Database = require('better-sqlite3');

class ProxyManager {
  constructor(dbPath = './proxies.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.cooldownDurationMs = 5 * 60 * 1000; // 5 minutes
    this.maxBotDetections = 5;
    this.maxErrors = 3;
    this.initializeDatabase();
  }

  initializeDatabase() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS proxy_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proxy TEXT UNIQUE NOT NULL,
        state TEXT NOT NULL DEFAULT 'active',

        last_used DATETIME,
        last_success DATETIME,
        last_error TEXT,

        success_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        bot_detections INTEGER DEFAULT 0,
        total_requests INTEGER DEFAULT 0,

        cooldown_until DATETIME,
        blacklisted_at DATETIME,
        blacklist_reason TEXT,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_proxy ON proxy_states(proxy);
      CREATE INDEX IF NOT EXISTS idx_state ON proxy_states(state);
      CREATE INDEX IF NOT EXISTS idx_cooldown_until ON proxy_states(cooldown_until);
      CREATE INDEX IF NOT EXISTS idx_last_used ON proxy_states(last_used);
    `);
  }

  // ========== PROXY SELECTION ==========

  async getNextAvailableProxy() {
    // First, check and reset expired cooldowns
    await this.checkCooldownExpiration();

    // Get all active proxies
    const activeProxies = this.db.prepare(`
      SELECT * FROM proxy_states
      WHERE state = 'active'
      ORDER BY RANDOM()
      LIMIT 1
    `).get();

    if (!activeProxies) {
      // No active proxies available
      const stats = await this.getStats();
      throw new Error(`No available proxies. Active: ${stats.active}, Cooldown: ${stats.cooldown}, Blacklisted: ${stats.blacklisted}`);
    }

    return activeProxies;
  }

  // ========== STATE MANAGEMENT ==========

  async markProxySuccess(proxy) {
    const stmt = this.db.prepare(`
      UPDATE proxy_states
      SET
        success_count = success_count + 1,
        total_requests = total_requests + 1,
        error_count = 0,
        last_used = datetime('now'),
        last_success = datetime('now'),
        updated_at = datetime('now')
      WHERE proxy = ?
    `);
    return stmt.run(proxy);
  }

  async markProxyBotDetected(proxy) {
    // Increment bot detection counter
    const current = this.db.prepare('SELECT bot_detections FROM proxy_states WHERE proxy = ?').get(proxy);

    if (!current) return;

    const newBotDetections = (current.bot_detections || 0) + 1;

    // If bot detections >= 5, blacklist instead of cooldown
    if (newBotDetections >= this.maxBotDetections) {
      return await this.markProxyBlacklisted(proxy, 'excessive_bot_detections');
    }

    // Set cooldown
    const cooldownUntil = new Date(Date.now() + this.cooldownDurationMs).toISOString();

    const stmt = this.db.prepare(`
      UPDATE proxy_states
      SET
        bot_detections = bot_detections + 1,
        total_requests = total_requests + 1,
        state = 'cooldown',
        cooldown_until = ?,
        last_error = 'Bot detected',
        last_used = datetime('now'),
        updated_at = datetime('now')
      WHERE proxy = ?
    `);
    return stmt.run(cooldownUntil, proxy);
  }

  async markProxyBlacklisted(proxy, reason) {
    const stmt = this.db.prepare(`
      UPDATE proxy_states
      SET
        state = 'blacklisted',
        blacklisted_at = datetime('now'),
        blacklist_reason = ?,
        cooldown_until = NULL,
        last_error = ?,
        updated_at = datetime('now')
      WHERE proxy = ?
    `);
    return stmt.run(reason, reason, proxy);
  }

  async markProxyError(proxy, errorMessage) {
    // Get current error count
    const current = this.db.prepare('SELECT error_count FROM proxy_states WHERE proxy = ?').get(proxy);

    if (!current) return;

    const newErrorCount = (current.error_count || 0) + 1;

    // If error count >= 3, blacklist
    if (newErrorCount >= this.maxErrors) {
      return await this.markProxyBlacklisted(proxy, 'excessive_errors');
    }

    // Otherwise just increment error count
    const stmt = this.db.prepare(`
      UPDATE proxy_states
      SET
        error_count = error_count + 1,
        total_requests = total_requests + 1,
        last_error = ?,
        last_used = datetime('now'),
        updated_at = datetime('now')
      WHERE proxy = ?
    `);
    return stmt.run(errorMessage, proxy);
  }

  // ========== COOLDOWN MANAGEMENT ==========

  async checkCooldownExpiration() {
    const stmt = this.db.prepare(`
      UPDATE proxy_states
      SET
        state = 'active',
        cooldown_until = NULL,
        updated_at = datetime('now')
      WHERE state = 'cooldown'
      AND cooldown_until <= datetime('now')
    `);
    return stmt.run();
  }

  async resetProxyCooldown(proxy) {
    const stmt = this.db.prepare(`
      UPDATE proxy_states
      SET
        state = 'active',
        cooldown_until = NULL,
        updated_at = datetime('now')
      WHERE proxy = ? AND state = 'cooldown'
    `);
    return stmt.run(proxy);
  }

  async resetAllCooldowns() {
    const stmt = this.db.prepare(`
      UPDATE proxy_states
      SET
        state = 'active',
        cooldown_until = NULL,
        updated_at = datetime('now')
      WHERE state = 'cooldown'
    `);
    const result = stmt.run();
    return result.changes;
  }

  // ========== BLACKLIST MANAGEMENT ==========

  async clearBlacklist() {
    const stmt = this.db.prepare(`
      UPDATE proxy_states
      SET
        state = 'active',
        blacklist_reason = NULL,
        blacklisted_at = NULL,
        updated_at = datetime('now')
      WHERE state = 'blacklisted'
    `);
    const result = stmt.run();
    return result.changes;
  }

  async removeProxy(proxy) {
    const stmt = this.db.prepare('DELETE FROM proxy_states WHERE proxy = ?');
    return stmt.run(proxy);
  }

  // ========== PROXY MANAGEMENT ==========

  async addProxy(proxy) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO proxy_states (proxy, state)
        VALUES (?, 'active')
        ON CONFLICT(proxy) DO NOTHING
      `);
      return stmt.run(proxy);
    } catch (error) {
      console.error(`Error adding proxy ${proxy}:`, error.message);
      return null;
    }
  }

  async updateProxyList(proxyArray) {
    // Get current proxies
    const currentProxies = this.db.prepare('SELECT proxy FROM proxy_states').all();
    const currentProxySet = new Set(currentProxies.map(p => p.proxy));
    const newProxySet = new Set(proxyArray);

    // Find proxies to add
    const toAdd = proxyArray.filter(p => !currentProxySet.has(p));

    // Find proxies to remove
    const toRemove = currentProxies.filter(p => !newProxySet.has(p.proxy)).map(p => p.proxy);

    // Add new proxies
    let added = 0;
    for (const proxy of toAdd) {
      const result = await this.addProxy(proxy);
      if (result) added++;
    }

    // Remove old proxies
    let removed = 0;
    for (const proxy of toRemove) {
      await this.removeProxy(proxy);
      removed++;
    }

    return {
      added,
      removed,
      total: proxyArray.length
    };
  }

  // ========== QUERIES ==========

  async getAllProxies() {
    const stmt = this.db.prepare(`
      SELECT * FROM proxy_states
      ORDER BY
        CASE state
          WHEN 'active' THEN 1
          WHEN 'cooldown' THEN 2
          WHEN 'blacklisted' THEN 3
        END,
        last_used DESC
    `);
    return stmt.all();
  }

  async getActiveProxies() {
    const stmt = this.db.prepare(`
      SELECT * FROM proxy_states
      WHERE state = 'active'
      ORDER BY last_used DESC
    `);
    return stmt.all();
  }

  async getCooldownProxies() {
    const stmt = this.db.prepare(`
      SELECT * FROM proxy_states
      WHERE state = 'cooldown'
      ORDER BY cooldown_until ASC
    `);
    return stmt.all();
  }

  async getBlacklistedProxies() {
    const stmt = this.db.prepare(`
      SELECT * FROM proxy_states
      WHERE state = 'blacklisted'
      ORDER BY blacklisted_at DESC
    `);
    return stmt.all();
  }

  async getProxyStatus(proxy) {
    const stmt = this.db.prepare('SELECT * FROM proxy_states WHERE proxy = ?');
    return stmt.get(proxy);
  }

  async getStats() {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN state = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN state = 'cooldown' THEN 1 ELSE 0 END) as cooldown,
        SUM(CASE WHEN state = 'blacklisted' THEN 1 ELSE 0 END) as blacklisted,
        SUM(total_requests) as totalRequests,
        SUM(success_count) as totalSuccesses,
        SUM(error_count) as totalErrors
      FROM proxy_states
    `);

    const stats = stmt.get();

    // Calculate percentages
    stats.activePercentage = stats.total > 0 ? (stats.active / stats.total * 100) : 0;
    stats.successRate = stats.totalRequests > 0 ? (stats.totalSuccesses / stats.totalRequests * 100) : 0;

    return stats;
  }

  // ========== CLEANUP ==========

  close() {
    this.db.close();
  }
}

module.exports = ProxyManager;
