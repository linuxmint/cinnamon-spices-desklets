/*
 * Copyright 2026 tidotua
*/

const Desklet = imports.ui.desklet;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const St = imports.gi.St;

imports.gi.versions.Soup = '3.0';
const Soup = imports.gi.Soup;
const GLib = imports.gi.GLib;

function LemonadeDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id)
}

LemonadeDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "api_url", "api_url", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "api_key", "api_key", this.onSettingChanged);

        this.sharedSession = new Soup.Session();

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
            style: "border-radius: " + 10 + "px; background-color: " + "#444" + "; padding: " + 10 + "px;"
        });

        this.addressText = new St.Label();
        this.addressText.style = "font-size: " + 20 + "px; color: " + "#FFFFFF" + "; padding-bottom: " + 10 +"px;";

        this.debugText = new St.Label();
        this.debugText.style = "font-size: " + 15 + "px;"
                         + "color: " + "#FFFFFF" + ";";

        this.window.add_actor(this.addressText);
        this.window.add_actor(this.debugText);
        this.setContent(this.window);
    },

    onSettingChanged: function() {
        // TODO
    },

    updateIteration: function() {
        let unit_size = 15 * global.ui_scale;

        this.addressText.set_text(this.api_url);

        this.getWithBearerCallback(this.api_url + "/health", this.api_key, (error, data) => {
            if (error) {
                this.debugText.set_text(error.message);
                return;
            }
            this.debugText.set_text(JSON.stringify(data, null, 2));
        });
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

