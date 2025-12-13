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
const Cairo = imports.cairo;
const ModalDialog = imports.ui.modalDialog;

const UUID = "power-desklet@thewraith420";

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
        
        // Lenovo Vantage Settings
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "conservation-mode-enabled", "conservation_mode_enabled", this._onSettingChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "rapid-charge-enabled", "rapid_charge_enabled", this._onSettingChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "update-interval", "update_interval", this._onSettingChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "background-opacity", "background_opacity", this._onAppearanceChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "background-color", "background_color", this._onAppearanceChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "accent-color", "accent_color", this._onAppearanceChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "desklet-width", "desklet_width", this._onAppearanceChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "font-size", "font_size", this._onAppearanceChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "border-radius", "border_radius", this._onAppearanceChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "show-quick-toggles", "show_quick_toggles", this._onLayoutChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "button-size", "button_size", this._onAppearanceChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "horizontal-layout", "horizontal_layout", this._onLayoutChanged, null);

        // Nvidia Switcher Settings
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "layout", "nvidia_layout", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "rebootDelay", "rebootDelay", null, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "showDescriptions", "showDescriptions", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "showProfileNames", "showProfileNames", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "accentColor", "nvidia_accentColor", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "fontSize", "nvidia_fontSize", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "modeIndicatorIconSize", "modeIndicatorIconSize", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "modeIndicatorTextSize", "modeIndicatorTextSize", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "showModeIndicator", "showModeIndicator", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "skipConfirmDialog", "skipConfirmDialog", null, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "intelIcon", "intelIcon", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "onDemandIcon", "onDemandIcon", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "nvidiaIcon", "nvidiaIcon", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "useSystemIcons", "useSystemIcons", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "iconSize", "nvidia_iconSize", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "rebootMethod", "rebootMethod", null, null);

        try {
            // Initialize default settings
            if (!this.update_interval) this.update_interval = 5;
            if (this.background_opacity === undefined) this.background_opacity = 1.0;
            if (!this.background_color) this.background_color = 'rgb(40, 70, 130)';
            if (!this.accent_color) this.accent_color = 'rgb(255, 255, 255)';
            if (!this.desklet_width) this.desklet_width = 280;
            if (!this.font_size) this.font_size = 48;
            if (!this.border_radius) this.border_radius = 16;
            if (!this.button_size) this.button_size = 50;
            if (this.show_quick_toggles === undefined) this.show_quick_toggles = true;
            if (this.horizontal_layout === undefined) this.horizontal_layout = false;

            this.currentPercentage = 0;
            this.nvidiaSettingsFile = GLib.get_home_dir() + '/.config/nvidia-profile-switcher-settings.json';
            this.nvidia_settings = this.loadNvidiaSettings();

            this._buildUI();
            this._update();
            this.updateProfiles();

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

        this.lenovoBox = new St.BoxLayout({ vertical: true });
        this.nvidiaBox = new St.BoxLayout({ vertical: true, style: 'padding: 10px;' });

        this._buildLenovoUI(this.lenovoBox);
        this.setupNvidiaUI(this.nvidiaBox);

        this.window.add(this.lenovoBox);
        this.window.add(this.nvidiaBox);
        this.nvidiaBox.hide(); 

        this.setContent(this.window);
    },

    toggleNvidiaView: function() {
        if (this.nvidiaBox.visible) {
            this.nvidiaBox.hide();
            this.lenovoBox.show();
        } else {
            this.lenovoBox.hide();
            this.nvidiaBox.show();
        }
    },

    _buildLenovoUI: function(container) {
        if (this.horizontal_layout) {
            this._buildHorizontalLayout(container);
        } else {
            this._buildVerticalLayout(container);
        }
    },
    
    _buildVerticalLayout: function(container) {
        let batteryBox = new St.BoxLayout({
            vertical: true,
            style: 'padding: 20px;',
            x_align: Clutter.ActorAlign.CENTER
        });
        container.add(batteryBox, { expand: true });

        this._createBatteryBar(batteryBox);

        this.statusLabel = new St.Label({
            text: "Full in 3h 30m",
            style: this._getStatusStyle(),
            x_align: Clutter.ActorAlign.CENTER
        });
        batteryBox.add(this.statusLabel, { x_align: Clutter.ActorAlign.CENTER });

        if (this.show_quick_toggles) {
            this._createButtonGrid(container);
        }
    },

    _buildHorizontalLayout: function(container) {
        let mainBox = new St.BoxLayout({ vertical: false });
        container.add(mainBox);

        let batteryBox = new St.BoxLayout({
            vertical: true,
            style: 'padding: 20px;',
            x_align: Clutter.ActorAlign.CENTER
        });
        mainBox.add(batteryBox, { expand: true });

        this._createBatteryBar(batteryBox);

        this.statusLabel = new St.Label({
            text: "Full in 3h 30m",
            style: this._getStatusStyle(),
            x_align: Clutter.ActorAlign.CENTER
        });
        batteryBox.add(this.statusLabel, { x_align: Clutter.ActorAlign.CENTER });

        if (this.show_quick_toggles) {
            this._createButtonGrid(mainBox);
        }
    },

    _createBatteryBar: function(container) {
        let barWidth = this.horizontal_layout ? 200 : Math.min(240, this.desklet_width - 40);
        let barHeight = 80;

        this.batteryBarBox = new St.BoxLayout({
            vertical: false,
            style: `width: ${barWidth}px; height: ${barHeight}px; margin-bottom: 15px;`,
            x_align: Clutter.ActorAlign.CENTER
        });
        container.add(this.batteryBarBox, { x_align: Clutter.ActorAlign.CENTER });

        this.batteryBarBg = new St.Widget({
            style: `background-color: rgba(255, 255, 255, 0.15); border-radius: 12px; width: ${barWidth}px; height: ${barHeight}px;`
        });
        this.batteryBarBox.add_child(this.batteryBarBg);

        this.batteryBarFill = new St.Widget({
            style: `background-color: rgba(255, 255, 255, 0.4); border-radius: 12px; width: ${barWidth}px; height: ${barHeight}px;`,
            x: 0,
            y: 0
        });
        this.batteryBarBg.add_child(this.batteryBarFill);

        this.percentageLabel = new St.Label({
            text: "95%",
            style: this._getPercentageStyle(),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });
        this.batteryBarBg.add_child(this.percentageLabel);
    },

    _updateBatteryBar: function(percentage) {
        if (!this.batteryBarFill) return;
        let barWidth = this.horizontal_layout ? 200 : Math.min(240, this.desklet_width - 40);
        let fillWidth = Math.round((percentage / 100) * barWidth);
        this.batteryBarFill.set_style(`background-color: rgba(255, 255, 255, 0.4); border-radius: 12px; width: ${fillWidth}px; height: 80px;`);
        let labelWidth = this.percentageLabel.width;
        let labelX = (barWidth - labelWidth) / 2;
        this.percentageLabel.set_position(labelX, 20);
    },

    _createButtonGrid: function(container) {
        let buttonGridBox = new St.Widget({
            layout_manager: new Clutter.GridLayout({ orientation: Clutter.Orientation.VERTICAL }),
            style: 'padding: 0px 15px 15px 15px;'
        });
        container.add(buttonGridBox);

        let gridLayout = buttonGridBox.layout_manager;
        this.actionButtons = [];

        this.createActionButton(gridLayout, 0, 0, "🔋", "Battery Saver");
        this.createActionButton(gridLayout, 1, 0, "⚡", "Rapid");
        this.createActionButton(gridLayout, 0, 1, "🔒", "Lock");
        this.createActionButton(gridLayout, 1, 1, "👁️", "Nvidia");
        this.createActionButton(gridLayout, 0, 2, "⚙", "Settings");
    },

    createActionButton: function(gridLayout, col, row, icon, label) {
        let buttonSize = this.button_size || 50;
        let buttonBox = new St.BoxLayout({ vertical: true, style: 'spacing: 6px;', x_align: Clutter.ActorAlign.CENTER });
        let button = new St.Button({ reactive: true, track_hover: true, can_focus: true, style: this._getButtonBaseStyle(), width: buttonSize, height: buttonSize });
        let iconSize = Math.round(buttonSize * 0.36);
        let iconLabel = new St.Label({ text: icon, style: `font-size: ${iconSize}pt;`, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
        button.set_child(iconLabel);
        let textLabel = new St.Label({ text: label, style: this._getButtonLabelStyle(), x_align: Clutter.ActorAlign.CENTER });
        buttonBox.add(button);
        buttonBox.add(textLabel);
        gridLayout.attach(buttonBox, col, row, 1, 1);

        if (label === "Battery Saver") {
            this.conservationButton = button;
            button.connect('clicked', () => { this.conservation_mode_enabled = !this.conservation_mode_enabled; this._applyConservationMode(); });
        } else if (label === "Rapid") {
            this.rapidButton = button;
            button.connect('clicked', () => { this.rapid_charge_enabled = !this.rapid_charge_enabled; this._applyRapidCharge(); });
        } else if (label === "Lock") {
            button.connect('clicked', () => { try { Util.spawnCommandLine("cinnamon-screensaver-command -l"); } catch (e) { Main.notify(_('Power Desklet'), _('Failed to lock screen')); } });
        } else if (label === "Nvidia") {
            button.connect('clicked', () => { this.toggleNvidiaView(); });
        } else if (label === "Settings") {
            button.connect('clicked', () => { try { Util.spawnCommandLine("cinnamon-settings desklets " + this.metadata.uuid + " " + this.desklet_id); } catch (e) { global.logError('Failed to open settings: ' + e); } });
        }

        button.connect('enter-event', () => button.set_style(this._getButtonHoverStyle()));
        button.connect('leave-event', () => this._updateButtonStyle(button, label));

        if (!this.actionButtons) this.actionButtons = [];
        this.actionButtons.push({ button: button, label: label, icon: iconLabel });
    },

    _updateButtonStyle: function(button, label) {
        let isActive = (label === "Battery Saver" && this.conservation_mode_enabled) || (label === "Rapid" && this.rapid_charge_enabled);
        button.set_style(isActive ? this._getButtonActiveStyle() : this._getButtonBaseStyle());
    },
    
    _onSettingChanged: function() {
        this._applyConservationMode();
        this._applyRapidCharge();
        this._update();
    },

    _onAppearanceChanged: function() { this._buildUI(); this._update(); },
    _onLayoutChanged: function() { this._buildUI(); this._update(); },

    _getWindowStyle: function() {
        let opacity = this.background_opacity || 1.0;
        let bgColor = this.background_color || 'rgb(40, 70, 130)';
        let width = this.horizontal_layout ? 'auto' : (this.desklet_width || 280);
        let radius = this.border_radius || 16;
        let widthStyle = this.horizontal_layout ? '' : `min-width: ${width}px; max-width: ${width}px;`;
        let rgbMatch = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) return `background-color: rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${opacity}); border-radius: ${radius}px; padding: 0px; ${widthStyle}`;
        return `background-color: ${bgColor}; border-radius: ${radius}px; padding: 0px; ${widthStyle}`;
    },
    _getPercentageStyle: function() { return `color: ${this.accent_color || 'rgb(255, 255, 255)'}; font-size: ${this.font_size || 48}pt; font-weight: bold;`; },
    _getStatusStyle: function() { return `color: ${this.accent_color || 'rgb(255, 255, 255)'}; font-size: 11pt; margin-top: 8px; opacity: 0.8;`; },
    _getButtonBaseStyle: function() { let s = this.button_size || 50; return `background-color: rgba(255, 255, 255, 0.1); border-radius: ${s/2}px; min-width: ${s}px; min-height: ${s}px; width: ${s}px; height: ${s}px;`; },
    _getButtonActiveStyle: function() { let s = this.button_size || 50; return `background-color: rgba(255, 255, 255, 0.25); border-radius: ${s/2}px; border: 2px solid rgba(255, 255, 255, 0.4); min-width: ${s}px; min-height: ${s}px; width: ${s}px; height: ${s}px;`; },
    _getButtonHoverStyle: function() { let s = this.button_size || 50; return `background-color: rgba(255, 255, 255, 0.2); border-radius: ${s/2}px; min-width: ${s}px; min-height: ${s}px; width: ${s}px; height: ${s}px;`; },
    _getButtonLabelStyle: function() { return `color: ${this.accent_color || 'rgb(255, 255, 255)'}; font-size: 8pt; text-align: center; opacity: 0.8;`; },

    _applyConservationMode: function() { this._writeToSysFile("/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode", this.conservation_mode_enabled, "Conservation Mode"); },
    _applyRapidCharge: function() { this._writeToSysFile("/sys/bus/platform/drivers/legion/PNP0C09:00/rapidcharge", this.rapid_charge_enabled, "Rapid Charge"); },

    _writeToSysFile: function(filePath, enabled, featureName) {
        try {
            let targetState = enabled ? '1' : '0';
            if (this._readFromFile(filePath).trim() !== targetState) {
                let cmd = `echo ${targetState} | pkexec tee ${filePath}`;
                Util.spawn(['gnome-terminal', '--', 'bash', '-c', cmd]);
            }
        } catch (e) {
            global.logError(`Failed to apply ${featureName}: ${e}`);
        }
    },

    _update: function() {
        const ENERGY_NOW = "/sys/class/power_supply/BAT1/energy_now";
        const ENERGY_FULL = "/sys/class/power_supply/BAT1/energy_full";
        const POWER_NOW = "/sys/class/power_supply/BAT1/power_now";
        const STATUS = "/sys/class/power_supply/BAT1/status";

        try {
            let energyNow = parseInt(this._readFromFile(ENERGY_NOW));
            let energyFull = parseInt(this._readFromFile(ENERGY_FULL));
            let status = this._readFromFile(STATUS).trim();
            let percentage = energyFull > 0 ? Math.round((energyNow / energyFull) * 100) : 0;
            
            this.percentageLabel.set_text(percentage + "%");
            this._updateBatteryBar(percentage);

            let statusText = status;
            if (status === "Charging" || status === "Discharging") {
                let powerNow = parseInt(this._readFromFile(POWER_NOW));
                if (powerNow > 0) {
                    let timeHours = (status === "Charging" ? (energyFull - energyNow) : energyNow) / powerNow;
                    let hours = Math.floor(timeHours);
                    let minutes = Math.round((timeHours - hours) * 60);
                    statusText = (status === "Charging" ? `Full in ${hours}h ${minutes}m` : `${hours}h ${minutes}m remaining`);
                }
            } else if (status === "Full") {
                statusText = "Fully charged";
            }
            this.statusLabel.set_text(statusText);

            try { this.conservation_mode_enabled = this._readFromFile("/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode").trim() === '1'; this._updateButtonStyle(this.conservationButton, "Battery Saver"); } catch(e) {}
            try { this.rapid_charge_enabled = this._readFromFile("/sys/bus/platform/drivers/legion/PNP0C09:00/rapidcharge").trim() === '1'; this._updateButtonStyle(this.rapidButton, "Rapid"); } catch (e) {}
        } catch (e) {
            this.percentageLabel.set_text("--");
            this.statusLabel.set_text("Error loading battery info");
        }
        
        if (this.timeout) Mainloop.source_remove(this.timeout);
        this.timeout = Mainloop.timeout_add_seconds(this.update_interval || 5, () => this._update());
        return true;
    },

    _readFromFile: function(path) {
        let [success, contents] = Gio.file_new_for_path(path).load_contents(null);
        if (success) return ByteArray.toString(contents);
        throw new Error("Could not read file: " + path);
    },

    on_desklet_removed: function() { if (this.timeout) Mainloop.source_remove(this.timeout); },

    // Nvidia Switcher Functions
    on_settings_changed: function() { this._buildUI(); this.updateProfiles(); },
    loadNvidiaSettings: function() { try { let [ok, contents] = GLib.file_get_contents(this.nvidiaSettingsFile); if (ok) return JSON.parse(contents.toString()); } catch (e) {} return { showLogoutWarning: true }; },
    saveNvidiaSettings: function() { try { GLib.file_set_contents(this.nvidiaSettingsFile, JSON.stringify(this.nvidia_settings)); } catch (e) {} },
    setupNvidiaUI: function(container) {
        let isHorizontal = (this.nvidia_layout === "horizontal");
        let accentColor = this.nvidia_accentColor || '#76b900';
        
        container.style = 'background-color: rgba(0, 0, 0, 0.85); border-radius: 10px; padding: 12px; border: 2px solid ' + accentColor + ';';
        container.vertical = !isHorizontal;

        if (isHorizontal) {
            let leftBox = new St.BoxLayout({ vertical: true, style: 'margin-right: 15px;', x_align: Clutter.ActorAlign.CENTER });
            let title = new St.Label({ text: 'Nvidia\nPrime', style: 'font-size: 14pt; font-weight: bold; color: ' + accentColor + '; line-height: 1.3;', x_align: Clutter.ActorAlign.CENTER });
            leftBox.add(title);
            if (this.showModeIndicator) {
                this.nvidiaCurrentLabel = new St.Label({ text: 'Loading...', style: 'font-size: 11pt; color: #cccccc; margin-top: 8px; max-width: 100px;', x_align: Clutter.ActorAlign.CENTER });
                leftBox.add(this.nvidiaCurrentLabel);
            }
            container.add_child(leftBox);
            this.nvidiaProfileBox = new St.BoxLayout({ vertical: false, style: 'spacing: 6px;' });
            container.add_child(this.nvidiaProfileBox);
        } else {
            let titleBox = new St.BoxLayout({ vertical: false, style: 'margin-bottom: 10px;' });
            let title = new St.Label({ text: 'Nvidia Prime', style: 'font-size: 14pt; font-weight: bold; color: ' + accentColor + ';' });
            titleBox.add(title);
            container.add_child(titleBox);
            if (this.showModeIndicator) {
                this.nvidiaCurrentLabel = new St.Label({ text: 'Loading...', style: 'font-size: 11pt; color: #cccccc; margin-bottom: 10px;' });
                container.add_child(this.nvidiaCurrentLabel);
            }
            this.nvidiaProfileBox = new St.BoxLayout({ vertical: true, style: 'spacing: 6px;' });
            container.add_child(this.nvidiaProfileBox);
        }
    },
    getCurrentProfile: function() { try { let [res, out] = GLib.spawn_command_line_sync('prime-select query'); if (res) return out.toString().trim(); } catch (e) {} return 'unknown'; },
    updateProfiles: function() {
        if (!this.nvidiaProfileBox) return;
        this.nvidiaProfileBox.destroy_all_children();
        let currentProfile = this.getCurrentProfile();
        
        let profiles = [ { name: 'Intel', command: 'intel', description: 'Power Saving', icon: this.intelIcon || 'intel-mode' }, { name: 'On-Demand', command: 'on-demand', description: 'Hybrid Mode', icon: this.onDemandIcon || 'hybrid-mode' }, { name: 'Nvidia', command: 'nvidia', description: 'Performance', icon: this.nvidiaIcon || 'nvidia-settings' }];
        profiles.forEach(p => this.addProfileButton(p, p.command === currentProfile));
    },
    addProfileButton: function(profile, isCurrent) {
        let isHorizontal = (this.nvidia_layout === "horizontal");
        let accentColor = this.nvidia_accentColor || '#76b900';
        let button = new St.Button({ style: `background-color: ${isCurrent ? accentColor+'66' : '#3c3c3c80'}; border-radius: 6px; padding: ${isHorizontal ? '10px 15px' : '10px'}; width: ${isHorizontal ? 'auto' : '100%'}; border: ${isCurrent ? '1px solid '+accentColor : 'none'};`, reactive: !isCurrent });
        let box = new St.BoxLayout({ vertical: true, x_align: Clutter.ActorAlign.CENTER });
        if (this.useSystemIcons) {
            box.add_child(new St.Icon({ icon_name: profile.icon, icon_size: this.nvidia_iconSize || 24, style: `color: ${isCurrent ? accentColor : '#fff'};` }));
            if (this.showProfileNames) box.add_child(new St.Label({ text: profile.name + (isCurrent ? ' ✓' : ''), style: `color: ${isCurrent ? accentColor : '#fff'}; font-size: 11pt; font-weight: bold; margin-top: 4px;` }));
        } else {
            box.add_child(new St.Label({ text: (profile.icon.length > 2 ? '❓' : profile.icon) + (this.showProfileNames ? ' ' + profile.name : '') + (isCurrent ? ' ✓' : ''), style: `color: ${isCurrent ? accentColor : '#fff'}; font-size: 11pt; font-weight: bold;` }));
        }
        if (this.showDescriptions) box.add_child(new St.Label({ text: profile.description, style: 'color: #aaa; font-size: 9pt; margin-top: 2px;' }));
        button.set_child(box);
        if (!isCurrent) button.connect('clicked', () => { if (this.skipConfirmDialog) this.switchProfile(profile, false); else this.showConfirmDialog(profile); });
        this.nvidiaProfileBox.add_child(button);
    },
    showConfirmDialog: function(profile) {
        let dialog = new ModalDialog.ModalDialog();
        dialog.contentLayout.add(new St.Label({ text: `Switch to ${profile.name} mode?\n\nReboot required to apply changes.`, style: 'font-size: 12pt; padding: 20px; color: #fff;' }));
        dialog.setButtons([{ label: 'Cancel', action: () => dialog.close(), key: Clutter.Escape }, { label: 'Reboot Later', action: () => { dialog.close(); this.switchProfile(profile, false); } }, { label: 'Reboot Now', action: () => { dialog.close(); this.switchProfile(profile, true); } }]);
        dialog.open();
    },
    switchProfile: function(profile, rebootNow) {
        try { let proc = new Gio.Subprocess({ argv: ['pkexec', 'prime-select', profile.command], flags: Gio.SubprocessFlags.NONE }); proc.init(null); } catch (e) { Util.spawn(['gnome-terminal', '--', 'bash', '-c', `sudo prime-select ${profile.command}; read`]); }
        if (rebootNow) {
            Mainloop.timeout_add_seconds(this.rebootDelay || 10, () => { Util.spawn(['systemctl', 'reboot']); return false; });
        }
        Mainloop.timeout_add_seconds(2, () => this.updateProfiles());
    }
};
