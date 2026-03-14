/*
 * holidays.js — National holiday loader for Calendarium desklet
 *
 * Data format (JSON files in data/holidays/):
 *   {
 *     "fixed":  { "MM-DD": { "name": "...", "public": true/false }, ... },
 *     "easter": [ { "offset": N, "name": "...", "public": true/false }, ... ]
 *   }
 *
 * Easter-based holidays use day offset from Easter Sunday (negative = before).
 * Easter date is calculated using the Meeus/Jones/Butcher algorithm.
 */

const Gio = imports.gi.Gio;

var Holidays = {

    /**
     * Calculate Easter Sunday for a given year (Meeus/Jones/Butcher algorithm).
     * @param {number} year
     * @returns {Date}
     */
    _easter: function(year) {
        var a = year % 19;
        var b = Math.floor(year / 100);
        var c = year % 100;
        var d = Math.floor(b / 4);
        var e = b % 4;
        var f = Math.floor((b + 8) / 25);
        var g = Math.floor((b - f + 1) / 3);
        var h = (19 * a + b - d - g + 15) % 30;
        var i = Math.floor(c / 4);
        var k = c % 4;
        var l = (32 + 2 * e + 2 * i - h - k) % 7;
        var m = Math.floor((a + 11 * h + 22 * l) / 451);
        var month = Math.floor((h + l - 7 * m + 114) / 31);
        var day   = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(year, month - 1, day);
    },

    /**
     * Load holiday JSON for the given locale.
     * @param {string} dataDir  Absolute path to data/holidays/
     * @param {string} locale   Language code ("hu", "de", ...)
     * @returns {Object|null}
     */
    loadData: function(dataDir, locale) {
        if (!locale || locale === "auto") return null;
        var path = dataDir + "/" + locale + ".json";
        var file = Gio.File.new_for_path(path);
        if (!file.query_exists(null)) return null;
        try {
            var [ok, contents] = file.load_contents(null);
            if (!ok) return null;
            var text = (contents instanceof Uint8Array)
                ? new TextDecoder().decode(contents)
                : imports.byteArray.toString(contents);
            return JSON.parse(text);
        } catch(e) {
            global.logError("Calendarium: failed to load holiday data for '"
                            + locale + "': " + e);
            return null;
        }
    },

    /**
     * Return holidays for today + the next `days` calendar days.
     * @param {Object|null} data
     * @param {Date}        startDate   Usually today
     * @param {number}      days        Lookahead days (0 = today only)
     * @returns {Array}  [{ date: Date, name: string, public: boolean }, ...]
     *                   Only days that have a holiday are included.
     */
    getHolidaysRange: function(data, startDate, days) {
        var result = [];
        for (var i = 0; i <= days; i++) {
            var d = new Date(startDate);
            d.setDate(d.getDate() + i);
            var h = this.getHolidayForDate(data, d);
            if (h) result.push({ date: d, name: h.name, public: h.public });
        }
        return result;
    },

    /**
     * Return holiday info for a given date, or null if none.
     * @param {Object|null} data   Loaded data from loadData()
     * @param {Date}        date
     * @returns {{ name: string, public: boolean }|null}
     */
    getHolidayForDate: function(data, date) {
        if (!data) return null;
        var year = date.getFullYear();
        var m    = date.getMonth() + 1;
        var d    = date.getDate();
        var key  = (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;

        // Fixed holidays
        if (data.fixed && data.fixed[key]) {
            return data.fixed[key];
        }

        // Easter-based holidays
        if (data.easter && data.easter.length > 0) {
            var easter = this._easter(year);
            for (var i = 0; i < data.easter.length; i++) {
                var entry  = data.easter[i];
                var hDate  = new Date(easter.getTime() + entry.offset * 86400000);
                if (hDate.getMonth() + 1 === m && hDate.getDate() === d) {
                    return { name: entry.name, public: entry.public };
                }
            }
        }

        return null;
    }
};
