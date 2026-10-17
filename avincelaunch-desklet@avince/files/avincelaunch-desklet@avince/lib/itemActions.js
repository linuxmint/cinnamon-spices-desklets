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

// Fehler eines Versuchs in den Grund uebersetzen - statt vorher zu pruefen,
// ob Quelle oder Ziel da sind (das waere ein eigener, synchroner Zugriff).
// Verschieben und Papierkorb arbeiten ohne Verweisen zu folgen: auch ein
// Verweis mit verlorenem Ziel zaehlt als vorhanden.
function _reasonOf(error) {
    if (error && error.matches) {
        if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
            return "missing";
        }
        if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
            return "exists";
        }
    }
    return "failed";
}

function _idle(fn) {
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        fn();
        return GLib.SOURCE_REMOVE;
    });
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

// Rueckruf callback({ ok: true, record }) oder { ok: false, reason:
// "exists" | "missing" | "same" | "failed", error } - immer asynchron.
// Ein laufendes Verschieben wird nicht abgebrochen (kein halb verschobener
// Eintrag); wer das Ergebnis nicht mehr braucht, ignoriert den Rueckruf.
function moveEntry(sourceDir, targetDir, fileName, itemId, callback) {
    if (!sourceDir || !targetDir || !fileName) {
        _idle(() => callback({ ok: false, reason: "failed" }));
        return;
    }
    if (GLib.canonicalize_filename(sourceDir, null)
        === GLib.canonicalize_filename(targetDir, null)) {
        _idle(() => callback({ ok: false, reason: "same" }));
        return;
    }
    const source = _entryFile(sourceDir, fileName);
    const target = _entryFile(targetDir, fileName);
    // Ohne OVERWRITE: ein gleichnamiger Eintrag im Ziel bleibt in jedem Fall
    // unangetastet (Fehler EXISTS). Fehlt die Quelle: NOT_FOUND. Gleiches
    // Dateisystem = Umbenennen.
    source.move_async(target, Gio.FileCopyFlags.NOFOLLOW_SYMLINKS | Gio.FileCopyFlags.ALL_METADATA,
        GLib.PRIORITY_DEFAULT, null, null, (file, result) => {
            try {
                file.move_finish(result);
            } catch (e) {
                const reason = _reasonOf(e);
                callback(reason === "failed" ? { ok: false, reason: reason, error: e }
                    : { ok: false, reason: reason });
                return;
            }
            let taken;
            try {
                taken = _takeOutOfSidecar(sourceDir, itemId);
                _putIntoSidecar(targetDir, itemId, taken, -1);
            } catch (e) {
                taken = taken || { index: -1, disabled: false, style: null, pinned: false };
            }
            callback({
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
            });
        });
}

// Genau eine Verschiebung zuruecknehmen; der Eintrag kommt an seinen alten
// Platz in der Reihenfolge. callback(result) wie moveEntry.
function undoMove(record, callback) {
    if (!record) {
        _idle(() => callback({ ok: false, reason: "failed" }));
        return;
    }
    moveEntry(record.targetDir, record.sourceDir, record.fileName, record.itemId, result => {
        if (result.ok && record.index >= 0) {
            try {
                _putIntoSidecar(record.sourceDir, record.itemId,
                    { disabled: record.disabled, style: record.style, pinned: record.pinned }, record.index);
            } catch (e) {
                // Eintrag ist zurueck; nur sein alter Platz fehlt.
            }
        }
        callback(result);
    });
}

// Eintrag in den Papierkorb (wie der Dialog, OrderListWidget.py).
// callback({ ok: true }) oder { ok: false, reason: "missing" | "failed", error }
function trashEntry(directoryPath, fileName, itemId, callback) {
    const file = _entryFile(directoryPath, fileName);
    file.trash_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
        try {
            source.trash_finish(result);
        } catch (e) {
            if (_reasonOf(e) === "missing") {
                callback({ ok: false, reason: "missing" });
            } else {
                callback({ ok: false, reason: "failed", error: e });
            }
            return;
        }
        try {
            _takeOutOfSidecar(directoryPath, itemId);
        } catch (e) {
            // Eintrag ist im Papierkorb; das Sidecar raeumt das naechste Einlesen auf.
        }
        callback({ ok: true });
    });
}

// Anzahl der Eintraege in einem Unterordner (fuer die Rueckfrage); -1 bei
// Fehler. Versteckte Dateien (Sidecar) zaehlen nicht. callback(count) -
// nach cancellable.cancel() kein Rueckruf.
function countEntries(directoryPath, cancellable, callback) {
    let count = 0;
    const done = value => {
        if (!cancellable || !cancellable.is_cancelled()) {
            callback(value);
        }
    };
    const nextBatch = enumerator => {
        enumerator.next_files_async(64, GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
            let infos;
            try {
                infos = source.next_files_finish(result);
            } catch (e) {
                enumerator.close_async(GLib.PRIORITY_DEFAULT, null, () => {});
                done(-1);
                return;
            }
            if (!infos || infos.length === 0) {
                enumerator.close_async(GLib.PRIORITY_DEFAULT, null, () => {});
                done(count);
                return;
            }
            infos.forEach(info => {
                if (!info.get_is_hidden()) {
                    count++;
                }
            });
            nextBatch(enumerator);
        });
    };
    Gio.File.new_for_path(directoryPath).enumerate_children_async(
        "standard::name,standard::is-hidden", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
            let enumerator;
            try {
                enumerator = source.enumerate_children_finish(result);
            } catch (e) {
                done(-1);
                return;
            }
            nextBatch(enumerator);
        });
}
