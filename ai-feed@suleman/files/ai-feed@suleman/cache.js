// Feed Cache -- persists feed data to disk for offline fallback
// Stores in XDG cache dir: ~/.cache/ai-feed/cache.json

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const ByteArray = imports.byteArray;

var FeedCache = class FeedCache {
    constructor(cacheDir) {
        this._dir = cacheDir || GLib.get_user_cache_dir() + '/ai-feed';
        this._path = this._dir + '/cache.json';
        GLib.mkdir_with_parents(this._dir, 0o755);
    }

    read() {
        try {
            let file = Gio.File.new_for_path(this._path);
            if (!file.query_exists(null)) return null;
            let [ok, contents] = file.load_contents(null);
            if (!ok) return null;
            let text = ByteArray.toString(contents);
            return JSON.parse(text);
        } catch (e) {
            global.logError('[AIFeed] Cache read error: ' + e.message);
            return null;
        }
    }

    write(feedData) {
        try {
            feedData.lastUpdated = Math.floor(GLib.get_real_time() / 1000000);
            let json = JSON.stringify(feedData, null, 2);
            let file = Gio.File.new_for_path(this._path);
            file.replace_contents(json, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            return true;
        } catch (e) {
            global.logError('[AIFeed] Cache write error: ' + e.message);
            return false;
        }
    }

    getAge() {
        try {
            let data = this.read();
            if (!data || !data.lastUpdated) return Infinity;
            let now = Math.floor(GLib.get_real_time() / 1000000);
            return now - data.lastUpdated;
        } catch (e) {
            return Infinity;
        }
    }
};
