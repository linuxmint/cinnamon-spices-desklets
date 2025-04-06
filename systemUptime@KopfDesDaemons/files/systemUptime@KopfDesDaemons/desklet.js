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

class MyDesklet extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);

        this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);

        // Bind settings properties
        this.settings.bindProperty(Settings.BindingDirection.IN, "fontSize", "fontSize", this.onSettingsChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "colorLabel", "colorLabel", this.onSettingsChanged.bind(this));

        this.fontSize = this.settings.getValue("fontSize") || 20;
        this.colorLabel = this.settings.getValue("colorLabel") || "rgb(51, 209, 122)";
        this._timeout = null;

        this.setHeader(_("System Uptime"));
        this.setupLayout();
        this.getStartupTime();
        this.updateUptime();
    }

    setupLayout() {
        // Create labels for uptime
        this.uptimeLabel = this.createLabel(_("Uptime:") + " ", this.colorLabel);
        this.uptimeValue = this.createLabel(_("Loading..."));

        const uptimeRow = this.createRow([this.uptimeLabel, this.uptimeValue]);

        // Create labels for startup time
        this.startTimeLabel = this.createLabel(_("System start time:") + " ", this.colorLabel);
        this.startupValue = this.createLabel(_("Loading..."));

        const startupRow = this.createRow([this.startTimeLabel, this.startupValue]);

        // Combine all into the main container
        const contentBox = new St.BoxLayout({ vertical: true });
        contentBox.set_style("margin-left: 0.5em;");
        contentBox.add_child(startupRow);
        contentBox.add_child(uptimeRow);

        this.container = new St.BoxLayout();
        this.container.add_child(contentBox);

        Mainloop.idle_add(() => {
            let computedHeight = contentBox.get_height();
            global.log("Computed height in idle: " + computedHeight);

            const clockIcon = this.getImageAtScale(
                `${this.metadata.path}/clock.svg`,
                computedHeight,
                computedHeight,
            );

            this.container.insert_child_below(clockIcon, contentBox);
            clockIcon.queue_relayout();

            return false;
        });

        this.setContent(this.container);
    }

    createLabel(text, color = "inherit") {
        return new St.Label({
            text,
            y_align: St.Align.START,
            style: `font-size: ${this.fontSize}px; color: ${color};`
        });
    }

    createRow(children) {
        const row = new St.BoxLayout();
        children.forEach(child => row.add_child(child));
        return row;
    }

    updateUptime() {
        try {
            const [result, out] = GLib.spawn_command_line_sync("awk '{print $1}' /proc/uptime");
            if (!result || !out) throw new Error("Could not get system uptime.");

            const uptimeInSeconds = parseFloat(out.toString().trim());
            const hours = Math.floor(uptimeInSeconds / 3600);
            const minutes = Math.floor((uptimeInSeconds % 3600) / 60);

            this.uptimeValue.set_text(`${hours} ${_("hours")} ${minutes} ${_("minutes")}`);
        } catch (error) {
            this.uptimeValue.set_text("Error");
            global.logError(`${UUID}: ${error.message}`);
        }

        if (this._timeout) Mainloop.source_remove(this._timeout);
        this._timeout = Mainloop.timeout_add_seconds(60, () => this.updateUptime());
    }

    getStartupTime() {
        try {
            const [result, out] = GLib.spawn_command_line_sync("uptime -s");
            if (!result || !out) throw new Error("Could not get system startup time.");

            this.startupValue.set_text(out.toString().split(" ")[1].trim());
        } catch (error) {
            this.startupValue.set_text("Error");
            global.logError(`${UUID}: ${error.message}`);
        }
    }

    onSettingsChanged() {
        this.setupLayout();
        this.updateUptime();
        this.getStartupTime();
    }

    on_desklet_removed() {
        if (this._timeout) Mainloop.source_remove(this._timeout);
    }

    getImageAtScale(imageFileName, width, height) {
        const pixBuf = GdkPixbuf.Pixbuf.new_from_file_at_size(imageFileName, width, height);
        const image = new Clutter.Image();
        image.set_data(
            pixBuf.get_pixels(),
            pixBuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGBA_888,
            width, height,
            pixBuf.get_rowstride()
        );

        const actor = new Clutter.Actor({ width, height });
        actor.set_content(image);
        return actor;
    }
}

function main(metadata, deskletId) {
    return new MyDesklet(metadata, deskletId);
}
