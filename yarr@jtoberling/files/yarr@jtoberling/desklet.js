const UUID = "yarr@jtoberling";

const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Gettext = imports.gettext;
const Gtk = imports.gi.Gtk;
const Mainloop = imports.mainloop;
const Soup = imports.gi.Soup;
const Signals = imports.signals;
const SignalManager = imports.misc.signalManager;
const Gio = imports.gi.Gio;
const Tooltips = imports.ui.tooltips;
const ModalDialog = imports.ui.modalDialog;
const Secret = imports.gi.Secret;
const Pango = imports.gi.Pango;
const Clutter = imports.gi.Clutter;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const ByteArray = imports.byteArray;

// Central logger
const Logger = require('./logger');

// Import our modules in correct dependency order
let fromXML;
try {
    const fromXMLModule = require('./fromXML');
    fromXML = fromXMLModule.fromXML;
    if (typeof fromXML !== 'function') {
        throw new Error('fromXML export is not a function');
    }
} catch (e) {
    Logger.log('[Yarr Critical] XML parser failed: ' + e, true);
    fromXML = function (xml) {
        Logger.log('[Yarr Warning] Using fallback XML parser');
        return { items: [], title: 'Parser Error' };
    };
}

try {
    const AsyncManagers = require('./async-managers');
    var AsyncCommandExecutor = AsyncManagers.AsyncCommandExecutor;
    var AsyncDatabaseManager = AsyncManagers.AsyncDatabaseManager;
    var TimerManager = AsyncManagers.TimerManager;
    var UIUpdateManager = AsyncManagers.UIUpdateManager;
    var AsyncErrorHandler = AsyncManagers.AsyncErrorHandler;
} catch (e) {
    Logger.log('[Yarr Error] async-managers import failed: ' + e, true);
    throw e;
}

try {
    const DatabaseManagers = require('./database-managers');
    var FavoritesDB = DatabaseManagers.FavoritesDB;
    var RefreshDB = DatabaseManagers.RefreshDB;
    var ReadStatusDB = DatabaseManagers.ReadStatusDB;
} catch (e) {
    Logger.log('[Yarr Error] database-managers import failed: ' + e, true);
    throw e;
}

try {
    const UIComponents = require('./ui-components');
    var createPasswordDialog = UIComponents.createPasswordDialog;
    var createRssSearchDialog = UIComponents.createRssSearchDialog;
    var createFeedSelectionDialog = UIComponents.createFeedSelectionDialog;
} catch (e) {
    Logger.log('[Yarr Error] ui-components import failed: ' + e, true);
    throw e;
}

const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID] ? imports.ui.deskletManager.deskletMeta[UUID].path : null;

function _(str) {
    return Gettext.dgettext(UUID, str);
}

// Logging helper function (delegates to central logger)
function log(message, isError = false) {
    Logger.log(message, isError);
}

// Initialize debug setting
Logger.setDebugEnabled(false);

















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
    favoritesDb = null;
    favoriteKeys = new Set();

    // Add new settings binding
    loadFavoritesOnStartup = true;

    // Add new settings binding
    articleSpacing = 0.2;

    lastRefresh = null;

    // Add memory monitoring capability
    _memoryMetrics = null;

    // Add refresh history tracking
    refreshDb = null;
    refreshHistory = [];

    // Add setting for showing refresh separators
    showRefreshSeparators = true;

    // Add setting for debug logs
    enableDebugLogs = false;

    // Add new property for read feature
    readArticleIds = new Set();
    // Read title styling
    dimReadTitles = true;
    readTitleColor = 'rgb(180,180,180)';

    constructor(metadata, desklet_id) {

        // Call parent constructor FIRST
        super(metadata, desklet_id);

        // Store desklet_id for later use
        this._desklet_id = desklet_id;

        Logger.log("----------------------------------- YARR DESKLET INITIALIZING -----------------------------------------------");

        try {
            // Ensure menu items are ready; attempt immediately
            this._addCustomMenuItems();

            // translation init
            if (DESKLET_ROOT && !DESKLET_ROOT.startsWith("/usr/share/")) {
                Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");
            }

            // Initialize Secret schema
            this.STORE_SCHEMA = new Secret.Schema("org.YarrDesklet.Schema", Secret.SchemaFlags.NONE, {});

            // Initialize basic properties
            this.refreshEnabled = true;
            this.delay = 300; // 5 minutes default
            this.items = new Map();
            this.favoriteKeys = new Set(); // Initialize the Set properly
            this.readArticleIds = new Set(); // Initialize read status Set

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

            // Initialize async managers
            this.timerManager = new TimerManager();
            this.uiUpdateManager = new UIUpdateManager();
            this.uiUpdateManager.setUpdateCallback(() => this.displayItems());

            // Initialize settings
            this.settings = new Settings.DeskletSettings(this, metadata.uuid, desklet_id);

            // Initialize HTTP session
            if (Soup.MAJOR_VERSION === 2) {
                this.httpSession = new Soup.SessionAsync();
                Soup.Session.prototype.add_feature.call(this.httpSession, new Soup.ProxyResolverDefault());
            } else {
                this.httpSession = new Soup.Session();
            }

            this.httpSession.timeout = 60;
            this.httpSession.idle_timeout = 60;
            this.httpSession.user_agent = 'Mozilla/5.0 YarrDesklet/1.0';

            // Bind all settings
            this.settings.bind('refreshInterval-spinner', 'delay');
            this.settings.bind('feeds', 'feeds');
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
            // Read-title styling bindings
            this.settings.bind('dimReadTitles', 'dimReadTitles');
            this.settings.bind('readTitleColor', 'readTitleColor');

            // Set global debug flag
            Logger.setDebugEnabled(this.enableDebugLogs);

            // Log settings changes
            this.settings.connect("changed::enableDebugLogs", () => {
                Logger.setDebugEnabled(this.enableDebugLogs);
                Logger.log("Debug logging " + (this.enableDebugLogs ? "enabled" : "disabled"));
            });

            // Initialize SignalManager
            this._signals = new SignalManager.SignalManager(null);

            // Load feeds from settings
            this.feeds = this.settings.getValue('feeds');

            // Initialize favorites database
            this.favoritesDb = new FavoritesDB();
            // Initialize favoriteKeys as empty Set - it will be populated by loadFavoriteArticles
            this.favoriteKeys = new Set();

            // Initialize refresh history database
            this.refreshDb = new RefreshDB();
            this.refreshHistory = [];

            // Load favorites if enabled (defer slightly to avoid blocking activation)
            if (this.loadFavoritesOnStartup) {
                GLib.timeout_add(GLib.PRIORITY_LOW, 500, () => {
                    this.loadFavoriteArticles();
                    return GLib.SOURCE_REMOVE;
                });
            }

            // Initialize data asynchronously
            this._initializeData();

            // Build UI
            this.buildInitialDisplay();
            this.onDisplayChanged();
            this.onSettingsChanged();

            // Start initial feed collection with single one-shot timer
            // Avoid overlapping with an immediate manual call which can cause contention at startup
            this.setUpdateTimer(1);  // Start first update in 1 second

            // Add cleanup handler
            this.actor.connect('destroy', () => this._onDestroy());

            this.settings.bind('showReadStatusCheckbox', 'showReadStatusCheckbox');

            // Add new class for read status management
            this.readStatusDb = new ReadStatusDB();
            // Load read status for last 3 months
            const threeMonthsAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
            this.readArticleIds = new Set(); // Will be loaded in _initializeData
            // Periodically clean up old records
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3600, () => {
                this.readStatusDb.cleanupOldRecords();
                return GLib.SOURCE_REMOVE;
            });

            // Initialize custom menu items flag
            this._customMenuItemsAdded = false;

            // Store click signal ID for reinitialization
            this._clickSignalId = null;
            // Signal ID for wake-up handler
            this._wakeUpSignalId = null;

            // Check if we are reloading and apply fixes
            if (global.YARR_IS_RELOADING) {
                this._log("Desklet is reloading, applying fixes...");
                delete global.YARR_IS_RELOADING;

                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                    this._applyPostReloadFixes();
                    return GLib.SOURCE_REMOVE;
                });
            }
        } catch (e) {
            log('[Yarr Error] Constructor error: ' + e);
            throw e;
        }
    }

    on_desklet_added_to_desktop() {
        log("YARR DESKLET: on_desklet_added_to_desktop called");
        this._log("Desklet added to desktop, connecting wake-up signal.");

        // Try to connect the wake-up signal with a delay to ensure Main.screenShield is available
        GLib.timeout_add(GLib.PRIORITY_LOW, 1000, () => {
            this._connectWakeUpSignal();
            return GLib.SOURCE_REMOVE;
        });
    }

    _connectWakeUpSignal() {
        this._log("Checking Main object properties...");
        this._log("Main.screenShield: " + (Main.screenShield ? "available" : "not available"));

        // List available properties on Main object for debugging
        for (let prop in Main) {
            if (typeof Main[prop] === 'object' && Main[prop] !== null) {
                this._log("Main." + prop + " is available");
            }
        }

        if (Main.screenShield) {
            try {
                this._wakeUpSignalId = Main.screenShield.connect('wake-up-screen', Lang.bind(this, this._onWakeUpScreen));
                this._log("Wake-up signal connected successfully.");
            } catch (e) {
                this._log("Error connecting wake-up signal: " + e, true);
            }
        } else {
            this._log("Main.screenShield not available, cannot connect wake-up signal.", true);
            // Fallback: Use a periodic check for wake-up detection
            this._log("Using fallback wake-up detection method.");
            this._startFallbackWakeUpDetection();
        }
    }

    _startFallbackWakeUpDetection() {
        // Check every 30 seconds if the system has woken up (low priority)
        this._wakeUpCheckTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 30, () => {
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

        // If more than 60 seconds have passed, assume the system was sleeping
        if (now - this._lastWakeUpCheck > 60000) {
            this._log("Detected potential wake-up event (fallback method)");
            this._onWakeUpScreen();
        }

        this._lastWakeUpCheck = now;
    }

    _applyPostReloadFixes() {
        try {
            this._log("Applying post-reload/wake-up fixes now.");
            if (this.actor) {
                // Keep adjustments minimal to avoid compositor contention
                this.actor.set_reactive(true);
                this.actor.set_can_focus(true);
                this.actor.show();
                this.actor.queue_redraw();
                this._log("Post-reload/wake-up fixes applied successfully.");
            } else {
                this._log("Actor not found, cannot apply fixes.", true);
            }
        } catch (e) {
            this._log('Error applying fixes: ' + e, true);
        }
    }

    _onWakeUpScreen() {
        this._log("Screen is waking up, applying fixes...");
        // Use a timeout to give the system time to settle
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this._applyPostReloadFixes();
            return GLib.SOURCE_REMOVE;
        });
    }

    // A method to log messages with the correct debug settings
    _log(message, isError = false) {
        log(message, isError);
    }

    async _initializeData() {
        try {
            this._log('Initializing data asynchronously...');

            // Load refresh history
            this.refreshHistory = await this.refreshDb.getRefreshHistory();
            this._log(`Loaded ${this.refreshHistory.length} refresh events`);

            // Load favorites key set early for correct favorite marking
            try {
                const favSet = await this.favoritesDb.getFavorites();
                if (favSet && favSet.size !== undefined) {
                    this.favoriteKeys = favSet;
                    this._log(`Loaded favoriteKeys: ${this.favoriteKeys.size}`);
                }
            } catch (e) {
                this._log('Error loading favorite keys: ' + e, true);
            }

            // Load read status for last 3 months
            const threeMonthsAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
            this.readArticleIds = await this.readStatusDb.getReadIds(threeMonthsAgo);
            this._log(`Loaded ${this.readArticleIds.size} read article IDs`);

            // Refresh display to show loaded data (batch to avoid many rapid calls)
            if (this.uiUpdateManager) {
                this.uiUpdateManager.scheduleUpdate();
            } else {
                this.displayItems();
            }

        } catch (e) {
            this._log('Error initializing data: ' + e, true);
        }
    }

    _onDestroy() {
        try {
            // Clear timers with proper validation
            if (this.timerInProgress && this.timerInProgress > 0) {
                try {
                    Mainloop.source_remove(this.timerInProgress);
                } catch (e) {
                    this._log('Error removing timerInProgress: ' + e, true);
                }
            }
            if (this.updateDownloadedTimer && this.updateDownloadedTimer > 0) {
                try {
                    Mainloop.source_remove(this.updateDownloadedTimer);
                } catch (e) {
                    this._log('Error removing updateDownloadedTimer: ' + e, true);
                }
            }
            // Clear fallback wake-up timer if set
            if (this._wakeUpCheckTimer && this._wakeUpCheckTimer > 0) {
                try {
                    GLib.source_remove(this._wakeUpCheckTimer);
                } catch (e) {
                    this._log('Error removing _wakeUpCheckTimer: ' + e, true);
                }
            }

            // Disconnect signals
            this._signals.disconnectAllSignals();
            if (this._wakeUpSignalId && Main.screenShield) {
                try {
                    Main.screenShield.disconnect(this._wakeUpSignalId);
                } catch (e) {
                    this._log('Error disconnecting wake-up signal: ' + e, true);
                }
            }

            // Clear items map
            this.items.clear();

            // Clean up menu
            if (this._menu) {
                this._menu.destroy();
            }

            // Reset menu flag
            this._customMenuItemsAdded = false;

            // Clear HTTP session
            if (this.httpSession) {
                this.httpSession.abort();
                this.httpSession = null;
            }
        } catch (e) {
            this._log('Error in _onDestroy: ' + e, true);
        }
    }

    invertbrightness(rgb) {
        rgb = Array.prototype.join.call(arguments).match(/(-?[0-9.]+)/g);
        let brightness = 255 * 3;
        for (let i = 0; i < rgb.length && i < 3; i++) {
            brightness -= rgb[i];
        }
        return brightness > 255 * 1.5 ? '255, 255, 255' : '0, 0, 0';
    }

    openChatGPTAPIKeys() {
        Gio.app_info_launch_default_for_uri("https://platform.openai.com/api-keys", global.create_app_launch_context());
    }

    openChatGPTUsage() {
        Util.spawnCommandLine('xdg-open https://platform.openai.com/usage');
    }

    onSearchRssFeeds() {
        // Add detailed logging
        log('onSearchRssFeeds called - creating RSS search dialog');

        // Create and show the RSS search dialog
        let rssSearchDialog = createRssSearchDialog(
            _("Search for RSS Feeds"),
            Lang.bind(this, this._onRssSearchResult),
            this
        );
        rssSearchDialog.open();
    }

    _onRssSearchResult(baseUrl) {
        log('_onRssSearchResult called with URL: ' + baseUrl);

        if (!baseUrl) {
            log('No URL provided, aborting search');
            return;
        }

        // Show a notification that search is in progress using the simple notification
        this._showSimpleNotification(_("Searching for RSS feeds at ") + baseUrl);

        // Start the search process
        this._searchForRssFeeds(baseUrl);
    }

    _testCommand() {
        try {
            log("Starting basic command test...");

            // Test 1: Can we run a simple echo command?
            AsyncCommandExecutor.executeCommand('echo "Hello World"', (success1, stdout1, stderr1) => {
                if (success1) {
                    log("Echo test successful: " + stdout1);
                } else {
                    log("Echo test failed: " + (stderr1 || "Unknown error"));
                }

                // Test 2: Can we run the which command to find curl?
                AsyncCommandExecutor.executeCommand('which curl', (success2, stdout2, stderr2) => {
                    if (success2 && stdout2 && stdout2.length > 0) {
                        log("Curl found at: " + stdout2);
                    } else {
                        log("Curl not found: " + (stderr2 || "Not in PATH"));
                    }

                    // Test 3: Can we try a very simple curl command?
                    AsyncCommandExecutor.executeCommand('curl --version', (success3, stdout3, stderr3) => {
                        if (success3) {
                            log("Curl version test successful");
                        } else {
                            log("Curl version test failed: " + (stderr3 || "Unknown error"));
                        }

                        log("Basic command test completed");
                    });
                });
            });
        } catch (e) {
            log("Error in _testCommand: " + e.message);
        }
    }

    _showSimpleNotification(message) {
        try {
            log('Showing simple notification: ' + message);

            // Create a simple notification using a normal dialog
            let dialog = new ModalDialog.ModalDialog();

            let contentBox = new St.BoxLayout({
                vertical: true,
                style_class: 'simple-notification-content',
                style: 'spacing: 10px; padding: 10px;'
            });

            let messageLabel = new St.Label({
                text: message,
                style: 'font-size: 14px; text-align: center;'
            });

            contentBox.add(messageLabel);
            dialog.contentLayout.add(contentBox);

            dialog.setButtons([
                {
                    label: _("OK"),
                    action: () => dialog.close()
                }
            ]);

            dialog.open();
            log('Simple notification shown');

            return dialog;
        } catch (e) {
            log('Error showing simple notification: ' + e);
            return null;
        }
    }

    _searchForRssFeeds(baseUrl) {
        try {
            log('Starting simplified RSS feed search for: ' + baseUrl);

            // Make sure the URL has a protocol prefix
            if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
                baseUrl = 'https://' + baseUrl;
            }

            log('Processed URL: ' + baseUrl);

            // Just check the base URL and maybe a couple of common paths
            const pathsToCheck = [
                '', // base URL itself
                '/feed',
                '/feedburner',
                '/rss',
                '/atom',
                '/json',
                '/xml',
                '/rss.xml',
                '/atom.xml',
                '/json.xml',
                '/blog/feed',
                '/blog/atom',
                '/blog/rss',
                '/blog/feed.xml',
                '/blog/atom.xml',
                '/news/feed',
                '/news/rss',
                '/news/atom',
                '/news.xml',
                '/news/feed.xml',
                '/news/rss.xml',
                '/news/atom.xml',
                '/articles/feed',
                '/articles/rss',
                '/articles/atom',
                '/articles.xml',
                '/articles/feed.xml',
                '/articles/rss.xml',
                '/articles/atom.xml',
                '/updates/feed',
                '/updates/rss',
                '/updates/atom',
                '/updates.xml',
                '/updates/feed.xml',
                '/updates/rss.xml',
                '/updates/atom.xml',
                '/content/feed',
                '/content/rss',
                '/content/atom',
                '/content.xml',
                '/content/feed.xml',
                '/content/rss.xml',
                '/content/atom.xml',
                '/posts/feed',
                '/posts/rss',
                '/posts/atom',
                '/posts.xml',
                '/posts/feed.xml',
                '/posts/rss.xml',
                '/posts/atom.xml',
                '/feed/rss',
                '/feed/atom',
                '/feed/rss2',
                '/feed/rdf',
                '/feed/feed',
                '/feed/index.xml',
                '/feed/rss.xml',
                '/feed/atom.xml'
            ];

            let foundFeeds = [];

            log('Will check ' + pathsToCheck.length + ' URLs');

            // Use async approach - check URLs in parallel
            let completedChecks = 0;
            const totalChecks = pathsToCheck.length;

            for (let i = 0; i < pathsToCheck.length; i++) {
                let path = pathsToCheck[i];
                let url = baseUrl;
                if (path && !path.startsWith('/')) {
                    url += '/';
                }
                url += path;

                log('Checking URL: ' + url);

                // Very simple command
                let command = 'curl -s -L --max-time 3 --connect-timeout 2 "' + url + '"';
                log('Running command: ' + command);

                AsyncCommandExecutor.executeCommand(command, (success, stdout, stderr) => {
                    completedChecks++;
                    log(`Command completed for ${url}: success=${success}, stdout length=${stdout ? stdout.length : 0}, stderr=${stderr || 'none'}`);

                    if (!success) {
                        log('Command failed for ' + url);
                    } else {
                        let content = '';
                        if (stdout && stdout.length > 0) {
                            content = stdout;
                            log('Got content of length: ' + content.length);
                        } else {
                            log('No content received');
                        }

                        // Very simple check
                        if (content.includes('<rss') || content.includes('<feed') || content.includes('<channel')) {
                            log('Found potential feed at: ' + url);

                            // Extract title
                            let title = url;
                            const titleMatch = content.match(/<title>(.*?)<\/title>/i);
                            if (titleMatch && titleMatch[1]) {
                                title = titleMatch[1].trim();
                                log('Feed title: ' + title);
                            }

                            foundFeeds.push({
                                url: url,
                                title: title
                            });
                        } else {
                            log('Not a feed: ' + url);
                        }
                    }

                    // Check if all URLs have been processed
                    if (completedChecks === totalChecks) {
                        log('Search completed, found ' + foundFeeds.length + ' feeds');

                        // Show results
                        if (foundFeeds.length > 0) {
                            log('Showing feed selection dialog with ' + foundFeeds.length + ' feeds');
                            this._showFeedSelectionDialog(foundFeeds);
                        } else {
                            log('No feeds found, showing notification');
                            this._showSimpleNotification(_("No RSS feeds found at ") + baseUrl);
                        }
                    }
                });
            }

        } catch (err) {
            log('Error in simplified _searchForRssFeeds: ' + err);
            this._showSimpleNotification(_("Error searching for RSS feeds: ") + err.message);
        }
    }

    _extractFeedTitle(content) {
        // Try to extract the title of the feed
        const titleMatch = content.match(/<title>(.*?)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
            return titleMatch[1].trim();
        }
        return null;
    }

    _showFeedSelectionDialog(feeds) {
        let feedSelectionDialog = createFeedSelectionDialog(
            _("Select RSS Feeds to Add"),
            feeds,
            Lang.bind(this, this._onFeedSelectionResult),
            this
        );
        feedSelectionDialog.open();
    }

    _onFeedSelectionResult(selectedFeeds) {
        if (!selectedFeeds || selectedFeeds.length === 0) return;

        // Add the selected feeds to the configuration
        let currentFeeds = this.settings.getValue('feeds');

        for (let feed of selectedFeeds) {
            // Generate a random color for the label
            let color = this._generateRandomColor();

            // Add the feed to the config
            currentFeeds.push({
                name: feed.title || feed.url.split('/').pop(),
                active: true,
                url: feed.url,
                labelcolor: color,
                filter: ""
            });
        }

        // Update settings and refresh
        this.settings.setValue('feeds', currentFeeds);
        this.onRefreshSettings();
        this._showSimpleNotification(_("Added ") + selectedFeeds.length + _(" new RSS feeds"));
    }

    _generateRandomColor() {
        // Generate a random color for feed labels
        const r = Math.floor(Math.random() * 200);
        const g = Math.floor(Math.random() * 200);
        const b = Math.floor(Math.random() * 200);
        return "#" + r.toString(16).padStart(2, '0') +
            g.toString(16).padStart(2, '0') +
            b.toString(16).padStart(2, '0');
    }

    onAIPromptExample1() {
        this.ai_systemprompt = 'Summarize in four sentences.';
    }

    onAIPromptExample2() {
        this.ai_systemprompt = 'Foglald össze limerick-ben.';
    }

    onAIPromptExample3() {
        this.ai_systemprompt = '俳句のエッセンス\n日本語では';
    }

    onAIPromptExample4() {
        this.ai_systemprompt = 'Foglald össze 4 mondatban.';
    }

    onAIPromptExample5() {
        this.ai_systemprompt = 'Summarize in 4-8 short bullet points, separtate lines, English language.\nOmit other references and external links from the summary.';
    }

    onAIPromptExample6() {
        this.ai_systemprompt = 'Foglald össze 4-8 rövid bullet pontban, mind külön sorban, magyarul.\nHaggyd ki a többi az oldalon olvasható cikket és hivatkozást a felsorolásból.';
    }


    onRefreshSettings() {
        // Existing display updates
        this.onDisplayChanged();
        this.onSettingsChanged();

        // Add items redisplay
        this.displayItems();
    }

    onSettingsChanged() {
        this.setUpdateTimer(1);
    }

    onDisplayChanged() {

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
            "text-shadow: " + "0px 1px 6px rgba(" + this.invertbrightness(this.color) + ", 0.2); " +
            "padding: 2px 2px;").toLowerCase();

        // -----------------------------------------------

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
            (ai_fontstyle ? "font-style: " + ai_fontstyle + "; " : "") +
            (ai_fontweight ? "font-weight: " + ai_fontweight + "; " : "") +
            "color: " + this.ai_color + "; " +
            "text-shadow: " + "0px 1px 6px rgba(" + this.invertbrightness(this.ai_color) + ", 0.2); " +
            "padding: 2px 2px;").toLowerCase();

        this.mainBox.set_size(this.width, this.height);

        this.mainBox.style = "background-color: rgba(" + (this.backgroundColor.replace('rgb(', '').replace(')', '') + "," + this.transparency + ")");
    }

    //------------------------

    // HTTP request creator function
    httpRequest(method, url, headers = null, body = null) {
        return new Promise((resolve, reject) => {
            try {
                const message = Soup.Message.new(method, url);
                if (!message) {
                    throw new Error(`Failed to create message for URL: ${url}`);
                }

                // Add headers
                message.request_headers.append('User-Agent', 'Mozilla/5.0 YarrDesklet/1.0');
                if (headers) {
                    headers.forEach(([key, value]) => {
                        message.request_headers.append(key, value);
                    });
                }

                // Add body for POST requests
                if (method === 'POST' && body) {
                    if (Soup.MAJOR_VERSION === 2) {
                        message.set_request('application/json', 2, body);
                    } else {
                        message.set_request_body_from_bytes('application/json',
                            new GLib.Bytes(body));
                    }
                }

                // Add a hard timeout as a safety net
                let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30000, () => {
                    reject(new Error('HTTP request timed out'));
                    return GLib.SOURCE_REMOVE;
                });

                const clearTimeout = () => {
                    if (timeoutId) {
                        try { GLib.source_remove(timeoutId); } catch (e) { }
                        timeoutId = 0;
                    }
                };

                // Handle Soup v2 vs v3
                if (Soup.MAJOR_VERSION === 2) {
                    this.httpSession.queue_message(message, (session, response) => {
                        clearTimeout();
                        if (response.status_code !== 200) {
                            reject(new Error(`HTTP ${response.status_code}: ${response.reason_phrase}`));
                            return;
                        }
                        resolve(message.response_body.data);
                    });
                } else {
                    this.httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null,
                        (session, result) => {
                            try {
                                const bytes = session.send_and_read_finish(result);
                                clearTimeout();
                                if (!bytes) {
                                    reject(new Error('No response data'));
                                    return;
                                }
                                const response = ByteArray.toString(bytes.get_data());
                                resolve(response);
                            } catch (error) {
                                clearTimeout();
                                reject(error);
                            }
                        });
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    setUpdateTimer(timeOut) {
        if (this._setUpdateTimerInProgress) return;
        this._setUpdateTimerInProgress = true;

        try {
            // Clear existing timer if any
            if (this.timerInProgress) {
                try {
                    Mainloop.source_remove(this.timerInProgress);
                } catch (e) {
                    this._log('Error removing existing timer: ' + e, true);
                }
                this.timerInProgress = 0;
            }

            // Set delay: 1s for immediate one-shot, otherwise at least 300s or user-defined delay
            const delay = (timeOut === 1)
                ? 1
                : Math.max(300, this.delay);

            // Create new timer
            this.timerInProgress = Mainloop.timeout_add_seconds(delay, () => {
                // Clear timer ID since it's about to fire
                this.timerInProgress = 0;

                // Execute timer event
                this.onTimerEvent();

                // Return false to prevent auto-repeat
                return false;
            });

            if (!this.timerInProgress) {
                this._log('Failed to create timer', true);
            }

        } catch (e) {
            this._log('Error in setUpdateTimer: ' + e, true);
            this.timerInProgress = 0;
        } finally {
            this._setUpdateTimerInProgress = false;
        }
    }

    onTimerEvent() {
        // Prevent concurrent updates
        if (this._updateInProgress) {
            this.setUpdateTimer(this.delay);
            return;
        }

        this._updateInProgress = true;

        try {
            // Execute feed collection with timeout to avoid hangs
            AsyncErrorHandler.withTimeout(() => this.collectFeeds(), 30000)
                .catch(error => {
                    this._log('Error collecting feeds: ' + error, true);
                })
                .finally(() => {
                    this._updateInProgress = false;
                    this._log('Feed collection completed, scheduling next update');
                    // Schedule next update
                    if (this.refreshEnabled) {
                        this.setUpdateTimer(this.delay);
                    }
                });
        } catch (e) {
            this._log('Error in timer event: ' + e, true);
            this._updateInProgress = false;
            if (this.refreshEnabled) {
                this.setUpdateTimer(this.delay);
            }
        }
    }

    onRefreshClicked() {
        // Set refresh icon to indicate loading
        if (this.refreshIcon) {
            this.refreshIcon.set_icon_name('process-working');
        }

        // Immediately collect feeds (guarded by _updateInProgress to avoid overlap)
        if (this._updateInProgress) {
            this.setUpdateTimer(this.delay);
            return;
        }
        this._updateInProgress = true;
        AsyncErrorHandler.withTimeout(() => this.collectFeeds(), 30000)
            .then(() => {
                // Reset icon after successful refresh
                if (this.refreshIcon) {
                    this.refreshIcon.set_icon_name('reload');
                }
            })
            .catch(error => {
                // Reset icon and log error
                if (this.refreshIcon) {
                    this.refreshIcon.set_icon_name('reload');
                }
                log('Error refreshing feeds:', error);
            })
            .finally(() => {
                this._updateInProgress = false;
            });

        // Also reset the timer for next automatic refresh
        this.setUpdateTimer(this.delay);
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
            context.setUpdateTimer(3);
        }
    }

    buildInitialDisplay() {
        this.setHeader(_('Yarr'));

        // Main container
        this.mainBox = new St.BoxLayout({
            vertical: true,
            width: this.width,
            height: this.height,
            style_class: "desklet"
        });

        // Fixed height header container that won't be affected by scroll
        this.headerContainer = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            height: 40,
            style: 'min-height: 40px; background-color: rgba(0,0,0,0.2);',  // Make header visually distinct
            y_expand: false,  // Prevent header from expanding
            reactive: true    // Ensure header stays interactive
        });

        // Header content
        this.headBox = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style: 'padding: 4px; margin: 0 1rem;'
        });

        // Left side: Title and search
        let leftBox = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 10px;'
        });

        // Title with icon
        let titleBox = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 4px;'
        });

        let titleIcon = new St.Icon({
            icon_name: 'feed-subscribe',
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 20,
            style: 'padding-top: 2px;'
        });

        this.headTitle = new St.Label({
            text: _('Loading: feeds ...'),
            style: 'font-weight: bold; padding-top: 3px;'
        });

        titleBox.add(titleIcon);
        titleBox.add(this.headTitle);
        leftBox.add(titleBox);

        // Add Article button
        this.addArticleButton = new St.Button({
            style_class: 'yarr-button',
            style: 'padding: 4px 8px; margin-left: 10px;'
        });
        let addArticleButtonBox = new St.BoxLayout();
        let addArticleIcon = new St.Icon({
            icon_name: 'list-add',
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 16
        });
        let addArticleLabel = new St.Label({
            text: _(' Add article'),
            style: 'padding-left: 5px;'
        });
        addArticleButtonBox.add(addArticleIcon);
        addArticleButtonBox.add(addArticleLabel);
        this.addArticleButton.set_child(addArticleButtonBox);
        this.addArticleButton.connect('clicked', () => this._showAddArticleDialog());
        leftBox.add(this.addArticleButton);

        // Add favorite filter button before search if feature is enabled
        if (this.enableFavoriteFeature) {
            this.favoriteFilterBtn = new St.Button({
                style_class: 'yarr-button',
                style: 'padding: 4px; margin-left: 10px;'
            });

            this.favoriteFilterIcon = new St.Icon({
                icon_name: 'non-starred',
                icon_type: St.IconType.SYMBOLIC,
                icon_size: 16,
                style: 'color: #888888;'
            });

            this.favoriteFilterBtn.set_child(this.favoriteFilterIcon);

            this.favoriteFilterBtn.connect('clicked', () => {
                this.showOnlyFavorites = !this.showOnlyFavorites;

                // Update icon
                this.favoriteFilterIcon.set_icon_name(this.showOnlyFavorites ? 'starred' : 'non-starred');
                this.favoriteFilterIcon.style = this.showOnlyFavorites ? 'color: #ffd700;' : 'color: #888888;';

                // Refresh display with filter
                this.displayItems();
            });

            leftBox.add(this.favoriteFilterBtn);
        }

        // Search box after title and favorite button
        this.searchBox = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 4px; margin-left: 1rem;'
        });

        this.searchButton = new St.Button({
            style_class: 'search-button',
            style: 'padding: 4px 8px;',
            reactive: true,
            track_hover: true
        });

        let searchButtonBox = new St.BoxLayout();

        let searchIcon = new St.Icon({
            icon_name: 'edit-find',
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 16
        });

        this.searchLabel = new St.Label({
            text: _(" Search..."),
            style: 'padding-left: 5px;'
        });

        searchButtonBox.add(searchIcon);
        searchButtonBox.add(this.searchLabel);
        this.searchButton.set_child(searchButtonBox);

        // Add clear search button
        this.clearSearchButton = new St.Button({
            style_class: 'clear-search-button',
            style: 'padding: 4px;',
            visible: false
        });

        let clearIcon = new St.Icon({
            icon_name: 'edit-clear',
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 16
        });
        this.clearSearchButton.set_child(clearIcon);

        // Connect search button to show modal dialog
        this.searchButton.connect('clicked', () => {
            let dialog = new ModalDialog.ModalDialog();

            // Add title
            let titleBin = new St.Bin({
                style_class: 'search-title',
                style: 'margin-bottom: 10px;'
            });

            let titleLabel = new St.Label({
                text: _("Search Articles"),
                style_class: 'search-title-text',
                style: 'font-size: 16px; font-weight: bold;'
            });

            titleBin.set_child(titleLabel);
            dialog.contentLayout.add(titleBin);

            // Add search entry
            let entry = new St.Entry({
                name: 'searchEntry',
                hint_text: _("Type to search..."),
                track_hover: true,
                reactive: true,
                can_focus: true,
                style: 'width: 250px; min-width: 250px;'
            });

            // Set initial text if there's an existing filter
            if (this.searchFilter) {
                entry.set_text(this.searchFilter);
            }

            dialog.contentLayout.add(entry);

            // Handle Enter key
            entry.clutter_text.connect('key-press-event', (actor, event) => {
                let symbol = event.get_key_symbol();
                if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                    let text = entry.get_text();
                    if (text) {
                        this.searchFilter = text;
                        this.searchLabel.text = " " + text;
                        this.clearSearchButton.visible = true;
                        this.displayItems(this);
                    }
                    dialog.close();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            // Add buttons
            dialog.setButtons([
                {
                    label: _("Cancel"),
                    action: () => dialog.close(),
                    key: Clutter.KEY_Escape
                },
                {
                    label: _("Search"),
                    action: () => {
                        let text = entry.get_text();
                        if (text) {
                            this.searchFilter = text;
                            this.searchLabel.text = " " + text;
                            this.clearSearchButton.visible = true;
                            this.displayItems(this);
                        }
                        dialog.close();
                    },
                    key: Clutter.KEY_Return
                }
            ]);

            dialog.open();
            global.stage.set_key_focus(entry);
        });

        // Connect clear button
        this.clearSearchButton.connect('clicked', () => {
            this.searchFilter = '';
            this.searchLabel.text = _(" Search...");
            this.clearSearchButton.visible = false;
            this.displayItems(this);
        });

        this.searchBox.add(this.searchButton);
        this.searchBox.add(this.clearSearchButton);
        leftBox.add(this.searchBox);

        // Right side: Control buttons with right alignment
        let rightBox = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 6px;',
            x_align: St.Align.END
        });

        // Toggle refresh button with icon
        this.toggleRefresh = new St.Button({
            label: _("Disable refresh"),
            style_class: 'toggleButtonOn',
            style: 'padding: 4px 8px;'
        });

        // Refresh button with icon
        this.refreshButton = new St.Button({
            style_class: 'feedRefreshButton',
            style: 'padding: 4px;'
        });

        this.refreshIcon = new St.Icon({
            icon_name: 'reload',
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 16
        });

        this.refreshButton.set_child(this.refreshIcon);

        // Connect button events
        this.refreshButton.connect("clicked", Lang.bind(this, this.onRefreshClicked));
        this._signals.connect(this.toggleRefresh, 'clicked', (...args) =>
            this.onClickedToggleRefresh(...args, this)
        );

        rightBox.add(this.toggleRefresh);
        rightBox.add(this.refreshButton);

        // Add everything to header with proper spacing
        this.headBox.add(leftBox);
        this.headBox.add(new St.Bin({ x_expand: true }));  // Flexible space
        this.headBox.add(rightBox);

        this.headerContainer.add(this.headBox);

        // Separate scrollable content container  
        let scrollContainer = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
            style: 'margin-top: 2px;',
            clip_to_allocation: true  // Ensure content doesn't overflow outside bounds
        });

        // Create scrollview with proper policy
        let scrollBox = new St.ScrollView({
            style_class: 'yarr-scrollbox',
            x_fill: true,
            y_fill: true,
            x_expand: true,
            y_expand: true,
            clip_to_allocation: true  // Prevent content from rendering outside scroll area
        });

        scrollBox.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC);

        // Container for feed items
        this.dataBox = new St.BoxLayout({
            vertical: true,
            style_class: 'yarr-feeds-box',
            y_expand: true,
            x_expand: true,
            style: 'spacing: 2px;'
        });

        // Proper layout hierarchy
        scrollBox.add_actor(this.dataBox);
        scrollContainer.add(scrollBox);

        // Add components in correct order
        this.mainBox.add(this.headerContainer);  // Fixed header first
        this.mainBox.add(scrollContainer);       // Scrollable content second

        this.setContent(this.mainBox);
    }

    hashCode(str) {
        return str.split('').reduce((prevHash, currVal) =>
            (((prevHash << 5) - prevHash) + currVal.charCodeAt(0)) | 0, 0);
    }


    _cleanupItem(item) {
        if (!item) return;

        // Clear references
        if (item.aiResponse) {
            item.aiResponse = '';
        }
        if (item.description) {
            item.description = '';
        }
        // Clean other fields...
    }

    additems(context, itemobj) {
        try {
            // Generate unique key
            const key = `${itemobj.channel}-${itemobj.title}-${itemobj.timestamp.getTime()}`;

            // Add new item to map with isFavorite property
            context.items.set(key, {
                ...itemobj,  // spread operator to clone
                key: key,    // store key for later use
                isFavorite: false,  // default favorite status
                downloadTimestamp: Date.now() // when this article was downloaded
            });

            // Schedule display update using Promise to avoid UI blocking
            Promise.resolve().then(() => {
                // Limit size and clean old elements if needed
                if (context.items.size > context.itemlimit) {
                    const sortedItems = Array.from(context.items.entries())
                        .sort((a, b) => b[1].timestamp - a[1].timestamp);

                    // Keep only the newest items
                    context.items = new Map(sortedItems.slice(0, context.itemlimit));
                }

                // Schedule UI update
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this.displayItems();
                    return GLib.SOURCE_REMOVE;
                });
            }).catch(e => {
                log('Error in additems:', e);
            });

        } catch (e) {
            log('Error in additems:', e);
        }
    }

    // Helper function to check if text matches filter
    _checkMatch(filter, title, category, description) {
        const regexp = new RegExp(filter.filter, 'i');

        return (filter.inTitle && title && regexp.test(title)) ||
            (filter.inCategory && category && regexp.test(category)) ||
            (filter.inDescription && description && regexp.test(description));
    }

    // Simplified main filter function
    inGlobalFilter(self, title, category, description) {
        if (!self?.listfilter?.length) return true;

        for (const filter of self.listfilter) {
            if (!filter?.active) continue;

            try {
                const matches = this._checkMatch(filter, title, category, description);
                if (filter.unmatch ? !matches : matches) return false;
            } catch {
                continue;
            }
        }
        return true;
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

    async collectFeeds() {
        if (!this.refreshEnabled || !this.httpSession) return;

        try {
            this._isRefreshing = true;
            const feeds = [...this.feeds].filter(f => f?.active && f?.url?.length);
            if (!feeds?.length) return;

            this._log(`Collecting ${feeds.length} feeds`);

            // Track count of new articles found in this refresh
            const beforeArticles = new Set();
            // Store URLs of existing articles
            Array.from(this.items.values()).forEach(item => beforeArticles.add(item.link));

            // Fix: Use Math.floor instead of Date.now() to ensure we get a regular 13-digit timestamp
            const refreshTimestamp = Math.floor(Date.now());
            let newArticleCount = 0;

            for (const feed of feeds) {
                try {
                    this._log(`Fetching feed: ${feed.name} from URL: ${feed.url}`);
                    const result = await this.httpRequest('GET', feed.url);
                    this._log(`Got response for ${feed.name}, length: ${result ? result.length : 0} bytes`);
                    this.processFeedResult(feed, result);
                    // Avoid frequent full list rebuilds during refresh
                    this._scheduleThrottledDisplay();
                    // Yield to main loop between feeds to keep UI responsive
                    await new Promise(resolve => {
                        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                            resolve();
                            return GLib.SOURCE_REMOVE;
                        });
                    });
                } catch (error) {
                    this._log(`Error processing feed ${feed.name}: ${error}`, true);
                }
            }

            // Count new articles by comparing before and after URLs
            const afterArticles = new Set();
            Array.from(this.items.values()).forEach(item => afterArticles.add(item.link));

            // Count items that exist after but didn't exist before
            afterArticles.forEach(url => {
                if (!beforeArticles.has(url)) {
                    newArticleCount++;
                }
            });

            this._log(`Found ${newArticleCount} new articles in this refresh`);

            // Record all refresh events, even if no new articles were found
            if (this.refreshDb) {
                this._log(`Recording refresh event with ${newArticleCount} new articles`);
                // Debug timestamp before recording
                this._log(`Debug - Current timestamp: ${new Date().toISOString()}, millis: ${refreshTimestamp}, human: ${new Date(refreshTimestamp).toLocaleString()}`);

                this.refreshDb.recordRefresh(
                    refreshTimestamp,
                    newArticleCount,
                    feeds.length
                );

                // Reload refresh history
                this.refreshHistory = await this.refreshDb.getRefreshHistory();
                this._log(`Refresh history now contains ${this.refreshHistory.length} events`);
            }

            this.lastRefresh = new Date(refreshTimestamp);
            // Final UI update at the end of collection
            this._cancelThrottledDisplay();
            this.displayItems();
        } catch (error) {
            this._log('Error in collectFeeds: ' + error, true);
            throw error;
        } finally {
            this._isRefreshing = false;
        }
    }

    // Simple synchronous hash function for generating keys
    _simpleHash(str) {
        let hash = 0;
        if (typeof str !== 'string') return '0';
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString();
    }

    processFeedResult(feed, result) {
        try {
            if (!result) {
                this._log(`No result data for feed: ${feed.name}`);
                return;
            }

            this._log(`Parsing XML for feed: ${feed.name}`);
            let resJSON;
            try {
                resJSON = fromXML(result);
            } catch (e) {
                this._log(`fromXML parsing failed for ${feed.name}: ${e}`, true);
                return;
            }

            if (!resJSON) {
                this._log(`fromXML returned null/undefined for feed: ${feed.name}`);
                return;
            }

            if (!resJSON.rss) {
                this._log(`No RSS element in feed: ${feed.name}, keys: ${Object.keys(resJSON).join(', ')}`);
                return;
            }

            if (!resJSON.rss.channel) {
                this._log(`No channel element in feed: ${feed.name}, keys: ${Object.keys(resJSON.rss).join(', ')}`);
                return;
            }

            if (!resJSON.rss.channel.item) {
                this._log(`No items in feed: ${feed.name}`);
                return;
            }

            const items = Array.isArray(resJSON.rss.channel.item)
                ? resJSON.rss.channel.item
                : [resJSON.rss.channel.item];

            this._log(`Processing ${items.length} items from feed: ${feed.name}`);

            // Get the latest refresh event timestamp
            const latestRefresh = this.refreshHistory[0]?.timestamp || Date.now();

            // Process items in small chunks to keep UI responsive
            const processChunk = (startIndex) => {
                const CHUNK_SIZE = 10;
                for (let i = startIndex; i < Math.min(items.length, startIndex + CHUNK_SIZE); i++) {
                    const item = items[i];
                    try {
                        // Skip if no link (we need it for key generation)
                        if (!item.link) return;

                        const catStr = this.getCategoryString(item);
                        const timestamp = new Date(item.pubDate);
                        if (isNaN(timestamp.getTime())) return;

                        // Generate map key using simple hash
                        const key = this._simpleHash(item.link);

                        // Check if this item already exists as a favorite
                        const existingItem = Array.from(this.items.values())
                            .find(existing =>
                                existing.isFavorite &&
                                existing.link === item.link
                            );

                        // Skip if item exists as a favorite
                        if (existingItem) return;

                        // Check if the item already exists in our map
                        const existingNonFavorite = this.items.get(key);

                        // Add new item or update existing one
                        this.items.set(key, {
                            channel: feed.name,
                            timestamp: timestamp,
                            pubDate: item.pubDate,
                            title: item.title || 'No Title',
                            link: item.link,
                            category: catStr,
                            description: item.description || '',
                            labelColor: feed.labelcolor || '#ffffff',
                            // Preserve existing aiResponse if it exists
                            aiResponse: existingNonFavorite?.aiResponse || '',
                            isFavorite: (() => {
                                if (!this.favoriteKeys || typeof this.favoriteKeys.has !== 'function') {
                                    return false;
                                }
                                const isFav = this.favoriteKeys.has(item.link);
                                if (isFav) {
                                    this._log(`Item is favorite: ${item.title}`);
                                }
                                return isFav;
                            })(),
                            // Use the latest refresh event timestamp
                            key: key,
                            downloadTimestamp: latestRefresh
                        });
                    } catch (e) {
                        this._log('Error processing feed item: ' + e, true);
                    }
                }
                // After each chunk, request a throttled UI update so content appears progressively
                this._scheduleThrottledDisplay();

                // Schedule next chunk if needed
                if (startIndex + CHUNK_SIZE < items.length) {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 0, () => {
                        processChunk(startIndex + CHUNK_SIZE);
                        return GLib.SOURCE_REMOVE;
                    });
                }
            };
            processChunk(0);
        } catch (error) {
            this._log('Error in processFeedResult: ' + error, true);
            throw error;
        }
    }

    HTMLPartToTextPart(HTMLPart) {
        return HTMLPart
            .replace(/\n/ig, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style[^>]*>/ig, '')
            .replace(/<head[^>]*>[\s\S]*?<\/head[^>]*>/ig, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script[^>]*>/ig, '')
            .replace(/<\/\s*(?:p|div)>/ig, '\n\n')
            .replace(/<br[^>]*\/?>/ig, '\n')
            .replace(/<[^>]*>/ig, '')
            .replace('&nbsp;', ' ')
            .replace(/[^\S\r\n][^\S\r\n]+/ig, ' ')
            ;
    }

    getCategoryString(item) {
        if (typeof item.category === 'string') {
            return item.category.toString();
        }

        if (typeof item.category === 'object') {
            let catArr = Array.from(item.category);
            let arrText = catArr.map(elem =>
                typeof elem === 'string' ? elem : elem['#']
            );
            return arrText.join(' / ');
        }

        return '';
    }

    _formatedDate(pDate, withYear = true) {
        let retStr = '';
        if (withYear) {
            retStr += pDate.getFullYear().toString() + '-';
        }
        retStr += (pDate.getMonth() + 1).toString().padStart(2, '0') + '-' + pDate.getDate().toString().padStart(2, '0') + ' ' +
            pDate.getHours().toString().padStart(2, '0') + ':' + pDate.getMinutes().toString().padStart(2, '0');
        return retStr;
    }

    onClickedButton(selfObj, p2, uri) {
        Gio.app_info_launch_default_for_uri(uri, global.create_app_launch_context());
    }

    onClickedFavoriteButton(selfObj, p2, item, lineBox, favIcon) {
        try {
            // Toggle favorite status
            item.isFavorite = !item.isFavorite;

            if (item.isFavorite) {
                // Add to favorites
                this.favoritesDb.addFavorite(item);
                if (favIcon) {
                    favIcon.set_icon_name('starred-symbolic');
                }
            } else {
                // Remove from favorites
                this.favoritesDb.removeFavorite(item.link);
                if (favIcon) {
                    favIcon.set_icon_name('non-starred-symbolic');
                }
            }

            // Refresh display after toggling favorite
            this.displayItems();
        } catch (e) {
            log('Error toggling favorite:', e);
        }
    }

    onClickedSumButton(selfObj, p2, item, lineBox, sumIcon) {
        if (sumIcon) {
            sumIcon.set_icon_name('process-working-symbolic');
        }

        this._markItemAsRead(item, this.showReadStatusCheckbox ? null : null, null);
        this.summarizeUri(this.ai_dumptool, item, lineBox, sumIcon)
            .then(() => {
                if (sumIcon) {
                    sumIcon.set_icon_name('document-edit-symbolic');
                }
            })
            .catch(() => {
                if (sumIcon) {
                    sumIcon.set_icon_name('dialog-error-symbolic');
                }
            });
    }

    async summarizeUri(dumptool, item, lineBox, sumIcon) {
        try {
            const apiKey = await Secret.password_lookup_sync(this.STORE_SCHEMA, {}, null);
            if (!apiKey) {
                throw new Error('No API key found. Please set your API key in settings.');
            }

            // First get the full article content using dumptool
            const [success, stdout, stderr] = GLib.spawn_command_line_sync(
                `/usr/bin/timeout -k 10 10 /usr/bin/${dumptool} -dump '${item.link}' || echo 'ERROR: TIMEOUT'`
            );

            if (!success) {
                throw new Error(`Failed to get article content: ${stderr.toString()}`);
            }

            let articleContent =
                `${item.title}\n${this.HTMLPartToTextPart(item.description)}\n` +
                ByteArray.toString(stdout);

            // Limit content length to prevent API issues
            if (articleContent.length > 16384) {
                articleContent = articleContent.substring(0, 16384);
            }

            const requestBody = {
                model: this.ai_use_standard_model ? this.ai_model : this.ai_custom_model,
                messages: [
                    {
                        role: "system",
                        content: this.ai_systemprompt
                    },
                    {
                        role: "user",
                        content: articleContent
                    }
                ],
                temperature: this.temperature
            };

            const response = await this.httpRequest(
                'POST',
                this.ai_url,
                [
                    ['Content-Type', 'application/json'],
                    ['Authorization', `Bearer ${apiKey}`]
                ],
                JSON.stringify(requestBody)
            );

            let jsonResponse;
            try {
                jsonResponse = JSON.parse(response);
                // Log the parsed JSON response for inspection if parsing is successful
                if (this.enableDebugLogs) {
                    log(`Parsed JSON Response: ${JSON.stringify(jsonResponse, null, 2)}`);
                }
            } catch (e) {
                if (this.enableDebugLogs) {
                    log(`ERROR: Failed to parse JSON response. Raw response: "${response}". Error: ${e.message}`);
                }
                throw new Error('Failed to parse API response into JSON.'); // Re-throw a clearer error
            }

            // Now, check the structure of the *successfully parsed* jsonResponse
            if (!jsonResponse || !jsonResponse.choices || !Array.isArray(jsonResponse.choices) || jsonResponse.choices.length === 0) {
                if (this.enableDebugLogs) {
                    log(`ERROR: Invalid API response structure. Missing 'choices' or 'choices' is empty. Parsed response: ${JSON.stringify(jsonResponse, null, 2)}`);
                }
                throw new Error('Invalid API response: "choices" array is missing or empty.');
            }

            if (!jsonResponse.choices[0]) {
                if (this.enableDebugLogs) {
                    log(`ERROR: Invalid API response structure. First choice is missing. Parsed response: ${JSON.stringify(jsonResponse, null, 2)}`);
                }
                throw new Error('Invalid API response: First choice is missing.');
            }

            item.aiResponse = "";


            if (this.ai_add_description_to_summary) {
                item.aiResponse = this.HTMLPartToTextPart(item.description).replace(/\n/ig, ' ') + '\n----\n';
            }

            item.aiResponse += jsonResponse.choices[0].message.content;
            log('EEEEEEEEEEEEEEEE 4');

            this.displayItems();

            log('EEEEEEEEEEEEEEEE 5');

            if (sumIcon) {
                sumIcon.set_icon_name('document-edit-symbolic');
            }

        } catch (error) {
            log('Error in summarizeUri:', error);
            if (sumIcon) {
                sumIcon.set_icon_name('dialog-error-symbolic');
            }
            throw error;
        }
    }

    onClickedCopyButton(selfObj, p2, item, lineBox) {
        const message = item.channel + ' ' + item.category + ' @' + item.pubDate + '\n' +
            item.title + '\n' +
            '---------------------------\n' +
            item.description + '\n' +
            '---------------------------\n' +
            item.aiResponse + '\n' +
            '---------------------------\n' +
            'URL: ' + item.link + '\n'
            ;

        this.clipboard.set_text(St.ClipboardType.CLIPBOARD, message);
    }

    // Add method to load favorite articles
    async loadFavoriteArticles() {
        try {
            this._log('Starting loadFavoriteArticles...');
            // Query via AsyncDatabaseManager to avoid blocking UI
            const sql = `SELECT * FROM favorites ORDER BY timestamp DESC`;
            const rawResult = await this.favoritesDb.executeQuery(sql);
            if (!rawResult) {
                this._log('Error loading favorites: empty result', true);
                return;
            }
            this._log('Raw result length: ' + rawResult.length);
            this._log('Raw result preview: ' + rawResult.substring(0, 200));

            // Parse the result - it should be a JSON array
            let favorites = [];
            try {
                favorites = JSON.parse(rawResult);
                if (!Array.isArray(favorites)) {
                    this._log('Result is not an array, treating as empty');
                    favorites = [];
                }
            } catch (e) {
                this._log('Error parsing JSON result: ' + e, true);
                this._log('Raw result that failed to parse: ' + rawResult);
                favorites = [];
            }

            const now = Date.now(); // Current timestamp for favorites

            this._log(`Loading ${favorites.length} favorites from database`);
            this._log(`favoriteKeys size before: ${this.favoriteKeys?.size || 0}`);

            favorites.forEach(item => {
                // Debug: Log the item structure
                this._log('Favorite item fields: ' + JSON.stringify(Object.keys(item)));
                this._log('Favorite item channel: ' + (item.channel || 'MISSING'));

                // Use the same hash function as processFeedResult for consistent keys
                const key = this._simpleHash(item.link);

                // Derive channel name and color if not stored in DB
                const inferred = this._inferChannelFromLink(item.link);

                // Normalize timestamp; fall back to now if not present
                let tsMs = parseInt(item.timestamp);
                if (!tsMs || isNaN(tsMs)) tsMs = now;

                this.items.set(key, {
                    channel: item.channel || inferred.name,
                    timestamp: new Date(tsMs),
                    pubDate: item.pubDate || new Date(tsMs).toUTCString(),
                    title: item.title || '(no title)',
                    link: item.link,
                    category: item.category || '',
                    description: item.description || '',
                    labelColor: item.labelColor || inferred.color || '#ffffff',
                    aiResponse: item.aiResponse || '',
                    isFavorite: true,
                    downloadTimestamp: now,
                    key: key
                });

                // Add to favoriteKeys Set for consistency
                if (this.favoriteKeys && typeof this.favoriteKeys.add === 'function') {
                    this.favoriteKeys.add(item.link);
                    this._log(`Added to favoriteKeys: ${item.title}`);
                }
            });

            this._log(`favoriteKeys size after: ${this.favoriteKeys?.size || 0}`);
            this._log('loadFavoriteArticles completed');

            // Refresh display so favorites appear immediately
            if (this.uiUpdateManager) {
                this.uiUpdateManager.scheduleUpdate();
            } else {
                this.displayItems();
            }
        } catch (e) {
            this._log('Error in loadFavoriteArticles: ' + e, true);
        }
    }

    _inferChannelFromLink(link) {
        try {
            const urlObj = this._safeParseUrl(link);
            const host = urlObj?.hostname || null;

            if (Array.isArray(this.feeds) && host) {
                for (const feed of this.feeds) {
                    try {
                        const feedHost = this._safeParseUrl(feed?.url)?.hostname;
                        if (!feedHost) continue;
                        if (this._hostnameMatches(host, feedHost)) {
                            return { name: feed.name || host, color: feed.labelcolor || '#ffffff' };
                        }
                    } catch (_ignored) { }
                }
            }

            return { name: host || 'Unknown', color: '#ffffff' };
        } catch (_e) {
            return { name: 'Unknown', color: '#ffffff' };
        }
    }

    _safeParseUrl(raw) {
        try { return new URL(String(raw)); } catch (_e) { return null; }
    }


    _hostnameMatches(a, b) {
        if (!a || !b) return false;
        if (a === b) return true;
        return a.endsWith('.' + b) || b.endsWith('.' + a);
    }

    // Throttle expensive full list rebuilds to keep UI responsive while downloading
    _scheduleThrottledDisplay(intervalMs = 1000) {
        try {
            // During bulk refresh, avoid heavy rebuilds entirely; final update will happen at the end
            if (this._isRefreshing) return;
            if (this._uiUpdateTimer && this._uiUpdateTimer !== 0) return;
            this._uiUpdateTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, intervalMs, () => {
                this._uiUpdateTimer = 0;
                try { this.displayItems(); } catch (_e) { }
                return GLib.SOURCE_REMOVE;
            });
        } catch (_ignored) { }
    }

    _cancelThrottledDisplay() {
        try {
            if (this._uiUpdateTimer && this._uiUpdateTimer !== 0) {
                Mainloop.source_remove(this._uiUpdateTimer);
                this._uiUpdateTimer = 0;
            }
        } catch (_ignored) { this._uiUpdateTimer = 0; }
    }

    displayItems() {
        try {
            if (!this.dataBox) return;
            this.dataBox.destroy_all_children();

            // Ensure items is a Map
            if (!(this.items instanceof Map)) {
                this._log('Items is not a Map, reinitializing...', true);
                this.items = new Map();
            }

            // Calculate effective item limit
            let effectiveLimit = this.itemlimit || 50;
            if (this.loadFavoritesOnStartup) {
                const favoriteCount = Array.from(this.items.values())
                    .filter(item => item.isFavorite).length;
                effectiveLimit += favoriteCount;
            }

            // Get filtered and sorted items
            const sortedItems = Array.from(this.items.values())
                .filter(item => {
                    // Skip items with null or undefined titles
                    if (!item || !item.title) {
                        this._log('Skipping item with null/undefined title: ' + JSON.stringify(item), true);
                        return false;
                    }

                    if (this.showOnlyFavorites && !item.isFavorite) {
                        return false;
                    }
                    if (this.searchFilter) {
                        const searchText = this.searchFilter.toLowerCase();
                        return (item.title && item.title.toLowerCase().includes(searchText)) ||
                            (item.description && item.description.toLowerCase().includes(searchText));
                    }
                    return this.inGlobalFilter(this, item.title, item.category, item.description);
                })
                .sort((a, b) => {
                    // First sort by timestamp (newest first)
                    const timeDiff = b.timestamp.getTime() - a.timestamp.getTime();
                    if (timeDiff !== 0) return timeDiff;

                    // If timestamps are equal, sort by title (with null safety)
                    const titleA = a.title || '';
                    const titleB = b.title || '';
                    return titleA.localeCompare(titleB);
                })
                .slice(0, effectiveLimit);

            this._log(`Displaying ${sortedItems.length} items`);

            // Update header text
            if (this.headTitle) {
                const now = this.lastRefresh ?? new Date(0);
                const timeStr =
                    (now.getMonth() + 1).toString().padStart(2, '0') + '-' +
                    now.getDate().toString().padStart(2, '0') + ' ' +
                    now.getHours().toString().padStart(2, '0') + ':' +
                    now.getMinutes().toString().padStart(2, '0');
                let titleText = _('Last refresh: %s').format(timeStr);
                this.headTitle.set_text(titleText);
            }

            // Calculate channel width once
            const channelWidth = Math.min(Math.max(...sortedItems.map(item => (item.channel || 'Unknown').length)) * 8, 120);

            // Get refresh timestamps and sort them newest first
            // Debug: Check what refreshHistory actually is
            this._log(`RefreshHistory type: ${typeof this.refreshHistory}, isArray: ${Array.isArray(this.refreshHistory)}`);
            if (this.refreshHistory) {
                this._log(`RefreshHistory constructor: ${this.refreshHistory.constructor?.name}`);
                this._log(`RefreshHistory length: ${this.refreshHistory.length || 'N/A'}`);
            }

            // Ensure refreshHistory is an array (handle case where it might be a Promise)
            let refreshHistoryArray = [];
            if (Array.isArray(this.refreshHistory)) {
                refreshHistoryArray = this.refreshHistory;
            } else if (this.refreshHistory && typeof this.refreshHistory.then === 'function') {
                // It's a Promise, use empty array for now
                this._log('RefreshHistory is a Promise, using empty array');
                refreshHistoryArray = [];
            } else {
                this._log('RefreshHistory is not an array or Promise, using empty array');
                refreshHistoryArray = [];
            }
            const refreshEvents = refreshHistoryArray
                .filter(event => event && typeof event === 'object' && event.timestamp)
                .sort((a, b) => b.timestamp - a.timestamp);

            this._log(`Found ${refreshEvents.length} refresh timestamps`);
            this._log(`Showrefreshseparators is set to: ${this.showRefreshSeparators}`);

            if (refreshEvents.length > 0 && this.enableDebugLogs) {
                this._log(`First few refresh timestamps:`);
                for (let i = 0; i < Math.min(refreshEvents.length, 3); i++) {
                    this._log(`Refresh #${i}: ${new Date(refreshEvents[i].timestamp).toLocaleString()} (${refreshEvents[i].timestamp})`);
                }
            }

            if (sortedItems.length > 0 && this.enableDebugLogs) {
                this._log(`First few article timestamps:`);
                for (let i = 0; i < Math.min(sortedItems.length, 3); i++) {
                    this._log(`Article #${i}: ${new Date(sortedItems[i].timestamp.getTime()).toLocaleString()} (${sortedItems[i].timestamp.getTime()})`);
                }
            }

            if (this.showRefreshSeparators && refreshEvents.length > 0 && sortedItems.length > 0) {
                // Create a merged list of articles and refresh separators, properly sorted by time
                let mergedItems = [];
                let currentRefreshIndex = 0;
                let lastAddedTimestamp = Infinity; // Start with a high value to place newest items first

                // Process all articles and refreshes in timestamp order
                let articleIndex = 0;

                // Add all refresh events and articles to a single array, tagging each with its type
                refreshEvents.forEach(refreshEvent => {
                    mergedItems.push({
                        type: 'refresh',
                        timestamp: refreshEvent.timestamp,
                        data: refreshEvent
                    });
                });

                sortedItems.forEach((article, index) => {
                    mergedItems.push({
                        type: 'article',
                        timestamp: article.timestamp.getTime(),
                        data: article,
                        index: index  // Store original index for alternating row color
                    });
                });

                // Sort merged items by timestamp (newest first)
                mergedItems.sort((a, b) => b.timestamp - a.timestamp);

                this._log(`Created merged list with ${mergedItems.length} items (${sortedItems.length} articles, ${refreshEvents.length} refreshes)`);

                // Display merged items
                let displayedIndex = 0;
                let lastRefreshTime = null;
                let articlesAfterLastSeparator = 0;
                let pendingSeparator = null;

                mergedItems.forEach(item => {
                    if (item.type === 'article') {
                        // If we have a pending separator and this is the first article after it, show the separator
                        if (pendingSeparator && articlesAfterLastSeparator === 0) {
                            this._addRefreshSeparator(pendingSeparator);
                            pendingSeparator = null;
                        }

                        this._addArticleToDisplay(item.data, displayedIndex, channelWidth);
                        displayedIndex++;
                        articlesAfterLastSeparator++;
                    } else if (item.type === 'refresh') {
                        // Only show each refresh timestamp once
                        if (lastRefreshTime !== item.timestamp) {
                            // Don't show separator immediately - store it as pending
                            // We'll only show it when we encounter articles after it
                            pendingSeparator = item.data;
                            lastRefreshTime = item.timestamp;
                            articlesAfterLastSeparator = 0;
                        }
                    }
                });
            } else {
                // No separators, just display articles
                for (let i = 0; i < sortedItems.length; i++) {
                    this._addArticleToDisplay(sortedItems[i], i, channelWidth);
                }
                this._log(`Display complete. No separators added.`);
            }
        } catch (e) {
            this._log('Error in displayItems: ' + e.toString(), true);
        }
    }

    _addArticleToDisplay(item, index, channelWidth) {
        try {
            // Main row container
            const lineBox = new St.BoxLayout({
                vertical: false,
                style: `
                    background-color: ${index % 2 ?
                        `rgba(100,100,100, ${this.alternateRowTransparency})` :
                        `rgba(${this.backgroundColor.replace('rgb(', '').replace(')', '')}, ${this.transparency})`
                    };
                    padding: ${1 * this.articleSpacing}px;
                    margin: ${1 * this.articleSpacing}px 0;
                `
            });

            // Only add feed button if NOT hidden
            if (!this.enableFeedButton) {
                const feedBtn = new St.Button({
                    style: `
                        background-color: ${item.labelColor}; 
                        border-radius: 4px; 
                        margin: 0 5px; 
                        width: ${channelWidth}px;
                    `
                });
                feedBtn.set_child(new St.Label({ text: item.channel }));
                feedBtn.connect('clicked', () => item.link && Util.spawnCommandLine(`xdg-open "${item.link}"`));
                lineBox.add(feedBtn);
            }

            // Only add timestamp if NOT hidden
            if (!this.enableTimestamp) {
                const timeBox = new St.BoxLayout({
                    vertical: false,
                    style: 'width: 90px; margin: auto;'
                });

                const timeLabel = new St.Label({
                    text: this._formatedDate(item.timestamp, false),
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'font-size: 0.8em; text-align: center; margin: auto; width: 90px;'
                });

                timeBox.add(timeLabel);
                lineBox.add(timeBox);
            }

            // Action buttons
            const buttonBox = new St.BoxLayout({ style: 'spacing: 5px; padding: 0 5px;' });

            // Conditionally add read status checkbox button
            let readIcon = null;
            if (this.showReadStatusCheckbox) {
                // Debug: Check what readArticleIds actually is
                this._log(`readArticleIds type: ${typeof this.readArticleIds}, constructor: ${this.readArticleIds?.constructor?.name}`);
                this._log(`readArticleIds instanceof Set: ${this.readArticleIds instanceof Set}`);
                this._log(`readArticleIds.has is function: ${typeof this.readArticleIds?.has === 'function'}`);

                // Ensure readArticleIds is a Set
                if (!(this.readArticleIds instanceof Set)) {
                    this._log('readArticleIds is not a Set, reinitializing...', true);
                    this.readArticleIds = new Set();
                }

                const readStatusBtn = new St.Button({
                    style_class: 'yarr-button',
                    style: 'padding: 2px;'
                });

                // Set the appropriate icon based on read status
                // Checked = read, unchecked = unread (default is unchecked)
                let isRead = false;
                try {
                    if (this.readArticleIds && typeof this.readArticleIds.has === 'function') {
                        isRead = this.readArticleIds.has(item.key);
                    }
                } catch (e) {
                    this._log(`Error checking read status: ${e}`, true);
                    isRead = false;
                }

                readIcon = new St.Icon({
                    icon_name: isRead ? 'checkbox-checked-symbolic' : 'checkbox-symbolic',
                    icon_type: St.IconType.SYMBOLIC,
                    icon_size: 16,
                    style: isRead ? 'color: #4a90e2;' : 'color: #888888;'
                });

                readStatusBtn.set_child(readIcon);

                // Checkbox toggles read/unread
                readStatusBtn.connect('clicked', () => {
                    this._toggleReadStatus(item, readIcon, titleLabel);
                });

                buttonBox.add(readStatusBtn);
            }

            // Restore AI summary button
            if (this.ai_enablesummary && item.description) {
                const sumBtn = new St.Button({ style_class: 'yarr-button' });
                const sumIcon = new St.Icon({ icon_name: 'gtk-zoom-fit', icon_size: 16 });
                sumBtn.set_child(sumIcon);
                sumBtn.connect('clicked', async () => {
                    try {
                        // Update icon immediately to show processing
                        sumIcon.set_icon_name('process-working-symbolic');
                        sumIcon.queue_redraw();

                        // Mark as read if enabled
                        if (this.showReadStatusCheckbox) {
                            this._markItemAsRead(item, null, null);
                        }

                        // Start the summarization
                        await this.summarizeUri(this.ai_dumptool, item, lineBox, sumIcon);

                        // Update icon to show completion
                        sumIcon.set_icon_name('document-edit-symbolic');
                        sumIcon.queue_redraw();

                        this._log(`AI summary completed for: ${item.title}`);
                    } catch (e) {
                        this._log(`Error in AI summary: ${e}`, true);
                        // Show error icon
                        sumIcon.set_icon_name('dialog-error-symbolic');
                        sumIcon.queue_redraw();
                    }
                });
                buttonBox.add(sumBtn);
            }

            // Restore copy button
            if (this.enablecopy) {
                const copyBtn = new St.Button({ style_class: 'yarr-button' });
                const copyIcon = new St.Icon({ icon_name: 'edit-copy-symbolic', icon_size: 16 });
                copyBtn.set_child(copyIcon);
                copyBtn.connect('clicked', () => this.onClickedCopyButton(null, null, item, lineBox));
                buttonBox.add(copyBtn);
            }

            // Restore favorite button if enabled
            if (this.enableFavoriteFeature) {
                const favoriteBtn = new St.Button({
                    style_class: 'yarr-button',
                    style: 'padding: 2px;'
                });

                // Set the appropriate icon based on favorite status
                const favoriteIcon = new St.Icon({
                    icon_name: item.isFavorite ? 'starred' : 'non-starred',  // or 'star-new' for empty star
                    icon_type: St.IconType.SYMBOLIC,
                    icon_size: 16,
                    style: item.isFavorite ? 'color: #ffd700;' : 'color: #888888;' // gold color if favorite
                });

                favoriteBtn.set_child(favoriteIcon);

                favoriteBtn.connect('clicked', async () => {
                    try {
                        // Ensure favoriteKeys is a Set
                        if (!(this.favoriteKeys instanceof Set)) {
                            this._log('favoriteKeys is not a Set, reinitializing...', true);
                            this.favoriteKeys = new Set();
                        }

                        // Toggle favorite status
                        item.isFavorite = !item.isFavorite;

                        // Update database asynchronously
                        let success = false;
                        if (item.isFavorite) {
                            success = await this.favoritesDb.addFavorite(item);
                            if (success && this.favoriteKeys && typeof this.favoriteKeys.add === 'function') {
                                this.favoriteKeys.add(item.link);
                            }
                        } else {
                            success = await this.favoritesDb.removeFavorite(item.link);
                            if (success && this.favoriteKeys && typeof this.favoriteKeys.delete === 'function') {
                                this.favoriteKeys.delete(item.link);
                            }
                        }

                        // Update icon immediately for better UX
                        favoriteIcon.set_icon_name(item.isFavorite ? 'starred' : 'non-starred');
                        favoriteIcon.style = item.isFavorite ? 'color: #ffd700;' : 'color: #888888;';

                        // Force redraw of the icon
                        favoriteIcon.queue_redraw();

                        // Log status change
                        this._log(`${item.isFavorite ? 'Added to' : 'Removed from'} favorites: ${item.title || 'Untitled'}`);

                        if (!success) {
                            // Revert the toggle if database operation failed
                            item.isFavorite = !item.isFavorite;
                            favoriteIcon.set_icon_name(item.isFavorite ? 'starred' : 'non-starred');
                            favoriteIcon.style = item.isFavorite ? 'color: #ffd700;' : 'color: #888888;';
                            this._log('Database operation failed, reverted favorite status', true);
                        }
                    } catch (e) {
                        this._log(`Error toggling favorite: ${e}`, true);
                        // Revert the toggle on error
                        item.isFavorite = !item.isFavorite;
                        favoriteIcon.set_icon_name(item.isFavorite ? 'starred' : 'non-starred');
                        favoriteIcon.style = item.isFavorite ? 'color: #ffd700;' : 'color: #888888;';
                    }
                });

                buttonBox.add(favoriteBtn);
            }

            // Title and content panel
            let panelButton = new St.Button({
                style_class: 'yarr-panel-button',
                reactive: true,
                track_hover: true,
                x_expand: true,
                x_align: St.Align.START,
                style: `padding: ${3 * this.articleSpacing}px; border-radius: 4px;`
            });

            // Create subItemBox for title and AI response
            let subItemBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                x_align: St.Align.START,
                style: `spacing: ${2 * this.articleSpacing}px;`
            });

            // Title - apply read status styling
            let isRead = false;
            try {
                if (this.readArticleIds && typeof this.readArticleIds.has === 'function') {
                    isRead = this.readArticleIds.has(item.key);
                }
            } catch (e) {
                this._log(`Error checking read status for styling: ${e}`, true);
                isRead = false;
            }
            let baseFont = this.fontstyle.replace(/font-weight:[^;]+;/i, '');
            const titleLabel = new St.Label({
                text: item.title || 'Untitled',
                style: baseFont + (isRead ? ' font-weight: normal;' : ' font-weight: bold;') +
                    (isRead && this.dimReadTitles ? ` color: ${this.readTitleColor}; opacity: 0.85;` : ''),
                x_expand: true,
                x_align: St.Align.START
            });
            titleLabel.clutter_text.set_line_wrap(true);
            titleLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
            titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

            subItemBox.add(titleLabel);

            // AI response if exists
            if (item.aiResponse) {
                const aiLabel = new St.Label({
                    text: item.aiResponse,
                    style: this.ai_fontstyle,
                    x_expand: true,
                    x_align: St.Align.START
                });
                aiLabel.clutter_text.set_line_wrap(true);
                aiLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
                aiLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

                subItemBox.add(aiLabel);
            }

            panelButton.set_child(subItemBox);

            // Consolidated click handling:
            // - Single click: mark as read (idempotent)
            // - Double click: open tooltip
            panelButton.connect('button-press-event', (actor, event) => {
                const count = event.get_click_count();
                if (count === 2) {
                    this._showArticleTooltip(item, event);
                    return Clutter.EVENT_STOP;
                }
                if (count === 1) {
                    this._markItemAsRead(item, this.showReadStatusCheckbox ? readIcon : null, titleLabel);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            // Tooltip setup
            if (item.description) {
                let tooltip = new Tooltips.Tooltip(panelButton);
                tooltip.set_markup(`<b>${_escapeMarkup(item.title || 'Untitled')}</b>\n${_escapeMarkup(item.pubDate)}\n\n${_escapeMarkup(this.HTMLPartToTextPart(item.description))}`);
                tooltip._tooltip.style = `
                    text-align: left;
                    max-width: 600px;
                    padding: 12px;
                    font-size: 1.1em;
                    line-height: 1.4;
                    background-color: rgba(32, 32, 32, 0.85);
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 4px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                `;
                tooltip._tooltip.clutter_text.set_line_wrap(true);
                tooltip._tooltip.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
                tooltip._tooltip.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
                tooltip._tooltip.set_x_align(St.Align.START);
                tooltip._tooltip.clutter_text.set_x_align(Clutter.ActorAlign.START);
                // Disable automatic show on hover
                tooltip._showTimeout = null;
                tooltip.preventShow = true;
            }

            // Add elements to lineBox
            lineBox.add(buttonBox);
            lineBox.add(panelButton);

            this.dataBox.add(lineBox);
        } catch (e) {
            this._log('Error adding article to display: ' + e, true);
        }
    }

    // Method to show the tooltip for an article
    _showArticleTooltip(item, event) {
        try {
            // Hide any existing tooltip
            if (this._currentTooltip) {
                this._currentTooltip.destroy();
                this._currentTooltip = null;
            }

            // Create a custom floating tooltip
            let customTooltip = new St.BoxLayout({
                vertical: true,
                style: `
                    background-color: rgba(25, 25, 30, 0.95);
                    border: 1px solid rgba(100, 150, 255, 0.3);
                    border-radius: 8px;
                    padding: 15px;
                    font-size: 1.1em;
                    line-height: 1.5;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05);
                    max-width: 600px;
                    min-width: 350px;
                `
            });

            // --- NEW: Top bar with title, open button, and close button (right-aligned) ---
            let topBar = new St.BoxLayout({
                vertical: false,
                style: 'width: 100%; margin-bottom: 10px;'
            });
            let titleLabel = new St.Label({
                text: item.title || '',
                style: 'font-weight: bold; font-size: 1.1em; color: rgba(130, 200, 255, 1.0); text-shadow: 0 1px 2px rgba(0,0,0,0.8);'
            });
            let openBtn = new St.Button({
                style_class: 'yarr-button',
                style: 'padding: 4px 8px; margin-left: 8px; border-radius: 4px; background-color: rgba(80, 80, 100, 0.4);'
            });
            let openIcon = new St.Icon({
                icon_name: 'web-browser',
                icon_type: St.IconType.SYMBOLIC,
                icon_size: 16,
                style: 'color: rgba(100, 180, 255, 0.9); margin-right: 5px;'
            });
            let openBox = new St.BoxLayout({ vertical: false });
            openBox.add(openIcon);
            openBtn.set_child(openBox);
            openBtn.connect('clicked', () => {
                if (item.link) {
                    Gio.app_info_launch_default_for_uri(item.link, global.create_app_launch_context());
                }
                safeCloseTooltip();
            });
            let closeBtn = new St.Button({
                style_class: 'yarr-button',
                style: 'padding: 4px 8px; margin-left: 8px; border-radius: 4px; background-color: rgba(80, 80, 100, 0.4);'
            });
            let closeIcon = new St.Icon({
                icon_name: 'window-close-symbolic',
                icon_type: St.IconType.SYMBOLIC,
                icon_size: 16,
                style: 'color: rgba(230, 230, 230, 0.9);'
            });
            closeBtn.set_child(closeIcon);
            topBar.add(closeBtn);
            topBar.add(openBtn);
            topBar.add(titleLabel);
            topBar.add(new St.Bin({ x_expand: true }));
            customTooltip.add(topBar);
            // --- END NEW TOP BAR ---

            // Article meta info (date, channel, category)
            let pubDate = item.timestamp ? this._formatedDate(item.timestamp, true) : 'Unknown date';
            let channelInfo = item.channel || 'Unknown channel';
            let categoryInfo = item.category ? `Category: ${item.category}` : '';
            let metaInfo = new St.Label({
                text: `${channelInfo} • ${pubDate}${categoryInfo ? ' • ' + categoryInfo : ''}`,
                style: 'font-size: 0.9em; color: rgba(180, 200, 255, 0.8); margin-bottom: 8px;'
            });
            customTooltip.add(metaInfo);

            // --- SCROLLVIEW for content ---
            let scrollView = new St.ScrollView({
                style_class: 'tooltip-scrollview',
                x_fill: true,
                y_fill: true,
                y_align: St.Align.START
            });
            scrollView.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
            scrollView.style = 'max-height: 300px; min-width: 350px; min-height: 100px;';
            let contentBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_expand: true,
                style: 'padding: 5px; padding-right: 15px;'
            });
            let contentLabel = new St.Label({
                text: this.HTMLPartToTextPart(item.description) + '\n',
                style: 'color: rgba(230, 230, 230, 0.95); text-shadow: 0 1px 1px rgba(0,0,0,0.5);'
            });
            contentLabel.clutter_text.set_line_wrap(true);
            contentLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
            contentLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            contentBox.add(contentLabel);
            scrollView.add_actor(contentBox);
            customTooltip.add(scrollView);
            // --- END SCROLLVIEW ---

            // Remove shortcutsBox and shortcutsLabel (do not add)

            // Add to the UI
            Main.uiGroup.add_actor(customTooltip);
            this._currentTooltip = customTooltip;

            // Mark article as read when tooltip is shown (pass full item for consistent logic)
            this._markItemAsRead(item, this.showReadStatusCheckbox ? null : null, null);

            // --- Tooltip Positioning ---
            let [x, y] = event.get_coords();
            customTooltip.set_position(x + 20, y - 30);
            // --- END Tooltip Positioning ---

            // --- Signal Handler Management ---
            let outsideClickHandler = null;
            let keyHandlerId = null;
            let openBtnHandler, closeBtnHandler;
            let self = this;
            function safeCloseTooltip() {
                if (openBtnHandler) {
                    openBtn.disconnect(openBtnHandler);
                    openBtnHandler = null;
                }
                if (closeBtnHandler) {
                    closeBtn.disconnect(closeBtnHandler);
                    closeBtnHandler = null;
                }
                if (!customTooltip.destroyed) {
                    customTooltip.destroy();
                }
                self._currentTooltip = null;
                if (keyHandlerId !== null) {
                    global.stage.disconnect(keyHandlerId);
                    keyHandlerId = null;
                }
                if (outsideClickHandler !== null) {
                    global.stage.disconnect(outsideClickHandler);
                    outsideClickHandler = null;
                }
            }
            // Close button event
            closeBtnHandler = closeBtn.connect('clicked', () => {
                safeCloseTooltip();
            });
            // Open button event
            openBtnHandler = openBtn.connect('clicked', () => {
                if (item.link) {
                    Gio.app_info_launch_default_for_uri(item.link, global.create_app_launch_context());
                }
                safeCloseTooltip();
            });
            // Add a click handler to close when clicking outside
            outsideClickHandler = global.stage.connect('button-press-event', (actor, clickEvent) => {
                let [tooltipX, tooltipY] = customTooltip.get_transformed_position();
                let [clickX, clickY] = clickEvent.get_coords();
                let [tooltipWidth, tooltipHeight] = customTooltip.get_size();
                if (clickX < tooltipX || clickX > tooltipX + tooltipWidth ||
                    clickY < tooltipY || clickY > tooltipY + tooltipHeight) {
                    safeCloseTooltip();
                }
            });
            // Key handler
            keyHandlerId = global.stage.connect('captured-event', (actor, event) => {
                if (event.type() != Clutter.EventType.KEY_PRESS) {
                    return Clutter.EVENT_PROPAGATE;
                }
                let symbol = event.get_key_symbol();
                if (symbol === Clutter.KEY_Escape || symbol === Clutter.KEY_space) {
                    this._log(`Key press detected: ${symbol === Clutter.KEY_Escape ? 'ESC' : 'SPACE'}`);
                    safeCloseTooltip();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
            // Make tooltip focusable
            customTooltip.can_focus = true;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                global.stage.set_key_focus(customTooltip);
                return GLib.SOURCE_REMOVE;
            });
            // Add direct handler on tooltip as well for redundancy
            customTooltip.connect('key-press-event', (actor, keyEvent) => {
                this._log('Tooltip received key press event');
                let symbol = keyEvent.get_key_symbol();
                if (symbol === Clutter.KEY_Escape || symbol === Clutter.KEY_space) {
                    this._log(`Tooltip handler: Key press detected: ${symbol === Clutter.KEY_Escape ? 'ESC' : 'SPACE'}`);
                    safeCloseTooltip();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
            // Make the tooltip draggable
            this._makeDraggable(customTooltip);
            // Ensure we clean up event handlers when the tooltip is destroyed
            customTooltip.connect('destroy', () => {
                if (keyHandlerId !== null) {
                    global.stage.disconnect(keyHandlerId);
                    keyHandlerId = null;
                }
                if (outsideClickHandler !== null) {
                    global.stage.disconnect(outsideClickHandler);
                    outsideClickHandler = null;
                }
            });
            // Keep logic single-source; already marked above via _markItemAsRead(item, ...)
            return true;
        } catch (e) {
            this._log(`Error showing article tooltip: ${e}`, true);
            return false;
        }
    }

    _addRefreshSeparator(refreshEvent) {
        try {
            if (!refreshEvent) {
                this._log('[Yarr] Cannot add separator: refreshEvent is null or undefined', true);
                return;
            }

            this._log(`Creating separator for refresh at ${new Date(refreshEvent.timestamp).toLocaleString()}`);

            // Format the timestamp with full date including year
            const refreshDate = new Date(refreshEvent.timestamp);
            const dateStr =
                refreshDate.getFullYear() + '-' +
                (refreshDate.getMonth() + 1).toString().padStart(2, '0') + '-' +
                refreshDate.getDate().toString().padStart(2, '0');
            const timeStr =
                refreshDate.getHours().toString().padStart(2, '0') + ':' +
                refreshDate.getMinutes().toString().padStart(2, '0');

            // Create a simple separator with timestamp
            const separatorBox = new St.BoxLayout({
                vertical: false,
                x_expand: true,
                style: 'margin: 8px 0; padding: 4px 0;'
            });

            // Add a flexible space to push the timestamp to the right
            separatorBox.add(new St.Bin({ x_expand: true }));

            // Add the timestamp label with article count
            const timeLabel = new St.Label({
                text: `${dateStr} ${timeStr} (${refreshEvent.article_count} articles, ${refreshEvent.feeds_refreshed} feeds)`,
                style: 'font-size: 0.9em; color:rgba(196, 176, 176, 0.7); padding: 0 7px; font-weight: normal;'
            });

            separatorBox.add(timeLabel);

            // Add a horizontal line
            const lineLabel = new St.Label({
                text: '─'.repeat(20),
                style: 'font-size: 1em; color: rgba(196, 176, 176, 0.7);'
            });

            separatorBox.add(lineLabel);

            // Add a background to make it more visible
            separatorBox.style = `
                background-color: rgba(255, 255, 255, 0.05);
                border-radius: 4px;
                margin: 8px 0;
                padding: 4px 8px;
            `;

            this.dataBox.add(separatorBox);
            this._log('Separator added to display');
        } catch (e) {
            this._log('Error adding refresh separator: ' + e.toString(), true);
        }
    }

    on_chatgptapikey_stored(source, result) {
        Secret.password_store_finish(result);
    }

    onChatGPAPIKeySave() {
        try {
            this._log('Opening ChatGPT API key dialog...');

            // Use the existing createPasswordDialog from ui-components
            let dialog = createPasswordDialog(
                _("Enter your OpenAI API key:"),
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
                        this._showSimpleNotification(_("API key saved successfully!"));
                    }
                },
                this
            );

            // Actually open the dialog!
            dialog.open();

        } catch (e) {
            this._log('Error opening API key dialog: ' + e, true);
            this._showSimpleNotification(_("Error opening API key dialog. Please check the logs."));
        }
    }

    // Clean up old items to reduce memory pressure
    _cleanupOldItems() {
        try {
            if (this.items.size <= this.itemlimit) return;

            // Keep only the newest items up to itemlimit
            const sortedItems = Array.from(this.items.entries())
                .sort((a, b) => b[1].timestamp - a[1].timestamp);

            // Create a new map with only the items we want to keep
            this.items = new Map(sortedItems.slice(0, this.itemlimit));

            log(`Cleaned up items. Reduced to ${this.items.size} items.`);
        } catch (e) {
            log('Error in _cleanupOldItems:', e);
        }
    }

    // Add memory monitoring capability




    // Add this method to YarrDesklet
    _showAddArticleDialog() {
        let dialog = new ModalDialog.ModalDialog();
        let titleBin = new St.Bin({
            style_class: 'add-article-title',
            style: 'margin-bottom: 10px;'
        });
        let titleLabel = new St.Label({
            text: _('Add Article by URL'),
            style_class: 'add-article-title-text',
            style: 'font-size: 16px; font-weight: bold;'
        });
        titleBin.set_child(titleLabel);
        dialog.contentLayout.add(titleBin);
        let entry = new St.Entry({
            name: 'addArticleEntry',
            hint_text: _('Paste article or feed URL...'),
            track_hover: true,
            reactive: true,
            can_focus: true,
            style: 'width: 350px; min-width: 250px;'
        });
        dialog.contentLayout.add(entry);
        entry.clutter_text.connect('key-press-event', (actor, event) => {
            let symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                let url = entry.get_text();
                if (url) {
                    dialog.close();
                    this._addArticleFromUrl(url);
                }
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        dialog.setButtons([
            {
                label: _('Cancel'),
                action: () => dialog.close(),
                key: Clutter.KEY_Escape
            },
            {
                label: _('Add'),
                action: () => {
                    let url = entry.get_text();
                    if (url) {
                        dialog.close();
                        this._addArticleFromUrl(url);
                    }
                },
                key: Clutter.KEY_Return
            }
        ]);
        dialog.open();
        global.stage.set_key_focus(entry);
    }

    // Add this method to YarrDesklet
    async _addArticleFromUrl(url) {
        try {
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }
            // Fetch the content
            let content = await this.httpRequest('GET', url);
            if (!content) throw new Error(_('No content received from URL.'));
            // Try to parse as RSS/Atom
            let parsed = null;
            try {
                parsed = fromXML(content);
            } catch (e) {
                parsed = null;
            }
            let item = null;
            if (parsed && parsed.rss && parsed.rss.channel && parsed.rss.channel.item) {
                // RSS feed: use first item
                let feed = parsed.rss.channel;
                let feedItem = Array.isArray(feed.item) ? feed.item[0] : feed.item;
                item = {
                    channel: feed.title || _('Manual'),
                    timestamp: new Date(feedItem.pubDate || Date.now()),
                    pubDate: feedItem.pubDate || new Date().toISOString(),
                    title: feedItem.title || _('No Title'),
                    link: feedItem.link || url,
                    category: this.getCategoryString(feedItem),
                    description: feedItem.description || '',
                    labelColor: '#007bff',
                    aiResponse: '',
                };
            } else if (parsed && parsed.feed && parsed.feed.entry) {
                // Atom feed: use first entry
                let feed = parsed.feed;
                let entry = Array.isArray(feed.entry) ? feed.entry[0] : feed.entry;
                item = {
                    channel: feed.title || _('Manual'),
                    timestamp: new Date(entry.updated || entry.published || Date.now()),
                    pubDate: entry.updated || entry.published || new Date().toISOString(),
                    title: entry.title || _('No Title'),
                    link: (entry.link && entry.link['@href']) || url,
                    category: entry.category || '',
                    description: entry.summary || entry.content || '',
                    labelColor: '#007bff',
                    aiResponse: '',
                };
            } else {
                // Try to extract from HTML
                let titleMatch = content.match(/<title>(.*?)<\/title>/i);
                let title = titleMatch ? titleMatch[1].trim() : url;
                let descMatch = content.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
                let description = descMatch ? descMatch[1].trim() : '';
                item = {
                    channel: _('Manual'),
                    timestamp: new Date(),
                    pubDate: new Date().toISOString(),
                    title: title,
                    link: url,
                    category: '',
                    description: description,
                    labelColor: '#007bff',
                    aiResponse: '',
                };
            }
            if (!item.title) item.title = _('No Title');
            if (!item.timestamp || isNaN(item.timestamp.getTime())) item.timestamp = new Date();
            // Add to top of list
            this.additems(this, item);
            this._showSimpleNotification(_('Article added!'));
        } catch (e) {
            this._showSimpleNotification(_('Failed to add article: ') + e.message);
        }
    }

    // Add this method to YarrDesklet to make tooltips draggable
    _makeDraggable(actor) {
        actor._dragging = false;
        actor._dragStartX = 0;
        actor._dragStartY = 0;

        actor.connect('button-press-event', (clickedActor, event) => {
            if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;

            let [stageX, stageY] = event.get_coords();
            let [actorX, actorY] = clickedActor.get_transformed_position();

            clickedActor._dragging = true;
            clickedActor._dragStartX = stageX - actorX;
            clickedActor._dragStartY = stageY - actorY;

            return Clutter.EVENT_STOP;
        });

        actor.connect('motion-event', (motionActor, event) => {
            if (!motionActor._dragging) return Clutter.EVENT_PROPAGATE;

            let [stageX, stageY] = event.get_coords();
            motionActor.set_position(
                stageX - motionActor._dragStartX,
                stageY - motionActor._dragStartY
            );

            return Clutter.EVENT_STOP;
        });

        actor.connect('button-release-event', (releasedActor, event) => {
            releasedActor._dragging = false;
            return Clutter.EVENT_STOP;
        });
    }

    // Unified read toggle function
    _toggleReadStatus(item, readIcon, titleLabel) {
        try {
            // Ensure readArticleIds is a Set
            if (!(this.readArticleIds instanceof Set)) {
                this._log('readArticleIds is not a Set in _toggleReadStatus, reinitializing...', true);
                this.readArticleIds = new Set();
            }

            // Check current read status
            let isCurrentlyRead = false;
            try {
                if (this.readArticleIds && typeof this.readArticleIds.has === 'function') {
                    isCurrentlyRead = this.readArticleIds.has(item.key);
                }
            } catch (e) {
                this._log(`Error checking read status in toggle: ${e}`, true);
                isCurrentlyRead = false;
            }

            if (!isCurrentlyRead) {
                // Mark as read - add to read set
                this.readArticleIds.add(item.key);
                this.readStatusDb.markRead(item.key);
                if (readIcon) {
                    readIcon.set_icon_name('checkbox-checked-symbolic');
                    readIcon.style = 'color: #4a90e2;';
                }
                if (titleLabel && titleLabel.style) {
                    const baseFont = this.fontstyle.replace(/font-weight:[^;]+;/i, '');
                    let newStyle = baseFont + ' font-weight: normal;';
                    if (this.dimReadTitles) newStyle += ` color: ${this.readTitleColor}; opacity: 0.85;`;
                    titleLabel.style = newStyle;
                }
                this._log(`Marked article as read: ${item.title}`);
            } else {
                // Mark as unread - remove from read set
                this.readArticleIds.delete(item.key);
                this.readStatusDb.markUnread(item.key);
                if (readIcon) {
                    readIcon.set_icon_name('checkbox-symbolic');
                    readIcon.style = 'color: #888888;';
                }
                if (titleLabel && titleLabel.style) {
                    const baseFont = this.fontstyle.replace(/font-weight:[^;]+;/i, '');
                    titleLabel.style = baseFont + ' font-weight: bold;';
                }
                this._log(`Marked article as unread: ${item.title}`);
            }
        } catch (e) {
            this._log(`Error in _toggleReadStatus: ${e}`, true);
        }
    }

    // Mark as read (idempotent)
    _markItemAsRead(item, readIcon, titleLabel) {
        // Ensure readArticleIds is a Set
        if (!(this.readArticleIds instanceof Set)) {
            this._log('readArticleIds is not a Set in _markItemAsRead, reinitializing...', true);
            this.readArticleIds = new Set();
        }

        let isCurrentlyRead = false;
        try {
            if (this.readArticleIds && typeof this.readArticleIds.has === 'function') {
                isCurrentlyRead = this.readArticleIds.has(item.key);
            }
        } catch (e) {
            this._log(`Error checking read status in markAsRead: ${e}`, true);
            isCurrentlyRead = false;
        }

        if (!isCurrentlyRead) {
            this.readArticleIds.add(item.key);
            this.readStatusDb.markRead(item.key);
            if (readIcon) {
                readIcon.set_icon_name('checkbox-checked-symbolic');
                readIcon.style = 'color: #4a90e2;';
            }
            if (titleLabel && titleLabel.style) {
                const baseFont = this.fontstyle.replace(/font-weight:[^;]+;/i, '');
                let newStyle = baseFont + ' font-weight: normal;';
                if (this.dimReadTitles) newStyle += ` color: ${this.readTitleColor}; opacity: 0.85;`;
                titleLabel.style = newStyle;
            }
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

    _addCustomMenuItems() {
        // Get the default menu that was created by the parent
        let menu = this._menu;
        if (!menu) {
            // Try again on the next iteration quickly, but do not block UI
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._addCustomMenuItems();
                return GLib.SOURCE_REMOVE;
            });
            return;
        }

        // Check if we already added our items to prevent duplicates
        if (this._customMenuItemsAdded) return;
        this._customMenuItemsAdded = true;

        // Add a separator
        let separator = new PopupMenu.PopupSeparatorMenuItem();
        menu.addMenuItem(separator);

        // Add "Restart desklet" menu item
        let restartItem = new PopupMenu.PopupMenuItem(_("Restart desklet"));
        restartItem.addActor(new St.Icon({
            icon_name: 'view-refresh-symbolic',
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 16
        }));
        restartItem.connect('activate', () => {
            this._restartDesklet();
        });
        menu.addMenuItem(restartItem);
    }

    _restartDesklet() {
        try {
            // Set a global flag to indicate that a reload is happening
            global.YARR_IS_RELOADING = true;

            // Use a detached Python helper to reload the desklet code
            let deskletId = this._desklet_id || this.desklet_id;
            let helperPath = DESKLET_ROOT ? DESKLET_ROOT + '/restart_helper.py' : null;

            this._log("Reloading desklet code using helper: " + deskletId);

            // Execute the helper script asynchronously to avoid blocking the UI
            let command = `python3 "${helperPath}" "${UUID}" "${deskletId}"`;

            GLib.spawn_command_line_async(command);

            // Show a brief notification that reload is in progress
            this._showSimpleNotification(_("Reloading desklet code..."));

        } catch (e) {
            this._log('Error reloading desklet: ' + e, true);
        }
    }
}

// All classes are now defined inline

function main(metadata, desklet_id) {
    let desklet = new YarrDesklet(metadata, desklet_id);
    return desklet;
}

// --- Add helper for escaping markup ---
function _escapeMarkup(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


