/* global imports, global */
const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Util = imports.misc.util;

const UUID = "fritzbox@emanuelegori";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");
function _(str) { return Gettext.dgettext(UUID, str); }

// SOAP endpoints TR-064 / IGD UPnP (porta 49000, no auth).
// Ogni voce: path + service URN + action + lista campi XML da estrarre.
const CALLS = {
    linkProps: {
        path: "/igdupnp/control/WANCommonIFC1",
        service: "urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1",
        action: "GetCommonLinkProperties",
        fields: ["NewPhysicalLinkStatus", "NewWANAccessType",
                 "NewLayer1DownstreamMaxBitRate", "NewLayer1UpstreamMaxBitRate"]
    },
    addonInfos: {
        path: "/igdupnp/control/WANCommonIFC1",
        service: "urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1",
        action: "GetAddonInfos",
        fields: ["NewByteSendRate", "NewByteReceiveRate",
                 "NewX_AVM_DE_TotalBytesSent64", "NewX_AVM_DE_TotalBytesReceived64",
                 "NewTotalBytesSent", "NewTotalBytesReceived"]
    },
    statusInfo: {
        path: "/igdupnp/control/WANIPConn1",
        service: "urn:schemas-upnp-org:service:WANIPConnection:1",
        action: "GetStatusInfo",
        fields: ["NewConnectionStatus", "NewLastConnectionError", "NewUptime"]
    },
    externalIP: {
        path: "/igdupnp/control/WANIPConn1",
        service: "urn:schemas-upnp-org:service:WANIPConnection:1",
        action: "GetExternalIPAddress",
        fields: ["NewExternalIPAddress"]
    },
    uiInfo: {
        path: "/upnp/control/userif",
        service: "urn:dslforum-org:service:UserInterface:1",
        action: "GetInfo",
        fields: ["NewUpgradeAvailable"]
    }
};

// Ordine di rendering delle righe nel desklet.
const ROWS = [
    { key: "model",             label: _("Model:"),            setting: "show-model" },
    { key: "firmware",          label: _("Firmware:"),         setting: "show-firmware" },
    { key: "wanStatus",         label: _("WAN link:"),         setting: "show-wan-status" },
    { key: "wanType",           label: _("WAN type:"),         setting: "show-wan-type" },
    { key: "maxRates",          label: _("Max ↓/↑:"),          setting: "show-max-rates" },
    { key: "connStatus",        label: _("Connection:"),       setting: "show-conn-status" },
    { key: "connError",         label: _("Last error:"),       setting: "show-conn-error" },
    { key: "uptime",            label: _("Uptime:"),           setting: "show-uptime" },
    { key: "publicIp",          label: _("Public IP:"),        setting: "show-public-ip" },
    { key: "bytesTotal",        label: _("Total ↓/↑:"),        setting: "show-bytes-total" },
    { key: "throughput",        label: _("Rate ↓/↑:"),         setting: "show-throughput" },
    { key: "updateAvailable",   label: _("Firmware update:"),  setting: "show-update-available" }
];

function MyDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init(metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.updateId = 0;
        this.rows = {};
        this.state = {};

        try {
            this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], this.instance_id);
            const bindList = [
                "host", "port", "delay", "timeout",
                "show-model", "show-firmware", "show-wan-status", "show-wan-type",
                "show-max-rates", "show-conn-status", "show-conn-error", "show-uptime",
                "show-public-ip", "show-bytes-total", "show-throughput",
                "show-update-available",
                "show-header",
                "font", "font-color", "label-color",
                "background-color", "background-transparency",
                "border-color", "border-width"
            ];
            for (let key of bindList) {
                const prop = key.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
                this.settings.bind(key, prop, Lang.bind(this, this._onSettingsChanged));
            }
        } catch (e) {
            global.logError("[fritzbox] settings error: " + e);
        }

        if (this.showHeader) this.setHeader(_("FRITZ!Box"));
        this._buildUI();
        this._fetchStaticInfo();
        this._schedule(1);
    },

    _onSettingsChanged() {
        if (this.showHeader) this.setHeader(_("FRITZ!Box"));
        this._buildUI();
        this._render();
        if (this.updateId > 0) {
            Mainloop.source_remove(this.updateId);
            this.updateId = 0;
        }
        this._schedule(1);
    },

    _buildUI() {
        this._content = new St.BoxLayout({ vertical: true });
        this._applyStyle();
        this.rows = {};
        for (let row of ROWS) {
            if (!this[this._propName(row.setting)]) continue;
            const box = new St.BoxLayout({});
            const labelW = new St.Label({ text: row.label, style_class: "fritzbox-label-left" });
            const valueW = new St.Label({ text: "…", style_class: "fritzbox-label-right" });
            labelW.style = "color: " + this.labelColor + ";";
            box.add(labelW, { expand: true });
            box.add(valueW, { expand: false });
            this._content.add(box, {});
            this.rows[row.key] = { label: labelW, value: valueW };
        }
        this.setContent(this._content);
    },

    _propName(settingKey) {
        return settingKey.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
    },

    _applyStyle() {
        const fp = this._parseFont(this.font || "Sans 11");
        const bg = this._rgba(this.backgroundColor, 1.0 - this.backgroundTransparency);
        const bd = this._rgba(this.borderColor, 1.0);
        this._content.style =
            "font-family: " + fp.family + ";" +
            "font-size: " + fp.size + "px;" +
            "color: " + this.fontColor + ";" +
            "background-color: " + bg + ";" +
            "border: " + this.borderWidth + "px solid " + bd + ";" +
            "border-radius: 8px;" +
            "padding: 6px 10px;";
    },

    _parseFont(font) {
        const parts = font.split(" ");
        const size = parseInt(parts.pop(), 10) || 11;
        return { family: parts.join(" ").replace(/,/g, " ") || "sans-serif", size };
    },

    _rgba(rgb, alpha) {
        if (!rgb) return "rgba(0,0,0," + alpha + ")";
        return rgb.replace("rgb(", "rgba(").replace(")", "," + alpha + ")");
    },

    on_desklet_clicked() {
        this._poll();
    },

    on_desklet_removed() {
        if (this.updateId > 0) {
            Mainloop.source_remove(this.updateId);
            this.updateId = 0;
        }
    },

    _schedule(sec) {
        this.updateId = Mainloop.timeout_add_seconds(sec, Lang.bind(this, this._tick));
    },

    _tick() {
        this.updateId = 0;
        this._poll();
        this._schedule(this.delay || 10);
        return false;
    },

    // Legge info statiche (modello/firmware) da /tr64desc.xml una tantum.
    _fetchStaticInfo() {
        const url = "http://" + this.host + ":" + this.port + "/tr64desc.xml";
        const cmd = ["curl", "-s", "--max-time", String(this.timeout || 5), url];
        Util.spawn_async(cmd, Lang.bind(this, (out) => {
            if (!out) return;
            const model = this._extract(out, "modelName");
            const display = this._extract(out, "Display");
            if (model) this.state.model = model;
            if (display) {
                const m = display.match(/^\d+\.(.+)$/);
                this.state.firmware = m ? ("FRITZ!OS " + m[1]) : display;
            }
            this._render();
        }));
    },

    _poll() {
        const host = this.host || "fritz.box";
        const port = this.port || 49000;
        const timeout = this.timeout || 5;

        const needed = this._neededCalls();

        for (let key of needed) {
            const c = CALLS[key];
            const body =
                '<?xml version="1.0"?>' +
                '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"' +
                ' s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
                '<s:Body><u:' + c.action + ' xmlns:u="' + c.service + '"/>' +
                '</s:Body></s:Envelope>';
            const url = "http://" + host + ":" + port + c.path;
            const cmd = [
                "curl", "-s", "--max-time", String(timeout),
                "-H", 'Content-Type: text/xml; charset="utf-8"',
                "-H", "SOAPAction: " + c.service + "#" + c.action,
                "--data", body,
                url
            ];
            Util.spawn_async(cmd, Lang.bind(this, this._onReply, key));
        }
    },

    _neededCalls() {
        const need = new Set();
        if (this.showWanStatus || this.showWanType || this.showMaxRates) need.add("linkProps");
        if (this.showBytesTotal || this.showThroughput) need.add("addonInfos");
        if (this.showConnStatus || this.showConnError || this.showUptime) need.add("statusInfo");
        if (this.showPublicIp) need.add("externalIP");
        if (this.showUpdateAvailable) need.add("uiInfo");
        return Array.from(need);
    },

    _onReply(output, callKey) {
        if (!output || typeof output !== "string") return;
        const c = CALLS[callKey];
        const parsed = {};
        for (let f of c.fields) parsed[f] = this._extract(output, f);

        switch (callKey) {
            case "linkProps":
                this.state.wanStatus = parsed.NewPhysicalLinkStatus || "?";
                this.state.wanType = this._prettyAccessType(parsed.NewWANAccessType);
                this.state.maxRates = this._fmtRate(parsed.NewLayer1DownstreamMaxBitRate) +
                                      " / " + this._fmtRate(parsed.NewLayer1UpstreamMaxBitRate);
                break;
            case "addonInfos": {
                const r = Number(parsed.NewX_AVM_DE_TotalBytesReceived64 || parsed.NewTotalBytesReceived);
                const s = Number(parsed.NewX_AVM_DE_TotalBytesSent64 || parsed.NewTotalBytesSent);
                if (isFinite(r) && isFinite(s)) {
                    this.state.bytesTotal = this._fmtBytes(r) + " / " + this._fmtBytes(s);
                }
                const rr = Number(parsed.NewByteReceiveRate);
                const sr = Number(parsed.NewByteSendRate);
                if (isFinite(rr) && isFinite(sr)) {
                    this.state.throughput = this._fmtRate(rr * 8) + " / " + this._fmtRate(sr * 8);
                }
                break;
            }
            case "statusInfo":
                this.state.connStatus = parsed.NewConnectionStatus || "?";
                this.state.connError = parsed.NewLastConnectionError || "-";
                this.state.uptime = this._fmtUptime(parseInt(parsed.NewUptime, 10));
                break;
            case "externalIP":
                this.state.publicIp = parsed.NewExternalIPAddress || "-";
                break;
            case "uiInfo":
                this.state.updateAvailable = parsed.NewUpgradeAvailable === "1" ? _("Yes") : _("No");
                break;
        }
        this._render();
    },

    _render() {
        for (let row of ROWS) {
            const w = this.rows[row.key];
            if (!w) continue;
            const v = this.state[row.key];
            w.value.set_text(v != null ? String(v) : "…");
        }
    },

    _extract(xml, tag) {
        const re = new RegExp("<" + tag + ">([^<]*)</" + tag + ">");
        const m = xml.match(re);
        return m ? m[1].trim() : null;
    },

    _prettyAccessType(t) {
        if (!t) return "?";
        const map = { "DSL": "DSL", "Ethernet": "Ethernet", "Cable": "Cable",
                      "Other": "LTE/5G", "POTS": "POTS" };
        return map[t] || t;
    },

    _fmtRate(bps) {
        bps = Number(bps);
        if (!isFinite(bps) || bps < 0) return "-";
        const units = ["bps", "Kbps", "Mbps", "Gbps"];
        let i = 0;
        while (bps >= 1000 && i < units.length - 1) { bps /= 1000; i++; }
        return (bps >= 10 ? bps.toFixed(0) : bps.toFixed(1)) + " " + units[i];
    },

    _fmtBytes(b) {
        b = Number(b);
        if (!isFinite(b) || b < 0) return "-";
        const units = ["B", "KiB", "MiB", "GiB", "TiB"];
        let i = 0;
        while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
        return (b >= 10 ? b.toFixed(0) : b.toFixed(1)) + " " + units[i];
    },

    _fmtUptime(sec) {
        sec = Number(sec);
        if (!isFinite(sec) || sec < 0) return "-";
        const d = Math.floor(sec / 86400);
        const h = Math.floor((sec % 86400) / 3600);
        const m = Math.floor((sec % 3600) / 60);
        if (d > 0) return d + _("d") + " " + h + _("h") + " " + m + _("m");
        if (h > 0) return h + _("h") + " " + m + _("m");
        return m + _("m");
    }
};

function main(metadata, deskletId) {
    return new MyDesklet(metadata, deskletId);
}
