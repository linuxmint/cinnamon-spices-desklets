/* global imports, global */
const Desklet = imports.ui.desklet;
const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Pango = imports.gi.Pango;
const SignalManager = imports.misc.signalManager;
const Tooltips = imports.ui.tooltips;
const Gettext = imports.gettext;
const GLib = imports.gi.GLib;

const uuid = "cinnamon-workspace-grid-desklet@curbsoftware";
const MIN_SWITCH_INTERVAL_MS = 220;

Gettext.bindtextdomain(uuid, GLib.get_user_data_dir() + "/locale");

function _(str) {
    return Gettext.dgettext(uuid, str);
}

/* Xlet-local modules. Cinnamon exposes a desklet's own directory through
 * imports.ui.deskletManager.desklets[uuid]; resolved lazily in _init() so a
 * load-order problem surfaces as a logged error instead of a load failure. */
let WorkspaceActions = null;
let RenameDialog = null;
let PreviewGeometry = null;
let GridModel = null;

function _loadModules() {
    if (WorkspaceActions && RenameDialog && PreviewGeometry && GridModel)
        return true;
    try {
        const dir = imports.ui.deskletManager.desklets[uuid];
        WorkspaceActions = dir.workspaceActions;
        RenameDialog = dir.renameDialog;
        PreviewGeometry = dir.previewGeometry;
        GridModel = dir.gridModel;
        if (!(WorkspaceActions && RenameDialog && PreviewGeometry && GridModel))
            global.logError(uuid + " could not load helper modules");
        return !!(WorkspaceActions && RenameDialog && PreviewGeometry && GridModel);
    } catch (e) {
        global.logError(uuid + " could not load helper modules: " + e);
        return false;
    }
}

function MyDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        _loadModules();

        if (WorkspaceActions)
            WorkspaceActions.setTranslate(_);
        if (RenameDialog)
            RenameDialog.setTranslate(_);

        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], deskletId);
        this.settings.bind("layout-mode", "layoutMode", this.on_setting_changed);
        this.settings.bind("fixed-rows", "fixedRows", this.on_setting_changed);
        this.settings.bind("fixed-cols", "fixedCols", this.on_setting_changed);
        this.settings.bind("display-type", "displayType", this.on_setting_changed);
        this.settings.bind("show-index", "showIndex", this.on_setting_changed);
        this.settings.bind("tile-spacing", "tileSpacing", this.on_setting_changed);
        this.settings.bind("width", "width", this.on_setting_changed);
        this.settings.bind("height", "height", this.on_setting_changed);
        this.settings.bind("scroll-wheel-behavior", "scrollWheelBehavior", this._onScrollSettingChanged);
        this.settings.bind("enable-workspace-editing", "enableEditing", this.on_setting_changed);
        this.settings.bind("show-add-tile", "showAddTile", this.on_setting_changed);
        this.settings.bind("confirm-remove", "confirmRemove");

        /* Prepare button array for grid tiles */
        this.buttons = [];

        /* At most one transient tile menu is alive at a time. Tile menus are
         * parented to Main.uiGroup, so destroy_all_children() on our own
         * container will never reach them - they must be released by hand. */
        this._tileMenu = null;

        /* Pending idle sources created by _deferAction(). */
        this._idleSources = [];

        this._rebuildTimeout = null;
        this.scroll_id = null;
        this.ws_name_id = null;
        this._lastSwitchTime = 0;
        this._signalManager = new SignalManager.SignalManager(null);
        this._previewSignals = new SignalManager.SignalManager(null);
        this._tooltips = [];

        this.mainContainer = new St.BoxLayout({
            vertical: true,
            style_class: 'curb-workspace-grid-container'
        });
        /* Apply fallback sizing before settings callbacks can rebuild. */
        this.mainContainer.set_width(this.width || 600);
        this.mainContainer.set_height(this.height || 400);

        this.setContent(this.mainContainer);

        this._signalManager.connect(global.window_manager, 'switch-workspace', this._update, this);

        /* connect scroll handler based on current setting */
        this._connectScrollHandler();

        this._rebuildGrid();
        this._connectWorkspaceSignals();

        /* Desklet.destroy() emits 'destroy' immediately but defers
         * on_desklet_removed() until a 500ms fade-out completes. Without this
         * hook our signal handlers keep firing against a tearing-down desklet
         * for half a second. _cleanup() is idempotent. */
        this._destroyId = this.connect('destroy', this._cleanup.bind(this));
    },

    on_desklet_removed: function () {
        this._cleanup();
    },

    _cleanup: function () {
        if (this._cleanedUp)
            return;
        this._cleanedUp = true;

        this._destroyTileMenu();

        if (this._idleSources) {
            for (let i = 0; i < this._idleSources.length; i++)
                Mainloop.source_remove(this._idleSources[i]);
            this._idleSources = [];
        }
        if (this._rebuildTimeout) {
            Mainloop.source_remove(this._rebuildTimeout);
            this._rebuildTimeout = null;
        }
        if (this.scroll_id) {
            this.mainContainer.disconnect(this.scroll_id);
            this.scroll_id = null;
        }
        this._disconnectWorkspaceSignals();
        this._previewSignals.disconnectAllSignals();
        this._signalManager.disconnectAllSignals();
        this._destroyTooltips();

        if (this.settings) {
            this.settings.finalize();
            this.settings = null;
        }

        if (this._destroyId) {
            this.disconnect(this._destroyId);
            this._destroyId = 0;
        }
    },

    _onScrollSettingChanged: function () {
        if (this._cleanedUp || !this.mainContainer)
            return;
        try {
            this._connectScrollHandler(); // reconnect with new mode
        } catch (e) {
            global.logError(uuid + " scroll setting change failed: " + e);
        }
    },

    _connectScrollHandler: function () {
        /* disconnect if already connected */
        if (this.scroll_id) {
            this.mainContainer.disconnect(this.scroll_id);
            this.scroll_id = null;
        }
        if (!this.scrollWheelBehavior || this.scrollWheelBehavior === "off")
            return;

        this.scroll_id = this.mainContainer.connect('scroll-event', this._onScrollEvent.bind(this));
    },

    _onScrollEvent: function (actor, event) {
        try {
            const direction = event.get_scroll_direction();
            if (direction !== Clutter.ScrollDirection.UP &&
                direction !== Clutter.ScrollDirection.DOWN)
                return false;

            const now = GLib.get_monotonic_time() / 1000;
            if (now - this._lastSwitchTime < MIN_SWITCH_INTERVAL_MS)
                return true;

            const count = this._getWorkspaceCount();
            if (count <= 1)
                return false;

            const active = WorkspaceActions.getActiveWorkspaceIndex();
            const dims = this._computeGridDims();
            const delta = direction === Clutter.ScrollDirection.UP ? -1 : 1;
            const target = GridModel.computeScrollTarget(
                active, count, dims.cols, this.scrollWheelBehavior, delta);
            if (target !== active) {
                WorkspaceActions.activateWorkspaceByIndex(target);
                this._lastSwitchTime = now;
            }
        } catch (e) {
            global.logError(uuid + " scroll handler failed: " + e);
        }
        return true;
    },

    on_setting_changed: function () {
        try {
            this.mainContainer.set_width(this.width);
            this.mainContainer.set_height(this.height);
            if ((this.width || 0) < 360 || (this.height || 0) < 260)
                this.mainContainer.add_style_class_name("compact");
            else
                this.mainContainer.remove_style_class_name("compact");
            this._rebuildGrid();
        } catch (e) {
            global.logError(uuid + " setting change failed: " + e);
        }
    },

    /* ------------------------------------------------------------------ *
     * Grid construction
     * ------------------------------------------------------------------ */

    _rebuildGrid: function () {
        try {
            if (!_loadModules())
                return;

            this._destroyTileMenu();
            this._destroyTooltips();
            this._previewSignals.disconnectAllSignals();
            this.mainContainer.destroy_all_children();

            /* reset list & compute target dimensions */
            this.buttons = [];

            const wsCount = this._getWorkspaceCount();
            const showAdd = !!(this.enableEditing && this.showAddTile && WorkspaceActions.canAdd());
            const dims = this._computeGridDims();
            const cells = GridModel.planCells(wsCount, showAdd);
            const nominalCellWidth = Math.max(1, Math.floor((this.width - 18) / dims.cols));
            const nominalCellHeight = Math.max(1, Math.floor((this.height - 18) / dims.rows));
            const compact = (this.width || 0) < 360 || (this.height || 0) < 260 ||
                nominalCellWidth < 100 || nominalCellHeight < 70;
            if (compact)
                this.mainContainer.add_style_class_name("compact");
            else
                this.mainContainer.remove_style_class_name("compact");

            /* The stylesheet owns these insets. Do not query the theme node
             * during initial construction because it has no stage context yet
             * and reports zero, causing a one-frame permanent overflow. */
            const containerInset = compact ? 12 : 18;
            const tableWidth = Math.max(1, Math.floor(this.mainContainer.width - containerInset));
            const tableHeight = Math.max(1, Math.floor(this.mainContainer.height - containerInset));
            const cellWidth = Math.max(1, Math.floor(tableWidth / dims.cols));
            const cellHeight = Math.max(1, Math.floor(tableHeight / dims.rows));
            const configuredMargin = Math.max(0, this.tileSpacing || 0);
            const tileMargin = Math.max(0, Math.min(configuredMargin,
                Math.floor((cellWidth - 26) / 2), Math.floor((cellHeight - 25) / 2)));
            const layout = {
                cellWidth: cellWidth,
                cellHeight: cellHeight,
                tileMargin: tileMargin,
                compact: compact
            };

            const table = new St.Table({
                homogeneous: true,
                reactive: true,
                clip_to_allocation: true,
                style_class: "curb-workspace-grid-table"
            });
            table.set_width(tableWidth);
            table.set_height(tableHeight);
            this.mainContainer.add(table, { expand: true, x_expand: true, y_expand: true, x_fill: true, y_fill: true });

            for (let i = 0; i < cells.length; i++) {
                const cell = cells[i];
                const row = Math.floor(i / dims.cols);
                const col = i % dims.cols;

                const button = (cell.kind === "add")
                    ? this._createAddTile(layout)
                    : this._createWorkspaceTile(cell.index, layout);

                table.add(button, { row: row, col: col, x_expand: true, y_expand: true, x_fill: true, y_fill: true });
            }

            /* refresh active highlight now that buttons exist */
            this._update();
            this._connectPreviewSignals();
        } catch (e) {
            global.logError(uuid + " grid rebuild failed: " + e);
        }
    },

    _createWorkspaceTile: function (index, layout) {
        const button = new St.Button({
            style_class: 'curb-workspace-grid-button',
            reactive: true,
            can_focus: true,
            track_hover: true
        });
        /* Accept right-click too, so a tile can raise its own context menu.
         * St.Button consumes the release, so the Desklet base class right-click
         * handler does not also open the desklet menu. */
        button.set_button_mask(St.ButtonMask.ONE | St.ButtonMask.THREE);

        const name = this._getWorkspaceName(index);
        const content = new St.BoxLayout({
            vertical: true,
            style_class: "curb-workspace-grid-content"
        });
        const label = new St.Label({
            text: name,
            style_class: 'curb-workspace-grid-label',
            x_align: Clutter.ActorAlign.CENTER
        });
        const spacing = layout.tileMargin * 2;
        /* Reserve both margins, the widest active border, and content padding
         * inside the table column. This keeps child preferred widths from
         * forcing St.Table beyond the container content box. */
        const contentWidth = Math.max(4,
            layout.cellWidth - spacing - (layout.compact ? 12 : 22));
        const labelWidth = contentWidth < 16 ? 12 : contentWidth;
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        label.set_width(labelWidth);
        if (this.displayType === "visual") {
            const previewHeight = Math.max(3, layout.cellHeight - spacing -
                (layout.compact ? 24 : 47));
            const preview = this._createWorkspacePreview(index, contentWidth, previewHeight);
            if (preview) {
                content.add_child(preview);
                label.add_style_class_name("visual");
            }
        }
        content.add_child(label);
        button.set_child(content);
        button.index = index;
        button.set_accessible_name(_("Workspace %d: %s").format(index + 1,
            WorkspaceActions.getWorkspaceName(index)));
        button.connect('clicked', this._onWorkspaceButtonClicked.bind(this));
        button.set_style("margin:" + layout.tileMargin + "px;");

        this._tooltips.push(new Tooltips.Tooltip(button, WorkspaceActions.getWorkspaceName(index)));

        this.buttons.push(button);
        return button;
    },

    _createWorkspacePreview: function (index, contentWidth, contentHeight) {
        const previewWidth = Math.max(4, contentWidth);
        const previewHeight = Math.max(3, contentHeight);
        /* Match Cinnamon's native switcher fallback: a graphical desktop
         * this small carries no useful information, so keep the bounded name
         * button instead of rendering noise or overflowing its cell. */
        if (previewWidth < 8 || previewHeight < 6)
            return null;
        const preview = new St.Widget({
            style_class: "curb-workspace-grid-preview",
            reactive: false,
            clip_to_allocation: true,
            layout_manager: new Clutter.FixedLayout()
        });
        preview.set_size(previewWidth, previewHeight);
        /* FixedLayout children keep their requested paint size even when a
         * themed parent receives a smaller allocation. Use an explicit clip
         * as well as clip_to_allocation so Cairo strokes and icons can never
         * paint into labels, neighboring tiles, or the desklet container. */
        preview.set_clip(0, 0, previewWidth, previewHeight);
        preview.connect("notify::allocation", function () {
            preview.set_clip(0, 0, Math.max(0, preview.width), Math.max(0, preview.height));
        });

        const workspace = global.workspace_manager.get_workspace_by_index(index);
        if (!workspace)
            return preview;

        const monitorAreas = Main.layoutManager.monitors.map(function (monitor, position) {
            const index = typeof monitor.index === "number" ? monitor.index : position;
            return workspace.get_work_area_for_monitor(index);
        });
        const desktop = PreviewGeometry.boundingRect(monitorAreas) ||
            workspace.get_work_area_all_monitors();
        const viewport = PreviewGeometry.fitRect(desktop, previewWidth, previewHeight);
        if (!viewport)
            return preview;

        for (let monitorIndex = 0; monitorIndex < monitorAreas.length; monitorIndex++) {
            const monitorRect = PreviewGeometry.projectRectInto(
                monitorAreas[monitorIndex], desktop, viewport);
            if (!monitorRect)
                continue;
            const monitorActor = new St.Widget({
                style_class: "curb-workspace-grid-monitor",
                reactive: false,
                x: monitorRect.x,
                y: monitorRect.y,
                width: monitorRect.width,
                height: monitorRect.height
            });
            preview.add_child(monitorActor);
        }

        const windows = this._getPreviewWindows(workspace);
        const tracker = Cinnamon.WindowTracker.get_default();
        const iconSize = Math.max(4, Math.min(24,
            Math.floor(Math.min(previewWidth, previewHeight) * 0.16)));
        for (let i = 0; i < windows.length; i++) {
            const win = windows[i];
            const rect = PreviewGeometry.projectRectInto(
                win.get_buffer_rect(), desktop, viewport);
            if (!rect)
                continue;

            /* St.DrawingArea can allocate a Cairo surface from this point to
             * the stage edge when nested in a desklet FixedLayout. The actor
             * allocation still looks correct, which hid the paint overflow
             * from geometry tests. A themed actor has the same appearance and
             * gives Clutter a genuinely bounded paint volume. */
            const windowActor = new St.Widget({
                style_class: "curb-workspace-grid-window " +
                    (win.has_focus() ? "active" : "inactive"),
                reactive: false,
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
            });
            preview.add_child(windowActor);

            const iconBox = PreviewGeometry.iconRect(rect, iconSize);
            if (!iconBox)
                continue;
            const app = tracker.get_window_app(win);
            let icon = app ? app.create_icon_texture_for_window(iconSize, win) : null;
            if (!icon) {
                icon = new St.Icon({
                    icon_name: "applications-other",
                    icon_type: St.IconType.FULLCOLOR,
                    icon_size: iconSize
                });
            }
            icon.reactive = false;
            icon.set_position(iconBox.x, iconBox.y);
            icon.set_size(iconSize, iconSize);
            preview.add_child(icon);
        }
        return preview;
    },

    _getPreviewWindows: function (workspace) {
        if (!workspace)
            return [];
        return workspace.list_unobscured_windows().filter(function (win) {
            return Main.isInteresting(win) && !win.is_skip_taskbar() && !win.minimized;
        }).sort(function (first, second) {
            return first.get_user_time() - second.get_user_time();
        });
    },

    _createAddTile: function (layout) {
        const button = new St.Button({
            style_class: 'curb-workspace-grid-add-tile',
            reactive: true,
            can_focus: true,
            accessible_name: _("Add workspace")
        });
        const label = new St.Label({
            text: "+",
            style_class: 'curb-workspace-grid-add-label'
        });
        button.set_child(label);
        button.connect('clicked', this._onAddWorkspace.bind(this));
        button.set_style("margin:" + layout.tileMargin + "px;");
        this._tooltips.push(new Tooltips.Tooltip(button, _("Add workspace")));
        return button;
    },

    _destroyTooltips: function () {
        if (!this._tooltips)
            return;
        for (let i = 0; i < this._tooltips.length; i++)
            this._tooltips[i].destroy();
        this._tooltips = [];
    },

    _onWorkspaceButtonClicked: function (actor, clickedButton) {
        try {
            if (clickedButton === 3) {
                if (this.enableEditing)
                    this._openTileMenu(actor);
                return;
            }
            WorkspaceActions.activateWorkspaceByIndex(actor.index);
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
            const menu = new PopupMenu.PopupMenu(button, St.Side.TOP);
            Main.uiGroup.add_actor(menu.actor);
            menu.actor.hide();

            const renameItem = new PopupMenu.PopupMenuItem(_("Rename..."));
            renameItem.connect('activate', () => {
                this._onRenameWorkspace(index);
            });
            menu.addMenuItem(renameItem);

            const removeItem = new PopupMenu.PopupMenuItem(_("Remove"));
            removeItem.setSensitive(WorkspaceActions.canRemove());
            removeItem.connect('activate', () => {
                this._onRemoveWorkspace(index);
            });
            menu.addMenuItem(removeItem);

            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const addItem = new PopupMenu.PopupMenuItem(_("Add workspace"));
            addItem.setSensitive(WorkspaceActions.canAdd());
            addItem.connect('activate', this._onAddWorkspace.bind(this));
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

    /* ------------------------------------------------------------------ *
     * Workspace actions
     * ------------------------------------------------------------------ */

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
            try {
                fn.call(self);
            } catch (e) {
                global.logError(uuid + " deferred action failed: " + e);
            }
            return false;
        });
        this._idleSources.push(id);
    },

    _onAddWorkspace: function () {
        this._deferAction(function () {
            this._destroyTileMenu();
            WorkspaceActions.addWorkspace();
        });
    },

    _onRemoveWorkspace: function (index) {
        this._deferAction(function () {
            this._destroyTileMenu();
            WorkspaceActions.removeWorkspaceByIndex(index, { confirm: this.confirmRemove });
        });
    },

    _onRenameWorkspace: function (index) {
        this._deferAction(function () {
            this._destroyTileMenu();
            if (!WorkspaceActions.isValidIndex(index))
                return;
            const current = WorkspaceActions.getWorkspaceName(index);
            RenameDialog.promptRename(current, function (newName) {
                WorkspaceActions.renameWorkspace(index, newName);
            });
        });
    },

    /* ------------------------------------------------------------------ *
     * Helpers
     * ------------------------------------------------------------------ */

    _getWorkspaceCount: function () {
        return WorkspaceActions ? WorkspaceActions.getWorkspaceCount()
                                : global.workspace_manager.n_workspaces;
    },

    _getWorkspaceName: function (index) {
        /* Use Cinnamon's Main.getWorkspaceName() which handles name overrides properly */
        let name = Main.getWorkspaceName(index);
        return this.showIndex ? (index + 1) + ". " + name : name;
    },

    _computeGridDims: function () {
        if (!WorkspaceActions)
            return { rows: 1, cols: 1 };
        const wsCount = this._getWorkspaceCount();
        const showAdd = !!(this.enableEditing && this.showAddTile && WorkspaceActions.canAdd());
        const cellCount = wsCount + (showAdd ? 1 : 0);
        return GridModel.computeGridDims(cellCount, this.layoutMode, this.fixedRows, this.fixedCols);
    },

    _update: function () {
        try {
            const active_ws_index = WorkspaceActions.getActiveWorkspaceIndex();
            for (let i = 0; i < this.buttons.length; i++) {
                const button = this.buttons[i];
                const name = WorkspaceActions.getWorkspaceName(button.index);
                if (button.index === active_ws_index) {
                    button.add_style_pseudo_class('outlined');
                    button.set_accessible_name(_("Current workspace") + ", " +
                        _("Workspace %d: %s").format(button.index + 1, name));
                } else {
                    button.remove_style_pseudo_class('outlined');
                    button.set_accessible_name(
                        _("Workspace %d: %s").format(button.index + 1, name));
                }
            }
        } catch (e) {
            global.logError(uuid + " highlight update failed: " + e);
        }
    },

    _connectWorkspaceSignals: function () {
        if (!_loadModules())
            return;
        this._signalManager.connect(global.workspace_manager, 'workspace-added', this._onWorkspacesChanged, this);
        this._signalManager.connect(global.workspace_manager, 'workspace-removed', this._onWorkspacesChanged, this);
        this._signalManager.connect(global.workspace_manager, 'notify::n-workspaces', this._onWorkspacesChanged, this);
        this._signalManager.connect(global.workspace_manager, 'workspaces-reordered', this._onWorkspacesChanged, this);
        this._signalManager.connect(Main.layoutManager, 'monitors-changed', this._onWorkspacesChanged, this);
        /* Workspace names live in org.cinnamon.desktop.wm.preferences; the old
         * org.cinnamon "workspace-name-overrides" key is deprecated and never
         * changes, so renames were previously never picked up. */
        this.ws_name_id = WorkspaceActions.connectNameChanges(this._onWorkspacesChanged.bind(this));
    },

    _disconnectWorkspaceSignals: function () {
        if (this.ws_name_id) {
            WorkspaceActions.disconnectNameChanges(this.ws_name_id);
            this.ws_name_id = null;
        }
    },

    _connectPreviewSignals: function () {
        this._previewSignals.disconnectAllSignals();
        if (this.displayType !== "visual")
            return;

        this._previewSignals.connect(global.display, 'notify::focus-window', this._queuePreviewRefresh, this);
        const count = this._getWorkspaceCount();
        for (let i = 0; i < count; i++) {
            const workspace = global.workspace_manager.get_workspace_by_index(i);
            if (!workspace)
                continue;
            this._previewSignals.connect(workspace, 'window-added', this._queuePreviewRefresh, this);
            this._previewSignals.connect(workspace, 'window-removed', this._queuePreviewRefresh, this);
            const windows = workspace.list_windows();
            for (let j = 0; j < windows.length; j++) {
                const win = windows[j];
                this._previewSignals.connect(win, 'position-changed', this._queuePreviewRefresh, this);
                this._previewSignals.connect(win, 'size-changed', this._queuePreviewRefresh, this);
                this._previewSignals.connect(win, 'notify::minimized', this._queuePreviewRefresh, this);
            }
        }
    },

    _queuePreviewRefresh: function () {
        this._onWorkspacesChanged(50);
    },

    _onWorkspacesChanged: function (delay) {
        // Debounce so a burst of add/remove/rename events causes one rebuild
        if (this._rebuildTimeout) {
            Mainloop.source_remove(this._rebuildTimeout);
            this._rebuildTimeout = null;
        }
        this._rebuildTimeout = Mainloop.timeout_add(typeof delay === "number" ? delay : 0, () => {
            this._rebuildTimeout = null;
            this._rebuildGrid();
            return false; // Don't repeat
        });
    }
};

function main(metadata, deskletId) {
    return new MyDesklet(metadata, deskletId);
}
