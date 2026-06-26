/*
 * moon.js — Moon phase calculation for Calendarium desklet
 *
 * Algorithm: Julian Date anchor method.
 * Reference new moon: January 6, 2000 at 18:14 UTC → JD 2451550.26
 * Synodic month: 29.53058867 days
 *
 * This module exports a single `Moon` object.
 */

var Moon = {

    SYNODIC_MONTH: 29.53058867,

    // Julian Date of a known new moon: 2000-01-06 18:14 UTC
    KNOWN_NEW_MOON_JD: 2451550.26,

    // Phase symbols (Unicode lunar phase characters)
    PHASE_SYMBOLS: ["\uD83C\uDF11", "\uD83C\uDF12", "\uD83C\uDF13", "\uD83C\uDF14",
                    "\uD83C\uDF15", "\uD83C\uDF16", "\uD83C\uDF17", "\uD83C\uDF18"],

    // Phase names — English keys, wrapped in _() by caller
    PHASE_NAMES: [
        "New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
        "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"
    ],

    /**
     * Convert a JavaScript Date to Julian Day Number (decimal).
     * @param {Date} date
     * @returns {number}
     */
    toJulianDate: function(date) {
        let Y  = date.getUTCFullYear();
        let M  = date.getUTCMonth() + 1;
        let D  = date.getUTCDate();
        let UT = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

        let A = Math.floor((14 - M) / 12);
        let y = Y + 4800 - A;
        let m = M + 12 * A - 3;

        let JDN = D
                + Math.floor((153 * m + 2) / 5)
                + 365 * y
                + Math.floor(y / 4)
                - Math.floor(y / 100)
                + Math.floor(y / 400)
                - 32045;

        return JDN - 0.5 + UT / 24;
    },

    /**
     * Compute the current moon phase for a given date.
     * @param {Date} date  JavaScript Date object (local or UTC, date portion is used)
     * @returns {Object}  { age, phase, phaseIndex, phaseName, phaseSymbol }
     *   age         — days elapsed since last new moon (0 … 29.53)
     *   phase       — fraction of synodic month completed (0.0 … <1.0)
     *   phaseIndex  — integer 0–7 (0=New Moon … 7=Waning Crescent)
     *   phaseName   — English string key (wrap in _() for translation)
     *   phaseSymbol — Unicode emoji representing the phase
     */
    getMoonPhase: function(date) {
        let jd      = this.toJulianDate(date);
        let elapsed = jd - this.KNOWN_NEW_MOON_JD;
        let age     = elapsed % this.SYNODIC_MONTH;
        if (age < 0) age += this.SYNODIC_MONTH;

        let phase = age / this.SYNODIC_MONTH;   // 0.0 … <1.0

        // Divide the cycle into 8 equal arcs of 1/16 synodic month each,
        // centred on the 4 primary and 4 intermediate phases.
        let phaseIndex;
        if      (phase < 0.0625) phaseIndex = 0;   // New Moon
        else if (phase < 0.1875) phaseIndex = 1;   // Waxing Crescent
        else if (phase < 0.3125) phaseIndex = 2;   // First Quarter
        else if (phase < 0.4375) phaseIndex = 3;   // Waxing Gibbous
        else if (phase < 0.5625) phaseIndex = 4;   // Full Moon
        else if (phase < 0.6875) phaseIndex = 5;   // Waning Gibbous
        else if (phase < 0.8125) phaseIndex = 6;   // Last Quarter
        else if (phase < 0.9375) phaseIndex = 7;   // Waning Crescent
        else                     phaseIndex = 0;   // New Moon (wraps)

        return {
            age:         age,
            phase:       phase,
            phaseIndex:  phaseIndex,
            phaseName:   this.PHASE_NAMES[phaseIndex],
            phaseSymbol: this.PHASE_SYMBOLS[phaseIndex]
        };
    }
};
