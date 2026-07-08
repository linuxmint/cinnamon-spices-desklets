const GLib = imports.gi.GLib;

const ENABLED_DESKLETS_KEY = "enabled-desklets";
const DESKLET_SNAP_KEY = "desklet-snap";
const DESKLET_SNAP_INTERVAL_KEY = "desklet-snap-interval";
const LOCK_DESKLETS_KEY = "lock-desklets";

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

    entry.elements[2] = String(snapped.x);
    entry.elements[3] = String(snapped.y);
    entry.list[entry.index] = entry.elements.join(":");

    global.settings.set_strv(ENABLED_DESKLETS_KEY, entry.list);
    return snapped;
}

function isDragLocked(instanceLock) {
    if (instanceLock) {
        return true;
    }
    return global.settings.get_boolean(LOCK_DESKLETS_KEY);
}

if (typeof module !== "undefined") {
    module.exports = {
        ENABLED_DESKLETS_KEY,
        LOCK_DESKLETS_KEY,
        snapCoordinates,
        readGSettingsPosition,
        writeGSettingsPosition,
        isDragLocked
    };
}
