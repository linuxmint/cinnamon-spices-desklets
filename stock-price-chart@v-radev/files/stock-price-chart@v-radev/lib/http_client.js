const GLib = imports.gi.GLib;
const Soup = imports.gi.Soup;
const ByteArray = imports.byteArray;

const UUID = 'stock-price-chart@v-radev';
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

imports.searchPath.unshift(`${DESKLET_DIR}/lib`);
const LoggerModule = imports['logger'];
const logger = new LoggerModule.LoggerClass();

const _httpSession = 2 === Soup.MAJOR_VERSION ? new Soup.SessionAsync() : new Soup.Session();
const _cookieJar = new Soup.CookieJar();

if (undefined === Soup.MAJOR_VERSION || 2 === Soup.MAJOR_VERSION) {
  Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());
  Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ContentDecoder());
}

_httpSession.timeout = 60;
_httpSession.idle_timeout = 60;
_httpSession.user_agent = 'Mozilla/5.0 YarrDesklet/1.0';

Soup.Session.prototype.add_feature.call(_httpSession, _cookieJar);

class HttpClientDeclaration {
  constructor() {
  }

  _USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:135.0) Gecko/20100101 Firefox/135.0",
    "Mozilla/5.0 (X11; Linux i686; rv:135.0) Gecko/20100101 Firefox/135.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/131.0.2903.86",
  ];

  request(method, url, body = null) {
    return new Promise((resolve, reject) => {
      try {
        const message = Soup.Message.new(method, url);

        if (!message) {
          throw new Error(`Failed to create message for URL: ${url}`);
        }

        // Headers
        if (2 === Soup.MAJOR_VERSION) {
          message.request_headers.append(
            'User-Agent',
            this._USER_AGENTS[Math.floor(Math.random() * this._USER_AGENTS.length)]
          );
          message.request_headers.append('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
          message.request_headers.append('Accept-Encoding', 'gzip, deflate');
        } else {
          message.get_request_headers().append(
            'User-Agent',
            this._USER_AGENTS[Math.floor(Math.random() * this._USER_AGENTS.length)]
          );
          message.get_request_headers().append('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
          message.get_request_headers().append('Accept-Encoding', 'gzip, deflate');
        }

        // Request
        if (2 === Soup.MAJOR_VERSION) {
          logger.log(`--- Sending v2 HTTP ${method} request to ${url}.`);

          _httpSession.queue_message(message, (session, response) => {

            logger.log('--- HTTP v2 response status: ' + response.status_code());

            reject(new Error(`HTTP ${response.status_code}: ${response.reason_phrase}`));

            const bytes = message.response_body.data;

            if (!bytes) {
              logger.log('No response data from v2 HTTP request.');

              resolve('');
            }

            resolve(bytes);
          });
        } else {
          logger.log(`--- Sending v3 HTTP ${method} request to ${url}.`);

          _httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null,
            (session, result) => {
              try {
                const bytes = session.send_and_read_finish(result);

                logger.log('--- HTTP v3 response status: ' + message.get_status());

                if (!bytes) {
                  logger.log('No response data from v3 HTTP request.');

                  resolve('');
                }

                const responseData = ByteArray.toString(bytes.get_data());

                resolve(responseData);
              } catch (error) {
                logger.log('Error in v3 HTTP send_and_read_async: ' + error.message);

                reject(error);
              }
            });
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  async getJSON(url) {
    const data = await this.request('GET', url)

    return JSON.parse(data);
  }
}

// Export
var HttpClient = HttpClientDeclaration;
