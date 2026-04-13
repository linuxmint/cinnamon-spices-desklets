const ByteArray = imports.byteArray;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Cairo = imports.cairo;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;

MyDesklet.prototype = {
  __proto__: Desklet.Desklet.prototype,

  _init: function (metadata, desklet_id) {
    Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

    // default values
    this.backgroundColor = "#2e3440";
    this.borderColor = "#5e81ac";
    this.chargingColor = "#a6da95";
    this.dischargingColor = "#ed8796";
    this.headerText = "Watt Watcher";
    this.widgetMarginFromCss = 30; // css style implies 15px margin on each side

    // initialize settings
    this.settings = new Settings.DeskletSettings(
      this,
      this.metadata["uuid"],
      desklet_id
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "refresh-interval",
      "refresh_interval",
      this._on_setting_changed
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "power-source",
      "powerSourceId",
      this._on_setting_changed
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "show-status-bar",
      "showStatusBar",
      this._on_setting_changed
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "data-points",
      "maxDataPoints",
      this._on_setting_changed
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "desklet-width",
      "deskletWidth",
      this._on_setting_changed
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "desklet-height",
      "deskletHeight",
      this._on_setting_changed
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "transparency",
      "transparency",
      this._on_setting_changed
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "background-color",
      "backgroundColor",
      this._on_setting_changed
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "border-color",
      "borderColor",
      this._on_setting_changed
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "charging-color",
      "chargingColor",
      this._on_setting_changed
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "discharging-color",
      "dischargingColor",
      this._on_setting_changed
    );

    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "data-line-style",
      "dataLineStyle",
      this._on_setting_changed
    );

    this.powerNow = 0;
    this.energyFull = 0;
    this.timeLeftString = "(00:00)";
    this.isCharging = 0;

    // data source
    this._updateFilePaths();

    // init data arrays
    this.powerRateVals = [];
    this.isChargingVals = [];

    // style application
    this._setupUI();
    this._updateContainerStyle();
  },

  _updateContainerStyle: function () {
    const styleString = `
        background-color: ${this.backgroundColor};
        border: 1px solid ${this.borderColor};
        border-radius: 6px;
        padding: 12px;
        width: ${this.deskletWidth - this.widgetMarginFromCss || 700}px;
        height: ${this.deskletHeight - this.widgetMarginFromCss || 300}px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        transition: all 0.2s ease;
        `;

    this.mainBox.set_style(styleString);

    if (this.actor) {
      const alpha = (this.transparency || 85) / 100;
      this.actor.set_opacity(Math.round(alpha * 255));
    }
  },

  _setupUI: function () {
    this.mainBox = new St.BoxLayout({ vertical: true });

    // Header Text
    this.headerLabel = new St.Label({
      text: `${this.headerText}: ${this.powerSourceId}`,
      style_class: "header-bar",
    });
    this.mainBox.add(this.headerLabel);

    this.canvas = new St.DrawingArea({
      style_class: "drawing-area",
      reactive: false,
    });

    let statusBarMargin = 45;
    if (this.showStatusBar == 0) {
      statusBarMargin = 25;
    }

    this.canvas.set_size(
      this.deskletWidth - this.widgetMarginFromCss || 380,
      this.deskletHeight - this.widgetMarginFromCss - statusBarMargin
    );
    this.canvas.connect("repaint", Lang.bind(this, this._drawPlot));
    this.mainBox.add(this.canvas);

    if (this.showStatusBar) {
      this.statusBar = new St.BoxLayout({ vertical: false });
      this.mainBox.add(this.statusBar);
    }

    this.setContent(this.mainBox);
    this.actor.set_reactive(true);
    this.update();
  },

  update: function () {
    this.setAllDataValues();
    this.timeout = Mainloop.timeout_add_seconds(
      this.refresh_interval,
      Lang.bind(this, this.update)
    );
    this.canvas.queue_repaint();
  },

  setAllDataValues: function () {
    this.setPowerNow();
    this.setEnergyFull();
    this.setCapacity();
    this.setTimeLeftInHoursString(
      this.energyFull,
      this.capacity,
      this.powerNow
    );
    this.setIsCharging();

    // ignore small values but add 0W if battery isCharging
    if (this.powerNow > 0 || this.isCharging == 1) {
      this.powerRateVals.push(this.powerNow);
      this.isChargingVals.push(this.isCharging);
    }

    if (this.powerRateVals.length > this.maxDataPoints) {
      this.powerRateVals.shift();
      this.isChargingVals.shift();
    }

    if (this.showHeaderBar) {
      new St.Label({
        text: `${this.headerText}: ${this.powerSourceId}`,
        style_class: "header-bar",
      });
      this.mainBox.add(this.headerLabel);
    }

    if (this.showStatusBar) {
      this.statusBar.destroy_all_children();
      const capacityLabel = new St.Label({
        text: `SoC: ${this.capacity}% ${this.timeLeftString}`,
        style: `font-size: 13px; margin-right: 12px;`,
      });
      this.statusBar.add(capacityLabel);
      const totalCapacityLabel = new St.Label({
        text: `FCC: ${this.energyFull} Wh`,
        style: `font-size: 13px; margin-right: 12px;`,
      });
      this.statusBar.add(totalCapacityLabel);

      let chargeState = "charging";
      if (this.isCharging == 0) {
        chargeState = "discharging";
      }

      const rateLabel = new St.Label({
        text: `${chargeState}: ${this.powerNow} W`,
        style: `font-size: 13px; margin-right: 12px;`,
      });
      this.statusBar.add(rateLabel);
    }
  },

  _updateStatusBar: function () {
    this.headerLabel.text = `Watt Watchter: ${this.powerSourceId}`;

    if (!this.showStatusBar) {
      this.statusBar.destroy_all_children();
      return;
    }
  },

  _drawGrid: function (
    cr,
    gridLevels,
    margin,
    plotWidth,
    plotHeight,
    actualMax
  ) {
    for (let level of gridLevels) {
      const y = margin + plotHeight - (level / actualMax) * plotHeight;

      // Draw line
      cr.setSourceRGBA(1, 1, 1, 0.1);
      cr.setLineWidth(1);
      cr.moveTo(margin, y);
      cr.lineTo(margin + plotWidth, y);
      cr.stroke();

      // Draw label on the left
      cr.setSourceRGBA(1, 1, 1, 0.6);
      cr.setFontSize(10);
      const labelText = level + "W";
      const extents = cr.textExtents(labelText);
      cr.moveTo(margin - extents.width - 5, y + 4);
      cr.showText(labelText);
    }
  },

  _drawDataPoints: function (
    cr,
    data,
    margin,
    plotHeight,
    plotWidth,
    actualMax
  ) {
    // Draws data points with simple line style
    cr.moveTo(margin, margin + plotHeight - (data[0] / actualMax) * plotHeight);
    for (let i = 1; i < data.length; i++) {
      const x = margin + (plotWidth * i) / (data.length - 1);
      const y = margin + plotHeight - (data[i] / actualMax) * plotHeight;
      let colorObj = _parseColor(this.chargingColor);
      if (this.isChargingVals[i] == 0) {
        colorObj = _parseColor(this.dischargingColor);
      }
      cr.setSourceRGBA(colorObj.r, colorObj.g, colorObj.b, 0.9);
      cr.setLineWidth(2);
      cr.lineTo(x, y);
    }
  },

  _drawDataPointsWithGradient: function (
    cr,
    data,
    margin,
    plotHeight,
    plotWidth,
    actualMax
  ) {
    // Draws data points with a gradient fill below the curve
    // First, create the path for the curve
    cr.moveTo(margin, margin + plotHeight - (data[0] / actualMax) * plotHeight);

    let points = [];
    points.push({
      x: margin,
      y: margin + plotHeight - (data[0] / actualMax) * plotHeight,
    });

    for (let i = 1; i < data.length; i++) {
      const x = margin + (plotWidth * i) / (data.length - 1);
      const y = margin + plotHeight - (data[i] / actualMax) * plotHeight;
      points.push({ x: x, y: y });
      cr.lineTo(x, y);
    }

    // Close the path by connecting to bottom corners for fill
    const lastX = points[points.length - 1].x;
    const bottomY = margin + plotHeight;
    cr.lineTo(lastX, bottomY);
    cr.lineTo(margin, bottomY);
    cr.closePath();

    // Create gradient from top to bottom
    const gradient = new Cairo.LinearGradient(
      0,
      margin,
      0,
      margin + plotHeight
    );

    // Determine if charging or discharging based on most recent state
    const isCharging =
      this.isChargingVals[this.isChargingVals.length - 1] !== 0;

    const colorObjBackground = _parseColor(this.backgroundColor);

    const colorObjCharging = _parseColor(this.chargingColor);
    const colorObjDischarging = _parseColor(this.dischargingColor);
    if (isCharging) {
      gradient.addColorStopRGBA(
        0,
        colorObjCharging.r,
        colorObjCharging.g,
        colorObjCharging.b,
        0.7
      );
    } else {
      gradient.addColorStopRGBA(
        0,
        colorObjDischarging.r,
        colorObjDischarging.g,
        colorObjDischarging.b,
        0.7
      );
    }
    gradient.addColorStopRGBA(
      1,
      colorObjBackground.r,
      colorObjBackground.g,
      colorObjBackground.b,
      0.1
    );

    cr.setSource(gradient);
    cr.fillPreserve();

    // Now draw the line on top
    cr.newPath();
    cr.moveTo(margin, margin + plotHeight - (data[0] / actualMax) * plotHeight);

    for (let i = 1; i < data.length; i++) {
      const x = margin + (plotWidth * i) / (data.length - 1);
      const y = margin + plotHeight - (data[i] / actualMax) * plotHeight;
      cr.lineTo(x, y);
    }

    // Draw the stroke with color changes
    for (let i = 0; i < data.length - 1; i++) {
      const x1 = margin + (plotWidth * i) / (data.length - 1);
      const y1 = margin + plotHeight - (data[i] / actualMax) * plotHeight;
      const x2 = margin + (plotWidth * (i + 1)) / (data.length - 1);
      const y2 = margin + plotHeight - (data[i + 1] / actualMax) * plotHeight;

      if (this.isCharging) {
        cr.setSourceRGBA(
          colorObjCharging.r,
          colorObjCharging.g,
          colorObjCharging.b,
          0.9
        );
      } else {
        cr.setSourceRGBA(
          colorObjDischarging.r,
          colorObjDischarging.g,
          colorObjDischarging.b,
          0.9
        );
      }
      cr.setLineWidth(2);
      cr.moveTo(x1, y1);
      cr.lineTo(x2, y2);
      cr.stroke();
    }
  },
  _drawPlot: function (canvas) {
    if (this.powerRateVals.length < 2) {
      return;
    }
    const data = this.powerRateVals;
    const [width, height] = canvas.get_surface_size();
    const cr = canvas.get_context();

    const leftMargin = 25;
    const rightMargin = 15;
    const margin = 35;
    const plotWidth = width - leftMargin - rightMargin;
    const plotHeight = height - 2 * margin;

    const maxValue = Math.max(...data);

    // Draw grid and y axis labels
    const gridLevels = this._getGridLevels(maxValue);
    const actualMax = gridLevels[gridLevels.length - 1]; // Use this for scaling instead of maxValue
    this._drawGrid(cr, gridLevels, margin, plotWidth, plotHeight, actualMax);

    // Draw data points
    if (this.dataLineStyle == "GRADIENT") {
      this._drawDataPointsWithGradient(
        cr,
        data,
        margin,
        plotHeight,
        plotWidth,
        actualMax
      );
    } else {
      this._drawDataPoints(cr, data, margin, plotHeight, plotWidth, actualMax);
    }
    cr.stroke();
  },

  _updateFilePaths: function () {
    this.capacityFile = Gio.file_new_for_path(
      `/sys/class/power_supply/${this.powerSourceId}/capacity`
    );
    this.fullEnergyFile = Gio.file_new_for_path(
      `/sys/class/power_supply/${this.powerSourceId}/energy_full`
    );
    this.isChargingFile = Gio.file_new_for_path(
      "/sys/class/power_supply/AC/online"
    );

    this.powerNowFile = Gio.file_new_for_path(
      `/sys/class/power_supply/${this.powerSourceId}/power_now`
    );
  },

  _on_setting_changed: function () {
    if (this.timeout) {
      Mainloop.source_remove(this.timeout);
    }
    this._updateContainerStyle();

    // Resize canvas if dimensions changed
    let statusBarMargin = 45;
    if (this.showStatusBar == 0) {
      statusBarMargin = 25;
    }
    if (this.canvas) {
      this.canvas.set_size(
        this.deskletWidth - this.widgetMarginFromCss || 380,
        this.deskletHeight - this.widgetMarginFromCss - statusBarMargin || 220
      );
    }

    // After maxDataPoints is updated from settings
    while (this.powerRateVals.length > this.maxDataPoints) {
      this.powerRateVals.shift();
      this.isChargingVals.shift();
    }
    this._updateStatusBar();
    this._updateFilePaths();
    this.update();
  },

  on_desklet_removed: function () {
    if (this.timeout) {
      Mainloop.source_remove(this.timeout);
    }
  },

  setTimeLeftInHoursString: function (maxCapacity, capacityPrct, rate) {
    let totalHours = 0;
    if (this.isCharging == 0) {
      totalHours = (maxCapacity * capacityPrct) / 100 / rate;
    } else {
      totalHours = (maxCapacity * (100 - capacityPrct)) / 100 / rate;
    }
    const hoursInt = Math.floor(totalHours);
    const minutesInt = Math.round((totalHours - hoursInt) * 60);
    const minutesString = minutesInt.toString().padStart(2, "0");
    if (!isFinite(hoursInt) || !isFinite(minutesInt)) {
      // battery fully charged / not charging
      this.timeLeftString = `(00:00)`;
    } else {
      this.timeLeftString = `(${hoursInt}:${minutesString})`;
    }
  },

  setCapacity: function () {
    this.capacityFile.load_contents_async(null, (file, response) => {
      let [success, contents, tag] = file.load_contents_finish(response);
      if (success) {
        let capacity = ByteArray.toString(contents);
        this.capacity = parseInt(capacity);
      }
    });
  },

  setEnergyFull: function () {
    this.fullEnergyFile.load_contents_async(null, (file, response) => {
      let [success, contents, tag] = file.load_contents_finish(response);
      if (success) {
        let energyFull = ByteArray.toString(contents);
        this.energyFull = parseInt(energyFull) / 1000 / 1000;
      }
    });
  },

  setIsCharging: function () {
    this.isChargingFile.load_contents_async(null, (file, response) => {
      let [success, contents, tag] = file.load_contents_finish(response);
      if (success) {
        let isCharging = ByteArray.toString(contents);
        this.isCharging = parseInt(isCharging);
      }
    });
  },

  setPowerNow: function () {
    this.powerNowFile.load_contents_async(null, (file, response) => {
      let [success, contents, tag] = file.load_contents_finish(response);
      if (success) {
        let powerValue = ByteArray.toString(contents);
        this.powerNow = parseInt(powerValue) / 1000 / 1000;
        this.powerNow = this.powerNow.toFixed(1);
      }
      GLib.free(contents);
    });
  },

  _getGridLevels(maxValue) {
    // Round up maxValue to a nice number for the grid
    let gridMax;

    if (maxValue <= 20) {
      gridMax = 20;
      return [0, 5, 10, 15];
    } else if (maxValue <= 40) {
      gridMax = 40;
      return [0, 10, 20, 30];
    } else if (maxValue <= 60) {
      gridMax = 60;
      return [0, 15, 30, 45, 60];
    } else if (maxValue <= 80) {
      gridMax = 80;
      return [0, 20, 40, 60, 80];
    } else if (maxValue <= 100) {
      gridMax = 100; //
      return [0, 25, 50, 75, 100];
    } else {
      // For higher values, round to nearest 20 and divide by 4
      gridMax = Math.ceil(maxValue / 20) * 20;
      const step = gridMax / 4;
      return [0, step, step * 2, step * 3, gridMax];
    }
  },
};

function main(metadata, desklet_id) {
  return new MyDesklet(metadata, desklet_id);
}

function MyDesklet(metadata, desklet_id) {
  this._init(metadata, desklet_id);
}

function _parseColor(colorStr) {
  // Convert color string (hex or rgb) to normalized RGB values.
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

  // Handle 3-digit hex like #abc
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  // Handle 6-digit hex
  if (hex.length === 6) {
    return {
      r: parseInt(hex.substr(0, 2), 16) / 255,
      g: parseInt(hex.substr(2, 2), 16) / 255,
      b: parseInt(hex.substr(4, 2), 16) / 255,
    };
  }

  return { r: 0.5, g: 0.5, b: 0.5 };
}
