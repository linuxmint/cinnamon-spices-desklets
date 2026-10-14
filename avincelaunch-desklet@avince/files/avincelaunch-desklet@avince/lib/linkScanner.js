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

function newDesktopAppInfo(filePath) {
    try {
        const GioUnix = imports.gi.GioUnix;
        if (GioUnix && GioUnix.DesktopAppInfo) {
            return GioUnix.DesktopAppInfo.new_from_filename(filePath);
        }
    } catch (e) {
        // Fall back to Gio below.
    }
    return Gio.DesktopAppInfo.new_from_filename(filePath);
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

function desktopHasExecLine(filePath) {
    try {
        const [, contents] = GLib.file_get_contents(filePath);
        const text = new TextDecoder().decode(contents);
        return /^\s*Exec\s*=/m.test(text);
    } catch (e) {
        return false;
    }
}

function readDesktopName(filePath, fallback) {
    try {
        const [, contents] = GLib.file_get_contents(filePath);
        const text = new TextDecoder().decode(contents);
        const match = text.match(/^\s*Name\s*=\s*(.+)$/m);
        if (match && match[1]) {
            return match[1].trim();
        }
    } catch (e) {
        // Fall through.
    }
    return fallback;
}

function parseDesktopEntry(filePath, fileNameOverride) {
    const fileName = fileNameOverride || GLib.path_get_basename(filePath);
    let appInfo = null;

    try {
        appInfo = newDesktopAppInfo(filePath);
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
        if (!desktopHasExecLine(filePath)) {
            return null;
        }
        name = readDesktopName(filePath, fileName.replace(/\.desktop$/, ""));
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

function pathExists(path) {
    try {
        const stream = Gio.File.new_for_path(path).read(null);
        stream.close(null);
        return true;
    } catch (e) {
        const message = String(e);
        return message.indexOf("IS_DIRECTORY") !== -1
            || message.indexOf("Is a directory") !== -1
            || message.indexOf("is a directory") !== -1;
    }
}

function isDirectoryPath(path) {
    if (!path) {
        return false;
    }

    try {
        const file = Gio.File.new_for_path(path);

        if (!file.query_exists(null)) {
            return false;
        }

        return file.query_file_type(
            Gio.FileQueryInfoFlags.NONE,
            null
        ) === Gio.FileType.DIRECTORY;
    } catch (e) {
        global.logError(e, "aVinceLaunch: scanner directory check failed for " + path);
        return false;
    }
}

function isRegularFilePath(path) {
    try {
        const stream = Gio.File.new_for_path(path).read(null);
        stream.close(null);
        return true;
    } catch (e) {
        return false;
    }
}

function resolveChildPath(directoryPath, name) {
    let childPath = GLib.build_filenamev([directoryPath, name]);

    try {
        let target = GLib.file_read_link(childPath);
        if (!target) {
            return { path: childPath, fileName: name };
        }
        if (!GLib.path_is_absolute(target)) {
            target = GLib.build_filenamev([directoryPath, target]);
        }
        if (pathExists(target)) {
            return { path: target, fileName: name };
        }
    } catch (e) {
        // Not a symlink or unreadable — use the child path as-is.
    }

    return { path: childPath, fileName: name };
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

// Attribute je Eintrag - dieselben beim synchronen und beim asynchronen
// Auflisten (Schritt 4, V4d).
var ENTRY_ATTRIBUTES = "standard::name,standard::type,time::modified,time::changed";

// Einen aufgelisteten Eintrag (Gio.FileInfo) aufbereiten und an items
// anhaengen. Liest bei Verweisen, .desktop-Dateien und Dokumenten einzeln
// vom Ordner (Ziel, Lesbarkeit, Inhalt).
function _collectEntry(directoryPath, info, sidecar, items) {
    const name = info.get_name();
    if (name.charAt(0) === ".") {
        return;
    }

    const fileType = info.get_file_type();
    const resolved = resolveChildPath(directoryPath, name);
    const scanPath = resolved.path;
    const entryName = resolved.fileName;

    if (fileType === Gio.FileType.DIRECTORY
        || (fileType === Gio.FileType.SYMBOLIC_LINK
            && isDirectoryPath(scanPath))) {
        const folder = parseFolderEntry(scanPath, entryName, sidecar);
        folder.enabled = !isDisabled(sidecar, folder.id);
        folder.pinned = isPinned(sidecar, folder.id);
        _readTimes(info, folder);
        items.push(folder);
        return;
    }

    if (fileType === Gio.FileType.REGULAR
        || fileType === Gio.FileType.SYMBOLIC_LINK) {
        const baseName = entryName;
        if (baseName.endsWith(".desktop")
            && isRegularFilePath(scanPath)) {
            const app = parseDesktopEntry(scanPath, baseName);
            if (!app) {
                return;
            }
            app.enabled = !isDisabled(sidecar, app.id);
            app.pinned = isPinned(sidecar, app.id);
            _readTimes(info, app);
            items.push(app);
        } else if (isRegularFilePath(scanPath)) {
            const doc = parseDocumentEntry(scanPath);
            doc.id = makeItemId("document", baseName);
            doc.fileName = baseName;
            doc.enabled = !isDisabled(sidecar, doc.id);
            doc.pinned = isPinned(sidecar, doc.id);
            _readTimes(info, doc);
            items.push(doc);
        }
    }
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

function scanDirectory(directoryPath, options) {
    let sidecar = readSidecar(directoryPath);
    const items = [];

    if (!isDirectoryPath(directoryPath)) {
        return { items: [], sidecar: sidecar, error: "missing" };
    }

    let dir;
    try {
        dir = Gio.File.new_for_path(directoryPath);
    } catch (e) {
        return { items: [], sidecar: sidecar, error: "unreadable" };
    }

    let enumerator;
    try {
        enumerator = dir.enumerate_children(
            ENTRY_ATTRIBUTES,
            Gio.FileQueryInfoFlags.NONE,
            null
        );
    } catch (e) {
        global.logError(e, "aVinceLaunch: failed to enumerate " + directoryPath);
        return { items: [], sidecar: sidecar, error: "unreadable" };
    }

    let info;
    try {
        while ((info = enumerator.next_file(null)) !== null) {
            _collectEntry(directoryPath, info, sidecar, items);
        }
    } finally {
        // P58: Aufzaehler schliessen (gab den Ordner sonst erst spaeter frei).
        try {
            enumerator.close(null);
        } catch (e) {
            // Schon geschlossen.
        }
    }

    return _finishScan(directoryPath, items, sidecar, options);
}

// Schritt 4, V4d: dasselbe Ergebnis wie scanDirectory, aber aus Eintraegen,
// die schon (asynchron) aufgelistet wurden - lib/portalScanner.js
// scanLinkDirectoryAsync. Ruft nur, wer weiss, dass der Ordner gerade
// geantwortet hat: Reihenfolge-Datei und einzelne Eintraege werden hier
// synchron gelesen, wie bisher.
function scanDirectoryFromInfos(directoryPath, infos, options) {
    const sidecar = readSidecar(directoryPath);
    const items = [];
    infos.forEach(info => {
        try {
            _collectEntry(directoryPath, info, sidecar, items);
        } catch (e) {
            // Einzelner Eintrag unlesbar - die uebrigen trotzdem zeigen.
        }
    });
    return _finishScan(directoryPath, items, sidecar, options);
}
