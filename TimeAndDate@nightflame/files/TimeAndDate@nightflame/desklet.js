
// Time And Date Cinnamon Desklet v0.1 - 19 June 2013
//
// This is a simple desklet to display the time and date. The size and format of the date are configurable by changing the values in metadata.json. 
// This can be launched from the Desklet itself by selecting Config from the menu.
// 
// I'm sharing it in case it useful to anyone else especially as there do not seem to be many Cinammon Desklets yet. 
//
// -Steve
// desklets [at] stargw [dot] eu

// This ^^^ is a bit old :) - 5 November 2025

const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Pango = imports.gi.Pango;

const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;
const Gettext = imports.gettext;

const UUID = "TimeAndDate@nightflame";
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

	_init: function(metadata, desklet_id){
		Desklet.Desklet.prototype._init.call(this, metadata);
		
        this.desklet_id = desklet_id;
        this.DESKLET_ROOT = DESKLET_ROOT;

        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);

        this.settings.bindProperty(Settings.BindingDirection.IN, "time-format", "timeFormat", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "date-format", "dateFormat", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-period", "refreshPeriod", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "is-order-reversed", "isOrderReversed", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "is-two-column", "isTwoColumns", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "is-width-forced", "isWidthForced", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "forced-width-size", "forcedWidthSize", this.on_setting_changed);

		this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-background", "deskletBackground", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-border-radius", "deskletBorderRadius", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-border-width", "deskletBorderWidth", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-border-color", "deskletBorderColor", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "padding-scale", "paddingScale", this.on_setting_changed);

        this.settings.bindProperty(Settings.BindingDirection.IN, "time-font", "timeFontRaw", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time-font-bold", "timeFontBold", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time-font-italic", "timeFontItalic", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time-text-color", "timeTextColor", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time-text-shadow", "timeTextShadow", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "time-text-shadow-color", "timeTextShadowColor", this.on_setting_changed);
	
        this.settings.bindProperty(Settings.BindingDirection.IN, "date-font", "dateFontRaw", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "date-font-bold", "dateFontBold", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "date-font-italic", "dateFontItalic", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "date-text-color", "dateTextColor", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "date-text-shadow", "dateTextShadow", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "date-text-shadow-color", "dateTextShadowColor", this.on_setting_changed);

        this.settings.bindProperty(Settings.BindingDirection.IN, "show-decorations", "showDecorations", this.on_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-header", "deskletHeader", this.on_setting_changed);

		this.timeout = null;

		this.runDesklet();

	},

    /**
    * Starts desklet
    */
    runDesklet: function() {
		this.timeFont = this.parseFont(this.timeFontRaw);
		this.dateFont = this.parseFont(this.dateFontRaw);

		this.renderGUI();
		
		this.renderDecorations();
		
		this._updateDate();
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
        
        let container = new St.Group({style_class: "clock-container"}); 
        this.root_el.add_child(container);

        container.style = (this.showDecorations ? "margin: 0em;" : "margin: 0.5em;")
						+ "background-color:" + this.deskletBackground + ";"
						+ "border-radius: " + this.deskletBorderRadius + "px;"
                        + "border: solid " + this.deskletBorderWidth + "px " + this.deskletBorderColor + ";"
						+ "padding: "+ Math.round(4*(this.paddingScale)) + "px " + Math.round(10*(this.paddingScale+1)) + "px;";


        if (this.isWidthForced) {
            container.set_width(this.forcedWidthSize);
        }
    
        let grid = new Clutter.GridLayout(); 
        grid.set_row_spacing(Math.round(1*this.paddingScale));
		grid.set_column_spacing(Math.round(8*this.paddingScale));
        container.set_layout_manager(grid);


		this.timeLabel = new St.Label({ style_class: 'time-label' });
		this.dateLabel = new St.Label({ style_class: 'date-label' });

		
        this.timeLabel.style = "font-family: '" + this.timeFont["family"] + "';"
                            + "font-size: " + this.timeFont["size"] + "pt;"
                            + "color:" + this.timeTextColor + ";"
                            + "font-weight:" + (this.timeFontBold ? "bold" : "normal") + ";"
                            + "font-style:" + (this.timeFontItalic ? "italic" : "normal") + ";"
                            + "text-shadow:" + (this.timeTextShadow ? "2px 2px 4px " + this.timeTextShadowColor : "none") + ";";


        this.dateLabel.style = "font-family: '" + this.dateFont["family"] + "';"
                            + "font-size: " + this.dateFont["size"] + "pt;"
                            + "color:" + this.dateTextColor + ";"
                            + "font-weight:" + (this.dateFontBold ? "bold" : "normal") + ";"
                            + "font-style:" + (this.dateFontItalic ? "italic" : "normal") + ";"
                            + "text-shadow:" + (this.dateTextShadow ? "2px 2px 4px " + this.dateTextShadowColor : "none") + ";";							



		let timeLabelContainer =  new St.BoxLayout({vertical:!this.isTwoColumns, style_class: 'date-container'});
		let dateLabelContainer =  new St.BoxLayout({vertical:!this.isTwoColumns, style_class: 'time-container'});
		timeLabelContainer.add(this.timeLabel, {x_fill: false, y_fill: false, x_align: St.Align.MIDDLE, y_align: St.Align.MIDDLE});
		dateLabelContainer.add(this.dateLabel, {x_fill: false, y_fill: false, x_align: St.Align.MIDDLE, y_align: St.Align.MIDDLE});

		let timeLabelGridOrder = 0 + this.isOrderReversed; 
		let dateLabelGridOrder = (1 + this.isOrderReversed) % 2;

        // Display time only if format is specified
        if (this.timeFormat.length > 0) {
            if (this.isTwoColumns) {
                grid.attach(timeLabelContainer, timeLabelGridOrder, 0, 1, 1);
            } else {	
                grid.attach(timeLabelContainer, 0, timeLabelGridOrder, 1, 1);
            }            
        }

        // Display date only if format is specified
        if (this.dateFormat.length > 0) {
            if (this.isTwoColumns) {
                grid.attach(dateLabelContainer, dateLabelGridOrder, 0, 1, 1);
            } else {	
                grid.attach(dateLabelContainer, 0, dateLabelGridOrder, 1, 1);
            }            
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

	on_desklet_removed: function() {
		if (this.timeout !== null) {
			GLib.source_remove(this.timeout);
		}
	},

    /**
    * This function should be used as a callback when settings change
    */
    on_setting_changed: function() {
		this.on_desklet_removed();
		this.runDesklet();
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


	_updateDate: function(){

		let displayDate = new Date();
        
        // Update only if format is specified
        if (this.timeFormat.length > 0) {
		    this.timeLabel.set_text(displayDate.toLocaleFormat(this.timeFormat));
        }

        if (this.dateFormat.length > 0) {
		    this.dateLabel.set_text(displayDate.toLocaleFormat(this.dateFormat));
        }
		

		this.timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.refreshPeriod, () => { this._updateDate() });
		
	}
}


