/*
 * calendars.js — Alternative calendar conversions for Calendarium desklet
 *
 * Converts a Gregorian date to:
 *   • Julian calendar (Old Style)
 *   • Hebrew calendar (Dershowitz-Reingold algorithmic method)
 *   • Islamic calendar (tabular/arithmetic method)
 *   • Persian calendar (Solar Hijri / Jalali, algorithmic)
 *   • French Republican calendar (equinox-based, historically accurate —
 *     see the toFrenchRepublican doc comment below)
 *
 * All conversion routines work through the Julian Day Number (JDN) as an
 * intermediate representation so each calendar is independent of the others,
 * except French Republican, which depends on lib/solstice.js for its real
 * astronomical autumn-equinox timing (desklet.js pushes lib/ onto
 * imports.searchPath before any lib module loads, so this resolves fine).
 *
 * This module exports a single `Calendars` object.
 */

const Solstice = imports.solstice.Solstice;

var Calendars = {

    // ════════════════════════════════════════════════════════════════════
    // Month name tables
    // ════════════════════════════════════════════════════════════════════

    _JULIAN_MONTHS: [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ],

    // Non-leap year: 12 entries; leap year: 13 entries (Adar I + Adar II).
    _HEBREW_MONTHS_COMMON: [
        "Tishri", "Cheshvan", "Kislev", "Tevet", "Shvat",
        "Adar",
        "Nisan", "Iyar", "Sivan", "Tammuz", "Av", "Elul"
    ],
    _HEBREW_MONTHS_LEAP: [
        "Tishri", "Cheshvan", "Kislev", "Tevet", "Shvat",
        "Adar I", "Adar II",
        "Nisan", "Iyar", "Sivan", "Tammuz", "Av", "Elul"
    ],

    _ISLAMIC_MONTHS: [
        "Muharram", "Safar", "Rabi' al-Awwal", "Rabi' al-Thani",
        "Jumada al-Awwal", "Jumada al-Thani", "Rajab", "Sha'ban",
        "Ramadan", "Shawwal", "Dhu al-Qi'dah", "Dhu al-Hijjah"
    ],

    _PERSIAN_MONTHS: [
        "Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar",
        "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand"
    ],

    _FRENCH_REPUBLICAN_MONTHS: [
        "Vendémiaire", "Brumaire", "Frimaire",
        "Nivôse", "Pluviôse", "Ventôse",
        "Germinal", "Floréal", "Prairial",
        "Messidor", "Thermidor", "Fructidor"
    ],

    // The 5 (or 6, in a sextile/leap year) intercalary days following
    // Fructidor. Index 5 ("Jour de la Révolution") only applies in years
    // whose cycle spans 366 days.
    _FRENCH_REPUBLICAN_SANSCULOTTIDES: [
        "Jour de la Vertu", "Jour du Génie", "Jour du Travail",
        "Jour de l'Opinion", "Jour des Récompenses", "Jour de la Révolution"
    ],

    // ════════════════════════════════════════════════════════════════════
    // Gregorian → Julian Day Number
    // ════════════════════════════════════════════════════════════════════

    /**
     * Convert a proleptic Gregorian date to its Julian Day Number (integer).
     * @param {number} year   Gregorian year (full, e.g. 2026)
     * @param {number} month  1–12
     * @param {number} day    1–31
     * @returns {number}  integer JDN
     */
    _gregorianToJDN: function(year, month, day) {
        var a = Math.floor((14 - month) / 12);
        var y = year + 4800 - a;
        var m = month + 12 * a - 3;
        return day
             + Math.floor((153 * m + 2) / 5)
             + 365 * y
             + Math.floor(y / 4)
             - Math.floor(y / 100)
             + Math.floor(y / 400)
             - 32045;
    },

    // ════════════════════════════════════════════════════════════════════
    // Julian calendar
    // ════════════════════════════════════════════════════════════════════

    /**
     * Convert a Gregorian date to the Julian (Old Style) calendar.
     * @param {number} year   Gregorian year
     * @param {number} month  1–12
     * @param {number} day    1–31
     * @returns {Object}  { year, month, day }  (month is 1-based)
     */
    toJulian: function(year, month, day) {
        var jdn = this._gregorianToJDN(year, month, day);

        var c  = jdn + 32082;
        var d  = Math.floor((4 * c + 3) / 1461);
        var e  = c - Math.floor(1461 * d / 4);
        var m  = Math.floor((5 * e + 2) / 153);

        var jDay   = e - Math.floor((153 * m + 2) / 5) + 1;
        var jMonth = m + 3 - 12 * Math.floor(m / 10);
        var jYear  = d - 4800 + Math.floor(m / 10);

        return { year: jYear, month: jMonth, day: jDay };
    },

    /**
     * Format a Julian calendar date as a human-readable string.
     * @param {number} year   Gregorian year (will be converted internally)
     * @param {number} month  1–12
     * @param {number} day    1–31
     * @returns {string}  e.g. "11 March 2026 O.S."
     */
    formatJulian: function(year, month, day) {
        var j = this.toJulian(year, month, day);
        return j.day + " " + this._JULIAN_MONTHS[j.month - 1] + " " + j.year + " O.S.";
    },

    // ════════════════════════════════════════════════════════════════════
    // Hebrew calendar  (Dershowitz-Reingold algorithmic method)
    // ════════════════════════════════════════════════════════════════════

    // JDN of the Hebrew epoch (1 Tishri 1 AM = Monday, 7 October 3761 BCE proleptic Julian)
    _HEBREW_EPOCH: 347997,

    /**
     * True if Hebrew year y is a leap year (has 13 months).
     * @param {number} y  Hebrew year
     * @returns {boolean}
     */
    _hebrewLeapYear: function(y) {
        return ((7 * y + 1) % 19) < 7;
    },

    /**
     * Number of days elapsed from the Hebrew epoch to the first day of Hebrew year y.
     * Uses the molad (mean lunation) calculation.
     * @param {number} y  Hebrew year
     * @returns {number}  integer day count
     */
    _hebrewElapsedDays: function(y) {
        var monthsElapsed = 235 * Math.floor((y - 1) / 19)
                          + 12 * ((y - 1) % 19)
                          + Math.floor((7 * ((y - 1) % 19) + 1) / 19);

        var partsElapsed  = 204 + 793 * (monthsElapsed % 1080);
        var hoursElapsed  = 5
                          + 12 * monthsElapsed
                          + 793 * Math.floor(monthsElapsed / 1080)
                          + Math.floor(partsElapsed / 1080);

        var conjDay   = 1 + 29 * monthsElapsed + Math.floor(hoursElapsed / 24);
        var conjParts = 1080 * (hoursElapsed % 24) + (partsElapsed % 1080);

        var altDay = conjDay;

        // Postponement rules (dehiyyot)
        if (   conjParts >= 19440
            || (conjDay % 7 === 2 && conjParts >= 9924  && !this._hebrewLeapYear(y))
            || (conjDay % 7 === 1 && conjParts >= 16789 &&  this._hebrewLeapYear(y - 1))
        ) {
            altDay = conjDay + 1;
        }

        // Second postponement: avoid Rosh Hashana on Sun (0), Wed (3), or Fri (5)
        if (altDay % 7 === 0 || altDay % 7 === 3 || altDay % 7 === 5) {
            altDay = altDay + 1;
        }

        return altDay;
    },

    /**
     * Return an array of month lengths (in days) for Hebrew year y.
     * For a common year: 12 entries.  For a leap year: 13 entries.
     * Order: Tishri, Cheshvan, Kislev, Tevet, Shvat, [Adar I,] Adar [II],
     *        Nisan, Iyar, Sivan, Tammuz, Av, Elul.
     * @param {number} y  Hebrew year
     * @returns {number[]}
     */
    _hebrewMonthLengths: function(y) {
        var yearLen = this._hebrewElapsedDays(y + 1) - this._hebrewElapsedDays(y);
        var leap    = this._hebrewLeapYear(y);

        // Variable months
        var cheshvan = (yearLen % 10 === 5) ? 30 : 29;  // month 2
        var kislev   = (yearLen % 10 === 3) ? 29 : 30;  // month 3

        if (leap) {
            // 13-month leap year: Adar I (30) + Adar II (29)
            return [30, cheshvan, kislev, 29, 30, 30, 29, 30, 29, 30, 29, 30, 29];
        } else {
            // 12-month common year: single Adar (29)
            return [30, cheshvan, kislev, 29, 30, 29, 30, 29, 30, 29, 30, 29];
        }
    },

    /**
     * Convert a Gregorian date to the Hebrew calendar.
     * @param {number} year   Gregorian year
     * @param {number} month  1–12
     * @param {number} day    1–31
     * @returns {Object}  { year, month, day }  (month is 1-based)
     */
    toHebrew: function(year, month, day) {
        var jdn  = this._gregorianToJDN(year, month, day);
        var days = jdn - this._HEBREW_EPOCH;   // days since Hebrew epoch

        // Approximate Hebrew year (mean Hebrew year ≈ 365.25 days), then tighten below
        var approxYear = Math.round(days / 365.25) + 1;

        // Walk forward/backward to the correct year
        var hYear = approxYear;
        while (this._hebrewElapsedDays(hYear + 1) <= days) {
            hYear = hYear + 1;
        }
        while (this._hebrewElapsedDays(hYear) > days) {
            hYear = hYear - 1;
        }

        // Day-of-year within this Hebrew year (0-based)
        var dayOfYear = days - this._hebrewElapsedDays(hYear);

        // Walk through months
        var lengths  = this._hebrewMonthLengths(hYear);
        var hMonth   = 0;
        var remaining = dayOfYear;
        while (hMonth < lengths.length - 1 && remaining >= lengths[hMonth]) {
            remaining -= lengths[hMonth];
            hMonth    += 1;
        }

        return {
            year:  hYear,
            month: hMonth + 1,       // 1-based
            day:   remaining + 1     // 1-based
        };
    },

    /**
     * Format a Hebrew calendar date as a human-readable string.
     * @param {number} year   Gregorian year (will be converted internally)
     * @param {number} month  1–12
     * @param {number} day    1–31
     * @returns {string}  e.g. "6 Nisan 5786"
     */
    formatHebrew: function(year, month, day) {
        var h      = this.toHebrew(year, month, day);
        var leap   = this._hebrewLeapYear(h.year);
        var months = leap ? this._HEBREW_MONTHS_LEAP : this._HEBREW_MONTHS_COMMON;
        var mName  = months[h.month - 1];
        return h.day + " " + mName + " " + h.year;
    },

    // ════════════════════════════════════════════════════════════════════
    // Islamic calendar  (tabular / arithmetic method)
    // ════════════════════════════════════════════════════════════════════

    /**
     * Convert a Gregorian date to the Islamic (Hijri) calendar.
     * Uses the tabular arithmetic algorithm; results may differ by ±1 day
     * from the observational calendar.
     * @param {number} year   Gregorian year
     * @param {number} month  1–12
     * @param {number} day    1–31
     * @returns {Object}  { year, month, day }  (month is 1-based)
     */
    toIslamic: function(year, month, day) {
        var jdn = this._gregorianToJDN(year, month, day);

        var l = jdn - 1948440 + 10632;
        var n = Math.floor((l - 1) / 10631);
        l = l - 10631 * n + 354;

        var j = Math.floor((10985 - l) / 5316) * Math.floor(50 * l / 17719)
              + Math.floor(l / 5670)            * Math.floor(43 * l / 15238);

        l = l
          - Math.floor((30 - j) / 15) * Math.floor(17719 * j / 50)
          - Math.floor(j / 16)        * Math.floor(15238 * j / 43)
          + 29;

        var iMonth = Math.floor(24 * l / 709);
        var iDay   = l - Math.floor(709 * iMonth / 24);
        var iYear  = 30 * n + j - 30;

        return { year: iYear, month: iMonth, day: iDay };
    },

    /**
     * Format an Islamic calendar date as a human-readable string.
     * @param {number} year   Gregorian year (will be converted internally)
     * @param {number} month  1–12
     * @param {number} day    1–31
     * @returns {string}  e.g. "5 Shawwal 1447"
     */
    formatIslamic: function(year, month, day) {
        var i = this.toIslamic(year, month, day);
        return i.day + " " + this._ISLAMIC_MONTHS[i.month - 1] + " " + i.year;
    },

    // ════════════════════════════════════════════════════════════════════
    // Persian calendar  (Solar Hijri / Jalali)
    // ════════════════════════════════════════════════════════════════════

    // JDN of 1 Farvardin 1 SH.
    // Derived from: 1948321 = algorithmic anchor for the Longstaff formula.
    _PERSIAN_EPOCH: 1948321,

    /**
     * JDN of the first day (1 Farvardin) of Persian year y.
     * Formula: Longstaff / Heydari-Malayeri arithmetic calendar.
     *   A 2820-year grand cycle contains exactly 1029983 days (= 2820*365 + 683 leap days).
     *   Leap years satisfy: (8*y + 29) % 33 < 8.
     *   Cumulative leap days from year 1 to y = floor((8*y + 29) / 33).
     * @param {number} y  Persian year
     * @returns {number}  integer JDN
     */
    _persianYearStart: function(y) {
        return this._PERSIAN_EPOCH + 365 * (y - 1) + Math.floor((8 * y + 29) / 33);
    },

    /**
     * True if Persian year y is a leap year (366 days).
     * @param {number} y  Persian year
     * @returns {boolean}
     */
    _persianLeapYear: function(y) {
        return ((8 * y + 29) % 33) < 8;
    },

    /**
     * Convert a Gregorian date to the Persian (Solar Hijri / Jalali) calendar.
     * @param {number} year   Gregorian year
     * @param {number} month  1–12
     * @param {number} day    1–31
     * @returns {Object}  { year, month, day }  (month is 1-based)
     */
    toPersian: function(year, month, day) {
        var jdn = this._gregorianToJDN(year, month, day);

        // Approximate Persian year; the factor 33/12053 ≈ 1/365.242 (mean Persian year)
        // (2820 years / 1029983 days = exact cycle ratio; 33/12053 is the reduced fraction)
        var pYear = Math.floor((jdn - this._PERSIAN_EPOCH) * 33 / 12053) + 1;

        // Adjust by ±1 in case the approximation lands on the wrong side of a year boundary
        if (this._persianYearStart(pYear + 1) <= jdn) {
            pYear = pYear + 1;
        } else if (this._persianYearStart(pYear) > jdn) {
            pYear = pYear - 1;
        }

        // Day of year (0-indexed)
        var doy = jdn - this._persianYearStart(pYear);

        // Months 1–6: 31 days each (total 186 days)
        // Months 7–11: 30 days each; month 12: 29 days (30 in leap years)
        var pMonth, pDay;
        if (doy < 186) {
            pMonth = Math.floor(doy / 31) + 1;
            pDay   = (doy % 31) + 1;
        } else {
            var rem30 = doy - 186;
            pMonth = Math.floor(rem30 / 30) + 7;
            pDay   = (rem30 % 30) + 1;
        }

        return { year: pYear, month: pMonth, day: pDay };
    },

    /**
     * Format a Persian calendar date as a human-readable string.
     * @param {number} year   Gregorian year (will be converted internally)
     * @param {number} month  1–12
     * @param {number} day    1–31
     * @returns {string}  e.g. "4 Farvardin 1405"
     */
    formatPersian: function(year, month, day) {
        var p = this.toPersian(year, month, day);
        return p.day + " " + this._PERSIAN_MONTHS[p.month - 1] + " " + p.year;
    },

    // ════════════════════════════════════════════════════════════════════
    // French Republican calendar  (equinox-based, historically accurate)
    // ════════════════════════════════════════════════════════════════════
    //
    // Year 1 began at the true autumnal equinox of 1792 (22 September
    // 1792), and each subsequent Republican year begins at the *next*
    // true autumnal equinox — not a fixed arithmetic leap-year rule (the
    // later "Romme method" some software uses). Whether a given Republican
    // year has 5 or 6 intercalary Sansculottide days falls out naturally
    // from the actual number of days between two real consecutive
    // equinoxes (365 or 366), which is why this is built on
    // Solstice.getForYear()'s real astronomical calculation.

    /**
     * Build a local-midnight Date for the calendar day a (possibly
     * UTC-instant) Date falls on. Mirrors solstice.js's own getNext()
     * technique of comparing local calendar days rather than raw UTC
     * instants, to avoid timezone-driven off-by-one-day bugs.
     * @param {Date} d
     * @returns {Date}
     */
    _localMidnight: function(d) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    },

    /**
     * Convert a Gregorian date to the French Republican calendar.
     * @param {number} year   Gregorian year
     * @param {number} month  1–12
     * @param {number} day    1–31
     * @returns {Object}  { year, month, day, sansculottide }
     *   month/day are 1-based and only meaningful when sansculottide === -1;
     *   sansculottide is 0-4 (or 0-5 in a sextile year) for one of the 5/6
     *   intercalary days, or -1 for a regular month day.
     */
    toFrenchRepublican: function(year, month, day) {
        var target = new Date(year, month - 1, day, 0, 0, 0, 0);

        // Which autumn equinox is this date's applicable Republican New Year?
        var newYearEvent    = Solstice.getForYear(year).autumn;
        var newYearMidnight = this._localMidnight(newYearEvent);
        var republicanYear  = year - 1791;

        if (target.getTime() < newYearMidnight.getTime()) {
            // Not yet reached this Gregorian year's autumn equinox —
            // the applicable New Year is the previous one.
            newYearEvent    = Solstice.getForYear(year - 1).autumn;
            newYearMidnight = this._localMidnight(newYearEvent);
            republicanYear  = year - 1792;
        }

        var msPerDay = 86400000;
        var daysSinceNewYear = Math.round((target.getTime() - newYearMidnight.getTime()) / msPerDay);

        if (daysSinceNewYear < 360) {
            var rMonth = Math.floor(daysSinceNewYear / 30) + 1;
            var rDay   = (daysSinceNewYear % 30) + 1;
            return { year: republicanYear, month: rMonth, day: rDay, sansculottide: -1 };
        }

        return { year: republicanYear, month: 0, day: 0, sansculottide: daysSinceNewYear - 360 };
    },

    /**
     * Format a French Republican calendar date as a human-readable string.
     * @param {number} year   Gregorian year (will be converted internally)
     * @param {number} month  1–12
     * @param {number} day    1–31
     * @returns {string}  e.g. "3 Brumaire, an 234" or "Jour de la Vertu, an 3"
     */
    formatFrenchRepublican: function(year, month, day) {
        var r = this.toFrenchRepublican(year, month, day);
        if (r.sansculottide >= 0) {
            return this._FRENCH_REPUBLICAN_SANSCULOTTIDES[r.sansculottide] + ", an " + r.year;
        }
        return r.day + " " + this._FRENCH_REPUBLICAN_MONTHS[r.month - 1] + ", an " + r.year;
    }
};
