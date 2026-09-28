const St = imports.gi.St;
const CinnamonDesktop = imports.gi.CinnamonDesktop;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;
const Clutter = imports.gi.Clutter;

Gettext.bindtextdomain("cinnamon", "/usr/share/locale");
function _(str) {
    return Gettext.dgettext("cinnamon", str);
}

class MacosClockDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        
        this.metadata["prevent-decorations"] = true;

        this._date = new St.Label({
            style_class: "macosclock-desklet-label",
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START
        });

        this._ampmLabel = new St.Label({
            style_class: "macosclock-desklet-ampm",
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START
        });

        this._dayLabel = new St.Label({
            style_class: "macosclock-desklet-day",
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START
        });

        this._topBox = new St.BoxLayout({
            vertical: false
        });
        this._topBox.add_actor(this._date);
        this._topBox.add_actor(this._ampmLabel);

        this._box = new St.BoxLayout({
            vertical: true
        });
        this._box.add_actor(this._topBox);
        this._box.add_actor(this._dayLabel);

        this._container = new St.Bin({
            style_class: "macosclock-desklet-container",
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START
        });
        this._container.set_child(this._box);

        this.setContent(this._container);

        this.clock = new CinnamonDesktop.WallClock();
        this.clock_notify_id = 0;

        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
        this.settings.bind("date-format", "format");
        this.settings.bind("text-color", "text_color", this._onSettingsChanged);
        this.settings.bind("container-color", "container_color", this._onSettingsChanged);
        this.settings.bind("bg-image", "bg_image", this._onSettingsChanged); 
        this.settings.bind("use-custom-format", "use_custom_format", this._onSettingsChanged);

        this._menu.addSettingsAction(_("Date and Time Settings"), "calendar");
    }

    _clockNotify(obj, pspec, data) {
        this._updateClock();
    }

    _onSettingsChanged() {
        let fontColor = (this.text_color && this.text_color !== "") ? this.text_color : "#fdaacd";
        let containerColor = (this.container_color && this.container_color !== "") ? this.container_color : "rgba(184, 173, 173, 0.55)";

        this._date.set_style("color: " + fontColor + ";");
        this._ampmLabel.set_style("color: " + fontColor + ";");
        this._dayLabel.set_style("color: " + fontColor + ";");

        if (this.bg_image && this.bg_image !== "") {
            this._container.set_style(
                "background-image: url('" + this.bg_image + "'); " +
                "background-size: cover; " +
                "background-position: center;"
            );
        } else {
            this._container.set_style("background-color: " + containerColor + ";"); 
        }

        this._updateFormatString();
        this._updateClock();
    }

    on_desklet_added_to_desktop() {
        this._onSettingsChanged();

        if (this.clock_notify_id == 0) {
            this.clock_notify_id = this.clock.connect("notify::clock", () => this._clockNotify());
        }
    }

    on_desklet_removed() {
        if (this.clock_notify_id > 0) {
            this.clock.disconnect(this.clock_notify_id);
            this.clock_notify_id = 0;
        }
    }

    _updateFormatString() {
        if (this.use_custom_format) {
            if (!this.clock.set_format_string(this.format)) {
                global.logError("Clock desklet: bad format - check your string.");
                this.clock.set_format_string("~FORMAT ERROR~ %l:%M %p");
            }
        } else {
            this.clock.set_format_string(null);
        }
    }

    _updateClock() {
        if (this.use_custom_format) {
            this._date.set_text(this.clock.get_clock());
            this._ampmLabel.set_text("");
            this._dayLabel.set_text("");
        } else {
            let time_format = "%-l:%M";
            this._date.set_text(this.clock.get_clock_for_format(time_format));

            let ampm_format = "%p";
            this._ampmLabel.set_text(this.clock.get_clock_for_format(ampm_format));

            let date_format = "%a, %B %-d";
            this._dayLabel.set_text(this.clock.get_clock_for_format(date_format));
        }
    }
}

function main(metadata, desklet_id) {
    return new MacosClockDesklet(metadata, desklet_id);
}