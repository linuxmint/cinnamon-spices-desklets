const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const {
    readSidecar,
    isDisabled,
    persistOrderFromItems,
    getItemStyle
} = require("./lib/sidecar");

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

function getAppComment(appInfo) {
    if (!appInfo) {
        return "";
    }
    try {
        if (typeof appInfo.get_comment === "function") {
            return appInfo.get_comment() || "";
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
        const text = imports.byteArray.toString(contents);
        return /^\s*Exec\s*=/m.test(text);
    } catch (e) {
        return false;
    }
}

function readDesktopName(filePath, fallback) {
    try {
        const [, contents] = GLib.file_get_contents(filePath);
        const text = imports.byteArray.toString(contents);
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

function resolveChildPath(directoryPath, name) {
    let childPath = GLib.build_filenamev([directoryPath, name]);

    if (!GLib.file_test(childPath, GLib.FileTest.IS_SYMLINK)) {
        return { path: childPath, fileName: name };
    }

    try {
        let target = GLib.file_read_link(childPath);
        if (!target) {
            return { path: childPath, fileName: name };
        }
        if (!GLib.path_is_absolute(target)) {
            target = GLib.build_filenamev([directoryPath, target]);
        }
        if (GLib.file_test(target, GLib.FileTest.EXISTS)) {
            return { path: target, fileName: name };
        }
    } catch (e) {
        global.logError(e, "TheLauncher: failed to resolve symlink " + childPath);
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

function scanDirectory(directoryPath, options) {
    const persistOrder = !options || options.persistOrder !== false;
    const folderSort = options && options.folderSort ? options.folderSort : "mixed";
    const ignoreSavedOrder = !!(options && options.ignoreSavedOrder);
    let sidecar = readSidecar(directoryPath);
    const items = [];

    if (!GLib.file_test(directoryPath, GLib.FileTest.IS_DIR)) {
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
            "standard::name,standard::type",
            Gio.FileQueryInfoFlags.NONE,
            null
        );
    } catch (e) {
        global.logError(e, "TheLauncher: failed to enumerate " + directoryPath);
        return { items: [], sidecar: sidecar, error: "unreadable" };
    }

    let info;
    while ((info = enumerator.next_file(null)) !== null) {
        const name = info.get_name();
        if (name.charAt(0) === ".") {
            continue;
        }

        const childPath = GLib.build_filenamev([directoryPath, name]);
        const fileType = info.get_file_type();
        const resolved = resolveChildPath(directoryPath, name);
        const scanPath = resolved.path;
        const entryName = resolved.fileName;

        if (fileType === Gio.FileType.DIRECTORY
            || (fileType === Gio.FileType.SYMBOLIC_LINK
                && GLib.file_test(scanPath, GLib.FileTest.IS_DIR))) {
            const folder = parseFolderEntry(scanPath, entryName, sidecar);
            folder.enabled = !isDisabled(sidecar, folder.id);
            items.push(folder);
            continue;
        }

        if (fileType === Gio.FileType.REGULAR
            || fileType === Gio.FileType.SYMBOLIC_LINK) {
            const baseName = entryName;
            if (baseName.endsWith(".desktop")
                && GLib.file_test(scanPath, GLib.FileTest.IS_REGULAR)) {
                const app = parseDesktopEntry(scanPath, baseName);
                if (!app) {
                    continue;
                }
                app.enabled = !isDisabled(sidecar, app.id);
                items.push(app);
            } else if (GLib.file_test(scanPath, GLib.FileTest.IS_REGULAR)) {
                const doc = parseDocumentEntry(scanPath);
                doc.id = makeItemId("document", baseName);
                doc.fileName = baseName;
                doc.enabled = !isDisabled(sidecar, doc.id);
                items.push(doc);
            }
        }
    }

    const savedOrder = ignoreSavedOrder ? [] : sidecar.order;
    const orderedItems = applyOrdering(items, savedOrder, folderSort);
    if (persistOrder) {
        sidecar = persistOrderFromItems(directoryPath, orderedItems);
    }

    return {
        items: orderedItems,
        sidecar: sidecar,
        error: null
    };
}

if (typeof module !== "undefined") {
    module.exports = {
        scanDirectory,
        makeItemId
    };
}
