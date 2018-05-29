const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const Cairo = imports.cairo;

function TopDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

TopDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init (metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.executeTop();
        this.setupUI();
    },

    setupUI () {

        this.colors = [];
        let cpuCore = 0;
        for (cpuCore = 0; cpuCore < this.getCpuLoad().length; cpuCore++) {
            this.colors.push(this.generateCircleColor());
        }

        // Create a main window        
        this.window = new Clutter.Actor();
        this.setContent(this.window);

        // Refresh the main window
        this.refreshDecoration();
        this.refresh();
    },


    refresh () {

        this.window.remove_all_children();

        // Execute top
        this.executeTop();

        let cpuLoad = this.getCpuLoad();
        let cpuCore;
        let circleCanvas;
        let usageCircle;
        let xPosition = 0;
        let yPosition = 0;
        let largeFontSize = 20;
        let normalFontSize = 13;
        let idle = 0;
        let usage = 0;
        let usageLabel;
        let usageText;
        let subLabel;
        let subText;

        for (cpuCore = 0; cpuCore < cpuLoad.length; cpuCore++) {

            // Get CPU core idle time
            idle = parseInt(cpuLoad[cpuCore].match(/([\d]{1,3}\.[\d]) id/i)[1]);

            // Calculate usage
            usage = 100 - idle;

            // Draw circle canvas
            circleCanvas = this.drawCircleCanvas(usage, 100, this.colors[cpuCore]);

            // Create usage circle
            usageCircle = new Clutter.Actor();
            usageCircle.set_content(circleCanvas);
            usageCircle.set_size(150, 150);
            usageCircle.set_position(xPosition, yPosition);

            // Create usage label
            usageText = usage + "%";
            usageLabel = new St.Label();
            usageLabel.set_position(xPosition + (150 / 2) - ((largeFontSize * usageText.length / 1.6) / 2), yPosition + 45);
            usageLabel.set_text(usageText);
            usageLabel.style = "font-size: " + largeFontSize + "px;font-family: 'Sawasdee', sans-serif;font-weight: 500";

            // Create sub label
            subText = "Core " + cpuCore;
            subLabel = new St.Label();
            subLabel.set_position(xPosition + (157 / 2) - ((normalFontSize * subText.length / 1.6) / 2), yPosition + 75);
            subLabel.set_text(subText);
            subLabel.style = "font-size: " + normalFontSize + "px;font-family: 'Sawasdee', sans-serif";

            // Add to main window
            this.window.add_actor(usageCircle);
            this.window.add_actor(usageLabel);
            this.window.add_actor(subLabel);

            // Recalculate positions
            xPosition = xPosition + 175;

            if (xPosition == 700) {
                yPosition = yPosition + 175;
                xPosition = 0;
            }

        }

        // Refresh again in 5 seconds
        this.timeout = Mainloop.timeout_add_seconds(5, Lang.bind(this, this.refresh));
    },

    refreshDecoration () {
        // Remove decorations
        this.metadata["prevent-decorations"] = true;
        this._updateDecoration();
    },

    drawCircleCanvas (use, total, color) {

        let a = use;
        let b = total;

        let canvas = new Clutter.Canvas();
        canvas.set_size(150, 150);
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

    on_desklet_removed () {
        Mainloop.source_remove(this.timeout);
    }

};

function main(metadata, deskletId) {
    return new TopDesklet(metadata, deskletId);
};
