const GLib = imports.gi.GLib;
const Soup = imports.gi.Soup;
const ByteArray = imports.byteArray;

const _cookieJar = new Soup.CookieJar();
const _httpSession = 2 === Soup.MAJOR_VERSION ? new Soup.SessionAsync() : new Soup.Session();

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

  httpRequest(method, url, body = null) {
    return new Promise((resolve, reject) => {
      try {
        const message = Soup.Message.new(method, url);

        if (!message) {
          throw new Error(`Failed to create message for URL: ${url}`);
        }

        // User agent
        message.request_headers.append(
          'User-Agent',
          'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'
        );

        // Add body for POST requests
        if ('POST' === method && body) {
          if (2 === Soup.MAJOR_VERSION) {
            message.set_request('application/json', 2, body);
          } else {
            message.set_request_body_from_bytes(
              'application/json',
              new GLib.Bytes(body)
            );
          }
        }

        // Timeout after 30 seconds
        let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30000, () => {
          reject(new Error('HTTP request timed out'));

          return;
        });

        const clearTimeout = () => {
          if (timeoutId) {
            try { GLib.source_remove(timeoutId); } catch (e) { }

            timeoutId = 0;
          }
        };

        // Handle Soup v2 vs v3
        if (2 === Soup.MAJOR_VERSION) {
          this.httpSession.queue_message(message, (session, response) => {
            clearTimeout();

            if (response.status_code !== 200) {
              reject(new Error(`HTTP ${response.status_code}: ${response.reason_phrase}`));

              return;
            }

            resolve(message.response_body.data);
          });
        } else {
          this.httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null,
            (session, result) => {
              try {
                const bytes = session.send_and_read_finish(result);

                clearTimeout();

                if (!bytes) {
                  reject(new Error('No response data'));

                  return;
                }

                resolve(ByteArray.toString(bytes.get_data()));
              } catch (error) {
                clearTimeout();
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

    // User agent
    message.request_headers.append(
      'User-Agent',
      this._USER_AGENTS[Math.floor(Math.random() * this._USER_AGENTS.length)]
    );

    if (2 === Soup.MAJOR_VERSION) {
      _httpSession.send_message(message);

      if (message.status_code === Soup.KnownStatusCode.OK) {
        return message.response_body.data.toString();
      } else if (401 === message.status_code) {
        throw new Error('Unauthorized 401');
      } else if (404 === message.status_code) {
        throw new Error('Not Found 404');
      }

      throw new Error(`Failed with code ${message.status_code} for URL: ${url}`);
    }

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
