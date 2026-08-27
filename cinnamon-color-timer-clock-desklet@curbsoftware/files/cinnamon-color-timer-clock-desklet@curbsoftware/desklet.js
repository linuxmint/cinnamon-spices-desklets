/* global imports, global */
const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Main = imports.ui.main;
const Tooltips = imports.ui.tooltips;
const Gettext = imports.gettext;
const GLib = imports.gi.GLib;
const Pango = imports.gi.Pango;
const Clutter = imports.gi.Clutter;

const uuid = "cinnamon-color-timer-clock-desklet@curbsoftware";

Gettext.bindtextdomain(uuid, GLib.get_user_data_dir() + "/locale");

function _(str) {
    return Gettext.dgettext(uuid, str);
}

/* Xlet-local module. Cinnamon exposes a desklet's own directory through
 * imports.ui.deskletManager.desklets[uuid]; resolved lazily in _init() so a
 * load-order problem surfaces as a logged error instead of a load failure. */
let CardActions = null;

function _loadModules(deskletPath) {
    if (CardActions)
        return true;
    const dirs = [];
    try { dirs.push(imports.ui.deskletManager.desklets[uuid]); } catch (e) {}
    try { dirs.push(imports.desklets[uuid]); } catch (e) {}
    for (let i = 0; i < dirs.length; i++) {
        if (dirs[i] && dirs[i].cardActions) {
            CardActions = dirs[i].cardActions;
            return true;
        }
    }
    if (deskletPath) {
        try {
            imports.searchPath.unshift(deskletPath);
            CardActions = imports.cardActions;
            if (CardActions)
                return true;
        } catch (e) {
            global.logError(uuid + " could not import cardActions from " + deskletPath + ": " + e);
        }
    }
    global.logError(uuid + " could not load helper modules");
    return false;
}

function _formatStrftime(date, fmt, tzName) {
    if (!fmt)
        return "";
    try {
        let tz;
        if (tzName && String(tzName).trim())
            tz = GLib.TimeZone.new(String(tzName).trim());
        else
            tz = GLib.TimeZone.new_local();
        let dt = GLib.DateTime.new_from_unix_utc(Math.floor(date.getTime() / 1000));
        if (tz)
            dt = dt.to_timezone(tz);
        let out = dt.format(fmt);
        if (out)
            return out;
    } catch (e) {}
    try {
        if (date && typeof date.toLocaleFormat === "function") {
            let out = date.toLocaleFormat(fmt);
            if (out)
                return out;
        }
    } catch (e2) {}
    return "";
}

const DEFAULT_TIME_FORMAT = "%H:%M:%S";
const DEFAULT_DATE_FORMAT = "%A, %e %B";

/* Literal _() call sites so cinnamon-xlet-makepot extracts each title;
 * the values are translated once here, not at every use. */
const CARD_TITLES = {
    clock: _("Clock"),
    timer: _("Timer"),
    chrono: _("Chronometer")
};

const TIMER_PHASES = ["stopped", "paused", "running", "expired"];
const CHRONO_PHASES = ["stopped", "paused", "running"];

/* A timer that finished while the desklet was unloaded only re-notifies when
 * it expired recently; a stale expiry from hours or days ago is not worth a
 * startup pop. Covers cinnamon --replace and quick reboots, skips the rest. */
const STALE_EXPIRY_MS = 10 * 60 * 1000;

function _pad2(n) {
    return n < 10 ? "0" + n : "" + n;
}

/**
 * _formatDuration:
 * @ms (number): duration in milliseconds
 * @ceil (boolean): round up (countdown display: 00:00 only when really done)
 *   instead of down (elapsed display)
 * @hundredths (boolean): append a ".cc" fraction (elapsed display only; a
 *   countdown rounding up cannot show a stable fraction)
 *
 * Returns (string): "mm:ss", "mm:ss.cc", or "h:mm:ss(.cc)" past an hour.
 */
function _formatDuration(ms, ceil, hundredths) {
    const total = Math.max(0, Number(ms) || 0);
    const secs = ceil ? Math.ceil(total / 1000) : Math.floor(total / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    let out = h > 0 ? h + ":" + _pad2(m) + ":" + _pad2(s) : _pad2(m) + ":" + _pad2(s);
    if (hundredths && !ceil)
        out += "." + _pad2(Math.floor((total % 1000) / 10));
    return out;
}

function _centerLabelText(label) {
    if (!label || !label.clutter_text)
        return;
    try {
        label.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
        if (Clutter.ActorAlign)
            label.clutter_text.x_align = Clutter.ActorAlign.CENTER;
    } catch (e) {}
}

/* ReloadXlet refreshes desklet.js but GJS can retain an older imported
 * cardActions module. Keep small fallbacks here so a helper cache never
 * disables responsive layout or next-stop metadata until Cinnamon restarts. */
function _responsiveGrid(cardCount, width, spacing) {
    if (CardActions && typeof CardActions.computeResponsiveGrid === "function" &&
        CardActions.CARD_LAYOUT && CardActions.CARD_LAYOUT.minCardWidth >= 250)
        return CardActions.computeResponsiveGrid(cardCount, width, spacing);
    const count = Math.max(1, parseInt(cardCount, 10) || 1);
    const deskletWidth = Number(width) > 0 ? Number(width) : 840;
    const gap = Math.max(0, Number(spacing) || 0);
    const available = Math.max(1, deskletWidth - 8);
    const cols = Math.max(1, Math.min(count, Math.floor(available / (250 + 2 * gap))));
    return { rows: Math.ceil(count / cols), cols: cols };
}

function _responsiveHeight(rows, height, spacing) {
    if (CardActions && typeof CardActions.computeResponsiveHeight === "function")
        return CardActions.computeResponsiveHeight(rows, height, spacing);
    const count = Math.max(1, parseInt(rows, 10) || 1);
    const base = Number(height) > 0 ? Number(height) : 260;
    const gap = Math.max(0, Number(spacing) || 0);
    return Math.max(base, count * (124 + 2 * gap) + 8);
}

function _nextScheduleStop(stops, pos, opts) {
    if (CardActions && typeof CardActions.nextStop === "function")
        return CardActions.nextStop(stops, pos, opts);
    opts = opts || {};
    const list = Array.isArray(stops) ? stops.filter(function (stop) {
        return stop && Number.isFinite(stop.t) && Array.isArray(stop.rgba);
    }).slice().sort(function (a, b) { return a.t - b.t; }) : [];
    if (list.length === 0)
        return null;
    let q = Number(pos);
    if (!Number.isFinite(q))
        q = 0;
    if (opts.wrap)
        q = ((q % 86400) + 86400) % 86400;
    if (opts.reverse) {
        for (let i = list.length - 1; i >= 0; i--) {
            if (list[i].t < q)
                return { t: list[i].t, rgba: list[i].rgba.slice() };
        }
        return null;
    }
    for (let i = 0; i < list.length; i++) {
        if (list[i].t > q)
            return { t: list[i].t, rgba: list[i].rgba.slice() };
    }
    return opts.wrap ? { t: list[0].t, rgba: list[0].rgba.slice() } : null;
}

function CardWidget(kind, desklet) {
    this._init(kind, desklet);
}

CardWidget.prototype = {
    _init: function (kind, desklet) {
        this.desklet = desklet;
        this.kind = kind;

        this.actor = new St.BoxLayout({
            style_class: "ctc-card",
            vertical: true
        });

        this._title = new St.Label({
            style_class: "ctc-card-title",
            text: CARD_TITLES[kind] || kind
        });
        this._value = new St.Label({ style_class: "ctc-card-value" });
        this._sub = new St.Label({ style_class: "ctc-card-sub" });

        try {
            this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            this._title.clutter_text.line_wrap = false;
            this._value.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            this._value.clutter_text.line_wrap = false;
            this._sub.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            this._sub.clutter_text.line_wrap = false;
        } catch (e) {}
        _centerLabelText(this._title);
        _centerLabelText(this._value);
        _centerLabelText(this._sub);

        /* Keep title, value and subtitle as one centered reading group. This
         * avoids a title stranded at the top and a large empty pocket below
         * the value on taller cards. The footer remains anchored at bottom. */
        this._content = new St.BoxLayout({
            vertical: true,
            style_class: "ctc-card-content"
        });
        this._content.add(this._title, {
            x_fill: true,
            x_align: St.Align.MIDDLE
        });
        this._body = new St.BoxLayout({
            vertical: true,
            style_class: "ctc-card-body"
        });
        this._body.add(this._value, { x_fill: false, x_align: St.Align.MIDDLE });
        this._body.add(this._sub, { x_fill: false, x_align: St.Align.MIDDLE });
        this._content.add(this._body, {
            x_fill: true,
            x_align: St.Align.MIDDLE
        });
        this.actor.add(this._content, {
            expand: true,
            x_fill: true,
            y_fill: false,
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE
        });

        this._swatch = new St.DrawingArea({ reactive: true });
        this._swatch.set_width(20);
        this._swatch.set_height(20);
        this._swatchColor = null;
        this._swatch.connect("repaint", () => this._paintSwatch());
        this._swatchTooltip = new Tooltips.Tooltip(this._swatch, "");
        this._nextLabel = new St.Label({
            text: _("Next"),
            style_class: "ctc-next-label",
            reactive: false
        });
        this._nextPreview = new St.BoxLayout({
            style_class: "ctc-next-preview",
            reactive: false
        });
        this._nextPreview.add(this._nextLabel, {
            x_fill: false,
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE
        });
        this._nextPreview.add(this._swatch, {
            x_fill: false,
            y_fill: false,
            x_align: St.Align.END,
            y_align: St.Align.MIDDLE
        });
        this._buildControls();

        /* The card's whole inline style (margin + colours + transition) is
         * owned here, so every part must go through one string; a separate
         * set_style anywhere on the actor would clobber the rest. */
        this._margin = 0;
        this._styleKey = null;
        this._expired = false;
        this._lastRgba = null;
        this._lastSmooth = false;
        this._fitLen = undefined;
    },

    _buildControls: function () {
        /* Fixed dark pill so the white symbolic icons stay legible whatever
         * colour the schedule paints the card. Plain St.Buttons on the card
         * itself - no PopupMenu, so no grab/teardown bug class and no need
         * to defer the handlers. Tooltips self-destroy with their button. */
        this._ctlButtons = [];

        if (this.kind === "clock") {
            this._controls = new St.Bin({
                style_class: "ctc-card-controls-spacer",
                reactive: false,
                can_focus: false
            });
        } else {
            this._controls = new St.BoxLayout({ style_class: "ctc-card-controls" });

            this._playButton = this._ctlButton("media-playback-start", "toggle", false, _("Start"));
            this._controls.add(this._playButton);

            this._controls.add(this._ctlButton("view-refresh", "reset", false, _("Reset")));

            if (this.kind === "timer") {
                this._minusButton = this._ctlButton("list-remove", "minus", true, _("-1 minute"));
                this._plusButton = this._ctlButton("list-add", "plus", true, _("+1 minute"));
                this._controls.add(this._minusButton);
                this._controls.add(this._plusButton);
            }
        }

        /* Every card shares one intentional footer: controls stay centered
         * and the labelled next-colour chip always lands at bottom-right. */
        const bottom = new St.BoxLayout({ style_class: "ctc-card-bottom" });
        bottom.add(this._controls, { expand: true, x_fill: false, x_align: St.Align.MIDDLE });
        bottom.add(this._nextPreview, {
            x_fill: false,
            x_align: St.Align.END,
            y_align: St.Align.MIDDLE
        });
        this.actor.add(bottom, { x_fill: true, y_fill: false, x_align: St.Align.MIDDLE, y_align: St.Align.END });
    },

    _ctlButton: function (iconName, action, small, tipText) {
        const icon = new St.Icon({
            icon_name: iconName,
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 16
        });
        const button = new St.Button({
            style_class: small ? "ctc-ctl ctc-ctl-small" : "ctc-ctl",
            can_focus: true
        });
        this._ctlButtons.push(button);
        button.set_child(icon);
        button.connect("clicked", () => {
            this.desklet._onControl(this.kind, action);
        });
        if (tipText && button.set_accessible_name)
            button.set_accessible_name(tipText);
        if (tipText) {
            const tip = new Tooltips.Tooltip(button, tipText);
            if (iconName === "media-playback-start")
                this._playTooltip = tip;
        }
        if (iconName === "media-playback-start")
            this._playIcon = icon;
        return button;
    },

    /* Margin is part of the inline style the card owns, so changing it just
     * invalidates the style cache; the next _applyColors writes both. */
    setSpacing: function (px) {
        this._margin = Math.max(0, Math.round(px) || 0);
        this._styleKey = null;
    },

    setPlaying: function (isRunning) {
        if (this._playIcon)
            this._playIcon.icon_name = isRunning
                ? "media-playback-pause"
                : "media-playback-start";
        if (this._playTooltip && this._playTooltip.set_text)
            this._playTooltip.set_text(isRunning ? _("Pause") : _("Start"));
        if (this._playButton && this._playButton.set_accessible_name)
            this._playButton.set_accessible_name(isRunning ? _("Pause") : _("Start"));
    },

    /* The +/-60 s buttons exist only on the timer card and are reachable
     * only while stopped; paused keeps a frozen remainingMs and expired
     * needs a reset first. They stay mounted but dim and inert, so the
     * pill keeps one width in every state. */
    setAdjustVisible: function (visible) {
        if (!this._minusButton || !this._plusButton)
            return;
        const buttons = [this._minusButton, this._plusButton];
        for (let i = 0; i < buttons.length; i++) {
            buttons[i].reactive = visible;
            buttons[i].can_focus = visible;
            if (visible)
                buttons[i].remove_style_pseudo_class("dim");
            else
                buttons[i].add_style_pseudo_class("dim");
        }
    },

    /* Expiry joins the inline style (a high-contrast ring in the fg colour)
     * so the state punch lands on the same tick it is detected. */
    setExpired: function (on) {
        on = !!on;
        if (on === this._expired)
            return;
        this._expired = on;
        this._styleKey = null;
        if (on)
            this.actor.add_style_pseudo_class("expired");
        else
            this.actor.remove_style_pseudo_class("expired");
        this._applyColors(this._lastRgba, this._lastSmooth);
    },

    /**
     * update:
     * @now (Date): for the clock card, already converted to the card's
     *   timezone; otherwise the plain current time
     * @rgba (array): [r, g, b, a] from evaluate(), or null when the card has
     *   no schedule stops (stylesheet default colours then apply)
     * @smooth (boolean): animate towards this colour over 1000 ms
     * @nextStop (object): the next {t, rgba} schedule stop, or null when no
     *   stop remains in the direction of travel
     */
    update: function (now, rgba, smooth, nextStop) {
        if (this.kind === "clock")
            this._updateClock(now);
        else if (this.kind === "timer")
            this._updateTimer(now);
        else
            this._updateChrono(now);
        this._applyColors(rgba, smooth);
        this._updateSwatch(nextStop);
    },

    /* Solid next-colour preview. Tooltip identifies exact stop and colour. */
    _updateSwatch: function (nextStop) {
        if (!this._swatch)
            return;
        if (!nextStop || !Array.isArray(nextStop.rgba)) {
            this._nextPreview.hide();
            return;
        }
        this._nextPreview.show();
        this._swatch.show();
        this._swatchColor = nextStop.rgba;
        const color = CardActions.rgbaToKey(nextStop.rgba);
        let text;
        if (this.kind === "clock") {
            const h = Math.floor(nextStop.t / 3600);
            const m = Math.floor((nextStop.t % 3600) / 60);
            text = _("Next color at %s: %s").format(_pad2(h) + ":" + _pad2(m), color);
        } else if (this.kind === "timer") {
            text = _("Next color at %s remaining: %s").format(
                _formatDuration(nextStop.t * 1000, false, false), color);
        } else {
            text = _("Next color at %s elapsed: %s").format(
                _formatDuration(nextStop.t * 1000, false, false), color);
        }
        if (this._swatchTooltip && this._swatchTooltip.set_text)
            this._swatchTooltip.set_text(text);
        if (this._swatch.set_accessible_name)
            this._swatch.set_accessible_name(text);
        this._swatch.queue_repaint();
    },

    /* Draw the swatch circle directly (a St.DrawingArea paints only what this
     * callback draws, so the size and fill do not depend on CSS background). */
    _paintSwatch: function () {
        const area = this._swatch;
        const cr = area.get_context();
        if (!cr)
            return;
        const [w, h] = area.get_surface_size();
        const r = Math.min(w, h) / 2 - 1;
        const cx = w / 2;
        const cy = h / 2;

        cr.setSourceRGBA(0, 0, 0, 0);
        cr.rectangle(0, 0, w, h);
        cr.fill();

        const c = this._swatchColor;
        if (c) {
            cr.setSourceRGBA(c[0] / 255, c[1] / 255, c[2] / 255, c[3]);
            cr.arc(cx, cy, Math.max(1, r - 2.5), 0, 2 * Math.PI);
            cr.fill();

            /* A dark outer ring and bright inner ring keep the chip crisp on
             * both pale and dark schedule colours. */
            cr.setSourceRGBA(0, 0, 0, 0.78);
            cr.setLineWidth(2);
            cr.arc(cx, cy, r, 0, 2 * Math.PI);
            cr.stroke();
            cr.setSourceRGBA(1, 1, 1, 0.88);
            cr.setLineWidth(1.5);
            cr.arc(cx, cy, Math.max(1, r - 2), 0, 2 * Math.PI);
            cr.stroke();
        }

        cr.$dispose();
    },

    _updateClock: function (displayDate) {
        try {
            const timeFormat = this.desklet.timeFormat || DEFAULT_TIME_FORMAT;
            const dateFormat = this.desklet.dateFormat || DEFAULT_DATE_FORMAT;
            const tz = this.desklet.clockTimezone;
            this._value.set_text(_formatStrftime(displayDate, timeFormat, tz));
            this._sub.set_text(_formatStrftime(displayDate, dateFormat, tz));
        } catch (e) {
            global.logError(uuid + " could not format clock: " + e);
            this._value.set_text("");
            this._sub.set_text("");
        }
    },

    _updateTimer: function (now) {
        const phase = this.desklet._timer.phase;
        if (phase === "expired") {
            this._title.set_text(_("Time is up"));
            this._value.set_text("00:00");
            this._sub.set_text("");
            return;
        }
        this._title.set_text(_("Timer"));
        this._value.set_text(_formatDuration(
            this.desklet._timerRemainingMs(now.getTime()), true));
        this._sub.set_text(
            phase === "stopped" ? _("Ready") :
            phase === "paused" ? _("Paused") : "");
    },

    _updateChrono: function (now) {
        this._value.set_text(_formatDuration(
            this.desklet._chronoElapsedMs(now.getTime()), false,
            this.desklet.chronoMilliseconds));
        this._sub.set_text("");
    },

    /* One cached set_style per colour change: the 1 s tick samples a linear
     * ramp exactly, and the CSS transition smooths the staircasing between
     * samples. A key of colour+smooth+margin+expired skips no-op restyles. */
    _applyColors: function (rgba, smooth) {
        this._lastRgba = rgba;
        this._lastSmooth = !!smooth;
        const key = (rgba ? CardActions.rgbaToKey(rgba) : "default") + "/" +
            (smooth ? "1" : "0") + "/" + this._margin + "/" +
            (this._expired ? "x" : "n");
        if (key === this._styleKey)
            return;
        this._styleKey = key;

        const margin = this._margin > 0 ? "margin: " + this._margin + "px; " : "";
        if (!rgba) {
            this.actor.set_style(margin);
            return;
        }

        const contrast = CardActions.contrastColors(rgba);
        const border = this._expired
            ? [contrast.fg[0], contrast.fg[1], contrast.fg[2], 0.9]
            : contrast.border;
        this.actor.set_style(margin +
            "background-color: " + CardActions.rgbaToCss(rgba) + ";" +
            "color: " + CardActions.rgbaToCss(contrast.fg) + ";" +
            "border-color: " + CardActions.rgbaToCss(border) + ";" +
            "transition-duration: " + (smooth ? 1000 : 0) + "ms;");
    },

    /* Font sizes are recomputed on card rebuild / setting changes, not on the
     * 1s tick. Settings values are caps; the card shrinks text to fit. */
    applyFittedSizes: function (inner, samples) {
        if (!CardActions || !CardActions.computeFittedFontSizes)
            return;

        inner = inner || {};
        samples = samples || {};
        const box = {
            width: Math.max(0, Number(inner.width) || 0),
            height: Math.max(0, Number(inner.height) || 0)
        };
        if (box.width < 1 || box.height < 1)
            return;

        const texts = {
            time: samples.value || this._value.get_text() || "23:59:59",
            date: samples.sub || this._sub.get_text() || "Wednesday, 31 December",
            label: this._title.get_text() || ""
        };
        /* Length the fit was sized for; a later value with more characters
         * (timer/chrono crossing an hour) triggers a refit. */
        this._fitLen = texts.time.length;
        const maxSizes = {
            time: Number(this.desklet.timeSize) || 44,
            date: Number(this.desklet.dateSize) || 13,
            timezone: Number(this.desklet.labelSize) || 11
        };

        const sizes = CardActions.computeFittedFontSizes(box.width, box.height, texts, maxSizes);
        this._setFontSizes(sizes);
        this._constrainTitleWidth(box.width);
        this._refineWithMetrics(box, sizes);
    },

    _setFontSizes: function (sizes) {
        this._value.set_style("font-size: " + sizes.time + "pt;");
        this._sub.set_style("font-size: " + sizes.date + "pt;");
        this._title.set_style("font-size: " + sizes.timezone + "pt;");
    },

    _constrainTitleWidth: function (width) {
        try {
            if (width > 1)
                this._title.set_width(Math.max(1, Math.floor(width)));
        } catch (e) {}
    },

    _refineWithMetrics: function (inner, sizes) {
        /* Skip until the card is on the stage: querying preferred size on an
         * unmapped actor returns -1 and floods St-CRITICAL warnings. */
        if (!this.actor || !this.actor.get_stage())
            return;
        try {
            const gap = (CardActions && CardActions.CARD_LAYOUT)
                ? CardActions.CARD_LAYOUT.lineGap : 2;
            for (let i = 0; i < 8; i++) {
                const valueW = this._value.get_preferred_width(-1)[1];
                const subW = this._sub.get_preferred_width(-1)[1];
                const valueH = this._value.get_preferred_height(-1)[1];
                const subH = this._sub.get_preferred_height(-1)[1];
                const titleH = this._title.get_preferred_height(-1)[1];
                const pillH = this._controls
                    ? this._controls.get_preferred_height(-1)[1] : 0;
                const totalH = valueH + subH + titleH + pillH + 2 * gap;
                const wide = valueW > inner.width + 1 || subW > inner.width + 1;
                const tall = totalH > inner.height + 1;
                if (!wide && !tall)
                    return;
                sizes.time = Math.max(1, sizes.time * 0.88);
                sizes.date = Math.max(1, Math.min(sizes.date * 0.88, sizes.time));
                sizes.timezone = Math.max(1, Math.min(sizes.timezone * 0.88, sizes.date));
                this._setFontSizes(sizes);
            }
        } catch (e) {
            global.logError(uuid + " font metric refine failed: " + e);
        }
    }
};

function MyDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        _loadModules(metadata.path);

        this._settingWatchIds = [];
        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], deskletId);
        this.settings.bind("show-clock", "showClock", this.on_setting_changed);
        this.settings.bind("show-timer", "showTimer", this.on_setting_changed);
        this.settings.bind("show-chronometer", "showChronometer", this.on_setting_changed);
        this._watchStringSetting("clock-timezone", "clockTimezone", this.on_setting_changed);
        this.settings.bind("clock-schedule", "clockSchedule", this.on_setting_changed);
        this.settings.bind("clock-smooth", "clockSmooth", this.on_setting_changed);
        this.settings.bind("timer-minutes", "timerMinutes", this.on_setting_changed);
        this.settings.bind("timer-seconds", "timerSeconds", this.on_setting_changed);
        this.settings.bind("timer-schedule", "timerSchedule", this.on_setting_changed);
        this.settings.bind("timer-smooth", "timerSmooth", this.on_setting_changed);
        this.settings.bind("timer-notify", "timerNotify", this.on_setting_changed);
        this.settings.bind("chrono-schedule", "chronoSchedule", this.on_setting_changed);
        this.settings.bind("chrono-smooth", "chronoSmooth", this.on_setting_changed);
        this.settings.bind("chrono-milliseconds", "chronoMilliseconds", this.on_setting_changed);
        this.settings.bind("time-format", "timeFormat", this.on_setting_changed);
        this.settings.bind("date-format", "dateFormat", this.on_setting_changed);
        this.settings.bind("time-size", "timeSize", this.on_setting_changed);
        this.settings.bind("date-size", "dateSize", this.on_setting_changed);
        this.settings.bind("label-size", "labelSize", this.on_setting_changed);
        this.settings.bind("card-spacing", "cardSpacing", this.on_setting_changed);
        this.settings.bind("width", "width", this.on_setting_changed);
        this.settings.bind("height", "height", this.on_setting_changed);
        /* Persisted state stores; written via setValue on transitions only,
         * never rebound through a callback. */
        this.settings.bind("timer-state", "timerState");
        this.settings.bind("chrono-state", "chronoState");

        this._cards = [];
        this._schedules = { clock: null, timer: null, chrono: null };
        this._notifyTimes = {};
        this._lastPos = { clock: null, chrono: null };
        this._scheduleRows = null;
        this._lastBadTimezone = null;
        this._timeout = null;
        this._fastTimeout = null;
        this._rebuildTimeout = null;
        this._fitId = null;
        this._fitRetryId = null;
        this._allocW = -1;
        this._allocH = -1;
        this._cardInner = null;
        this._gridDims = null;
        this._layoutHeight = this.height || 260;
        this._widthSamples = null;

        this.mainContainer = new St.BoxLayout({
            vertical: true,
            style_class: "ctc-container"
        });
        this.mainContainer.set_width(this.width || 840);
        this.mainContainer.set_height(this.height || 260);

        this.setContent(this.mainContainer);
        this.setHeader(_("Color Timer Clock"));
        this._menu.addAction(_("Reload color schedules"), this._reloadSchedules.bind(this));

        this._restoreState();
        this._rebuildCards();
        this._scheduleUpdate();

        /* Desklet.destroy() emits 'destroy' immediately but defers
         * on_desklet_removed() until a 500ms fade-out completes. Without this
         * hook our timeout keeps firing against a tearing-down desklet for
         * half a second. _cleanup() is idempotent. */
        this._destroyId = this.connect("destroy", this._cleanup.bind(this));
    },

    on_desklet_removed: function () {
        this._cleanup();
    },

    _cleanup: function () {
        if (this._cleanedUp)
            return;
        this._cleanedUp = true;

        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }
        if (this._fastTimeout) {
            Mainloop.source_remove(this._fastTimeout);
            this._fastTimeout = null;
        }
        if (this._rebuildTimeout) {
            Mainloop.source_remove(this._rebuildTimeout);
            this._rebuildTimeout = null;
        }
        if (this._fitId) {
            Mainloop.source_remove(this._fitId);
            this._fitId = null;
        }
        if (this._fitRetryId) {
            Mainloop.source_remove(this._fitRetryId);
            this._fitRetryId = null;
        }

        this._cards = [];

        if (this.settings) {
            if (this._settingWatchIds) {
                for (let i = 0; i < this._settingWatchIds.length; i++) {
                    try { this.settings.disconnect(this._settingWatchIds[i]); } catch (e) {}
                }
                this._settingWatchIds = [];
            }
            this.settings.finalize();
            this.settings = null;
        }

        if (this._destroyId) {
            this.disconnect(this._destroyId);
            this._destroyId = 0;
        }
    },

    _watchStringSetting: function (key, prop, callback) {
        this[prop] = this.settings ? this.settings.getValue(key) : "";
        if (this.settings && this.settings.connect) {
            const id = this.settings.connect("changed::" + key, () => {
                this[prop] = this.settings.getValue(key);
                if (callback)
                    callback.call(this);
            });
            if (!this._settingWatchIds)
                this._settingWatchIds = [];
            this._settingWatchIds.push(id);
        }
    },

    on_setting_changed: function () {
        try {
            this.mainContainer.set_width(this.width);
            this.mainContainer.set_height(this.height);
        } catch (e) {
            global.logError(uuid + " setting change failed: " + e);
        }
        if (this._cleanedUp)
            return;

        /* A stopped timer always shows the settings duration, so spinbutton
         * edits apply without a reset. */
        if (this._timer && this._timer.phase === "stopped") {
            const duration = this._timerDurationFromSettings();
            if (duration !== this._timer.durationSec) {
                this._timer.durationSec = duration;
                this._persistTimer();
            }
        }

        /* Settings-window edits arrive through the bind callbacks, so the
         * bound properties are fresh; in-process setValue bypasses them and
         * updates _scheduleRows itself. A timezone edit gets a fresh
         * chance to log if it is still invalid. */
        this._scheduleRows = null;
        this._lastBadTimezone = null;

        if (this._rebuildTimeout) {
            Mainloop.source_remove(this._rebuildTimeout);
            this._rebuildTimeout = null;
        }
        this._rebuildTimeout = Mainloop.timeout_add(100, () => {
            this._rebuildTimeout = null;
            this._rebuildCards();
            return false;
        });
    },

    /* ------------------------------------------------------------------ *
     * Card construction
     * ------------------------------------------------------------------ */

    _visibleKinds: function () {
        const kinds = [];
        if (this.showClock)
            kinds.push("clock");
        if (this.showTimer)
            kinds.push("timer");
        if (this.showChronometer)
            kinds.push("chrono");
        return kinds;
    },

    _rebuildCards: function () {
        try {
            if (!_loadModules(this.metadata && this.metadata.path))
                return;

            this._refreshSchedules();
            this.mainContainer.destroy_all_children();
            this.mainContainer.remove_style_class_name("ctc-compact");
            this.mainContainer.remove_style_class_name("ctc-empty-container");
            this._cards = [];

            const kinds = this._visibleKinds();
            if (kinds.length === 0) {
                this._layoutHeight = Math.max(Number(this.height) || 260, 150);
                this.mainContainer.set_height(this._layoutHeight);
                this._showEmptyState();
                this._gridDims = { rows: 0, cols: 0 };
                this._cardInner = null;
                this._widthSamples = null;
                return;
            }

            const dims = _responsiveGrid(kinds.length, this.width, this.cardSpacing);
            this._gridDims = dims;
            this._layoutHeight = _responsiveHeight(dims.rows, this.height, this.cardSpacing);
            this.mainContainer.set_height(this._layoutHeight);
            if (dims.rows > 1)
                this.mainContainer.add_style_class_name("ctc-compact");

            /* Card surfaces stay non-reactive so Cinnamon owns desklet DND.
             * St.Button controls consume clicks through normal event flow.
             * Never change private draggable state or synthesize release. */
            const grid = new St.BoxLayout({
                vertical: true,
                style_class: "ctc-grid"
            });
            this.mainContainer.add(grid, {
                expand: true,
                x_expand: true,
                y_expand: true,
                x_fill: true,
                y_fill: true
            });

            const rowTables = [];
            const availableWidth = Math.max(1, (Number(this.width) || 840) - 8);
            for (let row = 0; row < dims.rows; row++) {
                const rowStart = row * dims.cols;
                const rowCount = Math.min(dims.cols, kinds.length - rowStart);
                const rowTable = new St.Table({
                    homogeneous: true,
                    style_class: "ctc-grid-row"
                });
                rowTable.set_width(Math.floor(availableWidth * rowCount / dims.cols));
                const rowHost = new St.Bin({
                    x_fill: false,
                    y_fill: true,
                    x_align: St.Align.MIDDLE,
                    y_align: St.Align.MIDDLE
                });
                rowHost.set_child(rowTable);
                grid.add(rowHost, {
                    expand: true,
                    x_fill: true,
                    y_fill: true,
                    x_align: St.Align.MIDDLE
                });
                rowTables.push(rowTable);
            }

            for (let i = 0; i < kinds.length; i++) {
                const widget = new CardWidget(kinds[i], this);
                widget.setSpacing(this.cardSpacing);
                const row = Math.floor(i / dims.cols);
                const indexInRow = i % dims.cols;
                rowTables[row].add(widget.actor, {
                    row: 0,
                    col: indexInRow,
                    x_expand: true,
                    y_expand: true,
                    x_fill: true,
                    y_fill: true
                });
                this._cards.push(widget);
            }

            this._updateAll();
            this._widthSamples = this._formatWidthSamples();
            this._cardInner = this._computeCardInnerSize(dims);
            this._scheduleFit();
        } catch (e) {
            global.logError(uuid + " card rebuild failed: " + e);
        }
    },

    _showEmptyState: function () {
        this.mainContainer.add_style_class_name("ctc-empty-container");
        const empty = new St.BoxLayout({
            vertical: true,
            style_class: "ctc-empty"
        });
        const icon = new St.Icon({
            icon_name: "preferences-system-symbolic",
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 32,
            style_class: "ctc-empty-icon"
        });
        const title = new St.Label({
            text: _("No cards enabled"),
            style_class: "ctc-empty-title"
        });
        const help = new St.Label({
            text: _("Right-click and choose Configure to show a card."),
            style_class: "ctc-empty-help"
        });
        _centerLabelText(title);
        _centerLabelText(help);
        empty.add(icon, { x_fill: false, x_align: St.Align.MIDDLE });
        empty.add(title, { x_fill: true, x_align: St.Align.MIDDLE });
        empty.add(help, { x_fill: true, x_align: St.Align.MIDDLE });
        if (empty.set_accessible_name)
            empty.set_accessible_name(_("No cards enabled. Open Configure to show a card."));
        this.mainContainer.add(empty, {
            expand: true,
            x_fill: false,
            y_fill: false,
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE
        });
    },

    /* Normalised once per settings change (rebuild), never on the 1s tick. */
    _refreshSchedules: function () {
        if (!CardActions)
            return;
        const rows = this._scheduleRows || {
            clock: this.clockSchedule,
            timer: this.timerSchedule,
            chrono: this.chronoSchedule
        };
        this._schedules = {};
        this._notifyTimes = {};
        for (const kind of ["clock", "timer", "chrono"]) {
            const result = CardActions.normalizeSchedule(
                rows[kind], CardActions.DAY_SECONDS);
            if (result.dropped > 0)
                global.log(uuid + ": dropped " + result.dropped +
                    " " + kind + " schedule row(s) with an unparsable time or colour");
            this._schedules[kind] = result.stops;
            this._notifyTimes[kind] = result.stops
                .filter(s => s.notify)
                .map(s => s.t);
        }
        this._lastPos = { clock: null, chrono: null };
    },

    /* reset-schedules settings button callback. setValue does not fire the
     * bind callbacks in-process, so _scheduleRows is refreshed by hand and
     * the cards repainted immediately. */
    resetSchedules: function () {
        if (this._cleanedUp || !this.settings || !CardActions)
            return;
        try {
            this._scheduleRows = {
                clock: CardActions.DEFAULT_CLOCK_SCHEDULE,
                timer: CardActions.DEFAULT_TIMER_SCHEDULE,
                chrono: CardActions.DEFAULT_CHRONO_SCHEDULE
            };
            this.settings.setValue("clock-schedule", CardActions.DEFAULT_CLOCK_SCHEDULE);
            this.settings.setValue("timer-schedule", CardActions.DEFAULT_TIMER_SCHEDULE);
            this.settings.setValue("chrono-schedule", CardActions.DEFAULT_CHRONO_SCHEDULE);
            this._refreshSchedules();
            this._updateAll();
        } catch (e) {
            global.logError(uuid + " schedule reset failed: " + e);
        }
    },

    /* Context-menu action: re-read all schedules without replacing widgets or
     * interrupting a running timer or chronometer. */
    _reloadSchedules: function () {
        if (this._cleanedUp || !CardActions)
            return;
        try {
            this._refreshSchedules();
            this._widthSamples = this._formatWidthSamples();
            if (this._cards.length > 0) {
                this._cardInner = this._computeCardInnerSize(this._gridDims);
                this._fitAllCards(this._cardInner);
            }
            this._updateAll();
        } catch (e) {
            global.logError(uuid + " schedule reload failed: " + e);
        }
    },

    /* ------------------------------------------------------------------ *
     * Timer / chronometer state machines
     * ------------------------------------------------------------------ */

    _timerDurationFromSettings: function () {
        const mins = Number(this.timerMinutes) || 0;
        const secs = Number(this.timerSeconds) || 0;
        return Math.max(1, Math.min(86400, Math.round(mins * 60 + secs)));
    },

    _isValidTimerState: function (s) {
        return !!(s && typeof s === "object" &&
            TIMER_PHASES.indexOf(s.phase) !== -1 &&
            Number.isFinite(s.durationSec) &&
            Number.isFinite(s.endMs) &&
            Number.isFinite(s.remainingMs));
    },

    _isValidChronoState: function (s) {
        return !!(s && typeof s === "object" &&
            CHRONO_PHASES.indexOf(s.phase) !== -1 &&
            Number.isFinite(s.startMs) &&
            Number.isFinite(s.accumMs));
    },

    /* Validates the persisted state and maps a restart-during-run to the
     * correct phase: a timer whose endMs has passed becomes expired, a
     * chronometer keeps running on its wall-clock startMs. */
    _restoreState: function () {
        const now = Date.now();

        let t = this._isValidTimerState(this.timerState)
            ? {
                phase: this.timerState.phase,
                durationSec: Math.max(1, Math.min(86400, Math.round(this.timerState.durationSec))),
                endMs: this.timerState.endMs,
                remainingMs: Math.max(0, this.timerState.remainingMs)
            }
            : { phase: "stopped", durationSec: this._timerDurationFromSettings(), endMs: 0, remainingMs: 0 };
        if (t.phase === "stopped")
            t.durationSec = this._timerDurationFromSettings();
        if (t.phase === "running" && t.endMs <= now) {
            t.phase = "expired";
            if (now - t.endMs <= STALE_EXPIRY_MS)
                this._notifyTimerExpired();
        }
        this._timer = t;
        this._persistTimer();

        let c = this._isValidChronoState(this.chronoState)
            ? {
                phase: this.chronoState.phase,
                startMs: this.chronoState.startMs,
                accumMs: Math.max(0, this.chronoState.accumMs)
            }
            : { phase: "stopped", startMs: 0, accumMs: 0 };
        this._chrono = c;
        this._persistChrono();
    },

    _persistTimer: function () {
        if (this.settings && this._timer)
            this.settings.setValue("timer-state", {
                phase: this._timer.phase,
                durationSec: this._timer.durationSec,
                endMs: this._timer.endMs,
                remainingMs: this._timer.remainingMs
            });
    },

    /* Opt-in desktop notification on the running -> expired transition. */
    _notifyTimerExpired: function () {
        if (!this.timerNotify)
            return;
        try {
            Main.notify(_("Timer finished"), _("The timer reached zero."));
        } catch (e) {
            global.logError(uuid + " notify failed: " + e);
        }
    },

    /* Clock/chronometer schedule stops flagged notify fire once when the card's
     * position crosses their time. The first sample after a rebuild only primes
     * the previous position, so already-passed times do not fire on startup. */
    _checkNotifyCrossing: function (kind, pos) {
        const times = this._notifyTimes ? this._notifyTimes[kind] : null;
        if (!times || !times.length)
            return;
        const prev = this._lastPos ? this._lastPos[kind] : null;
        this._lastPos[kind] = pos;
        if (prev == null)
            return;
        const crossed = CardActions.thresholdsCrossed(prev, pos, times, kind === "clock");
        for (let i = 0; i < crossed.length; i++)
            this._notifyCardTime(kind, crossed[i]);
    },

    _notifyCardTime: function (kind, t) {
        let body;
        if (kind === "clock") {
            const h = Math.floor(t / 3600);
            const m = Math.floor((t % 3600) / 60);
            body = _("It is now %s.").format(_pad2(h) + ":" + _pad2(m));
        } else {
            body = _("Reached %s.").format(_formatDuration(t * 1000, false, false));
        }
        try {
            Main.notify(CARD_TITLES[kind], body);
        } catch (e) {
            global.logError(uuid + " notify failed: " + e);
        }
    },

    _persistChrono: function () {
        if (this.settings && this._chrono)
            this.settings.setValue("chrono-state", {
                phase: this._chrono.phase,
                startMs: this._chrono.startMs,
                accumMs: this._chrono.accumMs
            });
    },

    _timerRemainingMs: function (nowMs) {
        const t = this._timer;
        if (t.phase === "running")
            return Math.max(0, t.endMs - nowMs);
        if (t.phase === "paused")
            return Math.max(0, t.remainingMs);
        if (t.phase === "stopped")
            return t.durationSec * 1000;
        return 0;
    },

    _chronoElapsedMs: function (nowMs) {
        const c = this._chrono;
        if (c.phase === "running")
            return c.accumMs + (nowMs - c.startMs);
        if (c.phase === "paused")
            return c.accumMs;
        return 0;
    },

    /* Plain handlers, no deferral: these are on-card St.Buttons, not menu
     * items, so no grab is released after the click. */
    _onControl: function (kind, action) {
        try {
            if (this._cleanedUp)
                return;
            if (kind === "timer")
                this._timerControl(action);
            else if (kind === "chrono")
                this._chronoControl(action);
            this._updateAll();
        } catch (e) {
            global.logError(uuid + " control failed: " + e);
        }
    },

    _timerControl: function (action) {
        const now = Date.now();
        const t = this._timer;

        if (action === "toggle") {
            if (t.phase === "running") {
                t.remainingMs = Math.max(0, t.endMs - now);
                /* A pause click landing after endMs - but before the next
                 * tick notices - must not strand the timer at 00:00/Paused:
                 * _updateAll only expires a running timer. */
                t.phase = t.remainingMs > 0 ? "paused" : "expired";
                if (t.phase === "expired")
                    this._notifyTimerExpired();
            } else {
                /* Stopped and expired both restart from the full duration;
                 * paused resumes its frozen remainingMs. */
                const fromStopped = t.phase === "stopped" || t.phase === "expired";
                t.remainingMs = fromStopped
                    ? t.durationSec * 1000
                    : Math.max(0, t.remainingMs);
                t.phase = "running";
                t.endMs = now + t.remainingMs;
            }
        } else if (action === "reset") {
            t.phase = "stopped";
            t.durationSec = this._timerDurationFromSettings();
            t.endMs = 0;
            t.remainingMs = 0;
        } else if (action === "minus" || action === "plus") {
            if (t.phase !== "stopped")
                return;
            const delta = action === "plus" ? 60 : -60;
            t.durationSec = Math.max(1, Math.min(86400, t.durationSec + delta));
        } else {
            return;
        }

        this._persistTimer();
    },

    _chronoControl: function (action) {
        const now = Date.now();
        const c = this._chrono;

        if (action === "toggle") {
            if (c.phase === "running") {
                /* Pause folds the running stretch into accumMs. */
                c.accumMs += now - c.startMs;
                c.phase = "paused";
            } else {
                if (c.phase === "stopped")
                    c.accumMs = 0;
                /* Resume resets startMs and keeps the accumulated total. */
                c.startMs = now;
                c.phase = "running";
            }
        } else if (action === "reset") {
            c.phase = "stopped";
            c.startMs = 0;
            c.accumMs = 0;
        } else {
            return;
        }

        this._persistChrono();
    },

    /* ------------------------------------------------------------------ *
     * Per-second update
     * ------------------------------------------------------------------ */

    /* Date whose wall-clock fields are the card timezone's local time
     * (world-clock conversion pattern); the desklet's own time when the
     * timezone entry is empty or invalid. */
    _clockWallParts: function (now) {
        const timezoneName = (this.clockTimezone || "").trim();
        try {
            const tz = timezoneName
                ? GLib.TimeZone.new(timezoneName)
                : GLib.TimeZone.new_local();
            const dt = GLib.DateTime.new_from_unix_utc(
                Math.floor(now.getTime() / 1000)
            ).to_timezone(tz);
            return {
                hours: dt.get_hour(),
                minutes: dt.get_minute(),
                seconds: dt.get_second()
            };
        } catch (e) {
            if (timezoneName && this._lastBadTimezone !== timezoneName) {
                this._lastBadTimezone = timezoneName;
                global.logError(uuid + " invalid timezone: " + timezoneName + ": " + e);
            }
            return {
                hours: now.getHours(),
                minutes: now.getMinutes(),
                seconds: now.getSeconds()
            };
        }
    },

    _smoothFor: function (kind) {
        if (kind === "clock")
            return !!this.clockSmooth;
        if (kind === "timer")
            return !!this.timerSmooth;
        return !!this.chronoSmooth;
    },

    _updateAll: function () {
        if (this._cleanedUp || !CardActions)
            return;

        try {
        const now = new Date();
        const nowMs = now.getTime();

        /* Expiry is a state transition and is persisted the moment it is
         * detected. */
        if (this._timer.phase === "running" && this._timer.endMs <= nowMs) {
            this._timer.phase = "expired";
            this._persistTimer();
            this._notifyTimerExpired();
        }

        const clockParts = this._clockWallParts(now);

        for (let i = 0; i < this._cards.length; i++) {
            const widget = this._cards[i];
            const smooth = this._smoothFor(widget.kind);
            let pos, rgba, nextStop;

            if (widget.kind === "clock") {
                pos = clockParts.hours * 3600 +
                    clockParts.minutes * 60 +
                    clockParts.seconds;
                rgba = CardActions.evaluate(this._schedules.clock, pos, {
                    wrap: true,
                    smooth: smooth
                });
                nextStop = _nextScheduleStop(this._schedules.clock, pos, { wrap: true });
                widget.update(now, rgba, smooth, nextStop);
            } else if (widget.kind === "timer") {
                pos = this._timerRemainingMs(nowMs) / 1000;
                rgba = CardActions.evaluate(this._schedules.timer, pos, {
                    smooth: smooth
                });
                nextStop = _nextScheduleStop(this._schedules.timer, pos, { reverse: true });
                widget.update(now, rgba, smooth, nextStop);
            } else {
                pos = this._chronoElapsedMs(nowMs) / 1000;
                rgba = CardActions.evaluate(this._schedules.chrono, pos, {
                    smooth: smooth
                });
                nextStop = _nextScheduleStop(this._schedules.chrono, pos, {});
                widget.update(now, rgba, smooth, nextStop);
            }
            this._checkNotifyCrossing(widget.kind, pos);
        }

        /* Refit when a value crosses a digit-count boundary (e.g. a
         * chronometer reaching 1:00:00): the fitted size was computed for a
         * shorter string and would now overflow. */
        for (let i = 0; i < this._cards.length; i++) {
            const widget = this._cards[i];
            if (widget._fitLen !== undefined &&
                (widget._value.get_text() || "").length !== widget._fitLen) {
                this._scheduleFit();
                break;
            }
        }

        this._syncControlStates();
        } catch (e) {
            global.logError(uuid + " update failed: " + e);
        }
    },

    _syncControlStates: function () {
        for (let i = 0; i < this._cards.length; i++) {
            const widget = this._cards[i];
            if (widget.kind === "timer") {
                widget.setPlaying(this._timer.phase === "running");
                widget.setAdjustVisible(this._timer.phase === "stopped");
                widget.setExpired(this._timer.phase === "expired");
            } else if (widget.kind === "chrono") {
                widget.setPlaying(this._chrono.phase === "running");
                widget.setExpired(false);
            }
        }
        this._syncFastTick();
    },

    /* Hundredths need a faster cadence than the 1 s tick can show. Arm the
     * fast timer only while the chronometer is actually running with the
     * setting on, so an idle desklet costs nothing extra. */
    _syncFastTick: function () {
        let want = false;
        if (!this._cleanedUp && this.chronoMilliseconds && this._chrono &&
            this._chrono.phase === "running") {
            for (let i = 0; i < this._cards.length; i++) {
                if (this._cards[i].kind === "chrono") {
                    want = true;
                    break;
                }
            }
        }
        if (want && !this._fastTimeout) {
            this._fastTimeout = Mainloop.timeout_add(50, this._onFastTick.bind(this));
        } else if (!want && this._fastTimeout) {
            Mainloop.source_remove(this._fastTimeout);
            this._fastTimeout = null;
        }
    },

    _onFastTick: function () {
        if (this._cleanedUp) {
            this._fastTimeout = null;
            return false;
        }
        for (let i = 0; i < this._cards.length; i++) {
            if (this._cards[i].kind === "chrono") {
                this._cards[i]._updateChrono(new Date());
                break;
            }
        }
        return true;
    },

    _scheduleUpdate: function () {
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }
        this._timeout = Mainloop.timeout_add_seconds(1, this._onTick.bind(this));
    },

    _onTick: function () {
        if (this._cleanedUp)
            return false;
        try {
            this._updateAll();
        } catch (e) {
            global.logError(uuid + " tick failed: " + e);
        }
        return true;
    },

    /* ------------------------------------------------------------------ *
     * Font fitting
     * ------------------------------------------------------------------ */

    _computeCardInnerSize: function (dims) {
        if (!CardActions || !CardActions.computeCardInnerSize)
            return { width: 80, height: 80 };
        dims = dims || { rows: 1, cols: Math.max(1, this._cards.length) };
        return CardActions.computeCardInnerSize(
            this.width || 840, this._layoutHeight || this.height || 260,
            Math.max(1, dims.rows), Math.max(1, dims.cols), this.cardSpacing);
    },

    _formatWidthSamples: function () {
        const timeFormat = this.timeFormat || DEFAULT_TIME_FORMAT;
        const dateFormat = this.dateFormat || DEFAULT_DATE_FORMAT;
        const dates = [
            new Date(2023, 11, 27, 23, 59, 59),
            new Date(2023, 8, 20, 12, 0, 0),
            new Date()
        ];
        let sub = "";
        for (let i = 0; i < dates.length; i++) {
            try {
                const d = _formatStrftime(dates[i], dateFormat, this.clockTimezone);
                if (String(d).length > sub.length)
                    sub = d;
            } catch (e) {}
        }
        const clockSample = CardActions && CardActions.worstTimeSample
            ? CardActions.worstTimeSample(timeFormat)
            : "23:59:59";
        const chronoSample = this.chronoMilliseconds ? "99:59:59.99" : "99:59:59";
        let value = clockSample.length >= chronoSample.length ? clockSample : chronoSample;
        for (let i = 0; i < this._cards.length; i++) {
            const v = this._cards[i]._value.get_text();
            if (v && v.length > value.length)
                value = v;
        }
        return {
            value: value || "23:59:59",
            clock: clockSample,
            chrono: chronoSample,
            timer: "99:59:59",
            sub: sub || "Wednesday, 31 December"
        };
    },

    _scheduleFit: function () {
        if (this._fitId) {
            Mainloop.source_remove(this._fitId);
            this._fitId = null;
        }
        this._fitId = Mainloop.timeout_add(0, () => {
            this._fitId = null;
            if (this._cleanedUp)
                return false;
            this._fitAllCards(this._cardInner);
            if (this._fitRetryId)
                Mainloop.source_remove(this._fitRetryId);
            this._fitRetryId = Mainloop.timeout_add(80, () => {
                this._fitRetryId = null;
                if (this._cleanedUp)
                    return false;
                this._fitAllCards(this._cardInner);
                return false;
            });
            return false;
        });
    },

    _fitAllCards: function (inner) {
        inner = inner || this._cardInner;
        const samples = this._widthSamples || this._formatWidthSamples();
        this._widthSamples = samples;
        if (!inner)
            return;
        for (let i = 0; i < this._cards.length; i++) {
            const widget = this._cards[i];
            let sampleValue = samples.value;
            if (widget.kind === "clock" && samples.clock)
                sampleValue = samples.clock;
            else if (widget.kind === "chrono" && samples.chrono)
                sampleValue = samples.chrono;
            else if (widget.kind === "timer" && samples.timer)
                sampleValue = samples.timer;
            const live = widget._value.get_text() || "";
            if (live.length > sampleValue.length)
                sampleValue = live;
            widget.applyFittedSizes(inner, {
                value: sampleValue,
                sub: samples.sub
            });
        }
    }
};

function main(metadata, deskletId) {
    return new MyDesklet(metadata, deskletId);
}
