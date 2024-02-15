// Weather Underground Driver
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const UUID = 'bbcwx@oak-wood.co.uk';
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
imports.searchPath.push(`${DESKLET_DIR}/drivers`);
const wxBase = imports.wxbase;

const SERVICE_STATUS_ERROR = wxBase.SERVICE_STATUS_ERROR;
const SERVICE_STATUS_OK = wxBase.SERVICE_STATUS_OK;

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + '/.local/share/locale');

function _(str) {
  if (str) return Gettext.dgettext(UUID, str);
}

var Driver = class Driver extends wxBase.Driver {
  // initialize the driver
  constructor(stationID, apikey) {
    super(stationID, apikey);
    this.capabilities.cc.pressure_direction = false;
    this.capabilities.cc.weathertext = false;
    this.capabilities.cc.visibility = false;
    this.capabilities.forecast.humidity = false;
    this.capabilities.forecast.pressure = false;
    this.capabilities.forecast.wind_speed = false;
    this.capabilities.forecast.wind_direction = false;
    this.capabilities.forecast.weathertext = false;
    this.capabilities.meta.city = false;
    this.capabilities.meta.region = false;
    this.capabilities.meta.wgs84 = false;

    this.drivertype = 'Wunderground';
    this.maxDays = 4;
    this.linkText = 'Weather Underground';
    this._baseURL = 'https://api.weather.com/';
    this.linkURL = 'https://wunderground.com';
    this.linkIcon = {
      file: 'wunderground',
      width: 145,
      height: 17
    };
  }

  refreshData(deskletObj) {
    // reset the data object
    this._emptyData();
    if (!this.stationID || this.stationID.length < 3) {
      this._showError(deskletObj, _('Invalid location'));
      return;
    }
    if (!this.apikey) {
      this._showError(deskletObj, _('No API key provided'));
      return;
    }
    this.langcode = this.getLangCode();

    let params = {
      'stationId': encodeURIComponent(this.stationID),
      'format': 'json',
      'units': 'm',
      'apiKey': encodeURIComponent(this.apikey)
    };
    if (this.langcode) params['language'] = this.langcode;

    this.apiurl = this._baseURL + 'v2/pws/observations/current';
    // process the current weather observation
    let a = this._getWeather(this.apiurl, function (weather) {
      if (weather) {
        this._load_observation(weather);
      }
      // get the main object to update the display
      deskletObj.displayCurrent();
      deskletObj.displayMeta();
    }, params);

    params = {
      'geocode': encodeURIComponent(this.stationID),
      'format': 'json',
      'units': 'm',
      'apiKey': encodeURIComponent(this.apikey)
    };
    if (this.langcode) params['language'] = this.langcode;

    this.apiurl = this._baseURL + 'v3/wx/forecast/daily/5day';
    // process the forecast - single call for both current conditions and 4 day forecast
    let b = this._getWeather(this.apiurl, function (weather) {
      if (weather) {
        this._load_forecast(weather);
      }
      // get the main object to update the display
      deskletObj.displayForecast();
    }, params);
  }

  // process the observation for the current day
  _load_observation(data) {
    if (!data) {
      this._showError();
      return;
    }

    let json = JSON.parse(data);

    if (typeof json.error !== 'undefined') {
      this._showError(null, json.error.message);
      global.logWarning('Error from Weather Underground: ' + json.error.message);
      return;
    }

    try {
      let co = json.observations[0];
      this.data.cc.humidity = co.humidity;
      this.data.cc.temperature = co.temperature;
      this.data.cc.has_temp = true;
      this.data.cc.pressure = co.metric.pressure;
      this.data.cc.wind_speed = co.wind_kph;
      this.data.cc.wind_direction = this.compassDirection(co.winddir);
      this.data.cc.feelslike = co.metric.heatIndex;
      this.data.cc.icon = ' ';

      this.data.country = co.country;

      this.data.status.cc = SERVICE_STATUS_OK;
      this.data.status.meta = SERVICE_STATUS_OK;
    } catch (e) {
      this._showError();
      global.logError(e);
    }
  }

  // process the data for a multi day forecast and populate this.data
  _load_forecast(data) {
    if (!data) {
      this.data.status.forecast = SERVICE_STATUS_ERROR;
      return;
    }

    let json = JSON.parse(data);

    if (typeof json.error !== 'undefined') {
      this.data.status.forecast = SERVICE_STATUS_ERROR;
      this.data.status.lasterror = json.error.message;
      global.logWarning('Error from Weather Underground: ' + json.error.message);
      return;
    }

    try {
      for (let i = 1; i < json.dayOfWeek.length; i++) {
        let day = new Object();
        day.day = json.dayOfWeek[i].slice(0, 3);
        day.minimum_temperature = json.temperatureMin[i];
        day.maximum_temperature = json.temperatureMax[i];
        day.icon = ' ';

        this.data.days[i - 1] = day;
      }
      this.data.status.forecast = SERVICE_STATUS_OK;
    } catch (e) {
      this.data.status.forecast = SERVICE_STATUS_ERROR;
      global.logError(e);
    }
  }
};
