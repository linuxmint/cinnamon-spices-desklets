const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;
const Cairo = imports.cairo;
const Pango = imports.gi.Pango;
const PangoCairo = imports.gi.PangoCairo;

let UPowerGlib = null;
try {
    UPowerGlib = imports.gi.UPowerGlib;
} catch (e) {
    UPowerGlib = null;
}

class IOSHardwareMonitorDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);

        this.metadata = metadata;
        this.instance_id = desklet_id;
        this._updateTimerId = 0;
        this._gpuQueryInProgress = false;
        this._btQueryInProgress = false;
        this._hwmonDiscoveryInProgress = false;
        this._cachedBtDevices = [];
        this._sysInfoCache = {
            productName: null,
            osPrettyName: null
        };

        // Default settings fallback
        this.themeMode = "dark";
        this.bgOpacity = 0.78;
        this.cornerRadius = 24;
        this.accentStyle = "ios";
        this.scaleSize = 1.0;
        this.columnsPerRow = 4;
        this.showHeader = true;
        this.headerTitleMode = "model";
        this.customHeaderTitle = "Meu Setup";
        this.showCpu = true;
        this.showRam = true;
        this.showGpu = true;
        this.showFan = true;
        this.showDisk = true;
        this.showNetwork = true;
        this.showBatteries = true;
        this.showDisconnectedBt = false;
        this.updateInterval = 2.0;
        this.diskMountPath = "/";
        this.maxFanRpm = 5500;

        // Telemetry state
        this._prevCpuTotal = 0;
        this._prevCpuIdle = 0;
        this._prevNetRx = 0;
        this._prevNetTx = 0;
        this._prevNetTime = 0;

        this.metrics = {
            hostname: GLib.get_host_name() || "Linux",
            uptimeStr: "",
            cpu: { usage: 0, temp: null, cores: 1 },
            ram: { usage: 0, usedGb: 0, totalGb: 0, swapUsedGb: 0, swapTotalGb: 0 },
            gpu: { available: false, name: "GPU", usage: 0, temp: null, vramUsedMb: 0, vramTotalMb: 0 },
            fan: { available: false, rpm: 0, label: "Fan", count: 0, details: [] },
            disk: { usage: 0, usedGb: 0, totalGb: 0, freeGb: 0, mount: "/" },
            net: { iface: "eth0", rxSpeed: 0, txSpeed: 0, connected: false },
            batteries: []
        };

        this._hwmonCache = null;
        this._upowerClient = null;
        if (UPowerGlib) {
            try {
                this._upowerClient = UPowerGlib.Client.new();
            } catch (e) {
                this._upowerClient = null;
            }
        }

        this.setHeader("iOS Hardware Monitor");
        this._initSettings();
        this._initContextMenu();
        this._buildUI();
        this._loadSystemIdentityAsync();
        this._discoverHwmonAsync();
        this._refreshAll();
        this._startLoop();
    }

    _initSettings() {
        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], this.instance_id);
        const bind = (key, prop) => {
            this.settings.bind(key, prop, () => this._onSettingsChanged());
        };

        bind("theme-mode", "themeMode");
        bind("bg-opacity", "bgOpacity");
        bind("corner-radius", "cornerRadius");
        bind("accent-style", "accentStyle");
        bind("scale-size", "scaleSize");
        bind("columns-per-row", "columnsPerRow");
        bind("show-header", "showHeader");
        bind("header-title-mode", "headerTitleMode");
        bind("custom-header-title", "customHeaderTitle");
        bind("show-cpu", "showCpu");
        bind("show-ram", "showRam");
        bind("show-gpu", "showGpu");
        bind("show-fan", "showFan");
        bind("show-disk", "showDisk");
        bind("show-network", "showNetwork");
        bind("show-batteries", "showBatteries");
        bind("show-disconnected-bt", "showDisconnectedBt");
        bind("update-interval", "updateInterval");
        bind("disk-mount-path", "diskMountPath");
        bind("max-fan-rpm", "maxFanRpm");
    }

    _initContextMenu() {
        let refreshItem = new PopupMenu.PopupMenuItem("Atualizar Agora");
        refreshItem.connect("activate", () => {
            this._discoverHwmonAsync();
            this._refreshAll();
        });
        this._menu.addMenuItem(refreshItem);

        let btItem = new PopupMenu.PopupMenuItem("Configurações de Bluetooth");
        btItem.connect("activate", () => {
            if (GLib.find_program_in_path("blueberry")) {
                Util.spawn(["blueberry"]);
            } else if (GLib.find_program_in_path("blueman-manager")) {
                Util.spawn(["blueman-manager"]);
            } else {
                Util.spawn(["cinnamon-settings", "bluetooth"]);
            }
        });
        this._menu.addMenuItem(btItem);

        let sysmonItem = new PopupMenu.PopupMenuItem("Abrir Monitor do Sistema");
        sysmonItem.connect("activate", () => {
            Util.spawn(["gnome-system-monitor"]);
        });
        this._menu.addMenuItem(sysmonItem);
    }

    _buildUI() {
        this.rootBox = new St.BoxLayout({
            vertical: true,
            style_class: "ios-monitor-root",
            reactive: true,
            track_hover: true
        });

        this.canvas = new St.DrawingArea({ reactive: false });
        this.canvas.connect("repaint", (area) => this._onRepaint(area));

        this.rootBox.add_actor(this.canvas);
        this.setContent(this.rootBox);
        this._updateCanvasSize();
    }

    _onSettingsChanged() {
        this._updateCanvasSize();
        this._refreshAll();
        this._startLoop();
    }

    _startLoop() {
        if (this._updateTimerId !== 0) {
            Mainloop.source_remove(this._updateTimerId);
            this._updateTimerId = 0;
        }
        let intervalMs = Math.max(1000, Math.round((this.updateInterval || 2.0) * 1000));
        this._updateTimerId = Mainloop.timeout_add(intervalMs, () => {
            this._refreshAll();
            return GLib.SOURCE_CONTINUE;
        });
    }

    on_desklet_removed() {
        if (this._updateTimerId !== 0) {
            Mainloop.source_remove(this._updateTimerId);
            this._updateTimerId = 0;
        }
    }

    on_desklet_clicked(event) {
        if (event.get_button() === 1) {
            this._refreshAll();
        }
    }

    // =========================================================================
    // NON-BLOCKING ASYNC I/O HELPERS
    // =========================================================================

    _readFileAsync(path, callback) {
        let file = Gio.File.new_for_path(path);
        file.load_contents_async(null, (f, res) => {
            try {
                let [ok, bytes] = f.load_contents_finish(res);
                if (ok && bytes) {
                    callback(imports.byteArray.toString(bytes).trim());
                    return;
                }
            } catch (e) {}
            callback(null);
        });
    }

    _listDirAsync(path, callback) {
        let dir = Gio.File.new_for_path(path);
        dir.enumerate_children_async(
            "standard::name",
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            null,
            (d, res) => {
                let names = [];
                try {
                    let enumerator = d.enumerate_children_finish(res);
                    let collectNext = () => {
                        enumerator.next_files_async(64, GLib.PRIORITY_DEFAULT, null, (en, nextRes) => {
                            try {
                                let files = en.next_files_finish(nextRes);
                                if (files && files.length > 0) {
                                    for (let info of files) {
                                        names.push(info.get_name());
                                    }
                                    collectNext();
                                    return;
                                }
                            } catch (e) {}
                            try {
                                en.close_async(GLib.PRIORITY_DEFAULT, null, null);
                            } catch (e) {}
                            callback(names);
                        });
                    };
                    collectNext();
                } catch (e) {
                    callback([]);
                }
            }
        );
    }

    _loadSystemIdentityAsync() {
        this._readFileAsync("/sys/devices/virtual/dmi/id/product_name", (prod) => {
            if (prod && !prod.toLowerCase().includes("system product name") && !prod.toLowerCase().includes("to be filled") && !prod.toLowerCase().includes("default string")) {
                let clean = prod.split("_")[0].replace(/FA\d+[A-Z]*/i, "").trim();
                if (clean.length > 2) {
                    this._sysInfoCache.productName = clean.length > 24 ? clean.substring(0, 24).trim() : clean;
                    this.metrics.hostname = this._detectSystemTitle();
                    if (this.canvas) this.canvas.queue_repaint();
                }
            }
        });

        this._readFileAsync("/etc/os-release", (osRelease) => {
            if (osRelease) {
                let m = osRelease.match(/^PRETTY_NAME=["']?([^"'\n]+)["']?/m) || osRelease.match(/^NAME=["']?([^"'\n]+)["']?/m);
                if (m && m[1]) {
                    let cleanOs = m[1].replace(/\s*\([^)]*\)/g, "").trim();
                    this._sysInfoCache.osPrettyName = cleanOs.length > 24 ? cleanOs.substring(0, 24).trim() : cleanOs;
                    this.metrics.hostname = this._detectSystemTitle();
                    if (this.canvas) this.canvas.queue_repaint();
                }
            }
        });
    }

    _detectSystemTitle() {
        let mode = this.headerTitleMode || "model";

        if (mode === "custom") {
            let custom = (this.customHeaderTitle || "").trim();
            return custom.length > 0 ? custom : "Linux";
        }

        if (mode === "user") {
            let user = GLib.get_real_name();
            if (!user || user === "Unknown") {
                user = GLib.get_user_name() || "User";
            }
            return user;
        }

        if (mode === "distro" && this._sysInfoCache.osPrettyName) {
            return this._sysInfoCache.osPrettyName;
        }

        if (mode === "hostname") {
            let host = GLib.get_host_name() || "Linux";
            return host.split(".")[0];
        }

        if (this._sysInfoCache.productName) {
            return this._sysInfoCache.productName;
        }
        if (this._sysInfoCache.osPrettyName) {
            return this._sysInfoCache.osPrettyName;
        }

        let host = GLib.get_host_name() || "Linux";
        if (host.startsWith("localhost")) {
            return "Linux System";
        }
        return host.split(".")[0];
    }

    // =========================================================================
    // ASYNC HARDWARE & BLUETOOTH TELEMETRY
    // =========================================================================

    _discoverHwmonAsync() {
        if (this._hwmonDiscoveryInProgress) return;
        this._hwmonDiscoveryInProgress = true;

        let nextCache = {
            cpuTempPaths: [],
            gpuTempPaths: [],
            fanPaths: [],
            drmGpuBusyPath: null,
            drmVramUsedPath: null,
            drmVramTotalPath: null,
            hasNvidiaSmi: GLib.find_program_in_path("nvidia-smi") !== null
        };

        // Check DRM cards asynchronously without GLib.file_test
        for (let i = 0; i < 4; i++) {
            let cardDev = "/sys/class/drm/card" + i + "/device";
            this._readFileAsync(cardDev + "/gpu_busy_percent", (val) => {
                if (val !== null && !nextCache.drmGpuBusyPath) {
                    nextCache.drmGpuBusyPath = cardDev + "/gpu_busy_percent";
                    this._readFileAsync(cardDev + "/mem_info_vram_used", (vramVal) => {
                        if (vramVal !== null) {
                            nextCache.drmVramUsedPath = cardDev + "/mem_info_vram_used";
                            nextCache.drmVramTotalPath = cardDev + "/mem_info_vram_total";
                        }
                    });
                }
            });
        }

        this._listDirAsync("/sys/class/hwmon", (hwDirs) => {
            if (!hwDirs || hwDirs.length === 0) {
                this._hwmonCache = nextCache;
                this._hwmonDiscoveryInProgress = false;
                return;
            }

            let pendingDirs = hwDirs.length;
            const onDirDone = () => {
                pendingDirs--;
                if (pendingDirs <= 0) {
                    nextCache.cpuTempPaths.sort((a, b) => a.priority - b.priority);
                    this._hwmonCache = nextCache;
                    this._hwmonDiscoveryInProgress = false;
                    this._refreshAll();
                }
            };

            for (let dName of hwDirs) {
                let hwDir = "/sys/class/hwmon/" + dName;
                this._readFileAsync(hwDir + "/name", (chipRaw) => {
                    let chipName = (chipRaw || "").toLowerCase();
                    this._listDirAsync(hwDir, (files) => {
                        if (!files || files.length === 0) {
                            onDirDone();
                            return;
                        }

                        let pendingFiles = 0;
                        for (let fname of files) {
                            if (/^fan\d+_input$/.test(fname)) {
                                pendingFiles++;
                                let prefix = fname.replace("_input", "");
                                this._readFileAsync(hwDir + "/" + prefix + "_label", (labelRaw) => {
                                    nextCache.fanPaths.push({
                                        input: hwDir + "/" + fname,
                                        label: labelRaw || chipName || prefix
                                    });
                                    pendingFiles--;
                                    if (pendingFiles === 0) onDirDone();
                                });
                            } else if (/^temp\d+_input$/.test(fname)) {
                                pendingFiles++;
                                let prefix = fname.replace("_input", "");
                                let fullPath = hwDir + "/" + fname;
                                this._readFileAsync(hwDir + "/" + prefix + "_label", (labelRaw) => {
                                    let label = (labelRaw || "").toLowerCase();
                                    if (chipName.includes("coretemp") || chipName.includes("k10temp") || chipName.includes("zenpower") || chipName.includes("cpu") || chipName.includes("acpitz")) {
                                        let priority = (chipName.includes("coretemp") || chipName.includes("k10temp") || chipName.includes("zenpower")) ? 1 : 2;
                                        if (label.includes("tctl") || label.includes("tdie") || label.includes("package")) {
                                            priority = 0;
                                        }
                                        nextCache.cpuTempPaths.push({ path: fullPath, priority: priority });
                                    } else if (chipName.includes("amdgpu") || chipName.includes("radeon") || chipName.includes("nouveau") || chipName.includes("i915") || chipName.includes("xe")) {
                                        nextCache.gpuTempPaths.push(fullPath);
                                    }
                                    pendingFiles--;
                                    if (pendingFiles === 0) onDirDone();
                                });
                            }
                        }

                        if (pendingFiles === 0) {
                            onDirDone();
                        }
                    });
                });
            }
        });
    }

    _refreshAll() {
        if (!this._hwmonCache && !this._hwmonDiscoveryInProgress) {
            this._discoverHwmonAsync();
        }

        this.metrics.hostname = this._detectSystemTitle();
        this._updateUptime();
        if (this.showCpu) this._updateCpu();
        if (this.showRam) this._updateRam();
        if (this.showFan) this._updateFan();
        if (this.showDisk) this._updateDisk();
        if (this.showNetwork) this._updateNetwork();
        if (this.showBatteries) this._updateBatteries();
        if (this.showGpu) this._updateGpu();

        this._updateCanvasSize();
        if (this.canvas) this.canvas.queue_repaint();
    }

    _updateUptime() {
        this._readFileAsync("/proc/uptime", (content) => {
            if (!content) return;
            let secs = parseFloat(content.split(/\s+/)[0]);
            if (isNaN(secs)) return;
            let days = Math.floor(secs / 86400);
            let hours = Math.floor((secs % 86400) / 3600);
            let mins = Math.floor((secs % 3600) / 60);
            if (days > 0) {
                this.metrics.uptimeStr = days + "d " + hours + "h";
            } else if (hours > 0) {
                this.metrics.uptimeStr = hours + "h " + mins + "m";
            } else {
                this.metrics.uptimeStr = mins + " min";
            }
            if (this.canvas) this.canvas.queue_repaint();
        });
    }

    _updateCpu() {
        this._readFileAsync("/proc/stat", (stat) => {
            if (!stat) return;
            let cpuLine = stat.split("\n")[0];
            if (cpuLine && cpuLine.startsWith("cpu ")) {
                let parts = cpuLine.trim().split(/\s+/).slice(1).map(x => parseInt(x, 10) || 0);
                let idle = parts[3] + (parts[4] || 0);
                let total = parts.reduce((acc, v) => acc + v, 0);
                let diffTotal = total - this._prevCpuTotal;
                let diffIdle = idle - this._prevCpuIdle;
                if (this._prevCpuTotal > 0 && diffTotal > 0) {
                    let usage = ((diffTotal - diffIdle) / diffTotal) * 100;
                    this.metrics.cpu.usage = Math.max(0, Math.min(100, Math.round(usage)));
                }
                this._prevCpuTotal = total;
                this._prevCpuIdle = idle;
                if (this.canvas) this.canvas.queue_repaint();
            }
        });

        let tempPaths = (this._hwmonCache && this._hwmonCache.cpuTempPaths.length > 0)
            ? this._hwmonCache.cpuTempPaths.map(x => x.path)
            : ["/sys/class/thermal/thermal_zone0/temp"];

        this._readFirstValidTempAsync(tempPaths, 0, (tempC) => {
            if (tempC !== null) {
                this.metrics.cpu.temp = tempC;
                if (this.canvas) this.canvas.queue_repaint();
            }
        });
    }

    _readFirstValidTempAsync(paths, idx, callback) {
        if (idx >= paths.length) {
            callback(null);
            return;
        }
        this._readFileAsync(paths[idx], (raw) => {
            if (raw !== null) {
                let val = parseInt(raw, 10);
                if (!isNaN(val) && val > 0 && val < 150000) {
                    callback(Math.round(val / 1000));
                    return;
                }
            }
            this._readFirstValidTempAsync(paths, idx + 1, callback);
        });
    }

    _updateRam() {
        this._readFileAsync("/proc/meminfo", (meminfo) => {
            if (!meminfo) return;
            let map = {};
            for (let line of meminfo.split("\n")) {
                let m = line.match(/^(\w+):\s+(\d+)/);
                if (m) map[m[1]] = parseInt(m[2], 10);
            }
            let totalKb = map["MemTotal"] || 1;
            let availKb = map["MemAvailable"] !== undefined ? map["MemAvailable"] : ((map["MemFree"] || 0) + (map["Buffers"] || 0) + (map["Cached"] || 0));
            let usedKb = Math.max(0, totalKb - availKb);

            let swapTotalKb = map["SwapTotal"] || 0;
            let swapFreeKb = map["SwapFree"] || 0;
            let swapUsedKb = Math.max(0, swapTotalKb - swapFreeKb);

            this.metrics.ram.usage = Math.round((usedKb / totalKb) * 100);
            this.metrics.ram.usedGb = usedKb / (1024 * 1024);
            this.metrics.ram.totalGb = totalKb / (1024 * 1024);
            this.metrics.ram.swapUsedGb = swapUsedKb / (1024 * 1024);
            this.metrics.ram.swapTotalGb = swapTotalKb / (1024 * 1024);
            if (this.canvas) this.canvas.queue_repaint();
        });
    }

    _updateFan() {
        if (!this._hwmonCache || this._hwmonCache.fanPaths.length === 0) {
            this.metrics.fan.available = false;
            return;
        }

        let fanPaths = this._hwmonCache.fanPaths;
        let fans = [];
        let pending = fanPaths.length;

        for (let f of fanPaths) {
            this._readFileAsync(f.input, (raw) => {
                if (raw !== null) {
                    let rpm = parseInt(raw, 10);
                    if (!isNaN(rpm) && rpm >= 0) {
                        fans.push({ label: f.label, rpm: rpm });
                    }
                }
                pending--;
                if (pending <= 0) {
                    if (fans.length > 0) {
                        let maxRpm = 0;
                        let primaryLabel = "Cooler";
                        for (let item of fans) {
                            if (item.rpm > maxRpm) {
                                maxRpm = item.rpm;
                                primaryLabel = item.label;
                            }
                        }
                        this.metrics.fan.available = true;
                        this.metrics.fan.rpm = maxRpm;
                        this.metrics.fan.count = fans.length;
                        this.metrics.fan.details = fans;
                        this.metrics.fan.label = primaryLabel.replace(/_/g, " ").toUpperCase();
                    } else {
                        this.metrics.fan.available = false;
                        this.metrics.fan.rpm = 0;
                        this.metrics.fan.details = [];
                    }
                    if (this.canvas) this.canvas.queue_repaint();
                }
            });
        }
    }

    _updateGpu() {
        if (!this._hwmonCache) return;

        // 1. Try DRM sysfs first if available (AMD/Intel non-blocking async)
        if (this._hwmonCache.drmGpuBusyPath) {
            this._readFileAsync(this._hwmonCache.drmGpuBusyPath, (busyRaw) => {
                if (busyRaw !== null) {
                    this.metrics.gpu.available = true;
                    this.metrics.gpu.usage = Math.max(0, Math.min(100, parseInt(busyRaw, 10) || 0));
                    if (this.canvas) this.canvas.queue_repaint();
                }
            });
            if (this._hwmonCache.drmVramUsedPath && this._hwmonCache.drmVramTotalPath) {
                this._readFileAsync(this._hwmonCache.drmVramUsedPath, (uRaw) => {
                    if (uRaw !== null) {
                        this.metrics.gpu.vramUsedMb = Math.round((parseInt(uRaw, 10) || 0) / (1024 * 1024));
                    }
                });
                this._readFileAsync(this._hwmonCache.drmVramTotalPath, (tRaw) => {
                    if (tRaw !== null) {
                        this.metrics.gpu.vramTotalMb = Math.round((parseInt(tRaw, 10) || 0) / (1024 * 1024));
                    }
                });
            }
            if (this._hwmonCache.gpuTempPaths.length > 0) {
                this._readFileAsync(this._hwmonCache.gpuTempPaths[0], (tr) => {
                    if (tr !== null) {
                        this.metrics.gpu.temp = Math.round((parseInt(tr, 10) || 0) / 1000);
                    }
                });
            }
            return;
        }

        // 2. Try NVIDIA async via Gio.Subprocess
        if (this._hwmonCache.hasNvidiaSmi && !this._gpuQueryInProgress) {
            this._gpuQueryInProgress = true;
            try {
                let proc = Gio.Subprocess.new(
                    ["nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
                );
                proc.communicate_utf8_async(null, null, (p, res) => {
                    this._gpuQueryInProgress = false;
                    try {
                        let [ok, stdout] = p.communicate_utf8_finish(res);
                        if (ok && stdout) {
                            let line = stdout.trim().split("\n")[0];
                            let parts = line.split(",").map(s => s.trim());
                            if (parts.length >= 5) {
                                this.metrics.gpu.available = true;
                                this.metrics.gpu.name = parts[0]
                                    .replace(/NVIDIA\s+/i, "")
                                    .replace(/GeForce\s+/i, "")
                                    .replace(/Laptop GPU/i, "")
                                    .trim();
                                this.metrics.gpu.usage = Math.max(0, Math.min(100, parseInt(parts[1], 10) || 0));
                                this.metrics.gpu.vramUsedMb = parseInt(parts[2], 10) || 0;
                                this.metrics.gpu.vramTotalMb = parseInt(parts[3], 10) || 0;
                                let temp = parseInt(parts[4], 10);
                                this.metrics.gpu.temp = isNaN(temp) ? null : temp;
                                if (this.canvas) this.canvas.queue_repaint();
                            }
                        }
                    } catch (e) {}
                });
            } catch (e) {
                this._gpuQueryInProgress = false;
            }
        }
    }

    _updateDisk() {
        let mountPath = (this.diskMountPath || "/").trim() || "/";
        let file = Gio.File.new_for_path(mountPath);
        file.query_filesystem_info_async(
            "filesystem::size,filesystem::free,filesystem::used",
            GLib.PRIORITY_DEFAULT,
            null,
            (f, res) => {
                try {
                    let info = f.query_filesystem_info_finish(res);
                    let size = info.get_attribute_uint64("filesystem::size");
                    let free = info.get_attribute_uint64("filesystem::free");
                    let used = info.has_attribute("filesystem::used")
                        ? info.get_attribute_uint64("filesystem::used")
                        : Math.max(0, size - free);

                    if (size > 0) {
                        let gb = 1024 * 1024 * 1024;
                        this.metrics.disk.totalGb = size / gb;
                        this.metrics.disk.freeGb = free / gb;
                        this.metrics.disk.usedGb = used / gb;
                        this.metrics.disk.usage = Math.min(100, Math.max(0, Math.round((used / size) * 100)));
                        this.metrics.disk.mount = mountPath;
                        if (this.canvas) this.canvas.queue_repaint();
                    }
                } catch (e) {}
            }
        );
    }

    _updateNetwork() {
        this._readFileAsync("/proc/net/dev", (devContent) => {
            if (!devContent) return;

            let lines = devContent.split("\n").slice(2);
            let totalRx = 0;
            let totalTx = 0;
            let activeIface = "Offline";

            for (let line of lines) {
                let parts = line.trim().split(/[:\s]+/);
                if (parts.length < 10) continue;
                let iface = parts[0];
                if (iface === "lo" || iface.startsWith("docker") || iface.startsWith("veth") || iface.startsWith("br-") || iface.startsWith("virbr")) {
                    continue;
                }
                let rx = parseFloat(parts[1]) || 0;
                let tx = parseFloat(parts[9]) || 0;
                if (rx > 0 || tx > 0) {
                    totalRx += rx;
                    totalTx += tx;
                    if (activeIface === "Offline") activeIface = iface;
                }
            }

            let now = GLib.get_monotonic_time() / 1000000.0;
            if (this._prevNetTime > 0 && now > this._prevNetTime) {
                let dt = now - this._prevNetTime;
                this.metrics.net.rxSpeed = Math.max(0, (totalRx - this._prevNetRx) / dt);
                this.metrics.net.txSpeed = Math.max(0, (totalTx - this._prevNetTx) / dt);
            }
            this._prevNetRx = totalRx;
            this._prevNetTx = totalTx;
            this._prevNetTime = now;
            this.metrics.net.iface = activeIface;
            this.metrics.net.connected = activeIface !== "Offline";
            if (this.canvas) this.canvas.queue_repaint();
        });
    }

    _updateBatteries() {
        let list = [];
        let seenMacs = new Set();

        // 1. UPower devices (Laptop battery, wireless mice/keyboards/headsets exposed to UPower)
        if (this._upowerClient) {
            try {
                let devices = this._upowerClient.get_devices();
                for (let d of devices) {
                    if (d.kind === 1) continue;
                    let nativePath = d.native_path || "";
                    let pct = Math.round(d.percentage || 0);
                    let isCharging = (d.state === 1 || d.state === 4 || d.state === 5);

                    let macMatch = nativePath.match(/([0-9A-Fa-f]{2}[:_]){5}[0-9A-Fa-f]{2}/);
                    if (macMatch) {
                        seenMacs.add(macMatch[0].replace(/_/g, ":").toUpperCase());
                    }

                    let category = this._classifyUPowerDevice(d.kind, d.model, nativePath);
                    let label = this._shortenDeviceName(d.model || category.defaultName);

                    list.push({
                        id: d.get_object_path(),
                        name: label,
                        fullName: d.model || label,
                        percentage: Math.max(0, Math.min(100, pct)),
                        charging: isCharging,
                        connected: true,
                        type: category.type
                    });
                }
            } catch (e) {}
        }

        // 2. Query BlueZ ObjectManager asynchronously via D-Bus for Bluetooth devices & org.bluez.Battery1
        this._queryBluezAsync();

        for (let bt of this._cachedBtDevices) {
            if (bt.address && seenMacs.has(bt.address)) continue;
            if (!bt.connected && (!this.showDisconnectedBt || !bt.paired)) continue;
            list.push({
                id: bt.id,
                name: bt.name,
                fullName: bt.fullName,
                percentage: bt.hasBatteryLevel ? bt.percentage : (bt.connected ? 100 : 0),
                hasBatteryLevel: bt.hasBatteryLevel,
                charging: false,
                connected: bt.connected,
                type: bt.type
            });
        }

        this.metrics.batteries = list;
    }

    _queryBluezAsync() {
        if (this._btQueryInProgress) return;
        this._btQueryInProgress = true;
        try {
            Gio.DBus.system.call(
                "org.bluez",
                "/",
                "org.freedesktop.DBus.ObjectManager",
                "GetManagedObjects",
                null,
                new GLib.VariantType("(a{oa{sa{sv}}})"),
                Gio.DBusCallFlags.NONE,
                1500,
                null,
                (bus, res) => {
                    this._btQueryInProgress = false;
                    try {
                        let reply = bus.call_finish(res);
                        let [objects] = reply.deep_unpack();
                        let btList = [];
                        for (let path in objects) {
                            let ifaces = objects[path];
                            let dev = ifaces["org.bluez.Device1"];
                            if (!dev) continue;

                            let address = dev.Address ? dev.Address.deep_unpack().toUpperCase() : "";
                            let connected = dev.Connected ? dev.Connected.deep_unpack() : false;
                            let paired = dev.Paired ? dev.Paired.deep_unpack() : false;
                            let alias = dev.Alias ? dev.Alias.deep_unpack() : (dev.Name ? dev.Name.deep_unpack() : "Bluetooth");
                            let iconName = dev.Icon ? dev.Icon.deep_unpack() : "";
                            let batIface = ifaces["org.bluez.Battery1"];
                            let pct = batIface && batIface.Percentage ? batIface.Percentage.deep_unpack() : null;
                            let devType = this._classifyBluezIcon(iconName, alias);

                            btList.push({
                                id: path,
                                address: address,
                                name: this._shortenDeviceName(alias),
                                fullName: alias,
                                percentage: pct !== null ? Math.max(0, Math.min(100, pct)) : 0,
                                hasBatteryLevel: pct !== null,
                                connected: connected,
                                paired: paired,
                                type: devType
                            });
                        }
                        this._cachedBtDevices = btList;
                        this._updateBatteries();
                        this._updateCanvasSize();
                        if (this.canvas) this.canvas.queue_repaint();
                    } catch (e) {}
                }
            );
        } catch (e) {
            this._btQueryInProgress = false;
        }
    }

    _classifyUPowerDevice(kind, model, nativePath) {
        let m = (model || "").toLowerCase();
        if (kind === 2 && nativePath.toUpperCase().startsWith("BAT")) {
            return { type: "laptop", defaultName: "Notebook" };
        }
        if (kind === 5 || m.includes("mouse") || m.includes("mx ")) {
            return { type: "mouse", defaultName: "Mouse" };
        }
        if (kind === 6 || m.includes("keyboard") || m.includes("key")) {
            return { type: "keyboard", defaultName: "Teclado" };
        }
        if (kind === 7 || kind === 17 || m.includes("head") || m.includes("buds") || m.includes("airpods") || m.includes("qcy") || m.includes("sony") || m.includes("jbl")) {
            return { type: "headphone", defaultName: "Fones" };
        }
        if (kind === 12 || m.includes("controller") || m.includes("gamepad") || m.includes("xbox") || m.includes("dualshock") || m.includes("dualsense")) {
            return { type: "gamepad", defaultName: "Controle" };
        }
        if (kind === 8 || m.includes("phone") || m.includes("iphone")) {
            return { type: "phone", defaultName: "Celular" };
        }
        return { type: "bluetooth", defaultName: "Bateria" };
    }

    _classifyBluezIcon(iconName, alias) {
        let ic = (iconName || "").toLowerCase();
        let al = (alias || "").toLowerCase();
        if (ic.includes("headset") || ic.includes("headphone") || al.includes("qcy") || al.includes("airpods") || al.includes("buds") || al.includes("fone")) {
            return "headphone";
        }
        if (ic.includes("audio") || ic.includes("speaker") || al.includes("studio") || al.includes("jbl") || al.includes("onyx") || al.includes("speaker")) {
            return "speaker";
        }
        if (ic.includes("mouse") || al.includes("mouse")) {
            return "mouse";
        }
        if (ic.includes("keyboard") || al.includes("keyboard") || al.includes("teclado")) {
            return "keyboard";
        }
        if (ic.includes("gaming") || ic.includes("joypad") || al.includes("controller") || al.includes("xbox") || al.includes("dualsense")) {
            return "gamepad";
        }
        if (ic.includes("phone") || al.includes("iphone") || al.includes("galaxy")) {
            return "phone";
        }
        return "bluetooth";
    }

    _shortenDeviceName(name) {
        if (!name) return "Device";
        let clean = name.trim();
        if (/^[A-Z0-9]{2,5}-[A-Z0-9]{2,5}$/i.test(clean)) {
            return "Notebook";
        }
        if (clean.length > 12) {
            return clean.substring(0, 11).trim() + "…";
        }
        return clean;
    }

    // =========================================================================
    // LAYOUT & SIZING
    // =========================================================================

    _getActiveHardwareRings() {
        let rings = [];

        if (this.showCpu) {
            let tempStr = this.metrics.cpu.temp !== null ? (this.metrics.cpu.temp + "°C") : "CPU";
            rings.push({
                id: "cpu",
                label: "CPU",
                subLabel: tempStr,
                valueText: this.metrics.cpu.usage + "%",
                progress: this.metrics.cpu.usage / 100.0,
                color: this._getMetricColor("cpu", this.metrics.cpu.usage, this.metrics.cpu.temp),
                icon: "cpu"
            });
        }

        if (this.showRam) {
            let usedStr = this.metrics.ram.usedGb.toFixed(1) + "/" + Math.round(this.metrics.ram.totalGb) + "G";
            rings.push({
                id: "ram",
                label: "RAM",
                subLabel: usedStr,
                valueText: this.metrics.ram.usage + "%",
                progress: this.metrics.ram.usage / 100.0,
                color: this._getMetricColor("ram", this.metrics.ram.usage, null),
                icon: "ram"
            });
        }

        if (this.showGpu) {
            if (this.metrics.gpu.available) {
                let sub = this.metrics.gpu.temp !== null
                    ? (this.metrics.gpu.temp + "°C")
                    : (this.metrics.gpu.vramTotalMb > 0 ? Math.round(this.metrics.gpu.vramUsedMb / 102.4) / 10 + "G" : "GPU");
                rings.push({
                    id: "gpu",
                    label: "GPU",
                    subLabel: sub,
                    valueText: this.metrics.gpu.usage + "%",
                    progress: this.metrics.gpu.usage / 100.0,
                    color: this._getMetricColor("gpu", this.metrics.gpu.usage, this.metrics.gpu.temp),
                    icon: "gpu"
                });
            } else {
                rings.push({
                    id: "gpu",
                    label: "GPU",
                    subLabel: "Integrada",
                    valueText: "N/A",
                    progress: 0,
                    color: [0.55, 0.55, 0.60],
                    icon: "gpu"
                });
            }
        }

        if (this.showFan) {
            let rpm = this.metrics.fan.rpm || 0;
            let maxRpm = Math.max(1500, this.maxFanRpm || 5500);
            let pct = Math.min(1.0, Math.max(0, rpm / maxRpm));
            let valTxt = this.metrics.fan.available
                ? (rpm >= 1000 ? (rpm / 1000).toFixed(1) + "k" : rpm + "")
                : "0";
            let subTxt = this.metrics.fan.available ? (rpm + " RPM") : "Silencioso";
            rings.push({
                id: "fan",
                label: "COOLER",
                subLabel: subTxt,
                valueText: valTxt,
                progress: pct,
                color: this._getMetricColor("fan", pct * 100, null),
                icon: "fan"
            });
        }

        return rings;
    }

    _calculateDimensions() {
        let s = this.scaleSize || 1.0;
        let cols = Math.max(2, Math.min(6, this.columnsPerRow || 4));
        let pad = Math.round(18 * s);
        let cellW = Math.round(74 * s);
        let cellH = Math.round(92 * s);
        let colGap = Math.round(10 * s);
        let rowGap = Math.round(10 * s);

        let width = pad * 2 + cols * cellW + (cols - 1) * colGap;
        let height = pad * 2;

        if (this.showHeader) {
            height += Math.round(28 * s);
        }

        let hwRings = this._getActiveHardwareRings();
        if (hwRings.length > 0) {
            let hwRows = Math.ceil(hwRings.length / cols);
            height += hwRows * cellH + (hwRows - 1) * rowGap + Math.round(8 * s);
        }

        if (this.showDisk || this.showNetwork) {
            height += Math.round(10 * s);
            if (this.showDisk && this.showNetwork) {
                height += Math.round(54 * s);
            } else {
                height += Math.round(48 * s);
            }
        }

        if (this.showBatteries) {
            let batCount = Math.max(1, this.metrics.batteries.length);
            let batRows = Math.ceil(batCount / cols);
            height += Math.round(28 * s);
            height += batRows * cellH + (batRows - 1) * rowGap;
        }

        return { width, height, pad, cellW, cellH, colGap, rowGap, cols, scale: s };
    }

    _updateCanvasSize() {
        if (!this.canvas) return;
        let dims = this._calculateDimensions();
        this.canvas.set_size(dims.width, dims.height);
    }

    // =========================================================================
    // THEME & COLOR PALETTE (iOS / macOS Sonoma Style)
    // =========================================================================

    _isDarkMode() {
        if (this.themeMode === "dark") return true;
        if (this.themeMode === "light") return false;
        try {
            let s = new Gio.Settings({ schema_id: "org.cinnamon.theme" });
            let name = (s.get_string("name") || "").toLowerCase();
            return name.includes("dark") || name.includes("black") || name.includes("noir");
        } catch (e) {
            return true;
        }
    }

    _getThemePalette() {
        let dark = this._isDarkMode();
        let alpha = Math.max(0.15, Math.min(1.0, this.bgOpacity || 0.78));

        if (dark) {
            return {
                isDark: true,
                bgTop: [0.11, 0.11, 0.13, alpha],
                bgBottom: [0.07, 0.07, 0.09, Math.min(1.0, alpha + 0.06)],
                cardBg: [1.0, 1.0, 1.0, 0.055],
                cardBorder: [1.0, 1.0, 1.0, 0.09],
                outerBorder: [1.0, 1.0, 1.0, 0.16],
                innerShadow: [0.0, 0.0, 0.0, 0.35],
                textPrimary: [0.98, 0.98, 1.0, 0.96],
                textSecondary: [0.92, 0.92, 0.96, 0.62],
                textMuted: [0.90, 0.90, 0.95, 0.42],
                trackBg: [1.0, 1.0, 1.0, 0.11],
                divider: [1.0, 1.0, 1.0, 0.09]
            };
        } else {
            return {
                isDark: false,
                bgTop: [0.97, 0.97, 0.99, alpha],
                bgBottom: [0.91, 0.92, 0.95, Math.min(1.0, alpha + 0.06)],
                cardBg: [0.0, 0.0, 0.0, 0.045],
                cardBorder: [0.0, 0.0, 0.0, 0.07],
                outerBorder: [1.0, 1.0, 1.0, 0.65],
                innerShadow: [0.0, 0.0, 0.0, 0.10],
                textPrimary: [0.08, 0.08, 0.11, 0.92],
                textSecondary: [0.20, 0.20, 0.26, 0.65],
                textMuted: [0.25, 0.25, 0.32, 0.45],
                trackBg: [0.0, 0.0, 0.0, 0.09],
                divider: [0.0, 0.0, 0.0, 0.08]
            };
        }
    }

    _getMetricColor(type, pct, tempC) {
        if (this.accentStyle === "blue") {
            return [0.039, 0.518, 1.0];
        }
        if (this.accentStyle === "green") {
            return [0.188, 0.820, 0.345];
        }

        if ((type === "cpu" || type === "gpu") && tempC !== null) {
            if (tempC >= 85) return [1.0, 0.271, 0.227];
            if (tempC >= 75) return [1.0, 0.624, 0.039];
        }

        if (pct >= 90 && (type === "cpu" || type === "ram" || type === "gpu" || type === "disk")) {
            return [1.0, 0.271, 0.227];
        }

        switch (type) {
            case "cpu":
                return [0.039, 0.518, 1.0];
            case "ram":
                return [0.749, 0.353, 0.949];
            case "gpu":
                return [1.0, 0.624, 0.039];
            case "fan":
                return [0.392, 0.824, 1.0];
            case "disk":
                return [0.369, 0.361, 0.902];
            case "net":
                return [0.188, 0.820, 0.345];
            default:
                return [0.039, 0.518, 1.0];
        }
    }

    _getBatteryColor(pct, charging, connected) {
        if (!connected) return [0.55, 0.55, 0.60];
        if (this.accentStyle === "blue") return [0.039, 0.518, 1.0];
        if (charging) return [0.188, 0.820, 0.345];
        if (pct <= 15) return [1.0, 0.271, 0.227];
        if (pct <= 25) return [1.0, 0.839, 0.039];
        return [0.188, 0.820, 0.345];
    }

    // =========================================================================
    // CAIRO VECTOR RENDERING (iOS / macOS Widget)
    // =========================================================================

    _onRepaint(area) {
        let cr = area.get_context();
        let [w, h] = area.get_surface_size();
        let dims = this._calculateDimensions();
        let s = dims.scale;
        let palette = this._getThemePalette();
        let radius = Math.min(Math.round((this.cornerRadius || 24) * s), Math.min(w, h) / 2);

        cr.save();
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.restore();

        cr.setAntialias(Cairo.Antialias.BEST);

        // 1. Main Glassmorphic Squircle Card
        this._drawRoundedRect(cr, 1.5, 1.5, w - 3, h - 3, radius);
        let grad = new Cairo.LinearGradient(0, 0, 0, h);
        grad.addColorStopRGBA(0, palette.bgTop[0], palette.bgTop[1], palette.bgTop[2], palette.bgTop[3]);
        grad.addColorStopRGBA(1, palette.bgBottom[0], palette.bgBottom[1], palette.bgBottom[2], palette.bgBottom[3]);
        cr.setSource(grad);
        cr.fillPreserve();

        let borderGrad = new Cairo.LinearGradient(0, 0, 0, h);
        borderGrad.addColorStopRGBA(0, palette.outerBorder[0], palette.outerBorder[1], palette.outerBorder[2], palette.outerBorder[3]);
        borderGrad.addColorStopRGBA(1, palette.outerBorder[0], palette.outerBorder[1], palette.outerBorder[2], palette.outerBorder[3] * 0.35);
        cr.setSource(borderGrad);
        cr.setLineWidth(1.25);
        cr.stroke();

        let cursorY = dims.pad;

        // 2. Header Row (macOS Sonoma Widget Header style)
        if (this.showHeader) {
            cr.newPath();
            cr.arc(dims.pad + 5 * s, cursorY + 8 * s, 3.8 * s, 0, 2 * Math.PI);
            cr.setSourceRGBA(0.188, 0.820, 0.345, 0.95);
            cr.fill();

            this._drawText(cr, this.metrics.hostname.toUpperCase(), dims.pad + 14 * s, cursorY, {
                size: Math.round(9.5 * s),
                weight: Pango.Weight.BOLD,
                color: palette.textSecondary,
                align: "left"
            });

            if (this.metrics.uptimeStr) {
                this._drawText(cr, "ATIVO " + this.metrics.uptimeStr.toUpperCase(), w - dims.pad, cursorY, {
                    size: Math.round(8.5 * s),
                    weight: Pango.Weight.BOLD,
                    color: palette.textMuted,
                    align: "right"
                });
            }

            cursorY += Math.round(26 * s);
        }

        // 3. Hardware Rings Grid (CPU, RAM, GPU, Fan RPM)
        let hwRings = this._getActiveHardwareRings();
        if (hwRings.length > 0) {
            cursorY = this._drawRingGrid(cr, hwRings, dims.pad, cursorY, dims, palette, false);
            cursorY += Math.round(6 * s);
        }

        // 4. Compact Cards Row: Storage Disk & Network Throughput
        if (this.showDisk || this.showNetwork) {
            if (hwRings.length > 0) {
                cr.moveTo(dims.pad, cursorY);
                cr.lineTo(w - dims.pad, cursorY);
                cr.setSourceRGBA(palette.divider[0], palette.divider[1], palette.divider[2], palette.divider[3]);
                cr.setLineWidth(1);
                cr.stroke();
                cursorY += Math.round(10 * s);
            }

            let innerW = w - dims.pad * 2;
            let cardH = Math.round(46 * s);

            if (this.showDisk && this.showNetwork) {
                let halfW = Math.floor((innerW - Math.round(10 * s)) / 2);
                this._drawDiskCard(cr, dims.pad, cursorY, halfW, cardH, s, palette);
                this._drawNetworkCard(cr, dims.pad + halfW + Math.round(10 * s), cursorY, halfW, cardH, s, palette);
            } else if (this.showDisk) {
                this._drawDiskCard(cr, dims.pad, cursorY, innerW, cardH, s, palette);
            } else if (this.showNetwork) {
                this._drawNetworkCard(cr, dims.pad, cursorY, innerW, cardH, s, palette);
            }

            cursorY += cardH + Math.round(10 * s);
        }

        // 5. Batteries Section (iOS Batteries Widget style)
        if (this.showBatteries) {
            if (hwRings.length > 0 || this.showDisk || this.showNetwork) {
                cr.moveTo(dims.pad, cursorY);
                cr.lineTo(w - dims.pad, cursorY);
                cr.setSourceRGBA(palette.divider[0], palette.divider[1], palette.divider[2], palette.divider[3]);
                cr.setLineWidth(1);
                cr.stroke();
                cursorY += Math.round(8 * s);
            }

            this._drawText(cr, "BATERIAS & BLUETOOTH", dims.pad, cursorY, {
                size: Math.round(8.5 * s),
                weight: Pango.Weight.BOLD,
                color: palette.textSecondary,
                align: "left"
            });

            let btConnectedCount = this.metrics.batteries.filter(b => b.connected).length;
            this._drawText(cr, btConnectedCount + (btConnectedCount === 1 ? " ATIVO" : " ATIVOS"), w - dims.pad, cursorY, {
                size: Math.round(8 * s),
                weight: Pango.Weight.NORMAL,
                color: palette.textMuted,
                align: "right"
            });

            cursorY += Math.round(20 * s);

            let batRings = this.metrics.batteries.map(b => ({
                id: b.id,
                label: b.name,
                subLabel: b.charging ? "Carregando" : (b.connected ? (b.percentage + "%") : "Offline"),
                valueText: b.percentage + "%",
                progress: (b.connected ? b.percentage : 0) / 100.0,
                color: this._getBatteryColor(b.percentage, b.charging, b.connected),
                icon: b.type,
                charging: b.charging,
                connected: b.connected
            }));

            if (batRings.length === 0) {
                batRings.push({
                    id: "no-bt",
                    label: "Bluetooth",
                    subLabel: "Sem bateria",
                    valueText: "--",
                    progress: 0,
                    color: [0.55, 0.55, 0.60],
                    icon: "bluetooth",
                    charging: false,
                    connected: false
                });
            }

            this._drawRingGrid(cr, batRings, dims.pad, cursorY, dims, palette, true);
        }

        cr.$dispose();
    }

    _drawRingGrid(cr, items, startX, startY, dims, palette, isBatteryMode) {
        let s = dims.scale;
        let cols = dims.cols;
        let ringRadius = Math.round(24 * s);
        let strokeW = Math.round(5.8 * s);

        for (let idx = 0; idx < items.length; idx++) {
            let item = items[idx];
            let col = idx % cols;
            let row = Math.floor(idx / cols);

            let cellX = startX + col * (dims.cellW + dims.colGap);
            let cellY = startY + row * (dims.cellH + dims.rowGap);

            let cx = cellX + dims.cellW / 2;
            let cy = cellY + ringRadius + Math.round(4 * s);

            cr.newPath();
            cr.arc(cx, cy, ringRadius, 0, 2 * Math.PI);
            cr.setSourceRGBA(palette.trackBg[0], palette.trackBg[1], palette.trackBg[2], palette.trackBg[3]);
            cr.setLineWidth(strokeW);
            cr.stroke();

            let progress = Math.max(0, Math.min(1.0, item.progress || 0));
            if (progress > 0.005) {
                let startAngle = -Math.PI / 2;
                let endAngle = startAngle + progress * 2 * Math.PI;

                cr.newPath();
                cr.setLineCap(Cairo.LineCap.ROUND);
                cr.arc(cx, cy, ringRadius, startAngle, endAngle);
                cr.setSourceRGBA(item.color[0], item.color[1], item.color[2], 0.96);
                cr.setLineWidth(strokeW);
                cr.stroke();
            }

            if (isBatteryMode) {
                this._drawVectorIcon(cr, item.icon, cx, cy, Math.round(16 * s), item.connected ? palette.textPrimary : palette.textMuted);
                if (item.charging) {
                    let bx = cx;
                    let by = cy - ringRadius;
                    cr.newPath();
                    cr.arc(bx, by, Math.round(6.5 * s), 0, 2 * Math.PI);
                    cr.setSourceRGBA(palette.bgBottom[0], palette.bgBottom[1], palette.bgBottom[2], 1.0);
                    cr.fill();
                    this._drawVectorIcon(cr, "bolt", bx, by, Math.round(9 * s), [0.188, 0.820, 0.345, 1.0]);
                }
            } else {
                this._drawText(cr, item.valueText, cx, cy - Math.round(7 * s), {
                    size: Math.round(10.5 * s),
                    weight: Pango.Weight.BOLD,
                    color: palette.textPrimary,
                    align: "center"
                });
            }

            let labelY = cy + ringRadius + Math.round(6 * s);
            this._drawText(cr, item.label, cx, labelY, {
                size: Math.round(8.8 * s),
                weight: Pango.Weight.BOLD,
                color: palette.textPrimary,
                align: "center",
                maxWidth: dims.cellW + Math.round(6 * s)
            });

            let subY = labelY + Math.round(13 * s);
            this._drawText(cr, item.subLabel, cx, subY, {
                size: Math.round(8.0 * s),
                weight: Pango.Weight.NORMAL,
                color: item.charging ? [0.188, 0.820, 0.345, 0.95] : palette.textSecondary,
                align: "center",
                maxWidth: dims.cellW + Math.round(8 * s)
            });
        }

        let totalRows = Math.ceil(items.length / cols);
        return startY + totalRows * dims.cellH + Math.max(0, totalRows - 1) * dims.rowGap;
    }

    _drawDiskCard(cr, x, y, w, h, s, palette) {
        let r = Math.round(12 * s);
        this._drawRoundedRect(cr, x, y, w, h, r);
        cr.setSourceRGBA(palette.cardBg[0], palette.cardBg[1], palette.cardBg[2], palette.cardBg[3]);
        cr.fillPreserve();
        cr.setSourceRGBA(palette.cardBorder[0], palette.cardBorder[1], palette.cardBorder[2], palette.cardBorder[3]);
        cr.setLineWidth(1);
        cr.stroke();

        let padX = Math.round(10 * s);
        let padY = Math.round(7 * s);

        let diskColor = this._getMetricColor("disk", this.metrics.disk.usage, null);
        this._drawVectorIcon(cr, "disk", x + padX + Math.round(6 * s), y + padY + Math.round(6 * s), Math.round(11 * s), [diskColor[0], diskColor[1], diskColor[2], 0.95]);

        let title = "DISCO (" + this.metrics.disk.mount + ")";
        this._drawText(cr, title, x + padX + Math.round(16 * s), y + padY - Math.round(1 * s), {
            size: Math.round(8.0 * s),
            weight: Pango.Weight.BOLD,
            color: palette.textSecondary,
            align: "left"
        });

        let pctText = this.metrics.disk.usage + "%";
        this._drawText(cr, pctText, x + w - padX, y + padY - Math.round(1 * s), {
            size: Math.round(8.5 * s),
            weight: Pango.Weight.BOLD,
            color: palette.textPrimary,
            align: "right"
        });

        let barY = y + Math.round(23 * s);
        let barH = Math.round(5.5 * s);
        let barW = w - padX * 2;

        this._drawRoundedRect(cr, x + padX, barY, barW, barH, barH / 2);
        cr.setSourceRGBA(palette.trackBg[0], palette.trackBg[1], palette.trackBg[2], palette.trackBg[3]);
        cr.fill();

        let fillW = Math.max(barH, Math.round(barW * (this.metrics.disk.usage / 100.0)));
        if (this.metrics.disk.usage > 0) {
            this._drawRoundedRect(cr, x + padX, barY, Math.min(barW, fillW), barH, barH / 2);
            cr.setSourceRGBA(diskColor[0], diskColor[1], diskColor[2], 0.95);
            cr.fill();
        }

        let freeText = Math.round(this.metrics.disk.freeGb) + " GB livres de " + Math.round(this.metrics.disk.totalGb) + " GB";
        this._drawText(cr, freeText, x + padX, y + Math.round(31 * s), {
            size: Math.round(7.5 * s),
            weight: Pango.Weight.NORMAL,
            color: palette.textMuted,
            align: "left",
            maxWidth: barW
        });
    }

    _drawNetworkCard(cr, x, y, w, h, s, palette) {
        let r = Math.round(12 * s);
        this._drawRoundedRect(cr, x, y, w, h, r);
        cr.setSourceRGBA(palette.cardBg[0], palette.cardBg[1], palette.cardBg[2], palette.cardBg[3]);
        cr.fillPreserve();
        cr.setSourceRGBA(palette.cardBorder[0], palette.cardBorder[1], palette.cardBorder[2], palette.cardBorder[3]);
        cr.setLineWidth(1);
        cr.stroke();

        let padX = Math.round(10 * s);
        let padY = Math.round(7 * s);

        let netColor = this._getMetricColor("net", 0, null);
        this._drawVectorIcon(cr, "wifi", x + padX + Math.round(6 * s), y + padY + Math.round(6 * s), Math.round(11 * s), [netColor[0], netColor[1], netColor[2], 0.95]);

        this._drawText(cr, "REDE", x + padX + Math.round(16 * s), y + padY - Math.round(1 * s), {
            size: Math.round(8.0 * s),
            weight: Pango.Weight.BOLD,
            color: palette.textSecondary,
            align: "left"
        });

        this._drawText(cr, this.metrics.net.iface, x + w - padX, y + padY - Math.round(1 * s), {
            size: Math.round(7.5 * s),
            weight: Pango.Weight.NORMAL,
            color: palette.textMuted,
            align: "right"
        });

        let downStr = "↓ " + this._formatSpeed(this.metrics.net.rxSpeed);
        let upStr = "↑ " + this._formatSpeed(this.metrics.net.txSpeed);

        this._drawText(cr, downStr, x + padX, y + Math.round(20 * s), {
            size: Math.round(8.8 * s),
            weight: Pango.Weight.BOLD,
            color: palette.textPrimary,
            align: "left"
        });

        this._drawText(cr, upStr, x + padX, y + Math.round(32 * s), {
            size: Math.round(7.8 * s),
            weight: Pango.Weight.NORMAL,
            color: palette.textSecondary,
            align: "left"
        });
    }

    _formatSpeed(bytesPerSec) {
        if (!bytesPerSec || bytesPerSec < 1024) {
            return Math.round(bytesPerSec || 0) + " B/s";
        }
        let kb = bytesPerSec / 1024.0;
        if (kb < 1024) {
            return kb.toFixed(1) + " KB/s";
        }
        let mb = kb / 1024.0;
        return mb.toFixed(1) + " MB/s";
    }

    // =========================================================================
    // VECTOR ICONS & PRIMITIVES
    // =========================================================================

    _drawVectorIcon(cr, type, cx, cy, size, color) {
        cr.save();
        cr.setSourceRGBA(color[0], color[1], color[2], color[3] !== undefined ? color[3] : 0.95);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        let r = size / 2;

        switch (type) {
            case "laptop": {
                let bw = r * 1.45;
                let bh = r * 0.95;
                this._drawRoundedRect(cr, cx - bw / 2, cy - bh / 2 - r * 0.1, bw, bh, 2);
                cr.setLineWidth(1.6);
                cr.stroke();
                cr.moveTo(cx - bw * 0.68, cy + bh / 2 + r * 0.05);
                cr.lineTo(cx + bw * 0.68, cy + bh / 2 + r * 0.05);
                cr.setLineWidth(2.0);
                cr.stroke();
                break;
            }
            case "headphone": {
                cr.newPath();
                cr.arc(cx, cy, r * 0.68, Math.PI, 0);
                cr.setLineWidth(1.8);
                cr.stroke();
                this._drawRoundedRect(cr, cx - r * 0.82, cy - r * 0.05, r * 0.34, r * 0.62, 2);
                cr.fill();
                this._drawRoundedRect(cr, cx + r * 0.48, cy - r * 0.05, r * 0.34, r * 0.62, 2);
                cr.fill();
                break;
            }
            case "speaker": {
                let sw = r * 1.1;
                let sh = r * 1.45;
                this._drawRoundedRect(cr, cx - sw / 2, cy - sh / 2, sw, sh, 2.5);
                cr.setLineWidth(1.5);
                cr.stroke();
                cr.newPath();
                cr.arc(cx, cy - sh * 0.22, r * 0.14, 0, 2 * Math.PI);
                cr.fill();
                cr.newPath();
                cr.arc(cx, cy + sh * 0.18, r * 0.28, 0, 2 * Math.PI);
                cr.setLineWidth(1.4);
                cr.stroke();
                break;
            }
            case "mouse": {
                let mw = r * 0.95;
                let mh = r * 1.45;
                this._drawRoundedRect(cr, cx - mw / 2, cy - mh / 2, mw, mh, mw / 2);
                cr.setLineWidth(1.6);
                cr.stroke();
                cr.moveTo(cx, cy - mh * 0.28);
                cr.lineTo(cx, cy - mh * 0.05);
                cr.setLineWidth(1.5);
                cr.stroke();
                break;
            }
            case "keyboard": {
                let kw = r * 1.55;
                let kh = r * 0.95;
                this._drawRoundedRect(cr, cx - kw / 2, cy - kh / 2, kw, kh, 2);
                cr.setLineWidth(1.5);
                cr.stroke();
                cr.moveTo(cx - kw * 0.25, cy + kh * 0.22);
                cr.lineTo(cx + kw * 0.25, cy + kh * 0.22);
                cr.stroke();
                break;
            }
            case "gamepad": {
                let gw = r * 1.55;
                let gh = r * 0.95;
                this._drawRoundedRect(cr, cx - gw / 2, cy - gh / 2, gw, gh, gh * 0.4);
                cr.setLineWidth(1.5);
                cr.stroke();
                cr.newPath();
                cr.arc(cx - gw * 0.22, cy, 1.3, 0, 2 * Math.PI);
                cr.fill();
                cr.newPath();
                cr.arc(cx + gw * 0.22, cy, 1.3, 0, 2 * Math.PI);
                cr.fill();
                break;
            }
            case "phone": {
                let pw = r * 0.88;
                let ph = r * 1.5;
                this._drawRoundedRect(cr, cx - pw / 2, cy - ph / 2, pw, ph, 2.5);
                cr.setLineWidth(1.5);
                cr.stroke();
                break;
            }
            case "bolt": {
                cr.moveTo(cx + r * 0.15, cy - r * 0.85);
                cr.lineTo(cx - r * 0.45, cy + r * 0.05);
                cr.lineTo(cx + r * 0.05, cy + r * 0.05);
                cr.lineTo(cx - r * 0.15, cy + r * 0.85);
                cr.lineTo(cx + r * 0.45, cy - r * 0.05);
                cr.lineTo(cx - r * 0.05, cy - r * 0.05);
                cr.closePath();
                cr.fill();
                break;
            }
            case "disk": {
                this._drawRoundedRect(cr, cx - r * 0.85, cy - r * 0.65, r * 1.7, r * 1.3, 2);
                cr.setLineWidth(1.4);
                cr.stroke();
                cr.newPath();
                cr.arc(cx + r * 0.45, cy + r * 0.2, 1.3, 0, 2 * Math.PI);
                cr.fill();
                break;
            }
            case "wifi": {
                cr.newPath();
                cr.arc(cx, cy + r * 0.55, 1.5, 0, 2 * Math.PI);
                cr.fill();
                cr.setLineWidth(1.4);
                cr.newPath();
                cr.arc(cx, cy + r * 0.55, r * 0.65, -Math.PI * 0.78, -Math.PI * 0.22);
                cr.stroke();
                cr.newPath();
                cr.arc(cx, cy + r * 0.55, r * 1.15, -Math.PI * 0.78, -Math.PI * 0.22);
                cr.stroke();
                break;
            }
            default: {
                cr.setLineWidth(1.5);
                cr.moveTo(cx - r * 0.38, cy - r * 0.38);
                cr.lineTo(cx + r * 0.38, cy + r * 0.38);
                cr.lineTo(cx, cy + r * 0.78);
                cr.lineTo(cx, cy - r * 0.78);
                cr.lineTo(cx + r * 0.38, cy - r * 0.38);
                cr.lineTo(cx - r * 0.38, cy + r * 0.38);
                cr.stroke();
                break;
            }
        }

        cr.restore();
    }

    _drawRoundedRect(cr, x, y, w, h, r) {
        let radius = Math.min(r, w / 2, h / 2);
        cr.newSubPath();
        cr.arc(x + w - radius, y + radius, radius, -Math.PI / 2, 0);
        cr.arc(x + w - radius, y + h - radius, radius, 0, Math.PI / 2);
        cr.arc(x + radius, y + h - radius, radius, Math.PI / 2, Math.PI);
        cr.arc(x + radius, y + radius, radius, Math.PI, 3 * Math.PI / 2);
        cr.closePath();
    }

    _drawText(cr, text, x, y, opts) {
        let layout = PangoCairo.create_layout(cr);
        let fontDesc = new Pango.FontDescription();
        fontDesc.set_family("SF Pro Display, Inter, Ubuntu, Cantarell, Sans");
        fontDesc.set_weight(opts.weight || Pango.Weight.NORMAL);
        fontDesc.set_size((opts.size || 10) * Pango.SCALE);
        layout.set_font_description(fontDesc);

        if (opts.maxWidth) {
            layout.set_width(opts.maxWidth * Pango.SCALE);
            layout.set_ellipsize(Pango.EllipsizeMode.END);
        }

        layout.set_text(String(text !== undefined && text !== null ? text : ""), -1);
        let [tw] = layout.get_pixel_size();

        let drawX = x;
        if (opts.align === "center") {
            drawX = x - tw / 2;
        } else if (opts.align === "right") {
            drawX = x - tw;
        }

        let c = opts.color || [1, 1, 1, 1];
        cr.setSourceRGBA(c[0], c[1], c[2], c[3] !== undefined ? c[3] : 1.0);
        cr.moveTo(drawX, y);
        PangoCairo.show_layout(cr, layout);
        cr.newPath();
    }
}

function main(metadata, desklet_id) {
    return new IOSHardwareMonitorDesklet(metadata, desklet_id);
}
