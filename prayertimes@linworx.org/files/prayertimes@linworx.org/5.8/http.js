const Soup = imports.gi.Soup;
const ByteArray = imports.byteArray;

class HTTPClient {

  constructor() {
    if (Soup.MAJOR_VERSION === 2) {
      this._httpSession = new Soup.SessionAsync();
      Soup.Session.prototype.add_feature.call(this._httpSession, new Soup.ProxyResolverDefault());
    } else {
      this._httpSession = new Soup.Session();
    }

    this._httpSession.timeout = 5;
  }

  async Get(url) {

    return new Promise((resolve, reject) => {
      let message = Soup.Message.new("GET", url);
      if (Soup.MAJOR_VERSION === 2) {
        return this._httpSession.queue_message(message, (session, message) => {
          if (message.status_code !== 200) {
            reject(`Response code: ${message.status_code}`);
          }
          try {
            resolve(message.response_body.data.toString())
          } catch (e) {
            reject(e.message);
          }
        })
      } else {
        return this._httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, (session, result) => {
          if (message.get_status() !== 200) {
            reject(`Response code: ${message.get_status()}`);
          }
          try {
            const bytes = this._httpSession.send_and_read_finish(result);
            resolve(ByteArray.toString(bytes.get_data()));
          } catch (e) {
            reject(e.message);
          }
        })
      }
    })
  }
}

var Client = HTTPClient;