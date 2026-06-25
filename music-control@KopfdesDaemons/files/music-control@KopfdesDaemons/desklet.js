const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;
const Settings = imports.ui.settings;
const Interfaces = imports.misc.interfaces;
const Util = imports.misc.util;

const MEDIA_PLAYER_2_PATH = "/org/mpris/MediaPlayer2";
const MEDIA_PLAYER_2_NAME = "org.mpris.MediaPlayer2";
const MEDIA_PLAYER_2_PLAYER_NAME = "org.mpris.MediaPlayer2.Player";

const UUID = "music-control@KopfdesDaemons";

Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class Player {
  constructor(desklet, busname, owner) {
    this._desklet = desklet;
    this._busName = busname;
    this._owner = owner;

    let asyncReadyCb = (proxy, error, property) => {
      if (error) global.logError(error);
      else {
        this[property] = proxy;
        this._dbus_acquired();
      }
    };

    Interfaces.getDBusProxyWithOwnerAsync(MEDIA_PLAYER_2_NAME, this._busName, (p, e) => asyncReadyCb(p, e, "_mediaServer"));
    Interfaces.getDBusProxyWithOwnerAsync(MEDIA_PLAYER_2_PLAYER_NAME, this._busName, (p, e) => asyncReadyCb(p, e, "_mediaServerPlayer"));
    Interfaces.getDBusPropertiesAsync(this._busName, MEDIA_PLAYER_2_PATH, (p, e) => asyncReadyCb(p, e, "_prop"));
  }

  _dbus_acquired() {
    if (!this._prop || !this._mediaServerPlayer || !this._mediaServer) return;
    this._propChangedId = this._prop.connectSignal("PropertiesChanged", (proxy, sender, [iface, props]) => {
      if (props.PlaybackStatus) this._desklet._updateStatus(this._owner, props.PlaybackStatus.unpack());
      if (props.Metadata) this._desklet._updateMetadata(this._owner, props.Metadata.deep_unpack());
    });
    this._desklet._updateStatus(this._owner, this._mediaServerPlayer.PlaybackStatus);
    this._desklet._updateMetadata(this._owner, this._mediaServerPlayer.Metadata);
  }

  destroy() {
    if (this._prop && this._propChangedId) this._prop.disconnectSignal(this._propChangedId);
  }
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.setHeader(_("Music Control"));

    this._currentCover = this._imagePath;

    // Default settings
    this.scaleSize = 1;
    this.size = 18;
    this.borderColor = "#ffffff";
    this.borderSize = 0.2;
    this.borderRadius = 10;
    this.coverOpacity = 1.0;
    this.hideDecorations = true;

    // Bind settings
    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this._setupLayout);
    this.settings.bindProperty(Settings.BindingDirection.IN, "border-color", "borderColor", this._setupLayout);
    this.settings.bindProperty(Settings.BindingDirection.IN, "border-size", "borderSize", this._setupLayout);
    this.settings.bindProperty(Settings.BindingDirection.IN, "border-radius", "borderRadius", this._setupLayout);
    this.settings.bindProperty(Settings.BindingDirection.IN, "cover-opacity", "coverOpacity", this._setupLayout);
    this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hideDecorations", this._onDecorationsChanged);

    this._players = {};
    this._activePlayer = null;
    this._dbus = null;
    this._trackCoverFileTmp = null;

    Interfaces.getDBusAsync((proxy, error) => {
      if (error) return;
      this._dbus = proxy;
      let name_regex = /^org\.mpris\.MediaPlayer2\./;

      this._dbus.ListNamesRemote(names => {
        for (let n in names[0]) {
          let name = names[0][n];
          if (name_regex.test(name)) this._dbus.GetNameOwnerRemote(name, owner => this._addPlayer(name, owner[0]));
        }
      });

      this._ownerChangedId = this._dbus.connectSignal("NameOwnerChanged", (proxy, sender, [name, old_owner, new_owner]) => {
        if (name_regex.test(name)) {
          if (new_owner && !old_owner) this._addPlayer(name, new_owner);
          else if (old_owner && !new_owner) this._removePlayer(name, old_owner);
          else this._changePlayerOwner(name, old_owner, new_owner);
        }
      });
    });
  }

  on_desklet_added_to_desktop() {
    this._setupLayout();
    this._onDecorationsChanged();
  }

  _onDecorationsChanged() {
    this.metadata["prevent-decorations"] = this.hideDecorations;
    this._updateDecoration();
  }

  on_desklet_removed() {
    if (this._ownerChangedId && this._dbus) {
      this._dbus.disconnectSignal(this._ownerChangedId);
    }
    for (let i in this._players) {
      this._players[i].destroy();
    }
  }

  _addPlayer(busName, owner) {
    if (!this._players[owner] && owner) {
      let player = new Player(this, busName, owner);
      this._players[owner] = player;
      if (!this._activePlayer) this._activePlayer = owner;
    }
  }

  _removePlayer(busName, owner) {
    if (this._players[owner] && this._players[owner]._busName == busName) {
      this._players[owner].destroy();
      delete this._players[owner];

      if (this._activePlayer == owner) {
        this._activePlayer = null;
        for (let i in this._players) {
          this._activePlayer = i;
          this._updateMetadata(i, this._players[i]._mediaServerPlayer.Metadata);
          this._updateStatus(i, this._players[i]._mediaServerPlayer.PlaybackStatus);
          break;
        }
        if (!this._activePlayer) {
          if (this._title) this._title.set_text(_("No music playing"));
          if (this._artist) this._artist.set_text("No music playing");
          this._showCover(this._imagePath);
          if (this._playBtnIcon) this._playBtnIcon.set_icon_name("media-playback-start");
        }
      }
    }
  }

  _changePlayerOwner(busName, oldOwner, newOwner) {
    if (this._players[oldOwner] && busName == this._players[oldOwner]._busName) {
      this._players[newOwner] = this._players[oldOwner];
      this._players[newOwner]._owner = newOwner;
      delete this._players[oldOwner];
      if (this._activePlayer == oldOwner) this._activePlayer = newOwner;
    }
  }

  _updateMetadata(owner, metadata) {
    if (owner !== this._activePlayer && this._activePlayer !== null) return;
    if (!metadata) return;

    let artist = _("Unknown Artist");
    if (metadata["xesam:artist"]) {
      let artistVal = metadata["xesam:artist"];
      if (artistVal.get_type_string) {
        switch (artistVal.get_type_string()) {
          case "s":
            artist = artistVal.unpack();
            break;
          case "as":
            artist = artistVal.deep_unpack().join(", ");
            break;
        }
      } else {
        artist = artistVal.toString();
      }
    }
    let title = _("Unknown Title");
    if (metadata["xesam:title"]) {
      title = metadata["xesam:title"].unpack ? metadata["xesam:title"].unpack() : metadata["xesam:title"].toString();
    }

    if (this._title) this._title.set_text(title);
    if (this._artist) this._artist.set_text(artist);

    let artUrl = metadata["mpris:artUrl"] ? (metadata["mpris:artUrl"].unpack ? metadata["mpris:artUrl"].unpack() : metadata["mpris:artUrl"]) : null;
    if (artUrl) {
      if (this._trackCoverFile != artUrl) {
        this._trackCoverFile = artUrl;
        if (artUrl.match(/^http/)) {
          if (!this._trackCoverFileTmp) this._trackCoverFileTmp = Gio.file_new_tmp("XXXXXX.mediaplayer-cover")[0];
          Util.spawn_async(["wget", artUrl, "-O", this._trackCoverFileTmp.get_path()], () => this._showCover(this._trackCoverFileTmp.get_path()));
        } else if (artUrl.match(/data:image\/(png|jpeg);base64,/)) {
          if (!this._trackCoverFileTmp) this._trackCoverFileTmp = Gio.file_new_tmp("XXXXXX.mediaplayer-cover")[0];
          const cover_base64 = artUrl.split(",")[1];
          const base64_decode = data => new Promise(resolve => resolve(GLib.base64_decode(data)));
          if (cover_base64) {
            base64_decode(cover_base64)
              .then(decoded => {
                this._trackCoverFileTmp.replace_contents(decoded, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                return this._trackCoverFileTmp.get_path();
              })
              .then(path => this._showCover(path));
          }
        } else {
          let cover_path = decodeURIComponent(artUrl).replace("file://", "");
          this._showCover(cover_path);
        }
      }
    } else {
      this._trackCoverFile = null;
      this._showCover(this._imagePath);
    }
  }

  _updateStatus(owner, status) {
    if (!status) return;

    if (owner !== this._activePlayer && status === "Playing") {
      this._activePlayer = owner;
      if (this._players[owner] && this._players[owner]._mediaServerPlayer) {
        this._updateMetadata(owner, this._players[owner]._mediaServerPlayer.Metadata);
      }
    }
    if (owner !== this._activePlayer) return;

    if (this._playBtnIcon) {
      if (status === "Playing") this._playBtnIcon.set_icon_name("media-playback-pause");
      else this._playBtnIcon.set_icon_name("media-playback-start");
    }
  }

  _showCover(coverPath) {
    this._currentCover = coverPath || this._imagePath;
    if (this._bgWidget) {
      let contentSize = this.size * this.scaleSize;
      let borderSize = this.borderSize * this.scaleSize;
      this._bgWidget.set_style(
        `background-image: url("file://${this._currentCover}"); background-size: cover; background-position: center; width: ${contentSize}em; height: ${contentSize}em; border-radius: ${this.borderRadius * this.scaleSize}em; border: ${borderSize}em solid transparent;`,
      );
      this._bgWidget.set_opacity(Math.round(this.coverOpacity * 255));
    }
  }

  _setupLayout() {
    if (this._mainWidget) {
      this._mainWidget.destroy();
    }
    this._mainWidget = this._getContainer();
    this.setContent(this._mainWidget);

    if (this._activePlayer && this._players[this._activePlayer] && this._players[this._activePlayer]._mediaServerPlayer) {
      this._updateMetadata(this._activePlayer, this._players[this._activePlayer]._mediaServerPlayer.Metadata);
      this._updateStatus(this._activePlayer, this._players[this._activePlayer]._mediaServerPlayer.PlaybackStatus);
    }
  }

  _getContainer() {
    let contentSize = this.size * this.scaleSize;
    let borderSize = this.borderSize * this.scaleSize;
    let totalSize = contentSize + 2 * borderSize;

    this._mainWidget = new St.Widget({
      clip_to_allocation: true,
      style: `width: ${totalSize}em; height: ${totalSize}em;`,
    });

    this._bgWidget = new St.Widget({
      style: `background-image: url("file://${this._currentCover}"); background-size: cover; background-position: center; width: ${contentSize}em; height: ${contentSize}em; border-radius: ${this.borderRadius * this.scaleSize}em; border: ${borderSize}em solid transparent;`,
    });
    this._bgWidget.set_opacity(Math.round(this.coverOpacity * 255));
    this._mainWidget.add_child(this._bgWidget);

    this._contentWidget = new St.BoxLayout({
      vertical: true,
      style: `width: ${contentSize}em; height: ${contentSize}em; border-radius: ${this.borderRadius * this.scaleSize}em; border: ${borderSize}em solid ${this.borderColor};`,
    });
    this._mainWidget.add_child(this._contentWidget);

    // Spacer to push content into the lower half
    const spacer = new St.Widget({ style: `height: ${(this.size / 2) * this.scaleSize}em;` });
    this._contentWidget.add_child(spacer);

    // Title
    const titleRow = new St.Bin({ x_align: St.Align.MIDDLE });
    this._title = new St.Label({
      text: _("No music playing"),
      style: `background-color: rgba(0, 0, 0, 0.7); text-align: center; font-size: ${1.5 * this.scaleSize}em; border-radius: ${1 * this.scaleSize}em; max-width: ${this.size}em; padding: ${0.2 * this.scaleSize}em ${0.8 * this.scaleSize}em;`,
    });
    titleRow.set_child(this._title);
    this._contentWidget.add_child(titleRow);

    // Artist
    const artistRow = new St.Bin({ x_align: St.Align.MIDDLE, style: `width: ${this.size * this.scaleSize}em;` });
    this._artist = new St.Label({
      text: _("Unknown Artist"),
      style: `background-color: rgba(0, 0, 0, 0.7); text-align: center; font-size: ${1 * this.scaleSize}em; border-radius: ${1 * this.scaleSize}em; max-width: ${11 * this.scaleSize}em; padding: ${0.2 * this.scaleSize}em ${0.8 * this.scaleSize}em;`,
    });
    artistRow.set_child(this._artist);
    this._contentWidget.add_child(artistRow);

    // Controls
    const controlsRow = new St.Bin({ x_align: St.Align.MIDDLE, style: `width: ${this.size * this.scaleSize}em;` });
    const controlsRowContent = new St.BoxLayout({
      style: `margin-top: ${0.5 * this.scaleSize}em; background-color: rgba(0, 0, 0, 0.7); border-radius: ${1 * this.scaleSize}em;`,
    });

    const controlButtonStyle = `height: ${3 * this.scaleSize}em; width: ${3 * this.scaleSize}em; padding: ${0.2 * this.scaleSize}em; border-radius: ${1 * this.scaleSize}em;`;

    // Previous button
    this._prevBtnIcon = new St.Icon({ icon_name: "media-seek-backward", icon_type: St.IconType.SYMBOLIC, style: controlButtonStyle });
    const prevBtn = new St.Button({ child: this._prevBtnIcon, style_class: "music-control-button", style: controlButtonStyle });
    prevBtn.connect("clicked", () => {
      if (this._activePlayer && this._players[this._activePlayer]) {
        this._players[this._activePlayer]._mediaServerPlayer.PreviousRemote();
      }
    });
    controlsRowContent.add_child(prevBtn);

    // Play/Pause button
    this._playBtnIcon = new St.Icon({ icon_name: "media-playback-start", icon_type: St.IconType.SYMBOLIC, style: controlButtonStyle });
    const playBtn = new St.Button({ child: this._playBtnIcon, style_class: "music-control-button", style: controlButtonStyle });
    playBtn.connect("clicked", () => {
      if (this._activePlayer && this._players[this._activePlayer]) {
        this._players[this._activePlayer]._mediaServerPlayer.PlayPauseRemote();
      }
    });
    controlsRowContent.add_child(playBtn);

    // Next button
    this._nextBtnIcon = new St.Icon({ icon_name: "media-seek-forward", icon_type: St.IconType.SYMBOLIC, style: controlButtonStyle });
    const nextBtn = new St.Button({ child: this._nextBtnIcon, style_class: "music-control-button", style: controlButtonStyle });
    nextBtn.connect("clicked", () => {
      if (this._activePlayer && this._players[this._activePlayer]) {
        this._players[this._activePlayer]._mediaServerPlayer.NextRemote();
      }
    });
    controlsRowContent.add_child(nextBtn);

    controlsRow.set_child(controlsRowContent);
    this._contentWidget.add_child(controlsRow);

    return this._mainWidget;
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
