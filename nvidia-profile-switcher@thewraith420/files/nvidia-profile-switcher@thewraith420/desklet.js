const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Util = imports.misc.util;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const ModalDialog = imports.ui.modalDialog;
const Clutter = imports.gi.Clutter;
const Settings = imports.ui.settings;

function NvidiaProfileSwitcherDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

NvidiaProfileSwitcherDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        
        this.metadata = metadata;
        this.settingsFile = GLib.get_home_dir() + '/.config/nvidia-profile-switcher-settings.json';
        this.settings = this.loadSettings();
        
        // Bind desklet settings
        this.deskletSettings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
        this.deskletSettings.bind("layout", "layout", this.on_settings_changed.bind(this));
        this.deskletSettings.bind("rebootDelay", "rebootDelay", null);
        this.deskletSettings.bind("showDescriptions", "showDescriptions", this.on_settings_changed.bind(this));
        this.deskletSettings.bind("showProfileNames", "showProfileNames", this.on_settings_changed.bind(this));
        this.deskletSettings.bind("accentColor", "accentColor", this.on_settings_changed.bind(this));
        this.deskletSettings.bind("fontSize", "fontSize", this.on_settings_changed.bind(this));
        this.deskletSettings.bind("modeIndicatorIconSize", "modeIndicatorIconSize", this.on_settings_changed.bind(this));
        this.deskletSettings.bind("modeIndicatorTextSize", "modeIndicatorTextSize", this.on_settings_changed.bind(this));
        this.deskletSettings.bind("showModeIndicator", "showModeIndicator", this.on_settings_changed.bind(this));
        this.deskletSettings.bind("skipConfirmDialog", "skipConfirmDialog", null);
        this.deskletSettings.bind("intelIcon", "intelIcon", this.on_settings_changed.bind(this));
        this.deskletSettings.bind("onDemandIcon", "onDemandIcon", this.on_settings_changed.bind(this));
        this.deskletSettings.bind("nvidiaIcon", "nvidiaIcon", this.on_settings_changed.bind(this));
        this.deskletSettings.bind("useSystemIcons", "useSystemIcons", this.on_settings_changed.bind(this));
        this.deskletSettings.bind("iconSize", "iconSize", this.on_settings_changed.bind(this));
        this.deskletSettings.bind("rebootMethod", "rebootMethod", null);
        
        this.setupUI();
        this.updateProfiles();
        
        // No auto-refresh - only updates on boot and when user switches profiles
    },

    on_settings_changed: function() {
        // Rebuild UI when settings change
        this.window.destroy();
        this.setupUI();
        this.updateProfiles();
    },
    
    resetShowWarning: function() {
        this.settings.showLogoutWarning = true;
        this.saveSettings();
        Util.spawn(['notify-send', 
            'NVIDIA Profile Switcher', 
            'Confirmation dialog will now appear again.',
            '-i', 'nvidia-settings']);
    },
    
    getAccentColor: function() {
        // Parse RGB color from settings
        let match = this.accentColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (match) {
            return this.accentColor;
        }
        return 'rgb(118, 185, 0)'; // Fallback to NVIDIA green
    },
    
    getAccentColorRGBA: function(alpha) {
        let rgb = this.getAccentColor();
        return rgb.replace('rgb', 'rgba').replace(')', ', ' + alpha + ')');
    },
    
    getFontSizes: function() {
        let sizes = {
            small: { title: '11pt', mode: '8pt', buttonName: '9pt', buttonDesc: '7pt' },
            medium: { title: '14pt', mode: '11pt', buttonName: '11pt', buttonDesc: '9pt' },
            large: { title: '16pt', mode: '13pt', buttonName: '13pt', buttonDesc: '11pt' }
        };
        return sizes[this.fontSize] || sizes.medium;
    },

    loadSettings: function() {
        try {
            let file = GLib.file_get_contents(this.settingsFile);
            if (file[0]) {
                return JSON.parse(file[1].toString());
            }
        } catch (e) {
            // File doesn't exist or error reading, return defaults
        }
        return { 
            showLogoutWarning: true
        };
    },

    saveSettings: function() {
        try {
            GLib.file_set_contents(this.settingsFile, JSON.stringify(this.settings));
        } catch (e) {
            global.log('Error saving settings: ' + e);
        }
    },

    setupUI: function() {
        let isHorizontal = (this.layout === "horizontal");
        let fontSizes = this.getFontSizes();
        let accentColor = this.getAccentColor();
        
        // Main container - horizontal or vertical based on settings
        this.window = new St.BoxLayout({
            vertical: !isHorizontal,
            style_class: 'desklet',
            reactive: true,
            track_hover: true,
            style: 'background-color: rgba(0, 0, 0, 0.85); border-radius: 10px; padding: 12px; border: 2px solid ' + accentColor + ';' + 
                   (isHorizontal ? '' : ' min-width: 200px;')
        });

        if (isHorizontal) {
            // Horizontal layout - Title and mode on left, buttons on right
            let leftBox = new St.BoxLayout({
                vertical: true,
                style: 'margin-right: 15px;',
                x_align: Clutter.ActorAlign.CENTER
            });

            let title = new St.Label({
                text: 'Nvidia\nPrime',
                style: 'font-size: ' + fontSizes.title + '; font-weight: bold; color: ' + accentColor + '; line-height: 1.3;',
                x_align: Clutter.ActorAlign.CENTER
            });
            leftBox.add(title);

            if (this.showModeIndicator) {
                this.currentLabel = new St.Label({
                    text: 'Loading...',
                    style: 'font-size: ' + fontSizes.mode + '; color: #cccccc; margin-top: 8px; max-width: 100px;',
                    x_align: Clutter.ActorAlign.CENTER
                });
                leftBox.add(this.currentLabel);
            }

            this.window.add(leftBox);

            this.profileBox = new St.BoxLayout({
                vertical: false,
                style: 'spacing: 6px;'
            });
            this.window.add(this.profileBox);
        } else {
            // Vertical layout - Title and mode on top, buttons stacked below
            let titleBox = new St.BoxLayout({
                vertical: false,
                style: 'margin-bottom: 10px;'
            });
            
            let title = new St.Label({
                text: 'Nvidia Prime',
                style: 'font-size: ' + fontSizes.title + '; font-weight: bold; color: ' + accentColor + ';'
            });
            titleBox.add(title);
            this.window.add(titleBox);

            if (this.showModeIndicator) {
                this.currentLabel = new St.Label({
                    text: 'Loading...',
                    style: 'font-size: ' + fontSizes.mode + '; color: #cccccc; margin-bottom: 10px;'
                });
                this.window.add(this.currentLabel);
            }

            this.profileBox = new St.BoxLayout({
                vertical: true,
                style: 'spacing: 6px;'
            });
            this.window.add(this.profileBox);
        }

        this.setContent(this.window);
    },

    getCurrentProfile: function() {
        try {
            let [res, out, err, status] = GLib.spawn_command_line_sync('prime-select query');
            if (res && out) {
                return out.toString().trim();
            }
        } catch (e) {
            global.log('Error getting current NVIDIA profile: ' + e);
        }
        return 'unknown';
    },

    updateProfiles: function() {
        // Clear existing profile buttons
        this.profileBox.destroy_all_children();

        // Get current profile
        let currentProfile = this.getCurrentProfile();
        
        // Set accelerator-style indicator based on current profile
        let indicator = '';
        let iconName = '';
        if (currentProfile === 'intel') {
            indicator = 'POWER SAVING\nMODE';
            iconName = this.intelIcon || 'intel-mode';
        } else if (currentProfile === 'on-demand') {
            indicator = 'HYBRID\nMODE';
            iconName = this.onDemandIcon || 'hybrid-mode';
        } else if (currentProfile === 'nvidia') {
            indicator = 'PERFORMANCE\nMODE';
            iconName = this.nvidiaIcon || 'nvidia-settings';
        } else {
            indicator = 'UNKNOWN\nMODE';
            iconName = 'dialog-question';
        }
        
        if (this.showModeIndicator && this.currentLabel) {
            // Check if we need to rebuild the mode indicator section
            if (this.modeIndicatorBox) {
                this.modeIndicatorBox.destroy();
            }
            
            let isHorizontal = (this.layout === "horizontal");
            let accentColor = this.getAccentColor();
            let iconSize = this.modeIndicatorIconSize || 24;
            let textSize = this.modeIndicatorTextSize || 7;
            
            // Create container for icon and text
            this.modeIndicatorBox = new St.BoxLayout({
                vertical: true,
                x_align: Clutter.ActorAlign.CENTER,
                style: 'margin-top: 8px;'
            });
            
            // Add icon (use system icon instead of emoji)
            if (this.useSystemIcons) {
                let icon = new St.Icon({
                    icon_name: iconName,
                    icon_size: iconSize,
                    style: 'color: ' + accentColor + ';',
                    x_align: Clutter.ActorAlign.CENTER
                });
                this.modeIndicatorBox.add(icon);
            } else {
                // Fallback to emoji if system icons disabled
                let iconEmoji = currentProfile === 'intel' ? '🐢' : 
                               currentProfile === 'on-demand' ? '⚡' : 
                               currentProfile === 'nvidia' ? '🚀' : '❓';
                let iconLabel = new St.Label({
                    text: iconEmoji,
                    style: 'font-size: ' + iconSize + 'pt;',
                    x_align: Clutter.ActorAlign.CENTER
                });
                this.modeIndicatorBox.add(iconLabel);
            }
            
            // Add text below icon
            this.currentLabel.set_text(indicator);
            this.currentLabel.set_style('font-size: ' + textSize + 'pt; color: ' + accentColor + '; margin-top: 4px; line-height: 1.1; text-align: center;');
            this.modeIndicatorBox.add(this.currentLabel);
            
            // Find the leftBox and add the mode indicator
            if (isHorizontal) {
                // In horizontal mode, add to the existing leftBox
                let leftBox = this.window.get_first_child();
                leftBox.add(this.modeIndicatorBox);
            } else {
                // In vertical mode, add after title
                this.window.insert_child_at_index(this.modeIndicatorBox, 1);
            }
        }

        // Define NVIDIA Prime profiles
        let profiles = [
            {
                name: 'Intel',
                command: 'intel',
                description: 'Power Saving',
                icon: this.intelIcon || '🔋'
            },
            {
                name: 'On-Demand',
                command: 'on-demand',
                description: 'Hybrid Mode',
                icon: this.onDemandIcon || '⚡'
            },
            {
                name: 'Nvidia',
                command: 'nvidia',
                description: 'Performance',
                icon: this.nvidiaIcon || '🚀'
            }
        ];

        profiles.forEach(profile => {
            let isCurrent = (profile.command === currentProfile);
            this.addProfileButton(profile, isCurrent);
        });
    },

    addProfileButton: function(profile, isCurrent) {
        let isHorizontal = (this.layout === "horizontal");
        let fontSizes = this.getFontSizes();
        let accentColor = this.getAccentColor();
        let accentColorAlpha = this.getAccentColorRGBA(0.4);
        
        let button = new St.Button({
            style: 'background-color: ' + (isCurrent ? accentColorAlpha : 'rgba(60, 60, 60, 0.5)') + 
                   '; border-radius: 6px; padding: ' + (isHorizontal ? '10px 15px' : '10px') + ';' +
                   (isHorizontal ? '' : ' width: 100%;') +
                   (isCurrent ? ' border: 1px solid ' + accentColor + ';' : ''),
            reactive: !isCurrent
        });

        let box = new St.BoxLayout({
            vertical: true,
            style: isHorizontal ? 'min-width: 80px;' : '',
            x_align: Clutter.ActorAlign.CENTER
        });

        // Handle icon display - either system icon or emoji
        if (this.useSystemIcons) {
            let icon = new St.Icon({
                icon_name: profile.icon,
                icon_size: this.iconSize || 24,
                style: 'color: ' + (isCurrent ? accentColor : '#ffffff') + ';',
                x_align: Clutter.ActorAlign.CENTER
            });
            box.add(icon);
            
            if (this.showProfileNames) {
                let nameLabel = new St.Label({
                    text: profile.name + (isCurrent ? ' ✓' : ''),
                    style: 'color: ' + (isCurrent ? accentColor : '#ffffff') + 
                           '; font-size: ' + fontSizes.buttonName + 
                           '; font-weight: bold; margin-top: 4px;',
                    x_align: Clutter.ActorAlign.CENTER
                });
                box.add(nameLabel);
            } else if (isCurrent) {
                // Show checkmark even without name
                let checkLabel = new St.Label({
                    text: '✓',
                    style: 'color: ' + accentColor + 
                           '; font-size: ' + fontSizes.buttonName + 
                           '; font-weight: bold; margin-top: 4px;',
                    x_align: Clutter.ActorAlign.CENTER
                });
                box.add(checkLabel);
            }
        } else {
            // Use emoji (original behavior)
            if (this.showProfileNames) {
                let nameLabel = new St.Label({
                    text: profile.icon + (isHorizontal ? '\n' : ' ') + profile.name + (isCurrent ? ' ✓' : ''),
                    style: 'color: ' + (isCurrent ? accentColor : '#ffffff') + 
                           '; font-size: ' + fontSizes.buttonName + 
                           '; font-weight: bold;' + 
                           (isHorizontal ? '' : ''),
                    x_align: Clutter.ActorAlign.CENTER
                });
                box.add(nameLabel);
            } else {
                let nameLabel = new St.Label({
                    text: profile.icon + (isCurrent ? ' ✓' : ''),
                    style: 'color: ' + (isCurrent ? accentColor : '#ffffff') + 
                           '; font-size: ' + fontSizes.buttonName + 
                           '; font-weight: bold;',
                    x_align: Clutter.ActorAlign.CENTER
                });
                box.add(nameLabel);
            }
        }
        
        if (this.showDescriptions) {
            let descLabel = new St.Label({
                text: profile.description,
                style: 'color: #aaaaaa; font-size: ' + fontSizes.buttonDesc + 
                       '; margin-top: 2px;',
                x_align: Clutter.ActorAlign.CENTER
            });
            box.add(descLabel);
        }
        
        button.set_child(box);

        if (!isCurrent) {
            button.connect('clicked', () => {
                if (this.skipConfirmDialog && this.settings.showLogoutWarning === false) {
                    // Skip dialog entirely - just switch and reboot later
                    this.switchProfile(profile, false);
                } else {
                    this.showConfirmDialog(profile);
                }
            });
        }

        this.profileBox.add(button);
    },

    showConfirmDialog: function(profile) {
        let dialog = new ModalDialog.ModalDialog();
        let accentColor = this.getAccentColor();
        
        // Style the dialog background
        dialog.contentLayout.set_style('background-color: rgba(0, 0, 0, 0.95); border-radius: 10px; border: 2px solid ' + accentColor + '; padding: 20px; min-width: 400px;');
        
        let label = new St.Label({
            text: 'Switch to ' + profile.name + ' mode?\n\nReboot required to apply changes.',
            style: 'font-size: 12pt; padding: 20px; color: #ffffff;'
        });
        dialog.contentLayout.add(label);

        // Checkbox container
        let checkboxContainer = new St.BoxLayout({
            vertical: false,
            style: 'padding: 10px 20px;'
        });

        let checkbox = new St.Button({
            style: 'width: 20px; height: 20px; border: 2px solid #ffffff; border-radius: 3px; background-color: ' + 
                   (this.settings.showLogoutWarning ? 'transparent' : accentColor) + ';',
            reactive: true,
            x_align: Clutter.ActorAlign.START
        });

        let checkboxLabel = new St.Label({
            text: "  Don't show this again",
            style: 'font-size: 10pt; margin-left: 8px; color: #ffffff;'
        });

        let isChecked = !this.settings.showLogoutWarning;
        
        checkbox.connect('clicked', () => {
            isChecked = !isChecked;
            checkbox.set_style('width: 20px; height: 20px; border: 2px solid #ffffff; border-radius: 3px; background-color: ' + 
                              (isChecked ? accentColor : 'transparent') + ';');
        });

        checkboxContainer.add(checkbox);
        checkboxContainer.add(checkboxLabel);
        dialog.contentLayout.add(checkboxContainer);

        dialog.setButtons([
            {
                label: 'Cancel',
                action: () => {
                    dialog.close();
                },
                key: Clutter.Escape,
                style: 'background-color: rgba(80, 80, 80, 0.8); color: #ffffff; border-radius: 6px; padding: 10px 20px; font-size: 11pt;'
            },
            {
                label: 'Reboot Later',
                action: () => {
                    // Save checkbox preference
                    if (isChecked) {
                        this.settings.showLogoutWarning = false;
                        this.saveSettings();
                    }
                    
                    dialog.close();
                    this.switchProfile(profile, false);
                },
                style: 'background-color: rgba(100, 100, 100, 0.8); color: #ffffff; border-radius: 6px; padding: 10px 20px; font-size: 11pt;'
            },
            {
                label: 'Reboot Now',
                action: () => {
                    // Save checkbox preference
                    if (isChecked) {
                        this.settings.showLogoutWarning = false;
                        this.saveSettings();
                    }
                    
                    dialog.close();
                    this.switchProfile(profile, true);
                },
                style: 'background-color: ' + this.getAccentColorRGBA(0.8) + '; color: #ffffff; border-radius: 6px; padding: 10px 20px; font-size: 11pt; font-weight: bold;'
            }
        ]);

        dialog.open();
    },

    switchProfile: function(profile, rebootNow) {
        // Try multiple methods to get GUI password prompt
        // Method 1: Try gksudo if available
        // Method 2: Try pkexec with explicit display
        // Method 3: Use gnome-terminal with sudo
        
        let display = GLib.getenv('DISPLAY');
        let xauthority = GLib.getenv('XAUTHORITY');
        
        // Use pkexec with environment variables set
        try {
            let subprocess = new Gio.Subprocess({
                argv: ['pkexec', 'env', 'DISPLAY=' + display, 'XAUTHORITY=' + xauthority, 'prime-select', profile.command],
                flags: Gio.SubprocessFlags.NONE
            });
            subprocess.init(null);
        } catch (e) {
            global.log('Error executing pkexec: ' + e);
            // Fallback: open a terminal window for user to enter password
            Util.spawn(['gnome-terminal', '--', 'bash', '-c', 
                'sudo prime-select ' + profile.command + '; echo "Profile switched. Press Enter to close."; read']);
        }
        
        if (rebootNow) {
            // Show notification with action button
            Util.spawn(['notify-send', 
                'NVIDIA Prime', 
                'Switching to ' + profile.name + ' mode. Rebooting in ' + this.rebootDelay + ' seconds...',
                '-i', 'nvidia-settings',
                '-u', 'critical',
                '-t', (this.rebootDelay * 1000).toString()]);
            
            // Create a dialog with reboot now option
            let rebootDialog = new ModalDialog.ModalDialog();
            let accentColor = this.getAccentColor();
            rebootDialog.contentLayout.set_style('background-color: rgba(0, 0, 0, 0.95); border-radius: 10px; border: 2px solid ' + accentColor + '; padding: 20px; min-width: 400px;');
            
            this.secondsRemaining = this.rebootDelay;
            let rebootLabel = new St.Label({
                text: 'Profile switch in progress...\n\nSystem will reboot in ' + this.secondsRemaining + ' seconds.',
                style: 'font-size: 12pt; padding: 20px; color: #ffffff;'
            });
            rebootDialog.contentLayout.add(rebootLabel);
            
            // Update countdown every second
            this.countdownInterval = Mainloop.timeout_add_seconds(1, () => {
                this.secondsRemaining--;
                rebootLabel.set_text('Profile switch in progress...\n\nSystem will reboot in ' + this.secondsRemaining + ' seconds.');
                
                if (this.secondsRemaining <= 0) {
                    return false; // Stop the interval
                }
                return true; // Continue the interval
            });
            
            rebootDialog.setButtons([
                {
                    label: 'Cancel Reboot',
                    action: () => {
                        if (this.rebootTimeout) {
                            Mainloop.source_remove(this.rebootTimeout);
                            this.rebootTimeout = null;
                        }
                        if (this.countdownInterval) {
                            Mainloop.source_remove(this.countdownInterval);
                            this.countdownInterval = null;
                        }
                        rebootDialog.close();
                        Util.spawn(['notify-send', 
                            'NVIDIA Prime', 
                            'Reboot cancelled. Please reboot manually for changes to take effect.',
                            '-i', 'nvidia-settings']);
                    },
                    style: 'background-color: rgba(80, 80, 80, 0.8); color: #ffffff; border-radius: 6px; padding: 10px 20px; font-size: 11pt;'
                },
                {
                    label: 'Reboot Now',
                    action: () => {
                        if (this.rebootTimeout) {
                            Mainloop.source_remove(this.rebootTimeout);
                            this.rebootTimeout = null;
                        }
                        if (this.countdownInterval) {
                            Mainloop.source_remove(this.countdownInterval);
                            this.countdownInterval = null;
                        }
                        rebootDialog.close();
                        Util.spawn(['systemctl', 'reboot']);
                    },
                    style: 'background-color: rgba(118, 185, 0, 0.8); color: #ffffff; border-radius: 6px; padding: 10px 20px; font-size: 11pt; font-weight: bold;'
                }
            ]);
            
            rebootDialog.open();
            
            // Wait for configured delay then reboot automatically
            this.rebootTimeout = Mainloop.timeout_add_seconds(this.rebootDelay, () => {
                if (this.countdownInterval) {
                    Mainloop.source_remove(this.countdownInterval);
                    this.countdownInterval = null;
                }
                rebootDialog.close();
                Util.spawn(['systemctl', 'reboot']);
                this.rebootTimeout = null;
                return false;
            });
        } else {
            // Show notification
            Util.spawn(['notify-send', 
                'NVIDIA Prime', 
                'Switching to ' + profile.name + ' mode. Please reboot for changes to take effect.',
                '-i', 'nvidia-settings']);
            
            // Update after a short delay
            Mainloop.timeout_add_seconds(2, () => {
                this.updateProfiles();
                return false;
            });
        }
    },

    on_desklet_removed: function() {
        // Cleanup (no timeout to remove since we removed auto-refresh)
    }
};

function main(metadata, desklet_id) {
    return new NvidiaProfileSwitcherDesklet(metadata, desklet_id);
}
