// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

// Pruefung Phase 2, B12 (P74): Cinnamons Einstellungsdialog LOESCHT die
// <ID>.json vor dem Neuschreiben (JsonSettingsWidgets.save_settings). Bricht
// es dazwischen ab, legt Cinnamon die Datei mit Vorgaben neu an - Ordner,
// Farben, Groesse und Titel dieses Fence waeren weg. Darum sichert der Fence
// seine Datei vor dem Oeffnen des Dialogs und bei jedem Start:
//   ~/.config/avincelaunch/backups/einstellungen-<ID>/<Zeit>.json
// Nur wenn sie sich seit der letzten Kopie geaendert hat; die letzten KEEP
// Kopien je Fence bleiben.
//
// Pruefung Phase 3 Teil 2, BT1 (T10):
//   - Reihenfolge nach Aenderungszeit (nicht nach Namen); die gerade
//     angelegte Kopie wird nie sofort wieder geloescht (auch nicht, wenn die
//     Uhr zurueckgesprungen ist).
//   - Zusaetzlich bleibt eine Anker-Kopie: die juengste, die aelter als ein
//     Tag ist. Nach einem Zuruecksetzen auf Vorgaben verdraengen sonst fuenf
//     Starts die letzte gute Kopie.
//   - Ordner entfernter Fences: beim Start bemerkt, mit ".entfernt" (Zeit)
//     markiert und REMOVED_KEEP_DAYS Tage spaeter geloescht - so lange ist
//     die Kopie die Rettung, denn Cinnamon loescht die <ID>.json beim
//     Entfernen. Kommt der Fence zurueck, faellt die Markierung weg.

var KEEP = 5;
var ANCHOR_AGE = 24 * 60 * 60;
var REMOVED_KEEP_DAYS = 30;
const REMOVED_MARKER = ".entfernt";

let _nowForTests = null;

function _setNowForTests(seconds) {
    _nowForTests = (seconds === undefined) ? null : seconds;
}

function _now() {
    return _nowForTests !== null ? _nowForTests : Math.floor(GLib.get_real_time() / 1000000);
}

// Aenderungszeit in Mikrosekunden (0 wenn unbekannt).
function _mtime(path) {
    try {
        const info = Gio.File.new_for_path(path).query_info(
            "time::modified,time::modified-usec", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        return info.get_attribute_uint64("time::modified") * 1000000
            + info.get_attribute_uint32("time::modified-usec");
    } catch (e) {
        return 0;
    }
}

function _readBytes(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? bytes : null;
    } catch (e) {
        return null;
    }
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

function _listCopies(dir) {
    const names = [];
    try {
        const handle = GLib.Dir.open(dir, 0);
        let name;
        while ((name = handle.read_name()) !== null) {
            if (name.endsWith(".json")) {
                names.push(name);
            }
        }
        handle.close();
    } catch (e) {
        // Ordner fehlt noch.
    }
    return names.sort();
}

function backupDirFor(configDir, instanceId) {
    return GLib.build_filenamev([configDir, "avincelaunch", "backups",
        "einstellungen-" + String(instanceId)]);
}

// Kopien eines Ordners, neueste zuerst: [{ name, mtime }].
function _copiesNewestFirst(dir) {
    return _listCopies(dir).map(name => ({
        name: name,
        mtime: _mtime(GLib.build_filenamev([dir, name]))
    })).sort((a, b) => (b.mtime - a.mtime) || (a.name < b.name ? 1 : (a.name > b.name ? -1 : 0)));
}

// sourcePath: die <ID>.json; dir: Zielordner dieses Fence.
// Liefert den Pfad der neuen Kopie oder null (nichts zu tun / Fehler).
function backupSettingsFile(sourcePath, dir, keep) {
    const bytes = _readBytes(sourcePath);
    if (!bytes || bytes.length === 0) {
        return null;
    }
    const limit = keep > 0 ? keep : KEEP;
    try {
        GLib.mkdir_with_parents(dir, 0o755);
        const copies = _copiesNewestFirst(dir);
        const newest = copies.length ? _readBytes(GLib.build_filenamev([dir, copies[0].name])) : null;
        if (_sameBytes(bytes, newest)) {
            return null;
        }
        const stamp = GLib.DateTime.new_now_local().format("%Y-%m-%d_%H-%M-%S-%f");
        let target = GLib.build_filenamev([dir, stamp + ".json"]);
        for (let n = 2; GLib.file_test(target, GLib.FileTest.EXISTS); n++) {
            target = GLib.build_filenamev([dir, stamp + "-" + n + ".json"]);
        }
        GLib.file_set_contents(target, bytes);
        // BT1: die neue Kopie + die (limit - 1) neuesten uebrigen + der Anker.
        const keepNames = new Set([GLib.path_get_basename(target)]);
        const all = _copiesNewestFirst(dir);
        all.forEach(entry => {
            if (keepNames.size < limit) {
                keepNames.add(entry.name);
            }
        });
        const anchorLimit = (_now() - ANCHOR_AGE) * 1000000;
        const anchor = all.find(entry => entry.mtime > 0 && entry.mtime < anchorLimit);
        if (anchor) {
            keepNames.add(anchor.name);
        }
        all.forEach(entry => {
            if (!keepNames.has(entry.name)) {
                Gio.File.new_for_path(GLib.build_filenamev([dir, entry.name])).delete(null);
            }
        });
        return target;
    } catch (e) {
        if (typeof global !== "undefined" && global.logError) {
            global.logError(e, "aVinceLaunch: Sicherung der Einstellungen fehlgeschlagen");
        }
        return null;
    }
}

// --- BT1: Sicherungen entfernter Fences --------------------------------------
// aliveIds: IDs der Fences in enabled-desklets. Leer = nichts tun (Schutz,
// falls die Liste nicht lesbar war). Liefert die geloeschten IDs.
function pruneRemovedFenceBackups(configDir, aliveIds) {
    const alive = new Set(Array.from(aliveIds || [], id => String(id)));
    if (alive.size === 0) {
        return [];
    }
    const root = GLib.build_filenamev([configDir, "avincelaunch", "backups"]);
    const folders = [];
    try {
        const handle = GLib.Dir.open(root, 0);
        let name;
        while ((name = handle.read_name()) !== null) {
            const match = /^einstellungen-(\d+)$/.exec(name);
            if (match) {
                folders.push([match[1], GLib.build_filenamev([root, name])]);
            }
        }
        handle.close();
    } catch (e) {
        return [];
    }
    const deleted = [];
    const now = _now();
    folders.forEach(([id, dir]) => {
        const marker = GLib.build_filenamev([dir, REMOVED_MARKER]);
        try {
            if (alive.has(id)) {
                if (GLib.file_test(marker, GLib.FileTest.EXISTS)) {
                    Gio.File.new_for_path(marker).delete(null);
                }
                return;
            }
            const text = _readBytes(marker);
            const since = text ? parseInt(new TextDecoder().decode(text), 10) : NaN;
            if (!Number.isFinite(since) || since > now) {
                GLib.file_set_contents(marker, String(now) + "\n");
                return;
            }
            if (now - since < REMOVED_KEEP_DAYS * 24 * 60 * 60) {
                return;
            }
            // Nur eigene Dateien loeschen (Kopien *.json und die Markierung).
            // Liegt etwas anderes darin, bleibt der Ordner ganz unberuehrt.
            const handle = GLib.Dir.open(dir, 0);
            let entry;
            let foreign = false;
            while ((entry = handle.read_name()) !== null) {
                if (entry !== REMOVED_MARKER && !entry.endsWith(".json")) {
                    foreign = true;
                }
            }
            handle.close();
            if (foreign) {
                return;
            }
            _listCopies(dir).concat([REMOVED_MARKER]).forEach(name => {
                Gio.File.new_for_path(GLib.build_filenamev([dir, name])).delete(null);
            });
            Gio.File.new_for_path(dir).delete(null);
            deleted.push(id);
        } catch (e) {
            // Naechster Start versucht es wieder.
        }
    });
    return deleted;
}

// Einmal je Cinnamon-Start (wie pruneOrphanFenceLayouts in layoutManager.js).
let _removedPruned = false;

function pruneRemovedFenceBackupsOnce(configDir, uuid) {
    if (_removedPruned) {
        return [];
    }
    _removedPruned = true;
    const alive = [];
    try {
        global.settings.get_strv("enabled-desklets").forEach(entry => {
            const parts = entry.split(":");
            if (parts[0] === uuid && parts[1]) {
                alive.push(parts[1]);
            }
        });
    } catch (e) {
        return [];
    }
    const deleted = pruneRemovedFenceBackups(configDir, alive);
    if (deleted.length && typeof global !== "undefined" && global.log) {
        global.log("aVinceLaunch: Einstellungssicherungen entfernter Fences geloescht: " + deleted.join(", "));
    }
    return deleted;
}
