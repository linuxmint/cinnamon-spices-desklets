/* global imports, global */
const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const ModalDialog = imports.ui.modalDialog;
const Gettext = imports.gettext;
const GLib = imports.gi.GLib;
const Pango = imports.gi.Pango;

const uuid = "cinnamon-world-clock-desklet@curbsoftware";

Gettext.bindtextdomain(uuid, GLib.get_user_data_dir() + "/locale");

function _(str) {
    return Gettext.dgettext(uuid, str);
}

/* Xlet-local modules. Cinnamon exposes a desklet's own directory through
 * imports.ui.deskletManager.desklets[uuid]; resolved lazily in _init() so a
 * load-order problem surfaces as a logged error instead of a load failure. */
let ClockActions = null;
let ClockDialog = null;

function _loadModules() {
    if (ClockActions && ClockDialog)
        return true;
    try {
        const dir = imports.ui.deskletManager.desklets[uuid];
        ClockActions = dir.clockActions;
        ClockDialog = dir.clockDialog;
        return !!(ClockActions && ClockDialog);
    } catch (e) {
        global.logError(uuid + " could not load helper modules: " + e);
        return false;
    }
}

const DEFAULT_TIME_FORMAT = "%H:%M:%S";
const DEFAULT_DATE_FORMAT = "%A, %e %B";

function ClockWidget(clockData, desklet) {
    this._init(clockData, desklet);
}

ClockWidget.prototype = {
    _init: function (clockData, desklet) {
        this.desklet = desklet;
        this.data = clockData;
        this.id = clockData.id;

        this.actor = new St.Button({
            style_class: "world-clock-tile",
            reactive: true,
            can_focus: true,
            x_expand: true,
            y_expand: true
        });
        /* Accept right-click too, so a tile can raise its own context menu.
         * St.Button consumes the release, so the Desklet base class right-click
         * handler does not also open the desklet menu. */
        this.actor.set_button_mask(St.ButtonMask.ONE | St.ButtonMask.THREE);

        const box = new St.BoxLayout({
            vertical: true
        });

        this._time = new St.Label({ style_class: "world-clock-time" });
        this._date = new St.Label({ style_class: "world-clock-date" });
        this._timezoneLabel = new St.Label({ style_class: "world-clock-timezone" });

        try {
            this._time.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            this._time.clutter_text.line_wrap = false;
            this._date.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            this._date.clutter_text.line_wrap = false;
            this._timezoneLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            this._timezoneLabel.clutter_text.line_wrap = false;
        } catch (e) {}

        box.add(this._time, { x_fill: false, x_align: St.Align.MIDDLE });
        box.add(this._date, { x_fill: false, x_align: St.Align.MIDDLE });
        box.add(this._timezoneLabel, { x_fill: false, x_align: St.Align.MIDDLE });

        this.actor.set_child(box);

        const label = ClockActions
            ? ClockActions.getClockLabel(this.data)
            : (this.data.name || this.data.timezone || "");
        this._timezoneLabel.set_text(label);
    },

    /* Font sizes are recomputed on grid rebuild / setting changes, not on the
     * 1s tick. Settings values are caps; the tile shrinks text to fit. */
    applyFittedSizes: function (inner, samples) {
        if (!ClockActions || !ClockActions.computeFittedFontSizes)
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
            time: samples.time || this._time.get_text() || "23:59:59",
            date: samples.date || this._date.get_text() || "Wednesday, 31 December",
            label: this._timezoneLabel.get_text() || ""
        };
        const maxSizes = {
            time: Number(this.desklet.timeSize) || 40,
            date: Number(this.desklet.dateSize) || 15,
            timezone: Number(this.desklet.timezoneSize) || 12
        };

        const sizes = ClockActions.computeFittedFontSizes(box.width, box.height, texts, maxSizes);
        this._setFontSizes(sizes);
        this._constrainLabelWidth(box.width);
        this._refineWithMetrics(box, sizes);
    },

    _setFontSizes: function (sizes) {
        this._time.set_style("font-size: " + sizes.time + "pt;");
        this._date.set_style("font-size: " + sizes.date + "pt;");
        this._timezoneLabel.set_style("font-size: " + sizes.timezone + "pt;");
    },

    _constrainLabelWidth: function (width) {
        try {
            this._timezoneLabel.set_width(Math.max(1, Math.floor(width)));
        } catch (e) {}
    },

    _refineWithMetrics: function (inner, sizes) {
        /* Skip until the tile is on the stage: querying preferred size on an
         * unmapped actor returns -1 and floods St-CRITICAL warnings. */
        if (!this.actor || !this.actor.get_stage())
            return;
        try {
            const gap = (ClockActions && ClockActions.TILE_LAYOUT)
                ? ClockActions.TILE_LAYOUT.lineGap : 2;
            for (let i = 0; i < 8; i++) {
                const timeW = this._time.get_preferred_width(-1)[1];
                const dateW = this._date.get_preferred_width(-1)[1];
                const timeH = this._time.get_preferred_height(-1)[1];
                const dateH = this._date.get_preferred_height(-1)[1];
                const tzH = this._timezoneLabel.get_preferred_height(-1)[1];
                const totalH = timeH + dateH + tzH + 2 * gap;
                const wide = timeW > inner.width + 1 || dateW > inner.width + 1;
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
    },

    update: function (baseDate) {
        let displayDate = baseDate;
        let timezoneName = this.data.timezone || "local";

        if (timezoneName !== "local") {
            try {
                const timeString = baseDate.toLocaleString("en-US", { timeZone: timezoneName });
                displayDate = new Date(timeString);
            } catch (e) {
                global.logError(uuid + " invalid timezone: " + timezoneName + ": " + e);
                timezoneName = Intl.DateTimeFormat().resolvedOptions().timeZone;
                displayDate = baseDate;
            }
        }

        const label = ClockActions
            ? ClockActions.getClockLabel(this.data)
            : (this.data.name || timezoneName);

        try {
            const timeFormat = this.desklet.timeFormat || DEFAULT_TIME_FORMAT;
            const dateFormat = this.desklet.dateFormat || DEFAULT_DATE_FORMAT;
            this._time.set_text(displayDate.toLocaleFormat(timeFormat));
            this._date.set_text(displayDate.toLocaleFormat(dateFormat));
        } catch (e) {
            global.logError(uuid + " could not format clock: " + e);
            this._time.set_text("");
            this._date.set_text("");
        }

        this._timezoneLabel.set_text(label);
    }
};

function MyDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        _loadModules();

        if (ClockActions)
            ClockActions.setTranslate(_);
        if (ClockDialog)
            ClockDialog.setTranslate(_);

        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], deskletId);
        this.settings.bind("layout-mode", "layoutMode", this.on_setting_changed);
        this.settings.bind("fixed-rows", "fixedRows", this.on_setting_changed);
        this.settings.bind("fixed-cols", "fixedCols", this.on_setting_changed);
        this.settings.bind("tile-spacing", "tileSpacing", this.on_setting_changed);
        this.settings.bind("width", "width", this.on_setting_changed);
        this.settings.bind("height", "height", this.on_setting_changed);
        this.settings.bind("enable-clock-editing", "enableEditing", this.on_setting_changed);
        this.settings.bind("show-add-tile", "showAddTile", this.on_setting_changed);
        this.settings.bind("confirm-remove", "confirmRemove");
        this.settings.bind("time-format", "timeFormat", this.on_setting_changed);
        this.settings.bind("date-format", "dateFormat", this.on_setting_changed);
        this.settings.bind("time-size", "timeSize", this.on_setting_changed);
        this.settings.bind("date-size", "dateSize", this.on_setting_changed);
        this.settings.bind("timezone-size", "timezoneSize", this.on_setting_changed);
        this.settings.bind("clocks", "clocks", this._onClocksChanged);

        this._clockWidgets = [];
        this.buttons = [];
        this._addTiles = [];
        this._normalizedClocks = [];
        this._timeout = null;
        this._tileInner = null;
        this._widthSamples = null;

        /* At most one transient tile menu is alive at a time. Tile menus are
         * parented to Main.uiGroup, so destroy_all_children() on our own
         * container will never reach them - they must be released by hand. */
        this._tileMenu = null;
        this._idleSources = [];
        this._rebuildTimeout = null;
        this._fitId = null;
        this._clockDialog = null;
        this._confirmDialog = null;

        this.mainContainer = new St.BoxLayout({
            vertical: true,
            style_class: "world-clock-container"
        });
        this.mainContainer.set_width(this.width || 600);
        this.mainContainer.set_height(this.height || 400);

        this.setContent(this.mainContainer);
        this.setHeader(_("World Clocks"));

        this._ensureClockDefaults();
        this._rebuildGrid();
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

        this._destroyTileMenu();
        this._dismissDialogs();

        if (this._idleSources) {
            for (let i = 0; i < this._idleSources.length; i++)
                Mainloop.source_remove(this._idleSources[i]);
            this._idleSources = [];
        }
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }
        if (this._rebuildTimeout) {
            Mainloop.source_remove(this._rebuildTimeout);
            this._rebuildTimeout = null;
        }
        if (this._fitId) {
            Mainloop.source_remove(this._fitId);
            this._fitId = null;
        }

        this._clockWidgets = [];
        this.buttons = [];
        this._addTiles = [];

        if (this.settings) {
            this.settings.finalize();
            this.settings = null;
        }

        if (this._destroyId) {
            this.disconnect(this._destroyId);
            this._destroyId = 0;
        }
    },

    _dismissDialogs: function () {
        if (this._clockDialog) {
            try { this._clockDialog.destroy(); } catch (e) {}
            this._clockDialog = null;
        }
        if (this._confirmDialog) {
            try { this._confirmDialog.destroy(); } catch (e) {}
            this._confirmDialog = null;
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
        if (this._rebuildTimeout) {
            Mainloop.source_remove(this._rebuildTimeout);
            this._rebuildTimeout = null;
        }
        this._rebuildTimeout = Mainloop.timeout_add(100, () => {
            this._rebuildTimeout = null;
            this._rebuildGrid();
            return false;
        });
    },

    _onClocksChanged: function () {
        try {
            if (!ClockActions || !this.mainContainer)
                return;
            const result = ClockActions.normalizeClockList(this.clocks);
            this._normalizedClocks = result.clocks;
            if (result.changed)
                this.settings.setValue("clocks", result.clocks);
            this._rebuildGrid();
        } catch (e) {
            global.logError(uuid + " clocks change failed: " + e);
        }
    },

    /* setValue does not fire the bind callback in-process, so the grid must
     * be rebuilt here. _normalizedClocks is the live list _getClockList uses. */
    _setClockList: function (list) {
        this._normalizedClocks = Array.isArray(list) ? list : [];
        this.settings.setValue("clocks", this._normalizedClocks);
        this._rebuildGrid();
    },

    /* ------------------------------------------------------------------ *
     * Grid construction
     * ------------------------------------------------------------------ */

    _rebuildGrid: function () {
        try {
            if (!_loadModules())
                return;

            this._destroyTileMenu();
            this.mainContainer.destroy_all_children();

            this._clockWidgets = [];
            this.buttons = [];
            this._addTiles = [];

            const clocks = this._getClockList();
            const showAdd = !!(this.enableEditing && this.showAddTile && ClockActions.canAdd(clocks));
            const dims = this._computeGridDims();
            const cells = ClockActions.planCells(clocks.length, showAdd, dims.rows, dims.cols);

            const table = new St.Table({
                homogeneous: true,
                reactive: true,
                style_class: "world-clock-grid"
            });
            this.mainContainer.add(table, {
                expand: true,
                x_expand: true,
                y_expand: true,
                x_fill: true,
                y_fill: true
            });

            for (let i = 0; i < cells.length; i++) {
                const cell = cells[i];
                const row = Math.floor(i / dims.cols);
                const col = i % dims.cols;
                const actor = (cell.kind === "add")
                    ? this._createAddTile()
                    : this._createClockTile(clocks[cell.index], cell.index);

                table.add(actor, {
                    row: row,
                    col: col,
                    x_expand: true,
                    y_expand: true,
                    x_fill: true,
                    y_fill: true
                });
            }

            this._updateClocks();
            this._widthSamples = this._formatWidthSamples();
            this._tileInner = this._computeTileInnerSize();
            this._scheduleFit();
            this._updateHighlight();
        } catch (e) {
            global.logError(uuid + " grid rebuild failed: " + e);
        }
    },

    _createClockTile: function (clock, index) {
        const widget = new ClockWidget(clock, this);
        widget.actor.index = index;
        widget.actor.clockId = clock.id;
        widget.actor.connect("clicked", this._onClockTileClicked.bind(this));
        widget.actor.set_style("margin:" + Math.max(0, this.tileSpacing || 0) + "px;");
        this._clockWidgets.push(widget);
        this.buttons.push(widget.actor);
        return widget.actor;
    },

    _createAddTile: function () {
        const button = new St.Button({
            style_class: "world-clock-add-tile",
            reactive: true,
            can_focus: true,
            x_expand: true,
            y_expand: true
        });
        const label = new St.Label({
            text: "+",
            style_class: "world-clock-add-label"
        });
        try {
            label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            label.clutter_text.line_wrap = false;
        } catch (e) {}
        button.set_child(label);
        button.connect("clicked", this._onAddClock.bind(this));
        button.set_style("margin:" + Math.max(0, this.tileSpacing || 0) + "px;");
        this._addTiles.push({ button: button, label: label });
        return button;
    },

    _onClockTileClicked: function (actor, clickedButton) {
        try {
            if (clickedButton === 3) {
                if (this.enableEditing)
                    this._openTileMenu(actor);
            }
        } catch (e) {
            global.logError(uuid + " tile click failed: " + e);
        }
    },

    /* ------------------------------------------------------------------ *
     * Per-tile context menu
     * ------------------------------------------------------------------ */

    _openTileMenu: function (button) {
        try {
            this._destroyTileMenu();

            const index = button.index;
            const clocks = this._getClockList();
            const menu = new PopupMenu.PopupMenu(button, St.Side.TOP);
            Main.uiGroup.add_actor(menu.actor);
            menu.actor.hide();

            const editItem = new PopupMenu.PopupMenuItem(_("Edit…"));
            editItem.connect("activate", () => {
                this._onEditClock(index);
            });
            menu.addMenuItem(editItem);

            const removeItem = new PopupMenu.PopupMenuItem(_("Remove"));
            removeItem.setSensitive(ClockActions.canRemove(clocks));
            removeItem.connect("activate", () => {
                this._onRemoveClock(index);
            });
            menu.addMenuItem(removeItem);

            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const addItem = new PopupMenu.PopupMenuItem(_("Add clock"));
            addItem.setSensitive(ClockActions.canAdd(clocks));
            addItem.connect("activate", this._onAddClock.bind(this));
            menu.addMenuItem(addItem);

            if (this._menuManager)
                this._menuManager.addMenu(menu);

            this._tileMenu = menu;
            menu.open(true);
        } catch (e) {
            global.logError(uuid + " could not open tile menu: " + e);
            this._destroyTileMenu();
        }
    },

    _destroyTileMenu: function () {
        if (!this._tileMenu)
            return;
        const menu = this._tileMenu;
        this._tileMenu = null;
        try {
            if (menu.isOpen)
                menu.close(false);
            if (this._menuManager)
                this._menuManager.removeMenu(menu);
            menu.destroy();
        } catch (e) {
            global.logError(uuid + " could not destroy tile menu: " + e);
        }
    },

    /* Menu items must not act synchronously: PopupMenuBase closes the menu in
     * its own 'activate' handler, which runs after ours. Destroying the menu
     * or pushing a modal dialog before that has happened fights the menu's
     * grab. Defer to the next main loop turn and track the source so teardown
     * can cancel it.
     *
     * timeout_add(0), not idle_add: idle callbacks sit below Clutter's redraw
     * priority, so an action fired while a menu or dialog was still animating
     * could be starved for hundreds of milliseconds. */
    _deferAction: function (fn) {
        const self = this;
        let id = Mainloop.timeout_add(0, function () {
            self._idleSources = self._idleSources.filter(function (s) { return s !== id; });
            if (self._cleanedUp)
                return false;
            try {
                fn.call(self);
            } catch (e) {
                global.logError(uuid + " deferred action failed: " + e);
            }
            return false;
        });
        this._idleSources.push(id);
    },

    _onAddClock: function () {
        this._deferAction(function () {
            this._destroyTileMenu();
            if (!ClockActions.canAdd(this._getClockList()))
                return;
            const zones = ClockActions.listTimezones
                ? ClockActions.listTimezones()
                : null;
            this._clockDialog = ClockDialog.promptClock(_("Add Clock"), ClockActions.DEFAULT_CLOCK, (values) => {
                if (this._cleanedUp)
                    return;
                this._setClockList(ClockActions.addClock(this._getClockList(), values));
            }, zones);
        });
    },

    _onEditClock: function (index) {
        this._deferAction(function () {
            this._destroyTileMenu();
            const clocks = this._getClockList();
            if (!ClockActions.isValidIndex(clocks, index))
                return;
            const current = clocks[index];
            const zones = ClockActions.listTimezones
                ? ClockActions.listTimezones()
                : null;
            this._clockDialog = ClockDialog.promptClock(_("Edit Clock"), current, (values) => {
                if (this._cleanedUp)
                    return;
                this._setClockList(ClockActions.updateClock(this._getClockList(), current.id, values));
            }, zones);
        });
    },

    _onRemoveClock: function (index) {
        this._deferAction(function () {
            this._destroyTileMenu();
            const clocks = this._getClockList();
            if (!ClockActions.isValidIndex(clocks, index))
                return;
            if (!ClockActions.canRemove(clocks))
                return;

            const clock = clocks[index];
            const doRemove = () => {
                if (this._cleanedUp)
                    return;
                this._setClockList(ClockActions.removeClock(this._getClockList(), clock.id));
            };

            if (this.confirmRemove && clock.name) {
                const prompt = _("Are you sure you want to remove clock \"%s\"?").format(clock.name);
                const dialog = new ModalDialog.ConfirmDialog(prompt, doRemove);
                this._confirmDialog = dialog;
                dialog.open();
                return;
            }

            doRemove();
        });
    },

    /* ------------------------------------------------------------------ *
     * Helpers
     * ------------------------------------------------------------------ */

    _getClockList: function () {
        if (this._normalizedClocks && this._normalizedClocks.length)
            return this._normalizedClocks;
        if (!ClockActions)
            return [];
        const result = ClockActions.normalizeClockList(this.clocks);
        this._normalizedClocks = result.clocks;
        return this._normalizedClocks;
    },

    _computeGridDims: function () {
        if (!ClockActions)
            return { rows: 1, cols: 1 };
        const clocks = this._getClockList();
        const showAdd = !!(this.enableEditing && this.showAddTile && ClockActions.canAdd(clocks));
        const cellCount = clocks.length + (showAdd ? 1 : 0);
        return ClockActions.computeGridDims(cellCount, this.layoutMode, this.fixedRows, this.fixedCols);
    },

    _computeTileInnerSize: function () {
        const dims = this._computeGridDims();
        if (!ClockActions || !ClockActions.computeTileInnerSize)
            return { width: 80, height: 80 };
        return ClockActions.computeTileInnerSize(
            this.width || 600, this.height || 400, dims.rows, dims.cols, this.tileSpacing);
    },

    _formatWidthSamples: function () {
        const timeFormat = this.timeFormat || DEFAULT_TIME_FORMAT;
        const dateFormat = this.dateFormat || DEFAULT_DATE_FORMAT;
        const dates = [
            new Date(2023, 11, 27, 23, 59, 59),
            new Date(2023, 8, 20, 12, 0, 0),
            new Date()
        ];
        let time = "";
        let date = "";
        for (let i = 0; i < dates.length; i++) {
            try {
                const t = dates[i].toLocaleFormat(timeFormat);
                const d = dates[i].toLocaleFormat(dateFormat);
                if (String(t).length > time.length)
                    time = t;
                if (String(d).length > date.length)
                    date = d;
            } catch (e) {}
        }
        for (let i = 0; i < this._clockWidgets.length; i++) {
            const widget = this._clockWidgets[i];
            const t = widget._time.get_text();
            const d = widget._date.get_text();
            if (t && t.length > time.length)
                time = t;
            if (d && d.length > date.length)
                date = d;
        }
        if (!time)
            time = "23:59:59";
        if (!date)
            date = "Wednesday, 31 December";
        return { time: time, date: date };
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
            this._fitAllTiles(this._tileInner);
            return false;
        });
    },

    _fitAllTiles: function (inner) {
        inner = inner || this._tileInner;
        const samples = this._widthSamples || this._formatWidthSamples();
        this._widthSamples = samples;
        if (!inner)
            return;
        for (let i = 0; i < this._clockWidgets.length; i++)
            this._clockWidgets[i].applyFittedSizes(inner, samples);
        for (let i = 0; i < this._addTiles.length; i++)
            this._applyAddTileSize(this._addTiles[i].label, inner);
    },

    _applyAddTileSize: function (label, inner) {
        if (!label || !inner || !ClockActions || !ClockActions.computeFittedFontSizes)
            return;
        const sizes = ClockActions.computeFittedFontSizes(inner.width, inner.height, {}, {
            time: Number(this.timeSize) || 40,
            date: Number(this.dateSize) || 15,
            timezone: Number(this.timezoneSize) || 12
        });
        label.set_style("font-size: " + sizes.add + "pt;");
    },

    _ensureClockDefaults: function () {
        if (!ClockActions)
            return;

        let raw = this.clocks;
        if (!Array.isArray(raw) || raw.length === 0 ||
                (raw.length === 1 && raw[0] && raw[0].id === "default")) {
            const legacy = this._legacyClockFromMetadata();
            if (legacy)
                raw = [legacy];
        }

        const replacedPlaceholder = raw !== this.clocks;
        const result = ClockActions.normalizeClockList(raw);
        this._normalizedClocks = result.clocks;
        if (result.changed || replacedPlaceholder)
            this.settings.setValue("clocks", result.clocks);
    },

    _legacyClockFromMetadata: function () {
        const legacy = this.metadata || {};
        const hasLegacy = legacy.timeFormat || legacy.dateFormat || legacy.timeSize ||
            legacy.timezone || legacy.name;
        if (!hasLegacy)
            return null;
        return ClockActions.buildClock({
            name: legacy.name || ClockActions.DEFAULT_CLOCK.name,
            timezone: legacy.timezone || ClockActions.DEFAULT_CLOCK.timezone
        }, "legacy");
    },

    _updateHighlight: function () {
        try {
            for (let i = 0; i < this._clockWidgets.length; i++) {
                const widget = this._clockWidgets[i];
                if (widget.data && widget.data.timezone === "local")
                    widget.actor.add_style_pseudo_class("outlined");
                else
                    widget.actor.remove_style_pseudo_class("outlined");
            }
        } catch (e) {
            global.logError(uuid + " highlight update failed: " + e);
        }
    },

    _updateClocks: function () {
        const now = new Date();
        this._clockWidgets.forEach(function (widget) {
            widget.update(now);
        });
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
        this._updateClocks();
        return true;
    }
};

function main(metadata, deskletId) {
    return new MyDesklet(metadata, deskletId);
}
