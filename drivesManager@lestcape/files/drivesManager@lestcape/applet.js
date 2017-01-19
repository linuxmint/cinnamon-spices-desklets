
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

const Gtk = imports.gi.Gtk;
const St = imports.gi.St;
const GLib = imports.gi.GLib;

const Lang = imports.lang;
const Gettext = imports.gettext;

const PopupMenu = imports.ui.popupMenu;
const AppletManager = imports.ui.appletManager;
const Applet = imports.ui.applet;
//const Settings = imports.ui.settings;
const Main = imports.ui.main;
const Util = imports.misc.util;

const FALLBACK_ICON_HEIGHT = 22;
const PANEL_SCALE_TEXT_ICONS_KEY = "panels-scale-text-icons";
const PANEL_HEIGHT_KEY = "panels-height";
const PANEL_RESIZABLE_KEY = "panels-resizable";

function _(str) {
   let resultConf = Gettext.dgettext("drivesManager@lestcape", str);
   if(resultConf != str) {
      return resultConf;
   }
   return Gettext.gettext(str);
}

// This is only a clone for the dalcde update
// we used it here to support old cinnamon versions.
function PopupIconMenuItem() {
   this._init.apply(this, arguments);
}

PopupIconMenuItem.prototype = {
   __proto__: PopupMenu.PopupBaseMenuItem.prototype,

   _init: function (text, iconName, iconType, params) {
      PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);
      if(iconType != St.IconType.FULLCOLOR)
          iconType = St.IconType.SYMBOLIC;
      this.label = new St.Label({text: text});
      this._icon = new St.Icon({ style_class: 'popup-menu-icon',
         icon_name: iconName,
         icon_type: iconType});
      this.addActor(this._icon, {span: 0});
      this.addActor(this.label);
   },

   setIconSymbolicName: function (iconName) {
      this._icon.set_icon_name(iconName);
      this._icon.set_icon_type(St.IconType.SYMBOLIC);
   },

   setIconName: function (iconName) {
      this._icon.set_icon_name(iconName);
      this._icon.set_icon_type(St.IconType.FULLCOLOR);
   }
};

function MyApplet(orientation, panel_height, instanceId) {
   this._init(orientation, panel_height, instanceId);
}

MyApplet.prototype = {
   __proto__: Applet.Applet.prototype,

   _init: function(orientation, panel_height, instanceId) {
      Applet.Applet.prototype._init.call(this, orientation, panel_height, instanceId);

      this._uuid = "drivesManager@lestcape";
      this.desklet = null;
      try {
         Gettext.bindtextdomain("drivesManager@lestcape", GLib.get_home_dir() + "/.local/share/locale");
         let iconPath = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/" + this._uuid + "/icons";
         Gtk.IconTheme.get_default().append_search_path(iconPath);
         this.mainBox = new St.BoxLayout();
         this.menuManager = new PopupMenu.PopupMenuManager(this);
         this.menu = new Applet.AppletPopupMenu(this, orientation);
         this.menu.connect('open-state-changed', Lang.bind(this, this._onOpenStateChanged));
         this.menuManager.addMenu(this.menu);
         this.section = new PopupMenu.PopupMenuSection();
         this.menu.addMenuItem(this.section);
         this._iconType = St.IconType.SYMBOLIC;

         this.appletBox = new AppletIconsBox(this, panel_height, St.IconType.FULLCOLOR);
         this.actor.add(this.appletBox.actor, { y_align: St.Align.MIDDLE, y_fill: false });
         this.context_menu_item_swap = new PopupIconMenuItem(_("Show as Desklet"), "computer", this._iconType);
         this.context_menu_item_swap.connect('activate', Lang.bind(this, function(actor) {
            if(this.desklet) {
               this.desklet._showAsApplet = !this.desklet._showAsApplet;
               this.desklet._onShowModeChange();
            }
         }));
         this._applet_context_menu.addMenuItem(this.context_menu_item_swap); 
         this.resize_signals_id = [];
         this.resize_signals_id.push(global.settings.connect("changed::" + 
            PANEL_SCALE_TEXT_ICONS_KEY, Lang.bind(this, this.on_panel_height_changed)));
         this.resize_signals_id.push(global.settings.connect("changed::" +
            PANEL_HEIGHT_KEY, Lang.bind(this, this.on_panel_height_changed)));
         this.resize_signals_id.push(global.settings.connect("changed::" + 
            PANEL_RESIZABLE_KEY, Lang.bind(this, this.on_panel_height_changed)));
      }
      catch(e) {
         Main.notify("appletError", e.message);
         global.logError(e);
      }
   },

   _onOpenStateChanged: function(menu, open) {
      if(!open) {
         if(this.desklet) {
            let scroll = this.desklet.globalContainer.scrollActor.scroll;
            let hscroll = scroll.get_hscroll_bar();
            if(hscroll)
               hscroll.get_adjustment().set_value(0);
            let vscroll = scroll.get_vscroll_bar();
               vscroll.get_adjustment().set_value(0);
         }
      }
   },

   _onSetAppletType: function(iconName, symbolic) {
      try {
         if(this.appletBox) {
            if(this.menu.isOpen)
               this.menu.close();
            //this.menu.removeAll();
            this.appletBox.remove_all();
            this.setAppletSymbolicIcon(symbolic);
            this.appletIcon = this.appletBox.add_applet_icon_name(iconName);
            this.set_applet_tooltip(_("Drives Manager"));
            this.appletIcon.connect('button-press-event', Lang.bind(this, function(actor, event) {
               if((this._draggable)&&(!this._draggable.inhibit))
                  return false;
               if(event.get_button() == 1) {
                  this.menu.toggle();
               }
               return false;
            }));
         }
      } catch(e) {
         Main.notify("err", e.message);
      }
   },

   setAppletSymbolicIcon: function(symbolic) {
      if(symbolic)
         this._iconType = St.IconType.SYMBOLIC;
      else
         this._iconType = St.IconType.FULLCOLOR;
      this.appletBox.set_icon_type(this._iconType);
      this._setContextMenuIconType();
   },

   setParentDesklet: function(desklet) {
      this.desklet = desklet;
      this._onSetAppletType("drives-manager", true);//"drive-multidisk"
   },

   swapContextToApplet: function(swap) {
      if((swap)&&(!this.deskletParent)) {
         this.deskletParent = this.desklet.globalContainer.getContentBox().get_parent();
         this.deskletParent.remove_actor(this.desklet.globalContainer.getContentBox());
         this.desklet.actor.visible = false;
         this.section.actor.add(this.desklet.globalContainer.getContentBox(), {x_fill: true, y_fill: true, y_align: St.Align.START, expand: true});
         this.desklet.globalContainer.setParent(this);
      } else if(this.deskletParent) {
         this.section.actor.remove_actor(this.desklet.globalContainer.getContentBox());
         this.deskletParent.add_actor(this.desklet.globalContainer.getContentBox());
         this.desklet.actor.visible = true;
         this.desklet.globalContainer.setParent(this.desklet);
         this.deskletParent = null;
      }
   },

   removedFromPanel: function() {
      if(this.desklet) {
         this.desklet.on_applet_removed_from_panel();
      }
   },

   on_applet_removed_from_panel: function() {
      for(let pos in this.resize_signals_id)
         global.settings.disconnect(this.resize_signals_id[pos]);
      this.resize_signals_id = [];
   },

   on_panel_height_changed: function() {
      let height = this._extension._loadedDefinitions[this.instance_id].panel.actor.get_height();
      if((this._panelHeight != height)&&(this.appletBox)) {
         this._panelHeight = height;
         this.appletBox.set_panel_height(this._panelHeight);
      }
   },

   _setContextMenuIconType: function() {
      if(this.context_menu_item_remove != null)
         this.context_menu_item_remove._icon.set_icon_type(this._iconType); 
      if(this.context_menu_item_about != null)
         this.context_menu_item_about._icon.set_icon_type(this._iconType);  
      if(this.context_menu_item_configure != null) {
         if(this._iconType == St.IconType.SYMBOLIC)
            this.context_menu_item_configure.setIconSymbolicName("system-run");
         else
            this.context_menu_item_configure.setIconName("preferences-system");
      }
      if(this.context_menu_item_swap != null)
         this.context_menu_item_swap._icon.set_icon_type(this._iconType);
   },
   
   finalizeContextMenu: function() {
      try {
         // Add default context menus if we're in panel edit mode, ensure their removal if we're not       
         let items = this._applet_context_menu._getMenuItems();

         if(this.context_menu_item_remove == null) {
            this.context_menu_item_remove = new PopupIconMenuItem(_("Remove this applet"),
                                                "edit-delete", this._iconType);
            this.context_menu_item_remove.connect('activate', Lang.bind(this, this.removedFromPanel));
         }

         if((this.openAbout)&&(this.context_menu_item_about == null)) {
            this.context_menu_item_about = new PopupIconMenuItem(_("About..."),
                                                "dialog-question", this._iconType);
            this.context_menu_item_about.connect('activate', Lang.bind(this, this.openAbout));
         }

         if(this.context_menu_separator == null) {
            this.context_menu_separator = new PopupMenu.PopupSeparatorMenuItem();
         }

         if(this._applet_context_menu._getMenuItems().length > 0) {
            this._applet_context_menu.addMenuItem(this.context_menu_separator);
         }

         if((this.context_menu_item_about)&&(items.indexOf(this.context_menu_item_about) == -1)) {
            this._applet_context_menu.addMenuItem(this.context_menu_item_about);
         }

         if(!this._meta["hide-configuration"] && GLib.file_test(this._meta["path"] + "/settings-schema.json", GLib.FileTest.EXISTS)) {     
            if(this.context_menu_item_configure == null) {           
               this.context_menu_item_configure = new PopupIconMenuItem(_("Configure..."),
                                                           "system-run", this._iconType);
               this.context_menu_item_configure.connect('activate', Lang.bind(this, function() {
                  Util.spawnCommandLine("cinnamon-settings desklets " + this._uuid + " " + this.desklet.instance_id);
               }));
            }
            if(items.indexOf(this.context_menu_item_configure) == -1) {
               this._applet_context_menu.addMenuItem(this.context_menu_item_configure);
            }
         }

         if(items.indexOf(this.context_menu_item_remove) == -1) {
            this._applet_context_menu.addMenuItem(this.context_menu_item_remove);
         }
      } catch(e) {
         global.logError(e);
      }
   }
};

function AppletIconsBox(parent, box_height, icon_type) {
   this._init(parent, box_height, icon_type);
}

AppletIconsBox.prototype = {
   _init: function(parent, box_height, icon_type) {
      this.parent = parent;
      this._boxHeight = box_height;
      this._icon_type = icon_type;
      this._scaleMode = global.settings.get_boolean('panel-scale-text-icons') && global.settings.get_boolean('panel-resizable');
      this.actor = new St.BoxLayout();
      this.set_icon_type(icon_type);
   },

   set_icon_type: function(icon_type) {
      this._icon_type = icon_type;
      let childs = this.actor.get_children();
      for(let ch in childs) {
         childs[ch].set_icon_type(this._icon_type);
         if(this._icon_type == St.IconType.FULLCOLOR)
            childs[ch].style_class = 'applet-icon';
         else
            childs[ch].style_class = 'system-status-icon'; 
         if(this._scaleMode) {
            if(this._icon_type == St.IconType.FULLCOLOR)
               childs[ch].set_icon_size(this._boxHeight * Applet.COLOR_ICON_HEIGHT_FACTOR / global.ui_scale);
            else
               childs[ch].set_icon_size((this._boxHeight / Applet.DEFAULT_PANEL_HEIGHT) * Applet.PANEL_SYMBOLIC_ICON_DEFAULT_HEIGHT / global.ui_scale);
         } else {
            if(this._icon_type == St.IconType.FULLCOLOR)
               childs[ch].set_icon_size(FALLBACK_ICON_HEIGHT);
            else
               childs[ch].set_icon_size(-1);
         }
      }
   },

   add_applet_icon_name: function(icon_name) {
      let applet_icon = new St.Icon({icon_name: icon_name, reactive: true, track_hover: true });
      applet_icon.set_icon_type(this._icon_type);
      if(this._icon_type == St.IconType.FULLCOLOR)
         applet_icon.style_class = 'applet-icon';
      else
         applet_icon.style_class = 'system-status-icon';
      if(this._scaleMode) {
         if(this._icon_type == St.IconType.FULLCOLOR)
            applet_icon.set_icon_size(this._boxHeight * Applet.COLOR_ICON_HEIGHT_FACTOR / global.ui_scale);
         else
            applet_icon.set_icon_size((this._boxHeight / Applet.DEFAULT_PANEL_HEIGHT) * Applet.PANEL_SYMBOLIC_ICON_DEFAULT_HEIGHT / global.ui_scale);
      } else {
         if(this._icon_type == St.IconType.FULLCOLOR)
            applet_icon.set_icon_size(FALLBACK_ICON_HEIGHT);
         else
            applet_icon.set_icon_size(-1);
      }
      this.actor.add_actor(applet_icon);
      return applet_icon;
   },

   remove_all: function() {
      this.actor.destroy_all_children();
   },

   set_panel_height: function(box_height) {
      this._boxHeight = box_height;
      this._scaleMode = global.settings.get_boolean('panel-scale-text-icons') && global.settings.get_boolean('panel-resizable');
      this.set_icon_type(this._icon_type);
    }
};

function main(metadata, orientation, panel_height, instanceId) {
    let myApplet = new MyApplet(orientation, panel_height, instanceId);
    return myApplet;
}
