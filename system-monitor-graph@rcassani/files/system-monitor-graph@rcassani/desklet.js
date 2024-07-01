const ByteArray = imports.byteArray;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Cairo = imports.cairo;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;

const GIB_TO_KIB = 1048576; // 1 GiB = 1,048,576 kiB
const GB_TO_B = 1000000000; // 1 GB  = 1,000,000,000 B
const GIB_TO_MIB = 1024;    // 1 GiB = 1,042 MiB

const UUID = "system-monitor-graph@rcassani";
const DESKLET_PATH = imports.ui.deskletManager.deskletMeta[UUID].path;

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

function SystemMonitorGraph(metadata, desklet_id) {
  this._init(metadata, desklet_id);
}

function main(metadata, desklet_id) {
  return new SystemMonitorGraph(metadata, desklet_id);
}

SystemMonitorGraph.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        // initialize settings
        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "type", "type", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "data-prefix-ram", "data_prefix_ram", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "data-prefix-swap", "data_prefix_swap", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "data-prefix-hdd", "data_prefix_hdd", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "data-prefix-gpumem", "data_prefix_gpumem", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "filesystem", "filesystem", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "filesystem-label", "filesystem_label", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "gpu-manufacturer", "gpu_manufacturer", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "gpu-variable", "gpu_variable", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "gpu-id", "gpu_id", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-interval", "refresh_interval", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "duration", "duration", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "background-color", "background_color", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "h-midlines", "h_midlines", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "v-midlines", "v_midlines", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scale_size", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "midline-color", "midline_color", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "text_color", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "line-color-cpu", "line_color_cpu", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "line-color-ram", "line_color_ram", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "line-color-swap", "line_color_swap", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "line-color-hdd", "line_color_hdd", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "line-color-gpu", "line_color_gpu", this.on_setting_changed);

        // initialize desklet GUI
        this.setupUI();
    },

    setupUI: function(){
        // initialize this.canvas
        this.canvas = new Clutter.Actor();
        this.canvas.remove_all_children();
        this.text1 = new St.Label();
        this.text2 = new St.Label();
        this.text3 = new St.Label();
        this.canvas.add_actor(this.text1);
        this.canvas.add_actor(this.text2);
        this.canvas.add_actor(this.text3);
        this.setContent(this.canvas);

        // flag to indicate the first loop of the Desklet
        this.first_run = true;
        // update loop for Desklet
        this.update();
    },

    update: function() {
        // monitors a given variable and plot its graph
        this.update_draw();
        // call this.update() every in refresh_interval seconds
        this.timeout = Mainloop.timeout_add_seconds(this.refresh_interval, Lang.bind(this, this.update));
    },

    update_draw: function() {
        // values needed in first run
        if (this.first_run){
            this.n_values = Math.floor(this.duration / this.refresh_interval)  + 1;
            this.values = new Array(this.n_values).fill(0.0);
            this.cpu_cpu_tot = 0;
            this.cpu_cpu_idl = 0;
            this.hdd_cpu_tot = 0;
            this.hdd_hdd_tot = 0;
            // values to graph
            this.cpu_use     = 0;
            this.ram_values  = new Array(2).fill(0.0);
            this.swap_values = new Array(2).fill(0.0);
            this.hdd_values  = new Array(4).fill(0.0);
            this.gpu_use     = 0;
            this.gpu_mem     = new Array(2).fill(0.0);

            // set colors
            switch (this.type) {
              case "cpu":
                  this.line_color = this.line_color_cpu;
                  break;
              case "ram":
                  this.line_color = this.line_color_ram;
                  break;
              case "swap":
                  this.line_color = this.line_color_swap;
                  break;
              case "hdd":
                  this.line_color = this.line_color_hdd;
                  break;
              case "gpu":
                  this.line_color = this.line_color_gpu;
                  break;
            }
            this.first_run = false;
        }

        // Desklet proportions
        let unit_size = 15 * this.scale_size * global.ui_scale;  // pixels
        var line_width = unit_size / 15;
        var margin_up = 3 * unit_size;
        var graph_w = 20 * unit_size;
        var graph_h =  4 * unit_size;
        let desklet_w = graph_w + (2 * unit_size);
        let desklet_h = graph_h + (4 * unit_size);
        var h_midlines = this.h_midlines;
        var v_midlines = this.v_midlines;
        let text1_size = (4 * unit_size / 3) / global.ui_scale;
        let text2_size = (4 * unit_size / 3) / global.ui_scale;
        let text3_size = (3 * unit_size / 3) / global.ui_scale;
        var radius = 2 * unit_size / 3;;
        var degrees = Math.PI / 180.0;

        let n_values = this.n_values;
        let values = this.values;
        let graph_step = graph_w / (n_values -1);

        var value = 0.0;
        var text1 = '';
        var text2 = '';
        var text3 = '';
        var line_colors = this.parse_rgba_settings(this.line_color);

        // current values
        switch (this.type) {
          case "cpu":
              this.get_cpu_use();
              value = this.cpu_use / 100;
              text1 = _("CPU");
              text2 = Math.round(this.cpu_use).toString() + "%";
              break;

          case "ram":
              this.get_ram_values();
              let ram_use = 100 * this.ram_values[1] / this.ram_values[0];
              value = ram_use / 100;
              let ram_prefix = "";
              if (this.data_prefix_ram == 1) {
                  // decimal prefix
                  ram_prefix =  _("GB");
              } else {
                  // binary prefix
                  ram_prefix =  _("GiB");
              }
              text1 = _("RAM");
              text2 = Math.round(ram_use).toString() + "%"
              text3 = this.ram_values[1].toFixed(1) + " / "
                    + this.ram_values[0].toFixed(1) + " " + ram_prefix;
              break;

          case "swap":
            this.get_swap_values();
            let swap_use = 100 * this.swap_values[1] / this.swap_values[0];
            value = swap_use / 100;
            let swap_prefix = "";
            if (this.data_prefix_swap == 1) {
                // decimal prefix
                swap_prefix =  _("GB");
            } else {
                // binary prefix
                swap_prefix =  _("GiB");
            }
            text1 = _("Swap");
            text2 = Math.round(swap_use).toString() + "%"
            text3 = this.swap_values[1].toFixed(1) + " / "
                  + this.swap_values[0].toFixed(1) + " " + swap_prefix;
            break;

          case "hdd":
              let dir_path = decodeURIComponent(this.filesystem.replace("file://", "").trim());
              if(dir_path == null || dir_path == "") dir_path = "/";
              this.get_hdd_values(dir_path);
              let hdd_use = Math.min(this.hdd_values[1], 100); //already in %
              value = hdd_use / 100;
              let hdd_prefix = "";
              if (this.data_prefix_hdd == 1) {
                  // decimal prefix
                  hdd_prefix =  _("GB");
              } else {
                  // binary prefix
                  hdd_prefix =  _("GiB");
              }
              text1 = this.filesystem_label;
              if (text1 == "") text1 = this.hdd_values[0].toString();
              text2 = Math.round(hdd_use).toString() + "%"
              text3 = this.hdd_values[3].toFixed(0) + " " + hdd_prefix + " " + _("free of") + " "
                    + this.hdd_values[2].toFixed(0) + " " + hdd_prefix;
              break;

          case "gpu":
              switch (this.gpu_manufacturer) {
                case "nvidia":
                    switch (this.gpu_variable) {
                        case "usage":
                            this.get_nvidia_gpu_use();
                            value = this.gpu_use / 100;
                            text1 = _("GPU Usage");
                            text2 = Math.round(this.gpu_use).toString() + "%";
                            break;
                        case "memory":
                            this.get_nvidia_gpu_mem();
                            let gpu_mem_use = 100 * this.gpu_mem[1] / this.gpu_mem[0];
                            value = gpu_mem_use / 100;
                            let gpumem_prefix = "";
                            if (this.data_prefix_gpumem == 1) {
                                // decimal prefix
                                gpumem_prefix =  _("GB");
                            } else {
                                // binary prefix
                                gpumem_prefix =  _("GiB");
                            }
                            text1 = _("GPU Memory");
                            text2 = Math.round(gpu_mem_use).toString() + "%"
                            text3 = this.gpu_mem[1].toFixed(1) + " / "
                                  + this.gpu_mem[0].toFixed(1) + " " + gpumem_prefix;
                            break;
                    }
                    break;

                case "other":
                    break
              }
              break;
        }

        // concatenate new value
        values.push(isNaN(value) ? 0 : value);
        values.shift();
        this.values = values;

        var background_colors = this.parse_rgba_settings(this.background_color);
        var midline_colors = this.parse_rgba_settings(this.midline_color);



        // draws graph
        let canvas = new Clutter.Canvas();
        canvas.set_size(desklet_w, desklet_h);
        canvas.connect('draw', function (canvas, ctx, desklet_w, desklet_h) {
            ctx.save();
            ctx.setOperator(Cairo.Operator.CLEAR);
            ctx.paint();
            ctx.restore();
            ctx.setOperator(Cairo.Operator.OVER);
            ctx.setLineWidth(2 * line_width);

            // desklet background
            ctx.setSourceRGBA(background_colors[0], background_colors[1], background_colors[2], background_colors[3]);
            ctx.newSubPath();
            ctx.arc(desklet_w - radius, radius, radius, -90 * degrees, 0 * degrees);
            ctx.arc(desklet_w - radius, desklet_h - radius, radius, 0 * degrees, 90 * degrees);
            ctx.arc(radius, desklet_h - radius, radius, 90 * degrees, 180 * degrees);
            ctx.arc(radius, radius, radius, 180 * degrees, 270 * degrees);
            ctx.closePath();
            ctx.fill();

            // graph border
            ctx.setSourceRGBA(line_colors[0], line_colors[1], line_colors[2], 1);
            ctx.rectangle(unit_size, margin_up, graph_w, graph_h);
            ctx.stroke();

            // graph V and H midlines
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

            // timeseries and area
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

            return false;
        });

        // labels: set text, style and position
        this.text1.set_text(text1);
        this.text1.style = "font-size: " + text1_size + "px;"
                         + "color: " + this.text_color + ";";
        this.text1.set_position(
            Math.round(unit_size),
            Math.round((2.5 * unit_size) - this.text1.get_height())
        );
        this.text2.set_text(text2);
        this.text2.style = "font-size: " + text2_size + "px;"
                         + "color: " + this.text_color + ";";
        this.text2.set_position(
            Math.round(this.text1.get_width() + (2 * unit_size)),
            Math.round((2.5 * unit_size) - this.text2.get_height())
        );
        this.text3.set_text(text3);
        this.text3.style = "font-size: " + text3_size + "px;"
                         + "color: " + this.text_color + ";";
        this.text3.set_position(
            Math.round((21 * unit_size) - this.text3.get_width()),
            Math.round((2.5 * unit_size) - this.text3.get_height())
        );


        // update canvas
        canvas.invalidate();
        this.canvas.set_content(canvas);
        this.canvas.set_size(desklet_w, desklet_h);
    },

    on_setting_changed: function() {
        // settings changed; instant refresh
        Mainloop.source_remove(this.timeout);
        this.first_run = true;
        this.update();
   },

    on_desklet_removed: function() {
        Mainloop.source_remove(this.timeout);
    },

    cpu_file: Gio.file_new_for_path('/proc/stat'),
    get_cpu_use: function() {
        // https://rosettacode.org/wiki/Linux_CPU_utilization
        this.cpu_file.load_contents_async(null, (file, response) => {
            let [success, contents, tag] = file.load_contents_finish(response);
            if(success) {
                let cpu_values = ByteArray.toString(contents).split("\n")[0].split(/\s+/);
                let cpu_idl = parseFloat(cpu_values[4]);
                let cpu_tot = 0;
                for (let i = 1; i<10; i++){
                  cpu_tot += parseFloat(cpu_values[i])
                }
                this.cpu_use = 100 * (1 - (cpu_idl - this.cpu_cpu_idl) / (cpu_tot - this.cpu_cpu_tot));
                this.cpu_cpu_tot = cpu_tot;
                this.cpu_cpu_idl = cpu_idl;
            }
            GLib.free(contents);
        });
    },

    ram_swap_file: Gio.file_new_for_path('/proc/meminfo'),
    get_ram_values: function() {
        // used  = total - available
        // while meminfo says "kb" the unit is kibibytes
        this.ram_swap_file.load_contents_async(null, (file, response) => {
            let [success, contents, tag] = file.load_contents_finish(response);
            if(success) {
                let mem = ByteArray.toString(contents);
                let mem_tot = parseInt(mem.match(/(MemTotal):\D+(\d+)/)[2]);
                let mem_usd = mem_tot - parseInt(mem.match(/(MemAvailable):\D+(\d+)/)[2]);
                let ram_tot
                let ram_usd
                if (this.data_prefix_ram == 1) {
                    // decimal prefix
                    ram_tot = mem_tot * 1024 / GB_TO_B;
                    ram_usd = mem_usd * 1024 / GB_TO_B;
                } else {
                    // binary prefix
                    ram_tot = mem_tot / GIB_TO_KIB;
                    ram_usd = mem_usd / GIB_TO_KIB;
                }
                this.ram_values = [ram_tot, ram_usd];
            }
            GLib.free(contents);
        });
    },

    get_swap_values: function() {
        // used  = total - available
        // while meminfo says "kb" the unit is kibibytes
        this.ram_swap_file.load_contents_async(null, (file, response) => {
            let [success, contents, tag] = file.load_contents_finish(response);
            if(success) {
                let mem = ByteArray.toString(contents);
                let mem_tot = parseInt(mem.match(/(SwapTotal):\D+(\d+)/)[2]);
                let mem_usd = mem_tot - parseInt(mem.match(/(SwapFree):\D+(\d+)/)[2]);
                let swap_tot
                let swap_usd
                if (this.data_prefix_swap == 1) {
                    // decimal prefix
                    swap_tot = mem_tot * 1024 / GB_TO_B;
                    swap_usd = mem_usd * 1024 / GB_TO_B;
                } else {
                    // binary prefix
                    swap_tot = mem_tot / GIB_TO_KIB;
                    swap_usd = mem_usd / GIB_TO_KIB;
                }
                this.swap_values = [swap_tot, swap_usd];
            }
            GLib.free(contents);
        });
    },

    hdd_file: Gio.file_new_for_path('/proc/diskstats'),
    get_hdd_values: function(dir_path) {
        // while df says "1K" it means 1 kibibyte
        let subprocess = new Gio.Subprocess({
        argv: ['/bin/df', dir_path],
        flags: Gio.SubprocessFlags.STDOUT_PIPE|Gio.SubprocessFlags.STDERR_PIPE,
        });
        subprocess.init(null);
        subprocess.wait_async(null, (sourceObject, res) => {
            let [, stdout, stderr] = sourceObject.communicate_utf8(null, null);
            let df_line = stdout.match(/.+/g)[1];
            let df_values = df_line.split(/\s+/); // split by space
            // values for partition space
            var hdd_tot;
            var hdd_fre;
            if (this.data_prefix_hdd == 1) {
                // decimal prefix
                hdd_tot = parseFloat(df_values[1]) * 1024 / GB_TO_B;
                hdd_fre = parseFloat(df_values[3]) * 1024 / GB_TO_B;
            } else {
                // binary prefix
                hdd_tot = parseFloat(df_values[1]) / GIB_TO_KIB;
                hdd_fre = parseFloat(df_values[3]) / GIB_TO_KIB;
            }
            // get IO utilization of partition
            let dev_fs = df_values[0];
            let fs = dev_fs.split(/\/+/)[2];
            let re = new RegExp(fs + '.+');
            // https://stackoverflow.com/questions/4458183/how-the-util-of-iostat-is-computed
            this.cpu_file.load_contents_async(null, (file, response) => {
                let [cpu_success, cpu_contents, cpu_tag] = file.load_contents_finish(response);
                if(!cpu_success) return;
                let cpu_line = ByteArray.toString(cpu_contents).match(/cpu\s.+/)[0];
                // get total CPU time
                let cpu_values = cpu_line.split(/\s+/);
                let hdd_cpu_tot = 0;
                for (let i = 1; i<10; i++){
                    hdd_cpu_tot += parseFloat(cpu_values[i])
                }
                this.hdd_file.load_contents_async(null, (file, response) => {
                    let [hdd_success, hdd_contents, hdd_tag] = file.load_contents_finish(response);
                    if(!hdd_success) return;
                    let hdd_line = ByteArray.toString(hdd_contents).match(re)[0];
                    // get total of IO times
                    let hdd_hdd_tot = hdd_line.split(/\s+/)[10];
                    // update HDD use
                    let hdd_use = 100 * (hdd_hdd_tot - this.hdd_hdd_tot) / (hdd_cpu_tot - this.hdd_cpu_tot);
                    // update global values
                    this.hdd_cpu_tot = hdd_cpu_tot;
                    this.hdd_hdd_tot = hdd_hdd_tot;
                    this.hdd_values = [fs, hdd_use, hdd_tot, hdd_fre];
                    GLib.free(hdd_contents);
                });
                GLib.free(cpu_contents);
            });
        });
    },

    parse_rgba_settings: function(color_str) {
        let colors = color_str.match(/\((.*?)\)/)[1].split(","); // get contents inside brackets: "rgb(...)"
        let r = parseInt(colors[0])/255;
        let g = parseInt(colors[1])/255;
        let b = parseInt(colors[2])/255;
        let a = 1;
        if (colors.length > 3) a = colors[3];
        return [r, g, b, a];
    },

    get_nvidia_gpu_use: function() {
        let subprocess = Gio.Subprocess.new(
            ['/usr/bin/nvidia-smi', '--query-gpu=utilization.gpu', '--format=csv', '--id='+ this.gpu_id],
            Gio.SubprocessFlags.STDOUT_PIPE|Gio.SubprocessFlags.STDERR_PIPE
        );
        subprocess.communicate_utf8_async(null, null, (subprocess, result) => {
            let [, stdout, stderr] = subprocess.communicate_utf8_finish(result);
            this.gpu_use =  parseInt(stdout.match(/[^\r\n]+/g)[1]); // parse integer in second line
        });
    },

    get_nvidia_gpu_mem: function() {
        let subprocess = Gio.Subprocess.new(
            ['/usr/bin/nvidia-smi', '--query-gpu=memory.total,memory.used', '--format=csv', '--id='+ this.gpu_id],
            Gio.SubprocessFlags.STDOUT_PIPE|Gio.SubprocessFlags.STDERR_PIPE
        );
        subprocess.communicate_utf8_async(null, null, (subprocess, result) => {
            let [, stdout, stderr] = subprocess.communicate_utf8_finish(result);
            let fslines = stdout.split(/\r?\n/); // Line0:Headers Line1:Values
            let items = fslines[1].split(',');   // Values are comma-separated
            let mem_tot
            let mem_usd
            if (this.data_prefix_gpumem == 1) {
                // decimal prefix
                mem_tot =  parseInt(items[0]) * 1024 * 1024 / GB_TO_B;
                mem_usd =  parseInt(items[1]) * 1024 * 1024 / GB_TO_B;
            } else {
                // binary prefix
                mem_tot =  parseInt(items[0]) / GIB_TO_MIB;
                mem_usd =  parseInt(items[1]) / GIB_TO_MIB;
            }
            this.gpu_mem[0] = mem_tot;
            this.gpu_mem[1] = mem_usd;
        });
    }

};
