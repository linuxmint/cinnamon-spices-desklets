// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

// AP18-5 - Fence duplizieren.
//
// Das Original legt die neue Instanz selbst an (Probe 07.10.2026, Cinnamon
// 6.6.9: ein angehaengter Eintrag in enabled-desklets baut die uebrigen
// Fences nicht neu auf, deskletManager.js:211). Die Werte gehen NICHT von
// aussen in die <ID>.json der neuen Instanz, sondern ueber eine
// Uebergabedatei, die die neue Instanz beim ersten Start selbst liest,
// per settings.setValue() uebernimmt und loescht.
//
// Die reinen Teile (ID-Wahl, Ordnername, Werteliste) lassen sich ohne
// Cinnamon pruefen: tests/fence-clone-test.js.

var HANDOVER_VERSION = 1;

// Werte, die das Duplikat vom Original uebernimmt: Aussehen, Verhalten,
// Masse. NICHT dabei: Position (kommt aus enabled-desklets), Titel, Ordner
// (neuer leerer Gruppenordner, Entscheidung 7), Basisordner (gilt fuer alle,
// config.json), Sperren von Position und Inhalt (das Duplikat ist entsperrt),
// Einklappen und die Arbeitswerte des Einrichten-Dialogs (order-*).
var CLONE_COPY_KEYS = [
    "source-mode",
    "portal-path",
    "portal-show-hidden",
    "launch-mode",
    "folder-click-mode",
    "sort-mode",
    "folder-sort",
    "show-tooltips",
    "color-mode",
    "light-preset",
    "dark-preset",
    "layout-style",
    "columns",
    "row-spacing",
    "col-spacing",
    "text-align",
    "transparent-background",
    "icon-size",
    "show-text",
    "text-width-padding",
    "link-font",
    "text-shadow",
    "text-shadow-color",
    "border-width",
    "link-bg-color",
    "document-bg-color",
    "folder-bg-color",
    "border-color",
    "folder-border-color",
    "text-color",
    "desklet-bg-color",
    "title-color",
    "hover-bg-color",
    "pressed-bg-color",
    "folder-icon-tint",
    "tooltip-bg-color",
    "tooltip-text-color",
    "disabled-opacity",
    "snap-to-grid",
    "max-width",
    "max-height",
    "content-fit",
    "lock-size",
    "show-lock-indicator",
    "show-title",
    "title-align",
    "title-mode",
    "expand-on-hover",
    "show-search-button"
];

// Cinnamons Ablegefehler (placement.js, repairPrefixCollisions): Eintraege
// werden mit dem ANFANG der ID gesucht. Die neue ID darf deshalb weder der
// Anfang einer vorhandenen sein noch mit einer vorhandenen beginnen
// (4 -> 45 waere falsch). Liefert die kleinste solche ID ab nextId.
function pickInstanceId(nextId, existingIds) {
    const ids = (existingIds || []).map(String).filter(id => id.length > 0);
    let id = Math.max(1, parseInt(nextId, 10) || 1);
    const clashes = candidate => {
        const text = String(candidate);
        return ids.some(e => e.indexOf(text) === 0 || text.indexOf(e) === 0);
    };
    while (clashes(id)) {
        id++;
    }
    return id;
}

// IDs aller Instanzen einer UUID aus enabled-desklets ("uuid:id:x:y").
function instanceIdsOf(list, uuid) {
    const ids = [];
    (list || []).forEach(entry => {
        const elements = String(entry).split(":");
        if (elements.length === 4 && elements[0] === uuid) {
            ids.push(elements[1]);
        }
    });
    return ids;
}

// Neuer Gruppenordner neben dem alten: SYSTEM -> SYSTEM_2, SYSTEM_2 ->
// SYSTEM_3; vergeben ist, was exists() meldet.
function nextGroupName(subdirectory, exists) {
    const raw = String(subdirectory || "").trim().replace(/[\/\\]+$/, "");
    const stem = (raw.replace(/_\d+$/, "") || "FENCE");
    for (let n = 2; n < 1000; n++) {
        const name = stem + "_" + n;
        if (!exists(name)) {
            return name;
        }
    }
    return null;
}

function buildCloneValues(getValue, overrides) {
    const values = {};
    CLONE_COPY_KEYS.forEach(key => {
        try {
            const value = getValue(key);
            if (value !== undefined && value !== null) {
                values[key] = value;
            }
        } catch (e) {
            // Schluessel fehlt in dieser Fassung: auslassen.
        }
    });
    Object.keys(overrides || {}).forEach(key => {
        values[key] = overrides[key];
    });
    return values;
}

function _configDir() {
    return GLib.build_filenamev([GLib.get_user_config_dir(), "avincelaunch"]);
}

function handoverPath(instanceId) {
    return GLib.build_filenamev([_configDir(), "clone-" + String(instanceId) + ".json"]);
}

function writeHandover(instanceId, data) {
    const path = handoverPath(instanceId);
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
    const payload = Object.assign({ version: HANDOVER_VERSION }, data);
    GLib.file_set_contents(path, JSON.stringify(payload, null, 2) + "\n");
    return path;
}

function handoverExists(instanceId) {
    return GLib.file_test(handoverPath(instanceId), GLib.FileTest.EXISTS);
}

// Liest die Uebergabedatei und loescht sie - auch wenn sie unbrauchbar ist,
// damit sie nicht beim naechsten Start noch einmal greift.
function takeHandover(instanceId) {
    const path = handoverPath(instanceId);
    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
        return null;
    }
    let data = null;
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        if (ok) {
            data = JSON.parse(new TextDecoder().decode(bytes));
        }
    } catch (e) {
        data = null;
    }
    try {
        Gio.File.new_for_path(path).delete(null);
    } catch (e) {
        // Bleibt liegen; die Werte sind dann schon gesetzt.
    }
    if (!data || data.version !== HANDOVER_VERSION || typeof data.values !== "object") {
        return null;
    }
    return data;
}

// Sicherung vor dem Anlegen (Architektur M): enabled-desklets und
// layout.json in ~/.config/avincelaunch/backups/clone-<Zeit>/. Die letzten
// zehn bleiben.
var BACKUP_KEEP = 10;

function backupBeforeClone(enabledList) {
    const stamp = GLib.DateTime.new_now_local().format("%Y-%m-%d_%H-%M-%S");
    const root = GLib.build_filenamev([_configDir(), "backups"]);
    const dir = GLib.build_filenamev([root, "clone-" + stamp]);
    GLib.mkdir_with_parents(dir, 0o755);
    GLib.file_set_contents(GLib.build_filenamev([dir, "enabled-desklets.txt"]),
        (enabledList || []).join("\n") + "\n");
    const layout = Gio.File.new_for_path(GLib.build_filenamev([_configDir(), "layout.json"]));
    if (layout.query_exists(null)) {
        layout.copy(Gio.File.new_for_path(GLib.build_filenamev([dir, "layout.json"])),
            Gio.FileCopyFlags.OVERWRITE, null, null);
    }
    _pruneBackups(root);
    return dir;
}

function _pruneBackups(root) {
    try {
        const names = [];
        const enumerator = Gio.File.new_for_path(root).enumerate_children(
            "standard::name,standard::type", Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            if (info.get_file_type() === Gio.FileType.DIRECTORY && name.indexOf("clone-") === 0) {
                names.push(name);
            }
        }
        enumerator.close(null);
        names.sort();
        names.slice(0, Math.max(0, names.length - BACKUP_KEEP)).forEach(name => {
            const dir = Gio.File.new_for_path(GLib.build_filenamev([root, name]));
            const inner = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
            let child;
            while ((child = inner.next_file(null)) !== null) {
                dir.get_child(child.get_name()).delete(null);
            }
            inner.close(null);
            dir.delete(null);
        });
    } catch (e) {
        // Aufraeumen ist Nebensache.
    }
}
