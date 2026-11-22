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

const HEALTH_ENDPOINT   = "health";
const MODELS_ENDPOINT   = "models";
const LOAD_ENDPOINT     = "load";
const UNLOAD_ENDPOINT   = "unload";
const STATS_ENDPOINT    = "stats";

const SERVER_ONLINE     = 0;
const SERVER_OFFLINE    = 503;
const SERVER_API_KEY    = 401;

const SERVER_VERSION_UNDEFINED = 0;

const ICON_SIZE = 48;

function LemonadeDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id)
}

LemonadeDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.setupSettings(desklet_id);

        this.sharedSession = new Soup.Session();
        this.activeModels = new Map();
        this.allModels = [];

        this.resetServerURL();
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
            global.logWarning("UPDATE INTERVAL was not defined, fallback to " + this.update_interval);
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
        this.settings.bindProperty(Settings.BindingDirection.IN, "server_addr", "server_addr", this.onServerChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "server_port", "server_port", this.onServerChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "api_version", "api_version", this.onServerChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "api_key", "api_key", this.onServerChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "update_interval", "update_interval", this.onUpdateIntervalChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "background_color", "background_color", this.updateStyles);
    },

    onServerChanged: function() {
        this.resetServerURL();
        this.resetData();
        this.updateServerAddressUI();
        this.updateServerStatusUI();
        this.updateStatsUI();

        this.removeModelRows();
    },

    onUpdateIntervalChanged: function() {
        this.restartMainLoop();
    },

    // --------------------------------------------------------------------------------------------
    // Data
    // --------------------------------------------------------------------------------------------

    resetData: function() {
        this.serverError = SERVER_OFFLINE;
        this.serverVersion = SERVER_VERSION_UNDEFINED;
        this.resetStats();
        this.resetModels();
    },

    resetModels: function() {
        this.activeModels.clear();
        this.allModels.length = 0;
        this.modelsGeneration = undefined;
        this.model_loaded = undefined;
    },

    resetStats: function() {
        this.context = 0;
        this.context_total = 0;
        this.tps = 0;
    },

    resetServerURL: function() {
        let addr = this.server_addr.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
        this.server_url = `http://${addr}:${this.server_port}`;
        this.api_url = `${this.server_url}/${this.api_version.replace(/^\//, '')}`
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
        this.window.add(this.topSeparator);
        this.window.add(statsRow);
        this.window.add(this.bottomSeparator);
        this.window.add(this.modelsTable);

        this.setContent(this.window);

        this.modelListUI = [];

        this.updateServerAddressUI();
        this.updateServerStatusUI();
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

        this.serverIcon = new St.Button();
        this.serverIcon.height = ICON_SIZE;
        this.serverIcon.width = ICON_SIZE;

        let icon_file = this.metadata.path + '/' + "icon.png";
        let file = Gio.file_new_for_path(icon_file);
        let icon_uri = file.get_uri();

        let image = St.TextureCache.get_default().load_uri_async(icon_uri, ICON_SIZE, ICON_SIZE);
        this.serverIcon.set_child(image);
        this.serverIconTooltip = new Tooltips.Tooltip(this.serverIcon);

        this.serverIconSig = this.serverIcon.connect('clicked', () => {
            try {
                Gio.AppInfo.launch_default_for_uri(this.server_url, null);
            } catch (e) {
                global.logError("Could not open " + this.server_url + ": " + e.message);
            }
        });

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
            style_class: "lemonade-text-medium lemonade-text-active",
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
        serverStatusRow1.add(this.nameText);
        serverStatusRow1.add(this.versionText);
        serverStatusRow2.add(this.statusText);
        serverStatusRow2.add(this.addressText);

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

        this.statsRow.add(this.contextText);
        this.statsRow.add(this.tpsText);

        return this.statsRow;
    },

    updateStyles: function() {
        this.window.style ="background-color: " + this.background_color + ";";
    },

    updateServerAddressUI: function() {
        this.addressText.set_text(_("Address") + ": " + this.server_addr + ":" + this.server_port);
        this.serverIconTooltip.set_text(this.server_url);
    },

    updateServerStatusUI: function() {
        switch (this.serverError) {
            case SERVER_ONLINE:
                this.statusText.set_text(_("Online"));
                this.statusText.style_class = "lemonade-text-medium lemonade-text-left lemonade-text-good lemonade-text-important";
                break;

            case SERVER_OFFLINE:
                this.statusText.set_text(_("Offline"));
                this.statusText.style_class = "lemonade-text-medium lemonade-text-left lemonade-text-inactive lemonade-text-important";
                break;

            case SERVER_API_KEY:
                this.statusText.set_text(_("Error: Invalid or missing API key"));
                this.statusText.style_class = "lemonade-text-medium lemonade-text-left lemonade-text-bad lemonade-text-important";
                break;

            default:
                this.statusText.set_text(_("HTTP Error ") + this.serverError);
                this.statusText.style_class = "lemonade-text-medium lemonade-text-left lemonade-text-bad lemonade-text-important";
        }

        let version = (this.serverVersion == SERVER_VERSION_UNDEFINED) ? _("unknown") : this.serverVersion;
        this.versionText.set_text(_("Version") + ": " + version.split("~")[0]);
    },

    updateStatsUI: function() {
        if (this.serverError == SERVER_ONLINE) {
            let active = this.activeModels.size > 0;
            let style = active ? "lemonade-text-active" : "lemonade-text-inactive";
            let context = (active ? this.context : 0) / 1000.0; // Use k measure
            let context_total = (active ? this.context_total : 0) / 1000.0; // Use k measure
            let context_percent = ((active && this.context_total) ? 100 * this.context / this.context_total : 0);
            let tps = active ? this.tps : 0;

            this.contextText.set_text(_("Context") + `:   ${context.toFixed(0)}K` +
                ((active && this.context_total) ? ` / ${context_total.toFixed(0)}K (${context_percent.toFixed(0)}%)` : ""));
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

    modelClickAction: function(name, is_active) {
        return () => {
            let prompt = (is_active ?
                _("Do you want to unload model?") :
                _("Do you want to load model?")) + "\n\n" + name;
            this.showConfirmDialog(prompt, () => {
                this.postWithBearerCallback(
                    this.getFullUrl(is_active ? UNLOAD_ENDPOINT : LOAD_ENDPOINT),
                    this.api_key,
                    { model_name: name },
                    (err, data) => {
                        if (err) global.logError("Model action failed: " + err.message);
                    }
                );
            });
        };
    },

    createModelRow: function(name, recipe, is_active, is_busy) {
        let modelButton = new St.Button({
            reactive: true,
            x_expand: true,
            y_expand: true,
            x_fill: true,
            x_align: Clutter.ActorAlign.FILL,
            style_class: "lemonade-box-bottom"
        });

        let modelTooltip = new Tooltips.Tooltip(modelButton);

        let sig = modelButton.connect('clicked', () => {
            if (modelButton.clickCallback) {
                modelButton.clickCallback();
            }
        });

        let container = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL
        });

        let nameText = new St.Label({
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.END,
            y_expand: true
        });

        let recipeText = new St.Label({
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.END,
            y_expand: true
        });

        let statusText = new St.Label({
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
            x_expand: false, // use this to align this column
            y_expand: true
        });

        container.add(nameText);
        container.add(recipeText);
        container.add(statusText);
        modelButton.set_child(container);

        return { ui: {
            row: modelButton,
            tooltip: modelTooltip,
            name: nameText,
            recipe: recipeText,
            status: statusText,
            signal: sig
        }};
    },

    updateModelRow: function(modelRow, name, recipe, is_active, is_busy) {
        let status = is_active ? (is_busy ? _("Busy") : _("Ready")) : _("Off");
        let status_style = is_active ? (is_busy ? "lemonade-text-bad" : "lemonade-text-good") : "lemonade-text-inactive";
        let active_style = is_active ? "lemonade-text-active " : "lemonade-text-inactive";

        modelRow.ui.tooltip.set_text(is_active ? _("Unload model") + " " + name :
            _("Load model") + " " + name);
        modelRow.ui.name.set_text(name);
        modelRow.ui.name.style_class = "lemonade-text-medium lemonade-text-left" + " " + active_style;
        modelRow.ui.recipe.set_text(recipe);
        modelRow.ui.recipe.style_class = "lemonade-text-medium lemonade-text-middle" + " " + active_style;
        modelRow.ui.status.set_text(status);
        modelRow.ui.status.style_class = "lemonade-text-medium lemonade-text-right" + " " + status_style;

        modelRow.ui.row.clickCallback = this.modelClickAction(name, is_active);

        modelRow.data = {}
        modelRow.data.name = name;
        modelRow.data.recipe = recipe;
        modelRow.data.is_active = is_active;
        modelRow.data.is_busy = is_busy;
    },

    compareModelRow: function(modelRow, name, recipe, is_active, is_busy) {
        return modelRow.data.name == name &&
            modelRow.data.recipe == recipe &&
            modelRow.data.is_active == is_active &&
            modelRow.data.is_busy == is_busy;
    },

    recycleModelRow: function(index, name, recipe, is_active, is_busy) {
        let modelRow;
        if (index < this.modelListUI.length) {
            modelRow = this.modelListUI[index];
            if (this.compareModelRow(modelRow, name, recipe, is_active, is_busy)) {
                return;
            }
        } else {
            modelRow = this.createModelRow(name, recipe, is_active, is_busy);
            this.modelListUI.push(modelRow);
            this.modelsTable.add(modelRow.ui.row);
        }
        this.updateModelRow(modelRow, name, recipe, is_active, is_busy);
    },

    updateModelRows: function() {
        let i = 0;

        this.activeModels.forEach((model, name) => {
            let recipe = `${model.recipe}:${model.device}`;
            this.recycleModelRow(i, name, recipe, true, model.is_busy);
            ++i;
        });

        for (let model of this.allModels) {
            if (this.activeModels.has(model.name)) continue;
            this.recycleModelRow(i, model.name, model.recipe, false, false);
            ++i;
        }

        // Cleanup
        if (i < this.modelListUI.length) {
            let newSize = i;
            for (; i < this.modelListUI.length; i++) {
                this.removeModelRow(this.modelListUI[i]);
            }
            this.modelListUI.length = newSize;
        }
    },

    removeModelRow: function(modelRow) {
        if (modelRow.ui.row) {
            if (modelRow.ui.signal) modelRow.ui.row.disconnect(modelRow.ui.signal);
            if (modelRow.ui.tooltip) modelRow.ui.tooltip.destroy();
            modelRow.ui.row.destroy();
        }
    },

    removeModelRows: function() {
        for (let modelRow of this.modelListUI) {
            this.removeModelRow(modelRow);
        }

        this.modelListUI.length = 0;
    },

    // --------------------------------------------------------------------------------------------
    // Logic
    // --------------------------------------------------------------------------------------------

    updateIteration: function() {
        if (this.destroyed) return;
        this.updateActiveModels();
    },

    updateActiveModels: function() {
        this.getWithBearerCallback(this.getFullUrl(HEALTH_ENDPOINT), this.api_key, (error, data) => {
            if (this.destroyed) return;

            if (error) {
                global.logError("Active models get error: " + error.message);
                this.resetData();
                this.removeModelRows();
                this.serverError = data.code;
            } else {
                this.serverError = SERVER_ONLINE;

                if (data.version) {
                    this.serverVersion = data.version;
                }

                this.model_loaded = data.model_loaded;

                if (data.all_models_loaded) {
                    this.activeModels.clear();
                    for (let model of data.all_models_loaded) {
                        this.activeModels.set(model.model_name, {
                            device: model.device,
                            recipe: model.recipe,
                            is_busy: model.is_busy
                        });
                    }

                    if (data.models_generation !== this.modelsGeneration) {
                        this.modelsGeneration = data.models_generation;
                        this.updateAllModels();
                    } else {
                        // We should still update active models status even whole list was not changed
                        this.updateModelRows();
                    }

                    if (this.activeModels.size > 0) {
                        this.updateStats();
                    } else {
                        this.resetStats();
                    }
                }
            }
            this.updateServerStatusUI();
            this.updateStatsUI();
        });
    },

    updateAllModels: function() {
        this.getWithBearerCallback(this.getFullUrl(MODELS_ENDPOINT), this.api_key, (error, data) => {
            if (this.destroyed) return;

            if (error) {
                global.logError("All models get error: " + error.message);
                this.modelsGeneration = undefined;
                return;
            }

            if (!error && data.data) {
                this.allModels = [];
                for (let model of data.data) {
                    this.allModels.push({
                        name: model.id,
                        recipe: model.recipe,
                        context_length: model.context_length
                    });
                }
                this.updateModelRows();
            }
        });
    },

    updateStats: function() {
        this.getWithBearerCallback(this.getFullUrl(STATS_ENDPOINT), this.api_key, (error, data) => {
            if (this.destroyed) return;

            if (error) {
                global.logError("Stats get error: " + error.message);
                return;
            }

            if (!error && data) {
                this.context =
                    (data.cache_tokens || 0) +
                    (data.input_tokens || 0) +
                    (data.output_tokens || 0);

                // Suggest last loaded model was used for last inference
                if (this.model_loaded) {
                    this.context_total = 0;
                    for (let model of this.allModels) {
                        if (model.name == this.model_loaded) {
                            this.context_total = model.context_length;
                            break;
                        }
                    }
                }

                this.tps = data.live && data.live.estimated_tokens_per_second ?
                    data.live.estimated_tokens_per_second :
                    (data.tokens_per_second || 0);

                this.updateStatsUI();
            }
        });
    },

    // --------------------------------------------------------------------------------------------
    // API
    // --------------------------------------------------------------------------------------------


    getFullUrl: function(endpoint) {
        return `${this.api_url.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;
    },

    getWithBearerCallback: function(url, token, callback) {
        const message = this.createMessage('GET', url, token);
        this.sendAsync(message, callback);
    },

    postWithBearerCallback: function(url, token, requestData, callback) {
        const message = this.createMessage('POST', url, token);

        const jsonString = JSON.stringify(requestData);
        const bodyBytes = new TextEncoder().encode(jsonString);
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(bodyBytes));

        this.sendAsync(message, callback);
    },

    createMessage: function(method, url, token) {
        let message = Soup.Message.new(method, url);
        if (token) {
            message.request_headers.append('Authorization', `Bearer ${token}`);
        }
        message.request_headers.append('Accept', 'application/json');
        return message;
    },

    sendAsync: function(message, callback) {
        var _this = this;
        const session = this.sharedSession;
        if (!session) return;

        session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const statusCode = message.status_code;
                    if (statusCode < 200 || statusCode >= 300) {
                        callback.call(
                            _this,
                            new Error(`HTTP Error ${statusCode}: ${message.uri}`),
                            {code: statusCode}
                        );
                        return;
                    }
                    const decoder = new TextDecoder('utf-8');
                    const responseText = decoder.decode(bytes.get_data());
                    if (responseText) {
                        try {
                            const data = JSON.parse(responseText);
                            callback.call(_this, null, data);
                        } catch (e) {
                            callback.call(
                                _this,
                                new Error(`Invalid JSON from server: ${message.uri}`),
                                {code: SERVER_OFFLINE}
                            );
                            return;
                        }
                    } else {
                        callback.call(_this, null, {});
                    }
                } catch (e) {
                    callback.call(_this, e, {code: SERVER_OFFLINE});
                }
            }
        );
    },

    // --------------------------------------------------------------------------------------------
    // Destroy
    // --------------------------------------------------------------------------------------------

    on_desklet_removed: function() {
        this.destroyed = true;

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
        this.serverIconTooltip.destroy();
        this.removeModelRows();
    }
};


function main(metadata, desklet_id) {
    try {
        return new LemonadeDesklet(metadata, desklet_id);
    } catch (e) {
        global.logError(`CRASH INSIDE main: ${e.stack}`);
        throw e;
    }
}
