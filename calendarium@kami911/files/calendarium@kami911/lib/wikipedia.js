/*
 * wikipedia.js — Optional Wikipedia online features for Calendarium desklet
 *
 * Provides:
 *   fetchOnThisDay(month, day, lang, callback)  — births & deaths on this day
 *   fetchFeatured(year, month, day, lang, callback) — article of the day
 *
 * Responses are cached as JSON files under GLib.get_user_cache_dir().
 * Cache TTL is configurable via CACHE_TTL_SECS.
 *
 * For non-English languages, English is also cached in the background so that
 * the fallback path (triggered when the selected language returns no content)
 * can be served immediately on the next call.
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
    CACHE_TTL_SECS: 43200,   // 12 hours default; desklet sets this before each call

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

    _deleteCache: function(path) {
        try { Gio.File.new_for_path(path).delete(null); } catch (e) {}
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
     * Perform an async GET request, parse JSON, call callback(data, statusCode).
     * Compatible with both Soup 2 and Soup 3.
     * On error, callback(null, statusCode) is called.
     */
    _fetch: function(url, callback) {
        let session = this._getSession();
        let msg;
        try {
            msg = Soup.Message.new("GET", url);
        } catch (e) {
            global.logWarning("Calendarium: Wikipedia bad URL (" + url + "): " + e);
            callback(null, 0);
            return;
        }

        let ua = "Calendarium/1.0 (calendarium@kami911 Cinnamon desklet; " +
                 "https://github.com/linuxmint/cinnamon-spices-desklets) GJS/Soup";
        msg.request_headers.append("User-Agent",     ua);
        msg.request_headers.append("Api-User-Agent", ua);

        if (Soup.MAJOR_VERSION === 2) {
            session.queue_message(msg, function(sess, message) {
                let status = message.status_code;
                if (status !== 200) {
                    global.logWarning("Calendarium: Wikipedia HTTP " + status + " for " + url);
                    callback(null, status);
                    return;
                }
                try {
                    let text = message.response_body.data;
                    if (!text) { callback(null, status); return; }
                    callback(JSON.parse(text), status);
                } catch (e) {
                    global.logWarning("Calendarium: Wikipedia parse error: " + e);
                    callback(null, status);
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
                            global.logWarning("Calendarium: Wikipedia HTTP " + status + " for " + url);
                            callback(null, status);
                            return;
                        }
                        let data = bytes ? bytes.get_data() : null;
                        if (!data || data.length === 0) { callback(null, status); return; }
                        let text = new TextDecoder().decode(data);
                        callback(JSON.parse(text), status);
                    } catch (e) {
                        global.logWarning("Calendarium: Wikipedia fetch error: " + e);
                        callback(null, 0);
                    }
                }
            );
        }
    },

    // ── Content validators ───────────────────────────────────────────────

    /** Returns true if the onthisday response has at least one non-empty section. */
    _hasOnThisDayContent: function(data) {
        return !!(data && (
            (data.births   && data.births.length   > 0) ||
            (data.deaths   && data.deaths.length   > 0) ||
            (data.events   && data.events.length   > 0) ||
            (data.selected && data.selected.length > 0)
        ));
    },

    /** Returns true if the featured response contains a featured article (tfa). */
    _hasFeaturedContent: function(data) {
        return !!(data && data.tfa);
    },

    // ── Background English pre-fetch ─────────────────────────────────────

    /**
     * Silently fetch and cache the English onthisday data in the background.
     * No-op if English cache is already fresh.
     */
    _ensureEnglishOnThisDay: function(month, day) {
        let path = this._cachePath("onthisday", "en", month, day);
        if (this._isCacheFresh(path)) return;
        let mm  = (month < 10 ? '0' : '') + month;
        let dd  = (day   < 10 ? '0' : '') + day;
        let url = "https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/" + mm + "/" + dd;
        let self = this;
        this._fetch(url, function(data) {
            if (self._hasOnThisDayContent(data)) self._writeCache(path, data);
        });
    },

    /**
     * Silently fetch and cache the English featured article in the background.
     * No-op if English cache is already fresh.
     */
    _ensureEnglishFeatured: function(year, month, day) {
        let path = this._cachePath("featured_" + year, "en", month, day);
        if (this._isCacheFresh(path)) return;
        let mm  = (month < 10 ? '0' : '') + month;
        let dd  = (day   < 10 ? '0' : '') + day;
        let url = "https://api.wikimedia.org/feed/v1/wikipedia/en/featured/" +
                  year + "/" + mm + "/" + dd;
        let self = this;
        this._fetch(url, function(data) {
            if (self._hasFeaturedContent(data)) self._writeCache(path, data);
        });
    },

    // ── Public API ───────────────────────────────────────────────────────

    /**
     * Fetch "On This Day" data (births, deaths, events) from Wikipedia.
     *
     * Cache policy:
     *   - Fresh cache with content       → return cached, pre-warm English in background
     *   - Fresh cache but empty content  → skip cache, re-fetch to trigger fallback
     *   - Network returns content        → cache + return, pre-warm English in background
     *   - Network returns empty/404      → fall back to English (cached or fetched)
     *
     * @param {number}   month     1–12
     * @param {number}   day       1–31
     * @param {string}   lang      Language code ("en", "de", "hu", …)
     * @param {Function} callback  Called with parsed response object or null
     */
    fetchOnThisDay: function(month, day, lang, callback) {
        this._ensureCacheDir();
        let path = this._cachePath("onthisday", lang, month, day);

        if (this._isCacheFresh(path)) {
            let cached = this._readCache(path);
            if (this._hasOnThisDayContent(cached)) {
                // Good cache — serve it and ensure English is also warm
                if (lang !== "en") this._ensureEnglishOnThisDay(month, day);
                callback(cached);
                return;
            }
            if (lang === "en") {
                // English cache is fresh but empty — nothing better to try
                callback(cached);
                return;
            }
            // Non-English cache is fresh but empty — delete it so it gets re-fetched,
            // then fall through to the network path which will trigger English fallback.
            this._deleteCache(path);
        }

        let mm  = (month < 10 ? '0' : '') + month;
        let dd  = (day   < 10 ? '0' : '') + day;
        let url = "https://api.wikimedia.org/feed/v1/wikipedia/" + lang +
                  "/onthisday/all/" + mm + "/" + dd;
        let self = this;
        this._fetch(url, function(data, status) {
            if (data) {
                if (self._hasOnThisDayContent(data)) {
                    self._writeCache(path, data);
                    if (lang !== "en") self._ensureEnglishOnThisDay(month, day);
                    callback(data);
                } else if (lang !== "en") {
                    global.logWarning(
                        "Calendarium: Wikipedia onthisday empty for '" + lang +
                        "', falling back to English"
                    );
                    self.fetchOnThisDay(month, day, "en", callback);
                } else {
                    callback(data);
                }
            } else if ((status === 404 || status === 400) && lang !== "en") {
                global.logWarning(
                    "Calendarium: Wikipedia onthisday HTTP " + status + " for '" +
                    lang + "', falling back to English"
                );
                self.fetchOnThisDay(month, day, "en", callback);
            } else {
                callback(null);
            }
        });
    },

    /**
     * Fetch the Wikipedia "Featured Article" for a given date.
     *
     * Same cache policy as fetchOnThisDay.
     *
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
            let cached = this._readCache(path);
            if (this._hasFeaturedContent(cached)) {
                if (lang !== "en") this._ensureEnglishFeatured(year, month, day);
                callback(cached);
                return;
            }
            if (lang === "en") {
                callback(cached);
                return;
            }
            this._deleteCache(path);
        }

        let mm  = (month < 10 ? '0' : '') + month;
        let dd  = (day   < 10 ? '0' : '') + day;
        let url = "https://api.wikimedia.org/feed/v1/wikipedia/" + lang + "/featured/" +
                  year + "/" + mm + "/" + dd;
        let self = this;
        this._fetch(url, function(data, status) {
            if (data) {
                if (self._hasFeaturedContent(data)) {
                    self._writeCache(path, data);
                    if (lang !== "en") self._ensureEnglishFeatured(year, month, day);
                    callback(data);
                } else if (lang !== "en") {
                    global.logWarning(
                        "Calendarium: Wikipedia featured no tfa for '" + lang +
                        "', falling back to English"
                    );
                    self.fetchFeatured(year, month, day, "en", callback);
                } else {
                    callback(data);
                }
            } else if ((status === 404 || status === 400) && lang !== "en") {
                global.logWarning(
                    "Calendarium: Wikipedia featured HTTP " + status + " for '" +
                    lang + "', falling back to English"
                );
                self.fetchFeatured(year, month, day, "en", callback);
            } else {
                callback(null);
            }
        });
    }
};
