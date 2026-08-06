/**
 * PowerPulse device model, sorting and display helpers.
 * Provider-agnostic — new backends only fill createDevice() fields.
 */

const DeviceType = {
    UNKNOWN: "unknown",
    BATTERY: "battery",
    KEYBOARD: "keyboard",
    MOUSE: "mouse",
    HEADSET: "headset",
    SPEAKERS: "speakers",
    GAMING_INPUT: "gaming-input",
    PHONE: "phone",
    TABLET: "tablet",
    COMPUTER: "computer",
    TOUCHPAD: "touchpad",
    UPS: "ups",
    STYLUS: "stylus",
    OTHER: "other"
};

const DeviceState = {
    UNKNOWN: "unknown",
    CHARGING: "charging",
    DISCHARGING: "discharging",
    EMPTY: "empty",
    FULLY_CHARGED: "fully-charged",
    PENDING_CHARGE: "pending-charge",
    PENDING_DISCHARGE: "pending-discharge",
    AVAILABLE: "available",
    UNAVAILABLE: "unavailable",
    DISCONNECTED: "disconnected"
};

const Transport = {
    UNKNOWN: "unknown",
    BATTERY: "internal",
    USB: "usb",
    BLUETOOTH: "bluetooth",
    WIRELESS: "wireless"
};

const SortMode = {
    BATTERY_ASC: "battery-asc",
    BATTERY_DESC: "battery-desc",
    NAME: "name",
    TYPE: "type",
    UPDATED: "updated",
    MANUAL: "manual"
};

const FRESHNESS = {
    SOFT_SECONDS: 6 * 3600,
    HARD_SECONDS: 24 * 3600,
    FRESH: "fresh",
    SOFT: "soft",
    HARD: "hard"
};

const UPOWER_TYPE_MAP = {
    1: DeviceType.OTHER, // line-power — filtered out separately
    2: DeviceType.BATTERY,
    3: DeviceType.UPS,
    4: DeviceType.OTHER, // monitor
    5: DeviceType.MOUSE,
    6: DeviceType.KEYBOARD,
    7: DeviceType.OTHER, // pda
    8: DeviceType.PHONE,
    9: DeviceType.OTHER, // media-player
    10: DeviceType.TABLET,
    11: DeviceType.COMPUTER,
    12: DeviceType.GAMING_INPUT,
    13: DeviceType.STYLUS,
    14: DeviceType.TOUCHPAD,
    15: DeviceType.OTHER, // modem
    16: DeviceType.OTHER, // network
    17: DeviceType.HEADSET,
    18: DeviceType.SPEAKERS,
    19: DeviceType.HEADSET,
    20: DeviceType.OTHER, // video
    21: DeviceType.SPEAKERS, // other-audio
    22: DeviceType.OTHER, // remote-control
    23: DeviceType.OTHER, // printer
    24: DeviceType.OTHER, // scanner
    25: DeviceType.OTHER, // camera
    26: DeviceType.OTHER, // wearable
    27: DeviceType.OTHER, // toy
    28: DeviceType.OTHER  // bluetooth-generic
};

/** UPower line-power adapters never carry a battery percentage we care about. */
const UPOWER_LINE_POWER = 1;

const UPOWER_STATE_MAP = {
    0: DeviceState.UNKNOWN,
    1: DeviceState.CHARGING,
    2: DeviceState.DISCHARGING,
    3: DeviceState.EMPTY,
    4: DeviceState.FULLY_CHARGED,
    5: DeviceState.PENDING_CHARGE,
    6: DeviceState.PENDING_DISCHARGE
};

/**
 * Types we always consider battery-bearing when UPower exposes them.
 * Unknown / unmapped codes still appear if they report a percentage.
 */
const TRACKED_TYPES = {
    [DeviceType.BATTERY]: true,
    [DeviceType.KEYBOARD]: true,
    [DeviceType.MOUSE]: true,
    [DeviceType.HEADSET]: true,
    [DeviceType.SPEAKERS]: true,
    [DeviceType.GAMING_INPUT]: true,
    [DeviceType.PHONE]: true,
    [DeviceType.UPS]: true,
    [DeviceType.STYLUS]: true,
    [DeviceType.TABLET]: true,
    [DeviceType.TOUCHPAD]: true,
    [DeviceType.COMPUTER]: true,
    [DeviceType.OTHER]: true
};

const TYPE_SORT_ORDER = {
    [DeviceType.BATTERY]: 0,
    [DeviceType.HEADSET]: 1,
    [DeviceType.SPEAKERS]: 2,
    [DeviceType.KEYBOARD]: 3,
    [DeviceType.MOUSE]: 4,
    [DeviceType.GAMING_INPUT]: 5,
    [DeviceType.PHONE]: 6,
    [DeviceType.UPS]: 7,
    [DeviceType.STYLUS]: 8,
    [DeviceType.TABLET]: 9,
    [DeviceType.TOUCHPAD]: 10,
    [DeviceType.COMPUTER]: 11,
    [DeviceType.OTHER]: 12,
    [DeviceType.UNKNOWN]: 13
};

function createDevice(partial) {
    const now = Date.now() / 1000;
    return Object.assign({
        id: "",
        source: "unknown",
        providerLabel: "Unknown",
        type: DeviceType.UNKNOWN,
        name: "Unknown",
        model: "",
        vendor: "",
        serial: "",
        percentage: null,
        state: DeviceState.UNKNOWN,
        present: false,
        rechargeable: false,
        connected: false,
        voltage: null,
        timeToEmpty: null,
        timeToFull: null,
        warningLevel: 0,
        updated: now,
        path: "",
        iconName: "battery-symbolic",
        freshness: FRESHNESS.FRESH,
        ageSeconds: 0,
        stale: false,
        transport: Transport.UNKNOWN,
        // Laptop / UPS health (optional)
        capacity: null,
        energyFull: null,
        energyFullDesign: null,
        cycleCount: null,
        mac: "",
        raw: null
    }, partial || {});
}

function mapUpowerType(typeCode) {
    if (UPOWER_TYPE_MAP[typeCode] !== undefined) {
        return UPOWER_TYPE_MAP[typeCode];
    }
    return DeviceType.OTHER;
}

function mapUpowerState(stateCode) {
    return UPOWER_STATE_MAP[stateCode] || DeviceState.UNKNOWN;
}

function isTrackedType(type) {
    return !!TRACKED_TYPES[type];
}

/** True for AC adapters and similar non-battery UPower nodes. */
function isUpowerLinePower(typeCode) {
    return Number(typeCode) === UPOWER_LINE_POWER;
}

/**
 * Infer device kind from the UPower object-path basename.
 * Examples:
 *   .../devices/speakers_dev_41_67_...  → speakers
 *   .../devices/mouse_dev_CC_94_...     → mouse
 *   .../devices/keyboard_dev_D2_5D_...  → keyboard
 *   .../devices/battery_BAT0            → battery
 */
function inferTypeFromUpowerPath(objectPath) {
    if (!objectPath) {
        return null;
    }
    const base = String(objectPath).split("/").pop() || "";
    if (!base || /^DisplayDevice$/i.test(base)) {
        return null;
    }
    if (/^line_power_/i.test(base)) {
        return null;
    }

    const rules = [
        [/^battery_/i, DeviceType.BATTERY],
        [/^keyboard_/i, DeviceType.KEYBOARD],
        [/^mouse_/i, DeviceType.MOUSE],
        [/^headset_/i, DeviceType.HEADSET],
        [/^headphones_/i, DeviceType.HEADSET],
        [/^speakers_/i, DeviceType.SPEAKERS],
        [/^gaming_input_/i, DeviceType.GAMING_INPUT],
        [/^phone_/i, DeviceType.PHONE],
        [/^tablet_/i, DeviceType.TABLET],
        [/^computer_/i, DeviceType.COMPUTER],
        [/^touchpad_/i, DeviceType.TOUCHPAD],
        [/^ups_/i, DeviceType.UPS],
        [/^pen_/i, DeviceType.STYLUS],
        [/^bluetooth_/i, DeviceType.OTHER],
        [/^media_player_/i, DeviceType.OTHER],
        [/^wearable_/i, DeviceType.OTHER],
        [/^camera_/i, DeviceType.OTHER],
        [/^remote_control_/i, DeviceType.OTHER]
    ];

    for (let i = 0; i < rules.length; i++) {
        if (rules[i][0].test(base)) {
            return rules[i][1];
        }
    }

    // Future-proof: "<kind>_…" → try known DeviceType values / sensible aliases.
    const kindMatch = base.match(/^([a-z][a-z0-9]*)_/i);
    if (kindMatch) {
        const kind = kindMatch[1].toLowerCase().replace(/-/g, "_");
        const aliases = {
            headphone: DeviceType.HEADSET,
            headphones: DeviceType.HEADSET,
            speaker: DeviceType.SPEAKERS,
            gaminginput: DeviceType.GAMING_INPUT,
            "gaming-input": DeviceType.GAMING_INPUT
        };
        if (aliases[kind]) {
            return aliases[kind];
        }
        if (Object.values(DeviceType).indexOf(kind) !== -1) {
            return kind;
        }
    }

    return DeviceType.OTHER;
}

/**
 * Resolve the best type: prefer a specific path-based kind when the D-Bus
 * Type enum is missing/unknown/OTHER; otherwise keep the mapped enum type.
 */
function resolveUpowerType(typeCode, objectPath) {
    const fromPath = inferTypeFromUpowerPath(objectPath);
    const fromCode = mapUpowerType(typeCode);

    if (fromPath && fromPath !== DeviceType.OTHER) {
        // Path prefix is the most reliable UI hint (speakers_/mouse_/…).
        return fromPath;
    }
    if (fromCode && fromCode !== DeviceType.OTHER) {
        return fromCode;
    }
    return fromPath || fromCode || DeviceType.OTHER;
}

function isUpowerDisplayDevice(objectPath) {
    return /\/DisplayDevice$/i.test(objectPath || "");
}

function isUpowerLinePowerPath(objectPath) {
    return /\/line_power_/i.test(objectPath || "");
}

/**
 * Decide whether a UPower node should appear in PowerPulse.
 * Rule: show anything with a battery percentage (except AC / DisplayDevice).
 */
function shouldIncludeUpowerDevice(typeCode, type, hasPercentage, present, objectPath) {
    if (isUpowerDisplayDevice(objectPath) || isUpowerLinePowerPath(objectPath)) {
        return false;
    }
    if (isUpowerLinePower(typeCode)) {
        return false;
    }
    if (hasPercentage) {
        return true;
    }
    if (type === DeviceType.BATTERY && present) {
        return true;
    }
    return false;
}

/** HeadsetControl entry that currently reports a usable battery level. */
function isLiveHeadsetControlDevice(device) {
    return !!(
        device &&
        device.source === "headsetcontrol" &&
        device.connected &&
        device.percentage !== null &&
        device.percentage !== undefined &&
        !isNaN(Number(device.percentage))
    );
}

/**
 * Prefer a live HeadsetControl reading over a UPower duplicate of the same
 * headset. Offline HC devices (e.g. a powered-off gaming headset) must not
 * hide unrelated UPower Bluetooth earbuds.
 */
function shouldSkipUpowerHeadset(device, devices) {
    if (!device || device.source === "headsetcontrol" || device.type !== DeviceType.HEADSET) {
        return false;
    }
    const upowerName = String(device.name || "").toLowerCase();
    const upowerModel = String(device.model || "").toLowerCase();
    for (let i = 0; i < (devices || []).length; i++) {
        const other = devices[i];
        if (!isLiveHeadsetControlDevice(other)) {
            continue;
        }
        const hcName = String(other.name || "").toLowerCase();
        const hcModel = String(other.model || "").toLowerCase();
        if ((upowerName && (upowerName === hcName || upowerName === hcModel)) ||
            (upowerModel && (upowerModel === hcName || upowerModel === hcModel)) ||
            (upowerName && hcName && upowerName.indexOf(hcName) !== -1) ||
            (hcName && upowerName && hcName.indexOf(upowerName) !== -1)) {
            return true;
        }
    }
    return false;
}

function levelClass(percentage, connected) {
    if (!connected || percentage === null || percentage === undefined || isNaN(percentage)) {
        return "powerpulse-level-disconnected";
    }
    if (percentage > 60) {
        return "powerpulse-level-high";
    }
    if (percentage > 30) {
        return "powerpulse-level-medium";
    }
    if (percentage >= 0) {
        return "powerpulse-level-low";
    }
    return "powerpulse-level-unknown";
}

function shortName(name, maxLen) {
    const limit = maxLen || 18;
    const text = (name || "").trim();
    if (text.length <= limit) {
        return text;
    }
    return text.slice(0, limit - 1) + "…";
}

function friendlyName(device, options) {
    if (!device) {
        return "Unknown";
    }
    const opts = options || {};

    // Only the system battery uses a configurable label instead of the OEM model.
    if (device.type === DeviceType.BATTERY) {
        const label = (opts.laptopName || "Laptop").toString().trim();
        return label || "Laptop";
    }

    // Prefer UPower "model" for display. Unmapped kinds fall back here naturally
    // (e.g. "HP Speaker 360") instead of a generic type label.
    let name = (device.model || device.name || "").toString();
    name = name.replace(/\s+/g, " ").trim();

    const replacements = [
        [/Logitech MX Keys.*/i, "MX Keys"],
        [/Razer Basilisk V3 Pro.*/i, "Basilisk V3 Pro"],
        [/Basilisk V3 Pro.*/i, "Basilisk V3 Pro"],
        [/Logitech G933.*/i, "Logitech G933"],
        [/Logitech G633\/G635\/G733\/G933\/G935.*/i, "Logitech G933"],
        [/Gaming Wireless Headset/i, ""],
        [/\(.*\)/, ""]
    ];

    for (let i = 0; i < replacements.length; i++) {
        name = name.replace(replacements[i][0], replacements[i][1]).trim();
    }

    if (!name) {
        name = device.name || device.type || "Device";
    }
    return name;
}

function iconForType(type) {
    switch (type) {
        case DeviceType.BATTERY:
            return "laptop-symbolic";
        case DeviceType.KEYBOARD:
            return "input-keyboard-symbolic";
        case DeviceType.MOUSE:
            return "input-mouse-symbolic";
        case DeviceType.HEADSET:
            return "audio-headset-symbolic";
        case DeviceType.SPEAKERS:
            return "audio-speakers-symbolic";
        case DeviceType.GAMING_INPUT:
            return "input-gaming-symbolic";
        case DeviceType.PHONE:
            return "phone-symbolic";
        case DeviceType.UPS:
            return "uninterruptible-power-supply-symbolic";
        case DeviceType.STYLUS:
            return "input-tablet-symbolic";
        case DeviceType.TABLET:
            return "input-tablet-symbolic";
        case DeviceType.TOUCHPAD:
            return "input-touchpad-symbolic";
        default:
            return "battery-symbolic";
    }
}

function stateStatusIcon(state) {
    switch (state) {
        case DeviceState.CHARGING:
            return "xsi-thunderbolt-symbolic";
        case DeviceState.PENDING_CHARGE:
        case DeviceState.FULLY_CHARGED:
            return "ac-adapter-symbolic";
        default:
            return null;
    }
}

/** Compact status glyph for the row (no long text). */
function statusIndicator(device, lowThreshold) {
    if (!device || !device.connected) {
        return null;
    }
    const threshold = lowThreshold !== undefined ? lowThreshold : 20;
    if (device.percentage !== null && device.percentage <= Math.max(5, threshold / 2)) {
        return { glyph: "🟥", kind: "critical" };
    }
    if (device.percentage !== null && device.percentage <= threshold) {
        return { glyph: "⚠", kind: "low" };
    }
    if (device.state === DeviceState.CHARGING) {
        return { glyph: "⚡", kind: "charging" };
    }
    if (device.state === DeviceState.PENDING_CHARGE || device.state === DeviceState.FULLY_CHARGED) {
        return { glyph: "🔌", kind: "plugged" };
    }
    return { glyph: "🔋", kind: "battery" };
}

function classifyFreshness(ageSeconds) {
    const age = Number(ageSeconds) || 0;
    if (age > FRESHNESS.HARD_SECONDS) {
        return FRESHNESS.HARD;
    }
    if (age > FRESHNESS.SOFT_SECONDS) {
        return FRESHNESS.SOFT;
    }
    return FRESHNESS.FRESH;
}

function markFreshness(device, nowSeconds) {
    if (!device) {
        return device;
    }
    if (device.source !== "upower") {
        device.freshness = FRESHNESS.FRESH;
        device.ageSeconds = 0;
        device.stale = false;
        return device;
    }
    const now = nowSeconds !== undefined ? nowSeconds : (Date.now() / 1000);
    const updated = Number(device.updated) || 0;
    const age = updated > 0 ? Math.max(0, now - updated) : 0;
    device.ageSeconds = age;
    device.freshness = classifyFreshness(age);
    device.stale = device.freshness !== FRESHNESS.FRESH;
    return device;
}

function markStale(device, _maxAge, nowSeconds) {
    return markFreshness(device, nowSeconds);
}

function parseManualOrder(raw) {
    if (!raw) {
        return [];
    }
    if (Array.isArray(raw)) {
        return raw.slice();
    }
    try {
        const parsed = JSON.parse(String(raw));
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (e) {
        return String(raw).split(",").map((s) => s.trim()).filter(Boolean);
    }
}

function sortDevices(devices, sortBy, nameOptions, manualOrder) {
    const list = (devices || []).slice();
    const mode = sortBy || SortMode.BATTERY_ASC;
    const opts = nameOptions || {};
    const order = parseManualOrder(manualOrder);
    const orderIndex = {};
    order.forEach((id, i) => {
        orderIndex[id] = i;
    });

    list.sort((a, b) => {
        if (mode === SortMode.MANUAL) {
            const ia = orderIndex[a.id] !== undefined ? orderIndex[a.id] : 9999;
            const ib = orderIndex[b.id] !== undefined ? orderIndex[b.id] : 9999;
            if (ia !== ib) {
                return ia - ib;
            }
        } else if (mode === SortMode.BATTERY_ASC || mode === SortMode.BATTERY_DESC || mode === "percentage") {
            const pa = a.connected && a.percentage !== null ? Number(a.percentage) : 999;
            const pb = b.connected && b.percentage !== null ? Number(b.percentage) : 999;
            if (pa !== pb) {
                return (mode === SortMode.BATTERY_DESC || mode === "percentage") ? (pb - pa) : (pa - pb);
            }
        } else if (mode === SortMode.NAME) {
            const na = friendlyName(a, opts).toLowerCase();
            const nb = friendlyName(b, opts).toLowerCase();
            if (na < nb) return -1;
            if (na > nb) return 1;
        } else if (mode === SortMode.UPDATED) {
            const ua = Number(a.updated) || 0;
            const ub = Number(b.updated) || 0;
            if (ub !== ua) {
                return ub - ua;
            }
        } else {
            const ta = TYPE_SORT_ORDER[a.type] !== undefined ? TYPE_SORT_ORDER[a.type] : 99;
            const tb = TYPE_SORT_ORDER[b.type] !== undefined ? TYPE_SORT_ORDER[b.type] : 99;
            if (ta !== tb) {
                return ta - tb;
            }
        }
        return friendlyName(a, opts).localeCompare(friendlyName(b, opts));
    });

    return list;
}

function guessTransport(nativePath, path, serial) {
    const blob = ((nativePath || "") + " " + (path || "") + " " + (serial || "")).toLowerCase();
    if (blob.indexOf("bluetooth") !== -1 || /_[0-9a-f]{2}(_[0-9a-f]{2}){4}/i.test(path || "")) {
        return Transport.BLUETOOTH;
    }
    if (blob.indexOf("usb") !== -1 || blob.indexOf("hidraw") !== -1) {
        return Transport.USB;
    }
    if (blob.indexOf("battery") !== -1 || blob.indexOf("bat") !== -1) {
        return Transport.BATTERY;
    }
    return Transport.WIRELESS;
}

function extractMac(path, serial) {
    if (serial && /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(serial)) {
        return serial;
    }
    const fromPath = (path || "").match(/([0-9A-Fa-f]{2}(?:_[0-9A-Fa-f]{2}){5})/);
    if (fromPath) {
        return fromPath[1].replace(/_/g, ":");
    }
    return "";
}

function buildStats(devices, lowThreshold) {
    const list = devices || [];
    const threshold = lowThreshold !== undefined ? lowThreshold : 20;
    let charging = 0;
    let discharging = 0;
    let low = 0;
    const providers = {};

    list.forEach((d) => {
        if (d.providerLabel) {
            providers[d.providerLabel] = true;
        }
        if (!d.connected) {
            return;
        }
        if (d.state === DeviceState.CHARGING || d.state === DeviceState.PENDING_CHARGE) {
            charging += 1;
        }
        if (d.state === DeviceState.DISCHARGING || d.state === DeviceState.PENDING_DISCHARGE || d.state === DeviceState.AVAILABLE) {
            discharging += 1;
        }
        if (d.percentage !== null && d.percentage <= threshold) {
            low += 1;
        }
    });

    return {
        count: list.length,
        charging: charging,
        discharging: discharging,
        low: low,
        providers: Object.keys(providers)
    };
}

module.exports = {
    DeviceType,
    DeviceState,
    Transport,
    SortMode,
    FRESHNESS,
    TRACKED_TYPES,
    TYPE_SORT_ORDER,
    createDevice,
    mapUpowerType,
    mapUpowerState,
    isTrackedType,
    levelClass,
    shortName,
    friendlyName,
    iconForType,
    stateStatusIcon,
    statusIndicator,
    classifyFreshness,
    markFreshness,
    markStale,
    parseManualOrder,
    sortDevices,
    guessTransport,
    extractMac,
    buildStats,
    isUpowerLinePower,
    shouldIncludeUpowerDevice,
    isLiveHeadsetControlDevice,
    shouldSkipUpowerHeadset,
    inferTypeFromUpowerPath,
    resolveUpowerType,
    isUpowerDisplayDevice,
    isUpowerLinePowerPath,
    UPOWER_LINE_POWER
};
