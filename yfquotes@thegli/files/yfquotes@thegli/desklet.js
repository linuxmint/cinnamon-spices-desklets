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
// I/O operations
const Gio = imports.gi.Gio;
// Files operations
const GLib = imports.gi.GLib;
// Gtk library (policies for scrollview)
const Gtk = imports.gi.Gtk;
// text layouting and rendering
const Pango = imports.gi.Pango;
// HTTP client
const Soup = imports.gi.Soup;
const ByteArray = imports.byteArray;
// Settings loader based on settings-schema.json file
const Settings = imports.ui.settings;
// translation support
const Gettext = imports.gettext;
// external process execution
const { spawnCommandLineAsyncIO } = require("./lib/util-extract");

const UUID = "yfquotes@thegli";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
const LOG_DEBUG = Gio.file_new_for_path(DESKLET_DIR + "/DEBUG").query_exists(null);
const IS_SOUP_2 = Soup.MAJOR_VERSION === 2;
if (LOG_DEBUG) {
    global.log(`${UUID} Debug logging is enabled`);
    global.log(`${UUID} libsoup version ${Soup.MAJOR_VERSION}.${Soup.MINOR_VERSION}.${Soup.MICRO_VERSION}`);
}

const YF_COOKIE_URL = "https://finance.yahoo.com/quote/%5EGSPC/options";
const YF_CONSENT_URL = "https://consent.yahoo.com/v2/collectConsent";
const YF_CRUMB_URL = "https://query2.finance.yahoo.com/v1/test/getcrumb";
const YF_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";
const YF_QUOTE_WEBPAGE_URL = "https://finance.yahoo.com/quote/";
const YF_QUOTE_FIELDS = "symbol,shortName,longName,currency,marketState,hasPrePostMarketData,"
    + "regularMarketTime,regularMarketPrice,regularMarketChange,regularMarketChangePercent,"
    + "preMarketTime,preMarketPrice,preMarketChange,preMarketChangePercent,"
    + "postMarketTime,postMarketPrice,postMarketChange,postMarketChangePercent";

const ACCEPT_HEADER = "Accept";
const ACCEPT_VALUE_COOKIE = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const ACCEPT_VALUE_CRUMB = "*/*";
const ACCEPT_ENCODING_HEADER = "Accept-Encoding";
const ACCEPT_ENCODING_VALUE = "gzip, deflate";
const USER_AGENT_HEADER = "User-Agent";
const FORM_URLENCODED_VALUE = "application/x-www-form-urlencoded";

const AUTH_COOKIE = "A1";
const CONSENT_COOKIE = "GUCS";

const CACHED_AUTH_PARAMS_VERSION = 1;
const DEFAULT_CACHED_AUTH_PARAMS = "{\"version\": " + CACHED_AUTH_PARAMS_VERSION + "}";

const CURL_SILENT_LOCATION_OPTIONS = "-sSL";
const CURL_CONNECT_TIMEOUT_OPTION = "--connect-timeout";
const CURL_CONNECT_TIMEOUT_VALUE = "5";
const CURL_MAX_TIME_OPTION = "-m";
const CURL_MAX_TIME_VALUE = "15";
const CURL_WRITE_OUT_OPTION = "-w";
const CURL_RESPONSE_CODE_PREFIX = "HTTP_CODE=";
const CURL_WRITE_OUT_VALUE = CURL_RESPONSE_CODE_PREFIX + "%{http_code}";
const CURL_HEADER_OPTION = "-H";
const CURL_COOKIE_HEADER_NAME = "Cookie: ";
const CURL_USER_AGENT_HEADER_NAME = "User-Agent: ";
const CURL_CIPHERS_OPTION = "--ciphers";
const CURL_CIPHERS_VALUE =
    "TLS_AES_128_GCM_SHA256," +
    "TLS_AES_256_GCM_SHA384," +
    "TLS_CHACHA20_POLY1305_SHA256," +
    "TLS_AES_128_CCM_SHA256," +
    "TLS_AES_128_CCM_8_SHA256," +
    "ECDHE-ECDSA-AES128-GCM-SHA256," +
    "ECDHE-RSA-AES128-GCM-SHA256," +
    "ECDHE-ECDSA-AES256-GCM-SHA384," +
    "ECDHE-RSA-AES256-GCM-SHA384," +
    "ECDHE-ECDSA-CHACHA20-POLY1305," +
    "ECDHE-RSA-CHACHA20-POLY1305," +
    "ECDHE-ECDSA-AES128-SHA256," +
    "ECDHE-RSA-AES128-SHA256," +
    "ECDHE-ECDSA-AES128-SHA," +
    "ECDHE-RSA-AES128-SHA," +
    "ECDHE-ECDSA-AES256-SHA384," +
    "ECDHE-RSA-AES256-SHA384," +
    "ECDHE-ECDSA-AES256-SHA," +
    "ECDHE-RSA-AES256-SHA," +
    "AES128-GCM-SHA256," +
    "AES256-GCM-SHA384";

const ABSENT = _("N/A");
const MAX_AUTH_ATTEMPTS = 3;

const BASE_FONT_SIZE = 10;
const DEFAULT_MARKET_STATE = "regular";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

function CurlMessage(response) {
    this.init(response);
}

// mimics libsoup's SoupMessage
CurlMessage.prototype = {

    init(response) {
        const responseParts = response.split(CURL_RESPONSE_CODE_PREFIX);
        this.response_body = responseParts[0];
        this.status_code = Number(responseParts[1]);
        this.reason_phrase = this.determineReasonPhrase(this.status_code);
    },

    determineReasonPhrase(statusCode) {
        switch (statusCode) {
            case 200: return "OK";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 422: return "Unprocessable Content";
            case 429: return "Too Many Requests";
            case 500: return "Internal Server Error";
            case 502: return "Bad Gateway";
            case 503: return "Service Unavailable";
            case 504: return "Gateway Timeout";
            default: return "Unknown reason";
        }
    },

    get_reason_phrase() {
        return this.reason_phrase;
    },

    get_status() {
        return this.status_code;
    }
}

function YahooFinanceQuoteUtils(deskletId) {
    this.init(deskletId);
}

YahooFinanceQuoteUtils.prototype = {

    init(deskletId) {
        this.id = deskletId;
    },

    logDebug(msg) {
        if (LOG_DEBUG) {
            global.log(`${UUID}[${this.id}] DEBUG ${msg}`);
        }
    },

    logInfo(msg) {
        global.log(`${UUID}[${this.id}] ${msg}`);
    },

    logWarning(msg) {
        global.logWarning(`${UUID}[${this.id}] ${msg}`);
    },

    logError(msg) {
        global.logError(`${UUID}[${this.id}] ${msg}`);
    },

    logException(context, err) {
        const exceptionDetails = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : err;
        global.logError(`${UUID}[${this.id}] ${context}\n${exceptionDetails}`);
    },

    existsProperty(object, property) {
        return object.hasOwnProperty(property)
            && typeof object[property] !== "undefined"
            && object[property] !== null;
    },

    // convert the quotes list to a comma-separated one-liner, to be used as argument for the YFQ "symbols" parameter
    buildSymbolsArgument(quoteSymbolsText) {
        return quoteSymbolsText
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line !== "")
            .map((line) => line.split(";")[0].toUpperCase())
            .join();
    },

    // extract any customization parameters from each entry in the quotes list, and return them in a map
    buildSymbolCustomizationMap(quoteSymbolsText) {
        const symbolCustomizations = new Map();
        for (const line of quoteSymbolsText.trim().split("\n")) {
            const customization = this.parseSymbolLine(line);
            symbolCustomizations.set(customization.symbol, customization);
        }
        this.logDebug(`buildSymbolCustomizationMap - symbol customization map size: ${symbolCustomizations.size}`);

        return symbolCustomizations;
    },

    parseSymbolLine(symbolLine) {
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
    buildSymbolCustomization(symbol, customAttributes) {
        return {
            symbol: symbol.toUpperCase(),
            name: customAttributes.has("name") ? customAttributes.get("name") : null,
            style: customAttributes.has("style") ? customAttributes.get("style") : "normal",
            weight: customAttributes.has("weight") ? customAttributes.get("weight") : "normal",
            color: customAttributes.has("color") ? customAttributes.get("color") : null,
        }
    },

    compareSymbolsArgument(symbolsArgument, quoteSymbolsText) {
        const argumentFromText = this.buildSymbolsArgument(quoteSymbolsText);
        this.logDebug(`compareSymbolsArgument - compare symbolsArgument(${symbolsArgument}) with argumentFromText(${argumentFromText})`);
        return symbolsArgument === argumentFromText;
    },

    isOkStatus(soupMessage) {
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

    isUnauthorizedStatus(soupMessage) {
        if (soupMessage) {
            if (IS_SOUP_2) {
                return soupMessage.status_code === Soup.KnownStatusCode.UNAUTHORIZED;
            } else {
                // get_status() throws exception on any value missing in enum SoupStatus, so better check reason_phrase
                return soupMessage.get_reason_phrase() === "Unauthorized";
            }
        }
        return false;
    },

    getMessageStatusInfo(soupMessage) {
        if (soupMessage) {
            if (IS_SOUP_2) {
                return soupMessage.status_code + " " + soupMessage.reason_phrase;
            } else {
                let reason = soupMessage.get_reason_phrase();
                let status = "unknown status";
                try {
                    status = soupMessage.get_status();
                } catch (err) {
                    // get_status() throws exception on any value missing in enum SoupStatus
                    this.logDebug(`getMessageStatusInfo - get_status() exception: ${err}`);
                    // YF is known to return "429 Too Many Requests", which is unfortunately missing in SoupStatus
                    if (err.message.indexOf("429") > -1) {
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
    populateQuoteDisplayName(quote, symbolCustomization, useLongName) {
        let displayName = ABSENT;

        if (symbolCustomization.name != null) {
            displayName = symbolCustomization.name;
        } else if (useLongName && this.existsProperty(quote, "longName")) {
            displayName = quote.longName;
        } else if (this.existsProperty(quote, "shortName")) {
            displayName = quote.shortName;
        }

        quote.displayName = displayName;
    },

    sortQuotesByProperty(quotes, prop, direction) {
        // don't sort if no criteria was given, or the criteria says "natural order", or there is only one quote
        if (typeof prop === "undefined" || prop === "none" || quotes.length < 2) {
            return quotes;
        }

        // when sort-by-name is configured, then we want to sort by the determined display name
        if (prop === "shortName") {
            prop = "displayName";
        }

        const _that = this;
        const clone = quotes.slice(0);
        const numberPattern = /^-?\d+(\.\d+)?$/;
        clone.sort((q1, q2) => {
            let p1 = "";
            if (_that.existsProperty(q1, prop)) {
                p1 = q1[prop].toString().match(numberPattern) ? + q1[prop] : q1[prop].toLowerCase();
            }
            let p2 = "";
            if (_that.existsProperty(q2, prop)) {
                p2 = q2[prop].toString().match(numberPattern) ? + q2[prop] : q2[prop].toLowerCase();
            }

            if (p1 < p2) {
                return -1 * direction;
            } else if (p1 > p2) {
                return 1 * direction;
            } else {
                return 0;
            }
        });
        return clone;
    }
}

function YahooFinanceQuoteReader(deskletId) {
    this.init(deskletId);
}

YahooFinanceQuoteReader.prototype = {

    init(deskletId) {
        this.id = deskletId;
        this.quoteUtils = new YahooFinanceQuoteUtils(deskletId);

        let httpSession;
        if (IS_SOUP_2) {
            httpSession = new Soup.SessionAsync();
            Soup.Session.prototype.add_feature.call(httpSession, new Soup.ProxyResolverDefault());
            Soup.Session.prototype.add_feature.call(httpSession, new Soup.ContentDecoder());
        } else { // assume version 3
            httpSession = new Soup.Session();
        }
        httpSession.timeout = 10;
        httpSession.idle_timeout = 10;

        const cookieJar = new Soup.CookieJar();
        Soup.Session.prototype.add_feature.call(httpSession, cookieJar);

        this.httpSession = httpSession;
        this.cookieJar = cookieJar;
        this.authParams = {
            cookie: null,
            crumb: null
        }
    },

    prepareCacheableAuthorizationParameters() {
        let authParamsToCache = DEFAULT_CACHED_AUTH_PARAMS;
        if (this.existsCookieInJar(AUTH_COOKIE) && this.hasCrumb()) {
            const authCookie = this.getCookieFromJar(AUTH_COOKIE);
            const expiresDateTime = IS_SOUP_2 ? authCookie.expires : authCookie.get_expires();
            try {
                authParamsToCache = JSON.stringify(
                    {
                        version: CACHED_AUTH_PARAMS_VERSION,
                        cookie: {
                            name: IS_SOUP_2 ? authCookie.name : authCookie.get_name(),
                            value: IS_SOUP_2 ? authCookie.value : authCookie.get_value(),
                            domain: IS_SOUP_2 ? authCookie.domain : authCookie.get_domain(),
                            path: IS_SOUP_2 ? authCookie.path : authCookie.get_path(),
                            expires: expiresDateTime ? (IS_SOUP_2 ? expiresDateTime.to_time_t() : expiresDateTime.to_unix()) : -1
                        },
                        crumb: {
                            value: this.getCrumb()
                        }
                    }
                );
            } catch (err) {
                this.quoteUtils.logException("Failed to stringify authorization parameters to cache", err);
            }
        }

        return authParamsToCache;
    },

    restoreCachedAuthorizationParameters(authParamsJson) {
        let cachedAuthParams;
        try {
            this.quoteUtils.logDebug(`getMessageStatusInfo - loading cached authorization parameters: ${authParamsJson}`);
            cachedAuthParams = JSON.parse(authParamsJson);
        } catch (err) {
            this.quoteUtils.logException(`Cached authorization parameters [${authParamsJson}] is not valid JSON`, err);
            cachedAuthParams = JSON.parse(DEFAULT_CACHED_AUTH_PARAMS);
        }

        if (this.hasCachedAuthorizationParameters(cachedAuthParams)) {
            this.setCookie(cachedAuthParams.cookie.value);
            this.addCookieToJar(cachedAuthParams.cookie);
            this.setCrumb(cachedAuthParams.crumb.value);

            this.quoteUtils.logDebug("getMessageStatusInfo - restored cached authorization parameters");
        } else {
            // either no params cached, or version mismatch
            this.quoteUtils.logDebug("getMessageStatusInfo - no cached authorization parameters restored");
        }
    },

    hasCachedAuthorizationParameters(cachedAuthParams) {
        return cachedAuthParams != null
            && this.quoteUtils.existsProperty(cachedAuthParams, "version")
            && cachedAuthParams.version === CACHED_AUTH_PARAMS_VERSION
            && this.quoteUtils.existsProperty(cachedAuthParams, "cookie")
            && this.quoteUtils.existsProperty(cachedAuthParams.cookie, "name")
            && this.quoteUtils.existsProperty(cachedAuthParams.cookie, "value")
            && this.quoteUtils.existsProperty(cachedAuthParams.cookie, "domain")
            && this.quoteUtils.existsProperty(cachedAuthParams.cookie, "path")
            && this.quoteUtils.existsProperty(cachedAuthParams.cookie, "expires")
            && this.quoteUtils.existsProperty(cachedAuthParams, "crumb")
            && this.quoteUtils.existsProperty(cachedAuthParams.crumb, "value");
    },

    setCrumb(crumb) {
        this.authParams.crumb = crumb;
    },

    hasCrumb() {
        return this.authParams.crumb != null;
    },

    getCrumb() {
        return this.authParams.crumb;
    },

    setCookie(authCookieValue) {
        this.authParams.cookie = AUTH_COOKIE + "=" + authCookieValue;
    },

    getCookieFromJar(name) {
        for (let cookie of this.cookieJar.all_cookies()) {
            let cookieName = IS_SOUP_2 ? cookie.name : cookie.get_name();
            if (cookieName === name) {
                const cookieValue = IS_SOUP_2 ? cookie.value : cookie.get_value();
                this.quoteUtils.logDebug(`getCookieFromJar - cookie ${name} found in jar, value: ${cookieValue}`);
                return cookie;
            }
        }

        this.quoteUtils.logDebug(`getCookieFromJar - no cookie found with name ${name}`);
        return null;
    },

    existsCookieInJar(name) {
        return (this.getCookieFromJar(name) != null);
    },

    addCookieToJar(cookieParams) {
        const cookie = new Soup.Cookie(cookieParams.name, cookieParams.value, cookieParams.domain, cookieParams.path, -1);
        if (cookieParams.expires > 0) {
            cookie.set_expires(IS_SOUP_2 ? Soup.Date.new_from_time_t(cookieParams.expires) : GLib.DateTime.new_from_unix_utc(cookieParams.expires));
        }
        this.cookieJar.add_cookie(cookie);
        this.quoteUtils.logDebug(`addCookieToJar - added cookie to jar: ${Object.entries(cookieParams)}`);
    },

    deleteAllCookies() {
        this.quoteUtils.logDebug("deleteAllCookies");
        for (let cookie of this.cookieJar.all_cookies()) {
            const cookieName = IS_SOUP_2 ? cookie.name : cookie.get_name();
            this.cookieJar.delete_cookie(cookie);
            this.quoteUtils.logDebug(`deleteAllCookies - cookie deleted from jar: ${cookieName}`);
        }
        this.quoteUtils.logDebug("deleteAllCookies - all cookies deleted from jar");
    },

    dropAuthParams() {
        this.deleteAllCookies();
        this.authParams.cookie = null;
        this.authParams.crumb = null;
    },

    retrieveCookie(customUserAgent, callback) {
        this.quoteUtils.logDebug("retrieveCookie");

        if (IS_SOUP_2) {
            this.retrieveCookieWithSoup2(customUserAgent, callback);
        } else {
            this.retrieveCookieWithSoup3(customUserAgent, callback);
        }
    },

    retrieveCookieWithSoup2(customUserAgent, callback) {
        const _that = this;
        const requestMessage = Soup.Message.new("GET", YF_COOKIE_URL);
        requestMessage.request_headers.append(ACCEPT_HEADER, ACCEPT_VALUE_COOKIE);
        requestMessage.request_headers.append(ACCEPT_ENCODING_HEADER, ACCEPT_ENCODING_VALUE);
        if (customUserAgent != null) {
            requestMessage.request_headers.append(USER_AGENT_HEADER, customUserAgent);
        }

        this.httpSession.queue_message(requestMessage, (session, message) => {
            _that.quoteUtils.logDebug(`retrieveCookieWithSoup2 - cookie response status: ${_that.quoteUtils.getMessageStatusInfo(message)}`);
            if (_that.quoteUtils.isOkStatus(message)) {
                try {
                    callback.call(_that, message, message.response_body.data);
                } catch (err) {
                    _that.quoteUtils.logException("Soup2 Error processing auth page response", err);
                }
            } else {
                _that.quoteUtils.logWarning(`Soup2 Error retrieving auth page! Status: ${_that.quoteUtils.getMessageStatusInfo(message)}`);
                callback.call(_that, message, null);
            }
        });
    },

    retrieveCookieWithSoup3(customUserAgent, callback) {
        const _that = this;
        const message = Soup.Message.new("GET", YF_COOKIE_URL);
        message.get_request_headers().append(ACCEPT_HEADER, ACCEPT_VALUE_COOKIE);
        message.get_request_headers().append(ACCEPT_ENCODING_HEADER, ACCEPT_ENCODING_VALUE);
        if (customUserAgent != null) {
            message.get_request_headers().append(USER_AGENT_HEADER, customUserAgent);
        }

        this.httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, (session, result) => {
            _that.quoteUtils.logDebug(`retrieveCookieWithSoup3 - cookie response status: ${_that.quoteUtils.getMessageStatusInfo(message)}`);
            if (_that.quoteUtils.isOkStatus(message)) {
                try {
                    const bytes = session.send_and_read_finish(result);
                    callback.call(_that, message, ByteArray.toString(bytes.get_data()));
                } catch (err) {
                    _that.quoteUtils.logException("Soup3 Error processing auth page response", err);
                }
            } else {
                _that.quoteUtils.logWarning(`Soup3 Error retrieving auth page! Status: ${_that.quoteUtils.getMessageStatusInfo(message)}`);
                callback.call(_that, message, null);
            }
        });
    },

    postConsent(customUserAgent, formData, callback) {
        this.quoteUtils.logDebug("postConsent");

        if (IS_SOUP_2) {
            this.postConsentWithSoup2(customUserAgent, formData, callback);
        } else {
            this.postConsentWithSoup3(customUserAgent, formData, callback);
        }
    },

    postConsentWithSoup2(customUserAgent, formData, callback) {
        const _that = this;
        const requestMessage = Soup.Message.new("POST", YF_CONSENT_URL);
        requestMessage.request_headers.append(ACCEPT_HEADER, ACCEPT_VALUE_COOKIE);
        requestMessage.request_headers.append(ACCEPT_ENCODING_HEADER, ACCEPT_ENCODING_VALUE);
        if (customUserAgent != null) {
            requestMessage.request_headers.append(USER_AGENT_HEADER, customUserAgent);
        }
        requestMessage.set_request(FORM_URLENCODED_VALUE, Soup.MemoryUse.COPY, formData);

        this.httpSession.queue_message(requestMessage, (session, message) => {
            _that.quoteUtils.logDebug(`postConsentWithSoup2 - consent response status: ${_that.quoteUtils.getMessageStatusInfo(message)}`);
            if (_that.quoteUtils.isOkStatus(message)) {
                try {
                    callback.call(_that, message);
                } catch (err) {
                    _that.quoteUtils.logException("Soup2 Error processing consent response", err);
                }
            } else {
                _that.quoteUtils.logWarning(`Soup2 Error sending consent. Status: ${_that.quoteUtils.getMessageStatusInfo(message)}`);
                callback.call(_that, message);
            }
        });
    },

    postConsentWithSoup3(customUserAgent, formData, callback) {
        const _that = this;
        const message = Soup.Message.new("POST", YF_CONSENT_URL);
        message.get_request_headers().append(ACCEPT_HEADER, ACCEPT_VALUE_COOKIE);
        message.get_request_headers().append(ACCEPT_ENCODING_HEADER, ACCEPT_ENCODING_VALUE);
        if (customUserAgent != null) {
            message.get_request_headers().append(USER_AGENT_HEADER, customUserAgent);
        }
        message.set_request_body_from_bytes(FORM_URLENCODED_VALUE, GLib.Bytes.new(formData));

        this.httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, (session, result) => {
            _that.quoteUtils.logDebug(`postConsentWithSoup3 - consent response status: ${_that.quoteUtils.getMessageStatusInfo(message)}`);
            if (_that.quoteUtils.isOkStatus(message)) {
                try {
                    callback.call(_that, message);
                } catch (err) {
                    _that.quoteUtils.logException("Soup3 Error processing consent response", err);
                }
            } else {
                _that.quoteUtils.logWarning(`Soup3 Error sending consent. Status: ${_that.quoteUtils.getMessageStatusInfo(message)}`);
                callback.call(_that, message);
            }
        });
    },

    retrieveCrumb(networkSettings, callback) {
        this.quoteUtils.logDebug("retrieveCrumb");

        if (networkSettings.enableCurl) {
            this.retrieveCrumbWithCurl(networkSettings, callback);
        } else {
            this.retrieveCrumbWithSoup(networkSettings, callback);
        }
    },

    retrieveCrumbWithCurl(networkSettings, callback) {
        this.quoteUtils.logDebug("retrieveCrumbWithCurl");

        const _that = this;
        const customUserAgent = networkSettings.customUserAgent;
        const authCookie = this.getCookieFromJar(AUTH_COOKIE);

        if (authCookie) {
            // keep authorization cookie
            const authCookieValue = IS_SOUP_2 ? authCookie.value : authCookie.get_value();
            this.setCookie(authCookieValue);

            // build argv array to invoke curl directly (avoid shell parsing and bash dependency)
            const curlArgs = [
                networkSettings.curlCommand,
                CURL_SILENT_LOCATION_OPTIONS,
                CURL_CONNECT_TIMEOUT_OPTION, CURL_CONNECT_TIMEOUT_VALUE,
                CURL_MAX_TIME_OPTION, CURL_MAX_TIME_VALUE,
                CURL_WRITE_OUT_OPTION, CURL_WRITE_OUT_VALUE,
                CURL_CIPHERS_OPTION, CURL_CIPHERS_VALUE,
                CURL_HEADER_OPTION, CURL_COOKIE_HEADER_NAME + this.authParams.cookie
            ];
            if (customUserAgent) {
                curlArgs.push(CURL_HEADER_OPTION, CURL_USER_AGENT_HEADER_NAME + customUserAgent);
            }
            curlArgs.push(YF_CRUMB_URL);
            this.quoteUtils.logDebug(`retrieveCrumbWithCurl - arguments: ${JSON.stringify(curlArgs)}`);

            let subProcess = spawnCommandLineAsyncIO("", (stdout, stderr, exitCode) => {
                _that.quoteUtils.logDebug(`retrieveCrumbWithCurl - result: exitCode: ${exitCode}. stdout: ${stdout}. stderr: ${stderr}`);
                if (exitCode === 0) {
                    const curlMessage = new CurlMessage(stdout);
                    if (_that.quoteUtils.isOkStatus(curlMessage)) {
                        try {
                            callback.call(_that, curlMessage, curlMessage.response_body);
                        } catch (err) {
                            _that.quoteUtils.logException("Curl Error processing crumb response", err);
                        }
                    } else {
                        _that.quoteUtils.logWarning(`Curl Error retrieving crumb! Status: ${_that.quoteUtils.getMessageStatusInfo(curlMessage)}`);
                        callback.call(_that, curlMessage, null);
                    }
                } else {
                    _that.quoteUtils.logError(`Curl retrieveCrumb error: Exit code: ${exitCode}. Out: ${stdout ? stdout.trim() : ""}. Err: ${stderr ? stderr.trim() : ""}`);
                    callback.call(_that, null, null);
                }

                try {
                    subProcess.send_signal(9);
                } catch (err) {
                    _that.quoteUtils.logDebug(`retrieveCrumbWithCurl - failed to send signal to subprocess: ${err}`);
                }
            }, { argv: curlArgs });
        } else {
            this.quoteUtils.logWarning("No auth cookie in Jar! Unable to retrieve crumb.");
            callback.call(_that, null, null);
        }
    },

    retrieveCrumbWithSoup(networkSettings, callback) {
        this.quoteUtils.logDebug("retrieveCrumbWithSoup");

        const customUserAgent = networkSettings.customUserAgent;

        if (IS_SOUP_2) {
            this.retrieveCrumbWithSoup2(customUserAgent, callback);
        } else {
            this.retrieveCrumbWithSoup3(customUserAgent, callback);
        }
    },

    retrieveCrumbWithSoup2(customUserAgent, callback) {
        const _that = this;
        const requestMessage = Soup.Message.new("GET", YF_CRUMB_URL);
        requestMessage.request_headers.append(ACCEPT_HEADER, ACCEPT_VALUE_CRUMB);
        requestMessage.request_headers.append(ACCEPT_ENCODING_HEADER, ACCEPT_ENCODING_VALUE);
        if (customUserAgent != null) {
            requestMessage.request_headers.append(USER_AGENT_HEADER, customUserAgent);
        }

        this.httpSession.queue_message(requestMessage, (session, message) => {
            _that.quoteUtils.logDebug(`retrieveCrumbWithSoup2 - response status: ${_that.quoteUtils.getMessageStatusInfo(message)}`);
            if (_that.quoteUtils.isOkStatus(message)) {
                try {
                    callback.call(_that, message, message.response_body);
                } catch (err) {
                    _that.quoteUtils.logException("Soup2 Error processing crumb response", err);
                }
            } else {
                _that.quoteUtils.logWarning(`Soup2 Error retrieving crumb! Status: ${_that.quoteUtils.getMessageStatusInfo(message)}`);
                callback.call(_that, message, null);
            }
        });
    },

    retrieveCrumbWithSoup3(customUserAgent, callback) {
        const _that = this;
        const message = Soup.Message.new("GET", YF_CRUMB_URL);
        message.get_request_headers().append(ACCEPT_HEADER, ACCEPT_VALUE_CRUMB);
        message.get_request_headers().append(ACCEPT_ENCODING_HEADER, ACCEPT_ENCODING_VALUE);
        if (customUserAgent != null) {
            message.get_request_headers().append(USER_AGENT_HEADER, customUserAgent);
        }

        this.httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, (session, result) => {
            _that.quoteUtils.logDebug(`retrieveCrumbWithSoup3 - response status: ${_that.quoteUtils.getMessageStatusInfo(message)}`);
            if (_that.quoteUtils.isOkStatus(message)) {
                try {
                    const bytes = session.send_and_read_finish(result);
                    callback.call(_that, message, ByteArray.toString(bytes.get_data()));
                } catch (err) {
                    _that.quoteUtils.logException("Soup3 Error processing crumb response", err);
                }
            } else {
                _that.quoteUtils.logWarning(`Soup3 Error retrieving crumb! Status: ${_that.quoteUtils.getMessageStatusInfo(message)}`);
                callback.call(_that, message, null);
            }
        });
    },

    retrieveFinanceData(quoteSymbolsArg, networkSettings, callback) {
        this.quoteUtils.logDebug("retrieveFinanceData");

        const _that = this;

        if (quoteSymbolsArg.length === 0) {
            callback.call(_that, _that.buildErrorResponse(_("Empty quotes list. Open settings and add some symbols.")));
            return;
        }

        const requestUrl = this.createYahooQueryUrl(quoteSymbolsArg, this.authParams.crumb);

        if (networkSettings.enableCurl) {
            this.retrieveFinanceDataWithCurl(requestUrl, networkSettings, callback);
        } else if (IS_SOUP_2) {
            this.retrieveFinanceDataWithSoup2(requestUrl, networkSettings, callback);
        } else {
            this.retrieveFinanceDataWithSoup3(requestUrl, networkSettings, callback);
        }
    },

    retrieveFinanceDataWithCurl(requestUrl, networkSettings, callback) {
        this.quoteUtils.logDebug("retrieveFinanceDataWithCurl");
        const _that = this;
        const customUserAgent = networkSettings.customUserAgent;

        // build argv array to invoke curl directly (avoid shell parsing and bash dependency)
        const curlArgs = [
            networkSettings.curlCommand,
            CURL_SILENT_LOCATION_OPTIONS,
            CURL_CONNECT_TIMEOUT_OPTION, CURL_CONNECT_TIMEOUT_VALUE,
            CURL_MAX_TIME_OPTION, CURL_MAX_TIME_VALUE,
            CURL_WRITE_OUT_OPTION, CURL_WRITE_OUT_VALUE,
            CURL_CIPHERS_OPTION, CURL_CIPHERS_VALUE,
            CURL_HEADER_OPTION, CURL_COOKIE_HEADER_NAME + this.authParams.cookie
        ];
        if (customUserAgent) {
            curlArgs.push(CURL_HEADER_OPTION, CURL_USER_AGENT_HEADER_NAME + customUserAgent);
        }
        curlArgs.push(requestUrl);
        this.quoteUtils.logDebug(`retrieveFinanceDataWithCurl - arguments: ${JSON.stringify(curlArgs)}`);

        let subProcess = spawnCommandLineAsyncIO("", (stdout, stderr, exitCode) => {
            _that.quoteUtils.logDebug(`retrieveFinanceDataWithCurl - exitCode: ${exitCode}. stdout: ${stdout}. stderr: ${stderr}`);
            if (exitCode === 0) {
                const curlMessage = new CurlMessage(stdout);
                if (_that.quoteUtils.isOkStatus(curlMessage)) {
                    try {
                        callback.call(_that, curlMessage.response_body);
                    } catch (err) {
                        _that.quoteUtils.logException("Curl Error processing finance data", err);
                    }
                } else if (_that.quoteUtils.isUnauthorizedStatus(curlMessage)) {
                    _that.quoteUtils.logDebug("retrieveFinanceDataWithCurl - current authorization parameters have expired. Discarding them.");
                    _that.dropAuthParams();
                    callback.call(_that, _that.buildErrorResponse(_("Authorization parameters have expired")), true, true);
                } else {
                    _that.quoteUtils.logWarning(`Curl Error retrieving url ${requestUrl}. Status: ${_that.quoteUtils.getMessageStatusInfo(curlMessage)}`);
                    callback.call(_that, _that.buildErrorResponse(_("Yahoo Finance service not available! Status: ") + _that.quoteUtils.getMessageStatusInfo(curlMessage)));
                }
            } else {
                _that.quoteUtils.logError(`Curl retrieveFinanceData error: Exit code: ${exitCode}. Out: ${stdout ? stdout.trim() : ""}. Err: ${stderr ? stderr.trim() : ""}`);
                callback.call(_that, _that.buildErrorResponse(_("Something went wrong retrieving Yahoo Finance data") + ". " + stderr));
            }

            try {
                subProcess.send_signal(9);
            } catch (err) {
                _that.quoteUtils.logDebug(`retrieveFinanceDataWithCurl - failed to send signal to subprocess: ${err}`);
            }
        }, { argv: curlArgs });
    },

    retrieveFinanceDataWithSoup2(requestUrl, networkSettings, callback) {
        this.quoteUtils.logDebug("retrieveFinanceDataWithSoup2");
        const _that = this;
        const customUserAgent = networkSettings.customUserAgent;
        const requestMessage = Soup.Message.new("GET", requestUrl);

        if (customUserAgent != null) {
            requestMessage.request_headers.append(USER_AGENT_HEADER, customUserAgent);
        }

        this.httpSession.queue_message(requestMessage, (session, message) => {
            _that.quoteUtils.logDebug(`retrieveFinanceDataWithSoup2 - response status: ${_that.quoteUtils.getMessageStatusInfo(message)}`);
            if (_that.quoteUtils.isOkStatus(message)) {
                try {
                    callback.call(_that, message.response_body.data.toString());
                } catch (err) {
                    _that.quoteUtils.logException("Soup2 Error processing finance data", err);
                }
            } else if (_that.quoteUtils.isUnauthorizedStatus(message)) {
                _that.quoteUtils.logDebug("retrieveFinanceDataWithSoup2 - current authorization parameters have expired. Discarding them.");
                _that.dropAuthParams();
                callback.call(_that, _that.buildErrorResponse(_("Authorization parameters have expired")), true, true);
            } else {
                _that.quoteUtils.logWarning(`Soup2 Error retrieving url ${requestUrl}. Status: ${_that.quoteUtils.getMessageStatusInfo(message)}`);
                callback.call(_that, _that.buildErrorResponse(_("Yahoo Finance service not available! Status: ") + _that.quoteUtils.getMessageStatusInfo(message)));
            }
        });
    },

    retrieveFinanceDataWithSoup3(requestUrl, networkSettings, callback) {
        this.quoteUtils.logDebug("retrieveFinanceDataWithSoup3");
        const _that = this;
        const customUserAgent = networkSettings.customUserAgent;
        const message = Soup.Message.new("GET", requestUrl);

        if (customUserAgent != null) {
            message.get_request_headers().append(USER_AGENT_HEADER, customUserAgent);
        }

        this.httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, (session, result) => {
            _that.quoteUtils.logDebug(`retrieveFinanceDataWithSoup3 - response status: ${_that.quoteUtils.getMessageStatusInfo(message)}`);
            if (_that.quoteUtils.isOkStatus(message)) {
                try {
                    const bytes = session.send_and_read_finish(result);
                    callback.call(_that, ByteArray.toString(bytes.get_data()));
                } catch (err) {
                    _that.quoteUtils.logException("Soup3 Error processing finance data", err);
                }
            } else if (_that.quoteUtils.isUnauthorizedStatus(message)) {
                _that.quoteUtils.logDebug("retrieveFinanceDataWithSoup3 - current authorization parameters have expired. Discarding them.");
                _that.dropAuthParams();
                callback.call(_that, _that.buildErrorResponse(_("Authorization parameters have expired")), true, true);
            } else {
                _that.quoteUtils.logWarning(`Soup3 Error retrieving url ${requestUrl}. Status: ${_that.quoteUtils.getMessageStatusInfo(message)}`);
                callback.call(_that, _that.buildErrorResponse(_("Yahoo Finance service not available! Status: ") + _that.quoteUtils.getMessageStatusInfo(message)));
            }
        });
    },

    createYahooQueryUrl(quoteSymbolsArg, crumb) {
        const queryUrl = `${YF_QUOTE_URL}?lang=en-US&region=US&formatted=false&fields=${YF_QUOTE_FIELDS}&symbols=${encodeURIComponent(quoteSymbolsArg)}&crumb=${crumb}`;
        this.quoteUtils.logDebug(`createYahooQueryUrl - constructed URL: ${queryUrl}`);
        return queryUrl;
    },

    buildErrorResponse(errorMsg) {
        return JSON.stringify(
            {
                quoteResponse: {
                    result: [],
                    error: (errorMsg ? errorMsg.trim() : ABSENT)
                }
            });
    }
}

function QuotesTable(deskletId) {
    this.init(deskletId);
}

QuotesTable.prototype = {

    init(deskletId) {
        this.quoteUtils = new YahooFinanceQuoteUtils(deskletId);
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

    renderTable(quotes, symbolCustomizationMap, settings) {
        for (let rowIndex = 0, l = quotes.length;rowIndex < l;rowIndex++) {
            this.renderTableRow(quotes[rowIndex], symbolCustomizationMap, settings, rowIndex);
        }
    },

    renderTableRow(quote, symbolCustomizationMap, settings, rowIndex) {
        let cellContents = [];
        const symbol = quote.symbol;
        const symbolCustomization = symbolCustomizationMap.get(symbol);

        const currentMarketState = this.determineCurrentMarketState(quote);
        const includePrePostMarketData = this.includePrePostMarketData(settings, currentMarketState);

        let marketState;
        if (includePrePostMarketData) {
            marketState = currentMarketState;
        } else {
            marketState = DEFAULT_MARKET_STATE;
        }

        if (settings.changeIcon) {
            cellContents.push(this.createPercentChangeIcon(quote, settings, marketState));
        }

        if (settings.quoteName) {
            cellContents.push(this.createQuoteLabel(quote.displayName, symbolCustomization, settings.quoteLabelWidth, settings));
        }
        if (settings.quoteSymbol) {
            cellContents.push(this.createQuoteLabel(symbol, symbolCustomization, settings.quoteSymbolWidth, settings));
        }

        // keep regular unless values should be replaced with pre-/post market values
        if (includePrePostMarketData && settings.prePostMarketDataOption !== "replace") {
            marketState = DEFAULT_MARKET_STATE;
        }

        if (settings.marketPrice) {
            cellContents.push(this.createMarketPriceLabel(quote, settings, marketState));
        }
        if (settings.absoluteChange) {
            cellContents.push(this.createAbsoluteChangeLabel(quote, settings, marketState));
        }
        if (settings.percentChange) {
            cellContents.push(this.createPercentChangeLabel(quote, settings, marketState));
        }
        if (settings.tradeTime) {
            cellContents.push(this.createTradeTimeLabel(quote, settings, marketState));
        }

        // render extra columns for pre/post
        if (includePrePostMarketData && settings.prePostMarketDataOption === "separate") {
            marketState = currentMarketState;

            if (settings.marketPrice) {
                cellContents.push(this.createMarketPriceLabel(quote, settings, marketState));
            }
            if (settings.absoluteChange) {
                cellContents.push(this.createAbsoluteChangeLabel(quote, settings, marketState));
            }
            if (settings.percentChange) {
                cellContents.push(this.createPercentChangeLabel(quote, settings, marketState));
            }
            if (settings.tradeTime) {
                cellContents.push(this.createTradeTimeLabel(quote, settings, marketState));
            }
        }

        for (let columnIndex = 0;columnIndex < cellContents.length;++columnIndex) {
            this.el.add(cellContents[columnIndex], {
                row: rowIndex,
                col: columnIndex
            });
        }
    },

    determineCurrentMarketState(quote) {
        if (this.quoteUtils.existsProperty(quote, "hasPrePostMarketData") && quote.hasPrePostMarketData) {
            // since "regularMarket" fields are always expected, this is the default 
            let marketState = "REGULAR";
            if (this.quoteUtils.existsProperty(quote, "marketState")) {
                marketState = quote.marketState;
            }
            
            // check first if market is currently open
            if (marketState === "REGULAR") {
                return DEFAULT_MARKET_STATE;
            }

            // if market is in a "pre"ish state and there are pre-market data present, then assume that market will open (soon)
            if (marketState.includes("PRE") && this.quoteUtils.existsProperty(quote, "preMarketTime")) {
                return "pre";
            }

            // if market is in a "post"ish state and there are post-market data present, then assume that market has (recently) closed
            if (marketState.includes("POST") && this.quoteUtils.existsProperty(quote, "postMarketTime")) {
                return "post";
            }
            
            // other market states such as CLOSED (e.g. on weekends) are ignored and treated as regular
        }

        return DEFAULT_MARKET_STATE;
    },

    includePrePostMarketData(settings, currentMarketState) {
        return settings.prePostMarketDataOption !== "never" && currentMarketState !== DEFAULT_MARKET_STATE;
    },

    buildPrePostMarketProperty(marketState, suffix) {
        return marketState + suffix;
    },

    createQuoteLabel(labelText, symbolCustomization, width, settings) {
        const label = new St.Label({
            text: labelText,
            style_class: "quotes-label",
            reactive: settings.linkQuote,
            style: "width:" + width + "em; " + this.buildCustomStyle(settings, symbolCustomization)
        });

        if (settings.linkQuote) {
            const symbolButton = new St.Button();
            symbolButton.add_actor(label);
            symbolButton.connect("clicked", () => {
                Gio.app_info_launch_default_for_uri(YF_QUOTE_WEBPAGE_URL + encodeURIComponent(symbolCustomization.symbol), global.create_app_launch_context());
            });
            return symbolButton;
        } else {
            return label;
        }
    },

    createMarketPriceLabel(quote, settings, marketState) {
        let currencySymbol = "";
        if (settings.currencySymbol && this.quoteUtils.existsProperty(quote, "currency")) {
            currencySymbol = this.currencyCodeToSymbolMap[quote.currency] || quote.currency;
        }
        const marketPriceProperty = this.buildPrePostMarketProperty(marketState, "MarketPrice");
        return new St.Label({
            text: currencySymbol + (this.quoteUtils.existsProperty(quote, marketPriceProperty)
                ? this.roundAmount(quote[marketPriceProperty], settings.decimalPlaces, settings.strictRounding)
                : ABSENT),
            style_class: "quotes-number",
            style: this.buildFontStyle(settings, marketState)
        });
    },

    createAbsoluteChangeLabel(quote, settings, marketState) {
        const marketChangeProperty = this.buildPrePostMarketProperty(marketState, "MarketChange");
        let absoluteChangeText = "";
        if (this.quoteUtils.existsProperty(quote, marketChangeProperty)) {
            let absoluteChange = this.roundAmount(quote[marketChangeProperty], settings.decimalPlaces, settings.strictRounding);
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
            style: this.buildFontStyle(settings, marketState)
        });
    },

    createPercentChangeIcon(quote, settings, marketState) {
        const marketChangePercentProperty = this.buildPrePostMarketProperty(marketState, "MarketChangePercent");
        const percentChange = this.quoteUtils.existsProperty(quote, marketChangePercentProperty)
            ? parseFloat(quote[marketChangePercentProperty])
            : 0.0;
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
            style: this.buildFontStyle(settings, marketState, iconColor)
        });
    },

    createPercentChangeLabel(quote, settings, marketState) {
        const marketChangePercentProperty = this.buildPrePostMarketProperty(marketState, "MarketChangePercent");
        let labelColor = settings.fontColor;
        if (settings.colorPercentChange && this.quoteUtils.existsProperty(quote, marketChangePercentProperty)) {
            const percentageChange = parseFloat(quote[marketChangePercentProperty]);
            if (percentageChange > 0) {
                labelColor = settings.uptrendChangeColor;
            } else if (percentageChange < 0) {
                labelColor = settings.downtrendChangeColor;
            } else {
                labelColor = settings.unchangedTrendColor;
            }
        }

        return new St.Label({
            text: this.quoteUtils.existsProperty(quote, marketChangePercentProperty)
                ? (this.roundAmount(quote[marketChangePercentProperty], 2, settings.strictRounding) + "%")
                : ABSENT,
            style_class: "quotes-number",
            style: this.buildFontStyle(settings, marketState, labelColor)
        });
    },

    roundAmount(amount, maxDecimals, strictRounding) {
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

    isToday(date) {
        const today = new Date();
        return date.getFullYear() === today.getFullYear()
            && date.getMonth() === today.getMonth()
            && date.getDate() === today.getDate();
    },

    formatTime(unixTimestamp, settings) {
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
        } else if (settings.customDateFormat) {
            tsFormat = ts.toLocaleFormat(settings.customDateFormat);
        } else {
            tsFormat = ts.toLocaleDateString(undefined, {
                month: "numeric",
                day: "numeric"
            });
        }

        return tsFormat;
    },

    createTradeTimeLabel(quote, settings, marketState) {
        const tradeTimeProperty = this.buildPrePostMarketProperty(marketState, "MarketTime");

        return new St.Label({
            text: this.quoteUtils.existsProperty(quote, tradeTimeProperty)
                ? this.formatTime(quote[tradeTimeProperty], settings)
                : ABSENT,
            style_class: "quotes-number",
            style: this.buildFontStyle(settings, marketState)
        });
    },


    buildFontStyle(settings, marketState, color = settings.fontColor) {
        let style = this.buildColorAttribute(color, null)
            + this.buildFontSizeAttribute(settings.fontSize);

        if (marketState !== DEFAULT_MARKET_STATE) {
            const prePostMarketDataStyle = settings.fontStylePrePostMarketData;
            if (prePostMarketDataStyle.includes("italic")) {
                style += this.buildFontStyleAttribute("italic");
            }
            if (prePostMarketDataStyle.includes("bold")) {
                style += this.buildFontWeightAttribute("bold");
            }
        }

        return style;
    },

    buildCustomStyle(settings, symbolCustomization) {
        return this.buildColorAttribute(settings.fontColor, symbolCustomization.color)
            + this.buildFontSizeAttribute(settings.fontSize)
            + this.buildFontStyleAttribute(symbolCustomization.style)
            + this.buildFontWeightAttribute(symbolCustomization.weight);
    },

    buildColorAttribute(globalColor, symbolColor) {
        return "color: " + (symbolColor != null ? symbolColor : globalColor) + "; ";
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

function StockQuoteDesklet(metadata, deskletId) {
    this.init(metadata, deskletId);
}

StockQuoteDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    init(metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.quoteUtils = new YahooFinanceQuoteUtils(deskletId);
        this.quoteUtils.logDebug(`init - id: ${deskletId}`);
        this.metadata = metadata;
        this.id = deskletId;
        this.updateId = 0;
        // no timer needed yet
        this.allowNewTimer = false;
        this.authAttempts = 0;
        this.quoteReader = new YahooFinanceQuoteReader(deskletId);
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

    loadSettings() {
        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, this.id);
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
        this.settings.bind("includePrePostMarketDataOption", "includePrePostMarketDataOption", this.onRenderSettingsChanged);
        this.settings.bind("fontColor", "fontColor", this.onRenderSettingsChanged);
        this.settings.bind("scaleFontSize", "scaleFontSize", this.onRenderSettingsChanged);
        this.settings.bind("fontScale", "fontScale", this.onRenderSettingsChanged);
        this.settings.bind("fontStylePrePostMarketData", "fontStylePrePostMarketData", this.onRenderSettingsChanged);
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

    getQuoteDisplaySettings(quotes) {
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
            "prePostMarketDataOption": this.includePrePostMarketDataOption,
            "decimalPlaces": this.roundNumbers ? this.decimalPlaces : -1,
            "strictRounding": this.roundNumbers && this.strictRounding,
            "use24HourTime": this.use24HourTime,
            "customTimeFormat": this.customTimeFormat,
            "customDateFormat": this.customDateFormat,
            "fontColor": this.fontColor,
            "fontSize": this.scaleFontSize ? Math.round(BASE_FONT_SIZE * this.fontScale * global.ui_scale) : -1,
            "fontStylePrePostMarketData": this.fontStylePrePostMarketData,
            "uptrendChangeColor": this.uptrendChangeColor,
            "downtrendChangeColor": this.downtrendChangeColor,
            "unchangedTrendColor": this.unchangedTrendColor,
            "quoteSymbolWidth": Math.max(...quotes.map((quote) => quote.symbol.length)),
            "quoteLabelWidth": Math.max(...quotes.map((quote) => quote.displayName.length)) / 2 + 2
        }
    },

    getNetworkSettings() {
        let curlCommandEnabledAndExists = false;
        if (this.enableCurl) {
            if (this.curlCommand && Gio.file_new_for_path(this.curlCommand).query_exists(null)) {
                curlCommandEnabledAndExists = true;
            } else {
                this.quoteUtils.logWarning(`Invalid path [${this.curlCommand}] configured for curl executable. Curl will not be used.`);
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

    createLastUpdateLabel(lastUpdated, settings) {
        const label = new St.Label({
            text: _("Updated at ") + this.formatCurrentTimestamp(lastUpdated, settings),
            style_class: "quotes-last-update",
            reactive: this.manualDataUpdate,
            style: "color: " + settings.fontColor + "; " + (settings.fontSize > 0 ? "font-size: " + settings.fontSize + "px;" : "")
        });

        if (this.manualDataUpdate) {
            const updateButton = new St.Button();
            updateButton.add_actor(label);
            updateButton.connect("clicked", () => {
                this.onManualRefreshRequested();
            });
            return updateButton;
        } else {
            return label;
        }
    },

    formatCurrentTimestamp(lastUpdated, settings) {
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

    createErrorLabel(responseError) {
        const errorMsg = _("Error: ") + JSON.stringify(responseError);
        this.quoteUtils.logWarning(errorMsg);

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
    onDisplaySettingChanged() {
        this.quoteUtils.logDebug("onDisplaySettingChanged");
        this.mainBox.set_size(this.width, this.height);
        this.setDeskletStyle();
    },

    setDeskletStyle() {
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

    buildBackgroundColor(rgbColorString, transparencyFactor) {
        // parse RGB values between "rgb(...)"
        const matcher = rgbColorString && rgbColorString.match(/\((.*?)\)/);
        if (matcher) {
            const components = matcher[1].split(",").map((s) => parseInt(s, 10));
            // expect 3 int numbers
            if (components.length === 3 && !components.some(isNaN)) {
                return `rgba(${components[0]},${components[1]},${components[2]},${transparencyFactor})`;
            }
        }

        // fallback to default background color
        return `rgba(0,0,0,${transparencyFactor})`;
    },

    // called on events that change the quotes data layout (sorting, show/hide fields, text color, etc)
    onRenderSettingsChanged() {
        this.quoteUtils.logDebug("onRenderSettingsChanged");
        this.render();
    },

    // called on events that change the way YFQ data are fetched (data refresh interval)
    onDataFetchSettingsChanged() {
        this.quoteUtils.logDebug("onDataFetchSettingsChanged");
        this.replaceUpdateTimer();
    },

    // called when user requests a data refresh (by button from settings, or by link on last-update-timestamp)
    onManualRefreshRequested() {
        this.quoteUtils.logDebug("onManualRefreshRequested");
        this.onQuotesListChanged();
    },

    // called when user applies network settings
    onNetworkSettingsChanged() {
        this.quoteUtils.logDebug("onNetworkSettingsChanged");

        // reset auth state
        this.authAttempts = 0;
        this.quoteReader.dropAuthParams();
        this.saveAuthorizationParameters(true);
        this.quoteUtils.logInfo("Dropped all authorization parameters");

        this.replaceUpdateTimer(true);
    },

    // called on events that change the quotes data (quotes list)
    // BEWARE: DO NOT use this function as callback in settings.bind() - otherwise multiple YFQ requests are fired, and multiple timers are created!
    onQuotesListChanged() {
        this.quoteUtils.logDebug("onQuotesListChanged");

        // if no timer is active, then another data refresh might already be in progress
        if (this.allowNewTimer) {
            this.quoteUtils.logDebug(`onQuotesListChanged - data refresh in progress, updateId (expect 0): ${this.updateId}`);
            return;
        }

        // stop timer, a new one will be created in fetchFinanceDataAndRender()
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
                this.quoteUtils.logDebug("onQuotesListChanged - no more auth attempts left, dropping all auth params");
                this.quoteReader.dropAuthParams();
                this.saveAuthorizationParameters(true);
            }
        } catch (err) {
            this.quoteUtils.logException("Cannot fetch quotes information for symbol " + quoteSymbolsArg, err);
            this.processFailedFetch(err);
        }
    },

    fetchFinanceDataAndRender(quoteSymbolsArg, networkSettings) {
        this.quoteUtils.logDebug(`fetchFinanceDataAndRender - quotes: ${quoteSymbolsArg}, network settings: ${Object.entries(networkSettings)}`);
        const _that = this;

        this.quoteReader.retrieveFinanceData(quoteSymbolsArg, networkSettings, (response, instantTimer = false, dropCachedAuthParams = false) => {
            _that.quoteUtils.logDebug(`fetchFinanceDataAndRender - response: ${response}`);
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

                _that.replaceUpdateTimer(instantTimer);
                _that.render();
            } catch (err) {
                _that.quoteUtils.logException("Query response is not valid JSON", err);
                // set current quotes list to pass check that quotes list has not changed in render()
                _that.processFailedFetch(err, quoteSymbolsArg);
            }
        });
    },

    fetchCookieAndRender(quoteSymbolsArg, networkSettings) {
        this.quoteUtils.logDebug(`fetchCookieAndRender - quotes: ${quoteSymbolsArg}, network settings: ${Object.entries(networkSettings)}`);
        const _that = this;

        this.quoteReader.retrieveCookie(networkSettings.customUserAgent, (authResponseMessage, responseBody) => {
            _that.quoteUtils.logDebug(`fetchCookieAndRender - cookie response body: ${responseBody}`);
            if (_that.quoteReader.existsCookieInJar(AUTH_COOKIE)) {
                _that.fetchCrumbAndRender(quoteSymbolsArg, networkSettings);
            } else if (_that.quoteReader.existsCookieInJar(CONSENT_COOKIE)) {
                _that.processConsentAndRender(authResponseMessage, responseBody, quoteSymbolsArg, networkSettings);
            } else {
                _that.quoteUtils.logWarning("Failed to retrieve auth cookie!");
                _that.authAttempts++;
                _that.processFailedFetch(_("Failed to retrieve authorization parameter! Unable to fetch quotes data. Status: ") + _that.quoteUtils.getMessageStatusInfo(authResponseMessage));
            }
        });
    },

    processConsentAndRender(authResponseMessage, consentPage, quoteSymbolsArg, networkSettings) {
        this.quoteUtils.logDebug("processConsentAndRender");
        const _that = this;
        const CONSENT_FORM_PATTERN = /(<form method="post")(.*)(action="">)/;
        const HIDDEN_FORM_FIELDS_PATTERN = /(<input type="hidden" name=")(.*?)(" value=")(.*?)(">)/g;
        const MAX_FORM_FIELDS = 20;  // limit form field evaluation to prevent infinite loop

        let consentFormFields = "";
        if (CONSENT_FORM_PATTERN.test(consentPage)) {
            let maxFields = 0;
            let hiddenField;
            // find all hidden form fields and concatenate them as parameters
            while (maxFields < MAX_FORM_FIELDS && (hiddenField = HIDDEN_FORM_FIELDS_PATTERN.exec(consentPage)) != null) {
                consentFormFields = consentFormFields + hiddenField[2] + "=" + hiddenField[4] + "&";
                maxFields++;
            }
            // append parameter to reject consent
            consentFormFields += "reject=reject";

            // submit consent form, expect to receive authorization cookie in response
            this.quoteReader.postConsent(networkSettings.customUserAgent, consentFormFields, (consentResponseMessage) => {
                if (_that.quoteReader.existsCookieInJar(AUTH_COOKIE)) {
                    _that.fetchCrumbAndRender(quoteSymbolsArg, networkSettings);
                } else {
                    _that.quoteUtils.logWarning("Failed to retrieve auth cookie from consent form");
                    _that.authAttempts++;
                    _that.processFailedFetch(_("Consent processing failed! Unable to fetch quotes data. Status: ") + _that.quoteUtils.getMessageStatusInfo(consentResponseMessage));
                }
            });
        } else {
            this.quoteUtils.logWarning("Consent form not detected");
            this.authAttempts++;
            this.processFailedFetch(_("Consent processing not completed! Unable to fetch quotes data. Status: ") + this.quoteUtils.getMessageStatusInfo(authResponseMessage));
        }
    },

    fetchCrumbAndRender(quoteSymbolsArg, networkSettings) {
        this.quoteUtils.logDebug("fetchCrumbAndRender");
        const _that = this;

        if (!this.hasRemainingAuthAttempts()) {
            return;
        }

        this.quoteReader.retrieveCrumb(networkSettings, (crumbResponseMessage, responseBody) => {
            _that.quoteUtils.logDebug(`fetchCrumbAndRender - response body: ${responseBody}`);
            if (responseBody) {
                if (typeof responseBody.data === "string" && responseBody.data.trim() !== "" && !/\s/.test(responseBody.data)) {
                    // libsoup2
                    _that.quoteReader.setCrumb(responseBody.data);
                } else if (typeof responseBody === "string" && responseBody.trim() !== "" && !/\s/.test(responseBody)) {
                    // libsoup3, curl
                    _that.quoteReader.setCrumb(responseBody);
                } else {
                    _that.quoteUtils.logWarning(`Unhandled crumb response body: ${responseBody}`);
                }
            }

            if (_that.quoteReader.hasCrumb()) {
                _that.quoteUtils.logInfo("Successfully retrieved all authorization parameters");
                if (networkSettings.cacheAuthorizationParameters) {
                    _that.saveAuthorizationParameters();
                }
                _that.fetchFinanceDataAndRender(quoteSymbolsArg, networkSettings);
            } else {
                _that.quoteUtils.logWarning("Failed to retrieve crumb!");
                _that.authAttempts++;
                _that.saveAuthorizationParameters(true);
                _that.processFailedFetch(_("Failed to retrieve authorization crumb! Unable to fetch quotes data. Status: ") + _that.quoteUtils.getMessageStatusInfo(crumbResponseMessage));
            }
        });
    },

    saveAuthorizationParameters(dropCachedAuthParams = false) {
        const authParamsJson = dropCachedAuthParams ? DEFAULT_CACHED_AUTH_PARAMS : this.quoteReader.prepareCacheableAuthorizationParameters();
        this.settings.setValue("authorizationParameters", authParamsJson);
        this.quoteUtils.logDebug(`saveAuthorizationParameters - saved authorization parameters to desklet settings: ${authParamsJson}`);
    },


    hasRemainingAuthAttempts() {
        return this.authAttempts < MAX_AUTH_ATTEMPTS;
    },

    processFailedFetch(errorMessage, symbolsArg = "") {
        this.quoteUtils.logDebug(`processFailedFetch - errorMessage: ${errorMessage}`);
        const errorResponse = JSON.parse(this.quoteReader.buildErrorResponse(errorMessage));
        this.lastResponse = {
            symbolsArgument: symbolsArg,
            responseResult: errorResponse.quoteResponse.result,
            responseError: errorResponse.quoteResponse.error,
            lastUpdated: new Date()
        }

        this.replaceUpdateTimer();
        this.render();
    },

    replaceUpdateTimer(instantTimer = false) {
        this.quoteUtils.logDebug(`replaceUpdateTimer - instantTimer: ${instantTimer}`);
        // stop current timer, if any
        this.removeUpdateTimer();

        if (this.allowNewTimer) {
            let delaySeconds;
            if (instantTimer) {
                this.quoteUtils.logDebug("replaceUpdateTimer - add instant timer");
                delaySeconds = 1;
            } else {
                delaySeconds = this.delayMinutes * 60;
            }

            this.updateId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delaySeconds, () => {
                this.onQuotesListChanged();
                return GLib.SOURCE_CONTINUE;
            });
            this.quoteUtils.logDebug(`replaceUpdateTimer - started new timer, new updateId: ${this.updateId}`);
            this.allowNewTimer = false;
        }
    },

    removeUpdateTimer(shutdownInProgress = false) {
        this.quoteUtils.logDebug(`removeUpdateTimer - updateId: ${this.updateId}`);
        if (this.updateId > 0) {
            GLib.source_remove(this.updateId);
            this.quoteUtils.logDebug(`removeUpdateTimer - timer removed for updateId ${this.updateId}`);
        } else {
            this.quoteUtils.logDebug("removeUpdateTimer - no timer exists");
        }
        this.updateId = 0;
        // prevent new timer when desklet is in process to be removed
        // this is the only place where allowNewTimer can be set to 'true'
        this.allowNewTimer = !shutdownInProgress;
    },

    // main method to render the desklet
    render() {
        this.quoteUtils.logDebug("render");

        // check if quotes list was changed but no call of onQuotesListChanged() occurred, e.g. on layout changes
        if (this.hasRemainingAuthAttempts() &&
            !this.quoteUtils.compareSymbolsArgument(this.lastResponse.symbolsArgument, this.quoteSymbolsText)) {
            this.quoteUtils.logDebug("render - detected changed quotes list, initiate data refresh");
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
        if (responseError != null) {
            tableContainer.add_actor(this.createErrorLabel(responseError));
        }

        const responseResult = this.lastResponse.responseResult;
        if (responseResult != null) {
            const symbolCustomizationMap = this.quoteUtils.buildSymbolCustomizationMap(this.quoteSymbolsText);

            // some preparations before the rendering starts
            for (const quote of responseResult) {
                // sometimes YF returns a symbol we didn't query for
                // add such "new" symbols to the customization map for easier processing in the various render.. functions
                const returnedSymbol = quote.symbol;
                if (!symbolCustomizationMap.has(returnedSymbol)) {
                    this.quoteUtils.logDebug(`render - adding unknown symbol to customization map: ${returnedSymbol}`);
                    symbolCustomizationMap.set(returnedSymbol, this.quoteUtils.buildSymbolCustomization(returnedSymbol, new Map()));
                }

                // based on the custom settings, and the returned information, determine the name and store it directly in the quote
                this.quoteUtils.populateQuoteDisplayName(quote, symbolCustomizationMap.get(returnedSymbol), this.useLongQuoteName);
            }

            // (optional) sorting (do after we populated the display name within the quotes)
            const sortedResponseResult = this.quoteUtils.sortQuotesByProperty(responseResult, this.sortCriteria, this.sortAscending ? 1 : -1);

            // gather all settings that influence the rendering
            const displaySettings = this.getQuoteDisplaySettings(sortedResponseResult);

            const table = new QuotesTable(this.id);
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

    on_desklet_removed() {
        this.quoteUtils.logDebug(`on_desklet_removed - updateId: ${this.updateId}`);
        this.removeUpdateTimer(true);
        this.unrender();
    },

    unrender() {
        this.quoteUtils.logDebug("unrender");
        if (this.mainBox) {
            this.mainBox.destroy_all_children();
            this.mainBox.destroy();
        }
    }
}

function main(metadata, deskletId) {
    if (LOG_DEBUG) {
        global.log(`${UUID}[${deskletId}] DEBUG main()`);
    }
    return new StockQuoteDesklet(metadata, deskletId);
}
