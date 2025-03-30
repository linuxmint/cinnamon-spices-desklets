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
const Tooltips = imports.ui.tooltips
const ModalDialog = imports.ui.modalDialog;
const Secret = imports.gi.Secret;
const Pango = imports.gi.Pango;
const Clutter = imports.gi.Clutter;
const fromXML = require('./fromXML');
const ByteArray = imports.byteArray;

const UUID = "yarr@jtoberling";
const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID].path;

function _(str) {
    return Gettext.dgettext(UUID, str);
}

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

<<<<<<< HEAD
    // Add memory monitoring capability
    _memoryMetrics = null;

=======
>>>>>>> refs/remotes/origin/master
    constructor(metadata, desklet_id) {

        // Call parent constructor FIRST
        super(metadata, desklet_id);

        // translation init
        if (!DESKLET_ROOT.startsWith("/usr/share/")) {
            Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");
        }

        // Initialize Secret schema
        this.STORE_SCHEMA = new Secret.Schema("org.YarrDesklet.Schema", Secret.SchemaFlags.NONE, {});

        // Initialize basic properties
        this.refreshEnabled = true;
        this.delay = 300; // 5 minutes default
        this.items = new Map();
        this._updateInProgress = false;
        this.timerInProgress = 0;
        this._setUpdateTimerInProgress = false;

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

        // Initialize SignalManager
        this._signals = new SignalManager.SignalManager(null);

        // Load feeds from settings
        this.feeds = this.settings.getValue('feeds');

        // Initialize favorites database
        this.favoritesDb = new FavoritesDB();
        this.favoriteKeys = this.favoritesDb.getFavorites();

        // Load favorites if enabled
        if (this.loadFavoritesOnStartup) {
            this.loadFavoriteArticles();
        }

        // Build UI
        this.buildInitialDisplay();
        this.onDisplayChanged();
        this.onSettingsChanged();

        // Start initial feed collection
        this.setUpdateTimer(1);  // Start first update in 1 second

        // Force immediate feed collection after short delay
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this.collectFeeds();
            return GLib.SOURCE_REMOVE;
        });

        // Add cleanup handler
        this.actor.connect('destroy', () => this._onDestroy());

<<<<<<< HEAD
        // Add memory usage monitoring
        this._monitorMemoryUsage();
=======

>>>>>>> refs/remotes/origin/master
    }

    _onDestroy() {
        try {
            // Clear timers
            if (this.timerInProgress) {
                Mainloop.source_remove(this.timerInProgress);
            }
            if (this.updateDownloadedTimer) {
                Mainloop.source_remove(this.updateDownloadedTimer);
            }

            // Disconnect signals
            this._signals.disconnectAllSignals();

            // Clear items map
            this.items.clear();

            // Clean up menu
            if (this._menu) {
                this._menu.destroy();
            }

            // Clear HTTP session
            if (this.httpSession) {
                this.httpSession.abort();
                this.httpSession = null;
            }
        } catch (e) {
            global.log('Error in _onDestroy:', e);
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
        Gio.app_info_launch_default_for_uri("https://platform.openai.com/usage", global.create_app_launch_context());
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

                // Handle Soup v2 vs v3
                if (Soup.MAJOR_VERSION === 2) {
                    this.httpSession.queue_message(message, (session, response) => {
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
                                if (!bytes) {
                                    reject(new Error('No response data'));
                                    return;
                                }
                                const response = ByteArray.toString(bytes.get_data());
                                resolve(response);
                            } catch (error) {
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
                    global.log('Error removing existing timer:', e);
                }
                this.timerInProgress = 0;
            }

            // Set minimum delay to prevent excessive CPU usage
            const delay = Math.max(timeOut === 1 ? 1 : 300, this.delay);

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
                global.log('Failed to create timer');
            }

        } catch (e) {
            global.log('Error in setUpdateTimer:', e);
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
            // Execute feed collection
            this.collectFeeds()
                .catch(error => {
                    global.log('Error collecting feeds:', error);
                })
                .finally(() => {
                    this._updateInProgress = false;
                    global.log('Feed collection completed, scheduling next update');
                    // Schedule next update
                    if (this.refreshEnabled) {
                        this.setUpdateTimer(this.delay);
                    }
                });
        } catch (e) {
            global.log('Error in timer event:', e);
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

        // Immediately collect feeds
        this.collectFeeds()
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
                global.log('Error refreshing feeds:', error);
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
            style: 'min-height: 40px; background-color: rgba(0,0,0,0.2);'  // Make header visually distinct
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
            style: 'margin-top: 2px;'
        });

        // Create scrollview with proper policy
        let scrollBox = new St.ScrollView({
            style_class: 'yarr-scrollbox',
            x_fill: true,
            y_fill: true,
            x_expand: true,
            y_expand: true
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
                isFavorite: false  // default favorite status
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
                global.log('Error in additems:', e);
            });

        } catch (e) {
            global.log('Error in additems:', e);
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
            const feeds = [...this.feeds].filter(f => f?.active && f?.url?.length);
            if (!feeds?.length) return;

            global.log(`Collecting ${feeds.length} feeds`);

            for (const feed of feeds) {
                try {
                    global.log(`Fetching feed: ${feed.name} from URL: ${feed.url}`);
                    const result = await this.httpRequest('GET', feed.url);
                    global.log(`Got response for ${feed.name}, length: ${result ? result.length : 0} bytes`);
                    this.processFeedResult(feed, result);
                } catch (error) {
                    global.log(`Error processing feed ${feed.name}:`, error);
                }
            }

            this.lastRefresh = new Date();
            this.displayItems(this);
        } catch (error) {
            global.log('Error in collectFeeds:', error);
            throw error;
        }
    }

<<<<<<< HEAD
    processFeedResult(feed, result) {
        try {
            if (!result) {
                global.log(`No result data for feed: ${feed.name}`);
                return;
            }

            global.log(`Parsing XML for feed: ${feed.name}`);
            const resJSON = fromXML(result);

            if (!resJSON) {
                global.log(`fromXML returned null/undefined for feed: ${feed.name}`);
                return;
            }

            if (!resJSON.rss) {
                global.log(`No RSS element in feed: ${feed.name}, keys: ${Object.keys(resJSON).join(', ')}`);
                return;
            }

            if (!resJSON.rss.channel) {
                global.log(`No channel element in feed: ${feed.name}, keys: ${Object.keys(resJSON.rss).join(', ')}`);
                return;
            }

            if (!resJSON.rss.channel.item) {
                global.log(`No items in feed: ${feed.name}`);
                return;
            }

            const items = Array.isArray(resJSON.rss.channel.item)
                ? resJSON.rss.channel.item
                : [resJSON.rss.channel.item];

            global.log(`Processing ${items.length} items from feed: ${feed.name}`);

            // Continue with the rest as before
            items.forEach(item => {
                try {
                    // Skip if no link (we need it for SHA256)
                    if (!item.link) return;

                    const catStr = this.getCategoryString(item);
                    const timestamp = new Date(item.pubDate);
                    if (isNaN(timestamp.getTime())) return;

                    // Calculate SHA256 of URL
                    const id = this.favoritesDb._calculateSHA256(item.link);
                    if (!id) return;

                    // Generate map key using SHA256
                    const key = `${id}`;

                    // Check if this item already exists as a favorite
                    const existingItem = Array.from(this.items.values())
                        .find(existing =>
                            existing.isFavorite &&
                            this.favoritesDb._calculateSHA256(existing.link) === id
                        );

                    // Skip if item exists as a favorite
                    if (existingItem) return;

                    // Add new item
                    this.items.set(key, {
                        channel: feed.name,
                        timestamp: timestamp,
                        pubDate: item.pubDate,
                        title: item.title || 'No Title',
                        link: item.link,
                        category: catStr,
                        description: item.description || '',
                        labelColor: feed.labelcolor || '#ffffff',
                        aiResponse: '',
                        isFavorite: this.favoriteKeys.has(item.link)
                    });
                } catch (e) {
                    global.log('Error processing feed item:', e);
                }
            });
        } catch (error) {
            global.log('Error in processFeedResult:', error);
            throw error;
        }
    }

=======
>>>>>>> refs/remotes/origin/master
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
        retStr += (pDate.getMonth() + 1).toString().padStart(2, '0') + '-' + pDate.getDate().toString().padStart(2, '0') + '\n' +
            pDate.getHours().toString().padStart(2, '0') + ':' + pDate.getMinutes().toString().padStart(2, '0');
        return retStr;
    }

    onClickedButton(selfObj, p2, uri) {
        Gio.app_info_launch_default_for_uri(uri, global.create_app_launch_context());
    }

<<<<<<< HEAD
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
            global.log('Error toggling favorite:', e);
        }
    }

=======
>>>>>>> refs/remotes/origin/master
    onClickedSumButton(selfObj, p2, item, lineBox, sumIcon) {
        if (sumIcon) {
            sumIcon.set_icon_name('process-working-symbolic');
        }

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

            const jsonResponse = JSON.parse(response);

            if (!jsonResponse?.choices?.[0]) {
                throw new Error('Invalid API response');
            }

            item.aiResponse = "";

            if (this.ai_add_description_to_summary) {
                item.aiResponse = this.HTMLPartToTextPart(item.description).replace(/\n/ig, ' ') + '\n----\n';
            }

            item.aiResponse += jsonResponse.choices[0].message.content;

            this.displayItems();

            if (sumIcon) {
                sumIcon.set_icon_name('document-edit-symbolic');
            }

        } catch (error) {
            global.log('Error in summarizeUri:', error);
            if (sumIcon) {
                sumIcon.set_icon_name('dialog-error-symbolic');
            }
            throw error;
        }
    }

    onClickedCopyButton(selfObj, p2, item, lineBox) {
<<<<<<< HEAD
=======

>>>>>>> refs/remotes/origin/master
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
<<<<<<< HEAD
    }

    // Add method to load favorite articles
    async loadFavoriteArticles() {
        try {
            const sql = `
                SELECT * FROM favorites 
                ORDER BY timestamp DESC
            `;

            const [success, stdout, stderr] = GLib.spawn_command_line_sync(
                `sqlite3 "${this.favoritesDb.dbFile}" "${sql}" -json`
            );

            if (!success) {
                global.log('Error loading favorites:', stderr.toString());
                return;
            }

            const favorites = JSON.parse(stdout.toString() || '[]');
            favorites.forEach(item => {
                // Calculate SHA256 of URL for consistent key
                const id = this.favoritesDb._calculateSHA256(item.link);
                if (!id) return;

                // Use SHA256 as key
                const key = `${id}`;

                this.items.set(key, {
                    channel: item.channel,
                    timestamp: new Date(parseInt(item.timestamp)),
                    pubDate: item.pubDate,
                    title: item.title,
                    link: item.link,
                    category: item.category,
                    description: item.description,
                    labelColor: item.labelColor,
                    aiResponse: item.aiResponse,
                    isFavorite: true
                });
            });
        } catch (e) {
            global.log('Error in loadFavoriteArticles:', e);
        }
    }
=======

    }

>>>>>>> refs/remotes/origin/master

    displayItems() {
        try {
            if (!this.dataBox) return;
            this.dataBox.destroy_all_children();

            // Calculate effective item limit
            let effectiveLimit = this.itemlimit || 50;
            if (this.loadFavoritesOnStartup) {
                // Count favorite items
                const favoriteCount = Array.from(this.items.values())
                    .filter(item => item.isFavorite).length;
                effectiveLimit += favoriteCount;
            }

            // Get filtered and sorted items
            const sortedItems = Array.from(this.items.values())
                .filter(item => {
                    // Apply favorite filter if enabled
                    if (this.showOnlyFavorites && !item.isFavorite) {
                        return false;
                    }

                    // Apply search filter
                    if (this.searchFilter) {
                        const searchText = this.searchFilter.toLowerCase();
                        return item.title.toLowerCase().includes(searchText) ||
                            item.description.toLowerCase().includes(searchText);
                    }
                    return this.inGlobalFilter(this, item.title, item.category, item.description);
                })
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, effectiveLimit);  // Use effectiveLimit instead of itemlimit

            // Update header text with additional info about favorites
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
            const channelWidth = Math.min(Math.max(...sortedItems.map(item => item.channel.length)) * 8, 120);

            // Create items
            sortedItems.forEach((item, i) => {
                // Main row container
                const lineBox = new St.BoxLayout({
                    vertical: false,
                    style: `
                        background-color: ${i % 2 ?
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
                        style: 'width: 50px; margin: auto;'
                    });

                    const timeLabel = new St.Label({
                        text: this._formatedDate(item.timestamp, false),
                        y_align: Clutter.ActorAlign.CENTER,
                        style: 'font-size: 0.8em; text-align: center; margin: auto;'
                    });

                    timeBox.add(timeLabel);
                    lineBox.add(timeBox);
                }

                // Action buttons
                const buttonBox = new St.BoxLayout({ style: 'spacing: 5px; padding: 0 5px;' });

                if (this.ai_enablesummary && item.description) {
                    const sumBtn = new St.Button({ style_class: 'yarr-button' });
                    const sumIcon = new St.Icon({ icon_name: 'gtk-zoom-fit', icon_size: 16 });
                    sumBtn.set_child(sumIcon);
                    sumBtn.connect('clicked', () => this.onClickedSumButton(null, null, item, lineBox, sumIcon));
                    buttonBox.add(sumBtn);
                }

                if (this.enablecopy) {
                    const copyBtn = new St.Button({ style_class: 'yarr-button' });
                    const copyIcon = new St.Icon({ icon_name: 'edit-copy-symbolic', icon_size: 16 });
                    copyBtn.set_child(copyIcon);
                    copyBtn.connect('clicked', () => this.onClickedCopyButton(null, null, item, lineBox));
                    buttonBox.add(copyBtn);
                }

                // Add favorite button if enabled
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

                    favoriteBtn.connect('clicked', () => {
                        // Toggle favorite status
                        item.isFavorite = !item.isFavorite;

                        // Update database
                        if (item.isFavorite) {
                            if (this.favoritesDb.addFavorite(item)) {
                                this.favoriteKeys.add(item.link);  // Use URL instead of key
                            }
                        } else {
                            if (this.favoritesDb.removeFavorite(item.link)) {  // Use URL instead of key
                                this.favoriteKeys.delete(item.link);
                            }
                        }

                        // Update icon
                        favoriteIcon.set_icon_name(item.isFavorite ? 'starred' : 'non-starred');
                        favoriteIcon.style = item.isFavorite ? 'color: #ffd700;' : 'color: #888888;';

                        // Log status change
                        global.log(`${item.isFavorite ? 'Added to' : 'Removed from'} favorites: ${item.title}`);
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

                // Title
                const titleLabel = new St.Label({
                    text: item.title,
                    style: this.fontstyle,
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

                // Tooltip setup
                if (item.description) {
                    let tooltip = new Tooltips.Tooltip(panelButton);
                    tooltip.set_markup(`<b>${item.title}</b>\n${item.pubDate}\n\n${this.HTMLPartToTextPart(item.description)}`);
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
                }

                // Add elements to lineBox
                lineBox.add(buttonBox);
                lineBox.add(panelButton);

                this.dataBox.add(lineBox);
            });

        } catch (e) {
            global.log('Error in displayItems:', e.toString());
        }
    }

<<<<<<< HEAD
=======
    formatTextWrap(text, maxLineLength) {
        const words = text.replace(/[\r\n]+/g, ' ').split(' ');
        let lineLength = 0;

        // use functional reduce, instead of for loop
        return words.reduce((result, word) => {
            if (lineLength + word.length >= maxLineLength) {
                lineLength = word.length;
                return result + `\n${word}`; // don't add spaces upfront
            } else {
                lineLength += word.length + (result ? 1 : 0);
                return result ? result + ` ${word}` : `${word}`; // add space only when needed
            }
        }, '');
    }

    // Resource monitoring functions
    _updateResourceMetrics() {
        const now = Date.now();

        // Track update frequency
        if (this._resourceUsage.lastUpdate) {
            const updateInterval = now - this._resourceUsage.lastUpdate;
            this._resourceUsage.updateIntervals =
                this._resourceUsage.updateIntervals || [];
            this._resourceUsage.updateIntervals.push(updateInterval);

            // Keep only last 10 intervals
            if (this._resourceUsage.updateIntervals.length > 10) {
                this._resourceUsage.updateIntervals.shift();
            }
        }

        this._resourceUsage.lastUpdate = now;
        this._resourceUsage.updateCount++;

        // Calculate adaptive refresh interval
        if (this._resourceUsage.updateIntervals?.length > 5) {
            const avgInterval = this._resourceUsage.updateIntervals.reduce((a, b) => a + b, 0) /
                this._resourceUsage.updateIntervals.length;
            this._adaptiveRefresh.currentDelay = Math.max(
                this._adaptiveRefresh.minDelay,
                Math.min(this._adaptiveRefresh.maxDelay, Math.floor(avgInterval / 1000))
            );
        }
    }

    // Error handling functions
    _handleError(error, context = '') {
        this._resourceUsage.errorCount++;

        // Track error types
        this._resourceUsage.errors = this._resourceUsage.errors || {};
        const errorType = error.name || 'UnknownError';
        this._resourceUsage.errors[errorType] =
            (this._resourceUsage.errors[errorType] || 0) + 1;

        global.log(`YarrDesklet Error [${context}]:`, error);

        // Adaptive error handling
        if (this._resourceUsage.errorCount > 5) {
            this._adaptiveRefresh.currentDelay = Math.min(
                this._adaptiveRefresh.currentDelay * 1.5,
                this._adaptiveRefresh.maxDelay
            );
            this._resourceUsage.errorCount = 0;
        }
    }

    processFeedResult(feed, result) {
        try {
            if (!result) return;
            const resJSON = fromXML(result);
            if (!resJSON?.rss?.channel?.item) return;

            const items = Array.isArray(resJSON.rss.channel.item)
                ? resJSON.rss.channel.item
                : [resJSON.rss.channel.item];

            items.forEach(item => {
                try {
                    // Skip if no link (we need it for SHA256)
                    if (!item.link) return;

                    const catStr = this.getCategoryString(item);
                    const timestamp = new Date(item.pubDate);
                    if (isNaN(timestamp.getTime())) return;

                    // Calculate SHA256 of URL
                    const id = this.favoritesDb._calculateSHA256(item.link);
                    if (!id) return;

                    // Generate map key using SHA256
                    const key = `${id}`;

                    // Check if this item already exists as a favorite
                    const existingItem = Array.from(this.items.values())
                        .find(existing =>
                            existing.isFavorite &&
                            this.favoritesDb._calculateSHA256(existing.link) === id
                        );

                    // Skip if item exists as a favorite
                    if (existingItem) return;

                    // Add new item
                    this.items.set(key, {
                        channel: feed.name,
                        timestamp: timestamp,
                        pubDate: item.pubDate,
                        title: item.title || 'No Title',
                        link: item.link,
                        category: catStr,
                        description: item.description || '',
                        labelColor: feed.labelcolor || '#ffffff',
                        aiResponse: '',
                        isFavorite: this.favoriteKeys.has(item.link)
                    });
                } catch (e) {
                    global.log('Error processing feed item:', e);
                }
            });
        } catch (error) {
            global.log('Error in processFeedResult:', error);
            throw error;
        }
    }

>>>>>>> refs/remotes/origin/master
    on_chatgptapikey_stored(source, result) {
        Secret.password_store_finish(result);
    }

    onChatGPAPIKeySave() {
        let dialog = new PasswordDialog(
            _("'%s' settings..\nPlease enter ChatGPT API key:").format(this._(this._meta.name)),
            (password) => {
                Secret.password_store(
                    this.STORE_SCHEMA,
                    {},
                    Secret.COLLECTION_DEFAULT,
                    "Yarr_ChatGPTApiKey",
                    password,
                    null,
                    this.on_chatgptapikey_stored
                );
            },
            this
        );
        dialog.open();
    }

<<<<<<< HEAD
    // Clean up old items to reduce memory pressure
    _cleanupOldItems() {
        try {
            if (this.items.size <= this.itemlimit) return;

            // Keep only the newest items up to itemlimit
            const sortedItems = Array.from(this.items.entries())
                .sort((a, b) => b[1].timestamp - a[1].timestamp);

            // Create a new map with only the items we want to keep
            this.items = new Map(sortedItems.slice(0, this.itemlimit));

            global.log(`Cleaned up items. Reduced to ${this.items.size} items.`);
        } catch (e) {
            global.log('Error in _cleanupOldItems:', e);
        }
    }

    // Add memory monitoring capability
    _monitorMemoryUsage() {
        try {
            // Check if we can access memory usage
            const memInfoPath = '/proc/self/statm';
            const memInfoExists = GLib.file_test(memInfoPath, GLib.FileTest.EXISTS);

            if (!memInfoExists) {
                global.log('Cannot monitor memory usage: ' + memInfoPath + ' not available');
                return;
            }

            // Read memory information
            const [success, contents] = GLib.file_get_contents(memInfoPath);
            if (!success) {
                global.log('Failed to read memory information');
                return;
            }

            // Parse memory information - first number is pages of memory
            const memInfo = ByteArray.toString(contents).trim().split(' ');
            const totalPages = parseInt(memInfo[0]);
            const residentPages = parseInt(memInfo[1]);

            // Page size is typically 4KB
            const pageSize = 4096;

            // Calculate memory usage in MB
            const totalMB = (totalPages * pageSize) / (1024 * 1024);
            const residentMB = (residentPages * pageSize) / (1024 * 1024);

            // Get item count stats
            const totalItems = this.items.size;
            const favoriteItems = Array.from(this.items.values()).filter(item => item.isFavorite).length;

            // Log memory usage
            global.log(`Memory usage: Total=${totalMB.toFixed(2)}MB, Resident=${residentMB.toFixed(2)}MB, Items=${totalItems}, Favorites=${favoriteItems}`);

            // Store in memory metrics
            if (!this._memoryMetrics) {
                this._memoryMetrics = {
                    samples: [],
                    lastReport: Date.now()
                };
            }

            // Add sample and maintain a limited history
            this._memoryMetrics.samples.push({
                timestamp: Date.now(),
                total: totalMB,
                resident: residentMB,
                items: totalItems
            });

            // Keep only the last 10 samples
            if (this._memoryMetrics.samples.length > 10) {
                this._memoryMetrics.samples.shift();
            }

            // Check for memory growth
            this._checkMemoryGrowth();

        } catch (e) {
            global.log('Error monitoring memory usage:', e);
        }

        // Schedule next check after 5 minutes
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 300, () => {
            this._monitorMemoryUsage();
            return GLib.SOURCE_REMOVE;
        });
    }

    _checkMemoryGrowth() {
        if (!this._memoryMetrics || this._memoryMetrics.samples.length < 2) {
            return;
        }

        const samples = this._memoryMetrics.samples;
        const first = samples[0];
        const last = samples[samples.length - 1];

        // Calculate growth rate
        const timeDiffMinutes = (last.timestamp - first.timestamp) / (1000 * 60);
        if (timeDiffMinutes < 5) return; // Need at least 5 minutes of data

        const memoryGrowthMB = last.resident - first.resident;
        const growthRateMB = memoryGrowthMB / timeDiffMinutes;

        // Log significant growth
        if (growthRateMB > 0.1) {  // More than 0.1 MB per minute
            global.log(`WARNING: Memory growing at ${growthRateMB.toFixed(2)}MB/minute. Consider restarting desklet.`);

            // Attempt to reduce memory pressure
            this._cleanupOldItems();
        }
    }
}

// Add new class for database management
class FavoritesDB {
    constructor() {
        this.dbFile = GLib.build_filenamev([GLib.get_user_data_dir(), 'yarr_favorites.db']);
        this.initDatabase();
    }

    initDatabase() {
        try {
            // Create database with all fields
            const sql = `
                CREATE TABLE IF NOT EXISTS favorites (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    link TEXT,
                    channel TEXT,
                    category TEXT,
                    description TEXT,
                    aiResponse TEXT,
                    labelColor TEXT,
                    timestamp INTEGER,
                    pubDate TEXT,
                    created_at INTEGER DEFAULT (strftime('%s', 'now')),
                    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
                )
            `;

            const [success, stdout, stderr] = GLib.spawn_command_line_sync(
                `sqlite3 "${this.dbFile}" "${sql}"`
            );

            if (!success) {
                global.log('Error initializing database:', stderr.toString());
            }
        } catch (e) {
            global.log('Error in initDatabase:', e);
        }
    }

    // Helper function to calculate SHA256
    _calculateSHA256(str) {
        try {
            const bytes = new TextEncoder().encode(str);
            const checksum = GLib.Checksum.new(GLib.ChecksumType.SHA256);
            checksum.update(bytes);
            return checksum.get_string();
        } catch (e) {
            global.log('Error calculating SHA256:', e);
            return null;
        }
    }

    addFavorite(item) {
        try {
            // Calculate SHA256 of URL as primary key
            const id = this._calculateSHA256(item.link || '');
            if (!id) return false;

            const sql = `
                INSERT OR REPLACE INTO favorites (
                    id, title, link, channel, category, description, 
                    aiResponse, labelColor, timestamp, pubDate, updated_at
                ) VALUES (
                    '${this._escapeString(id)}',
                    '${this._escapeString(item.title)}',
                    '${this._escapeString(item.link)}',
                    '${this._escapeString(item.channel)}',
                    '${this._escapeString(item.category)}',
                    '${this._escapeString(item.description)}',
                    '${this._escapeString(item.aiResponse)}',
                    '${this._escapeString(item.labelColor)}',
                    ${item.timestamp.getTime()},
                    '${this._escapeString(item.pubDate)}',
                    strftime('%s', 'now')
                )
            `;

            const [success, stdout, stderr] = GLib.spawn_command_line_sync(
                `sqlite3 "${this.dbFile}" "${sql}"`
            );

            if (!success) {
                global.log('Error adding favorite:', stderr.toString());
            }
            return success;
        } catch (e) {
            global.log('Error in addFavorite:', e);
            return false;
        }
    }

    removeFavorite(url) {
        try {
            const id = this._calculateSHA256(url);
            if (!id) return false;

            const sql = `DELETE FROM favorites WHERE id = '${this._escapeString(id)}'`;

            const [success, stdout, stderr] = GLib.spawn_command_line_sync(
                `sqlite3 "${this.dbFile}" "${sql}"`
            );

            if (!success) {
                global.log('Error removing favorite:', stderr.toString());
            }
            return success;
        } catch (e) {
            global.log('Error in removeFavorite:', e);
            return false;
        }
    }

    getFavorites() {
        try {
            // Get all data from favorites
            const sql = "SELECT link FROM favorites";

            const [success, stdout, stderr] = GLib.spawn_command_line_sync(
                `sqlite3 "${this.dbFile}" "${sql}"`
            );

            if (!success) {
                global.log('Error getting favorites:', stderr.toString());
                return new Set();
            }

            const favorites = stdout.toString().split('\n').filter(Boolean);
            return new Set(favorites);
        } catch (e) {
            global.log('Error in getFavorites:', e);
            return new Set();
        }
    }

    _escapeString(str) {
        if (!str) return '';
        return str.replace(/'/g, "''");
    }
}

//--------------------------------------------

class PasswordDialog extends ModalDialog.ModalDialog {
    constructor(label, callback, parent) {
        super();  // This must be first!
        this.callback = callback;  // Store callback before using

        this.password = Secret.password_lookup_sync(parent.STORE_SCHEMA, {}, null);

        this.contentLayout.set_style('width: auto; max-width: 500px;'); // Match dialog width
        this.contentLayout.add(new St.Label({ text: label }));

        this.passwordBox = new St.BoxLayout({ vertical: false });
        this.entry = new St.Entry({ style: 'background: green; color:yellow; max-width: 400px;' });
        this.entry.clutter_text.set_password_char('\u25cf');
        this.entry.clutter_text.set_text(this.password);
        this.passwordBox.add(this.entry);
        this.contentLayout.add(this.passwordBox);
        this.setInitialKeyFocus(this.entry.clutter_text);

        this.setButtons([
            {
                label: "Save",
                action: () => {
                    const pwd = this.entry.get_text();
                    this.callback(pwd);
                    this.destroy();
                },
                key: Clutter.KEY_Return,
                focused: false
            },
            {
                label: "Show/Hide password",
                action: () => {
                    if (this.entry.clutter_text.get_password_char()) {
                        this.entry.clutter_text.set_password_char('');
                    } else {
                        this.entry.clutter_text.set_password_char('\u25cf');
                    }
                },
                focused: false
            },
            {
                label: "Cancel",
                action: () => {
                    this.destroy();
                },
                key: null,
                focused: false
            }
        ]);
    }
=======
    // Add new method to load favorite articles
    async loadFavoriteArticles() {
        try {
            const sql = `
                SELECT * FROM favorites 
                ORDER BY timestamp DESC
            `;

            const [success, stdout, stderr] = GLib.spawn_command_line_sync(
                `sqlite3 "${this.favoritesDb.dbFile}" "${sql}" -json`
            );

            if (!success) {
                global.log('Error loading favorites:', stderr.toString());
                return;
            }

            const favorites = JSON.parse(stdout.toString() || '[]');
            favorites.forEach(item => {
                // Calculate SHA256 of URL for consistent key
                const id = this.favoritesDb._calculateSHA256(item.link);
                if (!id) return;

                // Use SHA256 as key
                const key = `${id}`;

                this.items.set(key, {
                    channel: item.channel,
                    timestamp: new Date(parseInt(item.timestamp)),
                    pubDate: item.pubDate,
                    title: item.title,
                    link: item.link,
                    category: item.category,
                    description: item.description,
                    labelColor: item.labelColor,
                    aiResponse: item.aiResponse,
                    isFavorite: true
                });
            });
        } catch (e) {
            global.log('Error in loadFavoriteArticles:', e);
        }
    }
>>>>>>> refs/remotes/origin/master
}

function main(metadata, desklet_id) {
    let desklet = new YarrDesklet(metadata, desklet_id);
    return desklet;
}

<<<<<<< HEAD
=======

//--------------------------------------------

class PasswordDialog extends ModalDialog.ModalDialog {
    constructor(label, callback, parent) {
        super();  // This must be first!
        this.callback = callback;  // Store callback before using

        this.password = Secret.password_lookup_sync(parent.STORE_SCHEMA, {}, null);

        this.contentLayout.set_style('width: auto; max-width: 500px;'); // Match dialog width
        this.contentLayout.add(new St.Label({ text: label }));

        this.passwordBox = new St.BoxLayout({ vertical: false });
        this.entry = new St.Entry({ style: 'background: green; color:yellow; max-width: 400px;' });
        this.entry.clutter_text.set_password_char('\u25cf');
        this.entry.clutter_text.set_text(this.password);
        this.passwordBox.add(this.entry);
        this.contentLayout.add(this.passwordBox);
        this.setInitialKeyFocus(this.entry.clutter_text);

        this.setButtons([
            {
                label: "Save",
                action: () => {
                    const pwd = this.entry.get_text();
                    this.callback(pwd);
                    this.destroy();
                },
                key: Clutter.KEY_Return,
                focused: false
            },
            {
                label: "Show/Hide password",
                action: () => {
                    if (this.entry.clutter_text.get_password_char()) {
                        this.entry.clutter_text.set_password_char('');
                    } else {
                        this.entry.clutter_text.set_password_char('\u25cf');
                    }
                },
                focused: false
            },
            {
                label: "Cancel",
                action: () => {
                    this.destroy();
                },
                key: null,
                focused: false
            }
        ]);
    }
}

// Add new class for database management
class FavoritesDB {
    constructor() {
        this.dbFile = GLib.build_filenamev([GLib.get_user_data_dir(), 'yarr_favorites.db']);
        this.initDatabase();
    }

    initDatabase() {
        try {
            // Create database with all fields
            const sql = `
                CREATE TABLE IF NOT EXISTS favorites (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    link TEXT,
                    channel TEXT,
                    category TEXT,
                    description TEXT,
                    aiResponse TEXT,
                    labelColor TEXT,
                    timestamp INTEGER,
                    pubDate TEXT,
                    created_at INTEGER DEFAULT (strftime('%s', 'now')),
                    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
                )
            `;

            const [success, stdout, stderr] = GLib.spawn_command_line_sync(
                `sqlite3 "${this.dbFile}" "${sql}"`
            );

            if (!success) {
                global.log('Error initializing database:', stderr.toString());
            }
        } catch (e) {
            global.log('Error in initDatabase:', e);
        }
    }

    // Helper function to calculate SHA256
    _calculateSHA256(str) {
        try {
            const bytes = new TextEncoder().encode(str);
            const checksum = GLib.Checksum.new(GLib.ChecksumType.SHA256);
            checksum.update(bytes);
            return checksum.get_string();
        } catch (e) {
            global.log('Error calculating SHA256:', e);
            return null;
        }
    }

    addFavorite(item) {
        try {
            // Calculate SHA256 of URL as primary key
            const id = this._calculateSHA256(item.link || '');
            if (!id) return false;

            const sql = `
                INSERT OR REPLACE INTO favorites (
                    id, title, link, channel, category, description, 
                    aiResponse, labelColor, timestamp, pubDate, updated_at
                ) VALUES (
                    '${this._escapeString(id)}',
                    '${this._escapeString(item.title)}',
                    '${this._escapeString(item.link)}',
                    '${this._escapeString(item.channel)}',
                    '${this._escapeString(item.category)}',
                    '${this._escapeString(item.description)}',
                    '${this._escapeString(item.aiResponse)}',
                    '${this._escapeString(item.labelColor)}',
                    ${item.timestamp.getTime()},
                    '${this._escapeString(item.pubDate)}',
                    strftime('%s', 'now')
                )
            `;

            const [success, stdout, stderr] = GLib.spawn_command_line_sync(
                `sqlite3 "${this.dbFile}" "${sql}"`
            );

            if (!success) {
                global.log('Error adding favorite:', stderr.toString());
            }
            return success;
        } catch (e) {
            global.log('Error in addFavorite:', e);
            return false;
        }
    }

    removeFavorite(url) {
        try {
            const id = this._calculateSHA256(url);
            if (!id) return false;

            const sql = `DELETE FROM favorites WHERE id = '${this._escapeString(id)}'`;

            const [success, stdout, stderr] = GLib.spawn_command_line_sync(
                `sqlite3 "${this.dbFile}" "${sql}"`
            );

            if (!success) {
                global.log('Error removing favorite:', stderr.toString());
            }
            return success;
        } catch (e) {
            global.log('Error in removeFavorite:', e);
            return false;
        }
    }

    getFavorites() {
        try {
            // Get all data from favorites
            const sql = "SELECT link FROM favorites";

            const [success, stdout, stderr] = GLib.spawn_command_line_sync(
                `sqlite3 "${this.dbFile}" "${sql}"`
            );

            if (!success) {
                global.log('Error getting favorites:', stderr.toString());
                return new Set();
            }

            const favorites = stdout.toString().split('\n').filter(Boolean);
            return new Set(favorites);
        } catch (e) {
            global.log('Error in getFavorites:', e);
            return new Set();
        }
    }

    _escapeString(str) {
        if (!str) return '';
        return str.replace(/'/g, "''");
    }
}

>>>>>>> refs/remotes/origin/master
