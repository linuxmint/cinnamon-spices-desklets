const CheckBox = imports.ui.checkBox;
const LookingGlass = imports.ui.lookingGlass;
const Main = imports.ui.main;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Pango = imports.gi.Pango;
const St = imports.gi.St;
const Lang = imports.lang;

const TabPanel = imports.desklet.tabPanel;
const Text = imports.desklet.text;

const CINNAMON_LOG_REFRESH_TIMEOUT = 1;
const XSESSION_LOG_REFRESH_TIMEOUT = 10;


let xsession_hide_old = true;


function XSessionLogInterface(settings) {
    this._init(settings);
}

XSessionLogInterface.prototype = {
    __proto__: TabPanel.TabPanelBase.prototype,
    
    name: _("X-Session Log"),
    
    _init: function(settings) {
        
        TabPanel.TabPanelBase.prototype._init.call(this);
        
        this.settings = settings;
        this.start = 0;
        
        //content text
        this.text = new Text.Label();
        this.panel.add(this.text.actor, { expand: true });
        this.contentText = this.text.label;
        this.scrollBox = this.text.scroll;
        
        let bottomBox = new St.BoxLayout({ style_class: "devtools-log-bottomBox" });
        this.panel.add_actor(bottomBox);
        
        this.hideOld = new CheckBox.CheckBox("Hide old errors", { style_class: "devtools-checkBox" });
        bottomBox.add_actor(this.hideOld.actor);
        this.hideOld.actor.checked = this.settings.getValue("xsessionHideOld");
        this.hideOld.actor.connect("clicked", Lang.bind(this, function() {
            this.settings.setValue("xsessionHideOld", this.hideOld.actor.checked);
            this.getText();
        }));
        
        bottomBox.add(new St.BoxLayout(), { expand: true });
        
        //clear button
        let clearButton = new St.Button({ style_class: "devtools-contentButton" });
        bottomBox.add_actor(clearButton);
        let clearBox = new St.BoxLayout();
        clearButton.add_actor(clearBox);
        clearBox.add_actor(new St.Label({ text: _("Clear") }));
        clearButton.connect("clicked", Lang.bind(this, this.clear));
        
        this.file = Gio.file_new_for_path(GLib.get_home_dir() + "/.xsession-errors")
        let monitor = this.file.monitor_file(Gio.FileMonitorFlags.NONE, null);
        monitor.connect("changed", Lang.bind(this, this.getText));
    },
    
    getText: function() {
        //if the tab is not shown don't waste resources on refreshing content
        if ( !this.selected ) return;
        
        this.file.load_contents_async(null, Lang.bind(this, function(file, result) {
            try {
                let text = "";
                let lines = String(file.load_contents_finish(result)[1]).split("\n");
                this.end = lines.length - 1;
                for ( let i = this.start; i < lines.length; i++ ) {
                    let line = lines[i];
                    if ( this.hideOld.actor.checked && line.search("About to start Cinnamon") > -1 ) {
                        text = ""
                    }
                    text += line + "\n";
                }
                
                if ( this.contentText.text != text ) {
                    this.contentText.text = text;
                    let adjustment = this.scrollBox.get_vscroll_bar().get_adjustment();
                    adjustment.value = this.contentText.height - adjustment.page_size;
                }
            } catch(e) {
                global.logError(e);
            }
        }));
    },
    
    onSelected: function() {
        this.getText();
    },
    
    clear: function() {
        this.start = this.end;
        this.getText();
    }
}


function CinnamonLogInterface(settings) {
    this._init(settings);
}

CinnamonLogInterface.prototype = {
    __proto__: TabPanel.TabPanelBase.prototype,
    
    name: _("Cinnamon Log"),
    
    _init: function(settings) {
        
        TabPanel.TabPanelBase.prototype._init.call(this);
        
        this.settings = settings;
        
        //content text
        this.text = new Text.Label();
        this.panel.add(this.text.actor, { expand: true });
        this.contentText = this.text.label;
        this.scrollBox = this.text.scroll;
        
        let bottomBox = new St.BoxLayout({ style_class: "devtools-log-bottomBox" });
        this.panel.add_actor(bottomBox);
        
        this.showTimestamp = new CheckBox.CheckBox("Show Timestamp", { style_class: "devtools-checkBox" });
        bottomBox.add_actor(this.showTimestamp.actor);
        this.showTimestamp.actor.checked = this.settings.getValue("clTimestamp");
        this.showTimestamp.actor.connect("clicked", Lang.bind(this, function() {
            this.settings.setValue("clTimestamp", this.showTimestamp.actor.checked);
            this.getText();
        }));
        
        this.infos = new CheckBox.CheckBox("Infos", { style_class: "devtools-checkBox" });
        bottomBox.add_actor(this.infos.actor);
        this.infos.actor.checked = this.settings.getValue("clShowInfos");
        this.infos.actor.connect("clicked", Lang.bind(this, function() {
            this.settings.setValue("clShowInfos", this.infos.actor.checked);
            this.getText();
        }));
        
        this.warnings = new CheckBox.CheckBox("Warnings", { style_class: "devtools-checkBox" });
        bottomBox.add_actor(this.warnings.actor);
        this.warnings.actor.checked = this.settings.getValue("clShowWarnings");
        this.warnings.actor.connect("clicked", Lang.bind(this, function() {
            this.settings.setValue("clShowWarnings", this.warnings.actor.checked);
            this.getText();
        }));
        
        this.errors = new CheckBox.CheckBox("Errors", { style_class: "devtools-checkBox" });
        bottomBox.add_actor(this.errors.actor);
        this.errors.actor.checked = this.settings.getValue("clShowErrors");
        this.errors.actor.connect("clicked", Lang.bind(this, function() {
            this.settings.setValue("clShowErrors", this.errors.actor.checked);
            this.getText();
        }));
        
        this.traces = new CheckBox.CheckBox("Traces", { style_class: "devtools-checkBox" });
        bottomBox.add_actor(this.traces.actor);
        this.traces.actor.checked = this.settings.getValue("clShowTraces");
        this.traces.actor.connect("clicked", Lang.bind(this, function() {
            this.settings.setValue("clShowTraces", this.traces.actor.checked);
            this.getText();
        }));
        
        bottomBox.add(new St.BoxLayout(), { expand: true });
        
        let copyButton = new St.Button({ style_class: "devtools-contentButton" });
        let copyBox = new St.BoxLayout();
        copyButton.add_actor(copyBox);
        copyBox.add_actor(new St.Icon({ icon_name: "edit-copy", icon_size: 16, icon_type: St.IconType.SYMBOLIC }));
        copyBox.add_actor(new St.Label({ text: "Copy" }));
        bottomBox.add_actor(copyButton);
        copyButton.connect("clicked", Lang.bind(this, this.copy));
        
        this.connectToLgDBus();
    },
    
    connectToLgDBus: function() {
        let proxy = Gio.DBusProxy.makeProxyWrapper(LookingGlass.lgIFace);
        new proxy(Gio.DBus.session, "org.Cinnamon.LookingGlass", "/org/Cinnamon/LookingGlass", Lang.bind(this, function(proxy, error) {
            this._proxy = proxy;
            this._proxy.connectSignal("LogUpdate", Lang.bind(this, this.getText));
        }));
    },
    
    getText: function() {
        //if the tab is not shown don't waste resources on refreshing content
        if ( !this.selected ) return;
        
        let stack = Main._errorLogStack;
        
        let text = "";
        for ( let i = 0; i < stack.length; i++) {
            let logItem = stack[i];
            switch ( logItem.category ) {
                case "error":
                    if ( !this.errors.actor.checked ) continue;
                    break;
                case "info":
                    if ( !this.infos.actor.checked ) continue;
                    break;
                case "warning":
                    if ( !this.warnings.actor.checked ) continue;
                    break;
                case "trace":
                    if ( !this.traces.actor.checked ) continue;
                    break;
            }
            text += logItem.category + ":  ";
            if ( this.showTimestamp.actor.checked ) text += this._formatTime(new Date(parseInt(logItem.timestamp)));
            text += logItem.message + "\n";
        }
        
        this.contentText.text = text;
        let adjustment = this.scrollBox.get_vscroll_bar().get_adjustment();
        adjustment.value = this.contentText.height - this.text.actor.height;
    },
    
    onSelected: function() {
        this.getText();
    },
    
    copy: function() {
        St.Clipboard.get_default().set_text(this.contentText.text);
    }
}
