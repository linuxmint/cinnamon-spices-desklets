const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;

// Gettext für Übersetzungen einrichten
const UUID = "simple-battery@suckatcoding.com";
const DESKLET_DIR = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/" + UUID;
Gettext.bindtextdomain(UUID, DESKLET_DIR + "/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

function SimpleBatteryDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

SimpleBatteryDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-background", "show_background", this.on_setting_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "bg-opacity", "bg_opacity", this.on_setting_changed, null);

        this.setupUI();
        this.update();
    },

    setupUI: function() {
        this.container = new St.BoxLayout({vertical: true, style_class: "battery-desklet"});
        
        this.barContainer = new St.BoxLayout({vertical: false});
        this.track = new St.BoxLayout({style_class: "battery-track"});
        this.fill = new St.BoxLayout({style_class: "battery-fill"});
        this.track.add_actor(this.fill);
        this.pctLabel = new St.Label({style_class: "battery-pct-small"});
        this.barContainer.add_actor(this.track);
        this.barContainer.add_actor(this.pctLabel);
        
        this.timeLabel = new St.Label({style_class: "battery-time"});
        
        this.divider = new St.BoxLayout({style_class: "battery-divider"});
        this.uptimeLabel = new St.Label({style_class: "battery-stats"});
        this.usageLabel = new St.Label({style_class: "battery-stats"});
        
        this.container.add_actor(this.barContainer);
        this.container.add_actor(this.timeLabel);
        this.container.add_actor(this.divider);
        this.container.add_actor(this.uptimeLabel);
        this.container.add_actor(this.usageLabel);
        
        this.setContent(this.container);
        this.on_setting_changed();
    },

    on_setting_changed: function() {
        if (this.show_background) {
            let alpha = this.bg_opacity / 100;
            this.container.set_style("background-color: rgba(0, 0, 0, " + alpha + ");");
        } else {
            this.container.set_style("background-color: transparent;");
        }
    },

    update: function() {
        try {
            let cmdBat = 'bash -c "upower -i $(upower -e | grep -i bat | head -n 1)"';
            let [resBat, outBat] = GLib.spawn_command_line_sync(cmdBat);
            
            if (resBat) {
                let output = outBat.toString();
                let matchPct = output.match(/percentage:\s+(\d+)%/);
                let matchEmpty = output.match(/time to empty:\s+(.*)/);
                let matchFull = output.match(/time to full:\s+(.*)/);
                let matchState = output.match(/state:\s+(.*)/);
                
                let pctNum = matchPct ? parseInt(matchPct[1]) : 0;
                
                this.pctLabel.set_text(matchPct ? matchPct[1] + "%" : "--%");
                let fillWidth = Math.round(150 * (pctNum / 100));
                this.fill.set_style("width: " + fillWidth + "px;");
                
                let state = matchState ? matchState[1] : "";
                if (state === "discharging" && matchEmpty) {
                    this.timeLabel.set_text(matchEmpty[1] + " " + _("remaining"));
                } else if (state === "charging" && matchFull) {
                    this.timeLabel.set_text(matchFull[1] + " " + _("until full"));
                } else if (state === "fully-charged") {
                    this.timeLabel.set_text(_("Fully charged"));
                } else {
                    this.timeLabel.set_text(_("AC Power"));
                }

                let cmdUsage = `bash -c "if [ ! -f /tmp/desklet_start_bat.txt ]; then echo ${pctNum} > /tmp/desklet_start_bat.txt; fi; cat /tmp/desklet_start_bat.txt"`;
                let [resUsage, outUsage] = GLib.spawn_command_line_sync(cmdUsage);
                
                if (resUsage) {
                    let startPct = parseInt(outUsage.toString().trim());
                    let diff = startPct - pctNum;
                    
                    if (diff > 0) {
                        this.usageLabel.set_text(_("Usage:") + " " + diff + "% " + _("since start"));
                    } else if (diff < 0) {
                        this.usageLabel.set_text(_("Charged:") + " " + Math.abs(diff) + "% " + _("since start"));
                    } else {
                        this.usageLabel.set_text(_("Usage:") + " 0% " + _("since start"));
                    }
                }
            }

            let [resUptime, outUptime] = GLib.spawn_command_line_sync("cat /proc/uptime");
            if (resUptime) {
                let uptimeSeconds = parseFloat(outUptime.toString().split(" ")[0]);
                let hours = Math.floor(uptimeSeconds / 3600);
                let minutes = Math.floor((uptimeSeconds % 3600) / 60);
                
                if (hours > 0) {
                    this.uptimeLabel.set_text(_("Uptime:") + " " + hours + _("h") + " " + minutes + _("min"));
                } else {
                    this.uptimeLabel.set_text(_("Uptime:") + " " + minutes + _("min"));
                }
            }

        } catch (e) {
            this.timeLabel.set_text(_("Error reading data"));
        }

        this.timeout = Mainloop.timeout_add_seconds(60, () => {
            this.update();
            return false; 
        });
    },

    on_desklet_removed: function() {
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
        }
    }
};

function main(metadata, desklet_id) {
    return new SimpleBatteryDesklet(metadata, desklet_id);
}