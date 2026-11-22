// Parsing of FRITZ!Box AHA-HTTP XML replies (pure JS, testable with plain gjs).

// ETSI unit types of the FRITZ!Smart Energy 250 sub-units.
// Own modules, see desklet.js.
const Me = imports.ui.extension.getCurrentExtension
    ? imports.ui.extension.getCurrentExtension().imports : null;
const I18n = Me ? Me.i18n : require('./i18n');
const _ = I18n._;

const UNIT_IMPORT = 65281;   // consumption (Bezug)
const UNIT_EXPORT = 65284;   // feed-in (Einspeisung)

function unescapeXml(s) {
    return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

// Content of the first <tag>…</tag> (no nesting), or null.
function tag(xml, name) {
    if (!xml)
        return null;
    let m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
    return m ? unescapeXml(m[1]) : null;
}

// Inner XML of the first <tag>…</tag> section, or null.
function section(xml, name) {
    if (!xml)
        return null;
    let m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
    return m ? m[1] : null;
}

function attr(attrs, name) {
    let m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
    return m ? unescapeXml(m[1]) : null;
}

function num(value) {
    if (value === null || value === undefined || value.trim() === "")
        return null;
    let n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function normalizeAin(ain) {
    return String(ain).replace(/\s+/g, "");
}

function parseSessionInfo(xml) {
    let rights = [];
    let rightsXml = section(xml, "Rights") || "";
    let re = /<Name>([^<]*)<\/Name>/g, m;
    while ((m = re.exec(rightsXml)) !== null)
        rights.push(m[1]);
    return {
        sid: tag(xml, "SID"),
        challenge: tag(xml, "Challenge"),
        blockTime: num(tag(xml, "BlockTime")) || 0,
        rights: rights,
    };
}

// Thermostat temperature: 0.5 °C steps (16..56 = 8..28 °C), 253 = off, 254 = on.
function hkrTemp(value) {
    let n = num(value);
    if (n === null || n === 255)
        return { celsius: null, state: null };
    if (n === 253)
        return { celsius: null, state: "off" };
    if (n === 254)
        return { celsius: null, state: "on" };
    return { celsius: n / 2, state: null };
}

function parseHkr(hkr) {
    let target = hkrTemp(tag(hkr, "tsoll"));
    return {
        current: hkrTemp(tag(hkr, "tist")).celsius,  // measured at the radiator
        target: target.celsius,
        targetState: target.state,
        lock: tag(hkr, "lock") === "1",
        boostActive: tag(hkr, "boostactive") === "1",
        boostEnd: num(tag(hkr, "boostactiveendtime")) || 0,          // unix seconds
        windowOpenActive: tag(hkr, "windowopenactiv") === "1",
        windowOpenEnd: num(tag(hkr, "windowopenactiveendtime")) || 0, // unix seconds
    };
}

function kindOf(isGroup, body, unitType) {
    if (unitType === UNIT_IMPORT)
        return "import";
    if (unitType === UNIT_EXPORT)
        return "export";
    if (section(body, "hkr") !== null)
        return isGroup ? "group" : "hkr";
    if (section(body, "switch") !== null)
        return "plug";
    if (section(body, "temperature") !== null)
        return "sensor";
    return "other";
}

function parseElement(isGroup, attrs, body) {
    let hkrXml = section(body, "hkr");
    // Battery tags of thermostats also appear inside <hkr>; read the device-level ones.
    let outer = hkrXml !== null ? body.replace(/<hkr>[\s\S]*?<\/hkr>/, "") : body;
    let sw = section(body, "switch");
    let pm = section(body, "powermeter");
    let temp = section(body, "temperature");
    let hum = section(body, "humidity");
    let onoff = section(body, "simpleonoff");
    let etsi = section(body, "etsiunitinfo");
    let groupinfo = section(body, "groupinfo");
    let unitType = etsi !== null ? num(tag(etsi, "unittype")) : null;

    let switchState = sw !== null ? tag(sw, "state") : (onoff !== null ? tag(onoff, "state") : null);
    let power = pm !== null ? num(tag(pm, "power")) : null;
    let energy = pm !== null ? num(tag(pm, "energy")) : null;
    let celsius = temp !== null ? num(tag(temp, "celsius")) : null;
    let hkr = hkrXml !== null ? parseHkr(hkrXml) : null;

    return {
        ain: attr(attrs, "identifier") || "",
        id: attr(attrs, "id") || "",
        kind: kindOf(isGroup, body, unitType),
        product: attr(attrs, "productname") || "",
        functionBitmask: num(attr(attrs, "functionbitmask")) || 0,
        name: tag(body, "name") || attr(attrs, "identifier") || "?",
        present: tag(body, "present") === "1",
        on: switchState === "1" ? true : (switchState === "0" ? false : null),
        lock: (sw !== null && tag(sw, "lock") === "1") || (hkr !== null && hkr.lock),
        powerW: power !== null ? power / 1000 : null,      // mW -> W
        energyKWh: energy !== null ? energy / 1000 : null, // Wh -> kWh
        celsius: celsius !== null ? celsius / 10 : null,   // room temperature, offset already applied
        celsiusRange: null,                                // groups: { min, max } when members differ
        humidity: hum !== null ? num(tag(hum, "rel_humidity")) : null,
        battery: num(tag(outer, "battery")),
        batteryLow: tag(outer, "batterylow") === "1",
        hkr: hkr,
        parentId: etsi !== null ? tag(etsi, "etsideviceid") : null,
        memberIds: groupinfo !== null ? (tag(groupinfo, "members") || "").split(",").filter(s => s) : [],
        memberBatteries: null,                             // groups: [{ name, battery }]
    };
}

// Fill in what the box only reports elsewhere: Energy 250 units inherit the battery of
// their main device (which is then dropped), groups get room temperature and battery
// from their members.
function linkDevices(items) {
    let byId = new Map(items.map(d => [d.id, d]));
    let parents = new Set();
    for (let d of items) {
        if (d.parentId === null || !byId.has(d.parentId))
            continue;
        let parent = byId.get(d.parentId);
        parents.add(parent.id);
        if (d.battery === null)
            d.battery = parent.battery;
        d.batteryLow = d.batteryLow || parent.batteryLow;
        if (d.kind === "export")
            d.product = (parent.product || d.product) + " (" + _("feed-in") + ")";
        else if (d.kind === "import")
            d.product = (parent.product || d.product) + " (" + _("consumption") + ")";
    }

    for (let g of items) {
        if (g.kind !== "group")
            continue;
        let members = g.memberIds.map(id => byId.get(id)).filter(m => m);
        g.product = members.length ? I18n.formatText(_("Group: %s"), members.map(m => m.name).join(", ")) : _("Group");
        let temps = members.map(m => m.celsius).filter(t => t !== null);
        if (temps.length && g.celsius === null) {
            let min = Math.min(...temps), max = Math.max(...temps);
            g.celsius = Math.round(temps.reduce((a, b) => a + b, 0) / temps.length * 10) / 10;
            g.celsiusRange = max - min > 0.2 ? { min, max } : null;
        }
        g.memberBatteries = members.filter(m => m.battery !== null)
            .map(m => ({ name: m.name, battery: m.battery }));
        let batteries = members.map(m => m.battery).filter(b => b !== null);
        if (batteries.length)
            g.battery = Math.min(...batteries);
        g.batteryLow = members.some(m => m.batteryLow);
        g.present = members.length ? members.some(m => m.present) : g.present;
    }

    return items.filter(d => !parents.has(d.id));
}

// All devices and groups, in the order of the box. Group members stay in the list.
function parseDeviceList(xml) {
    let items = [];
    let re = /<(device|group)\s([^>]*)>([\s\S]*?)<\/\1>/g, m;
    while ((m = re.exec(xml)) !== null)
        items.push(parseElement(m[1] === "group", m[2], m[3]));
    return linkDevices(items);
}

// AINs of all devices that belong to a group (used to pre-select the group instead).
function groupMemberAins(devices) {
    let byId = new Map(devices.map(d => [d.id, d]));
    let ains = new Set();
    for (let g of devices.filter(d => d.kind === "group"))
        for (let id of g.memberIds)
            if (byId.has(id))
                ains.add(byId.get(id).ain);
    return ains;
}

function fmt(n, digits) {
    return I18n.num(n, digits);
}

function remainingText(endUnix, nowUnix) {
    let min = Math.max(0, Math.ceil((endUnix - nowUnix) / 60));
    return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

// Display strings for one device (simple text list until the tiles exist).
function describe(d, nowUnix) {
    if (nowUnix === undefined)
        nowUnix = Math.floor(Date.now() / 1000);
    if (!d.present)
        return { state: _("not connected"), on: null, values: "" };

    let values = [];
    let state = "";
    let on = null;

    if (d.on !== null && d.kind === "plug") {
        on = d.on;
        state = d.on ? _("on") : _("off");
    }
    if (d.celsius !== null) {
        values.push(d.celsiusRange
            ? `${fmt(d.celsius, 1)} °C (${fmt(d.celsiusRange.min, 1)} – ${fmt(d.celsiusRange.max, 1)})`
            : `${fmt(d.celsius, 1)} °C`);
    }
    if (d.hkr) {
        if (d.hkr.boostActive && d.hkr.boostEnd > nowUnix)
            state = I18n.formatText(_("Boost, %s left"), remainingText(d.hkr.boostEnd, nowUnix));
        else if (d.hkr.windowOpenActive && d.hkr.windowOpenEnd > nowUnix)
            state = I18n.formatText(_("Frost protection, %s left"), remainingText(d.hkr.windowOpenEnd, nowUnix));
        else if (d.hkr.target !== null)
            state = I18n.formatText(_("Target %s °C"), fmt(d.hkr.target, 1));
        else if (d.hkr.targetState)
            state = d.hkr.targetState === "off" ? _("off") : _("on");
    }
    if (d.humidity !== null)
        values.push(d.humidity + " %");
    if (d.kind === "export") {
        if (d.energyKWh !== null)
            values.push(I18n.formatText(_("Meter %s kWh"), fmt(d.energyKWh, 1)));
    } else if (d.powerW !== null) {
        values.push(fmt(d.powerW, d.powerW < 10 ? 1 : 0) + " W");
        if (d.kind === "import" && d.energyKWh !== null)
            values.push(I18n.formatText(_("Meter %s kWh"), fmt(d.energyKWh, 1)));
    }
    if (d.battery !== null)
        values.push(I18n.formatText(d.batteryLow ? _("Battery %s %% (low)") : _("Battery %s %%"), d.battery));
    return { state: state, on: on, values: values.join("  ·  ") };
}

// ---- Statistics (getbasicdevicestats) --------------------------------------

// One <stats> block: { grid (s), end (unix time of the newest value), values } with values
// oldest -> newest (the box lists the newest first; "-" = no value -> null).
function parseStats(attrs, body, scale) {
    let grid = num(attr(attrs, "grid")) || 0;
    let end = num(attr(attrs, "datatime")) || 0;
    let values = body.split(",").map(v => {
        let n = num(v);
        return n === null ? null : n * scale;
    }).reverse();
    return { grid, end, values };
}

function statsBlocks(xml, name, scale) {
    let inner = section(xml, name);
    if (inner === null)
        return [];
    let blocks = [], re = /<stats\s([^>]*)>([^<]*)<\/stats>/g, m;
    while ((m = re.exec(inner)) !== null)
        blocks.push(parseStats(m[1], m[2], scale));
    return blocks;
}

// Units as displayed: power W (box: 0.01 W!), voltage V (mV), temperature °C (0.1 °C),
// humidity %, energy kWh (Wh). Missing series are null.
function parseDeviceStats(xml) {
    let energy = statsBlocks(xml, "energy", 0.001);
    let pick = blocks => (blocks.length ? blocks[0] : null);
    let stats = {
        power: pick(statsBlocks(xml, "power", 0.01)),
        voltage: pick(statsBlocks(xml, "voltage", 0.001)),
        temperature: pick(statsBlocks(xml, "temperature", 0.1)),
        humidity: pick(statsBlocks(xml, "humidity", 1)),
        energyDays: energy.find(b => b.grid === 86400) || null,
        energyMonths: energy.find(b => b.grid > 86400) || null,
    };
    // The Energy 250 reports empty energy series (all 0) — treat them as missing.
    for (let key of ["energyDays", "energyMonths"])
        if (stats[key] && stats[key].values.every(v => !v))
            stats[key] = null;
    return stats;
}
