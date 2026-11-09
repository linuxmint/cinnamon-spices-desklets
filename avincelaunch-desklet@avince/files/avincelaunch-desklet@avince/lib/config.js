// SPDX-License-Identifier: GPL-3.0-only AND MIT
// Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik
// Portions copyright (c) MHK924 (TheLauncher), MIT - see THIRD-PARTY-NOTICES.md

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

// Eigener Name seit aVinceLaunch. Der fruehere Name aus TheLauncher-Zeiten
// wird weiterhin GELESEN, damit bestehende Installationen nichts verlieren.
// Geschrieben wird config.json nur vom Einrichten-Dialog (bewusste Wahl des
// Basisordners, orderFolderEditor.save_shared_base_directory).
const APP_DIR_NAME = "avincelaunch";
const LEGACY_DIR_NAME = "thelauncher";

const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), APP_DIR_NAME]);
const CONFIG_FILE = GLib.build_filenamev([CONFIG_DIR, "config.json"]);
const LEGACY_CONFIG_FILE = GLib.build_filenamev([
    GLib.get_user_config_dir(),
    LEGACY_DIR_NAME,
    "config.json"
]);

function _safeJson() {
    return imports.desklets["avincelaunch-desklet@avince"].lib.safeJson;
}

function getDefaultBaseDirectory() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), APP_DIR_NAME]);
}

// Pruefung Phase 2, P11: EINE Regel fuer den Basisordner - gleich in
// orderFolderEditor.py, portalGuard.py und scripts/avincelaunch_rules.py:
//   - zuerst die eigene config.json, dann die aus TheLauncher-Zeiten;
//   - fehlt eine Datei oder ist sie kaputt, gilt die naechste (eine kaputte
//     wird gesichert und gemeldet, lib/safeJson.js);
//   - die erste lesbare entscheidet: "baseDirectory" mit "~" erweitert und
//     ohne Aufloesen von Verweisen; fehlt der Wert oder ist er kein
//     absoluter Pfad, gilt der Standardordner.
function normalizeBaseDirectory(value) {
    let text = typeof value === "string" ? value.trim() : "";
    if (text === "~" || text.indexOf("~/") === 0) {
        text = GLib.get_home_dir() + text.substring(1);
    }
    if (!text || text.charAt(0) !== "/") {
        return "";
    }
    let canonical = GLib.canonicalize_filename(text, null);
    while (canonical.length > 1 && canonical.endsWith("/")) {
        canonical = canonical.substring(0, canonical.length - 1);
    }
    return canonical;
}

function loadConfig() {
    const SafeJson = _safeJson();
    for (const path of [CONFIG_FILE, LEGACY_CONFIG_FILE]) {
        const info = SafeJson.readJson(path);
        if (info.state === SafeJson.STATE_MISSING) {
            continue;
        }
        if (info.state === SafeJson.STATE_BROKEN) {
            SafeJson.secureBroken(path, info);
            continue;
        }
        return {
            version: info.data.version || 1,
            baseDirectory: normalizeBaseDirectory(info.data.baseDirectory)
                || getDefaultBaseDirectory()
        };
    }
    return { version: 1, baseDirectory: getDefaultBaseDirectory() };
}

function getBaseDirectory() {
    return loadConfig().baseDirectory;
}

function getResolvedPath(subdirectory) {
    const base = getBaseDirectory();
    const sub = (subdirectory || "default").replace(/^\/+|\/+$/g, "");
    const parts = [base].concat(sub.split("/").filter(Boolean));
    return GLib.build_filenamev(parts);
}

// Legt Basis- und Gruppenordner an. config.json wird dabei NICHT geschrieben
// (P11: frueher konnte hier der Standardordner ueber eine kaputte Datei
// geschrieben werden).
function ensureLinkDirectory(subdirectory) {
    const base = getBaseDirectory();
    try {
        GLib.mkdir_with_parents(base, 0o755);
    } catch (e) {
        global.logError(e, "aVinceLaunch: failed to create base directory");
    }

    const resolved = getResolvedPath(subdirectory);
    try {
        GLib.mkdir_with_parents(resolved, 0o755);
    } catch (e) {
        global.logError(e, "aVinceLaunch: failed to create link directory");
    }

    return resolved;
}

// N13 (Neu-Nutzer-Pruefung am Tower, 12.10.): Fehlte der eigene Gruppenordner
// eines Fence, legte der Start nichts an (TheLauncher) - ein neuer Nutzer sah
// nur eine Meldung, "Verknuepfungsordner oeffnen" tat nichts. Jetzt legen Start
// und Menue ihn an, aber nur nach dieser Regel (Bauplan N13, E1/E2):
//   - der Ordner liegt innerhalb des Basisordners (kein "." oder ".." im
//     Unterordner) - sonst "ausserhalb";
//   - gibt es ihn schon: "da";
//   - gibt es den Basisordner: nur den Gruppenordner anlegen;
//   - fehlt der Basisordner und ist es der Standardordner: beide anlegen
//     (neuer Nutzer);
//   - fehlt ein EIGENER Basisordner (z. B. NAS nicht eingebunden): nichts
//     anlegen ("basis-fehlt") - sonst entstuende er auf der lokalen Platte.
// Liefert { state, path }; path nur bei "da" und "angelegt".
function ensureOwnLinkDirectory(subdirectory) {
    const raw = String(subdirectory || "default").replace(/^\/+|\/+$/g, "");
    const parts = raw.split("/").filter(Boolean);
    if (parts.length === 0 || parts.some(part => part === "." || part === "..")) {
        return { state: "ausserhalb", path: null };
    }

    const isDir = path => GLib.file_test(path, GLib.FileTest.IS_DIR);
    const path = getResolvedPath(raw);
    if (isDir(path)) {
        return { state: "da", path: path };
    }

    const base = GLib.canonicalize_filename(getBaseDirectory(), null);
    const standard = GLib.canonicalize_filename(getDefaultBaseDirectory(), null);
    if (!isDir(base) && base !== standard) {
        return { state: "basis-fehlt", path: null };
    }

    try {
        GLib.mkdir_with_parents(path, 0o755);
    } catch (e) {
        return { state: "fehler", path: null };
    }
    return isDir(path) ? { state: "angelegt", path: path } : { state: "fehler", path: null };
}

// --- config.json beobachten (Pruefung Phase 2, P33) -------------------------
// Wechselt der Basisordner im Dialog EINES Fence, erfuhren die anderen erst
// beim naechsten Neustart davon und zeigten bis dahin den alten Baum. Jetzt
// beobachtet EIN Ordnerwaechter (lokal, ~/.config/avincelaunch) die Datei fuer
// alle Fences; nach einer Aenderung (kurz gesammelt) erhaelt jeder
// angemeldete Fence den neuen Basisordner, wenn er sich wirklich geaendert
// hat. Der Dialog schreibt atomar (neue Datei + Umbenennen) - darum der
// Ordner und nicht die Datei.
const _listeners = new Map();
let _monitor = null;
let _monitorSignal = 0;
let _debounceId = 0;
let _lastBase = null;

function _notifyListeners() {
    _debounceId = 0;
    const base = getBaseDirectory();
    if (base === _lastBase) {
        return GLib.SOURCE_REMOVE;
    }
    _lastBase = base;
    for (const callback of Array.from(_listeners.values())) {
        try {
            callback(base);
        } catch (e) {
            if (typeof global !== "undefined" && global.logError) {
                global.logError(e, "aVinceLaunch: base directory listener failed");
            }
        }
    }
    return GLib.SOURCE_REMOVE;
}

function _onConfigDirChanged(monitor, file, otherFile, eventType) {
    const names = [file, otherFile].filter(Boolean).map(f => f.get_basename());
    if (names.indexOf("config.json") === -1) {
        return;
    }
    if (_debounceId) {
        GLib.source_remove(_debounceId);
    }
    _debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, _notifyListeners);
}

function _startMonitor() {
    if (_monitor) {
        return;
    }
    try {
        GLib.mkdir_with_parents(CONFIG_DIR, 0o755);
        _monitor = Gio.File.new_for_path(CONFIG_DIR).monitor_directory(
            Gio.FileMonitorFlags.WATCH_MOVES, null);
        _monitorSignal = _monitor.connect("changed", _onConfigDirChanged);
    } catch (e) {
        _monitor = null;
        if (typeof global !== "undefined" && global.logError) {
            global.logError(e, "aVinceLaunch: cannot watch config.json");
        }
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

// owner: das Desklet-Objekt (je Objekt ein Eintrag - wie P16: ein neu
// aufgebauter Fence meldet sich an, bevor der alte abmeldet).
function watchBaseDirectory(owner, callback) {
    if (_listeners.size === 0) {
        _lastBase = getBaseDirectory();
    }
    _listeners.set(owner, callback);
    _startMonitor();
}

function unwatchBaseDirectory(owner) {
    _listeners.delete(owner);
    if (_listeners.size === 0) {
        _stopMonitor();
    }
}
