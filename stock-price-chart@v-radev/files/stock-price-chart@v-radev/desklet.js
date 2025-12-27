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

    this.refreshIntervalSeconds = 60 * 60;
    this.chartData = {
      companyName: '',
      labels: [],
      values: [],
    };
  },

  _bindSettings: function() {
    this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, this.instanceId);

    // [ General Settings ]
    this.settings.bind('tickerSymbol', 'tickerSymbol', this.onDataSettingsChange);
    this.settings.bind('daysPeriodToShow', 'daysPeriodToShow', this.onDataSettingsChange);
    this.settings.bind('showCompanyNameOrTicker', 'showCompanyNameOrTicker', this.onDataSettingsChange);

    // [ Render Settings ]
    this.settings.bind('fontColor', 'fontColor', this.onVisualSettingsChange);
    this.settings.bind('shouldScaleFontSize', 'shouldScaleFontSize', this.onVisualSettingsChange);
    this.settings.bind('fontScale', 'fontScale', this.onVisualSettingsChange);

    this.settings.bind('chartAxesColor', 'chartAxesColor', this.onVisualSettingsChange);
    this.settings.bind('chartMidlinesColor', 'chartMidlinesColor', this.onVisualSettingsChange);
    this.settings.bind('chartLineColor', 'chartLineColor', this.onVisualSettingsChange);

    // [ Layout Settings ]
    this.settings.bind('deskletScaleSize', 'deskletScaleSize', this.onVisualSettingsChange);
    this.settings.bind('transparency', 'transparency', this.onVisualSettingsChange);
    this.settings.bind('backgroundColor', 'backgroundColor', this.onVisualSettingsChange);
    this.settings.bind('cornerRadius', 'cornerRadius', this.onVisualSettingsChange);
  },

  on_desklet_removed: function() {
    logger.log('- Removing desklet: ' + this.metadata.name + ' (Instance: ' + this.instanceId + ')');

    if (this.timeout) {
      Mainloop.source_remove(this.timeout);
    }
  },

  onDataSettingsChange: function() {
    logger.log('- Desklet settings changed, reinitializing update loop.');

    if (this.timeout) {
      Mainloop.source_remove(this.timeout);
    }

    this.updateCanvasLoop();
  },

  onVisualSettingsChange: function() {
    logger.log('- Desklet visual settings changed, rerender chart.');

    this.renderChartWithData();
  },

  on_desklet_added_to_desktop() {
    logger.log('- Desklet added to desktop: ' + this.metadata.name + ' (Instance: ' + this.instanceId + ')');

    this.mainBox = new St.BoxLayout({
      style_class: 'stock-price-chart_mainBox',
    });

    this.setContent(this.mainBox);

    this.mainBox.style = "border-radius: 12px;";

    this.updateCanvasLoop();
  },

  updateCanvasLoop: function() {
    logger.log('-- Desklet updateCanvasLoop() called.');

    this.fetchDataAndRender();

    this.timeout = Mainloop.timeout_add_seconds(
      this.refreshIntervalSeconds,
      Lang.bind(this, this.updateCanvasLoop)
    );
  },

  fetchDataAndRender: function() {
    logger.log('-- Desklet fetchDataAndRender() called.');

    //TODO need .po files, follow the scripts in the readme

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

        for (let i = 0; i < tickerData.length; i++) {
          chartLabels.push(`${tickerData[i].date.getDate()} ${tickerData[i].date.toLocaleString('en-US', { month: 'short' })}`);
          chartValues.push(tickerData[i].close);
        }

        logger.log('-- Fetched ticker data values: ' + chartValues.toString());
        logger.log('-- Fetched ticker data labels: ' + chartLabels.toString());

        this.chartData = {
          companyName: tickerData[0].shortName,
          labels: chartLabels,
          values: chartValues,
        }

        this.renderChartWithData();
      })
      .catch((e) => {
        logger.log('-- Error in fetching ticker data: ' + e.message);
      });

    logger.log('-- Finished fetching data from Yahoo Finance.');
  },

  renderChartWithData: function() {
    const scaleSize = this.deskletScaleSize;
    const unitSize = 15 * scaleSize * global.ui_scale;
    const graph_w = 20 * unitSize;
    const graph_h =  4 * unitSize;
    const desklet_w = graph_w + (2 * unitSize);
    const desklet_h = graph_h + (4 * unitSize);
    const chartSettings = {
      titleDisplay: this.showCompanyNameOrTicker ? this.chartData.companyName : this.tickerSymbol,
      backgroundTransparency: this.transparency,
      backgroundColor: this.backgroundColor,
      fontColor: this.fontColor,
      chartAxesColor: this.chartAxesColor,
      chartMidlinesColor: this.chartMidlinesColor,
      chartLineColor: this.chartLineColor,
      cornerRadius: this.cornerRadius,
      shouldScaleFontSize: this.shouldScaleFontSize,
      fontScale: this.fontScale,
    };

    if (this.mainBox) {
      this.mainBox.remove_all_children();
    }

    this.mainBox = new St.BoxLayout({
      style_class: 'stock-price-chart_mainBox',
    });

    const chartObject = new ChartModule.ChartClass(this.chartData.labels, this.chartData.values, chartSettings);
    const canvas = chartObject.drawCanvas(desklet_w, desklet_h, unitSize);


  //TODO
  //   Clutter.init(None)
  //   stage = Clutter.Stage()
  //   stage.set_size(WIDTH, HEIGHT)
  //   stage.set_title("Clutter Line Chart Example")
  //   stage.connect("destroy", Clutter.main_quit)
  //
  // # Create canvas and actor
  //   canvas = Clutter.Canvas()
  //   canvas.set_size(WIDTH, HEIGHT)
  //   canvas.connect("draw", draw_chart)
  //
  //   actor = Clutter.Actor()
  //   actor.set_size(WIDTH, HEIGHT)
  //   actor.set_content(canvas)     # assign the canvas as actor content
  // # position at 0,0 inside stage
  //   actor.set_position(0, 0)
  //
  //   stage.add_child(actor)
  //   stage.show_all()
  //
  //   Clutter.main()

    canvas.invalidate();

    this.mainBox.set_content(canvas);
    this.mainBox.set_size(desklet_w, desklet_h);

    this.setContent(this.mainBox);
  },

  // Callback when user clicks refresh button in settings
  onClickUpdateDataButton: function() {
    logger.log('-- onClickUpdateDataButton called.');

    this.fetchDataAndRender();
  },
};

function main(metadata, instanceId) {
  return new StockPriceChartDesklet(metadata, instanceId);
}
