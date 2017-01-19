// Desklet : Sticky Notes
// Author  : Lester Carballo Pérez
// Email   : lestcape@gmail.com
// Website : https://github.com/lestcape/Sticky-Notes
//
// This is a simple desklet to add sticky notes in the desktop.
// The notes will be saved when a focus of the text editor was lost.
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
//

const DND = imports.ui.dnd;
const Lang = imports.lang;
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const Cinnamon = imports.gi.Cinnamon;
const Applet = imports.ui.applet;
const AppletManager = imports.ui.appletManager;
const Extension = imports.ui.extension;
const Desklet = imports.ui.desklet;
const DeskletManager = imports.ui.deskletManager;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const Tooltips = imports.ui.tooltips;
const Settings = imports.ui.settings;
const Pango = imports.gi.Pango;
const Mainloop = imports.mainloop;
const Gtk = imports.gi.Gtk;
const Util = imports.misc.util;
const Tweener = imports.ui.tweener;
const Keymap = imports.gi.Gdk.Keymap.get_default();
const Signals = imports.signals;
const MIN_WIDTH = 200;
const MIN_HEIGHT = 80;
const DELTA_MIN_RESIZE = 10;
const Gettext = imports.gettext;


function _(str) {
   let resultConf = Gettext.dgettext("stickyNotes@lestcape", str);
   if(resultConf != str) {
      return resultConf;
   }
   return Gettext.gettext(str);
}

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
            Main.notify("error", e.message);
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
            Main.notify("error", e.message);
         }
      }
   }
};

function MyDesklet(metadata, desklet_id){
   this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
   __proto__: Desklet.Desklet.prototype,

   _init: function(metadata, desklet_id) {
      //Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
      this._myInit(metadata, desklet_id);
      this.metadata = metadata;
      this._uuid = this.metadata["uuid"];
      this.newText = "";
     // this.renderFontFamily();
      this.execInstallLanguage();
      Gettext.bindtextdomain(this._uuid, GLib.get_home_dir() + "/.local/share/locale");
      this.setHeader(_("Sticky Notes"));

      if(!Main.deskletContainer.contains(this.actor)) 
         Main.deskletContainer.addDesklet(this.actor);

      this._clipboard = St.Clipboard.get_default();

      this.helpFile = Gio.file_new_for_path(GLib.get_home_dir() + "/.local/share/cinnamon/desklets/"+this._uuid+"/locale/" + _("README"));
      if (!this.helpFile.query_exists(null))
          this.helpFile = Gio.file_new_for_path(GLib.get_home_dir() + "/.local/share/cinnamon/desklets/"+this._uuid+"/locale/" + "README");
		
      this._menu.addAction(_("Help"), Lang.bind(this, function() {
         Util.spawnCommandLine("xdg-open " + this.helpFile.get_path());
      }));
      this._menu.addAction(_("Website"), Lang.bind(this, function() {
         Util.spawnCommandLine("xdg-open http://github.com/lestcape/Sticky-Notes");
      }));

      this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this.copyMenuItem = new PopupMenu.PopupMenuItem(_("Copy"));
      this.copyMenuItem.connect('activate', Lang.bind(this, this._onCopyActivated));
      this._menu.addMenuItem(this.copyMenuItem);

      this.pasteMenuItem = new PopupMenu.PopupMenuItem(_("Paste"));
      this.pasteMenuItem.connect('activate', Lang.bind(this, this._onPasteActivated));
      this._menu.addMenuItem(this.pasteMenuItem);

      this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this.deleteMenuItem = new PopupMenu.PopupMenuItem(_("Delete"));
      this.deleteMenuItem.connect('activate', Lang.bind(this, this._onDeleteActivated));
      this._menu.addMenuItem(this.deleteMenuItem);

      this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this.multInstanceMenuItem = new PopupMenu.PopupSwitchMenuItem(_("Multiple Instances"), false);
      this.multInstanceMenuItem.connect('activate', Lang.bind(this, this._onMultInstanceActivated));
      this._menu.addMenuItem(this.multInstanceMenuItem);

      this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._entryActiveMenu = false;
      this._menu.connect('open-state-changed', Lang.bind(this, this._updateMenu));

      this._themeStaples = "none";
      this._themeStripe = "none";
      this._themePencil = "bluepencil";
      this._boxColor = "#000000";
      this._opacityBoxes = 0.5;
      this._borderBoxWidth = 1;
      this._borderBoxColor = "#ffffff";
      this._textSize = 12;
      this._fontFamily = ""; //Default Font family
      this._fontColor= "#ffffff";
      this._width = 220;
      this._height = 120;
      //this._multInstance = true;
      this._scrollVisible = true;
      this._text = "";
      this.keyPress = 0;
      this.noteCurrent = 0;     
      this.focusIDSignal = 0;
      this.keyPressIDSignal = 0;
      this.pressEventOutIDSignal = 0;
      this.textInsertIDSignal = 0;
      this.textChangeIDSignal = 0;
      this.enterAutoHideButtonsIDSignal = 0;
      this.leaveAutoHideButtonsIDSignal = 0;
      this.scrollIDSignal = 0;
      this.rootBoxChangeIdSignal = 0;
      this.textBoxChangeIdSignal = 0;
      this.visibleNote = true;
      this.deskletRaised = false;
      this.deskletHide = false;
      this.actorResize = null;
      this.resizeIDSignal = 0;
      this.eventLoopResize = 0;
      this.eventLoop = 0;
      this._timeOutResize = 0;
      this._timeOutSettings = 0;
      this.myManager = null;
     // this._untrackMouse();
      try {
         this._updateComplete();
         this._trackMouse();
         this._onAllocationChanged();
      } catch(e) {
         this.showErrorMessage(e.message);
      }
   },

   _myInit: function(metadata, desklet_id) {
        this.metadata = metadata;
        this.instance_id = desklet_id;
        this.actor = new St.BoxLayout({reactive: true, track_hover: true, vertical: true});

        this._header = new St.Bin({style_class: 'desklet-header'});
        this._header_label = new St.Label();
        this._header_label.set_text('Desklet');
        this._header.set_child(this._header_label);

        this.content = new St.Bin();

        this.actor.add_actor(this._header);
        this.actor.add_actor(this.content);

        this._updateDecoration();
        global.settings.connect('changed::desklet-decorations', Lang.bind(this, this._updateDecoration));

        this._menu = new PopupMenu.PopupMenu(this.actor, 0.0, St.Side.LEFT, 0);
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menuManager.addMenu(this._menu);
        Main.uiGroup.add_actor(this._menu.actor);
        this._menu.actor.hide();

        this.actor.connect('button-release-event', Lang.bind(this, this._onButtonReleaseEvent));

        this._uuid = null;
        this._dragging = false;
        this._dragOffset = [0, 0];
        this.actor._desklet = this;
        this.actor._delegate = this;

        this._draggable = DND.makeDraggable(this.actor, {restoreOnSuccess: true, manualMode: true}, Main.deskletContainer.actor);
        this.idPress = this.actor.connect('button-press-event',
                               Lang.bind(this._draggable, this._draggable._onButtonPress));

        this._draggable.connect('drag-begin', Lang.bind(this, this._onDragBegin));
        this._draggable.connect('drag-end', Lang.bind(this, this._onDragEnd));
        this._draggable.connect('drag-cancelled', Lang.bind(this, this._onDragEnd));

        this._drag_end_ids = {"drag-end": 0, "drag-cancelled": 0};
        this._drag_end_ids["drag-end"] = this._draggable.connect('drag-end', Lang.bind(this, function() {
           if(Main._findModal(this.actor) >= 0)
              Main.popModal(this.actor, global.get_current_time());
           else {
              global.stage.set_key_focus(null);
              global.end_modal(global.get_current_time());
              global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
           }
        }));

        this._drag_end_ids["drag-cancelled"] = this._draggable.connect('drag-cancelled', Lang.bind(this, function() {
           if(Main._findModal(this.actor) >= 0)
              Main.popModal(this.actor, global.get_current_time());
           else {
              global.stage.set_key_focus(null);
              global.end_modal(global.get_current_time());
              global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
           }
        }));
   },

   _onDragBegin: function() {
      global.set_stage_input_mode(Cinnamon.StageInputMode.FULLSCREEN);
   },

   _onDragEnd: function() {
      global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
      this._trackMouse();
      this._saveDeskletPosition();
   },

   _updateComplete: function() {
      if(this._timeOutSettings > 0) {
         Mainloop.source_remove(this._timeOutSettings);
         this._timeOutSettings = 0;
      }
      this._initSettings();
      this._initDeskletContruction();
      this.setContent(this.mainBox);

      this.entry.visible = false;//This is need to open note without enter on any line.
      Mainloop.idle_add(Lang.bind(this, function() {
         this.entry.visible = true;
      }));
      if(this.initDeskletType()) {
         this.clutterText.connect('button-press-event', Lang.bind(this, this._onButtonPress));
         this.clutterText.connect('button-release-event', Lang.bind(this, this._onButtonRelease));
         this.textBox.connect('button-press-event', Lang.bind(this, this._onButtonPress));
         this._onSizeChange();
         this._onScrollVisibleChange();
         this._onScrollAutoChange();
         this._onSetAutoHideButtons();
         this._onHideTextBox();
         this._onRaiseKeyChange();
         this._onHideKeyChange();
         this._onSymbolicIcons();
         this.multInstanceMenuItem._switch.setToggleState(this._multInstance);
         this._onStyleChange();
         this.rootBoxChangeIdSignal = this.rootBox.connect('style-changed', Lang.bind(this, this._onOpacityRootChange));
         this.textBoxChangeIdSignal = this.textBox.connect('style-changed', Lang.bind(this, this._onOpacityTextChange));
         this._keyFocusNotifyIDSignal = global.stage.connect('notify::key-focus', Lang.bind(this, this._onKeyFocusChanged));
         this._allocationSignal = this.scrollBox.connect('allocation_changed', Lang.bind(this, this._onAllocationChanged));
         if(this.instance_id == this.getMasterInstance()) {
            if(Main.settingsManager)
               Main.settingsManager.register(this._uuid, this._uuid, this.settings);
            Mainloop.idle_add(Lang.bind(this, function() {
               this._createAppletManager();
               this.setVisibleAppletManager(this._appletManager);
            }));
         }
      }
   },

   _createAppletManager: function() {
      try {
         if(!this.myManager) {
            for(let desklet_id in DeskletManager.deskletObj) {
               let desk = DeskletManager.deskletObj[desklet_id];
               if((desk)&&(desk._uuid == this._uuid)&&(desk.myManager)) {
                  this.myManager = desk.myManager;
               }
            }
            if(!this.myManager) {
               this.myManager = new DeskletAppletManager(this);
            }
         }
      } catch(e) {
         Main.notify("error", e.message);
      }
   },

   _onAppletManagerChange: function() {
      if(this.instance_id == this.getMasterInstance()) {
         this.setVisibleAppletManager(this._appletManager);
      }
   },

   setVisibleAppletManager: function(visible) {
      if(this.myManager) {
         if(visible) {
            this.myManager.createAppletInstance();
         } else {
            this.myManager.destroyAppletInstance();
         }
      }
   },

   _onSetAppletType: function() {
      if((this.myManager)&&(this.myManager.applet)&&(this.instance_id == this.getMasterInstance()))
         this.myManager.applet._onSetAppletType(this._appletCollapsed, this._appletSymbolic);
   },

   on_applet_removed_from_panel: function() {
      this.setVisibleAppletManager(false);
      this._appletManager = false;
   },

   showErrorMessage: function(menssage) {
      Main.notifyError(_("Error"), menssage);
   },

   initDeskletType: function() {
      this.notesList = this.findNotesFromFile();
      this._readListPosition();
      let countInstances = this.getCountInstances();
      if(this._multInstance) {
         let numberInstance = this.getInstanceNumber();
         if((numberInstance == 0)&&(this.notesList.length > 1)&&(countInstances == 1)) {
             this.openAllInstances(countInstances);
         }
         if(numberInstance < this.notesList.length) {
            this.readNoteFromFile(numberInstance);
            this.loadNote(numberInstance);
         } else {
            this.notesList.push([this.maxValueNote() + 1, ""]);
            this.noteCurrent = numberInstance + 1;
            this.reset();
            if(this._raiseNewNote) {
               Mainloop.idle_add(Lang.bind(this, function() {
                  this.raiseInstance(this);
               }));
            }
         }
         return true;
      }
      else if(countInstances == 1) {
         this.readNotesFromFile();
         this.loadNote(0);
         return true;
      }
      Main.notify("Invalid instances " + this.instance_id + " of " + this._uuid + " called.");
      Mainloop.idle_add(Lang.bind(this, function() {
         DeskletManager.removeDesklet(this._uuid, this.instance_id);
      }));
      return false;
   },

   multInstanceUpdate: function() {
      try {
         this.removeAllInstances();
         Mainloop.idle_add(Lang.bind(this, function() {
            this.openAllInstances(0);
         }));
      } catch(e) {
         this.showErrorMessage(e.message);
      }
   },

   openAllInstances: function(currentInstances) {
      try {
         let enabledDesklets = global.settings.get_strv("enabled-desklets");
         let newDeskletID = global.settings.get_int("next-desklet-id");
         let deskletDef, nextDeskletId;
         if(this._multInstance) {
            let countDesklet = this.notesList.length;
            if(countDesklet == 0)
               countDesklet++;
            nextDeskletId = newDeskletID + countDesklet - currentInstances;
            for(let numberInstance = currentInstances; numberInstance < countDesklet; numberInstance++) {
               let monitor = Main.layoutManager.focusMonitor;
               let countMaxDesklet = monitor.width/this.mainBox.get_width();
               let posY = 100*Math.floor(numberInstance/countMaxDesklet) + this._processPanelSize();
               if(posY > monitor.height)
                  posY = 100;
               let posX = Math.floor(numberInstance % countMaxDesklet)*this.mainBox.get_width();

               let storePos;
               if(this.notesList[numberInstance])
                  storePos = this.positions["" + this.notesList[numberInstance][0]];
               if(storePos)
                  deskletDef = (this._uuid + ':%s:%s:%s').format(newDeskletID, storePos[0], storePos[1]);
               else
                  deskletDef = (this._uuid + ':%s:%s:%s').format(newDeskletID, posX, posY);
               enabledDesklets.push(deskletDef);
               newDeskletID++;
            }
         } else {
            nextDeskletId = newDeskletID + 1;
            deskletDef = (this._uuid + ':%s:%s:%s').format(newDeskletID, this._xPosition, this._yPosition);
            enabledDesklets.push(deskletDef);
         }
         global.settings.set_strv("enabled-desklets", enabledDesklets);
         global.settings.set_int("next-desklet-id", nextDeskletId);
      } catch (e) {
         this.showErrorMessage(e.message);
      }
   },

   removeAllInstances: function() {
      let enabledDesklets = global.settings.get_strv("enabled-desklets");
      let def, id;
      for(let idPos in enabledDesklets) {
         def = this._getDeskletDefinition(enabledDesklets[idPos]);
         if((def)&&(def.uuid == this._uuid)) {
            let id = parseInt(def.desklet_id);
            DeskletManager.removeDesklet(this._uuid, id);
         }
      }
      if(this.myManager)
          this.myManager.destroyAppletInstance();
      this.myManager = null;
   },

   destroyDesklet: function() {
      this.on_desklet_removed();
      this._menu.destroy();
      this._menu = null;
      this._menuManager = null;
      this.actor.destroy();
      this.emit('destroy');
   },

   on_desklet_removed: function() {
      this.scrollArea.set_auto_scrolling(false);
      try {
         this.settings.finalize();
      } catch(e) {}
      this._untrackMouse();
      //this.reset();
      if(this.getCountInstances() == 0)
         this.setVisibleAppletManager(false);
      if(this.pressEventOutIDSignal > 0)
         global.stage.disconnect(this.pressEventOutIDSignal);
      this.pressEventOutIDSignal = 0;
      if(this.scrollIDSignal > 0)
         this.scrollBox.disconnect(this.scrollIDSignal);
      this.scrollIDSignal = 0;
      if(this._allocationSignal > 0)
         this.scrollBox.disconnect(this._allocationSignal);
      this._allocationSignal = 0;
      if(this._keyFocusNotifyIDSignal > 0)
         global.stage.disconnect(this._keyFocusNotifyIDSignal);
      this._keyFocusNotifyIDSignal = 0;
      if(this.focusIDSignal > 0)
         this.clutterText.disconnect(this.focusIDSignal);
      this.focusIDSignal = 0;
      if(this.keyPressIDSignal > 0)
         this.clutterText.disconnect(this.keyPressIDSignal);
      this.keyPressIDSignal = 0;
      if(this.textInsertIDSignal > 0)
         this.clutterText.disconnect(this.textInsertIDSignal);
      this.textInsertIDSignal = 0;
      if(this.textChangeIDSignal > 0)
         this.clutterText.disconnect(this.textChangeIDSignal);
      this.textChangeIDSignal = 0;
      if(this.enterAutoHideButtonsIDSignal > 0)
         this.actor.disconnect(this.enterAutoHideButtonsIDSignal);
      this.enterAutoHideButtonsIDSignal = 0;
      if(this.leaveAutoHideButtonsIDSignal > 0)
         this.actor.disconnect(this.leaveAutoHideButtonsIDSignal);
      this.leaveAutoHideButtonsIDSignal = 0;
   },

   getInstanceNumber: function() {
      let currentInstance = parseInt(this.instance_id);
      let resultNumber = 0;
      try {
         let enabledDesklets = global.settings.get_strv("enabled-desklets");
         let def, id;
         for(let idPos in enabledDesklets) {
            def = this._getDeskletDefinition(enabledDesklets[idPos]);
            if((def)&&(def.uuid == this._uuid)) {
               let id = parseInt(def.desklet_id);
               if(id < currentInstance)
                  resultNumber++;
            }
         }
      } catch (e) {
         this.showErrorMessage(e.message);
         resultNumber = -1;
      }
      return resultNumber;
   },

   getAllInstanceObject: function() {
      let resultObject = new Array();
      try {
         let enabledDesklets = global.settings.get_strv("enabled-desklets");
         let def, id;
         for(let idPos in enabledDesklets) {
            def = this._getDeskletDefinition(enabledDesklets[idPos]);
            if((def)&&(def.uuid == this._uuid)) {
               let id = parseInt(def.desklet_id);
               resultObject.push(DeskletManager.get_object_for_instance(id));
            }
         }
      } catch (e) {
         this.showErrorMessage(e.message);
      }
      return resultObject;
   },

   getCountInstances: function() {
      let resultNumber = 0;
      try {
         let enabledDesklets = global.settings.get_strv("enabled-desklets");
         let def, id;
         for(let idPos in enabledDesklets) {
            def = this._getDeskletDefinition(enabledDesklets[idPos]);
            if((def)&&(def.uuid == this._uuid)) {
               resultNumber++;
            }
         }
      } catch (e) {
         this.showErrorMessage(e.message);
         resultNumber = -1;
      }
      return resultNumber;
   },

   getMasterInstance: function() {
      let currentInstance = parseInt(this.instance_id);
      try {
         let enabledDesklets = global.settings.get_strv("enabled-desklets");
         let def, id;
         for(let idPos in enabledDesklets) {
            def = this._getDeskletDefinition(enabledDesklets[idPos]);
            if((def)&&(def.uuid == this._uuid)) {
               let id = parseInt(def.desklet_id);
               if(id < currentInstance)
                  currentInstance = id;
            }
         }
      } catch (e) {
         this.showErrorMessage(e.message);
      }
      return currentInstance;
   },

   _getDeskletDefinition: function(definition) {
      if(!definition)
         return null;
      let elements = definition.split(":");
      if(elements.length == 4) {
         return {
            uuid: elements[0],
            desklet_id: elements[1],
            x: elements[2],
            y: elements[3]
         };
      } else {
         global.logError("Bad desklet definition: " + definition);
         return null;
      }
   },

   _processPanelSize: function() {
      if(Main.panel2)
         return Main.panel2.actor.height;
      return Main.panel.actor.height;
   },

   newNote: function(noteMessage) {
      if((noteMessage)&&(noteMessage != "")&&(noteMessage != _("Type your note..."))) {
         if((this.notesList.length == 0)||(this.noteCurrent > this.notesList.length)) {
            try {
               let maxValue = this.maxValueNote();
               this.noteCurrent = this.notesList.length;
               let strinName = (maxValue + 1).toString();
               this.notesList.push([strinName, noteMessage]);
               this.writeNoteToFile(this.noteCurrent);
               this.numberNote.set_text(this.notesList.length.toString());
               this.noteCurrent = this.notesList.length;
               this.currentNote.set_text(this.noteCurrent.toString());
            } catch(e) {
               this.showErrorMessage(e.message);
            }
         } else {
            if(this.noteCurrent == 0)
               this.noteCurrent++;
            if(this.notesList[this.noteCurrent - 1][1] != noteMessage) {
               this.notesList[this.noteCurrent - 1][1] = noteMessage;
               this.writeNoteToFile(this.noteCurrent - 1);
            }
         }
      }
   },

   maxValueNote: function(noteMessage) {
      let maxValue = 0;
      let currValue;
      for(let pos in this.notesList) {
         currValue = parseInt(this.notesList[pos][0]);
         if(currValue > maxValue)
            maxValue = currValue;
      }
      return maxValue;
   },

   loadNote: function(pos) {
      if((this.notesList.length == 0)||(pos < 0)||(pos > this.notesList.length)) {
         this.noteCurrent = 1;
         this.reset();
      } else {
         this.noteCurrent = pos + 1;
         this.entry.text = this.notesList[pos][1];
      }
      this.numberNote.set_text(this.notesList.length.toString());
      this.currentNote.set_text(this.noteCurrent.toString());
      this._text = this.entry.text;
      this.titleNote.set_text(this.entry.text);
   },

   writeNoteToFile: function(pos) {
      if((pos > -1)&&(pos < this.notesList.length)) {
         try {
            let output_file = Gio.file_new_for_path(GLib.get_home_dir() + "/.local/share/notes/" + this.notesList[pos][0] + ".note");
            this._makeDirectoy(output_file.get_parent());
            this.deleteNote(pos);
            let raw = output_file.replace(null, false, Gio.FileCreateFlags.NONE, null);
            let out_file = Gio.BufferedOutputStream.new_sized (raw, 4096);
            Cinnamon.write_string_to_stream(out_file, this.notesList[pos][1]);
            out_file.close(null);
            return true;
         } catch(e) {
            this.showErrorMessage(e.message);
         }
      }
      return false;
   },

   deleteNote: function(pos) {
      if((pos > -1)&&(pos < this.notesList.length)) {
         let file = Gio.file_new_for_path(GLib.get_home_dir() + "/.local/share/notes/" + this.notesList[pos][0] + ".note");
         if(file.query_exists(null))
            return file.delete(null, null);
      } 
      return false;
   },

   readNotesFromFile: function() {
      try {
         for(let pos in this.notesList) {
            this.readNoteFromFile(pos);
         }
      } catch(e) {
         this.showErrorMessage(e.message);
      }
   },

   readNoteFromFile: function(pos) {
      if((pos > -1)&&(pos < this.notesList.length)) {
         let file = Gio.file_new_for_path(GLib.get_home_dir() + "/.local/share/notes/" + this.notesList[pos][0] + ".note");
         if(file.query_exists(null))
         {
            try {
               let data = Cinnamon.get_file_contents_utf8_sync(file.get_path());
               if(data)
                  this.notesList[pos][1] = data;
               else
                  this.notesList[pos][1] = "";
            } catch(e) {
               this.showErrorMessage(e.message);
            }
         } else
            this.showErrorMessage(e.message);
      }
   },

   findNotesFromFile: function() {
      let notes = new Array();
      try {
         let notesFolder = Gio.file_new_for_path(GLib.get_home_dir() + "/.local/share/notes");
         if(!this._isDirectory(notesFolder)) {
            return notes;
         }
         let children = notesFolder.enumerate_children('standard::name,standard::type',
                                                       Gio.FileQueryInfoFlags.NONE, null);
         let info, nameFile, lastIndex;
         while((info = children.next_file(null)) != null) {
            if(info.get_file_type() == Gio.FileType.REGULAR) {
               nameFile = info.get_name();
               lastIndex = nameFile.lastIndexOf(".");
               if(nameFile.substring(lastIndex) == ".note") {
                  notes.push([nameFile.substring(0, lastIndex), ""]);
               }
            }
         }
      } catch(e) {
         this.showErrorMessage(e.message);
      }
      return this._sorting(notes);
   },

   isNoteInList: function(noteName) {
      for(let i = 0; i < this.notesList.length; i++) {
         if(this.notesList[i][0] == noteName)
            return true;
      }
      return false;
   },

   _sorting: function(notes) {
      let valueL, valueF, tempSwap;
      for(let posF = 0; posF < notes.length - 1; posF++) {
         valueF = parseInt(notes[posF][0]);
         for(let posL=posF + 1; posL < notes.length; posL++) {
            valueL = parseInt(notes[posL][0]);
            if(valueL < valueF) {
               tempSwap = notes[posL];
               notes[posL] = notes[posF];
               notes[posF] = tempSwap;
            }
         }
      }
      return notes;
   },

   _onAddNote: function(actor) {
      if(actor)
         this._effectIcon(actor, 0.2);
      if(this._multInstance) {
         let countInstances = this.notesList.length;
         this.openAllInstances(countInstances - 1);
         return true;
      }
      else {
         this.reset();
         this.noteCurrent = this.notesList.length + 1;
         this.currentNote.set_text(this.noteCurrent.toString());
         if(this._raiseNewNote)
            this.raiseInstance(this);
        return true;
      }
      return false
   },

   _onVisibleNoteChange: function(actor, event) {
      this.setVisibleNote(!this.visibleNote);
   },

   setVisibleNote: function(visible) {
      if(this.visibleNote != visible) {
         this.visibleNote = visible;
         if(visible) {
            this.minimizeButton.child.set_icon_name('go-up');
            this.rootBox.add_style_pseudo_class('open');
            this.rootBox.set_style(' ');
            this._changeHideTextBox(true);
            this.scrollArea.visible = true;
            this.bottomBox.visible = true;
            if(this._fSize) {
               this._onSizeChange();
            }
         }
         else {
            this.minimizeButton.child.set_icon_name('go-down');
            this.rootBox.remove_style_pseudo_class('open');
            this.rootBox.set_style(' ');
            this._changeHideTextBox(false);
            this.scrollArea.visible = false;
            this.bottomBox.visible = false;
            this.mainBox.set_height(-1);
         }
      }
   },

   _changeHideTextBox: function(value) {
      if(this._multInstance) {
         if((this.noteCurrent > 0)&&(this.noteCurrent < this.notesList.length + 1)) {
            this._readListHideTextBox();
            let strNote = "" + this.notesList[this.noteCurrent - 1][0];
            this.hideTextBox[strNote] = value;
            this._writeListHideTextBox();
         }
      }      
      else {
         this._hideTextBox = value;
      }
   },

   _onRemoveNote: function(actor) {
      try {
         this._effectIcon(actor, 0.2);
         let exist = false;
         let pos = this.noteCurrent - 1;
         if((pos > -1)&&(pos < this.notesList.length)) {
            let file = Gio.file_new_for_path(GLib.get_home_dir() + "/.local/share/notes/" + this.notesList[pos][0] + ".note");
            exist = file.query_exists(null);
         }
         if(this.deskletRaised)
            this.toggleRaise();
         if(exist) {
            Mainloop.idle_add(Lang.bind(this, function() {
               this.showMessageDelete();
            }));
         } else {
            Mainloop.idle_add(Lang.bind(this, function() {
               DeskletManager.removeDesklet(this._uuid, this.instance_id); 
            }));
         }
      } catch(e) {
         this.showErrorMessage(e.message);
      }
   },

   showMessageDelete: function() {
      this.showMessage(_("Do you want to delete this note?"), [_("Yes"), _("No")], Lang.bind(this, function(buttonPressed) {
         if(buttonPressed == _("Yes")) {
            this._deleteNote();
         }
      }));
   },

   _onRemoveDesklet: function() {
      this.removeAllInstances();
   },

   _deleteNote: function() {
      try {
         if(this._multInstance) {
            if(this.getCountInstances() > 1) {
              // Mainloop.idle_add(Lang.bind(this, function() {
                  DeskletManager.removeDesklet(this._uuid, this.instance_id);
               //}));
            }
            this.reset();
            this.deleteNote(this.noteCurrent - 1);
         } else {
            if(this.notesList.length > 1) { 
               if((this.noteCurrent != 0)&&(this.noteCurrent <= this.notesList.length)) {
                  if(this.deleteNote(this.noteCurrent - 1)) {
                     this.notesList.splice(this.noteCurrent - 1, 1);
                     this.numberNote.set_text(this.notesList.length.toString());
                     if(this.noteCurrent > this.notesList.length) {
                        this.noteCurrent = this.notesList.length;
                        this.currentNote.set_text(this.noteCurrent.toString());
                        this.entry.text = this.notesList[this.noteCurrent - 1][1];
                     } else
                        this.entry.text = this.notesList[this.noteCurrent - 1][1];
                  }
               } else if(this.noteCurrent == 0) {
                  if(this.deleteNote(this.noteCurrent)) {
                     this.notesList.splice(this.noteCurrent, 1);
                     this.entry.text = this.notesList[this.noteCurrent][1];
                     this.numberNote.set_text(this.notesList.length.toString());
                  }
               }
            } else if(this.notesList.length == 1) {
               if(this.deleteNote(0)) {
                  this.noteCurrent = 1;
                  this.notesList.splice(0, 1);
                  this.numberNote.set_text("0");
                  this.currentNote.set_text("1");
                  this.reset();
               }
            }
         }
      } catch(e) {
         this.showErrorMessage(e.message);
      }
   },

   _onBackNote: function(actor) {
      if(this.notesList.length != 0) {
         this._effectIcon(actor, 0.2);
         if((this.noteCurrent == 0)||(this.noteCurrent == 1)) {
            this.noteCurrent = this.notesList.length;
            this.entry.text = this.notesList[this.noteCurrent - 1][1];
            this.currentNote.set_text(this.noteCurrent.toString());
         }
         else if(this.noteCurrent > 0) {
            this.noteCurrent--;
            this.entry.text = this.notesList[(this.noteCurrent - 1)][1];
            this.currentNote.set_text(this.noteCurrent.toString());
         }
      }
   },

   _onNextNote: function(actor) {
      if(this.notesList.length != 0) {
         this._effectIcon(actor, 0.2);
         if(this.noteCurrent == 0) {
            if(this.notesList.length != 1) {
               this.noteCurrent = 2;
               this.entry.text = this.notesList[(this.noteCurrent - 1)][1];
               this.currentNote.set_text(this.noteCurrent.toString());
            }
         }
         else {
            if(this.noteCurrent < this.notesList.length) {
               this.entry.text = this.notesList[this.noteCurrent][1];
               this.currentNote.set_text((this.noteCurrent + 1).toString());
            } else {
               this.noteCurrent = 0;
               this.entry.text = this.notesList[this.noteCurrent][1];
               this.currentNote.set_text((this.noteCurrent + 1).toString());
            }
            this.noteCurrent++;
         }
      }
   },

   _onConfigNote: function(actor) {
      this._effectIcon(actor, 0.2);
      Util.spawn(['cinnamon-settings', 'desklets', this._uuid]);
   },

   _isDirectory: function(fDir) {
      try {
         let info = fDir.query_filesystem_info("standard::type", null);
         if((info)&&(info.get_file_type() != Gio.FileType.DIRECTORY))
            return true;
      } catch(e) {
      }
      return false;
   },

   _makeDirectoy: function(fDir) {
      if(!this._isDirectory(fDir))
         this._makeDirectoy(fDir.get_parent());
      if(!this._isDirectory(fDir))
         fDir.make_directory(null);
   },

   setStyle: function() {
      this.setStripe();
      this.setStaples();
      if(this._overrideTheme) {
         let _colorBox = this.textRGBToRGBA(this._boxColor, this._opacityBoxes);
         let _colorText = this.textRGBToRGBA(this._textBoxColor, this._opacityBoxes);
         let _colorBanner = this.textRGBToRGBA(this._boxColor, 0.1);
         this.rootBox.set_style_class_name('');
         if(this._themeStaples != "none") {
            this.rootBox.set_style('background-color: ' + _colorBox + '; color: ' + this._fontColor + '; border: ' +
                                   this._borderBoxWidth + 'px solid ' + this._borderBoxColor +
                                   '; border-top: none; padding: 0px 4px 0px 4px; font-weight: bold; border-radius: 12px;');
         } else {
            this.rootBox.set_style('background-color: ' + _colorBox + '; color: ' + this._fontColor + '; border: ' +
                                   this._borderBoxWidth + 'px solid ' + this._borderBoxColor +
                                   '; padding: 0px 4px 0px 4px; font-weight: bold; border-radius: 12px;');
         }
         if(this._overrideTextBox) {
            this.textBox.set_style_class_name('');
            this.textBox.set_style('background-color: ' + _colorText + ';' +
                                   'border-radius: 4px; border: 2px solid ' + _colorText + ';');
         }
         else {
            this.textBox.set_style_class_name('sticky-text-box');
            this.textBox.set_style('background-color: ' + _colorText + ';');
         }
         this.buttonBanner.set_style_class_name('');
         this.buttonBanner.set_style('background-color: ' + _colorBanner);
      } else {
         this.rootBox.set_style(' ');
         this.rootBox.set_style_class_name('desklet-with-borders');
         if(this._themeStaples != "none") {
            this.rootBox.add_style_class_name('sticky-main-box-staples');
            this.rootBox.set_style('border-top: none; padding-top: 0px;');
         }
         else 
            this.rootBox.add_style_class_name('sticky-main-box-none');

         this.textBox.set_style_class_name('sticky-text-box');
         this.buttonBanner.set_style_class_name('sticky-button-box');
         this.buttonBanner.set_style(' ');
         this.textBox.set_style(' ');
      }
   },

   setStripe: function() {
      let fontTag = '';
      if((this._fontFamily)&&(this._fontFamily != ""))
         fontTag = 'font-family: ' + this._fontFamily + ';';

      if(this._overrideTheme)
         this.entry.set_style('font-size: ' + this._textSize  + 'pt; color: ' + this._fontColor + '; font-weight: normal; caret-color: ' +
                              this._fontColor + '; selected-color: ' + this._textSelectedColor + ';' + fontTag + ' padding-top: 0px;');
      else
         this.entry.set_style('font-size: ' + this._textSize  + 'pt;' + fontTag + ' padding-top: 0px;');

      if(this._themeStripe != "none") {
         let image = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/" + this._uuid + "/stripe/" + this._themeStripe + "/";
         let textHeight = this._getTextHeight();
         let imageNumber = Math.floor(textHeight);
         let suported = true;
         if(imageNumber != textHeight) {
            let newVal = this._textSize*imageNumber/textHeight;
            if(this._overrideTheme)
               this.entry.set_style('font-size: ' + newVal + 'pt; color: ' + this._fontColor + '; font-weight: normal; caret-color: ' +
                                     this._fontColor + '; selected-color: ' + this._textSelectedColor + ';' + fontTag + ' padding-top: 0px;');
            else
               this.entry.set_style('font-size: ' + newVal + 'pt;' + fontTag + ' padding-top: 0px;');
            textHeight = this._getTextHeight();
         }
         if((imageNumber < 10)||(imageNumber > 60)||(imageNumber != textHeight)) {
            this.showErrorMessage(_("Unsupported text size '%s'  to use the font '%s' in this theme.").format(this._textSize, this._fontFamily));
            this.textAreaBox.set_style('min-width:' + (MIN_WIDTH-30) + 'px;');
         } else {
            this.textAreaBox.set_style('background-image: url(\'' + image + imageNumber + '.png\'); ' +
                                       'background-repeat: repeat; background-position: 0px 0px; ' + 'background-size: auto; ' +
                                       'min-width: ' + (MIN_WIDTH-30) + 'px;');
         }
      } else {
         this.textAreaBox.set_style('min-width: ' + (MIN_WIDTH-30) + 'px;');
      }
   },

   setStaples: function() {
      if(this._themeStaples != "none") {
         let imageG = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/" + this._uuid + "/staples/"+ this._themeStaples +"/";
         this.transpBox.set_style('background-image: url(\'' + imageG + '1.svg\');' +
                                  'background-repeat: repeat; background-position: 0px 0px;');

         this.endBox.set_style('background-image: url(\'' + imageG + '2.svg\');' +
                               'background-repeat: repeat; background-position: 0px 0px;');
         this.transpBox.set_height(10);
         this.endBox.set_height(16);
      } else {
         this.transpBox.set_height(0);
         this.endBox.set_height(0);
      }
   },

   setPencil: function(activePencil) {
      if(activePencil) {
         this.textBox.add_style_pseudo_class('active');
         this.textBox.set_style(' ');
         if(this._themePencil != "none") {
            let image = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/" + this._uuid + "/pencil/" + this._themePencil + ".svg";
            this.pencilBox.set_style(' background-image: url(\'' + image + '\'); background-size:' + this.pencilBox.width +'px ' +
                                     this.pencilBox.height + 'px; max-width: 200px; min-width: 60px; padding: 0px 10px 0px 10px');
         } else {
            this.pencilBox.set_style('max-width: 200px; min-width: 60px; padding: 0px 10px 0px 10px');
         }
      } else {
         this.textBox.remove_style_pseudo_class('active');
         this.textBox.set_style(' ');
         this.pencilBox.set_style('max-width: 200px; min-width: 60px; padding: 0px 10px 0px 10px');
      }
   },

   _getTextHeight: function() {
      let context = this.entry.get_pango_context();
      let themeNode = this.entry.get_theme_node();
      let font = themeNode.get_font();
      let metrics = context.get_metrics(font, context.get_language());
      return Pango.units_to_double(metrics.get_ascent() + metrics.get_descent());
   },

   reset: function () {
      this.titleNote.set_text(_("Type your note..."));
      this.entry.text = "";
      this.setPencil(false);
      global.stage.set_key_focus(null);
   },

   _initDeskletContruction: function() {
      this.mainBox = new St.BoxLayout({ vertical:true });
      this.rootBox = new St.BoxLayout({ vertical:true, reactive: true, track_hover: true });
      this.bannerBox = new St.BoxLayout({vertical:true});
      this.buttonBanner = new St.BoxLayout({ vertical:false, style_class: 'sticky-button-box' });
      this.leftBox = new St.BoxLayout({vertical:false});
      this.centerBox = new St.BoxLayout({vertical:false});
      this.pencilBox = new St.BoxLayout({vertical:true});
      let rightBox = new St.BoxLayout({vertical:false}); 
      this.textBox = new St.BoxLayout({ vertical:true, reactive: true, style_class: 'sticky-text-box' });
      this.textAreaBox = new St.BoxLayout({vertical:true});
      this.textAreaBox.set_style('min-width: ' + (MIN_WIDTH-30) + 'px;');

      this.bottomBox = new St.BoxLayout({ vertical:false, height: 6 });

      this.addButton = this._buttonCreation('list-add', _("Add new Note"), this._symbolicIcons);
      this.addButton.connect('clicked', Lang.bind(this, this._onAddNote));
      this.leftBox.add(this.addButton, {x_fill: true, x_align: St.Align.END});

      this.minimizeButton = this._buttonCreation('go-up', _("Minimize or Maximize the Note"), this._symbolicIcons);
      this.minimizeButton.connect('clicked', Lang.bind(this, this._onVisibleNoteChange));
      this.leftBox.add(this.minimizeButton, {x_fill: true, x_align: St.Align.END});

      this.currentNote = new St.Label({ style_class: 'sticky-information-label' });
      this.currentNote.set_text("1");

      this.numberNote = new St.Label({ style_class: 'sticky-information-label' });
      this.numberNote.set_text("0");

      let separator = new St.Label({ style_class: 'sticky-information-label' });
      separator.set_text("/");

      this.titleNote = new St.Label({ style_class: 'sticky-title-label' });
      this.titleNote.set_text("");
      this.titleNote.set_height(16);
//edit-undo
      this.backButton = this._buttonCreation('go-previous', _("Back Note"), this._symbolicIcons);
      this.backButton.connect('clicked', Lang.bind(this, this._onBackNote));
//edit-redo
      this.nextButton = this._buttonCreation('go-next', _("Next Note"), this._symbolicIcons);
      this.nextButton.connect('clicked', Lang.bind(this, this._onNextNote));

      if(!this._multInstance) {
         this.centerBox.add(this.backButton, {x_fill: false, y_fill: false, expand: true, y_align: St.Align.MIDDLE});
         this.centerBox.add(this.currentNote, {x_fill: false, y_fill: false, expand: true, y_align: St.Align.MIDDLE});
         this.centerBox.add(separator, {x_fill: false, y_fill: false, expand: true, y_align: St.Align.MIDDLE});
         this.centerBox.add(this.numberNote, {x_fill: false, y_fill: false, expand: true, y_align: St.Align.MIDDLE});
         this.centerBox.add(this.nextButton, {x_fill: false, y_fill: false, expand: true, y_align: St.Align.MIDDLE});      
      } else
         this.centerBox.add(this.titleNote, {x_fill: false, y_fill: false, expand: true, y_align: St.Align.MIDDLE});

      this.pencilBox.add(this.centerBox, {x_fill: false, y_fill: false, expand: true, y_align: St.Align.MIDDLE});
      this.setPencil(false);

      this.configButton = this._buttonCreation('preferences-system', _("Configure..."), this._symbolicIcons);
      this.configButton.connect('clicked', Lang.bind(this, this._onConfigNote));

      this.deleteButton = this._buttonCreation('window-close', _("Remove Note"), this._symbolicIcons);
      this.deleteButton.connect('clicked', Lang.bind(this, this._onRemoveNote));
      
      rightBox.add(this.configButton, {x_fill: true, x_align: St.Align.END});
      rightBox.add(this.deleteButton, {x_fill: true, x_align: St.Align.END});

      this.buttonBanner.add(this.leftBox, { x_fill: false, y_fill: false, expand: true, x_align: St.Align.START });
      this.buttonBanner.add(this.pencilBox, { x_fill: true, y_fill: false, expand: false, x_align: St.Align.MIDDLE });
      this.buttonBanner.add(rightBox, { x_fill: false, y_fill: false, expand: true, x_align: St.Align.END });

      this.bannerBox.add(this.buttonBanner, { x_fill: true, y_fill: false, expand: true, x_align: St.Align.MIDDLE, y_align: St.Align.MIDDLE });
      this.bannerBox.set_style('padding-top: 6px;');

      this.entry = new St.Entry({ name: 'sticky-note-entry', hint_text: _("Type your note..."), track_hover: false, can_focus: true});
      this.textBox.add(this.textAreaBox, { x_fill: true, y_fill: true, expand: true, x_align: St.Align.START, y_align: St.Align.START });
      this.textAreaBox.add(this.entry, { x_fill: true, y_fill: false, expand: true, x_align: St.Align.START, y_align: St.Align.START });

      this.transpBox = new St.BoxLayout({vertical:true});
      this.endBoxBackGround = new St.BoxLayout({vertical:true});
      this.endBox = new St.BoxLayout({vertical:false});
      this.endBoxBackGround.add(this.endBox, {x_fill: false, x_align: St.Align.MIDDLE});

      this.rootBox.add(this.endBoxBackGround, {x_fill: true, y_fill: false, expand: false, x_align: St.Align.MIDDLE, y_align: St.Align.START });
      this.rootBox.add(this.bannerBox, { x_fill: true, y_fill: false, expand: false, x_align: St.Align.MIDDLE, y_align: St.Align.START });

      this.mainBox.add(this.transpBox, {x_fill: false, x_align: St.Align.MIDDLE});
      this.mainBox.add(this.rootBox, {x_fill: true, y_fill: true, expand: true, x_align: St.Align.START, y_align: St.Align.START });

      this.clutterText = this.entry.clutter_text;
      this.clutterText.set_single_line_mode(false);
      this.clutterText.set_activatable(false);
      this.clutterText.set_line_wrap(true);
      this.clutterText.set_line_wrap_mode(imports.gi.Pango.WrapMode.WORD_CHAR);
      this.clutterText.set_selectable(true);
//scroll
      this.scrollArea = new St.ScrollView({ name: 'sticky-scrollview', x_fill: true, y_fill: false, y_align: St.Align.START, style_class: 'vfade' });
      this.scrollArea.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);

      this.scrollBox = new St.BoxLayout({vertical:true});
      this.scrollBox.set_style('padding-top: 6px;');
      this.scrollBox.add(this.scrollArea, { x_fill: true, y_fill: true, expand: true, x_align: St.Align.START, y_align: St.Align.START });
     
      this.scrollArea.add_actor(this.textBox);
//scroll
      this.rootBox.add(this.scrollBox, { x_fill: true, y_fill: true, expand: true, x_align: St.Align.START, y_align: St.Align.START });
      this.rootBox.add(this.bottomBox, { x_fill: true, y_fill: false, expand: false, y_align: St.Align.END });
      this._enableResize();
   },

   showMessage: function(message, buttons, btClickedCallBack) {
      let parentArea = this.scrollArea.get_parent();
      if(parentArea) {
         parentArea.remove_actor(this.scrollArea);

         let currWidth = this.mainBox.get_width();
         let currHeight = this.mainBox.get_height();
         this.mainBox.set_width(-1);
         this.mainBox.set_height(-1);
         this.setVisibleNote(true);
         this._messageContainer = new St.BoxLayout({vertical:true});
 
         let _information = new St.Label();
         _information.style="font-size: 12pt";
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
               let parentContainer = this._messageContainer.get_parent();
               if(parentContainer)
                  parentArea.remove_actor(this._messageContainer);
               this._messageContainer.destroy();
               this.scrollBox.add(this.scrollArea, { x_fill: true, y_fill: true, expand: true, x_align: St.Align.START, y_align: St.Align.START });
               if(this._fSize) {
                  this.mainBox.set_width(currWidth);
                  this.mainBox.set_height(currHeight);
               }
               this.setVisibleNote(false);
               this.setVisibleNote(true);

               btClickedCallBack(btClick.label.substring(4, btClick.label.length - 4));
            }));
            _buttonContainer.add(_btButton, {x_fill: true, expand:true, x_align: St.Align.END});
         }

         this._messageContainer.add(_information, {x_fill: true, x_align: St.Align.START});
         this._messageContainer.add(_buttonContainer, {x_fill: true, y_fill: false, expand: true, x_align: St.Align.END, y_align: St.Align.END});

         this.scrollBox.add(this._messageContainer, {x_fill: true, y_fill: true, expand: true});
      }
   },

   _scrollFilter: function(actor, event) {
      let heightNew = this.entry.get_height();
      if(!this._heightEntry)
         this._heightEntry = heightNew;
      if((heightNew != this._heightEntry)&&(this.symbol != Clutter.Delete)) {
         let newValue = this.scrollArea.vscroll.get_adjustment().value + heightNew - this._heightEntry;
         this.scrollArea.vscroll.get_adjustment().set_value(newValue);
      }
      this._heightEntry = heightNew;
   },

   enableScrolling: function(scrolling) {
      if(scrolling) {
         if(this.scrollIDSignal == 0)
            this.scrollIDSignal = this.scrollBox.connect('event', Lang.bind(this, this._scrollFilter));
      } else {
         if(this.scrollIDSignal > 0)
            this.scrollBox.disconnect(this.scrollIDSignal);
         this.scrollIDSignal = 0;
      }
   },

   _onAllocationChanged: function() {
      let availWidth = this.scrollBox.get_width() - 2;
      if(availWidth < MIN_WIDTH - 30)
         availWidth = MIN_WIDTH - 30;
      let diff = (availWidth % 18);
      this.transpBox.set_width(availWidth - diff);
      this.endBox.set_width(availWidth - diff);
   },

   _buttonCreation: function(icon, toolTip, iconSymbolic) {
      let iconType;
      if(iconSymbolic) iconType = St.IconType.SYMBOLIC;
      else iconType = St.IconType.FULLCOLOR;
      let bttIcon = new St.Icon({icon_name: icon, icon_type: iconType,
				 style_class: 'popup-menu-icon' });
      let btt = new St.Button({ child: bttIcon });
      btt.connect('button-release-event', Lang.bind(this, this._disableResize));
      btt.connect('notify::hover', Lang.bind(this, function(actor) {
         if(!this.actorResize) {
            if(actor.get_hover()) {
               global.set_cursor(Cinnamon.Cursor.POINTING_HAND);
               actor.set_style_class_name('menu-category-button-selected');
               actor.add_style_class_name('sticky-button-selected');
            }
            else {
               global.unset_cursor();
               actor.set_style_class_name('menu-category-button');
               actor.add_style_class_name('sticky-button');
            }
         }
      }));
      btt.set_style_class_name('menu-category-button');
      btt.add_style_class_name('sticky-button');
      btt.set_style('padding: 2px;');
      
      let bttTooltip = new Tooltips.Tooltip(btt, toolTip);
      return btt;
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

   _onKeyFocusChanged: function() {
      let focusedActor = global.stage.get_key_focus();
      if((focusedActor)&&(this.entry.contains(focusedActor))&&(this.focusIDSignal == 0)&&(!this._entryActiveMenu)) {
         this.setPencil(false);
         global.stage.set_key_focus(null);
      }
   },

   _onFocusOut: function(actor, event) {
      try {
         if(this.focusIDSignal > 0)
            this.clutterText.disconnect(this.focusIDSignal);
         this.focusIDSignal = 0;
         if(this.keyPressIDSignal > 0)
            this.clutterText.disconnect(this.keyPressIDSignal);
         this.keyPressIDSignal = 0;
         if(this.textInsertIDSignal > 0)
            this.clutterText.disconnect(this.textInsertIDSignal);
         this.textInsertIDSignal = 0;
         if(this.textChangeIDSignal > 0)
            this.clutterText.disconnect(this.textChangeIDSignal);
         this.textChangeIDSignal = 0;
         this.newNote(this.entry.text);
         this._text = this.entry.text;
         this.titleNote.set_text(this.entry.text);
         this.setPencil(false);
         global.stage.set_key_focus(null);
         this._onAutoHideButtons(false);
         if(this.raisedBox) {
            global.stage.set_key_focus(this.raisedBox.actor);
            this.raisedBox._actionCloseAll();
         }
      } catch(e) {
         this.showErrorMessage(e.message);
      }
   },

   _onPressEventOut: function(actor, event) {
      if(event.type() == Clutter.EventType.BUTTON_PRESS) {
         if(this.pressEventOutIDSignal > 0)
            global.stage.disconnect(this.pressEventOutIDSignal);
         this.pressEventOutIDSignal = 0;
         global.set_stage_input_mode(Cinnamon.StageInputMode.FOCUSED);
         global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
         if(!this.entry.contains(event.get_source())) {
            this._onFocusOut(actor, event);
         }
      }
   },

   _onButtonPress: function(actor, event) {
      try {
         if(this.focusIDSignal == 0)
            this.focusIDSignal = this.clutterText.connect('key-focus-out', Lang.bind(this, this._onFocusOut));
         if(this.keyPressIDSignal == 0)
            this.keyPressIDSignal = this.clutterText.connect('key-press-event', Lang.bind(this, this._onKeyPress));
         if(this.textInsertIDSignal == 0)
            this.textInsertIDSignal = this.clutterText.connect('insert-text', Lang.bind(this, this._onInsertText));
         if(this.textChangeIDSignal == 0)
            this.textChangeIDSignal = this.clutterText.connect('text-changed', Lang.bind(this, this._onChangedText));
         this.setPencil(true);
         global.stage.set_key_focus(this.clutterText);
         global.set_stage_input_mode(Cinnamon.StageInputMode.FOCUSED);
         global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
         global.set_stage_input_mode(Cinnamon.StageInputMode.FULLSCREEN);
         
         if(event.get_button() == 3) {
            this._entryActiveMenu = true;
            this._updateCopyItem();
            this._updatePasteItem();
         } else {
            if(this.pressEventOutIDSignal == 0)
               this.pressEventOutIDSignal = global.stage.connect('captured-event', Lang.bind(this, this._onPressEventOut));
         }
      } catch(e) {
         this.showErrorMessage(e.message);
      }
   },

   _onButtonRelease: function(actor, event) {
      if(this._entryActiveMenu) {
         this._onButtonReleaseEvent(this.actor, event);
         if(this.selection) {
            let len = this.selection.length;
            let lenClutter = this.clutterText.text.length;
            if((len > 0)&&(this.selectBounds >= 0)&&(this.selectBounds <= lenClutter))
               this.clutterText.set_selection(this.selectBounds - this.selection.length, this.selectBounds);
         }
      } 
      this._entryActiveMenu = false;
   },

   _onButtonReleaseEvent: function(actor, event) {//block the new way handdle event on cinnamon...
      if(event.get_button() == 3) {
         this._menu.toggle();
         // Check if menu gets out of monitor. Move menu to left side if so
         // Find x-position of right edge of monitor
         let rightEdge;
         for(let i = 0; i < Main.layoutManager.monitors.length; i++) {
            let monitor = Main.layoutManager.monitors[i];

            if(monitor.x <= this.actor.x && monitor.y <= this.actor.y &&
               monitor.x + monitor.width > this.actor.x &&
               monitor.y + monitor.height > this.actor.y) {
               rightEdge = monitor.x + monitor.width;
               break;
            }
         }

         if(this.actor.x + this.actor.width + this._menu.actor.width > rightEdge) {
            this._menu.setArrowSide(St.Side.RIGHT);
         } else {
            this._menu.setArrowSide(St.Side.LEFT);
         }

      } else {
         if(this._menu.isOpen) {
            this._menu.toggle();
         }
         this.on_desklet_clicked(event);
      }
      this._disableResize();
      return true;
   },

   _updateMenu: function(menu, open) {
      if(open) {
         if(!this._entryActiveMenu) {
            this._updateCopyItem();
            this._updatePasteItem();
         }
      }
   },

   _updateCopyItem: function() {
      this.selectBounds = this.clutterText.get_selection_bound();
      this.cursorPosition = this.clutterText.get_cursor_position();
      this.selection = this.clutterText.get_selection();
      this.copyMenuItem.setSensitive(this.selection && this.selection != '');

      let len = this.clutterText.text.length;
      if(this.selectBounds == -1)
        this.selectBounds = len;
      if(this.cursorPosition == -1)
         this.selectBounds = this.selectBounds + this.selection.length;
      else if(this.selectBounds < this.cursorPosition)
         this.selectBounds = this.selectBounds + this.selection.length;
      this.deleteMenuItem.setSensitive(this.selection && this.selection != '' && this.selectBounds);
   },

   _updatePasteItem: function() {
      this._clipboard.get_text(Lang.bind(this,
         function(clipboard, text) {
            this.pasteMenuItem.setSensitive(text && text != '' && this._isActivated());
         }));
    },

   _onCopyActivated: function() {
       this._clipboard.set_text(this.selection);
    },

   _onPasteActivated: function() {
      this._clipboard.get_text(Lang.bind(this,
         function(clipboard, text) {
            if(text) {
               global.stage.set_key_focus(this.entry);
               if(this.clutterText.text == _("Type your note...")) {
                  this.clutterText.set_text("");
               }
               this.clutterText.delete_selection();
               let pos = this.clutterText.get_cursor_position();
               this.clutterText.insert_text(text, pos);
               this.entry.set_text(this.clutterText.text);
               this._onFocusOut();
            }
         }));
   },

   _onDeleteActivated: function() {
      this.clutterText.delete_text(this.selectBounds - this.selection.length, this.selectBounds);
   },

   // the entry does not show the hint
   _isActivated: function() {
      return this.clutterText.text == this.entry.get_text();
   },

   _onKeyPress: function(actor, event) {
      this.keyPress = new Date().getTime();
      this.oldEntryText = actor.get_text();
      this.symbol = event.get_key_symbol();
      if((Keymap.get_caps_lock_state())&&((event.get_state()) & (Clutter.ModifierType.CONTROL_MASK))) {
         if((this.symbol == Clutter.KEY_c) || (this.symbol == Clutter.KEY_C)) {
            // allow ctrl+c event to be handled by the clutter text.
            this._clipboard.set_text(actor.get_selection());
            return true;
         }
         if((this.symbol == Clutter.KEY_v) || (this.symbol == Clutter.KEY_V)) {
            // allow ctrl+v event to be handled by the clutter text.
            this._clipboard.get_text(Lang.bind(this,
               function(clipboard, text) {
                  if(!text)
                     return;
                  this.clutterText.delete_selection();
                  let pos = this.clutterText.get_cursor_position();
                  this.keyPress = 0;
                  this.clutterText.insert_text(text, pos);
            }));
            return true;
         }
      }
      if(this.symbol == Clutter.Escape) {
         if(this._isActivated()) {
            this.reset();
            return true;
         }
      }
      if(this.symbol == Clutter.Down) {
         let newValue = this.scrollArea.vscroll.get_adjustment().value + this._getTextHeight();
         if(newValue < this.scrollArea.vscroll.get_adjustment().upper)
            this.scrollArea.vscroll.get_adjustment().set_value(newValue);
         else
            this.scrollArea.vscroll.get_adjustment().set_value(this.scrollArea.vscroll.get_adjustment().upper);
         return false;
      }
      if(this.symbol == Clutter.Up) {
         let newValue = this.scrollArea.vscroll.get_adjustment().value - this._getTextHeight();
         if(newValue >= 0)
            this.scrollArea.vscroll.get_adjustment().set_value(newValue);
         else
            this.scrollArea.vscroll.get_adjustment().set_value(0);
         return false;
      }
      return false;
   },

   _onChangedText: function(actor) {
      if((this.newText != "")&&(Keymap.get_caps_lock_state())) {
         let position = -1;
         let newEntryText = actor.get_text();
         for(let i = 0; i < newEntryText.length; i++) {
            if(this.oldEntryText.charAt(i) != newEntryText.charAt(i)) {
               position = i;
               break;
            }
         }
         if(position != -1) {
            actor.delete_text(position, position + 1);
            actor.insert_text(this.newText.toUpperCase(), position);
            actor.set_cursor_position(position);
            actor.set_selection(position, position);
            this.newText = "";
            this.keyPress = 0; 
         }
      }
      this.newText = "";
   },

   _onInsertText: function(actor, newText, length) {
      if((new Date().getTime() - this.keyPress < 20)&&(Keymap.get_caps_lock_state())) {
         this.newText = newText;
         let position = -1;
         let newEntryText = actor.get_text();
         for(let i = 0; i < newEntryText.length; i++) {
            if(this.oldEntryText.charAt(i) != newEntryText.charAt(i)) {
               position = i;
               break;
            }
         }
         if(position != -1) {
            this.newText = "";
            this.keyPress = 0;
            actor.delete_text(position, position + 1);
            actor.insert_text(newText.toUpperCase(), position);
         }
      }
   },

   _onMultInstanceChange: function() {
      if((this.instance_id == this.getMasterInstance())&&
         (this._multInstance != this.multInstanceMenuItem._switch.state)) {
         Mainloop.idle_add(Lang.bind(this, function() {
            this.multInstanceUpdate();
         }));
      }
   },

   _onMultInstanceActivated: function() {
      if(this._menu.isOpen)
         this._menu.close(false);
      if(this._multInstance != this.multInstanceMenuItem._switch.state) {
         this._multInstance = this.multInstanceMenuItem._switch.state;
         this.multInstanceUpdate();
      }
   },

   _onStyleChange: function() {
      this.setStyle();
   },

   _onSymbolicIcons: function() {
      let iconType;
      if(this._symbolicIcons) iconType = St.IconType.SYMBOLIC;
      else iconType = St.IconType.FULLCOLOR;
      this.addButton.child.set_icon_type(iconType);
      this.minimizeButton.child.set_icon_type(iconType);
      this.nextButton.child.set_icon_type(iconType);
      this.backButton.child.set_icon_type(iconType);
      this.configButton.child.set_icon_type(iconType);
      this.deleteButton.child.set_icon_type(iconType);
   },

   _onOpacityDeskletChange: function() {
      this.mainBox.opacity = 255*this._opacityDesklet;
   },

   _onOpacityBoxesChange: function() {
      this._onOpacityRootChange();
      this._onOpacityTextChange();
      return true;
   },

   _onOpacityRootChange: function() {
      let newStyle;
      if(this._overrideTheme) {
         let _colorBox = this.textRGBToRGBA(this._boxColor, this._opacityBoxes);
         if(this._themeStaples != "none")
            newStyle = 'background-color: ' + _colorBox + '; color: ' + this._fontColor + '; border: ' +
                        this._borderBoxWidth + 'px solid ' + this._borderBoxColor +
                        '; border-top: none; padding: 0px 4px 0px 4px; font-weight: bold; border-radius: 12px 12px 12px 12px;';
         else
            newStyle = 'background-color: ' + _colorBox + '; color: ' + this._fontColor + '; border: ' +
                        this._borderBoxWidth + 'px solid ' + this._borderBoxColor +
                        '; padding: 0px 4px 0px 4px; font-weight: bold; border-radius: 12px 12px 12px 12px;';
      } else {
         let remplaceColor;
         let themeNode = this.rootBox.get_theme_node();
         if(this._themeStaples != "none")
            newStyle = 'border-top: none; padding-top: 0px;';
         else
            newStyle = '';

         let [have_color, box_color] = themeNode.lookup_color('background-color', false);
         if(have_color) {
            remplaceColor = this.updateOpacityColor(box_color.to_string(), this._opacityBoxes);
            newStyle += 'background-color: ' + remplaceColor + ';';
         }
         let [have_color_start, box_color_start] = themeNode.lookup_color('background-gradient-start', false);
         if(have_color_start) {
            remplaceColor = this.updateOpacityColor(box_color_start.to_string(), this._opacityBoxes);
            newStyle += ' background-gradient-start: ' + remplaceColor + ';';
         }
         let [have_color_end, box_color_end] = themeNode.lookup_color('background-gradient-end', false);
         if(have_color_end) {
            remplaceColor = this.updateOpacityColor(box_color_end.to_string(), this._opacityBoxes);
            newStyle += ' background-gradient-end: ' + remplaceColor + ';';
         }
      }
      if(newStyle != this.rootBox.get_style()) {
         this.rootBox.set_style(newStyle);
      }
   },

   _onOpacityTextChange: function() {
      let newStyle = '';
      if(this._overrideTheme) {
         let _colorText = this.textRGBToRGBA(this._textBoxColor, this._opacityBoxes);
         newStyle = 'background-color: ' + _colorText + '; background:' + _colorText + ';';
      } else {
         let remplaceColor;
         let themeNode = this.textBox.get_theme_node();
         let [have_color, box_color] = themeNode.lookup_color('background-color', false);
         if(have_color) {
            remplaceColor = this.updateOpacityColor(box_color.to_string(), this._opacityBoxes);
            newStyle += 'background-color: ' + remplaceColor + ';';
         }
         let [have_color_start, box_color_start] = themeNode.lookup_color('background-gradient-start', false);
         if(have_color_start) {
            remplaceColor = this.updateOpacityColor(box_color_start.to_string(), this._opacityBoxes);
            newStyle += ' background-gradient-start: ' + remplaceColor + ';';
         }
         let [have_color_end, box_color_end] = themeNode.lookup_color('background-gradient-end', false);
         if(have_color_end) {
            remplaceColor = this.updateOpacityColor(box_color_end.to_string(), this._opacityBoxes);
            newStyle += ' background-gradient-end: ' + remplaceColor + ';';
         }
      }
      if(newStyle != this.textBox.get_style()) {
         this.textBox.set_style(newStyle);
      }
   },

   updateOpacityColor: function(color, opacity) {
      if((!opacity)||(opacity == 0))
         opacity = "0.01";
      let r = parseInt(color.substring(1,3),16);
      let g = parseInt(color.substring(3,5),16);
      let b = parseInt(color.substring(5,7),16);
      return "rgba("+r+","+g+","+b+","+opacity+")";
   },

   textRGBToRGBA: function(textRGB, opacity) {
      if((!opacity)||(opacity == 0))
         opacity = "0.0";
      return (textRGB.replace(')',',' + opacity + ')')).replace('rgb','rgba');
   },

   _onSizeChange: function() {
      if(this._fSize) {
         if(this._multInstance) {
            if(this._sameSize) {
               this.mainBox.set_width(this._width);
               if(this.scrollArea.visible)
                 this.mainBox.set_height(this._height);
            } else {
               this._readListSize();
               let strNote = "";
               if(this.noteCurrent <= this.notesList.length)
                  strNote += this.notesList[this.noteCurrent - 1][0];
               if(this.sizes[strNote]) {
                  this.mainBox.set_width(this.sizes[strNote][0]);
                  if(this.scrollArea.visible)
                     this.mainBox.set_height(this.sizes[strNote][1]);
               } else {
                  /*this.mainBox.set_width(this._width);
                  if(this.scrollArea.visible)
                    this.mainBox.set_height(this._height);*/
               }
            }
         } else {
            this.mainBox.set_width(this._width);
            if(this.scrollArea.visible)
               this.mainBox.set_height(this._height);
         }
      } else {
         if(this._sameSize) { 
            if(this.eventLoop == 0) {
               this.eventLoop = Mainloop.timeout_add(1000, Lang.bind(this, function() {
                  Mainloop.source_remove(this._eventLoop);
                  this._sameSize = false;
               }));
            }
         }
         this.mainBox.set_width(-1);
         this.mainBox.set_height(-1);
      }
   },

   _onScrollVisibleChange: function() {
      this.scrollArea.get_vscroll_bar().visible = this._scrollVisible;
   },

   _onScrollAutoChange: function() {
      this.scrollArea.set_auto_scrolling(this._scrollAuto);
   },

   _onTextSetting: function() {
      this.entry.text = this._text;
      this.titleNote.set_text(this.entry.text);
   },

   _onThemePencilChange: function() {
   },

   _onAutoHideButtons: function(hide) {
      if(this._autohideButtons) {
         let focusedActor = global.stage.get_key_focus();
         if((focusedActor)&&(this.entry.contains(focusedActor)))
            this.buttonBanner.visible = true;
         else
            this.buttonBanner.visible = hide;
      } else {
         this.buttonBanner.visible = true;
      }
   },

   _onSetAutoHideButtons: function() {
       if(this._autohideButtons) {
         this.buttonBanner.visible = false;
         if(this.enterAutoHideButtonsIDSignal == 0) {
            this.enterAutoHideButtonsIDSignal = this.actor.connect('enter-event', Lang.bind(this, function(actor) {
               this._onAutoHideButtons(true);
               this.rootBox.add_style_pseudo_class('hover');
               this.rootBox.set_style(' ');
            }));
         }
         if(this.leaveAutoHideButtonsIDSignal == 0) {
            this.leaveAutoHideButtonsIDSignal = this.actor.connect('leave-event', Lang.bind(this, function(actor) {
               this._onAutoHideButtons(false);
               this.rootBox.remove_style_pseudo_class('hover');
               this.rootBox.set_style(' ');
            }));
         }
      } else {
         if(this.enterAutoHideButtonsIDSignal > 0)
            this.actor.disconnect(this.enterAutoHideButtonsIDSignal);
         if(this.leaveAutoHideButtonsIDSignal > 0)
            this.actor.disconnect(this.leaveAutoHideButtonsIDSignal);
         this.enterAutoHideButtonsIDSignal = 0;
         this.leaveAutoHideButtonsIDSignal = 0;
         this._onAutoHideButtons(true);
      }
   },

   _onHideTextBox: function() {
      if(this._multInstance) {
         if((this.noteCurrent > 0)&&(this.noteCurrent < this.notesList.length + 1)) {
            this._readListHideTextBox();
            let hideNote = this.hideTextBox["" + this.notesList[this.noteCurrent - 1][0]];
            if(hideNote != null)
               this.setVisibleNote(hideNote);
            else
               this.setVisibleNote(true);
         }
      } else {
         this.setVisibleNote(this._hideTextBox);
      }
   }, 

   _initSettings: function() {
      try {
         this.settings = new Settings.DeskletSettings(this, this._uuid, this.instance_id);
         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "multi-instance", "_multInstance", this._onMultInstanceChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "auto-hide-buttons", "_autohideButtons", this._onSetAutoHideButtons, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "show-scroll", "_scrollVisible", this._onScrollVisibleChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "auto-scroll", "_scrollAuto", this._onScrollAutoChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "raise-new-note", "_raiseNewNote", null, null);
         //this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "text", "_text", this._onTextSetting, null);
         /*"text": {
      "type": "entry",
      "default": "",
      "description": "Text current note:",
      "tooltip": "The current note."
       },*/
         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "applet-manager", "_appletManager", this._onAppletManagerChange, null);
         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "applet-collapsed", "_appletCollapsed", this._onSetAppletType, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "applet-symbolic", "_appletSymbolic", this._onSetAppletType, null); 

         this.settings.bindProperty(Settings.BindingDirection.IN, "stripe-layout", "_themeStripe", this._onStyleChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "staples-layout", "_themeStaples", this._onStyleChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "pencil-layout", "_themePencil", this._onThemePencilChange, null);

         this.settings.bindProperty(Settings.BindingDirection.IN, "raise-key", "_raiseKey", this._onRaiseKeyChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "hide-key", "_hideKey", this._onHideKeyChange, null);

         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "fix-size", "_fSize", this._onSizeChange, null);
         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "same-size", "_sameSize", this._onSizeChange, null);
         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "width", "_width", this._onSizeChange, null);
         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "height", "_height", this._onSizeChange, null);


         this.settings.bindProperty(Settings.BindingDirection.IN, "text-size", "_textSize", this._onStyleChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "font-family", "_fontFamily", this._onStyleChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "symbolic-icons", "_symbolicIcons", this._onSymbolicIcons, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-opacity", "_opacityDesklet", this._onOpacityDeskletChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "boxes-opacity", "_opacityBoxes", this._onOpacityBoxesChange, null);

         this.settings.bindProperty(Settings.BindingDirection.IN, "override-theme", "_overrideTheme", this._onStyleChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "main-box-color", "_boxColor", this._onStyleChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "text-box-color", "_textBoxColor", this._onStyleChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "selected-text-color", "_textSelectedColor", this._onStyleChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "font-color", "_fontColor", this._onStyleChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "override-text-box", "_overrideTextBox", this._onStyleChange, null);

         this.settings.bindProperty(Settings.BindingDirection.IN, "border-box-width", "_borderBoxWidth", this._onStyleChange, null);
         this.settings.bindProperty(Settings.BindingDirection.IN, "border-box-color", "_borderBoxColor", this._onStyleChange, null);

         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "position-x", "_xPosition", null, null);
         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "position-y", "_yPosition", null, null);
         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "list-position", "_listPosition", null, null);

         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "list-size", "_listSize", null, null);

         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "hide-text-box", "_hideTextBox", null, null);
         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "list-hide-text-box", "_listHideTextBox", null, null);
         this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "applet-manager-order", "_appletManagerOrder", null, null);
      } catch (e) {
         this.showErrorMessage(e.message);
         global.logError(e);
      }
   },

   _onRaiseKeyChange: function() {
      if(this.keyRaiseId)
         Main.keybindingManager.removeHotKey(this.keyRaiseId);
       
      this.keyRaiseId = this._uuid + "-raise";
      Main.keybindingManager.addHotKey(this.keyRaiseId, this._raiseKey, Lang.bind(this, this.toggleRaise));
   },

   _onHideKeyChange: function() {
      if(this.keyHideId)
         Main.keybindingManager.removeHotKey(this.keyHideId);
       
      this.keyHideId = this._uuid + "-hide";
      Main.keybindingManager.addHotKey(this.keyHideId, this._hideKey, Lang.bind(this, this.toggleHide));
   },

   toggleHide: function() {
      try {
         if(this.deskletHide)
            this.showDesklet();
         else
            this.hideDesklet();
      } catch(e) {
         Main.notify("Error:", e.message);
         global.logError(e);
      }
   },

   showDesklet: function() {
      if((!this.deskletHide) || (this.changingHideState))
         return;
      this.changingHideState = true;
   
      let listOfDesklets = this.getAllInstanceObject();
      let deskletC;

      for(let i = 0; i < listOfDesklets.length; i++) {
         deskletC = listOfDesklets[i];
         deskletC.actor.visible = true;
         deskletC.deskletHide = false;
      }
      this.changingHideState = false;
      if((this.myManager)&&(this.myManager.applet))
         this.myManager.applet.setHideStatus(false);
   },

   hideDesklet: function() {
      if((this.deskletHide) || (this.changingHideState))
         return;
      if((this.deskletRaised)&&(this.raisedBox))
         this.raisedBox._actionCloseAll();
      Main.notify(_("Sticky Notes is hidden to be visible again please, press '%s'.").format(this._hideKey));
      this.changingHideState = true;
   
      let listOfDesklets = this.getAllInstanceObject();
      let deskletC;

      for(let i = 0; i < listOfDesklets.length; i++) {
         deskletC = listOfDesklets[i];
         deskletC.actor.visible = false;
         deskletC.deskletHide = true;
      }
      if((this.myManager)&&(this.myManager.applet))
         this.myManager.applet.setHideStatus(true);
      this.changingHideState = false;
   },

   toggleRaise: function() {
      try {
         if((this.deskletRaised)&&(this.raisedBox)) {
            this.raisedBox._actionCloseAll();
         }
         else {
            this.raise();
         }
         //throw "works";   
      } catch(e) {
         Main.notify("Error:", e.message);
         global.logError(e);
      }
   },
   
   raise: function() {
      if((this.deskletRaised) || (this.changingRaiseState))
         return;
      this.changingRaiseState = true;
   
      let listOfDesklets = this.getAllInstanceObject();
      this.raisedBox = new RaisedBox();
      let deskletC;
      this.deskletHide = false;
      for(let i = 0; i < listOfDesklets.length; i++) {
         deskletC = listOfDesklets[i];
         deskletC.actor.visible = true;
         deskletC.deskletHide = false;
         deskletC.actor.get_parent().remove_actor(deskletC.actor);
         this.raisedBox.add(deskletC);
         this.raisedBox.connect("closed", Lang.bind(this, this.lower));

         deskletC.raisedBox = this.raisedBox;
         deskletC.deskletRaised = true;
         deskletC._untrackMouse();
         this._inhibitDragable(deskletC);
      }
      if(listOfDesklets.length == 1) {
        this.raisedBox._actionClose(listOfDesklets[0]);
      }
      this.raisedBox.show();
      this.deskletRaised = true;
      this.changingRaiseState = false;
      if((this.myManager)&&(this.myManager.applet))
         this.myManager.applet.setRaiseStatus(true);
   },

   raiseInstance: function(deskletC) {
      try {
      let listOfDesklets = this.getAllInstanceObject();
      for(let i = 0; i < listOfDesklets.length; i++) {
         if((listOfDesklets[i])&&(listOfDesklets[i].deskletRaised)) {
            this.deskletRaised = true;
            break;
         }
      }
      if((this.deskletRaised) || (this.changingRaiseState))
         return;
      this.changingRaiseState = true;
   
      this.raisedBox = new RaisedBox();
      this.deskletHide = false;
      deskletC.actor.visible = true;
      deskletC.deskletHide = false;
      deskletC.actor.get_parent().remove_actor(deskletC.actor);
      this.raisedBox.add(deskletC);
      this.raisedBox.connect("closed", Lang.bind(this, this.lower));

      deskletC.raisedBox = this.raisedBox;
      deskletC.deskletRaised = true;
      deskletC._untrackMouse();
      this._inhibitDragable(deskletC);

      this.raisedBox._actionClose(deskletC);
      this.raisedBox.show();
      this.deskletRaised = true;
      this.changingRaiseState = false;
      } catch(e) {
         Main.notify("ee", e.message);
      }
   },

   lower: function() {
      if((!this.deskletRaised) || (this.changingRaiseState))
         return;
      this.changingRaiseState = true;
      /*if(this._menu.isOpen)
         this._onButtonReleaseEvent(this.actor, event);*/

      if(this.raisedBox) {
         let listOfDesklets = this.getAllInstanceObject();
         let deskletC;

         for(let i = 0; i < listOfDesklets.length; i++) {
            deskletC = listOfDesklets[i];
            if(!this.raisedBox.isSelected(deskletC)) {

               this.raisedBox.remove(deskletC);
               if(!Main.deskletContainer.contains(deskletC.actor))
                  Main.deskletContainer.addDesklet(deskletC.actor);
            }
         }

         if(!this.raisedBox.haveDesklets()) {
            global.stage.set_key_focus(this.raisedBox.actor);
            this.raisedBox.destroy();
            for(let i = 0; i < listOfDesklets.length; i++) {
               deskletC = listOfDesklets[i];
               deskletC.raisedBox = null;
               deskletC.deskletRaised = false;
               deskletC._trackMouse();
               this._enabledDragable(deskletC);
            }
         }
         if((this.myManager)&&(this.myManager.applet))
            this.myManager.applet.setRaiseStatus(false);
      }

      this.changingRaiseState = false;
   },

   _enabledDragable: function(deskletC) {
      deskletC._draggable.inhibit = false;
      if(!deskletC.idPress) {
         deskletC.idPress = deskletC.actor.connect('button-press-event',
                               Lang.bind(deskletC._draggable, deskletC._draggable._onButtonPress));
      }
   },

   _inhibitDragable: function(deskletC) {
      deskletC._draggable.inhibit = true;
      if(deskletC.idPress) {
         deskletC.actor.disconnect(deskletC.idPress);
         deskletC.idPress = null;
      }
   },

   _readListPosition: function() {
      this.positions = new Array();
      let pos = 0;
      let posString;
      let listString = this._listPosition.split(";;");
      while(pos < listString.length) {
         if(listString[pos] != "") {
            posString = listString[pos].split("::");
            if(this.isNoteInList(posString[0])) {
               this.positions[posString[0]] = [posString[1], posString[2]];
            }
         }
         pos++;
      }
   },

   _writeListPosition: function() {
      let stringList = "";
      for(let key in this.positions) {
         if(this.isNoteInList(key))
            stringList += key + "::" + this.positions[key][0] + "::" + this.positions[key][1] + ";;";
      }
      this._listPosition = stringList.substring(0, stringList.length - 2);//commit
   },

   _saveDeskletPosition: function() {
      let [ax, ay] = this.actor.get_transformed_position();
      if(this._multInstance) {
         if((this.noteCurrent > 0)&&(this.noteCurrent < this.notesList.length + 1)) {
            this._readListPosition();
            let strNote = "" + this.notesList[this.noteCurrent - 1][0];
            this.positions[strNote] = [ax, ay];
            this._writeListPosition();
         }
      } else {
         this._xPosition = ax;
         this._yPosition = ay;
      }
   },

   _readListSize: function() {
      this.sizes = new Array();
      let pos = 0;
      let posString;
      let listString = this._listSize.split(";;");
      while(pos < listString.length) {
         if(listString[pos] != "") {
            posString = listString[pos].split("::");
            if(this.isNoteInList(posString[0])) {
               this.sizes[posString[0]] = [posString[1], posString[2]];
            }
         }
         pos++;
      }
   },

   _writeListSize: function() {
      let stringList = "";
      for(let key in this.sizes) {
         if(this.isNoteInList(key))
            stringList += key + "::" + this.sizes[key][0] + "::" + this.sizes[key][1] + ";;";
      }
      this._listSize = stringList.substring(0, stringList.length - 2);//commit
   },

   _saveDeskletSize: function() {
      this._width = this.mainBox.get_width();
      this._height = this.mainBox.get_height();
      if(this._multInstance) {
         this._readListSize();
         if(this._sameSize) {
            for(let key in this.sizes) {
               this.sizes[key] = [this._width, this._height];
            }
            this._writeListSize();
         } else if((this.noteCurrent > 0)&&(this.noteCurrent < this.notesList.length + 1)) {
            let strNote = "" + this.notesList[this.noteCurrent - 1][0];
            this.sizes[strNote] = [this._width, this._height];
            this._writeListSize();
         }
      }
   },

   _readListHideTextBox: function() {
      this.hideTextBox = new Array();
      let pos = 0;
      let hideString;
      let listString = this._listHideTextBox.split(";;");
      while(pos < listString.length) {
         if(listString[pos] != "") {
            hideString = listString[pos].split("::");
            if(this.isNoteInList(hideString[0])) {
               this.hideTextBox[hideString[0]] = (hideString[1] === 'true');
            }
         }
         pos++;
      }
   },

   _writeListHideTextBox: function() {
      let stringList = "";
      for(let key in this.hideTextBox) {
         if(this.isNoteInList(key)) {
            if(this.hideTextBox[key])
               stringList += key + "::true;;";
            else
               stringList += key + "::false;;";
         }
      }
      this._listHideTextBox = stringList.substring(0, stringList.length - 2);//commit
   },

   _enableResize: function() {
      this.rootBox.connect('motion-event', Lang.bind(this, this._onResizeMotionEvent));
      this.rootBox.connect('button-press-event', Lang.bind(this, this._onBeginResize));
      this.rootBox.connect('leave-event', Lang.bind(this, this._disableOverResizeIcon));
   },

   _onResizeMotionEvent: function(actor, event) {
      if((this.scrollArea.visible)&&(!this.actorResize)) {
         let [mx, my] = event.get_coords();
         let [ax, ay] = actor.get_transformed_position();
         let aw = actor.get_width();
         let ah = actor.get_height();
         if(this._correctPlaceResize(mx, my, ax, ay, aw, ah)) {
            this._cursorChanged = true;
            global.set_cursor(Cinnamon.Cursor.DND_MOVE);
         } else
            this._disableOverResizeIcon();
      }
   },
 
   _disableOverResizeIcon: function() {
      if(!this.actorResize) {
         if(this._cursorChanged) {
            this._cursorChanged = false;
            global.unset_cursor();
         }
      }
   },

   _disableResize: function() {
      if(this.resizeIDSignal > 0)
         global.stage.disconnect(this.resizeIDSignal);
      this.resizeIDSignal = 0;
      this._disableOverResizeIcon();
      if(this.actorResize) {
         if(!this.deskletRaised) {
            this._enabledDragable(this);
            global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
         }
         //if((Main.popModal)&&(Main._findModal(this.actorResize) >= 0))
         //   Main.popModal(this.actorResize, global.get_current_time());
         this.actorResize = null;
         this._saveDeskletPosition();
         this._saveDeskletSize();
      }
   },

   _onBeginResize: function(actor, event) {
      if(this.scrollArea.visible) {
         let [mx, my] = event.get_coords();
         let [ax, ay] = actor.get_transformed_position();
         let aw = actor.get_width();
         let ah = actor.get_height();
         if(this._correctPlaceResize(mx, my, ax, ay, aw, ah)) {
            global.stage.set_key_focus(null);
            this.actorResize = this.mainBox;
            if(this.resizeIDSignal == 0) 
               this.resizeIDSignal = global.stage.connect('button-release-event', Lang.bind(this, this._disableResize));
            global.set_stage_input_mode(Cinnamon.StageInputMode.FULLSCREEN);
            //if(Main.pushModal)
            //    Main.pushModal(this.actorResize);
            this._inhibitDragable(this);
            this._findMouseDeltha();
            global.set_cursor(Cinnamon.Cursor.DND_MOVE);
            this._fSize = true;
            this._doResize();
         }
      }
   },

   _findMouseDeltha: function(mx, my) {
      if(this.actorResize) {
        // this.mouseDx = 0;
        // this.mouseDy = 0;
        //    this._updatePosResize();
        // this.mouseDx = this.width - this.mainBox.get_width();
        // this.mouseDy = this.height - this.mainBox.get_height();
      } 
   },

   _doResize: function() {
      if(this.eventLoopResize > 0)
         Mainloop.source_remove(this.eventLoopResize);
      this.eventLoopResize = 0;
      if(this.actorResize) {
         this._updatePosResize();
        // this._updateSize();
         this.eventLoopResize = Mainloop.timeout_add(300, Lang.bind(this, this._doResize));
      } else
         this._disableResize();
   },

   _updatePosResize: function() {
      if(this.actorResize) {
         let [mx, my, mask] = global.get_pointer();
         let [ax, ay] = this.actorResize.get_transformed_position();
         let aw = this.actorResize.get_width();
         let ah = this.actorResize.get_height();
         if(this.leftSide) {
            if(MIN_WIDTH < aw + ax - mx - 10) {
               this.actorResize.set_width(aw + ax - mx + 4);
               this.actor.set_position(mx - 4, ay);
            } else {
               this.actorResize.set_width(MIN_WIDTH);
               this.actor.set_position(ax + aw - MIN_WIDTH, ay);
            }
         } else {
            if(MIN_WIDTH < mx - ax - 10) {
               this.actorResize.set_width(mx - ax + 4);
            } else {
               this.actorResize.set_width(MIN_WIDTH);
            }
         }
         //this.mouseDx this.mouseDy;
         if(this.topSide) {
            if(MIN_HEIGHT < ah + ay - my - 10) {
               this.actorResize.set_height(ah + ay - my + 10);
               this.actor.set_position(this.actor.x, my - 10);
            } else {
               this.actorResize.set_height(MIN_HEIGHT);
               this.actor.set_position(this.actor.x, ay + ah - MIN_HEIGHT);
            }
         } else {
            if(MIN_HEIGHT < my - ay - 10) {
               this.actorResize.set_height(my - ay  + 4);
            } else {
               this.actorResize.set_height(MIN_HEIGHT);
            }
         }
      } else
         this._disableResize();
   },

   _correctPlaceResize: function(mx, my, ax, ay, aw, ah) {
      let goodPlace = false;
      if(mx < ax + DELTA_MIN_RESIZE) {
         this.leftSide = true;
         goodPlace = true;
      }
      else if(mx > ax + aw - DELTA_MIN_RESIZE) {
         this.leftSide = false;
         goodPlace = true;
      }
      if(goodPlace) {
         goodPlace = false;
         if(my < ay + DELTA_MIN_RESIZE) {
            this.topSide = true;
            goodPlace = true;
         } else if(my > ay + ah - DELTA_MIN_RESIZE) {
            this.topSide = false;
            goodPlace = true;
         }
      }
      return goodPlace;
   },

   renderFontFamily: function() {
      try {
         let fontMap = Clutter.get_font_map();
         let listFamily = fontMap.list_families();
         let patch = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/" + this._uuid + "/settings-schema.json";
         let new_json = JSON.parse(Cinnamon.get_file_contents_utf8_sync(patch));
         let fontItem, lengthItem, family;
         for(let key in new_json) {
            if((key == "fontFamily")&&(new_json[key]["type"] == "combobox")) {
               fontItem = new_json[key]["options"];
              // if((!fontItem)||(fontItem.length == 0)) {
                  for(let fPos in listFamily) {
                     family = listFamily[fPos].get_name();
                     //if(GLib.utf8_validate("utf-8"))
                       //  if(g_utf8_validate(family))
                        new_json[key]["options"][family] = family;
                  }
              // }
            }
         }
         let raw_file = JSON.stringify(new_json, null, 4);
         let file = Gio.file_new_for_path(patch);
         if(file.delete(null, null)) {
            let fp = file.create(0, null);
            fp.write(raw_file, null);
            fp.close;
         } else {
            //global.logError("Failed gain write access to settings file for applet/desklet '" + this._uuid + "', instance ") + this.instanceId;
         }
      } catch(e) {
         this.showErrorMessage(e.message);
      }
   },

   finalizeContextMenu: function() {
      Desklet.Desklet.prototype.finalizeContextMenu.call(this);
      let items = this._menu._getMenuItems();
      for(let pos in items)
         items[pos].focusOnHover = false;
   },

   execInstallLanguage: function() {
      try {
         let _shareFolder = GLib.get_home_dir() + "/.local/share/";
         let _localeFolder = Gio.file_new_for_path(_shareFolder + "locale/");
         let _moFolder = Gio.file_new_for_path(_shareFolder + "cinnamon/desklets/" + this._uuid + "/locale/mo/");
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
                  _dest = Gio.file_new_for_path(String(_moPath + this._uuid + ".mo"));
                  try {
                     if(_dest.query_exists(null)) {
                        _destModified = _dest.query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null).get_modification_time().tv_sec;
                        if(_modified > _destModified) {
                           _src.copy(_dest, Gio.FileCopyFlags.OVERWRITE, null, null);
                        }
                     } else {
                         this._makeDirectoy(_dest.get_parent());
                         _src.copy(_dest, Gio.FileCopyFlags.OVERWRITE, null, null);
                     }
                  } catch(e) {
                     Main.notify("Error", e.message);
                  }
               }
            }
         }
      } catch(e) {
         Main.notify("Error", e.message);
         global.logError(e);
      }
   }
};

function RaisedBox() {
   this._init();
}

RaisedBox.prototype = {
   _init: function() {
      try {
         this.desklets = new Array();
         this.stageEventIds = new Array();
         this.contextMenu = new Array();
         this.contextMenuEvents = new Array();
         this.stageEventIds.push(global.stage.connect("captured-event", Lang.bind(this, this.onStageEvent)));
         this.stageEventIds.push(global.stage.connect("enter-event", Lang.bind(this, this.onStageEvent)));
         this.stageEventIds.push(global.stage.connect("leave-event", Lang.bind(this, this.onStageEvent)));

         this.actor = new St.Group({ visible: false, x: 0, y: 0 });
         Main.uiGroup.add_actor(this.actor);
         global.focus_manager.add_group(this.actor);

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
         Main.notify("Error:", e.message);
         global.logError(e);
      }
   },

   isSelected: function(desklet) {
      return ((this.deskletSelected) && (this.deskletSelected == desklet));
   },

   haveDesklets: function() {
      return this.desklets.length > 0;
   },

   show: function() {
      global.set_stage_input_mode(Cinnamon.StageInputMode.FULLSCREEN);
      //Main.pushModal(this.actor);
      this.actor.show();
   },

   destroy: function() {
      global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
      //Main.popModal(this.actor);
      global.focus_manager.remove_group(this.actor);
      Main.uiGroup.remove_actor(this.actor);
      for(let i = 0; i < this.stageEventIds.length; i++)
         global.stage.disconnect(this.stageEventIds[i]);
      for(let i = 0; i < this.contextMenu.length; i++)
         this.contextMenu[i].disconnect(this.contextMenuEvents[i]);
      this.actor.destroy();
   },

   add: function(desklet) {
      try {
         this.desklets.push(desklet);
         this.contextMenu.push(desklet._menu);
         this.actor.add_actor(desklet.actor);
         this.contextMenuEvents.push(desklet._menu.connect("open-state-changed", Lang.bind(this, function(menu, open) {
            return this._actionCloseAll();
         })));
      } catch(e) {
         Main.notify("Error:", e.message);
         global.logError(e);
      }
   },
    
   remove: function(desklet) {
      try {
         let index = this.desklets.indexOf(desklet);
         if(index != -1) {
             this.contextMenu[index].disconnect(this.contextMenuEvents[index]);
             this.contextMenu.splice(index, 1);
             this.contextMenuEvents.splice(index, 1);
             this.desklets.splice(index, 1);
             if(desklet.actor.get_parent() == this.actor)
                this.actor.remove_actor(desklet.actor);
         }
      } catch(e) {
         Main.notify("Error:", e.message);
         global.logError(e);
      }
   },
    
   onStageEvent: function(actor, event) {
      try {
         let type = event.type();
         if((type == Clutter.EventType.KEY_PRESS) || (type == Clutter.EventType.KEY_RELEASE)) {
            if(event.get_key_symbol() == Clutter.Escape) {
               this._actionCloseAll();
               return true;
            }
            return false;
         }
         let selectedDesklet = this._getDeskletOfActorEvent(event.get_source());
         if(selectedDesklet != null) {
            if(type == Clutter.EventType.BUTTON_PRESS) {
               return this._actionClose(selectedDesklet);
            }
            return false;
         }
         if(type == Clutter.EventType.BUTTON_PRESS) {
            this._actionCloseAll();
            return true;
         }
      } catch(e) {
         Main.notify("Error:", e.message);
         global.logError(e);
      }

      return true;
   },

   _getDeskletOfActorEvent: function(target) {
      let desklet; 
      for(let i = 0; i < this.desklets.length; i++) {
         desklet = this.desklets[i];
         if((target == desklet.actor) || (desklet.actor.contains(target)) ||
            (target == desklet._menu.actor) || (desklet._menu.actor.contains(target))) {
            return desklet;
         }
      }
      return null;     
   },

   _actionCloseAll: function() {
      if(this.deskletSelected) {
         this.deskletSelected.actor.set_position(this.positionSelected[0], this.positionSelected[1]);
      }
      this.deskletSelected = null;
      this.emit("closed");
   },

   _actionClose: function(desklet) {
      if(desklet != null) {
         let index = this.desklets.indexOf(desklet);
         if((index != -1)&&(!this.deskletSelected)) {
            this.deskletSelected = desklet;
            this.positionSelected = desklet.actor.get_position();
            let monitor = Main.layoutManager.focusMonitor;
            desklet.actor.set_position(((monitor.width - desklet.actor.width)/2).toFixed(), ((monitor.height - desklet.actor.height)/2).toFixed());
            this.emit("closed");
            return true;
         }
      }
      return false;
   }
};
Signals.addSignalMethods(RaisedBox.prototype);

function main(metadata, desklet_id) {
   let desklet = new MyDesklet(metadata, desklet_id);
   return desklet;
}
