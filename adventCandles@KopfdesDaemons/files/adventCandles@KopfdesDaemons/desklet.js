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

const UUID = "adventCandles@KopfdesDaemons";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);
        this.setHeader(_("Advent Candles"));

        this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);

        // Bind settings properties
        this.settings.bindProperty(Settings.BindingDirection.IN, "deskletScale", "deskletScale");
        this.settings.bindProperty(Settings.BindingDirection.IN, "animationSpeed", "animationSpeed");

        this.deskletScale = this.settings.getValue("deskletScale") || 1;
        this.animationSpeed = this.settings.getValue("animationSpeed") || 300;

        this.metadata["prevent-decorations"] = true;
        this._updateDecoration();
        this.loadImage();

        this._animationTimeout = null;
        this._refreshTimeout = null;
        this.refreshLoop();
    }

    getAdventCandlesNumber() {
        const today = new Date();
        const year = today.getFullYear();
        const christmas = new Date(year, 11, 25);

        // Calculate the first Advent Sunday of the year
        // Advent starts four Sundays before Christmas. This adjusts for the day of the week,
        // ensuring the first Advent is on a Sunday. If Christmas is not Sunday, 
        // backtrack to the nearest Sunday and subtract three more weeks.
        const firstAdvent = new Date(christmas);
        firstAdvent.setDate(christmas.getDate() - ((christmas.getDay() || 7) + 21));

        // Define the start of the next year
        const newYear = new Date(year + 1, 0, 1);

        // If today is already in the next year, no candles should be lit
        if (today >= newYear) return 0;

        let candles = 0;

        // Loop through the four Sundays of Advent
        for (let i = 0; i < 4; i++) {
            // Calculate the date of each Advent Sunday
            const adventSunday = new Date(firstAdvent);
            adventSunday.setDate(firstAdvent.getDate() + i * 7);

            // Check if today is on or after the Advent Sunday
            // Increment the candle count for each Advent Sunday that has passed
            if (adventSunday.getDay() === 0 && today >= adventSunday) {
                candles++;
            }
        }

        // Return the number of candles to be lit
        return candles;
    }

    refreshLoop() {
        const candles = this.getAdventCandlesNumber();
        if (this.candles !== candles) this.loadImage();
        global.log("Advent Candles: " + candles + ' ' + this.candles);
        if (this._refreshTimeout) Mainloop.source_remove(this._refreshTimeout);
        this._refreshTimeout = Mainloop.timeout_add_seconds(60, Lang.bind(this, this.refreshLoop));
    }

    loadImage() {
        // Paths
        const deskletPath = this.metadata.path;
        const imageFolder = deskletPath + "/images/";
        this.candles = this.getAdventCandlesNumber();

        if (this.candles === 0) {
            this.setContent(this.getImageAtScale(imageFolder + "no-candles.svg", 350 * this.deskletScale, 198 * this.deskletScale));
            return;
        }

        const imageFolderCandles = imageFolder + this.candles + "-candle/";

        // Randomly select a candle image
        if (!this._lastRandomNumber) this._lastRandomNumber = 0;
        let randomNumber;
        do randomNumber = Math.floor(Math.random() * 3) + 1;
        while (randomNumber === this._lastRandomNumber);
        this._lastRandomNumber = randomNumber;

        // Load the candle image
        const imagePath = imageFolderCandles + "frame-" + randomNumber + ".svg";
        this.setContent(this.getImageAtScale(imagePath, 350 * this.deskletScale, 198 * this.deskletScale));

        // Schedule the next update
        if (this._animationTimeout) Mainloop.source_remove(this._animationTimeout);
        this._animationTimeout = Mainloop.timeout_add(this.animationSpeed, () => this.loadImage());
    }

    on_desklet_removed() {
        if (this._animationTimeout) Mainloop.source_remove(this._animationTimeout);
        if (this._refreshTimeout) Mainloop.source_remove(this._refreshTimeout);
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
