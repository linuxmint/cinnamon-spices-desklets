const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Main = imports.ui.main;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Gio = imports.gi.Gio;
const ByteArray = imports.byteArray;
const Gettext = imports.gettext;
const Settings = imports.ui.settings;

const UUID = "lenovo-vantage@thewraith420";


// l10n/translation support
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "conservation-mode-enabled",
                                   "conservation_mode_enabled",
                                   this._onSettingChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "rapid-charge-enabled",
                                   "rapid_charge_enabled",
                                   this._onSettingChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "accent-color",
                                   "accent_color",
                                   this._onAppearanceChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "background-color",
                                   "background_color",
                                   this._onAppearanceChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "font-color",
                                   "font_color",
                                   this._onAppearanceChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "border-color",
                                   "border_color",
                                   this._onAppearanceChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "button-size",
                                   "button_size",
                                   this._onAppearanceChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "desklet-width",
                                   "desklet_width",
                                   this._onAppearanceChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "border-radius",
                                   "border_radius",
                                   this._onAppearanceChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "show-battery-percentage",
                                   "show_battery_percentage",
                                   this._onAppearanceChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "update-interval",
                                   "update_interval",
                                   this._onSettingChanged,
                                   null);

        try {
            // Initialize default settings if not set
            if (!this.accent_color) this.accent_color = 'rgb(66, 133, 244)';
            if (!this.background_color) this.background_color = 'rgba(0, 0, 0, 0.85)';
            if (!this.font_color) this.font_color = 'rgb(255, 255, 255)';
            if (!this.border_color) this.border_color = 'rgb(66, 133, 244)';
            if (!this.button_size) this.button_size = 11;
            if (!this.desklet_width) this.desklet_width = 200;
            if (!this.border_radius) this.border_radius = 10;
            if (this.show_battery_percentage === undefined) this.show_battery_percentage = true;
            if (!this.update_interval) this.update_interval = 5;

            this.window = new St.BoxLayout({
                vertical: true,
                reactive: true,
                track_hover: true,
                style: this._getWindowStyle()
            });

            // Battery status label
            this.mainLabel = new St.Label({ text: "Loading...", style_class: 'main-label' });
            this.window.add(this.mainLabel);

            this.profileBox = new St.BoxLayout({
                vertical: true,
                style: 'spacing: 6px; margin-top: 10px;'
            });
            this.window.add(this.profileBox);

            // Conservation mode button
            this.conservationSwitch = new St.Button({
                reactive: true,
                track_hover: true,
                can_focus: true,
                style: this._getButtonBaseStyle()
            });
            this.conservationSwitchLabel = new St.Label({
                text: _("Conservation Mode: OFF"),
                style: this._getLabelStyle()
            });
            this.conservationSwitch.set_child(this.conservationSwitchLabel);
            this.profileBox.add(this.conservationSwitch);

            // Rapid charge button
            this.rapidChargeSwitch = new St.Button({
                reactive: true,
                track_hover: true,
                can_focus: true,
                style: this._getButtonBaseStyle()
            });
            this.rapidChargeSwitchLabel = new St.Label({
                text: _("Rapid Charge: OFF"),
                style: this._getLabelStyle()
            });
            this.rapidChargeSwitch.set_child(this.rapidChargeSwitchLabel);
            this.profileBox.add(this.rapidChargeSwitch);

            this.setContent(this.window);

            // Conservation: click handler
            this.conservationSwitch.connect('clicked', Lang.bind(this, function() {
                let newState = !this.conservation_mode_enabled;
                this.conservation_mode_enabled = newState;
                if (this.settings && typeof this.settings.setValue === 'function') {
                    try {
                        this.settings.setValue("conservation-mode-enabled", newState);
                    } catch (e_set) {
                        global.logError('Lenovo Vantage Desklet: Failed to write conservation setting: ' + e_set);
                    }
                }
                this._applySettings();
            }));
            this.conservationSwitch.connect('enter-event', Lang.bind(this, function() {
                this.conservationSwitch.set_style(this._getButtonHoverStyle());
            }));
            this.conservationSwitch.connect('leave-event', Lang.bind(this, function() {
                if (this.conservation_mode_enabled)
                    this.conservationSwitch.set_style(this._getButtonOnStyle());
                else
                    this.conservationSwitch.set_style(this._getButtonBaseStyle());
            }));

            // Rapid charge: click handler
            this.rapidChargeSwitch.connect('clicked', Lang.bind(this, function() {
                let newState = !this.rapid_charge_enabled;
                this.rapid_charge_enabled = newState;
                if (this.settings && typeof this.settings.setValue === 'function') {
                    try {
                        this.settings.setValue("rapid-charge-enabled", newState);
                    } catch (e_set) {
                        global.logError('Lenovo Vantage Desklet: Failed to write rapid-charge setting: ' + e_set);
                    }
                }
                this._applySettings();
            }));
            this.rapidChargeSwitch.connect('enter-event', Lang.bind(this, function() {
                this.rapidChargeSwitch.set_style(this._getButtonHoverStyle());
            }));
            this.rapidChargeSwitch.connect('leave-event', Lang.bind(this, function() {
                if (this.rapid_charge_enabled)
                    this.rapidChargeSwitch.set_style(this._getButtonOnStyle());
                else
                    this.rapidChargeSwitch.set_style(this._getButtonBaseStyle());
            }));

            this._update();

        } catch (e) {
            global.logError(e);
        }
    },
    
    _onSettingChanged: function() {
        this._applySettings();
        this._update();
    },

    _onAppearanceChanged: function() {
        // Refresh UI with new appearance settings
        this._update();
    },

    _applySettings: function() {
        const CONSERVATION_FILE = "/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode";
        const RAPID_CHARGE_FILE = "/sys/bus/platform/drivers/legion/PNP0C09:00/rapidcharge";

        try {
            let targetState = this.conservation_mode_enabled ? '1' : '0';
            let currentState = this._readFromFile(CONSERVATION_FILE).trim();
            if (currentState !== targetState) {
                let display = GLib.getenv('DISPLAY') || ':0';
                let xauthority = GLib.getenv('XAUTHORITY') || GLib.get_home_dir() + '/.Xauthority';

                let argv = ['env', `DISPLAY=${display}`, `XAUTHORITY=${xauthority}`, 'pkexec', 'bash', '-c', `echo ${targetState} | tee ${CONSERVATION_FILE} > /dev/null`];
                this._setButtonBusy(this.conservationSwitch, true);
                this._runPkexecCommand(argv,
                    Lang.bind(this, function(stdout, stderr) {
                        Main.notify(_('Lenovo Vantage Desklet'), _('Conservation Mode changed successfully.'));
                        this._setButtonBusy(this.conservationSwitch, false);
                        Mainloop.timeout_add_seconds(1, Lang.bind(this, this._update));
                    }),
                    Lang.bind(this, function(exitStatus, stdout, stderr) {
                        Main.notify(_('Lenovo Vantage Desklet'), _('Opening terminal for authentication...'));
                        this._setButtonBusy(this.conservationSwitch, false);
                        let cmdStr = `echo ${targetState} | pkexec tee ${CONSERVATION_FILE}`;
                        try {
                            Util.spawn(['gnome-terminal', '--', 'bash', '-c', cmdStr]);
                        } catch (e) {
                            global.logError('Failed to spawn terminal: ' + e);
                            Main.notify(_('Lenovo Vantage Desklet'), _('Failed to open terminal. Please run manually:') + ` ${cmdStr}`);
                        }
                    })
                );
            }
        } catch (e) {
            global.logError("Failed to apply conservation mode setting: " + e);
        }

        try {
            let targetState = this.rapid_charge_enabled ? '1' : '0';
            let currentState = this._readFromFile(RAPID_CHARGE_FILE).trim();
            if (currentState !== targetState) {
                let display = GLib.getenv('DISPLAY') || ':0';
                let xauthority = GLib.getenv('XAUTHORITY') || GLib.get_home_dir() + '/.Xauthority';

                let argv = ['env', `DISPLAY=${display}`, `XAUTHORITY=${xauthority}`, 'pkexec', 'bash', '-c', `echo ${targetState} | tee ${RAPID_CHARGE_FILE} > /dev/null`];
                this._setButtonBusy(this.rapidChargeSwitch, true);
                this._runPkexecCommand(argv,
                    Lang.bind(this, function(stdout, stderr) {
                        Main.notify(_('Lenovo Vantage Desklet'), _('Rapid Charge setting changed successfully.'));
                        this._setButtonBusy(this.rapidChargeSwitch, false);
                        Mainloop.timeout_add_seconds(1, Lang.bind(this, this._update));
                    }),
                    Lang.bind(this, function(exitStatus, stdout, stderr) {
                        Main.notify(_('Lenovo Vantage Desklet'), _('Opening terminal for authentication...'));
                        this._setButtonBusy(this.rapidChargeSwitch, false);
                        let cmdStr = `echo ${targetState} | pkexec tee ${RAPID_CHARGE_FILE}`;
                        try {
                            Util.spawn(['gnome-terminal', '--', 'bash', '-c', cmdStr]);
                        } catch (e) {
                            global.logError('Failed to spawn terminal: ' + e);
                            Main.notify(_('Lenovo Vantage Desklet'), _('Failed to open terminal. Please run manually:') + ` ${cmdStr}`);
                        }
                    })
                );
            }
        } catch (e) {
            global.logError("Failed to apply rapid charge setting: " + e);
        }
    },

    _update: function() {
        const ENERGY_NOW_FILE = "/sys/class/power_supply/BAT1/energy_now";
        const ENERGY_FULL_FILE = "/sys/class/power_supply/BAT1/energy_full";
        const POWER_NOW_FILE = "/sys/class/power_supply/BAT1/power_now";
        const STATUS_FILE = "/sys/class/power_supply/BAT1/status";
        const CONSERVATION_FILE = "/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode";
        const RAPID_CHARGE_FILE = "/sys/bus/platform/drivers/legion/PNP0C09:00/rapidcharge";

        let displayText = "";
        let percentage = 0;
        let timeText = "";

        try {
            let energyNow = parseInt(this._readFromFile(ENERGY_NOW_FILE));
            let energyFull = parseInt(this._readFromFile(ENERGY_FULL_FILE));
            let powerNow = parseInt(this._readFromFile(POWER_NOW_FILE));
            let status = this._readFromFile(STATUS_FILE).trim();

            if (energyFull > 0) {
                percentage = Math.round((energyNow / energyFull) * 100);
            }

            if (status === "Discharging" && powerNow > 0) {
                let timeHours = energyNow / powerNow;
                let hours = Math.floor(timeHours);
                let minutes = Math.round((timeHours - hours) * 60);
                timeText = `(${hours}h ${minutes}m left)`;
            } else {
                timeText = `(${status})`;
            }
            
            displayText += `${percentage}% ${timeText}`;
            if (this.show_battery_percentage) {
                this.mainLabel.set_text(displayText);
            } else {
                this.mainLabel.set_text("");
            }

            // Update switches based on file content
            try {
                let conservationMode = this._readFromFile(CONSERVATION_FILE).trim() === '1';
                // Keep the bound setting property in sync with actual file state
                if (this.conservation_mode_enabled !== conservationMode) {
                    this.conservation_mode_enabled = conservationMode;
                }
                if (conservationMode) {
                    this.conservationSwitch.set_style(this._getButtonOnStyle());
                    this.conservationSwitchLabel.set_text(_("Conservation Mode: ON"));
                } else {
                    this.conservationSwitch.set_style(this._getButtonBaseStyle());
                    this.conservationSwitchLabel.set_text(_("Conservation Mode: OFF"));
                }
            } catch(e) {
                global.logError("Lenovo Vantage Desklet: Error reading conservation mode: " + e);
                // Set default style and label text in case of error
                this.conservationSwitch.set_style(this._getButtonBaseStyle());
                this.conservationSwitchLabel.set_text(_("Conservation Mode: Error"));
            }

            try {
                let rapidChargeMode = this._readFromFile(RAPID_CHARGE_FILE).trim() === '1';
                // Keep the bound setting property in sync with actual file state
                if (this.rapid_charge_enabled !== rapidChargeMode) {
                    this.rapid_charge_enabled = rapidChargeMode;
                }
                if (rapidChargeMode) {
                    this.rapidChargeSwitch.set_style(this._getButtonOnStyle());
                    this.rapidChargeSwitchLabel.set_text(_("Rapid Charge: ON"));
                } else {
                    this.rapidChargeSwitch.set_style(this._getButtonBaseStyle());
                    this.rapidChargeSwitchLabel.set_text(_("Rapid Charge: OFF"));
                }
            } catch (e) {
                global.logError("Lenovo Vantage Desklet: Error reading rapid charge: " + e);
                // Set default style and label text in case of error
                this.rapidChargeSwitch.set_style(this._getButtonBaseStyle());
                this.rapidChargeSwitchLabel.set_text(_("Rapid Charge: Error"));
            }

        } catch (e) {
            this.mainLabel.set_text("Error loading battery info.");
            global.logError(e);
        }
        
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
        }
        this.timeout = Mainloop.timeout_add_seconds(this.update_interval || 5, Lang.bind(this, this._update));
        return true;
    },

    _readFromFile: function(path) {
        let file = Gio.file_new_for_path(path);
        let [success, contents] = file.load_contents(null);
        if (success) {
            return ByteArray.toString(contents);
        } else {
            throw new Error("Could not read file: " + path);
        }
    },


    _setButtonBusy: function(button, busy) {
        try {
            if (!button) return;
            if (busy) {
                button.reactive = false;
                button.set_style(`opacity: 0.6;`);
            } else {
                button.reactive = true;
                // reset style will be handled by _update() which sets styles based on state
            }
        } catch (e) {
            global.logError('Lenovo Vantage Desklet: Error setting busy state: ' + e);
        }
    },

    _runPkexecCommand: function(argv, onSuccess, onFailure) {
        try {
            let flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;
            let proc = new Gio.Subprocess({ argv: argv, flags: flags });
            proc.communicate_utf8_async(null, Lang.bind(this, function(proc_obj, res) {
                try {
                    let [ok, stdout, stderr] = proc_obj.communicate_utf8_finish(res);
                    let exitStatus = proc_obj.get_exit_status();
                    if (exitStatus === 0) {
                        if (onSuccess) onSuccess(stdout, stderr);
                    } else {
                        if (onFailure) onFailure(exitStatus, stdout, stderr);
                    }
                } catch (e) {
                    if (onFailure) onFailure(-1, '', e);
                }
            }));
        } catch (e) {
            if (onFailure) onFailure(-1, '', e);
        }
    },

    // Style helper methods
    _getWindowStyle: function() {
        return `background-color: ${this.background_color}; border-radius: ${this.border_radius}px; padding: 12px; border: 2px solid ${this.border_color}; min-width: ${this.desklet_width}px;`;
    },

    _getLabelStyle: function() {
        return `color: ${this.font_color}; font-size: ${this.button_size}pt; font-weight: bold; text-align: center;`;
    },

    _getButtonBaseStyle: function() {
        return `background-color: rgba(60, 60, 60, 0.5); border-radius: 6px; padding: 10px; width: 100%;`;
    },

    _getButtonOnStyle: function() {
        return `background-color: rgba(66, 133, 244, 0.7); border: 1px solid ${this.accent_color}; border-radius: 6px; padding: 10px; width: 100%;`;
    },

    _getButtonHoverStyle: function() {
        return `background-color: rgba(66, 133, 244, 0.35); border-radius: 6px; padding: 10px; width: 100%;`;
    },

    on_desklet_removed: function() {
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
        }
    }
};
