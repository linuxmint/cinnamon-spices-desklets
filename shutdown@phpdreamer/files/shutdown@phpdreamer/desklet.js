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


const UUID = "shutdown@phpdreamer";
const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID].path;


Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale")

function _(str) {
  return Gettext.dgettext(UUID, str);
}

function ShutdownDesklet(metadata, desklet_id) {
    // translation init: if installed in user context, switch to translations in user's home dir
    if(!DESKLET_ROOT.startsWith("/usr/share/")) {
        Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");
    }
    this._init(metadata, desklet_id);
}

ShutdownDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata);

        this.desklet_id = desklet_id;
        this.DESKLET_ROOT = DESKLET_ROOT;

        // Import settings to app
        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);

        this.settings.bindProperty(Settings.BindingDirection.IN, "shutdown-command", "shutdownCommand", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "label-text", "labelText", this.on_setting_changed);

		this.settings.bindProperty(Settings.BindingDirection.IN, "click-type", "clickType", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "click-timeout", "clickTimeout", this.on_setting_changed);

        this.settings.bindProperty(Settings.BindingDirection.IN, "is-desklet-bg-transparent", "isdeskletTransparentBg", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-background", "deskletBackground", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-border-width", "deskletBorderWidth", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-border-color", "deskletBorderColor", this.on_setting_changed);

        this.settings.bindProperty(Settings.BindingDirection.IN, "button-icon-type", "buttonIconType", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "button-icon-size", "buttonIconSize", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "button-icon-name", "buttonIconName", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "button-icon-color", "buttonIconColor", this.on_setting_changed);

        this.settings.bindProperty(Settings.BindingDirection.IN, "font", "fontRaw", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "font-bold", "fontBold", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "font-italic", "fontItalic", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "textColor", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "text-shadow", "textShadow", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "text-shadow-color", "textShadowColor", this.on_setting_changed);

        this.settings.bindProperty(Settings.BindingDirection.IN, "show-decorations", "showDecorations", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-header", "deskletHeader", this.on_setting_changed);

        this.runDesklet();
    },


    /**
    * Starts desklet
    */
    runDesklet: function() {

        this.lastClickedTimestamp = Date.now();
        this.font = this.parseFont(this.fontRaw);

        this.renderGUI();

        // Render system desklet decorations
        this.renderDecorations();
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

        container.style = (this.showDecorations ? "margin: 0.5em;" : "margin: 1.75em;");


        let button = new St.Button({style_class: "button"});

        container.add_child(button);

        button.style = "font-family: '" + this.font["family"] + "';"
                        + "font-size: " + this.font["size"] + "px;"
                        + "color:" + this.textColor + ";"
                        + "font-weight:" + (this.fontBold ? "bold" : "normal") + ";"
                        + "font-style:" + (this.fontItalic ? "italic" : "normal") + ";"
                        + "text-shadow:" + (this.textShadow ? "1px 1px 6px " + this.textShadowColor : "none") + ";"
                        + "background-color:" + (this.isdeskletTransparentBg ? "unset" : this.deskletBackground) + ";"
                        + "border: solid " + this.deskletBorderWidth + "px " + this.deskletBorderColor + ";";
        

        button.connect("clicked", Lang.bind(this, () => {
            const is_dblclick = (Date.now() - this.lastClickedTimestamp)  < this.clickTimeout

            // Run command if this click is a doubleclick or single clicks are set
            if (is_dblclick || this.clickType === "single") {
                Util.spawnCommandLine(this.shutdownCommand);
                
                // I suggest using .notify() to see if its working instead of shutting down your computer during debugging :)
                // Main.notifyError(this.shutdownCommand);

                this.lastClickedTimestamp = 0;
            } else {
                this.lastClickedTimestamp = Date.now();
            }
        }));

        let label = null;
        if (this.labelText.length) {
            label = new St.Label({style_class: "label", text: this.labelText});
        }
        
        let icon = new St.Icon({style_class:"icon"});

        if (this.buttonIconType === "original-icon") {
            icon.style = 'background-image: url("' + this.DESKLET_ROOT + '/icon.png");'
                        + "background-position: center; width:"+ this.buttonIconSize +"px; height:"+ this.buttonIconSize +"px; display:block;"
                        + "background-size: " + this.buttonIconSize + "px " + this.buttonIconSize +"px;";
        } else if (this.buttonIconType === "custom-icon") {
            icon.set_icon_name(this.buttonIconName);
            icon.set_icon_type(St.IconType.APPLICATION);
            icon.set_icon_size(this.buttonIconSize);
            icon.style = "color:" + this.buttonIconColor + ";";
        }
        

        let btn_content_container = new St.Group({style_class:"btn-content-container"});
        button.set_child(btn_content_container)

        let grid = new Clutter.GridLayout(); 
        grid.set_row_spacing(0);
        grid.set_column_homogeneous(true);
        btn_content_container.set_layout_manager(grid);

        grid.attach(icon, 0, 0, 1, 1);
        if (label !== null) {
            grid.attach(label, 0, 1, 1, 1);
        }

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
    * This function should be used as a callback when settings change
    */
    on_setting_changed: function() {
        this.font = this.parseFont(this.fontRaw);
        this.renderGUI();
        this.renderDecorations();
    },
}

function main(metadata, desklet_id) {
    let desklet = new ShutdownDesklet(metadata, desklet_id);
    return desklet;
}
