const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const ByteArray = imports.byteArray;
const uuid = "vaktija-desklet@MuxBH28";

function VaktijaDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

VaktijaDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,
    lastFetchedData: null,
    _init: function (metadata, desklet_id) {
        global.log("Initializing Vaktija desklet");
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.setupUI();
        this.fetchData();
        this.setupMidnightTimer();
        this.setupTimeUpdateInterval();
        this.setupCountdownUpdateInterval();
    },

    setupUI: function () {
        global.log("Setting up UI");
        this.window = new St.Bin();
        this.text = new St.Label({ style_class: 'label' });
        this.text.set_text("Fetching data...");

        this.window.add_actor(this.text);
        this.setContent(this.window);
    },

    fetchData: function () {
        global.log("Fetching data from API");

        let url = "https://api.vaktija.ba/";

        let file = Gio.File.new_for_uri(url);
        file.load_contents_async(null, (obj, result) => {
            try {
                let [success, contents] = obj.load_contents_finish(result);
                if (!success) {
                    global.log("Error fetching data");
                    this.text.set_text("Error fetching data");
                    return;
                }

                let data = ByteArray.toString(contents);
                let json = JSON.parse(data);
                global.log("Data fetched: " + JSON.stringify(json));
                this.lastFetchedData = data;
                this.updateDisplay(json);
            } catch (e) {
                global.log("Error fetching data: " + e.message);
                this.text.set_text("Error fetching data");
            }
        });
    },

    updateDisplay: function (json) {
        let currentTime = new Date().toLocaleTimeString();
        let vakatTimes = [
            "Sabah", "Izlazak", "Podne", "Ikindija", "Akšam", "Jacija"
        ];

        let now = new Date();
        let nextVakat = null;
        let countdown = "";

        for (let i = 0; i < json.vakat.length; i++) {
            let vakatTime = json.vakat[i].split(":");
            let vakatDate = new Date(now);
            vakatDate.setHours(parseInt(vakatTime[0], 10));
            vakatDate.setMinutes(parseInt(vakatTime[1], 10));

            if (vakatDate > now) {
                nextVakat = vakatTimes[i];
                let diff = Math.abs(vakatDate - now) / 1000;
                let hours = Math.floor(diff / 3600) % 24;
                let minutes = Math.floor(diff / 60) % 60;
                let seconds = Math.floor(diff % 60);

                countdown = `${hours}h ${minutes}m ${seconds}s`;
                break;
            }
        }

        let displayText = `
            Trenutno vrijeme: ${currentTime}\n
            Lokacija: ${json.lokacija}\n
            Datum: ${json.datum[1]}\n
            \n
            Do sljedećeg vakta: ${countdown}\n
            Sabah: ${json.vakat[0]}\n
            Izlazak: ${json.vakat[1]}\n
            Podne: ${json.vakat[2]}\n
            Ikindija: ${json.vakat[3]}\n
            Akšam: ${json.vakat[4]}\n
            Jacija: ${json.vakat[5]}
        `;

        this.text.set_text(displayText);
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

    setupTimeUpdateInterval: function () {
        setInterval(() => {
            this.updateTime();
        }, 1000);
    },

    setupCountdownUpdateInterval: function () {
        setInterval(() => {
            this.updateCountdown();
        }, 1000);
    },

    updateTime: function () {
        let currentTime = new Date().toLocaleTimeString();
        let displayText = this.text.get_text();
        displayText = displayText.replace(/Trenutno vrijeme: .+/, `Trenutno vrijeme: ${currentTime}`);
        this.text.set_text(displayText);
    },

    updateCountdown: function () {
        let json = JSON.parse(this.lastFetchedData);

        let now = new Date();
        let currentTime = now.getTime();

        let vakatTimes = [
            { name: "Sabah", time: this.parseTime(json.vakat[0]) },
            { name: "Izlazak", time: this.parseTime(json.vakat[1]) },
            { name: "Podne", time: this.parseTime(json.vakat[2]) },
            { name: "Ikindija", time: this.parseTime(json.vakat[3]) },
            { name: "Akšam", time: this.parseTime(json.vakat[4]) },
            { name: "Jacija", time: this.parseTime(json.vakat[5]) }
        ];

        let nextVakat = null;
        let countdown = "";

        // Pronalazi sljedeći vakat
        for (let i = 0; i < vakatTimes.length; i++) {
            if (vakatTimes[i].time > currentTime) {
                nextVakat = vakatTimes[i];
                break;
            }
        }

        if (nextVakat) {
            let timeUntilNextVakat = nextVakat.time - currentTime;
            let hours = Math.floor(timeUntilNextVakat / (1000 * 60 * 60));
            let minutes = Math.floor((timeUntilNextVakat % (1000 * 60 * 60)) / (1000 * 60));
            let seconds = Math.floor((timeUntilNextVakat % (1000 * 60)) / 1000);

            countdown = `${this.pad(hours)}:${this.pad(minutes)}:${this.pad(seconds)}`;
        } else {
            let firstVakatTomorrow = this.parseTime(json.vakat[0]) + 24 * 60 * 60 * 1000;
            let timeUntilNextVakat = firstVakatTomorrow - currentTime;
            let hours = Math.floor(timeUntilNextVakat / (1000 * 60 * 60)) % 24;
            let minutes = Math.floor((timeUntilNextVakat % (1000 * 60 * 60)) / (1000 * 60));
            let seconds = Math.floor((timeUntilNextVakat % (1000 * 60)) / 1000);

            countdown = `${this.pad(hours)}:${this.pad(minutes)}:${this.pad(seconds)}`;
        }

        let displayText = this.text.get_text();
        displayText = displayText.replace(/Do sljedećeg vakta: .+/, `Do sljedećeg vakta: ${countdown}`);
        this.text.set_text(displayText);
    },

    pad: function (num) {
        return (num < 10 ? '0' : '') + num;
    },

    parseTime: function (timeString) {
        let parts = timeString.split(":");
        let hours = parseInt(parts[0], 10);
        let minutes = parseInt(parts[1], 10);
        return new Date().setHours(hours, minutes, 0, 0);
    },


};

function main(metadata, desklet_id) {
    global.log("Creating new desklet instance");
    return new VaktijaDesklet(metadata, desklet_id);
}
