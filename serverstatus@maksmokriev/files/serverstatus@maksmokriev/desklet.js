const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Settings = imports.ui.settings;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Gettext = imports.gettext;

const UUID = "serverstatus@maksmokriev";


function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.setHeader(_("Server Status"));
        this.serverDefinitions = [];

        this.iconMap = {
            OK: "\u25CF",
            ERROR: "\u25C9",
            WARNING: "\u25C9",
            LOADING: "\u25CB"
        };

        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);

        this.settings.bind("ServerNames", "ServerNames", this.onSettingsChanged.bind(this));
        this.settings.bind("TimeRepeat", "TimeRepeat", this.onSettingsChanged.bind(this));
        this.settings.bind("TextColorBasic", "TextColorBasic", this.onSettingsChanged.bind(this));
        this.settings.bind("TextColorOK", "TextColorOK", this.onSettingsChanged.bind(this));
        this.settings.bind("TextColorWARN", "TextColorWARN", this.onSettingsChanged.bind(this));
        this.settings.bind("TextColorERR", "TextColorERR", this.onSettingsChanged.bind(this));
        this.settings.bind("ContainerBgColor", "ContainerBgColor", this.onSettingsBgChanged.bind(this));
        this.settings.bind("BoxBgColor", "BoxBgColor", this.onSettingsBgChanged.bind(this));
        this.settings.bind("FontSize", "FontSize", this.onSettingsBgChanged.bind(this));
        this.settings.bind("ContainerFixedWidth", "ContainerFixedWidth", this.onSettingsBgChanged.bind(this));
        this.settings.bind("ContainerWidth", "ContainerWidth", this.onSettingsBgChanged.bind(this));

        this.setValues();

        this.container = new St.BoxLayout({
            vertical: true,
            style_class: "container",
            style: "background-color: " + this.ContainerBgColor
        });
        this.onSettingsBgChanged();

        this.setContent(this.container);
        this.isConfigured();
    },

    setValues: function() {
        const allServers = this.settings.getValue("ServerNames");
        this.serverDefinitions = allServers ? allServers.filter(server => server.display === true) : [];
        this.TimeRepeat = this.settings.getValue("TimeRepeat");
        this.TextColorBasic = this.settings.getValue("TextColorBasic");
        this.TextColorOK = this.settings.getValue("TextColorOK");
        this.TextColorWARN = this.settings.getValue("TextColorWARN");
        this.TextColorERR = this.settings.getValue("TextColorERR");
        this.ContainerBgColor = this.settings.getValue("ContainerBgColor");
        this.BoxBgColor = this.settings.getValue("BoxBgColor");
        this.FontSize = this.settings.getValue("FontSize");
        this.ContainerFixedWidth = this.settings.getValue("ContainerFixedWidth");
        this.ContainerWidth = this.settings.getValue("ContainerWidth");

        this.iconColorMap = {
            OK: this.TextColorOK,
            ERROR: this.TextColorERR,
            WARNING: this.TextColorWARN,
            LOADING: this.TextColorBasic
        }
    },

    isConfigured: function() {
        if (!this.serverDefinitions || this.serverDefinitions.length === 0) {
            let label = new St.Label({ text: _("Need to setup"), style: "color: #fff;" });
            this.container.add(label);

        } else {
            this.updateServersDisplay();
            //Delay the first updateStatus call by 10 seconds
            Mainloop.timeout_add_seconds(5, () => {
                this.updateStatus();
                //After the first call, we start a periodic update
                this.mainloop = Mainloop.timeout_add_seconds(this.TimeRepeat, () => {
                    this.updateStatus();
                    return true;
                });
                return false; //Return false so that this timer only runs once
            });
        }
    },

    onSettingsChanged: function() {
        this.setValues();
        this.container.destroy_all_children();
        this.isConfigured();
    },

    onSettingsBgChanged: function() {
        const width = this.ContainerFixedWidth ? this.ContainerWidth + "px" : "100%";
        this.container.style = "background-color: " + this.ContainerBgColor + "; width: " + width;
    },

    updateServersDisplay: function() {
        this.servers = this.serverDefinitions.map(server => {
            if (server.display === true) {
                let icon = new St.Label({
                    style_class: "init",
                    style: "color: " + this.TextColorBasic + "; font-size: " + this.FontSize + "px;",
                    text: this.iconMap.LOADING
                });
                let label = new St.Label({
                    style_class: "init",
                    style: "color: " + this.TextColorBasic + "; font-size: " + this.FontSize + "px;",
                    text: server.name
                });
                let hbox = new St.BoxLayout({
                    x_align: St.Align.START,
                    style_class: "box",
                    style: "background-color: " + this.BoxBgColor
                });
                hbox.add(icon);
                hbox.add(label);
                return { ...server, icon, label, hbox };
            }
        });

        let vbox = new St.BoxLayout({ vertical: true });
        this.servers.forEach(server => vbox.add(server.hbox));

        this.container.add(vbox);
    },

    updateStatus: function() {
        this.servers.forEach(server => this.checkServer(server));
    },

    checkServer: function(server) {
        if (server.type === "ping") {
            this.checkPing(server);
        } else if (server.type === "http" || server.type === "https") {
            this.checkHttp(server);
        }
    },

    checkPing: function(server) {
        try {
            let proc = Gio.Subprocess.new(
                ["/bin/ping", "-c", "1", "-W", "10", server.ip],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    let [ok, out, err] = proc.communicate_utf8_finish(res);
                    let status = proc.get_exit_status();

                    if (status === 0) {
                        this.setServerStatus(server, "OK");
                    } else {
                        this.setServerStatus(server, "ERROR");
                    }
                } catch (e) {
                    global.logError(_("Error ping command on ") + server.ip + ": " + e);
                    server.label.style_class = "init error";
                    this.setServerStatus(server, "ERROR");
                }
            });
        } catch (e) {
            global.logError(_("Error creating ping process ") + server.ip + ": " + e);
            server.label.style_class = "init error";
            this.setServerStatus(server, "ERROR");
        }
    },

    checkHttp: function(server) {
        try {
            let proc = Gio.Subprocess.new(
                ["/usr/bin/curl", "-ILs", "-w", "%{http_code}", "-m", "10", server.type + "://" + server.ip],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    let [ok, out, err] = proc.communicate_utf8_finish(res);
                    let lines = out.trim().split("\n");
                    let httpCode = parseInt(lines[lines.length - 1]);

                    if (httpCode === 200) {
                        this.setServerStatus(server, "OK");
                    } else if (httpCode === 500) {
                        this.setServerStatus(server, "WARNING");
                    } else {
                        this.setServerStatus(server, "ERROR");
                    }
                } catch (e) {
                    global.logError(_("Error curl command on ") + server.ip + ": " + e);
                    server.label.style_class = "init error";
                    this.setServerStatus(server, "ERROR");
                }
            });
        } catch (e) {
            global.logError(_("Error creating curl process ") + server.ip + ": " + e);
            server.label.style_class = "init error";
            this.setServerStatus(server, "ERROR");
        }
    },

    setServerStatus: function(server, status) {
        server.icon.text = this.iconMap[status];
        server.icon.style = "color: " + this.iconColorMap[status] + "; font-size: " + this.FontSize + "px;";
        server.label.style = "color: " + this.iconColorMap[status] + "; font-size: " + this.FontSize + "px;";
    },

    on_desklet_removed: function() {
        if (this.mainloop) {
            Mainloop.source_remove(this.mainloop);
        }
    }
};

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}
