const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Gst = imports.gi.Gst;
const GstPbutils = imports.gi.GstPbutils;
const Clutter = imports.gi.Clutter;
const Tooltips = imports.ui.tooltips;
const Cairo = imports.cairo;

const DEFAULT_DIR = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_MUSIC);
const AUDIO_EXT = ['.wav', '.ogg', '.mp3', '.oga', '.flac', '.m4a', '.aac', '.wma', '.aiff'];

const STANDARD_ART_SIZE = 108;
const MINIMAL_ART_SIZE = 72;
const SMALL_BUTTON_SIZE = 16;

function CinampDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

CinampDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.currentTrackArtist = '';
        this.currentTrackTitle = '';

        Gst.init(null);
        GstPbutils.pb_utils_init();

        this.music_dir = DEFAULT_DIR;
        this.showAlbumArt = true;
        this.showPlaylist = true;
        this.shuffle = false;
        this.repeat = 0;
        this.isMinimal = false;
        this.volume = 0.7;

        this.totalTracks = 0;
        this.totalDuration = 0;

        this.showVisualizer = false;
        this.visTimeout = null;
        this.visTick = 0;
        this.visBars = 16;
        this.visPeak = new Array(this.visBars).fill(0.02);
        this.visRmsData = 0.0;
        this.levelElement = null;

        this.visDecayRate = 0.20;
        this.visPeakFactor = 0.9;
        this.visSensitivity = 1.0;
        this.visBassBoost = 1.5;
        this.visUpdateRate = 0.05;

        this.minModeRef = null;
        this.volumeSlider = null;
        this.progressBar = null;
        this.playlistRef = null;
        this.shuffleRef = null;
        this.repeatRef = null;
        this.playRef = null;
        this.visRef = null;
        this.drawingArea = null;
        this.startWithVisualizer = false;
        this.box = null;
        this.albumArt = null;

        this.isPlaying = false;
        this.isPaused = false;
        this.player = null;
        this.bus = null;
        this.discoverer = null;
        this.playlist = [];
        this.currentIdx = -1;
        this.progressTimeout = null;
        this.inProgressUpdate = false;
        this.currentCoverPath = null;
        this.seekTimeout = null;

        this._buildUI();

        try {
            this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
            this.settings.bind("music-dir", "music_dir", this._onMusicDirChanged);
            this.settings.bind("volume", "volume", this._onSettingsVolumeChanged);
            this.settings.bind("show-album-art", "showAlbumArt", this._onShowArtChanged);
            this.settings.bind("show-playlist", "showPlaylist", this._onShowPlaylistChanged);
            this.settings.bind("shuffle", "shuffle", this._updateShuffleUI);
            this.settings.bind("repeat-mode", "repeat", this._updateRepeatUI);
            this.settings.bind("minimal-mode", "isMinimal", this._updateMinimalModeUI);
            this.settings.bind("start-with-visualizer", "startWithVisualizer", this._applyInitialVisualizerState);

            this.settings.bind("vis-bass-boost", "visBassBoost");
            this.settings.bind("vis-decay-rate", "visDecayRate");
            this.settings.bind("vis-peak-factor", "visPeakFactor");
            this.settings.bind("vis-update-rate", "visUpdateRate", this._restartVisualizerLoop);

            this._normalizeMusicDir();
        } catch (e) {
            global.logError("Settings init failed: " + e);
        }

        this._updateMinimalModeUI();

       Mainloop.idle_add(Lang.bind(this, function() {
            if (this.showPlaylist) {
                this._reorientPlaylist();
            }
            this._ensureDeskletOnScreen();
            this._scanMusicDir();
            return false;
        }));

        this._applyInitialVisualizerState();
    },

    _applyInitialVisualizerState: function() {
        this.showVisualizer = this.startWithVisualizer && this.showAlbumArt;
        if (this.showVisualizer) {
            if (this.albumArt) this.albumArt.hide();
            if (this.drawingArea) this.drawingArea.show();
            if(this.visRef) {
                this.visRef.icon.icon_name = 'image-x-generic-symbolic';
                if(this.visRef.tooltip) this.visRef.tooltip.set_text("Switch to Cover Art");
                this.visRef.btn.add_style_pseudo_class('active');
            }
            this._startVisualizerLoop();
        } else {
            if (this.albumArt) this.albumArt.show();
            if (this.drawingArea) this.drawingArea.hide();
            if(this.visRef) {
                this.visRef.icon.icon_name = 'utilities-system-monitor-symbolic';
                if(this.visRef.tooltip) this.visRef.tooltip.set_text("Switch to Visualizer (Graph)");
                this.visRef.btn.remove_style_pseudo_class('active');
            }
            this._stopVisualizerLoop();
        }
    },

    _onMusicDirChanged: function() {
        this._normalizeMusicDir();
        this._refresh();
    },

    _onSettingsVolumeChanged: function() {
        if (this.volumeAdjustment && Math.abs(this.volumeAdjustment.value - this.volume) > 0.01) {
            this.volumeAdjustment.value = this.volume;
        }
    },

    _createBtn: function(iconName, callback, tooltipText, size = 0) {
        let iconSize = size > 0 ? size - 4 : 14;
        let icon = new St.Icon({ icon_name: iconName, style_class: 'cinamp-button-icon', icon_size: iconSize });
        let btn = new St.Button({
            style_class: 'button cinamp-icon-button',
            child: icon,
            reactive: true,
            track_hover: true,
            can_focus: true
        });

        if (size > 0) {
            btn.style = `min-width: ${size}px; min-height: ${size}px; padding: 2px;`;
        }

        let tooltipObj = new Tooltips.Tooltip(btn, tooltipText || "");

        if (callback && typeof callback === 'function') {
            btn.connect('clicked', Lang.bind(this, callback));
        }
        return { btn: btn, icon: icon, tooltip: tooltipObj };
    },

    _buildUI: function() {
        this.box = new St.BoxLayout({ vertical: true, style_class: 'cinamp-container' });
        this.setContent(this.box);

        this.prevRef    = this._createBtn('media-skip-backward-symbolic', this._prevTrack, "Previous");
        this.playRef    = this._createBtn('media-playback-start-symbolic', this._togglePlayPause, "Play");
        this.stopRef    = this._createBtn('media-playback-stop-symbolic', this._stop, "Stop");
        this.nextRef    = this._createBtn('media-skip-forward-symbolic', this._nextTrack, "Next");

        this.shuffleRef = this._createBtn('media-playlist-shuffle-symbolic', this._toggleShuffle, "Shuffle Off");
        this.repeatRef  = this._createBtn('media-playlist-repeat-symbolic', this._toggleRepeat, "Repeat Off");
        this.visRef     = this._createBtn('utilities-system-monitor-symbolic', this._toggleVisualizer, "Switch to Visualizer (Graph)");
        this.playlistRef = this._createBtn('view-list-symbolic', this._togglePlaylist, "Show Playlist");
        this.minModeRef = this._createBtn('view-restore-symbolic', this._toggleMinimalModeSetting, "Minimal Mode", SMALL_BUTTON_SIZE);
        this.closeRef = this._createBtn('window-close-symbolic', this.destroy, "Close Desklet", SMALL_BUTTON_SIZE);

        this.topBar = new St.BoxLayout({ style_class: 'cinamp-top-bar' });
        this.box.add(this.topBar);
        this.topBar.add(this.minModeRef.btn);

        this.titleLabel = new St.Label({
            text: "Cinamp",
            style_class: 'cinamp-title',
            x_align: Clutter.ActorAlign.CENTER
        });
        this.topBar.add(this.titleLabel, { expand: true });
        this.topBar.add(this.closeRef.btn);

        this.playerSection = new St.BoxLayout({ style_class: 'cinamp-player-section' });
        this.box.add(this.playerSection);

        this.artBox = new St.BoxLayout({ vertical: true, style_class: 'cinamp-art-box' });
        this.playerSection.add(this.artBox);

        this.artStack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            width: STANDARD_ART_SIZE,
            height: STANDARD_ART_SIZE
        });
        this.artBox.add(this.artStack);

        this.albumArt = new St.Icon({
            icon_size: STANDARD_ART_SIZE,
            icon_name: 'audio-x-generic',
            style_class: 'cinamp-album-art'
        });
        this.artStack.add_child(this.albumArt);

        this.drawingArea = new St.DrawingArea({
            width: STANDARD_ART_SIZE,
            height: STANDARD_ART_SIZE,
            visible: false,
            style_class: 'cinamp-visualizer'
        });
        this.drawingArea.connect('repaint', Lang.bind(this, this._onDrawVisualizer));
        this.artStack.add_child(this.drawingArea);

        this.controlsBox = new St.BoxLayout({ vertical: true, style_class: 'cinamp-controls-box' });
        this.playerSection.add(this.controlsBox, { expand: true });

        this.status = new St.Label({ text: "Ready", style_class: 'cinamp-status' });
        this.controlsBox.add(this.status);

        this.volumeBox = new St.BoxLayout({ style_class: 'cinamp-slider-box' });
        this.controlsBox.add(this.volumeBox);

        this.volumeLabel = new St.Label({ text: "Volume", style_class: 'cinamp-control-label' });
        this.volumeBox.add(this.volumeLabel);

        this.volumeAdjustment = new St.Adjustment({ value: this.volume, lower: 0, upper: 1, step_increment: 0.05 });
        this.volumeSlider = new St.ScrollBar({ adjustment: this.volumeAdjustment });
        this.volumeAdjustment.connect('notify::value', Lang.bind(this, function(adj) {
            if (this.player) this.player.volume = adj.value;
            this.volume = adj.value;
            this.settings.setValue("volume", this.volume);
        }));
        this.volumeBox.add(this.volumeSlider, { expand: true });

        this.progressBox = new St.BoxLayout({ style_class: 'cinamp-slider-box' });
        this.controlsBox.add(this.progressBox);

        this.progressLabel = new St.Label({ text: "Progress", style_class: 'cinamp-control-label' });
        this.progressBox.add(this.progressLabel);

        this.progressAdjustment = new St.Adjustment({ value: 0, lower: 0, upper: 1, step_increment: 0.01 });
        this.progressBar = new St.ScrollBar({ adjustment: this.progressAdjustment });
        this.progressAdjustment.connect('notify::value', Lang.bind(this, this._seekTo));
        this.progressBox.add(this.progressBar, { expand: true });

        this.buttonBox = new St.BoxLayout({ style_class: 'cinamp-button-box' });
        this.controlsBox.add(this.buttonBox);

        [
            this.prevRef, this.playRef, this.stopRef, this.nextRef,
            this.shuffleRef, this.repeatRef, this.visRef, this.playlistRef
        ].forEach(function(ref) {
            this.buttonBox.add(ref.btn);
        }, this);

        this.infoLabel = new St.Label({ text: "Scanning…", style_class: 'cinamp-info' });
        this.box.add(this.infoLabel);

        this.playlistContainer = new St.BoxLayout({ vertical: true, style_class: 'cinamp-playlist-container' });

        this.scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            style_class: 'cinamp-scroll'
        });

        this.listBox = new St.BoxLayout({ vertical: true, style_class: 'cinamp-list-box' });
        this.scroll.add_actor(this.listBox);

        Mainloop.idle_add(Lang.bind(this, function() {
            if (this.scroll.vscroll && this.scroll.vscroll.adjustment) {
                this.scroll.vscroll.adjustment.connect('notify::value', Lang.bind(this, this._updatePlaylistReactivity));
            }
            return false;
        }));

        this.playlistContainer.add(this.scroll);

        this._updatePlaylistToggleUI();
        this._onShowArtChanged();
        this._updateShuffleUI();
        this._updateRepeatUI();

        if (this.showPlaylist) {
            this._reorientPlaylist();
        }
        this._applyInitialVisualizerState();
    },

    _toggleVisualizer: function() {
        this.showVisualizer = !this.showVisualizer;
        if (this.showVisualizer) {
            this.albumArt.hide();
            this.drawingArea.show();
            if(this.visRef) {
                this.visRef.icon.icon_name = 'image-x-generic-symbolic';
                if(this.visRef.tooltip) this.visRef.tooltip.set_text("Switch to Cover Art");
                this.visRef.btn.add_style_pseudo_class('active');
            }
            this._startVisualizerLoop();
        } else {
            this.drawingArea.hide();
            this.albumArt.show();
            if(this.visRef) {
                this.visRef.icon.icon_name = 'utilities-system-monitor-symbolic';
                if(this.visRef.tooltip) this.visRef.tooltip.set_text("Switch to Visualizer (Graph)");
                this.visRef.btn.remove_style_pseudo_class('active');
            }
            this._stopVisualizerLoop();
        }
    },

    _restartVisualizerLoop: function() {
        if (this.showVisualizer) {
            this._startVisualizerLoop();
        }
    },

    _startVisualizerLoop: function() {
        if (this.visTimeout) Mainloop.source_remove(this.visTimeout);

        let interval = Math.floor(this.visUpdateRate * 1000);
        if (interval < 20) interval = 20;

        this.visTimeout = Mainloop.timeout_add(interval, Lang.bind(this, function() {
            if (!this.player || this.isPaused) return true;
            if (this.showVisualizer) {
                this.drawingArea.queue_repaint();
                return true;
            }
            return false;
        }));
    },

    _stopVisualizerLoop: function() {
        if (this.visTimeout) {
            Mainloop.source_remove(this.visTimeout);
            this.visTimeout = null;
        }
    },

    _onDrawVisualizer: function(area) {
        let [width, height] = area.get_surface_size();
        let cr = area.get_context();

        this.visTick++;

        cr.setSourceRGBA(0.1, 0.1, 0.15, 1);
        cr.rectangle(0, 0, width, height);
        cr.fill();

        const GRAVITY = this.visDecayRate;
        const VIS_SENSITIVITY = this.visSensitivity;
        const BASS_BOOST = this.visBassBoost;
        const NOISE_FACTOR = this.visPeakFactor;

        let bars = this.visBars;
        let gap = 2;
        let barWidth = (width - (gap * (bars - 1))) / bars;

        let currentRms = this.visRmsData;

        if (currentRms < 0.02) {
            currentRms = 0;
        }

        let processedRms = Math.pow(currentRms, 1.5);

        for (let i = 0; i < bars; i++) {
            this.visPeak[i] -= GRAVITY;

            if (!this.isPlaying || this.isPaused) {
                 this.visPeak[i] -= 0.1;
            }

            if (this.visPeak[i] < 0) this.visPeak[i] = 0;

            if (this.isPlaying && !this.isPaused && processedRms > 0) {
                let barScale = i / (bars - 1);
                let bassPower = Math.pow(1.0 - barScale, 2.0);
                let spectrumCurve = 1.0 + (bassPower * (BASS_BOOST * 1.5));

                let drift = Math.sin((this.visTick * 0.1) + i) * 0.1;
                let noise = (Math.random() - 0.5) * (NOISE_FACTOR * 0.3);
                let separation = 1.0 + (Math.cos(i * 0.6) * 0.15);

                let targetPeak = processedRms * VIS_SENSITIVITY * spectrumCurve * (separation + drift + noise);
                this.visPeak[i] = Math.max(this.visPeak[i], targetPeak);
            }

            let finalHeightFactor = Math.max(this.visPeak[i], 0.02);
            finalHeightFactor = Math.min(finalHeightFactor, 1.0);

            let targetHeight = finalHeightFactor * (height * 0.95);
            let pat = new Cairo.LinearGradient(0, height, 0, 0);

            const R = 100/255;
            const G = 181/255;
            const B = 246/255;

            pat.addColorStopRGBA(1, R, G, B, 0.9);
            pat.addColorStopRGBA(0, R, G, B, 0.5);

            cr.setSource(pat);
            let xPos = i * (barWidth + gap);
            let yPos = height - targetHeight;

            if (targetHeight > 0) {
                cr.rectangle(xPos, yPos, barWidth, targetHeight);
                cr.fill();

                cr.setSourceRGBA(R + 0.1, G + 0.1, B + 0.1, 1.0);
                cr.rectangle(xPos, yPos - 2, barWidth, 2);
                cr.fill();
            }
        }
        cr.$dispose();
    },

    _normalizeMusicDir: function () {
        let raw = this.settings ? this.settings.getValue("music-dir") : "";
        let path = (raw || "").toString().trim();

        if (path.startsWith('file:///')) {
            path = path.replace('file:///', '/');
        }

        if (!path) path = DEFAULT_DIR;
        else path = path.replace(/^~\//, GLib.get_home_dir() + '/');

        try {
            path = GLib.canonicalize_filename(path, null);
            if (!GLib.file_test(path, GLib.FileTest.EXISTS | GLib.FileTest.IS_DIR)) {
                path = DEFAULT_DIR;
                if (this.settings) this.settings.setValue("music-dir", DEFAULT_DIR);
            }
        } catch (e) {
             path = DEFAULT_DIR;
        }
        this.music_dir = path;
    },

    _toggleMinimalModeSetting: function() {
        if (this.settings) {
            this.settings.setValue("minimal-mode", !this.isMinimal);
            this._updateMinimalModeUI();
        }
    },

    _updateMinimalModeUI: function() {
        if (!this.minModeRef || !this.volumeSlider || !this.progressBar || !this.artStack) return;

        if (this.isMinimal) {
            this.infoLabel.hide();
            this.volumeLabel.hide();
            this.progressLabel.hide();
            this.artBox.hide();  
            this.volumeSlider.hide();
            this.progressBar.hide();
            this.visRef.btn.hide();  
            this.stopRef.btn.hide();  

            this.minModeRef.icon.icon_name = 'view-fullscreen-symbolic';
            if(this.minModeRef.tooltip) this.minModeRef.tooltip.set_text("Standard Mode");

            this.controlsBox.vertical = false;
            this.controlsBox.style_class = 'cinamp-controls-box minimal';
            this.playerSection.style_class = 'cinamp-player-section minimal';
            this.box.style_class = 'cinamp-container minimal';

            this.controlsBox.remove_all_children();
            this.controlsBox.add(this.status, { expand: true });
            this.controlsBox.add(this.progressBox);
            this.controlsBox.add(this.volumeBox);
            this.controlsBox.add(this.buttonBox);

            this.topBar.add_style_class_name('minimal');

        } else {
            this.titleLabel.show();
            this.infoLabel.show();
            this.volumeLabel.show();
            this.progressLabel.show();
            this.artBox.show();
            
            this.visRef.btn.show();
            this.stopRef.btn.show();
            this.volumeSlider.show();
            this.progressBar.show();
            
            this.progressBox.remove_all_children();
            this.progressBox.add(this.progressLabel);
            this.progressBox.add(this.progressBar, { expand: true });

            this.minModeRef.icon.icon_name = 'view-restore-symbolic';
            if(this.minModeRef.tooltip) this.minModeRef.tooltip.set_text("Minimal Mode");

            this.volumeSlider.remove_style_class_name('cinamp-minimal-slider');
            this.progressBar.remove_style_class_name('cinamp-minimal-slider');

            this.controlsBox.vertical = true;
            this.controlsBox.style_class = 'cinamp-controls-box';
            this.playerSection.style_class = 'cinamp-player-section';
            this.box.style_class = 'cinamp-container';

            this.controlsBox.remove_all_children();
            this.controlsBox.add(this.status);
            this.controlsBox.add(this.volumeBox);
            this.controlsBox.add(this.progressBox);
            this.controlsBox.add(this.buttonBox);

            this.topBar.remove_style_class_name('minimal');
        }

        let artSize = this.isMinimal ? MINIMAL_ART_SIZE : STANDARD_ART_SIZE;
        this.artStack.set_size(artSize, artSize);
        this.albumArt.set_icon_size(artSize);
        this.drawingArea.set_size(artSize, artSize);

        this._reorientPlaylist();
        this._updateStatusAndScroll();
        this._ensureDeskletOnScreen();
    },

    _onShowArtChanged: function () {
        if (!this.showAlbumArt) {
            this.artStack.hide();
            this._stopVisualizerLoop();
        } else {
            this.artStack.show();
            if(this.showVisualizer) {
                 this.albumArt.hide();
                 this.drawingArea.show();
                 this._startVisualizerLoop();
            } else {
                 this.drawingArea.hide();
                 this.albumArt.show();
            }
        }
        if (this.showAlbumArt && this.currentIdx >= 0) this._loadAlbumArtForCurrent();
    },

    _updatePlaylistToggleUI: function() {
        if (!this.playlistRef) return;
        if (this.showPlaylist) {
            if(this.playlistRef.tooltip) this.playlistRef.tooltip.set_text("Hide Playlist");
            this.playlistRef.btn.add_style_pseudo_class('active');
        } else {
            this.playlistRef.icon.icon_name = 'view-list-symbolic';
            if(this.playlistRef.tooltip) this.playlistRef.tooltip.set_text("Show Playlist");
            this.playlistRef.btn.remove_style_pseudo_class('active');
        }
    },

    _togglePlaylist: function () {
        this.showPlaylist = !this.showPlaylist;
        this.settings.setValue("show-playlist", this.showPlaylist);
        this._onShowPlaylistChanged();
    },

    _updatePlaylistReactivity: function() {
        let vadjust = this.scroll.vscroll.adjustment;
        if (!vadjust || !this.showPlaylist || !this.playlistContainer.visible) return;

        let viewportTop = vadjust.value;
        let pageSize = vadjust.page_size;
        let viewportBottom = viewportTop + pageSize;

        let children = this.listBox.get_children();
        for (let i = 0; i < children.length; i++) {
            let btn = children[i];
            if (btn instanceof St.Button) {
                let box = btn.get_allocation_box();
                let isVisible = (box.y2 > viewportTop) && (box.y1 < viewportBottom);
                if (btn.reactive !== isVisible) {
                    btn.reactive = isVisible;
                }
            }
        }
    },

    _onShowPlaylistChanged: function () {
        this._updatePlaylistToggleUI();
        this._reorientPlaylist();
    },

    _reorientPlaylist: function() {
        if (!this.box) return;

        if (this.playlistContainer.get_parent()) {
            this.box.remove_actor(this.playlistContainer);
        }

        if (!this.showPlaylist) {
            this.playlistContainer.hide();
            if (this.playlistRef) this.playlistRef.icon.icon_name = 'view-list-symbolic';
            this._ensureDeskletOnScreen();
            return;
        }

        this.playlistContainer.show();

        let [x, y] = this.actor.get_transformed_position();
        let screenHeight = global.screen_height;
        let playlistAtTop = (y > 0) && (y > screenHeight / 2);

        if (playlistAtTop) {
            this.box.insert_child_at_index(this.playlistContainer, 0);
            if (this.playlistRef) this.playlistRef.icon.icon_name = 'go-up-symbolic';
        } else {
            let children = this.box.get_children();
            let index = children.length - 1;

            this.box.insert_child_at_index(this.playlistContainer, index);
            if (this.playlistRef) this.playlistRef.icon.icon_name = 'go-down-symbolic';
        }
        
        Mainloop.idle_add(Lang.bind(this, function() {
            this._updatePlaylistReactivity();
            this._ensureDeskletOnScreen();
            return false;
        }));
    },

    _ensureDeskletOnScreen: function() {
        if (!this.actor.visible) return;

        let [x, y] = this.actor.get_transformed_position();
        let [width, height] = this.actor.get_size();
        let screenWidth = global.screen_width;
        let screenHeight = global.screen_height;
        
        let newX = x;
        let newY = y;

        if (x + width > screenWidth) {
            newX = Math.max(0, screenWidth - width);
        }
        if (x < 0) {
            newX = 0;
        }
        if (y + height > screenHeight) {
            newY = Math.max(0, screenHeight - height);
        }
        if (y < 0) {
            newY = 0;
        }

        if (newX !== x || newY !== y) {
            this.actor.set_position(newX, newY);
        }
    },

    _updateShuffleUI: function () {
        if (!this.shuffleRef) return;
        let text = this.shuffle ? "Shuffle On" : "Shuffle Off";
        if(this.shuffleRef.tooltip) this.shuffleRef.tooltip.set_text(text);

        if (this.shuffle) {
            this.shuffleRef.btn.add_style_pseudo_class('active');
        } else {
            this.shuffleRef.btn.remove_style_pseudo_class('active');
        }
    },

    _toggleShuffle: function () {
        this.shuffle = !this.shuffle;
        this.settings.setValue("shuffle", this.shuffle);
        this._updateShuffleUI();
    },

    _updateRepeatUI: function () {
        if (!this.repeatRef) return;
        let tooltips = ["Repeat Off", "Repeat All", "Repeat One"];
        if(this.repeatRef.tooltip) this.repeatRef.tooltip.set_text(tooltips[this.repeat]);

        this.repeatRef.icon.icon_name = (this.repeat === 2) ? 'media-playlist-repeat-song-symbolic' : 'media-playlist-repeat-symbolic';
        if (this.repeat > 0) {
            this.repeatRef.btn.add_style_pseudo_class('active');
        } else {
            this.repeatRef.btn.remove_style_pseudo_class('active');
        }
    },

    _toggleRepeat: function () {
        this.repeat = (this.repeat + 1) % 3;
        this.settings.setValue("repeat-mode", this.repeat);
        this._updateRepeatUI();
    },

    _scanMusicDir: function () {
        this.infoLabel.text = "Scanning " + this.music_dir + "…";
        this._clearPlaylistUI();
        this.playlist = [];

        let dir = Gio.File.new_for_path(this.music_dir);
        if (!dir.query_exists(null)) {
            this.infoLabel.text = "Folder not found: " + this.music_dir;
            this._disableAllButtons();
            this.status.text = "Error";
            return;
        }

        let scanFolder = Lang.bind(this, function(folder) {
            let enumerator;
            try {
                enumerator = folder.enumerate_children('standard::name,standard::type', 0, null);
            } catch (e) { return; }

            let info;
            while ((info = enumerator.next_file(null))) {
                let type = info.get_file_type();
                let childName = info.get_name();
                let childFile = folder.get_child(childName);

                if (type === Gio.FileType.DIRECTORY) {
                    scanFolder(childFile);
                } else if (type === Gio.FileType.REGULAR) {
                    let nameLower = childName.toLowerCase();
                    if (AUDIO_EXT.some(ext => nameLower.endsWith(ext))) {
                        this.playlist.push(childFile.get_path());
                    }
                }
            }
        });

        try {
            scanFolder(dir);
        } catch(e) {
            global.logError("Cinamp Scan Error: " + e);
        }

        this.playlist.sort();

        if (this.playlist.length === 0) {
            this.infoLabel.text = "No audio files";
            this._disableAllButtons();
            this.status.text = "Empty";
            this.currentIdx = -1;
        } else {
            this.infoLabel.text = this.playlist.length + " track" + (this.playlist.length > 1 ? "s" : "") + " loaded";
            this._buildPlaylistUI();
            this._enableAllButtons();
            this.currentIdx = 0;
            this._updateStatusAndScroll();
            this._loadAlbumArtForCurrent();
        }

        this.totalTracks = this.playlist.length;
        this._updateInfoLabel();
    },

    _updateInfoLabel: function() {
        if (!this.infoLabel) return;

        if (this.totalTracks > 0) {
            this.infoLabel.text = `Tracks: ${this.totalTracks}`;
        } else {
            this.infoLabel.text = "No tracks found";
        }
    },

    _clearPlaylistUI: function () {
        this.listBox.destroy_all_children();
    },

    _buildPlaylistUI: function () {
        this._clearPlaylistUI();
        for (let i = 0; i < this.playlist.length; i++) {
            let name = this.playlist[i].split('/').pop();
            let label = new St.Label({
                text: (i + 1) + ". " + name,
                style_class: "cinamp-playlist-label"
            });

            let btn = new St.Button({
                reactive: true,
                track_hover: true,
                style_class: 'playlist-item',
                child: label
            });

            btn._trackIndex = i;
            btn.connect('clicked', Lang.bind(this, function (b) {
                this._startNewTrack(b._trackIndex, false); 
            }));

            this.listBox.add(btn);
        }
        this._updatePlaylistReactivity();
    },

    _highlightCurrentTrack: function () {
        let children = this.listBox.get_children();
        for (let i = 0; i < children.length; i++) {
            let btn = children[i];
            if (i === this.currentIdx) btn.add_style_pseudo_class('active');
            else btn.remove_style_pseudo_class('active');
        }
    },

    _scrollToCurrentTrack: function () {
        if (this.currentIdx < 0 || this.listBox.get_n_children() === 0) return;
        if (!this.showPlaylist || !this.playlistContainer.visible) return;

        let trackActor = this.listBox.get_children()[this.currentIdx];
        if (!trackActor) return;

        let vadjust = this.scroll.vscroll.adjustment;
        let pageSize = vadjust.page_size;
        let box = trackActor.get_allocation_box();

        if (box.y1 == 0 && box.y2 == 0 && this.currentIdx > 0) return;

        let top = box.y1;
        let bottom = box.y2;

        if (bottom > vadjust.value + pageSize) {
            vadjust.value = bottom - pageSize;
        } else if (top < vadjust.value) {
            vadjust.value = top;
        }
    },

    _updateStatusAndScroll: function () {
        if (this.playlist.length === 0 || this.currentIdx < 0) {
            this.status.text = "No tracks";
            return;
        }
        let displayName = this.currentTrackArtist ? `${this.currentTrackArtist} - ${this.currentTrackTitle}` : this.currentTrackTitle;
        let state = this.isPaused ? "Paused" : (this.isPlaying ? "Playing" : "Stopped");

        if (this.isMinimal) {
            this.status.text = displayName;
            this.status.style_class = 'cinamp-status minimal';
        } else {
            this.status.text = `${this.currentIdx + 1}/${this.playlist.length} – ${displayName} [${state}]`;
            this.status.style_class = 'cinamp-status';
        }

        this._highlightCurrentTrack();
        Mainloop.idle_add(Lang.bind(this, this._scrollToCurrentTrack));
    },

    _disableAllButtons: function () {
        [this.prevRef.btn, this.playRef.btn, this.stopRef.btn, this.nextRef.btn, this.shuffleRef.btn, this.repeatRef.btn].forEach(b => b.reactive = false);
    },

    _enableAllButtons: function () {
        [this.prevRef.btn, this.playRef.btn, this.stopRef.btn, this.nextRef.btn, this.shuffleRef.btn, this.repeatRef.btn].forEach(b => b.reactive = true);
    },

    _loadAlbumArtForCurrent: function (isNewTrack = false) {
        if (this.currentIdx < 0 || !this.showAlbumArt) {
            this.albumArt.icon_name = 'audio-x-generic';
            this.albumArt.set_gicon(null);
            return;
        }

        let file = this.playlist[this.currentIdx];
        let uri = GLib.filename_to_uri(file, null);

        if (this.discoverer) this.discoverer.stop();

        this.discoverer = new GstPbutils.Discoverer();
        this.discoverer.timeout = 5 * Gst.SECOND;
        this.discoverer.connect('discovered', Lang.bind(this, this._onDiscovered));
        this.discoverer.start();
        try {
            this.discoverer.discover_uri_async(uri, isNewTrack);
            
            this.currentTrackArtist = '';
            this.currentTrackTitle = file.split('/').pop();
            this._updateStatusAndScroll();
            
        } catch (e) {
            global.logError("Discoverer start error: " + e);
            this.albumArt.icon_name = 'audio-x-generic';
            this.albumArt.set_gicon(null);
        }
    },

    _onDiscovered: function (discoverer, info, error) {
        if (error || !info || !info.get_tags()) {
            this.albumArt.icon_name = 'audio-x-generic';
            this.currentTrackArtist = '';
            this._updateStatusAndScroll(); 
            return;
        }

        let tags = info.get_tags();

        let [okArtist, artist] = tags.get_string(Gst.TAG_ARTIST);
        let [okTitle, title] = tags.get_string(Gst.TAG_TITLE);

        this.currentTrackArtist = okArtist ? artist : '';
        this.currentTrackTitle = okTitle ? title : this.playlist[this.currentIdx].split('/').pop();
        this._updateStatusAndScroll(); 
        
        let [ok, sample] = tags.get_sample_index(Gst.TAG_IMAGE, 0);
        if (!ok || !sample || !sample.get_buffer() || !sample.get_caps()) {
            this.albumArt.icon_name = 'audio-x-generic';
            return;
        }

        let caps = sample.get_caps();
        let mimeType = caps.get_structure(0).get_name();
        let extension = '';
        if (mimeType.includes('jpeg') || mimeType.includes('jpg')) extension = '.jpg';
        else if (mimeType.includes('png')) extension = '.png';
        else extension = '.img'; 
        
        let buffer = sample.get_buffer();
        let [mapped, map] = buffer.map(Gst.MapFlags.READ);
        if (!mapped) {
            this.albumArt.icon_name = 'audio-x-generic';
            return;
        }

        if (this.currentCoverPath && GLib.file_test(this.currentCoverPath, GLib.FileTest.EXISTS)) {
            GLib.unlink(this.currentCoverPath);
            this.currentCoverPath = null;
        }
        
        let tmpPath = GLib.build_filenamev([GLib.get_tmp_dir(), 'cinamp_cover_' + this.currentIdx + extension]);

        try {
            GLib.file_set_contents(tmpPath, map.data);
            
            let fileIcon = Gio.FileIcon.new(Gio.File.new_for_path(tmpPath));
            this.albumArt.set_gicon(fileIcon);
            this.albumArt.icon_name = null;

            this.currentCoverPath = tmpPath;
        } catch (e) {
            global.logError("Cover save error: " + e);
            this.albumArt.icon_name = 'audio-x-generic';
        } finally {
            buffer.unmap(map);
        }
    },

    _refresh: function () {
        this._stop();
        this.currentIdx = -1;
        this._scanMusicDir();
    },

    _startNewTrack: function (idx, seekToStart) {
        if (this.playlist.length === 0 || idx < 0 || idx >= this.playlist.length) return;

        this._stop();
        this.currentIdx = idx;

        this._loadAlbumArtForCurrent(true); 
        
        this._playCurrent(seekToStart);
    },

    _prevTrack: function () {
        if (this.playlist.length === 0) return;
        if (this.repeat === 2) {
            this._startNewTrack(this.currentIdx, true); 
            return;
        }
        if (this.shuffle) {
            this.currentIdx = Math.floor(Math.random() * this.playlist.length);
        } else {
            this.currentIdx = (this.currentIdx - 1 + this.playlist.length) % this.playlist.length;
        }
        this._startNewTrack(this.currentIdx, false);
    },

    _nextTrack: function () {
        if (this.playlist.length === 0) return;
        if (this.repeat === 2) {
            this._startNewTrack(this.currentIdx, true); 
            return;
        }
        if (this.shuffle) {
            this.currentIdx = Math.floor(Math.random() * this.playlist.length);
        } else {
            this.currentIdx = (this.currentIdx + 1) % this.playlist.length;
        }
        this._startNewTrack(this.currentIdx, false);
    },

    _togglePlayPause: function () {
        if (this.isPlaying) this._pause();
        else if (this.isPaused) this._resume();
        else this._startNewTrack(this.currentIdx, false);
    },

    _stop: function () {
        if (this.player) {
            this.levelElement = null;
            this.player.set_state(Gst.State.NULL);
            if (this.bus) {
                this.bus.remove_signal_watch();
                this.bus = null;
            }
            this.player = null;
        }
        if (this.discoverer) {
             this.discoverer.stop();
             this.discoverer = null;
        }

        this.isPlaying = false;
        this.isPaused = false;

        if (this.playRef) {
            this.playRef.icon.icon_name = 'media-playback-start-symbolic';
            if(this.playRef.tooltip) this.playRef.tooltip.set_text("Play");
        }

        this.progressAdjustment.value = 0;
        if (this.progressTimeout) {
            Mainloop.source_remove(this.progressTimeout);
            this.progressTimeout = null;
        }
        if (this.seekTimeout) {
            Mainloop.source_remove(this.seekTimeout);
            this.seekTimeout = null;
        }
        this._updateStatusAndScroll();

        if (this.drawingArea) this.drawingArea.queue_repaint();
        this._updateInfoLabel();
    },

    _playCurrent: function (seekToStart = false) {
        if (this.playlist.length === 0 || this.currentIdx < 0) return;

        let file = this.playlist[this.currentIdx];
        let uri = GLib.filename_to_uri(file, null);

        this.player = Gst.ElementFactory.make("playbin", "player");
        if (!this.player) {
            this.status.text = "Failed to create playbin";
            return;
        }

        let audio_bin = Gst.ElementFactory.make("bin", "audio-bin-with-level");
        let convert = Gst.ElementFactory.make("audioconvert", null);
        this.levelElement = Gst.ElementFactory.make("level", "vis-level");
        let sink = Gst.ElementFactory.make("autoaudiosink", null);

        if (!audio_bin || !convert || !this.levelElement || !sink) {
            this.status.text = "Missing GStreamer elements";
            this._stop();
            return;
        }

        this.levelElement.set_property("post-messages", true);
        this.levelElement.set_property("interval", 80000000); 

        audio_bin.add(convert);
        audio_bin.add(this.levelElement);
        audio_bin.add(sink);
        convert.link(this.levelElement);
        this.levelElement.link(sink);

        let pad = convert.get_static_pad("sink");
        let ghost = Gst.GhostPad.new("sink", pad);
        ghost.set_active(true);
        audio_bin.add_pad(ghost);

        audio_bin.set_property("message-forward", true);

        this.player.set_property("audio-sink", audio_bin);

        this.player.volume = this.volume;
        this.player.uri = uri;

        this.bus = this.player.get_bus();
        this.bus.add_signal_watch();
        this.bus.connect("message", Lang.bind(this, this._onBusMessage));

        let setPlayState = this.player.set_state(Gst.State.PLAYING);
        if (setPlayState === Gst.StateChangeReturn.FAILURE) {
            this.status.text = "Failed to set player to PLAYING state.";
            this._stop();
            return;
        }

        this.isPlaying = true;
        this.isPaused = false;
        if (this.playRef) {
            this.playRef.icon.icon_name = 'media-playback-pause-symbolic';
            this.playRef.tooltip.set_text("Pause");
        }

        this._updateStatusAndScroll();
        this._startProgressUpdates();

        if (seekToStart) {
            this.player.seek_simple(Gst.Format.TIME, Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT, 0);
        }
    },

    _pause: function () {
        if (this.player && this.isPlaying) {
            this.player.set_state(Gst.State.PAUSED);
            this.isPaused = true;
            this.isPlaying = false;
            if (this.playRef) {
                this.playRef.icon.icon_name = 'media-playback-start-symbolic';
                if(this.playRef.tooltip) this.playRef.tooltip.set_text("Play");
            }
            this._updateStatusAndScroll();
        }
    },

    _resume: function () {
        if (this.player && this.isPaused) {
            this.player.set_state(Gst.State.PLAYING);
            this.isPaused = false;
            this.isPlaying = true;
            if (this.playRef) {
                this.playRef.icon.icon_name = 'media-playback-pause-symbolic';
                if(this.playRef.tooltip) this.playRef.tooltip.set_text("Pause");
            }
            this._updateStatusAndScroll();
        }
    },

    _seekTo: function () {
        if (!this.player || this.inProgressUpdate) return;
        if (this.seekTimeout) Mainloop.source_remove(this.seekTimeout);

        this.seekTimeout = Mainloop.timeout_add(50, Lang.bind(this, function() {
            this.seekTimeout = null;

            if (!this.player) return;

            let [ok, duration] = this.player.query_duration(Gst.Format.TIME);
            if (!ok || duration <= 0) return;

            let progress = this.progressAdjustment.value;
            let position = progress * duration;

            this.player.seek_simple(Gst.Format.TIME, Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT, position);
        }));
    },

    _startProgressUpdates: function () {
        if (this.progressTimeout) Mainloop.source_remove(this.progressTimeout);
        this.progressTimeout = Mainloop.timeout_add(500, Lang.bind(this, function () {
            if (!this.player || !this.isPlaying) return true;
            let [ok, pos] = this.player.query_position(Gst.Format.TIME);
            let [ok2, dur] = this.player.query_duration(Gst.Format.TIME);
            if (ok && ok2 && dur > 0) {
                this.inProgressUpdate = true;
                this.progressAdjustment.value = pos / dur;
                this.inProgressUpdate = false;
            }
            return true;
        }));
    },

    _onBusMessage: function (bus, message) {
        if (message.type === Gst.MessageType.EOS) {
            this._trackFinished();
        } else if (message.type === Gst.MessageType.ERROR) {
            let [err, debug] = message.parse_error();
            global.logError("GStreamer error: " + err.message + (debug ? " (Debug: " + debug + ")" : ""));
            this._stop();
            this.status.text = "Error: " + err.message;
        } else if (message.type === Gst.MessageType.ELEMENT) {

            const struct = message.get_structure();

            if (struct && struct.get_name() === "level") {

                let str = struct.to_string();
                let dataArray = [];

                let match = str.match(/rms\s*=\s*\(GValueArray\)\s*<\s*([^>]+)\s*>/);

                if (match && match[1]) {
                    let parts = match[1].split(',');
                    for (let p of parts) {
                        let val = parseFloat(p.trim());
                        if (!isNaN(val)) {
                            dataArray.push(val);
                        }
                    }
                } else {
                    let monoMatch = str.match(/rms\s*=\s*\(double\)\s*([-\d\.]+)/);
                    if (monoMatch && monoMatch[1]) {
                        let val = parseFloat(monoMatch[1].trim());
                        if (!isNaN(val)) {
                            dataArray.push(val);
                        }
                    }
                }

                if (dataArray.length > 0) {
                    let sum = 0;
                    for (let db of dataArray) {
                        if (db < -100) sum += 0;
                        else sum += Math.pow(10, db / 20);
                    }

                    this.visRmsData = sum / dataArray.length;

                    if (this.showVisualizer && this.drawingArea) {
                        this.drawingArea.queue_repaint();
                    }
                }
            }
        }
    },

    _trackFinished: function () {
        this._stop();

        if (this.repeat === 2) {
            this._startNewTrack(this.currentIdx, true);
        } else if (this.repeat === 1 || this.shuffle || this.currentIdx < this.playlist.length - 1) {
            if (this.shuffle) {
                this.currentIdx = Math.floor(Math.random() * this.playlist.length);
            } else {
                this.currentIdx = (this.currentIdx + 1) % this.playlist.length;
            }
            this._startNewTrack(this.currentIdx, false);
        } else {
            this.currentIdx = 0;
            this._updateStatusAndScroll();
        }
    },

    on_desklet_moved: function() {
        if (!this.box) return;

        if (this.showPlaylist) {
            this._reorientPlaylist();
        }
        this._ensureDeskletOnScreen();
    }
};

function main(metadata, desklet_id) {
    return new CinampDesklet(metadata, desklet_id);
}
