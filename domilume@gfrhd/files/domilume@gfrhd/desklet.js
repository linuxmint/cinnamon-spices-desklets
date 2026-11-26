const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Main = imports.ui.main;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

// Own modules: Cinnamon 6.8+ provides them via getCurrentExtension() (require() is deprecated
// there). Older versions have no getCurrentExtension() and do not reload modules imported via
// imports.desklets[uuid] when the desklet is reloaded or updated, so they use require().
// Either way each module is loaded once and shared by all desklet instances.
const Me = imports.ui.extension.getCurrentExtension
    ? imports.ui.extension.getCurrentExtension().imports : null;
const FritzClient = Me ? Me.fritzclient : require('./fritzclient');
const FritzXml = Me ? Me.fritzxml : require('./fritzxml');
const DeviceList = Me ? Me.devicelist : require('./devicelist');
const I18n = Me ? Me.i18n : require('./i18n');
const _ = I18n._;
const Discovery = Me ? Me.discovery : require('./discovery');
const CredentialsDialog = Me ? Me.credentialsDialog : require('./credentialsDialog');
const Tiles = Me ? Me.tiles : require('./tiles');

const UUID = "domilume@gfrhd";
const HOST_CHANGE_DELAY_MS = 1500;
const GRID_GAP = 8;   // px, keep in sync with .fritz-grid / .fritz-grid-row spacing
const TARGET_DELAY_MS = 1000;   // collect −/+ clicks before sending the set point
const MIN_TARGET = 8, MAX_TARGET = 28;
// shared key -> settings key of the electricity prices (ct/kWh)
const PRICE_SETTINGS = { priceImport: "price-import", priceExport: "price-export" };
const DEFAULT_MINUTES = { boost: 30, frost: 10 };

function log(msg) {
    global.log(`[${UUID}] ${msg}`);
}

function logError(msg) {
    global.logError(`[${UUID}] ${msg}`);
}

class FritzDesklet extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);

        this._client = null;          // shared FritzClient for the current address
        this._onData = result => this._onClientData(result);
        this._devices = [];           // last device list from the box
        this._tooltip = new Tiles.TileTooltip();   // one tooltip label for all tiles
        this._pendingTargets = new Map();          // ain -> { value, timerId } while −/+ is clicked
        this._stats = new Map();                   // stats AIN -> parsed statistics
        this._lastSeen = new Map();                // ain -> { device (last data while present), offlineSince }
        this._renderIdleId = 0;
        this._actions = {
            toggle: d => this._toggle(d),
            step: (d, delta) => this._stepTarget(d, delta),
            mode: (d, mode, minutes) => this._setMode(d, mode, minutes),
        };
        this._hostTimerId = 0;
        this._removed = false;
        this._discovering = false;
        this._cancellable = new Gio.Cancellable();

        this.settings = new Settings.DeskletSettings(this, UUID, deskletId);
        this.settings.bind("fritzbox-ip", "host", () => this._onHostChanged());
        this.settings.bind("device-list", "deviceList", () => this._renderCurrent());
        this.settings.bind("refresh-interval", "refreshInterval", () => this._onIntervalChanged());
        this.settings.bind("columns", "columns", () => this._renderCurrent());
        this.settings.bind("tile-width", "tileWidth", () => this._renderCurrent());
        this.settings.bind("background-opacity", "backgroundOpacity", () => this._renderCurrent());
        this.settings.bind("energy-range", "energyRange", () => this._renderCurrent());
        this.settings.bind("price-import", "priceImport", () => this._onPriceChanged("priceImport"));
        this.settings.bind("price-export", "priceExport", () => this._onPriceChanged("priceExport"));
        this._discoverState = "";     // "", "searching" or "notfound"
        this._connectionState = this.settings.getValue("connection-state") || "";

        this.setHeader("Domilume");
        this._buildLayout();
        FritzClient.setNotifier((title, text) => Main.notify(title, text));
        this._removeSharedListener = FritzClient.onSharedChanged((key, value) => {
            if (key === "host")
                this._adoptSharedHost(value);
            else if (key === "interval")
                this._adoptSharedInterval(value);
            else if (key in PRICE_SETTINGS)
                this._adoptSharedPrice(key, value);
        });
        this._start();
    }

    async _start() {
        this._setStatus(_("Reading credentials from the keyring…"));
        try {
            await FritzClient.loadShared(UUID);
        } catch (e) {
            logError(`Keyring: ${e.message}`);
        }
        if (this._removed)
            return;
        // Address and interval are the same for all instances: take the shared values,
        // or share ours if nothing is stored yet.
        let shared = FritzClient.getSharedHost();
        if (shared)
            this._adoptSharedHost(shared);
        else if (this._hostValue())
            this._share("host", this._hostValue());
        if (FritzClient.getSharedInterval())
            this._adoptSharedInterval(FritzClient.getSharedInterval());
        else
            this._share("interval", this.refreshInterval);
        let prices = FritzClient.getSharedPrices();
        for (let [key, value] of [["priceImport", prices.import], ["priceExport", prices.export]]) {
            if (value)
                this._adoptSharedPrice(key, value);
            else if (this[key])
                this._share(key, this[key]);
        }
        // No address anywhere yet: search once, never again on its own.
        if (!shared && !this._hostValue())
            await this.discoverFritzBox();
        this._refresh();
    }

    _buildLayout() {
        this._box = new St.BoxLayout({ vertical: true, style_class: "fritz-main" });
        this._grid = new St.BoxLayout({ vertical: true, style_class: "fritz-grid" });
        this._status = new St.Label({ text: _("Connecting…"), style_class: "fritz-status", x_align: Clutter.ActorAlign.START });
        this._box.add_child(this._grid);
        this._box.add_child(this._status);
        this.setContent(this._box);
    }

    // The status line below the tiles only shows messages (connecting, errors, search);
    // with current data it is hidden, the tiles alone show the state.
    _setStatus(text) {
        if (text) {
            this._status.set_text(text);
            this._status.show();
        } else {
            this._status.hide();
        }
    }

    // ---- State for the settings window ----------------------------------

    // Hidden settings that drive the messages and the device section in the settings
    // window (section "dependency" in settings-schema.json). Written only on change: an
    // open settings window drops outside changes that arrive while it saves its own.
    _setState(key, value) {
        if (this.settings.getValue(key) !== value)
            this.settings.setValue(key, value);
    }

    _setDiscoverState(value) {
        this._discoverState = value;
        this._updateStatus();
    }

    _setConnectionState(value) {
        this._connectionState = value;
        this._setState("connection-state", value);   // reveals the device list when "ok"
        this._updateStatus();
    }

    // One status line in the settings window: a running or failed search wins,
    // otherwise the connection state is shown.
    _updateStatus() {
        this._setState("status", this._discoverState || this._connectionState);
    }


    // ---- Address ---------------------------------------------------------

    _hostValue() {
        return String(this.host || "").trim();
    }

    // Note: settings.setValue() only writes the value; it does not call the binding
    // callbacks. Those fire only for changes made in the settings window.

    // Address changed in another instance: take it over here too.
    _adoptSharedHost(host) {
        if (this._removed || host === this._hostValue())
            return;
        this.settings.setValue("fritzbox-ip", host);
        if (!this._discovering)
            this._setDiscoverState("");
        this._onConnectionChanged();
    }

    _share(key, value) {
        FritzClient.setShared(UUID, key, value).catch(e => logError(`Keyring: ${e.message}`));
    }

    // Address typed in the settings window: wait until typing pauses, then share it
    // with the other instances and reconnect.
    _onHostChanged() {
        if (!this._discovering)
            this._setDiscoverState("");
        if (this._hostTimerId)
            GLib.source_remove(this._hostTimerId);
        this._hostTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOST_CHANGE_DELAY_MS, () => {
            this._hostTimerId = 0;
            this._share("host", this._hostValue());
            this._onConnectionChanged();
            return GLib.SOURCE_REMOVE;
        });
    }

    // ---- Refresh interval (one timer for all instances, in fritzclient.js) -

    // Interval changed in another instance: show it here too (the timer is shared).
    _adoptSharedInterval(seconds) {
        if (!this._removed && seconds !== this.refreshInterval)
            this.settings.setValue("refresh-interval", seconds);
    }

    // Interval changed in the settings window.
    _onIntervalChanged() {
        this._share("interval", this.refreshInterval);
    }

    // ---- Electricity prices (shared like address and interval) ------------

    // Price changed in another instance.
    _adoptSharedPrice(key, value) {
        if (!this._removed && value !== this[key])
            this.settings.setValue(PRICE_SETTINGS[key], value);
    }

    // Price changed in the settings window (or adopted): share it, show the new costs.
    _onPriceChanged(key) {
        this._share(key, this[key] || 0);
        this._renderCurrent();
    }

    // Called by the "Search automatically" button and once for a new instance without address.
    async discoverFritzBox() {
        if (this._discovering)
            return;
        this._discovering = true;
        this._setStatus(_("Searching for the FRITZ!Box…"));
        this._setDiscoverState("searching");
        let changed = false;
        try {
            let found = await Discovery.discoverFritzBox(this._cancellable);
            if (this._removed)
                return;
            if (found) {
                log(`FRITZ!Box found via ${found.method}: ${found.host}`);
                this._setStatus(I18n.formatText(_("FRITZ!Box found: %s"), found.host));
                Main.notify(_("FRITZ!Box found"), I18n.formatText(_("Address %s (via %s)"), found.host, found.method));
                this._setDiscoverState("");
                if (found.host !== this._hostValue()) {
                    this.settings.setValue("fritzbox-ip", found.host);
                    changed = true;
                }
                this._share("host", found.host);   // also when this instance already had it
            } else {
                this._setStatus(_("No FRITZ!Box found – please enter the address in the settings"));
                Main.notify(_("No FRITZ!Box found"),
                    _("Is this computer in the same network? Otherwise enter the address in the settings."));
                this._setDiscoverState("notfound");
            }
        } catch (e) {
            logError(`Search: ${e.message}`);
            this._setStatus("⚠ " + I18n.formatText(_("Search failed: %s"), e.message));
            Main.notify(_("Search for the FRITZ!Box failed"), e.message);
            this._setDiscoverState("notfound");
        } finally {
            this._discovering = false;
        }
        if (changed)
            this._onConnectionChanged();
    }

    // ---- Credentials -----------------------------------------------------

    // Called by the "Set credentials…" button.
    openCredentialsDialog() {
        CredentialsDialog.openCredentialsDialog(FritzClient.getUsername(),
            (user, password) => this._saveCredentials(user, password));
    }

    async _saveCredentials(username, password) {
        try {
            await FritzClient.saveCredentials(UUID, username, password);
            log(username || password ? "Credentials stored in the keyring" : "Credentials removed");
        } catch (e) {
            logError(`Keyring: ${e.message}`);
            this._setStatus("⚠ " + I18n.formatText(_("Keyring: %s"), e.message));
            return;
        }
        this._onConnectionChanged();
    }

    // ---- Device list in the settings ------------------------------------

    // Called by the "Reload device list" button.
    reloadDeviceList() {
        this._refresh();
    }

    // Bring the settings table in line with what the box reports; write only on change.
    _syncDeviceList(devices) {
        let rows = DeviceList.mergeRows(this.deviceList, devices, {
            groupMembers: FritzXml.groupMemberAins(devices),
        });
        if (!DeviceList.sameRows(rows, this.deviceList))
            this.settings.setValue("device-list", rows);
    }

    // ---- Refresh ---------------------------------------------------------

    _onConnectionChanged() {
        this._refresh();
    }

    // Subscribe to the shared client (and its timer) for the configured address.
    _clientFor(host) {
        if (this._client && this._client.host === host)
            return this._client;
        this._releaseClient();
        this._client = FritzClient.acquireClient(host, this._onData);
        return this._client;
    }

    _releaseClient() {
        if (this._client) {
            FritzClient.releaseClient(this._client, this._onData);
            this._client = null;
        }
    }

    // Ask the shared client for a fetch now; the result arrives in _onClientData,
    // like the results of the timer.
    _refresh() {
        if (this._removed || this._discovering)
            return;
        let host = this._hostValue();
        if (!host) {
            this._releaseClient();
            this._setStatus(_("No address – Settings → “Search automatically”"));
            this._setConnectionState("no-address");
            return;
        }
        if (!FritzClient.getCredentials()) {
            this._setStatus(_("No credentials – Settings → “Set credentials…”"));
            this._setConnectionState("no-credentials");
            return;
        }
        this._clientFor(host).refreshNow();
    }

    _onClientData(result) {
        if (this._removed)
            return;
        if (result.error) {
            let e = result.error;
            if (e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            logError(e.message);
            this._setStatus(`⚠ ${e.message}`);
            this._setConnectionState(FritzClient.stateForError(e));
            return;
        }
        this._devices = result.devices;
        this._rememberDevices(result.devices);
        this._setConnectionState("ok");
        this._syncDeviceList(result.devices);
        this._renderCurrent();
        this._loadStats();
        this._setStatus(null);
    }

    // ---- Actions (switching, set point, boost / frost protection) --------

    // Runs a command on the shared client; on failure notify and reload the real state.
    _run(what, command) {
        if (!this._client)
            return;
        let client = this._client;
        command(client).catch(e => {
            logError(`${what}: ${e.message}`);
            Main.notify(what, e.message);
            this._refresh();
        });
    }

    _toggle(d) {
        this._run(I18n.formatText(_("Switching %s failed"), d.name), client => client.toggleSwitch(d.ain, d.name));
    }

    // −/+ clicks are collected for a moment and sent as one set point.
    _stepTarget(d, delta) {
        if (!this._client)
            return;
        let pending = this._pendingTargets.get(d.ain);
        let base = pending ? pending.value
            : d.hkr.target !== null ? d.hkr.target
            : d.hkr.targetState === "on" ? MAX_TARGET : MIN_TARGET;
        let value = Math.round(Math.min(MAX_TARGET, Math.max(MIN_TARGET, base + delta)) * 2) / 2;
        if (pending)
            GLib.source_remove(pending.timerId);
        this._client.expectTarget(d.ain, value, d.name, TARGET_DELAY_MS / 1000);
        let timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TARGET_DELAY_MS, () => {
            this._pendingTargets.delete(d.ain);
            this._run(I18n.formatText(_("Set point of %s failed"), d.name), client => client.setTarget(d.ain, value, d.name)
                .catch(e => { client.dropExpectation(d.ain); throw e; }));
            return GLib.SOURCE_REMOVE;
        });
        this._pendingTargets.set(d.ain, { value, timerId });
    }

    // Starts boost / frost protection for the configured minutes, or ends it if active.
    _setMode(d, mode, minutes) {
        let now = Math.floor(Date.now() / 1000);
        let active = Tiles.activeMode(d, now);
        let end = 0;
        if (!active || active.mode !== mode) {
            let min = Math.min(1440, Math.max(1, minutes || DEFAULT_MINUTES[mode]));   // box: max 24 h
            end = now + min * 60;
        }
        let what = mode === "boost" ? _("Boost for %s failed") : _("Frost protection for %s failed");
        this._run(I18n.formatText(what, d.name), client => client.setMode(d.ain, mode, end, d.name));
    }

    // ---- Statistics for the graphs ---------------------------------------

    // Groups have no statistics of their own: use the first member's.
    _statsAin(d) {
        if (d.kind === "group" && d.memberIds.length) {
            let member = this._devices.find(m => m.id === d.memberIds[0]);
            if (member)
                return member.ain;
        }
        return d.ain;
    }

    // Ask the shared client for the statistics of the visible devices (cached there for a
    // minute, so several desklets and frequent refreshes cost no extra requests).
    _loadStats() {
        if (!this._client)
            return;
        let client = this._client;
        for (let { device } of DeviceList.visibleDevices(this.deviceList, this._devices)) {
            if (!["plug", "import", "export", "hkr", "group", "sensor"].includes(device.kind))
                continue;
            let ain = this._statsAin(device);
            client.getStats(ain).then(stats => {
                if (this._removed || !stats || this._stats.get(ain) === stats)
                    return;
                this._stats.set(ain, stats);
                this._scheduleRender();
            });
        }
    }

    // Several statistics arrive in a burst: render once afterwards.
    _scheduleRender() {
        if (this._renderIdleId)
            return;
        this._renderIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._renderIdleId = 0;
            if (!this._removed)
                this._renderCurrent();
            return GLib.SOURCE_REMOVE;
        });
    }

    // ---- Rendering --------------------------------------------------------

    // Devices drop out now and then (e.g. the Energy 250 reading head); the box then sends
    // no values. Keep the last data while present, so the tile can show it dimmed.
    _rememberDevices(devices) {
        let now = Math.floor(Date.now() / 1000);
        for (let d of devices) {
            let seen = this._lastSeen.get(d.ain);
            if (d.present)
                this._lastSeen.set(d.ain, { device: d, offlineSince: 0 });
            else if (seen && !seen.offlineSince)
                seen.offlineSince = now;
        }
    }

    // Device as shown: an offline device with its last known values (stale), if there are any.
    _displayDevice(d) {
        if (d.present)
            return d;
        let seen = this._lastSeen.get(d.ain);
        if (!seen)
            return d;
        return Object.assign({}, seen.device, { name: d.name, present: false, stale: true, offlineSince: seen.offlineSince });
    }

    // Grid of tiles in the order of the settings table; a big tile takes a full row.
    _renderCurrent() {
        this._tooltip.hide();
        this._grid.destroy_all_children();
        let visible = DeviceList.visibleDevices(this.deviceList, this._devices);
        if (!visible.length) {
            let text = this._devices.length
                ? _("No devices selected – Settings → Devices")
                : _("No devices loaded yet");
            this._grid.add_child(new St.Label({ text: text, style_class: "fritz-empty" }));
            return;
        }

        let cols = Math.max(1, Math.min(6, this.columns || 3));
        let width = Math.max(120, this.tileWidth || 172);
        let alpha = Math.max(0.3, Math.min(1, (this.backgroundOpacity || 75) / 100));
        let fullWidth = cols * width + (cols - 1) * GRID_GAP;
        let options = { dir: this.metadata.path, nowUnix: Math.floor(Date.now() / 1000), tooltip: this._tooltip, actions: this._actions,
            stats: d => this._stats.get(this._statsAin(d)), energyRange: this.energyRange || "7",
            prices: { import: this.priceImport || 0, export: this.priceExport || 0 } };

        let row = null;
        for (let { device, row: settingsRow } of visible) {
            let big = !!settingsRow.big;
            let tile;
            try {
                tile = Tiles.buildTile(this._displayDevice(device), settingsRow, Object.assign({ big }, options));
            } catch (e) {
                logError(`Kachel „${device.name}“: ${e}\n${e.stack}`);
                tile = new St.Label({ text: `${device.name}: Anzeigefehler`, style_class: "fritz-tile" });
            }
            tile.set_style(`width: ${big ? fullWidth : width}px; background-color: rgba(20, 24, 29, ${alpha});`);
            if (big) {
                this._grid.add_child(tile);
                row = null;
                continue;
            }
            if (!row || row.get_n_children() >= cols) {
                row = new St.BoxLayout({ style_class: "fritz-grid-row" });
                this._grid.add_child(row);
            }
            row.add_child(tile);
        }
    }

    // ---- Cleanup ---------------------------------------------------------

    on_desklet_removed() {
        this._removed = true;
        if (this._hostTimerId) {
            GLib.source_remove(this._hostTimerId);
            this._hostTimerId = 0;
        }
        this._cancellable.cancel();
        if (this._removeSharedListener)
            this._removeSharedListener();
        for (let pending of this._pendingTargets.values())
            GLib.source_remove(pending.timerId);
        this._pendingTargets.clear();
        if (this._renderIdleId) {
            GLib.source_remove(this._renderIdleId);
            this._renderIdleId = 0;
        }
        this._releaseClient();
        this._grid.destroy_all_children();
        this._tooltip.destroy();
        this._finalizeSettings();
    }

    // When the desklet is reloaded, Cinnamon registers the new instance's settings before
    // the old instance is removed, under the same instance id. A plain finalize() would
    // then unregister the new instance and the settings window could no longer reach it.
    _finalizeSettings() {
        let registry = Main.settingsManager.uuids[UUID];
        if (registry && registry[this.instance_id] === this.settings) {
            this.settings.finalize();
            return;
        }
        for (let key in this.settings.bindings)
            this.settings.unbindAll(key);
        this.settings.disconnectAll();
    }
}

function main(metadata, deskletId) {
    return new FritzDesklet(metadata, deskletId);
}
