/*
 * geocoder.js — Offline city search for Calendarium desklet
 *
 * Loads a bundled city database (data/cities.json) and performs a
 * case-insensitive prefix/contains search across English names and
 * all local/alternative names (Hungarian, German, French, Spanish, Italian…).
 * No internet required.
 *
 * Usage:
 *   Geocoder.init(deskletDir);
 *   let results = Geocoder.search("Bécs");
 *   // results = [{name, country, lat, lon}, …]  (up to 5, sorted by relevance)
 */

const Gio = imports.gi.Gio;

var Geocoder = {

    _cities: null,   // loaded lazily

    /**
     * Load city database from data/cities.json.
     * @param {string} deskletDir  Absolute path to the desklet directory
     */
    init: function(deskletDir) {
        if (this._cities !== null) return;
        this._cities = [];
        try {
            let file = Gio.File.new_for_path(deskletDir + "/data/cities.json");
            let [ok, contents] = file.load_contents(null);
            if (!ok) return;
            let text = (contents instanceof Uint8Array)
                ? new TextDecoder().decode(contents)
                : imports.byteArray.toString(contents);
            let raw = JSON.parse(text);
            for (let i = 0; i < raw.length; i++) {
                let r = raw[i];
                // Build list of all searchable lowercase strings for this city
                let terms = [r.n.toLowerCase()];
                if (r.l) {
                    for (let j = 0; j < r.l.length; j++) {
                        terms.push(r.l[j].toLowerCase());
                    }
                }
                this._cities.push({
                    name:    r.n,
                    country: r.c,
                    lat:     r.a,
                    lon:     r.o,
                    tz:      r.z || "",
                    terms:   terms
                });
            }
        } catch (e) {
            global.logError("Calendarium: Geocoder failed to load cities: " + e);
        }
    },

    /**
     * Search for cities matching the query string (any language).
     * Returns up to 5 results: exact matches first, then prefix, then contains.
     * @param {string} query
     * @returns {Array}  [{name, country, lat, lon}, …]
     */
    search: function(query) {
        if (!this._cities || !query || !query.trim()) return [];
        let q      = query.trim().toLowerCase();
        let exact  = [];
        let prefix = [];
        let middle = [];
        for (let i = 0; i < this._cities.length; i++) {
            let c     = this._cities[i];
            let entry = { name: c.name, country: c.country, lat: c.lat, lon: c.lon, tz: c.tz };
            let matched = false;
            for (let j = 0; j < c.terms.length; j++) {
                let t = c.terms[j];
                if (t === q) {
                    exact.push(entry);
                    matched = true;
                    break;
                } else if (t.indexOf(q) === 0) {
                    prefix.push(entry);
                    matched = true;
                    break;
                } else if (t.indexOf(q) !== -1) {
                    middle.push(entry);
                    matched = true;
                    break;
                }
            }
            if (!matched) continue;
            if (exact.length + prefix.length + middle.length >= 20) break;
        }
        return exact.concat(prefix).concat(middle).slice(0, 5);
    }
};
