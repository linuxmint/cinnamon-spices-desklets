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

const UUID = "devtest-quicklinks@NotSirius-A";
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
		this.settings.bindProperty(Settings.BindingDirection.IN, "font", "font", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "font-bold", "fontBold", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "font-italic", "fontItalic", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "size-font", "sizeFont", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "customTextColor", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-shadow", "textShadow", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-shadow-color", "textShadowColor", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "links-text", "linksText", ()=>{});


		this.runDesklet();
	},


	/**
	* Starts desklet, imports links, renders UI 
	*/
	runDesklet: function() {

		try {
			this.links = this.parseLinks(this.linksText);
		}
		catch(err) {
			Main.notifyError(_("Quick Links: Error while parsing links: ") + err, " ");
			return;
		}
		
		if (this.links !== false) {
			// Render desklet gui
			this.renderGUI();

			// Render system desklet decorations
			this.renderDecorations();
		}

		

	},


	/**
	* Parses links in text format to objects, performs some validity checks
	* @param {string} a - Links in text format
	* @returns {(Object[]|bool)} Array of objects representing links or false if failed
	*/
	parseLinks: function(linksText) {
		let links_parsed = [];

		// Links are separated by not escaped newlines
		const link_lines = linksText.split("\n");

		link_lines.forEach(line => {
			line = line.trim();

			if (line.length < 2) {
				return // continue to next item if empty line
			}

			// Attrs are separated by commas
			// Match commas if not preceded by \, this allows to easily escape commas
			// Replace `\,` with actual `,`
			const attrs = line.split(/(?<!\\),/).map((el) => el.replaceAll("\\,", ","));

			if (attrs.length < 4) {
				Main.notifyError(_("Quick Links: Invalid format - not enough attributes `") + attrs.length + _("`, expected 4. On line: `") + line + "`", " ");
				return	// continue to next item
			} else if (attrs.length > 4) {
				Main.notifyError(_("Quick Links: Invalid format - too many attributes `") + attrs.length + _("`, expected 4. On line: `") + line + "`", " ");
				return	// continue to next item 				
			}


			// Main.notifyError(attrs.toString(), " "); // debug

			// Replace escaped newlines with actual newlines
			attrs[0] = attrs[0].replaceAll("\\n", "\n");

			const parsed = {
				"name": attrs[0],
				"icon": attrs[1],
				"cmd": attrs[2],
				"shell": (attrs[3].toLowerCase() === 'true'),
			};
			links_parsed.push(parsed);
		});

		if (links_parsed.length < 1) {
			Main.notifyError(_("Quick Links: No links found, make sure to put each link on a new line"), " ");
			return false;
		}


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

		
		let root_el = new Clutter.Actor();
		this.setContent(root_el); 
		// Destroy all children before refreshing to make sure it doesn't render multiple versions on top of each other 
		// There were issues with cinnamon crashing when refreshing desklet without destroying children
		root_el.destroy_all_children();
		
		// Add layout name as a class so that it can be used in css
		let container = new St.Group({style_class: "container " + this.deskletLayout}); 
		root_el.add_child(container);

		let links_grid = new Clutter.GridLayout(); 
		links_grid.set_row_spacing(Math.round(link_row_spacing));
		links_grid.set_column_spacing(Math.round(link_column_spacing));
		container.set_layout_manager(links_grid);

		// Render link elements on the grid
		for (let i = 0; i < this.links.length; ++i) {
			this.renderLinkElement(i, links_grid);
		}
		
		// Main.notifyError("renderUI done", " "); // debug
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

		link_el.style = "font-family: '" + this.font + "';"
							+ "font-size: " + this.sizeFont + "px;"
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


		if (link_data["icon"].length > 1 && this.iconSize > 1) {
			let link_icon = new St.Icon({ icon_name: link_data["icon"], icon_type: St.IconType.APPLICATION, icon_size: this.iconSize, style_class:"link-icon" });
			if (this.deskletLayout === "tile") {
				link_icon.set_width(Math.round(this.link_width * 0.95));
			}
			link_content_grid.attach(link_icon, 0, 0, 1, 1);
		}	
		
		let link_label = new St.Label({style_class:"link-label"});

		// Calculate the max width of a label based on current layout and icon size
		// Multipliers are based on experimentation
		let label_width;
		if (this.deskletLayout === "tile") {
			label_width = Math.round(this.link_width * 0.92);
		} else {
			label_width = Math.round(this.link_width - this.iconSize*2.3 - this.sizeFont * 1.5)
			label_width = Math.max(label_width, 0);
		}
		link_label.set_width(label_width);

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


		link_label.set_text(link_data["name"]); 
		
				
		// Run command when link clicked, open shell if user set shell=true 
		let command_line = link_data["cmd"];
		let shell = link_data["shell"];
		link_el.connect("clicked", Lang.bind(this, function() {
			this.runCommandOnClick(command_line, shell)
		}));
		
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
