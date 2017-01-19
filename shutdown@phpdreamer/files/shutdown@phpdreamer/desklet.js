const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;

function ShutdownDesklet(metadata) {
    this._init(metadata);
}

ShutdownDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata) {
        Desklet.Desklet.prototype._init.call(this, metadata);

        this.metadata = metadata;
        this.uuid = this.metadata["uuid"];

        this._container = new St.BoxLayout({vertical: true});
        this._container.set_style('background-color:' + this.metadata["color"] + ';padding:2px;');

        this._str = new St.Label();
        this._str.set_text("Shutdown");
        this._btn = new St.Button();
        this._lastClickedTimestamp = new Date() - 10000;
        this._btn.connect("clicked", Lang.bind(this, this._clicked));
        this._btn.set_style('background-image: url(\'' + GLib.get_home_dir()
        + "/.local/share/cinnamon/desklets/" + this.uuid + '/shutdown.png\');'
        + 'background-position: 0px 0px; width:64px; height:64px; display:block;');

        this._container.add(this._str);
        this._container.add(this._btn);
        this.setContent(this._container);
    },

    _clicked: function () {
        let clickedTimestamp = new Date();
        if (clickedTimestamp - this._lastClickedTimestamp > 250) {
            this._lastClickedTimestamp = clickedTimestamp;
            return;
        }
        Util.spawnCommandLine("dbus-send --system --print-reply --system --dest=org.freedesktop.ConsoleKit /org/freedesktop/ConsoleKit/Manager org.freedesktop.ConsoleKit.Manager.Stop");
    }
}

function main(metadata, desklet_id) {
    let desklet = new ShutdownDesklet(metadata, desklet_id);
    return desklet;
}
