const St = imports.gi.St;
const Gtk = imports.gi.Gtk;
const Clutter = imports.gi.Clutter;
const Pango = imports.gi.Pango;
const Tooltips = imports.ui.tooltips;
const ModalDialog = imports.ui.modalDialog;
const Gio = imports.gi.Gio;
const Util = imports.misc.util;
const Main = imports.ui.main;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;

// Translation function
const UUID = "yarr@jtoberling";
function _(str) {
    return Gettext.dgettext(UUID, str);
}

const Logger = require('./logger');
const { Utilities } = require('./utilities');

/**
 * UI Display Module
 * Handles all UI rendering and display logic
 */

class UIDisplay {
    constructor(desklet) {
        this.desklet = desklet;
        this._currentTooltip = null;
        this.deskletPath = desklet.metadata.path;

        // Set up global click handler to hide tooltips when clicking outside
        this._setupGlobalTooltipHandler();
    }

    _setupGlobalTooltipHandler() {
        // REMOVED: Global stage event handlers that can interfere with desklet clicks
        // These handlers can cause click events to be captured by the wrong components
        Logger.debug('Global tooltip handlers disabled to prevent click conflicts');
    }

    buildInitialDisplay() {
        this.desklet.setHeader(_('Yarr'));

        // Main container
        this.desklet.mainBox = new St.BoxLayout({
            vertical: true,
            width: this.desklet.width,
            height: this.desklet.height,
            style_class: "desklet"
        });

        // Fixed height header container that won't be affected by scroll
        this.desklet.headerContainer = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            height: 40,
            style: 'min-height: 40px; background-color: rgba(0,0,0,0.2);',  // Make header visually distinct
            y_expand: false,  // Prevent header from expanding
            reactive: true    // Ensure header stays interactive
        });

        // Header content
        this.desklet.headBox = new St.BoxLayout({
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

        this.desklet.headTitle = new St.Label({
            text: _('Yarr - Loading feeds...'),
            style: 'font-weight: bold; padding-top: 3px; min-width: 300px;'
        });

        titleBox.add(titleIcon);
        titleBox.add(this.desklet.headTitle);
        leftBox.add(titleBox);

        // Add Article button
        this.desklet.addArticleButton = new St.Button({
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
        this.desklet.addArticleButton.set_child(addArticleButtonBox);
        this.desklet._signals.connect(this.desklet.addArticleButton, 'clicked', () => this.desklet._showAddArticleDialog());
        leftBox.add(this.desklet.addArticleButton);

        // Add favorite filter button before search if feature is enabled
        if (this.desklet.enableFavoriteFeature) {
            this.desklet.favoriteFilterBtn = new St.Button({
                style_class: 'yarr-button',
                style: 'padding: 4px; margin-left: 10px;'
            });

            this.desklet.favoriteFilterIcon = new St.Icon({
                icon_name: 'non-starred',
                icon_type: St.IconType.SYMBOLIC,
                icon_size: 16,
                style: 'color: #888888;'
            });

            this.desklet.favoriteFilterBtn.set_child(this.desklet.favoriteFilterIcon);

            this.desklet._signals.connect(this.desklet.favoriteFilterBtn, 'clicked', () => {
                // CRITICAL FIX: Safety check - prevent filter ON if no favorites exist
                if (!this.desklet.showOnlyFavorites && this.desklet.favoriteKeys.size === 0) {
                    Logger.debug(`CRITICAL FIX: Cannot enable favorites filter - no favorites exist`);
                    return; // Prevent enabling filter when no favorites
                }

                this.desklet.showOnlyFavorites = !this.desklet.showOnlyFavorites;
                Logger.debug(`Favorite filter toggled: showOnlyFavorites = ${this.desklet.showOnlyFavorites}`);

                // Update icon
                this.desklet.favoriteFilterIcon.set_icon_name(this.desklet.showOnlyFavorites ? 'starred' : 'non-starred');
                this.desklet.favoriteFilterIcon.style = this.desklet.showOnlyFavorites ? 'color: #ffd700;' : 'color: #888888;';

                // Debug favorites info
                const totalItems = this.desklet.items.size;
                const favoriteCount = Array.from(this.desklet.items.values()).filter(item => item.isFavorite).length;
                Logger.debug(`Favorites info: ${favoriteCount}/${totalItems} items are favorites, favoriteKeys size: ${this.desklet.favoriteKeys.size}`);

                // Show which items are favorites
                if (this.desklet.showOnlyFavorites) {
                    const favorites = Array.from(this.desklet.items.values()).filter(item => item.isFavorite);
                    Logger.debug(`Favorites filter ON - will show ${favorites.length} items:`);
                    favorites.forEach((item, index) => {
                        Logger.debug(`  ${index + 1}. "${item.title}" (isFavorite: ${item.isFavorite})`);
                    });
                } else {
                    Logger.debug(`Favorites filter OFF - will show all ${totalItems} items`);
                }

                // CRITICAL: Favorites filter NEEDS display refresh to actually show/hide articles
                // This is different from icon updates - filtering requires display refresh
                if (this.desklet.uiDisplay && typeof this.desklet.uiDisplay.displayItems === 'function') {
                    try {
                        this.desklet.uiDisplay.displayItems();
                        Logger.debug('Favorites filter applied with display refresh');
                    } catch (e) {
                        Logger.error('Error refreshing display for favorites filter: ' + e);
                    }
                }
            });

            leftBox.add(this.desklet.favoriteFilterBtn);
        }

        // Search box after title and favorite button
        this.desklet.searchBox = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 4px; margin-left: 1rem;'
        });

        this.desklet.searchButton = new St.Button({
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

        this.desklet.searchLabel = new St.Label({
            text: _(" Search..."),
            style: 'padding-left: 5px;'
        });

        searchButtonBox.add(searchIcon);
        searchButtonBox.add(this.desklet.searchLabel);
        this.desklet.searchButton.set_child(searchButtonBox);

        // Add clear search button
        this.desklet.clearSearchButton = new St.Button({
            style_class: 'clear-search-button',
            style: 'padding: 4px;',
            visible: false
        });

        let clearIcon = new St.Icon({
            icon_name: 'edit-clear',
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 16
        });
        this.desklet.clearSearchButton.set_child(clearIcon);

        // Connect search button to show modal dialog
        this.desklet._signals.connect(this.desklet.searchButton, 'clicked', () => {
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
            if (this.desklet.searchFilter) {
                entry.set_text(this.desklet.searchFilter);
            }

            dialog.contentLayout.add(entry);

            // Handle Enter key
            this.desklet._signals.connect(entry.clutter_text, 'key-press-event', (actor, event) => {
                let symbol = event.get_key_symbol();
                if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                    let text = entry.get_text();
                    if (text) {
                        this.desklet.searchFilter = text;
                        this.desklet.searchLabel.text = " " + text;
                        this.desklet.clearSearchButton.visible = true;
                        this.desklet.displayItems(this.desklet);
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
                            this.desklet.searchFilter = text;
                            this.desklet.searchLabel.text = " " + text;
                            this.desklet.clearSearchButton.visible = true;
                            this.desklet.displayItems(this.desklet);
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
        this.desklet._signals.connect(this.desklet.clearSearchButton, 'clicked', () => {
            this.desklet.searchFilter = '';
            this.desklet.searchLabel.text = _(" Search...");
            this.desklet.clearSearchButton.visible = false;
            this.desklet.displayItems(this.desklet);
        });

        this.desklet.searchBox.add(this.desklet.searchButton);
        this.desklet.searchBox.add(this.desklet.clearSearchButton);
        leftBox.add(this.desklet.searchBox);

        // Right side: Control buttons with right alignment
        let rightBox = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 6px;',
            x_align: St.Align.END
        });

        // Toggle refresh button with icon
        this.desklet.toggleRefresh = new St.Button({
            label: _("Disable refresh"),
            style_class: 'toggleButtonOn',
            style: 'padding: 4px 8px;'
        });

        // Refresh button with icon
        this.desklet.refreshButton = new St.Button({
            style_class: 'feedRefreshButton',
            style: 'padding: 4px;'
        });

        this.desklet.refreshIcon = new St.Icon({
            icon_name: 'reload',
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 16
        });

        this.desklet.refreshButton.set_child(this.desklet.refreshIcon);

        // Connect button events
        this.desklet._signals.connect(this.desklet.refreshButton, "clicked", () => this.desklet.onRefreshClicked());
        this.desklet._signals.connect(this.desklet.toggleRefresh, 'clicked', (...args) =>
            this.desklet.onClickedToggleRefresh(...args, this.desklet)
        );

        rightBox.add(this.desklet.toggleRefresh);
        rightBox.add(this.desklet.refreshButton);

        // Add everything to header with proper spacing
        this.desklet.headBox.add(leftBox);
        this.desklet.headBox.add(new St.Bin({ x_expand: true }));  // Flexible space
        this.desklet.headBox.add(rightBox);

        this.desklet.headerContainer.add(this.desklet.headBox);

        // Header feed buttons container
        this.desklet.headerFeedButtonsContainer = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            height: 30,
            style: 'min-height: 30px; background-color: rgba(0,0,0,0.1); padding: 2px 8px; spacing: 8px;',
            y_expand: false,
            reactive: true
        });

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
        this.desklet.dataBox = new St.BoxLayout({
            vertical: true,
            style_class: 'yarr-feeds-box',
            y_expand: true,
            x_expand: true,
            style: 'spacing: 2px;'
        });

        // Proper layout hierarchy
        scrollBox.add_actor(this.desklet.dataBox);
        scrollContainer.add(scrollBox);

        // Add components in correct order
        this.desklet.mainBox.add(this.desklet.headerContainer);  // Fixed header first
        this.desklet.mainBox.add(this.desklet.headerFeedButtonsContainer);  // Header feed buttons second
        this.desklet.mainBox.add(scrollContainer);       // Scrollable content third

        this.desklet.setContent(this.desklet.mainBox);

        // Build header feed buttons after UI is set up (only once)
        if (!this.desklet._headerFeedButtonsBuilt) {
            this.buildHeaderFeedButtons();
            this.desklet._headerFeedButtonsBuilt = true;
        }
    }

    displayItems() {
        try {
            Logger.debug(`displayItems called - rebuilding display with ${this.desklet.items.size} total items`);

            // CRITICAL FIX: Safety check - if no favorites exist, force filter OFF
            if (this.desklet.showOnlyFavorites) {
                const favoriteCount = Array.from(this.desklet.items.values()).filter(item => item.isFavorite).length;
                Logger.debug(`Favorites filter is ON, found ${favoriteCount} favorite items`);
                if (favoriteCount === 0) {
                    Logger.debug(`CRITICAL FIX: No favorites found but filter is ON, forcing OFF`);
                    this.desklet._showOnlyFavorites = false;
                    // Update icon to reflect the change
                    if (this.desklet.favoriteFilterIcon) {
                        this.desklet.favoriteFilterIcon.set_icon_name('non-starred');
                        this.desklet.favoriteFilterIcon.style = '';
                    }
                }
            } else {
                Logger.debug(`Favorites filter is OFF`);
            }

            if (!this.desklet.dataBox) {
                Logger.error('dataBox is null, cannot display items');
                return;
            }

            // Clear existing display
            Logger.debug('Clearing existing display');
            this.desklet.dataBox.destroy_all_children();

            // Get filtered and sorted items
            const sortedItems = Array.from(this.desklet.items.values())
                .filter(item => {
                    // Skip items with null or undefined titles
                    if (!item || !item.title) {
                        return false;
                    }

                    if (this.desklet.showOnlyFavorites && !item.isFavorite) {
                        Logger.debug(`Favorites filter: Skipping non-favorite item: "${item.title}"`);
                        return false;
                    }

                    if (this.desklet.searchFilter) {
                        const searchText = this.desklet.searchFilter.toLowerCase();
                        const matches = (item.title && item.title.toLowerCase().includes(searchText)) ||
                            (item.description && typeof item.description === 'string' && item.description.toLowerCase().includes(searchText));
                        if (!matches) {
                            return false;
                        }
                    }

                    // Check if article should be displayed based on feed runtime display state
                    // BUT skip this check for favorites - they should always be displayed
                    if (!item.isFavorite && !this.desklet.articleManagement.shouldDisplayArticle(this.desklet, item)) {
                        Logger.debug(`Article management filter: Skipping item: "${item.title}"`);
                        return false;
                    }

                    const globalFilterResult = this.desklet.inGlobalFilter(this.desklet, item.title, item.category, item.description || '');
                    if (!globalFilterResult) {
                        Logger.debug(`Global filter: Skipping item: "${item.title}"`);
                        return false;
                    }

                    Logger.debug(`Item passed all filters: "${item.title}"`);
                    return true;
                })
                .sort((a, b) => {
                    // First sort by timestamp (newest first)
                    // Handle cases where timestamp might not be a valid Date object
                    let timeA = 0;
                    let timeB = 0;

                    try {
                        if (a.timestamp instanceof Date && !isNaN(a.timestamp.getTime())) {
                            timeA = a.timestamp.getTime();
                        } else if (typeof a.timestamp === 'number') {
                            timeA = a.timestamp;
                        } else if (typeof a.timestamp === 'string') {
                            timeA = new Date(a.timestamp).getTime();
                            if (isNaN(timeA)) timeA = 0;
                        }
                    } catch (e) {
                        timeA = 0;
                    }

                    try {
                        if (b.timestamp instanceof Date && !isNaN(b.timestamp.getTime())) {
                            timeB = b.timestamp.getTime();
                        } else if (typeof b.timestamp === 'number') {
                            timeB = b.timestamp;
                        } else if (typeof b.timestamp === 'string') {
                            timeB = new Date(b.timestamp).getTime();
                            if (isNaN(timeB)) timeB = 0;
                        }
                    } catch (e) {
                        timeB = 0;
                    }

                    const timeDiff = timeB - timeA;
                    if (timeDiff !== 0) return timeDiff;

                    // If timestamps are equal, sort by title (with null safety)
                    const titleA = a.title || '';
                    const titleB = b.title || '';
                    return titleA.localeCompare(titleB);
                })
                .slice(0, this.desklet.itemlimit || 50);

            // Debug: Show favorites filtering information
            if (this.desklet.showOnlyFavorites) {
                const totalItems = Array.from(this.desklet.items.values()).length;
                const favoriteItems = Array.from(this.desklet.items.values()).filter(item => item.isFavorite).length;
                Logger.debug(` Favorites filter active: ${favoriteItems}/${totalItems} items are favorites`);

                // Additional debugging: show which items are favorites
                const favorites = Array.from(this.desklet.items.values()).filter(item => item.isFavorite);
                favorites.forEach((item, index) => {
                    Logger.debug(`Favorite ${index + 1}: "${item.title}" (isFavorite: ${item.isFavorite})`);
                });
            }

            Logger.debug(`Displaying ${sortedItems.length} items`);

            // Update header text asynchronously to prevent blocking
            if (this.desklet.headTitle && sortedItems.length > 0) {
                setTimeout(() => {
                    const currentText = this.desklet.headTitle.get_text();
                    if (!currentText.includes('articles') && !currentText.includes('favorites') && !currentText.includes('feeds configured') &&
                        this.desklet.lastRefresh && (currentText === '' || currentText === 'Yarr' || currentText.startsWith('Yarr - Loading'))) {
                        const now = this.desklet.lastRefresh;
                        const timeStr =
                            (now.getMonth() + 1).toString().padStart(2, '0') + '-' +
                            now.getDate().toString().padStart(2, '0') + ' ' +
                            now.getHours().toString().padStart(2, '0') + ':' +
                            now.getMinutes().toString().padStart(2, '0');
                        let titleText = _('Last refresh: %s').format(timeStr);
                        this.desklet.headTitle.set_text(titleText);
                    }
                }, 1);
            }

            // Calculate channel width once
            const channelWidth = Math.min(Math.max(...sortedItems.map(item => (item.channel || 'Unknown').length)) * 8, 120);

            // Get refresh timestamps and sort them newest first
            let refreshHistoryArray = [];
            if (Array.isArray(this.desklet.refreshHistory)) {
                refreshHistoryArray = this.desklet.refreshHistory;
                Logger.debug(`refreshHistory is array with ${refreshHistoryArray.length} items`);
            } else if (this.desklet.refreshHistory && typeof this.desklet.refreshHistory.then === 'function') {
                refreshHistoryArray = [];
                Logger.debug(`refreshHistory is a Promise, using empty array`);
            } else {
                refreshHistoryArray = [];
                Logger.debug(`refreshHistory is not available, using empty array`);
            }
            const refreshEvents = refreshHistoryArray
                .filter(event => {
                    // Basic validation - just check if it's a valid object with timestamp
                    if (!event || typeof event !== 'object') return false;

                    // Check if timestamp exists and is a number
                    if (!event.timestamp || typeof event.timestamp !== 'number') return false;

                    // More lenient timestamp validation
                    const now = Date.now();
                    const eventTime = event.timestamp;
                    if (eventTime > now + 86400000) return false; // Not in future
                    if (eventTime < 1000000000000) return false; // Must be after year 2000

                    return true;
                })
                .sort((a, b) => b.timestamp - a.timestamp);

            Logger.debug(`Filtered refreshEvents: ${refreshEvents.length} events (from ${refreshHistoryArray.length} total)`);
            Logger.debug(`showRefreshSeparators: ${this.desklet.showRefreshSeparators}`);
            Logger.debug(`sortedItems.length: ${sortedItems.length}`);

            // Debug: Show what events are being filtered out
            if (refreshHistoryArray.length > 0) {
                Logger.debug(`Raw refreshHistoryArray: ${JSON.stringify(refreshHistoryArray.slice(0, 2))}`);
            }
            if (refreshEvents.length > 0) {
                Logger.debug(`Filtered refreshEvents: ${JSON.stringify(refreshEvents.slice(0, 2))}`);
            }

            // Show filtering statistics
            if (refreshHistoryArray.length > refreshEvents.length) {
                Logger.debug(`Filtered out ${refreshHistoryArray.length - refreshEvents.length} invalid refresh events`);
            }

            // Display items in batches to prevent UI blocking
            // Note: refresh separators will be handled within the batch display process

            // Debug: Show refresh history info
            Logger.debug(`showRefreshSeparators setting: ${this.desklet.showRefreshSeparators}`);
            Logger.debug(`showRefreshSeparators type: ${typeof this.desklet.showRefreshSeparators}`);

            if (this.desklet.showRefreshSeparators) {
                Logger.debug(`Refresh history info: ${JSON.stringify(this.desklet.refreshHistory)}`);
                Logger.debug(`Refresh history length: ${this.desklet.refreshHistory ? this.desklet.refreshHistory.length : 'undefined'}`);


            }

            this._displayItemsInBatches(sortedItems, refreshEvents, channelWidth);

        } catch (e) {
            Logger.error('Error in displayItems: ' + e.toString());
        }
    }

    _displayItemsInBatches(sortedItems, refreshEvents, channelWidth) {
        // Check if refresh separators are enabled
        Logger.debug(`_displayItemsInBatches called with ${sortedItems.length} items and ${refreshEvents.length} refresh events`);
        Logger.debug(`showRefreshSeparators: ${this.desklet.showRefreshSeparators}`);
        Logger.debug(`refreshEvents details: ${JSON.stringify(refreshEvents.slice(0, 2))}`);

        Logger.debug(`Checking conditions: showRefreshSeparators=${this.desklet.showRefreshSeparators}, refreshEvents.length=${refreshEvents.length}, sortedItems.length=${sortedItems.length}`);

        if (this.desklet.showRefreshSeparators && refreshEvents.length > 0 && sortedItems.length > 0) {
            Logger.debug(`Creating merged list with refresh separators`);
            Logger.debug(`Condition met: showRefreshSeparators=${this.desklet.showRefreshSeparators}, refreshEvents.length=${refreshEvents.length}, sortedItems.length=${sortedItems.length}`);
            // Create a merged list of articles and refresh separators, properly sorted by time
            let mergedItems = [];
            let currentRefreshIndex = 0;
            let lastAddedTimestamp = Infinity;

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
                // Handle cases where timestamp might not be a valid Date object
                let timestamp = 0;
                try {
                    if (article.timestamp instanceof Date && !isNaN(article.timestamp.getTime())) {
                        timestamp = article.timestamp.getTime();
                    } else if (typeof article.timestamp === 'number') {
                        timestamp = article.timestamp;
                    } else if (typeof article.timestamp === 'string') {
                        timestamp = new Date(article.timestamp).getTime();
                        if (isNaN(timestamp)) timestamp = 0;
                    }
                } catch (e) {
                    timestamp = 0;
                }

                mergedItems.push({
                    type: 'article',
                    timestamp: timestamp,
                    data: article,
                    index: index
                });
            });

            // Sort merged items by timestamp (newest first)
            mergedItems.sort((a, b) => b.timestamp - a.timestamp);

            Logger.debug(`Created ${mergedItems.length} merged items (${mergedItems.filter(m => m.type === 'refresh').length} refresh, ${mergedItems.filter(m => m.type === 'article').length} articles)`);

            // Display merged items in batches
            this._displayMergedItemsInBatches(mergedItems, channelWidth);
        } else {
            Logger.debug(`No refresh separators - showing articles only`);
            Logger.debug(`Condition not met: showRefreshSeparators=${this.desklet.showRefreshSeparators}, refreshEvents.length=${refreshEvents.length}, sortedItems.length=${sortedItems.length}`);
            // No separators, just display articles in batches
            const BATCH_SIZE = 5; // Reduce batch size to prevent blocking
            let currentIndex = 0;

            const processBatch = () => {
                const endIndex = Math.min(currentIndex + BATCH_SIZE, sortedItems.length);

                for (let i = currentIndex; i < endIndex; i++) {
                    const item = sortedItems[i];
                    this._addArticleToDisplay(item, i, channelWidth);
                }

                currentIndex = endIndex;

                if (currentIndex < sortedItems.length) {
                    // Use setTimeout for true async behavior instead of GLib.idle_add
                    setTimeout(processBatch, 1);
                } else {
                    // All items processed, update header feed buttons once
                    if (this.desklet.uiDisplay && this.desklet.uiDisplay.buildHeaderFeedButtons) {
                        this.desklet.uiDisplay.buildHeaderFeedButtons();
                    }
                }
            };

            // Start processing batches with a small delay to prevent blocking
            if (sortedItems.length > 0) {
                setTimeout(processBatch, 1);
            }
        }
    }

    _displayMergedItemsInBatches(mergedItems, channelWidth) {
        const BATCH_SIZE = 5; // Reduce batch size to prevent blocking
        let currentIndex = 0;
        let displayedIndex = 0;
        let lastRefreshTime = null;
        let articlesAfterLastSeparator = 0;
        let pendingSeparator = null;

        const processBatch = () => {
            const endIndex = Math.min(currentIndex + BATCH_SIZE, mergedItems.length);

            for (let i = currentIndex; i < endIndex; i++) {
                const item = mergedItems[i];

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
                        pendingSeparator = item.data;
                        lastRefreshTime = item.timestamp;
                        articlesAfterLastSeparator = 0;
                    }
                }
            }

            currentIndex = endIndex;

            if (currentIndex < mergedItems.length) {
                // Use setTimeout for true async behavior instead of GLib.idle_add
                setTimeout(processBatch, 1);
            } else {
                // All items processed, update header feed buttons once
                if (this.desklet.uiDisplay && this.desklet.uiDisplay.buildHeaderFeedButtons) {
                    this.desklet.uiDisplay.buildHeaderFeedButtons();
                }
            }
        };

        // Start processing batches with a small delay to prevent blocking
        if (mergedItems.length > 0) {
            setTimeout(processBatch, 1);
        }
    }

    _addArticleToDisplay(item, index, channelWidth) {
        try {
            // Ensure item has required properties to prevent undefined style errors
            if (typeof item.isFavorite === 'undefined') {
                item.isFavorite = false;
            }

            // PERFORMANCE FIX: Removed expensive favorite synchronization that was causing system lag

            if (typeof item.key === 'undefined') {
                item.key = item.link || `display_${Date.now()}`;
            }
            if (typeof item.title === 'undefined') {
                item.title = 'Untitled';
            }

            // CRITICAL FIX: Store reference to DOM element for direct AI response insertion
            // This eliminates the need for unreliable title searching
            if (item.key) {
                if (!this.desklet._articleDOMRefs) {
                    this.desklet._articleDOMRefs = new Map();
                }
            }

            // Main row container
            const lineBox = new St.BoxLayout({
                vertical: false,
                style: `
                    background-color: ${index % 2 ?
                        `rgba(100,100,100, ${this.desklet.alternateRowTransparency})` :
                        `rgba(${this.desklet.backgroundColor.replace('rgb(', '').replace(')', '')}, ${this.desklet.transparency})`
                    };
                    padding: ${1 * this.desklet.articleSpacing}px;
                    margin: ${1 * this.desklet.articleSpacing}px 0;
                `
            });

            // Only add feed button if NOT hidden
            if (!this.desklet.enableFeedButton) {
                const feedBtn = new St.Button({
                    style: `
                        background-color: ${item.labelColor}; 
                        border-radius: 4px; 
                        margin: 0 5px; 
                        width: ${channelWidth}px;
                    `
                });
                feedBtn.set_child(new St.Label({ text: item.channel }));
                this.desklet._signals.connect(feedBtn, 'clicked', () => item.link && Util.spawnCommandLine(`xdg-open "${item.link}"`));
                lineBox.add(feedBtn);
            }

            // Only add timestamp if NOT hidden
            if (!this.desklet.enableTimestamp) {
                const timeBox = new St.BoxLayout({
                    vertical: false,
                    style: 'width: 90px; margin: auto;'
                });

                const timeLabel = new St.Label({
                    text: this._formatedDate(new Date(item.timestamp), false),
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'font-size: 0.8em; text-align: center; margin: auto; width: 90px;'
                });

                timeBox.add(timeLabel);
                lineBox.add(timeBox);
            }

            // Action buttons
            const buttonBox = new St.BoxLayout({ style: 'spacing: 5px; padding: 0 5px;' });

            // Add all the buttons (read status, AI summary, copy, favorite)
            this._addActionButtons(buttonBox, item, lineBox);

            // Title and content panel
            let panelButton = new St.Button({
                style_class: 'yarr-panel-button',
                reactive: true,
                track_hover: true,
                x_expand: true,
                x_align: St.Align.START,
                style: `padding: ${3 * this.desklet.articleSpacing}px; border-radius: 4px;`
            });

            // Create subItemBox for title and AI response
            let subItemBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                x_align: St.Align.START,
                style: `spacing: ${2 * this.desklet.articleSpacing}px;`
            });

            // Title - apply read status styling
            let isRead = false;
            try {
                if (this.desklet.readArticleIds && typeof this.desklet.readArticleIds.has === 'function') {
                    isRead = this.desklet.readArticleIds.has(item.key);
                }
            } catch (e) {
                Logger.error(`Error checking read status for styling: ${e}`);
                isRead = false;
            }
            let baseFont = this.desklet.fontstyle.replace(/font-weight:[^;]+;/i, '');
            const titleLabel = new St.Label({
                text: item.title || 'Untitled',
                style: baseFont + (isRead ? ' font-weight: normal;' : ' font-weight: bold;') +
                    (isRead && this.desklet.dimReadTitles ? ` color: ${this.desklet.readTitleColor}; opacity: 0.85;` : ''),
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
                    style: this.desklet.ai_fontstyle,
                    x_expand: true,
                    x_align: St.Align.START
                });
                aiLabel.clutter_text.set_line_wrap(true);
                aiLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
                aiLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

                subItemBox.add(aiLabel);
            }

            panelButton.set_child(subItemBox);

            // Connect click handling
            this._connectPanelButtonEvents(panelButton, item, titleLabel);

            // Add elements to lineBox
            lineBox.add(buttonBox);
            lineBox.add(panelButton);

            // CRITICAL FIX: Store reference to DOM element for direct AI response insertion
            if (item.key && this.desklet._articleDOMRefs) {
                this.desklet._articleDOMRefs.set(item.key, {
                    lineBox: lineBox,
                    subItemBox: subItemBox,
                    titleLabel: titleLabel
                });
                Logger.debug(`Stored DOM reference for article key: ${item.key}`);
            }

            this.desklet.dataBox.add(lineBox);
        } catch (e) {
            Logger.error('Error adding article to display: ' + e);
        }
    }

    _addActionButtons(buttonBox, item, lineBox) {
        // Read status checkbox button
        if (this.desklet.showReadStatusCheckbox) {
            const readStatusBtn = new St.Button({
                style_class: 'yarr-button',
                style: 'padding: 2px;'
            });

            let isRead = false;
            try {
                if (this.desklet.readArticleIds && typeof this.desklet.readArticleIds.has === 'function') {
                    isRead = this.desklet.readArticleIds.has(item.key);
                }
            } catch (e) {
                Logger.error(`Error checking read status: ${e}`);
                isRead = false;
            }

            const readIcon = new St.Icon({
                icon_name: isRead ? 'checkbox-checked-symbolic' : 'checkbox-symbolic',
                icon_type: St.IconType.SYMBOLIC,
                icon_size: 16,
                style: (isRead ? 'color: #4a90e2;' : 'color: #888888;') || 'color: #888888;'
            });

            readStatusBtn.set_child(readIcon);
            this.desklet._signals.connect(readStatusBtn, 'clicked', () => {
                this.desklet._toggleReadStatus(item, readIcon, null);
            });

            buttonBox.add(readStatusBtn);
        }

        // AI summary button
        if (this.desklet.ai_enablesummary && (item.description || item.channel === _('Manual'))) {
            const sumBtn = new St.Button({ style_class: 'yarr-button' });
            const sumIcon = new St.Icon({ icon_name: 'gtk-zoom-fit', icon_size: 16 });
            sumBtn.set_child(sumIcon);

            this.desklet._signals.connect(sumBtn, 'clicked', async () => {
                try {
                    sumIcon.set_icon_name('process-working-symbolic');

                    if (this.desklet.showReadStatusCheckbox) {
                        this.desklet._markItemAsRead(item, null, null);
                    }

                    await this.desklet.summarizeUri(this.desklet.ai_dumptool, item, lineBox, sumIcon);
                    sumIcon.set_icon_name('document-edit-symbolic');
                } catch (e) {
                    Logger.error(`Error in AI summary: ${e}`);
                    sumIcon.set_icon_name('dialog-error-symbolic');

                    // Show user-friendly error message
                    const errorMessage = e.message || 'AI summary failed';
                    if (this.desklet.enableDebugLogs) {
                        Logger.debug(`AI Summary Error Details: ${errorMessage}`);
                    }

                    // Reset icon after a delay to show completion
                    setTimeout(() => {
                        if (sumIcon) {
                            sumIcon.set_icon_name('document-edit-symbolic');
                        }
                    }, 3000);
                }
            });
            buttonBox.add(sumBtn);
        }

        // Copy button
        if (this.desklet.enablecopy) {
            const copyBtn = new St.Button({ style_class: 'yarr-button' });
            const copyIcon = new St.Icon({ icon_name: 'edit-copy-symbolic', icon_size: 16 });
            copyBtn.set_child(copyIcon);
            this.desklet._signals.connect(copyBtn, 'clicked', () => this.desklet.onClickedCopyButton(null, null, item, lineBox));
            buttonBox.add(copyBtn);
        }

        // Favorite button
        if (this.desklet.enableFavoriteFeature) {
            const favoriteBtn = new St.Button({
                style_class: 'yarr-button',
                style: 'padding: 2px;'
            });

            const favoriteIcon = new St.Icon({
                icon_name: item.isFavorite ? 'starred' : 'non-starred',
                icon_type: St.IconType.SYMBOLIC,
                icon_size: 16,
                style: item.isFavorite ? 'color: #ffd700 !important;' : 'color: #888888 !important;'
            });

            favoriteBtn.set_child(favoriteIcon);
            this.desklet._signals.connect(favoriteBtn, 'clicked', async () => {
                try {
                    Logger.debug(`Favorites button clicked for: ${item.title}`);
                    Logger.debug(`Current isFavorite state: ${item.isFavorite}`);

                    // Update icon immediately for instant visual feedback (like AI Summary button)
                    item.isFavorite = !item.isFavorite;
                    Logger.debug(`New isFavorite state: ${item.isFavorite}`);
                    Logger.debug(`Updating icon immediately to: ${item.isFavorite ? 'starred' : 'non-starred'}`);

                    favoriteIcon.set_icon_name(item.isFavorite ? 'starred' : 'non-starred');
                    favoriteIcon.style = item.isFavorite ? 'color: #ffd700 !important;' : 'color: #888888 !important;';

                    let success = false;
                    if (item.isFavorite) {
                        Logger.debug(`Adding to favorites via FavoritesManagers...`);
                        success = await this.desklet.favoritesManagers.addFavorite(item);
                        Logger.debug(`Added to favorites via FavoritesManagers`);
                    } else {
                        Logger.debug(`Removing from favorites via FavoritesManagers...`);
                        success = await this.desklet.favoritesManagers.removeFavorite(item);
                        Logger.debug(`Removed from favorites via FavoritesManagers`);
                    }

                    Logger.debug(`Database operation success: ${success}`);

                    if (!success) {
                        Logger.debug(`Operation failed, reverting icon state`);
                        item.isFavorite = !item.isFavorite;
                        favoriteIcon.set_icon_name(item.isFavorite ? 'starred' : 'non-starred');
                        favoriteIcon.style = item.isFavorite ? 'color: #ffd700 !important;' : 'color: #888888 !important;';
                    } else {
                        // SUCCESS: No display refresh needed - just like AI Summary button
                        // The icon is already updated, and the item.isFavorite property is set
                        // The favorites filter will work on the next natural display update
                        Logger.debug('Favorite status changed successfully - no display refresh needed');
                    }
                } catch (e) {
                    Logger.error(`Error toggling favorite: ${e}`);
                    Logger.debug(`Error occurred, reverting icon state`);
                    item.isFavorite = !item.isFavorite;
                    favoriteIcon.set_icon_name(item.isFavorite ? 'starred' : 'non-starred');
                    favoriteIcon.style = item.isFavorite ? 'color: #ffd700 !important;' : 'color: #888888 !important;';
                    Logger.debug(`Icon reverted to: ${item.isFavorite ? 'starred' : 'non-starred'}`);
                }
            });

            buttonBox.add(favoriteBtn);
        }
    }

    _connectPanelButtonEvents(panelButton, item, titleLabel) {
        // Single click: mark as read and show tooltip
        // Double click: open article viewer
        this.desklet._signals.connect(panelButton, 'button-press-event', (actor, event) => {
            const count = event.get_click_count();
            Logger.debug(`Button press event: click count = ${count} for article: ${item.title || 'Untitled'}`);

            if (count === 2) {
                // Double click: hide tooltip and open article viewer
                Logger.debug('Double click detected - opening article viewer');
                this._hideTooltip();
                this._showArticleTooltip(item, event);
                return Clutter.EVENT_STOP;
            }

            if (count === 1) {
                // Single click: mark as read and show tooltip
                Logger.debug('Single click detected - marking as read and showing tooltip');
                try {
                    // Mark as read first
                    this.desklet._markItemAsRead(item, this.desklet.showReadStatusCheckbox ? null : null, titleLabel);

                    // Show tooltip if description is available
                    if (item.description && typeof item.description === 'string' && item.description.trim()) {
                        // Use a shorter delay for more responsive feel
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                            Logger.debug('Showing tooltip after delay');
                            this._showTooltip(panelButton, item);
                            return GLib.SOURCE_REMOVE;
                        });
                    } else {
                        Logger.debug('No description available for tooltip');
                    }
                } catch (e) {
                    Logger.error('Error handling single click: ' + e);
                }

                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        });



        // Tooltip setup (keep existing setup for hover behavior)
        if (item.description && typeof item.description === 'string' && item.description.trim()) {
            let tooltip = new Tooltips.Tooltip(panelButton);
            tooltip.set_markup(`<b>${Utilities.escapeMarkup(item.title || 'Untitled')}</b>\n${Utilities.escapeMarkup(item.pubDate)}\n\n${Utilities.escapeMarkup(this.desklet.HTMLPartToTextPart(item.description))}`);
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
            tooltip._showTimeout = null;
            tooltip.preventShow = true;
        }
    }

    _showTooltip(panelButton, item) {
        try {
            Logger.debug(`_showTooltip called for article: ${item.title || 'Untitled'}`);

            // Hide any existing tooltip
            if (this._currentTooltip) {
                Logger.debug('Hiding existing tooltip');
                this._currentTooltip.hide();
                this._currentTooltip = null;
            }

            // Create a new tooltip
            let tooltip = new Tooltips.Tooltip(panelButton);
            Logger.debug('Tooltip object created');

            // Validate tooltip object
            if (!tooltip || !tooltip._tooltip) {
                Logger.error('Failed to create valid tooltip object');
                return;
            }

            // Prepare tooltip content with smart truncation
            const title = item.title || 'Untitled';
            const date = item.pubDate || 'Unknown date';
            let description = this.desklet.HTMLPartToTextPart(item.description);

            // Truncate description if it's too long (keep first 500 characters)
            if (description.length > 500) {
                description = description.substring(0, 500) + '...';
            }

            Logger.debug(`Setting tooltip content - Title: ${title}, Date: ${date}, Description length: ${description.length}`);

            // Check if content is valid
            if (!title || !description || description.trim().length === 0) {
                Logger.debug('Tooltip content is empty or invalid, skipping tooltip creation');
                return;
            }

            tooltip.set_markup(`<b>${Utilities.escapeMarkup(title)}</b>\n${Utilities.escapeMarkup(date)}\n\n${Utilities.escapeMarkup(description)}`);

            // Apply styling
            tooltip._tooltip.style = `
                text-align: left;
                max-width: 600px;
                padding: 16px;
                font-size: 1.1em;
                line-height: 1.5;
                background-color: rgba(40, 40, 40, 0.98);
                border: 1px solid rgba(255,255,255,0.25);
                border-radius: 8px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.4);
                backdrop-filter: blur(10px);
            `;

            tooltip._tooltip.clutter_text.set_line_wrap(true);
            tooltip._tooltip.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
            tooltip._tooltip.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
            tooltip._tooltip.set_x_align(St.Align.START);
            tooltip._tooltip.clutter_text.set_x_align(Clutter.ActorAlign.START);

            // Store reference
            this._currentTooltip = tooltip;
            Logger.debug('About to position and show tooltip');

            // Ensure tooltip is added to the stage
            if (global.stage && !global.stage.contains(tooltip._tooltip)) {
                Logger.debug('Adding tooltip to global stage');
                global.stage.add_child(tooltip._tooltip);
            }

            // Show tooltip first to get accurate dimensions, but keep it invisible
            tooltip.show();
            tooltip._tooltip.set_opacity(0);
            Logger.debug('Tooltip.show() called');

            // Make tooltip clickable to close it
            this.desklet._signals.connect(tooltip._tooltip, 'button-press-event', () => {
                Logger.debug('Tooltip clicked - hiding');
                this._hideTooltip();
                return Clutter.EVENT_STOP;
            });

            // Position tooltip AFTER showing it to get accurate dimensions
            this._positionTooltip(tooltip, panelButton);
            Logger.debug('Tooltip positioned after showing');

            // Make tooltip visible after positioning
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
                if (tooltip._tooltip && this._currentTooltip === tooltip) {
                    tooltip._tooltip.set_opacity(255);
                    Logger.debug('Tooltip made visible after positioning');
                }
                return GLib.SOURCE_REMOVE;
            });
            Logger.debug('Tooltip visibility and opacity set');

            // Verify tooltip is actually visible
            if (tooltip._tooltip && tooltip._tooltip.visible) {
                Logger.debug('Tooltip is visible and positioned correctly');
            } else {
                Logger.error('Tooltip may not be visible after positioning');
            }

            // Auto-hide after 5 seconds (with small initial delay to allow user interaction)
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
                if (this._currentTooltip === tooltip) {
                    Logger.debug('Auto-hiding tooltip after 5 seconds');
                    tooltip.hide();
                    this._currentTooltip = null;
                }
                return GLib.SOURCE_REMOVE;
            });

            Logger.debug(`Tooltip shown successfully for article: ${item.title || 'Untitled'}`);

        } catch (e) {
            Logger.error('Error showing tooltip: ' + e);
        }
    }

    _hideTooltip() {
        if (this._currentTooltip) {
            Logger.debug('Hiding tooltip');
            this._currentTooltip.hide();
            this._currentTooltip = null;
            Logger.debug('Tooltip hidden and reference cleared');
        } else {
            Logger.debug('_hideTooltip called but no tooltip is currently visible');
        }
    }

    isTooltipVisible() {
        return this._currentTooltip !== null;
    }

    _positionTooltip(tooltip, panelButton) {
        try {
            Logger.debug('Positioning tooltip');

            // Get the tooltip actor
            const tooltipActor = tooltip._tooltip;
            if (!tooltipActor) {
                Logger.debug('No tooltip actor found');
                return;
            }

            // Get the panel button position
            const buttonBox = panelButton.get_allocation_box();
            if (!buttonBox) {
                Logger.debug('No button allocation box found');
                return;
            }

            Logger.debug(`Button position: x1=${buttonBox.x1}, y1=${buttonBox.y1}, x2=${buttonBox.x2}, y2=${buttonBox.y2}`);

            // Wait for tooltip to be fully rendered before getting dimensions
            // Use a small timeout to ensure content is laid out
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 15, () => {
                try {
                    // Get accurate dimensions after rendering
                    const tooltipWidth = tooltipActor.width || 600;
                    const tooltipHeight = tooltipActor.height || 150;
                    const screenWidth = global.screen_width;
                    const screenHeight = global.screen_height;

                    Logger.debug(`Tooltip dimensions: width=${tooltipWidth}, height=${tooltipHeight}`);
                    Logger.debug(`Screen dimensions: width=${screenWidth}, height=${screenHeight}`);

                    // Use stable positioning relative to button center
                    const buttonCenterX = buttonBox.x1 + (buttonBox.x2 - buttonBox.x1) / 2;
                    const buttonCenterY = buttonBox.y1 + (buttonBox.y2 - buttonBox.y1) / 2;

                    // Position tooltip below the button, centered horizontally
                    let x = Math.round(buttonCenterX - tooltipWidth / 2);
                    let y = Math.round(buttonBox.y2 + 10); // 10px below the button

                    // Ensure tooltip doesn't go off-screen with stable boundaries
                    if (x < 10) x = 10;
                    if (x + tooltipWidth > screenWidth - 10) x = screenWidth - tooltipWidth - 10;
                    if (y + tooltipHeight > screenHeight - 10) y = Math.round(buttonBox.y1 - tooltipHeight - 10); // Show above if below doesn't fit

                    Logger.debug(`Final tooltip position: x=${x}, y=${y}`);

                    // Apply position with stable coordinates
                    tooltipActor.set_position(x, y);
                    Logger.debug('Tooltip position applied');
                } catch (e) {
                    Logger.error('Error in delayed positioning: ' + e);
                }
                return GLib.SOURCE_REMOVE;
            });

        } catch (e) {
            Logger.error('Error positioning tooltip: ' + e);
        }
    }

    _addRefreshSeparator(refreshEvent) {
        try {
            if (!refreshEvent) {
                Logger.error('Cannot add separator: refreshEvent is null or undefined');
                return;
            }

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
                text: `${dateStr} ${timeStr} (${refreshEvent.articleCount || 0} articles, ${refreshEvent.feedsRefreshed || 0} feeds)`,
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

            this.desklet.dataBox.add(separatorBox);
        } catch (e) {
            Logger.error('Error adding refresh separator: ' + e.toString());
        }
    }

    _formatedDate(pDate, withYear = true) {
        // Ensure pDate is a valid Date object
        if (!(pDate instanceof Date) || isNaN(pDate.getTime())) {
            Logger.warn(`Invalid date passed to _formatedDate: ${pDate}`);
            return 'Invalid date';
        }

        let retStr = '';
        if (withYear) {
            retStr += pDate.getFullYear().toString() + '-';
        }
        retStr += (pDate.getMonth() + 1).toString().padStart(2, '0') + '-' + pDate.getDate().toString().padStart(2, '0') + ' ' +
            pDate.getHours().toString().padStart(2, '0') + ':' + pDate.getMinutes().toString().padStart(2, '0');
        return retStr;
    }

    _showArticleTooltip(item, event) {
        try {
            // Validate input parameters
            if (!item) {
                Logger.error('_showArticleTooltip called with null/undefined item');
                return;
            }

            // Don't show popup if no description
            if (!item.description || typeof item.description !== 'string' || !item.description.trim()) {
                Logger.debug('No description available for article: ' + (item.title || 'Untitled'));
                // Show a simple notification instead
                this.desklet.articleManagement._showSimpleNotification(_("No description available for this article"));
                return;
            }

            Logger.debug('Launching Python article viewer for: ' + (item.title || 'Untitled'));
            Logger.debug('Description length: ' + item.description.length + ' characters');

            // Prepare article data for Python helper
            let articleData = {
                key: item.key,
                title: item.title || 'Untitled',
                description: item.description,
                date: item.date || 'Unknown date',
                link: item.link || '',
                aiResponse: item.aiResponse || '',
                commId: this._generateCommId(), // Unique communication ID for this window
                desklet_settings: {
                    bg_color: this.desklet.backgroundColor || this.desklet.color || '#1e1e1e',
                    fg_color: this.desklet.color || '#ffffff',
                    accent_color: '#00b4d8', // Modern blue accent
                    font_family: this.desklet.font ? this.desklet.font.split(' ').slice(0, -1).join(' ') : 'Segoe UI',
                    font_size: this.desklet.font ? parseInt(this.desklet.font.split(' ').pop()) || 11 : 11,
                    transparency: this.desklet.transparency || 0.95,
                    font_style: this.desklet.fontstyle || 'normal',
                    width: this.desklet.width || 1000,
                    height: this.desklet.height || 800
                }
            };

            Logger.debug('Article data prepared for Python helper:');
            Logger.debug('  - Title: ' + articleData.title);
            Logger.debug('  - Key: ' + articleData.key);
            Logger.debug('  - CommId: ' + articleData.commId);

            // Launch Python helper as independent process
            this._launchPythonViewer(articleData);

            // Check if we need to start AI processing
            if (this.desklet.ai_enablesummary && !item.aiResponse) {
                // Add commId to item object so AI processing can use it
                item.commId = articleData.commId;

                Logger.debug('Starting AI background processing for Python viewer: ' + (item.title || 'Untitled') + ' with key: ' + item.key);
                Logger.debug('Current items count before AI processing: ' + this.desklet.items.size);
                Logger.debug('Item object being passed to AI processing: ' + JSON.stringify(item, null, 2).substring(0, 300) + '...');

                // Start AI processing in background
                this._autoStartAIProcessing(articleData);

                // Show processing message in Python window immediately
                this._notifyPythonHelper(item.key, 'AI processing started... Please wait.', item.commId);

            } else if (this.desklet.ai_enablesummary && item.aiResponse) {
                // AI summary already exists - send it to Python window
                Logger.debug('AI summary already exists, sending to Python viewer: ' + (item.title || 'Untitled'));
                this._notifyPythonHelper(item.key, item.aiResponse, articleData.commId);
            } else if (!this.desklet.ai_enablesummary) {
                // AI is disabled - notify Python window
                Logger.debug('AI summary is disabled, notifying Python viewer');
                this._notifyPythonHelper(item.key, 'AI summary is disabled in desklet settings.', articleData.commId);
            }

            Logger.debug('Python article viewer launched successfully');
            return null;

        } catch (e) {
            Logger.error('Error launching Python article viewer: ' + e);
            this.desklet.articleManagement._showSimpleNotification(_("Error launching article viewer. Please check the logs."));
            return null;
        }
    }

    // Generate a unique communication ID for the current window
    _generateCommId() {
        // Generate a unique ID based on timestamp and random component
        let timestamp = Date.now();
        let random = Math.floor(Math.random() * 1000000);
        let articleKey = this.desklet.items ? this.desklet.items.size : 0;

        // Combine multiple sources for uniqueness
        return `yarr_${timestamp}_${random}_${articleKey}`;
    }

    _launchPythonViewer(article) {
        try {
            // Generate unique communication ID for this article
            const commId = this._generateCommId();

            // Create article data with communication ID
            const articleData = {
                title: article.title || 'No Title',
                description: article.description || 'No description available',
                link: article.link || '',
                date: article.date || article.pubDate || '', // Include date field for Python viewer
                pubDate: article.pubDate || '',
                feedName: article.feedName || 'Unknown Feed',
                articleKey: article.key || '', // Use article.key instead of article.articleKey
                aiResponse: article.aiResponse || '', // Include existing AI response if available
                commId: commId,
                timestamp: new Date().toISOString()
            };

            // Write article data to temporary file for Python viewer
            const articleFileName = `yarr_article_${commId}.json`;
            const articleFilePath = `/tmp/${articleFileName}`;

            try {
                const file = Gio.File.new_for_path(articleFilePath);
                const jsonData = JSON.stringify(articleData, null, 2);
                const bytes = GLib.Bytes.new(jsonData);

                file.replace_contents_bytes_async(
                    bytes,
                    null,
                    false,
                    Gio.FileCreateFlags.NONE,
                    null,
                    (source, result) => {
                        try {
                            source.replace_contents_finish(result);
                            Logger.debug(`Article data written to: ${articleFilePath}`);

                            // Launch Python viewer directly with system Python for GTK integration
                            const viewerScript = `${this.deskletPath}/article_viewer.py`;

                            // Launch Python viewer asynchronously - SIMPLE!
                            const launcher = Gio.SubprocessLauncher.new(
                                Gio.SubprocessFlags.STDOUT_SILENCE |
                                Gio.SubprocessFlags.STDERR_SILENCE
                            );
                            launcher.set_cwd(this.deskletPath);

                            // Set up environment for GTK integration
                            launcher.setenv('DISPLAY', GLib.getenv('DISPLAY') || ':0', true);
                            launcher.setenv('XDG_CURRENT_DESKTOP', GLib.getenv('XDG_CURRENT_DESKTOP') || 'Cinnamon', true);
                            launcher.setenv('DESKTOP_SESSION', GLib.getenv('DESKTOP_SESSION') || 'cinnamon', true);

                            // Pass desklet settings to Python viewer via environment variables
                            if (this.desklet.backgroundColor) {
                                launcher.setenv('YARR_BG_COLOR', this.desklet.backgroundColor, true);
                            }
                            if (this.desklet.color) {
                                launcher.setenv('YARR_TEXT_COLOR', this.desklet.color, true);
                            }
                            if (this.desklet.ai_color) {
                                launcher.setenv('YARR_AI_COLOR', this.desklet.ai_color, true);
                            }
                            if (this.desklet.font) {
                                launcher.setenv('YARR_FONT', this.desklet.font, true);
                            }
                            if (this.desklet.ai_font) {
                                launcher.setenv('YARR_AI_FONT', this.desklet.ai_font, true);
                            }
                            if (this.desklet.readTitleColor) {
                                launcher.setenv('YARR_READ_COLOR', this.desklet.readTitleColor, true);
                            }
                            if (this.desklet.transparency !== undefined) {
                                launcher.setenv('YARR_TRANSPARENCY', this.desklet.transparency.toString(), true);
                            }

                            // Launch the viewer asynchronously - this won't block!
                            const subprocess = launcher.spawnv(['python3', viewerScript]);

                            Logger.debug(`Python viewer launched (PID: ${subprocess.get_identifier()})`);

                            // Start AI processing automatically if no summary exists
                            if (!articleData.aiResponse) {
                                this._autoStartAIProcessing(articleData);
                            }

                            // Clean up article data file when viewer process ends
                            subprocess.wait_async(null, (source, result) => {
                                try {
                                    source.wait_finish(result);
                                    Logger.debug(`Python viewer process ended, cleaning up temp file`);

                                    // Clean up temp file after viewer closes
                                    try {
                                        const cleanupFile = Gio.File.new_for_path(articleFilePath);
                                        if (cleanupFile.query_exists(null)) {
                                            cleanupFile.delete(null);
                                            Logger.debug(`Cleaned up article data file: ${articleFilePath}`);
                                        }
                                    } catch (e) {
                                        Logger.debug(`Error cleaning up article data file: ${e}`, true);
                                    }
                                } catch (e) {
                                    Logger.debug(`Error monitoring subprocess for cleanup: ${e}`);
                                }
                            });

                        } catch (e) {
                            Logger.debug(`Error writing article data: ${e}`, true);
                        }
                    }
                );

            } catch (e) {
                Logger.debug(`Error setting up article data file: ${e}`, true);
            }

        } catch (e) {
            Logger.debug(`Error launching Python viewer: ${e}`, true);
        }
    }



    // Auto-start AI processing if no summary exists
    _autoStartAIProcessing(articleData) {
        try {
            // Only start AI processing if enabled and no summary exists
            if (this.desklet.ai_enablesummary && !articleData.aiResponse) {
                Logger.debug('Auto-starting AI processing for article: ' + articleData.title);

                // Start AI processing in background without blocking
                setTimeout(async () => {
                    try {
                        // Create item object for AI processing
                        const tempItem = {
                            title: articleData.title,
                            link: articleData.link,
                            description: articleData.description || '',
                            channel: articleData.feedName || 'Unknown Feed', // Use feedName instead of channel
                            key: articleData.articleKey, // Include key for proper identification
                            isFavorite: false
                        };

                        // Create a temporary lineBox and sumIcon for AI processing
                        const tempLineBox = {
                            add_child: () => { },
                            remove_child: () => { },
                            set_style: () => { }
                        };
                        const tempSumIcon = {
                            set_icon_name: () => { },
                            set_style: () => { }
                        };

                        // Call AI processing in background
                        if (this.desklet.aiManagers && this.desklet.aiManagers.summarizeUri) {
                            Logger.debug('Calling AI managers for background processing: ' + articleData.title);

                            // Make AI processing non-blocking
                            this.desklet.aiManagers.summarizeUri(
                                this.desklet.ai_dumptool,
                                tempItem,
                                tempLineBox,
                                tempSumIcon
                            ).then(() => {
                                // Write AI result to communication file for viewer to poll
                                this._notifyPythonHelper(articleData.articleKey, tempItem.aiResponse, articleData.commId);

                                // Update the actual article in desklet's list with AI summary
                                this._updateDeskletArticleWithAI(articleData, tempItem.aiResponse);

                                Logger.debug('AI background processing completed for: ' + articleData.title);
                            }).catch((error) => {
                                Logger.error('Error in AI background processing: ' + error);
                            });
                        } else {
                            Logger.debug('AI managers not available for background processing');
                        }
                    } catch (error) {
                        Logger.error('Error in AI background processing: ' + error);
                    }
                }, 1000); // Delay by 1 second to ensure UI is responsive
            }
        } catch (e) {
            Logger.debug(`Error starting AI background processing: ${e}`, true);
        }
    }

    async _updateDeskletArticleWithAI(articleData, aiResponse) {
        try {
            if (!aiResponse || !articleData.articleKey) {
                Logger.debug('No AI response or article key to update');
                return;
            }

            // Find and update the article in desklet's items map
            const articleKey = articleData.articleKey;
            if (this.desklet.items && this.desklet.items.has(articleKey)) {
                const item = this.desklet.items.get(articleKey);

                // Update the article with AI response
                item.aiResponse = aiResponse;

                // Mark as read (like manual AI processing does)
                if (this.desklet.databaseManager) {
                    await this.desklet.databaseManager.markRead(articleKey);
                    if (this.desklet.readArticleIds) {
                        this.desklet.readArticleIds.add(articleKey);
                    }
                }

                Logger.debug(`Updated desklet article ${articleKey} with AI summary and marked as read`);

                // Don't reload the entire list - just update the article data
                // The AI summary button will show the result when clicked
            } else {
                Logger.debug(`Article ${articleKey} not found in desklet items`);
            }

        } catch (e) {
            Logger.debug(`Error updating desklet article with AI: ${e}`, true);
        }
    }



    // Notify Python helper of AI processing result
    _notifyPythonHelper(articleKey, aiResponse, commId) {
        try {
            // Create communication data with unique ID
            let commData = {
                articleKey: articleKey,
                aiResponse: aiResponse,
                commId: commId,
                timestamp: new Date().toISOString()
            };

            // Use system temp directory with secure naming to prevent info leaks
            let tempDir = GLib.get_tmp_dir();
            let commFile = tempDir + '/yarr_ai_' + commId + '.tmp';
            let jsonString = JSON.stringify(commData, null, 2);

            // Use GLib to write file
            let success = GLib.file_set_contents(commFile, jsonString);

            if (success) {
                Logger.debug('AI result communicated to Python helper successfully with commId: ' + commId);
                Logger.debug('Communication file created at: ' + commFile);
                Logger.debug('File contents: ' + jsonString.substring(0, 200) + '...');

                // Python helper will clean up immediately after reading
                // Simple and clean - no complex tracking needed

            } else {
                Logger.error('Failed to write AI communication file for commId: ' + commId);
            }

        } catch (e) {
            Logger.error('Error communicating with Python helper: ' + e);
        }
    }

    // Clean up all temporary communication files
    _cleanupTempFiles() {
        try {
            // Simple cleanup: just remove any yarr temp files we might have created
            let tempDir = GLib.get_tmp_dir();
            let dir = Gio.File.new_for_path(tempDir);

            // Only look for our specific pattern - safe and targeted
            let enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let fileInfo;
            let cleanedCount = 0;

            while ((fileInfo = enumerator.next_file(null))) {
                let fileName = fileInfo.get_name();
                // Only touch files that match our exact pattern
                if (fileName.startsWith('yarr_ai_') && fileName.endsWith('.tmp')) {
                    let filePath = tempDir + '/' + fileName;
                    let file = Gio.File.new_for_path(filePath);
                    try {
                        file.delete(null);
                        cleanedCount++;
                    } catch (deleteError) {
                        Logger.debug(`Could not delete temp file ${fileName}: ${deleteError}`);
                    }
                }
            }

            if (cleanedCount > 0) {
                Logger.debug(`Cleaned up ${cleanedCount} temporary files`);
            }
        } catch (e) {
            Logger.error('Error in _cleanupTempFiles: ' + e);
        }
    }

    // CRITICAL FIX: Direct AI response insertion without list refresh
    _insertAIResponseDirectly(item, aiResponse) {
        try {
            Logger.debug(`_insertAIResponseDirectly called for item: "${item.title}" with AI response length: ${aiResponse ? aiResponse.length : 0}`);

            if (!item || !item.key || !aiResponse) {
                Logger.debug('Missing required data for direct AI response insertion');
                Logger.debug(`  item: ${!!item}, key: ${item?.key}, aiResponse: ${!!aiResponse}`);
                return false;
            }

            // CRITICAL FIX: Use stored DOM references for reliable article identification
            if (this.desklet._articleDOMRefs && this.desklet._articleDOMRefs.has(item.key)) {
                const domRef = this.desklet._articleDOMRefs.get(item.key);
                Logger.debug(`Found DOM reference for article key: ${item.key}`);

                // Check if AI response already exists
                const subChildren = domRef.subItemBox.get_children();
                if (subChildren.length > 1) {
                    // AI response already exists, update it
                    const existingAiLabel = subChildren[1];
                    if (existingAiLabel && existingAiLabel.set_text) {
                        existingAiLabel.set_text(aiResponse);
                        Logger.debug(`Updated existing AI response for article: ${item.title}`);
                        return true;
                    }
                } else {
                    // No AI response yet, create and insert it
                    Logger.debug(`Creating new AI response label for article: ${item.title}`);
                    const aiLabel = new St.Label({
                        text: aiResponse,
                        style: this.desklet.ai_fontstyle || 'font-size: 0.9em; color: #888888; font-style: italic;',
                        x_expand: true,
                        x_align: St.Align.START
                    });

                    // Apply proper styling to match existing AI responses
                    aiLabel.clutter_text.set_line_wrap(true);
                    aiLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
                    aiLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

                    // Insert after the title
                    domRef.subItemBox.add(aiLabel);
                    Logger.debug(`Inserted new AI response for article: ${item.title}`);
                    return true;
                }
            } else {
                Logger.debug(`No DOM reference found for article key: ${item.key}`);
                Logger.debug(`Available keys: ${this.desklet._articleDOMRefs ? Array.from(this.desklet._articleDOMRefs.keys()).join(', ') : 'none'}`);
                Logger.debug(`AI response will be visible on next natural display update`);
                return false;
            }

        } catch (e) {
            Logger.error('Error in _insertAIResponseDirectly: ' + e);
            return false;
        }
    }

    // Helper method to normalize titles for comparison (handle HTML entities, etc.)
    _normalizeTitle(title) {
        if (!title) return '';

        // Decode HTML entities and normalize
        let normalized = title
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#8211;/g, '-')
            .replace(/&#8212;/g, '--')
            .replace(/&#8216;/g, "'")
            .replace(/&#8217;/g, "'")
            .replace(/&#8220;/g, '"')
            .replace(/&#8221;/g, '"')
            .replace(/&#8230;/g, '...')
            .replace(/&nbsp;/g, ' ')
            .trim();

        return normalized;
    }



    _makeDraggable(actor) {
        actor._dragging = false;
        actor._dragStartX = 0;
        actor._dragStartY = 0;

        this.desklet._signals.connect(actor, 'button-press-event', (clickedActor, event) => {
            if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;

            let [stageX, stageY] = event.get_coords();
            let [actorX, actorY] = clickedActor.get_transformed_position();

            clickedActor._dragging = true;
            clickedActor._dragStartX = stageX - actorX;
            clickedActor._dragStartY = stageY - actorY;

            return Clutter.EVENT_STOP;
        });

        this.desklet._signals.connect(actor, 'motion-event', (motionActor, event) => {
            if (!motionActor._dragging) return Clutter.EVENT_PROPAGATE;

            let [stageX, stageY] = event.get_coords();
            motionActor.set_position(
                stageX - motionActor._dragStartX,
                stageY - motionActor._dragStartY
            );

            return Clutter.EVENT_STOP;
        });

        this.desklet._signals.connect(actor, 'button-release-event', (releasedActor, event) => {
            releasedActor._dragging = false;
            return Clutter.EVENT_STOP;
        });
    }

    // Method to update header title to show feed loading progress
    updateHeaderTitle(text) {
        if (this.desklet.headTitle) {
            // Clear any existing timeout to prevent overlapping updates
            if (this._headerUpdateTimeout) {
                GLib.source_remove(this._headerUpdateTimeout);
                this._headerUpdateTimeout = null;
            }

            // Update the title immediately
            this.desklet.headTitle.set_text(text);

            // If this is a completion message (contains articles/favorites), clear it after 8 seconds
            if (text && (text.includes('articles') || text.includes('favorites'))) {
                this._headerUpdateTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 8, () => {
                    if (this.desklet.headTitle) {
                        // Only clear if we still have the same text (user hasn't manually changed it)
                        const currentText = this.desklet.headTitle.get_text();
                        if (currentText === text) {
                            this.desklet.headTitle.set_text('');
                        }
                    }
                    this._headerUpdateTimeout = null;
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
    }

    // Method to set a simple header title (for status updates)
    setSimpleHeaderTitle(text) {
        if (this.desklet.headTitle) {
            this.desklet.headTitle.set_text(text || 'Yarr');
        }
    }

    // Method to reset header to clean state
    resetHeader() {
        if (this.desklet.headTitle) {
            this.desklet.headTitle.set_text('Yarr');
        }
    }

    // Build and update header feed buttons
    buildHeaderFeedButtons() {
        if (!this.desklet.headerFeedButtonsContainer) {
            return;
        }

        // Prevent multiple calls in the same execution cycle
        if (this._isBuildingHeaderButtons) {
            Logger.debug("Header feed buttons already being built, skipping duplicate call");
            return;
        }
        this._isBuildingHeaderButtons = true;

        // Hide container if setting is disabled
        if (!this.desklet.enableHeaderFeedButtons) {
            this.desklet.headerFeedButtonsContainer.hide();
            return;
        }

        // Show container if setting is enabled
        this.desklet.headerFeedButtonsContainer.show();

        // Clear existing buttons - using remove_all_children() to prevent visual blinks
        this.desklet.headerFeedButtonsContainer.remove_all_children();

        // Only show buttons if there are active feeds
        if (!this.desklet.feeds || this.desklet.feeds.length === 0) {
            return;
        }

        // Add label
        let labelBox = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 4px; padding-right: 8px;'
        });

        let labelIcon = new St.Icon({
            icon_name: 'view-list-symbolic',
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 14,
            style: 'padding-top: 2px;'
        });

        let labelText = new St.Label({
            text: _('Feeds:'),
            style: 'font-size: 11px; padding-top: 2px; color: rgba(255,255,255,0.8);'
        });

        labelBox.add(labelIcon);
        labelBox.add(labelText);
        this.desklet.headerFeedButtonsContainer.add(labelBox);

        // Add Enable All button
        let enableAllButton = new St.Button({
            style_class: 'yarr-button',
            style: 'padding: 2px 8px; margin-right: 8px; background-color: rgba(0,255,0,0.2); border: 1px solid rgba(0,255,0,0.4); border-radius: 4px;',
            reactive: true
        });

        let enableAllIcon = new St.Icon({
            icon_name: 'view-show-symbolic',
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 12
        });

        let enableAllLabel = new St.Label({
            text: _('Enable All'),
            style: 'font-size: 10px; color: rgba(255,255,255,0.9); padding-left: 4px;'
        });

        let enableAllBox = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 2px;'
        });

        enableAllBox.add(enableAllIcon);
        enableAllBox.add(enableAllLabel);
        enableAllButton.set_child(enableAllBox);

        this.desklet._signals.connect(enableAllButton, 'clicked', () => {
            Logger.debug('Enable All button clicked');

            // Enable display for ALL feeds (not just active ones)
            this.desklet.feeds.forEach(feed => {
                feed.runtimeDisplayEnabled = true;
                Logger.debug(`Enabled display for feed: ${feed.name}`);
            });

            // Schedule display update asynchronously to prevent UI blocking
            setTimeout(() => {
                if (this.desklet.uiDisplay && typeof this.desklet.uiDisplay.displayItems === 'function') {
                    this.desklet.uiDisplay.displayItems();
                    Logger.debug('Enable All feeds - display refreshed');
                }
            }, 1);

            // Save states to database asynchronously
            if (this.desklet.saveFeedButtonStates) {
                this.desklet.saveFeedButtonStates().catch(e => {
                    Logger.error('Error saving feed button states: ' + e);
                });
            }
        });

        this.desklet.headerFeedButtonsContainer.add(enableAllButton);

        // Add Disable All button
        let disableAllButton = new St.Button({
            style_class: 'yarr-button',
            style: 'padding: 2px 8px; margin-right: 8px; background-color: rgba(255,0,0,0.2); border: 1px solid rgba(255,0,0,0.4); border-radius: 4px;',
            reactive: true
        });

        let disableAllIcon = new St.Icon({
            icon_name: 'view-hidden-symbolic',
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 12
        });

        let disableAllLabel = new St.Label({
            text: _('Disable All'),
            style: 'font-size: 10px; color: rgba(255,255,255,0.9); padding-left: 4px;'
        });

        let disableAllBox = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 2px;'
        });

        disableAllBox.add(disableAllIcon);
        disableAllBox.add(disableAllLabel);
        disableAllButton.set_child(disableAllBox);

        this.desklet._signals.connect(disableAllButton, 'clicked', () => {
            Logger.debug('Disable All button clicked');

            // Disable display for ALL feeds (not just active ones)
            this.desklet.feeds.forEach(feed => {
                feed.runtimeDisplayEnabled = false;
                Logger.debug(`Disabled display for feed: ${feed.name}`);
            });

            // Schedule display update asynchronously to prevent UI blocking
            setTimeout(() => {
                if (this.desklet.uiDisplay && typeof this.desklet.uiDisplay.displayItems === 'function') {
                    this.desklet.uiDisplay.displayItems();
                    Logger.debug('Disable All feeds - display refreshed');
                }
            }, 1);

            // Save states to database asynchronously
            if (this.desklet.saveFeedButtonStates) {
                this.desklet.saveFeedButtonStates().catch(e => {
                    Logger.error('Error saving feed button states: ' + e);
                });
            }
        });

        this.desklet.headerFeedButtonsContainer.add(disableAllButton);

        // Add feed buttons
        this.desklet.feeds.forEach((feed, index) => {
            if (!feed.active) return; // Skip inactive feeds

            // Initialize runtime display state if not set
            if (typeof feed.runtimeDisplayEnabled === 'undefined') {
                feed.runtimeDisplayEnabled = true;
            }

            let buttonBox = new St.BoxLayout({
                vertical: false,
                style: 'spacing: 4px; padding: 2px 6px; border-radius: 4px;',
                reactive: true
            });

            // Color indicator with conditional styling for disabled feeds
            let colorIndicatorStyle = `width: 8px; height: 8px; border-radius: 2px;`;
            if (feed.runtimeDisplayEnabled) {
                colorIndicatorStyle += ` background-color: ${feed.labelcolor || '#ffffff'};`;
            } else {
                // Make color indicator more muted for disabled feeds
                const baseColor = feed.labelcolor || '#ffffff';
                colorIndicatorStyle += ` background-color: ${baseColor}; opacity: 0.4;`;
            }

            let colorIndicator = new St.BoxLayout({
                style: colorIndicatorStyle
            });

            // Feed name with conditional styling for disabled feeds
            let feedNameStyle = 'font-size: 11px;';
            if (feed.runtimeDisplayEnabled) {
                feedNameStyle += ' color: rgba(255,255,255,0.9);';
            } else {
                feedNameStyle += ' color: rgba(128,128,128,0.5);'; // More muted grey for disabled feeds
            }

            let feedName = new St.Label({
                text: feed.name,
                style: feedNameStyle
            });

            buttonBox.add(colorIndicator);
            buttonBox.add(feedName);

            // Add visual indicator for disabled feeds
            if (!feed.runtimeDisplayEnabled) {
                let disabledIcon = new St.Icon({
                    icon_name: 'view-hidden-symbolic',
                    icon_type: St.IconType.SYMBOLIC,
                    icon_size: 10,
                    style: 'color: rgba(128,128,128,0.6); margin-left: 4px;'
                });
                buttonBox.add(disabledIcon);
            }

            // Make button interactive
            this.desklet._signals.connect(buttonBox, 'button-press-event', () => {
                feed.runtimeDisplayEnabled = !feed.runtimeDisplayEnabled;

                // Update button appearance
                if (feed.runtimeDisplayEnabled) {
                    buttonBox.set_style('background-color: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3);');
                    feedName.set_style('font-size: 11px; color: rgba(255,255,255,0.9);');
                    // Remove disabled icon if it exists
                    const disabledIcon = buttonBox.get_child_at_index(2);
                    if (disabledIcon && disabledIcon.icon_name === 'view-hidden-symbolic') {
                        buttonBox.remove_child(disabledIcon);
                    }
                } else {
                    buttonBox.set_style('background-color: rgba(128,128,128,0.1); border: 1px solid rgba(128,128,128,0.2);');
                    feedName.set_style('font-size: 11px; color: rgba(128,128,128,0.5);');
                    // Add disabled icon if it doesn't exist
                    const disabledIcon = buttonBox.get_child_at_index(2);
                    if (!disabledIcon || disabledIcon.icon_name !== 'view-hidden-symbolic') {
                        let newDisabledIcon = new St.Icon({
                            icon_name: 'view-hidden-symbolic',
                            icon_type: St.IconType.SYMBOLIC,
                            icon_size: 10,
                            style: 'color: rgba(128,128,128,0.6); margin-left: 4px;'
                        });
                        buttonBox.add(newDisabledIcon);
                    }
                }

                // Schedule display update asynchronously to prevent UI blocking
                setTimeout(() => {
                    if (this.desklet.uiDisplay && typeof this.desklet.uiDisplay.displayItems === 'function') {
                        this.desklet.uiDisplay.displayItems();
                        Logger.debug(`Feed "${feed.name}" toggled - display refreshed`);
                    }
                }, 1);

                // Save state to database asynchronously
                if (this.desklet.saveFeedButtonStates) {
                    this.desklet.saveFeedButtonStates().catch(e => {
                        Logger.error('Error saving feed button states: ' + e);
                    });
                }

                return Clutter.EVENT_STOP;
            });

            // Set initial button appearance
            if (feed.runtimeDisplayEnabled) {
                buttonBox.set_style('background-color: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3);');
            } else {
                buttonBox.set_style('background-color: rgba(128,128,128,0.1); border: 1px solid rgba(128,128,128,0.2);');
            }

            this.desklet.headerFeedButtonsContainer.add(buttonBox);
        });

        // Add flexible space at the end
        this.desklet.headerFeedButtonsContainer.add(new St.Bin({ x_expand: true }));

        // Reset the building flag
        this._isBuildingHeaderButtons = false;
    }

    // Cleanup method to prevent memory leaks
    cleanup() {
        if (this._headerUpdateTimeout) {
            GLib.source_remove(this._headerUpdateTimeout);
            this._headerUpdateTimeout = null;
        }

        // Clean up any active tooltip
        if (this._currentTooltip) {
            this._currentTooltip.hide();
            this._currentTooltip = null;
        }

        this._cleanupTempFiles(); // Call the new cleanup method
    }
}



module.exports = { UIDisplay };
