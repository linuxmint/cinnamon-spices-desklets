/*
 * Copyright 2026 tidotua
*/

const Desklet = imports.ui.desklet;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const St = imports.gi.St;

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
        this.debugText.set_text(this.api_key);
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

