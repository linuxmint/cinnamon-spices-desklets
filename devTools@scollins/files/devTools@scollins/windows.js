const Main = imports.ui.main;
const Cinnamon = imports.gi.Cinnamon;
const St = imports.gi.St;
const Gettext = imports.gettext;
const Lang = imports.lang;

const uuid = "devTools@scollins";
let TabPanel;
if (typeof require !== 'undefined') {
    TabPanel = require('./tabPanel');
} else {
    const DeskletDir = imports.ui.deskletManager.desklets[uuid];
    TabPanel = DeskletDir.tabPanel;
}


let controller;

function _(str) {
    return Gettext.dgettext(uuid, str);
}

function getWorkspaceForWindow(window) {
    if ( window.is_on_all_workspaces() ) return [null,_("all"),null];

    for ( let id = 0; id < global.screen.n_workspaces; id++ ) {
        let name = Main.getWorkspaceName(id);
        let meta = global.screen.get_workspace_by_index(id);
        if ( meta.list_windows().indexOf(window) != -1 ) {
            return [meta,name,id];
        }
    }

    return [null,"none",null];
}


function WindowItem(window) {
    this._init(window);
}

WindowItem.prototype = {
    _init: function(window) {
        try {

            this.window = window;
            this.app = Cinnamon.WindowTracker.get_default().get_window_app(this.window);
            let [wsMeta,wsName,wsId] = getWorkspaceForWindow(window);
            this.workspace = wsMeta;

            this.window.connect("unmanaged", Lang.bind(this, this.destroy));

            this.actor = new St.BoxLayout({ style_class: "devtools-windows-windowBox" });

            /*icon*/
            let iconBin = new St.Bin({ style_class: "devtools-windows-icon" });
            this.actor.add_actor(iconBin);
            let icon = this.getIcon();
            iconBin.set_child(icon);

            /*info*/
            let infoBin = new St.Bin({ x_align: St.Align.START, x_expand: true, x_fill: true });
            this.actor.add(infoBin, { expand: true });
            let infoBox = new St.BoxLayout({ vertical: true });
            infoBin.set_child(infoBox);
            let table = new St.Table({ homogeneous: false, clip_to_allocation: true });
            infoBox.add(table, { y_align: St.Align.MIDDLE, y_expand: false });

            //window title
            table.add(new St.Label({ text: _("Title") + ":   " }), { row: 0, col: 0, col_span: 1,  x_expand: false, x_align: St.Align.START });
            let title = new St.Label({ text: window.title, style_class: "devtools-windows-title" });
            table.add(title, { row: 0, col: 1, col_span: 1, x_expand: false, x_align: St.Align.START });

            //window class
            table.add(new St.Label({ text: _("Class") + ":   " }), { row: 1, col: 0, col_span: 1, x_expand: false, x_align: St.Align.START });
            let wmClass = new St.Label({ text: window.get_wm_class() });
            table.add(wmClass, { row: 1, col: 1, col_span: 1, y_expand: true, x_expand: false, x_align: St.Align.START });

            //workspace
            table.add(new St.Label({ text: _("Workspace") + ":   " }), { row: 2, col: 0, col_span: 1, x_expand: false, x_align: St.Align.START });
            let workspace = new St.Label({ text: wsName });
            table.add(workspace, { row: 2, col: 1, col_span: 1, x_expand: false, x_align: St.Align.START });

            /*window options*/
            let buttonBox = new St.BoxLayout({ vertical: false, style_class: "devtools-windows-buttonBox" });
            infoBox.add_actor(buttonBox);

            //inspect window
            let inspectButton = new St.Button({ label: _("Inspect"), x_align: St.Align.END, style_class: "devtools-contentButton" });
            buttonBox.add_actor(inspectButton);
            inspectButton.connect("clicked", Lang.bind(this, this.inspect));

            //switch to
            if ( this.workspace ) {
                let switchToButton = new St.Button({ label: _("Switch to"), x_align: St.Align.END, style_class: "devtools-contentButton" });
                buttonBox.add_actor(switchToButton);
                switchToButton.connect("clicked", Lang.bind(this, this.switchTo));
            }

            //close
            let closeButton = new St.Button({ label: _("Close"), x_align: St.Align.END, style_class: "devtools-contentButton" });
            buttonBox.add_actor(closeButton);
            closeButton.connect("clicked", Lang.bind(this, this.close));

        } catch(e) {
            global.logError(e);
        }
    },

    destroy: function() {
        this.actor.destroy();
    },

    getIcon: function() {
        if ( this.window.title == "Desktop" ) return new St.Icon({ icon_name: "desktop", icon_size: 48, icon_type: St.IconType.FULLCOLOR });
        if ( this.app != null ) return this.app.create_icon_texture(48);
        else return new St.Icon({ icon_name: "application-default-icon", icon_size: 48, icon_type: St.IconType.FULLCOLOR });
    },

    inspect: function() {
        controller.inspect(this.window);
    },

    switchTo: function() {
        if ( !this.workspace ) return;
        if ( this.workspace != _("all") ) this.workspace.activate(global.get_current_time());
        this.window.unminimize(global.get_current_time());
        this.window.activate(global.get_current_time());
    },

    close: function() {
        this.window.delete(global.get_current_time());
    }
}


function WindowInterface(controllerObj) {
    this._init(controllerObj);
}

WindowInterface.prototype = {
    __proto__: TabPanel.TabPanelBase.prototype,

    name: _("Windows"),

    _init: function(controllerObj) {
        controller = controllerObj;

        TabPanel.TabPanelBase.prototype._init.call(this);

        this.windowObjects = [];
        let tracker = Cinnamon.WindowTracker.get_default();

        global.display.connect("window-created", Lang.bind(this, this.refresh));
        tracker.connect("tracked-windows-changed", Lang.bind(this, this.refresh));

        let scrollBox = new St.ScrollView();
        this.panel.add_actor(scrollBox);

        this.windowsBox = new St.BoxLayout({ vertical: true, style_class: "devtools-windows-mainBox" });
        scrollBox.add_actor(this.windowsBox);

    },

    refresh: function() {
        if ( !this.selected ) return;

        for ( let i = 0; i < this.windowObjects.length; i++ ) {
            this.windowObjects[i].destroy();
        }
        this.windowsBox.destroy_all_children();
        this.windowObjects = [];

        let windows = global.get_window_actors();

        for ( let i = 0; i < windows.length; i++ ) {
            let window = windows[i].metaWindow;

            let windowBox = new WindowItem(window);
            this.windowsBox.add_actor(windowBox.actor);
            this.windowObjects.push(windowBox);
        }
    },

    onSelected: function() {
        this.refresh();
    }
}
