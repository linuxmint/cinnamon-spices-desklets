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

        // TODO: move settings to the separate method
        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "api_url", "api_url", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "api_key", "api_key", this.onSettingChanged);

        this.sharedSession = new Soup.Session();
        this.launcher = new Gio.SubprocessLauncher({
            flags: (
                Gio.SubprocessFlags.STDIN_PIPE |
                Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.Subprocess.STDERR_PIPE)
        });

        this.resetData();
        this.setupUI();
        this.mainloop = Mainloop.timeout_add_seconds(5, () => {
            this.updateIteration();
            return true;
        });
        this.updateIteration();
    },

    resetData: function() {
        // TODO
    },

    setupUI: function() {
        this.window = new St.BoxLayout({
            vertical: true,
            style_class: "desklet",
            style: "border-radius: 10px; background-color: " + "#444" + "; padding: 10px; min-width: 400px;"
        });

        let serverHeader = this.setupHeaderUI();

        // DEBUG
        this.debugText = new St.Label();
        this.debugText.style = "font-size: " + 15 + "px;"
                         + "color: " + "#FFFFFF" + ";";

        this.window.add(serverHeader);
        this.window.add_actor(this.debugText);
        this.setContent(this.window);
    },

    setupHeaderUI: function() {
        let serverHeader = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            style: "padding-bottom: " + 10 + "px;"
        });

        let serverStatusCol = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            style: "padding-left: " + 15 + "px;"
        });

        let serverStatusRow1 = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            style: "padding-bottom: " + 5 + "px;"
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
        this.serverIconTooltip.set_text(this.api_url);

        if (this.serverIcon && this.serverIconSig) this.serverIcon.disconnect(this.serverIconSig);
        this.serverIconSig = this.serverIcon.connect('clicked', Lang.bind(this, function () {
            this.launcher.spawnv(['xdg-open', this.api_url]);
        }));

        this.nameText = new St.Label({
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.END,
            y_expand: true

        });
        this.nameText.style = "font-size: " + 20 + "px; color: " + "#FFFFFF" + "; padding-right: " + 10 +"px;";
        this.nameText.set_text(_("Lemonade Server"));

        this.versionText = new St.Label({
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
            x_expand: true,
            y_expand: true
        });
        this.versionText.style = "font-size: " + 16 + "px; color: " + "#FFFFFF" + ";";
        this.versionText.set_text(_("version"));

        this.statusText = new St.Label({
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.END,
            y_expand: true
        });
        this.statusText.style = "font-size: " + 20 + "px; color: " + "#FFFFFF" + "; padding-right: " + 10 +"px;";
        this.statusText.set_text(_("Status"));

        this.addressText = new St.Label({
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
            x_expand: true,
            y_expand: true
        });
        this.addressText.style = "font-size: " + 16 + "px; color: " + "#FFFFFF" + ";";

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

    onSettingChanged: function() {
        // TODO
    },

    updateIteration: function() {
        let unit_size = 15 * global.ui_scale;

        this.addressText.set_text(this.api_url);

        this.getWithBearerCallback(this.getFullUrl(HEALTH_ENDPOINT), this.api_key, (error, data) => {
            if (error) {
                this.debugText.set_text(error.message);
                return;
            }
            this.debugText.set_text(JSON.stringify(data, null, 2));
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
                        callback.call(_this, new Error(`HTTP Error ${statusCode}: ${url}`), null);
                        return;
                    }
                    const decoder = new TextDecoder('utf-8');
                    const responseText = decoder.decode(bytes.get_data());
                    const data = JSON.parse(responseText);
                    callback.call(_this, null, data);
                } catch (e) {
                    callback.call(_this, e, null);
                }
            }
        );
    },

    on_desklet_removed: function() {
        if (this.mainloop) {
            Mainloop.source_remove(this.mainloop);
        }
    }
};


function main(metadata, desklet_id) {
    return new LemonadeDesklet(metadata, desklet_id);
}

