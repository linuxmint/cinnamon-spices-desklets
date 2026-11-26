// Small Cairo charts for the tiles (line with area fill, bars). No Cinnamon imports.
// All functions draw into a Cairo context of size w x h.

const Cairo = imports.cairo;

const AXIS_COLOR = [0.596, 0.639, 0.678, 1];    // #98a3ad
const GRID_COLOR = [1, 1, 1, 0.07];
const FONT_SIZE = 9;
const AXIS_LEFT = 30;      // px reserved for value labels when axis = true
const AXIS_RIGHT = 26;     // px reserved for a second value axis (right side)
const AXIS_BOTTOM = 13;    // px reserved for time labels when axis = true

function rgba(hex, alpha) {
    let n = parseInt(hex.replace("#", ""), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, alpha === undefined ? 1 : alpha];
}

// Round up to 1, 2 or 5 × 10^n for readable axis maxima.
function niceMax(v) {
    if (!(v > 0))
        return 1;
    let p = Math.pow(10, Math.floor(Math.log10(v)));
    let m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

// axis: value labels left and time labels below; right: room for a second axis.
function plotArea(w, h, axis, right) {
    let r = axis && right ? AXIS_RIGHT : 3;
    return axis
        ? { x: AXIS_LEFT, y: 3, w: w - AXIS_LEFT - r, h: h - AXIS_BOTTOM - 3 }
        : { x: 4, y: 4, w: w - 8, h: h - 5 };
}

// Faint frame and background of a mini graph, so stacked graphs stay apart.
function drawFrame(cr, w, h) {
    cr.rectangle(0.5, 0.5, w - 1, h - 1);
    cr.setSourceRGBA(1, 1, 1, 0.03);
    cr.fillPreserve();
    cr.setSourceRGBA(1, 1, 1, 0.10);
    cr.setLineWidth(1);
    cr.stroke();
}

// Cairo's toy text API: keep labels to plain characters (no U+2212 minus, it shows as a box).
function text(cr, str, x, y, align) {
    cr.selectFontFace("Sans", Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
    cr.setFontSize(FONT_SIZE);
    let ext = cr.textExtents(str);
    let dx = align === "right" ? -ext.width : align === "center" ? -ext.width / 2 : 0;
    cr.moveTo(x + dx, y);
    cr.showText(str);
}

// side "right": only value labels on the right (second series), no grid, no time labels.
function drawAxis(cr, area, w, h, lo, hi, opt, side) {
    cr.setLineWidth(1);
    for (let t of [lo, (lo + hi) / 2, hi]) {
        let y = Math.round(area.y + (1 - (t - lo) / (hi - lo)) * area.h) + 0.5;
        if (side === "right") {
            cr.setSourceRGBA(...(opt.labelColor || AXIS_COLOR));
            text(cr, opt.fmt(t), area.x + area.w + 4, y + 3, "left");
            continue;
        }
        cr.setSourceRGBA(...GRID_COLOR);
        cr.moveTo(area.x, y);
        cr.lineTo(area.x + area.w, y);
        cr.stroke();
        cr.setSourceRGBA(...AXIS_COLOR);
        text(cr, opt.fmt(t), area.x - 4, y + 3, "right");
    }
    if (side !== "right" && opt.xLabels) {
        cr.setSourceRGBA(...AXIS_COLOR);
        let [left, mid, right] = opt.xLabels;
        text(cr, left, area.x, h - 2, "left");
        if (mid)
            text(cr, mid, area.x + area.w / 2, h - 2, "center");
        text(cr, right, area.x + area.w, h - 2, "right");
    }
}

// values oldest -> newest (null = gap).
// opt: { color, min, max, minSpan, axis, fmt, xLabels, ref, hover, fill (default true),
//        right (leave room for a second axis), side ("right" = this is the second series) }
function drawLine(cr, w, h, values, opt) {
    let area = plotArea(w, h, opt.axis, opt.right || opt.side === "right");
    let known = values.filter(v => v !== null);
    if (known.length < 2)
        return area;
    let lo = opt.min !== undefined ? opt.min : Math.min(...known);
    let hi = opt.max !== undefined ? opt.max : Math.max(...known);
    if (opt.ref !== undefined && opt.ref !== null) {
        lo = Math.min(lo, opt.ref);
        hi = Math.max(hi, opt.ref);
    }
    // minSpan: show at least this range (centered, whole numbers), so 1 °C of change
    // does not fill the whole graph.
    if (opt.minSpan && hi - lo < opt.minSpan) {
        let top = hi;
        lo = Math.floor((lo + hi) / 2 - opt.minSpan / 2);
        hi = Math.max(lo + opt.minSpan, Math.ceil(top));
    }
    if (opt.axis && lo === 0)
        hi = niceMax(hi * 1.05);   // readable maximum for value axes starting at 0
    if (hi - lo < 1e-6)
        hi = lo + 1;
    let n = values.length;
    let X = i => area.x + (n === 1 ? 0 : i / (n - 1)) * area.w;
    let Y = v => area.y + (1 - (v - lo) / (hi - lo)) * area.h;
    if (opt.axis)
        drawAxis(cr, area, w, h, lo, hi, Object.assign({ labelColor: rgba(opt.color, 0.9) }, opt), opt.side);

    let color = rgba(opt.color);
    // area fill, segment by segment between gaps
    let segments = [], current = [];
    values.forEach((v, i) => {
        if (v === null) {
            if (current.length)
                segments.push(current);
            current = [];
        } else {
            current.push(i);
        }
    });
    if (current.length)
        segments.push(current);
    let fill = new Cairo.LinearGradient(0, area.y, 0, area.y + area.h);
    fill.addColorStopRGBA(0, color[0], color[1], color[2], 0.40);
    fill.addColorStopRGBA(1, color[0], color[1], color[2], 0.03);
    for (let seg of segments) {
        if (seg.length < 2)
            continue;
        cr.moveTo(X(seg[0]), area.y + area.h);
        for (let i of seg)
            cr.lineTo(X(i), Y(values[i]));
        cr.lineTo(X(seg[seg.length - 1]), area.y + area.h);
        cr.closePath();
        if (opt.fill === false) {
            cr.newPath();
        } else {
            cr.setSource(fill);
            cr.fill();
        }
        cr.setSourceRGBA(...color);
        cr.setLineWidth(1.4);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        seg.forEach((i, k) => (k ? cr.lineTo(X(i), Y(values[i])) : cr.moveTo(X(i), Y(values[i]))));
        cr.stroke();
    }

    if (opt.ref !== undefined && opt.ref !== null) {
        cr.setSourceRGBA(1, 1, 1, 0.35);
        cr.setLineWidth(1);
        cr.setDash([3, 3], 0);
        cr.moveTo(area.x, Math.round(Y(opt.ref)) + 0.5);
        cr.lineTo(area.x + area.w, Math.round(Y(opt.ref)) + 0.5);
        cr.stroke();
        cr.setDash([], 0);
    }

    // end point, and the hovered point
    let last = values.length - 1;
    while (last >= 0 && values[last] === null)
        last--;
    let dot = (i, r, c) => {
        cr.setSourceRGBA(...c);
        cr.arc(X(i), Y(values[i]), r, 0, 2 * Math.PI);
        cr.fill();
    };
    if (last >= 0)
        dot(last, 2.6, color);
    if (opt.hover !== null && opt.hover !== undefined && values[opt.hover] !== null) {
        cr.setSourceRGBA(1, 1, 1, 0.25);
        cr.setLineWidth(1);
        cr.moveTo(Math.round(X(opt.hover)) + 0.5, area.y);
        cr.lineTo(Math.round(X(opt.hover)) + 0.5, area.y + area.h);
        cr.stroke();
        dot(opt.hover, 3.5, [1, 1, 1, 1]);
    }
    return area;
}

// values oldest -> newest. opt: { color, axis, fmt, xLabels, hover }
function drawBars(cr, w, h, values, opt) {
    let area = plotArea(w, h, opt.axis);
    let known = values.map(v => v || 0);
    let hi = niceMax(Math.max(...known, 0) * 1.05);
    if (opt.axis)
        drawAxis(cr, area, w, h, 0, hi, opt);
    let n = values.length || 1;
    let bw = area.w / n;
    let color = rgba(opt.color);
    known.forEach((v, i) => {
        let bh = (v / hi) * area.h;
        let alpha = i === opt.hover ? 1 : i === n - 1 ? 0.95 : 0.6;
        cr.setSourceRGBA(color[0], color[1], color[2], alpha);
        cr.rectangle(area.x + i * bw + bw * 0.18, area.y + area.h - bh, Math.max(1, bw * 0.64), bh);
        cr.fill();
    });
    return area;
}

// Index of the value under x for a chart drawn with the same w/h/axis/right.
function indexAt(x, w, h, n, axis, bars, right) {
    let area = plotArea(w, h, axis, right);
    if (n <= 0)
        return null;
    let rel = (x - area.x) / area.w;
    let i = bars ? Math.floor(rel * n) : Math.round(rel * (n - 1));
    return Math.max(0, Math.min(n - 1, i));
}
