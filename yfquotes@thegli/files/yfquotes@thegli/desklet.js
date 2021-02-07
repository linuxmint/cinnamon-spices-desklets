/*
 * Yahoo Finance Quotes - 0.5.1
 *
 * Shows financial market information provided by Yahoo Finance.
 * This desklet is based on the work of fthuin's stocks desklet.
 * 
 */

// Cinnamon desklet user interface
const Desklet = imports.ui.desklet;
// Shell toolkit library from GNOME
const St = imports.gi.St;
// URL-IO-Operations
const Gio = imports.gi.Gio;
// Files operations
const GLib = imports.gi.GLib;
// Gtk library (policies for scrollview)
const Gtk = imports.gi.Gtk;
// for periodic data reload
const Mainloop = imports.mainloop;
// Binding desklet to mainloop function
const Lang = imports.lang;
// Settings loader based on settings-schema.json file
const Settings = imports.ui.settings;
// translation support
const Gettext = imports.gettext;

const UUID = "yfquotes@thegli";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
const ABSENT = "N/A";
const YF_PAGE = "https://finance.yahoo.com/quote/";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

var YahooFinanceQuoteReader = function () {
};

YahooFinanceQuoteReader.prototype = {
    constructor : YahooFinanceQuoteReader,
    yahooQueryBaseUrl : "https://query1.finance.yahoo.com/v7/finance/quote?symbols=",

    getQuotes : function (quoteSymbols) {
        const response = this.getYahooQueryResponse(this.createYahooQueryUrl(quoteSymbols));
        return this.fetchQuotes(response);
    },

    createYahooQueryUrl : function (quoteSymbols) {
        return this.yahooQueryBaseUrl + quoteSymbols.join(",");
    },

    getYahooQueryResponse : function (requestUrl) {
        const errorBegin="{\"quoteResponse\":{\"result\":[],\"error\":\"";
        const errorEnd = "\"}}";
        const urlcatch = Gio.file_new_for_uri(requestUrl);
        let response;
        
        const maxRetries = 5;
        let retries = 0;
        do {
            try {
                let [successful, contents, etag_out] = urlcatch.load_contents(null);
                if (successful) {
                    response = contents.toString();
                    retries = maxRetries;
                } else {
                    response = errorBegin + _("Yahoo Finance service not available!") + errorEnd;
                }
            } catch (err) {
                response = errorBegin + err + errorEnd;
            }
            
            retries++;
        } while (retries < maxRetries); 

        return JSON.parse(response);
    },

    fetchQuotes : function (response) {        
        return [response.quoteResponse.result, response.quoteResponse.error];
    }
};

var QuotesTable = function () {
    this.el = new St.Table({
        homogeneous : false
    });
};
QuotesTable.prototype = {
    constructor : QuotesTable,
    currencyCodeToSymbolMap : {
        USD : "$",
        EUR : "\u20AC",
        JPY : "\u00A5",
        GBP : "\u00A3",
        INR : "\u20A8"
    },

    render : function (quotes, settings) {
        for (let rowIndex = 0, l = quotes.length; rowIndex < l; rowIndex++) {
            this.renderTableRow(quotes[rowIndex], rowIndex, settings);
        }
    },

    renderTableRow : function (quote, rowIndex, shouldShow) {
        let cellContents = [];

        if (shouldShow.changeIcon) {
            cellContents.push(this.createPercentChangeIcon(quote));
        }
        if (shouldShow.quoteName) {
            cellContents.push(this.createQuoteNameLabel(quote, shouldShow.useLongName, shouldShow.linkQuote));
        }
        if (shouldShow.quoteSymbol) {
            cellContents.push(this.createQuoteSymbolLabel(quote, shouldShow.linkSymbol));
        }
        if (shouldShow.marketPrice) {
            cellContents.push(this.createMarketPriceLabel(quote, shouldShow.currencySymbol, shouldShow.decimalPlaces));
        }
        if (shouldShow.absoluteChange) {
            cellContents.push(this.createAbsoluteChangeLabel(quote, shouldShow.currencySymbol, shouldShow.decimalPlaces));
        }
        if (shouldShow.percentChange) {
            cellContents.push(this.createPercentChangeLabel(quote, shouldShow.colorPercentChange));
        }
        if (shouldShow.tradeTime) {
            cellContents.push(this.createTradeTimeLabel(quote));
        }

        for (let columnIndex = 0; columnIndex < cellContents.length; ++columnIndex) {
            this.el.add(cellContents[columnIndex], {
                row : rowIndex,
                col : columnIndex,
                style_class : "quotes-table-item"
            });
        }
    },

    existsProperty : function(object, property) {
      return object.hasOwnProperty(property) && typeof object[property] !== "undefined" && object[property] !== null;
    },

    createQuoteSymbolLabel : function (quote, addLink) {
        const symbolLabel =  new St.Label({
            text : quote.symbol,
            style_class : "quotes-label",
            reactive : addLink ? true : false
        });

        if (addLink) {
            const symbolButton = new St.Button();
            symbolButton.add_actor(symbolLabel);
            symbolButton.connect("clicked", Lang.bind(this, function() {
                Gio.app_info_launch_default_for_uri(YF_PAGE + quote.symbol, global.create_app_launch_context());
            }));
            return symbolButton;
         } else {
            return symbolLabel;
         }
    },

    createMarketPriceLabel : function (quote, withCurrencySymbol, decimalPlaces) {
        let currencySymbol = "";
        if (withCurrencySymbol && this.existsProperty(quote, "currency")) {
            currencySymbol = this.currencyCodeToSymbolMap[quote.currency] || quote.currency;
        }
        return new St.Label({
            text : currencySymbol + (this.existsProperty(quote, "regularMarketPrice") ? this.roundAmount(quote.regularMarketPrice, decimalPlaces) : ABSENT),
            style_class : "quotes-label"
        });
    },

    determineQuoteName : function (quote, useLongName) {
        if (useLongName && this.existsProperty(quote, "longName")) {
            return quote.longName;
        } else if (this.existsProperty(quote, "shortName")) {
            return quote.shortName;
        } 

        return ABSENT;
    },

    createQuoteNameLabel : function (quote, useLongName, addLink) {
        const nameLabel =  new St.Label({
            text : this.determineQuoteName(quote, useLongName),
            style_class : "quotes-label",
            reactive : addLink ? true : false
        });

        if (addLink) {
            const nameButton = new St.Button();
            nameButton.add_actor(nameLabel);
            nameButton.connect("clicked", Lang.bind(this, function() {
                Gio.app_info_launch_default_for_uri(YF_PAGE + quote.symbol, global.create_app_launch_context());
            }));
            return nameButton;
         } else {
            return nameLabel;
         }
    },

    createAbsoluteChangeLabel : function (quote, withCurrencySymbol, decimalPlaces) {
        var absoluteChangeText = "";
        if (this.existsProperty(quote, "regularMarketChange")) {
            let absoluteChange = this.roundAmount(quote.regularMarketChange, decimalPlaces);
            if (absoluteChange > 0.0) {
                absoluteChangeText = "+";
            }
            absoluteChangeText += absoluteChange;
        } else {
            absoluteChangeText = ABSENT;
        }

        return new St.Label({
            text : absoluteChangeText,
            style_class : "quotes-label"
        });
    },

    createPercentChangeIcon : function (quote) {
        const percentChange = this.existsProperty(quote, "regularMarketChangePercent") ? parseFloat(quote.regularMarketChangePercent) : 0.0;
        let path = "";

        if (percentChange > 0) {
            path = "/icons/up.svg";
        } else if (percentChange < 0) {
            path = "/icons/down.svg";
        } else if (percentChange === 0.0) {
            path = "/icons/eq.svg";
        }

        const iconFile = Gio.file_new_for_path(DESKLET_DIR + path);
        const uri = iconFile.get_uri();
        const image = St.TextureCache.get_default().load_uri_async(uri, -1, -1);
        image.set_size(20, 20);

        const binIcon = new St.Bin({
            height : "20",
            width : "20"
        });
        binIcon.set_child(image);
        return binIcon;
    },

    createPercentChangeLabel : function (quote, useTrendColors) {
        let trendClassSuffix = "";
        if (useTrendColors && this.existsProperty(quote, "regularMarketChangePercent")) {
            const percentageChange = parseFloat(quote.regularMarketChangePercent);
            if (percentageChange > 0) {
                trendClassSuffix = "-up";
            } else if (percentageChange < 0) {
                trendClassSuffix = "-down";
            }
        }

        return new St.Label({
            text : this.existsProperty(quote, "regularMarketChangePercent") ? (this.roundAmount(quote.regularMarketChangePercent, 2) + "%") : ABSENT,
            style_class : "quotes-label" + trendClassSuffix
        });
    },

    roundAmount : function (amount, maxDecimals) {
        if (maxDecimals > -1)  {
            const parts = amount.toString().split(".");
            if (parts.length > 1 && parts[1].length > maxDecimals) {
                return Number((amount).toFixed(maxDecimals));
            }
        }
        return amount;
    },

    isToday : function (date) {
        const today = new Date();
        return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth()
                && date.getDate() === today.getDate();
    },

    formatTime : function (unixTimestamp) {
        const ts = new Date(unixTimestamp * 1000);
        let tsFormat = "";

        if (this.isToday(ts)) {
            tsFormat = ts.toLocaleTimeString(undefined, {
                hour : "numeric",
                minute : "numeric"
            });
        } else {
            tsFormat = ts.toLocaleDateString(undefined, {
                month : "numeric",
                day : "numeric"
            });
        }

        return tsFormat;
    },

    createTradeTimeLabel : function (quote) {
        return new St.Label({
            text : this.existsProperty(quote, "regularMarketTime") ? this.formatTime(quote.regularMarketTime) : ABSENT,
            style_class : "quotes-label"
        });
    }
};

function StockQuoteDesklet(metadata, id) {
    Desklet.Desklet.prototype._init.call(this, metadata, id);
    this.init(metadata, id);
}

StockQuoteDesklet.prototype = {
    __proto__ : Desklet.Desklet.prototype,
    init : function (metadata, id) {
        this.metadata = metadata;
        this.id = id;
        this.quoteReader = new YahooFinanceQuoteReader();
        this.loadSettings();
        this.onUpdate();
    },

    loadSettings : function () {
        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, this.id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "height", "height", this.onDisplayChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "width", "width", this.onDisplayChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "transparency", "transparency",
                this.onDisplayChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "delayMinutes", "delayMinutes",
                this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showLastUpdateTimestamp", "showLastUpdateTimestamp",
                this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "roundNumbers", "roundNumbers",
                this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "decimalPlaces", "decimalPlaces",
                this.onSettingsChanged, null);  
        this.settings.bindProperty(Settings.BindingDirection.IN, "quoteSymbols", "quoteSymbolsText",
                this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "sortCriteria", "sortCriteria",
                this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "sortDirection", "sortDirection",
                this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showChangeIcon", "showChangeIcon", 
                this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showQuoteName", "showQuoteName",
                this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "useLongQuoteName", "useLongQuoteName",
                this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "linkQuoteName", "linkQuoteName",
                this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showQuoteSymbol", "showQuoteSymbol",
                this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "linkQuoteSymbol", "linkQuoteSymbol",
                this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showMarketPrice", "showMarketPrice",
                this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showCurrencyCode", "showCurrencyCode",
                this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showAbsoluteChange", "showAbsoluteChange",
                this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showPercentChange", "showPercentChange",
                this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "colorPercentChange", "colorPercentChange",
                this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showTradeTime", "showTradeTime",
                this.onSettingsChanged, null);
    },

    getQuoteDisplaySettings : function () {
        return {
            "changeIcon" : this.showChangeIcon,
            "quoteName" : this.showQuoteName,
            "useLongName" : this.useLongQuoteName,
            "linkQuote" : this.linkQuoteName,
            "quoteSymbol" : this.showQuoteSymbol,
            "linkSymbol" : this.linkQuoteSymbol,
            "marketPrice" : this.showMarketPrice,
            "currencySymbol" : this.showCurrencyCode,
            "absoluteChange": this.showAbsoluteChange,
            "percentChange" : this.showPercentChange,
            "colorPercentChange" : this.colorPercentChange,
            "tradeTime" : this.showTradeTime,
            "decimalPlaces" : this.roundNumbers ? this.decimalPlaces : -1
        };
    },

    formatCurrentTimestamp : function () {
        const now = new Date();

        return now.toLocaleTimeString(undefined, {
            hour : "numeric",
            minute : "numeric",
            second : "numeric"
        });
    },

    createLastUpdateLabel : function () {
        return new St.Label({
            text : _("Updated at ") + this.formatCurrentTimestamp(),
            style_class : "quotes-label"
        });
    },

    createErrorLabel : function (errorMsg) {
        return new St.Label({
            text : _("Error: ") + errorMsg,
            style_class : "error-label"
        });
    },

    onDisplayChanged : function () {
        this.mainBox.set_size(this.width, this.height);
        this.setTransparency();
    },

    setTransparency:function() {
        this.mainBox.style = "background-color: rgba(0, 0, 0, " + this.transparency + ")";
    },

    onSettingsChanged : function () {
        this.unrender();
        this.removeUpdateTimer();
        this.onUpdate();
    },

    on_desklet_removed : function () {
        this.unrender();
        this.removeUpdateTimer();
    },

    onUpdate : function () {
        const quoteSymbols = this.quoteSymbolsText.split("\n");
        try {
          let quotes = this.quoteReader.getQuotes(quoteSymbols);
          this.render(quotes);
          this.setUpdateTimer();
        } catch (err) {
          this.onError(quoteSymbols, err);
        }
    },

    setUpdateTimer : function () {
        this.updateLoop = Mainloop.timeout_add(this.delayMinutes * 60 * 1000, Lang.bind(this, this.onUpdate));
    },

    onError : function (quoteSymbols, err) {
      global.logError(_("Cannot display quotes information for symbols: ") + quoteSymbols.join(","));
      global.logError(_("The following error occurred: ") + err);
    },

    sortByProperty: function (quotes, prop, direction) {        
        if (quotes.length < 2) {
            return quotes;
        }
        
        const clone = quotes.slice(0);
        clone.sort(function(q1, q2) {
            let p1 = "";
            if (q1.hasOwnProperty(prop) && typeof q1[prop] !== "undefined" && q1[prop] !== null) {
                p1 = q1[prop].toString().match(/^\d+$/) ? + q1[prop] : q1[prop];
            }
            let p2 = "";
            if (q2.hasOwnProperty(prop) && typeof q2[prop] !== "undefined" && q2[prop] !== null) {
                p2 = q2[prop].toString().match(/^\d+$/) ? + q2[prop] : q2[prop];
            }
            
            return ((p1 < p2) ? -1 : ((p1 > p2) ? 1 : 0)) * direction;
        });
        return clone;
    },

    render : function (quotes) {
        const tableContainer = new St.BoxLayout({
            vertical : true
        });
        
        // optional sort
        if (this.sortCriteria && this.sortCriteria !== "none") {
            quotes[0] = this.sortByProperty(quotes[0], this.sortCriteria, this.sortDirection ? 1 : -1);
        }
        
        // in case of errors, show details
        if (quotes[1] !== null) {
            tableContainer.add_actor(this.createErrorLabel(quotes[1]));
        }
        
        const table = new QuotesTable();
        table.render(quotes[0], this.getQuoteDisplaySettings());
        tableContainer.add_actor(table.el);
        
        if (this.showLastUpdateTimestamp) {
            tableContainer.add_actor(this.createLastUpdateLabel());
        }

        const scrollView = new St.ScrollView();
        scrollView.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        scrollView.add_actor(tableContainer);

        this.mainBox = new St.BoxLayout({
            vertical : true,
            width : this.width,
            height : this.height,
            style_class : "quotes-reader"
        });
        this.setTransparency();

        this.mainBox.add(scrollView, {
            expand : true
        });
        this.setContent(this.mainBox);
    },

    unrender : function () {
        this.mainBox.destroy_all_children();
        this.mainBox.destroy();
    },

    removeUpdateTimer : function () {
        Mainloop.source_remove(this.updateLoop);
    }
};

function main(metadata, id) {
    return new StockQuoteDesklet(metadata, id);
}
