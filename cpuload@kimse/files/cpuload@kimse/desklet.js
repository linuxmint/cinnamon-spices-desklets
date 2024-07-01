const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Cairo = imports.cairo;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const GLib = imports.gi.GLib;


// translation support
const uuid = "cpuload@kimse";
const Gettext = imports.gettext;
Gettext.bindtextdomain(uuid, GLib.get_home_dir() + "/.local/share/locale")

function _(str) {
  return Gettext.dgettext(uuid, str);
}

CpuLoadDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    /**
     * Initializes the desklet.
     *
     * @param {Object}  metadata
     * @param {string}  deskletId
     *
     * @returns {Object}
     */
    _init(metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        // Settings
        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, deskletId);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'per-core', 'per_core', this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'scale-size', 'scale_size', this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'number-of-columns', 'number_of_columns', this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'refresh-interval', 'refresh_interval', this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'design', 'design', this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'circle', 'circle', this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'font-color', 'font_color', this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'color-theme', 'color_theme', this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'static-theme-color', 'static_theme_color', this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-background', 'show_background', this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'hide-decorations', 'hide_decorations', this.on_setting_changed);

        // Properties
        this.cpus_utilization = [];
        this.cpus_active_time = [];
        this.cpus_total_time = [];
        this.colors = [];
        this.cpu_container_outer_base_width = 175;
        this.cpu_container_inner_base_width = 150;
        this.large_font_size = 22;
        this.normal_font_size = 13;
        this.has_previous_sample = false;

        // Setup the UI
        this.setupUI();
    },

    /**
     * Setup the UI.
     */
    setupUI() {

        // Create a main window
        this.window = new Clutter.Actor();
        this.setContent(this.window);

        // Refresh the desklet window
        this.refreshScalingSizes();
        this.toggleDecoration();

        // Start the main desklet loop
        this.main();
    },

    /**
     * Toggle desklet decoration.
     */
    toggleDecoration() {

        // Toggle decorations
        this.metadata['prevent-decorations'] = this.hide_decorations;

        this._updateDecoration();
    },

    /**
     * Refresh desklet scaling.
     */
    refreshScalingSizes() {
        // Calculate new sizes based on scale factor
        this.cpu_container_size = this.cpu_container_inner_base_width * this.scale_size * global.ui_scale;
        this.cpu_container_margin_size = this.cpu_container_outer_base_width * this.scale_size * global.ui_scale;
        this.cpu_load_font_size = Math.round(this.large_font_size * this.scale_size);
        this.cpu_name_font_size = Math.round(this.normal_font_size * this.scale_size);
        this.max_desklet_width = (this.cpu_container_outer_base_width * this.number_of_columns) * this.scale_size * global.ui_scale;
    },

    /**
     * Main desklet loop.
     */
    main() {

        // Refresh CPU activity
        this.refreshCpuActivity(this.drawCpuActivity);

        this.timeout = Mainloop.timeout_add_seconds(this.refresh_interval, Lang.bind(this, this.main));
    },

    /**
     * Refresh CPU activity.
     *
     * @param {Object=} callback
     */
    refreshCpuActivity(callback = null) {

        let desklet = this;

        // Get cpu activity sample
        this.getCpuActivitySample(this.per_core).then(activity => {
            // Update CPU activity data
            desklet.updateCpuActivity(activity);

            if(callback !== null) {
                callback = callback.bind(desklet);
                callback();
            }
        });
    },

    /**
     * Draw CPU activity meter(s).
     */
    drawCpuActivity() {

        let pos_x = 0;
        let pos_y = 0;

        // Remove previous actors
        this.window.remove_all_children();

        // Create actors for each CPU core
        for(let core in this.cpus_utilization) {

            // Create CPU meter
            let container = this.makeCpuContainer(
                    this.makeCpuCoreCanvas(core),
                    pos_x,
                    pos_y
                );

            // Create CPU core label
            let cpu_load = this.makeCpuLoadLabel(core, pos_x, pos_y);
            let cpu_name = this.makeCpuNameLabel(core, pos_x, pos_y);

            // Calculate position of the next CPU meter
            pos_x = pos_x + this.cpu_container_margin_size;

            if (pos_x >= this.max_desklet_width) {
                pos_y = pos_y + this.cpu_container_margin_size;
                pos_x = 0;
            }

            // Add to main window
            this.window.add_actor(container);
            this.window.add_actor(cpu_load);
            this.window.add_actor(cpu_name);
        }
    },

    /**
     * Refresh CPU activity.
     *
     * @param {Clutter.Canvas}  canvas
     * @param {number}          pos_x
     * @param {number}          pos_y
     *
     * @returns {Clutter.Actor}
     */
    makeCpuContainer(canvas, pos_x, pos_y){

        let actor = new Clutter.Actor();

        actor.set_content(canvas);
        actor.set_size(this.cpu_container_size, this.cpu_container_size);
        actor.set_position(pos_x, pos_y);

        return actor;
    },

    /**
     * Make a CPU load label.
     *
     * @param {number}  cpu_active_time
     * @param {number}  pos_x
     * @param {number}  pos_y
     *
     * @returns {St.Label}
     */
    makeCpuLoadLabel(core, pos_x, pos_y){

        let label = new St.Label({style_class:"cpuLoad"});
        let cpu_active_time = this.cpus_utilization[core];

        label.set_position(pos_x, pos_y + (this.cpu_container_size / 2) - (this.cpu_load_font_size * (1.35 * global.ui_scale)));
        label.set_text(cpu_active_time + '%');

        label.style = this.getTextLabelStyle(this.cpu_load_font_size);

        return label;
    },

    /**
     * Make a CPU name label.
     *
     * @param {number}  core
     * @param {number}  pos_x
     * @param {number}  pos_y
     *
     * @returns {St.Label}
     */
    makeCpuNameLabel(core, pos_x, pos_y)
    {
        let label = new St.Label({style_class:"cpuName"});

        label.set_position(pos_x, pos_y + (this.cpu_container_size / 2) + (this.cpu_name_font_size / global.ui_scale) / 4);
        label.set_text(this.per_core ? _("Core %d").format(core) : _("CPU usage"));

        label.style = this.getTextLabelStyle(this.cpu_name_font_size);

        return label;
    },

    /**
     * Get text label style.
     *
     * @param {number}  font_size
     *
     * @returns {string}
     */
    getTextLabelStyle(font_size){
        return "font-size: " + font_size + "px;" +
               "width:" + (this.cpu_container_size / global.ui_scale) + "px;" +
               "color:" + (this.font_color) + ";";
    },

    /**
     * Check if a previous CPU activity data sample has been collected.
     *
     * @param {number}  num_cpus
     *
     * @returns {boolean}
     */
    hasPreviousSample(num_cpus){

        // This is only checked once after (re)initialization.
        // we use a flag after the first check rather than counting
        // the length of those arrays over and over again
        if(!this.has_previous_sample){
            return this.has_previous_sample = this.cpus_active_time.length === num_cpus &&
                                              this.cpus_total_time.length === num_cpus;
        }

        return true;
    },

    /**
     * Make CPU meter canvas.
     *
     * @param {number}  core
     *
     * @returns {Clutter.Canvas}
     */
    makeCpuCoreCanvas(core) {

        let canvas = new Clutter.Canvas();
        let desklet = this;
        let cpu_active_time = this.cpus_utilization[core];
        let color = this.getCpuColor(core);

        canvas.set_size(this.cpu_container_size, this.cpu_container_size);
        canvas.connect('draw', function(canvas, cr, width, height) {

            let offset = Math.PI * (desklet.circle == 'speedometer' ? 1.25 : 1.5);
            let start = 0 - offset;
            let end = ((cpu_active_time * (Math.PI * (desklet.circle == 'speedometer' ? 1.5 : 2) )) / 100) - offset;

            desklet.drawCircleShape(cr, width, height);

            if(desklet.design === 'thin') {
                desklet.drawThinCircleShape(cr, start, end, color);
            } else if(desklet.design === 'compact') {
                desklet.drawCompactCircleShape(cr, start, end, color);
            } else {
                desklet.drawThickCircleShape(cr, start, end, color);
            }
        });
        canvas.invalidate();

        return canvas;
    },

    /**
     * Draw CPU meter shape model.
     *
     * @param {Cario}   cr
     * @param {number}  width
     * @param {number}  height
     */
    drawCircleShape(cr, width, height) {
        cr.save();
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.restore();
        cr.setOperator(Cairo.Operator.OVER);
        cr.scale(width, height);
        cr.translate(0.5, 0.5);
    },

    /**
     * Draw thin CPU meter design.
     *
     * @param {Cario}   cr
     * @param {number}  start
     * @param {number}  end
     * @param {Object}  color
     */
    drawThinCircleShape(cr, start, end, color){

        cr.setLineCap(Cairo.LineCap.ROUND);

        if(this.show_background) {
            cr.setSourceRGBA(1, 1, 1, 0.2);
            cr.setLineWidth(0.045);
            if(this.circle == 'speedometer') {
                cr.arc(0, 0, 0.45, 0-(Math.PI*1.25), Math.PI*0.25);
            } else {
                cr.arc(0, 0, 0.45, 0, Math.PI*2);
            }
            cr.stroke();
        }

        cr.setSourceRGBA(color.r, color.g, color.b, color.a);
        cr.setLineWidth(0.045);
        cr.arc(0, 0, 0.45, start, end);
        cr.stroke();
    },

    /**
     * Draw thick CPU meter design.
     *
     * @param {Cario}   cr
     * @param {number}  start
     * @param {number}  end
     * @param {Object}  color
     */
    drawThickCircleShape(cr, start, end, color){

        if(this.show_background) {
            cr.setSourceRGBA(1, 1, 1, 0.2);
            cr.setLineWidth(0.20);
            if(this.circle == 'speedometer') {
                cr.arc(0, 0, 0.4, 0-(Math.PI*1.25), Math.PI*0.25);
            } else {
                cr.arc(0, 0, 0.4, 0, Math.PI*2);
            }
            cr.stroke();
        }

        cr.setSourceRGBA(color.r, color.g, color.b, color.a);
        cr.setLineWidth(0.20);
        cr.arc(0, 0, 0.4, start, end);
        cr.stroke();
        cr.setSourceRGBA(0, 0, 0, 0.1446);
        cr.setLineWidth(0.05);
        cr.arc(0, 0, 0.325, start, end);
        cr.stroke();
    },

    /**
     * Draw compact CPU meter design.
     *
     * @param {Cario}   cr
     * @param {number}  start
     * @param {number}  end
     * @param {Object}  color
     */
    drawCompactCircleShape(cr, start, end, color){

        if(this.show_background) {
            cr.setSourceRGBA(1, 1, 1, 0.2);
            cr.setLineWidth(0.4);
            if(this.circle == 'speedometer') {
                cr.arc(0, 0, 0.2, 0-(Math.PI*1.25), Math.PI*0.25);
            } else {
                cr.arc(0, 0, 0.2, 0, Math.PI*2);
            }
            cr.stroke();
        }

        cr.setSourceRGBA(color.r, color.g, color.b, color.a);
        cr.setLineWidth(0.4);
        cr.arc(0, 0, 0.2, start, end);
        cr.stroke();
    },

    /**
     * Get CPU meter color based on user-defined color theme.
     *
     * @param {number}  core
     *
     * @return {Object}
     */
    getCpuColor(core) {

        switch(this.color_theme)
        {
            case 'dynamic':
                // Make a new dynamic rgb color based on the CPU core utilization.
                return this.getDynamicRgbColor(core);
            case 'static':
                // Get the user defined static rgb color singleton instance for the core.
                if (typeof this.colors[core] === 'undefined') {
                    this.colors[core] = this.getStaticRgbColor();
                }

                return this.colors[core];
            case 'random':
            default:
                // Get the user defined static rgb color singleton instance for the core.
                if (typeof this.colors[core] === 'undefined') {
                    this.colors[core] = this.makeRandomRgbColor();
                }

                return this.colors[core];
        }

    },

    /**
     * Get a dynamic RGB color based on the given CPU core utilization.
     *
     * @param {number} core
     *
     * @returns {Object}
     */
    getDynamicRgbColor(core) {
        let green = {
            r: 70.0/255,
            g: 200.0/255,
            b: 150.0/255,
            a: 1
        };
        let red = {
            r: 180.0/255,
            g: 10.0/255,
            b: 10.0/255,
            a: 1
        };

        return {
            r: green.r + (this.cpus_utilization[core] / 100) * (red.r - green.r),
            g: green.g + (this.cpus_utilization[core] / 100) * (red.g - green.g),
            b: green.b + (this.cpus_utilization[core] / 100) * (red.b - green.b),
            a: 1
        };
    },

    /**
     * Get the static user defined RGB color.
     *
     * @param {number} core
     *
     * @returns {Object}
     */
    getStaticRgbColor() {
        // Parse the color setting string
        let colors = this.static_theme_color.match(/\((.*?)\)/)[1].split(',');

        let rgba = {
            r: parseInt(colors[0])/255,
            g: parseInt(colors[1])/255,
            b: parseInt(colors[2])/255,
            a: (colors.length >= 4) ? parseFloat(colors[3]) : 1
        };

        return rgba;
    },

    /**
     * Make a random color
     *
     * @returns {Object}
     */
    makeRandomRgbColor() {

        let rgba = {
            r: Math.random(),
            g: Math.random(),
            b: Math.random(),
            a: 1
        };

        return rgba;
    },

    /**
     * Get CPU activity sample
     *
     * @async
     * @param {boolean}  per_core
     *
     * @returns {Object}
     */
    async getCpuActivitySample(per_core) {

        let activity = [];
        let proc_stat = '';

        try {
            proc_stat = String(await this.readProcStatFileAsync());

            if (per_core) {
                activity = proc_stat.match(/^cpu[\d]+.+$/mg);
            } else {
                activity = proc_stat.match(/^cpu\ +.+$/mg);
            }

            return activity;

        } catch (e) {
            logError(e);
        }
    },

    /**
     * Read /proc/stat file
     *
     * @param {Cancellable=}  cancellable
     *
     * @returns {Promise}
     */
    readProcStatFileAsync(cancellable = null) {

        let file = Gio.File.new_for_path('/proc/stat');

        return new Promise((resolve, reject) => {
            file.load_contents_async(cancellable, (source_object, result) => {
                try {
                    result = source_object.load_contents_finish(result);

                    let [success, proc_stat] = result;

                    resolve(proc_stat);
                } catch (e) {
                    reject(e);
                }
            });
        });
    },

    /**
     * Parses /proc/stat content
     *
     * @param {string} activity
     */
    updateCpuActivity(activity) {

        let cpus_active_time = [];
        let cpus_total_time = [];

        activity.forEach(function (stats, core) {

            // Remove double space for total stats (starts with "cpu  ")
            let load = stats.replace("  ", " ").split(" ");

            cpus_active_time[core] = parseInt(load[1]) + // user: Time spent in user mode.
                            parseInt(load[2]) +          // nice: Time spent in user mode with low priority (nice).
                            parseInt(load[3]) +          // system: Time spent in system mode.
                            parseInt(load[7]) +          // softirq: Time servicing softirqs.
                            parseInt(load[8]);           // stolen: Stolen time, which is the time spent in other operating systems when running in a virtualized environment

            cpus_total_time[core] = parseInt(load[1]) +  // user: Time spent in user mode.
                            parseInt(load[2]) +          // nice: Time spent in user mode with low priority (nice).
                            parseInt(load[3]) +          // system: Time spent in system mode.
                            parseInt(load[4]) +          // idle: Time spent in the idle task.
                            parseInt(load[5]) +          // iowait: Time waiting for I/O to complete
                            parseInt(load[7]) +          // softirq: Time servicing softirqs.
                            parseInt(load[8]);           // stolen: Stolen time, which is the time spent in other operating systems when running in a virtualized environment

            if(this.hasPreviousSample(activity.length)){
                this.cpus_utilization[core] = Math.round(
                    (100 * (cpus_active_time[core] - this.cpus_active_time[core]) / (cpus_total_time[core] - this.cpus_total_time[core]))
                );
            } else {
                this.cpus_utilization[core] = 0;
            }

            this.cpus_active_time[core] = cpus_active_time[core];
            this.cpus_total_time[core] = cpus_total_time[core];

        }, this);
    },

    /**
     * Called when desklet settings gets changed.
     */
    on_setting_changed() {
        // Remove old data
        this.cpus_utilization = [];
        this.cpus_active_time = [];
        this.cpus_total_time = [];
        this.has_previous_sample = false;
        this.colors = [];

        // Update decoration settings
        this.toggleDecoration();

        // Refresh scaling sizes
        this.refreshScalingSizes();

        // Restart main loop
        Mainloop.source_remove(this.timeout);
        this.main();
    },

    /**
     * Called when desklet gets removed
     */
    on_desklet_removed() {
        Mainloop.source_remove(this.timeout);
    }
};

/**
 * CPU Load desklet class
 *
 * @class
 * @param {Object} metadata
 * @param {string} deskletId
 */
function CpuLoadDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

function main(metadata, deskletId) {
    return new CpuLoadDesklet(metadata, deskletId);
}
