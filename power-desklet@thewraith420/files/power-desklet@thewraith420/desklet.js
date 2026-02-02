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
const Tweener = imports.ui.tweener;
const Cinnamon = imports.gi.Cinnamon;
let UISlider = null;

const HISTORY_DATA_FILE = GLib.get_home_dir() + '/.local/share/cinnamon/desklets/power-desklet@thewraith420/battery-history.json';
try {
    UISlider = imports.ui.slider;
} catch (e) {
    UISlider = null; // Older Cinnamon: slider not available
}

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

        // Power Info Panel Settings
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "show-power-info-panel", "show_power_info_panel", this._onLayoutChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "show-power-draw", "show_power_draw", this._onLayoutChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "show-charge-cycles", "show_charge_cycles", this._onLayoutChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "show-battery-health", "show_battery_health", this._onLayoutChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "info-panel-color", "info_panel_color", this._onAppearanceChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "info-panel-opacity", "info_panel_opacity", this._onAppearanceChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "data-retention-days", "data_retention_days", this._onDataRetentionChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "graph-zoom-days", "graphZoomDays", this._onGraphZoomChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "use-24hour-time", "use24HourTime", this._onGraphZoomChanged, null);

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
            if (this.show_power_info_panel === undefined) this.show_power_info_panel = true;
            if (this.show_power_draw === undefined) this.show_power_draw = true;
            if (this.show_charge_cycles === undefined) this.show_charge_cycles = true;
            if (this.show_battery_health === undefined) this.show_battery_health = true;
            if (!this.info_panel_color) this.info_panel_color = 'rgb(0, 0, 0)';
            if (this.info_panel_opacity === undefined) this.info_panel_opacity = 0.4;
            if (!this.data_retention_days) this.data_retention_days = 30;

            // Initialize power info values
            this.powerNow = 0;
            this.chargeCycles = 0;
            this.batteryHealth = 100;

            // Initialize power history for graph
            this.powerHistory = []; // Array of {power: watts, timestamp: unix_ms}
            this.batteryHistory = []; // Array of {percentage: 0-100, timestamp: unix_ms}
            // Calculate max data points based on retention days
            // updateInterval = 5 seconds, so 17280 points per day
            this.maxDataPoints = Math.max(100, (this.data_retention_days || 30) * 24 * 60 * 12); // 12 = 3600/300
            if (!this.graphZoomDays) this.graphZoomDays = 0.5; // Default to 12 hours
            this._updateGraphZoomLevel(); // Convert days to data points
            this.updateInterval = 5; // seconds between updates
            
            // Load persisted history from file
            this._loadHistoryFromFile();

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
        let isCompact = this.battery_display_mode === 'compact';
        let batterySection = new St.BoxLayout({
            vertical: this.battery_display_mode === 'vertical',
            style: `padding: ${isCompact ? 8 : 10}px; spacing: ${isCompact ? 8 : 12}px;`
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

        // Build floating info panel
        this.infoPanelSide = 'right';
        this.infoPanelWidth = 400;
        this._buildInfoPanel();
        this._hideInfoPanelImmediate();
    },

    _createBatteryBar: function() {
        let isCompact = this.battery_display_mode === 'compact';
        let batteryContainer = new St.BoxLayout({
            vertical: true,
            style: `spacing: ${isCompact ? 6 : 8}px; min-width: ${isCompact ? 160 : 200}px;`
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
            
            let barHeight = isCompact ? 12 : 18;
            let fillHeight = isCompact ? 8 : 14;
            let barWidth = isCompact ? 140 : 180;

            this.batteryBar = new St.Bin({
                style: `background-color: ${barBgColor}; border-radius: 10px; height: ${barHeight}px; min-width: ${barWidth}px;`
            });
            
            this.batteryBarFill = new St.Bin({
                style: `background-color: ${barFillColor}; border-radius: 8px; height: ${fillHeight}px; margin: 2px;`
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
        
        let singleRow = this.battery_display_mode === 'vertical';
        this.conservationButton = this.createActionButton(
            gridLayout, 0, singleRow ? 0 : 0, 
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
            gridLayout, 1, singleRow ? 0 : 0, 
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
            gridLayout, singleRow ? 2 : 0, singleRow ? 0 : 1, 
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

        let infoAccent = this.nvidia_accent_color || this.accent_color || 'rgb(33, 150, 243)';
        let infoMatch = infoAccent.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        let infoBg = infoMatch ? `rgba(${infoMatch[1]}, ${infoMatch[2]}, ${infoMatch[3]}, 0.25)` : infoAccent;
        let infoBorder = infoMatch ? `rgba(${infoMatch[1]}, ${infoMatch[2]}, ${infoMatch[3]}, 0.6)` : infoAccent;

        let batteryInfoButton = this.createActionButton(
            gridLayout, singleRow ? 3 : 1, singleRow ? 0 : 1, 
            "dialog-information-symbolic", 
            "Battery Info",
            infoBg,
            infoBorder
        );
        this.batteryInfoButton = batteryInfoButton;
        batteryInfoButton.connect('clicked', Lang.bind(this, function() {
            this._openBatteryInfoWindow();
        }));

        return gridContainer;
    },

    _openBatteryInfoWindow: function() {
        this._toggleInfoPanel();
    },

    _determinePanelSide: function() {
        try {
            let stageWidth = global.stage ? global.stage.width : 0;
            let [wx, wy] = this.window ? this.window.get_transformed_position() : [0, 0];
            let [ww, wh] = this.window ? this.window.get_transformed_size() : [0, 0];
            if (stageWidth > 0 && wx + ww + this.infoPanelWidth + 30 > stageWidth) {
                return 'left';
            }
        } catch (e) {}
        return 'right';
    },

    _buildInfoPanel: function() {
        if (this.infoPanel) return;

        let panelWidth = this.infoPanelWidth || 400;
        let graphWidth = panelWidth - 40;

        this.infoPanel = new St.BoxLayout({
            vertical: true,
            style: this._getInfoPanelStyle(),
            clip_to_allocation: true,
            reactive: true,
            can_focus: true
        });
        
        global.stage.add_actor(this.infoPanel);
        this.infoPanel.hide();
        this.infoPanel.set_opacity(0);
        
        // Capture all events on the panel to ensure they reach child elements
        this.infoPanel.connect('captured-event', Lang.bind(this, function(actor, event) {
            return Clutter.EVENT_PROPAGATE;
        }));

        // Create title bar
        let titleBox = new St.BoxLayout({
            vertical: false,
            style: 'margin-bottom: 6px;'
        });
        
        let titleLabel = new St.Label({
            text: 'Battery Information & History',
            style: `font-size: 14pt; 
                    font-weight: bold; 
                    color: ${this.accent_color || 'rgb(255, 255, 255)'};`,
            x_expand: true
        });
        titleBox.add_child(titleLabel);
        
        this.infoPanel.add_child(titleBox);

        let infoBox = new St.BoxLayout({
            vertical: true,
            style: `background-color: rgba(255, 255, 255, 0.07); 
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 6px; 
                    padding: 10px; 
                    spacing: 6px;`
        });

        if (this.show_power_draw) {
            this.infoPowerLabel = new St.Label({
                text: `Power Draw: ${this.powerNow} W`,
                style: `font-size: 10.5pt; 
                        color: ${this.accent_color};
                        opacity: 0.9;`
            });
            infoBox.add_child(this.infoPowerLabel);
        }

        if (this.show_charge_cycles) {
            this.infoCyclesLabel = new St.Label({
                text: `Charge Cycles: ${this.chargeCycles}`,
                style: `font-size: 10.5pt; 
                        color: ${this.accent_color};
                        opacity: 0.9;`
            });
            infoBox.add_child(this.infoCyclesLabel);
        }

        if (this.show_battery_health) {
            this.infoHealthLabel = new St.Label({
                text: `Battery Health: ${this.batteryHealth}%`,
                style: `font-size: 10.5pt; 
                        color: ${this.accent_color};
                        opacity: 0.9;`
            });
            infoBox.add_child(this.infoHealthLabel);
        }

        this.infoPanel.add_child(infoBox);

        let powerGraphLabel = new St.Label({
            text: 'Power Draw (Watts)',
            style: `font-size: 11.5pt; 
                    font-weight: bold; 
                    color: rgba(237, 76, 76, 0.9); 
                    margin-top: 6px;`
        });
        this.infoPanel.add_child(powerGraphLabel);

        this.modalPowerCanvas = new St.DrawingArea({
            style: 'border: 1px solid rgba(255,255,255,0.2);',
            width: graphWidth,
            height: 130
        });
        this.modalPowerCanvas.set_size(graphWidth, 130);
        this.modalPowerCanvas.connect("repaint", Lang.bind(this, this._drawPowerOnly));
        this.infoPanel.add_child(this.modalPowerCanvas);

        let batteryGraphLabel = new St.Label({
            text: 'Battery Level (%)',
            style: `font-size: 11.5pt; 
                    font-weight: bold; 
                    color: ${this.nvidia_accent_color ? this.nvidia_accent_color : 'rgb(118, 185, 0)'}; 
                    margin-top: 8px;`
        });
        this.infoPanel.add_child(batteryGraphLabel);

        this.modalBatteryCanvas = new St.DrawingArea({
            style: 'border: 1px solid rgba(255,255,255,0.2);',
            width: graphWidth,
            height: 130
        });
        this.modalBatteryCanvas.set_size(graphWidth, 130);
        this.modalBatteryCanvas.connect("repaint", Lang.bind(this, this._drawBatteryOnly));
        this.infoPanel.add_child(this.modalBatteryCanvas);
        
        this.debugLabel = new St.Label({
            text: `Power: ${this.powerHistory.length} points | Battery: ${this.batteryHistory.length} points`,
            style: 'font-size: 9pt; color: rgba(255,255,255,0.4); margin-top: 6px;'
        });
        this.infoPanel.add_child(this.debugLabel);
    },

    _refreshInfoPanel: function() {
        if (!this.infoPanel) return;
        if (this.infoPowerLabel) this.infoPowerLabel.set_text(`Power Draw: ${this.powerNow} W`);
        if (this.infoCyclesLabel) this.infoCyclesLabel.set_text(`Charge Cycles: ${this.chargeCycles}`);
        if (this.infoHealthLabel) this.infoHealthLabel.set_text(`Battery Health: ${this.batteryHealth}%`);
        if (this.debugLabel) this.debugLabel.set_text(`Power: ${this.powerHistory.length} points | Battery: ${this.batteryHistory.length} points`);
        if (this.zoomSlider && this.zoomSlider.setValue) {
            this.zoomSlider.setValue(this.graphZoomLevel / this.maxDataPoints);
        }
        this._updateZoomLabel();
        if (this.modalPowerCanvas) this.modalPowerCanvas.queue_repaint();
        if (this.modalBatteryCanvas) this.modalBatteryCanvas.queue_repaint();
    },

    _hideInfoPanelImmediate: function() {
        if (!this.infoPanel) return;
        this.infoPanel.hide();
        this.infoPanel.set_opacity(0);
        this.infoPanelVisible = false;
    },

    _toggleInfoPanel: function(forceShow) {
        if (!this.infoPanel) this._buildInfoPanel();
        if (!this.infoPanel || !this.window) return;

        let shouldShow = (typeof forceShow === 'boolean') ? forceShow : !this.infoPanelVisible;
        Tweener.removeTweens(this.infoPanel);

        if (shouldShow) {
            // Show panel first to get its actual size
            this.infoPanel.set_style(this._getInfoPanelStyle());
            this.infoPanel.show();
            this.infoPanel.raise_top();
            this.infoPanel.grab_key_focus();
            this._refreshInfoPanel();
            
            // Decide which side to open based on available space
            this.infoPanelSide = this._determinePanelSide();
            
            // Position panel next to desklet
            let [wx, wy] = this.window.get_transformed_position();
            let [ww, wh] = this.window.get_transformed_size();
            let [pw, ph] = this.infoPanel.get_size();
            
            let panelX, panelY;
            if (this.infoPanelSide === 'left') {
                panelX = wx - pw - 10;
            } else {
                panelX = wx + ww + 10;
            }
            panelY = wy;
            
            this.infoPanel.set_position(panelX, panelY);
            
            // Fade in animation
            this.infoPanel.set_opacity(0);
            Tweener.addTween(this.infoPanel, {
                opacity: 255,
                time: 0.25,
                transition: 'easeOutQuad',
                onComplete: Lang.bind(this, function() {
                    this.infoPanelVisible = true;
                    this._updateBatteryInfoButtonStyle();
                })
            });
        } else {
            // Fade out animation
            Tweener.addTween(this.infoPanel, {
                opacity: 0,
                time: 0.2,
                transition: 'easeOutQuad',
                onComplete: Lang.bind(this, function() {
                    this.infoPanel.hide();
                    this.infoPanelVisible = false;
                    this._updateBatteryInfoButtonStyle();
                })
            });
        }
    },

    _updateBatteryInfoButtonStyle: function() {
        if (!this.batteryInfoButton) return;
        this._updateButtonStyle(this.batteryInfoButton, "Battery Info");
    },

    _createPowerInfoPanel: function() {
        let powerInfoContainer = new St.BoxLayout({
            vertical: true,
            style: 'padding: 10px; spacing: 8px;'
        });

        let hasContent = false;

        // Power Draw
        if (this.show_power_draw) {
            this.powerDrawLabel = new St.Label({
                text: 'Power Draw: 0.0 W',
                style: this._getStatusStyle()
            });
            powerInfoContainer.add_child(this.powerDrawLabel);
            hasContent = true;
        }

        // Charge Cycles
        if (this.show_charge_cycles) {
            this.chargeCyclesLabel = new St.Label({
                text: 'Cycles: 0',
                style: this._getStatusStyle()
            });
            powerInfoContainer.add_child(this.chargeCyclesLabel);
            hasContent = true;
        }

        // Battery Health
        if (this.show_battery_health) {
            this.batteryHealthLabel = new St.Label({
                text: 'Health: 100.0%',
                style: this._getStatusStyle()
            });
            powerInfoContainer.add_child(this.batteryHealthLabel);
            hasContent = true;
        }

        return hasContent ? powerInfoContainer : null;
    },

    _getZoomText: function() {
        const totalSeconds = this.graphZoomLevel * this.updateInterval;
        if (totalSeconds < 60) {
            return totalSeconds + "s";
        } else if (totalSeconds < 3600) {
            const minutes = Math.floor(totalSeconds / 60);
            return minutes + "m";
        } else {
            const hours = Math.floor(totalSeconds / 3600);
            return hours + "h";
        }
    },
    
    _updateZoomLabel: function() {
        if (this.zoomStatusLabel) {
            this.zoomStatusLabel.set_text(this._getZoomText());
        }
    },
    
    _getTimeLabels: function(numPoints, interval) {
        // Get time labels for X-axis
        if (numPoints < 2) return [];
        
        const totalSeconds = numPoints * interval;
        let labels = [];
        
        if (totalSeconds <= 60) {
            // For under 1 minute, show every 10-15 seconds
            for (let i = 0; i < numPoints; i += Math.ceil(numPoints / 3)) {
                if (i < numPoints) {
                    const secondsAgo = (numPoints - 1 - i) * interval;
                    labels.push({x: i, label: secondsAgo + "s"});
                }
            }
        } else if (totalSeconds <= 600) {
            // For under 10 minutes, show every few minutes
            for (let i = 0; i < numPoints; i += Math.ceil(numPoints / 3)) {
                if (i < numPoints) {
                    const secondsAgo = (numPoints - 1 - i) * interval;
                    const minutes = Math.floor(secondsAgo / 60);
                    labels.push({x: i, label: minutes + "m"});
                }
            }
        } else {
            // For longer periods, show approximate times
            for (let i = 0; i < numPoints; i += Math.ceil(numPoints / 3)) {
                if (i < numPoints) {
                    const secondsAgo = (numPoints - 1 - i) * interval;
                    const minutes = Math.floor(secondsAgo / 60);
                    const hours = Math.floor(secondsAgo / 3600);
                    if (hours > 0) {
                        labels.push({x: i, label: hours + "h"});
                    } else {
                        labels.push({x: i, label: minutes + "m"});
                    }
                }
            }
        }
        
        // Ensure last point is "now"
        if (labels.length === 0 || labels[labels.length - 1].x !== numPoints - 1) {
            labels.push({x: numPoints - 1, label: "now"});
        }
        
        return labels;
    },

    _drawPowerOnly: function(canvas) {
        try {
            const [width, height] = canvas.get_surface_size();
            const cr = canvas.get_context();
            
            // Dark background
            cr.setSourceRGBA(0.1, 0.1, 0.1, 0.5);
            cr.rectangle(0, 0, width, height);
            cr.fill();
            
            let data = this.powerHistory;
            
            // Apply zoom - show last N points
            let startIdx = Math.max(0, data.length - this.graphZoomLevel);
            data = data.slice(startIdx);
            
            if (data.length < 1) {
                // Not enough data yet
                cr.setSourceRGBA(1, 1, 1, 0.7);
                cr.selectFontFace("Sans", Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
                cr.setFontSize(12);
                cr.moveTo(width / 2 - 80, height / 2);
                cr.showText("Collecting data... (" + this.powerHistory.length + " points)");
                return;
            }

            const leftMargin = 40;
            const rightMargin = 15;
            const topMargin = 20;
            const bottomMargin = 40;
            const plotWidth = width - leftMargin - rightMargin;
            const plotHeight = height - topMargin - bottomMargin;

            // Extract power values from data objects
            let powerValues = data.map(d => d.power || 0);
            const maxValue = Math.max(...powerValues);
            const minValue = Math.min(...powerValues);
            const range = maxValue - minValue;
            const actualMax = maxValue + (range * 0.2);
            const actualMin = Math.max(0, minValue - (range * 0.1));

            // Draw grid and Y-axis labels
            const gridLevels = this._getGridLevels(actualMax);
            for (let level of gridLevels) {
                const y = topMargin + plotHeight - ((level - actualMin) / (actualMax - actualMin)) * plotHeight;
                
                cr.setSourceRGBA(1, 1, 1, 0.1);
                cr.setLineWidth(1);
                cr.moveTo(leftMargin, y);
                cr.lineTo(leftMargin + plotWidth, y);
                cr.stroke();
                
                cr.setSourceRGBA(1, 1, 1, 0.6);
                cr.setFontSize(9);
                cr.moveTo(5, y + 2);
                cr.showText(level + "W");
            }

            // Draw X-axis time labels using timestamps
            const timeLabels = this._getTimeLabelsFromData(data);
            for (let label of timeLabels) {
                const x = leftMargin + (plotWidth * label.x) / (data.length - 1);
                cr.setSourceRGBA(1, 1, 1, 0.6);
                cr.setFontSize(8);
                cr.moveTo(x - 10, topMargin + plotHeight + 15);
                cr.showText(label.label);
            }

            // Draw power line (red/orange)
            cr.setSourceRGBA(0.93, 0.33, 0.33, 0.9);
            cr.setLineWidth(2.5);
            
            for (let i = 0; i < data.length; i++) {
                const x = leftMargin + (plotWidth * i) / (data.length - 1);
                const value = data[i].power || 0;
                const y = topMargin + plotHeight - ((value - actualMin) / (actualMax - actualMin)) * plotHeight;
                
                if (i === 0) {
                    cr.moveTo(x, y);
                } else {
                    cr.lineTo(x, y);
                }
            }
            cr.stroke();
        } catch (e) {
            global.logError("Power graph rendering error: " + e);
        }
    },

    _drawBatteryOnly: function(canvas) {
        try {
            const [width, height] = canvas.get_surface_size();
            const cr = canvas.get_context();
            
            // Dark background
            cr.setSourceRGBA(0.1, 0.1, 0.1, 0.5);
            cr.rectangle(0, 0, width, height);
            cr.fill();
            
            let data = this.batteryHistory;
            
            // Apply zoom - show last N points
            let startIdx = Math.max(0, data.length - this.graphZoomLevel);
            data = data.slice(startIdx);
            
            if (data.length < 1) {
                // Not enough data yet
                cr.setSourceRGBA(1, 1, 1, 0.7);
                cr.selectFontFace("Sans", Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
                cr.setFontSize(12);
                cr.moveTo(width / 2 - 80, height / 2);
                cr.showText("Collecting data... (" + this.batteryHistory.length + " points)");
                return;
            }

            const leftMargin = 40;
            const rightMargin = 15;
            const topMargin = 20;
            const bottomMargin = 40;
            const plotWidth = width - leftMargin - rightMargin;
            const plotHeight = height - topMargin - bottomMargin;

            // Battery is always 0-100%
            const gridLevels = [0, 25, 50, 75, 100];
            
            // Draw grid and Y-axis labels
            for (let level of gridLevels) {
                const y = topMargin + plotHeight - (level / 100) * plotHeight;
                
                cr.setSourceRGBA(1, 1, 1, 0.1);
                cr.setLineWidth(1);
                cr.moveTo(leftMargin, y);
                cr.lineTo(leftMargin + plotWidth, y);
                cr.stroke();
                
                cr.setSourceRGBA(1, 1, 1, 0.6);
                cr.setFontSize(9);
                cr.moveTo(5, y + 2);
                cr.showText(level + "%");
            }

            // Draw X-axis time labels using timestamps
            const timeLabels = this._getTimeLabelsFromData(data);
            for (let label of timeLabels) {
                const x = leftMargin + (plotWidth * label.x) / (data.length - 1);
                cr.setSourceRGBA(1, 1, 1, 0.6);
                cr.setFontSize(8);
                cr.moveTo(x - 10, topMargin + plotHeight + 15);
                cr.showText(label.label);
            }

            // Draw battery line (green)
            let nvidiaColor = this.nvidia_accent_color || 'rgb(118, 185, 0)';
            let nvidiaRgb = this._parseColor(nvidiaColor);
            cr.setSourceRGBA(nvidiaRgb.r, nvidiaRgb.g, nvidiaRgb.b, 0.9);
            cr.setLineWidth(2.5);
            
            for (let i = 0; i < data.length; i++) {
                const x = leftMargin + (plotWidth * i) / (data.length - 1);
                const value = data[i].percentage || 0;
                const y = topMargin + plotHeight - (value / 100) * plotHeight;
                
                if (i === 0) {
                    cr.moveTo(x, y);
                } else {
                    cr.lineTo(x, y);
                }
            }
            cr.stroke();
        } catch (e) {
            global.logError("Battery graph rendering error: " + e);
        }
    },

    _drawPowerGraph: function(canvas) {
        try {
            const [width, height] = canvas.get_surface_size();
            const cr = canvas.get_context();
            
            // Dark background
            cr.setSourceRGBA(0.1, 0.1, 0.1, 0.5);
            cr.rectangle(0, 0, width, height);
            cr.fill();
            
            if (this.powerHistory.length < 2) {
                // Not enough data yet
                cr.setSourceRGBA(1, 1, 1, 0.7);
                cr.selectFontFace("Sans", Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
                cr.setFontSize(14);
                cr.moveTo(width / 2 - 100, height / 2);
                cr.showText("Collecting data... (" + this.powerHistory.length + " points)");
                return;
            }

            const data = this.powerHistory;
            const leftMargin = 40;
            const rightMargin = 15;
            const topMargin = 35;
            const bottomMargin = 35;
            const plotWidth = width - leftMargin - rightMargin;
            const plotHeight = height - topMargin - bottomMargin;

            const maxValue = Math.max(...data);
            const minValue = Math.min(...data);
            const range = maxValue - minValue;
            const actualMax = maxValue + (range * 0.2); // 20% padding
            const actualMin = Math.max(0, minValue - (range * 0.1)); // 10% padding, but not below 0
            
            global.log("Drawing graph: " + data.length + " points, range: " + actualMin + "-" + actualMax + "W");

            // Draw grid
            const gridLevels = this._getGridLevels(actualMax);
            for (let level of gridLevels) {
                const y = topMargin + plotHeight - ((level - actualMin) / (actualMax - actualMin)) * plotHeight;
                
                cr.setSourceRGBA(1, 1, 1, 0.1);
                cr.setLineWidth(1);
                cr.moveTo(leftMargin, y);
                cr.lineTo(leftMargin + plotWidth, y);
                cr.stroke();
                
                cr.setSourceRGBA(1, 1, 1, 0.6);
                cr.setFontSize(10);
                cr.moveTo(5, y + 3);
                cr.showText(level + "W");
            }

            // Draw power data line (red/orange)
            cr.setSourceRGBA(0.93, 0.33, 0.33, 0.9); // Red/orange for power
            cr.setLineWidth(2);
            
            for (let i = 0; i < data.length; i++) {
                const x = leftMargin + (plotWidth * i) / (data.length - 1);
                const y = topMargin + plotHeight - ((data[i] - actualMin) / (actualMax - actualMin)) * plotHeight;
                
                if (i === 0) {
                    cr.moveTo(x, y);
                } else {
                    cr.lineTo(x, y);
                }
            }
            cr.stroke();
            
            // Draw battery percentage line (green) - uses right scale (0-100%)
            if (this.batteryHistory.length > 1) {
                let nvidiaColor = this.nvidia_accent_color || 'rgb(118, 185, 0)';
                let nvidiaRgb = this._parseColor(nvidiaColor);
                cr.setSourceRGBA(nvidiaRgb.r, nvidiaRgb.g, nvidiaRgb.b, 0.9);
                cr.setLineWidth(2);
                
                for (let i = 0; i < this.batteryHistory.length; i++) {
                    const x = leftMargin + (plotWidth * i) / (this.batteryHistory.length - 1);
                    // Scale battery (0-100%) to graph height
                    const y = topMargin + plotHeight - (this.batteryHistory[i] / 100) * plotHeight;
                    
                    if (i === 0) {
                        cr.moveTo(x, y);
                    } else {
                        cr.lineTo(x, y);
                    }
                }
                cr.stroke();
            }
            
            // Draw legend
            cr.setFontSize(11);
            cr.setSourceRGBA(0.93, 0.33, 0.33, 0.9);
            cr.moveTo(leftMargin, topMargin - 15);
            cr.showText("Power (W)");
            
            let nvidiaRgb2 = this._parseColor(this.nvidia_accent_color || 'rgb(118, 185, 0)');
            cr.setSourceRGBA(nvidiaRgb2.r, nvidiaRgb2.g, nvidiaRgb2.b, 0.9);
            cr.moveTo(leftMargin + 100, topMargin - 15);
            cr.showText("Battery (%)")
                
        } catch (e) {
            global.logError("Graph rendering error: " + e);
        }
    },

    _drawGraphGrid: function(cr, gridLevels, margin, plotWidth, plotHeight, actualMax) {
        // Draw horizontal grid lines and y-axis labels
        for (let level of gridLevels) {
            const y = margin + plotHeight - (level / actualMax) * plotHeight;

            // Draw grid line
            cr.setSourceRGBA(1, 1, 1, 0.1);
            cr.setLineWidth(1);
            cr.moveTo(margin, y);
            cr.lineTo(margin + plotWidth, y);
            cr.stroke();

            // Draw label
            cr.setSourceRGBA(1, 1, 1, 0.6);
            cr.setFontSize(10);
            const labelText = level + "W";
            const extents = cr.textExtents(labelText);
            cr.moveTo(margin - extents.width - 5, y + 4);
            cr.showText(labelText);
        }
    },

    _getGridLevels: function(maxValue) {
        if (maxValue <= 20) {
            return [0, 5, 10, 15];
        } else if (maxValue <= 40) {
            return [0, 10, 20, 30];
        } else if (maxValue <= 60) {
            return [0, 15, 30, 45, 60];
        } else if (maxValue <= 80) {
            return [0, 20, 40, 60, 80];
        } else if (maxValue <= 100) {
            return [0, 25, 50, 75, 100];
        } else {
            const gridMax = Math.ceil(maxValue / 20) * 20;
            const step = gridMax / 4;
            return [0, step, step * 2, step * 3, gridMax];
        }
    },

    _drawGraphData: function(cr, data, margin, plotHeight, plotWidth, actualMax) {
        // Get NVIDIA color
        let nvidiaColor = this.nvidia_accent_color || 'rgb(118, 185, 0)';
        let nvidiaRgb = this._parseColor(nvidiaColor);
        
        // Draw gradient fill under curve
        cr.moveTo(margin, margin + plotHeight - (data[0] / actualMax) * plotHeight);

        for (let i = 1; i < data.length; i++) {
            const x = margin + (plotWidth * i) / (data.length - 1);
            const y = margin + plotHeight - (data[i] / actualMax) * plotHeight;
            cr.lineTo(x, y);
        }

        // Close path for fill
        const lastX = margin + plotWidth;
        const bottomY = margin + plotHeight;
        cr.lineTo(lastX, bottomY);
        cr.lineTo(margin, bottomY);
        cr.closePath();

        // Create gradient and fill
        const gradient = new Cairo.LinearGradient(0, margin, 0, margin + plotHeight);
        gradient.addColorStopRGBA(0, nvidiaRgb.r, nvidiaRgb.g, nvidiaRgb.b, 0.5);
        gradient.addColorStopRGBA(1, nvidiaRgb.r, nvidiaRgb.g, nvidiaRgb.b, 0.05);

        cr.setSource(gradient);
        cr.fill();

        // Draw line on top
        cr.newPath();
        cr.moveTo(margin, margin + plotHeight - (data[0] / actualMax) * plotHeight);

        for (let i = 1; i < data.length; i++) {
            const x = margin + (plotWidth * i) / (data.length - 1);
            const y = margin + plotHeight - (data[i] / actualMax) * plotHeight;
            cr.lineTo(x, y);
        }

        cr.setSourceRGBA(nvidiaRgb.r, nvidiaRgb.g, nvidiaRgb.b, 0.9);
        cr.setLineWidth(2);
        cr.stroke();
    },

    _parseColor: function(colorStr) {
        if (!colorStr) {
            return { r: 0.5, g: 0.5, b: 0.5 };
        }

        if (colorStr.startsWith("rgb")) {
            const match = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (match) {
                return {
                    r: parseInt(match[1]) / 255,
                    g: parseInt(match[2]) / 255,
                    b: parseInt(match[3]) / 255,
                };
            }
            return { r: 0.5, g: 0.5, b: 0.5 };
        }

        let hex = colorStr.toString().replace("#", "");
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }

        if (hex.length === 6) {
            return {
                r: parseInt(hex.substr(0, 2), 16) / 255,
                g: parseInt(hex.substr(2, 2), 16) / 255,
                b: parseInt(hex.substr(4, 2), 16) / 255,
            };
        }

        return { r: 0.5, g: 0.5, b: 0.5 };
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
        // Try multiple methods to get GUI password prompt
        // Method 1: Try pkexec with explicit display and X authority
        // Method 2: Fallback to gnome-terminal with sudo
        
        let display = GLib.getenv('DISPLAY');
        let xauthority = GLib.getenv('XAUTHORITY');
        
        // Use pkexec with environment variables set for better GUI interaction
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
            // Show notification with countdown
            Util.spawn(['notify-send', 
                'NVIDIA Prime', 
                'Switching to ' + profile.name + ' mode. Rebooting in ' + this.rebootDelay + ' seconds...',
                '-i', 'nvidia-settings',
                '-u', 'critical',
                '-t', (this.rebootDelay * 1000).toString()]);
            
            // Create a dialog with reboot countdown and options - matching desklet styling
            let rebootDialog = new ModalDialog.ModalDialog();
            let bgColor = this.background_color || 'rgb(30, 30, 35)';
            let bgOpacity = this.background_opacity || 0.95;
            let accentColor = this.accent_color || 'rgb(255, 255, 255)';
            let nvidiaColor = this.nvidia_accent_color || 'rgb(118, 185, 0)';
            let radius = this.border_radius || 12;
            
            // Parse RGB colors
            let bgRgbMatch = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            let bgStyle = bgRgbMatch ? 
                `rgba(${bgRgbMatch[1]}, ${bgRgbMatch[2]}, ${bgRgbMatch[3]}, ${bgOpacity})` : bgColor;
            
            rebootDialog.contentLayout.set_style(`background-color: ${bgStyle}; border-radius: ${radius}px; border: 2px solid ${nvidiaColor}; padding: 20px; min-width: 400px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);`);
            
            this.secondsRemaining = this.rebootDelay;
            let rebootLabel = new St.Label({
                text: 'Profile switch in progress...\n\nSystem will reboot in ' + this.secondsRemaining + ' seconds.',
                style: `font-size: 12pt; padding: 20px; color: ${accentColor}; text-align: center;`
            });
            rebootDialog.contentLayout.add(rebootLabel);
            
            // Update countdown every second
            this.countdownInterval = Mainloop.timeout_add_seconds(1, Lang.bind(this, function() {
                this.secondsRemaining--;
                rebootLabel.set_text('Profile switch in progress...\n\nSystem will reboot in ' + this.secondsRemaining + ' seconds.');
                
                if (this.secondsRemaining <= 0) {
                    return false; // Stop the interval
                }
                return true; // Continue the interval
            }));
            
            rebootDialog.setButtons([
                {
                    label: 'Cancel Reboot',
                    action: Lang.bind(this, function() {
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
                    }),
                    style: `background-color: rgba(255, 255, 255, 0.08); color: ${accentColor}; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 10px 20px; font-size: 11pt; transition-duration: 150ms;`
                },
                {
                    label: 'Reboot Now',
                    action: Lang.bind(this, function() {
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
                    }),
                    style: `background-color: ${nvidiaColor}; color: #ffffff; border: 2px solid ${nvidiaColor}; border-radius: 8px; padding: 10px 20px; font-size: 11pt; font-weight: bold;`
                }
            ]);
            
            rebootDialog.open();
            
            // Wait for configured delay then reboot automatically
            this.rebootTimeout = Mainloop.timeout_add_seconds(this.rebootDelay, Lang.bind(this, function() {
                if (this.countdownInterval) {
                    Mainloop.source_remove(this.countdownInterval);
                    this.countdownInterval = null;
                }
                rebootDialog.close();
                Util.spawn(['systemctl', 'reboot']);
                this.rebootTimeout = null;
                return false;
            }));
        } else {
            // Show notification for deferred reboot scenario
            Util.spawn(['notify-send', 
                'NVIDIA Prime', 
                'Switching to ' + profile.name + ' mode. Please reboot for changes to take effect.',
                '-i', 'nvidia-settings']);
            
            // Update after a short delay
            Mainloop.timeout_add_seconds(2, Lang.bind(this, this.updateNvidiaProfiles));
        }
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
                       (label === "Rapid" && this.rapid_charge_enabled) ||
                       (label === "Battery Info" && this.infoPanelVisible);
        
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

    _onDataRetentionChanged: function() {
        // Recalculate max data points when retention setting changes
        this.maxDataPoints = Math.max(100, (this.data_retention_days || 30) * 24 * 60 * 12);
        if (!this.graphZoomDays) this.graphZoomDays = 1;
        this._updateGraphZoomLevel();
        global.log("Data retention changed to " + this.data_retention_days + " days, max points: " + this.maxDataPoints);
    },

    _onGraphZoomChanged: function() {
        // Convert days to data points
        this._updateGraphZoomLevel();
        // Repaint graphs if visible
        if (this.infoPanel && this.infoPanel.visible) {
            if (this.modalPowerCanvas) this.modalPowerCanvas.queue_repaint();
            if (this.modalBatteryCanvas) this.modalBatteryCanvas.queue_repaint();
        }
    },

    _updateGraphZoomLevel: function() {
        // Convert graphZoomDays to graphZoomLevel (data points)
        // 5 second intervals = 17280 points per day
        let pointsPerDay = 24 * 60 * 12;
        this.graphZoomLevel = Math.min(
            Math.max(10, Math.floor((this.graphZoomDays || 1) * pointsPerDay)),
            this.maxDataPoints
        );
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

    _getInfoPanelStyle: function() {
        let opacity = this.info_panel_opacity || 0.4;
        let bgColor = this.info_panel_color || 'rgb(0, 0, 0)';
        let rgbMatch = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        let rgba = bgColor;
        if (rgbMatch) {
            rgba = `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${opacity})`;
        }

        return `spacing: 10px; 
                padding: 14px;
                width: ${this.infoPanelWidth || 400}px;
                background-color: ${rgba};
                border-radius: 8px; 
                border: 1px solid rgba(255, 255, 255, 0.12);
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);`;
    },

    _getPercentageStyle: function() {
        let color = this.accent_color || 'rgb(255, 255, 255)';
        let size = this.font_size || 42;
        if (this.battery_display_mode === 'compact') {
            size = Math.round(size * 0.75);
        }
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

    _loadHistoryFromFile: function() {
        try {
            let file = Gio.file_new_for_path(HISTORY_DATA_FILE);
            if (!file.query_exists(null)) {
                return; // No saved history yet
            }
            
            let [ok, contents] = file.load_contents(null);
            if (!ok) return;
            
            let data = JSON.parse(ByteArray.toString(contents));
            
            // Load power history
            if (data.powerHistory && Array.isArray(data.powerHistory)) {
                this.powerHistory = data.powerHistory;
            }
            
            // Load battery history  
            if (data.batteryHistory && Array.isArray(data.batteryHistory)) {
                this.batteryHistory = data.batteryHistory;
            }
            
            global.log("Loaded " + this.powerHistory.length + " power readings and " + this.batteryHistory.length + " battery readings from file");
        } catch (e) {
            global.logError("Failed to load history: " + e);
        }
    },

    _saveHistoryToFile: function() {
        try {
            let dir = Gio.file_new_for_path(GLib.get_home_dir() + '/.local/share/cinnamon/desklets/power-desklet@thewraith420');
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }
            
            let data = {
                powerHistory: this.powerHistory,
                batteryHistory: this.batteryHistory,
                savedAt: new Date().getTime()
            };
            
            let file = Gio.file_new_for_path(HISTORY_DATA_FILE);
            file.replace_contents(JSON.stringify(data), null, false, Gio.FileCreateFlags.NONE, null);
        } catch (e) {
            global.logError("Failed to save history: " + e);
        }
    },

    _getTimeLabelFromTimestamp: function(timestamp) {
        let date = new Date(timestamp);
        let hours = date.getHours();
        let minutes = String(date.getMinutes()).padStart(2, '0');
        
        if (this.use24HourTime) {
            // 24-hour format
            return String(hours).padStart(2, '0') + ':' + minutes;
        } else {
            // 12-hour format with AM/PM
            let period = hours >= 12 ? 'PM' : 'AM';
            let displayHours = hours % 12;
            if (displayHours === 0) displayHours = 12;
            return displayHours + ':' + minutes + ' ' + period;
        }
    },

    _getTimeLabelsFromData: function(dataArray) {
        // Generate time labels from actual timestamps in data
        if (dataArray.length < 2) return [];
        
        let labels = [];
        const now = new Date().getTime();
        const timeSpanMs = this.graphZoomDays * 24 * 60 * 60 * 1000; // milliseconds
        const oldestTime = now - timeSpanMs;
        
        // Show 3-4 evenly spaced time labels
        const stepSize = Math.ceil(dataArray.length / 3);
        for (let i = 0; i < dataArray.length; i += stepSize) {
            if (dataArray[i] && dataArray[i].timestamp) {
                labels.push({
                    x: i,
                    label: this._getTimeLabelFromTimestamp(dataArray[i].timestamp)
                });
            }
        }
        
        // Always show current time at the end
        if (dataArray[dataArray.length - 1] && dataArray[dataArray.length - 1].timestamp) {
            labels.push({
                x: dataArray.length - 1,
                label: this._getTimeLabelFromTimestamp(dataArray[dataArray.length - 1].timestamp)
            });
        }
        
        return labels;
    },

    _update: function() {
        const ENERGY_NOW = "/sys/class/power_supply/BAT1/energy_now";
        const ENERGY_FULL = "/sys/class/power_supply/BAT1/energy_full";
        const POWER_NOW = "/sys/class/power_supply/BAT1/power_now";
        const STATUS = "/sys/class/power_supply/BAT1/status";
        const CONSERVATION_FILE = "/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode";
        const RAPID_CHARGE_FILE = "/sys/bus/platform/drivers/legion/PNP0C09:00/rapidcharge";

        // Save history periodically
        if (!this._lastHistorySaveTime || new Date().getTime() - this._lastHistorySaveTime > 60000) {
            this._saveHistoryToFile();
            this._lastHistorySaveTime = new Date().getTime();
        }
        try {
            let energyNow = parseInt(this._readFromFile(ENERGY_NOW));
            let energyFull = parseInt(this._readFromFile(ENERGY_FULL));
            let status = this._readFromFile(STATUS).trim();
            let percentage = energyFull > 0 ? Math.round((energyNow / energyFull) * 100) : 0;
            
            this.percentageLabel.set_text(percentage + "%");
            this._updateBatteryBar(percentage);
            
            // Add to battery history for graph with timestamp
            this.batteryHistory.push({
                percentage: percentage,
                timestamp: new Date().getTime()
            });
            if (this.batteryHistory.length > this.maxDataPoints) {
                this.batteryHistory.shift();
            }

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

            // Always read power draw for graph
            this._readPowerNow();
            
            // Read other battery info if settings enabled
            if (this.show_charge_cycles) this._readChargeCycles();
            if (this.show_battery_health) this._readBatteryHealth();
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

    _readPowerNow: function() {
        try {
            const POWER_NOW = "/sys/class/power_supply/BAT1/power_now";
            let powerValue = parseInt(this._readFromFile(POWER_NOW));
            this.powerNow = (powerValue / 1000 / 1000).toFixed(1); // Convert μW to W
            if (this.powerDrawLabel) {
                this.powerDrawLabel.set_text('Power Draw: ' + this.powerNow + ' W');
            }

            // Add to power history for graph with timestamp
            const powerNum = parseFloat(this.powerNow);
            this.powerHistory.push({
                power: powerNum,
                timestamp: new Date().getTime()
            });
            
            if (this.powerHistory.length > this.maxDataPoints) {
                this.powerHistory.shift();
            }

            // Repaint modal graphs if they're open
            if (this.modalPowerCanvas) {
                this.modalPowerCanvas.queue_repaint();
            }
            if (this.modalBatteryCanvas) {
                this.modalBatteryCanvas.queue_repaint();
            }
            if (this.infoPanelVisible) {
                this._refreshInfoPanel();
            }
        } catch (e) {
            global.logError("Failed to read power now: " + e);
        }
    },

    _readChargeCycles: function() {
        try {
            const CYCLE_COUNT = "/sys/class/power_supply/BAT1/cycle_count";
            this.chargeCycles = parseInt(this._readFromFile(CYCLE_COUNT));
            if (this.chargeCyclesLabel) {
                this.chargeCyclesLabel.set_text('Cycles: ' + this.chargeCycles);
            }
            if (this.infoPanelVisible) {
                this._refreshInfoPanel();
            }
        } catch (e) {
            // Not all batteries report cycle count
            if (this.chargeCyclesLabel) {
                this.chargeCyclesLabel.set_text('Cycles: N/A');
            }
        }
    },

    _readBatteryHealth: function() {
        try {
            const ENERGY_FULL = "/sys/class/power_supply/BAT1/energy_full";
            const ENERGY_FULL_DESIGN = "/sys/class/power_supply/BAT1/energy_full_design";
            
            let energyFull = parseInt(this._readFromFile(ENERGY_FULL));
            let energyFullDesign = parseInt(this._readFromFile(ENERGY_FULL_DESIGN));
            
            if (energyFullDesign > 0) {
                this.batteryHealth = ((energyFull / energyFullDesign) * 100).toFixed(1);
            } else {
                this.batteryHealth = 100;
            }
            
            if (this.batteryHealthLabel) {
                this.batteryHealthLabel.set_text('Health: ' + this.batteryHealth + '%');
            }
            if (this.infoPanelVisible) {
                this._refreshInfoPanel();
            }
        } catch (e) {
            // Fallback if files not available
            this.batteryHealth = 100;
            if (this.batteryHealthLabel) {
                this.batteryHealthLabel.set_text('Health: N/A');
            }
        }
    },

    on_desklet_removed: function() {
        if (this.timeout) Mainloop.source_remove(this.timeout);
        if (this.infoPanel && global.stage) {
            global.stage.remove_actor(this.infoPanel);
            this.infoPanel.destroy();
        }
    }
};
