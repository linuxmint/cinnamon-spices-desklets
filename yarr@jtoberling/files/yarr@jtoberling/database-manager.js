/*
 * Database Manager for Yarr Desklet
 * 
 * This file consolidates all database operations using SQL.js instead of command-line sqlite3.
 * It provides a unified interface for favorites, feed states, AI responses, and caching.
 */

const Logger = require('./logger');
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

// SQL.js library - pure JavaScript SQLite implementation
let SQL;

// Initialize SQL.js library
let sqlInitializing = false;
async function initializeSQL() {
    if (SQL) return SQL;
    if (sqlInitializing) {
        // Wait for the other initialization to complete
        while (sqlInitializing) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        return SQL;
    }

    sqlInitializing = true;
    try {
        Logger.debug('Loading SQL.js library...');
        const sqljs = require('./sql.js');

        if (typeof sqljs !== 'function') {
            throw new Error('sql.js library is not a function');
        }

        Logger.debug('Calling sqljs() to initialize...');
        const init = sqljs();
        if (!init || typeof init.then !== 'function') {
            throw new Error('sql.js() did not return a Promise');
        }

        Logger.debug('Waiting for SQL.js initialization...');
        SQL = await init;
        Logger.debug('SQL.js library initialized successfully');
        return SQL;
    } catch (error) {
        Logger.error('Failed to load SQL.js library:', error);
        throw error;
    } finally {
        sqlInitializing = false;
    }
}

class DatabaseManager {
    constructor(databasePath = null) {
        // Singleton pattern - prevent multiple instances
        if (DatabaseManager.instance) {
            Logger.debug(`Returning existing DatabaseManager instance`);
            return DatabaseManager.instance;
        }

        Logger.debug(`Creating new DatabaseManager singleton instance`);

        // Reference to desklet for cancellation support
        this.desklet = null;

        this.basePath = databasePath || '~/.local/share';
        // Clean the basePath to remove any trailing slashes
        this.basePath = this.basePath.replace(/\/+$/, '');
        const homeDir = GLib.get_home_dir();
        Logger.debug(`Home directory: "${homeDir}"`);
        Logger.debug(`Base path: "${this.basePath}"`);

        if (this.basePath.startsWith('~')) {
            const subPath = this.basePath.substring(1);
            Logger.debug(`Substring result: "${subPath}"`);
            // Ensure clean path concatenation without double slashes
            const cleanHomeDir = homeDir.replace(/\/+$/, ''); // Remove trailing slashes from homeDir
            const cleanSubPath = subPath.replace(/^\/+/, ''); // Remove leading slashes from subPath
            this.expandedPath = cleanHomeDir + '/' + cleanSubPath;
            Logger.debug(`Path construction: "${cleanHomeDir}" + "/" + "${cleanSubPath}" = "${this.expandedPath}"`);
        } else {
            this.expandedPath = this.basePath;
        }

        Logger.debug(`Expanded path: "${this.expandedPath}"`);

        // Fixed database filenames for each type
        this.databases = {
            favorites: 'yarr_favorites.db',
            readStatus: 'yarr_read_status.db',
            refresh: 'yarr_refresh.db',
            feedStates: 'yarr_feed_button_states.db',
            articleCache: 'yarr_article_cache.db'
        };

        // Database cache - keep databases in memory
        this.dbCache = new Map();

        // Track which databases have been modified and need saving
        this.modifiedDatabases = new Set();

        this.initialized = false;

        // Store the instance
        DatabaseManager.instance = this;

        // Basic validation
        if (!this.expandedPath || this.expandedPath.trim() === '') {
            Logger.error(`Invalid expanded path: ${this.expandedPath}`);
        }

        // Now we log full path for all databases
        Object.entries(this.databases).forEach(([type, filename]) => {
            const path = this._getDbPath(type);
            Logger.debug(`Database path for ${type}: ${path}`);
        });

        // Reference to desklet for cancellation support
        this.desklet = null;

    }

    // Set desklet reference for cancellation support
    setDeskletReference(desklet) {
        this.desklet = desklet;
        Logger.debug('DatabaseManager desklet reference set');
    }

    // Check if operation should be cancelled
    _checkCancellation(cancellationToken) {
        if (cancellationToken && this.desklet && this.desklet.asyncOperationManager) {
            if (this.desklet.asyncOperationManager.isCancelled(cancellationToken)) {
                Logger.debug('Database operation cancelled');
                return true;
            }
        }
        return false;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            Logger.debug(`Initializing database manager, expandedPath: ${this.expandedPath}`);

            // Basic path validation
            if (typeof this.expandedPath !== 'string' || !this.expandedPath.trim()) {
                throw new Error(`Invalid path: ${this.expandedPath}`);
            }

            // Check if directory exists, create if needed
            Logger.debug(`Checking directory: ${this.expandedPath}`);
            const dir = Gio.File.new_for_path(this.expandedPath);
            if (dir.query_exists(null)) {
                Logger.debug(`Directory already exists`);
            } else {
                Logger.debug(`Creating directory: ${this.expandedPath}`);
                dir.make_directory_with_parents(null);
                Logger.debug(`Directory created successfully`);
            }

            this.initialized = true;
            Logger.debug(`Database manager initialized successfully`);
        } catch (error) {
            Logger.error(`Failed to initialize database manager:`, error);
            this.initialized = false;
            throw error; // Re-throw the error so calling code knows it failed
        }
    }

    _getDbPath(dbType) {
        // Ensure clean path concatenation without double slashes
        const cleanPath = this.expandedPath.replace(/\/+$/, ''); // Remove trailing slashes
        const path = `${cleanPath}/${this.databases[dbType]}`;
        return path;
    }

    async _openDatabase(dbType) {
        try {
            // Validate database type
            if (!this.databases[dbType]) {
                Logger.error(`Invalid database type: ${dbType}`);
                return null;
            }

            // Check if database is already in cache
            if (this.dbCache.has(dbType)) {
                Logger.debug(`Using cached database ${dbType} (cache size: ${this.dbCache.size})`);
                return this.dbCache.get(dbType);
            }

            Logger.debug(`Database ${dbType} not in cache, loading from disk (cache size: ${this.dbCache.size})`);

            // Ensure database manager is ready
            const isReady = await this._ensureReady();
            if (!isReady) {
                Logger.error(`Database manager not ready for ${dbType} operation`);
                return null;
            }

            // Ensure SQL.js is initialized
            if (!SQL) {
                try {
                    Logger.debug(`Initializing SQL.js for ${dbType} operation`);
                    await initializeSQL();
                    Logger.debug(`SQL.js initialized successfully`);
                } catch (sqlError) {
                    Logger.error(`Failed to initialize SQL.js:`, sqlError);
                    Logger.error(`SQL.js error details:`, sqlError.message, sqlError.stack);
                    return null;
                }
            }

            const dbPath = this._getDbPath(dbType);
            if (!dbPath) {
                Logger.error(`Invalid database path for ${dbType}`);
                return null;
            }

            // Logger.debug(`Opening database ${dbType} at path: ${dbPath}`);
            let db;

            // If database exists, load it
            if (GLib.file_test(dbPath, GLib.FileTest.EXISTS)) {
                try {
                    Logger.debug(`Loading existing database ${dbType} from ${dbPath}`);
                    const fileContents = GLib.file_get_contents(dbPath);
                    Logger.debug(`File contents retrieved, length: ${fileContents[1] ? fileContents[1].length : 0} bytes`);

                    if (!fileContents[1] || fileContents[1].length === 0) {
                        throw new Error('Empty database file');
                    }

                    Logger.debug(`Creating SQL.js Database object for ${dbType}`);
                    db = new SQL.Database(fileContents[1]);
                    Logger.debug(`Successfully loaded existing database ${dbType}`);
                } catch (loadError) {
                    Logger.error(`Failed to load existing database ${dbType}:`, loadError);
                    Logger.error(`Load error details:`, loadError.message, loadError.stack);
                    return null;
                }
            } else {
                // Create new database with tables
                try {
                    Logger.debug(`Creating new database ${dbType} at ${dbPath}`);
                    db = new SQL.Database();
                    this._createTables(db, dbType);
                    Logger.debug(`Successfully created new database ${dbType}`);

                    // Immediately save the new database to disk
                    Logger.debug(`Saving newly created database ${dbType} to disk`);
                    const saveSuccess = this._saveDatabase(db, dbType);
                    if (!saveSuccess) {
                        Logger.error(`Failed to save newly created database ${dbType} to disk`);
                        db.close();
                        return null;
                    }
                    Logger.debug(`Successfully saved newly created database ${dbType} to disk`);
                } catch (createError) {
                    Logger.error(`Failed to create new database ${dbType}:`, createError);
                    Logger.error(`Create error details:`, createError.message, createError.stack);
                    return null;
                }
            }

            // Store database in cache
            this.dbCache.set(dbType, db);
            Logger.debug(`Database ${dbType} cached in memory (cache size now: ${this.dbCache.size})`);

            return db;
        } catch (error) {
            Logger.error(`Unexpected error in _openDatabase for ${dbType}:`, error);
            return null;
        }
    }

    _createTables(db, dbType) {
        try {
            Logger.debug(`Creating tables for database type: ${dbType}`);
            switch (dbType) {
                case 'favorites':
                    Logger.debug(`Creating favorites table`);
                    db.run(`CREATE TABLE IF NOT EXISTS favorites (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    link TEXT UNIQUE NOT NULL,
                    title TEXT,
                    description TEXT,
                    category TEXT,
                    timestamp INTEGER,
                    hash TEXT,
                    channel TEXT,
                    labelColor TEXT,
                    pubDate TEXT,
                    aiResponse TEXT
                )`);
                    break;

                case 'readStatus':
                    Logger.debug(`Creating read status tables`);
                    // Legacy table sometimes present
                    db.run(`CREATE TABLE IF NOT EXISTS read_articles (
                    id TEXT PRIMARY KEY,
                    timestamp INTEGER
                )`);
                    db.run(`CREATE TABLE IF NOT EXISTS read_status (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    article_hash TEXT UNIQUE NOT NULL,
                    read_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);
                    break;

                case 'refresh':
                    Logger.debug(`Creating refresh history table`);
                    db.run(`CREATE TABLE IF NOT EXISTS refresh_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp INTEGER NOT NULL,
                    article_count INTEGER DEFAULT 0,
                    feeds_refreshed INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);
                    break;

                case 'feedStates':
                    Logger.debug(`Creating feed button states table`);
                    db.run(`CREATE TABLE IF NOT EXISTS feed_button_states (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    feed_name TEXT UNIQUE NOT NULL,
                    runtime_display_enabled BOOLEAN DEFAULT 1,
                    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);
                    break;

                case 'articleCache':
                    Logger.debug(`Creating article cache table`);
                    db.run(`CREATE TABLE IF NOT EXISTS article_cache (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    article_hash TEXT UNIQUE NOT NULL,
                    article_link TEXT NOT NULL,
                    title TEXT,
                    description TEXT,
                    category TEXT,
                    channel TEXT,
                    labelColor TEXT,
                    pubDate TEXT,
                    timestamp INTEGER,
                    ai_response TEXT,
                    provider TEXT,
                    model TEXT
                )`);
                    break;
            }
            Logger.debug(`Successfully created tables for ${dbType}`);
        } catch (error) {
            Logger.error(`Failed to create tables for ${dbType}:`, error);
            Logger.error(`Table creation error details:`, error.message, error.stack);
            throw error; // Re-throw so calling code knows it failed
        }
    }

    _saveDatabase(db, dbType) {
        try {
            const dbPath = this._getDbPath(dbType);
            Logger.debug(`Saving database ${dbType} to path: ${dbPath}`);
            const data = db.export();
            Logger.debug(`Database ${dbType} exported, data size: ${data ? data.length : 0} bytes`);
            GLib.file_set_contents(dbPath, data);
            Logger.debug(`Database ${dbType} saved successfully`);

            // Mark as no longer modified
            this.modifiedDatabases.delete(dbType);

            return true;
        } catch (error) {
            Logger.error(`Failed to save database ${dbType}:`, error);
            Logger.error(`Save error details:`, error.message, error.stack);
            return false;
        }
    }

    // Favorites operations
    async addFavorite(url, title, feedTitle) {
        Logger.debug(`addFavorite called with: url=${url}, title=${title}, feedTitle=${feedTitle}`);

        // Ensure database manager is ready
        if (!this.isReady()) {
            Logger.error(`Database manager not ready for addFavorite operation`);
            return false;
        }

        // Handle both object format and separate parameters
        if (typeof url === 'object' && url !== null) {
            const item = url;
            Logger.debug(`Processing object format favorite:`, item);
            Logger.debug(`Calling object details:`, {
                type: typeof item,
                constructor: item?.constructor?.name,
                keys: Object.keys(item || {}),
                hasLink: 'link' in item,
                hasTitle: 'title' in item,
                hasDescription: 'description' in item,
                hasCategory: 'category' in item,
                linkValue: item?.link,
                titleValue: item?.title,
                descriptionValue: item?.description,
                categoryValue: item?.category
            });

            // For object format, we need to handle all the fields properly
            const db = await this._openDatabase('favorites');
            if (!db) return false;

            try {
                // Extract values with proper fallbacks based on actual item structure
                const link = item.link || '';
                const title = item.title || '';
                const description = item.description || '';
                const category = item.category || '';
                const timestamp = item.timestamp || Date.now();
                const hash = item.hash || '';
                const channel = item.channel || '';
                const labelColor = item.labelColor || '#ffffff';
                const pubDate = item.pubDate || '';
                const aiResponse = item.aiResponse || '';

                // Normalize timestamp to a number (ms since epoch) to satisfy SQL.js binding
                let normalizedTimestamp = timestamp;
                try {
                    if (normalizedTimestamp instanceof Date) {
                        normalizedTimestamp = normalizedTimestamp.getTime();
                    } else if (typeof normalizedTimestamp === 'string') {
                        const parsedTs = Date.parse(normalizedTimestamp);
                        normalizedTimestamp = isNaN(parsedTs) ? Date.now() : parsedTs;
                    } else if (typeof normalizedTimestamp !== 'number') {
                        normalizedTimestamp = Date.now();
                    }
                } catch (_e) {
                    normalizedTimestamp = Date.now();
                }

                Logger.debug(`Extracted values: link=${link}, title=${title}, category=${category}`);
                Logger.debug(`All extracted values:`, {
                    link: link,
                    title: title,
                    description: description,
                    category: category,
                    timestamp: normalizedTimestamp,
                    hash: hash,
                    channel: channel,
                    labelColor: labelColor,
                    pubDate: pubDate,
                    aiResponse: aiResponse
                });

                if (!link) {
                    Logger.error(`No valid link found in favorite object`);
                    return false;
                }

                Logger.debug(`Executing SQL: INSERT OR REPLACE INTO favorites with values:`, [link, title, description, category, normalizedTimestamp, hash, channel, labelColor, pubDate, aiResponse]);
                Logger.debug(`SQL parameter types:`, {
                    link: typeof link,
                    title: typeof title,
                    description: typeof description,
                    category: typeof category,
                    timestamp: typeof normalizedTimestamp,
                    hash: typeof hash,
                    channel: typeof channel,
                    labelColor: typeof labelColor,
                    pubDate: typeof pubDate,
                    aiResponse: typeof aiResponse
                });

                // Validate database is still valid
                if (!db || typeof db.run !== 'function') {
                    Logger.error(`Database is invalid or closed before SQL execution`);
                    return false;
                }

                Logger.debug(`Database validation passed, executing SQL...`);

                // Database structure is validated - proceed with SQL execution

                try {
                    Logger.debug(`About to execute SQL with ${db ? 'valid' : 'invalid'} database object`);
                    Logger.debug(`Database object type:`, typeof db);
                    Logger.debug(`Database object keys:`, Object.keys(db || {}));

                    // Log the exact SQL statement and parameters
                    // Use simpler INSERT that lets SQLite handle column mapping
                    const sqlStatement = `INSERT OR REPLACE INTO favorites VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                    const sqlParams = [link, title, description, category, normalizedTimestamp, hash, channel, labelColor, pubDate, aiResponse];

                    Logger.debug(`SQL Statement:`, sqlStatement);
                    Logger.debug(`SQL Parameters:`, sqlParams);
                    Logger.debug(`Parameter count:`, sqlParams.length);
                    Logger.debug(`Expected parameter count: 10`);

                    // Check if any parameters are undefined or null
                    const undefinedParams = sqlParams.map((param, index) => ({ index, value: param, type: typeof param, isUndefined: param === undefined, isNull: param === null }));
                    Logger.debug(`Parameter details:`, undefinedParams);

                    Logger.debug(`Executing db.run()...`);
                    const result = db.run(sqlStatement, sqlParams);
                    Logger.debug(`SQL executed successfully, result:`, result);
                } catch (sqlError) {
                    Logger.error(`SQL execution failed:`, sqlError);
                    Logger.error(`SQL error type:`, typeof sqlError);
                    Logger.error(`SQL error constructor:`, sqlError?.constructor?.name);
                    Logger.error(`SQL error message:`, sqlError?.message);
                    Logger.error(`SQL error stack:`, sqlError?.stack);
                    Logger.error(`SQL error toString:`, sqlError?.toString());
                    Logger.error(`Full SQL error object:`, sqlError);

                    // Try to get more error details
                    if (sqlError && typeof sqlError === 'object') {
                        Logger.error(`SQL error own properties:`, Object.getOwnPropertyNames(sqlError));
                        Logger.error(`SQL error all properties:`, Object.keys(sqlError));
                        Logger.error(`SQL error values:`, Object.values(sqlError));
                    }

                    throw sqlError; // Re-throw to be caught by outer catch
                }

                const success = this._saveDatabase(db, 'favorites');
                Logger.debug(`Database save result: ${success}`);
                return success;
            } catch (error) {
                Logger.error(`Failed to add favorite from object:`, error);
                Logger.error(`Error details:`, error.message, error.stack);
                Logger.error(`Error type:`, typeof error);
                Logger.error(`Error constructor:`, error.constructor.name);
                return false;
            }
        }

        const db = await this._openDatabase('favorites');
        if (!db) return false;

        try {
            db.run(`INSERT OR REPLACE INTO favorites (link, title, description, category, timestamp, hash, channel, labelColor, pubDate, aiResponse) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [url, title, feedTitle || '', '', Date.now(), '', '', '#ffffff', '', '']);
            const success = this._saveDatabase(db, 'favorites');
            return success;
        } catch (error) {
            Logger.error(`Failed to add favorite:`, error);
            return false;
        }
    }

    async getFavorites() {
        const db = await this._openDatabase('favorites');
        if (!db) {
            Logger.debug(`Failed to open favorites database`);
            return [];
        }

        try {
            const result = db.exec(`SELECT link, title, description, category, timestamp, hash, channel, labelColor, pubDate, aiResponse FROM favorites ORDER BY timestamp DESC`);

            if (result && result[0] && result[0].values) {
                const favorites = result[0].values.map(row => ({
                    url: row[0],
                    title: row[1],
                    description: row[2] || '',
                    category: row[3] || '',
                    addedDate: row[4],
                    hash: row[5] || '',
                    channel: row[6] || '',
                    labelColor: row[7] || '#ffffff',
                    pubDate: row[8] || '',
                    aiResponse: row[9] || ''
                }));
                Logger.debug(`Retrieved ${favorites.length} favorites`);
                return favorites;
            }
            Logger.debug(`No favorites found or invalid result format`);
            return [];
        } catch (error) {
            Logger.error(`Failed to get favorites:`, error);
            return [];
        }
    }

    async removeFavorite(url) {
        Logger.debug(`removeFavorite called with url: ${url}`);
        const db = await this._openDatabase('favorites');
        if (!db) {
            Logger.debug(`Failed to open favorites database for removal`);
            return false;
        }

        try {
            db.run(`DELETE FROM favorites WHERE link = ?`, [url]);
            const success = this._saveDatabase(db, 'favorites');
            return success;
        } catch (error) {
            Logger.error(`Failed to remove favorite:`, error);
            return false;
        }
    }

    // Read status operations
    async markAsRead(articleId) {
        const db = await this._openDatabase('readStatus');
        if (!db) {
            Logger.debug(`Failed to open readStatus database for markAsRead`);
            return false;
        }

        try {
            Logger.debug(`Marking article as read: ${articleId}`);
            // Maintain both legacy and current tables
            db.run(`INSERT OR REPLACE INTO read_status (article_hash) VALUES (?)`, [articleId]);
            db.run(`INSERT OR REPLACE INTO read_articles (id, timestamp) VALUES (?, ?)`, [articleId, Date.now()]);
            const success = this._saveDatabase(db, 'readStatus');
            return success;
        } catch (error) {
            Logger.error(`Failed to mark as read:`, error);
            return false;
        }
    }

    async isRead(articleId) {
        const db = await this._openDatabase('readStatus');
        if (!db) {
            Logger.debug(`Failed to open readStatus database for isRead`);
            return false;
        }

        try {
            const result = db.exec(`SELECT 1 FROM read_status WHERE article_hash = ?`, [articleId]);

            if (result && result[0] && result[0].values && result[0].values.length > 0) {
                const isRead = result[0].values[0][0] !== null && result[0].values[0][0] !== undefined;
                Logger.debug(`Article read status: ${isRead}`);
                return isRead;
            }
            return false;
        } catch (error) {
            Logger.error(`Failed to check read status:`, error);
            return false;
        }
    }

    async getReadArticleIds() {
        Logger.debug(`getReadArticleIds called`);
        const db = await this._openDatabase('readStatus');
        if (!db) {
            Logger.debug(`Failed to open readStatus database for getReadArticleIds`);
            return [];
        }

        try {
            const result = db.exec(`SELECT article_hash FROM read_status`);

            if (result && result[0] && result[0].values) {
                const articleIds = result[0].values.map(row => row[0] || '').filter(id => id);
                Logger.debug(`Retrieved ${articleIds.length} read article IDs`);
                return articleIds;
            }
            Logger.debug(`No read article IDs found`);
            return [];
        } catch (error) {
            Logger.error(`Failed to get read article IDs:`, error);
            return [];
        }
    }

    // Refresh operations
    async addRefreshEvent(feedUrl, success = true) {
        Logger.debug(`addRefreshEvent called with feedUrl: ${feedUrl}, success: ${success}`);
        const db = await this._openDatabase('refresh');
        if (!db) {
            Logger.debug(`Failed to open refresh database for addRefreshEvent`);
            return false;
        }

        try {
            db.run(`INSERT INTO refresh_history (timestamp, article_count, feeds_refreshed) VALUES (?, ?, ?)`,
                [Date.now(), 0, success ? 1 : 0]);
            const result = this._saveDatabase(db, 'refresh');
            return result;
        } catch (error) {
            Logger.error(`Failed to add refresh event:`, error);
            return false;
        }
    }

    async getRefreshEvents() {
        Logger.debug(`getRefreshEvents called`);
        const db = await this._openDatabase('refresh');
        if (!db) {
            Logger.debug(`Failed to open refresh database for getRefreshEvents`);
            return [];
        }

        try {
            const result = db.exec(`SELECT timestamp, article_count, feeds_refreshed FROM refresh_history ORDER BY timestamp DESC LIMIT 100`);

            if (result && result[0] && result[0].values) {
                const events = result[0].values.map(row => ({
                    refreshDate: row[0] || Date.now(),
                    articleCount: row[1] || 0,
                    feedsRefreshed: row[2] || 0
                }));
                Logger.debug(`Retrieved ${events.length} refresh events`);
                return events;
            }
            Logger.debug(`No refresh events found`);
            return [];
        } catch (error) {
            Logger.error(`Failed to get refresh events:`, error);
            return [];
        }
    }

    // Feed state operations
    async setFeedExpanded(feedUrl, isExpanded) {
        Logger.debug(`setFeedExpanded called with feedUrl: ${feedUrl}, isExpanded: ${isExpanded}`);
        const db = await this._openDatabase('feedStates');
        if (!db) {
            Logger.debug(`Failed to open feedStates database for setFeedExpanded`);
            return false;
        }

        try {
            db.run(`INSERT OR REPLACE INTO feed_button_states (feed_name, runtime_display_enabled, last_updated) 
                    VALUES (?, ?, CURRENT_TIMESTAMP)`, [feedUrl, isExpanded ? 1 : 0]);
            const success = this._saveDatabase(db, 'feedStates'); // same file
            return success;
        } catch (error) {
            Logger.error(`Failed to set feed expanded:`, error);
            return false;
        }
    }

    async isFeedExpanded(feedUrl) {
        const db = await this._openDatabase('feedStates');
        if (!db) {
            Logger.debug(`Failed to open feedStates database for isFeedExpanded`);
            return false;
        }

        try {
            const result = db.exec(`SELECT runtime_display_enabled FROM feed_button_states WHERE feed_name = ?`, [feedUrl]);

            if (result && result[0] && result[0].values && result[0].values.length > 0) {
                const value = result[0].values[0][0];
                const isExpanded = value === 1 || value === true;
                Logger.debug(`Feed expanded state: ${isExpanded}`);
                return isExpanded;
            }
            return false;
        } catch (error) {
            Logger.error(`Failed to check feed expanded:`, error);
            return false;
        }
    }

    // Article cache operations
    async cacheArticle(articleId, content) {
        Logger.debug(`cacheArticle called with articleId: ${articleId}, content length: ${content ? content.length : 0}`);
        const db = await this._openDatabase('articleCache');
        if (!db) {
            Logger.debug(`Failed to open articleCache database for cacheArticle`);
            return false;
        }

        try {
            Logger.debug(`Caching article in database`);
            db.run(`INSERT OR REPLACE INTO article_cache (article_hash, article_link, title, timestamp) 
                    VALUES (?, ?, ?, ?)`,
                [articleId, '', content, Date.now()]);
            const success = this._saveDatabase(db, 'articleCache');
            return success;
        } catch (error) {
            Logger.error(`Failed to cache article:`, error);
            return false;
        }
    }

    async getCachedArticle(articleId) {
        const db = await this._openDatabase('articleCache');
        if (!db) {
            Logger.debug(`Failed to open articleCache database for getCachedArticle`);
            return null;
        }

        try {
            Logger.debug(`Getting cached article from database`);
            const result = db.exec(`SELECT title, last_accessed FROM article_cache WHERE article_hash = ?`, [articleId]);

            if (result && result[0] && result[0].values && result[0].values.length > 0) {
                const article = {
                    content: result[0].values[0][0] || '',
                    cachedDate: result[0].values[0][1] || Date.now()
                };
                return article;
            }
            return null;
        } catch (error) {
            Logger.error(`Failed to get cached article:`, error);
            return null;
        }
    }

    // Utility methods
    async saveDatabase() {
        return true;
    }

    async cleanupOldRecords() {
        // Not implemented - databases are managed per operation
    }

    // Cleanup method to close all cached databases
    cleanup() {
        try {
            Logger.debug(`Cleaning up DatabaseManager, closing ${this.dbCache.size} cached databases`);

            // Close all cached databases
            for (const [dbType, db] of this.dbCache) {
                try {
                    if (db && typeof db.close === 'function') {
                        db.close();
                        Logger.debug(`Closed database: ${dbType}`);
                    }
                } catch (error) {
                    Logger.error(`Error closing database ${dbType}:`, error);
                }
            }

            // Clear the cache
            this.dbCache.clear();
            this.modifiedDatabases.clear();
            this.initialized = false;

            Logger.debug(`DatabaseManager cleanup completed`);
        } catch (error) {
            Logger.error(`Error during DatabaseManager cleanup:`, error);
        }
    }

    // Feed states operations
    async getFeedStates() {
        const db = await this._openDatabase('feedStates');
        if (!db) {
            Logger.debug(`Failed to open feedStates database for getFeedStates`);
            return new Map();
        }

        try {
            Logger.debug(`Getting feed states from database`);
            const result = db.exec(`SELECT feed_name, runtime_display_enabled FROM feed_button_states`);

            const states = new Map();
            if (result && result[0] && result[0].values) {
                result[0].values.forEach(row => {
                    const feedName = row[0] || '';
                    const isExpanded = row[1] === 1;
                    if (feedName) {
                        states.set(feedName, isExpanded);
                    }
                });
            }
            Logger.debug(`Retrieved ${states.size} feed states`);
            return states;
        } catch (error) {
            Logger.error(`Failed to get feed states:`, error);
            return new Map();
        }
    }

    async saveAllFeedStates(feeds) {
        if (!feeds || feeds.length === 0) {
            Logger.debug(`No feeds to save`);
            return false;
        }

        const db = await this._openDatabase('feedStates');
        if (!db) {
            Logger.debug(`Failed to open feedStates database for saveAllFeedStates`);
            return false;
        }

        try {
            // Clear existing states
            db.run(`DELETE FROM feed_button_states`);

            // Insert new states
            feeds.forEach(feed => {
                if (feed.name && typeof feed.runtimeDisplayEnabled !== 'undefined') {
                    db.run(`INSERT INTO feed_button_states (feed_name, runtime_display_enabled, last_updated) VALUES (?, ?, CURRENT_TIMESTAMP)`,
                        [feed.name, feed.runtimeDisplayEnabled ? 1 : 0]);
                }
            });

            const success = this._saveDatabase(db, 'feedStates');
            return success;
        } catch (error) {
            Logger.error(`Failed to save feed states:`, error);
            return false;
        }
    }

    // Refresh history operations
    async getRefreshHistory() {
        const db = await this._openDatabase('refresh');
        if (!db) {
            Logger.debug(`Failed to open refresh database for getRefreshHistory`);
            return [];
        }

        try {
            const result = db.exec(`SELECT timestamp, article_count, feeds_refreshed FROM refresh_history ORDER BY timestamp DESC LIMIT 100`);

            if (result && result[0] && result[0].values) {
                const history = result[0].values.map(row => ({
                    timestamp: row[0] || Date.now(),
                    articleCount: row[1] || 0,
                    feedsRefreshed: row[2] || 0
                }));
                Logger.debug(`Retrieved ${history.length} refresh history entries`);
                return history;
            }
            Logger.debug(`No refresh history found`);
            return [];
        } catch (error) {
            Logger.error(`Failed to get refresh history:`, error);
            return [];
        }
    }

    // Record refresh with new signature (for current usage)
    async recordRefresh(articleCount, feedsRefreshed, feedsFailed = 0) {
        const db = await this._openDatabase('refresh');
        if (!db) {
            Logger.debug(`Failed to open refresh database for recordRefresh`);
            return false;
        }

        try {
            db.run(`INSERT INTO refresh_history (timestamp, article_count, feeds_refreshed) VALUES (?, ?, ?)`,
                [Date.now(), articleCount, feedsRefreshed]);

            const success = this._saveDatabase(db, 'refresh');
            return success;
        } catch (error) {
            Logger.error(`Failed to record refresh:`, error);
            return false;
        }
    }

    // Record refresh with old signature (for backward compatibility)
    async recordRefreshOld(feedUrl, articleCount) {
        const db = await this._openDatabase('refresh');
        if (!db) {
            Logger.debug(`Failed to open refresh database for recordRefreshOld`);
            return false;
        }

        try {
            db.run(`INSERT INTO refresh_history (timestamp, article_count, feeds_refreshed) VALUES (?, ?, ?)`,
                [Date.now(), articleCount, 1]);

            const success = this._saveDatabase(db, 'refresh');
            return success;
        } catch (error) {
            Logger.error(`Failed to record refresh (old format):`, error);
            return false;
        }
    }

    // Read status operations
    async getReadIds() {
        const db = await this._openDatabase('readStatus');
        if (!db) {
            Logger.debug(`Failed to open readStatus database for getReadIds`);
            return [];
        }

        try {
            const result = db.exec(`SELECT article_hash FROM read_status`);

            if (result && result[0] && result[0].values) {
                const readIds = result[0].values.map(row => row[0] || '').filter(id => id);
                Logger.debug(`Retrieved ${readIds.length} read IDs`);
                return readIds;
            }
            Logger.debug(`No read IDs found`);
            return [];
        } catch (error) {
            Logger.error(`Failed to get read IDs:`, error);
            return [];
        }
    }

    // Article cache operations
    async getArticleFromCache(articleId) {
        const db = await this._openDatabase('articleCache');
        if (!db) {
            Logger.debug(`Failed to open articleCache database for getArticleFromCache`);
            return null;
        }

        try {
            const result = db.exec(`SELECT article_link, title, description, category, channel, labelColor, pubDate, timestamp, last_accessed, ai_response, provider, model FROM article_cache WHERE article_hash = ?`, [articleId]);

            if (result && result[0] && result[0].values && result[0].values.length > 0) {
                const row = result[0].values[0];
                const article = {
                    url: row[0] || '',
                    title: row[1] || '',
                    description: row[2] || '',
                    category: row[3] || '',
                    channel: row[4] || '',
                    labelColor: row[5] || '#ffffff',
                    pubDate: row[6] || '',
                    timestamp: row[7] || Date.now(),
                    cachedDate: row[8] || Date.now(),
                    aiResponse: row[9] || '',
                    provider: row[10] || '',
                    model: row[11] || ''
                };
                return article;
            }
            return null;
        } catch (error) {
            Logger.error(`Failed to get article from cache:`, error);
            return null;
        }
    }

    async isArticleCached(articleId) {
        const db = await this._openDatabase('articleCache');
        if (!db) {
            Logger.debug(`Failed to open articleCache database for isArticleCached`);
            return { isCached: false, cachedDate: null };
        }

        try {
            const result = db.exec(`SELECT last_accessed FROM article_cache WHERE article_hash = ?`, [articleId]);

            if (result && result[0] && result[0].values && result[0].values.length > 0) {
                const cachedDate = result[0].values[0][0] || Date.now();
                Logger.debug(`Article is cached, cachedDate: ${cachedDate}`);
                return { isCached: true, cachedDate: cachedDate };
            }
            return { isCached: false, cachedDate: null };
        } catch (error) {
            Logger.error(`Failed to check if article is cached:`, error);
            return { isCached: false, cachedDate: null };
        }
    }

    async cacheArticleData(articleId, url, data) {
        const db = await this._openDatabase('articleCache');
        if (!db) {
            Logger.debug(`Failed to open articleCache database for cacheArticleData`);
            return false;
        }

        try {
            db.run(`INSERT OR REPLACE INTO article_cache (article_hash, article_link, title, description, category, channel, labelColor, pubDate, timestamp, last_accessed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [articleId, url, data.title || '', data.description || '', data.category || '', data.channel || '', data.labelColor || '#ffffff', data.pubDate || '', data.timestamp || Date.now(), Math.floor(Date.now() / 1000)]);

            const success = this._saveDatabase(db, 'articleCache');
            return success;
        } catch (error) {
            Logger.error(`Failed to cache article data:`, error);
            return false;
        }
    }

    // Load favorite articles (for backward compatibility)
    async loadFavoriteArticles() {
        try {
            // Ensure database manager is ready
            if (!this.isReady()) {
                Logger.error(`Database manager not ready for loadFavoriteArticles operation`);
                return [];
            }

            const db = await this._openDatabase('favorites');
            if (!db) {
                Logger.debug(`Failed to open favorites database for loadFavoriteArticles`);
                return [];
            }

            const result = db.exec(`SELECT link, title, description, category, timestamp, hash, channel, labelColor, pubDate, aiResponse FROM favorites ORDER BY timestamp DESC`);

            if (result && result[0] && result[0].values) {
                const favorites = result[0].values.map(row => ({
                    key: row[0],
                    link: row[0],
                    title: row[1],
                    description: row[2] || '',
                    category: row[3] || '',
                    timestamp: row[4],
                    hash: row[5] || '',
                    channel: row[6] || '',
                    labelColor: row[7] || '#ffffff',
                    pubDate: row[8] || '',
                    aiResponse: row[9] || ''
                }));
                Logger.debug(`Successfully loaded ${favorites.length} favorite articles`);
                return favorites;
            }
            Logger.debug(`No favorite articles found`);
            return [];
        } catch (error) {
            Logger.error(`Failed to load favorite articles:`, error);
            return [];
        }
    }

    // AI Response operations
    async addAIResponse(articleHash, articleLink, articleData, aiResponse, provider, model) {
        Logger.debug(`addAIResponse called with articleHash: ${articleHash}, provider: ${provider}, model: ${model}`);
        try {
            const db = await this._openDatabase('articleCache');
            if (!db) {
                Logger.debug(`Failed to open articleCache database for addAIResponse`);
                return false;
            }

            const params = [
                String(articleHash || ''),
                String(articleLink || ''),
                String(articleData.title || ''),
                String(articleData.description || ''),
                String(articleData.category || ''),
                String(articleData.channel || ''),
                String(articleData.labelColor || '#ffffff'),
                String(articleData.pubDate || ''),
                Number(articleData.timestamp || Date.now()),
                String(aiResponse || ''),
                String(provider || 'unknown'),
                String(model || 'unknown')
            ];

            db.run(`INSERT OR REPLACE INTO article_cache (article_hash, article_link, title, description, category, channel, labelColor, pubDate, timestamp, ai_response, provider, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params);

            // Mark as modified - will be saved later
            this.markModified('articleCache');

            return true;
        } catch (error) {
            Logger.error(`Failed to add AI response:`, error);
            throw error;
        }
    }

    async getAIResponse(articleHash) {
        Logger.debug(`getAIResponse called with articleHash: ${articleHash}`);
        try {
            const db = await this._openDatabase('articleCache');
            if (!db) {
                Logger.debug(`Failed to open articleCache database for getAIResponse`);
                return null;
            }

            const result = db.exec(`SELECT ai_response, provider, model FROM article_cache WHERE article_hash = ?`, [articleHash]);

            if (result && result[0] && result[0].values && result[0].values.length > 0) {
                const row = result[0].values[0];
                const aiResponse = {
                    aiResponse: row[0] || '',
                    provider: row[1] || '',
                    model: row[2] || ''
                };
                return aiResponse;
            }
            Logger.debug(`No AI response found`);
            return null;
        } catch (error) {
            Logger.error(`Failed to get AI response:`, error);
            return null;
        }
    }

    async updateAIResponseAccess(articleHash) {
        Logger.debug(`updateAIResponseAccess called with articleHash: ${articleHash}`);
        try {
            const db = await this._openDatabase('articleCache');
            if (!db) {
                Logger.debug(`Failed to open articleCache database for updateAIResponseAccess`);
                return false;
            }

            db.run(`UPDATE article_cache SET last_accessed = CURRENT_TIMESTAMP WHERE article_hash = ?`, [articleHash]);
            const success = this._saveDatabase(db, 'articleCache');

            return success;
        } catch (error) {
            Logger.error(`Failed to update AI response access:`, error);
            throw error;
        }
    }

    // Save article to cache with AI response (for backward compatibility)
    async saveArticleToCache(articleHash, articleLink, articleData, aiResponse, provider, model) {
        Logger.debug(`saveArticleToCache called with articleHash: ${articleHash}, provider: ${provider}, model: ${model}`);
        try {
            const db = await this._openDatabase('articleCache');
            if (!db) {
                Logger.debug(`Failed to open articleCache database for saveArticleToCache`);
                return false;
            }

            const params = [
                String(articleHash || ''),
                String(articleLink || ''),
                String(articleData.title || ''),
                String(articleData.description || ''),
                String(articleData.category || ''),
                String(articleData.channel || ''),
                String(articleData.labelColor || '#ffffff'),
                String(articleData.pubDate || ''),
                Number(articleData.timestamp || Date.now()),
                String(aiResponse || ''),
                String(provider || 'unknown'),
                String(model || 'unknown')
            ];

            db.run(`INSERT OR REPLACE INTO article_cache (article_hash, article_link, title, description, category, channel, labelColor, pubDate, timestamp, ai_response, provider, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params);

            // Save to disk immediately
            const success = this._saveDatabase(db, 'articleCache');
            if (!success) {
                Logger.error(`Failed to save article cache to disk`);
                return false;
            }

            return true;
        } catch (error) {
            Logger.error(`Failed to save article to cache:`, error);
            throw error;
        }
    }

    // Mark article as read (for backward compatibility)
    async markRead(articleHash) {
        Logger.debug(`markRead called with articleHash: ${articleHash}`);
        try {
            const db = await this._openDatabase('readStatus');
            if (!db) {
                Logger.debug(`Failed to open readStatus database for markRead`);
                return false;
            }

            db.run(`INSERT OR REPLACE INTO read_status (article_hash) VALUES (?)`, [articleHash]);
            const success = this._saveDatabase(db, 'readStatus');
            return success;
        } catch (error) {
            Logger.error(`Failed to mark article as read:`, error);
            throw error;
        }
    }

    // Mark article as unread (for backward compatibility)
    async markUnread(articleHash) {
        Logger.debug(`markUnread called with articleHash: ${articleHash}`);
        try {
            const db = await this._openDatabase('readStatus');
            if (!db) {
                Logger.debug(`Failed to open readStatus database for markUnread`);
                return false;
            }

            db.run(`DELETE FROM read_status WHERE article_hash = ?`, [articleHash]);
            const success = this._saveDatabase(db, 'readStatus');
            return success;
        } catch (error) {
            Logger.error(`Failed to mark article as unread:`, error);
            throw error;
        }
    }

    // testConnection method removed - not needed in production

    getDatabaseInfo() {
        const info = {
            basePath: this.basePath,
            expandedPath: this.expandedPath,
            initialized: this.initialized,
            databases: this.databases
        };
        return info;
    }

    getExpandedDatabasePath() {
        Logger.debug(`getExpandedDatabasePath returning: ${this.expandedPath}`);
        return this.expandedPath;
    }

    // Check if database manager is ready for operations
    isReady() {
        const ready = this.initialized;
        return ready;
    }

    // Helper to ensure database manager is ready
    async _ensureReady() {
        if (!this.isReady()) {
            Logger.debug(`Database manager not ready, attempting to initialize...`);
            // Try to initialize if not already done
            try {
                await this.initialize();
            } catch (error) {
                Logger.error(`Failed to initialize database manager in _ensureReady:`, error);
                // Don't throw, just return false to indicate not ready
                return false;
            }
        }

        // Double-check that initialization actually succeeded
        if (!this.isReady()) {
            Logger.error(`Database manager initialization failed - still not ready after initialize() call`);
            return false;
        }

        const ready = this.isReady();
        return ready;
    }

    // Mark database as modified (needs saving)
    markModified(dbType) {
        this.modifiedDatabases.add(dbType);
        Logger.debug(`Database ${dbType} marked as modified`);
    }

    // Save all modified databases
    async saveAllModified() {
        const modifiedCount = this.modifiedDatabases.size;
        if (modifiedCount === 0) {
            Logger.debug(`No modified databases to save`);
            return true;
        }

        Logger.debug(`Saving ${modifiedCount} modified databases`);
        let successCount = 0;

        for (const dbType of this.modifiedDatabases) {
            const db = this.dbCache.get(dbType);
            if (db) {
                try {
                    const success = this._saveDatabase(db, dbType);
                    if (success) successCount++;
                } catch (error) {
                    Logger.error(`Failed to save modified database ${dbType}:`, error);
                }
            }
        }

        Logger.debug(`Successfully saved ${successCount}/${modifiedCount} modified databases`);
        return successCount === modifiedCount;
    }

    // Cleanup method to close any open connections and save modified databases
    async cleanup() {
        Logger.debug(`Starting database manager cleanup`);

        // Save all modified databases before cleanup
        await this.saveAllModified();

        // Close and clear all cached databases
        for (const [dbType, db] of this.dbCache) {
            try {
                db.close();
                Logger.debug(`Closed database ${dbType}`);
            } catch (error) {
                Logger.error(`Error closing database ${dbType}:`, error);
            }
        }

        this.dbCache.clear();
        this.modifiedDatabases.clear();
        this.initialized = false;
        SQL = null;

        Logger.debug(`Database manager cleanup completed`);
    }

    logDatabaseSummary() {
        // Log comprehensive database summary for debugging
        Logger.debug(`Database Summary:`);
        Logger.debug(`Base path: ${this.basePath}`);
        Logger.debug(`Expanded path: ${this.expandedPath}`);
        Logger.debug(`Initialized: ${this.initialized}`);

        const missingDbs = [];
        const existingDbs = [];
        Object.entries(this.databases).forEach(([type, filename]) => {
            const path = this._getDbPath(type);
            if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
                missingDbs.push(type);
                Logger.debug(`Missing database: ${type} at ${path}`);
            } else {
                existingDbs.push(type);
                Logger.debug(`Existing database: ${type} at ${path}`);
            }
        });

        if (missingDbs.length > 0) {
            Logger.debug(`Missing databases: ${missingDbs.join(', ')}`);
        }
        if (existingDbs.length > 0) {
            Logger.debug(`Existing databases: ${existingDbs.join(', ')}`);
        }
    }
}

module.exports = DatabaseManager;
