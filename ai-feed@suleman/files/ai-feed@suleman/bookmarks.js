// Bookmark Storage -- persists bookmarked feed items to disk
// Stores in XDG data dir: ~/.local/share/ai-feed-bookmarks.json

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const ByteArray = imports.byteArray;

var BookmarkStore = class BookmarkStore {
    constructor(dataDir) {
        this._dir = dataDir || GLib.get_user_data_dir();
        this._path = this._dir + '/ai-feed-bookmarks.json';
        this._bookmarks = [];
    }

    load() {
        try {
            let file = Gio.File.new_for_path(this._path);
            if (!file.query_exists(null)) {
                this._bookmarks = [];
                return;
            }
            let [ok, contents] = file.load_contents(null);
            if (!ok) {
                this._bookmarks = [];
                return;
            }
            let text = ByteArray.toString(contents);
            let parsed = JSON.parse(text);
            this._bookmarks = Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            global.logError('[AIFeed] Bookmark load error: ' + e.message);
            this._bookmarks = [];
        }
    }

    save() {
        try {
            GLib.mkdir_with_parents(this._dir, 0o755);
            let json = JSON.stringify(this._bookmarks, null, 2);
            let file = Gio.File.new_for_path(this._path);
            file.replace_contents(json, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            global.logError('[AIFeed] Bookmark save error: ' + e.message);
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
