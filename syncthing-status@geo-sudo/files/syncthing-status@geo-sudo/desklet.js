const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Soup = imports.gi.Soup;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;

const UUID = "syncthing-status@geo-sudo";
Gettext.bindtextdomain(UUID, imports.gi.GLib.get_home_dir() + imports.gi.GLib.get_user_data_dir());

function _(str) {
  let translation = Gettext.dgettext(UUID, str);
  if (translation !== str) return translation;
  return Gettext.gettext(str);
}

function MyApplet(metadata, desklet_id) {
  this._init(metadata, desklet_id);
}

MyApplet.prototype = {
  __proto__: Desklet.Desklet.prototype,

  _init: function (metadata, desklet_id) {
    Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

    this.settings = new Settings.DeskletSettings(this, metadata.uuid, desklet_id);

    this.settings.bindProperty(Settings.BindingDirection.IN, "baseUrl", "baseUrl", this.on_settings_changed, null);
    this.settings.bindProperty(Settings.BindingDirection.IN, "apiKey", "apiKey", this.on_settings_changed, null);
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "heartbeatInterval",
      "heartbeatInterval",
      this.on_settings_changed,
      null
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "timeoutInterval",
      "timeoutInterval",
      this.on_settings_changed,
      null
    );
    this.settings.bindProperty(Settings.BindingDirection.IN, "darkMode", "darkMode", this._refreshUI, null);
    this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this._refreshUI, null);

    // Tasks: Add Device Integration + Ability to Toggle Folders & Devices
    this._showFolders = true;
    this._showDevices = true;

    this._syncResources = {
      folders: {},
      devices: {},
    };

    this._httpSession = new Soup.Session();

    this._checkIfUp();
    this._setupUI();
  },

  _checkIfUp: function () {
    this._httpGet("/rest/system/ping")
      .then((data) => {
        if (data && data.ping == "pong") {
          this._discoverFolders();
        } else {
          throw new Error("Not pong");
        }
      })
      .catch(() => {
        Mainloop.timeout_add_seconds(this.timeoutInterval, () => this._checkIfUp());
      });
  },

  _discoverFolders: function () {
    this._httpGet("/rest/config/folders")
      .then((data) => {
        data.forEach((folder) => {
          let id = folder.id;

          this._syncResources.folders[id] = {
            label: folder.label || id,
            state: "unknown",
            errors: 0,
            localBytes: 0,
            globalBytes: 0,
            completion: 0,
            paused: folder.paused,
          };
        });

        this._updateFolders();
      })
      .catch((err) => {
        global.logError(`${UUID}: Discovery Error: ${err.message}`);
      });
  },

  _updateFolders: async function () {
    let folderIds = Object.keys(this._syncResources.folders);
    let needsRefresh = false;

    try {
      const requests = folderIds.flatMap((id) => [
        this._httpGet("/rest/db/status?folder=" + id)
          .then((data) => ({ id, type: "status", data }))
          .catch((err) => {
            return { id, type: "status", data: null };
          }),
        this._httpGet("/rest/db/completion?folder=" + id)
          .then((data) => ({ id, type: "completion", data, isPaused: false }))
          .catch((err) => {
            return { id, type: "completion", data: null, isPaused: true };
          }),
      ]);

      const results = await Promise.all(requests);

      results.forEach(({ id, type, data, isPaused }) => {
        let folder = this._syncResources.folders[id];
        if (!folder) return;

        if (type === "status" && data) {
          if (folder.state !== data.state || folder.errors !== data.errors || folder.localBytes !== data.localBytes) {
            needsRefresh = true;

            folder.state = data.state;
            folder.errors = data.errors;
            folder.localBytes = data.localBytes;
            folder.globalBytes = data.globalBytes;
          }
        } else if (type === "completion") {
          if (folder.paused !== isPaused) {
            needsRefresh = true;
            folder.paused = isPaused;
          }

          if (!isPaused && folder.completion !== data.completion) {
            needsRefresh = true;
            folder.completion = data.completion;
          }
        }
      });

      if (needsRefresh) {
        this._refreshUI();
      }
    } catch (err) {
      global.logError(`${UUID}: Update failed: ${err.message}`);
    } finally {
      this._startPoll();
    }
  },

  _httpGet: function (path) {
    return new Promise((resolve, reject) => {
      let url;
      if (path.indexOf("http://") === 0 || path.indexOf("https://") === 0) {
        url = path;
      } else {
        url = this.baseUrl + path;
      }
      let message = Soup.Message.new("GET", url);
      let isPing = path.includes("/system/ping");

      if (!message) {
        return reject(new Error("Failed to create message"));
      }

      if (this.apiKey && this.apiKey.length > 0) {
        message.request_headers.append("X-API-Key", this.apiKey);
      } else if (!isPing) {
        return reject(new Error("No API Key present!"));
      }

      this._httpSession.send_and_read_async(message, 0, null, (session, res) => {
        try {
          let statusCode = message.get_status();
          let bytes = session.send_and_read_finish(res);

          if (statusCode !== 200) {
            return reject(new Error("HTTP " + statusCode + " returned for " + url));
          }

          if (!bytes) {
            return reject(new Error("Empty response body from " + url));
          }

          let body = imports.gi.GLib.Variant.new_from_bytes(imports.gi.GLib.VariantType.new("ay"), bytes, true)
            .get_data_as_bytes()
            .get_data();

          let decoder = new TextDecoder("utf-8");
          let decodedBody = decoder.decode(body);

          resolve(JSON.parse(decodedBody));
        } catch (e) {
          reject(new Error("Error processing response from " + url + ": " + e.message));
        }
      });
    });
  },

  _startPoll: function () {
    this._stopPoll();
    this._updateTimerId = Mainloop.timeout_add_seconds(this.heartbeatInterval, () => this._updateFolders());
  },

  _stopPoll: function () {
    if (this._updateTimerId) {
      Mainloop.source_remove(this._updateTimerId);
      this._updateTimerId = null;
    }
  },

  _setupUI: function () {
    this.window = new St.Bin();

    this.container = new St.BoxLayout({
      vertical: true,
    });

    this._statusLabel = new St.Label({
      text: "Connecting to Syncthing...",
      style: "font-weight: bold;",
    });

    this.container.add_actor(this._statusLabel);
    this.window.set_child(this.container);

    this.setContent(this.window);
  },

  _refreshUI: function () {
    this.container.destroy_all_children();

    const s = this.scaleSize;

    let textColor, cardBg;

    if (this.darkMode) {
      textColor = "rgba(230, 230, 230, 1)";
      cardBg = "rgba(30, 30, 30, 0.85)";
    } else {
      textColor = "rgba(24, 32, 60, 1)";
      cardBg = "rgba(255, 255, 255, 0.85)";
    }

    let card = new St.BoxLayout({
      vertical: true,
      style: `background-color: ${cardBg}; border: ${1 * s}px solid rgba(241, 242, 246, 1); border-radius: ${24 * s}px; padding: ${24 * s}px;`,
    });

    card.add_actor(
      new St.Label({
        text: _("Folders"),
        style: `color: ${textColor}; font-size: ${1.4 * s}em; font-weight: bold;`,
      })
    );

    let folderCount = Object.keys(this._syncResources.folders).length;
    card.add_actor(
      new St.Label({
        text: `${folderCount}` + _(" folders tracked"),
        style: `color: rgba(78, 159, 255, 1); font-size: ${1 * s}em; font-weight: bold;`,
      })
    );

    let folderList = new St.BoxLayout({
      vertical: true,
      style: `margin-top: ${10 * s}px;`,
    });

    Object.keys(this._syncResources.folders).forEach((id) => {
      let folder = this._syncResources.folders[id];

      let row = new St.BoxLayout({
        vertical: false,
        style: `margin-bottom: ${6 * s}px; align-items: center;`,
      });
      let folderStateText;
      let dotColor = "rgba(128, 128, 128, 1)";
      if (folder.paused) {
        dotColor = "rgba(150, 150, 150, 1)";
        folderStateText = _("Paused");
      } else if (folder.errors > 0) {
        dotColor = "rgba(231, 76, 60, 1)";
        folderStateText = _("Error");
      } else if (folder.state === "scanning") {
        dotColor = "rgba(52, 152, 219, 1)";
        folderStateText = _("Scanning");
      } else if (folder.state === "syncing") {
        dotColor = "rgba(52, 152, 219, 1)";
        folderStateText = _("Syncing");
      } else if (folder.state === "idle") {
        dotColor = "rgba(46, 204, 113, 1)";
        folderStateText = _("Up to Date");
      }

      let dot = new St.Bin({
        style: `background-color: ${dotColor}; width: ${1.3 * s}em; height: ${0.7 * s}em; border-radius: ${2 * s}em; margin-right: ${8 * s}px;`,
      });

      let folderLabel = new St.Label({
        text: `${folder.label}: `,
        style: `color: ${textColor}; font-size: ${1.2 * s}em; font-weight: bold`,
      });

      let folderState = new St.Label({
        text: `${folderStateText}`,
        style: `color: ${dotColor}; font-size: ${1.1 * s}em; font-weight: bold; margin-right: ${8 * s}px;`,
      });

      let statusText;
      if (folder.paused) {
        statusText = "---";
      } else {
        statusText = `${Math.floor(folder.completion || 0)}%`;
      }

      let folderStatus = new St.Label({
        text: `${statusText}`,
        style: `color: ${dotColor}; font-size: ${1.1 * s}em; font-weight: bold; margin-right: ${2 * s}px;`,
      });

      row.add_actor(dot);
      row.add_actor(folderLabel);
      row.add_actor(folderState);
      row.add_actor(folderStatus);
      folderList.add_actor(row);
    });

    card.add_actor(folderList);
    this.container.add_actor(card);
  },

  on_settings_changed: function () {
    this._stopPoll();
    if (this._retryTimerId) {
      Mainloop.source_remove(this._retryTimerId);
    }
    this._syncResources.folders = {};
    this._checkIfUp();
  },

  _on_desklet_removed: function () {
    if (this._updateTimerId) {
      Mainloop.source_remove(this._updateTimerId);
    }
    if (this._httpSession) {
      this._httpSession.abort();
    }
  },
};

function main(metadata, desklet_id) {
  return new MyApplet(metadata, desklet_id);
}
