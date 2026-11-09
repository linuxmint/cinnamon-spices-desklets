// SPDX-License-Identifier: GPL-3.0-only AND MIT
// Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik
// Portions copyright (c) MHK924 (TheLauncher), MIT - see THIRD-PARTY-NOTICES.md

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

// Eigener Name seit aVinceLaunch. Die Datei aus TheLauncher-Zeiten wird
// weiterhin GELESEN, damit vorhandene Reihenfolgen erhalten bleiben.
// Geschrieben wird immer die neue Datei; die alte bleibt unveraendert liegen.
const SIDECAR_NAME = ".avincelaunch.json";
const LEGACY_SIDECAR_NAME = ".thelauncher.json";

// AP10b-1: Portale sind reine Ansicht. Die Pruefung liegt in pathSource.js;
// sie wird erst beim Schreiben geholt, damit die Lade-Reihenfolge der
// Bibliotheken keine Rolle spielt. Ausserhalb von Cinnamon (Tests) gibt es
// kein Portal-Verzeichnis - dann gilt nichts als Portal.
function isPortalPath(directoryPath) {
    try {
        return imports.desklets["avincelaunch-desklet@avince"].lib.pathSource
            .isReadOnlyPath(directoryPath);
    } catch (e) {
        return false;
    }
}

function getSidecarPath(directoryPath) {
    return GLib.build_filenamev([directoryPath, SIDECAR_NAME]);
}

function getLegacySidecarPath(directoryPath) {
    return GLib.build_filenamev([directoryPath, LEGACY_SIDECAR_NAME]);
}

// Probe via File.read(): succeeds for regular files; IS_DIRECTORY for dirs;
// NOT_FOUND (and similar) when missing. Avoids file_test / query_exists.
function filePresent(path) {
    try {
        const stream = Gio.File.new_for_path(path).read(null);
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

// Gilt als vorhanden, sobald eine der beiden Dateien existiert. Sonst wuerde
// in einem bereits geordneten Verzeichnis die Reihenfolge neu erfunden.
function sidecarFilePresent(directoryPath) {
    return filePresent(getSidecarPath(directoryPath))
        || filePresent(getLegacySidecarPath(directoryPath));
}

// Felder, die readSidecar/writeSidecar selbst verwalten. Alle anderen
// werden unveraendert mitgeschrieben (AP18-3) - so gehen Felder neuerer
// Fassungen bei aelteren Schreibern nicht verloren.
const KNOWN_FIELDS = ["version", "order", "disabled", "folderClickMode", "itemStyles", "pinned",
    "missingSince"];

function readSidecar(directoryPath) {
    const defaults = {
        version: 1,
        order: [],
        disabled: [],
        folderClickMode: null,
        itemStyles: {},
        pinned: [],
        missingSince: {},
        extra: {}
    };

    // Rueckfallregel: zuerst die eigene Datei, sonst die aus TheLauncher-Zeiten.
    // Pruefung Phase 2, A3 (P4): Ist die eigene Datei kaputt, wird sie
    // gesichert und gemeldet und die alte Datei gelesen, falls lesbar.
    // defaults.broken = true zeigt das an; writeSidecar schreibt dann nicht
    // (sidecarSourceBroken).
    // Pruefung Phase 3 Teil 2 (T13): Fehlt die eigene Datei, liegt aber eine
    // Kopie .avincelaunch.json.broken-* daneben, wurde die kaputte Datei
    // entfernt - dann beginnt der Ordner neu, statt still die aeltere
    // .thelauncher.json (Stand vor der Umbenennung) zu uebernehmen.
    const SafeJson = _safeJson();
    let parsed = null;
    [getSidecarPath(directoryPath), getLegacySidecarPath(directoryPath)].some((path, index) => {
        const info = SafeJson.readJson(path);
        if (info.state === SafeJson.STATE_OK) {
            parsed = info.data;
            return true;
        }
        if (info.state === SafeJson.STATE_BROKEN) {
            SafeJson.secureBroken(path, info);
            defaults.broken = true;
        }
        return index === 0 && info.state === SafeJson.STATE_MISSING && SafeJson.hasBrokenCopy(path);
    });

    if (parsed) {
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
        if (Array.isArray(parsed.pinned)) {
            defaults.pinned = parsed.pinned;
        }
        if (parsed.missingSince && typeof parsed.missingSince === "object"
            && !Array.isArray(parsed.missingSince)) {
            defaults.missingSince = parsed.missingSince;
        }
        Object.keys(parsed).forEach(key => {
            if (KNOWN_FIELDS.indexOf(key) === -1) {
                defaults.extra[key] = parsed[key];
            }
        });
    }

    return defaults;
}

function _safeJson() {
    return imports.desklets["avincelaunch-desklet@avince"].lib.safeJson;
}

// A3 (P4): Die Datei, die readSidecar zuerst nimmt, ist kaputt - dann wird
// nichts geschrieben, bis sie repariert oder entfernt ist. Fehlt die eigene
// Datei und ist die alte kaputt, gilt dasselbe (sonst waere die alte fuer
// immer verdeckt).
function sidecarSourceBroken(directoryPath) {
    const SafeJson = _safeJson();
    const own = SafeJson.readJson(getSidecarPath(directoryPath));
    if (own.state === SafeJson.STATE_BROKEN) {
        SafeJson.secureBroken(getSidecarPath(directoryPath), own);
        return true;
    }
    // Teil 2 (T13): entfernte kaputte Datei -> neu beginnen, die alte zaehlt nicht.
    if (own.state === SafeJson.STATE_MISSING && !SafeJson.hasBrokenCopy(getSidecarPath(directoryPath))) {
        const legacy = SafeJson.readJson(getLegacySidecarPath(directoryPath));
        if (legacy.state === SafeJson.STATE_BROKEN) {
            SafeJson.secureBroken(getLegacySidecarPath(directoryPath), legacy);
            return true;
        }
    }
    return false;
}

function writeSidecar(directoryPath, sidecar) {
    if (isPortalPath(directoryPath)) {
        imports.desklets["avincelaunch-desklet@avince"].lib.pathSource
            .logRefusedWrite(directoryPath, "Sidecar schreiben");
        return false;
    }
    if (sidecarSourceBroken(directoryPath)) {
        return false;
    }
    const sidecarPath = getSidecarPath(directoryPath);
    const payload = Object.assign({}, sidecar.extra || {}, {
        version: sidecar.version || 1,
        order: Array.isArray(sidecar.order) ? sidecar.order : [],
        disabled: Array.isArray(sidecar.disabled) ? sidecar.disabled : []
    });

    if (sidecar.folderClickMode) {
        payload.folderClickMode = sidecar.folderClickMode;
    }

    if (sidecar.itemStyles && typeof sidecar.itemStyles === "object"
        && Object.keys(sidecar.itemStyles).length > 0) {
        payload.itemStyles = sidecar.itemStyles;
    }

    if (Array.isArray(sidecar.pinned) && sidecar.pinned.length > 0) {
        payload.pinned = sidecar.pinned;
    }

    if (sidecar.missingSince && typeof sidecar.missingSince === "object"
        && Object.keys(sidecar.missingSince).length > 0) {
        payload.missingSince = sidecar.missingSince;
    }

    try {
        GLib.file_set_contents(
            sidecarPath,
            JSON.stringify(payload, null, 2)
        );
        return true;
    } catch (e) {
        global.logError(e, "aVinceLaunch: .avincelaunch.json konnte nicht geschrieben werden");
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

// --- Fehlende Eintraege behalten ihren Platz (Pruefung Phase 2, B10/P25) ----
// Fehlte eine Datei beim Einlesen kurz (Paket-Update ersetzt sie, von Hand
// verschoben und zurueckgeholt), flog ihre ID aus "order"; kam sie zurueck,
// stand sie am Ende. Jetzt bleibt die ID an ihrem Platz, "missingSince"
// merkt sich seit wann (Sekunden); nach 30 Tagen wird sie gestrichen. Haken
// ("disabled") und Ordnerstil fehlender Eintraege bleiben ebenso. Angezeigt
// wird nur, was da ist (applyOrdering uebergeht fehlende IDs).
// Gleiche Regel in orderFolderEditor.py (keep_missing_entries).
var MISSING_KEEP_SECONDS = 30 * 24 * 60 * 60;
let _nowForTests = null;

function _nowSeconds() {
    return _nowForTests !== null ? _nowForTests : Math.floor(GLib.get_real_time() / 1000000);
}

function _setNowForTests(seconds) {
    _nowForTests = seconds === undefined ? null : seconds;
}

// oldOrder: gespeicherte Reihenfolge; newOrder: neue Reihenfolge der
// vorhandenen Eintraege; liefert { order, missingSince, kept } - kept = IDs,
// die fehlen, aber ihren Platz behalten.
function keepMissingEntries(oldOrder, newOrder, missingSince) {
    const now = _nowSeconds();
    const order = (newOrder || []).slice();
    const inNew = {};
    order.forEach(id => { inNew[id] = true; });
    const since = {};
    const kept = [];
    const old = Array.isArray(oldOrder) ? oldOrder : [];
    old.forEach((id, index) => {
        if (inNew[id]) {
            return;
        }
        const first = missingSince && Number.isFinite(Number(missingSince[id]))
            ? Number(missingSince[id]) : now;
        if (now - first > MISSING_KEEP_SECONDS) {
            return;
        }
        // Hinter den naechsten Vorgaenger aus der alten Reihenfolge, der noch
        // in der neuen steht (sonst an den Anfang).
        let position = 0;
        for (let i = index - 1; i >= 0; i--) {
            const at = order.indexOf(old[i]);
            if (at !== -1) {
                position = at + 1;
                break;
            }
        }
        order.splice(position, 0, id);
        inNew[id] = true;
        since[id] = first;
        kept.push(id);
    });
    return { order: order, missingSince: since, kept: kept };
}

function _sameSince(a, b) {
    const keysA = Object.keys(a || {});
    const keysB = Object.keys(b || {});
    return keysA.length === keysB.length && keysA.every(key => (b || {})[key] === a[key]);
}

function saveOrder(directoryPath, orderIds) {
    const sidecar = readSidecar(directoryPath);
    const merged = keepMissingEntries(sidecar.order, orderIds, sidecar.missingSince);
    sidecar.order = merged.order;
    sidecar.missingSince = merged.missingSince;
    return writeSidecar(directoryPath, sidecar);
}

function saveItemState(directoryPath, orderIds, disabledIds, itemStyles) {
    const sidecar = readSidecar(directoryPath);
    const merged = keepMissingEntries(sidecar.order, orderIds, sidecar.missingSince);
    const disabled = (disabledIds || []).slice();
    merged.kept.forEach(id => {
        if (sidecar.disabled.indexOf(id) !== -1 && disabled.indexOf(id) === -1) {
            disabled.push(id);
        }
    });
    sidecar.order = merged.order;
    sidecar.missingSince = merged.missingSince;
    sidecar.disabled = disabled;
    if (itemStyles && typeof itemStyles === "object") {
        const styles = Object.assign({}, itemStyles);
        merged.kept.forEach(id => {
            if (sidecar.itemStyles[id] && !styles[id]) {
                styles[id] = sidecar.itemStyles[id];
            }
        });
        sidecar.itemStyles = styles;
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
    // B10: fehlende Eintraege behalten ihren Platz (siehe keepMissingEntries).
    const kept = keepMissingEntries(sidecar.order,
        mergeOrder(sidecar.order, itemIds), sidecar.missingSince);
    const merged = kept.order;

    if (merged.length === sidecar.order.length
        && merged.every((id, index) => id === sidecar.order[index])
        && _sameSince(kept.missingSince, sidecar.missingSince)) {
        return sidecar;
    }

    sidecar.order = merged;
    sidecar.missingSince = kept.missingSince;
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

function isPinned(sidecar, itemId) {
    return !!(sidecar && Array.isArray(sidecar.pinned) && sidecar.pinned.indexOf(itemId) !== -1);
}

// AP18-3: Anpinnen/Loesen. Liefert den neuen Zustand oder null bei Fehler.
function setPinned(directoryPath, itemId, pinned) {
    const sidecar = readSidecar(directoryPath);
    const index = sidecar.pinned.indexOf(itemId);
    if (pinned && index === -1) {
        sidecar.pinned.push(itemId);
    } else if (!pinned && index !== -1) {
        sidecar.pinned.splice(index, 1);
    } else {
        return pinned;
    }
    return writeSidecar(directoryPath, sidecar) ? pinned : null;
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

