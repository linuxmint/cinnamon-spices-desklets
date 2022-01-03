/*
 * bbcwx - a Cinnamon Desklet displaying the weather retrieved
 * from one of several web services.
 *
 * Copyright 2014 - 2018 Chris Hastie. Forked from accudesk@logan; original
 * code Copyright 2013 loganj.
 *
 * Includes the marknote library, Copyright 2011 jbulb.org.
 * Icons Copyright 2010 Merlin the Red, 2010 VClouds, 2010
 * d3stroy and 2004 digitalchet.
 * See help.html for further credits and license information.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Main = imports.ui.main;

const Tooltips = imports.ui.tooltips;
const Cinnamon = imports.gi.Cinnamon;
const Settings = imports.ui.settings;

const DeskletManager = imports.ui.deskletManager;

const Soup = imports.gi.Soup;

const UUID = "bbcwx@oak-wood.co.uk";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

imports.searchPath.push(DESKLET_DIR);

const Marknote = imports.marknote;

const _httpSession = new Soup.SessionAsync();
Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());

// Set up some constants for layout and styling
const BBCWX_TEXT_SIZE = 14;
const BBCWX_CC_TEXT_SIZE = 24;
const BBCWX_LABEL_TEXT_SIZE = 11;
const BBCWX_LINK_TEXT_SIZE = 10;
const BBCWX_REFRESH_ICON_SIZE=14;
const BBCWX_TABLE_ROW_SPACING=2;
const BBCWX_TABLE_COL_SPACING=5;
const BBCWX_TABLE_PADDING=5;
const BBCWX_CONTAINER_PADDING=12;
const BBCWX_ICON_HEIGHT = 40;
const BBCWX_CC_ICON_HEIGHT =170;
const BBCWX_BUTTON_PADDING=3;
const BBCWX_LABEL_PADDING=4;
const BBCWX_TEMP_PADDING=12;
const BBCWX_SEPARATOR_STYLE = 'bbcwx-separator';
const BBCWX_SERVICE_STATUS_ERROR = 0;
const BBCWX_SERVICE_STATUS_INIT = 1;
const BBCWX_SERVICE_STATUS_OK = 2;
const BBCWX_DEFAULT_ICONSET = 'colourful';
const BBCWX_DEFAULT_ICON_EXT = 'png';
const BBCWX_TRANSLATION_URL = 'https://github.com/tipichris/bbcwx/wiki/Translating';

const Gettext = imports.gettext;
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

// list of preferred languages, most preferred first
const LangList = GLib.get_language_names()
//const LangList = ['ar', 'zh_CN', 'es_ES', 'es', 'en'];

function _(str) {
  if (!str.toString().length) return '';
  return Gettext.dgettext(UUID, str)
}

function MyDesklet(metadata,desklet_id){
  this._init(metadata,desklet_id);
}

MyDesklet.prototype = {
  __proto__: Desklet.Desklet.prototype,


  _init: function(metadata,desklet_id){
    //############Variables###########
    this.desklet_id = desklet_id;
    //## Days of the week
    this.daynames={Mon: _('Mon'),Tue: _('Tue'), Wed: _('Wed'), Thu: _('Thu'), Fri: _('Fri'), Sat: _('Sat'), Sun: _('Sun')};
    this.fwicons=[];this.labels=[];this.max=[];this.min=[];this.windd=[];this.winds=[];this.tempn=[];this.eachday=[];this.wxtooltip=[];
    this.cc=[];this.days=[];
    this.metadata = metadata;
    this.oldno=0; // test for a change in this.no
    this.oldwebservice='';
    this.oldshifttemp='';
    this.redrawNeeded=false;


    //################################

    try {
      Desklet.Desklet.prototype._init.call(this, metadata);
      //#########################binding configuration file################
      this.settings = new Settings.DeskletSettings(this, UUID, this.desklet_id);
      // temperature unit change may require refetching forecast if service includes units in text summaries
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"tunits","tunits",this.onTempUnitChange,null);
      // these require only a redisplay
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"wunits","wunits",this.onUnitChange,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"punits","punits",this.onUnitChange,null);
      // these changes require only a change to the styling of the desklet:
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"overrideTheme","overrideTheme",this.updateStyle,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"transparency","transparency",this.updateStyle,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"textcolor","textcolor",this.updateStyle,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"bgcolor","bgcolor",this.updateStyle,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"cornerradius","cornerradius",this.updateStyle,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"zoom","zoom",this.updateStyle,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"border","border",this.updateStyle,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"bordercolor","bordercolor",this.updateStyle,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"borderwidth","borderwidth",this.updateStyle,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"iconstyle","iconstyle",this.updateStyle,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"citystyle","citystyle",this.updateStyle,null);
      // this change requires us to fetch new data:
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"stationID","stationID",this.changeStation,null);
      // this requires a change of API key and refetch data
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"apikey","apikey",this.changeApiKey,null);
      // this change requires the main loop to be restarted, but no other updates
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"refreshtime","refreshtime",this.changeRefresh,null);
      // these changes potentially need a redraw of the window, but not a refetch of data
      // layout because the position of the current temperature may change
      // userno because of change to number of days in table, and possibly position of current temperature
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"layout","layout",this.displayOptsChange,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"userno","userno",this.redraw,null);

      // these need a redraw. displayOptsChange sets a flag to say a redraw is needed before calling redraw
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"display__cc__pressure","display__cc__pressure",this.displayOptsChange,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"display__cc__humidity","display__cc__humidity",this.displayOptsChange,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"display__cc__feelslike","display__cc__feelslike",this.displayOptsChange,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"display__cc__wind_speed","display__cc__wind_speed",this.displayOptsChange,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"display__cc__visibility","display__cc__visibility",this.displayOptsChange,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"display__forecast__wind_speed","display__forecast__wind_speed",this.displayOptsChange,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"display__forecast__wind_direction","display__forecast__wind_direction",this.displayOptsChange,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"display__forecast__maximum_temperature","display__forecast__maximum_temperature",this.displayOptsChange,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"display__forecast__minimum_temperature","display__forecast__minimum_temperature",this.displayOptsChange,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"display__forecast__pressure","display__forecast__pressure",this.displayOptsChange,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"display__forecast__humidity","display__forecast__humidity",this.displayOptsChange,null);

      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"display__meta__country","display__meta__country",this.updateStyle,null);

      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"display__cc__weather","display__cc__weather",this.displayOptsChange,null);

      // a change to webservice requires data to be fetched and the window redrawn
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"webservice","webservice",this.initForecast,null);

      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"locsrc","locsrc",this.displayMeta,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"manuallocation","manuallocation",this.displayMeta,null);

      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"experimental_enabled","experimental_enabled",this.doExperimental,null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"gravity","gravity",this.setGravity,null);

      // refresh style on change of global desklet setting for decorations
      global.settings.connect('changed::desklet-decorations', Lang.bind(this, this.updateStyle));

      // set a header for those that don't override the theme
      //## The desklet title
      this.setHeader(_('Weather'));

      this._geocache = new Object();
      this._geocache.yahoo = new Object();
      this._geocache.google = new Object();

      this.helpFile = DESKLET_DIR + "/help.html";
      //## Link to Help file in context menu
      this._menu.addAction(_('Help'), Lang.bind(this, function() {
        Util.spawnCommandLine("xdg-open " + this.helpFile);
      }));
      //## Link to information on translating in context menu
      this._menu.addAction(_('Translate'), Lang.bind(this, function() {
        Util.spawnCommandLine("xdg-open " + BBCWX_TRANSLATION_URL);
      }));
      this.initForecast();

    }
    catch (e) {
      global.logError(e);
    }
    return true;
  },


  ////////////////////////////////////////////////////////////////////////////
  // Set everything up initially
  initForecast: function() {
    if (this.service) delete this.service;
    // select the the driver we need for this service
    switch(this.webservice) {
      case 'bbc':
        this.service = new wxDriverBBC(this.stationID);
        break;
//      case 'yahoo':
//        this.service = new wxDriverYahoo(this.stationID);
//        break;
      case 'owm':
        this.service = new wxDriverOWM(this.stationID, this.apikey);
        break;
      case 'owm2':
        this.service = new wxDriverOWMFree(this.stationID, this.apikey);
        break;
      case 'wunderground':
        this.service = new wxDriverWU(this.stationID, this.apikey);
        break;
      case 'wwo':
        this.service = new wxDriverWWO(this.stationID, this.apikey);
        break;
      case 'wwo2':
        this.service = new wxDriverWWOPremium(this.stationID, this.apikey);
        break;
      case 'apixu':
        this.service = new wxDriverAPIXU(this.stationID, this.apikey);
        break;
      case 'forecast':
        this.service = new wxDriverForecastIo(this.stationID, this.apikey);
        break;
      case 'twc':
        this.service = new wxDriverTWC(this.stationID);
        break;
      case 'meteoblue':
        this.service = new wxDriverMeteoBlue(this.stationID, this.apikey);
        break;
      default:
        this.service = new wxDriverBBC(this.stationID);
    }

    this._setDerivedValues();
    this._createWindow();
    this.setGravity();
    this._update_style();
    this._refreshweathers();
  },

  ////////////////////////////////////////////////////////////////////////////
  // Create the layout of our desklet. Certain settings changes require this
  // to be called again (eg change service, as capabilities change, change number
  // days of forecast to display
  _createWindow: function(){
    // in these circumstances we do not need to redraw the window from scratch as the elements haven't changed
    if((this.no == this.oldno) && (this.oldwebservice == this.webservice) && (this.shifttemp == this.oldshifttemp) && !this.redrawNeeded) {
      return;
    }

    this.oldno=this.no;
    this.oldwebservice = this.webservice;
    this.oldshifttemp = this.shifttemp;
    this.redrawNeeded = false;

    // get rid of the signal to banner and main icon before we recreate a window
    try {
      if (this.bannersig) this.banner.disconnect(this.bannersig);
      if (this.cwiconsig && this.cwicon) this.cwicon.disconnect(this.cwiconsig);
      this.bannersig = null;
      this.cwiconsig = null;
    } catch(e) { }

    this.window=new St.BoxLayout({vertical: ((this.vertical==1) ? true : false)});

    this.cwicon = null;
    // container for link and refresh icon
    this.buttons=new St.BoxLayout({vertical: false,x_align:2, y_align:2 });
    // refresh icon
    this.iconbutton=new St.Icon({ icon_name: 'view-refresh-symbolic',
      icon_type: St.IconType.SYMBOLIC
    });
    this.but=new St.Button(); // container for refresh icon

    // these will hold the data for the three day forecast
    this.labels=[]; this.fwicons=[];this.max=[]; this.min=[]; this.windd=[]; this.winds=[];
    this.fhumidity=[]; this.fpressure=[]; this.eachday=[];

    // some labels need resetting incase we are redrawing after a change of service
    this.humidity=null; this.pressure=null; this.windspeed=null; this.feelslike=null;

    this._separatorArea = new St.DrawingArea({ style_class: BBCWX_SEPARATOR_STYLE });

    let ccap = this.show.cc;

    // current weather values
    if(ccap.humidity) this.humidity=new St.Label();
    if(ccap.pressure) this.pressure=new St.Label();
    if(ccap.wind_speed) this.windspeed=new St.Label();
    if(ccap.feelslike) this.feelslike=new St.Label();
    if(ccap.visibility) this.visibility=new St.Label();

    // container for current weather values
    this.ctemp_values = new St.BoxLayout({vertical: true, y_align: 2});
    // container for current weather labels
    this.ctemp_captions = new St.BoxLayout({vertical: true, y_align: 2});
    // container for current weather
    this.ctemp = new St.BoxLayout({vertical: false, x_align: 2, y_align: 2});

    // city and city container
    this.cityname=new St.Label();
    this.city=new St.BoxLayout({vertical:true});

    // container for right (horizontal) or lower (vertical) part of window
    this.container= new St.BoxLayout({vertical: true, x_align: 2});
    // container for left (horizontal) or upper (vertical) part of window
    this.cweather = new St.BoxLayout({vertical: true, x_align: 2});
    // current weather icon container
    if (ccap.weather) this.cwicon = new St.Button();
    // current weather text
    if (ccap.weather) this.weathertext=new St.Label();

    // current temp on wide layouts
    if (this.shifttemp) {
      this.ctemp_bigtemp = new St.BoxLayout({vertical: false, x_align: 3, y_align: 2});
      this.currenttemp=new St.Label();
      this.ctemp_bigtemp.add_actor(this.currenttemp);
      this.ctemp.add_actor(this.ctemp_bigtemp);
    }

    this.city.add_actor(this.cityname);

    //## Next five strings are labels for current conditions
    if(ccap.humidity) this.ctemp_captions.add_actor(new St.Label({text: _('Humidity:')}));
    if(ccap.pressure) this.ctemp_captions.add_actor(new St.Label({text: _('Pressure:')}));
    if(ccap.wind_speed) this.ctemp_captions.add_actor(new St.Label({text: _('Wind:')}));
    if(ccap.feelslike) this.ctemp_captions.add_actor(new St.Label({text: _('Feels like:')}));
    if(ccap.visibility) this.ctemp_captions.add_actor(new St.Label({text: _('Visibility:')}));

    if(this.humidity) this.ctemp_values.add_actor(this.humidity);
    if(this.pressure) this.ctemp_values.add_actor(this.pressure);
    if(this.windspeed) this.ctemp_values.add_actor(this.windspeed);
    if(this.feelslike) this.ctemp_values.add_actor(this.feelslike);
    if(this.visibility) this.ctemp_values.add_actor(this.visibility);

    this.ctemp.add_actor(this.ctemp_captions);
    this.ctemp.add_actor(this.ctemp_values);

    // build table to hold three day forecast
    this.fwtable =new St.Table();

    //## Maximum temperature
    this.maxlabel = new St.Label({text: _('Max:')});
    //## Minimum temperature
    this.minlabel = new St.Label({text: _('Min:')});
    //## Wind speed (English translation is "Wind:")
    this.windlabel = new St.Label({text: _('Wind speed:')});
    //## Wind direction
    this.winddlabel = new St.Label({text: _('Dir:')});
    //## Atmospheric pressure
    this.fpressurelabel = new St.Label({text: _('Pressure:')});
    this.fhumiditylabel = new St.Label({text: _('Humidity:')});

    let fcap = this.show.forecast;
    let row = 2;

    if(fcap.maximum_temperature) {this.fwtable.add(this.maxlabel,{row:row,col:0}); row++}
    if(fcap.minimum_temperature) {this.fwtable.add(this.minlabel,{row:row,col:0}); row++}
    if(fcap.wind_speed) {this.fwtable.add(this.windlabel,{row:row,col:0}); row++}
    if(fcap.wind_direction) {this.fwtable.add(this.winddlabel,{row:row,col:0}); row++}
    if(fcap.pressure) {this.fwtable.add(this.fpressurelabel,{row:row,col:0}); row++}
    if(fcap.humidity) {this.fwtable.add(this.fhumiditylabel,{row:row,col:0}); row++}
    for(let f=0;f<this.no;f++) {
      this.labels[f]=new St.Button({label: ''});
      this.fwicons[f]=new St.Button();
      if(fcap.maximum_temperature) this.max[f]=new St.Label();
      if(fcap.minimum_temperature) this.min[f]=new St.Label();
      if(fcap.wind_speed) this.winds[f]=new St.Label();
      if(fcap.wind_direction) this.windd[f]=new St.Label();
      if(fcap.pressure) this.fpressure[f]=new St.Label();
      if(fcap.humidity) this.fhumidity[f]=new St.Label();
      this.wxtooltip[f] = new Tooltips.Tooltip(this.fwicons[f]);

      this.fwtable.add(this.labels[f],{row:0,col:f+1});
      this.fwtable.add(this.fwicons[f],{row:1,col:f+1});
      row = 2;
      if(this.max[f]) {this.fwtable.add(this.max[f],{row:row,col:f+1}); row++}
      if(this.min[f]) {this.fwtable.add(this.min[f],{row:row,col:f+1}); row++}
      if(this.winds[f]) {this.fwtable.add(this.winds[f],{row:row,col:f+1}); row++}
      if(this.windd[f]) {this.fwtable.add(this.windd[f],{row:row,col:f+1}); row++}
      if(this.fpressure[f]) {this.fwtable.add(this.fpressure[f],{row:row,col:f+1}); row++}
      if(this.fhumidity[f]) {this.fwtable.add(this.fhumidity[f],{row:row,col:f+1}); row++}
    }

    this.buttoncontainer = new St.BoxLayout({vertical: true, x_align: 2, y_align: 2});

    this.but.set_child(this.iconbutton);
    this.but.connect('clicked', Lang.bind(this, this.updateForecast));
    // seems we have to use a button for bannerpre to get the vertical alignment :(
    //## Credit the data supplier. A link to the data supplier appears to the right of this string
    this.bannerpre=new St.Button({label: _('Data from ')});
    this.banner=new St.Button({
      reactive: true,
      track_hover: true,
      style_class: 'bbcwx-link'});
    this.bannericon=new St.Button({
      reactive: true,
      track_hover: true,
      style_class: 'bbcwx-link'});
    this.bannertooltip = new Tooltips.Tooltip(this.banner);
    if (this.cwicon) this.cwicontooltip = new Tooltips.Tooltip(this.cwicon);
    //## Tooltip for refresh button
    this.refreshtooltip = new Tooltips.Tooltip(this.but, _('Refresh'));
    this.buttons.add_actor(this.bannerpre);
    this.buttons.add_actor(this.banner);
    this.buttons.add_actor(this.but);
    this.buttoncontainer.add_actor(this.bannericon);
    this.buttoncontainer.add_actor(this.buttons);
    this.container.add_actor(this.ctemp);
    this.container.add_actor(this._separatorArea);
    this.container.add_actor(this.fwtable);
    this.cweather.add_actor(this.city);
    if (this.cwicon) this.cweather.add_actor(this.cwicon);
    if (this.weathertext) this.cweather.add_actor(this.weathertext);
    this.container.add_actor(this.buttoncontainer);
    this.window.add_actor(this.cweather);
    this.window.add_actor(this.container);

    this.setContent(this.window);

  },

  ////////////////////////////////////////////////////////////////////////////
  // Set some internal values derived from user choices
  _setDerivedValues: function() {

    this.vertical = this.layout;
    this.currenttempadding = BBCWX_TEMP_PADDING;
    this.currenttempsize = BBCWX_CC_TEXT_SIZE;

    // set the number of days of forecast to display; maximum of the number
    // selected by the user and the maximum supported by the driver
    if (this.userno > this.service.maxDays) {
      this.no = this.service.maxDays;
    } else {
      this.no = this.userno;
    }

    // set the refresh period; minimum of the number
    // selected by the user and the minimum supported by the driver
    this.refreshSec = this.refreshtime * 60;
    if (this.refreshSec < this.service.minTTL) {
      this.refreshSec = this.service.minTTL;
    }

    // if more than four days we'll shift the position of the current temperature,
    // but only in horizontal layout
    // false: concatenate with weather text; true: shift to alongside current conditions;
    this.shifttemp = false;
    if (this.no > 4 && this.vertical == 0) {
      this.shifttemp = true;
    }

    // set this.iconprops
    this._initIcons();

    // clone this.service.capabilities, then && it with display preferences
    this.show =  JSON.parse(JSON.stringify(this.service.capabilities));
    let displayopts =['display__cc__pressure', 'display__cc__wind_speed',
      'display__cc__humidity', 'display__cc__feelslike', 'display__cc__visibility',
      'display__forecast__wind_speed', 'display__forecast__wind_direction',
      'display__forecast__maximum_temperature', 'display__forecast__minimum_temperature',
      'display__forecast__humidity', 'display__forecast__pressure',
      'display__meta__country'
    ];
    let ccShowCount=0;
    for (let i=0; i<displayopts.length; i++) {
      let parts=displayopts[i].split('__');
      this.show[parts[1]][parts[2]] = this.show[parts[1]][parts[2]] && this[displayopts[i]];
      if (parts[1] == 'cc' && this.show[parts[1]][parts[2]]) ccShowCount++;
    }

    // don't shift the current temp display position if
    // no current conditions to display
    if (ccShowCount < 1) this.shifttemp = false;

    // if not showing current weather text and icon, force
    // to vertical and shift current temperature
    this.show.cc.weather = this.display__cc__weather;
    if (!this.display__cc__weather) {
      this.shifttemp = true
      this.currenttempsize = this.currenttempsize*1.7;
      this.vertical = 1;
      // don't right pad the temperature if there's nothing to its right
      if (ccShowCount < 1) this.currenttempadding = 0;
    }
  },

  ////////////////////////////////////////////////////////////////////////////
  // Set internal values for icons
  _initIcons: function() {
    this.iconprops = this._getIconMeta(this.iconstyle);
    this.defaulticonprops = this._getIconMeta(BBCWX_DEFAULT_ICONSET);

    //global.log('_initIcons set values ' + this.iconprops.aspect + ' ; ' + this.iconprops.ext + ' ; ' + this.iconprops.adjust + ' using ' + this.iconstyle);
  },

  ////////////////////////////////////////////////////////////////////////////
  // Fetch the icon set meta data
  _getIconMeta: function(iconset) {
    let iconprops = new Object();
    let deficonprops = {
      aspect: 1,
      adjust: 1,
      ext: 'png',
      map : {}
    }

    let file = Gio.file_new_for_path(DESKLET_DIR + '/icons/' + iconset + '/iconmeta.json');
    try {
      let raw_file = Cinnamon.get_file_contents_utf8_sync(file.get_path());
      iconprops = JSON.parse(raw_file);
    } catch(e) {
      global.logError("Failed to parse iconmeta.json for iconset " + this.iconstyle);
    }
    // set anything missing to default values
    for (let prop in deficonprops) {
      if (typeof iconprops[prop] === 'undefined') {
        iconprops[prop] = deficonprops[prop];
      }
    }
    return iconprops;
  },

  ////////////////////////////////////////////////////////////////////////////
  // Called when some change requires the styling of the desklet to be updated
  updateStyle: function() {
    // set values for this.iconprops
    this._setDerivedValues();
    // update style
    this._update_style();
    // also need to run these to update icon style and size
    this.displayForecast();
    this.displayCurrent();
    this.displayMeta();
  },

  ////////////////////////////////////////////////////////////////////////////
  // Called when units are changed
  onUnitChange: function() {
    this.displayForecast();
    this.displayCurrent();
  },

  ////////////////////////////////////////////////////////////////////////////
  // Called when temperature units are updated. If service text summaries include
  // units we must refetch forecast, otherwise just refresh display
  onTempUnitChange: function() {
    this.onUnitChange();
    if(this.service.unitsInSummaries) {
      this.updateForecast();
    }
  },

  ////////////////////////////////////////////////////////////////////////////
  // Does the bulk of the work of updating style
  _update_style: function() {
    //global.log("bbcwx (instance " + this.desklet_id + "): entering _update_style");
    this.window.vertical = (this.vertical==1) ? true : false;
    if (this.cwicon) {
      this.cwicon.height=BBCWX_CC_ICON_HEIGHT*this.zoom;
      this.cwicon.width=BBCWX_CC_ICON_HEIGHT*this.iconprops.aspect*this.zoom;
    }
    if (this.weathertext) this.weathertext.style= 'text-align : center; font-size:'+BBCWX_CC_TEXT_SIZE*this.zoom+'px';
    if (this.currenttemp) this.currenttemp.style= 'text-align : center; font-size:'+this.currenttempsize*this.zoom+'px';
    if (this.ctemp_bigtemp) this.ctemp_bigtemp.style = 'text-align : left; padding-right: ' + this.currenttempadding *this.zoom + 'px'
    this.fwtable.style="spacing-rows: "+BBCWX_TABLE_ROW_SPACING*this.zoom+"px;spacing-columns: "+BBCWX_TABLE_COL_SPACING*this.zoom+"px;padding: "+BBCWX_TABLE_PADDING*this.zoom+"px;";
    this.cityname.style="text-align: center;font-size: "+BBCWX_TEXT_SIZE*this.zoom+"px; font-weight: " + ((this.citystyle) ? 'bold' : 'normal') + ";" ;
    this.ctemp_captions.style = 'text-align : right;font-size: '+BBCWX_TEXT_SIZE*this.zoom+"px; padding-right: " +BBCWX_LABEL_PADDING*this.zoom+"px";
    this.ctemp_values.style = 'text-align : left; font-size: '+BBCWX_TEXT_SIZE*this.zoom+"px";

    if(this.overrideTheme) {
      // hide header and use a style with no border
      this._header.hide();
      this.window.set_style_class_name('desklet');
      if (this.border) {
        let borderradius = (this.borderwidth > this.cornerradius) ? this.borderwidth : this.cornerradius;
        this.window.style="border: " + this.borderwidth + "px solid "+this.bordercolor+"; border-radius: " + borderradius + "px; background-color: "+(this.bgcolor.replace(")",","+this.transparency+")")).replace('rgb','rgba')+"; color: "+this.textcolor;
      }
      else {
        this.window.style="border-radius: " + this.cornerradius + "px; background-color: "+(this.bgcolor.replace(")",","+this.transparency+")")).replace('rgb','rgba')+"; color: "+this.textcolor;
      }
      this.banner.style='font-size: '+BBCWX_LINK_TEXT_SIZE*this.zoom+"px; color: " + this.textcolor;
      this.bannerpre.style='font-size: '+BBCWX_LINK_TEXT_SIZE*this.zoom+"px; color: " + this.textcolor;
      this.banner.set_style_class_name('bbcwx-link');
    } else {
      this.window.set_style('');
      // set style_class and _header visibility according to
      // global desklet settings for theme
      let dec = global.settings.get_int('desklet-decorations');
      switch(dec){
      case 0:
          this._header.hide();
          this.window.set_style_class_name('desklet');
          break;
      case 1:
          this._header.hide();
          this.window.set_style_class_name('desklet-with-borders');
          break;
      case 2:
          this._header.show();
          this.window.set_style_class_name('desklet-with-borders-and-header');
          break;
      }
      this.banner.style='font-size: '+BBCWX_LINK_TEXT_SIZE*this.zoom+"px;";
      this.bannerpre.style='font-size: '+BBCWX_LINK_TEXT_SIZE*this.zoom+"px;";
    }
    this._separatorArea.height=5*this.zoom;

    for(let f=0;f<this.no;f++) {
      this.labels[f].style='text-align : center;font-size: '+BBCWX_TEXT_SIZE*this.zoom+"px";
      this.fwicons[f].height=BBCWX_ICON_HEIGHT*this.zoom;this.fwicons[f].width= BBCWX_ICON_HEIGHT*this.iconprops.aspect*this.zoom;
      if(this.max[f]) this.max[f].style= 'text-align : center; font-size: '+BBCWX_TEXT_SIZE*this.zoom+"px";
      if(this.min[f]) this.min[f].style= 'text-align : center; font-size: '+BBCWX_TEXT_SIZE*this.zoom+"px";
      if(this.winds[f]) this.winds[f].style= 'text-align : center; font-size: '+BBCWX_TEXT_SIZE*this.zoom+"px";
      if(this.windd[f]) this.windd[f].style= 'text-align : center; font-size: '+BBCWX_TEXT_SIZE*this.zoom+"px";
      if(this.fpressure[f]) this.fpressure[f].style= 'text-align : center; font-size: '+BBCWX_TEXT_SIZE*this.zoom+"px";
      if(this.fhumidity[f]) this.fhumidity[f].style= 'text-align : center; font-size: '+BBCWX_TEXT_SIZE*this.zoom+"px";
    }

    this.buttons.style="padding-top:"+BBCWX_BUTTON_PADDING*this.zoom+"px;padding-bottom:"+BBCWX_BUTTON_PADDING*this.zoom+"px";

    this.iconbutton.icon_size=BBCWX_REFRESH_ICON_SIZE*this.zoom;

    let forecastlabels = ['maxlabel', 'minlabel', 'windlabel', 'winddlabel', 'fpressurelabel', 'fhumiditylabel'];
    for (let i = 0; i<forecastlabels.length; i++) {
      if (this[forecastlabels[i]]) this[forecastlabels[i]].style = 'text-align : right;font-size: '+BBCWX_LABEL_TEXT_SIZE*this.zoom+"px";
    }

    this.cweather.style='padding: ' + BBCWX_CONTAINER_PADDING*this.zoom+'px';
    if (this.vertical==1) {
      // loose the top padding on container in vertical mode (too much space)
      this.container.style='padding: 0 ' + BBCWX_CONTAINER_PADDING*this.zoom+'px ' + BBCWX_CONTAINER_PADDING*this.zoom+'px ' + BBCWX_CONTAINER_PADDING*this.zoom+'px ' ;
    } else {
      this.container.style='padding: ' + BBCWX_CONTAINER_PADDING*this.zoom+'px';
    }

  },

  ////////////////////////////////////////////////////////////////////////////
  // Update the forecast, without changing layout or styling
  updateForecast: function() {
    this._refreshweathers();
  },

  ////////////////////////////////////////////////////////////////////////////
  // Change the location we are displaying weather for
  changeStation: function() {
    this.service.setStation(this.stationID);
    this._refreshweathers();
  },

  ////////////////////////////////////////////////////////////////////////////
  // Change the API key and reget weather data
  changeApiKey: function() {
    this.service.setApiKey(this.apikey);
    this._refreshweathers();
  },

  ////////////////////////////////////////////////////////////////////////////
  // Change the refresh period and restart the loop
  changeRefresh: function() {
    this._setDerivedValues();
    this._doLoop();
  },

  ////////////////////////////////////////////////////////////////////////////
  // Called when there is a change to user config for parameters to display
  displayOptsChange: function() {
    this.redrawNeeded = true;
    this.redraw();
  },

  ////////////////////////////////////////////////////////////////////////////
  // redraw the window, but without refetching data from the service provider
  redraw: function() {
    this._setDerivedValues();
    this._createWindow();
    this._update_style();
    this.displayCurrent();
    this.displayForecast();
    this.displayMeta();
  },

  ////////////////////////////////////////////////////////////////////////////
  // update the data from the service and start the timeout to the next update
  // refreshData will call the display* functions
  _refreshweathers: function() {
    let now=new Date().toLocaleFormat('%H:%M:%S');
    global.log("bbcwx (instance " + this.desklet_id + "): refreshing forecast at " + now);



    // pass this to refreshData as it needs to call display* functions once the data
    // is updated
    this.service.refreshData(this);

    this._doLoop();
  },

  ////////////////////////////////////////////////////////////////////////////
  // Begin / restart the main loop, waiting for refreshSec before updating again
  _doLoop: function() {
    if(typeof this._timeoutId !== 'undefined') {
      Mainloop.source_remove(this._timeoutId);
    }

    this._timeoutId=Mainloop.timeout_add_seconds(Math.round(this.refreshSec * (0.9 + Math.random()*0.2)),Lang.bind(this, this.updateForecast));
  },

  ////////////////////////////////////////////////////////////////////////////
  // Update the display of the forecast data
  displayForecast: function() {
    //global.log("bbcwx (instance " + this.desklet_id + "): entering displayForecast");
    for(let f=0;f<this.no;f++)
    {
      let day = this.service.data.days[f];
      this.labels[f].label=((this.daynames[day.day]) ? this.daynames[day.day] : '');
      let fwiconimage = this._getIconImage(day.icon, BBCWX_ICON_HEIGHT*this.zoom);
      //fwiconimage.set_size(BBCWX_ICON_HEIGHT*this.iconprops.aspect*this.zoom, BBCWX_ICON_HEIGHT*this.zoom);
      this.fwicons[f].set_child(fwiconimage);
      //## Message if we fail to get weather data
      this.wxtooltip[f].set_text(((day.weathertext) ? _(day.weathertext) : _('No data available')));
      if(this.max[f]) this.max[f].text=this._formatTemperature(day.maximum_temperature, true);
      //if(this.max[f]) { this.max[f].text=this._formatTemperature(day.maximum_temperature, true); } else { this.max[f].text=''}
      if(this.min[f]) this.min[f].text=this._formatTemperature(day.minimum_temperature, true);
      if(this.winds[f]) this.winds[f].text=this._formatWindspeed(day.wind_speed, true);
      if(this.windd[f]) this.windd[f].text= ((day.wind_direction) ? day.wind_direction : '');
      if(this.fpressure[f]) this.fpressure[f].text=this._formatPressure(day.pressure, '', true);
      if(this.fhumidity[f]) this.fhumidity[f].text=this._formatHumidity(day.humidity, true);
    }
  },

  ////////////////////////////////////////////////////////////////////////////
  // Update the display of the current observations
  displayCurrent: function(){
    let cc = this.service.data.cc;
    if (this.cwicon) {
      let cwimage=this._getIconImage(this.service.data.cc.icon, BBCWX_CC_ICON_HEIGHT*this.zoom);
      //cwimage.set_size(BBCWX_CC_ICON_HEIGHT*this.iconprops.aspect*this.zoom, BBCWX_CC_ICON_HEIGHT*this.zoom);
      this.cwicon.set_child(cwimage);
    }
    if (this.shifttemp) {
      if (this.weathertext) this.weathertext.text = ((cc.weathertext) ? cc.weathertext : '');
      this.currenttemp.text = this._formatTemperature(cc.temperature, true) ;
    } else {
      if (this.weathertext) this.weathertext.text = ((cc.weathertext) ? cc.weathertext : '') + ((cc.temperature && cc.weathertext) ? ', ' : '' )+ this._formatTemperature(cc.temperature, true) ;
    }

    if (this.humidity) this.humidity.text= this._formatHumidity(cc.humidity);
    if (this.pressure) this.pressure.text=this._formatPressure(cc.pressure, cc.pressure_direction, true);
    if (this.windspeed) this.windspeed.text=((cc.wind_direction) ? cc.wind_direction : '') + ((cc.wind_direction && typeof cc.wind_speed !== 'undefined' && cc.wind_speed !== null) ? ', ' : '' ) + this._formatWindspeed(cc.wind_speed, true);
    if (this.feelslike) this.feelslike.text=this._formatTemperature(cc.feelslike, true);
    if (this.visibility) this.visibility.text=this._formatVisibility(cc.visibility, true);
    if (this.service.data.status.cc != BBCWX_SERVICE_STATUS_OK && this.weathertext) {
      this.weathertext.text = (this.service.data.status.lasterror) ? _('Error: %s').format(this.service.data.status.lasterror) : _('No data') ;
    }
  },

  ////////////////////////////////////////////////////////////////////////////
  // Update the display of the meta data, eg city name, link tooltip. Handles
  // managing reverse geocode lookups from Yahoo or Google if needed
  displayMeta: function() {
    let locsrc = this.locsrc;
    if (this.manuallocation.toString().length) locsrc = 'manual'

    this.displaycity = '';
    this.tooltiplocation = '';

    if (locsrc == 'manual') {
      this.displaycity=this.manuallocation;
      this.tooltiplocation = this.manuallocation
    } else {
      // if city name from service is empty, use wgs84, or stationID
      if (!this.service.data.city.toString().length) {
        if (this.service.capabilities.meta.wgs84 && this.service.data.status.meta == BBCWX_SERVICE_STATUS_OK) {
          // If city name is empty and source is 'service', we'll look it up with Google!
          if (locsrc == 'service') locsrc = 'google';
          this.displaycity=this.service.data.wgs84.lat + ',' + this.service.data.wgs84.lon;
          this.tooltiplocation = this.service.data.wgs84.lat + ',' + this.service.data.wgs84.lon;
        } else {
          this.displaycity = this.stationID;
          this.tooltiplocation = this.stationID;
        }
      } else {
        // initially set the displayed location to that from the data service,
        // if available. Google / Yahoo lookups we'll do asyncronously later
        this.displaycity=this.service.data.city;
        this.tooltiplocation = this.service.data.city;
        if (this.show.meta.country) {
          this.displaycity += ', ' + this.service.data.country;
        }
      }
    }

    // initial update (Google/Yahoo to follow)
    this._updateLocationDisplay();

    if (this.service.linkIcon) {
      let bannericonimage = this._getIconImage(this.service.linkIcon.file, this.service.linkIcon.height*this.zoom, this.service.linkIcon.width*this.zoom, false);
      //bannericonimage.set_size(this.service.linkIcon.width*this.zoom, this.service.linkIcon.height*this.zoom);
      this.bannericon.set_child(bannericonimage);
    }
    this.banner.label = this.service.linkText;


    try {
      if (this.bannersig) this.banner.disconnect(this.bannersig);
      if (this.cwiconsig && this.cwicon) this.cwicon.disconnect(this.cwiconsig);
      this.bannersig = null;
      this.cwiconsig = null;
    } catch(e) { global.logWarning("Failed to disconnect signal from link banner") }
    this.bannersig = this.banner.connect('clicked', Lang.bind(this, function() {
        Util.spawnCommandLine("xdg-open " + this.service.linkURL );
    }));
    if (this.cwicon) {
        this.cwiconsig = this.cwicon.connect('clicked', Lang.bind(this, function() {
          Util.spawnCommandLine("xdg-open " + this.service.linkURL );
      }));
    }

    if (this.service.data.status.meta != BBCWX_SERVICE_STATUS_OK) {
      this.cityname.text = (this.service.data.status.lasterror) ? _('Error: %s').format(this.service.data.status.lasterror) : _('No data') ;
    }

    // do async lookup of location with yahoo or google
    else if (this.service.capabilities.meta.wgs84 && (locsrc == 'yahoo' || locsrc == 'google')) {
      let latlon = this.service.data.wgs84.lat + ',' + this.service.data.wgs84.lon;
      // check the cache
      if (typeof this._geocache[locsrc][latlon] === 'object' && typeof this._geocache[locsrc][latlon].city !== 'undefined') {
        // debugging
        //global.log ("bbcwx: geocache hit for " + latlon + ", " + locsrc + ": " + this._geocache[locsrc][latlon].city);
        this.displaycity = this._geocache[locsrc][latlon].city;
        this.tooltiplocation = this.displaycity
        if (this.show.meta.country) {
          if (this._geocache[locsrc][latlon].country !== 'undefined') this.displaycity += ', ' + this._geocache[locsrc][latlon].country;
        }
        this._updateLocationDisplay();
      // no cache - lookup
      } else {
        // debugging
        //global.log ("bbcwx: Looking up city for " + latlon + " at " + locsrc);
        let b = this._getGeo(locsrc, function(geo, locsrc) {
          if (geo) {
            this._load_geo(geo, locsrc);
            this._updateLocationDisplay();
          }
        });
      }
    }
  },

  ////////////////////////////////////////////////////////////////////////////
  // Update the display of city name and link tooltip
  _updateLocationDisplay: function() {
    this.cityname.text=this.displaycity;
    //## %s is replaced by place name
    let linktooltip = _('Click for the full forecast for %s').format(this.tooltiplocation)
    this.bannertooltip.set_text(linktooltip);
    if (this.cwicontooltip) this.cwicontooltip.set_text(linktooltip);
  },

  ////////////////////////////////////////////////////////////////////////////
  // Do async reverse geocode lookups at Yahoo! or Google
  // -> locsrc: which service to use: either 'yahoo' or 'google'
  // -> callback: callback function to process returned results
  // NB Yahoo service no longer available :(
  _getGeo: function( locsrc, callback) {
    // just use the most preferred language and hope Yahoo! / Google  supports it
    let locale = LangList[0];
    let url = '';
    if (locsrc == 'yahoo') {
      url = 'http://query.yahooapis.com/v1/public/yql?q=select%20*%20from%20geo.placefinder%20where%20text%3D%22' + this.service.data.wgs84.lat + '%2C' + this.service.data.wgs84.lon +'%22%20and%20gflags%3D%22R%22%20and%20locale%3D%22' + locale + '%22&format=json&callback=';
    } else if (locsrc == 'google') {
      url = 'https://maps.googleapis.com/maps/api/geocode/json?latlng=' + this.service.data.wgs84.lat + '%2C' + this.service.data.wgs84.lon + '&language=' + locale;
    } else {
      // set some error flag?
      return;
    }
    //debugging
    //global.log('bbcwx: geo, calling ' + url);
    var here = this;
    let message = Soup.Message.new('GET', url);
    _httpSession.timeout = 10;
    _httpSession.idle_timeout = 10;
    _httpSession.queue_message(message, function (session, message) {
      if( message.status_code == 200) {
        try {callback.call(here,message.response_body.data.toString(),locsrc);} catch(e) {global.logError(e)}
      } else {
        global.logWarning("Error retrieving address " + url + ". Status: " + message.status_code + ": " + message.reason_phrase);
        //here.data.status.lasterror = message.status_code;
        callback.call(here,false,locsrc);
      }
    });
  },

  ///////////////////////////////////////////////////////////////////////////
  // Call back function to process returned object from reverse geocode lookups
  // Wraper around _load_geo_yahoo and _load_geo_google
  // -> data: returned data
  // -> locsrc: the service it came from, 'yahoo' or 'google'
  _load_geo: function(data, locsrc) {
    switch(locsrc) {
      case 'google':
        this._load_geo_google(data);
        break;
      case 'yahoo':
        this._load_geo_yahoo(data);
        break;
      default:
        this._load_geo_yahoo(data);
    }
  },

  ///////////////////////////////////////////////////////////////////////////
  // Call back function to process returned object from reverse geocode lookups
  // from Yahoo!
  _load_geo_yahoo: function (data) {
    if (!data) {
      //this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }

    let json = JSON.parse(data);
    let latlon = this.service.data.wgs84.lat + ',' + this.service.data.wgs84.lon;
    this._geocache.yahoo[latlon] = new Object();

    try {
      let geo = json.query.results.Result;
      this.displaycity = geo.city;
      this.tooltiplocation = this.displaycity;
      if (this.show.meta.country) {
        this.displaycity += ', ' + geo.country;
      }

      this._geocache.yahoo[latlon].city = geo.city;
      this._geocache.yahoo[latlon].country = geo.country;
    } catch(e) {
      global.logError(e);
      delete this._geocache.yahoo[latlon]
      //this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
    }
  },

  ///////////////////////////////////////////////////////////////////////////
  // Call back function to process returned object from reverse geocode lookups
  // from Google
  _load_geo_google: function (data) {
    if (!data) {
      //this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }
    let city = '';
    let country = '';
    let geo = new Object();
    let addrtypes = [ 'xlocality', 'xstreetaddr', 'xpostal_code', 'administrative_area_level_3', 'administrative_area_level_2', 'administrative_area_level_1', 'xcountry'];
    for (let a=0; a<addrtypes.length; a++) {
      geo[addrtypes[a]] = new Object();
    }


    let json = JSON.parse(data);

    let latlon = this.service.data.wgs84.lat + ',' + this.service.data.wgs84.lon;
    this._geocache.google[latlon] = new Object();

    try {
      let results = json.results;
      for (let i=0; i<results.length; i++) {
        for (let t=0; t<results[i].types.length; t++) {
          if (results[i].types[t] == 'administrative_area_level_3') {
            geo.administrative_area_level_3 = results[i];
          }
          if (results[i].types[t] == 'administrative_area_level_2') {
            geo.administrative_area_level_2 = results[i];
          }
          if (results[i].types[t] == 'administrative_area_level_1') {
            geo.administrative_area_level_1 = results[i];
          }
          if (results[i].types[t] == 'country') {
            geo.xcountry = results[i];
          }
          if (results[i].types[t] == 'locality') {
            geo.xlocality = results[i];
          }
          if (results[i].types[t] == 'street_address') {
            geo.xstreetaddr = results[i];
          }
          if (results[i].types[t] == 'postal_code' && results[i].types.join().indexOf("postal_code_prefix") == -1) {
            geo.xpostal_code = results[i];
          }
        }
      }

      for (let a=0; a<addrtypes.length; a++) {
        if (typeof geo[addrtypes[a]].address_components !== "undefined" && (!city || !country)) {
          let components = geo[addrtypes[a]].address_components;
          for (let i=0; i<components.length; i++) {
            for (let t=0; t<components[i].types.length; t++) {
              if (components[i].types[t] == 'locality' && !city) {
                city = components[i].long_name;
              }
              if (components[i].types[t] == 'country' && !country) {
                country = components[i].long_name;
              }
            }
            if (!city) {
              for (let t=0; t<components[i].types.length; t++) {
                if (components[i].types[t] == addrtypes[a] && !city) {
                  city = components[i].long_name;
                }
              }
            }
          }
        }
        if (city && country) a = addrtypes.length;
      }

      if (city) {
        this.displaycity = city;
        this.tooltiplocation = this.displaycity;
        if (this.show.meta.country && country) {
          this.displaycity += ', ' + country;
        }
        this._geocache.google[latlon].city = city;
      }

      if (country) this._geocache.google[latlon].country = country;

    } catch(e) {
      global.logError(e);
      delete this._geocache.google[latlon]
      //this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
    }
  },

  ////////////////////////////////////////////////////////////////////////////
  // Get an icon
  // -> iconcode: the code of the icon
  // -> h: the base height of the icon
  // -> w: the base width of the icon. If not specified this is calculated from
  //       the iconsets 'aspect' property and h
  // -> adjust: boolean, whether to adjust h and w by the value of the iconsets
  //            adjust property
  _getIconImage: function(iconcode, h, w, adjust) {
    if (typeof h === 'undefined') h = BBCWX_ICON_HEIGHT;
    if (typeof w === 'undefined') w = false;
    if (typeof adjust === 'undefined') adjust = true;
    let icon_name = 'na';
    let icon_ext = '.' + this.iconprops.ext;
    if (iconcode) {
      icon_name = (typeof this.iconprops.map[iconcode] != 'undefined') ? this.iconprops.map[iconcode] : iconcode;
    }
    let height = h;
    let width = w ? w : h * this.iconprops.aspect;
    if (adjust) {
      height = height*this.iconprops.adjust;
      width = width*this.iconprops.adjust;
    }
    let icon_file = DESKLET_DIR + '/icons/' + this.iconstyle +'/' + icon_name + icon_ext;
    let file = Gio.file_new_for_path(icon_file);
    if (!file.query_exists(null)) {
      icon_name = (typeof this.defaulticonprops.map[iconcode] != 'undefined') ? this.defaulticonprops.map[iconcode] : iconcode;
      icon_file = DESKLET_DIR + '/icons/' + BBCWX_DEFAULT_ICONSET + '/' + icon_name + '.' + this.defaulticonprops.ext;
      width = w ? w : h * this.defaulticonprops.aspect;
      height = h;
      if (adjust) {
        height = height*this.defaulticonprops.adjust;
        width = width*this.defaulticonprops.adjust;
      }
      file = Gio.file_new_for_path(icon_file);
    }
    let icon_uri = file.get_uri();

    let iconimg = St.TextureCache.get_default().load_uri_async(icon_uri, width, height);
    iconimg.set_size(width, height);
    return iconimg;
  },

  setGravity: function() {
    if (this.experimental_enabled) {
      this.actor.move_anchor_point_from_gravity(this.gravity);
    } else {
      this.actor.move_anchor_point_from_gravity(0);
    }
  },

  doExperimental: function() {
    this.setGravity();
  },

  ////////////////////////////////////////////////////////////////////////////
  // take a temperature in C and convert as needed.
  // Append unit string if units is true
  _formatTemperature: function(temp, units) {
    units = typeof units !== 'undefined' ? units : false;
    if (typeof temp === 'undefined' || temp === null) return '';
    if (!temp.toString().length) return '';
    let celsius = 1*temp;
    let fahr = ((celsius + 40) * 1.8) - 40;
    let out = Math.round(((this.tunits=='F') ? fahr : celsius));
    //## Units for temperature, degrees Fahrenheit. %f is replaced the value. NB: English translation uses unicode character u+2109
    let fahrfmt = _('%fF');
    //## Units for temperature, degrees Celsius. %f is replaced the value. NB: English translation uses unicode character u+2103
    let celfmt = _('%fC')
    if (units) {
      out = ((this.tunits=='F') ? fahrfmt.format(out) : celfmt.format(out))
    }
    return out;
  },

  ////////////////////////////////////////////////////////////////////////////
  // take a wind speed in km/h and convert to required
  // units. Append unit string if units is true
  _formatWindspeed: function(wind, units) {
    units = typeof units !== 'undefined' ? units : false;
    if (typeof wind === 'undefined' || wind === null) return '';
    if (!wind.toString().length) return '';
    let conversion = {
      'mph': 0.621,
      'knots': 0.54,
      'kph': 1,
      'mps': 0.278
    };
    //## wind speed, miles per hour. %f is replaced by the value
    let mphfmt = _('%fmph');
    //## wind speed, knots. %f is replaced by the value
    let knotfmt = _('%fkn');
    //## wind speed, kilometers per hour. %f is replaced by the value
    let kphfmt = _('%fkm/h');
    //## wind speed, meters per second. %f is replaced by the value
    let mpsfmt = _('%fm/s');
    let unitstring = {
      'mph': mphfmt,
      'knots': knotfmt,
      'kph': kphfmt,
      'mps': mpsfmt
    }
    let kph = 1*wind;
    let out = kph * conversion[this.wunits];
    out = out.toFixed(0);
    if (units) {
      //out += unitstring[this.wunits];
      out = unitstring[this.wunits].format(out)
    }
    return out;
  },

  ////////////////////////////////////////////////////////////////////////////
  // take a pressure in mb and convert as needed. Append units and trajectory
  // -> pressure: real, pressure (in mb)
  // -> direction: string, direction of travel, or false
  // -> units: boolean, append units
  _formatPressure: function(pressure, direction, units) {
    units = typeof units !== 'undefined' ? units : false;
    direction = typeof direction !== 'undefined' ? direction : '';
    if (typeof pressure === 'undefined' || pressure === null) return '';
    if (!pressure.toString().length) return '';
    let conversion = {
      'mb': 1,
      'in': 0.02953,
      'mm': 0.75,
      'kpa': 0.1
    };
    //## pressure, millbars. %f is replaced by the value
    let mbfmt = _('%fmb');
    //## pressure, inches of mercury. %f is replaced by the value
    let infmt = _('%fin');
    //## pressure, mm of mercury. %f is replaced by the value
    let mmfmt = _('%fmm');
    //## pressure, kilopascals. %f is replaced by the value
    let kpafmt = _('%fkPa');
    let unitstring = {
      'mb': mbfmt,
      'in': infmt,
      'mm': mmfmt,
      'kpa': kpafmt
    };
    let precission = {
      'mb': 0,
      'in': 2,
      'mm': 0,
      'kpa' : 1
    };
    let mb = 1*pressure;
    let out = mb * conversion[this.punits];

    //### TODO prepare this for gettext
    out = out.toFixed(precission[this.punits]);
    if (units) {
      out = unitstring[this.punits].format(out);
    }
    if (direction) {
      out += ', ' + direction;
    }
    return out;
  },

  ////////////////////////////////////////////////////////////////////////////
  _formatHumidity: function(humidity) {
    if (!humidity.toString().length) return '';
    let out = 1*humidity
    out = out.toFixed(0)
    return out + '%';
  },

  ////////////////////////////////////////////////////////////////////////////
  // take a visibility and converts to the required format. Strings are returned
  // as such, numbers (assumed km) are converted. Append unit string if units is true
  _formatVisibility: function(vis, units) {
    units = typeof units !== 'undefined' ? units : false;
    if (typeof vis === 'undefined' || vis === null) return '';
    if (!vis.toString().length) return '';
    if (isNaN(vis)) return _(vis);
    // we infer the desired units from windspeed units
    let conversion = {
      'mph': 0.621,
      'knots': 0.54,
      'kph': 1,
      'mps': 1
    };
    //## visibility, miles. %f is replaced by the value
    let mifmt = _('%fmi');
    //## visibility, nautical miles. %f is replaced by the value
    let nmifmt = _('%fnmi');
    //## visibility, kilometers. %f is replaced by the value
    let kmfmt = _('%fkm');
    let unitstring = {
      'mph': mifmt,
      'knots': nmifmt,
      'kph': kmfmt,
      'mps': kmfmt
    }
    let km = 1*vis;
    let out = km * conversion[this.wunits];
    let decpl = (out < 4) ? 1 : 0;
    out = out.toFixed(decpl);
    if (units) {
      out = unitstring[this.wunits].format(out);
    }
    return out;
  },

  ////////////////////////////////////////////////////////////////////////////
  on_desklet_removed: function() {
    if(typeof this._timeoutId !== 'undefined') {
      Mainloop.source_remove(this._timeoutId);
    }
  }


};

////////////////////////////////////////////////////////////////////////////
//          ### DRIVERS FOR ACCESSING DIFFERENT WEBSERVICES ###
////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////
// a base driver class. This is overridden by drivers that actually do the work
function wxDriver(stationID, apikey) {
  this._init(stationID, apikey);
};

wxDriver.prototype = {
  // name of the driver
  drivertype: 'Base',
  // URL for credit link
  linkURL: '',
  // text for credit link
  linkText: '',

  linkIcon: false,
  // the maximum number of days of forecast supported
  // by this driver
  maxDays : 1,
  // API key for use in some services
  apikey: '',

  // minimum allowed interval between refreshes: refer to each service's
  // terms of service when setting specific values
  minTTL: 600,


  lang_map: {},

  ////////////////////////////////////////////////////////////////////////////
  // initialise
  _init: function(stationID, apikey) {
    apikey = (typeof apikey !== 'undefined') ? apikey : '';
    this.stationID = stationID;
    this.apikey = apikey;

    // a list of capabilities supported by the driver
    // we set them all to true here and expect any children
    // to disable those they don't support
    this.capabilities = {
      cc: {
        humidity: true,
        temperature: true,
        pressure: true,
        pressure_direction: true,
        wind_speed: true,
        wind_direction: true,
        obstime: true,
        weathertext: true,
        visibility: true,
        feelslike: true
      },
      forecast: {
        humidity: true,
        maximum_temperature: true,
        minimum_temperature: true,
        pressure: true,
        pressure_direction: true,
        wind_speed: true,
        wind_direction: true,
        weathertext: true,
        visibility: true,
        uv_risk: true
      },
      meta: {
        city: true,
        country: true,
        region: true,
        wgs84: true
      }
    };
    // ### TODO: if we later use visibility, we need to indicate if driver returns
    // a value (in km) or a descriptive string (good/fair/poor - BBC)

    this.data=new Object();
    this._emptyData();
    this.unitsInSummaries = false;
  },

  ////////////////////////////////////////////////////////////////////////////
  // create an empty data structure to be filled in by child drivers
  // numeric data returned should be values without units appended. The following units
  // should be used
  // Distance: km
  // Speed: km/h
  // Temperature: C
  // Pressure: mb / HPa
  // Visibility may be expressed either as a number of km or a descriptive string
  // Wind direction should be a 16 point compass bearing, eg SSW
  // Day names should be English three letter abbreviations, eg Mon, Tue
  _emptyData: function() {
    this.data.city = '';
    this.data.country = '';
    this.data.wgs84 = new Object();
    this.data.wgs84.lat = null;
    this.data.wgs84.lon = null;

    this.data.days=[];

    // the status of the service request
    delete this.data.status;
    this.data.status = new Object();
    // 1: waiting; 2: success; 0; failed/error
    this.data.status.cc = BBCWX_SERVICE_STATUS_INIT;
    this.data.status.forecast = BBCWX_SERVICE_STATUS_INIT;
    this.data.status.meta = BBCWX_SERVICE_STATUS_INIT;
    this.data.status.lasterror = false;

    // current conditions
    delete this.data.cc;
    this.data.cc = new Object();
    this.data.cc.wind_direction = '';
    this.data.cc.wind_speed = '';
    this.data.cc.pressure = '';
    this.data.cc.pressure_direction = '';
    this.data.cc.temperature = '';
    this.data.cc.humidity = '';
    this.data.cc.visibility = '';
    this.data.cc.obstime = '';
    this.data.cc.weathertext = '';
    this.data.cc.icon = '';
    this.data.cc.feelslike = '';

    // forecast
    for(let i=0; i<this.maxDays; i++) {
      let day = new Object();
      day.day = '';
      day.weathertext = '';
      day.icon = '';
      day.maximum_temperature ='';
      day.minimum_temperature = '';
      day.wind_direction = '';
      day.wind_speed = '';
      day.visibility = '';
      day.pressure = '';
      day.humidity = '';
      day.uv_risk = '';
      day.pollution = '';
      day.sunrise = '';
      day.sunset = '';
      delete this.data.days[i];
      this.data.days[i] = day;
    };
  },

  ////////////////////////////////////////////////////////////////////////////
  // change the stationID
  setStation: function(stationID) {
    this.stationID = stationID;
  },

  ////////////////////////////////////////////////////////////////////////////
  // change the apikey
  setApiKey: function(apikey) {
    this.apikey = apikey;
  },

  ////////////////////////////////////////////////////////////////////////////
  // for debugging. Log the driver type
  showType: function() {
    global.log('Using driver type: ' + this.drivertype);
  },

  ////////////////////////////////////////////////////////////////////////////
  // async call to retrieve the data.
  // -> url: url to call
  // -> callback: callback function to which the retrieved data is passed
  _getWeather: function(url, callback) {
    //debugging
    //global.log('bbcwx: calling ' + url);
    var here = this;
    let message = Soup.Message.new('GET', url);
    _httpSession.timeout = 10;
    _httpSession.idle_timeout = 10;
    _httpSession.queue_message(message, function (session, message) {
      if( message.status_code == 200) {
        try {callback.call(here,message.response_body.data.toString());} catch(e) {global.logError(e)}
      } else {
        global.logWarning("Error retrieving address " + url + ". Status: " + message.status_code + ": " + message.reason_phrase);
        here.data.status.lasterror = message.status_code;
        callback.call(here,false);
      }
    });
  },

  // stub function to be overridden by child classes. deskletObj is a reference
  // to the main object. It is passed to allow deskletObj.displayForecast()
  // deskletObj.displayMeta() and deskletObj.displayCurrent() to be called from
  // within callback functions.
  refreshData: function(deskletObj) {
  },

  ////////////////////////////////////////////////////////////////////////////
  // Utility function to translate direction in degrees into 16 compass points
  compassDirection: function(deg) {
    //## Next 16 strings are for wind direction, compass points
    let directions = [_('N'), _('NNE'),_('NE'), _('ENE'),_('E'), _('ESE'),_('SE'),_('SSE'), _('S'),_('SSW'), _('SW'), _('WSW'),_('W'),_('WNW'), _('NW'),_('NNW')];
    return directions[Math.round(deg / 22.5) % directions.length];
  },

  ////////////////////////////////////////////////////////////////////////////
  // Get the service specific language code that best serves the current locale
  getLangCode: function() {
    let lang_list = LangList;
    let lang = '';
    for (let i=0; i<lang_list.length; i++) {
      if (lang_list[i] != 'C') {
        if (lang_list[i] && (typeof this.lang_map[lang_list[i].toLowerCase()] !== "undefined")) {
          lang = this.lang_map[lang_list[i].toLowerCase()];
          i = lang_list.length;
        }
      }
    }
    // debugging
    // global.log("bbcwx: lang_list: " + lang_list.join() + "; lang: " + lang);
    return lang;
  },

  _getDayName: function(i) {
    // handle Glib days, which use 1 based numbering starting with Mon
    // all the same except Sun is 7, not 0
    if (i == 7) { i = 0; }
    let days = ['Sun','Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[i];
  },

  _minArr: function(arr) {
    return arr.reduce(function (p, v) {
      return ( p < v ? p : v );
    });
  },

  _maxArr: function(arr) {
    return arr.reduce(function (p, v) {
      return ( p > v ? p : v );
    });
  },

  _avgArr: function(arr) {
    return arr.reduce(function (p, v) {
      return p + v;
    }) / arr.length;
  },

  ////////////////////////////////////////////////////////////////////////////
  // Utility to get a localised weather text string from a Yahoo/TWC code. This
  // function is here because both the Yahoo and TWC drivers use it
  _getWeatherTextFromYahooCode: function(code) {
    let wxtext = '';
    let textmap = {
      '0' : _('Tornado'),
      '1' : _('Tropical storm'),
      '2' : _('Hurricane'),
      '3' : _('Severe thunderstorms'),
      '4' : _('Thunderstorms'),
      '5' : _('Mixed rain and snow'),
      '6' : _('Mixed rain and sleet'),
      '7' : _('Mixed snow and sleet'),
      '8' : _('Freezing drizzle'),
      '9' : _('Drizzle'),
      '10' : _('Freezing rain'),
      '11' : _('Showers'),
      '12' : _('Showers'),
      '13' : _('Snow flurries'),
      '14' : _('Light snow showers'),
      '15' : _('Blowing snow'),
      '16' : _('Snow'),
      '17' : _('Hail'),
      '18' : _('Sleet'),
      '19' : _('Dust'),
      '20' : _('Foggy'),
      '21' : _('Haze'),
      '22' : _('Smoky'),
      '23' : _('Blustery'),
      '24' : _('Windy'),
      '25' : _('Cold'),
      '26' : _('Cloudy'),
      '27' : _('Mostly cloudy'),
      '28' : _('Mostly cloudy'),
      '29' : _('Partly cloudy'),
      '30' : _('Partly cloudy'),
      '31' : _('Clear'),
      '32' : _('Sunny'),
      '33' : _('Fair'),
      '34' : _('Fair'),
      '35' : _('Mixed rain and hail'),
      '36' : _('Hot'),
      '37' : _('Isolated thunderstorms'),
      '38' : _('Scattered thunderstorms'),
      '39' : _('Scattered showers'),  // see http://developer.yahoo.com/forum/YDN-Documentation/Yahoo-Weather-API-Wrong-Condition-Code/1290534174000-1122fc3d-da6d-34a2-9fb9-d0863e6c5bc6
      '40' : _('Scattered showers'),
      '41' : _('Heavy snow'),
      '42' : _('Scattered snow showers'),
      '43' : _('Heavy snow'),
      '44' : _('Partly cloudy'),
      '45' : _('Thundershowers'),
      '46' : _('Snow showers'),
      '47' : _('Isolated thundershowers'),
      '3200' : _('Not available')
    }
    if (code && typeof textmap[code] !== "undefined") {
      wxtext = textmap[code];
    }
    return wxtext;
  }
};

////////////////////////////////////////////////////////////////////////////
// ### Driver for the BBC
function wxDriverBBC(stationID) {
  this._bbcinit(stationID);
};

wxDriverBBC.prototype = {
  __proto__: wxDriver.prototype,

  drivertype: 'BBC',
  maxDays: 3,
  linkText: 'www.bbc.co.uk/weather',

  // these will be dynamically reset when data is loaded
  linkURL: 'https://www.bbc.co.uk/weather/',

  _baseURL: 'https://weather-broker-cdn.api.bbci.co.uk/en/',

  // initialise the driver
  _bbcinit: function(stationID) {
    this._init(stationID);
    this.capabilities.meta.region =  false;
    this.capabilities.cc.feelslike = false;
    this.capabilities.cc.obstime = false;
  },

  refreshData: function(deskletObj) {
    // reset the data object
    this._emptyData();
    this.linkURL = 'https://www.bbc.co.uk/weather';

    // process the three day forecast
    let a = this._getWeather(this._baseURL + 'forecast/rss/3day/' + this.stationID, function(weather) {
      if (weather) {
        this._load_forecast(weather);
      }
      // get the main object to update the display
      deskletObj.displayForecast();
      deskletObj.displayMeta();
    });

    // process current observations
    let b = this._getWeather(this._baseURL + 'observation/rss/' + this.stationID, function(weather) {
      if (weather) {
        this._load_observations(weather);
      }
      // get the main object to update the display
      deskletObj.displayCurrent();
    });

  },

  // process the rss for a 3dayforecast and populate this.data
  _load_forecast: function (rss) {
    if (!rss) {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }
    let days = [];

    let parser = new Marknote.marknote.Parser();
    let doc = parser.parse(rss);
    if (!doc)  {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }
    try {
      let rootElem = doc.getRootElement();
      let channel = rootElem.getChildElement("channel");
      let location = channel.getChildElement("title").getText().split("Forecast for")[1].trim();
      this.data.city = location.split(',')[0].trim();
      this.data.country = location.split(',')[1].trim();
      this.linkURL = channel.getChildElement("link").getText();
      let items = channel.getChildElements("item");
      let geo = items[0].getChildElement("georss:point").getText();
      this.data.wgs84.lat = geo.split(' ')[0].trim();
      this.data.wgs84.lon = geo.split(' ')[1].trim();
      let desc, title;

      for (let i=0; i<items.length; i++) {
        let data = new Object();
        desc = items[i].getChildElement("description").getText();
        title = items[i].getChildElement("title").getText();
        data.link = items[i].getChildElement("link").getText();
        data.day = title.split(':')[0].trim().substring(0,3);
        let weathertext = title.split(':')[1].split(',')[0].trim();
        let parts = desc.split(',');
        let k, v;
        for (let b=0; b<parts.length; b++) {
          k = parts[b].slice(0, parts[b].indexOf(':')).trim().replace(' ', '_').toLowerCase();
          v = parts[b].slice(parts[b].indexOf(':')+1).trim();
          if (v.substr(0,4).toLowerCase() == 'null') v = '';
          if (k == "wind_direction" && v != '') {
            let vparts = v.split(" ");
            v = '';
            for (let c=0; c<vparts.length; c++) {
              v += vparts[c].charAt(0).toUpperCase();
            }
          }
          data[k] = v;
        }
        data.maximum_temperature = this._getTemperature(data.maximum_temperature);
        data.minimum_temperature = this._getTemperature(data.minimum_temperature);
        data.wind_speed = this._getWindspeed(data.wind_speed);
        data.wind_direction = _(data.wind_direction);
        data.pressure = data.pressure.replace('mb', '');
        data.humidity = data.humidity.replace('%', '');
        data.icon = this._getIconFromText(weathertext);
        data.weathertext = _(weathertext);
        this.data.days[i] = data;
      }
      this.data.status.forecast = BBCWX_SERVICE_STATUS_OK;
      this.data.status.meta = BBCWX_SERVICE_STATUS_OK;
    } catch(e) {
      global.logError(e);
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
    }
  },

  // take an rss feed of current observations and extract data into this.data
  _load_observations: function (rss) {
    if (!rss) {
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }
    let parser = new Marknote.marknote.Parser();
    let doc = parser.parse(rss);
    if (!doc) {
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }
    try {
      let rootElem = doc.getRootElement();
      let channel = rootElem.getChildElement("channel");
      let item = channel.getChildElement("item");
      let desc = item.getChildElement("description").getText();
      let title = item.getChildElement("title").getText();
      desc = desc.replace('mb,', 'mb|');
      this.data.cc.weathertext = title.split(':')[2].split(',')[0].trim();
      if ((this.data.cc.weathertext.toLowerCase() == 'null') || (this.data.cc.weathertext.includes('Not available'))) this.data.cc.weathertext = '';
      let parts = desc.split(',');
      for (let b=0; b<parts.length; b++) {
        let k, v;
        k = parts[b].slice(0, parts[b].indexOf(':')).trim().replace(' ', '_').toLowerCase();
        v = parts[b].slice(parts[b].indexOf(':')+1).trim();
        if (v.substr(0,4).toLowerCase() == 'null') v = '';
        if (k == 'wind_direction' && v != '') {
          let vparts = v.split(" ");
          v = '';
          for (let c=0; c<vparts.length; c++) {
            v += vparts[c].charAt(0).toUpperCase();
          }
        }
        if (k == 'pressure' && v != '') {
          let pparts=v.split('|');
          v = pparts[0].trim();
          this.data.cc.pressure_direction = _(pparts[1].trim());
        }
        this.data.cc[k] = v;
      }
      this.data.cc.icon = this._getIconFromText(this.data.cc.weathertext);
      this.data.cc.weathertext = _(this.data.cc.weathertext);
      this.data.cc.temperature = this._getTemperature(this.data.cc.temperature);
      this.data.cc.wind_speed = this._getWindspeed(this.data.cc.wind_speed);
      this.data.cc.wind_direction = _(this.data.cc.wind_direction);
      this.data.cc.humidity = this.data.cc.humidity.replace('%', '').replace('-- ', '');
      this.data.cc.pressure = this.data.cc.pressure.replace('mb', '').replace('-- ', '');
      this.data.status.cc = BBCWX_SERVICE_STATUS_OK;
    } catch(e) {
      global.logError(e);
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
    }
  },

  _getIconFromText: function(wxtext) {
    let icon_name = 'na';
    let iconmap = {
      'clear sky' : '31', //night
      'sunny' : '32',
      'partly cloudy' : '29',  //night
      'sunny intervals' : '30',
      'sand storm' : '19', // not confirmed
      'mist' : '20',
      'fog' : '20',
      'white cloud' : '26',
      'light cloud' : '26',
      'grey cloud' : '26d',
      'thick cloud' : '26d',
      'light rain shower' : '39',
      'light rain showers' : '39',
      'drizzle' : '09',
      'light rain' : '11',
      'heavy rain shower' : '39',
      'heavy rain showers' : '39',
      'heavy rain' : '12',
      'sleet shower' : '07',
      'sleet showers' : '07',
      'sleet' : '07',
      'light snow shower' : '41',
      'light snow showers' : '41',
      'light snow' : '13',
      'heavy snow shower' : '41',
      'heavy snow showers' : '41',
      'heavy snow' : '16',
      'thundery shower' : '37',
      'thundery showers' : '37',
      'thunder storm' : '04',
      'thunderstorm' : '04',
      'hazy' : '22',
      'hail shower': '18',
      'hail showers': '18'
    }
    if (wxtext) {
      wxtext = wxtext.toLowerCase();
      if (typeof iconmap[wxtext] !== "undefined") {
        icon_name = iconmap[wxtext];
      }
    }
    return icon_name;
  },

  _getTemperature: function(temp) {
    if (!temp) return '';
    let celsius = temp.slice(0, temp.indexOf('C')-1).trim();
    if (isNaN(celsius)) return '';
    return celsius;
  },

  _getWindspeed: function(wind) {
    if (!wind) return '';
    let mph = wind.replace('mph', '');
    if (isNaN(mph)) return '';
    let out = mph * 1.6;
    return out;
  },

  // dummy function that exists just to list the strings
  // for translation
  _dummy: function() {
    let a =[
      _('Clear Sky'),
      _('Sunny'),
      _('Partly Cloudy'),
      _('Sunny Intervals'),
      _('Sand Storm'),
      _('Mist'),
      _('Fog'),
      _('White Cloud'),
      _('Light Cloud'),
      _('Grey Cloud'),
      _('Thick Cloud'),
      _('Light Rain Shower'),
      _('Drizzle'),
      _('Light Rain'),
      _('Heavy Rain Shower'),
      _('Heavy Rain'),
      _('Sleet Shower'),
      _('Sleet'),
      _('Light Snow Shower'),
      _('Light Snow'),
      _('Heavy Snow Shower'),
      _('Heavy Snow'),
      _('Thundery Shower'),
      _('Thunder Storm'),
      _('Thunderstorm'),
      _('Hazy'),
      _('Hail Shower'),
      _('Rain')             // not currently used;
    ];
  }

};

////////////////////////////////////////////////////////////////////////////
// ### Driver for Yahoo! Weather
// This driver no longer works - Yahoo now require OAuth
function wxDriverYahoo(stationID) {
  this._yahooinit(stationID);
};

wxDriverYahoo.prototype = {
  __proto__: wxDriver.prototype,

  drivertype: 'Yahoo',
  maxDays: 5,
  linkText: 'Yahoo! Weather',

  // these will be dynamically reset when data is loaded
  linkURL: 'https://weather.yahoo.com',

  _baseURL: 'https://weather.yahooapis.com/forecastrss?u=c&w=',

  // initialise the driver
  _yahooinit: function(stationID) {
    this._init(stationID);
    this.capabilities.forecast.wind_direction =  false;
    this.capabilities.forecast.wind_speed =  false;
    this.capabilities.forecast.pressure =  false;
    this.capabilities.forecast.pressure_direction =  false;
    this.capabilities.forecast.visibility =  false;
    this.capabilities.forecast.uv_risk =  false;
    this.capabilities.forecast.humidity =  false;
    this.capabilities.cc.visibility = false;
    this._woeidcache = new Object();
    this._isEnglish = LangList[0].substr(0,2).toLowerCase() == 'en' ? true : false;
  },

  // for the yahoo driver, this is a wrapper around _refreshData. This is needed in order
  // to get the yahoo WOEID if this.stationID has been provided as lat,lon
  refreshData: function(deskletObj) {
    // reset the data object
    this._emptyData();
    this.linkURL = 'http://weather.yahoo.com/';

    // lat,lon location
    if (this.stationID.search(/^\-?\d+(\.\d+)?,\-?\d+(\.\d+)?$/) == 0) {
      if (typeof this._woeidcache[this.stationID] === 'object') {
        //global.log ("bbcwx: woeidcache hit for " + this.stationID + ": " + this._woeidcache[this.stationID].woeid);
        this._woeid = this._woeidcache[this.stationID].woeid;
        this._refreshData(deskletObj);
      } else {
        // look up the WOEID from geo.placefinder YQL table. Async lookup with _refreshData
        // in call back to ensure WOEID is available before it is called
        let latlon = this.stationID.split(',')
        let geourl = 'http://query.yahooapis.com/v1/public/yql?q=select%20*%20from%20geo.placefinder%20where%20text%3D%22' + latlon[0] + '%2C' + latlon[1] +'%22%20and%20gflags%3D%22R%22&format=json&callback=';
        let a = this._getWeather(geourl, function(geo) {
          if (geo) {
            let ok = this._load_woeid(geo);
            if (ok) {
              this._refreshData(deskletObj);
            } else {
              deskletObj.displayCurrent();
              deskletObj.displayMeta();
              deskletObj.displayForecast();
            }
          } else {
            this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
            this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
            this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
            this.data.status.lasterror = "Could not resolve location";
            deskletObj.displayCurrent();
            deskletObj.displayMeta();
            deskletObj.displayForecast();
          }
        });
      }
    // unrecognised - not a numeric WOEID
    } else if (this.stationID.search(/^\d+$/) !=0) {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.lasterror = "Invalid location format";
      deskletObj.displayForecast();
      deskletObj.displayMeta();
      deskletObj.displayCurrent();
      return;
    // looks like a WOEID
    } else {
      this._woeid = this.stationID;
      this._refreshData(deskletObj);
    }

  },

  _refreshData: function(deskletObj) {
    // get the forecast
    let a = this._getWeather(this._baseURL + encodeURIComponent(this._woeid), function(weather) {
      if (weather) {
        this._load_forecast(weather);
      }
      // get the main object to update the display
      deskletObj.displayCurrent();
      deskletObj.displayMeta();
      deskletObj.displayForecast();
    });
  },

  _load_woeid: function(data) {
    if (!data) {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.lasterror = "Could not resolve location";
      return false;
    }

    let json = JSON.parse(data);
    this._woeidcache[this.stationID] = new Object();

    try {
      let geo = json.query.results.Result;
      if (geo.woeid) {
        this._woeid = geo.woeid;
        this._woeidcache[this.stationID].woeid = geo.woeid;
        return true;
      } else {
        this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
        this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
        this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
        this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
        this.data.status.lasterror = "Could not resolve location";
        return false;
      }
    } catch(e) {
      global.logError(e);
      delete this._woeidcache[this.stationID]
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.lasterror = "Could not resolve location";
      return false;
    }
  },

  // process the rss and populate this.data
  _load_forecast: function (rss) {
    if (!rss) {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }
    let days = [];

    let parser = new Marknote.marknote.Parser();
    let doc = parser.parse(rss);
    if (!doc) {
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }
    try {
      let rootElem = doc.getRootElement();

      let channel = rootElem.getChildElement("channel");
      let title = channel.getChildElement("title").getText();
      if (title.indexOf('Error') != -1) {
        this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
        this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
        this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
        let items = channel.getChildElements("item");
        this.data.status.lasterror = items[0].getChildElement("title").getText();
        return;
      }

      let geo = channel.getChildElement('yweather:location');
      let wind = channel.getChildElement('yweather:wind');
      let atmosphere = channel.getChildElement('yweather:atmosphere');

      //## direction of movement of pressure
      let pressurecodes = [_('Steady'), _('Rising'), _('Falling')];

      this.data.city = geo.getAttributeValue('city');
      this.data.region = geo.getAttributeValue('region');
      this.data.country = geo.getAttributeValue('country');

      this.data.cc.wind_speed = wind.getAttributeValue('speed');
      this.data.cc.wind_direction = this.compassDirection(wind.getAttributeValue('direction'));
      this.data.cc.pressure = atmosphere.getAttributeValue('pressure');
      this.data.cc.pressure_direction = pressurecodes[atmosphere.getAttributeValue('rising')];
      this.data.cc.humidity = atmosphere.getAttributeValue('humidity');


      let items = channel.getChildElements("item");
      let conditions = items[0].getChildElement('yweather:condition');

      this.data.cc.temperature = conditions.getAttributeValue('temp');
      this.data.cc.obstime = conditions.getAttributeValue('date');
      // use the text if our locale is English, otherwise try and get a translation from the code
      if (this._isEnglish) {
        this.data.cc.weathertext = conditions.getAttributeValue('text');
      } else {
        this.data.cc.weathertext = this._getWeatherTextFromYahooCode(conditions.getAttributeValue('code'));
      }
      this.data.cc.icon = this._mapicon(conditions.getAttributeValue('code'));
      this.data.cc.feelslike = wind.getAttributeValue('chill');

      this.linkURL = items[0].getChildElement('link').getText();

      let forecasts = items[0].getChildElements('yweather:forecast');

      for ( let i=0; i<forecasts.length; i++) {
        let day = new Object();
        day.day = forecasts[i].getAttributeValue('day');
        day.maximum_temperature = forecasts[i].getAttributeValue('high');
        day.minimum_temperature = forecasts[i].getAttributeValue('low');
        // use the text if our locale is English, otherwise try and get a translation from the code
        if (this._isEnglish) {
          day.weathertext = forecasts[i].getAttributeValue('text');
        } else {
          day.weathertext = this._getWeatherTextFromYahooCode(forecasts[i].getAttributeValue('code'));
        }
        day.icon = this._mapicon(forecasts[i].getAttributeValue('code'));
        this.data.days[i] = day;
      }

      this.data.wgs84.lat = items[0].getChildElement('geo:lat').getText();
      this.data.wgs84.lon = items[0].getChildElement('geo:long').getText();

      this.data.status.forecast = BBCWX_SERVICE_STATUS_OK;
      this.data.status.meta = BBCWX_SERVICE_STATUS_OK;
      this.data.status.cc = BBCWX_SERVICE_STATUS_OK;
    } catch(e) {
      global.logError(e);
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
    }
  },

  _mapicon: function(code) {
    // http://developer.yahoo.com/weather/#codes
    let icon_name = 'na';
    let iconmap = {
      '0' : '00',
      '1' : '01',
      '2' : '01',
      '3' : '03',
      '4' : '04',
      '5' : '05',
      '6' : '06',
      '7' : '07',
      '8' : '08',
      '9' : '09',
      '10' : '10',
      '11' : '11',
      '12' : '12',
      '13' : '13',
      '14' : '41',
      '15' : '15',
      '16' : '16',
      '17' : '18',
      '18' : '18',
      '19' : '19',
      '20' : '20',
      '21' : '22',
      '22' : '22',
      '23' : '23',
      '24' : '24',
      '25' : '25',
      '26' : '26',
      '27' : '27',
      '28' : '28',
      '29' : '29',
      '30' : '30',
      '31' : '31',
      '32' : '32',
      '33' : '33',
      '34' : '34',
      '35' : '06',
      '36' : '36',
      '37' : '37',
      '38' : '38',
      '39' : '39', // this actually seems to map to showers, see  http://developer.yahoo.com/forum/YDN-Documentation/Yahoo-Weather-API-Wrong-Condition-Code/1290534174000-1122fc3d-da6d-34a2-9fb9-d0863e6c5bc6
      '40' : '39',
      '41' : '16',
      '42' : '41',
      '43' : '16',
      '44' : '30',
      '45' : '47',
      '46' : '46',
      '47' : '47',
      '3200' : 'na'
    }
    if (code && (typeof iconmap[code] !== "undefined")) {
      icon_name = iconmap[code];
    }
    // ### TODO consider some text based overides, eg
    // /light rain/i    11

    return icon_name;
  },

};

////////////////////////////////////////////////////////////////////////////
// ### Driver for Open Weather Map
function wxDriverOWM(stationID, apikey) {
  this._owminit(stationID, apikey);
};

wxDriverOWM.prototype = {
  __proto__: wxDriver.prototype,

  drivertype: 'OWM',
  maxDays: 7,
  linkText: 'openweathermap.org',

  // these will be dynamically reset when data is loaded
  linkURL: 'https://openweathermap.org',

  _baseURL: 'https://api.openweathermap.org/data/2.5/',

  lang_map: {
    'bg' : 'bg',
    'zh' : 'zh',
    'zh_cn' : 'zh_cn',
    'zh_tw' : 'zh_tw',
    'nl' : 'nl',
    'en' : 'en',
    'fi' : 'fi',
    'fr' : 'fr',
    'de' : 'de',
    'it' : 'it',
    'pl' : 'pl',
    'pt' : 'pt',
    'ro' : 'ro',
    'ru' : 'ru',
    'es' : 'es',
    'sv' : 'se',
    'tr' : 'tr',
    'uk' : 'ua',
    'hr' : 'hr',
    'ca' : 'ca',
    'cs' : 'cz',
    'el' : 'el',
    'fa' : 'fa',
    'gl' : 'gl',
    'hu' : 'hu',
    'ja' : 'ja',
    'kr' : 'kr',
    'lv' : 'la',
    'lt' : 'lt',
    'mk' : 'mk',
    'sk' : 'sk',
    'sl' : 'sl',
    'vi' : 'vi'
  },

  // initialise the driver
  _owminit: function(stationID, apikey) {
    this._init(stationID, apikey);
    this.capabilities.meta.region =  false;
    this.capabilities.cc.feelslike = false;
    this.capabilities.cc.pressure_direction = false;
    this.capabilities.cc.visibility = false;
    this.capabilities.forecast.visibility = false;
    this.capabilities.forecast.uv_risk = false;
  },

  refreshData: function(deskletObj) {
    // reset the data object
    this._emptyData();
    this.linkURL = 'http://openweathermap.org';

    if (this.stationID.search(/^\-?\d+(\.\d+)?,\-?\d+(\.\d+)?$/) == 0) {
      this.latlon = this.stationID.split(',');
    } else if (this.stationID.search(/^\d+$/) !=0) {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.lasterror = "Invalid location format";
      deskletObj.displayForecast();
      deskletObj.displayMeta();
      deskletObj.displayCurrent();
      return
    }

    this.langcode = this.getLangCode();

    let apiforecasturl = this._get_apiforecasturl();

    let a = this._getWeather(apiforecasturl, function(weather) {
      if (weather) {
        this._load_forecast(weather);
      }
      // get the main object to update the display
      deskletObj.displayForecast();
      deskletObj.displayMeta();
    });

    // process current observations
    let apiccurl = (typeof this.latlon != 'undefined')
    ? this._baseURL + 'weather?units=metric&lat=' + this.latlon[0] +  '&lon=' + this.latlon[1]
    : this._baseURL + 'weather?units=metric&id=' + encodeURIComponent(this.stationID);
    if (this.apikey) apiccurl = apiccurl + '&APPID=' + this.apikey;
    if (this.langcode) apiccurl += '&lang=' + this.langcode;
    let b = this._getWeather(apiccurl, function(weather) {
      if (weather) {
        this._load_observations(weather);
      }
      // get the main object to update the display
      deskletObj.displayCurrent();
    });
  },

  // process the 7 day forecast
  _get_apiforecasturl: function() {
    let apiforecasturl = (typeof this.latlon != 'undefined')
      ? this._baseURL + 'forecast/daily?units=metric&cnt=7&lat=' + this.latlon[0] +  '&lon=' + this.latlon[1]
      : this._baseURL + 'forecast/daily?units=metric&cnt=7&id=' + encodeURIComponent(this.stationID)

    if (this.apikey) apiforecasturl = apiforecasturl + '&APPID=' + this.apikey;
    if (this.langcode) apiforecasturl += '&lang=' + this.langcode;

	return apiforecasturl;
  },

  // process the data for a forecast and populate this.data
  _load_forecast: function (data) {
    if (!data) {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }

    let json = JSON.parse(data);
    if (json.cod != '200') {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.lasterror = json.cod;
      return;
    }

    try {
      this._parse_forecast(json);
      this.data.status.forecast = BBCWX_SERVICE_STATUS_OK;
      this.data.status.meta = BBCWX_SERVICE_STATUS_OK;
    } catch(e) {
      global.logError(e);
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
    }
  },

  // parse json for a forecast and populate this.data
  _parse_forecast: function (json) {
    this.data.city = json.city.name;
    this.data.country = json.city.country;
    this.data.wgs84.lat = json.city.coord.lat;
    this.data.wgs84.lon = json.city.coord.lon;
    this.linkURL = 'http://openweathermap.org/city/' + json.city.id;

    // This is ugly, but to place a forecast in a particular day we need to make an effort to 
    // interpret the UTC timestamps in the context of the forecast location's timezone, which 
    // we don't know. So we estimate, based on longitude  
    let est_tz = Math.round(json.city.coord.lon/15) * 3600;

    for (let i=0; i<json.list.length; i++) {
      let day = new Object();
      // day.day = this._getDayName(new Date(json.list[i].dt *1000).toLocaleFormat( "%w" ));
      day.day = this._getDayName(new Date((json.list[i].dt + est_tz)*1000).getUTCDay());
      day.minimum_temperature = json.list[i].temp.min;
      day.maximum_temperature = json.list[i].temp.max;
      day.pressure = json.list[i].pressure;
      day.humidity = json.list[i].humidity;
      day.wind_speed = json.list[i].speed * 3.6;
      day.wind_direction = this.compassDirection(json.list[i].deg);
      day.weathertext = json.list[i].weather[0].description.ucwords();
      day.icon = this._mapicon(json.list[i].weather[0].icon, json.list[i].weather[0].id);

      this.data.days[i] = day;
    }
  },

  // take the current observations and extract data into this.data
  _load_observations: function (data) {
    if (!data) {
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }
    let json = JSON.parse(data);
    if (json.cod != '200') {
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.lasterror = json.cod;
      return;
    }

    try {
      this.data.cc.humidity = json.main.humidity;
      this.data.cc.temperature = json.main.temp;
      this.data.cc.pressure = json.main.pressure;
      this.data.cc.wind_speed = json.wind.speed * 3.6;
      this.data.cc.wind_direction = this.compassDirection(json.wind.deg);
      this.data.cc.obstime = new Date(json.dt *1000).toLocaleFormat("%H:%M %Z");
      this.data.cc.weathertext = json.weather[0].description.ucwords();
      this.data.cc.icon = this._mapicon(json.weather[0].icon, json.weather[0].id);
      this.data.status.cc = BBCWX_SERVICE_STATUS_OK;
    } catch(e) {
      global.logError(e);
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
    }
  },

  _mapicon: function(iconcode, wxcode) {
    // http://bugs.openweathermap.org/projects/api/wiki/Weather_Condition_Codes
    let icon_name = 'na';
    let wxmap = {
      '300' : '09',
      '301' : '09',
      '302' : '11',
      '310' : '09',
      '311' : '09',
      '312' : '11',
      '313' : '39',
      '314' : '39',
      '321' : '39',
      '500' : '11',
      '511' : '10',
      '521' : '39',
      '522' : '39',
      '531' : '39',
      '600' : '13',
      '601' : '14',
      '602' : '16',
      '611' : '18',
      '612' : '06',
      '615' : '05',
      '616' : '05',
      '620' : '41',
      '621' : '41',
      '622' : '41',
      '721' : '22',
      '731' : '19',
      '751' : '19',
      '761' : '19',
      '762' : '19',
      '771' : '23',
      '781' : '00',
      '802' : '30',
      '803' : '28',
      '804' : '26',
      '900' : '00',
      '901' : '01',
      '902' : '01',
      '903' : '25',
      '904' : '36',
      '905' : '24',
    };
    let nightmap = {
      '39' : '45',
      '41' : '46',
      '30' : '29',
      '28' : '27',
      '32' : '31',
      '22' : '21',
      '47' : '38'
    };
    let iconmap = {
      '01d' : '32',
      '01n' : '31',
      '02d' : '34',
      '02n' : '33',
      '03d' : '26',
      '03n' : '26',
      '04d' : '28',
      '04n' : '27',
      '09d' : '39',
      '09n' : '45',
      '10d' : '12',
      '10n' : '12',
      '11d' : '04',
      '11n' : '04',
      '13d' : '16',
      '13n' : '16',
      '50d' : '20',
      '50n' : '20'
    };
    if (iconcode && (typeof iconmap[iconcode] !== "undefined")) {
      icon_name = iconmap[iconcode];
    }
    // override with more precise icon from the weather code if
    // we can
    if (wxcode && (typeof wxmap[wxcode] !== "undefined")) {
      icon_name = wxmap[wxcode];
    }
    // override with nighttime icons
    if ((iconcode.charAt(2) == 'n') && (typeof nightmap[icon_name] !== "undefined")) {
      icon_name = nightmap[icon_name];
    }
    return icon_name;
  },

};

////////////////////////////////////////////////////////////////////////////
// ### Driver for Open Weather Map Free
function wxDriverOWMFree(stationID, apikey) {
  this._owminit(stationID, apikey);
};

wxDriverOWMFree.prototype = {
  __proto__: wxDriverOWM.prototype,

  drivertype: 'OWMFree',
  maxDays: 5,

  // process the 3 days forecast
  _get_apiforecasturl: function() {
    let apiforecasturl = (typeof this.latlon != 'undefined')
      ? this._baseURL + 'forecast/?units=metric&lat=' + this.latlon[0] +  '&lon=' + this.latlon[1]
      : this._baseURL + 'forecast/?units=metric&id=' + encodeURIComponent(this.stationID)

    if (this.apikey) apiforecasturl = apiforecasturl + '&appid=' + this.apikey;
    if (this.langcode) apiforecasturl += '&lang=' + this.langcode;

	return apiforecasturl;
  },

  // process the data for a forecast and populate this.data
  _parse_forecast: function (json) {
      this.data.city = json.city.name;
      this.data.country = json.city.country;
      this.data.wgs84.lat = json.city.coord.lat;
      this.data.wgs84.lon = json.city.coord.lon;
      this.linkURL = 'http://openweathermap.org/city/' + json.city.id;

      // This is ugly, but to place a forecast in a particular day we need to make an effort to 
      // interpret the UTC timestamps in the context of the forecast location's timezone, which 
      // we don't know. So we estimate, based on longitude  
      let est_tz = Math.round(json.city.coord.lon/15) * 3600;

      let days = {};
      for (let i=0; i<json.list.length; i++) {
        let day_name = this._getDayName(new Date((json.list[i].dt + est_tz)*1000).getUTCDay());

        if (!(day_name in days)) {
          let day = new Object();
          day.minimum_temperature = [];
          day.maximum_temperature = [];
          day.pressure = [];
          day.humidity = [];
          day.wind_speed = [];
          day.wind_direction = [];
          day.weathertext = [];
          day.icon = [];
          days[day_name] = day;
        }

        days[day_name].minimum_temperature.push(json.list[i].main.temp);
        days[day_name].maximum_temperature.push(json.list[i].main.temp);
        days[day_name].pressure.push(json.list[i].main.pressure);
        days[day_name].humidity.push(json.list[i].main.humidity);
        days[day_name].wind_speed.push(json.list[i].wind.speed * 3.6);
        days[day_name].wind_direction.push(json.list[i].wind.deg);
        days[day_name].weathertext.push(json.list[i].weather[0].description.ucwords());
        days[day_name].icon.push(this._mapicon(json.list[i].weather[0].icon, json.list[i].weather[0].id));
      }

      let today = this._getDayName(new Date().toLocaleFormat( "%w" ));
      this.data.days = [];
      for (let day_name in days) {
        //if (day_name == today) continue;
        let middle = Math.floor(days[day_name].icon.length / 2);
        let day = new Object();
        day.day = day_name;
        day.minimum_temperature = this._minArr(days[day_name].minimum_temperature);
        day.maximum_temperature = this._maxArr(days[day_name].maximum_temperature);
        day.pressure = this._avgArr(days[day_name].pressure);
        day.humidity = this._avgArr(days[day_name].humidity);
        day.wind_speed = days[day_name].wind_speed[middle];
        day.wind_direction = this.compassDirection(days[day_name].wind_direction[middle]);
        day.weathertext = days[day_name].weathertext[middle];
        day.icon = days[day_name].icon[middle];

        this.data.days.push(day);
      }
  },

};

////////////////////////////////////////////////////////////////////////////
// ### Driver for Weather Underground
function wxDriverWU(stationID, apikey) {
  this._wuinit(stationID, apikey);
};

wxDriverWU.prototype = {
  __proto__: wxDriver.prototype,

  drivertype: 'Wunderground',
  maxDays: 7,
  linkText: 'wunderground.com\u00AE',

  _referralRef: '?apiref=415600fd47df8d55',

  // these will be dynamically reset when data is loaded
  linkURL: 'http://wunderground.com' + this._referralRef,
  linkIcon: {
    file: 'wunderground',
    width: 145,
    height: 17,
  },

  _baseURL: 'https://api.wunderground.com/api/',

  lang_map: {
      'af' : 'AF',
      'sq' : 'AL',
      'ar' : 'AR',
      'hy' : 'HY',
      'az' : 'AZ',
      'eu' : 'EU',
      'be' : 'BY',
      'bg' : 'BU',
      'my' : 'MY',
      'ca' : 'CA',
      'zh' : 'CN',
      'zh_cn' : 'CN',
      'zh_tw' : 'TW',
      'hr' : 'CR',
      'cs' : 'CZ',
      'da' : 'DK',
      'dv' : 'DV',
      'nl' : 'NL',
      'en' : 'EN',
      'en_gb' : 'LI',
      'eo' : 'EO',
      'et' : 'ET',
      'fi' : 'FI',
      'fr' : 'FR',
      'fr_ca' : 'FC',
      'gl' : 'GZ',
      'de' : 'DL',
      'de_ch' : 'CH',
      'ka' : 'KA',
      'el' : 'GR',
      'gu' : 'GU',
      'ht' : 'HT',
      'he' : 'IL',
      'hi' : 'HI',
      'hu' : 'HU',
      'id' : 'ID',
      'ga' : 'IR',
      'io' : 'IO',
      'is' : 'IS',
      'it' : 'IT',
      'ja' : 'JP',
      'jv' : 'JW',
      'km' : 'KM',
      'ko' : 'KR',
      'ku' : 'KU',
      'la' : 'LA',
      'lt' : 'LT',
      'lv' : 'LV',
      'mk' : 'MK',
      'mt' : 'MT',
      'mi' : 'MI',
      'mr' : 'MR',
      'mn' : 'MN',
      'no' : 'NO',
      'oc' : 'OC',
      'pa' : 'PA',
      'fa' : 'FA',
      'pl' : 'PL',
      'ps' : 'PS',
      'pt' : 'BR',
      'ro' : 'RO',
      'ru' : 'RU',
      'sr' : 'SR',
      'sk' : 'SK',
      'sl' : 'SL',
      'es' : 'SP',
      'sw' : 'SI',
      'sv' : 'SW',
      'th' : 'TH',
      'tk' : 'TK',
      'tl' : 'TL',
      'tr' : 'TR',
      'tt' : 'TT',
      'uk' : 'UA',
      'uz' : 'UZ',
      'vi' : 'VU',
      'cy' : 'CY',
      'wo' : 'SN',
      'yi' : 'YI',
      'ji' : 'JI',
      'mnk' : 'GM',
      'pdt' : 'GN',
      'nds' : 'ND'
   },
  // initialise the driver
  _wuinit: function(stationID, apikey) {
    this._init(stationID, apikey);
    this.capabilities.meta.region =  false;
    this.capabilities.forecast.pressure = false;
    this.capabilities.forecast.pressure_direction =  false;
    this.capabilities.forecast.visibility = false;
    this.capabilities.forecast.uv_risk = false;
  },

  refreshData: function(deskletObj) {
    // reset the data object
    this._emptyData();
    this.linkURL = 'https://wunderground.com' + this._referralRef;

    this.langcode = this.getLangCode();
    let apiurl = this._baseURL + encodeURIComponent(this.apikey) + '/forecast10day/conditions/astronomy/';
    if (this.langcode) {
      apiurl +=  'lang:' + this.langcode + '/';
    }
    apiurl += 'q/' + encodeURIComponent(this.stationID) + '.json'
    // process the forecast - single call for both current conditions and 10 day forecast
    let a = this._getWeather(apiurl, function(weather) {
      if (weather) {
        this._load_forecast(weather);
      }
      // get the main object to update the display
      deskletObj.displayForecast();
      deskletObj.displayCurrent();
      deskletObj.displayMeta();
    });

  },

  // process the data for a multi day forecast and populate this.data
  _load_forecast: function (data) {
    // global.log("WU: entering _load_forecast");
    if (!data) {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }

    let json = JSON.parse(data);

    if (typeof json.response.error !== 'undefined') {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.lasterror = json.response.error.type;
      global.logWarning("Error from wunderground: " + json.response.error.type + ": " + json.response.error.description);
      return;
    }

    try {
      var days = json.forecast.simpleforecast.forecastday;

      for (let i=0; i<days.length; i++) {
        let day = new Object();
        day.day = days[i].date.weekday_short;
        day.minimum_temperature = days[i].low.celsius;
        day.maximum_temperature = days[i].high.celsius;
        day.humidity = days[i].avehumidity;
        day.wind_speed = days[i].avewind.kph;
        day.wind_direction = this.compassDirection(days[i].avewind.degrees);
        day.weathertext = days[i].conditions;
        day.icon = this._mapicon(days[i].icon, false);

        this.data.days[i] = day;
      }
      let co = json.current_observation;
      this.data.cc.humidity = co.relative_humidity.replace('%', '');
      this.data.cc.temperature = co.temp_c;
      this.data.cc.pressure = co.pressure_mb;
      this.data.cc.pressure_direction = this._getPressureTrend(co.pressure_trend);
      this.data.cc.wind_speed = co.wind_kph;
      this.data.cc.wind_direction = this.compassDirection(co.wind_degrees);
      this.data.cc.obstime = new Date(co.local_epoch *1000).toLocaleFormat("%H:%M %Z");
      this.data.cc.weathertext = co.weather;
      this.data.cc.icon = this._mapicon(co.icon, json.moon_phase);
      this.data.cc.feelslike = co.feelslike_c;
      this.data.cc.visibility = co.visibility_km;
      this.data.city = co.display_location.city;
      this.data.country = co.display_location.country;
      this.data.wgs84.lat = co.display_location.latitude;
      this.data.wgs84.lon = co.display_location.longitude;
      this.linkURL = co.forecast_url + this._referralRef;
      this.data.status.cc = BBCWX_SERVICE_STATUS_OK;
      this.data.status.meta = BBCWX_SERVICE_STATUS_OK;
      this.data.status.forecast = BBCWX_SERVICE_STATUS_OK;
    } catch(e) {
      global.logError(e);
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
    }
  },

  _getPressureTrend: function (code) {
    let out = '';
    let map = {
      //## direction of movement of pressure
      '+': _('Rising'),
      //## direction of movement of pressure
      '-': _('Falling'),
      //## direction of movement of pressure
      '0': _('Steady')
    };
    if (code && (typeof map[code] !== "undefined")) {
      out = map[code];
    }
    return out;
  },

  _mapicon: function(iconcode, astro) {
    let icon_name = 'na';
    let iconmap = {
    'chanceflurries': '13',
    'chancerain': '39',
    'chancesleet': '18',
    'chancesnow': '41',
    'chancetstorms': '38',
    'clear': '32',
    'cloudy': '26',
    'flurries': '13',
    'fog': '20',
    'hazy': '22',
    'mostlycloudy': '28',
    'mostlysunny': '34',
    'partlycloudy': '30',
    'partlysunny': '30',
    'sleet': '18',
    'rain': '12',
    'snow': '16',
    'sunny': '32',
    'tstorms': '04'
    };
    let nightmap = {
      '39' : '45',
      '41' : '46',
      '30' : '29',
      '28' : '27',
      '32' : '31',
      '22' : '21',
      '47' : '38'
    };
    if (iconcode && (typeof iconmap[iconcode] !== "undefined")) {
      icon_name = iconmap[iconcode];
    }

    // override with nighttime icons
    // this is a crude estimate of whether or not it's night
    // TODO test with high latitudes in Winter / Summer
    if (astro) {
      let sr = new Date();
      let ss = new Date();
      let now = new Date()

      sr.setHours(astro.sunrise.hour,astro.sunrise.minute,0);
      ss.setHours(astro.sunset.hour,astro.sunset.minute,0);
      now.setHours(astro.current_time.hour,astro.current_time.minute,0);
      if ((now < sr) || (now > ss)) {
        if ( typeof nightmap[icon_name] !== "undefined") {
          icon_name = nightmap[icon_name];
        }
      }
    }
    return icon_name;
  },

};

////////////////////////////////////////////////////////////////////////////
// ### Driver for World Weather Online
function wxDriverWWO(stationID, apikey) {
  this._wwoinit(stationID, apikey);
};

wxDriverWWO.prototype = {
  __proto__: wxDriver.prototype,

  drivertype: 'WWO',
  maxDays: 5,
  linkText: 'World Weather Online',


  // these will be dynamically reset when data is loaded
  linkURL: 'http://www.worldweatheronline.com',

  // see http://developer.worldweatheronline.com/free_api_terms_of_use,
  // point 3
  minTTL: 3600,

  _baseURL: 'https://api.worldweatheronline.com/free/v1/',

  lang_map: {
    'ar' : 'ar',
    'bn' : 'bn',
    'bg' : 'bg',
    'zh' : 'zh',
    'zh_cn' : 'zh',
    'zh_tw' : 'zh_tw',
    'zh_cmn' : 'zh_cmn',
    'zh_wuu' : 'zh_wuu',
    'zh_hsn' : 'zh_hsn',
    'zh_yue' : 'zh_yue',
    'cs' : 'cs',
    'da' : 'da',
    'nl' : 'nl',
    'fi' : 'fi',
    'fr' : 'fr',
    'de' : 'de',
    'el' : 'el',
    'hi' : 'hi',
    'hu' : 'hu',
    'it' : 'it',
    'ja' : 'ja',
    'jv' : 'jv',
    'ko' : 'ko',
    'mr' : 'mr',
    'pa' : 'pa',
    'pl' : 'pl',
    'pt' : 'pt',
    'ro' : 'ro',
    'ru' : 'ru',
    'sr' : 'sr',
    'si' : 'si',
    'sk' : 'sk',
    'es' : 'es',
    'sv' : 'sv',
    'ta' : 'ta',
    'te' : 'te',
    'tr' : 'tr',
    'uk' : 'uk',
    'ur' : 'ur',
    'vi' : 'vi',
    'zu' : 'zu'
  },

  // initialise the driver
  _wwoinit: function(stationID, apikey) {
    this._init(stationID, apikey);
    this.capabilities.forecast.pressure = false;
    this.capabilities.forecast.pressure_direction =  false;
    this.capabilities.cc.pressure_direction = false;
    this.capabilities.cc.feelslike = false;
    this.capabilities.forecast.visibility = false;
    this.capabilities.forecast.uv_risk = false;
    this.capabilities.forecast.humidity = false;
  },

  refreshData: function(deskletObj) {
    // reset the data object
    this._emptyData();
    this.linkURL = 'https://www.worldweatheronline.com';

    this.langcode = this.getLangCode();
    this.i18Desc = 'lang_' + this.langcode;

    let apiurl = this._baseURL + 'weather.ashx?q=' + encodeURIComponent(this.stationID) + '&format=json&extra=localObsTime%2CisDayTime&num_of_days=5&includelocation=yes&key=' + encodeURIComponent(this.apikey);
    if (this.langcode) apiurl += '&lang=' + this.langcode;

    // process the forecast
    let a = this._getWeather(apiurl, function(weather) {
      if (weather) {
        this._load_forecast(weather);
      }
      // get the main object to update the display
      deskletObj.displayForecast();
      deskletObj.displayCurrent();
      deskletObj.displayMeta();
    });

  },

  // process the data for a multi day forecast and populate this.data
  _load_forecast: function (data) {
    if (!data) {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }

    let json = JSON.parse(data);

    if (typeof json.data.error !== 'undefined') {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.lasterror = json.data.error[0].msg;
      global.logWarning("Error from World Weather Online: " + json.data.error[0].msg);
      return;
    }

    try {
      let days = json.data.weather;

      for (let i=0; i<days.length; i++) {
        let day = new Object();
        day.day = this._getDayName(new Date(days[i].date).getUTCDay());
        day.minimum_temperature = days[i].tempMinC;
        day.maximum_temperature = days[i].tempMaxC;
        //day.pressure = json.list[i].pressure;
        //day.humidity = days[i].avehumidity;
        day.wind_speed = days[i].windspeedKmph;
        day.wind_direction = days[i].winddir16Point;
        if (typeof days[i][this.i18Desc] !== "undefined" && days[i][this.i18Desc][0].value) {
          day.weathertext = days[i][this.i18Desc][0].value;
        } else {
          day.weathertext = days[i].weatherDesc[0].value;
        }
        day.icon = this._mapicon(days[i].weatherCode, days[i].weatherIconUrl[0].value);

        this.data.days[i] = day;
      }
      let cc = json.data.current_condition[0];

      this.data.cc.humidity = cc.humidity;
      this.data.cc.temperature = cc.temp_C;
      this.data.cc.pressure = cc.pressure;
      this.data.cc.wind_speed = cc.windspeedKmph;
      this.data.cc.wind_direction = cc.winddir16Point;
      let dt = cc.localObsDateTime.split(/\-|\s/);
      this.data.cc.obstime = new Date(dt.slice(0,3).join('/')+' '+dt[3]).toLocaleFormat("%H:%M %Z");
      if (typeof cc[this.i18Desc] !== "undefined" && cc[this.i18Desc][0].value) {
        this.data.cc.weathertext = cc[this.i18Desc][0].value;
      } else {
        this.data.cc.weathertext = cc.weatherDesc[0].value;
      }
      this.data.cc.icon = this._mapicon(cc.weatherCode, cc.weatherIconUrl[0].value);
      // vis is in km
      this.data.cc.visibility = cc.visibility;

      let locdata = json.data.nearest_area[0];
      this.data.city = locdata.areaName[0].value;
      this.data.country = locdata.country[0].value;
      this.data.region = locdata.region[0].value;
      this.data.wgs84.lat = locdata.latitude;
      this.data.wgs84.lon = locdata.longitude;
      // we don't reliably get weatherURL in the response :(
      if (typeof locdata.weatherUrl != 'undefined') {
        this.linkURL = locdata.weatherUrl[0].value;
      } else {
        this.linkURL = 'http://www.worldweatheronline.com/v2/weather.aspx?q=' + encodeURIComponent(this.stationID);
      }

      this.data.status.meta = BBCWX_SERVICE_STATUS_OK;
      this.data.status.cc = BBCWX_SERVICE_STATUS_OK;
      this.data.status.forecast = BBCWX_SERVICE_STATUS_OK;
    } catch(e) {
      global.logError(e);
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
    }
  },

  _mapicon: function(iconcode, recommendedIcon) {
    // http://www.worldweatheronline.com/feed/wwoConditionCodes.txt
    let icon_name = 'na';
    let iconmap = {
      '395': '16',
      '392': '13',
      '389': '04',
      '386': '37',
      '377': '18',
      '374': '18',
      '371': '16',
      '368': '13',
      '365': '18',
      '362': '18',
      '359': '39',
      '356': '39',
      '353': '39',
      '350': '18',
      '338': '16',
      '335': '16',
      '332': '14',
      '329': '14',
      '326': '13',
      '323': '13',
      '320': '06',
      '317': '06',
      '314': '10',
      '311': '08',
      '308': '12',
      '305': '12',
      '302': '11',
      '299': '11',
      '296': '09',
      '293': '09',
      '284': '08',
      '281': '08',
      '266': '09',
      '263': '09',
      '260': '20',
      '248': '20',
      '230': '15',
      '227': '15',
      '200': '38',
      '185': '08',
      '182': '06',
      '179': '13',
      '176': '39',
      '143': '20',
      '122': '26',
      '119': '26',
      '116': '30',
      '113': '32'
    };
    let nightmap = {
      '39' : '45',
      '41' : '46',
      '30' : '29',
      '28' : '27',
      '32' : '31',
      '22' : '21',
      '47' : '38'
    };

    if (iconcode && (typeof iconmap[iconcode] !== "undefined")) {
      icon_name = iconmap[iconcode];
    }
    // override with nighttime icons
    if ((recommendedIcon.indexOf('night') > -1) && (typeof nightmap[icon_name] !== "undefined")) {
      icon_name = nightmap[icon_name];
    }
    return icon_name;
  },

};

////////////////////////////////////////////////////////////////////////////
// ### Driver for World Weather Online premium
function wxDriverWWOPremium(stationID, apikey) {
  this._wwoinit(stationID, apikey);
};

wxDriverWWOPremium.prototype = {
  __proto__: wxDriver.prototype,

  drivertype: 'WWOPremium',
  maxDays: 7,
  linkText: 'World Weather Online',


  // these will be dynamically reset when data is loaded
  linkURL: 'http://www.worldweatheronline.com',

  // see http://developer.worldweatheronline.com/free_api_terms_of_use,
  // point 3
  minTTL: 3600,

  _baseURL: 'https://api.worldweatheronline.com/premium/v1/',

  lang_map: {
    'ar' : 'ar',
    'bn' : 'bn',
    'bg' : 'bg',
    'zh' : 'zh',
    'zh_cn' : 'zh',
    'zh_tw' : 'zh_tw',
    'zh_cmn' : 'zh_cmn',
    'zh_wuu' : 'zh_wuu',
    'zh_hsn' : 'zh_hsn',
    'zh_yue' : 'zh_yue',
    'cs' : 'cs',
    'da' : 'da',
    'nl' : 'nl',
    'fi' : 'fi',
    'fr' : 'fr',
    'de' : 'de',
    'el' : 'el',
    'hi' : 'hi',
    'hu' : 'hu',
    'it' : 'it',
    'ja' : 'ja',
    'jv' : 'jv',
    'ko' : 'ko',
    'mr' : 'mr',
    'pa' : 'pa',
    'pl' : 'pl',
    'pt' : 'pt',
    'ro' : 'ro',
    'ru' : 'ru',
    'sr' : 'sr',
    'si' : 'si',
    'sk' : 'sk',
    'es' : 'es',
    'sv' : 'sv',
    'ta' : 'ta',
    'te' : 'te',
    'tr' : 'tr',
    'uk' : 'uk',
    'ur' : 'ur',
    'vi' : 'vi',
    'zu' : 'zu'
  },

  // initialise the driver
  _wwoinit: function(stationID, apikey) {
    this._init(stationID, apikey);
    //this.capabilities.forecast.pressure = false;
    this.capabilities.forecast.pressure_direction =  false;
    this.capabilities.cc.pressure_direction = false;
    //this.capabilities.cc.feelslike = false;
    //this.capabilities.forecast.visibility = false;
    this.capabilities.forecast.uv_risk = false;
    //this.capabilities.forecast.humidity = false;
  },

  refreshData: function(deskletObj) {
    // reset the data object
    this._emptyData();
    this.linkURL = 'https://www.worldweatheronline.com';

    this.langcode = this.getLangCode();
    this.i18Desc = 'lang_' + this.langcode;

    let apiurl = this._baseURL + 'weather.ashx?q=' + encodeURIComponent(this.stationID) + '&format=json&tp=24&extra=localObsTime%2CisDayTime&num_of_days=7&includelocation=yes&key=' + encodeURIComponent(this.apikey);
    if (this.langcode) apiurl += '&lang=' + this.langcode;

    // process the forecast
    let a = this._getWeather(apiurl, function(weather) {
      if (weather) {
        this._load_forecast(weather);
      }
      // get the main object to update the display
      deskletObj.displayForecast();
      deskletObj.displayCurrent();
      deskletObj.displayMeta();
    });

  },

  // process the data for a multi day forecast and populate this.data
  _load_forecast: function (data) {
    if (!data) {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }

    let json = JSON.parse(data);

    if (typeof json.data.error !== 'undefined') {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.lasterror = json.data.error[0].msg;
      global.logWarning("Error from World Weather Online: " + json.data.error[0].msg);
      return;
    }

    try {
      let days = json.data.weather;

      for (let i=0; i<days.length; i++) {
        let day = new Object();
        day.day = this._getDayName(new Date(days[i].date).getUTCDay());
        day.minimum_temperature = days[i].mintempC;
        day.maximum_temperature = days[i].maxtempC;
        //day.pressure = json.list[i].pressure;
        //day.humidity = days[i].avehumidity;
        day.wind_speed = days[i].hourly[0].windspeedKmph;
        day.wind_direction = days[i].hourly[0].winddir16Point;
        day.humidity = days[i].hourly[0].humidity;
        day.visibility = days[i].hourly[0].visibility;
        day.pressure = days[i].hourly[0].pressure;
        day.feelslike = days[i].hourly[0].FeelsLikeC;
        if (typeof days[i].hourly[0][this.i18Desc] !== "undefined" && days[i].hourly[0][this.i18Desc][0].value) {
          day.weathertext = days[i].hourly[0][this.i18Desc][0].value;
        } else {
          day.weathertext = days[i].hourly[0].weatherDesc[0].value;
        }
        day.icon = this._mapicon(days[i].hourly[0].weatherCode, days[i].hourly[0].weatherIconUrl[0].value);

        this.data.days[i] = day;
      }
      let cc = json.data.current_condition[0];

      this.data.cc.humidity = cc.humidity;
      this.data.cc.temperature = cc.temp_C;
      this.data.cc.pressure = cc.pressure;
      this.data.cc.wind_speed = cc.windspeedKmph;
      this.data.cc.feelslike = cc.FeelsLikeC;
      this.data.cc.wind_direction = cc.winddir16Point;
      let dt = cc.localObsDateTime.split(/\-|\s/);
      this.data.cc.obstime = new Date(dt.slice(0,3).join('/')+' '+dt[3]).toLocaleFormat("%H:%M %Z");
      if (typeof cc[this.i18Desc] !== "undefined" && cc[this.i18Desc][0].value) {
        this.data.cc.weathertext = cc[this.i18Desc][0].value;
      } else {
        this.data.cc.weathertext = cc.weatherDesc[0].value;
      }
      this.data.cc.icon = this._mapicon(cc.weatherCode, cc.weatherIconUrl[0].value);
      // vis is in km
      this.data.cc.visibility = cc.visibility;

      let locdata = json.data.nearest_area[0];
      this.data.city = locdata.areaName[0].value;
      this.data.country = locdata.country[0].value;
      this.data.region = locdata.region[0].value;
      this.data.wgs84.lat = locdata.latitude;
      this.data.wgs84.lon = locdata.longitude;
      // we don't reliably get weatherURL in the response :(
      if (typeof locdata.weatherUrl != 'undefined') {
        this.linkURL = locdata.weatherUrl[0].value;
      } else {
        this.linkURL = 'http://www.worldweatheronline.com/v2/weather.aspx?q=' + encodeURIComponent(this.stationID);
      }

      this.data.status.meta = BBCWX_SERVICE_STATUS_OK;
      this.data.status.cc = BBCWX_SERVICE_STATUS_OK;
      this.data.status.forecast = BBCWX_SERVICE_STATUS_OK;
    } catch(e) {
      global.logError(e);
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
    }
  },

  _mapicon: function(iconcode, recommendedIcon) {
    // http://www.worldweatheronline.com/feed/wwoConditionCodes.txt
    let icon_name = 'na';
    let iconmap = {
      '395': '16',
      '392': '13',
      '389': '04',
      '386': '37',
      '377': '18',
      '374': '18',
      '371': '16',
      '368': '13',
      '365': '18',
      '362': '18',
      '359': '39',
      '356': '39',
      '353': '39',
      '350': '18',
      '338': '16',
      '335': '16',
      '332': '14',
      '329': '14',
      '326': '13',
      '323': '13',
      '320': '06',
      '317': '06',
      '314': '10',
      '311': '08',
      '308': '12',
      '305': '12',
      '302': '11',
      '299': '11',
      '296': '09',
      '293': '09',
      '284': '08',
      '281': '08',
      '266': '09',
      '263': '09',
      '260': '20',
      '248': '20',
      '230': '15',
      '227': '15',
      '200': '38',
      '185': '08',
      '182': '06',
      '179': '13',
      '176': '39',
      '143': '20',
      '122': '26',
      '119': '26',
      '116': '30',
      '113': '32'
    };
    let nightmap = {
      '39' : '45',
      '41' : '46',
      '30' : '29',
      '28' : '27',
      '32' : '31',
      '22' : '21',
      '47' : '38'
    };

    if (iconcode && (typeof iconmap[iconcode] !== "undefined")) {
      icon_name = iconmap[iconcode];
    }
    // override with nighttime icons
    if ((recommendedIcon.indexOf('night') > -1) && (typeof nightmap[icon_name] !== "undefined")) {
      icon_name = nightmap[icon_name];
    }
    return icon_name;
  },

};

////////////////////////////////////////////////////////////////////////////
// ### Driver for APIXU
function wxDriverAPIXU(stationID, apikey) {
  this._apixuinit(stationID, apikey);
};

wxDriverAPIXU.prototype = {
  __proto__: wxDriver.prototype,

  drivertype: 'APIXU',
  maxDays: 7,
  linkText: 'APIXU',


  // these will be dynamically reset when data is loaded
  linkURL: 'https://www.apixu.com/weather/',


  _baseURL: 'https://api.apixu.com/v1/',

  lang_map: {
    'ar' : 'ar',
    'bn' : 'bn',
    'bg' : 'bg',
    'zh' : 'zh',
    'zh_cn' : 'zh',
    'zh_tw' : 'zh_tw',
    'zh_cmn' : 'zh_cmn',
    'zh_wuu' : 'zh_wuu',
    'zh_hsn' : 'zh_hsn',
    'zh_yue' : 'zh_yue',
    'cs' : 'cs',
    'da' : 'da',
    'nl' : 'nl',
    'fi' : 'fi',
    'fr' : 'fr',
    'de' : 'de',
    'el' : 'el',
    'hi' : 'hi',
    'hu' : 'hu',
    'it' : 'it',
    'ja' : 'ja',
    'jv' : 'jv',
    'ko' : 'ko',
    'mr' : 'mr',
    'pa' : 'pa',
    'pl' : 'pl',
    'pt' : 'pt',
    'ro' : 'ro',
    'ru' : 'ru',
    'sr' : 'sr',
    'si' : 'si',
    'sk' : 'sk',
    'es' : 'es',
    'sv' : 'sv',
    'ta' : 'ta',
    'te' : 'te',
    'tr' : 'tr',
    'uk' : 'uk',
    'ur' : 'ur',
    'vi' : 'vi',
    'zu' : 'zu'
  },

  // initialise the driver
  _apixuinit: function(stationID, apikey) {
    this._init(stationID, apikey);
    this.capabilities.forecast.pressure = false;
    this.capabilities.forecast.pressure_direction =  false;
    this.capabilities.cc.pressure_direction = false;
    this.capabilities.forecast.wind_direction = false;
  },

  refreshData: function(deskletObj) {
    // reset the data object
    this._emptyData();
    this.linkURL = 'https://www.apixu.com/weather/';

    this.langcode = this.getLangCode();
    this.i18Desc = 'lang_' + this.langcode;

    let apiurl = this._baseURL + 'forecast.json?q=' + encodeURIComponent(this.stationID) + '&days=' + this.maxDays + '&key=' + encodeURIComponent(this.apikey);
    if (this.langcode) apiurl += '&lang=' + this.langcode;

    // process the forecast
    let a = this._getWeather(apiurl, function(weather) {
      if (weather) {
        this._load_forecast(weather);
      }
      // get the main object to update the display
      deskletObj.displayForecast();
      deskletObj.displayCurrent();
      deskletObj.displayMeta();
    });

  },

  // process the data for a multi day forecast and populate this.data
  _load_forecast: function (data) {
    if (!data) {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }

    let json = JSON.parse(data);

    if (typeof json.error !== 'undefined') {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.lasterror = json.data.error.msg;
      global.logWarning("Error from APIXU: " + json.error.msg);
      return;
    }

    try {
      let days = json.forecast.forecastday;

      for (let i=0; i<days.length; i++) {
        let day = new Object();
        // APIXU date is a unix epoch that represents the start of the forecast day
        // as it would be in UTC.
        day.day = this._getDayName(new Date(days[i].date).getUTCDay());
        day.minimum_temperature = days[i].day.mintemp_c;
        day.maximum_temperature = days[i].day.maxtemp_c;
        //day.pressure = json.list[i].pressure;
        day.humidity = days[i].day.avghumidity;
        day.wind_speed = days[i].day.maxwind_kph;
        day.visibility = days[i].day.avgvis_km;
        day.weathertext = days[i].day.condition.text;
        day.icon = this._mapicon(days[i].day.condition.code, 1);
        day.uv_risk = days[i].day.uv;

        this.data.days[i] = day;
      }
      let cc = json.current;

      this.data.cc.humidity = cc.humidity;
      this.data.cc.temperature = cc.temp_c;
      this.data.cc.pressure = cc.pressure_mb;
      this.data.cc.wind_speed = cc.wind_kph;
      this.data.cc.wind_direction = this.compassDirection(cc.wind_degree);
      this.data.cc.obstime = new Date(cc.last_updated_epoch * 1000).toLocaleFormat("%H:%M %Z");
      this.data.cc.weathertext = cc.condition.text;
      this.data.cc.icon = this._mapicon(cc.condition.code, cc.is_day);
      // vis is in km
      this.data.cc.visibility = cc.vis_km;
      this.data.cc.feelslike = cc.feelslike_c

      let locdata = json.location;
      this.data.city = locdata.name;
      this.data.country = locdata.country;
      this.data.region = locdata.region;
      this.data.wgs84.lat = locdata.lat;
      this.data.wgs84.lon = locdata.lon;
      // we don't get a URL for local forecasts in the response. Build it from the station ID
      // (stationID seems OK, but if cases occur where it doesn't work we could normalise by
      // constructing the query parameters from lat + ',' + lon).
      this.linkURL = 'https://www.apixu.com/weather/?q=' + encodeURIComponent(this.stationID);

      this.data.status.meta = BBCWX_SERVICE_STATUS_OK;
      this.data.status.cc = BBCWX_SERVICE_STATUS_OK;
      this.data.status.forecast = BBCWX_SERVICE_STATUS_OK;
    } catch(e) {
      global.logError(e);
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
    }
  },

  _mapicon: function(iconcode, isDay) {
    // http://www.apixu.com/doc/Apixu_weather_conditions.csv
    let icon_name = 'na';
    let iconmap = {
      '1000': '32',
      '1003': '30',
      '1006': '26',
      '1009': '26',
      '1030': '22',
      '1063': '39',
      '1066': '41',
      '1069': '07',
      '1072': '08',
      '1087': '37',
      '1114': '15',
      '1117': '15',
      '1135': '20',
      '1147': '20',
      '1150': '39',
      '1153': '09',
      '1168': '08',
      '1171': '10',
      '1180': '39',
      '1183': '11',
      '1186': '39',
      '1189': '12',
      '1192': '39',
      '1195': '12',
      '1198': '10',
      '1201': '10',
      '1204': '18',
      '1207': '18',
      '1210': '41',
      '1213': '13',
      '1216': '41',
      '1219': '14',
      '1222': '41',
      '1225': '16',
      '1237': '18',
      '1240': '39',
      '1243': '39',
      '1246': '39',
      '1249': '18',
      '1252': '18',
      '1255': '41',
      '1258': '41',
      '1261': '18',
      '1264': '18',
      '1273': '37',
      '1276': '04',
      '1279': '41',
      '1282': '16'
    };
    let nightmap = {
      '39' : '45',
      '41' : '46',
      '30' : '29',
      '28' : '27',
      '32' : '31',
      '22' : '21',
      '47' : '38'
    };

    if (iconcode && (typeof iconmap[iconcode] !== "undefined")) {
      icon_name = iconmap[iconcode];
    }
    // override with nighttime icons
    if ((isDay != 1) && (typeof nightmap[icon_name] !== "undefined")) {
      icon_name = nightmap[icon_name];
    }
    return icon_name;
  },

};


////////////////////////////////////////////////////////////////////////////
// ### Driver for Forecast.io
function wxDriverForecastIo(stationID, apikey) {
  this._fioinit(stationID, apikey);
};

wxDriverForecastIo.prototype = {
  __proto__: wxDriver.prototype,

  drivertype: 'forecast.io',
  maxDays: 7,
  linkText: 'Forecast.io',


  // these will be dynamically reset when data is loaded
  linkURL: 'https://darksky.net',

  _baseURL: 'https://api.darksky.net/forecast/',

  lang_map: {
    'nl' : 'nl',
    'en' : 'en',
    'fr' : 'fr',
    'de' : 'de',
    'es' : 'es',
    'pl' : 'pl',
    'it' : 'it',
    'tet' : 'tet',
    'bs' : 'bs',
    'pt' : 'pt',
    'ru' : 'ru',
    'sv' : 'sv',
    'tr' : 'tr',
    'zh' : 'zh',
    'ar' : 'ar',
    'sk' : 'sk',
    'uk' : 'uk',
    'el' : 'el',
    'zh_tw': 'zh-tw',
    'hr' : 'hr',
    'az' : 'az',
    'cs' : 'cs',
    'hu' : 'hu',
    'sr' : 'sr',
    'kw' : 'kw',
    'is' : 'is',
    'nb' : 'nb',
    'be' : 'be',
    'id' : 'id',
    'ca' : 'ca',
    'et' : 'et',
    'sl' : 'sl',
    'bg' : 'bg'

  },

  // initialise the driver
  _fioinit: function(stationID, apikey) {
    this._init(stationID, apikey);
    this.capabilities.forecast.pressure_direction =  false;
    this.capabilities.cc.pressure_direction =  false;
    this.capabilities.cc.obstime = false;
    //this.capabilities.meta.country = false;
    //this._geocache = new Object();

    //forecast.io sometime includes units in summaries
    this.unitsInSummaries = true;
  },

  refreshData: function(deskletObj) {
    // reset the data object
    this._emptyData();
    this.linkURL = 'http://forecast.io';

    // forecast.io sometimes includes temp and snow accumulations in
    // text summaries. To get these in imperial units we have to request
    // all responses be imperial using 'us'. Do this if user opts for
    // Fahrenheit temperatures. Individual data points will have to be
    // converted back later using _getSI().
    this.units = (deskletObj.tunits=='F')?'us':'ca';

    // check the stationID looks valid before going further
    if (this.stationID.search(/^\-?\d+(\.\d+)?,\-?\d+(\.\d+)?$/) == 0) {
      let latlon = this.stationID.split(',')
      //this.data.wgs84.lat = latlon[0];
      //this.data.wgs84.lon = latlon[1];
      //this.linkURL = 'http://forecast.io/#/f/' + this.stationID;

      let apiurl = this._baseURL + encodeURIComponent(this.apikey) + '/' + encodeURIComponent(this.stationID) + '?units=' + this.units + '&exclude=minutely,hourly,alerts,flags';
      this.langcode = this.getLangCode();
      if (this.langcode) apiurl += '&lang=' + this.langcode;

      // process the forecast
      let a = this._getWeather(apiurl, function(weather) {
        if (weather) {
          this._load_forecast(weather);
        }
        // get the main object to update the display
        deskletObj.displayForecast();
        deskletObj.displayCurrent();
        deskletObj.displayMeta();
      });

    } else {
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.lasterror = "Invalid location";
      deskletObj.displayMeta();
      deskletObj.displayForecast();
      deskletObj.displayCurrent();
    }

  },

  // process the data for a multi day forecast and populate this.data
  _load_forecast: function (data) {
    if (!data) {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      //this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }

    let json = JSON.parse(data);
    let tz = GLib.TimeZone.new(json.timezone);

    try {
      let days = json.daily.data;

      for (let i=0; i<days.length; i++) {
        let day = new Object();
        let dt = GLib.DateTime.new_from_unix_utc(days[i].time);
        dt = dt.to_timezone(tz);
        day.day = this._getDayName(dt.get_day_of_week());
        day.minimum_temperature = this._getSI(days[i].temperatureMin, 'temp');
        day.maximum_temperature = this._getSI(days[i].temperatureMax, 'temp');
        day.minimum_feelslike = this._getSI(days[i].apparentTemperatureMin, 'temp');
        day.maximum_feelslike = this._getSI(days[i].apparentTemperatureMax, 'temp');
        day.pressure = this._getSI(days[i].pressure, 'press');
        day.humidity = days[i].humidity*100;
        day.wind_speed = this._getSI(days[i].windSpeed, 'windspd');
        day.wind_direction = this.compassDirection(days[i].windBearing);
        day.weathertext = days[i].summary;
        day.icon = this._mapicon(days[i].icon);
        day.visibility = this._getSI(days[i].visibility, 'viz');

        this.data.days[i] = day;
      }
      let cc = json.currently;

      this.data.cc.humidity = cc.humidity*100;
      this.data.cc.temperature = this._getSI(cc.temperature, 'temp');
      this.data.cc.pressure = this._getSI(cc.pressure, 'press');
      this.data.cc.wind_speed = this._getSI(cc.windSpeed, 'windspd');
      this.data.cc.wind_direction = this.compassDirection(cc.windBearing);
      this.data.cc.weathertext = cc.summary;
      this.data.cc.icon = this._mapicon(cc.icon);
      this.data.cc.visibility = this._getSI(cc.visibility, 'viz');
      this.data.cc.feelslike = this._getSI(cc.apparentTemperature, 'temp');

      this.data.wgs84.lat = json.latitude;
      this.data.wgs84.lon = json.longitude;
      this.linkURL = 'http://forecast.io/#/f/' + json.latitude + ',' + json.longitude;

      this.data.status.cc = BBCWX_SERVICE_STATUS_OK;
      this.data.status.forecast = BBCWX_SERVICE_STATUS_OK;
      this.data.status.meta = BBCWX_SERVICE_STATUS_OK;
    } catch(e) {
      global.logError(e);
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      //this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
    }
  },

  // Ensure units returned by driver are SI, even when requesting imperial ('us')
  // units to get imperial in the summary text
  _getSI: function(val, type) {
    // If units weren't 'us', return as is
    if (this.units != "us") {
      return val;
    }
    // Don't try to convert non numbers
    if (isNaN(val)) return val;
    // F to C
    if (type == "temp") {
      return ((val + 40) / 1.8) - 40;
    }
    if (type == "press") {
      return val;
    }
    // miles to km
    if (type == "viz") {
      return val*1.60923;
    }
    // mph to km/h
    if (type == "windspd") {
      return val*1.60923;
    }
    return val;
  },

  _mapicon: function(iconcode) {
    // https://developer.forecast.io/docs/v2
    let icon_name = 'na';
    let iconmap = {
      'clear-day' : '32',
      'clear-night' : '31',
      'rain' : '11',
      'snow' : '14',
      'sleet' : '18',
      'wind' : '24',
      'fog' : '20',
      'cloudy' : '26',
      'partly-cloudy-day' : '30',
      'partly-cloudy-night' : '29'
    };

    if (iconcode && (typeof iconmap[iconcode] !== "undefined")) {
      icon_name = iconmap[iconcode];
    }

    return icon_name;
  },

};

////////////////////////////////////////////////////////////////////////////
// ### Driver for TWC Weather
function wxDriverTWC(stationID) {
  this._twcinit(stationID);
};

wxDriverTWC.prototype = {
  __proto__: wxDriver.prototype,

  drivertype: 'twc',
  maxDays: 7,
  linkText: 'weather.com',

  // these will be dynamically reset when data is loaded
  linkURL: 'https://www.weather.com',

  _baseURL: 'https://wxdata.weather.com/wxdata/weather/local/',

  // initialise the driver
  _twcinit: function(stationID) {
    this._init(stationID);
    this.capabilities.forecast.pressure =  false;
    this.capabilities.forecast.pressure_direction =  false;
    this.capabilities.forecast.visibility = false;
    this._isEnglish = LangList[0].substr(0,2).toLowerCase() == 'en' ? true : false;
  },

  refreshData: function(deskletObj) {
    // reset the data object
    this._emptyData();
    this.linkURL = 'https://www.weather.com';

    // process the forecast
    let a = this._getWeather(this._baseURL + encodeURIComponent(this.stationID) + '?cc=*&dayf=10&unit=m', function(weather) {
      if (weather) {
        this._load_forecast(weather);
      }
      // get the main object to update the display
      deskletObj.displayForecast();
      deskletObj.displayCurrent();
      deskletObj.displayMeta();
    });
  },

  // process the xml and populate this.data
  _load_forecast: function (xml) {
    if (!xml) {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }
    let days = [];

    let parser = new Marknote.marknote.Parser();
    let doc = parser.parse(xml);
    if (!doc) {
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }
    try {

      let rootElem = doc.getRootElement();
      if (rootElem.getName() == 'error') {
        this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
        this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
        this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
        this.data.status.lasterror = rootElem.getChildElement('err').getText();
        return;
      }

      this.data.cc = new Object();
      this.data.days = [];


      let geo = rootElem.getChildElement("loc");

      let cc = rootElem.getChildElement('cc');
      let dayf = rootElem.getChildElement('dayf');


      let locparts = geo.getChildElement('dnam').getText().split(',');
      this.data.city = locparts[0].trim();
      //### TODO this returns state for US - somehow detect that and add US
      this.data.country = locparts[locparts.length-1].trim();
      this.linkURL = 'http://www.weather.com/weather/today/' + geo.getAttributeValue('id').trim();
      this.data.wgs84.lat=geo.getChildElement('lat').getText();
      this.data.wgs84.lon=geo.getChildElement('lon').getText();
      // data.region

      this.data.cc.temperature = cc.getChildElement('tmp').getText();
      this.data.cc.feelslike = cc.getChildElement('flik').getText();
      this.data.cc.obstime = new Date(cc.getChildElement('lsup').getText()).toLocaleFormat( "%H:%M %Z" );
      // use the text if our locale is English, otherwise try and get a translation from the code
      if (this._isEnglish) {
        this.data.cc.weathertext = cc.getChildElement('t').getText();
      } else {
        this.data.cc.weathertext = this._getWeatherTextFromYahooCode(cc.getChildElement('icon').getText());
      }
      if(this.data.cc.weathertext == 'N/A') this.data.cc.weathertext = '';
      this.data.cc.icon = this._mapicon(cc.getChildElement('icon').getText());
      let wind = cc.getChildElement('wind');
      this.data.cc.wind_speed = wind.getChildElement('s').getText();
      this.data.cc.wind_direction = wind.getChildElement('t').getText();
      this.data.cc.humidity = cc.getChildElement('hmid').getText();
      this.data.cc.visibility = cc.getChildElement('vis').getText();
      let bar = cc.getChildElement('bar');
      this.data.cc.pressure = bar.getChildElement('r').getText();
      this.data.cc.pressure_direction = _(bar.getChildElement('d').getText().ucwords());

      let forecasts = dayf.getChildElements("day");

      for (let i=0; i<forecasts.length; i++) {
        let day = new Object();
        day.day = forecasts[i].getAttributeValue('t').substring(0,3);
        day.maximum_temperature = forecasts[i].getChildElement('hi').getText();
        day.minimum_temperature = forecasts[i].getChildElement('low').getText();
        var dayparts = forecasts[i].getChildElements("part");
        var p = 0;
        if (dayparts[0].getChildElement('icon').getText() == '') p = 1;
        // use the text if our locale is English, otherwise try and get a translation from the code
        if (this._isEnglish) {
          day.weathertext = dayparts[p].getChildElement('t').getText();
        } else {
          day.weathertext = this._getWeatherTextFromYahooCode(dayparts[p].getChildElement('icon').getText());
        }
        day.icon = this._mapicon(dayparts[p].getChildElement('icon').getText());
        day.humidity = dayparts[p].getChildElement('hmid').getText();
        var windf = dayparts[p].getChildElement('wind');
        day.wind_speed = windf.getChildElement('s').getText();
        if(day.wind_speed == 'calm') {day.wind_speed = 0};
        day.wind_direction = windf.getChildElement('t').getText();
        this.data.days[i] = day;
      }

      this.data.status.forecast = BBCWX_SERVICE_STATUS_OK;
      this.data.status.meta = BBCWX_SERVICE_STATUS_OK;
      this.data.status.cc = BBCWX_SERVICE_STATUS_OK;
    } catch(e) {
      global.logError(e);
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
    }
  },

  _mapicon: function(code) {
    // Use codes as listed by Yahoo! as weather.com supplies their data
    // http://developer.yahoo.com/weather/#codes
    let icon_name = 'na';
    let iconmap = {
      '0' : '00',
      '1' : '01',
      '2' : '01',
      '3' : '03',
      '4' : '04',
      '5' : '05',
      '6' : '06',
      '7' : '07',
      '8' : '08',
      '9' : '09',
      '10' : '10',
      '11' : '11',
      '12' : '12',
      '13' : '13',
      '14' : '41',
      '15' : '15',
      '16' : '16',
      '17' : '18',
      '18' : '18',
      '19' : '19',
      '20' : '20',
      '21' : '22',
      '22' : '22',
      '23' : '23',
      '24' : '24',
      '25' : '25',
      '26' : '26',
      '27' : '27',
      '28' : '28',
      '29' : '29',
      '30' : '30',
      '31' : '31',
      '32' : '32',
      '33' : '33',
      '34' : '34',
      '35' : '06',
      '36' : '36',
      '37' : '37',
      '38' : '38',
      '39' : '39', // this seems to map to showers
      '40' : '39',
      '41' : '16',
      '42' : '41',
      '43' : '16',
      '44' : '30',
      '45' : '47',
      '46' : '46',
      '47' : '47',
      '3200' : 'na'
    }
    if (code && (typeof iconmap[code] !== "undefined")) {
      icon_name = iconmap[code];
    }
    // ### TODO consider some text based overides, eg
    // /light rain/i    11

    return icon_name;
  },

};

////////////////////////////////////////////////////////////////////////////
// ### Driver for MeteoBlue
function wxDriverMeteoBlue(stationID, apikey) {
  this._meteoblueinit(stationID, apikey);
};

wxDriverMeteoBlue.prototype = {
  __proto__: wxDriver.prototype,

  drivertype: 'meteoblue',
  maxDays: 7,
  linkText: 'meteoblue',


  // these will be dynamically reset when data is loaded
  linkURL: 'https://www.meteoblue.com',
  linkIcon: {
    file: 'meteoblue',
    width: 59,
    height: 20,
  },

  _baseURL: 'https://my.meteoblue.com/dataApi/dispatch.pl',

  lang_map: {
  },

  // initialise the driver
  _meteoblueinit: function(stationID, apikey) {
    this._init(stationID, apikey);
    this.capabilities.cc.humidity = false;
    this.capabilities.cc.pressure = false;
    this.capabilities.cc.wind_direction = false;
    this.capabilities.cc.visibility = false;
    this.capabilities.cc.feelslike = false;
    this.capabilities.cc.pressure_direction =  false;
    this.capabilities.cc.obstime = false;
    this.capabilities.forecast.pressure_direction =  false;
    this.capabilities.forecast.visibility =  false;
    this.capabilities.forecast.uv_risk =  false;

  },

  refreshData: function(deskletObj) {
    // reset the data object
    this._emptyData();
    this.linkURL = 'https://www.meteoblue.com';


    // check the stationID looks valid before going further
    if (this.stationID.search(/^\-?\d+(\.\d+)?,\-?\d+(\.\d+)?$/) == 0) {
      let latlon = this.stationID.split(',')
      let apiurl = this._baseURL + '?apikey=' + encodeURIComponent(this.apikey) + '&mac=feed&type=json_7day_3h_firstday&lat=' + latlon[0] + '&lon=' + latlon[1];

      // process the forecast
      let a = this._getWeather(apiurl, function(weather) {
        if (weather) {
          this._load_forecast(weather);
        }
        // get the main object to update the display
        deskletObj.displayForecast();
        deskletObj.displayCurrent();
        deskletObj.displayMeta();
      });

    } else {
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.lasterror = "Invalid location";
      deskletObj.displayMeta();
      deskletObj.displayForecast();
      deskletObj.displayCurrent();
    }

  },

  // process the data for a multi day forecast and populate this.data
  _load_forecast: function (data) {
    if (!data) {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      //this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      return;
    }

    let json = JSON.parse(data);

    if (typeof json.error_message !== 'undefined') {
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.lasterror = json.error_message;
      global.logWarning("Error from World Weather Online: " + json.error_message);
      return;
    }

    try {
      let days = json.forecast;

      for (let i=0; i<days.length; i++) {
        let day = new Object();
        //day.day = this._getDayName(new Date(days[i].date).getUTCDay());
        day.day = days[i].weekday;
        day.minimum_temperature = days[i].temperature_min;
        day.maximum_temperature = days[i].temperature_max;
        day.pressure = days[i].pressure_hpa;
        day.humidity = days[i].relative_humidity_avg;
        day.wind_speed = days[i].wind_speed_max;
        day.wind_direction = days[i].wind_direction_dominant;
        day.weathertext = this._getWxTxt(days[i].pictocode_day);
        day.icon = this._mapicon(days[i].pictocode_day, true);

        this.data.days[i] = day;
      }
      let cc = json.current;

      this.data.cc.temperature = cc.temperature;
      this.data.cc.weathertext = this._getWxTxt(cc.pictocode);
      this.data.cc.wind_speed = cc.wind_speed;
      this.data.cc.icon = this._mapicon(cc.pictocode, cc.is_daylight);

      this.data.wgs84.lat = json.meta.lat;
      this.data.wgs84.lon = json.meta.lon;
      //https://www.meteoblue.com/weather/forecast/week/52.275N-1.597E
      this.linkURL = 'https://www.meteoblue.com/weather/forecast/week/' + json.meta.lat + 'N' + json.meta.lon + 'E';

      this.data.status.cc = BBCWX_SERVICE_STATUS_OK;
      this.data.status.forecast = BBCWX_SERVICE_STATUS_OK;
      this.data.status.meta = BBCWX_SERVICE_STATUS_OK;
    } catch(e) {
      global.logError(e);
      this.data.status.forecast = BBCWX_SERVICE_STATUS_ERROR;
      //this.data.status.meta = BBCWX_SERVICE_STATUS_ERROR;
      this.data.status.cc = BBCWX_SERVICE_STATUS_ERROR;
    }
  },

  // translate meteoblue pictocode into text string. We use phrases that we
  // have in existing translations for. Meteoblue suggested text given in comments
  // TODO 'Heavy Rain' is a poor match for 6 and 14. Probably better to use
  // 'Rain', but we don't have that in the existing translations
  // see https://content.meteoblue.com/en/help/standards/symbols-and-pictograms
  _getWxTxt: function(pictcode) {
    let wxtext = '';
    let textmap = {
      '1' : _('Clear Sky'),             //Sunny, cloudless sky
      '2' : _('Fair'),                  //Sunny and few clouds
      '3' : _('Partly Cloudy'),         //Partly cloudy
      '4' : _('Cloudy'),                //Overcast
      '5' :  _('Fog'),                  //Fog
      '6' : _('Heavy Rain'),            //Overcast with rain
      '7' : _('Showers'),               //Mixed with showers
      '8' :  _('Thundery Shower'),      //Showers, thunderstorms likely
      '9' : _('Snow'),                  //Overcast with snow
      '10' : _('Snow showers'),         //Mixed with snow showers
      '11' : _('Mixed rain and snow'),  //Mostly cloudy with a mixture of snow and rain
      '12' : _('Light Rain'),           //Overcast with light rain
      '13' : _('Light Snow'),           //Overcast with light snow
      '14' : _('Heavy Rain'),           //Mostly cloudy with rain
      '15' : _('Snow'),                 //Mostly cloudy with snow
      '16' : _('Light Rain'),           //Mostly cloudy with light rain
      '17' : _('Light Snow')            //Mostly cloudy with light snow
    };

    if (pictcode && (typeof textmap[pictcode] !== "undefined")) {
      wxtext = textmap[pictcode];
    }

    return wxtext;
  },

  _mapicon: function(iconcode, isDay) {
    let icon_name = 'na';
    let iconmapday = {
      '1' : '32',
      '2' : '34',
      '3' : '30',
      '4' : '26',
      '5' : '20',
      '6' : '12',
      '7' : '39',
      '8' : '37',
      '9' : '14',
      '10' : '41',
      '11' : '05',
      '12' : '11',
      '13' : '13',
      '14' : '12',
      '15' : '14',
      '16' : '11',
      '17' : '13'
    };

    let iconmapnight = {
      '1' : '31',
      '2' : '32',
      '3' : '29',
      '4' : '26',
      '5' : '20',
      '6' : '12',
      '7' : '45',
      '8' : '47',
      '9' : '14',
      '10' : '46',
      '11' : '05',
      '12' : '11',
      '13' : '13',
      '14' : '12',
      '15' : '14',
      '16' : '11',
      '17' : '13'
    };

    if (isDay) {
      if (iconcode && (typeof iconmapday[iconcode] !== "undefined")) {
        icon_name = iconmapday[iconcode];
      }
    } else {
      if (iconcode && (typeof iconmapnight[iconcode] !== "undefined")) {
        icon_name = iconmapnight[iconcode];
      }
    }

    return icon_name;
  },

};


////////////////////////////////////////////////////////////////////////////
// ### END DRIVERS ###

////////////////////////////////////////////////////////////////////////////
// Utility function to capitalise first letter of each word in a string
String.prototype.ucwords = function() {
    return this.replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
};

function main(metadata, desklet_id){
  let desklet = new MyDesklet(metadata,desklet_id);
  return desklet;
};


