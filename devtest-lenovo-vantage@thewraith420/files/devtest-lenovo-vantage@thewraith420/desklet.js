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
const Clutter = imports.gi.Clutter;

const UUID = "devtest-lenovo-vantage@thewraith420";

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

        this.metadata = metadata;
        this.desklet_id = desklet_id;

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
                                   "update-interval",
                                   "update_interval",
                                   this._onSettingChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "background-opacity",
                                   "background_opacity",
                                   this._onAppearanceChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "background-color",
                                   "background_color",
                                   this._onAppearanceChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "accent-color",
                                   "accent_color",
                                   this._onAppearanceChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "battery-bar-color",
                                   "battery_bar_color",
                                   this._onAppearanceChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "desklet-width",
                                   "desklet_width",
                                   this._onAppearanceChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "font-size",
                                   "font_size",
                                   this._onAppearanceChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "border-radius",
                                   "border_radius",
                                   this._onAppearanceChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "show-quick-toggles",
                                   "show_quick_toggles",
                                   this._onLayoutChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "button-size",
                                   "button_size",
                                   this._onAppearanceChanged,
                                   null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                                   "horizontal-layout",
                                   "horizontal_layout",
                                   this._onLayoutChanged,
                                   null);

        try {
            // Initialize default settings
            if (!this.update_interval) this.update_interval = 5;
            if (this.background_opacity === undefined) this.background_opacity = 1.0;
            if (!this.background_color) this.background_color = 'rgb(40, 70, 130)';
            if (!this.accent_color) this.accent_color = 'rgb(255, 255, 255)';
            if (!this.battery_bar_color) this.battery_bar_color = 'rgb(76, 175, 80)';
            if (!this.desklet_width) this.desklet_width = 280;
            if (!this.font_size) this.font_size = 48;
            if (!this.border_radius) this.border_radius = 16;
            if (!this.button_size) this.button_size = 50;
            if (this.show_quick_toggles === undefined) this.show_quick_toggles = true;
            if (this.horizontal_layout === undefined) this.horizontal_layout = false;

            this.currentPercentage = 0;

            this._buildUI();
            this._update();

        } catch (e) {
            global.logError("Lenovo Vantage Init Error: " + e);
        }
    },

    _buildUI: function() {
        // Clear existing content if rebuilding
        if (this.window) {
            this.window.destroy_all_children();
        }

        // Main container
        this.window = new St.BoxLayout({
            vertical: !this.horizontal_layout,
            reactive: true,
            track_hover: true,
            style: this._getWindowStyle()
        });

        if (this.horizontal_layout) {
            this._buildHorizontalLayout();
        } else {
            this._buildVerticalLayout();
        }

        this.setContent(this.window);
    },

    _buildVerticalLayout: function() {
        // Battery info section
        let batteryBox = new St.BoxLayout({
            vertical: true,
            style: 'padding: 20px;'
        });
        this.window.add(batteryBox, { expand: true, x_fill: true });

        // Battery charge bar with percentage inside
        this._createBatteryBar(batteryBox);

        // Status text below battery bar
        this.statusLabel = new St.Label({
            text: "Full in 3h 30m",
            style: this._getStatusStyle()
        });
        batteryBox.add(this.statusLabel, { x_align: St.Align.MIDDLE });

        // Quick action buttons
        if (this.show_quick_toggles) {
            this._createButtonGrid();
        }
    },

    _buildHorizontalLayout: function() {
        // Left side: Battery info
        let batteryBox = new St.BoxLayout({
            vertical: true,
            style: 'padding: 20px;'
        });
        this.window.add(batteryBox, { expand: true });

        // Battery charge bar with percentage inside
        this._createBatteryBar(batteryBox);

        // Status text below battery bar
        this.statusLabel = new St.Label({
            text: "Full in 3h 30m",
            style: this._getStatusStyle()
        });
        batteryBox.add(this.statusLabel, { x_align: St.Align.MIDDLE });

        // Right side: Quick action buttons
        if (this.show_quick_toggles) {
            this._createButtonGrid();
        }
    },

    _createBatteryBar: function(container) {
        let barWidth = this.horizontal_layout ? 200 : Math.min(240, this.desklet_width - 40);
        let barHeight = 80;

        // Container for the battery bar
        this.batteryBarBox = new St.BoxLayout({
            vertical: false,
            style: `width: ${barWidth}px; height: ${barHeight}px; margin-bottom: 15px;`
        });
        container.add(this.batteryBarBox, { x_align: St.Align.MIDDLE });

        // Background bar (empty battery)
        this.batteryBarBg = new St.Widget({
            style: `background-color: rgba(255, 255, 255, 0.15); border-radius: 12px; width: ${barWidth}px; height: ${barHeight}px;`
        });
        this.batteryBarBox.add(this.batteryBarBg);

        // Filled bar (actual charge level) - positioned absolutely over background
        this.batteryBarFill = new St.Widget({
            style: this._getBatteryBarFillStyle(barWidth, barHeight),
            x: 0,
            y: 0
        });
        this.batteryBarBg.add_child(this.batteryBarFill);

        // Percentage label on top of bar
        this.percentageLabel = new St.Label({
            text: "95%",
            style: this._getPercentageStyle()
        });
        this.batteryBarBg.add_child(this.percentageLabel);
    },

    _getBatteryBarFillStyle: function(width, height) {
        let barColor = this.battery_bar_color || 'rgb(76, 175, 80)';
        
        // Parse RGB and add opacity
        let rgbMatch = barColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
            return `background-color: rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, 0.6); border-radius: 12px; width: ${width}px; height: ${height}px;`;
        }
        return `background-color: rgba(76, 175, 80, 0.6); border-radius: 12px; width: ${width}px; height: ${height}px;`;
    },

    _updateBatteryBar: function(percentage) {
        if (!this.batteryBarFill) return;

        let barWidth = this.horizontal_layout ? 200 : Math.min(240, this.desklet_width - 40);
        let fillWidth = Math.round((percentage / 100) * barWidth);
        let barHeight = 80;

        // Update the fill width with custom color
        this.batteryBarFill.set_style(this._getBatteryBarFillStyle(fillWidth, barHeight));

        // Center the percentage label both horizontally and vertically
        let labelWidth = this.percentageLabel.width;
        let labelHeight = this.percentageLabel.height;
        let labelX = (barWidth - labelWidth) / 2;
        let labelY = (barHeight - labelHeight) / 2;
        this.percentageLabel.set_position(labelX, labelY);
    },

    _createButtonGrid: function() {
        let buttonGridContainer = new St.BoxLayout({
            vertical: false,
            style: 'padding: 0px 15px 15px 15px;'
        });
        this.window.add(buttonGridContainer, { x_align: St.Align.MIDDLE });

        let buttonGrid = new St.Widget({
            layout_manager: new Clutter.GridLayout({ orientation: Clutter.Orientation.VERTICAL })
        });
        buttonGridContainer.add(buttonGrid);

        let gridLayout = buttonGrid.layout_manager;
        this.actionButtons = [];

        // Create 4 circular buttons in a 2x2 grid
        this.createActionButton(gridLayout, 0, 0, "🔋", "Battery Saver");
        this.createActionButton(gridLayout, 1, 0, "⚡", "Rapid");
        this.createActionButton(gridLayout, 0, 1, "🔒", "Lock");
        this.createActionButton(gridLayout, 1, 1, "⚙", "Settings");
    },

    createActionButton: function(gridLayout, col, row, icon, label) {
        let buttonSize = this.button_size || 50;
        let spacing = 10;
        
        let buttonBox = new St.BoxLayout({
            vertical: true,
            style: `spacing: 6px; margin: ${spacing}px;`
        });

        // Circular button
        let button = new St.Button({
            reactive: true,
            track_hover: true,
            can_focus: true,
            style: this._getButtonBaseStyle()
        });

        let iconSize = Math.round(buttonSize * 0.36);
        let iconLabel = new St.Label({
            text: icon,
            style: `font-size: ${iconSize}pt;`
        });
        button.set_child(iconLabel);

        // Label under button
        let textLabel = new St.Label({
            text: label,
            style: this._getButtonLabelStyle()
        });

        buttonBox.add(button, { x_align: St.Align.MIDDLE });
        buttonBox.add(textLabel, { x_align: St.Align.MIDDLE });

        gridLayout.attach(buttonBox, col, row, 1, 1);

        // Store references and connect handlers
        if (label === "Battery Saver") {
            this.conservationButton = button;
            button.connect('clicked', Lang.bind(this, function() {
                let newState = !this.conservation_mode_enabled;
                this.conservation_mode_enabled = newState;
                this._applyConservationMode();
            }));
        } else if (label === "Rapid") {
            this.rapidButton = button;
            button.connect('clicked', Lang.bind(this, function() {
                let newState = !this.rapid_charge_enabled;
                this.rapid_charge_enabled = newState;
                this._applyRapidCharge();
            }));
        } else if (label === "Lock") {
            button.connect('clicked', Lang.bind(this, function() {
                try {
                    Util.spawnCommandLine("cinnamon-screensaver-command -l");
                } catch (e) {
                    global.logError('Failed to lock screen: ' + e);
                    try {
                        Util.spawnCommandLine("gnome-screensaver-command -l");
                    } catch (e2) {
                        Main.notify(_('Lenovo Vantage'), _('Failed to lock screen'));
                    }
                }
            }));
        } else if (label === "Settings") {
            button.connect('clicked', Lang.bind(this, function() {
                try {
                    Util.spawnCommandLine("cinnamon-settings desklets " + this.metadata.uuid + " " + this.desklet_id);
                } catch (e) {
                    global.logError('Failed to open settings: ' + e);
                }
            }));
        }

        // Hover effects
        button.connect('enter-event', Lang.bind(this, function() {
            button.set_style(this._getButtonHoverStyle());
        }));
        button.connect('leave-event', Lang.bind(this, function() {
            this._updateButtonStyle(button, label);
        }));

        if (!this.actionButtons) this.actionButtons = [];
        this.actionButtons.push({ button: button, label: label, icon: iconLabel });
    },

    _updateButtonStyle: function(button, label) {
        let isActive = false;
        
        if (label === "Battery Saver" && this.conservation_mode_enabled) {
            isActive = true;
        } else if (label === "Rapid" && this.rapid_charge_enabled) {
            isActive = true;
        }
        
        if (isActive) {
            button.set_style(this._getButtonActiveStyle());
        } else {
            button.set_style(this._getButtonBaseStyle());
        }
    },
    
    _onSettingChanged: function() {
        this._applyConservationMode();
        this._applyRapidCharge();
        this._update();
    },

    _onAppearanceChanged: function() {
        this._buildUI();
        this._update();
    },

    _onLayoutChanged: function() {
        this._buildUI();
        this._update();
    },

    _getWindowStyle: function() {
        let opacity = this.background_opacity || 1.0;
        let bgColor = this.background_color || 'rgb(40, 70, 130)';
        let width = this.horizontal_layout ? 'auto' : (this.desklet_width || 280);
        let radius = this.border_radius || 16;
        
        let widthStyle = this.horizontal_layout ? '' : `min-width: ${width}px; max-width: ${width}px;`;
        
        let rgbMatch = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
            return `background-color: rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${opacity}); border-radius: ${radius}px; padding: 0px; ${widthStyle}`;
        }
        return `background-color: ${bgColor}; border-radius: ${radius}px; padding: 0px; ${widthStyle}`;
    },

    _getPercentageStyle: function() {
        let color = this.accent_color || 'rgb(255, 255, 255)';
        let size = this.font_size || 48;
        return `color: ${color}; font-size: ${size}pt; font-weight: bold;`;
    },

    _getStatusStyle: function() {
        let color = this.accent_color || 'rgb(255, 255, 255)';
        return `color: ${color}; font-size: 11pt; margin-top: 8px; opacity: 0.8; text-align: center;`;
    },

    _getButtonBaseStyle: function() {
        let buttonSize = this.button_size || 50;
        let buttonRadius = Math.round(buttonSize / 2);
        return `background-color: rgba(255, 255, 255, 0.1); 
                border-radius: ${buttonRadius}px; 
                width: ${buttonSize}px; 
                height: ${buttonSize}px;
                padding: 0px;`;
    },

    _getButtonActiveStyle: function() {
        let buttonSize = this.button_size || 50;
        let buttonRadius = Math.round(buttonSize / 2);
        return `background-color: rgba(255, 255, 255, 0.25); 
                border-radius: ${buttonRadius}px; 
                border: 2px solid rgba(255, 255, 255, 0.4); 
                width: ${buttonSize}px; 
                height: ${buttonSize}px;
                padding: 0px;`;
    },

    _getButtonHoverStyle: function() {
        let buttonSize = this.button_size || 50;
        let buttonRadius = Math.round(buttonSize / 2);
        return `background-color: rgba(255, 255, 255, 0.2); 
                border-radius: ${buttonRadius}px; 
                width: ${buttonSize}px; 
                height: ${buttonSize}px;
                padding: 0px;`;
    },

    _getButtonLabelStyle: function() {
        let color = this.accent_color || 'rgb(255, 255, 255)';
        return `color: ${color}; font-size: 8pt; text-align: center; opacity: 0.8;`;
    },

    _applyConservationMode: function() {
        const CONSERVATION_FILE = "/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode";

        try {
            let targetState = this.conservation_mode_enabled ? '1' : '0';
            let currentState = this._readFromFile(CONSERVATION_FILE).trim();
            if (currentState !== targetState) {
                let display = GLib.getenv('DISPLAY') || ':0';
                let xauthority = GLib.getenv('XAUTHORITY') || GLib.get_home_dir() + '/.Xauthority';

                let argv = ['env', `DISPLAY=${display}`, `XAUTHORITY=${xauthority}`, 'pkexec', 'bash', '-c', `echo ${targetState} | tee ${CONSERVATION_FILE} > /dev/null`];
                this._runPkexecCommand(argv,
                    Lang.bind(this, function(stdout, stderr) {
                        Main.notify(_('Lenovo Vantage'), _('Conservation Mode changed successfully.'));
                        Mainloop.timeout_add_seconds(1, Lang.bind(this, this._update));
                    }),
                    Lang.bind(this, function(exitStatus, stdout, stderr) {
                        Main.notify(_('Lenovo Vantage'), _('Opening terminal for authentication...'));
                        let cmdStr = `echo ${targetState} | pkexec tee ${CONSERVATION_FILE}`;
                        try {
                            Util.spawn(['gnome-terminal', '--', 'bash', '-c', cmdStr]);
                        } catch (e) {
                            global.logError('Failed to spawn terminal: ' + e);
                        }
                    })
                );
            }
        } catch (e) {
            global.logError("Failed to apply conservation mode: " + e);
        }
    },

    _applyRapidCharge: function() {
        const RAPID_CHARGE_FILE = "/sys/bus/platform/drivers/legion/PNP0C09:00/rapidcharge";

        try {
            let targetState = this.rapid_charge_enabled ? '1' : '0';
            let currentState = this._readFromFile(RAPID_CHARGE_FILE).trim();
            if (currentState !== targetState) {
                let display = GLib.getenv('DISPLAY') || ':0';
                let xauthority = GLib.getenv('XAUTHORITY') || GLib.get_home_dir() + '/.Xauthority';

                let argv = ['env', `DISPLAY=${display}`, `XAUTHORITY=${xauthority}`, 'pkexec', 'bash', '-c', `echo ${targetState} | tee ${RAPID_CHARGE_FILE} > /dev/null`];
                this._runPkexecCommand(argv,
                    Lang.bind(this, function(stdout, stderr) {
                        Main.notify(_('Lenovo Vantage'), _('Rapid Charge changed successfully.'));
                        Mainloop.timeout_add_seconds(1, Lang.bind(this, this._update));
                    }),
                    Lang.bind(this, function(exitStatus, stdout, stderr) {
                        Main.notify(_('Lenovo Vantage'), _('Opening terminal for authentication...'));
                        let cmdStr = `echo ${targetState} | pkexec tee ${RAPID_CHARGE_FILE}`;
                        try {
                            Util.spawn(['gnome-terminal', '--', 'bash', '-c', cmdStr]);
                        } catch (e) {
                            global.logError('Failed to spawn terminal: ' + e);
                        }
                    })
                );
            }
        } catch (e) {
            global.logError("Failed to apply rapid charge: " + e);
        }
    },

    _update: function() {
        const ENERGY_NOW_FILE = "/sys/class/power_supply/BAT1/energy_now";
        const ENERGY_FULL_FILE = "/sys/class/power_supply/BAT1/energy_full";
        const POWER_NOW_FILE = "/sys/class/power_supply/BAT1/power_now";
        const STATUS_FILE = "/sys/class/power_supply/BAT1/status";
        const CONSERVATION_FILE = "/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode";
        const RAPID_CHARGE_FILE = "/sys/bus/platform/drivers/legion/PNP0C09:00/rapidcharge";

        let percentage = 0;
        let statusText = "";

        try {
            let energyNow = parseInt(this._readFromFile(ENERGY_NOW_FILE));
            let energyFull = parseInt(this._readFromFile(ENERGY_FULL_FILE));
            let powerNow = parseInt(this._readFromFile(POWER_NOW_FILE));
            let status = this._readFromFile(STATUS_FILE).trim();

            if (energyFull > 0) {
                percentage = Math.round((energyNow / energyFull) * 100);
            }

            this.currentPercentage = percentage;
            this.percentageLabel.set_text(percentage + "%");
            this._updateBatteryBar(percentage);

            if (status === "Charging") {
                if (powerNow > 0) {
                    let energyRemaining = energyFull - energyNow;
                    let timeHours = energyRemaining / powerNow;
                    let hours = Math.floor(timeHours);
                    let minutes = Math.round((timeHours - hours) * 60);
                    statusText = `Full in ${hours}h ${minutes}m`;
                } else {
                    statusText = "Charging...";
                }
            } else if (status === "Discharging") {
                if (powerNow > 0) {
                    let timeHours = energyNow / powerNow;
                    let hours = Math.floor(timeHours);
                    let minutes = Math.round((timeHours - hours) * 60);
                    statusText = `${hours}h ${minutes}m remaining`;
                } else {
                    statusText = "On battery";
                }
            } else if (status === "Full") {
                statusText = "Fully charged";
            } else {
                statusText = status;
            }

            this.statusLabel.set_text(statusText);

            // Update conservation mode button
            try {
                let conservationMode = this._readFromFile(CONSERVATION_FILE).trim() === '1';
                if (this.conservation_mode_enabled !== conservationMode) {
                    this.conservation_mode_enabled = conservationMode;
                }
                if (this.conservationButton) {
                    this._updateButtonStyle(this.conservationButton, "Battery Saver");
                }
            } catch(e) {
                // File doesn't exist or can't be read
            }

            // Update rapid charge button
            try {
                let rapidChargeMode = this._readFromFile(RAPID_CHARGE_FILE).trim() === '1';
                if (this.rapid_charge_enabled !== rapidChargeMode) {
                    this.rapid_charge_enabled = rapidChargeMode;
                }
                if (this.rapidButton) {
                    this._updateButtonStyle(this.rapidButton, "Rapid");
                }
            } catch (e) {
                // File doesn't exist or can't be read
            }

        } catch (e) {
            this.percentageLabel.set_text("--");
            this.statusLabel.set_text("Error loading battery info");
            global.logError("Lenovo Vantage Update Error: " + e);
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

    _runPkexecCommand: function(argv, onSuccess, onFailure) {
        try {
            let flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;
            let proc = new Gio.Subprocess({ argv: argv, flags: flags });
            proc.init(null);
            proc.communicate_utf8_async(null, null, Lang.bind(this, function(proc_obj, res) {
                try {
                    let [ok, stdout, stderr] = proc_obj.communicate_utf8_finish(res);
                    let exitStatus = proc_obj.get_exit_status();
                    if (exitStatus === 0) {
                        if (onSuccess) onSuccess(stdout, stderr);
                    } else {
                        if (onFailure) onFailure(exitStatus, stdout, stderr);
                    }
                } catch (e) {
                    global.logError("Pkexec communication error: " + e);
                    if (onFailure) onFailure(-1, '', e);
                }
            }));
        } catch (e) {
            global.logError("Pkexec spawn error: " + e);
            if (onFailure) onFailure(-1, '', e);
        }
    },

    on_desklet_removed: function() {
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
        }
    }
};
