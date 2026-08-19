/* global imports */
/**
 * cardActions.js
 *
 * Pure colour-schedule engine and card-layout helpers for the Color Timer
 * Clock desklet. Deliberately contains no St/Clutter widgets so the module
 * can be exercised by a headless test harness (libst.so cannot be loaded
 * outside the Cinnamon process).
 *
 * computeCardInnerSize / computeFittedFontSizes are copied from the World
 * Clock desklet's clockActions.js (tile renamed to card). Cinnamon gives
 * xlets no way to import across xlet boundaries, so the maths is duplicated
 * here rather than shared.
 */

var DAY_SECONDS = 86400;

/* Backing a translucent card colour is composited over for the luma
 * estimate: the desklet card default background. Keep in sync with
 * stylesheet.css (.ctc-card fallback background). */
var LUMA_BACKING = [34, 34, 34];

/* Colour used when a user colour cannot be parsed; matches the stylesheet
 * card fallback so a bad row reads as "themed default", never a blank. */
var FALLBACK_COLOR = [0, 0, 0, 0.25];

/* Named colours accepted besides hex. Anything CSS-standard keeps the
 * values unsurprising. */
var NAMED_COLORS = {
    black: "#000000",
    white: "#ffffff",
    red: "#ff0000",
    orange: "#ffa500",
    yellow: "#ffff00",
    lime: "#00ff00",
    green: "#008000",
    teal: "#008080",
    cyan: "#00ffff",
    blue: "#0000ff",
    purple: "#800080",
    magenta: "#ff00ff",
    grey: "#808080"
};

/* ------------------------------------------------------------------ *
 * Colour parsing and formatting
 * ------------------------------------------------------------------ */

function _channel(v) {
    let n = Math.round(Number(v));
    if (!Number.isFinite(n))
        n = 0;
    return Math.max(0, Math.min(255, n));
}

function _hex2(n) {
    let h = n.toString(16);
    return h.length === 1 ? "0" + h : h;
}

/**
 * parseColor:
 * @str: "#rgb", "#rgba", "#rrggbb" or "#rrggbbaa" (either case), or one of
 *   the NAMED_COLORS names (either case). rgba()/hsl() strings are not
 *   accepted.
 *
 * Returns (object): { ok: true, rgba: [r, g, b, a] } with a in 0..1, or
 * { ok: false } for anything else.
 */
function parseColor(str) {
    if (typeof str !== "string")
        return { ok: false };

    let s = str.trim().toLowerCase();
    if (!s)
        return { ok: false };

    if (s[0] !== "#") {
        let hex = NAMED_COLORS[s];
        if (hex)
            return parseColor(hex);
        return { ok: false };
    }

    let body = s.slice(1);
    if (body.length !== 3 && body.length !== 4 &&
        body.length !== 6 && body.length !== 8)
        return { ok: false };
    if (!/^[0-9a-f]+$/.test(body))
        return { ok: false };

    let r, g, b, a = 255;
    if (body.length === 3 || body.length === 4) {
        r = parseInt(body[0] + body[0], 16);
        g = parseInt(body[1] + body[1], 16);
        b = parseInt(body[2] + body[2], 16);
        if (body.length === 4)
            a = parseInt(body[3] + body[3], 16);
    } else {
        r = parseInt(body[0] + body[1], 16);
        g = parseInt(body[2] + body[3], 16);
        b = parseInt(body[4] + body[5], 16);
        if (body.length === 8)
            a = parseInt(body[6] + body[7], 16);
    }

    return { ok: true, rgba: [r, g, b, a / 255] };
}

/**
 * rgbaToCss:
 * @rgba (array): [r, g, b, a] with a in 0..1
 *
 * Returns (string): "rgba(r, g, b, a)" with the alpha formatted to two
 * decimals, ready for a St set_style() call.
 */
function rgbaToCss(rgba) {
    let c = Array.isArray(rgba) ? rgba : FALLBACK_COLOR;
    let a = Number(c[3]);
    if (!Number.isFinite(a))
        a = 1;
    a = Math.max(0, Math.min(1, a));
    return "rgba(" + _channel(c[0]) + ", " + _channel(c[1]) + ", " +
        _channel(c[2]) + ", " + a.toFixed(2) + ")";
}

/**
 * rgbaToKey:
 * @rgba (array): [r, g, b, a] with a in 0..1
 *
 * Returns (string): "#rrggbbaa" (lowercase) — a canonical key for change
 * detection, so a colour that round-trips identically does not trigger a
 * restyle.
 */
function rgbaToKey(rgba) {
    let c = Array.isArray(rgba) ? rgba : FALLBACK_COLOR;
    let a = Number(c[3]);
    if (!Number.isFinite(a))
        a = 1;
    a = Math.round(Math.max(0, Math.min(1, a)) * 255);
    return "#" + _hex2(_channel(c[0])) + _hex2(_channel(c[1])) +
        _hex2(_channel(c[2])) + _hex2(a);
}

/* ------------------------------------------------------------------ *
 * Schedule normalisation
 * ------------------------------------------------------------------ */

/**
 * _rowSeconds:
 *
 * Reads the position in seconds from a raw settings row. Rows use the
 * settings-schema list column ids: clock rows store hour/minute, timer
 * rows store remaining, chronometer rows store elapsed. A bare t key is
 * accepted for hand-built schedules.
 *
 * Returns (number): the row time, or NaN when none applies.
 */
function _rowSeconds(row) {
    if (!row || typeof row !== "object")
        return NaN;
    if (row.hour !== undefined || row.minute !== undefined) {
        let h = parseInt(row.hour, 10);
        let m = parseInt(row.minute, 10);
        return (Number.isFinite(h) ? h : 0) * 3600 +
            (Number.isFinite(m) ? m : 0) * 60;
    }
    if (row.remaining !== undefined)
        return parseInt(row.remaining, 10);
    if (row.elapsed !== undefined)
        return parseInt(row.elapsed, 10);
    return parseInt(row.t, 10);
}

/**
 * normalizeSchedule:
 * @rows (array): raw schedule rows; non-arrays yield an empty schedule
 * @maxT (number): upper clamp for the row time (DAY_SECONDS for clocks)
 *
 * Parses each row time, clamps it into [0, @maxT], drops rows whose colour
 * does not parse (counting them), sorts ascending and, when two rows share
 * a time, keeps the later row.
 *
 * Returns (object): { stops: [{t, rgba}], dropped }.
 */
function normalizeSchedule(rows, maxT) {
    if (!Array.isArray(rows))
        return { stops: [], dropped: 0 };

    let limit = Number.isFinite(maxT) && maxT >= 0 ? maxT : Infinity;
    let tagged = [];
    let dropped = 0;

    for (let i = 0; i < rows.length; i++) {
        let t = _rowSeconds(rows[i]);
        if (!Number.isFinite(t)) {
            dropped++;
            continue;
        }
        let parsed = parseColor(rows[i] && rows[i].color);
        if (!parsed.ok) {
            dropped++;
            continue;
        }
        tagged.push({
            t: Math.max(0, Math.min(limit, Math.round(t))),
            rgba: parsed.rgba,
            i: i
        });
    }

    /* Sort by time, then input order, so equal times keep the later row
     * regardless of engine sort stability. */
    tagged.sort(function (a, b) {
        return a.t - b.t || a.i - b.i;
    });

    let stops = [];
    for (let i = 0; i < tagged.length; i++) {
        if (i + 1 < tagged.length && tagged[i + 1].t === tagged[i].t)
            continue; /* equal time: the later row wins */
        stops.push({ t: tagged[i].t, rgba: tagged[i].rgba });
    }

    return { stops: stops, dropped: dropped };
}

/* ------------------------------------------------------------------ *
 * Schedule evaluation
 * ------------------------------------------------------------------ */

/**
 * evaluate:
 * @stops (array): normalised stops [{t, rgba}], sorted by t ascending
 * @t (number): query position in seconds
 * @opts (object): { wrap, smooth }. wrap treats the schedule as circular
 *   over one day (clocks); smooth interpolates per channel including
 *   alpha, otherwise each stop's colour holds until the next stop and
 *   jumps there.
 *
 * Outside the first/last stop the nearer stop holds (non-wrap); in wrap
 * mode the schedule always ramps across midnight. A query exactly at a
 * stop returns that stop's colour in both modes.
 *
 * Returns (array): a fresh [r, g, b, a], or null when there are no stops.
 */
function evaluate(stops, t, opts) {
    opts = opts || {};

    let list = [];
    if (Array.isArray(stops)) {
        for (let i = 0; i < stops.length; i++) {
            let s = stops[i];
            if (s && Number.isFinite(s.t) && Array.isArray(s.rgba))
                list.push({ t: s.t, rgba: s.rgba });
        }
    }
    if (list.length === 0)
        return null;
    list.sort(function (a, b) { return a.t - b.t; });

    let q = Number(t);
    if (!Number.isFinite(q))
        q = 0;
    if (opts.wrap)
        q = ((q % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;

    if (list.length === 1)
        return list[0].rgba.slice();

    /* Index of the newest stop at or before q; -1 when q precedes the
     * first stop (in wrap mode that segment wraps back to the last). */
    let idx = -1;
    for (let i = 0; i < list.length; i++) {
        if (list[i].t <= q)
            idx = i;
        else
            break;
    }

    let from, to, fromT, toT;
    if (idx === -1) {
        if (!opts.wrap)
            return list[0].rgba.slice();
        from = list[list.length - 1];
        to = list[0];
        fromT = from.t - DAY_SECONDS;
        toT = to.t;
    } else if (idx === list.length - 1) {
        if (!opts.wrap)
            return list[idx].rgba.slice();
        from = list[idx];
        to = list[0];
        fromT = from.t;
        toT = to.t + DAY_SECONDS;
    } else {
        from = list[idx];
        to = list[idx + 1];
        fromT = from.t;
        toT = to.t;
    }

    if (!opts.smooth)
        return from.rgba.slice();

    let span = toT - fromT;
    if (!(span > 0))
        return from.rgba.slice();
    let frac = (q - fromT) / span;
    frac = Math.max(0, Math.min(1, frac));
    return lerpRgba(from.rgba, to.rgba, frac);
}

/**
 * lerpRgba:
 * @c1 (array): [r, g, b, a] start colour
 * @c2 (array): [r, g, b, a] end colour
 * @f (number): fraction in [0, 1]
 *
 * Returns (array): per-channel interpolation; channels are rounded to
 * ints, the alpha stays continuous.
 */
function lerpRgba(c1, c2, f) {
    let x = Array.isArray(c1) ? c1 : FALLBACK_COLOR;
    let y = Array.isArray(c2) ? c2 : FALLBACK_COLOR;
    let k = Number(f);
    if (!Number.isFinite(k))
        k = 0;
    k = Math.max(0, Math.min(1, k));
    return [
        Math.round(x[0] + (y[0] - x[0]) * k),
        Math.round(x[1] + (y[1] - x[1]) * k),
        Math.round(x[2] + (y[2] - x[2]) * k),
        x[3] + (y[3] - x[3]) * k
    ];
}

/* ------------------------------------------------------------------ *
 * Readability
 * ------------------------------------------------------------------ */

/**
 * luma:
 * @rgba (array): [r, g, b, a] card background colour
 *
 * Returns (number): perceived brightness in 0..1. Translucent colours
 * (alpha byte < 200) are first composited over the dark card backing,
 * because that is what the eye actually sees.
 */
function luma(rgba) {
    let c = Array.isArray(rgba) ? rgba : FALLBACK_COLOR;
    let a = Number(c[3]);
    if (!Number.isFinite(a))
        a = 1;
    a = Math.max(0, Math.min(1, a));
    let r = _channel(c[0]), g = _channel(c[1]), b = _channel(c[2]);
    if (a * 255 < 200) {
        r = r * a + LUMA_BACKING[0] * (1 - a);
        g = g * a + LUMA_BACKING[1] * (1 - a);
        b = b * a + LUMA_BACKING[2] * (1 - a);
    }
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/* fg is chosen by real WCAG contrast ratio, not a luma threshold: on
 * mid-tone schedules (green #43a047, teal #00897b) white text measures
 * 3.3:1 / 4.3:1 and must lose to the dark candidate. */
var FG_WHITE = [255, 255, 255, 0.95];
var FG_DARK = [17, 17, 17, 0.92];
var AA_RATIO = 4.5;

function _compositeOver(fg, bg) {
    let a = Math.max(0, Math.min(1, Number(fg[3]) || 0));
    return [
        fg[0] * a + bg[0] * (1 - a),
        fg[1] * a + bg[1] * (1 - a),
        fg[2] * a + bg[2] * (1 - a)
    ];
}

/* The colour the eye sees: translucent schedules composited over the dark
 * card backing, same rule as luma(). */
function _effectiveBg(rgba) {
    let c = Array.isArray(rgba) ? rgba : FALLBACK_COLOR;
    let a = Number(c[3]);
    if (!Number.isFinite(a))
        a = 1;
    a = Math.max(0, Math.min(1, a));
    let base = [_channel(c[0]), _channel(c[1]), _channel(c[2])];
    if (a * 255 < 200)
        return _compositeOver([base[0], base[1], base[2], a], LUMA_BACKING);
    return base;
}

/* WCAG 2.x relative luminance of an opaque [r, g, b]. */
function _relLuma(rgb) {
    function lin(v) {
        v = v / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

function _contrastRatio(l1, l2) {
    let hi = Math.max(l1, l2);
    let lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
}

/**
 * contrastColors:
 * @rgba (array): [r, g, b, a] card background colour
 *
 * Returns (object): { fg, border }. fg is whichever of the softened
 * white/near-black candidates measures the higher WCAG contrast ratio
 * against the background as actually composited; when mid-tone colours
 * leave both below AA (4.5:1) the solid extreme wins instead. border
 * reuses the background hue at low alpha so card edges read on any colour.
 */
function contrastColors(rgba) {
    let c = Array.isArray(rgba) ? rgba : FALLBACK_COLOR;
    let bg = _effectiveBg(c);
    let bgL = _relLuma(bg);
    let rWhite = _contrastRatio(bgL, _relLuma(_compositeOver(FG_WHITE, bg)));
    let rDark = _contrastRatio(bgL, _relLuma(_compositeOver(FG_DARK, bg)));
    let fg = rDark > rWhite ? FG_DARK : FG_WHITE;
    if (Math.max(rWhite, rDark) < AA_RATIO) {
        /* AA rescue: mid tones (e.g. teal) fail 4.5:1 with either softened
         * candidate; fall back to whichever solid extreme reads better. */
        let rSolidB = _contrastRatio(bgL, 0);
        let rSolidW = _contrastRatio(bgL, 1);
        fg = rSolidB > rSolidW ? [0, 0, 0, 1] : [255, 255, 255, 1];
    }
    return {
        fg: fg,
        border: [_channel(c[0]), _channel(c[1]), _channel(c[2]), 0.3]
    };
}

/* ------------------------------------------------------------------ *
 * Default schedules (must match the settings-schema list column ids)
 * ------------------------------------------------------------------ */

var DEFAULT_CLOCK_SCHEDULE = [
    { hour: 6, minute: 0, color: "#f4433c" },
    { hour: 12, minute: 0, color: "#9c27b0" },
    { hour: 18, minute: 0, color: "#3949ab" }
];

var DEFAULT_TIMER_SCHEDULE = [
    { remaining: 60, color: "#43a047" },
    { remaining: 30, color: "#fdd835" },
    { remaining: 0, color: "#e53935" }
];

var DEFAULT_CHRONO_SCHEDULE = [
    { elapsed: 0, color: "#00897b" },
    { elapsed: 1800, color: "#f4511e" }
];

/* ------------------------------------------------------------------ *
 * Card text fitting (copied from clockActions.js, tile renamed to card)
 * ------------------------------------------------------------------ */

/**
 * Chrome subtracted when turning desklet width/height into a card's inner
 * text box. Keep in sync with stylesheet.css
 * (.ctc-container padding, card padding/border).
 */
var CARD_LAYOUT = {
    containerPad: 4,
    tileBorder: 2,
    padX: 6,
    padY: 4,
    lineGap: 2,
    minPt: 4,
    ptToPx: 4 / 3,
    lineHeight: 1.25,
    /* Digits+colons average nearer 0.55em than 0.72em; the per-card metric
     * refine in desklet.js shrinks any estimate that proves too bold. */
    timeEm: 0.62,
    dateEm: 0.58,
    labelEm: 0.56,
    addMaxPt: 16,
    /* A card cannot shrink below its control pill; fitKinds() hides cards
     * rather than let the grid overflow the container below this. */
    minCardWidth: 120
};

/**
 * fitKinds:
 * @kinds (array): visible card kinds from the settings checkboxes, in
 *   build order (clock, timer, chrono)
 * @width (number): desklet width setting (px)
 * @spacing (number): card spacing setting (px, used as per-card margin)
 *
 * Returns (array): the kinds that fit. Cards drop from the end - the
 * chronometer first, then the timer - because the clock is the anchor;
 * one card always survives so the desklet never renders empty. Widening
 * restores the hidden cards on the next rebuild; the settings checkboxes
 * remain the source of truth.
 */
function fitKinds(kinds, width, spacing) {
    let list = Array.isArray(kinds) ? kinds.slice() : [];
    let w = Number(width);
    if (!Number.isFinite(w) || w <= 0)
        w = 840;
    let gap = Number(spacing);
    if (!Number.isFinite(gap) || gap < 0)
        gap = 0;
    const min = CARD_LAYOUT.minCardWidth + 2 * gap;
    while (list.length > 1 &&
        list.length * min + 2 * CARD_LAYOUT.containerPad > w)
        list.pop();
    return list;
}

function _toPositiveInt(value, fallback) {
    let n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < 1)
        return fallback;
    return n;
}

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
 * computeCardInnerSize:
 * @deskletWidth (number): main container width in px
 * @deskletHeight (number): main container height in px
 * @rows (int): grid rows
 * @cols (int): grid columns
 * @cardSpacing (number): per-side card margin in px
 * @opts (object): optional overrides for CARD_LAYOUT chrome
 *
 * Returns (object): { width, height } of the text box inside one card.
 */
function computeCardInnerSize(deskletWidth, deskletHeight, rows, cols, cardSpacing, opts) {
    opts = opts || {};
    let pad = CARD_LAYOUT.containerPad;
    if (opts.containerPad != null)
        pad = Math.max(0, _finite(opts.containerPad, pad));
    let border = CARD_LAYOUT.tileBorder;
    if (opts.tileBorder != null)
        border = Math.max(0, _finite(opts.tileBorder, border));
    let padX = CARD_LAYOUT.padX;
    if (opts.padX != null)
        padX = Math.max(0, _finite(opts.padX, padX));
    let padY = CARD_LAYOUT.padY;
    if (opts.padY != null)
        padY = Math.max(0, _finite(opts.padY, padY));

    let r = _toPositiveInt(rows, 1);
    let c = _toPositiveInt(cols, 1);
    let spacing = Math.max(0, _finite(cardSpacing, 0));
    let tableW = Math.max(0, _finite(deskletWidth, 200) - 2 * pad);
    let tableH = Math.max(0, _finite(deskletHeight, 200) - 2 * pad);
    let cellW = tableW / c;
    let cellH = tableH / r;

    return {
        width: Math.max(0, cellW - 2 * spacing - 2 * border - 2 * padX),
        height: Math.max(0, cellH - 2 * spacing - 2 * border - 2 * padY)
    };
}

function _textWidthPx(text, sizePt, ptToPx, em) {
    let n = String(text || "").length;
    if (n === 0)
        return 0;
    return n * sizePt * ptToPx * em;
}

function _maxPtForWidth(text, innerW, ptToPx, em, cap) {
    let n = String(text || "").length;
    if (n === 0)
        return cap;
    if (!(innerW > 0) || !(ptToPx > 0) || !(em > 0))
        return 1;
    let pt = innerW / (n * ptToPx * em);
    if (!Number.isFinite(pt) || pt <= 0)
        return 1;
    return Math.min(cap, pt);
}

/**
 * computeFittedFontSizes:
 * @innerWidth (number): card text box width in px
 * @innerHeight (number): card text box height in px
 * @texts (object): { time, date, label } sample strings
 * @maxSizes (object): { time, date, timezone } caps in pt
 * @opts (object): optional CARD_LAYOUT overrides
 *
 * Settings sizes are caps. Time and date shrink to fit; a long label
 * ellipsizes instead of shrinking the card. Hierarchy is
 * time >= date >= timezone.
 *
 * Returns (object): { time, date, timezone, add, ellipsizeLabel }
 */
function computeFittedFontSizes(innerWidth, innerHeight, texts, maxSizes, opts) {
    opts = opts || {};
    texts = texts || {};
    maxSizes = maxSizes || {};

    let ptToPx = _finite(opts.ptToPx, CARD_LAYOUT.ptToPx);
    if (!(ptToPx > 0))
        ptToPx = CARD_LAYOUT.ptToPx;
    let lineHeight = _finite(opts.lineHeight, CARD_LAYOUT.lineHeight);
    if (!(lineHeight > 0))
        lineHeight = CARD_LAYOUT.lineHeight;
    let lineGap = Math.max(0, _finite(opts.lineGap, CARD_LAYOUT.lineGap));
    let timeEm = _finite(opts.timeEm, CARD_LAYOUT.timeEm);
    let dateEm = _finite(opts.dateEm, CARD_LAYOUT.dateEm);
    let labelEm = _finite(opts.labelEm, CARD_LAYOUT.labelEm);
    let addMax = _finite(opts.addMaxPt, CARD_LAYOUT.addMaxPt);

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
