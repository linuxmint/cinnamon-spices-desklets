/* global imports, global */
const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Gettext = imports.gettext;
const GLib = imports.gi.GLib;

const uuid = "cinnamon-workspace-grid-desklet@curbsoftware";

Gettext.bindtextdomain(uuid, GLib.get_user_data_dir() + "/locale");

function _(str) {
    return Gettext.dgettext(uuid, str);
}

/* Xlet-local modules. Cinnamon exposes a desklet's own directory through
 * imports.ui.deskletManager.desklets[uuid]; resolved lazily in _init() so a
 * load-order problem surfaces as a logged error instead of a load failure. */
let WorkspaceActions = null;
let RenameDialog = null;

function _loadModules() {
    if (WorkspaceActions && RenameDialog)
        return true;
    try {
        const dir = imports.ui.deskletManager.desklets[uuid];
        WorkspaceActions = dir.workspaceActions;
        RenameDialog = dir.renameDialog;
        if (!(WorkspaceActions && RenameDialog))
            global.logError(uuid + " could not load helper modules");
        return !!(WorkspaceActions && RenameDialog);
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
        this.switch_id = null;
        this.scroll_id = null;
        this.ws_added_id = null;
        this.ws_removed_id = null;
        this.ws_name_id = null;

        this.mainContainer = new St.BoxLayout({
            vertical: true,
            style_class: 'workspace-grid-container'
        });
        /* Apply fallback sizing to prevent undefined → NaN crashes */
        this.mainContainer.set_width(this.width || 600);
        this.mainContainer.set_height(this.height || 400);

        this.setContent(this.mainContainer);

        this.switch_id = global.window_manager.connect('switch-workspace', this._update.bind(this));

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
        if (this.switch_id) {
            global.window_manager.disconnect(this.switch_id);
            this.switch_id = null;
        }
        if (this.scroll_id) {
            this.mainContainer.disconnect(this.scroll_id);
            this.scroll_id = null;
        }
        this._disconnectWorkspaceSignals();

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
            /* scroll-up = 0, scroll-down = 1 */
            const direction = event.get_scroll_direction();
            const count = this._getWorkspaceCount();
            if (count <= 1)
                return false;

            const active = WorkspaceActions.getActiveWorkspaceIndex();
            const dims = this._computeGridDims();
            let target = active;

            if (this.scrollWheelBehavior === "col") {
                target += (direction === 0 ? -1 : 1);
            } else if (this.scrollWheelBehavior === "row") {
                /* translate to row/col grid */
                let row = Math.floor(active / dims.cols);
                let col = active % dims.cols;

                if (direction === 0) row--; else row++;
                if (row < 0) { row = dims.rows - 1; col--; }
                if (row >= dims.rows) { row = 0; col++; }
                target = row * dims.cols + col;
            }

            /* clamp */
            if (target < 0 || target >= count) return false;
            WorkspaceActions.activateWorkspaceByIndex(target);
        } catch (e) {
            global.logError(uuid + " scroll handler failed: " + e);
        }
        return false;
    },

    on_setting_changed: function () {
        try {
            this.mainContainer.set_width(this.width);
            this.mainContainer.set_height(this.height);
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
            this.mainContainer.destroy_all_children();

            /* reset list & compute target dimensions */
            this.buttons = [];

            const wsCount = this._getWorkspaceCount();
            const showAdd = !!(this.enableEditing && this.showAddTile && WorkspaceActions.canAdd());
            const dims = this._computeGridDims();
            const cells = WorkspaceActions.planCells(wsCount, showAdd, dims.rows, dims.cols);

            const table = new St.Table({ homogeneous: true, reactive: true });
            this.mainContainer.add(table, { expand: true, x_expand: true, y_expand: true, x_fill: true, y_fill: true });

            for (let i = 0; i < cells.length; i++) {
                const cell = cells[i];
                const row = Math.floor(i / dims.cols);
                const col = i % dims.cols;

                const button = (cell.kind === "add")
                    ? this._createAddTile()
                    : this._createWorkspaceTile(cell.index);

                table.add(button, { row: row, col: col, x_expand: true, y_expand: true, x_fill: true, y_fill: true });
            }

            /* refresh active highlight now that buttons exist */
            this._update();
        } catch (e) {
            global.logError(uuid + " grid rebuild failed: " + e);
        }
    },

    _createWorkspaceTile: function (index) {
        const button = new St.Button({
            style_class: 'workspace-button',
            reactive: true,
            can_focus: true
        });
        /* Accept right-click too, so a tile can raise its own context menu.
         * St.Button consumes the release, so the Desklet base class right-click
         * handler does not also open the desklet menu. */
        button.set_button_mask(St.ButtonMask.ONE | St.ButtonMask.THREE);

        const label = new St.Label({
            text: this._getWorkspaceName(index),
            style_class: 'workspace-label'
        });
        button.set_child(label);
        button.index = index;
        button.connect('clicked', this._onWorkspaceButtonClicked.bind(this));
        button.set_style("margin:" + Math.max(0, this.tileSpacing || 0) + "px;");

        this.buttons.push(button);
        return button;
    },

    _createAddTile: function () {
        const button = new St.Button({
            style_class: 'workspace-add-tile',
            reactive: true,
            can_focus: true
        });
        const label = new St.Label({
            text: "+",
            style_class: 'workspace-add-label'
        });
        button.set_child(label);
        button.connect('clicked', this._onAddWorkspace.bind(this));
        button.set_style("margin:" + Math.max(0, this.tileSpacing || 0) + "px;");
        return button;
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

            const renameItem = new PopupMenu.PopupMenuItem(_("Rename…"));
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
        return WorkspaceActions.computeGridDims(cellCount, this.layoutMode, this.fixedRows, this.fixedCols);
    },

    _update: function () {
        try {
            const active_ws_index = WorkspaceActions.getActiveWorkspaceIndex();
            for (let i = 0; i < this.buttons.length; i++) {
                const button = this.buttons[i];
                if (button.index === active_ws_index) {
                    button.add_style_pseudo_class('outlined');
                } else {
                    button.remove_style_pseudo_class('outlined');
                }
            }
        } catch (e) {
            global.logError(uuid + " highlight update failed: " + e);
        }
    },

    _connectWorkspaceSignals: function () {
        if (!_loadModules())
            return;
        this.ws_added_id = global.workspace_manager.connect('workspace-added', this._onWorkspacesChanged.bind(this));
        this.ws_removed_id = global.workspace_manager.connect('workspace-removed', this._onWorkspacesChanged.bind(this));
        /* Workspace names live in org.cinnamon.desktop.wm.preferences; the old
         * org.cinnamon "workspace-name-overrides" key is deprecated and never
         * changes, so renames were previously never picked up. */
        this.ws_name_id = WorkspaceActions.connectNameChanges(this._onWorkspacesChanged.bind(this));
    },

    _disconnectWorkspaceSignals: function () {
        if (this.ws_added_id) {
            global.workspace_manager.disconnect(this.ws_added_id);
            this.ws_added_id = null;
        }
        if (this.ws_removed_id) {
            global.workspace_manager.disconnect(this.ws_removed_id);
            this.ws_removed_id = null;
        }
        if (this.ws_name_id) {
            WorkspaceActions.disconnectNameChanges(this.ws_name_id);
            this.ws_name_id = null;
        }
    },

    _onWorkspacesChanged: function () {
        // Debounce so a burst of add/remove/rename events causes one rebuild
        if (this._rebuildTimeout) {
            Mainloop.source_remove(this._rebuildTimeout);
            this._rebuildTimeout = null;
        }
        this._rebuildTimeout = Mainloop.timeout_add(100, () => {
            this._rebuildTimeout = null;
            this._rebuildGrid();
            return false; // Don't repeat
        });
    }
};

function main(metadata, deskletId) {
    return new MyDesklet(metadata, deskletId);
}
