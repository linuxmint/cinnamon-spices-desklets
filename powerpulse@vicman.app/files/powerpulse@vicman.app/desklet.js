/**
 * PowerPulse Desklet — thin orchestrator.
 * Logic lives in providers/, models/, ui/, utils/, animations/.
 */

const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const Gettext = imports.gettext;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

const { ProviderRegistry } = require("./providers/registry");
const { UpowerProvider } = require("./providers/upowerProvider");
const { HeadsetControlProvider } = require("./providers/headsetControlProvider");
const {
    DeviceType,
    SortMode,
    friendlyName,
    sortDevices,
    markFreshness,
    buildStats,
    shouldSkipUpowerHeadset
} = require("./models/device");
const {
    formatPercent,
    formatDurationSeconds,
    formatClockTime,
    buildClipboardSummary
} = require("./utils/formatter");
const { DeviceCard } = require("./ui/deviceCard");
const { SummaryPanel } = require("./ui/summaryPanel");

const UUID = "powerpulse@vicman.app";
const VERSION = "1.2.0";
Gettext.bindtextdomain(UUID, GLib.build_filenamev([GLib.get_home_dir(), ".local", "share", "locale"]));

class PowerPulseDesklet extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);
        this.metadata = metadata;
        this._updateTimeoutId = 0;
        this._softRefreshId = 0;
        this._refreshing = false;
        this._destroyed = false;
        this._devices = [];
        this._cards = {};
        this._notifiedLow = {};
        this._lastFullRefreshAt = 0;
        this._clipboard = St.Clipboard.get_default();
        this._headsetProvider = null;

        this._bindSettings();
        this._buildUi();
        this._buildContextMenu();
        this._initProviders();

        this.setHeader(this.custom_title || "PowerPulse");
        this._updateHeader();
        this._queueRefresh(true);
    }

    _bindSettings() {
        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, this.instance_id);
        const rebind = () => this._onSettingsChanged();

        this.settings.bind("update-interval", "update_interval", rebind);
        this.settings.bind("custom-title", "custom_title", () => this._updateHeader());
        this.settings.bind("compact-mode", "compact_mode", rebind);
        this.settings.bind("sort-by", "sort_by", rebind);
        this.settings.bind("manual-order", "manual_order", rebind);
        this.settings.bind("show-laptop-battery", "show_laptop_battery", rebind);
        this.settings.bind("laptop-display-name", "laptop_display_name", rebind);
        this.settings.bind("connected-only", "connected_only", rebind);
        this.settings.bind("show-disconnected", "show_disconnected", rebind);
        this.settings.bind("expand-on-click", "expand_on_click", rebind);
        this.settings.bind("show-time-remaining", "show_time_remaining", rebind);
        this.settings.bind("show-voltage", "show_voltage", rebind);
        this.settings.bind("show-health", "show_health", rebind);
        this.settings.bind("show-cycles", "show_cycles", rebind);
        this.settings.bind("show-progress-bars", "show_progress_bars", rebind);
        this.settings.bind("show-icons", "show_icons", rebind);
        this.settings.bind("show-percent", "show_percent", rebind);
        this.settings.bind("low-battery-threshold", "low_battery_threshold", rebind);
        this.settings.bind("enable-notifications", "enable_notifications", rebind);
        this.settings.bind("headsetcontrol-command", "headsetcontrol_command", () => {
            if (this._headsetProvider) {
                this._headsetProvider.setCommand(this.headsetcontrol_command);
            }
            this._queueRefresh(true);
        });
        this.settings.bind("headsetcontrol-timeout", "headsetcontrol_timeout", () => {
            if (this._headsetProvider) {
                this._headsetProvider.setTimeoutSeconds(this.headsetcontrol_timeout);
            }
        });

        // Compat: older installs used show-disconnected; prefer connected-only when present.
        if (this.connected_only === undefined) {
            this.connected_only = this.show_disconnected === false;
        }
    }

    _settingsSnapshot() {
        return {
            compact_mode: this.compact_mode,
            laptop_display_name: this.laptop_display_name,
            show_icons: this.show_icons,
            show_percent: this.show_percent,
            show_progress_bars: this.show_progress_bars,
            show_time_remaining: this.show_time_remaining,
            show_voltage: this.show_voltage,
            show_health: this.show_health,
            show_cycles: this.show_cycles,
            expand_on_click: this.expand_on_click,
            low_battery_threshold: this.low_battery_threshold
        };
    }

    _nameOptions() {
        return { laptopName: this.laptop_display_name || "Laptop" };
    }

    _buildUi() {
        this._root = new St.BoxLayout({
            vertical: true,
            style_class: "powerpulse-root",
            reactive: true
        });

        this._headerBox = new St.BoxLayout({
            vertical: false,
            style_class: "powerpulse-header",
            reactive: true,
            track_hover: true
        });

        this._headerIcon = new St.Icon({
            icon_name: "battery-good-symbolic",
            icon_type: St.IconType.SYMBOLIC,
            style_class: "powerpulse-header-icon"
        });

        this._titleLabel = new St.Label({
            text: "PowerPulse",
            style_class: "powerpulse-title",
            y_align: Clutter.ActorAlign.CENTER
        });

        this._headerBox.add_child(this._headerIcon);
        this._headerBox.add_child(this._titleLabel);
        this._headerBox.connect("button-release-event", (_a, event) => {
            if (event.get_button() === 1) {
                this._summary.toggle();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._separator = new St.Bin({ style_class: "powerpulse-separator", x_expand: true });
        this._summary = new SummaryPanel(this);
        this._list = new St.BoxLayout({
            vertical: true,
            style_class: "powerpulse-list",
            x_expand: true
        });
        this._footerLabel = new St.Label({ text: "", style_class: "powerpulse-footer" });

        this._root.add_child(this._headerBox);
        this._root.add_child(this._separator);
        this._root.add_child(this._summary.actor);
        this._root.add_child(this._list);
        this._root.add_child(this._footerLabel);

        this.setContent(this._root);
        this._applyCompactClass();
    }

    _buildContextMenu() {
        this._menu.addAction(this._("Refresh now"), () => this._queueRefresh(true));
        this._menu.addSettingsAction(this._("Power Management"), "power");

        const sortMenu = new PopupMenu.PopupSubMenuMenuItem(this._("Sort by"));
        const sortOptions = [
            [this._("Battery Ascending"), SortMode.BATTERY_ASC],
            [this._("Battery Descending"), SortMode.BATTERY_DESC],
            [this._("Name"), SortMode.NAME],
            [this._("Type"), SortMode.TYPE],
            [this._("Last update"), SortMode.UPDATED],
            [this._("Manual"), SortMode.MANUAL]
        ];
        sortOptions.forEach(([label, value]) => {
            sortMenu.menu.addAction(label, () => {
                this.sort_by = value;
                try {
                    this.settings.setValue("sort-by", value);
                } catch (e) {}
                this._renderDevices(this._devices);
            });
        });
        this._menu.addMenuItem(sortMenu);

        this._menu.addAction(this._("Compact mode"), () => {
            const next = !this.compact_mode;
            this.compact_mode = next;
            try {
                this.settings.setValue("compact-mode", next);
            } catch (e) {}
            this._onSettingsChanged();
        });
        this._menu.addAction(this._("Expand all"), () => this._expandAll());
        this._menu.addAction(this._("Collapse all"), () => this._collapseAll());
        this._menu.addAction(this._("Settings"), () => this.configureDesklet());
        this._menu.addAction(this._("Copy summary"), () => this._copySummary());
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    _initProviders() {
        this._registry = new ProviderRegistry();

        const onChange = () => this._scheduleSoftRefresh();
        const logError = (msg, err) => this._logOnce(msg, err);

        this._registry.register(new UpowerProvider({ onChange: onChange, logError: logError }));

        this._headsetProvider = new HeadsetControlProvider({
            command: this.headsetcontrol_command,
            timeoutSeconds: this.headsetcontrol_timeout,
            onChange: onChange,
            logError: logError
        });
        this._registry.register(this._headsetProvider);
        this._registry.startAll();
    }

    _applyCompactClass() {
        if (this.compact_mode) {
            this._root.add_style_class_name("compact");
            this._list.add_style_class_name("compact");
        } else {
            this._root.remove_style_class_name("compact");
            this._list.remove_style_class_name("compact");
        }
    }

    _updateHeader() {
        const title = (this.custom_title || "PowerPulse").trim() || "PowerPulse";
        this._titleLabel.set_text(title);
        this.setHeader(title);
    }

    _onSettingsChanged() {
        this._applyCompactClass();
        this._updateHeader();
        this._restartTimer();
        this._renderDevices(this._devices);
        this._queueRefresh(false);
    }

    _logOnce(key, err) {
        if (!this._loggedKeys) {
            this._loggedKeys = {};
        }
        if (this._loggedKeys[key]) {
            return;
        }
        this._loggedKeys[key] = true;
        const detail = err ? (err.message || String(err)) : "";
        global.logWarning("PowerPulse: " + key + (detail ? " — " + detail : ""));
        GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 600, () => {
            if (this._loggedKeys) {
                delete this._loggedKeys[key];
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // Left-click on empty desklet chrome no longer force-refreshes (cards/title own clicks).
    on_desklet_clicked(_event) {}

    on_desklet_removed() {
        this._destroyed = true;
        this._clearTimer();
        if (this._softRefreshId) {
            GLib.source_remove(this._softRefreshId);
            this._softRefreshId = 0;
        }
        if (this._registry) {
            this._registry.destroy();
            this._registry = null;
        }
        this._headsetProvider = null;
        this._clearCards();
    }

    on_desklet_added_to_desktop() {
        this._restartTimer();
        this._queueRefresh(true);
    }

    _clearTimer() {
        if (this._updateTimeoutId) {
            GLib.source_remove(this._updateTimeoutId);
            this._updateTimeoutId = 0;
        }
    }

    _restartTimer() {
        this._clearTimer();
        const interval = Math.max(15, Number(this.update_interval) || 30);
        this._updateTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._queueRefresh(false);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _scheduleSoftRefresh() {
        if (this._destroyed || this._softRefreshId) {
            return;
        }
        this._softRefreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._softRefreshId = 0;
            this._queueRefresh(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    _queueRefresh(force) {
        if (this._destroyed) {
            return;
        }
        if (this._refreshing) {
            this._pendingRefresh = true;
            this._pendingForce = this._pendingForce || !!force;
            return;
        }
        this._refresh(force);
    }

    _refresh(force) {
        if (this._destroyed) {
            return;
        }
        this._refreshing = true;
        this._pendingRefresh = false;
        this._pendingForce = false;

        if (force && this._registry) {
            this._registry.refreshAll();
        }

        if (!this._registry) {
            this._refreshing = false;
            return;
        }

        this._registry.fetchAll((devices) => {
            if (this._destroyed) {
                return;
            }
            const merged = this._prepareDevices(devices || []);
            this._devices = merged;
            this._lastFullRefreshAt = Date.now() / 1000;
            this._checkNotifications(merged);
            this._renderDevices(merged);
            this._refreshing = false;

            if (this._pendingRefresh) {
                const again = this._pendingForce;
                this._pendingRefresh = false;
                this._pendingForce = false;
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._queueRefresh(again);
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
    }

    _prepareDevices(devices) {
        const now = Date.now() / 1000;
        let list = [];
        const byId = {};

        // Prefer a live HeadsetControl reading only over the matching UPower
        // headset. Offline HC devices must not hide Bluetooth earbuds.
        devices.forEach((d) => {
            markFreshness(d, now);
            if (d.type === DeviceType.BATTERY && !this.show_laptop_battery) {
                return;
            }
            if (shouldSkipUpowerHeadset(d, devices)) {
                return;
            }
            const onlyConnected = this.connected_only !== false && this.show_disconnected !== true;
            if (onlyConnected && !d.connected) {
                return;
            }
            if (!byId[d.id]) {
                byId[d.id] = d;
                list.push(d);
            }
        });

        const mode = this.sort_by || SortMode.BATTERY_ASC;
        return sortDevices(list, mode, this._nameOptions(), this.manual_order);
    }

    _checkNotifications(devices) {
        if (!this.enable_notifications) {
            return;
        }
        const threshold = Number(this.low_battery_threshold) || 20;
        const activeIds = {};

        (devices || []).forEach((device) => {
            activeIds[device.id] = true;
            if (!device.connected || device.percentage === null || device.percentage === undefined) {
                return;
            }
            if (device.percentage > threshold) {
                this._notifiedLow[device.id] = false;
                return;
            }
            if (this._notifiedLow[device.id]) {
                return;
            }
            this._notifiedLow[device.id] = true;
            Main.notify(
                this._("PowerPulse"),
                this._("%s battery is low (%s)").format(
                    friendlyName(device, this._nameOptions()),
                    formatPercent(device.percentage)
                )
            );
        });

        Object.keys(this._notifiedLow).forEach((id) => {
            if (!activeIds[id]) {
                delete this._notifiedLow[id];
            }
        });
    }

    _clearCards() {
        Object.keys(this._cards).forEach((id) => {
            this._cards[id].destroy();
        });
        this._cards = {};
        const children = this._list.get_children();
        for (let i = 0; i < children.length; i++) {
            children[i].destroy();
        }
    }

    _expandAll() {
        Object.keys(this._cards).forEach((id) => this._cards[id].expand());
    }

    _collapseAll() {
        Object.keys(this._cards).forEach((id) => this._cards[id].collapse());
        this._summary.collapse();
    }

    _renderDevices(devices) {
        this._applyCompactClass();
        const keep = {};
        const list = devices || [];

        if (!list.length) {
            this._clearCards();
            this._list.add_child(new St.Label({
                text: this._("No battery devices found"),
                style_class: "powerpulse-empty"
            }));
            this._updateFooterAndSummary();
            return;
        }

        // Remove cards for gone devices
        Object.keys(this._cards).forEach((id) => {
            if (!list.some((d) => d.id === id)) {
                this._cards[id].destroy();
                delete this._cards[id];
            }
        });

        // Detach actors then re-add in sorted order (without destroying live cards).
        const current = this._list.get_children();
        for (let i = 0; i < current.length; i++) {
            this._list.remove_child(current[i]);
        }

        list.forEach((device) => {
            keep[device.id] = true;
            let card = this._cards[device.id];
            if (!card) {
                card = new DeviceCard(this, device, {
                    getSettings: () => this._settingsSnapshot(),
                    onToggle: (active) => {
                        // Accordion: collapse siblings for a compact desklet.
                        Object.keys(this._cards).forEach((id) => {
                            if (this._cards[id] !== active) {
                                this._cards[id].collapse();
                            }
                        });
                    }
                });
                this._cards[device.id] = card;
            } else {
                card.update(device);
            }
            this._list.add_child(card.actor);
        });

        this._updateFooterAndSummary();
    }

    _updateFooterAndSummary() {
        if (this._lastFullRefreshAt) {
            this._footerLabel.set_text(this._("Updated %s").format(formatClockTime(this._lastFullRefreshAt)));
        } else {
            this._footerLabel.set_text("");
        }
        const stats = buildStats(this._devices, this.low_battery_threshold);
        this._summary.update(stats, this._lastFullRefreshAt, (this.metadata && this.metadata.version) || VERSION);
    }

    _copySummary() {
        const opts = this._nameOptions();
        const text = buildClipboardSummary(
            this._devices,
            (d) => friendlyName(d, opts),
            {
                title: "PowerPulse",
                updatedLabel: this._lastFullRefreshAt ? formatClockTime(this._lastFullRefreshAt) : ""
            }
        );
        try {
            this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            Main.notify(this._("PowerPulse"), this._("Battery summary copied to clipboard"));
        } catch (e) {
            this._logOnce("clipboard", e);
        }
    }
}

function main(metadata, deskletId) {
    return new PowerPulseDesklet(metadata, deskletId);
}
