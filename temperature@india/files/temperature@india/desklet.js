const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Clutter = imports.gi.Clutter;
const Cairo = imports.gi.cairo;
const Settings = imports.ui.settings;

const UUID = "temperature@india";

function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata);
        
        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "text_color", this.on_setting_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "text-size", "text_size", this.on_setting_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scale_size", this.on_setting_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "update-interval", "update_interval", this.on_setting_changed, null);

        this.sensorsData = [];
        this.sensorsPath = '/usr/bin/sensors';

        let desklet_path = GLib.get_user_data_dir() + "/cinnamon/desklets/" + this.metadata["uuid"];
        this.img_path = desklet_path + "/img/thermometer.svg";
        this.mercury_img_path = desklet_path + "/img/mercury.svg"; 
        
        this.mainContainer = new St.Widget({ 
            style: `background-image: url('${this.img_path}'); 
                    background-size: 50px 500px; 
                    background-repeat: no-repeat; 
                    background-position: 0px 0px; 
                    background-color: transparent;`,
            layout_manager: new Clutter.BinLayout() 
        });
        
        // Create the Mercury Widget
        this.mercuryWidget = new St.Widget({
            style: `background-image: url('${this.mercury_img_path}');
                    background-size: 3px 500px;
                    background-position: 0px 0px;
                    background-repeat: no-repeat;`
        });
        
        this.setContent(this.mainContainer);

        Util.spawn_async(['which', 'sensors'], (ret) => {
            if (ret && ret.toString().trim() !== "") {
                this.sensorsPath = ret.toString().split('\n', 1)[0].trim();
                this.updateTemperature();
            }
        });
    },

    on_setting_changed: function() {
        this.updateTemperature();
    },

    updateTemperature: function() {
        if (this.sensorsPath) {
            Util.spawn_async([this.sensorsPath], (output) => {
                if (output) {
                    this._parseAllSensors(output.toString());
                }
            });
        }
        
        if (this.timeoutId) Mainloop.source_remove(this.timeoutId);
        this.timeoutId = Mainloop.timeout_add_seconds(
            this.update_interval || 2, 
            () => this.updateTemperature()
        );
    },

    _parseAllSensors: function(text) {
        let regex = /([^:\n]+):\s+\+?(\d+\.\d+)°C/g;
        let match;
        let newData = [];
        while ((match = regex.exec(text)) !== null) {
            let label = match[1].trim();
            let icon = "🌡️";
            if (label.toLowerCase().includes("core")) icon = "⚡"; 
            else if (label.toLowerCase().includes("gpu")) icon = "🔥"; 
            
            newData.push({ 
                label: label, 
                icon: icon,
                temp: Math.round(parseFloat(match[2])) 
            });
        }
        this.sensorsData = newData;
        this.refreshUI();
    },
    
	refreshUI: function() {
        this.mainContainer.destroy_all_children();
        
        let scale = this.scale_size || 1.0;
        let maxHeight = 400 * scale; 
        let width = 250 * scale;
        let fontSize = this.text_size || 14;
        let fontColor = this.text_color || 'white';
        let upperOffset = 30;
        let startY = 30; 
        let scaleX = 50 * scale; 

        this.mainContainer.set_size(width, maxHeight+100);

        // Draw Scale Markings (0 to 100)
        for (let i = 0; i <= 100; i += 10) {
            let yPos = upperOffset + (maxHeight * (100 - i)/100);
            let markLabel = new St.Label({ 
                text: i.toString(), 
                style: `font-size: ${10 * scale}px; color: rgba(0,0,0,1); font-weight: bold;` 
            });
            this.mainContainer.add_actor(markLabel);
            markLabel.set_position(30, yPos);
        }
        
        // Draw Sensor Pointers
        for (let sensor of this.sensorsData) {
            let row = new St.BoxLayout({ vertical: false, style: "align-items: center;" });
            let percentage = Math.min(Math.max(sensor.temp, 0), 100) / 100;
            let yPos = startY + maxHeight*(1-percentage);

            let arrowCanvas = new Clutter.Canvas();
            arrowCanvas.set_size(30 * scale, 15 * scale);
            arrowCanvas.connect('draw', (canvas, cr, w, h) => {
                this._drawVibrantPointer(cr, w, h, sensor.temp, scale);
            });
            let arrowActor = new Clutter.Actor({ width: 30 * scale, height: 15 * scale });
            arrowActor.set_content(arrowCanvas);
            arrowCanvas.invalidate();

            let contentLabel = new St.Label({ 
                text: `${sensor.icon} ${sensor.temp}° ${sensor.label}`, 
                style: `font-size: ${fontSize}px; color: ${fontColor}; font-weight: bold;` 
            });
            contentLabel.set_size(300,20);
            //arrowActor.set_size(30,15);
            row.add_actor(arrowActor);
            row.add_actor(contentLabel);

            row.set_position(scaleX, yPos);
            this.mainContainer.add_actor(row);
        }
        // Calculate Tctl Mercury Logic
        let tctlSensor = this.sensorsData.find(s => s.label === "Tctl") || { temp: 0 };
        let mercuryPercentage = Math.min(Math.max(tctlSensor.temp, 0), 100) / 100;
        
        let mercuryWidth = 3 * scale; 
        //let mercuryX = 32 * scale; // Tweak this to move left/right into the tube
        let mercuryFillHeight = mercuryPercentage * maxHeight;
        let mercuryY = upperOffset + maxHeight - mercuryFillHeight;
	
	let thermo_height = 500 * scale;
        let thermo_width = 50 * scale;
        this.mainContainer.set_size(thermo_width, thermo_height);
       	this.mainContainer.set_style(`
        	background-image: url('${this.img_path}'); 
                background-size: ${thermo_width}px ${thermo_height}px; 
                background-repeat: no-repeat; 
                background-position: bottom; 
                `);
        
        // Setup Mercury Widget
        this.mercuryWidget.set_size(mercuryWidth, mercuryFillHeight);
        this.mercuryWidget.set_position(23*scale, mercuryY);
        this.mercuryWidget.set_style(`
            background-image: url('${this.mercury_img_path}');
            background-size: ${mercuryWidth}px ${mercuryFillHeight}px;
            background-position: bottom;
            background-repeat: no-repeat;
        `);
        
        // Insert at index 0 to ensure it is the BOTTOM layer
        this.mainContainer.insert_child_at_index(this.mercuryWidget, 0);

        
    },

    _drawVibrantPointer: function(cr, width, height, temp, scale) {
        cr.save();
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.restore();

        let h = height;
        if (temp < 45) cr.setSourceRGBA(0, 0.8, 1, 1);
        else if (temp < 75) cr.setSourceRGBA(1, 0.8, 0, 1);
        else cr.setSourceRGBA(1, 0.1, 0, 1);

        cr.setLineWidth(2 * scale);
        cr.moveTo(10 * scale, h/2 - 7 * scale); 
        cr.lineTo(0, h/2); 
        cr.lineTo(10 * scale, h/2 + 7 * scale);
        cr.stroke();

        cr.setSourceRGBA(1, 1, 1, 0.4);
        cr.setLineWidth(1 * scale);
        cr.moveTo(0, h/2);
        cr.lineTo(width, h/2);
        cr.stroke();
    }
};

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}
