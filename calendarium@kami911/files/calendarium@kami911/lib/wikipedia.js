/*
 * wikipedia.js — Optional Wikipedia online features for Calendarium desklet
 *
 * Provides:
 *   fetchOnThisDay(month, day, lang, callback)  — births & deaths on this day
 *   fetchFeatured(year, month, day, lang, callback) — article of the day
 *
 * Responses are cached as JSON files under GLib.get_user_cache_dir().
 * Cache TTL: 24 hours.
 *
 * All network operations are asynchronous; callback(data) is called on
 * completion with the parsed response object, or callback(null) on error.
 *
 * This module exports a single `Wikipedia` object.
 * Requires: Soup, Gio, GLib (available in Cinnamon JS environment)
 */

const Soup = imports.gi.Soup;
const Gio  = imports.gi.Gio;
const GLib = imports.gi.GLib;

var Wikipedia = {

    CACHE_DIR:      GLib.get_user_cache_dir() + "/calendarium@kami911",
    CACHE_TTL_SECS: 86400,   // 24 hours

    // Lazy-initialised Soup session
    _session: null,

    // ── Internal helpers ─────────────────────────────────────────────────

    _ensureCacheDir: function() {
        let dir = Gio.File.new_for_path(this.CACHE_DIR);
        if (!dir.query_exists(null)) {
            try { dir.make_directory_with_parents(null); } catch (e) {}
        }
    },

    _cachePath: function(type, lang, month, day) {
        let mm = (month < 10 ? '0' : '') + month;
        let dd = (day   < 10 ? '0' : '') + day;
        return this.CACHE_DIR + "/" + type + "_" + lang + "_" + mm + dd + ".json";
    },

    _isCacheFresh: function(path) {
        let file = Gio.File.new_for_path(path);
        if (!file.query_exists(null)) return false;
        try {
            let info  = file.query_info("time::modified",
                                        Gio.FileQueryInfoFlags.NONE, null);
            let mtime = info.get_modification_date_time();
            let now   = GLib.DateTime.new_now_utc();
            let diffS = now.difference(mtime) / 1000000;  // µs → s
            return diffS < this.CACHE_TTL_SECS;
        } catch (e) { return false; }
    },

    _readCache: function(path) {
        let file = Gio.File.new_for_path(path);
        try {
            let [ok, contents] = file.load_contents(null);
            if (!ok) return null;
            let text = (contents instanceof Uint8Array)
                ? new TextDecoder().decode(contents)
                : imports.byteArray.toString(contents);
            return JSON.parse(text);
        } catch (e) { return null; }
    },

    _writeCache: function(path, data) {
        try {
            let bytes = new TextEncoder().encode(JSON.stringify(data));
            let file  = Gio.File.new_for_path(path);
            file.replace_contents(bytes, null, false,
                                  Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            global.logError("Calendarium: Wikipedia cache write failed: " + e);
        }
    },

    _getSession: function() {
        if (!this._session) {
            if (Soup.MAJOR_VERSION === 2) {
                this._session = new Soup.SessionAsync();
                Soup.Session.prototype.add_feature.call(
                    this._session, new Soup.ProxyResolverDefault()
                );
                this._session.timeout = 15;
            } else {
                this._session = new Soup.Session();
                this._session.set_timeout(15);
            }
        }
        return this._session;
    },

    /**
     * Perform an async GET request, parse JSON, call callback(data|null).
     * Compatible with both Soup 2 (queue_message) and Soup 3 (send_and_read_async).
     * Validates HTTP status (200 only) and non-empty body before JSON.parse.
     */
    _fetch: function(url, callback) {
        let session = this._getSession();
        let msg;
        try {
            msg = Soup.Message.new("GET", url);
        } catch (e) {
            global.logWarning("Calendarium: Wikipedia bad URL (" + url + "): " + e);
            callback(null);
            return;
        }

        if (Soup.MAJOR_VERSION === 2) {
            session.queue_message(msg, function(sess, message) {
                if (message.status_code !== 200) {
                    global.logWarning(
                        "Calendarium: Wikipedia HTTP " + message.status_code +
                        " for " + url
                    );
                    callback(null);
                    return;
                }
                try {
                    let text = message.response_body.data;
                    if (!text) { callback(null); return; }
                    callback(JSON.parse(text));
                } catch (e) {
                    global.logWarning("Calendarium: Wikipedia parse error: " + e);
                    callback(null);
                }
            });
        } else {
            session.send_and_read_async(
                msg, GLib.PRIORITY_DEFAULT, null,
                function(sess, result) {
                    try {
                        let bytes  = sess.send_and_read_finish(result);
                        let status = msg.status_code;
                        if (status !== 200) {
                            global.logWarning(
                                "Calendarium: Wikipedia HTTP " + status +
                                " for " + url
                            );
                            callback(null);
                            return;
                        }
                        let data = bytes ? bytes.get_data() : null;
                        if (!data || data.length === 0) {
                            callback(null);
                            return;
                        }
                        let text = new TextDecoder().decode(data);
                        callback(JSON.parse(text));
                    } catch (e) {
                        global.logWarning("Calendarium: Wikipedia fetch error: " + e);
                        callback(null);
                    }
                }
            );
        }
    },

    // ── Public API ───────────────────────────────────────────────────────

    /**
     * Fetch "On This Day" data (births, deaths, events) from Wikipedia.
     * API: GET https://{lang}.wikipedia.org/api/rest_v1/feed/onthisday/all/MM/DD
     * @param {number}   month     1–12
     * @param {number}   day       1–31
     * @param {string}   lang      Language code ("en", "de", "hu", …)
     * @param {Function} callback  Called with parsed response object or null
     */
    fetchOnThisDay: function(month, day, lang, callback) {
        this._ensureCacheDir();
        let path = this._cachePath("onthisday", lang, month, day);
        if (this._isCacheFresh(path)) {
            callback(this._readCache(path));
            return;
        }
        let mm  = (month < 10 ? '0' : '') + month;
        let dd  = (day   < 10 ? '0' : '') + day;
        let url = "https://" + lang + ".wikipedia.org/api/rest_v1/feed/onthisday/all/" + mm + "/" + dd;
        let self = this;
        this._fetch(url, function(data) {
            if (data) self._writeCache(path, data);
            callback(data);
        });
    },

    /**
     * Fetch the Wikipedia "Featured Article" for a given date.
     * API: GET https://{lang}.wikipedia.org/api/rest_v1/feed/featured/YYYY/MM/DD
     * @param {number}   year
     * @param {number}   month     1–12
     * @param {number}   day       1–31
     * @param {string}   lang      Language code
     * @param {Function} callback  Called with parsed response object or null
     */
    fetchFeatured: function(year, month, day, lang, callback) {
        this._ensureCacheDir();
        let path = this._cachePath("featured_" + year, lang, month, day);
        if (this._isCacheFresh(path)) {
            callback(this._readCache(path));
            return;
        }
        let mm  = (month < 10 ? '0' : '') + month;
        let dd  = (day   < 10 ? '0' : '') + day;
        let url = "https://" + lang + ".wikipedia.org/api/rest_v1/feed/featured/"
                + year + "/" + mm + "/" + dd;
        let self = this;
        this._fetch(url, function(data) {
            if (data) self._writeCache(path, data);
            callback(data);
        });
    }
};
