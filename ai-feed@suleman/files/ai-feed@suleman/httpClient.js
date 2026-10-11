// HTTP Client -- libsoup2 wrapper for AIFeed
// Single Soup.SessionAsync instance, reused for all requests
// Configurable User-Agent and timeout

imports.gi.versions.Soup = '2.4';
const Soup = imports.gi.Soup;

var HttpClient = class HttpClient {
    constructor(userAgent, timeout) {
        this._session = new Soup.SessionAsync();
        this._session.user_agent = userAgent || 'linux:ai-feed-desklet:1.0 (by /u/cinnamon-user)';
        this._session.timeout = timeout || 15;
    }

    get(url, headers, callback) {
        let message = Soup.Message.new('GET', url);
        if (!message) {
            callback(new Error('Invalid URL: ' + url), 0, null);
            return;
        }
        if (headers) {
            for (let key in headers) {
                message.request_headers.append(key, headers[key]);
            }
        }
        this._session.queue_message(message, (session, msg) => {
            try {
                if (msg.status_code < 200 || msg.status_code >= 300) {
                    callback(new Error('HTTP ' + msg.status_code), msg.status_code, null);
                    return;
                }
                let body = msg.response_body ? msg.response_body.data : null;
                callback(null, msg.status_code, body);
            } catch (e) {
                callback(e, 0, null);
            }
        });
    }

    getJson(url, headers, callback) {
        this.get(url, headers, (error, status, body) => {
            if (error) {
                callback(error, status, null);
                return;
            }
            try {
                let parsed = JSON.parse(body);
                callback(null, status, parsed);
            } catch (e) {
                callback(new Error('JSON parse error: ' + e.message), status, null);
            }
        });
    }

    destroy() {
        this._session = null;
    }
};
