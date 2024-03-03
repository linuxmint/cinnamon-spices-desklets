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

const ByteArray = imports.byteArray;
const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Pango = imports.gi.Pango;
const Settings = imports.ui.settings;
const Soup = imports.gi.Soup;
const St = imports.gi.St;
const Tooltips = imports.ui.tooltips;

const UUID = 'bbcwx@oak-wood.co.uk';
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

imports.searchPath.push(DESKLET_DIR);

// BASE DRIVER
const wxBase = imports.drivers.wxbase;

// DRIVERS FOR ACCESSING DIFFERENT WEBSERVICES
const BBC = imports.drivers.bbc;
const Meteoblue = imports.drivers.meteoblue;
const NWS = imports.drivers.nws;
const OWM = imports.drivers.owm;
const OWMFree = imports.drivers.owmfree;
const OpenMeteo = imports.drivers.openmeteo;
const WU = imports.drivers.wunderground;
const WWO = imports.drivers.wwo;
const WeatherAPI = imports.drivers.weatherapi;
const Weatherstack = imports.drivers.weatherstack;

var _httpSession = wxBase._httpSession;

// Set up some constants for layout and styling
const BBCWX_TEXT_SIZE = 14;
const BBCWX_CC_TEXT_SIZE = 24;
const BBCWX_LABEL_TEXT_SIZE = 11;
const BBCWX_LINK_TEXT_SIZE = 10;
const BBCWX_REFRESH_ICON_SIZE = 14;
const BBCWX_TABLE_ROW_SPACING = 2;
const BBCWX_TABLE_COL_SPACING = 5;
const BBCWX_TABLE_PADDING = 5;
const BBCWX_CONTAINER_PADDING = 12;
const BBCWX_ICON_HEIGHT = 40;
const BBCWX_CC_ICON_HEIGHT = 170;
const BBCWX_BUTTON_PADDING = 3;
const BBCWX_LABEL_PADDING = 4;
const BBCWX_TEMP_PADDING = 12;
const BBCWX_SEPARATOR_STYLE = 'bbcwx-separator';
const BBCWX_DEFAULT_ICONSET = 'colourful';
const BBCWX_TRANSLATION_URL = 'https://github.com/tipichris/bbcwx/wiki/Translating';

const SERVICE_STATUS_OK = wxBase.SERVICE_STATUS_OK;

const ALIGN_CENTER = { x_fill: false, y_fill: true, x_align: St.Align.MIDDLE, y_align: St.Align.MIDDLE, expand: true };
const ALIGN_LEFT = { x_fill: false, y_fill: true, x_align: St.Align.START, y_align: St.Align.MIDDLE, expand: true };
const ALIGN_RIGHT = { x_fill: false, y_fill: true, x_align: St.Align.END, y_align: St.Align.MIDDLE, expand: true };

const OLD_SETTINGS_DIR = GLib.get_home_dir() + `/.cinnamon/configs/${UUID}`;
const SETTINGS_DIR = GLib.get_home_dir() + `/.config/cinnamon/spices/${UUID}`;

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + '/.local/share/locale');

// list of preferred languages, most preferred first
const LANGLIST = GLib.get_language_names();
//const LANGLIST = ['ar', 'zh_CN', 'es_ES', 'es', 'en'];

function _(str) {
  if (str) return Gettext.dgettext(UUID, str);
}

function MyDesklet(metadata, desklet_id) {
  this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
  __proto__: Desklet.Desklet.prototype,

  _init: function (metadata, desklet_id) {
    // ############ VARIABLES ###########
    this.desklet_id = desklet_id;
    // Days of the week
    this.daynames = { Mon: _('Mon'), Tue: _('Tue'), Wed: _('Wed'), Thu: _('Thu'), Fri: _('Fri'), Sat: _('Sat'), Sun: _('Sun') };
    this.fwicons = [];
    this.labels = [];
    this.max = [];
    this.min = [];
    this.windd = [];
    this.winds = [];
    this.tempn = [];
    this.eachday = [];
    this.wxtooltip = [];
    this.cc = [];
    this.days = [];
    this.metadata = metadata;
    this.oldno = 0; // test for a change in this.no
    this.oldwebservice = '';
    this.oldshifttemp = '';
    this.redrawNeeded = false;

    // ################################

    try {
      // attempt to restore old settings on upgrade from <3.0 to 3.0+
      let id_json = `/${this.desklet_id}.json`;
      [OLD_SETTINGS_DIR, SETTINGS_DIR].forEach(settings_dir => {
        if (GLib.file_test(settings_dir + id_json, GLib.FileTest.EXISTS)) {
          let [ok, contents] = GLib.file_get_contents(settings_dir + id_json);
          let settings_json = JSON.parse(contents);
          this.old_webservice = settings_json.webservice.value;
          this.old_transparency = settings_json.transparency.value;
          if (this.old_webservice == 'owm2') this.old_webservice = 'owmfree';
          if (this.old_webservice == 'wwo2') this.old_webservice = 'wwo';
          if (this.old_webservice == 'apixu') this.old_webservice = 'weatherstack';
          if (settings_json.stationID)
            this.old_stationID = settings_json.stationID.value;
          if (settings_json.apikey)
            this.old_apikey = settings_json.apikey.value;
        }
      });

      Desklet.Desklet.prototype._init.call(this, metadata);
      // initialize desklet settings
      this.settings = new Settings.DeskletSettings(this, UUID, this.desklet_id);
      // a change to webservice requires data to be fetched and the window redrawn
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'webservice', 'webservice', this.initForecast, null);
      // station and apikey (if required) for each driver
      // changing stationID or apikey requires us to fetch new data
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'bbc__stationID', 'bbc__stationID', this.changeStation, null); // BBC
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'meteoblue__stationID', 'meteoblue__stationID', this.changeStation, null);  // meteoblue
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'meteoblue__apikey', 'meteoblue__apikey', this.changeApiKey, null);  // meteoblue
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'nws__stationID', 'nws__stationID', this.changeStation, null);  // National Weather Service
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'openmeteo__stationID', 'openmeteo__stationID', this.changeStation, null);  // Open-Meteo Non-commercial
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'owmfree__stationID', 'owmfree__stationID', this.changeStation, null);  // Open Weather Map Free
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'owmfree__apikey', 'owmfree__apikey', this.changeApiKey, null);  // Open Weather Map Free
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'owm__stationID', 'owm__stationID', this.changeStation, null);  // Open Weather Map
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'owm__apikey', 'owm__apikey', this.changeApiKey, null);  // Open Weather Map
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'weatherapi__stationID', 'weatherapi__stationID', this.changeStation, null);  // Weather API Free
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'weatherapi__apikey', 'weatherapi__apikey', this.changeApiKey, null);  // Weather API Free
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'weatherstack__stationID', 'weatherstack__stationID', this.changeStation, null);  // weatherstack
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'weatherstack__apikey', 'weatherstack__apikey', this.changeApiKey, null);  // weatherstack
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'wwo__stationID', 'wwo__stationID', this.changeStation, null);  // World Weather Online
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'wwo__apikey', 'wwo__apikey', this.changeApiKey, null);  // World Weather Online
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'wunderground__stationID', 'wunderground__stationID', this.changeStation, null);  // Weather Underground
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'wunderground__geocode', 'wunderground__geocode');  // Weather Underground
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'wunderground__apikey', 'wunderground__apikey', this.changeApiKey, null);  // Weather Underground

      // temperature unit change may require refetching forecast if service includes units in text summaries
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'tunits', 'tunits', this.onTempUnitChange, null);
      // these require only a redisplay
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'wunits', 'wunits', this.onUnitChange, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'punits', 'punits', this.onUnitChange, null);
      // userno because of change to number of days in table, and possibly position of current temperature
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'userno', 'userno', this.redraw, null);
      // this change requires the main loop to be restarted, but no other updates
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'refreshtime', 'refreshtime', this.changeRefresh, null);

      // optional display items (not all are supported by all services)
      // if these need a redraw, displayOptsChange sets a flag to say a redraw is needed before calling redraw
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'display__meta__country', 'display__meta__country', this.updateStyle, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'display__meta__region', 'display__meta__region', this.updateStyle, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'display__cc__weather', 'display__cc__weather', this.displayOptsChange, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'display__cc__pressure', 'display__cc__pressure', this.displayOptsChange, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'display__cc__humidity', 'display__cc__humidity', this.displayOptsChange, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'display__cc__wind_speed', 'display__cc__wind_speed', this.displayOptsChange, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'display__cc__feelslike', 'display__cc__feelslike', this.displayOptsChange, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'display__cc__visibility', 'display__cc__visibility', this.displayOptsChange, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'display__forecast__maximum_temperature', 'display__forecast__maximum_temperature', this.displayOptsChange, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'display__forecast__minimum_temperature', 'display__forecast__minimum_temperature', this.displayOptsChange, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'display__forecast__wind_speed', 'display__forecast__wind_speed', this.displayOptsChange, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'display__forecast__wind_direction', 'display__forecast__wind_direction', this.displayOptsChange, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'display__forecast__pressure', 'display__forecast__pressure', this.displayOptsChange, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'display__forecast__humidity', 'display__forecast__humidity', this.displayOptsChange, null);

      // these changes require only a change to the styling of the desklet:
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'zoom', 'zoom', this.updateStyle, null);
      // this change potentially needs a redraw of the window, but not a refetch of data
      // layout because the position of the current temperature may change
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'layout', 'layout', this.displayOptsChange, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'iconstyle', 'iconstyle', this.updateStyle, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'citystyle', 'citystyle', this.updateStyle, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'overrideTheme', 'overrideTheme', this.updateStyle, null);
      this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, 'transparency', 'transparency', this.updateStyle, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'textcolor', 'textcolor', this.updateStyle, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'textshadow', 'textshadow', this.updateStyle, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'shadowblur', 'shadowblur', this.updateStyle, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'bgcolor', 'bgcolor', this.updateStyle, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'cornerradius', 'cornerradius', this.updateStyle, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'border', 'border', this.updateStyle, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'bordercolor', 'bordercolor', this.updateStyle, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'borderwidth', 'borderwidth', this.updateStyle, null);

      // location display settings
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'locsrc', 'locsrc', this.displayMeta, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'manuallocation', 'manuallocation', this.displayMeta, null);

      // experimental settings
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'experimental_enabled', 'experimental_enabled', this.setGravity, null);
      this.settings.bindProperty(Settings.BindingDirection.ONE_WAY, 'gravity', 'gravity', this.setGravity, null);

      // refresh style on change of global desklet setting for decorations
      global.settings.connect('changed::desklet-decorations', Lang.bind(this, this.updateStyle));

      // attempt to restore old settings on upgrade from <3.0 to 3.0+ if necessary
      if (this.old_stationID &&
        (this[`${this.old_webservice}__stationID`] == '012.34,-56.78' ||
          this[`${this.old_webservice}__stationID`] == '2643743' ||
          this[`${this.old_webservice}__stationID`] == 'STATIONID123'))
        this[`${this.old_webservice}__stationID`] = this.old_stationID;
      if (this.old_apikey && !this[`${this.old_webservice}__apikey`])
        this[`${this.old_webservice}__apikey`] = this.old_apikey;
      if (this.old_webservice && this.webservice != this.old_webservice) this.webservice = this.old_webservice;
      if (this.old_transparency && this.transparency != this.old_transparency) this.transparency = this.old_transparency;

      // define a subprocess launcher
      this.launcher = new Gio.SubprocessLauncher({
        flags: (Gio.SubprocessFlags.STDIN_PIPE |
          Gio.SubprocessFlags.STDOUT_PIPE |
          Gio.Subprocess.STDERR_PIPE)
      });

      // set a header for those that don't override the theme
      // The desklet title
      this.setHeader(_('Weather'));

      this._geocache = new Object();
      this._geocache.yahoo = new Object();
      this._geocache.google = new Object();

      this.helpFile = DESKLET_DIR + '/help.html';
      // Link to Help file in context menu
      this._menu.addAction(_('Help'), Lang.bind(this, function () {
        this.launcher.spawnv(['xdg-open', this.helpFile]);
      }));
      // Link to information on translating in context menu
      this._menu.addAction(_('Translate'), Lang.bind(this, function () {
        this.launcher.spawnv(['xdg-open', BBCWX_TRANSLATION_URL]);
      }));
      this.initForecast();
    }
    catch (e) {
      global.logError(e);
    }
    return true;
  },

  // Set everything up initially
  initForecast: function () {
    if (this.service) delete this.service;
    // select the the driver we need for this service
    switch (this.webservice) {
      case 'bbc':
        this.stationID = this.bbc__stationID;
        this.service = new BBC.Driver(this.stationID);
        break;
      case 'meteoblue':
        this.stationID = this.meteoblue__stationID;
        this.apikey = this.meteoblue__apikey;
        this.service = new Meteoblue.Driver(this.stationID, this.apikey);
        break;
      case 'nws':
        this.stationID = this.nws__stationID;
        this.service = new NWS.Driver(this.stationID, this.metadata.version);
        break;
      case 'openmeteo':
        this.stationID = this.openmeteo__stationID;
        this.service = new OpenMeteo.Driver(this.stationID);
        break;
      case 'owmfree':
        this.stationID = this.owmfree__stationID;
        this.apikey = this.owmfree__apikey;
        this.service = new OWMFree.Driver(this.stationID, this.apikey);
        break;
      case 'owm':
        this.stationID = this.owm__stationID;
        this.apikey = this.owm__apikey;
        this.service = new OWM.Driver(this.stationID, this.apikey);
        break;
      case 'weatherapi':
        this.stationID = this.weatherapi__stationID;
        this.apikey = this.weatherapi__apikey;
        this.service = new WeatherAPI.Driver(this.stationID, this.apikey);
        break;
      case 'weatherstack':
        this.stationID = this.weatherstack__stationID;
        this.apikey = this.weatherstack__apikey;
        this.service = new Weatherstack.Driver(this.stationID, this.apikey);
        break;
      case 'wwo':
        this.stationID = this.wwo__stationID;
        this.apikey = this.wwo__apikey;
        this.service = new WWO.Driver(this.stationID, this.apikey);
        break;
      case 'wunderground':
        this.stationID = this.wunderground__stationID;
        this.apikey = this.wunderground__apikey;
        this.service = new WU.Driver(this.stationID, this.apikey, this.wunderground__geocode);
        break;
      default:
        this.stationID = this.bbc__stationID;
        this.service = new BBC.Driver(this.stationID);
    }

    this._setDerivedValues();
    this._createWindow();
    this.setGravity();
    this._update_style();
    this._refreshweathers();
  },

  // Create the layout of our desklet. Certain settings changes require this
  // to be called again (eg change service, as capabilities change, change number
  // days of forecast to display
  _createWindow: function () {
    // in these circumstances we do not need to redraw the window from scratch as the elements haven't changed
    if ((this.no == this.oldno) && (this.oldwebservice == this.webservice) && (this.shifttemp == this.oldshifttemp) && !this.redrawNeeded) {
      return;
    }

    this.oldno = this.no;
    this.oldwebservice = this.webservice;
    this.oldshifttemp = this.shifttemp;
    this.redrawNeeded = false;

    // get rid of the signal to banner and main icon before we recreate a window
    try {
      if (this.bannersig) this.banner.disconnect(this.bannersig);
      if (this.cwiconsig && this.cwicon) this.cwicon.disconnect(this.cwiconsig);
      this.bannersig = null;
      this.cwiconsig = null;
    } catch (e) { }

    this.window = new St.BoxLayout({ vertical: (this.vertical == 1) ? true : false });

    this.cwicon = null;
    // container for link and refresh icon
    this.buttons = new St.BoxLayout({ vertical: false, x_align: St.Align.END, y_align: St.Align.END });
    // refresh icon
    this.iconbutton = new St.Icon({
      icon_name: 'view-refresh-symbolic',
      icon_type: St.IconType.SYMBOLIC
    });
    this.refreshbutton = new St.Button(); // container for refresh icon

    // these will hold the data for the three day forecast
    this.labels = [];
    this.fwicons = [];
    this.max = [];
    this.min = [];
    this.windd = [];
    this.winds = [];
    this.fhumidity = [];
    this.fpressure = [];
    this.eachday = [];

    // some labels need resetting in case we are redrawing after a change of service
    this.humidity = null;
    this.pressure = null;
    this.windspeed = null;
    this.feelslike = null;

    this._separatorArea = new St.DrawingArea({ style_class: BBCWX_SEPARATOR_STYLE });

    let ccap = this.show.cc;

    // current weather values
    if (ccap.humidity) this.humidity = this._createLabel();
    if (ccap.pressure) this.pressure = this._createLabel();
    if (ccap.wind_speed) this.windspeed = this._createLabel();
    if (ccap.feelslike) this.feelslike = this._createLabel();
    if (ccap.visibility) this.visibility = this._createLabel();

    // container for current weather values
    this.ctemp_values = new St.BoxLayout({ vertical: true, y_align: St.Align.END });
    // container for current weather labels
    this.ctemp_captions = new St.BoxLayout({ vertical: true, y_align: St.Align.END });
    // container for current weather
    this.ctemp = new St.BoxLayout({ vertical: false, x_align: St.Align.END, y_align: St.Align.END });

    // city and city container
    this.cityname = this._createLabel();
    this.city = new St.BoxLayout({ vertical: true });

    // container for right (horizontal) or lower (vertical) part of window
    this.container = new St.BoxLayout({ vertical: true, x_align: St.Align.END });
    // container for left (horizontal) or upper (vertical) part of window
    this.cweather = new St.BoxLayout({ vertical: true, x_align: St.Align.END });
    // current weather icon container
    if (ccap.weather) this.cwicon = new St.Button();
    // current weather text
    if (ccap.weather) this.weathertext = this._createLabel();

    // current temp on wide layouts
    if (this.shifttemp) {
      this.ctemp_bigtemp = new St.BoxLayout({ vertical: false, y_align: St.Align.END });
      this.currenttemp = this._createLabel();
      this.ctemp_bigtemp.add(this.currenttemp, ALIGN_CENTER);
      this.ctemp.add(this.ctemp_bigtemp, ALIGN_CENTER);
    }

    this.city.add(this.cityname, ALIGN_CENTER);

    // Next five strings are labels for current conditions
    if (ccap.humidity) {
      let cc_humidity = this._createLabel(_('Humidity:'));
      this.ctemp_captions.add(cc_humidity, ALIGN_RIGHT);
    }
    if (ccap.pressure) {
      let cc_pressure = this._createLabel(_('Pressure:'));
      this.ctemp_captions.add(cc_pressure, ALIGN_RIGHT);
    }
    if (ccap.wind_speed) {
      let cc_wind_speed = this._createLabel(_('Wind:'));
      this.ctemp_captions.add(cc_wind_speed, ALIGN_RIGHT);
    }
    if (ccap.feelslike) {
      let cc_feelslike = this._createLabel(_('Feels like:'));
      this.ctemp_captions.add(cc_feelslike, ALIGN_RIGHT);
    }
    if (ccap.visibility) {
      let cc_visibility = this._createLabel(_('Visibility:'));
      this.ctemp_captions.add(cc_visibility, ALIGN_RIGHT);
    }

    if (this.humidity) this.ctemp_values.add(this.humidity, ALIGN_LEFT);
    if (this.pressure) this.ctemp_values.add(this.pressure, ALIGN_LEFT);
    if (this.windspeed) this.ctemp_values.add(this.windspeed, ALIGN_LEFT);
    if (this.feelslike) this.ctemp_values.add(this.feelslike, ALIGN_LEFT);
    if (this.visibility) this.ctemp_values.add(this.visibility, ALIGN_LEFT);

    this.ctemp.add(this.ctemp_captions, ALIGN_RIGHT);
    this.ctemp.add(this.ctemp_values, ALIGN_LEFT);

    // build table to hold three day forecast
    this.fwtable = new St.Table();

    // Maximum temperature
    this.maxlabel = this._createLabel(_('Max:'));
    // Minimum temperature
    this.minlabel = this._createLabel(_('Min:'));
    // Wind speed (English translation is 'Wind:')
    this.windlabel = this._createLabel(_('Wind speed:'));
    // Wind direction
    this.winddlabel = this._createLabel(_('Dir:'));
    // Atmospheric pressure
    this.fpressurelabel = this._createLabel(_('Pressure:'));
    this.fhumiditylabel = this._createLabel(_('Humidity:'));

    let fcap = this.show.forecast;
    let row = 2;

    if (fcap.maximum_temperature) { this.fwtable.add(this.maxlabel, { ...ALIGN_RIGHT, row: row, col: 0 }); row++ }
    if (fcap.minimum_temperature) { this.fwtable.add(this.minlabel, { ...ALIGN_RIGHT, row: row, col: 0 }); row++ }
    if (fcap.wind_speed) { this.fwtable.add(this.windlabel, { ...ALIGN_RIGHT, row: row, col: 0 }); row++ }
    if (fcap.wind_direction) { this.fwtable.add(this.winddlabel, { ...ALIGN_RIGHT, row: row, col: 0 }); row++ }
    if (fcap.pressure) { this.fwtable.add(this.fpressurelabel, { ...ALIGN_RIGHT, row: row, col: 0 }); row++ }
    if (fcap.humidity) { this.fwtable.add(this.fhumiditylabel, { ...ALIGN_RIGHT, row: row, col: 0 }); row++ }
    for (let f = 0; f < this.no; f++) {
      this.labels[f] = this._createLabel();
      this.fwicons[f] = new St.Button();
      if (fcap.maximum_temperature) this.max[f] = this._createLabel();
      if (fcap.minimum_temperature) this.min[f] = this._createLabel();
      if (fcap.wind_speed) this.winds[f] = this._createLabel();
      if (fcap.wind_direction) this.windd[f] = this._createLabel();
      if (fcap.pressure) this.fpressure[f] = this._createLabel();
      if (fcap.humidity) this.fhumidity[f] = this._createLabel();
      this.wxtooltip[f] = new Tooltips.Tooltip(this.fwicons[f]);

      this.fwtable.add(this.labels[f], { ...ALIGN_CENTER, row: 0, col: f + 1 });
      this.fwtable.add(this.fwicons[f], { ...ALIGN_CENTER, row: 1, col: f + 1 });
      row = 2;
      if (this.max[f]) { this.fwtable.add(this.max[f], { ...ALIGN_CENTER, row: row, col: f + 1 }); row++ }
      if (this.min[f]) { this.fwtable.add(this.min[f], { ...ALIGN_CENTER, row: row, col: f + 1 }); row++ }
      if (this.winds[f]) { this.fwtable.add(this.winds[f], { ...ALIGN_CENTER, row: row, col: f + 1 }); row++ }
      if (this.windd[f]) { this.fwtable.add(this.windd[f], { ...ALIGN_CENTER, row: row, col: f + 1 }); row++ }
      if (this.fpressure[f]) { this.fwtable.add(this.fpressure[f], { ...ALIGN_CENTER, row: row, col: f + 1 }); row++ }
      if (this.fhumidity[f]) { this.fwtable.add(this.fhumidity[f], { ...ALIGN_CENTER, row: row, col: f + 1 }); row++ }
    }

    this.buttoncontainer = new St.BoxLayout({ vertical: true, x_align: St.Align.END, y_align: St.Align.END });

    this.refreshbutton.set_child(this.iconbutton);
    this.refreshbutton.connect('clicked', Lang.bind(this, this._refreshweathers));

    // seems we have to use a button for banners to get the vertical
    // alignment :(
    this._setLastUpdated();

    // Credit the data supplier. A link to the data supplier appears to the
    // right of this string
    this.bannerpre = new St.Button({ label: _('Data from ') });
    this.bannerpost = new St.Button({ label: ' ' });
    this.hoverlink = this.service.linkURL != '' ? true : false;
    this.hoverclass = this.service.linkURL != '' ? 'bbcwx-link' : '';
    this.banner = new St.Button({
      reactive: this.hoverlink,
      track_hover: this.hoverlink,
      style_class: this.hoverclass
    });
    this.bannericon = new St.Button({
      reactive: this.hoverlink,
      track_hover: this.hoverlink,
      style_class: this.hoverclass
    });
    this.linkurltooltip = this.service.linkURL ? this.linktooltip : '';
    this.bannertooltip = new Tooltips.Tooltip(this.banner, this.linkurltooltip);
    if (this.cwicon) this.cwicontooltip = new Tooltips.Tooltip(this.cwicon);
    // Tooltip for refresh button
    this.refreshtooltip = new Tooltips.Tooltip(this.refreshbutton, _('Refresh'));
    this.buttons.add_actor(this.bannerpre);
    this.buttons.add_actor(this.banner);
    this.buttons.add_actor(this.bannerpost);
    this.buttons.add_actor(this.refreshbutton);
    this.buttoncontainer.add_actor(this.bannericon);
    this.buttoncontainer.add_actor(this.bannerupdated);
    this.buttoncontainer.add_actor(this.buttons);
    this.container.add_actor(this.ctemp);
    this.container.add_actor(this._separatorArea);
    this.container.add_actor(this.fwtable);
    this.cweather.add_actor(this.city);
    if (this.cwicon) this.cweather.add(this.cwicon, ALIGN_CENTER);
    if (this.weathertext) this.cweather.add(this.weathertext, ALIGN_CENTER);
    this.container.add_actor(this.buttoncontainer);
    this.window.add_actor(this.cweather);
    this.window.add_actor(this.container);

    this.setContent(this.window);
  },

  // Add the current time to the display
  _setLastUpdated: function () {
    this.currentTime = new Date();
    this.lastupdated = this.currentTime.toLocaleFormat('%c');
    this.bannerupdated = new St.Button({ label: this.lastupdated, style: 'text-align: center;' });
    this.updatedtooltip = new Tooltips.Tooltip(this.bannerupdated, _('Last updated'));
  },

  // Set some internal values derived from user choices
  _createLabel: function (text) {
    let label = new St.Label({ text: text ? text : null });
    label.clutterText.ellipsize = Pango.EllipsizeMode.NONE;

    return label;
  },

  // Set some internal values derived from user choices
  _setDerivedValues: function () {
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
    this.show = JSON.parse(JSON.stringify(this.service.capabilities));
    let displayopts = ['display__cc__pressure', 'display__cc__wind_speed',
      'display__cc__humidity', 'display__cc__feelslike', 'display__cc__visibility',
      'display__forecast__wind_speed', 'display__forecast__wind_direction',
      'display__forecast__maximum_temperature', 'display__forecast__minimum_temperature',
      'display__forecast__humidity', 'display__forecast__pressure',
      'display__meta__country', 'display__meta__region'
    ];
    let ccShowCount = 0;
    for (let i = 0; i < displayopts.length; i++) {
      let parts = displayopts[i].split('__');
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
      this.shifttemp = true;
      this.currenttempsize = this.currenttempsize * 1.7;
      this.vertical = 1;
      // don't right pad the temperature if there's nothing to its right
      if (ccShowCount < 1) this.currenttempadding = 0;
    }
  },

  // Set internal values for icons
  _initIcons: function () {
    this.iconprops = this._getIconMeta(this.iconstyle);
    this.defaulticonprops = this._getIconMeta(BBCWX_DEFAULT_ICONSET);

    // global.log('_initIcons set values ' + this.iconprops.aspect + ' ; ' + this.iconprops.ext + ' ; ' + this.iconprops.adjust + ' using ' + this.iconstyle);
  },

  // Fetch the icon set meta data
  _getIconMeta: function (iconset) {
    let iconprops = new Object();
    let deficonprops = {
      aspect: 1,
      adjust: 1,
      ext: 'png',
      map: {}
    }

    let file = Gio.file_new_for_path(DESKLET_DIR + '/icons/' + iconset + '/iconmeta.json');
    try {
      let raw_json = GLib.file_get_contents(file.get_path())[1];
      let textDecoder = new TextDecoder('utf-8');
      let raw_file = textDecoder.decode(raw_json);
      iconprops = JSON.parse(raw_file);
    } catch (e) {
      global.logError('Failed to parse iconmeta.json for iconset ' + this.iconstyle);
    }
    // set anything missing to default values
    for (let prop in deficonprops) {
      if (typeof iconprops[prop] === 'undefined') {
        iconprops[prop] = deficonprops[prop];
      }
    }
    return iconprops;
  },

  // Called when some change requires the styling of the desklet to be updated
  updateStyle: function () {
    // set values for this.iconprops
    this._setDerivedValues();
    // update style
    this._update_style();
    // also need to run these to update icon style and size
    this.displayForecast();
    this.displayCurrent();
    this.displayMeta();
  },

  // Called when units are changed
  onUnitChange: function () {
    this.displayForecast();
    this.displayCurrent();
  },

  // Called when temperature units are updated. If service text summaries include
  // units we must refetch forecast, otherwise just refresh display
  onTempUnitChange: function () {
    this.onUnitChange();
    if (this.service.unitsInSummaries) {
      this._refreshweathers();
    }
  },

  // Does the bulk of the work of updating style
  _update_style: function () {
    // global.log('bbcwx (instance ' + this.desklet_id + '): entering _update_style');
    this.window.vertical = (this.vertical == 1) ? true : false;
    if (this.cwicon) {
      this.cwicon.height = BBCWX_CC_ICON_HEIGHT * this.zoom;
      this.cwicon.width = BBCWX_CC_ICON_HEIGHT * this.iconprops.aspect * this.zoom;
    }
    if (this.weathertext) this.weathertext.style = 'text-align: center; font-size:' + BBCWX_CC_TEXT_SIZE * this.zoom + 'px';
    if (this.currenttemp) this.currenttemp.style = 'text-align: center; font-size:' + this.currenttempsize * this.zoom + 'px';
    if (this.ctemp_bigtemp) this.ctemp_bigtemp.style = 'text-align: left; padding-right: ' + this.currenttempadding * this.zoom + 'px';
    this.fwtable.style = 'spacing-rows: ' + BBCWX_TABLE_ROW_SPACING * this.zoom + 'px;spacing-columns: ' + BBCWX_TABLE_COL_SPACING * this.zoom + 'px;padding: ' + BBCWX_TABLE_PADDING * this.zoom + 'px;';
    this.cityname.style = 'text-align: center;font-size: ' + BBCWX_TEXT_SIZE * this.zoom + 'px; font-weight: ' + ((this.citystyle) ? 'bold' : 'normal') + ';';
    this.ctemp_captions.style = 'text-align: right;font-size: ' + BBCWX_TEXT_SIZE * this.zoom + 'px; padding-right: ' + BBCWX_LABEL_PADDING * this.zoom + 'px';
    this.ctemp_values.style = 'text-align: left; font-size: ' + BBCWX_TEXT_SIZE * this.zoom + 'px';

    if (this.overrideTheme) {
      // hide header and use a style with no border
      this._header.hide();
      this.window.set_style_class_name('desklet');
      if (this.border) {
        let borderradius = (this.borderwidth > this.cornerradius) ? this.borderwidth : this.cornerradius;
        this.window.style = 'border: ' + this.borderwidth + 'px solid ' + this.bordercolor + '; border-radius: ' + borderradius + 'px; background-color: ' + (this.bgcolor.replace(')', ',' + this.transparency + ')')).replace('rgb', 'rgba') + '; color: ' + this.textcolor;
      }
      else {
        this.window.style = 'border-radius: ' + this.cornerradius + 'px; background-color: ' + (this.bgcolor.replace(')', ',' + this.transparency + ')')).replace('rgb', 'rgba') + '; color: ' + this.textcolor;
      }
      this.banner.style = 'font-size: ' + BBCWX_LINK_TEXT_SIZE * this.zoom + 'px; color: ' + this.textcolor;
      this.bannerupdated.style = 'font-size: ' + BBCWX_LINK_TEXT_SIZE * this.zoom + 'px; color: ' + this.textcolor;
      this.bannerpre.style = 'font-size: ' + BBCWX_LINK_TEXT_SIZE * this.zoom + 'px; color: ' + this.textcolor;
      if (this.service.linkURL) this.banner.set_style_class_name('bbcwx-link');
      if (this.textshadow) this.window.style = this.window.style + ';text-shadow: 1px 1px ' + this.shadowblur + 'px ' + contrastingColor(this.textcolor);
    } else {
      this.window.set_style('');
      // set style_class and _header visibility according to
      // global desklet settings for theme
      let dec = global.settings.get_int('desklet-decorations');
      switch (dec) {
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
      this.banner.style = 'font-size: ' + BBCWX_LINK_TEXT_SIZE * this.zoom + 'px;';
      this.bannerupdated.style = 'font-size: ' + BBCWX_LINK_TEXT_SIZE * this.zoom + 'px;';
      this.bannerpre.style = 'font-size: ' + BBCWX_LINK_TEXT_SIZE * this.zoom + 'px;';
    }
    this._separatorArea.height = 5 * this.zoom;

    for (let f = 0; f < this.no; f++) {
      this.labels[f].style = 'text-align: center;font-size: ' + BBCWX_TEXT_SIZE * this.zoom + 'px';
      this.fwicons[f].height = BBCWX_ICON_HEIGHT * this.zoom;
      this.fwicons[f].width = BBCWX_ICON_HEIGHT * this.iconprops.aspect * this.zoom;
      if (this.max[f]) this.max[f].style = 'text-align: center; font-size: ' + BBCWX_TEXT_SIZE * this.zoom + 'px';
      if (this.min[f]) this.min[f].style = 'text-align: center; font-size: ' + BBCWX_TEXT_SIZE * this.zoom + 'px';
      if (this.winds[f]) this.winds[f].style = 'text-align: center; font-size: ' + BBCWX_TEXT_SIZE * this.zoom + 'px';
      if (this.windd[f]) this.windd[f].style = 'text-align: center; font-size: ' + BBCWX_TEXT_SIZE * this.zoom + 'px';
      if (this.fpressure[f]) this.fpressure[f].style = 'text-align: center; font-size: ' + BBCWX_TEXT_SIZE * this.zoom + 'px';
      if (this.fhumidity[f]) this.fhumidity[f].style = 'text-align: center; font-size: ' + BBCWX_TEXT_SIZE * this.zoom + 'px';
    }

    this.buttons.style = 'padding-top:' + BBCWX_BUTTON_PADDING * this.zoom + 'px;padding-bottom:' + BBCWX_BUTTON_PADDING * this.zoom + 'px';

    this.iconbutton.icon_size = BBCWX_REFRESH_ICON_SIZE * this.zoom;

    let forecastlabels = ['maxlabel', 'minlabel', 'windlabel', 'winddlabel', 'fpressurelabel', 'fhumiditylabel'];
    for (let i = 0; i < forecastlabels.length; i++) {
      if (this[forecastlabels[i]]) this[forecastlabels[i]].style = 'text-align: right;font-size: ' + BBCWX_LABEL_TEXT_SIZE * this.zoom + 'px';
    }

    this.cweather.style = 'padding: ' + BBCWX_CONTAINER_PADDING * this.zoom + 'px';
    if (this.vertical == 1) {
      // loose the top padding on container in vertical mode (too much space)
      this.container.style = 'padding: 0 ' + BBCWX_CONTAINER_PADDING * this.zoom + 'px ' + BBCWX_CONTAINER_PADDING * this.zoom + 'px ' + BBCWX_CONTAINER_PADDING * this.zoom + 'px ';
    } else {
      this.container.style = 'padding: ' + BBCWX_CONTAINER_PADDING * this.zoom + 'px';
    }
  },

  // Change the location we are displaying weather for
  changeStation: function (value) {
    this.stationID = value;
    this.service.setStation(this.stationID);
    this._refreshweathers();
  },

  // Change the API key and reget weather data
  changeApiKey: function (value) {
    this.apikey = value;
    this.service.setApiKey(this.apikey);
    this._refreshweathers();
  },

  // Change the refresh period and restart the loop
  changeRefresh: function () {
    this._setDerivedValues();
    this._doLoop();
  },

  // Called when there is a change to user config for parameters to display
  displayOptsChange: function () {
    this.redrawNeeded = true;
    this.redraw();
  },

  // redraw the window, but without refetching data from the service provider
  redraw: function () {
    this._setDerivedValues();
    this._createWindow();
    this._update_style();
    this.displayCurrent();
    this.displayForecast();
    this.displayMeta();
  },

  // update the forecast data from the service and start the timeout to the
  // next update
  // refreshData will call the display* functions
  _refreshweathers: function () {
    // For debugging purposes
    // let now = new Date().toLocaleFormat('%H:%M:%S');
    // global.log('bbcwx (instance ' + this.desklet_id + '): refreshing forecast at ' + now);

    // Remove the existing time banner
    if (this.bannerupdated && this.buttoncontainer) {
      this.buttoncontainer.remove_actor(this.bannericon);
      this.buttoncontainer.remove_actor(this.bannerupdated);
      this.buttoncontainer.remove_actor(this.buttons);
    }

    // Update the current time for the display
    this._setLastUpdated();
    this.buttoncontainer.add_actor(this.bannericon);
    this.buttoncontainer.add_actor(this.bannerupdated);
    this.buttoncontainer.add_actor(this.buttons);

    // pass this to refreshData as it needs to call display* functions once the data
    // is updated
    this.service.refreshData(this);
    this.redraw();
    this._doLoop();
  },

  // Begin / restart the main loop, waiting for refreshSec before updating again
  _doLoop: function () {
    if (typeof this._timeoutId !== 'undefined') {
      Mainloop.source_remove(this._timeoutId);
    }

    this._timeoutId = Mainloop.timeout_add_seconds(this.refreshSec, Lang.bind(this, this._refreshweathers));
  },

  // Update the display of the forecast data
  displayForecast: function () {
    // global.log('bbcwx (instance ' + this.desklet_id + '): entering displayForecast');
    for (let f = 0; f < this.no; f++) {
      let day = this.service.data.days[f];
      this.labels[f].text = (this.daynames[day.day]) ? this.daynames[day.day] : '';
      let fwiconimage = this._getIconImage(day.icon, BBCWX_ICON_HEIGHT * this.zoom);
      // fwiconimage.set_size(BBCWX_ICON_HEIGHT*this.iconprops.aspect*this.zoom, BBCWX_ICON_HEIGHT*this.zoom);
      this.fwicons[f].set_child(fwiconimage);
      // Message if we fail to get weather data
      this.wxtooltip[f].set_text((day.weathertext) ? _(day.weathertext) : _('No Data Available'));
      if (this.max[f]) this.max[f].text = this._formatTemperature(day.maximum_temperature, true);
      if (this.min[f]) this.min[f].text = this._formatTemperature(day.minimum_temperature, true);
      if (this.winds[f]) this.winds[f].text = this._formatWindspeed(day.wind_speed, true);
      if (this.windd[f]) this.windd[f].text = (day.wind_direction) ? day.wind_direction : '';
      if (this.fpressure[f]) this.fpressure[f].text = this._formatPressure(day.pressure, '', true);
      if (this.fhumidity[f]) this.fhumidity[f].text = this._formatHumidity(day.humidity, true);
    }
  },

  // Update the display of the current observations
  displayCurrent: function () {
    let cc = this.service.data.cc;
    if (this.cwicon) {
      let cwimage = this._getIconImage(this.service.data.cc.icon, BBCWX_CC_ICON_HEIGHT * this.zoom);
      // cwimage.set_size(BBCWX_CC_ICON_HEIGHT*this.iconprops.aspect*this.zoom, BBCWX_CC_ICON_HEIGHT*this.zoom);
      this.cwicon.set_child(cwimage);
    }
    if (this.shifttemp) {
      if (this.weathertext) this.weathertext.text = (cc.weathertext) ? cc.weathertext : '';
      this.currenttemp.text = this._formatTemperature(cc.temperature, true);
    } else {
      if (this.weathertext) this.weathertext.text = ((cc.weathertext) ? cc.weathertext : '') + ((cc.has_temp && cc.weathertext) ? ', ' : '') + this._formatTemperature(cc.temperature, true);
    }

    if (this.humidity) this.humidity.text = this._formatHumidity(cc.humidity);
    if (this.pressure) this.pressure.text = this._formatPressure(cc.pressure, cc.pressure_direction, true);
    if (this.windspeed) this.windspeed.text = ((cc.wind_direction) ? cc.wind_direction : '') + ((cc.wind_direction && typeof cc.wind_speed !== 'undefined' && cc.wind_speed !== null) ? ', ' : '') + this._formatWindspeed(cc.wind_speed, true);
    if (this.feelslike) this.feelslike.text = this._formatTemperature(cc.feelslike, true);
    if (this.visibility) this.visibility.text = this._formatVisibility(cc.visibility, true);
    if (this.service.data.status.cc != SERVICE_STATUS_OK && this.weathertext) {
      this.weathertext.text = (this.service.data.status.lasterror) ? _('Error: %s').format(this.service.data.status.lasterror) : _('No Data');
    }
  },

  // Update the display of the meta data, eg city name, link tooltip. Handles
  // managing reverse geocode lookups from Yahoo or Google if needed
  displayMeta: function () {
    let locsrc = this.locsrc;
    if (this.manuallocation.toString().length) locsrc = 'manual';

    this.displaycity = '';
    this.tooltiplocation = '';

    if (locsrc == 'manual') {
      this.displaycity = this.manuallocation;
      this.tooltiplocation = this.manuallocation;
    } else {
      // if city name from service is empty, use wgs84, or stationID
      if (!this.service.data.city.toString().length) {
        if (this.service.capabilities.meta.wgs84 && this.service.data.status.meta === SERVICE_STATUS_OK) {
          // If city name is empty and source is 'service', we'll look it up with Google!
          if (locsrc == 'service') locsrc = 'google';
          this.displaycity = this.service.data.wgs84.lat + ',' + this.service.data.wgs84.lon;
          this.tooltiplocation = this.service.data.wgs84.lat + ',' + this.service.data.wgs84.lon;
        } else {
          this.displaycity = this.stationID;
          this.tooltiplocation = this.stationID;
        }
      } else {
        // initially set the displayed location to that from the data service,
        // if available. Google / Yahoo lookups we'll do asyncronously later
        this.displaycity = this.service.data.city;
        this.tooltiplocation = this.service.data.city;
        if (this.show.meta.region && this.service.data.region) {
          this.displaycity += ', ' + this.service.data.region;
        }
        if (this.show.meta.country && this.service.data.country) {
          this.displaycity += ', ' + this.service.data.country;
        }
      }
    }

    // initial update (Google/Yahoo to follow)
    this._updateLocationDisplay();

    if (this.service.linkIcon) {
      let bannericonimage = this._getIconImage(this.service.linkIcon.file, this.service.linkIcon.height * this.zoom, this.service.linkIcon.width * this.zoom, false);
      // bannericonimage.set_size(this.service.linkIcon.width*this.zoom, this.service.linkIcon.height*this.zoom);
      this.bannericon.set_child(bannericonimage);
    }
    this.banner.label = this.service.linkText;

    try {
      if (this.bannersig) this.banner.disconnect(this.bannersig);
      if (this.cwiconsig && this.cwicon) this.cwicon.disconnect(this.cwiconsig);
      this.bannersig = null;
      this.cwiconsig = null;
    } catch (e) { global.logWarning('Failed to disconnect signal from link banner') }
    this.bannersig = this.banner.connect('clicked', Lang.bind(this, function () {
      if (this.service.linkURL) this.launcher.spawnv(['xdg-open', this.service.linkURL]);
    }));
    if (this.cwicon && this.service.linkURL) {
      this.cwiconsig = this.cwicon.connect('clicked', Lang.bind(this, function () {
        this.launcher.spawnv(['xdg-open', this.service.linkURL]);
      }));
    }

    if (this.service.data.status.meta !== SERVICE_STATUS_OK) {
      this.cityname.text = (this.service.data.status.lasterror) ? _('Error: %s').format(this.service.data.status.lasterror) : _('No Data');
    }

    // do async lookup of location with yahoo or google
    else if (this.service.capabilities.meta.wgs84 && (locsrc == 'yahoo' || locsrc == 'google')) {
      let latlon = this.service.data.wgs84.lat + ',' + this.service.data.wgs84.lon;
      // check the cache
      if (typeof this._geocache[locsrc][latlon] === 'object' && typeof this._geocache[locsrc][latlon].city !== 'undefined') {
        // debugging
        // global.log ('bbcwx: geocache hit for ' + latlon + ', ' + locsrc + ': ' + this._geocache[locsrc][latlon].city);
        this.displaycity = this._geocache[locsrc][latlon].city;
        this.tooltiplocation = this.displaycity;
        if (this.show.meta.country) {
          if (this._geocache[locsrc][latlon].country !== 'undefined') this.displaycity += ', ' + this._geocache[locsrc][latlon].country;
        }
        this._updateLocationDisplay();
        // no cache - lookup
      } else {
        // debugging
        // global.log ('bbcwx: Looking up city for ' + latlon + ' at ' + locsrc);
        let b = this._getGeo(locsrc, function (geo, locsrc) {
          if (geo) {
            this._load_geo(geo, locsrc);
            this._updateLocationDisplay();
          }
        });
      }
    }
  },

  // Update the display of city name and link tooltip
  _updateLocationDisplay: function () {
    this.cityname.text = this.displaycity;
    // %s is replaced by place name
    this.linktooltip = _('Click for the full forecast for %s').format(this.tooltiplocation);
    if (this.service.linkURL) this.bannertooltip.set_text(this.linktooltip);
    if (this.cwicontooltip && this.service.linkURL) this.cwicontooltip.set_text(this.linktooltip);
  },

  // Do async reverse geocode lookups at Yahoo! or Google
  // -> locsrc: which service to use: either 'yahoo' or 'google'
  // -> callback: callback function to process returned results
  // NB Yahoo service no longer available :(
  _getGeo: function (locsrc, callback) {
    // just use the most preferred language and hope Yahoo! / Google  supports it
    let locale = LANGLIST[0];
    let url = '';
    if (locsrc == 'yahoo') {
      url = 'http://query.yahooapis.com/v1/public/yql?q=select%20*%20from%20geo.placefinder%20where%20text%3D%22' + this.service.data.wgs84.lat + '%2C' + this.service.data.wgs84.lon + '%22%20and%20gflags%3D%22R%22%20and%20locale%3D%22' + locale + '%22&format=json&callback=';
    } else if (locsrc == 'google') {
      url = 'https://maps.googleapis.com/maps/api/geocode/json?latlng=' + this.service.data.wgs84.lat + '%2C' + this.service.data.wgs84.lon + '&language=' + locale;
    } else {
      // set some error flag?
      return;
    }
    // debugging
    // global.log('bbcwx: geo, calling ' + url);
    var here = this;
    let message = Soup.Message.new('GET', url);
    _httpSession.timeout = 10;
    _httpSession.idle_timeout = 10;
    if (Soup.MAJOR_VERSION === undefined || Soup.MAJOR_VERSION === 2) {
      _httpSession.queue_message(message, function (session, message) {
        if (message.status_code == 200) {
          try { callback.call(here, message.response_body.data.toString(), locsrc); } catch (e) { global.logError(e) }
        } else {
          global.logWarning('Error retrieving address ' + url + '. Status: ' + message.status_code + ': ' + message.reason_phrase);
          // here.data.status.lasterror = message.status_code;
          callback.call(here, false, locsrc);
        }
      });
    } else { // Soup 3.0
      _httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, function (session, result) {
        if (message.get_status() === 200) {
          try {
            const bytes = _httpSession.send_and_read_finish(result);
            callback.call(here, ByteArray.toString(bytes.get_data()), locsrc);
          } catch (e) { global.logError(e) }
        } else {
          global.logWarning('Error retrieving address ' + url + '. Status: ' + message.get_status() + ': ' + message.get_reason_phrase());
          // here.data.status.lasterror = message.get_status();
          callback.call(here, false, locsrc);
        }
      });
    }
  },

  // Call back function to process returned object from reverse geocode lookups
  // Wraper around _load_geo_yahoo and _load_geo_google
  // -> data: returned data
  // -> locsrc: the service it came from, 'yahoo' or 'google'
  _load_geo: function (data, locsrc) {
    switch (locsrc) {
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

  // Call back function to process returned object from reverse geocode lookups
  // from Yahoo!
  _load_geo_yahoo: function (data) {
    if (!data) {
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
    } catch (e) {
      global.logError(e);
      delete this._geocache.yahoo[latlon];
    }
  },

  // Call back function to process returned object from reverse geocode lookups
  // from Google
  _load_geo_google: function (data) {
    if (!data) {
      return;
    }
    let city = '';
    let country = '';
    let geo = new Object();
    let addrtypes = ['xlocality', 'xstreetaddr', 'xpostal_code', 'administrative_area_level_3', 'administrative_area_level_2', 'administrative_area_level_1', 'xcountry'];
    for (let a = 0; a < addrtypes.length; a++) {
      geo[addrtypes[a]] = new Object();
    }

    let json = JSON.parse(data);

    let latlon = this.service.data.wgs84.lat + ',' + this.service.data.wgs84.lon;
    this._geocache.google[latlon] = new Object();

    try {
      let results = json.results;
      for (let i = 0; i < results.length; i++) {
        for (let t = 0; t < results[i].types.length; t++) {
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
          if (results[i].types[t] == 'postal_code' && results[i].types.join().indexOf('postal_code_prefix') == -1) {
            geo.xpostal_code = results[i];
          }
        }
      }

      for (let a = 0; a < addrtypes.length; a++) {
        if (typeof geo[addrtypes[a]].address_components !== 'undefined' && (!city || !country)) {
          let components = geo[addrtypes[a]].address_components;
          for (let i = 0; i < components.length; i++) {
            for (let t = 0; t < components[i].types.length; t++) {
              if (components[i].types[t] == 'locality' && !city) {
                city = components[i].long_name;
              }
              if (components[i].types[t] == 'country' && !country) {
                country = components[i].long_name;
              }
            }
            if (!city) {
              for (let t = 0; t < components[i].types.length; t++) {
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
    } catch (e) {
      global.logError(e);
      delete this._geocache.google[latlon];
    }
  },

  // Get an icon
  // -> iconcode: the code of the icon
  // -> h: the base height of the icon
  // -> w: the base width of the icon. If not specified this is calculated from
  //       the iconsets 'aspect' property and h
  // -> adjust: boolean, whether to adjust h and w by the value of the iconsets
  //            adjust property
  _getIconImage: function (iconcode, h, w, adjust) {
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
      height = height * this.iconprops.adjust;
      width = width * this.iconprops.adjust;
    }
    let icon_file = DESKLET_DIR + '/icons/' + this.iconstyle + '/' + icon_name + icon_ext;
    let file = Gio.file_new_for_path(icon_file);
    if (!file.query_exists(null)) {
      icon_name = (typeof this.defaulticonprops.map[iconcode] != 'undefined') ? this.defaulticonprops.map[iconcode] : iconcode;
      icon_file = DESKLET_DIR + '/icons/' + BBCWX_DEFAULT_ICONSET + '/' + icon_name + '.' + this.defaulticonprops.ext;
      width = w ? w : h * this.defaulticonprops.aspect;
      height = h;
      if (adjust) {
        height = height * this.defaulticonprops.adjust;
        width = width * this.defaulticonprops.adjust;
      }
      file = Gio.file_new_for_path(icon_file);
    }
    let icon_uri = file.get_uri();

    let iconimg = St.TextureCache.get_default().load_uri_async(icon_uri, width, height);
    iconimg.set_size(width, height);
    return iconimg;
  },

  setGravity: function () {
    if (this.experimental_enabled) {
      this.actor.move_anchor_point_from_gravity(this.gravity);
    } else {
      this.actor.move_anchor_point_from_gravity(0);
    }
  },

  // take a temperature in C and convert as needed.
  // Append unit string if units is true
  _formatTemperature: function (temp, units) {
    units = typeof units !== 'undefined' ? units : false;
    if (typeof temp === 'undefined' || temp === null) return '';
    if (!temp.toString().length) return '';
    let celsius = 1 * temp;
    let fahr = (celsius * 1.8) + 32;
    let out = Math.round((this.tunits == 'F') ? fahr : celsius);
    // Units for temperature, degrees Fahrenheit. %f is replaced the value.
    // NB: English translation uses unicode character u+2109
    let fahrfmt = _('%f\u00b0F');
    // Units for temperature, degrees Celsius. %f is replaced the value.
    // NB: English translation uses unicode character u+2103
    let celfmt = _('%f\u00b0C');
    if (units) {
      out = (this.tunits == 'F') ? fahrfmt.format(out) : celfmt.format(out);
    }
    return out;
  },

  // take a wind speed in km/h and convert to required
  // units. Append unit string if units is true
  _formatWindspeed: function (wind, units) {
    units = typeof units !== 'undefined' ? units : false;
    if (typeof wind === 'undefined' || wind === null) return '';
    if (!wind.toString().length) return '';
    let conversion = {
      'mph': 0.621,
      'knots': 0.54,
      'kph': 1,
      'mps': 0.278
    };
    // wind speed, miles per hour. %f is replaced by the value
    let mphfmt = _('%fmph');
    // wind speed, knots. %f is replaced by the value
    let knotfmt = _('%fkn');
    // wind speed, kilometers per hour. %f is replaced by the value
    let kphfmt = _('%fkm/h');
    // wind speed, meters per second. %f is replaced by the value
    let mpsfmt = _('%fm/s');
    let unitstring = {
      'mph': mphfmt,
      'knots': knotfmt,
      'kph': kphfmt,
      'mps': mpsfmt
    }
    let kph = 1 * wind;
    let out = kph * conversion[this.wunits];
    out = out.toFixed(0);
    if (units) {
      // out += unitstring[this.wunits];
      out = unitstring[this.wunits].format(out);
    }
    return out;
  },

  // take a pressure in mb and convert as needed. Append units and trajectory
  // -> pressure: real, pressure (in mb)
  // -> direction: string, direction of travel, or false
  // -> units: boolean, append units
  _formatPressure: function (pressure, direction, units) {
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
    // pressure, millbars. %f is replaced by the value
    let mbfmt = _('%fmb');
    // pressure, inches of mercury. %f is replaced by the value
    let infmt = _('%fin');
    // pressure, mm of mercury. %f is replaced by the value
    let mmfmt = _('%fmm');
    // pressure, kilopascals. %f is replaced by the value
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
      'kpa': 1
    };
    let mb = 1 * pressure;
    let out = mb * conversion[this.punits];

    // TODO prepare this for gettext
    out = out.toFixed(precission[this.punits]);
    if (units) {
      out = unitstring[this.punits].format(out);
    }
    if (direction) {
      out += ', ' + direction;
    }
    return out;
  },

  _formatHumidity: function (humidity) {
    if (!humidity.toString().length) return '';
    let out = 1 * humidity;
    out = out.toFixed(0);
    return out + '%';
  },

  // take a visibility and converts to the required format. Strings are returned
  // as such, numbers (assumed km) are converted. Append unit string if units is true
  _formatVisibility: function (vis, units) {
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
    // visibility, miles. %f is replaced by the value
    let mifmt = _('%fmi');
    // visibility, nautical miles. %f is replaced by the value
    let nmifmt = _('%fnmi');
    // visibility, kilometers. %f is replaced by the value
    let kmfmt = _('%fkm');
    let unitstring = {
      'mph': mifmt,
      'knots': nmifmt,
      'kph': kmfmt,
      'mps': kmfmt
    }
    let km = 1 * vis;
    let out = km * conversion[this.wunits];
    let decpl = (out < 4) ? 1 : 0;
    out = out.toFixed(decpl);
    if (units) {
      out = unitstring[this.wunits].format(out);
    }
    return out;
  },

  on_desklet_removed: function () {
    if (typeof this._timeoutId !== 'undefined') {
      Mainloop.source_remove(this._timeoutId);
    }
  }
};

// Utility function to capitalise first letter of each word in a string
String.prototype.ucwords = function () {
  return this.replace(/(?:^|\s)\S/g, function (a) { return a.toUpperCase(); });
}

// Choose automatically contrasting black or white shadow color dependent on text color
function contrastingColor(color) {
  return (luma(color) >= 165) ? '#000000' : '#ffffff';
}

function luma(color) {
  // SMPTE C, Rec. 709 weightings
  let hex = rgb2hex(color);
  let r = parseInt(hex.slice(0, 2), 16);
  let g = parseInt(hex.slice(2, 4), 16);
  let b = parseInt(hex.slice(4), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rgb2hex(rgb) {
  let rgbSplit = rgb.split('(')[1].split(')')[0];
  rgbSplit = rgbSplit.split(',');
  let hex = rgbSplit.map(function (hexCol) {             // For each array element
    hexCol = parseInt(hexCol).toString(16);              // Convert to a base16 string
    return (hexCol.length == 1) ? '0' + hexCol : hexCol; // Add zero if we get only one character
  });
  return hex.join('');
}

function main(metadata, desklet_id) {
  let desklet = new MyDesklet(metadata, desklet_id);
  return desklet;
}
