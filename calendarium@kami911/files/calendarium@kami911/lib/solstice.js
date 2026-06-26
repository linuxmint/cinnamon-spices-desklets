/*
 * solstice.js — Equinox and solstice date calculation for Calendarium desklet
 *
 * Algorithm: Jean Meeus, "Astronomical Algorithms", 2nd ed., Chapter 27.
 * Accuracy: within ~1 minute of true equinox/solstice for years near 2000.
 *
 * This module exports a single `Solstice` object.
 */

var Solstice = {

    // ── Table 27.b correction terms ─────────────────────────────────────
    // Each entry: [A, B, C]  →  A * cos((B + C*T) * π/180)
    _TERMS: [
        [485, 324.96,  1934.136], [203, 337.23, 32964.467],
        [199, 342.08,    20.186], [182,  27.85,445267.112],
        [156,  73.14, 45036.886], [136, 171.52, 22518.443],
        [ 77, 222.54, 65928.934], [ 74, 296.72,  3034.906],
        [ 70, 243.58,  9037.513], [ 58, 119.81, 33718.147],
        [ 52, 297.17,  9465.380], [ 50,  21.02,  2281.226],
        [ 45, 247.54, 29929.562], [ 44, 325.15, 31555.956],
        [ 29,  60.93,  4443.417], [ 18, 155.12, 67555.328],
        [ 17, 288.79,  4562.452], [ 16, 198.04, 62894.029],
        [ 14, 199.76, 31557.381], [ 12,  95.39, 14577.848],
        [ 12, 287.11, 31556.903], [ 12, 320.81, 34777.259],
        [  9, 227.73,  1222.114], [  8,  15.45, 16859.074]
    ],

    // ── JDE₀ polynomial coefficients ────────────────────────────────────
    // Each sub-array: [const, Y, Y², Y³, Y⁴]   (Y = (year−2000)/1000)
    // Index 0 = Spring equinox, 1 = Summer solstice,
    //       2 = Autumnal equinox, 3 = Winter solstice
    _JDE0_COEFF: [
        [2451623.80984, 365242.37404,  0.05169, -0.00411, -0.00057],
        [2451716.56767, 365241.62603,  0.00325,  0.00888, -0.00030],
        [2451810.21715, 365242.01767, -0.11575,  0.00337,  0.00078],
        [2451900.05952, 365242.74049, -0.06223, -0.00823,  0.00032]
    ],

    // Event name keys (English, for translation by caller via _())
    _EVENT_NAMES: [
        "Spring equinox",
        "Summer solstice",
        "Autumn equinox",
        "Winter solstice"
    ],

    /**
     * Compute JDE₀ (uncorrected Julian Ephemeris Day) for an event in a given year.
     * @param {number} year   Gregorian year (e.g. 2026)
     * @param {number} event  0=spring, 1=summer, 2=autumn, 3=winter
     * @returns {number}  JDE₀
     */
    _jde0: function(year, event) {
        var Y = (year - 2000) / 1000;
        var c = this._JDE0_COEFF[event];
        return c[0] + c[1]*Y + c[2]*Y*Y + c[3]*Y*Y*Y + c[4]*Y*Y*Y*Y;
    },

    /**
     * Compute the Meeus Table 27.b correction (in days) for a given JDE₀.
     * @param {number} jde0  Julian Ephemeris Day (uncorrected)
     * @returns {number}  correction in days
     */
    _correction: function(jde0) {
        var T = (jde0 - 2451545.0) / 36525.0;
        var PI_OVER_180 = Math.PI / 180;

        var S = 0;
        var terms = this._TERMS;
        for (var i = 0; i < terms.length; i++) {
            var A = terms[i][0];
            var B = terms[i][1];
            var C = terms[i][2];
            S += A * Math.cos((B + C * T) * PI_OVER_180);
        }

        var W  = 35999.373 * T - 2.47;
        var dL = 1.0
               + 0.0334 * Math.cos(W * PI_OVER_180)
               + 0.0007 * Math.cos(2 * W * PI_OVER_180);

        return 0.00001 * S / dL;
    },

    /**
     * Convert a Julian Ephemeris Day to a JavaScript Date (UTC).
     * @param {number} jde  Julian Day Number (decimal)
     * @returns {Date}
     */
    _jdeToDate: function(jde) {
        // JDE 2440587.5 = 1970-01-01 00:00:00 UTC
        var unixMs = (jde - 2440587.5) * 86400000;
        return new Date(unixMs);
    },

    /**
     * Return the four seasonal dates for a given Gregorian year.
     * @param {number} year  Gregorian year
     * @returns {Object}  { spring: Date, summer: Date, autumn: Date, winter: Date }
     */
    getForYear: function(year) {
        var results = [];
        for (var event = 0; event < 4; event++) {
            var jde0 = this._jde0(year, event);
            var jde  = jde0 + this._correction(jde0);
            results.push(this._jdeToDate(jde));
        }
        return {
            spring: results[0],
            summer: results[1],
            autumn: results[2],
            winter: results[3]
        };
    },

    /**
     * Return the next upcoming equinox or solstice on or after the given date.
     *
     * @param {Date} date  Reference date (local time)
     * @returns {Object}  { nameKey: string, date: Date, daysUntil: number }
     *   nameKey   — English string key for translation (e.g. "Spring equinox")
     *   date      — JS Date of the event (UTC)
     *   daysUntil — whole days until the event (0 if today)
     */
    getNext: function(date) {
        // Compare calendar dates only (strip time)
        var todayYear  = date.getFullYear();
        var todayMonth = date.getMonth();
        var todayDay   = date.getDate();
        var todayMidnight = new Date(todayYear, todayMonth, todayDay, 0, 0, 0, 0);

        // Check this year, then next year if all events have passed
        for (var yearOffset = 0; yearOffset <= 1; yearOffset++) {
            var year   = todayYear + yearOffset;
            var season = this.getForYear(year);
            var events = [
                { nameKey: this._EVENT_NAMES[0], date: season.spring },
                { nameKey: this._EVENT_NAMES[1], date: season.summer },
                { nameKey: this._EVENT_NAMES[2], date: season.autumn },
                { nameKey: this._EVENT_NAMES[3], date: season.winter }
            ];

            for (var i = 0; i < events.length; i++) {
                var ev       = events[i];
                var evLocal  = ev.date; // JS Date (UTC instant)

                // Build a midnight-local Date for the event's local calendar day
                var evMidnight = new Date(
                    evLocal.getFullYear(),
                    evLocal.getMonth(),
                    evLocal.getDate(),
                    0, 0, 0, 0
                );

                var msPerDay   = 86400000;
                var diffMs     = evMidnight.getTime() - todayMidnight.getTime();
                var daysUntil  = Math.round(diffMs / msPerDay);

                if (daysUntil >= 0) {
                    return {
                        nameKey:   ev.nameKey,
                        date:      ev.date,
                        daysUntil: daysUntil
                    };
                }
            }
        }

        // Fallback: should never happen, but return next year's spring equinox
        var nextSpring = this.getForYear(todayYear + 1).spring;
        var fallbackMs = new Date(nextSpring.getFullYear(), nextSpring.getMonth(), nextSpring.getDate())
                             .getTime() - todayMidnight.getTime();
        return {
            nameKey:   this._EVENT_NAMES[0],
            date:      nextSpring,
            daysUntil: Math.round(fallbackMs / 86400000)
        };
    }
};
