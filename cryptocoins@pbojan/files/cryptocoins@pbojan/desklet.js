
const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Soup = imports.gi.Soup;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Util = imports.misc.util;

const UUID = "cryptocoins@pbojan";
const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID].path;
const WIDTH = 220;
const WIDTH_ICON = 50;
const PADDING = 10;
const HELP_URL = "https://github.com/pbojan/cryptocoins-desklet-cinnamon#usage-help";
const DONATE_URL = "https://github.com/pbojan/cryptocoins-desklet-cinnamon#contributedonate";
const API_URL = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest";

const httpSession = new Soup.SessionAsync();
Soup.Session.prototype.add_feature.call(httpSession, new Soup.ProxyResolverDefault());

function HelloDesklet(metadata, desklet_id) {
  this._init(metadata, desklet_id);
}

HelloDesklet.prototype = {
  __proto__: Desklet.Desklet.prototype,

  container: null,
  mainloop: null,

  // Labels
  priceLabel: null,
  change1H: null,
  change1D: null,
  change7D: null,

  _init: function(metadata, desklet_id) {
    try {
      Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

      this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
      this.settings.bind("apiKey", "cfgApiKey", this.onSettingsChanged);
      this.settings.bind("coin", "cfgCoin", this.onSettingsChanged);
      this.settings.bind("currency", "cfgCurrency", this.onSettingsChanged);
      this.settings.bind("refreshInterval", "cfgRefreshInterval", this.onRefreshIntervalChanged);

      this.setHeader('Crypto Coins Ticker');

      this.cfgApiKey = this.cfgApiKey || "";
      this.cfgCoin = this.cfgCoin || "1";
      this.cfgCurrency = this.cfgCurrency.toUpperCase() || "USD";
      this.cfgRefreshInterval = this.cfgRefreshInterval || 30;

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

    this.container.destroy_all_children();
    this.container.destroy();
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

  showNoApiKey: function() {
    var container = new St.BoxLayout({
      vertical: true,
      style_class: 'container'
    });

    var label = new St.Label({
      style_class: 'apikey'
    });
    label.set_text('Please set your api key in configuration...');
    container.add(label);

    this.setContent(container);
  },

  showLoading: function() {
    var container = new St.BoxLayout({
      vertical: true,
      style_class: 'container'
    });

    var label = new St.Label({
      style_class: 'loading'
    });
    label.set_text('Loading coin data...');
    container.add(label);

    this.setContent(container);
  },

  fetchData: function(initUI) {
    if (!this.cfgApiKey) {
      this.showNoApiKey();
      return;
    }

    this.showLoading();

    var message = Soup.Message.new(
        'GET',
        API_URL + '?id=' + parseInt(this.cfgCoin) + '&convert=' + this.cfgCurrency
    );
    message.request_headers.append('X-CMC_PRO_API_KEY', this.cfgApiKey);

    httpSession.queue_message(message,
      Lang.bind(this, function(session, response) {
        if (response.status_code !== Soup.KnownStatusCode.OK) {
          global.log('Error during download: response code ' +
              response.status_code + ': ' + response.reason_phrase + ' - ' +
              response.response_body.data);
          return;
        }

        var result = JSON.parse(message.response_body.data).data[this.cfgCoin];
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

    var date = new Date(data['last_updated'] * 1000);
    this.lastUpdatedLabel.set_text(date.toLocaleString());
  },

  setupUI: function(data) {
    this.container = new St.BoxLayout({
      vertical: true,
      width: WIDTH,
      style_class: 'container'
    });

    var quote = data['quote'][this.cfgCurrency];

    this.change1H = new St.Label();
    this.change1D = new St.Label();
    this.change7D = new St.Label();

    this.container.add(this.addHeaderAndTitle(data));
    this.container.add(this.addPrice(quote['price']));
    this.container.add(this.addChange('Change 1H:', this.change1H, quote['percent_change_1h']));
    this.container.add(this.addChange('Change 1D:', this.change1D, quote['percent_change_24h']));
    this.container.add(this.addChange('Change 7D:', this.change7D, quote['percent_change_7d']));
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
      width: WIDTH_ICON,
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
      width: WIDTH - PADDING - WIDTH_ICON,
      style_class: 'containerRight'
    });
    var label = new St.Label({
      style_class: 'header'
    });
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

    this.priceLabel = new St.Label();
    this.priceLabel.set_text(this.getFormattedPrice(price));

    center.add(this.priceLabel);
    row.add(center);

    return row;
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
    label.set_text(num.toLocaleString(undefined, {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + '%');
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

    date = new Date(date);
    this.lastUpdatedLabel = new St.Label();
    this.lastUpdatedLabel.set_text(date.toLocaleString());

    right.add(this.lastUpdatedLabel);
    row.add(right);

    return row;
  },W

  getFormattedPrice: function(price) {
    var options = {
      style: 'currency',
      currency: this.cfgCurrency.toLowerCase()
    };

    price = parseFloat(price);
    if (price < 1) {
      options['minimumFractionDigits'] = 5;
    }

    return price.toLocaleString(undefined, options);
  }
};

function main(metadata, desklet_id) {
  return new HelloDesklet(metadata, desklet_id);
}
