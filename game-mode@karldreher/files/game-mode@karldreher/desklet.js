const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const ByteArray = imports.byteArray;
const Tooltips = imports.ui.tooltips;
const Main = imports.ui.main;

/** @constant {string} */
const UUID = "game-mode@karldreher";

/** @constant {number} Game mode screensaver idle-delay in seconds (6 hours) */
const GAME_MODE_DELAY = 21600;

/** @constant {string} Path to the JSON file that persists prior settings */
const STATE_FILE = GLib.get_user_config_dir() + "/game-mode-state.json";

/** @constant {number} Icon size in pixels */
const ICON_SIZE = 48;

/** @constant {number} Circular container diameter in pixels */
const CONTAINER_SIZE = 80;

/**
 * Test whether an exception is a GLib "file not found" error.
 * Guards against non-GError exceptions (such as the SyntaxError from
 * JSON.parse), which have no matches() method.
 *
 * @param {*} e - Caught exception
 * @returns {boolean} True if e is a Gio NOT_FOUND error
 */
function isNotFound(e) {
    return e instanceof GLib.Error
        && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND);
}

/**
 * A circular toggle desklet that enables/disables "game mode".
 * When active the desklet shows a green background and applies:
 *   - Screensaver idle-delay set to 6 hours
 *   - Desktop notifications disabled
 *   - Automatic suspend/sleep disabled (AC and battery)
 *   - Screen dimming disabled (AC and battery)
 *   - Display sleep disabled (AC and battery)
 * When inactive, all prior values are restored.
 *
 * @class
 * @extends Desklet.Desklet
 * @param {Object} metadata - Desklet metadata from metadata.json
 * @param {number} desklet_id - Unique instance ID assigned by Cinnamon
 */
function GameModeDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

GameModeDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    /**
     * Initialise the desklet, create settings interfaces for session,
     * notifications, and power, detect prior active state by reading the
     * persisted state file, and build the UI.
     *
     * @param {Object} metadata - Desklet metadata from metadata.json
     * @param {number} desklet_id - Unique instance ID assigned by Cinnamon
     */
    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        /** @type {Gio.Settings} Session idle-delay */
        this._sessionSettings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.session" });

        /** @type {Gio.Settings} Desktop notifications */
        this._notifSettings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.notifications" });

        /** @type {Gio.Settings} Power management (suspend, dimming, display sleep) */
        this._powerSettings = new Gio.Settings({ schema_id: "org.cinnamon.settings-daemon.plugins.power" });

        /** @type {boolean} A readable state file means game mode is on */
        this._gameModeActive = this._loadState() !== null;

        this.setupUI();
    },

    /**
     * Build the desklet UI: a circular container with a symbolic game
     * controller icon and a hover tooltip.
     */
    setupUI: function() {
        /** @type {St.Icon} */
        this._icon = new St.Icon({
            icon_name: "input-gaming-symbolic",
            icon_type: St.IconType.SYMBOLIC,
            icon_size: ICON_SIZE,
            style: "color: black;"
        });

        /** @type {St.Bin} */
        this._container = new St.Bin({
            child: this._icon,
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE
        });

        this._updateVisual();
        this.setContent(this._container);

        /** @type {Tooltips.PanelItemTooltip} */
        this._tooltip = new Tooltips.PanelItemTooltip(this, "", St.Side.BOTTOM);
        this._updateTooltip();
    },

    /**
     * Update the container's inline style to reflect the current
     * game-mode state (green when active, grey when inactive).
     */
    _updateVisual: function() {
        let bgColor = this._gameModeActive ? "#4CAF50" : "#888888";
        this._container.set_style(
            "border-radius: 999px; " +
            "border: 3px solid silver; " +
            "width: " + CONTAINER_SIZE + "px; " +
            "height: " + CONTAINER_SIZE + "px; " +
            "background-color: " + bgColor + ";"
        );
    },

    /**
     * Update the hover tooltip text to show the current state.
     */
    _updateTooltip: function() {
        let text = this._gameModeActive ? "Game Mode: ON" : "Game Mode: OFF";
        this._tooltip.set_text(text);
    },

    /**
     * Display a transient popup label above the desklet that fades
     * out over one second and then removes itself.
     *
     * @param {string} text - Message to display in the popup
     */
    _showPopup: function(text) {
        let label = new St.Label({
            text: text,
            style: "font-size: 14px; font-weight: bold; color: white; " +
                   "background-color: rgba(0, 0, 0, 0.75); " +
                   "border-radius: 8px; padding: 6px 12px;"
        });

        Main.uiGroup.add_actor(label);

        let [cx, cy] = this._container.get_transformed_position();
        let [cw, ch] = this._container.get_transformed_size();
        label.set_position(
            Math.round(cx + cw / 2 - label.width / 2),
            Math.round(cy - label.height - 8)
        );

        label.ease({
            opacity: 0,
            // Fade out over 1 second, then stay hidden for 2 more seconds before cleanup
            duration: 3000,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: function() {
                Main.uiGroup.remove_actor(label);
                label.destroy();
            }
        });
    },

    /**
     * Read the previously saved settings from the JSON state file.
     *
     * @returns {Object|null} The saved settings object, or null if the
     *     file is missing, unreadable, or contains invalid data
     */
    _loadState: async function() {
        try {
            let file = Gio.file_new_for_path(STATE_FILE);
            let [success, contents] = await file.load_contents_async(null);
            if (success) {
                let state = JSON.parse(ByteArray.toString(contents));
                if (state && typeof state === "object") {
                    return state;
                }
            }
        } catch (e) {
            // A missing state file is the normal "game mode off" case.
            if (!isNotFound(e))
                global.logWarning(UUID + ": failed to read state file: " + e.message);
        }
        return null;
    },

    /**
     * Persist the current settings to the JSON state file so they
     * can be restored when game mode is disabled.
     *
     * @param {Object} state - Settings snapshot to save
     * @param {number} state.idleDelay - Screensaver idle-delay (seconds)
     * @param {boolean} state.displayNotifications - Notifications enabled
     * @param {number} state.sleepInactiveAcTimeout - AC suspend timeout (seconds)
     * @param {number} state.sleepInactiveBatteryTimeout - Battery suspend timeout (seconds)
     * @param {boolean} state.idleDimAc - AC screen dimming enabled
     * @param {boolean} state.idleDimBattery - Battery screen dimming enabled
     * @param {number} state.sleepDisplayAc - AC display sleep timeout (seconds)
     * @param {number} state.sleepDisplayBattery - Battery display sleep timeout (seconds)
     */
    _saveState: function(state) {
        try {
            GLib.file_set_contents(STATE_FILE, JSON.stringify(state));
        } catch (e) {
            global.logError(UUID + ": failed to save state file: " + e.message);
        }
    },

    /**
     * Delete the state file. An already-absent file is the expected
     * outcome and is not reported.
     */
    _clearState: function() {
        try {
            Gio.file_new_for_path(STATE_FILE).delete(null);
        } catch (e) {
            if (!isNotFound(e))
                global.logWarning(UUID + ": failed to clear state file: " + e.message);
        }
    },

    /**
     * Capture the current values of all managed settings into a
     * state snapshot object.
     *
     * @returns {Object} Current settings snapshot
     */
    _captureCurrentState: function() {
        return {
            idleDelay:                   this._sessionSettings.get_uint("idle-delay"),
            displayNotifications:        this._notifSettings.get_boolean("display-notifications"),
            sleepInactiveAcTimeout:      this._powerSettings.get_int("sleep-inactive-ac-timeout"),
            sleepInactiveBatteryTimeout: this._powerSettings.get_int("sleep-inactive-battery-timeout"),
            idleDimAc:                   this._powerSettings.get_boolean("idle-dim-ac"),
            idleDimBattery:              this._powerSettings.get_boolean("idle-dim-battery"),
            sleepDisplayAc:              this._powerSettings.get_int("sleep-display-ac"),
            sleepDisplayBattery:         this._powerSettings.get_int("sleep-display-battery")
        };
    },

    /**
     * Apply the game-mode overrides to all managed settings:
     * long screensaver delay, no notifications, no suspend, no
     * dimming, and no display sleep.
     */
    _applyGameModeSettings: function() {
        this._sessionSettings.set_uint("idle-delay", GAME_MODE_DELAY);
        this._notifSettings.set_boolean("display-notifications", false);
        this._powerSettings.set_int("sleep-inactive-ac-timeout", 0);
        this._powerSettings.set_int("sleep-inactive-battery-timeout", 0);
        this._powerSettings.set_boolean("idle-dim-ac", false);
        this._powerSettings.set_boolean("idle-dim-battery", false);
        this._powerSettings.set_int("sleep-display-ac", 0);
        this._powerSettings.set_int("sleep-display-battery", 0);
    },

    /**
     * Restore all managed settings from a previously saved state
     * snapshot. Each key is checked individually so a partially
     * corrupt file still restores what it can.
     *
     * @param {Object} state - Settings snapshot from {@link _loadState}
     */
    _restoreSettings: function(state) {
        if (typeof state.idleDelay === "number")
            this._sessionSettings.set_uint("idle-delay", state.idleDelay);
        if (typeof state.displayNotifications === "boolean")
            this._notifSettings.set_boolean("display-notifications", state.displayNotifications);
        if (typeof state.sleepInactiveAcTimeout === "number")
            this._powerSettings.set_int("sleep-inactive-ac-timeout", state.sleepInactiveAcTimeout);
        if (typeof state.sleepInactiveBatteryTimeout === "number")
            this._powerSettings.set_int("sleep-inactive-battery-timeout", state.sleepInactiveBatteryTimeout);
        if (typeof state.idleDimAc === "boolean")
            this._powerSettings.set_boolean("idle-dim-ac", state.idleDimAc);
        if (typeof state.idleDimBattery === "boolean")
            this._powerSettings.set_boolean("idle-dim-battery", state.idleDimBattery);
        if (typeof state.sleepDisplayAc === "number")
            this._powerSettings.set_int("sleep-display-ac", state.sleepDisplayAc);
        if (typeof state.sleepDisplayBattery === "number")
            this._powerSettings.set_int("sleep-display-battery", state.sleepDisplayBattery);
    },

    /**
     * Activate game mode: snapshot current settings, save them to
     * disk, apply game-mode overrides, update the UI, and show a popup.
     */
    _enableGameMode: function() {
        let state = this._captureCurrentState();
        this._saveState(state);
        this._applyGameModeSettings();
        this._gameModeActive = true;
        this._updateVisual();
        this._updateTooltip();
        this._showPopup("Game Mode ON");
    },

    /**
     * Deactivate game mode: restore saved settings from disk, remove
     * the state file, update the UI, and show a popup.
     */
    _disableGameMode: function() {
        let state = this._loadState();
        if (state !== null) {
            this._restoreSettings(state);
        } else {
            global.logWarning(UUID + ": no saved state found, leaving current settings unchanged");
        }
        this._clearState();
        this._gameModeActive = false;
        this._updateVisual();
        this._updateTooltip();
        this._showPopup("Game Mode OFF");
    },

    /**
     * Handle left-click on the desklet by toggling game mode.
     *
     * @param {Clutter.Event} event - The click event
     */
    on_desklet_clicked: function(event) {
        if (this._gameModeActive) {
            this._disableGameMode();
        } else {
            this._enableGameMode();
        }
    },

    /**
     * Called when the desklet is removed from the desktop. If game
     * mode is active, all original settings are restored first.
     */
    on_desklet_removed: function() {
        if (this._gameModeActive) {
            this._disableGameMode();
        }
    }
};

/**
 * Entry point called by Cinnamon to instantiate the desklet.
 *
 * @param {Object} metadata - Desklet metadata from metadata.json
 * @param {number} desklet_id - Unique instance ID assigned by Cinnamon
 * @returns {GameModeDesklet} The desklet instance
 */
function main(metadata, desklet_id) {
    return new GameModeDesklet(metadata, desklet_id);
}
