
// Desklet : Drives Manager
// Author  : Lester Carballo Pérez 
// Email   : lestcape@gmail.com
// Website : https://github.com/lestcape/Drives-Manager
//
// This is a desklet to show devices connected to the computer and interact with them.
//
//    This program is free software:
//
//    You can redistribute it and/or modify it under the terms of the
//    GNU General Public License as published by the Free Software
//    Foundation, either version 3 of the License, or (at your option)
//    any later version.
//
//    This program is distributed in the hope that it will be useful,
//    but WITHOUT ANY WARRANTY; without even the implied warranty of
//    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//    GNU General Public License for more details.
//
//    You should have received a copy of the GNU General Public License
//    along with this program.  If not, see <http://www.gnu.org/licenses/>.

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Main = imports.ui.main;
const St = imports.gi.St;
const GUdev = imports.gi.GUdev;
const GObject = imports.gi.GObject;

let UDisksDriveProxyInternal;
let UDisksDriveAtaProxyInternal;
try {
const DBus = imports.dbus;
const UDisksDriveInterfaceString = '<interface name="org.freedesktop.UDisks2.Drive">\
 <method name="Eject">\
 <arg type="a{sv}" name="options" direction="in"/>\
 </method>\
 <method name="SetConfiguration">\
 <arg type="a{sv}" name="value" direction="in"/>\
 <arg type="a{sv}" name="options" direction="in"/>\
 </method>\
 <method name="PowerOff">\
 <arg type="a{sv}" name="options" direction="in"/>\
 </method>\
 <property type="s" name="Vendor" access="read"/>\
 <property type="s" name="Model" access="read"/>\
 <property type="s" name="Revision" access="read"/>\
 <property type="s" name="Serial" access="read"/>\
 <property type="s" name="WWN" access="read"/>\
 <property type="s" name="Id" access="read"/>\
 <property type="a{sv}" name="Configuration" access="read"/>\
 <property type="s" name="Media" access="read"/>\
 <property type="as" name="MediaCompatibility" access="read"/>\
 <property type="b" name="MediaRemovable" access="read"/>\
 <property type="b" name="MediaAvailable" access="read"/>\
 <property type="b" name="MediaChangeDetected" access="read"/>\
 <property type="t" name="Size" access="read"/>\
 <property type="t" name="TimeDetected" access="read"/>\
 <property type="t" name="TimeMediaDetected" access="read"/>\
 <property type="b" name="Optical" access="read"/>\
 <property type="b" name="OpticalBlank" access="read"/>\
 <property type="u" name="OpticalNumTracks" access="read"/>\
 <property type="u" name="OpticalNumAudioTracks" access="read"/>\
 <property type="u" name="OpticalNumDataTracks" access="read"/>\
 <property type="u" name="OpticalNumSessions" access="read"/>\
 <property type="i" name="RotationRate" access="read"/>\
 <property type="s" name="ConnectionBus" access="read"/>\
 <property type="s" name="Seat" access="read"/>\
 <property type="b" name="Removable" access="read"/>\
 <property type="b" name="Ejectable" access="read"/>\
 <property type="s" name="SortKey" access="read"/>\
 <property type="b" name="CanPowerOff" access="read"/>\
 <property type="s" name="SiblingId" access="read"/>\
</interface>;';
eval('const UDisksDriveInterfaceOld='+UDisksDriveInterfaceString);
UDisksDriveProxyInternal = Gio.DBusProxy.makeProxyWrapper(UDisksDriveInterfaceOld);
const UDisksDriveAtaInterfaceString = '<interface name="org.freedesktop.UDisks2.Drive.Ata">\
 <method name="SmartUpdate">\
 <arg type="a{sv}" name="options" direction="in"/>\
 </method>\
 <method name="SmartGetAttributes">\
 <arg type="a{sv}" name="options" direction="in"/>\
 <arg type="a(ysqiiixia{sv})" name="attributes" direction="out"/>\
 </method>\
 <method name="SmartSelftestStart">\
 <arg type="s" name="type" direction="in"/>\
 <arg type="a{sv}" name="options" direction="in"/>\
 </method>\
 <method name="SmartSelftestAbort">\
 <arg type="a{sv}" name="options" direction="in"/>\
 </method>\
 <method name="SmartSetEnabled">\
 <arg type="b" name="value" direction="in"/>\
 <arg type="a{sv}" name="options" direction="in"/>\
 </method>\
 <method name="PmGetState">\
 <arg type="a{sv}" name="options" direction="in"/>\
 <arg type="y" name="state" direction="out"/>\
 </method>\
 <method name="PmStandby">\
 <arg type="a{sv}" name="options" direction="in"/>\
 </method>\
 <method name="PmWakeup">\
 <arg type="a{sv}" name="options" direction="in"/>\
 </method>\
 <method name="SecurityEraseUnit">\
 <arg type="a{sv}" name="options" direction="in"/>\
 </method>\
 <property type="b" name="SmartSupported" access="read"/>\
 <property type="b" name="SmartEnabled" access="read"/>\
 <property type="t" name="SmartUpdated" access="read"/>\
 <property type="b" name="SmartFailing" access="read"/>\
 <property type="t" name="SmartPowerOnSeconds" access="read"/>\
 <property type="d" name="SmartTemperature" access="read"/>\
 <property type="i" name="SmartNumAttributesFailing" access="read"/>\
 <property type="i" name="SmartNumAttributesFailedInThePast" access="read"/>\
 <property type="x" name="SmartNumBadSectors" access="read"/>\
 <property type="s" name="SmartSelftestStatus" access="read"/>\
 <property type="i" name="SmartSelftestPercentRemaining" access="read"/>\
 <property type="b" name="PmSupported" access="read"/>\
 <property type="b" name="PmEnabled" access="read"/>\
 <property type="b" name="ApmSupported" access="read"/>\
 <property type="b" name="ApmEnabled" access="read"/>\
 <property type="b" name="AamSupported" access="read"/>\
 <property type="b" name="AamEnabled" access="read"/>\
 <property type="i" name="AamVendorRecommendedValue" access="read"/>\
 <property type="b" name="WriteCacheSupported" access="read"/>\
 <property type="b" name="WriteCacheEnabled" access="read"/>\
 <property type="i" name="SecurityEraseUnitMinutes" access="read"/>\
 <property type="i" name="SecurityEnhancedEraseUnitMinutes" access="read"/>\
 <property type="b" name="SecurityFrozen" access="read"/>\
</interface>;';
eval('const UDisksDriveAtaInterfaceOld='+UDisksDriveAtaInterfaceString);
UDisksDriveAtaProxyInternal = Gio.DBusProxy.makeProxyWrapper(UDisksDriveAtaInterfaceOld);
} catch(e) {
const UDisksDriveInterface = '\
   <node>\
      <interface name="org.freedesktop.UDisks2.Drive">\
         <method name="Eject">\
            <arg type="a{sv}" name="options" direction="in"/>\
         </method>\
         <method name="SetConfiguration">\
            <arg type="a{sv}" name="value" direction="in"/>\
            <arg type="a{sv}" name="options" direction="in"/>\
         </method>\
         <method name="PowerOff">\
            <arg type="a{sv}" name="options" direction="in"/>\
         </method>\
         <property type="s" name="Vendor" access="read"/>\
         <property type="s" name="Model" access="read"/>\
         <property type="s" name="Revision" access="read"/>\
         <property type="s" name="Serial" access="read"/>\
         <property type="s" name="WWN" access="read"/>\
         <property type="s" name="Id" access="read"/>\
         <property type="a{sv}" name="Configuration" access="read"/>\
         <property type="s" name="Media" access="read"/>\
         <property type="as" name="MediaCompatibility" access="read"/>\
         <property type="b" name="MediaRemovable" access="read"/>\
         <property type="b" name="MediaAvailable" access="read"/>\
         <property type="b" name="MediaChangeDetected" access="read"/>\
         <property type="t" name="Size" access="read"/>\
         <property type="t" name="TimeDetected" access="read"/>\
         <property type="t" name="TimeMediaDetected" access="read"/>\
         <property type="b" name="Optical" access="read"/>\
         <property type="b" name="OpticalBlank" access="read"/>\
         <property type="u" name="OpticalNumTracks" access="read"/>\
         <property type="u" name="OpticalNumAudioTracks" access="read"/>\
         <property type="u" name="OpticalNumDataTracks" access="read"/>\
         <property type="u" name="OpticalNumSessions" access="read"/>\
         <property type="i" name="RotationRate" access="read"/>\
         <property type="s" name="ConnectionBus" access="read"/>\
         <property type="s" name="Seat" access="read"/>\
         <property type="b" name="Removable" access="read"/>\
         <property type="b" name="Ejectable" access="read"/>\
         <property type="s" name="SortKey" access="read"/>\
         <property type="b" name="CanPowerOff" access="read"/>\
         <property type="s" name="SiblingId" access="read"/>\
      </interface>\
   </node>';
UDisksDriveProxyInternal = Gio.DBusProxy.makeProxyWrapper(UDisksDriveInterface);

const UDisksDriveAtaInterface = '\
   <node>\
      <interface name="org.freedesktop.UDisks2.Drive.Ata">\
         <method name="SmartUpdate">\
            <arg type="a{sv}" name="options" direction="in"/>\
         </method>\
         <method name="SmartGetAttributes">\
            <arg type="a{sv}" name="options" direction="in"/>\
            <arg type="a(ysqiiixia{sv})" name="attributes" direction="out"/>\
         </method>\
         <method name="SmartSelftestStart">\
            <arg type="s" name="type" direction="in"/>\
            <arg type="a{sv}" name="options" direction="in"/>\
         </method>\
         <method name="SmartSelftestAbort">\
            <arg type="a{sv}" name="options" direction="in"/>\
         </method>\
         <method name="SmartSetEnabled">\
            <arg type="b" name="value" direction="in"/>\
            <arg type="a{sv}" name="options" direction="in"/>\
         </method>\
         <method name="PmGetState">\
            <arg type="a{sv}" name="options" direction="in"/>\
            <arg type="y" name="state" direction="out"/>\
         </method>\
         <method name="PmStandby">\
            <arg type="a{sv}" name="options" direction="in"/>\
         </method>\
         <method name="PmWakeup">\
            <arg type="a{sv}" name="options" direction="in"/>\
         </method>\
         <method name="SecurityEraseUnit">\
            <arg type="a{sv}" name="options" direction="in"/>\
         </method>\
         <property type="b" name="SmartSupported" access="read"/>\
         <property type="b" name="SmartEnabled" access="read"/>\
         <property type="t" name="SmartUpdated" access="read"/>\
         <property type="b" name="SmartFailing" access="read"/>\
         <property type="t" name="SmartPowerOnSeconds" access="read"/>\
         <property type="d" name="SmartTemperature" access="read"/>\
         <property type="i" name="SmartNumAttributesFailing" access="read"/>\
         <property type="i" name="SmartNumAttributesFailedInThePast" access="read"/>\
         <property type="x" name="SmartNumBadSectors" access="read"/>\
         <property type="s" name="SmartSelftestStatus" access="read"/>\
         <property type="i" name="SmartSelftestPercentRemaining" access="read"/>\
         <property type="b" name="PmSupported" access="read"/>\
         <property type="b" name="PmEnabled" access="read"/>\
         <property type="b" name="ApmSupported" access="read"/>\
         <property type="b" name="ApmEnabled" access="read"/>\
         <property type="b" name="AamSupported" access="read"/>\
         <property type="b" name="AamEnabled" access="read"/>\
         <property type="i" name="AamVendorRecommendedValue" access="read"/>\
         <property type="b" name="WriteCacheSupported" access="read"/>\
         <property type="b" name="WriteCacheEnabled" access="read"/>\
         <property type="i" name="SecurityEraseUnitMinutes" access="read"/>\
         <property type="i" name="SecurityEnhancedEraseUnitMinutes" access="read"/>\
         <property type="b" name="SecurityFrozen" access="read"/>\
   </interface>\
</node>';
UDisksDriveAtaProxyInternal = Gio.DBusProxy.makeProxyWrapper(UDisksDriveAtaInterface);
}
const UDisksDriveAtaProxy = UDisksDriveAtaProxyInternal;
const UDisksDriveProxy = UDisksDriveProxyInternal;

function Installer(desklet, globalContainer, system) {
    this._init(desklet, globalContainer, system);
}

Installer.prototype = {
   _init: function(desklet, globalContainer, system) {
      this._desklet = desklet;
      this._system = system;
      this._globalContainer = globalContainer;
      this._usability = false;
   },

   setUsable: function(usability) {
      this._usability = usability;
   },

   checkUsability: function(hddTempActive) {
     if(hddTempActive) {
        if(this._usability)
           return true;
        this._usability = (this._checkPackage("hddtemp")) && (this._checkPermissions("/usr/sbin/hddtemp", "-rwsr-xr-x", "u+s"));
        if(this._usability)
           this._globalContainer.removeMessage();
        return this._usability;
     }
     this._globalContainer.removeMessage();
     this._usability = false;
     return true;
   },

   _checkPackage: function(packageName) {
      if(!this._isPackageInstall(packageName))
      {
         this._packageName = packageName;
         if(this._globalContainer.diplayedMesageID() == null)
            this._mesageIDPackage = this._globalContainer.displayMessage(_("Drives Manager need a pakage to use advance function.") +
                                    "\n" + _("If you do not want to install the package uncheck the option in the settings.") +
                                    "\n" + _("Do you want to install?"),
                                    [_("Yes"), _("No")], Lang.bind(this, this._installPackage));
         return false;
      }
      if(this._globalContainer.diplayedMesageID() == this._mesageIDPackage)
         this._globalContainer.removeMessage();
      return true;
   },

   _checkPermissions: function(folder, permissionsNeed, permissions) {
      if(!this._system.havePermission(folder, permissionsNeed))
      {
         this._folder = folder;
         this._permissions = permissions;
         if(this._globalContainer.diplayedMesageID() == null)
            this._mesageIDPermissions = this._globalContainer.displayMessage(_("Drives Manager requires that your account has permission to use advanced function.") +
                                        "\n" + _("If you do not want to grant permissions uncheck the option in the settings.") +
                                        "\n" + _("Do you want to grant permissions?"),
                                        [_("Yes"), _("No")], Lang.bind(this, this._pushPermissions));
         return false;
      }
      if(this._globalContainer.diplayedMesageID() == this._mesageIDPermissions)
         this._globalContainer.removeMessage();
      return true;
   },

   _installPackage: function(buttonPressed) {
      if(buttonPressed == _("Yes")) {
        this._globalContainer.removeMessage();
        this._mesageIDPackage = this._globalContainer.displayMessage(_("Please wait while installing pakage...") +
                                "\n" + _("If you do not want to install the package uncheck the option in the settings."),
                                [_("Cancel")], Lang.bind(this, this._backAction));
        this._system.execInstall(this._packageName);
      } else if(buttonPressed == _("No")) {
         this._globalContainer.removeMessage();
         this._desklet._hddTempActive = false;
         this._desklet._onHddTempChanged();
      }
   },

   _pushPermissions: function(buttonPressed) {
      if(buttonPressed == _("Yes")) {
        this._globalContainer.removeMessage();
        this._mesageIDPermissions = this._globalContainer.displayMessage(_("If you do not want to grant permissions uncheck the option in the settings."),
                                    [_("Cancel")], Lang.bind(this, this._backAction));
        this._system.execChmod(this._folder, this._permissions);
      } else if(buttonPressed == _("No")) {
         this._globalContainer.removeMessage();
         this._desklet._hddTempActive = false;
         this._desklet._onHddTempChanged();
      }
   },

   _backAction: function(buttonPressed) {
      if(buttonPressed == _("Cancel")) {
        //return variable to original state-
        this._globalContainer.removeMessage();
        this._desklet._hddTempActive = false;
        this._desklet._onHddTempChanged();
      }
   },

   _isPackageInstall: function(packageName) {
      return this._system.isPackageInstall(packageName);      
   }
};

// routines for handling of udisks2
const UDisks = {
    // Poor man's async.js
    __async_map: function(arr, mapClb /* function(in, successClb)) */, resClb /* function(result) */) {
        let counter = arr.length;
        let result = [];
        for(let i = 0; i < arr.length; ++i) {
            mapClb(arr[i], (function(i, newVal) {
                result[i] = newVal;
                if (--counter == 0) resClb(result);
            }).bind(null, i)); // i needs to be bound since it will be changed during the next iteration
        }
    },

    // creates a list of sensor objects from the list of proxies given
    create_list_from_proxies: function(proxies) {
        return proxies.filter(function(proxy) {
            // 0K means no data available
            return proxy.ata.SmartTemperature > 0;
        }).map(function(proxy) {
            return {
                label: proxy.drive.Model,
                size: proxy.drive.Size,
                media: proxy.drive.Media,
                temp: proxy.ata.SmartTemperature - 272.15
            };
        });
    },

    // calls callback with [{ drive: UDisksDriveProxy, ata: UDisksDriveAtaProxy }, ... ] for every drive that implements both interfaces
    get_drive_ata_proxies: function(callback) {
        Gio.DBusObjectManagerClient.new(Gio.DBus.system, 0, "org.freedesktop.UDisks2", "/org/freedesktop/UDisks2", null, null, function(src, res) {
        //Gio.DBusObjectManagerClient.new_for_bus(Gio.BusType.SYSTEM, 0, "org.freedesktop.UDisks2", "/org/freedesktop/UDisks2", null, null, function(src, res) {
            try {
                let objMgr = Gio.DBusObjectManagerClient.new_finish(res); //might throw

                let objPaths = objMgr.get_objects().filter(function(o) {
                    return o.get_interface("org.freedesktop.UDisks2.Drive") != null
                        && o.get_interface("org.freedesktop.UDisks2.Drive.Ata") != null;
                }).map(function(o) { return o.get_object_path() });
                // now create the proxy objects, log and ignore every failure
                UDisks.__async_map(objPaths, function(obj, callback) {
                    // create the proxies object
                    let driveProxy = new UDisksDriveProxy(Gio.DBus.system, "org.freedesktop.UDisks2", obj, function(res, error) {
                        if (error) { //very unlikely - we even checked the interfaces before!
                            log("Could not create proxy on "+obj+":"+error);
                            callback(null);
                            return;
                        }
                        let ataProxy = new UDisksDriveAtaProxy(Gio.DBus.system, "org.freedesktop.UDisks2", obj, function(res, error) {
                            if (error) {
                                callback(null);
                                return;
                            }

                            callback({ drive: driveProxy, ata: ataProxy });
                        });
                    });
                }, function(proxies) {
                    // filter out failed attempts == null values
                    callback(proxies.filter(function(a) { return a != null; }));
                });
            } catch (e) {
                log("Could not find UDisks objects: " + e.message);
            }
        });
    }
};

//defclasss
function HDDTempProxy() {
   this._init();
}

HDDTempProxy.prototype = {

   _init: function() {
      this.udisksProxies = [];
      this._start_connection();
   },

   _start_connection: function() {
      UDisks.get_drive_ata_proxies((function(proxies) {
         this.udisksProxies = proxies;
      }).bind(this));
   },

   get_temp_info: function() {
      let tempInfo = Array();
      tempInfo = tempInfo.concat(UDisks.create_list_from_proxies(this.udisksProxies));
      tempInfo.sort(function(a,b) { return a['label'].localeCompare(b['label']) });
      return tempInfo;
   },

    _update_data: function() {
       let list = this.get_temp_info();
       if(list.length > 0) {
          for(let i in list) {
              Main.notify("" + list[i]['label'] + "> " + list[i]['size'] + ":>: " + list[i]['media'] + " :: " + list[i]['temp']);
          }
       }
       return list;
    },

    _query_sensors: function(stop) {
       if(this._hdd_timeout) {
          Mainloop.source_remove(this._hdd_timeout);
          this._hdd_timeout = null;
       }
       if(!stop) {
          this._update_data();
          this._hdd_timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._query_sensors));
       }
    }
};

function System(uuid) {
   this._init(uuid);
}

System.prototype = {

   _init: function(_uuid) {
      this.uuid = _uuid;
      //this.lang = _lang;
      this._initInstaller();
      this._initChecker();
      this._timeout = -1;
      this._commadReading = new Array();
   },

   createHDDTempProxy: function() {
     if(!this._hddtemp)
        this._hddtemp = new HDDTempProxy();
     return this._hddtemp;
   },

   _initInstaller: function()  {
      this._installer = new Array();
      this._installer["apt-get"] = new Array();
      this._installer["apt-get"]["installerSyntax"] = "apt-get install -y $package$";
      this._installer["yum"] = new Array();
      this._installer["yum"]["installerSyntax"] = "yum -y install  $package$";
      this._installer["zypper"] = new Array();
      this._installer["zypper"]["installerSyntax"] = "zypper --non-interactive install $package$";
      this._installer["pacman"] = new Array();
      this._installer["pacman"]["installerSyntax"] = "pacman --noconfirm --noprogressbar -Sy $package$";
      this._installer["emerge"] = new Array();
      this._installer["emerge"]["installerSyntax"] = "emerge -u $package$";
      this._installer["pkg_add"] = new Array();
      this._installer["pkg_add"]["installerSyntax"] = "pkg_add -r $package$";//Default isn't interactive.
      this._installer["pkgadd"] = new Array();
      this._installer["pkgadd"]["installerSyntax"] = "pkgadd -n $package$";//Solaris
      this._installer["urpmi"] = new Array();
      this._installer["urpmi"]["installerSyntax"] = "urpmi $package$";//Mandrivia
      //slackpkg install pkg //slapt-get --install pkg //netpkg pkg  //equo install pkg
      //conary update pkg //pisi install pkg  //smart install pkg  //pkcon install pkg
      //lin pkg //cast pkg
   },

   _initChecker: function()  {
      this._checker = new Array();
      this._checker["dpkg"] = new Array();
      this._checker["dpkg"]["checkerSyntax"] = "dpkg -s $package$";//Also dpkg -l pmount | grep ^ii
      this._checker["rpm"] = new Array();
      this._checker["rpm"]["checkerSyntax"] = "rpm -qa $package$";
      this._checker["pacman"] = new Array();
      this._checker["pacman"]["checkerSyntax"] = "pacman -Qs $package$";
      this._checker["qpkg"] = new Array();
      this._checker["qpkg"]["checkerSyntax"] = "qlist -I $package$";  //Geentoo
      this._checker["pkg_info"] = new Array();
      this._checker["pkg_info"]["checkerSyntax"] = "pkg_info -x $package$"; //bsd
      this._checker["pkginfo"] = new Array();
      this._checker["pkginfo"]["checkerSyntax"] = "pkginfo -x $package$"; //Solaris
      //slapt-get --installed //netpk list I  //equo list  //conary query //pisi list-installed
      //smart query --installed //lvu installed //gaze installed
   },

   _generateCommand: function(command, packageName)  {
      let _cmdGen = command;
      while(_cmdGen.indexOf("$package$") != -1)
         _cmdGen = _cmdGen.replace("$package$", packageName);
      return _cmdGen;
   },

   _getInstaller: function() {
      for(let _keyInstaller in this._installer) {
         if(GLib.find_program_in_path(_keyInstaller))
            return _keyInstaller;
      }
      let icon = new St.Icon({ icon_name: 'error',
                               icon_type: St.IconType.FULLCOLOR,
                               icon_size: 36 });
      Main.criticalNotify(_("Failed of Drives Manager:"), _("Can't be found appropriate installer program. The Automatic installation can't be performed."), icon);
      return null;
   },

   _getChecker: function() {
      for(let _keyChecker in this._checker) {
         if(GLib.find_program_in_path(_keyChecker))
            return _keyChecker;
      }
      let icon = new St.Icon({ icon_name: 'error',
                               icon_type: St.IconType.FULLCOLOR,
                               icon_size: 36 });
      Main.criticalNotify(_("Failed of Drives Manager:"), _("Can't be found an appropriate packages check program. The automatic installation cannot be performed."), icon);
      return null;
   },

   _readCommandLine: function() {
      let _out;
      let _cmdData = 0;
      while(_cmdData < this._commadReading.length) {
         _out = this._readFile(this._commadReading[_cmdData]["fileData"]);
         if(_out) {
            if(this._commadReading[_cmdData]["print"]) {
               this._deleteFile(this._commadReading[_cmdData]["fileData"]);
               this._commadReading[_cmdData]["callBackFunction"](_out);
               this._commadReading.splice(_cmdData, 1);
            } else {
               this._commadReading[_cmdData]["print"] = true;
               _cmdData = _cmdData + 1;
            }
         }
         else
            _cmdData = _cmdData + 1;
      }
      if(this._commadReading.length)
         this._timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._readCommandLine));
      else
         this._timeout = -1;
   },

   _trySpawnAsync: function(argv) {
      try {   
         GLib.spawn_async(null, argv, null,
            GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.STDOUT_TO_DEV_NULL  | GLib.SpawnFlags.STDERR_TO_DEV_NULL,
            null, null);
      } catch (err) {
         if (err.code == GLib.SpawnError.G_SPAWN_ERROR_NOENT) {
            err.message = _("Command not found.");
         } else {
            // The exception from gjs contains an error string like:
            //   Error invoking GLib.spawn_command_line_async: Failed to
            //   execute child process "foo" (No such file or directory)
            // We are only interested in the part in the parentheses. (And
            // we can't pattern match the text, since it gets localized.)
            err.message = err.message.replace(/.*\((.+)\)/, '$1');
         }
         throw err;
      }
   },

   _trySpawnSync: function(argv) {//Not working
      try {           
         let _result = GLib.spawn_sync(null, argv, null,
            GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.STDOUT_TO_DEV_NULL  | GLib.SpawnFlags.STDERR_TO_DEV_NULL,
            null, null);
         //Main.notifyError(_("Error:") + _result[0] + " " + _result[1] + " " + _result[2] + " " + _result[3]); 
         return _result;
      } catch (err) {
         if (err.code == GLib.SpawnError.G_SPAWN_ERROR_NOENT) {
            err.message = _("Command not found.");
         } else {
            // The exception from gjs contains an error string like:
            //   Error invoking GLib.spawn_command_line_async: Failed to
            //   execute child process "foo" (No such file or directory)
            // We are only interested in the part in the parentheses. (And
            // we can't pattern match the text, since it gets localized.)
            err.message = err.message.replace(/.*\((.+)\)/, '$1');
         }
         throw err;
      }
   },

   _trySpawnAsyncPipe: function(command, callback) {
      try {
         let [success, argv] = GLib.shell_parse_argv("sh -c '" + command + "'");
         if(success) {
            this._callbackPipe = callback;
            this._commandPipe = command;
            let [exit, pid, stdin, stdout, stderr] =
                 GLib.spawn_async_with_pipes(null, /* cwd */
                                          argv, /* args */
                                          null, /* env */
                                          GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD, /*Use env path and no repet*/
                                          null /* child_setup */);

            this._childPid = pid;
            this._stdin = new Gio.UnixOutputStream({ fd: stdin, close_fd: true });
            this._stdout = new Gio.UnixInputStream({ fd: stdout, close_fd: true });
            this._stderr = new Gio.UnixInputStream({ fd: stderr, close_fd: true });
         
            // We need this one too, even if don't actually care of what the process
            // has to say on stderr, because otherwise the fd opened by g_spawn_async_with_pipes
            // is kept open indefinitely
            this._stderrStream = new Gio.DataInputStream({ base_stream: this._stderr });
            this._dataStdout = new Gio.DataInputStream({ base_stream: this._stdout });

            this._readStdout();

            this._childWatch = GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, Lang.bind(this, function(pid, status, requestObj) {
               GLib.source_remove(this._childWatch);
               this._stdin.close(null);
            }));
         }
         //throw
      } catch(err) {
         if (err.code == GLib.SpawnError.G_SPAWN_ERROR_NOENT) {
            err.message = _("Command not found.");
         } else {
            // The exception from gjs contains an error string like:
            //   Error invoking GLib.spawn_command_line_async: Failed to
            //   execute child process "foo" (No such file or directory)
            // We are only interested in the part in the parentheses. (And
            // we can't pattern match the text, since it gets localized.)
            err.message = err.message.replace(/.*\((.+)\)/, '$1');
         }
         throw err;
      }
   },

   _readStdout: function() {
      this._dataStdout.fill_async(-1, GLib.PRIORITY_DEFAULT, null, Lang.bind(this, function(stream, result) {
         if(this._dataStdout.fill_finish(result) == 0) { // end of file
            try {
               let val = stream.peek_buffer().toString();
               if(val != "")
                  this._callbackPipe(this._commandPipe, true, val);
            } catch(e) {
               global.log(e.toString());
            }
            this._stdout.close(null);
            return;
         }

         // Try to read more
         this._dataStdout.set_buffer_size(2 * this._dataStdout.get_buffer_size());
         this._readStdout();
      }));

      this._stderrStream.fill_async(-1, GLib.PRIORITY_DEFAULT, null, Lang.bind(this, function(stream, result) {
         if(this._stderrStream.fill_finish(result) == 0) { // end of file
            try {
               let val = stream.peek_buffer().toString();
               if(val != "")
                  this._callbackPipe(this._commandPipe, false, val);
            } catch(e) {
               global.log(e.toString());
            }
            this._stderr.close(null);
            return;
         }

         // Try to read more
         this._stderrStream.set_buffer_size(2 * this._stderrStream.get_buffer_size());
         this._readStdout();
      }));
   },

   destroy: function() {
   },

   findDistroName: function() {
      if(GLib.find_program_in_path('lsb_release')) {
         let [res, out, err, status] = this.execCommandSync('lsb_release -a');
         let _lines = out.toString().split("\n");
         let _pos = 0;
         for(let _currLine in _lines) {
            _pos = _lines[_currLine].indexOf("Distributor ID");
            if(_pos != -1)
               return _lines[_currLine].substring(16, _lines[_currLine].length);
         }
      }
      return "Default";
   },

   readFile: function(path) {
      //GLib.file_get_contents(path).toString();
      try {
         let file = Gio.file_new_for_path(path);
         if(file.query_exists(null))
         {
            let fstream = file.read(null);
            let dstream = new Gio.DataInputStream({ base_stream: fstream });
            let data = dstream.read_until("", null);
            fstream.close(null);
            return data.toString();
         }
      } catch(e) {
         Main.notifyError(_("Error:"), e.message);
      }
      return null;
   },

   fileExists: function(path) {
      return Gio.file_new_for_path(path).query_exists(null);
   },

   path: function() {
      return GLib.get_home_dir() + "/.local/share/cinnamon/desklets/" + this.uuid + "/";
   },

   deleteFile: function(path) {
      return Gio.file_new_for_path(path).delete(null);
   },

   isDirectory: function(fDir) {
      try {
         let info = fDir.query_filesystem_info("standard::type", null);
         if((info)&&(info.get_file_type() != Gio.FileType.DIRECTORY))
            return true;
      } catch(e) {
      }
      return false;
   },

   makeDirectoy: function(fDir) {
      if(!this.isDirectory(fDir))
         this.makeDirectoy(fDir.get_parent());
      if(!this.isDirectory(fDir))
         fDir.make_directory(null);
   },


   getFileSize: function(path) {
      if(this.fileExists(path)) {
         let _attribute = "filesystem::size";
         try {
            let _file = Gio.file_new_for_path(path);
            return _file.query_filesystem_info(_attribute, null).get_attribute_uint64(_attribute);
         } catch(e) {
            return 0;
         }
      }
      return 0;
   },

   equalsFile: function(path1, path2) {
      let fSize1 = this.getFileSize(path1);
      let fSize2 = this.getFileSize(path2);
      return ((fSize1 != 0)&&(fSize1 == fSize2));
   },

   writeComandLine: function(command, callBackFunction) {
      this._writeFileComandLine(command, new Date().getTime(), callBackFunction);
   },

   writeFileComandLine: function(command, fileName, callBackFunction) {
      try {
         let _pathFile = this._path() + fileName;
         let _inProcess = false;
         for(let cmdData in this._commadReadingfileName) {
            if(this._commadReadingfileName[cmdData]["fileData"] == _pathFile) {
               _inProcess = true;
               break;
            }
         }
         if(!_inProcess) {
            this.execCommand("sh -c '" + command + " > " + _pathFile + "'");
            let _cmdData = new Array();
            _cmdData["callBackFunction"] = callBackFunction;
            _cmdData["fileData"] = _pathFile;
            _cmdData["print"] = false;
            this._commadReading.push(_cmdData);
            if(this._timeout <= 0)
               this._readCommandLine();
         }
      } catch(e) {
         Main.notifyError(_("Error:"), e.message);
      }
   },

   execInstallLanguage: function() {
      try {
         let _shareFolder = GLib.get_home_dir() + "/.local/share/";
         let _localeFolder = Gio.file_new_for_path(_shareFolder + "locale/");
         let _moFolder = Gio.file_new_for_path(_shareFolder + "cinnamon/desklets/" + this.uuid + "/locale/mo/");
         let children = _moFolder.enumerate_children('standard::name,standard::type,time::modified',
                                                     Gio.FileQueryInfoFlags.NONE, null);
                     
         let info, child, _moFile, _moLocale, _moPath, _src, _dest, _modified, _destModified;
         while((info = children.next_file(null)) != null) {
            let _modified = info.get_modification_time().tv_sec;
            if(info.get_file_type() == Gio.FileType.REGULAR) {
               _moFile = info.get_name();
               if(_moFile.substring(_moFile.lastIndexOf(".")) == ".mo") {
                  _moLocale = _moFile.substring(0, _moFile.lastIndexOf("."));
                  _moPath = _localeFolder.get_path() + "/" + _moLocale + "/LC_MESSAGES/";
                  _src = Gio.file_new_for_path(String(_moFolder.get_path() + "/" + _moFile));
                  _dest = Gio.file_new_for_path(String(_moPath + this.uuid + ".mo"));
                  try {
                     if(_dest.query_exists(null)) {
                        _destModified = _dest.query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null).get_modification_time().tv_sec;
                        if(_modified > _destModified) {
                           _src.copy(_dest, Gio.FileCopyFlags.OVERWRITE, null, null);
                        }
                     } else {
                         this.makeDirectoy(_dest.get_parent());
                         _src.copy(_dest, Gio.FileCopyFlags.OVERWRITE, null, null);
                     }
                  } catch(e) {
                     Main.notify(_("Error:"), e.message);
                  }
               }
            }
         }
      } catch(e) {
         Main.notify(_("Error:"), e.message);
         global.logError(e);
      }
   },

   execCommandAsRoot: function(command) {
      if(GLib.find_program_in_path("pkexec")) {
         return this.execCommand("sh -c 'pkexec sh -c \"" + command + "\"'");
      }
      else if(GLib.find_program_in_path("gksu")) {
         return this.execCommand("gksu \"sh -c '" + command + "'\"");
      }
      else if(GLib.find_program_in_path("kdesu")) {
         return this.execCommand("kdesu -c \"sh -c '" + command + "'\"");
      }
      else {
         let icon = new St.Icon({ icon_name: 'error',
                                  icon_type: St.IconType.FULLCOLOR,
                                  icon_size: 36 });
         Main.criticalNotify(_("Failed of Drives Manager:"), _("You don't have any GUI program to get root permissions."), icon);
      }
      return false;
   },

   execCommand: function(command) {
      try {
         let [success, argv] = GLib.shell_parse_argv(command);
         this._trySpawnAsync(argv);
         return true;
      } catch (e) {
         let title = _("Execution of '%s' failed:").format(command);
         Main.notifyError(title, e.message);
      }
      return false;
   },

   execCommandSync: function(command) {
      try {
         /*let [success, argv] = GLib.shell_parse_argv(command);
         return this._trySpawnSync(argv);*/
         return GLib.spawn_command_line_sync(command);
      } catch (e) {
         let title = _("Execution of '%s' failed:").format(command);
         Main.notifyError(title, e.message);
      }
      return null;
   },

   execCommandSyncPipe: function(command, callBackFunction) {
      try {
         this._trySpawnAsyncPipe(command, callBackFunction);
      } catch (e) {
         let title = _("Execution of '%s' failed:").format(command);
         Main.notifyError(title, e.message);
      }
   },

   execInstall: function(packageName) {
      let _bestInstaller = this._getInstaller();
      if(_bestInstaller) {
         let _cmd = this._generateCommand(this._installer[_bestInstaller]["installerSyntax"], packageName);
         Main.notifyError(_cmd);
         return this.execCommandAsRoot(_cmd);
      }
      return false;
   },

   execChmod: function(folder, permissions) {
      let _cmd = "chown root:root \"" + folder +"\" && chmod " + permissions + " \""+ folder+"\"";
      Main.notifyError(_cmd);
      return this.execCommandAsRoot(_cmd);
   },

   isProgramInstall: function(programName) {
      return (GLib.find_program_in_path(programName) != null);
   },

   pathToProgram: function(programName) {
      return GLib.find_program_in_path(programName);
   },

   isPackageInstall: function(packageName) {
      let _bestChecker = this._getChecker();
      if(_bestChecker) {
         let _cmd = this._generateCommand(this._checker[_bestChecker]["checkerSyntax"], packageName);
         let [res, out, err, status] = this.execCommandSync(_cmd);
         //Main.notifyError(_("Error:") + err.toString() + " status:" + status.toString() + " res: " + res.toString());
         if((!status)&&(out.toString().indexOf(packageName) != -1))
            return true;
      }
      return false;      
   },

   havePermission: function(folder, permissionNeeded) {
      let [res, out, err, status] = this.execCommandSync('ls -l ' + folder);
      let out_lines = out.toString().split(" ");
      return out_lines[0] == permissionNeeded;
   },


   print_device: function(device) {
      //if(device.get_name() == "sda") {
         let info = "";
         info = info + "initialized:            " + device.get_is_initialized() + "\n";
         info = info + "usec since initialized: " + device.get_usec_since_initialized() + "\n";
         info = info + "subsystem:              " + device.get_subsystem() + "\n";
         info = info + "devtype:                " + device.get_devtype() + "\n";
         info = info + "name:                   " + device.get_name() + "\n";
         info = info + "number:                 " + device.get_number() + "\n";
         info = info + "sysfs_path:             " + device.get_sysfs_path() + "\n";
         info = info + "driver:                 " + device.get_driver() + "\n";
         info = info + "action:                 " + device.get_action() + "\n";
         info = info + "seqnum:                 " + device.get_seqnum() + "\n";
         info = info + "device type:            " + device.get_device_type() + "\n";
         info = info + "device number:          " + device.get_device_number() + "\n";
         info = info + "device file:            " + device.get_device_file() + "\n";
         info = info + "device file symlinks:   " + device.get_device_file_symlinks() + "\n";
         info = info + "tags:                   " + device.get_tags() + "\n";
         let keys = device.get_property_keys();
         for(let n = 0; n < keys.length; n++) {
            info = info + "    " + keys[n] + "=" + device.get_property(keys[n]) + "\n";
         }
         this.write_to_file(info, device.get_subsystem(), device.get_name());
    //  }
   },
        
   write_to_file: function (text_line, folderName, fileName) {
      try {
         let output_file = Gio.file_new_for_path(GLib.get_home_dir() + "/.local/share/cinnamon/desklets/drivesManager@lestcape/txt/" + folderName + "/" + fileName + ".txt");
         this.makeDirectoy(output_file.get_parent());
         let fstream = output_file.replace("", false, Gio.FileCreateFlags.NONE, null);
         let dstream = new Gio.DataOutputStream({ base_stream: fstream });   

         dstream.put_string(text_line, null);
         fstream.close(null);
      } catch(e) {
         Main.notifyError(_("Failed of Drives Manager:"), e.message);
      }
   },

   print_all_device: function() {
      try {
         let client = new GUdev.Client({subsystems: ["Drive.Ata"]});
         let enumerator = new GUdev.Enumerator({client: client});
         enumerator.add_match_subsystem('*');

         let devices = enumerator.execute();

         for(let n=0; n < devices.length; n++) {
            let device = devices[n];
            this.print_device(device);
         }
      } catch(e) {
         Main.notifyError(_("Failed of Drives Manager:"), e.message);
      }
   }

};
