const Applet = imports.ui.applet;
const Desklet = imports.ui.desklet;
const Main = imports.ui.main;
const Tooltips = imports.ui.tooltips;
const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const Cogl = imports.gi.Cogl;
const GLib = imports.gi.GLib;
const Meta = imports.gi.Meta;
const St = imports.gi.St;
const Lang = imports.lang;
const Signals = imports.signals;

const uuid = "devTools@scollins";
let TabPanel, Windows;
if (typeof require !== 'undefined') {
    TabPanel = require('./tabPanel');
    Windows = require('./windows');
} else {
    const DeskletDir = imports.ui.deskletManager.desklets[uuid];
    TabPanel = DeskletDir.tabPanel;
    Windows = DeskletDir.windows;
}

const INSPECTABLE_TYPES = ["object","array","map","actor","window","applet","desklet"];

const Gettext = imports.gettext;
Gettext.bindtextdomain(uuid, GLib.get_home_dir() + "/.local/share/locale")


let controller;


function _(str) {
  return Gettext.dgettext(uuid, str);
}

function addBorderPaintHook(actor) {
    let signalId = actor.connect_after('paint',
        function () {
            let color = new Cogl.Color();
            color.init_from_4ub(0xff, 0, 0, 0xc4);
            Cogl.set_source_color(color);

            let geom = actor.get_allocation_geometry();
            let width = 2;

            // clockwise order
            Cogl.rectangle(0, 0, geom.width, width);
            Cogl.rectangle(geom.width - width, width,
                           geom.width, geom.height);
            Cogl.rectangle(0, geom.height,
                           geom.width - width, geom.height - width);
            Cogl.rectangle(0, geom.height - width,
                           width, width);
        });

    actor.queue_redraw();
    return signalId;
}


function getType(object) {
    let type = typeof(object);
    if ( type == "object" ) {
        if ( object === null ) type = "null";
        else if ( object instanceof Map ) type = "map";
        else if ( object instanceof Array ) type = "array";
        else if ( object instanceof Clutter.Actor ) type = "actor";
        else if ( object instanceof Meta.Window ) type = "window";
        else if ( object instanceof Meta.Workspace ) type = "workspace";
        else if ( object instanceof Applet.Applet ) type = "applet";
        else if ( object instanceof Desklet.Desklet ) type = "desklet";
    }

    return type;
}


function capitalize(text) {
    return text[0].toUpperCase() + text.slice(1);
}


function Inspector() {
    this._init();
}

Inspector.prototype = {
    _init: function() {
        let container = new Cinnamon.GenericContainer({ width: 0,
                                                     height: 0 });
        container.connect('allocate', Lang.bind(this, this._allocate));
        Main.uiGroup.add_actor(container);

        let eventHandler = new St.BoxLayout({ name: 'LookingGlassDialog',
                                              vertical: true,
                                              reactive: true });
        this._eventHandler = eventHandler;
        Main.pushModal(this._eventHandler);
        container.add_actor(eventHandler);
        this._displayText = new St.Label();
        eventHandler.add(this._displayText, { expand: true });
        this._passThroughText = new St.Label({style: 'text-align: center;'});
        eventHandler.add(this._passThroughText, { expand: true });

        this._borderPaintTarget = null;
        this._borderPaintId = null;
        eventHandler.connect('destroy', Lang.bind(this, this._onDestroy));
        this._capturedEventId = global.stage.connect('captured-event', Lang.bind(this, this._onCapturedEvent));

        // this._target is the actor currently shown by the inspector.
        // this._pointerTarget is the actor directly under the pointer.
        // Normally these are the same, but if you use the scroll wheel
        // to drill down, they'll diverge until you either scroll back
        // out, or move the pointer outside of _pointerTarget.
        this._target = null;
        this._pointerTarget = null;
        this.passThroughEvents = false;
        global.set_cursor(Cinnamon.Cursor.CROSSHAIR);
        this._updatePassthroughText();
    },

    _updatePassthroughText: function() {
        if(this.passThroughEvents)
            this._passThroughText.text = _("(Press Pause or Control to disable event pass through)");
        else
            this._passThroughText.text = _("(Press Pause or Control to enable event pass through)");
    },

    _onCapturedEvent: function (actor, event) {
        if(event.type() == Clutter.EventType.KEY_PRESS && (event.get_key_symbol() == Clutter.Control_L ||
                                                           event.get_key_symbol() == Clutter.Control_R ||
                                                           event.get_key_symbol() == Clutter.Pause)) {
            this.passThroughEvents = !this.passThroughEvents;
            this._updatePassthroughText();
            return true;
        }

        if(this.passThroughEvents)
            return false;

        switch (event.type()) {
            case Clutter.EventType.KEY_PRESS:
                return this._onKeyPressEvent(actor, event);
            case Clutter.EventType.BUTTON_PRESS:
                return this._onButtonPressEvent(actor, event);
            case Clutter.EventType.SCROLL:
                return this._onScrollEvent(actor, event);
            case Clutter.EventType.MOTION:
                return this._onMotionEvent(actor, event);
            default:
                return true;
        }
    },

    _allocate: function(actor, box, flags) {
        if (!this._eventHandler)
            return;

        let primary = Main.layoutManager.primaryMonitor;

        let [minWidth, minHeight, natWidth, natHeight] =
            this._eventHandler.get_preferred_size();

        let childBox = new Clutter.ActorBox();
        childBox.x1 = primary.x + Math.floor((primary.width - natWidth) / 2);
        childBox.x2 = childBox.x1 + natWidth;
        childBox.y1 = primary.y + Math.floor((primary.height - natHeight) / 2);
        childBox.y2 = childBox.y1 + natHeight;
        this._eventHandler.allocate(childBox, flags);
    },

    _close: function() {
        global.stage.disconnect(this._capturedEventId);
        Main.popModal(this._eventHandler);

        if (this._borderPaintTarget != null)
            this._borderPaintTarget.disconnect(this._borderPaintId);

        global.unset_cursor();

        this._eventHandler.destroy();
        this._eventHandler = null;
    },

    _onDestroy: function() {
        if (this._borderPaintTarget != null)
            this._borderPaintTarget.disconnect(this._borderPaintId);
    },

    _onKeyPressEvent: function (actor, event) {
        if (event.get_key_symbol() == Clutter.Escape)
            this._close();
        return true;
    },

    _onButtonPressEvent: function (actor, event) {
        if (this._target) {
            let [stageX, stageY] = event.get_coords();
            this.emit("target", this._target);
        }
        this._close();
        return true;
    },

    _onScrollEvent: function (actor, event) {
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
            // select parent
            let parent = this._target.get_parent();
            if (parent != null) {
                this._target = parent;
                this._update(event);
            }
            break;

        case Clutter.ScrollDirection.DOWN:
            // select child
            if (this._target != this._pointerTarget) {
                let child = this._pointerTarget;
                while (child) {
                    let parent = child.get_parent();
                    if (parent == this._target)
                        break;
                    child = parent;
                }
                if (child) {
                    this._target = child;
                    this._update(event);
                }
            }
            break;

        default:
            break;
        }
        return true;
    },

    _onMotionEvent: function (actor, event) {
        this._update(event);
        return true;
    },

    _update: function(event) {
        let [stageX, stageY] = event.get_coords();
        let target = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE,
                                                   stageX,
                                                   stageY);

        if (target != this._pointerTarget)
            this._target = target;
        this._pointerTarget = target;

        let position = '[inspect x: ' + stageX + ' y: ' + stageY + ']';
        this._displayText.text = '';
        this._displayText.text = position + ' ' + this._target;

        if (this._borderPaintTarget != this._target) {
            if (this._borderPaintTarget != null)
                this._borderPaintTarget.disconnect(this._borderPaintId);
            this._borderPaintTarget = this._target;
            this._borderPaintId = addBorderPaintHook(this._target);
        }
    }
}
Signals.addSignalMethods(Inspector.prototype);


function InspectButton(object, label) {
    this._init(object, label);
}

InspectButton.prototype = {
    _init: function(object, label) {
        this.object = object;
        if ( !label ) label = String(object);
        this.actor = new St.Button({ label: label, x_align: St.Align.START, style_class: "devtools-contentButton" });
        this.actor.connect("clicked", Lang.bind(this, this.inspect));
    },

    inspect: function() {
        controller.inspect(this.object);
    }
}


function ActorButton(actor, isParent) {
    this._init(actor, isParent);
}

ActorButton.prototype = {
    _init: function(actor, isParent) {
        this.target = actor;
        this.isParent = isParent;
        this.moreShown = false;

        this.actor = new St.BoxLayout({ vertical: true });
        let topBox = new St.BoxLayout();
        this.actor.add_actor(topBox);
        this.childBox = new St.BoxLayout({ vertical: true, style_class: "devtools-indented" });
        this.actor.add_actor(this.childBox);
        this.childBox.hide();

        this.inspect = new InspectButton(actor, String(actor));
        topBox.add_actor(this.inspect.actor);

        if ( (isParent && this.target.get_parent()) || (!isParent && this.target.get_children().length > 0) ) {
            let showMoreButton = new St.Button();
            topBox.add_actor(showMoreButton);
            showMoreButton.add_actor(new St.Icon({ icon_name: "closed", icon_type: St.IconType.SYMBOLIC, icon_size: 8 }));
            showMoreButton.connect("clicked", Lang.bind(this, this.showMore));
        }

        this.inspect.actor.connect("enter-event", Lang.bind(this, this.onEnterEvent));
        this.inspect.actor.connect("leave-event", Lang.bind(this, this.onLeaveEvent));

        this.marker = new St.Bin({ style: "background-color: rgba(100,100,100,.25);" });
        this.marker.hide();
        Main.uiGroup.add_actor(this.marker);
    },

    onEnterEvent: function() {
        let [x, y] = this.target.get_transformed_position();
        this.marker.set_position(x, y);
        let [width, height] = this.target.get_size();
        this.marker.set_size(width, height);
        this.marker.raise_top();
        this.marker.show();
    },

    onLeaveEvent: function() {
        this.marker.hide();
    },

    showMore: function() {
        if ( !this.moreShown ) {
            // todo: make sure we only have one set showing here at a time and don't try to show if it already is
            if ( this.isParent ) {
                this.childBox.add_actor(new ActorButton(this.target.get_parent(), true).actor);
            }
            else {
                for ( let child of this.target.get_children()) {
                    this.childBox.add_actor(new ActorButton(child, false).actor);
                }
            }
        }

        if ( this.childBox.visible ) {
            this.childBox.hide();
        }
        else {
            this.childBox.show();
        }

        this.moreShown = true;
    }
}


function InspectInterface(target, controllerObj) {
    this._init(target, controllerObj);
}

InspectInterface.prototype = {
    __proto__: TabPanel.TabPanelBase.prototype,

    name: _("Inspect"),

    _init: function(target, controllerObj) {
        TabPanel.TabPanelBase.prototype._init.call(this, true);

        this.target = target;
        controller = controllerObj;
        this.type = getType(target);

        let scrollBox = new St.ScrollView({ style_class: "devtools-inspect-scrollbox"});
        this.panel.add_actor(scrollBox);

        this.contentBox = new St.BoxLayout({ vertical: true, style_class: "devtools-inspect-content" });
        scrollBox.add_actor(this.contentBox);

        this.contentBox.add_actor(new St.Label({ text: capitalize(this.type), style_class: "devtools-inspect-subtitle" }))

        let objName = new St.Label({ text: this.getObjectText(target,this.type)[0], style_class: "devtools-indented" });
        this.contentBox.add_actor(objName);

        switch ( this.type ) {
            case "window":
                this.generateWindowContent();
                break;
            case "array":
                this.generateArrayContent();
                break;
            case "actor":
                this.generateActorContent();
                break;
            case "applet":
                this.generateAppletContent();
                break;
            case "desklet":
                this.generateDeskletContent();
                break;
        }

        this.generateObjectContent();
    },

    generateArrayContent: function() {
        this.contentBox.add_actor(new St.Label({ text: _("Length"), style_class: "devtools-inspect-subtitle" }));
        this.contentBox.add_actor(new St.Label({ text: String(this.target.length), style_class: "devtools-indented" }));
    },

    generateActorContent: function() {
        //parent actor
        let parent = this.target.get_parent();
        this.contentBox.add_actor(new St.Label({ text: _("Parent"), style_class: "devtools-inspect-subtitle" }));
        let parentBox = new St.BoxLayout({ style_class: "devtools-indented" });
        this.contentBox.add_actor(parentBox);
        if ( parent ) parentBox.add_actor(new ActorButton(parent, true).actor);
        else parentBox.add_actor(new St.Label({ text: "none" }));

        //child actors
        let children = this.target.get_children();

        this.contentBox.add_actor(new St.Label({ text: _("Children"), style_class: "devtools-inspect-subtitle" }));
        if ( children.length > 0 ) {
            let childrenBox = new St.BoxLayout({ vertical: true, style_class: "devtools-indented" });
            this.contentBox.add_actor(childrenBox);
            for ( let child of children ) {
                childrenBox.add_actor(new ActorButton(child, false).actor);
            }
        }
        else this.contentBox.add_actor(new St.Label({ text: "none", style_class: "devtools-indented" }));

        //attributes
        this.contentBox.add_actor(new St.Label({ text: _("Height"), style_class: "devtools-inspect-subtitle" }));
        this.contentBox.add_actor(new St.Label({ text: this.target.height+" px", style_class: "devtools-indented" }));
        this.contentBox.add_actor(new St.Label({ text: _("Width"), style_class: "devtools-inspect-subtitle" }));
        this.contentBox.add_actor(new St.Label({ text: this.target.width+" px", style_class: "devtools-indented" }));
        this.contentBox.add_actor(new St.Label({ text: _("Visible"), style_class: "devtools-inspect-subtitle" }));
        this.contentBox.add_actor(new St.Label({ text: String(this.target.visible).capitalize(), style_class: "devtools-indented" }));

        if ( this.target instanceof St.Widget ) {
            this.contentBox.add_actor(new St.Label({ text: _("Style Class"), style_class: "devtools-inspect-subtitle" }));
            let styleClass = this.target.style_class;
            if ( !styleClass ) styleClass = _("None")
            this.contentBox.add_actor(new St.Label({ text: styleClass, style_class: "devtools-indented" }));
        }
    },

    generateWindowContent: function() {
        let app = Cinnamon.WindowTracker.get_default().get_window_app(this.target);

        this.contentBox.add_actor(new St.Label({ text: _("Title"), style_class: "devtools-inspect-subtitle" }));
        this.contentBox.add_actor(new St.Label({ text: this.target.title, style_class: "devtools-indented" }));

        this.contentBox.add_actor(new St.Label({ text: _("Class"), style_class: "devtools-inspect-subtitle" }));
        this.contentBox.add_actor(new St.Label({ text: this.target.get_wm_class(), style_class: "devtools-indented" }));

        this.contentBox.add_actor(new St.Label({ text: _("Workspace"), style_class: "devtools-inspect-subtitle" }));
        let [wsMeta,wsName,wsId] = Windows.getWorkspaceForWindow(this.target);
        if ( wsMeta != null ) {
            let workspaceBox = new St.BoxLayout({ style_class: "devtools-indented" });
            this.contentBox.add_actor(workspaceBox);
            workspaceBox.add_actor(new InspectButton(wsMeta, wsName).actor);
        }
        else this.contentBox.add_actor(new St.Label({ text: wsName, style_class: "devtools-indented" }));

        this.contentBox.add_actor(new St.Label({ text: _("Monitor"), style_class: "devtools-inspect-subtitle" }));
        this.contentBox.add_actor(new St.Label({ text: String(this.target.get_monitor()), style_class: "devtools-indented" }));

        let rect = this.target.get_rect();
        this.contentBox.add_actor(new St.Label({ text: _("Size"), style_class: "devtools-inspect-subtitle" }));
        this.contentBox.add_actor(new St.Label({ text: rect.width+"px X "+rect.height+"px", style_class: "devtools-indented" }));
        this.contentBox.add_actor(new St.Label({ text: _("Position"), style_class: "devtools-inspect-subtitle" }));
        this.contentBox.add_actor(new St.Label({ text: "x: "+rect.x+", y: "+rect.y, style_class: "devtools-indented" }));
    },

    generateAppletContent: function() {
        this.contentBox.add_actor(new St.Label({ text: "UUID", style_class: "devtools-inspect-subtitle" }));
        this.contentBox.add_actor(new St.Label({ text: this.target._uuid, style_class: "devtools-indented" }));
    },

    generateDeskletContent: function() {
        this.contentBox.add_actor(new St.Label({ text: "UUID", style_class: "devtools-inspect-subtitle" }));
        this.contentBox.add_actor(new St.Label({ text: this.target._uuid, style_class: "devtools-indented" }));
    },

    generateObjectContent: function() {
        let propText, itemText;
        if ( this.type == "array" ) {
            propText = _("Values");
            itemText = _("Index");
        }
        else if ( this.type == "map" ) {
            propText = _("Map Elements");
            itemText = _("Key");
        }
        else {
            propText = _("Properties");
            itemText = _("Name");
        }
        this.contentBox.add_actor(new St.Label({ text: propText, style_class: "devtools-inspect-subtitle" }));
        this.propertiesTable = new St.Table({ homogeneous: false, clip_to_allocation: true, style_class: "devtools-inspect-table" });
        this.contentBox.add_actor(this.propertiesTable);
        this.propertiesTable.add(new St.Label({ text: itemText }), { row: 0, col: 0, min_width: 150 });
        this.propertiesTable.add(new St.Label({ text: _("Type") }), { row: 0, col: 1, min_width: 100 });
        this.propertiesTable.add(new St.Label({ text: _("Value") }), { row: 0, col: 2 });
        this.propRowIndex = 1;
        this.propertiesBox = new St.BoxLayout({ vertical: true, style_class: "devtools-indented" });
        this.contentBox.add_actor(this.propertiesBox);

        if ( this.type == "map" ) {
            for ( let [key, value] of this.target ) {
                let type = getType(value);
                this.createChildItem(type, key, value);
            }
        }
        else {
            let propertyLists = {};
            for ( let prop in this.target ) {
                let type = getType(this.target[prop]);
                if ( propertyLists[type] == undefined ) propertyLists[type] = [];
                propertyLists[type].push(prop);
            }

            let propBox;
            for ( let type in propertyLists ) {
                let list = propertyLists[type];
                list.sort();
                for ( let i = 0; i < list.length; i++ ) {
                    this.createChildItem(type, list[i], this.target[list[i]]);
                }
            }
        }
    },

    createChildItem: function(type, prop, value) {
        let name = new St.Label({ text: prop, min_width: 150 });
        this.propertiesTable.add(name, { row: this.propRowIndex, col: 0 });

        let typeLabel = new St.Label({ text: type, min_width: 80 });
        this.propertiesTable.add(typeLabel, { row: this.propRowIndex, col: 1 });

        let text;
        let [longText, shortText] = this.getObjectText(value, type);
        if ( INSPECTABLE_TYPES.indexOf(type) == -1 ) {
            text = new St.Label({ text: shortText, reactive: true });
            new Tooltips.Tooltip(text, longText);
        }
        else {
            text = new InspectButton(value, shortText).actor;
            new Tooltips.Tooltip(text, _("Inspect") + " "+longText);
        }
        this.propertiesTable.add(text, { row: this.propRowIndex, col: 2, x_expand: false, x_align: St.Align.START });

        this.propRowIndex++;
    },

    getObjectText: function(object, type) {
        let longText = String(object);
        if ( type == "array" ) longText = "[" + longText + "]";
        let shortText = longText.split("\n")[0];
        return [longText, shortText];
    }
}
