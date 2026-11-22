// Keeps the "device-list" setting (the table on the "Devices" settings page) in sync
// with the devices the FRITZ!Box reports. Pure JS, testable with plain gjs.
//
// Row format (columns in settings-schema.json):
//   { show, big, boost, frost, name, type, ain }

// Own modules, see desklet.js.
const Me = imports.ui.extension.getCurrentExtension
    ? imports.ui.extension.getCurrentExtension().imports : null;
const I18n = Me ? Me.i18n : require('./i18n');
const _ = I18n._;

const NOT_FOUND = _("not found");
const DEFAULT_BOOST_MIN = 30;
const DEFAULT_FROST_MIN = 10;

function isThermostat(d) {
    return d.kind === "hkr" || d.kind === "group";
}

function newRow(d, show) {
    return {
        show: show,
        big: false,
        boost: isThermostat(d) ? DEFAULT_BOOST_MIN : 0,
        frost: isThermostat(d) ? DEFAULT_FROST_MIN : 0,
        name: d.name,
        type: d.product,
        ain: d.ain,
    };
}

// rows:     current setting value (array, may be empty or invalid)
// devices:  result of FritzXml.parseDeviceList()
// options:  { groupMembers: Set of AINs that belong to a group }
// Returns a new array; existing rows keep position, ticks and minutes.
function mergeRows(rows, devices, options) {
    options = options || {};
    let current = Array.isArray(rows) ? rows.filter(r => r && typeof r.ain === "string") : [];
    let byAin = new Map(devices.map(d => [d.ain, d]));
    let firstFill = current.length === 0;
    let members = options.groupMembers || new Set();

    let result = current.map(r => {
        let d = byAin.get(r.ain);
        if (!d)
            return Object.assign({}, r, { type: NOT_FOUND });
        return Object.assign({}, r, { name: d.name, type: d.product });
    });

    let known = new Set(current.map(r => r.ain));
    for (let d of devices) {
        if (known.has(d.ain))
            continue;
        // First fill: show everything except devices already covered by their group.
        // Devices that turn up later start hidden.
        result.push(newRow(d, firstFill && !members.has(d.ain)));
    }
    return result;
}

function sameRows(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

// Devices to display, in the order of the rows.
function visibleDevices(rows, devices) {
    let byAin = new Map(devices.map(d => [d.ain, d]));
    return (Array.isArray(rows) ? rows : [])
        .filter(r => r && r.show && byAin.has(r.ain))
        .map(r => ({ device: byAin.get(r.ain), row: r }));
}
