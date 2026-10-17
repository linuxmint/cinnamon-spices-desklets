// SPDX-License-Identifier: GPL-3.0-only AND MIT
// Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik
// Portions copyright (c) MHK924 (TheLauncher), MIT - see THIRD-PARTY-NOTICES.md

const Gtk = imports.gi.Gtk;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Clutter = imports.gi.Clutter;
const Cinnamon = imports.gi.Cinnamon;
const St = imports.gi.St;
const Pango = imports.gi.Pango;
const Gio = imports.gi.Gio;
const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Main = imports.ui.main;
const Tooltips = imports.ui.tooltips;
const Util = imports.misc.util;
const PopupMenu = imports.ui.popupMenu;
const ModalDialog = imports.ui.modalDialog;
const MessageTray = imports.ui.messageTray;
const DND = imports.ui.dnd;

const UUID = "avincelaunch-desklet@avince";

// Uebersetzung (AP09c), wie bei aVincePulse: Domaene ist die UUID, Kataloge
// unter ~/.local/share/locale (fester Pfad - Cinnamon legt sie dort ab,
// unabhaengig von XDG_DATA_HOME). Bisher lief alles ueber Cinnamons globales
// _() mit der Domaene "cinnamon" - eigene Texte wurden so nie uebersetzt.
// Fehlt eine Uebersetzung, liefert dgettext den englischen Text.
const Gettext = imports.gettext;
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(text) {
    return Gettext.dgettext(UUID, text);
}
const BASE_TILE_WIDTH = 120;
const DEFAULT_POSITION = 50;

// Pruefung Phase 2, B4 (P9): Cinnamon uebernimmt bei einer neuen Fassung von
// settings-schema.json alte Werte nur, wenn sie ECHT zwischen min und max
// liegen (settings.js _checkSanity) - Rahmen 0, 16 Spalten usw. sprangen
// still auf die Vorgabe. Darum stehen die Grenzen im Schema eine Stufe weiter
// (z. B. Rahmen -1..11); hier gelten die eigentlichen Bereiche.
// Pruefung Phase 3 Teil 2 (T9, BT4): Die Begrenzung SCHREIBT zurueck - die
// Eigenschaften sind ueber bindProperty gebunden, und Cinnamons Setter
// speichert jede Zuweisung sofort (settings.js _setValue -> _saveToFile).
// Ein im Dialog gewaehltes -1 steht danach als 0 in der <ID>.json; 0 liegt
// innerhalb der Schema-Grenzen, also ohne Folgen fuer P9. Die Hilfswerte
// (-1, 17, ...) bleiben im Dialog waehlbar (Entscheidung BT4).
const RANGED_SETTINGS = [
    ["columns", 1, 16],
    ["row_spacing", 0, 40],
    ["col_spacing", 0, 40],
    ["icon_size", 0, 128],
    ["text_width_padding", 0, 128],
    ["border_width", 0, 10],
    ["disabled_opacity", 0.1, 1.0],
    ["position_x", 0, 10000],
    ["position_y", 0, 10000]
];

function clampSetting(value, low, high) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return value;
    }
    return Math.max(low, Math.min(high, number));
}
const SCROLL_RESET_DELAY_MS = 2500;
const SCROLL_RESET_DURATION_MS = 1500;
// "Darstellung zuruecksetzen" (AP09e): Schrift und Rahmen ausser den Farben,
// die die Vorlage setzt. Ordner, Name, Groesse, Position gehoeren nicht dazu.
const APPEARANCE_RESET_KEYS = [
    "transparent-background",
    "link-font",
    "text-shadow",
    "border-width"
];
// Kontextmenue neben dem Mausklick: so weit rechts davon, oder - wenn rechts
// kein Platz ist - ebenso weit links (etwa 1 cm).
const MENU_POINTER_OFFSET = 40;
// "Loading…" erst, wenn das Einlesen so lange dauert (lokal: nie sichtbar).
const LOADING_HINT_DELAY_MS = 500;
// So lange warten Einrichten und die Papierkorb-Rueckfrage hoechstens auf
// einen Ordner, der nicht antwortet - dann wie bei "nicht lesbar".
const IO_WAIT_MS = 3000;
// Symbole im Verlauf: alle sieben aus icons/ im Desklet - so kommen sie mit
// jeder Installation mit, unabhaengig vom Icon-Thema. Cinnamon nimmt den
// Ordner selbst in den Suchpfad (extension.js:392).
const HISTORY_KIND_ICONS = {
    "move": "avincelaunch-move-symbolic",
    "width": "avincelaunch-width-symbolic",
    "height": "avincelaunch-height-symbolic",
    "size": "avincelaunch-corner-symbolic",
    "size-restore": "avincelaunch-size-restore-symbolic",
    "align": "avincelaunch-align-symbolic",
    "restore": "avincelaunch-restore-symbolic"
};

// Native CJS importer (Cinnamon 6.8+): top-level function/var exports via imports.desklets.
const MeLib = imports.desklets[UUID].lib;
const {
    ensureLinkDirectory,
    ensureOwnLinkDirectory,
    getBaseDirectory,
    getResolvedPath,
    watchBaseDirectory,
    unwatchBaseDirectory
} = MeLib.config;
const { scanDirectoryAsync } = MeLib.linkScanner;
const {
    getFolderClickMode,
    itemsToOrderList,
    orderListToIds,
    orderListToDisabledIds,
    saveItemState,
    readSidecar,
    resolveOrderEntryId,
    setPinned,
    getEntryType,
    ensureSidecarForDirectory
} = MeLib.sidecar;
const { launchDesktop, openDocument, getDocumentIcon, openFolder } = MeLib.launcher;
const { createDirectoryMonitor } = MeLib.fileMonitor;
const { moveEntry, undoMove, trashEntry, countEntries } = MeLib.itemActions;
const {
    SOURCE_PORTAL,
    PORTAL_LIMIT,
    normalizePath,
    registerReadOnlyRoot,
    unregisterReadOnlyRoot,
    isNetworkPath
} = MeLib.pathSource;
const { scanPortalAsync, ScanGate } = MeLib.portalScanner;
const { watchDesktopFree, unwatchDesktopFree, publishFenceRect } = MeLib.desktopState;
const {
    COLOR_TOKEN_KEYS,
    resolvePresetId,
    applyPresetTokens,
    normalizeColorMode,
    normalizePresetId,
    isCustomColorMode,
    AVINCELAUNCH_PRESET
} = MeLib.themePresets;
const {
    readGSettingsPosition,
    writeGSettingsPosition,
    repairPrefixCollisions,
    isDragLocked,
    LOCK_DESKLETS_KEY
} = MeLib.placement;
const { ensureSettingsDefaults } = MeLib.settingsDefaults;

// Pruefung Phase 2, A3: Meldung, wenn layout.json oder eine Sidecar-Datei
// nicht lesbar ist (lib/safeJson.js sichert sie und schreibt nicht darueber).
// Teil 2 (T13): Wer die Datei entfernt, beginnt neu - es gilt dann NICHT
// still eine aeltere .thelauncher.json (lib/sidecar.js).
// Die Bibliothek ist fuer alle Fences dieselbe - einmal setzen genuegt.
MeLib.safeJson.setReporter((path, backup) => {
    Main.notify(_("aVinceLaunch: damaged file"), backup
        ? _("%s could not be read. It stays as it is; a copy was saved as %s. Until the file is repaired (for example from the copy) or removed, no changes are saved there. If you remove it, what was stored in it starts anew.").format(path, backup)
        : _("%s could not be read. It stays as it is. Until the file is repaired or removed, no changes are saved there. If you remove it, what was stored in it starts anew.").format(path));
});
// Pruefung Phase 2, P10: abgelehnte Schreibvorgaenge in einem Portal nicht
// nur ins Protokoll, sondern einmal je Ordner auf den Schreibtisch.
MeLib.pathSource.setRefusedReporter((path) => {
    Main.notify(_("aVinceLaunch: folder portal is view only"),
        _("Nothing was saved in %s, because it is shown in a folder portal (view only).").format(path));
});
const {
    FenceResizer,
    GuideOverlay,
    getPreviousSize,
    setPreviousSize,
    getOriginalSize,
    rememberOriginalSize,
    forgetFenceLayout,
    pruneOrphanFenceLayouts,
    getLayoutSettings,
    registerFence,
    unregisterFence,
    closeAllFenceMenus,
    setShowTitleForAllFences,
    setSearchTextForAllFences,
    findFirstSearchHit,
    closeSearchInAllFences,
    isInsideAnyFence,
    startDragFromPress,
    updateCursorFromEvent,
    applyCursor,
    getOtherFenceRects,
    getWorkAreaForRect,
    captureArrangement,
    pushHistory,
    getHistory,
    restoreArrangement,
    alignFencesOnMonitorOf,
    scheduleGapLearning,
    scheduleQuickstartOnce,
    getOriginalArrangement,
    restoreOriginalArrangement,
    loadLayoutStore,
    saveLayoutStore,
    getForeignDeskletRects,
    getMoveTargets,
    notifyItemsChangedIn
} = MeLib.layoutManager;
const { snapMove, snapResize, resolveOverlap, alignFences, measureGaps, intersects, findFreeSpot } = MeLib.snapEngine;
const { computeCells } = MeLib.startLayout;
const {
    pickInstanceId,
    instanceIdsOf,
    nextGroupName,
    buildCloneValues,
    writeHandover,
    handoverExists,
    takeHandover,
    backupBeforeClone
} = MeLib.fenceClone;

// AP18-1: nur die letzte Verschiebung laesst sich zuruecknehmen - gemeinsam
// fuer alle Fences (das Modul ist fuer alle Instanzen dasselbe).
let _lastMoveRecord = null;

// N14 (Tower 12./13.10.): Leiste eines eingeklappten Fence mit denselben
// Abstaenden wie die Titelzeile im ausgeklappten Fence: oben 8 (Rand) + 2,
// seitlich 8 + 4, unten 4 + 2.
const TITLE_BAR_PADDING = "10px 12px 6px 12px";

// N17: nur eine Startaufstellung zur Zeit (alle Fences teilen das Modul).
let _startLayoutBusy = false;

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
        this._presetSettleId = 0;
        this._applyingPosition = false;
        this._lockIndicator = null;
        this._globalLockHandlerId = 0;
        this._dragLockRefreshId = 0;
        this._dragEndHandlerId = 0;
        this._syncingOrderList = false;
        this._configurePanelOpen = false;
        this._applyingOrderPath = false;
        this._storageChangeTimeoutId = 0;
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

        this.base_directory = getBaseDirectory();
        this.subdirectory = "default";
        this.source_mode = "group";
        this.portal_path = "";
        this.portal_show_hidden = false;
        this.launch_mode = "single-click";
        this.folder_click_mode = "navigate";
        this.folder_sort = "mixed";
        this.sort_mode = "manual";
        this.show_tooltips = true;
        this.color_mode = "avincelaunch";
        this.light_preset = "light-default";
        this.dark_preset = "dark-default";
        this.layout_style = "tile";
        this.columns = 8;
        this.row_spacing = 8;
        this.col_spacing = 6;
        this.text_align = "center";
        this.transparent_background = false;
        this.icon_size = 48;
        this.text_width_padding = 10;
        this.show_text = true;
        this.link_font = "Noto Sans 11";
        this.text_shadow = true;
        this.text_shadow_color = "rgba(0,0,0,0.25)";
        this.link_bg_color = "rgba(0,0,0,0)";
        this.document_bg_color = "rgba(0,0,0,0)";
        this.folder_bg_color = "rgba(0,0,0,0)";
        this.border_width = 1;
        this.border_color = "rgba(0,0,0,0)";
        this.folder_border_color = "rgba(0,0,0,0)";
        this.text_color = "rgb(255,255,255)";
        this.desklet_bg_color = "rgba(128,128,128,0.3)";
        this.title_color = "rgb(255,255,255)";
        this.hover_bg_color = "rgb(77,127,175)";
        this.pressed_bg_color = "rgb(49,95,143)";
        this.folder_icon_tint = "rgb(85,85,85)";
        this.tooltip_bg_color = "rgb(37,37,37)";
        this.tooltip_text_color = "rgb(255,255,255)";
        this.disabled_opacity = 0.35;
        this.position_x = DEFAULT_POSITION;
        this.position_y = DEFAULT_POSITION;
        this.snap_to_grid = true;
        this.max_width = 0;
        this.max_height = 0;
        this.content_fit = "auto";
        this.lock_position = true;
        this.lock_size = "with-position";
        this.lock_content = false;
        this.fence_title = "";
        // Standard seit AP12-1 aus (Angelo 05.10.); gespeicherte Werte
        // bestehender Fences bleiben.
        // N19 (Angelo 13.10.): ab Werk an - Titelzeile mit ☰ und ▾ unter der Maus.
        this.show_title = true;
        this.title_align = "center";
        this.title_mode = "hover";
        this.collapsed = false;
        this.expand_on_hover = false;
        this.show_search_button = true;
        this.link_order_list = [];
        this.order_folder_path = "";
        this.order_breadcrumb_display = "";
        this.order_in_subfolder = false;
        this.order_open_folder_id = "";
        this._lastLockSize = null;
        this._configurePanelTimerId = 0;

        this._lastBaseDirectory = null;
        this._lastSubdirectory = null;
        this._lastSourceState = null;
        // P50: hoechstens ein Einlesen je Fence (lib/portalScanner.js).
        // BT3: nach 2 min ohne Ergebnis "nicht erreichbar", ein weiterer Versuch.
        this._portalGate = new ScanGate(
            (job, done) => this._startPortalScan(job, done),
            (job, result, superseded) => this._onPortalScanResult(job, result, superseded),
            { timeoutResult: () => ({ items: [], error: "timeout", total: 0, truncated: 0 }) });
        this._portalHasContent = false;
        this._portalIsNetwork = false;
        this._portalPollId = 0;
        this._portalSignature = null;
        // Link-Ordner - lokal wie auf einem Netzlaufwerk asynchron, wie das
        // Portal (siehe _refreshLink; V4d: Netzlaufwerk).
        this._linkGate = new ScanGate(
            (job, done) => this._startLinkScan(job, done),
            (job, result, superseded) => this._onLinkScanResult(job, result, superseded),
            { timeoutResult: () => ({ items: [], manualItems: [], error: "timeout" }) });
        this._linkIsNetwork = false;
        this._linkHasContent = false;
        this._linkPollId = 0;
        this._linkSignature = null;
        this._linkOrderListPending = false;
        this._loadingHintId = 0;
        this._surfaceRebuildId = 0;
        // Liste im Dialog "Inhalte": Ordner asynchron lesen, dann abgleichen
        // (_withOrderScans) - hoechstens ein Durchgang, Anfragen in der
        // Wartezeit ergeben genau einen Folgedurchgang.
        this._orderGate = new ScanGate(
            (job, done) => this._startOrderScans(job, done),
            (job, result) => this._onOrderScansDone(job, result),
            { timeoutResult: () => ({}) });
        this._orderJob = null;
        // Abbrechen beim Entfernen und beim Ordnerwechsel (Menue: Zaehlen).
        this._ioCancellable = new Gio.Cancellable();
        this._configureWaitId = 0;
        this._configurePending = false;
        this._busyItems = {};
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
            "source-mode",
            "portal-path",
            "portal-show-hidden",
            "launch-mode",
            "folder-click-mode",
            "folder-sort",
            "sort-mode",
            "show-tooltips",
            "color-mode",
            "light-preset",
            "dark-preset",
            "layout-style",
            "columns",
            "row-spacing",
            "col-spacing",
            "text-align",
            "transparent-background",
            "icon-size",
            "show-text",
            "text-width-padding",
            "link-font",
            "text-shadow",
            "text-shadow-color",
            "border-width",
            "fence-title",
            "show-title",
            "title-align",
            "title-mode",
            "collapsed",
            "expand-on-hover",
            "show-search-button"
        ];

        this._placementKeys = [
            "position-x",
            "position-y",
            "snap-to-grid",
            "max-width",
            "max-height",
            "content-fit",
            "lock-position",
            "lock-size",
            "lock-content"
        ];

        this.settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        ensureSettingsDefaults(this.settings);
        // AP18-5: Duplikat - Werte des Originals vor dem ersten Binden
        // uebernehmen, damit schon der erste Aufbau richtig aussieht.
        this._applyCloneHandover();
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
        this._clampRangedSettings();

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

        // Custom UI widgets cannot be bound (type "custom"). Values live in
        // generic keys; re-read them here in case a bind was skipped.
        try {
            const configuredSub = (this.settings.getValue("subdirectory") || "").trim();
            if (configuredSub) {
                this.subdirectory = configuredSub;
            }
        } catch (e) {
            // Keep constructor defaults.
        }

        // Der Basisordner gilt fuer ALLE Fences und kommt nur aus config.json
        // (AP17). Die Kopie in der eigenen <ID>.json ("base-directory") zaehlt
        // beim Start nicht mehr: frueher schrieb jeder Fence sie beim Start
        // zurueck, der zuletzt geladene gewann, und eine Aenderung verpuffte
        // beim naechsten Neustart.
        this.base_directory = getBaseDirectory();
        this._lastBaseDirectory = this._resolveBaseDirectory();
        // P33: Wechselt der Basisordner im Dialog eines anderen Fence, zieht
        // dieser Fence sofort nach (lib/config.js beobachtet config.json).
        watchBaseDirectory(this, () => this._onSharedBaseChanged());
        // V3a (B6): "Schreibtisch frei" ueber eine Markierung statt Eval.
        this._desktopFree = watchDesktopFree(this, free => this._applyDesktopFree(free));
        this._rectSignals = [];
        this._lastThemeState = null;
        this._initializePlacementSettings();

        // N13: fehlenden eigenen Gruppenordner beim Start anlegen (Regel in
        // lib/config.js). Nur hier und im Menue - nicht beim Aendern im
        // Dialog, sonst entstuende beim Tippen jeder Zwischenstand als Ordner.
        // V4d: auf einem Netzlaufwerk erst, wenn das Auflisten geantwortet hat
        // (_onLinkScanResult) - hier koennte eine haengende Freigabe den
        // Schreibtisch anhalten.
        if (!this._isPortal() && !isNetworkPath(getResolvedPath(this.subdirectory))) {
            this._ensureOwnFolder("Start");
        }
        this._applyStoragePath(false);
        this._setupPlacement();
        this.setHeader("aVinceLaunch");
        this._onSettingsChanged();
        // B12: Einstellungen bei jedem Start sichern (nur bei Aenderung) -
        // auch fuer den Dialog-Weg ueber die Systemeinstellungen.
        this._backupSettingsFile();
    },

    // Pruefung Phase 2, B12 (P74): siehe lib/settingsBackup.js.
    _backupSettingsFile: function() {
        const id = this._getInstanceId();
        const configDir = GLib.get_user_config_dir();
        MeLib.settingsBackup.backupSettingsFile(
            GLib.build_filenamev([configDir, "cinnamon", "spices", UUID, id + ".json"]),
            MeLib.settingsBackup.backupDirFor(configDir, id));
    },

    on_desklet_added_to_desktop: function(userEnabled) {
        if (!this._focusWindowId) {
            this._focusWindowId = global.display.connect("notify::focus-window",
                () => this._hideItemTooltips(false));
        }
        this._setupPlacement();
        this._updateDragLock();
        this._syncPositionFromActor();
        this._refresh();
        this._watchFenceRect();
        this._applyDesktopFree(this._desktopFree);
    },

    // --- V3a: Schreibtisch frei, Flaechen fuer den Doppelklick ---------------
    // lib/desktopState.js. Ausgeblendet wird nur der Akteur - Einstellungen,
    // Lage und Inhalt bleiben. Die Abfrage des Portals ruht dann von selbst
    // (_isFenceVisible).
    _applyDesktopFree: function(free) {
        this._desktopFree = !!free;
        if (!this.actor || this.actor.is_finalized() || this._rectsStopped) {
            return;
        }
        if (this._desktopFree) {
            this.actor.hide();
        } else {
            this.actor.show();
        }
        this._publishFenceRect();
    },

    _watchFenceRect: function() {
        if (!this.actor || this._rectSignals.length > 0) {
            return;
        }
        ["notify::allocation", "notify::visible"].forEach(signal => {
            this._rectSignals.push(this.actor.connect(signal, () => this._publishFenceRect()));
        });
        this._publishFenceRect();
    },

    // Die Flaeche, die Klicks annimmt (Akteur), in Bildschirmpixeln.
    _publishFenceRect: function() {
        if (this._rectsStopped || !this.actor || this.actor.is_finalized()) {
            return;
        }
        const [x, y] = this.actor.get_transformed_position();
        const [w, h] = this.actor.get_transformed_size();
        publishFenceRect(this._getInstanceId(), {
            x: x, y: y, w: w, h: h,
            visible: this.actor.visible && !!this.actor.get_stage()
        });
    },

    _stopFenceRect: function() {
        this._rectsStopped = true;
        unwatchDesktopFree(this);
        if (this.actor && !this.actor.is_finalized()) {
            (this._rectSignals || []).forEach(id => this.actor.disconnect(id));
        }
        this._rectSignals = [];
        publishFenceRect(this._getInstanceId(), null);
    },

    finalizeContextMenu: function() {
        this._buildItemSection();
        // Umbenennen oeffnet die Einstellungen auf der Seite "General";
        // dort steht das Feld fuer den Namen ganz oben.
        // AP12-2: Einklappen auch im Menue - ohne Titelzeile gibt es keinen
        // Pfeil im Fence (Titel sind standardmaessig aus).
        const collapseItem = new PopupMenu.PopupMenuItem(_("Collapse fence"));
        collapseItem.connect("activate", (function() {
            this._setCollapsed(!this._isCollapsed());
        }).bind(this));
        this._menu.addMenuItem(collapseItem);
        this._collapseItem = collapseItem;

        const hoverItem = new PopupMenu.PopupSwitchMenuItem(
            _("Expand on hover when collapsed"), !!this.expand_on_hover);
        hoverItem.connect("toggled", (function(item, state) {
            this.settings.setValue("expand-on-hover", state);
            this.expand_on_hover = state;
            if (!state) {
                this._updateCollapsedPeek(false);
            }
        }).bind(this));
        this._menu.addMenuItem(hoverItem);
        this._hoverExpandItem = hoverItem;

        // AP12-3: Suche auch ohne Titelzeile erreichbar.
        const searchItem = new PopupMenu.PopupMenuItem(_("Search all fences…"));
        searchItem.connect("activate", this._openSearch.bind(this));
        this._menu.addMenuItem(searchItem);
        this._searchMenuItem = searchItem;

        const renameItem = new PopupMenu.PopupMenuItem(_("Rename fence…"));
        renameItem.connect("activate", (function() {
            this.configureDesklet(0);
        }).bind(this));
        this._menu.addMenuItem(renameItem);

        // AP18-5: Fence duplizieren - gleiches Aussehen, eigener leerer
        // Gruppenordner (Entscheidung 7), Portal: gleicher Ordner.
        const duplicateItem = new PopupMenu.PopupMenuItem(_("Duplicate fence"));
        duplicateItem.connect("activate", (function() {
            // Erst wenn das Menue zu ist - Cinnamon baut beim Anlegen den
            // neuen Fence noch im selben Aufruf auf.
            Mainloop.idle_add((function() {
                this._duplicateFence();
                return GLib.SOURCE_REMOVE;
            }).bind(this));
        }).bind(this));
        this._menu.addMenuItem(duplicateItem);

        // AP18-4: Untermenue "Sperren" - Position, Groesse, Inhalt
        // (Entscheidung 6, Angelo 06.10.).
        const lockMenu = new PopupMenu.PopupSubMenuMenuItem(_("Lock"));
        this._menu.addMenuItem(lockMenu);
        this._lockSubMenu = lockMenu;

        const lockItem = new PopupMenu.PopupSwitchMenuItem(
            _("Position"), !!this.lock_position);
        lockItem.connect("toggled", (function(item, state) {
            this.settings.setValue("lock-position", state);
            // setValue() ruft die eigenen Rueckrufe nicht auf.
            this._lastLockPosition = this.lock_position;
            this._updateDragLock();
            this._rebuildSurfaceSoon();
        }).bind(this));
        lockMenu.menu.addMenuItem(lockItem);
        this._lockMenuItem = lockItem;

        // Im Menue nur an/aus; "wie die Position" (Standard) gibt es im
        // Dialog. Ein Klick hier legt die Groesse ausdruecklich fest.
        const lockSizeItem = new PopupMenu.PopupSwitchMenuItem(
            _("Size"), this._isSizeLocked());
        lockSizeItem.connect("toggled", (function(item, state) {
            this.settings.setValue("lock-size", state ? "locked" : "free");
            this._lastLockSize = this.lock_size;
            this._updateDragLock();
            this._rebuildSurfaceSoon();
        }).bind(this));
        lockMenu.menu.addMenuItem(lockSizeItem);
        this._lockSizeItem = lockSizeItem;

        const lockContentItem = new PopupMenu.PopupSwitchMenuItem(
            _("Content"), this._isContentLocked());
        lockContentItem.connect("toggled", (function(item, state) {
            this.settings.setValue("lock-content", state);
        }).bind(this));
        lockMenu.menu.addMenuItem(lockContentItem);
        this._lockContentItem = lockContentItem;

        // Nur ein Hinweis, kein Befehl. Sichtbar, solange nicht gesperrt.
        const resizeHint = new PopupMenu.PopupMenuItem(
            _("Resize: drag an edge or the corner"), { reactive: false });
        // Rot mit hellem Schein statt ausgegraut: deutlicher Hinweis, dass
        // der Fence gerade entsperrt ist.
        resizeHint.label.add_style_class_name("avincelaunch-unlocked-hint");
        this._menu.addMenuItem(resizeHint);
        this._resizeHintItem = resizeHint;

        // Vorherige Groesse zurueckholen - auch bei gesperrtem Fence, damit
        // ein verunglueckter Zug immer rueckgaengig zu machen ist.
        const restoreItem = new PopupMenu.PopupMenuItem(_("Restore previous size"));
        restoreItem.connect("activate", this._restorePreviousSize.bind(this));
        this._menu.addMenuItem(restoreItem);
        this._restoreSizeItem = restoreItem;

        const originalItem = new PopupMenu.PopupMenuItem(_("Restore original size"));
        originalItem.connect("activate", this._restoreOriginalSize.bind(this));
        this._menu.addMenuItem(originalItem);
        this._originalSizeItem = originalItem;

        // AP13c: Verlauf und Ausrichten. Beide wirken auch auf gesperrte
        // Fences - es sind ausdrueckliche Befehle mit Rueckweg ueber den
        // Verlauf.
        const arrangementMenu = new PopupMenu.PopupSubMenuMenuItem(_("Restore arrangement"));
        this._menu.addMenuItem(arrangementMenu);
        this._arrangementMenu = arrangementMenu;

        const alignItem = new PopupMenu.PopupMenuItem(_("Align all fences"));
        alignItem.connect("activate", this._alignAllFences.bind(this));
        this._menu.addMenuItem(alignItem);

        // AP09e: nur das Aussehen dieses Fence - anders als Cinnamons
        // "Vorgabe wiederherstellen", das auch Ordner, Name, Groesse und
        // Position zuruecksetzt.
        // AP12-1: Titel aller Fences auf einmal (Wunsch 01.10.). Die
        // Beschriftung richtet sich nach diesem Fence.
        const allTitlesItem = new PopupMenu.PopupMenuItem(_("Hide titles of all fences"));
        allTitlesItem.connect("activate", (function() {
            setShowTitleForAllFences(!this.show_title);
        }).bind(this));
        this._menu.addMenuItem(allTitlesItem);
        this._allTitlesItem = allTitlesItem;

        const resetLookItem = new PopupMenu.PopupMenuItem(_("Reset appearance…"));
        resetLookItem.connect("activate", this._confirmResetAppearance.bind(this));
        this._menu.addMenuItem(resetLookItem);

        this._menu.connect("open-state-changed", (function(menu, open) {
            if (open) {
                // Normalerweise schon vor dem Oeffnen erledigt (siehe
                // _prepareContextMenu); hier nur fuer andere Wege, die
                // Cinnamon selbst oeffnet.
                this._prepareContextMenu();
            }
            // Beim Oeffnen und Schliessen den normalen Zeiger - das Kreuz der
            // Titelzeile blieb sonst ueber dem Menue stehen.
            applyCursor(null);
            // AP12-1-Befund (Angelo 05.10.): Das offene Menue haelt die Maus
            // fest, der Fence sieht das Verlassen nicht - die Titelzeile
            // blieb nach dem Schliessen stehen. Darum selbst nachsehen.
            if (!open) {
                this._itemMenuTarget = null;
                Mainloop.idle_add((function() {
                    this._syncHoverAfterMenu();
                    return GLib.SOURCE_REMOVE;
                }).bind(this));
            }
        }).bind(this));
        this._updateDragLock();

        const openDirItem = new PopupMenu.PopupMenuItem(_("Open link folder"));
        this._openDirItem = openDirItem;
        openDirItem.connect("activate", (function() {
            let path = this._rootPath || this._getCurrentPath();
            const isDir = p => !!p && GLib.file_test(p, GLib.FileTest.IS_DIR);
            // N13: Fehlt der Ordner (nie angelegt oder inzwischen geloescht),
            // ihn nach derselben Regel anlegen und den Fence neu aufbauen;
            // geht das nicht, sagen warum (statt still nichts zu tun).
            if (!isDir(path) && !this._isPortal()) {
                const result = this._ensureOwnFolder("Menue");
                if (result && result.path) {
                    this._applyStoragePath(false);
                    path = this._rootPath;
                }
            }
            if (isDir(path)) {
                openFolder(path);
                return;
            }
            Main.notify(_("Link folder not available"),
                _("The folder %s could not be opened or created. Is the base folder (e.g. on a NAS) mounted?")
                    .format(this._isPortal() ? this._getPortalPath() : getResolvedPath(this.subdirectory)));
        }).bind(this));
        this._menu.addMenuItem(openDirItem);

        const quickstartItem = new PopupMenu.PopupMenuItem(_("Quick start…"));
        quickstartItem.connect("activate", this.openQuickstart.bind(this));
        this._menu.addMenuItem(quickstartItem);

        // N17: Startaufstellung (9 Fences, Programme einsortieren) und ihr
        // Rueckweg; Letzterer nur, solange es eine gibt.
        const startLayoutItem = new PopupMenu.PopupMenuItem(_("Starter layout…"));
        startLayoutItem.connect("activate", this.openStartLayout.bind(this));
        this._menu.addMenuItem(startLayoutItem);
        const removeStartLayoutItem = new PopupMenu.PopupMenuItem(_("Remove starter layout…"));
        removeStartLayoutItem.connect("activate", this._confirmRemoveStartLayout.bind(this));
        this._menu.addMenuItem(removeStartLayoutItem);
        this._removeStartLayoutItem = removeStartLayoutItem;
        Desklet.Desklet.prototype.finalizeContextMenu.call(this);
        this._replaceRemoveDeskletItem();
    },

    // --- Pruefung Phase 3 Teil 2, N10 (T-A3b): Fence entfernen ----------------
    // Cinnamon haengt an jedes Desklet-Menue "Dieses Desklet entfernen" an -
    // auch beim Rechtsklick auf ein Symbol, direkt unter dessen eigenem
    // "Aus dem Fence entfernen ...". Am 10.10. wurde so statt eines Symbols ein
    // ganzer Fence entfernt (Cinnamon loescht dabei die <ID>.json; seine
    // Rueckfrage nennt nur "aVinceLaunch"). Darum ein eigener Eintrag:
    //   - heisst "Diesen Fence entfernen ...", fehlt beim Rechtsklick auf ein
    //     Symbol (_prepareItemSection);
    //   - fragt mit dem Namen des Fence nach und sagt, was bleibt; vorher eine
    //     frische Einstellungssicherung (lib/settingsBackup.js);
    //   - Strg-Klick entfernt wie bei Cinnamon ohne Rueckfrage.
    _replaceRemoveDeskletItem: function() {
        if (this.context_menu_item_remove) {
            this.context_menu_item_remove.destroy();
        }
        const item = new PopupMenu.PopupMenuItem(_("Remove this fence…"));
        item.connect("activate", (function(actor, event) {
            if (event && (Clutter.ModifierType.CONTROL_MASK & Cinnamon.get_event_state(event))) {
                this._removeFenceNow();
                return;
            }
            this._confirmRemoveFence();
        }).bind(this));
        this._menu.addMenuItem(item);
        this.context_menu_item_remove = item;
    },

    _confirmRemoveFence: function() {
        const backupDir = MeLib.settingsBackup.backupDirFor(GLib.get_user_config_dir(), this._getInstanceId());
        let text = _("Remove the fence “%s” from the desktop?").format(this._getFenceTitle()) + "\n\n";
        if (this._isPortal()) {
            const portal = this._getPortalPath();
            if (portal) {
                text += _("The folder %s is not touched.").format(portal) + " ";
            }
        } else {
            const folder = this._rootPath || this._getCurrentPath();
            if (folder) {
                text += _("The icons stay in the folder %s.").format(folder) + " ";
            }
        }
        text += _("Cinnamon deletes the settings of this fence; a copy stays in %s for at least 30 days.")
            .format(backupDir);
        const dialog = new ModalDialog.ConfirmDialog(text, this._removeFenceNow.bind(this));
        dialog.open();
    },

    _removeFenceNow: function() {
        // Letzter Stand in die Sicherung (nur bei Aenderung), dann wie Cinnamon.
        this._backupSettingsFile();
        this._onRemoveDesklet();
    },

    // Cinnamon setzt das Menue neben den ganzen Fence und klappt es bei
    // fehlendem Platz nach links, ohne den Bildschirmrand zu beachten
    // (popupMenu.js:2616) - bei breiten Fences landete es ausserhalb.
    // Bezugspunkt ist deshalb ein unsichtbarer Streifen um den Mausklick;
    // Cinnamons eigene Rechnung legt das Menue rechts oder links daneben.
    // Wird von Cinnamons Menue-Verwaltung bei jedem Ereignis gefragt, solange
    // das Menue dieses Fence offen ist (popupMenu.js:3674). Ein Linksklick
    // ausserhalb des Menues schliesst es sonst nur und wird verschluckt -
    // man musste ein zweites Mal klicken. Trifft er Titelzeile oder Rand
    // irgendeines Fence, beginnt dort gleich das Verschieben oder
    // Groesseaendern.
    menuEventFilter: function(event) {
        // AP12-3: Bei offenem Suchfeld kommen Klicks auf Fences durch
        // (Treffer anklicken), ein Klick anderswo schliesst die Suche.
        if (this._searchMenu && this._searchMenu.isOpen) {
            const type = event.type();
            if (type !== Clutter.EventType.BUTTON_PRESS) {
                return false;
            }
            const source = event.get_source();
            if (this._searchMenu.actor.contains(source)) {
                return false;
            }
            if (event.get_button() === 1 && isInsideAnyFence(source)) {
                return false;
            }
            this._searchMenu.close();
            return true;
        }
        // Bewegungen bei offenem Menue: Zeiger fuer Raender und Titelzeile
        // trotzdem zeigen, ueber dem Menue den normalen.
        if (event.type() === Clutter.EventType.MOTION) {
            if (this._menu && this._menu.actor.contains(event.get_source())) {
                applyCursor(null);
            } else {
                updateCursorFromEvent(event);
            }
            return false;
        }
        // AP18-1-Befund (Angelo 06.10.): Rechtsklick ausserhalb bei offenem
        // Menue - Cinnamon schliesst es mit Ausblenden und haelt dabei die
        // alte Groesse fest. Das neue Menue (gleicher oder Nachbar-Fence)
        // erschien dann mit falscher Groesse bzw. ueber dem verblassenden
        // alten. Darum sofort schliessen; der Druck wird wie bei Cinnamon
        // verschluckt, das Loslassen oeffnet das passende Menue.
        if (event.type() === Clutter.EventType.BUTTON_PRESS && event.get_button() === 3
            && this._menu && this._menu.isOpen
            && !this._menu.actor.contains(event.get_source())) {
            this._menu.close(false);
            return true;
        }
        if (event.type() !== Clutter.EventType.BUTTON_PRESS || event.get_button() !== 1) {
            return false;
        }
        if (!this._menu || !this._menu.isOpen || this._menu.actor.contains(event.get_source())) {
            return false;
        }
        this._menu.close(true);
        startDragFromPress(event);
        return true;
    },

    // --- AP18-4: Position, Groesse und Inhalt getrennt sperren ---------------
    // lock-size "with-position" (Standard) = wie bisher: gesperrte Position
    // sperrt auch die Groesse. Cinnamons globale Sperre gilt immer.
    _isSizeLocked: function() {
        switch (this.lock_size) {
        case "locked":
            return true;
        case "free":
            return isDragLocked(false);
        default:
            return isDragLocked(this.lock_position);
        }
    },

    _isContentLocked: function() {
        return !!this.lock_content;
    },

    _handleForeignPress: function(event) {
        if (!this._isSizeLocked() && this._resizer && this._resizer.tryBeginFromEvent(event)) {
            return true;
        }
        if (isDragLocked(this.lock_position)) {
            return false;
        }
        if (this._isTitleRowActor(event.get_source())) {
            this._beginDeskletDrag(event);
            return true;
        }
        return false;
    },

    _onButtonReleaseEvent: function(actor, event) {
        if (event.get_button() === 3 && this._menu) {
            this._anchorMenuAtPointer(event);
            if (!this._menu.isOpen) {
                this._prepareItemSection(this._itemFromActor(event.get_source()));
                this._prepareContextMenu();
            }
        }
        return Desklet.Desklet.prototype._onButtonReleaseEvent.call(this, actor, event);
    },

    // Eintraege VOR dem Oeffnen anpassen: Cinnamon berechnet die Lage des
    // Menues aus seiner Hoehe vor dem Oeffnen. Aenderten sich Eintraege
    // erst danach, sprang das Menue ein Stueck (Angelo 05.10.).
    _prepareContextMenu: function() {
        if (this._lockSubMenu) {
            this._lockSubMenu.menu.close(false);
        }
        this._updateDragLock();
        if (this._openDirItem) {
            this._openDirItem.label.set_text(this._isPortal()
                ? _("Open folder") : _("Open link folder"));
        }
        if (this._collapseItem) {
            this._collapseItem.label.set_text(this._isCollapsed()
                ? _("Expand fence") : _("Collapse fence"));
        }
        if (this._hoverExpandItem) {
            this._hoverExpandItem.setToggleState(!!this.expand_on_hover);
            // Nur bei eingeklapptem Fence sinnvoll (Angelo 05.10.).
            this._hoverExpandItem.actor.visible = this._isCollapsed();
        }
        if (this._searchMenuItem) {
            this._searchMenuItem.actor.visible = !this._isCollapsed();
        }
        if (this._allTitlesItem) {
            this._allTitlesItem.label.set_text(this.show_title
                ? _("Hide titles of all fences")
                : _("Show titles of all fences"));
        }
        if (this._removeStartLayoutItem) {
            this._removeStartLayoutItem.actor.visible = !!this._startLayoutRecord();
        }
    },

    // --- AP18-1: Symbol-Abschnitt oben im Kontextmenue -----------------------
    // Rechtsklick auf eine Kachel zeigt oben Name, "Verschieben nach" und
    // "Aus dem Fence entfernen"; auf freier Flaeche und in Portalen bleibt
    // das Menue wie bisher (Angelo 06.10., Entscheidung 2).

    _itemFromActor: function(actor) {
        while (actor && actor !== this.actor) {
            if (actor._avincelaunchItem) {
                return actor._avincelaunchItem;
            }
            actor = actor.get_parent();
        }
        return null;
    },

    _buildItemSection: function() {
        // Rueckgaengig auch im Menue: die Meldung verschwindet nach Cinnamons
        // Anzeigedauer (Befund Angelo 06.10.).
        const undoItem = new PopupMenu.PopupMenuItem("");
        undoItem.connect("activate", (function() {
            this._undoLastMove(_lastMoveRecord);
        }).bind(this));
        // Name im Markengruen, nicht ausgegraut (Wunsch Angelo 06.10.).
        const header = new PopupMenu.PopupMenuItem("", { reactive: false });
        header.label.add_style_class_name("avincelaunch-item-header");
        const moveMenu = new PopupMenu.PopupSubMenuMenuItem(_("Move to"));
        // AP18-3: Anpinnen - nur in Gruppen (Portale schreiben nie).
        const pinItem = new PopupMenu.PopupMenuItem(_("Pin to the front"));
        pinItem.connect("activate", (function() {
            const target = this._itemMenuTarget;
            if (target) {
                this._togglePinned(target.item, target.directory);
            }
        }).bind(this));
        const removeItem = new PopupMenu.PopupMenuItem(_("Remove from fence…"));
        removeItem.connect("activate", (function() {
            const target = this._itemMenuTarget;
            if (target) {
                this._confirmRemoveItem(target.item, target.directory);
            }
        }).bind(this));
        const separator = new PopupMenu.PopupSeparatorMenuItem();
        const lockedHint = new PopupMenu.PopupMenuItem(
            _("Content locked (Lock ▸ Content)"), { reactive: false });
        lockedHint.label.add_style_class_name("avincelaunch-unlocked-hint");
        this._menu.addMenuItem(undoItem, 0);
        this._menu.addMenuItem(header, 1);
        this._menu.addMenuItem(moveMenu, 2);
        this._menu.addMenuItem(pinItem, 3);
        this._menu.addMenuItem(removeItem, 4);
        this._menu.addMenuItem(lockedHint, 5);
        this._menu.addMenuItem(separator, 6);
        this._itemSection = [header, moveMenu, pinItem, removeItem];
        this._itemPinItem = pinItem;
        this._itemRemoveItem = removeItem;
        this._itemLockedHint = lockedHint;
        this._itemSeparator = separator;
        this._undoMoveItem = undoItem;
        this._itemHeader = header;
        this._itemMoveMenu = moveMenu;
        this._prepareItemSection(null);
    },

    // Vor dem Oeffnen (wie _prepareContextMenu), damit nichts springt.
    _prepareItemSection: function(item) {
        if (!this._itemSection) {
            return;
        }
        const directory = item ? this._getCurrentPath() : null;
        const show = !!(item && directory && !this._isPortal());
        const undo = !!_lastMoveRecord && !this._isPortal();
        this._itemMenuTarget = show ? { item: item, directory: directory } : null;
        // Teil 2, N10: beim Rechtsklick auf ein Symbol kein "Fence entfernen".
        if (this.context_menu_item_remove) {
            this.context_menu_item_remove.actor.visible = !item;
        }

        // Das aufgeklappte Untermenue ist ein eigener Baustein neben der
        // Zeile - offen gelassen hielt es das Menue gross (Befund 06.10.).
        const menu = this._itemMoveMenu;
        menu.menu.close(false);
        menu.menu.removeAll();

        this._itemSection.forEach(entry => {
            entry.actor.visible = show;
        });
        this._undoMoveItem.actor.visible = undo;
        this._itemLockedHint.actor.visible = false;
        if (undo) {
            this._undoMoveItem.label.set_text(_("Undo: “%s” to %s").format(
                _lastMoveRecord.name, _lastMoveRecord.targetTitle));
        }
        this._itemSeparator.actor.visible = show || undo;
        this._resetMenuSize();
        if (!show) {
            return;
        }
        this._itemHeader.label.set_text(item.name || item.fileName);
        this._itemPinItem.label.set_text(item.pinned ? _("Unpin") : _("Pin to the front"));
        // AP18-4: Inhalt gesperrt - Eintraege sichtbar, aber ausgegraut.
        const contentLocked = this._isContentLocked();
        [this._itemMoveMenu, this._itemPinItem, this._itemRemoveItem].forEach(entry => {
            entry.setSensitive(!contentLocked);
        });
        this._itemLockedHint.actor.visible = contentLocked;
        if (contentLocked) {
            return;
        }
        const targets = getMoveTargets(this._getInstanceId());
        if (targets.length === 0) {
            menu.menu.addMenuItem(new PopupMenu.PopupMenuItem(
                _("No other group fence"), { reactive: false }));
            return;
        }
        targets.forEach(target => {
            const entry = new PopupMenu.PopupMenuItem(target.title);
            entry.connect("activate", (function() {
                this._moveItemTo(item, directory, target);
            }).bind(this));
            menu.menu.addMenuItem(entry);
        });
    },

    // Laeuft noch das Ausblenden vom letzten Schliessen, steht das Menue auf
    // fester Groesse (popupMenu.js close: set_size(get_size())); das
    // Zuruecksetzen kaeme erst am Ende der Animation. Vor dem Oeffnen darum
    // Animation verwerfen und Groesse freigeben.
    _resetMenuSize: function() {
        const actor = this._menu.actor;
        if (this._menu.isOpen || actor.is_finalized()) {
            return;
        }
        actor.remove_all_transitions();
        this._menu.animating = false;
        actor.hide();
        actor.opacity = 255;
        actor.set_size(-1, -1);
        actor.queue_relayout();
    },

    // Ziel fuer andere Fences: nur Gruppen, nie Portale (echte Dateien).
    _getMoveTarget: function() {
        // AP18-4: Inhalt gesperrt = nimmt nichts an.
        if (this._isPortal() || !this._rootPath || this._isContentLocked()) {
            return null;
        }
        return {
            title: this._getFenceTitle(),
            path: this._rootPath,
            rect: this._getFrameRect()
        };
    },

    _showsAnyPath: function(paths) {
        if (this._isPortal()) {
            return false;
        }
        const own = [this._rootPath, this._getCurrentPath()].filter(p => !!p);
        return paths.some(p => own.indexOf(p) !== -1);
    },

    _onItemsMovedHere: function() {
        this._syncOrderListFromDirectory();
        this._refresh();
    },

    _itemsChanged: function(paths) {
        notifyItemsChangedIn(paths);
        // Der eigene Fence auch dann, wenn er in einem Unterordner steht -
        // ausser er ist inzwischen entfernt (Ergebnis kam spaeter an).
        if (!this._isGone() && !this._showsAnyPath(paths)) {
            this._onItemsMovedHere();
        }
    },

    // Fence entfernt (on_desklet_removed / destroy): spaete Rueckrufe aus
    // dem Fence-Menue aendern dann nichts mehr an ihm.
    _isGone: function() {
        return !this.actor || this.actor.is_finalized() || this._ioCancellable.is_cancelled();
    },

    // Waehrend eine Aktion fuer einen Eintrag laeuft, keine zweite fuer ihn
    // (Doppelklick im Menue). Liefert false, wenn er schon belegt ist.
    _lockItem: function(directory, fileName) {
        const key = directory + "/" + fileName;
        if (this._busyItems[key]) {
            return false;
        }
        this._busyItems[key] = true;
        return true;
    },

    _unlockItem: function(directory, fileName) {
        delete this._busyItems[directory + "/" + fileName];
    },

    _moveItemTo: function(item, sourceDir, target) {
        const name = item.name || item.fileName;
        if (!this._lockItem(sourceDir, item.fileName)) {
            return;
        }
        const sourceTitle = this._getFenceTitle();
        moveEntry(sourceDir, target.path, item.fileName, item.id, result => {
            this._unlockItem(sourceDir, item.fileName);
            if (result.ok) {
                this._itemsChanged([sourceDir, target.path]);
                this._notifyMoved(result.record, name, target.title, sourceTitle);
                return;
            }
            if (result.reason === "exists") {
                if (this._isGone()) {
                    return;
                }
                // Nichts ueberschreiben (Auftrag AP18-1). Angebot: nur hier weg.
                const dialog = new ModalDialog.ConfirmDialog(
                    _("“%s” is already in %s.").format(name, target.title) + "\n\n"
                    + _("Remove it only from this fence? It goes to the trash."),
                    (function() {
                        this._removeItem(item, sourceDir);
                    }).bind(this));
                dialog.open();
                return;
            }
            if (result.error) {
                global.logError(result.error, "aVinceLaunch: move failed");
            }
            Main.notify(_("Could not move “%s”.").format(name));
            this._itemsChanged([sourceDir, target.path]);
        });
    },

    // Meldung mit "Rueckgaengig" - gilt nur fuer genau die letzte
    // Verschiebung (Architektur O.1, Angelo 06.10., Entscheidung 3).
    _notifyMoved: function(record, name, targetTitle, sourceTitle) {
        record.name = name;
        record.targetTitle = targetTitle;
        _lastMoveRecord = record;
        try {
            const source = new MessageTray.SystemNotificationSource();
            Main.messageTray.add(source);
            const notification = new MessageTray.Notification(source,
                _("“%s” moved to %s").format(name, targetTitle),
                _("From %s. Undo is also in the context menu of any fence.").format(sourceTitle));
            notification.setTransient(true);
            notification.addButton("undo", _("Undo"));
            notification.connect("action-invoked", (function(n, id) {
                if (id === "undo") {
                    this._undoLastMove(record);
                }
            }).bind(this));
            source.notify(notification);
        } catch (e) {
            global.logError(e, "aVinceLaunch: move notification failed");
        }
    },

    _togglePinned: function(item, directory) {
        const result = setPinned(directory, item.id, !item.pinned);
        if (result === null) {
            Main.notify(_("Could not change “%s”.").format(item.name || item.fileName));
            return;
        }
        this._refresh();
    },

    _undoLastMove: function(record) {
        if (!record || _lastMoveRecord !== record) {
            Main.notify(_("Only the last move can be undone."));
            return;
        }
        _lastMoveRecord = null;
        undoMove(record, result => {
            notifyItemsChangedIn([record.sourceDir, record.targetDir]);
            if (!result.ok) {
                Main.notify(_("Could not move “%s” back.").format(record.name));
            }
        });
    },

    _confirmRemoveItem: function(item, directory) {
        const name = item.name || item.fileName;
        const ask = text => {
            text += "\n\n" + _("Only the link is removed – installed programs stay installed.");
            const dialog = new ModalDialog.ConfirmDialog(text, (function() {
                this._removeItem(item, directory);
            }).bind(this));
            dialog.open();
        };
        if (item.type !== "folder") {
            ask(_("Move “%s” to the trash and remove it from this fence?").format(name));
            return;
        }
        // Erst zaehlen (asynchron), dann fragen. Antwortet der Ordner nicht
        // binnen IO_WAIT_MS, wie bei einem Lesefehler: 0 Eintraege.
        if (!this._lockItem(directory, item.fileName)) {
            return;
        }
        // Wechselt der Ordner des Fence in der Wartezeit, wird dieses
        // Cancellable abgebrochen - dann keine Rueckfrage mehr.
        const cancellable = this._ioCancellable;
        let waitId = 0;
        let answered = false;
        const withCount = count => {
            if (answered) {
                return;
            }
            answered = true;
            if (waitId) {
                Mainloop.source_remove(waitId);
                waitId = 0;
            }
            this._unlockItem(directory, item.fileName);
            if (this._isGone() || cancellable.is_cancelled()) {
                return;
            }
            ask(_("Move the folder “%s” with %d entries to the trash and remove it from this fence?")
                .format(name, Math.max(count, 0)));
        };
        waitId = Mainloop.timeout_add(IO_WAIT_MS, () => {
            waitId = 0;
            withCount(-1);
            return GLib.SOURCE_REMOVE;
        });
        countEntries(GLib.build_filenamev([directory, item.fileName]), cancellable, withCount);
    },

    _removeItem: function(item, directory) {
        if (!this._lockItem(directory, item.fileName)) {
            return;
        }
        trashEntry(directory, item.fileName, item.id, result => {
            this._unlockItem(directory, item.fileName);
            if (!result.ok) {
                if (result.error) {
                    global.logError(result.error, "aVinceLaunch: remove failed");
                }
                Main.notify(_("Could not remove “%s”.").format(item.name || item.fileName));
            }
            this._itemsChanged([directory]);
        });
    },

    _anchorMenuAtPointer: function(event) {
        if (!this._menuAnchor) {
            this._menuAnchor = new St.Widget({ reactive: false, opacity: 0 });
            Main.uiGroup.add_actor(this._menuAnchor);
        }
        const [x, y] = event.get_coords();
        this._menuAnchor.set_position(Math.round(x) - MENU_POINTER_OFFSET, Math.round(y));
        this._menuAnchor.set_size(2 * MENU_POINTER_OFFSET, 1);
        this._menu.sourceActor = this._menuAnchor;
    },

    // Pruefung Phase 2, P49: Cinnamon loescht <ID>.json beim Entfernen sofort,
    // ruft on_desklet_removed aber erst nach dem Ausblenden (500 ms) auf.
    // Zeitgeber, die in dieser Zeit setValue aufrufen, legten die Datei neu
    // an. Darum Hintergrundarbeit schon hier beenden.
    destroy: function(deleteConfig) {
        this._stopBackgroundWork();
        Desklet.Desklet.prototype.destroy.call(this, deleteConfig);
    },

    // Zeitgeber, Ordnerwaechter, Portal-Einlesen - mehrfach aufrufbar.
    _stopBackgroundWork: function() {
        unwatchBaseDirectory(this);
        this._stopFenceRect();
        this._cancelScrollReset();
        this._cancelPortalScan();
        this._stopPortalPoll();
        this._cancelLinkScan();
        this._stopLinkPoll();
        this._cancelOrderScans();
        this._ioCancellable.cancel();
        this._stopFileMonitor();
        this._cancelScheduledRefresh();
        this._cancelPanelSizeSync();
        ["_dialogListSyncId", "_storageChangeTimeoutId", "_presetSettleId",
         "_applyingPositionId", "_configurePanelTimerId", "_configureWaitId",
         "_surfaceRebuildId", "_titleSyncId"].forEach(key => {
            if (this[key]) {
                Mainloop.source_remove(this[key]);
                this[key] = 0;
            }
        });
    },

    // Pruefung Phase 2, P16: Baut Cinnamon einen Fence neu auf (geaenderte
    // Lage, Neuladen), meldet sich die neue Instanz mit derselben ID an,
    // bevor die alte hier ankommt. Cinnamons unregister(uuid, id) loescht
    // den Eintrag ohne Pruefung - danach wirkte der Einstellungsdialog der
    // neuen Instanz nicht mehr. Abgemeldet wird nur, was noch uns gehoert.
    _releaseSettings: function() {
        if (!this.settings) {
            return;
        }
        let registered;
        try {
            registered = Main.settingsManager.uuids[UUID][this._getInstanceId()];
        } catch (e) {
            registered = undefined;
        }
        if (registered === undefined || registered === null || registered === this.settings) {
            this.settings.finalize();
            return;
        }
        // Eine neue Instanz ist schon angemeldet: nur die eigenen Bindungen loesen.
        try {
            for (let key in this.settings.bindings) {
                this.settings.unbindAll(key);
            }
            this.settings.disconnectAll();
        } catch (e) {
            global.logError(e, "aVinceLaunch: Bindungen nicht geloest");
        }
    },

    on_desklet_removed: function(deleteConfig) {
        // Vom Nutzer entfernt (nicht beim Neustart): Groessen in layout.json
        // gleich mit vergessen (AP18-5).
        if (deleteConfig) {
            forgetFenceLayout(this._getInstanceId());
        }
        this._stopBackgroundWork();
        this._destroySearch();
        this._stopHoverWatch();
        this._destroyTitleTab();
        if (this._menuAnchor) {
            this._menuAnchor.destroy();
            this._menuAnchor = null;
        }
        if (this._freeHint) {
            this._freeHint.destroy();
            this._freeHint = null;
        }
        unregisterReadOnlyRoot(this._getInstanceId(), this);
        if (this._focusWindowId) {
            global.display.disconnect(this._focusWindowId);
            this._focusWindowId = 0;
        }
        this._destroyItemTooltips();
        this._teardownPlacement();
        this._releaseSettings();
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
        // Nur messen, was auf dem Schreibtisch steht: sonst meldet St
        // "st_widget_get_theme_node ... not in the stage" (14x beim Anlegen
        // eines Fence, weitere beim Ziehen und beim Neuaufbau eines Portals,
        // AP17-3). 0 laesst die Aufrufer auf die gemerkte bzw. errechnete
        // Breite ausweichen; _schedulePanelSizeSync misst danach richtig.
        if (!actor.get_stage()) {
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

    // N22 (Tower 14.10., Skalierung 2): Der Rand (.thelauncher-desklet,
    // 8px je Seite) waechst mit der Skalierung; wo in Bildpunkten gerechnet
    // wird (max-width, Breite beim Ziehen), auch hier. Sonst war das Raster
    // 16 px zu breit, die Titelzeile breiter als die eingeklappte Leiste.
    _getDeskletPaddingPx: function() {
        return Math.round(this._getDeskletPadding() * this._uiScale());
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
        // Im festen Modus ist der Akteur so breit wie der sichtbare Fence,
        // nicht nur wie die vorhandenen Kacheln. Sonst nimmt Cinnamon rechts
        // davon keine Maus an: kein Menue, kein Verschieben, kein Rand
        // (SONSTIGES, AP13b-Test 01.10.).
        if (this._isFixedContentFit() && this.max_width > 0) {
            width = this.max_width;
        }

        this._updateTitleContrast();
        this._cachedPanelWidth = width;
        this._applyPanelAllocation(this._panelBox, this._lastUsedColumns, width);
        this._applyContainerStyle(this._panelBox, this._lastUsedColumns, width);
        this.actor.set_width(width);

        // N12 (BT6, 10.10.): Eingeklappt blieb der Akteur so hoch wie der
        // ausgeklappte Fence - eine unsichtbare, reaktive Flaeche unter der
        // Leiste. Ueberfahren klappte dort auf, Klicks auf den Schreibtisch
        // darunter kamen nicht an. Eingeklappt gilt darum die natuerliche
        // Hoehe: die Leiste, beim Aufklappen Leiste bzw. Inhalt. Den Platz
        // fuer Nachbarn haelt weiter _getFrameRect frei.
        if (this._isFixedContentFit() && this.max_height > 0 && !this._isCollapsed()) {
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

            // Der Inhalt selbst muss seine natürliche Höhe behalten.
            // Nur die ScrollView begrenzt die sichtbare Höhe.
            panelBox.set_height(-1);

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

    // Ordner asynchron einlesen (lib/linkScanner.js). Liefert ein
    // Gio.Cancellable; nach cancel() kein Rueckruf.
    _scanDirectoryAsync: function(path, options, callback) {
        const scanOptions = Object.assign({}, options || {});
        scanOptions.folderSort = this.folder_sort || "mixed";
        scanOptions.sortMode = this.sort_mode || "manual";
        return scanDirectoryAsync(path, scanOptions, callback);
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
        if (!this._resizer && this.actor) {
            this._resizer = new FenceResizer({
                actor: this.actor,
                isLocked: this._isSizeLocked.bind(this),
                isMoveLocked: (function() {
                    return isDragLocked(this.lock_position);
                }).bind(this),
                isMoveSource: this._isTitleRowActor.bind(this),
                getFrameActor: (function() {
                    return this._scrollView || this._panelBox;
                }).bind(this),
                canResize: (function() {
                    return !this._isCollapsed();
                }).bind(this),
                adjustSize: this._adjustFenceSize.bind(this),
                showGuides: this._showGuides.bind(this),
                getSnapInterval: this._getResizeSnapInterval.bind(this),
                onBegin: this._onFenceResizeBegin.bind(this),
                describe: this._describeFenceResize.bind(this),
                onResized: this._onFenceResized.bind(this)
            });
        }

        if (!this._fenceRegistered) {
            registerFence(this._getInstanceId(), this._fenceHandlers = {
                getRect: this._getFrameRect.bind(this),
                closeMenu: (function() {
                    if (this._menu && this._menu.isOpen) {
                        this._menu.close();
                    }
                }).bind(this),
                pressHandler: this._handleForeignPress.bind(this),
                cursorHandler: (function(event) {
                    return this._resizer ? this._resizer.cursorForEvent(event) : undefined;
                }).bind(this),
                getState: this._getArrangementState.bind(this),
                applyState: this._applyArrangementState.bind(this),
                moveFrameTo: this._moveFrameTo.bind(this),
                setShowTitle: this._setShowTitle.bind(this),
                setSearchText: this._setSearchText.bind(this),
                getFirstSearchHit: (function() {
                    if (!this._searchText || this._isCollapsed()) {
                        return null;
                    }
                    const scan = this._lastScanResult || {};
                    return this._filterItems(scan.items || [])[0] || null;
                }).bind(this),
                activateItem: (function(item) {
                    this._onItemActivated(item, 2);
                }).bind(this),
                closeSearch: (function() {
                    if (this._searchMenu && this._searchMenu.isOpen) {
                        this._searchMenu.close();
                    }
                }).bind(this),
                containsActor: (function(actor) {
                    return !!(actor && this.actor && !this.actor.is_finalized()
                        && (actor === this.actor || this.actor.contains(actor)));
                }).bind(this),
                getMoveTarget: this._getMoveTarget.bind(this),
                showsAnyPath: this._showsAnyPath.bind(this),
                itemsChanged: this._onItemsMovedHere.bind(this)
            });
            this._fenceRegistered = true;
            // Ausgangsgroesse einmalig festhalten, damit "Restore original
            // size" fuer jeden Fence verfuegbar ist (schreibt nur, wenn noch
            // nichts abgelegt ist).
            if (this._isFixedContentFit() && this.max_width > 0 && this.max_height > 0) {
                rememberOriginalSize(this._getInstanceId(), this._currentSizeRecord());
            }
            pruneOrphanFenceLayouts(UUID);
            // Pruefung Phase 3 Teil 2, BT1: Sicherungen entfernter Fences nach
            // 30 Tagen aufraeumen (einmal je Start, lib/settingsBackup.js).
            MeLib.settingsBackup.pruneRemovedFenceBackupsOnce(GLib.get_user_config_dir(), UUID);
            scheduleGapLearning(measureGaps);
            scheduleQuickstartOnce(this.openQuickstart.bind(this));
        }

        if (this._draggable && !this._dragEndHandlerId) {
            this._dragEndHandlerId = this._draggable.connect(
                "drag-end",
                this._onDeskletDragEnd.bind(this)
            );
            this._dragBeginHandlerId = this._draggable.connect(
                "drag-begin",
                this._onDeskletDragBegin.bind(this)
            );
            this._dragCancelHandlerId = this._draggable.connect(
                "drag-cancelled",
                this._endDragMonitor.bind(this)
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
            // Titelzeile erscheint/verschwindet mit der Sperre (AP12-2).
            this._scheduleRefresh();
            return false;
        }).bind(this));
    },

    _teardownPlacement: function() {
        if (this._resizer) {
            this._resizer.destroy();
            this._resizer = null;
        }

        if (this._dragEndHandlerId && this._draggable) {
            this._draggable.disconnect(this._dragEndHandlerId);
            this._draggable.disconnect(this._dragBeginHandlerId);
            this._draggable.disconnect(this._dragCancelHandlerId);
            this._dragEndHandlerId = 0;
            this._dragBeginHandlerId = 0;
            this._dragCancelHandlerId = 0;
        }
        this._endDragMonitor();
        if (this._guides) {
            this._guides.destroy();
            this._guides = null;
        }
        if (this._fenceRegistered) {
            unregisterFence(this._getInstanceId(), this._fenceHandlers);
            this._fenceRegistered = false;
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
        this._clampRangedSettings();
        if (this._applyingPosition) {
            return;
        }

        const positionChanged = this._lastPositionX !== this.position_x
            || this._lastPositionY !== this.position_y;
        const layoutChanged = this._lastMaxWidth !== this.max_width
            || this._lastMaxHeight !== this.max_height
            || this._lastContentFit !== this.content_fit;
        const lockChanged = this._lastLockPosition !== this.lock_position
            || this._lastLockSize !== this.lock_size;

        this._updateDragLock();

        if (positionChanged) {
            this._applyPositionFromSettings();
            return;
        }

        this._lastPositionX = this.position_x;
        this._lastPositionY = this.position_y;
        this._lastLockPosition = this.lock_position;
        this._lastLockSize = this.lock_size;

        if (layoutChanged || lockChanged) {
            this._lastMaxWidth = this.max_width;
            this._lastMaxHeight = this.max_height;
            this._lastContentFit = this.content_fit;
            this._scheduleRefresh();
        }
    },

    _applyPositionFromSettings: function() {
        this._applyingPosition = true;
        const x = clampSetting(this.settings.getValue("position-x"), 0, 10000);
        const y = clampSetting(this.settings.getValue("position-y"), 0, 10000);
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

    // Lage so ablegen, wie der Fence steht - beim Start und beim Knopf
    // "Aktuelle Position uebernehmen". Pruefung Phase 2, N1: Hier wurde auf
    // Cinnamons Raster (25 px) gerundet und nur in enabled-desklets
    // geschrieben, der Fence blieb stehen - ein mit Strg frei (oder mit
    // 15 px Abstand an einen Nachbarn) gesetzter Fence rueckte so beim
    // naechsten Start bis 12 px. Das Raster gilt nur beim Eintippen von
    // X/Y (_applyPositionFromSettings).
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
            false
        );
    },

    // --- AP13b: Verschieben mit Einrasten und Hilfslinien -------------------

    // Sichtbare Flaeche in Bildschirmkoordinaten - die Grundlage fuer alle
    // Vergleiche mit den Nachbarn.
    _getFrameRect: function() {
        // AP12-2: Eingeklappt meldet der Fence seine volle Groesse - der
        // Platz bleibt frei (Angelo 05.10.), sonst laege beim Ausklappen
        // ein anderer Fence darunter.
        const bar = this._collapsedBar;
        if (this._isCollapsed() && bar && !bar.is_finalized() && bar.get_stage()) {
            const [bx, by] = bar.get_transformed_position();
            const full = this._expandedFrameSize();
            return {
                x: Math.round(bx),
                y: Math.round(by),
                w: Math.round(full ? full.w : bar.get_width()),
                h: Math.round(full ? full.h : bar.get_height())
            };
        }
        let frame = this._scrollView || this._panelBox;
        if (!frame || frame.is_finalized() || !frame.get_stage()) {
            frame = this.actor;
        }
        if (!frame || !frame.get_stage()) {
            return null;
        }
        const [x, y] = frame.get_transformed_position();
        const rect = {
            x: Math.round(x),
            y: Math.round(y),
            w: Math.round(frame.get_width()),
            h: Math.round(frame.get_height())
        };
        if (!this._isCollapsed() && rect.w > 0 && rect.h > 0) {
            this._lastExpandedSize = { w: rect.w, h: rect.h };
        }
        return rect;
    },

    _showGuides: function(guides) {
        if (!this._guides) {
            if (!guides || guides.length === 0) {
                return;
            }
            this._guides = new GuideOverlay();
        }
        this._guides.show(guides);
    },

    // Mit gedrueckter Strg-Taste: frei ziehen - kein Einrasten, kein
    // Ueberlappungsschutz, kein Raster. Nur die Bildschirmraender bleiben.
    _isFreeDrag: function() {
        const [, , mods] = global.get_pointer();
        return !!(mods & Clutter.ModifierType.CONTROL_MASK);
    },

    _dragSettings: function(free) {
        const settings = getLayoutSettings();
        if (free) {
            settings.snapToFences = false;
            settings.snapDistance = 0;
            settings.preventOverlap = false;
        }
        return settings;
    },

    // Nachbarn fuer Einrasten und Ueberlappungsschutz: die anderen Fences und
    // fremde Desklets wie aVincePulse.
    _neighbourRects: function() {
        return getOtherFenceRects(this._getInstanceId()).concat(getForeignDeskletRects(UUID));
    },

    // Wie beim Groesseziehen (snapResize): Nachbarn, die schon beim Beginn
    // des Ziehens ueberlappen, halten den Fence nicht fest - sonst laesst sich
    // ein Fence, der auf einem anderen liegt (Duplikat ohne freien Platz,
    // AP18-5; Befund 04.10.: teils ueber der Leiste), nie wegziehen.
    _dragObstacles: function() {
        const ignore = this._dragStartOverlaps || [];
        return this._neighbourRects().filter(o => !ignore.some(i =>
            i.x === o.x && i.y === o.y && i.w === o.w && i.h === o.h));
    },

    _adjustFenceSize: function(rect, width, height, zone, freeFromEvent) {
        const free = !!freeFromEvent || this._isFreeDrag();
        this._resizeFree = free;
        const others = this._neighbourRects();
        return snapResize(rect, width, height, zone, others,
            getWorkAreaForRect(rect), this._dragSettings(free),
            free ? 0 : this._getResizeSnapInterval(), 120);
    },

    _planMove: function(raw) {
        const free = this._isFreeDrag();
        const others = this._neighbourRects();
        const plan = snapMove(raw, others, getWorkAreaForRect(raw), this._dragSettings(free),
            free ? 0 : this._getResizeSnapInterval());
        plan.free = free;
        return plan;
    },

    _onDeskletDragBegin: function() {
        this._endDragMonitor();
        closeAllFenceMenus();
        if (this._resizer) {
            this._resizer.resetCursor();
        }
        const frame = this._getFrameRect();
        const [ax, ay] = this.actor.get_transformed_position();
        this._dragStartFrame = frame;
        this._arrangementBefore = captureArrangement();
        this._dragStartActor = { x: Math.round(ax), y: Math.round(ay) };
        // Abstand zwischen Akteur und sichtbarer Flaeche; bleibt beim Ziehen gleich.
        this._dragFrameOffset = frame
            ? { x: frame.x - Math.round(ax), y: frame.y - Math.round(ay) }
            : { x: 0, y: 0 };
        this._dragPlan = null;
        // Letzte Lage ohne Ueberdeckung - dort bleibt der Fence stehen, solange
        // er gegen einen Nachbarn gezogen wird (Wunsch 02.10.).
        this._dragValidPlan = frame ? { rect: frame, guides: [], free: false } : null;
        this._dragStartOverlaps = frame
            ? this._neighbourRects().filter(o => intersects(frame, o))
            : [];
        this._dragMonitor = {
            dragMotion: this._onDeskletDragMotion.bind(this)
        };
        DND.addDragMonitor(this._dragMonitor);
        this._setCinnamonPlaceholderVisible(false);
    },

    // Cinnamons roter Platzhalter springt weiter im 25er-Raster, auch wenn
    // AP13b anders einrastet oder mit Strg frei gezogen wird - das sah aus,
    // als wolle der Fence einrasten. Waehrend unseres Ziehens unsichtbar;
    // seine Lage nutzt Cinnamon beim Ablegen trotzdem, danach setzt AP13b
    // die eigene. Fehlt die Stelle, bleibt er einfach sichtbar.
    _setCinnamonPlaceholderVisible: function(visible) {
        try {
            const placeholder = Main.deskletContainer && Main.deskletContainer._dragPlaceholder;
            if (placeholder) {
                placeholder.opacity = visible ? 255 : 0;
            }
        } catch (e) {
            // Andere Cinnamon-Fassung - nichts zu tun.
        }
    },

    _showFreeHint: function(rect, visible) {
        if (!visible) {
            if (this._freeHint) {
                this._freeHint.hide();
            }
            return;
        }
        if (!this._freeHint) {
            this._freeHint = new St.Label({
                text: _("FREE (Ctrl)"),
                style_class: "avincelaunch-resize-label",
                reactive: false
            });
            Main.uiGroup.add_actor(this._freeHint);
        }
        this._freeHint.set_position(rect.x + 8, rect.y + 8);
        this._freeHint.show();
        Main.uiGroup.set_child_above_sibling(this._freeHint, null);
    },

    _onDeskletDragMotion: function(dragEvent) {
        if (dragEvent.source !== this) {
            return DND.DragMotionResult.CONTINUE;
        }
        const raw = this._rawDragFrame(dragEvent);
        if (raw) {
            let plan = this._planMove(raw);
            // Ohne Strg laesst sich der Fence nicht ueber einen Nachbarn
            // (Fence oder fremdes Desklet) ziehen: er bleibt an der letzten
            // freien Stelle stehen, bis die Maus wieder Platz findet.
            if (!plan.free && this._dragValidPlan && getLayoutSettings().preventOverlap !== false) {
                const blocked = this._dragObstacles().some(o => intersects(plan.rect, o));
                if (blocked) {
                    plan = this._dragValidPlan;
                } else {
                    this._dragValidPlan = plan;
                }
            }
            this._dragPlan = plan;
            this._showGuides(plan.guides);
            this._holdDragActorAt(plan.rect);
            this._showFreeHint(plan.rect, plan.free);
        }
        return DND.DragMotionResult.CONTINUE;
    },

    // Wo der Fence ohne Einrasten unter der Maus stuende. Aus Mausposition
    // und Cinnamons Greifabstand gerechnet - die tatsaechliche Lage ist ja
    // schon die eingerastete (siehe _holdDragActorAt).
    _rawDragFrame: function(dragEvent) {
        const frame = this._getFrameRect();
        const d = this._draggable;
        if (!frame || !d || typeof d._dragOffsetX !== "number" || typeof d._dragOffsetY !== "number") {
            return frame;
        }
        const offset = this._dragFrameOffset || { x: 0, y: 0 };
        return {
            x: Math.round(dragEvent.x + d._dragOffsetX) + offset.x,
            y: Math.round(dragEvent.y + d._dragOffsetY) + offset.y,
            w: frame.w,
            h: frame.h
        };
    },

    // Fence schon waehrend des Ziehens an der eingerasteten Stelle zeigen:
    // nicht ueber den Bildschirmrand hinaus, kein Sprung beim Loslassen.
    // Nutzt Cinnamons Override-Werte des Ziehens (dnd.js:474); fehlen sie,
    // bleibt es beim Einrasten nach dem Loslassen.
    _holdDragActorAt: function(rect) {
        const d = this._draggable;
        if (!d || typeof d._dragOffsetX !== "number" || typeof d._setDragActorPosition !== "function") {
            return;
        }
        const offset = this._dragFrameOffset || { x: 0, y: 0 };
        d._overrideX = rect.x - offset.x;
        d._overrideY = rect.y - offset.y;
        d._setDragActorPosition();
    },

    _releaseDragActor: function() {
        if (this._draggable) {
            this._draggable._overrideX = undefined;
            this._draggable._overrideY = undefined;
        }
    },

    _endDragMonitor: function() {
        this._releaseDragActor();
        this._setCinnamonPlaceholderVisible(true);
        this._showFreeHint(null, false);
        if (this._dragMonitor) {
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }
        this._showGuides([]);
    },

    _onDeskletDragEnd: function(draggable, eventTime, success) {
        if (success) {
            repairPrefixCollisions(UUID, this._getInstanceId());
        }
        const plan = this._dragPlan;
        this._dragPlan = null;
        this._endDragMonitor();
        if (this._resizer) {
            this._resizer.resetCursor();
        }

        if (!success || isDragLocked(this.lock_position)) {
            return;
        }

        // Ziel: die Planung aus der letzten Mausbewegung, dann Ueberlappung.
        // Ohne Planung (sehr kurzer Zug) gilt die Lage, die Cinnamon gesetzt hat.
        if (plan && this._dragStartFrame) {
            const others = this._dragObstacles();
            const result = resolveOverlap(plan.rect, others,
                getWorkAreaForRect(plan.rect), this._dragSettings(plan.free), this._dragStartFrame);
            const offset = this._dragFrameOffset || { x: 0, y: 0 };
            this.actor.set_position(result.rect.x - offset.x, result.rect.y - offset.y);
            this._storeActorPosition(false);
        } else {
            this._storeActorPosition(this.snap_to_grid);
        }
        this._recordMoveInHistory();
    },

    // Nur wenn sich der Fence wirklich bewegt hat, kommt der Stand davor in
    // den Verlauf.
    _recordMoveInHistory: function() {
        const before = this._arrangementBefore;
        const start = this._dragStartActor;
        this._arrangementBefore = null;
        this._dragStartActor = null;
        if (!before || !start) {
            return;
        }
        if (Math.round(this.actor.get_x()) !== start.x || Math.round(this.actor.get_y()) !== start.y) {
            pushHistory(before, false, "move");
        }
    },

    // Position des Akteurs in enabled-desklets und in der Instanz ablegen.
    _storeActorPosition: function(useGrid) {
        const x = Math.round(this.actor.get_x());
        const y = Math.round(this.actor.get_y());
        const snapped = writeGSettingsPosition(
            UUID,
            this._getInstanceId(),
            x,
            y,
            useGrid
        );
        if (snapped.x !== x || snapped.y !== y) {
            this.actor.set_position(snapped.x, snapped.y);
        }

        this._applyingPosition = true;
        this.settings.setValue("position-x", snapped.x);
        this.settings.setValue("position-y", snapped.y);
        this._lastPositionX = snapped.x;
        this._lastPositionY = snapped.y;
        this._clearApplyingPositionLater();
    },

    _updateDragLock: function() {
        if (this._lockMenuItem && this._lockMenuItem.setToggleState) {
            this._lockMenuItem.setToggleState(!!this.lock_position);
        }
        if (this._lockSizeItem) {
            this._lockSizeItem.setToggleState(this._isSizeLocked());
        }
        if (this._lockContentItem) {
            this._lockContentItem.setToggleState(this._isContentLocked());
        }
        const locked = isDragLocked(this.lock_position);
        const sizeLocked = this._isSizeLocked();
        if (this._draggable) {
            this._draggable.inhibit = locked;
        }
        if (this._resizeHintItem) {
            this._resizeHintItem.actor.visible = !sizeLocked;
        }
        if (this._restoreSizeItem) {
            this._restoreSizeItem.setSensitive(!!getPreviousSize(this._getInstanceId()));
        }
        if (this._originalSizeItem) {
            this._originalSizeItem.setSensitive(!!getOriginalSize(this._getInstanceId()));
        }
        this._fillArrangementMenu();
        if (sizeLocked && this._resizer) {
            this._resizer.cancel();
        }
    },

    // Nach dem Verlassen des Fence scrollt der Inhalt nach kurzer Zeit
    // sanft wieder an den Anfang. Kommt die Maus vorher zurueck, bleibt
    // alles stehen.
    _scheduleScrollReset: function() {
        this._cancelScrollReset();
        this._scrollResetId = Mainloop.timeout_add(SCROLL_RESET_DELAY_MS, (function() {
            this._scrollResetId = 0;
            const scroll = this._scrollView;
            if (scroll && !scroll.is_finalized() && !(this.actor && this.actor.hover)) {
                const bar = scroll.get_vscroll_bar();
                const adjustment = bar ? bar.get_adjustment() : null;
                if (adjustment && adjustment.get_value() !== 0) {
                    adjustment.ease(0, {
                        duration: SCROLL_RESET_DURATION_MS,
                        mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD
                    });
                }
            }
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    _cancelScrollReset: function() {
        if (this._scrollResetId) {
            Mainloop.source_remove(this._scrollResetId);
            this._scrollResetId = 0;
        }
        // Laeuft das Zurueckscrollen schon, haelt es an, sobald die Maus
        // zurueckkommt.
        const scroll = this._scrollView;
        if (scroll && !scroll.is_finalized()) {
            const bar = scroll.get_vscroll_bar();
            const adjustment = bar ? bar.get_adjustment() : null;
            if (adjustment) {
                adjustment.remove_transition("value");
            }
        }
    },

    // --- AP13a: Groesse ziehen -------------------------------------------

    _isTitleRowActor: function(actor) {
        if (!actor) {
            return false;
        }
        // Menue- und Pfeilknopf gehoeren zur Zeile, verschieben aber nicht.
        const buttons = [this._titleMenuButton].concat(this._titleButtons || []);
        for (const button of buttons) {
            if (button && !button.is_finalized()
                && (actor === button || button.contains(actor))) {
                return false;
            }
        }
        for (const row of [this._titleRow, this._collapsedBar]) {
            if (row && !row.is_finalized()
                && (actor === row || row.contains(actor))) {
                return true;
            }
        }
        return false;
    },

    _getResizeSnapInterval: function() {
        if (!this.snap_to_grid || !global.settings.get_boolean("desklet-snap")) {
            return 0;
        }
        return global.settings.get_int("desklet-snap-interval");
    },

    _onFenceResizeBegin: function() {
        this._arrangementBefore = captureArrangement();
        // Kachelbreite beim Start merken: Beim Verbreitern kommen Spalten
        // dazu, statt dass die Kacheln breiter werden.
        this._resizeTileWidth = this._getTileWidth();
        const frame = this._scrollView || this._panelBox;
        this._resizeStartWidth = frame && !frame.is_finalized()
            ? Math.round(frame.get_width())
            : 0;
    },

    _currentSizeRecord: function() {
        return {
            "max-width": this.max_width,
            "max-height": this.max_height,
            "columns": Math.round(this.columns),
            "content-fit": this.content_fit
        };
    },

    _applySizeRecord: function(record) {
        if (record["content-fit"]) {
            this.settings.setValue("content-fit", record["content-fit"]);
        }
        if (record["columns"] > 0) {
            this.settings.setValue("columns", record["columns"]);
        }
        this.settings.setValue("max-width", record["max-width"]);
        this.settings.setValue("max-height", record["max-height"]);

        // setValue() ruft die eigenen Rueckrufe nicht auf - selbst neu aufbauen.
        this._lastMaxWidth = this.max_width;
        this._lastMaxHeight = this.max_height;
        this._lastContentFit = this.content_fit;
        this._scheduleRefresh();
    },

    // Groesse vor der allerersten Aenderung. Die aktuelle Groesse wird zur
    // vorherigen - "Restore previous size" nimmt das also wieder zurueck.
    _restoreOriginalSize: function() {
        const id = this._getInstanceId();
        const original = getOriginalSize(id);
        if (!original) {
            return;
        }
        pushHistory(captureArrangement(), false, "size-restore");
        setPreviousSize(id, this._currentSizeRecord());
        this._applySizeRecord(original);
    },

    // Tauscht aktuelle und vorherige Groesse. Ein zweiter Aufruf nimmt das
    // Zuruecksetzen also wieder zurueck.
    _restorePreviousSize: function() {
        const id = this._getInstanceId();
        const previous = getPreviousSize(id);
        if (!previous) {
            return;
        }
        pushHistory(captureArrangement(), false, "size-restore");
        setPreviousSize(id, this._currentSizeRecord());
        this._applySizeRecord(previous);
    },

    // --- AP13c: Verlauf der Anordnungen, Ausrichten --------------------------

    _getArrangementState: function() {
        if (!this.actor || !this.actor.get_stage()) {
            return null;
        }
        return {
            x: Math.round(this.actor.get_x()),
            y: Math.round(this.actor.get_y()),
            size: this._currentSizeRecord()
        };
    },

    _applyArrangementState: function(state) {
        const size = state.size;
        if (size && (size["max-width"] !== this.max_width
            || size["max-height"] !== this.max_height
            || size["columns"] !== Math.round(this.columns)
            || size["content-fit"] !== this.content_fit)) {
            this._applySizeRecord(size);
        }
        if (state.x !== Math.round(this.actor.get_x()) || state.y !== Math.round(this.actor.get_y())) {
            this.actor.set_position(state.x, state.y);
            this._storeActorPosition(false);
        }
    },

    // AP18-5: Uebergabedatei des Originals lesen (und loeschen), Werte
    // ueber setValue() uebernehmen - niemand schreibt von aussen in die
    // <ID>.json. Ohne Datei: nichts.
    _applyCloneHandover: function() {
        const id = this._getInstanceId();
        let data = null;
        try {
            data = takeHandover(id);
        } catch (e) {
            global.logError(e, "aVinceLaunch: Uebergabedatei fuer Fence " + id + " unlesbar");
        }
        if (!data) {
            return;
        }
        let count = 0;
        Object.keys(data.values).forEach(key => {
            try {
                this.settings.setValue(key, data.values[key]);
                count++;
            } catch (e) {
                global.logError(e, "aVinceLaunch: Wert " + key + " nicht uebernommen");
            }
        });
        global.log("aVinceLaunch: Fence " + id + (data.from === "startaufstellung"
            ? " kommt aus der Startaufstellung" : " ist ein Duplikat von Fence " + data.from)
            + " (" + count + " Werte uebernommen)");
    },

    // AP18-5: neue Instanz neben diesem Fence anlegen - wie Cinnamons eigener
    // Einstellungsdialog (Spices.py:881): next-desklet-id, Eintrag anhaengen.
    // Cinnamon baut dabei nur den neuen Fence auf (Probe 07.10.2026).
    _duplicateFence: function() {
        const ownId = this._getInstanceId();
        const rect = this._getFrameRect();
        if (!rect) {
            Main.notify(_("Could not duplicate the fence."));
            return;
        }

        try {
            // Lage: naechster freier Platz neben dem Original; sonst leicht
            // versetzt darueber (entsperrt, laesst sich gleich wegziehen).
            const area = getWorkAreaForRect(rect);
            let spot = findFreeSpot(rect, this._neighbourRects(), area, getLayoutSettings());
            const crowded = !spot;
            if (crowded) {
                spot = { x: rect.x + 30, y: rect.y + 30, w: rect.w, h: rect.h };
                if (area) {
                    spot.x = Math.max(area.x, Math.min(spot.x, area.x + area.w - rect.w));
                    spot.y = Math.max(area.y, Math.min(spot.y, area.y + area.h - rect.h));
                }
            }
            const offsetX = rect.x - Math.round(this.actor.get_x());
            const offsetY = rect.y - Math.round(this.actor.get_y());

            // ID: frei von Cinnamons Praefixfehler, ohne alte Reste
            // (<ID>.json, Uebergabedatei, Groessen in layout.json).
            const list = global.settings.get_strv("enabled-desklets");
            const newId = this._pickNewInstanceId(list);

            // Quelle: Gruppe -> neuer leerer Ordner, Portal -> derselbe Ordner.
            const portal = this._isPortal();
            let subdirectory = this.subdirectory;
            if (!portal) {
                subdirectory = nextGroupName(this.subdirectory,
                    name => GLib.file_test(getResolvedPath(name), GLib.FileTest.EXISTS));
                if (!subdirectory || GLib.mkdir_with_parents(getResolvedPath(subdirectory), 0o755) !== 0) {
                    Main.notify(_("Could not duplicate the fence."),
                        _("The new link folder could not be created."));
                    return;
                }
            }

            const title = _("%s (copy)").format(this._getFenceTitle());
            const values = buildCloneValues(key => this.settings.getValue(key), {
                "subdirectory": subdirectory,
                "fence-title": title,
                "lock-position": false,
                "lock-content": false,
                "collapsed": false
            });

            backupBeforeClone(list);
            writeHandover(newId, {
                from: ownId,
                createdAt: new Date().toISOString(),
                values: values
            });

            global.settings.set_int("next-desklet-id", newId + 1);
            list.push([UUID, newId, Math.round(spot.x - offsetX), Math.round(spot.y - offsetY)].join(":"));
            global.settings.set_strv("enabled-desklets", list);
            global.log("aVinceLaunch: Fence " + ownId + " dupliziert -> Fence " + newId
                + (portal ? " (Portal)" : " (Ordner " + subdirectory + ")")
                + (crowded ? ", kein freier Platz - versetzt" : ""));

            if (handoverExists(newId)) {
                // Die neue Instanz ist nicht gestartet.
                Main.notify(_("Could not duplicate the fence."),
                    _("The new fence did not start. Details are in ~/.xsession-errors."));
                return;
            }
            Main.notify(_("Fence duplicated: %s").format(title),
                crowded
                    ? _("There is no free space next to it, so the copy lies slightly offset over the original. It is unlocked – move it to its place.")
                    : _("The copy is unlocked – move it to its place."));
        } catch (e) {
            global.logError(e, "aVinceLaunch: Fence " + ownId + " konnte nicht dupliziert werden");
            Main.notify(_("Could not duplicate the fence."));
        }
    },

    // ID fuer eine neue Instanz: frei von Cinnamons Praefixfehler, ohne alte
    // Reste (<ID>.json, Uebergabedatei, Groessen in layout.json).
    _pickNewInstanceId: function(list) {
        const ids = instanceIdsOf(list, UUID);
        const spicesDir = GLib.build_filenamev([GLib.get_user_config_dir(), "cinnamon", "spices", UUID]);
        const taken = id => GLib.file_test(GLib.build_filenamev([spicesDir, id + ".json"]), GLib.FileTest.EXISTS)
            || handoverExists(id) || !!getPreviousSize(id) || !!getOriginalSize(id);
        let newId = pickInstanceId(global.settings.get_int("next-desklet-id"), ids);
        while (taken(newId)) {
            newId = pickInstanceId(newId + 1, ids);
        }
        return newId;
    },

    // Sichtbare Flaeche an eine Stelle setzen (Ausrichten rechnet mit ihr).
    _moveFrameTo: function(x, y) {
        const frame = this._getFrameRect();
        const offsetX = frame ? frame.x - Math.round(this.actor.get_x()) : 0;
        const offsetY = frame ? frame.y - Math.round(this.actor.get_y()) : 0;
        this.actor.set_position(x - offsetX, y - offsetY);
        this._storeActorPosition(false);
    },

    _alignAllFences: function() {
        const rect = this._getFrameRect();
        if (rect) {
            alignFencesOnMonitorOf(rect, alignFences, getLayoutSettings(),
                getForeignDeskletRects(UUID));
        }
    },

    _formatHistoryTime: function(time) {
        const then = GLib.DateTime.new_from_unix_local(Math.floor(time / 1000));
        const now = GLib.DateTime.new_now_local();
        const sameDay = then.get_day_of_year() === now.get_day_of_year()
            && then.get_year() === now.get_year();
        return then.format(sameDay ? "%H:%M:%S" : "%d.%m. %H:%M:%S");
    },

    // Kurzbeschreibung hinter dem Symbol (Wunsch 02.10.). Als Funktion,
    // damit _() erst beim Oeffnen des Menues greift.
    _historyKindLabel: function(kind) {
        switch (kind) {
        case "move": return _("moved");
        case "width": return _("width changed");
        case "height": return _("height changed");
        case "size": return _("size changed");
        case "size-restore": return _("size reset");
        case "align": return _("aligned");
        case "restore": return _("restored");
        default: return "";
        }
    },

    // Untermenue bei jedem Oeffnen neu fuellen - der Verlauf ist fuer alle
    // Fences derselbe und kann sich ueber einen anderen Fence geaendert haben.
    _fillArrangementMenu: function() {
        const submenu = this._arrangementMenu;
        if (!submenu) {
            return;
        }
        submenu.menu.removeAll();

        // Fester Eintrag: fällt nie aus dem Verlauf.
        const original = getOriginalArrangement();
        if (original) {
            const originalItem = new PopupMenu.PopupMenuItem(_("Original arrangement"));
            originalItem.connect("activate", function() {
                restoreOriginalArrangement();
            });
            submenu.menu.addMenuItem(originalItem);
        }

        const history = getHistory();
        if (original && history.length > 0) {
            submenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }
        history.forEach((entry, index) => {
            // Uhrzeit, direkt dahinter je Art der Aenderung ein Symbol - in
            // einer gemeinsamen Zeile, sonst setzt das Menue die Symbole in
            // eine eigene Spalte weit rechts (Test 02.10.).
            const item = new PopupMenu.PopupBaseMenuItem();
            const row = new St.BoxLayout({ style_class: "avincelaunch-history-row" });
            row.add_child(new St.Label({
                text: this._formatHistoryTime(entry.time),
                style_class: "avincelaunch-history-time",
                y_align: Clutter.ActorAlign.CENTER
            }));
            (entry.kinds || []).forEach(kind => {
                const iconName = HISTORY_KIND_ICONS[kind];
                if (iconName) {
                    row.add_child(new St.Icon({
                        icon_name: iconName,
                        icon_type: St.IconType.SYMBOLIC,
                        style_class: "popup-menu-icon",
                        y_align: Clutter.ActorAlign.CENTER
                    }));
                    row.add_child(new St.Label({
                        text: this._historyKindLabel(kind),
                        style_class: "avincelaunch-history-kind",
                        y_align: Clutter.ActorAlign.CENTER
                    }));
                }
            });
            item.addActor(row);
            item.connect("activate", (function() {
                restoreArrangement(index);
            }).bind(this));
            submenu.menu.addMenuItem(item);
        });
        submenu.setSensitive(history.length > 0 || !!original);
    },

    // Spalten fuer eine neue Breite bei gleicher Kachelbreite. Begrenzt auf
    // 2..15, damit der Wert nie genau auf min (1) oder max (16) des Schemas
    // liegt. 0 = Spalten nicht anfassen (Listenansicht).
    _planColumnsForWidth: function(width) {
        if (this._isListLayout() || !(this._resizeTileWidth > 0)) {
            return 0;
        }
        const spacing = Math.round(this.col_spacing);
        const inner = width - this._getDeskletPaddingPx();
        const columns = Math.round((inner + spacing) / (this._resizeTileWidth + spacing));
        return Math.max(2, Math.min(15, columns));
    },

    // Spalten nur neu rechnen, wenn sich die Breite um mindestens eine halbe
    // Kachel aendert. Sonst kostet schon das Einrasten am Raster (wenige
    // Pixel) eine Spalte.
    _widthChangesColumns: function(width) {
        if (!(this._resizeTileWidth > 0) || !(this._resizeStartWidth > 0)) {
            return false;
        }
        return Math.abs(width - this._resizeStartWidth) >= this._resizeTileWidth / 2;
    },

    _describeFenceResize: function(width, height, zone) {
        let text = "%d × %d".format(width, height);
        if (this._resizeFree) {
            text += "  ·  " + _("FREE (Ctrl)");
        }
        if (zone !== "bottom" && this._widthChangesColumns(width)) {
            const columns = this._planColumnsForWidth(width);
            if (columns > 0) {
                text += "  ·  " + _("%d columns").format(columns);
            }
        }
        return text;
    },

    _onFenceResized: function(width, height, zone) {
        const kind = zone === "right" ? "width" : zone === "bottom" ? "height" : "size";
        pushHistory(this._arrangementBefore || captureArrangement(), false, kind);
        this._arrangementBefore = null;
        const current = this._currentSizeRecord();
        rememberOriginalSize(this._getInstanceId(), current);
        setPreviousSize(this._getInstanceId(), current);

        const record = {
            "max-width": width,
            "max-height": height,
            "columns": 0,
            "content-fit": "fixed"
        };
        if (zone !== "bottom" && this._widthChangesColumns(width)) {
            record["columns"] = this._planColumnsForWidth(width);
        }
        this._applySizeRecord(record);
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

    // Pruefung Phase 2, P32/P11: Der Basisordner kommt NUR aus config.json.
    // Die Kopie "base-directory" in der eigenen <ID>.json ist nur Anzeige;
    // frueher schrieb der Fence sie nach config.json zurueck - auch einen
    // leeren Zwischenwert des Dialogs, der dann zum Standardordner wurde.
    _resolveBaseDirectory: function() {
        return getBaseDirectory();
    },

    _onSharedBaseChanged: function() {
        if (this._lastBaseDirectory === this._resolveBaseDirectory()) {
            return;
        }
        if (this._isPortal()) {
            // Portale haengen nicht am Basisordner.
            this._lastBaseDirectory = this._resolveBaseDirectory();
            return;
        }
        this._scheduleStoragePathApply(false);
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
        this._lastThemeState = this._getThemeState();
        // Erst nach dem laufenden Durchgang freigeben (AP17-2): Kommt der
        // Farbmodus aus dem Dialog, prueft Cinnamons _checkSettings danach noch
        // die Farbschluessel gegen den Stand VOR der Vorlage, haelt die eben
        // gesetzten Farben fuer eine Aenderung von aussen und ruft
        // _onColorSettingChanged - der Fence sprang auf "Eigene".
        if (this._presetSettleId) {
            Mainloop.source_remove(this._presetSettleId);
        }
        this._presetSettleId = Mainloop.idle_add((function() {
            this._presetSettleId = 0;
            this._applyingPreset = false;
            return GLib.SOURCE_REMOVE;
        }).bind(this));

        if (refresh !== false) {
            this._finishSettingsRefresh();
        }
    },

    _confirmResetAppearance: function() {
        const dialog = new ModalDialog.ConfirmDialog(
            _("Reset colours, font and border of this fence to the aVinceLaunch template?") +
            "\n\n" + _("Folder, name, size and position stay unchanged."),
            this._resetAppearance.bind(this));
        dialog.open();
    },

    // Schreibt nur ueber setValue() (nie von aussen in die <ID>.json).
    // Die Vorgaben dieser Schluessel sind seit AP09e die aVinceLaunch-Werte;
    // die Farben setzt anschliessend die Vorlage.
    _resetAppearance: function() {
        APPEARANCE_RESET_KEYS.forEach(key => {
            this.settings.setValue(key, this.settings.getDefaultValue(key));
        });
        this.settings.setValue("color-mode", AVINCELAUNCH_PRESET);
        this._applyActivePreset();
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

    // B4: eigentliche Bereiche der Einstellungen (siehe RANGED_SETTINGS).
    _clampRangedSettings: function() {
        RANGED_SETTINGS.forEach(([prop, low, high]) => {
            const clamped = clampSetting(this[prop], low, high);
            if (clamped !== this[prop]) {
                this[prop] = clamped;
            }
        });
    },

    _onSettingsChanged: function() {
        this._clampRangedSettings();
        if (this._applyingPreset) {
            return;
        }

        const themeState = this._getThemeState();
        if (!isCustomColorMode(this.color_mode) && themeState !== this._lastThemeState) {
            this._applyActivePreset();
            return;
        }

        const baseChanged = this._lastBaseDirectory !== this._resolveBaseDirectory();
        const subChanged = this._lastSubdirectory !== this.subdirectory;
        const sourceChanged = this._lastSourceState !== this._getSourceState();
        if (baseChanged || subChanged || sourceChanged) {
            // Debounce so Configure Browse can finish writing Items / JSON first.
            this._scheduleStoragePathApply(false);
            return;
        }

        this._finishSettingsRefresh();
    },

    _scheduleStoragePathApply: function(createIfMissing) {
        if (this._storageChangeTimeoutId) {
            Mainloop.source_remove(this._storageChangeTimeoutId);
            this._storageChangeTimeoutId = 0;
        }

        this._storageChangeTimeoutId = Mainloop.timeout_add(400, (function() {
            this._storageChangeTimeoutId = 0;
            this._finishSettingsRefresh(!!createIfMissing);
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    _finishSettingsRefresh: function(createIfMissing) {
        const baseChanged = this._lastBaseDirectory !== this._resolveBaseDirectory();
        const subChanged = this._lastSubdirectory !== this.subdirectory;
        const folderSortChanged = this._lastFolderSort !== this.folder_sort;
        const sourceChanged = this._lastSourceState !== this._getSourceState();
        const storageChanged = baseChanged || subChanged || sourceChanged;
        const shouldCreate = !!createIfMissing;

        if (baseChanged) {
            this._lastBaseDirectory = this._resolveBaseDirectory();
            this.base_directory = this._lastBaseDirectory;
        }

        if (storageChanged || shouldCreate) {
            this._applyStoragePath(shouldCreate);
        } else if (folderSortChanged && this._isPortal()) {
            // Portal: sortiert beim Einlesen, schreibt nie eine Sidecar-Datei.
            this._restartFileMonitor();
        } else if (folderSortChanged) {
            const rootPath = this._getOrderRootPath();
            if (rootPath) {
                // Erst die neue Ordnung festschreiben (asynchron gelesen),
                // dann Dialogliste und Anzeige nachziehen.
                this._withOrderScans([{
                    path: rootPath,
                    options: { persistOrder: true, ignoreSavedOrder: true }
                }], () => {
                    this._syncOrderListFromDirectory();
                    this._scheduleRefresh();
                });
            }
            this._restartFileMonitor();
        } else {
            this._restartFileMonitor();
        }

        this._lastFolderSort = this.folder_sort;
        if (!storageChanged && !shouldCreate) {
            this._scheduleRefresh();
        }
        this._applyHeaderStyle();
    },

    on_create_link_directory_callback: function() {
        if (this._storageChangeTimeoutId) {
            Mainloop.source_remove(this._storageChangeTimeoutId);
            this._storageChangeTimeoutId = 0;
        }
        this._applyStoragePath(true);
    },

    on_base_directory_selected_callback: function() {
        // Configure Browse already wrote the shared base and Items for this instance.
        if (this._storageChangeTimeoutId) {
            Mainloop.source_remove(this._storageChangeTimeoutId);
            this._storageChangeTimeoutId = 0;
        }

        Mainloop.idle_add((function() {
            // config.json hat der Dialog schon geschrieben (P32) - hier nur
            // lesen, nie zurueckschreiben.
            this.base_directory = this._resolveBaseDirectory();
            const configuredSub = (this.settings.getValue("subdirectory") || "").trim();
            if (configuredSub) {
                this.subdirectory = configuredSub;
            }

            this._adoptConfiguredStoragePath();
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    on_subdirectory_selected_callback: function() {
        // Configure Browse already created/selected the folder and wrote Items.
        // Cancel any pending storage debounce and adopt that path for this instance.
        if (this._storageChangeTimeoutId) {
            Mainloop.source_remove(this._storageChangeTimeoutId);
            this._storageChangeTimeoutId = 0;
        }

        Mainloop.idle_add((function() {
            const configured = (this.settings.getValue("subdirectory") || "").trim();
            if (configured) {
                this.subdirectory = configured;
            }

            // Der Verknuepfungsordner betrifft nur diesen Fence, config.json
            // bleibt unberuehrt (AP17).
            this._adoptConfiguredStoragePath();
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    _adoptConfiguredStoragePath: function() {
        // Prefer the resolved instance root — do not keep a stale
        // order-folder-path from the previous base/subdirectory.
        const browsePath = getResolvedPath(this.subdirectory);
        const configuredBrowse = (this.settings.getValue("order-folder-path") || "").trim();
        const path = (configuredBrowse
            && this._isDirectoryPath(configuredBrowse)
            && (configuredBrowse === browsePath
                || configuredBrowse.indexOf(browsePath + "/") === 0))
            ? configuredBrowse
            : browsePath;

        if (!path || !this._isDirectoryPath(path)) {
            this._rootPath = null;
            this._navStack = [];
            this._stopFileMonitor();
            this._scheduleRefresh();
            return;
        }

        this._lastSubdirectory = this.subdirectory;
        this._lastBaseDirectory = this._resolveBaseDirectory();
        this._rootPath = browsePath;
        this._navStack = [{
            path: path,
            label: this.subdirectory || "default"
        }];
        this.order_folder_path = path;
        this.order_in_subfolder = path !== browsePath;
        this._restartFileMonitor();
        // Do not rewrite link-order-list-data — Configure already loaded JSON.
        this._scheduleRefresh();
        this._applyHeaderStyle();
    },

    _clearOrderListForMissingPath: function() {
        // Do not wipe Configure's Items list while the panel may be open.
        this._rootPath = null;
    },

    _applyHeaderStyle: function() {
        if (this._header_label) {
            this._header_label.set_style("color: %s;".format(this.title_color));
        }
    },

    // Nach einem Start erschien der Tooltip bei der naechsten Bewegung wieder;
    // ging dann das neue Fenster darueber auf, verliess die Maus die Kachel
    // nie und er blieb ueber allen Fenstern stehen (Test 02.10.). Deshalb:
    // nach dem Start bis zum Verlassen des Fence unterdruecken, und bei jedem
    // Fensterwechsel verstecken.
    _hideItemTooltips: function(suppress) {
        this._itemTooltips.forEach(tooltip => {
            if (!tooltip) {
                return;
            }
            tooltip.preventShow = !!suppress;
            if (tooltip._showTimer) {
                Mainloop.source_remove(tooltip._showTimer);
                tooltip._showTimer = null;
            }
            if (tooltip.visible) {
                tooltip.hide();
            }
        });
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

    // Erste Zeile der volle Name - unter den Kacheln wird er oft gekuerzt
    // ("Mission ...") -, darunter Beschreibung bzw. Ordnerpfad (Idee 2).
    _tooltipText: function(item) {
        const name = String(item.name || "").trim();
        const detail = item.type === "folder"
            ? String(item.path || "").trim()
            : String(item.comment || "").trim();
        if (!name) {
            return detail;
        }
        if (!detail || detail === name) {
            return name;
        }
        return name + "\n" + detail;
    },

    _isDirectoryPath: function(path) {
        if (!path) {
            return false;
        }

        try {
            const file = Gio.File.new_for_path(path);

            if (!file.query_exists(null)) {
                return false;
            }

            return file.query_file_type(
                Gio.FileQueryInfoFlags.NONE,
                null
            ) === Gio.FileType.DIRECTORY;
        } catch (e) {
            global.logError(e, "aVinceLaunch: directory check failed for " + path);
            return false;
        }
    },

    // --- Folder Portal (AP10b-1) ------------------------------------------
    // Ein Portal zeigt einen echten Ordner als reine Ansicht. Es wird im
    // Hintergrund eingelesen (portalScanner.js), sortiert immer automatisch
    // und schreibt nie etwas in den Ordner - auch keine Sidecar-Datei.

    _isPortal: function() {
        return this.source_mode === SOURCE_PORTAL;
    },

    _getPortalPath: function() {
        return normalizePath(this.portal_path);
    },

    _getSourceState: function() {
        return [
            this._isPortal() ? SOURCE_PORTAL : "group",
            this._isPortal() ? this._getPortalPath() : "",
            this._isPortal() && this.portal_show_hidden ? "hidden" : ""
        ].join("|");
    },

    _applyPortalPath: function() {
        const portal = this._getPortalPath();
        // Auch einen (noch) fehlenden Ordner schuetzen.
        registerReadOnlyRoot(this._getInstanceId(), portal, this);
        // AP10b-2: Netzlaufwerk nur aus der Einhaengetabelle erkennen. Dort
        // wird der Pfad NICHT synchron geprueft - das koennte haengen, wenn
        // die NAS nicht erreichbar ist; das Einlesen im Hintergrund meldet
        // "nicht erreichbar" von selbst.
        this._portalIsNetwork = !!portal && isNetworkPath(portal);
        this._portalSignature = null;

        if (!portal || (!this._portalIsNetwork && !this._isDirectoryPath(portal))) {
            this._rootPath = null;
            this._stopFileMonitor();
            this._scheduleRefresh();
            this._armPortalMissingRetry();
            return false;
        }

        this._rootPath = portal;
        this._navStack.push({
            path: portal,
            label: GLib.path_get_basename(portal)
        });
        this._restartFileMonitor();
        this._scheduleRefresh();
        return true;
    },

    // --- Portal auf der NAS (AP10b-2) -------------------------------------
    // Auf CIFS meldet die Ordnerueberwachung Aenderungen anderer Rechner
    // nicht, und schon das Einrichten greift auf die NAS zu. Darum: keine
    // Ueberwachung, sondern selbst nachsehen - alle 30 s, nur solange der
    // Fence sichtbar ist, immer im Hintergrund; neu aufgebaut wird nur bei
    // einer echten Aenderung. Ist die NAS nicht erreichbar: alle 60 s ein
    // ruhiger neuer Versuch, kein Protokoll.
    _portalPollSeconds: function(error) {
        return error ? 60 : 30;
    },

    _isFenceVisible: function() {
        // AP12-2: eingeklappt (ohne kurzes Aufklappen) ist der Inhalt nicht
        // zu sehen - dann auch nicht nachsehen.
        if (this._isCollapsed() && !this._peekOpen) {
            return false;
        }
        return !!(this.actor && !this.actor.is_finalized()
            && this.actor.visible && this.actor.mapped);
    },

    _stopPortalPoll: function() {
        if (this._portalPollId) {
            GLib.source_remove(this._portalPollId);
            this._portalPollId = 0;
        }
    },

    _armPortalPoll: function(seconds) {
        this._stopPortalPoll();
        if (!this._isPortal() || !this._portalIsNetwork) {
            return;
        }
        this._portalPollId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, seconds, () => {
            this._portalPollId = 0;
            if (!this._isPortal() || !this._portalIsNetwork) {
                return GLib.SOURCE_REMOVE;
            }
            if (!this._isFenceVisible()) {
                // Ausgeblendet: nicht nachsehen, spaeter wieder fragen.
                this._armPortalPoll(seconds);
                return GLib.SOURCE_REMOVE;
            }
            this._refreshPortal(true);
            return GLib.SOURCE_REMOVE;
        });
    },

    // Pruefung Phase 2, P26: Ein lokaler Portal-Ordner, der fehlt (USB-Stick,
    // spaeter angelegter Ordner), wurde bis zum naechsten Neustart nie wieder
    // gesucht. Jetzt alle 60 s nachsehen - lokal, also ohne Haengegefahr
    // (Netzpfade laufen ueber die Abfrage oben). Gilt auch, wenn der Ordner
    // waehrend des Betriebs verschwindet; ist er wieder da, wird der Fence
    // neu eingerichtet (auch die Ordnerueberwachung). Gleiche Zeitgeber-Stelle
    // wie die Abfrage; _stopPortalPoll beendet beides.
    _armPortalMissingRetry: function() {
        this._stopPortalPoll();
        const portal = this._getPortalPath();
        if (!this._isPortal() || !portal || this._portalIsNetwork) {
            return;
        }
        this._portalPollId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 60, () => {
            this._portalPollId = 0;
            if (!this._isPortal() || this._getPortalPath() !== portal) {
                return GLib.SOURCE_REMOVE;
            }
            if (this._isDirectoryPath(portal)) {
                this._applyStoragePath(false);
            } else {
                this._armPortalMissingRetry();
            }
            return GLib.SOURCE_REMOVE;
        });
    },

    _portalResultSignature: function(result) {
        return (result.items || []).map(item =>
            item.type + ":" + (item.fileName || item.name || "")).join("|")
            + "#" + (result.truncated || 0) + "#" + (result.error || "");
    },

    _cancelPortalScan: function() {
        if (this._portalGate) {
            this._portalGate.cancel();
        }
    },

    // --- Schritt 4, V4d: Link-Ordner auf einem Netzlaufwerk -----------------
    // Liegt der Basisordner auf einer Freigabe (Einhaengetabelle, wie beim
    // Portal), wird nichts synchron geprueft, angelegt oder eingelesen: Der
    // Fence listet ueber lib/linkScanner.js scanDirectoryAsync auf,
    // hoechstens ein Durchgang zugleich, nach 2 min "nicht erreichbar" (ScanGate).
    // Aenderungen erkennt er durch Nachsehen (30 s, bei Fehler 60 s, nur
    // sichtbar) statt ueber einen Ordnerwaechter. Erst wenn die Freigabe
    // geantwortet hat, wird der eigene Ordner nach der N13-Regel angelegt und
    // die Liste im Dialog gefuellt. Seit dem Umbau auf asynchrones Lesen
    // gilt dasselbe fuer alles, was ausdruecklich angeklickt wird
    // (Einrichten, Eintrag-Menue, Sortierart im Dialog). Lokale Ordner
    // lesen ueber denselben Weg (_refreshLink), behalten aber ihren
    // Ordnerwaechter.
    _applyNetworkLinkPath: function(resolvedPath, createIfMissing) {
        this._linkIsNetwork = true;
        this._linkOwnFolderChecked = false;
        this._rootPath = resolvedPath;
        if (createIfMissing) {
            // Im Dialog ausdruecklich verlangt - wie bisher.
            try {
                this._rootPath = ensureLinkDirectory(this.subdirectory) || resolvedPath;
            } catch (e) {
                global.logError(e, "aVinceLaunch: failed to prepare link directory");
            }
        }
        this._navStack.push({
            path: this._rootPath,
            label: this.subdirectory || "default"
        });
        if (this.settings && (this.order_folder_path || "").trim() !== this._rootPath) {
            // Wie _setOrderBrowsePath, aber ohne die Dialogliste synchron
            // nachzuziehen - das macht das erste Ergebnis.
            this._applyingOrderPath = true;
            this.order_folder_path = this._rootPath;
            this.settings.setValue("order-folder-path", this._rootPath);
            this._applyingOrderPath = false;
        }
        this._stopFileMonitor();
        this._linkOrderListPending = true;
        this._scheduleRefresh();
        return true;
    },

    _refreshLink: function(fromPoll) {
        const currentPath = this._getCurrentPath();
        if (!currentPath) {
            this._cancelLinkScan();
            this._resetSurfaceState();
            this._linkHasContent = false;
            this._buildMessage(
                _("Link folder not reachable:\n%s\nIs the base folder (e.g. on a NAS) mounted? Another folder can be chosen under Configure → General → Link storage.")
                    .format(getResolvedPath(this.subdirectory))
            );
            return;
        }
        this._linkGate.request({
            fromPoll: !!fromPoll,
            path: currentPath,
            folderSort: this.folder_sort,
            sortMode: this.sort_mode
        });
    },

    _startLinkScan: function(job, done) {
        // Bis das Ergebnis da ist, bleibt die bisherige Ansicht stehen - nur
        // beim allerersten Einlesen ein Hinweis, und erst, wenn es dauert.
        if (!this._linkHasContent && !job.fromPoll) {
            this._showLoadingHintLater(() => !this._isPortal() && !this._linkHasContent
                && this._linkGate.busy);
        }
        return scanDirectoryAsync(job.path, {
            persistOrder: false,
            folderSort: job.folderSort,
            sortMode: job.sortMode
        }, done);
    },

    // "Loading…" erst nach LOADING_HINT_DELAY_MS - ein lokaler Ordner ist bis
    // dahin laengst gelesen, und nichts blitzt auf. stillEmpty() prueft beim
    // Ablauf, ob der Hinweis noch passt.
    _showLoadingHintLater: function(stillEmpty) {
        this._cancelLoadingHint();
        this._loadingHintId = Mainloop.timeout_add(LOADING_HINT_DELAY_MS, (function() {
            this._loadingHintId = 0;
            if (this.actor && !this.actor.is_finalized() && stillEmpty()) {
                this._resetSurfaceState();
                this._buildMessage(_("Loading…"));
            }
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    _cancelLoadingHint: function() {
        if (this._loadingHintId) {
            Mainloop.source_remove(this._loadingHintId);
            this._loadingHintId = 0;
        }
    },

    _onLinkScanResult: function(job, result, superseded) {
        if (superseded) {
            return;
        }
        if (!this.actor || this.actor.is_finalized() || this._isPortal()) {
            return;
        }
        if (job.path !== this._getCurrentPath()) {
            this._refreshLink(false);
            return;
        }
        if (!job.fromPoll && !result.error && (result.items || []).length === 0) {
            global.log("aVinceLaunch: no items in " + job.path);
        }
        if (this._linkIsNetwork && job.path === this._rootPath && !this._linkOwnFolderChecked
            && result.error !== "timeout") {
            // Die Freigabe hat geantwortet: jetzt darf der eigene Ordner
            // nach der N13-Regel angelegt werden (beim Start uebersprungen).
            this._linkOwnFolderChecked = true;
            if (result.error === "missing") {
                const ensured = this._ensureOwnFolder("Start");
                if (ensured && ensured.state === "angelegt") {
                    this._linkGate.request(Object.assign({}, job, { fromPoll: false }));
                    return;
                }
            }
        }
        if (!result.error && job.path === this._rootPath && this._linkOrderListPending) {
            this._linkOrderListPending = false;
            try {
                this._applyOrderListScan(job.path, result);
                this._updateOrderNavState();
            } catch (e) {
                global.logError(e, "aVinceLaunch: order list from network scan failed");
            }
        }
        const signature = this._linkResultSignature(result);
        const unchanged = job.fromPoll && signature === this._linkSignature;
        this._linkSignature = signature;
        this._cancelLoadingHint();
        if (!unchanged) {
            this._resetSurfaceState();
            this._linkHasContent = true;
            this._buildUI(result);
        }
        this._armLinkPoll(result.error ? 60 : 30);
    },

    // Alles, was die Anzeige eines Eintrags bestimmt - ohne Aenderung baut
    // das Nachsehen nicht neu auf.
    _linkResultSignature: function(result) {
        const iconText = icon => {
            try {
                return icon && icon.to_string ? String(icon.to_string()) : String(icon || "");
            } catch (e) {
                return "";
            }
        };
        return (result.items || []).map(item => [item.type, item.fileName || "", item.name || "",
            item.enabled ? 1 : 0, item.pinned ? 1 : 0, item.bgColor || "", item.iconTint || "",
            iconText(item.icon)].join("\u0001")).join("\u0002") + "#" + (result.error || "");
    },

    _cancelLinkScan: function() {
        this._cancelLoadingHint();
        if (this._linkGate) {
            this._linkGate.cancel();
        }
    },

    _stopLinkPoll: function() {
        if (this._linkPollId) {
            GLib.source_remove(this._linkPollId);
            this._linkPollId = 0;
        }
    },

    _armLinkPoll: function(seconds) {
        this._stopLinkPoll();
        if (this._isPortal() || !this._linkIsNetwork) {
            return;
        }
        this._linkPollId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, seconds, () => {
            this._linkPollId = 0;
            if (this._isPortal() || !this._linkIsNetwork) {
                return GLib.SOURCE_REMOVE;
            }
            if (!this._isFenceVisible()) {
                // Ausgeblendet oder eingeklappt: nicht nachsehen, spaeter wieder fragen.
                this._armLinkPoll(seconds);
                return GLib.SOURCE_REMOVE;
            }
            this._refreshLink(true);
            return GLib.SOURCE_REMOVE;
        });
    },

    _resetSurfaceState: function() {
        this._cancelPanelSizeSync();
        this._destroyItemTooltips();
        this._panelBox = null;
        this._titleRow = null;
        this._titleMenuButton = null;
        this._titleButtons = [];
        this._titleLabel = null;
        this._titleGrip = null;
    },

    _refreshPortal: function(fromPoll) {
        const currentPath = this._getCurrentPath();
        if (!currentPath) {
            this._cancelPortalScan();
            this._resetSurfaceState();
            this._portalHasContent = false;
            const portal = this._getPortalPath();
            this._buildMessage(portal
                ? _("Folder not reachable:\n%s").format(portal)
                : _("No folder chosen yet. Choose one under Configure → General → Link storage."));
            return;
        }

        // P50: Laeuft schon ein Einlesen, wartet diese Anfrage (die Abfrage
        // entfaellt ganz) - eine haengende NAS staut keine Einlesevorgaenge
        // mehr auf. Der Stand zum Startzeitpunkt steht im Auftrag.
        this._portalGate.request({
            fromPoll: !!fromPoll,
            path: currentPath,
            showHidden: !!this.portal_show_hidden,
            folderSort: this.folder_sort,
            sortMode: this.sort_mode
        });
    },

    _startPortalScan: function(job, done) {
        // Bis das Ergebnis da ist, bleibt die bisherige Ansicht stehen - nur
        // beim allerersten Einlesen ein Hinweis.
        if (!this._portalHasContent && !job.fromPoll) {
            this._showLoadingHintLater(() => this._isPortal() && !this._portalHasContent
                && this._portalGate.busy);
        }
        return scanPortalAsync(job.path, {
            showHidden: job.showHidden,
            folderSort: job.folderSort,
            sortMode: job.sortMode,
            limit: PORTAL_LIMIT
        }, done);
    },

    _onPortalScanResult: function(job, result, superseded) {
        if (superseded) {
            // Veraltet: der Folgedurchgang mit dem neuesten Stand laeuft schon.
            return;
        }
        if (!this.actor || this.actor.is_finalized()) {
            return;
        }
        this._cancelLoadingHint();
        if (job.path !== this._getCurrentPath()) {
            // Inzwischen anderer Ordner ohne eigene Anfrage: neu einlesen
            // (der Durchgang ist beendet, es laeuft also hoechstens dieser).
            this._refreshPortal(false);
            return;
        }
        const signature = this._portalResultSignature(result);
        const unchanged = job.fromPoll && signature === this._portalSignature;
        this._portalSignature = signature;
        if (!unchanged) {
            this._resetSurfaceState();
            this._portalHasContent = true;
            this._buildUI(result);
        }
        if (result.error === "missing" && !this._portalIsNetwork) {
            this._armPortalMissingRetry();
            return;
        }
        this._armPortalPoll(this._portalPollSeconds(result.error));
    },

    _buildPortalMoreHint: function(count) {
        const button = new St.Button({
            reactive: true,
            can_focus: true,
            x_expand: true,
            style_class: "thelauncher-empty",
            label: _("%d more entries – open in file manager").format(count)
        });
        button.connect("clicked", (function() {
            const path = this._getCurrentPath();
            if (path) {
                openFolder(path);
            }
        }).bind(this));
        return button;
    },

    // N13: eigenen Gruppenordner nach der Regel in lib/config.js anlegen
    // (ensureOwnLinkDirectory). Nie bei Portalen. Eine Zeile ins Protokoll,
    // wenn angelegt wurde oder nicht angelegt werden durfte.
    _ensureOwnFolder: function(anlass) {
        if (this._isPortal()) {
            return null;
        }
        const result = ensureOwnLinkDirectory(this.subdirectory);
        if (result.state === "angelegt") {
            global.log("aVinceLaunch: Fence " + this._getInstanceId() + ": Verknuepfungsordner angelegt ("
                + anlass + "): " + result.path);
        } else if (result.state !== "da") {
            global.log("aVinceLaunch: Fence " + this._getInstanceId() + ": Verknuepfungsordner nicht angelegt ("
                + anlass + ", " + result.state + "): " + getResolvedPath(this.subdirectory));
        }
        return result;
    },

    _applyStoragePath: function(createIfMissing) {
        this._lastSubdirectory = this.subdirectory;
        this._lastSourceState = this._getSourceState();
        this._navStack = [];
        this._cancelPortalScan();
        this._stopPortalPoll();
        this._portalHasContent = false;
        this._portalIsNetwork = false;
        this._cancelLinkScan();
        this._stopLinkPoll();
        // Anderer Ordner: laufende Abfragen des alten gelten nicht mehr.
        this._cancelOrderScans();
        this._ioCancellable.cancel();
        this._ioCancellable = new Gio.Cancellable();
        this._linkIsNetwork = false;
        this._linkHasContent = false;
        this._linkSignature = null;
        this._linkOrderListPending = false;
        // Gehoert zum alten Ordner (Neuaufbau beim Sperren, Klickart).
        this._lastScanResult = null;
        if (this._isPortal()) {
            return this._applyPortalPath();
        }
        unregisterReadOnlyRoot(this._getInstanceId(), this);
        const resolvedPath = getResolvedPath(this.subdirectory);
        if (isNetworkPath(resolvedPath)) {
            return this._applyNetworkLinkPath(resolvedPath, createIfMissing);
        }

        try {
            // config.json wird hier nur gelesen (AP17); geschrieben wird sie
            // nur, wenn der Basisordner in diesem Fence geaendert wurde.
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
            global.logError(e, "aVinceLaunch: failed to prepare link directory");
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
        if (configured && this._isUsableOrderPath(configured)) {
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

    // Netzlaufwerk: kein synchroner Statusaufruf auf der Freigabe - der Pfad
    // genuegt; ob es den Ordner gibt, meldet das asynchrone Lesen.
    _isUsableOrderPath: function(path) {
        if (!path) {
            return false;
        }
        return this._linkIsNetwork ? true : this._isDirectoryPath(path);
    },

    _getOrderDirectoryPath: function() {
        const configured = (this.order_folder_path || "").trim();
        if (configured && this._isUsableOrderPath(configured)) {
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
        if (this._isPortal()) {
            return;
        }
        const orderPath = this._getOrderDirectoryPath();
        if (!orderPath) {
            return;
        }

        this._withOrderScans([{ path: orderPath }], results => {
            const scanResult = this._orderScanResult(results, orderPath);
            if (!scanResult || scanResult.error) {
                return;
            }
            // Inzwischen zeigt der Dialog einen anderen Ordner - dessen
            // Abgleich ist schon angefragt; dieses Ergebnis gilt nicht mehr.
            if (this._isPortal() || this._getOrderDirectoryPath() !== orderPath) {
                return;
            }
            this._applyOrderListScan(orderPath, scanResult);
        });
    },

    // --- Ordner fuer die Dialogliste asynchron lesen -------------------------
    // requests: [{ path, options }] (options wie scanDirectoryAsync, Vorgabe
    // persistOrder: false). callback(results) - _orderScanResult(results,
    // path) liefert das Ergebnis oder null (nicht rechtzeitig gelesen). Nach
    // der Zeitgrenze des ScanGate kommt {}; beim Entfernen und beim
    // Ordnerwechsel kein Rueckruf. Was waehrend eines Durchgangs angefragt
    // wird, sammelt sich im naechsten (genau einer).
    _withOrderScans: function(requests, callback) {
        let job = this._orderJob;
        const fresh = !job || job.started;
        if (fresh) {
            job = { requests: [], callbacks: [], started: false, delivered: false };
            this._orderJob = job;
        }
        requests.forEach(request => {
            const options = Object.assign({ persistOrder: false }, request.options || {});
            const key = this._orderScanKey(request.path, options);
            if (request.path && !job.requests.some(entry => entry.key === key)) {
                job.requests.push({ key: key, path: request.path, options: options });
            }
        });
        job.callbacks.push(callback);
        if (fresh) {
            this._orderGate.request(job);
        }
    },

    _orderScanKey: function(path, options) {
        return path + "\u0001" + (options.persistOrder ? "p" : "") + (options.ignoreSavedOrder ? "i" : "");
    },

    _orderScanResult: function(results, path) {
        return (results || {})[this._orderScanKey(path, { persistOrder: false })] || null;
    },

    _startOrderScans: function(job, done) {
        job.started = true;
        if (this._orderJob === job) {
            this._orderJob = null;
        }
        const results = {};
        let current = null;
        let cancelled = false;
        let index = 0;
        const next = () => {
            if (cancelled) {
                return;
            }
            if (index >= job.requests.length) {
                done(results);
                return;
            }
            const request = job.requests[index++];
            current = this._scanDirectoryAsync(request.path, request.options, result => {
                current = null;
                results[request.key] = result;
                next();
            });
        };
        next();
        // ScanGate.cancel() ruft nur cancel() auf.
        return {
            cancel: () => {
                cancelled = true;
                if (current) {
                    current.cancel();
                }
            }
        };
    },

    _onOrderScansDone: function(job, results) {
        // Nach der Zeitgrenze kam schon {} - ein spaetes Ergebnis zaehlt
        // nicht noch einmal.
        if (job.delivered) {
            return;
        }
        job.delivered = true;
        if (!this.actor || this.actor.is_finalized()) {
            return;
        }
        job.callbacks.forEach(callback => {
            try {
                callback(results || {});
            } catch (e) {
                global.logError(e, "aVinceLaunch: order list update failed");
            }
        });
    },

    _cancelOrderScans: function() {
        this._orderJob = null;
        if (this._orderGate) {
            this._orderGate.cancel();
        }
    },

    // Liste im Dialog (link-order-list-data) aus einem Einlese-Ergebnis des
    // Ordners orderPath - synchron oder (V4d, Netzlaufwerk) asynchron.
    _applyOrderListScan: function(orderPath, scanResult) {
        ensureSidecarForDirectory(orderPath, scanResult.manualItems);

        this._syncingOrderList = true;
        this.settings.setValue(
            "link-order-list-data",
            itemsToOrderList(scanResult.manualItems)
        );
        // Pruefung Phase 2, P6: Liste und Ordner gehoeren zusammen. Verglichen
        // wird mit dem GESPEICHERTEN Ordner - configureDesklet setzt
        // order_folder_path vorher nur im Speicher; sonst blieb in der Datei
        // der alte Unterordner stehen und der Dialog arbeitete mit der Liste
        // des Startordners in diesem Unterordner (Papierkorb, Uebernehmen).
        if ((this.settings.getValue("order-folder-path") || "").trim() !== orderPath) {
            this.settings.setValue("order-folder-path", orderPath);
        }
        this.order_folder_path = orderPath;
        // Die Anzeige "Aktueller Ordner" gehoert ebenso dazu und wird auch bei
        // offenem Dialog nachgezogen (_updateOrderBrowseDisplay wartet dann).
        const label = this._getOrderBrowseLabel();
        if ((this.settings.getValue("order-breadcrumb-display") || "") !== label) {
            this.settings.setValue("order-breadcrumb-display", label);
        }
        this.order_breadcrumb_display = label;
        const inSubfolder = !!this._rootPath && orderPath !== this._rootPath;
        if (!!this.settings.getValue("order-in-subfolder") !== inSubfolder) {
            this.settings.setValue("order-in-subfolder", inSubfolder);
        }
        this._updateOrderBrowseDisplay();
        this._syncingOrderList = false;
    },

    _applyOrderFromSettings: function() {
        if (this._isPortal()) {
            return;
        }
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
        // Abgleich laeuft schon (Doppelklick): das Fenster kommt gleich.
        if (this._configurePending) {
            return;
        }
        // B12: vor dem Dialog sichern - er loescht die Datei beim Speichern
        // kurz (Cinnamon), ein Abbruch genau dann setzte alles auf Vorgaben.
        this._backupSettingsFile();
        this._configurePanelOpen = true;
        if (this._isPortal()) {
            this._openConfigureWindow(tab, {});
            return;
        }
        // Erst die Ordner lesen, die der Abgleich unten braucht (asynchron):
        // Startordner, Ordner der gespeicherten Liste, Ordner im Dialog.
        // Antwortet einer nicht binnen IO_WAIT_MS, oeffnet das Fenster
        // trotzdem - wie bei einem nicht lesbaren Ordner.
        this._configurePending = true;
        let finished = false;
        const proceed = results => {
            if (finished) {
                return;
            }
            finished = true;
            this._configurePending = false;
            if (this._configureWaitId) {
                Mainloop.source_remove(this._configureWaitId);
                this._configureWaitId = 0;
            }
            this._openConfigureWindow(tab, results);
        };
        this._configureWaitId = Mainloop.timeout_add(IO_WAIT_MS, (function() {
            this._configureWaitId = 0;
            proceed({});
            return GLib.SOURCE_REMOVE;
        }).bind(this));
        this._withOrderScans([this._rootPath, this._storedOrderListPath(), this._getOrderDirectoryPath()]
            .filter((path, index, all) => !!path && all.indexOf(path) === index)
            .map(path => ({ path: path })), proceed);
    },

    _openConfigureWindow: function(tab, results) {
        // Pruefung Phase 3, N3: Gehoert die gespeicherte Liste zu einem
        // Unterordner und hat sie dort offene Aenderungen, bleibt der Dialog
        // in diesem Ordner. Das muss VOR dem Zuruecksetzen entschieden werden:
        // Die Zuweisung an order_folder_path schreibt die Einstellung sofort
        // mit (Cinnamons bindProperty beachtet BindingDirection nicht,
        // settings.js:375) - danach war der Unterordner vergessen.
        if (this._rootPath && !this._keepDialogListInSubfolder(results)) {
            this.order_folder_path = this._rootPath;
            this.order_in_subfolder = false;
        }
        // AP18-1b: Liste vor dem Oeffnen auf den Stand des Ordners bringen.
        this._syncDialogListWithScans(results);
        // P6: Hat die Liste offene Aenderungen (nicht neu geladen), gehoert sie
        // weiter zum gespeicherten Ordner - der Speicher folgt der Datei.
        this._reloadOrderSettingsFromPanel();
        this._spawnSettingsWindow(tab !== undefined ? tab : 0);
        if (this._configurePanelTimerId) {
            Mainloop.source_remove(this._configurePanelTimerId);
        }
        this._configurePanelTimerId = Mainloop.timeout_add(500, (function() {
            this._configurePanelTimerId = 0;
            this._configurePanelOpen = false;
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    // Startet ein Python-Fenster aus dem Desklet-Ordner (Benutzer- oder
    // Systeminstallation). Liefert false, wenn die Datei nirgends liegt.
    // Schritt 4, V2 (N11): Das Einrichten-Fenster startet wie bei Cinnamon
    // ("xlet-settings desklet UUID -i ID -t SEITE", js/ui/desklet.js), aber
    // seine Fehlerausgabe landet in ~/.cache/avincelaunch/einrichten-<ID>.log
    // (bei jedem Oeffnen neu, erste Zeile = Startzeit) statt in /dev/null.
    // Ein haengender Import (N11) war sonst nicht zu klaeren. Geht das nicht,
    // Cinnamons eigener Weg.
    _spawnSettingsWindow: function(tab) {
        const id = String(this._getInstanceId());
        const page = String(Number.isInteger(tab) ? tab : 0);
        try {
            const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), "avincelaunch"]);
            GLib.mkdir_with_parents(dir, 0o755);
            const log = GLib.build_filenamev([dir, "einrichten-" + id + ".log"]);
            Util.trySpawn(["sh", "-c",
                'exec > "$4" 2>&1; date "+%F %T start"; exec xlet-settings desklet "$1" -i "$2" -t "$3"',
                "sh", UUID, id, page, log]);
            return;
        } catch (e) {
            global.logError(e, "aVinceLaunch: settings window with log failed");
        }
        Desklet.Desklet.prototype.configureDesklet.call(this, Number(page));
    },

    _spawnDialog: function(fileName, args) {
        const candidates = [
            GLib.build_filenamev([
                GLib.get_user_data_dir(),
                "cinnamon",
                "desklets",
                UUID,
                fileName
            ]),
            GLib.build_filenamev([
                "/usr/share/cinnamon/desklets",
                UUID,
                fileName
            ])
        ];

        for (let i = 0; i < candidates.length; i++) {
            try {
                const stream = Gio.File.new_for_path(candidates[i]).read(null);
                stream.close(null);
                // V4d: -B - kein __pycache__ im Ordner des Desklets.
                Util.spawn(["python3", "-B", candidates[i]].concat(args || []));
                return true;
            } catch (e) {
                // Naechster Ort.
            }
        }
        return false;
    },

    openAbout: function() {
        if (!this._spawnDialog("about-dialog.py", ["desklets", UUID])) {
            Desklet.Desklet.prototype.openAbout.call(this);
        }
    },

    // AP09d: sechs Punkte, Knopf zur ausfuehrlichen Hilfe.
    // N17: Der Schnellstart endet mit Code 2, wenn der Nutzer dort
    // "Startaufstellung ..." waehlt.
    openQuickstart: function() {
        const started = this._spawnDialogAsync("quickstart-dialog.py", [], (function(code) {
            if (code === 2) {
                this.openStartLayout();
            }
        }).bind(this));
        if (!started) {
            this._spawnDialog("quickstart-dialog.py");
        }
    },

    _dialogPath: function(fileName) {
        const candidates = [
            GLib.build_filenamev([GLib.get_user_data_dir(), "cinnamon", "desklets", UUID, fileName]),
            GLib.build_filenamev(["/usr/share/cinnamon/desklets", UUID, fileName])
        ];
        return candidates.find(path => GLib.file_test(path, GLib.FileTest.IS_REGULAR)) || null;
    },

    // Wie _spawnDialog, aber mit Rueckruf beim Ende (Rueckgabewert des
    // Dialogs; -1 = nicht regulaer beendet).
    _spawnDialogAsync: function(fileName, args, onExit) {
        const path = this._dialogPath(fileName);
        if (!path) {
            return false;
        }
        try {
            const proc = Gio.Subprocess.new(["python3", "-B", path].concat(args || []), Gio.SubprocessFlags.NONE);
            proc.wait_async(null, (p, result) => {
                let code = -1;
                try {
                    p.wait_finish(result);
                    code = p.get_if_exited() ? p.get_exit_status() : -1;
                } catch (e) {
                    code = -1;
                }
                try {
                    onExit(code);
                } catch (e) {
                    global.logError(e, "aVinceLaunch: Rueckruf nach " + fileName);
                }
            });
            return true;
        } catch (e) {
            global.logError(e, "aVinceLaunch: " + fileName + " liess sich nicht starten");
            return false;
        }
    },

    // --- N17: Startaufstellung ----------------------------------------------
    // Bauplan N17 (Angelo 13.10., Entscheidungen E1-E7). Der
    // Dialog (startaufstellung-dialog.py) legt Ordner und Verknuepfungen an
    // und hinterlegt einen Auftrag; die Fences legt danach dieser Fence an,
    // einen nach dem anderen wie beim Duplizieren (Uebergabedatei).

    _uiScale: function() {
        const scale = Number(global.ui_scale);
        return scale >= 1 ? scale : 1;
    },

    // Arbeitsflaechen aller Bildschirme, Hauptbildschirm zuerst.
    _monitorWorkAreas: function() {
        const areas = [];
        try {
            const monitors = Main.layoutManager.monitors;
            const primary = Main.layoutManager.primaryIndex;
            const workspace = global.workspace_manager.get_active_workspace();
            const order = [primary].concat(monitors.map((m, i) => i).filter(i => i !== primary));
            order.forEach(i => {
                const a = workspace.get_work_area_for_monitor(i);
                areas.push({ x: a.x, y: a.y, w: a.width, h: a.height });
            });
        } catch (e) {
            global.logError(e, "aVinceLaunch: Arbeitsflaechen nicht lesbar");
        }
        return areas;
    },

    // E3: Der Fence, von dem aus gestartet wird, wird Feld 1 - aber nur,
    // wenn er unbenannt ist und sein Ordner nichts Sichtbares enthaelt.
    _startLayoutCanReuse: function() {
        if (this._isPortal() || String(this.fence_title || "").trim()) {
            return false;
        }
        const path = this._rootPath || this._getCurrentPath();
        if (!path || !GLib.file_test(path, GLib.FileTest.IS_DIR)) {
            return !!path;
        }
        try {
            const enumerator = Gio.File.new_for_path(path).enumerate_children(
                "standard::name", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            let info;
            let visible = false;
            while ((info = enumerator.next_file(null)) !== null) {
                if (info.get_name().charAt(0) !== ".") {
                    visible = true;
                    break;
                }
            }
            enumerator.close(null);
            return !visible;
        } catch (e) {
            return false;
        }
    },

    _startLayoutRecord: function() {
        try {
            const record = loadLayoutStore().startaufstellung;
            return record && Array.isArray(record.ids) && record.ids.length > 0 ? record : null;
        } catch (e) {
            return null;
        }
    },

    openStartLayout: function() {
        if (_startLayoutBusy) {
            Main.notify(_("The starter layout is already being set up."));
            return;
        }
        const scale = this._uiScale();
        const reuse = this._startLayoutCanReuse();
        const own = this._getFrameRect();
        const occupied = this._neighbourRects().concat(reuse || !own ? [] : [own]);
        const logical = r => ({
            x: Math.floor(r.x / scale), y: Math.floor(r.y / scale),
            w: Math.ceil(r.w / scale), h: Math.ceil(r.h / scale)
        });
        const result = computeCells(this._monitorWorkAreas().map(logical), occupied.map(logical), 9);
        const dir = GLib.build_filenamev([GLib.get_user_config_dir(), "avincelaunch"]);
        const planPath = GLib.build_filenamev([dir, "startaufstellung-plan.json"]);
        const orderPath = GLib.build_filenamev([dir, "startaufstellung-auftrag.json"]);
        try {
            GLib.mkdir_with_parents(dir, 0o755);
            if (GLib.file_test(orderPath, GLib.FileTest.EXISTS)) {
                Gio.File.new_for_path(orderPath).delete(null);
            }
            const first = result.cells[0];
            GLib.file_set_contents(planPath, JSON.stringify({
                version: 1,
                places: result.cells.length,
                size: first ? [first.w, first.h] : [360, 210],
                reuse: reuse
            }) + "\n");
        } catch (e) {
            global.logError(e, "aVinceLaunch: Startaufstellung - Plan nicht geschrieben");
            Main.notify(_("Could not open the starter layout."));
            return;
        }
        _startLayoutBusy = true;
        const started = this._spawnDialogAsync("startaufstellung-dialog.py", [planPath, orderPath], (function(code) {
            _startLayoutBusy = false;
            try {
                Gio.File.new_for_path(planPath).delete(null);
            } catch (e) {
                // Schon weg - egal.
            }
            if (code !== 0) {
                return;
            }
            let order = null;
            try {
                const [ok, bytes] = GLib.file_get_contents(orderPath);
                order = ok ? JSON.parse(new TextDecoder().decode(bytes)) : null;
            } catch (e) {
                order = null;
            }
            if (!order || !Array.isArray(order.fences)) {
                Main.notify(_("Could not open the starter layout."));
                return;
            }
            this._runStartLayout(order, result.cells, scale, reuse, orderPath);
        }).bind(this));
        if (!started) {
            _startLayoutBusy = false;
            Main.notify(_("Could not open the starter layout."));
        }
    },

    // max-width/max-height zaehlen in Bildpunkten (wie der Akteur und das
    // Groesseziehen); das Raster rechnet logisch. Tower avltest 13.10.,
    // Skalierung 2: ohne Umrechnung nur halb so grosse Fences.
    _startLayoutValues: function(fence, cell, scale) {
        return {
            "fence-title": fence.title,
            "source-mode": "group",
            "subdirectory": fence.folder,
            "content-fit": "fixed",
            "max-width": Math.round(cell.w * scale),
            "max-height": Math.round(cell.h * scale),
            // Schreibtischtest 13.10.: mit der Vorgabe 8 Spalten war in
            // 360 px rechts eine Spalte abgeschnitten. Wie Angelos Fences:
            // 360 -> 4, schmaler entsprechend weniger.
            "columns": Math.max(2, Math.floor(cell.w / 87)),
            "show-title": true,
            "lock-position": true,
            "collapsed": false
        };
    },

    _runStartLayout: function(order, cells, scale, reuse, orderPath) {
        const fences = order.fences.slice(0, cells.length);
        const missing = order.fences.length - fences.length;
        if (fences.length === 0) {
            return;
        }
        _startLayoutBusy = true;
        const record = {
            at: new Date().toISOString(),
            ids: [],
            folders: fences.map(f => f.path).filter(p => !!p),
            titles: fences.map(f => f.title)
        };
        backupBeforeClone(global.settings.get_strv("enabled-desklets"));

        const finish = (function(complete) {
            try {
                const store = loadLayoutStore();
                store.startaufstellung = record;
                saveLayoutStore(store);
                if (orderPath && GLib.file_test(orderPath, GLib.FileTest.EXISTS)) {
                    Gio.File.new_for_path(orderPath).delete(null);
                }
            } catch (e) {
                global.logError(e, "aVinceLaunch: Startaufstellung - Eintrag nicht gespeichert");
            }
            _startLayoutBusy = false;
            global.log("aVinceLaunch: Startaufstellung - Fences " + record.ids.join(", ")
                + (complete ? "" : " (abgebrochen)"));
            if (complete) {
                Main.notify(_("Starter layout created: %d fences").format(record.ids.length),
                    missing > 0 ? _("%d fences did not fit on your screens.").format(missing) : "");
            }
        }).bind(this);

        let index = 0;
        if (reuse) {
            const cell = cells[0];
            const values = this._startLayoutValues(fences[0], cell, scale);
            // Erst Werte und Neuaufbau, dann die Lage: _storeActorPosition
            // sperrt _onPlacementSettingsChanged kurz (_applyingPosition).
            Object.keys(values).forEach(key => this.settings.setValue(key, values[key]));
            this._onPlacementSettingsChanged();
            this._onSettingsChanged();
            const frame = this._getFrameRect();
            const offsetX = frame ? frame.x - Math.round(this.actor.get_x()) : 0;
            const offsetY = frame ? frame.y - Math.round(this.actor.get_y()) : 0;
            this.actor.set_position(Math.round(cell.x * scale) - offsetX, Math.round(cell.y * scale) - offsetY);
            this._storeActorPosition(false);
            record.ids.push(String(this._getInstanceId()));
            index = 1;
        }

        const createNext = (function() {
            if (index >= fences.length) {
                finish(true);
                return;
            }
            const fence = fences[index];
            const cell = cells[index];
            let newId;
            try {
                const list = global.settings.get_strv("enabled-desklets");
                newId = this._pickNewInstanceId(list);
                writeHandover(newId, {
                    from: "startaufstellung",
                    createdAt: new Date().toISOString(),
                    values: this._startLayoutValues(fence, cell, scale)
                });
                global.settings.set_int("next-desklet-id", newId + 1);
                list.push([UUID, newId, Math.round(cell.x * scale), Math.round(cell.y * scale)].join(":"));
                global.settings.set_strv("enabled-desklets", list);
                record.ids.push(String(newId));
            } catch (e) {
                global.logError(e, "aVinceLaunch: Startaufstellung - Fence " + fence.title + " nicht angelegt");
                Main.notify(_("The starter layout stopped."), _("Details are in ~/.xsession-errors."));
                finish(false);
                return;
            }
            // Erst weiter, wenn die neue Instanz laeuft (sie liest und
            // loescht ihre Uebergabedatei) - hoechstens 5 s.
            let waited = 0;
            Mainloop.timeout_add(100, (function() {
                if (!handoverExists(newId)) {
                    index++;
                    createNext();
                    return GLib.SOURCE_REMOVE;
                }
                waited += 100;
                if (waited >= 5000) {
                    Main.notify(_("The starter layout stopped."),
                        _("The new fence did not start. Details are in ~/.xsession-errors."));
                    finish(false);
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            }).bind(this));
        }).bind(this);

        createNext();
    },

    _confirmRemoveStartLayout: function() {
        const record = this._startLayoutRecord();
        if (!record) {
            return;
        }
        const backupRoot = GLib.build_filenamev([GLib.get_user_config_dir(), "avincelaunch", "backups"]);
        let text = _("Remove the starter layout?") + "\n\n"
            + _("Fences: %s").format((record.titles || []).join(", ")) + "\n\n"
            + _("Their folders with the launchers are moved to %s – nothing is deleted. Cinnamon deletes the settings of the fences; a copy stays in the backups for at least 30 days.")
                .format(GLib.build_filenamev([backupRoot, "startaufstellung-…"]));
        const dialog = new ModalDialog.ConfirmDialog(text, this._removeStartLayoutNow.bind(this));
        dialog.open();
    },

    _removeStartLayoutNow: function() {
        const record = this._startLayoutRecord();
        if (!record) {
            return;
        }
        const ownId = String(this._getInstanceId());
        const DeskletManager = imports.ui.deskletManager;
        record.ids.filter(id => id !== ownId).forEach(id => {
            try {
                const def = DeskletManager.definitions.find(d => d.uuid === UUID && String(d.desklet_id) === id);
                if (def && def.desklet) {
                    def.desklet._removeFenceNow();
                }
            } catch (e) {
                global.logError(e, "aVinceLaunch: Startaufstellung - Fence " + id + " nicht entfernt");
            }
        });
        // Ordner erst, wenn die Fences weg sind - dann der eigene Fence.
        Mainloop.timeout_add(500, (function() {
            const stamp = GLib.DateTime.new_now_local().format("%Y-%m-%d_%H-%M-%S");
            const target = GLib.build_filenamev([GLib.get_user_config_dir(), "avincelaunch", "backups",
                "startaufstellung-" + stamp]);
            let moved = 0;
            try {
                GLib.mkdir_with_parents(target, 0o755);
                (record.folders || []).forEach(path => {
                    const folder = Gio.File.new_for_path(path);
                    if (!folder.query_exists(null)) {
                        return;
                    }
                    try {
                        folder.move(Gio.File.new_for_path(GLib.build_filenamev([target, folder.get_basename()])),
                            Gio.FileCopyFlags.NOFOLLOW_SYMLINKS, null, null);
                        moved++;
                    } catch (e) {
                        global.logError(e, "aVinceLaunch: Startaufstellung - Ordner " + path + " nicht verschoben");
                    }
                });
                const store = loadLayoutStore();
                delete store.startaufstellung;
                saveLayoutStore(store);
            } catch (e) {
                global.logError(e, "aVinceLaunch: Startaufstellung - Rueckweg unvollstaendig");
            }
            global.log("aVinceLaunch: Startaufstellung entfernt - " + record.ids.join(", ")
                + ", " + moved + " Ordner nach " + target);
            Main.notify(_("Starter layout removed"), _("The folders are in %s.").format(target));
            if (record.ids.indexOf(ownId) >= 0) {
                this._removeFenceNow();
            }
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    on_add_item_callback: function() {
        global.log("aVinceLaunch: Add launcher is handled in the Configure panel.");
    },

    on_remove_item_callback: function() {
        global.log("aVinceLaunch: Remove launcher is handled in the Configure panel.");
    },

    on_items_changed_callback: function() {
        // Python already updated link-order-list-data. Refresh the desklet
        // surface only — do not rewrite the Items list from here.
        Mainloop.idle_add((function() {
            this._reloadOrderSettingsFromPanel();
            this._refresh();
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    _restartFileMonitor: function() {
        this._stopFileMonitor();
        if (this._isPortal() && this._portalIsNetwork) {
            // AP10b-2: auf der NAS wird selbst nachgesehen (siehe oben).
            return;
        }
        if (!this._isPortal() && this._linkIsNetwork) {
            // V4d: ebenso fuer Link-Ordner auf einem Netzlaufwerk.
            return;
        }
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
        this._scheduleDialogListSync();
    },

    // --- AP18-1b: Liste im Dialog "Inhalte" aktuell halten -------------------
    // Bisher las die Liste den Ordner erst bei "Aktualisieren" neu ein; neue
    // Symbole (launcher-watch, launcher-move, von Hand) fehlten dort. Jetzt
    // zieht der Fence sie bei jeder Aenderung im Ordner und beim Oeffnen des
    // Dialogs mit - aber nur, wenn die Liste keine noch nicht uebernommenen
    // Aenderungen traegt (die Liste schreibt Umsortieren sofort in
    // link-order-list-data, erst "Uebernehmen" legt es im Ordner fest).
    // Sonst bleibt sie unangetastet und "Aktualisieren" wird markiert
    // (order-list-stale, Angelo 06.10.).

    _scheduleDialogListSync: function() {
        if (this._dialogListSyncId) {
            Mainloop.source_remove(this._dialogListSyncId);
        }
        this._dialogListSyncId = Mainloop.timeout_add(800, (function() {
            this._dialogListSyncId = 0;
            this._syncDialogListIfClean();
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    // Liste im Dialog an den Ordner angleichen, wenn sie keine offenen
    // Aenderungen hat (lib/orderListSync.js). Pruefung Phase 3, N3: Beim
    // Oeffnen von "Einrichten" zeigt order_folder_path schon auf den
    // Startordner, die gespeicherte Liste kann aber zu einem Unterordner
    // gehoeren - sie wird dann gegen ihren eigenen Ordner geprueft.
    // Liest die beiden Ordner asynchron und gleicht dann ab
    // (_syncDialogListWithScans).
    _syncDialogListIfClean: function() {
        if (this._isPortal() || this._syncingOrderList) {
            return;
        }
        const orderPath = this._getOrderDirectoryPath();
        if (!orderPath) {
            return;
        }
        this._withOrderScans([{ path: this._storedOrderListPath() }, { path: orderPath }],
            results => this._syncDialogListWithScans(results));
    },

    // Abgleich mit schon gelesenen Ordnern (results aus _withOrderScans).
    // Fehlt ein Ordner darin (nicht rechtzeitig, inzwischen ein anderer),
    // gilt er als nicht lesbar - planDialogListSync laesst dann alles, wie
    // es ist.
    _syncDialogListWithScans: function(results) {
        if (this._isPortal() || this._syncingOrderList) {
            return;
        }
        const orderPath = this._getOrderDirectoryPath();
        if (!orderPath) {
            return;
        }
        const plan = MeLib.orderListSync.planDialogListSync(
            this._storedOrderListPath(), orderPath, this._dialogListClassifier(results));
        if (plan === "sync") {
            // Wie bisher _syncOrderListFromDirectory - mit dem schon
            // gelesenen Stand statt einem zweiten Lesen.
            const scanResult = this._orderScanResult(results, orderPath);
            if (scanResult && !scanResult.error) {
                this._applyOrderListScan(orderPath, scanResult);
            }
            this._setDialogListStale(false);
        } else if (plan === "same") {
            this._setDialogListStale(false);
        } else if (plan === "stale") {
            this._setDialogListStale(true);
        }
    },

    // Vergleich der gespeicherten Dialogliste mit dem Inhalt eines Ordners
    // (lib/orderListSync.js classifyOrderList; null = nicht lesbar oder
    // nicht gelesen).
    _dialogListClassifier: function(results) {
        const current = this.settings.getValue("link-order-list-data") || [];
        return path => {
            const scanResult = this._orderScanResult(results, path);
            if (!scanResult || scanResult.error) {
                return null;
            }
            return MeLib.orderListSync.classifyOrderList(
                itemsToOrderList(scanResult.manualItems), current,
                entry => this._resolveOrderEntryId(entry));
        };
    },

    // N3: true, wenn die gespeicherte Liste zu einem Unterordner gehoert und
    // dort offene Aenderungen hat - dann nicht auf den Startordner stellen.
    _keepDialogListInSubfolder: function(results) {
        if (this._isPortal() || !this._rootPath) {
            return false;
        }
        const listPath = this._storedOrderListPath();
        if (!listPath || listPath === this._rootPath) {
            return false;
        }
        return MeLib.orderListSync.planDialogListSync(
            listPath, this._rootPath, this._dialogListClassifier(results)) === "stale";
    },

    // Ordner, zu dem die gespeicherte Dialogliste gehoert (order-folder-path,
    // nur innerhalb des eigenen Ordners), sonst "".
    _storedOrderListPath: function() {
        const stored = (this.settings.getValue("order-folder-path") || "").trim();
        if (!stored || !this._rootPath || !this._isUsableOrderPath(stored)) {
            return "";
        }
        if (stored !== this._rootPath && stored.indexOf(this._rootPath + "/") !== 0) {
            return "";
        }
        return stored;
    },

    _setDialogListStale: function(stale) {
        try {
            if (!!this.settings.getValue("order-list-stale") !== stale) {
                this.settings.setValue("order-list-stale", stale);
            }
        } catch (e) {
            // Schluessel erst nach dem naechsten Cinnamon-Neustart bekannt.
        }
    },

    _getCurrentPath: function() {
        if (this._navStack.length === 0) {
            return this._rootPath;
        }
        return this._navStack[this._navStack.length - 1].path;
    },

    _getCurrentSidecar: function() {
        if (this._isPortal()) {
            return { folderClickMode: null };
        }
        const currentPath = this._getCurrentPath();
        if (!currentPath) {
            return { folderClickMode: null };
        }
        // Die Reihenfolge-Datei des zuletzt eingelesenen Stands - ein Klick
        // soll den Ordner nicht noch einmal lesen (V4d, jetzt fuer alle).
        const last = this._lastScanResult;
        return last && last.sidecar ? last.sidecar : { folderClickMode: null };
    },

    _refresh: function() {
        if (this._isPortal()) {
            this._refreshPortal();
            return;
        }
        // Lokal wie auf einem Netzlaufwerk asynchron (_refreshLink); ohne
        // Ordner dort derselbe Hinweis wie bisher (N13).
        this._refreshLink(false);
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

    // Im Einfachklick-Modus zaehlte bisher ausschliesslich der erste Klick
    // (clickCount === 1). Wer zweimal kurz hintereinander klickte, loeste
    // damit gar nichts aus - der Klick schien "nicht zu greifen". Jetzt
    // zaehlt jeder Klick, ein versehentlicher Doppelstart wird ueber eine
    // kurze Sperre je Eintrag verhindert.
    _shouldLaunchApp: function(clickCount) {
        if (this.launch_mode === "double-click") {
            return clickCount >= 2;
        }
        return clickCount >= 1;
    },

    _launchGesperrt: function(schluessel) {
        const jetzt = GLib.get_monotonic_time() / 1000;
        if (this._letzterStart
            && this._letzterStart.schluessel === schluessel
            && (jetzt - this._letzterStart.zeit) < 600) {
            return true;
        }
        this._letzterStart = { schluessel: schluessel, zeit: jetzt };
        return false;
    },

    _onItemActivated: function(item, clickCount) {
        if (!item.enabled) {
            return;
        }
        // Treffer angeklickt oder mit Enter gestartet: Suche zu, alle
        // Fences zeigen wieder alles (sonst haelt das Suchfeld die
        // Tastatur fest und das neue Fenster bekaeme sie nicht).
        closeSearchInAllFences();
        this._hideItemTooltips(true);

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
            if (this._shouldLaunchApp(clickCount) && !this._launchGesperrt(item.path)) {
                openDocument(item.path);
            }
            return;
        }

        if (this._shouldLaunchApp(clickCount) && !this._launchGesperrt(item.path)) {
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

        return Math.max(padding, Math.round(BASE_TILE_WIDTH * 0.85));
    },

    _configureItemLabel: function(label) {
        label.clutter_text.set_line_wrap(true);
        label.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

        if (this._isListLayout()) {
            label.x_expand = true;
            label.y_expand = false;
            label.set_x_align(Clutter.ActorAlign.FILL);
            label.set_y_align(Clutter.ActorAlign.CENTER);
            label.clutter_text.set_line_alignment(Pango.Alignment.LEFT);
            label.clutter_text.set_x_align(Clutter.ActorAlign.START);
            label.clutter_text.set_y_align(Clutter.ActorAlign.CENTER);
            return;
        }

        // N24 (Tower 14.10., Skalierung 2: "Br…"): set_width zaehlt in
        // Bildpunkten, Symbolgroesse und Abstand logisch - das Symbol waechst
        // mit der Skalierung, die Beschriftung muss es auch.
        label.set_width(Math.round(this._getTileTextWidth() * this._uiScale()));
        label.x_align = this._getTextAlign();
    },

    // AP18-3: kleine Nadel oben rechts am Symbol angepinnter Eintraege.
    _withPinBadge: function(iconWidget, item) {
        if (!item.pinned) {
            return iconWidget;
        }
        const holder = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: false,
            y_expand: false
        });
        holder.add_child(iconWidget);
        const badge = new St.Icon({
            icon_name: "view-pin-symbolic",
            icon_type: St.IconType.SYMBOLIC,
            icon_size: Math.max(10, Math.round(this.icon_size / 3)),
            style_class: "avincelaunch-pin-badge",
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
            x_expand: true,
            y_expand: true
        });
        holder.add_child(badge);
        return holder;
    },

    _createItemIcon: function(item) {
        let iconWidget;
        if (item.type === "folder") {
            iconWidget = new St.Icon({
                icon_name: item.icon || "folder-symbolic",
                icon_type: St.IconType.SYMBOLIC,
                icon_size: this.icon_size,
                style_class: "thelauncher-item-icon"
            });
            iconWidget.set_style("color: %s;".format(item.iconTint || this.folder_icon_tint));
        } else if (item.type === "document") {
            try {
                iconWidget = new St.Icon({
                    gicon: getDocumentIcon(item.path),
                    icon_size: this.icon_size,
                    style_class: "thelauncher-item-icon"
                });
            } catch (e) {
                iconWidget = new St.Icon({
                    icon_name: "text-x-generic",
                    icon_type: St.IconType.FULLCOLOR,
                    icon_size: this.icon_size,
                    style_class: "thelauncher-item-icon"
                });
            }
        } else if (item.icon) {
            try {
                iconWidget = new St.Icon({
                    gicon: item.icon,
                    icon_size: this.icon_size,
                    style_class: "thelauncher-item-icon"
                });
            } catch (e) {
                iconWidget = new St.Icon({
                    icon_name: "application-x-executable",
                    icon_type: St.IconType.FULLCOLOR,
                    icon_size: this.icon_size,
                    style_class: "thelauncher-item-icon"
                });
            }
        } else {
            iconWidget = new St.Icon({
                icon_name: "application-x-executable",
                icon_type: St.IconType.FULLCOLOR,
                icon_size: this.icon_size,
                style_class: "thelauncher-item-icon"
            });
        }
        return iconWidget;
    },

    _wireItemInteractions: function(actor, item) {
        // AP18-1: Rechtsklick findet ueber diese Markierung das Symbol.
        actor._avincelaunchItem = item;
        if (!item.enabled) {
            const desaturate = new Clutter.DesaturateEffect();
            desaturate.set_factor(1.0);
            actor.add_effect(desaturate);
        }

        actor.connect("notify::hover", (function(hovered) {
            if (!item.enabled) {
                return;
            }
            hovered.set_style(this._itemStyle(item, hovered.hover ? "hover" : null));
        }).bind(this));
        actor.connect("button-press-event", (function(pressed, event) {
            if (!item.enabled || event.get_button() !== Clutter.BUTTON_PRIMARY) {
                return Clutter.EVENT_PROPAGATE;
            }
            pressed.set_style(this._itemStyle(item, "pressed"));
            this._onItemActivated(item, event.get_click_count());
            return Clutter.EVENT_STOP;
        }).bind(this));
        actor.connect("button-release-event", (function(released) {
            if (!item.enabled) {
                return Clutter.EVENT_PROPAGATE;
            }
            released.set_style(this._itemStyle(item, released.hover ? "hover" : null));
            return Clutter.EVENT_PROPAGATE;
        }).bind(this));

        if (this.show_tooltips) {
            const tooltip = new Tooltips.Tooltip(actor, this._tooltipText(item));
            tooltip._tooltip.set_style(
                "background-color: %s; color: %s; padding: 4px 8px; border-radius: 4px;".format(
                    this.tooltip_bg_color,
                    this.tooltip_text_color
                )
            );
            this._itemTooltips.push(tooltip);
        }
    },

    _createItemButton: function(item) {
        const isDisabled = !item.enabled;
        const isList = this._isListLayout();
        let styleClass = isList
            ? "thelauncher-list-item thelauncher-item"
            : "thelauncher-item";
        if (isDisabled) {
            styleClass += " thelauncher-item-disabled";
        }

        // List rows cannot use St.Button — it always centers its child.
        // Use a horizontal BoxLayout so icon + text pack from the left.
        if (isList) {
            const row = new St.BoxLayout({
                vertical: false,
                style_class: styleClass,
                reactive: !isDisabled,
                track_hover: !isDisabled,
                can_focus: !isDisabled,
                x_expand: true,
                y_expand: false,
                style: this._itemStyle(item)
            });

            if (this.icon_size > 0) {
                const iconWidget = this._withPinBadge(this._createItemIcon(item), item);
                iconWidget.x_expand = false;
                iconWidget.y_expand = false;
                iconWidget.set_y_align(Clutter.ActorAlign.CENTER);
                row.add_child(iconWidget);
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
                row.add_child(label);
            }

            this._wireItemInteractions(row, item);
            return row;
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
            vertical: true,
            x_align: this._getTextAlign(),
            y_align: St.Align.START,
            x_expand: false,
            y_expand: false
        });

        if (this.icon_size > 0) {
            inner.add_child(this._withPinBadge(this._createItemIcon(item), item));
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
        this._wireItemInteractions(button, item);
        return button;
    },

    _getTileWidth: function() {
        if (this._isFixedContentFit() && this.max_width > 0) {
            const columns = Math.max(1, Math.round(this.columns));
            const spacing = Math.round(this.col_spacing);
            const padding = this._getDeskletPaddingPx();

            const available =
                this.max_width
                - padding
                - (Math.max(0, columns - 1) * spacing);

            // N24: max-width zaehlt in Bildpunkten, das Symbol logisch.
            return Math.max(
                Math.round((this.icon_size + 12) * this._uiScale()),
                Math.floor(available / columns)
            );
        }

        return BASE_TILE_WIDTH;
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

        // Im festen Fenstermodus gilt die vom Benutzer
        // gewählte Spaltenzahl verbindlich.
        if (this._isFixedContentFit() && this.max_width > 0) {
            return Math.max(1, columns);
        }

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
            const button = this._createItemButton(items[i]);

            if (this._isFixedContentFit() && this.max_width > 0) {
                button.set_width(this._getTileWidth());
            }

            grid.attach(button, col, row, 1, 1);
        }

        return container;
    },

    _buildTileGrid: function(items) {
        return this._buildItemGrid(items, this._computeTileColumns(items.length));
    },

    _buildList: function(items) {
        const list = new St.BoxLayout({
            vertical: true,
            style_class: "thelauncher-list",
            x_expand: true,
            y_expand: false
        });
        list.set_style("spacing: %spx;".format(Math.round(this.row_spacing)));

        for (let i = 0; i < items.length; i++) {
            const button = this._createItemButton(items[i]);
            button.set_x_expand(true);
            button.set_x_align(Clutter.ActorAlign.FILL);
            list.add_child(button);
        }

        return list;
    },

    _buildNavBar: function() {
        if (this._navStack.length <= 1) {
            return null;
        }

        try {
            return this._buildNavBarContent();
        } catch (e) {
            global.logError(e, "aVinceLaunch: failed to build navigation bar");
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
        // N13: Auch eine Meldung bekommt die Maus-Erkennung der Titelzeile -
        // sonst erschienen dort weder Titel noch ☰ noch Einklapp-Pfeil
        // (bisher nur in _buildUI eingerichtet).
        this._ensureHoverWindowTitle();
        const box = new St.BoxLayout({
            vertical: true,
            style_class: "thelauncher-desklet"
        });
        this._addTitleRow(box);
        const label = this._wrapMessageLabel(new St.Label({
            text: message,
            style_class: "thelauncher-empty"
        }));
        box.add_child(label);
        this._applyContainerStyle(box, 1);
        this._setDeskletContent(box, 1);
    },

    // N13 (Schreibtischtest Latitude 12.10.): Meldungen mit Pfad umbrechen
    // statt sie mit "..." abzuschneiden - St.Label kuerzt sonst am Ende, und
    // der Hinweis auf den Dialog war nicht mehr zu lesen.
    // N16 (Tower avltest, 12.10.): nur bei fester Hoehe. Im Modus "auto"
    // bemisst Cinnamon den Akteur ohne Umbruch; der umgebrochene Text war
    // eine Zeile hoeher - unten kein Ziehen, Rechtsklick ging an Cinnamon,
    // der Titel verschwand. Dort bleibt die Meldung einzeilig mit "...".
    _wrapMessageLabel: function(label) {
        if (!this._isFixedContentFit() || !(this.max_height > 0)) {
            return label;
        }
        label.clutter_text.set_line_wrap(true);
        label.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
        return label;
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

    _setDeskletContent: function(contentActor, usedColumns) {
        this._panelBox = contentActor;
        if (usedColumns > 0) {
            this._lastUsedColumns = usedColumns;
        }

        contentActor.x_expand = false;
        contentActor.y_expand = false;
        contentActor.x_align = St.Align.START;

        // Kein Schlosssymbol mehr (AP09d, Angelo 02.10.): es bekam eine eigene
        // Zeile ueber dem Inhalt, der Fence rutschte und aenderte seine Groesse.
        // Der Schluessel show-lock-indicator bleibt im Schema, wirkt aber nicht.
        // Der alte 8-px-Griffstreifen ohne Titelzeile ist weg (AP12-2):
        // ein entsperrter Fence zeigt immer seine Titelzeile als Griff.
        const root = contentActor;

        if (this.max_height > 0 && this._isFixedContentFit()) {
            const scroll = new St.ScrollView({
                style_class: "thelauncher-scroll",
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                enable_mouse_scrolling: true,
                x_expand: false,
                y_expand: false
            });

            scroll.set_policy(
                St.PolicyType.NEVER,
                St.PolicyType.AUTOMATIC
            );

            // Scrollen per Mausrad, sichtbare Scrollleiste ausblenden.
            const vscroll = scroll.get_vscroll_bar();
            if (vscroll) {
                vscroll.hide();
            }

            scroll.set_clip_to_allocation(true);
            scroll.add_actor(root);
            scroll.set_width(this.max_width);
            scroll.set_height(this.max_height);

            this.setContent(this._wrapCollapsed(scroll));
            this._scrollView = scroll;
        } else {
            this.setContent(this._wrapCollapsed(root));
            this._scrollView = null;
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

    _getFenceTitle: function() {
        const eigener = String(this.fence_title || "").trim();
        if (eigener) {
            return eigener;
        }
        return this._getHoverWindowTitle();
    },

    // Ausrichtung ueber CSS. Die Eigenschaft x_align erwartet
    // Clutter.ActorAlign - St.Align hat andere Zahlenwerte und wuerde
    // "Mitte" als "links" auslegen.
    _getTitleTextAlign: function() {
        if (this.title_align === "left") {
            return "left";
        }
        if (this.title_align === "right") {
            return "right";
        }
        return "center";
    },

    _isPointerOver: function(actor) {
        if (!actor || actor.is_finalized() || !actor.visible) {
            return false;
        }
        const [px, py] = global.get_pointer();
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        return px >= x && px < x + w && py >= y && py < y + h;
    },

    _isPointerOverFence: function() {
        return this._isPointerOver(this.actor);
    },

    // AP12-1-Befund (Angelo 05.10.): Titel blieben sporadisch stehen -
    // Cinnamon meldet das Verlassen nicht immer (schnelle Bewegung, Menue,
    // Ziehen). Solange ein Titel zu sehen ist, sieht der Fence darum alle
    // 300 ms selbst nach, ob die Maus noch da ist.
    _startHoverWatch: function() {
        if (this._hoverWatchId) {
            return;
        }
        this._hoverWatchId = Mainloop.timeout_add(300, (function() {
            if (!this.actor || this.actor.is_finalized()) {
                this._hoverWatchId = 0;
                return GLib.SOURCE_REMOVE;
            }
            if ((this._menu && this._menu.isOpen)
                || this._isPointerOverFence()
                || this._isPointerOver(this._titleTab)) {
                return GLib.SOURCE_CONTINUE;
            }
            this._hoverWatchId = 0;
            this._setTitleRowVisible(false);
            this._hideHoverWindowTitle();
            this._scheduleScrollReset();
            this._hideItemTooltips(false);
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    _stopHoverWatch: function() {
        if (this._hoverWatchId) {
            Mainloop.source_remove(this._hoverWatchId);
            this._hoverWatchId = 0;
        }
    },

    _syncHoverAfterMenu: function() {
        if (this._menu && this._menu.isOpen) {
            return;
        }
        if (!this._isPointerOverFence()) {
            this._setTitleRowVisible(false);
            this._hideHoverWindowTitle();
            this._scheduleScrollReset();
        }
    },

    // Aufruf ueber setShowTitleForAllFences. setValue() ruft die eigenen
    // Rueckrufe nicht auf, darum hier selbst neu aufbauen.
    _setShowTitle: function(state) {
        state = !!state;
        if (!!this.show_title === state) {
            return;
        }
        this.settings.setValue("show-title", state);
        this.show_title = state;
        this._onSettingsChanged();
    },

    // --- AP12-3: Suche ---------------------------------------------------
    // Ein kleines Feld ueber dem Fence, als Menue gebaut: Cinnamon gibt
    // einem Menue die Tastatur (pushModal); ein Desklet auf dem
    // Schreibtisch bekommt sie sonst nicht. Esc oder Klick daneben
    // schliesst, dann zeigt der Fence wieder alles.

    _filterItems: function(items) {
        const query = String(this._searchText || "").trim().toLocaleLowerCase();
        if (!query) {
            return items;
        }
        return items.filter(item =>
            String(item.name || "").toLocaleLowerCase().indexOf(query) >= 0);
    },

    _setSearchText: function(text) {
        text = String(text || "");
        // Eingeklappte Fences bleiben zu und werden nicht durchsucht.
        if (this._isCollapsed()) {
            text = "";
        }
        if (text === String(this._searchText || "")) {
            return;
        }
        this._searchText = text;
        this._scheduleSearchRebuild();
    },

    // Sperren aendert nur die Flaeche (Titelzeile, Griffe), nicht den
    // Inhalt: mit dem zuletzt gelesenen Stand neu aufbauen, statt den Ordner
    // neu zu lesen - so geht das auch, waehrend er nicht antwortet. Ohne
    // gelesenen Stand wie bisher.
    _rebuildSurfaceSoon: function() {
        if (!this._lastScanResult) {
            this._scheduleRefresh();
            return;
        }
        if (this._surfaceRebuildId) {
            return;
        }
        this._surfaceRebuildId = Mainloop.idle_add((function() {
            this._surfaceRebuildId = 0;
            this._rebuildFromLastScan();
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    _rebuildFromLastScan: function() {
        if (!this._lastScanResult || !this.actor || this.actor.is_finalized()) {
            return;
        }
        this._resetSurfaceState();
        this._buildUI(this._lastScanResult);
    },

    _scheduleSearchRebuild: function() {
        if (this._searchRebuildId) {
            Mainloop.source_remove(this._searchRebuildId);
        }
        this._searchRebuildId = Mainloop.timeout_add(100, (function() {
            this._searchRebuildId = 0;
            this._rebuildFromLastScan();
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    _ensureSearchMenu: function() {
        if (this._searchMenu) {
            return;
        }
        // Cinnamons PopupMenu nimmt (Quelle, Seite) und kennt nur "unter der
        // Quelle" oder "am unteren Bildschirmrand" (fuer die Leiste) - beides
        // falsch fuer ein Feld ueber dem Fence (Tests 05.10.: oben links,
        // dann ueber der Leiste). Die Lage rechnet darum _searchMenuPosition.
        const menu = new PopupMenu.PopupMenu(this.actor, St.Side.TOP);
        menu._calculatePosition = (function() {
            return this._searchMenuPosition(menu);
        }).bind(this);
        // Klicks gehen durch: Treffer in den Fences lassen sich anklicken
        // (Angelo 05.10.). Was ein Klick ausserhalb tut, regelt
        // menuEventFilter.
        menu.passEvents = true;
        const entry = new St.Entry({
            hint_text: _("Search all fences…"),
            can_focus: true,
            x_expand: true,
            style_class: "avincelaunch-search-entry"
        });
        entry.clutter_text.connect("text-changed", (function() {
            setSearchTextForAllFences(entry.get_text());
        }).bind(this));
        // Enter startet den ersten Treffer, Reihe fuer Reihe.
        entry.clutter_text.connect("activate", (function() {
            const hit = findFirstSearchHit();
            menu.close();
            if (hit) {
                hit.entry.activateItem(hit.item);
            }
        }).bind(this));
        menu.box.add_child(entry);
        // Dezente Umrahmung, damit sich das Feld abhebt (Angelo 05.10.):
        // duenne Linie im Akzentgruen, weicher Schatten.
        menu.actor.add_style_class_name("avincelaunch-search-popup");

        Main.uiGroup.add_actor(menu.actor);
        menu.actor.hide();
        // Eigene Verwaltung: In der gemeinsamen mit dem Kontextmenue
        // wechselte Cinnamon beim Hineinfahren in den Fence zum
        // Kontextmenue - das Suchfeld ging zu, der Filter war weg (Test
        // 05.10.).
        this._searchMenuManager = new PopupMenu.PopupMenuManager(this);
        this._searchMenuManager.addMenu(menu);
        menu.connect("open-state-changed", (function(m, open) {
            if (open) {
                Mainloop.idle_add(function() {
                    entry.grab_key_focus();
                    return GLib.SOURCE_REMOVE;
                });
                return;
            }
            entry.set_text("");
            setSearchTextForAllFences("");
        }).bind(this));

        this._searchMenu = menu;
        this._searchEntry = entry;
    },

    // Mittig ueber dem Fence; ist oben zu wenig Platz, am Bildschirmrand.
    _searchMenuPosition: function(menu) {
        const [, , natWidth, natHeight] = menu.actor.get_preferred_size();
        const [fx, fy] = this.actor.get_transformed_position();
        const [fw] = this.actor.get_transformed_size();
        const monitor = Main.layoutManager.findMonitorForActor(this.actor)
            || Main.layoutManager.primaryMonitor;
        let x = fx + fw / 2 - natWidth / 2;
        x = Math.max(monitor.x, Math.min(x, monitor.x + monitor.width - natWidth));
        // Oben zu wenig Platz (obere Reihe, 50 px): nur so weit nach unten
        // wie noetig, nicht gleich auf die Oberkante (Test 05.10.).
        const y = Math.max(monitor.y, fy - natHeight - 4);
        menu.sideFlipped = false;
        return [Math.round(x), Math.round(y)];
    },

    _openSearch: function() {
        if (this._isCollapsed() || !this.actor || this.actor.is_finalized()) {
            return;
        }
        // Nur ein Suchfeld zur Zeit.
        closeSearchInAllFences();
        this._ensureSearchMenu();
        if (this._menu && this._menu.isOpen) {
            this._menu.close();
        }
        this._searchMenu.open(true);
    },

    _destroySearch: function() {
        if (this._searchRebuildId) {
            Mainloop.source_remove(this._searchRebuildId);
            this._searchRebuildId = 0;
        }
        if (this._searchMenu) {
            this._searchMenu.destroy();
            this._searchMenu = null;
        }
        if (this._searchMenuManager) {
            this._searchMenuManager.destroy();
            this._searchMenuManager = null;
        }
        this._searchEntry = null;
    },

    _buildSearchButton: function() {
        const icon = new St.Icon({
            icon_name: "edit-find-symbolic",
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 14,
            style_class: "thelauncher-title-grip"
        });
        const button = new St.Bin({
            child: icon,
            reactive: true,
            track_hover: true,
            style_class: "avincelaunch-title-menu-button"
        });
        button.set_y_align(Clutter.ActorAlign.CENTER);
        button.connect("button-press-event", function(actor, event) {
            return event.get_button() === 1
                ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        });
        button.connect("button-release-event", (function(actor, event) {
            if (event.get_button() !== 1) {
                return Clutter.EVENT_PROPAGATE;
            }
            this._openSearch();
            return Clutter.EVENT_STOP;
        }).bind(this));
        this._titleButtons = (this._titleButtons || []).concat([button]);
        return button;
    },

    // --- AP12-2: Einklappen ----------------------------------------------

    _isCollapsed: function() {
        return !!this.collapsed;
    },

    _setCollapsed: function(state) {
        state = !!state;
        this._peekOpen = false;
        if (this._isCollapsed() === state) {
            return;
        }
        // N19 (Tower 13.10.): Die Leiste nimmt die Breite des ausgeklappten
        // Fence. Bei Groesse "automatisch" war sie nur nebenbei gemerkt und
        // fehlte oft - die Leiste wurde so schmal wie ihr Inhalt. Darum vor
        // dem Einklappen ausdruecklich messen (_getFrameRect merkt sie sich).
        if (state) {
            this._getFrameRect();
        }
        this.settings.setValue("collapsed", state);
        this.collapsed = state;
        this._onSettingsChanged();
        // N14: Nach dem Neuaufbau ist die neue Titelzeile ("unter der Maus")
        // unsichtbar, bis sich die Maus bewegt - bei schnellem Mehrfachklick
        // fehlten Titel und Pfeil. Darum gleich selbst nachsehen.
        if (this._titleSyncId) {
            Mainloop.source_remove(this._titleSyncId);
        }
        this._titleSyncId = Mainloop.timeout_add(50, (function() {
            this._titleSyncId = 0;
            this._syncTitleRowWithPointer();
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    _syncTitleRowWithPointer: function() {
        if (!this.actor || this.actor.is_finalized()) {
            return;
        }
        if (this._isPointerOverFence()) {
            this._setTitleRowVisible(true);
            this._showHoverWindowTitle();
        } else {
            this._syncHoverAfterMenu();
        }
    },

    // Volle Groesse des Fence, auch wenn er eingeklappt ist.
    _expandedFrameSize: function() {
        if (this._isFixedContentFit() && this.max_width > 0 && this.max_height > 0) {
            return { w: this.max_width, h: this.max_height };
        }
        return this._lastExpandedSize || null;
    },

    // Breite der Leiste: wie der ausgeklappte Fence; nach einem Neustart im
    // eingeklappten Zustand ist er nie ausgeklappt gemessen worden - dann die
    // Breite, die der Fence fuer seinen Inhalt rechnet.
    _collapsedBarWidth: function() {
        const full = this._expandedFrameSize();
        if (full && full.w > 0) {
            return full.w;
        }
        return this._cachedPanelWidth > 0 ? this._cachedPanelWidth : 0;
    },

    // Knopf zum Ein-/Ausklappen; kein Weiterreichen des Drueckens an die
    // Zeile (die wuerde verschieben).
    _buildCollapseButton: function(collapsed) {
        const icon = new St.Icon({
            icon_name: collapsed ? "pan-down-symbolic" : "pan-up-symbolic",
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 14,
            style_class: "thelauncher-title-grip"
        });
        const button = new St.Bin({
            child: icon,
            reactive: true,
            track_hover: true,
            style_class: "avincelaunch-title-menu-button"
        });
        button.set_y_align(Clutter.ActorAlign.CENTER);
        button.connect("button-press-event", function(actor, event) {
            return event.get_button() === 1
                ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        });
        button.connect("button-release-event", (function(actor, event) {
            if (event.get_button() !== 1) {
                return Clutter.EVENT_PROPAGATE;
            }
            this._setCollapsed(!collapsed);
            return Clutter.EVENT_STOP;
        }).bind(this));
        this._titleButtons = (this._titleButtons || []).concat([button]);
        return button;
    },

    // N14: Name in Titelzeile und Leiste - eine Stelle fuer beide.
    _buildTitleLabel: function() {
        const label = new St.Label({
            text: this._getFenceTitle(),
            style_class: "thelauncher-title"
        });
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        label.set_x_expand(true);
        label.set_x_align(Clutter.ActorAlign.FILL);
        label.set_y_align(Clutter.ActorAlign.CENTER);
        label.clutter_text.set_line_alignment(
            this.title_align === "left" ? Pango.Alignment.LEFT
            : this.title_align === "right" ? Pango.Alignment.RIGHT
            : Pango.Alignment.CENTER
        );
        return label;
    },

    // N14: ☰, Name, (Suche), Pfeil - in Titelzeile UND Leiste dieselben
    // Bausteine. Eingeklappt gibt es keine Suche; ihr Knopf bleibt als
    // unsichtbarer Platzhalter, sonst stuende der Name woanders.
    _fillTitleControls: function(container, collapsed) {
        const menuButton = this._buildTitleMenuButton();
        container.add_child(menuButton.button);
        const label = this._buildTitleLabel();
        container.add_child(label);
        if (this.show_search_button) {
            const search = this._buildSearchButton();
            if (collapsed) {
                search.opacity = 0;
                search.reactive = false;
            }
            container.add_child(search);
        }
        const collapse = this._buildCollapseButton(collapsed);
        container.add_child(collapse);
        return { menuButton: menuButton, label: label, collapse: collapse };
    },

    // Leiste eines eingeklappten Fence: Menue, Name, Pfeil. Immer
    // sichtbar, auch bei ausgeschaltetem Titel - sonst faende man den
    // Fence nicht wieder.
    _buildCollapsedBar: function() {
        const bar = new St.BoxLayout({
            vertical: false,
            reactive: true,
            track_hover: true,
            style_class: "avincelaunch-collapsed-bar"
        });
        const colors = this._getTitleTextColors();
        const background = this.transparent_background
            ? "transparent" : this.desklet_bg_color;
        this._collapsedBarBackground = background;
        this._styleCollapsedBar(bar, !!this._peekOpen);

        // N14: gleicher Aufbau wie die Titelzeile, damit ☰, Name und Pfeil
        // beim Ein-/Ausklappen nicht springen.
        const controls = this._fillTitleControls(bar, true);
        controls.menuButton.icon.set_style("color: " + colors.color + "; margin-right: 4px;");
        controls.label.set_style(
            "font-size: 15px; font-weight: bold;" +
            "text-align: " + this._getTitleTextAlign() + ";" +
            "color: " + colors.color + ";" +
            "text-shadow: 0px 1px 2px " + colors.shadow + ";"
        );
        controls.collapse.get_child().set_style("color: " + colors.color + ";");

        // Ziehen verschiebt (nur entsperrt), Doppelklick klappt aus.
        bar.connect("button-press-event", (function(actor, event) {
            if (event.get_button() !== 1) {
                return Clutter.EVENT_PROPAGATE;
            }
            if (event.get_click_count() === 2) {
                this._setCollapsed(false);
                return Clutter.EVENT_STOP;
            }
            this._beginDeskletDrag(event);
            return Clutter.EVENT_STOP;
        }).bind(this));

        const width = this._collapsedBarWidth();
        if (width > 0) {
            bar.set_width(width);
        }
        this._collapsedBar = bar;
        return bar;
    },

    // Kurz aufgeklappt: Leiste unten eckig, Inhalt oben eckig - sonst
    // zeigen die runden Ecken links und rechts einen Spalt (Test 05.10.).
    _styleCollapsedBar: function(bar, joined) {
        bar.set_style(
            "background-color: " + this._collapsedBarBackground + ";" +
            "border-radius: " + (joined ? "8px 8px 0 0" : "8px") + ";" +
            // N14: Abstaende wie die Titelzeile im Fence (Rand des Fence 8 +
            // Zeile 2/4) - der Name bleibt beim Umschalten an seiner Stelle.
            "padding: " + TITLE_BAR_PADDING + ";"
        );
    },

    // Eingeklappt: Leiste oben, der Inhalt bleibt aufgebaut, aber
    // verborgen (beim Ueberfahren kurz zu zeigen, wenn gewuenscht).
    _wrapCollapsed: function(actor) {
        this._collapsedBar = null;
        this._collapsedContent = null;
        if (!this._isCollapsed()) {
            return actor;
        }
        const wrapper = new St.BoxLayout({
            vertical: true,
            x_expand: false,
            y_expand: false
        });
        const bar = this._buildCollapsedBar();
        wrapper.add_child(bar);
        wrapper.add_child(actor);
        if (!this._peekOpen) {
            actor.hide();
        } else if (this._peekHidesBar()) {
            // P3-2: Neuaufbau waehrend des Aufklappens - wie _updateCollapsedPeek.
            bar.hide();
            this._styleCollapsedBar(bar, false);
        }
        this._collapsedContent = actor;
        return wrapper;
    },

    // Beim Ueberfahren aufklappen (Schalter, Standard aus): nur anzeigen,
    // gespeichert bleibt "eingeklappt".
    // P3-2 (Angelo 09.10., Variante B): Gesperrt sieht der aufgeklappte
    // Fence genau aus wie ausgeklappt - die Leiste verschwindet, der Inhalt
    // steht in seinem Rahmen und ragt nicht mehr um die Leistenhoehe unter
    // die Nachbarn. Entsperrt bleibt die Leiste stehen: sie ist beim
    // eingeklappten Fence der Griff zum Verschieben.
    _updateCollapsedPeek: function(open) {
        const content = this._collapsedContent;
        if (!this._isCollapsed() || !this.expand_on_hover
            || !content || content.is_finalized()) {
            return;
        }
        open = !!open;
        if (open === !!this._peekOpen) {
            return;
        }
        this._peekOpen = open;
        const hideBar = open && this._peekHidesBar();
        const bar = this._collapsedBar;
        if (bar && !bar.is_finalized()) {
            if (hideBar) {
                bar.hide();
            } else {
                bar.show();
            }
            this._styleCollapsedBar(bar, open && !hideBar);
        }
        if (open) {
            content.show();
        } else {
            content.hide();
        }
        this._setTabJoined(open && !hideBar);
    },

    _peekHidesBar: function() {
        return isDragLocked(this.lock_position);
    },

    _getTitleMode: function() {
        const mode = String(this.title_mode || "hover");
        return (mode === "always" || mode === "slide") ? mode : "hover";
    },

    // AP12-1: Titelzeile in den Aufbau. Im Modus "slide" steht sie nicht
    // im Fence, sondern als Lasche oben AUF seiner Kante (Angelo 05.10.:
    // gleiche Transparenz wie der Fence, ausserhalb, nicht darin).
    // Titelzeile da? Eingeschaltet - oder entsperrt: Wer entsperrt, will
    // anordnen und braucht einen sichtbaren Griff (AP12-2-Test 05.10.:
    // ohne Titel liess sich ein Fence nicht greifen).
    _showsTitleRow: function() {
        return !!this.show_title || !isDragLocked(this.lock_position);
    },

    _addTitleRow: function(box) {
        // Eingeklappt traegt die Leiste den Namen.
        if (!this._showsTitleRow() || this._isCollapsed()) {
            this._destroyTitleTab();
            return;
        }
        if (this._getTitleMode() === "slide") {
            this._buildTitleTab();
            return;
        }
        this._destroyTitleTab();
        box.add_child(this._buildTitleRow());
    },

    _buildTitleTab: function() {
        this._destroyTitleTab();

        const tab = new St.BoxLayout({
            vertical: false,
            reactive: true,
            track_hover: true,
            visible: false,
            style_class: "avincelaunch-title-tab"
        });

        const menuButton = this._buildTitleMenuButton();
        tab.add_child(menuButton.button);

        const label = new St.Label({
            text: this._getFenceTitle(),
            style_class: "thelauncher-title"
        });
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        label.set_x_expand(true);
        label.set_x_align(Clutter.ActorAlign.FILL);
        label.set_y_align(Clutter.ActorAlign.CENTER);
        label.clutter_text.set_line_alignment(
            this.title_align === "left" ? Pango.Alignment.LEFT
            : this.title_align === "right" ? Pango.Alignment.RIGHT
            : Pango.Alignment.CENTER
        );
        tab.add_child(label);
        if (this.show_search_button) {
            tab.add_child(this._buildSearchButton());
        }
        tab.add_child(this._buildCollapseButton(false));

        // Wie an der Titelzeile: Ziehen verschiebt (nur entsperrt),
        // Rechtsklick oeffnet das Menue des Fence.
        tab.connect("button-press-event", (function(actor, event) {
            if (event.get_button() !== 1) {
                return Clutter.EVENT_PROPAGATE;
            }
            this._beginDeskletDrag(event);
            return Clutter.EVENT_STOP;
        }).bind(this));
        tab.connect("button-release-event", (function(actor, event) {
            if (event.get_button() !== 3 || !this._menu) {
                return Clutter.EVENT_PROPAGATE;
            }
            this._anchorMenuAtPointer(event);
            if (!this._menu.isOpen) {
                this._prepareItemSection(null);
                this._prepareContextMenu();
            }
            this._menu.toggle();
            return Clutter.EVENT_STOP;
        }).bind(this));
        tab.connect("notify::hover", this._scheduleTitleTabCheck.bind(this));
        // P3-2: Weicht die echte Hoehe nach dem Zeigen doch ab, die Unterkante
        // wieder auf die Oberkante des Fence setzen.
        tab.connect("notify::height", this._queueTitleTabAlign.bind(this));

        Main.uiGroup.add_child(tab);

        // Wandert der Fence (Ziehen, Ausrichten), wandert die Lasche mit.
        const follow = (function() {
            if (this._titleTab && this._titleTab.visible) {
                this._showTitleTab();
            }
        }).bind(this);
        this._titleTabFollowIds = [
            this.actor.connect("notify::x", follow),
            this.actor.connect("notify::y", follow),
            this.actor.connect("notify::width", follow)
        ];
        this._titleTab = tab;
        this._titleTabLabel = label;
        this._titleTabIcon = menuButton.icon;
    },

    _setTabJoined: function(joined) {
        const box = this._panelBox;
        if (!box || box.is_finalized()) {
            return;
        }
        if (joined) {
            box.add_style_class_name("avincelaunch-tab-joined");
        } else {
            box.remove_style_class_name("avincelaunch-tab-joined");
        }
    },

    // P3-2: erst nach der Zuteilung verschieben (notify::height kommt mitten
    // im Layout; dort keine neue Lage setzen).
    _queueTitleTabAlign: function() {
        if (this._titleTabAlignId) {
            return;
        }
        this._titleTabAlignId = Mainloop.idle_add((function() {
            this._titleTabAlignId = 0;
            const tab = this._titleTab;
            if (!tab || tab.is_finalized() || !tab.visible
                || !this.actor || this.actor.is_finalized()) {
                return false;
            }
            const [, y] = this.actor.get_transformed_position();
            const want = Math.round(y - tab.height);
            if (Math.round(tab.y) !== want) {
                tab.set_y(want);
            }
            return false;
        }).bind(this));
    },

    _destroyTitleTab: function() {
        this._setTabJoined(false);
        if (this._titleTabCheckId) {
            Mainloop.source_remove(this._titleTabCheckId);
            this._titleTabCheckId = 0;
        }
        if (this._titleTabAlignId) {
            Mainloop.source_remove(this._titleTabAlignId);
            this._titleTabAlignId = 0;
        }
        if (this._titleTabFollowIds) {
            this._titleTabFollowIds.forEach(id => {
                try {
                    this.actor.disconnect(id);
                } catch (e) {
                    // Fence schon abgebaut.
                }
            });
            this._titleTabFollowIds = null;
        }
        if (this._titleTab) {
            try {
                this._titleTab.destroy();
            } catch (e) {
                // Schon abgebaut.
            }
        }
        this._titleTab = null;
        this._titleTabLabel = null;
        this._titleTabIcon = null;
    },

    _showTitleTab: function() {
        const tab = this._titleTab;
        if (!tab || tab.is_finalized() || !this.actor || this.actor.is_finalized()) {
            return;
        }
        const colors = this._getTitleTextColors();
        const background = this.transparent_background
            ? "transparent" : this.desklet_bg_color;
        tab.set_style(
            "background-color: " + background + ";" +
            "border-radius: 8px 8px 0 0;" +
            "padding: 4px 6px 7px 4px;"
        );
        this._titleTabLabel.set_style(
            "font-size: 15px; font-weight: bold;" +
            "text-align: " + this._getTitleTextAlign() + ";" +
            "color: " + colors.color + ";" +
            "text-shadow: 0px 1px 2px " + colors.shadow + ";"
        );
        this._titleTabIcon.set_style("color: " + colors.color + "; margin-right: 4px;");

        const [x, y] = this.actor.get_transformed_position();
        const [w] = this.actor.get_transformed_size();
        tab.set_width(Math.round(w));
        // P3-2 (K11 09.10.): erst zeigen, dann messen. Beim Zeigen wendet St
        // die eben gesetzten Stile auf die Lasche UND ihre Teile an (Beschriftung,
        // Knoepfe); verborgen misst sie beim ersten Mal mit dem alten Stil und
        // sitzt nicht buendig (X11 2 px zu tief, Wayland 5 px Spalt).
        // ensure_style() allein erreicht die verborgenen Teile nicht (Test 21:33).
        // Gezeichnet wird erst nach diesem Aufruf - kein Bild an falscher Stelle.
        tab.show();
        const height = tab.get_preferred_height(Math.round(w))[1];
        tab.set_position(Math.round(x), Math.round(y - height));
        // Oben eckig, solange die Lasche steht: sonst zeigen die runden
        // Ecken des Fence links und rechts einen Spalt (Test 05.10.).
        this._setTabJoined(true);
        try {
            Main.uiGroup.set_child_above_sibling(tab, null);
        } catch (e) {
            // Lage stimmt auch ohne Anheben.
        }
    },

    // Die Lasche liegt ausserhalb des Fence: Verlaesst die Maus den Fence
    // nach oben, steht sie auf der Lasche. Erst kurz warten, dann
    // entscheiden, ob sie noch auf einem von beiden ist.
    _scheduleTitleTabCheck: function() {
        if (this._titleTabCheckId) {
            Mainloop.source_remove(this._titleTabCheckId);
        }
        this._titleTabCheckId = Mainloop.timeout_add(150, (function() {
            this._titleTabCheckId = 0;
            const tab = this._titleTab;
            if (!tab || tab.is_finalized()) {
                return GLib.SOURCE_REMOVE;
            }
            if ((this._menu && this._menu.isOpen)
                || this._isPointerOverFence()
                || this._isPointerOver(tab)) {
                this._showTitleTab();
            } else {
                tab.hide();
                this._setTabJoined(false);
            }
            return GLib.SOURCE_REMOVE;
        }).bind(this));
    },

    // AP12-1-Befund (Angelo 05.10.): Die Titelfarbe kam aus einer
    // Helligkeitsmessung ueber dem Fence - ueber dem hellen Mint-Logo wurde
    // ein Titel dunkel, alle anderen hell. Jetzt gilt die Titelfarbe der
    // Farbvorlage, wie bei der Beschriftung der Symbole; der Schatten
    // richtet sich nach ihr.
    _getTitleTextColors: function() {
        const color = String(this.title_color || "rgb(255,255,255)");
        const parts = color.match(/[\d.]+/g) || [];
        const r = parseFloat(parts[0] || 255);
        const g = parseFloat(parts[1] || 255);
        const b = parseFloat(parts[2] || 255);
        const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
        return {
            color: color,
            shadow: light ? "rgba(0,0,0,1.0)" : "rgba(255,255,255,0.9)"
        };
    },

    // AP12-1: Knopf links in der Titelzeile oeffnet das Kontextmenue,
    // auch bei gesperrtem Fence (Windows-Vorbild, Wunsch 01.10.).
    _buildTitleMenuButton: function() {
        const icon = new St.Icon({
            icon_name: "open-menu-symbolic",
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 14,
            style_class: "thelauncher-title-grip"
        });
        const button = new St.Bin({
            child: icon,
            reactive: true,
            track_hover: true,
            style_class: "avincelaunch-title-menu-button"
        });
        button.set_y_align(Clutter.ActorAlign.CENTER);
        // Druecken nicht an die Zeile weitergeben - die wuerde sonst das
        // Verschieben beginnen.
        button.connect("button-press-event", function(actor, event) {
            return event.get_button() === 1
                ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        });
        button.connect("button-release-event", (function(actor, event) {
            if (event.get_button() !== 1 || !this._menu) {
                return Clutter.EVENT_PROPAGATE;
            }
            this._anchorMenuAtPointer(event);
            if (!this._menu.isOpen) {
                this._prepareItemSection(null);
                this._prepareContextMenu();
            }
            this._menu.toggle();
            return Clutter.EVENT_STOP;
        }).bind(this));
        this._titleMenuButton = button;
        return { button: button, icon: icon };
    },

    // Titelzeile im Fence. Die Helligkeit des Hintergrunds wird erst gemessen,
    // wenn die Zeile auf dem Bildschirm liegt - vorher steht ihre Position
    // noch nicht fest. Siehe _updateTitleContrast().
    _buildTitleRow: function() {
        const row = new St.BoxLayout({
            vertical: false,
            style_class: "thelauncher-title-row",
            x_expand: true,
            y_expand: false,
            reactive: true,
            track_hover: false
        });

        // Ziehen am Titel verschiebt den Fence, wie an der Pfadzeile.
        // Die rechte Maustaste wird durchgelassen, damit das Kontextmenue
        // von Cinnamon weiterhin aufgeht.
        row.connect("button-press-event", (function(actor, event) {
            if (event.get_button() !== 1) {
                return Clutter.EVENT_PROPAGATE;
            }
            this._beginDeskletDrag(event);
            return Clutter.EVENT_STOP;
        }).bind(this));

        // Bis AP12 standen hier die drei Balken als Ziehgriff, nur entsperrt.
        // Jetzt sind sie der Menue-Knopf und immer da (Angelo 05.10.).
        // Verschieben geht weiter durch Ziehen an der Zeile.
        const controls = this._fillTitleControls(row, false);
        this._titleGrip = controls.menuButton.icon;
        this._titleLabel = controls.label;
        this._titleRow = row;

        // "hover": im Ruhezustand unsichtbar, die Zeile behaelt ihre Hoehe,
        // damit der Inhalt beim Ueberfahren nicht springt.
        // "always": immer sichtbar. ("slide" baut keine Zeile, sondern die
        // Lasche, siehe _buildTitleTab.)
        row.opacity = this._getTitleMode() === "always" ? 255 : 0;
        return row;
    },

    // Farbe des Titels anhand der Hintergrundhelligkeit hinter der Zeile.
    _updateTitleContrast: function() {
        if (!this._titleLabel || !this._isLiveActor(this._titleLabel)) {
            return;
        }

        // Farbe aus der Farbvorlage (AP12-1, Angelo 05.10.: alle Titel gleich).
        // Kein eigener Streifen hinter dem Titel - ausdruecklich so gewuenscht.
        const colors = this._getTitleTextColors();
        const color = colors.color;
        const shadow = colors.shadow;

        if (this._titleGrip && !this._titleGrip.is_finalized()) {
            this._titleGrip.set_style("color: " + color + "; margin-right: 4px;");
        }

        this._titleLabel.set_style(
            "font-size: 15px; font-weight: bold;" +
            "text-align: " + this._getTitleTextAlign() + ";" +
            "color: " + color + ";" +
            "text-shadow: 0px 1px 2px " + shadow + ";"
        );

    },

    _getHoverWindowTitle: function() {
        if (this._isPortal()) {
            const portal = this._getPortalPath();
            return portal ? GLib.path_get_basename(portal) : _("Folder portal");
        }
        // Pruefung Phase 2, B7 (P42): keine fest eingebaute Namenstabelle
        // mehr (das waren persoenliche Gruppen). Eigener Name steht in
        // "fence-title" (_getFenceTitle); sonst der Ordnername mit
        // Leerzeichen statt "_" - gleiche Regel wie default_title in
        // scripts/avincelaunch_rules.py.
        const folder = String(this.subdirectory || "").trim();
        return folder ? folder.replace(/_/g, " ") : "aVinceLaunch";
    },


    _showHoverWindowTitle: function() {
        if (!this._hoverWindowTitleLabel) {
            return;
        }

        // Bei sichtbarer Titelzeile waere der schwebende Titel doppelt;
        // eingeklappt traegt die Leiste den Namen.
        if (this._showsTitleRow() || this._isCollapsed()) {
            this._hideHoverWindowTitle();
            return;
        }

        try {
            const title = this._getFenceTitle();

            this._hoverWindowTitleLabel.set_text(title);

            const position =
                this.actor.get_transformed_position();

            const size =
                this.actor.get_transformed_size();

            const x = position[0];
            const y = position[1];

            const width = size[0];

            // Farbe aus der Farbvorlage wie bei allen Titeln (AP12-1).
            const colors = this._getTitleTextColors();
            const color = colors.color;
            const shadow = colors.shadow;

            this._hoverWindowTitleLabel.set_style(
                "background-color: transparent;" +
                "border: none;" +
                "padding: 0px 4px;" +
                "font-size: 15px;" +
                "font-weight: bold;" +
                "color: " + color + ";" +
                "text-shadow: 0px 1px 2px " + shadow + ";"
            );

            this._hoverWindowTitleLabel.show();
            this._startHoverWatch();

            const preferred =
                this._hoverWindowTitleLabel
                    .get_preferred_width(-1);

            const naturalWidth = preferred[1];

            const preferredHeight =
                this._hoverWindowTitleLabel
                    .get_preferred_height(-1);

            const naturalHeight =
                preferredHeight[1];

            const titleX = Math.round(
                x + (width - naturalWidth) / 2
            );

            // N26: Abstand zur Kante waechst mit der Skalierung (die Schrift
            // auch); die Startaufstellung laesst senkrecht Platz dafuer.
            const titleY = Math.max(
                2,
                Math.round(
                    y - naturalHeight - 7 * this._uiScale()
                )
            );

            this._hoverWindowTitleLabel.set_position(
                titleX,
                titleY
            );

            try {
                Main.uiGroup.set_child_above_sibling(
                    this._hoverWindowTitleLabel,
                    null
                );
            } catch (e) {
                // Position funktioniert auch ohne raise.
            }

        } catch (e) {
            global.logError(
                e,
                "aVinceLaunch: Hover-Titel konnte nicht angezeigt werden"
            );
        }
    },

    _hideHoverWindowTitle: function() {
        if (this._hoverWindowTitleLabel) {
            this._hoverWindowTitleLabel.hide();
        }
    },

    // Titelzeile ein- und ausblenden. Die Zeile bleibt im Aufbau stehen,
    // nur ihre Sichtbarkeit wechselt - so springt der Inhalt nicht.
    // AP12-1: "always" bleibt immer sichtbar; bei "slide" erscheint die
    // Lasche ueber dem Fence.
    _setTitleRowVisible: function(sichtbar) {
        if (sichtbar) {
            this._startHoverWatch();
        }
        this._updateCollapsedPeek(sichtbar);
        if (this._titleTab) {
            if (sichtbar) {
                this._showTitleTab();
            } else {
                this._scheduleTitleTabCheck();
            }
            return;
        }
        if (!this._titleRow || this._titleRow.is_finalized()) {
            return;
        }
        if (this._getTitleMode() === "always") {
            this._titleRow.opacity = 255;
            return;
        }
        this._titleRow.opacity = sichtbar ? 255 : 0;
    },

    _ensureHoverWindowTitle: function() {
        if (this._hoverWindowTitleLabel) {
            return;
        }

        try {
            this._hoverWindowTitleLabel = new St.Label({
                text: "",
                reactive: false,
                visible: false
            });

            Main.uiGroup.add_child(
                this._hoverWindowTitleLabel
            );

            /*
             * Wichtig:
             * Das komplette Desklet wird reaktiv und track_hover
             * berücksichtigt auch die darunterliegenden Programmkacheln.
             */
            this.actor.reactive = true;
            this.actor.track_hover = true;

            this._hoverWindowTitleHoverId =
                this.actor.connect(
                    "notify::hover",
                    (function() {
                        if (this.actor.hover) {
                            this._setTitleRowVisible(true);
                            this._showHoverWindowTitle();
                            this._cancelScrollReset();
                        } else {
                            this._setTitleRowVisible(false);
                            this._hideHoverWindowTitle();
                            this._scheduleScrollReset();
                            this._hideItemTooltips(false);
                        }
                    }).bind(this)
                );

            /*
             * Zusätzliche Absicherung:
             * Beim Eintritt in das Fenster den Titel sofort anzeigen.
             */
            this._hoverWindowTitleEnterId =
                this.actor.connect(
                    "enter-event",
                    (function() {
                        this._setTitleRowVisible(true);
                        this._showHoverWindowTitle();
                        return Clutter.EVENT_PROPAGATE;
                    }).bind(this)
                );

            /*
             * Verlassen nur auswerten, wenn sich der Zeiger
             * wirklich außerhalb des gesamten Desklets befindet.
             */
            this._hoverWindowTitleLeaveId =
                this.actor.connect(
                    "leave-event",
                    (function() {
                        Mainloop.idle_add(
                            (function() {
                                if (
                                    this.actor &&
                                    !this.actor.is_finalized() &&
                                    !this.actor.hover
                                ) {
                                    this._setTitleRowVisible(false);
                                    this._hideHoverWindowTitle();
                                }

                                return GLib.SOURCE_REMOVE;
                            }).bind(this)
                        );

                        return Clutter.EVENT_PROPAGATE;
                    }).bind(this)
                );

            this.actor.connect(
                "destroy",
                (function() {
                    if (this._hoverWindowTitleLabel) {
                        try {
                            this._hoverWindowTitleLabel.destroy();
                        } catch (e) {
                        }

                        this._hoverWindowTitleLabel = null;
                    }
                }).bind(this)
            );

        } catch (e) {
            global.logError(
                e,
                "aVinceLaunch: Hover-Titel konnte nicht initialisiert werden"
            );
        }
    },

    _buildUI: function(scanResult) {
        this._ensureHoverWindowTitle();

        const box = new St.BoxLayout({
            vertical: true,
            x_expand: false,
            y_expand: false,
            x_align: St.Align.START,
            style_class: "thelauncher-desklet"
        });
        // AP12-3: Suche filtert die schon eingelesene Liste.
        this._lastScanResult = scanResult;
        const allItems = scanResult.items || [];
        const items = this._filterItems(allItems);
        const usedColumns = this._isListLayout()
            ? 1
            : this._computeTileColumns(items.length);
        this._cachedPanelWidth = 0;

        this._addTitleRow(box);

        const navBar = this._buildNavBar();
        if (navBar) {
            box.add_child(navBar);
        }

        // V4d: Link-Ordner im Netz melden "nicht erreichbar" wie das Portal;
        // keine Antwort (Zeitgrenze) meldet jeder Fence so.
        if (scanResult.error === "missing" || scanResult.error === "timeout"
            || ((this._isPortal() || this._linkIsNetwork) && scanResult.error === "unreadable")) {
            const empty = new St.Label({
                text: !this._isPortal() && scanResult.error === "missing" ? _("Link directory not found.")
                    : scanResult.error !== "unreadable" ? _("Folder not reachable.")
                    : _("Folder cannot be read."),
                style_class: "thelauncher-empty"
            });
            box.add_child(empty);
            this._applyContainerStyle(box, usedColumns);
            this._setDeskletContent(box, usedColumns);
            return;
        }

        if (items.length === 0) {
            const empty = this._wrapMessageLabel(new St.Label({
                text: allItems.length > 0 ? _("No matches.")
                    : this._isPortal()
                    ? _("This folder is empty.")
                    : _("No launchers yet. Add applications, documents, or folders to:\n%s").format(this._getCurrentPath()),
                style_class: "thelauncher-empty"
            }));
            box.add_child(empty);
            this._applyContainerStyle(box, usedColumns);
            this._setDeskletContent(box, usedColumns);
            return;
        }

        const content = this._isListLayout()
            ? this._buildList(items)
            : this._buildItemGrid(items, usedColumns);
        box.add_child(content);

        if (this._isPortal() && scanResult.truncated > 0) {
            box.add_child(this._buildPortalMoreHint(scanResult.truncated));
        }

        // Zusätzlicher echter Abstand am Ende des Scroll-Inhalts.
        // Dadurch bleibt die Beschriftung der letzten Reihe vollständig sichtbar.
        if (this._isFixedContentFit() && this.max_height > 0) {
            const bottomSpacer = new St.Widget({
                height: 28,
                x_expand: false,
                y_expand: false
            });
            box.add_child(bottomSpacer);
        }

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
