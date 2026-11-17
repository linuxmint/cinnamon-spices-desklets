const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const ByteArray = imports.byteArray;

const UPOWER = "/var/lib/upower";
const GAP = 600;
const ORANGE = "#e8963a";
const GREEN = "#4cc27f";
const TRACK = 120;

function readText(path) {
    try {
        let [ok, bytes] = Gio.File.new_for_path(path).load_contents(null);
        return ok ? ByteArray.toString(bytes) : "";
    } catch (e) { return ""; }
}

const PS = "/sys/class/power_supply";

// First internal battery (type Battery, not a peripheral such as a mouse).
function findBattery() {
    try {
        let en = Gio.File.new_for_path(PS).enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
        let info, found = [];
        while ((info = en.next_file(null)) !== null) {
            let n = info.get_name();
            if (readText(PS + "/" + n + "/type").trim() === "Battery" &&
                readText(PS + "/" + n + "/scope").trim() !== "Device") found.push(n);
        }
        found.sort();
        return found.length ? found[0] : null;
    } catch (e) { return null; }
}

function newestHistory(kind) {
    let best = null, bestT = 0;
    try {
        let en = Gio.File.new_for_path(UPOWER).enumerate_children(
            "standard::name,time::modified", Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = en.next_file(null)) !== null) {
            let n = info.get_name();
            if (n.indexOf("history-" + kind + "-") !== 0 || n.indexOf("Wireless") >= 0 ||
                n.indexOf("generic_id") >= 0) continue;
            let t = info.get_attribute_uint64("time::modified");
            if (t > bestT) { bestT = t; best = UPOWER + "/" + n; }
        }
    } catch (e) {}
    return best;
}

function parse(path, since) {
    let rows = [];
    if (!path) return rows;
    readText(path).split("\n").forEach(function(line) {
        let p = line.trim().split(/\s+/);
        if (p.length !== 3) return;
        let t = parseInt(p[0]);
        if (t >= since) rows.push([t, parseFloat(p[1]), p[2]]);
    });
    return rows;
}

function sessions(days, fullWh) {
    let since = Math.floor(Date.now() / 1000) - days * 86400;
    let charge = parse(newestHistory("charge"), since);
    let rate = parse(newestHistory("rate"), since);
    let segs = [], cur = null;
    charge.forEach(function(r) {
        let t = r[0], pct = r[1], st = r[2];
        if (st !== "charging" && st !== "discharging") return;
        if (cur && cur.state === st && t - cur.end < GAP) { cur.end = t; cur.p1 = pct; }
        else {
            if (cur) segs.push(cur);
            cur = { state: st, start: t, end: t, p0: pct, p1: pct };
        }
    });
    if (cur) segs.push(cur);
    segs.forEach(function(s) {
        let pts = rate.filter(function(r) { return r[0] >= s.start && r[0] <= s.end && r[1] > 0; });
        if (pts.length > 1) {
            let span = pts[pts.length - 1][0] - pts[0][0], area = 0;
            for (let i = 0; i < pts.length - 1; i++) area += (pts[i + 1][0] - pts[i][0]) * pts[i][1];
            s.watts = span ? area / span : pts[0][1];
        } else s.watts = pts.length ? pts[0][1] : 0;
        s.wh = Math.abs(s.p1 - s.p0) / 100 * fullWh;
    });
    return segs.filter(function(s) { return s.end - s.start >= 60; });
}

function pad(n) { return (n < 10 ? "0" : "") + n; }
function hm(ts) { let d = new Date(ts * 1000); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
function dayLabel(ts) {
    let d = new Date(ts * 1000), now = new Date();
    let a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    let b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let diff = Math.round((b - a) / 86400000);
    if (diff === 0) return "TODAY";
    if (diff === 1) return "YESTERDAY";
    return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getDay()] + " " + d.getDate() + " " +
        ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getMonth()];
}
function dur(sec) {
    let m = Math.floor(sec / 60);
    return m >= 60 ? Math.floor(m / 60) + "h " + pad(m % 60) + "m" : m + "m";
}

function BatteryDesklet(metadata, desklet_id) { this._init(metadata, desklet_id); }

BatteryDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.settings = new Settings.DeskletSettings(this, metadata.uuid, desklet_id);
        this.settings.bind("rows", "rows", this._update);
        this.settings.bind("days", "days", this._update);
        this.settings.bind("scale", "scale", this._update);
        this.settings.bind("interval", "interval", () => this._schedule());
        this.setHeader("");
        this._update();
        this._schedule();
    },

    _schedule: function() {
        if (this._timer) Mainloop.source_remove(this._timer);
        this._timer = Mainloop.timeout_add_seconds(this.interval || 60, () => { this._update(); return true; });
    },

    on_desklet_removed: function() {
        if (this._timer) Mainloop.source_remove(this._timer);
    },

    _bat: function(name) { return this._batName ? readText(PS + "/" + this._batName + "/" + name).trim() : ""; },

    // Energy in Wh; falls back to charge (µAh) x design voltage when energy_* is missing.
    _fullWh: function() {
        let e = parseInt(this._bat("energy_full"));
        if (e) return e / 1e6;
        let c = parseInt(this._bat("charge_full")), v = parseInt(this._bat("voltage_min_design")) ||
            parseInt(this._bat("voltage_now"));
        return c && v ? c * v / 1e12 : 0;
    },

    // Power in W; falls back to current x voltage when power_now is missing.
    _watts: function() {
        let p = parseInt(this._bat("power_now"));
        if (p) return p / 1e6;
        let i = parseInt(this._bat("current_now")), v = parseInt(this._bat("voltage_now"));
        return i && v ? Math.abs(i) * v / 1e12 : 0;
    },

    _update: function() {
        this._batName = this._batName || findBattery();
        if (!this._batName) {
            this.setContent(new St.Label({ text: "No battery found", style_class: "bh-sub",
                style: "padding: 16px;" }));
            return;
        }
        let fullWh = this._fullWh();
        let pct = parseInt(this._bat("capacity")) || 0;
        let status = this._bat("status") || "Unknown";
        let watts = this._watts();
        let s = this.scale || 1;

        let card = new St.BoxLayout({ vertical: true, style_class: "bh-card",
            style: "font-size: " + Math.round(10 * s) + "pt;" });

        // Header: big percentage, state, live draw
        let head = new St.BoxLayout({ vertical: false });
        head.add(new St.Label({ text: pct + "%", style_class: "bh-pct",
            style: "color:" + (status === "Discharging" ? (pct <= 20 ? "#e5584f" : "#f2f3f5") : GREEN) + ";" }));
        let hr = new St.BoxLayout({ vertical: true, style: "padding-left: 12px;" });
        let state = status === "Discharging" ? "On battery" : status === "Charging" ? "Charging" : status;
        hr.add(new St.Label({ text: state, style_class: "bh-time" }));
        let left = "";
        if (watts > 0.5) {
            let e = pct / 100 * fullWh;
            let hrs = status === "Discharging" ? e / watts : (status === "Charging" ? (fullWh - e) / watts : 0);
            left = " · " + watts.toFixed(1) + " W" + (hrs > 0 ? " · " + dur(hrs * 3600) +
                (status === "Charging" ? " to full" : " left") : "");
        }
        hr.add(new St.Label({ text: "Battery history" + left, style_class: "bh-sub" }));
        head.add(hr, { y_align: St.Align.MIDDLE });
        card.add(head);

        // Session rows, newest first, grouped by day
        let list = sessions(this.days || 7, fullWh).reverse().slice(0, this.rows || 7);
        let lastDay = null;
        list.forEach(function(sess) {
            let day = dayLabel(sess.start);
            if (day !== lastDay) {
                card.add(new St.Label({ text: day, style_class: "bh-day" }));
                lastDay = day;
            }
            let dis = sess.state === "discharging";
            let col = dis ? ORANGE : GREEN;
            let row = new St.BoxLayout({ vertical: false, style: "padding-top: 6px;" });

            let l = new St.BoxLayout({ vertical: true, style: "width: " + Math.round(120 * s) + "px;" });
            l.add(new St.Label({ text: hm(sess.start) + " – " + hm(sess.end), style_class: "bh-time" }));
            l.add(new St.Label({ text: dur(sess.end - sess.start) + " · " + sess.wh.toFixed(1) + " Wh",
                style_class: "bh-meta" }));
            row.add(l);

            // Bar: where on the 0-100% scale the charge moved
            let lo = Math.min(sess.p0, sess.p1), hi = Math.max(sess.p0, sess.p1);
            let tw = Math.round(TRACK * s);
            let track = new St.BoxLayout({ vertical: false, style_class: "bh-track",
                style: "width:" + tw + "px;" });
            track.add(new St.Widget({ style: "width:" + Math.round(lo / 100 * tw) + "px; height:8px;" }));
            track.add(new St.Widget({ style: "width:" + Math.max(3, Math.round((hi - lo) / 100 * tw)) +
                "px; height:8px; border-radius:4px; background-color:" + col + ";" }));
            row.add(track, { y_align: St.Align.MIDDLE });

            let r = new St.BoxLayout({ vertical: true, style: "padding-left: 12px; width: " + Math.round(64 * s) + "px;" });
            r.add(new St.Label({ text: (dis ? "−" : "+") + Math.abs(sess.p1 - sess.p0).toFixed(0) + "%",
                style_class: "bh-delta", style: "color:" + col + ";" }));
            r.add(new St.Label({ text: sess.watts.toFixed(1) + " W avg", style_class: "bh-watts" }));
            row.add(r);
            card.add(row);
        });
        if (!list.length) card.add(new St.Label({ text: "No sessions recorded yet", style_class: "bh-meta",
            style: "padding-top: 8px;" }));

        this.setContent(card);
    }
};

function main(metadata, desklet_id) { return new BatteryDesklet(metadata, desklet_id); }
