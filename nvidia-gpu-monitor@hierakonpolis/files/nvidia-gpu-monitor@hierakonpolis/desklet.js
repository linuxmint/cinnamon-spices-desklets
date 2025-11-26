const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Lang = imports.lang;

function NvidiaGPUDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

NvidiaGPUDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        
        this.metadata = metadata;
        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
        
        // Initialize default values first
        this.updateInterval = 0.2;
        this.dataPoints = 600;
        this.gpuIndex = 0;
        this.computeColor = '#88c0d0';
        this.memoryColor = '#d08770';
        this.tempColor = '#bf616a';
        this.showLegend = true;
        this.showTemperature = false;
        this.deskletWidth = 400;
        this.deskletHeight = 300;
        this.backgroundColor = '#2e3440';
        this.borderColor = '#5e81ac';
        this.transparency = 85;
        
        // Settings bindings
        this.settings.bindProperty(Settings.BindingDirection.IN, "update-interval", "updateInterval", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "data-points", "dataPoints", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "gpu-index", "gpuIndex", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "compute-color", "computeColor", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "memory-color", "memoryColor", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "temp-color", "tempColor", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-legend", "showLegend", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-temperature", "showTemperature", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-width", "deskletWidth", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-height", "deskletHeight", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "background-color", "backgroundColor", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "border-color", "borderColor", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "transparency", "transparency", this._onSettingsChanged, null);
        
        // Removed excessive logging for production
        
        // Data storage
        this.computeData = [];
        this.memoryData = [];
        this.temperatureData = [];
        this.gpuCount = 0;
        this.gpuNames = [];
        this.maxDataPoints = this.dataPoints || 600;
        this.nvidiaAvailable = false;
        this.errorCount = 0;
        
        // UI setup
        this._setupUI();
        this._detectGPUs();
        this._startMonitoring();
        
        // Initial style application
        this._updateContainerStyle();
        
        // Make resizable
        this.actor.set_reactive(true);
        this.actor.connect('button-press-event', Lang.bind(this, this._onButtonPress));
    },

    _setupUI: function() {
        // Main container
        this.window = new St.BoxLayout({
            vertical: true
        });
        this._updateContainerStyle();

        // Title
        this.titleLabel = new St.Label({
            text: 'NVIDIA GPU Monitor',
            style_class: 'nvidia-title'
        });
        this.window.add(this.titleLabel);

        // Canvas for plotting
        this.canvas = new St.DrawingArea({
            style_class: 'nvidia-plot-canvas',
            reactive: false
        });
        this.canvas.set_size(this.deskletWidth - 20 || 380, this.deskletHeight - 80 || 220);
        this.canvas.connect('repaint', Lang.bind(this, this._drawPlot));
        this.window.add(this.canvas, { expand: true, fill: true });

        // Legend
        this.legendBox = new St.BoxLayout({
            vertical: false,
            style_class: 'nvidia-legend'
        });
        
        if (this.showLegend !== false) {
            this._updateLegend();
            this.window.add(this.legendBox);
        }

        this.setContent(this.window);
    },

    _updateContainerStyle: function() {
        const bgColor = this._parseColor(this.backgroundColor || '#2e3440');
        const borderColor = this._parseColor(this.borderColor || '#5e81ac');
        const alpha = (this.transparency || 85) / 100;
        
        // Use solid background color and control transparency via actor opacity
        const bgColorStr = `rgb(${Math.round(bgColor.r * 255)}, ${Math.round(bgColor.g * 255)}, ${Math.round(bgColor.b * 255)})`;
        const borderColorStr = `rgba(${Math.round(borderColor.r * 255)}, ${Math.round(borderColor.g * 255)}, ${Math.round(borderColor.b * 255)}, 0.6)`;
        
        const styleString = `
            background-color: ${bgColorStr};
            border: 1px solid ${borderColorStr};
            border-radius: 6px;
            padding: 12px;
            width: ${this.deskletWidth || 400}px;
            height: ${this.deskletHeight || 300}px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
            transition: all 0.2s ease;
        `;
        
        this.window.set_style(styleString);
        
        // Set transparency via actor opacity - this is the proper Cinnamon way
        if (this.actor) {
            this.actor.set_opacity(Math.round(alpha * 255)); // Clutter uses 0-255 scale
        }
    },

    _updateLegend: function() {
        this.legendBox.destroy_all_children();
        
        if (!this.showLegend) return;

        const computeColor = this._ensureValidColor(this.computeColor || '#88c0d0');
        const memoryColor = this._ensureValidColor(this.memoryColor || '#d08770');
        
        const computeLabel = new St.Label({
            text: '■ Compute',
            style: `color: ${computeColor}; font-size: 11px; margin-right: 12px;`
        });
        const memoryLabel = new St.Label({
            text: '■ Memory', 
            style: `color: ${memoryColor}; font-size: 11px; margin-right: 12px;`
        });
        
        this.legendBox.add(computeLabel);
        this.legendBox.add(memoryLabel);

        if (this.showTemperature) {
            const tempColor = this._ensureValidColor(this.tempColor || '#bf616a');
            const tempLabel = new St.Label({
                text: '■ Temp °C',
                style: `color: ${tempColor}; font-size: 11px;`
            });
            this.legendBox.add(tempLabel);
        }
    },

    _ensureValidColor: function(colorStr) {
        // Ensure color has proper contrast and isn't too dark
        const color = this._parseColor(colorStr);
        const brightness = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;
        
        // If color is too dark (brightness < 0.3), lighten it
        if (brightness < 0.3) {
            const factor = 0.3 / Math.max(brightness, 0.01);
            color.r = Math.min(1, color.r * factor);
            color.g = Math.min(1, color.g * factor);
            color.b = Math.min(1, color.b * factor);
        }
        
        return `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
    },

    _detectGPUs: function() {
        try {
            let [result, stdout, stderr] = GLib.spawn_command_line_sync('nvidia-smi --list-gpus');
            if (result) {
                const gpuLines = stdout.toString().split('\n').filter(line => line.includes('GPU'));
                this.gpuCount = gpuLines.length;
                
                // Extract GPU names for better identification
                this.gpuNames = gpuLines.map(line => {
                    const match = line.match(/GPU \d+: (.+?) \(UUID/);
                    return match ? match[1] : `GPU ${this.gpuNames.length}`;
                });
                
                this.nvidiaAvailable = true;
                this.errorCount = 0;
                global.log(`NVIDIA Desklet: Detected ${this.gpuCount} GPU(s)`);
            } else {
                this._handleNvidiaError('nvidia-smi --list-gpus failed', stderr);
            }
        } catch (e) {
            this._handleNvidiaError('nvidia-smi not available', e.toString());
        }
    },

    _handleNvidiaError: function(message, details) {
        this.nvidiaAvailable = false;
        this.errorCount++;
        global.logError(`NVIDIA Desklet: ${message} - ${details}`);
        
        if (this.errorCount <= 3) {
            this.titleLabel.set_text('NVIDIA GPU: Not Available (nvidia-smi required)');
        }
        
        // Stop monitoring after repeated failures
        if (this.errorCount > 5 && this.updateLoop) {
            Mainloop.source_remove(this.updateLoop);
            this.updateLoop = null;
        }
    },

    _getNvidiaData: function() {
        if (!this.nvidiaAvailable) {
            return;
        }
        
        try {
            const gpuId = Math.min(this.gpuIndex || 0, Math.max(0, this.gpuCount - 1));
            let query = 'utilization.gpu,utilization.memory,memory.used,memory.total';
            
            if (this.showTemperature) {
                query += ',temperature.gpu';
            }
            
            const cmd = `nvidia-smi --query-gpu=${query} --format=csv,noheader,nounits -i ${gpuId}`;
            let [result, stdout, stderr] = GLib.spawn_command_line_sync(cmd);
            
            if (result && stdout.toString().trim()) {
                const values = stdout.toString().trim().split(',').map(v => parseFloat(v.trim()));
                
                const computeUsage = values[0] || 0;
                const memoryUsage = values[1] || 0;
                const memoryUsed = values[2] || 0;
                const memoryTotal = values[3] || 1;
                const temperature = this.showTemperature ? (values[4] || 0) : 0;
                
                // Store data points
                this.computeData.push(computeUsage);
                this.memoryData.push(memoryUsage);
                
                if (this.showTemperature) {
                    this.temperatureData.push(temperature);
                } else {
                    // Ensure temperature array stays empty when disabled
                    this.temperatureData = [];
                }
                
                // Maintain data point limit
                if (this.computeData.length > this.maxDataPoints) {
                    this.computeData.shift();
                    this.memoryData.shift();
                    if (this.showTemperature) {
                        this.temperatureData.shift();
                    }
                }
                
                // Update title with current values and GPU name
                const gpuName = this.gpuNames[gpuId] || `GPU ${gpuId}`;
                let titleText = `${gpuName}: ${computeUsage}% Compute | ${memoryUsage}% Mem (${Math.round(memoryUsed)}MB)`;
                if (this.showTemperature) {
                    titleText += ` | ${temperature}°C`;
                }
                this.titleLabel.set_text(titleText);
                
                // Reset error count on success
                this.errorCount = 0;
                
                // Trigger redraw
                this.canvas.queue_repaint();
            } else {
                this._handleNvidiaError('nvidia-smi query failed', stderr?.toString() || 'No output');
            }
        } catch (e) {
            this._handleNvidiaError('Error executing nvidia-smi', e.toString());
        }
    },

    _drawPlot: function(canvas) {
        const [width, height] = canvas.get_surface_size();
        const cr = canvas.get_context();
        
        // Clear background with subtle gradient
        const bgColor = this._parseColor(this.backgroundColor || '#2e3440');
        const alpha = Math.max(0.1, (this.transparency || 85) / 100 - 0.2);
        
        cr.setSourceRGBA(bgColor.r * 0.8, bgColor.g * 0.8, bgColor.b * 0.8, alpha);
        cr.rectangle(0, 0, width, height);
        cr.fill();
        
        if (this.computeData.length < 2) return;
        
        const margin = 15;
        const leftMargin = 25; // Extra space for left labels
        const rightMargin = this.showTemperature ? 35 : 15; // Extra space for temperature labels
        const plotWidth = width - leftMargin - rightMargin;
        const plotHeight = height - 2 * margin;
        
        // Draw subtle grid
        const gridColor = this._parseColor(this.borderColor || '#5e81ac');
        cr.setSourceRGBA(gridColor.r, gridColor.g, gridColor.b, 0.2);
        cr.setLineWidth(0.25);
        
        // Horizontal grid lines with percentage labels
        cr.setFontSize(9);
        for (let i = 0; i <= 4; i++) {
            const y = margin + (plotHeight * i / 4);
            const percentage = 100 - (i * 25);
            
            // Draw grid line
            cr.moveTo(leftMargin, y);
            cr.lineTo(width - rightMargin, y);
            cr.stroke();
            
            // Draw percentage label on left
            cr.setSourceRGBA(gridColor.r, gridColor.g, gridColor.b, 0.6);
            cr.moveTo(5, y + 3);
            cr.showText(`${percentage}%`);
            
            // Draw temperature label on right if temperature is enabled
            if (this.showTemperature) {
                // percentage goes 100%, 75%, 50%, 25%, 0% from top to bottom
                // We want 90°, 75°, 60°, 45°, 30° from top to bottom
                // So: tempValue = 90 - ((100 - percentage) / 100) * (90 - 30)
                const tempValue = 90 - ((100 - percentage) / 100) * (90 - 30);
                cr.moveTo(width - rightMargin + 5, y + 3);
                cr.showText(`${Math.round(tempValue)}°`);
            }
            
            cr.setSourceRGBA(gridColor.r, gridColor.g, gridColor.b, 0.2);
        }
        
        // Vertical grid lines
        for (let i = 0; i <= 4; i++) {
            const x = leftMargin + (plotWidth * i / 4);
            cr.moveTo(x, margin);
            cr.lineTo(x, height - margin);
            cr.stroke();
        }
        
        // Draw data lines with proper color handling
        const computeColorStr = this.computeColor || '#88c0d0';
        const memoryColorStr = this.memoryColor || '#d08770';
        
        // Draw usage lines with configured colors
        
        this._drawDataLine(cr, this.computeData, computeColorStr, leftMargin, plotWidth, plotHeight, 100);
        this._drawDataLine(cr, this.memoryData, memoryColorStr, leftMargin, plotWidth, plotHeight, 100);
        
        if (this.showTemperature && this.temperatureData.length > 0) {
            const tempColorStr = this.tempColor || '#bf616a';
            // Scale temperature from typical GPU range (30-90°C) to 0-100% for display
            // The right axis shows the actual temperature values
            const tempDataScaled = this.temperatureData.map(temp => {
                const minTemp = 30; // Minimum expected temp
                const maxTemp = 90; // Maximum expected temp
                return Math.max(0, Math.min(100, ((temp - minTemp) / (maxTemp - minTemp)) * 100));
            });
            this._drawDataLine(cr, tempDataScaled, tempColorStr, leftMargin, plotWidth, plotHeight, 100);
        }
    },

    _drawDataLine: function(cr, data, color, margin, plotWidth, plotHeight, maxValue) {
        if (data.length < 2) return;
        
        const colorObj = this._parseColor(color);
        
        // Ensure the color is visible by checking brightness
        const brightness = (colorObj.r * 0.299 + colorObj.g * 0.587 + colorObj.b * 0.114);
        if (brightness < 0.2) {
            // Lighten very dark colors
            const factor = 0.4 / Math.max(brightness, 0.01);
            colorObj.r = Math.min(1, colorObj.r * factor);
            colorObj.g = Math.min(1, colorObj.g * factor);
            colorObj.b = Math.min(1, colorObj.b * factor);
        }
        
        cr.setSourceRGBA(colorObj.r, colorObj.g, colorObj.b, 0.9);
        cr.setLineWidth(1.);
        
        cr.moveTo(margin, margin + plotHeight - (data[0] / maxValue) * plotHeight);
        
        for (let i = 1; i < data.length; i++) {
            const x = margin + (plotWidth * i / (data.length - 1));
            const y = margin + plotHeight - (data[i] / maxValue) * plotHeight;
            cr.lineTo(x, y);
        }
        
        cr.stroke();
    },

    _parseColor: function(colorStr) {
        if (!colorStr) {
            return { r: 0.5, g: 0.5, b: 0.5 };
        }

        if (colorStr.startsWith('rgb')) {
            const match = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (match) {
                return {
                    r: parseInt(match[1]) / 255,
                    g: parseInt(match[2]) / 255,
                    b: parseInt(match[3]) / 255
                };
            }
            return { r: 0.5, g: 0.5, b: 0.5 };
        }

        let hex = colorStr.toString().replace('#', '');

        // Handle 3-digit hex like #abc
        if (hex.length === 3) {
            hex = hex[0]+hex[0] + hex[1]+hex[1] + hex[2]+hex[2];
        }

        // Handle 6-digit hex
        if (hex.length === 6) {
            return {
                r: parseInt(hex.substr(0, 2), 16) / 255,
                g: parseInt(hex.substr(2, 2), 16) / 255,
                b: parseInt(hex.substr(4, 2), 16) / 255
            };
        }
        
        return { r: 0.5, g: 0.5, b: 0.5 };
    },

    _startMonitoring: function() {
        if (this.updateLoop) {
            Mainloop.source_remove(this.updateLoop);
        }
        
        const interval = Math.max(0.1, this.updateInterval || 0.2) * 1000;
        this.updateLoop = Mainloop.timeout_add(interval, Lang.bind(this, function() {
            this._getNvidiaData();
            return true;
        }));
        
        // Initial data fetch
        this._getNvidiaData();
    },


    _onSettingsChanged: function() {
        // Settings updated
        
        this.maxDataPoints = this.dataPoints || 600;
        
        // Clear temperature data if temperature was just enabled to avoid mismatched arrays
        if (this.showTemperature && this.temperatureData.length === 0 && this.computeData.length > 0) {
            // Fill temperature array with zeros to match other arrays
            this.temperatureData = new Array(this.computeData.length).fill(0);
        } else if (!this.showTemperature) {
            // Clear temperature data if temperature was disabled
            this.temperatureData = [];
        }
        
        // Update container style
        this._updateContainerStyle();
        
        // Resize canvas if dimensions changed
        if (this.canvas) {
            this.canvas.set_size(this.deskletWidth - 20 || 380, this.deskletHeight - 80 || 220);
        }
        
        this._updateLegend();
        this._startMonitoring();
        
        // Force a redraw
        if (this.canvas) {
            this.canvas.queue_repaint();
        }
    },

    _onButtonPress: function(actor, event) {
        // Handle resize or settings
        return false;
    },

    on_desklet_removed: function() {
        if (this.updateLoop) {
            Mainloop.source_remove(this.updateLoop);
        }
    }
};

function main(metadata, desklet_id) {
    return new NvidiaGPUDesklet(metadata, desklet_id);
}
