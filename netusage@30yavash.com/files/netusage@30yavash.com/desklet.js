//
// Network usage monitor v0.1 - 28 Sep 2013
//
// keeps track of your network usage.
// base on clem Network Usage Monitor applet.
//
// -Siavash Salemi
// 30yavash [at] gmail [dot] com
//
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;

const Clutter = imports.gi.Clutter;

function MyDesklet(metadata){
    this._init(metadata);
}

MyDesklet.prototype = {
	__proto__: Desklet.Desklet.prototype,

	_init: function(metadata){
		Desklet.Desklet.prototype._init.call(this, metadata);
		
		this.metadata = metadata
		this.labelSize = this.metadata["labelSize"];
		this.netDevice = this.metadata["netDevice"];
			
		this._deskletContainer = new St.BoxLayout({vertical:true, style_class: 'desklet-container'});
		
		this.labelWidget =  new St.BoxLayout({vertical:false, style_class: 'label-container'});

		this.labelContent = new St.Label();
		
		this.labelWidget.add(this.labelContent);
		this.labelContent.style="font-size: " + this.labelSize;


		this.imageWidget = new St.Bin({x_align: St.Align.MIDDLE}); 



		this._deskletContainer.add(this.labelWidget, {x_fill: false, x_align: St.Align.MIDDLE});
		this._deskletContainer.add_actor(this.imageWidget);
		this.setContent(this._deskletContainer);
		this.setHeader(_("Network Traffic"));
		this._updateWidget();
	},

	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	},

	_updateWidget: function(){
		//this.labelContent.set_text("Label");
        this._updateDevice();
		this._updateGraph();
		this.timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._updateWidget));
		
	},
    _updateDevice: function() {
        try {
            global.logError("device: " + this.netDevice);
            let activeConnections = this._client.get_active_connections();
            for (let i = 0; i < activeConnections.length; i++) {
                let a = activeConnections[i];
                if (a['default']) {
                    let devices = a.get_devices();
                    for (let j = 0; j < devices.length; j++) {
                        let d = devices[j];
                        if (d._delegate) {
                            this.netDevice = d.get_iface();
                            break;
                        }
                    }                        
                }
            }                                                  
        }
        catch (e) {
            //this.netDevice = "eth0";
            global.logError(e);
        }
    },
    _updateGraph: function() {
        try {
			//this._device = "wlan0";
            GLib.spawn_command_line_sync('vnstati -s -ne -i ' + this.netDevice + ' -o /tmp/vnstatlmapplet.png');
            let l = new Clutter.BinLayout();
            let b = new Clutter.Box();
            let c = new Clutter.Texture({keep_aspect_ratio: true, filter_quality: 2, filename: "/tmp/vnstatlmapplet.png"});
            b.set_layout_manager(l);            
            b.add_actor(c);
            this.imageWidget.set_child(b);

        }
        catch (e) {
            this.textWidget.set_text(" Please make sure vnstat and vnstati are installed and that the vnstat daemon is running! " + e + " ");
            global.logError(e);
        }
                
    }
}

function main(metadata, desklet_id){
	let desklet = new MyDesklet(metadata, desklet_id);
	return desklet;
}
