const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Soup = imports.gi.Soup;

const CONFIG_FILE = GLib.get_home_dir() + "/.config/onocoy-monitor/stations.json";
const OUTPUT_FILE = GLib.get_home_dir() + "/.config/onocoy-monitor/zenity_out.txt";
const UPDATE_INTERVAL = 60;

function OnocoyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

OnocoyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.stations = [];
        this._currency = "USD";
        this._tokenPriceUSD = null;
        this._eurRate = null;
        this._loadConfig();
        this._buildUI();
        this._fetchAll();
        this._fetchTokenPrice();
        this._startTimer();
    },

    _loadConfig: function() {
        try {
            GLib.mkdir_with_parents(GLib.get_home_dir() + "/.config/onocoy-monitor", 0o755);
            if (GLib.file_test(CONFIG_FILE, GLib.FileTest.EXISTS)) {
                let [ok, contents] = GLib.file_get_contents(CONFIG_FILE);
                if (ok) this.stations = JSON.parse(new TextDecoder().decode(contents));
            }
        } catch(e) {
            this.stations = [];
        }
    },

    _saveConfig: function() {
        try {
            GLib.file_set_contents(CONFIG_FILE, JSON.stringify(this.stations, null, 2));
        } catch(e) {}
    },

    _buildUI: function() {
        this.mainBox = new St.BoxLayout({
            vertical: true,
            style: "background-color: #1a1a2e; padding: 16px; border-radius: 11px; min-width: 373px;"
        });

        // Title
        let titleRow = new St.BoxLayout({ vertical: false, style: "margin-bottom: 11px;" });

        try {
            let icon = new St.Icon({
                gicon: Gio.icon_new_for_string(this.metadata.path + "/ono.svg"),
                icon_size: 27,
                style: "margin-right: 8px;"
            });
            titleRow.add(icon);
        } catch(e) {}

        let title = new St.Label({
            text: "Onocoy Monitor",
            style: "color: #00d4ff; font-size: 19px; font-weight: bold;"
        });
        titleRow.add(title);
        this.mainBox.add(titleRow);

        // Token Price
        let priceRow = new St.BoxLayout({
            vertical: false,
            style: "background-color: #16213e; padding: 8px 11px; border-radius: 8px; margin-bottom: 11px;"
        });

        let priceIcon = new St.Label({
            text: "💰 ONO: ",
            style: "color: #ffd700; font-size: 16px; font-weight: bold;"
        });

        this.priceLabel = new St.Label({
            text: "Loading...",
            style: "color: #ffffff; font-size: 16px; font-weight: bold;"
        });

        let currBtn = new St.Button({
            label: "USD/EUR",
            style: "background-color: #0f3460; color: #00d4ff; font-size: 13px; padding: 3px 8px; border-radius: 5px; border: 1px solid #00d4ff; margin-left: 11px;"
        });
        currBtn.connect("clicked", Lang.bind(this, function() {
            this._currency = (this._currency === "USD") ? "EUR" : "USD";
            this._updatePriceLabel();
        }));

        priceRow.add(priceIcon);
        priceRow.add(this.priceLabel, {expand: true});
        priceRow.add(currBtn);
        this.mainBox.add(priceRow);

        // Stations Box
        this.stationBox = new St.BoxLayout({ vertical: true });
        this.mainBox.add(this.stationBox);

        // Buttons
        let btnBox = new St.BoxLayout({ vertical: false, style: "margin-top: 13px; spacing: 8px;" });

        let addBtn = new St.Button({
            label: "➕ Add Station",
            style: "background-color: #16213e; color: #00d4ff; font-size: 15px; padding: 7px 11px; border-radius: 5px; border: 1px solid #00d4ff;"
        });
        addBtn.connect("clicked", Lang.bind(this, this._addStation));

        let refreshBtn = new St.Button({
            label: "🔄 Refresh",
            style: "background-color: #16213e; color: #00d4ff; font-size: 15px; padding: 7px 11px; border-radius: 5px; border: 1px solid #00d4ff;"
        });
        refreshBtn.connect("clicked", Lang.bind(this, function() {
            this._fetchAll();
            this._fetchTokenPrice();
        }));

        btnBox.add(addBtn, {expand: true});
        btnBox.add(refreshBtn, {expand: true});
        this.mainBox.add(btnBox);

        // Last update
        this.lastUpdateLabel = new St.Label({
            text: "Not yet updated",
            style: "color: #555; font-size: 13px; margin-top: 5px;"
        });
        this.mainBox.add(this.lastUpdateLabel);

        this.setContent(this.mainBox);
        this._updateStationUI();
    },

    _updateStationUI: function() {
        let children = this.stationBox.get_children();
        for (let c of children) this.stationBox.remove_actor(c);

        if (this.stations.length === 0) {
            let empty = new St.Label({
                text: "No stations added. Click ➕ to add one.",
                style: "color: #555; font-size: 15px; padding: 11px 0;"
            });
            this.stationBox.add(empty);
            return;
        }

        for (let i = 0; i < this.stations.length; i++) {
            let s = this.stations[i];

            let row = new St.BoxLayout({
                vertical: false,
                style: "background-color: #16213e; padding: 8px 11px; border-radius: 8px; margin-bottom: 5px; spacing: 8px;"
            });

            let dotColor = s.is_up === null ? "#888888" : (s.is_up ? "#00ff88" : "#ff4444");
            let statusDot = new St.Label({
                text: "●",
                style: "color: " + dotColor + "; font-size: 19px;"
            });

            let nameLabel = new St.Label({
                text: (s.nickname || s.id),
                style: "color: #ffffff; font-size: 16px; font-weight: bold;"
            });

            let satsText = (s.sats !== undefined && s.sats !== null) ? "  🛰 " + s.sats + " Sats" : "";
            let idLabel = new St.Label({
                text: s.id + " — " + (s.detail || "Unknown") + satsText,
                style: "color: #888; font-size: 13px;"
            });

            let infoBox = new St.BoxLayout({ vertical: true });
            infoBox.add(nameLabel);
            infoBox.add(idLabel);

            let delBtn = new St.Button({
                label: "✕",
                style: "color: #ff4444; font-size: 15px; padding: 3px 7px; border-radius: 4px; background-color: transparent;"
            });
            (function(idx) {
                delBtn.connect("clicked", Lang.bind(this, function() {
                    this.stations.splice(idx, 1);
                    this._saveConfig();
                    this._updateStationUI();
                }));
            }).call(this, i);

            row.add(statusDot);
            row.add(infoBox, {expand: true});
            row.add(delBtn);
            this.stationBox.add(row);
        }

        let now = new Date();
        let h = now.getHours().toString().padStart(2, "0");
        let m = now.getMinutes().toString().padStart(2, "0");
        if (this.lastUpdateLabel) this.lastUpdateLabel.set_text("Last updated: " + h + ":" + m);
    },

    _fetchAll: function() {
        for (let i = 0; i < this.stations.length; i++) {
            this._fetchStation(i);
        }
    },

    _fetchStation: function(index) {
        let station = this.stations[index];
        if (!station) return;

        try {
            let session = Soup.Session.new();
            let url = "https://api.onocoy.com/api/v1/explorer/server/" + station.id + "/info";
            let message = Soup.Message.new("GET", url);

            session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                Lang.bind(this, function(sess, result) {
                    try {
                        let bytes = sess.send_and_read_finish(result);
                        let raw = new TextDecoder().decode(bytes.get_data());
                        let data = JSON.parse(raw);
                        this.stations[index].is_up = (data.status && data.status.is_up === true);
                        this.stations[index].sats = data.sats || 0;
                        this.stations[index].detail = this.stations[index].is_up ? "Online" : "Offline";
                    } catch(e) {
                        this.stations[index].is_up = false;
                        this.stations[index].sats = 0;
                        this.stations[index].detail = "Error";
                    }
                    this._updateStationUI();
                })
            );
        } catch(e) {
            this.stations[index].is_up = false;
            this.stations[index].sats = 0;
            this.stations[index].detail = "Error";
            this._updateStationUI();
        }
    },

    _fetchTokenPrice: function() {
        try {
            let session = Soup.Session.new();
            let url = "https://api.dexscreener.com/latest/dex/tokens/onoyC1ZjHNtT2tShqvVSg5WEcQDbu5zht6sdU9Nwjrc";
            let message = Soup.Message.new("GET", url);

            session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                Lang.bind(this, function(sess, result) {
                    try {
                        let bytes = sess.send_and_read_finish(result);
                        let raw = new TextDecoder().decode(bytes.get_data());
                        let data = JSON.parse(raw);
                        let pair = data.pairs[0];
                        this._tokenPriceUSD = parseFloat(pair.priceUsd);
                        this._fetchEurRate();
                    } catch(e) {
                        if (this.priceLabel) this.priceLabel.set_text("N/A");
                    }
                })
            );
        } catch(e) {
            if (this.priceLabel) this.priceLabel.set_text("N/A");
        }
    },

    _fetchEurRate: function() {
        try {
            let session = Soup.Session.new();
            let url = "https://api.frankfurter.app/latest?from=USD&to=EUR";
            let message = Soup.Message.new("GET", url);

            session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                Lang.bind(this, function(sess, result) {
                    try {
                        let bytes = sess.send_and_read_finish(result);
                        let raw = new TextDecoder().decode(bytes.get_data());
                        let data = JSON.parse(raw);
                        this._eurRate = data.rates.EUR;
                        this._updatePriceLabel();
                    } catch(e) {
                        this._eurRate = 0.92;
                        this._updatePriceLabel();
                    }
                })
            );
        } catch(e) {
            this._eurRate = 0.92;
            this._updatePriceLabel();
        }
    },

    _updatePriceLabel: function() {
        if (!this.priceLabel || this._tokenPriceUSD === null) return;
        if (this._currency === "EUR" && this._eurRate) {
            let eur = (this._tokenPriceUSD * this._eurRate).toFixed(4);
            this.priceLabel.set_text("€" + eur);
        } else {
            this.priceLabel.set_text("$" + this._tokenPriceUSD.toFixed(4));
        }
    },

    _addStation: function() {
        try { GLib.spawn_command_line_sync("rm -f " + OUTPUT_FILE); } catch(e) {}

        let script = '#!/bin/bash\n' +
            'result=$(zenity --forms \\\n' +
            '  --title="Add Station" \\\n' +
            '  --text="Add your Onocoy station" \\\n' +
            '  --add-entry="Station ID (e.g. DEUBAVWEN1)" \\\n' +
            '  --add-entry="Nickname" \\\n' +
            '  --separator="|" 2>/dev/null)\n' +
            'if [ $? -eq 0 ]; then\n' +
            '  echo "$result" > "' + OUTPUT_FILE + '"\n' +
            'fi\n';

        let scriptFile = GLib.get_home_dir() + "/.config/onocoy-monitor/add_station.sh";
        GLib.file_set_contents(scriptFile, script);
        GLib.spawn_command_line_sync("chmod +x " + scriptFile);
        GLib.spawn_command_line_async("bash " + scriptFile);

        let attempts = 0;
        Mainloop.timeout_add_seconds(1, Lang.bind(this, function() {
            attempts++;
            if (GLib.file_test(OUTPUT_FILE, GLib.FileTest.EXISTS)) {
                try {
                    let [ok, contents] = GLib.file_get_contents(OUTPUT_FILE);
                    if (ok) {
                        let result = new TextDecoder().decode(contents).trim();
                        let parts = result.split("|");
                        let id = parts[0] ? parts[0].trim().toUpperCase() : "";
                        let nickname = parts[1] ? parts[1].trim() : id;
                        if (id.length > 0) {
                            this.stations.push({ id: id, nickname: nickname, is_up: null, detail: "Loading..." });
                            this._saveConfig();
                            this._updateStationUI();
                            this._fetchStation(this.stations.length - 1);
                        }
                    }
                } catch(e) {}
                GLib.spawn_command_line_sync("rm -f " + OUTPUT_FILE);
                return false;
            }
            if (attempts >= 60) return false;
            return true;
        }));
    },

    _startTimer: function() {
        this._timeout = Mainloop.timeout_add_seconds(UPDATE_INTERVAL, Lang.bind(this, function() {
            this._fetchAll();
            this._fetchTokenPrice();
            return true;
        }));
    },

    on_desklet_removed: function() {
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }
    }
};

function main(metadata, desklet_id) {
    return new OnocoyDesklet(metadata, desklet_id);
}

