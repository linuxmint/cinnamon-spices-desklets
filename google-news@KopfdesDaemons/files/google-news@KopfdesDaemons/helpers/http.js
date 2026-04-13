const Soup = imports.gi.Soup;
const ByteArray = imports.byteArray;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

var HttpHelper = class {
  _httpSession;

  constructor() {
    if (Soup.MAJOR_VERSION == 2) {
      this._httpSession = new Soup.SessionAsync();
    } else {
      //version 3
      this._httpSession = new Soup.Session();
    }
  }

  downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const message = Soup.Message.new("GET", url);
      if (!message) {
        resolve(false);
        return;
      }

      if (Soup.MAJOR_VERSION === 2) {
        this._httpSession.queue_message(message, (session, msg) => {
          if (msg.status_code !== Soup.KnownStatusCode.OK) {
            resolve(false);
            return;
          }
          try {
            const data = msg.response_body.data;
            const file = Gio.File.new_for_path(destPath);
            const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
            stream.write(data, null);
            stream.close(null);
            resolve(true);
          } catch (e) {
            resolve(false);
          }
        });
      } else {
        this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
          try {
            const bytes = this._httpSession.send_and_read_finish(result);
            if (message.get_status() !== Soup.Status.OK) {
              resolve(false);
              return;
            }
            const file = Gio.File.new_for_path(destPath);
            const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
            stream.write_bytes(bytes, null);
            stream.close(null);
            resolve(true);
          } catch (e) {
            resolve(false);
          }
        });
      }
    });
  }

  fetchText(url) {
    return new Promise((resolve, reject) => {
      const message = Soup.Message.new("GET", url);
      if (!message) {
        resolve("Invalid URL");
        return;
      }

      if (Soup.MAJOR_VERSION === 2) {
        this._httpSession.queue_message(message, (session, msg) => {
          if (msg.status_code !== Soup.KnownStatusCode.OK) {
            const body = msg.response_body.data ? msg.response_body.data.toString() : "";
            resolve(`HTTP ${msg.status_code} ${msg.reason_phrase} BODY: ${body}`);
            return;
          }
          try {
            const body = msg.response_body.data.toString();
            resolve(body);
          } catch (e) {
            resolve(`Error fetching ${url}: ${e}`);
          }
        });
      } else {
        this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
          try {
            const bytes = this._httpSession.send_and_read_finish(result);
            if (message.get_status() !== Soup.Status.OK) {
              const body = bytes ? ByteArray.toString(bytes.get_data()) : "";
              resolve(`HTTP ${message.get_status()} ${message.reason_phrase} BODY: ${body}`);
              return;
            }
            const body = ByteArray.toString(bytes.get_data());
            resolve(body);
          } catch (e) {
            resolve(`Error fetching ${url}: ${e}`);
          }
        });
      }
    });
  }
};
