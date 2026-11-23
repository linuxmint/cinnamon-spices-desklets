const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Cairo = imports.cairo;

// Visual settings (not user-configurable)
const WIDGET_WIDTH = 280;
const WIDGET_HEIGHT = 340;

function VictronDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

VictronDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);
        
        this.metadata = metadata;
        this.deskletId = deskletId;
        this.data = {};
        this.mqttPid = null;
        
        this._bindSettings();
        this.setupUI();
        this.startMqtt();
        this.startKeepalive();
        this.startUpdateLoop();
    },

    _bindSettings: function() {
        try {
            this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, this.deskletId);
            
            this.settings.bind("cerbo_host", "cerboHost", this._onConnectionSettingsChanged);
            this.settings.bind("portal_id", "portalId", this._onConnectionSettingsChanged);
            this.settings.bind("battery_wh", "batteryWh");
            this.settings.bind("update_interval", "updateInterval", this._onUpdateIntervalChanged);
            this.settings.bind("keepalive_interval", "keepaliveInterval", this._onKeepaliveIntervalChanged);
        } catch (e) {
            global.logError("Victron desklet: Failed to bind settings: " + e);
            // Use defaults if settings fail
            this.cerboHost = "cerbo.home";
            this.portalId = "c0619ab4f176";
            this.batteryWh = 15000;
            this.updateInterval = 2;
            this.keepaliveInterval = 30;
        }
    },

    _onConnectionSettingsChanged: function() {
        // Restart MQTT with new connection settings
        this.stopMqtt();
        this.startMqtt();
    },

    _onUpdateIntervalChanged: function() {
        if (this.updateLoop) {
            Mainloop.source_remove(this.updateLoop);
        }
        this.startUpdateLoop();
    },

    _onKeepaliveIntervalChanged: function() {
        if (this.keepaliveLoop) {
            Mainloop.source_remove(this.keepaliveLoop);
        }
        this.startKeepalive();
    },

    setupUI: function() {
        // Main canvas for everything
        this.canvas = new St.DrawingArea({
            style_class: "victron-canvas"
        });
        this.canvas.set_size(WIDGET_WIDTH, WIDGET_HEIGHT);
        this.canvas.connect("repaint", (area) => this.draw(area));
        
        this.setContent(this.canvas);
    },

    draw: function(area) {
        let cr = area.get_context();
        let [w, h] = area.get_surface_size();
        
        let soc = this.data.soc || 0;
        let solar = this.data.solar || 0;
        let consumption = this.data.consumption || 0;
        let batteryPower = this.data.batteryPower || 0;

        // Background
        cr.setSourceRGBA(0.12, 0.12, 0.14, 0.95);
        this.roundedRect(cr, 0, 0, w, h, 16);
        cr.fill();

        // === CENTRAL BATTERY GAUGE ===
        let gaugeX = w/2;
        let gaugeY = 170;
        let gaugeRadius = 60;
        
        this.drawBatteryGauge(cr, gaugeX, gaugeY, gaugeRadius, soc, batteryPower);

        // === SOLAR (top-left) ===
        let solarX = 55;
        let solarY = 45;
        this.drawSolarIcon(cr, solarX, solarY, solar);
        
        // === LOAD (top-right) ===
        let loadX = w - 55;
        let loadY = 45;
        this.drawHouseIcon(cr, loadX, loadY, consumption);

        // Power values - aligned on same horizontal line
        let valuesY = 95;
        
        // Solar power value
        cr.setSourceRGBA(1, 0.85, 0.3, 1);
        cr.setFontSize(14);
        cr.selectFontFace("Sans", Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        let solarText = solar.toFixed(0) + "W";
        let solarExtents = cr.textExtents(solarText);
        cr.moveTo(solarX - solarExtents.width/2, valuesY);
        cr.showText(solarText);
        
        // Load power value
        cr.setSourceRGBA(0.4, 0.7, 0.95, 1);
        cr.setFontSize(14);
        let loadText = consumption.toFixed(0) + "W";
        let loadExtents = cr.textExtents(loadText);
        cr.moveTo(loadX - loadExtents.width/2, valuesY);
        cr.showText(loadText);

        // Arrow from solar to battery (diagonal) - shortened
        if (solar > 10) {
            this.drawFlowArrow(cr, solarX + 25, solarY + 35, solarX + 55, solarY + 65, [1, 0.85, 0.3, 0.8]);
        }

        // Arrow from battery to load (diagonal, mirrored) - shortened
        if (consumption > 10) {
            this.drawFlowArrow(cr, loadX - 55, loadY + 65, loadX - 25, loadY + 35, [0.4, 0.7, 0.95, 0.8]);
        }

        // === BATTERY POWER (below gauge, closer to bottom) ===
        let battY = h - 65;
        this.drawBatteryPower(cr, w/2, battY, batteryPower);

        // === TIME ESTIMATE (bottom) ===
        this.drawTimeEstimate(cr, w/2, h - 18, soc, batteryPower);

        cr.$dispose();
    },

    drawSolarIcon: function(cr, x, y, solar) {
        // Sun glow
        if (solar > 100) {
            let gradient = new Cairo.RadialGradient(x, y, 0, x, y, 30);
            gradient.addColorStopRGBA(0, 1, 0.9, 0.3, 0.5);
            gradient.addColorStopRGBA(1, 1, 0.9, 0.3, 0);
            cr.setSource(gradient);
            cr.arc(x, y, 30, 0, 2 * Math.PI);
            cr.fill();
        }

        // Sun brightness based on production
        let brightness = Math.min(1, solar / 1000);
        let gray = 0.3 + brightness * 0.7;
        cr.setSourceRGBA(1, 0.85 * gray + 0.15, 0.2 * gray, 1);
        
        // Sun circle
        cr.arc(x, y, 12, 0, 2 * Math.PI);
        cr.fill();
        
        // Sun rays
        cr.setLineWidth(3);
        for (let i = 0; i < 8; i++) {
            let angle = (i * Math.PI) / 4;
            cr.moveTo(x + Math.cos(angle) * 16, y + Math.sin(angle) * 16);
            cr.lineTo(x + Math.cos(angle) * 22, y + Math.sin(angle) * 22);
        }
        cr.stroke();
    },

    drawHouseIcon: function(cr, x, y, consumption) {
        let intensity = Math.min(1, consumption / 1000);
        let baseColor = [0.3 + intensity * 0.1, 0.6 + intensity * 0.1, 0.9];
        
        // House body (filled)
        cr.setSourceRGBA(baseColor[0] * 0.3, baseColor[1] * 0.3, baseColor[2] * 0.3, 0.9);
        cr.rectangle(x - 14, y - 4, 28, 24);
        cr.fill();
        
        // House body outline
        cr.setSourceRGBA(baseColor[0], baseColor[1], baseColor[2], 1);
        cr.setLineWidth(2);
        cr.rectangle(x - 14, y - 4, 28, 24);
        cr.stroke();
        
        // Roof (filled)
        cr.setSourceRGBA(baseColor[0] * 0.4, baseColor[1] * 0.4, baseColor[2] * 0.4, 0.9);
        cr.moveTo(x - 18, y - 4);
        cr.lineTo(x, y - 20);
        cr.lineTo(x + 18, y - 4);
        cr.closePath();
        cr.fill();
        
        // Roof outline
        cr.setSourceRGBA(baseColor[0], baseColor[1], baseColor[2], 1);
        cr.setLineWidth(2);
        cr.moveTo(x - 18, y - 4);
        cr.lineTo(x, y - 20);
        cr.lineTo(x + 18, y - 4);
        cr.stroke();
        
        // Door
        cr.setSourceRGBA(baseColor[0] * 0.5, baseColor[1] * 0.5, baseColor[2] * 0.5, 1);
        cr.rectangle(x - 4, y + 8, 8, 12);
        cr.fill();
        
        // Window (glows based on consumption)
        cr.setSourceRGBA(1, 0.9, 0.5, 0.4 + intensity * 0.5);
        cr.rectangle(x + 6, y + 2, 6, 6);
        cr.fill();
        
        // Window frame
        cr.setSourceRGBA(baseColor[0], baseColor[1], baseColor[2], 0.8);
        cr.setLineWidth(1);
        cr.rectangle(x + 6, y + 2, 6, 6);
        cr.stroke();
    },

    drawBatteryGauge: function(cr, x, y, radius, soc, batteryPower) {
        // Outer glow ring
        let glowColor;
        if (soc > 50) {
            glowColor = [0.3, 0.85, 0.4]; // Green
        } else if (soc > 20) {
            glowColor = [0.95, 0.75, 0.2]; // Yellow/Orange
        } else {
            glowColor = [0.95, 0.3, 0.3]; // Red
        }

        // Glow effect
        let gradient = new Cairo.RadialGradient(x, y, radius - 10, x, y, radius + 20);
        gradient.addColorStopRGBA(0, glowColor[0], glowColor[1], glowColor[2], 0.35);
        gradient.addColorStopRGBA(1, glowColor[0], glowColor[1], glowColor[2], 0);
        cr.setSource(gradient);
        cr.arc(x, y, radius + 20, 0, 2 * Math.PI);
        cr.fill();

        // Background arc (dark)
        cr.setSourceRGBA(0.2, 0.2, 0.22, 1);
        cr.setLineWidth(14);
        cr.arc(x, y, radius, 0.7 * Math.PI, 2.3 * Math.PI);
        cr.stroke();

        // SOC arc (colored)
        let socAngle = 0.7 * Math.PI + (soc / 100) * 1.6 * Math.PI;
        cr.setSourceRGBA(glowColor[0], glowColor[1], glowColor[2], 1);
        cr.setLineWidth(12);
        cr.arc(x, y, radius, 0.7 * Math.PI, socAngle);
        cr.stroke();

        // Inner circle (dark)
        cr.setSourceRGBA(0.15, 0.15, 0.17, 1);
        cr.arc(x, y, radius - 20, 0, 2 * Math.PI);
        cr.fill();

        // SOC percentage text
        cr.setSourceRGBA(1, 1, 1, 1);
        cr.setFontSize(32);
        cr.selectFontFace("Sans", Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        let socText = soc.toFixed(0) + "%";
        let textExtents = cr.textExtents(socText);
        cr.moveTo(x - textExtents.width/2, y + 10);
        cr.showText(socText);

        // "BATTERY" label
        cr.setSourceRGBA(0.6, 0.6, 0.65, 1);
        cr.setFontSize(10);
        let label = "BATTERY";
        let labelExtents = cr.textExtents(label);
        cr.moveTo(x - labelExtents.width/2, y + 26);
        cr.showText(label);

        // Charging indicator (lightning bolt)
        if (batteryPower > 50) {
            cr.setSourceRGBA(0.3, 0.85, 0.4, 0.9);
            this.drawLightningBolt(cr, x, y - 26, 0.7);
        }
    },

    drawLightningBolt: function(cr, x, y, scale) {
        cr.save();
        cr.translate(x, y);
        cr.scale(scale, scale);
        cr.moveTo(2, -12);
        cr.lineTo(-5, 2);
        cr.lineTo(0, 2);
        cr.lineTo(-2, 12);
        cr.lineTo(5, -2);
        cr.lineTo(0, -2);
        cr.closePath();
        cr.fill();
        cr.restore();
    },

    drawBatteryPower: function(cr, x, y, power) {
        let isCharging = power > 0;
        let abspower = Math.abs(power);
        
        // Arrow direction
        if (abspower > 10) {
            if (isCharging) {
                cr.setSourceRGBA(0.3, 0.85, 0.4, 0.9);
                // Arrow pointing up (into battery)
                cr.moveTo(x, y - 18);
                cr.lineTo(x - 10, y - 6);
                cr.lineTo(x - 4, y - 6);
                cr.lineTo(x - 4, y + 6);
                cr.lineTo(x + 4, y + 6);
                cr.lineTo(x + 4, y - 6);
                cr.lineTo(x + 10, y - 6);
                cr.closePath();
                cr.fill();
            } else {
                cr.setSourceRGBA(0.95, 0.4, 0.35, 0.9);
                // Arrow pointing down (out of battery)
                cr.moveTo(x, y + 8);
                cr.lineTo(x - 10, y - 4);
                cr.lineTo(x - 4, y - 4);
                cr.lineTo(x - 4, y - 16);
                cr.lineTo(x + 4, y - 16);
                cr.lineTo(x + 4, y - 4);
                cr.lineTo(x + 10, y - 4);
                cr.closePath();
                cr.fill();
            }
        }

        // Power value text
        let color = isCharging ? [0.3, 0.85, 0.4] : [0.95, 0.4, 0.35];
        cr.setSourceRGBA(color[0], color[1], color[2], 1);
        cr.setFontSize(14);
        cr.selectFontFace("Sans", Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        let powerText = abspower.toFixed(0) + "W " + (isCharging ? "IN" : "OUT");
        let powerExtents = cr.textExtents(powerText);
        cr.moveTo(x - powerExtents.width/2, y + 28);
        cr.showText(powerText);
    },

    drawFlowArrow: function(cr, x1, y1, x2, y2, color) {
        cr.setSourceRGBA(color[0], color[1], color[2], color[3]);
        cr.setLineWidth(2);
        
        // Dotted/dashed line for flow
        cr.setDash([6, 4], 0);
        cr.moveTo(x1, y1);
        cr.lineTo(x2, y2);
        cr.stroke();
        cr.setDash([], 0);

        // Arrowhead
        let angle = Math.atan2(y2 - y1, x2 - x1);
        let arrowLen = 8;
        cr.moveTo(x2, y2);
        cr.lineTo(x2 - arrowLen * Math.cos(angle - 0.4), y2 - arrowLen * Math.sin(angle - 0.4));
        cr.lineTo(x2 - arrowLen * Math.cos(angle + 0.4), y2 - arrowLen * Math.sin(angle + 0.4));
        cr.closePath();
        cr.fill();
    },

    drawTimeEstimate: function(cr, x, y, soc, batteryPower) {
        if (typeof soc !== "number" || typeof batteryPower !== "number" || batteryPower === 0) {
            return;
        }

        let timeStr;
        let color;
        let batteryWh = this.batteryWh || 15000;
        
        if (batteryPower < 0) {
            let remainingWh = (soc / 100) * batteryWh;
            let hours = remainingWh / Math.abs(batteryPower);
            timeStr = "Empty in ~" + this.formatTime(hours);
            color = [0.7, 0.5, 0.7];
        } else {
            let remainingWh = ((100 - soc) / 100) * batteryWh;
            let hours = remainingWh / batteryPower;
            timeStr = "Full in ~" + this.formatTime(hours);
            color = [0.4, 0.75, 0.5];
        }

        cr.setSourceRGBA(color[0], color[1], color[2], 1);
        cr.setFontSize(13);
        cr.selectFontFace("Sans", Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
        let extents = cr.textExtents(timeStr);
        cr.moveTo(x - extents.width/2, y);
        cr.showText(timeStr);
    },

    formatTime: function(hours) {
        if (hours < 1) {
            return Math.floor(hours * 60) + " min";
        } else if (hours < 24) {
            let h = Math.floor(hours);
            let m = Math.floor((hours - h) * 60);
            return h + "h " + (m < 10 ? "0" : "") + m + "m";
        } else {
            return hours.toFixed(0) + " hours";
        }
    },

    roundedRect: function(cr, x, y, w, h, r) {
        cr.moveTo(x + r, y);
        cr.lineTo(x + w - r, y);
        cr.arc(x + w - r, y + r, r, -Math.PI/2, 0);
        cr.lineTo(x + w, y + h - r);
        cr.arc(x + w - r, y + h - r, r, 0, Math.PI/2);
        cr.lineTo(x + r, y + h);
        cr.arc(x + r, y + h - r, r, Math.PI/2, Math.PI);
        cr.lineTo(x, y + r);
        cr.arc(x + r, y + r, r, Math.PI, 3*Math.PI/2);
        cr.closePath();
    },

    startMqtt: function() {
        let cerboHost = this.cerboHost || "cerbo.local";
        let portalId = this.portalId || "";
        
        if (!portalId) {
            global.logWarning("Victron desklet: Portal ID not configured");
            return;
        }
        
        try {
            let [success, pid, stdinFd, stdoutFd, stderrFd] = GLib.spawn_async_with_pipes(
                null,
                ["mosquitto_sub", "-h", cerboHost, "-p", "1883", "-t", "N/" + portalId + "/#", "-v"],
                null,
                GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                null
            );

            if (success) {
                // Close unused file descriptors to prevent leaks
                if (stdinFd >= 0) {
                    GLib.close(stdinFd);
                }
                if (stderrFd >= 0) {
                    GLib.close(stderrFd);
                }

                this.mqttPid = pid;
                let stdout = new Gio.DataInputStream({
                    base_stream: new Gio.UnixInputStream({ fd: stdoutFd, close_fd: true })
                });
                this.readMqttLine(stdout);
            }
        } catch (e) {
            global.logError("Victron desklet: Failed to start MQTT: " + e);
        }
    },

    stopMqtt: function() {
        if (this.mqttPid) {
            try {
                GLib.spawn_command_line_sync("kill " + this.mqttPid);
            } catch (e) {}
            this.mqttPid = null;
        }
    },

    readMqttLine: function(stream) {
        let self = this;
        stream.read_line_async(GLib.PRIORITY_DEFAULT, null, function(source, result) {
            try {
                let [line, length] = source.read_line_finish_utf8(result);
                if (line !== null) {
                    self.parseMqttMessage(line);
                    self.readMqttLine(stream);
                }
            } catch (e) {
                // Stream closed
            }
        });
    },

    parseMqttMessage: function(line) {
        try {
            let spaceIdx = line.indexOf(" ");
            if (spaceIdx === -1) return;

            let topic = line.substring(0, spaceIdx);
            let payload = line.substring(spaceIdx + 1);
            let data = JSON.parse(payload);
            let value = data.value;

            if (topic.indexOf("Dc/Battery/Soc") !== -1 && topic.indexOf("system") !== -1) {
                this.data.soc = value;
            } else if (topic.indexOf("ConsumptionOnOutput/L1/Power") !== -1) {
                this.data.consumption = value;
            } else if (topic.indexOf("battery/512/Dc/0/Power") !== -1) {
                this.data.batteryPower = value;
            } else if (topic.indexOf("system/0/Dc/Pv/Power") !== -1) {
                this.data.solar = value;
            } else if (topic.indexOf("solarcharger/279/Yield/Power") !== -1) {
                this.data.solar = value;
            }
        } catch (e) {
            // Parse error
        }
    },

    startKeepalive: function() {
        this.sendKeepalive();
        let self = this;
        let interval = this.keepaliveInterval || 30;
        this.keepaliveLoop = Mainloop.timeout_add_seconds(interval, function() {
            self.sendKeepalive();
            return true;
        });
    },

    sendKeepalive: function() {
        let cerboHost = this.cerboHost || "cerbo.local";
        let portalId = this.portalId || "";
        
        if (!portalId) return;
        
        try {
            GLib.spawn_command_line_async(
                "mosquitto_pub -h " + cerboHost + " -p 1883 -t R/" + portalId + "/keepalive -m ''"
            );
        } catch (e) {}
    },

    startUpdateLoop: function() {
        let self = this;
        let interval = this.updateInterval || 2;
        this.updateLoop = Mainloop.timeout_add_seconds(interval, function() {
            self.canvas.queue_repaint();
            return true;
        });
    },

    on_desklet_removed: function() {
        if (this.updateLoop) Mainloop.source_remove(this.updateLoop);
        if (this.keepaliveLoop) Mainloop.source_remove(this.keepaliveLoop);
        this.stopMqtt();
    }
};

function main(metadata, deskletId) {
    return new VictronDesklet(metadata, deskletId);
}
