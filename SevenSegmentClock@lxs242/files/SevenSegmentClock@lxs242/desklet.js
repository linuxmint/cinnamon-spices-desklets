/*

Seven Segment Digital Clock, Version 1.0 by lxs242
License: GNU General Public License version 3 or later
https://www.gnu.org/licenses/gpl-3.0.html


Contained within this file are documents based on similar licenses:

Description			"DSEG": Original 7-segment fonts
Author				Keshikan
Source				https://www.keshikan.net/fonts-e.html
License				SIL Open Font License 1.1
License URI			http://scripts.sil.org/OFL

Description			Simple seven segment display
Author				OpenClipart
Author URI		 	https://freesvg.org/by/OpenClipart
Source				https://freesvg.org/seven-on-display
License				Public Domain
License URI			https://creativecommons.org/licenses/publicdomain/

Description			A simple seven segment display
Author				alex8664
Source				https://openclipart.org/detail/168839/seven-segment-display-gray-8-by-alex8664
License				Public Domain
License URI			http://creativecommons.org/publicdomain/zero/1.0/

Description			seven segment display - digit 8 (red) Created by 3247 using 7segment.pl
Author				Cfaerber
Author URI			https://commons.wikimedia.org/wiki/User:3247
Source				https://en.wikipedia.org/wiki/File:Seven_segment_display_8_digit_(red).svg
License				Public Domain
License URI			https://en.wikipedia.org/wiki/Public_domain

Description			A 7 segment display
Author				h2g2bob
Author URI			https://commons.wikimedia.org/wiki/User:H2g2bob
Source				https://commons.wikimedia.org/wiki/File:7_segment_display_labeled.svg
License				GNU Free Documentation License
License URI			https://en.wikipedia.org/wiki/GNU_Free_Documentation_License

*/

const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Settings = imports.ui.settings;
const Cinnamon = imports.gi.Cinnamon;
const Lang = imports.lang;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;

const UUID = "SevenSegmentClock@lxs242";
const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID].path;

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
	return Gettext.dgettext(UUID, str);
}

function _getWidthFromHeight(width, height, newHeight) {
	return Math.round(width / (height / newHeight));
}

function SevenSegmentClockDesklet(metadata, desklet_id) {
	this._init(metadata, desklet_id);
}

function main(metadata, desklet_id) {
	return new SevenSegmentClockDesklet(metadata, desklet_id);
}

SevenSegmentClockDesklet.prototype = {
	__proto__: Desklet.Desklet.prototype
	
	,_init: function(metadata, desklet_id) {
		Desklet.Desklet.prototype._init.call(this, metadata);
		this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
		
		this.settings.bind('main-layout', 'main_layout', this._on_digits_changed);
		this.settings.bind('layout-gap', 'layout_gap', this._on_settings_changed);
		this.settings.bind('show-background', 'show_background', this._on_settings_changed);
		this.settings.bind('background-color', 'background_color', this._on_settings_changed);
		this.settings.bind('background-opacity', 'background_opacity', this._on_settings_changed);
		this.settings.bind('round-corners', 'round_corners', this._on_settings_changed);
		this.settings.bind('background-shadow', 'background_shadow', this._on_settings_changed);

		this.settings.bind('digit-style', 'digit_style', this._on_digits_changed);
		this.settings.bind('digit-skew', 'digit_skew', this._on_digits_changed);
		this.settings.bind('digit-color', 'digit_color', this._on_digits_changed);
		this.settings.bind('digit-opacity', 'digit_opacity', this._on_digits_changed);
		this.settings.bind('digit-margin', 'digit_margin', this._on_digits_changed);
		this.settings.bind('digit-alt69', 'digit_alt69', this._on_digits_changed);
		this.settings.bind('digit-alt7', 'digit_alt7', this._on_digits_changed);
		this.settings.bind('dark-enabled', 'dark_enabled', this._on_digits_changed);
		this.settings.bind('dark-color', 'dark_color', this._on_digits_changed);
		this.settings.bind('dark-opacity', 'dark_opacity', this._on_digits_changed);
		this.settings.bind('stroke-enabled', 'stroke_enabled', this._on_digits_changed);
		this.settings.bind('stroke-width', 'stroke_width', this._on_digits_changed);
		this.settings.bind('stroke-color', 'stroke_color', this._on_digits_changed);
		this.settings.bind('stroke-opacity', 'stroke_opacity', this._on_digits_changed);

		this.settings.bind('show-clock', 'show_clock', this._on_settings_changed);
		this.settings.bind('clock-height', 'clock_height', this._on_settings_changed);
		this.settings.bind('show-seconds', 'show_seconds', this._on_settings_changed);
		this.settings.bind('small-seconds', 'small_seconds', this._on_settings_changed);
		this.settings.bind('clock-divider', 'clock_divider', this._on_settings_changed);
		this.settings.bind('clock-blink', 'clock_blink', this._on_digits_changed);
		this.settings.bind('leading-zero', 'leading_zero', this._on_digits_changed);
		this.settings.bind('clock-12h', 'clock_12h', this._on_digits_changed);
		this.settings.bind('clock-ampm', 'clock_ampm', this._on_digits_changed);

		this.settings.bind('show-date', 'show_date', this._on_settings_changed);
		this.settings.bind('date-height', 'date_height', this._on_settings_changed);
		this.settings.bind('date-format', 'date_format', this._on_settings_changed);
		this.settings.bind('date-divider', 'date_divider', this._on_settings_changed);

		this.settings.bind('show-unix', 'show_unix', this._on_settings_changed);
		this.settings.bind('unix-height', 'unix_height', this._on_settings_changed);
		this.settings.bind('unix-divider', 'unix_divider', this._on_settings_changed);

		// some globals
		this.updateId = null;
		this.smallSecondsFraction = .6;
		this.digit = {};
		this.logSvgCreationTime = false;
		this.enable2SA = false;
		
		this.setHeader(_("Seven Segment Digital Clock"));

		this._initDigits();
	}
	
	,_initDigits: function() {
		
		this.SVG = _svgData(this.digit_style);
		this.SVG.marginFraction = this.digit_margin/100-this.digit_margin/100*this.digit_skew/10;
		if(this.SVG.marginFraction < 0) { this.SVG.marginFraction = 0; }
		this.SVG.widthOffset = 60*this.digit_skew/10;
		for(var w in this.SVG.width) {
			this.SVG.width[w] += this.SVG.widthOffset +(this.stroke_enabled ? this.stroke_width*2 : 0);
		}
		if(this.stroke_enabled) { this.SVG.height += this.stroke_width*2; }
		
		if(this.logSvgCreationTime)
		{
			var d = new Date();
			var creationTime1 = d.getTime();
		}
		
		// digits
		var matrix = { 0:"abcdef", 1:"bc", 2:"abdeg", 3:"abcdg", 4:"bcfg", 5:"acdfg", 6:"acdefg", 7:"abc", 8:"abcdefg", 9:"abcdfg" };

		// alternative digits
		if(this.digit_alt69) { matrix[6] = "cdefg"; matrix[9] = "abcfg"; }
		if(this.digit_alt7) { matrix[7] += "f"; }

		// add extra digits
		if(this.enable2SA) {
			matrix.a = "abcefg"; matrix.b = "cdefg"; matrix.c = "adef"; matrix.d = "bcdeg";
		}

		// add AM/PM indicators
		if(this.clock_12h)
		{
			if(this.clock_ampm != "hide") { matrix.a = "abcefg"; matrix.p = "abefg"; }
			if(this.clock_ampm == "m1") { matrix.m = "ace"; }
			if(this.clock_ampm == "m2") { matrix.m = "abcef"; }
		} 
		
		// generate digits
		for(var i in matrix)
		{
			if(this.digit[i]) { this.digit[i].destroy(); }
			this.digit[i] = this._generateDigit("segment", matrix[i]);
		}

		// destroy previous generated digits when settings are changed
		let destroy = ["dp", "cp", "dash", "dp0", "cp0", "off"];
		for(var d in destroy) {
			if(this.digit[destroy[d]]) { this.digit[destroy[d]].destroy(); }
		}

		// decimal point, colon and dash divider
		this.digit["dp"] = this._generateDigit("dp", "a", true);
		this.digit["cp"] = this._generateDigit("cp", "ab", true);
		this.digit["dash"] = this._generateDigit("segment", "g", true);
		
		// blinking divider points
		if(this.clock_blink && this.dark_enabled) {
			this.digit["dp0"] = this._generateDigit("dp", "");
			this.digit["cp0"] = this._generateDigit("cp", "");
		}
		
		// leading zero switched off
		if(this.leading_zero == "0" && this.dark_enabled) {
			this.digit["off"] = this._generateDigit("segment", "");
		}
		
		if(this.logSvgCreationTime)
		{
			d = new Date();
			var creationTime2 = d.getTime();
			global.logError((creationTime2-creationTime1).toString()+" ms");
		}

		this._initLayout();
	}

	,_generateDigit: function(data, segments, overrideDark=false) {
		
		var translateX = this.SVG.widthOffset;
		var translateY = 0;
		if(this.stroke_enabled) { translateX += this.stroke_width; translateY += this.stroke_width; }
		
		var svg = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>'
			+'<svg xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"'
			+' xmlns="http://www.w3.org/2000/svg" version="1.1"'
			+' viewBox="0 0 ' 
			+this.SVG.width[data].toString() +' ' +this.SVG.height.toString()
			+'"><g transform="translate(' +translateX.toString() +',' +translateY.toString()
			+') skewX(-' +this.digit_skew.toString()+ ')">';

		for(var i in this.SVG[data])
		{
			if(segments.match(new RegExp(i)))
			{
				svg += this._generateSvgSegment(this.SVG[data][i], this.digit_color, this.digit_opacity);
			} else {
				if(this.dark_enabled && !overrideDark)
				{
					svg += this._generateSvgSegment(this.SVG[data][i],
						(this.dark_color=="same" ? this.digit_color : this.dark_color),
						this.dark_opacity);
				}
			}
		}
		svg += '</g></svg>';
		
		let stream = Gio.MemoryInputStream.new_from_bytes(GLib.Bytes.new(svg));
		let pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
		let image = new Clutter.Image();
		image.set_data(pixbuf.get_pixels(), Cogl.PixelFormat.RGBA_8888, this.SVG.width[data], this.SVG.height, pixbuf.get_rowstride()); 
		let digit = new Clutter.Actor({ width: this.SVG.width[data], height: this.SVG.height });
		digit.set_content_scaling_filters(Clutter.ScalingFilter.TRILINEAR, Clutter.TextureQuality.MEDIUM);
		digit.set_content(image);

		return digit;
	}
	
	,_generateSvgSegment: function(segment, color, opacity) {
		
		var svg = '<' +segment.type 
			+' style="fill:' +color;
		if(this.stroke_enabled)
		{
			svg += ';stroke:' +this.stroke_color
				+';stroke-width:' +this.stroke_width +'px'
				+';stroke-opacity:' +(this.stroke_opacity / 100)
				+';stroke-linecap:round';
		}
		svg +='" opacity="' +(opacity / 100) +'"';
		switch(segment.type)
		{
			case "path":
				svg += ' d="' +segment.d +'"';
			break;
			case "rect":
				svg += ' x="' +segment.x.toString() +'"'
					+' y="' +segment.y.toString() +'"'
					+' width="' +segment.w.toString() +'"'
					+' height="' +segment.h.toString() +'"';
			break;
			case "circle":
				svg += ' cx="' +segment.x.toString() +'"'
					+' cy="' +segment.y.toString() +'"'
					+' r="' +segment.r.toString() +'"';
			break;
		}
		svg +=' />';
		return svg;
	}
	
	,_initLayout: function() {
		
		this.canvas = new St.BoxLayout({ vertical: true });
		
		/*
		Workaround to get the actor clones visible,
		as they only are when the source actor itself is displayed.
		So here we draw all digits and set their size to under 1px squared
		to make them disappear. Several attempts with style attributes didn't work.
		There sure may be better solution for this, but hey, it works.
		*/
		if(this.charset) { this.charset.destroy_all_children(); }
		this.charset = new St.Widget();
		for(var i in this.digit)
		{
			this.charset.add_actor(this.digit[i]);
			this.digit[i].set_size(.1,.1);
		}
		this.canvas.add(this.charset);

		// prepare layout
		let layout = this.main_layout.replace(/c/,"clock ").replace(/d/,"date ").replace(/u/,"unix ").trim().split(" ");
		this.outputBox = {};
		for(var l in layout)
		{
			this.outputBox[layout[l]]  = new St.BoxLayout();
			this.canvas.add(this.outputBox[layout[l]], { expand: true, x_fill: false, x_align: St.Align.MIDDLE });
		}
		this.setContent(this.canvas);
		this._updateUI();
	}

	,_updateUI: function() {
		
		let outputBox = this.main_layout.replace(/c/,"clock ").replace(/d/,"date ").replace(/u/,"unix ").trim().split(" ");
		
		var width, height, widthNew, heightNew;
		var divWidth, divWidthNew;
		var digit_location, num, div;
		var divider, divider_type;
		var firstV = false, firstH = false, x = 0;
		this.digitBox = {};
		this.digit_bin = {};
		this.dividerBox = {};
		
		for(var box in outputBox)
		{
			this.outputBox[outputBox[box]].destroy_all_children();
			// reset vertical spacer to prevent inconsistency when settings are changed
			this.outputBox[outputBox[box]].set_style("margin-top:0");
			
			switch(outputBox[box])
			{
				case "clock":
					if(!this.show_clock) { continue; }
					heightNew = this.clock_height;
					digit_location = 'nndnn';
					if(this.show_seconds) { digit_location += 'dnn'; }
					if(this.clock_12h && this.clock_ampm != "hide")
					{
						if(this.clock_ampm.match(/m/)) {
							digit_location += 'snn';
						} else {
							digit_location += 'sn';
						}
					} 
				break;
				case "date":
					if(!this.show_date) { continue; }
					heightNew = this.date_height;
					if(this.date_format.match(/ymd|ydm/))
					{
						digit_location = 'nnnndnndnn';
					} else {
						digit_location = 'nndnndnnnn';
					}
					if(this.enable2SA) { digit_location += "sssnnndn"; }
				break;
				case "unix":
					if(!this.show_unix) { continue; }
					heightNew = this.unix_height;
					digit_location = 'ndnnndnnndnnn';
				break;
			}
			
			// set vertical spacer
			if(!firstV) { firstV = true; } else {
				this.outputBox[outputBox[box]].set_style("margin-top:" +this.layout_gap +"px");
			}
			firstH = false;
			
			// set dimensions
			width = this.SVG.width.segment;
			height = this.SVG.height;
			widthNew = _getWidthFromHeight(width, height, heightNew);
			
			this.digitBox[outputBox[box]] = {};
			this.digit_bin[outputBox[box]] = {};
			this.dividerBox[outputBox[box]] = {};
			
			// draw digits
			let loc = digit_location.split("");
			num = -1; div = -1;
			for(var pos in loc)
			{
				if(loc[pos] == "n") { num++; }

				// determine divider type
				switch(outputBox[box])
				{
					case "clock":
						if(pos > 4 && this.small_seconds)
						{
							if(divider_type.match(/dp|cp|dash/)) { divider_type = "sspace"; }
						} else {
							divider_type = this.clock_divider;
						}
					break;
					case "date":
						divider_type = this.date_divider;
						if(this.enable2SA && pos>=12) { divider_type = "dp"; }
					break;
					case "unix": divider_type = this.unix_divider; break;
				}

				switch(loc[pos])
				{
					case "n":
					
						// make digit clone
						if(!firstH) { firstH = true; this.digit_bin[outputBox[box]][num] = new St.Widget();
						} else {
							this.digit_bin[outputBox[box]][num] = new St.Widget({ style: "margin-left:" +Math.round(widthNew * this.SVG.marginFraction) +"px" });
						}
						if(this.digitBox[outputBox[box]][num]) { this.digitBox[outputBox[box]][num].destroy(); }
						this.digitBox[outputBox[box]][num] = new Clutter.Clone();
						
						// set size of digit clone
						if(outputBox[box] == "clock" && this.small_seconds && num >= 4)
						{
							// smaller seconds
							x = Math.round(this.clock_height * this.smallSecondsFraction);
							this.digitBox[outputBox[box]][num].set_size(Math.round(widthNew * this.smallSecondsFraction), x);
							this.digit_bin[outputBox[box]][num].set_style("margin:" +(this.clock_height - x) +"px 0 0 " +Math.round(widthNew * this.SVG.marginFraction) +"px");
						} else {
							// general size
							this.digitBox[outputBox[box]][num].set_size(widthNew,heightNew);
						}
						
						// add digit clone
						this.digit_bin[outputBox[box]][num].add_actor(this.digitBox[outputBox[box]][num]);
						
						// add decimal point divider as overlay to digit_bin
						// this is necessary when a skew is applied to make it look like the point is still part of the digit
						if(loc[(parseInt(pos)+1)] == "d" && divider_type == "dp"
							&& !(outputBox[box] == "clock" && this.small_seconds && num >= 3))
						{
							this.dividerBox[outputBox[box]][++div] = new Clutter.Clone();
							this.dividerBox[outputBox[box]][div].set_source(this.digit[divider_type]);
							x = _getWidthFromHeight(this.SVG.width.dp, height, heightNew);
							this.dividerBox[outputBox[box]][div].set_size(x,heightNew);
							this.digit_bin[outputBox[box]][num].add_actor(this.dividerBox[outputBox[box]][div]);
						}
						
						this.outputBox[outputBox[box]].add(this.digit_bin[outputBox[box]][num]);

					break;
					
					case "d":
					
						// make divider
						switch(divider_type)
						{
							case "sspace":
								divider = new St.Bin({ style: "width:" +(Math.round(widthNew/3).toString()) +"px" });
							break;
							case "hspace":
								divider = new St.Bin({ style: "width:" +(Math.round(widthNew/2).toString()) +"px" });
							break;
							case "fspace":
								divider = new St.Bin({ style: "width:" +widthNew.toString() +"px" });
							break;
							case "cp":
							case "dash":
								if(divider_type != "dash")
								{
									divWidth = this.SVG.width[divider_type];
									divWidthNew = _getWidthFromHeight(divWidth, height, heightNew);
								}
								divider = new St.Widget({ style: "margin-" 
									+(divider_type == "dp" ? "right" : "left")
									+":" +Math.round(widthNew * this.SVG.marginFraction) +"px" });
								this.dividerBox[outputBox[box]][++div] = new Clutter.Clone();
								this.dividerBox[outputBox[box]][div].set_source(this.digit[divider_type]);
								this.dividerBox[outputBox[box]][div].set_size((divider_type == "dash" ? widthNew : divWidthNew), heightNew);
								divider.add_actor(this.dividerBox[outputBox[box]][div]);
							break;
						}
						if(divider_type != "dp") { this.outputBox[outputBox[box]].add(divider); }
					
					break;
					
					case "s":
						divider = new St.Bin({ style: "width:" +Math.round(widthNew * this.smallSecondsFraction) +"px" });
						this.outputBox[outputBox[box]].add(divider);
					break;
					
				}
			}
		}
		
		// set canvas background
		if(this.show_background)
		{
			var shadow_alpha = 100 - this.background_opacity / 1.5;
			var bg = 'background-color:' 
				+this.background_color.replace(/\(/,"a(").replace(/\)/,"," +(this.background_opacity / 100) +")")
				+';padding:' +this.layout_gap +'px'
				+';border:3px solid rgba(0,0,0,' +(this.background_opacity / 2 / 100) +')';
			if(this.round_corners) { bg += ';border-radius:25px'; }
			if(this.background_shadow) { bg += ';box-shadow:0 0 15px 10px rgba(0,0,0,' +(shadow_alpha / 100) +')'; }
			this.canvas.set_style(bg);
		} else {
			this.canvas.set_style(null);
		}

		// make the desklet not completely disappear when everything is switched off
		if(!this.show_clock && !this.show_date && !this.show_unix)
		{
			this.outputBox.clock.add(new St.Label({ text: "\"" +_("Time is an illusion") +".\"\n\n― " +_("Albert Einstein") }));
		} else {
			this._refresh(true);
		}
		
	}
	
	,_refresh: function(init=false) {
		
		var t = new GLib.DateTime();
		// t = t.add_minutes(242); // for testing purposes

		if(this.show_clock)
		{
			var time = '', ampm = '';
			var hour = t.get_hour();
			if(this.clock_12h)
			{
				if(hour > 12) { hour-= 12; }
				if(hour == 0) { hour = 12; }
				ampm = t.format("%P");
			}
			time += hour<10 ? '0'+hour.toString() : hour.toString();
			time += t.get_minute()<10 ? '0'+t.get_minute().toString() : t.get_minute().toString();
			if(this.show_seconds) {
				time += t.get_second()<10 ? '0'+t.get_second().toString() : t.get_second().toString();
			}

			// set time
			let time_arr = time.split("");
			for(var a in time_arr) {
				if(this.leading_zero.match(/0|\-0/) && a == 0 && time_arr[a] == 0)
				{
					if(this.dark_enabled && this.leading_zero == "0") {
						this.digitBox.clock[a].set_source(this.digit["off"]);
					} else {
						this.digitBox.clock[a].set_source(null);
					}
				} else {
					this.digitBox.clock[a].set_source(this.digit[time_arr[a]]);
				}
			}
			
			// blinking divider
			if(this.clock_blink && this.clock_divider.match(/dp|cp/))
			{
				for(var i=0; i<=1; i++)
				{
					if(this.dividerBox.clock[i])
					{
						if(t.get_second()%2 == 0) {
							this.dividerBox.clock[i].set_source(this.digit[this.clock_divider]);
						} else {
							if(this.dark_enabled) {
								this.dividerBox.clock[i].set_source(this.digit[this.clock_divider+"0"]);
							} else {
								this.dividerBox.clock[i].set_source(null);
							}
						}
					}
				}
			}

			// add AM/PM indicator
			if(this.clock_12h && this.clock_ampm != "hide")
			{
				if(this.clock_ampm == "ap") {
					this.digitBox.clock[++a].set_source(this.digit[ampm.substr(0,1)]);
				} else {
					this.digitBox.clock[++a].set_source(this.digit[ampm.substr(0,1)]);
					this.digitBox.clock[++a].set_source(this.digit[ampm.substr(1,1)]);
				}
			}

			// show/hide leading zero at startup or when settings are changed and then again at midnight and ten
			if(this.leading_zero == "-1" && (init || (t.get_minute() == 0 && t.get_hour().toString().match(/0|1|10|22/))))
			{
				if(time_arr[0] == "0")
				{
					this.digitBox.clock[0].set_size(0,0);
					this.digit_bin.clock[1].set_style("margin:0");
				} else {
					let width = _getWidthFromHeight(this.SVG.width.segment, this.SVG.height, this.clock_height);
					this.digitBox.clock[0].set_size(width, this.clock_height);
					this.digit_bin.clock[1].set_style("margin-left:" +Math.round(width * this.SVG.marginFraction) +"px");
				}
			}
		}
		
		if(this.show_date)
		{
			// refresh date only at startup or when settings are changed and then again at midnight
			if(init || (t.get_hour() == 0 && t.get_minute() == 0))
			{
				let year = t.get_year().toString();
				let month = t.get_month()<10 ? "0"+t.get_month().toString() : t.get_month().toString();
				let day = t.get_day_of_month()<10 ? "0"+t.get_day_of_month().toString() : t.get_day_of_month().toString();
				let date_arr = this.date_format.replace(/y/,year).replace(/m/,month).replace(/d/,day).split("");
				for(var a in date_arr) {
					this.digitBox.date[a].set_source(this.digit[date_arr[a]]);
				}
				if(this.enable2SA) { this._refresh2SA(); }
			}
		}
		
		if(this.show_unix)
		{
			let unix_arr = t.to_unix().toString().split("");
			for(var a in unix_arr) {
				this.digitBox.unix[a].set_source(this.digit[unix_arr[a]]);
			}
		}

		// match the system time as close as possible and even closer when seconds are displayed
		t = new Date();
		if(this.show_clock && this.show_seconds || this.clock_blink || this.show_unix)
		{
			this.updateId = Mainloop.timeout_add((1000-t.getMilliseconds()), Lang.bind(this, this._refresh));
		} else {
			this.updateId = Mainloop.timeout_add_seconds((60-t.getSeconds()), Lang.bind(this, this._refresh));
		}
	}
	

	,_on_layout_changed: function() {
		if(this.updateId) {
			Mainloop.source_remove(this.updateId);
			this.updateId = null;
		}
		this._initLayout();
	}

	,_on_digits_changed: function() {
		if(this.updateId) {
			Mainloop.source_remove(this.updateId);
			this.updateId = null;
		}
		this._initDigits();
	}

	,_on_settings_changed: function() {
		if(this.updateId) {
			Mainloop.source_remove(this.updateId);
			this.updateId = null;
		}
		this._updateUI();
	}

	,_on_desklet_removed: function() {
		if(this.updateId) {
			Mainloop.source_remove(this.updateId);
			this.updateId = null;
		}
	}
	
	,on_desklet_clicked(event) {
		// I didn't find out how to detect a double click,
		// also I didn't really invest time in any further search, so let's simulate it...
		if(event.get_button() == 1) {
			var c = (new Date()).getTime();
			if(!this.lastClick) { this.lastClick = 0; }
			if(c-this.lastClick < 420) { 
				this._on_digits_changed();
				this.lastClick = 0;
			} else {
				this.lastClick = c;
			}
		}
	}


	,_refresh2SA: function() {

		/*
		Duae Septimana Aetas, the Two Weeks Era, short 2SA or DSA,
		is the personal date format of this desklet's author.
		
		2SA is based on a 14 day cycle with its epoch on Sunday the 11th of January 1970.
		The first value displays the consecutive fortnight and the second value the day.
		Each fortnight has two different Sundays (0 and 7),
		two Mondays (1 and 8), two Tuesdays (2 and 9), and so on.
		Due to 2SA's nature the tetradecimal number system (base-14) is used.
		*/
		
		let t = new Date();
		let days = Math.floor((t.getTime()/1000-t.getTimezoneOffset()*60)/86400)-10;
		let f = Math.floor(days/14);
		let d = days-f*14;
		let dsa_arr = (f.toString(14)+d.toString(14)).split("");
		for(var a in dsa_arr) {
			this.digitBox.date[parseInt(a)+8].set_source(this.digit[dsa_arr[a]]);
		}
	}
}



function _svgData(style) {
	switch(style) {

		case "OpenClipart":
			
			/*
			Description			Simple seven segment display
			Author				OpenClipart
			Author URI		 	https://freesvg.org/by/OpenClipart
			Source				https://freesvg.org/seven-on-display
			License				Public Domain
			License URI			https://creativecommons.org/licenses/publicdomain/
			*/
			
			return {
				"height": 351.733
				,"width": { "segment": 182.039, "dp": 238.539, "cp": 51.5 }
				,"segment": {
					"a": { "type": "path", "d": "m 46.005979,2.0500898e-4 c 0,0 -13.810583,2.52505809102 -19.873208,5.73455869102 -5.620858,2.97845 -14.627119,12.1876893 -14.627119,12.1876893 l 48.093266,22.224992 65.929562,-0.717722 23.8124,-36.5618847 z" },
					"b": { "type": "path", "d": "m 159.55295,7.8857367 -25.14793,39.4314293 -0.82163,99.649934 37.41362,24.37197 8.99789,-9.31906 2.04406,-126.175289 c 0,0 -3.69736,-11.022897 -8.58906,-16.565916 C 170.23286,15.630358 159.55295,7.8857367 159.55295,7.8857367 Z" },
					"c": { "type": "path", "d": "m 176.66879,189.97676 -43.89876,15.77538 -0.004,102.51686 24.9857,37.99356 c 0,0 14.0533,-8.32398 18.11645,-15.05306 4.00695,-6.64714 4.93259,-22.9405 4.93259,-22.9405 l 1.13417,-111.12238 z" },
					"d": { "type": "path", "d": "m 123.32525,314.91183 -67.505152,0.22709 -45.370924,22.27716 c 7.08e-4,0 8.281499,6.94277 13.048065,9.33266 4.476603,2.24451 14.261689,4.53455 14.261689,4.53455 L 148.25182,351.733 Z" },
					"e": { "type": "path", "d": "M 13.178329,188.19109 1.5566539,196.55126 3.5911663,327.33843 48.706309,305.54299 49.26165,205.425 Z" },
					"f": { "type": "path", "d": "M 3.9937835,28.679442 0,160.58896 13.282157,168.57199 46.86518,147.68517 49.885882,49.466368 Z" },
					"g": { "type": "path", "d": "m 57.676587,154.85036 -37.192024,22.94055 32.092653,15.77524 71.818234,3.58047 41.57755,-15.23928 -40.87904,-26.67532 z" }
				}
				,"dp": { "a": { "type": "circle", "x": 212.75, "y": 325.983, "r": 25.277523 } }
				,"cp": {
					"a": { "type": "circle", "x": 25.75, "y": 255.983, "r": 25.277523 },
					"b": { "type": "circle", "x": 25.75, "y": 95.983002, "r": 25.277523 }
				}
			}
		break;
		
		case "alex8664":

			/*
			Description			A simple seven segment display
			Author				alex8664
			Source				https://openclipart.org/detail/168839/seven-segment-display-gray-8-by-alex8664
			License				Public Domain
			License URI			http://creativecommons.org/publicdomain/zero/1.0/
			*/

			return {
				"height": 351.245
				,"width": { "segment": 207.799, "dp": 259.5, "cp": 40.5 }
				,"segment": {
					"a": { "type": "path", "d": "M 23.157793,19.109985 3.3163968,0.24152532 l 50.0542372,-0.1712 c 27.530993,-0.0942 72.778836,-0.0942 100.549446,0 l 50.49523,0.1712 L 184.5739,19.109985 164.73251,37.978435 H 103.86428 42.99607 l -19.8414,-18.86845 z" },
					"b": { "type": "path", "d": "m 178.79188,161.95125 -10.52247,-10.09629 0.0234,-55.182125 0.0235,-55.1821 13.5251,-12.90185 c 7.43906,-7.096 16.30528,-15.62035 19.70364,-18.9429899 l 6.17814,-6.0411498 -2.8e-4,75.4597697 -2.4e-4,75.459795 -9.20496,8.76045 -9.20497,8.76045 -10.52246,-10.0963 z" },
					"c": { "type": "path", "d": "m 187.88484,327.86051 -19.51904,-20.37602 -0.0195,-54.265 -0.0195,-54.265 7.51399,-7.23026 c 4.1328,-3.97671 8.87948,-8.46777 10.54783,-9.98 l 3.034,-2.7499 9.18819,8.80728 9.18819,8.80729 -0.19942,75.811 -0.19942,75.811 -19.51865,-20.37601 z" },
					"d": { "type": "path", "d": "m 9.135892,346.28056 c 2.509345,-2.73039 10.573599,-11.27135 17.920558,-18.98046 l 13.358463,-14.01602 h 63.451717 63.45172 l 13.35846,14.01602 c 7.34696,7.70871 15.41121,16.24985 17.92055,18.98046 l 4.56248,4.96444 H 103.86702 4.57419 l 4.562485,-4.96444 z" },
					"e": { "type": "path", "d": "m 0.0078056,272.40523 v -76.03736 l 9.1604784,-8.69255 9.160483,-8.69254 3.028773,2.7451 c 1.665848,1.50982 6.409957,5.99861 10.542766,9.97532 l 7.513992,7.23026 -0.0168,54.265 -0.0168,54.265 -12.778941,13.35844 c -7.02846,7.34696 -15.887657,16.5683 -19.6868005,20.49153 l -6.9079255,7.13308 v -76.03735 z" },
					"f": { "type": "path", "d": "M 9.186627,163.27031 0,154.49464 0.16988,79.300225 0.339759,4.1058351 19.876361,22.772135 39.412966,41.438445 v 55.29918 55.299195 L 28.893226,162.0418 18.373487,172.04677 9.18686,163.2711 Z" },
					"g": { "type": "path", "d": "m 32.547348,185.41731 -10.540811,-10.18293 10.422953,-9.85161 10.422957,-9.85161 h 61.016523 61.01653 l 10.42296,9.85161 10.42294,9.85161 -10.5408,10.18293 -10.54082,10.18293 H 103.87131 43.09285 L 32.55203,185.41731 Z" }
				}
				,"dp": { "a": { "type": "circle", "x": 239.25, "y": 330.995, "r": 19.794945 } }
				,"cp": {
					"a": { "type": "circle", "x": 19.794945, "y": 254.995, "r": 19.794945 },
					"b": { "type": "circle", "x": 19.794945, "y": 94.995003, "r": 19.794945 }
				}
			}
		break;
		
		case "Cfaerber":
		
			/*
			Description			seven segment display - digit 8 (red) Created by 3247 using 7segment.pl
			Author				Cfaerber
			Author URI			https://commons.wikimedia.org/wiki/User:3247
			Source				https://en.wikipedia.org/wiki/File:Seven_segment_display_8_digit_(red).svg
			License				Public Domain
			License URI			https://en.wikipedia.org/wiki/Public_domain
			*/
			
			return {
				"height": 351.138
				,"width": { "segment": 187, "dp": 227.5, "cp": 30 }
				,"segment": {
					"a": { "type": "path", "d": "M 12.89655,11.43103 24.62069,0 h 138.34483 l 11.72414,11.43103 -11.72414,11.43104 H 24.62069 Z" },
					"b": { "type": "path", "d": "M 175.56897,12.89655 164.13793,24.62069 V 162.67241 L 175.56897,174.39655 187,162.67241 V 24.62069 Z" },
					"c": { "type": "path", "d": "m 175.56897,177.03448 -11.43104,11.72414 V 326.81034 L 175.56897,338.53448 187,326.81034 V 188.75862 Z" },
					"d": { "type": "path", "d": "m 12.89655,339.7069 11.72414,-11.43104 h 138.34483 l 11.72414,11.43104 -11.72414,11.43103 H 24.62069 Z" },
					"e": { "type": "path", "d": "M 11.43103,177.03448 0,188.75862 v 138.05172 l 11.43103,11.72414 11.43104,-11.72414 V 188.75862 Z" },
					"f": { "type": "path", "d": "M 11.43103,12.89655 0,24.62069 v 138.05172 l 11.43103,11.72414 11.43104,-11.72414 V 24.62069 Z" },
					"g": { "type": "path", "d": "M 12.89655,175.56896 24.62069,164.13793 H 162.96552 L 174.68966,175.56896 162.96552,187 H 24.62069 Z" }
				}
				,"dp": { "a": { "type": "circle", "x": 212.75, "y": 337.38794, "r": 14.75 } }
				,"cp": {
					"a": { "type": "circle", "x": 14.75, "y": 255.38794, "r": 14.75 },
					"b": { "type": "circle", "x": 14.75, "y": 95.387939, "r": 14.75 }
				}
			}
		break;
		
		case "h2g2bob":
		
			/*
			Description			A 7 segment display
			Author				h2g2bob
			Author URI			https://commons.wikimedia.org/wiki/User:H2g2bob
			Source				https://commons.wikimedia.org/wiki/File:7_segment_display_labeled.svg
			License				GNU Free Documentation License
			License URI			https://en.wikipedia.org/wiki/GNU_Free_Documentation_License
			*/
			
			return {
				"height": 350.317
				,"width": { "segment": 229.296, "dp": 301, "cp": 62 }
				,"segment": {
					"a": { "type": "path", "d": "M 194.89711,28.662046 167.64672,56.428405 H 61.955437 L 34.157208,28.662046 61.955437,0.89568625 H 167.64672 Z" },
					"b": { "type": "path", "d": "M 200.63434,33.830404 228.4007,61.080775 V 141.69277 L 200.63434,169.491 172.86798,141.69277 V 61.080775 Z" },
					"c": { "type": "path", "d": "m 200.63434,180.8263 27.76636,27.25037 v 80.61199 l -27.76636,27.79821 -27.76636,-27.79821 v -80.61199 z" },
					"d": { "type": "path", "d": "M 194.89711,321.65523 167.64672,349.4216 H 61.955437 L 34.157208,321.65523 61.955437,293.88887 H 167.64672 Z" },
					"e": { "type": "path", "d": "m 28.662049,180.8263 27.766359,27.25037 v 80.61199 L 28.662049,316.48687 0.89568901,288.68866 v -80.61199 z" },
					"f": { "type": "path", "d": "M 28.662049,33.830404 56.428408,61.080775 V 141.69277 L 28.662049,169.491 0.89568901,141.69277 V 61.080775 Z" },
					"g": { "type": "path", "d": "m 194.89711,174.65936 -27.25039,27.76635 H 61.955437 L 34.157208,174.65936 61.955437,146.893 H 167.64672 Z" }
				}
				,"dp": { "a": { "type": "circle", "x": 270, "y": 318.21732, "r": 30.841177 } }
				,"cp": {
					"a": { "type": "circle", "x": 30.841177, "y": 249.717, "r": 30.841177 },
					"b": { "type": "circle", "x": 30.841177, "y": 101.71699, "r": 30.841177 }
				}
			}
		break;
		
		

		/*
		Description			"DSEG": Original 7-segment fonts
		Author				Keshikan
		Source				https://www.keshikan.net/fonts-e.html
		License				SIL Open Font License 1.1
		License URI			http://scripts.sil.org/OFL
		*/

		case "keshikan-classic-light":
			return {
				"height": 350.36545
				,"width": { "segment": 216.52585, "dp": 273.33911, "cp": 43.1 }
				,"segment": {
					"a": { "type": "path", "d": "M 14.729473,10.535464 25.601228,-0.33630184 H 191.13244 L 202.0042,10.535464 191.13244,21.407192 H 25.601228 Z" },
					"b": { "type": "path", "d": "m 205.86192,14.393185 10.87175,10.871729 V 172.20894 h -9.81964 l -1.05211,-1.05209 -10.87176,-10.52104 V 25.264914 Z" },
					"c": { "type": "path", "d": "m 205.86192,178.87229 1.05211,-1.0521 h 9.81964 v 146.94403 l -10.87175,10.87173 -10.87176,-10.87173 V 189.74406 Z" },
					"d": { "type": "path", "d": "m 202.0042,339.49366 -10.87176,10.87178 H 25.601228 L 14.729473,339.49366 25.601228,328.62194 H 191.13244 Z" },
					"e": { "type": "path", "d": "M 10.871754,335.63595 6.7138672e-7,324.76422 V 177.82019 H 9.819649 l 1.052105,1.0521 10.871753,10.87177 v 135.02016 z" },
					"f": { "type": "path", "d": "m 10.871754,171.15685 -1.052105,1.05209 H 6.7138672e-7 V 25.264914 L 10.871754,14.393185 21.743507,25.264914 V 160.28508 Z" },
					"g": { "type": "path", "d": "m 191.13244,164.1428 10.87176,10.87177 -10.87176,10.87177 H 25.601228 L 14.729473,175.01457 25.601228,164.1428 Z" }
				}
				,"dp": { "a": { "type": "circle", "x": 251.59576, "y": 328.6221, "r": 21.505051 } }
				,"cp": {
					"a": { "type": "circle", "x": 21.505051, "y": 252.12024, "r": 21.505051 },
					"b": { "type": "circle", "x": 21.505051, "y": 106.98154, "r": 21.505051 }
				}
			}
		break;

		case "keshikan-classic-regular":
			return {
				"height": 350.36545
				,"width": { "segment": 216.52585, "dp": 273.33911, "cp": 43.1 }
				,"segment": {
					"a": { "type": "path", "d": "M 15.7816,10.535101 26.65336,-0.3366648 H 190.08055 L 200.95232,10.535101 179.20879,32.278632 H 37.52513 Z" },
					"b": { "type": "path", "d": "m 205.86215,15.44493 10.87176,10.871766 V 171.50737 h -9.46895 l -1.75352,-1.40281 -21.39282,-21.39283 V 37.188461 Z" },
					"c": { "type": "path", "d": "m 205.51144,180.27493 1.75352,-1.40281 h 9.46895 v 144.83997 l -10.87176,10.87177 -21.74353,-21.74353 V 201.66775 Z" },
					"d": { "type": "path", "d": "m 200.95232,339.49369 -10.87177,10.87176 H 26.65336 L 15.7816,339.49369 37.52513,317.75016 h 141.68366 z" },
					"e": { "type": "path", "d": "M 10.87177,334.58386 0,323.71209 V 178.52142 h 9.46896 l 1.40281,1.75351 21.74353,21.39282 v 111.17258 z" },
					"f": { "type": "path", "d": "m 10.87177,169.75386 -1.40281,1.75351 H 0 V 26.316696 L 10.87177,15.44493 32.6153,37.188461 V 148.36103 Z" },
					"g": { "type": "path", "d": "m 200.60162,175.3651 -16.483,16.13229 v -0.3507 H 32.6153 v 0.3507 l -16.8337,-16.483 16.8337,-16.483 v 0.35071 h 151.50332 z" }
				}
				,"dp": { "a": { "type": "circle", "x": 251.59576, "y": 328.6221, "r": 21.505051 } }
				,"cp": {
					"a": { "type": "circle", "x": 21.505051, "y": 252.12024, "r": 21.505051 },
					"b": { "type": "circle", "x": 21.505051, "y": 106.98154, "r": 21.505051 }
				}
			}
		break;

		case "keshikan-classic-bold":
			return {
				"height": 350.702
				,"width": { "segment": 216.733, "dp": 273.33911, "cp": 43.1 }
				,"segment": {
					"a": { "type": "path", "d": "M 15.78159,10.535098 26.65336,-0.3366669 H 190.08055 L 200.95231,10.535098 168.33702,43.150395 H 48.39689 Z" },
					"b": { "type": "path", "d": "m 205.86214,15.444928 10.87177,10.871766 V 171.50737 h -20.34072 l -1.40281,-1.40281 -21.74353,-21.39283 V 48.060225 Z" },
					"c": { "type": "path", "d": "m 194.99038,180.27492 1.40281,-1.4028 h 20.34072 v 144.83997 l -10.87177,10.87177 -32.61529,-32.6153 V 201.66775 Z" },
					"d": { "type": "path", "d": "m 200.95231,339.49369 -10.87176,10.87176 H 26.65336 l -10.87177,-10.87176 32.6153,-32.6153 h 119.94013 z" },
					"e": { "type": "path", "d": "M 10.87176,334.58386 0,323.71209 V 178.52141 h 20.34072 l 1.40281,1.75351 21.74353,21.39283 v 100.30081 z" },
					"f": { "type": "path", "d": "m 21.74353,169.75386 -1.40281,1.75351 H 0 V 26.316694 L 10.87176,15.444928 43.48706,48.060225 V 148.36103 Z" },
					"g": { "type": "path", "d": "m 167.63561,153.27086 22.09423,22.09423 -21.39282,21.39283 H 48.39689 L 26.65336,175.01439 48.39689,153.27086 Z" }
				}
				,"dp": { "a": { "type": "circle", "x": 251.59576, "y": 328.6221, "r": 21.505051 } }
				,"cp": {
					"a": { "type": "circle", "x": 21.505051, "y": 252.12024, "r": 21.505051 },
					"b": { "type": "circle", "x": 21.505051, "y": 106.98154, "r": 21.505051 }
				}
			}
		break;

		case "keshikan-classic-mini-light":
			return {
				"height": 350.702
				,"width": { "segment": 216.733, "dp": 273.33911, "cp": 43.1 }
				,"segment": {
					"a": { "type": "path", "d": "M 33.3167,21.406863 22.44493,10.535098 33.3167,-0.3366682 h 150.10051 l 10.87176,10.8717662 -10.87176,10.871765 z" },
					"b": { "type": "path", "d": "m 205.86214,22.108267 10.87177,10.871766 V 166.94824 h -7.36475 l -3.50702,-3.50702 -10.87176,-10.87177 V 32.980033 Z" },
					"c": { "type": "path", "d": "m 205.86214,186.58756 3.50702,-3.50702 h 7.36475 v 133.96821 l -10.87177,10.87176 -10.87176,-10.87176 V 197.45933 Z" },
					"d": { "type": "path", "d": "m 194.28897,339.49368 -10.87176,10.87177 H 33.3167 L 22.44493,339.49368 33.3167,328.62192 h 150.10051 z" },
					"e": { "type": "path", "d": "M 10.87176,327.92051 0,317.04875 V 183.08054 h 7.36474 l 3.50702,3.50702 10.87177,10.87177 v 119.58942 z" },
					"f": { "type": "path", "d": "m 10.87176,163.44122 -3.50702,3.50702 H 0 V 32.980033 L 10.87176,22.108267 21.74353,32.980033 V 152.56945 Z" },
					"g": { "type": "path", "d": "M 22.44493,175.01439 33.3167,164.14262 h 150.10051 l 10.87176,10.87177 -10.87176,10.87177 H 33.3167 Z" }
				}
				,"dp": { "a": { "type": "circle", "x": 251.59576, "y": 328.6221, "r": 21.505051 } }
				,"cp": {
					"a": { "type": "circle", "x": 21.505051, "y": 252.12024, "r": 21.505051 },
					"b": { "type": "circle", "x": 21.505051, "y": 106.98154, "r": 21.505051 }
				}
			}
		break;

		case "keshikan-classic-mini-regular":
			return {
				"height": 350.702
				,"width": { "segment": 216.733, "dp": 273.33911, "cp": 43.1 }
				,"segment": {
					"a": { "type": "path", "d": "M 26.30266,10.535102 36.82372,-0.3366631 H 179.91019 L 190.43125,10.535102 169.03842,32.278634 H 47.69549 Z" },
					"b": { "type": "path", "d": "m 205.86215,25.965996 10.87176,10.521063 V 164.14263 h -6.31264 l -4.55912,-4.55913 -21.74354,-21.39283 V 47.358825 Z" },
					"c": { "type": "path", "d": "m 205.86215,190.44529 4.55912,-4.55913 h 6.31264 v 127.65557 l -10.87176,10.52106 -21.74354,-21.39283 v -90.48114 z" },
					"d": { "type": "path", "d": "m 190.43125,339.49369 -10.52106,10.87176 H 36.82372 L 26.30266,339.49369 47.69549,317.75015 h 121.34293 z" },
					"e": { "type": "path", "d": "M 10.87177,324.06279 0,313.54173 V 185.88616 h 6.31264 l 4.55913,4.55913 21.74353,21.39283 v 90.83184 z" },
					"f": { "type": "path", "d": "m 10.87177,159.5835 -4.55913,4.55913 H 0 V 36.837761 L 10.87177,25.965996 32.6153,47.358825 v 90.831845 z" },
					"g": { "type": "path", "d": "m 174.29896,158.8821 16.13229,16.13229 -16.13229,16.1323 h -131.864 l -16.1323,-16.1323 16.1323,-16.13229 z" }
				}
				,"dp": { "a": { "type": "circle", "x": 251.59576, "y": 328.6221, "r": 21.505051 } }
				,"cp": {
					"a": { "type": "circle", "x": 21.505051, "y": 252.12024, "r": 21.505051 },
					"b": { "type": "circle", "x": 21.505051, "y": 106.98154, "r": 21.505051 }
				}
			}
		break;

		case "keshikan-classic-mini-bold":
			return {
				"height": 350.702
				,"width": { "segment": 216.733, "dp": 273.33911, "cp": 43.1 }
				,"segment": {
					"a": { "type": "path", "d": "M 26.30266,10.535093 36.82372,-0.3366724 h 143.08646 l 10.52107,10.8717654 -32.2646,32.615297 h -99.5994 z" },
					"b": { "type": "path", "d": "m 205.86214,25.965986 10.87177,10.521064 v 127.65557 h -6.31264 l -4.55913,-4.55913 -32.6153,-32.26459 V 58.230581 Z" },
					"c": { "type": "path", "d": "m 205.86214,190.44528 4.55913,-4.55913 h 6.31264 v 127.65557 l -10.87177,10.52107 -32.6153,-32.2646 v -69.08832 z" },
					"d": { "type": "path", "d": "m 190.43125,339.49368 -10.52107,10.87177 H 36.82372 l -10.52106,-10.87177 32.26459,-32.6153 h 99.5994 z" },
					"e": { "type": "path", "d": "M 10.87176,324.06279 0,313.54172 V 185.88615 h 6.31263 l 4.55913,4.55913 32.6153,32.26459 v 69.08832 z" },
					"f": { "type": "path", "d": "m 10.87176,159.58349 -4.55913,4.55913 H 0 V 36.837752 L 10.87176,25.965986 43.48706,58.230581 V 127.3189 Z" },
					"g": { "type": "path", "d": "m 169.03842,153.27085 21.39283,21.74354 -21.39283,21.74353 H 47.69548 L 26.30266,175.01439 47.69548,153.27085 Z" }
				}
				,"dp": { "a": { "type": "circle", "x": 251.59576, "y": 328.6221, "r": 21.505051 } }
				,"cp": {
					"a": { "type": "circle", "x": 21.505051, "y": 252.12024, "r": 21.505051 },
					"b": { "type": "circle", "x": 21.505051, "y": 106.98154, "r": 21.505051 }
				}
			}
		break;

		case "keshikan-modern-light":
			return {
				"height": 350.702
				,"width": { "segment": 216.733, "dp": 273.33911, "cp": 43.1 }
				,"segment": {
					"a": { "type": "path", "d": "M 36.12231,21.406983 4.90983,3.1704733 q 4.20842,-3.50702115 9.46895,-3.50702115 h 93.98817 93.98817 q 3.50702,0 4.90983,0.70140423 L 194.99037,21.406983 h -86.62342 z" },
					"b": { "type": "path", "d": "m 216.73391,14.042239 v 160.972271 1.75351 l -12.27458,-7.01404 -3.85772,-2.45492 -5.61124,-3.15631 V 92.599513 35.78577 L 213.22688,4.5732818 q 3.50703,4.2084254 3.50703,9.4689572 z" },
					"c": { "type": "path", "d": "m 200.95231,175.71592 15.7816,9.46895 v 150.80191 q 0,3.15632 -0.70141,4.55913 l -21.04213,-11.92387 v -71.19253 -71.54323 z" },
					"d": { "type": "path", "d": "m 180.61159,328.62204 31.21249,18.23651 q -4.20843,3.50702 -9.46896,3.50702 H 108.36695 17.5351 l 12.62528,-21.74353 h 78.20657 z" },
					"e": { "type": "path", "d": "M 9.46895,349.66417 Q 0,346.15714 0,335.98678 V 175.01451 173.261 l 14.02808,8.06615 4.55913,2.80562 3.15632,1.75351 v 71.54323 71.19253 z" },
					"f": { "type": "path", "d": "M 21.74353,92.599513 V 164.14275 L 15.78159,174.31311 0,164.84415 V 14.042239 Q 0,10.88592 0.7014,9.4831115 L 21.74353,21.406983 Z" },
					"g": { "type": "path", "d": "M 186.57352,185.88628 H 108.36695 36.12231 l -14.02808,-8.06615 8.06615,-13.67738 h 78.20657 72.24464 l 14.02808,8.06614 z" }
				}
				,"dp": { "a": { "type": "circle", "x": 251.59576, "y": 328.6221, "r": 21.505051 } }
				,"cp": {
					"a": { "type": "circle", "x": 21.505051, "y": 252.12024, "r": 21.505051 },
					"b": { "type": "circle", "x": 21.505051, "y": 106.98154, "r": 21.505051 }
				}
			}
		break;

		case "keshikan-modern-regular":
			return {
				"height": 350.702
				,"width": { "segment": 216.733, "dp": 273.33911, "cp": 43.1 }
				,"segment": {
					"a": { "type": "path", "d": "M 46.99408,32.278749 2.10421,6.3267924 q 4.20842,-6.66334025 12.27457,-6.66334025 h 187.97634 0.7014 L 184.11861,32.278749 Z" },
					"b": { "type": "path", "d": "m 210.07057,1.7676649 q 6.66334,4.2084254 6.66334,12.2745741 V 169.05258 l -32.6153,-18.58722 V 46.657536 Z" },
					"c": { "type": "path", "d": "m 198.14669,166.94836 18.58722,10.52107 v 158.51735 0.70141 l -32.6153,-18.93792 V 191.14681 Z" },
					"d": { "type": "path", "d": "m 169.73982,317.75027 44.88987,25.95196 q -4.20842,6.66334 -12.27457,6.66334 H 22.09423 l 18.58721,-32.6153 z" },
					"e": { "type": "path", "d": "M 13.67738,350.36557 Q 8.06614,350.01487 3.85772,346.15714 0,341.94872 0,335.98678 V 180.97645 l 32.61529,18.58721 v 118.18661 z" },
					"f": { "type": "path", "d": "M 18.58721,183.08066 0,172.5596 V 14.042239 13.340835 L 32.61529,32.278749 V 158.88221 Z" },
					"g": { "type": "path", "d": "m 192.18476,163.44134 -16.1323,27.70547 H 32.61529 l -8.06615,-4.55913 16.1323,-27.70547 h 143.43717 z" }
				}
				,"dp": { "a": { "type": "circle", "x": 251.59576, "y": 328.6221, "r": 21.505051 } }
				,"cp": {
					"a": { "type": "circle", "x": 21.505051, "y": 252.12024, "r": 21.505051 },
					"b": { "type": "circle", "x": 21.505051, "y": 106.98154, "r": 21.505051 }
				}
			}
		break;

		case "keshikan-modern-bold":
			return {
				"height": 350.702
				,"width": { "segment": 216.733, "dp": 273.33911, "cp": 43.1 }
				,"segment": {
					"a": { "type": "path", "d": "M 57.86585,43.150515 0.7014,9.8338136 Q 3.85772,-0.33654785 14.37878,-0.33654785 H 198.4974 L 173.24684,43.150515 Z" },
					"b": { "type": "path", "d": "M 206.56354,0.36485638 Q 216.73391,3.5211754 216.73391,14.042239 V 170.10468 L 173.24684,144.85413 V 56.477195 h 0.70141 z" },
					"c": { "type": "path", "d": "m 192.18476,164.14275 24.54915,14.37878 V 332.12906 L 173.24684,306.87851 V 196.75804 Z" },
					"d": { "type": "path", "d": "m 158.86806,306.87851 57.16444,33.3167 q -3.15632,10.17036 -13.67738,10.17036 H 18.23651 l 25.25055,-43.48706 z" },
					"e": { "type": "path", "d": "m 43.48706,292.49972 -33.3167,57.16445 Q 0,346.50785 0,335.98678 V 179.92434 l 21.04212,12.27457 2.10422,1.05211 20.34072,11.92387 z" },
					"f": { "type": "path", "d": "M 24.54914,185.88628 0,171.50749 V 17.899962 L 43.48706,43.150515 V 153.27098 Z" },
					"g": { "type": "path", "d": "m 185.87212,160.63572 -20.69143,36.12232 H 43.48706 L 30.86178,189.3933 51.55321,153.27098 h 121.69363 z" }
				}
				,"dp": { "a": { "type": "circle", "x": 251.59576, "y": 328.6221, "r": 21.505051 } }
				,"cp": {
					"a": { "type": "circle", "x": 21.505051, "y": 252.12024, "r": 21.505051 },
					"b": { "type": "circle", "x": 21.505051, "y": 106.98154, "r": 21.505051 }
				}
			}
		break;

		case "keshikan-modern-mini-light":
			return {
				"height": 350.702
				,"width": { "segment": 216.733, "dp": 273.33911, "cp": 43.1 }
				,"segment": {
					"a": { "type": "path", "d": "M 64.87989,21.406983 27.35476,-0.33654785 h 81.01219 93.98817 q 3.50702,0 4.90983,0.70140423 L 194.99037,21.406983 h -86.62342 z" },
					"b": { "type": "path", "d": "M 194.99037,64.543344 216.73391,27.018217 V 151.51747 L 194.99037,139.2429 V 92.599513 Z" },
					"c": { "type": "path", "d": "m 204.45933,169.75398 12.27458,7.01404 v 159.21876 q 0,3.15632 -0.70141,4.55913 l -21.04213,-11.92387 v -71.19253 -71.54323 z" },
					"d": { "type": "path", "d": "m 151.85401,328.62204 37.52513,21.74353 H 108.36695 34.0181 l 12.62528,-21.74353 h 61.72357 z" },
					"e": { "type": "path", "d": "M 9.46895,349.66417 Q 0,346.15714 0,335.98678 V 198.51155 l 21.74353,12.27458 v 46.64338 71.19253 z" },
					"f": { "type": "path", "d": "M 21.74353,164.14275 12.27457,180.27504 0,173.261 V 14.042239 Q 0,10.88592 0.7014,9.4831115 L 21.74353,21.406983 v 71.19253 z" },
					"g": { "type": "path", "d": "M 170.09052,185.88628 H 108.36695 34.0181 l 12.62528,-21.74353 h 61.72357 74.34885 z" }
				}
				,"dp": { "a": { "type": "circle", "x": 251.59576, "y": 328.6221, "r": 21.505051 } }
				,"cp": {
					"a": { "type": "circle", "x": 21.505051, "y": 252.12024, "r": 21.505051 },
					"b": { "type": "circle", "x": 21.505051, "y": 106.98154, "r": 21.505051 }
				}
			}
		break;

		case "keshikan-modern-mini-regular":
			return {
				"height": 350.702
				,"width": { "segment": 216.733, "dp": 273.33911, "cp": 43.1 }
				,"segment": {
					"a": { "type": "path", "d": "M 75.75165,32.278749 19.63931,-0.33654785 h 182.71581 0.7014 L 184.11861,32.278749 Z" },
					"b": { "type": "path", "d": "m 216.73391,152.56958 -32.6153,-18.93792 V 75.41511 l 32.6153,-56.112339 z" },
					"c": { "type": "path", "d": "m 216.73391,177.46943 v 158.51735 0.70141 l -32.6153,-18.93792 V 191.14681 l 14.02808,-24.19845 z" },
					"d": { "type": "path", "d": "M 197.09459,350.36557 H 38.92793 l 18.58721,-32.6153 h 83.46711 z" },
					"e": { "type": "path", "d": "M 13.67738,350.36557 Q 8.06614,350.01487 3.85772,346.15714 0,341.94872 0,335.98678 V 197.45945 l 32.61529,18.93791 v 101.35291 z" },
					"f": { "type": "path", "d": "M 32.61529,158.88221 18.58721,183.08066 0,172.5596 V 14.042239 13.340835 l 32.61529,18.937914 z" },
					"g": { "type": "path", "d": "m 38.92793,191.14681 18.58721,-32.2646 h 120.29083 l -18.58721,32.2646 z" }
				}
				,"dp": { "a": { "type": "circle", "x": 251.59576, "y": 328.6221, "r": 21.505051 } }
				,"cp": {
					"a": { "type": "circle", "x": 21.505051, "y": 252.12024, "r": 21.505051 },
					"b": { "type": "circle", "x": 21.505051, "y": 106.98154, "r": 21.505051 }
				}
			}
		break;

		case "keshikan-modern-mini-bold":
			return {
				"height": 350.702
				,"width": { "segment": 216.733, "dp": 273.33911, "cp": 43.1 }
				,"segment": {
					"a": { "type": "path", "d": "M 86.62342,43.150515 11.92387,0.01415427 q 0.3507,0 1.0521,0 1.05211,-0.35070212 1.40281,-0.35070212 H 198.4974 L 173.24684,43.150515 Z" },
					"b": { "type": "path", "d": "M 173.24684,128.37113 V 86.286875 L 216.3832,11.587324 q 0,0.350702 0,1.402809 0.35071,0.701404 0.35071,1.052106 V 153.27098 Z" },
					"c": { "type": "path", "d": "m 192.18476,164.14275 24.54915,14.37878 V 332.12906 L 173.24684,306.87851 V 196.75804 Z" },
					"d": { "type": "path", "d": "m 130.11048,306.87851 74.69955,43.13636 q -0.3507,0 -1.4028,0.3507 -0.70141,0 -1.05211,0 H 18.23651 l 25.25055,-43.48706 z" },
					"e": { "type": "path", "d": "m 0,196.75804 43.48706,24.89985 v 42.08426 L 0.3507,338.4417 q 0,-0.3507 -0.3507,-1.05211 0,-1.0521 0,-1.40281 z" },
					"f": { "type": "path", "d": "M 24.54914,185.88628 0,171.50749 V 17.899962 L 43.48706,43.150515 V 153.27098 Z" },
					"g": { "type": "path", "d": "M 148.34699,196.75804 H 43.48706 l 24.89985,-43.48706 h 104.85993 z" }
				}
				,"dp": { "a": { "type": "circle", "x": 251.59576, "y": 328.6221, "r": 21.505051 } }
				,"cp": {
					"a": { "type": "circle", "x": 21.505051, "y": 252.12024, "r": 21.505051 },
					"b": { "type": "circle", "x": 21.505051, "y": 106.98154, "r": 21.505051 }
				}
			}
		break;


		/*
		Description			some simple designs
		Author				lxs242
		Source				this file
		License				GNU General Public License version 3 or later
		License URI			https://www.gnu.org/licenses/gpl-3.0.html
		*/

		case "simple1":
			return {
				"height": 350.56598
				,"width": { "segment": 220.12283, "dp": 270, "cp": 30.105 }
				,"segment": {
					"a": { "type": "rect", "x": 40.583858, "y": 0.56174093, "w": 138.95523, "h": 28.929127 },
					"b": { "type": "rect", "x": 190.58636, "y": 0.48071453, "w": 29.055738, "h": 169.3132 },
					"c": { "type": "rect", "x": 190.58636, "y": 180.77205, "w": 29.055738, "h": 169.3132 },
					"d": { "type": "rect", "x": 40.584354, "y": 321.02249, "w": 138.95421, "h": 28.981102 },
					"e": { "type": "rect", "x": 0.48072472, "y": 180.77205, "w": 29.055738, "h": 169.3132 },
					"f": { "type": "rect", "x": 0.48072472, "y": 0.48071259, "w": 29.055738, "h": 169.3132 },
					"g": { "type": "rect", "x": 40.583858, "y": 160.84505, "w": 138.95523, "h": 28.929127 }
				}
				,"dp": { "a": { "type": "rect", "x": 239.53856, "y": 320.46097, "w": 30.105, "h": 30.105 } }
				,"cp": {
					"a": { "type": "rect", "x": 0, "y": 240.46097, "w": 30.105, "h": 30.105 },
					"b": { "type": "rect", "x": 0, "y": 80.460968, "w": 30.105, "h": 30.105 }
				}
			}
		break;
		
		case "simple2":
			return {
				"height" : 350
				,"width" : { "segment" : 245, "dp" : 290, "cp" : 45 }
				,"segment" :
				{
					"a" : { "type" : "rect", "w" : 133.64816, "h" : 43.563309, "x" : 55.675922, "y" : 0.67590714 }
					,"b" : { "type" : "rect", "w" : 43.820988, "h" : 168.82098, "x" : 200.58951, "y" : 0.58949375 }
					,"c" : { "type" : "rect", "w" : 43.820988, "h" : 168.82098, "x" : 200.58951, "y" : 180.58951 }
					,"d" : { "type" : "rect", "w" : 133.64816, "h" : 43.563309, "x" : 55.675922, "y" : 305.76056 }
					,"e" : { "type" : "rect", "w" : 43.820984, "h" : 168.82098, "x" : 0.58950752, "y" : 180.58948 }
					,"f" : { "type" : "rect", "w" : 43.820984, "h" : 168.82098, "x" : 0.58950752, "y" : 0.58949375 }
					,"g" : { "type" : "rect", "w" : 133.64816, "h" : 43.563309, "x" : 55.675922, "y" : 152.7182 }
				}
				,"dp" :
				{
					"a" : { "type" : "rect", "w" : 44.915001, "h" : 44.915001, "x" : 269.3241, "y" : 305.08499 }
				}
				,"cp" :
				{
					"a" : { "type" : "rect", "w" : 44.915001, "h" : 44.915001, "x" : 0, "y" : 232.58499 }
					,"b" : { "type" : "rect", "w" : 44.915001, "h" : 44.915001, "x" : 0, "y" : 72.584984 }
				}
			}
		break;

		case "simple3":
			return {
				"height": 350
				,"width": { "segment": 220, "dp": 270, "cp": 30 }
				,"segment": {
					"a": { "type": "rect", "x": 30, "y": 0, "w": 160, "h": 30 },
					"b": { "type": "rect", "x": 190, "y": 30, "w": 30, "h": 130 },
					"c": { "type": "rect", "x": 190, "y": 190, "w": 30, "h": 130 },
					"d": { "type": "rect", "x": 30, "y": 320, "w": 160, "h": 30 },
					"e": { "type": "rect", "x": 0, "y": 190, "w": 30, "h": 130 },
					"f": { "type": "rect", "x": 0, "y": 30, "w": 30, "h": 130 },
					"g": { "type": "rect", "x": 30, "y": 160, "w": 160, "h": 30 }
				}
				,"dp": { "a": { "type": "rect", "x": 240, "y": 320, "w": 30, "h": 30 } }
				,"cp": {
					"a": { "type": "rect", "x": 0, "y": 240, "w": 30, "h": 30 },
					"b": { "type": "rect", "x": 0, "y": 80, "w": 30, "h": 30 }
				}
			}
		break;
		
		case "curved":
			return {
				"height": 350
				,"width": { "segment": 230, "dp": 270, "cp": 30 }
				,"segment": {
					"a": { "type": "path", "d": "m 20.060445,13.997471 c 0,-7.8993899 42.688621,-14.310489 95.287095,-14.310489 52.59848,0 95.28711,6.4110991 95.28711,14.310489 0,7.89939 -42.68863,14.310489 -95.28711,14.310489 -52.598474,0 -95.287095,-6.411099 -95.287095,-14.310489 z" },
					"b": { "type": "path", "d": "m 215.76625,169.45598 c -7.81565,0 -14.15879,-33.70156 -14.15879,-75.226655 0,-41.525114 6.34314,-75.226655 14.15879,-75.226655 7.81562,0 14.15879,33.701541 14.15879,75.226655 0,41.525095 -6.34317,75.226655 -14.15879,75.226655 z" },
					"c": { "type": "path", "d": "m 215.76625,329.93955 c -7.81565,0 -14.15879,-33.70156 -14.15879,-75.22666 0,-41.52512 6.34314,-75.22666 14.15879,-75.22666 7.81562,0 14.15879,33.70154 14.15879,75.22666 0,41.5251 -6.34317,75.22666 -14.15879,75.22666 z" },
					"d": { "type": "path", "d": "m 20.060445,335.32254 c 0,-7.8994 42.688621,-14.31052 95.287095,-14.31052 52.59848,0 95.28711,6.41112 95.28711,14.31052 0,7.8994 -42.68863,14.31052 -95.28711,14.31052 -52.598474,0 -95.287095,-6.41112 -95.287095,-14.31052 z" },
					"e": { "type": "path", "d": "M 14.158787,329.93955 C 6.3431366,329.93955 0,296.23801 0,254.71289 c 0,-41.52511 6.3431366,-75.22665 14.158787,-75.22665 7.815622,0 14.158787,33.70154 14.158787,75.22665 0,41.52512 -6.343165,75.22666 -14.158787,75.22666 z" },
					"f": { "type": "path", "d": "M 14.158787,169.45598 C 6.3431366,169.45598 0,135.75444 0,94.229325 0,52.704211 6.3431366,19.00267 14.158787,19.00267 c 7.815622,0 14.158787,33.701541 14.158787,75.226655 0,41.525115 -6.343165,75.226655 -14.158787,75.226655 z" },
					"g": { "type": "path", "d": "m 20.060445,174.48093 c 0,-7.89942 42.688621,-14.31053 95.287095,-14.31053 52.59848,0 95.28711,6.41111 95.28711,14.31053 0,7.89942 -42.68863,14.31053 -95.28711,14.31053 -52.598474,0 -95.287095,-6.41111 -95.287095,-14.31053 z" }
				}
				,"dp": { "a": { "type": "circle", "x": 255.05621, "y": 334.95465, "r": 15.045334 } }
				,"cp": {
					"a": { "type": "circle", "x": 15.045334, "y": 254.71292, "r": 15.045334 },
					"b": { "type": "circle", "x": 15.045334, "y": 94.229332, "r": 15.045334 }
				}
			}
		break;

	}
}
