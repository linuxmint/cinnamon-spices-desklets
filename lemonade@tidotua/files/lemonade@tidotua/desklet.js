/*
 * Copyright 2026 tidotua
*/

const Desklet = imports.ui.desklet;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Tooltips = imports.ui.tooltips;
const Lang = imports.lang;
const ModalDialog = imports.ui.modalDialog;

imports.gi.versions.Soup = '3.0';
const Soup = imports.gi.Soup;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const HEALTH_ENDPOINT = "health";
const MODELS_ENDPOINT = "models";
const LOAD_ENDPOINT = "load";
const UNLOAD_ENDPOINT = "unload";
const STATS_ENDPOINT = "stats";

function LemonadeDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id)
}

LemonadeDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.setupSettings(desklet_id);

        this.sharedSession = new Soup.Session();
        this.launcher = new Gio.SubprocessLauncher({
            flags: (
                Gio.SubprocessFlags.STDIN_PIPE |
                Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.Subprocess.STDERR_PIPE)
        });

        this.resetData();
        this.setupUI();
        this.restartMainLoop();
    },

    restartMainLoop: function() {
        if (this.mainloop) {
            Mainloop.source_remove(this.mainloop);
        }

        if (!this.update_interval || this.update_interval < 5) {
            this.update_interval = 5;
            global.log("UPDATE INTERVAL was not defined, fallback to " + this.update_interval);
        }

        this.mainloop = Mainloop.timeout_add_seconds(this.update_interval, () => {
            this.updateIteration();
            return true;
        });

        this.updateIteration();
    },

    // --------------------------------------------------------------------------------------------
    // Settings
    // --------------------------------------------------------------------------------------------

    setupSettings: function(desklet_id) {
        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "server_addr", "server_addr", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "server_port", "server_port", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "api_version", "api_version", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "api_key", "api_key", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "update_interval", "update_interval", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "background_color", "background_color", this.onSettingChanged);
    },

    onSettingChanged: function() {
        this.resetData();
        this.removeModelRows();
        this.updateServerAddressUI();
        this.restartMainLoop();
    },

    // --------------------------------------------------------------------------------------------
    // Data
    // --------------------------------------------------------------------------------------------

    resetData: function() {
        this.server_url=`http://${this.server_addr.replace(/\/$/, '')}:${this.server_port}`;
        this.api_url = `${this.server_url}/${this.api_version.replace(/^\//, '')}`

        this.resetModels();
        this.serverOnline = false;
        this.resetStats();
    },

    resetModels: function() {
        if (this.activeModels) {
            this.activeModels.clear();
        } else {
            this.activeModels = new Map();
        }

        if (this.allModels) {
            this.allModels.length = 0;
        } else {
            this.allModels = [];
        }
    },

    resetStats: function() {
        this.context = 0;
        this.tps = 0;
    },

    // --------------------------------------------------------------------------------------------
    // UI
    // --------------------------------------------------------------------------------------------

    setupUI: function() {
        //let unit_size = 15 * global.ui_scale;

        this.window = new St.BoxLayout({
            vertical: true,
            style_class: "lemonade-container",
            style: "background-color: " + this.background_color + ";"
        });

        let serverHeader = this.setupHeaderUI();

        this.topSeparator = new St.Widget({
            style_class: 'lemonade-separator',
            x_expand: true
        });

        let statsRow = this.setupStatsUI();

        this.bottomSeparator = new St.Widget({
            style_class: 'lemonade-separator',
            x_expand: true
        });

        this.modelsTable = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL
        });

        this.window.add(serverHeader);
        this.window.add_child(this.topSeparator);
        this.window.add(statsRow);
        this.window.add_child(this.bottomSeparator);
        this.window.add(this.modelsTable);

        this.setContent(this.window);

        this.updateServerAddressUI();
        this.updateStatsUI();
    },

    setupHeaderUI: function() {
        let serverHeader = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            style_class: "lemonade-box-bottom"
        });

        let serverStatusCol = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            style_class: "lemonade-box-left"
        });

        let serverStatusRow1 = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            style_class: "lemonade-box-bottom"
        });

        let serverStatusRow2 = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL
        });

        let iconSize = 48;

        this.serverIcon = new St.Button();
        this.serverIcon.height = iconSize;
        this.serverIcon.width = iconSize;

        let icon_file = this.metadata.path + '/' + "icon.png";
        let file = Gio.file_new_for_path(icon_file);
        let icon_uri = file.get_uri();

        let image = St.TextureCache.get_default().load_uri_async(icon_uri, iconSize, iconSize);
        this.serverIcon.set_child(image);
        this.serverIconTooltip = new Tooltips.Tooltip(this.serverIcon);

        this.nameText = new St.Label({
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.END,
            y_expand: true,
            style_class: "lemonade-text-big lemonade-text-active lemonade-text-important",
            text: _("Lemonade Server")
        });

        this.versionText = new St.Label({
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
            x_expand: true,
            y_expand: true,
            style_class: "lemonade-text-small lemonade-text-active lemonade-text-right",
            text: _("Version")
        });

        this.statusText = new St.Label({
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.END,
            y_expand: true,
            style_class: "lemonade-text-big lemonade-text-active",
            text: _("Online")
        });

        this.addressText = new St.Label({
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
            x_expand: true,
            y_expand: true,
            style_class: "lemonade-text-small lemonade-text-active lemonade-text-right",
            text: _("Address")
        });

        serverHeader.add(this.serverIcon);
        serverStatusRow1.add_actor(this.nameText);
        serverStatusRow1.add_actor(this.versionText);
        serverStatusRow2.add_actor(this.statusText);
        serverStatusRow2.add_actor(this.addressText);

        serverHeader.add(serverStatusCol);
        serverStatusCol.add(serverStatusRow1);
        serverStatusCol.add(serverStatusRow2);

        return serverHeader;
    },

    setupStatsUI: function() {
        this.statsRow = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL
        });

        this.contextText = new St.Label({
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.END,
            y_expand: true,
            style_class: "lemonade-text-medium lemonade-text-left",
            text: _("Context")
        });

        this.tpsText = new St.Label({
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
            x_expand: true,
            y_expand: true,
            style_class: "lemonade-text-medium lemonade-text-right",
            text: _("TPS")
        });

        this.statsRow.add_actor(this.contextText);
        this.statsRow.add_actor(this.tpsText);

        return this.statsRow;
    },

    updateServerAddressUI: function() {
        this.window.style ="background-color: " + this.background_color + ";";

        this.addressText.set_text(_("Address") + ": " + this.server_addr);
        this.serverIconTooltip.set_text(this.server_url);

        if (this.serverIcon && this.serverIconSig) this.serverIcon.disconnect(this.serverIconSig);
        this.serverIconSig = this.serverIcon.connect('clicked', Lang.bind(this, function () {
            this.launcher.spawnv(['xdg-open', this.server_url]);
        }));
    },

    updateStatsUI: function() {
        if (this.serverOnline) {
            let active = this.activeModels.size > 0;
            let style = active ? "lemonade-text-active" : "lemonade-text-inactive";
            let context = active ? this.context : 0;
            let tps = active ? this.tps : 0;

            this.contextText.set_text(_("Context") + ":   " + context.toLocaleString());
            this.contextText.style_class = "lemonade-text-medium lemonade-text-left " + style;
            this.tpsText.set_text(_("TPS") + ":   " + tps.toFixed(1));
            this.tpsText.style_class = "lemonade-text-medium lemonade-text-right " + style;

            this.topSeparator.show();
            this.statsRow.show();
            this.bottomSeparator.show();
        } else {
            this.topSeparator.hide();
            this.statsRow.hide();
            this.bottomSeparator.hide();
        }
    },

    showConfirmDialog: function(promptText, onConfirmCallback) {
        let dialog = new ModalDialog.ConfirmDialog(
            promptText, () => {
                if (typeof onConfirmCallback === 'function') {
                    onConfirmCallback();
                }
            }
        );
        dialog.open();
    },

    createModelRow: function(name, recipe, is_active, is_busy) {
        let status = is_active ? (is_busy ? _("Busy") : _("Ready")) : _("Off");
        let status_style = is_active ? (is_busy ? "lemonade-text-bad" : "lemonade-text-good") : "lemonade-text-inactive";
        let active_style = is_active ? "lemonade-text-active " : "lemonade-text-inactive";

        let modelButton = new St.Button({
            reactive: true,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            style_class: "lemonade-box-bottom"
        });

        let prompt = (is_active ?
            _("Do you want to unload model?") :
            _("Do you want to load model?")) + "\n\n" + name;
        let sig = modelButton.connect('clicked', Lang.bind(this, function () {
            this.showConfirmDialog(prompt, () => {
                this.postWithBearerCallback(
                    this.getFullUrl(is_active ? UNLOAD_ENDPOINT : LOAD_ENDPOINT),
                    this.api_key,
                    { model_name: name },
                    (err, data) => {
                        if (err) global.logError("POST failed: " + err.message);
                    }
                );
            });
        }));

        let modelRow = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            style_class: "lemonade-box-bottom"
        });

        let nameText = new St.Label({
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.END,
            y_expand: true,
            style_class: "lemonade-text-medium lemonade-text-left" + " " + active_style,
            text: name
        });

        let recipeText = new St.Label({
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.END,
            x_expand: true,
            y_expand: true,
            style_class: "lemonade-text-medium lemonade-text-middle" + " " + active_style,
            text: recipe
        });

        let statusText = new St.Label({
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.END,
            y_expand: true,
            style_class: "lemonade-text-medium lemonade-text-right" + " " + status_style,
            text: status
        });

        modelRow.add(nameText);
        modelRow.add(recipeText);
        modelRow.add(statusText);
        modelButton.set_child(modelRow);

        let modelTooltip = new Tooltips.Tooltip(modelButton);
        modelTooltip.set_text(is_active ? _("Unload model") : _("Load model"));

        this.modelsTable.add(modelButton);
        this.modelListUI.push({
            row: modelButton,
            tooltip: modelTooltip,
            signal: sig
        });

    },

    createModelRows: function() {
        this.removeModelRows();

        this.activeModels.forEach((model, name) => {
            let recipe = `${model.recipe}:${model.device}`;
            this.createModelRow(name, recipe, true, model.is_busy);
        });

        for (let model of this.allModels) {
            if (this.activeModels.has(model.name)) continue;
            this.createModelRow(model.name, model.recipe, false, false);
        }
    },

    removeModelRows: function() {
        if (this.modelListUI) {
            for (let modelRow of this.modelListUI) {
                if (modelRow.row) {
                    if (modelRow.signal) modelRow.row.disconnect(modelRow.signal);
                    if (modelRow.tooltip) modelRow.tooltip.destroy();
                    modelRow.row.destroy();
                }
            }
        }

        this.modelListUI = [];
    },

    // --------------------------------------------------------------------------------------------
    // Logic
    // --------------------------------------------------------------------------------------------

    updateIteration: function() {
        this.updateActiveModels();
    },

    updateActiveModels: function() {
        this.getWithBearerCallback(this.getFullUrl(HEALTH_ENDPOINT), this.api_key, (error, data) => {
            if (error) {
                switch (data.code) {
                    case 0:
                        this.statusText.set_text(_("Offline"));
                        this.statusText.style_class = "lemonade-text-medium lemonade-text-left lemonade-text-inactive lemonade-text-important";
                        break;

                    case 401:
                        this.statusText.set_text(_("Error: Missing API key"));
                        this.statusText.style_class = "lemonade-text-medium lemonade-text-left lemonade-text-bad lemonade-text-important";
                        break;

                    default:
                        this.statusText.set_text(_("HTTP Error ") + data.code);
                        this.statusText.style_class = "lemonade-text-medium lemonade-text-left lemonade-text-bad lemonade-text-important";
                }

                this.resetData();
                this.removeModelRows();
            } else {
                this.serverOnline = true;
                this.statusText.set_text(_("Online"));
                this.statusText.style_class = "lemonade-text-medium lemonade-text-left lemonade-text-good lemonade-text-important";
                if (data.version)
                    this.versionText.set_text(_("Version") + ": " + data.version);

                if (data.all_models_loaded) {
                    this.activeModels.clear();
                    for (let model of data.all_models_loaded) {
                        this.activeModels.set(model.model_name, {
                            device: model.device,
                            recipe: model.recipe,
                            is_busy: model.is_busy
                        });
                    }

                    this.updateAllModels();
                    if (this.activeModels.size > 0) {
                        this.updateStats();
                    } else {
                        this.resetStats();
                    }
                }
            }
            this.updateStatsUI();
        });
    },

    updateAllModels: function() {
        this.getWithBearerCallback(this.getFullUrl(MODELS_ENDPOINT), this.api_key, (error, data) => {
            if (!error && data.data) {
                this.allModels = [];
                for (let model of data.data) {
                    this.allModels.push({
                        name: model.id,
                        recipe: model.recipe
                    });
                }
                this.createModelRows();
            }
        });
    },

    updateStats: function() {
        this.getWithBearerCallback(this.getFullUrl(STATS_ENDPOINT), this.api_key, (error, data) => {
            if (error) return;

            this.context = (data.cache_tokens || 0) + (data.input_tokens || 0) + (data.output_tokens || 0);
            this.tps = data.live && data.live.estimated_tokens_per_second ? data.live.estimated_tokens_per_second : (data.tokens_per_second || 0);
            this.updateStatsUI();
        });
    },

    getFullUrl: function(endpoint) {
        return `${this.api_url.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;
    },

    getWithBearerCallback: function(url, token, callback) {
        var _this = this;
        const session = this.sharedSession;
        if (!session) return;
        const message = Soup.Message.new('GET', url);
        message.request_headers.append('Authorization', `Bearer ${token}`);
        message.request_headers.append('Accept', 'application/json');

        session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const statusCode = message.status_code;
                    if (statusCode !== 200) {
                        callback.call(_this, new Error(`HTTP Error ${statusCode}: ${url}`), {code: statusCode});
                        return;
                    }
                    const decoder = new TextDecoder('utf-8');
                    const responseText = decoder.decode(bytes.get_data());
                    const data = JSON.parse(responseText);
                    callback.call(_this, null, data);
                } catch (e) {
                    callback.call(_this, e, {code: 0});
                }
            }
        );
    },

    postWithBearerCallback: function(url, token, requestData, callback) {
        var _this = this;
        const session = this.sharedSession;
        if (!session) return;
        const message = Soup.Message.new('POST', url);
        message.request_headers.append('Authorization', `Bearer ${token}`);
        message.request_headers.append('Accept', 'application/json');

        const jsonString = JSON.stringify(requestData);
        const bodyBytes = new TextEncoder().encode(jsonString);
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(bodyBytes));

        session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const statusCode = message.status_code;
                    if (statusCode < 200 || statusCode >= 300) {
                        callback.call(_this, new Error(`HTTP Error ${statusCode}: ${url}`), {code: statusCode});
                        return;
                    }
                    const decoder = new TextDecoder('utf-8');
                    const responseText = decoder.decode(bytes.get_data());
                    const data = responseText ? JSON.parse(responseText) : {};
                    callback.call(_this, null, data);
                } catch (e) {
                    callback.call(_this, e, {code: 0});
                }
            }
        );
    },

    // --------------------------------------------------------------------------------------------
    // Destroy
    // --------------------------------------------------------------------------------------------

    on_desklet_removed: function() {
        if (this.sharedSession) {
            this.sharedSession.abort();
            this.sharedSession = null;
        }

        if (this.mainloop) {
            Mainloop.source_remove(this.mainloop);
            this.mainloop = null;
        }
        this.resetData();
        // Remove all signal listeners is mandatory
        if (this.serverIcon && this.serverIconSig) this.serverIcon.disconnect(this.serverIconSig);
        this.removeModelRows();
        this.serverIconTooltip.destroy();
    }
};


function main(metadata, desklet_id) {
    try {
        return new LemonadeDesklet(metadata, desklet_id);
    } catch (e) {
        global.log(`CRASH INSIDE _INIT: ${e.stack}`);
        throw e;
    }
}
