const Desklet = imports.ui.desklet;
const Gio = imports.gi.Gio;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Util = imports.misc.util;
const PopupMenu = imports.ui.popupMenu;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings; // ++ Needed if you use Settings Screen


let CONNECTED_STATE, NMClient_new, newNM;
const NM = imports.gi.NM;
  CONNECTED_STATE = NM.DeviceState.ACTIVATED;
  NMClient_new = NM.Client.new;
  newNM = true;

// l10n/translation
const Gettext = imports.gettext;
let UUID;

function _(str) {
    return Gettext.dgettext(UUID, str);
};

function MyDesklet(metadata, desklet_id){
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id){
        Desklet.Desklet.prototype._init.call(this, metadata);

        this.metadata = metadata
        this._Device = this.metadata["netDevice"];

            this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);

            this.settings.bindProperty(Settings.BindingDirection.IN,
                "useExtendedDisplay",
                "useExtendedDisplay",
                this.on_settings_changed);

            this.settings.bindProperty(Settings.BindingDirection.IN,
                "extendedDisplay",
                "extendedDisplay",
                this.on_settings_changed);

        // l10n/translation
        UUID = metadata.uuid;
        Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

        this._deskletContainer = new St.BoxLayout({vertical:true, style_class: 'desklet-container'});

        this.imageWidget = new St.Bin({x_align: St.Align.MIDDLE});

//      this._client = NMClient.Client.new();
        let args = newNM ? [null] : [];
        this._client = NMClient_new.apply(this, args);

        this._deskletContainer.add_actor(this.imageWidget);
        this.setContent(this._deskletContainer);
         this._updateWidget();
    },

    on_desklet_removed: function() {
        Mainloop.source_remove(this.timeout);
    },

 // ++ Function called when settings are changed
    on_settings_changed: function () {
            this._updateWidget();
    },

    _updateWidget: function(){
        this._updateDevice();
        this._updateGraph();
        this.timeout = Mainloop.timeout_add_seconds(2, Lang.bind(this, this._updateWidget));
},

    getInterfaces: function () {
        return this._client.get_devices();
    },

    isInterfaceAvailable: function (name) {
        let interfaces = this.getInterfaces();
        if (interfaces != null) {
           for (let i = 0; i < interfaces.length; i++) {
                let iname = interfaces[i].get_iface();
                if (iname == name && interfaces[i].state == CONNECTED_STATE) {

                   return true;
                 }
             }
        }
        return false;
    },

    _updateDevice: function() {
        try {
             this._device = "null"
             let interfaces = this.getInterfaces();
             if (interfaces != null) {
                 for (let i = 0; i < interfaces.length; i++) {
                    let iname = interfaces[i].get_iface();
                    if (this.isInterfaceAvailable(iname)) {
                        this._device = iname;
                    }
                }
            }
        }
        catch (e) {
//            global.logError(e); // Uncomment only for testing otherwise it fills error log when no connection present
        }
    },

    _updateGraph: function() {
        let path = `/tmp/${this._uuid}`;
        let instancePath = Gio.File.new_for_path(path);
        if (!instancePath.query_exists(null)) {
            if (!instancePath.make_directory(null)) {
                global.log(this._uuid, `Cannot make directory: ${path}`);
                return;
            }
        }

        try {
           if (this._device != "null") {
                if (!this.useExtendedDisplay) { this.extendedDisplay = "-s" };
                let image = `${path}/vnstatImage_${this._device}_${this.extendedDisplay}.png`;
                let command = 'vnstati ' + this.extendedDisplay + ' -ne -i ' + this._device + ' -o ' + image ;
                Util.spawnCommandLineAsync(command, () => {
                    const layout = new Clutter.BinLayout();
                    const box = new Clutter.Box();

                    const pixbuf = GdkPixbuf.Pixbuf.new_from_file(image);
                    const c_image = new Clutter.Image();
                    c_image.set_data(
                        pixbuf.get_pixels(),
                        pixbuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
                        pixbuf.get_width(),
                        pixbuf.get_height(),
                        pixbuf.get_rowstride()
                    );

                    const actor = new Clutter.Actor({width: pixbuf.get_width(), height: pixbuf.get_height()});
                    actor.set_content(c_image);

                    box.set_layout_manager(layout);
                    box.add_actor(actor);
                    this.imageWidget.destroy_all_children();
                    this.imageWidget.set_child(box);
                }, () => {
                    this._showErrorMessage("Error running vnstati command.\n");
                });
             }
        }
        catch (e) {
            this._showErrorMessage("Error: " + e.message + "\n");
        }
    },

    _showErrorMessage: function(message) {
        this.warnings = new St.BoxLayout({vertical: true});
        this.missingDependencies = new St.Label({text: message
            + _("Please make sure vnstat and vnstati are installed and that the vnstat daemon is running!")
            + "\n" + _("In Linux Mint, you can simply run 'apt install vnstati' and that will take care of everything.")
            + "\n" + _("In other distributions it might depend on the way things are packaged but its likely to be similar.")
            + "\n" + _("The Interface detected was: " + this._device )
        });
        this.warnings.add(this.missingDependencies);
        this.setContent(this.warnings);
    }
}



function main(metadata, desklet_id){
    let desklet = new MyDesklet(metadata, desklet_id);
    return desklet;
}
/*
# Change log since pdcurtis became involved
## 1.0.0
  * Changes to check which network manager libraries are in use and choose which to use - addresses/solves issue #1647 with Fedora versions 27 and higher.
  * Update README.md
## 1.0.1
  * Changes for Cinnamon 4.0 and higher to avoid segfaults when old Network Manager Library is no longer available by using multiversion with folder 4.0 - Issues #2094 and #2097
  * Remove Try-Catch as no longer required in 4.0 and associated changes.
  * It is believed that all Distributions packaging Cinnamon 4.0 have changed to the new Network Manager Libraries
## 1.0.2
  * Significant change to code to identify device as old code failed under Cinnamon 4.0
    - New code is identical to that used in applets vnstat@linuxmint.com and netusagemonitor@pdcurtis
  * Change "author" to "pdcurtis"
## 1.0.3
  * desklet_id to various functions
  * Add Configure (settings-schema.json) to applet
  * Provide options to choose different vnstati formats including a user specified format
  * Tidy code to remove trailing spaces
  * Change Icon to be unique and have better affordance
  * Add CHANGELOG.md and Update README.md
## 1.0.4
  * Correct Icon for Cinnamon 4.0
  * Extend number of choices of vnstati formats and remove custom option
  * Create folder for images and add extendedDisplay to image filename
  * Make command line calls asyncronous
  * Use Util.spawnCommandLineAsync for 3.6 and higher using code from  jaszhix
  * Correct potential memory leak identified by jaszhix
  * Update README.md
*/
