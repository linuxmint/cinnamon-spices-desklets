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
		this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hideDecorations", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "use-custom-label", "useCustomLabel", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "custom-label", "customLabel", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-layout", "deskletLayout", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-align", "textAlign", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "column-number", "numOfColumns", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "transparent-bg", "isTransparentBg", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "bg-color", "customBgColor", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "icon-size", "iconSize", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "font", "fontRaw", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "font-bold", "fontBold", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "font-italic", "fontItalic", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "font-enabled", "fontEnabled", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "customTextColor", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-shadow", "textShadow", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-shadow-color", "textShadowColor", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "links-list", "linksList", ()=>{});

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

		// MAKE SURE to create a deepcopy of linkList, otherwise you could modify actual desklet settings using this variable
		let links_list_deepcopy = JSON.parse(JSON.stringify(this.linksList));
		this.links = this.getLinks(links_list_deepcopy);
		
		this.font = this.parseFont(this.fontRaw);
		// Render desklet gui
		this.renderGUI();

		// Render system desklet decorations
		this.renderDecorations();
	},

	/**
	* Parse raw font string, TODO improve parsing, detect bold/italic etc.
	* @param {string} fontString - Font descriptor
	* @returns {{"family": string, "size": Number}} Font descriptor object
	*/
	parseFont: function(fontString) {
		fontString = fontString.trim();
		const font_split = fontString.split(" ");

		const font_size = parseInt(font_split.pop());
		let font_family = font_split.join(" ");

		return {
			"family": font_family,
			"size": font_size
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
				"name": "No visible\nlinks found.\nConfigure links\nin the settings.\nRight click\non desklet\nthen configure.",
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
		const default_link_width = 95;
		const default_row_spacing = 5;
		const default_column_spacing = 5;

		// Calculate new sizes based on scale and layout
		// Multipliers are based on experimentation with what looks good 
		const width_scale = (this.deskletLayout === "tile")? 0.7 : 1
		this.scale = this.scaleSize * global.ui_scale * width_scale;
		this.link_width = default_link_width * this.scale;

		const spacing_scale = (this.deskletLayout === "tile")? 2 : 1;
		const link_row_spacing = default_row_spacing * this.scale * spacing_scale;
		const link_column_spacing = default_column_spacing * this.scale * spacing_scale;

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
	*/
	renderLinkElement: function(index, parent_grid) {
		const link_data = this.links[index];
		// Main.notifyError("Rendering link: " + link_data["name"], " "); // debug

		// Link has to be a button so that it can be clickable
		let link_el = new St.Button({style_class:"link"});
		link_el.set_width(Math.round(this.link_width));


		link_el.style = "font-family: '" + this.font["family"] + "';"
							+ "font-size: " + this.font["size"] + "px;"
							+ "color:" + this.customTextColor + ";"
							+ "font-weight:" + (this.fontBold ? "bold" : "normal") + ";"
							+ "font-style:" + (this.fontItalic ? "italic" : "normal") + ";"
							+ "text-shadow:" + (this.textShadow ? "1px 1px 6px "+this.textShadowColor : "none") + ";"
							+ "background-color:" + (this.isTransparentBg ? "unset" : this.customBgColor) + ";"
							+ "text-align:" + this.textAlign + ";";


		const row = index%this.numOfColumns;
		const column = Math.floor(index/this.numOfColumns);
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
				label_width = Math.round(this.link_width - this.iconSize*2.3 - this.font["size"] * 1.5)
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
		
				
		// Attach command when link clicked, open shell if user set shell=true 
		let command_line = link_data["command"];
		let shell = link_data["shell"];

		if (command_line.length > 0) {
			link_el.connect("clicked", Lang.bind(this, function() {
				this.runCommandOnClick(command_line, shell)
			}));
		}
		
		// Add command to tooltip - display command when hovering over link element
		new Tooltips.Tooltip(link_el, command_line);
	},

	/**
	* This function should be executed when user clicks a link
	* @param {string} command_line - Bash command to be executed
	* @param {boolean} shell - if true execute command in a gnome-terminal shell, otherwise execute in background
	*/
	runCommandOnClick: function(command_line, shell = true) {
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
	* Render desklet decorations
	*/
	renderDecorations: function() {
		if(this.useCustomLabel == true) {
			this.setHeader(this.customLabel);
		}
		else {
			this.setHeader(_("Quick Links"));
		}
		// prevent decorations?
		this.metadata["prevent-decorations"] = this.hideDecorations;
		this._updateDecoration();
	},

	/**
	* This function should be used as a callback when settings change
	*/
	on_setting_changed: function() {
		this.runDesklet();
	},


	/**
	* This function should be used as a callback user clicks a button in the settings
	*/
	on_reset_links_callback: function() {
		this.runDesklet();
	}

}
