// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

const GLib = imports.gi.GLib;

// Pruefung Phase 2, A3 (P3, P4, P80): Eine unlesbare JSON-Datei ist NICHT
// dasselbe wie eine fehlende. Frueher lieferten layout.json und die
// Sidecar-Dateien bei einem Lesefehler leere Vorgaben, und der naechste
// Schreibvorgang ersetzte die Datei ohne Sicherung.
//
// Regel fuer alle Schreiber im Desklet:
//   - fehlt          -> Vorgaben, Schreiben erlaubt (neue Datei)
//   - in Ordnung     -> Inhalt
//   - kaputt         -> Datei bleibt liegen, eine Kopie entsteht als
//                       <Datei>.broken-<Zeit> (gleicher Inhalt nur einmal),
//                       einmal je Sitzung melden, NICHT darueberschreiben,
//                       bis die Datei repariert oder entfernt ist.

var STATE_MISSING = "missing";
var STATE_OK = "ok";
var STATE_BROKEN = "broken";

let _reporter = null;
const _reported = {};

// Meldung an den Nutzer (setzt desklet.js mit uebersetzten Texten).
// reporter(path, backupPath) - backupPath ist null, wenn keine Kopie
// moeglich war (z. B. keine Leserechte).
function setReporter(reporter) {
    _reporter = reporter;
}

function _log(message) {
    if (typeof global !== "undefined" && global.logError) {
        global.logError("aVinceLaunch: " + message);
    } else {
        printerr("aVinceLaunch: " + message);
    }
}

// Liefert { state, data, bytes }. data ist immer ein Objekt (kein Array),
// sonst gilt die Datei als kaputt.
function readJson(path) {
    let bytes = null;
    try {
        const [, contents] = GLib.file_get_contents(path);
        bytes = contents;
    } catch (e) {
        if (e && e.matches && e.matches(GLib.FileError, GLib.FileError.NOENT)) {
            return { state: STATE_MISSING, data: null, bytes: null };
        }
        return { state: STATE_BROKEN, data: null, bytes: null, error: String(e) };
    }
    try {
        // Pruefung Phase 3 Teil 2 (T14): ungueltiges UTF-8 ist kaputt - wie im
        // Dialog (safeJson.py) und in den Hilfsskripten. Bisher ersetzte der
        // TextDecoder die Bytes still, und Fence und Dialog werteten dieselbe
        // config.json verschieden.
        const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (data && typeof data === "object" && !Array.isArray(data)) {
            return { state: STATE_OK, data: data, bytes: bytes };
        }
        return { state: STATE_BROKEN, data: null, bytes: bytes, error: "kein JSON-Objekt" };
    } catch (e) {
        return { state: STATE_BROKEN, data: null, bytes: bytes, error: String(e) };
    }
}

function isBroken(path) {
    return readJson(path).state === STATE_BROKEN;
}

// Teil 2 (T13): Liegt neben path eine Kopie <Datei>.broken-<Zeit>? Dann war
// die Datei kaputt und wurde gesichert - fehlt sie jetzt, hat jemand sie
// entfernt, und es soll NICHT still eine aeltere Datei an ihre Stelle treten.
function hasBrokenCopy(path) {
    const dir = GLib.path_get_dirname(path);
    const prefix = GLib.path_get_basename(path) + ".broken-";
    let found = false;
    try {
        const handle = GLib.Dir.open(dir, 0);
        let name;
        while (!found && (name = handle.read_name()) !== null) {
            found = name.indexOf(prefix) === 0;
        }
        handle.close();
    } catch (e) {
        // Ordner nicht lesbar.
    }
    return found;
}

function _sameBytes(a, b) {
    if (!a || !b || a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

function _stamp() {
    return GLib.DateTime.new_now_local().format("%Y-%m-%d_%H-%M-%S");
}

// Vorhandene Kopie mit gleichem Inhalt suchen (auch aus frueheren Sitzungen).
function _findBackup(path, bytes) {
    const dir = GLib.path_get_dirname(path);
    const prefix = GLib.path_get_basename(path) + ".broken-";
    let found = null;
    try {
        const handle = GLib.Dir.open(dir, 0);
        let name;
        while (!found && (name = handle.read_name()) !== null) {
            if (name.indexOf(prefix) !== 0) {
                continue;
            }
            const candidate = GLib.build_filenamev([dir, name]);
            try {
                const [, other] = GLib.file_get_contents(candidate);
                if (_sameBytes(bytes, other)) {
                    found = candidate;
                }
            } catch (e) {
                // Nicht lesbar - weiter.
            }
        }
        handle.close();
    } catch (e) {
        // Ordner nicht lesbar - dann neue Kopie versuchen.
    }
    return found;
}

// Kaputte Datei sichern (einmal je Inhalt) und einmal je Sitzung melden.
// Liefert den Pfad der Kopie oder null.
function secureBroken(path, result) {
    const info = result || readJson(path);
    if (info.state !== STATE_BROKEN) {
        return null;
    }
    let backup = null;
    if (info.bytes) {
        backup = _findBackup(path, info.bytes);
        if (!backup) {
            const base = path + ".broken-" + _stamp();
            try {
                // Gleiche Sekunde, anderer Inhalt: laufende Nummer anhaengen.
                for (let n = 1; n < 100 && !backup; n++) {
                    const candidate = n === 1 ? base : base + "-" + n;
                    if (!GLib.file_test(candidate, GLib.FileTest.EXISTS)) {
                        GLib.file_set_contents(candidate, info.bytes);
                        backup = candidate;
                    }
                }
            } catch (e) {
                _log("Kopie von " + path + " nicht moeglich: " + e);
            }
        }
    }
    if (!_reported[path]) {
        _reported[path] = true;
        _log(path + " ist nicht lesbar (" + (info.error || "?") + "); bleibt unveraendert"
            + (backup ? ", Kopie: " + backup : "") + ". Keine Aenderungen, bis sie repariert ist.");
        if (_reporter) {
            try {
                _reporter(path, backup);
            } catch (e) {
                _log("Meldung fehlgeschlagen: " + e);
            }
        }
    }
    return backup;
}

// Schreiben nur, wenn die Datei fehlt oder lesbar ist. Ist sie kaputt,
// wird gesichert, gemeldet und false geliefert.
function mayWrite(path) {
    const info = readJson(path);
    if (info.state === STATE_BROKEN) {
        secureBroken(path, info);
        return false;
    }
    return true;
}

// Nur fuer die Offline-Tests.
function _resetForTests() {
    Object.keys(_reported).forEach(key => delete _reported[key]);
    _reporter = null;
}
