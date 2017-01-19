
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

const Clutter = imports.gi.Clutter;

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Gtk = imports.gi.Gtk;
const Cinnamon = imports.gi.Cinnamon;
const GUdev = imports.gi.GUdev;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;
const Gettext = imports.gettext;

const AppletManager = imports.ui.appletManager;
const DeskletManager = imports.ui.deskletManager;
const Extension = imports.ui.extension;
const Applet = imports.ui.applet;
const Desklet = imports.ui.desklet;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const Tweener = imports.ui.tweener;
const CinnamonMountOperation = imports.ui.cinnamonMountOperation;
const Main = imports.ui.main;
const Util = imports.misc.util;
const ScreenSaver = imports.misc.screenSaver;
const Params = imports.misc.params;


/****Import File****/
//const AppletDir = AppletManager.applets['drivesManager@lestcape'];
const DeskletDir = DeskletManager.desklets['drivesManager@lestcape'];
//const Translate = DeskletDir.translate;
const SystemClass = DeskletDir.system;
/****Import File****/

function ExtensionExtended(dir, type) {
   this._init(dir, type);
}

ExtensionExtended.prototype = {
   __proto__: Extension.Extension.prototype,
   _init: function(dir, type) {
      this.uuid = dir.get_basename();
      this.dir = dir;
      this.type = type;
      this.lowerType = type.name.toLowerCase();
      this.theme = null;
      this.stylesheet = null;
      this.meta = Extension.createMetaDummy(this.uuid, dir.get_path(), Extension.State.INITIALIZING);
      this.startTime = new Date().getTime();

      this.loadMetaData(dir.get_child('metadata.json'));
      this.validateMetaData();

      this.ensureFileExists(dir.get_child(this.lowerType + '.js'));
      this.loadStylesheet(dir.get_child('stylesheet.css'));
        
      if(this.stylesheet) {
         Main.themeManager.connect('theme-set', Lang.bind(this, function() {
            this.loadStylesheet(this.dir.get_child('stylesheet.css'));
         }));
      }

      try {
         if(global.add_extension_importer)
            global.add_extension_importer('imports.ui.extension.importObjects', this.uuid, this.meta.path);
         else {
            imports.gi.CinnamonJS.add_extension_importer('imports.ui.extension.importObjects', this.uuid, this.meta.path);
         }
      } catch (e) {
         throw this.logError('Error importing extension ' + this.uuid + ' from path ' + this.meta.path, e);
      }

      try {
         this.module = Extension.importObjects[this.uuid][this.lowerType]; // get [extension/applet/desklet].js
      } catch (e) {
         throw this.logError('Error importing ' + this.lowerType + '.js from ' + this.uuid, e);
      }

      for(let i = 0; i < this.type.requiredFunctions.length; i++) {
         let func = this.type.requiredFunctions[i];
         if(!this.module[func]) {
            throw this.logError('Function "' + func + '" is missing');
         }
      }
      //objects[this.uuid] = this;
   }
};

function DeskletAppletManager(desklet) {
    this._init(desklet);
}

DeskletAppletManager.prototype = {
   _init: function(desklet) {
      this.desklet = desklet;
      this.applet = null;
   },

   createAppletInstance: function() {
      if(!this.applet) {
         try {
            global.settings.connect('changed::enabled-applets', Lang.bind(this, this._onEnabledAppletsChanged));
            let uuid = this.desklet.metadata["uuid"];
            let dir = Gio.file_new_for_path(GLib.get_home_dir() + "/.local/share/cinnamon/desklets/"+uuid);
            let extCreate = new ExtensionExtended(dir, Extension.Type.APPLET);
            let newAppletID = global.settings.get_int("next-applet-id");
            global.settings.set_int("next-applet-id", newAppletID + 1);
            let appletDef = ('%s:%s:%s').format(this.desklet._appletManagerOrder, uuid, newAppletID);
            let appletDefinition = AppletManager.getAppletDefinition(appletDef);
            AppletManager.addAppletToPanels(extCreate, appletDefinition);
            this.applet = AppletManager.appletObj[newAppletID];
            this.applet.setParentDesklet(this.desklet);
         } catch (e) {
            Main.notifyError(_("Failed of Drives Manager:"), e.message);
         }
      }
   },

   _onEnabledAppletsChanged: function() {
      if(this.applet) {
         let pName = this.applet._panelLocation.get_name();
         let zone_string = this.applet._panelLocation.get_name().substring(5, pName.length).toLowerCase();
         let panel_string = "panel1";
         if((Main.panel2)&&(Main.panel2["_"+zone_string+"Box"] == this.applet._panelLocation))
            panel_string = "panel2";
         this.desklet._appletManagerOrder = panel_string+":"+zone_string+":"+this.applet._order;
      }
   },

   destroyAppletInstance: function() {
      if(this.applet) {
         try {
            try {
               this.applet._onAppletRemovedFromPanel();
            } catch (e) {
               global.logError("Error during on_applet_removed_from_panel() call on applet: " + this.applet._uuid + "/" + this.applet.instance_id, e);
            }
            if(this.applet._panelLocation != null) {
               this.applet._panelLocation.remove_actor(this.applet.actor);
               this.applet._panelLocation = null;
            }
            delete this.applet._extension._loadedDefinitions[this.applet.instance_id];
            delete AppletManager.appletObj[this.applet.instance_id];
            this.applet = null; 
         } catch (e) {
            Main.notifyError(_("Failed of Drives Manager:"), e.message);
         }
      }
   }
};

function RaisedBox() {
   this._init();
}

RaisedBox.prototype = {
   _init: function() {
      try {
         this.stageEventIds = [];
         this.contextMenuEvents = [];
         this.actor = new St.Group({ visible: false, x: 0, y: 0 });
         Main.uiGroup.add_actor(this.actor);
         let constraint = new Clutter.BindConstraint({ source: global.stage,
                                                       coordinate: Clutter.BindCoordinate.POSITION | Clutter.BindCoordinate.SIZE });
         this.actor.add_constraint(constraint);
         this._backgroundBin = new St.Bin();
         this.actor.add_actor(this._backgroundBin);
         let monitor = Main.layoutManager.focusMonitor;
         this._backgroundBin.set_position(monitor.x, monitor.y);
         this._backgroundBin.set_size(monitor.width, monitor.height);
         let stack = new Cinnamon.Stack();
         this._backgroundBin.child = stack;
         this.eventBlocker = new Clutter.Group({ reactive: true });
         stack.add_actor(this.eventBlocker);
         this.groupContent = new St.Bin();
         stack.add_actor(this.groupContent);
      } catch(e) {
         Main.notify("err", e.message);
         global.logError(e);
      }
   },

   add: function(desklet) {
      try {
         this.desklet = desklet;
         this.contextMenu = this.desklet._menu;
         this.groupContent.add_actor(this.desklet.actor);
         if(!this.desklet._raiseCenter) {
            let allocation = Cinnamon.util_get_transformed_allocation(desklet.actor);
            let monitor = Main.layoutManager.findMonitorForActor(desklet.actor);
            let x = Math.floor((monitor.width - allocation.x1 - allocation.x2) / 2);
            let y = Math.floor((monitor.height - allocation.y1 - allocation.y2) / 2);
            this.actor.set_anchor_point(x,y);
         }
         Main.pushModal(this.actor);
         this.actor.show();
         this.stageEventIds.push(global.stage.connect("captured-event", Lang.bind(this, this.onStageEvent)));
         this.stageEventIds.push(global.stage.connect("enter-event", Lang.bind(this, this.onStageEvent)));
         this.stageEventIds.push(global.stage.connect("leave-event", Lang.bind(this, this.onStageEvent)));
         this.contextMenuEvents.push(this.contextMenu.connect("activate", Lang.bind(this, function() {
            this.emit("closed");
         })));
      } catch(e) {
         Main.notify("err", e.message);
         global.logError(e);
      }
   },

   remove: function() {
      try {
         for ( let i = 0; i < this.stageEventIds.length; i++ ) global.stage.disconnect(this.stageEventIds[i]);
         for ( let i = 0; i < this.contextMenuEvents.length; i++ ) this.contextMenu.disconnect(this.contextMenuEvents[i]);
         if ( this.desklet ) this.groupContent.remove_actor(this.desklet.actor);
         Main.popModal(this.actor);
         this.actor.destroy();
      } catch(e) {
         global.logError(e);
      }
   },
   onStageEvent: function(actor, event) {
      try {
         let type = event.type();
         if ( type == Clutter.EventType.KEY_PRESS ) return true;
         if ( type == Clutter.EventType.KEY_RELEASE ) {
            if ( event.get_key_symbol() == Clutter.KEY_Escape ) this.emit("closed");
            return true;
         }
         let target = event.get_source();
         if ( target == this.desklet.actor || this.desklet.actor.contains(target) ||
            target == this.contextMenu.actor || this.contextMenu.actor.contains(target) ) return false;
         if ( type == Clutter.EventType.BUTTON_RELEASE ) this.emit("closed");
      } catch(e) {
         global.logError(e);
      }
      return true;
   }
}
Signals.addSignalMethods(RaisedBox.prototype);

function ScrollItemsBox(parent, panelToScroll, vertical, align) {
   this._init(parent, panelToScroll, vertical, align);
}

ScrollItemsBox.prototype = {
   _init: function(parent, panelToScroll, vertical, align) {
      this.parent = parent;
      this.idSignalAlloc = 0;
      this._timeOutScroll = 0;
      this.panelToScroll = panelToScroll;
      this.vertical = vertical;
      this.actor = new St.BoxLayout({ vertical: this.vertical });
      this.panelWrapper = new St.BoxLayout({ vertical: this.vertical });
      this.panelWrapper.add(this.panelToScroll, { x_fill: true, y_fill: false, x_align: align, y_align: St.Align.START, expand: true });

      this.scroll = this._createScroll(this.vertical);
      this.scroll.add_actor(this.panelWrapper);

      this.actor.add(this.scroll, { x_fill: true, y_fill: true, expand: true });
   },

   _createScroll: function(vertical) {
      let scrollBox;
      if(vertical) {
         scrollBox = new St.ScrollView({ x_fill: true, y_fill: false, y_align: St.Align.START, style_class: 'vfade menu-applications-scrollbox' });
         scrollBox.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
         let vscroll = scrollBox.get_vscroll_bar();
         vscroll.connect('scroll-start',
                          Lang.bind(this, function() {
                          if(this.parent.menu)
                             this.parent.menu.passEvents = true;
                       }));
         vscroll.connect('scroll-stop',
                          Lang.bind(this, function() {
                          if(this.parent.menu)
                             this.parent.menu.passEvents = false;
                       }));
      } else {
         scrollBox = new St.ScrollView({ x_fill: false, y_fill: true, x_align: St.Align.START, style_class: 'hfade menu-applications-scrollbox' });
         scrollBox.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.NEVER);
         let hscroll = scrollBox.get_hscroll_bar();
         hscroll.connect('scroll-start',
                          Lang.bind(this, function() {
                          if(this.parent.menu)
                             this.parent.menu.passEvents = true;
                       }));
         hscroll.connect('scroll-stop',
                          Lang.bind(this, function() {
                          if(this.parent.menu)
                             this.parent.menu.passEvents = false;
                       }));
      }
      return scrollBox;
   },

   _onAllocationChanged: function(actor, event) {
      if(this.visible) {
         let w = this.panelToScroll.get_allocation_box().x2-this.panelToScroll.get_allocation_box().x1
         if((!this.vertical)&&(this.actor.get_width() > w - 10)) {
            this.scroll.get_hscroll_bar().visible = false;
         } else {
            this.scroll.get_hscroll_bar().visible = true;
         }
      }   
   },

//horizontalcode
   _setHorizontalAutoScroll: function(hScroll, setValue) {
      if(hScroll) {
         let childrens = hScroll.get_children();
         if((childrens)&&(childrens[0])&&(!childrens[0].get_vertical())) {
            if(!this.hScrollSignals)
               this.hScrollSignals = new Array();
            let hScrollSignal = this.hScrollSignals[hScroll];
            if(((!hScrollSignal)||(hScrollSignal == 0))&&(setValue)) {
               this.hScrollSignals[hScroll] = hScroll.connect('motion-event', Lang.bind(this, this._onMotionEvent));
            }
            else if((hScrollSignal)&&(hScrollSignal > 0)&&(!setValue)) {
               this.hScrollSignals[hScroll] = null;
               hScroll.disconnect(hScrollSignal);
            }
         }
      }
   },

   _onMotionEvent: function(actor, event) {
      this.hScroll = actor;
      let dMin = 10;
      let dMax = 50;
      let [mx, my] = event.get_coords();
      let [ax, ay] = this.hScroll.get_transformed_position();
      let [ah, aw] = [this.hScroll.get_height(), this.hScroll.get_width()];
      if((my < ay + ah)&&(my > ay)&&((mx < ax + dMin)&&(mx > ax - dMax))||
         ((mx > ax + aw - dMin)&&(mx < ax + aw + dMax)))
         this._doHorizontalScroll();
   },

   _doHorizontalScroll: function() {
      if(this._timeOutScroll > 0)
         Mainloop.source_remove(this._timeOutScroll);
      this._timeOutScroll = 0;
      if((this.hScrollSignals)&&(this.hScrollSignals[this.hScroll] > 0)) {
         let dMin = 10;
         let dMax = 50;
         let speed = 1;
         let [mx, my, mask] = global.get_pointer();
         let [ax, ay] = this.hScroll.get_transformed_position();
         let [ah, aw] = [this.hScroll.get_height(), this.hScroll.get_width()];
         if((my < ay + ah)&&(my > ay)) {
            if((mx < ax + dMin)&&(mx > ax - dMax)) {
               if(ax > mx)
                  speed = 20*speed*(ax - mx)/dMax;
               let val = this.hScroll.get_hscroll_bar().get_adjustment().get_value();
               this.hScroll.get_hscroll_bar().get_adjustment().set_value(val - speed);
               this._timeOutScroll = Mainloop.timeout_add(100, Lang.bind(this, this._doHorizontalScroll));
            }
            else if((mx > ax + aw - dMin)&&(mx < ax + aw + dMax)) {
               if(ax + aw < mx)
                  speed = 20*speed*(mx - ax - aw)/dMax;
               let val = this.hScroll.get_hscroll_bar().get_adjustment().get_value();
               this.hScroll.get_hscroll_bar().get_adjustment().set_value(val + speed);
               this._timeOutScroll = Mainloop.timeout_add(100, Lang.bind(this, this._doHorizontalScroll));
            }
         }
      }
   },
//horizontalcode
   setParent: function(parent) {
      this.parent = parent;
   },

   setAutoScrolling: function(autoScroll) {
      if(this.vertical)
         this.scroll.set_auto_scrolling(autoScroll);
      else
         this._setHorizontalAutoScroll(this.scroll, autoScroll);
   },

   setScrollVisible: function(visible) {
      this.visible = visible;
      if(this.vertical)
         this.scroll.get_vscroll_bar().visible = visible;
      else {
         if((visible)&&(this.idSignalAlloc == 0))
            this.idSignalAlloc = this.actor.connect('allocation_changed', Lang.bind(this, this._onAllocationChanged));
         else if(this.idSignalAlloc > 0) {
            this.actor.disconnect(this.idSignalAlloc);
            this.idSignalAlloc = 0;
         }
         this.scroll.get_hscroll_bar().visible = visible;
      }
   },

   scrollToActor: function(actor) {
      try {
         if(actor) {
            if(this.vertical) {
               var current_scroll_value = this.scroll.get_vscroll_bar().get_adjustment().get_value();
               var box_height = this.actor.get_allocation_box().y2-this.actor.get_allocation_box().y1;
               var new_scroll_value = current_scroll_value;
               let hActor = this._getAllocationActor(actor, 0);
               if (current_scroll_value > hActor-10) new_scroll_value = hActor-10;
               if (box_height+current_scroll_value < hActor + actor.get_height()+10) new_scroll_value = hActor + actor.get_height()-box_height+10;
               if (new_scroll_value!=current_scroll_value) this.scroll.get_vscroll_bar().get_adjustment().set_value(new_scroll_value);
               // Main.notify("finish" + new_scroll_value);
            } else {
               var current_scroll_value = this.scroll.get_hscroll_bar().get_adjustment().get_value();
               var box_width = this.actor.get_allocation_box().x2-this.actor.get_allocation_box().x1;
               var new_scroll_value = current_scroll_value;
               if (current_scroll_value > actor.get_allocation_box().x1-10) new_scroll_value = actor.get_allocation_box().x1-10;
               if (box_width+current_scroll_value < actor.get_allocation_box().x2+40) new_scroll_value = actor.get_allocation_box().x2-box_width+40;
               if (new_scroll_value!=current_scroll_value) this.scroll.get_hscroll_bar().get_adjustment().set_value(new_scroll_value);
            }
         }
      } catch(e) {
        Main.notifyError(_("Failed of Drives Manager:"), e.message);
      }
   },

   _getAllocationActor: function(actor, currHeight) {
      let actorParent = actor.get_parent();
      if((actorParent != null)&&(actorParent != this.parent)) {
         if(actorParent != this.panelToScroll) {
            return this._getAllocationActor(actorParent, currHeight + actor.get_allocation_box().y1);
         } else {
            return currHeight + actor.get_allocation_box().y1;
         }
      }
      return 0;//Some error
   }
};


function MeterBox(size) {
    this._init(size);
}

MeterBox.prototype = {
   _init: function(size) {
      this.size = size;
      this.override = false;
      this.actor = new St.BoxLayout({ vertical:false, style_class: 'drives-meter'});
      this._buildCalorPalete();
      this.boxesLed = new Array();
      let boxLed;
      for(let pos = 0; pos < this.size; pos++) {
         boxLed = new St.BoxLayout({ vertical:false, style_class: 'drives-meter-led' });
         boxLed.style = "background-color: " + this.getDefaultColorInPalet() + ";";
         this.actor.add(boxLed, { x_fill: true, y_fill: true, expand: true, x_align: St.Align.START });
         this.boxesLed.push(boxLed);
      }
   },

   overrideTheme: function(override) {
      if(override) {
         for(let pos = 0; pos < this.size; pos++) {
            this.boxesLed[pos].set_style_class_name(' ');
         }
      } else {
         for(let pos = 0; pos < this.size; pos++) {
            this.boxesLed[pos].set_style_class_name('drives-meter-led');
         }
      }
   },

   setMeterImage: function(currentValue, totalValue) {
      let actualValue = 0;
      if(totalValue > 0) {
         actualValue = Math.floor(Math.round(this.size*currentValue/totalValue));
         let oldColorPos = 0;
         for(let pos = 0; pos < actualValue; pos++) {
            this.boxesLed[pos].style = "background-color: " + this.findColorInPalet(pos) + ";";
         }
      }
      for(let pos = actualValue; pos < this.size; pos++) {
         this.boxesLed[pos].style = "background-color: " + this.getDefaultColorInPalet() + ";";
      } 
   },

   findColorInPalet: function(posCurrent) {
      let valueColor = Math.floor(Math.round(100*posCurrent/this.size));
      for(let pos = 1; pos < this.colorPalete.length; pos++) {
         if(valueColor < this.colorPalete[pos][1])
            return this.colorPalete[pos][0];
      }
      return this.getDefaultColorInPalet();
   },

   getDefaultColorInPalet: function(currentValue) {
      return this.colorPalete[0][0];
   },

   _buildCalorPalete: function(currentValue) {
      this.colorPalete = new Array();
      this.colorPalete.push(["#718397", 0]);
      this.colorPalete.push(["#009900", 33]);
      this.colorPalete.push(["#00cc00", 50]);
      this.colorPalete.push(["#00ff00", 70]);
      this.colorPalete.push(["#e4dd14", 90]);
      this.colorPalete.push(["#9a0030", 100]);
   }
};

function HDDTempMonitor(system) {
    this._init(system);
}

HDDTempMonitor.prototype = {

   _init: function(system) {
      this._system = system;
      this._active = false;
      this._criticalTemp = 45;
      this._warningTemp = 38;
      this._normalTempColor = "green";
      this._warningTempColor = "orange";
      this._criticalTempColor = "red";
      this._activeAlarm = false;
      this.deviceList = new Array();
      this._hddtempProxy = this._system.createHDDTempProxy();
      this._client = new GUdev.Client ({subsystems: ["block"]});
   },

   addDevice: function(device) {
      let deviceUdev = this._client.query_by_device_file(device);
      this.deviceList[device] = [];
      this.deviceList[device]["id"] = device;
      if(deviceUdev)
         this.deviceList[device]["label"] = deviceUdev.get_property("ID_MODEL");
      this.deviceList[device]["temp"] = "?\u00B0C";//\u00B0 = °
   },

   getDeviceTemp: function(device) {
      return this.deviceList[device]["temp"];
   },

   _hDDTempResultProxy: function(info) {
      for(let device in this.deviceList) {
         for(let pos in info) {
            if(this.deviceList[device]["label"] == info[pos]["label"].replace(' ','_')) {
               let newTemp = Math.floor(info[pos]["temp"]) + "\u00B0C";
               if(this.deviceList[device]["temp"] != newTemp) {
                 this.deviceList[device]["temp"] = newTemp;
                 this.emit('temp-changed', device, newTemp);
                 this._playSoundHddTemp(newTemp);
               }
               break;
            }
         }
      }
   },

   setWarningHddTemp: function(warningTemp) {
      this._warningTemp = warningTemp;
      this._emitAll();
   },

   setCriticalHddTemp: function(crititalTemp) {
      this._criticalTemp = crititalTemp;
      this._emitAll();
   },

   setNormalHddTempColor: function(normalColor) {
      this._normalTempColor = normalColor;
      this._emitAll();
   },

   setWarningHddTempColor: function(warningColor) {
      this._warningTempColor = warningColor;
      this._emitAll();
   },

   setCritialHddTempColor: function(criticalColor) {
      this._criticalTempColor = criticalColor;
      this._emitAll();
   },

   activeAlarm: function(alarm) {
      this._activeAlarm = alarm;
      this._emitAll();
   },

   getHddTempColor: function(tempString) {
      let _tempValue = tempString.match(new RegExp('[0-9]+', 'g'));
      if((_tempValue)&&(_tempValue[0])) {
         if(_tempValue[0] >= this._criticalTemp)
            return this._criticalTempColor;
            if(_tempValue[0] >= this._warningTemp)
               return this._warningTempColor; 
      }
      return this._normalTempColor;
   },

   _playSoundHddTemp: function(tempString) {
      if((this._active)&&(this._activeAlarm)) {
         try {
            let _tempValue = tempString.match(new RegExp('[0-9]+', 'g'));
            if((_tempValue)&&(_tempValue[0])&&(_tempValue[0] >= this._criticalTemp))
               global.play_theme_sound(0, 'suspend-error');
         } catch(e) {
            Main.notifyError(_("Failed of Drives Manager:"), e.message);
         }
      }
   },

   enableMonitor: function(active) {
      this._active = active;
      this._emitAll();
   },
 
   _emitAll: function() {
      if(this._active) {
         for(let dev in this.deviceList)
            this.emit('temp-changed', dev, this.deviceList[dev]["temp"]);
      } else {
         for(let dev in this.deviceList)
            this.emit('temp-changed', dev, null);
      }
   },

   update: function() {
      try {
         if(this._active) {
            this._hDDTempResultProxy(this._hddtempProxy.get_temp_info());
         }
      } catch(e) {
         Main.notifyError(_("Failed of Drives Manager:"), e.message);
      }
   }
};

Signals.addSignalMethods(HDDTempMonitor.prototype);

function GlobalContainer(parent, uuid, system) {
    this._init(parent, uuid, system);
}

GlobalContainer.prototype = {

   _init: function(parent, uuid, system) {
      this._uuid = uuid;
      this._sys = system;
      this._parent = parent;

      this._overrideTheme = false;
      this._topTextSize = 9;
      this._bottomTextSize = 7;
      this._showMainBox = true;
      this._showDriveBox = true;
      this._theme = "mind";
      this._opacity = 50;
      this._boxColor = "rgb(0,0,0)";
      this._borderBoxWidth = 1;
      this._borderBoxColor = "white";
      this._width = 200;
      this._fixWidth = false;
      this._height = 350;
      this._fixHeight = false;
      this._fontColor = "white";
      this._autoscroll = true
      this._scrollVisible = false;

      this._mainBox = new St.BoxLayout({ x_align: St.Align.START, style_class: 'desklet-with-borders', reactive: true, track_hover: true });
      this._mainBox.add_style_class_name('drives-main-box');
      this._rootBox = new St.BoxLayout({ vertical:true });
      this.scrollActor = new ScrollItemsBox(this._parent, this._rootBox, true, St.Align.START);
      this._mainBox.add(this.scrollActor.actor, {x_fill: true, expand: true, x_align: St.Align.START});
      this._rootBox.connect('allocation_changed', Lang.bind(this, function() {
        if(!this._fixHeight) {
            let monitor = Main.layoutManager.findMonitorForActor(this._mainBox);
            if(this._rootBox.get_height() > monitor.height - 100) {
               this._mainBox.set_height(monitor.height - 100);
            } else {
               this._mainBox.set_height(-1);
            }
         }
      }));

      this._listCategoryContainer = new Array();
      this._listCategoryConnected = new Array();

      this.setParent(parent);
   },

   setParent: function(parent) {
      this._parent = parent;
      if(!parent.menu) {
         this._overrideTheme = parent._overrideTheme;
         this._topTextSize = parent._topTextSize;
         this._bottomTextSize = parent._bottomTextSize;
         this._showMainBox = parent._showMainBox;
         this._showDriveBox = parent._showDriveBox;
         this._theme = parent._theme;
         this._opacity = parent._opacity;
         this._boxColor = parent._boxColor;
         this._borderBoxWidth = parent._borderBoxWidth;
         this._borderBoxColor = parent._borderBoxColor;
         this._width = parent._width;
         this._fixWidth = parent._fixWidth;
         this._height = parent._height;
         this._fixHeight = parent._fixHeight;
         this._fontColor = parent._fontColor;
         this._autoscroll = parent._autoscroll;
         this._scrollVisible = parent._scrollVisible;
      }
      this.setAutoscroll(this._autoscroll);
      this.setScrollVisible(this._scrollVisible);
      this.setFontColor(this._fontColor); 
      this._setStyle();
      this.scrollActor.setParent(parent);
      Mainloop.idle_add(Lang.bind(this, function() {
         this.setWidth(this._width);
         this.setHeight(this._height);
      }));
   },

   diplayedMesageID: function() {
      return this._messageID;
   },

   displayMessage: function(message, buttons, btClickedCallBack) {
      if(this.diplayedMesageID() == null) {
         this._fixedActive = this._fixWidth;
         this.fixWidth(false);
         for(let index in this._listCategoryContainer) {
            this._rootBox.remove_actor(this._listCategoryContainer[index].getContainerBox());
         }
         this._btClickedCallBack = btClickedCallBack;
         this._messageContainer = new St.BoxLayout({vertical:true});
 
         let _information = new St.Label();
         _information.style="font-size: " + this._nameSize + "pt";
         _information.set_text(message);
         let _buttonContainer = new St.BoxLayout({vertical:false});

         for(let index in buttons) {
            let _label = "    " + buttons[index] + "    ";
            let _btButton = new St.Button({label: _label});
            _btButton.connect('notify::hover', Lang.bind(this, function(actor) {
               if(actor.get_hover())
                  global.set_cursor(Cinnamon.Cursor.POINTING_HAND);
               else
                  global.unset_cursor();
            }));
            _btButton.set_style('border:1px solid #ffffff; border-radius: 12px;');
            _btButton.connect('clicked', Lang.bind(this, function(btClick) {
               this._btClickedCallBack(btClick.label.substring(4, btClick.label.length - 4));
            }));
            _buttonContainer.add(_btButton, {x_fill: true, x_align: St.Align.END});
         }

         this._messageContainer.add(_information, {x_fill: true, x_align: St.Align.START});
         this._messageContainer.add(_buttonContainer, {x_fill: true, x_align: St.Align.END})

         this._rootBox.insert_actor(this._messageContainer, 0);
         this._messageID = new Date().getTime().toString();
      }
      return this._messageID; 
   },

   removeMessage: function() {
      if(this.diplayedMesageID() != null) {
         this.fixWidth(this._fixedActive);
         this._rootBox.remove_actor(this._messageContainer);
         this._messageContainer = null;
         for(let index in this._listCategoryContainer) {
            if(this._listCategoryConnected[index])
               this.connectCategoryByIndex(index);
         }
      }
      this._messageID = null;
   },

//Child property
   overrideTheme: function(override) {
      this._overrideTheme = override;
      this._setStyle();
      for(let index in this._listCategoryContainer)
         this._listCategoryContainer[index].overrideTheme(override);
   },

   showDriveBox: function(show) {
      this._showDriveBox = show;
      for(let index in this._listCategoryContainer)
         this._listCategoryContainer[index].showDriveBox(show);
   },

   setTheme: function(theme) {
      this._theme = theme;
      for(let index in this._listCategoryContainer)
         this._listCategoryContainer[index].setTheme(theme);
   },

   setBorderBoxWidth: function(width) {
      this._borderBoxWidth = width;
      this._setStyle();
      for(let index in this._listCategoryContainer)
         this._listCategoryContainer[index].setBorderBoxWidth(width);
   },

   setBorderBoxColor: function(color) {
      this._borderBoxColor = color;
      this._setStyle();
      for(let index in this._listCategoryContainer)
         this._listCategoryContainer[index].setBorderBoxColor(color);
   },

   setBoxColor: function(color) {
      this._boxColor = color;
      this._setStyle();
      for(let index in this._listCategoryContainer)
         this._listCategoryContainer[index].setBoxColor(color);
   },

   setTopTextSize: function(size) {
      this._topTextSize = size;
      for(let index in this._listCategoryContainer)
         this._listCategoryContainer[index].setTopTextSize(size);
   },

   setBottomTextSize: function(size) {
      this._bottomTextSize = size;
      for(let index in this._listCategoryContainer)
         this._listCategoryContainer[index].setBottomTextSize(size);
   },

   setOpacity: function(opacity) {
      this._opacity = opacity;
      this._setStyle();
      for(let index in this._listCategoryContainer)
         this._listCategoryContainer[index].setOpacity(opacity);
   },

   addCategoryContainer: function(categoryContainer) {
      let _index = this._listCategoryContainer.indexOf(categoryContainer);
      if(_index == -1) {
         categoryContainer.setParentContainer(this);
         this._listCategoryContainer.push(categoryContainer);
         this._listCategoryConnected.push(false);
         categoryContainer.getContainerBox().visible = false;
         this._rootBox.add(categoryContainer.getContainerBox(), {x_fill: true, expand: true, x_align: St.Align.START});
      }
   },

   insertCategoryContainer: function(categoryContainer, index) {
      if((index >= 0)&&(index <= this._listCategoryContainer.length)) {
         let _index = this._listCategoryContainer.indexOf(categoryContainer);
         if(_index == -1) {
            categoryContainer.setParentContainer(this);
            this._listCategoryContainer.splice(index, 0, categoryContainer);
            this._listCategoryConnected.splice(index, 0, false);
            categoryContainer.getContainerBox().visible = false;
            this._rootBox.insert_actor(categoryContainer.getContainerBox(), index, {x_fill: true, expand: true, x_align: St.Align.START});
         }
      }
   },

   indexOfCategoryContainer: function(categoryContainer) {
      return this._listCategoryContainer.indexOf(categoryContainer);
   },

   countCategoryContainer: function() {
      return this._listCategoryContainer.length;
   },

   removeCategoryContainer: function(categoryContainer) {
      let _index = this._listCategoryContainer.indexOf(categoryContainer);
      removeCategoryContainerByIndex(_index);
   },

   removeCategoryContainerByIndex: function(index) {
      if((index > -1)&&(index < this._listCategoryContainer.length)) {
         let catContainer = this._listCategoryContainer[index];
         this.disconnectCategoryByIndex(index);
         this._listCategoryContainer.splice(index, 1);
         this._listCategoryConnected.splice(index, 1);
         catContainer.destroy();
      }
   },

   connectCategory: function(categoryContainer) {  
      this.connectCategoryByIndex(this._listCategoryContainer.indexOf(categoryContainer));
   },

   connectCategoryByIndex: function(index) {
      if((index > -1)&&(index < this._listCategoryContainer.length)) {
         let catContainer = this._listCategoryContainer[index];
         if((catContainer)&&(!this._listCategoryConnected[index])) {
            this._listCategoryConnected[index] = true;
            catContainer.getContainerBox().visible = true;
            catContainer.overrideTheme(this._overrideTheme);
         }
      }
   },

   disconnectCategory: function(categoryContainer) {  
      this.disconnectCategoryByIndex(this._listCategoryContainer.indexOf(categoryContainer));
   },

   disconnectCategoryByIndex: function(index) {
      if((index > -1)&&(index < this._listCategoryContainer.length)) {
         let catContainer = this._listCategoryContainer[index];
         if((catContainer)&&(this._listCategoryConnected[index])) {
            this._listCategoryConnected[index] = false;
            let containerBox = this._listCategoryContainer[index].getContainerBox();
            containerBox.visible = false;
         }
      }
   },

   isCategoryConnect: function(categoryContainer) {
      return this.isCategoryConnectByIndex(this._listCategoryContainer.indexOf(categoryContainer));
   },

   isCategoryConnectByIndex: function(index) {
      return this._listCategoryConnected[index];
   },

   update: function() {
      for(let index in this._listCategoryContainer) {
         if(this._listCategoryConnected[index])
            this._listCategoryContainer[index].update();
      }
   },
//Child property
   getContentBox: function() {
      return this._mainBox;
   },

   getRootBox: function() {
      return this._rootBox;
   },

   setWidth: function(width) {
      this._width = width;
      if(this._fixWidth)
         this._mainBox.set_width(this._width);
   },

   fixWidth: function(fix) {
      this._fixWidth = fix;
      if(this._fixWidth)
         this._mainBox.set_width(this._width);
      else
         this._mainBox.set_width(-1);
   },

   setHeight: function(height) {
      this._height = height;
      let monitorHeight = Main.layoutManager.findMonitorForActor(this._mainBox).height;
      if(this._fixHeight) {
         if(this._height <= monitorHeight - 100)
            this._mainBox.set_height(this._height);
         else
            this._mainBox.set_height(monitorHeight - 100);
      } else {
         if(this._rootBox.get_height() > monitorHeight - 100)
            this._mainBox.set_height(monitorHeight - 100);
         else
            this._mainBox.set_height(-1);
      }
   },

   fixHeight: function(fix) {
      this._fixHeight = fix;
      this.setHeight(this._height)
   },

   setAutoscroll: function(autoscroll) {
      this._autoscroll = autoscroll;
      this.scrollActor.setAutoScrolling(autoscroll);
   },

   setScrollVisible: function(visibleScroll) {
      this._scrollVisible = visibleScroll;
      this.scrollActor.setScrollVisible(visibleScroll);
   },

   setFontColor: function(color) {
      this._fontColor = color;
      this._rootBox.set_style('color:' + this._fontColor + '; text-shadow: 1px 1px 2px #000;');
   },

   showMainBox: function(show) {
      this._showMainBox = show;
      this._setStyle();
   },

   _setStyle: function() {this._parent
      if(this._parent.menu)
         this._setAppletStyle();
      else
         this._setDeskletStyle();
      return true;
   },

   _setAppletStyle: function() {
      this._mainBox.set_style(' ');
      this._mainBox.set_style_class_name(' ');
      if(this._showMainBox) {
         if(this._parent.menu.actor.style_class != 'popup-menu-boxpointer') {
            this._parent.menu.actor.set_style_class_name('popup-menu-boxpointer');
            this._parent.menu.actor.add_style_class_name('popup-menu');
         }
      } else {
         this._parent.menu.actor.set_style(' ');
         this._parent.menu.actor.set_style_class_name(' ');
      }
   },

   _setDeskletStyle: function() {this._parent
      if(this._showMainBox) {
         let newStyle = '';
         let remplaceColor;
         if(this._overrideTheme) {
            this._mainBox.set_style_class_name(' ');
            let remplaceColor = this._textRGBToRGBA(this._boxColor, this._opacity);
            newStyle = 'padding: 4px; border:'+this._borderBoxWidth +
                       'px solid ' + this._borderBoxColor + '; background-color: ' +
                       remplaceColor + '; border-radius: 12px;';
            this._mainBox.set_style(newStyle);
         } else {
            if(this._mainBox.style_class != 'desklet-with-borders') {
               this._mainBox.set_style(' ');
               this._mainBox.set_style_class_name('desklet-with-borders');
               this._mainBox.add_style_class_name('drives-main-box');
            }
            if((this._mainBox.visible)&&(this._mainBox.get_parent())) {
               let themeNode = this._mainBox.get_theme_node();
               let [have_color, box_color] = themeNode.lookup_color('background-color', false);
               if(have_color) {
                  remplaceColor = this._updateOpacityColor(box_color.to_string(), this._opacity);
                  newStyle += 'background-color: ' + remplaceColor + ';';
               }
               let [have_color_start, box_color_start] = themeNode.lookup_color('background-gradient-start', false);
               if(have_color_start) {
                  remplaceColor = this._updateOpacityColor(box_color_start.to_string(), this._opacity);
                  newStyle += ' background-gradient-start: ' + remplaceColor + ';';
               }
               let [have_color_end, box_color_end] = themeNode.lookup_color('background-gradient-end', false);
               if(have_color_end) {
                  remplaceColor = this._updateOpacityColor(box_color_end.to_string(), this._opacity);
                  newStyle += ' background-gradient-end: ' + remplaceColor + ';';
               }
               if(newStyle != this._mainBox.get_style()) {
                  this._mainBox.set_style(newStyle);
               }
            }
         }
      } else {
         this._mainBox.set_style(' ');
         this._mainBox.set_style_class_name(' ');
      }
   },

   _updateOpacityColor: function(color, opacity) {
      if((!opacity)||(opacity == 0))
         opacity = "0.01";
      let r = parseInt(color.substring(1,3),16);
      let g = parseInt(color.substring(3,5),16);
      let b = parseInt(color.substring(5,7),16);
      return "rgba("+r+","+g+","+b+","+opacity+")";
   },

   _textRGBToRGBA: function(textRGB, opacity) {
      if((!opacity)||(opacity == 0))
         opacity = "0.0";
      return (textRGB.replace(')',',' + opacity + ')')).replace('rgb','rgba');
   }
};

function CategoryContainer(parent) {
    this._init(parent);
}

CategoryContainer.prototype = {

   _init: function(parent) {
      this._parent = parent;
      this._categoryBox = new St.BoxLayout({vertical:true});
      this._listDriveContainer = new Array();
      this._overrideTheme = "false";
      this._theme = "mind";
      this._showDriveBox = true;
      this._borderBoxWidth = 1;
      this._borderBoxColor  = "white";
      this._boxColor = "rgb(0,0,0)";
      this._topTextSize = 9;
      this._bottomTextSize = 7;
      this._opacity = 50;
      this.setParentContainer(parent);
   },

   setParentContainer: function(parent) {
      this._parent = parent;
      if(this._parent) {
         //Main.notify("Hola" + this._parent._overrideTheme + " opacity" + this._parent._opacity)
         this._overrideTheme = this._parent._overrideTheme;
         this._theme = this._parent._theme;
         this._showDriveBox = this._parent._showDriveBox;
         this._borderBoxWidth = this._parent._borderBoxWidth;
         this._borderBoxColor  = this._parent._borderBoxColor;
         this._boxColor = this._parent._boxColor;
         this._topTextSize = this._parent._topTextSize;
         this._bottomTextSize = this._parent._bottomTextSize;
         this._opacity = this._parent._opacity;
         this.overrideTheme(this._overrideTheme);
      }
   },

   getNativeIcon: function(dr) {
      return null;
   },

   getContainerBox: function() {
      return this._categoryBox;
   },

   getUUID: function() {
      return this._parent._uuid;
   },

//Child property
   addDriveContainer: function() {
      let _driveContainer = new DriveContainer(this);
      this._listDriveContainer.push(_driveContainer);
      this._categoryBox.add(_driveContainer.getDriveBox(), {x_fill: true, y_fill: false, expand: true, x_align: St.Align.START});
      return _driveContainer;
   },

   countDriveContainer: function() {
      return this._listDriveContainer.length;
   },

   getDriveContainer: function(index) {
      return this._listDriveContainer[index];
   },

   removeDriver: function(index) {
      if((index > -1)&&(index < this._listDriveContainer.length)) {
         this._listDriveContainer[index].setParent(null);
         this._categoryBox.remove_actor(this._listDriveContainer[index].getDriveBox());
         this._listDriveContainer.splice(index, 1);
      }
   },

   indexOfDriverButton: function(button) {
      for(let _index in this._listDriveContainer)
         if(this._listDriveContainer[_index].getDriveButton() == button)
            return _index;
      return -1;
   },

   indexOfEjectButton: function(button) {
      for(let _index in this._listDriveContainer)
         if(this._listDriveContainer[_index].getEjectButton() == button)
            return _index;
      return -1;
   },

   overrideTheme: function(override) {
      this._overrideTheme = override;
      for(let index in this._listDriveContainer)
         this._listDriveContainer[index].overrideTheme(override);
   },

   setTheme: function(theme) {
      this._theme = theme;
      for(let index in this._listDriveContainer)
         this._listDriveContainer[index].setTheme(theme);
   },

   showDriveBox: function(show) {
      this._showDriveBox = show;
      for(let index in this._listDriveContainer)
         this._listDriveContainer[index].showDriveBox(show);
   },

   setBorderBoxWidth: function(width) {
      this._borderBoxWidth = width;
      for(let index in this._listDriveContainer)
         this._listDriveContainer[index].setBorderBoxWidth(width);
   },

   setBorderBoxColor: function(color) {
      this._borderBoxColor = color;
      for(let index in this._listDriveContainer)
         this._listDriveContainer[index].setBorderBoxColor(color);
   },

   setBoxColor: function(color) {
      this._boxColor = color;
      for(let index in this._listDriveContainer)
         this._listDriveContainer[index].setBoxColor(color);
   },

   setTopTextSize: function(size) {
      this._topTextSize = size;
      for(let index in this._listDriveContainer)
         this._listDriveContainer[index].setTopTextSize(size);
   },

   setBottomTextSize: function(size) {
      this._bottomTextSize = size;
      for(let index in this._listDriveContainer)
         this._listDriveContainer[index].setBottomTextSize(size);
   },

   setOpacity: function(opacity) {
      this._opacity = opacity;
      for(let index in this._listDriveContainer)
         this._listDriveContainer[index].setOpacity(opacity);
   },

//Child property
   update: function() {
   },

   convertToString: function(size) {
      let converted_string;
      let suffix = "BT";
      let index = 0;
      let prefixNumber = size;
      while (prefixNumber > 999)
      {
         prefixNumber /= 1000;
         index++;
      }
      switch(index) {
         case 1: suffix = "KB" ;break;
         case 2: suffix = "MB" ;break;
         case 3: suffix = "GB" ;break;
         case 4: suffix = "TB" ;break;
         default:suffix = "BT" ;break;
      }
      let _result = prefixNumber.toFixed(1).toString();
      if(_result.length > 4)
         _result = _result.substring(0, 4);
      if(_result[_result.length-1] == ".")
         _result = _result.substring(0, 3);
      else {
         while(_result.length < 4)
            _result = _result + "0";
      }
      return "" + _result + "" + suffix;
   },

   destroy: function() {
      this._categoryBox.destroy();
   }
};

function DriveContainer(parent) {
    this._init(parent);
}

DriveContainer.prototype = {

   _init: function(parent) {
      this._parent = parent;
      this._overrideTheme = false;
      this._showDriveBox = true;
      this._boxColor = "rgb(0,0,0)";
      this._opacity = 50;
      this._borderBoxWidth = 1;
      this._borderBoxColor = "white";
      this._fontFamily = ""; //Default Font family
      this._topTextSize = 9;
      this._bottomTextSize = 7;
      this._clickedEject = false;

      this._driveBox = new St.BoxLayout({ vertical:false, style_class: 'menu-favorites-box', reactive: true, track_hover: true });
      this._driveBox.add_style_class_name('drives-drive-box');
      this._iconContainer = new St.BoxLayout({ vertical:true, style_class: 'drives-icon-button-box'});
          
      this._topTextContainer = new St.BoxLayout({ vertical: false, style_class: 'drives-top-text-drive-box' });
      this._leftTopText = new St.Label({ style_class: 'menu-selected-app-title' });
      this._rightTopText = new St.Label({ style_class: 'menu-selected-app-title' });
      this._leftTopText.add_style_class_name('drives-left-top-text');
      this._rightTopText.add_style_class_name('drives-right-top-text');
      this._topTextContainer.add(this._leftTopText, {x_fill: true, expand: true, x_align: St.Align.START});
      this._topTextContainer.add(this._rightTopText, {x_fill: true, x_align: St.Align.END});

      this._bottomTextContainer = new St.BoxLayout({ vertical: false, style_class: 'drives-bottom-text-drive-box' });
      this._leftBottomText = new St.Label({ style_class: 'menu-selected-app-description' });
      this._rightBottomText = new St.Label({ style_class: 'menu-selected-app-description' });
      this._leftBottomText.add_style_class_name('drives-left-bottom-text');
      this._rightBottomText.add_style_class_name('drives-right-bottom-text');
      this._bottomTextContainer.add(this._leftBottomText, {x_fill: true, expand: true, x_align: St.Align.START});
      this._bottomTextContainer.add(this._rightBottomText, {x_fill: true, x_align: St.Align.END});

      this.percentContainer = new St.BoxLayout({ vertical:true, style_class: 'drives-meter-box' });

      this._ejectContainer = new St.BoxLayout({vertical:true, style_class: 'drives-eject-button-box' });

      this._infoContainer = new St.BoxLayout({ vertical: true, style_class: 'drives-info-drive-box' });
      this._infoContainer.add(this._topTextContainer, {x_fill: true, expand: true, x_align: St.Align.START});
      this._infoContainer.add(this.percentContainer, {x_fill: true, expand: true, x_align: St.Align.START});
      this._infoContainer.add(this._bottomTextContainer, {x_fill: true, expand: true, x_align: St.Align.START});

      this._driveBox.add(this._iconContainer, {x_fill: true, x_align: St.Align.START});
      this._driveBox.add(this._infoContainer, {x_fill: true, expand: true, x_align: St.Align.START});
      this._driveBox.add(this._ejectContainer, { x_fill: true, y_fill: false, y_expand: true, y_align: St.Align.MIDDLE});
      this._currentMeterImage = new Array();
      this.setParent(this._parent);
   },

   enableClickedEject: function() {
      this._clickedEject = false;
   },

   getDriveBox: function() {
      return this._driveBox;
   },

   setParent: function(parent) {
      this._parent = parent;
      if(this._parent) {
         //Main.notify("Hola" + this._parent._overrideTheme + " opacity" + this._parent._opacity)
         this._overrideTheme = this._parent._overrideTheme;
         this._showDriveBox = this._parent._showDriveBox;
         this._boxColor = this._parent._boxColor;
         this._opacity = this._parent._opacity;
         this._borderBoxWidth = this._parent._borderBoxWidth;
         this._borderBoxColor  = this._parent._borderBoxColor;
         this._topTextSize = this._parent._topTextSize;
         this._bottomTextSize = this._parent._bottomTextSize;
      }
      this._setStyleDrive();
   },

   overrideTheme: function(override) {
      this._overrideTheme = override;
      this._setStyleDrive();
   },

   showDriveBox: function(show) {
      this._showDriveBox = show;
      this._setStyleDrive();
   },

   setBoxColor: function(color) {
      this._boxColor = color;
      this._setStyleDrive();
   },

   setOpacity: function(opacity) {
      this._opacity = opacity;
      this._setStyleDrive();
   },

   setBorderBoxWidth: function(width) {
      this._borderBoxWidth = width;
      this._setStyleDrive();
   },

   setBorderBoxColor: function(color) {
      this._borderBoxColor = color;
      this._setStyleDrive();
   },
 
   addMeter: function() {
      this._currentMeterImage.push(new MeterBox(20));
      let index = this._currentMeterImage.length - 1;
      this.percentContainer.add(this._currentMeterImage[index].actor, { x_fill: true, y_fill: true, expand: true, x_align: St.Align.START, y_align: St.Align.MIDDLE });
      this.setMeterImage(index, 0, 0);
   },

   removeMeterImage: function(index) {
      if((index > -1)&&(index < this._currentMeterImage.length)) {
         this.percentContainer.remove_actor(this._currentMeterImage[index]);
         this._currentMeterImage.splice(index, 1);
      }
   },

   setMeterImage: function(index, currValue, totalValue) {
      if((index > -1)&&(index < this._currentMeterImage.length)) {
         this._currentMeterImage[index].setMeterImage(currValue, totalValue);
      }
   },

   setDriveIcon: function(themeName, iconName, callBackClicked) {
      this._callDriveClicked = callBackClicked;
      this._iconDriveName = iconName;
      if(this._driveButton) {
         this._iconContainer.remove_actor(this._driveButton);
         this._driveButton.destroy();
      }
      let _driveIcon;
      if(themeName == "symbolic")
         _driveIcon = this._getIconImage(this._path() + "theme/" + themeName + "/" + iconName, 48, true);
      else if(themeName == "native")
         _driveIcon = this._getNativeDriveIcon(48);
      else
         _driveIcon = this._getIconImage(this._path() + "theme/" + themeName + "/" + iconName, 48);
      this._driveButton = new St.Button({ child: _driveIcon });
      this._iconContainer.add_actor(this._driveButton, {x_fill: true, x_align: St.Align.START});
      if(this._callDriveClicked) {
         this._driveButton.connect('clicked', Lang.bind(this, this._onDriveIconClicked));
         this._driveButton.connect('notify::hover', Lang.bind(this, this._onHover));
      }
   },

   setEjectIcon: function(themeName, iconName, callBackClicked) {
      this._callEjectClicked = callBackClicked; 
      this._iconEjectName = iconName;
      if(this._ejectButton)
         this._ejectContainer.remove_actor(this._ejectButton);
      let _ejectIcon;
      if((!iconName)||(iconName == "empty"))
         _ejectIcon = this._getIconImage(this._path() + "theme/" + iconName, 30);
      else if(themeName == "symbolic")
         _ejectIcon = this._getIconImage(this._path() + "theme/" + themeName + "/" + iconName, 30, true);
      else if(themeName == "native")
         _ejectIcon = this._getNativeEjectIcon(iconName, 30);
      else
         _ejectIcon = this._getIconImage(this._path() + "theme/" + themeName + "/" + iconName, 30);
      this._ejectButton = new St.Button({ child: _ejectIcon });
      this._ejectContainer.add_actor(this._ejectButton);
      if(this._callEjectClicked) {
         this._ejectButton.connect('clicked', Lang.bind(this, this._onEjectIconClicked));
         this._ejectButton.connect('notify::hover', Lang.bind(this, this._onHover));
      }
   },

   getEjectButton: function() {
      return this._ejectButton;
   },

   getDriveButton: function() {
      return this._driveButton;
   },

   getEjectName: function() {
      return this._iconEjectName;
   },

   setTheme: function(theme) {
      this.setDriveIcon(theme, this._iconDriveName, this._callDriveClicked);
      this.setEjectIcon(theme, this._iconEjectName, this._callEjectClicked);
   },  

   setFontFamily: function(fontFamily) {
      this._fontFamily = fontFamily;
   },

   setTopTextSize: function(size) {
      this._topTextSize = size;
      this._setStyleText();
   },

   setBottomTextSize: function(size) {
      this._bottomTextSize = size;
      this._setStyleText();
   },

   setLeftTopText: function(text) {
      this._leftTopFontColor = null;
      this._leftTopText.set_text(text);
   },

   setRightTopText: function(text) {
      this._rightTopFontColor = null;
      this._rightTopText.set_text(text);
   },

   setLeftBottomText: function(text) {
      this._leftBottomFontColor = null;
      this._leftBottomText.set_text(text);
   },

   setRightBottomText: function(text) {
      this._rightBottomFontColor = null;
      this._rightBottomText.set_text(text);
   },

   setLeftTopTextColor: function(text, color) {
      this.setLeftTopText(text);
      this._leftTopFontColor = color;
      this._setStyleText();
   },

   setRightTopTextColor: function(text, color) {
      this.setRightTopText(text);
      this._rightTopFontColor = color;
      this._setStyleText();
   },

   setLeftBottomTextColor: function(text, color) {
      this.setLeftBottomText(text);
      this._leftBottomFontColor = color;
      this._setStyleText();
   },

   setRightBottomTextColor: function(text, color) {
      this.setRightBottomText(text);
      this._rightBottomFontColor = color;
      this._setStyleText();
   },

   _setStyleMeter: function() {
      let meter;
      if(this._overrideTheme) {
         for(let index in this._currentMeterImage) {
            meter = this._currentMeterImage[index];
            meter.actor.set_style_class_name(' ');
            meter.actor.style = 'min-height: 6px; spacing: 2px;';
            meter.overrideTheme(this._overrideTheme);
         }
      } else {
         for(let index in this._currentMeterImage) {
            meter = this._currentMeterImage[index];
            meter.actor.set_style_class_name('drives-meter');
            meter.actor.style = ' ';
            meter.overrideTheme(this._overrideTheme);
         }
      }
   },

   _setStyleDrive: function() {
      this._setStyleMeter();
      if(this._showDriveBox) {
         let newStyle = '';
         let remplaceColor;
         if(this._overrideTheme) {
            this._infoContainer.set_style_class_name(' ');
            this._iconContainer.set_style_class_name(' ');
            this._iconContainer.style = 'padding: 4px;';
            this.percentContainer.set_style_class_name(' ');
            this.percentContainer.style = 'spacing: 2px;';
            this._ejectContainer.set_style_class_name(' ');
            this._ejectContainer.style = 'padding-left: 4px; padding-right: 4px;';
            this._topTextContainer.set_style_class_name(' ');
            this._topTextContainer.style = 'spacing: 4px;';
            this._bottomTextContainer.set_style_class_name(' ');
            this._bottomTextContainer.style = 'padding-top: 2px; spacing: 4px;';

            this._driveBox.set_style_class_name(' ');
            let remplaceColor = this._textRGBToRGBA(this._boxColor, this._opacity);
            newStyle = 'padding: 0px 6px 0px 0px; border:' + this._borderBoxWidth + 'px solid ' +
                       this._borderBoxColor +'; background-color: ' + remplaceColor + '; border-radius: 12px;';
            this._driveBox.set_style(newStyle);
         } else {
            this._infoContainer.set_style_class_name('drives-info-drive-box');
            this._iconContainer.set_style_class_name('drives-icon-button-box');
            this._iconContainer.style = ' ';
            this.percentContainer.set_style_class_name('drives-meter-box');
            this.percentContainer.style = ' ';
            this._ejectContainer.set_style_class_name('drives-eject-button-box');
            this._ejectContainer.style = ' ';
            this._topTextContainer.set_style_class_name('drives-top-text-drive-box');
            this._topTextContainer.style = ' ';
            this._bottomTextContainer.set_style_class_name('drives-bottom-text-drive-box');
            this._bottomTextContainer.style = ' ';
            if(this._driveBox.style_class != 'menu-favorites-box') {
               this._driveBox.set_style(' ');
               this._driveBox.set_style_class_name('menu-favorites-box');
               this._driveBox.add_style_class_name('drives-drive-box');
            }
            if((this._driveBox.get_parent())&&(this._driveBox.get_parent().get_parent())) {
               let themeNode = this._driveBox.get_theme_node();
               let [have_color, box_color] = themeNode.lookup_color('background-color', false);
               if(have_color) {
                  remplaceColor = this._updateOpacityColor(box_color.to_string(), this._opacity);
                  newStyle += 'background-color: ' + remplaceColor + ';';
               }
               let [have_color_start, box_color_start] = themeNode.lookup_color('background-gradient-start', false);
               if(have_color_start) {
                  remplaceColor = this._updateOpacityColor(box_color_start.to_string(), this._opacity);
                  newStyle += ' background-gradient-start: ' + remplaceColor + ';';
               }
               let [have_color_end, box_color_end] = themeNode.lookup_color('background-gradient-end', false);
               if(have_color_end) {
                  remplaceColor = this._updateOpacityColor(box_color_end.to_string(), this._opacity);
                  newStyle += ' background-gradient-end: ' + remplaceColor + ';';
               }
               if(newStyle != this._driveBox.get_style()) {
                  this._driveBox.set_style(newStyle);
               }
            }
         }
      } else {
         this._driveBox.set_style_class_name(' ');
         this._driveBox.set_style(' ');
      }
      this._setStyleText();
      return true;
   },

   _updateOpacityColor: function(color, opacity) {
      if((!opacity)||(opacity == 0))
         opacity = "0.01";
      let r = parseInt(color.substring(1,3),16);
      let g = parseInt(color.substring(3,5),16);
      let b = parseInt(color.substring(5,7),16);
      return "rgba("+r+","+g+","+b+","+opacity+")";
   },

   _textRGBToRGBA: function(textRGB, opacity) {
      if((!opacity)||(opacity == 0))
         opacity = "0.0";
      return (textRGB.replace(')',',' + opacity + ')')).replace('rgb','rgba');
   },

   _setStyleText: function() {
      if(this._overrideTheme) {
         this._leftTopText.set_style_class_name(' ');
         this._rightTopText.set_style_class_name(' ');
         this._leftBottomText.set_style_class_name(' ');
         this._rightBottomText.set_style_class_name(' ');
         if(this._leftTopFontColor)
            this._leftTopText.style="font-size: " + this._topTextSize + "pt; color:" + this._leftTopFontColor + " " + this._fontFamily;
         else
            this._leftTopText.style="font-size: " + this._topTextSize + "pt; " + this._fontFamily;
         if(this._rightTopFontColor)
            this._rightTopText.style="font-size: " + this._topTextSize + "pt; color:" + this._rightTopFontColor + " " + this._fontFamily;
         else
            this._rightTopText.style="font-size: " + this._topTextSize + "pt; " + this._fontFamily;

         if(this._leftBottomFontColor)
            this._leftBottomText.style="font-size: " + this._bottomTextSize + "pt; color:" + this._leftBottomFontColor + " " + this._fontFamily;
         else
            this._leftBottomText.style="font-size: " + this._bottomTextSize + "pt; " + this._fontFamily;
         if(this._rightBottomFontColor)
            this._rightBottomText.style="font-size: " + this._bottomTextSize + "pt; color:" + this._rightBottomFontColor + " " + this._fontFamily;
         else
            this._rightBottomText.style="font-size: " + this._bottomTextSize + "pt; " + this._fontFamily;
      } else {
         this._leftTopText.set_style(' ');
         this._rightTopText.set_style(' ');
         this._leftBottomText.set_style(' ');
         this._rightBottomText.set_style(' ');
         if(this._rightBottomFontColor)
            this._rightBottomText.style="color:" + this._rightBottomFontColor;
         this._leftTopText.set_style_class_name('menu-selected-app-title');
         this._rightTopText.set_style_class_name('menu-selected-app-title');
         this._leftBottomText.set_style_class_name('menu-selected-app-description');
         this._rightBottomText.set_style_class_name('menu-selected-app-description');
         this._leftTopText.add_style_class_name('drives-left-top-text');
         this._rightTopText.add_style_class_name('drives-right-top-text');
         this._leftBottomText.add_style_class_name('drives-left-bottom-text');
         this._rightBottomText.add_style_class_name('drives-right-bottom-text');
      }
   },

   _path: function() {
      //this._parent._parent._uuid
      return GLib.get_home_dir()+ "/.local/share/cinnamon/desklets/" + this._parent.getUUID() + "/";//+ this.uuid + "/";
   },

   _getIconImage: function(pathC, iconSize, symbolic) {
      try {
         if((iconSize)&&(symbolic))
            pathC = pathC + "-symbolic";
         let file = Gio.file_new_for_path(pathC + ".png");
         if(!file.query_exists(null))
            file = Gio.file_new_for_path(pathC + ".svg");
         if(iconSize) {
            let gicon = new Gio.FileIcon({ file: file });
            if(symbolic) {
               return new St.Icon({gicon: gicon, icon_size: iconSize, icon_type: St.IconType.SYMBOLIC});
            } else
               return new St.Icon({gicon: gicon, icon_size: iconSize, icon_type: St.IconType.FULLCOLOR});
         } else {
            //return St.TextureCache.get_default().load_uri_sync(1, file.get_uri(), 1064, 1064);
            return St.TextureCache.get_default().load_uri_async(file.get_uri(), 1064, 1064);
         }
      } catch(e) {
         //this._reportFailure(e);
      }
      return null;      
   },

   _getNativeDriveIcon: function(iconSize) {
      try {
         if(this._parent) {
            let iconNative = this._parent.getNativeIcon(this);
            if(iconNative) {
               iconNative.set_icon_size(iconSize);
               return iconNative;
            }
         }
      } catch(e) {
         Main.notifyError(_("Failed of Drives Manager:"), e.message);
      }
      return null;
   },

   _getNativeEjectIcon: function(iconName, iconSize) {
      try {
         let icon = new St.Icon({ icon_name: 'media-eject', icon_type: St.IconType.FULLCOLOR, icon_size: iconSize });
         if(iconName == "inject") {
            icon.set_pivot_point(0.5, 0.5);
            icon.set_rotation_angle(Clutter.RotateAxis.X_AXIS, 180);
         }
         return icon;
      } catch(e) {
         Main.notifyError(_("Failed of Drives Manager:"), e.message);
      }
      return null;
   },

   _animateIcon: function(animeIcon, step) {
      if (step>=3) return;
      Tweener.addTween(animeIcon,
      {  width: 40,
         height: 40,
         time: 0.1,
         transition: 'easeOutQuad',
         onComplete: function() {
            Tweener.addTween(animeIcon,
            {  width: 48,
               height: 48,
               time: 0.2,
               transition: 'easeOutQuad',
               onComplete: function() {
                  this._animateIcon(animeIcon, step+1);
               },
               onCompleteScope: this
            });
         },
         onCompleteScope: this
      });
   },

   _effectIcon: function(effectIcon, time) {
      Tweener.addTween(effectIcon,
      {  opacity: 0,
         time: time,
         transition: 'easeInSine',
         onComplete: Lang.bind(this, function() {
            Tweener.addTween(effectIcon,
            {  opacity: 255,
               time: time,
               transition: 'easeInSine'
            });
         })
      });
   },

   _onDriveIconClicked: function(button) {
      if(this._callDriveClicked) {
         this._animateIcon(button, 0);
         this._callDriveClicked(button);
      }
   },

   _onEjectIconClicked: function(button) {
      if((!this._clickedEject)&&(this._callEjectClicked)) {
         this._clickedEject = true;
         this._effectIcon(button, 0.2);
         this._callEjectClicked(button);
      }
      //this._clickedEject = false;
   },

   _onHover: function (actor) {
      if(actor.get_hover())
         global.set_cursor(Cinnamon.Cursor.POINTING_HAND);
      else
         global.unset_cursor();
      //global.set_cursor(Cinnamon.Cursor.DND_IN_DRAG);
   }
};

function SpeedDiskContainer(parent) {
    this._init(parent);
}

SpeedDiskContainer.prototype = {
   __proto__: CategoryContainer.prototype,

   _init: function(parent) {
      CategoryContainer.prototype._init.call(this, parent);
      this._dr = this.addDriveContainer();
      this._dr.setDriveIcon(this._theme, "meter", null);
      this._dr.setEjectIcon(this._theme, "empty", null);
      this._dr.setFontFamily("font-family:Monospace");
      this._dr.setTopTextSize(9);
      this._dr.addMeter();
      this._dr.addMeter();
      this._meterTimeDelay = 2;
      this.update();
   },

   getNativeIcon: function(dr) {
      return new St.Icon({ icon_name: 'utilities-system-monitor', icon_type: St.IconType.FULLCOLOR });
   },

   setTopTextSize: function(size) {
      this._dr.setTopTextSize(size);
      this._dr.setBottomTextSize(size);
   },

   setBottomTextSize: function(size) {
      
   },

   setMeterTimeDelay: function(meterTimeDelay) {
      this._meterTimeDelay = meterTimeDelay;
   },

   update: function() {
      this._updateDiskData();

      this._dr.setLeftTopText("" + this.convertToString(this.diskReadSpeed) + "/s");
      this._dr.setRightTopText(" " + this.convertToString(this.diskReadMaxSpeed) + "/s");
      this._dr.setLeftBottomText("" + this.convertToString(this.diskWriteSpeed) + "/s");
      this._dr.setRightBottomText(" " + this.convertToString(this.diskWriteMaxSpeed) + "/s");
      this._dr.setMeterImage(0, this.diskReadSpeed, this.diskReadMaxSpeed);
      this._dr.setMeterImage(1, this.diskWriteSpeed, this.diskWriteMaxSpeed);
   },

   _updateDiskData: function() {
      let _linesDiskstats = this._parent._sys.readFile("/proc/diskstats").split("\n");
      let _diskReadTotal = 0;
      let _diskWriteTotal = 0;
      let _diskIdle = new Date().getTime()/1000 + this._meterTimeDelay;

      for(let i = 0; i < _linesDiskstats.length; i++)
      {
         let _values;

         if (_linesDiskstats[i].match(/^\s*\d+\s*\d+\s[a-z]+\s/))
         {
            let _values = _linesDiskstats[i].match(/^\s*\d+\s*\d+\s[a-z]+\s(.*)$/)[1].split(" ");
            _diskReadTotal += parseInt(_values[2]);
            _diskWriteTotal += parseInt(_values[6]);
         }
      }
         
      if((this.diskReadTotalOld == null && this.diskWriteTotalOld == null &&
           this.diskIdleOld == null) || (this.diskIdleOld == _diskIdle))
      {
         this.diskReadTotalOld = _diskReadTotal;
         this.diskWriteTotalOld = _diskWriteTotal;
         this.diskIdleOld = _diskIdle - this._meterTimeDelay - 1;
         this.diskReadMaxSpeed = 0;
         this.diskWriteMaxSpeed = 0;
      }

      if(_diskIdle - this.diskIdleOld > this._meterTimeDelay) {
         this.diskReadSpeed = 500*(_diskReadTotal - this.diskReadTotalOld)/(_diskIdle - this.diskIdleOld);
         this.diskWriteSpeed = 500*(_diskWriteTotal - this.diskWriteTotalOld)/(_diskIdle - this.diskIdleOld);

         //this.diskReadSpeed = Math.round((_diskReadTotal - this.diskReadTotalOld)/(_diskIdle - this.diskIdleOld)/2/1024);
         //this.diskWriteSpeed = Math.round((_diskWriteTotal - this.diskWriteTotalOld)/(_diskIdle - this.diskIdleOld)/2/1024);

         this.diskReadTotalOld = _diskReadTotal;
         this.diskWriteTotalOld = _diskWriteTotal;
         this.diskIdleOld = _diskIdle;
         if(this.diskReadSpeed > this.diskReadMaxSpeed)
            this.diskReadMaxSpeed = this.diskReadSpeed;
         if(this.diskWriteSpeed > this.diskWriteMaxSpeed)
            this.diskWriteMaxSpeed = this.diskWriteSpeed;
      }
   }
};

function HardDiskContainer(parent, hddTempMonitor) {
    this._init(parent, hddTempMonitor);
}

HardDiskContainer.prototype = {
   __proto__: CategoryContainer.prototype,

   _init: function(parent, hddTempMonitor) {
      CategoryContainer.prototype._init.call(this, parent);
      this._hddTempMonitor = hddTempMonitor;
      this.mountsHard = new Array();
      this._capacityDetect = true;
      this.idConnect = this._hddTempMonitor.connect('temp-changed', Lang.bind(this, this._onHDDTempChange));
      this.update();
   },

   createDrivers: function() {
      while(this._listDriveContainer.length > 0)
         this.removeDriver(0);
      let _dr;
      for(let _pos in this.mountsHard) {
          _dr = this.addDriveContainer();
          _dr.setDriveIcon(this._theme, "disk", Lang.bind(this, this._onDriveClicked));
          _dr.setEjectIcon(this._theme, "empty", null);
          _dr.addMeter();
          _dr.setLeftTopText(this.mountsHard[_pos][1] + " ");
          _dr.setRightTopText(this.mountsHard[_pos][0]);
          this._hddTempMonitor.addDevice(this.mountsHard[_pos][0]);
      }
   },

   getNativeIcon: function(dr) {
      return new St.Icon({ icon_name: 'drive-harddisk', icon_type: St.IconType.FULLCOLOR });
   },

   setCapacityDetect: function(capacityDetect) {
      this._capacityDetect = capacityDetect;
   },

   update: function() {
      if(this._capacityDetect)
      {
         let _currMountsHard = this._readMtabFile();
         if(this._checkChange(_currMountsHard)) {
            this.mountsHard = _currMountsHard;
            this.createDrivers();
         }
         //Real Update.
         let _sizeStatus;
         let _capacityStatus;
         for(let _pos in this.mountsHard) {
             _sizeStatus = this._getDriveSize(this.mountsHard[_pos][1]);
             _capacityStatus = this._getDriveUsedSpace(this.mountsHard[_pos][1]);
             this._listDriveContainer[_pos].setLeftBottomText(this.convertToString(_capacityStatus) + "/" + this.convertToString(_sizeStatus));
             this._listDriveContainer[_pos].setMeterImage(0, _capacityStatus, _sizeStatus);
         }
      }
   },

   destroy: function() {
      if(this.idConnect)
         this._hddTempMonitor.disconnect(this.idConnect);
      this.idConnect = null;
   },

   _onHDDTempChange: function(sender, device, value) {
      let _color;  
      for(let dev in this.mountsHard) {
         if(this.mountsHard[dev][0] == device) {
            if(value) {
               _color = this._hddTempMonitor.getHddTempColor(value);
               this._listDriveContainer[dev].setRightBottomTextColor(value, _color);
            }
            else
               this._listDriveContainer[dev].setRightBottomTextColor("");
         }
      }
   },

   _onDriveClicked: function(button) {
      this.openMountDrive(this.indexOfDriverButton(button));
   },

   indexOfDriverButton: function(button) {
      for(let _index in this._listDriveContainer)
         if(this._listDriveContainer[_index].getDriveButton() == button)
            return _index;
      return -1;
   },

   openMountDrive: function(_index) {
      if((_index > -1)&&(_index < this.mountsHard.length)) {
         if(this.mountsHard[_index][1]) {
            Util.spawnCommandLine("xdg-open '" + this.mountsHard[_index][1] + "'");
         } else {
            Main.notifyError(_("Failed of Drives Manager:") + " " + _("Can't find the mount point."));
         }
      }
   },

   _checkChange: function(currMountsHard) {
      if(this.mountsHard.length != currMountsHard.length)
         return true;
      for(let p in this.mountsHard) {
         if(this.mountsHard[p][0] != currMountsHard[p][0])
            return true;
      }
      return false;
   },

   _readMtabFile: function() {
      let _mountsHard = [];
      try {
          let _linesMtab = this._parent._sys.readFile("/etc/mtab").split("\n");
          let _tokens;

          for(let i = 0; i < _linesMtab.length; i++)
          {
              _tokens = _linesMtab[i].split(" ");
              if((_tokens[0].indexOf("/dev/") != -1) && (_tokens[1].indexOf("/media/") == -1))
              {
                  let _mount = [];
                  _mount.push(_tokens[0]);
                  _mount.push(_tokens[1]);
                  _mountsHard.push(_mount);
              }
          }
      } catch(e) {
         Main.notifyError(_("Failed of Drives Manager:"), e.message);
      }
      return _mountsHard;
   },

   _getDriveUsedSpace: function(partitionPath) {
      let _attribute = "filesystem::used";
      try {
         let _file = Gio.file_new_for_path(partitionPath);
         return _file.query_filesystem_info(_attribute, null).get_attribute_uint64(_attribute);
      } catch(e) {
      }
      return 0;
   },

   _getDriveSize: function(partitionPath) {
      let _attribute = "filesystem::size";
      try {
         let _file = Gio.file_new_for_path(partitionPath);
         return _file.query_filesystem_info(_attribute, null).get_attribute_uint64(_attribute);
      } catch(e) {
      }
      return 0;
   }
};

function DeviceContainer(parent, deviceType) {
    this._init(parent, deviceType);
}

DeviceContainer.prototype = {
   __proto__: CategoryContainer.prototype,

   _init: function(parent, deviceType) {
      CategoryContainer.prototype._init.call(this, parent);
      this._deviceType = deviceType;
      this._listDevices = new Array();
      this._capacityDetect = true;
      this._unEjecting = false;
      this._unmountAll = true;
      this._openConnect = true;
      this._displayMessage = true;
   },

   addDevice: function(device) {
      this._listDevices.push(device);
      let _dr = this.addDriveContainer();
      _dr.setLeftTopText(this.getDeviceName(device));
      
      switch(this._deviceType) {
         case "OpticalMount":
            _dr.setDriveIcon(this._theme, "cdrom", Lang.bind(this, this._onDriveClicked));
            _dr.setEjectIcon(this._theme, "eject", Lang.bind(this, this._onDriveEject));
            _dr.addMeter();
            this._initializeOptical();
            break;
         case "OpticalUmount":
            _dr.setDriveIcon(this._theme, "cdrom", Lang.bind(this, this._onDriveClicked));
            _dr.setEjectIcon(this._theme, "inject", Lang.bind(this, this._onDriveInject));
           /* _dr.setDriveIcon(this._theme, "cdrom", null);
            this.updateOpticalByIdentifier(this._getIdentifier(device));*/
            break;
         case "RemovableMount":
            _dr.setDriveIcon(this._theme, "usb", Lang.bind(this, this._onDriveClicked));
            _dr.setEjectIcon(this._theme, "eject", Lang.bind(this, this._onDriveEject));
            _dr.addMeter();
            break;
         case "RemovableUmount":
            _dr.setDriveIcon(this._theme, "usb", null);
            _dr.setEjectIcon(this._theme, "inject", Lang.bind(this, this._onDriveInject));
            break;
         case "HardMount":
            _dr.setDriveIcon(this._theme, "volume", Lang.bind(this, this._onDriveClicked));
            _dr.setEjectIcon(this._theme, "eject", Lang.bind(this, this._onDriveEject));
            _dr.addMeter();
            break;
         case "HardUmount":
            _dr.setDriveIcon(this._theme, "volume", null);
            _dr.setEjectIcon(this._theme, "inject", Lang.bind(this, this._onDriveInject));
            break;
         case "NotDriveMount":
            _dr.setDriveIcon(this._theme, "volume", Lang.bind(this, this._onDriveClicked));
            _dr.setEjectIcon(this._theme, "eject", Lang.bind(this, this._onDriveEject));
            _dr.addMeter();
            break;
         case "NotDriveUmount":
            _dr.setDriveIcon(this._theme, "volume", null);
            _dr.setEjectIcon(this._theme, "inject", Lang.bind(this, this._onDriveInject));
            break;
         case "Empty":
            _dr.setDriveIcon(this._theme, "drive", null);
            _dr.setEjectIcon(this._theme, "empty", null);
            break;
      }
      this.update();
   },

   getNativeIcon: function(dr) {
      let index = this._listDriveContainer.indexOf(dr);
      if(index != -1) {
         let gicon = this._listDevices[index].get_icon();
         return new St.Icon({gicon: gicon});
      }
      return null;
   },

   indexOfDevice: function(device) {
      return this._listDevices.indexOf(device);
   },

   deviceIs: function(device) {
      try {
        device.get_volumes();
        return "GDrive";
      } catch(e) {   
         try {
           device.get_mount();
         } catch(f) {
           return "GVolume";
         }  
      }
      return "GMount";
   },

   _initializeOptical: function() {
      if(this._deviceType == "OpticalMount") {
      // Search in /proc/partitions sr0 in name and take blocks, from update Optical capacity.
         let _linesPartitions = this._parent._sys.readFile("/proc/partitions").split("\n");
         let _partitionsArray = new Array();
         let _token;
         for(let i = 0; i < _linesPartitions.length; i++)
         {
            if(_linesPartitions[i].length > 0) {
               _token = _linesPartitions[i].split(/\s+/);
               if(_token.length > 4)
                  _partitionsArray.push(_token);
            }
         }
         let _sizeDr, _usedDr;
         let _current = this._listDevices.length - 1;
         let  _id = this._getIdentifier(this._listDevices[_current].get_volume()).substring(5);
         for(let i = 0; i < _partitionsArray.length; i++) {
            if(_partitionsArray[i][4] == _id) {
               _sizeDr = _partitionsArray[i][3]*1024;
               if(_sizeDr < 10240)
                  _usedDr = 0;
               else
                  _usedDr = _partitionsArray[i][3]*1024;
               this._listDriveContainer[_current].setLeftBottomText("" + this.convertToString(_usedDr) + "/" + this.convertToString(_sizeDr));
               this._listDriveContainer[_current].setMeterImage(0, _usedDr, _sizeDr);
            }
         }
      }
   },

   setCapacityDetect: function(capacityDetect) {
      this._capacityDetect = capacityDetect;
   },

   getIndexOfDeviceByIdentifier: function(deviceId) {
      let _currDevice;
      for(let _currIndexDevice in this._listDevices)
      {
         _currDevice = this._listDevices[_currIndexDevice];  
         if(this._getIdentifier(_currDevice) == deviceId)
            return _currIndexDevice;
      }
      return -1;
   },

   removeDevice: function(device) {
      let _index = this.indexOfDevice(device);
      if(_index != -1) {
         this.removeDriver(_index);
         this._listDevices.splice(_index, 1);
         return true;
      }
      return false;
   },

   remplaceDevice: function(device) {
      let _index = this.indexOfDevice(device);
      if(_index != -1) {
         this._listDevices[_index] = device;
         return true;
      }
      return false;
   },

   getDeviceName: function(device) {
      try {
         return device.get_mount().get_name();
      } catch(e) {
         return device.get_name();
      }
   },

   getDriveUsedSpace: function(deviceMount) {
      let _attribute = "filesystem::used";
      try {   
         return deviceMount.get_mount().get_root().query_filesystem_info(_attribute, null).get_attribute_uint64(_attribute);
      } catch(e) {
         try {
            return deviceMount.get_root().query_filesystem_info(_attribute, null).get_attribute_uint64(_attribute);
         } catch(e) {
         }
      }
      return 0;
   },

   getDriveSize: function(deviceMount) {
      let _attribute = "filesystem::size";
      try {
         return deviceMount.get_mount().get_root().query_filesystem_info(_attribute, null).get_attribute_uint64(_attribute);
      } catch(e) {
         try {
            return deviceMount.get_root().query_filesystem_info(_attribute, null).get_attribute_uint64(_attribute);
         } catch(e) {
         }
      }
      return 0;
   },

   getDevicePath: function(deviceMount) {
      try {
         return deviceMount.get_mount().get_root().get_path();
      } catch(e) {
         try {
            return deviceMount.get_root().get_path();
         } catch(e) {
         }
      }
      return "";
   },

   getMountBrothers: function(deviceMount) {
      let listOfMounts = new Array();
      try {
         let listOfVolumes = deviceMount.get_drive().get_volumes();

         let mount;
         for(let pos in listOfVolumes) {
            mount = listOfVolumes[pos].get_mount();
            if(mount)
               listOfMounts.push(mount);
         }
      } catch (e) {}
      return listOfMounts;
   },

   _getIdentifier: function(deviceVolume) {
      return deviceVolume.get_identifier(Gio.VOLUME_IDENTIFIER_KIND_UNIX_DEVICE);
   },

   openMountDrive: function(_index) {
      if((_index > -1)&&(_index < this._listDevices.length)) {
         let _volume = this._listDevices[_index];//Only volume have click...
         if(_volume) {
            let urlPath = this.getDevicePath(_volume); //A volume need to be mount, or don't have mount point to open.
            if(urlPath) {
               Util.spawnCommandLine("xdg-open '" + urlPath + "'");
            } else {
               Main.notifyError(_("Failed of Drives Manager:") + " " + _("Can't find the mount point."));
            }
         } else {
            Main.notifyError(_("Failed of Drives Manager:") + " " + _("Can't find the mount point."));
         }
      }
   },

   unEjecting: function(unEjecting) {
      this._unEjecting = unEjecting;
   },

   unmountAll: function(unmountAll) {
      this._unmountAll = unmountAll;
   },

   openOnConnect: function(open) {
      this._openConnect = open;
   },

   displayMessage: function(show) {
      this._displayMessage = show;
   },

   _onDriveClicked: function(button) {
      this.openMountDrive(this.indexOfDriverButton(button));
   },

/*
   _isOpticalClosed: function(opticalDrive) {
      if((this.deviceIs(opticalDrive) == "GDrive")&&(!opticalDrive.has_volumes()))
      {
         let _deviceName = this._getIdentifier(opticalDrive);
         if(_deviceName) {
            let [res, out, err, status] = GLib.spawn_command_line_sync('cdrecord -V --inq dev=' + _deviceName);
            let _closeErr = err.toString().indexOf("tray closed");
            let _closeOut = out.toString().indexOf("tray closed");
            return ((_closeErr != -1)||(_closeErr != -1));
         }
      }          
      return true;
   },

   updateOpticalByIdentifier: function(deviceId) {
      let index = this.getIndexOfDeviceByIdentifier(deviceId);
      if(index != -1) {
         let drContainer = this.getDriveContainer(index);
         let opticalClose = this._isOpticalClosed(this._listDevices[index]);
         let ejectName = drContainer.getEjectName();
         if(ejectName) {
            //Main.notify("find:" + ejectName + " close:" + opticalClose)
            if((ejectName == "inject")&&(opticalClose)) {
               drContainer.setEjectIcon(this._theme, "eject", Lang.bind(this, this._onOpticalEject));
               if(this._displayMessage)
                  Main.notify(_("The device has been loaded."));
            }
            else if((ejectName == "eject")&&(!opticalClose)) {
               drContainer.setEjectIcon(this._theme, "inject", Lang.bind(this, this._onOpticalInject));
               if(this._displayMessage)
                  Main.notify(_("The device has been ejected."));
            }
         } else {
            if(opticalClose)
               drContainer.setEjectIcon(this._theme, "eject", Lang.bind(this, this._onOpticalEject));
            else
               drContainer.setEjectIcon(this._theme, "inject", Lang.bind(this, this._onOpticalInject));
            
         }
         //Util.spawnCommandLine("eject -i on " + deviceId);//"/lib/udev/cdrom_id --lock-media /dev/sr0"
            //Need to lock optical drive for active gudev events.
         return true;
      } 
      return false;
   },

   ejectOpticalByCommand: function(deviceId) {
      //Used for a bug in udev: https://bugs.launchpad.net/ubuntu/+source/udev/+bug/875543
      //Util.spawnCommandLine("eject -i off " + deviceId);
      Util.spawnCommandLine("eject -T " + deviceId);   
   },

   _onOpticalEject: function(button) {
      let _index = this.indexOfEjectButton(button);
      if(_index != -1) 
      {
         let _drive = this._listDevices[_index];
         let _id;
         try {
            let _volume = _drive.get_volume();
            _id = this._getIdentifier(_volume);
            if(_volume.can_eject()) {
               let _mountOp = new CinnamonMountOperation.CinnamonMountOperation(_volume);
               _volume.eject_with_operation(Gio.MountUnmountFlags.NONE, _mountOp.mountOp, null, Lang.bind(this, this._onEjectFinish));
            }
            else {
               _id = this._getIdentifier(_drive);
               this.ejectOpticalByCommand(_id);
               this.updateOpticalByIdentifier(_id);
               this._listDriveContainer[_index].enableClickedEject();
               // this._timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._update));
            }
         } catch (e) {
            _id = this._getIdentifier(_drive);
            this.ejectOpticalByCommand(_id);
            this.updateOpticalByIdentifier(_id);
            this._listDriveContainer[_index].enableClickedEject();
         }
      }
   },

   _onOpticalInject: function(button) {
      let _index = this.indexOfEjectButton(button);
      if(_index != -1) 
      {
         let _drive = this._listDevices[_index];
         if(_drive.can_mount())
            this._onDriveInject(button);
         let _id = this._getIdentifier(_drive);
         this.ejectOpticalByCommand(_id);
         this._listDriveContainer[_index].enableClickedEject();//Enabled event click.
         this.updateOpticalByIdentifier(_id);
        // Main.notify(_("Device Inject"));
      }
   },
*/
   _onDriveEject: function(button) {
      let _index = this.indexOfEjectButton(button);
      if(_index != -1) {
         let _volume = this._listDevices[_index]; //Only mount have Eject...?
         let _mount;
         try {
            _mount = _volume.get_mount(); 
         } catch (e) {
            _mount = _volume;
         }
         try {
            let listToUnmount;
            if((this._deviceType != "OpticalMount")&&(this._deviceType != "NotDriveMount")&&
               (this._unEjecting)&&(this._unmountAll)) {
               listToUnmount = this.getMountBrothers(_mount);
            } else {
               listToUnmount = [];
               listToUnmount.push(_mount);
            }
            for(let mountPos in listToUnmount) {
               let _mountOp = new CinnamonMountOperation.CinnamonMountOperation(listToUnmount[mountPos]);
               if((listToUnmount[mountPos].can_eject())&&((!this._unEjecting)||(this._deviceType == "OpticalMount"))) {
                  listToUnmount[mountPos].eject_with_operation(Gio.MountUnmountFlags.NONE, _mountOp.mountOp, null, Lang.bind(this, this._onEjectFinish));
               }
               else if(listToUnmount[mountPos].can_unmount()) {
                  listToUnmount[mountPos].unmount_with_operation(Gio.MountUnmountFlags.NONE, _mountOp.mountOp, null, Lang.bind(this, this._onUnmountFinish));
               }
            }
         } catch (e) {
            Main.notifyError(_("Failed of Drives Manager:"), e.message);
         }
      }
   },

   _onDriveInject: function(button) {
      let _index = this.indexOfEjectButton(button);
      if(_index != -1) {
         let _mount = this._listDevices[_index]; //Only volume have Inject...
         let _volume;
         try {
            _volume = _mount.get_volume();
         } catch (e) {
            _volume = _mount;
         }
         if(_volume) {//Test Gio.MountUnmountFlags.FORCE
            try {
               let _mountOp = new CinnamonMountOperation.CinnamonMountOperation(_volume);
               if(_volume.can_mount()) {
                  _volume.mount(Gio.MountUnmountFlags.NONE, _mountOp.mountOp, null, Lang.bind(this, this._onVolumeMountedFinish));
               }
            } catch(e) {
               Main.notifyError(_("Failed of Drives Manager:"), e.message);
            }
         }
      }
   },

   _onEjectFinish: function(mount, result) {
      try {
         mount.eject_with_operation_finish(result);
         //Main.notify(_("The device has been ejected."));
      } catch(e) {
         Main.notifyError(_("Failed of Drives Manager:"), e.message);
      }
   },

   _onUnmountFinish: function(mount, result) {
      try {
         mount.unmount_with_operation_finish(result);
        // Main.notify(_("The device has been ejected."));
      } catch(e) {
         Main.notifyError(_("Failed of Drives Manager:"), e.message);
      }
   },

   _onVolumeMountedFinish: function(volume, result) {
      try {
         volume.mount_finish(result);
      } catch (e) {
         Main.notifyError(_("Failed of Drives Manager:"), e.message);
      }
   },

   update: function() {
      if(this._capacityDetect)
      {
         let _sizeDr;
         let _usedDr;
         if((this._deviceType == "RemovableMount")||(this._deviceType == "HardMount")) {
            for(let i = 0; i < this._listDriveContainer.length; i++) {
               _sizeDr = this.getDriveSize(this._listDevices[i]);
               _usedDr = this.getDriveUsedSpace(this._listDevices[i]);
               this._listDriveContainer[i].setLeftBottomText("" + this.convertToString(_usedDr) + "/" + this.convertToString(_sizeDr));
               this._listDriveContainer[i].setMeterImage(0, _usedDr, _sizeDr);
            }
         }
      }
   }
};

function VolumeMonitor(globalContainer) {
    this._init(globalContainer);
}

VolumeMonitor.prototype = {

   _init: function(globalContainer) {
      this._unEjecting = false;
      this._unmountAll = true;
      this._openConnect = true;
      this._capacityDetect = true;
      this._displayMessage = true;
      this._autoMount = false;
      this._globalContainer = globalContainer;
      this._monitor = Gio.VolumeMonitor.get();
      this._client = new GUdev.Client ({subsystems: ["block"]});
      this._volumeMonitorSignals = [];
      this._idGuDev;

      this._settings = new Gio.Settings({ schema: "org.gnome.desktop.media-handling" });
      this._volumeQueue = [];
      try {
         this._ssProxy = new ScreenSaver.ScreenSaverProxy();
         if(this._ssProxy.connectSignal)
            this._ssProxy.connectSignal('ActiveChanged', Lang.bind(this, this._screenSaverActiveChanged));
         else
            this._ssProxy.connect('ActiveChanged', Lang.bind(this, this._screenSaverActiveChanged));
      } catch(e) {
         global.log(e);
      }

      this.connect();
      this._createCategories();
   },

   connect: function() {
     this._volumeMonitorSignals = [];
     let id = this._monitor.connect('mount-added', Lang.bind(this, this._onMountAdded));
     this._volumeMonitorSignals.push(id);
     id = this._monitor.connect('mount-removed', Lang.bind(this, this._onMountRemoved));
     this._volumeMonitorSignals.push(id);
     id = this._monitor.connect('volume-added', Lang.bind(this, this._onVolumeAdded));
     this._volumeMonitorSignals.push(id);
     id = this._monitor.connect('volume-removed', Lang.bind(this, this._onVolumeRemoved));
     this._volumeMonitorSignals.push(id);
     id = this._monitor.connect('drive-connected', Lang.bind(this, this._onDriveConnected));
     this._volumeMonitorSignals.push(id);
     id = this._monitor.connect('drive-disconnected', Lang.bind(this, this._onDriveDisconnected));
     this._volumeMonitorSignals.push(id);
     //id = this._monitor.connect('drive-changed', Lang.bind(this, this._onDriveChange));
     //this._volumeMonitorSignals.push(id);
     //id = this._monitor.connect('drive-eject-button', Lang.bind(this, this._onDriveEjectButton));
     //this._volumeMonitorSignals.push(id);
     //this._idGuDev = this._client.connect('uevent', Lang.bind(this, this.on_uevent));
   },
/*
   on_uevent: function(client, action, device) {
      let _deviceId = device.get_device_file();
      if(_deviceId)
         this._listCategory[1].updateOpticalByIdentifier(_deviceId);
   },
*/

   _screenSaverActiveChanged: function(proxy, senderName, [isActive]) {
      if (!isActive) {
         this._volumeQueue.forEach(Lang.bind(this, function(volume) {
            this._checkAndMountVolume(volume);
         }));
      }

      // clear the queue anyway
      this._volumeQueue = [];
   },

   _checkAndMountVolume: function(volume, params) {
      params = Params.parse(params, { checkSession: true,
                                      useMountOp: true });

      if (!this._autoMount || !volume.should_automount() || !volume.can_mount() || volume.get_mount())
         return false;

      if((this._ssProxy)&&(this._ssProxy.screenSaverActive)) {
         if (this._volumeQueue.indexOf(volume) == -1)
            this._volumeQueue.push(volume);
      }
      this._mountVolume(volume, null);
      return true;
   },

   _mountVolume: function(volume, operation) {
      volume.mount(0, operation, null, Lang.bind(this, this._onVolumeMounted));
   },

   _onVolumeMounted: function(volume, res) {
      try {
         volume.mount_finish(res);
      } catch (e) {
         log('Unable to mount volume ' + volume.get_name() + ': ' +
             e.toString());
      }
   },

   _onVolumeAdded: function(monitor, volume) {
      this._checkAndMountVolume(volume);
      this._createCategories();
   },

   _onVolumeRemoved: function(monitor, volume) {
      this._volumeQueue = this._volumeQueue.filter(function(element) {
         return (element != volume);
      });
      this._createCategories();
   },

   _onDriveConnected: function() {
      this._createCategories();
   },

   _onDriveDisconnected: function() {
      this._createCategories();
   },

//   _onDriveChange: function() {
//      Main.notify("changed");
//   },

//   _onDriveEjectButton: function() {
//      Main.notify("Eject Button");
//   },

   disconnect: function() {
      for(let i = 0; i < this._volumeMonitorSignals.length; i++)
         this._monitor.disconnect(this._volumeMonitorSignals[i]);
      if(this._idGuDev)
         this._client.disconnect(this._idGuDev);
   },

   _createCategories: function() {
      let _indexCategory = this._globalContainer.countCategoryContainer();
      if(this._listCategory) {
         _indexCategory = this._globalContainer.indexOfCategoryContainer(this._listCategory[0]);
         for(let i = 0; i < this._listCategory.length; i++) {
            this.listConnect[i] = this._globalContainer.isCategoryConnectByIndex(_indexCategory);
            this._globalContainer.removeCategoryContainerByIndex(_indexCategory);
         }
      } else {
         this.listConnect = new Array(true, true, true, true, true, true, true);
      }

      this._listCategory = new Array();
      this._listCategory.push(new DeviceContainer(this._globalContainer, "OpticalMount"));
      this._globalContainer.insertCategoryContainer(this._listCategory[0], _indexCategory);
      if(this.listConnect[0]) this._globalContainer.connectCategory(this._listCategory[0]);

      this._listCategory.push(new DeviceContainer(this._globalContainer, "OpticalUmount"));
      this._globalContainer.insertCategoryContainer(this._listCategory[1], _indexCategory + 1);
      if(this.listConnect[1]) this._globalContainer.connectCategory(this._listCategory[1]);

      this._listCategory.push(new DeviceContainer(this._globalContainer, "RemovableMount"));
      this._globalContainer.insertCategoryContainer(this._listCategory[2], _indexCategory + 2);
      if(this.listConnect[2]) this._globalContainer.connectCategory(this._listCategory[2]);

      this._listCategory.push(new DeviceContainer(this._globalContainer, "RemovableUmount"));
      this._globalContainer.insertCategoryContainer(this._listCategory[3], _indexCategory + 3);
      if(this.listConnect[3]) this._globalContainer.connectCategory(this._listCategory[3]);

      this._listCategory.push(new DeviceContainer(this._globalContainer, "HardMount"));
      this._globalContainer.insertCategoryContainer(this._listCategory[4], _indexCategory + 4);
      if(this.listConnect[4]) this._globalContainer.connectCategory(this._listCategory[4]);

      this._listCategory.push(new DeviceContainer(this._globalContainer, "HardUmount"));
      this._globalContainer.insertCategoryContainer(this._listCategory[5], _indexCategory + 5);
      if(this.listConnect[5]) this._globalContainer.connectCategory(this._listCategory[5]);

      this._listCategory.push(new DeviceContainer(this._globalContainer, "NotDriveMount"));
      this._globalContainer.insertCategoryContainer(this._listCategory[6], _indexCategory + 6);
      if(this.listConnect[6]) this._globalContainer.connectCategory(this._listCategory[6]);

      this._listCategory.push(new DeviceContainer(this._globalContainer, "NotDriveUmount"));
      this._globalContainer.insertCategoryContainer(this._listCategory[7], _indexCategory + 7);
      if(this.listConnect[7]) this._globalContainer.connectCategory(this._listCategory[7]);

      this._listCategory.push(new DeviceContainer(this._globalContainer, "Empty"));
      this._globalContainer.insertCategoryContainer(this._listCategory[8], _indexCategory + 8);
      if(this.listConnect[8]) this._globalContainer.connectCategory(this._listCategory[8]);
      let _listDrives = this._monitor.get_connected_drives();
      for(let i = 0; i < _listDrives.length; i++) {
         this._insertInCategory(_listDrives[i]);
      }
      // add all volumes that is not associated with a drive //
      let _listVolumes = this._monitor.get_volumes();
      for(let i = 0; i < _listVolumes.length; i++) {
         if(!_listVolumes[i].get_drive()) {
            if(_listVolumes[i].get_mount())
               this._listCategory[6].addDevice(_listVolumes[i]);
            else
               this._listCategory[7].addDevice(_listVolumes[i]);
         }
      }

      // add mounts that have no volume (/etc/mtab mounts, ftp, sftp,...) //
      let _listMounts = this._monitor.get_mounts();
      for(let i = 0; i < _listMounts.length; i++) {
         if((!_listMounts[i].is_shadowed())&&(!_listMounts[i].get_volume())) {
            this._listCategory[6].addDevice(_listMounts[i]);
         }
      }

      this.setCapacityDetect(this._capacityDetect);
      this.openOnConnect(this._openConnect);
      this.unEjecting(this._unEjecting);
      this.unmountAll(this._unmountAll);
      this.displayMessage(this._displayMessage);
      this._globalContainer.overrideTheme(this._globalContainer._overrideTheme);
   },

   _insertInCategory: function(drive) {
      if(drive) {
         let _listVols = drive.get_volumes();
         for(let j = 0; j < _listVols.length; j++) {
            if(_listVols[j].get_mount()) {
               if(this._isOptical(drive))
                  this._listCategory[0].addDevice(_listVols[j].get_mount());
               else if(drive.can_eject())
                  this._listCategory[2].addDevice(_listVols[j].get_mount());
               else
                  this._listCategory[4].addDevice(_listVols[j].get_mount());
            }
            else if(this._isOptical(drive))
               this._listCategory[1].addDevice(_listVols[j]);
            else if(drive.can_eject())
               this._listCategory[3].addDevice(_listVols[j]);
            else
               this._listCategory[5].addDevice(_listVols[j]);
         }
         if(_listVols.length == 0)
         {
            if((this._isOptical(drive))&&(drive.can_poll_for_media())) {
               this._listCategory[1].addDevice(drive);
            } else 
               this._listCategory[8].addDevice(drive);
         }
      }
   },

   _removeDevice: function(device) {
      if(device) {   
         for(let _categoryIndex in this._listCategory)
         {
            if(this.getCategory(_categoryIndex).removeDevice(device))
               return true;
         }
      }
      return false;
   },

   setCapacityDetect: function(capacityDetect) {
      this._capacityDetect = capacityDetect;
      for(let category in this._listCategory)
         this._listCategory[category].setCapacityDetect(capacityDetect);
   },

   openOnConnect: function(open) {
      this._openConnect = open;
      for(let category in this._listCategory)
         this._listCategory[category].openOnConnect(open);
   },

   autoMountOnConnect: function(autoMount) {
      this._autoMount = autoMount;
      if(this._autoMount) {
         let volumes = this._monitor.get_volumes();
         let volume;
         for(pos in volumes) {
            volume = volumes[pos];
            if (volume.should_automount() && volume.can_mount() && volume.get_mount())
               return false;
         }
         volumes.forEach(Lang.bind(this, function(volume) {
            this._checkAndMountVolume(volume, { checkSession: false,
                                                useMountOp: false });
         }));
      }
      return true;
   },

   unEjecting: function(unEjecting) {
      this._unEjecting = unEjecting;
      for(let category in this._listCategory)
         this._listCategory[category].unEjecting(unEjecting);
   },

   unmountAll: function(unmountAll) {
      this._unmountAll = unmountAll;
      for(let category in this._listCategory)
         this._listCategory[category].unmountAll(unmountAll);
   },

   displayMessage: function(show) {
      this._displayMessage = show;
      for(let category in this._listCategory)
         this._listCategory[category].displayMessage(show);
   },

   getCategory: function(index) {
      return this._listCategory[index];
   },

   countCategory: function(index) {
      return this._listCategory.length;
   },

   removeCategory: function(index) {
      let category = this._listCategory[index];
      if(category) {
         this._globalContainer.removeCategoryContainer(category);
      }
   },

   removeAllCategory: function() {
      for(let category in this._listCategory) {
         this._globalContainer.removeCategoryContainer(category);
      }
   },

   _isOptical: function(opticalDrive) {
      let _deviceName = this._getIdentifier(opticalDrive);
      if(_deviceName) {
         let device = this._client.query_by_device_file(_deviceName);
         if((device)&&(device.get_property("ID_CDROM") != null))
            return true;
      }	
      return false;
   },

//Monitor
   _onMountAdded: function(monit, mount) {
      this._createCategories();
      //this._insertInCategory(mount.get_drive());
      try {
         if(this._displayMessage)
            Main.notify(_("The device has been loaded."));
         global.play_theme_sound(0, 'device-added-media');
         if(this._openConnect) {
            let urlPath = this.getDevicePath(mount); //A volume need to be mount, or don't have mount point to open.
            if(urlPath) {
               Util.spawnCommandLine("xdg-open '" + urlPath + "'");
            }
         } 
       
       // let listMount = this._monitor.get_mounts();
       //  let valIndex = listMount.indexOf(mount);
       //  if(this._isOptical(mount.get_volume()))
       //     this._listCategory[0].addDevice(listMount[valIndex]);
       //  else
       //     this._listCategory[2].addDevice(listMount[valIndex]);
      
      } catch(e) {
         Main.notifyError(_("Failed of Drives Manager:"), e.message);
      }
   },

   _onMountRemoved: function(monit, mount) {
      try {
        if(this._displayMessage)
           Main.notify(_("The device has been ejected."));
        global.play_theme_sound(0, 'device-removed-media');
        this._createCategories();
      } catch(e) {
         Main.notifyError(_("Failed of Drives Manager:"), e.message);
      }
   },

   getDevicePath: function(deviceMount) {
      try {
         return deviceMount.get_mount().get_root().get_path();
      } catch(e) {
         try {
            return deviceMount.get_root().get_path();
         } catch(e) {
         }
      }
      return "";
   },

   _getIdentifier: function(deviceVolume) {
      return deviceVolume.get_identifier(Gio.VOLUME_IDENTIFIER_KIND_UNIX_DEVICE);	
   }
};

function _(str) {
   let resultConf = Gettext.dgettext("drivesManager@lestcape", str);
   if(resultConf != str) {
      return resultConf;
   }
   return Gettext.gettext(str);
}

function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {

   __proto__: Desklet.Desklet.prototype,

   _init: function(metadata, desklet_id) {
      Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
      this.metadata = metadata;
      this.uuid = this.metadata["uuid"];
      if(!Main.deskletContainer.contains(this.actor)) {
         Main.deskletContainer.addDesklet(this.actor);
      }

      this.sys = new SystemClass.System(this.uuid);
      //this.sys.print_all_device();

      this.sys.execInstallLanguage();
      Gettext.bindtextdomain(this.uuid, GLib.get_home_dir() + "/.local/share/locale");

      this._timeout = null;
      this._myManager = null;
      this._desklet_raised = false;
      this.path = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/" + this.uuid;

      this.setHeader(_("Drives Manager"));
      this.helpFile = Gio.file_new_for_path(this.path + "/" + _("locale/README"));
      if(!this.helpFile.query_exists(null))
         this.helpFile = Gio.file_new_for_path(this.path + "/locale/README");
      this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._menu.addAction(_("Help"), Lang.bind(this, function() {
         Util.spawnCommandLine("xdg-open " + this.helpFile.get_path());
      }));
      this.appletMenuItem = new PopupMenu.PopupSwitchMenuItem(_("Show as Applet"), false);
      this.appletMenuItem.connect('activate', Lang.bind(this, this._onAppletMenuItemActivated));
      this._menu.addMenuItem(this.appletMenuItem);

      this.cinnamonSettings = new Gio.Settings({ schema: "org.cinnamon.desktop.media-handling" });
      this.gnomeSettings = new Gio.Settings({ schema: "org.gnome.desktop.media-handling" });
      this.cinnamonSettings.connect("changed::automount-open", Lang.bind(this, function() {
         this._notOpenSystem = !this.cinnamonSettings.get_boolean("automount-open");
         this._onTypeOpenChanged();
      }));
      this.cinnamonSettings.connect("changed::automount", Lang.bind(this, function() {
         this._notMountSystem= !this.cinnamonSettings.get_boolean("automount");
         this._onTypeMountChanged();
      }));
      this.isOpenConnectRead = false;
      this.isMountConnectRead = false;
      this._initSettings();
      this._createAppletManager();
      this._initComponents();
      this._update();
   },

   _createAppletManager: function() {
      try {
         if(!this._myManager) {
            for(let desklet_id in DeskletManager.deskletObj) {
               let desk = DeskletManager.deskletObj[desklet_id];
               if((desk)&&(desk._uuid == this._uuid)&&(desk._myManager)) {
                  this._myManager = desk._myManager;
               }
            }
            if(!this._myManager) {
               this._myManager = new DeskletAppletManager(this);
            }
         }
      } catch(e) {
         Main.notifyError(_("Failed of Drives Manager:"), e.message);
      }
   },

   setVisibleAppletManager: function(visible) {
      if(this._myManager) {
         if(visible) {
            this._myManager.createAppletInstance();
         } else {
            this._myManager.destroyAppletInstance();
         }
      }
   },

   removed_applet_from_panel: function() {
      if((this._myManager)&&(this._myManager.applet)) {
         this._myManager.applet.swapContextToApplet(this._showAsApplet);
         this.setVisibleAppletManager(false);
      }
   },

   on_applet_removed_from_panel: function() {
      //this._showAsApplet = false;
      this._onRemoveDesklet();
   },

   on_desklet_removed: function() {
      try {
         if(this._showAsApplet) {
            this.removed_applet_from_panel();
         }
         this.hardDisk.destroy();
         this.volumeMonitor.disconnect();
         if(this._timeout > 0) {
            Mainloop.source_remove(this._timeout);
         }
         this.sys.destroy();
         this._myManager = null;
      } catch(e) {
         Main.notifyError(_("Failed of Drives Manager:"), e.message);
      }
   },

   _update: function() {
      if (this.updateInProgress) return;
      this.updateInProgress = true;
      try {
         this.globalContainer.update();
         this.hddTempMonitor.update();
      } catch(e) {
         /*do nothing*/
      } finally {
        this.updateInProgress = false;
      }
      this._timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._update));
   },

   _initComponents: function() {
      try {
         this.globalContainer = new GlobalContainer(this, this.uuid, this.sys);
         this.setContent(this.globalContainer.getContentBox());

         this.hddTempMonitor = new HDDTempMonitor(this.sys);

         this.speedDisk = new SpeedDiskContainer(this.globalContainer);
         this.globalContainer.addCategoryContainer(this.speedDisk);
         this._onShowSpeedMeter();

         this.hardDisk = new HardDiskContainer(this.globalContainer, this.hddTempMonitor);
         this.globalContainer.addCategoryContainer(this.hardDisk);
         this._onShowHardDisk();

//Mainloop.idle_add(Lang.bind(this, function() {
         this.volumeMonitor = new VolumeMonitor(this.globalContainer);

         this._onTypeMountChanged();
         this._onTypeOpenChanged();
         //this._onMountConnect();
         //this._onOpenConnect();

         this._onShowOpticalDrives();
         this._onShowRemovableDrives();
         this._onShowFixedDrives();
         this._onShowNotDrives();
         this._onShowEmptyDrives();
         this._onMeterTimeDelay();

         //this._onShowMainBox();
         //this._onShowDriveBox();
         //this._onThemeChange();
         //this._onFixWidth();
         //this._onFixHeight();
         //this._onEnableAutoscroll();
         //this._onScrollVisibleChange();
         //this._onOverrideTheme();
         //this._onBorderBoxWidth();
         //this._onBorderBoxColor();
         //this._onBoxColor();
         //this._onFontColor();
         //this._onTextTopSize();
         //this._onTextBottomSize();
         //this._onOpacity();

         this._onCapacityDetect();
         this._onUnEjecting();
         this._onUnmountAll();
         this._onDisplayMessageChanged();

         this._onRaiseKeyChange();
         this._onHddTempChanged();
         this._onHddTempPlaySoundChanged();
         this._onHddTempNormalColorChanged();
         this._onHddTempWarningColorChanged();
         this._onHddTempCritialColorChanged();
         this._onHddTempWarningTempChanged();
         this._onHddTempCritialTempChanged();
         this._onShowModeChange();
//}));
      } catch(e) {
         Main.notifyError(_("Failed of Drives Manager:"), e.message);
      }
   },

   _onAppletMenuItemActivated: function() {
      if(this.appletMenuItem._switch.state != this._showAsApplet) {
         this._menu.close(false);
         this._showAsApplet = this.appletMenuItem._switch.state;
         this._onShowModeChange();
      }
   },

   _onShowModeChange: function() {
      this.appletMenuItem._switch.setToggleState(this._showAsApplet);
      if(this._showAsApplet) {
         this.setVisibleAppletManager(this._showAsApplet);
         if((this._myManager)&&(this._myManager.applet)) {
            this._myManager.applet.swapContextToApplet(this._showAsApplet);
            this._myManager.applet.setAppletSymbolicIcon(this._appletSymbolic);
         }
      } else if((this._myManager)&&(this._myManager.applet)) {
         this._myManager.applet.swapContextToApplet(this._showAsApplet);
         this.setVisibleAppletManager(this._showAsApplet);
      }
   },

   _onAppletSymbolicChange: function() {
      if((this._myManager)&&(this._myManager.applet))
         this._myManager.applet.setAppletSymbolicIcon(this._appletSymbolic);
   },

   _onShowMainBox: function() {
      this.globalContainer.showMainBox(this._showMainBox);
   },

   _onShowDriveBox: function() {
      this.globalContainer.showDriveBox(this._showDriveBox);
   },

   _onThemeChange: function() {
      this.globalContainer.setTheme(this._theme);
   },

   _onShowSpeedMeter: function() {
      if(this._showSpeedMeter)
         this.globalContainer.connectCategory(this.speedDisk);
      else
         this.globalContainer.disconnectCategory(this.speedDisk);
   },

   _onShowHardDisk: function() {
      if(this._showHardDrives)
         this.globalContainer.connectCategory(this.hardDisk);
      else
         this.globalContainer.disconnectCategory(this.hardDisk);
   },

   _onShowOpticalDrives: function() {
      if(this._showOpticalDrives) {
         this.globalContainer.connectCategory(this.volumeMonitor.getCategory(0));
         this.globalContainer.connectCategory(this.volumeMonitor.getCategory(1));
      }
      else {
         this.globalContainer.disconnectCategory(this.volumeMonitor.getCategory(0));
         this.globalContainer.disconnectCategory(this.volumeMonitor.getCategory(1));
      }
   },

   _onShowRemovableDrives: function() {
      if(this._showRemovableDrives) {
         this.globalContainer.connectCategory(this.volumeMonitor.getCategory(2));
         this.globalContainer.connectCategory(this.volumeMonitor.getCategory(3));
      }
      else {
         this.globalContainer.disconnectCategory(this.volumeMonitor.getCategory(2));
         this.globalContainer.disconnectCategory(this.volumeMonitor.getCategory(3));
      }
   },

   _onShowFixedDrives: function() {
      if(this._showFixedDrives) {
         this.globalContainer.connectCategory(this.volumeMonitor.getCategory(4));
         this.globalContainer.connectCategory(this.volumeMonitor.getCategory(5));
      }
      else {
         this.globalContainer.disconnectCategory(this.volumeMonitor.getCategory(4));
         this.globalContainer.disconnectCategory(this.volumeMonitor.getCategory(5));
      }
   },

   _onShowNotDrives: function() {
      if(this._showNotDrives) {
         this.globalContainer.connectCategory(this.volumeMonitor.getCategory(6));
         this.globalContainer.connectCategory(this.volumeMonitor.getCategory(7));
      }
      else {
         this.globalContainer.disconnectCategory(this.volumeMonitor.getCategory(6));
         this.globalContainer.disconnectCategory(this.volumeMonitor.getCategory(7));
      }
   },

   _onShowEmptyDrives: function() {
      if(this._showEmptyDrives) {
         this.globalContainer.connectCategory(this.volumeMonitor.getCategory(8));
      }
      else {
         this.globalContainer.disconnectCategory(this.volumeMonitor.getCategory(8));
      }
   },

   _onMeterTimeDelay: function() {
      this.speedDisk.setMeterTimeDelay(this._meterTimeDelay);
   },

   _toggleRaise: function() {
      try {
         if((this._myManager)&&(this._myManager.applet)) {
            this._myManager.applet.menu.toggle();
         } else {
            if(this._desklet_raised)
               this._lower();
            else
               this._raise();
         }
      } catch(e) {
         Main.notify("error", e.message);
         global.logError(e);
      }
   },

   _raise: function() {
      if ( this._desklet_raised || this.changingRaiseState ) return;
      this.changingRaiseState = true;
      this._draggable.inhibit = true;
      this.raisedBox = new RaisedBox();
      this.actor.get_parent().remove_actor(this.actor);
      this.raisedBox.add(this);
      this.raisedBox.connect("closed", Lang.bind(this, this._lower));
      this._desklet_raised = true;
      this.changingRaiseState = false;
   },

   _lower: function() {
      if (!this._desklet_raised || this.changingRaiseState ) return;
      this.changingRaiseState = true;
      this._menu.close();
      if ( this.raisedBox ) this.raisedBox.remove();
      Main.deskletContainer.addDesklet(this.actor);
      this._draggable.inhibit = false;
      DeskletManager.mouseTrackEnabled = -1;
      DeskletManager.checkMouseTracking();
      this._desklet_raised = false;
      this.changingRaiseState = false;
   },


   _onTypeMountChanged: function() { //This will read the current gsetting first, and preserve only the cinnamon value also in gnome.
      try {
         if(this.isMountConnectRead) {
            if(this.gnomeSettings.get_boolean("automount") == this._notMountSystem)
               this.gnomeSettings.set_boolean("automount", !this._notMountSystem);
            if(this.cinnamonSettings.get_boolean("automount") == this._notMountSystem)
               this.cinnamonSettings.set_boolean("automount", !this._notMountSystem);
         } else {
            if(this.cinnamonSettings.get_boolean("automount") == this._notMountSystem) {
               this._notMountSystem = (!this._notOpenSystem); 
            }
            if(this.gnomeSettings.get_boolean("automount") == this._notMountSystem)
               this.gnomeSettings.set_boolean("automount", !this._notMountSystem);
         }
         this._onMountConnect();//if gsetting is active disable Drive Manager.
         this.isMountConnectRead = true;
      } catch(e) {
         Main.notifyError(_("Failed of Drives Manager:"), e.message);
      }
   },

   _onMountConnect: function() {
      if((!this._notMountSystem)&&(this._mountConnect)) //Do not allow set drive manager if gsetting is active. 
         this._mountConnect = (!this._mountConnect);
      this.volumeMonitor.autoMountOnConnect(this._mountConnect);
   },

   _onTypeOpenChanged: function() { //This will read the current gsetting first, and preserve only the cinnamon value also in gnome.
      try {
         if(this.isOpenConnectRead) {
            if(this.gnomeSettings.get_boolean("automount-open") == this._notOpenSystem)
               this.gnomeSettings.set_boolean("automount-open", !this._notOpenSystem);
            if(this.cinnamonSettings.get_boolean("automount-open") == this._notOpenSystem)
               this.cinnamonSettings.set_boolean("automount-open", !this._notOpenSystem);
         } else {
            if(this.cinnamonSettings.get_boolean("automount-open") == this._notOpenSystem) {
               this._notOpenSystem = (!this._notOpenSystem); 
            }
            if(this.gnomeSettings.get_boolean("automount-open") == this._notOpenSystem)
               this.gnomeSettings.set_boolean("automount-open", !this._notOpenSystem);
         }
         this._onOpenConnect();//if gsetting is active disable Drive Manager.
         this.isOpenConnectRead = true;
      } catch(e) {
         Main.notifyError(_("Failed of Drives Manager:"), e.message);
      }
   },

   _onOpenConnect: function() {
      if((!this._notOpenSystem)&&(this._openConnect)) //Do not allow set drive manager if gsetting is active. 
         this._openConnect = (!this._openConnect);
      this.volumeMonitor.openOnConnect(this._openConnect);
   },

   _onFixWidth: function() {
      this.globalContainer.setWidth(this._width);
      this.globalContainer.fixWidth(this._fixWidth);
   },

   _onFixHeight: function() {
      this.globalContainer.setHeight(this._height);
      this.globalContainer.fixHeight(this._fixHeight);
   },

   _onEnableAutoscroll: function() {
      this.globalContainer.setAutoscroll(this._autoscroll);
   },

   _onScrollVisibleChange: function() {
      this.globalContainer.setScrollVisible(this._scrollVisible);
   },

   _onBorderBoxWidth: function() {
      this.globalContainer.setBorderBoxWidth(this._borderBoxWidth);
   },

   _onBorderBoxColor: function() {
      this.globalContainer.setBorderBoxColor(this._borderBoxColor);
   },

   _onOverrideTheme: function() {
      this.globalContainer.overrideTheme(this._overrideTheme);
   },

   _onBoxColor: function() {
      this.globalContainer.setBoxColor(this._boxColor);
   },

   _onFontColor: function() {
      this.globalContainer.setFontColor(this._fontColor);
   },

   _onTextTopSize: function() {
      this.globalContainer.setTopTextSize(this._topTextSize);
   },

   _onTextBottomSize: function() {
      this.globalContainer.setBottomTextSize(this._bottomTextSize);
   },

   _onOpacity: function() {
      this.globalContainer.setOpacity(this._opacity);
   },

   _onCapacityDetect: function() {
      this.hardDisk.setCapacityDetect(this._capacityDetect);
      this.volumeMonitor.setCapacityDetect(this._capacityDetect);
   },

   _onUnEjecting: function() {
      this.volumeMonitor.unEjecting(this._unEjecting);
   },

   _onUnmountAll: function() {
      this.volumeMonitor.unmountAll(this._unmountAll);
   },

   _onDisplayMessageChanged: function() {
      this.volumeMonitor.displayMessage(this._displayMessage);
   },

   _onRaiseKeyChange: function() {
      if(this.keyId)
         Main.keybindingManager.removeHotKey(this.keyId);
      this.keyId = this.uuid + "-raise";
      Main.keybindingManager.addHotKey(this.keyId, this._raiseKey, Lang.bind(this, this._toggleRaise));
   },

   _onHddTempChanged: function() {
      this.hddTempMonitor.enableMonitor(this._hddTempActive);
   },

   _onHddTempPlaySoundChanged: function() {
      this.hddTempMonitor.activeAlarm(this._hddTempSound);
   },

   _onHddTempNormalColorChanged: function() {
      this.hddTempMonitor.setNormalHddTempColor(this._normalHddColor);
   },

   _onHddTempWarningColorChanged: function() {
      this.hddTempMonitor.setWarningHddTempColor(this._warningHddColor);
   },

   _onHddTempCritialColorChanged: function() {
      this.hddTempMonitor.setCritialHddTempColor(this._critialHddColor);
   },

   _onHddTempWarningTempChanged: function() {
      this.hddTempMonitor.setWarningHddTemp(this._warningHddTemp);
   },

   _onHddTempCritialTempChanged: function() {
      this.hddTempMonitor.setCriticalHddTemp(this._criticalHddTemp);
   },

   _initSettings: function() {
      try {
         this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], this.instance_id);

         this.settings.bindProperty(Settings.BindingDirection.IN, "speedMeter", "_showSpeedMeter", this._onShowSpeedMeter, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "hardDrives", "_showHardDrives", this._onShowHardDisk, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "opticalDrives", "_showOpticalDrives", this._onShowOpticalDrives, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "removableDrives", "_showRemovableDrives", this._onShowRemovableDrives, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "fixedDrives",  "_showFixedDrives", this._onShowFixedDrives, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "notDrives",  "_showNotDrives", this._onShowNotDrives, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "emptyDrives", "_showEmptyDrives", this._onShowEmptyDrives, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "meterTimeDelay", "_meterTimeDelay", this._onMeterTimeDelay, null);


         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "notMountSystem", "_notMountSystem", this._onTypeMountChanged, null);
         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "mountConnect", "_mountConnect", this._onMountConnect, null);
         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "notOpenSystem", "_notOpenSystem", this._onTypeOpenChanged, null);
         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "openConnect", "_openConnect", this._onOpenConnect, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "capacityDetect", "_capacityDetect", this._onCapacityDetect, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "unEjecting", "_unEjecting", this._onUnEjecting, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "unmountAll", "_unmountAll", this._onUnmountAll, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "displayMessage", "_displayMessage", this._onDisplayMessageChanged, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "raiseKey", "_raiseKey", this._onRaiseKeyChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "raiseCenter", "_raiseCenter", null, null);

         this.settings.bindProperty(Settings.BindingDirection.IN, "hddTemp", "_hddTempActive", this._onHddTempChanged, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "hddTempSound", "_hddTempSound", this._onHddTempPlaySoundChanged, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "normalHddColor", "_normalHddColor", this._onHddTempNormalColorChanged, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "warningHddColor", "_warningHddColor", this._onHddTempWarningColorChanged, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "critialHddColor", "_critialHddColor", this._onHddTempCritialColorChanged, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "warningHddTemp", "_warningHddTemp", this._onHddTempWarningTempChanged, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "criticalHddTemp", "_criticalHddTemp", this._onHddTempCritialTempChanged, null);

         this.settings.bindProperty(Settings.BindingDirection.IN, "mainBox", "_showMainBox", this._onShowMainBox, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "driveBox", "_showDriveBox", this._onShowDriveBox, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "theme", "_theme", this._onThemeChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "fixWidth", "_fixWidth", this._onFixWidth, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "width", "_width", this._onFixWidth, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "fixHeight", "_fixHeight", this._onFixHeight, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "height", "_height", this._onFixHeight, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "enableAutoscroll", "_autoscroll", this._onEnableAutoscroll, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "scrollVisible", "_scrollVisible", this._onScrollVisibleChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "opacity", "_opacity", this._onOpacity, null);

         this.settings.bindProperty(Settings.BindingDirection.IN, "overrideTheme", "_overrideTheme", this._onOverrideTheme, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "boxColor", "_boxColor", this._onBoxColor, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "fontColor", "_fontColor", this._onFontColor, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "textTopSize", "_textTopSize", this._onTextTopSize, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "textBottomSize", "_textBottomSize", this._onTextBottomSize, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "borderBoxWidth", "_borderBoxWidth", this._onBorderBoxWidth, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "borderBoxColor", "_borderBoxColor", this._onBorderBoxColor, null);

         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "showAsApplet", "_showAsApplet", this._onShowModeChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "appletSymbolic", "_appletSymbolic", this._onAppletSymbolicChange, null);
         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "applet-manager-order", "_appletManagerOrder", null, null);
      } catch (e) {
        // Main.notifyError(_("Failed of Drives Manager:"), e.message);
         global.logError(e);
      }
   }
}
        
function main(metadata, desklet_id) {
   let desklet = new MyDesklet(metadata, desklet_id);
   return desklet;
}
