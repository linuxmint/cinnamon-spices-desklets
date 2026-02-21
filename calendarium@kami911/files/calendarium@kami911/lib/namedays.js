/*
 * namedays.js — Name day data loader and query for Calendarium desklet
 *
 * Data format (JSON files in data/namedays/):
 *   { "MM-DD": ["Name1", "Name2", ...], ... }
 *
 * To add a new name day language:
 *   1. Create data/namedays/XX.json with the same format.
 *   2. Add the option to settings-schema.json under "nameday-locale".
 *
 * This module exports a single `Namedays` object.
 * Requires: Gio (available in Cinnamon JS environment)
 */

const Gio = imports.gi.Gio;

var Namedays = {

    /**
     * Load the name day JSON file for the given locale.
     * Handles both Uint8Array (Cinnamon 5+) and legacy ByteArray returns.
     *
     * @param {string} dataDir  Absolute path to data/namedays/ directory
     * @param {string} locale   Language code ("hu", "de", "en", …)
     * @returns {Object|null}   Parsed { "MM-DD": [name, ...] } or null on error
     */
    loadData: function(dataDir, locale) {
        let path = dataDir + "/" + locale + ".json";
        let file = Gio.File.new_for_path(path);
        try {
            let [ok, contents] = file.load_contents(null);
            if (!ok) return null;
            let text;
            if (contents instanceof Uint8Array) {
                text = new TextDecoder().decode(contents);
            } else {
                // Fallback for older Cinnamon / GJS builds
                text = imports.byteArray.toString(contents);
            }
            return JSON.parse(text);
        } catch (e) {
            global.logError("Calendarium: failed to load nameday data for '"
                            + locale + "': " + e);
            return null;
        }
    },

    /**
     * Build the "MM-DD" lookup key for a given date.
     * @param {Date} date
     * @returns {string}  e.g. "02-14"
     */
    _key: function(date) {
        let m = date.getMonth() + 1;
        let d = date.getDate();
        return (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
    },

    /**
     * Return the list of name day names for a single date.
     * @param {Object|null} data   Loaded data object from loadData()
     * @param {Date}        date
     * @returns {string[]}  Array of name strings (may be empty)
     */
    getNamedays: function(data, date) {
        if (!data) return [];
        return data[this._key(date)] || [];
    },

    /**
     * Return name days for today and the next `days` calendar days.
     * @param {Object|null} data   Loaded data object
     * @param {Date}        date   Start date (usually today)
     * @param {number}      days   Number of additional lookahead days (0 = today only)
     * @returns {Array}  [{ date: Date, names: string[] }, ...]
     */
    getNamedaysRange: function(data, date, days) {
        let result = [];
        for (let i = 0; i <= days; i++) {
            let d = new Date(date);
            d.setDate(d.getDate() + i);
            result.push({
                date:  d,
                names: this.getNamedays(data, d)
            });
        }
        return result;
    }
};
