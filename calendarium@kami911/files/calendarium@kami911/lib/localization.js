/*
 * localization.js — Traditional / historical month names for Calendarium desklet
 *
 * These names are cultural data and are NOT routed through Gettext;
 * they are inherently language-specific and displayed as-is.
 *
 * To add a new tradition:
 *   1. Add a new key with a 12-element array to TRADITIONAL_MONTHS.
 *   2. Add the corresponding option to settings-schema.json under "traditional-lang".
 *
 * This module exports a single `Localization` object.
 */

var Localization = {

    TRADITIONAL_MONTHS: {
        // Old Hungarian month names (hónap nevek)
        hu: [
            "Boldogasszony hava",   // January   — Month of the Blessed Lady
            "Böjtelő hava",         // February  — Month of early fasting
            "Böjtmás hava",         // March     — Month of second fasting
            "Szent György hava",    // April     — Month of Saint George
            "Pünkösd hava",         // May       — Month of Pentecost
            "Szent Iván hava",      // June      — Month of Saint John
            "Szent Jakab hava",     // July      — Month of Saint James
            "Kisasszony hava",      // August    — Month of the Little Lady
            "Szent Mihály hava",    // September — Month of Saint Michael
            "Mindszent hava",       // October   — Month of All Saints
            "Szent András hava",    // November  — Month of Saint Andrew
            "Karácsony hava"        // December  — Month of Christmas
        ],

        // Old English / Anglo-Saxon month names
        en: [
            "Wulfmonath",           // January   — Wolf Month
            "Solmonath",            // February  — Mud/Sun Month
            "Hrethmonath",          // March     — Month of the goddess Hretha
            "Eosturmonath",         // April     — Month of the goddess Eostra
            "Thrimilchi",           // May       — Three-milkings month
            "Aerra Litha",          // June      — Before Midsummer
            "Aeftera Litha",        // July      — After Midsummer
            "Weodmonath",           // August    — Weed Month
            "Haligmonath",          // September — Holy Month
            "Winterfilleth",        // October   — Winter Filling
            "Blotmonath",           // November  — Blood/Sacrifice Month
            "Aerra Geola"           // December  — Before Yule
        ],

        // Old German month names
        de: [
            "Hartung",              // January   — Hard/Frost Month
            "Hornung",              // February  — Shedding Month
            "Lenzmond",             // March     — Spring Month
            "Ostermond",            // April     — Easter Month
            "Wonnemonat",           // May       — Joy Month
            "Brachmond",            // June      — Fallow Month
            "Heumond",              // July      — Hay Month
            "Erntemond",            // August    — Harvest Month
            "Herbstmond",           // September — Autumn Month
            "Weinmond",             // October   — Wine Month
            "Nebelmond",            // November  — Fog Month
            "Christmond"            // December  — Christmas Month
        ]
    },

    /**
     * Look up the traditional month name for a given language and month.
     * @param {string} lang         Language code: "hu" | "en" | "de"
     * @param {number} monthIndex   0-based month index (0 = January … 11 = December)
     * @returns {string}  Traditional month name, or "" if not found.
     */
    getTraditionalMonthName: function(lang, monthIndex) {
        let months = this.TRADITIONAL_MONTHS[lang];
        if (!months) return "";
        if (monthIndex < 0 || monthIndex > 11) return "";
        return months[monthIndex];
    }
};
