// SPDX-License-Identifier: GPL-3.0-only AND MIT
// Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik
// Portions copyright (c) MHK924 (TheLauncher), MIT - see THIRD-PARTY-NOTICES.md

const GLib = imports.gi.GLib;

var ENABLED_DESKLETS_KEY = "enabled-desklets";
const DESKLET_SNAP_KEY = "desklet-snap";
const DESKLET_SNAP_INTERVAL_KEY = "desklet-snap-interval";
var LOCK_DESKLETS_KEY = "lock-desklets";

function findEntry(settings, uuid, instanceId) {
    const list = settings.get_strv(ENABLED_DESKLETS_KEY);
    const instance = String(instanceId);

    for (let i = 0; i < list.length; i++) {
        const elements = list[i].split(":");
        if (elements.length !== 4) {
            continue;
        }
        if (elements[0] === uuid && elements[1] === instance) {
            return { index: i, elements: elements, list: list };
        }
    }

    return null;
}

function snapCoordinates(x, y, useInstanceSnap) {
    let nextX = Math.round(x);
    let nextY = Math.round(y);

    if (!useInstanceSnap || !global.settings.get_boolean(DESKLET_SNAP_KEY)) {
        return { x: nextX, y: nextY };
    }

    const interval = global.settings.get_int(DESKLET_SNAP_INTERVAL_KEY);
    if (interval <= 0) {
        return { x: nextX, y: nextY };
    }

    nextX = Math.round(nextX / interval) * interval;
    nextY = Math.round(nextY / interval) * interval;
    return { x: nextX, y: nextY };
}

function readGSettingsPosition(uuid, instanceId) {
    const entry = findEntry(global.settings, uuid, instanceId);
    if (!entry) {
        return null;
    }

    return {
        x: parseInt(entry.elements[2], 10),
        y: parseInt(entry.elements[3], 10)
    };
}

function writeGSettingsPosition(uuid, instanceId, x, y, useInstanceSnap) {
    const snapped = snapCoordinates(x, y, useInstanceSnap);
    const entry = findEntry(global.settings, uuid, instanceId);
    if (!entry) {
        return snapped;
    }

    if (entry.elements[2] === String(snapped.x) && entry.elements[3] === String(snapped.y)) {
        // Pruefung Phase 2, P13: Beim Ablegen schreibt Cinnamon die Lage
        // selbst in die Liste (acceptDrop), laesst seine Kopie (definitions)
        // aber alt. Stimmt die Liste also schon, muss die Kopie trotzdem
        // nachgezogen werden - sonst haelt die naechste Listenaenderung
        // (Duplizieren, Entfernen eines anderen Fence) diesen Fence fuer
        // geaendert und baut ihn neu auf (danach wirkte sein Dialog nicht,
        // P16), und repairPrefixCollisions setzte ihn auf die alte Lage.
        _syncDefinition(_quietManager(), uuid, instanceId, snapped.x, snapped.y);
        return snapped;
    }

    entry.elements[2] = String(snapped.x);
    entry.elements[3] = String(snapped.y);
    entry.list[entry.index] = entry.elements.join(":");

    writeEnabledDeskletsQuietly(entry.list, uuid, instanceId, snapped.x, snapped.y);
    return snapped;
}

// Cinnamon haelt eine geaenderte Position in enabled-desklets fuer eine neue
// Definition und baut den Fence ab und neu auf (deskletManager.js:213-255) -
// mitten in einem Ziehvorgang hinterliess das einen haengenden Zeiger und ein
// totes Menue (AP13b-Test 01.10.). Cinnamon selbst hoert beim eigenen
// Schreiben kurz weg (deskletManager.js:415, 577); genauso hier. Danach wird
// Cinnamons Zwischenstand nachgezogen, sonst baut die naechste Aenderung
// irgendeines Desklets diesen Fence doch noch neu auf.
// Ohne diese internen Stellen (anderes Cinnamon): normales Schreiben.
function _quietManager() {
    try {
        const manager = imports.ui.deskletManager;
        if (manager.deskletChangeKey && typeof manager._onEnabledDeskletsChanged === "function") {
            return manager;
        }
    } catch (e) {
        // Anderes Cinnamon.
    }
    return null;
}

function _setListQuietly(manager, list) {
    if (!manager) {
        global.settings.set_strv(ENABLED_DESKLETS_KEY, list);
        return;
    }
    global.settings.disconnect(manager.deskletChangeKey);
    try {
        global.settings.set_strv(ENABLED_DESKLETS_KEY, list);
    } finally {
        manager.deskletChangeKey = global.settings.connect(
            "changed::" + ENABLED_DESKLETS_KEY,
            manager._onEnabledDeskletsChanged
        );
    }
}

function _syncDefinition(manager, uuid, instanceId, x, y) {
    if (!manager) {
        return;
    }
    (manager.definitions || []).forEach(definition => {
        if (definition.uuid === uuid && String(definition.desklet_id) === String(instanceId)) {
            definition.x = String(x);
            definition.y = String(y);
        }
    });
}

function writeEnabledDeskletsQuietly(list, uuid, instanceId, x, y) {
    const manager = _quietManager();
    _setListQuietly(manager, list);
    _syncDefinition(manager, uuid, instanceId, x, y);
}

// Cinnamon-Fehler beim Ablegen (deskletManager.js:561, acceptDrop): Der
// Eintrag des abgelegten Desklets wird mit indexOf(uuid + ":" + id) == 0
// gesucht - also nur der ANFANG verglichen. Wird Fence 4 abgelegt, bekommen
// auch 40, 41, 42 ... seine Position. Cinnamon hoert dabei weg; erst die
// naechste Aenderung der Liste (z. B. Entfernen eines Fence) baut die
// betroffenen Fences an der falschen Stelle neu auf (Befund 04.10.2026:
// zwei Fences landeten auf der Lage eines dritten).
// Abhilfe nach jedem Ablegen: Eintraege mit gleichem Nummernanfang bekommen
// die Lage zurueck, die Cinnamon selbst noch fuer sie fuehrt (definitions,
// beim Ablegen unveraendert). Leise geschrieben - nichts wird neu aufgebaut.
// Liefert die Zahl der reparierten Eintraege.
function repairPrefixCollisions(uuid, instanceId) {
    const manager = _quietManager();
    const definitions = manager ? manager.definitions : null;
    if (!Array.isArray(definitions)) {
        return 0;
    }
    const own = String(instanceId);
    const list = global.settings.get_strv(ENABLED_DESKLETS_KEY);
    let repaired = 0;
    for (let i = 0; i < list.length; i++) {
        const elements = list[i].split(":");
        if (elements.length !== 4 || elements[0] !== uuid
            || elements[1] === own || elements[1].indexOf(own) !== 0) {
            continue;
        }
        const definition = definitions.find(d =>
            d.uuid === uuid && String(d.desklet_id) === elements[1]);
        if (!definition) {
            continue;
        }
        const x = String(definition.x);
        const y = String(definition.y);
        if (elements[2] === x && elements[3] === y) {
            continue;
        }
        elements[2] = x;
        elements[3] = y;
        list[i] = elements.join(":");
        repaired++;
    }
    if (repaired) {
        _setListQuietly(manager, list);
        global.log("aVinceLaunch: " + repaired + " Eintrag/Eintraege nach Cinnamons Ablegefehler (Fence "
            + own + ") wiederhergestellt");
    }
    return repaired;
}

function isDragLocked(instanceLock) {
    if (instanceLock) {
        return true;
    }
    return global.settings.get_boolean(LOCK_DESKLETS_KEY);
}

