// Spotify Widget — Cinnamon Desklet
// MPRIS DBUS integration for ad-free Spotify playback control

const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const Settings = imports.ui.settings;
const Util = imports.misc.util;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Gettext = imports.gettext;

const UUID = "spotify-widget@suleman";

const MPRIS_BUS_NAME = "org.mpris.MediaPlayer2.spotify";
const MPRIS_OBJECT_PATH = "/org/mpris/MediaPlayer2";
const MPRIS_PLAYER_IFACE = "org.mpris.MediaPlayer2.Player";
const MPRIS_ROOT_IFACE = "org.mpris.MediaPlayer2";
const DBUS_PROPERTIES_IFACE = "org.freedesktop.DBus.Properties";

// DBUS XML interfaces for proxy creation
const MprisPlayerIface = `
<node>
  <interface name="${MPRIS_PLAYER_IFACE}">
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Stop"/>
    <method name="Seek">
      <arg type="x" direction="in"/>
    </method>
    <method name="SetPosition">
      <arg type="o" direction="in"/>
      <arg type="x" direction="in"/>
    </method>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Position" type="x" access="read"/>
    <property name="Volume" type="d" access="readwrite"/>
    <property name="Shuffle" type="b" access="readwrite"/>
    <property name="LoopStatus" type="s" access="readwrite"/>
    <signal name="Seeked">
      <arg type="x"/>
    </signal>
  </interface>
</node>`;

const MprisPlayerProxy = Gio.DBusProxy.makeProxyWrapper(MprisPlayerIface);

const DBusPropertiesIface = `
<node>
  <interface name="${DBUS_PROPERTIES_IFACE}">
    <method name="Get">
      <arg type="s" direction="in"/>
      <arg type="s" direction="in"/>
      <arg type="v" direction="out"/>
    </method>
    <method name="GetAll">
      <arg type="s" direction="in"/>
      <arg type="a{sv}" direction="out"/>
    </method>
    <signal name="PropertiesChanged">
      <arg type="s"/>
      <arg type="a{sv}"/>
      <arg type="as"/>
    </signal>
  </interface>
</node>`;

const DBusPropertiesProxy = Gio.DBusProxy.makeProxyWrapper(DBusPropertiesIface);


function SpotifyWidget(metadata, deskletId) {
    this._init(metadata, deskletId);
}

SpotifyWidget.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this._metadata = metadata;
        this._deskletId = deskletId;
        this._playerProxy = null;
        this._propsProxy = null;
        this._propsSignalId = 0;
        this._positionTimerId = 0;
        this._currentTrackLength = 0;
        this._currentPosition = 0;
        this._isPlaying = false;
        this._currentVolume = 1.0;
        this._currentTrackId = "";
        this._isSeeking = false;

        this._bindSettings();
        this._buildUI();
        this._connectDBus();
        this._startPositionPolling();
    },

    // --- Settings ---

    _bindSettings: function() {
        this.settings = new Settings.DeskletSettings(this, UUID, this._deskletId);

        this.settings.bind("background-color", "backgroundColor", this._onSettingsChanged.bind(this));
        this.settings.bind("font-color", "fontColor", this._onSettingsChanged.bind(this));
        this.settings.bind("accent-color", "accentColor", this._onSettingsChanged.bind(this));
        this.settings.bind("font-scale", "fontScale", this._onSettingsChanged.bind(this));
        this.settings.bind("show-album-art", "showAlbumArt", this._onSettingsChanged.bind(this));
        this.settings.bind("widget-size", "widgetSize", this._onSettingsChanged.bind(this));
        this.settings.bind("widget-width", "widgetWidth", this._onSettingsChanged.bind(this));
        this.settings.bind("refresh-interval", "refreshInterval", this._onRefreshIntervalChanged.bind(this));
        this.settings.bind("launcher-path", "launcherPath");
    },

    _onSettingsChanged: function() {
        this._applyStyles();
    },

    _onRefreshIntervalChanged: function() {
        this._stopPositionPolling();
        this._startPositionPolling();
    },

    // --- UI Construction ---

    _buildUI: function() {
        // Main container — vertical card
        this._container = new St.BoxLayout({
            vertical: true,
            style_class: "spotify-widget",
            reactive: true
        });

        // ── Top row: album art (left) + info column (right) ──
        this._topRow = new St.BoxLayout({
            vertical: false,
            style_class: "top-row"
        });

        // Album art
        this._albumArt = new St.Bin({
            style_class: "album-art"
        });
        this._albumArtIcon = new St.Icon({
            icon_name: "media-optical",
            icon_size: 100
        });
        this._albumArt.set_child(this._albumArtIcon);

        // Info column: title, artist, controls
        this._infoColumn = new St.BoxLayout({
            vertical: true,
            style_class: "info-column",
            x_expand: true
        });

        this._trackTitle = new St.Label({
            text: "Not Playing",
            style_class: "track-title"
        });
        this._trackArtist = new St.Label({
            text: "",
            style_class: "track-artist"
        });

        // Controls row: prev, play/pause, next, spacer, volume icon, open icon
        this._controlsBox = new St.BoxLayout({
            style_class: "controls-box"
        });

        this._prevButton = this._createControlButton("media-skip-backward-symbolic", 16, this._onPrevious.bind(this));
        this._playPauseButton = this._createControlButton("media-playback-start-symbolic", 20, this._onPlayPause.bind(this));
        this._playPauseButton.add_style_class_name("play-pause-button");
        this._nextButton = this._createControlButton("media-skip-forward-symbolic", 16, this._onNext.bind(this));

        this._controlsSpacer = new St.Bin({ x_expand: true });

        // Volume icon (toggles volume slider row)
        this._volumeButton = this._createControlButton("audio-volume-high-symbolic", 16, this._onVolumeToggle.bind(this));
        this._volumeButton.add_style_class_name("utility-button");
        this._volumeButton.connect("scroll-event", (actor, event) => {
            this._onVolumeScroll(actor, event);
            return Clutter.EVENT_STOP;
        });

        // Spotify icon — toggles: launch/show/hide
        this._openButton = this._createControlButton("spotify-client", 24, this._onToggleSpotify.bind(this));
        this._openButton.add_style_class_name("utility-button");

        // Kill Spotify button (X)
        this._killButton = this._createControlButton("window-close-symbolic", 14, this._onKillSpotify.bind(this));
        this._killButton.add_style_class_name("utility-button");

        this._controlsBox.add_actor(this._prevButton);
        this._controlsBox.add_actor(this._playPauseButton);
        this._controlsBox.add_actor(this._nextButton);
        this._controlsBox.add_actor(this._controlsSpacer);
        this._controlsBox.add_actor(this._volumeButton);
        this._controlsBox.add_actor(this._openButton);
        this._controlsBox.add_actor(this._killButton);

        this._infoColumn.add_actor(this._trackTitle);
        this._infoColumn.add_actor(this._trackArtist);
        this._infoColumn.add_actor(this._controlsBox);

        this._topRow.add_actor(this._albumArt);
        this._topRow.add_actor(this._infoColumn);

        // ── Volume slider row (horizontal, hidden by default) ──
        this._volumeRow = new St.BoxLayout({
            style_class: "volume-row",
            visible: false,
            x_expand: true
        });
        this._volumeRowIcon = new St.Icon({
            icon_name: "audio-volume-high-symbolic",
            icon_size: 14
        });
        this._volumeSliderContainer = new St.BoxLayout({
            style_class: "volume-slider-container",
            reactive: true,
            track_hover: true,
            x_expand: true
        });
        this._volumeSliderFill = new St.Bin({ style_class: "volume-slider-fill" });
        this._volumeSliderBg = new St.Bin({ style_class: "volume-slider-bg", x_expand: true });
        this._volumeSliderContainer.add_actor(this._volumeSliderFill);
        this._volumeSliderContainer.add_actor(this._volumeSliderBg);

        this._volumeSliderContainer.connect("button-press-event", (actor, event) => {
            this._onVolumeClicked(actor, event);
            return Clutter.EVENT_STOP;
        });
        this._volumeSliderContainer.connect("scroll-event", (actor, event) => {
            this._onVolumeScroll(actor, event);
            return Clutter.EVENT_STOP;
        });

        this._volumeLabel = new St.Label({
            text: "100%",
            style_class: "volume-label"
        });
        this._volumeRow.add_actor(this._volumeRowIcon);
        this._volumeRow.add_actor(this._volumeSliderContainer);
        this._volumeRow.add_actor(this._volumeLabel);

        // ── Progress section: bar + time labels ──
        this._progressSection = new St.BoxLayout({
            vertical: true,
            style_class: "progress-section",
            x_expand: true
        });

        // Progress: DrawingArea approach — container handles all events,
        // child bar is non-reactive so clicks always hit the container
        this._progressContainer = new St.BoxLayout({
            style_class: "progress-container",
            x_expand: true,
            reactive: true,
            track_hover: true
        });
        this._progressBar = new St.Bin({
            style_class: "progress-bar",
            reactive: false
        });
        this._progressContainer.add_actor(this._progressBar);

        this._progressContainer.connect("button-press-event", (actor, event) => {
            this._onProgressClicked(actor, event);
            return Clutter.EVENT_STOP;
        });

        // Time labels row: elapsed ... remaining
        this._timeRow = new St.BoxLayout({
            style_class: "time-row",
            x_expand: true
        });
        this._elapsedLabel = new St.Label({
            text: "0:00",
            style_class: "time-label"
        });
        this._timeSpacer = new St.Bin({ x_expand: true });
        this._remainingLabel = new St.Label({
            text: "0:00",
            style_class: "time-label"
        });
        this._timeRow.add_actor(this._elapsedLabel);
        this._timeRow.add_actor(this._timeSpacer);
        this._timeRow.add_actor(this._remainingLabel);

        this._progressSection.add_actor(this._progressContainer);
        this._progressSection.add_actor(this._timeRow);

        // ── Assemble card ──
        this._container.add_actor(this._topRow);
        this._container.add_actor(this._progressSection);
        this._container.add_actor(this._volumeRow);

        this._applyStyles();
        this.setContent(this._container);
    },

    _createControlButton: function(iconName, iconSize, callback) {
        let button = new St.Button({
            style_class: "control-button",
            reactive: true
        });
        let icon = new St.Icon({
            icon_name: iconName,
            icon_size: iconSize
        });
        button.set_child(icon);
        button.connect("clicked", callback);
        return button;
    },

    _applyStyles: function() {
        let bg = this.backgroundColor || "rgba(18, 18, 18, 0.92)";
        let fg = this.fontColor || "rgba(255, 255, 255, 0.93)";
        let accent = this.accentColor || "rgba(30, 215, 96, 1.0)";
        let fgDim = this.fontColor || "rgba(255, 255, 255, 0.45)";
        let scale = this.fontScale || 1.0;
        let isCompact = this.widgetSize === "compact";
        let artSize = isCompact ? 56 : 100;

        // Card
        let width = this.widgetWidth || 320;
        this._container.set_style(
            `background-color: ${bg}; color: ${fg}; width: ${width}px;`
        );
        if (isCompact) {
            this._container.remove_style_class_name("spotify-widget");
            this._container.add_style_class_name("spotify-widget-compact");
            this._topRow.remove_style_class_name("top-row");
            this._topRow.add_style_class_name("top-row-compact");
        } else {
            this._container.remove_style_class_name("spotify-widget-compact");
            this._container.add_style_class_name("spotify-widget");
            this._topRow.remove_style_class_name("top-row-compact");
            this._topRow.add_style_class_name("top-row");
        }

        // Album art size
        this._albumArtIcon.set_icon_size(artSize);

        // Track info
        this._trackTitle.set_style(
            `color: ${fg}; font-size: ${Math.round(15 * scale)}px; font-weight: bold;`
        );
        this._trackArtist.set_style(
            `color: ${fg}; font-size: ${Math.round(12 * scale)}px; opacity: 0.55;`
        );

        // Controls — playback buttons get full brightness, utility buttons dimmer
        this._prevButton.set_style(`color: ${fg};`);
        this._playPauseButton.set_style(`color: ${fg};`);
        this._nextButton.set_style(`color: ${fg};`);
        this._volumeButton.set_style(`color: ${fg}; opacity: 0.5;`);
        this._openButton.set_style(`color: ${fg}; opacity: 0.5;`);

        // Progress
        this._progressContainer.set_style(
            `height: 4px; border-radius: 2px; background-color: rgba(255,255,255,0.12);`
        );

        // Time labels
        this._elapsedLabel.set_style(
            `color: ${fg}; font-size: ${Math.round(10 * scale)}px; opacity: 0.4;`
        );
        this._remainingLabel.set_style(
            `color: ${fg}; font-size: ${Math.round(10 * scale)}px; opacity: 0.4;`
        );

        // Volume row
        this._volumeRowIcon.set_style(`color: ${fg}; opacity: 0.5;`);
        this._volumeLabel.set_style(
            `color: ${fg}; font-size: ${Math.round(10 * scale)}px; opacity: 0.5; min-width: 32px;`
        );

        // Kill button
        this._killButton.set_style(`color: ${fg}; opacity: 0.35;`);

        this._albumArt.visible = this.showAlbumArt !== false;
    },

    // --- DBUS Connection ---

    _connectDBus: function() {
        // Always create fresh proxies
        this._disconnectDBus();

        try {
            this._playerProxy = new MprisPlayerProxy(
                Gio.DBus.session,
                MPRIS_BUS_NAME,
                MPRIS_OBJECT_PATH
            );

            this._propsProxy = new DBusPropertiesProxy(
                Gio.DBus.session,
                MPRIS_BUS_NAME,
                MPRIS_OBJECT_PATH
            );

            // Test the connection by reading a property
            let status = this._playerProxy.PlaybackStatus;
            if (!status) {
                throw new Error("No PlaybackStatus — Spotify not on DBUS");
            }

            // Connection works — listen for property changes
            this._propsSignalId = this._propsProxy.connectSignal(
                "PropertiesChanged",
                this._onPropertiesChanged.bind(this)
            );

            this._updateFromDBus();
            this._setSpotifyRunning(true);
        } catch (e) {
            // Spotify not on DBUS yet — will retry on next poll
            this._playerProxy = null;
            this._propsProxy = null;
            this._setSpotifyRunning(false);
        }
    },

    _disconnectDBus: function() {
        if (this._propsProxy && this._propsSignalId) {
            try { this._propsProxy.disconnectSignal(this._propsSignalId); } catch(e) {}
            this._propsSignalId = 0;
        }
        this._playerProxy = null;
        this._propsProxy = null;
    },

    _setSpotifyRunning: function(running) {
        // No auto-relaunch — user controls launch via play or spotify icon
        if (!running) {
            this._trackTitle.set_text("Not Playing");
            this._trackArtist.set_text("Click play to start");
        }
    },

    // --- DBUS Signal Handling ---

    _onPropertiesChanged: function(proxy, sender, [iface, changed, invalidated]) {
        if (iface !== MPRIS_PLAYER_IFACE) return;

        if (changed.Metadata) {
            this._updateMetadata(changed.Metadata.deep_unpack());
        }
        if (changed.PlaybackStatus) {
            this._updatePlaybackStatus(changed.PlaybackStatus.deep_unpack());
        }
        if (changed.Volume) {
            this._updateVolume(changed.Volume.deep_unpack());
        }
    },

    _updateFromDBus: function() {
        if (!this._playerProxy) return;

        try {
            let metadata = this._playerProxy.Metadata;
            if (metadata) {
                this._updateMetadata(metadata);
            }

            let status = this._playerProxy.PlaybackStatus;
            if (status) {
                this._updatePlaybackStatus(status);
            }

            let volume = this._playerProxy.Volume;
            if (volume !== undefined) {
                this._updateVolume(volume);
            }

            this._setSpotifyRunning(true);
        } catch (e) {
            global.logError("[SpotifyWidget] Update failed: " + e.message);
            this._setSpotifyRunning(false);
        }
    },

    // --- Metadata Updates ---

    _updateMetadata: function(metadata) {
        let title = this._getMetadataString(metadata, "xesam:title");
        this._trackTitle.set_text(title || "Unknown Track");

        let artists = this._getMetadataStringArray(metadata, "xesam:artist");
        this._trackArtist.set_text(artists || "Unknown Artist");

        this._currentTrackLength = this._getMetadataInt64(metadata, "mpris:length");
        this._currentTrackId = this._getMetadataString(metadata, "mpris:trackid");
        this._currentPosition = 0;
        this._updateProgressBar();

        let artUrl = this._getMetadataString(metadata, "mpris:artUrl");
        this._updateAlbumArt(artUrl);
    },

    _getMetadataString: function(metadata, key) {
        if (metadata[key]) {
            let val = metadata[key];
            if (typeof val.deep_unpack === "function") {
                return val.deep_unpack();
            }
            return String(val);
        }
        return "";
    },

    _getMetadataStringArray: function(metadata, key) {
        if (metadata[key]) {
            let val = metadata[key];
            if (typeof val.deep_unpack === "function") {
                val = val.deep_unpack();
            }
            if (Array.isArray(val)) {
                return val.join(", ");
            }
            return String(val);
        }
        return "";
    },

    _getMetadataInt64: function(metadata, key) {
        if (metadata[key]) {
            let val = metadata[key];
            if (typeof val.deep_unpack === "function") {
                return val.deep_unpack();
            }
            return Number(val);
        }
        return 0;
    },

    _updateAlbumArt: function(artUrl) {
        if (!artUrl || !this.showAlbumArt) return;

        try {
            let isCompact = this.widgetSize === "compact";
            let size = isCompact ? 56 : 100;

            if (artUrl.startsWith("file://")) {
                try {
                    let texture = St.TextureCache.get_default().load_uri_async(
                        artUrl, size, size
                    );
                    this._albumArt.set_child(texture);
                    return;
                } catch (e) {
                    // File not found or unreadable — fall through to fallback icon
                }
            } else if (artUrl.startsWith("http")) {
                let texture = St.TextureCache.get_default().load_uri_async(
                    artUrl, size, size
                );
                this._albumArt.set_child(texture);
                return;
            }
        } catch (e) {
            global.logError("[SpotifyWidget] Album art failed: " + e.message);
        }

        // Fallback to icon
        this._albumArtIcon.set_icon_size(this.widgetSize === "compact" ? 56 : 100);
        this._albumArt.set_child(this._albumArtIcon);
    },

    // --- Playback Status ---

    _updatePlaybackStatus: function(status) {
        this._isPlaying = (status === "Playing");

        let iconName = this._isPlaying
            ? "media-playback-pause-symbolic"
            : "media-playback-start-symbolic";

        let icon = this._playPauseButton.get_child();
        if (icon) {
            icon.set_icon_name(iconName);
        }
    },

    // --- Position / Progress ---

    _startPositionPolling: function() {
        let interval = this.refreshInterval || 1000;
        this._positionTimerId = Mainloop.timeout_add(interval, () => {
            this._updatePosition();
            return GLib.SOURCE_CONTINUE;
        });
    },

    _stopPositionPolling: function() {
        if (this._positionTimerId) {
            Mainloop.source_remove(this._positionTimerId);
            this._positionTimerId = 0;
        }
    },

    _updatePosition: function() {
        // Read all properties fresh via DBus Properties.GetAll
        // (proxy caches are stale — PropertiesChanged signals unreliable with Flatpak)
        try {
            let connection = Gio.DBus.session;
            let result = connection.call_sync(
                MPRIS_BUS_NAME,
                MPRIS_OBJECT_PATH,
                DBUS_PROPERTIES_IFACE,
                "GetAll",
                new GLib.Variant("(s)", [MPRIS_PLAYER_IFACE]),
                null,
                Gio.DBusCallFlags.NONE,
                500,
                null
            );

            let props = result.deep_unpack()[0];

            // Metadata
            let metadata = props.Metadata ? props.Metadata.deep_unpack() : null;
            if (metadata) {
                let trackId = "";
                if (metadata["mpris:trackid"]) {
                    trackId = metadata["mpris:trackid"].deep_unpack
                        ? metadata["mpris:trackid"].deep_unpack() : String(metadata["mpris:trackid"]);
                }
                if (trackId && trackId !== this._currentTrackId) {
                    this._updateMetadata(metadata);
                }
            }

            // Playback status
            if (props.PlaybackStatus) {
                this._updatePlaybackStatus(props.PlaybackStatus.deep_unpack());
            }

            // Position
            if (props.Position) {
                this._currentPosition = props.Position.deep_unpack();
                this._updateProgressBar();
            }

            this._setSpotifyRunning(true);
        } catch (e) {
            // Spotify not on DBUS
            this._setSpotifyRunning(false);
        }
    },

    _updateProgressBar: function() {
        let fraction = 0;
        if (this._currentTrackLength > 0) {
            fraction = this._currentPosition / this._currentTrackLength;
            fraction = Math.max(0, Math.min(1, fraction));
        }

        let accent = this.accentColor || "rgba(30, 215, 96, 1.0)";
        let containerWidth = this._progressContainer.get_width();
        // Fall back to widget width setting if container not yet allocated
        if (containerWidth <= 0) {
            containerWidth = (this.widgetWidth || 320) - 28;
        }
        let fillWidth = Math.max(0, Math.round(fraction * containerWidth));
        this._progressBar.set_style(
            `background-color: ${accent}; height: 4px; border-radius: 2px; width: ${fillWidth}px;`
        );

        this._elapsedLabel.set_text(this._formatTime(this._currentPosition));
        let remaining = Math.max(0, this._currentTrackLength - this._currentPosition);
        this._remainingLabel.set_text("-" + this._formatTime(remaining));
    },

    _formatTime: function(microseconds) {
        let totalSeconds = Math.floor(microseconds / 1000000);
        let minutes = Math.floor(totalSeconds / 60);
        let seconds = totalSeconds % 60;
        return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
    },

    // --- Playback Controls ---

    _mprisCommand: function(method) {
        // Try proxy first
        if (this._playerProxy) {
            try {
                this._playerProxy[method + "Sync"]();
                return;
            } catch (e) {
                // Proxy stale — reconnect
                this._connectDBus();
                // Try once more with fresh proxy
                if (this._playerProxy) {
                    try {
                        this._playerProxy[method + "Sync"]();
                        return;
                    } catch (e2) { /* fall through to dbus-send */ }
                }
            }
        } else {
            // No proxy — try connecting
            this._connectDBus();
            if (this._playerProxy) {
                try {
                    this._playerProxy[method + "Sync"]();
                    return;
                } catch (e) { /* fall through */ }
            }
        }
        // Fallback: dbus-send always creates a fresh connection
        Util.spawn([
            "dbus-send", "--print-reply", "--dest=org.mpris.MediaPlayer2.spotify",
            "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player." + method
        ]);
    },

    _onPlayPause: function() {
        // If Spotify not running, launch it first
        if (!this._playerProxy) {
            this._onLaunchSpotify();
            return;
        }
        this._mprisCommand("PlayPause");
    },

    _onNext: function() {
        this._mprisCommand("Next");
    },

    _onPrevious: function() {
        this._mprisCommand("Previous");
    },

    // --- Seek ---

    _onProgressClicked: function(actor, event) {
        if (this._currentTrackLength <= 0) return;

        let [x] = event.get_coords();
        let [actorX] = actor.get_transformed_position();
        let actorWidth = actor.get_width();
        if (actorWidth <= 0) return;

        let fraction = Math.max(0, Math.min(1, (x - actorX) / actorWidth));
        let targetPosition = Math.floor(fraction * this._currentTrackLength);
        let offset = targetPosition - this._currentPosition;

        // Always use dbus-send — proxy seek is unreliable
        Util.spawn([
            "dbus-send", "--print-reply", "--dest=org.mpris.MediaPlayer2.spotify",
            "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player.Seek", "int64:" + offset
        ]);

        this._currentPosition = targetPosition;
        this._updateProgressBar();
    },

    // --- Volume ---

    _onVolumeToggle: function() {
        this._volumeRow.visible = !this._volumeRow.visible;
        if (this._volumeRow.visible) {
            this._updateVolumeUI();
        }
    },

    _updateVolume: function(volume) {
        this._currentVolume = Math.max(0, Math.min(1, volume));
        this._updateVolumeUI();
    },

    _updateVolumeUI: function() {
        let pct = Math.round(this._currentVolume * 100);
        this._volumeLabel.set_text(pct + "%");

        let totalWidth = this._volumeSliderContainer.get_width();
        if (totalWidth > 0) {
            let fillWidth = Math.round(this._currentVolume * totalWidth);
            let accent = this.accentColor || "rgba(30, 215, 96, 1.0)";
            this._volumeSliderFill.set_style(
                `background-color: ${accent}; height: 4px; width: ${fillWidth}px; border-radius: 2px 0 0 2px;`
            );
            this._volumeSliderBg.set_style(
                `background-color: rgba(255,255,255,0.15); height: 4px; width: ${totalWidth - fillWidth}px; border-radius: 0 2px 2px 0;`
            );
        }

        // Update volume button icon + row icon
        let iconName;
        if (this._currentVolume <= 0) {
            iconName = "audio-volume-muted-symbolic";
        } else if (this._currentVolume < 0.33) {
            iconName = "audio-volume-low-symbolic";
        } else if (this._currentVolume < 0.66) {
            iconName = "audio-volume-medium-symbolic";
        } else {
            iconName = "audio-volume-high-symbolic";
        }
        let volIcon = this._volumeButton.get_child();
        if (volIcon) volIcon.set_icon_name(iconName);
        this._volumeRowIcon.set_icon_name(iconName);
    },

    _onVolumeClicked: function(actor, event) {
        if (!this._playerProxy) return;

        let [x] = event.get_coords();
        let [actorX] = actor.get_transformed_position();
        let actorWidth = actor.get_width();
        if (actorWidth <= 0) return;

        let volume = Math.max(0, Math.min(1, (x - actorX) / actorWidth));
        this._setVolume(volume);
    },

    _onVolumeScroll: function(actor, event) {
        if (!this._playerProxy) return;

        let direction = event.get_scroll_direction();
        let step = 0.05;
        let volume = this._currentVolume;

        if (direction === Clutter.ScrollDirection.UP) {
            volume = Math.min(1, volume + step);
        } else if (direction === Clutter.ScrollDirection.DOWN) {
            volume = Math.max(0, volume - step);
        } else {
            return;
        }

        this._setVolume(volume);
    },

    _setVolume: function(volume) {
        try {
            this._playerProxy.Volume = volume;
            this._currentVolume = volume;
            this._updateVolumeUI();
        } catch (e) {
            global.logError("[SpotifyWidget] Volume set failed: " + e.message);
        }
    },

    // --- Window Management ---

    _onToggleSpotify: function() {
        let launcherPath = this._getLauncherPath();
        if (launcherPath) {
            Util.spawn(["bash", launcherPath, "toggle"]);
        } else {
            Util.spawnCommandLine(
                "bash -c 'if [ -f /tmp/.spotify-widget-wids ]; then " +
                "for w in $(cat /tmp/.spotify-widget-wids); do xdotool windowmap $w 2>/dev/null; done; " +
                "xdotool windowactivate $(tail -1 /tmp/.spotify-widget-wids) 2>/dev/null; " +
                "rm -f /tmp/.spotify-widget-wids; " +
                "elif xdotool search --class spotify >/dev/null 2>&1; then " +
                "for w in $(xdotool search --class spotify); do xdotool windowunmap $w; done; " +
                "xdotool search --class spotify > /tmp/.spotify-widget-wids 2>/dev/null; " +
                "else flatpak run com.spotify.Client 2>/dev/null || spotify & fi'"
            );
        }
    },

    _onKillSpotify: function() {
        Util.spawnCommandLine("bash -c 'flatpak kill com.spotify.Client 2>/dev/null; pkill -x spotify 2>/dev/null; rm -f /tmp/.spotify-widget-wids'");
        this._disconnectDBus();
        this._trackTitle.set_text("Not Playing");
        this._trackArtist.set_text("");
        this._currentPosition = 0;
        this._currentTrackLength = 0;
        this._updateProgressBar();
    },

    _onLaunchSpotify: function() {
        let launcherPath = this._getLauncherPath();
        if (launcherPath) {
            Util.spawn([launcherPath, "launch"]);
        } else {
            // Fallback: try flatpak first, then native
            Util.spawnCommandLine("bash -c 'flatpak run com.spotify.Client 2>/dev/null || spotify'");
        }

        // Retry DBUS connection after delay
        Mainloop.timeout_add(5000, () => {
            this._connectDBus();
            return GLib.SOURCE_REMOVE;
        });
    },

    _getLauncherPath: function() {
        if (this.launcherPath) {
            return this.launcherPath;
        }

        let deskletDir = this._metadata.path;
        let candidates = [
            deskletDir + "/../../launcher/spotify-launcher.sh",
            GLib.get_user_data_dir() + "/spotify-widget/spotify-launcher.sh",
            "/usr/local/bin/spotify-launcher.sh"
        ];

        for (let i = 0; i < candidates.length; i++) {
            try {
                let file = Gio.File.new_for_path(candidates[i]);
                file.query_info("standard::type", Gio.FileQueryInfoFlags.NONE, null);
                return candidates[i];
            } catch (e) {
                // File not found — try next candidate
            }
        }

        return null;
    },

    // --- Lifecycle ---

    on_desklet_removed: function() {
        this._stopPositionPolling();
        this._disconnectDBus();
    }
};

function main(metadata, deskletId) {
    return new SpotifyWidget(metadata, deskletId);
}
