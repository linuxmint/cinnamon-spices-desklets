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
        try {
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

            this.settings.bindProperty(Settings.BindingDirection.IN,
                'language', 'language',
                this.updateDisplay, this);

            this.setupUI();
            this.fetchData();
            this.setupMidnightTimer();
            this.setupUpdateInterval();
            this.setupCountdownUpdateInterval();
        } catch (e) {
            global.logError("Error initializing Vaktija Desklet: " + e.message);
        }
    },

    setupUI: function () {
        try {
            this.window = new St.BoxLayout({ vertical: true });
            this.text = new St.Label({ style_class: 'label', text: 'Loading...' });

            this.window.add_actor(this.text);
            this.setContent(this.window);

            this.updateAppearance();
        } catch (e) {
            global.logError("Error in setupUI: " + e.message);
        }
    },

    updateAppearance: function () {
        try {
            this.window.set_width(this.width);
            this.window.set_height(this.height);

            this.window.set_opacity(Math.round(this.transparency * 255));

            let backgroundColor = Clutter.Color.from_string(this.backgroundColor)[1];
            this.window.set_style(`background-color: rgba(${backgroundColor.red}, ${backgroundColor.green}, ${backgroundColor.blue}, ${this.transparency});`);
        } catch (e) {
            global.logError("Error in updateAppearance: " + e.message);
        }
    },

    fetchData: function () {
        try {
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
                        this.text.set_text(this.getTranslation("Error fetching data"));
                        return;
                    }

                    let data = ByteArray.toString(contents);
                    this.lastFetchedData = JSON.parse(data);
                    this.updateDisplay();
                } catch (e) {
                    global.logError("Error processing fetched data: " + e.message);
                    this.text.set_text(this.getTranslation("Error fetching data"));
                }
            });
        } catch (e) {
            global.logError("Error in fetchData: " + e.message);
        }
    },

    updateDisplay: function () {
        try {
            if (!this.lastFetchedData) {
                global.log("No data available to display.");
                return;
            }

            let now = new Date();
            let timeFormat = this.showSeconds ? 'HH:mm:ss' : 'HH:mm';
            let formattedTime = this.formatTime(now, timeFormat);

            let showIslamicDate = this.showIslamicDate ? `${this.lastFetchedData.datum[0]}\n` : '';
            let showDate = this.showDate ? `${this.getTranslation("Datum")}: ${this.lastFetchedData.datum[1]}\n` : '';

            let vakatTimes = [
                this.getTranslation("Zora"),
                this.getTranslation("Izlazak sunca"),
                this.getTranslation("Podne"),
                this.getTranslation("Ikindija"),
                this.getTranslation("Akšam"),
                this.getTranslation("Jacija")
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
                ${this.getTranslation("Trenutno vrijeme")}: ${formattedTime}\n
                ${this.getTranslation("Lokacija")}: ${this.lastFetchedData.lokacija}\n
                ${showDate}
                ${showIslamicDate}
                ${this.getTranslation("Sljedeći vakat")}: ${countdown}\n
                ${this.getTranslation("Zora")}: ${this.lastFetchedData.vakat[0]}\n
                ${this.getTranslation("Izlazak sunca")}: ${this.lastFetchedData.vakat[1]}\n
                ${this.getTranslation("Podne")}: ${this.lastFetchedData.vakat[2]}\n
                ${this.getTranslation("Ikindija")}: ${this.lastFetchedData.vakat[3]}\n
                ${this.getTranslation("Akšam")}: ${this.lastFetchedData.vakat[4]}\n
                ${this.getTranslation("Jacija")}: ${this.lastFetchedData.vakat[5]}
            `;

            this.text.set_text(displayText);
        } catch (e) {
            global.logError("Error in updateDisplay: " + e.message);
            this.text.set_text(this.getTranslation("Error fetching data"));
        }
    },

    setupUpdateInterval: function () {
        if (this.updateIntervalId) {
            GLib.source_remove(this.updateIntervalId);
        }

        this.updateIntervalId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this.updateInterval * 60, () => {
            this.fetchData();
            return GLib.SOURCE_CONTINUE;
        });
    },

    setupMidnightTimer: function () {
        let now = new Date();
        let midnight = new Date();
        midnight.setHours(24, 0, 0, 0);
        let timeUntilMidnight = midnight.getTime() - now.getTime();

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeUntilMidnight, () => {
            this.fetchData();
            this.setupMidnightTimer();
            return GLib.SOURCE_REMOVE;
        });
    },

    setupCountdownUpdateInterval: function () {
        if (this.countdownUpdateIntervalId) {
            GLib.source_remove(this.countdownUpdateIntervalId);
        }

        this.countdownUpdateIntervalId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this.updateDisplay();
            return GLib.SOURCE_CONTINUE;
        });
    },

    pad: function (number) {
        return number.toString().padStart(2, '0');
    },

    parseTime: function (timeString) {
        let parts = timeString.split(":");
        let date = new Date();
        date.setHours(parseInt(parts[0], 10));
        date.setMinutes(parseInt(parts[1], 10));
        date.setSeconds(0);
        date.setMilliseconds(0);
        return date.getTime();
    },

    formatTime: function (date, format) {
        let hours = this.pad(date.getHours());
        let minutes = this.pad(date.getMinutes());
        let seconds = this.pad(date.getSeconds());

        return format === 'HH:mm:ss' ? `${hours}:${minutes}:${seconds}` : `${hours}:${minutes}`;
    },

    getTranslation: function (text) {
        if (this.language === "en") {
            const translations = {
                "Datum": "Date",
                "Trenutno vrijeme": "Current Time",
                "Lokacija": "Location",
                "Sljedeći vakat": "Next prayer",
                "Zora": "Fajr",
                "Izlazak sunca": "Sunrise",
                "Podne": "Dhuhr",
                "Ikindija": "Asr",
                "Akšam": "Maghrib",
                "Jacija": "Isha",
                "Error fetching data": "Error fetching data"
            };
            return translations[text] || text;
        } else if (this.language === "ar") {
            const translations = {
                "Datum": "تاريخ",
                "Trenutno vrijeme": "الوقت الحالي",
                "Lokacija": "الموقع",
                "Sljedeći vakat": "الصلاة القادمة",
                "Zora": "الفجر",
                "Izlazak sunca": "الشروق",
                "Podne": "الظهر",
                "Ikindija": "العصر",
                "Akšam": "المغرب",
                "Jacija": "العشاء",
                "Error fetching data": "خطأ في جلب البيانات"
            };
            return translations[text] || text;
        }
        return text;
    }
};
