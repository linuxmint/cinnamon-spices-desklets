const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Soup = imports.gi.Soup;
const Settings = imports.ui.settings;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

class NewsFeedDesklet extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);

        this.settings = new Settings.DeskletSettings(this, "newsfeed@Paul163-ai", deskletId);

        // Bind settings — use .bind(this) to ensure correct context in callbacks
        this.settings.bindProperty(Settings.BindingDirection.IN, "source-google", "useGoogle", this.onSettingsChanged.bind(this), null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "source-bbc",    "useBBC",    this.onSettingsChanged.bind(this), null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "source-mint",   "useMint",   this.onSettingsChanged.bind(this), null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "story-count",   "storyCount",   this.onSettingsChanged.bind(this), null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-width", "deskletWidth", this.onVisualsChanged.bind(this), null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "update-interval", "updateInterval", this.onSettingsChanged.bind(this), null);

        this.sourceMap = {
            "useGoogle": { name: "Google News",    url: "https://news.google.com/rss" },
            "useBBC":    { name: "BBC World",       url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
            "useMint":   { name: "Linux Mint Blog", url: "https://blog.linuxmint.com/?feed=rss2" }
        };

        // Reuse a single Soup session for all requests
        this.session = new Soup.Session({ user_agent: 'Cinnamon-NewsDesklet/1.0' });

        this.timeoutId = null;
        this.setupUI();
        this.updateAllFeeds();
    }

    setupUI() {
        this.container = new St.BoxLayout({ vertical: true, style_class: "news-container" });
        this.container.set_width(this.deskletWidth);
        this.setContent(this.container);
    }

    onVisualsChanged() {
        this.container.set_width(this.deskletWidth);
    }

    onSettingsChanged() {
        if (this.timeoutId) {
            GLib.source_remove(this.timeoutId);
            this.timeoutId = null;
        }
        this.updateAllFeeds();
    }

    // Override destroy() to prevent the timer firing after desklet removal
    destroy() {
        if (this.timeoutId) {
            GLib.source_remove(this.timeoutId);
            this.timeoutId = null;
        }
        super.destroy();
    }

    updateAllFeeds() {
        this.container.destroy_all_children();
        this.container.add_child(new St.Label({ text: "Updating feeds...", style_class: "status-label" }));

        let activeSources = [];
        for (let key in this.sourceMap) {
            if (this[key]) activeSources.push(this.sourceMap[key]);
        }

        if (activeSources.length === 0) {
            this.displayError("No sources selected.");
            this._scheduleNextUpdate();
            return;
        }

        // Track completion manually instead of Promise.all so one failed
        // feed does not prevent the others from rendering.
        let results = [];
        let completed = 0;
        let total = activeSources.length;

        const onDone = () => {
            completed++;
            if (completed < total) return;

            // All fetches finished (success or failure) — render what we have
            this.container.destroy_all_children();
            let anySuccess = false;
            results.forEach(r => {
                if (r.xml) {
                    this.parseAndDisplay(r.name, r.xml);
                    anySuccess = true;
                } else {
                    // Show a per-source error row instead of wiping everything
                    let errHeader = new St.Label({
                        text: r.name.toUpperCase() + " — failed to load",
                        style_class: "error-label"
                    });
                    this.container.add_child(errHeader);
                }
            });

            if (!anySuccess) {
                this.displayError("All feeds failed to load.");
            }

            this._scheduleNextUpdate();
        };

        activeSources.forEach(source => {
            let entry = { name: source.name, xml: null };
            results.push(entry);

            this.fetchFeed(source.url,
                (xml) => {
                    entry.xml = xml;
                    onDone();
                },
                (err) => {
                    // entry.xml stays null — error row will be shown
                    global.logError("NewsFeedDesklet: fetch failed for " + source.name + ": " + err);
                    onDone();
                }
            );
        });
    }

    _scheduleNextUpdate() {
        if (this.timeoutId) {
            GLib.source_remove(this.timeoutId);
            this.timeoutId = null;
        }
        this.timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            this.updateInterval * 60,
            () => {
                this.timeoutId = null;
                this.updateAllFeeds();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    fetchFeed(url, onSuccess, onError) {
        let message = Soup.Message.new('GET', url);

        this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
            try {
                const bytes = session.send_and_read_finish(result);
                // Decode Uint8Array properly — .toString() produces "1,2,3,..."
                const decoder = new TextDecoder('utf-8');
                const xml = decoder.decode(bytes.get_data());
                onSuccess(xml);
            } catch (e) {
                onError(e.message || String(e));
            }
        });
    }

    displayError(message) {
        this.container.destroy_all_children();
        this.container.add_child(new St.Label({ text: message, style_class: "error-label" }));
    }

    parseAndDisplay(sourceName, xml) {
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;
        let count = 0;

        let sourceHeader = new St.Label({ text: sourceName.toUpperCase(), style_class: "source-header" });
        this.container.add_child(sourceHeader);

        while ((match = itemRegex.exec(xml)) !== null && count < this.storyCount) {
            let itemContent = match[1];

            let title = itemContent.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "Untitled";
            let link  = itemContent.match(/<link>([\s\S]*?)<\/link>/)?.[1]  || "";

            // Strip CDATA and decode HTML entities from both title and link
            title = this._cleanText(title);
            link  = this._cleanText(link).trim();

            // Skip items with empty or obviously invalid links
            if (!link || link === "#") {
                // Try <guid> as a fallback URL
                let guid = itemContent.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1] || "";
                guid = this._cleanText(guid).trim();
                if (guid.startsWith("http")) link = guid;
            }

            let btn = new St.Button({
                label: "  • " + title,
                style_class: "news-button",
                reactive: true,
                x_align: St.Align.START
            });

            // Capture link in closure
            const finalLink = link;
            btn.connect('clicked', () => {
                if (finalLink) {
                    try {
                        Gio.app_info_launch_default_for_uri(finalLink, null);
                    } catch (e) {
                        global.logError("NewsFeedDesklet: could not open link: " + e);
                    }
                }
            });

            this.container.add_child(btn);
            count++;
        }

        this.container.add_child(new St.Label({ text: " ", style_class: "section-spacer" }));
    }

    _cleanText(str) {
        return str
            .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
            .replace(/&amp;/g,  "&")
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g,   "<")
            .replace(/&gt;/g,   ">")
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
            .trim();
    }
}

function main(metadata, deskletId) {
    return new NewsFeedDesklet(metadata, deskletId);
}
