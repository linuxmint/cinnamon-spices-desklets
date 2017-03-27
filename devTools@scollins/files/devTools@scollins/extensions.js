const AppletManager = imports.ui.appletManager;
const CheckBox = imports.ui.checkBox;
const Desklet = imports.ui.desklet;
const DeskletManager = imports.ui.deskletManager;
const Extension = imports.ui.extension;
const Flashspot = imports.ui.flashspot;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

const TabPanel = imports.desklet.tabPanel;
const CollapseButton = imports.desklet.collapseButton;


let controller;


function ExtensionItem(meta, type) {
    this._init(meta, type);
}

ExtensionItem.prototype = {
    _init: function(meta, type) {
        try {
            this.meta = meta;
            this.uuid = meta.uuid;
            this.type = type;
            this.definitions = type.maps.objects[this.uuid]._loadedDefinitions;
            this.instances = [];
            for( let id in this.definitions ) this.instances.push(this.definitions[id]);
            let maxInstances = meta["max-instances"];
            if ( maxInstances == -1 ) maxInstances = "Infinite";
            this.isMultiInstance = maxInstances && maxInstances != 1;
            
            this.actor = new St.BoxLayout({ style_class: "devtools-extensions-container" });
            
            /*icon*/
            let iconBin = new St.Bin({ style_class: "devtools-extensions-icon" });
            this.actor.add_actor(iconBin);
            
            let icon;
            if ( meta.icon ) icon = new St.Icon({ icon_name: meta.icon, icon_size: 48, icon_type: St.IconType.FULLCOLOR });
            else {
                let file = Gio.file_new_for_path(meta.path + "/icon.png");
                if ( file.query_exists(null) ) {
                    let gicon = new Gio.FileIcon({ file: file });
                    icon = new St.Icon({ gicon: gicon, icon_size: 48, icon_type: St.IconType.FULLCOLOR });
                }
                else {
                    icon = new St.Icon({ icon_name: "cs-"+type.folder, icon_size: 48, icon_type: St.IconType.FULLCOLOR });
                }
            }
            iconBin.add_actor(icon);
            
            /*info*/
            let infoBin = new St.Bin({ x_align: St.Align.START, x_expand: true, x_fill: true });
            this.actor.add(infoBin, { expand: true });
            let infoBox = new St.BoxLayout({ vertical: true });
            infoBin.set_child(infoBox);
            infoBox.add_actor(new St.Label({ text: type.name, style_class: "devtools-extensions-title" }));
            
            let table = new St.Table({ homogeneous: false, clip_to_allocation: true });
            infoBox.add(table, { y_align: St.Align.MIDDLE, y_expand: false });
            
            //name
            let nameString = meta.name;
            if ( meta.version ) nameString += " " + meta.version;
            table.add(new St.Label({ text: "Name:   " }), { row: 0, col: 0, col_span: 1,  x_expand: false, x_align: St.Align.START });
            let name = new St.Label({ text: nameString + "        (" + this.uuid + ")", style: "color: blue;" });
            table.add(name, { row: 0, col: 1, col_span: 1, x_expand: false, x_align: St.Align.START });
            
            //description
            table.add(new St.Label({ text: "Description:   " }), { row: 1, col: 0, col_span: 1, x_expand: false, x_align: St.Align.START });
            let description = new St.Label({ text: "" });
            table.add(description, { row: 1, col: 1, col_span: 1, y_expand: true, x_expand: false, x_align: St.Align.START });
            description.set_text(meta.description);
            
            //path
            table.add(new St.Label({ text: "Path:   " }), { row: 2, col: 0, col_span: 1, x_expand: false, x_align: St.Align.START });
            let path = new St.Label({ text: meta.path });
            table.add(path, { row: 2, col: 1, col_span: 1, x_expand: false, x_align: St.Align.START });
            
            //status
            table.add(new St.Label({ text: "Status:   " }), { row: 3, col: 0, col_span: 1, x_expand: false, x_align: St.Align.START });
            let status = new St.Label({ text: Extension.getMetaStateString(meta.state) });
            table.add(status, { row: 3, col: 1, col_span: 1, x_expand: false, x_align: St.Align.START });
            switch ( meta.state ) {
                case Extension.State.INITIALIZING:
                    status.style = "color: yellow;";
                    break;
                case Extension.State.LOADED:
                    status.style = "color: green;";
                    break;
                case Extension.State.ERROR:
                case Extension.State.OUT_OF_DATE:
                    status.style = "color: red;";
                    break;
            }
            
            /*extension options*/
            let buttonBox = new St.BoxLayout({ vertical:true, style_class: "devtools-extensions-buttonBox" });
            this.actor.add_actor(buttonBox);
            
            //reload
            let reloadButton = new St.Button({ label: "Reload", x_align: St.Align.END, style_class: "devtools-contentButton" });
            buttonBox.add_actor(reloadButton);
            reloadButton.connect("clicked", Lang.bind(this, this.reload));
            
            //remove
            let removeButton = new St.Button({ label: "Remove", x_align: St.Align.END, style_class: "devtools-contentButton" });
            buttonBox.add_actor(removeButton);
            removeButton.connect("clicked", Lang.bind(this, this.removeAll));
            
            /*check for multi-instance*/
            if ( this.isMultiInstance ) {
                let instanceDropdown = new CollapseButton.CollapseButton("Instances: "+this.instances.length+" of "+maxInstances, false, null);
                table.add(instanceDropdown.actor, { row: 4, col: 0, col_span: 2, x_expand: false, x_align: St.Align.START });
                
                let instancesContainer = new St.BoxLayout({ vertical: true });
                instanceDropdown.setChild(instancesContainer);
                
                for ( let i = 0; i < this.instances.length; i++ ) {
                    let instance = this.instances[i];
                    let id = instance[type.name.toLowerCase()+"_id"];
                    
                    let instanceBox = new St.BoxLayout({ style_class: "devtools-extensions-instanceBox" });
                    instancesContainer.add_actor(instanceBox);
                    
                    instanceBox.add_actor(new St.Label({ text: "ID: "+id }));
                    
                    //highlight button
                    let highlightButton = new St.Button({ label: "Highlight", style_class: "devtools-contentButton" });
                    instanceBox.add_actor(highlightButton);
                    highlightButton.connect("clicked", Lang.bind(this, function() { this.highlight(id); }));
                    
                    //inspect button
                    let inspectButton = new St.Button({ label: "Inspect", style_class: "devtools-contentButton" });
                    instanceBox.add_actor(inspectButton);
                    inspectButton.connect("clicked", Lang.bind(this, this.inspect, id));
                    
                    //remove button
                    let removeButton = new St.Button({ label: "Remove" });
                    instanceBox.add_actor(removeButton);
                    removeButton.connect("clicked", Lang.bind(this, function() { this.remove(id); }));
                }
            }
            else {
                //highlight button
                if ( this.type == Extension.Type.APPLET || this.type == Extension.Type.DESKLET ) {
                    let highlightButton = new St.Button({ label: "Highlight", x_align: St.Align.END, style_class: "devtools-contentButton" });
                    buttonBox.add_actor(highlightButton);
                    highlightButton.connect("clicked", Lang.bind(this, function() { this.highlight(this.uuid); }));
                    
                    //inspect button
                    let inspectButton = new St.Button({ label: "Inspect", x_align: St.Align.END, style_class: "devtools-contentButton" });
                    buttonBox.add_actor(inspectButton);
                    inspectButton.connect("clicked", Lang.bind(this, this.inspect, this.uuid));
                }
            }
            
            //link to settings
            if ( !meta["hide-configuration"] && GLib.file_test(meta.path + "/settings-schema.json", GLib.FileTest.EXISTS)) {
                let settingsButton = new St.Button({ label: "Settings", x_align: St.Align.END, style_class: "devtools-contentButton" });
                buttonBox.add_actor(settingsButton);
                settingsButton.connect("clicked", Lang.bind(this, function() {
                    Util.spawnCommandLine("cinnamon-settings applets " + this.uuid);
                }));
            }
        } catch(e) {
            global.logError(e);
        }
    },
    
    reload: function() {
        Extension.reloadExtension(this.uuid, this.type);
    },
    
    remove: function(id) {
        switch ( this.type ) {
            case Extension.Type.APPLET:
                AppletManager._removeAppletFromPanel(null, null, null, this.uuid, id);
                break;
            case Extension.Type.DESKLET:
                DeskletManager.removeDesklet(this.uuid, id);
                break;
            case Extension.Type.EXTENSION:
                Extension.unloadExtension(this.uuid);
                break;
        }
    },
    
    removeAll: function() {
        for ( let i = 0; i < this.instances.length; i++ ) {
            let instance = this.instances[i];
            let id;
            if ( this.type == Extension.Type.APPLET ) id = instance.applet_id;
            else id = instance.desklet_id;
            this.remove(id);
        }
    },
    
    highlight: function(id) {
        let obj = this.getXletObject(id);
        if ( !obj ) return;
        
        let actor = obj.actor;
        if ( !actor ) return;
        let [x, y] = actor.get_transformed_position();
        let [w, h] = actor.get_transformed_size();
        
        let flashspot = new Flashspot.Flashspot({ x : x, y : y, width: w, height: h });
        flashspot.fire();
    },
    
    inspect: function(button, buttonPressed, id) {
        controller.inspect(this.getXletObject(id));
    },
    
    getXletObject: function(id) {
        if ( !this.isMultiInstance ) {
            id = Object.keys(this.definitions)[0];
        }
        
        if ( this.type == Extension.Type.APPLET ) return AppletManager.appletObj[id];
        else return DeskletManager.deskletObj[id];
    }
}


function ExtensionInterface(controllerObj) {
    this._init(controllerObj);
}

ExtensionInterface.prototype = {
    __proto__: TabPanel.TabPanelBase.prototype,
    
    name: "Extensions",
    
    _init: function(controllerObj) {
        controller = controllerObj;
        
        TabPanel.TabPanelBase.prototype._init.call(this);
        
        let scrollBox = new St.ScrollView();
        this.panel.add(scrollBox, { expand: true });
        
        this.extensionBox = new St.BoxLayout({ vertical: true, style_class: "devtools-extensions-mainBox" });
        scrollBox.add_actor(this.extensionBox);
        
        let bottomBox = new St.BoxLayout();
        this.panel.add_actor(bottomBox);
        
        this.checkBoxes = {};
        for ( let key in Extension.Type ) {
            let type = Extension.Type[key];
            let checkbox = new CheckBox.CheckBox("Show "+type.name+"s", { style_class: "devtools-checkBox" });
            this.checkBoxes[type.name] = checkbox;
            bottomBox.add_actor(checkbox.actor);
            checkbox.actor.checked = controller.settings.getValue("show"+type.name);
            checkbox.actor.connect("clicked", Lang.bind(this, function() {
                controller.settings.setValue("show"+type.name, checkbox.actor.checked);
                this.reload();
            }));
            
            type.connect("extension-loaded", Lang.bind(this, this.reload));
            type.connect("extension-unloaded", Lang.bind(this, this.queueReload));
        }
    },
    
    queueReload: function() {
        Mainloop.idle_add(Lang.bind(this, this.reload));
    },
    
    reload: function() {
        try {
            if ( !this.selected ) return;
            this.extensionBox.destroy_all_children();
            
            for ( let typeName in Extension.Type ) {
                let type = Extension.Type[typeName];
                for ( let uuid in type.maps.meta ) {
                    let meta = type.maps.meta[uuid];
                    
                    if ( !meta.name ) continue;
                    if ( !type || !this.checkBoxes[type.name].actor.checked ) continue;
                    
                    let extension = new ExtensionItem(meta, type);
                    this.extensionBox.add_actor(extension.actor);
                }
            }
        } catch(e) {
            global.logError(e);
        }
    },
    
    onSelected: function() {
        Mainloop.idle_add(Lang.bind(this, this.reload));
    }
}
