const CheckBox = imports.ui.checkBox;
const LookingGlass = imports.ui.lookingGlass;
const Main = imports.ui.main;
const Cinnamon = imports.gi.Cinnamon;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

const uuid = "devTools@scollins";

let TabPanel, Text;
if (typeof require !== 'undefined') {
    TabPanel = require('./tabPanel');
    Text = require('./text');
} else {
    const DeskletDir = imports.ui.deskletManager.desklets[uuid];
    TabPanel = DeskletDir.tabPanel;
    Text = DeskletDir.text;
}


const CINNAMON_LOG_REFRESH_TIMEOUT = 1;
const XSESSION_LOG_REFRESH_TIMEOUT = 10;

const Gettext = imports.gettext;
Gettext.bindtextdomain(uuid, GLib.get_home_dir() + "/.local/share/locale")


let xsession_hide_old = true;

function _(str) {
  return Gettext.dgettext(uuid, str);
}

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

        this.hideOld = new CheckBox.CheckBox(_("Hide old errors"), { style_class: "devtools-checkBox" });
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

        this.file = Gio.file_new_for_path(GLib.get_home_dir() + "/.xsession-errors");
    },

    getText: function() {
        //if the tab is not shown don't waste resources on refreshing content
        if ( !this.selected ) return false;

        try {
            let lines = Cinnamon.get_file_contents_utf8_sync(this.file.get_path()).split('\n');
            let text = "";
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

        return true;
    },

    onSelected: function() {
        this.getText();
        Mainloop.timeout_add(500, Lang.bind(this, this.getText));
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

        this.showTimestamp = new CheckBox.CheckBox(_("Show Timestamp"), { style_class: "devtools-checkBox" });
        bottomBox.add_actor(this.showTimestamp.actor);
        this.showTimestamp.actor.checked = this.settings.getValue("clTimestamp");
        this.showTimestamp.actor.connect("clicked", Lang.bind(this, function() {
            this.settings.setValue("clTimestamp", this.showTimestamp.actor.checked);
            this.getText();
        }));

        this.infos = new CheckBox.CheckBox(_("Infos"), { style_class: "devtools-checkBox" });
        bottomBox.add_actor(this.infos.actor);
        this.infos.actor.checked = this.settings.getValue("clShowInfos");
        this.infos.actor.connect("clicked", Lang.bind(this, function() {
            this.settings.setValue("clShowInfos", this.infos.actor.checked);
            this.getText();
        }));

        this.warnings = new CheckBox.CheckBox(_("Warnings"), { style_class: "devtools-checkBox" });
        bottomBox.add_actor(this.warnings.actor);
        this.warnings.actor.checked = this.settings.getValue("clShowWarnings");
        this.warnings.actor.connect("clicked", Lang.bind(this, function() {
            this.settings.setValue("clShowWarnings", this.warnings.actor.checked);
            this.getText();
        }));

        this.errors = new CheckBox.CheckBox(_("Errors"), { style_class: "devtools-checkBox" });
        bottomBox.add_actor(this.errors.actor);
        this.errors.actor.checked = this.settings.getValue("clShowErrors");
        this.errors.actor.connect("clicked", Lang.bind(this, function() {
            this.settings.setValue("clShowErrors", this.errors.actor.checked);
            this.getText();
        }));

        this.traces = new CheckBox.CheckBox(_("Traces"), { style_class: "devtools-checkBox" });
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
        copyBox.add_actor(new St.Label({ text: _("Copy") }));
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
