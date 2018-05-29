const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const Cairo = imports.cairo;

function TopDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

TopDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.executeTop();
        this.setupUI();
    },

    setupUI: function() {

        this.colors = [];
        let num_cores = 0;
        for (num_cores = 0; num_cores < this.getCpuLoad().length; num_cores++) {
            this.colors.push(this.generateCircleColor());
        }

        // Create a main window        
		this.window = new Clutter.Actor();        
		this.setContent(this.window);
        
        // Refresh the main window
        this.refreshDecoration();
        this.refresh();
    },


   	refresh: function() {
                
		this.window.remove_all_children();

        // Execute top
        this.executeTop();

        let cpu_load = this.getCpuLoad();
        let cpu_core;
        let canvas;
        let circle;
        let x_position = 0;
        let y_position = 0;
        let large_font_size = 20;
        let normal_font_size = 13;
        let idle = "";
        let usage_label;
        let usage_text;
        let sub_label;
        let sub_text;

        for (cpu_core = 0; cpu_core < cpu_load.length; cpu_core++) {

            // Get CPU core idle time
            idle = parseInt(cpu_load[cpu_core].match(/([\d]{1,3}\.[\d]) id/i)[1]);
            // Calculate usage
            usage = 100 - idle;
    
            // Create usage circle
            usage_circle = new Clutter.Actor();
		    usage_circle.set_content(this.drawCircleCanvas(usage, 100, this.colors[cpu_core]));
		    usage_circle.set_size(150, 150);
            usage_circle.set_position(x_position, y_position);

            // Create usage label
            usage_text = usage + '%';
            usage_label = new St.Label();
            usage_label.set_position(x_position+(150 / 2) - ((large_font_size*usage_text.length/1.6) / 2), y_position+45);
			usage_label.set_text(usage_text);
            usage_label.style = "font-size: " + large_font_size + "px;font-family: 'Sawasdee', sans-serif;font-weight: 500";
            
            // Create sub label
            sub_text = 'Core ' + cpu_core;
            sub_label = new St.Label();
            sub_label.set_position(x_position+(157 / 2) - ((normal_font_size*sub_text.length/1.6) / 2), y_position+75);
			sub_label.set_text(sub_text);
            sub_label.style = "font-size: " + normal_font_size + "px;font-family: 'Sawasdee', sans-serif";

            // Add to main window
		    this.window.add_actor(usage_circle);
		    this.window.add_actor(usage_label);
		    this.window.add_actor(sub_label);

            // Recalculate positions
            x_position = x_position + 175;

            if(x_position == 700){
                y_position = y_position + 175;
                x_position = 0;
            }
        
        }

		// Refresh again in 5 seconds
		this.timeout = Mainloop.timeout_add_seconds(5, Lang.bind(this, this.refresh));
	},

	refreshDecoration: function() {
		// Remove decorations
		this.metadata["prevent-decorations"] = true;
		this._updateDecoration();
	},

    drawCircleCanvas: function(use, total, color) {
        
        let a = use;
        let b = total;

        let canvas = new Clutter.Canvas();
        canvas.set_size(150, 150);
		canvas.connect('draw', function (canvas, cr, width, height) {

            let offset = Math.PI*0.5;
	        let start = 0 - offset;
			let end = ((a*(Math.PI*2))/b) - offset;

			cr.save();
			cr.setOperator(Cairo.Operator.CLEAR);
			cr.paint();
			cr.restore();
			cr.setOperator(Cairo.Operator.OVER);
			cr.scale(width, height);
			cr.translate(0.5, 0.5);
			cr.setSourceRGBA(1, 1, 1, 0.2);
			cr.setLineWidth(0.20);
			cr.arc(0, 0, 0.4, 0, Math.PI*2);
			cr.stroke();
			cr.setSourceRGBA(color.r, color.g, color.b, color.a);
			cr.setLineWidth(0.20);
			cr.arc(0, 0, 0.4, start, end);
			cr.stroke();
			cr.setSourceRGBA(0, 0, 0, 0.1446);
			cr.setLineWidth(0.05);
			cr.arc(0, 0, 0.325, start, end);
			cr.stroke();

			return true;
        });

        canvas.invalidate();

        return canvas;
    },

    executeTop: function() {

        let subprocess = new Gio.Subprocess({
	        argv: ['top', '-bn2', '-d0.01'],
		    flags: Gio.SubprocessFlags.STDOUT_PIPE,
	    });

	    subprocess.init(null);

        this.top = subprocess.communicate_utf8(null, null)[1];
    },

    getCpuLoad: function () {
        let cpus = this.top.match(/%Cpu.+/g);
        return cpus.splice(Math.ceil(cpus.length / 2), cpus.length);
    },

    generateCircleColor: function() {
        let rgba = {
            r: Math.random(),
		    g: Math.random(),
		    b: Math.random(),
		    a: 1
        };
        return rgba;
    },

	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	}
    
}

function main(metadata, desklet_id) {
    return new TopDesklet(metadata, desklet_id);
}
