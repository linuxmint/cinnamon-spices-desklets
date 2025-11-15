/**
 * Yahoo Finance Quotes: Quote Reader
 */

const Soup = imports.gi.Soup;
const Util = imports.misc.util;

const C = require('./constants');
const Utilities = require("./utilities");
const SoupResolver = require("./soup-resolver");

function CurlMessage(response) {
    this.init(response);
}

// mimics libsoup's SoupMessage
CurlMessage.prototype = {
    init: function(response) {
        const responseParts = response.split(C.CURL_RESPONSE_CODE_PREFIX);
        this.response_body = responseParts[0];
        this.status_code = Number(responseParts[1]);
        this.reason_phrase = this.determineReasonPhrase(this.status_code);
    },

    determineReasonPhrase: function(statusCode) {
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

    get_reason_phrase: function() {
        return this.reason_phrase;
    },

    get_status: function() {
        return this.status_code;
    }
}

function QuoteReader(metadata, deskletId, logger) {
    this.init(metadata, deskletId, logger);
}

QuoteReader.prototype = {
    init: function(metadata, deskletId, logger) {
        this.id = deskletId;
        this.soap = new SoupResolver(logger);
        this.quoteUtils = new Utilities(logger);
        this.logger = logger;

        let httpSession = this.soap.getHttpSession();
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

    getAuthorizationParametersToCache: function() {
        let authParamsToCache = C.DEFAULT_CACHED_AUTH_PARAMS;
        if (this.existsCookieInJar(C.AUTH_COOKIE) && this.hasCrumb()) {
            const authCookie = this.getCookieFromJar(C.AUTH_COOKIE);
            const expiresDateTime = this.soap.getCookieExpires(authCookie);
            try {
                authParamsToCache = JSON.stringify({
                    version: C.CACHED_AUTH_PARAMS_VERSION,
                    cookie: {
                        name: this.soap.getCookieName(authCookie),
                        value: this.soap.getCookieValue(authCookie),
                        domain: this.soap.getCookieDomain(authCookie),
                        path: this.soap.getCookiePath(authCookie),
                        expires: expiresDateTime ? this.soap.getDateTime(expiresDateTime) : -1
                    },
                    crumb: {
                        value: this.getCrumb()
                    }
                });
            } catch (e) {
                this.logger.error("Failed to stringify authorization parameters to cache: " + e);
            }
        }

        return authParamsToCache;
    },

    restoreCachedAuthorizationParameters: function(authParamsJson) {
        let cachedAuthParams;
        try {
            this.logger.debug("Loading cached authorization parameters: " + authParamsJson);
            cachedAuthParams = JSON.parse(authParamsJson);
        } catch (e) {
            this.logger.error("Cached authorization parameters [" + authParamsJson + "] is not valid JSON: " + e);
            cachedAuthParams = JSON.parse(C.DEFAULT_CACHED_AUTH_PARAMS);
        }

        if (this.hasCachedAuthorizationParameters(cachedAuthParams)) {
            this.setCookie(cachedAuthParams.cookie.value);
            this.addCookieToJar(cachedAuthParams.cookie);
            this.setCrumb(cachedAuthParams.crumb.value);

            this.logger.debug("Restored cached authorization parameters");
        } else {
            // either no params cached, or version mismatch
            this.logger.debug("No cached authorization parameters restored");
        }
    },

    hasCachedAuthorizationParameters: function(cachedAuthParams) {
        return cachedAuthParams != null
            && this.quoteUtils.existsProperty(cachedAuthParams, "version")
            && cachedAuthParams.version === C.CACHED_AUTH_PARAMS_VERSION
            && this.quoteUtils.existsProperty(cachedAuthParams, "cookie")
            && this.quoteUtils.existsProperty(cachedAuthParams.cookie, "name")
            && this.quoteUtils.existsProperty(cachedAuthParams.cookie, "value")
            && this.quoteUtils.existsProperty(cachedAuthParams.cookie, "domain")
            && this.quoteUtils.existsProperty(cachedAuthParams.cookie, "path")
            && this.quoteUtils.existsProperty(cachedAuthParams.cookie, "expires")
            && this.quoteUtils.existsProperty(cachedAuthParams, "crumb")
            && this.quoteUtils.existsProperty(cachedAuthParams.crumb, "value");
    },

    setCrumb: function(crumb) {
        this.authParams.crumb = crumb;
    },

    hasCrumb: function() {
        return this.authParams.crumb !== null;
    },

    getCrumb: function() {
        return this.authParams.crumb;
    },

    setCookie: function(authCookieValue) {
        this.authParams.cookie = C.AUTH_COOKIE + "=" + authCookieValue;
    },

    getCookieFromJar: function(name) {
        for (let cookie of this.cookieJar.all_cookies()) {
            let cookieName = this.soap.getCookieName(cookie);
            if (cookieName === name) {
                const cookieValue = this.soap.getCookieValue(cookie);
                this.logger.debug("Cookie " + name + " found in jar, value: " + cookieValue);
                return cookie;
            }
        }

        this.logger.debug("No cookie found with name " + name);
        return null;
    },

    existsCookieInJar: function(name) {
        return (this.getCookieFromJar(name) !== null);
    },

    addCookieToJar: function(cookieParams) {
        const cookie = new Soup.Cookie(cookieParams.name, cookieParams.value, cookieParams.domain, cookieParams.path, -1);
        if (cookieParams.expires > 0) {
            cookie.set_expires(this.soap.createDateTime(cookieParams.expires));
        }
        this.cookieJar.add_cookie(cookie);
        this.logger.debug("Added cookie to jar: " + Object.entries(cookieParams));
    },

    deleteAllCookies: function() {
        this.logger.debug("deleteAllCookies")
        for (let cookie of this.cookieJar.all_cookies()) {
            const cookieName = this.soap.getCookieName(cookie);
            this.cookieJar.delete_cookie(cookie);
            this.logger.debug("Cookie deleted from jar: " + cookieName);
        }
        this.logger.debug("All cookies deleted from jar");
    },

    dropAuthParams: function() {
        this.deleteAllCookies();
        this.authParams.cookie = null;
        this.authParams.crumb = null;
    },

    retrieveCookie: function(networkSettings, callback) {
        this.logger.debug("retrieveCookie");
        const message = this.soap.getMessageWithHeaders(
            Soup.Message.new("GET", C.YF_COOKIE_URL), [
                {key: C.ACCEPT_HEADER, value: C.ACCEPT_VALUE_COOKIE},
                {key: C.ACCEPT_ENCODING_HEADER, value: C.ACCEPT_ENCODING_VALUE},
                {key: C.USER_AGENT_HEADER, value: networkSettings.customUserAgent}
            ]);
        this.soap.retrieveCookie(this.httpSession, message, callback);
    },

    postConsent: function(networkSettings, formData, callback) {
        this.logger.debug("postConsent");
        const message = this.soap.getMessageWithHeaders(
            Soup.Message.new("POST", C.YF_CONSENT_URL), [
                {key: C.ACCEPT_HEADER, value: C.ACCEPT_VALUE_COOKIE},
                {key: C.ACCEPT_ENCODING_HEADER, value: C.ACCEPT_ENCODING_VALUE},
                {key: C.USER_AGENT_HEADER, value: networkSettings.customUserAgent}
            ], [{key: C.FORM_URLENCODED_VALUE, value:formData}]);
        this.soap.postConsent(this.httpSession, message, callback);
    },

    retrieveCrumb: function(networkSettings, callback) {
        this.logger.debug("retrieveCrumb");
        const _that = this;
        const customUserAgent = networkSettings.customUserAgent;

        if (networkSettings.enableCurl) {
            this.logger.debug("Use curl for retrieveCrumb");

            const authCookie = this.getCookieFromJar(C.AUTH_COOKIE);

            if (authCookie) {
                // keep authorization cookie
                const authCookieValue = this.soap.getCookieValue(authCookie);
                this.setCookie(authCookieValue);

                const curlArgs = [
                    networkSettings.curlCommand,
                    C.CURL_SILENT_LOCATION_OPTIONS,
                    C.CURL_WRITE_OUT_OPTION, C.CURL_WRITE_OUT_VALUE,
                    C.CURL_CIPHERS_OPTION, C.CURL_CIPHERS_VALUE,
                    C.CURL_HEADER_OPTION, C.CURL_COOKIE_HEADER_NAME + this.authParams.cookie
                ];
                if (customUserAgent) {
                    curlArgs.push(C.CURL_HEADER_OPTION, C.CURL_USER_AGENT_HEADER_NAME + customUserAgent);
                }
                curlArgs.push(C.YF_CRUMB_URL);

                this.logger.debug("Curl retrieveCrumb arguments: " + curlArgs);
                try {
                    Util.spawn_async(curlArgs, function(response) {
                        _that.logger.debug("Curl retrieveCrumb response: " + response);
                        const curlMessage = new CurlMessage(response);
                        if (_that.soap.isOkStatus(curlMessage)) {
                            try {
                                callback.call(_that, curlMessage, curlMessage.response_body);
                            } catch (e) {
                                _that.logger.error(e);
                            }
                        } else {
                            _that.logger.warning("Curl Error retrieving crumb! Status: " + _that.soap.getMessageStatusInfo(curlMessage));
                            callback.call(_that, curlMessage, null);
                        }
                    });
                } catch (e) {
                    this.logger.warning("caught exception on curl execution! " + e);
                    callback.call(_that, null, null);
                }
            } else {
                this.logger.warning("No auth cookie in Jar! Unable to retrieve crumb.");
                callback.call(_that, null, null);
            }
        } else {
            this.logger.debug("Use libsoup for retrieveCrumb");
            const message = this.soap.getMessageWithHeaders(
                Soup.Message.new("GET", C.YF_CRUMB_URL), [
                    {key: C.ACCEPT_HEADER, value: C.ACCEPT_VALUE_CRUMB},
                    {key: C.ACCEPT_ENCODING_HEADER, value: C.ACCEPT_ENCODING_VALUE},
                    {key: C.USER_AGENT_HEADER, value: C.customUserAgent}
                ]);
            this.soap.retrieveCrumb(this.httpSession, message, callback);
        }
    },

    retrieveFinanceData: function(quoteSymbolsArg, networkSettings, callback) {
        this.logger.debug("retrieveFinanceData");
        const _that = this;

        if (quoteSymbolsArg.length === 0) {
            callback.call(_that, _that.buildErrorResponse(_("Empty quotes list. Open settings and add some symbols.")));
            return;
        }

        const requestUrl = this.createYahooQueryUrl(quoteSymbolsArg, this.authParams.crumb);
        const customUserAgent = networkSettings.customUserAgent;

        if (networkSettings.enableCurl) {
            this.logger.debug("Use curl for retrieveFinanceData");

            const curlArgs = [networkSettings.curlCommand,
                C.CURL_SILENT_LOCATION_OPTIONS,
                C.CURL_WRITE_OUT_OPTION, C.CURL_WRITE_OUT_VALUE,
                C.CURL_CIPHERS_OPTION, C.CURL_CIPHERS_VALUE,
                C.CURL_HEADER_OPTION, C.CURL_COOKIE_HEADER_NAME + this.authParams.cookie,
            ]
            if (customUserAgent) {
                curlArgs.push(C.CURL_HEADER_OPTION, C.CURL_USER_AGENT_HEADER_NAME + customUserAgent);
            }
            curlArgs.push(requestUrl);

            this.logger.debug("Curl retrieveFinanceData arguments: " + curlArgs);
            Util.spawn_async(curlArgs, function(response) {
                _that.logger.debug("Curl retrieveFinanceData response: " + response);
                const curlMessage = new CurlMessage(response);
                if (_that.soap.isOkStatus(curlMessage)) {
                    try {
                        callback.call(_that, curlMessage.response_body);
                    } catch (e) {
                        _that.logger.error(e);
                    }
                } else if (_that.soap.isUnauthorizedStatus(curlMessage)) {
                    _that.logger.debug("Curl Current authorization parameters have expired. Discarding them.");
                    _that.dropAuthParams();
                    callback.call(_that, _that.buildErrorResponse(_("Authorization parameters have expired")), true, true);
                } else {
                    _that.logger.warning("Curl Error retrieving url " + requestUrl + ". Status: " + _that.soap.getMessageStatusInfo(curlMessage));
                    callback.call(_that, _that.buildErrorResponse(_("Yahoo Finance service not available! Status: ") + _that.soap.getMessageStatusInfo(curlMessage)));
                }
            });
        } else {
            this.logger.debug("Use libsoup for retrieveFinanceData");
            const message = this.soap.getMessageWithHeaders(
                Soup.Message.new("GET", requestUrl), [
                    {key: C.USER_AGENT_HEADER, value: customUserAgent}
                ]);
            this.soap.retrieveFinanceData(_that, this.httpSession, message, callback);
        }
    },

    createYahooQueryUrl: function(quoteSymbolsArg, crumb) {
        const queryUrl = "https://query1.finance.yahoo.com/v7/finance/quote?fields=currency,longName,regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketTime,shortName,symbol&lang=en-US&region=US&formatted=false&symbols=" + quoteSymbolsArg + "&crumb=" + crumb;
        this.logger.debug("YF query URL: " + queryUrl);
        return queryUrl;
    },

    buildErrorResponse: function(errorMsg) {
        return C.ERROR_RESPONSE_BEGIN + errorMsg + C.ERROR_RESPONSE_END;
    }
}

module.exports = QuoteReader;
