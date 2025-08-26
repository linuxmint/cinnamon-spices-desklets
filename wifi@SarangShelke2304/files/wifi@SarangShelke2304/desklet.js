
const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

function main(metadata, desklet_id) {
    return new WifiDesklet(metadata, desklet_id);
}

function WifiDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

WifiDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata);

        // Path to the icon image
        let iconPath = metadata.path + "/wifi.png";

        // Create image icon
        this._icon = new St.Icon({
            gicon: Gio.icon_new_for_string(iconPath),
            icon_size: 48,
            style_class: "system-status-icon"
        });
	this._container = new St.Bin({
            child: this._icon,
            reactive: true,
            track_hover: true,
            can_focus: true
        });
        this.setContent(this._container);
        this.metadata["prevent-decorations"] = true;
	this._updateDecoration();
        // Make the icon clickable
        this._container.connect("button-press-event", () => {
            this._openNetworkSettings();
        });
    },

    _openNetworkSettings: function() {
        try {
            GLib.spawn_command_line_async("cinnamon-settings network");
        } catch (e) {
            global.logError("Failed to open network settings: " + e.message);
        }
    },

    on_desklet_removed: function() {
        // Nothing to clean up
    }
};
