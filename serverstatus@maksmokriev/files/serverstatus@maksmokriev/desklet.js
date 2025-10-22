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
        this.icon_TOTAL_ERROR = "error";

        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);

        this.settings.bind("ServerNames", "ServerNames", this.onSettingsChanged.bind(this));
        this.settings.bind("TimeRepeat", "TimeRepeat", this.onSettingsChanged.bind(this));
        this.settings.bind("TextColorBasic", "TextColorBasic", this.onSettingsChanged.bind(this));
        this.settings.bind("TextColorOK", "TextColorOK", this.onSettingsChanged.bind(this));
        this.settings.bind("TextColorWARN", "TextColorWARN", this.onSettingsChanged.bind(this));
        this.settings.bind("TextColorERR", "TextColorERR", this.onSettingsChanged.bind(this));
        this.settings.bind("ContainerBgColor", "ContainerBgColor", this.onSettingsBgChanged.bind(this));
        this.settings.bind("BoxBgColor", "BoxBgColor", this.onSettingsChanged.bind(this));
        this.settings.bind("icon_OK", "icon_OK", this.onSettingsChanged.bind(this));
        this.settings.bind("icon_ERR", "icon_ERR", this.onSettingsChanged.bind(this));
        this.settings.bind("icon_WARN", "icon_WARN", this.onSettingsChanged.bind(this));

        this.setValues();

        this.container = new St.BoxLayout({
            vertical: true,
            style_class: "container",
            style: "background-color: " + this.ContainerBgColor
        });

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
        this.icon_OK = this.settings.getValue("icon_OK");
        this.icon_ERR = this.settings.getValue("icon_ERR");
        this.icon_WARN = this.settings.getValue("icon_WARN");
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
        this.container.style = "background-color: " + this.ContainerBgColor;
    },

    updateServersDisplay: function() {
        this.servers = this.serverDefinitions.map(server => {
            if (server.display === true) {
                let icon = new St.Icon({ icon_name: "gtk-connect", icon_size: 22 });
                let label = new St.Label({ style_class: "init" });
                label.style = "color: " + this.TextColorBasic;
                label.text = server.name +  _(" - Checking ...");
                let hbox = new St.BoxLayout({ x_align: St.Align.START, style_class: "box" });
                hbox.style = "background-color: " + this.BoxBgColor;
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
                        server.label.text = server.name + " - OK";
                        server.label.style = "color: " + this.TextColorOK;
                        server.icon.icon_name = this.icon_OK;
                    } else {
                        server.label.text = server.name + " - ERR";
                        server.label.style = "color: " + this.TextColorERR;
                        server.icon.icon_name = this.icon_ERR;
                    }
                } catch (e) {
                    global.logError(_("Error ping command on ") + server.ip + ": " + e);
                    server.label.text = server.name + ": " + _("Error");
                    server.label.style_class = "init error";
                    server.icon.icon_name = this.icon_TOTAL_ERROR;
                }
            });
        } catch (e) {
            global.logError(_("Error creating ping process ") + server.ip + ": " + e);
            server.label.text = server.name + ": " + _("Error");
            server.label.style_class = "init error";
            server.icon.icon_name = this.icon_TOTAL_ERROR;
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
                        server.label.text = server.name + " - OK";
                        server.label.style = "color: " + this.TextColorOK;
                        server.icon.icon_name = this.icon_OK;
                    } else if (httpCode === 500) {
                        server.label.text = server.name + " - WARN";
                        server.label.style = "color: " + this.TextColorWARN;
                        server.icon.icon_name = this.icon_WARN;
                    } else {
                        server.label.text = server.name + " - ERR";
                        server.label.style = "color: " + this.TextColorERR;
                        server.icon.icon_name = this.icon_ERR;
                    }
                } catch (e) {
                    global.logError(_("Error curl command on ") + server.ip + ": " + e);
                    server.label.text = server.name + ": " + _("Error");
                    server.label.style_class = "init error";
                    server.icon.icon_name = this.icon_TOTAL_ERROR;
                }
            });
        } catch (e) {
            global.logError(_("Error creating curl process ") + server.ip + ": " + e);
            server.label.text = server.name + ": " + _("Error");
            server.label.style_class = "init error";
            server.icon.icon_name = this.icon_TOTAL_ERROR;
        }
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
