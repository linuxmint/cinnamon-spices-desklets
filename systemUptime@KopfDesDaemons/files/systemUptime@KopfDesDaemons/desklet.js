const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;

const UUID = "systemUptime@KopfDesDaemons";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

function MyDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.setHeader(_("System Uptime"));

        // Initialize settings
        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], deskletId);

        // Get settings
        this.fontSize = this.settings.getValue("fontSize") || 20;
        this.colorLabel = this.settings.getValue("colorLabel") || "rgb(98, 160, 234)";

        // Bind settings properties
        this.settings.bindProperty(Settings.BindingDirection.IN, "fontSize", "fontSize", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "colorLabel", "colorLabel", this.on_settings_changed, null);

        this.setupLayout();

        this._timeout = null;

        this.getStartupTime();

        // Start the update loop
        this.updateUptime();
    },

    setupLayout: function () {
        // Create label for the static text
        this.uptimeLabel = new St.Label({ text: _("Uptime: "), y_align: St.Align.START, style_class: "label-text" });
        this.uptimeLabel.set_style(`font-size: ${this.fontSize}px; color: ${this.colorLabel};`);

        // Create label 
        this.uptimeValue = new St.Label({ text: "Loading..." });
        this.uptimeValue.set_style(`font-size: ${this.fontSize}px;`);

        // Set up the layout
        this.uptimeRow = new St.BoxLayout();
        this.uptimeRow.add_child(this.uptimeLabel);
        this.uptimeRow.add_child(this.uptimeValue);

        // Create label for the static text
        this.startupTimelabel = new St.Label({ text: _("Startuptime: "), y_align: St.Align.START, style_class: "label-text" });
        this.startupTimelabel.set_style(`font-size: ${this.fontSize}px; color: ${this.colorLabel};`);

        // Create label 
        this.startuptimeValue = new St.Label({ text: "Loading..." });
        this.startuptimeValue.set_style(`font-size: ${this.fontSize}px;`);

        // Set up the layout
        this.startuptimeRow = new St.BoxLayout();
        this.startuptimeRow.add_child(this.startupTimelabel);
        this.startuptimeRow.add_child(this.startuptimeValue);

        this.box = new St.BoxLayout({ vertical: true });
        this.box.set_style("margin-left: 0.5em;");
        this.box.add_child(this.startuptimeRow);
        this.box.add_child(this.uptimeRow);

        const clockIcon = getImageAtScale(this.metadata.path + "/clock.svg", 60, 60, (this.fontSize * 2), 35);

        this.container = new St.BoxLayout();
        this.container.add_child(clockIcon);
        this.container.add_child(this.box);

        this.setContent(this.container);
    },

    updateUptime: function () {
        try {
            // Get system uptime
            const [result, out] = GLib.spawn_command_line_sync("awk '{print $1}' /proc/uptime");

            if (!result || !out) {
                throw new Error("Could not get system uptime.");
            }

            const uptimeInSeconds = parseFloat(out.toString().trim());
            const hours = Math.floor(uptimeInSeconds / 3600);
            const minutes = Math.floor((uptimeInSeconds % 3600) / 60);

            const displayString = `${hours} ${_("hours")} ${minutes} ${_("minutes")}`;
            this.uptimeValue.set_text(displayString);

        } catch (e) {
            this.uptimeValue.set_text("Error");
            global.logError(`systemUptime@KopfDesDaemons: Error while getting system uptime: ${e.message}`);
        }

        // Reset and set up the interval timeout
        if (this._timeout) Mainloop.source_remove(this._timeout);
        this._timeout = Mainloop.timeout_add_seconds(60, () => this.updateUptime());
    },

    getStartupTime: function () {
        const [result, out] = GLib.spawn_command_line_sync("uptime -s");

        if (!result || !out) {
            throw new Error("Could not get system uptime.");
        }

        this.startuptimeValue.set_text(out.toString().split(" ")[1].toString().trim());
    },

    on_settings_changed: function () {
        this.setupLayout();
        this.updateUptime();
        this.getStartupTime();
    },

    on_desklet_removed: function () {
        if (this._timeout) Mainloop.source_remove(this._timeout);
        if (this.uptimeLabel) this.box.remove_child(this.label);
        if (this.uptimeValue) this.box.remove_child(this.uptimeValue);

        this.uptimeLabel = this.uptimeValue = this._timeout = null;
    }
};

function getImageAtScale(imageFileName, width, height, width2 = 0, height2 = 0) {
    if (width2 == 0 || height2 == 0) {
        width2 = width;
        height2 = height;
    }

    const pixBuf = GdkPixbuf.Pixbuf.new_from_file_at_size(imageFileName, width, height);
    const image = new Clutter.Image();
    image.set_data(
        pixBuf.get_pixels(),
        pixBuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGBA_888,
        width, height,
        pixBuf.get_rowstride()
    );

    const actor = new Clutter.Actor({ width: width2, height: height2 });
    actor.set_content(image);

    return actor;
}

function main(metadata, deskletId) {
    return new MyDesklet(metadata, deskletId);
}
