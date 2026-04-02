// Docker Portainer Desklet
// Zeigt Docker-Container via Portainer API mit Start/Stop/Restart
// Erfordert: Cinnamon 5.0+

const Desklet  = imports.ui.desklet;
const St       = imports.gi.St;
const GLib     = imports.gi.GLib;
const Gio      = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;


const UUID        = "docker-portainer@maro";
const APP_VERSION = "1.0.0";

class DockerPortainerDesklet extends Desklet.Desklet {

    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        this._metadata = metadata;

        // Settings
        this._settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        this._settings.bind("portainer-host",   "portainerHost",   this._onSettingChanged.bind(this));
        this._settings.bind("portainer-port",   "portainerPort",   this._onSettingChanged.bind(this));
this._settings.bind("api-key",          "apiKey",          this._onSettingChanged.bind(this));
        this._settings.bind("endpoint-id",      "endpointId",      this._onSettingChanged.bind(this));
        this._settings.bind("endpoint-id-2",    "endpointId2",     this._onSettingChanged.bind(this));
        this._settings.bind("endpoint-name-2",  "endpointName2",   this._onSettingChanged.bind(this));
        this._settings.bind("refresh-interval", "refreshInterval", this._onSettingChanged.bind(this));
        this._settings.bind("font-size",        "fontSize",        this._onStyleChanged.bind(this));
        this._settings.bind("bg-opacity",       "bgOpacity",       this._onStyleChanged.bind(this));
        this._settings.bind("min-width",        "minWidth",        this._onStyleChanged.bind(this));

        this._timeoutId    = null;
        this._debounceId   = null;
        this._containers   = [];
        this._updateFlags  = {}; // image -> true wenn Update verfügbar
        this._useEnv2      = false; // false = local, true = zweite Umgebung

        this._initSoup();
        this._buildUI();
        this._applyStyle();
        this._startPolling();
    }

    get _baseUrl() {
        let host = (this.portainerHost || 'localhost').trim();
        return `http://${host}:${this.portainerPort}`;
    }

    get _activeEndpointId() {
        return this._useEnv2 ? (this.endpointId2 || this.endpointId) : this.endpointId;
    }

    get _activeEnvName() {
        return this._useEnv2 ? (this.endpointName2 || 'NAS') : 'local';
    }

    // ------------------------------------------------------------------ Style

    _applyStyle() {
        let opacity = Math.max(0, Math.min(100, this.bgOpacity ?? 88)) / 100;
        let mw = this.minWidth ?? 480;
        this._outer.set_style(
            `background-color: rgba(15,20,28,${opacity.toFixed(2)});` +
            `min-width: ${mw}px;`
        );
        this._fs = this.fontSize ?? 12;
    }

    _onStyleChanged() {
        this._applyStyle();
        this._refresh();
    }

    // ------------------------------------------------------------------ Soup

    _initSoup() {
        // curl is used instead of libsoup — no initialization needed
    }

    _soupRequest(method, url, callback) {
        // Use curl instead of libsoup to reliably support self-signed HTTPS certs
        let argv = [
            'curl', '-sk',
            '-X', method,
            '-H', `X-API-Key: ${this.apiKey || ''}`,
            '-o', '-',
            '-w', '\n__STATUS__%{http_code}',
            url
        ];
        try {
            let proc = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (_proc, res) => {
                try {
                    let [, stdout] = _proc.communicate_utf8_finish(res);
                    let out = stdout || '';
                    let marker = out.lastIndexOf('\n__STATUS__');
                    let status = 0;
                    let body = out;
                    if (marker !== -1) {
                        status = parseInt(out.substring(marker + 11)) || 0;
                        body   = out.substring(0, marker);
                    }
                    callback(status, body);
                } catch(e) {
                    global.logError(`[docker-portainer] curl error: ${e.message}`);
                    callback(0, '');
                }
            });
        } catch(e) {
            global.logError(`[docker-portainer] curl launch error: ${e.message}`);
            callback(0, '');
        }
    }

    // ------------------------------------------------------------------ UI

    _buildUI() {
        let outer = new St.BoxLayout({ vertical: true, style_class: 'docker-desklet' });
        this._outer = outer;
        this.setContent(outer);

        // Header
        let headerRow = new St.BoxLayout({ style_class: 'desklet-header-row' });

        let iconPath = this._metadata.path + '/icon.png';
        try {
            let gicon = Gio.icon_new_for_string(iconPath);
            let logo  = new St.Icon({ gicon: gicon, icon_size: 42, style_class: 'desklet-logo' });
            headerRow.add_child(logo);
        } catch(_) {}

        let titleBox = new St.BoxLayout({ vertical: true, style_class: 'desklet-title-box' });
        this._titleLabel    = new St.Label({ text: 'Docker Manager', style_class: 'desklet-title' });
        this._subtitleLabel = new St.Label({ text: 'via Portainer', style_class: 'desklet-subtitle' });
        titleBox.add_child(this._titleLabel);
        titleBox.add_child(this._subtitleLabel);
        headerRow.add_child(titleBox);

        // Umschalter + Update-Button im Header (rechts)
        headerRow.add_child(new St.Widget({ x_expand: true }));

        this._envToggleBtn = new St.Button({ label: 'local', style_class: 'env-toggle-btn', reactive: true });
        this._envToggleBtn.connect('clicked', this._toggleEnv.bind(this));
        headerRow.add_child(this._envToggleBtn);

        this._updateBtn = new St.Button({ label: '⬆', style_class: 'update-check-btn', reactive: true });
        this._updateBtn.connect('clicked', this._checkUpdates.bind(this));
        headerRow.add_child(this._updateBtn);

        outer.add_child(headerRow);

        outer.add_child(new St.Label({ text: '\u2500'.repeat(50), style_class: 'separator' }));

        // Container-Liste
        this._content = new St.BoxLayout({ vertical: true, style_class: 'desklet-content' });
        outer.add_child(this._content);

        outer.add_child(new St.Label({ text: '\u2500'.repeat(50), style_class: 'separator' }));

        // Fußzeile
        let footer = new St.BoxLayout({ style_class: 'desklet-footer' });
        this._footerTime  = new St.Label({ text: '', style_class: 'footer-time' });
        this._footerRight = new St.Label({ text: `v${APP_VERSION}`, style_class: 'footer-right' });
        footer.add_child(this._footerTime);
        footer.add_child(new St.Widget({ x_expand: true }));
        footer.add_child(this._footerRight);
        outer.add_child(footer);

        this._showStatus("Connecting...");
    }

    // ------------------------------------------------------------------ Polling

    _startPolling() {
        this._stopPolling();
        this._refresh();
        this._timeoutId = Mainloop.timeout_add_seconds(this.refreshInterval, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPolling() {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    _refresh() {
        this._fetchContainers();
    }

    // ------------------------------------------------------------------ API

    get _cliMode() {
        return !this.apiKey;
    }

    _fetchContainers() {
        if (this._cliMode) {
            this._fetchContainersCLI();
            return;
        }
        this._subtitleLabel.set_text(`via Portainer · ${this._activeEnvName.toLowerCase()}`);
        this._envToggleBtn.show();
        let url = `${this._baseUrl}/api/endpoints/${this._activeEndpointId}/docker/containers/json?all=1`;
        this._soupRequest('GET', url, (status, body) => {
            if (status === 0) {
                this._showStatus(`Portainer unreachable:\n${this.portainerHost}:${this.portainerPort}`);
                return;
            }
            if (status === 401) {
                this._showStatus("Invalid API token (401 Unauthorized)");
                return;
            }
            if (status !== 200) {
                this._showStatus(`Server error: HTTP ${status}`);
                return;
            }
            try {
                let containers = JSON.parse(body);
                if (!Array.isArray(containers)) throw new Error('Unexpected response format');
                this._containers = containers;
                this._renderContainers(containers);
                this._updateFooterTime();
            } catch(e) {
                this._showStatus("Error parsing response:\n" + e.message);
            }
        });
    }

    _fetchContainersCLI() {
        this._subtitleLabel.set_text('via docker CLI');
        this._envToggleBtn.hide();
        this._updateBtn.show();
        try {
            let proc = new Gio.Subprocess({
                argv: ['docker', 'ps', '-a', '--format', '{{json .}}'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (_proc, res) => {
                try {
                    let [, stdout] = _proc.communicate_utf8_finish(res);
                    let lines = (stdout || '').trim().split('\n').filter(l => l.trim());
                    let containers = lines.map(line => {
                        let c = JSON.parse(line);
                        return {
                            Id:    c.ID,
                            Names: ['/' + c.Names],
                            Image: c.Image,
                            State: c.State,
                            Status: c.Status
                        };
                    });
                    this._containers = containers;
                    this._renderContainers(containers);
                    this._updateFooterTime();
                } catch(e) {
                    this._showStatus('docker CLI error:\n' + e.message);
                }
            });
        } catch(_) {
            this._showStatus('docker not found or not accessible');
        }
    }

    _containerAction(containerId, action, btn) {
        if (btn) btn.set_label("...");
        if (this._cliMode) {
            try {
                let proc = new Gio.Subprocess({
                    argv: ['docker', action, containerId],
                    flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                });
                proc.init(null);
                proc.communicate_utf8_async(null, null, (_proc, res) => {
                    try { _proc.communicate_utf8_finish(res); } catch(_) {}
                    this._fetchContainers();
                });
            } catch(_) { this._fetchContainers(); }
            return;
        }
        let url = `${this._baseUrl}/api/endpoints/${this._activeEndpointId}/docker/containers/${containerId}/${action}`;
        this._soupRequest('POST', url, (status, _body) => {
            // 204 = success, 304 = already in that state — both OK
            if (status === 0 || status >= 500) {
                this._showStatus(`Error on '${action}': HTTP ${status}`);
            }
            this._fetchContainers();
        });
    }

    // ------------------------------------------------------------------ Env-Toggle

    _toggleEnv() {
        if (!this.endpointId2) return; // keine zweite Umgebung konfiguriert
        this._useEnv2 = !this._useEnv2;
        this._updateFlags = {};
        this._envToggleBtn.set_label(this._activeEnvName);
        this._subtitleLabel.set_text(`via Portainer · ${this._activeEnvName.toLowerCase()}`);
        this._startPolling();
    }

    // ------------------------------------------------------------------ Update-Check

    _checkUpdates() {
        if (!this._containers.length) return;

        // Nur einzigartige Images prüfen (kein Portainer selbst)
        let imageMap = {};
        for (let c of this._containers) {
            let img = c.Image;
            if (img && !img.toLowerCase().includes('portainer')) {
                imageMap[img] = c.ImageID;
            }
        }
        let images = Object.keys(imageMap);
        if (!images.length) return;

        this._updateBtn.set_label('⏳');
        this._updateBtn.reactive = false;
        this._updateFlags = {};

        let pending = images.length;
        let done = () => {
            pending--;
            if (pending === 0) {
                this._updateBtn.set_label('⬆');
                this._updateBtn.reactive = true;
                this._renderContainers(this._containers);
            }
        };

        for (let image of images) {
            try {
                // docker pull ohne --quiet: Output enthält "Downloaded newer image" wenn Update da
                let pullProc = new Gio.Subprocess({
                    argv: ['docker', 'pull', image],
                    flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                });
                pullProc.init(null);
                pullProc.communicate_utf8_async(null, null, (_p, res) => {
                    try {
                        let [, stdout, stderr] = _p.communicate_utf8_finish(res);
                        let output = (stdout || '') + (stderr || '');
                        if (output.includes('Downloaded newer image')) {
                            this._updateFlags[image] = true;
                        }
                    } catch(_) {}
                    done();
                });
            } catch(_) { done(); }
        }
    }

    // ------------------------------------------------------------------ Render

    _isProtected(container) {
        // Portainer-Container selbst: keine Steuerungsbuttons
        let img  = (container.Image  || '').toLowerCase();
        let name = (container.Names && container.Names[0] || '').toLowerCase();
        return img.includes('portainer') || name.includes('portainer');
    }

    _renderContainers(containers) {
        this._content.destroy_all_children();

        if (containers.length === 0) {
            this._content.add_child(
                new St.Label({ text: "No containers found", style_class: 'status-label' })
            );
            return;
        }

        // Sortierung: running zuerst, dann alphabetisch
        let getName = c => ((c.Names && c.Names[0]) || c.Id || '').replace(/^\//, '');
        containers.sort((a, b) => {
            let aRun = a.State === 'running' ? 0 : 1;
            let bRun = b.State === 'running' ? 0 : 1;
            if (aRun !== bRun) return aRun - bRun;
            let aName = getName(a);
            let bName = getName(b);
            return aName.localeCompare(bName);
        });

        let fs = this._fs || 12;
        for (let c of containers) {
            this._content.add_child(this._makeContainerRow(c, fs));
        }
    }

    _makeContainerRow(container, fs) {
        let state     = container.State || 'unknown';
        let isRunning = state === 'running';
        let isStopped = state === 'exited' || state === 'created' || state === 'dead';
        let name      = ((container.Names && container.Names[0]) || (container.Id || '').substring(0, 12)).replace(/^\//, '');
        let id        = container.Id;
        let protected_ = this._isProtected(container);
        let hasUpdate  = container.Image ? this._updateFlags[container.Image] : false;

        // Status-Punkt
        let dotClass  = isRunning ? 'status-running' : (isStopped ? 'status-stopped' : 'status-other');
        let statusDot = new St.Label({ text: '● ', style_class: 'status-dot ' + dotClass });
        statusDot.set_style(`font-size: ${fs}px;`);

        // Container-Name + optionaler Update-Indikator
        let nameText = name + (hasUpdate ? '  ⬆' : '');
        let nameLbl  = new St.Label({ text: nameText, style_class: hasUpdate ? 'container-name update-available' : 'container-name' });
        nameLbl.set_style(`font-size: ${fs}px;`);

        let row = new St.BoxLayout({ style_class: 'container-row' });
        row.add_child(statusDot);
        row.add_child(nameLbl);
        row.add_child(new St.Widget({ x_expand: true }));

        if (protected_) {
            // Portainer: nur Schloss-Symbol, keine Buttons
            let lockLbl = new St.Label({ text: '🔒', style_class: 'lock-icon' });
            row.add_child(lockLbl);
        } else {
            let btnStart, btnStop, btnRestart;
            btnStart   = this._makeBtn('▶', 'btn-start',   !isStopped, () => this._containerAction(id, 'start',   btnStart));
            btnStop    = this._makeBtn('■', 'btn-stop',    !isRunning, () => this._containerAction(id, 'stop',    btnStop));
            btnRestart = this._makeBtn('↺', 'btn-restart', !isRunning, () => this._containerAction(id, 'restart', btnRestart));
            row.add_child(btnStart);
            row.add_child(btnStop);
            row.add_child(btnRestart);
        }

        return row;
    }

    _makeBtn(label, extraClass, disabled, onClick) {
        let cls = 'container-btn ' + extraClass;
        let btn = new St.Button({ label: label, style_class: cls, reactive: !disabled });
        btn.set_opacity(disabled ? 60 : 255);
        if (!disabled) {
            btn.connect('clicked', onClick);
        }
        return btn;
    }

    _showStatus(text) {
        this._content.destroy_all_children();
        this._content.add_child(new St.Label({ text, style_class: 'status-label' }));
    }

    _updateFooterTime() {
        let now = new Date();
        let hh  = String(now.getHours()).padStart(2, '0');
        let mm  = String(now.getMinutes()).padStart(2, '0');
        let ss  = String(now.getSeconds()).padStart(2, '0');
        if (this._footerTime) {
            this._footerTime.set_text(`Updated: ${hh}:${mm}:${ss}`);
        }
    }

    // ------------------------------------------------------------------ Lifecycle

    _onSettingChanged() {
        if (this._debounceId) {
            Mainloop.source_remove(this._debounceId);
            this._debounceId = null;
        }
        this._debounceId = Mainloop.timeout_add(800, () => {
            this._debounceId = null;
            this._startPolling();
            return GLib.SOURCE_REMOVE;
        });
    }

    on_desklet_removed() {
        if (this._debounceId) {
            Mainloop.source_remove(this._debounceId);
            this._debounceId = null;
        }
        this._stopPolling();
    }
}

function main(metadata, desklet_id) {
    return new DockerPortainerDesklet(metadata, desklet_id);
}
