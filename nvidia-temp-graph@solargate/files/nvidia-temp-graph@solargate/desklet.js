const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Clutter = imports.gi.Clutter;
const Cairo = imports.cairo;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;

const UUID = "nvidia-temp-graph@solargate";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

class NvidiaTempGraphDesklet extends Desklet.Desklet {

    constructor(metadata, deskletId) {
        super(metadata, deskletId);

        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], deskletId);

        this.settings.bindProperty(Settings.BindingDirection.IN, "gpu-id", "gpu_id", this.on_setting_changed);        
        this.settings.bindProperty(Settings.BindingDirection.IN, "use-fahrenheit", "use_fahrenheit", this.on_setting_changed);        
        this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-interval", "refresh_interval", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "duration", "duration", this.on_setting_changed);

        this.settings.bindProperty(Settings.BindingDirection.IN, "background-color", "background_color", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "text_color", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "line-color", "line_color", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "midline-color", "midline_color", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "h-midlines", "h_midlines", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "v-midlines", "v_midlines", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scale_size", this.on_setting_changed);
        
        this.setup_ui();
    }

    setup_ui() {
        this.canvas = new Clutter.Actor();
        this.canvas.remove_all_children();
        this.text = new St.Label();
        this.canvas.add_actor(this.text);
        this.setContent(this.canvas);

        this.first_run = true;

        this.update();        
    }

    update() {
        this.update_draw();
        this.timeout = Mainloop.timeout_add_seconds(this.refresh_interval, Lang.bind(this, this.update));
    }

    update_draw() {
        if (this.first_run) {
            this.n_values = Math.floor(this.duration / this.refresh_interval)  + 1;
            this.values = new Array(this.n_values).fill(0.0);
            this.gpu_temperature = 0;

            this.line_col = this.line_color;

            this.first_run = false;
        }

        let unit_size = 15 * this.scale_size * global.ui_scale;
        var line_width = unit_size / 15;
        var margin_up = 3 * unit_size;
        var graph_w = 20 * unit_size;
        var graph_h =  4 * unit_size;
        let desklet_w = graph_w + (2 * unit_size);
        let desklet_h = graph_h + (4 * unit_size);
        var h_midlines = this.h_midlines;
        var v_midlines = this.v_midlines;
        let text_size = (4 * unit_size / 3) / global.ui_scale;
        var radius = 2 * unit_size / 3;
        var degrees = Math.PI / 180.0;

        let n_values = this.n_values;
        let values = this.values;
        let graph_step = graph_w / (n_values - 1);

        var value = 0;
        var text = '';
        var unit = ' °C';
        var line_colors = this.parse_rgba_settings(this.line_col);

        this.get_gpu_temperature();
        value = this.gpu_temperature / 100;
        if (value > 1) {
            value = 1;
        }            
        if (this.use_fahrenheit) {
            this.gpu_temperature = Math.round((this.gpu_temperature * 1.8) + 32);
            unit = ' °F';
        }
        text = _("GPU Temperature") + ": " + this.gpu_temperature.toString() + unit;

        values.push(isNaN(value) ? 0 : value);
        values.shift();
        this.values = values;

        var background_colors = this.parse_rgba_settings(this.background_color);
        var midline_colors = this.parse_rgba_settings(this.midline_color);

        let canvas = new Clutter.Canvas();
        canvas.set_size(desklet_w, desklet_h);
        canvas.connect('draw', (canvas, ctx, desklet_w, desklet_h) => {
            ctx.save();
            ctx.setOperator(Cairo.Operator.CLEAR);
            ctx.paint();
            ctx.restore();
            ctx.setOperator(Cairo.Operator.OVER);
            ctx.setLineWidth(2 * line_width);

            ctx.setSourceRGBA(background_colors[0], background_colors[1], background_colors[2], background_colors[3]);
            ctx.newSubPath();
            ctx.arc(desklet_w - radius, radius, radius, -90 * degrees, 0 * degrees);
            ctx.arc(desklet_w - radius, desklet_h - radius, radius, 0 * degrees, 90 * degrees);
            ctx.arc(radius, desklet_h - radius, radius, 90 * degrees, 180 * degrees);
            ctx.arc(radius, radius, radius, 180 * degrees, 270 * degrees);
            ctx.closePath();
            ctx.fill();

            ctx.setSourceRGBA(midline_colors[0], midline_colors[1], midline_colors[2], 1);
            ctx.setLineWidth(line_width);
            for (let i = 1; i<v_midlines; i++){
                ctx.moveTo((i * graph_w / v_midlines) + unit_size, margin_up);
                ctx.relLineTo(0, graph_h);
                ctx.stroke();
            }
            for (let i = 1; i<h_midlines; i++){
                ctx.moveTo(unit_size, margin_up + i * (graph_h / h_midlines));
                ctx.relLineTo(graph_w, 0);
                ctx.stroke();
            }

            ctx.setLineWidth(2 * line_width);
            ctx.setSourceRGBA(line_colors[0], line_colors[1], line_colors[2], 1);
            ctx.moveTo(unit_size, margin_up + graph_h - (values[0] * graph_h));
            for (let i = 1; i<n_values; i++){
                ctx.lineTo(unit_size + (i * graph_step), margin_up + graph_h - (values[i] * graph_h));
            }
            ctx.strokePreserve();
            ctx.lineTo(unit_size + graph_w, margin_up + graph_h);
            ctx.lineTo(unit_size, margin_up + graph_h);
            ctx.closePath();
            ctx.setSourceRGBA(line_colors[0], line_colors[1], line_colors[2], 0.4);
            ctx.fill();

            ctx.setLineWidth(2 * line_width);
            ctx.setSourceRGBA(line_colors[0], line_colors[1], line_colors[2], 1);
            ctx.rectangle(unit_size, margin_up, graph_w, graph_h);
            ctx.stroke();

            return false;
        });
    
        this.text.set_text(text);
        this.text.style = "font-size: " + text_size + "px;" + "color: " + this.text_color + ";";
        this.text.set_position(
            Math.round(unit_size),
            Math.round((2.5 * unit_size) - this.text.get_height())
        );

        canvas.invalidate();
        this.canvas.set_content(canvas);
        this.canvas.set_size(desklet_w, desklet_h);
    }

    on_setting_changed() {
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
        }
        this.first_run = true;
        this.update();
   }

    on_desklet_removed() {
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
        }
    }

    parse_rgba_settings(color_str) {
        let colors = color_str.match(/\((.*?)\)/)[1].split(",");
        let r = parseInt(colors[0])/255;
        let g = parseInt(colors[1])/255;
        let b = parseInt(colors[2])/255;
        let a = 1;
        if (colors.length > 3) a = colors[3];
        return [r, g, b, a];
    }

    get_gpu_temperature() {        
        try {
            let [success, child_pid, std_in, std_out, std_err] = GLib.spawn_async_with_pipes(
                null,
                ['/usr/bin/nvidia-smi', '--query-gpu=temperature.gpu', '--format=csv,noheader,nounits', '--id=' + this.gpu_id],
                null,
                GLib.SpawnFlags.DO_NOT_REAP_CHILD | GLib.SpawnFlags.LEAVE_DESCRIPTORS_OPEN,
                null
            );
            GLib.close(std_in);
            GLib.close(std_err);
            GLib.child_watch_add(GLib.PRIORITY_DEFAULT, child_pid, function(pid, wait_status, user_data) {
                GLib.spawn_close_pid(child_pid);
            });
            if (!success) {
                throw new Error(_('Error executing nvidia-smi command'));
            }
            let deskletInstance = this;
            let ioChannelStdOut = GLib.IOChannel.unix_new(std_out);
            let tagWatchStdOut = GLib.io_add_watch(
                ioChannelStdOut, GLib.PRIORITY_DEFAULT,
                GLib.IOCondition.IN | GLib.IOCondition.HUP,
                function(channel, condition, data) {
                    if(condition != GLib.IOCondition.HUP) {
                        let [status, out] = channel.read_to_end();
                        deskletInstance.gpu_temperature = Number(out);
                    }
                    GLib.source_remove(tagWatchStdOut);
                    channel.shutdown(true);
                }
            );
        } catch(error) {
            this.gpu_temperature = 0;
            return;
        }
    }

}

function main(metadata, deskletId) {
    return new NvidiaTempGraphDesklet(metadata, deskletId);
}
