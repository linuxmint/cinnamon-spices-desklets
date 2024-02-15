// Open-Meteo Driver
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const UUID = 'bbcwx@oak-wood.co.uk';
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
imports.searchPath.push(`${DESKLET_DIR}/drivers`);
const wxBase = imports.wxbase;

const SERVICE_STATUS_OK = wxBase.SERVICE_STATUS_OK;

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + '/.local/share/locale');

function _(str) {
  if (str) return Gettext.dgettext(UUID, str);
}

var Driver = class Driver extends wxBase.Driver {
  // initialize the driver
  constructor(stationID) {
    super(stationID);
    this.capabilities.cc.pressure_direction = false;
    this.capabilities.cc.visibility = false;
    this.capabilities.forecast.humidity = false;
    this.capabilities.forecast.pressure = false;
    this.capabilities.meta.city = false;
    this.capabilities.meta.country = false;
    this.capabilities.meta.region = false;

    this.drivertype = 'Open-Meteo';
    this.maxDays = 16;
    this.linkText = 'Open-Meteo';
    this.latlon = this.stationID.split(',');
    this._baseURL = 'https://api.open-meteo.com/v1/forecast';
  }

  refreshData(deskletObj) {
    // reset the data object
    this._emptyData();
    if (!this.stationID || this.stationID.length < 3 || this.stationID.search(/^\-?\d+(\.\d+)?,\-?\d+(\.\d+)?$/) != 0) {
      this._showError(deskletObj, _('Invalid location'));
      return;
    }
    this.latlon = this.stationID.split(',');
    let params = {
      'latitude': this.latlon[0],
      'longitude': this.latlon[1],
      'current': ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'is_day', 'weather_code', 'pressure_msl', 'wind_speed_10m', 'wind_direction_10m'],
      'daily': ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'wind_speed_10m_max', 'wind_direction_10m_dominant'],
      'timezone': 'auto'
    };

    // process the forecast
    let a = this._getWeather(this._baseURL, function (weather) {
      if (weather) {
        this._load_forecast(weather);
      }
      // get the main object to update the display
      deskletObj.displayCurrent();
      deskletObj.displayForecast();
      deskletObj.displayMeta();
    }, params);
  }

  // process the data for a forecast and populate this.data
  _load_forecast(data) {
    if (!data) {
      this._showError();
      return;
    }

    let json = JSON.parse(data);

    try {
      this._parse_forecast(json);
      this.data.status.cc = SERVICE_STATUS_OK;
      this.data.status.forecast = SERVICE_STATUS_OK;
      this.data.status.meta = SERVICE_STATUS_OK;
    } catch (e) {
      this._showError();
      global.logError(e);
    }
  }

  // parse json for a forecast and populate this.data
  _parse_forecast(json) {
    this.data.wgs84.lat = json.latitude;
    this.data.wgs84.lon = json.longitude;

    // current conditions
    let cur = json.current;
    this.is_day = cur.is_day;
    this.data.cc.humidity = cur.relative_humidity_2m;
    this.data.cc.temperature = cur.temperature_2m;
    this.data.cc.has_temp = true;
    this.data.cc.pressure = cur.pressure_msl;
    this.data.cc.wind_speed = cur.wind_speed_10m;
    this.data.cc.wind_direction = this.compassDirection(cur.wind_direction_10m);
    this.data.cc.weathertext = this._getDataFromWeatherCode(cur.weather_code, 0);
    this.data.cc.feelslike = cur.apparent_temperature;
    this.data.cc.icon = this._getDataFromWeatherCode(cur.weather_code, 1, this.is_day);

    // forecast days
    let forecast = json.daily;
    for (let i = 0; i < forecast.time.length; i++) {
      let day = new Object();
      day.day = this._getDayName(new Date(forecast.time[i]).getUTCDay());
      day.maximum_temperature = forecast.temperature_2m_max[i];
      day.minimum_temperature = forecast.temperature_2m_min[i];
      day.wind_speed = forecast.wind_speed_10m_max[i];
      day.wind_direction = this.compassDirection(forecast.wind_direction_10m_dominant[i]);
      day.weathertext = this._getDataFromWeatherCode(forecast.weather_code[i], 0, 1);
      day.icon = this._getDataFromWeatherCode(forecast.weather_code[i], 1, 1);

      this.data.days[i] = day;
    }
  }

  _getDataFromWeatherCode(code, index, is_day) {
    // https://open-meteo.com/en/docs#weathervariables
    let data = index ? 'na' : '';
    let codemap = {
      '0': [_('Clear Sky'), is_day ? '32' : '31'],
      '1': [_('Mainly Clear'), is_day ? '34' : '33'],
      '2': [_('Partly Cloudy'), is_day ? '30' : '29'],
      '3': [_('Overcast'), is_day ? '28' : '27'],
      '45': [_('Fog'), is_day ? '20' : '22'],
      '48': [_('Depositing Rime Fog'), is_day ? '20' : '22'],
      '51': [_('Drizzle: Light Intensity'), is_day ? '11' : '09'],
      '53': [_('Drizzle: Moderate Intensity'), is_day ? '11' : '09'],
      '55': [_('Drizzle: Dense Intensity'), is_day ? '39' : '45'],
      '56': [_('Freezing Drizzle: Light Intensity'), '25'],
      '57': [_('Freezing Drizzle: Dense Intensity'), is_day ? '08' : '10'],
      '61': [_('Rain: Slight Intensity'), is_day ? '39' : '45'],
      '63': [_('Rain: Moderate Intensity'), '10'],
      '65': [_('Rain: Heavy Intensity'), '12'],
      '66': [_('Freezing Rain: Light Intensity'), '25'],
      '67': [_('Freezing Rain: Heavy Intensity'), is_day ? '08' : '10'],
      '71': [_('Snow Fall: Slight Intensity'), '13'],
      '73': [_('Snow Fall: Moderate Intensity'), '14'],
      '75': [_('Snow Fall: Heavy Intensity'), '16'],
      '77': [_('Snow Grains'), is_day ? '41' : '46'],
      '80': [_('Rain Showers: Slight'), is_day ? '39' : '45'],
      '81': [_('Rain Showers: Moderate'), '10'],
      '82': [_('Rain Showers: Violent'), '12'],
      '85': [_('Slight Snow Showers'), is_day ? '05' : '06'],
      '86': [_('Heavy Snow Showers'), is_day ? '41' : '46'],
      '95': [_('Thunderstorm'), '04'],
      '96': [_('Thunderstorm With Slight Hail'), is_day ? '37' : '47'],
      '99': [_('Thunderstorm With Heavy Hail'), is_day ? '37' : '47']
    };
    if (typeof codemap[code] !== 'undefined') data = codemap[code][index];
    return data;
  }
};
