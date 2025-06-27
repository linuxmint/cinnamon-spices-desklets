const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Cinnamon = imports.gi.Cinnamon;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Settings = imports.ui.settings;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Gettext = imports.gettext;
const Tooltips = imports.ui.tooltips;
const PopupMenu = imports.ui.popupMenu;


const UUID = "todo@NotSirius-A";
const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID].path;

// translation support
function _(str) {
    return Gettext.dgettext(UUID, str);
}

// Import other files
let MyToolBar, TODOList, TODOItem;
if (typeof require !== 'undefined') {
    MyToolBar = require('./MyToolBar');
    TODOList = require('./TODOList');
    TODOItem = require('./TODOItem');
} else {
    MyToolBar = DESKLET_ROOT.MyToolBar;
    TODOList = DESKLET_ROOT.TODOList;
    TODOItem = DESKLET_ROOT.TODOItem;
}


function MyDesklet(metadata, desklet_id) {
    // translation init: if installed in user context, switch to translations in user's home dir
    if(!DESKLET_ROOT.startsWith("/usr/share/")) {
        Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");
    }
    this._init(metadata, desklet_id);
}

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}


MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata);

        this.desklet_id = desklet_id;

        // Import settings to app
        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);

        this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "column-number", "numOfColumns", this.on_setting_changed);
        
        this.settings.bindProperty(Settings.BindingDirection.IN, "is-task-bg-transparent", "isTaskTransparentBg", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "task-background", "taskBackground", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "task-icon-size", "taskIconSize", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "task-not-marked-icon", "taskNotMarkedDoneIcon", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "task-marked-icon", "taskMarkedDoneIcon", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "font", "fontRaw", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "font-bold", "fontBold", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "font-italic", "fontItalic", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "customTextColor", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "text-shadow", "textShadow", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "text-shadow-color", "textShadowColor", this.on_setting_changed);

        this.settings.bindProperty(Settings.BindingDirection.IN, "is-toolbar-enabled", "isToolbarEnabled", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "is-sort-enabled", "isSortEnabled", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "is-sort-reversed", "isSortReversed", this.on_setting_changed);

        this.settings.bindProperty(Settings.BindingDirection.IN, "toolbar-background", "toolbarBackground", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "toolbar-icon-size", "toolbarIconSize", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "toolbar-font-color", "toolbarFontColor", this.on_setting_changed);

        this.settings.bindProperty(Settings.BindingDirection.IN, "show-decorations", "showDecorations", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-header", "deskletHeader", this.on_setting_changed);

        this.runDesklet();
    },


    /**
    * Starts desklet
    */
    runDesklet: function() {

        this.loadTheme();
        
        this.loadTODOlist();

        this.renderGUI();

        // Render system desklet decorations
        this.renderDecorations();

        this.populateContextMenu();
    },

    /**
    * Load visual theme from settings
    */
    loadTheme: function() {
        this.font = this.parseFont(this.fontRaw);

        const default_item_width = 150;
        this.scale = this.scaleSize * global.ui_scale;

        this.theme = {
            "scale": this.scale,
            "toolbar" : {
                "background_color": this.toolbarBackground,
                "font_color": this.toolbarFontColor,
                "icon_size": this.toolbarIconSize,
            },
            "TODOlist": {
                "num_of_columns": this.numOfColumns,
                "item_width": default_item_width * this.scale,
                "font_family": this.font["family"],
                "font_size": this.font["size"],
                "font_color": this.customTextColor,
                "font_bold": this.fontBold,
                "font_italic": this.fontItalic,
                "text_align": this.textAlign,
                "text_shadow_enabled": this.textShadow,
                "text_shadow_color": this.textShadowColor,
                "is_transparent_bg": this.isTaskTransparentBg,
                "background_color": this.taskBackground,
                "icon_size": this.taskIconSize,
                "unmarked_opacity": 255,
                "marked_opacity": 160,
                "not_marked_icon_name": this.taskNotMarkedDoneIcon,
                "marked_icon_name": this.taskMarkedDoneIcon,
            }
        };

    },


    /**
    * Initialize TODO list and load items from settings
    */
    loadTODOlist: function() {
        this.TODOlist = new TODOList.TODOList(this, this.isToolbarEnabled, this.isSortEnabled, this.isSortReversed);
        this.TODOlist.loadItemsFromSettings();
    },

    /**
    * Renders entire GUI except for decorations
    */
    renderGUI: function() {

        // Destroy root_el and its children to avoid creating multiple copies and orphaned elements.
        if (this.root_el !== null && this.root_el !== undefined) {
            this.root_el.destroy_all_children();
            this.root_el.destroy();
        }

        this.root_el = new Clutter.Actor();
        this.setContent(this.root_el); 

        
        let container = new St.Group({style_class: "container"}); 
        this.root_el.add_child(container);

        let root_grid = new Clutter.GridLayout(); 
        root_grid.set_row_spacing(4 * this.scale);
        container.set_layout_manager(root_grid);


        if (this.isToolbarEnabled) {
            let toolbar_container = new St.Group({style_class: "toolbar-container"}); 
            root_grid.attach(toolbar_container, 0, 0, 1, 1);
        
            this.toolbar = new MyToolBar.MyToolBar(this, toolbar_container);
            this.toolbar.render(false);
        }

        this.TODOlist_container = new St.Group({style_class: "todo-container"}); 
        root_grid.attach(this.TODOlist_container, 0, 1, 1, 1);

        this.TODOlist.setParentContainer(this.TODOlist_container);
        this.TODOlist.render(false);
        
        // Main.notifyError("renderGUI done", " "); // debug
    },


    /**
    * Parse raw font string, TODO improve parsing, detect bold/italic etc.
    * @param {string} font_string - Font descriptor
    * @returns {{"family": string, "size": Number}} Font descriptor object
    */
    parseFont: function(font_string) {
        // String are passed by reference here so
        // make sure to copy the string to avoid triggering settings callback on change
        const font_string_copy = font_string.slice().trim();

        const font_split = font_string_copy.split(" ");

        const font_size = parseInt(font_split.pop());
        let font_family = font_split.join(" ");

        return {
            "family": font_family,
            "size": font_size
        };
    },



    /**
    * Render desklet decorations
    */
    renderDecorations: function() {

        this.setHeader(this.deskletHeader);

        this.metadata["prevent-decorations"] = !this.showDecorations;
        this._updateDecoration();
    },

    /**
    * Add options to context menu
    */
	populateContextMenu: function() {
		let menuItem = new PopupMenu.PopupMenuItem(_("Add new task"));
		this._menu.addMenuItem(menuItem);
		menuItem.connect("activate", Lang.bind(this, Lang.bind(this, () => {
            this.TODOlist.addItem(_("TODO"));
            this.TODOlist.render();
        })));
	},

    /**
    * This function should be used as a callback when settings change
    */
    on_setting_changed: function() {
        this.loadTheme();
        this.loadTODOlist();
        this.renderGUI();
        this.renderDecorations();
    },


    /**
    * This function should be used as a callback user clicks a button in the settings
    */
    on_update_button_callback: function() {
        this.loadTODOlist();
        this.renderGUI();
    }


}