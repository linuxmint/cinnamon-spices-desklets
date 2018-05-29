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
            let cpuCoreIdleTime = cpuCoreLoad.match(/([\d]{1,3}\.[\d]) id/i)[1];

            // Calculate cpu core usage time
            let cpuCoreUsageTime = 100 - cpuCoreIdleTime;

            // Draw circle canvas
            let circleCanvas = this.drawCircleCanvas(cpuCoreUsageTime, 100, this.colors.find(function(color, index) {
                return index === cpuCoreNumber;
            }));

            // Create cpuCoreUsageTime circle
            let cpuCoreUsageTimeCircle = new Clutter.Actor();
            cpuCoreUsageTimeCircle.set_content(circleCanvas);
            cpuCoreUsageTimeCircle.set_size(150, 150);
            cpuCoreUsageTimeCircle.set_position(xPosition, yPosition);

            // Create cpuCoreUsageTime label
            let cpuCoreUsageTimeText = cpuCoreUsageTime + "%";
            let cpuCoreUsageTimeLabel = new St.Label();
            cpuCoreUsageTimeLabel.set_position(xPosition + (150 / 2) - ((this.largeFontSize * cpuCoreUsageTimeText.length / 1.6) / 2), yPosition + 45);
            cpuCoreUsageTimeLabel.set_text(cpuCoreUsageTimeText);
            cpuCoreUsageTimeLabel.style = "font-size: " + this.largeFontSize + "px;font-family: 'Sawasdee', sans-serif;font-weight: 500";

            // Create sub label
            let subText = "Core " + cpuCoreNumber;
            let subLabel = new St.Label();
            subLabel.set_position(xPosition + (157 / 2) - ((this.normalFontSize * subText.length / 1.6) / 2), yPosition + 75);
            subLabel.set_text(subText);
            subLabel.style = "font-size: " + this.normalFontSize + "px;font-family: 'Sawasdee', sans-serif";

            // Add to main window
            this.window.add_actor(cpuCoreUsageTimeCircle);
            this.window.add_actor(cpuCoreUsageTimeLabel);
            this.window.add_actor(subLabel);

            // Calculate position of the next circle
            xPosition = xPosition + 175;

            if (xPosition === 700) {
                yPosition = yPosition + 175;
                xPosition = 0;
            }

        },this);
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
}
