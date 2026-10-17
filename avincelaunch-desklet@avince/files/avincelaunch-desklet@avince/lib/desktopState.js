// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

// Schritt 4, V3a (B6/E4, Befunde P65, T5, T6, P38) - "Schreibtisch frei"
// ohne org.Cinnamon.Eval.
//
// 1. Markierung: Liegt die Datei
//      $XDG_STATE_HOME/avincelaunch/schreibtisch-frei   (meist ~/.local/state)
//    vor, sind ALLE Fences ausgeblendet. Die Helfer (desktop-clean-toggle,
//    Super+Umschalt+D, Doppelklick) schalten nur diese Datei und die
//    Nemo-Symbole um; das Desklet beobachtet sie (EIN Ordnerwaechter fuer alle
//    Fences, wie config.json in lib/config.js). Entscheidung Angelo 13.10.
//    (F1): der Zustand gilt dauerhaft - auch nach Alt+F2 r und nach neuer
//    Anmeldung, bis zum naechsten Umschalten. Inhalt der Datei egal.
//
// 2. Flaechen: Jeder Fence meldet die Flaeche, die Klicks annimmt (sein
//    Akteur, Buehnen- = Bildschirmpixel), nach
//      $XDG_RUNTIME_DIR/avincelaunch/fences.json
//    Der Doppelklick-Helfer sperrt dort (auch bei automatischer Groesse,
//    eingeklappt und Skalierung 2 richtig - P38). Laufzeitordner: gilt nur
//    fuer diese Sitzung; geschrieben gesammelt und atomar.

const MARKER_NAME = "schreibtisch-frei";
const RECTS_NAME = "fences.json";

let _stateDirForTests = null;
let _runtimeDirForTests = null;

function _setDirsForTests(stateDir, runtimeDir) {
    _stateDirForTests = stateDir || null;
    _runtimeDirForTests = runtimeDir || null;
}

function stateDir() {
    return _stateDirForTests
        || GLib.build_filenamev([GLib.get_user_state_dir(), "avincelaunch"]);
}

function markerPath() {
    return GLib.build_filenamev([stateDir(), MARKER_NAME]);
}

function rectsPath() {
    const runtime = _runtimeDirForTests
        || GLib.build_filenamev([GLib.get_user_runtime_dir(), "avincelaunch"]);
    return GLib.build_filenamev([runtime, RECTS_NAME]);
}

function isDesktopFree() {
    return GLib.file_test(markerPath(), GLib.FileTest.EXISTS);
}

function _logError(e, message) {
    if (typeof global !== "undefined" && global.logError) {
        global.logError(e, message);
    }
}

// --- Markierung beobachten ----------------------------------------------------
const _listeners = new Map();
let _monitor = null;
let _monitorSignal = 0;
let _debounceId = 0;
let _lastFree = null;

function _notifyListeners() {
    _debounceId = 0;
    const free = isDesktopFree();
    if (free === _lastFree) {
        return GLib.SOURCE_REMOVE;
    }
    _lastFree = free;
    for (const callback of Array.from(_listeners.values())) {
        try {
            callback(free);
        } catch (e) {
            _logError(e, "aVinceLaunch: desktop state listener failed");
        }
    }
    return GLib.SOURCE_REMOVE;
}

function _onStateDirChanged(monitor, file, otherFile) {
    const names = [file, otherFile].filter(Boolean).map(f => f.get_basename());
    if (names.indexOf(MARKER_NAME) === -1) {
        return;
    }
    if (_debounceId) {
        GLib.source_remove(_debounceId);
    }
    _debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, _notifyListeners);
}

function _startMonitor() {
    if (_monitor) {
        return;
    }
    try {
        GLib.mkdir_with_parents(stateDir(), 0o755);
        _monitor = Gio.File.new_for_path(stateDir()).monitor_directory(
            Gio.FileMonitorFlags.WATCH_MOVES, null);
        _monitorSignal = _monitor.connect("changed", _onStateDirChanged);
    } catch (e) {
        _monitor = null;
        _logError(e, "aVinceLaunch: cannot watch the desktop state");
    }
}

function _stopMonitor() {
    if (_debounceId) {
        GLib.source_remove(_debounceId);
        _debounceId = 0;
    }
    if (_monitor) {
        if (_monitorSignal) {
            _monitor.disconnect(_monitorSignal);
        }
        _monitor.cancel();
    }
    _monitor = null;
    _monitorSignal = 0;
}

// owner: das Desklet-Objekt; callback(free) bei jeder echten Aenderung.
// Liefert den aktuellen Zustand (zum sofortigen Anwenden).
function watchDesktopFree(owner, callback) {
    _listeners.set(owner, callback);
    _lastFree = isDesktopFree();
    _startMonitor();
    return _lastFree;
}

function unwatchDesktopFree(owner) {
    _listeners.delete(owner);
    if (_listeners.size === 0) {
        _stopMonitor();
    }
}

// --- Flaechen fuer den Doppelklick ------------------------------------------
const _rects = new Map();
let _writeId = 0;

function _writeRects() {
    _writeId = 0;
    const fences = {};
    Array.from(_rects.keys()).sort().forEach(id => {
        fences[id] = _rects.get(id);
    });
    const path = rectsPath();
    const text = JSON.stringify({ version: 1, fences: fences }, null, 1) + "\n";
    try {
        GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
        // Atomar: der Doppelklick liest nie eine halbe Datei.
        const tmp = path + ".tmp";
        GLib.file_set_contents(tmp, text);
        Gio.File.new_for_path(tmp).move(Gio.File.new_for_path(path),
            Gio.FileCopyFlags.OVERWRITE, null, null);
    } catch (e) {
        _logError(e, "aVinceLaunch: cannot write " + path);
    }
    return GLib.SOURCE_REMOVE;
}

// rect: { x, y, w, h, visible } oder null (Fence weg).
function publishFenceRect(instanceId, rect) {
    const key = String(instanceId);
    const before = _rects.has(key) ? JSON.stringify(_rects.get(key)) : null;
    if (rect) {
        _rects.set(key, {
            x: Math.round(rect.x), y: Math.round(rect.y),
            w: Math.round(rect.w), h: Math.round(rect.h),
            visible: !!rect.visible
        });
    } else {
        _rects.delete(key);
    }
    const after = _rects.has(key) ? JSON.stringify(_rects.get(key)) : null;
    if (before === after) {
        return;
    }
    if (_writeId) {
        GLib.source_remove(_writeId);
    }
    _writeId = GLib.timeout_add(GLib.PRIORITY_LOW, 300, _writeRects);
}

// Fuer Tests: sofort schreiben.
function _flushForTests() {
    if (_writeId) {
        GLib.source_remove(_writeId);
        _writeRects();
    }
}
