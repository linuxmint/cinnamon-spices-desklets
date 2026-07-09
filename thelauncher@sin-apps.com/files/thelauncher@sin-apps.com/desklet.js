const Gtk = imports.gi.Gtk;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Pango = imports.gi.Pango;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Tooltips = imports.ui.tooltips;
const Util = imports.misc.util;
const PopupMenu = imports.ui.popupMenu;

const UUID = "thelauncher@sin-apps.com";
const BASE_TILE_WIDTH = 120;
const DEFAULT_POSITION = 50;

// Native CJS importer (Cinnamon 6.8+): top-level function/var exports via imports.desklets.
const MeLib = imports.desklets[UUID].lib;
const {
    ensureLinkDirectory,
    loadConfig,
    saveConfig,
    getDefaultBaseDirectory,
    getResolvedPath
} = MeLib.config;
const { scanDirectory } = MeLib.linkScanner;
const {
    getFolderClickMode,
    itemsToOrderList,
    orderListToIds,
    orderListToDisabledIds,
    saveItemState,
    readSidecar,
    resolveOrderEntryId,
    getEntryType,
    ensureSidecarForDirectory
} = MeLib.sidecar;
const { launchDesktop, openDocument, getDocumentIcon, openFolder } = MeLib.launcher;
const { createDirectoryMonitor } = MeLib.fileMonitor;
const {
    COLOR_TOKEN_KEYS,
    resolvePresetId,
    applyPresetTokens,
    normalizeColorMode,
    normalizePresetId,
    isCustomColorMode
} = MeLib.themePresets;
const {
    readGSettingsPosition,
    writeGSettingsPosition,
    isDragLocked,
    LOCK_DESKLETS_KEY
} = MeLib.placement;
const { ensureSettingsDefaults } = MeLib.settingsDefaults;

function TheLauncherDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

TheLauncherDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this._desklet_id = desklet_id;
        this._isReloading = false;
        this._fileMonitor = null;
        this._refreshPending = false;
        this._refreshIdleId = 0;
        this._applyingPositionId = 0;
        this._lastMaxWidth = null;
        this._lastMaxHeight = null;
        this._lastContentFit = null;
        this._applyingPreset = false;
        this._applyingPosition = false;
        this._lockIndicator = null;
        this._globalLockHandlerId = 0;
        this._dragLockRefreshId = 0;
        this._dragEndHandlerId = 0;
        this._syncingOrderList = false;
        this._configurePanelOpen = false;
        this._applyingOrderPath = false;
        this._deskletMetadata = metadata;
        this._itemTooltips = [];
        this._panelBox = null;
        this._lastUsedColumns = 1;
        this._cachedPanelWidth = 0;
        this._sizeSyncId = 0;
        this._suppressDirectoryRefresh = false;

        this.content.x_align = St.Align.START;
        this.content.y_align = St.Align.START;
        this.content.x_expand = false;
        this.content.y_expand = false;
        this.actor.x_expand = false;
        this.actor.y_expand = false;

        this.base_directory = loadConfig().baseDirectory || "";
        this.subdirectory = "default";
        this.launch_mode = "single-click";
        this.folder_click_mode = "navigate";
        this.folder_sort = "mixed";
        this.show_tooltips = true;
        this.color_mode = "system";
        this.light_preset = "light-default";
        this.dark_preset = "dark-default";
        this.layout_style = "tile";
        this.columns = 8;
        this.row_spacing = 5;
        this.col_spacing = 5;
        this.scale = 1.0;
        this.text_align = "center";
        this.transparent_background = false;
        this.icon_size = 50;
        this.text_width_padding = 16;
        this.show_text = true;
        this.link_font = "Noto Sans Regular 13";
        this.text_shadow = true;
        this.text_shadow_color = "rgba(0,0,0,0.5)";
        this.link_bg_color = "rgb(61,123,200)";
        this.document_bg_color = "rgb(45,106,79)";
        this.folder_bg_color = "rgb(74,85,104)";
        this.border_width = 2;
        this.border_color = "rgb(42,42,42)";
        this.folder_border_color = "rgb(42,42,42)";
        this.text_color = "rgb(255,255,255)";
        this.desklet_bg_color = "rgb(46,46,46)";
        this.title_color = "rgb(255,255,255)";
        this.hover_bg_color = "rgb(74,143,212)";
        this.pressed_bg_color = "rgb(45,95,154)";
        this.folder_icon_tint = "rgb(255,255,255)";
        this.tooltip_bg_color = "rgb(26,26,26)";
        this.tooltip_text_color = "rgb(255,255,255)";
        this.disabled_opacity = 0.35;
        this.position_x = DEFAULT_POSITION;
        this.position_y = DEFAULT_POSITION;
        this.snap_to_grid = true;
        this.max_width = 0;
        this.max_height = 0;
        this.content_fit = "auto";
        this.lock_position = false;
        this.show_lock_indicator = true;
        this.link_order_list = [];
        this.order_folder_path = "";
        this.order_breadcrumb_display = "";
        this.order_in_subfolder = false;
        this.order_open_folder_id = "";

        this._lastBaseDirectory = null;
        this._lastSubdirectory = null;
        this._lastFolderSort = null;
        this._lastThemeState = null;
        this._lastPositionX = null;
        this._lastPositionY = null;
        this._lastLockPosition = null;
        this._navStack = [];
        this._rootPath = null;

        this._settingKeys = [
            "base-directory",
            "subdirectory",
            "launch-mode",
            "folder-click-mode",
            "folder-sort",
            "show-tooltips",
            "color-mode",
            "light-preset",
            "dark-preset",
            "layout-style",
            "columns",
            "row-spacing",
            "col-spacing",
            "scale",
            "text-align",
            "transparent-background",
            "icon-size",
            "show-text",
            "text-width-padding",
            "link-font",
            "text-shadow",
            "text-shadow-color",
            "border-width"
        ];

        this._placementKeys = [
            "position-x",
            "position-y",
            "snap-to-grid",
            "max-width",
            "max-height",
            "content-fit",
            "lock-position",
            "show-lock-indicator"
        ];

        this.settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        ensureSettingsDefaults(this.settings);
        this._settingKeys.forEach(key => {
            const prop = key.replace(/-/g, "_");
            this.settings.bindProperty(
                Settings.BindingDirection.IN,
                key,
                prop,
                this._onSettingsChanged.bind(this)
            );
        });

        this._placementKeys.forEach(key => {
            const prop = key.replace(/-/g, "_");
            this.settings.bindProperty(
                Settings.BindingDirection.IN,
                key,
                prop,
                this._onPlacementSettingsChanged.bind(this)
            );
        });

        COLOR_TOKEN_KEYS.forEach(key => {
            const prop = key.replace(/-/g, "_");
            this.settings.bindProperty(
                Settings.BindingDirection.IN,
                key,
                prop,
                this._onColorSettingChanged.bind(this)
            );
        });

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "disabled-opacity",
            "disabled_opacity",
            this._onColorSettingChanged.bind(this)
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "link-order-list-data",
            "link_order_list",
            function() {}
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "order-in-subfolder",
            "order_in_subfolder",
            function() {}
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "order-folder-path",
            "order_folder_path",
            this._onOrderFolderPathChanged.bind(this)
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "order-breadcrumb-display",
            "order_breadcrumb_display",
            function() {}
        );

        if (!this.base_directory) {
            this.base_directory = loadConfig().baseDirectory || getDefaultBaseDirectory();
        }
        this._lastBaseDirectory = this._resolveBaseDirectory();
        this._lastThemeState = null;
        this._initializePlacementSettings();

        this._applyStoragePath(false);
        this._setupPlacement();
        this.setHeader(_("TheLauncher"));
        this._onSettingsChanged();
    },

    on_desklet_added_to_desktop: function(userEnabled) {
        this._setupPlacement();
        this._updateDragLock();
        this._syncPositionFromActor();
        this._refresh();
    },

    finalizeContextMenu: function() {
        const openDirItem = new PopupMenu.PopupMenuItem(_("Open link folder"));
        openDirItem.connect("activate", (function() {
            const path = this._rootPath || this._getCurrentPath();
            if (path) {
                openFolder(path);
            }
        }).bind(this));
        this._menu.addMenuItem(openDirItem);
        Desklet.Desklet.prototype.finalizeContextMenu.call(this);
    },

    on_desklet_removed: function() {
        this._destroyItemTooltips();
        this._teardownPlacement();
        this._stopFileMonitor();
        this._cancelScheduledRefresh();
        if (this._applyingPositionId) {
            Mainloop.source_remove(this._applyingPositionId);
            this._applyingPositionId = 0;
        }
        if (this.settings && !this._isReloading) {
            this.settings.finalize();
        }
    },

    _getPreferredWidth: function(actor) {
        if (!this._isLiveActor(actor)) {
            return 0;
        }

        return this._getLayoutWidth(actor);
    },

    _getLayoutWidth: function(actor) {
        if (!actor || actor.is_finalized()) {
            return 0;
        }

        try {
            const [, naturalWidth] = actor.get_preferred_width(-1);
            return Math.max(0, Math.round(naturalWidth));
        } catch (e) {
            return 0;
        }
    },

    _getItemMinWidth: function() {
        if (this._isListLayout()) {
            return 0;
        }

        const buttonPadding = 16;
        const iconWidth = this.icon_size > 0 ? this.icon_size : 0;
        const textWidth = this.show_text ? this._getTileTextWidth() : 0;
        return Math.max(iconWidth, textWidth, Math.round(this._getTileWidth() * 0.75)) + buttonPadding;
    },

    _getItemLayoutWidth: function(itemActor) {
        const measured = this._getLayoutWidth(itemActor);
        const minWidth = this._getItemMinWidth();
        if (minWidth > 0) {
            return Math.max(measured, minWidth);
        }
        return measured;
    },

    _computePanelBoxWidth: function(panelBox, usedColumns) {
        if (!panelBox) {
            return 0;
        }

        let width = 0;
        const grid = this._findGridContainer(panelBox);
        if (grid) {
            const children = grid.get_children() || [];
            width = this._computePanelWidthFromGrid(grid, usedColumns, children.length);
        }

        panelBox.get_children().forEach(child => {
            if (child === grid) {
                return;
            }

            const childWidth = this._getLayoutWidth(child);
            if (childWidth > 0) {
                width = Math.max(width, childWidth + this._getDeskletPadding());
            }
        });

        return width;
    },

    _getDeskletPadding: function() {
        return 16;
    },

    _measureLivePanelWidth: function(panelBox, usedColumns) {
        if (!panelBox) {
            return 0;
        }

        let width = 0;
        const grid = this._findGridContainer(panelBox);
        if (grid) {
            const gridWidth = this._getLayoutWidth(grid);
            if (gridWidth > 0) {
                width = Math.max(width, gridWidth + this._getDeskletPadding());
            }
        }

        if (width <= 0) {
            width = this._computePanelBoxWidth(panelBox, usedColumns);
        }

        panelBox.get_children().forEach(child => {
            if (child === grid) {
                return;
            }

            const childWidth = this._getLayoutWidth(child);
            if (childWidth > 0) {
                width = Math.max(width, childWidth + this._getDeskletPadding());
            }
        });

        if (width > 0 && this.max_width > 0) {
            width = Math.min(width, this.max_width);
        }

        return width > 0 ? Math.round(width) : 0;
    },

    _findGridContainer: function(panelBox) {
        if (!panelBox) {
            return null;
        }

        for (const child of panelBox.get_children()) {
            const styleClass = String(child.style_class || "");
            if (styleClass.indexOf("thelauncher-grid") !== -1
                || styleClass.indexOf("thelauncher-list") !== -1) {
                return child;
            }
        }

        return null;
    },

    _computePanelWidthFromGrid: function(gridContainer, usedColumns, itemCount) {
        if (!gridContainer) {
            return 0;
        }

        const children = gridContainer.get_children();
        if (!children || children.length === 0) {
            return 0;
        }

        const columns = Math.max(1, Math.min(usedColumns || 1, itemCount || children.length));
        const spacing = Math.round(columns > 1 ? this.col_spacing : this.row_spacing);
        let maxRowWidth = 0;

        for (let rowStart = 0; rowStart < children.length; rowStart += columns) {
            let rowWidth = 0;
            let colsInRow = 0;
            const rowEnd = Math.min(rowStart + columns, children.length);

            for (let i = rowStart; i < rowEnd; i++) {
                rowWidth += this._getItemLayoutWidth(children[i]);
                colsInRow += 1;
            }

            if (colsInRow > 1) {
                rowWidth += (colsInRow - 1) * spacing;
            }

            if (rowWidth <= 0 && colsInRow > 0 && !this._isListLayout()) {
                rowWidth = (colsInRow * this._getTileWidth())
                    + (Math.max(0, colsInRow - 1) * spacing);
            }

            maxRowWidth = Math.max(maxRowWidth, rowWidth);
        }

        let width = maxRowWidth + this._getDeskletPadding();
        if (maxRowWidth <= 0 && !this._isListLayout()) {
            const colsInRow = Math.min(columns, itemCount || children.length);
            width = (colsInRow * this._getTileWidth())
                + (Math.max(0, colsInRow - 1) * spacing)
                + this._getDeskletPadding();
        } else if (this.max_width > 0) {
            width = Math.min(width, this.max_width);
        }

        return Math.round(width);
    },

    _measurePanelContentWidth: function(panelBox) {
        const width = this._computePanelBoxWidth(panelBox, this._lastUsedColumns);
        const padding = this._getDeskletPadding();
        if (width > padding) {
            return width - padding;
        }
        return 0;
    },

    _getShrinkPanelWidth: function(panelBox, usedColumns) {
        if (this._isFixedContentFit() && this.max_width > 0) {
            return this.max_width;
        }

        let width = 0;
        if (panelBox) {
            width = this._computePanelBoxWidth(panelBox, usedColumns);
        }

        if (width <= this._getDeskletPadding() && this._cachedPanelWidth > this._getDeskletPadding()) {
            width = this._cachedPanelWidth;
        }
        if (width <= this._getDeskletPadding()) {
            width = this._getNaturalPanelWidth(usedColumns);
        }

        if (width > 0 && this.max_width > 0) {
            width = Math.min(width, this.max_width);
        }

        return width > 0 ? Math.round(width) : 0;
    },

    _isLiveActor: function(actor) {
        return !!(actor && !actor.is_finalized() && actor.get_stage());
    },

    _cancelScheduledRefresh: function() {
        if (this._refreshIdleId) {
            Mainloop.source_remove(this._refreshIdleId);
            this._refreshIdleId = 0;
        }
        this._refreshPending = false;
    },

    _cancelPanelSizeSync: function() {
        if (this._sizeSyncId) {
            Mainloop.source_remove(this._sizeSyncId);
            this._sizeSyncId = 0;
        }
    },

    _scheduleRefresh: function() {
        if (this._refreshPending) {
            return;
        }

        this._refreshPending = true;
        this._refreshIdleId = Mainloop.idle_add((function() {
            this._refreshIdleId = 0;
            this._refreshPending = false;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    _syncDeskletActorSize: function() {
        if (!this._isLiveActor(this._panelBox)) {
            this._panelBox = null;
            return;
        }

        let width = this._measureLivePanelWidth(this._panelBox, this._lastUsedColumns);
        if (width <= 0) {
            width = this._getShrinkPanelWidth(this._panelBox, this._lastUsedColumns);
        }
        if (width <= 0) {
            return;
        }

        this._cachedPanelWidth = width;
        this._applyPanelAllocation(this._panelBox, this._lastUsedColumns, width);
        this._applyContainerStyle(this._panelBox, this._lastUsedColumns, width);
        this.actor.set_width(width);

        if (this._isFixedContentFit() && this.max_height > 0) {
            this.actor.set_height(this.max_height);
        } else {
            this.actor.set_height(-1);
        }
    },

    _schedulePanelSizeSync: function() {
        if (this._sizeSyncId) {
            return;
        }

        let passes = 0;
        const runSync = (function() {
            this._syncDeskletActorSize();
            passes += 1;
            if (passes < 2 && this._isLiveActor(this._panelBox)) {
                this._sizeSyncId = Mainloop.idle_add(runSync);
                return GLib.SOURCE_REMOVE;
            }

            this._sizeSyncId = 0;
            return GLib.SOURCE_REMOVE;
        }).bind(this);

        this._sizeSyncId = Mainloop.idle_add(runSync);
    },

    _applyPanelAllocation: function(panelBox, usedColumns, widthOverride) {
        this._lastUsedColumns = usedColumns || this._lastUsedColumns;

        panelBox.x_expand = false;
        panelBox.y_expand = false;
        panelBox.x_align = St.Align.START;

        if (this._isFixedContentFit() && this.max_width > 0) {
            panelBox.set_width(this.max_width);
            if (this.max_height > 0) {
                panelBox.set_height(this.max_height);
            }
            return;
        }

        const width = widthOverride > 0
            ? widthOverride
            : this._getShrinkPanelWidth(panelBox, usedColumns);
        if (width > 0) {
            panelBox.set_width(width);
        } else {
            panelBox.set_width(-1);
        }
        panelBox.set_height(-1);
    },

    on_desklet_reloaded: function() {
        this._isReloading = true;
    },

    _getInstanceId: function() {
        return String(this.instance_id != null ? this.instance_id : this._desklet_id);
    },

    _scanDirectory: function(path, options) {
        const scanOptions = options || {};
        scanOptions.folderSort = this.folder_sort || "mixed";
        return scanDirectory(path, scanOptions);
    },

    _beginDeskletDrag: function(event) {
        if (isDragLocked(this.lock_position) || !this._draggable) {
            return;
        }

        if (event.get_button() !== 1) {
            return;
        }

        this._draggable._onButtonPress(this.actor, event);
    },

    _onDeskletDragHandlePress: function(actor, event) {
        this._beginDeskletDrag(event);
        return Clutter.EVENT_STOP;
    },

    _buildDragHandle: function() {
        const handle = new St.Bin({
            style_class: "thelauncher-drag-handle",
            reactive: true,
            track_hover: true,
            can_focus: false,
            x_expand: true
        });
        handle.connect(
            "button-press-event",
            this._onDeskletDragHandlePress.bind(this)
        );
        return handle;
    },

    _wrapWithDragHandle: function(contentActor) {
        if (isDragLocked(this.lock_position)) {
            return contentActor;
        }

        const wrapper = new St.BoxLayout({
            vertical: true,
            x_expand: false,
            y_expand: false,
            x_align: St.Align.START,
            style_class: "thelauncher-drag-shell"
        });
        wrapper.add_child(this._buildDragHandle());
        wrapper.add_child(contentActor);
        return wrapper;
    },

    _clearApplyingPositionLater: function() {
        if (this._applyingPositionId) {
            Mainloop.source_remove(this._applyingPositionId);
        }

        this._applyingPositionId = Mainloop.timeout_add(250, (function() {
            this._applyingPositionId = 0;
            this._applyingPosition = false;
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    _initializePlacementSettings: function() {
        const gsettingsPos = readGSettingsPosition(UUID, this._getInstanceId());
        if (gsettingsPos) {
            this._applyingPosition = true;
            this.settings.setValue("position-x", gsettingsPos.x);
            this.settings.setValue("position-y", gsettingsPos.y);
            this._lastPositionX = gsettingsPos.x;
            this._lastPositionY = gsettingsPos.y;
            this._clearApplyingPositionLater();
        } else {
            this._lastPositionX = this.position_x;
            this._lastPositionY = this.position_y;
        }

        this._lastMaxWidth = this.max_width;
        this._lastMaxHeight = this.max_height;
        this._lastContentFit = this.content_fit;
        this._lastLockPosition = this.lock_position;
    },

    _setupPlacement: function() {
        if (this._draggable && !this._dragEndHandlerId) {
            this._dragEndHandlerId = this._draggable.connect(
                "drag-end",
                this._onDeskletDragEnd.bind(this)
            );
        }

        if (!this._globalLockHandlerId) {
            this._globalLockHandlerId = global.settings.connect(
                "changed::" + LOCK_DESKLETS_KEY,
                this._scheduleDragLockRefresh.bind(this)
            );
        }

        this._updateDragLock();
    },

    _scheduleDragLockRefresh: function() {
        if (this._dragLockRefreshId) {
            return;
        }

        this._dragLockRefreshId = Mainloop.idle_add((function() {
            this._dragLockRefreshId = 0;
            this._updateDragLock();
            return false;
        }).bind(this));
    },

    _teardownPlacement: function() {
        if (this._dragEndHandlerId && this._draggable) {
            this._draggable.disconnect(this._dragEndHandlerId);
            this._dragEndHandlerId = 0;
        }

        if (this._globalLockHandlerId) {
            global.settings.disconnect(this._globalLockHandlerId);
            this._globalLockHandlerId = 0;
        }

        if (this._dragLockRefreshId) {
            Mainloop.source_remove(this._dragLockRefreshId);
            this._dragLockRefreshId = 0;
        }

        this._lockIndicator = null;
    },

    _onPlacementSettingsChanged: function() {
        if (this._applyingPosition) {
            return;
        }

        const positionChanged = this._lastPositionX !== this.position_x
            || this._lastPositionY !== this.position_y;
        const layoutChanged = this._lastMaxWidth !== this.max_width
            || this._lastMaxHeight !== this.max_height
            || this._lastContentFit !== this.content_fit;
        const lockChanged = this._lastLockPosition !== this.lock_position;

        this._updateDragLock();

        if (positionChanged) {
            this._applyPositionFromSettings();
            return;
        }

        this._lastPositionX = this.position_x;
        this._lastPositionY = this.position_y;
        this._lastLockPosition = this.lock_position;

        if (layoutChanged || lockChanged) {
            this._lastMaxWidth = this.max_width;
            this._lastMaxHeight = this.max_height;
            this._lastContentFit = this.content_fit;
            this._scheduleRefresh();
        }
    },

    _applyPositionFromSettings: function() {
        this._applyingPosition = true;
        const x = this.settings.getValue("position-x");
        const y = this.settings.getValue("position-y");
        const snapped = writeGSettingsPosition(
            UUID,
            this._getInstanceId(),
            x,
            y,
            this.snap_to_grid
        );

        this.actor.set_position(snapped.x, snapped.y);
        if (snapped.x !== x || snapped.y !== y) {
            this.settings.setValue("position-x", snapped.x);
            this.settings.setValue("position-y", snapped.y);
        }
        this._lastPositionX = snapped.x;
        this._lastPositionY = snapped.y;
        this._clearApplyingPositionLater();
    },

    _syncPositionFromActor: function() {
        const x = Math.round(this.actor.get_x());
        const y = Math.round(this.actor.get_y());

        this._applyingPosition = true;
        this.settings.setValue("position-x", x);
        this.settings.setValue("position-y", y);
        this._lastPositionX = x;
        this._lastPositionY = y;
        this._clearApplyingPositionLater();

        writeGSettingsPosition(
            UUID,
            this._getInstanceId(),
            x,
            y,
            this.snap_to_grid
        );
    },

    _onDeskletDragEnd: function(draggable, eventTime, success) {
        if (!success || isDragLocked(this.lock_position)) {
            return;
        }

        const x = Math.round(this.actor.get_x());
        const y = Math.round(this.actor.get_y());
        const snapped = writeGSettingsPosition(
            UUID,
            this._getInstanceId(),
            x,
            y,
            this.snap_to_grid
        );

        this._applyingPosition = true;
        this.settings.setValue("position-x", snapped.x);
        this.settings.setValue("position-y", snapped.y);
        this._lastPositionX = snapped.x;
        this._lastPositionY = snapped.y;
        this._clearApplyingPositionLater();
    },

    _updateDragLock: function() {
        if (this._draggable) {
            this._draggable.inhibit = isDragLocked(this.lock_position);
        }
    },

    on_capture_position_callback: function() {
        this._syncPositionFromActor();
    },

    on_reset_position_callback: function() {
        this._applyingPosition = true;
        this.settings.setValue("position-x", DEFAULT_POSITION);
        this.settings.setValue("position-y", DEFAULT_POSITION);
        this._lastPositionX = DEFAULT_POSITION;
        this._lastPositionY = DEFAULT_POSITION;
        this._clearApplyingPositionLater();
        this._applyPositionFromSettings();
    },

    _resolveBaseDirectory: function() {
        const configured = (this.base_directory || "").trim();
        return configured || getDefaultBaseDirectory();
    },

    _syncSharedConfig: function() {
        const base = this._resolveBaseDirectory();
        saveConfig({ version: 1, baseDirectory: base });
    },

    _getThemeState: function() {
        return [
            normalizeColorMode(this.color_mode),
            normalizePresetId(this.light_preset, "light-default"),
            normalizePresetId(this.dark_preset, "dark-default")
        ].join(":");
    },

    _applyActivePreset: function(refresh) {
        const presetId = resolvePresetId(
            this.color_mode,
            this.light_preset,
            this.dark_preset
        );
        if (!presetId) {
            if (refresh !== false) {
                this._finishSettingsRefresh();
            }
            return;
        }

        this._applyingPreset = true;
        applyPresetTokens(this.settings, this._deskletMetadata, presetId);
        this._applyingPreset = false;
        this._lastThemeState = this._getThemeState();

        if (refresh !== false) {
            this._finishSettingsRefresh();
        }
    },

    _setColorModeCustom: function() {
        if (!isCustomColorMode(this.color_mode)) {
            this.settings.setValue("color-mode", "custom");
        }
    },

    _onColorSettingChanged: function() {
        if (!this._applyingPreset) {
            this._setColorModeCustom();
        }
        this._onSettingsChanged();
    },

    _onSettingsChanged: function() {
        if (this._applyingPreset) {
            return;
        }

        const themeState = this._getThemeState();
        if (!isCustomColorMode(this.color_mode) && themeState !== this._lastThemeState) {
            this._applyActivePreset();
            return;
        }

        this._finishSettingsRefresh();
    },

    _finishSettingsRefresh: function() {
        const baseChanged = this._lastBaseDirectory !== this._resolveBaseDirectory();
        const subChanged = this._lastSubdirectory !== this.subdirectory;
        const folderSortChanged = this._lastFolderSort !== this.folder_sort;
        const storageChanged = baseChanged || subChanged;

        if (baseChanged) {
            this._syncSharedConfig();
            this._lastBaseDirectory = this._resolveBaseDirectory();
        }

        if (storageChanged) {
            this._applyStoragePath(false);
        } else if (folderSortChanged) {
            const rootPath = this._getOrderRootPath();
            if (rootPath) {
                this._scanDirectory(rootPath, {
                    persistOrder: true,
                    ignoreSavedOrder: true
                });
            }
            this._syncOrderListFromDirectory();
            this._restartFileMonitor();
        } else {
            this._restartFileMonitor();
        }

        this._lastFolderSort = this.folder_sort;
        if (!storageChanged) {
            this._scheduleRefresh();
        }
        this._applyHeaderStyle();
    },

    on_create_link_directory_callback: function() {
        this._applyStoragePath(true);
    },

    _clearOrderListForMissingPath: function() {
        if (!this.settings || this._syncingOrderList) {
            return;
        }

        this._syncingOrderList = true;
        this.settings.setValue("link-order-list-data", []);
        this.settings.setValue("order-folder-path", "");
        this.order_folder_path = "";
        this._updateOrderBrowseDisplay();
        this._syncingOrderList = false;
    },

    _applyHeaderStyle: function() {
        if (this._header_label) {
            this._header_label.set_style("color: %s;".format(this.title_color));
        }
    },

    _destroyItemTooltips: function() {
        this._itemTooltips.forEach(tooltip => {
            if (tooltip && tooltip.destroy) {
                tooltip.destroy();
            }
        });
        this._itemTooltips = [];
    },

    _getTextAlign: function() {
        if (this.text_align === "left") {
            return St.Align.START;
        }
        if (this.text_align === "right") {
            return St.Align.END;
        }
        return St.Align.MIDDLE;
    },

    _tooltipText: function(item) {
        if (item.type === "folder") {
            return item.path;
        }
        return item.comment || item.name;
    },

    _isDirectoryPath: function(path) {
        if (!path) {
            return false;
        }
        try {
            const stream = Gio.File.new_for_path(path).read(null);
            stream.close(null);
            return false;
        } catch (e) {
            const message = String(e);
            return message.indexOf("IS_DIRECTORY") !== -1
                || message.indexOf("Is a directory") !== -1
                || message.indexOf("is a directory") !== -1;
        }
    },

    _applyStoragePath: function(createIfMissing) {
        this._lastSubdirectory = this.subdirectory;
        this._navStack = [];
        const resolvedPath = getResolvedPath(this.subdirectory);

        try {
            this._syncSharedConfig();
            const exists = this._isDirectoryPath(resolvedPath);

            if (!exists && !createIfMissing) {
                this._rootPath = null;
                this._stopFileMonitor();
                this._clearOrderListForMissingPath();
                this._scheduleRefresh();
                return false;
            }

            this._rootPath = createIfMissing || !exists
                ? ensureLinkDirectory(this.subdirectory)
                : resolvedPath;
            this._navStack.push({
                path: this._rootPath,
                label: this.subdirectory || "default"
            });
        } catch (e) {
            global.logError(e, "TheLauncher: failed to prepare link directory");
            this._rootPath = null;
            this._navStack = [];
            this._clearOrderListForMissingPath();
            this._scheduleRefresh();
            return false;
        }

        if (this._rootPath && this.settings) {
            this._setOrderBrowsePath(this._rootPath);
        }
        this._restartFileMonitor();
        this._syncOrderListFromDirectory();
        this._scheduleRefresh();
        return true;
    },

    _getOrderEntryType: function(entry) {
        return getEntryType(entry);
    },

    _resolveOrderEntryId: function(entry) {
        return resolveOrderEntryId(entry);
    },

    _updateOrderNavState: function() {
        if (this._configurePanelOpen || !this.settings || !this._rootPath) {
            return;
        }

        const orderPath = this._getOrderDirectoryPath();
        const inSubfolder = !!(orderPath && orderPath !== this._rootPath);
        if (this.order_in_subfolder !== inSubfolder) {
            this.settings.setValue("order-in-subfolder", inSubfolder);
            this.order_in_subfolder = inSubfolder;
        }
    },

    _onOrderFolderPathChanged: function() {
        if (this._applyingOrderPath || this._syncingOrderList || this._configurePanelOpen) {
            return;
        }

        Mainloop.idle_add((function() {
            this._refreshOrderEditorFromPath();
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    _refreshOrderEditorFromPath: function() {
        if (this._configurePanelOpen) {
            return;
        }

        this._updateOrderBrowseDisplay();
        this._syncOrderListFromDirectory();
        this._updateOrderNavState();
    },

    _reloadOrderSettingsFromPanel: function() {
        const configured = (this.settings.getValue("order-folder-path") || "").trim();
        if (configured && this._isDirectoryPath(configured)) {
            this.order_folder_path = configured;
        } else if (this._rootPath) {
            this.order_folder_path = this._rootPath;
        }
    },

    on_order_path_changed_callback: function() {
        Mainloop.idle_add((function() {
            this._reloadOrderSettingsFromPanel();
            this._refreshOrderEditorFromPath();
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    _getOrderBrowseLabel: function() {
        const path = this._getOrderDirectoryPath();
        if (!path) {
            return "";
        }

        if (!this._rootPath || path === this._rootPath) {
            return _("Home");
        }

        if (path.indexOf(this._rootPath + "/") === 0) {
            return path.substring(this._rootPath.length + 1).split("/").join(" / ");
        }

        return path;
    },

    _setOrderBrowsePath: function(path) {
        if (!path) {
            return;
        }

        const normalized = String(path);
        const current = (this.order_folder_path || "").trim();
        if (current === normalized) {
            this._refreshOrderEditorFromPath();
            return;
        }

        this._applyingOrderPath = true;
        this.order_folder_path = normalized;
        this.settings.setValue("order-folder-path", normalized);
        this._applyingOrderPath = false;
        this._refreshOrderEditorFromPath();
    },

    _updateOrderBrowseDisplay: function() {
        if (this._configurePanelOpen) {
            return;
        }

        const label = this._getOrderBrowseLabel();
        this.order_breadcrumb_display = label;
        this.settings.setValue("order-breadcrumb-display", label);
    },

    _getItemPathForOrderEntry: function(entry) {
        const browsePath = this._getOrderDirectoryPath();
        const entryId = this._resolveOrderEntryId(entry);
        if (!browsePath || !entryId) {
            return null;
        }

        const separator = String(entryId).indexOf(":");
        if (separator <= 0) {
            return null;
        }

        const name = entryId.substring(separator + 1);
        return GLib.build_filenamev([browsePath, name]);
    },

    _enterOrderFolder: function(entry) {
        const path = this._getItemPathForOrderEntry(entry);
        if (!path || !this._isDirectoryPath(path)) {
            global.log("TheLauncher: " + _("Folder not found."));
            return;
        }

        this.settings.setValue("order-in-subfolder", true);
        this._setOrderBrowsePath(path);
    },

    _getOrderDirectoryPath: function() {
        const configured = (this.order_folder_path || "").trim();
        if (configured && this._isDirectoryPath(configured)) {
            if (this._rootPath
                && configured !== this._rootPath
                && configured.indexOf(this._rootPath + "/") !== 0) {
                return this._rootPath;
            }
            return configured;
        }

        return this._rootPath;
    },

    _getOrderRootPath: function() {
        return this._getOrderDirectoryPath();
    },

    _syncOrderListFromDirectory: function() {
        const orderPath = this._getOrderDirectoryPath();
        if (!orderPath) {
            return;
        }

        const scanResult = this._scanDirectory(orderPath, { persistOrder: false });
        if (scanResult.error) {
            return;
        }

        ensureSidecarForDirectory(orderPath, scanResult.items);

        this._syncingOrderList = true;
        this.settings.setValue(
            "link-order-list-data",
            itemsToOrderList(scanResult.items)
        );
        if ((this.order_folder_path || "").trim() !== orderPath) {
            this.settings.setValue("order-folder-path", orderPath);
            this.order_folder_path = orderPath;
        }
        this._updateOrderBrowseDisplay();
        this._syncingOrderList = false;
    },

    _applyOrderFromSettings: function() {
        const orderPath = this._getOrderDirectoryPath();
        if (!orderPath) {
            return;
        }

        const orderIds = orderListToIds(this.link_order_list);
        const disabledIds = orderListToDisabledIds(this.link_order_list);
        const existingSidecar = readSidecar(orderPath);
        if (orderIds.length === 0) {
            return;
        }

        saveItemState(
            orderPath,
            orderIds,
            disabledIds,
            existingSidecar.itemStyles || {}
        );
        this._suppressDirectoryRefresh = true;
        this._refresh();
        this._suppressDirectoryRefresh = false;
    },

    on_refresh_order_callback: function() {
        this._reloadOrderSettingsFromPanel();
        this._syncOrderListFromDirectory();
    },

    on_back_home_callback: function() {
        if (!this._rootPath) {
            return;
        }

        this.settings.setValue("order-in-subfolder", false);
        this._setOrderBrowsePath(this._rootPath);
    },

    on_apply_order_callback: function() {
        this._reloadOrderSettingsFromPanel();
        this._applyOrderFromSettings();
    },

    configureDesklet: function(tab) {
        this._configurePanelOpen = true;
        if (this._rootPath) {
            this.order_folder_path = this._rootPath;
            this.order_in_subfolder = false;
        }
        Desklet.Desklet.prototype.configureDesklet.call(this, tab !== undefined ? tab : 0);
        Mainloop.timeout_add(500, (function() {
            this._configurePanelOpen = false;
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    openAbout: function() {
        const candidates = [
            GLib.build_filenamev([
                GLib.get_user_data_dir(),
                "cinnamon",
                "desklets",
                UUID,
                "about-dialog.py"
            ]),
            GLib.build_filenamev([
                "/usr/share/cinnamon/desklets",
                UUID,
                "about-dialog.py"
            ])
        ];

        for (let i = 0; i < candidates.length; i++) {
            try {
                const stream = Gio.File.new_for_path(candidates[i]).read(null);
                stream.close(null);
                Util.spawn(["python3", candidates[i], "desklets", UUID]);
                return;
            } catch (e) {
                // Try next candidate, then fall back to default About.
            }
        }

        Desklet.Desklet.prototype.openAbout.call(this);
    },

    on_add_item_callback: function() {
        global.log("TheLauncher: Add launcher is handled in the Configure panel.");
    },

    on_remove_item_callback: function() {
        global.log("TheLauncher: Remove launcher is handled in the Configure panel.");
    },

    on_items_changed_callback: function() {
        Mainloop.idle_add((function() {
            this._reloadOrderSettingsFromPanel();
            this._refresh();
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    _deleteItemFromDirectory: function(rootPath, entry) {
        const id = String(this._resolveOrderEntryId(entry) || "");
        const separator = id.indexOf(":");
        if (separator <= 0) {
            return;
        }

        const name = id.substring(separator + 1);
        const targetPath = GLib.build_filenamev([rootPath, name]);

        try {
            Gio.File.new_for_path(targetPath).trash(null);
            this._syncOrderListFromDirectory();
            this._refresh();
        } catch (e) {
            const message = String(e);
            if (message.indexOf("No such file") !== -1
                || message.indexOf("NOT_FOUND") !== -1
                || message.indexOf("does not exist") !== -1) {
                global.log("TheLauncher: " + _("Item not found."));
                return;
            }
            global.logError(e, "TheLauncher: failed to remove item");
            global.log("TheLauncher: " + _("Could not remove item."));
        }
    },

    _restartFileMonitor: function() {
        this._stopFileMonitor();
        const currentPath = this._getCurrentPath();
        if (!currentPath) {
            return;
        }

        this._fileMonitor = createDirectoryMonitor(
            currentPath,
            this._onDirectoryChanged.bind(this)
        );
    },

    _stopFileMonitor: function() {
        if (this._fileMonitor) {
            this._fileMonitor.stop();
            this._fileMonitor = null;
        }
    },

    _onDirectoryChanged: function() {
        if (this._suppressDirectoryRefresh) {
            return;
        }
        this._scheduleRefresh();
    },

    _getCurrentPath: function() {
        if (this._navStack.length === 0) {
            return this._rootPath;
        }
        return this._navStack[this._navStack.length - 1].path;
    },

    _getCurrentSidecar: function() {
        const currentPath = this._getCurrentPath();
        if (!currentPath) {
            return { folderClickMode: null };
        }
        const result = this._scanDirectory(currentPath, { persistOrder: false });
        return result.sidecar;
    },

    _refresh: function() {
        this._cancelPanelSizeSync();
        this._destroyItemTooltips();
        this._panelBox = null;

        const currentPath = this._getCurrentPath();
        if (!currentPath) {
            this._buildMessage(
                _("Link directory not found. Enter a subdirectory name, then click Create link directory.")
            );
            return;
        }

        const scanResult = this._scanDirectory(currentPath, { persistOrder: false });
        if (!scanResult.error && scanResult.items.length === 0) {
            global.log("TheLauncher: no items in " + currentPath);
        }
        this._buildUI(scanResult);
    },

    _navigateToFolder: function(item) {
        this._navStack.push({
            path: item.path,
            label: item.name
        });
        this._restartFileMonitor();
        this._refresh();
    },

    _navigateBack: function() {
        if (this._navStack.length > 1) {
            this._navStack.pop();
            this._restartFileMonitor();
            this._refresh();
        }
    },

    _shouldLaunchApp: function(clickCount) {
        if (this.launch_mode === "double-click") {
            return clickCount >= 2;
        }
        return clickCount === 1;
    },

    _onItemActivated: function(item, clickCount) {
        if (!item.enabled) {
            return;
        }

        if (item.type === "folder") {
            const sidecar = this._getCurrentSidecar();
            const mode = getFolderClickMode(sidecar, this.folder_click_mode);
            if (mode === "open-file-manager") {
                openFolder(item.path);
            } else {
                this._navigateToFolder(item);
            }
            return;
        }

        if (item.type === "document") {
            if (this._shouldLaunchApp(clickCount)) {
                openDocument(item.path);
            }
            return;
        }

        if (this._shouldLaunchApp(clickCount)) {
            launchDesktop(item);
        }
    },

    _itemStyle: function(item, state) {
        if (!item.enabled) {
            return "background-color: rgba(110, 110, 110, 0.35); color: %s;".format(this.text_color);
        }

        const isFolder = item.type === "folder";
        const isDocument = item.type === "document";
        let bg = isFolder
            ? (item.bgColor ? item.bgColor : this.folder_bg_color)
            : isDocument ? this.document_bg_color
            : this.link_bg_color;
        const borderColor = isFolder ? this.folder_border_color : this.border_color;

        if (state === "hover") {
            bg = this.hover_bg_color;
        } else if (state === "pressed") {
            bg = this.pressed_bg_color;
        }

        let style = "background-color: %s; color: %s;".format(bg, this.text_color);
        if (this.border_width > 0) {
            style += " border: %spx solid %s;".format(this.border_width, borderColor);
        }
        if (this.show_text && this.text_shadow) {
            style += " text-shadow: 1px 1px 2px %s;".format(this.text_shadow_color);
        }
        return style;
    },

    _getTileTextWidth: function() {
        const iconWidth = this.icon_size > 0 ? this.icon_size : 0;
        const padding = Math.max(0, Math.round(this.text_width_padding || 0));
        if (iconWidth > 0) {
            return iconWidth + padding;
        }

        return Math.max(padding, Math.round(BASE_TILE_WIDTH * this.scale * 0.85));
    },

    _configureItemLabel: function(label) {
        label.clutter_text.set_line_wrap(true);
        label.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

        if (this._isListLayout()) {
            label.x_expand = true;
            return;
        }

        label.set_width(this._getTileTextWidth());
        label.x_align = this._getTextAlign();
    },

    _createItemButton: function(item) {
        const isDisabled = !item.enabled;
        let styleClass = this._isListLayout()
            ? "thelauncher-list-item thelauncher-item"
            : "thelauncher-item";
        if (isDisabled) {
            styleClass += " thelauncher-item-disabled";
        }

        const button = new St.Button({
            style_class: styleClass,
            reactive: !isDisabled,
            track_hover: !isDisabled,
            can_focus: !isDisabled,
            x_expand: false,
            y_expand: false,
            y_align: Clutter.ActorAlign.START,
            style: this._itemStyle(item)
        });

        const inner = new St.BoxLayout({
            vertical: !this._isListLayout(),
            x_align: this._isListLayout() ? St.Align.START : this._getTextAlign(),
            y_align: St.Align.START,
            x_expand: false,
            y_expand: false
        });

        if (this.icon_size > 0) {
            let iconWidget;
            if (item.type === "folder") {
                iconWidget = new St.Icon({
                    icon_name: item.icon || "folder-symbolic",
                    icon_type: St.IconType.SYMBOLIC,
                    icon_size: this.icon_size
                });
                iconWidget.set_style("color: %s;".format(item.iconTint || this.folder_icon_tint));
            } else if (item.type === "document") {
                try {
                    iconWidget = new St.Icon({
                        gicon: getDocumentIcon(item.path),
                        icon_size: this.icon_size
                    });
                } catch (e) {
                    iconWidget = new St.Icon({
                        icon_name: "text-x-generic",
                        icon_type: St.IconType.FULLCOLOR,
                        icon_size: this.icon_size
                    });
                }
            } else if (item.icon) {
                try {
                    iconWidget = new St.Icon({
                        gicon: item.icon,
                        icon_size: this.icon_size
                    });
                } catch (e) {
                    iconWidget = new St.Icon({
                        icon_name: "application-x-executable",
                        icon_type: St.IconType.FULLCOLOR,
                        icon_size: this.icon_size
                    });
                }
            } else {
                iconWidget = new St.Icon({
                    icon_name: "application-x-executable",
                    icon_type: St.IconType.FULLCOLOR,
                    icon_size: this.icon_size
                });
            }
            inner.add_child(iconWidget);
        }

        if (this.show_text) {
            const label = new St.Label({
                text: item.name,
                style_class: "thelauncher-item-label"
            });
            if (this.link_font) {
                label.clutter_text.set_font_name(this.link_font);
            }
            this._configureItemLabel(label);
            inner.add_child(label);
        }

        button.set_child(inner);

        if (isDisabled) {
            const desaturate = new Clutter.DesaturateEffect();
            desaturate.set_factor(1.0);
            button.add_effect(desaturate);
        }

        button.connect("notify::hover", (function(actor) {
            if (!item.enabled) {
                return;
            }
            actor.set_style(this._itemStyle(item, actor.hover ? "hover" : null));
        }).bind(this));
        button.connect("button-press-event", (function(actor, event) {
            if (!item.enabled || event.get_button() !== Clutter.BUTTON_PRIMARY) {
                return Clutter.EVENT_PROPAGATE;
            }
            actor.set_style(this._itemStyle(item, "pressed"));
            this._onItemActivated(item, event.get_click_count());
            return Clutter.EVENT_STOP;
        }).bind(this));
        button.connect("button-release-event", (function(actor) {
            if (!item.enabled) {
                return Clutter.EVENT_PROPAGATE;
            }
            actor.set_style(this._itemStyle(item, actor.hover ? "hover" : null));
            return Clutter.EVENT_PROPAGATE;
        }).bind(this));

        if (this.show_tooltips) {
            const tooltip = new Tooltips.Tooltip(button, this._tooltipText(item));
            tooltip._tooltip.set_style(
                "background-color: %s; color: %s; padding: 4px 8px; border-radius: 4px;".format(
                    this.tooltip_bg_color,
                    this.tooltip_text_color
                )
            );
            this._itemTooltips.push(tooltip);
        }

        return button;
    },

    _getTileWidth: function() {
        return Math.round(BASE_TILE_WIDTH * this.scale);
    },

    _isListLayout: function() {
        const style = String(this.layout_style || "").toLowerCase();
        return style === "list" || style.indexOf("list") !== -1;
    },

    _isFixedContentFit: function() {
        const fit = String(this.content_fit || "").toLowerCase();
        return fit === "fixed" || fit.indexOf("fixed") === 0;
    },

    _computeTileColumns: function(itemCount) {
        if (itemCount <= 0) {
            return 1;
        }

        let columns = Math.max(1, Math.round(this.columns));
        columns = Math.min(columns, itemCount);

        if (this.max_width > 0) {
            const tileWidth = this._getTileWidth();
            const spacing = Math.round(this.col_spacing);
            const padding = 16;
            const maxInner = Math.max(tileWidth, this.max_width - padding);
            let fitColumns = 1;

            for (let c = 1; c <= columns; c++) {
                const rowWidth = (c * tileWidth) + ((c - 1) * spacing);
                if (rowWidth <= maxInner) {
                    fitColumns = c;
                } else {
                    break;
                }
            }

            columns = fitColumns;
        }

        return Math.max(1, columns);
    },

    _getNaturalPanelWidth: function(usedColumns) {
        if (this._isListLayout() || !usedColumns || usedColumns <= 0) {
            return 0;
        }

        const tileWidth = this._getTileWidth();
        const spacing = Math.round(
            usedColumns > 1 ? this.col_spacing : this.row_spacing
        );
        const padding = 16;
        let width = (usedColumns * tileWidth) + ((usedColumns - 1) * spacing) + padding;

        if (this.max_width > 0) {
            width = Math.min(width, this.max_width);
        }

        return Math.round(width);
    },

    _buildItemGrid: function(items, numColumns) {
        const container = new St.Widget({
            x_expand: false,
            y_expand: false,
            style_class: this._isListLayout()
                ? "thelauncher-list"
                : "thelauncher-grid"
        });
        const grid = new Clutter.GridLayout();
        grid.set_row_spacing(Math.round(this.row_spacing));
        grid.set_column_spacing(Math.round(
            numColumns > 1 ? this.col_spacing : this.row_spacing
        ));
        container.set_layout_manager(grid);

        const columns = Math.max(1, numColumns);
        for (let i = 0; i < items.length; i++) {
            const col = i % columns;
            const row = Math.floor(i / columns);
            grid.attach(this._createItemButton(items[i]), col, row, 1, 1);
        }

        return container;
    },

    _buildTileGrid: function(items) {
        return this._buildItemGrid(items, this._computeTileColumns(items.length));
    },

    _buildList: function(items) {
        return this._buildItemGrid(items, 1);
    },

    _buildNavBar: function() {
        if (this._navStack.length <= 1) {
            return null;
        }

        try {
            return this._buildNavBarContent();
        } catch (e) {
            global.logError(e, "TheLauncher: failed to build navigation bar");
            return null;
        }
    },

    _buildNavBarContent: function() {
        const nav = new St.BoxLayout({
            vertical: false,
            style_class: "thelauncher-nav",
            x_expand: true,
            y_expand: false
        });

        const backButton = new St.Button({
            style_class: "thelauncher-back-button",
            can_focus: true,
            reactive: true,
            child: new St.Icon({
                icon_name: "go-previous-symbolic",
                icon_type: St.IconType.SYMBOLIC,
                icon_size: 16
            })
        });
        backButton.connect("clicked", this._navigateBack.bind(this));

        const crumbs = this._navStack.map(entry => entry.label).join(" / ");
        const breadcrumb = new St.Label({
            text: crumbs,
            style_class: "thelauncher-breadcrumb",
            reactive: true,
            track_hover: false
        });
        breadcrumb.connect(
            "button-press-event",
            this._onDeskletDragHandlePress.bind(this)
        );

        const centerBox = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE,
            y_expand: false,
            reactive: false,
            track_hover: false,
            style_class: "thelauncher-breadcrumb-box"
        });
        centerBox.add_child(breadcrumb);

        const balanceSpacer = new St.Widget({
            style_class: "thelauncher-nav-spacer"
        });

        nav.add_child(backButton);
        nav.add_child(centerBox);
        nav.add_child(balanceSpacer);

        return nav;
    },

    _buildMessage: function(message) {
        const box = new St.BoxLayout({
            vertical: true,
            style_class: "thelauncher-desklet"
        });
        const label = new St.Label({
            text: message,
            style_class: "thelauncher-empty"
        });
        box.add_child(label);
        this._applyContainerStyle(box, 1);
        this._setDeskletContent(box, 1);
    },

    _applyContainerStyle: function(actor, usedColumns, widthOverride) {
        if (!actor || actor.is_finalized()) {
            return;
        }

        let style = "";

        if (!this.transparent_background) {
            style += "background-color: %s; ".format(this.desklet_bg_color);
        }

        if (this._isFixedContentFit() && this.max_width > 0) {
            style += "width: %spx; min-width: %spx; max-width: %spx;".format(
                this.max_width,
                this.max_width,
                this.max_width
            );
        } else {
            const shrinkWidth = widthOverride > 0
                ? widthOverride
                : this._getShrinkPanelWidth(actor, usedColumns);
            if (this.max_width > 0) {
                style += "max-width: %spx;".format(this.max_width);
            }
            if (shrinkWidth > 0) {
                style += "width: %spx; min-width: %spx;".format(shrinkWidth, shrinkWidth);
            }
        }

        actor.set_style(style);
    },

    _wrapWithLockIndicator: function(contentActor) {
        if (!this.show_lock_indicator || !isDragLocked(this.lock_position)) {
            return contentActor;
        }

        const wrapper = new St.BoxLayout({
            vertical: true,
            x_expand: false,
            y_expand: false,
            x_align: St.Align.START,
            style_class: "thelauncher-desklet-root"
        });
        const lockIcon = new St.Icon({
            icon_name: "changes-prevent-symbolic",
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 14,
            style_class: "thelauncher-lock-indicator"
        });
        const lockRow = new St.BoxLayout({
            vertical: false,
            x_align: St.Align.END
        });
        lockRow.add_child(lockIcon);
        wrapper.add_child(lockRow);
        wrapper.add_child(contentActor);
        return wrapper;
    },

    _setDeskletContent: function(contentActor, usedColumns) {
        this._panelBox = contentActor;
        if (usedColumns > 0) {
            this._lastUsedColumns = usedColumns;
        }

        contentActor.x_expand = false;
        contentActor.y_expand = false;
        contentActor.x_align = St.Align.START;

        const root = this._wrapWithDragHandle(this._wrapWithLockIndicator(contentActor));

        if (this.max_height > 0 && this._isFixedContentFit()) {
            const scroll = new St.ScrollView({
                style_class: "thelauncher-scroll",
                x_scroll_policy: St.ScrollPolicy.NEVER,
                y_scroll_policy: St.ScrollPolicy.AUTOMATIC,
                x_expand: false,
                y_expand: false
            });
            scroll.set_policy(St.ScrollPolicy.NEVER, St.ScrollPolicy.AUTOMATIC);
            scroll.add_child(root);
            scroll.set_style("max-height: %spx;".format(this.max_height));
            this.setContent(scroll);
        } else {
            this.setContent(root);
        }

        const initialWidth = this._getShrinkPanelWidth(
            contentActor,
            usedColumns || this._lastUsedColumns
        );
        if (initialWidth > 0) {
            this._cachedPanelWidth = initialWidth;
            this._applyPanelAllocation(contentActor, usedColumns || this._lastUsedColumns, initialWidth);
            this._applyContainerStyle(contentActor, usedColumns || this._lastUsedColumns, initialWidth);
            this.actor.set_width(initialWidth);
        }

        this._schedulePanelSizeSync();
    },

    _buildUI: function(scanResult) {
        const box = new St.BoxLayout({
            vertical: true,
            x_expand: false,
            y_expand: false,
            x_align: St.Align.START,
            style_class: "thelauncher-desklet"
        });
        const items = scanResult.items || [];
        const usedColumns = this._isListLayout()
            ? 1
            : this._computeTileColumns(items.length);
        this._cachedPanelWidth = 0;

        const navBar = this._buildNavBar();
        if (navBar) {
            box.add_child(navBar);
        }

        if (scanResult.error === "missing") {
            const empty = new St.Label({
                text: _("Link directory not found."),
                style_class: "thelauncher-empty"
            });
            box.add_child(empty);
            this._applyContainerStyle(box, usedColumns);
            this._setDeskletContent(box, usedColumns);
            return;
        }

        if (items.length === 0) {
            const empty = new St.Label({
                text: _("No launchers yet. Add applications, documents, or folders to:\n%s").format(this._getCurrentPath()),
                style_class: "thelauncher-empty"
            });
            box.add_child(empty);
            this._applyContainerStyle(box, usedColumns);
            this._setDeskletContent(box, usedColumns);
            return;
        }

        const content = this._isListLayout()
            ? this._buildList(items)
            : this._buildItemGrid(items, usedColumns);
        box.add_child(content);
        this._cachedPanelWidth = this._computePanelWidthFromGrid(content, usedColumns, items.length);
        if (this._cachedPanelWidth <= 16) {
            this._cachedPanelWidth = this._getNaturalPanelWidth(usedColumns);
        }
        this._applyContainerStyle(box, usedColumns);
        this._setDeskletContent(box, usedColumns);
    }
};

function main(metadata, desklet_id) {
    return new TheLauncherDesklet(metadata, desklet_id);
}
