const Main = imports.ui.main;
const Tooltips = imports.ui.tooltips;
const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Lang = imports.lang;
const FileDialog = imports.misc.fileDialog;

const uuid = "devTools@scollins";

let Tab, TabPanel, Text;
if (typeof require !== 'undefined') {
    Tab = require('./tab');
    TabPanel = require('./tabPanel');
    Text = require('./text');
} else {
    const DeskletDir = imports.ui.deskletManager.desklets[uuid];
    Tab = DeskletDir.tab;
    TabPanel = DeskletDir.tabPanel;
    Text = DeskletDir.text;
}

const Gettext = imports.gettext;
Gettext.bindtextdomain(uuid, GLib.get_home_dir() + "/.local/share/locale")

function _(str) {
  return Gettext.dgettext(uuid, str);
}

function getDefaultParams(path) {
    let params = {};

    if ( path ) params.path = path;
    let jsFilter = new FileDialog.Filter("Javascript");
    jsFilter.addMimeType("application/javascript");
    jsFilter.addMimeType("text/javascript");
    jsFilter.addPattern("*.js");

    let textFilter = new FileDialog.Filter("Text");
    textFilter.addMimeType("text/*");

    let anyFilter = new FileDialog.Filter("All Files");
    anyFilter.addPattern("*");

    params.filters = [jsFilter, textFilter, anyFilter];

    return params;
}


function TextEditor(title) {
    this._init(title);
}

TextEditor.prototype = {
    __proto__: Tab.TabItemBase.prototype,
    
    _init: function(title) {
        try {
            Tab.TabItemBase.prototype._init.call(this, { styleClass: "devtools-sandbox-tab" });
            
            this.setTabContent(new St.Label({ text: title }));
            let content = new St.BoxLayout({ style_class: "devtools-sandbox-box" });
            this.setContent(content);
            
            //buttons
            this.buttonBox = new St.BoxLayout({ vertical: true, style_class: "devtools-sandbox-buttonBox" });
            content.add_actor(this.buttonBox);
            
            let openFileButton = new St.Button({ style_class: "devtools-sandbox-button" });
            this.buttonBox.add_actor(openFileButton);
            openFileButton.add_actor(new St.Icon({ icon_name: "fileopen", icon_size: 24, icon_type: St.IconType.FULLCOLOR }));
            openFileButton.connect("clicked", Lang.bind(this, this.getFileToOpen));
            new Tooltips.Tooltip(openFileButton, _("Open"));
            
            let saveFileButton = new St.Button({ style_class: "devtools-sandbox-button" });
            this.buttonBox.add_actor(saveFileButton);
            saveFileButton.add_actor(new St.Icon({ icon_name: "filesave", icon_size: 24, icon_type: St.IconType.FULLCOLOR }));
            saveFileButton.connect("clicked", Lang.bind(this, this.saveFile));
            new Tooltips.Tooltip(saveFileButton, _("Save"));
            
            let saveasFileButton = new St.Button({ style_class: "devtools-sandbox-button" });
            this.buttonBox.add_actor(saveasFileButton);
            saveasFileButton.add_actor(new St.Icon({ icon_name: "filesaveas", icon_size: 24, icon_type: St.IconType.FULLCOLOR }));
            saveasFileButton.connect("clicked", Lang.bind(this, this.getFileToSave));
            new Tooltips.Tooltip(saveasFileButton, _("Save As"));
            
            let textArea = new Text.Entry({ lines: 20, style_class: "devtools-sandbox-entryText" });
            content.add(textArea.actor, { expand: true });
            this.text = textArea.text;
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    getText: function() {
        return this.text.text;
    },
    
    enter: function(actor, event) {
        let fullscreen = global.stage_input_mode == Cinnamon.StageInputMode.FULLSCREEN;
        if ( fullscreen && actor == this.text ) return;
        
        if ( !fullscreen ) global.set_stage_input_mode(Cinnamon.StageInputMode.FOCUSED);
        this.text.grab_key_focus();
        if ( !fullscreen ) global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
    },
    
    getFileToOpen: function() {
        FileDialog.open(Lang.bind(this, this.loadFromFile), getDefaultParams((this.file) ? this.file.get_path() : null));
    },
    
    saveFile: function() {
        if ( this.file ) this.saveToFile(this.file.get_path());
        else this.getFileToSave();
    },
    
    getFileToSave: function() {
        FileDialog.save(Lang.bind(this, this.saveToFile), getDefaultParams((this.file) ? this.file.get_path() : null));
    },
    
    loadFromFile: function(path) {
        if ( path == "" ) return;
        this.file = Gio.file_new_for_path(path.split("\n")[0]);
        let [a, contents, b] = this.file.load_contents(null);
        this.text.text = String(contents);
    },
    
    saveToFile: function(path) {
        if ( path == "" ) return;
        this.file = Gio.file_new_for_path(path.split("\n")[0]);
        if ( !this.file.query_exists(null) ) this.file.create(Gio.FileCreateFlags.NONE, null);
        let text = this.text.text;
        this.file.replace_contents(text, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    }
}


function SandboxInterface(settings) {
    this._init(settings);
}

SandboxInterface.prototype = {
    __proto__: TabPanel.TabPanelBase.prototype,
    
    name: _("Sandbox"),
    
    _init: function(settings) {
        try {
            this.settings = settings;
            
            TabPanel.TabPanelBase.prototype._init.call(this, true);
            
            let topRow = new St.BoxLayout();
            this.panel.add_actor(topRow);
            let tabs = new Tab.TabBoxBase({ styleClass: "devtools-sandbox-tabs" });
            topRow.add(tabs.actor, { expand: true });
            let tabPanels = new St.BoxLayout({ style_class: "devtools-sandbox-tabPanels" });
            this.panel.add_actor(tabPanels);
            this.tabManager = new Tab.TabManager(tabs, tabPanels);
            
            let evaluateButton = new St.Button({ label: _("Evaluate"), style_class: "devtools-contentButton" });
            topRow.add_actor(evaluateButton);
            evaluateButton.connect("clicked", Lang.bind(this, this.evaluate));
            
            /*javascript*/
            this.jsTab = new TextEditor(_("Javascript"));
            this.tabManager.add(this.jsTab);
            
            /*style*/
            this.cssTab = new TextEditor(_("Style"));
            this.tabManager.add(this.cssTab);
            let loadCurrentButton = new St.Button({ style_class: "devtools-sandbox-button" });
            this.cssTab.buttonBox.add_actor(loadCurrentButton);
            loadCurrentButton.add_actor(new St.Icon({ icon_name: "document-open", icon_size: 24, icon_type: St.IconType.FULLCOLOR }));
            loadCurrentButton.connect("clicked", Lang.bind(this, this.loadCurentStylesheet));
            new Tooltips.Tooltip(loadCurrentButton, _("Load current stylesheet"));
            
            this.tabManager.selectIndex(0);
            
            //sandbox preview
            this.previewer = new St.Bin({ x_expand: true, y_expand: true, x_fill: true, y_fill: true, style_class: "devtools-sandbox-previewer" });
            this.panel.add(this.previewer, { expand: true });
        } catch(e) {
            global.logError(e);
        }
    },
    
    evaluate: function() {
        this.previewer.destroy_all_children();
        
        let header = this.settings.getValue("sandboxHeader");
        let jsText = header + "\n" + this.jsTab.getText();
        let actor;
        try {
            let sandboxCode = new Function(jsText);
            let result = sandboxCode();
            
            if ( result && result instanceof Clutter.Actor ) actor = result;
            else {
                if ( !result ) result = _("No errors detected");
                actor = new Text.Label({ text: result }).actor;
            }
            
            this.previewer.add_actor(actor);
            
            let cssText = this.cssTab.getText();
            if ( cssText != "" ) {
                try {
                    let cssTemp = Gio.file_new_for_path(".temp.css");
                    
                    let fstream = cssTemp.replace(null, false, Gio.FileCreateFlags.NONE, null);
                    let dstream = new Gio.DataOutputStream({ base_stream: fstream });
                    
                    dstream.put_string(cssText, null);
                    fstream.close(null);
                    
                    let sanboxTheme = new St.Theme();
                    sanboxTheme.load_stylesheet(cssTemp.get_path());
                    actor.set_theme(sanboxTheme);
                    
                } catch(e) {
                    throw e;
                }
            }
        } catch(e) {
            this.previewer.add_actor(new Text.Label({ text: String(e) }).actor);
        }
    },
    
    loadCurentStylesheet: function() {
        let styleSheet = Main.getThemeStylesheet();
        this.cssTab.loadFromFile(styleSheet);
    }
}
