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
const Soup = imports.gi.Soup;
const ByteArray = imports.byteArray;
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
const IS_SOUP_2 = Soup.MAJOR_VERSION === 2;

const YF_COOKIE_URL = "https://finance.yahoo.com/quote/%5EGSPC/options";
const YF_CONSENT_URL = "https://consent.yahoo.com/v2/collectConsent";
const YF_CRUMB_URL = "https://query2.finance.yahoo.com/v1/test/getcrumb";
const YF_QUOTE_PAGE_URL = "https://finance.yahoo.com/quote/";

const ACCEPT_HEADER = "Accept";
const ACCEPT_VALUE_COOKIE = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const ACCEPT_VALUE_CRUMB = "*/*";
const ACCEPT_ENCODING_HEADER = "Accept-Encoding";
const ACCEPT_ENCODING_VALUE = "gzip, deflate";
const USER_AGENT_HEADER = "User-Agent";
const FORM_URLENCODED_VALUE = "application/x-www-form-urlencoded";

const AUTH_COOKIE = "A1";
const CONSENT_COOKIE = "GUCS";

const ABSENT = "N/A";
const ERROR_RESPONSE_BEGIN = "{\"quoteResponse\":{\"result\":[],\"error\":\"";
const ERROR_RESPONSE_END = "\"}}";
const LOG_PREFIX = UUID + " - ";
const LOG_DEBUG = Gio.file_new_for_path(DESKLET_DIR + "/DEBUG").query_exists(null);

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

let _httpSession;
if (IS_SOUP_2) {
    _httpSession = new Soup.SessionAsync();
    Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());
    Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ContentDecoder());
} else { // assume version 3
    _httpSession = new Soup.Session();
}
_httpSession.timeout = 10;
_httpSession.idle_timeout = 10;

const _cookieJar = new Soup.CookieJar();
Soup.Session.prototype.add_feature.call(_httpSession, _cookieJar);

let _crumb = null;

function _(str) {
    return Gettext.dgettext(UUID, str);
}

function logDebug(msg) {
    if (LOG_DEBUG) {
        global.log(LOG_PREFIX + 'DEBUG: ' + msg);
    }
}

function logInfo(msg) {
    global.log(LOG_PREFIX + msg);
}

function logWarning(msg) {
    global.logWarning(LOG_PREFIX + msg);
}

function logError(msg) {
    global.logError(LOG_PREFIX + msg);
}

let YahooFinanceQuoteUtils = function() { };

YahooFinanceQuoteUtils.prototype = {

    existsProperty: function(object, property) {
        return object.hasOwnProperty(property)
            && typeof object[property] !== "undefined"
            && object[property] !== null;
    },

    determineQuoteName: function(quote, useLongName) {
        if (useLongName && this.existsProperty(quote, "longName")) {
            return quote.longName;
        } else if (this.existsProperty(quote, "shortName")) {
            return quote.shortName;
        }
        return ABSENT;
    },

    isOkStatus: function(soupMessage) {
        if (soupMessage) {
            if (IS_SOUP_2) {
                return soupMessage.status_code === Soup.KnownStatusCode.OK;
            } else {
                // get_status() throws exception on any value missing in enum SoupStatus, so better check reason_phrase
                return soupMessage.get_reason_phrase() === "OK";
            }
        }
        return false;
    },

    getMessageStatusInfo: function(soupMessage) {
        if (soupMessage) {
            if (IS_SOUP_2) {
                return soupMessage.status_code + " " + soupMessage.reason_phrase;
            } else {
                let reason = soupMessage.get_reason_phrase();
                let status = "unknown status";
                try {
                    status = soupMessage.get_status();
                } catch (e) {
                    // get_status() throws exception on any value missing in enum SoupStatus
                    logDebug("get_status() exception: " + e);
                    // YF is known to return "429 Too Many Requests", which is unfortunately missing in SoupStatus
                    if (e.message.indexOf("429") > -1) {
                        status = "429";
                        reason = "Too Many Requests";
                    }
                }
                
                return status + " " + reason;
            }
        }
        return "no status available";
    }
};

let YahooFinanceQuoteReader = function() { };

YahooFinanceQuoteReader.prototype = {
    constructor: YahooFinanceQuoteReader,
    quoteUtils: new YahooFinanceQuoteUtils(),

    getCookie: function(customUserAgent, callback) {
        const _that = this;
        const message = Soup.Message.new("GET", YF_COOKIE_URL);

        if (IS_SOUP_2) {
            message.request_headers.append(ACCEPT_HEADER, ACCEPT_VALUE_COOKIE);
            message.request_headers.append(ACCEPT_ENCODING_HEADER, ACCEPT_ENCODING_VALUE);
            if (customUserAgent != null) {
                message.request_headers.append(USER_AGENT_HEADER, customUserAgent);
            }

            _httpSession.queue_message(message, function(session, message) {
                logDebug("Soup2 Cookie response status: " + _that.quoteUtils.getMessageStatusInfo(message));
                if (_that.quoteUtils.isOkStatus(message)) {
                    try {
                        callback.call(_that, message, message.response_body.data);
                    } catch (e) {
                        logError(e);
                    }
                } else {
                    logWarning("Error retrieving auth page! Status: " + _that.quoteUtils.getMessageStatusInfo(message));
                    callback.call(_that, message, null);
                }
            });
        } else {
            message.get_request_headers().append(ACCEPT_HEADER, ACCEPT_VALUE_COOKIE);
            message.get_request_headers().append(ACCEPT_ENCODING_HEADER, ACCEPT_ENCODING_VALUE);
            if (customUserAgent != null) {
                message.get_request_headers().append(USER_AGENT_HEADER, customUserAgent);
            }

            _httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, function(session, result) {
                logDebug("Soup3 Cookie response status: " + _that.quoteUtils.getMessageStatusInfo(message));
                if (_that.quoteUtils.isOkStatus(message)) {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        callback.call(_that, message, ByteArray.toString(bytes.get_data()));
                    } catch (e) {
                        logError(e);
                    }
                } else {
                    logWarning("Error retrieving auth page! Status: " + _that.quoteUtils.getMessageStatusInfo(message));
                    callback.call(_that, message, null);
                }
            });
        }
    },

    postConsent: function(customUserAgent, formData, callback) {
        const _that = this;
        const message = Soup.Message.new("POST", YF_CONSENT_URL);

        if (IS_SOUP_2) {
            message.request_headers.append(ACCEPT_HEADER, ACCEPT_VALUE_COOKIE);
            message.request_headers.append(ACCEPT_ENCODING_HEADER, ACCEPT_ENCODING_VALUE);
            if (customUserAgent != null) {
                message.request_headers.append(USER_AGENT_HEADER, customUserAgent);
            }
            message.set_request(FORM_URLENCODED_VALUE, Soup.MemoryUse.COPY, formData);

            _httpSession.queue_message(message, function(session, message) {
                logDebug("Soup2 Consent response status: " + _that.quoteUtils.getMessageStatusInfo(message));
                if (_that.quoteUtils.isOkStatus(message)) {
                    try {
                        callback.call(_that, message);
                    } catch (e) {
                        logError(e);
                    }
                } else {
                    logWarning("Error sending consent! Status: " + _that.quoteUtils.getMessageStatusInfo(message));
                    callback.call(_that, message);
                }
            });
        } else {
            message.get_request_headers().append(ACCEPT_HEADER, ACCEPT_VALUE_CRUMB);
            message.get_request_headers().append(ACCEPT_ENCODING_HEADER, ACCEPT_ENCODING_VALUE);
            if (customUserAgent != null) {
                message.get_request_headers().append(USER_AGENT_HEADER, customUserAgent);
            }
            message.set_request_body_from_bytes(FORM_URLENCODED_VALUE, GLib.Bytes.new(formData));

            _httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, function(session, result) {
                logDebug("Soup3 Consent response status: " + _that.quoteUtils.getMessageStatusInfo(message));
                if (_that.quoteUtils.isOkStatus(message)) {
                    try {
                        callback.call(_that, message);
                    } catch (e) {
                        logError(e);
                    }
                } else {
                    logWarning("Error sending consent! Status: " + _that.quoteUtils.getMessageStatusInfo(message));
                    callback.call(_that, message);
                }
            });
        }
    },

    getCrumb: function(customUserAgent, callback) {
        const _that = this;
        const message = Soup.Message.new("GET", YF_CRUMB_URL);

        if (IS_SOUP_2) {
            message.request_headers.append(ACCEPT_HEADER, ACCEPT_VALUE_CRUMB);
            message.request_headers.append(ACCEPT_ENCODING_HEADER, ACCEPT_ENCODING_VALUE);
            if (customUserAgent != null) {
                message.request_headers.append(USER_AGENT_HEADER, customUserAgent);
            }

            _httpSession.queue_message(message, function(session, message) {
                logDebug("Soup2 Crumb response status: " + _that.quoteUtils.getMessageStatusInfo(message));
                if (_that.quoteUtils.isOkStatus(message)) {
                    try {
                        callback.call(_that, message, message.response_body);
                    } catch (e) {
                        logError(e);
                    }
                } else {
                    logWarning("Error retrieving crumb! Status: " + _that.quoteUtils.getMessageStatusInfo(message));
                    callback.call(_that, message, null);
                }
            });
        } else {
            message.get_request_headers().append(ACCEPT_HEADER, ACCEPT_VALUE_CRUMB);
            message.get_request_headers().append(ACCEPT_ENCODING_HEADER, ACCEPT_ENCODING_VALUE);
            if (customUserAgent != null) {
                message.get_request_headers().append(USER_AGENT_HEADER, customUserAgent);
            }

            _httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, function(session, result) {
                logDebug("Soup3 Crumb response status: " + _that.quoteUtils.getMessageStatusInfo(message));
                if (_that.quoteUtils.isOkStatus(message)) {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        callback.call(_that, message, ByteArray.toString(bytes.get_data()));
                    } catch (e) {
                        logError(e);
                    }
                } else {
                    logWarning("Error retrieving crumb! Status: " + _that.quoteUtils.getMessageStatusInfo(message));
                    callback.call(_that, message, null);
                }
            });
        }
    },

    getFinanceData: function(quoteSymbols, customUserAgent, callback) {
        const _that = this;
        const requestUrl = this.createYahooQueryUrl(quoteSymbols);
        const message = Soup.Message.new("GET", requestUrl);

        if (IS_SOUP_2) {
            if (customUserAgent != null) {
                message.request_headers.append(USER_AGENT_HEADER, customUserAgent);
            }

            _httpSession.queue_message(message, function(session, message) {
                logDebug("Soup2 Quotes response status: " + _that.quoteUtils.getMessageStatusInfo(message));
                if (_that.quoteUtils.isOkStatus(message)) {
                    try {
                        callback.call(_that, message.response_body.data.toString());
                    } catch (e) {
                        logError(e);
                    }
                } else {
                    logWarning("Error retrieving url " + requestUrl + ". Status: " + _that.quoteUtils.getMessageStatusInfo(message));
                    callback.call(_that, _that.buildErrorResponse(_("Yahoo Finance service not available!\\nStatus: ") + _that.quoteUtils.getMessageStatusInfo(message)));
                }
            });
        } else {
            if (customUserAgent != null) {
                message.get_request_headers().append(USER_AGENT_HEADER, customUserAgent);
            }

            _httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, function(session, result) {
                logDebug("Soup3 Quotes response status: " + _that.quoteUtils.getMessageStatusInfo(message));
                if (_that.quoteUtils.isOkStatus(message)) {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        callback.call(_that, ByteArray.toString(bytes.get_data()));
                    } catch (e) {
                        logError(e);
                    }
                } else {
                    logWarning("Error retrieving url " + requestUrl + ". Status: " + _that.quoteUtils.getMessageStatusInfo(message));
                    callback.call(_that, _that.buildErrorResponse(_("Yahoo Finance service not available!\\nStatus: ") + _that.quoteUtils.getMessageStatusInfo(message)));
                }
            });
        }
    },

    createYahooQueryUrl: function(quoteSymbols) {
        const queryUrl = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + quoteSymbols.join(",") + "&crumb=" + _crumb;
        logDebug("YF query URL: " + queryUrl);
        return queryUrl;
    },

    buildErrorResponse: function(errorMsg) {
        return ERROR_RESPONSE_BEGIN + errorMsg + ERROR_RESPONSE_END;
    }
};

let QuotesTable = function() {
    this.el = new St.Table({
        homogeneous: false
    });
};

QuotesTable.prototype = {
    constructor: QuotesTable,
    quoteUtils: new YahooFinanceQuoteUtils(),
    currencyCodeToSymbolMap: {
        USD: "$",
        EUR: "\u20AC",
        JPY: "\u00A5",
        GBP: "\u00A3",
        INR: "\u20A8",
        UAH: "\u20B4",
        RUB: "\u20BD"
    },
    quoteChangeSymbolMap: {
        UP: "\u25B2",
        DOWN: "\u25BC",
        EQUALS: "\u25B6"
    },

    render: function(quotes, settings) {
        for (let rowIndex = 0, l = quotes.length; rowIndex < l; rowIndex++) {
            this.renderTableRow(quotes[rowIndex], rowIndex, settings);
        }
    },

    renderTableRow: function(quote, rowIndex, settings) {
        let cellContents = [];

        if (settings.changeIcon) {
            cellContents.push(this.createPercentChangeIcon(quote,
                settings.uptrendChangeColor, settings.downtrendChangeColor, settings.unchangedTrendColor));
        }
        if (settings.quoteName) {
            cellContents.push(this.createQuoteLabel(this.quoteUtils.determineQuoteName(quote, settings.useLongName),
                quote.symbol, settings.linkQuote, settings.quoteNameMaxLength));
        }
        if (settings.quoteSymbol) {
            cellContents.push(this.createQuoteLabel(quote.symbol,
                quote.symbol, settings.linkSymbol, settings.quoteSymbolMaxLength));
        }
        if (settings.marketPrice) {
            cellContents.push(this.createMarketPriceLabel(quote, settings.currencySymbol, settings.decimalPlaces,
                settings.strictRounding));
        }
        if (settings.absoluteChange) {
            cellContents.push(this.createAbsoluteChangeLabel(quote, settings.currencySymbol, settings.decimalPlaces,
                settings.strictRounding));
        }
        if (settings.percentChange) {
            cellContents.push(this.createPercentChangeLabel(quote, settings.colorPercentChange,
                settings.uptrendChangeColor, settings.downtrendChangeColor, settings.unchangedTrendColor,
                settings.strictRounding));
        }
        if (settings.tradeTime) {
            cellContents.push(this.createTradeTimeLabel(quote));
        }

        for (let columnIndex = 0; columnIndex < cellContents.length; ++columnIndex) {
            this.el.add(cellContents[columnIndex], {
                row: rowIndex,
                col: columnIndex
            });
        }
    },

    createQuoteLabel: function(labelText, quoteSymbol, addLink, labelMaxLength) {
        const label = new St.Label({
            text: labelText,
            style_class: "quotes-label",
            reactive: addLink ? true : false,
            style: "width:" + (labelMaxLength / 2 + 2) + "em;"
        });

        if (addLink) {
            const symbolButton = new St.Button();
            symbolButton.add_actor(label);
            symbolButton.connect("clicked", Lang.bind(this, function() {
                Gio.app_info_launch_default_for_uri(YF_QUOTE_PAGE_URL + quoteSymbol, global.create_app_launch_context());
            }));
            return symbolButton;
        } else {
            return label;
        }
    },

    createMarketPriceLabel: function(quote, withCurrencySymbol, decimalPlaces, strictRounding) {
        let currencySymbol = "";
        if (withCurrencySymbol && this.quoteUtils.existsProperty(quote, "currency")) {
            currencySymbol = this.currencyCodeToSymbolMap[quote.currency] || quote.currency;
        }
        return new St.Label({
            text: currencySymbol + (this.quoteUtils.existsProperty(quote, "regularMarketPrice")
                ? this.roundAmount(quote.regularMarketPrice, decimalPlaces, strictRounding)
                : ABSENT),
            style_class: "quotes-number"
        });
    },

    createAbsoluteChangeLabel: function(quote, withCurrencySymbol, decimalPlaces, strictRounding) {
        let absoluteChangeText = "";
        if (this.quoteUtils.existsProperty(quote, "regularMarketChange")) {
            let absoluteChange = this.roundAmount(quote.regularMarketChange, decimalPlaces, strictRounding);
            if (absoluteChange > 0.0) {
                absoluteChangeText = "+";
            }
            absoluteChangeText += absoluteChange;
        } else {
            absoluteChangeText = ABSENT;
        }

        return new St.Label({
            text: absoluteChangeText,
            style_class: "quotes-number"
        });
    },

    createPercentChangeIcon: function(quote, uptrendChangeColor, downtrendChangeColor, unchangedTrendColor) {
        const percentChange = this.quoteUtils.existsProperty(quote, "regularMarketChangePercent")
            ? parseFloat(quote.regularMarketChangePercent)
            : 0.00;
        let iconText = this.quoteChangeSymbolMap["EQUALS"];
        let iconColor = unchangedTrendColor;

        if (percentChange > 0) {
            iconText = this.quoteChangeSymbolMap["UP"];
            iconColor = uptrendChangeColor;
        } else if (percentChange < 0) {
            iconText = this.quoteChangeSymbolMap["DOWN"];
            iconColor = downtrendChangeColor;
        }

        return new St.Label({
            text: iconText,
            style: "color: " + iconColor + ";"
        });
    },

    createPercentChangeLabel: function(quote, useTrendColors, uptrendChangeColor, downtrendChangeColor, unchangedTrendColor, strictRounding) {
        let labelColor = "";
        if (useTrendColors && this.quoteUtils.existsProperty(quote, "regularMarketChangePercent")) {
            const percentageChange = parseFloat(quote.regularMarketChangePercent);
            if (percentageChange > 0) {
                labelColor = uptrendChangeColor;
            } else if (percentageChange < 0) {
                labelColor = downtrendChangeColor;
            } else {
                labelColor = unchangedTrendColor;
            }
        }

        return new St.Label({
            text: this.quoteUtils.existsProperty(quote, "regularMarketChangePercent")
                ? (this.roundAmount(quote.regularMarketChangePercent, 2, strictRounding) + "%")
                : ABSENT,
            style_class: "quotes-number",
            style: labelColor ? "color: " + labelColor + ";" : ""
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

    formatTime: function(unixTimestamp) {
        const ts = new Date(unixTimestamp * 1000);
        let tsFormat = "";

        if (this.isToday(ts)) {
            tsFormat = ts.toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "numeric"
            });
        } else {
            tsFormat = ts.toLocaleDateString(undefined, {
                month: "numeric",
                day: "numeric"
            });
        }

        return tsFormat;
    },

    createTradeTimeLabel: function(quote) {
        return new St.Label({
            text: this.quoteUtils.existsProperty(quote, "regularMarketTime")
                ? this.formatTime(quote.regularMarketTime)
                : ABSENT,
            style_class: "quotes-number"
        });
    }
};

function StockQuoteDesklet(metadata, id) {
    Desklet.Desklet.prototype._init.call(this, metadata, id);
    this.init(metadata, id);
}

StockQuoteDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,
    init: function(metadata, id) {
        this.metadata = metadata;
        this.id = id;
        this.quoteReader = new YahooFinanceQuoteReader();
        this.quoteUtils = new YahooFinanceQuoteUtils();
        this.loadSettings();
        this.onUpdate();
    },

    loadSettings: function() {
        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, this.id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "height", "height",
            this.onDisplayChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "width", "width",
            this.onDisplayChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "transparency", "transparency",
            this.onDisplayChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "delayMinutes", "delayMinutes",
            this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showLastUpdateTimestamp", "showLastUpdateTimestamp",
            this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "sendCustomUserAgent", "sendCustomUserAgent",
            this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "customUserAgent", "customUserAgent",
            this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "roundNumbers", "roundNumbers",
            this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "decimalPlaces", "decimalPlaces",
            this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "strictRounding", "strictRounding",
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
        this.settings.bindProperty(Settings.BindingDirection.IN, "uptrendChangeColor", "uptrendChangeColor",
            this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "downtrendChangeColor", "downtrendChangeColor",
            this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "unchangedTrendColor", "unchangedTrendColor",
            this.onSettingsChanged, null);
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
            "uptrendChangeColor": this.uptrendChangeColor,
            "downtrendChangeColor": this.downtrendChangeColor,
            "unchangedTrendColor": this.unchangedTrendColor,
            "quoteSymbolMaxLength": Math.max.apply(Math, quotes.map((quote) => quote.symbol.length)),
            "quoteNameMaxLength": Math.max.apply(Math, quotes.map((quote) => this.quoteUtils.determineQuoteName(quote, this.useLongQuoteName).length))
        };
    },

    formatCurrentTimestamp: function() {
        const now = new Date();
        return now.toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "numeric",
            second: "numeric"
        });
    },

    createLastUpdateLabel: function() {
        return new St.Label({
            text: _("Updated at ") + this.formatCurrentTimestamp(),
            style_class: "quotes-last-update"
        });
    },

    createErrorLabel: function(errorMsg) {
        return new St.Label({
            text: _("Error: ") + errorMsg,
            style_class: "error-label"
        });
    },

    onDisplayChanged: function() {
        this.mainBox.set_size(this.width, this.height);
        this.setTransparency();
    },

    setTransparency: function() {
        this.mainBox.style = "background-color: rgba(0, 0, 0, " + this.transparency + ")";
    },

    onSettingsChanged: function() {
        this.unrender();
        this.removeUpdateTimer();
        this.onUpdate();
    },

    on_desklet_removed: function() {
        this.unrender();
        this.removeUpdateTimer();
    },

    onUpdate: function() {
        const quoteSymbols = this.quoteSymbolsText.split("\n");
        const customUserAgent = this.sendCustomUserAgent ? this.customUserAgent : null;

        try {
            if (_crumb) {
                this.renderFinanceData(quoteSymbols, customUserAgent);
            } else {
                this.fetchCookieAndRender(quoteSymbols, customUserAgent);
            }
        } catch (err) {
            this.onError(quoteSymbols, err);
        }
    },

    existsCookie: function(name) {
        for (let cookie of _cookieJar.all_cookies()) {
            let cookieName = IS_SOUP_2 ? cookie.name : cookie.get_name();
            if (cookieName === name) {
                return true;
            }
        }

        return false;
    },

    fetchCookieAndRender: function(quoteSymbols, customUserAgent) {
        const _that = this;

        this.quoteReader.getCookie(customUserAgent, function(authResponseMessage, responseBody) {
            logDebug("Cookie response body: " + responseBody);
            if (_that.existsCookie(AUTH_COOKIE)) {
                _that.fetchCrumbAndRender(quoteSymbols, customUserAgent);
            } else if (_that.existsCookie(CONSENT_COOKIE)) {
                _that.processConsentAndRender(authResponseMessage, responseBody, quoteSymbols, customUserAgent);
            } else {
                logWarning("Failed to retrieve auth cookie!");
                _that.renderErrorMessage(_("Failed to retrieve authorization parameter! Unable to fetch quotes data.\\nStatus: ") + _that.quoteUtils.getMessageStatusInfo(authResponseMessage));
            }
        });
    },

    processConsentAndRender: function(authResponseMessage, consentPage, quoteSymbols, customUserAgent) {
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

            this.quoteReader.postConsent(customUserAgent, consentFormFields, function(consentResponseMessage) {
                if (_that.existsCookie(AUTH_COOKIE)) {
                    _that.fetchCrumbAndRender(quoteSymbols, customUserAgent);
                } else {
                    logWarning("Failed to retrieve auth cookie from consent form.");
                    _that.renderErrorMessage(_("Consent processing failed! Unable to fetch quotes data.\\nStatus: ") + _that.quoteUtils.getMessageStatusInfo(consentResponseMessage));
                }
            });
        } else {
            logWarning("Consent form not detected.");
            this.renderErrorMessage(_("Consent processing not completed! Unable to fetch quotes data.\\nStatus: ") + _that.quoteUtils.getMessageStatusInfo(authResponseMessage));
        }
    },

    fetchCrumbAndRender: function(quoteSymbols, customUserAgent) {
        const _that = this;

        this.quoteReader.getCrumb(customUserAgent, function(crumbResponseMessage, responseBody) {
            logDebug("Crumb response body: " + responseBody);
            if (responseBody) {
                if (typeof responseBody.data === "string" && responseBody.data.trim() !== "") {
                    _crumb = responseBody.data;
                } else if (typeof responseBody === "string" && responseBody.trim() !== "") {
                    _crumb = responseBody;
                }
            }

            if (_crumb) {
                logInfo("Successfully retrieved all authorization parameters.");
                _that.renderFinanceData(quoteSymbols, customUserAgent);
            } else {
                logWarning("Failed to retrieve crumb!");
                _that.renderErrorMessage(_("Failed to retrieve authorization crumb! Unable to fetch quotes data.\\nStatus: ") + _that.quoteUtils.getMessageStatusInfo(crumbResponseMessage));
            }
        });
    },

    renderFinanceData: function(quoteSymbols, customUserAgent) {
        const _that = this;

        this.quoteReader.getFinanceData(quoteSymbols, customUserAgent, function(response) {
            logDebug("YF query response: " + response);
            let parsedResponse = JSON.parse(response);
            _that.render([parsedResponse.quoteResponse.result, parsedResponse.quoteResponse.error]);
            _that.setUpdateTimer();
        });
    },

    renderErrorMessage: function(errorMessage) {
        const errorResponse = JSON.parse(this.quoteReader.buildErrorResponse(errorMessage));
        this.render([errorResponse.quoteResponse.result, errorResponse.quoteResponse.error]);
        this.setUpdateTimer();
    },

    setUpdateTimer: function() {
        this.updateLoop = Mainloop.timeout_add(this.delayMinutes * 60 * 1000, Lang.bind(this, this.onUpdate));
    },

    onError: function(quoteSymbols, err) {
        logError(_("Cannot display quotes information for symbols: ") + quoteSymbols.join(","));
        logError(_("The following error occurred: ") + err);
    },

    sortByProperty: function(quotes, prop, direction) {
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

    render: function(quotes) {
        const tableContainer = new St.BoxLayout({
            vertical: true
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
        table.render(quotes[0], this.getQuoteDisplaySettings(quotes[0]));
        tableContainer.add_actor(table.el);

        if (this.showLastUpdateTimestamp) {
            tableContainer.add_actor(this.createLastUpdateLabel());
        }

        const scrollView = new St.ScrollView();
        scrollView.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        scrollView.add_actor(tableContainer);

        this.mainBox = new St.BoxLayout({
            vertical: true,
            width: this.width,
            height: this.height,
            style_class: "quotes-reader"
        });
        this.setTransparency();

        this.mainBox.add(scrollView, {
            expand: true
        });
        this.setContent(this.mainBox);
    },

    unrender: function() {
        this.mainBox.destroy_all_children();
        this.mainBox.destroy();
    },

    removeUpdateTimer: function() {
        if (this.updateLoop > 0) {
            Mainloop.source_remove(this.updateLoop);
        }
        this.updateLoop = null;
    }
};

function main(metadata, id) {
    return new StockQuoteDesklet(metadata, id);
}
