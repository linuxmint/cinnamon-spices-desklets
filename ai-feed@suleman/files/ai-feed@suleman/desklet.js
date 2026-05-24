// AIFeed -- Cinnamon Desklet
// Aggregates trending AI repos, papers, models, news, and discussion

const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;

const UUID = 'ai-feed@suleman';
const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID].path;

imports.searchPath.unshift(DESKLET_ROOT);
const HttpClient = imports.httpClient;
const FeedCache = imports.cache;
const BookmarkStore = imports.bookmarks;
const BookmarksDialog = imports.bookmarksDialog;
const GitHubSource = imports.sources.github;
const ArXivSource = imports.sources.arxiv;
const HNSource = imports.sources.hackernews;
const HFSource = imports.sources.huggingface;

const SOURCE_ICONS = {
    github: '◆',
    arxiv: '◇',
    hackernews: '●',
    huggingface: '◈'
};

const SOURCE_LABELS = {
    github: 'GitHub Trending',
    arxiv: 'arXiv Papers',
    hackernews: 'Hacker News',
    huggingface: 'HuggingFace'
};

const SOURCE_FETCHERS = {
    github: GitHubSource,
    arxiv: ArXivSource,
    hackernews: HNSource,
    huggingface: HFSource
};

function AIFeedDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

function main(metadata, deskletId) {
    return new AIFeedDesklet(metadata, deskletId);
}

AIFeedDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.metadata['prevent-decorations'] = true;
        this._updateDecoration();

        this.settings = new Settings.DeskletSettings(this, UUID, deskletId);
        this._bindSettings();

        this._http = new HttpClient.HttpClient(this.userAgent, this.requestTimeout);
        this._cache = new FeedCache.FeedCache();

        this._bookmarkStore = new BookmarkStore.BookmarkStore();
        this._bookmarkStore.load();

        this._feedData = {};

        this._buildUI();
        this._refresh();
    },

    _bindSettings: function() {
        let bind = (key, prop) => {
            this.settings.bindProperty(Settings.BindingDirection.IN, key, prop, this._onSettingChanged);
        };

        bind('refresh-interval', 'refreshInterval');
        bind('source-order-1', 'sourceOrder1');
        bind('source-order-2', 'sourceOrder2');
        bind('source-order-3', 'sourceOrder3');
        bind('source-order-4', 'sourceOrder4');
        bind('github-enabled', 'githubEnabled');
        bind('github-count', 'githubCount');
        bind('arxiv-enabled', 'arxivEnabled');
        bind('arxiv-count', 'arxivCount');
        bind('hn-enabled', 'hnEnabled');
        bind('hn-count', 'hnCount');
        bind('hf-enabled', 'hfEnabled');
        bind('hf-count', 'hfCount');
        bind('github-period', 'githubPeriod');
        bind('github-languages', 'githubLanguages');
        bind('arxiv-categories', 'arxivCategories');
        bind('arxiv-max-results', 'arxivMaxResults');
        bind('hn-keywords', 'hnKeywords');
        bind('hn-min-points', 'hnMinPoints');
        bind('hn-sort', 'hnSort');
        bind('hf-show-models', 'hfShowModels');
        bind('hf-show-datasets', 'hfShowDatasets');
        bind('hf-show-spaces', 'hfShowSpaces');
        bind('background-color', 'backgroundColor');
        bind('font-color', 'fontColor');
        bind('accent-color', 'accentColor');
        bind('header-color', 'headerColor');
        bind('font-scale', 'fontScale');
        bind('desklet-width', 'deskletWidth');
        bind('desklet-height', 'deskletHeight');
        bind('github-token', 'githubToken');
        bind('hf-token', 'hfToken');
        bind('request-timeout', 'requestTimeout');
        bind('user-agent', 'userAgent');
        bind('debug-logging', 'debugLogging');
    },

    _onSettingChanged: function() {
        if (this._http) this._http.destroy();
        this._http = new HttpClient.HttpClient(this.userAgent, this.requestTimeout);

        this._cancelTimer();
        this._buildUI();
        this._refresh();
    },

    _log: function(msg) {
        if (this.debugLogging) {
            global.log('[AIFeed] ' + msg);
        }
    },

    _fs: function(base) {
        let scale = this.fontScale || 1.0;
        return 'font-size: ' + Math.round(base * scale) + 'px;';
    },

    _buildUI: function() {
        let width = this.deskletWidth || 400;
        let height = this.deskletHeight || 500;
        let scale = this.fontScale || 1.0;

        this._rootBox = new St.BoxLayout({
            vertical: true,
            style_class: 'feed-root',
            style: 'width: ' + width + 'px;'
                + 'height: ' + height + 'px;'
                + 'background-color: ' + (this.backgroundColor || 'rgba(28,28,32,0.92)') + ';'
                + 'border-radius: 8px;'
                + this._fs(13)
        });

        this._buildHeader();

        // Single outer scroll wrapping all source sections so deskletHeight caps total
        let headerAllowance = Math.round(50 * scale);
        let scrollHeight = Math.max(100, height - headerAllowance);
        let outerScroll = new St.ScrollView({
            style_class: 'feed-outer-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC
        });
        outerScroll.set_height(scrollHeight);

        let contentBox = new St.BoxLayout({ vertical: true });
        outerScroll.add_actor(contentBox);

        this._sourceSections = {};
        let sourceOrder = this._getSourceOrder();
        sourceOrder.forEach((source) => {
            if (!this._isSourceEnabled(source)) return;
            let section = this._buildSourceSection(source);
            this._sourceSections[source] = section;
            contentBox.add(section.container);
        });

        this._rootBox.add(outerScroll, { expand: true });

        this.setContent(this._rootBox);
    },

    _buildHeader: function() {
        let headerBox = new St.BoxLayout({
            vertical: false,
            style_class: 'feed-header',
            style: 'border-bottom: 1px solid rgba(160,180,210,0.2);'
        });

        let titleLabel = new St.Label({
            text: '◆ AI FEED',
            style_class: 'feed-header-title',
            style: 'color: ' + (this.headerColor || 'rgba(160,180,210,0.85)') + ';'
                + this._fs(14)
        });
        titleLabel.clutter_text.set_ellipsize(3);
        headerBox.add(titleLabel, { expand: true, x_fill: true });

        this._updatedLabel = new St.Label({
            text: '',
            style_class: 'feed-header-updated',
            style: 'color: ' + (this.accentColor || 'rgba(160,180,210,0.5)') + ';'
                + 'padding-right: 8px;'
                + this._fs(11)
        });
        headerBox.add(this._updatedLabel);

        let refreshBtn = new St.Button({
            label: '↻',
            style_class: 'feed-header-btn',
            style: 'color: ' + (this.accentColor || 'rgba(160,180,210,0.7)') + ';'
                + this._fs(14)
        });
        refreshBtn.connect('clicked', () => {
            this._cancelTimer();
            this._refresh();
        });
        headerBox.add(refreshBtn);

        let bookmarkBtn = new St.Button({
            label: '★',
            style_class: 'feed-header-btn',
            style: 'color: ' + (this.accentColor || 'rgba(160,180,210,0.7)') + ';'
                + 'padding-left: 6px;'
                + this._fs(14)
        });
        bookmarkBtn.connect('clicked', () => {
            try {
                let dialog = new BookmarksDialog.BookmarksDialog(this._bookmarkStore, {
                    background: this.backgroundColor,
                    font: this.fontColor,
                    accent: this.accentColor
                });
                dialog.open();
            } catch (e) {
                global.logError('[AIFeed] Bookmark dialog failed: ' + e.message + '\n' + e.stack);
            }
        });
        headerBox.add(bookmarkBtn);

        this._rootBox.add(headerBox);
    },

    _buildSourceSection: function(source) {
        let container = new St.BoxLayout({
            vertical: true,
            style_class: 'source-section'
        });

        let icon = SOURCE_ICONS[source] || '';
        let label = SOURCE_LABELS[source] || source;

        let header = new St.Label({
            text: icon + ' ' + label,
            style_class: 'source-header',
            style: 'color: ' + (this.accentColor || 'rgba(160,180,210,0.85)') + ';'
                + this._fs(11)
        });
        container.add(header);

        let itemBox = new St.BoxLayout({ vertical: true });
        container.add(itemBox);

        return { container: container, itemBox: itemBox };
    },

    _populateSource: function(source, items) {
        let section = this._sourceSections[source];
        if (!section) return;

        section.itemBox.destroy_all_children();

        if (!items || items.length === 0) {
            let unavail = new St.Label({
                text: 'No data available',
                style_class: 'source-unavailable',
                style: 'color: ' + (this.accentColor || 'rgba(160,180,210,0.4)') + ';'
                    + this._fs(11)
            });
            section.itemBox.add(unavail);
            return;
        }

        items.forEach((item) => {
            let row = new St.BoxLayout({
                vertical: true,
                reactive: true,
                style_class: 'feed-item',
                style: 'border-bottom: 1px solid rgba(160,180,210,0.08);'
            });

            let topLine = new St.BoxLayout({ vertical: false });

            let titleLabel = new St.Label({
                text: item.title || '',
                style_class: 'item-title',
                style: 'color: ' + (this.fontColor || 'rgba(230,230,235,0.95)') + ';'
                    + this._fs(12)
            });
            titleLabel.clutter_text.set_ellipsize(3);
            topLine.add(titleLabel, { expand: true, x_fill: true });

            if (item.meta) {
                let metaPrefix = '';
                if (item.metaLabel === 'stars') metaPrefix = '✳ ';
                if (item.metaLabel === 'likes') metaPrefix = '♥ ';
                let metaLabel = new St.Label({
                    text: metaPrefix + item.meta,
                    style_class: 'item-meta',
                    style: 'color: ' + (this.accentColor || 'rgba(160,180,210,0.5)') + ';'
                        + 'padding-left: 8px;'
                        + this._fs(10)
                });
                topLine.add(metaLabel);
            }

            let bmIcon = this._bookmarkStore.has(item.url) ? '★' : '☆';
            let bmBtn = new St.Button({
                label: bmIcon,
                style_class: 'item-bookmark-btn',
                style: 'color: ' + (this.accentColor || 'rgba(160,180,210,0.5)') + ';'
                    + this._fs(12)
            });
            bmBtn.connect('clicked', () => {
                if (this._bookmarkStore.has(item.url)) {
                    this._bookmarkStore.remove(item.url);
                    bmBtn.set_label('☆');
                } else {
                    this._bookmarkStore.add(item);
                    bmBtn.set_label('★');
                }
                return Clutter.EVENT_STOP;
            });
            topLine.add(bmBtn);

            row.add(topLine);

            let bottomText = '';
            if (source === 'github' && item.subtitle) {
                bottomText = item.subtitle;
            } else if (source === 'arxiv' && item.extra && item.extra.category) {
                bottomText = item.extra.category + '  ' + item.meta;
            } else if (source === 'hackernews' && item.extra) {
                bottomText = item.meta + '  ' + (item.extra.timeAgo || '');
            } else if (source === 'huggingface' && item.extra) {
                bottomText = item.extra.type || '';
            }

            if (bottomText) {
                let subLabel = new St.Label({
                    text: bottomText,
                    style_class: 'item-subtitle',
                    style: 'color: ' + (this.accentColor || 'rgba(160,180,210,0.4)') + ';'
                        + this._fs(10)
                });
                subLabel.clutter_text.set_ellipsize(3);
                row.add(subLabel);
            }

            row.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 1) {
                    try {
                        Gio.AppInfo.launch_default_for_uri(item.url, null);
                    } catch (e) {
                        global.logError('[AIFeed] Failed to open URL: ' + e.message);
                    }
                }
                return Clutter.EVENT_STOP;
            });

            section.itemBox.add(row);
        });
    },

    _getSourceOrder: function() {
        let order = [
            this.sourceOrder1 || 'github',
            this.sourceOrder2 || 'arxiv',
            this.sourceOrder3 || 'hackernews',
            this.sourceOrder4 || 'huggingface'
        ];
        let seen = {};
        let result = [];
        let defaults = ['github', 'arxiv', 'hackernews', 'huggingface'];
        order.forEach((s) => {
            if (!seen[s]) { seen[s] = true; result.push(s); }
        });
        defaults.forEach((s) => {
            if (!seen[s]) { seen[s] = true; result.push(s); }
        });
        return result;
    },

    _isSourceEnabled: function(source) {
        let map = {
            github: this.githubEnabled,
            arxiv: this.arxivEnabled,
            hackernews: this.hnEnabled,
            huggingface: this.hfEnabled
        };
        return map[source] !== false;
    },

    _getSourceCount: function(source) {
        let map = {
            github: this.githubCount,
            arxiv: this.arxivCount,
            hackernews: this.hnCount,
            huggingface: this.hfCount
        };
        return map[source] || 3;
    },

    _refresh: function() {
        this._log('Starting refresh cycle');

        let monitor = Gio.NetworkMonitor.get_default();
        if (!monitor.network_available) {
            this._log('Network unavailable, showing cached data');
            this._showCachedData();
            this._updatedLabel.set_text('offline');
            this._scheduleNext();
            return;
        }

        let sourceOrder = this._getSourceOrder();
        let enabledSources = sourceOrder.filter((s) => this._isSourceEnabled(s));

        this._fetchSequential(enabledSources, 0, () => {
            this._cache.write(this._feedData);
            this._updateTimestamp();
            this._scheduleNext();
        });
    },

    _fetchSequential: function(sources, index, doneCallback) {
        if (index >= sources.length) {
            doneCallback();
            return;
        }

        let source = sources[index];
        let fetcher = SOURCE_FETCHERS[source];
        if (!fetcher) {
            this._fetchSequential(sources, index + 1, doneCallback);
            return;
        }

        this._log('Fetching ' + source);

        try {
            fetcher.fetch(this._http, this, (error, items) => {
                if (error) {
                    this._log('Error fetching ' + source + ': ' + error.message);
                    let cached = this._cache.read();
                    items = (cached && cached[source]) ? cached[source] : [];
                }
                this._feedData[source] = items || [];
                this._populateSource(source, this._feedData[source]);
                this._fetchSequential(sources, index + 1, doneCallback);
            });
        } catch (e) {
            global.logError('[AIFeed] Exception fetching ' + source + ': ' + e.message);
            this._feedData[source] = [];
            this._populateSource(source, []);
            this._fetchSequential(sources, index + 1, doneCallback);
        }
    },

    _showCachedData: function() {
        let cached = this._cache.read();
        if (!cached) return;

        let sourceOrder = this._getSourceOrder();
        sourceOrder.forEach((source) => {
            if (!this._isSourceEnabled(source)) return;
            this._feedData[source] = cached[source] || [];
            this._populateSource(source, this._feedData[source]);
        });
    },

    _updateTimestamp: function() {
        let now = new Date();
        let h = String(now.getHours()).padStart(2, '0');
        let m = String(now.getMinutes()).padStart(2, '0');
        this._updatedLabel.set_text(h + ':' + m);
    },

    _scheduleNext: function() {
        let interval = (this.refreshInterval || 30) * 60;
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    },

    _cancelTimer: function() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
    },

    on_desklet_removed: function() {
        this._cancelTimer();
        if (this._http) {
            this._http.destroy();
            this._http = null;
        }
    }
};
