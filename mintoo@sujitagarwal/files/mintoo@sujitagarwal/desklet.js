const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Gettext = imports.gettext;
const uuid = "mintoo@sujitagarwal";

Gettext.bindtextdomain(uuid, GLib.get_home_dir() + "/.local/share/locale")

function _(str) {
  return Gettext.dgettext(uuid, str);
}

function MintooDesklet(metadata) {
    this._init(metadata);
}

MintooDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata) {
        Desklet.Desklet.prototype._init.call(this, metadata);

        this.metadata = metadata;
        this.uuid = this.metadata["uuid"];

        this._container = new St.BoxLayout({vertical:true, style_class: "MintooMainContainer"});
        this._row1 = new St.BoxLayout({style_class: "MintooRowContainer"});
        this._row2 = new St.BoxLayout({style_class: "MintooRowContainer"});

        this._mintoolabel = new St.Label({style_class: "MintooButtonMove"});
        this._container.add(this._mintoolabel);

        this._btnLockDesktop = new St.Button({style_class: "MintooButtonOne"});
        this._btnLogoutSession = new St.Button({style_class: "MintooButtonTwo"});
        this._btnLogoutSession.connect("clicked", Lang.bind(this, this._logoutClickAction));
        this._btnLockDesktop.connect("clicked", Lang.bind(this, this._lockClickAction));

        this._row1.add(this._btnLockDesktop);
        this._row1.add(this._btnLogoutSession);
        this._container.add(this._row1);

        this._btnShutdown = new St.Button({style_class: "MintooButtonThree"});
        this._btnReboot = new St.Button({style_class: "MintooButtonFour"});
        this._btnShutdown.connect("clicked", Lang.bind(this, this._shutdownClickAction));
        this._btnReboot.connect("clicked", Lang.bind(this, this._rebootClickAction));
        this._row2.add(this._btnShutdown);
        this._row2.add(this._btnReboot);
        this._container.add(this._row2);

        this._lastClickedTimestamp = new Date() - 10000;

        this.setContent(this._container);
    },

    _lockClickAction: function () {
        let clickedTimestamp = new Date();
        if (clickedTimestamp - this._lastClickedTimestamp > 250) {
            this._lastClickedTimestamp = clickedTimestamp;
            return;
        }
        Util.spawnCommandLine("cinnamon-screensaver-command -l");
    },

    _logoutClickAction: function () {
        let clickedTimestamp = new Date();
        if (clickedTimestamp - this._lastClickedTimestamp > 250) {
            this._lastClickedTimestamp = clickedTimestamp;
            return;
        }
        Util.spawnCommandLine("cinnamon-session-quit --logout");
    },

    _shutdownClickAction: function () {
        let clickedTimestamp = new Date();
        if (clickedTimestamp - this._lastClickedTimestamp > 250) {
            this._lastClickedTimestamp = clickedTimestamp;
            return;
        }
        Util.spawnCommandLine("cinnamon-session-quit --power-off");
    },

    _rebootClickAction: function () {
        let clickedTimestamp = new Date();
        if (clickedTimestamp - this._lastClickedTimestamp > 250) {
            this._lastClickedTimestamp = clickedTimestamp;
            return;
        }
        Util.spawnCommandLine("cinnamon-session-quit --reboot");
    }
}

function main(metadata, desklet_id) {
    let desklet = new MintooDesklet(metadata, desklet_id);
    return desklet;
}
