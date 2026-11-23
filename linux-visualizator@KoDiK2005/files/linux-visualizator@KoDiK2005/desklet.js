const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Clutter = imports.gi.Clutter;
const Cairo = imports.cairo;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const ByteArray = imports.byteArray;
const Gettext = imports.gettext;

const UUID = 'linux-visualizator@KoDiK2005';
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + '/.local/share/locale');

function _(str) {
    return Gettext.dgettext(UUID, str);
}

// ---- тема (соответствует ui/widget/theme.py в Python-версии) ----
const COLOR_BG_TOP = [26 / 255, 27 / 255, 34 / 255];
const COLOR_BG_BOTTOM = [16 / 255, 17 / 255, 22 / 255];
const COLOR_BORDER = [1, 1, 1, 0.09];
const COLOR_TEXT = [230 / 255, 230 / 255, 235 / 255, 1];
const COLOR_LABEL = [150 / 255, 152 / 255, 160 / 255, 1];
const COLOR_CPU = [0x4f / 255, 0xc3 / 255, 0xf7 / 255, 1];
const COLOR_MEM = [0x81 / 255, 0xc7 / 255, 0x84 / 255, 1];
const COLOR_NET_DOWN = [0xff / 255, 0xb7 / 255, 0x4d / 255, 1];
const COLOR_NET_UP = COLOR_CPU;
const COLOR_DISK = [0xba / 255, 0x68 / 255, 0xc8 / 255, 1];
const COLOR_DISK_WRITE = [0xe5 / 255, 0x73 / 255, 0x73 / 255, 1];
const COLOR_GPU = [0x4d / 255, 0xd0 / 255, 0xe1 / 255, 1];
const COLOR_WARN = [0xff / 255, 0xca / 255, 0x28 / 255, 1];
const COLOR_BAD = [0xef / 255, 0x53 / 255, 0x50 / 255, 1];

// ---- геометрия ----
const RING_SIZE = 36;
const RING_SPACING = 8;
const RING_THICKNESS = 4;
const BAR_HEIGHT = 12;
const BAR_SPACING = 5;
const SPARK_HEIGHT = 40;
const SPARK_LABEL_HEIGHT = 14;
const HISTORY_LEN = 60;
const HEADER_HEIGHT = 13;
const SECTION_SPACING = 14;
const MARGIN = 16;
const CORNER_RADIUS = 14;
const MIN_PARTITION_BYTES = 1 * 1024 * 1024 * 1024;
const DISK_DEVICE_RE = /^(sd[a-z]+|nvme\d+n\d+|mmcblk\d+|vd[a-z]+)$/;
const LABEL_FONT = 'Cantarell';
const NUMBER_FONT = 'Cantarell';
// Cairo toy-text API не делает автоматический fallback шрифта по глифу — Cantarell не
// содержит стрелки ↓/↑, поэтому для строк со стрелками нужен шрифт, где они точно есть.
const SYMBOL_FONT = 'DejaVu Sans';
const ANIMATION_INTERVAL_MS = 33; // ~30 fps, только на несколько кадров после каждого тика
const SMOOTHING_FACTOR = 0.25;

// Асинхронное чтение файла вместо GLib.file_get_contents — блокирующий ввод-вывод на каждом
// тике нежелателен для главного цикла Cinnamon (shell-приложения не должны блокировать UI-поток).
function readFileAsync(path, cancellable = null) {
    return new Promise((resolve) => {
        let file = Gio.File.new_for_path(path);
        file.load_contents_async(cancellable, (source, result) => {
            try {
                let [success, contents] = source.load_contents_finish(result);
                resolve(success ? ByteArray.toString(contents) : null);
            } catch (e) {
                resolve(null);
            }
        });
    });
}

// Асинхронный запуск внешней команды (argv-массив, без /bin/sh -c с конкатенацией пользовательских
// строк — так исключается риск command injection).
function runProcessAsync(argv, cancellable = null) {
    return new Promise((resolve) => {
        try {
            let proc = new Gio.Subprocess({
                argv, flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            });
            proc.init(cancellable);
            proc.communicate_utf8_async(null, cancellable, (source, result) => {
                try {
                    let [, stdout] = source.communicate_utf8_finish(result);
                    resolve(stdout || '');
                } catch (e) {
                    resolve(null);
                }
            });
        } catch (e) {
            resolve(null);
        }
    });
}

// Асинхронный листинг директории (замена Gio.File.enumerate_children).
function listDirAsync(path, cancellable = null) {
    return new Promise((resolve) => {
        let dir = Gio.File.new_for_path(path);
        dir.enumerate_children_async(
            'standard::name', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable,
            (source, result) => {
                try {
                    let enumerator = source.enumerate_children_finish(result);
                    enumerator.next_files_async(64, GLib.PRIORITY_DEFAULT, cancellable, (source2, result2) => {
                        try {
                            let infos = source2.next_files_finish(result2);
                            resolve(infos.map((info) => info.get_name()));
                        } catch (e) {
                            resolve([]);
                        }
                    });
                } catch (e) {
                    resolve([]);
                }
            });
    });
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function lerpColor(c1, c2, t) {
    return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t), lerp(c1[3], c2[3], t)];
}

// Осветляет цвет к белому — используется для вторичной линии спарклайна (отправлено/запись),
// когда основной акцент задаётся пользователем через один colorchooser на категорию.
function lightenColor(color, amount) {
    return lerpColor(color, [1, 1, 1, color[3]], amount);
}

// Cinnamon хранит colorchooser-настройки как "rgb(r,g,b)"/"rgba(r,g,b,a)" или hex.
function parseColor(value, fallback) {
    if (!value) return fallback;
    let m = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
    if (m) {
        return [parseFloat(m[1]) / 255, parseFloat(m[2]) / 255, parseFloat(m[3]) / 255, m[4] !== undefined ? parseFloat(m[4]) : 1];
    }
    let hex = value.replace('#', '');
    if (hex.length === 6 || hex.length === 8) {
        let r = parseInt(hex.substr(0, 2), 16) / 255;
        let g = parseInt(hex.substr(2, 2), 16) / 255;
        let b = parseInt(hex.substr(4, 2), 16) / 255;
        let a = hex.length === 8 ? parseInt(hex.substr(6, 2), 16) / 255 : 1;
        return [r, g, b, a];
    }
    return fallback;
}

// Подмешивает жёлтый/красный к базовому цвету при высокой загрузке — быстрый визуальный сигнал.
// Пороги настраиваются пользователем (warn-threshold/bad-threshold), по умолчанию 70/90.
function severityColor(baseColor, percent, warnThreshold, badThreshold) {
    let warn = warnThreshold !== undefined ? warnThreshold : 70;
    let bad = badThreshold !== undefined ? badThreshold : 90;
    if (percent <= warn) return baseColor;
    if (percent <= bad) return lerpColor(baseColor, COLOR_WARN, (percent - warn) / Math.max(bad - warn, 1));
    return lerpColor(COLOR_WARN, COLOR_BAD, Math.min(1, (percent - bad) / 10));
}

// ---- сглаживание значений между тиками, для плавной анимации (аналог ui/widget/animation.py) ----

function Smoother(initial) {
    this.value = initial || 0;
    this.target = this.value;
}
Smoother.prototype.setTarget = function (target) {
    this.target = target;
};
Smoother.prototype.step = function () {
    let delta = this.target - this.value;
    if (Math.abs(delta) < 0.05) {
        if (this.value !== this.target) {
            this.value = this.target;
            return true;
        }
        return false;
    }
    this.value += delta * SMOOTHING_FACTOR;
    return true;
};

function SmootherMap() {
    this._items = new Map();
}
SmootherMap.prototype.setTarget = function (key, target) {
    if (!this._items.has(key)) this._items.set(key, new Smoother(target));
    else this._items.get(key).setTarget(target);
};
SmootherMap.prototype.pruneExcept = function (keys) {
    let keep = new Set(keys);
    for (let key of Array.from(this._items.keys())) {
        if (!keep.has(key)) this._items.delete(key);
    }
};
SmootherMap.prototype.value = function (key) {
    let item = this._items.get(key);
    return item ? item.value : 0;
};
SmootherMap.prototype.step = function () {
    let changed = false;
    for (let item of this._items.values()) {
        if (item.step()) changed = true;
    }
    return changed;
};

// ---- сборщики метрик (аналог core/collectors/*.py, но через /proc напрямую) ----

async function collectCpu(prevState) {
    let text = await readFileAsync('/proc/stat');
    if (!text) return { perCore: [], state: prevState };

    let newState = {};
    let perCore = [];
    for (let line of text.split('\n')) {
        if (!/^cpu\d/.test(line)) continue;
        let parts = line.trim().split(/\s+/);
        let name = parts[0];
        let fields = parts.slice(1, 8).map(Number);
        let idle = fields[3] + fields[4];
        let total = fields.reduce((a, b) => a + b, 0);
        newState[name] = { idle, total };

        let prev = prevState[name];
        let percent = 0;
        if (prev) {
            let deltaIdle = idle - prev.idle;
            let deltaTotal = total - prev.total;
            percent = deltaTotal > 0 ? 100 * (1 - deltaIdle / deltaTotal) : 0;
        }
        perCore.push(Math.max(0, Math.min(100, percent)));
    }
    return { perCore, state: newState };
}

// Средняя частота ядер в МГц из /proc/cpuinfo (Linux ядро публикует её без доп. привилегий,
// в отличие от cpufreq sysfs-файлов, которые не везде читаемы без root).
async function collectCpuFrequencyMHz() {
    let text = await readFileAsync('/proc/cpuinfo');
    if (!text) return null;
    let matches = [...text.matchAll(/cpu MHz\s*:\s*([\d.]+)/g)];
    if (!matches.length) return null;
    let sum = matches.reduce((acc, m) => acc + parseFloat(m[1]), 0);
    return sum / matches.length;
}

// Ищет файл hwmon с температурой пакета CPU (Intel: "Package id 0", AMD: "Tctl"/"Tdie").
// Делается один раз при старте десклета и кэшируется — сам путь не меняется на лету.
async function findCpuTempFile() {
    let labels = ['Package id 0', 'Tctl', 'Tdie'];
    for (let label of labels) {
        let argv = ['/bin/sh', '-c',
            "grep -s -l -d skip '" + label + "' /sys/class/hwmon/*/temp*_label 2>/dev/null | sed 's/_label/_input/' | head -n 1"];
        let stdout = await runProcessAsync(argv);
        let path = (stdout || '').trim();
        if (path) return path;
    }
    return null;
}

async function collectCpuTemperatureC(tempFilePath) {
    if (!tempFilePath) return null;
    let text = await readFileAsync(tempFilePath);
    if (!text) return null;
    let millidegrees = parseInt(text.trim());
    return isNaN(millidegrees) ? null : millidegrees / 1000;
}

async function collectMemory() {
    let text = await readFileAsync('/proc/meminfo');
    if (!text) return { percent: 0, swapPercent: 0, totalBytes: 0, usedBytes: 0, swapTotalBytes: 0 };

    let readField = (name) => {
        let m = text.match(new RegExp(name + ':\\s+(\\d+)'));
        return m ? parseInt(m[1]) * 1024 : 0;
    };
    let total = readField('MemTotal');
    let available = readField('MemAvailable');
    let swapTotal = readField('SwapTotal');
    let swapFree = readField('SwapFree');

    return {
        percent: total > 0 ? (100 * (total - available)) / total : 0,
        swapPercent: swapTotal > 0 ? (100 * (swapTotal - swapFree)) / swapTotal : 0,
        totalBytes: total,
        usedBytes: total - available,
        swapTotalBytes: swapTotal,
    };
}

function bytesToGB(bytes) {
    return (bytes / (1024 * 1024 * 1024)).toFixed(1);
}

async function collectNetwork(prevState, elapsedSec, interfaceFilter) {
    let text = await readFileAsync('/proc/net/dev');
    if (!text) return { recvRate: 0, sentRate: 0, state: prevState };

    let filterList = (interfaceFilter || '').split(',').map((s) => s.trim()).filter((s) => s);
    let totalRx = 0;
    let totalTx = 0;
    for (let line of text.split('\n').slice(2)) {
        line = line.trim();
        if (!line) continue;
        let parts = line.split(/[:\s]+/);
        if (parts.length < 10) continue;
        if (parts[0] === 'lo') continue;
        if (filterList.length && filterList.indexOf(parts[0]) === -1) continue;
        totalRx += parseInt(parts[1]) || 0;
        totalTx += parseInt(parts[9]) || 0;
    }

    let recvRate = 0;
    let sentRate = 0;
    if (prevState && elapsedSec > 0) {
        recvRate = Math.max(0, (totalRx - prevState.rx) / elapsedSec);
        sentRate = Math.max(0, (totalTx - prevState.tx) / elapsedSec);
    }
    return { recvRate, sentRate, state: { rx: totalRx, tx: totalTx } };
}

async function collectDiskUsage(diskFilter) {
    let filterList = (diskFilter || '').split(',').map((s) => s.trim()).filter((s) => s);
    let argv = [
        '/bin/df', '-B1', '--output=target,size,pcent',
        '-x', 'tmpfs', '-x', 'devtmpfs', '-x', 'squashfs', '-x', 'overlay',
        '-x', 'proc', '-x', 'sysfs', '-x', 'cgroup', '-x', 'cgroup2',
        '-x', 'tracefs', '-x', 'debugfs', '-x', 'configfs', '-x', 'securityfs',
        '-x', 'pstore', '-x', 'mqueue', '-x', 'hugetlbfs', '-x', 'rpc_pipefs',
        '-x', 'fusectl', '-x', 'binfmt_misc',
    ];
    let stdout = await runProcessAsync(argv);
    if (!stdout) return [];

    let partitions = [];
    for (let line of stdout.split('\n').slice(1)) {
        let parts = line.trim().split(/\s+/);
        if (parts.length < 3) continue;
        let size = parseInt(parts[1]);
        let percent = parseFloat(parts[2].replace('%', ''));
        if (isNaN(size) || size < MIN_PARTITION_BYTES || isNaN(percent)) continue;
        if (filterList.length && !filterList.some((f) => parts[0].indexOf(f) !== -1)) continue;
        partitions.push({ mountpoint: parts[0], percent });
    }
    return partitions;
}

async function collectDiskIo(prevState, elapsedSec) {
    let text = await readFileAsync('/proc/diskstats');
    if (!text) return { readRate: 0, writeRate: 0, state: prevState };

    let totalReadSectors = 0;
    let totalWriteSectors = 0;
    for (let line of text.split('\n')) {
        let parts = line.trim().split(/\s+/);
        if (parts.length < 10) continue;
        if (!DISK_DEVICE_RE.test(parts[2])) continue;
        totalReadSectors += parseInt(parts[5]) || 0;
        totalWriteSectors += parseInt(parts[9]) || 0;
    }

    let readRate = 0;
    let writeRate = 0;
    if (prevState && elapsedSec > 0) {
        readRate = Math.max(0, ((totalReadSectors - prevState.read) * 512) / elapsedSec);
        writeRate = Math.max(0, ((totalWriteSectors - prevState.write) * 512) / elapsedSec);
    }
    return { readRate, writeRate, state: { read: totalReadSectors, write: totalWriteSectors } };
}

// Поддерживает NVIDIA (nvidia-smi) и AMD (amdgpu sysfs). Если ни один распознанный GPU не
// найден (например, чистый Intel iGPU без единого стандартного интерфейса загрузки),
// возвращает null — секция GPU скрывается вместо показа нулей (аналог core/collectors/gpu.py).
async function collectGpuNvidia() {
    let stdout = await runProcessAsync([
        'nvidia-smi', '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
        '--format=csv,noheader,nounits',
    ]);
    if (!stdout) return null;
    let line = stdout.trim().split('\n')[0];
    if (!line) return null;
    let parts = line.split(',').map((p) => p.trim());
    if (parts.length < 5) return null;
    let percent = parseFloat(parts[1]);
    if (isNaN(percent)) return null;
    let memUsedBytes = parseFloat(parts[2]) * 1024 * 1024;
    let memTotalBytes = parseFloat(parts[3]) * 1024 * 1024;
    let temp = parseFloat(parts[4]);
    return { name: parts[0], percent, memUsedBytes, memTotalBytes, temperatureC: isNaN(temp) ? null : temp };
}

async function collectGpuAmd() {
    let cardNames = await listDirAsync('/sys/class/drm');
    for (let name of cardNames) {
        if (!/^card\d+$/.test(name)) continue;
        let devicePath = '/sys/class/drm/' + name + '/device';
        let busyText = await readFileAsync(devicePath + '/gpu_busy_percent');
        if (busyText === null) continue;
        let percent = parseInt(busyText.trim());
        if (isNaN(percent)) continue;

        let [memUsedText, memTotalText] = await Promise.all([
            readFileAsync(devicePath + '/mem_info_vram_used'),
            readFileAsync(devicePath + '/mem_info_vram_total'),
        ]);
        let memUsedBytes = parseInt(memUsedText || '') || 0;
        let memTotalBytes = parseInt(memTotalText || '') || 0;

        let temperatureC = null;
        let hwmonNames = await listDirAsync(devicePath + '/hwmon');
        if (hwmonNames.length) {
            let tempText = await readFileAsync(devicePath + '/hwmon/' + hwmonNames[0] + '/temp1_input');
            if (tempText) temperatureC = parseInt(tempText.trim()) / 1000;
        }
        return { name: 'AMD GPU', percent, memUsedBytes, memTotalBytes, temperatureC };
    }
    return null;
}

async function collectGpu() {
    let nvidia = await collectGpuNvidia();
    if (nvidia) return nvidia;
    return await collectGpuAmd();
}

// ---- десклет ----

function LinuxVisualizatorDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

LinuxVisualizatorDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.settings = new Settings.DeskletSettings(this, metadata.uuid, deskletId);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'refresh-interval', 'refreshInterval', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'background-opacity', 'backgroundOpacity', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'click-command', 'clickCommand', null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'ui-scale', 'uiScalePercent', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'panel-order', 'panelOrder', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'warn-threshold', 'warnThreshold', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'bad-threshold', 'badThreshold', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'accent-cpu', 'accentCpu', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'accent-mem', 'accentMem', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'accent-net', 'accentNet', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'accent-disk', 'accentDisk', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-cpu', 'showCpu', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'cpu-view', 'cpuView', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-cpu-freq', 'showCpuFreq', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-cpu-temp', 'showCpuTemp', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-mem', 'showMem', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-net', 'showNet', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'network-interface', 'networkInterface', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'net-unit', 'netUnit', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-disk', 'showDisk', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'disk-filter', 'diskFilter', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-gpu', 'showGpu', this._onSettingsChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'accent-gpu', 'accentGpu', this._onSettingsChanged);

        this._cpuState = {};
        this._netState = null;
        this._diskIoState = null;
        this._lastTickTime = null;
        // Определение файла температуры требует запуска grep — делается асинхронно и не
        // блокирует инициализацию десклета; до первого разрешения промиса температура не
        // показывается (первые один-два тика), что не критично для UX.
        this._cpuTempFile = null;
        findCpuTempFile().then((path) => { this._cpuTempFile = path; });

        this._cpuPercents = [];
        this._cpuAverage = 0;
        this._cpuFreqMHz = null;
        this._cpuTempC = null;
        this._cpuHistory = [];
        this._memPercent = 0;
        this._swapPercent = 0;
        this._diskPartitions = [];
        this._netHistory = { recv: [], sent: [] };
        this._diskIoHistory = { read: [], write: [] };
        this._gpu = null;

        this._cpuSmoother = new SmootherMap();
        this._memSmoother = new Smoother();
        this._swapSmoother = new Smoother();
        this._diskSmoother = new SmootherMap();
        this._gpuSmoother = new Smoother();
        this._animationTimeoutId = null;

        this.window = new Clutter.Actor();
        this.setContent(this.window);

        this._tick();
    },

    on_desklet_removed: function () {
        if (this._timeoutId) Mainloop.source_remove(this._timeoutId);
        if (this._animationTimeoutId) Mainloop.source_remove(this._animationTimeoutId);
    },

    // Левый клик (без перетаскивания) открывает системный монитор — быстрый доступ
    // к детальной информации, не перегружая сам десклет процессами/деталями.
    on_desklet_clicked: function (event) {
        let command = (this.clickCommand || '').trim();
        if (!command) return;
        try {
            GLib.spawn_command_line_async(command);
        } catch (e) {
            global.logError('linux-visualizator: failed to launch "' + command + '": ' + e);
        }
    },

    _onSettingsChanged: function () {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
        }
        this._tick();
    },

    // Тонкая синхронная обёртка вокруг _tickAsync: используется как callback Mainloop.timeout_add
    // и как обработчик кликов/событий настроек. Если бы _tickAsync (async function, возвращающая
    // Promise) была передана в timeout_add напрямую, GJS marshalling воспринял бы truthy-Promise
    // как GLib.SOURCE_CONTINUE, и GLib продолжал бы вызывать её сам — вдобавок к ручному
    // перепланированию в конце _tickAsync, что привело бы к дублирующимся/накапливающимся таймерам.
    _tick: function () {
        this._tickAsync();
    },

    _tickAsync: async function () {
        let now = GLib.get_monotonic_time() / 1e6;
        let elapsed = this._lastTickTime ? now - this._lastTickTime : 0;

        if (this.showCpu) {
            let cpu = await collectCpu(this._cpuState);
            this._cpuPercents = cpu.perCore;
            this._cpuState = cpu.state;
            this._cpuPercents.forEach((percent, idx) => this._cpuSmoother.setTarget(idx, percent));
            this._cpuSmoother.pruneExcept(this._cpuPercents.map((_, idx) => idx));

            this._cpuAverage = this._cpuPercents.length
                ? this._cpuPercents.reduce((a, b) => a + b, 0) / this._cpuPercents.length
                : 0;
            this._pushHistory(this._cpuHistory, this._cpuAverage);

            this._cpuFreqMHz = this.showCpuFreq ? await collectCpuFrequencyMHz() : null;
            this._cpuTempC = this.showCpuTemp ? await collectCpuTemperatureC(this._cpuTempFile) : null;
        }
        if (this.showMem) {
            let mem = await collectMemory();
            this._memPercent = mem.percent;
            this._swapPercent = mem.swapPercent;
            this._memTotalBytes = mem.totalBytes;
            this._memUsedBytes = mem.usedBytes;
            this._hasSwap = mem.swapTotalBytes > 0;
            this._memSmoother.setTarget(mem.percent);
            this._swapSmoother.setTarget(mem.swapPercent);
        }
        if (this.showNet) {
            let net = await collectNetwork(this._netState, elapsed, this.networkInterface);
            this._netState = net.state;
            this._pushHistory(this._netHistory.recv, net.recvRate);
            this._pushHistory(this._netHistory.sent, net.sentRate);
        }
        if (this.showDisk) {
            this._diskPartitions = await collectDiskUsage(this.diskFilter);
            this._diskPartitions.forEach((p) => this._diskSmoother.setTarget(p.mountpoint, p.percent));
            this._diskSmoother.pruneExcept(this._diskPartitions.map((p) => p.mountpoint));
            let io = await collectDiskIo(this._diskIoState, elapsed);
            this._diskIoState = io.state;
            this._pushHistory(this._diskIoHistory.read, io.readRate);
            this._pushHistory(this._diskIoHistory.write, io.writeRate);
        }
        if (this.showGpu) {
            this._gpu = await collectGpu();
            if (this._gpu) this._gpuSmoother.setTarget(this._gpu.percent);
        } else {
            this._gpu = null;
        }

        this._lastTickTime = now;
        this._scale = (this.uiScalePercent || 100) / 100;
        this._colorCpu = parseColor(this.accentCpu, COLOR_CPU);
        this._colorMem = parseColor(this.accentMem, COLOR_MEM);
        this._colorNetDown = parseColor(this.accentNet, COLOR_NET_DOWN);
        this._colorNetUp = lightenColor(this._colorNetDown, 0.35);
        this._colorDisk = parseColor(this.accentDisk, COLOR_DISK);
        this._colorDiskWrite = lightenColor(this._colorDisk, 0.35);
        this._colorGpu = parseColor(this.accentGpu, COLOR_GPU);
        this._render();
        this._startAnimation();

        let intervalMs = Math.max(200, this.refreshInterval || 1000);
        this._timeoutId = Mainloop.timeout_add(intervalMs, Lang.bind(this, this._tick));
    },

    // Плавно подкручивает кольца/полосы к новым значениям несколько кадров после каждого тика,
    // а не дёргает их скачком — так десклет выглядит живее без постоянной перерисовки.
    _startAnimation: function () {
        if (this._animationTimeoutId) return;
        this._animationTimeoutId = Mainloop.timeout_add(ANIMATION_INTERVAL_MS, Lang.bind(this, this._animateStep));
    },

    _animateStep: function () {
        let changed = false;
        if (this._cpuSmoother.step()) changed = true;
        if (this._memSmoother.step()) changed = true;
        if (this._swapSmoother.step()) changed = true;
        if (this._diskSmoother.step()) changed = true;
        if (this._gpuSmoother.step()) changed = true;

        if (changed) {
            this._render();
            return true;
        }
        this._animationTimeoutId = null;
        return false;
    },

    _pushHistory: function (array, value) {
        array.push(value);
        while (array.length > HISTORY_LEN) array.shift();
    },

    _render: function () {
        let s = this._scale || 1;
        let width = 220;
        let unordered = {};

        if (this.showCpu && this._cpuPercents.length) {
            let view = this.cpuView || 'rings';
            let h;
            if (view === 'bars') {
                let count = this._cpuPercents.length;
                h = HEADER_HEIGHT * s + count * BAR_HEIGHT * s + (count - 1) * BAR_SPACING * s;
            } else if (view === 'graph') {
                h = HEADER_HEIGHT * s + SPARK_HEIGHT * s;
            } else {
                let ringsWidth = this._cpuPercents.length * (RING_SIZE * s + RING_SPACING * s) + RING_SPACING * s;
                width = Math.max(width, ringsWidth);
                h = HEADER_HEIGHT * s + RING_SIZE * s + 6;
            }

            let statParts = [Math.round(this._cpuAverage) + '%'];
            if (this.showCpuFreq && this._cpuFreqMHz) statParts.push((this._cpuFreqMHz / 1000).toFixed(1) + ' GHz');
            if (this.showCpuTemp && this._cpuTempC !== null) statParts.push(Math.round(this._cpuTempC) + '°C');

            unordered.cpu = {
                type: 'cpu', height: h, label: _('CPU'), color: this._colorCpu,
                view, statText: statParts.join('  '),
            };
        }
        if (this.showMem) {
            let h = HEADER_HEIGHT * s + BAR_HEIGHT * s + (this._hasSwap ? (BAR_HEIGHT + BAR_SPACING) * s : 0);
            unordered.mem = { type: 'mem', height: h, label: _('MEMORY'), color: this._colorMem };
        }
        if (this.showNet) {
            let h = HEADER_HEIGHT * s + SPARK_HEIGHT * s;
            unordered.net = { type: 'net', height: h, label: _('NETWORK'), color: this._colorNetDown };
        }
        if (this.showDisk) {
            let count = Math.max(this._diskPartitions.length, 1);
            let usageHeight = count * BAR_HEIGHT * s + (count - 1) * BAR_SPACING * s;
            let h = HEADER_HEIGHT * s + usageHeight + BAR_SPACING * s + SPARK_HEIGHT * s;
            unordered.disk = { type: 'disk', height: h, label: _('DISKS'), color: this._colorDisk, usageHeight };
        }
        if (this.showGpu && this._gpu) {
            let h = HEADER_HEIGHT * s + BAR_HEIGHT * s;
            unordered.gpu = { type: 'gpu', height: h, label: _('GPU'), color: this._colorGpu };
        }

        let order = (this.panelOrder || '').split(',').map((k) => k.trim()).filter((k) => k);
        let seen = new Set(order);
        for (let key of ['cpu', 'mem', 'net', 'disk', 'gpu']) {
            if (!seen.has(key)) order.push(key);
        }

        let y = MARGIN * s;
        let sections = [];
        for (let key of order) {
            let section = unordered[key];
            if (!section) continue;
            section.y = y;
            sections.push(section);
            y += section.height + SECTION_SPACING * s;
        }

        let totalWidth = width + MARGIN * s * 2;
        let totalHeight = sections.length ? y - SECTION_SPACING * s + MARGIN * s : MARGIN * s * 2;

        let canvas = new Clutter.Canvas();
        canvas.set_size(totalWidth, totalHeight);
        canvas.connect('draw', (canvasObj, ctx, w, h) => {
            this._draw(ctx, w, h, sections, width);
            return false;
        });
        this.window.set_content(canvas);
        canvas.invalidate();
        this.window.set_size(totalWidth, totalHeight);
    },

    _draw: function (ctx, w, h, sections, contentWidth) {
        ctx.save();
        ctx.setOperator(Cairo.Operator.CLEAR);
        ctx.paint();
        ctx.restore();
        ctx.setOperator(Cairo.Operator.OVER);

        // фон: мягкий вертикальный градиент + тонкая обводка для отделения от обоев
        let bgAlpha = (this.backgroundOpacity !== undefined ? this.backgroundOpacity : 205) / 255;
        this._roundedRect(ctx, 0, 0, w, h, CORNER_RADIUS);
        let bgGradient = new Cairo.LinearGradient(0, 0, 0, h);
        bgGradient.addColorStopRGBA(0, COLOR_BG_TOP[0], COLOR_BG_TOP[1], COLOR_BG_TOP[2], bgAlpha);
        bgGradient.addColorStopRGBA(1, COLOR_BG_BOTTOM[0], COLOR_BG_BOTTOM[1], COLOR_BG_BOTTOM[2], bgAlpha);
        ctx.setSource(bgGradient);
        ctx.fill();

        this._roundedRect(ctx, 0.5, 0.5, w - 1, h - 1, CORNER_RADIUS);
        ctx.setSourceRGBA(COLOR_BORDER[0], COLOR_BORDER[1], COLOR_BORDER[2], COLOR_BORDER[3]);
        ctx.setLineWidth(1);
        ctx.stroke();

        let s = this._scale || 1;

        sections.forEach((section, idx) => {
            ctx.save();
            ctx.translate(MARGIN * s, section.y);

            this._drawSectionHeader(ctx, section.label, section.color, section.statText, contentWidth);
            ctx.translate(0, HEADER_HEIGHT * s);

            if (section.type === 'cpu') {
                if (section.view === 'bars') this._drawCpuBars(ctx, contentWidth);
                else if (section.view === 'graph') this._drawCpuGraph(ctx, contentWidth);
                else this._drawCpuRings(ctx);
            } else if (section.type === 'mem') this._drawMemBars(ctx, contentWidth);
            else if (section.type === 'net') {
                this._drawSparkline(ctx, contentWidth, this._netHistory.recv, this._netHistory.sent, this._colorNetDown, this._colorNetUp, '↓', '↑', this.netUnit);
            } else if (section.type === 'disk') {
                this._drawDiskUsage(ctx, contentWidth);
                ctx.translate(0, section.usageHeight + BAR_SPACING * s);
                this._drawSparkline(ctx, contentWidth, this._diskIoHistory.read, this._diskIoHistory.write, this._colorDisk, this._colorDiskWrite, 'R', 'W', 'bytes');
            } else if (section.type === 'gpu') {
                this._drawGpuBar(ctx, contentWidth);
            }
            ctx.restore();

            let isLast = idx === sections.length - 1;
            if (!isLast) {
                let dividerY = section.y + section.height + (SECTION_SPACING * s) / 2;
                ctx.setSourceRGBA(1, 1, 1, 0.06);
                ctx.setLineWidth(1);
                ctx.moveTo(MARGIN * s, dividerY);
                ctx.lineTo(contentWidth + MARGIN * s, dividerY);
                ctx.stroke();
            }
        });
    },

    _drawSectionHeader: function (ctx, label, color, statText, contentWidth) {
        let s = this._scale || 1;
        ctx.newSubPath();
        ctx.setSourceRGBA(color[0], color[1], color[2], 0.9);
        ctx.arc(3 * s, 5 * s, 3 * s, 0, 2 * Math.PI);
        ctx.fill();

        ctx.setSourceRGBA(COLOR_LABEL[0], COLOR_LABEL[1], COLOR_LABEL[2], COLOR_LABEL[3]);
        ctx.selectFontFace(LABEL_FONT, Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        ctx.setFontSize(9 * s);
        ctx.moveTo(12 * s, 9 * s);
        ctx.showText(label);

        if (statText) {
            ctx.selectFontFace(NUMBER_FONT, Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
            ctx.setFontSize(8.5 * s);
            let extents = ctx.textExtents(statText);
            ctx.moveTo(contentWidth - extents.width - extents.xBearing, 9 * s);
            ctx.showText(statText);
        }
    },

    _roundedRect: function (ctx, x, y, w, h, r) {
        ctx.newSubPath();
        ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
        ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
        ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
        ctx.arc(x + r, y + r, r, Math.PI, (3 * Math.PI) / 2);
        ctx.closePath();
    },

    _drawCpuRings: function (ctx) {
        let s = this._scale || 1;
        let ringSize = RING_SIZE * s;
        let ringSpacing = RING_SPACING * s;
        let ringThickness = RING_THICKNESS * s;
        let x = ringSpacing / 2;
        let coreCount = this._cpuPercents.length;
        for (let idx = 0; idx < coreCount; idx++) {
            let percent = this._cpuSmoother.value(idx);
            let cx = x + ringSize / 2;
            let cy = ringSize / 2;
            let radius = ringSize / 2 - ringThickness / 2;

            ctx.setLineWidth(ringThickness);
            ctx.setLineCap(Cairo.LineCap.ROUND);

            // newSubPath обязателен: без него arc() продолжит путь от точки, оставленной
            // предыдущей операцией (например, showText предыдущего кольца), и получится
            // паразитная линия, соединяющая кольца между собой.
            ctx.newSubPath();
            ctx.setSourceRGBA(1, 1, 1, 0.12);
            ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
            ctx.stroke();

            let color = severityColor(this._colorCpu, percent, this.warnThreshold, this.badThreshold);
            ctx.setSourceRGBA(color[0], color[1], color[2], color[3]);
            let startAngle = -Math.PI / 2;
            let endAngle = startAngle + Math.max(percent, 0.6) / 100 * 2 * Math.PI;
            ctx.newSubPath();
            ctx.arc(cx, cy, radius, startAngle, endAngle);
            ctx.stroke();

            ctx.setSourceRGBA(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2], COLOR_TEXT[3]);
            ctx.selectFontFace(NUMBER_FONT, Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
            ctx.setFontSize(10 * s);
            let label = Math.round(percent).toString();
            let extents = ctx.textExtents(label);
            ctx.moveTo(cx - extents.width / 2 - extents.xBearing, cy - extents.height / 2 - extents.yBearing);
            ctx.showText(label);

            x += ringSize + ringSpacing;
        }
    },

    _drawCpuBars: function (ctx, width) {
        let s = this._scale || 1;
        let barHeight = BAR_HEIGHT * s;
        let barSpacing = BAR_SPACING * s;
        let coreCount = this._cpuPercents.length;
        for (let idx = 0; idx < coreCount; idx++) {
            let percent = this._cpuSmoother.value(idx);
            let y = idx * (barHeight + barSpacing);
            let label = _('Core %d  %d%%').format(idx, Math.round(percent));
            this._drawBar(ctx, y, width, percent, label, severityColor(this._colorCpu, percent, this.warnThreshold, this.badThreshold), 1.0);
        }
    },

    _drawCpuGraph: function (ctx, width) {
        let s = this._scale || 1;
        let plotTop = SPARK_LABEL_HEIGHT * s;
        let plotHeight = SPARK_HEIGHT * s - plotTop - 2;
        this._drawLine(ctx, this._cpuHistory, 100, width, plotTop, plotHeight, severityColor(this._colorCpu, this._cpuAverage, this.warnThreshold, this.badThreshold), true);

        ctx.setSourceRGBA(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2], COLOR_TEXT[3]);
        ctx.selectFontFace(NUMBER_FONT, Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
        ctx.setFontSize(9 * s);
        ctx.moveTo(0, plotTop - 4);
        ctx.showText(_('Average load: %d%%').format(Math.round(this._cpuAverage)));
    },

    _drawMemBars: function (ctx, width) {
        let s = this._scale || 1;
        let barHeight = BAR_HEIGHT * s;
        let barSpacing = BAR_SPACING * s;
        let ramLabel = _('RAM %d%%').format(Math.round(this._memSmoother.value));
        if (this._memTotalBytes) {
            ramLabel += '  (' + bytesToGB(this._memUsedBytes) + '/' + bytesToGB(this._memTotalBytes) + ' GB)';
        }
        this._drawBar(ctx, 0, width, this._memSmoother.value, ramLabel, severityColor(this._colorMem, this._memSmoother.value, this.warnThreshold, this.badThreshold), 1.0);

        if (this._hasSwap) {
            let swapLabel = _('SWAP %d%%').format(Math.round(this._swapSmoother.value));
            this._drawBar(ctx, barHeight + barSpacing, width, this._swapSmoother.value, swapLabel, this._colorMem, 0.5);
        }
    },

    _drawGpuBar: function (ctx, width) {
        if (!this._gpu) return;
        let percent = this._gpuSmoother.value;
        let label = _('GPU %d%%').format(Math.round(percent));
        if (this._gpu.memTotalBytes) {
            label += '  (' + bytesToGB(this._gpu.memUsedBytes) + '/' + bytesToGB(this._gpu.memTotalBytes) + ' GB)';
        }
        if (this._gpu.temperatureC !== null) {
            label += '  ' + Math.round(this._gpu.temperatureC) + '°C';
        }
        this._drawBar(ctx, 0, width, percent, label, severityColor(this._colorGpu, percent, this.warnThreshold, this.badThreshold), 1.0);
    },

    _drawDiskUsage: function (ctx, width) {
        let s = this._scale || 1;
        let barHeight = BAR_HEIGHT * s;
        let barSpacing = BAR_SPACING * s;
        this._diskPartitions.forEach((partition, idx) => {
            let y = idx * (barHeight + barSpacing);
            let percent = this._diskSmoother.value(partition.mountpoint);
            let label = this._shortMountpoint(partition.mountpoint) + ' ' + Math.round(percent) + '%';
            this._drawBar(ctx, y, width, percent, label, severityColor(this._colorDisk, percent, this.warnThreshold, this.badThreshold), 1.0);
        });
    },

    _shortMountpoint: function (mountpoint) {
        if (mountpoint === '/') return '/';
        let parts = mountpoint.replace(/\/+$/, '').split('/');
        return parts[parts.length - 1];
    },

    _drawBar: function (ctx, y, width, percent, label, color, alpha) {
        let s = this._scale || 1;
        let barHeight = BAR_HEIGHT * s;
        ctx.setSourceRGBA(1, 1, 1, 0.1);
        this._roundedRect(ctx, 0, y, width, barHeight, barHeight / 2);
        ctx.fill();

        let fillWidth = Math.max((width * Math.min(Math.max(percent, 0), 100)) / 100, barHeight);
        let gradient = new Cairo.LinearGradient(0, y, fillWidth, y);
        gradient.addColorStopRGBA(0, color[0] * 0.65, color[1] * 0.65, color[2] * 0.65, color[3] * alpha);
        gradient.addColorStopRGBA(1, color[0], color[1], color[2], color[3] * alpha);
        this._roundedRect(ctx, 0, y, fillWidth, barHeight, barHeight / 2);
        ctx.setSource(gradient);
        ctx.fill();

        ctx.setSourceRGBA(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2], COLOR_TEXT[3]);
        ctx.selectFontFace(NUMBER_FONT, Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
        ctx.setFontSize(8.5 * s);
        let extents = ctx.textExtents(label);
        ctx.moveTo(width / 2 - extents.width / 2 - extents.xBearing, y + barHeight / 2 - extents.height / 2 - extents.yBearing);
        ctx.showText(label);
    },

    _drawSparkline: function (ctx, width, historyA, historyB, colorA, colorB, symbolA, symbolB, unitMode) {
        let s = this._scale || 1;
        let maxValue = Math.max(1, ...historyA, ...historyB);
        let plotTop = SPARK_LABEL_HEIGHT * s;
        let plotHeight = SPARK_HEIGHT * s - plotTop - 2;

        this._drawLine(ctx, historyA, maxValue, width, plotTop, plotHeight, colorA, true);
        this._drawLine(ctx, historyB, maxValue, width, plotTop, plotHeight, colorB, false);

        let currentA = historyA.length ? historyA[historyA.length - 1] : 0;
        let currentB = historyB.length ? historyB[historyB.length - 1] : 0;
        ctx.setSourceRGBA(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2], COLOR_TEXT[3]);
        ctx.selectFontFace(SYMBOL_FONT, Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
        ctx.setFontSize(9 * s);
        let label = symbolA + this._formatRate(currentA, unitMode) + '  ' + symbolB + this._formatRate(currentB, unitMode);
        ctx.moveTo(0, plotTop - 4);
        ctx.showText(label);
    },

    _formatRate: function (bytesPerSec, unitMode) {
        if (unitMode === 'bits') return ((bytesPerSec * 8) / 1024).toFixed(1) + ' Kb/s';
        return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
    },

    _drawLine: function (ctx, history, maxValue, width, plotTop, plotHeight, color, withFill) {
        if (history.length < 2) return;
        let step = width / (HISTORY_LEN - 1);
        let offset = HISTORY_LEN - history.length;

        let points = history.map((value, idx) => [
            (offset + idx) * step,
            plotTop + plotHeight - (value / maxValue) * plotHeight,
        ]);

        if (withFill) {
            let fillGradient = new Cairo.LinearGradient(0, plotTop, 0, plotTop + plotHeight);
            fillGradient.addColorStopRGBA(0, color[0], color[1], color[2], 0.28);
            fillGradient.addColorStopRGBA(1, color[0], color[1], color[2], 0.02);
            ctx.moveTo(points[0][0], plotTop + plotHeight);
            points.forEach((p) => ctx.lineTo(p[0], p[1]));
            ctx.lineTo(points[points.length - 1][0], plotTop + plotHeight);
            ctx.closePath();
            ctx.setSource(fillGradient);
            ctx.fill();
        }

        ctx.setSourceRGBA(color[0], color[1], color[2], color[3]);
        ctx.setLineWidth(1.6);
        ctx.setLineJoin(Cairo.LineJoin.ROUND);
        points.forEach((p, idx) => {
            if (idx === 0) ctx.moveTo(p[0], p[1]);
            else ctx.lineTo(p[0], p[1]);
        });
        ctx.stroke();
    },
};

function main(metadata, deskletId) {
    return new LinuxVisualizatorDesklet(metadata, deskletId);
}
