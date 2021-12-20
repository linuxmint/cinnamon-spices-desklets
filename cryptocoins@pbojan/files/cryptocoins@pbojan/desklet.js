
const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Soup = imports.gi.Soup;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Util = imports.misc.util;

const UUID = 'cryptocoins@pbojan';
const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID].path;
const HELP_URL = 'https://github.com/pbojan/cryptocoins-desklet-cinnamon#usage-help';
const DONATE_URL = 'https://cryptocurrencyticker.xyz/#contribute';
const API_URL = 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest';
const WIDTH = 220;
const WIDTH_ICON = 50 / global.ui_scale;
const PADDING = 10 / global.ui_scale;
const FONT_SIZE_CONTAINER = parseInt(15 / global.ui_scale);
const FONT_SIZE_HEADER = parseInt(16 / global.ui_scale);
const FONT_SIZE_PRICE = parseInt(22 / global.ui_scale);
const FONT_SIZE_ASSETS = parseInt(12 / global.ui_scale);
const FONT_SIZE_LAST_UPDATED = parseInt(10 / global.ui_scale);

const httpSession = new Soup.SessionAsync();
Soup.Session.prototype.add_feature.call(httpSession, new Soup.ProxyResolverDefault());

function CryptocurrencyTicker(metadata, desklet_id) {
  this._init(metadata, desklet_id);
}

CryptocurrencyTicker.prototype = {
  __proto__: Desklet.Desklet.prototype,

  container: null,
  mainloop: null,

  // Labels
  priceLabel: null,
  change1H: null,
  change1D: null,
  change7D: null,
  assetsOwning: null,
  assetsValue: null,

  _init: function(metadata, desklet_id) {
    try {
      Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

      this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
      this.settings.bind('apiKey', 'cfgApiKey', this.onSettingsChanged);
      this.settings.bind('coinSymbol', 'cfgCoinSymbol', this.onSettingsChanged);
      this.settings.bind('coinID', 'cfgCoinID', this.onSettingsChanged);
      this.settings.bind('currency', 'cfgCurrency', this.onSettingsChanged);
      this.settings.bind('assetsOwned', 'cfgAssetsOwned', this.onSettingsChanged);
      this.settings.bind('assetsValue', 'cfgAssetsValue', this.onSettingsChanged);
      this.settings.bind('refreshInterval', 'cfgRefreshInterval', this.onRefreshIntervalChanged);
      this.settings.bind('bgColor', 'cfgBgColor', this.onUISettingsChanged);
      this.settings.bind('bgBorderRadius', 'cfgBgBorderRadius', this.onUISettingsChanged);

      this.setHeader('Crypto Coins Ticker');

      this.cfgApiKey = this.cfgApiKey || '';
      this.cfgCoinID = this.cfgCoinID || '';
      this.cfgCoinSymbol = this.cfgCoinSymbol || 'BTC';
      this.cfgCurrency = this.cfgCurrency.toUpperCase() || 'USD';
      this.cfgAssetsOwned = this.cfgAssetsOwned || 0.0;
      this.cfgAssetsValue = this.cfgAssetsValue || 0.0;
      this.cfgRefreshInterval = this.cfgRefreshInterval || 30;
      this.cfgBgColor = this.cfgBgColor || '#303030';
      this.cfgBgBorderRadius = this.cfgBgBorderRadius || 10;

      this._menu.addAction('Refresh', Lang.bind(this, function () {
        this.fetchData();
      }));
      this._menu.addAction('Help', Lang.bind(this, function() {
        Util.spawnCommandLine('xdg-open ' + HELP_URL);
      }));
      this._menu.addAction('Donate', Lang.bind(this, function() {
        Util.spawnCommandLine('xdg-open ' + DONATE_URL);
      }));

      this.fetchData(true);
    } catch (e) {
      global.logError(e);
    }

    return true;
  },

  on_desklet_removed: function() {
    if (this.mainloop) {
      Mainloop.source_remove(this.mainloop);
    }

    if (this.container) {
      this.container.destroy_all_children();
      this.container.destroy();
    }
  },

  onRefreshIntervalChanged: function() {
    if (this.mainloop) {
      Mainloop.source_remove(this.mainloop);
    }

    this.mainloop = Mainloop.timeout_add_seconds(this.cfgRefreshInterval * 60, Lang.bind(this, this.fetchData));
  },

  onSettingsChanged: function() {
    this.fetchData(true);
  },

  onUISettingsChanged: function () {
    this.setContainerStyle(this.container)
  },

  showNoApiKey: function() {
    var container = new St.BoxLayout({
      vertical: true,
      style_class: 'container'
    });
    this.setContainerStyle(container)

    var label = new St.Label({
      style_class: 'apikey'
    });
    label.set_text('API KEY missing...');
    container.add(label);

    this.setContent(container);
  },

  showLoading: function() {
    var container = new St.BoxLayout({
      vertical: true,
      style_class: 'container'
    });
    this.setContainerStyle(container)

    var label = new St.Label({
      style_class: 'loading'
    });
    label.set_text('Loading coin data...');
    container.add(label);

    this.setContent(container);
  },

  fetchData: function(initUI) {
    initUI = initUI || false;

    if (!this.cfgApiKey) {
      this.showNoApiKey();
      return;
    }

    if (initUI) {
      this.showLoading();
    }

    let url = API_URL + '?symbol=' + this.cfgCoinSymbol.toUpperCase() + '&convert=' + this.cfgCurrency;
    if (this.cfgCoinID !== '') {
      url = API_URL + '?id=' + this.cfgCoinID + '&convert=' + this.cfgCurrency;
    }

    var message = Soup.Message.new('GET', url);
    message.request_headers.append('X-CMC_PRO_API_KEY', this.cfgApiKey);

    httpSession.queue_message(message,
      Lang.bind(this, function(session, response) {
        if (response.status_code !== Soup.KnownStatusCode.OK) {
          global.log(UUID + ': Error during download: response code ' +
              response.status_code + ': ' + response.reason_phrase + ' - ' +
              response.response_body.data);
          return;
        }

        let result = JSON.parse(message.response_body.data);
        if (this.cfgCoinID !== '') {
          result = result.data[this.cfgCoinID];
        } else {
          result = result.data[this.cfgCoinSymbol.toUpperCase()];
        }

        if (initUI === true) {
          global.log('Init UI, create all objects for coin: ' + result['name']);
          this.setupUI(result);
        } else {
          global.log('Update objects for coin: ' + result['name']);
          this.updateUI(result);
        }
      })
    );

    if (this.mainloop) {
      Mainloop.source_remove(this.mainloop);
    }
    this.mainloop = Mainloop.timeout_add_seconds(
        this.cfgRefreshInterval * 60,
        Lang.bind(this, this.fetchData)
    );
  },

  updateUI: function(data) {
    var quote = data['quote'][this.cfgCurrency];

    this.priceLabel.set_text(this.getFormattedPrice(quote['price']));
    this.setChangeData(this.change1H, quote['percent_change_1h']);
    this.setChangeData(this.change1D, quote['percent_change_24h']);
    this.setChangeData(this.change7D, quote['percent_change_7d']);

    if (this.cfgAssetsOwned > 0 && this.assetsOwning) {
      this.assetsOwning.set_text(
        this.cfgAssetsOwned + " " + data['symbol'] + " | " + this.getFormattedPrice(this.cfgAssetsOwned * quote['price'])
      );

      if (this.cfgAssetsValue > 0 && this.assetsValue) {
        this.updateAssetsValue(this.cfgAssetsOwned, this.cfgAssetsValue, quote['price']);
      }
    }

    var date = new Date(data['last_updated']);
    this.lastUpdatedLabel.set_text(date.toLocaleString());
  },

  setupUI: function(data) {
    this.container = new St.BoxLayout({
      vertical: true,
      width: WIDTH,
      style_class: 'container'
    });
    this.setContainerStyle(this.container)

    var quote = data['quote'][this.cfgCurrency];

    this.change1H = new St.Label();
    this.change1D = new St.Label();
    this.change7D = new St.Label();

    this.container.add(this.addHeaderAndTitle(data));
    this.container.add(this.addPrice(quote['price']));
    this.container.add(this.addChange('Change 1H:', this.change1H, quote['percent_change_1h']));
    this.container.add(this.addChange('Change 1D:', this.change1D, quote['percent_change_24h']));
    this.container.add(this.addChange('Change 7D:', this.change7D, quote['percent_change_7d']));

    if (this.cfgAssetsOwned > 0.0) {
      this.container.add(this.addAssetsOwned(this.cfgAssetsOwned, quote['price'], data['symbol']));
      if (this.cfgAssetsValue > 0.0) {
        this.container.add(this.addAssetsValue(this.cfgAssetsOwned, this.cfgAssetsValue, quote['price']));
      }
    }

    this.container.add(this.addLastUpdated(data['last_updated']));
    this.setContent(this.container);
  },

  addHeaderAndTitle: function(data) {
    var row = new St.BoxLayout({
      vertical: false,
      style_class: 'row'
    });
    var left = new St.BoxLayout({
      vertical: true,
      width: 50,
      style_class: 'containerLeft'
    });

    var file = Gio.file_new_for_path(DESKLET_ROOT + '/images/icons/' + data['symbol'].toLowerCase() + '.png');
    var gicon = new Gio.FileIcon({file: file});
    var image = new St.Icon({
      gicon: gicon,
      icon_size: WIDTH_ICON,
      icon_type: St.IconType.SYMBOLIC,
      style_class: 'icon'
    });
    left.add(image);

    var right = new St.BoxLayout({
      vertical: true,
      width: WIDTH - PADDING - 50,
      style_class: 'containerRight'
    });
    var label = new St.Label({
      style_class: 'header'
    });
    label.set_style('font-size: ' + FONT_SIZE_HEADER + 'px;');
    label.set_text(data['name']);
    right.add(label);

    label = new St.Label({
      style_class: 'headerID'
    });
    label.set_text('(' + data['symbol'] + ') #' + data['cmc_rank']);
    right.add(label);

    row.add(left);
    row.add(right);

    return row;
  },

  addPrice: function(price) {
    var row = new St.BoxLayout({
      vertical: false,
      width: WIDTH - PADDING,
      style_class: 'row'
    });
    var center = new St.BoxLayout({
      vertical: true,
      width: WIDTH - PADDING,
      style_class: 'containerPrice'
    });
    center.set_style('font-size: ' + FONT_SIZE_PRICE + 'px;');

    this.priceLabel = new St.Label();
    this.priceLabel.set_text(this.getFormattedPrice(price));

    center.add(this.priceLabel);
    row.add(center);

    return row;
  },

  addAssetsOwned: function(assetOwned, currentPrice, symbol) {
    var row = new St.BoxLayout({
      vertical: false,
      width: WIDTH - PADDING,
      style_class: 'row'
    });
    var center = new St.BoxLayout({
      vertical: true,
      width: WIDTH - PADDING,
      style_class: 'containerAssetsOwned'
    });
    center.set_style('font-size: ' + FONT_SIZE_ASSETS + 'px;');

    this.assetsOwning = new St.Label();
    this.assetsOwning.set_text(assetOwned + " " + symbol + " | " + this.getFormattedPrice(assetOwned * currentPrice));
    center.add(this.assetsOwning);

    row.add(center);

    return row;
  },

  addAssetsValue: function(assetOwned, assetsValue, currentPrice) {
    var row = new St.BoxLayout({
      vertical: false,
      width: WIDTH - PADDING,
      style_class: 'row'
    });
    var center = new St.BoxLayout({
      vertical: true,
      width: WIDTH - PADDING,
      style_class: 'containerAssetsValue'
    });
    center.set_style('font-size: ' + FONT_SIZE_ASSETS + 'px;');

    this.assetsValue = new St.Label();
    this.updateAssetsValue(assetOwned, assetsValue, currentPrice);

    center.add(this.assetsValue);
    row.add(center);

    return row;
  },

  updateAssetsValue: function(assetOwned, assetsValue, currentPrice) {
    var profit = assetOwned * currentPrice - assetsValue;
    var increase = Math.round(profit / assetsValue * 100);

    this.assetsValue.style_class = profit > 0 ? 'green' : 'red';
    this.assetsValue.set_text(this.getFormattedPrice(profit) + " | " + this.getFormattedPercent(increase));
  },

  addChange: function(title, changeLabel, changeValue) {
    var row = new St.BoxLayout({
      vertical: false,
      width: WIDTH - PADDING,
      style_class: 'row containerCenter'
    });

    var left = new St.BoxLayout({
      vertical: true,
      width: 110,
      style_class: 'left'
    });
    var right = new St.BoxLayout({
      vertical: true,
      width: 100,
      style_class: 'right'
    });

    var label = new St.Label();
    label.set_text(title);
    left.add(label);

    this.setChangeData(changeLabel, changeValue);
    right.add(changeLabel);

    row.add(left);
    row.add(right);

    return row;
  },

  setChangeData: function(label, num) {
    num = parseFloat(num);

    var cls = 'green';
    if (num < 0) {
      cls = 'red';
    }

    label.style_class = cls;
    label.set_text(this.getFormattedPercent(num));
  },

  addLastUpdated: function(date) {
    var row = new St.BoxLayout({
      vertical: false,
      width: WIDTH - PADDING,
      style_class: 'row'
    });
    var right = new St.BoxLayout({
      vertical: true,
      width: WIDTH - PADDING,
      style_class: 'lastUpdated'
    });
    right.set_style('font-size: ' + FONT_SIZE_LAST_UPDATED + 'px;');

    date = new Date(date);
    this.lastUpdatedLabel = new St.Label();
    this.lastUpdatedLabel.set_text(date.toLocaleString());

    right.add(this.lastUpdatedLabel);
    row.add(right);

    return row;
  },

  getFormattedPercent: function(percent) {
    var formattedPercent = percent.toLocaleString(undefined, {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + '%';

    if (percent > 0) {
      formattedPercent = "+" + formattedPercent;
    }

    return formattedPercent;
  },

  getFormattedPrice: function(price) {
    var options = {
      style: 'currency',
      currency: this.cfgCurrency.toLowerCase()
    };

    price = parseFloat(price);
    if (price > 0 && price < 1) {
      options['minimumFractionDigits'] = 5;
    }

    return price.toLocaleString(undefined, options);
  },

  setContainerStyle: function (container) {
    container.set_style(
      'font-size: ' + FONT_SIZE_CONTAINER + 'px; ' +
      'background-color: ' +  this.cfgBgColor + '; ' +
      'border-radius: ' + this.cfgBgBorderRadius + 'px;'
    );
  }
};

function main(metadata, desklet_id) {
  return new CryptocurrencyTicker(metadata, desklet_id);
}
