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
          resolve(message.response_body.data.toString())
        })
      } else {
        return this._httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, (session, result) => {
          const bytes = this._httpSession.send_and_read_finish(result);
          resolve(ByteArray.toString(bytes.get_data()));
        })
      }
    })
  }
}

var Client = HTTPClient;