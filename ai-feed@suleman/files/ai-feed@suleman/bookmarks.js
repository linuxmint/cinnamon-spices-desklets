// Bookmark Storage -- persists bookmarked feed items to disk
// Stores in XDG data dir: ~/.local/share/ai-feed-bookmarks.json
// Uses async Gio file IO to avoid blocking the main loop.

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const ByteArray = imports.byteArray;

var BookmarkStore = class BookmarkStore {
    constructor(dataDir) {
        this._dir = dataDir || GLib.get_user_data_dir();
        this._path = this._dir + '/ai-feed-bookmarks.json';
        this._bookmarks = [];
        this._loaded = false;
    }

    // Async load. Callback (optional) fires when load completes.
    load(callback) {
        let file = Gio.File.new_for_path(this._path);
        file.load_contents_async(null, (src, res) => {
            try {
                let [ok, contents] = src.load_contents_finish(res);
                if (ok) {
                    let text = ByteArray.toString(contents);
                    let parsed = JSON.parse(text);
                    this._bookmarks = Array.isArray(parsed) ? parsed : [];
                }
            } catch (e) {
                // NOT_FOUND on first run is expected; other errors get logged
                if (!(e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))) {
                    global.logError('[AIFeed] Bookmark load error: ' + e.message);
                }
                this._bookmarks = [];
            }
            this._loaded = true;
            if (callback) callback();
        });
    }

    // Async fire-and-forget save.
    save() {
        try {
            GLib.mkdir_with_parents(this._dir, 0o755);
            let json = JSON.stringify(this._bookmarks, null, 2);
            let file = Gio.File.new_for_path(this._path);
            file.replace_contents_async(json, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null,
                (src, res) => {
                    try { src.replace_contents_finish(res); }
                    catch (e) { global.logError('[AIFeed] Bookmark save error: ' + e.message); }
                });
        } catch (e) {
            global.logError('[AIFeed] Bookmark save dispatch error: ' + e.message);
        }
    }

    add(feedItem) {
        if (!feedItem || !feedItem.url) return;
        if (this.has(feedItem.url)) return;
        let bookmark = Object.assign({}, feedItem, {
            savedAt: Math.floor(GLib.get_real_time() / 1000000)
        });
        this._bookmarks.push(bookmark);
        this.save();
    }

    remove(url) {
        let before = this._bookmarks.length;
        this._bookmarks = this._bookmarks.filter(b => b.url !== url);
        if (this._bookmarks.length !== before) {
            this.save();
        }
    }

    has(url) {
        return this._bookmarks.some(b => b.url === url);
    }

    search(query) {
        if (!query || query.trim() === '') return this.getAll();
        let lower = query.toLowerCase();
        return this._bookmarks.filter(b => {
            let title = (b.title || '').toLowerCase();
            return title.indexOf(lower) !== -1;
        });
    }

    getGroupedBySource() {
        let groups = {};
        for (let b of this._bookmarks) {
            let src = b.source || 'unknown';
            if (!groups[src]) groups[src] = [];
            groups[src].push(b);
        }
        return groups;
    }

    getAll() {
        return this._bookmarks.slice();
    }

    getCount() {
        return this._bookmarks.length;
    }
};
