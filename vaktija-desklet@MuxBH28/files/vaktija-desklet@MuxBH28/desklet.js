const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const ByteArray = imports.byteArray;
const Settings = imports.ui.settings;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;

const uuid = "vaktija-desklet@MuxBH28";

function main(metadata, desklet_id) {
    return new VaktijaDesklet(metadata, desklet_id);
}

function VaktijaDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

VaktijaDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.settings = new Settings.DeskletSettings(this, uuid, desklet_id);

        this.settings.bindProperty(Settings.BindingDirection.IN,
            'api-url', 'apiUrl',
            this.fetchData, this);

        this.settings.bindProperty(Settings.BindingDirection.IN,
            'api-location', 'apiLocation',
            this.fetchData, this);

        this.settings.bindProperty(Settings.BindingDirection.IN,
            'update-interval', 'updateInterval',
            this.setupUpdateInterval, this);

        this.settings.bindProperty(Settings.BindingDirection.IN,
            'show-date', 'showDate',
            this.updateDisplay, this);

        this.settings.bindProperty(Settings.BindingDirection.IN,
            'show-islamic-date', 'showIslamicDate',
            this.updateDisplay, this);

        this.settings.bindProperty(Settings.BindingDirection.IN,
            'show-seconds', 'showSeconds',
            this.updateDisplay, this);

        this.settings.bindProperty(Settings.BindingDirection.IN,
            'height', 'height',
            this.updateDisplay, this);

        this.settings.bindProperty(Settings.BindingDirection.IN,
            'width', 'width',
            this.updateDisplay, this);

        this.settings.bindProperty(Settings.BindingDirection.IN,
            'transparency', 'transparency',
            this.updateAppearance, this);

        this.settings.bindProperty(Settings.BindingDirection.IN,
            'backgroundColor', 'backgroundColor',
            this.updateAppearance, this);

        this.setupUI();
        this.fetchData();
        this.setupMidnightTimer();
        this.setupUpdateInterval();
        this.setupCountdownUpdateInterval();
    },

    setupUI: function () {
        this.window = new St.BoxLayout({ vertical: true });
        this.text = new St.Label({ style_class: 'label' });

        this.window.add_actor(this.text);
        this.setContent(this.window);

        this.updateAppearance();
    },

    updateAppearance: function () {
        this.window.set_width(this.width);
        this.window.set_height(this.height);

        this.window.set_opacity(Math.round(this.transparency * 255));

        let backgroundColor = Clutter.Color.from_string(this.backgroundColor)[1];
        this.window.set_style(`background-color: rgba(${backgroundColor.red}, ${backgroundColor.green}, ${backgroundColor.blue}, ${this.transparency});`);
    },

    fetchData: function () {
        let url = this.apiUrl || "https://api.vaktija.ba/";

        let location = this.apiLocation || 77;

        if (url === "https://api.vaktija.ba/") {
            url = url + 'vaktija/v1/' + location;
        }

        let file = Gio.File.new_for_uri(url);
        file.load_contents_async(null, (obj, result) => {
            try {
                let [success, contents] = obj.load_contents_finish(result);
                if (!success) {
                    this.text.set_text("Error fetching data");
                    return;
                }

                let data = ByteArray.toString(contents);
                this.lastFetchedData = JSON.parse(data);
                this.updateDisplay();
            } catch (e) {
                this.text.set_text("Error fetching data");
            }
        });
    },

    updateDisplay: function () {
        if (!this.lastFetchedData) return;

        let now = new Date();
        let timeFormat = this.showSeconds ? 'HH:mm:ss' : 'HH:mm';
        let formattedTime = this.formatTime(now, timeFormat);

        let showIslamicDate = this.showIslamicDate ? `${this.lastFetchedData.datum[0]}\n` : '';
        let showDate = this.showDate ? `Datum: ${this.lastFetchedData.datum[1]}\n` : '';

        let vakatTimes = [
            "Zora", "Izlazak sunca", "Podne", "Ikindija", "Akšam", "Jacija"
        ];

        let nextVakat = null;
        let countdown = "";

        for (let i = 0; i < this.lastFetchedData.vakat.length; i++) {
            let vakatTime = this.lastFetchedData.vakat[i].split(":");
            let vakatDate = new Date(now);
            vakatDate.setHours(parseInt(vakatTime[0], 10));
            vakatDate.setMinutes(parseInt(vakatTime[1], 10));

            if (vakatDate > now) {
                nextVakat = vakatTimes[i];
                let diff = vakatDate - now;
                let hours = Math.floor(diff / (1000 * 60 * 60));
                let minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                let seconds = Math.floor((diff % (1000 * 60)) / 1000);

                countdown = `${this.pad(hours)}h ${this.pad(minutes)}m ${this.pad(seconds)}s`;
                break;
            }
        }

        if (!nextVakat) {
            let firstVakatTomorrow = this.parseTime(this.lastFetchedData.vakat[0]) + 24 * 60 * 60 * 1000;
            let timeUntilNextVakat = firstVakatTomorrow - now.getTime();
            let hours = Math.floor(timeUntilNextVakat / (1000 * 60 * 60)) % 24;
            let minutes = Math.floor((timeUntilNextVakat % (1000 * 60 * 60)) / (1000 * 60));
            let seconds = Math.floor((timeUntilNextVakat % (1000 * 60)) / 1000);

            countdown = `${this.pad(hours)}h ${this.pad(minutes)}m ${this.pad(seconds)}s`;
        }

        let displayText = `
            Trenutno vrijeme: ${formattedTime}\n
            Lokacija: ${this.lastFetchedData.lokacija}\n
            ${showDate}
            ${showIslamicDate}
            Do sljedećeg vakta: ${countdown}\n
            Zora: ${this.lastFetchedData.vakat[0]}\n
            Izlazak sunca: ${this.lastFetchedData.vakat[1]}\n
            Podne: ${this.lastFetchedData.vakat[2]}\n
            Ikindija: ${this.lastFetchedData.vakat[3]}\n
            Akšam: ${this.lastFetchedData.vakat[4]}\n
            Jacija: ${this.lastFetchedData.vakat[5]}
        `;

        this.text.set_text(displayText);
    },

    formatTime: function (date, format) {
        let hours = date.getHours().toString().padStart(2, '0');
        let minutes = date.getMinutes().toString().padStart(2, '0');
        let seconds = date.getSeconds().toString().padStart(2, '0');

        if (format === 'HH:mm:ss') {
            return `${hours}:${minutes}:${seconds}`;
        } else {
            return `${hours}:${minutes}`;
        }
    },

    setupMidnightTimer: function () {
        let now = new Date();
        let tomorrowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
        let timeUntilMidnight = tomorrowMidnight - now;

        setTimeout(() => {
            this.fetchData();
            this.setupMidnightTimer();
        }, timeUntilMidnight);
    },

    setupUpdateInterval: function () {
        if (this.updateInterval && this.updateInterval > 0) {
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this.updateInterval, () => {
                this.fetchData();
                return GLib.SOURCE_CONTINUE;
            });
        }
    },

    setupCountdownUpdateInterval: function () {
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this.updateDisplay();
            return GLib.SOURCE_CONTINUE;
        });
    },

    pad: function (num) {
        return (num < 10 ? '0' : '') + num;
    },

    parseTime: function (timeString) {
        let [hours, minutes] = timeString.split(':').map(Number);
        let now = new Date();
        let vakatDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
        return vakatDate.getTime();
    }
};
