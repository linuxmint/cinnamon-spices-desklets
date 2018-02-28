const AppletManager = imports.ui.appletManager;
const DeskletManager = imports.ui.deskletManager;
const Extension = imports.ui.extension;
const Flashspot = imports.ui.flashspot;
const Tooltips = imports.ui.tooltips;
const Util = imports.misc.util;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Gettext = imports.gettext;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

const uuid = "devTools@scollins";
const isCinnamonGTE38 = typeof require !== 'undefined';
let Tab, TabPanel, CollapseButton;
if (isCinnamonGTE38) {
    Tab = require('./tab');
    TabPanel = require('./tabPanel');
    CollapseButton = require('./collapseButton');
} else {
    const DeskletDir = imports.ui.deskletManager.desklets[uuid];
    Tab = DeskletDir.tab;
    TabPanel = DeskletDir.tabPanel;
    CollapseButton = DeskletDir.collapseButton;
}


let controller;


function _(str, domain) {
    if ( !domain ) domain = uuid;
    let translation = Gettext.dgettext(domain, str);
    if (translation != str) {
        return translation;
    }
    return Gettext.gettext(str);
}

function ExtensionItem(meta, type, definitions) {
    this._init(meta, type, definitions);
}

ExtensionItem.prototype = {
    _init: function(meta, type, definitions) {
        try {
            this.meta = meta;
            this.uuid = meta.uuid;
            this.type = type;
            this.instances = [];

            if (isCinnamonGTE38) {
                this.definitions = definitions;
                for (let i = 0; i < this.definitions.length; i++) {
                    let instance = this.definitions[i];
                    if (instance.applet) {
                        instance = instance.applet;
                    } else if (instance.desklet) {
                        instance = instance.desklet;
                    }
                    this.instances.push(instance);
                }
            } else {
               this.definitions = type.maps.objects[this.uuid]._loadedDefinitions;
               for( let id in this.definitions ) this.instances.push(this.definitions[id]);
            }

            let maxInstances = meta["max-instances"];
            if ( maxInstances == -1 ) maxInstances = _("Infinite");
            this.isMultiInstance = maxInstances && maxInstances != 1;

            this.actor = new St.BoxLayout({ style_class: "devtools-extensions-container", reactive: true });

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

            //name
            let nameString = _(meta.name, this.uuid) + "        (" + this.uuid + ")";
            let name = new St.Label({ text: nameString, style: "color: blue;" });
            infoBox.add_actor(name);

            //status
            let status = new St.Label({ text: Extension.getMetaStateString(meta.state) });
            infoBox.add_actor(status);
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
            let buttonBox = new St.BoxLayout({ vertical: false, style_class: "devtools-extensions-buttonBox" });
            infoBox.add_actor(buttonBox);

            //reload
            let reloadButton = new St.Button({ label: _("Reload"), x_align: St.Align.MIDDLE, style_class: "devtools-contentButton" });
            buttonBox.add_actor(reloadButton);
            reloadButton.connect("clicked", Lang.bind(this, this.reload));

            //remove
            let removeButton = new St.Button({ label: _("Remove"), x_align: St.Align.MIDDLE, style_class: "devtools-contentButton" });
            buttonBox.add_actor(removeButton);
            removeButton.connect("clicked", Lang.bind(this, this.removeAll));

            /*check for multi-instance*/
            if ( this.isMultiInstance ) {
                let buttonString = _("Instances") + ": " + this.instances.length + " (" + _("maximum of") + ": " + maxInstances + ")";
                let instanceDropdown = new CollapseButton.CollapseButton(buttonString, false, null);
                infoBox.add_actor(instanceDropdown.actor);
                instanceDropdown.actor.x_expand = false;

                let instancesContainer = new St.BoxLayout({ vertical: true });
                instanceDropdown.setChild(instancesContainer);

                for ( let i = 0; i < this.instances.length; i++ ) {
                    let instance = this.instances[i];
                    let idKey = type.name.toLowerCase()+"_id";
                    let id = isCinnamonGTE38 ? this.definitions[i][idKey] : instance[idKey];

                    let instanceBox = new St.BoxLayout({ style_class: "devtools-extensions-instanceBox" });
                    instancesContainer.add_actor(instanceBox);

                    instanceBox.add_actor(new St.Label({ text: "ID: "+id }));

                    //highlight button
                    let highlightButton = new St.Button({ label: _("Highlight"), style_class: "devtools-contentButton" });
                    instanceBox.add_actor(highlightButton);
                    highlightButton.connect("clicked", Lang.bind(this, function() { this.highlight(id); }));

                    //inspect button
                    let inspectButton = new St.Button({ label: _("Inspect"), style_class: "devtools-contentButton" });
                    instanceBox.add_actor(inspectButton);
                    inspectButton.connect("clicked", Lang.bind(this, this.inspect, id));

                    //remove button
                    let removeButton = new St.Button({ label: _("Remove"), style_class: "devtools-contentButton" });
                    instanceBox.add_actor(removeButton);
                    removeButton.connect("clicked", Lang.bind(this, function() { this.remove(id); }));
                }
            }
            else {
                //highlight button
                if ( this.type == Extension.Type.APPLET || this.type == Extension.Type.DESKLET ) {
                    let highlightButton = new St.Button({ label: _("Highlight"), x_align: St.Align.MIDDLE, style_class: "devtools-contentButton" });
                    buttonBox.add_actor(highlightButton);
                    highlightButton.connect("clicked", Lang.bind(this, function() { this.highlight(this.uuid); }));

                    //inspect button
                    let inspectButton = new St.Button({ label: _("Inspect"), x_align: St.Align.MIDDLE, style_class: "devtools-contentButton" });
                    buttonBox.add_actor(inspectButton);
                    inspectButton.connect("clicked", Lang.bind(this, this.inspect, this.uuid));
                }
            }

            //link to settings
            if ( !meta["hide-configuration"] && GLib.file_test(meta.path + "/settings-schema.json", GLib.FileTest.EXISTS)) {
                let settingsButton = new St.Button({ label: _("Configure"), x_align: St.Align.MIDDLE, style_class: "devtools-contentButton" });
                buttonBox.add_actor(settingsButton);
                settingsButton.connect("clicked", Lang.bind(this, function() {
                    Util.spawnCommandLine(["xlet-settings", type.name.toLowerCase(), this.uuid].join(' '));
                }));
            }

            let tooltip = new Tooltips.Tooltip(this.actor, nameString + "\n" + _(meta.description, this.uuid) + "\n" + meta.path);
            tooltip._tooltip.style = "text-align: left;"
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
        if (isCinnamonGTE38) {
            let refInstances = this.definitions.filter((instance) => {
                let key = this.type.name.toLowerCase() + '_id';
                return instance[key] === id;
            });
            return refInstances[0];
        }
        if ( !this.isMultiInstance ) {
            id = Object.keys(this.definitions)[0];
        }

        if ( this.type == Extension.Type.APPLET )
            return AppletManager.appletObj[id];
        else return DeskletManager.deskletObj[id];
    }
}


function ExtensionInterface(controllerObj) {
    this._init(controllerObj);
}

ExtensionInterface.prototype = {
    __proto__: TabPanel.TabPanelBase.prototype,

    name: _("Extensions"),

    _init: function(controllerObj) {
        controller = controllerObj;
        this.reloadId = -1;

        TabPanel.TabPanelBase.prototype._init.call(this);

        let tabBox = new Tab.TabBoxBase({ styleClass: "devtools-sandbox-tabs" });
        this.panel.add_actor(tabBox.actor);

        let contentBox = new St.BoxLayout({ y_expand: true });
        this.panel.add_actor(contentBox);

        let tabManager = new Tab.TabManager(tabBox, contentBox);

        this.pages = {};
        for ( let key in Extension.Type ) {
            let type = Extension.Type[key];
            let typeName = type.name+"s";

            let page = new Tab.TabItemBase({ styleClass: "devtools-sandbox-tab" });
            tabManager.add(page);
            let scrollBox = new St.ScrollView({ x_expand: true, x_fill: true, y_expand: true, y_fill: true });
            page.setContent(scrollBox);
            page.setTabContent(new St.Label({ text: _(typeName, "cinnamon") }));

            let extensionBox = new St.BoxLayout({ vertical: true, style_class: "devtools-extensions-mainBox" });
            scrollBox.add_actor(extensionBox);
            this.pages[key] = extensionBox;

            type.connect("extension-loaded", Lang.bind(this, this.queueReload));
            type.connect("extension-unloaded", Lang.bind(this, this.queueReload));
        }

        tabManager.selectIndex(0);
    },

    queueReload: function() {
        if ( this.reloadId == -1 ) {
            this.reloadId = Mainloop.idle_add(Lang.bind(this, this.reload));
        }
    },

    reload: function() {
        this.reloadId = -1;
        if ( !this.selected ) return;

        if (isCinnamonGTE38) {
            let extensions = Extension.extensions;
            let extensionsAndSearchProviders = [];
            for (let i = 0; i < extensions.length; i++) {
                if (extensions[i].lowerType === 'extension' || extensions[i].lowerType === 'search_provider') {
                    extensionsAndSearchProviders.push(extensions[i]);
                }
            }
            let instances = AppletManager.definitions
                .concat(DeskletManager.definitions)
                .concat(extensionsAndSearchProviders)
            for (let key in Extension.Type) {
                let type = Extension.Type[key];
                this.pages[key].destroy_all_children();

                let hasChildren = false;
                for (let _uuid in type.legacyMeta) {
                    let meta = extensions.filter(function(extension) {
                        return extension.uuid === _uuid;
                    })[0].meta;

                    if (!meta.name) continue;

                    try {
                        let definitions = [];
                        for (let i = 0; i < instances.length; i++) {
                            if (instances[i].uuid !== _uuid) {
                                continue
                            }
                            definitions.push(instances[i])
                        }
                        let extension = new ExtensionItem(meta, type, definitions);
                        this.pages[key].add_actor(extension.actor);
                    } catch (e) {
                        global.logError(_("failed to create extension item for uuid") + " " + _uuid);
                        global.logError(e);
                    }
                    hasChildren = true;
                }
                if ( !hasChildren ) {
                    let messageBin = new St.Bin({ y_expand: true });
                    this.pages[key].add_actor(messageBin);
                    messageBin.set_child(new St.Label({ text: _("No extensions of this type are enabled") }));
                }
            }
            return;
        }

        for ( let key in Extension.Type ) {
            let type = Extension.Type[key];
            this.pages[key].destroy_all_children();

            let hasChildren = false;
            for ( let uuid in type.maps.meta ) {
                let meta = type.maps.meta[uuid];

                if ( !meta.name ) continue;

                try {
                    let extension = new ExtensionItem(meta, type);
                    this.pages[key].add_actor(extension.actor);
                } catch(e) {
                    global.logError(_("failed to create extension item for uuid") + " " + uuid);
                    global.logError(e);
                }
                hasChildren = true;
            }
            if ( !hasChildren ) {
                let messageBin = new St.Bin({ y_expand: true });
                this.pages[key].add_actor(messageBin);
                messageBin.set_child(new St.Label({ text: _("No extensions of this type are enabled") }));
            }
        }
    },

    onSelected: function() {
        this.reload();
    }
}
