const Desklet = imports.ui.desklet;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Util = imports.misc.util;
const PopupMenu = imports.ui.popupMenu;
const GLib = imports.gi.GLib;

// Code for selecting network manager thanks to Jason Hicks
let tryFn = function(fn, errCb) {
  try {
    return fn();
  } catch (e) {
    if (typeof errCb === 'function') {
      errCb(e);
    }
  }
}

let CONNECTED_STATE, NMClient_new, newNM;
// Fallback to the new version.
tryFn(function() {
  const NMClient = imports.gi.NMClient;
  const NetworkManager = imports.gi.NetworkManager;
  CONNECTED_STATE = NetworkManager.DeviceState ? NetworkManager.DeviceState.ACTIVATED : 0;
  NMClient_new = NMClient.Client.new;
  newNM = false;
}, function() {
  const NM = imports.gi.NM;
  CONNECTED_STATE = NM.DeviceState.ACTIVATED;
  NMClient_new = NM.Client.new;
  newNM = true;
});

// l10n/translation
const Gettext = imports.gettext;
let UUID;

function _(str) {
    return Gettext.dgettext(UUID, str);
};

function MyDesklet(metadata){
    this._init(metadata);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata){
        Desklet.Desklet.prototype._init.call(this, metadata);

        this.metadata = metadata
        this._Device = this.metadata["netDevice"];

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

    _updateWidget: function(){
        this._updateDevice();
        this._updateGraph();
        this.timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._updateWidget));
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
        try {
           if (this._device != "null") { 
//                       global.logError("Testing output - detected device: " + this._device);   // Comment out unless testing
            GLib.spawn_command_line_sync('vnstati -s -ne -i ' + this._device + ' -o /tmp/vnstatlmapplet.png');
            }
            let l = new Clutter.BinLayout();
            let b = new Clutter.Box();
            let c = new Clutter.Texture({keep_aspect_ratio: true, filter_quality: 2, filename: "/tmp/vnstatlmapplet.png"});
            b.set_layout_manager(l);
            b.add_actor(c);
            this.imageWidget.set_child(b);

        }
        catch (e) {
            this.warnings = new St.BoxLayout({vertical: true});
            this.missingDependencies = new St.Label({text: _("Please make sure vnstat and vnstati are installed and that the vnstat daemon is running!") 
                                  + "\n" + _("In Linux Mint, you can simply run 'apt install vnstati' and that will take care of everything.") 
                                  + "\n" + _("In other distributions it might depend on the way things are packaged but its likely to be similar.")
                                  + "\n" + _("The Interface detected was: " + this._device )
});
            this.warnings.add(this.missingDependencies);
            this.setContent(this.warnings);
//            global.logError(e);
        }
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
*/
