// Database managers for Yarr desklet - async database operations

// Defer imports to avoid issues with require()
const Logger = require('./logger');
let GLib;

function getGLib() {
    if (!GLib) GLib = imports.gi.GLib;
    return GLib;
}

// Import AsyncDatabaseManager from async-managers
const { AsyncDatabaseManager, AsyncCommandExecutor } = require('./async-managers');

// Logging helper function
function log(message, isError = false) {
    Logger.log(message, isError);
}

// Add new class for database management
class FavoritesDB extends AsyncDatabaseManager {
    constructor() {
        try {
            Logger.log('[Yarr Debug] FavoritesDB constructor starting');
            const glib = getGLib();
            if (!glib) throw new Error('GLib not available');

            Logger.log('[Yarr Debug] GLib obtained');
            const userDataDir = glib.get_user_data_dir();
            if (!userDataDir) throw new Error('Could not get user data directory');

            const dbFile = glib.build_filenamev([userDataDir, 'yarr_favorites.db']);
            if (!dbFile) throw new Error('Could not build database file path');

            Logger.log('[Yarr Debug] Database file path: ' + dbFile);
            super(dbFile);
            this._log(`Favorites database path: ${dbFile}`);
        } catch (e) {
            Logger.log('[Yarr Error] Fatal: Could not determine database path: ' + e, true);
            throw new Error('Could not initialize database: ' + e.message);
        }
        this.initDatabase();
    }

    _log(message, isError = false) {
        log(message, isError);
    }

    async initDatabase() {
        try {
            // First create the table if it doesn't exist
            const createSql = `
                CREATE TABLE IF NOT EXISTS favorites (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    link TEXT UNIQUE NOT NULL,
                    title TEXT,
                    description TEXT,
                    category TEXT,
                    timestamp INTEGER,
                    hash TEXT,
                    channel TEXT,
                    labelColor TEXT,
                    pubDate TEXT
                )
            `;
            await this.executeQuery(createSql);

            // Check if hash column exists, if not add it
            try {
                await this.executeQuery("SELECT hash FROM favorites LIMIT 1");
                this._log('Hash column exists in favorites table');
            } catch (e) {
                this._log('Hash column missing, adding it...');
                await this.executeQuery("ALTER TABLE favorites ADD COLUMN hash TEXT");
                this._log('Hash column added to favorites table');
            }

            // Check and add channel column
            try {
                await this.executeQuery("SELECT channel FROM favorites LIMIT 1");
                this._log('Channel column exists in favorites table');
            } catch (e) {
                this._log('Channel column missing, adding it...');
                await this.executeQuery("ALTER TABLE favorites ADD COLUMN channel TEXT");
                this._log('Channel column added to favorites table');
            }

            // Check and add labelColor column
            try {
                await this.executeQuery("SELECT labelColor FROM favorites LIMIT 1");
                this._log('labelColor column exists in favorites table');
            } catch (e) {
                this._log('labelColor column missing, adding it...');
                await this.executeQuery("ALTER TABLE favorites ADD COLUMN labelColor TEXT");
                this._log('labelColor column added to favorites table');
            }

            // Check and add pubDate column
            try {
                await this.executeQuery("SELECT pubDate FROM favorites LIMIT 1");
                this._log('pubDate column exists in favorites table');
            } catch (e) {
                this._log('pubDate column missing, adding it...');
                await this.executeQuery("ALTER TABLE favorites ADD COLUMN pubDate TEXT");
                this._log('pubDate column added to favorites table');
            }

            this._log('Favorites database initialized successfully');
        } catch (e) {
            this._log('Error in initDatabase: ' + e, true);
        }
    }

    async _calculateSHA256(str) {
        try {
            const result = await AsyncCommandExecutor.executeCommand(`echo -n "${str}" | sha256sum`, (success, stdout, stderr) => {
                if (success && stdout) {
                    return stdout.split(' ')[0];
                }
                return null;
            });
            return result;
        } catch (e) {
            this._log('Error calculating SHA256: ' + e, true);
            return null;
        }
    }

    async addFavorite(item) {
        try {
            const hash = await this._calculateSHA256(item.link);
            // Use article publish time if available; fall back to now
            let publishMs = Date.now();
            try {
                if (item && item.timestamp) {
                    if (typeof item.timestamp.getTime === 'function') {
                        publishMs = item.timestamp.getTime();
                    } else {
                        const parsed = parseInt(item.timestamp);
                        if (!isNaN(parsed)) publishMs = parsed;
                    }
                } else if (item && item.pubDate) {
                    const d = new Date(item.pubDate);
                    if (!isNaN(d.getTime())) publishMs = d.getTime();
                }
            } catch (_ignored) { }

            const sql = `
                INSERT OR REPLACE INTO favorites (
                    link, title, description, category, timestamp, hash, channel, labelColor, pubDate
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?
                )
            `;

            await this.executeQuery(sql, [
                item.link,
                item.title || '',
                item.description || '',
                item.category || '',
                publishMs,
                hash || '',
                item.channel || '',
                item.labelColor || '',
                item.pubDate || ''
            ]);

            this._log(`Added favorite: ${item.title}`);
            return true;
        } catch (e) {
            this._log('Error adding favorite: ' + e, true);
            return false;
        }
    }

    async removeFavorite(url) {
        try {
            const sql = `DELETE FROM favorites WHERE link = ?`;
            await this.executeQuery(sql, [url]);
            this._log(`Removed favorite: ${url}`);
            return true;
        } catch (e) {
            this._log('Error removing favorite: ' + e, true);
            return false;
        }
    }

    async getFavorites() {
        try {
            const sql = "SELECT link FROM favorites";
            const result = await this.executeQuery(sql);

            if (!result) return new Set();

            // Result is JSON when using AsyncDatabaseManager SELECT
            try {
                const rows = JSON.parse(result);
                if (Array.isArray(rows)) {
                    const links = rows
                        .map(r => (typeof r === 'object' ? r.link : null))
                        .filter(Boolean);
                    return new Set(links);
                }
            } catch (_e) {
                // Fallback for non-JSON result (should not happen)
                const links = String(result).split('\n').filter(Boolean);
                return new Set(links);
            }
            return new Set();
        } catch (e) {
            this._log('Error in getFavorites: ' + e, true);
            return new Set();
        }
    }

    _escapeString(str) {
        if (typeof str !== 'string') {
            Logger.log('[Yarr Warning] Non-string value passed to _escapeString');
            return '';
        }
        return str.replace(/'/g, "''");
    }
}

// Class to track refresh history and article counts
class RefreshDB extends AsyncDatabaseManager {
    constructor() {
        try {
            Logger.log('[Yarr Debug] RefreshDB constructor starting');
            const glib = getGLib();
            if (!glib) throw new Error('GLib not available');

            Logger.log('[Yarr Debug] GLib obtained for RefreshDB');
            const userDataDir = glib.get_user_data_dir();
            if (!userDataDir) throw new Error('Could not get user data directory');

            const dbFile = glib.build_filenamev([userDataDir, 'yarr_refreshes.db']);
            if (!dbFile) throw new Error('Could not build database file path');

            Logger.log('[Yarr Debug] RefreshDB file path: ' + dbFile);
            super(dbFile);
            this._log(`Refresh database path: ${dbFile}`);
        } catch (e) {
            Logger.log('[Yarr Error] Fatal: Could not determine database path: ' + e, true);
            throw new Error('Could not initialize database: ' + e.message);
        }

        this.initDatabase();
        this.cleanupOldRecords();
    }

    _log(message, isError = false) {
        log(message, isError);
    }

    async initDatabase() {
        try {
            const sql = `
                CREATE TABLE IF NOT EXISTS refreshes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp INTEGER UNIQUE NOT NULL,
                    article_count INTEGER DEFAULT 0,
                    feeds_refreshed INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `;
            await this.executeQuery(sql);
            this._log('Refresh database initialized successfully');
        } catch (e) {
            this._log(`Error in initDatabase: ${e}`, true);
        }
    }

    async recordRefresh(timestamp, articleCount, feedsRefreshed) {
        try {
            this._log(`Recording refresh event to database: timestamp=${timestamp}, date=${new Date(timestamp).toLocaleString()}`);
            this._log(`Articles: ${articleCount}, Feeds: ${feedsRefreshed}`);

            const sql = `
                INSERT OR REPLACE INTO refreshes (
                    timestamp, article_count, feeds_refreshed
                ) VALUES (
                    ?, ?, ?
                )
            `;

            await this.executeQuery(sql, [timestamp, articleCount, feedsRefreshed]);

            // Verify the insert worked
            const verifySql = `SELECT COUNT(*) FROM refreshes WHERE timestamp = ?`;
            const verifyResult = await this.executeQuery(verifySql, [timestamp]);

            if (verifyResult) {
                const count = parseInt(verifyResult.trim());
                this._log(`Verified refresh event in database: ${count} record(s) found`);
                return count > 0;
            } else {
                this._log('Error verifying refresh record', true);
                return false;
            }
        } catch (e) {
            this._log('Error in recordRefresh: ' + e, true);
            return false;
        }
    }

    async getRefreshHistory(limit = 20) {
        try {
            const sql = `
                SELECT timestamp, article_count, feeds_refreshed
                FROM refreshes
                ORDER BY timestamp DESC
                LIMIT ?
            `;
            const result = await this.executeQuery(sql, [parseInt(limit)]);

            if (!result) return [];

            // Parse JSON result
            let refreshEvents = [];
            try {
                refreshEvents = JSON.parse(result);
                if (!Array.isArray(refreshEvents)) {
                    this._log('Result is not an array, treating as empty');
                    refreshEvents = [];
                }
            } catch (e) {
                this._log('Error parsing JSON result: ' + e, true);
                refreshEvents = [];
            }

            // Convert JSON objects to the expected format
            return refreshEvents.map(event => ({
                timestamp: parseInt(event.timestamp),
                articleCount: parseInt(event.article_count),
                feedsRefreshed: parseInt(event.feeds_refreshed)
            }));
        } catch (e) {
            this._log('Error in getRefreshHistory: ' + e, true);
            return [];
        }
    }

    async cleanupOldRecords() {
        try {
            // Keep only the last 3 months of refresh history
            const threeMonthsAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);

            const sql = `
                DELETE FROM refreshes
                WHERE timestamp < ?
            `;

            await this.executeQuery(sql, [threeMonthsAgo]);
            this._log('Cleaned up old refresh records');
        } catch (e) {
            this._log('Error in cleanupOldRecords: ' + e, true);
        }
    }
}

// Add new class for read status management
class ReadStatusDB extends AsyncDatabaseManager {
    constructor() {
        const glib = getGLib();
        const dbFile = glib.build_filenamev([glib.get_user_data_dir(), 'yarr_read_status.db']);
        super(dbFile);
        this._log(`Read status database path: ${dbFile}`);
        this.initDatabase();
    }

    _log(message, isError = false) {
        log(message, isError);
    }

    async initDatabase() {
        try {
            const sql = `
                CREATE TABLE IF NOT EXISTS read_articles (
                    id TEXT PRIMARY KEY,
                    timestamp INTEGER
                )
            `;
            await this.executeQuery(sql);
            this._log('Read status database initialized successfully');
        } catch (e) {
            this._log('Error in initDatabase: ' + e, true);
        }
    }

    async markRead(id) {
        try {
            const now = Date.now();
            const sql = `
                INSERT OR REPLACE INTO read_articles (id, timestamp)
                VALUES (?, ?)
            `;
            await this.executeQuery(sql, [id, now]);
            this._log(`Marked article as read: ${id}`);
            return true;
        } catch (e) {
            this._log('Error marking article as read: ' + e, true);
            return false;
        }
    }

    async markUnread(id) {
        try {
            const sql = `DELETE FROM read_articles WHERE id = ?`;
            await this.executeQuery(sql, [id]);
            this._log(`Marked article as unread: ${id}`);
            return true;
        } catch (e) {
            this._log('Error marking article as unread: ' + e, true);
            return false;
        }
    }

    async getReadIds(sinceTimestamp) {
        try {
            const sql = `
                SELECT id FROM read_articles
                WHERE timestamp >= ?
            `;
            const result = await this.executeQuery(sql, [sinceTimestamp || 0]);

            if (!result) return new Set();

            // Parse JSON result
            let readIds = [];
            try {
                readIds = JSON.parse(result);
                if (!Array.isArray(readIds)) {
                    this._log('Result is not an array, treating as empty');
                    readIds = [];
                }
            } catch (e) {
                this._log('Error parsing JSON result: ' + e, true);
                readIds = [];
            }

            // Extract IDs from JSON objects
            return new Set(readIds.map(item => item.id));
        } catch (e) {
            this._log('Error getting read IDs: ' + e, true);
            return new Set();
        }
    }

    async cleanupOldRecords() {
        try {
            // Keep read status for 30 days
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            const sql = `DELETE FROM read_articles WHERE timestamp < ?`;
            await this.executeQuery(sql, [thirtyDaysAgo]);
            this._log('Cleaned up old read status records');
        } catch (e) {
            this._log('Error in cleanupOldRecords: ' + e, true);
        }
    }

    _escapeString(str) {
        if (typeof str !== 'string') {
            Logger.log('[Yarr Warning] Non-string value passed to _escapeString');
            return '';
        }
        return str.replace(/'/g, "''");
    }
}

module.exports = {
    FavoritesDB,
    RefreshDB,
    ReadStatusDB
};
