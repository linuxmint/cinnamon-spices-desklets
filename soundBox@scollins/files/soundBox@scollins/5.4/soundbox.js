const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Tooltips = imports.ui.tooltips;

const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Cvc = imports.gi.Cvc;
const St = imports.gi.St;

const Cogl = imports.gi.Cogl;
const GdkPixbuf = imports.gi.GdkPixbuf;

const Interfaces = imports.misc.interfaces;
const Params = imports.misc.params;
const Util = imports.misc.util;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;

const SLIDER_SCROLL_STEP = 0.05;
const ICON_SIZE = 28;

const MEDIA_PLAYER_2_PATH = "/org/mpris/MediaPlayer2";
const MEDIA_PLAYER_2_NAME = "org.mpris.MediaPlayer2";
const MEDIA_PLAYER_2_PLAYER_NAME = "org.mpris.MediaPlayer2.Player";

const SUPPORT_SEEK = [
    "amarok",
    "audacious",
    "banshee",
    "clementine",
    "deadbeef",
    "gmusicbrowser",
    "gnome-mplayer",
    "noise",
    "pragha",
    "qmmp",
    "quodlibet",
    "rhythmbox",
    "rhythmbox3",
    "spotify",
    "vlc",
    "xnoise"
]


let settings, actionManager;
let normVolume, maxVolume;

const Gettext = imports.gettext;
const uuid = "soundBox@scollins";

Gettext.bindtextdomain(uuid, GLib.get_home_dir() + "/.local/share/locale")

function _(str) {
  return Gettext.dgettext(uuid, str);
}

function registerSystrayIcons(uuid) {
    if ( !Main.systrayManager ) {
        global.log("Soundbox: system tray icons were not hidden - this feature is not available in your version of Cinnamon");
        return;
    }
    for ( let player in SUPPORT_SEEK ) Main.systrayManager.registerRole(SUPPORT_SEEK[player], uuid);
}

function unregisterSystrayIcons(uuid) {
    if ( !Main.systrayManager ) return;
    Main.systrayManager.unregisterId(uuid);
}


/* Abstract Objects */
function ActionManager() {

}

ActionManager.prototype = {
    close: function() {
        this.emit("close");
    }
}
Signals.addSignalMethods(ActionManager.prototype);


function TimeTracker(server, prop, playerName) {
    this._init(server, prop, playerName);
}

TimeTracker.prototype = {
    _init: function(server, prop, playerName) {
        this.playerName = playerName;
        this.startCount = 0;
        this.totalCount = 0;
        this.state = "stopped";
        this.server = server;
        this.prop = prop;
        this.serverSeekedId = this.server.connectSignal("Seeked", Lang.bind(this, function(sender, value) {
            this.fetching = true;
            this.fetchPosition();
        }));

        Mainloop.timeout_add(1000, Lang.bind(this, this.fetchPosition));
    },

    destroy: function() {
        this.server.disconnectSignal(this.serverSeekedId);
    },

    //sets the total song length
    setTotal: function(total) {
        this.totalCount = total;
    },

    //gets the total song length
    getTotal: function() {
        return Math.floor(this.totalCount);
    },

    //sets the current elapsed time (in seconds)
    setElapsed: function(current) {
        this.startCount = current;
        if ( this.state == "playing" ) this.startTime = new Date(); //this is necessary if the timer is counting
    },

    //returns the current elapsed time in seconds
    getElapsed: function() {
        if ( this.fetching ) return -1;
        else if ( this.startTime ) return Math.floor((new Date() - this.startTime) / 1000) + this.startCount;
        else return this.startCount;
    },

    //reads and handles the requested postion
    readPosition: function(value) {
        if ( value == null && this.state != "stopped" ) this.updateSeekable(false);
        else {
            this.setElapsed(value / 1000000);
        }
        this.fetching = false;
    },

    //requests the time position
    fetchPosition: function() {
        this.prop.GetRemote(MEDIA_PLAYER_2_PLAYER_NAME, 'Position', Lang.bind(this, function(position, error) {
            if ( !error ) {
                this.readPosition(position[0].get_int64());
            }
        }));
    },

    start: function() {
        if ( this.state == "playing" ) return;
        this.startTime = new Date();
        this.state = "playing";
        this.emit("state-changed", this.state);
    },

    pause: function() {
        if ( !this.startTime ) return;
        this.startCount += (new Date() - this.startTime) / 1000;
        this.startTime = null;
        this.state = "paused";
        this.emit("state-changed", this.state);
    },

    stop: function() {
        this.startCount = 0;
        this.startTime = null;
        this.state = "stopped";
        this.emit("state-changed", this.state);
    },

    seek: function(seconds) {
        this.server.SetPositionRemote(this.trackId, seconds * 1000000);
    }
}
Signals.addSignalMethods(TimeTracker.prototype);


function GVCHandler(parent) {
    this._init(parent);
}

GVCHandler.prototype = {
    _init: function(parent) {
        this.parent = parent;
        this.apps = [];
        this.devices = [];

        this.volumeControl = new Cvc.MixerControl({ name: "Cinnamon Volume Control" });
        this.volumeControl.connect("state-changed", Lang.bind(this, this.controlStateChanged));
        this.volumeControl.connect("card-added", Lang.bind(this, this.controlStateChanged));
        this.volumeControl.connect("card-removed", Lang.bind(this, this.controlStateChanged));
        this.volumeControl.connect("default-sink-changed", Lang.bind(this, this.readOutput));
        this.volumeControl.connect("default-source-changed", Lang.bind(this, this.readInput));
        this.volumeControl.connect("output-added", Lang.bind(this, this.deviceAdded, "output"));
        this.volumeControl.connect("input-added", Lang.bind(this, this.deviceAdded, "input"));
        this.volumeControl.connect("output-removed", Lang.bind(this, this.deviceRemoved, "output"));
        this.volumeControl.connect("input-removed", Lang.bind(this, this.deviceRemoved, "input"));
        this.volumeControl.connect("active-output-update", Lang.bind(this, this.deviceUpdated, "output"));
        this.volumeControl.connect("active-input-update", Lang.bind(this, this.deviceUpdated, "input"));
        this.volumeControl.connect("stream-added", Lang.bind(this, this.reloadApps));
        this.volumeControl.connect("stream-removed", Lang.bind(this, this.reloadApps));

        normVolume = this.volumeControl.get_vol_max_norm();
        maxVolume = this.volumeControl.get_vol_max_amplified();
        this.volumeControl.open();
    },

    controlStateChanged: function() {
        if ( this.volumeControl.get_state() == Cvc.MixerControlState.READY ) {
            this.readOutput();
            this.readInput();
        }
    },

    deviceAdded: function(c, id, type) {
        let device = this.volumeControl["lookup_type_id".replace("type", type)](id);

        let deviceItem = new PopupMenu.PopupMenuItem(device.get_description());
        deviceItem.connect("activate", Lang.bind(this, function() {
            global.log("Default output set as " + device.get_description());
            this.volumeControl["change_" + type](device);
        }));
        deviceItem.addActor(new St.Label({ text: device.get_origin() }));
        this[type+"Devices"].addMenuItem(deviceItem);
        this.devices.push({ id: id, type: type, menuItem: deviceItem });

        this.checkMenuHideState(type);
    },

    deviceRemoved: function(c, id, type) {
        for ( let i in this.devices ) {
            let device = this.devices[i];
            if ( device.id == id && device.type == type ) {
                device.menuItem.destroy();
                this.devices.splice(i, 1);
                break;
            }
        }

        this.checkMenuHideState(type);
    },

    deviceUpdated: function(c, id, type) {
        for ( let device of this.devices ) device.menuItem.setShowDot(device.id == id && device.type == type);
    },

    checkMenuHideState: function(type) {
        if ( this[type+"Devices"].numMenuItems == 0 ) this.parent[type+"Section"].actor.hide();
        else this.parent[type+"Section"].actor.show();
    },

    readOutput: function() {
        this.output = this.volumeControl.get_default_sink();
        this.parent.outputVolumeDisplay.setControl(this.output);
    },

    readInput: function() {
        this.input = this.volumeControl.get_default_source();
        if ( this.input == null ) return;
        if ( settings.showInput ) this.parent.inputVolumeDisplay.setControl(this.input);
    },

    reloadApps: function () {
        for ( let i = 0; i < this.apps.length; i++ ) this.apps[i].destroy();
        this.parent.appBox.destroy_all_children();
        this.apps = [];
        let ids = [];

        let streams = this.volumeControl.get_sink_inputs();
        for ( let i = 0; i < streams.length; i++ ) {
            let output = streams[i];
            let id = output.get_application_id();
            if ( id != "org.Cinnamon" && ids.indexOf(id) == -1 ) {
                let divider = new Divider();
                this.parent.appBox.add_actor(divider.actor);

                let app = new AppControl(output);
                this.parent.appBox.add_actor(app.actor);
                this.apps.push(app);
                ids.push(id);
            }
        }
    },

    refresh: function() {
        this.readOutput();
        this.readInput();
        this.reloadApps();
    }
}


/* Widgets */
function SoundboxTooltip(actor, text) {
    this._init(actor, text);
}

SoundboxTooltip.prototype = {
    __proto__: Tooltips.Tooltip.prototype,

    _init: function(actor, text) {
        Tooltips.Tooltip.prototype._init.call(this, actor, text);
        this._tooltip.add_style_class_name(settings.theme+"-tooltip");
        settings.settings.connect("changed::theme", Lang.bind(this, function(provider, key, oldVal, newVal) {
            this._tooltip.remove_style_class_name(oldVal+"-tooltip");
            this._tooltip.add_style_class_name(newVal+"-tooltip");
        }));
    }
}


function Slider(value) {
    this._init(value);
}

Slider.prototype = {
    _init: function(value) {
        try {

            if (isNaN(value)) throw TypeError("The slider value must be a number");
            this._value = Math.max(Math.min(value, 1), 0);

            this.actor = new St.DrawingArea({ style_class: "soundbox-slider", reactive: true, track_hover: true });
            this.actor._delegate = this;
            this.actor.connect("repaint", Lang.bind(this, this._sliderRepaint));
            this.actor.connect("button-press-event", Lang.bind(this, this._startDragging));
            this.actor.connect("scroll-event", Lang.bind(this, this._onScrollEvent));

            this._releaseId = this._motionId = 0;
            this._dragging = false;

        } catch(e) {
            global.logError(e);
        }
    },

    setValue: function(value) {
        try {
            if ( this._dragging ) return;
            if ( isNaN(value) ) throw TypeError("The slider value must be a number");

            this._value = Math.max(Math.min(value, 1), 0);
            this.actor.queue_repaint();
        } catch(e) {
            global.logError(e);
        }
    },

    _sliderRepaint: function(area) {
        let cr = area.get_context();
        let themeNode = area.get_theme_node();
        let [width, height] = area.get_surface_size();

        //handle properties
        let handleRadius = themeNode.get_length("-slider-handle-radius");
        let handleHeight = themeNode.get_length("-slider-handle-height");
        let handleWidth = themeNode.get_length("-slider-handle-width");
        let handleColor = themeNode.get_color("-slider-handle-color");
        let handleBorderColor = themeNode.get_color("-slider-handle-border-color");
        let handleBorderWidth = themeNode.get_length("-slider-handle-border-width");

        //inactive properties
        let sliderBorderWidth = themeNode.get_length("-slider-border-width");
        let sliderHeight = themeNode.get_length("-slider-height");
        let sliderBorderColor = themeNode.get_color("-slider-border-color");
        let sliderColor = themeNode.get_color("-slider-background-color");

        //active properties
        let sliderActiveBorderColor = themeNode.get_color("-slider-active-border-color");
        let sliderActiveColor = themeNode.get_color("-slider-active-background-color");
        let sliderActiveBorderWidth = themeNode.get_length("-slider-active-border-width");
        let sliderActiveHeight = themeNode.get_length("-slider-active-height");

        //general properties
        let sliderWidth, start;
        if ( handleRadius == 0 ) {
            sliderWidth = width - handleWidth;
            start = handleWidth / 2;
        }
        else {
            sliderWidth = width - 2 * handleRadius;
            start = handleRadius;
        }

        cr.setSourceRGBA (
            sliderActiveColor.red / 255,
            sliderActiveColor.green / 255,
            sliderActiveColor.blue / 255,
            sliderActiveColor.alpha / 255);
        cr.rectangle(start, (height - sliderActiveHeight) / 2, sliderWidth * this._value, sliderActiveHeight);
        cr.fillPreserve();
        cr.setSourceRGBA (
            sliderActiveBorderColor.red / 255,
            sliderActiveBorderColor.green / 255,
            sliderActiveBorderColor.blue / 255,
            sliderActiveBorderColor.alpha / 255);
        cr.setLineWidth(sliderActiveBorderWidth);
        cr.stroke();

        cr.setSourceRGBA (
            sliderColor.red / 255,
            sliderColor.green / 255,
            sliderColor.blue / 255,
            sliderColor.alpha / 255);
        cr.rectangle(start + sliderWidth * this._value, (height - sliderHeight) / 2, sliderWidth * (1 - this._value), sliderHeight);
        cr.fillPreserve();
        cr.setSourceRGBA (
            sliderBorderColor.red / 255,
            sliderBorderColor.green / 255,
            sliderBorderColor.blue / 255,
            sliderBorderColor.alpha / 255);
        cr.setLineWidth(sliderBorderWidth);
        cr.stroke();

        let handleY = height / 2;
        let handleX = handleRadius + (width - 2 * handleRadius) * this._value;

        cr.setSourceRGBA (
            handleColor.red / 255,
            handleColor.green / 255,
            handleColor.blue / 255,
            handleColor.alpha / 255);
        if ( handleRadius == 0 ) cr.rectangle(sliderWidth * this._value, (height - handleHeight) / 2, handleWidth, handleHeight);
        else cr.arc(handleX, handleY, handleRadius, 0, 2 * Math.PI);
        cr.fillPreserve();
        cr.setSourceRGBA (
            handleBorderColor.red / 255,
            handleBorderColor.green / 255,
            handleBorderColor.blue / 255,
            handleBorderColor.alpha / 255);
        cr.setLineWidth(handleBorderWidth);
        cr.stroke();
    },

    _startDragging: function(actor, event) {
        if (this._dragging) return;

        this._dragging = true;

        this.previousMode = global.stage_input_mode;
        global.set_stage_input_mode(Cinnamon.StageInputMode.FULLSCREEN);
        Clutter.get_default_backend().get_default_seat().get_pointer().grab(this.actor);
        this._releaseId = this.actor.connect("button-release-event", Lang.bind(this, this._endDragging));
        this._motionId = this.actor.connect("motion-event", Lang.bind(this, this._motionEvent));
        let absX, absY;
        [absX, absY] = event.get_coords();
        this._moveHandle(absX, absY);
    },

    _endDragging: function(actor, event) {
        if ( this._dragging ) {
            this.actor.disconnect(this._releaseId);
            this.actor.disconnect(this._motionId);

            Clutter.get_default_backend().get_default_seat().get_pointer().ungrab();
            if ( this.previousMode ) {
                global.set_stage_input_mode(this.previousMode);
                this.previousMode = null;
            }
            this._dragging = false;

            this.emit("drag-end", this._value);
        }
        return true;
    },

    _onScrollEvent: function (actor, event) {
        let direction = event.get_scroll_direction();

        if (direction == Clutter.ScrollDirection.DOWN) {
            this._value = Math.max(0, this._value - SLIDER_SCROLL_STEP);
        }
        else if (direction == Clutter.ScrollDirection.UP) {
            this._value = Math.min(1, this._value + SLIDER_SCROLL_STEP);
        }

        this.actor.queue_repaint();
        this.emit("value-changed", this._value);
    },

    _motionEvent: function(actor, event) {
        let absX, absY;
        [absX, absY] = event.get_coords();
        this._moveHandle(absX, absY);
        return true;
    },

    _moveHandle: function(absX, absY) {
        let relX, relY, sliderX, sliderY;
        [sliderX, sliderY] = this.actor.get_transformed_position();
        relX = absX - sliderX;
        relY = absY - sliderY;

        let width = this.actor.width;
        let handleRadius = this.actor.get_theme_node().get_length("-slider-handle-radius");

        let newvalue;
        if ( relX < handleRadius ) newvalue = 0;
        else if ( relX > width - handleRadius ) newvalue = 1;
        else newvalue = (relX - handleRadius) / (width - 2 * handleRadius);
        this._value = newvalue;
        this.actor.queue_repaint();
        this.emit("value-changed", this._value);
    },

    get_value: function() {
        return this._value;
    },

    _onKeyPressEvent: function (actor, event) {
        let key = event.get_key_symbol();
        if ( key == Clutter.KEY_Right || key == Clutter.KEY_Left ) {
            let delta = key == Clutter.KEY_Right ? 0.1 : -0.1;
            this._value = Math.max(0, Math.min(this._value + delta, 1));
            this.actor.queue_repaint();
            this.emit("value-changed", this._value);
            this.emit("drag-end");
            return true;
        }
        return false;
    }
}
Signals.addSignalMethods(Slider.prototype);


function SystemVolumeDisplay(title, iconPrefix) {
    this._init(title, iconPrefix);
}

SystemVolumeDisplay.prototype = {
    _init: function(title, iconPrefix) {
        this.iconPrefix = iconPrefix;
        this.volume = 0;

        this.actor = new St.Bin({ x_align: St.Align.MIDDLE });
        let volumeBox = new St.BoxLayout({ vertical: true, style_class: "soundbox-volumeBox" });
        this.actor.add_actor(volumeBox);

        //volume text
        let volumeTextBin = new St.Bin({ x_align: St.Align.MIDDLE });
        volumeBox.add_actor(volumeTextBin);
        let volumeTitleBox = new St.BoxLayout({ vertical: false, style_class: "soundbox-volumeTextBox" });
        volumeTextBin.add_actor(volumeTitleBox);

        let volumeLabel = new St.Label({ text: title, style_class: "soundbox-text" });
        volumeTitleBox.add_actor(volumeLabel);
        this.volumeValueText = new St.Label({ text: Math.floor(100*this.volume) + "%", style_class: "soundbox-text" });
        volumeTitleBox.add_actor(this.volumeValueText);

        //volume slider
        let volumeSliderBox = new St.BoxLayout({ vertical: false });
        volumeBox.add_actor(volumeSliderBox);
        let volumeButton = new St.Button({ style_class: "soundbox-volumeButton" });
        volumeSliderBox.add_actor(volumeButton);
        this.volumeIcon = new St.Icon({ icon_name: this.iconPrefix+"high", icon_type: St.IconType.SYMBOLIC, style_class: "soundbox-volumeIcon" });
        volumeButton.set_child(this.volumeIcon);
        this.muteTooltip = new SoundboxTooltip(volumeButton);

        let volumeSliderBin = new St.Bin();
        volumeSliderBox.add_actor(volumeSliderBin);
        this.volumeSlider = new Slider(this.volume);
        volumeSliderBin.add_actor(this.volumeSlider.actor);

        volumeButton.connect("clicked", Lang.bind(this, this.toggleMute));
        this.volumeSlider.connect("value-changed", Lang.bind(this, this.onSliderChanged));
        settings.settings.connect("changed::exceedNormVolume", Lang.bind(this, function(provider, key, oldVal, newVal) {
            settings[key] = newVal;
            this.updateVolume();
        }));

    },

    setControl: function(control) {
        if ( this.control ) {
            this.control.disconnect(this.volumeEventId);
            this.control.disconnect(this.mutedEventId);
            this.volumeEventId = 0;
            this.mutedEventId = 0;
        }

        this.control = control;

        if ( control ) {
            this.volumeEventId = this.control.connect("notify::volume", Lang.bind(this, this.updateVolume));
            this.mutedEventId = this.control.connect("notify::is-muted", Lang.bind(this, this.updateMute));
            this.updateMute();
            this.updateVolume();
        }
        else {
            this.volumeSlider.setValue(0);
            this.volumeValueText.text = "0%";
            this.volumeIcon.icon_name = this.iconPrefix + "muted";
        }
    },

    updateVolume: function(object, param_spec) {
        if ( !this.control.is_muted ) {
            this.volume = this.control.volume / normVolume;

            this.volumeValueText.text = Math.round(100 * this.volume) + "%";
            this.volumeIcon.icon_name = null;
            if ( settings.exceedNormVolume ) this.volumeSlider.setValue(this.control.volume/maxVolume);
            else this.volumeSlider.setValue(this.volume);

            if ( this.volume <= 0 ) this.volumeIcon.icon_name = this.iconPrefix + "muted";
            else {
                let n = Math.floor(3 * this.volume) + 1;
                if (n < 2) this.volumeIcon.icon_name = this.iconPrefix + "low";
                else if (n >= 3) this.volumeIcon.icon_name = this.iconPrefix + "high";
                else this.volumeIcon.icon_name = this.iconPrefix + "medium";
            }
        }
    },

    updateMute: function(object, param_spec) {
        let muted = this.control.is_muted;
        if ( muted ) {
            this.volumeSlider.setValue(0);
            this.volumeValueText.text = "0%";
            this.volumeIcon.icon_name = this.iconPrefix + "muted";
            this.muteTooltip.set_text(_("Unmute"));
        }
        else {
            this.volume = this.control.volume / normVolume;
            if ( settings.exceedNormVolume ) this.volumeSlider.setValue(this.control.volume/maxVolume);
            else this.volumeSlider.setValue(this.volume);
            this.volumeValueText.text = Math.floor(100 * this.volume) + "%";
            this.volumeIcon.icon_name = null;
            this.muteTooltip.set_text(_("Mute"));

            if ( this.volume <= 0 ) this.volumeIcon.icon_name = this.iconPrefix + "muted";
            else {
                let n = Math.floor(3 * this.volume) + 1;
                if ( n < 2 ) this.volumeIcon.icon_name = this.iconPrefix + "low";
                else if ( n >= 3 ) this.volumeIcon.icon_name = this.iconPrefix + "high";
                else this.volumeIcon.icon_name = this.iconPrefix + "medium";
            }
        }
    },

    onSliderChanged: function(slider, value) {
        let volume;
        if ( settings.exceedNormVolume ) volume = value * maxVolume;
        else volume = value * normVolume;
        let prev_muted = this.control.is_muted;
        if ( volume < 1 ) {
            this.control.volume = 0;
            if ( !prev_muted ) this.control.change_is_muted(true);
        }
        else {
            this.control.volume = volume;
            if ( prev_muted ) this.control.change_is_muted(false);
        }
        this.control.push_volume();
    },

    toggleMute: function() {
        if ( this.control.is_muted ) this.control.change_is_muted(false);
        else this.control.change_is_muted(true);
    }
}


function AppControl(app) {
    this._init(app);
}

AppControl.prototype = {
    _init: function(app) {
        this.app = app;

        this.muteId = app.connect("notify::is-muted", Lang.bind(this, this.updateMute));
        this.volumeId = app.connect("notify::volume", Lang.bind(this, this.updateVolume));

        this.actor = new St.BoxLayout({ vertical: true, style_class: "soundbox-appBox" });

        let titleBin = new St.Bin({  });
        this.actor.add_actor(titleBin);
        let titleBox = new St.BoxLayout({ vertical: false, style_class: "soundbox-appTitleBox" });
        titleBin.add_actor(titleBox);

        // some applications don't give a valid icon so we try to guess it, and fall back to a default
        let iconName;
        if ( Gtk.IconTheme.get_default().has_icon(app.icon_name) ) iconName = app.icon_name;
        else {
            let testName = app.name.split(" ")[0].toLowerCase();
            if ( Gtk.IconTheme.get_default().has_icon(testName) ) iconName = testName;
            else iconName = "preferences-sound";
        }

        let iconBin = new St.Bin({ y_align: St.Align.MIDDLE });
        titleBox.add_actor(iconBin);
        let icon = new St.Icon({ icon_name: iconName, icon_type: St.IconType.FULLCOLOR, style_class: "soundbox-appIcon" });
        iconBin.add_actor(icon);
        let labelBin = new St.Bin({ y_align: St.Align.MIDDLE });
        titleBox.add_actor(labelBin);
        let label = new St.Label({ text: app.get_name(), style_class: "soundbox-appTitle" });
        labelBin.add_actor(label);

        let volumeBin = new St.Bin({  });
        this.actor.add_actor(volumeBin);
        let volumeBox = new St.BoxLayout({ vertical: false });
        volumeBin.add_actor(volumeBox);

        let volumeButton = new St.Button({ style_class: "soundbox-volumeButton" });
        volumeBox.add_actor(volumeButton);
        this.volumeIcon = new St.Icon({ style_class: "soundbox-volumeIcon" });
        volumeButton.add_actor(this.volumeIcon);
        this.muteTooltip = new SoundboxTooltip(volumeButton);

        let sliderBin = new St.Bin();
        volumeBox.add_actor(sliderBin);
        this.volumeSlider = new Slider(1);
        sliderBin.add_actor(this.volumeSlider.actor);

        volumeButton.connect("clicked", Lang.bind(this, this.toggleMute));
        this.volumeSlider.connect("value-changed", Lang.bind(this, this.sliderChanged));

        this.updateMute();
        this.updateVolume();
    },

    updateVolume: function() {
        if ( !this.app.is_muted ) {
            this.volume = this.app.volume / normVolume;
            this.volumeSlider.setValue(this.volume);
            this.volumeIcon.icon_name = null;

            if ( this.volume <= 0 ) this.volumeIcon.icon_name = "audio-volume-muted";
            else {
                let n = Math.floor(3 * this.volume) + 1;
                if (n < 2) this.volumeIcon.icon_name = "audio-volume-low";
                else if (n >= 3) this.volumeIcon.icon_name = "audio-volume-high";
                else this.volumeIcon.icon_name = "audio-volume-medium";
            }
        }
        else {
            this.volumeSlider.setValue(0);
            this.volumeIcon.icon_name = "audio-volume-muted";
        }
    },

    updateMute: function () {
        let muted = this.app.is_muted;
        if ( muted ) {
            this.volumeSlider.setValue(0);
            this.volumeIcon.icon_name = "audio-volume-muted-symbolic";
            this.muteTooltip.set_text(_("Unmute"));
        }
        else {
            this.volume = this.app.volume / normVolume;
            this.volumeSlider.setValue(this.volume);
            this.volumeIcon.icon_name = null;
            this.muteTooltip.set_text(_("Mute"));

            if ( this.volume <= 0 ) this.volumeIcon.icon_name = "audio-volume-muted";
            else {
                let n = Math.floor(3 * this.volume) + 1;
                if ( n < 2 ) this.volumeIcon.icon_name = "audio-volume-low";
                else if ( n >= 3 ) this.volumeIcon.icon_name = "audio-volume-high";
                else this.volumeIcon.icon_name = "audio-volume-medium";
            }
        }
    },

    toggleMute: function() {
        if ( this.app.is_muted ) this.app.change_is_muted(false);
        else this.app.change_is_muted(true);
    },

    sliderChanged: function(slider, value) {
        let volume = value * normVolume;
        let prev_muted = this.app.is_muted;
        if ( volume < 1 ) {
            this.app.volume = 0;
            if ( !prev_muted ) this.app.change_is_muted(true);
        }
        else {
            this.app.volume = volume;
            if ( prev_muted ) this.app.change_is_muted(false);
        }
        this.app.push_volume();
    },

    destroy: function() {
        this.app.disconnect(this.muteId);
        this.app.disconnect(this.volumeId);
        this.actor.destroy();
    }
}


function Divider() {
    this._init();
}

Divider.prototype = {
    _init: function() {
        this.actor = new St.BoxLayout({ vertical: true, style_class: "soundbox-divider-box" });
        let divider = new St.DrawingArea({ style_class: "soundbox-divider" });
        this.actor.add_actor(divider);
    }
}


function TimeControls(timeTracker) {
    this._init(timeTracker);
}

TimeControls.prototype = {
    _init: function(timeTracker) {
        this.timeTracker = timeTracker;

        this.actor = new St.Bin({  });
        this.seekControlsBox = new St.BoxLayout({ vertical: true, style_class: "soundbox-timeBox" });
        this.actor.set_child(this.seekControlsBox);

        let timeBin = new St.Bin({ x_align: St.Align.MIDDLE });
        this.seekControlsBox.add_actor(timeBin);
        this._time = new TrackInfo("0:00 / 0:00", "document-open-recent", false);
        timeBin.add_actor(this._time.actor);

        this._positionSlider = new Slider(0);
        this.seekControlsBox.add_actor(this._positionSlider.actor);

        //connect to events
        this.timeTracker.connect("state-changed", Lang.bind(this, this.onStateChanged));
        settings.settings.connect("changed::countUp", Lang.bind(this, function(provider, key, oldVal, newVal) {
            settings[key] = newVal;
            this.setTimeLabel();
        }));
        this._time.actor.connect("clicked", Lang.bind(this, function() {
            settings.countUp = !settings.countUp;
            this.setTimeLabel();
        }));
        this._positionSlider.connect("value-changed", Lang.bind(this, this.onSliderDrag));
        this._positionSlider.connect("drag-end", Lang.bind(this, this.onDragEnd));

        Mainloop.timeout_add(1000, Lang.bind(this, this.setTimeLabel));
    },

    //sets the slider value to the current percent
    setSliderValue: function() {
        if ( this._positionSlider._dragging ) return;

        let percent = this.timeTracker.getElapsed() / this.timeTracker.getTotal();
        if ( isNaN(percent) ) percent = 0;
        this._positionSlider.setValue(percent);
    },

    //sets the digital clock label
    setTimeLabel: function(elapsed) {
        if ( isNaN(this.timeTracker.startCount) || isNaN(this.timeTracker.totalCount) ) return;

        if ( !elapsed ) elapsed = this.timeTracker.getElapsed();
        let total = this.timeTracker.getTotal();

        let current;
        if ( settings.countUp ) current = elapsed;
        else current = total - elapsed;

        let label = this.formatTime(Math.floor(current)) + " / " + this.formatTime(Math.floor(total));
        this._time.setLabel(label);
    },

    //formats the time in a human-readable format
    formatTime: function(seconds) {
        let numHours = Math.floor(seconds/3600);
        let numMins = Math.floor((seconds - (numHours * 3600)) / 60);
        let numSecs = seconds - (numHours * 3600) - (numMins * 60);
        if ( numSecs < 10 ) numSecs = "0" + numSecs.toString();
        if ( numMins < 10 && numHours > 0 ) numMins = "0" + numMins.toString();
        if ( numHours > 0 ) numHours = numHours.toString() + ":";
        else numHours = "";
        return numHours + numMins.toString() + ":" + numSecs.toString();
    },

    onSliderDrag: function(slider, value) {
        let seconds = value * this.timeTracker.getTotal();
        this.setTimeLabel(seconds);
    },

    onDragEnd: function(slider, value) {
        let seconds = value * this.timeTracker.getTotal();
        this.timeTracker.seek(seconds);
    },

    onStateChanged: function(tracker, state) {
        if ( state == "playing" && !this.refreshId ) {
            this.refreshId = Mainloop.timeout_add(200, Lang.bind(this, this.refresh));
        }
        else if ( state != "playing" && this.refreshId ) {
            Mainloop.source_remove(this.refreshId);
            this.refreshId = 0;
        }
    },

    refresh: function() {
        try {
            if ( this.timeTracker.state != "playing" ) {
                this.refreshId = 0;
                return false;
            }
            if ( this._positionSlider._dragging ) return true;
            this.setTimeLabel();
            this.setSliderValue();
        } catch (e) {
            global.logError(e);
        }
        return true;
    }
}


function TrackInfo(label, icon, tooltip) {
    this._init(label, icon, tooltip);
}

TrackInfo.prototype = {
    _init: function(label, icon, tooltip) {
        this.hasTooltip = tooltip;
        this.actor = new St.Button({ x_align: St.Align.START });
        let box = new St.BoxLayout({ style_class: "soundbox-trackInfo" });
        this.actor.add_actor(box);
        this.icon = new St.Icon({ icon_name: icon.toString(), style_class: "soundbox-trackInfo-icon" });
        box.add_actor(this.icon);
        this.label = new St.Label({ text: label.toString(), style_class: "soundbox-trackInfo-text" });
        box.add_actor(this.label);
        if ( tooltip ) {
            this.tooltip = new SoundboxTooltip(this.actor, label.toString());
        }
    },

    setLabel: function(label) {
        this.label.text = label.toString();
        if ( this.hasTooltip ) this.tooltip.set_text(label.toString());
    },

    getLabel: function() {
        return this.label.text.toString();
    },

    hide: function() {
        this.actor.hide();
    },

    show: function() {
        this.actor.show();
    }
}


function ControlButton(icon, text, callback) {
    this._init(icon, text, callback);
}

ControlButton.prototype = {
    _init: function(icon, text, callback) {
        this.actor = new St.Bin({ style_class: "soundbox-soundButton-box" });
        this.button = new St.Button({ style_class: "soundbox-soundButton" });
        this.actor.add_actor(this.button);
        this.button.connect("clicked", callback);
        this.icon = new St.Icon({ icon_type: St.IconType.SYMBOLIC, icon_name: icon, style_class: "soundbox-soundButton-icon" });
        this.button.set_child(this.icon);
        this._tooltip = new SoundboxTooltip(this.button, text);
    },

    getActor: function() {
        return this.actor;
    },

    setIcon: function(icon) {
        this.icon.icon_name = icon;
    },

    set tooltip(text) {
        this._tooltip.set_text(text);
    },

    enable: function() {
        this.button.remove_style_pseudo_class("disabled");
        this.button.can_focus = true;
        this.button.reactive = true;
    },

    disable: function() {
        this.button.add_style_pseudo_class("disabled");
        this.button.can_focus = false;
        this.button.reactive = false;
    }
}


function TitleBar(title, server) {
    this._init(title, server);
}

TitleBar.prototype = {
    _init: function(name, server) {
        this.name = name;
        this.server = server;
        this.actor = new St.BoxLayout({ style_class: "soundbox-playerInfoBar", vertical: false });

        this.icon = new St.Icon({ icon_name: "media-status-stoped", icon_type: St.IconType.SYMBOLIC, style_class: "soundbox-playerIcon" });
        this.actor.add_actor(this.icon);
        this.title = new St.Label({ text: this.getTitle(), style_class: "soundbox-playerTitle" });

        if ( this.server.CanRaise ) {
            let raiseButton = new St.Button({ style_class: "soundbox-raiseButton" });
            this.actor.add_actor(raiseButton);
            raiseButton.add_actor(this.title);
            raiseButton.connect("clicked", Lang.bind(this, function() {
                actionManager.close();
                this.server.RaiseRemote();
            }));
            new SoundboxTooltip(raiseButton, _("Show player"));
        }
        else this.actor.add_actor(this.title);

        if ( this.server.CanQuit ) {
            let quitButton = new St.Button({ style_class: "soundbox-quitButton" });
            this.actor.add_actor(quitButton);
            let quitIcon = new St.Icon({ icon_name: "close", icon_type: St.IconType.SYMBOLIC, icon_size: 16 });
            quitButton.add_actor(quitIcon);
            quitButton.connect("clicked", Lang.bind(this, function() {
                actionManager.close();
                this.server.QuitRemote();
            }));
            new SoundboxTooltip(quitButton, _("Close player"));
        }
    },

    setStatus: function(status) {
        this.icon.set_icon_name("media-status-" + status.toLowerCase());
        this.setTitle(status);
    },

    getTitle: function() {
        return this.name.charAt(0).toUpperCase() + this.name.slice(1);
    },

    setTitle: function(status) {
        this.title.text = this.getTitle() + " - " + _(status);
    }
}


/* Player Controls */
function Player(parent, owner, name) {
    this._init(parent, owner, name);
}

Player.prototype = {
    _init: function(parent, owner, name) {
        try {
            this.actor = new St.Bin();

            this.parent = parent;
            this.showPosition = true;
            this.owner = owner;
            this.busName = name;
            this.name = name.split(".")[3];
            this.checkName();

            //player title bar
            this.title = new St.Bin();

            Interfaces.getDBusProxyWithOwnerAsync(MEDIA_PLAYER_2_NAME, this.busName, Lang.bind(this, function(proxy, error) {
                if ( error ) {
                    global.logError(error);
                }
                else {
                    this._mediaServer = proxy;
                    this._onGetDBus();
                }
            }));

            Interfaces.getDBusProxyWithOwnerAsync(MEDIA_PLAYER_2_PLAYER_NAME, this.busName, Lang.bind(this, function(proxy, error) {
                if ( error ) {
                    global.logError(error);
                }
                else {
                    this._mediaServerPlayer = proxy;
                    this._onGetDBus();
                }
            }));

            Interfaces.getDBusPropertiesAsync(this.busName, MEDIA_PLAYER_2_PATH, Lang.bind(this, function(proxy, error) {
                if ( error ) {
                    global.logError(error);
                }
                else {
                    this._prop = proxy;
                    this._onGetDBus();
                }
            }));

        } catch (e) {
            global.logError(e);
        }
    },

    _onGetDBus: function() {
        try {
            if ( !this._prop || !this._mediaServerPlayer || !this._mediaServer ) return;
            this._timeTracker = new TimeTracker(this._mediaServerPlayer, this._prop, this.name);
            this.titleBar = new TitleBar(this.name, this._mediaServer);
            this.title.add_actor(this.titleBar.actor);
            this._buildLayout();

            this.updateStatus(this._mediaServerPlayer.PlaybackStatus);
            this.setMetadata(this._mediaServerPlayer.Metadata);
            this.updateSeekable();
            this.updateRepeat();
            this.updateShuffle();

            this._propChangedId = this._prop.connectSignal("PropertiesChanged", Lang.bind(this, function(proxy, sender, [iface, props]) {
                if ( props.PlaybackStatus ) this.updateStatus(props.PlaybackStatus.unpack());
                if ( props.Metadata ) this.setMetadata(props.Metadata.deep_unpack());
                if ( props.CanGoNext || props.CanGoPrevious ) this.updateControls();
                if ( props.LoopStatus ) this.updateRepeat();
                if ( props.Shuffle ) this.updateShuffle();
            }));

        } catch(e) {
            global.logError(e);
        }
    },

    _buildLayout: function() {
        try {
            this.actor.destroy_all_children();

            let mainBox = new St.BoxLayout({ vertical: true });
            this.actor.set_child(mainBox);

            //track info
            let trackInfoContainer = new St.Bin({  });
            mainBox.add_actor(trackInfoContainer);
            let trackInfoBox = new St.BoxLayout({ vertical: true, style_class: "soundbox-trackInfoBox" });
            trackInfoContainer.set_child(trackInfoBox);

            this._title = new TrackInfo(_("Unknown Title"), "audio-x-generic", true);
            trackInfoBox.add_actor(this._title.actor);
            this._album = new TrackInfo(_("Unknown Album"), "media-optical", true);
            trackInfoBox.add_actor(this._album.actor);
            this._artist = new TrackInfo(_("Unknown Artist"), "system-users", true);
            trackInfoBox.add_actor(this._artist.actor);

            //album image
            this.trackCoverFile = this.trackCoverFileTmp = false;
            this.trackCover = new St.Bin({ style_class: "soundbox-albumCover-box" });
            mainBox.add_actor(this.trackCover);
            let trackCoverIcon = new St.Icon({ icon_size: settings.artSize, icon_name: "media-optical-cd-audio", style_class: "soundbox-albumCover", icon_type: St.IconType.FULLCOLOR });
            this.trackCover.set_child(trackCoverIcon);
            this.artHiddenDivider = new Divider();
            mainBox.add_actor(this.artHiddenDivider.actor);
            if ( settings.showArt ) this.artHiddenDivider.actor.hide();
            else this.trackCover.hide();
            settings.settings.connect("changed::showArt", Lang.bind(this, function(provider, key, oldVal, newVal) {
                settings[key] = newVal;
                if ( newVal ) {
                    this.trackCover.show();
                    this.artHiddenDivider.actor.hide();
                }
                else {
                    this.trackCover.hide();
                    this.artHiddenDivider.actor.show();
                }
            }))
            settings.settings.connect("changed::artSize", Lang.bind(this, function(provider, key, oldVal, newVal) {
                settings[key] = newVal;
                this.showCoverArt();
            }));

            //time display controls
            this.timeControls = new TimeControls(this._timeTracker);
            mainBox.add_actor(this.timeControls.actor);

            //control buttons
            this.trackControls = new St.Bin({ x_align: St.Align.MIDDLE });
            mainBox.add_actor(this.trackControls);
            this.controls = new St.BoxLayout({ style_class: "soundbox-buttonBox" });
            this.trackControls.set_child(this.controls);

            this._prevButton = new ControlButton("media-skip-backward", _("Previous"), Lang.bind(this, function() {
                this._mediaServerPlayer.PreviousRemote();
                if ( this.name == "spotify" ) this._timeTracker.setElapsed(0);
            }));
            this.controls.add_actor(this._prevButton.getActor());

            this._playButton = new ControlButton("media-playback-start", _("Play"), Lang.bind(this, function() {
                this._mediaServerPlayer.PlayPauseRemote();
            }));
            this.controls.add_actor(this._playButton.getActor());

            this._stopButton = new ControlButton("media-playback-stop", _("Stop"), Lang.bind(this, function() {
                this._mediaServerPlayer.StopRemote();
            }));
            this.controls.add_actor(this._stopButton.getActor());

            this._nextButton = new ControlButton("media-skip-forward", _("Next"), Lang.bind(this, function() {
                this._mediaServerPlayer.NextRemote();
                if ( this.name == "spotify" ) this._timeTracker.setElapsed(0);
            }));
            this.controls.add_actor(this._nextButton.getActor());

            if ( this._mediaServerPlayer.LoopStatus ) {
                this._repeatButton = new ControlButton("playlist-repeat-none", _("Repeat"), Lang.bind(this, function() {
                    let mapping = { "None": "Playlist", "Playlist": "Track", "Track": "None" };
                    this._mediaServerPlayer.LoopStatus = mapping[this._mediaServerPlayer.LoopStatus];
                    this.updateRepeat(this._mediaServerPlayer.LoopStatus);
                }));
                this.controls.add_actor(this._repeatButton.getActor());
            }

            if ( this._mediaServerPlayer.Shuffle !== undefined ) {
                this._shuffleButton = new ControlButton("playlist-shuffle-off", _("Shuffle"), Lang.bind(this, function() {
                    this._mediaServerPlayer.Shuffle = !this._mediaServerPlayer.Shuffle;
                    this.updateShuffle();
                }));
                this.controls.add_actor(this._shuffleButton.getActor());
            }

            if (SUPPORT_SEEK.indexOf(this.name.toLowerCase()) == -1) {
                this.timeControls.actor.hide();
            }

        } catch (e) {
            global.logError(e);
        }
    },

    destroy: function() {
        this.actor.destroy();
        this.title.destroy();
        if ( this._timeTracker ) this._timeTracker.destroy();
        if ( this._propChangedId ) this._prop.disconnectSignal(this._propChangedId);
    },

    updateSeekable: function(position) {
        this._canSeek = this.getCanSeek();
        if ( this._timeTracker.totalCount == 0 || position == false ) this._canSeek = false;
    },

    getCanSeek: function() {
        let can_seek = true;
        this._prop.GetRemote(MEDIA_PLAYER_2_PLAYER_NAME, "CanSeek", Lang.bind(this, function(position, error) {
            if ( !error ) {
                can_seek = position[0].get_boolean();
            }
        }));
        return can_seek;
    },

    updateRepeat: function() {
        switch ( this._mediaServerPlayer.LoopStatus ) {
            case "None":
                this._repeatButton.setIcon("playlist-repeat-none");
                this._repeatButton.tooltip = _("Repeat: Off");
                break;
            case "Track":
                this._repeatButton.setIcon("playlist-repeat-track");
                this._repeatButton.tooltip = _("Repeat: Track");
                break;
            case "Playlist":
                this._repeatButton.setIcon("playlist-repeat-all");
                this._repeatButton.tooltip = _("Repeat: All");
                break;
        }
    },

    updateShuffle: function() {
        if ( this._mediaServerPlayer.Shuffle ) {
            this._shuffleButton.setIcon("playlist-shuffle-on");
            this._shuffleButton.tooltip = _("Shuffle: On");
        }
        else {
            this._shuffleButton.setIcon("playlist-shuffle-off");
            this._shuffleButton.tooltip = _("Shuffle: Off");
        }
    },

    _updateControls: function() {
        this._prop.GetRemote(MEDIA_PLAYER_2_PLAYER_NAME, "CanGoNext", Lang.bind(this, function(value, error) {
            let canGoNext = true;
            if ( !error ) canGoNext = value[0].unpack();
            if ( canGoNext ) this._nextButton.enable();
            else this._nextButton.disable();
        }));

        this._prop.GetRemote(MEDIA_PLAYER_2_PLAYER_NAME, "CanGoPrevious", Lang.bind(this, function(value, error) {
            let canGoPrevious = true;
            if ( !error ) canGoPrevious = value[0].unpack();
            if ( canGoPrevious ) this._prevButton.enable();
            else this._prevButton.disable();
        }));
    },

    setMetadata: function(metadata) {
        if ( !metadata ) return;

        if ( metadata["mpris:length"] ) {
            this._timeTracker.setTotal(metadata["mpris:length"].unpack() / 1000000);
            this._timeTracker.fetchPosition();
            if ( this._mediaServerPlayer.PlaybackStatus == "Playing" ) {
                this._timeTracker.start();
            }
        }
        else {
            this._timeTracker.setTotal(0);
        }
        if ( metadata["xesam:artist"] ) this._artist.setLabel(metadata["xesam:artist"].deep_unpack());
        else this._artist.setLabel(_("Unknown Artist"));
        if ( metadata["xesam:album"] ) this._album.setLabel(metadata["xesam:album"].unpack());
        else this._album.setLabel(_("Unknown Album"));
        if ( metadata["xesam:title"] ) this._title.setLabel(metadata["xesam:title"].unpack());
        else this._title.setLabel(_("Unknown Title"));

        if ( metadata["mpris:trackid"] ) this._timeTracker.trackId = metadata["mpris:trackid"].unpack();

        let change = false;
        if ( metadata["mpris:artUrl"] ) {
            if ( this.trackCoverFile != metadata["mpris:artUrl"].unpack() ) {
                this.trackCoverFile = metadata["mpris:artUrl"].unpack();
                change = true;
            }
        }
        else {
            if ( this.trackCoverFile != false ) {
                this.trackCoverFile = false;
                change = true;
            }
        }

        if ( change ) {
            if ( this.trackCoverFile ) {
                this.coverPath = "";
                if ( this.trackCoverFile.match(/^http/) ) {
                    let uri = this.trackCoverFile;
                    if ( this.name == "spotify" ) uri = uri.replace("thumb", "300");
                    let cover = Gio.file_new_for_uri(decodeURIComponent(uri));
                    if ( !this.trackCoverFileTmp ) this.trackCoverFileTmp = Gio.file_new_tmp("XXXXXX.mediaplayer-cover")[0];
                    cover.read_async(null, null, Lang.bind(this, this._onReadCover));
                }
                else {
                    this.coverPath = decodeURIComponent(this.trackCoverFile);
                    this.coverPath = this.coverPath.replace("file://", "");
                    this.showCoverArt();
                }
            }
            else this.showCoverArt();
        }
    },

    updateStatus: function(status) {
        this.updateSeekable();
        switch ( this._mediaServerPlayer.PlaybackStatus ) {
            case "Playing":
                this._timeTracker.start();
                this._playButton.setIcon("media-playback-pause");
                this._playButton.tooltip = _("Pause");
                break;
            case "Paused":
                this._timeTracker.pause();
                this._playButton.setIcon("media-playback-start");
                this._playButton.tooltip = _("Play");
                break;
            case "Stopped":
                this._timeTracker.stop();
                this._playButton.setIcon("media-playback-start");
                this._playButton.tooltip = _("Play");
                break;
        }

        this.titleBar.setStatus(status);
    },

    _onReadCover: function(cover, result) {
        let inStream = cover.read_finish(result);
        let outStream = this.trackCoverFileTmp.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, null);
        outStream.splice_async(inStream, Gio.OutputStreamSpliceFlags.CLOSE_TARGET, 0, null, Lang.bind(this, this._onSavedCover));
    },

    _onSavedCover: function(outStream, result) {
        outStream.splice_finish(result, null);
        this.coverPath = this.trackCoverFileTmp.get_path();
        this.showCoverArt(this.coverPath);
    },

    showCoverArt: function() {
        if ( ! this.coverPath || ! GLib.file_test(this.coverPath, GLib.FileTest.EXISTS) ) {
            this.trackCover.set_child(new St.Icon({ icon_size: settings.artSize, icon_name: "media-optical-cd-audio", style_class: "soundboxalbumCover", icon_type: St.IconType.FULLCOLOR }));
        }
        else {
            let l = new Clutter.BinLayout();
            let b = new Clutter.Box();

            let pixbuf = GdkPixbuf.Pixbuf.new_from_file(this.coverPath);
            let imgHeight = settings.artSize;
            let imgWidth = pixbuf.get_width() / pixbuf.get_height() * imgHeight;
            let pixbufResized = pixbuf.scale_simple(imgWidth, imgHeight, 2);

            let image = new Clutter.Image();
            image.set_data(
                pixbufResized.get_pixels(),
                pixbufResized.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
                imgWidth,
                imgHeight,
                pixbufResized.get_rowstride()
            );

            let imgActor = new Clutter.Actor();
            imgActor.set_content(image);
            imgActor.set_width(imgWidth);
            imgActor.set_height(imgHeight);

            b.set_layout_manager(l);
            b.set_width(settings.artSize);
            b.add_actor(imgActor);

            this.trackCover.set_child(b);
        }
    },

    checkName: function() {
        if ( settings.compatiblePlayers.indexOf(this.name) == -1 ) {
            global.log("Soundbox: Adding "+this.name+" to list of supported players");
            settings.compatiblePlayers.push(this.name);
            settings.compatiblePlayers.save();
        }
    }
}


/* Main Layout */
function SoundboxLayout(containers, settingsObj, actionMgr) {
    this._init(containers, settingsObj, actionMgr);
}

SoundboxLayout.prototype = {
    _init: function(containers, settingsObj, actionMgr) {
        try {

            settings = settingsObj;
            actionManager = actionMgr;
            this.volumeContent = containers.volumeContent;
            this.playerContent = containers.playerContent;
            this.context = containers.context;
            this.playersMenu = containers.playersMenu;

            this.players = {};
            this.owners = [];
            this.playerShown = null;
            this.output = null;
            this.outputVolumeId = 0;
            this.outputMutedId = 0;
            this._volumeControlShown = false;

            Interfaces.getDBusAsync(Lang.bind(this, function (proxy, error) {
                this._dbus = proxy;

                // player DBus name pattern
                let name_regex = /^org\.mpris\.MediaPlayer2\./;
                // load players
                this._dbus.ListNamesRemote(Lang.bind(this, function(names) {
                    for ( let n in names[0] ) {
                        let name = names[0][n];
                        if ( name_regex.test(name) ) {
                            this._dbus.GetNameOwnerRemote(name, Lang.bind(this, function(owner) {
                                this._addPlayer(name, owner);
                            }));
                        }
                    }
                }));

                // watch players
                this._ownerChangedId = this._dbus.connectSignal("NameOwnerChanged", Lang.bind(this, function(proxy, sender, [name, old_owner, new_owner]) {
                    if ( name_regex.test(name) ) {
                        if ( old_owner && this.players[old_owner] ) this._removePlayer(name, old_owner);
                        if ( new_owner && !this.players[new_owner] ) this._addPlayer(name, new_owner);
                    }
                }));
            }));

            this.gvcHandler = new GVCHandler(this);

            settings.settings.connect("changed::showInput", Lang.bind(this, function(provider, key, oldVal, newVal) {
                settings[key] = newVal;
                this._buildVolumeControls();
            }));
            settings.settings.connect("changed::showApps", Lang.bind(this, function(provider, key, oldVal, newVal) {
                settings[key] = newVal;
                this._setAppHideState();
            }));

            this._buildContext();
            this.refresh_players();
            this._buildVolumeControls();
            this._buildPlayerControls();

        } catch(e) {
            global.logError(e);
        }
    },

    _buildContext: function() {
        this.outputSection = new PopupMenu.PopupMenuSection();
        this.context.addMenuItem(this.outputSection);
        this.outputSection.addMenuItem(new PopupMenu.PopupMenuItem(_("Output Devices"), { reactive: false }));
        this.gvcHandler.outputDevices = new PopupMenu.PopupMenuSection();
        this.gvcHandler.outputDevices.actor.add_style_class_name("soundBox-contextMenuSection");
        this.outputSection.addMenuItem(this.gvcHandler.outputDevices);
        this.outputSection.actor.hide();

        this.context.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.inputSection = new PopupMenu.PopupMenuSection();
        this.context.addMenuItem(this.inputSection);
        this.inputSection.addMenuItem(new PopupMenu.PopupMenuItem(_("Input Devices"), { reactive: false }));
        this.gvcHandler.inputDevices = new PopupMenu.PopupMenuSection();
        this.gvcHandler.inputDevices.actor.add_style_class_name("soundBox-contextMenuSection");
        this.inputSection.addMenuItem(this.gvcHandler.inputDevices);
        this.inputSection.actor.hide();

        this.context.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.context.addSettingsAction(_("Sound Settings"), "sound");
    },

    _buildVolumeControls: function() {

        this.volumeContent.destroy_all_children();

        //system volume controls
        this.outputVolumeDisplay = new SystemVolumeDisplay(_("Volume:") + " ", "audio-volume-");
        this.volumeContent.add_actor(this.outputVolumeDisplay.actor);

        if ( settings.showInput ) {
            let divider = new Divider();
            this.volumeContent.add_actor(divider.actor);
            this.inputVolumeDisplay = new SystemVolumeDisplay("Input Volume: ", "microphone-sensitivity-");
            this.volumeContent.add_actor(this.inputVolumeDisplay.actor);
        }

        //application volume controls
        this.appBox = new St.BoxLayout({ vertical: true });
        this.volumeContent.add_actor(this.appBox);
        if ( !settings.showApps ) this.appBox.hide();

        this.gvcHandler.refresh();
    },

    _buildPlayerControls: function() {

        this.playerContent.hide();

        //player title
        this.playerTitleBox = new St.BoxLayout({ vertical: false, style_class: "soundbox-titleBar" });
        this.playerContent.add_actor(this.playerTitleBox);

        this.playerBack = new St.Button({ style_class: "soundbox-playerSelectButton", child: new St.Icon({ icon_name: "media-playback-start-rtl", icon_size: 16 }) });
        this.playerTitleBox.add_actor(this.playerBack);
        this.playerBack.hide();
        new SoundboxTooltip(this.playerBack, _("Previous Player"));

        this.playerTitle = new St.Bin({ style_class: "soundbox-titleBox" });
        this.playerTitleBox.add(this.playerTitle, { expand: true });
        this.playerTitle.set_alignment(St.Align.MIDDLE, St.Align.MIDDLE);

        this.playerForward = new St.Button({ style_class: "soundbox-playerSelectButton", child: new St.Icon({ icon_name: "media-playback-start", icon_size: 16 }) });
        this.playerTitleBox.add_actor(this.playerForward);
        this.playerForward.hide();
        new SoundboxTooltip(this.playerForward, _("Next Player"));

        this.playerBack.connect("clicked", Lang.bind(this, function() {
            for ( let i = 0; i < this.owners.length; i++ ) {
                if ( this.playerShown == this.owners[i] ) {
                    let current = i - 1;
                    if ( current == -1 ) current = this.owners.length - 1;
                    this._showPlayer(this.players[this.owners[current]]);
                    break;
                }
            }
        }));
        this.playerForward.connect("clicked", Lang.bind(this, function() {
            for ( let i = 0; i < this.owners.length; i++ ) {
                if ( this.playerShown == this.owners[i] ) {
                    let current = i + 1;
                    if ( current == this.owners.length ) current = 0;
                    this._showPlayer(this.players[this.owners[current]]);
                    break;
                }
            }
        }));

        //player info
        this.playersBox = new St.Bin();
        this.playerContent.add_actor(this.playersBox);
    },

    _setAppHideState: function() {
        if ( settings.showApps ) this.appBox.show();
        else this.appBox.hide();
    },

    refresh_players: function() {
        this.playersMenu.removeAll();

        this._availablePlayers = new Array();
        let appsys = Cinnamon.AppSystem.get_default();
        let allApps = appsys.get_all();
        let listedDesktopFiles = new Array();
        for ( let y = 0; y < allApps.length; y++ ) {
            let app = allApps[y];
            let info = app.get_app_info();
            let path = info.get_filename();
            for ( let i in settings.compatiblePlayers ) {
                let desktopFile = settings.compatiblePlayers[i] + ".desktop";
                if ( path.indexOf(desktopFile) != -1 && listedDesktopFiles.indexOf(desktopFile) == -1 ) {
                    this._availablePlayers.push(app);
                    listedDesktopFiles.push(desktopFile);
                }
            }
        }

        for ( let i = 0; i < this._availablePlayers.length; i++ ) {
            let playerApp = this._availablePlayers[i];

            let menuItem = new PopupMenu.PopupBaseMenuItem();
            menuItem.actor.set_name("soundbox-popup-menuitem");

            let icon = playerApp.create_icon_texture(ICON_SIZE);
            if ( icon ) menuItem.addActor(icon);

            let label = new St.Label({ text: playerApp.get_name() });
            menuItem.addActor(label);

            menuItem.connect("activate", function() {
                playerApp.open_new_window(-1);
            });
            this.playersMenu.addMenuItem(menuItem);
        }
    },

    _addPlayer: function(name, owner) {
        try {

            this.players[owner] = new Player(this, owner, name);
            this.owners.push(owner);
            if ( this.playerShown == null ) this._showPlayer(this.players[owner]);

            if ( this.owners.length > 1 ) {
                this.playerBack.show();
                this.playerForward.show();
            }

            this.refresh_players();

        } catch(e) {
            global.logError(e);
        }
    },

    _removePlayer: function(name, owner) {
        try {

            this.players[owner].destroy();
            delete this.players[owner];

            for ( let i = 0; i < this.owners.length; i++ ) {
                if ( this.owners[i] == owner ) {
                    this.owners.splice(i, 1);
                    if ( this.playerShown == owner ) {
                        if ( this.owners.length < 1 ) {
                            this.playerContent.hide();
                            this.playersBox.set_child(null);
                            this.playerShown = null;
                        }
                        else {
                            let current = i;
                            if ( current >= this.owners.length ) current = this.owners.length - 1;
                            this._showPlayer(this.players[this.owners[current]]);
                        }
                    }
                    break;
                }
            }

            if ( Object.keys(this.players).length < 2 ) {
                this.playerBack.hide();
                this.playerForward.hide();
            }

        } catch(e) {
            global.logError(e);
        }
    },

    _showPlayer: function(player) {
        if ( player == null ) return;
        this.playerShown = player.owner;
        this.playersBox.set_child(player.actor);
        this.playerTitle.set_child(player.title);
        this.playerContent.show();
        if ( this.owners.length > 1 ) {
            this.playerBack.show();
            this.playerForward.show();
        }
    }
}
