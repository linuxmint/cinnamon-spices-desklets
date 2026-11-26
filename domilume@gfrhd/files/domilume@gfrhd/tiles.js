// Tiles for the dashboard: one St widget per device, big (full width) or small.
// Buttons call options.actions: toggle(d), step(d, delta), mode(d, "boost"|"frost", minutes).

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Pango = imports.gi.Pango;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Main = imports.ui.main;

// Own modules, see desklet.js.
const Me = imports.ui.extension.getCurrentExtension
    ? imports.ui.extension.getCurrentExtension().imports : null;
const FritzXml = Me ? Me.fritzxml : require('./fritzxml');
const Charts = Me ? Me.charts : require('./charts');
const I18n = Me ? Me.i18n : require('./i18n');
const _ = I18n._;

const COLOR_POWER = "#f2a93b";
const COLOR_TEMP = "#6fb3e8";
const COLOR_HUMIDITY = "#a78bfa";
const GRAPH_SMALL = 34;   // px
const GRAPH_SMALL_HALF = 24;   // two mini graphs on top of each other (buttons: temperature, humidity)
const GRAPH_BIG = 92;

const LOW_BATTERY = 20;
const TEMP_MIN_SPAN = 4;       // °C shown at least in temperature graphs
const HUMIDITY_MIN_SPAN = 20;  // % shown at least in humidity graphs

const TOOLTIP_DELAY_MS = 500;

// One tooltip label per desklet instance for all its tiles. Cinnamon's Tooltip class
// connects to each actor's "destroy"; with tiles rebuilt on every refresh that caused GJS
// "call back into JSAPI during the sweeping phase of GC" warnings. This one only listens
// to enter/leave/press events and owns a single label.
var TileTooltip = class TileTooltip {
    constructor() {
        this._label = new St.Label({ name: "Tooltip", visible: false });
        // The theme centers tooltip lines (text-align) and may ellipsize long ones.
        this._label.set_style("text-align: left;");
        this._label.clutter_text.line_alignment = Pango.Alignment.LEFT;
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        Main.uiGroup.add_actor(this._label);
        this._timerId = 0;
    }

    // markup: text is Pango markup (escape names and other free text with markupEscape).
    attach(actor, text, markup) {
        actor.connect("enter-event", () => this._schedule(text, markup));
        actor.connect("leave-event", () => this.hide());
        actor.connect("button-press-event", () => this.hide());
    }

    _setText(text, markup) {
        if (markup) {
            this._label.clutter_text.set_markup(text);
        } else {
            this._label.clutter_text.use_markup = false;
            this._label.set_text(text);
        }
    }

    _schedule(text, markup) {
        this.hide();
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, () => {
            this._timerId = 0;
            let [x, y] = global.get_pointer();
            this._setText(text, markup);
            this._label.set_position(x + 12, y + 18);
            this._label.show();
            this._label.raise_top();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Immediately, at the pointer (used while moving over a graph).
    showNow(text) {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        let [x, y] = global.get_pointer();
        this._setText(text, false);
        this._label.set_position(x + 12, y + 18);
        this._label.show();
        this._label.raise_top();
    }

    hide() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        this._label.hide();
    }

    destroy() {
        this.hide();
        this._label.destroy();
    }
};

function fmt(n, digits) {
    return I18n.num(n, digits);
}

function watt(w) {
    return fmt(w, w < 10 ? 1 : 0);
}

// Own symbolic icons from <desklet>/icons/<name>-symbolic.svg, colored like the text.
function icon(dir, name, size) {
    let file = Gio.File.new_for_path(`${dir}/icons/${name}-symbolic.svg`);
    return new St.Icon({
        gicon: new Gio.FileIcon({ file: file }),
        icon_type: St.IconType.SYMBOLIC,
        icon_size: size || 16,
        style_class: "fritz-icon",
    });
}

function label(text, styleClass) {
    let l = new St.Label({ text: text, style_class: styleClass });
    l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return l;
}

function remainingText(endUnix, nowUnix) {
    let min = Math.max(0, Math.ceil((endUnix - nowUnix) / 60));
    return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

// Active boost / frost protection: { mode: "boost"|"frost", end } or null.
function activeMode(d, nowUnix) {
    if (!d.hkr)
        return null;
    if (d.hkr.boostActive && d.hkr.boostEnd > nowUnix)
        return { mode: "boost", end: d.hkr.boostEnd };
    if (d.hkr.windowOpenActive && d.hkr.windowOpenEnd > nowUnix)
        return { mode: "frost", end: d.hkr.windowOpenEnd };
    return null;
}

// right: optional widget at the top right (plug switch); battery devices show the battery there.
function header(d, dir, tooltip, right) {
    let box = new St.BoxLayout({ style_class: "fritz-tile-header" });
    let name = label(d.name, "fritz-tile-name");
    name.x_expand = true;
    name.y_align = Clutter.ActorAlign.CENTER;
    box.add_child(name);
    if (!d.present) {
        // Device lost its connection to the box (DECT/Zigbee); stale values are shown dimmed.
        let off = new St.Label({ text: _("offline"), style_class: "fritz-offline-badge", y_align: Clutter.ActorAlign.CENTER, reactive: true });
        if (tooltip)
            tooltip.attach(off, d.offlineSince
                ? I18n.formatText(_("No connection to the FRITZ!Box since %s – last known values"), timeText(d.offlineSince, "%H:%M"))
                : _("No connection to the FRITZ!Box"));
        box.add_child(off);
    }
    if (right) {
        right.y_align = Clutter.ActorAlign.CENTER;
        box.add_child(right);
    }
    if (d.battery !== null) {
        let low = d.batteryLow || d.battery <= LOW_BATTERY;
        let batt = new St.BoxLayout({ style_class: "fritz-battery" + (low ? " fritz-battery-low" : "") });
        batt.add_child(icon(dir, "battery", 14));
        batt.add_child(new St.Label({ text: `${d.battery} %`, y_align: Clutter.ActorAlign.CENTER }));
        if (d.memberBatteries && d.memberBatteries.length && tooltip) {
            // Groups report no battery of their own; the tile shows the lowest member.
            batt.reactive = true;
            tooltip.attach(batt, _("Lowest battery of the thermostats:") + "\n" +
                d.memberBatteries.map(m => `${m.name}: ${m.battery} %`).join("\n"));
        }
        box.add_child(batt);
    }
    return box;
}

// Big value with unit; extra: optional second value at the right edge: a string (small),
// a widget, or { big: [value, unit] } in the same size as the main value (meter reading).
// middle: optional widget right after the unit (plug energy today / yesterday).
function mainValue(value, unit, extra, middle) {
    let box = new St.BoxLayout({ style_class: "fritz-tile-main" });
    box.add_child(new St.Label({ text: value, style_class: "fritz-value", y_align: Clutter.ActorAlign.END }));
    if (unit)
        box.add_child(new St.Label({ text: unit, style_class: "fritz-unit", y_align: Clutter.ActorAlign.END }));
    if (middle) {
        middle.y_align = Clutter.ActorAlign.END;
        box.add_child(middle);
        fitOptional(box, middle._optional);
    }
    if (extra) {
        let widget = typeof extra === "string"
            ? new St.Label({ text: extra, style_class: "fritz-secondary" })
            : extra.big ? mainValue(extra.big[0], extra.big[1]) : extra;
        widget.x_expand = true;
        widget.x_align = Clutter.ActorAlign.END;
        // text sits on the baseline of the main value, the boost/frost pill in the middle
        widget.y_align = widget.has_style_class_name("fritz-pill") ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.END;
        box.add_child(widget);
    }
    return box;
}

function kwh(v) {
    return fmt(v, v < 10 ? 2 : 1);
}

// Energy of a plug today (live) and yesterday from the day statistics (newest value = today).
// Small tiles: "0,16 | 1,24 kWh" (yesterday is dropped when the line is too narrow, see
// fitOptional), big tiles with labels and unit. null without statistics.
// price: ct/kWh for the cost (or feed-in credit) in the tooltip, 0 = none.
function energyLabel(stats, big, tooltip, price) {
    let days = stats && stats.energyDays;
    if (!days || !days.values.length)
        return null;
    let n = days.values.length;
    let today = days.values[n - 1] || 0;
    let yesterday = n > 1 ? days.values[n - 2] : null;
    let box = new St.BoxLayout({ style_class: "fritz-energy", reactive: true });
    box.add_child(new St.Label({ text: big ? I18n.formatText(_("today %s kWh"), kwh(today)) : kwh(today), style_class: "fritz-energy-today" }));
    if (yesterday !== null) {
        let y = new St.Label({ text: big ? "  ·  " + I18n.formatText(_("yesterday %s kWh"), kwh(yesterday)) : ` | ${kwh(yesterday)}`, style_class: "fritz-energy-yesterday" });
        box.add_child(y);
        if (!big)
            box._optional = y;
    }
    if (!big)
        box.add_child(new St.Label({ text: " kWh", style_class: "fritz-energy-yesterday" }));
    if (tooltip) {
        // Markup: labels bold. Year: projection from the complete days (all but today);
        // AVM's own estimate in the box UI is not available via AHA.
        let money = (v, digits) => (price > 0 ? `  ·  ${fmt(v * price / 100, digits)} €` : "");
        let lines = ["<b>" + _("Today:") + `</b> ${kwh(today)} kWh${money(today, 2)}`];
        if (yesterday !== null)
            lines.push("<b>" + _("Yesterday:") + `</b> ${kwh(yesterday)} kWh${money(yesterday, 2)}`);
        let full = days.values.slice(0, -1).filter(v => v !== null);
        if (full.length >= 7) {
            let year = full.reduce((a, v) => a + v, 0) / full.length * 365;
            lines.push("<b>" + _("Year ≈:") + `</b> ${fmt(year, 0)} kWh${money(year, 0)}`);
        }
        tooltip.attach(box, lines.join("\n"), true);
    }
    return box;
}

// Hides an optional part of a value line once, if the line does not fit into the tile.
// Checked after the first allocation (tiles are rebuilt on every refresh).
function fitOptional(box, optional) {
    if (!optional)
        return;
    let id = box.connect("notify::allocation", () => {
        box.disconnect(id);
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (box.get_stage()) {
                let [, natural] = box.get_preferred_width(-1);
                if (natural > box.width + 0.5)
                    optional.hide();
            }
            return GLib.SOURCE_REMOVE;
        });
    });
}

// Humidity with a drop icon instead of a unit abbreviation (rF / RH differ by language).
function humidityLabel(dir, value) {
    let box = new St.BoxLayout({ style_class: "fritz-secondary fritz-humidity" });
    box.add_child(icon(dir, "humidity", 12));
    box.add_child(new St.Label({ text: `${value} %`, y_align: Clutter.ActorAlign.CENTER }));
    return box;
}

function switchWidget(d, tooltip, actions) {
    let blocked = d.lock || !d.present;
    let track = new St.Button({
        style_class: "fritz-switch" + (d.on ? " fritz-switch-on" : "") + (blocked ? " fritz-switch-locked" : ""),
        reactive: true,
        can_focus: !blocked,
        x_fill: true,   // let the inner widget span the track, so the knob can sit left/right
        y_fill: true,
    });
    let bin = new St.Widget({ layout_manager: new Clutter.BinLayout(), x_expand: true });
    bin.add_child(new St.Widget({
        style_class: "fritz-switch-knob",
        x_align: d.on ? Clutter.ActorAlign.END : Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    }));
    track.set_child(bin);
    if (!blocked && actions)
        track.connect("clicked", () => actions.toggle(d));
    tooltip.attach(track, !d.present ? I18n.formatText(_("%s: no connection"), d.name)
        : blocked ? I18n.formatText(_("%s: locked at the FRITZ!Box"), d.name)
        : I18n.formatText(d.on ? _("Switch off %s") : _("Switch on %s"), d.name));
    return track;
}

function hkrButtons(d, dir, row, mode, tooltip, actions) {
    let box = new St.BoxLayout({ style_class: "fritz-hkr-buttons", x_expand: true });
    let specs = [
        // St.Bin in Cinnamon takes St.Align (START/MIDDLE/END), not Clutter.ActorAlign.
        { icon: "frost", align: St.Align.START, active: mode && mode.mode === "frost",
          tip: mode && mode.mode === "frost" ? _("End frost protection") : I18n.formatText(_("Frost protection for %s min"), row.frost),
          run: () => actions.mode(d, "frost", row.frost) },
        { icon: "minus", align: St.Align.MIDDLE, step: true, tip: I18n.formatText(_("Set point %s °C"), "−" + fmt(0.5, 1)),
          run: () => actions.step(d, -0.5) },
        { icon: "plus", align: St.Align.MIDDLE, step: true, tip: I18n.formatText(_("Set point %s °C"), "+" + fmt(0.5, 1)),
          run: () => actions.step(d, 0.5) },
        { icon: "boost", align: St.Align.END, active: mode && mode.mode === "boost",
          tip: mode && mode.mode === "boost" ? _("End boost") : I18n.formatText(_("Boost for %s min"), row.boost),
          run: () => actions.mode(d, "boost", row.boost) },
    ];
    for (let spec of specs) {
        let classes = "fritz-round-button";
        if (spec.step)
            classes += " fritz-step-button";
        if (spec.active)
            classes += ` fritz-active-${spec.icon}`;
        let button = new St.Button({ style_class: classes, child: icon(dir, spec.icon, 13), can_focus: true });
        tooltip.attach(button, spec.tip);
        if (actions)
            button.connect("clicked", spec.run);
        // x_fill/y_fill off, otherwise the bin stretches the round button into an oval.
        box.add_child(new St.Bin({ child: button, x_expand: true, x_align: spec.align, x_fill: false, y_fill: false }));
    }
    return box;
}

function addGraphs(tile, d, options) {
    let g = graphsFor(d, options);
    if (g)
        tile.add_child(g);
}

// The line under the value has a fixed height (stylesheet .fritz-sub-row), so switching
// between a plain text and the coloured remaining-time pill does not change the tile height.
function subRow(child) {
    let row = new St.BoxLayout({ style_class: "fritz-sub-row" });
    child.y_align = Clutter.ActorAlign.CENTER;
    row.add_child(child);
    return row;
}

function modePill(dir, mode, nowUnix) {
    let pill = new St.BoxLayout({ style_class: `fritz-pill fritz-pill-${mode.mode}` });
    pill.add_child(icon(dir, mode.mode, 12));
    pill.add_child(new St.Label({ text: I18n.formatText(_("%s left"), remainingText(mode.end, nowUnix)), y_align: Clutter.ActorAlign.CENTER }));
    return pill;
}

// ---- graphs ---------------------------------------------------------------

function timeText(unix, format) {
    return GLib.DateTime.new_from_unix_local(unix).format(format);
}

// Unix time of value i (oldest -> newest) of a stats series.
function timeOf(series, i) {
    let end = series.end || Math.floor(Date.now() / 1000);
    return end - (series.values.length - 1 - i) * series.grid;
}

// St.DrawingArea that calls draw(cr, w, h, hoverIndex); with tip(i) it shows the value under
// the pointer. Space is reserved even without data, so tiles keep their height.
function graphArea(height, draw, n, tip, tooltip, axis, bars, right) {
    // height is the minimum; y_expand lets the graph take the free height of the tile
    // (tiles in a row are as high as the highest one).
    let area = new St.DrawingArea({ style_class: "fritz-graph", x_expand: true, y_expand: true, reactive: !!tip });
    area.min_height = height;
    area._hover = null;
    area.connect("repaint", a => {
        let cr = a.get_context();
        let [w, h] = a.get_surface_size();
        try {
            if (!axis)
                Charts.drawFrame(cr, w, h);
            draw(cr, w, h, a._hover);
        } catch (e) {
            global.logError(`[Domilume] Graph: ${e}\n${e.stack}`);
        }
        cr.$dispose();
    });
    if (tip && tooltip) {
        area.connect("motion-event", (a, event) => {
            let [sx, sy] = event.get_coords();
            let [ok, x] = a.transform_stage_point(sx, sy);
            // get_surface_size() is only valid while painting; use the allocation here.
            let i = ok ? Charts.indexAt(x, a.width, a.height, n, axis, bars, right) : null;
            if (i !== a._hover) {
                a._hover = i;
                a.queue_repaint();
            }
            let t = i === null ? null : tip(i);
            if (t)
                tooltip.showNow(t);
            else
                tooltip.hide();
            return Clutter.EVENT_PROPAGATE;
        });
        area.connect("leave-event", a => {
            a._hover = null;
            a.queue_repaint();
            tooltip.hide();
            return Clutter.EVENT_PROPAGATE;
        });
    }
    return area;
}

// Line graph of a stats series (power or temperature).
function lineGraph(series, height, big, opt, tooltip) {
    if (!series || series.values.filter(v => v !== null).length < 2)
        return graphArea(height, () => {}, 0, null, null, big, false);
    let values = series.values;
    let tip = i => (values[i] === null ? null
        : `${timeText(timeOf(series, i), "%H:%M")}  ·  ${opt.fmtTip(values[i])}`);
    return graphArea(height, (cr, w, h, hover) => Charts.drawLine(cr, w, h, values, {
        color: opt.color, min: opt.min, minSpan: opt.minSpan, ref: opt.ref, hover: hover,
        axis: big, fmt: opt.fmtAxis, xLabels: opt.xLabels,
    }), values.length, tip, tooltip, big, false);
}

// Relative humidity of a button sensor; scale at least HUMIDITY_MIN_SPAN,
// so small changes do not look dramatic.
function humidityGraph(hum, height, big, tooltip) {
    if (!hum || hum.values.filter(v => v !== null).length < 2)
        return graphArea(height, () => {}, 0, null, null, big, false);
    let values = hum.values;
    let tip = i => (values[i] === null ? null
        : `${timeText(timeOf(hum, i), "%H:%M")}  ·  ${values[i]} %`);
    return graphArea(height, (cr, w, h, hover) => Charts.drawLine(cr, w, h, values, {
        color: COLOR_HUMIDITY, minSpan: HUMIDITY_MIN_SPAN, hover: hover, axis: big,
        fmt: v => `${Math.round(v)}%`, xLabels: ["-24 h", "-12 h", _("now")],
    }), values.length, tip, tooltip, big, false);
}

// Energy bars: last N days or 12 months, depending on the "Darstellung" setting.
// price: ct/kWh for the cost in the tooltip (0 = none).
function energyGraph(stats, range, height, big, tooltip, price) {
    let months = range === "12";
    let series = stats ? (months ? stats.energyMonths : stats.energyDays) : null;
    if (!series)
        return null;
    let values = months ? series.values : series.values.slice(-Number(range || 7));
    let offset = series.values.length - values.length;
    let tip = i => {
        let label = months
            ? timeText(timeOf(series, offset + i), "%B %Y")
            : timeText(timeOf(series, offset + i), _("%a %d %b"));   // translators: strftime format of a day
        let v = values[i] || 0;
        return `${label}  ·  ${fmt(v, months ? 0 : 1)} kWh` + (price > 0 ? `  ·  ${fmt(v * price / 100, 2)} €` : "");
    };
    let xLabels = months ? [_("12 months ago"), "", _("this month")] : [I18n.formatText(_("%s days ago"), values.length), "", _("today")];
    return graphArea(height, (cr, w, h, hover) => Charts.drawBars(cr, w, h, values, {
        color: COLOR_POWER, hover: hover, axis: big, xLabels: xLabels,
        fmt: v => fmt(v, v < 10 && v % 1 ? 1 : 0),
    }), values.length, tip, tooltip, big, true);
}

const POWER_OPT = {
    color: COLOR_POWER, min: 0,
    fmtTip: v => `${watt(v)} W`, fmtAxis: v => fmt(v, 0), xLabels: ["-60 min", "-30", _("now")],
};

function tempOpt(ref) {
    return {
        color: COLOR_TEMP, ref: ref, minSpan: TEMP_MIN_SPAN,
        fmtTip: v => `${fmt(v, 1)} °C`, fmtAxis: v => fmt(v, 1), xLabels: ["-24 h", "-12 h", _("now")],
    };
}

// Graph part of a tile: mini graph for small tiles; line + energy bars for big tiles.
function graphsFor(d, options) {
    let stats = options.stats ? options.stats(d) : null;
    let big = options.big;
    let height = big ? GRAPH_BIG : GRAPH_SMALL;
    let main = null;
    switch (d.kind) {
    case "plug":
    case "import":
        main = lineGraph(stats && stats.power, height, big, POWER_OPT, options.tooltip);
        break;
    case "hkr":
    case "group":
        main = lineGraph(stats && stats.temperature, height, big,
            tempOpt(d.hkr && d.hkr.target !== null ? d.hkr.target : undefined), options.tooltip);
        break;
    case "sensor": {
        // Temperature and humidity as two graphs: stacked in small tiles, side by side in big ones.
        let hasHum = d.humidity !== null || (stats && stats.humidity);
        let h = big || !hasHum ? height : GRAPH_SMALL_HALF;
        let temp = lineGraph(stats && stats.temperature, h, big, tempOpt(undefined), options.tooltip);
        if (!hasHum)
            return temp;
        let box = new St.BoxLayout({ vertical: !big, y_expand: true, style_class: big ? "fritz-graph-row" : "fritz-graph-stack" });
        box.add_child(temp);
        box.add_child(humidityGraph(stats && stats.humidity, h, big, options.tooltip));
        return box;
    }
    case "export":
        main = energyGraph(stats, options.energyRange, height, big, options.tooltip,
            options.prices ? options.prices.export : 0)
            || graphArea(height, () => {}, 0, null, null, big, false);
        return main;
    default:
        return null;
    }
    if (!big)
        return main;
    let row = new St.BoxLayout({ style_class: "fritz-graph-row", y_expand: true });
    row.add_child(main);
    let energy = energyGraph(stats, options.energyRange, height, true, options.tooltip,
        options.prices ? options.prices.import : 0);
    if (energy)
        row.add_child(energy);   // both x_expand: the width is shared equally
    return row;
}

// d: device from fritzxml, row: its settings row,
// options: { dir, big, nowUnix, tooltip (TileTooltip of the desklet instance), actions,
//            stats (d => parsed statistics or undefined), energyRange ("7" | "31" | "12") }
function buildTile(d, row, options) {
    let dir = options.dir;
    let nowUnix = options.nowUnix || Math.floor(Date.now() / 1000);
    let tile = new St.BoxLayout({
        vertical: true,
        style_class: "fritz-tile" + (options.big ? " fritz-tile-big" : "") + (d.present ? "" : " fritz-offline"),
    });
    // Offline devices: last known values (d.stale, kept by the desklet) without controls.
    if (!d.present)
        options = Object.assign({}, options, { actions: null });
    let plugSwitch = d.kind === "plug" && (d.present || d.stale) ? switchWidget(d, options.tooltip, options.actions) : null;
    tile.add_child(header(d, dir, options.tooltip, plugSwitch));

    if (!d.present && !d.stale) {
        tile.add_child(mainValue("–", ""));
        tile.add_child(subRow(label(_("not connected"), "fritz-sub")));
        addGraphs(tile, d, options);
        return tile;
    }

    switch (d.kind) {
    case "plug":
        tile.add_child(mainValue(d.on && d.powerW !== null ? watt(d.powerW) : "0", "W",
            d.celsius !== null ? `${fmt(d.celsius, 1)} °C` : "",
            energyLabel(options.stats ? options.stats(d) : null, options.big, options.tooltip,
                options.prices ? options.prices.import : 0)));
        addGraphs(tile, d, options);
        break;

    case "hkr":
    case "group": {
        let mode = activeMode(d, nowUnix);
        // Set point (or remaining boost / frost time) right of the room temperature.
        let target = mode ? modePill(dir, mode, nowUnix)
            : d.hkr.target !== null ? I18n.formatText(_("Target %s °C"), fmt(d.hkr.target, 1))
            : d.hkr.targetState === "off" ? _("Target: off")
            : d.hkr.targetState === "on" ? _("Target: on") : "";
        tile.add_child(mainValue(d.celsius !== null ? fmt(d.celsius, 1) : "–", "°C", target));
        if (d.celsiusRange)
            tile.add_child(subRow(label(`${fmt(d.celsiusRange.min, 1)} – ${fmt(d.celsiusRange.max, 1)} °C`, "fritz-sub")));
        addGraphs(tile, d, options);
        let footer = new St.BoxLayout({ style_class: "fritz-tile-footer" });
        footer.add_child(hkrButtons(d, dir, row, mode, options.tooltip, options.actions));
        tile.add_child(footer);
        break;
    }

    case "sensor":
        tile.add_child(mainValue(d.celsius !== null ? fmt(d.celsius, 1) : "–", "°C",
            d.humidity !== null ? humidityLabel(dir, d.humidity) : ""));
        addGraphs(tile, d, options);
        break;

    case "import":
        tile.add_child(mainValue(d.powerW !== null ? watt(d.powerW) : "–", "W",
            d.energyKWh !== null ? { big: [fmt(d.energyKWh, 1), "kWh"] } : ""));
        addGraphs(tile, d, options);
        break;

    case "export":
        tile.add_child(mainValue(d.energyKWh !== null ? fmt(d.energyKWh, 1) : "–", "kWh"));
        tile.add_child(subRow(label(_("Feed-in meter reading"), "fritz-sub")));
        addGraphs(tile, d, options);
        break;

    default: {
        let text = FritzXml.describe(d, nowUnix);
        tile.add_child(subRow(label(text.state || "", "fritz-sub")));
        tile.add_child(subRow(label(text.values || "", "fritz-sub")));
    }
    }
    return tile;
}
