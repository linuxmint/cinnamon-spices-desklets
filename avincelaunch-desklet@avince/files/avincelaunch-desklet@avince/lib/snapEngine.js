// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

// AP13b - Einrasten, Raender, Ueberlappungsschutz.
//
// Reine Geometrie ohne Cinnamon-Abhaengigkeit, damit sie sich ausserhalb von
// Cinnamon mit cjs pruefen laesst (tests/snap-engine-test.js).
//
// Rechtecke: { x, y, w, h } in Bildschirmkoordinaten, gemessen an der
// sichtbaren Flaeche des Fence. Hilfslinien: { x1, y1, x2, y2 }, immer
// waagrecht oder senkrecht.
//
// Reihenfolge der Regeln (Auftrag AP13b):
//   1. Nachbarn: Kanten buendig, gleiche Masse, Standardabstand
//   2. Raster:   nur wenn kein Nachbar in Fangweite liegt
//   3. Raender:  innerhalb der Arbeitsflaeche mit Randabstand
//   4. Ueberlappung: naechste freie Stelle, sonst zurueck

var DEFAULTS = {
    snapToFences: true,
    snapDistance: 12,
    gap: 15,
    screenMargin: 15,
    preventOverlap: true
};

function right(r) {
    return r.x + r.w;
}

function bottom(r) {
    return r.y + r.h;
}

function intersects(a, b) {
    return a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
}

// Ueberschneiden sich zwei Strecken (mit Toleranz)?
function spansMeet(a1, a2, b1, b2, tolerance) {
    return a1 < b2 + tolerance && b1 < a2 + tolerance;
}

function gridSnap(value, interval) {
    return interval > 0 ? Math.round(value / interval) * interval : Math.round(value);
}

function clamp(value, low, high) {
    if (high < low) {
        return low;
    }
    return Math.max(low, Math.min(high, value));
}

function vline(x, y1, y2) {
    return { x1: x, y1: Math.min(y1, y2), x2: x, y2: Math.max(y1, y2) };
}

function hline(y, x1, x2) {
    return { x1: Math.min(x1, x2), y1: y, x2: Math.max(x1, x2), y2: y };
}

function nearest(value, candidates, distance) {
    let best = null;
    for (const candidate of candidates) {
        const d = Math.abs(candidate.value - value);
        if (d <= distance && (!best || d < best.d)) {
            best = Object.assign({ d: d }, candidate);
        }
    }
    return best;
}

function mergeSettings(settings) {
    return Object.assign({}, DEFAULTS, settings || {});
}

// Gleiche Abstaende (Wunsch 01.10.): Abstaende, die zwischen den anderen
// Fences schon bestehen, werden zusaetzlich zum Standardabstand angeboten -
// waagrecht und senkrecht getrennt. So rastet ein Fence auf 15 px in der
// Reihe und auf 40 px in der Spalte ein, wenn die Anordnung so gebaut ist.
var MAX_KNOWN_GAP = 120;

function knownGaps(others, s, axis) {
    const horizontal = axis === "x";
    const gaps = [s.gap];
    const learned = horizontal ? s.gapX : s.gapY;
    if (typeof learned === "number" && learned > 0 && gaps.indexOf(learned) === -1) {
        gaps.push(learned);
    }
    for (const a of others) {
        for (const b of others) {
            if (a === b) {
                continue;
            }
            const sideBySide = horizontal
                ? spansMeet(a.y, bottom(a), b.y, bottom(b), 0)
                : spansMeet(a.x, right(a), b.x, right(b), 0);
            if (!sideBySide) {
                continue;
            }
            const gap = horizontal ? b.x - right(a) : b.y - bottom(a);
            if (gap > 0 && gap <= MAX_KNOWN_GAP && gaps.indexOf(gap) === -1) {
                gaps.push(gap);
            }
        }
    }
    return gaps;
}

// --- Verschieben -----------------------------------------------------------

function _moveCandidates(raw, others, s, axis) {
    const list = [];
    const horizontal = axis === "x";
    const pos = horizontal ? "x" : "y";
    const size = horizontal ? "w" : "h";
    const end = horizontal ? right : bottom;
    const crossStart = horizontal ? "y" : "x";
    const crossEnd = horizontal ? bottom : right;
    const gaps = knownGaps(others, s, axis);

    for (const o of others) {
        // Linie quer ueber beide Fences, an der gemeinsamen Kante.
        const along = (r, at) => horizontal
            ? vline(at, Math.min(r.y, o.y), Math.max(bottom(r), bottom(o)))
            : hline(at, Math.min(r.x, o.x), Math.max(right(r), right(o)));

        list.push({ value: o[pos], guide: r => along(r, o[pos]) });
        list.push({ value: end(o) - raw[size], guide: r => along(r, end(o)) });

        // Abstand nur zu Fences, die daneben liegen.
        if (spansMeet(raw[crossStart], crossEnd(raw), o[crossStart], crossEnd(o), s.snapDistance)) {
            // Abstand: beide zugewandten Kanten ueber die gemeinsame Strecke,
            // dazu ein Steg dazwischen - allein war der Steg schwer zu deuten.
            const bridge = (r, from, to) => {
                const lo = Math.max(r[crossStart], o[crossStart]);
                const hi = Math.min(crossEnd(r), crossEnd(o));
                const mid = Math.round((lo + hi) / 2);
                return horizontal
                    ? [hline(mid, from, to), vline(from, lo, hi), vline(to, lo, hi)]
                    : [vline(mid, from, to), hline(from, lo, hi), hline(to, lo, hi)];
            };
            for (const gap of gaps) {
                list.push({
                    value: end(o) + gap,
                    guide: r => bridge(r, end(o), end(o) + gap)
                });
                list.push({
                    value: o[pos] - gap - raw[size],
                    guide: r => bridge(r, o[pos] - gap, o[pos])
                });
            }
        }
    }
    return list;
}

function _screenCandidates(raw, area, s, axis) {
    if (!area) {
        return [];
    }
    // Randabstand: Kante des Fence und ein Steg bis zum Bildschirmrand.
    const midY = r => Math.round(r.y + r.h / 2);
    const midX = r => Math.round(r.x + r.w / 2);
    if (axis === "x") {
        const left = area.x + s.screenMargin;
        const rightEdge = right(area) - s.screenMargin;
        return [
            { value: left, guide: r => [vline(left, r.y, bottom(r)), hline(midY(r), area.x, left)] },
            { value: rightEdge - raw.w,
              guide: r => [vline(rightEdge, r.y, bottom(r)), hline(midY(r), rightEdge, right(area))] }
        ];
    }
    const top = area.y + s.screenMargin;
    const bottomEdge = bottom(area) - s.screenMargin;
    return [
        { value: top, guide: r => [hline(top, r.x, right(r)), vline(midX(r), area.y, top)] },
        { value: bottomEdge - raw.h,
          guide: r => [hline(bottomEdge, r.x, right(r)), vline(midX(r), bottomEdge, bottom(area))] }
    ];
}

function _clampToArea(rect, area, s) {
    if (!area) {
        return rect;
    }
    return {
        x: clamp(rect.x, area.x + s.screenMargin, right(area) - s.screenMargin - rect.w),
        y: clamp(rect.y, area.y + s.screenMargin, bottom(area) - s.screenMargin - rect.h),
        w: rect.w,
        h: rect.h
    };
}

// raw: Lage beim Ziehen. Liefert { rect, guides }.
function snapMove(raw, others, area, settings, gridInterval) {
    const s = mergeSettings(settings);
    const fenceCands = s.snapToFences ? others : [];

    const bestX = nearest(raw.x, _moveCandidates(raw, fenceCands, s, "x")
        .concat(_screenCandidates(raw, area, s, "x")), s.snapDistance);
    const bestY = nearest(raw.y, _moveCandidates(raw, fenceCands, s, "y")
        .concat(_screenCandidates(raw, area, s, "y")), s.snapDistance);

    let rect = {
        x: bestX ? bestX.value : gridSnap(raw.x, gridInterval),
        y: bestY ? bestY.value : gridSnap(raw.y, gridInterval),
        w: raw.w,
        h: raw.h
    };
    const unclamped = rect;
    rect = _clampToArea(rect, area, s);

    let guides = [];
    if (bestX && bestX.guide && rect.x === unclamped.x) {
        guides = guides.concat(bestX.guide(rect));
    }
    if (bestY && bestY.guide && rect.y === unclamped.y) {
        guides = guides.concat(bestY.guide(rect));
    }
    return { rect: rect, guides: guides };
}

// Liegt rect ueber einem anderen Fence, wird die naechste freie Stelle
// direkt neben einem der getroffenen Fences gesucht (mit Abstand). Erlaubt
// ist hoechstens eine halbe Fence-Groesse Versatz - sonst zurueck an den
// Ausgangspunkt. Liefert { rect, outcome: "free" | "moved" | "reverted" }.
function resolveOverlap(rect, others, area, settings, startRect) {
    const s = mergeSettings(settings);
    if (!s.preventOverlap) {
        return { rect: rect, outcome: "free" };
    }
    const hits = others.filter(o => intersects(rect, o));
    if (hits.length === 0) {
        return { rect: rect, outcome: "free" };
    }

    const candidates = [];
    for (const o of hits) {
        candidates.push({ x: right(o) + s.gap, y: rect.y });
        candidates.push({ x: o.x - s.gap - rect.w, y: rect.y });
        candidates.push({ x: rect.x, y: bottom(o) + s.gap });
        candidates.push({ x: rect.x, y: o.y - s.gap - rect.h });
    }

    const radius = Math.max(rect.w, rect.h) / 2;
    let best = null;
    for (const c of candidates) {
        const placed = { x: c.x, y: c.y, w: rect.w, h: rect.h };
        if (area) {
            const inside = _clampToArea(placed, area, s);
            if (inside.x !== placed.x || inside.y !== placed.y) {
                continue;
            }
        }
        if (others.some(o => intersects(placed, o))) {
            continue;
        }
        const d = Math.hypot(placed.x - rect.x, placed.y - rect.y);
        if (d <= radius && (!best || d < best.d)) {
            best = { d: d, rect: placed };
        }
    }

    if (best) {
        return { rect: best.rect, outcome: "moved" };
    }
    return { rect: Object.assign({}, startRect), outcome: "reverted" };
}

// AP18-5: freier Platz fuer ein Duplikat gleicher Groesse. Zuerst direkt
// neben dem Original (rechts, unten, links, oben - in dieser Reihenfolge),
// sonst die naechste Stelle neben einem anderen Fence/Hindernis (mit
// Abstand, buendig an dessen Kanten). Die Stelle muss ganz in der
// Arbeitsflaeche liegen und den Abstand zu allen halten. Kein Platz: null.
function findFreeSpot(origin, others, area, settings) {
    const s = mergeSettings(settings);
    const w = origin.w;
    const h = origin.h;
    const blockers = others.concat([origin]);
    // Gelernte Abstaende der Anordnung (layout.json gapX/gapY), sonst der
    // Standardabstand.
    const gx = typeof s.gapX === "number" && s.gapX > 0 ? s.gapX : s.gap;
    const gy = typeof s.gapY === "number" && s.gapY > 0 ? s.gapY : s.gap;
    // Abstand halten: Hindernisse um (Abstand - 1) aufblasen, genau der
    // Abstand ist erlaubt.
    const px = Math.max(0, gx - 1);
    const py = Math.max(0, gy - 1);
    const padded = blockers.map(o => ({ x: o.x - px, y: o.y - py, w: o.w + 2 * px, h: o.h + 2 * py }));

    const sidesOf = o => [
        { x: right(o) + gx, y: o.y },
        { x: o.x, y: bottom(o) + gy },
        { x: o.x - gx - w, y: o.y },
        { x: o.x, y: o.y - gy - h }
    ];

    const fits = c => {
        const placed = { x: c.x, y: c.y, w: w, h: h };
        if (area) {
            const inside = _clampToArea(placed, area, s);
            if (inside.x !== placed.x || inside.y !== placed.y) {
                return null;
            }
        }
        return padded.some(o => intersects(placed, o)) ? null : placed;
    };

    for (const c of sidesOf(origin)) {
        const placed = fits(c);
        if (placed) {
            return placed;
        }
    }

    let best = null;
    for (const o of others) {
        for (const c of sidesOf(o)) {
            const placed = fits(c);
            if (!placed) {
                continue;
            }
            const d = Math.hypot(placed.x - origin.x, placed.y - origin.y);
            if (!best || d < best.d) {
                best = { d: d, rect: placed };
            }
        }
    }
    return best ? best.rect : null;
}

// --- Groesse ---------------------------------------------------------------

// start: Fence beim Beginn des Ziehens. rawW/rawH: Groesse unter der Maus.
// Nur der rechte und der untere Rand bewegen sich. Nachbarn, die schon beim
// Beginn ueberlappen, begrenzen nichts - sonst liesse sich ein verkeilter
// Fence nicht mehr befreien. Liefert { w, h, guides }.
function snapResize(start, rawW, rawH, zone, others, area, settings, gridInterval, minSize) {
    const s = mergeSettings(settings);
    const free = others.filter(o => !intersects(start, o));
    const fenceCands = s.snapToFences ? free : [];
    const changeW = zone !== "bottom";
    const changeH = zone !== "right";
    const guides = [];
    const gapsX = knownGaps(fenceCands, s, "x");
    const gapsY = knownGaps(fenceCands, s, "y");

    let r = right(start);
    let b = bottom(start);
    const rawRight = start.x + rawW;
    const rawBottom = start.y + rawH;

    if (changeW) {
        const cands = [];
        for (const o of fenceCands) {
            cands.push({
                value: right(o),
                guide: f => vline(right(o), Math.min(f.y, o.y), Math.max(bottom(f), bottom(o)))
            });
            cands.push({
                value: start.x + o.w,
                guide: f => [hline(o.y, o.x, right(o)), hline(f.y, f.x, right(f))]
            });
            if (o.x >= right(start) - 1 && spansMeet(start.y, rawBottom, o.y, bottom(o), 0)) {
                for (const gap of gapsX) {
                    cands.push({
                        value: o.x - gap,
                        guide: f => {
                            const lo = Math.max(f.y, o.y);
                            const hi = Math.min(bottom(f), bottom(o));
                            return [hline(Math.round((lo + hi) / 2), o.x - gap, o.x),
                                vline(o.x - gap, lo, hi), vline(o.x, lo, hi)];
                        }
                    });
                }
            }
        }
        if (area) {
            cands.push({ value: right(area) - s.screenMargin });
        }
        const best = nearest(rawRight, cands, s.snapDistance);
        r = best ? best.value : gridSnap(rawRight, gridInterval);
        if (best && best.guide) {
            guides.push(best.guide);
        }
    }

    if (changeH) {
        const cands = [];
        for (const o of fenceCands) {
            cands.push({
                value: bottom(o),
                guide: f => hline(bottom(o), Math.min(f.x, o.x), Math.max(right(f), right(o)))
            });
            cands.push({
                value: start.y + o.h,
                guide: f => [vline(o.x, o.y, bottom(o)), vline(f.x, f.y, bottom(f))]
            });
            if (o.y >= bottom(start) - 1 && spansMeet(start.x, r, o.x, right(o), 0)) {
                for (const gap of gapsY) {
                    cands.push({
                        value: o.y - gap,
                        guide: f => {
                            const lo = Math.max(f.x, o.x);
                            const hi = Math.min(right(f), right(o));
                            return [vline(Math.round((lo + hi) / 2), o.y - gap, o.y),
                                hline(o.y - gap, lo, hi), hline(o.y, lo, hi)];
                        }
                    });
                }
            }
        }
        if (area) {
            cands.push({ value: bottom(area) - s.screenMargin });
        }
        const best = nearest(rawBottom, cands, s.snapDistance);
        b = best ? best.value : gridSnap(rawBottom, gridInterval);
        if (best && best.guide) {
            guides.push(best.guide);
        }
    }

    // Grenzen: Arbeitsflaeche und Nachbarn, auf die der Rand zuwaechst.
    let maxRight = area ? right(area) - s.screenMargin : Infinity;
    let maxBottom = area ? bottom(area) - s.screenMargin : Infinity;
    if (s.preventOverlap) {
        for (const o of free) {
            if (o.x >= right(start) - 1 && spansMeet(start.y, b, o.y, bottom(o), 0)) {
                maxRight = Math.min(maxRight, o.x - s.gap);
            }
            if (o.y >= bottom(start) - 1 && spansMeet(start.x, r, o.x, right(o), 0)) {
                maxBottom = Math.min(maxBottom, o.y - s.gap);
            }
        }
    }

    const w = Math.max(minSize, Math.min(r, maxRight) - start.x);
    const h = Math.max(minSize, Math.min(b, maxBottom) - start.y);
    const final = { x: start.x, y: start.y, w: w, h: h };

    // Hilfslinien nur, wenn der Treffer nicht durch eine Grenze verschoben wurde.
    const shown = [];
    for (const g of guides) {
        const lines = [].concat(g(final));
        shown.push.apply(shown, lines);
    }
    const kept = (r === right(final) || !changeW) && (b === bottom(final) || !changeH);
    return { w: w, h: h, guides: kept ? shown : [] };
}

// --- Alle Fences ausrichten (AP13c, Idee 3) -------------------------------

// Haeufigster Wert einer Liste; bei Gleichstand der kleinere.
function _mostCommon(values, fallback) {
    const counts = new Map();
    for (const v of values) {
        counts.set(v, (counts.get(v) || 0) + 1);
    }
    let best = fallback;
    let bestCount = 0;
    for (const [v, c] of counts) {
        if (c > bestCount || (c === bestCount && v < best)) {
            best = v;
            bestCount = c;
        }
    }
    return best;
}

// Fences eines Bildschirms in Reihen und Spalten ordnen, ohne Groessen zu
// aendern. Reihen ergeben sich aus der heutigen Lage (wer mit mindestens der
// halben Hoehe neben dem ersten Fence einer Reihe liegt, gehoert dazu); in
// der Reihe zaehlt die Reihenfolge von links nach rechts. Abstand je
// Richtung: der haeufigste heute bestehende, sonst der Standard. Die linke
// obere Ecke der Anordnung bleibt, wo sie ist (mindestens Randabstand).
//
// fences: [{ id, x, y, w, h }] - Liefert { id: { x, y } }.
function _rowsOf(fences) {
    const sorted = fences.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const f of sorted) {
        const row = rows.find(r => {
            const first = r[0];
            const overlap = Math.min(bottom(first), bottom(f)) - Math.max(first.y, f.y);
            return overlap >= Math.min(first.h, f.h) / 2;
        });
        if (row) {
            row.push(f);
        } else {
            rows.push([f]);
        }
    }
    rows.forEach(r => r.sort((a, b) => a.x - b.x));
    return rows;
}

// Haeufigster Abstand je Richtung in einer Anordnung. Taugt nur fuer eine
// saubere Anordnung - deshalb wird er einmalig gemerkt (layout.json
// settings.gapX/gapY) und nicht bei jedem Ausrichten neu gemessen: aus einer
// verrutschten Lage gemessen, schrumpfte 40 auf 18 px (Test 02.10.).
function measureGaps(fences, settings) {
    const s = mergeSettings(settings);
    const rows = _rowsOf(fences);
    const gapsX = [];
    for (const r of rows) {
        for (let i = 1; i < r.length; i++) {
            const g = r[i].x - right(r[i - 1]);
            if (g > 0 && g <= MAX_KNOWN_GAP) {
                gapsX.push(g);
            }
        }
    }
    const gapsY = [];
    for (let i = 1; i < rows.length; i++) {
        const prevBottom = Math.max.apply(null, rows[i - 1].map(bottom));
        const top = Math.min.apply(null, rows[i].map(f => f.y));
        const g = top - prevBottom;
        if (g > 0 && g <= MAX_KNOWN_GAP) {
            gapsY.push(g);
        }
    }
    return { gapX: _mostCommon(gapsX, s.gap), gapY: _mostCommon(gapsY, s.gap) };
}

// Alle Fences ausrichten - Mehrheitsentscheid.
//
// Reihen und Spalten ergeben sich aus der heutigen Lage. Ziellinie einer
// Reihe ist die haeufigste Oberkante ihrer Fences, Ziellinie einer Spalte
// die haeufigste linke Kante: Stehen zwei von drei Fences bei y = 50, ist 50
// die Linie und der eine Ausreisser wird korrigiert - nicht umgekehrt. (Die
// erste Fassung nahm den obersten Fence als Anker; war gerade der
// verschoben, folgten ihm alle, Test 02.10.)
// Danach rasten Reihen und Fences, die nahe am gemerkten Abstand liegen
// (halbe Fence-Groesse), genau darauf ein. Wuerde ein Fence etwas
// ueberdecken - einen anderen Fence oder ein fremdes Desklet -, bleibt er,
// wo er war. Es werden keine Reihen neu gebildet und nichts aufgefuellt.
//
// fences: [{ id, x, y, w, h }], obstacles: fremde Desklets (nie bewegt).
// Liefert { id: { x, y } }.

// Haeufigster Wert. Bei Gleichstand gewinnt ein Wert auf dem Raster
// (saubere Grundpositionen wie 50/300/550 liegen darauf, verrutschte nicht),
// danach der dem Median naechste.
function _majority(values, grid) {
    const counts = new Map();
    values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
    const sorted = values.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const onGrid = v => grid > 0 && v % grid === 0;
    const better = (v, c, best, bestCount) => {
        if (best === null || c > bestCount) {
            return true;
        }
        if (c < bestCount) {
            return false;
        }
        if (onGrid(v) !== onGrid(best)) {
            return onGrid(v);
        }
        return Math.abs(v - median) < Math.abs(best - median);
    };
    let best = null;
    let bestCount = 0;
    for (const [v, c] of counts) {
        if (better(v, c, best, bestCount)) {
            best = v;
            bestCount = c;
        }
    }
    return best;
}

// Spalten: Fences, deren linke Kanten weniger als die halbe Breite des
// schmaleren auseinanderliegen.
function _columnsOf(fences) {
    const sorted = fences.slice().sort((a, b) => a.x - b.x);
    const columns = [];
    for (const f of sorted) {
        const column = columns.find(c => Math.abs(c[0].x - f.x) < Math.min(c[0].w, f.w) / 2);
        if (column) {
            column.push(f);
        } else {
            columns.push([f]);
        }
    }
    return columns;
}

function alignFences(fences, area, settings, obstacles, gridInterval) {
    const s = mergeSettings(settings);
    const result = {};
    if (fences.length === 0) {
        return result;
    }
    const blockers = obstacles || [];
    const measured = measureGaps(fences, s);
    const gapX = typeof s.gapX === "number" && s.gapX > 0 ? s.gapX : measured.gapX;
    const gapY = typeof s.gapY === "number" && s.gapY > 0 ? s.gapY : measured.gapY;

    // Ziellinien per Mehrheit.
    const targetX = new Map();
    for (const column of _columnsOf(fences)) {
        const x = _majority(column.map(f => f.x), gridInterval || 25);
        column.forEach(f => targetX.set(f.id, x));
    }
    const rows = _rowsOf(fences);
    const rowTop = rows.map(r => _majority(r.map(f => f.y), gridInterval || 25));

    // Reihenabstand: liegt eine Reihe nahe am gemerkten Abstand zur
    // vorigen, rastet sie genau darauf ein.
    for (let i = 1; i < rows.length; i++) {
        const prevBottom = rowTop[i - 1] + Math.max.apply(null, rows[i - 1].map(f => f.h));
        const expected = prevBottom + gapY;
        const tolerance = Math.min.apply(null, rows[i].map(f => f.h)) / 2;
        if (Math.abs(rowTop[i] - expected) <= tolerance) {
            rowTop[i] = expected;
        }
    }

    // Erster Fence nahe am Bildschirmrand: Randabstand.
    const nearMargin = (value, edge) => area && Math.abs(value - edge) <= s.snapDistance;

    // Ziele je Fence; der Abstand in der Reihe richtet sich nach dem Ziel
    // des linken Nachbarn.
    const targets = [];
    rows.forEach((row, i) => {
        let previous = null;
        for (const f of row) {
            let x = targetX.get(f.id);
            if (previous) {
                const expected = right(previous) + gapX;
                if (Math.abs(x - expected) <= f.w / 2) {
                    x = expected;
                }
            } else if (nearMargin(x, area ? area.x + s.screenMargin : 0)) {
                x = area.x + s.screenMargin;
            }
            let y = rowTop[i];
            if (i === 0 && nearMargin(y, area ? area.y + s.screenMargin : 0)) {
                y = area.y + s.screenMargin;
            }
            const rect = _clampToArea({ x: x, y: y, w: f.w, h: f.h }, area, s);
            targets.push({ fence: f, rect: rect, shift: Math.hypot(rect.x - f.x, rect.y - f.y) });
            previous = rect;
        }
    });

    // Wer schon (fast) auf seiner Linie steht, bekommt seinen Platz zuerst -
    // sonst nimmt ein verrutschter Fence einem richtig stehenden den Platz.
    targets.sort((a, b) => a.shift - b.shift);
    const placed = [];
    for (const target of targets) {
        const f = target.fence;
        let rect = target.rect;
        if (placed.concat(blockers).some(p => intersects(rect, p))) {
            rect = { x: f.x, y: f.y, w: f.w, h: f.h };
        }
        placed.push(rect);
        result[f.id] = { x: rect.x, y: rect.y };
    }
    return result;
}
