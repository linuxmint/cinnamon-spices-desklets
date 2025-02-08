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
const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;
const Tooltips = imports.ui.tooltips
const ModalDialog = imports.ui.modalDialog;
const Secret = imports.gi.Secret;
const Pango = imports.gi.Pango;
const Clutter = imports.gi.Clutter;
const fromXML = require('./fromXML');
const ByteArray = imports.byteArray;
const Extension = imports.ui.extension;
const PopupMenu = imports.ui.popupMenu;
const DeskletManager = imports.ui.deskletManager;
const Main = imports.ui.main;

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

    constructor (metadata, desklet_id) {

            // Call parent constructor FIRST
            super(metadata, desklet_id);
            
            // translation init
        if(!DESKLET_ROOT.startsWith("/usr/share/")) {
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
        this.settings.bind('ai_dumptool', 'ai_dumptool');
        this.settings.bind('ai_url', 'ai_url');
        this.settings.bind('ai_systemprompt', 'ai_systemprompt');
        this.settings.bind('ai_use_standard_model', 'ai_use_standard_model');
        this.settings.bind('ai_model', 'ai_model');
        this.settings.bind('ai_custom_model', 'ai_custom_model');
        this.settings.bind("ai_font", "ai_font");
        this.settings.bind("ai_text-color", "ai_color");
        this.settings.bind("temperature", "temperature");
        
            // Initialize SignalManager
        this._signals = new SignalManager.SignalManager(null);

            // Load feeds from settings
            this.feeds = this.settings.getValue('feeds');

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
        this.onDisplayChanged();
        this.onSettingsChanged();
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
        ['Italic', 'Oblique'].forEach(function(item, i) {
            if (fontname.includes(item)) {
                fontstyle = item;
                fontname = fontname.replace(item, '');
            }
        });

        ['Bold', 'Light', 'Medium', 'Heavy'].forEach(function(item, i) {
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
        ['Italic', 'Oblique'].forEach(function(item, i) {
            if (ai_fontname.includes(item)) {
                ai_fontstyle = item;
                ai_fontname = ai_fontname.replace(item, '');
            }
        });

        ['Bold', 'Light', 'Medium', 'Heavy'].forEach(function(item, i) {
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

        this.mainBox.style = "background-color: rgba(" + (this.backgroundColor.replace('rgb(', '').replace(')', '')) + "," + this.transparency + ")";
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
        this.setUpdateTimer(3);
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
        
        this.mainBox = new St.BoxLayout({
            vertical: true,
            width: this.width,
            height: this.height,
            style_class: "desklet"
        });

        // Create header box with better styling
        this.headBox = new St.BoxLayout({ 
            vertical: false,
            style: 'padding: 4px; spacing: 6px;'
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

        // Replace search box with a simple button
        this.searchBox = new St.BoxLayout({ 
            vertical: false,
            style: 'spacing: 4px;'
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

        // Right side: Control buttons
        let rightBox = new St.BoxLayout({ 
            vertical: false,
            style: 'spacing: 6px;'
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

        // Add everything to header with flexible space
        this.headBox.add(leftBox);
        this.headBox.add(new St.Bin({ x_expand: true, x_fill: true }));
        this.headBox.add(rightBox);
        
        this.mainBox.add(this.headBox);

        // Create scrollview with proper policy
        let scrollBox = new St.ScrollView({
            style_class: 'yarr-scrollbox',
            x_fill: true,
            y_fill: true
        });
        scrollBox.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC);

        // Create container for feed items
        this.dataBox = new St.BoxLayout({
            vertical: true,
            style_class: 'yarr-feeds-box',
            y_expand: true,
            style: 'spacing: 2px;'  // Add spacing between items
        });

        scrollBox.add_actor(this.dataBox);
        this.mainBox.add(scrollBox, { expand: true });

        this.setContent(this.mainBox);
    }

    hashCode(str) {
         return str.split('').reduce((prevHash, currVal) =>
             (((prevHash << 5) - prevHash) + currVal.charCodeAt(0))|0, 0);
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
            
            // Add new item to map
            context.items.set(key, {
                ...itemobj,  // spread operator to clone
                key: key     // store key for later use
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

            for (const feed of feeds) {
                try {
                    const result = await this.httpRequest('GET', feed.url);
                    this.processFeedResult(feed, result);
                } catch (error) {
                    global.log(`Error processing feed ${feed.name}:`, error);
                }
            }
            
            this.displayItems(this);
        } catch (error) {
            global.log('Error in collectFeeds:', error);
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
    
    _formatedDate( pDate, withYear = true ) {
        let retStr = '';
        if (withYear) {
            retStr += pDate.getFullYear().toString() + '-';
        }
        retStr +=(pDate.getMonth()+1).toString().padStart(2,'0') + '-' + pDate.getDate().toString().padStart(2,'0') + ' ' +
                 pDate.getHours().toString().padStart(2,'0') + ':' +  pDate.getMinutes().toString().padStart(2, '0');
        return retStr;
    }
    
    onClickedButton(selfObj, p2, uri) {
        Gio.app_info_launch_default_for_uri(uri, global.create_app_launch_context());
    }
    
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
            const apiKey = await Secret.password_lookup_sync(this.STORE_SCHEMA,{}, null);
            if (!apiKey) {
                throw new Error('No API key found. Please set your API key in settings.');
            }
            
            const content = `${item.title}\n\n${this.HTMLPartToTextPart(item.description)}`;

            const requestBody = {
                model: this.ai_use_standard_model ? this.ai_model : this.ai_custom_model,
                messages: [
                    {
                        role: "system",
                        content: this.ai_systemprompt
                    },
                    {
                        role: "user",
                        content: content
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

            item.aiResponse = jsonResponse.choices[0].message.content;
            this.displayItems();

        } catch (error) {
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
    
    
    displayItems() {
        try {
            if (!this.dataBox) return;
            this.dataBox.destroy_all_children();

            // Get filtered and sorted items
            const sortedItems = Array.from(this.items.values())
                .filter(item => {
                    if (this.searchFilter) {
                        const searchText = this.searchFilter.toLowerCase();
                        return item.title.toLowerCase().includes(searchText) ||
                               item.description.toLowerCase().includes(searchText);
                    }
                    return this.inGlobalFilter(this, item.title, item.category, item.description);
                })
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, this.itemlimit || 50);

            // Calculate channel width once
            const channelWidth = Math.min(Math.max(...sortedItems.map(item => item.channel.length)) * 8, 120);

            // Create items
            sortedItems.forEach((item, i) => {
                // Main row container
                const lineBox = new St.BoxLayout({
                    vertical: false,  // Keep horizontal for main row
                    style: `
                        background-color: ${i % 2 ? 
                            `rgba(100,100,100, ${this.alternateRowTransparency})` : 
                            `rgba(${this.backgroundColor.replace('rgb(', '').replace(')', '')}, ${this.transparency})`
                        };
                        padding: 4px;
                    `
                });

                // 1. Feed button
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

                // 2. Time label
                const timeLabel = new St.Label({
                    text: this._formatedDate(item.timestamp, false),
                    style: 'font-size: 0.8em; width: 65px; text-align: center;'
                });

                const itemBoxLayout = new St.BoxLayout({ vertical: true });

                // 3. Action buttons
                const buttonBox = new St.BoxLayout({ style: 'spacing: 5px; padding: 0 5px;' });

                if (this.ai_enablesummary && item.description) {
                    const sumBtn = new St.Button({ style_class: 'yarr-button' });
                    const sumIcon = new St.Icon({ icon_name: 'gtk-zoom-fit', icon_size: 16 });
                    sumBtn.set_child(sumIcon);
                    sumBtn.connect('clicked', () => this.onClickedSumButton(null, null, item, itemBoxLayout, sumIcon));
                    buttonBox.add(sumBtn);
                }

                if (this.enablecopy) {
                    const copyBtn = new St.Button({ style_class: 'yarr-button' });
                    const copyIcon = new St.Icon({ icon_name: 'edit-copy-symbolic', icon_size: 16 });
                    copyBtn.set_child(copyIcon);
                    copyBtn.connect('clicked', () => this.onClickedCopyButton(null, null, item, itemBoxLayout));
                    buttonBox.add(copyBtn);
                }

                // Title and content panel
                let panelButton = new St.Button({
                    style_class: 'yarr-panel-button',
                    reactive: true,
                    track_hover: true,
                    x_expand: true,
                    x_align: St.Align.START,  // Force left alignment for the button
                    style: 'padding: 5px; border-radius: 4px;'
                });

                // Title
                const titleLabel = new St.Label({
                    text: item.title,
                    style: this.fontstyle,
                    x_expand: true,
                    x_align: St.Align.START  // Force left alignment for the label
                });
                titleLabel.clutter_text.set_line_wrap(true);
                titleLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
                titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

                let subItemBox = new St.BoxLayout({
                    vertical: true,
                    x_expand: true,
                    x_align: St.Align.START  // Force left alignment for the box
                });
                subItemBox.add(titleLabel);

                itemBoxLayout.add(subItemBox);
                panelButton.set_child(itemBoxLayout);

                // AI response if exists
                if (item.aiResponse) {
                    const aiLabel = new St.Label({  
                        text: item.aiResponse,
                        style: this.ai_fontstyle
                    });
                    aiLabel.clutter_text.set_line_wrap(true);
                    aiLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
                    aiLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
                    
                    itemBoxLayout.add(aiLabel);
                }

                // Add tooltip before adding to lineBox
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
                    tooltip._tooltip.set_x_align(St.Align.START);  // Force left alignment for tooltip
                    tooltip._tooltip.clutter_text.set_x_align(Clutter.ActorAlign.START);  // Force left alignment for tooltip text
                }

                // Add click handler to open the article
                panelButton.connect('clicked', () => {
                    if (item.link) {
                        Gio.app_info_launch_default_for_uri(item.link, global.create_app_launch_context());
                    }
                });

                // Add all elements to lineBox
                lineBox.add(feedBtn);
                lineBox.add(timeLabel);
                lineBox.add(buttonBox);
                lineBox.add(panelButton);

                this.dataBox.add(lineBox);
            });

        } catch (e) {
            global.log('Error in displayItems:', e.toString());
        }
    }

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
            const avgInterval = this._resourceUsage.updateIntervals.reduce((a,b) => a + b, 0) / 
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
                    const catStr = this.getCategoryString(item);
                    const timestamp = new Date(item.pubDate);
                    
                    if (isNaN(timestamp.getTime())) {
                        return;
                    }

                    const key = `${feed.name}-${item.link}-${timestamp.getTime()}`;
                    
                    this.items.set(key, {
                        channel: feed.name,
                        timestamp: timestamp,
                        pubDate: item.pubDate,
                        title: item.title || 'No Title',
                        link: item.link || '',
                        category: catStr,
                        description: item.description || '',
                        labelColor: feed.labelcolor || '#ffffff',
                        aiResponse: ''
                    });
                } catch (e) {}
            });
        } catch (error) {
            global.log('Error in processFeedResult:', error);
            throw error;
        }
    }

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
}

function main(metadata, desklet_id) {
    let desklet = new YarrDesklet(metadata, desklet_id);
    return desklet;
}


//--------------------------------------------

class PasswordDialog extends ModalDialog.ModalDialog {
    constructor(label, callback, parent) {
        super();  // This must be first!
        this.callback = callback;  // Store callback before using
        
        this.password = Secret.password_lookup_sync(parent.STORE_SCHEMA, {}, null);
        this.contentLayout.add(new St.Label({ text: label }));

        this.passwordBox = new St.BoxLayout({ vertical: false });
        this.entry = new St.Entry({ style: 'background: green; color:yellow;'});
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

