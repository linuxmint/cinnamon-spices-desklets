const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
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

        this._destroyed = false;
        this._syncing_table = false;
        this._discovered_sensors = null;
        this._refresh_pending = false;

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

        this._apply_decoration();
        this._rediscover_sensors().then(() => {
            if (!this._destroyed)
                this._schedule_refresh(true);
        });
    },

    on_settings_changed: function() {
        if (this._syncing_table)
            return;

        if (this.refresh_sensors) {
            this._syncing_table = true;
            this.settings.setValue("refresh-sensors", false);
            this.refresh_sensors = false;
            this._syncing_table = false;
            this._rediscover_sensors(true).then(() => {
                if (!this._destroyed)
                    this._schedule_refresh(true);
            });
            return;
        }

        this._apply_decoration();
        this._schedule_refresh(true);
    },

    on_desklet_removed: function() {
        this._destroyed = true;
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
            () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            }
        );
    },

    _read_text_async: function(path) {
        return new Promise((resolve) => {
            let file = Gio.File.new_for_path(path);
            file.load_contents_async(null, (obj, res) => {
                try {
                    let [ok, bytes] = obj.load_contents_finish(res);
                    if (!ok) {
                        resolve(null);
                        return;
                    }
                    if (imports.byteArray)
                        resolve(imports.byteArray.toString(bytes).trim());
                    else
                        resolve(bytes.toString().trim());
                } catch (e) {
                    resolve(null);
                }
            });
        });
    },

    _enumerate_children_async: function(dirFile) {
        return new Promise((resolve) => {
            dirFile.enumerate_children_async(
                "standard::name",
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                null,
                (file, res) => {
                    try {
                        resolve(file.enumerate_children_finish(res));
                    } catch (e) {
                        resolve(null);
                    }
                }
            );
        });
    },

    _collect_enum_names: function(enumerator) {
        let names = [];
        if (!enumerator)
            return names;

        let info;
        while ((info = enumerator.next_file(null)) !== null)
            names.push(info.get_name());
        return names;
    },

    _query_symlink_target_async: function(file) {
        return new Promise((resolve) => {
            file.query_info_async(
                "standard::symlink-target",
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                null,
                (obj, res) => {
                    try {
                        resolve(obj.query_info_finish(res).get_symlink_target());
                    } catch (e) {
                        resolve(null);
                    }
                }
            );
        });
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

    _nvme_index_from_hwmon_async: function(hwmon_base) {
        let file = Gio.File.new_for_path(hwmon_base + "/device");
        return this._query_symlink_target_async(file).then((target) => {
            if (!target)
                return null;
            let match = target.match(/nvme(\d+)(?:\/|$)/);
            return match ? parseInt(match[1], 10) : null;
        });
    },

    _temp_label_for_async: function(hwmon_base, input_name) {
        let label_path = hwmon_base + "/" + input_name.replace("_input", "_label");
        return this._read_text_async(label_path);
    },

    _friendly_name_async: function(chip, temp_label, input_name, hwmon_base) {
        if (chip === "nvme") {
            return this._nvme_index_from_hwmon_async(hwmon_base).then((idx) => {
                let model_promise = idx !== null ?
                    this._nvme_short_name_async(idx) : Promise.resolve("NVMe");
                return model_promise.then((model) => {
                    if (temp_label)
                        return model + " · " + temp_label;
                    return model + " · " + input_name.replace("_input", "");
                });
            });
        }

        if (chip === "k10temp" || chip === "coretemp" || chip === "zenpower") {
            if (temp_label)
                return Promise.resolve("CPU · " + temp_label);
            return Promise.resolve("CPU");
        }
        if (chip === "amdgpu" || chip === "amdgpu_pp" || chip === "radeon" ||
            chip === "nouveau" || chip === "nvidia") {
            if (temp_label)
                return Promise.resolve("GPU · " + temp_label);
            return Promise.resolve("GPU");
        }
        if (WIFI_CHIP_RE.test(chip))
            return Promise.resolve(temp_label ? "Wi-Fi · " + temp_label : "Wi-Fi");
        if (chip === "drivetemp")
            return Promise.resolve(temp_label ? "Drive · " + temp_label : "Drive");

        if (temp_label)
            return Promise.resolve(chip + " · " + temp_label);
        return Promise.resolve(chip + " · " + input_name.replace("_input", ""));
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

    _add_temp_sensor_async: function(sensors, seen, hwmon_base, input_name, chip, hw_tag) {
        let path = hwmon_base + "/" + input_name;
        let canon = this._canonical_path(path);
        let id = "path:" + canon;
        if (seen[id])
            return Promise.resolve();

        return this._read_text_async(path).then((probe) => {
            if (probe === null)
                return;

            seen[id] = true;
            return this._temp_label_for_async(hwmon_base, input_name).then((temp_label) => {
                let input_key = input_name.replace("_input", "");
                let category = this._chip_category(chip);
                let index = parseInt((input_key.match(/(\d+)/) || ["0"])[1], 10);

                return this._friendly_name_async(chip, temp_label, input_name, hwmon_base).then((label) => {
                    sensors.push(this._make_sensor(
                        id,
                        label,
                        this._sensor_detail(chip, temp_label, input_name, hw_tag || hwmon_base),
                        category * 10 + index
                    ));
                });
            });
        });
    },

    _enumerate_temp_inputs_async: function(dir_path) {
        let dir = Gio.File.new_for_path(dir_path);
        return this._enumerate_children_async(dir).then((enumerator) => {
            return this._collect_enum_names(enumerator).filter(function(name) {
                return name.match(/^temp\d+_input$/);
            });
        });
    },

    _nvme_hwmon_base_async: function(nvme_index) {
        let nvme_dir = "/sys/class/nvme/nvme" + nvme_index;
        let dir = Gio.File.new_for_path(nvme_dir);
        return this._enumerate_children_async(dir).then((enumerator) => {
            let names = this._collect_enum_names(enumerator);
            for (let i = 0; i < names.length; i++) {
                if (names[i].indexOf("hwmon") === 0)
                    return nvme_dir + "/" + names[i];
            }
            return null;
        });
    },

    _nvme_short_name_async: function(nvme_index) {
        return this._read_text_async("/sys/block/nvme" + nvme_index + "n1/device/model").then((model) => {
            if (!model)
                return "NVMe " + nvme_index;
            return model.replace(/\s+/g, " ").trim();
        });
    },

    _discover_hwmon_sensors_async: function(sensors, seen) {
        let dir = Gio.File.new_for_path("/sys/class/hwmon");
        return this._enumerate_children_async(dir).then((enumerator) => {
            let hw_names = this._collect_enum_names(enumerator);
            let chain = Promise.resolve();

            hw_names.forEach((hw) => {
                chain = chain.then(() => {
                    let base = "/sys/class/hwmon/" + hw;
                    return this._read_text_async(base + "/name").then((chip) => {
                        if (!chip)
                            return;

                        return this._enumerate_temp_inputs_async(base).then((inputs) => {
                            let input_chain = Promise.resolve();
                            inputs.forEach((input_name) => {
                                input_chain = input_chain.then(() =>
                                    this._add_temp_sensor_async(sensors, seen, base, input_name, chip, hw)
                                );
                            });
                            return input_chain;
                        });
                    });
                });
            });

            return chain;
        });
    },

    _discover_nvme_class_sensors_async: function(sensors, seen) {
        let chain = Promise.resolve();

        for (let i = 0; i < 16; i++) {
            let idx = i;
            chain = chain.then(() => {
                return this._nvme_hwmon_base_async(idx).then((base) => {
                    if (!base)
                        return;

                    let tag = "nvme" + idx;
                    return this._enumerate_temp_inputs_async(base).then((inputs) => {
                        let input_chain = Promise.resolve();
                        inputs.forEach((input_name) => {
                            input_chain = input_chain.then(() =>
                                this._add_temp_sensor_async(sensors, seen, base, input_name, "nvme", tag)
                            );
                        });
                        return input_chain;
                    });
                });
            });
        }

        return chain;
    },

    _make_sensor: function(id, label, detail, sort_key) {
        return {
            id: id,
            label: label,
            detail: detail,
            sort: sort_key
        };
    },

    _discover_all_sensors_async: function() {
        let sensors = [];
        let seen = {};

        return this._discover_hwmon_sensors_async(sensors, seen)
            .then(() => this._discover_nvme_class_sensors_async(sensors, seen))
            .then(() => {
                sensors.sort(function(a, b) {
                    if (a.sort !== b.sort)
                        return a.sort - b.sort;
                    return a.label.localeCompare(b.label);
                });
                return sensors;
            });
    },

    _rediscover_sensors: function(force_sync) {
        return this._discover_all_sensors_async().then((sensors) => {
            if (this._destroyed)
                return;
            this._discovered_sensors = sensors;
            this._sync_sensor_table(force_sync === true);
        });
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
        let discovered = this._discovered_sensors;
        if (!discovered)
            return;

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

    _read_temp_c_async: function(path) {
        if (!path)
            return Promise.resolve(null);

        return this._read_text_async(path).then((raw) => {
            if (!raw)
                return null;
            let value = parseInt(raw, 10);
            if (isNaN(value))
                return null;
            return value / 1000.0;
        });
    },

    _resolve_chip_temp_path_async: function(chip, input_key) {
        let dir = Gio.File.new_for_path("/sys/class/hwmon");
        let input_name = input_key.indexOf("temp") === 0 ? input_key + "_input" : input_key;

        return this._enumerate_children_async(dir).then((enumerator) => {
            let hw_names = this._collect_enum_names(enumerator);
            let chain = Promise.resolve(null);

            hw_names.forEach((hw) => {
                chain = chain.then((found) => {
                    if (found)
                        return found;

                    let base = "/sys/class/hwmon/" + hw;
                    return this._read_text_async(base + "/name").then((name) => {
                        if (name !== chip)
                            return null;
                        let path = base + "/" + input_name;
                        return this._read_text_async(path).then((probe) => probe === null ? null : path);
                    });
                });
            });

            return chain;
        });
    },

    _read_hwmon_max_temp_c_async: function(hwmon_base) {
        if (!hwmon_base)
            return Promise.resolve(null);

        let dir = Gio.File.new_for_path(hwmon_base);
        return this._enumerate_children_async(dir).then((enumerator) => {
            let names = this._collect_enum_names(enumerator).filter(function(name) {
                return name.match(/^temp\d+_input$/);
            });

            return Promise.all(names.map((name) =>
                this._read_temp_c_async(hwmon_base + "/" + name)
            )).then((temps) => {
                let max = null;
                temps.forEach((temp) => {
                    if (temp !== null && (max === null || temp > max))
                        max = temp;
                });
                return max;
            });
        });
    },

    _read_sensor_temp_async: function(sensor_id) {
        if (!sensor_id)
            return Promise.resolve(null);

        if (sensor_id.indexOf("path:") === 0)
            return this._read_temp_c_async(sensor_id.substring(5));

        if (sensor_id.indexOf("nvme:") === 0) {
            let parts = sensor_id.split(":");
            if (parts.length >= 3 && parts[2] === "max") {
                let idx = parseInt(parts[1], 10);
                return this._nvme_hwmon_base_async(idx).then((hwmon) =>
                    this._read_hwmon_max_temp_c_async(hwmon)
                );
            }
        }

        if (sensor_id.indexOf("chip:") === 0) {
            let body = sensor_id.substring(5);
            let last_colon = body.lastIndexOf(":");
            if (last_colon < 0)
                return Promise.resolve(null);
            let chip = body.substring(0, last_colon);
            let input_key = body.substring(last_colon + 1);
            return this._resolve_chip_temp_path_async(chip, input_key).then((path) =>
                this._read_temp_c_async(path)
            );
        }

        return Promise.resolve(null);
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
        if (this._refresh_pending)
            return;
        this._refresh_pending = true;

        this._refresh_async().then(() => {
            this._refresh_pending = false;
        }, () => {
            this._refresh_pending = false;
        });
    },

    _refresh_async: function() {
        if (!this._discovered_sensors)
            return Promise.resolve();

        if (!this.sensor_table || !this.sensor_table.length ||
            this._sensor_table_needs_resync(this.sensor_table, this._discovered_sensors))
            this._sync_sensor_table(false);

        this.window.remove_all_children();

        let scale = this.scale_size || 1.0;
        let gaugeSize = Math.round(BASE_GAUGE * scale * global.ui_scale);
        let colWidth = gaugeSize + Math.round(16 * scale * global.ui_scale);
        let rowHeight = gaugeSize + Math.round(52 * scale * global.ui_scale);
        let vertical = this.layout_mode === "vertical";

        let table = this.sensor_table || [];
        let enabled_rows = [];
        for (let i = 0; i < table.length; i++) {
            if (table[i].enabled !== false)
                enabled_rows.push(table[i]);
        }

        if (enabled_rows.length === 0) {
            let hint = new St.Label({
                text: table.length ? "No sensors selected — open desklet settings" : "Scanning sensors…"
            });
            hint.set_position(0, 0);
            this.window.add_actor(hint);
            this.window.set_size(280, 30);
            return Promise.resolve();
        }

        return Promise.all(enabled_rows.map((row) => {
            return this._read_sensor_temp_async(row["sensor-id"]).then((temp) => ({
                temp: temp,
                label: row.label,
                sub: row.detail
            }));
        })).then((items) => {
            if (this._destroyed)
                return;
            this._draw_items(items, scale, gaugeSize, colWidth, rowHeight, vertical);
        });
    }
};

function main(metadata, desklet_id) {
    return new ThermoGaugeDesklet(metadata, desklet_id);
}
