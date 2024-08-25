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

const BASE_FONT_SIZE = 10;

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

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

let _lastResponse = {
    responseResult: [],
    // we should never see this error message
    responseError: _("No quotes data to display"),
    lastUpdated: new Date()
};

function logDebug(msg) {
    if (LOG_DEBUG) {
        global.log(LOG_PREFIX + "DEBUG: " + msg);
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

const YahooFinanceQuoteUtils = function() { };

YahooFinanceQuoteUtils.prototype = {

    existsProperty: function(object, property) {
        return object.hasOwnProperty(property)
            && typeof object[property] !== "undefined"
            && object[property] !== null;
    },

    // convert the quotes list to a comma-separated one-liner, to be used as argument for the YFQ "symbols" parameter
    buildSymbolsArgument: function(quoteSymbolsText) {
        return quoteSymbolsText
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line !== "")
            .map((line) => line.split(";")[0])
            .join();
    },

    // extract any customization parameters from each entry in the quotes list, and return them in a map
    buildSymbolCustomizationMap: function(quoteSymbolsText) {
        const symbolCustomizations = new Map();
        for (const line of quoteSymbolsText.trim().split("\n")) {
            const customization = this.parseSymbolLine(line);
            symbolCustomizations.set(customization.symbol, customization);
        }
        logDebug("symbol customization map size: " + symbolCustomizations.size);

        return symbolCustomizations;
    },

    parseSymbolLine: function(symbolLine) {
        const lineParts = symbolLine.trim().split(";");

        const customAttributes = new Map();
        for (const attr of lineParts.slice(1)) {
            const [key, value] = attr.split("=");
            if (key && value) {
                customAttributes.set(key, value);
            }
        }

        return this.buildSymbolCustomization(lineParts[0], customAttributes);
    },

    // data structure for quote customization parameters
    buildSymbolCustomization: function(symbol, customAttributes) {
        return {
            symbol,
            name: customAttributes.has("name") ? customAttributes.get("name") : null,
            style: customAttributes.has("style") ? customAttributes.get("style") : "normal",
            weight: customAttributes.has("weight") ? customAttributes.get("weight") : "normal",
            color: customAttributes.has("color") ? customAttributes.get("color") : null,
        };
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
    },

    // determine and store the quote name to display within the quote as new property "displayName"
    populateQuoteDisplayName: function(quote, symbolCustomization, useLongName) {
        let displayName = ABSENT;

        if (symbolCustomization.name !== null) {
            displayName = symbolCustomization.name;
        } else if (useLongName && this.existsProperty(quote, "longName")) {
            displayName = quote.longName;
        } else if (this.existsProperty(quote, "shortName")) {
            displayName = quote.shortName;
        }

        quote.displayName = displayName;
    },

    sortQuotesByProperty: function(quotes, prop, direction) {
        // don't sort if no criteria was given, or the criteria says "natural order", or there is only one quote
        if (prop === undefined || prop === "none" || quotes.length < 2) {
            return quotes;
        }

        // when sort-by-name is configured, then we want to sort by the determined display name
        if (prop === "shortName") {
            prop = "displayName";
        }

        const _that = this;
        const clone = quotes.slice(0);
        const numberPattern = /^-?\d+(\.\d+)?$/;
        clone.sort(function(q1, q2) {
            let p1 = "";
            if (_that.existsProperty(q1, prop)) {
                p1 = q1[prop].toString().match(numberPattern) ? + q1[prop] : q1[prop].toLowerCase();
            }
            let p2 = "";
            if (_that.existsProperty(q2, prop)) {
                p2 = q2[prop].toString().match(numberPattern) ? + q2[prop] : q2[prop].toLowerCase();
            }

            return ((p1 < p2) ? -1 : ((p1 > p2) ? 1 : 0)) * direction;
        });
        return clone;
    }
};

const YahooFinanceQuoteReader = function() { };

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

    getFinanceData: function(quoteSymbolsArg, customUserAgent, callback) {
        const _that = this;

        if (quoteSymbolsArg.length === 0) {
            callback.call(_that, _that.buildErrorResponse(_("Empty quotes list. Open settings and add some symbols.")));
            return;
        }

        const requestUrl = this.createYahooQueryUrl(quoteSymbolsArg);
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

    createYahooQueryUrl: function(quoteSymbolsArg) {
        const queryUrl = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + quoteSymbolsArg + "&crumb=" + _crumb;
        logDebug("YF query URL: " + queryUrl);
        return queryUrl;
    },

    buildErrorResponse: function(errorMsg) {
        return ERROR_RESPONSE_BEGIN + errorMsg + ERROR_RESPONSE_END;
    }
};

const QuotesTable = function() {
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
                Gio.app_info_launch_default_for_uri(YF_QUOTE_PAGE_URL + symbolCustomization.symbol, global.create_app_launch_context());
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
                : ABSENT),
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
            absoluteChangeText = ABSENT;
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
                : ABSENT,
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
                : ABSENT,
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
        this.updateId = 0;
        this.updateInProgress = false;
        this.quoteReader = new YahooFinanceQuoteReader();
        this.quoteUtils = new YahooFinanceQuoteUtils();
        this.loadSettings();
        this.onQuotesListChanged();
    },

    loadSettings: function() {
        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, this.id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "height", "height", this.onDisplaySettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "width", "width", this.onDisplaySettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "transparency", "transparency", this.onDisplaySettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showVerticalScrollbar", "showVerticalScrollbar", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "backgroundColor", "backgroundColor", this.onDisplaySettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "delayMinutes", "delayMinutes", this.onDataFetchSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showLastUpdateTimestamp", "showLastUpdateTimestamp", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "manualDataUpdate", "manualDataUpdate", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "sendCustomUserAgent", "sendCustomUserAgent"); // no callback, manual refresh required
        this.settings.bindProperty(Settings.BindingDirection.IN, "customUserAgent", "customUserAgent");  // no callback, manual refresh required
        this.settings.bindProperty(Settings.BindingDirection.IN, "roundNumbers", "roundNumbers", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "decimalPlaces", "decimalPlaces", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "strictRounding", "strictRounding", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "use24HourTime", "use24HourTime", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "customTimeFormat", "customTimeFormat", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "customDateFormat", "customDateFormat", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "quoteSymbols", "quoteSymbolsText"); // no callback, manual refresh required
        this.settings.bindProperty(Settings.BindingDirection.IN, "sortCriteria", "sortCriteria", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "sortDirection", "sortAscending", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showChangeIcon", "showChangeIcon", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showQuoteName", "showQuoteName", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "useLongQuoteName", "useLongQuoteName", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "linkQuoteName", "linkQuoteName", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showQuoteSymbol", "showQuoteSymbol", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "linkQuoteSymbol", "linkQuoteSymbol", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showMarketPrice", "showMarketPrice", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showCurrencyCode", "showCurrencyCode", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showAbsoluteChange", "showAbsoluteChange", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showPercentChange", "showPercentChange", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "colorPercentChange", "colorPercentChange", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "showTradeTime", "showTradeTime", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "fontColor", "fontColor", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "scaleFontSize", "scaleFontSize", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "fontScale", "fontScale", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "uptrendChangeColor", "uptrendChangeColor", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "downtrendChangeColor", "downtrendChangeColor", this.onRenderSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "unchangedTrendColor", "unchangedTrendColor", this.onRenderSettingsChanged);
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
            "fontSize": this.scaleFontSize ? Math.round(BASE_FONT_SIZE * this.fontScale * global.ui_scale) : -1,
            "uptrendChangeColor": this.uptrendChangeColor,
            "downtrendChangeColor": this.downtrendChangeColor,
            "unchangedTrendColor": this.unchangedTrendColor,
            "quoteSymbolWidth": Math.max.apply(Math, quotes.map((quote) => quote.symbol.length)),
            "quoteLabelWidth": Math.max.apply(Math, quotes.map((quote) => quote.displayName.length)) / 2 + 2
        };
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
                this.onQuotesListChanged();
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

    createErrorLabel: function(errorMsg) {
        return new St.Label({
            text: _("Error: ") + errorMsg,
            style_class: "error-label"
        });
    },

    // called on events that change the desklet window
    onDisplaySettingChanged: function() {
        this.mainBox.set_size(this.width, this.height);
        this.setBackground();
    },

    setBackground: function() {
        this.mainBox.style = "background-color: " + this.buildBackgroundColor(this.backgroundColor, this.transparency);
    },

    buildBackgroundColor: function(rgbColorString, transparencyFactor) {
        // parse RGB values between "rgb(...)"
        const rgb = rgbColorString.match(/\((.*?)\)/)[1].split(",");
        return "rgba(" + parseInt(rgb[0]) + "," + parseInt(rgb[1]) + "," + parseInt(rgb[2]) + "," + transparencyFactor + ")";
    },

    // called on events that change the quotes data layout (sorting, show/hide fields, text color, etc)
    onRenderSettingsChanged: function() {
        this.render();
    },

    // called on events that change the way YFQ data are fetched (data refresh interval)
    onDataFetchSettingsChanged: function() {
        this.removeUpdateTimer();
        this.setUpdateTimer();
    },

    // called on events that change the quotes data (quotes list)
    // BEWARE: DO NOT use this function as callback in settings.bindProperty() - otherwise multiple YFQ requests are fired, and multiple timers are created!
    onQuotesListChanged: function() {
        logDebug("onQuotesListChanged");

        if (this.updateInProgress) {
            logInfo("Data refresh already in progress");
            return;
        }
        this.removeUpdateTimer();

        const quoteSymbolsArg = this.quoteUtils.buildSymbolsArgument(this.quoteSymbolsText);
        const customUserAgent = this.sendCustomUserAgent ? this.customUserAgent : null;

        try {
            if (_crumb) {
                this.fetchFinanceDataAndRender(quoteSymbolsArg, customUserAgent);
            } else {
                this.fetchCookieAndRender(quoteSymbolsArg, customUserAgent);
            }
        } catch (err) {
            logError("Cannot fetch quotes information for symbol %s due to error: %s".format(quoteSymbolsArg, err));
            this.processFailedFetch(err);
        }
    },

    fetchFinanceDataAndRender: function(quoteSymbolsArg, customUserAgent) {
        const _that = this;

        this.quoteReader.getFinanceData(quoteSymbolsArg, customUserAgent, function(response) {
            logDebug("YF query response: " + response);
            let parsedResponse = JSON.parse(response);
            _lastResponse =
            {
                responseResult: parsedResponse.quoteResponse.result,
                responseError: parsedResponse.quoteResponse.error,
                lastUpdated: new Date()
            };
            _that.setUpdateTimer();
            _that.render();
        });
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

    fetchCookieAndRender: function(quoteSymbolsArg, customUserAgent) {
        const _that = this;

        this.quoteReader.getCookie(customUserAgent, function(authResponseMessage, responseBody) {
            logDebug("Cookie response body: " + responseBody);
            if (_that.existsCookie(AUTH_COOKIE)) {
                _that.fetchCrumbAndRender(quoteSymbolsArg, customUserAgent);
            } else if (_that.existsCookie(CONSENT_COOKIE)) {
                _that.processConsentAndRender(authResponseMessage, responseBody, quoteSymbolsArg, customUserAgent);
            } else {
                logWarning("Failed to retrieve auth cookie!");
                _that.processFailedFetch(_("Failed to retrieve authorization parameter! Unable to fetch quotes data.\\nStatus: ") + _that.quoteUtils.getMessageStatusInfo(authResponseMessage));
            }
        });
    },

    processConsentAndRender: function(authResponseMessage, consentPage, quoteSymbolsArg, customUserAgent) {
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
                    _that.fetchCrumbAndRender(quoteSymbolsArg, customUserAgent);
                } else {
                    logWarning("Failed to retrieve auth cookie from consent form");
                    _that.processFailedFetch(_("Consent processing failed! Unable to fetch quotes data.\\nStatus: ") + _that.quoteUtils.getMessageStatusInfo(consentResponseMessage));
                }
            });
        } else {
            logWarning("Consent form not detected");
            this.processFailedFetch(_("Consent processing not completed! Unable to fetch quotes data.\\nStatus: ") + this.quoteUtils.getMessageStatusInfo(authResponseMessage));
        }
    },

    fetchCrumbAndRender: function(quoteSymbolsArg, customUserAgent) {
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
                logInfo("Successfully retrieved all authorization parameters");
                _that.fetchFinanceDataAndRender(quoteSymbolsArg, customUserAgent);
            } else {
                logWarning("Failed to retrieve crumb!");
                _that.processFailedFetch(_("Failed to retrieve authorization crumb! Unable to fetch quotes data.\\nStatus: ") + _that.quoteUtils.getMessageStatusInfo(crumbResponseMessage));
            }
        });
    },

    processFailedFetch: function(errorMessage) {
        const errorResponse = JSON.parse(this.quoteReader.buildErrorResponse(errorMessage));
        _lastResponse =
        {
            responseResult: errorResponse.quoteResponse.result,
            responseError: errorResponse.quoteResponse.error,
            lastUpdated: new Date()
        };
        this.setUpdateTimer();
        this.render();
    },

    setUpdateTimer: function() {
        logDebug("setUpdateTimer");
        if (this.updateInProgress) {
            this.updateId = Mainloop.timeout_add(this.delayMinutes * 60000, Lang.bind(this, this.onQuotesListChanged));
            this.updateInProgress = false;
        }
    },
    // main method to render the desklet, expects populated _lastResponse
    render: function() {
        logDebug("render");
        let responseResult = _lastResponse.responseResult;
        const responseError = _lastResponse.responseError;
        const lastUpdated = _lastResponse.lastUpdated;
        const symbolCustomizationMap = this.quoteUtils.buildSymbolCustomizationMap(this.quoteSymbolsText);

        // destroy the current view
        this.unrender();

        const tableContainer = new St.BoxLayout({
            vertical: true
        });

        // in case of errors, show details
        if (responseError !== null) {
            tableContainer.add_actor(this.createErrorLabel(responseError));
        }

        // some preparations before the rendering starts
        for (const quote of responseResult) {
            // sometimes YF returns a symbol we didn't query for
            // add such "new" symbols to the customization map for easier processing in the various render.. functions
            const returnedSymbol = quote.symbol;
            if (!symbolCustomizationMap.has(returnedSymbol)) {
                logDebug("Adding unknown symbol to customization map: " + returnedSymbol);
                symbolCustomizationMap.set(returnedSymbol, this.quoteUtils.buildSymbolCustomization(returnedSymbol, new Map()));
            }

            // based on the custom settings, and the returned information, determine the name and store it directly in the quote
            this.quoteUtils.populateQuoteDisplayName(quote, symbolCustomizationMap.get(returnedSymbol), this.useLongQuoteName);
        }

        // (optional) sorting (do after we populated the display name within the quotes)
        responseResult = this.quoteUtils.sortQuotesByProperty(responseResult, this.sortCriteria, this.sortAscending ? 1 : -1);

        // gather all settings that influence the rendering
        const displaySettings = this.getQuoteDisplaySettings(responseResult);

        const table = new QuotesTable();
        // renders the quotes in a table structure
        table.renderTable(responseResult, symbolCustomizationMap, displaySettings);
        tableContainer.add_actor(table.el);

        if (this.showLastUpdateTimestamp) {
            tableContainer.add_actor(this.createLastUpdateLabel(lastUpdated, displaySettings));
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
        this.setBackground();

        this.mainBox.add(scrollView, {
            expand: true
        });
        this.setContent(this.mainBox);
    },

    on_desklet_removed: function() {
        this.removeUpdateTimer();
        this.unrender();
    },

    unrender: function() {
        logDebug("unrender");
        if (this.mainBox) {
            this.mainBox.destroy_all_children();
            this.mainBox.destroy();
        }
    },

    removeUpdateTimer: function() {
        logDebug("removeUpdateTimer");
        if (this.updateId > 0) {
            Mainloop.source_remove(this.updateId);
        }
        this.updateId = 0;
        this.updateInProgress = true;
    }
};

function main(metadata, id) {
    return new StockQuoteDesklet(metadata, id);
}
