'use strict';

// Cinnamon desklet user interface
const Desklet = imports.ui.desklet;
// Shell toolkit
const St = imports.gi.St;
// Settings loader based on settings-schema.json file
const Settings = imports.ui.settings;
const Lang = imports.lang;
const Clutter = imports.gi.Clutter;
const Cairo = imports.cairo;
const Mainloop = imports.mainloop;

const UUID = 'stock-price-chart@v-radev';
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

imports.searchPath.unshift(`${DESKLET_DIR}/lib`);
const LoggerModule = imports['logger'];
const ChartModule = imports['chart'];
const YahooModule = imports['yahoo_client'];
const logger = new LoggerModule.LoggerClass();
const yahooClient = new YahooModule.YahooClient();

function StockPriceChartDesklet(metadata, instanceId) {
  this._init(metadata, instanceId);
}

StockPriceChartDesklet.prototype = {
  __proto__: Desklet.Desklet.prototype,

  _init: function(metadata, instanceId) {
    logger.log('Initializing desklet: ' + metadata.name + ' (Instance: ' + instanceId + ')');
    Desklet.Desklet.prototype._init.call(this, metadata, instanceId);

    this.instanceId = instanceId;
    this.metadata = metadata;

    this.refreshIntervalSeconds = 5; //TODO is configurable

    this._bindSettings();
  },

  _bindSettings: function() {
    this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, this.instanceId);

    // [ Display Settings ]
    this.settings.bind('height', 'height', this.onDisplaySettingChanged);
    this.settings.bind('width', 'width', this.onDisplaySettingChanged);
    this.settings.bind('transparency', 'transparency', this.onDisplaySettingChanged);
    this.settings.bind('backgroundColor', 'backgroundColor', this.onDisplaySettingChanged);
    this.settings.bind('cornerRadius', 'cornerRadius', this.onDisplaySettingChanged);
    this.settings.bind('borderWidth', 'borderWidth', this.onDisplaySettingChanged);
    this.settings.bind('borderColor', 'borderColor', this.onDisplaySettingChanged);

    // [ Data Fetch Settings ]
    this.settings.bind('delayMinutes', 'delayMinutes', this.onDataFetchSettingsChanged);

    // [ Render Settings ]
    this.settings.bind('showLastUpdateTimestamp', 'showLastUpdateTimestamp', this.onRenderSettingsChanged);
    this.settings.bind('showVerticalScrollbar', 'showVerticalScrollbar', this.onRenderSettingsChanged);
    this.settings.bind('manualDataUpdate', 'manualDataUpdate', this.onRenderSettingsChanged);
    this.settings.bind('roundNumbers', 'roundNumbers', this.onRenderSettingsChanged);
    this.settings.bind('decimalPlaces', 'decimalPlaces', this.onRenderSettingsChanged);
    this.settings.bind('strictRounding', 'strictRounding', this.onRenderSettingsChanged);
    this.settings.bind('use24HourTime', 'use24HourTime', this.onRenderSettingsChanged);
    this.settings.bind('customTimeFormat', 'customTimeFormat', this.onRenderSettingsChanged);
    this.settings.bind('customDateFormat', 'customDateFormat', this.onRenderSettingsChanged);
    this.settings.bind('showQuoteName', 'showQuoteName', this.onRenderSettingsChanged);
    this.settings.bind('useLongQuoteName', 'useLongQuoteName', this.onRenderSettingsChanged);
    this.settings.bind('linkQuoteName', 'linkQuoteName', this.onRenderSettingsChanged);
    this.settings.bind('fontColor', 'fontColor', this.onRenderSettingsChanged);
    this.settings.bind('scaleFontSize', 'scaleFontSize', this.onRenderSettingsChanged);
    this.settings.bind('fontScale', 'fontScale', this.onRenderSettingsChanged);
    this.settings.bind('uptrendChangeColor', 'uptrendChangeColor', this.onRenderSettingsChanged);
    this.settings.bind('downtrendChangeColor', 'downtrendChangeColor', this.onRenderSettingsChanged);
    this.settings.bind('unchangedTrendColor', 'unchangedTrendColor', this.onRenderSettingsChanged);

    // [ Network Settings ]
    this.settings.bind('sendCustomUserAgent', 'sendCustomUserAgent'); // no callback, manual refresh required
    this.settings.bind('customUserAgent', 'customUserAgent');  // no callback, manual refresh required
    this.settings.bind('enableCurl', 'enableCurl'); // no callback, manual refresh required
    this.settings.bind('curlCommand', 'curlCommand'); // no callback, manual refresh required
  },

  on_desklet_removed: function() {
    logger.log('Removing desklet: ' + this.metadata.name + ' (Instance: ' + this.instanceId + ')');

    if (this.timeout) {
      Mainloop.source_remove(this.timeout);
    }
  },

  //TODO this should get called when some of the settings are changed
  on_setting_changed: function() {
    if (this.timeout) {
      Mainloop.source_remove(this.timeout);
    }

    this.firstRun = true;
    this.updateCanvasLoop();
  },

  on_desklet_added_to_desktop() {
    logger.log('Desklet added to desktop: ' + this.metadata.name + ' (Instance: ' + this.instanceId + ')');

    this.mainBox = new St.BoxLayout({
      style_class: 'stock-price-chart_mainBox',
    });

    //TODO do I use this text?
    this.text1 = new St.Label();
    this.text2 = new St.Label();
    this.text3 = new St.Label();
    this.mainBox.add_actor(this.text1);
    this.mainBox.add_actor(this.text2);
    this.mainBox.add_actor(this.text3);
    this.setContent(this.mainBox);

    this.firstRun = true;

    this.mainBox.style = "border: 1px solid rgba(90,90,90,1); border-radius: 12px;";

    // this.updateCanvasLoop();
    this.newChartDraw();
  },

  updateCanvasLoop: function() {
    this.updateCanvasUI();

    this.timeout = Mainloop.timeout_add_seconds(
      this.refreshIntervalSeconds,
      Lang.bind(this, this.updateCanvasLoop)
    );
  },

  updateCanvasUI: function() {
    logger.log('Desklet updateCanvasUI() called.');

    if (this.firstRun){
      const durationMinutes = 5; //TODO is configurable
      const durationSeconds = durationMinutes * 60; //TODO is configurable
      this.numberOfXAxisValues = Math.floor(durationSeconds / this.refreshIntervalSeconds)  + 1;

      this.values = new Array(this.numberOfXAxisValues).fill(0.0);

      this.line_color = 'rgba(23,147,208,1.0)'; //TODO is configurable

      this.firstRun = false;
    }

    // Desklet proportions
    const scaleSize = 1; //TODO scale_size is configurable
    let unit_size = 15 * scaleSize * global.ui_scale;
    var line_width = unit_size / 15;
    var margin_up = 3 * unit_size;
    var graph_w = 20 * unit_size;
    var graph_h =  4 * unit_size;
    let desklet_w = graph_w + (2 * unit_size);
    let desklet_h = graph_h + (4 * unit_size);
    var h_midlines = 6; //TODO is configurable
    var v_midlines = 6; //TODO is configurable
    let text1_size = (4 * unit_size / 3) / global.ui_scale;
    let text2_size = (4 * unit_size / 3) / global.ui_scale;
    let text3_size = (3 * unit_size / 3) / global.ui_scale;
    var radius = 2 * unit_size / 3;
    var degrees = Math.PI / 180.0;

    let numberOfXAxisValues = this.numberOfXAxisValues;
    let values = this.values;
    let graph_step = graph_w / (numberOfXAxisValues -1);

    //TODO values should come from API
    const randomUseValue = Math.random() * 100; // Simulate CPU usage
    var text1 = _("CPU"); //TODO is configurable - ticket symbol
    var text2 = Math.round(randomUseValue).toString() + "%";

    //TODO this is some text that is available for RAM, Network, etc.
    var text3 = '';
    var line_colors = this.parseRgbaValues(this.line_color);

    logger.log('Line colors parsed: ' + line_colors.toString());

    // Current value for this interval of the graph
    const value = randomUseValue / 100;

    values.push(isNaN(value) ? 0 : value);
    values.shift();

    this.values = values;

    var background_colors = this.parseRgbaValues('rgba(50,50,50,1)'); //TODO is configurable
    var midline_colors = this.parseRgbaValues('rgba(127,127,127,1)'); //TODO is configurable

    logger.log('Value added: ' + value.toString());

    // Draws graph
    let canvas = new Clutter.Canvas();

    canvas.set_size(desklet_w, desklet_h);

    canvas.connect('draw', (canvas, ctx, desklet_w, desklet_h) => {
      logger.log('Start canvas draw function.');

      ctx.save();
      ctx.setOperator(Cairo.Operator.CLEAR);
      ctx.paint();
      ctx.restore();
      ctx.setOperator(Cairo.Operator.OVER);
      ctx.setLineWidth(2 * line_width);

      logger.log('-- Start background.');
      // Desklet background
      ctx.setSourceRGBA(background_colors[0], background_colors[1], background_colors[2], background_colors[3]);
      ctx.newSubPath();
      ctx.arc(desklet_w - radius, radius, radius, -90 * degrees, 0 * degrees);
      ctx.arc(desklet_w - radius, desklet_h - radius, radius, 0 * degrees, 90 * degrees);
      ctx.arc(radius, desklet_h - radius, radius, 90 * degrees, 180 * degrees);
      ctx.arc(radius, radius, radius, 180 * degrees, 270 * degrees);
      ctx.closePath();
      ctx.fill();

      logger.log('-- Start midlines.');
      // Graph X and Y axis midlines
      ctx.setSourceRGBA(midline_colors[0], midline_colors[1], midline_colors[2], 1);
      ctx.setLineWidth(line_width);

      logger.log('-- Start loop.');
      for (let i = 1; i < v_midlines; i++){
        logger.log('Loop midlines - i = ' + i.toString());
        ctx.moveTo((i * graph_w / v_midlines) + unit_size, margin_up);
        ctx.relLineTo(0, graph_h);
        ctx.stroke();
      }

      for (let i = 1; i < h_midlines; i++){
        ctx.moveTo(unit_size, margin_up + i * (graph_h / h_midlines));
        ctx.relLineTo(graph_w, 0);
        ctx.stroke();
      }

      // Timeseries and area
      ctx.setLineWidth(2 * line_width);
      ctx.setSourceRGBA(line_colors[0], line_colors[1], line_colors[2], 1);
      ctx.moveTo(unit_size, margin_up + graph_h - (values[0] * graph_h));

      for (let i = 1; i < numberOfXAxisValues; i++){
        ctx.lineTo(unit_size + (i * graph_step), margin_up + graph_h - (values[i] * graph_h));
      }

      ctx.strokePreserve();
      ctx.lineTo(unit_size + graph_w, margin_up + graph_h);
      ctx.lineTo(unit_size, margin_up + graph_h);
      ctx.closePath();
      ctx.setSourceRGBA(line_colors[0], line_colors[1], line_colors[2], 0.4);
      ctx.fill();

      // Graph border (redrawn on top)
      ctx.setLineWidth(2 * line_width);
      ctx.setSourceRGBA(line_colors[0], line_colors[1], line_colors[2], 1);
      ctx.rectangle(unit_size, margin_up, graph_w, graph_h);
      ctx.stroke();

      logger.log('Finish drawing on canvas.');

      return false;
    });

    logger.log('Add text strings to canvas.');

    // Labels text, style and position
    this.text1.set_text(text1);
    this.text1.style = "font-size: " + text1_size + "px;"
      + "color: " + this.text_color + ";";
    this.text1.set_position(
      Math.round(unit_size),
      Math.round((2.5 * unit_size) - this.text1.get_height())
    );

    this.text2.set_text(text2);
    this.text2.style = "font-size: " + text2_size + "px;"
      + "color: " + this.text_color + ";";
    this.text2.set_position(
      Math.round(this.text1.get_width() + (2 * unit_size)),
      Math.round((2.5 * unit_size) - this.text2.get_height())
    );

    this.text3.set_text(text3);
    this.text3.style = "font-size: " + text3_size + "px;"
      + "color: " + this.text_color + ";";
    this.text3.set_position(
      Math.round((21 * unit_size) - this.text3.get_width()),
      Math.round((2.5 * unit_size) - this.text3.get_height())
    );

    // Update canvas
    canvas.invalidate();

    this.mainBox.set_content(canvas);
    this.mainBox.set_size(desklet_w, desklet_h);
  },

  newChartDraw: function() {
    //TODO need .po files, follow the scripts in the readme

    // Desklet proportions
    const scaleSize = 1.5; //TODO scale_size is configurable
    const unitSize = 15 * scaleSize * global.ui_scale;
    const graph_w = 20 * unitSize;
    const graph_h =  4 * unitSize;
    const desklet_w = graph_w + (2 * unitSize);
    const desklet_h = graph_h + (4 * unitSize);

    logger.log('-- About to fetch data from Yahoo Finance.');

    yahooClient.getHistoricalTickerData(
      'AAPL',
      '1d',
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      new Date()
    )
      .then((tickerData) => {
        const chartLabels = [];
        const chartValues = [];

        for (let i = 0; i < tickerData.length; i++) {
          chartLabels.push(`${tickerData[i].date.getDate()} ${tickerData[i].date.toLocaleString('en-US', { month: 'short' })}`);
          chartValues.push(tickerData[i].close);
        }

        logger.log('-- Fetched ticker data values: ' + chartValues.toString());
        logger.log('-- Fetched ticker data labels: ' + chartLabels.toString());

        const chartObject = new ChartModule.ChartClass(chartLabels, chartValues);
        const canvas = chartObject.drawCanvas(desklet_w, desklet_h, unitSize);

        canvas.invalidate();

        this.mainBox.set_content(canvas);
        this.mainBox.set_size(desklet_w, desklet_h);
      })
      .catch((e) => {
        logger.log('-- Error in fetching ticker data: ' + e.message);
      });

    logger.log('-- Finished fetching data from Yahoo Finance.');
  },

  parseRgbaValues: function(colorString) {
    let colors = colorString.match(/\((.*?)\)/)[1].split(",");
    let r = parseInt(colors[0])/255;
    let g = parseInt(colors[1])/255;
    let b = parseInt(colors[2])/255;
    let a = 1;

    if (colors.length > 3) {
      a = colors[3]
    }

    return [r, g, b, a];
  },
};

function main(metadata, instanceId) {
  return new StockPriceChartDesklet(metadata, instanceId);
}
