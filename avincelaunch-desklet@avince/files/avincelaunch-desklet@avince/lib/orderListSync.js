// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

// Liste im Dialog "Inhalte" gegen den Ordner abgleichen (AP18-1b, P6/P31;
// Pruefung Phase 3, N3). Ohne Cinnamon pruefbar: tests/p3-1-test.js.
//
// classifyOrderList(fresh, current, resolveId) vergleicht die frisch
// eingelesene Liste eines Ordners mit der gespeicherten Liste:
//   "same"   - gleiche Eintraege, gleiche Reihenfolge, gleiche Haken;
//   "clean"  - nur Eintraege dazugekommen oder weggefallen, die gemeinsamen
//              stehen gleich - keine offenen Aenderungen, darf ersetzt werden;
//   "dirty"  - Reihenfolge oder Haken weichen ab: offene Aenderungen, die
//              Liste bleibt stehen.
// Eine Liste ohne einen einzigen gemeinsamen Eintrag ist nur dann "clean",
// wenn sie wirklich zu diesem Ordner gehoert - das muss der Aufrufer
// sicherstellen (planDialogListSync).

function classifyOrderList(fresh, current, resolveId) {
    const ids = list => list.map(entry => String(resolveId(entry) || ""));
    const state = list => {
        const map = {};
        list.forEach(entry => {
            map[String(resolveId(entry) || "")] = entry.enabled !== false;
        });
        return map;
    };
    const freshIds = ids(fresh);
    const currentIds = ids(current);
    const freshState = state(fresh);
    const currentState = state(current);

    if (freshIds.join("\n") === currentIds.join("\n")
        && freshIds.every(id => freshState[id] === currentState[id])) {
        return "same";
    }
    const commonFresh = freshIds.filter(id => id in currentState);
    const commonCurrent = currentIds.filter(id => id in freshState);
    if (commonFresh.join("\n") === commonCurrent.join("\n")
        && commonFresh.every(id => freshState[id] === currentState[id])) {
        return "clean";
    }
    return "dirty";
}

// Was beim Abgleich zu tun ist. listPath = Ordner, zu dem die gespeicherte
// Liste gehoert (order-folder-path), scanPath = Ordner, den der Dialog zeigen
// soll (beim Oeffnen von "Einrichten" der Startordner). classify(path) liefert
// classifyOrderList fuer diesen Ordner oder null (nicht lesbar).
// Ergebnis: "keep" (nicht lesbar - nichts tun), "same" (Liste stimmt, Hinweis
// aus), "sync" (Liste aus scanPath neu), "stale" (Liste bleibt, Hinweis
// "Uebernehmen" anzeigen).
// N3: Gehoert die Liste zu einem anderen Ordner (Unterordner), wird sie
// zuerst gegen IHREN Ordner geprueft - sonst galt eine Unterordner-Liste
// ohne gemeinsamen Eintrag mit dem Startordner als "sauber" und offene
// Aenderungen gingen still verloren.
function planDialogListSync(listPath, scanPath, classify) {
    if (listPath && listPath !== scanPath) {
        const own = classify(listPath);
        if (own === null) {
            return "keep";
        }
        return own === "dirty" ? "stale" : "sync";
    }
    const kind = classify(scanPath);
    if (kind === null) {
        return "keep";
    }
    if (kind === "same") {
        return "same";
    }
    return kind === "clean" ? "sync" : "stale";
}
