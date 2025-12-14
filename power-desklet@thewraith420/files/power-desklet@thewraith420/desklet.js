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
const ModalDialog = imports.ui.modalDialog;

const UUID = "power-desklet@thewraith420";

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
        
        // Battery Settings
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "conservation-mode-enabled", "conservation_mode_enabled", this._onSettingChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "rapid-charge-enabled", "rapid_charge_enabled", this._onSettingChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "update-interval", "update_interval", this._onSettingChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "background-opacity", "background_opacity", this._onAppearanceChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "background-color", "background_color", this._onAppearanceChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "accent-color", "accent_color", this._onAppearanceChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "font-size", "font_size", this._onAppearanceChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "border-radius", "border_radius", this._onAppearanceChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "show-quick-toggles", "show_quick_toggles", this._onLayoutChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "button-size", "button_size", this._onAppearanceChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "battery-display-mode", "battery_display_mode", this._onLayoutChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "show-charge-status", "show_charge_status", this._onLayoutChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "show-time-remaining", "show_time_remaining", this._onLayoutChanged, null);

        // Nvidia Settings
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "show-nvidia-profiles", "show_nvidia_profiles", this._onLayoutChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "nvidia-button-size", "nvidia_button_size", this._onAppearanceChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "nvidia-accent-color", "nvidia_accent_color", this._onAppearanceChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "reboot-delay", "rebootDelay", null, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "skip-confirm-dialog", "skipConfirmDialog", null, null);

        try {
            // Initialize defaults
            if (!this.update_interval) this.update_interval = 5;
            if (this.background_opacity === undefined) this.background_opacity = 0.95;
            if (!this.background_color) this.background_color = 'rgb(30, 30, 35)';
            if (!this.accent_color) this.accent_color = 'rgb(255, 255, 255)';
            if (!this.nvidia_accent_color) this.nvidia_accent_color = 'rgb(118, 185, 0)';
            if (!this.font_size) this.font_size = 42;
            if (!this.border_radius) this.border_radius = 12;
            if (!this.button_size) this.button_size = 50;
            if (!this.battery_display_mode) this.battery_display_mode = 'horizontal';
            if (this.show_quick_toggles === undefined) this.show_quick_toggles = true;
            if (this.show_charge_status === undefined) this.show_charge_status = true;
            if (this.show_time_remaining === undefined) this.show_time_remaining = true;
            if (this.show_nvidia_profiles === undefined) this.show_nvidia_profiles = true;
            if (!this.nvidia_button_size) this.nvidia_button_size = 50;
            if (!this.rebootDelay) this.rebootDelay = 10;
            if (this.skipConfirmDialog === undefined) this.skipConfirmDialog = false;

            this._buildUI();
            this._update();
            this.updateNvidiaProfiles();

        } catch (e) {
            global.logError("Power Desklet Init Error: " + e);
        }
    },

    _buildUI: function() {
        if (this.window) {
            this.window.destroy_all_children();
        }

        this.window = new St.BoxLayout({
            vertical: true,
            reactive: true,
            track_hover: true,
            style: this._getWindowStyle()
        });

        // Battery section with compact padding
        let batterySection = new St.BoxLayout({
            vertical: this.battery_display_mode === 'vertical',
            style: 'padding: 10px; spacing: 12px;'
        });
        this.window.add_child(batterySection);

        let batteryBox = this._createBatteryBar();
        batterySection.add_child(batteryBox);

        if (this.show_quick_toggles) {
            let buttonGrid = this._createButtonGrid();
            batterySection.add_child(buttonGrid);
        }

        // Separator line if nvidia profiles shown
        if (this.show_nvidia_profiles) {
            let separator = new St.Widget({
                style: 'height: 1px; background-color: rgba(255, 255, 255, 0.1); margin: 0px 10px;'
            });
            this.window.add_child(separator);
            this._createNvidiaProfiles();
        }

        this.setContent(this.window);
    },

    _createBatteryBar: function() {
        let batteryContainer = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 8px; min-width: 200px;'
        });

        // Battery percentage display
        this.percentageLabel = new St.Label({
            style_class: 'battery-percentage-label',
            style: this._getPercentageStyle()
        });
        batteryContainer.add_child(this.percentageLabel);

        // Battery bar (show based on mode)
        if (this.battery_display_mode !== 'percentage-only') {
            let barContainer = new St.BoxLayout({
                vertical: true,
                style: 'spacing: 4px;'
            });
            batteryContainer.add_child(barContainer);

            // Create battery bar with accent color background
            let accentColor = this.accent_color || 'rgb(255, 255, 255)';
            let rgbMatch = accentColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            let barBgColor = rgbMatch ? `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, 0.1)` : 'rgba(255, 255, 255, 0.1)';
            let barFillColor = rgbMatch ? `rgb(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]})` : 'rgb(255, 255, 255)';
            
            this.batteryBar = new St.Bin({
                style: `background-color: ${barBgColor}; border-radius: 10px; height: 18px; min-width: 180px;`
            });
            
            this.batteryBarFill = new St.Bin({
                style: `background-color: ${barFillColor}; border-radius: 8px; height: 14px; margin: 2px;`
            });
            
            this.batteryBar.set_child(this.batteryBarFill);
            barContainer.add_child(this.batteryBar);

            // Status labels on same line
            if (this.show_charge_status || this.show_time_remaining) {
                let statusRow = new St.BoxLayout({
                    vertical: false,
                    style: 'spacing: 8px;'
                });
                barContainer.add_child(statusRow);

                if (this.show_charge_status) {
                    this.chargeLabel = new St.Label({
                        style: this._getStatusStyle(),
                        x_expand: true,
                        x_align: Clutter.ActorAlign.START
                    });
                    statusRow.add_child(this.chargeLabel);
                }

                if (this.show_time_remaining) {
                    this.timeLabel = new St.Label({
                        style: this._getStatusStyle(),
                        x_expand: true,
                        x_align: Clutter.ActorAlign.END
                    });
                    statusRow.add_child(this.timeLabel);
                }
            }
        }

        return batteryContainer;
    },

    _createButtonGrid: function() {
        let gridContainer = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 6px;'
        });

        let grid = new Clutter.Actor({
            layout_manager: new Clutter.GridLayout({
                orientation: Clutter.Orientation.VERTICAL,
                column_spacing: 6,
                row_spacing: 6
            })
        });
        let gridLayout = grid.get_layout_manager();
        gridContainer.add_child(grid);

        this.actionButtons = [];

        // 2x2 grid layout with improved icons
        let nvidiaColor = this.nvidia_accent_color || 'rgb(118, 185, 0)';
        let nvRgbMatch = nvidiaColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        let nvidiaActiveColor = nvRgbMatch ? `rgba(${nvRgbMatch[1]}, ${nvRgbMatch[2]}, ${nvRgbMatch[3]}, 0.25)` : "rgba(118, 185, 0, 0.25)";
        let nvidiaBorderColor = nvRgbMatch ? `rgba(${nvRgbMatch[1]}, ${nvRgbMatch[2]}, ${nvRgbMatch[3]}, 0.6)` : "rgba(118, 185, 0, 0.6)";
        
        this.conservationButton = this.createActionButton(
            gridLayout, 0, 0, 
            "battery-level-80-symbolic", 
            "Battery Saver",
            nvidiaActiveColor,
            nvidiaBorderColor
        );
        this.conservationButton.connect('clicked', Lang.bind(this, function() {
            this.conservation_mode_enabled = !this.conservation_mode_enabled;
            Main.notify(_('Power Desklet'), _('Requesting authentication to change battery mode...'));
            this._applyConservationMode();
        }));

        this.rapidButton = this.createActionButton(
            gridLayout, 1, 0, 
            "battery-full-charging-symbolic", 
            "Rapid",
            nvidiaActiveColor,
            nvidiaBorderColor
        );
        this.rapidButton.connect('clicked', Lang.bind(this, function() {
            this.rapid_charge_enabled = !this.rapid_charge_enabled;
            Main.notify(_('Power Desklet'), _('Requesting authentication to change charge mode...'));
            this._applyRapidCharge();
        }));

        let lockButton = this.createActionButton(
            gridLayout, 0, 1, 
            "changes-prevent-symbolic", 
            "Lock",
            "rgba(156, 39, 176, 0.25)",
            "rgba(156, 39, 176, 0.6)"
        );
        lockButton.connect('clicked', Lang.bind(this, function() {
            try {
                Util.spawnCommandLine("cinnamon-screensaver-command -l");
            } catch (e) {
                Main.notify(_('Power Desklet'), _('Failed to lock screen'));
            }
        }));

        let settingsButton = this.createActionButton(
            gridLayout, 1, 1, 
            "emblem-system-symbolic", 
            "Settings",
            "rgba(96, 125, 139, 0.25)",
            "rgba(96, 125, 139, 0.6)"
        );
        settingsButton.connect('clicked', Lang.bind(this, function() {
            try {
                Util.spawnCommandLine("cinnamon-settings desklets " + this.metadata.uuid + " " + this.desklet_id);
            } catch (e) {
                global.logError('Failed to open settings: ' + e);
            }
        }));

        return gridContainer;
    },

    createActionButton: function(gridLayout, col, row, icon, label, activeColor, activeBorder) {
        let buttonSize = this.button_size || 50;
        
        let button = new St.Button({
            reactive: true,
            track_hover: true,
            can_focus: true,
            style: this._getButtonBaseStyle(),
            width: buttonSize,
            height: buttonSize
        });

        // Store colors for this button
        button._activeColor = activeColor;
        button._activeBorder = activeBorder;

        let iconSize = Math.round(buttonSize * 0.55);
        let iconWidget = new St.Icon({
            icon_name: icon,
            icon_size: iconSize,
            style: 'color: ' + (this.accent_color || 'rgb(255, 255, 255)') + ';'
        });

        button.set_child(iconWidget);
        gridLayout.attach(button, col, row, 1, 1);
        
        button.connect('enter-event', Lang.bind(this, function() {
            button.set_style(this._getButtonHoverStyle());
        }));
        button.connect('leave-event', Lang.bind(this, function() {
            this._updateButtonStyle(button, label);
        }));

        this.actionButtons.push({ button: button, label: label });
        return button;
    },

    _createNvidiaProfiles: function() {
        let nvidiaContainer = new St.BoxLayout({
            vertical: false,
            style: 'padding: 8px 10px; spacing: 4px;',
            x_expand: true
        });
        this.window.add_child(nvidiaContainer);

        this.nvidiaProfileBox = nvidiaContainer;
        this.updateNvidiaProfiles();
    },

    getCurrentProfile: function() {
        try {
            let [res, out] = GLib.spawn_command_line_sync('prime-select query');
            if (res) return out.toString().trim();
        } catch (e) {}
        return 'unknown';
    },

    updateNvidiaProfiles: function() {
        if (!this.nvidiaProfileBox) return;
        this.nvidiaProfileBox.destroy_all_children();
        
        let currentProfile = this.getCurrentProfile();
        
        let profiles = [
            { name: 'Intel', command: 'intel', icon: 'intel-mode.svg' },
            { name: 'Hybrid', command: 'on-demand', icon: 'hybrid-mode.svg' },
            { name: 'Nvidia', command: 'nvidia', icon: 'nvidia-settings' }
        ];
        
        profiles.forEach(p => this.addNvidiaProfileButton(p, p.command === currentProfile));
    },

    addNvidiaProfileButton: function(profile, isCurrent) {
        let buttonSize = this.nvidia_button_size || 50;
        
        let button = new St.Button({
            reactive: !isCurrent,
            track_hover: true,
            can_focus: true,
            style: isCurrent ? this._getNvidiaButtonActiveStyle() : this._getNvidiaButtonBaseStyle(),
            x_expand: true
        });
        
        let buttonBox = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 3px;',
            x_align: Clutter.ActorAlign.CENTER
        });
        button.set_child(buttonBox);

        let icon;
        if (profile.icon.endsWith('.svg')) {
            let file = Gio.file_new_for_path(this.metadata.path + "/icons/" + profile.icon);
            let gicon = new Gio.FileIcon({ file: file });
            icon = new St.Icon({
                gicon: gicon,
                icon_size: Math.round(buttonSize * 0.65)
            });
        } else {
            icon = new St.Icon({
                icon_name: profile.icon,
                icon_size: Math.round(buttonSize * 0.65)
            });
        }
        buttonBox.add_child(icon);

        let textLabel = new St.Label({
            text: profile.name,
            style: this._getButtonLabelStyle()
        });
        buttonBox.add_child(textLabel);

        this.nvidiaProfileBox.add_child(button, { expand: true });

        if (!isCurrent) {
            button.connect('clicked', Lang.bind(this, function() {
                if (this.skipConfirmDialog) {
                    this.switchProfile(profile, false);
                } else {
                    this.showConfirmDialog(profile);
                }
            }));

            button.connect('enter-event', Lang.bind(this, function() {
                button.set_style(this._getNvidiaButtonHoverStyle());
            }));
            button.connect('leave-event', Lang.bind(this, function() {
                button.set_style(this._getNvidiaButtonBaseStyle());
            }));
        }
    },

    showConfirmDialog: function(profile) {
        let dialog = new ModalDialog.ModalDialog();
        dialog.contentLayout.add(new St.Label({
            text: `Switch to ${profile.name} mode?\n\nReboot required to apply changes.`,
            style: 'font-size: 12pt; padding: 20px; color: #fff;'
        }));
        
        dialog.setButtons([
            { label: 'Cancel', action: Lang.bind(this, function() { dialog.close(); }), key: Clutter.Escape },
            { label: 'Reboot Later', action: Lang.bind(this, function() { dialog.close(); this.switchProfile(profile, false); }) },
            { label: 'Reboot Now', action: Lang.bind(this, function() { dialog.close(); this.switchProfile(profile, true); }) }
        ]);
        
        dialog.open();
    },

    switchProfile: function(profile, rebootNow) {
        try {
            let proc = new Gio.Subprocess({
                argv: ['pkexec', 'prime-select', profile.command],
                flags: Gio.SubprocessFlags.NONE
            });
            proc.init(null);
            proc.wait_async(null, (proc, res) => {
                try {
                    proc.wait_finish(res);
                } catch (waitError) {
                    global.logError(`prime-select command failed: ${waitError.message}`);
                    Main.notifyError(_('NVIDIA Profile Switch Failed'), _(`Could not switch to ${profile.name} mode. Please check logs for details.`));
                }
            });
        } catch (e) {
            global.logError(`Failed to spawn pkexec prime-select: ${e.message}`);
            Main.notifyError(_('NVIDIA Profile Switch Failed'), _(`Failed to request privileges for ${profile.name} mode.`));
        }
        
        if (rebootNow) {
            Mainloop.timeout_add_seconds(this.rebootDelay || 10, function() {
                try {
                    let rebootProc = new Gio.Subprocess({
                        argv: ['pkexec', 'systemctl', 'reboot'],
                        flags: Gio.SubprocessFlags.NONE
                    });
                    rebootProc.init(null);
                    rebootProc.wait_async(null, (proc, res) => {
                        try {
                            proc.wait_finish(res);
                        } catch (waitError) {
                            global.logError(`Reboot command failed: ${waitError.message}`);
                            Main.notifyError(_('Reboot Failed'), _('Could not initiate system reboot.'));
                        }
                    });
                } catch (e) {
                    global.logError(`Failed to spawn pkexec systemctl reboot: ${e.message}`);
                    Main.notifyError(_('Reboot Failed'), _('Failed to request privileges for system reboot.'));
                }
                return false;
            });
        }
        
        Mainloop.timeout_add_seconds(2, Lang.bind(this, this.updateNvidiaProfiles));
    },

    _applyConservationMode: function() {
        let value = this.conservation_mode_enabled ? "1" : "0";
        this._writeSysFile("/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode", value);
    },

    _applyRapidCharge: function() {
        let value = this.rapid_charge_enabled ? "1" : "0";
        this._writeSysFile("/sys/bus/platform/drivers/legion/PNP0C09:00/rapidcharge", value);
    },

    _writeSysFile: function(filePath, value) {
        try {
            let proc = new Gio.Subprocess({
                argv: ['pkexec', 'tee', filePath],
                flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            });
            proc.init(null);
            
            let stdin = proc.get_stdin_pipe();
            stdin.write_all(value + '\n', null);
            stdin.close(null);
            
            proc.wait_async(null, Lang.bind(this, function(proc, res) {
                try {
                    proc.wait_finish(res);
                    Main.notify(_('Power Desklet'), _('Power mode changed successfully!'));
                    this._update();
                } catch (e) {
                    if (e.message && e.message.includes('Cancelled')) {
                        Main.notify(_('Power Desklet'), _('Authentication cancelled'));
                    } else {
                        global.logError("Failed to write to sysfs file: " + filePath + " - " + e.message);
                        Main.notifyError(_('Power Desklet'), _('Failed to change power mode'));
                    }
                    // Revert the toggle on failure
                    if (filePath.includes('conservation_mode')) {
                        this.conservation_mode_enabled = !this.conservation_mode_enabled;
                    } else if (filePath.includes('rapidcharge')) {
                        this.rapid_charge_enabled = !this.rapid_charge_enabled;
                    }
                    this._update();
                }
            }));
        } catch (e) {
            global.logError("Failed to spawn pkexec for writing sysfs: " + e.message);
            Main.notifyError(_('Power Desklet'), _('Failed to request administrator privileges'));
            // Revert the toggle on failure
            if (filePath.includes('conservation_mode')) {
                this.conservation_mode_enabled = !this.conservation_mode_enabled;
            } else if (filePath.includes('rapidcharge')) {
                this.rapid_charge_enabled = !this.rapid_charge_enabled;
            }
            this._update();
        }
    },

    _applySettings: function() {
        let commands = [];
        if (this.conservation_mode_enabled !== undefined) {
            commands.push("/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode");
            commands.push(this.conservation_mode_enabled ? "1" : "0");
        }
        if (this.rapid_charge_enabled !== undefined) {
            commands.push("/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/rapid_charge");
            commands.push(this.rapid_charge_enabled ? "1" : "0");
        }

        if (commands.length > 0) {
            let argv = [GLib.get_home_dir() + "/.local/share/cinnamon/desklets/power-desklet@thewraith420/power-desklet-helper.py", "write-sys-files"];
            for (let i = 0; i < commands.length; i++) {
                argv.push(commands[i]);
            }
            try {
                Util.spawnCommandLineAsync(argv);
            } catch (e) {
                global.logError("Failed to apply power settings: " + e);
            }
        }
        this._update();
    },

    _updateButtonStyle: function(button, label) {
        let isActive = (label === "Battery Saver" && this.conservation_mode_enabled) || 
                       (label === "Rapid" && this.rapid_charge_enabled);
        
        if (isActive && button._activeColor) {
            button.set_style(this._getButtonCustomActiveStyle(button._activeColor, button._activeBorder));
        } else {
            button.set_style(this._getButtonBaseStyle());
        }
    },
    
    _onSettingChanged: function() {
        this._applySettings();
        this._update();
    },

    _onAppearanceChanged: function() {
        this._buildUI();
        this._update();
        this.updateNvidiaProfiles();
    },

    _onLayoutChanged: function() {
        this._buildUI();
        this._update();
        this.updateNvidiaProfiles();
    },

    _getWindowStyle: function() {
        let opacity = this.background_opacity || 0.95;
        let bgColor = this.background_color || 'rgb(30, 30, 35)';
        let radius = this.border_radius || 12;
        
        let rgbMatch = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
            return `background-color: rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${opacity}); 
                    border-radius: ${radius}px; 
                    padding: 0px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);`;
        }
        return `background-color: ${bgColor}; 
                border-radius: ${radius}px; 
                padding: 0px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);`;
    },

    _getPercentageStyle: function() {
        let color = this.accent_color || 'rgb(255, 255, 255)';
        let size = this.font_size || 42;
        return `color: ${color}; 
                font-size: ${size}pt; 
                font-weight: bold; 
                text-align: center;`;
    },

    _getStatusStyle: function() {
        let color = this.accent_color || 'rgb(255, 255, 255)';
        return `color: ${color}; 
                font-size: 9pt; 
                opacity: 0.7; 
                text-align: left;`;
    },

    _getButtonBaseStyle: function() {
        let buttonSize = this.button_size || 50;
        let buttonRadius = Math.round(buttonSize / 2);
        return `background-color: rgba(255, 255, 255, 0.08); 
                border-radius: ${buttonRadius}px; 
                border: 1px solid rgba(255, 255, 255, 0.12);
                padding: 0px;
                transition-duration: 150ms;`;
    },

    _getButtonCustomActiveStyle: function(bgColor, borderColor) {
        let buttonSize = this.button_size || 50;
        let buttonRadius = Math.round(buttonSize / 2);
        return `background-color: ${bgColor}; 
                border: 2px solid ${borderColor}; 
                border-radius: ${buttonRadius}px;
                padding: 0px;`;
    },

    _getButtonActiveStyle: function() {
        let buttonSize = this.button_size || 50;
        let buttonRadius = Math.round(buttonSize / 2);
        return `background-color: rgba(76, 175, 80, 0.25); 
                border: 2px solid rgba(76, 175, 80, 0.6); 
                border-radius: ${buttonRadius}px;
                padding: 0px;`;
    },

    _getButtonHoverStyle: function() {
        let buttonSize = this.button_size || 50;
        let buttonRadius = Math.round(buttonSize / 2);
        return `background-color: rgba(255, 255, 255, 0.15);
                border: 1px solid rgba(255, 255, 255, 0.25);
                border-radius: ${buttonRadius}px;
                padding: 0px;`;
    },

    _getNvidiaButtonBaseStyle: function() {
        let nvidiaColor = this.nvidia_accent_color || 'rgb(118, 185, 0)';
        let rgbMatch = nvidiaColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
            return `background-color: rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, 0.15); 
                    border: 1px solid rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, 0.3);
                    border-radius: 8px;
                    padding: 4px;
                    transition-duration: 150ms;`;
        }
        return `background-color: rgba(118, 185, 0, 0.15); 
                border: 1px solid rgba(118, 185, 0, 0.3);
                border-radius: 8px;
                padding: 4px;
                transition-duration: 150ms;`;
    },

    _getNvidiaButtonActiveStyle: function() {
        let nvidiaColor = this.nvidia_accent_color || 'rgb(118, 185, 0)';
        let rgbMatch = nvidiaColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
            return `background-color: rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, 0.35); 
                    border: 2px solid rgb(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]});
                    border-radius: 8px;
                    padding: 4px;`;
        }
        return `background-color: rgba(118, 185, 0, 0.35); 
                border: 2px solid rgb(118, 185, 0);
                border-radius: 8px;
                padding: 4px;`;
    },

    _getNvidiaButtonHoverStyle: function() {
        let nvidiaColor = this.nvidia_accent_color || 'rgb(118, 185, 0)';
        let rgbMatch = nvidiaColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
            return `background-color: rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, 0.25);
                    border: 1px solid rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, 0.5);
                    border-radius: 8px;
                    padding: 4px;`;
        }
        return `background-color: rgba(118, 185, 0, 0.25);
                border: 1px solid rgba(118, 185, 0, 0.5);
                border-radius: 8px;
                padding: 4px;`;
    },

    _getButtonLabelStyle: function() {
        let color = this.accent_color || 'rgb(255, 255, 255)';
        return `color: ${color}; 
                font-size: 8.5pt; 
                font-weight: 500;
                text-align: center; 
                opacity: 0.85;`;
    },

    _updateBatteryBar: function(percentage) {
        if (!this.batteryBarFill) return;
        
        let width = Math.round((percentage / 100) * 176);
        this.batteryBarFill.set_width(width);
        
        // Use accent color for the bar
        let accentColor = this.accent_color || 'rgb(255, 255, 255)';
        let rgbMatch = accentColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        let barColor = rgbMatch ? `rgb(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]})` : 'rgb(255, 255, 255)';
        
        this.batteryBarFill.set_style(`background-color: ${barColor}; border-radius: 8px; height: 14px; margin: 2px;`);
    },

    _update: function() {
        const ENERGY_NOW = "/sys/class/power_supply/BAT1/energy_now";
        const ENERGY_FULL = "/sys/class/power_supply/BAT1/energy_full";
        const POWER_NOW = "/sys/class/power_supply/BAT1/power_now";
        const STATUS = "/sys/class/power_supply/BAT1/status";
        const CONSERVATION_FILE = "/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode";
        const RAPID_CHARGE_FILE = "/sys/bus/platform/drivers/legion/PNP0C09:00/rapidcharge";

        try {
            let energyNow = parseInt(this._readFromFile(ENERGY_NOW));
            let energyFull = parseInt(this._readFromFile(ENERGY_FULL));
            let status = this._readFromFile(STATUS).trim();
            let percentage = energyFull > 0 ? Math.round((energyNow / energyFull) * 100) : 0;
            
            this.percentageLabel.set_text(percentage + "%");
            this._updateBatteryBar(percentage);

            // Update charge status if enabled
            if (this.show_charge_status && this.chargeLabel) {
                let statusIcon = "";
                if (status === "Charging") {
                    statusIcon = "⚡ ";
                } else if (status === "Full") {
                    statusIcon = "✓ ";
                }
                this.chargeLabel.set_text(statusIcon + status);
            }

            // Calculate time remaining if enabled
            if (this.show_time_remaining && this.timeLabel) {
                if (status === "Charging" || status === "Discharging") {
                    let powerNow = parseInt(this._readFromFile(POWER_NOW));
                    if (powerNow > 0) {
                        let timeHours = (status === "Charging" ? (energyFull - energyNow) : energyNow) / powerNow;
                        let hours = Math.floor(timeHours);
                        let minutes = Math.round((timeHours - hours) * 60);
                        
                        if (status === "Charging") {
                            this.timeLabel.set_text(`Full in ${hours}h ${minutes}m`);
                        } else {
                            this.timeLabel.set_text(`${hours}h ${minutes}m remaining`);
                        }
                    } else {
                        this.timeLabel.set_text("");
                    }
                } else {
                    this.timeLabel.set_text("");
                }
            }

            // Update button states
            try {
                this.conservation_mode_enabled = this._readFromFile(CONSERVATION_FILE).trim() === '1';
                if (this.conservationButton) this._updateButtonStyle(this.conservationButton, "Battery Saver");
            } catch(e) {}
            
            try {
                this.rapid_charge_enabled = this._readFromFile(RAPID_CHARGE_FILE).trim() === '1';
                if (this.rapidButton) this._updateButtonStyle(this.rapidButton, "Rapid");
            } catch (e) {}
        } catch (e) {
            this.percentageLabel.set_text("--");
            if (this.chargeLabel) this.chargeLabel.set_text("Error");
            if (this.timeLabel) this.timeLabel.set_text("Battery info unavailable");
            global.logError("Power Desklet Update Error: " + e);
        }
        
        if (this.timeout) Mainloop.source_remove(this.timeout);
        this.timeout = Mainloop.timeout_add_seconds(this.update_interval || 5, Lang.bind(this, this._update));
        return true;
    },

    _readFromFile: function(path) {
        let [success, contents] = Gio.file_new_for_path(path).load_contents(null);
        if (success) return ByteArray.toString(contents);
        throw new Error("Could not read file: " + path);
    },

    on_desklet_removed: function() {
        if (this.timeout) Mainloop.source_remove(this.timeout);
    }
};
