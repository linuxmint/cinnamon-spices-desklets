// meteoblue Driver
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
  constructor(stationID, apikey) {
    super(stationID, apikey);
    this.capabilities.cc.feelslike = false;
    this.capabilities.cc.humidity = false;
    this.capabilities.cc.pressure = false;
    this.capabilities.cc.pressure_direction = false;
    this.capabilities.cc.visibility = false;
    this.capabilities.meta.city = false;
    this.capabilities.meta.region = false;

    this.drivertype = 'meteoblue';
    this.maxDays = 7;
    this.linkText = 'meteoblue.com';
    this.linkIcon = {
      file: 'meteoblue',
      width: 59,
      height: 20
    };
    this._baseURL = 'https://my.meteoblue.com/packages/basic-day';
    this.lang_map = {};
    // this will be dynamically reset when data is loaded
    this.linkURL = 'https://www.meteoblue.com';
  }

  refreshData(deskletObj) {
    // reset the data object
    this._emptyData();
    this.linkURL = 'https://www.meteoblue.com';
    if (!this.stationID || this.stationID.length < 3) {
      this._showError(deskletObj, _('Invalid location'));
      return;
    }
    if (!this.apikey) {
      this._showError(deskletObj, _('No API key provided'));
      return;
    }

    // check the stationID looks valid before going further
    if (this.stationID.search(/^\-?\d+(\.\d+)?,\-?\d+(\.\d+)?$/) == 0) {
      let latlon = this.stationID.split(',');
      let params = {
        'apikey': encodeURIComponent(this.apikey),
        'mac': 'feed',
        'type': 'json_7day_3h_firstday',
        'lat': latlon[0],
        'lon': latlon[1]
      };

      // process the forecast
      let a = this._getWeather(this._baseURL, function (weather) {
        if (weather) {
          this._load_forecast(weather);
        }
        // get the main object to update the display
        deskletObj.displayForecast();
        deskletObj.displayCurrent();
        deskletObj.displayMeta();
      }, params);
    } else {
      this._showError(deskletObj, _('Invalid location'));
    }
  }

  // process the data for a multi day forecast and populate this.data
  _load_forecast(data) {
    if (!data) {
      this._showError();
      return;
    }

    let json = JSON.parse(data);

    if (typeof json.error_message !== 'undefined') {
      this._showError(null, json.error_message);
      global.logWarning('Error from meteoblue: ' + json.error_message);
      return;
    }

    try {
      let days = json.forecast;

      for (let i = 0; i < days.length; i++) {
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
      this.data.cc.has_temp = true;
      this.data.cc.weathertext = this._getWxTxt(cc.pictocode);
      if (days[0].wind_direction_dominant) this.data.cc.wind_direction = days[0].wind_direction_dominant;
      if (days[0].hourly_data[0].wind_direction) this.data.cc.wind_direction = days[0].hourly_data[0].wind_direction;
      if (days[0].wind_speed_max) this.data.cc.wind_speed = days[0].wind_speed_max;
      if (days[0].hourly_data[0].wind_speed) this.data.cc.wind_speed = days[0].hourly_data[0].wind_speed;
      if (cc.wind_speed) this.data.cc.wind_speed = cc.wind_speed;
      this.data.cc.icon = this._mapicon(cc.pictocode, cc.is_daylight);

      this.data.country = json.meta.map_region;
      this.data.wgs84.lat = json.meta.lat;
      this.data.wgs84.lon = json.meta.lon;
      // https://www.meteoblue.com/weather/forecast/week/52.275N-1.597E
      let latdir = parseInt(json.meta.lat) < 0 ? 'S' : 'N';
      let londir = parseInt(json.meta.lon) < 0 ? 'E' : 'W';
      this.linkURL = 'https://www.meteoblue.com/weather/forecast/week/' + json.meta.lat + latdir + json.meta.lon + londir;

      this.data.status.cc = SERVICE_STATUS_OK;
      this.data.status.forecast = SERVICE_STATUS_OK;
      this.data.status.meta = SERVICE_STATUS_OK;
    } catch (e) {
      this._showError();
      global.logError(e);
    }
  }

  // translate meteoblue pictocode into text string. We use phrases that we
  // have in existing translations for. meteoblue suggested text given in comments
  // see https://content.meteoblue.com/en/help/standards/symbols-and-pictograms
  _getWxTxt(pictcode) {
    let wxtext = '';
    let textmap = {
      '1': _('Clear Sky'),             // Sunny, cloudless sky
      '2': _('Fair'),                  // Sunny and few clouds
      '3': _('Partly Cloudy'),         // Partly cloudy
      '4': _('Cloudy'),                // Overcast
      '5': _('Fog'),                   // Fog
      '6': _('Rain'),                  // Overcast with rain
      '7': _('Showers'),               // Mixed with showers
      '8': _('Thundery Shower'),       // Showers, thunderstorms likely
      '9': _('Snow'),                  // Overcast with snow
      '10': _('Snow Showers'),         // Mixed with snow showers
      '11': _('Mixed Rain and Snow'),  // Mostly cloudy with a mixture of snow and rain
      '12': _('Light Rain'),           // Overcast with light rain
      '13': _('Light Snow'),           // Overcast with light snow
      '14': _('Rain'),                 // Mostly cloudy with rain
      '15': _('Snow'),                 // Mostly cloudy with snow
      '16': _('Light Rain'),           // Mostly cloudy with light rain
      '17': _('Light Snow')            // Mostly cloudy with light snow
    };

    if (pictcode && (typeof textmap[pictcode] !== 'undefined')) {
      wxtext = textmap[pictcode];
    }

    return wxtext;
  }

  _mapicon(iconcode, isDay) {
    let icon_name = 'na';
    let iconmapday = {
      '1': '32',
      '2': '34',
      '3': '30',
      '4': '26',
      '5': '20',
      '6': '12',
      '7': '39',
      '8': '37',
      '9': '14',
      '10': '41',
      '11': '05',
      '12': '11',
      '13': '13',
      '14': '12',
      '15': '14',
      '16': '11',
      '17': '13'
    };

    let iconmapnight = {
      '1': '31',
      '2': '32',
      '3': '29',
      '4': '26',
      '5': '20',
      '6': '12',
      '7': '45',
      '8': '47',
      '9': '14',
      '10': '46',
      '11': '05',
      '12': '11',
      '13': '13',
      '14': '12',
      '15': '14',
      '16': '11',
      '17': '13'
    };

    if (isDay) {
      if (iconcode && (typeof iconmapday[iconcode] !== 'undefined')) {
        icon_name = iconmapday[iconcode];
      }
    } else {
      if (iconcode && (typeof iconmapnight[iconcode] !== 'undefined')) {
        icon_name = iconmapnight[iconcode];
      }
    }

    return icon_name;
  }
};
