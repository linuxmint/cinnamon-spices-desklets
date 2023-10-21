const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Pango = imports.gi.Pango;
const Settings = imports.ui.settings;
const St = imports.gi.St;

const UUID = "dual-datetime@rcalixte";
const DATETIME_URL = "https://man7.org/linux/man-pages/man1/date.1.html";

// l10n/translation support
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

const ST_ALIGNMENT = {
    "left": St.Align.START,
    "center": St.Align.MIDDLE,
    "right": St.Align.END
};

function DateTimeDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

DateTimeDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.metadata = metadata;
        this.desklet_id = desklet_id;
        this.setupUI();
    },

    setupUI: function () {
        // initialize settings variables
        this.settings = new Settings.DeskletSettings(this, UUID, this.desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time_custom1", "time_custom1", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time_format1", "time_format1", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time_align1", "time_align1", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time_yalign1", "time_yalign1", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time_font1", "time_font1", this.on_font_setting_changed, 1);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time_color1", "time_color1", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time_size1", "time_size1", this.on_font_setting_changed, 1);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time_custom2", "time_custom2", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time_format2", "time_format2", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time_align2", "time_align2", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time_yalign2", "time_yalign2", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time_font2", "time_font2", this.on_font_setting_changed, 2);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time_color2", "time_color2", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time_size2", "time_size2", this.on_font_setting_changed, 2);
        this.settings.bindProperty(Settings.BindingDirection.IN, "width", "width", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "title_align", "title_align", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show_decorations", "show_decorations", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "background_color", "background_color", this.setupUI);

        // refresh style on change of global desklet setting for decorations
        global.settings.connect('changed::desklet-decorations', Lang.bind(this, this.setupUI));

        this.launcher = new Gio.SubprocessLauncher({
            flags: (Gio.SubprocessFlags.STDIN_PIPE |
                Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.Subprocess.STDERR_PIPE)
        });

        this.metadata['prevent-decorations'] = !this.show_decorations;
        this._vertical = this.title_align == "vertical" ? true : false;
        this._main = new St.BoxLayout({ vertical: this._vertical });

        if (!this.time_custom1 && !this.time_custom2)
            this.time_custom1 = true;

        if (this.time_custom1)
            this._setupContainer(1);

        if (this.time_custom2)
            this._setupContainer(2);

        let _background = this.show_decorations ? `background-color: ${this.background_color}; ` : "";
        this._main.style = `${_background}text-shadow: 1px 1px 2px #000; padding: 4px 10px; width: ${this.width}px;`;
        this.setContent(this._main);
        this._updateUI();
    },

    _setupContainer: function (num) {
        this[`container${num}`] = new St.BoxLayout({ vertical: false });
        this[`datetime${num}`] = new St.Label({ text: "" });
        this[`datetime${num}`].clutterText.ellipsize = Pango.EllipsizeMode.NONE;
        let _other_num = num == 1 ? 2 : 1;
        let _y_alignment = !this._vertical && this.time_custom1 && this.time_custom2 &&
            this[`time_size${_other_num}`] > this[`time_size${num}`] ?
            { y_fill: false, y_align: ST_ALIGNMENT[this[`time_yalign${num}`]] } : null;
        this[`container${num}`].add(this[`datetime${num}`], _y_alignment);
        this[`time_font${num}`] = this[`time_font${num}`].replace(/['"`]/g, "");
        this[`font${num}`] = this[`time_font${num}`] !== "" ? ` font-family: '${this["time_font" + num]}';` : "";
        let _padding = this._vertical || num == 1 ? "" : "padding-left: 0.5em; ";
        this[`container${num}`].style = `${_padding}color: ${this['time_color' + num]}; font-size: ${this['time_size' + num]}em;${this['font' + num]}`;
        let _alignment = this._vertical ? { x_fill: false, x_align: ST_ALIGNMENT[this[`time_align${num}`]] } : null;
        this._main.add(this[`container${num}`], _alignment);
    },

    _updateUI: function () {
        let currentTime = new Date();
        let badChars = ["%", ""];
        if (this.time_custom1) {
            if (this.time_format1 == null || badChars.indexOf(this.time_format1.trim()) !== -1) {
                this.datetime1.set_text(currentTime.toLocaleTimeString());
            } else {
                try {
                    this.datetime1.set_text(currentTime.toLocaleFormat(this.time_format1));
                } catch (e) {
                    this.datetime1.set_text(currentTime.toLocaleTimeString());
                }
            }
        }
        if (this.time_custom2) {
            if (this.time_format2 == null || badChars.indexOf(this.time_format2.trim()) !== -1) {
                this.datetime2.set_text(currentTime.toLocaleDateString());
            } else {
                try {
                    this.datetime2.set_text(currentTime.toLocaleFormat(this.time_format2));
                } catch (e) {
                    this.datetime2.set_text(currentTime.toLocaleDateString());
                }
            }
        }
        this.timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._updateUI));
    },

    on_datetime_button_clicked: function () {
        this.launcher.spawnv(["xdg-open", DATETIME_URL]);
    },

    on_desklet_removed: function () {
        Mainloop.source_remove(this.timeout);
    },

    on_font_setting_changed: function (value, num) {
        // font settings changed; try to refresh instantly
        this[`time_font${num}`] = this[`time_font${num}`].replace(/['"`]/g, "");
        let argv = GLib.shell_parse_argv(`fc-list -q "${this['time_font' + num]}"`)[1];
        try {
            let subprocess = this.launcher.spawnv(argv);
            subprocess.communicate_utf8_async(null, null, (subprocess, result) => {
                try {
                    subprocess.communicate_utf8_finish(result);
                    let status = subprocess.get_exit_status();
                    if (status === 0) {
                        this[`font${num}`] = this[`time_font${num}`] !== "" ? ` font-family: '${this["time_font" + num]}';` : "";
                    } else {
                        this[`time_font${num}`] = "";
                        this[`font${num}`] = "";
                    }
                } catch (e) {
                    global.logError(e);
                } finally {
                    let _padding = this._vertical || num == 1 ? "" : "padding-left: 0.5em; ";
                    this[`container${num}`].style = `${_padding}color: ${this["time_color" + num]}; font-size: ${this["time_size" + num]}em;${this["font" + num]}`;
                }
            });
        } catch (e) {
            global.logError(e);
        }
    }
};

function main(metadata, desklet_id) {
    return new DateTimeDesklet(metadata, desklet_id);
}
