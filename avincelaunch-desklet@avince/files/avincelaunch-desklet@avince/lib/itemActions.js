// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

// AP18-1 - Symbole zwischen Gruppen-Fences verschieben und aus einem Fence
// entfernen. Bewegt wird immer nur der Eintrag im Gruppenordner (Kopie einer
// .desktop-Datei, Dokument-Verknuepfung oder Unterordner) - nie ein Programm.
// Portale sind ausgeschlossen: dort liegen echte Dateien, und writeSidecar
// verweigert ohnehin jeden Schreibversuch.
//
// Reihenfolge, Abgeschaltet und Ordnerstil wandern im Sidecar mit; im Ziel
// steht der Eintrag am Ende.

const Sidecar = imports.desklets["avincelaunch-desklet@avince"].lib.sidecar;

function _entryFile(directoryPath, fileName) {
    return Gio.File.new_for_path(GLib.build_filenamev([directoryPath, fileName]));
}

// Ohne Verweisen zu folgen: auch ein Verweis mit verlorenem Ziel zaehlt.
function _exists(file) {
    try {
        file.query_info("standard::type", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        return true;
    } catch (e) {
        return false;
    }
}

function _removeFromList(list, id) {
    const index = list.indexOf(id);
    if (index !== -1) {
        list.splice(index, 1);
    }
    return index;
}

// Eintrag aus dem Sidecar des Quellordners austragen. Liefert, was fuer
// "Rueckgaengig" und das Ziel gebraucht wird.
function _takeOutOfSidecar(directoryPath, itemId) {
    const taken = { index: -1, disabled: false, style: null, pinned: false };
    if (!Sidecar.sidecarFilePresent(directoryPath)) {
        return taken;
    }
    const sidecar = Sidecar.readSidecar(directoryPath);
    taken.index = _removeFromList(sidecar.order, itemId);
    taken.disabled = _removeFromList(sidecar.disabled, itemId) !== -1;
    taken.pinned = _removeFromList(sidecar.pinned, itemId) !== -1;
    if (sidecar.itemStyles && sidecar.itemStyles[itemId]) {
        taken.style = sidecar.itemStyles[itemId];
        delete sidecar.itemStyles[itemId];
    }
    Sidecar.writeSidecar(directoryPath, sidecar);
    return taken;
}

// Im Zielordner eintragen. index < 0 = ans Ende. Ohne Sidecar nichts tun:
// das naechste Einlesen legt ihn an und nimmt den Eintrag mit auf.
function _putIntoSidecar(directoryPath, itemId, taken, index) {
    if (!Sidecar.sidecarFilePresent(directoryPath)) {
        return;
    }
    const sidecar = Sidecar.readSidecar(directoryPath);
    _removeFromList(sidecar.order, itemId);
    if (index >= 0 && index <= sidecar.order.length) {
        sidecar.order.splice(index, 0, itemId);
    } else {
        sidecar.order.push(itemId);
    }
    if (taken.disabled && sidecar.disabled.indexOf(itemId) === -1) {
        sidecar.disabled.push(itemId);
    }
    if (taken.style) {
        sidecar.itemStyles = sidecar.itemStyles || {};
        sidecar.itemStyles[itemId] = taken.style;
    }
    if (taken.pinned && sidecar.pinned.indexOf(itemId) === -1) {
        sidecar.pinned.push(itemId);
    }
    Sidecar.writeSidecar(directoryPath, sidecar);
}

// Liefert { ok: true, record } oder { ok: false, reason: "exists" |
// "missing" | "same" | "failed", error }.
function moveEntry(sourceDir, targetDir, fileName, itemId) {
    if (!sourceDir || !targetDir || !fileName) {
        return { ok: false, reason: "failed" };
    }
    if (GLib.canonicalize_filename(sourceDir, null)
        === GLib.canonicalize_filename(targetDir, null)) {
        return { ok: false, reason: "same" };
    }
    const source = _entryFile(sourceDir, fileName);
    const target = _entryFile(targetDir, fileName);
    if (!_exists(source)) {
        return { ok: false, reason: "missing" };
    }
    if (_exists(target)) {
        return { ok: false, reason: "exists" };
    }
    try {
        // Ohne OVERWRITE: ein gleichnamiger Eintrag im Ziel bleibt in jedem
        // Fall unangetastet. Gleiches Dateisystem = Umbenennen.
        source.move(target, Gio.FileCopyFlags.NOFOLLOW_SYMLINKS | Gio.FileCopyFlags.ALL_METADATA,
            null, null);
    } catch (e) {
        return { ok: false, reason: "failed", error: e };
    }
    const taken = _takeOutOfSidecar(sourceDir, itemId);
    _putIntoSidecar(targetDir, itemId, taken, -1);
    return {
        ok: true,
        record: {
            sourceDir: sourceDir,
            targetDir: targetDir,
            fileName: fileName,
            itemId: itemId,
            index: taken.index,
            disabled: taken.disabled,
            style: taken.style,
            pinned: taken.pinned
        }
    };
}

// Genau eine Verschiebung zuruecknehmen; der Eintrag kommt an seinen alten
// Platz in der Reihenfolge.
function undoMove(record) {
    if (!record) {
        return { ok: false, reason: "failed" };
    }
    const result = moveEntry(record.targetDir, record.sourceDir, record.fileName, record.itemId);
    if (result.ok && record.index >= 0) {
        _putIntoSidecar(record.sourceDir, record.itemId,
            { disabled: record.disabled, style: record.style, pinned: record.pinned }, record.index);
    }
    return result;
}

// Eintrag in den Papierkorb (wie der Dialog, OrderListWidget.py).
function trashEntry(directoryPath, fileName, itemId) {
    const file = _entryFile(directoryPath, fileName);
    if (!_exists(file)) {
        return { ok: false, reason: "missing" };
    }
    try {
        file.trash(null);
    } catch (e) {
        return { ok: false, reason: "failed", error: e };
    }
    _takeOutOfSidecar(directoryPath, itemId);
    return { ok: true };
}

// Anzahl der Eintraege in einem Unterordner (fuer die Rueckfrage); -1 bei
// Fehler. Versteckte Dateien (Sidecar) zaehlen nicht.
function countEntries(directoryPath) {
    let count = 0;
    try {
        const enumerator = Gio.File.new_for_path(directoryPath).enumerate_children(
            "standard::name,standard::is-hidden", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            if (!info.get_is_hidden()) {
                count++;
            }
        }
        enumerator.close(null);
    } catch (e) {
        return -1;
    }
    return count;
}
