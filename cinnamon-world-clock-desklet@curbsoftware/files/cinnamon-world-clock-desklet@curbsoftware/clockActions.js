/* global imports */
/**
 * clockActions.js
 *
 * Pure clock-list and grid-layout helpers for the World Clock desklet.
 * Deliberately contains no St/Clutter widgets so the module can be exercised
 * by a headless test harness (libst.so cannot be loaded outside the Cinnamon
 * process).
 *
 * computeGridDims / planCells are adapted from the Workspace Grid desklet's
 * workspaceActions.js. Cinnamon gives xlets no way to import across xlet
 * boundaries, so the maths is duplicated here rather than shared.
 */

let _translate = function (str) { return str; };

function setTranslate(fn) {
    if (typeof fn === "function")
        _translate = fn;
}

/* Call sites use _() so cinnamon-xlet-makepot's default keyword extracts
 * them; _() always routes through the injected translator. */
function _(str) {
    return _translate(str);
}

var MIN_CLOCKS = 1;
var MAX_CLOCKS = 36;

var DEFAULT_CLOCK = {
    name: "Local",
    timezone: "local"
};

function _newId(opts) {
    opts = opts || {};
    if (typeof opts.generateId === "function")
        return opts.generateId();
    try {
        return imports.gi.GLib.uuid_string_random();
    } catch (e) {
        return "clock-" + Date.now() + "-" + Math.floor(Math.random() * 1e9);
    }
}

function _toPositiveInt(value, fallback) {
    let n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < 1)
        return fallback;
    return n;
}

/* ------------------------------------------------------------------ *
 * Pure layout helpers
 * ------------------------------------------------------------------ */

/**
 * computeGridDims:
 * @cellCount (int): total cells to lay out, including the "+" tile
 * @mode (string): "fixed" or anything else for auto
 * @fixedRows (int): rows to use in fixed mode
 * @fixedCols (int): columns to use in fixed mode
 *
 * Returns (object): { rows, cols }. Auto mode produces a near-square grid.
 * Fixed mode returns the requested dimensions verbatim, which may be smaller
 * than @cellCount - planCells() handles that overflow.
 */
function computeGridDims(cellCount, mode, fixedRows, fixedCols) {
    let n = _toPositiveInt(cellCount, 1);

    if (mode === "fixed") {
        return {
            rows: _toPositiveInt(fixedRows, 1),
            cols: _toPositiveInt(fixedCols, 1)
        };
    }

    let cols = Math.ceil(Math.sqrt(n));
    let rows = Math.ceil(n / cols);
    return { rows: rows, cols: cols };
}

/**
 * planCells:
 * @clockCount (int): number of clocks to show
 * @showAddTile (boolean): whether to reserve a cell for the "+" tile
 * @rows (int): grid rows
 * @cols (int): grid columns
 *
 * Decides what goes in each grid cell, in row-major order. When the grid is
 * too small to hold everything, clocks are truncated but the "+" tile keeps
 * the final cell so it stays reachable.
 *
 * Returns (array): [{ kind: "clock"|"add", index: int }, ...]
 */
function planCells(clockCount, showAddTile, rows, cols) {
    let n = parseInt(clockCount, 10);
    if (!Number.isFinite(n) || n < 0)
        n = 0;

    let capacity = _toPositiveInt(rows, 1) * _toPositiveInt(cols, 1);
    let cells = [];

    if (capacity <= 0)
        return cells;

    if (!showAddTile) {
        let limit = Math.min(n, capacity);
        for (let i = 0; i < limit; i++)
            cells.push({ kind: "clock", index: i });
        return cells;
    }

    let clockSlots = Math.min(n, capacity - 1);
    for (let i = 0; i < clockSlots; i++)
        cells.push({ kind: "clock", index: i });
    cells.push({ kind: "add", index: -1 });
    return cells;
}

/* ------------------------------------------------------------------ *
 * Tile text fitting
 * ------------------------------------------------------------------ */

/**
 * Chrome subtracted when turning desklet width/height into a tile's inner
 * text box. Keep in sync with stylesheet.css
 * (.world-clock-container padding, tile padding/border).
 */
var TILE_LAYOUT = {
    containerPad: 6,
    tileBorder: 2,
    padX: 6,
    padY: 4,
    lineGap: 2,
    minPt: 4,
    ptToPx: 4 / 3,
    lineHeight: 1.25,
    timeEm: 0.72,
    dateEm: 0.58,
    labelEm: 0.56,
    addMaxPt: 16
};

function _finite(value, fallback) {
    let n = Number(value);
    if (!Number.isFinite(n))
        return fallback;
    return n;
}

function _roundPt(n) {
    if (!Number.isFinite(n) || n < 1)
        return 1;
    return Math.round(n * 10) / 10;
}

/**
 * computeTileInnerSize:
 * @deskletWidth (number): main container width in px
 * @deskletHeight (number): main container height in px
 * @rows (int): grid rows
 * @cols (int): grid columns
 * @tileSpacing (number): per-side tile margin in px
 * @opts (object): optional overrides for TILE_LAYOUT chrome
 *
 * Returns (object): { width, height } of the text box inside one tile.
 */
function computeTileInnerSize(deskletWidth, deskletHeight, rows, cols, tileSpacing, opts) {
    opts = opts || {};
    let pad = TILE_LAYOUT.containerPad;
    if (opts.containerPad != null)
        pad = Math.max(0, _finite(opts.containerPad, pad));
    let border = TILE_LAYOUT.tileBorder;
    if (opts.tileBorder != null)
        border = Math.max(0, _finite(opts.tileBorder, border));
    let padX = TILE_LAYOUT.padX;
    if (opts.padX != null)
        padX = Math.max(0, _finite(opts.padX, padX));
    let padY = TILE_LAYOUT.padY;
    if (opts.padY != null)
        padY = Math.max(0, _finite(opts.padY, padY));

    let r = _toPositiveInt(rows, 1);
    let c = _toPositiveInt(cols, 1);
    let spacing = Math.max(0, _finite(tileSpacing, 0));
    let tableW = Math.max(0, _finite(deskletWidth, 200) - 2 * pad);
    let tableH = Math.max(0, _finite(deskletHeight, 200) - 2 * pad);
    let cellW = tableW / c;
    let cellH = tableH / r;

    return {
        width: Math.max(0, cellW - 2 * spacing - 2 * border - 2 * padX),
        height: Math.max(0, cellH - 2 * spacing - 2 * border - 2 * padY)
    };
}

function _glyphEm(ch, em) {
    if (ch >= "0" && ch <= "9")
        return Math.max(em, 0.72);
    if (ch === ":" || ch === ".")
        return 0.38;
    if (ch === " " || ch === ",")
        return 0.33;
    return em;
}

function _textEmUnits(text, em) {
    let s = String(text || "");
    let units = 0;
    for (let i = 0; i < s.length; i++)
        units += _glyphEm(s[i], em);
    return units;
}

function _textWidthPx(text, sizePt, ptToPx, em) {
    let units = _textEmUnits(text, em);
    if (units <= 0)
        return 0;
    return units * sizePt * ptToPx;
}

function _maxPtForWidth(text, innerW, ptToPx, em, cap) {
    let units = _textEmUnits(text, em);
    if (units <= 0)
        return cap;
    if (!(innerW > 0) || !(ptToPx > 0))
        return 1;
    let pt = innerW / (units * ptToPx);
    if (!Number.isFinite(pt) || pt <= 0)
        return 1;
    return Math.min(cap, pt);
}

/**
 * worstTimeSample:
 * @format (string): strftime time format
 * @extras (object): { hundredths } to append a ".99" fraction
 *
 * Returns (string): a wide sample used to size the time line before the
 * live string is known, so enabling seconds cannot overflow a tile.
 */
function worstTimeSample(format, extras) {
    extras = extras || {};
    let fmt = typeof format === "string" ? format : "";
    let hasSeconds = !fmt || /%[STcT]/.test(fmt);
    let twelveHour = /%[IilpPr]/.test(fmt);
    let sample;
    if (twelveHour)
        sample = hasSeconds ? "12:59:59 PM" : "12:59 PM";
    else
        sample = hasSeconds ? "23:59:59" : "23:59";
    if (extras.hundredths)
        sample += ".99";
    return sample;
}

/**
 * computeFittedFontSizes:
 * @innerWidth (number): tile text box width in px
 * @innerHeight (number): tile text box height in px
 * @texts (object): { time, date, label } sample strings
 * @maxSizes (object): { time, date, timezone } caps in pt
 * @opts (object): optional TILE_LAYOUT overrides
 *
 * Settings sizes are caps. Time and date shrink to fit; a long name/timezone
 * label ellipsizes instead of shrinking the clock. Hierarchy is
 * time >= date >= timezone. "+" tiles use the returned `add` size.
 *
 * Returns (object): { time, date, timezone, add, ellipsizeLabel }
 */
function computeFittedFontSizes(innerWidth, innerHeight, texts, maxSizes, opts) {
    opts = opts || {};
    texts = texts || {};
    maxSizes = maxSizes || {};

    let ptToPx = _finite(opts.ptToPx, TILE_LAYOUT.ptToPx);
    if (!(ptToPx > 0))
        ptToPx = TILE_LAYOUT.ptToPx;
    let lineHeight = _finite(opts.lineHeight, TILE_LAYOUT.lineHeight);
    if (!(lineHeight > 0))
        lineHeight = TILE_LAYOUT.lineHeight;
    let lineGap = Math.max(0, _finite(opts.lineGap, TILE_LAYOUT.lineGap));
    let timeEm = _finite(opts.timeEm, TILE_LAYOUT.timeEm);
    let dateEm = _finite(opts.dateEm, TILE_LAYOUT.dateEm);
    let labelEm = _finite(opts.labelEm, TILE_LAYOUT.labelEm);
    let addMax = _finite(opts.addMaxPt, TILE_LAYOUT.addMaxPt);

    let maxTime = _finite(maxSizes.time, 40);
    let maxDate = _finite(maxSizes.date, 15);
    let maxTz = _finite(maxSizes.timezone, 12);
    if (maxTime < 1)
        maxTime = 1;
    if (maxDate < 1)
        maxDate = 1;
    if (maxTz < 1)
        maxTz = 1;

    let innerW = Math.max(0, _finite(innerWidth, 0));
    let innerH = Math.max(0, _finite(innerHeight, 0));
    let timeText = texts.time || "";
    let dateText = texts.date || "";
    let labelText = texts.label || "";

    let add = addMax;
    if (innerH > 0)
        add = Math.min(add, (innerH * 0.55) / ptToPx);
    if (innerW > 0)
        add = Math.min(add, (innerW * 0.7) / ptToPx);

    let time = _maxPtForWidth(timeText, innerW, ptToPx, timeEm, maxTime);
    let date = _maxPtForWidth(dateText, innerW, ptToPx, dateEm, maxDate);
    let timezone = Math.min(maxTz, time, date);

    let neededH = (time + date + timezone) * ptToPx * lineHeight + 2 * lineGap;
    if (innerH > 0 && neededH > innerH) {
        let avail = Math.max(0, innerH - 2 * lineGap);
        let base = (time + date + timezone) * ptToPx * lineHeight;
        if (base > 0) {
            let scale = avail / base;
            time *= scale;
            date *= scale;
            timezone *= scale;
        }
    }

    time = Math.min(time, _maxPtForWidth(timeText, innerW, ptToPx, timeEm, maxTime));
    date = Math.min(date, _maxPtForWidth(dateText, innerW, ptToPx, dateEm, maxDate));
    if (date > time)
        date = time;
    if (timezone > date)
        timezone = date;

    let ellipsizeLabel = _textWidthPx(labelText, timezone, ptToPx, labelEm) > innerW && innerW > 0;

    return {
        time: _roundPt(time),
        date: _roundPt(date),
        timezone: _roundPt(timezone),
        add: _roundPt(add),
        ellipsizeLabel: !!ellipsizeLabel
    };
}

/* ------------------------------------------------------------------ *
 * Clock list helpers
 * ------------------------------------------------------------------ */

/**
 * buildClock:
 * @values (object): { name, timezone }
 * @existingId (string): keep this id when editing; omit to allocate a new one
 * @opts (object): optional { generateId: function }
 *
 * Returns (object): { id, name, timezone }
 */
function buildClock(values, existingId, opts) {
    values = values && typeof values === "object" ? values : {};

    let id = typeof existingId === "string" ? existingId.trim() : "";
    if (!id || id === "default")
        id = _newId(opts);

    let name = typeof values.name === "string" ? values.name.trim() : "";
    let timezone = typeof values.timezone === "string" ? values.timezone.trim() : "";
    if (!timezone)
        timezone = DEFAULT_CLOCK.timezone;

    return {
        id: id,
        name: name,
        timezone: timezone
    };
}

/**
 * normalizeClockEntry:
 * @clock (object): raw clock record, possibly with legacy size/format fields
 * @opts (object): optional { generateId: function }
 *
 * Drops per-clock format/size fields. Returns { changed, clock }.
 */
function normalizeClockEntry(clock, opts) {
    let input = clock && typeof clock === "object" ? clock : {};
    let changed = !(clock && typeof clock === "object");

    let id = typeof input.id === "string" ? input.id.trim() : "";
    if (!id || id === "default") {
        id = _newId(opts);
        changed = true;
    }

    let name = typeof input.name === "string" ? input.name.trim() : "";
    if (name !== input.name)
        changed = true;

    let timezone = typeof input.timezone === "string" ? input.timezone.trim() : "";
    if (!timezone) {
        timezone = DEFAULT_CLOCK.timezone;
        changed = true;
    } else if (timezone !== input.timezone) {
        changed = true;
    }

    for (let key in input) {
        if (key !== "id" && key !== "name" && key !== "timezone") {
            changed = true;
            break;
        }
    }

    return {
        changed: changed,
        clock: {
            id: id,
            name: name,
            timezone: timezone
        }
    };
}

/**
 * normalizeClockList:
 * @clockList (array): raw clocks setting
 * @opts (object): optional { generateId: function }
 *
 * Returns (object): { clocks, changed }. An empty list becomes one default clock.
 */
function normalizeClockList(clockList, opts) {
    let list = Array.isArray(clockList) ? clockList : [];
    let normalized = [];
    let changed = !Array.isArray(clockList);

    for (let i = 0; i < list.length; i++) {
        let result = normalizeClockEntry(list[i], opts);
        normalized.push(result.clock);
        if (result.changed)
            changed = true;
    }

    if (normalized.length === 0) {
        normalized.push(buildClock(DEFAULT_CLOCK, null, opts));
        changed = true;
    }

    return {
        clocks: normalized,
        changed: changed
    };
}

function _clocks(clocks) {
    return Array.isArray(clocks) ? clocks : [];
}

/**
 * canAdd:
 * @clocks (array)
 *
 * Returns (boolean): whether another clock may be created.
 */
function canAdd(clocks) {
    return _clocks(clocks).length < MAX_CLOCKS;
}

/**
 * canRemove:
 * @clocks (array)
 *
 * Returns (boolean): whether a clock may be removed. The last clock is kept.
 */
function canRemove(clocks) {
    return _clocks(clocks).length > MIN_CLOCKS;
}

/**
 * isValidIndex:
 * @clocks (array)
 * @index (int)
 *
 * Returns (boolean): whether @index addresses an existing clock.
 */
function isValidIndex(clocks, index) {
    let n = _clocks(clocks).length;
    return Number.isInteger(index) && index >= 0 && index < n;
}

/**
 * getClockLabel:
 * @clock (object)
 *
 * Returns (string): display name, falling back to a short timezone label.
 */
function getClockLabel(clock) {
    if (!clock || typeof clock !== "object")
        return _("Clock");
    if (typeof clock.name === "string" && clock.name.trim())
        return clock.name.trim();
    if (typeof clock.timezone === "string" && clock.timezone.trim())
        return timezoneDisplayName(clock.timezone);
    return _("Clock");
}

/**
 * timezoneDisplayName:
 * @tz (string): "local" or an IANA timezone id
 *
 * Returns (string): a short label, e.g. "Local" or "Los Angeles".
 */
function timezoneDisplayName(tz) {
    if (!tz || tz === "local")
        return _("Local");
    let parts = String(tz).split("/");
    return parts[parts.length - 1].replace(/_/g, " ");
}

/**
 * timezoneListLabel:
 * @tz (string)
 *
 * Returns (string): list-row text, e.g. "Los Angeles (America/Los_Angeles)".
 */
function timezoneListLabel(tz) {
    if (!tz || tz === "local")
        return _("Local (system timezone)");
    let pretty = timezoneDisplayName(tz);
    if (pretty === tz)
        return tz;
    return pretty + " (" + tz + ")";
}

function _uniqueSorted(list) {
    let seen = Object.create(null);
    let out = [];
    for (let i = 0; i < list.length; i++) {
        let tz = list[i];
        if (typeof tz !== "string" || !tz || tz === "local" || seen[tz])
            continue;
        seen[tz] = true;
        out.push(tz);
    }
    out.sort();
    return out;
}

var FALLBACK_TIMEZONES = [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Anchorage",
    "America/Honolulu",
    "America/Toronto",
    "America/Mexico_City",
    "America/Sao_Paulo",
    "America/Argentina/Buenos_Aires",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Madrid",
    "Europe/Rome",
    "Europe/Moscow",
    "Africa/Cairo",
    "Africa/Johannesburg",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Shanghai",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Asia/Seoul",
    "Australia/Sydney",
    "Pacific/Auckland"
];

/**
 * listTimezones:
 *
 * Returns (array): ["local", ...IANA ids]. Uses Intl when available.
 */
function listTimezones() {
    let zones = [];
    try {
        if (typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function")
            zones = Intl.supportedValuesOf("timeZone");
    } catch (e) {
        zones = [];
    }
    if (!zones || !zones.length)
        zones = FALLBACK_TIMEZONES.slice();
    return ["local"].concat(_uniqueSorted(zones));
}

/**
 * filterTimezones:
 * @zones (array)
 * @query (string)
 *
 * Returns (array): zones whose id or display name contains @query.
 */
function filterTimezones(zones, query) {
    let list = Array.isArray(zones) ? zones : [];
    let q = typeof query === "string" ? query.trim().toLowerCase() : "";
    if (!q)
        return list.slice();
    return list.filter(function (tz) {
        let id = String(tz).toLowerCase();
        let label = timezoneListLabel(tz).toLowerCase();
        let city = String(tz).replace(/_/g, " ").toLowerCase();
        return id.indexOf(q) !== -1 || label.indexOf(q) !== -1 || city.indexOf(q) !== -1;
    });
}

/**
 * addClock:
 * @clocks (array)
 * @values (object): { name, timezone }
 * @opts (object): optional { generateId: function }
 *
 * Returns (array): a new list with the clock appended, or a copy if at max.
 */
function addClock(clocks, values, opts) {
    let list = _clocks(clocks).slice();
    if (!canAdd(list))
        return list;
    list.push(buildClock(values, null, opts));
    return list;
}

/**
 * updateClock:
 * @clocks (array)
 * @clockId (string)
 * @values (object): { name, timezone }
 *
 * Returns (array): a new list with the matching clock replaced.
 */
function updateClock(clocks, clockId, values) {
    let list = _clocks(clocks);
    if (typeof clockId !== "string" || !clockId)
        return list.slice();

    let found = false;
    let next = list.map(function (clock) {
        if (clock.id !== clockId)
            return clock;
        found = true;
        return buildClock(values, clock.id);
    });
    return found ? next : list.slice();
}

/**
 * removeClock:
 * @clocks (array)
 * @clockId (string)
 *
 * Returns (array): a new list without that clock. Refuses to empty the list.
 */
function removeClock(clocks, clockId) {
    let list = _clocks(clocks);
    if (!canRemove(list) || typeof clockId !== "string" || !clockId)
        return list.slice();
    return list.filter(function (clock) {
        return clock.id !== clockId;
    });
}
