const Gio = imports.gi.Gio;
const St = imports.gi.St;

const Desklet = imports.ui.desklet;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
const Util = imports.misc.util;
const UPowerGlib = imports.gi.UPowerGlib;
const Settings = imports.ui.settings;

const M_PI = 3.141592654;
const LINE_WIDTH = 1;
const MARGIN = 5;

function MyDesklet(metadata, desklet_id){
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.metadata = metadata;

        try {
            this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], this.instance_id);
            this.settings.bindProperty(Settings.BindingDirection.IN,
                                     "color",
                                     "fg_color",
                                     this.on_setting_changed,
                                     null);
            this.settings.bindProperty(Settings.BindingDirection.IN,
                                     "show-seconds",
                                     "disp_seconds",
                                     this.on_setting_changed,
                                     null);
            this.settings.bindProperty(Settings.BindingDirection.IN,
                                     "size",
                                     "bs",
                                     this.on_setting_changed,
                                     null);
        } catch (e) {
            global.logError(e);
        }

        this._date = new St.Label({style_class: "clock-desklet-label"});
        this._displayTime = [-1, -1, -1];
        this._binaryClock = new St.DrawingArea();
        this.bs = this.settings.getValue("size");
        this._binaryClock.width=6*(this.bs + 2) + 4*LINE_WIDTH + MARGIN*2;
        this._binaryClock.height=3*(this.bs + 2) - 2 + 2*LINE_WIDTH + MARGIN*2;
        this._binaryClock.connect('repaint', Lang.bind(this, this._onBinaryClockRepaint));

        this.setContent(this._binaryClock);
        this.setHeader(_("Clock"));
        this._upClient = new UPowerGlib.Client();
        try {
            this._upClient.connect('notify-resume', Lang.bind(this, this._updateClock));
        } catch (e) {
            this._upClient.connect('notify::resume', Lang.bind(this, this._updateClock));
        }

        this.on_setting_changed();
    },

    on_setting_changed: function() {
        let displayDate = new Date();
        this.actor.style = "color: " + this.fg_color + ";";
        if (this.disp_seconds) {
            this._displayTime = [displayDate.getHours(), displayDate.getMinutes(), displayDate.getSeconds()];
            this._binaryClock.width=6*(this.bs + 2) + 4*LINE_WIDTH + MARGIN*2;
            this._binaryClock.height = 3*(this.bs + 2) - 2 + 2*LINE_WIDTH + MARGIN*2;
        } else {
            this._displayTime = [displayDate.getHours(), displayDate.getMinutes()];
            this._binaryClock.width=6*(this.bs + 2) + 4*LINE_WIDTH + MARGIN*2;
            this._binaryClock.height = 2*(this.bs + 2) - 2 + LINE_WIDTH + MARGIN*2;
        }
        this._updateClock();
    },

    _updateClock: function() {
        let displayDate = new Date();
        if (this.disp_seconds)
            this._displayTime = [displayDate.getHours(), displayDate.getMinutes(), displayDate.getSeconds()];
        else
            this._displayTime = [displayDate.getHours(), displayDate.getMinutes()];
        this._binaryClock.queue_repaint();

        Mainloop.timeout_add_seconds(1, Lang.bind(this, this._updateClock));
        return false;
    },

    _onBinaryClockRepaint: function(area) {
        let cr = area.get_context();
        let themeNode = this.actor.get_theme_node();
        let [area_width, area_height] = area.get_surface_size();
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.setLineWidth(LINE_WIDTH);
        cr.rectangle(MARGIN, MARGIN, area_width - MARGIN * 2, area_height - MARGIN * 2);
        cr.fill();

        cr.setOperator(Cairo.Operator.OVER);
        cr.setLineWidth(LINE_WIDTH);
        let step = this.bs + LINE_WIDTH + 2;
        cr.translate(MARGIN + (step - 2)/2, MARGIN + (step - 2)/2);
        let forecolor = themeNode.get_foreground_color();
        for (let p in this._displayTime) {
            for (let i=0; i<6; ++i) {
                Clutter.cairo_set_source_color(cr, this._binaryClock.get_theme_node().get_foreground_color());
                cr.arc(0, 0, this.bs/2, 0, 2*M_PI);
                cr.stroke();
                if ((this._displayTime[p] & (1 << (5-i)))) {
                    Clutter.cairo_set_source_color(cr, forecolor);
                    cr.arc(0, 0, this.bs / 2 - LINE_WIDTH, 0, 2*M_PI);
                    cr.fill();
                }
                cr.translate(step, 0);
            }
            cr.translate(-6 * step, step);
        }
    }
}

function main(metadata, desklet_id) {
    let desklet = new MyDesklet(metadata, desklet_id);
    return desklet;
}
