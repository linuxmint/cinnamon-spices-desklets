/* Big Calendar -- a large, configurable month-view calendar desklet.
 *
 * Copyright (C) 2026  adis
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * This file is the desklet's entry point, and it is the one place that cannot
 * be an ES module: Cinnamon 6.6.9 loads it through its legacy importer
 * (requireModule in js/ui/extension.js), which is also why `main` has to be a
 * plain top-level function declaration.
 *
 * Everything else is modern. All the real logic lives in lib/ as ES modules
 * with `export`, loaded below through dynamic import(), and this file uses
 * classes, const/let, arrow functions and async/await throughout. The
 * `imports.gi.*` aliases are the same platform requirement: they are how a
 * legacy-loaded script reaches GObject introspection.
 */

'use strict';

const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Pango = imports.gi.Pango;
const Cinnamon = imports.gi.Cinnamon;
const Meta = imports.gi.Meta;
const Mainloop = imports.mainloop;
const Gettext = imports.gettext;
const Tooltips = imports.ui.tooltips;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Main = imports.ui.main;

const DESKLET_UUID = "bigCalendar@adis";

Gettext.bindtextdomain(DESKLET_UUID, GLib.get_user_data_dir() + "/locale");

const _ = (text) => Gettext.dgettext(DESKLET_UUID, text);

// How often to check whether the calendar day has rolled over. A minute is
// frequent enough that the "today" marker is never visibly stale, and cheap
// enough to leave running indefinitely.
const DAY_CHECK_SECONDS = 60;

// How often to re-check whether a window has moved over the desklet and the
// input region has to be handed back. Only rect comparisons over the handful of
// open windows, so it is cheap, but it is not free either: it is as fast as
// this needs to be, given that what it is racing is someone moving a window and
// then clicking in it.
const INPUT_RECONCILE_MS = 200;

// How often the reconcile timer above is checked for still existing.
//
// A repeating timeout can be detached without any JavaScript running: CJS sets
// one up with GObject.source_set_closure(), whose boolean result GLib
// initialises to false, so when a collection is sweeping and the runtime
// refuses to enter the callback, that false removes the source by itself. The
// field keeps the old id, so `if (this._inputTimer)` sees a timer that is not
// there and never starts another one -- and the desklet stops re-checking the
// input region for the rest of its life, which shows up as a desklet that
// swallows clicks over a window, or one that has quietly stopped responding to
// the mouse. It is rare (a source has to be ready at the instant of the sweep),
// and this is what makes it recoverable rather than permanent.
//
// Two timers rather than one because the sweep has to catch this one ready as
// well to do any harm, and this one is ready 150 times less often.
const INPUT_WATCHDOG_SEC = 30;

// How many events a day tooltip lists before collapsing the rest into a
// "+N more" line. Beyond this the tooltip stops being readable.
const TOOLTIP_MAX_EVENTS = 10;

// How long the pointer has to rest on a day before its tooltip appears, and
// how far from the pointer it is placed. Cinnamon's own tooltips wait 300 ms,
// and matching that is what makes these feel like every other tooltip on the
// desktop instead of like a widget behaving oddly.
const TOOLTIP_SHOW_MS = 300;
const TOOLTIP_OFFSET_X = 14;
const TOOLTIP_OFFSET_Y = 20;

// A row is filled with the event's colour at full strength, so it is the same
// colour as the dot in the grid -- not a tint of it, and not a version of it
// adjusted until it can be read. What makes it a row rather than a block of
// colour is the text on it, which is why that text is chosen per row: see
// textOn(). Nothing here is changed to suit the tooltip's surface, because a
// filled row does not need the surface to see it -- its edges define it.
//
// This was a wash at 30% for a while, so that one text colour would read on
// every row. It read, but the row was then a blend of the colour with the
// tooltip rather than the colour, which is not what a colour picked in Online
// Accounts is for.

// Sizes that have to track the desklet's text size, in ems of the root font.
//
// These belong in the stylesheet, and used to live there, but St resolves an
// em length against whichever font it had when a widget's theme node happened
// to be built. A desklet's first render builds every node before the root's
// font size has been handed down, so the lengths come out against the default
// font -- a day cell 76px wide instead of 123, event dots with no size at all
// -- and they stay that way until some setting is changed by hand. Widths on
// an St.Label are ignored outright, which is why the title width was already
// worked out here. So all of them are, and the stylesheet holds no lengths.
const TITLE_WIDTH_EM = 4.5;   // one event title, in the "titles" event style
const CELL_WIDTH_EM = 4.2;    // one day cell
const DOT_SIZE_EM = 0.45;     // one event dot
const EVENTS_MIN_HEIGHT_EM = 0.7;  // keeps rows even on days with no events
const WEEKNUM_WIDTH_EM = 1.9; // the week-number column
const MORE_LABEL_EM = 0.72;   // the "+N" label's font, as a share of the root's

// Padding belonging to a widget inside the grid, set here rather than there.
//
// Same family as the lengths above, reached a different way. St answers a
// widget's theme node lazily, on the first allocation, and for a desklet that
// is earlier than this desklet's stylesheet reaching the theme. The grid's
// inner widgets came up without the padding their rules give them: the day
// cells were 68px around 70px of contents, so every row overflowed into the
// next, and the indicator strip lost its top padding. Setting the same padding
// as an inline style fixes it -- an inline style forces the node to be worked
// out while the widget is still being built, by which time the stylesheet is
// there. It is also why a stylesheet change that alters nothing, even a
// trailing space, appeared to "fix" the layout when a setting was touched by
// hand.
//
// Not every widget is affected -- the title bar outside the table keeps its
// padding without any help -- so this is applied to the ones that were
// measured wrong rather than everywhere on principle.
const CELL_PADDING = "padding: 1px 4px;";
const CELL_PADDING_X = 4;                    // each side, in px, per the above
const EVENTS_PADDING = "padding-top: 1px;";  // on the empty indicator strip

// The gap between event dots, in px, matching .bigcal-eventdots in the
// stylesheet. Kept as a number here because it is needed to work out how many
// dots fit -- see _dotsThatFit().
const DOT_GAP_PX = 2;
// The "+N" label's width is not here: it is measured when it is built, because
// the stylesheet sizes it in ems that resolve against a font this code does not
// choose and any figure written down here disagreed with the pixels.

// The "+N" label that ends a crowded day's indicator strip. Its colour is here
// rather than in the stylesheet for the same reason -- the label needs an
// inline style to keep its class rules, and its font size comes from one.
const MORE_LABEL_COLOR = "#9a9a9a";

// Cinnamon's own 24-hour switch, the same key its clock applet reads. Note
// that imports.gi.Cinnamon has no util_get_clock_use_24h() in Cinnamon 6.6.9,
// despite older desklets calling one.
const CLOCK_24H_SCHEMA = "org.cinnamon.desktop.interface";
const CLOCK_24H_KEY = "clock-use-24h";

// Where the month last being viewed is remembered, as "YYYY-M". Deliberately
// absent from every section in settings-schema.json, which is what keeps it
// out of the configuration dialog while still being readable and writable.
const LAST_VIEW_KEY = "last-view";

/**
 * A token that changes whenever the file it names changes.
 *
 * GJS caches ES modules by URI for the life of the process. Reloading a desklet
 * does not clear that cache, so a desklet.js that has been reloaded after its
 * lib/ files changed goes on calling into the *old* modules -- and if the new
 * code calls a function the cached module never had, the throw lands in the
 * middle of a render and leaves a half-drawn month on screen rather than an
 * error anyone can read. Installing an updated desklet over a running one runs
 * into the same trap.
 *
 * Both fields of the timestamp are needed. Seconds alone would miss two edits
 * inside one second, which is easy to do while working on a file.
 *
 * Reading the stamp is asynchronous, like every other read this desklet makes.
 * A stat() is short, but short is not a property the main loop can rely on
 * when the file is on a network mount, and this runs in the compositor. The
 * binding does not promise-wrap query_info_async on its own, and Gio's
 * _promisify() would patch the prototype for every desklet in the session, so
 * the callback is wrapped by hand -- the same way calendarSource.js wraps the
 * EDS registry.
 *
 * A file that cannot be read at all stamps as 0 rather than throwing: the
 * stamp only has to differ when the file does, and a module that is missing is
 * about to fail its import loudly.
 */
async function moduleStamp(file) {
    try {
        const info = await new Promise((resolve, reject) => {
            Gio.File.new_for_path(file).query_info_async(
                "time::modified,time::modified-usec",
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null,
                (source, result) => {
                    try {
                        resolve(source.query_info_finish(result));
                    } catch (e) {
                        reject(e);
                    }
                });
        });
        return info.get_attribute_uint64("time::modified") * 1000000 +
            info.get_attribute_uint32("time::modified-usec");
    } catch (e) {
        return 0;
    }
}

/**
 * Load this desklet's ES modules.
 *
 * Returns the modules plus a flag for whether event support came up. The EDS
 * module is imported separately so that a failure there costs only the events
 * -- the calendar itself still draws.
 *
 * The stamp is what makes a reload pick up edited modules, and it is stable
 * while the files are, so two instances of the desklet still share one copy.
 */
async function loadModules(path) {
    const uri = async (name) => {
        const file = path + "/lib/" + name;
        return GLib.filename_to_uri(file, null) + "?v=" + await moduleStamp(file);
    };

    // The three stamps first, then the imports: a URI has to be settled before
    // the module it names is fetched, or the stamp is asking after a file that
    // has already been read.
    const [utilsUri, indexUri, sourceUri] = await Promise.all([
        uri("calendarUtils.js"),
        uri("eventIndex.js"),
        uri("calendarSource.js")
    ]);

    const [utils, index] = await Promise.all([
        import(utilsUri),
        import(indexUri)
    ]);

    let source = null;
    try {
        source = await import(sourceUri);
    } catch (e) {
        logError(e, "Big Calendar: event support unavailable");
    }

    return { utils, index, source };
}

/* ---------------------------------------------------------------- *
 * Colours
 * ---------------------------------------------------------------- */

/**
 * A calendar colour as [r, g, b], or null for anything else.
 *
 * Two forms are accepted, because evolution-data-server hands back both: a
 * hex triplet, and `rgb(r, g, b)`. Which one a calendar gets is not up to the
 * desklet -- Google's come through as hex and others do not, and a colour in
 * the form that was not expected reads as no colour at all, which is how a
 * calendar's events came to be drawn in the grid but written plain in the
 * tooltip.
 *
 * Matching tightly is the point rather than a convenience: these values arrive
 * from the calendar as strings and end up in inline CSS, so anything carrying
 * a quote or a semicolon would end the declaration early and leave the rest to
 * be parsed as more CSS. And the numbers are read out and the colour rebuilt
 * from them -- the string itself is never passed on -- so even a value that
 * matched could not put anything of its own into the style.
 */
function parseColor(value) {
    const text = String(value === null || value === undefined ? "" : value).trim();

    if (/^#[0-9a-f]{6}$/i.test(text)) {
        return [parseInt(text.substr(1, 2), 16),
                parseInt(text.substr(3, 2), 16),
                parseInt(text.substr(5, 2), 16)];
    }
    if (/^#[0-9a-f]{3}$/i.test(text)) {
        return [parseInt(text[1] + text[1], 16),
                parseInt(text[2] + text[2], 16),
                parseInt(text[3] + text[3], 16)];
    }

    const rgb = text.match(
        /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i);
    if (rgb) {
        const parts = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
        if (parts.every((c) => c <= 255)) return parts;
    }

    return null;
}

/** [r, g, b] back to #rrggbb, rounded and clamped. */
function toHex(rgb) {
    return "#" + rgb.map((c) =>
        Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")
    ).join("");
}

/** A calendar colour as a #rrggbb string, or null if it is not a colour. */
function solid(color) {
    const rgb = parseColor(color);
    return rgb ? toHex(rgb) : null;
}

/**
 * The relative luminance of a colour: 0 for black, 1 for white.
 *
 * The WCAG definition, which is what "how bright is this" has to mean if it is
 * going to decide whether text can be read. Each channel is made linear first,
 * because the eye does not see the middle of the range as half the light, and
 * then the channels are weighted for how much the eye gets from each. Green
 * carries most of that weight, which is why #00ff00 is far brighter than
 * #0000ff although both have a channel at full.
 */
function luminance(r, g, b) {
    const channel = (value) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** `from` moved `amount` of the way toward `to`, channel by channel. */
function blend(from, to, amount) {
    return from.map((c, i) => c + (to[i] - c) * amount);
}

/**
 * The colour to write a row in when that row is filled with `hex`: whichever of
 * black and white has more contrast against it, or null if `hex` is not a
 * colour.
 *
 * A filled row is the only place in the desklet whose text colour cannot be
 * settled once for the whole surface, because the row is a different colour on
 * every line. The two candidates are black and white rather than anything
 * softer: on a colour that is doing the work of being bright, the text has one
 * job, which is to be read. The crossover is where the two have the same
 * contrast ratio, at a luminance of about 0.18 -- below that the row is dark
 * enough that white reads better on it, above it black does.
 */
function textOn(hex) {
    const rgb = parseColor(hex);
    if (!rgb) return null;
    return luminance(rgb[0], rgb[1], rgb[2]) < 0.179 ? "#ffffff" : "#000000";
}

/* ---------------------------------------------------------------- *
 * Day tooltip
 * ---------------------------------------------------------------- */

/**
 * The tooltip that opens on hover over a day: the date, then a row per event,
 * each filled with that event's own colour from the grid.
 *
 * It is not Cinnamon's Tooltips.Tooltip. That is a single St.Label and can
 * carry exactly one colour, and the whole point of this tooltip is that a
 * day's events keep the colours they have in the grid. What it takes from
 * Cinnamon's is the behaviour, because that is the part a person notices: the
 * same wait before it appears, the same offset beside the pointer, and the
 * same clamping at the edge of the screen.
 *
 * One instance serves every day. Cinnamon builds one tooltip per cell, each
 * with its own actor sitting hidden -- 42 of them for a six-row month -- where
 * this builds its rows at the moment it is shown, so a day costs nothing until
 * it is hovered.
 */
class DayTooltip {
    constructor() {
        this._actor = new St.BoxLayout({
            vertical: true,
            style_class: "bigcal-tip",
            reactive: false
        });
        this._actor.hide();
        Main.uiGroup.add_child(this._actor);

        this._rows = null;
        this._pointer = null;
        this._timer = 0;
        this.visible = false;

        this.setSurface("#303036");
    }

    /**
     * Draw the tooltip on `color` -- the desklet's own background -- and work
     * out from it what can be read on top.
     *
     * Tied to the desklet's background rather than fixed, so the tooltip
     * belongs to the calendar it belongs to: on a light theme it comes out
     * light, and the event colours are darkened instead of lightened. Called
     * on every render, so a change of background is picked up by the next
     * hover.
     *
     * `fontSize` is the same text size the cells are drawn at, in points. It
     * has to be handed in: the tooltip lives in the uiGroup, outside the
     * desklet's actor, so nothing the desklet sets reaches it and it would
     * otherwise render at the theme's default -- a size nobody picked, next to
     * day numbers twice as tall.
     */
    setSurface(color, fontSize) {
        const rgb = parseColor(color) || [48, 48, 54];
        this._dark = luminance(rgb[0], rgb[1], rgb[2]) < 0.5;
        // Every row's text: the surface's own colour pushed nearly all the way
        // to the other end, so it reads on the bare surface. The rows that are
        // filled with an event's colour do not use it -- see textOn().
        // It is not a colour the desklet's settings do not know about, only
        // the surface taken to where text belongs.
        this._plain = toHex(blend(rgb, this._dark ? [255, 255, 255] : [0, 0, 0], 0.85));

        this._actor.set_style("background-color: " + toHex(rgb) + ";" +
            (fontSize ? " font-size: " + fontSize + "pt;" : ""));
    }

    /**
     * Make `cell` raise this tooltip with `rows` while the pointer is over it.
     *
     * `rows` is read at the moment it is shown, not stored by the cell, and a
     * cell is rebuilt on every render -- so a tooltip can never describe a day
     * that has since been redrawn.
     */
    watch(cell, rows) {
        // The emitter is the first argument of a signal callback and the event
        // is the second, so `event` here is not the one being named -- writing
        // the handler as (event) reads the cell and throws on get_coords.
        const arm = (actor, event) => {
            this._arm(rows, event.get_coords());
            return Clutter.EVENT_PROPAGATE;
        };

        cell.connect("enter-event", arm);
        cell.connect("motion-event", arm);
        cell.connect("leave-event", () => {
            this.hide();
            return Clutter.EVENT_PROPAGATE;
        });
        // A press is taken as the pointer moving on to something else, so the
        // tooltip gets out of the way of whatever the click was for.
        cell.connect("button-press-event", () => {
            this.hide();
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _arm(rows, coords) {
        if (coords) this._pointer = coords;

        if (this.visible) {
            // Already up: follow the pointer, and swap the contents over if
            // the pointer has crossed into a different day. The arrays are
            // built once per cell per render, so identity is the test for
            // "same day".
            if (rows !== this._rows) {
                this._build(rows);
                this._rows = rows;
            }
            this._place();
            return;
        }

        if (this._timer) Mainloop.source_remove(this._timer);
        this._timer = Mainloop.timeout_add(TOOLTIP_SHOW_MS, () => {
            this._timer = 0;
            this.show(rows);
            return GLib.SOURCE_REMOVE;
        });
    }

    show(rows) {
        if (!this._pointer) return;

        this._build(rows);
        this._rows = rows;
        this._actor.show();
        this._actor.raise_top();
        // Placed after showing, but in the same turn, so nothing is painted in
        // between: an unshown actor has no allocation for the size the
        // placement needs, and placing it first would put it in the corner.
        this._place();
        this.visible = true;
    }

    hide() {
        if (this._timer) {
            Mainloop.source_remove(this._timer);
            this._timer = 0;
        }
        if (!this.visible) return;

        this._actor.hide();
        this.visible = false;
    }

    destroy() {
        this.hide();
        this._actor.destroy();
        this._rows = null;
    }

    /**
     * Fill the tooltip in: a label per row, filled with the event's colour if
     * the row carries one and left on the bare surface if it does not.
     *
     * The colour is the row, not the text. Written into the text it was a
     * different colour on every line, and on a red event that meant red letters
     * on a red ground -- the row went muddy exactly where the eye needed to
     * read it. Filled, the row is the colour the calendar was given, the same
     * one the dot in the grid uses, and the text on it is chosen to read
     * against that colour rather than to match it.
     */
    _build(rows) {
        for (const child of this._actor.get_children()) child.destroy();

        for (const row of rows) {
            const fill = solid(row.color);
            const style_class = fill ? "bigcal-tip-row"
                : (row.date ? "bigcal-tip-plain bigcal-tip-date" : "bigcal-tip-plain");

            const label = new St.Label({ text: row.text, style_class: style_class });
            label.set_style("color: " + (fill ? textOn(fill) : this._plain) + ";" +
                (fill ? " background-color: " + fill + ";" : ""));
            // Filled across the box, so the rows line up as one column rather
            // than as strips as long as their own text.
            this._actor.add(label, { x_fill: true, x_align: St.Align.FILL });
        }
    }

    /**
     * Put the tooltip beside the pointer, flipped and then clamped so that it
     * stays on the monitor and never covers the day it describes.
     */
    _place() {
        const monitor = Main.layoutManager.findMonitorForActor(this._actor) ||
            Main.layoutManager.primaryMonitor;
        const [, width] = this._actor.get_preferred_width(-1);
        const [, height] = this._actor.get_preferred_height(width);

        let left = this._pointer[0] + TOOLTIP_OFFSET_X;
        let top = this._pointer[1] + TOOLTIP_OFFSET_Y;

        if (left + width > monitor.x + monitor.width) {
            left = this._pointer[0] - width - TOOLTIP_OFFSET_X;
        }
        if (top + height > monitor.y + monitor.height) {
            top = this._pointer[1] - height - TOOLTIP_OFFSET_Y;
        }

        this._actor.set_position(
            Math.round(Math.max(monitor.x, left)),
            Math.round(Math.max(monitor.y, top)));
    }
}

class BigCalendarDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);

        this._utils = null;
        this._index = null;
        this._source = null;

        this._today = new Date();
        this._view = { year: this._today.getFullYear(), month: this._today.getMonth() };

        this._dayTimer = 0;
        this._eventTimer = 0;
        this._feed = null;
        this._eventIndex = {};
        this._fetchToken = 0;
        this._dayTip = new DayTooltip();
        this._moreWidths = new Map();
        this._destroyed = false;
        this._ready = false;

        this._bootstrap();
    }

    async _bootstrap() {
        let modules;
        try {
            modules = await loadModules(this.metadata.path);
        } catch (e) {
            // A module failure would otherwise leave an invisible desklet
            // with no explanation. Checked for removal first: the import may
            // only reject after the desklet is gone, and touching a destroyed
            // actor from here would throw again, this time uncaught.
            logError(e, "Big Calendar: could not load lib modules");
            if (this._destroyed) return;
            this.setContent(new St.Label({ text: _("Big Calendar could not start.") }));
            return;
        }
        if (this._destroyed) return;

        this._utils = modules.utils;
        this._index = modules.index;
        this._source = modules.source;

        this._bindSettings();
        this._restoreView();
        this._buildUi();
        this._render();
        this._startDayTimer();
        this._ready = true;

        this.setHeader(_("Big Calendar"));
        this._openFeed();
    }

    /** Connect to the user's calendars and pull the first batch of events. */
    async _openFeed() {
        if (!this._source || !this.showEvents) return;

        this._feed = new this._source.CalendarFeed();
        try {
            await this._feed.open();
        } catch (e) {
            logError(e, "Big Calendar: could not open calendars");
            return;
        }
        if (this._destroyed) return;

        await this._refreshEvents();
        this._startEventTimer();
    }

    /* -------------------------------------------------------------- *
     * Settings
     * -------------------------------------------------------------- */

    _bindSettings() {
        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], this.instance_id);

        const s = this.settings;
        const rerender = () => this._render();
        // For settings that change which dates the grid covers: a redraw
        // alone would leave newly visible days empty until the next refresh,
        // because the cached events were fetched for the previous range.
        const refetch = () => {
            this._render();
            this._refreshEvents();
        };

        // Appearance
        s.bind("font-scale", "fontScale", rerender);
        s.bind("bg-color", "bgColor", rerender);
        s.bind("bg-opacity", "bgOpacity", rerender);
        s.bind("corner-radius", "cornerRadius", rerender);
        s.bind("border-width", "borderWidth", rerender);
        s.bind("border-color", "borderColor", rerender);
        s.bind("text-color", "textColor", rerender);
        s.bind("header-color", "headerColor", rerender);
        s.bind("weekday-color", "weekdayColor", rerender);
        s.bind("weekend-color", "weekendColor", rerender);
        s.bind("other-month-color", "otherMonthColor", rerender);
        s.bind("other-month-opacity", "otherMonthOpacity", rerender);
        s.bind("today-bg-color", "todayBgColor", rerender);
        s.bind("today-text-color", "todayTextColor", rerender);
        s.bind("today-style", "todayStyle", rerender);
        s.bind("cell-radius", "cellRadius", rerender);
        s.bind("tint-weekends", "tintWeekends", rerender);
        s.bind("weekend-tint-strength", "weekendTintStrength", rerender);
        s.bind("padding", "outerPadding", rerender);
        s.bind("show-grid-lines", "showGridLines", rerender);
        s.bind("grid-line-color", "gridLineColor", rerender);

        // Layout
        s.bind("week-start", "weekStartSetting", refetch);
        s.bind("week-numbering", "weekNumbering", rerender);
        s.bind("show-week-numbers", "showWeekNumbers", rerender);
        s.bind("week-number-color", "weekNumberColor", rerender);
        s.bind("rows", "rows", refetch);
        s.bind("month-format", "monthFormat", rerender);
        s.bind("show-navigation", "showNavigation", rerender);
        s.bind("nav-color", "navColor", rerender);
        s.bind("dim-other-months", "dimOtherMonths", rerender);

        // Turning the setting on means every future start shows the current
        // month, so the view moves there now rather than looking wrong until
        // the next restart. Turning it off freezes the month on screen as the
        // one to come back to.
        const onStartOnToday = () => {
            if (this.startOnToday) this._goToToday();
            else this._rememberView();
        };

        // Behaviour
        s.bind("start-on-today", "startOnToday", onStartOnToday);
        s.bind("mouse-wheel-navigation", "mouseWheelNavigation", rerender);

        // Events
        s.bind("show-events", "showEvents", () => {
            this._render();
            this._openOrCloseFeed();
        });
        s.bind("event-style", "eventStyle", rerender);
        s.bind("event-max", "eventMax", rerender);
        s.bind("event-time-format", "eventTimeFormat", rerender);
        s.bind("show-event-tooltips", "showEventTooltips", rerender);
        s.bind("event-refresh", "eventRefresh", () => {
            this._startEventTimer();
            this._refreshEvents();
        });
    }

    /**
     * Resolve the configured week start.
     *
     * "auto" defers to Cinnamon's own locale-derived setting so the desklet
     * agrees with the rest of the desktop; the rest are explicit overrides.
     */
    _firstDayOfWeek() {
        switch (this.weekStartSetting) {
            case "sunday": return 0;
            case "monday": return 1;
            case "saturday": return 6;
            default: {
                try {
                    return Cinnamon.util_get_week_start();
                } catch (e) {
                    return this._utils.firstDayOfWeekForLocale(this._systemLocale());
                }
            }
        }
    }

    _systemLocale() {
        try {
            // Language names look like "ro_RO.UTF-8". Intl accepts the
            // underscore form, but the charset suffix has to go.
            const names = GLib.get_language_names();
            if (names && names.length) {
                return String(names[0]).split(".")[0].replace("_", "-");
            }
        } catch (e) {
            // Fall through to the neutral default below.
        }
        return "en-US";
    }

    /** Whether event times are shown on a 24-hour clock. */
    _use24HourClock() {
        if (this.eventTimeFormat === "24") return true;
        if (this.eventTimeFormat === "12") return false;

        try {
            if (!this._interfaceSettings) {
                this._interfaceSettings = new Gio.Settings({ schema_id: CLOCK_24H_SCHEMA });
            }
            return this._interfaceSettings.get_boolean(CLOCK_24H_KEY);
        } catch (e) {
            // A missing schema is not worth an error; 24-hour is the
            // unambiguous fallback.
            return true;
        }
    }

    /* -------------------------------------------------------------- *
     * UI construction
     * -------------------------------------------------------------- */

    _buildUi() {
        this._root = new St.BoxLayout({
            vertical: true,
            style_class: "bigcal-root",
            reactive: true,
            track_hover: true
        });

        this._titleBar = new St.BoxLayout({
            style_class: "bigcal-titlebar",
            x_expand: true
        });

        this._prevButton = new St.Button({
            style_class: "bigcal-nav",
            label: "‹",
            can_focus: true
        });
        this._prevButton.connect("clicked", () => this._shiftMonth(-1));

        // The month is a button, not a label. Scrolling months away from today
        // is a one-way trip otherwise: there is no other way back, and after
        // dragging the desklet to another part of the desktop a user is left to
        // count clicks. Clicking the month returns to the current one.
        this._titleButton = new St.Button({
            style_class: "bigcal-title",
            x_expand: true,
            can_focus: true
        });
        this._titleButton.connect("clicked", () => this._goToToday());

        this._titleLabel = new St.Label({
            x_align: St.Align.MIDDLE,
            x_expand: true
        });
        this._titleButton.set_child(this._titleLabel);

        this._titleTip = new Tooltips.Tooltip(this._titleButton, "");

        // The way back to the current month, for anyone who has paged away
        // from it. Clicking the heading does the same thing -- and still does
        // -- but a heading is not a control, and nobody goes looking for one
        // there however it is tinted. So the way back is a button with a word
        // on it, and it is in the header only while there is somewhere to go
        // back to, which is also what makes its appearing mean something.
        this._todayButton = new St.Button({
            style_class: "bigcal-today",
            label: _("Today"),
            can_focus: true,
            visible: false
        });
        this._todayButton.connect("clicked", () => this._goToToday());

        this._nextButton = new St.Button({
            style_class: "bigcal-nav",
            label: "›",
            can_focus: true
        });
        this._nextButton.connect("clicked", () => this._shiftMonth(1));

        this._titleBar.add(this._prevButton, { y_align: St.Align.MIDDLE });
        this._titleBar.add(this._titleButton, { expand: true, y_align: St.Align.MIDDLE });
        this._titleBar.add(this._todayButton, { y_align: St.Align.MIDDLE });
        this._titleBar.add(this._nextButton, { y_align: St.Align.MIDDLE });

        // St.Table is what Cinnamon's own calendar uses for a month view; it
        // is the only layout in the toolkit that gives a true grid with
        // per-cell alignment.
        this._table = new St.Table({
            style_class: "bigcal-table",
            homogeneous: false,
            reactive: true
        });

        this._root.add(this._titleBar);
        this._root.add(this._table);

        this._root.connect("scroll-event", (actor, event) => {
            if (!this.mouseWheelNavigation) return Clutter.EVENT_PROPAGATE;
            const dir = event.get_scroll_direction();
            if (dir === Clutter.ScrollDirection.UP) this._shiftMonth(-1);
            else if (dir === Clutter.ScrollDirection.DOWN) this._shiftMonth(1);
            return Clutter.EVENT_STOP;
        });

        this.setContent(this._root);
    }

    /* -------------------------------------------------------------- *
     * Rendering
     * -------------------------------------------------------------- */

    _clearTable() {
        for (const child of this._table.get_children()) {
            this._table.remove_actor(child);
            child.destroy();
        }
        // The cells it describes are about to stop existing, and a tooltip
        // left up over one of them would go on describing a day that has been
        // redrawn -- or, after a month change, a day that is not on screen.
        this._dayTip.hide();
    }

    _render() {
        if (!this._table || !this._utils) return;

        this._clearTable();
        this._applyRootStyle();
        this._dayTip.setSurface(this.bgColor, this._basePoints());
        this._renderTitle();
        // The label widths memoised during the last render were measured
        // against the font size that has just been replaced.
        this._moreWidths.clear();

        const firstDay = this._firstDayOfWeek();
        // Week numbers need both the switch and a numbering convention; the
        // dependency in the schema cannot express "and" across two keys.
        const showWeekNumbers = !!this.showWeekNumbers && this.weekNumbering !== "none";

        const weeks = this._utils.buildMonthMatrix(this._view.year, this._view.month, firstDay, {
            rows: this.rows === "auto" ? "auto" : Number(this.rows) || 6,
            weekNumbering: showWeekNumbers ? this.weekNumbering : "none",
            today: this._today
        });

        this._renderWeekdayHeader(firstDay, showWeekNumbers);
        this._renderWeeks(weeks, showWeekNumbers);
    }

    _renderTitle() {
        this._titleLabel.set_text(this._utils.formatMonthYear(
            this._view.year, this._view.month, this._systemLocale(), this.monthFormat
        ));
        this._titleLabel.set_style("color: " + this.headerColor + ";");

        // On the current month there is nowhere to go, so the button reads as
        // the plain heading it used to be, and the "Today" button that would
        // take you there is not in the header at all.
        const away = this._view.year !== this._today.getFullYear() ||
                     this._view.month !== this._today.getMonth();
        this._todayButton.visible = away;
        this._todayButton.set_style("color: " + this.headerColor + ";");
        if (away) {
            if (!this._titleButton.has_style_class_name("bigcal-title-away"))
                this._titleButton.add_style_class_name("bigcal-title-away");
            this._titleTip.set_text(_("Click to return to the current month"));
        } else {
            if (this._titleButton.has_style_class_name("bigcal-title-away"))
                this._titleButton.remove_style_class_name("bigcal-title-away");
            this._titleTip.set_text("");
        }

        const navVisible = !!this.showNavigation;
        this._prevButton.visible = navVisible;
        this._nextButton.visible = navVisible;
        this._prevButton.set_style("color: " + this.navColor + ";");
        this._nextButton.set_style("color: " + this.navColor + ";");
    }

    _renderWeekdayHeader(firstDay, showWeekNumbers) {
        const names = this._utils.weekdayNames(this._systemLocale(), firstDay, "short");
        let col = 0;

        if (showWeekNumbers) {
            const corner = new St.Label({ style_class: "bigcal-weeknum", text: "#" });
            corner.set_style("color: " + this.weekNumberColor + ";");
            this._table.add(corner, { row: 0, col: 0, x_align: St.Align.MIDDLE });
            col = 1;
        }

        for (let i = 0; i < 7; i++) {
            // A column that is entirely weekend gets the weekend colour,
            // matching the day cells below it.
            const weekdayIndex = (firstDay + i) % 7;
            const isWeekend = (weekdayIndex === 0 || weekdayIndex === 6);
            const label = new St.Label({ style_class: "bigcal-weekday", text: names[i] });
            label.set_style("color: " + (isWeekend && this.tintWeekends
                ? this.weekendColor : this.weekdayColor) + ";" + this._gridLineStyle());
            this._table.add(label, { row: 0, col: col + i, x_align: St.Align.MIDDLE });
        }
    }

    _renderWeeks(weeks, showWeekNumbers) {
        for (let r = 0; r < weeks.length; r++) {
            const row = r + 1;
            let col = 0;

            if (showWeekNumbers && weeks[r].week) {
                const wn = new St.Label({
                    style_class: "bigcal-weeknum",
                    text: String(weeks[r].week.week)
                });
                wn.set_style("color: " + this.weekNumberColor + ";");
                wn.set_width(this._emToPx(WEEKNUM_WIDTH_EM));
                this._table.add(wn, { row: row, col: 0, x_align: St.Align.MIDDLE });
                col = 1;
            }

            for (let c = 0; c < 7; c++) {
                this._table.add(this._makeDayCell(weeks[r].days[c]), {
                    row: row, col: col + c,
                    x_align: St.Align.MIDDLE,
                    y_align: St.Align.MIDDLE
                });
            }
        }
    }

    /**
     * Build one day cell: the number, plus any event indicators.
     *
     * The number sits in its own box so that the "today" pill and weekend
     * tint hug the number rather than stretching to the full cell width.
     */
    _makeDayCell(cell) {
        const isToday = cell.isToday;
        const noHighlight = this.todayStyle === "none";
        const outside = !cell.inMonth;

        // Colours are resolved here rather than in the stylesheet so that one
        // stylesheet serves every theme and colour combination.
        //
        // Outside days always take the outside colour -- switching fading off
        // is meant to leave them at full strength, still distinguishable by
        // colour, not to make them identical to the current month.
        let color = this.textColor;
        if (cell.isWeekend && this.tintWeekends) color = this.weekendColor;
        if (outside) color = this.otherMonthColor;
        if (isToday && !noHighlight) color = this.todayTextColor;

        // Fading is the opacity, applied to whichever colour was chosen.
        if (outside && this.dimOtherMonths) {
            color = this._withAlpha(color, this.otherMonthOpacity / 100);
        }

        let numberCss = "color: " + color + ";" + this._gridLineStyle();

        // Today emphasis: filled pill, outline ring, or bold text only.
        if (isToday && this.todayStyle === "filled") {
            numberCss += " background-color: " + this.todayBgColor + ";";
            numberCss += " border-radius: " + this.cellRadius + "px;";
        } else if (isToday && this.todayStyle === "ring") {
            numberCss += " border: 2px solid " + this.todayBgColor + ";";
            numberCss += " border-radius: " + this.cellRadius + "px;";
        } else if (isToday && this.todayStyle === "bold") {
            numberCss += " font-weight: bold;";
        } else if (cell.isWeekend && this.tintWeekends &&
                   this.weekendTintStrength > 0 && !isToday) {
            numberCss += " background-color: " +
                this._withAlpha(this.weekendColor, this.weekendTintStrength / 100) + ";";
            numberCss += " border-radius: " + this.cellRadius + "px;";
        }

        const number = new St.Label({ style_class: "bigcal-day", text: String(cell.day) });
        number.set_style(numberCss);

        const holder = new St.Bin({ style_class: "bigcal-dayholder" });
        holder.set_child(number);

        const box = new St.BoxLayout({ vertical: true, style_class: "bigcal-cell", reactive: true });
        box.set_style(CELL_PADDING);
        // Wide enough for the widest thing that has to fit, which in the
        // titles style is the title rather than the day number.
        box.set_width(this._emToPx(this.eventStyle === "titles"
            ? Math.max(CELL_WIDTH_EM, TITLE_WIDTH_EM)
            : CELL_WIDTH_EM));
        box.add(holder, { x_fill: false, x_expand: true });

        // Bars and titles read as a block, so they span the cell; a row of
        // dots looks better centred under the number.
        const area = this._buildEventArea(cell);
        const blocked = this.eventStyle === "bars" || this.eventStyle === "titles";
        box.add(area, blocked
            ? { x_fill: true, x_expand: true }
            : { x_fill: false, x_expand: true, x_align: St.Align.MIDDLE });

        const entries = this._entriesFor(cell);
        if (this.showEventTooltips && entries.length) {
            this._dayTip.watch(box, this._tooltipRows(cell, entries));
        }

        return box;
    }

    /** The events recorded for a grid cell. */
    _entriesFor(cell) {
        if (!this.showEvents || !this._index) return [];
        return this._index.eventsOnDay(this._eventIndex, cell.year, cell.month, cell.day);
    }

    /** The indicator strip under a day number. */
    _buildEventArea(cell) {
        const entries = this._entriesFor(cell);
        if (!entries.length || this.eventStyle === "none") {
            // Keep an empty actor so every cell is the same height and the
            // grid does not go ragged between rows.
            const empty = new St.Bin({ style_class: "bigcal-events" });
            empty.set_style(EVENTS_PADDING);
            empty.set_height(this._emToPx(EVENTS_MIN_HEIGHT_EM));
            return empty;
        }

        const shown = entries.slice(0, Math.max(1, Number(this.eventMax) || 3));
        const hidden = entries.length - shown.length;

        if (this.eventStyle === "titles") {
            const list = new St.BoxLayout({ vertical: true, style_class: "bigcal-eventlist" });
            for (const entry of shown) {
                const label = new St.Label({
                    style_class: "bigcal-eventtitle",
                    text: this._eventLabel(entry)
                });
                label.set_style("color: " + entry.event.color + ";");
                // St ignores width and max-width on a label, and an
                // unconstrained label reports its full natural width -- so
                // without an explicit pixel width a single long event name
                // widens its column and skews the whole grid.
                label.set_width(this._emToPx(TITLE_WIDTH_EM));
                label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                list.add(label, { x_fill: true, x_expand: true });
            }
            if (hidden > 0) {
                list.add(this._moreLabel(hidden));
            }
            return list;
        }

        if (this.eventStyle === "bars") {
            const list = new St.BoxLayout({ vertical: true, style_class: "bigcal-eventbars" });
            for (const entry of shown) {
                const bar = new St.Bin({ style_class: "bigcal-eventbar" });
                bar.set_style("background-color: " + entry.event.color + ";");
                list.add(bar);
            }
            if (hidden > 0) {
                list.add(this._moreLabel(hidden));
            }
            return list;
        }

        // Default: a row of coloured dots.
        //
        // How many are drawn is decided here rather than taken straight from
        // event-max, because the cell cannot hold eight of them and the setting
        // offers eight. The dots scale with the text size and the gap between
        // them does not, so eight overflowed the cell by two pixels at the
        // default text size and the row spilled over the days either side.
        // Measured, not calculated: six fit at 100% and seven at 200%.
        const room = this._emToPx(CELL_WIDTH_EM) - CELL_PADDING_X * 2;
        const size = this._emToPx(DOT_SIZE_EM);

        let fits = this._dotsThatFit(room, size);
        let more = null;

        if (entries.length > fits) {
            // A "+N" label needs a place in the same row, so the dots give up
            // the width of it. Measured at the full count, which is the widest
            // the label will ever be in this cell -- the count only shrinks
            // from there, as dots win back the space.
            const label = this._moreLabelWidth(entries.length);
            const withLabel = Math.floor((room - label) / (size + DOT_GAP_PX));

            if (withLabel >= 1) {
                fits = withLabel;
                more = this._moreLabel(entries.length);
            }
            // With no room for a dot and the label both, the label is simply
            // left off: a day with events should show dots, and the count is
            // in the tooltip anyway.
        }

        const visible = shown.slice(0, fits);
        const extra = entries.length - visible.length;

        const dots = new St.BoxLayout({ style_class: "bigcal-eventdots" });
        for (const entry of visible) {
            const dot = new St.Bin({ style_class: "bigcal-eventdot" });
            dot.set_style("background-color: " + entry.event.color +
                "; border-radius: " + Math.round(size / 2) + "px;");
            dot.set_size(size, size);
            dots.add(dot);
        }

        // Only ever the label reserved for above. Rebuilding it when it was
        // dropped for want of room would put back the width the row just gave
        // up, and 5 dots that had been sized to fill the cell exactly would
        // then carry an 8px label past its edge. `more` survives only when a
        // dot fits beside it, which also means `extra` is at least one.
        if (more) {
            more.set_text("+" + extra);
            dots.add(more);
        }

        return dots;
    }

    /**
     * How many event dots of `size` pixels fit in `room` pixels.
     *
     * n dots occupy n*size + (n-1)*gap, so n fits while n <= (room+gap)/(size+gap).
     * Never returns less than one: a day with events must show something, even
     * if the desklet has been scaled down to where a dot only just fits.
     */
    _dotsThatFit(room, size) {
        return Math.max(1, Math.floor((room + DOT_GAP_PX) / (size + DOT_GAP_PX)));
    }

    /** An actor's natural width in pixels, before anything is allocated. */
    _naturalWidth(actor) {
        try {
            return actor.get_preferred_width(-1)[1];
        } catch (e) {
            return 0;
        }
    }

    /**
     * How wide the "+N" label is when it reads "+count".
     *
     * The obvious way to ask -- build the label and measure it -- does not
     * work, and fails in both directions. An St.Label with no parent has no
     * theme context, so the font size set on it is never applied and it
     * answers with the width of the default font instead: a flat 32px for any
     * text size at all. That is a harmless over-estimate while the text is
     * small and a real under-estimate once it is not, since at the largest
     * setting the label really is 98px wide. A row sized against 32 would then
     * spill a good way past its cell.
     *
     * So the label is measured where it will be themed -- as a child of the
     * root, which the desklet has already styled by this point -- and taken
     * away again in the same turn of the loop, before anything can be painted.
     * Should the root not be themed yet, the measurement degrades to the
     * unparented one, which is the conservative direction at that size.
     *
     * Results are memoised per render: the font is the same for every cell,
     * so the width depends only on the text, and most days want the same one.
     */
    _moreLabelWidth(count) {
        const text = "+" + count;
        let width = this._moreWidths.get(text);

        if (width === undefined) {
            const probe = this._moreLabel(count);
            width = 0;
            try {
                this._root.add_child(probe);
                width = this._naturalWidth(probe);
            } catch (e) {
                width = this._naturalWidth(probe);
            } finally {
                try {
                    this._root.remove_child(probe);
                } catch (e) { /* never added */ }
                probe.destroy();
            }
            this._moreWidths.set(text, width);
        }
        return width;
    }

    /**
     * The "+N" label closing a day's indicator strip.
     *
     * Its size and colour are set here rather than left to the stylesheet, and
     * not only for the reason the other inline styles exist. The size has to be
     * readable *before* the label is placed: the branch that builds a row asks
     * how wide the label is in order to decide how many dots it can keep, and
     * that question is asked while the label still has no parent. An unparented
     * widget has no theme context, so a font-size from the stylesheet has not
     * been applied to it and it reports the width of a much larger default
     * font -- 24px where the real label is 8px at the smallest text size, and
     * the reservation came out four times too wide for it.
     *
     * So the stylesheet carries no font-size for this label, and this is the
     * one place that decides it.
     */
    _moreLabel(hidden) {
        const label = new St.Label({
            style_class: "bigcal-eventmore",
            text: "+" + hidden
        });
        label.set_style("color: " + MORE_LABEL_COLOR +
            "; font-size: " + this._emToPx(MORE_LABEL_EM) + "px;");
        return label;
    }

    /** A short label for an event, used by the "titles" style. */
    _eventLabel(entry) {
        const ev = entry.event;
        if (ev.allDay) return ev.summary || _("All day");
        // describeEntry, not a start time: on the second day of an event that
        // runs past midnight the start time is on a different day.
        return this._index.describeEntry(entry, this._use24HourClock());
    }

    /**
     * The rows a day's tooltip is built from: the date, then one row per event.
     *
     * The date leads because the tooltip is the only place the day is written
     * out in full -- the cell itself is a bare number with no month beside it,
     * so a tooltip that opened with the events left the reader to work out
     * which day they belonged to.
     *
     * The colour is `entry.event.color` -- the same value the dots and bars are
     * painted with -- so a tooltip row cannot drift out of step with the cell
     * it describes. There is no second copy of it to keep in sync; all the
     * tooltip does with it is make it readable on its own surface.
     */
    _tooltipRows(cell, entries) {
        const rows = [{ text: this._longDate(cell), date: true }];

        for (const entry of entries.slice(0, TOOLTIP_MAX_EVENTS)) {
            rows.push({
                // Carries the start time for a timed event, in whichever clock
                // the settings ask for; see describeEntry.
                text: this._index.describeEntry(entry, this._use24HourClock()),
                color: entry.event ? entry.event.color : null
            });
        }
        if (entries.length > TOOLTIP_MAX_EVENTS) {
            rows.push({
                text: "+" + (entries.length - TOOLTIP_MAX_EVENTS) + " " + _("more")
            });
        }
        return rows;
    }

    _longDate(cell) {
        try {
            return this._utils.getFormatter(this._systemLocale(), {
                weekday: "long", year: "numeric", month: "long", day: "numeric"
            }).format(new Date(cell.year, cell.month, cell.day));
        } catch (e) {
            return cell.year + "-" + (cell.month + 1) + "-" + cell.day;
        }
    }

    /**
     * A length in ems of the root font, as pixels.
     *
     * Converted from the point size the root font-size is set to, at the dpi
     * the toolkit resolves points with -- which is not a constant. It is 96 on
     * most desktops, so a hardcoded 96 looked correct, but Clutter takes it
     * from the display and it is 192 at 2x scaling, 110-odd on some panels. St
     * converts the pt in the stylesheet using that same number, so reading it
     * here is what keeps the widths computed in JS in step with the font the
     * theme renders. Assuming 96 on a 2x screen sizes every label for half the
     * text it holds.
     */
    _emToPx(em) {
        const points = 11 * (this.fontScale / 100);
        return Math.round(em * points * (this._fontDpi() / 72));
    }

    /**
     * Clutter's font dpi as a plain number.
     *
     * The property is scaled by 1024 (Pango's unit), so 98304 is 96. Falls back
     * to 96 rather than throwing: a wrong width is better than a desklet that
     * will not draw, and 96 is what the overwhelming majority of displays use.
     */
    _fontDpi() {
        try {
            return Clutter.Settings.get_default().font_dpi / 1024;
        } catch (e) {
            return 96;
        }
    }

    // St's CSS supports rgba() but not colour arithmetic, so a colour has to
    // be converted before it can be given an alpha.
    _withAlpha(color, alpha) {
        let r = 255, g = 255, b = 255;
        const value = String(color).trim();
        if (/^#[0-9a-fA-F]{6}$/.test(value)) {
            r = parseInt(value.substr(1, 2), 16);
            g = parseInt(value.substr(3, 2), 16);
            b = parseInt(value.substr(5, 2), 16);
        } else if (/^#[0-9a-fA-F]{3}$/.test(value)) {
            r = parseInt(value[1] + value[1], 16);
            g = parseInt(value[2] + value[2], 16);
            b = parseInt(value[3] + value[3], 16);
        } else if (/^rgb/.test(value)) {
            const m = value.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
            if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
        } else {
            return value;
        }
        return "rgba(" + r + ", " + g + ", " + b + ", " + alpha.toFixed(2) + ")";
    }

    _applyRootStyle() {
        let css = "background-color: " + this._withAlpha(this.bgColor, this.bgOpacity / 100) + ";";
        css += " border-radius: " + this.cornerRadius + "px;";
        css += " padding: " + this.outerPadding + "px;";
        if (this.borderWidth > 0) {
            css += " border: " + this.borderWidth + "px solid " + this.borderColor + ";";
        }
        // The base font size is set on the root so the text below scales with
        // the setting. Note this reaches the children's *glyphs* only: an em
        // length resolved by the stylesheet is worked out against whichever
        // font a widget had when its theme node was built, and a desklet's
        // first render builds every node before this size has been handed
        // down. So no length that matters is written in ems; they are all
        // converted to pixels by _emToPx() and set in JS.
        this._root.set_style(css + " font-size: " + this._basePoints() + "pt;");
    }

    /**
     * The desklet's text size in points, from the scale setting.
     *
     * One place, because two things are sized from it and they have to agree:
     * the root, whose font every cell inherits, and the tooltip, which sits in
     * the uiGroup outside the desklet and inherits nothing.
     */
    _basePoints() {
        return (11 * (this.fontScale / 100)).toFixed(1);
    }

    /** Optional 1px rule around every cell. */
    _gridLineStyle() {
        return this.showGridLines ? " border: 1px solid " + this.gridLineColor + ";" : "";
    }

    /* -------------------------------------------------------------- *
     * Events
     * -------------------------------------------------------------- */

    /**
     * Fetch events for the visible grid and re-render.
     *
     * The fetch token guards against out-of-order responses: paging through
     * months quickly starts several queries, and only the newest may win.
     */
    async _refreshEvents() {
        if (this._destroyed || !this._feed || !this.showEvents) return;

        // Retry any calendar that failed to connect, and pick up any account
        // added since. Cheap and idempotent: a calendar already open is left
        // alone, and no connection is attempted for it. This is what makes the
        // periodic refresh able to recover on its own -- without it a calendar
        // that was unreachable when the desklet started stayed missing until
        // Cinnamon was restarted.
        try {
            await this._feed.open();
        } catch (e) {
            logError(e, "Big Calendar: could not open calendars");
        }
        if (this._destroyed) return;

        const token = ++this._fetchToken;
        const range = this._utils.gridRange(
            this._view.year, this._view.month, this._firstDayOfWeek(),
            this.rows === "auto" ? "auto" : Number(this.rows) || 6
        );

        let events;
        try {
            events = await this._feed.query(range.start.getTime(), range.end.getTime());
        } catch (e) {
            logError(e, "Big Calendar: event query failed");
            return;
        }

        if (this._destroyed || token !== this._fetchToken) return;

        // The grid's own first and last days, so the index covers exactly what
        // is on screen. range.start is local midnight of the first drawn day
        // and range.end is local midnight *after* the last, so the last day is
        // the day before it.
        const from = this._index.dayKey(
            range.start.getFullYear(), range.start.getMonth(), range.start.getDate());
        const lastDay = new Date(range.end.getTime() - 1);
        const to = this._index.dayKey(
            lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate());

        this._eventIndex = this._index.buildEventIndex(events, from, to);
        this._render();
    }

    /** Start or stop the event fetch loop to match the current settings. */
    _openOrCloseFeed() {
        if (this.showEvents && this._source && !this._feed) {
            this._openFeed();
            return;
        }
        if (this.showEvents) return;

        this._stopEventTimer();

        // Dropping the reference is not enough: the feed holds a cancellable
        // and live client connections, and a query already in flight would
        // otherwise resolve into the now event-less desklet. destroy() cancels
        // it. Without this, turning events off and then removing the desklet
        // left the connection running for the life of the session.
        if (this._feed) {
            this._feed.destroy();
            this._feed = null;
        }
        this._eventIndex = {};
    }

    _startEventTimer() {
        this._stopEventTimer();
        if (!this._feed) return;

        const minutes = Math.max(5, Number(this.eventRefresh) || 20);
        this._eventTimer = Mainloop.timeout_add_seconds(minutes * 60, () => {
            this._refreshEvents();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopEventTimer() {
        if (this._eventTimer > 0) {
            Mainloop.source_remove(this._eventTimer);
            this._eventTimer = 0;
        }
    }

    /**
     * Redraw when the date changes under a running desklet.
     *
     * Without this the "today" marker would sit on yesterday's date from
     * midnight until the next settings change -- a desklet is expected to
     * survive for weeks.
     */
    _startDayTimer() {
        this._stopDayTimer();
        this._dayTimer = Mainloop.timeout_add_seconds(DAY_CHECK_SECONDS, () => {
            const now = new Date();
            if (!this._utils.sameDay(now, this._today)) {
                this._today = now;
                this._render();
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopDayTimer() {
        if (this._dayTimer > 0) {
            Mainloop.source_remove(this._dayTimer);
            this._dayTimer = 0;
        }
    }

    /* -------------------------------------------------------------- *
     * Interaction
     * -------------------------------------------------------------- */

    /**
     * Reopen on the month last viewed, for users who turned off
     * "open on the current month". Without this the setting would promise
     * something it does not do, since the constructor always starts on today.
     */
    _restoreView() {
        if (this.startOnToday) return;

        const match = /^(\d{4})-(\d{1,2})$/.exec(String(this.settings.getValue(LAST_VIEW_KEY) || ""));
        if (!match) return;

        const month = Number(match[2]);
        if (month < 0 || month > 11) return;

        this._view.year = Number(match[1]);
        this._view.month = month;
    }

    /** Remember the month being viewed, so it can be restored on next start. */
    _rememberView() {
        if (!this.settings) return;
        this.settings.setValue(LAST_VIEW_KEY, this._view.year + "-" + this._view.month);
    }

    _shiftMonth(delta) {
        const next = this._utils.addMonths(this._view.year, this._view.month, delta);
        this._view.year = next.year;
        this._view.month = next.month;
        this._rememberView();
        this._render();
        this._refreshEvents();
    }

    _goToToday() {
        this._today = new Date();
        this._view.year = this._today.getFullYear();
        this._view.month = this._today.getMonth();
        this._rememberView();

        if (!this._ready) return;
        this._render();
        this._refreshEvents();
    }

    /* -------------------------------------------------------------- *
     * Lifecycle
     * -------------------------------------------------------------- */

    /**
     * Whether a window that would sit above the desklet covers part of it.
     *
     * The desktop window covers the whole screen and sits *below* the desklet,
     * so it is not one of them, and neither is a dock, which has its own claim
     * on the input region. Everything else -- a normal window, a dialog, a menu
     * -- is above the desklet and takes the clicks in the overlap.
     */
    _windowOverlaps() {
        const [x, y] = this.actor.get_transformed_position();
        const [w, h] = this.actor.get_transformed_size();
        if (!w || !h) return false;

        const workspace = global.workspace_manager.get_active_workspace();

        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window;
            if (!win || win.minimized) continue;

            const type = win.get_window_type();
            if (type === Meta.WindowType.DESKTOP || type === Meta.WindowType.DOCK)
                continue;
            if (!win.is_on_all_workspaces() && win.get_workspace() !== workspace)
                continue;

            const r = win.get_frame_rect();
            if (r.x < x + w && r.x + r.width > x && r.y < y + h && r.y + r.height > y)
                return true;
        }

        return false;
    }

    /**
     * Track the mouse over the desklet -- except while a window is over it.
     *
     * Cinnamon follows the mouse over a desklet by tracking it as "chrome", and
     * a tracked actor is added to the stage's input region (`affectsInputRegion`
     * in layout.js defaults to true). That region belongs to the compositor's
     * own window, which is above every application window, so while the desklet
     * holds it, no window underneath receives clicks or motion in the overlap.
     *
     * It is also the only thing that delivers mouse events to the desklet at
     * all. The day tooltips hang off the cell's `motion-event`, and that arrives
     * only if the desklet is in the region -- so dropping the claim does not
     * merely stop the desklet intercepting clicks, it turns the desklet inert.
     * That was tried here, and it is what killed the tooltips.
     *
     * What the desklet must not do is hold the claim while a window is over it.
     * Cinnamon has its own guard for that in deskletManager, but it asks
     * whether a window is under the *pointer*, twice a second. The pointer is
     * the wrong thing to ask about: a window covering half the desklet goes on
     * losing clicks in that half for as long as the pointer sits on the
     * desklet's other half, because Cinnamon never sees a reason to let go. The
     * settings dialog is the same case and worse -- its tab row lies inside the
     * desklet's rectangle, so a claim held even briefly swallows the click that
     * was meant to switch tabs.
     *
     * So the rule here is the one Cinnamon means: hold the input region while
     * the desklet has the desktop to itself, and give it up while anything is
     * over it. Handing it back costs the hover, which is why `_startInputTimer`
     * watches for that rather than letting it lapse for half a second.
     */
    _trackMouse() {
        if (this._windowOverlaps()) return;

        if (Main.layoutManager.isTrackingChrome(this.actor)) return;

        Main.layoutManager.addChrome(this.actor, { doNotAdd: true });
        this._isTracked = true;
    }

    /** Hold the input region exactly when nothing is on top of the desklet. */
    _syncInputRegion() {
        if (this._windowOverlaps()) this._untrackMouse();
        else this._trackMouse();
    }

    /**
     * The id is checked against the context rather than merely tested for
     * having a value, so that a timer detached behind the desklet's back is
     * replaced instead of believed in. INPUT_WATCHDOG_SEC has the story.
     */
    _startInputTimer() {
        this._startInputWatchdog();

        if (this._inputTimer && this._sourceAlive(this._inputTimer)) return;

        this._inputTimer = Mainloop.timeout_add(INPUT_RECONCILE_MS, () => {
            if (this._destroyed) {
                this._inputTimer = null;
                return GLib.SOURCE_REMOVE;
            }
            this._syncInputRegion();
            return GLib.SOURCE_CONTINUE;
        });
    }

    /**
     * Restarts the reconcile timer if it has gone. Nothing else would: the
     * desklet's own way back to life is the mouse, and a desklet that has lost
     * its timer has stopped answering the mouse. See INPUT_WATCHDOG_SEC.
     */
    _startInputWatchdog() {
        if (this._inputWatchdog && this._sourceAlive(this._inputWatchdog)) return;

        this._inputWatchdog = Mainloop.timeout_add_seconds(INPUT_WATCHDOG_SEC, () => {
            if (this._destroyed) {
                this._inputWatchdog = null;
                return GLib.SOURCE_REMOVE;
            }
            this._startInputTimer();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _sourceAlive(id) {
        return !!GLib.MainContext.default().find_source_by_id(id);
    }

    /**
     * The field is cleared first for a reason. It is not only an exception
     * escaping `_syncInputRegion()` that can leave the id behind while GLib has
     * already let the source go -- a collection running while this callback is
     * pending can do it too, without any JavaScript running at all. CJS sets up
     * a timeout with `GObject.source_set_closure()`, whose boolean result GLib
     * initialises to false; if the runtime refuses to enter JS during the sweep,
     * that false removes the source on our behalf. Clearing the field before the
     * call means the stale id cannot be left behind by anything below it.
     */
    _stopInputTimer() {
        for (const field of ["_inputTimer", "_inputWatchdog"]) {
            const id = this[field];
            this[field] = null;
            if (!id) continue;

            // Mainloop.source_remove() warns when the id is no longer attached
            // -- see overrides.js, which dumps a stack through the log. Asking
            // first turns that into a no-op.
            if (this._sourceAlive(id)) Mainloop.source_remove(id);
        }
    }

    on_desklet_added_to_desktop() {
        this._startInputTimer();

        if (!this.startOnToday) return;

        // _goToToday() is a no-op for the view until the bootstrap has run,
        // so re-apply it here for the case where the desklet was added with
        // "open on the current month" enabled.
        if (this._ready) this._goToToday();
    }

    on_desklet_removed() {
        this._destroyed = true;

        // Give up the input region here, and stop being reactive, rather than
        // leaving both to the actor's destruction.
        //
        // Cinnamon does destroy the actor, but only after this returns and only
        // if it returns: Desklet.destroy() nulls the menu, starts a fade, and
        // calls this from the fade's onComplete with `this.actor.destroy()` as
        // the next statement. Everything here is therefore on the critical path
        // for that. A desklet that throws, or whose onComplete never runs,
        // leaves a mapped actor at opacity 0 -- invisible, but still reactive
        // and still holding the input region, so it goes on swallowing clicks
        // over a rectangle of desktop nobody can see. It cannot open its own
        // menu any more either, so each of those clicks raises inside Cinnamon:
        // "TypeError: this._menu is null", from _onButtonReleaseEvent.
        //
        // Both lines are cheap and both make that failure benign -- at worst a
        // transparent rectangle where a dead patch of desktop used to be.
        this._untrackMouse();
        if (this.actor) this.actor.reactive = false;

        this._stopDayTimer();
        this._stopEventTimer();
        this._stopInputTimer();

        // The title's tooltip is Cinnamon's and lives for as long as the
        // desklet does. The day tooltip is ours and stands in Main.uiGroup
        // rather than in the desklet's own actor, so nothing else would take
        // it down with the desklet.
        if (this._titleTip) {
            this._titleTip.destroy();
            this._titleTip = null;
        }

        if (this._dayTip) {
            this._dayTip.destroy();
            this._dayTip = null;
        }

        // Cancels any query still in flight so it cannot call back into
        // torn-down actors.
        if (this._feed) {
            this._feed.destroy();
            this._feed = null;
        }

        // Removes every settings binding and disconnects its signals, so the
        // configuration dialog cannot reach into a desklet that is gone.
        //
        // The unregister is guarded, because it is the one part that touches
        // shared state. Cinnamon destroys a desklet from inside its fade-out
        // animation, so this runs a moment later -- long enough for a reload to
        // have brought the replacement up under the same uuid and instance id.
        // Unregistering then would null the *new* instance's entry, and the
        // configuration dialog, which finds the live desklet through that
        // entry, would silently stop applying changes until the next restart.
        //
        // It is only the unregister, though. Unbinding the 38 bind() calls and
        // disconnecting the signals are local to this object and always have to
        // happen, or every one of them outlives the desklet that made it.
        // finalize() does all three -- see settings.js, whose finalize() is
        // exactly these three calls -- so it is taken apart here rather than
        // called, to skip the first alone.
        if (this.settings) {
            const settings = this.settings;
            this.settings = null;

            const registry = Main.settingsManager.uuids[settings.uuid];
            if (!registry || registry[settings.instanceId] === settings) {
                Main.settingsManager.unregister(settings.uuid, settings.instanceId);
            }

            for (const key in settings.bindings) {
                settings.unbindAll(key);
            }
            settings.disconnectAll();
        }
    }
}

// Must be a function declaration: Cinnamon's loader looks it up by name on
// the module object, which only exports var and function declarations.
function main(metadata, desklet_id) {
    return new BigCalendarDesklet(metadata, desklet_id);
}
