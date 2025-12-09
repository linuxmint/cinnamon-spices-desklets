/**
 * Yahoo Finance Quotes: Soup Resolver
 */

const Soup = imports.gi.Soup;
const GLib = imports.gi.GLib;
const ByteArray = imports.byteArray;

const IS_SOUP_2 = Soup.MAJOR_VERSION === 2;

function SoupResolver(logger) {
    this.init(logger);
}

SoupResolver.prototype = {
    init: function(logger) {
        this.logger = logger;
        this.logger.debug("libsoup version " + Soup.MAJOR_VERSION + "." + Soup.MINOR_VERSION + "." + Soup.MICRO_VERSION);
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

    isUnauthorizedStatus: function(soupMessage) {
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
                    this.logger.debug("get_status() exception: " + e);
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

    getHttpSession: function() {
        let httpSession;
        if (IS_SOUP_2) {
            httpSession = new Soup.SessionAsync();
            Soup.Session.prototype.add_feature.call(httpSession, new Soup.ProxyResolverDefault());
            Soup.Session.prototype.add_feature.call(httpSession, new Soup.ContentDecoder());
        } else { // assume version 3
            httpSession = new Soup.Session();
        }
        return httpSession;
    },

    getCookieExpires: function(cookie) {
        return IS_SOUP_2 ? cookie.expires : cookie.get_expires();
    },

    getCookieName: function(cookie) {
        return IS_SOUP_2 ? cookie.name : cookie.get_name();
    },

    getCookieValue: function(cookie) {
        return IS_SOUP_2 ? cookie.value : cookie.get_value();
    },

    getCookieDomain: function(cookie) {
        return IS_SOUP_2 ? cookie.domain : cookie.get_domain();
    },

    getCookiePath: function(cookie) {
        return IS_SOUP_2 ? cookie.path : cookie.get_path();
    },

    getDateTime: function(value) {
        return IS_SOUP_2 ? value.to_time_t() : value.to_unix();
    },

    createDateTime: function(value) {
        return IS_SOUP_2 ? Soup.Date.new_from_time_t(value) : GLib.DateTime.new_from_unix_utc(value);
    },

    getMessageWithHeaders: function(message, headers, formData = null) {
        if (IS_SOUP_2) {
            for (let header of headers) {
                if (header.value != null) {
                    message.request_headers.append(header.key, header.value);
                }
            }
            if (formData != null) {
                message.set_request(formData.key, Soup.MemoryUse.COPY, formData.value);
            }
        } else {
            for (let header of headers) {
                if (header.value != null) {
                    message.get_request_headers.append(header.key, header.value);
                }
            }
            if (formData != null) {
                message.set_request_body_from_bytes(formData.key, GLib.Bytes.new(formData.value));
            }
        }
        return message
    },

    retrieveCookie: function(httpSession, message, callback) {
        const _that = this;
        if (IS_SOUP_2) {
            httpSession.queue_message(message, function(session, message) {
                _that.logger.debug("Soup2 Cookie response status: " + _that.getMessageStatusInfo(message));
                if (_that.isOkStatus(message)) {
                    try {
                        callback.call(_that, message, message.response_body.data);
                    } catch (e) {
                        _that.logger.error(e);
                    }
                } else {
                    _that.logger.warning("Error retrieving auth page! Status: " + _that.getMessageStatusInfo(message));
                    callback.call(_that, message, null);
                }
            });
        } else {
            httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, function(session, result) {
                _that.logger.debug("Soup3 Cookie response status: " + _that.getMessageStatusInfo(message));
                if (_that.isOkStatus(message)) {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        callback.call(_that, message, ByteArray.toString(bytes.get_data()));
                    } catch (e) {
                        _that.logger.error(e);
                    }
                } else {
                    _that.logger.warning("Error retrieving auth page! Status: " + _that.getMessageStatusInfo(message));
                    callback.call(_that, message, null);
                }
            });
        }
    },

    postConsent: function(httpSession, message, callback) {
        const _that = this;
        if (IS_SOUP_2) {
            httpSession.queue_message(message, function(session, message) {
                _that.logger.debug("Soup2 Consent response status: " + _that.getMessageStatusInfo(message));
                if (_that.isOkStatus(message)) {
                    try {
                        callback.call(_that, message);
                    } catch (e) {
                        _that.logger.error(e);
                    }
                } else {
                    _that.logger.warning("Error sending consent! Status: " + _that.getMessageStatusInfo(message));
                    callback.call(_that, message);
                }
            });
        } else {
            httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, function(session, result) {
                _that.logger.debug("Soup3 Consent response status: " + _that.getMessageStatusInfo(message));
                if (_that.isOkStatus(message)) {
                    try {
                        callback.call(_that, message);
                    } catch (e) {
                        _that.logger.error(e);
                    }
                } else {
                    _that.logger.warning("Error sending consent! Status: " + _that.getMessageStatusInfo(message));
                    callback.call(_that, message);
                }
            });
        }
    },

    retrieveCrumb: function (httpSession, message, callback) {
        const _that = this;
        if (IS_SOUP_2) {
            httpSession.queue_message(message, function(session, message) {
                _that.logger.debug("Soup2 Crumb response status: " + _that.getMessageStatusInfo(message));
                if (_that.isOkStatus(message)) {
                    try {
                        callback.call(_that, message, message.response_body);
                    } catch (e) {
                        _that.logger.error(e);
                    }
                } else {
                    _that.logger.warning("Soup2 Error retrieving crumb! Status: " + _that.getMessageStatusInfo(message));
                    callback.call(_that, message, null);
                }
            });
        } else {
            httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, function(session, result) {
                _that.logger.debug("Soup3 Crumb response status: " + _that.getMessageStatusInfo(message));
                if (_that.isOkStatus(message)) {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        callback.call(_that, message, ByteArray.toString(bytes.get_data()));
                    } catch (e) {
                        _that.logger.error(e);
                    }
                } else {
                    _that.logger.warning("Soup3 Error retrieving crumb! Status: " + _that.getMessageStatusInfo(message));
                    callback.call(_that, message, null);
                }
            });
        }
    },

    retrieveFinanceData: function (parent, httpSession, message, callback) {
        const _that = this;
        if (IS_SOUP_2) {
            httpSession.queue_message(message, function(session, message) {
                _that.logger.debug("Soup2 Quotes response status: " + _that.getMessageStatusInfo(message));
                if (_that.isOkStatus(message)) {
                    try {
                        callback.call(_that, message.response_body.data.toString());
                    } catch (e) {
                        _that.logger.error(e);
                    }
                } else if (_that.isUnauthorizedStatus(message)) {
                    _that.logger.debug("Current authorization parameters have expired. Discarding them.");
                    parent.dropAuthParams();
                    callback.call(_that, parent.buildErrorResponse(_("Authorization parameters have expired")), true, true);
                } else {
                    _that.logger.warning("Error retrieving url " + requestUrl + ". Status: " + _that.getMessageStatusInfo(message));
                    callback.call(_that, parent.buildErrorResponse(_("Yahoo Finance service not available! Status: ") + _that.getMessageStatusInfo(message)));
                }
            });
        } else {
            httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, function(session, result) {
                _that.logger.debug("Soup3 Quotes response status: " + _that.soap.getMessageStatusInfo(message));
                if (_that.isOkStatus(message)) {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        callback.call(_that, ByteArray.toString(bytes.get_data()));
                    } catch (e) {
                        _that.logger.error(e);
                    }
                } else if (_that.isUnauthorizedStatus(message)) {
                    _that.logger.debug("Current authorization parameters have expired. Discarding them.");
                    _that.dropAuthParams();
                    callback.call(_that, parent.buildErrorResponse(_("Authorization parameters have expired")), true, true);
                } else {
                    _that.logger.warning("Error retrieving url " + requestUrl + ". Status: " + _that.getMessageStatusInfo(message));
                    callback.call(_that, parent.buildErrorResponse(_("Yahoo Finance service not available! Status: ") + _that.getMessageStatusInfo(message)));
                }
            });
        }
    }
}

module.exports = SoupResolver;
