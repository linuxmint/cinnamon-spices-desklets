const Desklet = imports.ui.desklet;
const PopupMenu = imports.ui.popupMenu;
const Lang = imports.lang;
const St = imports.gi.St;
const Gtk = imports.gi.Gtk;
const Main = imports.ui.main;
const Gio = imports.gi.Gio;
const Settings = imports.ui.settings;
const Extension = imports.ui.extension;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;

const UUID = "kdecdesklet@joejoetv";

const FreedesktopDBusInterface = '\
<node> \
    <interface name="org.freedesktop.DBus"> \
        <method name="ListNames"> \
            <arg type="as" direction="out"/> \
        </method> \
    </interface> \
</node>';
const FreedesktopDBusProxy = Gio.DBusProxy.makeProxyWrapper(FreedesktopDBusInterface);

const KDEConnectInterface = '\
<node> \
    <interface name="org.kde.kdeconnect.daemon"> \
        <method name="announcedName"> \
            <arg type="s" direction="out"/> \
        </method> \
        <method name="deviceNames"> \
            <arg name="onlyReachable" type="b" direction="in"/> \
            <arg name="onlyPaired" type="b" direction="in"/> \
            <arg type="a{ss}" direction="out"/> \
        </method> \
        <method name="devices"> \
            <arg name="onlyReachable" type="b" direction="in"/> \
            <arg name="onlyPaired" type="b" direction="in"/> \
            <arg type="as" direction="out"/> \
        </method> \
        <signal name="deviceListChanged"> \
        </signal> \
    </interface> \
</node>';
const KDEConnectProxy = Gio.DBusProxy.makeProxyWrapper(KDEConnectInterface);

const KDEConnectDeviceInterface = '\
<node> \
    <interface name="org.kde.kdeconnect.device"> \
        <property name="isReachable" type="b" access="read"/> \
        <property name="isTrusted" type="b" access="read"/> \
        <property name="supportedPlugins" type="as" access="read"/> \
        <property name="type" type="s" access="read"/> \
        <method name="acceptPairing"> \
        </method> \
        <method name="isPluginEnabled"> \
            <arg name="pluginName" type="s" direction="in"/> \
            <arg type="b" direction="out"/> \
        </method> \
        <method name="isTrusted"> \
            <arg type="b" direction="out"/> \
        </method> \
        <method name="loadedPlugins"> \
            <arg type="as" direction="out"/> \
        </method> \
        <method name="unpair"> \
        </method> \
    </interface> \
</node>';
const KDEConnectDeviceProxy = Gio.DBusProxy.makeProxyWrapper(KDEConnectDeviceInterface);

const KDEConnectDeviceBatteryInterface = '\
<node> \
    <interface name="org.kde.kdeconnect.device.battery"> \
        <method name="charge"> \
            <arg type="i" direction="out"/> \
        </method> \
        <method name="isCharging"> \
            <arg type="b" direction="out"/> \
        </method> \
        <signal name="chargeChanged"> \
            <arg name="charge" type="i" direction="out"/> \
        </signal> \
        <signal name="stateChanged"> \
            <arg name="charging" type="b" direction="out"/> \
        </signal> \
    </interface> \
</node>';
const KDEConnectDeviceBatteryProxy = Gio.DBusProxy.makeProxyWrapper(KDEConnectDeviceBatteryInterface);

const KDEConnectDeviceNotificationsInterface = '\
<node> \
    <interface name="org.kde.kdeconnect.device.notifications"> \
        <method name="activeNotifications"> \
            <arg type="as" direction="out"/> \
        </method> \
        <method name="sendReply"> \
            <arg name="replyId" type="s" direction="in"/> \
            <arg name="message" type="s" direction="in"/> \
        </method> \
        <signal name="notificationPosted"> \
            <arg name="publicId" type="s" direction="out"/> \
        </signal> \
        <signal name="notificationRemoved"> \
            <arg name="publicId" type="s" direction="out"/> \
        </signal> \
        <signal name="notificationUpdated"> \
            <arg name="publicId" type="s" direction="out"/> \
        </signal> \
    </interface> \
</node>';
const KDEConnectDeviceNotificationsProxy = Gio.DBusProxy.makeProxyWrapper(KDEConnectDeviceNotificationsInterface);

const KDEConnectDeviceNotificationInterface = '\
<node> \
    <interface name="org.kde.kdeconnect.device.notifications.notification"> \
        <property name="appName" type="s" access="read"/> \
        <property name="dismissable" type="b" access="read"/> \
        <property name="hasIcon" type="b" access="read"/> \
        <property name="iconPath" type="s" access="read"/> \
        <property name="internalId" type="s" access="read"/> \
        <property name="replyId" type="s" access="read"/> \
        <property name="silent" type="b" access="read"/> \
        <property name="text" type="s" access="read"/> \
        <property name="ticker" type="s" access="read"/> \
        <property name="title" type="s" access="read"/> \
        <method name="dismiss"> \
        </method> \
        <method name="reply"> \
        </method> \
    </interface> \
</node>';
const KDEConnectDeviceNotificationProxy = Gio.DBusProxy.makeProxyWrapper(KDEConnectDeviceNotificationInterface);

const defaultDevice = {
    ID: "",
    isReachable: false,
    Name: "",
    supportsBattery: false,
    supportsNotifications: false,
    notificationList: [],
    batteryCharge: 0,
    batteryChargeState: false,
    type: ""
}

function getBatteryIcon(charge, isCharging) {
    let iconName = "battery-symbolic";
    
    if (isCharging == true) {
        switch (true) {
            case (charge <= 10):
                iconName = "battery-empty-charging-symbolic";
                break;
            case (charge > 10 && charge <= 25):
                iconName = "battery-caution-charging-symbolic";
                break;
            case (charge > 25 && charge <= 50):
                iconName = "battery-low-charging-symbolic";
                break;
            case (charge > 50 && charge <= 75):
                iconName = "battery-medium-charging-symbolic";
                break;
            case (charge > 75 && charge <= 99):
                iconName = "battery-good-charging-symbolic";
                break;
            case (charge > 99 && charge <= 100):
                iconName = "battery-full-charging-symbolic";
                break;
        }
    }
    else {
        switch (true) {
            case (charge <= 10):
                iconName = "battery-empty-symbolic";
                break;
            case (charge > 10 && charge <= 25):
                iconName = "battery-caution-symbolic";
                break;
            case (charge > 25 && charge <= 50):
                iconName = "battery-low-symbolic";
                break;
            case (charge > 50 && charge <= 75):
                iconName = "battery-medium-symbolic";
                break;
            case (charge > 75 && charge <= 99):
                iconName = "battery-good-symbolic";
                break;
            case (charge > 99 && charge <= 100):
                iconName = "battery-full-symbolic";
                break;
        }
    }
    return iconName
}

function getDeviceIcon(type) {
    let iconName

    switch(type) {
        case "desktop":
            iconName = "computer-symbolic";
            break;
        case "laptop":
            iconName = "laptop-symbolic";
            break;
        case "smartphone":
            iconName = "smartphone-symbolic";
            break;
        case "tablet":
            iconName = "tablet-symbolic";
            break;
        case "tv":
            iconName = "tv-symbolic";
            break;
        default:
            iconName = "dialog-question-symbolic";
    }

    return iconName
}

// l10n/translation support
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

function KDEConnectDesklet(metadata, desklet_id) {
	this._init(metadata, desklet_id);
}

function DeviceNotification(selectedDevice, notificationID, appName, dismissable, hasIcon, iconPath, replyAvailable, replyID, silent, text, title, ticker) {
    this._init(selectedDevice, notificationID, appName, dismissable, hasIcon, iconPath, replyAvailable, replyID, silent, text, title, ticker);
}

DeviceNotification.prototype = {
    _init: function(selectedDevice, notificationID, appName, dismissable, hasIcon, iconPath, replyAvailable, replyID, silent, text, title, ticker) {
        this.notificationID = notificationID;
        this.appName = appName;
        this.dismissable = dismissable;
        this.hasIcon = hasIcon;
        this.iconPath = iconPath;
        this.replyAvailable = replyAvailable;
        this.replyID = replyID;
        this.silent = silent;
        this.selectedDevice = selectedDevice;

        let showText = true;

        if (text !== "") {
            this.text = text;
            this.title = title;
            showText = true;
        }
        else {
            if (ticker !== "") {
                this.title = ticker
                this.text = "";
                showText = false;
            }
            else {
                this.title = title;
                this.text = "";
                showText = false;
            }
        }        
        
        let applicationIcon = new St.Icon({icon_size: 16, style_class: "kdecd-notification-app-icon", icon_name: "", icon_type: St.IconType.FULLCOLOR});
        
        if (this.hasIcon == true) {
            try {
                let icon = Gio.Icon.new_for_string(this.iconPath);
                applicationIcon.set_gicon(icon);
            }
            catch (error) {
                global.logError(error);
            }
        }

        let applicationName = new St.Label({style_class: "kdecd-notification-app-name", text: this.appName, x_expand: true, y_align: 2});
        this._dismissButton = new St.Button({style_class: "kdecd-notification-dismiss-button", label: ""});
        let dismissIcon = new St.Icon({icon_size: 16, style_class: "kdecd-notification-dismiss-button-icon", icon_name: "window-close-symbolic", icon_type: St.IconType.SYMBOLIC});
        this._dismissButton.add_actor(dismissIcon);
        this._onDismissButtonClicked = this._dismissButton.connect("clicked", Lang.bind(this, this.onDismissButtonClicked));

        let notificationTitle = new St.Label({style_class: "kdecd-notification-title", text: this.title});
        let notificationText = new St.Label({style_class: "kdecd-notification-text", text: this.text});
        
        this._replyButton = new St.Button({style_class: "kdecd-notification-reply-button", label: _("Reply")});
        this._onReplyButtonClicked = this._replyButton.connect("clicked", Lang.bind(this, this.onReplyButtonClicked));

        let header = new St.BoxLayout({style_class: "kdecd-notification-header-container", vertical: false});
        let content = new St.BoxLayout({style_class: "kdecd-notification-content-container", vertical: true});
        let buttonContainer = new St.BoxLayout({style_class: "kdecd-notification-button-container", vertical: false, x_expand: true});

        this.actor = new St.BoxLayout({style_class: "kdecd-notification-container", vertical: true});

        header.add(applicationIcon);
        header.add(applicationName);

        if (this.dismissable == true) {
            header.add(this._dismissButton);
        }

        content.add(notificationTitle);
        if (showText == true) {
            content.add(notificationText);
        }

        buttonContainer.add(this._replyButton);

        this.actor.add(header);
        this.actor.add(content);

        if (replyAvailable == true) {
            this.actor.add(buttonContainer);
        }
    },

    onReplyButtonClicked: function(button, clicked_button) {
        try {
            let notificationProxy = KDEConnectDeviceNotificationProxy(Gio.DBus.session, "org.kde.kdeconnect", "/modules/kdeconnect/devices/"+this.selectedDevice.ID+"/notifications/"+this.notificationID);
            notificationProxy.replySync();
        }
        catch (error) {
            global.logError(error);
        }
    },

    onDismissButtonClicked: function(button, clicked_button) {
        try {
            let notificationProxy = KDEConnectDeviceNotificationProxy(Gio.DBus.session, "org.kde.kdeconnect", "/modules/kdeconnect/devices/"+this.selectedDevice.ID+"/notifications/"+this.notificationID);
            notificationProxy.dismissSync();
        }
        catch (error) {
            global.logError(error);
        }
    },

    destroy: function() {
        this._dismissButton.disconnect(this._onDismissButtonClicked);
        this._replyButton.disconnect(this._onReplyButtonClicked);
        this.actor.destroy_all_children();
    }
}

KDEConnectDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.ui = {};
        this.selectedDevice = {};
        this.selectedDevice = Object.assign(this.selectedDevice, defaultDevice);
        this.deviceList = [];
        this.DeviceMenuItemSignalList =  [];
        
        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
        
        //Ckeck if KDEConnect is running by checking if it is available on the DBus
        let dbusNameList = [];

        try {
            let dbproxy = new FreedesktopDBusProxy(Gio.DBus.session, "org.freedesktop.DBus", "/org/freedesktop/DBus");
            dbusNameList = dbproxy.ListNamesSync()[0];
        }
        catch (error) {
            global.logError(error);
        }

        if (dbusNameList.includes("org.kde.kdeconnect")) {
            this.devicesMenuItem = new PopupMenu.PopupSubMenuMenuItem(_("Available Devices"));
            this._menu.addMenuItem(this.devicesMenuItem);
    
            this.selectedDevice.ID = this.settings.getValue("selected-device-id");
            global.log("["+this.metadata.uuid+"] Loaded Device ID from settings: "+this.selectedDevice.ID);
    
            //this.scale = 1;
            //TODO: Maybe add scale setting, so the applet size can be configured
    
            try{
                this.kdecProxy = new KDEConnectProxy(Gio.DBus.session, "org.kde.kdeconnect", "/modules/kdeconnect");
                this._onDeviceListChanged = this.kdecProxy.connectSignal("deviceListChanged", Lang.bind(this, this.onDeviceListChanged));
    
                this.updateDeviceList();
                this.setupUI();
            }
            catch (error) {
                global.logError(error);
            }
        }
        else {
            this._menu.addAction(_("Reload Desklet"), Lang.bind(this, this.reloadDesklet));

            let deskletContainer = new St.BoxLayout({vertical: false, style_class: "kdecd-desklet-container"});
            let InfoContainer = new St.BoxLayout({vertical: true, style_class: "kdecd-device-info-container"});
            let Icon = new St.Icon({icon_name: "window-close-symbolic", icon_size: 96, icon_type: St.IconType.SYMBOLIC, style_class: "kdecd-device-icon-gray", y_expand: true});
            let Label = new St.Label({text: _("KDEConnect is not running!"), style_class: "kdecd-device-name-gray"});
            
            InfoContainer.add(Label);
            InfoContainer.add(Icon);
            
            deskletContainer.add(InfoContainer);
            
            this.setContent(deskletContainer);            
        }
    },

    setupUI: function() {
        try {
            if (this.ui.notifcationListContainer) {
                this.ui.notifcationListContainer.destroy_all_children();
            }
            for (let key in this.ui) {
                this.ui[key].destroy();
            }
        }
        catch (error) {
            global.logError(error);
        }

        let deviceName = "";
        let deviceNameStyleClass = "";
        let deviceIcon = "";
        let deviceIconStyleClass = "";
        let showBatteryArea = false;
        let showNotificationArea = false;

        if (this.selectedDevice.ID !== "") {
            if (this.selectedDevice.isReachable == true) {
                deviceName = this.selectedDevice.Name;
                deviceNameStyleClass = "kdecd-device-name";
                deviceIcon = getDeviceIcon(this.selectedDevice.type);
                deviceIconStyleClass = "kdecd-device-icon";
                showBatteryArea = this.selectedDevice.supportsBattery;
                showNotificationArea = this.selectedDevice.supportsNotifications;
            }
            else {
                deviceName = this.selectedDevice.Name;
                deviceNameStyleClass = "kdecd-device-name-gray";
                deviceIcon = getDeviceIcon(this.selectedDevice.type);
                deviceIconStyleClass = "kdecd-device-icon-gray";
                showBatteryArea = false;
                showNotificationArea = false;
            }
        }
        else {
            deviceName = _("No Device Selected!");
            deviceNameStyleClass = "kdecd-device-name-gray";
            deviceIcon = "window-close-symbolic";
            deviceIconStyleClass = "kdecd-device-icon-gray";
            showBatteryArea = false;
            showNotificationArea = false;
        }

        this.ui.deskletContainer = new St.BoxLayout({vertical: false, style_class: "kdecd-desklet-container"});
        this.ui.notificationScrollArea = new St.ScrollView({style_class: "kdecd-notification-area"});
        this.ui.deviceInfoContainer = new St.BoxLayout({vertical: true, style_class: "kdecd-device-info-container"});
        this.ui.deviceBatteryInfoContainer = new St.BoxLayout({vertical: false, style_class: "kdecd-device-battery-container", x_align: St.Align.END});
        this.ui.notifcationListContainer = new St.BoxLayout({vertical: true, style_class: "kdecd-notification-list-container"})

        this.ui.deviceIcon = new St.Icon({icon_name: deviceIcon, icon_size: 96, icon_type: St.IconType.SYMBOLIC, style_class: deviceIconStyleClass, y_expand: true});
        this.ui.deviceName = new St.Label({text: deviceName, style_class: deviceNameStyleClass});
        this.ui.batteryIcon = new St.Icon({icon_name: getBatteryIcon(this.selectedDevice.batteryCharge, this.selectedDevice.batteryChargeState), icon_size: 24, icon_type: St.IconType.SYMBOLIC, style_class: "kdecd-device-battery-icon"});
        this.ui.batteryCharge = new St.Label({text: this.selectedDevice.batteryCharge+"%", style_class: "kdecd-device-battery-charge"});

        this.ui.notificationScrollArea.set_policy(Gtk.PolicyType.NEVER,Gtk.PolicyType.AUTOMATIC);

        this.ui.deviceBatteryInfoContainer.add(this.ui.batteryIcon);
        this.ui.deviceBatteryInfoContainer.add(this.ui.batteryCharge);

        this.ui.deviceInfoContainer.add(this.ui.deviceName);
        this.ui.deviceInfoContainer.add(this.ui.deviceIcon);
        
        if (showBatteryArea) {
            this.ui.deviceInfoContainer.add(this.ui.deviceBatteryInfoContainer);
        }

        this.ui.deskletContainer.add(this.ui.deviceInfoContainer);

        if (showNotificationArea) {
            if (this.selectedDevice.notificationList.length > 0) {
                for (let i = 0; i < this.selectedDevice.notificationList.length; i++) {
                    this.ui.notifcationListContainer.add(this.selectedDevice.notificationList[i].actor);
                }
            }

            this.ui.notificationScrollArea.add_actor(this.ui.notifcationListContainer);

            this.ui.deskletContainer.add(this.ui.notificationScrollArea);  
        }

        //TODO: Fix many St Errors (.xsession-errors)
        this.setContent(this.ui.deskletContainer);
    },

    updateDeviceList: function() {
        let deviceIDs = [];
        let deviceNames = new Object();

        try {
            deviceIDs = this.kdecProxy.devicesSync(false, true)[0];
            deviceNames = this.kdecProxy.deviceNamesSync(false, true)[0];
        }
        catch (error) {
            global.logError(error);
        }

        this.deviceList.length = 0;

        let selectedDeviceFound = false;

        if (deviceIDs.length > 0) {
            for (let i = 0; i < deviceIDs.length; i++) {
                let isReachable = false;
                let loadedPlugins = [];
                let type = "";

                try {
                    let kdecDevProxy = new KDEConnectDeviceProxy(Gio.DBus.session, "org.kde.kdeconnect", "/modules/kdeconnect/devices/"+deviceIDs[i]);
                    isReachable = kdecDevProxy.isReachable;
                    loadedPlugins = kdecDevProxy.loadedPluginsSync()[0];
                    type = kdecDevProxy.type;
                }
                catch (error) {
                    global.logError(error);
                }
                
                let device = {};
                
                device.supportsBattery = loadedPlugins.includes("kdeconnect_battery");
                device.supportsNotifications = loadedPlugins.includes("kdeconnect_notifications");
                device.type = type;
                device.ID = deviceIDs[i];
                device.Name = deviceNames[deviceIDs[i]];
                device.isReachable = isReachable;

                //Debug
                //global.log("[UPDATE DEVICE LIST] DEVICE: ID: "+device.ID+" NAME: "+device.Name+" TYPE: "+device.type+" BAT?: "+device.supportsBattery+" NOT?: "+device.supportsNotifications+" REACH?: "+device.isReachable);

                if (this.selectedDevice.ID !== "") {
                    if (deviceIDs[i] == this.selectedDevice.ID && selectedDeviceFound == false) {
                        selectedDeviceFound = true;

                        this.updateSelectedDevice(device);

                        this.getBatteryData();
                        this.getNotificationData();
                    }
                }
                this.deviceList.push(device);
            }
        }

        if (this.selectedDevice.ID !== "") {
            if (selectedDeviceFound !== true) {
                this.resetSelectedDevice();

                this.setupUI();
            }
        }

        this.updateContextMenu();

        global.log("["+this.metadata.uuid+"] Updated Device List");
    },

    updateContextMenu: function() {
        for (let i = 0; i < this.DeviceMenuItemSignalList.length; i++) {
            this.DeviceMenuItemSignalList[i].menuItem.disconnect(this.DeviceMenuItemSignalList[i].activateSignal);
        }
        this.DeviceMenuItemSignalList.length = 0;

        this.devicesMenuItem.menu.removeAll();

        if (this.deviceList.length == 0) {
            let noReachableDevicesMenuItem = new PopupMenu.PopupMenuItem(_("No paired devices!"), {reactive: false});
            noReachableDevicesMenuItem.setSensitive(false);
            this.devicesMenuItem.menu.addMenuItem(noReachableDevicesMenuItem);
        }
        else {
            for (let i = 0; i < this.deviceList.length; i++) {
                let currentDevice = this.deviceList[i];

                let deviceMenuItem;

                if (currentDevice.isReachable) {
                    deviceMenuItem = new PopupMenu.PopupMenuItem(currentDevice.Name, {reactive: true});
                    
                    if (currentDevice.ID !== "") {
                        if (currentDevice.ID == this.selectedDevice.ID) {
                            deviceMenuItem.setShowDot(true);
                        }
                        else {
                            let deviceMenuItemSignal = {};
                            deviceMenuItemSignal.menuItem = deviceMenuItem;
                            deviceMenuItemSignal.activateSignal = deviceMenuItem.connect("activate", Lang.bind(this, function() {
                                try {
                                    this.updateSelectedDevice(currentDevice);
    
                                    this.updateContextMenu();
    
                                    this.getBatteryData();
                                    this.getNotificationData();
    
                                    this.setupUI();
                                }
                                catch (error) {
                                    global.logError(error);
                                }
                            }));

                            this.DeviceMenuItemSignalList.push(deviceMenuItemSignal);
                        }
                    }

                }
                else {
                    deviceMenuItem = new PopupMenu.PopupMenuItem(currentDevice.Name, {reactive: false});
                    deviceMenuItem.actor.add_style_pseudo_class('insensitive');
                }

                this.devicesMenuItem.menu.addMenuItem(deviceMenuItem);
            }
        }
    },

    getBatteryData: function() {
        if (this.selectedDevice.supportsBattery) {
            try {
                let kdecDevBatProxy = KDEConnectDeviceBatteryProxy(Gio.DBus.session, "org.kde.kdeconnect", "/modules/kdeconnect/devices/"+this.selectedDevice.ID)
                this.selectedDevice.batteryCharge = kdecDevBatProxy.chargeSync()[0];
                this.selectedDevice.batteryChargeState = kdecDevBatProxy.isChargingSync()[0];
            }
            catch (error) {
                global.logError(error);
            }
        }
    },

    getNotificationData: function() {
        if (this.selectedDevice.supportsNotifications) {
            for (let i = 0; i < this.selectedDevice.notificationList.length; i++) {
                this.selectedDevice.notificationList[i].destroy();
            }
            this.selectedDevice.notificationList.length = 0;

            let activeNotifications = [];
            try {
                let kdecDevNotsProxy = KDEConnectDeviceNotificationsProxy(Gio.DBus.session, "org.kde.kdeconnect", "/modules/kdeconnect/devices/"+this.selectedDevice.ID)
                activeNotifications = kdecDevNotsProxy.activeNotificationsSync()[0];

                for (let i = 0; i < activeNotifications.length; i++) {                    
                    let kdecDevNotProxy = KDEConnectDeviceNotificationProxy(Gio.DBus.session, "org.kde.kdeconnect", "/modules/kdeconnect/devices/"+this.selectedDevice.ID+"/notifications/"+activeNotifications[i]);
                    
                    let replyAvailable = (kdecDevNotProxy.replyId !== "");
                    let currentNotification = new DeviceNotification(this.selectedDevice, activeNotifications[i], kdecDevNotProxy.appName, kdecDevNotProxy.dismissable, kdecDevNotProxy.hasIcon, kdecDevNotProxy.iconPath, replyAvailable, kdecDevNotProxy.replyId, kdecDevNotProxy.silent, kdecDevNotProxy.text, kdecDevNotProxy.title, kdecDevNotProxy.ticker);

                    this.selectedDevice.notificationList.push(currentNotification);
                }
            }
            catch (error) {
                global.logError(error);
            }
        }
    },

    updateSelectedDevice: function(newDevice) {
        this.resetSelectedDevice();

        this.settings.setValue("selected-device-id", newDevice.ID);
        global.log("["+this.metadata.uuid+"] Updated Device ID setting: "+newDevice.ID);

        this.selectedDevice = Object.assign(this.selectedDevice, newDevice);

        try {
            if (this.selectedDevice.supportsBattery == true) {
                this.selectedDevice._batteryProxy = KDEConnectDeviceBatteryProxy(Gio.DBus.session, "org.kde.kdeconnect", "/modules/kdeconnect/devices/"+this.selectedDevice.ID)

                this.selectedDevice._onBatteryStateChanged = this.selectedDevice._batteryProxy.connectSignal("stateChanged", Lang.bind(this, this.onBatteryStateChanged));
            }

            if (this.selectedDevice.supportsNotifications == true) {
                this.selectedDevice._notificationProxy = KDEConnectDeviceNotificationsProxy(Gio.DBus.session, "org.kde.kdeconnect", "/modules/kdeconnect/devices/"+this.selectedDevice.ID)
    
                this.selectedDevice._onAllNotificationsRemoved = this.selectedDevice._notificationProxy.connectSignal("allNotificationsRemoved", Lang.bind(this, this.onAllNotificationsRemoved));
                this.selectedDevice._onNotificationPosted = this.selectedDevice._notificationProxy.connectSignal("notificationPosted", Lang.bind(this, this.onNotificationsUpdated));
                this.selectedDevice._onNotificationUpdated = this.selectedDevice._notificationProxy.connectSignal("notificationUpdated", Lang.bind(this, this.onNotificationsUpdated));
                this.selectedDevice._onNotificationRemoved = this.selectedDevice._notificationProxy.connectSignal("notificationRemoved", Lang.bind(this, this.onNotificationsUpdated));
            }
        }
        catch (error) {
            global.logError(error);
        }
    },

    resetSelectedDevice: function() {
        if (this.selectedDevice.supportsNotifications == true) {
            for (let i = 0; i < this.selectedDevice.notificationList.length; i++) {
                this.selectedDevice.notificationList[i].destroy();
            }
            this.selectedDevice.notificationList.length = 0;
        }

        if (typeof this.selectedDevice._onAllNotificationsRemoved !== "undefined") {
            this.selectedDevice._notificationProxy.disconnectSignal(this.selectedDevice._onAllNotificationsRemoved);
            delete this.selectedDevice._onAllNotificationsRemoved;
        }
        if (typeof this.selectedDevice._onNotificationPosted !== "undefined") {
            this.selectedDevice._notificationProxy.disconnectSignal(this.selectedDevice._onNotificationPosted);
            delete this.selectedDevice._onNotificationPosted;
        }
        if (typeof this.selectedDevice._onNotificationUpdated !== "undefined") {
            this.selectedDevice._notificationProxy.disconnectSignal(this.selectedDevice._onNotificationUpdated);
            delete this.selectedDevice._onNotificationUpdated;
        }
        if (typeof this.selectedDevice._onNotificationRemoved !== "undefined") {
            this.selectedDevice._notificationProxy.disconnectSignal(this.selectedDevice._onNotificationRemoved);
            delete this.selectedDevice._onNotificationRemoved;
        }
        if (typeof this.selectedDevice._onBatteryStateChanged !== "undefined") {
            this.selectedDevice._batteryProxy.disconnectSignal(this.selectedDevice._onBatteryStateChanged);
            delete this.selectedDevice._onBatteryStateChanged;
        }
        this.selectedDevice = Object.assign(this.selectedDevice, defaultDevice);
    },

    onDeviceListChanged: function() {
        this.updateDeviceList();
        this.setupUI();
    },

    onBatteryStateChanged: function(proxy, sender, [charging]) {
        this.getBatteryData();

        if (this.selectedDevice.supportsBattery == true) {
            try {
                this.ui.batteryCharge.set_text(this.selectedDevice.batteryCharge+"%");
                this.ui.batteryIcon.set_icon_name(getBatteryIcon(this.selectedDevice.batteryCharge, this.selectedDevice.batteryChargeState));

            }
            catch (error) {
                global.logError(error);
            }
        }
    },

    onAllNotificationsRemoved: function(proxy, sender) {
        this.getNotificationData();
    },

    onNotificationsUpdated: function(proxy, sender, [publicId]) {
        this.getNotificationData();

        try {
            if (this.selectedDevice.supportsNotifications == true) {
                this.ui.notifcationListContainer.destroy_all_children();
                if (this.selectedDevice.notificationList.length > 0) {
                    for (let i = 0; i < this.selectedDevice.notificationList.length; i++) {
                        this.ui.notifcationListContainer.add(this.selectedDevice.notificationList[i].actor);
                    }
                }
            }

        }
        catch (error) {
            global.logError(error);
        }
    },

    on_desklet_removed: function() {
        this.resetSelectedDevice();

        if (typeof this._onDeviceListChanged !== "undefined") {
            this.kdecProxy.disconnectSignal(this._onDeviceListChanged);
            delete this._onDeviceListChanged;
        }

        try {
            for (let i = 0; i < this.DeviceMenuItemSignalList.length; i++) {
                this.DeviceMenuItemSignalList[i].menuItem.disconnect(this.DeviceMenuItemSignalList[i].activateSignal);
            }
            this.DeviceMenuItemSignalList.length = 0;
        }
        catch (error) {
            global.logError(error);
        }
    },

    reloadDesklet: function() {
        Extension.reloadExtension(this.metadata["uuid"], Extension.Type.DESKLET);
    }
}

function main(metadata, desklet_id) {
	return new KDEConnectDesklet(metadata, desklet_id);
}
