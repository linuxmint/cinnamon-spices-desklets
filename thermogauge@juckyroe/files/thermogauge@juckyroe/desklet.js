const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Cairo = imports.cairo;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const BASE_GAUGE = 130;
const GAUGE_START = Math.PI * 0.75;
const GAUGE_SPAN = Math.PI * 1.5;

const CPU_CHIPS = ["k10temp", "coretemp", "zenpower", "cpu_thermal"];
const GPU_CHIPS = ["amdgpu", "amdgpu_pp", "nouveau", "nvidia", "i915", "radeon"];
const WIFI_CHIP_RE = /^(mt\d|iwlwifi|ath\d|rtw\d|brcmfmac|wl|phy)/i;

function ThermoGaugeDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

ThermoGaugeDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this._syncing_table = false;
        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "sensor-table", "sensor_table", this.on_settings_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-sensors", "refresh_sensors", this.on_settings_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-interval", "refresh_interval", this.on_settings_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "gauge-max-temp", "gauge_max_temp", this.on_settings_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "layout", "layout_mode", this.on_settings_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scale_size", this.on_settings_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hide_decorations", this.on_settings_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "text_color", this.on_settings_changed);

        this.timeout_id = 0;
        this.window = new Clutter.Actor();
        this.setContent(this.window);

        this._sync_sensor_table(false);
        this._apply_decoration();
        this._schedule_refresh(true);
    },

    on_settings_changed: function() {
        if (this._syncing_table)
            return;

        if (this.refresh_sensors) {
            this._sync_sensor_table(true);
            this._syncing_table = true;
            this.settings.setValue("refresh-sensors", false);
            this.refresh_sensors = false;
            this._syncing_table = false;
        }

        this._apply_decoration();
        this._schedule_refresh(true);
    },

    on_desklet_removed: function() {
        if (this.timeout_id)
            Mainloop.source_remove(this.timeout_id);
        this.timeout_id = 0;
    },

    _apply_decoration: function() {
        this.metadata["prevent-decorations"] = this.hide_decorations;
        this._updateDecoration();
    },

    _schedule_refresh: function(immediate) {
        if (this.timeout_id) {
            Mainloop.source_remove(this.timeout_id);
            this.timeout_id = 0;
        }
        if (immediate)
            this._refresh();
        let interval = this.refresh_interval || 2;
        this.timeout_id = Mainloop.timeout_add_seconds(
            interval,
            Lang.bind(this, this._refresh_loop)
        );
    },

    _refresh_loop: function() {
        this._refresh();
        return true;
    },

    _read_text: function(path) {
        try {
            let file = Gio.File.new_for_path(path);
            if (!file.query_exists(null))
                return null;
            let [ok, bytes] = file.load_contents(null);
            if (ok) {
                if (imports.byteArray)
                    return imports.byteArray.toString(bytes).trim();
                return bytes.toString().trim();
            }
        } catch (e) {
            /* optional sysfs nodes may be absent */
        }
        return null;
    },

    _chip_category: function(chip) {
        if (CPU_CHIPS.indexOf(chip) >= 0)
            return 1;
        if (GPU_CHIPS.indexOf(chip) >= 0)
            return 2;
        if (chip === "nvme" || chip === "drivetemp")
            return 3;
        if (WIFI_CHIP_RE.test(chip))
            return 4;
        return 5;
    },

    _canonical_path: function(path) {
        try {
            return GLib.canonicalize_filename(path, null);
        } catch (e) {
            return path;
        }
    },

    _nvme_index_from_hwmon: function(hwmon_base) {
        try {
            let file = Gio.File.new_for_path(hwmon_base + "/device");
            let info = file.query_info(
                "standard::symlink-target",
                Gio.FileQueryInfoFlags.NONE,
                null
            );
            let target = info.get_symlink_target();
            if (!target)
                return null;
            let match = target.match(/nvme(\d+)(?:\/|$)/);
            return match ? parseInt(match[1], 10) : null;
        } catch (e) {
            return null;
        }
    },

    _temp_label_for: function(hwmon_base, input_name) {
        let label_path = hwmon_base + "/" + input_name.replace("_input", "_label");
        return this._read_text(label_path);
    },

    _friendly_name: function(chip, temp_label, input_name, hwmon_base) {
        if (chip === "nvme") {
            let idx = this._nvme_index_from_hwmon(hwmon_base);
            let model = idx !== null ? this._nvme_short_name(idx) : "NVMe";
            if (temp_label)
                return model + " · " + temp_label;
            return model + " · " + input_name.replace("_input", "");
        }

        if (chip === "k10temp" || chip === "coretemp" || chip === "zenpower") {
            if (temp_label)
                return "CPU · " + temp_label;
            return "CPU";
        }
        if (chip === "amdgpu" || chip === "amdgpu_pp" || chip === "radeon" ||
            chip === "nouveau" || chip === "nvidia") {
            if (temp_label)
                return "GPU · " + temp_label;
            return "GPU";
        }
        if (WIFI_CHIP_RE.test(chip))
            return temp_label ? "Wi-Fi · " + temp_label : "Wi-Fi";
        if (chip === "drivetemp")
            return temp_label ? "Drive · " + temp_label : "Drive";

        if (temp_label)
            return chip + " · " + temp_label;
        return chip + " · " + input_name.replace("_input", "");
    },

    _sensor_detail: function(chip, temp_label, input_name, extra) {
        let bits = [chip];
        if (temp_label)
            bits.push(temp_label);
        else if (input_name)
            bits.push(input_name.replace("_input", ""));
        if (extra)
            bits.push(extra);
        return bits.join(" · ");
    },

    _add_temp_sensor: function(sensors, seen, hwmon_base, input_name, chip, hw_tag) {
        let path = hwmon_base + "/" + input_name;
        if (!Gio.File.new_for_path(path).query_exists(null))
            return;

        let canon = this._canonical_path(path);
        let id = "path:" + canon;
        if (seen[id])
            return;
        seen[id] = true;

        let temp_label = this._temp_label_for(hwmon_base, input_name);
        let input_key = input_name.replace("_input", "");
        let category = this._chip_category(chip);
        let index = parseInt((input_key.match(/(\d+)/) || ["0"])[1], 10);

        sensors.push(this._make_sensor(
            id,
            this._friendly_name(chip, temp_label, input_name, hwmon_base),
            this._sensor_detail(chip, temp_label, input_name, hw_tag || hwmon_base),
            category * 10 + index
        ));
    },

    _enumerate_temp_inputs: function(dir_path, callback) {
        let dir = Gio.File.new_for_path(dir_path);
        if (!dir.query_exists(null))
            return;

        let enumerator;
        try {
            enumerator = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            return;
        }

        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            let name = info.get_name();
            if (name.match(/^temp\d+_input$/))
                callback(name);
        }
    },

    _nvme_hwmon_base: function(nvme_index) {
        let nvme_dir = "/sys/class/nvme/nvme" + nvme_index;
        let dir = Gio.File.new_for_path(nvme_dir);
        if (!dir.query_exists(null))
            return null;

        let enumerator;
        try {
            enumerator = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            return null;
        }

        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            let name = info.get_name();
            if (name.indexOf("hwmon") === 0)
                return nvme_dir + "/" + name;
        }
        return null;
    },

    _nvme_short_name: function(nvme_index) {
        let model = this._read_text("/sys/block/nvme" + nvme_index + "n1/device/model");
        if (!model)
            return "NVMe " + nvme_index;
        return model.replace(/\s+/g, " ").trim();
    },

    _discover_hwmon_sensors: function(sensors, seen) {
        let dir = Gio.File.new_for_path("/sys/class/hwmon");
        let enumerator;
        try {
            enumerator = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            return;
        }

        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            let hw = info.get_name();
            let base = "/sys/class/hwmon/" + hw;
            let chip = this._read_text(base + "/name");
            if (!chip)
                continue;

            let desklet = this;
            this._enumerate_temp_inputs(base, function(input_name) {
                desklet._add_temp_sensor(sensors, seen, base, input_name, chip, hw);
            });
        }
    },

    _discover_nvme_class_sensors: function(sensors, seen) {
        for (let i = 0; i < 16; i++) {
            let base = this._nvme_hwmon_base(i);
            if (!base)
                continue;

            let tag = "nvme" + i;
            let desklet = this;
            this._enumerate_temp_inputs(base, function(input_name) {
                desklet._add_temp_sensor(sensors, seen, base, input_name, "nvme", tag);
            });
        }
    },

    _make_sensor: function(id, label, detail, sort_key) {
        return {
            id: id,
            label: label,
            detail: detail,
            sort: sort_key
        };
    },

    _discover_all_sensors: function() {
        let sensors = [];
        let seen = {};
        this._discover_hwmon_sensors(sensors, seen);
        this._discover_nvme_class_sensors(sensors, seen);
        sensors.sort(function(a, b) {
            if (a.sort !== b.sort)
                return a.sort - b.sort;
            return a.label.localeCompare(b.label);
        });
        return sensors;
    },

    _table_signature: function(table) {
        if (!table || !table.length)
            return "";
        return table.map(function(row) {
            return row["sensor-id"] + ":" + row.label + ":" + row.detail + ":" + row.enabled;
        }).join("|");
    },

    _sensor_table_needs_resync: function(saved, discovered) {
        if (!discovered || !discovered.length)
            return false;
        if (!saved || !saved.length)
            return true;

        if (saved.length !== discovered.length)
            return true;

        let saved_ids = {};
        saved.forEach(function(row) {
            let id = row["sensor-id"] || "";
            if (id.indexOf("path:") !== 0)
                return;
            saved_ids[id] = true;
        });

        for (let i = 0; i < discovered.length; i++) {
            if (!saved_ids[discovered[i].id])
                return true;
        }

        for (let j = 0; j < saved.length; j++) {
            let legacy_id = saved[j]["sensor-id"] || "";
            if (legacy_id.indexOf("path:") !== 0)
                return true;
        }

        return false;
    },

    _legacy_enabled_maps: function(saved) {
        let enabled_by_id = {};
        let enabled_by_name = {};
        let enabled_by_detail = {};
        let nvme_max_enabled = {};

        saved.forEach(function(row) {
            let id = row["sensor-id"] || "";
            let enabled = row.enabled !== false;

            if (id)
                enabled_by_id[id] = enabled;
            if (row.detail)
                enabled_by_detail[row.detail] = enabled;
            enabled_by_name[row.label + "\0" + row.detail] = enabled;

            let nvme_match = id.match(/^nvme:(\d+):max$/);
            if (nvme_match)
                nvme_max_enabled[nvme_match[1]] = enabled;
        });

        return {
            enabled_by_id: enabled_by_id,
            enabled_by_name: enabled_by_name,
            enabled_by_detail: enabled_by_detail,
            nvme_max_enabled: nvme_max_enabled
        };
    },

    _enabled_for_discovered_sensor: function(sensor, maps, default_enabled) {
        if (maps.enabled_by_id.hasOwnProperty(sensor.id))
            return maps.enabled_by_id[sensor.id];
        if (maps.enabled_by_detail.hasOwnProperty(sensor.detail))
            return maps.enabled_by_detail[sensor.detail];
        if (maps.enabled_by_name.hasOwnProperty(sensor.label + "\0" + sensor.detail))
            return maps.enabled_by_name[sensor.label + "\0" + sensor.detail];

        let tag = sensor.detail.split(" · ").pop();
        if (tag && tag.indexOf("nvme") === 0) {
            let idx = tag.substring(4);
            if (maps.nvme_max_enabled.hasOwnProperty(idx))
                return maps.nvme_max_enabled[idx];
        }

        return default_enabled;
    },

    _sync_sensor_table: function(force) {
        let discovered = this._discover_all_sensors();
        let saved = this.sensor_table;
        if (!saved || !Array.isArray(saved))
            saved = [];

        let maps = this._legacy_enabled_maps(saved);
        let default_enabled = saved.length === 0;
        let new_table = discovered.map(function(sensor) {
            return {
                enabled: this._enabled_for_discovered_sensor(sensor, maps, default_enabled),
                label: sensor.label,
                detail: sensor.detail,
                "sensor-id": sensor.id
            };
        }, this);

        let needs_resync = this._sensor_table_needs_resync(saved, discovered);
        if (force || needs_resync ||
            this._table_signature(new_table) !== this._table_signature(saved)) {
            this._syncing_table = true;
            this.settings.setValue("sensor-table", new_table);
            this.sensor_table = new_table;
            this._syncing_table = false;
        }
    },

    _read_sensor_temp: function(sensor_id) {
        if (!sensor_id)
            return null;

        if (sensor_id.indexOf("path:") === 0)
            return this._read_temp_c(sensor_id.substring(5));

        /* legacy IDs from older versions */
        if (sensor_id.indexOf("nvme:") === 0) {
            let parts = sensor_id.split(":");
            if (parts.length >= 3 && parts[2] === "max") {
                let idx = parseInt(parts[1], 10);
                let hwmon = this._nvme_hwmon_base(idx);
                return this._read_hwmon_max_temp_c(hwmon);
            }
        }

        if (sensor_id.indexOf("chip:") === 0) {
            let body = sensor_id.substring(5);
            let last_colon = body.lastIndexOf(":");
            if (last_colon < 0)
                return null;
            let chip = body.substring(0, last_colon);
            let input_key = body.substring(last_colon + 1);
            let path = this._resolve_chip_temp_path(chip, input_key);
            return this._read_temp_c(path);
        }

        return null;
    },

    _resolve_chip_temp_path: function(chip, input_key) {
        let dir = Gio.File.new_for_path("/sys/class/hwmon");
        let enumerator;
        try {
            enumerator = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            return null;
        }

        let input_name = input_key.indexOf("temp") === 0 ? input_key + "_input" : input_key;
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            let hw = info.get_name();
            let base = "/sys/class/hwmon/" + hw;
            if (this._read_text(base + "/name") !== chip)
                continue;
            let path = base + "/" + input_name;
            if (Gio.File.new_for_path(path).query_exists(null))
                return path;
        }
        return null;
    },

    _read_temp_c: function(path) {
        if (!path)
            return null;
        let raw = this._read_text(path);
        if (!raw)
            return null;
        let value = parseInt(raw, 10);
        if (isNaN(value))
            return null;
        return value / 1000.0;
    },

    _read_hwmon_max_temp_c: function(hwmon_base) {
        if (!hwmon_base)
            return null;

        let dir = Gio.File.new_for_path(hwmon_base);
        let enumerator;
        try {
            enumerator = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            return null;
        }

        let max = null;
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            let name = info.get_name();
            if (!name.match(/^temp\d+_input$/))
                continue;
            let temp = this._read_temp_c(hwmon_base + "/" + name);
            if (temp !== null && (max === null || temp > max))
                max = temp;
        }
        return max;
    },

    _temp_color: function(temp) {
        if (temp === null)
            return [0.45, 0.45, 0.45, 1.0];

        let t = Math.max(0, Math.min(temp, 100));
        if (t < 45)
            return [0.0, 0.74, 0.83, 1.0];
        if (t < 60)
            return [0.30, 0.78, 0.40, 1.0];
        if (t < 75)
            return [1.0, 0.76, 0.03, 1.0];
        if (t < 85)
            return [1.0, 0.60, 0.0, 1.0];
        return [0.96, 0.26, 0.21, 1.0];
    },

    _label_style: function(sizePx, bold) {
        return "font-size: " + sizePx + "px;" +
            (bold ? "font-weight: bold;" : "") +
            "color: " + (this.text_color || "rgb(240,240,240)") + ";";
    },

    _make_canvas_actor: function(temp, size) {
        let maxTemp = this.gauge_max_temp || 100;
        let ratio = temp === null ? 0 : Math.max(0, Math.min(temp / maxTemp, 1.0));
        let color = this._temp_color(temp);

        let canvas = new Clutter.Canvas();
        canvas.set_size(size, size);
        canvas.connect("draw", function(canvas, cr, width, height) {
            cr.save();
            cr.setOperator(Cairo.Operator.CLEAR);
            cr.paint();
            cr.restore();
            cr.setOperator(Cairo.Operator.OVER);
            cr.scale(width, height);
            cr.translate(0.5, 0.5);

            let radius = 0.42;
            cr.setLineCap(Cairo.LineCap.ROUND);

            cr.setSourceRGBA(1, 1, 1, 0.12);
            cr.setLineWidth(0.08);
            cr.arc(0, 0, radius, GAUGE_START, GAUGE_START + GAUGE_SPAN);
            cr.stroke();

            if (ratio > 0) {
                cr.setSourceRGBA(color[0], color[1], color[2], color[3]);
                cr.setLineWidth(0.08);
                cr.arc(0, 0, radius, GAUGE_START, GAUGE_START + GAUGE_SPAN * ratio);
                cr.stroke();
            }

            cr.setSourceRGBA(color[0], color[1], color[2], 0.18);
            cr.arc(0, 0, radius - 0.11, 0, Math.PI * 2);
            cr.fill();

            return true;
        });
        canvas.invalidate();

        let actor = new Clutter.Actor();
        actor.set_content(canvas);
        actor.set_size(size, size);
        return actor;
    },

    _draw_items: function(items, scale, gaugeSize, colWidth, rowHeight, vertical) {
        for (let i = 0; i < items.length; i++) {
            let item = items[i];
            let px = vertical ? 0 : i * colWidth;
            let py = vertical ? i * rowHeight : 0;

            let canvasActor = this._make_canvas_actor(item.temp, gaugeSize);
            canvasActor.set_position(px, py);
            this.window.add_actor(canvasActor);

            let valueLabel = new St.Label({
                text: item.temp === null ? "—" : Math.round(item.temp) + "°C"
            });
            valueLabel.set_position(px, py + gaugeSize + 2);
            valueLabel.style = this._label_style(Math.round(22 * scale), true);
            this.window.add_actor(valueLabel);

            let nameLabel = new St.Label({ text: item.label });
            nameLabel.set_position(px, py + gaugeSize + Math.round(24 * scale));
            nameLabel.style = this._label_style(Math.round(12 * scale), true);
            this.window.add_actor(nameLabel);

            let subLabel = new St.Label({ text: item.sub });
            subLabel.set_position(px, py + gaugeSize + Math.round(38 * scale));
            subLabel.style = this._label_style(Math.round(10 * scale), false);
            this.window.add_actor(subLabel);
        }

        let totalW = vertical ? colWidth : colWidth * items.length;
        let totalH = vertical ? rowHeight * items.length : rowHeight;
        this.window.set_size(totalW, totalH);
    },

    _refresh: function() {
        let discovered = this._discover_all_sensors();
        if (!this.sensor_table || !this.sensor_table.length ||
            this._sensor_table_needs_resync(this.sensor_table, discovered))
            this._sync_sensor_table(false);

        this.window.remove_all_children();

        let scale = this.scale_size || 1.0;
        let gaugeSize = Math.round(BASE_GAUGE * scale * global.ui_scale);
        let colWidth = gaugeSize + Math.round(16 * scale * global.ui_scale);
        let rowHeight = gaugeSize + Math.round(52 * scale * global.ui_scale);
        let vertical = this.layout_mode === "vertical";

        let items = [];
        let table = this.sensor_table || [];
        for (let i = 0; i < table.length; i++) {
            let row = table[i];
            if (row.enabled === false)
                continue;
            items.push({
                temp: this._read_sensor_temp(row["sensor-id"]),
                label: row.label,
                sub: row.detail
            });
        }

        if (items.length === 0) {
            let hint = new St.Label({
                text: table.length ? "No sensors selected — open desklet settings" : "Scanning sensors…"
            });
            hint.set_position(0, 0);
            this.window.add_actor(hint);
            this.window.set_size(280, 30);
            return;
        }

        this._draw_items(items, scale, gaugeSize, colWidth, rowHeight, vertical);
    }
};

function main(metadata, desklet_id) {
    return new ThermoGaugeDesklet(metadata, desklet_id);
}
