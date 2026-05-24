// Feed Cache -- persists feed data to disk for offline fallback
// Stores in XDG cache dir: ~/.cache/ai-feed/cache.json
// Async file IO: read() returns in-memory copy populated by ensureLoaded().

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const ByteArray = imports.byteArray;

var FeedCache = class FeedCache {
    constructor(cacheDir) {
        this._dir = cacheDir || GLib.get_user_cache_dir() + '/ai-feed';
        this._path = this._dir + '/cache.json';
        GLib.mkdir_with_parents(this._dir, 0o755);
        this._data = null;
        this._loaded = false;
    }

    // Async load — fires callback (optional) when ready. Idempotent.
    ensureLoaded(callback) {
        if (this._loaded) { if (callback) callback(); return; }
        let file = Gio.File.new_for_path(this._path);
        file.load_contents_async(null, (src, res) => {
            try {
                let [ok, contents] = src.load_contents_finish(res);
                if (ok) {
                    let text = ByteArray.toString(contents);
                    this._data = JSON.parse(text);
                }
            } catch (e) {
                if (!(e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))) {
                    global.logError('[AIFeed] Cache read error: ' + e.message);
                }
                this._data = null;
            }
            this._loaded = true;
            if (callback) callback();
        });
    }

    // Returns last-loaded data (in-memory snapshot). Call ensureLoaded() first.
    read() {
        return this._data;
    }

    // Async fire-and-forget write; updates in-memory snapshot immediately.
    write(feedData) {
        try {
            feedData.lastUpdated = Math.floor(GLib.get_real_time() / 1000000);
            this._data = feedData;
            let json = JSON.stringify(feedData, null, 2);
            let file = Gio.File.new_for_path(this._path);
            file.replace_contents_async(json, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null,
                (src, res) => {
                    try { src.replace_contents_finish(res); }
                    catch (e) { global.logError('[AIFeed] Cache write error: ' + e.message); }
                });
            return true;
        } catch (e) {
            global.logError('[AIFeed] Cache write dispatch error: ' + e.message);
            return false;
        }
    }

    getAge() {
        let data = this.read();
        if (!data || !data.lastUpdated) return Infinity;
        let now = Math.floor(GLib.get_real_time() / 1000000);
        return now - data.lastUpdated;
    }
};
