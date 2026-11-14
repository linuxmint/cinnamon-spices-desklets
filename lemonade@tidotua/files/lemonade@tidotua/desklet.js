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

imports.gi.versions.Soup = '3.0';
const Soup = imports.gi.Soup;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const HEALTH_ENDPOINT = "health";

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
    },

    onSettingChanged: function() {
        this.resetData();
        this.updateServerAddressUI();
        this.restartMainLoop();
    },

    // --------------------------------------------------------------------------------------------
    // Data
    // --------------------------------------------------------------------------------------------

    resetData: function() {
        this.server_url=`http://${this.server_addr.replace(/\/$/, '')}:${this.server_port}`;
        this.api_url = `${this.server_url}/${this.api_version.replace(/^\//, '')}`

        if (this.activeModels) {
            this.activeModels.clear();
        } else {
            this.activeModels = new Map();
        }

        if (this.allModels) {
            // TODO: unlink click listeners and cleanup of UI
            this.allModels.length = 0;
        } else {
            this.allModels = [];
        }
    },

    // --------------------------------------------------------------------------------------------
    // UI
    // --------------------------------------------------------------------------------------------

    setupUI: function() {
        //let unit_size = 15 * global.ui_scale;

        this.window = new St.BoxLayout({
            vertical: true,
            style_class: "lemonade-container",
            //style: "background-color: " + "#444" + ";" // TODO: change color and transparency from settings
        });

        let serverHeader = this.setupHeaderUI();

        // DEBUG
        this.debugText = new St.Label();
        this.debugText.style_class = "lemonade-text-medium lemonade-text-active";

        this.window.add(serverHeader);
        this.window.add_actor(this.debugText);
        this.setContent(this.window);

        this.updateServerAddressUI();
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
            style_class: "lemonade-text-big lemonade-text-active lemonade-text-left lemonade-text-important",
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
            style_class: "lemonade-text-big lemonade-text-active lemonade-text-left",
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

    updateServerAddressUI: function() {
        this.addressText.set_text(_("Address") + ": " + this.server_addr);
        this.serverIconTooltip.set_text(this.server_url);

        if (this.serverIcon && this.serverIconSig) this.serverIcon.disconnect(this.serverIconSig);
        this.serverIconSig = this.serverIcon.connect('clicked', Lang.bind(this, function () {
            this.launcher.spawnv(['xdg-open', this.server_url]);
        }));
    },

    // --------------------------------------------------------------------------------------------
    // Logic
    // --------------------------------------------------------------------------------------------

    updateIteration: function() {
        this.getWithBearerCallback(this.getFullUrl(HEALTH_ENDPOINT), this.api_key, (error, data) => {
            if (error) {
                switch (data.code) {
                    case 0:
                        this.statusText.set_text(_("Offline"));
                        break;

                    case 401:
                        this.statusText.set_text(_("Error: Missing API key"));
                        break;

                    default:
                        this.statusText.set_text(_("HTTP Error ") + data.code);
                }
                this.statusText.style_class = "lemonade-text-medium lemonade-text-left lemonade-text-bad lemonade-text-important";

                this.debugText.set_text(error.message);

                return;
            } else {
                this.statusText.set_text(_("Online"));
                this.statusText.style_class = "lemonade-text-medium lemonade-text-left lemonade-text-good lemonade-text-important";
                if (data.version)
                    this.versionText.set_text(_("Version") + ": " + data.version);

                if (data.all_models_loaded) {
                    var debug_text = "Models:\n";

                    for (let model of data.all_models_loaded) {
                        this.activeModels.set(model.model_name, {
                            device: model.device,
                            recipe: model.recipe,
                            is_busy: model.is_busy,
                            status: model.status,
                        });

                        debug_text = debug_text + model.model_name
                            + " (" + model.device + "/" + model.recipe + ") "
                            + " is_busy = " + model.is_busy + ", status = " + model.status + "\n";
                    }

                    this.debugText.set_text(debug_text); // DEBUG
                }
            }
        });
    },


    getFullUrl: function(endpoint) {
        return `${this.api_url.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;
    },

    getWithBearerCallback: function(url, token, callback) {
        var _this = this;
        const session = this.sharedSession;
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

    // --------------------------------------------------------------------------------------------
    // Destroy
    // --------------------------------------------------------------------------------------------

    on_desklet_removed: function() {
        if (this.mainloop) {
            Mainloop.source_remove(this.mainloop);
        }
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
