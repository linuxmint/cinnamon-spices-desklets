/*
 * Yahoo Finance Quotes
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
// text layouting and rendering
const Pango = imports.gi.Pango;
// Binding desklet to mainloop function
const Lang = imports.lang;
// Settings loader based on settings-schema.json file
const Settings = imports.ui.settings;
// translation support
const Gettext = imports.gettext;

// set true to enable debug logging
// to see the logs use Looking Glass Tool: Alt+F2 and type 'lg'
const DEBUGGING = false;

const C = require('./constants');
const Logger = require('./logger');
const Utilities = require('./utilities');
const QuoteReader = require('./quote-reader');

Gettext.bindtextdomain(C.UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(C.UUID, str);
}

function QuotesTable(metadata, deskletId, logger) {
    this.init(metadata, deskletId, logger);
}

QuotesTable.prototype = {

    init: function(metadata, deskletId, logger) {
        this.quoteUtils = new Utilities(logger);
        this.el = new St.Table({
            homogeneous: false
        });
    },

    currencyCodeToSymbolMap: {
        AED: "\u062F.\u0625", AFN: "\u060B", ALL: "Lek", AMD: "\u058F", ANG: "\u0192", AOA: "Kz", ARS: "$", AUD: "$", AWG: "\u0192", AZN: "\u20BC",
        BAM: "KM", BBD: "$", BDT: "\u09F3", BGN: "\u043B\u0432", BHD: "\u062F.\u0628", BIF: "FBu", BMD: "$", BND: "$", BOB: "Bs", BRL: "R$", BSD: "$", BTN: "Nu.", BWP: "P", BYN: "Br", BZD: "BZ$",
        CAD: "$", CDF: "FC", CHF: "CHF", CLP: "$", CNY: "\u00A5", COP: "$", CRC: "\u20A1", CUP: "\u20B1", CVE: "Esc", CZK: "K\u010D",
        DJF: "Fdj", DKK: "kr", DOP: "RD$", DZD: "\u062F.\u062C",
        EGP: "\u00A3", ERN: "Nfk", EUR: "\u20AC",
        FJD: "$", FKP: "\u00A3",
        GBP: "\u00A3", GEL: "\u20BE", GGP: "\u00A3", GHS: "\u00A2", GIP: "\u00A3", GMD: "D", GNF: "FG", GTQ: "Q", GYD: "$",
        HKD: "$", HNL: "L", HTG: "G", HUF: "Ft",
        IDR: "Rp", ILS: "\u20AA", IMP: "\u00A3", INR: "\u20B9", IQD: "\u0639.\u062F", IRR: "\uFDFC", ISK: "kr",
        JEP: "\u00A3", JMD: "J$", JOD: "\u062F.\u0623", JPY: "\u00A5",
        KES: "KSh", KGS: "\u20C0", KHR: "\u17DB", KMF: "CF", KPW: "\u20A9", KRW: "\u20A9", KWD: "\u062F.\u0643", KYD: "$", KZT: "\u20B8",
        LAK: "\u20AD", LBP: "\u00A3", LKR: "\u20A8", LRD: "$", LSL: "L", LYD: "\u0644.\u062F",
        MAD: ".\u062F.\u0645", MDL: "L", MGA: "Ar", MKD: "\u0434\u0435\u043D", MMK: "K", MNT: "\u20AE", MOP: "P", MRU: "UM", MUR: "\u20A8", MVR: "Rf", MWK: "K", MXN: "$", MYR: "RM", MZN: "MT",
        NAD: "$", NGN: "\u20A6", NIO: "C$", NOK: "kr", NPR: "\u20A8", NZD: "$",
        OMR: "\uFDFC",
        PAB: "B/.", PEN: "S/", PGK: "K", PHP: "\u20B1", PKR: "\u20A8", PLN: "z\u0142", PYG: "Gs",
        QAR: "\uFDFC",
        RON: "lei", RSD: "\u0414\u0438\u043D", RUB: "\u20BD", RWF: "FRw",
        SAR: "\uFDFC", SBD: "$", SCR: "\u20A8", SDG: "\u062C.\u0633", SEK: "kr", SGD: "$", SHP: "\u00A3", SLE: "Le", SOS: "S", SRD: "$", SSP: "SSP", SVC: "$", SYP: "\u00A3", SZL: "L",
        THB: "\u0E3F", TJS: "SM", TMT: "T", TND: "\u062F.\u062A", TOP: "T$", TRY: "\u20BA", TTD: "TT$", TVD: "$", TWD: "NT$", TZS: "T",
        UAH: "\u20B4", UGX: "USh", USD: "$", UYU: "$U", UZS: "\u043B\u0432",
        VEF: "Bs", VND: "\u20AB", VUV: "Vt",
        WST: "T",
        XAF: "F", XCD: "$", XOF: "F", XPF: "F",
        YER: "\uFDFC",
        ZAR: "R", ZMW: "K", ZWG: "ZK"
    },
    quoteChangeSymbolMap: {
        UP: "\u25B2",
        DOWN: "\u25BC",
        EQUALS: "\u25B6"
    },

    renderTable: function(quotes, symbolCustomizationMap, settings) {
        for (let rowIndex = 0, l = quotes.length; rowIndex < l; rowIndex++) {
            this.renderTableRow(quotes[rowIndex], symbolCustomizationMap, settings, rowIndex);
        }
    },

    renderTableRow: function(quote, symbolCustomizationMap, settings, rowIndex) {
        let cellContents = [];
        const symbol = quote.symbol;
        const symbolCustomization = symbolCustomizationMap.get(symbol);

        if (settings.changeIcon) {
            cellContents.push(this.createPercentChangeIcon(quote, settings));
        }
        if (settings.quoteName) {
            cellContents.push(this.createQuoteLabel(quote.displayName, symbolCustomization, settings.quoteLabelWidth, settings));
        }
        if (settings.quoteSymbol) {
            cellContents.push(this.createQuoteLabel(symbol, symbolCustomization, settings.quoteSymbolWidth, settings));
        }
        if (settings.marketPrice) {
            cellContents.push(this.createMarketPriceLabel(quote, settings));
        }
        if (settings.absoluteChange) {
            cellContents.push(this.createAbsoluteChangeLabel(quote, settings));
        }
        if (settings.percentChange) {
            cellContents.push(this.createPercentChangeLabel(quote, settings));
        }
        if (settings.tradeTime) {
            cellContents.push(this.createTradeTimeLabel(quote, settings));
        }

        for (let columnIndex = 0; columnIndex < cellContents.length; ++columnIndex) {
            this.el.add(cellContents[columnIndex], {
                row: rowIndex,
                col: columnIndex
            });
        }
    },

    createQuoteLabel: function(labelText, symbolCustomization, width, settings) {
        const label = new St.Label({
            text: labelText,
            style_class: "quotes-label",
            reactive: settings.linkQuote,
            style: "width:" + width + "em; " + this.buildCustomStyle(settings, symbolCustomization)
        });

        if (settings.linkQuote) {
            const symbolButton = new St.Button();
            symbolButton.add_actor(label);
            symbolButton.connect("clicked", Lang.bind(this, function() {
                Gio.app_info_launch_default_for_uri(C.YF_QUOTE_PAGE_URL + symbolCustomization.symbol, global.create_app_launch_context());
            }));
            return symbolButton;
        } else {
            return label;
        }
    },

    createMarketPriceLabel: function(quote, settings) {
        let currencySymbol = "";
        if (settings.currencySymbol && this.quoteUtils.existsProperty(quote, "currency")) {
            currencySymbol = this.currencyCodeToSymbolMap[quote.currency] || quote.currency;
        }
        return new St.Label({
            text: currencySymbol + (this.quoteUtils.existsProperty(quote, "regularMarketPrice")
                ? this.roundAmount(quote.regularMarketPrice, settings.decimalPlaces, settings.strictRounding)
                : C.ABSENT),
            style_class: "quotes-number",
            style: this.buildFontStyle(settings)
        });
    },

    createAbsoluteChangeLabel: function(quote, settings) {
        let absoluteChangeText = "";
        if (this.quoteUtils.existsProperty(quote, "regularMarketChange")) {
            let absoluteChange = this.roundAmount(quote.regularMarketChange, settings.decimalPlaces, settings.strictRounding);
            if (absoluteChange > 0.0) {
                absoluteChangeText = "+";
            }
            absoluteChangeText += absoluteChange;
        } else {
            absoluteChangeText = C.ABSENT;
        }

        return new St.Label({
            text: absoluteChangeText,
            style_class: "quotes-number",
            style: this.buildFontStyle(settings)
        });
    },

    createPercentChangeIcon: function(quote, settings) {
        const percentChange = this.quoteUtils.existsProperty(quote, "regularMarketChangePercent")
            ? parseFloat(quote.regularMarketChangePercent)
            : 0.00;
        let iconText = this.quoteChangeSymbolMap["EQUALS"];
        let iconColor = settings.unchangedTrendColor;

        if (percentChange > 0) {
            iconText = this.quoteChangeSymbolMap["UP"];
            iconColor = settings.uptrendChangeColor;
        } else if (percentChange < 0) {
            iconText = this.quoteChangeSymbolMap["DOWN"];
            iconColor = settings.downtrendChangeColor;
        }

        return new St.Label({
            text: iconText,
            style: this.buildColorAttribute(iconColor, null) + this.buildFontSizeAttribute(settings.fontSize)
        });
    },

    createPercentChangeLabel: function(quote, settings) {
        let labelColor = settings.fontColor;
        if (settings.colorPercentChange && this.quoteUtils.existsProperty(quote, "regularMarketChangePercent")) {
            const percentageChange = parseFloat(quote.regularMarketChangePercent);
            if (percentageChange > 0) {
                labelColor = settings.uptrendChangeColor;
            } else if (percentageChange < 0) {
                labelColor = settings.downtrendChangeColor;
            } else {
                labelColor = settings.unchangedTrendColor;
            }
        }

        return new St.Label({
            text: this.quoteUtils.existsProperty(quote, "regularMarketChangePercent")
                ? (this.roundAmount(quote.regularMarketChangePercent, 2, settings.strictRounding) + "%")
                : C.ABSENT,
            style_class: "quotes-number",
            style: this.buildColorAttribute(labelColor, null) + this.buildFontSizeAttribute(settings.fontSize)
        });
    },

    roundAmount: function(amount, maxDecimals, strictRounding) {
        if (maxDecimals > -1) {
            if (strictRounding) {
                return amount.toFixed(maxDecimals);
            }
            const parts = amount.toString().split(".");
            if (parts.length > 1 && parts[1].length > maxDecimals) {
                return Number(amount.toFixed(maxDecimals));
            }
        }
        return amount;
    },

    isToday: function(date) {
        const today = new Date();
        return date.getFullYear() === today.getFullYear()
            && date.getMonth() === today.getMonth()
            && date.getDate() === today.getDate();
    },

    formatTime: function(unixTimestamp, settings) {
        const ts = new Date(unixTimestamp * 1000);
        let tsFormat = "";

        if (this.isToday(ts)) {
            if (settings.customTimeFormat) {
                tsFormat = ts.toLocaleFormat(settings.customTimeFormat);
            } else {
                tsFormat = ts.toLocaleTimeString(undefined, {
                    hour: "numeric",
                    hour12: !settings.use24HourTime,
                    minute: "numeric"
                });
            }
        } else {
            if (settings.customDateFormat) {
                tsFormat = ts.toLocaleFormat(settings.customDateFormat);
            } else {
                tsFormat = ts.toLocaleDateString(undefined, {
                    month: "numeric",
                    day: "numeric"
                });
            }
        }

        return tsFormat;
    },

    createTradeTimeLabel: function(quote, settings) {
        return new St.Label({
            text: this.quoteUtils.existsProperty(quote, "regularMarketTime")
                ? this.formatTime(quote.regularMarketTime, settings)
                : C.ABSENT,
            style_class: "quotes-number",
            style: this.buildFontStyle(settings)
        });
    },

    buildFontStyle(settings) {
        return this.buildColorAttribute(settings.fontColor, null) + this.buildFontSizeAttribute(settings.fontSize);
    },

    buildCustomStyle(settings, symbolCustomization) {
        return this.buildColorAttribute(settings.fontColor, symbolCustomization.color)
            + this.buildFontSizeAttribute(settings.fontSize)
            + this.buildFontStyleAttribute(symbolCustomization.style)
            + this.buildFontWeightAttribute(symbolCustomization.weight)
    },

    buildColorAttribute(globalColor, symbolColor) {
        return "color: " + (symbolColor !== null ? symbolColor : globalColor) + "; ";
    },

    buildFontSizeAttribute(fontSize) {
        return fontSize > 0 ? "font-size: " + fontSize + "px; " : "";
    },

    buildFontStyleAttribute(fontStyle) {
        return "font-style: " + fontStyle + "; ";
    },

    buildFontWeightAttribute(fontWeight) {
        return "font-weight: " + fontWeight + "; ";
    }
}

function StockQuoteDesklet(metadata, deskletId, logger) {
    this.init(metadata, deskletId, logger);
}

StockQuoteDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    init: function(metadata, deskletId, logger) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.logger = logger;
        this.quoteUtils = new Utilities(logger);
        this.logger.debug("init desklet, id: " + deskletId);
        this.metadata = metadata;
        this.id = deskletId;
        this.updateId = 0;
        this.updateInProgress = false;
        this.authAttempts = 0;
        this.quoteReader = new QuoteReader(metadata, deskletId, logger);
        // cache the last quotes response
        this.lastResponse = {
            symbolsArgument: "",
            responseResult: [],
            // we should never see this error message
            responseError: _("No quotes data to display"),
            lastUpdated: new Date()
        }

        this.loadSettings();
        if (this.cacheAuthorizationParameters) {
            this.quoteReader.restoreCachedAuthorizationParameters(this.authorizationParameters);
        }

        this.onQuotesListChanged();
    },

    loadSettings: function() {
        this.settings = new Settings.DeskletSettings(this, C.UUID, this.id);
        this.settings.bind("height", "height", this.onDisplaySettingChanged);
        this.settings.bind("width", "width", this.onDisplaySettingChanged);
        this.settings.bind("transparency", "transparency", this.onDisplaySettingChanged);
        this.settings.bind("showVerticalScrollbar", "showVerticalScrollbar", this.onRenderSettingsChanged);
        this.settings.bind("backgroundColor", "backgroundColor", this.onDisplaySettingChanged);
        this.settings.bind("cornerRadius", "cornerRadius", this.onDisplaySettingChanged);
        this.settings.bind("borderWidth", "borderWidth", this.onDisplaySettingChanged);
        this.settings.bind("borderColor", "borderColor", this.onDisplaySettingChanged);
        this.settings.bind("delayMinutes", "delayMinutes", this.onDataFetchSettingsChanged);
        this.settings.bind("showLastUpdateTimestamp", "showLastUpdateTimestamp", this.onRenderSettingsChanged);
        this.settings.bind("manualDataUpdate", "manualDataUpdate", this.onRenderSettingsChanged);
        this.settings.bind("roundNumbers", "roundNumbers", this.onRenderSettingsChanged);
        this.settings.bind("decimalPlaces", "decimalPlaces", this.onRenderSettingsChanged);
        this.settings.bind("strictRounding", "strictRounding", this.onRenderSettingsChanged);
        this.settings.bind("use24HourTime", "use24HourTime", this.onRenderSettingsChanged);
        this.settings.bind("customTimeFormat", "customTimeFormat", this.onRenderSettingsChanged);
        this.settings.bind("customDateFormat", "customDateFormat", this.onRenderSettingsChanged);
        this.settings.bind("quoteSymbols", "quoteSymbolsText"); // no callback, manual refresh required
        this.settings.bind("sortCriteria", "sortCriteria", this.onRenderSettingsChanged);
        this.settings.bind("sortDirection", "sortAscending", this.onRenderSettingsChanged);
        this.settings.bind("showChangeIcon", "showChangeIcon", this.onRenderSettingsChanged);
        this.settings.bind("showQuoteName", "showQuoteName", this.onRenderSettingsChanged);
        this.settings.bind("useLongQuoteName", "useLongQuoteName", this.onRenderSettingsChanged);
        this.settings.bind("linkQuoteName", "linkQuoteName", this.onRenderSettingsChanged);
        this.settings.bind("showQuoteSymbol", "showQuoteSymbol", this.onRenderSettingsChanged);
        this.settings.bind("linkQuoteSymbol", "linkQuoteSymbol", this.onRenderSettingsChanged);
        this.settings.bind("showMarketPrice", "showMarketPrice", this.onRenderSettingsChanged);
        this.settings.bind("showCurrencyCode", "showCurrencyCode", this.onRenderSettingsChanged);
        this.settings.bind("showAbsoluteChange", "showAbsoluteChange", this.onRenderSettingsChanged);
        this.settings.bind("showPercentChange", "showPercentChange", this.onRenderSettingsChanged);
        this.settings.bind("colorPercentChange", "colorPercentChange", this.onRenderSettingsChanged);
        this.settings.bind("showTradeTime", "showTradeTime", this.onRenderSettingsChanged);
        this.settings.bind("fontColor", "fontColor", this.onRenderSettingsChanged);
        this.settings.bind("scaleFontSize", "scaleFontSize", this.onRenderSettingsChanged);
        this.settings.bind("fontScale", "fontScale", this.onRenderSettingsChanged);
        this.settings.bind("uptrendChangeColor", "uptrendChangeColor", this.onRenderSettingsChanged);
        this.settings.bind("downtrendChangeColor", "downtrendChangeColor", this.onRenderSettingsChanged);
        this.settings.bind("unchangedTrendColor", "unchangedTrendColor", this.onRenderSettingsChanged);
        this.settings.bind("cacheAuthorizationParameters", "cacheAuthorizationParameters"); // no callback, manual refresh required
        this.settings.bind("authorizationParameters", "authorizationParameters"); // no callback, manual refresh required
        this.settings.bind("sendCustomUserAgent", "sendCustomUserAgent"); // no callback, manual refresh required
        this.settings.bind("customUserAgent", "customUserAgent");  // no callback, manual refresh required
        this.settings.bind("enableCurl", "enableCurl"); // no callback, manual refresh required
        this.settings.bind("curlCommand", "curlCommand"); // no callback, manual refresh required
    },

    getQuoteDisplaySettings: function(quotes) {
        return {
            "changeIcon": this.showChangeIcon,
            "quoteName": this.showQuoteName,
            "useLongName": this.useLongQuoteName,
            "linkQuote": this.linkQuoteName,
            "quoteSymbol": this.showQuoteSymbol,
            "linkSymbol": this.linkQuoteSymbol,
            "marketPrice": this.showMarketPrice,
            "currencySymbol": this.showCurrencyCode,
            "absoluteChange": this.showAbsoluteChange,
            "percentChange": this.showPercentChange,
            "colorPercentChange": this.colorPercentChange,
            "tradeTime": this.showTradeTime,
            "decimalPlaces": this.roundNumbers ? this.decimalPlaces : -1,
            "strictRounding": this.roundNumbers && this.strictRounding,
            "use24HourTime": this.use24HourTime,
            "customTimeFormat": this.customTimeFormat,
            "customDateFormat": this.customDateFormat,
            "fontColor": this.fontColor,
            "fontSize": this.scaleFontSize ? Math.round(C.BASE_FONT_SIZE * this.fontScale * global.ui_scale) : -1,
            "uptrendChangeColor": this.uptrendChangeColor,
            "downtrendChangeColor": this.downtrendChangeColor,
            "unchangedTrendColor": this.unchangedTrendColor,
            "quoteSymbolWidth": Math.max.apply(Math, quotes.map((quote) => quote.symbol.length)),
            "quoteLabelWidth": Math.max.apply(Math, quotes.map((quote) => quote.displayName.length)) / 2 + 2
        }
    },

    getNetworkSettings: function() {
        let curlCommandEnabledAndExists = false;
        if (this.enableCurl) {
            if (this.curlCommand && Gio.file_new_for_path(this.curlCommand).query_exists(null)) {
                curlCommandEnabledAndExists = true;
            } else {
                this.logger.warning("Invalid path [" + this.curlCommand + "] configured for curl executable. Curl will not be used.");
            }
        }

        return {
            "cacheAuthorizationParameters": this.cacheAuthorizationParameters,
            "sendCustomUserAgent": this.sendCustomUserAgent,
            "customUserAgent": this.sendCustomUserAgent ? this.customUserAgent : null,
            "enableCurl": curlCommandEnabledAndExists,
            "curlCommand": curlCommandEnabledAndExists ? this.curlCommand : null
        }
    },

    createLastUpdateLabel: function(lastUpdated, settings) {
        const label = new St.Label({
            text: _("Updated at ") + this.formatCurrentTimestamp(lastUpdated, settings),
            style_class: "quotes-last-update",
            reactive: this.manualDataUpdate,
            style: "color: " + settings.fontColor + "; " + (settings.fontSize > 0 ? "font-size: " + settings.fontSize + "px;" : "")
        });

        if (this.manualDataUpdate) {
            const updateButton = new St.Button();
            updateButton.add_actor(label);
            updateButton.connect("clicked", Lang.bind(this, function() {
                this.onManualRefreshRequested();
            }));
            return updateButton;
        } else {
            return label;
        }
    },

    formatCurrentTimestamp: function(lastUpdated, settings) {
        if (settings.customTimeFormat) {
            return lastUpdated.toLocaleFormat(settings.customTimeFormat);
        } else {
            return lastUpdated.toLocaleTimeString(undefined, {
                hour: "numeric",
                hour12: !settings.use24HourTime,
                minute: "numeric",
                second: "numeric"
            });
        }
    },

    createErrorLabel: function(responseError) {
        const errorMsg = _("Error: ") + JSON.stringify(responseError);
        this.logger.warning(errorMsg);

        const errorLabel = new St.Label({
            text: errorMsg,
            style_class: "error-label"
        });
        const clutterText = errorLabel.clutter_text;
        clutterText.line_wrap = true;
        clutterText.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        clutterText.ellipsize = Pango.EllipsizeMode.NONE;
        
        return errorLabel;
    },

    // called on events that change the desklet window
    onDisplaySettingChanged: function() {
        this.logger.debug("onDisplaySettingChanged");
        this.mainBox.set_size(this.width, this.height);
        this.setDeskletStyle();
    },

    setDeskletStyle: function() {
        let style = "background-color: " + this.buildBackgroundColor(this.backgroundColor, this.transparency) + "; ";

        let effectiveBorderRadius = this.cornerRadius;
        if (this.borderWidth > 0) {
            style += "border: " + this.borderWidth + "px solid " + this.borderColor + "; ";
            if (this.borderWidth > this.cornerRadius) {
                effectiveBorderRadius = this.borderWidth;
            }
        }

        style += "border-radius: " + effectiveBorderRadius + "px;";

        this.mainBox.style = style;
    },

    buildBackgroundColor: function(rgbColorString, transparencyFactor) {
        // parse RGB values between "rgb(...)"
        const rgb = rgbColorString.match(/\((.*?)\)/)[1].split(",");
        return "rgba(" + parseInt(rgb[0]) + "," + parseInt(rgb[1]) + "," + parseInt(rgb[2]) + "," + transparencyFactor + ")";
    },

    // called on events that change the quotes data layout (sorting, show/hide fields, text color, etc)
    onRenderSettingsChanged: function() {
        this.logger.debug("onRenderSettingsChanged");
        this.render();
    },

    // called on events that change the way YFQ data are fetched (data refresh interval)
    onDataFetchSettingsChanged: function() {
        this.logger.debug("onDataFetchSettingsChanged");
        this.removeUpdateTimer();
        this.setUpdateTimer();
    },

    // called when user requests a data refresh (by button from settings, or by link on last-update-timestamp)
    onManualRefreshRequested: function() {
        this.logger.debug("onManualRefreshRequested");
        this.onQuotesListChanged();
    },

    // called when user applies network settings
    onNetworkSettingsChanged: function() {
        this.logger.debug("onNetworkSettingsChanged");

        // reset auth state
        this.authAttempts = 0;
        this.quoteReader.dropAuthParams();
        this.saveAuthorizationParameters(true);
        this.logger.info("Dropped all autborization parameters");

        this.removeUpdateTimer();
        this.setUpdateTimer(true);
    },

    // called on events that change the quotes data (quotes list)
    // BEWARE: DO NOT use this function as callback in settings.bind() - otherwise multiple YFQ requests are fired, and multiple timers are created!
    onQuotesListChanged: function() {
        this.logger.debug("onQuotesListChanged");

        // if a YFQ query is currently running, do short-circuit here
        if (this.updateInProgress) {
            this.logger.debug("Data refresh in progress");
            return;
        }
        this.removeUpdateTimer();

        const quoteSymbolsArg = this.quoteUtils.buildSymbolsArgument(this.quoteSymbolsText);
        const networkSettings = this.getNetworkSettings();

        try {
            if (this.quoteReader.hasCrumb()) {
                this.fetchFinanceDataAndRender(quoteSymbolsArg, networkSettings);
            } else if (this.hasRemainingAuthAttempts()) {
                this.fetchCookieAndRender(quoteSymbolsArg, networkSettings);
            } else {
                // else give up on authorization and clear all
                this.logger.debug("No more auth attempts left, dropping all auth params");
                this.quoteReader.dropAuthParams();
                this.saveAuthorizationParameters(true);
            }
        } catch (err) {
            this.logger.error("Cannot fetch quotes information for symbol %s due to error: %s".format(quoteSymbolsArg, err));
            this.processFailedFetch(err);
        }
    },

    fetchFinanceDataAndRender: function(quoteSymbolsArg, networkSettings) {
        this.logger.debug("fetchFinanceDataAndRender. quotes: " + quoteSymbolsArg + ", network settings: " + Object.entries(networkSettings));
        const _that = this;

        this.quoteReader.retrieveFinanceData(quoteSymbolsArg, networkSettings, function(response, instantTimer = false, dropCachedAuthParams = false) {
            _that.logger.debug("YF query response: " + response);
            if (dropCachedAuthParams) {
                _that.saveAuthorizationParameters(true);
            }
            try {
                let parsedResponse = JSON.parse(response);
                _that.lastResponse = {
                    symbolsArgument: quoteSymbolsArg,
                    responseResult: parsedResponse.quoteResponse.result,
                    responseError: parsedResponse.quoteResponse.error,
                    lastUpdated: new Date()
                }

                _that.setUpdateTimer(instantTimer);
                _that.render();
            } catch (e) {
                _that.logger.error("Query response is not valid JSON: " + e);
                // set current quotes list to pass check that quotes list has not changed in render()
                _that.processFailedFetch(e, quoteSymbolsArg);
            }
        });
    },

    fetchCookieAndRender: function(quoteSymbolsArg, networkSettings) {
        this.logger.debug("fetchCookieAndRender. quotes: " + quoteSymbolsArg + ", network settings: " + Object.entries(networkSettings));
        const _that = this;

        this.quoteReader.retrieveCookie(networkSettings, function(authResponseMessage, responseBody) {
            _that.logger.debug("Cookie response body: " + responseBody);
            if (_that.quoteReader.existsCookieInJar(C.AUTH_COOKIE)) {
                _that.fetchCrumbAndRender(quoteSymbolsArg, networkSettings);
            } else if (_that.quoteReader.existsCookieInJar(C.CONSENT_COOKIE)) {
                _that.processConsentAndRender(authResponseMessage, responseBody, quoteSymbolsArg, networkSettings);
            } else {
                _that.logger.warning("Failed to retrieve auth cookie!");
                _that.authAttempts++;
                _that.processFailedFetch(_("Failed to retrieve authorization parameter! Unable to fetch quotes data. Status: ") + _that.quoteUtils.getMessageStatusInfo(authResponseMessage));
            }
        });
    },

    processConsentAndRender: function(authResponseMessage, consentPage, quoteSymbolsArg, networkSettings) {
        this.logger.debug("processConsentAndRender");
        const _that = this;
        const formElementRegex = /(<form method="post")(.*)(action="">)/;
        const formInputRegex = /(<input type="hidden" name=")(.*?)(" value=")(.*?)(">)/g;

        let consentFormFields = "";
        if (formElementRegex.test(consentPage)) {
            let maxFields = 0;
            let hiddenField;
            while (maxFields < 20 && (hiddenField = formInputRegex.exec(consentPage)) !== null) {
                consentFormFields = consentFormFields + hiddenField[2] + "=" + hiddenField[4] + "&";
                maxFields++;
            }
            consentFormFields += "reject=reject";

            this.quoteReader.postConsent(networkSettings, consentFormFields, function(consentResponseMessage) {
                if (_that.quoteReader.existsCookieInJar(C.AUTH_COOKIE)) {
                    _that.fetchCrumbAndRender(quoteSymbolsArg, networkSettings);
                } else {
                    _that.logger.warning("Failed to retrieve auth cookie from consent form");
                    _that.authAttempts++;
                    _that.processFailedFetch(_("Consent processing failed! Unable to fetch quotes data. Status: ") + _that.quoteUtils.getMessageStatusInfo(consentResponseMessage));
                }
            });
        } else {
            this.logger.warning("Consent form not detected");
            this.authAttempts++;
            this.processFailedFetch(_("Consent processing not completed! Unable to fetch quotes data. Status: ") + this.quoteUtils.getMessageStatusInfo(authResponseMessage));
        }
    },

    fetchCrumbAndRender: function(quoteSymbolsArg, networkSettings) {
        this.logger.debug("fetchCrumbAndRender");
        const _that = this;

        if (!this.hasRemainingAuthAttempts()) {
            return;
        }

        this.quoteReader.retrieveCrumb(networkSettings, function(crumbResponseMessage, responseBody) {
            _that.logger.debug("Crumb response body: " + responseBody);
            if (responseBody) {
                if (typeof responseBody.data === "string" && responseBody.data.trim() !== "" && !/\s/.test(responseBody.data)) {
                    // libsoup2
                    _that.quoteReader.setCrumb(responseBody.data);
                } else if (typeof responseBody === "string" && responseBody.trim() !== "" && !/\s/.test(responseBody)) {
                    // libsoup3, curl
                    _that.quoteReader.setCrumb(responseBody);
                } else {
                    _that.logger.warning("Unhandled crumb response body: " + responseBody);
                }
            }

            if (_that.quoteReader.hasCrumb()) {
                _that.logger.info("Successfully retrieved all authorization parameters");
                if (networkSettings.cacheAuthorizationParameters) {
                    _that.saveAuthorizationParameters();
                }
                _that.fetchFinanceDataAndRender(quoteSymbolsArg, networkSettings);
            } else {
                _that.logger.warning("Failed to retrieve crumb!");
                _that.authAttempts++;
                _that.saveAuthorizationParameters(true);
                _that.processFailedFetch(_('Failed to retrieve authorization crumb! Unable to fetch quotes data. Status: ') + _that.quoteUtils.getMessageStatusInfo(crumbResponseMessage));
            }
        });
    },

    saveAuthorizationParameters: function(dropCachedAuthParams = false) {
        const authParamsJson = dropCachedAuthParams ? C.DEFAULT_CACHED_AUTH_PARAMS : this.quoteReader.getAuthorizationParametersToCache();
        this.settings.setValue("authorizationParameters", authParamsJson);
        this.logger.debug("Saved authorization parameters to desklet settings: " + authParamsJson);
    },


    hasRemainingAuthAttempts: function() {
        return this.authAttempts < C.MAX_AUTH_ATTEMPTS;
    },

    processFailedFetch: function(errorMessage, symbolsArg = "") {
        this.logger.debug("processFailedFetch, errorMessage: " + errorMessage);
        const errorResponse = JSON.parse(this.quoteReader.buildErrorResponse(errorMessage));
        this.lastResponse = {
            symbolsArgument: symbolsArg,
            responseResult: errorResponse.quoteResponse.result,
            responseError: errorResponse.quoteResponse.error,
            lastUpdated: new Date()
        }

        this.setUpdateTimer();
        this.render();
    },

    setUpdateTimer: function(instantTimer = false) {
        this.logger.debug("setUpdateTimer, instantTimer: " + instantTimer);
        if (this.updateInProgress) {
            let delaySeconds = this.delayMinutes * 60;
            if (instantTimer) {
                this.logger.debug("add instant timer");
                delaySeconds = 1;
            }
            this.updateId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delaySeconds, () => { this.onQuotesListChanged() });
            this.logger.debug("Started new timer, updateId: " + this.updateId);
            this.updateInProgress = false;
        }
    },

    // main method to render the desklet
    render: function() {
        this.logger.debug("render");

        // check if quotes list was changed but no call of onQuotesListChanged() occurred, e.g. on layout changes
        if (this.hasRemainingAuthAttempts() &&
            !this.quoteUtils.compareSymbolsArgument(this.lastResponse.symbolsArgument, this.quoteSymbolsText)) {
            this.logger.debug("Detected changed quotes list, refreshing data");
            this.onQuotesListChanged();
            return;
        }

        // destroy the current view
        this.unrender();

        const tableContainer = new St.BoxLayout({
            vertical: true
        });

        // in case of errors, show details
        const responseError = this.lastResponse.responseError;
        if (responseError !== null) {
            tableContainer.add_actor(this.createErrorLabel(responseError));
        }

        const responseResult = this.lastResponse.responseResult;
        if (responseResult !== null) {
            const symbolCustomizationMap = this.quoteUtils.buildSymbolCustomizationMap(this.quoteSymbolsText);

            // some preparations before the rendering starts
            for (const quote of responseResult) {
                // sometimes YF returns a symbol we didn't query for
                // add such "new" symbols to the customization map for easier processing in the various render.. functions
                const returnedSymbol = quote.symbol;
                if (!symbolCustomizationMap.has(returnedSymbol)) {
                    this.logger.debug("Adding unknown symbol to customization map: " + returnedSymbol);
                    symbolCustomizationMap.set(returnedSymbol, this.quoteUtils.buildSymbolCustomization(returnedSymbol, new Map()));
                }

                // based on the custom settings, and the returned information, determine the name and store it directly in the quote
                this.quoteUtils.populateQuoteDisplayName(quote, symbolCustomizationMap.get(returnedSymbol), this.useLongQuoteName);
            }

            // (optional) sorting (do after we populated the display name within the quotes)
            const sortedResponseResult = this.quoteUtils.sortQuotesByProperty(responseResult, this.sortCriteria, this.sortAscending ? 1 : -1);

            // gather all settings that influence the rendering
            const displaySettings = this.getQuoteDisplaySettings(sortedResponseResult);

            const table = new QuotesTable(this.metadata, this.id, this.logger);
            // renders the quotes in a table structure
            table.renderTable(sortedResponseResult, symbolCustomizationMap, displaySettings);
            tableContainer.add_actor(table.el);

            if (this.showLastUpdateTimestamp) {
                tableContainer.add_actor(this.createLastUpdateLabel(this.lastResponse.lastUpdated, displaySettings));
            }
        }

        const scrollView = new St.ScrollView();
        scrollView.set_policy(Gtk.PolicyType.NEVER, this.showVerticalScrollbar ? Gtk.PolicyType.AUTOMATIC : Gtk.PolicyType.NEVER);
        scrollView.add_actor(tableContainer);

        this.mainBox = new St.BoxLayout({
            vertical: true,
            width: this.width,
            height: this.height,
            style_class: "quotes-reader"
        });
        // override default style with custom settings 
        this.setDeskletStyle();

        this.mainBox.add(scrollView, {
            expand: true
        });
        this.setContent(this.mainBox);
    },

    on_desklet_removed: function() {
        this.logger.debug("on_desklet_removed");
        this.removeUpdateTimer();
        this.unrender();
    },

    unrender: function() {
        this.logger.debug("unrender");
        if (this.mainBox) {
            this.mainBox.destroy_all_children();
            this.mainBox.destroy();
        }
    },

    removeUpdateTimer: function() {
        this.logger.debug("removeUpdateTimer, updateId: " + this.updateId);
        if (this.updateId > 0) {
            GLib.source_remove(this.updateId);
            this.logger.debug("removeUpdateTimer, timer removed for updateId: " + this.updateId);
        }
        this.updateId = 0;
        this.updateInProgress = true;
    }
}

function main(metadata, deskletId) {
    const logger = new Logger(C.UUID, deskletId, DEBUGGING);
    logger.debug("MAIN: DEBUGGING IS ENABLED");
    return new StockQuoteDesklet(metadata, deskletId, logger);
}
