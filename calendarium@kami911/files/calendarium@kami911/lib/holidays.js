/*
 * holidays.js — National holiday loader for Calendarium desklet
 *
 * Data format (JSON files in data/holidays/):
 *   {
 *     "fixed":  { "MM-DD": { "name": "...", "public": true/false }, ... },
 *     "easter": [ { "offset": N, "name": "...", "public": true/false }, ... ],
 *     "periods": [
 *       {
 *         "name": "...",
 *         "public": true/false,
 *         "start": { "type": "fixed",  "month": M, "day": D }
 *                | { "type": "easter", "offset": N }
 *                | { "type": "advent", "offset": N },
 *         "end":   { "type": "fixed",  "month": M, "day": D }
 *                | { "type": "easter", "offset": N }
 *                | { "type": "advent", "offset": N }
 *       }, ...
 *     ]
 *   }
 *
 * Easter-based holidays use day offset from Easter Sunday (negative = before).
 * Easter date is calculated using the Meeus/Jones/Butcher algorithm.
 * Advent type: offset 0 = first Advent Sunday (4 Sundays before Christmas).
 * Periods define multi-day seasons; getPeriodsForDate() returns all active ones.
 */

const Gio = imports.gi.Gio;

var Holidays = {

    /**
     * Resolve a period endpoint descriptor to a concrete Date for the given year.
     * Supported types: "fixed" (month/day), "easter" (offset from Easter),
     *                  "advent" (offset from first Advent Sunday).
     * @param {Object} endpoint
     * @param {number} year
     * @param {Date}   easter  Pre-calculated Easter date for this year
     * @returns {Date|null}
     */
    _resolvePeriodDate: function(endpoint, year, easter) {
        if (!endpoint) return null;
        if (endpoint.type === "fixed") {
            return new Date(year, endpoint.month - 1, endpoint.day);
        }
        if (endpoint.type === "easter") {
            return new Date(easter.getTime() + endpoint.offset * 86400000);
        }
        if (endpoint.type === "advent") {
            // First Advent Sunday = 4th Sunday before Christmas (Dec 25).
            // Formula: find the Sunday on or before Dec 3 of the same year.
            var christmas = new Date(year, 11, 25);
            var dow = christmas.getDay();               // 0 = Sun
            var daysBack = (dow === 0) ? 28 : dow + 21;
            var advent1 = new Date(year, 11, 25 - daysBack);
            return new Date(advent1.getTime() + (endpoint.offset || 0) * 86400000);
        }
        return null;
    },

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
    loadData: function(dataDir, locale, callback) {
        if (!locale || locale === "auto") { callback(null); return; }
        var path = dataDir + "/" + locale + ".json";
        var file = Gio.File.new_for_path(path);
        file.load_contents_async(null, function(obj, result) {
            try {
                var [ok, contents] = file.load_contents_finish(result);
                if (!ok) { callback(null); return; }
                var text = (contents instanceof Uint8Array)
                    ? new TextDecoder().decode(contents)
                    : imports.byteArray.toString(contents);
                callback(JSON.parse(text));
            } catch(e) {
                global.logError("Calendarium: failed to load holiday data for '"
                                + locale + "': " + e);
                callback(null);
            }
        });
    },

    /**
     * Return seasonal periods that will START within the next `lookaheadDays` days.
     * Excludes periods that are already active today (use getPeriodsForDate for those).
     * @param {Object|null} data
     * @param {Date}        date
     * @param {number}      lookaheadDays
     * @returns {Array}  [{ name: string, daysUntil: number, endDate: Date }, ...]
     */
    getUpcomingPeriods: function(data, date, lookaheadDays) {
        if (!data || !data.periods || !lookaheadDays) return [];
        var year   = date.getFullYear();
        var today  = new Date(year, date.getMonth(), date.getDate());
        var result = [];
        // Check this year and next year so we don't miss cross-year periods
        for (var yr = year; yr <= year + 1; yr++) {
            var easter = this._easter(yr);
            for (var i = 0; i < data.periods.length; i++) {
                var p     = data.periods[i];
                var start = this._resolvePeriodDate(p.start, yr, easter);
                var end   = this._resolvePeriodDate(p.end,   yr, easter);
                if (!start || !end) continue;
                start = new Date(start.getFullYear(), start.getMonth(), start.getDate());
                end   = new Date(end.getFullYear(),   end.getMonth(),   end.getDate());
                // Only show periods that haven't started yet
                if (start <= today) continue;
                var daysUntil = Math.round((start - today) / 86400000);
                if (daysUntil > lookaheadDays) continue;
                result.push({ name: p.name, daysUntil: daysUntil, endDate: end });
            }
        }
        result.sort(function(a, b) { return a.daysUntil - b.daysUntil; });
        return result;
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
     * Return all active seasonal periods for a given date.
     * @param {Object|null} data   Loaded data from loadData()
     * @param {Date}        date
     * @returns {Array}  [{ name: string, public: boolean, daysLeft: number }, ...]
     */
    getPeriodsForDate: function(data, date) {
        if (!data || !data.periods || data.periods.length === 0) return [];
        var year   = date.getFullYear();
        var today  = new Date(year, date.getMonth(), date.getDate());
        var easter = this._easter(year);
        var result = [];
        for (var i = 0; i < data.periods.length; i++) {
            var p     = data.periods[i];
            var start = this._resolvePeriodDate(p.start, year, easter);
            var end   = this._resolvePeriodDate(p.end,   year, easter);
            if (!start || !end) continue;
            // Normalize to midnight
            start = new Date(start.getFullYear(), start.getMonth(), start.getDate());
            end   = new Date(end.getFullYear(),   end.getMonth(),   end.getDate());
            if (today >= start && today <= end) {
                var daysLeft = Math.round((end - today) / 86400000);
                result.push({ name: p.name, public: !!p.public, daysLeft: daysLeft });
            }
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
