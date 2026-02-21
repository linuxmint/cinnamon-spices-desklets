/*
 * zodiac.js — Western and Chinese zodiac for Calendarium desklet
 *
 * Western: lookup table keyed by [month, startDay].
 * Chinese: modular arithmetic anchored to 2020 (Metal Rat year).
 *   Chinese New Year is approximated to February 5 of each year.
 *
 * All name strings are English keys intended to be wrapped in _()
 * by the caller for translation.
 *
 * This module exports a single `Zodiac` object.
 */

var Zodiac = {

    // ── Western zodiac ──────────────────────────────────────────────────
    // Each entry: [startMonth (1-based), startDay, nameKey, unicodeSymbol]
    // The sign is in effect from [startMonth, startDay] until the next entry's date.
    _WESTERN: [
        [ 1, 20, "Aquarius",    "\u2652"],
        [ 2, 19, "Pisces",      "\u2653"],
        [ 3, 21, "Aries",       "\u2648"],
        [ 4, 20, "Taurus",      "\u2649"],
        [ 5, 21, "Gemini",      "\u264A"],
        [ 6, 21, "Cancer",      "\u264B"],
        [ 7, 23, "Leo",         "\u264C"],
        [ 8, 23, "Virgo",       "\u264D"],
        [ 9, 23, "Libra",       "\u264E"],
        [10, 23, "Scorpio",     "\u264F"],
        [11, 22, "Sagittarius", "\u2650"],
        [12, 22, "Capricorn",   "\u2651"]
    ],

    /**
     * Return the western zodiac sign for a given date.
     * @param {Date} date
     * @returns {Object}  { name: string key, symbol: string }
     */
    getWesternZodiac: function(date) {
        let m = date.getMonth() + 1;
        let d = date.getDate();

        // Walk the table forwards; last matching entry wins.
        let result = { name: "Capricorn", symbol: "\u2651" };
        for (let i = 0; i < this._WESTERN.length; i++) {
            let sm = this._WESTERN[i][0];
            let sd = this._WESTERN[i][1];
            if (m > sm || (m === sm && d >= sd)) {
                result = { name: this._WESTERN[i][2], symbol: this._WESTERN[i][3] };
            }
        }
        // Jan 1–19 wraps back to Capricorn (correct, already default)
        return result;
    },

    // ── Chinese zodiac ──────────────────────────────────────────────────
    // 12-year animal cycle, anchored: 2020 = Rat (index 0).
    ANIMALS: [
        "Rat", "Ox", "Tiger", "Rabbit", "Dragon", "Snake",
        "Horse", "Goat", "Monkey", "Rooster", "Dog", "Pig"
    ],

    // 5-element cycle, two years per element.
    // Anchored to 2020 (Metal Rat): pairIndex 0 → Metal.
    // pairIndex 0=Metal, 1=Water, 2=Wood, 3=Fire, 4=Earth (then repeats)
    ELEMENTS: ["Wood", "Fire", "Earth", "Metal", "Water"],

    // Maps pairIndex [0..4] to ELEMENTS index
    _ELEMENT_ORDER: [3, 4, 0, 1, 2],  // Metal, Water, Wood, Fire, Earth

    /**
     * Return the Chinese zodiac animal and element for a given year.
     * Chinese New Year is approximated to February 5.
     * @param {number} year   Gregorian year
     * @param {number} month  1–12
     * @param {number} day    1–31
     * @returns {Object}  { animalKey, elementKey, animalIndex, elementIndex }
     */
    getChineseZodiac: function(year, month, day) {
        // If before approximate Chinese New Year (Feb 5), use previous year
        let cycleYear = (month < 2 || (month === 2 && day < 5)) ? year - 1 : year;

        // Animal index: 2020 = Rat (0), 12-year cycle
        let animalIndex = ((cycleYear - 2020) % 12 + 12) % 12;

        // Element: 10-year cycle (5 elements × 2 years each)
        let pairIndex    = (((cycleYear - 2020) % 10) + 10) % 10;
        let elementPair  = Math.floor(pairIndex / 2);           // 0–4
        let elementIndex = this._ELEMENT_ORDER[elementPair];    // index into ELEMENTS

        return {
            animalKey:    this.ANIMALS[animalIndex],
            elementKey:   this.ELEMENTS[elementIndex],
            animalIndex:  animalIndex,
            elementIndex: elementIndex
        };
    }
};
