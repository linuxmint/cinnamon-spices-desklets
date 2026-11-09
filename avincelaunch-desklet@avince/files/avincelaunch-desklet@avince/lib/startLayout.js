// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

// N17 - Startaufstellung: Plaetze fuer bis zu neun Fences im Raster 3 x 3.
//
// Rein rechnend (ohne Cinnamon), damit es sich offline pruefen laesst
// (tests/n17-raster-test.js). Gerechnet wird in logischen Punkten; der
// Aufrufer teilt Arbeitsflaechen und belegte Flaechen vorher durch die
// UI-Skalierung und nimmt die Lagen danach wieder mal.
//
// Regel (Bauplan N17, Abschnitt 3, Angelo 13.10. E2):
//   - Grundmass 360 x 210, Abstand mindestens 15 (waagrecht) bzw. 30
//     (senkrecht, N26: Platz fuer den schwebenden Namen ueber einem Fence
//     ohne Titelzeile), Lagen auf Cinnamons
//     25er-Raster, 50 Rand zur Arbeitsflaeche;
//   - zu wenig Platz: Breite und Hoehe getrennt kleiner, nie unter 240 x 140;
//     reicht die Hoehe fuer drei Zeilen nicht, weniger Zeilen und der Rest
//     auf den naechsten Bildschirm;
//   - belegte Flaeche (andere Fences, fremde Desklets) wird umgangen: der
//     Block wandert im 25er-Raster, bis er frei ist.

var BASE_W = 360;
var BASE_H = 210;
var MIN_W = 240;
var MIN_H = 140;
var MIN_GAP = 15;
var MIN_GAP_Y = 30;
var GRID = 25;
var MARGIN = 50;
var COLUMNS = 3;
var MAX_ROWS = 3;

function _step(size, gap) {
    return Math.ceil((size + gap) / GRID) * GRID;
}

function _snapUp(value, origin) {
    return origin + Math.ceil((value - origin) / GRID) * GRID;
}

// Groesste Kachel <= Grundmass, mit der n Kacheln samt Abstand in avail passen.
function _fit(avail, count, base, min, gap) {
    for (let size = base; size >= min; size -= 5) {
        if ((count - 1) * _step(size, gap) + size <= avail) {
            return size;
        }
    }
    return 0;
}

function _intersects(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// Erste freie Lage fuer einen Block, zeilenweise von oben links, im
// 25er-Raster; null = keine.
function _findFree(area, blockW, blockH, blockers) {
    const left = _snapUp(area.x + MARGIN, 0);
    const top = _snapUp(area.y + MARGIN, 0);
    const right = area.x + area.w - MARGIN - blockW;
    const bottom = area.y + area.h - MARGIN - blockH;
    for (let y = top; y <= bottom; y += GRID) {
        for (let x = left; x <= right; x += GRID) {
            const block = { x: x, y: y, w: blockW, h: blockH };
            if (!blockers.some(b => _intersects(block, b))) {
                return block;
            }
        }
    }
    return null;
}

// areas:    Arbeitsflaechen [{x, y, w, h}], Hauptbildschirm zuerst (logisch)
// occupied: belegte Flaechen [{x, y, w, h}] (logisch)
// count:    gewuenschte Zahl der Fences (1..9)
// Ergebnis: { cells: [{x, y, w, h, area}], missing } - cells in der Reihenfolge
//           des Rasters (zeilenweise), missing = Zahl ohne Platz.
function computeCells(areas, occupied, count) {
    const cells = [];
    let remaining = Math.max(0, Math.min(COLUMNS * MAX_ROWS, Math.round(count) || 0));
    const blockers = (occupied || []).map(o => ({
        x: o.x - MIN_GAP, y: o.y - MIN_GAP_Y, w: o.w + 2 * MIN_GAP, h: o.h + 2 * MIN_GAP_Y
    }));

    (areas || []).forEach((area, areaIndex) => {
        if (remaining <= 0 || !area || area.w <= 0 || area.h <= 0) {
            return;
        }
        const availW = area.w - 2 * MARGIN;
        const availH = area.h - 2 * MARGIN;
        const cols = Math.min(COLUMNS, remaining);
        const w = _fit(availW, cols, BASE_W, MIN_W, MIN_GAP);
        if (!w) {
            return;
        }
        // Erst so viele Zeilen wie noetig und so hoch wie moeglich; ist dafuer
        // nirgends frei (z. B. ein schon voller Schreibtisch), niedriger
        // (bis zum Mindestmass) und dann mit weniger Zeilen weitersuchen.
        let found = null;
        for (let rows = Math.min(MAX_ROWS, Math.ceil(remaining / COLUMNS)); rows > 0 && !found; rows--) {
            const count = Math.min(remaining, rows * cols);
            const usedRows = Math.ceil(count / cols);
            const blockW = (cols - 1) * _step(w, MIN_GAP) + w;
            const top = _fit(availH, usedRows, BASE_H, MIN_H, MIN_GAP_Y);
            for (let size = top; size >= MIN_H && top; size -= 5) {
                const origin = _findFree(area, blockW, (usedRows - 1) * _step(size, MIN_GAP_Y) + size, blockers);
                if (origin) {
                    found = { origin: origin, h: size, n: count };
                    break;
                }
            }
        }
        if (!found) {
            return;
        }
        const origin = found.origin;
        const h = found.h;
        const n = found.n;
        for (let i = 0; i < n; i++) {
            const cell = {
                x: origin.x + (i % cols) * _step(w, MIN_GAP),
                y: origin.y + Math.floor(i / cols) * _step(h, MIN_GAP_Y),
                w: w,
                h: h,
                area: areaIndex
            };
            cells.push(cell);
            blockers.push({ x: cell.x - MIN_GAP, y: cell.y - MIN_GAP_Y, w: w + 2 * MIN_GAP, h: h + 2 * MIN_GAP_Y });
        }
        remaining -= n;
    });

    return { cells: cells, missing: remaining };
}
