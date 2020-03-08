const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

function NetBeatDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

NetBeatDesklet.prototype = {
	__proto__: Desklet.Desklet.prototype,

	_init: function(metadata, desklet_id){
		Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
		this.setupUI();
		this.refresh();
		// set update intervall:
		//  1 beat = 86.4 sec.  Shorter update interval means more precise changing time of the .beat
		this.timeout = Mainloop.timeout_add_seconds(10, Lang.bind(this, this.refresh));         
		// only update, if the desklet is running
        this.keepUpdating = true;   
	},

	setupUI: function() {
		
		// I assume that the standard Desklet setting is with no decoration, in case of the header is visible, I set a text for it:
		this.setHeader("Internet Time");
		
		// Vertical frame, containing title and itime
		this.frame = new St.BoxLayout({vertical:true});
		this.row_title = new St.BoxLayout({vertical:false});
		this.row_itime = new St.BoxLayout({vertical:false});

		// as I want a red dot and black text, I combine 2 seperate labels.
		//	If there is a more simple solution, please tell me.
		//
		// You can change Font and Style here:
		// Red dot:
		this.title_text_1 = new St.Label();
		this.title_text_1.style = "font-family: 'FreeSans'; "
								+ "font-weight: bold; "
								+ "font-size: 20pt; "
								+ "color:red;";
		// Black "beat":
		this.title_text_2 = new St.Label();
		this.title_text_2.style = "font-family: 'FreeSans'; "
								+ "font-weight: bold; "
								+ "font-size: 20pt; "
								+ "color:black;";
		// Display of the .beats:												
		this.netbeat = new St.Label();
		this.netbeat.style = "font-family: 'FreeSans'; "
							+ "font-weight: bold; "
							+ "font-size: 15pt;";

			this.row_title.add(this.title_text_1);
			this.row_title.add(this.title_text_2);			
			this.row_itime.add(this.netbeat);

				this.frame.add(this.row_title, {x_fill: false, x_align: St.Align.MIDDLE});
				this.frame.add(this.row_itime, {x_fill: false, x_align: St.Align.MIDDLE});

		this.title_text_1.set_text(".");	
		this.title_text_2.set_text("beat");	

		this.setContent(this.frame);
		
    },
    
	on_desklet_removed: function() {
		
		Mainloop.source_remove(this.timeout);
	},
	
	refresh: function() {
		let d = new Date();
		let h = d.getHours();
		let m = d.getMinutes();
		let s = d.getSeconds();
		let tzoff = 60 + d.getTimezoneOffset();
		let beats = ('000' + Math.floor((s + (m + tzoff) * 60 + h * 3600) / 86.4) % 1000).slice(-3);
		this.netbeat.set_text("@" + beats);
		// only update, if the desklet is running
		return this.keepUpdating;	
	},

	on_desklet_clicked: function() {

	},

	on_desklet_removed: function() {
		// if the desklet is removed, stop updating, stop Mainloop
		this.keepUpdating = false;
		if (this.timeout) Mainloop.source_remove(this.timeout);
		this.timeout = 0;
	},

};	

function main(metadata, desklet_id) {
    return new NetBeatDesklet(metadata, desklet_id);
}
