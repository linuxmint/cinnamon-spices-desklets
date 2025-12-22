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

    this._bindSettings();

    this.refreshIntervalSeconds = 60 * 60; //TODO is configurable
  },

  _bindSettings: function() {
    this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, this.instanceId);

    // [ General Settings ]
    this.settings.bind('tickerSymbol', 'tickerSymbol', this.on_setting_changed);
    this.settings.bind('daysPeriodToShow', 'daysPeriodToShow', this.on_setting_changed);
    this.settings.bind('showCompanyNameOrTicker', 'showCompanyNameOrTicker', this.on_setting_changed);

    //TODO not using this yet
    this.settings.bind('delayMinutes', 'delayMinutes', this.on_setting_changed);
    //TODO not using this yet
    this.settings.bind('showLastUpdateTimestamp', 'showLastUpdateTimestamp', this.on_setting_changed);

    // [ Render Settings ]
    //TODO not using this yet
    this.settings.bind('use24HourTime', 'use24HourTime', this.on_setting_changed);
    //TODO not using this yet
    this.settings.bind('customDateFormat', 'customDateFormat', this.on_setting_changed);

    //TODO not using this yet
    this.settings.bind('fontColor', 'fontColor', this.on_setting_changed);
    //TODO not using this yet
    this.settings.bind('scaleFontSize', 'scaleFontSize', this.on_setting_changed);
    //TODO not using this yet
    this.settings.bind('fontScale', 'fontScale', this.on_setting_changed);

    //TODO not using this yet
    this.settings.bind('uptrendChangeColor', 'uptrendChangeColor', this.on_setting_changed);
    //TODO not using this yet
    this.settings.bind('downtrendChangeColor', 'downtrendChangeColor', this.on_setting_changed);
    //TODO not using this yet
    this.settings.bind('unchangedTrendColor', 'unchangedTrendColor', this.on_setting_changed);

    // [ Layout Settings ]
    this.settings.bind('deskletScaleSize', 'deskletScaleSize', this.on_setting_changed);
    this.settings.bind('transparency', 'transparency', this.on_setting_changed);
    //TODO not using this yet
    this.settings.bind('backgroundColor', 'backgroundColor', this.on_setting_changed);
    //TODO not using this yet
    this.settings.bind('cornerRadius', 'cornerRadius', this.on_setting_changed);
  },

  on_desklet_removed: function() {
    logger.log('- Removing desklet: ' + this.metadata.name + ' (Instance: ' + this.instanceId + ')');

    if (this.timeout) {
      Mainloop.source_remove(this.timeout);
    }
  },

  on_setting_changed: function() {
    logger.log('- Desklet settings changed, reinitializing update loop.');

    if (this.timeout) {
      Mainloop.source_remove(this.timeout);
    }

    this.updateCanvasLoop();
  },

  on_desklet_added_to_desktop() {
    logger.log('- Desklet added to desktop: ' + this.metadata.name + ' (Instance: ' + this.instanceId + ')');

    this.mainBox = new St.BoxLayout({
      style_class: 'stock-price-chart_mainBox',
    });

    this.setContent(this.mainBox);

    this.mainBox.style = "border: 1px solid rgba(50,50,50,1); border-radius: 12px;";

    this.updateCanvasLoop();
  },

  updateCanvasLoop: function() {
    logger.log('-- Desklet updateCanvasLoop() called.');

    this.newChartDraw();

    this.timeout = Mainloop.timeout_add_seconds(
      this.refreshIntervalSeconds,
      Lang.bind(this, this.updateCanvasLoop)
    );
  },

  newChartDraw: function() {
    logger.log('-- Desklet newChartDraw() called.');

    //TODO need .po files, follow the scripts in the readme

    const scaleSize = this.deskletScaleSize;
    const unitSize = 15 * scaleSize * global.ui_scale;
    const graph_w = 20 * unitSize;
    const graph_h =  4 * unitSize;
    const desklet_w = graph_w + (2 * unitSize);
    const desklet_h = graph_h + (4 * unitSize);
    const daysToFetch = this.daysPeriodToShow;
    // This can be 1d, 1wk, 1mo configurable in a future release
    // And is there a way to fetch data by hours for the given day?
    const dataInterval = '1d';

    logger.log('-- Starting to fetch data from Yahoo Finance.');

    yahooClient.getHistoricalTickerData(
      this.tickerSymbol,
      dataInterval,
      new Date(Date.now() - daysToFetch * 24 * 60 * 60 * 1000),
      new Date()
    )
      .then((tickerData) => {
        const chartLabels = [];
        const chartValues = [];
        const chartSettings = {
          titleDisplay: this.showCompanyNameOrTicker ? tickerData[0].shortName : this.tickerSymbol,
          backgroundTransparency: this.transparency,
        };

        for (let i = 0; i < tickerData.length; i++) {
          chartLabels.push(`${tickerData[i].date.getDate()} ${tickerData[i].date.toLocaleString('en-US', { month: 'short' })}`);
          chartValues.push(tickerData[i].close);
        }

        logger.log('-- Fetched ticker data values: ' + chartValues.toString());
        logger.log('-- Fetched ticker data labels: ' + chartLabels.toString());

        this.mainBox = new St.BoxLayout({
          style_class: 'stock-price-chart_mainBox',
        });

        this.setContent(this.mainBox);

        this.mainBox.style = 'border: 1px solid rgba(50,50,50,1); border-radius: 12px;';

        const chartObject = new ChartModule.ChartClass(chartLabels, chartValues, chartSettings);
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

  // Callback when user clicks refresh button in settings
  onClickUpdateDataButton: function() {
    logger.log('-- onClickUpdateDataButton called.');

    this.newChartDraw();
  },
};

function main(metadata, instanceId) {
  return new StockPriceChartDesklet(metadata, instanceId);
}
