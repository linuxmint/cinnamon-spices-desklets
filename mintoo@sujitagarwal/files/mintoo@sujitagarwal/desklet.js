const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Gettext = imports.gettext;

const uuid = "mintoo@sujitagarwal";

Gettext.bindtextdomain(uuid, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(uuid, str);
}

class MintooDesklet extends Desklet.Desklet {
    constructor(metadata) {
        super(metadata);
        this.metadata = metadata;
        this.uuid = this.metadata["uuid"];

        this._createUI();
    }

    _createUI() {
        this._container = new St.BoxLayout({ vertical: true, style_class: "mintoo-main-container" });

        this._row1 = new St.BoxLayout({ style_class: "mintoo-row-container" });
        this._row2 = new St.BoxLayout({ style_class: "mintoo-row-container" });

        this._mintoolabel = new St.Label({ style_class: "mintoo-button-move" });

        const buttonSettings = [
            { className: "mintoo-button mintoo-button-one", action: this._lockClickAction },
            { className: "mintoo-button mintoo-button-two", action: this._logoutClickAction },
            { className: "mintoo-button mintoo-button-three", action: this._shutdownClickAction },
            { className: "mintoo-button mintoo-button-four", action: this._rebootClickAction }
        ];

        buttonSettings.forEach((btn, index) => {
            const button = new St.Button({ style_class: btn.className });
            button.connect("clicked", btn.action.bind(this));
            if (index < 2) {
                this._row1.add(button);
            } else {
                this._row2.add(button);
            }
        });

        this._container.add(this._row1);
        this._container.add(this._row2);

        this.setContent(this._container);
    }

    _lockClickAction() {
        Util.spawnCommandLine("cinnamon-screensaver-command -l");
    }

    _logoutClickAction() {
        Util.spawnCommandLine("cinnamon-session-quit --logout");
    }

    _shutdownClickAction() {
        Util.spawnCommandLine("cinnamon-session-quit --power-off");
    }

    _rebootClickAction() {
        Util.spawnCommandLine("cinnamon-session-quit --reboot");
    }
}

function main(metadata) {
    return new MintooDesklet(metadata);
}
