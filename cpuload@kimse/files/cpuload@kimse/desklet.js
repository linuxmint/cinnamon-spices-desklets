/*global imports*/
const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const Cairo = imports.cairo;
const Settings = imports.ui.settings;

function TopDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

TopDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init (metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], deskletId);
        this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hide_decorations", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scale_size", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "column-count", "column_count", this.on_setting_changed);

        this.executeTop();
        this.setupUI();

    },

    setupUI () {
        
        this.minDeskletWidth = 175;
        this.largeFontSize = 20;
        this.normalFontSize = 13;
        this.colors = [];

        for (let cpuCoreNumber = 0; cpuCoreNumber < this.getCpuLoad().length; cpuCoreNumber++) {
            this.colors.push(this.generateCircleColor());
        }

        // Create a main window        
        this.window = new Clutter.Actor();
        this.setContent(this.window);

        // Refresh the main window
        this.refreshScalingSizes();
        this.refreshDecoration();
        this.refresh();
    },

    refresh () {

        // Execute top
        this.executeTop();

        // Remove previous drawings
        this.window.remove_all_children();

        // Redraw Cpu usage
        this.redrawCpuUsages();

        // Refresh again in 5 seconds
        this.timeout = Mainloop.timeout_add_seconds(5, Lang.bind(this, this.refresh));
    },    

    redrawCpuUsages() {

        let cpuLoad = this.getCpuLoad();
        let xPosition = 0;
        let yPosition = 0;

        cpuLoad.forEach(function(cpuCoreLoad, cpuCoreNumber) {
           
            // Get CPU core idle time
            let cpuCoreIdleTime = parseInt(cpuCoreLoad.match(/([\d]{1,3}\.[\d]) id/i)[1]);

            // Calculate cpu core usage time
            let cpuCoreUsageTime = 100 - cpuCoreIdleTime;

            // Draw circle canvas
            let circleCanvas = this.drawCircleCanvas(cpuCoreUsageTime, 100, this.colors.find(function(color, index) {
                return index === cpuCoreNumber;
            }));

            // Create CPU usage container
            let cpuCoreUsageContainer = new Clutter.Actor();
            cpuCoreUsageContainer.set_content(circleCanvas);
            cpuCoreUsageContainer.set_size(this.circleContainerSize, this.circleContainerSize);
            cpuCoreUsageContainer.set_position(xPosition, yPosition);


            // Create CPU usage label
            let cpuCoreUsageStr = cpuCoreUsageTime + "%";
            let cpuCoreUsageLabelPositionX = xPosition + (this.circleContainerSize / 2) - ((this.cpuCoreUsageFontSize * cpuCoreUsageStr.length / 2) / 2);
            let cpuCoreUsageLabelPositionY = yPosition + (this.circleContainerSize / 2) - (this.cpuCoreUsageFontSize * 1.35);
            let cpuCoreUsageLabel = new St.Label();
            cpuCoreUsageLabel.set_position(cpuCoreUsageLabelPositionX, cpuCoreUsageLabelPositionY);
            cpuCoreUsageLabel.set_text(cpuCoreUsageStr);
            cpuCoreUsageLabel.style = "font-size: " + this.cpuCoreUsageFontSize + "px;font-family: 'Sawasdee', sans-serif;font-weight: 500";

            // Create CPU core number label
            let cpuCoreNumberStr = "Core " + cpuCoreNumber;
            let cpuCoreNumberPositionX = xPosition + (this.circleContainerSize / 2) - ((this.cpuCoreNumberFontSize * cpuCoreNumberStr.length / 2) / 2);
            let cpuCoreNumberPositionY = yPosition + (this.circleContainerSize / 2) + this.cpuCoreNumberFontSize / 4;
            let cpuCoreNumberLabel = new St.Label();
            cpuCoreNumberLabel.set_position(cpuCoreNumberPositionX, cpuCoreNumberPositionY);
            cpuCoreNumberLabel.set_text(cpuCoreNumberStr);
            cpuCoreNumberLabel.style = "font-size: " + this.cpuCoreNumberFontSize + "px;font-family: 'Sawasdee', sans-serif";

            // Add to main window
            this.window.add_actor(cpuCoreUsageContainer);
            this.window.add_actor(cpuCoreUsageLabel);
            this.window.add_actor(cpuCoreNumberLabel);

            // Calculate position of the next circle
            xPosition = xPosition + this.circleContainerMarginSize;

            if (xPosition >= this.maxDeskletWidth) {
                yPosition = yPosition + this.circleContainerMarginSize;
                xPosition = 0;
            }

        },this);
    },

    refreshDecoration () {

        // Enable/disable decorations
        this.metadata["prevent-decorations"] = this.hide_decorations;

        this._updateDecoration();
    },

    drawCircleCanvas (use, total, color) {

        let a = use;
        let b = total;

        let canvas = new Clutter.Canvas();
        canvas.set_size(this.circleContainerSize, this.circleContainerSize);

        canvas.connect("draw", function(canvas, cr, width, height) {

            let offset = Math.PI * 0.5;
            let start = 0 - offset;
            let end = ((a * (Math.PI * 2)) / b) - offset;

            cr.save();
            cr.setOperator(Cairo.Operator.CLEAR);
            cr.paint();
            cr.restore();
            cr.setOperator(Cairo.Operator.OVER);
            cr.scale(width, height);
            cr.translate(0.5, 0.5);
            cr.setSourceRGBA(1, 1, 1, 0.2);
            cr.setLineWidth(0.20);
            cr.arc(0, 0, 0.4, 0, Math.PI * 2);
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

    executeTop () {

        let subprocess = new Gio.Subprocess({
            argv: ["top", "-bn2", "-d0.01"],
            flags: Gio.SubprocessFlags.STDOUT_PIPE,
        });

        subprocess.init(null);

        this.top = subprocess.communicate_utf8(null, null)[1];
    },

    getCpuLoad () {
        let cpus = this.top.match(/%Cpu.+/g);
        return cpus.splice(Math.ceil(cpus.length / 2), cpus.length);
    },

    generateCircleColor () {
        let rgba = {
            r: Math.random(),
            g: Math.random(),
            b: Math.random(),
            a: 1
        };
        return rgba;
    },

    refreshScalingSizes () {
        // Calculate new sizes based on scale factor
		this.circleContainerSize = 150 * this.scale_size;
		this.circleContainerMarginSize = 175 * this.scale_size;
		this.cpuCoreUsageFontSize = Math.round(this.largeFontSize * this.scale_size);
		this.cpuCoreNumberFontSize = Math.round(this.normalFontSize * this.scale_size);
        this.maxDeskletWidth = (this.minDeskletWidth * this.column_count) * this.scale_size;
    },

	on_setting_changed () {
		// Update decoration settings
		this.refreshDecoration();

        // Refresh scaling sizes        
        this.refreshScalingSizes();

		// settings changed; instant refresh
		Mainloop.source_remove(this.timeout);
		this.refresh();
	},

    on_desklet_removed () {
        Mainloop.source_remove(this.timeout);
    }

};

function main(metadata, deskletId) {
    return new TopDesklet(metadata, deskletId);
}
