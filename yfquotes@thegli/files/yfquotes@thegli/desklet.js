/*
 * Yahoo Finance quotes - 0.0.1, May 2018
 *
 * Shows stock quotes information provided by Yahoo Finance.
 * This desklet is based on the work of fthuin's stock desklet.
 * 
 */
/* jshint esversion : 6  */
const Desklet = imports.ui.desklet; // cinnamon desklet user interface
const St = imports.gi.St; // Shell toolkit library from GNOME
const Gio = imports.gi.Gio; // URL-IO-Operations
const GLib = imports.gi.GLib; // Files operations
const Gtk = imports.gi.Gtk; // Gtk library (policies for scrollview)
const Mainloop = imports.mainloop; // For repeated updating
const Lang = imports.lang; // Binding desklet to mainloop function
const Settings = imports.ui.settings; // Settings loader based on settings-schema.json file

var console = global; // So we can use console.log
var dirPath = "yfquotes@thegli";
var deskletDir = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/" + dirPath;

var YahooQueryStockQuoteReader = function () {
};

YahooQueryStockQuoteReader.prototype = {
	constructor: YahooQueryStockQuoteReader,
	yahooQueryBaseUrl: "https://query1.finance.yahoo.com/v7/finance/quote?symbols=",
	getStockQuotes(quoteSymbols) {
		var response = this.getYahooQueryResponse(this.createYahooQueryUrl(quoteSymbols));
		return this.fetchStockQuotes(response);
	},
    createYahooQueryUrl(quoteSymbols) {
        return this.yahooQueryBaseUrl + quoteSymbols.join(",");
    },
	getYahooQueryResponse(requestUrl) {
        var urlcatch = Gio.file_new_for_uri(requestUrl);
        var loaded = false,
            content;
        loaded = urlcatch.load_contents(null)[0];
        if (!loaded) {
            throw new Error("Yahoo Finance service not available!?");
        }
        content = urlcatch.load_contents(null)[1];
        return JSON.parse(content.toString());
    },
	fetchStockQuotes(response) {
        var quotes = [];
        var dataRows = response.quoteResponse.result;
        var i = 0;
        for (var rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
            if (dataRows[rowIndex].regularMarketChangePercent === null) {
                i++;
            } else {
                quotes[rowIndex-i] = dataRows[rowIndex];
            }
        }
        return quotes;
    }
};

var StockQuotesTable = function () {
    this.el = new St.Table({homogeneous: false});
};
StockQuotesTable.prototype = {
    constructor: StockQuotesTable,
    currencyCodeToSymbolMap: {
        USD: "$",
        EUR: "\u20AC",
        JPY: "\u00A5",
        GBP: "\u00A3",
        INR: "\u20A8"
    },
    render(stockQuotes, settings) {
        for (var rowIndex = 0, l = stockQuotes.length; rowIndex < l; rowIndex++) {
            this.renderTableRow(stockQuotes[rowIndex], rowIndex, settings);
        }
    },
    renderTableRow(stockQuote, rowIndex, shouldShow) {

        var cellContents = [];

        if (shouldShow.icon) {
            cellContents.push(this.createPercentChangeIcon(stockQuote));
        }
        if (shouldShow.stockName) {
            cellContents.push(this.createCompanyNameLabel(stockQuote));
        }
        if (shouldShow.stockTicker) {
            cellContents.push(this.createStockSymbolLabel(stockQuote));
        }
        if (shouldShow.stockPrice) {
            cellContents.push(this.createStockPriceLabel(stockQuote, shouldShow.showCurrencyCode));
        }
        if (shouldShow.percentChange) {
            cellContents.push(this.createPercentChangeLabel(stockQuote));
        }

        for (var columnIndex = 0; columnIndex < cellContents.length; ++columnIndex)
            this.el.add(cellContents[columnIndex], {
                row: rowIndex,
                col: columnIndex,
                style_class: "stocks-table-item"
            });
    },
    createStockSymbolLabel(stockQuote) {
        return new St.Label({
            text: stockQuote.symbol,
            style_class: "stocks-label"
        });
    },
    createStockPriceLabel(stockQuote, withCurrency) {
        var currencyCode = withCurrency ? stockQuote.currency : "";
        var currencySymbol = this.currencyCodeToSymbolMap[currencyCode] || currencyCode;
        return new St.Label({
            text: currencySymbol + "" + this.roundAmount(stockQuote.regularMarketPrice, 2),
            style_class: "stocks-label"
        });
    },
    createCompanyNameLabel(stockQuote) {
        return new St.Label({
            text: stockQuote.shortName,
            style_class: "stocks-label"
        });
    },
    createPercentChangeIcon(stockQuote) {
        var path = "";
        var percentChange = stockQuote.regularMarketChangePercent === null ? 0.0 : parseFloat(stockQuote.regularMarketChangePercent);

        if (percentChange > 0) {
            path = "/icons/up.svg";
        } else if (percentChange < 0) {
            path = "/icons/down.svg";
        } else if (percentChange === 0.0) {
            path = "/icons/eq.svg";
        }
        var iconFile = Gio.file_new_for_path(deskletDir + "" + path);

        var uri = iconFile.get_uri();
        var image = St.TextureCache.get_default().load_uri_async(uri, -1, -1);
        image.set_size(20, 20);

        var binIcon = new St.Bin({height: "20px", width: "20px"});
        binIcon.set_child(image);
        return binIcon;
    },
    createPercentChangeLabel(stockQuote) {
        return new St.Label({
            text: stockQuote.regularMarketChangePercent === null ? "N/A" : this.roundAmount(stockQuote.regularMarketChangePercent, 2) + "%",
            style_class: "stocks-label"
        });
    },
    roundAmount(amount, decimals) {
        return Number((amount).toFixed(decimals));
    }
};

function StockQuoteDesklet(metadata, id) {
    Desklet.Desklet.prototype._init.call(this, metadata, id);
    this.init(metadata, id);
}

StockQuoteDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,
    init(metadata, id) {
        this.metadata = metadata;
        this.id = id;
        this.stockReader = new YahooQueryStockQuoteReader();
        this.loadSettings();
        this.onUpdate();
    },
    loadSettings() {
        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, this.id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "height", "height", this.onDisplayChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "width", "width", this.onDisplayChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "delayMinutes", "delayMinutes", this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "companySymbols", "companySymbolsText", this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showIcon", "showIcon", this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showStockName", "showStockName", this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showStockSymbol", "showStockSymbol", this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showStockPrice", "showStockPrice", this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showCurrencyCode", "showCurrencyCode", this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showStockPercentChange", "showStockPercentChange", this.onSettingsChanged, null);
    },
    getQuoteDisplaySettings() {
      return {
          "icon": this.showIcon,
          "stockName": this.showStockName,
          "stockTicker": this.showStockSymbol,
          "stockPrice": this.showStockPrice,
          "showCurrencyCode": this.showCurrencyCode,
          "percentChange": this.showStockPercentChange
      };
    },
    onDisplayChanged() {
        this.resize();
    },
    onSettingsChanged() {
        this.unrender();
        this.removeUpdateTimer();
        this.onUpdate();
    },
    on_desklet_removed() {
        this.unrender();
        this.removeUpdateTimer();
    },
    onUpdate() {
        var companySymbols = this.companySymbolsText.split("\n");
        try {
            var stockQuotes = this.stockReader.getStockQuotes(companySymbols);
            this.render(stockQuotes);
            this.setUpdateTimer();
        }
        catch (err) {
            this.onError(companySymbols, err);
        }
    },
    onError(companySymbols, err) {
        console.log("Cannot get stock quotes for company symbols: " + companySymbols.join(","));
        console.log("The following error occured: " + err);
        console.log("Shutting down...");
    },
    render(stockQuotes) {
        var table = new StockQuotesTable();
        table.render(stockQuotes, this.getQuoteDisplaySettings());

        var tableContainer = new St.BoxLayout({
            vertical: true
        });
        tableContainer.add_actor(table.el);

        var scrollView = new St.ScrollView();
        scrollView.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        scrollView.add_actor(tableContainer);

        this.mainBox = new St.BoxLayout({
            vertical: true,
            width: this.width,
            height: this.height,
            style_class: "stocks-reader"
        });
        this.mainBox.add(scrollView, {expand: true});
        this.setContent(this.mainBox);
    },
    unrender() {
        this.mainBox.destroy_all_children();
        this.mainBox.destroy();
    },
    resize() {
        this.mainBox.set_size(this.width, this.height);
    },
    setUpdateTimer() {
        this.updateLoop = Mainloop.timeout_add(this.delayMinutes * 60 * 1000, Lang.bind(this, this.onUpdate));
    },
    removeUpdateTimer() {
        Mainloop.source_remove(this.updateLoop);
    }
};

function main(metadata, id) {
    return new StockQuoteDesklet(metadata, id);
}
