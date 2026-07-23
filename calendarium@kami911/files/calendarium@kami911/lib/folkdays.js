/*
 * folkdays.js — Folk calendar saying loader for Calendarium desklet
 *
 * Data format (JSON files in data/folkdays/):
 *   { "MM-DD": "Folk saying text for this day", ... }
 *
 * To add a new language:
 *   1. Create data/folkdays/XX.json with the same "MM-DD": "saying" format.
 *   2. Add the option to settings-schema.json under "folkday-locale".
 *
 * This module exports a single `Folkdays` object.
 * Requires: Gio (available in Cinnamon JS environment)
 */

const Gio = imports.gi.Gio;

var Folkdays = {

    /**
     * Load the folk saying JSON file for the given locale.
     *
     * @param {string} dataDir  Absolute path to data/folkdays/ directory
     * @param {string} locale   Language code ("hu", "de", "en", …)
     * @returns {Object|null}   Parsed { "MM-DD": "saying" } or null on error
     */
    loadData: function(dataDir, locale, callback) {
        let path = dataDir + "/" + locale + ".json";
        let file = Gio.File.new_for_path(path);
        file.load_contents_async(null, function(obj, result) {
            try {
                let [ok, contents] = file.load_contents_finish(result);
                if (!ok) { callback(null); return; }
                let text = (contents instanceof Uint8Array)
                    ? new TextDecoder().decode(contents)
                    : imports.byteArray.toString(contents);
                callback(JSON.parse(text));
            } catch (e) {
                global.logError("Calendarium: failed to load folkday data for '"
                                + locale + "': " + e);
                callback(null);
            }
        });
    },

    /**
     * Return the folk saying for the given date, or null if none exists.
     *
     * @param {Object|null} data   Loaded data object from loadData()
     * @param {Date}        date
     * @returns {string|null}
     */
    getSaying: function(data, date) {
        if (!data) return null;
        let m  = date.getMonth() + 1;
        let d  = date.getDate();
        let key = (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
        return data[key] || null;
    }
};
