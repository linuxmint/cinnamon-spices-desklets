const UUID = "yarr@jtoberling";

const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Settings = imports.ui.settings;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Gettext = imports.gettext;
const Mainloop = imports.mainloop;
const Soup = imports.gi.Soup;
const SignalManager = imports.misc.signalManager;
const Gio = imports.gi.Gio;
const Secret = imports.gi.Secret;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const ModalDialog = imports.ui.modalDialog;

// Central logger
const Logger = require('./logger');

// Import our new modular components
const { FeedProcessor } = require('./feed-processors');
const { UIDisplay } = require('./ui-display');
const { FeedCollection } = require('./feed-collection');
const { ArticleManagement } = require('./article-management');
const { AIManagers } = require('./ai-managers');
const { Utilities } = require('./utilities');
const { SearchManagers } = require('./search-managers');
const { FavoritesManagers } = require('./favorites-managers');

// Import our modules in correct dependency order
const fromXMLModule = require('./fromXML');
let fromXML = fromXMLModule.fromXML;

try {
    const managers = require('./async-managers');
    // Make classes available globally
    var AsyncCommandExecutor = managers.AsyncCommandExecutor;
    var TimerManager = managers.TimerManager;
    var UIUpdateManager = managers.UIUpdateManager;
    var AsyncOperationManager = managers.AsyncOperationManager;
    // AsyncErrorHandler is now imported from logger module
} catch (e) {
    Logger.error('async-managers import failed: ' + e);
    throw e;
}

try {
    const DatabaseManager = require('./database-manager');
    // Don't create database manager yet - will be created after settings are bound
    var DatabaseManagerClass = DatabaseManager;
} catch (e) {
    Logger.error('database-managers import failed: ' + e);
    throw e;
}

try {
    const UIComponents = require('./ui-components');
    var createPasswordDialog = UIComponents.createPasswordDialog;
    var createRssSearchDialog = UIComponents.createRssSearchDialog;
    var createFeedSelectionDialog = UIComponents.createFeedSelectionDialog;
} catch (e) {
    Logger.error('ui-components import failed: ' + e);
    throw e;
}

const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID] ? imports.ui.deskletManager.deskletMeta[UUID].path : null;

function _(str) {
    return Gettext.dgettext(UUID, str);
}

// Initialize debug setting
// Logger.setDebugEnabled(false); // REMOVED - this was setting debug to false before settings loaded

class YarrDesklet extends Desklet.Desklet {

    statusOk = false;

    delay = 300;

    refreshEnabled = true;

    httpSession = null;

    xmlutil = null;

    items = new Map();

    dataBox = null;	// Object holder for display
    headTitle = null;

    timerInProgress = 0;
    _setUpdateTimerInProgress = false; 	// Semaphore

    onUpdateDownloadedTick = -1;
    updateDownloadCounter = -1;
    updateDownloadedTimer = -1;


    clipboard = St.Clipboard.get_default();

    // Add new property for search
    searchFilter = '';

    // Add new property for favorite feature
    enableFavoriteFeature = true; // Default value

    // Add new property for favorite filtering
    showOnlyFavorites = false;

    // CRITICAL DEBUG: Track all changes to showOnlyFavorites
    get showOnlyFavorites() {
        return this._showOnlyFavorites || false;
    }

    set showOnlyFavorites(value) {
        const oldValue = this._showOnlyFavorites;
        this._showOnlyFavorites = value;
        if (oldValue !== value) {
            Logger.debug(`CRITICAL DEBUG: showOnlyFavorites changed from ${oldValue} to ${value}`, true);
            // Print stack trace to see where this is being set
            Logger.debug(`CRITICAL DEBUG: Stack trace:`, true);
            try {
                throw new Error('Stack trace for showOnlyFavorites change');
            } catch (e) {
                Logger.debug(`CRITICAL DEBUG: ${e.stack}`, true);
            }
        }
    }

    // Add resource monitoring
    _resourceUsage = {
        lastUpdate: 0,
        updateCount: 0,
        errorCount: 0
    };

    // Adaptive refresh rate
    _adaptiveRefresh = {
        minDelay: 300,  // 5 minutes
        maxDelay: 1800, // 30 minutes
        currentDelay: 300
    };

    // Add to class properties
    favoriteKeys = new Set();

    // Add new settings binding
    loadFavoritesOnStartup = true;

    // Add new settings binding
    articleSpacing = 0.2;

    lastRefresh = null;

    // Add memory monitoring capability
    _memoryMetrics = null;

    // Add refresh history tracking
    refreshHistory = [];

    // Add setting for showing refresh separators
    showRefreshSeparators = true;

    // Add setting for debug logs
    enableDebugLogs = false;
    debugVerbosity = 'minimal';

    // Add new property for read feature
    readArticleIds = new Set();
    // Read title styling
    dimReadTitles = true;
    readTitleColor = 'rgb(180,180,180)';

    // Add missing properties that are accessed by modules
    showReadStatusCheckbox = false;
    fontstyle = '';
    itemlimit = 50;
    refreshIcon = null;
    refreshButton = null;
    addArticleButton = null;
    mainBox = null;
    headerContainer = null;
    headBox = null;
    uiComponents = null;
    ModalDialog = null;

    constructor(metadata, desklet_id) {
        // Constructor flow: Initialize → Build UI → Install Handlers → Load Data → Start Feeds
        // This ensures handlers (RightMenu/Config) are available immediately

        // Call parent constructor FIRST
        super(metadata, desklet_id);

        // Store desklet_id for later use
        this._desklet_id = desklet_id;

        // Set initialization flag
        this._isInitializing = true;

        global.log("\n\n\n----------------------------------- YARR DESKLET INITIALIZING -----------------------------------------------");

        try {

            // translation init
            if (DESKLET_ROOT && !DESKLET_ROOT.startsWith("/usr/share/")) {
                Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");
            }

            // Initialize Secret schema for API key storage
            this.STORE_SCHEMA = new Secret.Schema("org.YarrDesklet.Schema", Secret.SchemaFlags.NONE, {});

            // Initialize basic properties
            this.refreshEnabled = true;
            this.delay = 300; // 5 minutes default
            this.items = new Map();
            this.favoriteKeys = new Set(); // Initialize the Set properly
            this.readArticleIds = new Set(); // Initialize read status Set

            // Initialize AI provider default
            this.ai_provider = 'openai';

            // Ensure Sets are properly initialized
            if (!(this.favoriteKeys instanceof Set)) {
                this.favoriteKeys = new Set();
            }
            if (!(this.readArticleIds instanceof Set)) {
                this.readArticleIds = new Set();
            }

            this._updateInProgress = false;
            this.timerInProgress = 0;
            this._setUpdateTimerInProgress = false;
            this._feedsInitialized = false;
            this._displayUpdateStartTime = null;

            // Initialize async managers
            this.timerManager = new TimerManager();
            this.uiUpdateManager = new UIUpdateManager();
            this.uiUpdateManager.setUpdateCallback(() => {
                if (this.uiDisplay && typeof this.uiDisplay.displayItems === 'function') {
                    this.uiDisplay.displayItems();
                }
            });
            // AsyncErrorHandler is available from logger module
            this.asyncCommandExecutor = AsyncCommandExecutor;

            // Initialize our new modular components
            this.feedProcessor = new FeedProcessor();
            this.uiDisplay = new UIDisplay(this);
            this.feedCollection = new FeedCollection(this);
            this.articleManagement = new ArticleManagement(this);
            this.aiManagers = new AIManagers(this);
            this.utilities = new Utilities();
            this.searchManagers = new SearchManagers(this);
            this.favoritesManagers = new FavoritesManagers(this);

            // Initialize uiComponents for use by other modules
            this.uiComponents = {
                createPasswordDialog: createPasswordDialog,
                createRssSearchDialog: createRssSearchDialog,
                createFeedSelectionDialog: createFeedSelectionDialog
            };

            // Initialize ModalDialog for use by other modules
            this.ModalDialog = ModalDialog;

            // Initialize St for use by other modules
            this.St = St;

            // Initialize Clutter for use by other modules
            this.Clutter = Clutter;

            // Initialize clipboard for use by other modules
            this.clipboard = St.Clipboard.get_default();

            // Initialize settings
            this.settings = new Settings.DeskletSettings(this, metadata.uuid, desklet_id);

            // Initialize HTTP session
            if (Soup.MAJOR_VERSION === 2) {
                this.httpSession = new Soup.SessionAsync();
                Soup.Session.prototype.add_feature.call(this.httpSession, new Soup.ProxyResolverDefault());
            } else {
                this.httpSession = new Soup.Session();
            }

            this.httpSession.timeout = 60
            this.httpSession.idle_timeout = 60;
            this.httpSession.user_agent = 'Mozilla/5.0 YarrDesklet/1.0';

            Logger.info(`HTTP session initialized: ${this.httpSession ? 'success' : 'failed'}`);
            if (this.httpSession) {
                Logger.info(`HTTP session timeout: ${this.httpSession.timeout}s, idle timeout: ${this.httpSession.idle_timeout}s`);
            }

            // Bind all settings
            this.settings.bind('refreshInterval-spinner', 'delay');
            this.settings.bind('feeds', 'feeds');
            Logger.debug(`Feeds setting bound, current value: ${this.feeds ? this.feeds.length : 'null'}`, false, 'basic');
            this.settings.bind("height", "height");
            this.settings.bind("width", "width");
            this.settings.bind("transparency", "transparency");
            this.settings.bind("alternateRowTransparency", "alternateRowTransparency");
            this.settings.bind("backgroundColor", "backgroundColor");
            this.settings.bind("font", "font");
            this.settings.bind("text-color", "color");
            this.settings.bind("numberofitems", "itemlimit");
            this.settings.bind("listfilter", "listfilter");
            this.settings.bind('enablecopy', 'enablecopy');

            this.settings.bind('ai_enablesummary', 'ai_enablesummary');
            this.settings.bind('ai_add_description_to_summary', 'ai_add_description_to_summary');
            this.settings.bind('ai_provider', 'ai_provider');
            this.settings.bind('ai_use_custom_url', 'ai_use_custom_url');
            this.settings.bind('ai_dumptool', 'ai_dumptool');
            this.settings.bind('ai_url', 'ai_url');
            this.settings.bind('ai_systemprompt', 'ai_systemprompt');
            this.settings.bind('ai_use_standard_model', 'ai_use_standard_model');
            this.settings.bind('ai_model', 'ai_model');
            this.settings.bind('ai_custom_model', 'ai_custom_model');
            this.settings.bind("ai_font", "ai_font");
            this.settings.bind("ai_text-color", "ai_color");
            this.settings.bind("temperature", "temperature");

            // Add new settings bindings
            this.settings.bind('enableFeedButton', 'enableFeedButton');
            this.settings.bind('enableTimestamp', 'enableTimestamp');
            this.settings.bind('enableFavoriteFeature', 'enableFavoriteFeature');
            this.settings.bind('loadFavoritesOnStartup', 'loadFavoritesOnStartup');
            this.settings.bind("articleSpacing", "articleSpacing");
            this.settings.bind("showRefreshSeparators", "showRefreshSeparators");
            this.settings.bind("enableDebugLogs", "enableDebugLogs");
            this.settings.bind("debugVerbosity", "debugVerbosity");
            this.settings.bind("databasePath", "databasePath");

            // Initialize database manager after settings are bound
            try {
                Logger.debug(`Settings bound, databasePath value: ${this.databasePath}`);
                Logger.debug(`Settings type: ${typeof this.databasePath}`);

                // Use database base directory setting for existing separate databases
                Logger.debug(`Database base directory: ${this.databasePath}`);
                Logger.debug(`Creating database manager to use existing separate databases in: ${this.databasePath}`);
                this.databaseManager = new DatabaseManagerClass(this.databasePath); // Base directory for existing DBs

                // Set desklet reference for cancellation support
                this.databaseManager.setDeskletReference(this);

                // Force update the database path in the manager if it was created with the old path
                if (this.databaseManager.databasePath !== this.databasePath) {
                    Logger.debug(`Updating database manager path from ${this.databaseManager.databasePath} to ${this.databasePath}`);
                    this.databaseManager.databasePath = this.databasePath;
                }

                // Initialize the database asynchronously but ensure it completes before proceeding
                Logger.debug('Initializing database manager...');
                this.databaseManager.initialize().then(() => {
                    Logger.debug('Database manager initialized successfully');

                    // Log all database paths after initialization
                    if (this.databaseManager.getExpandedDatabasePath) {
                        const actualPath = this.databaseManager.getExpandedDatabasePath();
                        Logger.debug(`Database will be saved to: ${actualPath}`);
                    }

                    // Check if there are multiple database configurations
                    Logger.debug(`Database manager state: initialized=${this.databaseManager.initialized}, hasDB=${!!this.databaseManager.db}, path=${this.databasePath}`);

                    // Log comprehensive database information
                    if (this.databaseManager.getDatabaseInfo) {
                        const dbInfo = this.databaseManager.getDatabaseInfo();
                        Logger.debug(`Database Info:`, dbInfo);
                    }

                    // Show database summary
                    if (this.databaseManager.logDatabaseSummary) {
                        this.databaseManager.logDatabaseSummary();
                    }

                    // Mark database as ready for operations
                    this._databaseReady = true;

                }).catch(error => {
                    Logger.error('Failed to initialize database manager: ' + error);
                    this._databaseReady = false;
                });

                // Log the actual database path being used
                if (this.databaseManager.getExpandedDatabasePath) {
                    const actualPath = this.databaseManager.getExpandedDatabasePath();
                    Logger.debug(`Database will be saved to: ${actualPath}`);
                }

                // Initialize database ready flag
                this._databaseReady = false;
            } catch (e) {
                Logger.error('Failed to create database manager: ' + e);
                throw e;
            }

            // Read-title styling bindings
            this.settings.bind('dimReadTitles', 'dimReadTitles');
            this.settings.bind('readTitleColor', 'readTitleColor');
            this.settings.bind('enableHeaderFeedButtons', 'enableHeaderFeedButtons');

            // Set global debug flag and verbosity
            Logger.setDebugEnabled(this.enableDebugLogs);
            Logger.setDebugVerbosity(this.debugVerbosity);


            // Defer logger configuration to ensure settings are fully loaded
            this.timerManager.addGLibTimer(100, () => {
                Logger.setDebugEnabled(this.enableDebugLogs);
                Logger.setDebugVerbosity(this.debugVerbosity);
                Logger.debug("Logger configured with settings: debug=" + this.enableDebugLogs + ", verbosity=" + this.debugVerbosity);
                return GLib.SOURCE_REMOVE;
            });

            // Log settings changes
            this.settings.connect("changed::enableDebugLogs", () => {
                Logger.setDebugEnabled(this.enableDebugLogs);
                Logger.debug("Debug logging " + (this.enableDebugLogs ? "enabled" : "disabled"));
            });

            // Log verbosity changes
            this.settings.connect("changed::debugVerbosity", () => {
                Logger.setDebugVerbosity(this.debugVerbosity);
                Logger.debug("Debug verbosity changed to: " + this.debugVerbosity);
            });

            // Header feed buttons setting change handler
            this.settings.connect("changed::enableHeaderFeedButtons", () => {
                Logger.info(`Header feed buttons setting changed to: ${this.enableHeaderFeedButtons}`);
                if (this.uiDisplay && this.uiDisplay.buildHeaderFeedButtons && !this._isInitializing) {
                    this.uiDisplay.buildHeaderFeedButtons();
                }
            });

            // Note: Display settings change handlers will be connected after UI is built
            // to avoid calling them during initialization

            // Add method to wait for database to be ready
            this.waitForDatabase = async () => {
                if (this._databaseReady) return true;

                // Wait up to 5 seconds for database to be ready
                for (let i = 0; i < 50; i++) {
                    if (this._databaseReady) return true;
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                Logger.error('Database failed to become ready within timeout');
                return false;
            };

            // Add feeds change handler
            this.settings.connect("changed::feeds", () => {
                Logger.info(`Feeds changed - new count: ${this.feeds ? this.feeds.length : 0}`);
                if (this.feeds && this.feeds.length > 0) {
                    this.feeds.forEach((feed, index) => {
                        // Initialize runtime display state if not already set
                        if (typeof feed.runtimeDisplayEnabled === 'undefined') {
                            feed.runtimeDisplayEnabled = true;
                        }
                        Logger.info(`Feed ${index}: ${feed.name} (${feed.url}) - Active: ${feed.active}, Runtime Display: ${feed.runtimeDisplayEnabled}`);
                    });

                    // Load saved button states from database
                    this.loadFeedButtonStates();

                    // Start timer if this is the first time feeds are loaded
                    if (!this._feedsInitialized) {
                        this._feedsInitialized = true;
                        Logger.info(`Feeds initialized for the first time, starting timer`);
                        this.feedCollection.setUpdateTimer(2);
                    }
                }

                // Update header feed buttons when feeds change (only when needed)
                if (this.uiDisplay && this.uiDisplay.buildHeaderFeedButtons && !this._isInitializing) {
                    this.uiDisplay.buildHeaderFeedButtons();
                }
            });

            // Initialize SignalManager
            this._signals = new SignalManager.SignalManager(null);

            // Initialize AsyncOperationManager for cancellation
            this.asyncOperationManager = new AsyncOperationManager();

            // Feeds are automatically loaded via settings binding
            Logger.info(`Feeds will be loaded via settings binding`);

            // Database manager already initialized above after settings binding
            Logger.debug('Database manager initialized:', this.databaseManager);
            Logger.debug('Database manager type:', typeof this.databaseManager);
            if (this.databaseManager) {
                Logger.debug('Database manager methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(this.databaseManager)));
            }

            Logger.debug('this.databaseManager assigned:', this.databaseManager);
            Logger.debug('this.databaseManager type:', typeof this.databaseManager);
            Logger.debug('this.databaseManager methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(this.databaseManager)));

            // Bind methods to ensure proper context
            if (this.databaseManager.saveAllFeedStates) {
                this.databaseManager.saveAllFeedStates = this.databaseManager.saveAllFeedStates.bind(this.databaseManager);
                Logger.debug('saveAllFeedStates method bound');
            }

            // Initialize favoriteKeys as empty Set - it will be populated by loadFavoriteArticles
            this.favoriteKeys = new Set();

            // Assign the fromXML function to the desklet instance
            this.fromXML = fromXML;

            // Initialize refresh history
            this.refreshHistory = []; // Will be populated in _initializeData

            // Load feed button states from database
            this.loadFeedButtonStates();

            // Load favorites if enabled (defer slightly to avoid blocking activation)
            if (this.loadFavoritesOnStartup) {
                GLib.timeout_add(GLib.PRIORITY_LOW, 1000, () => {
                    this.favoritesManagers.loadFavoriteArticles();

                    // Update header to show favorites loaded - only once
                    if (this.uiDisplay && this.uiDisplay.setSimpleHeaderTitle) {
                        const favoriteCount = this.favoriteKeys ? this.favoriteKeys.size : 0;
                        const feedCount = this.feeds ? this.feeds.filter(f => f?.active).length : 0;
                        this.uiDisplay.setSimpleHeaderTitle(`Yarr (${favoriteCount} favorites, ${feedCount} feeds)`);
                    }

                    // Refresh display to show loaded favorites
                    if (this.uiDisplay && this.uiDisplay.displayItems) {
                        this.safeDisplayUpdate('favorites loaded');
                    }

                    // CRITICAL FIX: Safety check - if no favorites loaded, ensure filter is OFF
                    if (this.favoriteKeys.size === 0) {
                        Logger.debug(`CRITICAL FIX: No favorites loaded, forcing favorites filter OFF`);
                        this._showOnlyFavorites = false;
                    }

                    // Save database after loading favorites
                    if (this.databaseManager && this.databaseManager.saveDatabase) {
                        this.databaseManager.saveDatabase();
                    }

                    return GLib.SOURCE_REMOVE;
                });
            }

            // Load cached AI responses after favorites are loaded
            GLib.timeout_add(GLib.PRIORITY_LOW, 2000, () => {
                this.loadCachedAIResponses();
                return GLib.SOURCE_REMOVE;
            });

            // Build UI first - this ensures the menu is available
            this.buildInitialDisplay();

            // UI is built, feeds will be loaded via settings binding

            // Initialize essential components once during construction
            this._initializeEssentialComponents();

            // Apply initial display settings after handlers are installed
            // Use a flag to indicate this is the initial call
            this._isInitializing = false;

            // PERFORMANCE FIX: Apply settings immediately to reduce system load
            this._applyInitialDisplaySettings();

            // Load feed button states after display settings are applied (with delay to ensure database is ready)
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                this.loadFeedButtonStates();
                return GLib.SOURCE_REMOVE;
            });

            // Initialize data asynchronously after a delay to ensure database is ready
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._initializeData();
                return GLib.SOURCE_REMOVE;
            });

            // Apply settings changes after essential components are initialized (this loads feeds)
            if (!this._essentialComponentsInitialized) {
                this.onSettingsChanged();
            }

            // Wait for feeds to be loaded before starting timer
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                // Start initial feed collection after feeds are loaded from settings
                Logger.debug(`Starting initial feed collection in 2 seconds`, false, 'basic');
                Logger.debug(`Current feeds: ${this.feeds ? this.feeds.length : 0} total, ${this.feeds ? this.feeds.filter(f => f?.active).length : 0} active`, false, 'basic');

                // Debug: Check if feeds are properly loaded
                if (this.feeds && this.feeds.length > 0) {
                    Logger.debug(`Feed details:`, false, 'basic');
                    this.feeds.forEach((feed, index) => {
                        Logger.debug(`  Feed ${index}: ${feed.name} - Active: ${feed.active} - URL: ${feed.url}`, false, 'basic');
                    });

                    // Set timer after feeds are loaded
                    this.feedCollection.setUpdateTimer(2);  // Start first update in 2 seconds
                } else {
                    Logger.debug(`No feeds found! This might be the issue.`, false, 'basic');
                    // Wait a bit longer for feeds to load, then try again
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                        if (this.feeds && this.feeds.length > 0) {
                            Logger.debug(`Feeds loaded after delay, starting timer now`, false, 'basic');
                            this.feedCollection.setUpdateTimer(2);
                        } else {
                            Logger.debug(`Still no feeds after delay, starting timer anyway`, false, 'basic');
                            this.feedCollection.setUpdateTimer(2);
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }

                return GLib.SOURCE_REMOVE;
            });

            // Add cleanup handler and store signal ID for proper cleanup
            this._destroySignalId = this.actor.connect('destroy', () => this._onDestroy());

            // CRITICAL FIX: Force favorites filter to OFF on every startup
            this._showOnlyFavorites = false;
            Logger.debug(`Forced favorites filter reset to OFF on startup: showOnlyFavorites = ${this.showOnlyFavorites}`);

            // Add periodic focus check to prevent background handler interception
            this._startPeriodicFocusCheck();



            this.settings.bind('showReadStatusCheckbox', 'showReadStatusCheckbox');

            // Load read status for last 3 months
            const threeMonthsAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
            this.readArticleIds = new Set(); // Will be loaded in _initializeData
            // Periodically clean up old records
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3600, () => {
                this.databaseManager.cleanupOldRecords();
                return GLib.SOURCE_REMOVE;
            });

            // Initialize essential components flag
            this._essentialComponentsInitialized = false;

            // Initialize display settings flag
            this._initialDisplaySettingsApplied = false;

            // Initialize suspend state flag
            this._isSuspended = false;
            this._resumeInProgress = false;
            this._lastFocusRestoration = 0;
            this._deferredDisplayUpdateScheduled = false;

            // Store click signal ID for reinitialization
            this._clickSignalId = null;
            // Signal ID for wake-up handler
            this._wakeUpSignalId = null;
            // Signal ID for destroy handler
            this._destroySignalId = null;
            // Only store critical signals that need special handling
            this._destroySignalId = null;
            this._wakeUpSignalId = null;

            // PERFORMANCE FIX: Removed complex reload fixes that were causing system lag
            if (global.YARR_IS_RELOADING) {
                delete global.YARR_IS_RELOADING;
            }

        } catch (e) {
            Logger.error('Constructor error: ' + e);
            throw e;
        }
    }

    on_desklet_added_to_desktop() {
        Logger.debug("Desklet added to desktop, connecting wake-up signal.", false, 'basic');

        // Desklet is ready for use

        // Try to connect the wake-up signal with a delay to ensure Main.screenShield is available
        GLib.timeout_add(GLib.PRIORITY_LOW, 1000, () => {
            this._connectWakeUpSignal();
            return GLib.SOURCE_REMOVE;
        });
    }

    _connectWakeUpSignal() {
        Logger.debug("Connecting to system suspend/resume signals...");

        // SIMPLIFIED: Use only essential wake-up detection to prevent Cinnamon conflicts
        // Multiple signal connections can cause system instability and black screens
        try {
            if (Main.screenShield) {
                this._wakeUpSignalId = Main.screenShield.connect('wake-up-screen', Lang.bind(this, this._onWakeUpScreen));
                Logger.info("Wake-up signal connected (simplified approach).");
            } else {
                Logger.debug("No wake-up signals available, using minimal fallback detection.");
                this._startFallbackWakeUpDetection();
            }
        } catch (e) {
            Logger.error("Error connecting wake-up signal: " + e);
            this._startFallbackWakeUpDetection();
        }
    }

    _startFallbackWakeUpDetection() {
        // Check every 5 minutes if the system has woken up (very low priority, minimal system impact)
        this._wakeUpCheckTimer = this.timerManager.addGLibTimer(300, () => {
            this._checkForWakeUp();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _checkForWakeUp() {
        // Simple wake-up detection based on time difference
        let now = Date.now();
        if (!this._lastWakeUpCheck) {
            this._lastWakeUpCheck = now;
            return;
        }

        // If more than 10 minutes have passed, assume the system was sleeping (very conservative)
        if (now - this._lastWakeUpCheck > 600000) {
            Logger.info("Detected potential wake-up event (fallback method)");
            this._onWakeUpScreen();
        }

        this._lastWakeUpCheck = now;
    }

    _applyInitialDisplaySettings() {
        try {
            Logger.info("Applying initial display settings...");

            // Update font styles
            if (this.font) {
                let fontprep = this.font.split(' ');
                let fontsize = fontprep.pop();
                let fontweight = '';
                let fontstyle = '';
                let fontname = fontprep.join(' ').replace(/,/g, ' ');
                ['Italic', 'Oblique'].forEach(function (item, i) {
                    if (fontname.includes(item)) {
                        fontstyle = item;
                        fontname = fontname.replace(item, '');
                    }
                });

                ['Bold', 'Light', 'Medium', 'Heavy'].forEach(function (item, i) {
                    if (fontname.includes(item)) {
                        fontweight = item;
                        fontname = fontname.replace(item, '');
                    }
                });

                this.fontstyle = ("font-family: " + fontname + "; " +
                    "font-size: " + fontsize + "pt; " +
                    (fontstyle ? "font-style: " + fontstyle + "; " : "") +
                    (fontweight ? "font-weight: " + fontweight + "; " : "") +
                    "color: " + this.color + "; " +
                    "text-shadow: " + "0px 1px 6px rgba(" + this.utilities.invertBrightness(this.color) + ", 0.2); " +
                    "padding: 2px 2px;").toLowerCase();
            }

            // Update AI font styles
            if (this.ai_font) {
                let ai_fontprep = this.ai_font.split(' ');
                let ai_fontsize = ai_fontprep.pop();
                let ai_fontweight = '';
                let ai_fontstyle = '';
                let ai_fontname = ai_fontprep.join(' ').replace(/,/g, ' ');
                ['Italic', 'Oblique'].forEach(function (item, i) {
                    if (ai_fontname.includes(item)) {
                        ai_fontstyle = item;
                        ai_fontname = ai_fontname.replace(item, '');
                    }
                });

                ['Bold', 'Light', 'Medium', 'Heavy'].forEach(function (item, i) {
                    if (ai_fontname.includes(item)) {
                        ai_fontweight = item;
                        ai_fontname = ai_fontname.replace(item, '');
                    }
                });

                this.ai_fontstyle = ("font-family: " + ai_fontname + "; " +
                    "font-size: " + ai_fontsize + "pt; " +
                    (ai_fontstyle ? "font-style: " + fontstyle + "; " : "") +
                    (ai_fontweight ? "font-weight: " + ai_fontweight + "; " : "") +
                    "color: " + this.ai_color + "; " +
                    "text-shadow: " + "0px 1px 6px rgba(" + this.utilities.invertBrightness(this.ai_color) + ", 0.2); " +
                    "padding: 2px 2px;").toLowerCase();
            }

            // Update main box size and style if it exists
            if (this.mainBox) {
                this.mainBox.set_size(this.width, this.height);

                if (this.backgroundColor && this.transparency !== undefined) {
                    this.mainBox.style = "background-color: rgba(" + this.backgroundColor.replace('rgb(', '').replace(')', '') + "," + this.transparency + ")";
                }
            }

            Logger.info("Initial display settings applied successfully");
            this._initialDisplaySettingsApplied = true;
        } catch (e) {
            Logger.error("Error applying initial display settings: " + e);
        }
    }

    _applyPostReloadFixes() {
        try {
            // Prevent duplicate execution within short time
            const now = Date.now();
            if (this._lastFocusRestoration && (now - this._lastFocusRestoration < 5000)) {
                Logger.info("Focus restoration executed recently, skipping to avoid contention");
                return;
            }
            this._lastFocusRestoration = now;

            Logger.info("Applying post-reload/wake-up fixes now.");
            if (this.actor) {
                // Minimal focus restoration to avoid system contention
                this.actor.set_reactive(true);
                this.actor.set_can_focus(true);
                this.actor.show();

                // REMOVED: Unnecessary queue_redraw that can cause system instability
                // Only show() is needed, queue_redraw() can conflict with Cinnamon's compositor

                // Minimal main container restoration
                if (this.mainBox) {
                    this.mainBox.set_reactive(true);
                    this.mainBox.set_can_focus(true);
                    this.mainBox.show();
                }

                // Restore scroll event handling for desklet components only
                this._restoreScrollEventHandling();

                Logger.info("Post-reload/wake-up fixes applied successfully (minimal impact)");
            } else {
                Logger.debug("Actor not found, cannot apply fixes.", true);
            }
        } catch (e) {
            Logger.error('Error applying fixes: ' + e);
        }
    }

    _restoreScrollEventHandling() {
        try {
            Logger.debug("Restoring scroll event handling for desklet components only...");

            // Only restore scroll handling for our specific scroll components
            if (this.uiDisplay && this.uiDisplay.desklet && this.uiDisplay.desklet.dataBox) {
                const scrollView = this.uiDisplay.desklet.dataBox.get_parent();
                if (scrollView && scrollView.set_reactive) {
                    scrollView.set_reactive(true);
                    scrollView.set_can_focus(true);
                    Logger.debug("Scroll view reactivity restored");
                }
            }

            // Restore main container scroll capability
            if (this.mainBox) {
                this.mainBox.set_reactive(true);
                this.mainBox.set_can_focus(true);
                Logger.debug("Main box scroll capability restored");
            }

            // Restore desklet actor scroll capability
            if (this.actor) {
                this.actor.set_reactive(true);
                this.actor.set_can_focus(true);
                Logger.debug("Desklet actor scroll capability restored");
            }

            Logger.info("Targeted scroll event handling restored successfully");
        } catch (e) {
            Logger.error('Error restoring scroll event handling: ' + e);
        }
    }

    _restoreDeskletFocus() {
        try {
            // Prevent duplicate execution within short time
            const now = Date.now();
            if (this._lastFocusRestoration && (now - this._lastFocusRestoration < 5000)) {
                Logger.debug("Focus restoration executed recently, skipping to avoid contention");
                return;
            }
            this._lastFocusRestoration = now;

            Logger.debug("Restoring desklet focus (targeted approach)...");

            if (!this.actor) {
                Logger.debug("Actor not available for focus restoration");
                return;
            }

            // TARGETED APPROACH: Only restore focus for desklet components
            // Avoid any global stage manipulation that can interfere with system events

            // Ensure actor is visible and reactive
            this.actor.set_reactive(true);
            this.actor.set_can_focus(true);
            this.actor.show();

            // Restore focus on main container
            if (this.mainBox) {
                this.mainBox.set_reactive(true);
                this.mainBox.set_can_focus(true);
                this.mainBox.show();
            }

            // Restore focus on scroll container specifically
            if (this.uiDisplay && this.uiDisplay.desklet && this.uiDisplay.desklet.dataBox) {
                const scrollView = this.uiDisplay.desklet.dataBox.get_parent();
                if (scrollView && scrollView.set_reactive) {
                    scrollView.set_reactive(true);
                    scrollView.set_can_focus(true);
                }
            }

            // Restore header container reactivity
            if (this.headerContainer) {
                this.headerContainer.set_reactive(true);
                this.headerContainer.set_can_focus(true);
            }

            Logger.info("Targeted focus restoration completed - no global interference");

        } catch (e) {
            Logger.error('Error in targeted focus restoration: ' + e);
        }
    }

    _startPeriodicFocusCheck() {
        try {
            Logger.info("Starting periodic focus check to prevent background handler interception");

            // Check focus every 15 minutes (minimal system impact to prevent Cinnamon conflicts)
            this._focusCheckTimer = this.timerManager.addGLibTimer(900, () => {
                // Only check if system appears stable and not busy
                if (this._isSystemStable() && !this._resumeInProgress && !this._isSuspended) {
                    this._checkAndRestoreFocus();
                } else {
                    Logger.debug("System appears busy, skipping focus check");
                }
                return GLib.SOURCE_CONTINUE;
            });

        } catch (e) {
            Logger.error('Error starting periodic focus check: ' + e);
        }
    }

    _isSystemStable() {
        try {
            // Comprehensive stability check
            if (this._isSuspended) {
                Logger.debug('System suspended, not stable');
                return false;
            }

            if (this._resumeInProgress) {
                Logger.debug('Resume in progress, not stable');
                return false;
            }

            // Check if we recently performed focus restoration
            if (this._lastFocusRestoration && (Date.now() - this._lastFocusRestoration < 3000)) {
                Logger.debug('Recent focus restoration, system may not be stable');
                return false;
            }

            return true;
        } catch (e) {
            Logger.debug('Error checking system stability: ' + e);
            return false; // Default to safe
        }
    }

    _isSystemStableForDisplay() {
        try {
            // Less restrictive checks for better responsiveness
            if (this._isSuspended || this._resumeInProgress) {
                Logger.debug('System suspended or resuming, not stable for display');
                return false;
            }

            // Check if display update has been in progress too long (stuck)
            if (this._isUpdatingDisplay && this._displayUpdateStartTime) {
                const elapsed = Date.now() - this._displayUpdateStartTime;
                if (elapsed > 3000) {
                    Logger.debug('Display update has been running too long, considering system unstable');
                    return false;
                }
            }

            // Check if UI components are ready
            if (!this.uiDisplay || !this.mainBox) {
                Logger.debug('UI components not ready, deferring display update');
                return false;
            }

            return true;
        } catch (e) {
            Logger.debug('Error checking display stability: ' + e);
            return false; // Default to safe
        }
    }

    _scheduleDeferredDisplayUpdate() {
        try {
            // Prevent multiple deferred updates
            if (this._deferredDisplayUpdateScheduled) {
                return;
            }

            this._deferredDisplayUpdateScheduled = true;

            // Schedule display update for when system is stable
            this.timerManager.addGLibTimer(2000, () => {
                this._deferredDisplayUpdateScheduled = false;

                if (this._isSystemStableForDisplay()) {
                    Logger.info("System now stable, performing deferred display update");
                    this._performDisplayUpdate();
                } else {
                    Logger.debug("System still not stable, rescheduling deferred update");
                    this._scheduleDeferredDisplayUpdate();
                }

                return GLib.SOURCE_REMOVE;
            });

        } catch (e) {
            Logger.error('Error scheduling deferred display update: ' + e);
            this._deferredDisplayUpdateScheduled = false;
        }
    }

    // Safe display update method for use by other modules
    safeDisplayUpdate(reason = 'unknown') {
        try {
            Logger.debug(`safeDisplayUpdate called with reason: ${reason}`);
            Logger.debug(`uiDisplay available: ${!!this.uiDisplay}`);
            Logger.debug(`uiDisplay.displayItems available: ${!!(this.uiDisplay && typeof this.uiDisplay.displayItems === 'function')}`);

            // PERFORMANCE FIX: Simplified to prevent system lag
            this._performDisplayUpdate();

            Logger.debug(`safeDisplayUpdate completed for reason: ${reason}`);
        } catch (e) {
            Logger.error(`Error in safe display update (${reason}): ` + e);
        }
    }

    // Internal method to perform the actual display update
    _performDisplayUpdate() {
        try {
            // Use UI update manager for batching if available
            if (this.uiUpdateManager && typeof this.uiUpdateManager.scheduleUpdate === 'function') {
                this.uiUpdateManager.scheduleUpdate();
            } else {
                // Fallback: direct update with error handling
                if (this.uiDisplay && typeof this.uiDisplay.displayItems === 'function') {
                    this.uiDisplay.displayItems();
                } else {
                    Logger.error("UI display not available for display update");
                }
            }
        } catch (e) {
            Logger.error('Error in _performDisplayUpdate: ' + e);
            // Clear flag on error to prevent getting stuck
            this._isUpdatingDisplay = false;
            this._displayUpdateStartTime = null;
        }
    }

    _checkAndRestoreFocus() {
        try {
            if (!this.actor || (typeof this.actor.isDestroyed === 'function' && this.actor.isDestroyed())) {
                return;
            }

            // Check if focus restoration is already in progress
            if (this._lastFocusRestoration && (Date.now() - this._lastFocusRestoration < 5000)) {
                Logger.debug("Focus restoration recently performed, skipping check");
                return;
            }

            let focusRestorationNeeded = false;

            // Check if the actor is still reactive and can focus
            if (!this.actor.reactive || !this.actor.can_focus) {
                Logger.debug("Detected actor focus loss");
                focusRestorationNeeded = true;
            }

            // Check if mainBox is still reactive
            if (this.mainBox && (!this.mainBox.reactive || !this.mainBox.can_focus)) {
                Logger.debug("Detected main box focus loss");
                focusRestorationNeeded = true;
            }

            // Check scroll container reactivity
            if (this.uiDisplay && this.uiDisplay.desklet && this.uiDisplay.desklet.dataBox) {
                const scrollView = this.uiDisplay.desklet.dataBox.get_parent();
                if (scrollView && scrollView.set_reactive && (!scrollView.reactive || !scrollView.can_focus)) {
                    Logger.debug("Detected scroll view focus loss");
                    focusRestorationNeeded = true;
                }
            }

            // Only restore focus if needed - targeted approach only
            if (focusRestorationNeeded) {
                Logger.debug("Targeted focus restoration needed, applying fix...");
                this._restoreDeskletFocus();
            }

        } catch (e) {
            Logger.debug('Error in focus check: ' + e);
        }
    }

    _onSystemSuspend() {
        // SIMPLIFIED: Minimal suspend handling to prevent system conflicts
        Logger.debug("System is suspending (minimal handling)...", false, 'basic');
        this._isSuspended = true;
    }

    _simpleResumeProcess() {
        try {
            Logger.info("Starting simple resume process...");

            // Prevent duplicate execution
            if (this._resumeInProgress) {
                Logger.info("Resume process already in progress, skipping");
                return;
            }

            // Mark resume in progress to prevent interference
            this._resumeInProgress = true;

            // Single timeout: resume operations and restore focus after system settles
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                // Check if system got suspended again during the wait
                if (this._isSuspended) {
                    Logger.info("System suspended again during resume wait, aborting resume process");
                    this._resumeInProgress = false;
                    return GLib.SOURCE_REMOVE;
                }

                this._resumeDeskletOperations();
                this._applyPostReloadFixes();
                this._resumeInProgress = false;
                return GLib.SOURCE_REMOVE;
            });

        } catch (e) {
            Logger.error('Error starting resume process: ' + e);
            this._resumeInProgress = false;
        }
    }

    _resumeDeskletOperations() {
        try {
            Logger.info("Resuming desklet operations after system resume...");

            // Validate state before proceeding
            if (this._isSuspended) {
                Logger.info("System still suspended, skipping resume operations");
                return;
            }

            // Resume timer operations only if they were actually paused
            if (this.timerManager && typeof this.timerManager.resume === 'function') {
                try {
                    // Check if timers were actually paused before resuming
                    if (this.timerManager.isPaused && typeof this.timerManager.isPaused === 'function') {
                        if (this.timerManager.isPaused()) {
                            this.timerManager.resume();
                            Logger.info("Timer operations resumed");
                        } else {
                            Logger.info("Timers were not paused, skipping resume");
                        }
                    } else {
                        // Fallback: assume timers need resuming if method not available
                        this.timerManager.resume();
                        Logger.info("Timer operations resumed (fallback)");
                    }
                } catch (e) {
                    Logger.error('Error resuming timer operations: ' + e);
                }
            }

            // Refresh display to ensure it reflects current state
            if (this.displayItems) {
                this.safeDisplayUpdate('settings refresh');
            }

            // Reload feed button states
            if (this.feeds && this.feeds.length > 0) {
                this.loadFeedButtonStates();
            }

            // Ensure scroll events are restored after resume
            this._restoreScrollEventHandling();

            Logger.info("Desklet operations resumed successfully");
        } catch (e) {
            Logger.error('Error resuming desklet operations: ' + e);
        }
    }



    _onSystemResume() {
        // SIMPLIFIED: Minimal resume handling to prevent system conflicts
        Logger.debug("System is resuming (minimal handling)...", false, 'basic');
        this._isSuspended = false;
        this._resumeInProgress = false;
    }

    _onWakeUpScreen() {
        // SIMPLIFIED: Minimal wake-up handling to prevent system conflicts
        Logger.debug("Screen is waking up (minimal handling)...", false, 'basic');

        // Only run if system resume hasn't already handled this
        if (this._resumeInProgress || this._isSuspended) {
            Logger.info("System resume already handling wake-up, skipping duplicate logic");
            return;
        }

        // Single minimal timeout to avoid aggressive system manipulation
        GLib.timeout_add(GLib.PRIORITY_LOW, 5000, () => {
            // Just ensure basic visibility without aggressive focus restoration
            if (this.actor) {
                this.actor.show();
            }
            if (this.mainBox) {
                this.mainBox.show();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    async _initializeData() {
        try {
            Logger.info('Initializing data asynchronously...');

            // Wait for database to be ready
            if (!(await this.waitForDatabase())) {
                Logger.error('Database not ready for _initializeData');
                return;
            }

            // Load refresh history
            this.refreshHistory = await this.databaseManager.getRefreshHistory();
            Logger.debug(`Loaded ${this.refreshHistory.length} refresh events`);
            Logger.debug(` refreshHistory type: ${typeof this.refreshHistory}, isArray: ${Array.isArray(this.refreshHistory)}`);
            if (this.refreshHistory.length > 0) {
                Logger.debug(` First refresh event: ${JSON.stringify(this.refreshHistory[0])}`);
            }

            // Load favorites key set early for correct favorite marking
            try {
                const favArray = await this.databaseManager.getFavorites();
                if (favArray && Array.isArray(favArray)) {
                    // Convert array of favorite objects to Set of links
                    this.favoriteKeys = new Set(favArray.map(fav => fav.link).filter(link => link));
                    Logger.debug(`Loaded favoriteKeys: ${this.favoriteKeys.size}`,);
                } else {
                    this.favoriteKeys = new Set();
                    Logger.debug('No favorites found or invalid format, initialized empty Set');
                }
            } catch (e) {
                Logger.error('Error loading favorite keys: ' + e);
                this.favoriteKeys = new Set();
            }

            // Load read status for last 3 months
            const threeMonthsAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
            const readIdsArray = await this.databaseManager.getReadIds();
            this.readArticleIds = new Set(readIdsArray);
            Logger.debug(`Loaded ${this.readArticleIds.size} read article IDs`,);

            // Save database after loading read status
            if (this.databaseManager && this.databaseManager.saveDatabase) {
                this.databaseManager.saveDatabase();
            }

            // Refresh display to show loaded data (batch to avoid many rapid calls)
            if (this.uiUpdateManager) {
                this.uiUpdateManager.scheduleUpdate();
            } else {
                this.safeDisplayUpdate('data loaded');
            }

            // Update header to show loaded data
            if (this.uiDisplay && this.uiDisplay.setSimpleHeaderTitle) {
                const totalArticles = this.items.size;
                const feedCount = this.feeds ? this.feeds.filter(f => f?.active).length : 0;
                this.uiDisplay.setSimpleHeaderTitle(`Yarr (${totalArticles} articles, ${feedCount} feeds)`);
            }

            // Build header feed buttons once after data is initialized
            if (this.uiDisplay && this.uiDisplay.buildHeaderFeedButtons) {
                this.uiDisplay.buildHeaderFeedButtons();
            }

            // Load feed button states after data is initialized
            this.loadFeedButtonStates();

        } catch (e) {
            Logger.error('Error initializing data: ' + e);
        }
    }

    _formatTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;

        if (diff < 0) {
            return 'in the future';
        }

        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        const months = Math.floor(days / 30);
        const years = Math.floor(months / 12);

        if (seconds < 60) {
            return `${seconds} second${seconds > 1 ? 's' : ''} ago`;
        } else if (minutes < 60) {
            return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        } else if (hours < 24) {
            return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        } else if (days < 30) {
            return `${days} day${days > 1 ? 's' : ''} ago`;
        } else if (months < 12) {
            return `${months} month${months > 1 ? 's' : ''} ago`;
        } else {
            return `${years} year${years > 1 ? 's' : ''} ago`;
        }
    }

    _onDestroy() {
        try {
            Logger.debug('Cleaning up desklet resources...');

            // Clear all timers using enhanced timer manager
            if (this.timerManager && typeof this.timerManager.cleanup === 'function') {
                try {
                    this.timerManager.cleanup();
                    Logger.debug('Timer manager cleanup completed');
                } catch (e) {
                    Logger.error('Error in timer manager cleanup: ' + e);
                }
            }

            // Clear legacy timers for backward compatibility
            if (this.timerInProgress && this.timerInProgress > 0) {
                try {
                    Mainloop.source_remove(this.timerInProgress);
                    this.timerInProgress = 0;
                } catch (e) {
                    Logger.error('Error removing timerInProgress: ' + e);
                }
            }
            if (this.updateDownloadedTimer && this.updateDownloadedTimer > 0) {
                try {
                    Mainloop.source_remove(this.updateDownloadedTimer);
                    this.updateDownloadedTimer = 0;
                } catch (e) {
                    Logger.error('Error removing updateDownloadedTimer: ' + e);
                }
            }

            // Disconnect all signal handlers to prevent memory leaks
            this._signals.disconnectAllSignals();

            // Disconnect wake-up signal
            if (this._wakeUpSignalId && Main.screenShield) {
                try {
                    Main.screenShield.disconnect(this._wakeUpSignalId);
                    this._wakeUpSignalId = null;
                } catch (e) {
                    Logger.error('Error disconnecting wake-up signal: ' + e);
                }
            }

            // Disconnect session signals
            if (this._suspendSignalId && Main.session) {
                try {
                    Main.session.disconnect(this._suspendSignalId);
                    this._suspendSignalId = null;
                } catch (e) {
                    Logger.error('Error disconnecting suspend signal: ' + e);
                }
            }

            if (this._resumeSignalId && Main.session) {
                try {
                    Main.session.disconnect(this._resumeSignalId);
                    this._resumeSignalId = null;
                } catch (e) {
                    Logger.error('Error disconnecting resume signal: ' + e);
                }
            }

            // Disconnect actor signals
            if (this.actor && typeof this.actor.isDestroyed === 'function' && !this.actor.isDestroyed()) {
                try {
                    // Disconnect destroy signal
                    if (this._destroySignalId) {
                        this.actor.disconnect(this._destroySignalId);
                        this._destroySignalId = null;
                    }
                } catch (e) {
                    Logger.error('Error disconnecting actor signals: ' + e);
                }
            }

            // Disconnect all settings signals (handled by SignalManager)
            // The _signals.disconnectAllSignals() call above handles most signals

            // Clean up database manager to prevent zombie processes
            if (this.databaseManager && typeof this.databaseManager.cleanup === 'function') {
                try {
                    this.databaseManager.cleanup();
                } catch (e) {
                    Logger.error('Error cleaning up database manager: ' + e);
                }
            }



            // Clean up async operations first to prevent modification of destroyed objects
            if (this.asyncOperationManager && typeof this.asyncOperationManager.cleanup === 'function') {
                try {
                    this.asyncOperationManager.cleanup();
                    Logger.debug('Async operation manager cleanup completed');
                } catch (e) {
                    Logger.error('Error cleaning up async operation manager: ' + e);
                }
            }

            // Clean up timer and UI update managers
            if (this.timerManager && typeof this.timerManager.cleanup === 'function') {
                try {
                    this.timerManager.cleanup();
                } catch (e) {
                    Logger.error('Error cleaning up timer manager: ' + e);
                }
            }
            if (this.uiUpdateManager && typeof this.uiUpdateManager.cleanup === 'function') {
                try {
                    this.uiUpdateManager.cleanup();
                } catch (e) {
                    Logger.error('Error cleaning up UI update manager: ' + e);
                }
            }

            // Clean up UI display module
            if (this.uiDisplay && typeof this.uiDisplay.cleanup === 'function') {
                try {
                    this.uiDisplay.cleanup();
                } catch (e) {
                    Logger.error('Error cleaning up UI display: ' + e);
                }
            }

            // Clear items map
            this.items.clear();

            // Clean up menu
            if (this._menu) {
                this._menu.destroy();
            }

            // Reset essential components flag only if we're actually recreating the menu
            if (this._menu && this._menu.isDestroyed()) {
                this._essentialComponentsInitialized = false;
            }

            // Save feed button states before destroying
            if (this.saveFeedButtonStates) {
                this.saveFeedButtonStates();
            }

            // Clear HTTP session
            if (this.httpSession) {
                this.httpSession.abort();
                this.httpSession = null;
            }

            // Clear global state to prevent interference with new instances
            if (global.YARR_IS_RELOADING) {
                delete global.YARR_IS_RELOADING;
            }

            // Clean up essential components
            this._cleanupEssentialComponents();

            // Reset all flags

            this._isInitializing = false;
            this._isUpdatingDisplay = false;
            this._displayUpdateStartTime = null;
            this._deferredDisplayUpdateScheduled = false;

            Logger.debug('Desklet cleanup completed successfully');

        } catch (e) {
            Logger.error('Error in _onDestroy: ' + e);
        }
    }

    // invertbrightness is now handled by Utilities module

    openChatGPTAPIKeys() {
        Gio.app_info_launch_default_for_uri("https://platform.openai.com/api-keys", global.create_app_launch_context());
    }

    openChatGPTUsage() {
        Util.spawnCommandLine('xdg-open https://platform.openai.com/usage');
    }



    onSettingsChanged() {
        // Only set timer if feeds are loaded and we're not in initialization
        if (this.feeds && this.feeds.length > 0 && !this._isInitializing) {
            Logger.debug(`Settings changed, setting update timer for ${this.feeds.length} feeds`, false, 'basic');
            this.feedCollection.setUpdateTimer(1);
        } else {
            Logger.debug(`Settings changed but feeds not ready yet (feeds: ${this.feeds ? this.feeds.length : 'null'}, initializing: ${this._isInitializing})`, false, 'basic');
        }


    }

    onDisplayChanged() {
        try {
            // PERFORMANCE FIX: Simplified to prevent system lag
            if (this._isInitializing || this._isUpdatingDisplay) {
                return;
            }
            this._isUpdatingDisplay = true;

            // Update font styles
            if (this.font) {
                let fontprep = this.font.split(' ');
                let fontsize = fontprep.pop();
                let fontweight = '';
                let fontstyle = '';
                let fontname = fontprep.join(' ').replace(/,/g, ' ');
                ['Italic', 'Oblique'].forEach(function (item, i) {
                    if (fontname.includes(item)) {
                        fontstyle = item;
                        fontname = fontname.replace(item, '');
                    }
                });

                ['Bold', 'Light', 'Medium', 'Heavy'].forEach(function (item, i) {
                    if (fontname.includes(item)) {
                        fontweight = item;
                        fontname = fontname.replace(item, '');
                    }
                });

                this.fontstyle = ("font-family: " + fontname + "; " +
                    "font-size: " + fontsize + "pt; " +
                    (fontstyle ? "font-style: " + fontstyle + "; " : "") +
                    (fontweight ? "font-weight: " + fontweight + "; " : "") +
                    "color: " + this.color + "; " +
                    "text-shadow: " + "0px 1px 6px rgba(" + this.utilities.invertBrightness(this.color) + ", 0.2); " +
                    "padding: 2px 2px;").toLowerCase();
            }

            // Update AI font styles
            if (this.ai_font) {
                let ai_fontprep = this.ai_font.split(' ');
                let ai_fontsize = ai_fontprep.pop();
                let ai_fontweight = '';
                let ai_fontstyle = '';
                let ai_fontname = ai_fontprep.join(' ').replace(/,/g, ' ');
                ['Italic', 'Oblique'].forEach(function (item, i) {
                    if (ai_fontname.includes(item)) {
                        ai_fontstyle = item;
                        ai_fontname = ai_fontname.replace(item, '');
                    }
                });

                ['Bold', 'Light', 'Medium', 'Heavy'].forEach(function (item, i) {
                    if (ai_fontname.includes(item)) {
                        ai_fontweight = item;
                        ai_fontname = ai_fontname.replace(item, '');
                    }
                });

                this.ai_fontstyle = ("font-family: " + ai_fontname + "; " +
                    "font-size: " + ai_fontsize + "pt; " +
                    (ai_fontstyle ? "font-style: " + fontstyle + "; " : "") +
                    (ai_fontweight ? "font-weight: " + ai_fontweight + "; " : "") +
                    "color: " + this.ai_color + "; " +
                    "text-shadow: " + "0px 1px 6px rgba(" + this.utilities.invertBrightness(this.ai_color) + ", 0.2); " +
                    "padding: 2px 2px;").toLowerCase();
            }

            // Update main box size and style if it exists
            if (this.mainBox) {
                this.mainBox.set_size(this.width, this.height);

                if (this.backgroundColor && this.transparency !== undefined) {
                    this.mainBox.style = "background-color: rgba(" + this.backgroundColor.replace('rgb(', '').replace(')', '') + "," + this.transparency + ")";
                }
            }



            Logger.debug("Display settings updated successfully");
        } catch (e) {
            Logger.error("Error updating display settings: " + e);
        } finally {
            // Reset the updating flag
            this._isUpdatingDisplay = false;
        }
    }

    onClickedToggleRefresh(selfObj, p2, context) {

        if (context.refreshEnabled) {
            context.toggleRefresh.set_label(_('Enable refresh'));
            context.toggleRefresh.set_style_class_name('toggleButtonOff');
            context.refreshEnabled = false;
        } else {
            context.toggleRefresh.set_label(_('Disable refresh'));
            context.toggleRefresh.set_style_class_name('toggleButtonOn');
            context.refreshEnabled = true;
            context.feedCollection.setUpdateTimer(3);
        }
    }

    buildInitialDisplay() {
        // Delegate to UI display module
        this.uiDisplay.buildInitialDisplay();



        // Now that UI is built, connect display settings change handlers
        this._connectDisplaySettingsHandlers();

        // Apply initial display settings after UI is built to ensure proper styling
        this._applyInitialDisplaySettings();
    }

    _connectDisplaySettingsHandlers() {
        try {
            Logger.debug("Connecting display settings change handlers");

            // Connect display settings change handlers
            this.settings.connect("changed::width", () => {
                Logger.debug("Width changed to: " + this.width);
                if (this.mainBox && this.uiDisplay && !this._isInitializing && this._initialDisplaySettingsApplied) {
                    this.onDisplayChanged();
                }
            });

            this.settings.connect("changed::height", () => {
                Logger.debug("Height changed to: " + this.height);
                if (this.mainBox && this.uiDisplay && !this._isInitializing && this._initialDisplaySettingsApplied) {
                    this.onDisplayChanged();
                }
            });

            this.settings.connect("changed::backgroundColor", () => {
                Logger.debug("Background color changed to: " + this.backgroundColor);
                if (this.mainBox && this.uiDisplay && !this._isInitializing && this._initialDisplaySettingsApplied) {
                    this.onDisplayChanged();
                }
            });

            this.settings.connect("changed::transparency", () => {
                Logger.debug("Transparency changed to: " + this.transparency);
                if (this.mainBox && this.uiDisplay && !this._isInitializing && this._initialDisplaySettingsApplied) {
                    this.onDisplayChanged();
                }
            });

            this.settings.connect("changed::alternateRowTransparency", () => {
                Logger.debug("Alternate row transparency changed to: " + this.alternateRowTransparency);
                if (this.mainBox && this.uiDisplay && !this._isInitializing && this._initialDisplaySettingsApplied) {
                    this.onDisplayChanged();
                }
            });

            this.settings.connect("changed::font", () => {
                Logger.debug("Font changed to: " + this.font);
                if (this.mainBox && this.uiDisplay && !this._isInitializing && this._initialDisplaySettingsApplied) {
                    this.onDisplayChanged();
                }
            });

            this.settings.connect("changed::text-color", () => {
                Logger.debug("Text color changed to: " + this.color);
                if (this.mainBox && this.uiDisplay && !this._isInitializing && this._initialDisplaySettingsApplied) {
                    this.onDisplayChanged();
                }
            });

            this.settings.connect("changed::ai_font", () => {
                Logger.debug("AI font changed to: " + this.ai_font);
                if (this.mainBox && this.uiDisplay && !this._isInitializing) {
                    this.onDisplayChanged();
                }
            });

            this.settings.connect("changed::ai_text-color", () => {
                Logger.debug("AI text color changed to: " + this.ai_color);
                if (this.mainBox && this.uiDisplay && !this._isInitializing) {
                    this.onDisplayChanged();
                }
            });

            this.settings.connect("changed::articleSpacing", () => {
                Logger.debug("Article spacing changed to: " + this.articleSpacing);
                if (this.mainBox && this.uiDisplay && !this._isInitializing) {
                    this.onDisplayChanged();
                }
            });

            this.settings.connect("changed::dimReadTitles", () => {
                Logger.debug("Dim read titles changed to: " + this.dimReadTitles);
                if (this.mainBox && this.uiDisplay && !this._isInitializing) {
                    this.onDisplayChanged();
                }
            });

            this.settings.connect("changed::readTitleColor", () => {
                Logger.debug("Read title color changed to: " + this.readTitleColor);
                if (this.mainBox && this.uiDisplay && !this._isInitializing) {
                    this.onDisplayChanged();
                }
            });

            // Add more settings change handlers
            this.settings.connect("changed::enableFavoriteFeature", () => {
                Logger.debug("Favorite feature " + (this.enableFavoriteFeature ? "enabled" : "disabled"));
                if (this.mainBox && this.uiDisplay && !this._isInitializing) {
                    this.onDisplayChanged();
                }
            });

            this.settings.connect("changed::showReadStatusCheckbox", () => {
                Logger.debug("Read status checkbox " + (this.showReadStatusCheckbox ? "enabled" : "disabled"));
                if (this.mainBox && this.uiDisplay && !this._isInitializing) {
                    this.onDisplayChanged();
                }
            });

            this.settings.connect("changed::showRefreshSeparators", () => {
                Logger.debug("Refresh separators " + (this.showRefreshSeparators ? "enabled" : "disabled"));
                if (this.mainBox && this.uiDisplay && !this._isInitializing) {
                    this.onDisplayChanged();
                }
            });

            this.settings.connect("changed::numberofitems", () => {
                Logger.debug("Number of items changed to: " + this.itemlimit);
                if (this.mainBox && this.uiDisplay && !this._isInitializing) {
                    this.onDisplayChanged();
                }
            });

            Logger.debug("Display settings change handlers connected successfully");
        } catch (e) {
            Logger.error("Error connecting display settings handlers: " + e);
        }
    }


    additems(context, itemobj) {
        try {
            // Generate unique key using the same strategy as feed processing
            const key = this.utilities.simpleHash(itemobj.link);

            // Check if item already exists to preserve favorite status
            const existingItem = context.items.get(key);
            const isFavorite = existingItem ? existingItem.isFavorite : false;

            // Add new item to map with isFavorite property first
            context.items.set(key, {
                ...itemobj,  // spread operator to clone
                key: key,    // store key for later use
                isFavorite: isFavorite,  // preserve existing favorite status or default to false
                downloadTimestamp: Date.now(), // when this article was downloaded
                aiResponse: existingItem?.aiResponse || '' // preserve existing AI response or start empty
            });

            // Now check for cached article data to save costs (async)
            if (itemobj.link && this.databaseManager && !existingItem?.aiResponse) {
                this.databaseManager.getArticleFromCache(key).then(cachedArticle => {
                    if (cachedArticle && cachedArticle.aiResponse) {
                        Logger.info(`Found cached article data for: ${itemobj.title || 'Untitled'} (saving API costs)`);

                        // Update the item with all cached data
                        const currentItem = context.items.get(key);
                        if (currentItem) {
                            // Restore all cached attributes
                            currentItem.title = cachedArticle.title || currentItem.title;
                            currentItem.description = cachedArticle.description || currentItem.description;
                            currentItem.category = cachedArticle.category || currentItem.category;
                            currentItem.channel = cachedArticle.channel || currentItem.channel;
                            currentItem.labelColor = cachedArticle.labelColor || currentItem.labelColor;
                            currentItem.pubDate = cachedArticle.pubDate || currentItem.pubDate;
                            currentItem.timestamp = cachedArticle.timestamp || currentItem.timestamp;
                            currentItem.aiResponse = cachedArticle.aiResponse;

                            // Trigger display update to show cached data
                            this.timerManager.addSetTimeoutTimer(() => {
                                this.safeDisplayUpdate('cached article data loaded');
                            }, 1);
                        }
                    } else {
                        // Cache this article data for future use (even without AI response)
                        this.databaseManager.cacheArticleData(key, itemobj.link, {
                            title: itemobj.title || '',
                            description: itemobj.description || '',
                            category: itemobj.category || '',
                            channel: itemobj.channel || '',
                            labelColor: itemobj.labelColor || '#ffffff',
                            pubDate: itemobj.pubDate || '',
                            timestamp: itemobj.timestamp || Date.now()
                        }).catch(e => {
                            Logger.error('Error caching article data: ' + e);
                        });
                    }
                }).catch(e => {
                    Logger.error('Error checking article cache: ' + e);
                });
            }

            // Schedule display update using Promise to avoid UI blocking
            Promise.resolve().then(() => {
                // Limit size and clean old elements if needed
                if (context.items.size > context.itemlimit) {
                    const sortedItems = Array.from(context.items.entries())
                        .sort((a, b) => b[1].timestamp - a[1].timestamp);

                    // Keep only the newest items
                    context.items = new Map(sortedItems.slice(0, context.itemlimit));
                }

                // Schedule UI update asynchronously to prevent blocking
                this.timerManager.addSetTimeoutTimer(() => {
                    this.safeDisplayUpdate('new articles added');
                }, 1);
            }).catch(e => {
                Logger.error('Error in additems:', e);
            });

        } catch (e) {
            Logger.error('Error in additems:', e);
        }
    }

    // _checkMatch and inGlobalFilter are now handled by ArticleManagement module

    // Expose inGlobalFilter function for use by other modules
    inGlobalFilter(self, title, category, description) {
        return this.articleManagement.inGlobalFilter(self, title, category, description);
    }

    // Expose _simpleHash function for use by other modules
    _simpleHash(str) {
        return this.utilities.simpleHash(str);
    }

    // Expose _markItemAsRead function for use by other modules
    _markItemAsRead(item, showReadStatusCheckbox, titleLabel) {
        return this.favoritesManagers._markItemAsRead(item, showReadStatusCheckbox, titleLabel);
    }

    // Expose other functions for use by other modules
    _showAddArticleDialog() {
        return this.articleManagement._showAddArticleDialog();
    }

    onRefreshClicked() {
        return this.feedCollection.onRefreshClicked();
    }



    _toggleReadStatus(item, readIcon, titleLabel) {
        return this.favoritesManagers._toggleReadStatus(item, readIcon, titleLabel);
    }

    summarizeUri(dumptool, item, lineBox, sumIcon) {
        return this.aiManagers.summarizeUri(dumptool, item, lineBox, sumIcon);
    }

    onClickedCopyButton(selfObj, p2, item, lineBox) {
        return this.articleManagement.onClickedCopyButton(selfObj, p2, item, lineBox);
    }

    HTMLPartToTextPart(html) {
        return this.feedProcessor.HTMLPartToTextPart(html);
    }

    // Expose translation function for use by other modules
    _(str) {
        return Gettext.dgettext(UUID, str);
    }

    // Expose onRefreshSettings function for use by other modules
    onRefreshSettings() {
        try {
            Logger.debug("onRefreshSettings called - refreshing settings and updating display");

            // Reload settings and update display
            if (this.settings && typeof this.settings.reload === 'function') {
                this.settings.reload();
                Logger.debug("Settings reloaded successfully");
            } else if (this.settings) {
                Logger.debug("Settings object exists but reload method not available, skipping reload");
            } else {
                Logger.error("Settings object not available");
                return;
            }

            // Only update display if UI is ready and not initializing
            if (this.mainBox && this.uiDisplay && !this._isInitializing) {
                this.onDisplayChanged();
                this.onSettingsChanged();
                // Don't call displayItems here as it might interfere with normal operation
                Logger.debug("Display updated successfully");
            } else {
                Logger.debug("UI not ready or still initializing, skipping display update");
            }

            Logger.debug("Settings refresh completed successfully");
        } catch (e) {
            Logger.error("Error in onRefreshSettings: " + e);
        }
    }

    // Expose tooltip functions for use by other modules
    showTooltip(item) {
        if (this.uiDisplay && this.uiDisplay._showTooltip) {
            // Find the panel button for this item and show tooltip
            // This is a simplified version - in practice, you'd need to find the actual button
            this.uiDisplay._showTooltip(null, item);
        }
    }

    hideTooltip() {
        if (this.uiDisplay && this.uiDisplay._hideTooltip) {
            this.uiDisplay._hideTooltip();
        }
    }

    isTooltipVisible() {
        return this.uiDisplay && this.uiDisplay.isTooltipVisible ? this.uiDisplay.isTooltipVisible() : false;
    }

    // Expose _onRssSearchResult function for use by other modules
    _onRssSearchResult(result) {
        return this.searchManagers._onRssSearchResult(result);
    }

    // Expose _onFeedSelectionResult function for use by other modules
    _onFeedSelectionResult(result) {
        return this.searchManagers._onFeedSelectionResult(result);
    }

    onUpdateDownloadedTimer() {
        this.onUpdateDownloadedTick++;

        if (this.updateDownloadCounter < 1 || this.onUpdateDownloadedTick > 10) {
            if (this.updateDownloadedTimer) {
                Mainloop.source_remove(this.updateDownloadedTimer);
                this.updateDownloadedTimer = null;
            }
            this.displayItems(this);
            if (this.refreshIcon) {
                this.refreshIcon.set_icon_name('reload');
            }
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    }



    displayItems() {
        try {
            // PERFORMANCE FIX: Simplified to prevent system lag

            // Basic concurrent update prevention
            if (this._isUpdatingDisplay) {
                return;
            }

            this._isUpdatingDisplay = true;

            // Use the internal display method
            this._performDisplayUpdate();

            // Reset flag immediately after successful update
            this._isUpdatingDisplay = false;

        } catch (e) {
            Logger.error('Error in displayItems: ' + e);
            // Always clear flag on error
            this._isUpdatingDisplay = false;
        }
    }

    on_chatgptapikey_stored(source, result) {
        Secret.password_store_finish(result);
    }

    onChatGPAPIKeySave() {
        try {
            Logger.debug('Opening API key dialog...');

            // Use the existing createPasswordDialog from ui-components
            let dialog = createPasswordDialog(
                _("Enter your API key:"),
                (newKey) => {
                    if (newKey && newKey.trim()) {
                        Secret.password_store(
                            this.STORE_SCHEMA,
                            {},
                            Secret.COLLECTION_DEFAULT,
                            "Yarr_ChatGPTApiKey",
                            newKey.trim(),
                            null,
                            this.on_chatgptapikey_stored
                        );
                        this.articleManagement._showSimpleNotification(_("API key saved successfully!"));
                    }
                },
                this
            );

            // Actually open the dialog!
            dialog.open();

        } catch (e) {
            Logger.error('Error opening API key dialog: ' + e);
            this.articleManagement._showSimpleNotification(_("Error opening API key dialog. Please check the logs."));
        }
    }

    onOpenLookingGlass() {
        try {
            Logger.debug('Opening Looking Glass debugger...');

            // SAFER: Check if command exists before spawning to prevent system conflicts
            if (GLib.find_program_in_path('cinnamon-looking-glass')) {
                GLib.spawn_command_line_async('cinnamon-looking-glass');
            } else {
                Logger.error('Looking Glass command not found');
                this.articleManagement._showSimpleNotification(_("Looking Glass debugger not available."));
            }

        } catch (e) {
            Logger.error('Error opening Looking Glass: ' + e);
            this.articleManagement._showSimpleNotification(_("Error opening Looking Glass. Please check the logs."));
        }
    }

    onRestartDesklet() {
        try {
            Logger.debug('Restarting desklet...');
            this._restartDesklet();
        } catch (e) {
            Logger.error('Error restarting desklet: ' + e);
        }
    }

    _restartDesklet() {
        try {
            // Set a global flag to indicate that a reload is happening
            global.YARR_IS_RELOADING = true;

            // Use a detached Python helper to reload the desklet code
            let deskletId = this._desklet_id || this._desklet_id;
            let helperPath = DESKLET_ROOT ? DESKLET_ROOT + '/restart_helper.py' : null;

            Logger.debug("Reloading desklet code using helper: " + deskletId);

            // SAFER: Execute the helper script with proper error checking
            let command = `python3 "${helperPath}" "${UUID}" "${deskletId}"`;

            try {
                if (GLib.find_program_in_path('python3') && GLib.file_test(helperPath, GLib.FileTest.EXISTS)) {
                    GLib.spawn_command_line_async(command);
                    // Show a brief notification that reload is in progress
                    this.articleManagement._showSimpleNotification(_("Reloading desklet code..."));
                } else {
                    Logger.error('Python3 or helper script not found');
                    this.articleManagement._showSimpleNotification(_("Restart helper not available."));
                }
            } catch (e) {
                Logger.error('Error spawning restart command: ' + e);
                this.articleManagement._showSimpleNotification(_("Failed to restart desklet."));
            }

        } catch (e) {
            Logger.error('Error restarting desklet: ' + e);
        }
    }

    // Override the default desklet context menu
    on_desklet_clicked() {
        // Call the parent method to show the default menu
        super.on_desklet_clicked();
    }

    on_desklet_right_clicked() {
        // Call the parent method to show the default menu
        super.on_desklet_right_clicked();
    }


    _initializeEssentialComponents() {
        // Check if we already processed this to prevent duplicates
        if (this._essentialComponentsInitialized) return;

        this._essentialComponentsInitialized = true;

        // Build header feed buttons when essential components are initialized (only if not already built)
        if (this.uiDisplay && this.uiDisplay.buildHeaderFeedButtons && !this._headerFeedButtonsBuilt) {
            this.uiDisplay.buildHeaderFeedButtons();
            this._headerFeedButtonsBuilt = true;
        }

        // Load feed button states after essential components are initialized
        this.loadFeedButtonStates();

        Logger.debug('Essential components initialized successfully');
    }

    _cleanupEssentialComponents() {
        // Reset flags to allow re-initialization if needed
        this._essentialComponentsInitialized = false;
        this._headerFeedButtonsBuilt = false;
        Logger.debug('Essential components cleanup completed');
    }

    _reloadDeskletCode() {
        try {
            // Set a global flag to indicate that a reload is happening
            global.YARR_IS_RELOADING = true;

            // Use a detached Python helper to reload the desklet code
            let deskletId = this._desklet_id || this._desklet_id;
            let helperPath = DESKLET_ROOT ? DESKLET_ROOT + '/restart_helper.py' : null;

            Logger.debug("Reloading desklet code using helper: " + deskletId);

            // SAFER: Execute the helper script with proper error checking
            let command = `python3 "${helperPath}" "${UUID}" "${deskletId}"`;

            try {
                if (GLib.find_program_in_path('python3') && GLib.file_test(helperPath, GLib.FileTest.EXISTS)) {
                    GLib.spawn_command_line_async(command);
                    // Show a brief notification that reload is in progress
                    this.articleManagement._showSimpleNotification(_("Reloading desklet code..."));
                } else {
                    Logger.error('Python3 or helper script not found');
                    this.articleManagement._showSimpleNotification(_("Reload helper not available."));
                }
            } catch (e) {
                Logger.error('Error spawning reload command: ' + e);
                this.articleManagement._showSimpleNotification(_("Failed to reload desklet."));
            }

        } catch (e) {
            Logger.error('Error reloading desklet: ' + e);
        }
    }

    // Load feed button states from database
    async loadFeedButtonStates() {
        try {
            if (!this.databaseManager) {
                Logger.debug('Database manager not available');
                return;
            }

            // Wait for database to be ready
            if (!(await this.waitForDatabase())) {
                Logger.error('Database not ready for loadFeedButtonStates');
                return;
            }

            const savedStates = await this.databaseManager.getFeedStates();
            Logger.info(`Loaded ${savedStates.size} saved feed button states`);

            // Apply saved states to current feeds
            if (this.feeds && savedStates.size > 0) {
                this.feeds.forEach(feed => {
                    if (feed.name && savedStates.has(feed.name)) {
                        feed.runtimeDisplayEnabled = savedStates.get(feed.name);
                        Logger.debug(`Restored state for ${feed.name}: ${feed.runtimeDisplayEnabled}`);
                    }
                });
            }
        } catch (e) {
            Logger.error('Error loading feed button states: ' + e);
        }
    }

    // Save feed button states to database
    async saveFeedButtonStates() {
        try {
            Logger.debug('saveFeedButtonStates called');
            Logger.debug('this.databaseManager:', this.databaseManager);
            Logger.debug('this.databaseManager type:', typeof this.databaseManager);

            if (!this.databaseManager) {
                Logger.error('Database manager is null/undefined');
                return;
            }

            // Wait for database to be ready
            if (!(await this.waitForDatabase())) {
                Logger.error('Database not ready for saveFeedButtonStates');
                return;
            }

            if (typeof this.databaseManager.saveAllFeedStates !== 'function') {
                Logger.error('saveAllFeedStates method not found on database manager');
                Logger.debug('Available methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(this.databaseManager)));
                return;
            }

            if (!this.feeds) {
                Logger.error('Feeds not available');
                return;
            }

            const activeFeeds = this.feeds.filter(f => f.active);
            Logger.debug('Active feeds count:', activeFeeds.length);

            await this.databaseManager.saveAllFeedStates(activeFeeds);
            Logger.debug('Feed button states saved to database');
        } catch (e) {
            Logger.error('Error saving feed button states: ' + e);
            Logger.error('Error stack:', e.stack);
        }
    }

    // Cache all current articles for future AI processing
    async cacheAllCurrentArticles() {
        try {
            if (!this.databaseManager || !this.items || this.items.size === 0) {
                Logger.debug('No articles to cache');
                return;
            }

            Logger.info(`Starting to cache ${this.items.size} articles for future AI processing...`);
            let cachedCount = 0;
            let skippedCount = 0;

            for (const [key, item] of this.items) {
                if (item.link) {
                    try {
                        // Check if already cached
                        const cacheInfo = await this.databaseManager.isArticleCached(key);
                        if (!cacheInfo.isCached) {
                            await this.databaseManager.cacheArticleData(key, item.link, {
                                title: item.title || '',
                                description: item.description || '',
                                category: item.category || '',
                                channel: item.channel || '',
                                labelColor: item.labelColor || '#ffffff',
                                pubDate: item.pubDate || '',
                                timestamp: item.timestamp || Date.now()
                            });
                            cachedCount++;
                        } else {
                            skippedCount++;
                        }
                    } catch (e) {
                        Logger.error(`Error caching article ${item.title || 'Untitled'}: ` + e);
                    }
                }
            }

            Logger.info(`Article caching completed: ${cachedCount} cached, ${skippedCount} already cached`);
            this.articleManagement._showSimpleNotification(`Cached ${cachedCount} articles for future AI processing`);
        } catch (e) {
            Logger.error('Error in bulk article caching: ' + e);
        }
    }

    // Load cached AI responses for all current articles
    async loadCachedAIResponses() {
        try {
            if (!this.databaseManager || !this.items || this.items.size === 0) {
                Logger.debug('No articles to load cached responses for');
                return;
            }

            Logger.info(`Loading cached AI responses for ${this.items.size} articles...`);
            let loadedCount = 0;
            let skippedCount = 0;

            for (const [key, item] of this.items) {
                if (item.link && !item.aiResponse) {
                    try {
                        const cachedArticle = await this.databaseManager.getArticleFromCache(key);
                        if (cachedArticle && cachedArticle.aiResponse) {
                            // Restore all cached attributes
                            item.title = cachedArticle.title || item.title;
                            item.description = cachedArticle.description || item.description;
                            item.category = cachedArticle.category || item.category;
                            item.channel = cachedArticle.channel || item.channel;
                            item.labelColor = cachedArticle.labelColor || item.labelColor;
                            item.pubDate = cachedArticle.pubDate || item.pubDate;
                            item.timestamp = cachedArticle.timestamp || item.timestamp;
                            item.aiResponse = cachedArticle.aiResponse;
                            loadedCount++;
                        } else {
                            skippedCount++;
                        }
                    } catch (e) {
                        Logger.error(`Error loading cached response for ${item.title || 'Untitled'}: ` + e);
                    }
                } else {
                    skippedCount++;
                }
            }

            Logger.info(`AI response loading completed: ${loadedCount} loaded, ${skippedCount} skipped`);

            // Update display to show loaded responses
            if (loadedCount > 0) {
                this.safeDisplayUpdate('cached AI responses loaded');
                this.articleManagement._showSimpleNotification(`Loaded ${loadedCount} cached AI responses`);
            }
        } catch (e) {
            Logger.error('Error in loading cached AI responses: ' + e);
        }
    }

    async testDatabaseConnection() {
        try {
            Logger.debug('Testing database connection...');
            const isConnected = await this.databaseManager.testConnection();
            if (isConnected) {
                this.articleManagement._showSimpleNotification(_("Database connection successful!"));
                Logger.debug('Database connection successful.');
            } else {
                this.articleManagement._showSimpleNotification(_("Database connection failed. Please check logs."));
                Logger.error('Database connection failed.');
            }
        } catch (e) {
            Logger.error('Error testing database connection: ' + e);
            this.articleManagement._showSimpleNotification(_("Error testing database connection. Please check logs."));
        }
    }

    // Show current database path
    showDatabasePath() {
        if (this.databaseManager && this.databaseManager.getExpandedDatabasePath) {
            const actualPath = this.databaseManager.getExpandedDatabasePath();
            Logger.debug(`Current database path: ${actualPath}`);
            if (this.articleManagement && this.articleManagement._showSimpleNotification) {
                this.articleManagement._showSimpleNotification(`Database path: ${actualPath}`);
            }
        } else {
            Logger.debug('Database manager not available');
        }
    }

    // RSS Search button callback - bound to settings
    onSearchRssFeeds() {
        Logger.debug('onSearchRssFeeds called from desklet');
        if (this.searchManagers && this.searchManagers.onSearchRssFeeds) {
            this.searchManagers.onSearchRssFeeds();
        } else {
            Logger.error('Search managers not available for RSS search');
        }
    }


}

function main(metadata, desklet_id) {
    let desklet = new YarrDesklet(metadata, desklet_id);

    // Build header feed buttons once when desklet is created
    if (desklet.uiDisplay && desklet.uiDisplay.buildHeaderFeedButtons) {
        desklet.uiDisplay.buildHeaderFeedButtons();
    }

    return desklet;
}





