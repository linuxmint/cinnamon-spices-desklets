/**
 * UPower provider (D-Bus). Extends BaseProvider for registry integration.
 */

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const { BaseProvider } = require("./providers/baseProvider");
const {
    createDevice,
    mapUpowerState,
    resolveUpowerType,
    iconForType,
    guessTransport,
    extractMac,
    shouldIncludeUpowerDevice,
    DeviceType,
    DeviceState,
    Transport
} = require("./models/device");

const UPOWER_NAME = "org.freedesktop.UPower";
const UPOWER_PATH = "/org/freedesktop/UPower";

const UPowerIface = `
<node>
  <interface name="org.freedesktop.UPower">
    <method name="EnumerateDevices">
      <arg type="ao" name="devices" direction="out"/>
    </method>
    <property name="Devices" type="ao" access="read"/>
    <signal name="DeviceAdded">
      <arg type="o" name="device"/>
    </signal>
    <signal name="DeviceRemoved">
      <arg type="o" name="device"/>
    </signal>
  </interface>
</node>`;

const UPowerDeviceIface = `
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="NativePath" type="s" access="read"/>
    <property name="Vendor" type="s" access="read"/>
    <property name="Model" type="s" access="read"/>
    <property name="Serial" type="s" access="read"/>
    <property name="UpdateTime" type="t" access="read"/>
    <property name="Type" type="u" access="read"/>
    <property name="PowerSupply" type="b" access="read"/>
    <property name="Online" type="b" access="read"/>
    <property name="Energy" type="d" access="read"/>
    <property name="EnergyFull" type="d" access="read"/>
    <property name="EnergyFullDesign" type="d" access="read"/>
    <property name="EnergyRate" type="d" access="read"/>
    <property name="Voltage" type="d" access="read"/>
    <property name="TimeToEmpty" type="x" access="read"/>
    <property name="TimeToFull" type="x" access="read"/>
    <property name="Percentage" type="d" access="read"/>
    <property name="IsPresent" type="b" access="read"/>
    <property name="State" type="u" access="read"/>
    <property name="IsRechargeable" type="b" access="read"/>
    <property name="Capacity" type="d" access="read"/>
    <property name="ChargeCycles" type="x" access="read"/>
    <property name="WarningLevel" type="u" access="read"/>
    <property name="BatteryLevel" type="u" access="read"/>
    <property name="IconName" type="s" access="read"/>
    <method name="Refresh"/>
  </interface>
</node>`;

const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(UPowerIface);
const UPowerDeviceProxy = Gio.DBusProxy.makeProxyWrapper(UPowerDeviceIface);

class UpowerProvider extends BaseProvider {
    constructor(options) {
        super(options);
        this._proxy = null;
        this._deviceProxies = {};
        this._dbusSignalIds = [];
        this._propSignalIds = [];
        this._deviceSignalIds = {};
        this._changePending = false;
    }

    get id() {
        return "upower";
    }

    get label() {
        return "UPower";
    }

    start() {
        if (this._destroyed) {
            return;
        }
        try {
            this._proxy = new UPowerProxy(
                Gio.DBus.system,
                UPOWER_NAME,
                UPOWER_PATH,
                (proxy, error) => {
                    if (this._destroyed) {
                        return;
                    }
                    if (error) {
                        this._error("failed to connect", error);
                        this._proxy = null;
                        return;
                    }
                    this._proxy = proxy;
                    this._connectBusSignals();
                    this._queueEmit();
                }
            );
        } catch (e) {
            this._error("constructor failed", e);
            this._proxy = null;
        }
    }

    _connectBusSignals() {
        if (!this._proxy) {
            return;
        }
        try {
            this._dbusSignalIds.push(this._proxy.connectSignal("DeviceAdded", () => this._queueEmit()));
            this._dbusSignalIds.push(this._proxy.connectSignal("DeviceRemoved", (_p, _s, params) => {
                try {
                    const path = params && params[0] ? params[0] : null;
                    if (path) {
                        this._dropDeviceProxy(path);
                    }
                } catch (e) {}
                this._queueEmit();
            }));
            this._propSignalIds.push(this._proxy.connect("g-properties-changed", () => this._queueEmit()));
        } catch (e) {
            this._error("signal connect failed", e);
        }
    }

    _queueEmit() {
        if (this._destroyed || this._changePending) {
            return;
        }
        this._changePending = true;
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._changePending = false;
            this._emitChange();
            return GLib.SOURCE_REMOVE;
        });
    }

    _getOrCreateDeviceProxy(path) {
        if (this._deviceProxies[path]) {
            return this._deviceProxies[path];
        }
        try {
            const proxy = new UPowerDeviceProxy(Gio.DBus.system, UPOWER_NAME, path);
            this._deviceProxies[path] = proxy;
            try {
                this._deviceSignalIds[path] = proxy.connect("g-properties-changed", () => this._queueEmit());
            } catch (e) {}
            return proxy;
        } catch (e) {
            this._error("device proxy failed for " + path, e);
            return null;
        }
    }

    _dropDeviceProxy(path) {
        const proxy = this._deviceProxies[path];
        if (!proxy) {
            return;
        }
        try {
            if (this._deviceSignalIds[path]) {
                proxy.disconnect(this._deviceSignalIds[path]);
            }
        } catch (e) {}
        delete this._deviceSignalIds[path];
        delete this._deviceProxies[path];
    }

    _readProp(proxy, name, fallback) {
        try {
            const value = proxy[name];
            return value === undefined || value === null ? fallback : value;
        } catch (e) {
            return fallback;
        }
    }

    _readDevice(path) {
        const proxy = this._getOrCreateDeviceProxy(path);
        if (!proxy) {
            return null;
        }

        const typeCode = this._readProp(proxy, "Type", null);
        if (typeCode === null) {
            return null;
        }
        // Prefer path prefix (speakers_/mouse_/keyboard_/…) for kind + icons.
        const type = resolveUpowerType(typeCode, path);

        const model = this._readProp(proxy, "Model", "") || "";
        const vendor = this._readProp(proxy, "Vendor", "") || "";
        const serial = this._readProp(proxy, "Serial", "") || "";
        const nativePath = this._readProp(proxy, "NativePath", "") || "";
        const percentage = this._readProp(proxy, "Percentage", null);
        const stateCode = this._readProp(proxy, "State", 0);
        const present = !!this._readProp(proxy, "IsPresent", false);
        const rechargeable = !!this._readProp(proxy, "IsRechargeable", false);
        const updateTime = Number(this._readProp(proxy, "UpdateTime", 0)) || 0;
        const warningLevel = this._readProp(proxy, "WarningLevel", 0) || 0;
        const voltage = this._readProp(proxy, "Voltage", null);
        const powerSupply = !!this._readProp(proxy, "PowerSupply", false);
        const capacity = this._readProp(proxy, "Capacity", null);
        const energyFull = this._readProp(proxy, "EnergyFull", null);
        const energyFullDesign = this._readProp(proxy, "EnergyFullDesign", null);
        let cycleCount = this._readProp(proxy, "ChargeCycles", null);
        if (cycleCount !== null && Number(cycleCount) < 0) {
            cycleCount = null;
        }

        let timeToEmpty = null;
        let timeToFull = null;
        const tte = Number(this._readProp(proxy, "TimeToEmpty", 0));
        const ttf = Number(this._readProp(proxy, "TimeToFull", 0));
        if (tte > 0) timeToEmpty = tte;
        if (ttf > 0) timeToFull = ttf;

        const hasPercentage = percentage !== null && percentage !== undefined && !isNaN(Number(percentage));

        // Skip AC adapters and nodes without battery data. Any other UPower device
        // that reports a percentage is shown — even unknown future kinds.
        if (!shouldIncludeUpowerDevice(typeCode, type, hasPercentage, present, path)) {
            return null;
        }

        const state = mapUpowerState(stateCode);
        // Bluetooth peripherals often omit IsPresent while still publishing %.
        const connected = hasPercentage && (present || type !== DeviceType.BATTERY);
        const nameParts = [vendor, model].filter(Boolean);
        let name = nameParts.join(" ").trim();
        if (!name) {
            name = (type === DeviceType.BATTERY || powerSupply) ? "Laptop" : (path.split("/").pop() || "Device");
        }

        const transport = type === DeviceType.BATTERY
            ? Transport.BATTERY
            : guessTransport(nativePath, path, serial);

        return createDevice({
            id: "upower:" + path,
            source: this.id,
            providerLabel: this.label,
            type: type,
            name: name,
            model: model,
            vendor: vendor,
            serial: serial,
            percentage: percentage !== null && percentage !== undefined ? Number(percentage) : null,
            state: connected ? state : DeviceState.DISCONNECTED,
            present: present,
            rechargeable: rechargeable,
            connected: connected,
            voltage: voltage !== null && voltage !== undefined ? Number(voltage) : null,
            timeToEmpty: timeToEmpty,
            timeToFull: timeToFull,
            warningLevel: warningLevel,
            updated: updateTime || (Date.now() / 1000),
            path: path,
            iconName: iconForType(type),
            transport: transport,
            capacity: capacity !== null && capacity !== undefined ? Number(capacity) : null,
            energyFull: energyFull !== null && energyFull !== undefined ? Number(energyFull) : null,
            energyFullDesign: energyFullDesign !== null && energyFullDesign !== undefined ? Number(energyFullDesign) : null,
            cycleCount: cycleCount !== null && cycleCount !== undefined ? Number(cycleCount) : null,
            mac: extractMac(path, serial),
            raw: { typeCode: typeCode, stateCode: stateCode, powerSupply: powerSupply, nativePath: nativePath }
        });
    }

    getDevices() {
        if (this._destroyed || !this._proxy) {
            return [];
        }

        let paths = [];
        try {
            if (this._proxy.Devices) {
                paths = this._proxy.Devices;
            } else {
                const cached = this._proxy.get_cached_property("Devices");
                if (cached) {
                    paths = cached.deep_unpack();
                }
            }
            if (!paths || !paths.length) {
                if (typeof this._proxy.EnumerateDevicesSync === "function") {
                    const result = this._proxy.EnumerateDevicesSync();
                    paths = result && result[0] ? result[0] : [];
                }
            }
        } catch (e) {
            this._error("EnumerateDevices failed", e);
            return [];
        }
        if (!paths) {
            paths = [];
        }

        const devices = [];
        const seen = {};
        for (let i = 0; i < paths.length; i++) {
            const path = paths[i];
            if (!path || seen[path]) {
                continue;
            }
            seen[path] = true;
            try {
                const device = this._readDevice(path);
                if (device) {
                    devices.push(device);
                }
            } catch (e) {}
        }

        Object.keys(this._deviceProxies).forEach((path) => {
            if (!seen[path]) {
                this._dropDeviceProxy(path);
            }
        });

        return devices;
    }

    fetch(callback) {
        const devices = this.getDevices();
        if (callback) {
            callback(devices);
        }
    }

    refresh() {
        this.refreshAll();
    }

    refreshDevice(path) {
        const proxy = this._deviceProxies[path] || this._getOrCreateDeviceProxy(path);
        if (!proxy) {
            return;
        }
        try {
            if (typeof proxy.RefreshRemote === "function") {
                proxy.RefreshRemote(() => {});
            }
        } catch (e) {}
    }

    refreshAll() {
        this.getDevices().forEach((d) => {
            if (d.path) {
                this.refreshDevice(d.path);
            }
        });
    }

    destroy() {
        this._destroyed = true;
        this._onChange = null;
        Object.keys(this._deviceProxies).forEach((path) => this._dropDeviceProxy(path));
        if (this._proxy) {
            this._dbusSignalIds.forEach((id) => {
                try { this._proxy.disconnectSignal(id); } catch (e) {}
            });
            this._propSignalIds.forEach((id) => {
                try { this._proxy.disconnect(id); } catch (e) {}
            });
        }
        this._dbusSignalIds = [];
        this._propSignalIds = [];
        this._proxy = null;
    }
}

module.exports = {
    UpowerProvider,
    UPOWER_NAME,
    UPOWER_PATH
};
