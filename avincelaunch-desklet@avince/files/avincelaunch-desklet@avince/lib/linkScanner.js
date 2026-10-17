// SPDX-License-Identifier: GPL-3.0-only AND MIT
// Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik
// Portions copyright (c) MHK924 (TheLauncher), MIT - see THIRD-PARTY-NOTICES.md

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const UUID = "avincelaunch-desklet@avince";
const {
    readSidecar,
    isDisabled,
    isPinned,
    persistOrderFromItems,
    getItemStyle
} = imports.desklets[UUID].lib.sidecar;

// Aus dem schon (asynchron) gelesenen Inhalt - vom Dateinamen aus wuerde
// GIO die Datei noch einmal synchron lesen. Gleiche Lesart wie dort
// (GKeyFile ohne Flags).
function newDesktopAppInfo(bytes) {
    const keyFile = new GLib.KeyFile();
    keyFile.load_from_bytes(new GLib.Bytes(bytes), GLib.KeyFileFlags.NONE);
    try {
        const GioUnix = imports.gi.GioUnix;
        if (GioUnix && GioUnix.DesktopAppInfo) {
            return GioUnix.DesktopAppInfo.new_from_keyfile(keyFile);
        }
    } catch (e) {
        // Fall back to Gio below.
    }
    return Gio.DesktopAppInfo.new_from_keyfile(keyFile);
}

// V5f / N28: Gio.AppInfo liefert das Feld "Comment" ueber get_description();
// die vorher abgefragte Methode gibt es nicht (seit TheLauncher 1.0.3 blieb
// die Beschreibung im Tooltip deshalb immer leer).
function getAppComment(appInfo) {
    if (!appInfo) {
        return "";
    }
    try {
        if (typeof appInfo.get_description === "function") {
            return appInfo.get_description() || "";
        }
    } catch (e) {
        // Ignore and fall through.
    }
    return "";
}

function makeItemId(type, name) {
    return type + ":" + name;
}

function desktopHasExecLine(text) {
    return /^\s*Exec\s*=/m.test(text);
}

function readDesktopName(text, fallback) {
    const match = text.match(/^\s*Name\s*=\s*(.+)$/m);
    if (match && match[1]) {
        return match[1].trim();
    }
    return fallback;
}

// bytes = Inhalt der .desktop-Datei (Uint8Array). Liest nichts vom Ordner.
function parseDesktopEntry(filePath, fileNameOverride, bytes) {
    const fileName = fileNameOverride || GLib.path_get_basename(filePath);
    let appInfo = null;

    try {
        appInfo = newDesktopAppInfo(bytes);
    } catch (e) {
        appInfo = null;
    }

    let name = fileName;
    let comment = "";
    let icon = null;
    let showEntry = false;

    if (appInfo) {
        try {
            if (!appInfo.should_show || appInfo.should_show()) {
                showEntry = true;
                name = appInfo.get_display_name() || appInfo.get_name() || fileName;
                comment = getAppComment(appInfo);
                icon = appInfo.get_icon();
            }
        } catch (e) {
            // Fall through to manual parse.
        }
    }

    if (!showEntry) {
        const text = new TextDecoder().decode(bytes);
        if (!desktopHasExecLine(text)) {
            return null;
        }
        name = readDesktopName(text, fileName.replace(/\.desktop$/, ""));
        comment = name;
        if (appInfo) {
            try {
                icon = appInfo.get_icon();
            } catch (e) {
                icon = null;
            }
        }
        showEntry = true;
    }

    if (!showEntry) {
        return null;
    }

    return {
        id: makeItemId("app", fileName),
        type: "app",
        name: name,
        fileName: fileName,
        path: filePath,
        icon: icon,
        comment: comment,
        appInfo: appInfo,
        enabled: true
    };
}

// .desktop-Datei asynchron lesen und aufbereiten. callback(app | null) -
// null, wenn sie nicht lesbar ist oder nichts zu zeigen hat. Nach cancel()
// kommt kein Rueckruf.
function loadDesktopEntry(filePath, fileName, cancellable, callback) {
    Gio.File.new_for_path(filePath).load_contents_async(cancellable, (source, result) => {
        let bytes = null;
        try {
            [, bytes] = source.load_contents_finish(result);
        } catch (e) {
            bytes = null;
        }
        if (cancellable && cancellable.is_cancelled()) {
            return;
        }
        let app = null;
        if (bytes) {
            try {
                app = parseDesktopEntry(filePath, fileName, bytes);
            } catch (e) {
                app = null;
            }
        }
        callback(app);
    });
}

// Laesst sich die Datei zum Lesen oeffnen? callback(true | false)
function _probeReadable(filePath, cancellable, callback) {
    Gio.File.new_for_path(filePath).read_async(GLib.PRIORITY_LOW, cancellable, (source, result) => {
        let readable = false;
        try {
            const stream = source.read_finish(result);
            readable = true;
            stream.close_async(GLib.PRIORITY_LOW, null, () => {});
        } catch (e) {
            readable = false;
        }
        if (cancellable && cancellable.is_cancelled()) {
            return;
        }
        callback(readable);
    });
}

// Pfad eines Eintrags: bei einem Verweis sein Ziel (wie bisher eine Stufe,
// relativ zum Ordner), sonst der Eintrag selbst. Ziel und Art kommen aus dem
// Auflisten (standard::symlink-target) - kein eigener Zugriff.
function _entryPath(directoryPath, info, name) {
    const childPath = GLib.build_filenamev([directoryPath, name]);
    if (!info.get_is_symlink()) {
        return childPath;
    }
    let target = info.get_symlink_target();
    if (!target) {
        return childPath;
    }
    if (!GLib.path_is_absolute(target)) {
        target = GLib.build_filenamev([directoryPath, target]);
    }
    return target;
}

function parseFolderEntry(dirPath, dirName, sidecar) {
    const id = makeItemId("folder", dirName);
    const style = getItemStyle(sidecar, id);

    return {
        id: id,
        type: "folder",
        name: dirName,
        fileName: dirName,
        path: dirPath,
        icon: style.icon,
        bgColor: style.bgColor,
        iconTint: style.iconTint,
        comment: dirName,
        appInfo: null,
        enabled: true
    };
}

function getDocumentDisplayName(fileName) {
    const dotIndex = fileName.lastIndexOf(".");
    if (dotIndex > 0) {
        return fileName.substring(0, dotIndex);
    }
    return fileName;
}

function parseDocumentEntry(filePath) {
    const fileName = GLib.path_get_basename(filePath);
    return {
        id: makeItemId("document", fileName),
        type: "document",
        name: getDocumentDisplayName(fileName),
        fileName: fileName,
        path: filePath,
        icon: null,
        comment: fileName,
        appInfo: null,
        enabled: true
    };
}

function compareItems(a, b, folderSort) {
    const sortMode = folderSort || "mixed";

    if (sortMode === "folders-first") {
        if (a.type === "folder" && b.type !== "folder") {
            return -1;
        }
        if (a.type !== "folder" && b.type === "folder") {
            return 1;
        }
    } else if (sortMode === "folders-last") {
        if (a.type === "folder" && b.type !== "folder") {
            return 1;
        }
        if (a.type !== "folder" && b.type === "folder") {
            return -1;
        }
    }

    return a.name.localeCompare(b.name);
}

function applyOrdering(items, order, folderSort) {
    if (!order || order.length === 0) {
        return items.sort((a, b) => compareItems(a, b, folderSort));
    }

    const byId = {};
    items.forEach(item => {
        byId[item.id] = item;
    });

    const ordered = [];
    order.forEach(id => {
        if (byId[id]) {
            ordered.push(byId[id]);
            delete byId[id];
        }
    });

    const remaining = Object.keys(byId)
        .map(id => byId[id])
        .sort((a, b) => compareItems(a, b, folderSort));
    return ordered.concat(remaining);
}

// --- AP18-3: Sortierarten und Anpinnen -----------------------------------
// "manual" = gespeicherte Reihenfolge wie bisher. Alle anderen Arten sind
// nur eine Ansicht: die gespeicherte Reihenfolge bleibt unberuehrt, beim
// Zurueckschalten ist sie wieder da.
var SORT_MODES = ["manual", "name-asc", "name-desc", "type", "modified", "added"];

const TYPE_RANK = { folder: 0, app: 1, document: 2 };

// Ordner haben Rang 0 - darum nicht "|| 1" (0 waere sonst "fehlt").
function _typeRank(item) {
    return item.type in TYPE_RANK ? TYPE_RANK[item.type] : 1;
}

function _folderRank(item, folderSort) {
    if (folderSort === "folders-first") {
        return item.type === "folder" ? 0 : 1;
    }
    if (folderSort === "folders-last") {
        return item.type === "folder" ? 1 : 0;
    }
    return 0;
}

function sortItems(items, sortMode, folderSort) {
    const byName = (a, b) => a.name.localeCompare(b.name);
    let compare;
    switch (sortMode) {
    case "name-desc":
        compare = (a, b) => _folderRank(a, folderSort) - _folderRank(b, folderSort)
            || byName(b, a);
        break;
    case "type":
        compare = (a, b) => _typeRank(a) - _typeRank(b) || byName(a, b);
        break;
    case "modified":
        compare = (a, b) => _folderRank(a, folderSort) - _folderRank(b, folderSort)
            || (b.mtime || 0) - (a.mtime || 0) || byName(a, b);
        break;
    case "added":
        // Zeitpunkt der letzten Aenderung am Eintrag selbst (ctime): wird
        // beim Anlegen und Verschieben gesetzt und laesst sich - anders als
        // das Aenderungsdatum, das copy2 vom Original uebernimmt - nicht
        // mitkopieren.
        compare = (a, b) => _folderRank(a, folderSort) - _folderRank(b, folderSort)
            || (b.ctime || 0) - (a.ctime || 0) || byName(a, b);
        break;
    default:
        compare = (a, b) => compareItems(a, b, folderSort);
    }
    return items.slice().sort(compare);
}

// Angepinnte nach vorn, untereinander in der bisherigen Reihenfolge.
function pinnedFirst(items) {
    return items.filter(item => item.pinned).concat(items.filter(item => !item.pinned));
}

function _readTimes(info, item) {
    try {
        item.mtime = info.get_attribute_uint64("time::modified");
        item.ctime = info.get_attribute_uint64("time::changed");
    } catch (e) {
        item.mtime = 0;
        item.ctime = 0;
    }
}

// Attribute je Eintrag. Verweise: Art des Ziels (FileQueryInfoFlags.NONE),
// dazu Ziel und "ist Verweis" - so braucht kein Eintrag einen eigenen
// Statusaufruf.
var ENTRY_ATTRIBUTES = "standard::name,standard::type,standard::is-symlink,"
    + "standard::symlink-target,time::modified,time::changed";

// Einen aufgelisteten Eintrag (Gio.FileInfo) aufbereiten und an items
// anhaengen. .desktop-Dateien werden asynchron gelesen, Dokumente asynchron
// zur Probe geoeffnet (nur Lesbares wird gezeigt, wie bisher). Defekte
// Verweise, Geraete und Sockets erscheinen nicht.
// Liefert true, wenn ein asynchroner Schritt laeuft - dann ruft er next()
// (ausser nach cancel()); sonst false.
function _collectEntry(directoryPath, info, sidecar, items, cancellable, next) {
    const name = info.get_name();
    if (name.charAt(0) === ".") {
        return false;
    }

    const fileType = info.get_file_type();
    const scanPath = _entryPath(directoryPath, info, name);

    if (fileType === Gio.FileType.DIRECTORY) {
        const folder = parseFolderEntry(scanPath, name, sidecar);
        folder.enabled = !isDisabled(sidecar, folder.id);
        folder.pinned = isPinned(sidecar, folder.id);
        _readTimes(info, folder);
        items.push(folder);
        return false;
    }

    if (fileType !== Gio.FileType.REGULAR) {
        return false;
    }

    if (name.endsWith(".desktop")) {
        loadDesktopEntry(scanPath, name, cancellable, app => {
            try {
                if (app) {
                    app.enabled = !isDisabled(sidecar, app.id);
                    app.pinned = isPinned(sidecar, app.id);
                    _readTimes(info, app);
                    items.push(app);
                }
            } finally {
                next();
            }
        });
        return true;
    }

    _probeReadable(scanPath, cancellable, readable => {
        try {
            if (readable) {
                const doc = parseDocumentEntry(scanPath);
                doc.id = makeItemId("document", name);
                doc.fileName = name;
                doc.enabled = !isDisabled(sidecar, doc.id);
                doc.pinned = isPinned(sidecar, doc.id);
                _readTimes(info, doc);
                items.push(doc);
            }
        } finally {
            next();
        }
    });
    return true;
}

// Eintraege nacheinander aufbereiten - hoechstens ein Zugriff zugleich, die
// Reihenfolge bleibt die des Auflistens. done(items)
function _collectEntries(directoryPath, infos, sidecar, cancellable, done) {
    const items = [];
    let index = 0;
    const next = () => {
        while (index < infos.length) {
            if (cancellable.is_cancelled()) {
                return;
            }
            const info = infos[index++];
            let pending = false;
            try {
                pending = _collectEntry(directoryPath, info, sidecar, items, cancellable, next);
            } catch (e) {
                // Einzelner Eintrag unlesbar - die uebrigen trotzdem zeigen.
                pending = false;
            }
            if (pending) {
                return;
            }
        }
        if (!cancellable.is_cancelled()) {
            done(items);
        }
    };
    next();
}
// Reihenfolge, gespeicherte Reihenfolge, Sortierart und Angepinnte - fuer
// beide Wege gleich.
function _finishScan(directoryPath, items, sidecar, options) {
    const persistOrder = !options || options.persistOrder !== false;
    const folderSort = options && options.folderSort ? options.folderSort : "mixed";
    const sortMode = options && options.sortMode ? options.sortMode : "manual";
    const ignoreSavedOrder = !!(options && options.ignoreSavedOrder);

    const savedOrder = ignoreSavedOrder ? [] : sidecar.order;
    const orderedItems = applyOrdering(items, savedOrder, folderSort);
    if (persistOrder) {
        sidecar = persistOrderFromItems(directoryPath, orderedItems);
    }
    const shownItems = pinnedFirst(sortMode === "manual"
        ? orderedItems : sortItems(orderedItems, sortMode, folderSort));

    return {
        items: shownItems,
        // Gespeicherte Reihenfolge ohne Ansicht (Sortierart, Angepinnte) -
        // fuer die Liste im Dialog; "Uebernehmen" darf die Ansicht nie als
        // Reihenfolge festschreiben.
        manualItems: orderedItems,
        sidecar: sidecar,
        error: null
    };
}

function emptySidecar() {
    return {
        version: 1,
        order: [],
        disabled: [],
        folderClickMode: null,
        itemStyles: {},
        pinned: [],
        missingSince: {},
        extra: {}
    };
}

const BATCH_SIZE = 64;

function _logError(e, text) {
    if (typeof global !== "undefined" && global.logError) {
        global.logError(e, text);
    }
}

// Einen Fence-Ordner asynchron einlesen - lokal wie auf einem Netzlaufwerk.
// Auflisten stapelweise, danach jeder Eintrag einzeln (_collectEntries); erst
// dann Reihenfolge-Datei, Sortierart und Angepinnte wie bisher (_finishScan).
// Die Reihenfolge-Datei wird synchron gelesen (und mit persistOrder
// geschrieben): klein, und erst, nachdem der Ordner gerade geantwortet hat.
// options: { persistOrder, folderSort, sortMode, ignoreSavedOrder }
// callback(result): { items, manualItems, sidecar, error } - error null |
// "missing" (Ordner fehlt oder ist keiner) | "unreadable"
// Rueckgabe: Gio.Cancellable - nach cancel() kommt kein Rueckruf.
function scanDirectoryAsync(directoryPath, options, callback) {
    const cancellable = new Gio.Cancellable();
    const infos = [];

    function deliver(result) {
        if (!cancellable.is_cancelled()) {
            callback(result);
        }
    }

    function fail(error) {
        deliver({ items: [], manualItems: [], sidecar: emptySidecar(), error: error });
    }

    function finishListing() {
        if (cancellable.is_cancelled()) {
            return;
        }
        let sidecar;
        try {
            sidecar = readSidecar(directoryPath);
        } catch (e) {
            fail("unreadable");
            return;
        }
        _collectEntries(directoryPath, infos, sidecar, cancellable, items => {
            let scan;
            try {
                scan = _finishScan(directoryPath, items, sidecar, options);
            } catch (e) {
                _logError(e, "aVinceLaunch: failed to read " + directoryPath);
                fail("unreadable");
                return;
            }
            deliver(scan);
        });
    }

    function nextBatch(enumerator) {
        enumerator.next_files_async(BATCH_SIZE, GLib.PRIORITY_LOW, cancellable, (source, result) => {
            let batch;
            try {
                batch = source.next_files_finish(result);
            } catch (e) {
                if (!cancellable.is_cancelled()) {
                    _logError(e, "aVinceLaunch: failed to enumerate " + directoryPath);
                }
                enumerator.close_async(GLib.PRIORITY_LOW, null, () => {});
                fail("unreadable");
                return;
            }
            if (!batch || batch.length === 0) {
                // P58: Aufzaehler schliessen (gab den Ordner sonst erst spaeter frei).
                enumerator.close_async(GLib.PRIORITY_LOW, null, () => {});
                finishListing();
                return;
            }
            batch.forEach(info => infos.push(info));
            nextBatch(enumerator);
        });
    }

    if (!directoryPath) {
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            fail("missing");
            return GLib.SOURCE_REMOVE;
        });
        return cancellable;
    }

    Gio.File.new_for_path(directoryPath).enumerate_children_async(ENTRY_ATTRIBUTES,
        Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, cancellable, (source, result) => {
            let enumerator;
            try {
                enumerator = source.enumerate_children_finish(result);
            } catch (e) {
                if (cancellable.is_cancelled()) {
                    return;
                }
                const missing = e.matches && (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)
                    || e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_DIRECTORY));
                if (!missing) {
                    _logError(e, "aVinceLaunch: failed to enumerate " + directoryPath);
                }
                fail(missing ? "missing" : "unreadable");
                return;
            }
            nextBatch(enumerator);
        });

    return cancellable;
}
