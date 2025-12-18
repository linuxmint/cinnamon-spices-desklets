const GLib = imports.gi.GLib;
const Soup = imports.gi.Soup;
const ByteArray = imports.byteArray;

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

        if (2 === Soup.MAJOR_VERSION) {
          message.request_headers.append(
            'User-Agent',
            this._USER_AGENTS[Math.floor(Math.random() * this._USER_AGENTS.length)]
          );
          message.request_headers.append("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
          message.request_headers.append("Accept-Encoding", "gzip, deflate");
        } else {
          message.get_request_headers().append(
            'User-Agent',
            this._USER_AGENTS[Math.floor(Math.random() * this._USER_AGENTS.length)]
          );
          message.get_request_headers().append("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
          message.get_request_headers().append("Accept-Encoding", "gzip, deflate");
        }

        // Handle Soup v2 vs v3
        if (2 === Soup.MAJOR_VERSION) {
          global.log('--- About to send v2 to ' + url);
          _httpSession.queue_message(message, (session, response) => {
            if (response.status_code !== 200) {
              global.log('-- Error in v2 queue_message.');
              global.log('Error in v2 queue_message: ' + response.reason_phrase);
              reject(new Error(`HTTP ${response.status_code}: ${response.reason_phrase}`));

              return;
            }

            global.log('--- v2 response status: ' + response.status_code);

            resolve(message.response_body.data);
          });
        } else {
          global.log('--- About to send v3 to ' + url);
          _httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null,
            (session, result) => {
              try {
                const bytes = session.send_and_read_finish(result);

                global.log('--- v3 response status: ' + message.get_status());

                if (!bytes) {
                  reject(new Error('No response data'));

                  return;
                }

                global.log('--- will resolve!');
                const responseData = ByteArray.toString(bytes.get_data());

                global.log('--- will resolve: ' + responseData.length + ' bytes');
                global.log('--- v3 resolving data!');
                resolve(responseData);
              } catch (error) {
                global.log('-- Error in v3 send_and_read_async.');
                global.log('Error in v3 send_and_read_async: ' + error.message);
                reject(error);
              }
            });
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  getJSON(url) {
    const message = Soup.Message.new('GET', url);

    // User agent
    message.request_headers.append(
      'User-Agent',
      this._USER_AGENTS[Math.floor(Math.random() * this._USER_AGENTS.length)]
    );

    if (2 === Soup.MAJOR_VERSION) {
      _httpSession.send_message(message);

      if (message.status_code === Soup.KnownStatusCode.OK) {
        return JSON.parse(message.response_body.data.toString());
      } else if (401 === message.status_code) {
        throw new Error('Unauthorized 401');
      } else if (404 === message.status_code) {
        throw new Error('Not Found 404');
      }

      throw new Error(`Failed with code ${message.status_code} for URL: ${url}`);
    }

    const bytes = _httpSession.send_and_read(message, null);

    if (message.get_status() === Soup.Status.OK) {
      return JSON.parse(ByteArray.toString(bytes.get_data()));
    } else if (401 === message.get_status()) {
      throw new Error('Unauthorized 401');
    } else if (404 === message.get_status()) {
      throw new Error('Not Found 404');
    }

    throw new Error(`Failed with code ${message.get_status()} for URL: ${url}`);
  }

  get(url) {
    const message = Soup.Message.new('GET', url);

    if (2 === Soup.MAJOR_VERSION) {
      _httpSession.send_message(message);

      message.request_headers.append('Accept', '*/*');
      message.request_headers.append('Accept-Encoding', 'gzip, deflate');

      // User agent
      message.request_headers.append(
        'User-Agent',
        this._USER_AGENTS[Math.floor(Math.random() * this._USER_AGENTS.length)]
      );

      if (message.status_code === Soup.KnownStatusCode.OK) {
        return message.response_body.data.toString();
      } else if (401 === message.status_code) {
        throw new Error('Unauthorized 401');
      } else if (404 === message.status_code) {
        throw new Error('Not Found 404');
      }

      throw new Error(`Failed with code ${message.status_code} for URL: ${url}`);
    }

    message.get_request_headers().append('Accept', '*/*');
    message.get_request_headers().append('Accept-Encoding', 'gzip, deflate');

    // User agent
    message.get_request_headers().append(
      'User-Agent',
      this._USER_AGENTS[Math.floor(Math.random() * this._USER_AGENTS.length)]
    );

    const bytes = _httpSession.send_and_read(message, null);

    if (message.get_status() === Soup.Status.OK) {
      return ByteArray.toString(bytes.get_data());
    } else if (401 === message.get_status()) {
      throw new Error('Unauthorized 401');
    } else if (404 === message.get_status()) {
      throw new Error('Not Found 404');
    }

    throw new Error(`Failed with code ${message.get_status()} for URL: ${url}`);
  }
}

// Export
var HttpClient = HttpClientDeclaration;
