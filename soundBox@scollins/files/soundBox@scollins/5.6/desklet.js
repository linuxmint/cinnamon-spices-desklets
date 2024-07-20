const Desklet = imports.ui.desklet;
const DeskletManager = imports.ui.deskletManager;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const GLib = imports.gi.GLib;
const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;

const Lang = imports.lang;
const Signals = imports.signals;

const uuid = "soundBox@scollins";
let Soundbox;
if (typeof require !== 'undefined') {
    Soundbox = require('./soundbox');
} else {
    Soundbox = imports.ui.deskletManager.desklets[uuid].soundbox;
}

const SETTINGS_KEYS = ["hideSystray", "theme", "showInput", "showApps", "raiseKey", "centerRaised", "compact", "showArt", "artSize", "exceedNormVolume"];


let settings, actionManager;
let desklet_raised = false;

const Gettext = imports.gettext;

Gettext.bindtextdomain(uuid, GLib.get_home_dir() + "/.local/share/locale")

function _(str) {
  return Gettext.dgettext(uuid, str);
}

function ButtonMenu(content) {
    this._init(content);
}

ButtonMenu.prototype = {
    _init: function(content) {
        try {
            
            this.actor = new St.Button({ style_class: "soundbox-buttonMenu" });
            this.actor.set_child(content);
            
            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new PopupMenu.PopupMenu(this.actor, St.Side.TOP);
            this.menu.actor.set_name(settings.theme+"-popup");
            this.menuManager.addMenu(this.menu);
            Main.uiGroup.add_actor(this.menu.actor);
            
            let scrollBox = new St.ScrollView();
            this.menu.addActor(scrollBox);
            this.content = new PopupMenu.PopupMenuSection();
            scrollBox.add_actor(this.content.actor);
            this.menu._connectSubMenuSignals(this.content, this.content);
            
            this.menu.setMaxHeight = Lang.bind(this, function() {
                let monitor = Main.layoutManager.findMonitorForActor(this.actor);
                let i = Main.layoutManager.monitors.indexOf(monitor);
                let panels = Main.panelManager.getPanelsInMonitor(i);
                let panelHeight = 0;
                for ( let i = 0; i < panels.length; i++ ) {
                    if ( panels[i].bottomPosition && !panels[i]._hidden ) {
                        panelHeight += panels[i].actor.height;
                    }
                }
                let startY = Cinnamon.util_get_transformed_allocation(this.actor).y2;
                let boxpointerHeight = this.menu.actor.get_theme_node().get_length('-boxpointer-gap');
                let maxHeight = Math.round(monitor.height - startY - panelHeight - boxpointerHeight);
                this.menu.actor.style = ('max-height: ' + maxHeight + 'px;');
            });
            
            this.menu.actor.hide();
            
            this.actor.connect("clicked", Lang.bind(this, this.activate));
            settings.settings.connect("changed::theme", Lang.bind(this, function(provider, key, oldVal, newVal) {
                this.menu.actor.set_name(newVal+"-popup");
            }));
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    destroy: function() {
        this.menu.destroy()
    },
    
    activate: function() {
        this.menu.toggle();
    }
}


function SettingsInterface(uuid, deskletId) {
    this._init(uuid, deskletId);
}

SettingsInterface.prototype = {
    _init: function(uuid, deskletId) {
        this.settings = new Settings.DeskletSettings(this, uuid, deskletId);
        for ( let i = 0; i < SETTINGS_KEYS.length; i++) {
            this.settings.bindProperty(Settings.BindingDirection.IN, SETTINGS_KEYS[i], SETTINGS_KEYS[i]);
        }
        
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "countUp", "countUp");
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "compatiblePlayers", "compatiblePlayers");
    }
}


function DragInhibitor(dragObject, desklet) {
    this._init(dragObject, desklet);
}

DragInhibitor.prototype = {
    _init: function(dragObject, desklet) {
        this.drag = dragObject;
        this.desklet = desklet;
        
        desklet.actor.connect("motion-event", Lang.bind(this, this._onMotion));
    },
    
    _onMotion: function(a, event) {
        let target = event.get_source();
        this.update(target);
    },
    
    update: function(actor) {
        if ( desklet_raised ) {
            this.drag.inhibit = true;
            return;
        }
        if ( actor && actor._delegate && actor._delegate instanceof Soundbox.Slider ) {
            this.drag.inhibit = true;
            return;
        }
        this.drag.inhibit = false;
    }
}


function RaisedBox() {
    this._init();
}

RaisedBox.prototype = {
    _init: function() {
        try {
            
            this.stageEventIds = [];
            this.playerMenuEvents = [];
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
            global.logError(e);
        }
    },
    
    add: function(desklet) {
        try {
            
            this.desklet = desklet;
            this.playerMenu = this.desklet.playerLauncher.menu;
            this.contextMenu = this.desklet._menu;
            
            this.groupContent.add_actor(this.desklet.actor);
            
            if ( !settings.centerRaised ) {
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
            this.playerMenuEvents.push(this.playerMenu.connect("activate", Lang.bind(this, function() {
                this.emit("closed");
            })));
            this.contextMenuEvents.push(this.contextMenu.connect("activate", Lang.bind(this, function() {
                this.emit("closed");
            })));
            actionManager.connect("close", Lang.bind(this, function() {
                this.emit("closed");
            }));
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    remove: function() {
        try {
            
            for ( let i = 0; i < this.stageEventIds.length; i++ ) global.stage.disconnect(this.stageEventIds[i]);
            for ( let i = 0; i < this.playerMenuEvents.length; i++ ) this.playerMenu.disconnect(this.playerMenuEvents[i]);
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
                 target == this.playerMenu.actor || this.playerMenu.actor.contains(target) ||
                 target == this.contextMenu.actor || this.contextMenu.actor.contains(target) ) return false;
            if ( type == Clutter.EventType.BUTTON_RELEASE ) this.emit("closed");
            
        } catch(e) {
            global.logError(e);
        }
        
        return true;
    }
}
Signals.addSignalMethods(RaisedBox.prototype);


function myDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

myDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,
    
    _init: function(metadata, desklet_id) {
        try {
            
            this.metadata = metadata;
            Desklet.Desklet.prototype._init.call(this, metadata);
            this.inhibitor = new DragInhibitor(this._draggable, this);
            
            this.containers = {};
            
            settings = new SettingsInterface(metadata.uuid, desklet_id);
            
            settings.settings.connect("changed::theme", Lang.bind(this, function(provider, key, oldVal, newVal) {
                settings[key] = newVal;
                this.mainBox.style_class = newVal + "-mainBox";
            }));
            settings.settings.connect("changed::compact", Lang.bind(this, function(provider, key, oldVal, newVal) {
                settings[key] = newVal;
                if ( newVal ) this.mainBox.pseudo_class = "compact";
                else this.mainBox.pseudo_class = "";
            }));
            settings.settings.connect("changed::raiseKey", Lang.bind(this, function(provider, key, oldVal, newVal) {
                settings[key] = newVal;
                this.bindKey();
            }));
            this.bindKey();
            settings.settings.connect("changed::hideSystray", Lang.bind(this, function(provider, key, oldVal, newVal) {
                settings[key] = newVal;
                if ( newVal ) Soundbox.registerSystrayIcons(this.metadata.uuid);
                else Soundbox.unregisterSystrayIcons(this.metadata.uuid);
            }))
            if ( settings.hideSystray ) Soundbox.registerSystrayIcons();
            
            actionManager = new Soundbox.ActionManager();
            
            //generate content containers
            this.mainBox = new St.BoxLayout({ style_class: settings.theme+"-mainBox", vertical: true });
            if ( settings.compact ) this.mainBox.add_style_pseudo_class("compact");
            this.setContent(this.mainBox);
            
            let topBin = new St.Bin({ x_align: St.Align.MIDDLE });
            this.mainBox.add_actor(topBin);
            let topBox = new St.BoxLayout({ vertical: false });
            topBin.add_actor(topBox);
            
            this.playerLauncher = new ButtonMenu(new St.Label({ text: _("Launch Player"), style_class: "soundbox-buttonText" }));
            topBox.add_actor(this.playerLauncher.actor);
            this.containers.playersMenu = this.playerLauncher.content;
            
            this.containers.volumeContent = new St.BoxLayout({ vertical: true });
            this.mainBox.add_actor(this.containers.volumeContent);
            
            this.containers.playerContent = new St.BoxLayout({ vertical: true, style_class: "soundbox-playerBox" });
            this.mainBox.add_actor(this.containers.playerContent);
            
            //context menu
            this.containers.context = new PopupMenu.PopupMenuSection();
            this._menu.addMenuItem(this.containers.context);
            
            this.sbInterface = new Soundbox.SoundboxLayout(this.containers, settings, actionManager);
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    on_desklet_removed: function() {
        Soundbox.unregisterSystrayIcons(this.metadata.uuid);
        this.playerLauncher.destroy()
    },
    
    bindKey: function() {
        if ( this.keyId ) Main.keybindingManager.removeHotKey(this.keyId);
        
        this.keyId = "soundbox-raise";
        Main.keybindingManager.addHotKey(this.keyId, settings.raiseKey, Lang.bind(this, this.toggleRaise));
    },
    
    toggleRaise: function() {
        try {
            
            if ( desklet_raised ) this.lower();
            else this.raise();
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    raise: function() {
        if ( desklet_raised || this.changingRaiseState ) return;
        this.changingRaiseState = true;
        
        this.raisedBox = new RaisedBox();
        
        let position = this.actor.get_position();
        this.actor.get_parent().remove_actor(this.actor);
        this.raisedBox.add(this);
        
        this.raisedBox.connect("closed", Lang.bind(this, this.lower));
        
        desklet_raised = true;
        this.changingRaiseState = false;
        this.inhibitor.update();
    },
    
    lower: function() {
        if ( !desklet_raised || this.changingRaiseState ) return;
        this.changingRaiseState = true;
        
        this._menu.close();
        this.playerLauncher.menu.close();
        
        if ( this.raisedBox ) this.raisedBox.remove();
        Main.deskletContainer.addDesklet(this.actor);
        
        DeskletManager.mouseTrackEnabled = -1;
        DeskletManager.checkMouseTracking();
        
        desklet_raised = false;
        this.changingRaiseState = false;
        this.inhibitor.update();
    },
    
    rebuild: function() {
        try {
            
            this.playersBox.set_child(null);
            this.playerTitle.set_child(null);
            this._build_interface();
            this.readOutput();
            this.readInput();
            this._reloadApps();
            for ( let i = 0; i < this.owners.length; i++ ) {
                let owner = this.owners[i];
                this.players[owner].updateTheme(settings.theme);
            }
            
            this._showPlayer(this.players[this.playerShown]);
            
        } catch(e) {
            global.logError(e);
        }
    }
}


function main(metadata, desklet_id) {
    let desklet = new myDesklet(metadata, desklet_id);
    return desklet;
}
