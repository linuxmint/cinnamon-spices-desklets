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
        reject(new Error("Invalid URL"));
        return;
      }

      if (Soup.MAJOR_VERSION === 2) {
        this._httpSession.queue_message(message, (session, msg) => {
          if (msg.status_code !== Soup.KnownStatusCode.OK) {
            reject(new Error(`Error fetching ${url}`));
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
            reject(new Error(`Error fetching ${url}: ${e}`));
          }
        });
      } else {
        this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
          try {
            const bytes = this._httpSession.send_and_read_finish(result);
            if (message.get_status() !== Soup.Status.OK) {
              reject(new Error(`Error fetching ${url}`));
              return;
            }
            const file = Gio.File.new_for_path(destPath);
            const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
            stream.write_bytes(bytes, null);
            stream.close(null);
            resolve(true);
          } catch (e) {
            reject(new Error(`Error fetching ${url}: ${e}`));
          }
        });
      }
    });
  }

  fetchText(url) {
    return new Promise((resolve, reject) => {
      const message = Soup.Message.new("GET", url);
      if (!message) {
        reject(new Error("Invalid URL"));
        return;
      }

      if (Soup.MAJOR_VERSION === 2) {
        this._httpSession.queue_message(message, (session, msg) => {
          if (msg.status_code !== Soup.KnownStatusCode.OK) {
            const body = msg.response_body.data ? msg.response_body.data.toString() : "";
            reject(new Error(`HTTP ${msg.status_code} ${msg.reason_phrase} BODY: ${body}`));
            return;
          }
          try {
            const body = msg.response_body.data.toString();
            resolve(body);
          } catch (e) {
            reject(new Error(`Error fetching ${url}: ${e}`));
          }
        });
      } else {
        this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
          try {
            const bytes = this._httpSession.send_and_read_finish(result);
            if (message.get_status() !== Soup.Status.OK) {
              const body = bytes ? ByteArray.toString(bytes.get_data()) : "";
              reject(new Error(`HTTP ${message.get_status()} ${message.reason_phrase} BODY: ${body}`));
              return;
            }
            const body = ByteArray.toString(bytes.get_data());
            resolve(body);
          } catch (e) {
            reject(new Error(`Error fetching ${url}: ${e}`));
          }
        });
      }
    });
  }
};
