/** Settings helpers (schema lives in settings-schema.json at desklet root). */
const { SortMode } = require("./models/device");

const DEFAULTS = {
    sortBy: SortMode.BATTERY_ASC,
    compactMode: true,
    expandOnClick: true,
    connectedOnly: true
};

module.exports = { DEFAULTS, SortMode };
