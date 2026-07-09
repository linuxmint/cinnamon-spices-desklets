const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const SIDECAR_NAME = ".thelauncher.json";

function getSidecarPath(directoryPath) {
    return GLib.build_filenamev([directoryPath, SIDECAR_NAME]);
}

// Probe via File.read(): succeeds for regular files; IS_DIRECTORY for dirs;
// NOT_FOUND (and similar) when missing. Avoids file_test / query_exists.
function sidecarFilePresent(directoryPath) {
    try {
        const stream = Gio.File.new_for_path(getSidecarPath(directoryPath)).read(null);
        stream.close(null);
        return true;
    } catch (e) {
        const message = String(e);
        if (message.indexOf("IS_DIRECTORY") !== -1
            || message.indexOf("Is a directory") !== -1
            || message.indexOf("is a directory") !== -1) {
            return true;
        }
        return false;
    }
}

function readSidecar(directoryPath) {
    const defaults = {
        version: 1,
        order: [],
        disabled: [],
        folderClickMode: null,
        itemStyles: {}
    };

    const sidecarPath = getSidecarPath(directoryPath);

    try {
        const [, contents] = GLib.file_get_contents(sidecarPath);
        const parsed = JSON.parse(contents);
        if (Array.isArray(parsed.order)) {
            defaults.order = parsed.order;
        }
        if (Array.isArray(parsed.disabled)) {
            defaults.disabled = parsed.disabled;
        }
        if (parsed.folderClickMode) {
            defaults.folderClickMode = parsed.folderClickMode;
        }
        if (parsed.version) {
            defaults.version = parsed.version;
        }
        if (parsed.itemStyles && typeof parsed.itemStyles === "object") {
            defaults.itemStyles = parsed.itemStyles;
        }
    } catch (e) {
        // Missing or unreadable sidecar — use defaults.
    }

    return defaults;
}

function writeSidecar(directoryPath, sidecar) {
    const sidecarPath = getSidecarPath(directoryPath);
    const payload = {
        version: sidecar.version || 1,
        order: Array.isArray(sidecar.order) ? sidecar.order : [],
        disabled: Array.isArray(sidecar.disabled) ? sidecar.disabled : []
    };

    if (sidecar.folderClickMode) {
        payload.folderClickMode = sidecar.folderClickMode;
    }

    if (sidecar.itemStyles && typeof sidecar.itemStyles === "object"
        && Object.keys(sidecar.itemStyles).length > 0) {
        payload.itemStyles = sidecar.itemStyles;
    }

    try {
        GLib.file_set_contents(
            sidecarPath,
            JSON.stringify(payload, null, 2)
        );
        return true;
    } catch (e) {
        global.logError(e, "TheLauncher: failed to write .thelauncher.json");
        return false;
    }
}

function mergeOrder(existingOrder, itemIds) {
    const merged = [];
    const seen = {};

    (existingOrder || []).forEach(id => {
        if (itemIds.indexOf(id) !== -1 && !seen[id]) {
            merged.push(id);
            seen[id] = true;
        }
    });

    itemIds.forEach(id => {
        if (!seen[id]) {
            merged.push(id);
            seen[id] = true;
        }
    });

    return merged;
}

function saveOrder(directoryPath, orderIds) {
    const sidecar = readSidecar(directoryPath);
    sidecar.order = orderIds;
    return writeSidecar(directoryPath, sidecar);
}

function saveItemState(directoryPath, orderIds, disabledIds, itemStyles) {
    const sidecar = readSidecar(directoryPath);
    sidecar.order = orderIds;
    sidecar.disabled = disabledIds;
    if (itemStyles && typeof itemStyles === "object") {
        sidecar.itemStyles = itemStyles;
    }
    return writeSidecar(directoryPath, sidecar);
}

function getItemStyle(sidecar, itemId) {
    if (!sidecar || !sidecar.itemStyles || !itemId) {
        return { icon: "folder-symbolic", bgColor: null, iconTint: null };
    }
    const style = sidecar.itemStyles[itemId] || {};
    return {
        icon: style.icon || "folder-symbolic",
        bgColor: style.bgColor || null,
        iconTint: style.iconTint || null
    };
}

function persistOrderFromItems(directoryPath, items) {
    if (!sidecarFilePresent(directoryPath)) {
        return ensureSidecarForDirectory(directoryPath, items);
    }

    const sidecar = readSidecar(directoryPath);
    const itemIds = items.map(item => item.id);
    const merged = mergeOrder(sidecar.order, itemIds);

    if (merged.length === sidecar.order.length
        && merged.every((id, index) => id === sidecar.order[index])) {
        return sidecar;
    }

    sidecar.order = merged;
    writeSidecar(directoryPath, sidecar);
    return sidecar;
}

function ensureSidecarForDirectory(directoryPath, items) {
    const scannedItems = items || [];

    if (!sidecarFilePresent(directoryPath)) {
        const itemIds = scannedItems.map(item => item.id);
        const disabledIds = scannedItems
            .filter(item => item.enabled === false)
            .map(item => item.id);

        writeSidecar(directoryPath, {
            version: 1,
            order: itemIds,
            disabled: disabledIds
        });
        return readSidecar(directoryPath);
    }

    return persistOrderFromItems(directoryPath, scannedItems);
}

function getEntryType(entry) {
    if (!entry) {
        return "app";
    }

    if (entry.id && String(entry.id).indexOf("folder:") === 0) {
        return "folder";
    }

    if (entry.id && String(entry.id).indexOf("document:") === 0) {
        return "document";
    }

    if (entry["type-icon"] === "folder-symbolic") {
        return "folder";
    }

    if (entry["type-icon"] === "x-office-document-symbolic") {
        return "document";
    }

    return "app";
}

function resolveOrderEntryId(entry) {
    if (!entry) {
        return null;
    }

    if (entry.id) {
        return entry.id;
    }

    const shortId = entry["id-short"];
    if (!shortId) {
        return null;
    }

    if (String(shortId).indexOf(":") > 0) {
        return shortId;
    }

    return getEntryType(entry) === "folder"
        ? "folder:" + shortId
        : getEntryType(entry) === "document"
            ? "document:" + shortId
            : "app:" + shortId;
}

function itemsToOrderList(items) {
    return items.map(item => {
        const id = item.id;
        const shortId = id && id.indexOf(":") >= 0
            ? id.substring(id.indexOf(":") + 1)
            : id;

        return {
            "id-short": shortId || id,
            name: item.name,
            enabled: item.enabled !== false,
            "type-icon": item.type === "folder"
                ? "folder-symbolic"
                : item.type === "document"
                    ? "x-office-document-symbolic"
                    : "application-x-executable-symbolic"
        };
    });
}

function orderListToItemStyles(list) {
    return null;
}

function orderListToDisabledIds(list) {
    if (!Array.isArray(list)) {
        return [];
    }

    return list
        .filter(entry => entry && resolveOrderEntryId(entry) && entry.enabled === false)
        .map(entry => resolveOrderEntryId(entry));
}

function orderListToIds(list) {
    if (!Array.isArray(list)) {
        return [];
    }

    return list.map(entry => resolveOrderEntryId(entry)).filter(id => !!id);
}

function isDisabled(sidecar, itemId) {
    return sidecar.disabled.indexOf(itemId) !== -1;
}

function getFolderClickMode(sidecar, instanceMode) {
    if (sidecar.folderClickMode === "navigate" || sidecar.folderClickMode === "open-file-manager") {
        return sidecar.folderClickMode;
    }
    return instanceMode;
}

