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
    logger.log('- Initializing desklet: ' + metadata.name + ' (Instance: ' + instanceId + ')');

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
    logger.log('- Removing desklet: ' + this.metadata.name + ' (Instance: ' + this.instanceId + ')');

    if (this.timeout) {
      Mainloop.source_remove(this.timeout);
    }
  },

  //TODO this should get called when some of the settings are changed
  on_setting_changed: function() {
    logger.log('- Desklet settings changed, reinitializing update loop.');

    if (this.timeout) {
      Mainloop.source_remove(this.timeout);
    }

    this.firstRun = true;
    this.updateCanvasLoop();
  },

  on_desklet_added_to_desktop() {
    logger.log('- Desklet added to desktop: ' + this.metadata.name + ' (Instance: ' + this.instanceId + ')');

    this.mainBox = new St.BoxLayout({
      style_class: 'stock-price-chart_mainBox',
    });

    this.text1 = new St.Label();
    this.text2 = new St.Label();
    this.text3 = new St.Label();
    this.mainBox.add_actor(this.text1);
    this.mainBox.add_actor(this.text2);
    this.mainBox.add_actor(this.text3);
    this.setContent(this.mainBox);

    this.firstRun = true;

    this.mainBox.style = "border: 1px solid rgba(50,50,50,1); border-radius: 12px;";

    // this.updateCanvasLoop();
    this.newChartDraw();
  },

  updateCanvasLoop: function() {
    logger.log('-- Desklet updateCanvasLoop() called.');

    this.updateCanvasUI();

    this.timeout = Mainloop.timeout_add_seconds(
      this.refreshIntervalSeconds,
      Lang.bind(this, this.updateCanvasLoop)
    );
  },

  updateCanvasUI: function() {
    //TODO make this looping to refresh data?
    // - if the period is 1d, then how often does this need to refresh?

    logger.log('-- Desklet updateCanvasUI() called.');

    if (this.firstRun){
      const durationMinutes = 5;
      const durationSeconds = durationMinutes * 60;

      this.numberOfXAxisValues = Math.floor(durationSeconds / this.refreshIntervalSeconds)  + 1;
      this.values = new Array(this.numberOfXAxisValues).fill(0.0);
      this.line_color = 'rgba(23,147,208,1.0)';
      this.firstRun = false;
    }

    const scaleSize = 1;
    let unit_size = 15 * scaleSize * global.ui_scale;

    //....
    //....
    //....
    //....

    // Update canvas
    canvas.invalidate();

    this.mainBox.set_content(canvas);
    this.mainBox.set_size(desklet_w, desklet_h);
  },

  newChartDraw: function() {
    //TODO need .po files, follow the scripts in the readme

    const scaleSize = 1.5; //TODO scale_size is configurable
    const unitSize = 15 * scaleSize * global.ui_scale;
    const graph_w = 20 * unitSize;
    const graph_h =  4 * unitSize;
    const desklet_w = graph_w + (2 * unitSize);
    const desklet_h = graph_h + (4 * unitSize);
    const daysToFetch = 14; // TODO days are configurable
    const tickerSymbol = 'INTC'; // TODO days are configurable
    // This can be 1d, 1wk, 1mo configurable in a future release
    // And is there a way to fetch data by hours for the given day?
    const dataInterval = '1d';

    logger.log('-- Starting to fetch data from Yahoo Finance.');

    yahooClient.getHistoricalTickerData(
      tickerSymbol,
      dataInterval,
      new Date(Date.now() - daysToFetch * 24 * 60 * 60 * 1000),
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

        const chartObject = new ChartModule.ChartClass(chartLabels, chartValues, 'Intel Corporation');
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
};

function main(metadata, instanceId) {
  return new StockPriceChartDesklet(metadata, instanceId);
}
