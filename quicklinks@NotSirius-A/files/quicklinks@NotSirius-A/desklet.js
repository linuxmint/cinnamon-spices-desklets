const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Cinnamon = imports.gi.Cinnamon;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Settings = imports.ui.settings;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Gettext = imports.gettext;
const Pango = imports.gi.Pango;
const Tooltips = imports.ui.tooltips;
const PopupMenu = imports.ui.popupMenu;

const UUID = "quicklinks@NotSirius-A";
const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID].path;

// translation support
function _(str) {
	return Gettext.dgettext(UUID, str);
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
		this.settings.bindProperty(Settings.BindingDirection.IN, "show-decorations", "showDecorations", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-header", "deskletHeader", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-layout", "deskletLayout", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-align", "textAlign", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "column-number", "numOfColumns", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "row-spacing", "rowSpacing", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "column-spacing", "columnSpacing", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "transparent-bg", "isTransparentBg", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "bg-color", "customBgColor", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "link-border-width", "linkBorderWidth", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "link-border-color", "linkBorderColor", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "icon-size", "iconSize", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "font", "fontRaw", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "font-enabled", "fontEnabled", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "customTextColor", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-shadow", "textShadow", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-shadow-color", "textShadowColor", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "links-list", "linksList", ()=>{});
		this.settings.bindProperty(Settings.BindingDirection.IN, "click-type", "clickType", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "click-timeout", "clickTimeout", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "are-tooltips-enabled", "areTooltipsEnabled", this.on_setting_changed);

		// List settings type seems to be a bit buggy
		// Using a callback on list type settings seems to trigger multiple refreshes when changing ANY settings 
		//   even when bound variable is not used anywhere here
		// Its probably safer to create a refresh button that using a callback on lists

		this.runDesklet();
	},


	/**
	* Starts desklet, imports links, renders UI 
	*/
	runDesklet: function() {
		this.initializeData();

		// Render desklet gui
		this.renderGUI();

		this.populateContextMenu();

		// Render system desklet decorations
		this.renderDecorations();
	},

	initializeData: function() {
		this.lastClick = {
			"link_index": null,
			"time": Infinity,
		};

		// MAKE SURE to create a deepcopy of linkList, otherwise you could modify actual desklet settings using this variable
		this.links_list_deepcopy = JSON.parse(JSON.stringify(this.linksList));
		this.links = this.getLinks(this.links_list_deepcopy);
		
		this.font = this.parseFontStringToCSS(this.fontRaw);
	},

    /**
    * Parse raw font string.
    * @param {string} font_string - Font descriptor string
    * @returns {{"font-family": string, "font-size": Number, "font-weight": Number, "font-style": string, "font-stretch": string}} Font descriptor object
    */
    parseFontStringToCSS: function(font_string) {
        // Some fonts don't work, so a fallback font is a good idea
        const fallback_font_str = "Ubuntu Regular 16";
    
        // String are passed by reference here
        // make sure to copy the string to avoid triggering settings callback on change
        const font_string_copy = font_string.slice().trim();
        
        let css_font;
        try {
            const my_font_description = Pango.font_description_from_string(font_string_copy);
            css_font = this._PangoFontDescriptionToCSS(my_font_description);
        } catch (e) {
            Main.notifyError(
                _("Sorry, this font is not supported, please select a different one.") 
                + _(" Font: `") + font_string_copy + _("` Error: ") 
                + e.toString()
            );

            const fallback_font_description = Pango.font_description_from_string(fallback_font_str);
            css_font = this._PangoFontDescriptionToCSS(fallback_font_description);
        } finally {
            return css_font;
        }
        
    },


    /**
    * Process Pango.FontDescription and return valid CSS values
    * @param {Pango.FontDescription} font_description - Font descriptor
    * @returns {{"font-family": string, "font-size": Number, "font-weight": Number, "font-style": string, "font-stretch": string}} Font descriptor object
    */
    _PangoFontDescriptionToCSS: function(font_description) {
        const PangoStyle_to_CSS_map = {
            [Pango.Style.NORMAL]: "normal", 
            [Pango.Style.OBLIQUE]: "oblique", 
            [Pango.Style.ITALIC]: "italic", 
        };

        // font-stretch CSS property seems to be ignored by the CSS renderer
        const PangoStretch_to_CSS_map = {
            [Pango.Stretch.ULTRA_CONDENSED]: "ultra-condensed", 
            [Pango.Stretch.EXTRA_CONDENSED]: "extra-condensed", 
            [Pango.Stretch.CONDENSED]: "condensed", 
            [Pango.Stretch.NORMAL]: "normal", 
            [Pango.Stretch.SEMI_EXPANDED]: "semi-expanded", 
            [Pango.Stretch.EXPANDED]: "expanded", 
            [Pango.Stretch.EXTRA_EXPANDED]: "extra-expanded", 
            [Pango.Stretch.ULTRA_EXPANDED]: "ultra-expanded", 
        };
        
        return {
            "font-family": font_description.get_family(),
            "font-size": Math.floor(font_description.get_size() / Pango.SCALE),
            "font-weight": font_description.get_weight(),
            "font-style": PangoStyle_to_CSS_map[font_description.get_style()],
            "font-stretch": PangoStretch_to_CSS_map[font_description.get_stretch()]
        };
    },


	/**
	* Process raw links and output links that are ready to be rendered onto the screen
	* @param {Object[]} linksRaw - List of raw links objects
	* @returns {Object[]} Array of objects representing links
	*/
	getLinks: function(linksRaw) {
		let links_parsed = [];

		// Add a placeholder link to let to user know there are no links to be displayed
		let noDisplayLinks = linksRaw.length < 1 || !linksRaw.some((el) => el["is-visible"])
		if (noDisplayLinks) {
			return [{
				"is-visible": true,
				"name": _("No visible\nlinks found.\nConfigure links\nin the settings.\nRight click\non desklet\nthen configure."),
				"icon-name": "",
				"command": "xlet-settings desklet " + UUID + " " + this.desklet_id,
				"shell": false,
			},]
		} 

		linksRaw.forEach(link => {
			// Replace escaped newlines with actual newlines to allow user to split name into multiple lines
			link["name"] = link["name"].replaceAll("\\n", "\n");

			// Add only links which are set to visible
			if (link["is-visible"]) {
				links_parsed.push(link);
			}
		})


		return links_parsed;
	},


	/**
	* Renders entire GUI except for decorations
	*/
	renderGUI: function() {
        const desktop_settings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.interface" });
        this.text_scale = desktop_settings.get_double("text-scaling-factor");

		this.font["font-size"] = this.font["font-size"] * this.text_scale;

		const default_link_width = 80;

		// Calculate new sizes based on scale and layout
		// Multipliers are based on experimentation with what looks good 
		const width_scale = (this.deskletLayout === "tile")? 0.7 : 1
		this.scale = this.scaleSize * global.ui_scale * width_scale;

		// For some reason the border is inside the element not outside like normal CSS?? So border needs to be taken into account here
		this.link_width = default_link_width * this.scale * this.text_scale + this.linkBorderWidth*2;

		const spacing_scale = (this.deskletLayout === "tile")? 2 : 1;
		const link_row_spacing = this.rowSpacing * this.scale * spacing_scale;
		const link_column_spacing = this.columnSpacing * this.scale * spacing_scale;

		// Destroy root_el and its children to avoid creating multiple copies and orphaned elements.
		if (this.root_el) {
			this.root_el.destroy_all_children();
			this.root_el.destroy();
		}

		this.root_el = new Clutter.Actor();
		this.setContent(this.root_el); 

		
		// Add layout name as a class so that it can be used in css
		let container = new St.Group({style_class: "container " + this.deskletLayout}); 
		this.root_el.add_child(container);

		container.style = (this.showDecorations ? "padding: 0.2em;" : "padding: 1em;");

		let links_grid = new Clutter.GridLayout(); 
		links_grid.set_row_spacing(Math.round(link_row_spacing));
		links_grid.set_column_spacing(Math.round(link_column_spacing));
		container.set_layout_manager(links_grid);



		// Render link elements on the grid
		for (let i = 0; i < this.links.length; ++i) {
			this.renderLinkElement(i, links_grid);
		}
		
		// Main.notifyError("renderGUI done", " "); // debug
	},

	
	/**
	* Renders a single link element on the parent grid according to its index
	* @param {number} link_index - Integer index of link element
	* @param {Clutter.GridLayout} parent_grid - Grid on which links are to be placed
	*/
	renderLinkElement: function(link_index, parent_grid) {
		const link_data = this.links[link_index];
		// Main.notifyError("Rendering link: " + link_data["name"], " "); // debug

		// Link has to be a button so that it can be clickable
		let link_el = new St.Button({style_class:"link"});
		link_el.set_width(Math.round(this.link_width));


		link_el.style = "font-family: '" + this.font["font-family"] + "';"
						+ "font-size: " + this.font["font-size"] + "px;"
						+ "color:" + this.customTextColor + ";"
						+ "font-weight:" + this.font["font-weight"] + ";"
						+ "font-style:" + this.font["font-style"] + ";"
						+ "font-stretch:" + this.font["font-stretch"] + ";"
						+ "text-shadow:" + (this.textShadow ? "2px 2px 4px "+this.textShadowColor : "none") + ";"
						+ "background-color:" + (this.isTransparentBg ? "unset" : this.customBgColor) + ";"
						+ "text-align:" + this.textAlign + ";"
						+ "border: solid " + this.linkBorderWidth + "px " + this.linkBorderColor + ";";


		const row = link_index%this.numOfColumns;
		const column = Math.floor(link_index/this.numOfColumns);
		parent_grid.attach(link_el, row, column, 1, 1);

		let link_content_container = new St.Group({style_class:"link-content-container"});
		link_el.set_child(link_content_container)

		let link_content_grid = new Clutter.GridLayout(); 
		link_content_container.set_layout_manager(link_content_grid);


		// Render icon
		if (link_data["icon-name"].length > 1 && this.iconSize > 1) {
			let link_icon = new St.Icon({ icon_name: link_data["icon-name"], icon_type: St.IconType.APPLICATION, icon_size: this.iconSize, style_class:"link-icon" });
			if (this.deskletLayout === "tile") {
				link_icon.set_width(Math.round(this.link_width * 0.95));
			}
			link_content_grid.attach(link_icon, 0, 0, 1, 1);
		}	
		

		// Render label
		if (this.fontEnabled) {

			let link_label = new St.Label({style_class:"link-label"});

			// Calculate the max width of a label based on current layout and icon size
			// Multipliers are based on experimentation
			let label_width;
			if (this.deskletLayout === "tile") {
				label_width = Math.round(this.link_width * 0.92);
			} else {
				label_width = Math.round(this.link_width - global.ui_scale * (this.iconSize*1.1 + this.font["font-size"]*1.15 + 5) - this.linkBorderWidth*1.1)
				label_width = Math.max(label_width, 0);
			}
			link_label.set_width(label_width);
		

			link_label.set_text(link_data["name"]);
			
			let label_container = new St.Group({style_class:"label-container"});
			label_container.add_child(link_label);
			
			// Layout to center the label
			let label_box = new Clutter.BoxLayout();
			label_box.set_homogeneous(true);
			label_container.set_layout_manager(label_box);


			if (this.deskletLayout === "tile") {
				link_content_grid.attach(label_container, 0, 1, 1, 1);
			} else {
				link_content_grid.attach(label_container, 1, 0, 1, 1);
			}

		}

		// Attach a callback to execute when St.Button is clicked
		link_el.connect("clicked", Lang.bind(this, function() {
			this.onLinkClick(link_index);
		}));

		if (this.areTooltipsEnabled) {
			// Add command to tooltip - display command when hovering over link element
			const command_line = link_data["command"];
			new Tooltips.Tooltip(link_el, command_line);
		}
	},

	/**
	* Execute this function when link is clicked 
	* @param {number} link_index - Integer index of link element
	*/
	onLinkClick: function(link_index) {
		const DBLCLICK_TIMEOUT = this.clickTimeout;
		// Check is this click should be considered a doubleclick based on previous click
		const is_dblclick = (this.lastClick["link_index"] === link_index) && (Date.now() - this.lastClick["time"]  < DBLCLICK_TIMEOUT);
		
		const command_line = this.links[link_index]["command"];
		const shell = this.links[link_index]["shell"];

		// Run command if this click is a doubleclick or single clicks are set
		if (is_dblclick || this.clickType === "single") {
			this.runLinkCommand(command_line, shell);

			this.lastClick = {
				"link_index": null,
				"time": Infinity
			};
		} else {
			this.lastClick = {
				"link_index": link_index,
				"time": Date.now()
			};
		}
		
	},

	/**
	* This function should be executed when link is activated
	* @param {string} command_line - Bash command to be executed
	* @param {boolean} shell - if true execute command in a gnome-terminal shell, otherwise execute in background
	*/
	runLinkCommand: function(command_line, shell = true) {
		if (command_line.length < 0) {
			return;
		}

		// Run command in gnome-terminal with bash -c if shell=true
		const shell_argv  = ['gnome-terminal', '--', 'bash', '-c'];

		let command_argv;

		if (shell) {
			command_argv = shell_argv;
			command_argv.push(command_line);
		} else {
			const [success_, argv] = GLib.shell_parse_argv(command_line);
			if (success_) {
				command_argv = argv;
			} else {
				Main.notifyError(_("Quick Links: Command parse error: ") + command_line, " ");
				return
			}
		}

		// Main.notifyError(argv.toString(), " "); // debug

		// Run the command
		const proc = Gio.Subprocess.new(
			command_argv,
			Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
		);

	},

    /**
    * Add options to context menu
    */
	populateContextMenu: function() {
		let menuItem = new PopupMenu.PopupMenuItem(_("Add new link"));
		this._menu.addMenuItem(menuItem);
		menuItem.connect("activate", Lang.bind(this, Lang.bind(this, () => {
            this.handleAddEditDialog();
        })));
	},

    handleAddEditDialog() {
        try {
            
			// Column ids here must match columns ids in the settings
			const columns = [
				{"id": "is-visible", "title": "Display", "type": "boolean", "default": true},
				{"id": "name", "title": "Name", "type": "string", "default": "Name"},
				{"id": "icon-name", "title": "Icon", "type": "icon", "default": "folder"},
				{"id": "command", "title": "Command", "type": "string", "default": "nemo /"},
				{"id": "shell", "title": "Shell", "type": "boolean", "default": true, "align": 0}
			];

			const [success_, command_argv] = GLib.shell_parse_argv(
				`python3 ${DESKLET_ROOT}/open_add_edit_dialog_gtk.py '${JSON.stringify(columns).replaceAll("'", "")}'`
			);


            const proc = Gio.Subprocess.new(
                command_argv,
                Gio.SubprocessFlags.STDOUT_PIPE
            );

            // Python script prints the output of the dialog when user accepts it, code here is retrieving this output from the stdout pipe
            proc.wait_async(null, () => {
                proc.communicate_utf8_async(null, null, (proc, result) => {
						
                    const [is_ok, dialog_output, _] = proc.communicate_utf8_finish(result);
					let dialog_json;
					try {
						dialog_json = JSON.parse(dialog_output);
					} catch(e) {
						global.logError(e);
						return;
					}
	
					// Add a new link when communication was correct and response doesn't have error:true
                    if (is_ok && (!dialog_json.error || dialog_json.error === undefined)) { 

						try {
							let new_settings_list = this.links_list_deepcopy.concat(JSON.parse(dialog_output));
							this.settings.setValue("links-list", new_settings_list);
							this.initializeData();
							this.renderGUI();
						} catch (e) {
							global.logError(e);
							return;
						}

                    }
                });
            });    
                
        } catch (e) {
            global.logError(e);
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
	* This function should be used as a callback when settings change
	*/
	on_setting_changed: function() {
		this.initializeData();
		this.renderGUI();
		this.renderDecorations();
	},


	/**
	* This function should be used as a callback user clicks a button in the settings
	*/
	on_reset_links_callback: function() {
		this.initializeData();
		this.renderGUI();
	}

}
