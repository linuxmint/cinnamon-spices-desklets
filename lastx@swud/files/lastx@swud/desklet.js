const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Soup = imports.gi.Soup;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const ByteArray = imports.byteArray;
const Lang = imports.lang;

class LastFmDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        this._timeout = null;
        this._httpSession = new Soup.Session();
        this._httpSession.set_timeout(10);
        this._currentArtPath = null;
        this._initSettings(desklet_id);
        this._initUI();
        this._updateTrack();
    }

    _initSettings(desklet_id) {
        this.settings = new Settings.DeskletSettings(this, "lastx@swud", desklet_id);
        this.settings.bind("lastfm_user", "lastfmUser", this._onSettingsChanged.bind(this));
        this.settings.bind("update_interval", "updateInterval", this._onSettingsChanged.bind(this));
    }

    _initUI() {
        this.layout = new St.BoxLayout({
            vertical: true
        });

        this.overlay = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
            x_align: St.Align.START,
            y_align: St.Align.START,
            style: 'background-color: rgba(0, 0, 0, 0.4); padding: 20px; border-radius: 12px;'
        });
        // Profile container
        this.profileContainer = new St.BoxLayout({
            style: 'spacing: 10px; margin-bottom: 15px;'
        });


        // Profile text container
        this.profileTextContainer = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 2px;'
        });

        this.titleLabel = new St.Label({
            text: "Last.fm Recently Played",
            style: 'font-size: 14px; color: ;'
        });

        this.usernameLabel = new St.Label({
            text: this.lastfmUser || "No username set",
            style: 'font-size: 16px; color: #1db954;'
        });

        this.trackLabel = new St.Label({
            text: "Loading...",
            style: 'font-size: 20px; font-weight: bold; color: #ffffff;'
        });

        this.artistLabel = new St.Label({
            text: "",
            style: 'font-size: 18px; color: #b3b3b3;'
        });

        this.timestampLabel = new St.Label({
            text: "",
            style: 'font-size: 14px; color: #b3b3b3; margin-top: 5px;'
        });

        // Assemble the profile section
        this.profileTextContainer.add(this.titleLabel);
        this.profileTextContainer.add(this.usernameLabel);
        this.profileContainer.add(this.profileTextContainer);

        // Add all components to overlay
        this.overlay.add(this.profileContainer);
        this.overlay.add(this.trackLabel);
        this.overlay.add(this.artistLabel);
        this.overlay.add(this.timestampLabel);

        this.layout.add(this.overlay);
        this.setContent(this.layout);
    }

    _onSettingsChanged() {
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
        }

        this.usernameLabel.set_text(this.lastfmUser || "No username set");
        this.updateInterval = Math.max(this.updateInterval, 30);
        this._updateTrack();
    }

    async _updateTrack() {
        try {
            const trackData = await this._fetchLastFmData();
            if (!trackData) {
                this._updateLabels("No track playing", "");
                this._setDefaultBackground();
            } else {
                this._updateUI(trackData);
            }
        } catch (error) {
            global.logError(`LastFm Desklet Error: ${error.message}`);
            this._updateLabels("Error updating track", "");
            this._setDefaultBackground();
        }

        this._timeout = Mainloop.timeout_add_seconds(this.updateInterval, () => {
            this._updateTrack();
            return false;
        });
    }

    async _fetchLastFmData() {
        if (!this.lastfmUser) return null;

        const url = `https://klaxonx.vercel.app/api/lastfm?user=${encodeURIComponent(this.lastfmUser)}`;
        const message = Soup.Message.new('GET', url);

        try {
            const response = await new Promise((resolve, reject) => {
                this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        if (!bytes) throw new Error('No data received');
                        resolve(ByteArray.toString(bytes.get_data()));
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            const data = JSON.parse(response);
            if (data.tracks?.[0]) {
                const track = data.tracks[0];

                // Ensure timestamp is properly formatted
                track.timestamp = this._formatTimestamp(track.timestamp);

                return track;
            }
            return null;
        } catch (error) {
            global.logError(`LastFm Data Fetch Error: ${error.message}`);
            return null;
        }
    }

    _formatTimestamp(timestamp) {
        if (!timestamp) return "Unknown time";

        const trackDate = new Date(timestamp);
        if (isNaN(trackDate.getTime())) {
            global.logError(`Invalid timestamp: ${timestamp}`);
            return "Unknown time";
        }

        const now = new Date();
        const diff = now - trackDate;

        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

        return trackDate.toLocaleDateString();
    }

    _updateLabels(trackText, artistText) {
        this.trackLabel.set_text(trackText);
        this.artistLabel.set_text(artistText);
    }

    _updateUI(track) {
        this._updateLabels(
            track.title || "Unknown Track",
            track.artist ? `by ${track.artist}` : ""
        );

        // Ensure the timestampLabel is updated with the correct timestamp
        this.timestampLabel.set_text(track.timestamp || "");

        if (track.coverArt) {
            this._setAlbumArt(track.coverArt);
        } else {
            this._setDefaultBackground();
        }

        if (track.userImage) {
            this._updateProfileImage(track.userImage);
        }
    }

    async _setAlbumArt(url) {
        try {
            const filePath = await this._fetchAlbumArt(url);
            this._currentArtPath = filePath;
            this._applyBackground(filePath);
        } catch (error) {
            global.logError(`Album Art Error: ${error.message}`);
            this._setDefaultBackground();
        }
    }

    _applyBackground(filePath) {
        this.layout.set_style(`
        background-image: url("file://${filePath}");
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        min-width: 400px;
        min-height: 200px;
        border-radius: 12px;
        `);
    }

    _setDefaultBackground() {
        this.layout.set_style(`
        background: linear-gradient(45deg, #1a1a1a, #2a2a2a);
        min-width: 400px;
        min-height: 200px;
        border-radius: 12px;
        `);
    }

    async _updateProfileImage(url) {
        if (!url) {
            this.profileImage.set_icon_name('avatar-default');
            return;
        }

        try {
            const filePath = await this._fetchAlbumArt(url);
            this.profileImage.set_gicon(Gio.icon_new_for_string(filePath));
        } catch (error) {
            this.profileImage.set_icon_name('avatar-default');
        }
    }

    async _fetchAlbumArt(url) {
        const timestamp = Date.now();
        const filePath = `${GLib.get_tmp_dir()}/lastfm_cover_${timestamp}.jpg`;
        const message = Soup.Message.new('GET', url);

        try {
            const data = await new Promise((resolve, reject) => {
                this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        if (!bytes) throw new Error('No image data received');
                        resolve(bytes.get_data());
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            const file = Gio.File.new_for_path(filePath);
            const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
            stream.write_all(data, null);
            stream.close(null);

            if (this._currentArtPath && this._currentArtPath !== filePath) {
                this._deleteFile(this._currentArtPath);
            }

            return filePath;
        } catch (error) {
            throw new Error(`Failed to fetch album art: ${error.message}`);
        }
    }

    _deleteFile(path) {
        try {
            const file = Gio.File.new_for_path(path);
            file.delete(null);
        } catch (error) {
            global.logError(`Failed to delete file ${path}: ${error.message}`);
        }
    }

    on_desklet_removed() {
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
        }
        if (this._currentArtPath) {
            this._deleteFile(this._currentArtPath);
        }
    }
}

function main(metadata, desklet_id) {
    return new LastFmDesklet(metadata, desklet_id);
}
