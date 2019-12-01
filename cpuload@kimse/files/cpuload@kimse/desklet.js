/*global imports*/
const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Cinnamon = imports.gi.Cinnamon;
const Lang = imports.lang;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const Cairo = imports.cairo;
const Settings = imports.ui.settings;

function CpuusageDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

CpuusageDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init(metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, deskletId);
        this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hide_decorations", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scale_size", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "column-count", "column_count", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "per-core", "per_core", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-interval", "refresh_interval", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "design", "design", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "draw-unused", "draw_unused", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "circle-color-type", "circle_color_type", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "circle-color", "circle_color", this.on_setting_changed);

        this.active = [];
        this.total = [];
        this.colors = [];

        this.setupUI();

    },

    setupUI() {

        this.minDeskletWidth = 170;
        this.largeFontSize = 20;
        this.normalFontSize = 13;

        // Create a main window
        this.window = new Clutter.Actor();
        this.setContent(this.window);

        // Refresh the main window
        this.refreshScalingSizes();
        this.refreshDecoration();
        this.refresh();
    },

    refresh() {
        // Remove previous drawings
        this.window.remove_all_children();

        // Redraw Cpu usage
        this.redrawCpuUsages();

        // Refresh again in refresh_interval seconds
        this.timeout = Mainloop.timeout_add_seconds(this.refresh_interval, Lang.bind(this, this.refresh));
    },

    redrawCpuUsages() {

        let xPosition = 0;
        let yPosition = 0;
        let utilization = this.getCpuUtilization();

        utilization.forEach(function (usage, index) {

            // Draw circle canvas
            let circleCanvas = this.drawCircleCanvas(usage, 100, this.getCpuColor(index, usage));

            // Create CPU usage container
            let cpuCoreUsageContainer = new Clutter.Actor();
            cpuCoreUsageContainer.set_content(circleCanvas);
            cpuCoreUsageContainer.set_size(this.circleContainerSize, this.circleContainerSize);
            cpuCoreUsageContainer.set_position(xPosition, yPosition);

            // Create CPU usage label
            let cpuCoreUsageStr = usage + "%";
            let cpuCoreUsageLabelPositionX = xPosition;
            let cpuCoreUsageLabelPositionY = yPosition + (this.circleContainerSize / 2) - (this.cpuCoreUsageFontSize * (1.35*global.ui_scale));
            let cpuCoreUsageLabel = new St.Label();
            cpuCoreUsageLabel.set_position(cpuCoreUsageLabelPositionX, cpuCoreUsageLabelPositionY);
            cpuCoreUsageLabel.set_text(cpuCoreUsageStr);
            cpuCoreUsageLabel.style = "text-align:center;font-size: " + this.cpuCoreUsageFontSize + "px;font-family: 'Sawasdee', sans-serif;font-weight: 500;width:" + (this.circleContainerSize/global.ui_scale) + "px";

            // Create CPU core number label
            let cpuCoreNumberStr = "CPU usage";
            if (this.per_core) {
                cpuCoreNumberStr = "Core " + index;
            }
            let cpuCoreNumberPositionX = xPosition;
            let cpuCoreNumberPositionY = yPosition + (this.circleContainerSize / 2) + (this.cpuCoreNumberFontSize/global.ui_scale) / 4;
            let cpuCoreNumberLabel = new St.Label();
            cpuCoreNumberLabel.set_position(cpuCoreNumberPositionX, cpuCoreNumberPositionY);
            cpuCoreNumberLabel.set_text(cpuCoreNumberStr);
            cpuCoreNumberLabel.style = "text-align:center;font-size: " + this.cpuCoreNumberFontSize + "px;font-family: 'Sawasdee', sans-serif;width:" + (this.circleContainerSize/global.ui_scale) + "px";

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

        }, this);

    },

    refreshDecoration() {

        // Enable/disable decorations
        this.metadata["prevent-decorations"] = this.hide_decorations;

        this._updateDecoration();
    },

    drawCircleCanvas(use, total, color) {

        let a = use;
        let b = total;

        let design = this.design;
        let draw_unused = this.draw_unused;

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
            if(design === "thin") {
                if(draw_unused) {
                    cr.setSourceRGBA(1, 1, 1, 0.2);
                    cr.setLineWidth(0.04);
                    cr.arc(0, 0, 0.4, 0, Math.PI*2);
                    cr.stroke();
                }
                /////
                cr.setLineCap(Cairo.LineCap.ROUND);
                cr.setSourceRGBA(color.r, color.g, color.b, color.a);
                cr.setLineWidth(0.04);
                cr.arc(0, 0, 0.4, start, end);
                cr.stroke();
            } else { // classic design
                if(draw_unused) {
                    cr.setSourceRGBA(1, 1, 1, 0.2);
                    cr.setLineWidth(0.20);
                    cr.arc(0, 0, 0.4, 0, Math.PI*2);
                    cr.stroke();
                }
                /////
                cr.setSourceRGBA(color.r, color.g, color.b, color.a);
                cr.setLineWidth(0.20);
                cr.arc(0, 0, 0.4, start, end);
                cr.stroke();
                /////
                cr.setSourceRGBA(0, 0, 0, 0.1446);
                cr.setLineWidth(0.05);
                cr.arc(0, 0, 0.325, start, end);
                cr.stroke();
            }

            return true;
        });

        canvas.invalidate();

        return canvas;
    },

    generateCircleColor() {
        let rgba = {
            r: Math.random(),
            g: Math.random(),
            b: Math.random(),
            a: 1
        };
        return rgba;
    },

    refreshScalingSizes() {
        // Calculate new sizes based on scale factor
        this.circleContainerSize = 150 * this.scale_size * global.ui_scale;
        this.circleContainerMarginSize = this.minDeskletWidth * this.scale_size * global.ui_scale;
        this.cpuCoreUsageFontSize = Math.round(this.largeFontSize * this.scale_size);
        this.usageingDataMessageFontSize = Math.round(this.largeFontSize * this.scale_size);
        this.cpuCoreNumberFontSize = Math.round(this.normalFontSize * this.scale_size);
        this.maxDeskletWidth = (this.minDeskletWidth * this.column_count) * this.scale_size * global.ui_scale;
    },

    getCpuUtilization() {

        let utilization = [];
        let active = [];
        let total = [];
        let activity = this.getCpuActivity();
        let hasPreviousSample = this.active.length && this.total.length;

        activity.forEach(function(cpu, index) {

            // Remove double space for total stats (starts with "cpu  ")
            let usage = cpu.replace("  ", " ").split(" ");

            active[index] = parseInt(usage[1]) + parseInt(usage[2]) + parseInt(usage[3]) + parseInt(usage[7]) + parseInt(usage[8]);
            total[index] = parseInt(usage[1]) + parseInt(usage[2]) + parseInt(usage[3]) + parseInt(usage[4]) + parseInt(usage[5]) + parseInt(usage[7]) + parseInt(usage[8]);

            if(hasPreviousSample) {
                utilization[index] = this.calculateCpuUtilization(active[index], this.active[index], total[index], this.total[index]);
            }
            else {
                utilization[index] = 0;
            }

        }, this);

        this.active = active;
        this.total = total;

        return utilization;
    },

    calculateCpuUtilization (currentActive, previousActive, currentTotal, previousTotal) {
        return Math.round((100 * (currentActive - previousActive) / (currentTotal - previousTotal)));
    },

    getCpuActivity() {
        if (this.per_core) {
            return Cinnamon.get_file_contents_utf8_sync("/proc/stat").match(/^cpu[\d]+.+$/mg);
        } else {
            return Cinnamon.get_file_contents_utf8_sync("/proc/stat").match(/^cpu\ +.+$/mg);
    }
    },

    getCpuColor(index, usage) {

        if(this.circle_color_type === 'static') {
            let circle_colors = this.circle_color.match(/\((.*?)\)/)[1].split(","); // get contents inside brackets: "rgb(...)"
            let rgba = {
                r: parseInt(circle_colors[0])/255,
                g: parseInt(circle_colors[1])/255,
                b: parseInt(circle_colors[2])/255,
                a: (circle_colors.length >= 4) ? parseFloat(circle_colors[3]) : 1
            };
            return rgba;
        } else if(this.circle_color_type === 'dynamic') {
            let colorGreen = {
                r: 70.0/255,
                g: 200.0/255,
                b: 150.0/255,
                a: 1
            };
            let colorRed = {
                r: 180.0/255,
                g: 10.0/255,
                b: 10.0/255,
                a: 1
            };
            let color = {
                r: colorGreen.r + (usage/100) * (colorRed.r - colorGreen.r),
                g: colorGreen.g + (usage/100) * (colorRed.g - colorGreen.g),
                b: colorGreen.b + (usage/100) * (colorRed.b - colorGreen.b),
                a: 1
            };
            return color;
        } else {
            if (typeof this.colors[index] === 'undefined') {
                this.colors[index] = this.generateCircleColor();
            }
            return this.colors[index];
        }

    },

    on_setting_changed() {
        // Remove old activity data
        this.active = [];
        this.total = [];

        // Update decoration settings
        this.refreshDecoration();

        // Refresh scaling sizes
        this.refreshScalingSizes();

        // settings changed; instant refresh
        Mainloop.source_remove(this.timeout);
        this.refresh();
    },

    on_desklet_removed() {
        Mainloop.source_remove(this.timeout);
    }

};

function main(metadata, deskletId) {
    return new CpuusageDesklet(metadata, deskletId);
}
