// weatherstack Driver
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
    this.capabilities.cc.pressure_direction = false;
    this.capabilities.forecast.humidity = false;
    this.capabilities.forecast.pressure = false;
    this.capabilities.forecast.wind_speed = false;
    this.capabilities.forecast.wind_direction = false;
    this.capabilities.forecast.weathertext = false;

    this.drivertype = 'weatherstack';
    this.maxDays = 7;
    this.linkText = 'weatherstack';
    this._baseURL = 'https://api.weatherstack.com/current';
    this.lang_map = {
      'ar': 'ar',
      'bn': 'bn',
      'bg': 'bg',
      'zh': 'zh',
      'zh_cn': 'zh',
      'zh_tw': 'zh_tw',
      'zh_cmn': 'zh_cmn',
      'zh_wuu': 'zh_wuu',
      'zh_hsn': 'zh_hsn',
      'zh_yue': 'zh_yue',
      'cs': 'cs',
      'da': 'da',
      'nl': 'nl',
      'fi': 'fi',
      'fr': 'fr',
      'de': 'de',
      'el': 'el',
      'hi': 'hi',
      'hu': 'hu',
      'it': 'it',
      'ja': 'ja',
      'jv': 'jv',
      'ko': 'ko',
      'mr': 'mr',
      'pa': 'pa',
      'pl': 'pl',
      'pt': 'pt',
      'ro': 'ro',
      'ru': 'ru',
      'sr': 'sr',
      'si': 'si',
      'sk': 'sk',
      'es': 'es',
      'sv': 'sv',
      'ta': 'ta',
      'te': 'te',
      'tr': 'tr',
      'uk': 'uk',
      'ur': 'ur',
      'vi': 'vi',
      'zu': 'zu'
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
      'access_key': encodeURIComponent(this.apikey),
      'query': encodeURIComponent(this.stationID)
    };

    if (this.langcode) params['language'] = this.langcode;

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
  }

  // process the data for a multi day forecast and populate this.data
  _load_forecast(data) {
    if (!data) {
      this._showError();
      return;
    }

    let json = JSON.parse(data);

    if (typeof json.error !== 'undefined') {
      this._showError(null, json.error.info);
      global.logWarning('Error from weatherstack: ' + json.error.info);
      return;
    }

    try {
      // forecast days
      var day_count = 0;
      for (const [date, days] of Object.entries(json.forecast)) {
        let day = new Object();
        day.day = this._getDayName(new Date(days.date).getUTCDay());
        day.minimum_temperature = days.mintemp;
        day.maximum_temperature = days.maxtemp;
        day.icon = ' ';

        this.data.days[day_count] = day;
        day_count += 1;

      }

      let cc = json.current;

      this.data.cc.humidity = cc.humidity;
      this.data.cc.temperature = cc.temperature;
      this.data.cc.has_temp = true;
      this.data.cc.pressure = cc.pressure;
      this.data.cc.wind_speed = cc.wind_speed;
      this.data.cc.wind_direction = cc.wind_dir;
      this.data.cc.weathertext = this._mapDescription(cc.weather_descriptions[0]);
      this.data.cc.visibility = cc.visibility;
      this.data.cc.feelslike = cc.feelslike;
      this.data.cc.icon = this._mapIcon(cc.weather_code);

      let locdata = json.location;
      this.data.city = locdata.name;
      this.data.country = locdata.country;
      this.data.region = locdata.region;
      this.data.wgs84.lat = locdata.lat;
      this.data.wgs84.lon = locdata.lon;

      this.data.status.meta = SERVICE_STATUS_OK;
      this.data.status.cc = SERVICE_STATUS_OK;
      this.data.status.forecast = SERVICE_STATUS_OK;
    } catch (e) {
      this._showError();
      global.logError(e);
    }
  }

  _mapIcon(iconcode) {
    // https://weatherstack.com/site_resources/weatherstack-weather-condition-codes.zip
    // weatherstack uses wwo weather codes from here:
    // https://www.worldweatheronline.com/feed/wwoConditionCodes.txt
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

    if (iconcode && (typeof iconmap[iconcode] !== 'undefined')) {
      icon_name = iconmap[iconcode];
    }

    return icon_name;
  }

  _mapDescription(description) {
    let condition = description.toLowerCase();
    let conditionmap = {
      'blizzard': _('Blizzard'),
      'blowing snow': _('Blowing Snow'),
      'clear': _('Clear'),
      'cloudy': _('Cloudy'),
      'fog': _('Fog'),
      'freezing drizzle': _('Freezing Drizzle'),
      'freezing fog': _('Freezing Fog'),
      'heavy freezing drizzle': _('Heavy Freezing Drizzle'),
      'heavy rain': _('Heavy Rain'),
      'heavy rain at times': _('Heavy Rain at Times'),
      'light drizzle': _('Light Drizzle'),
      'light freezing rain': _('Light Freezing Rain'),
      'light rain': _('Light Rain'),
      'mist': _('Mist'),
      'moderate rain': _('Moderate Rain'),
      'moderate rain at times': _('Moderate Rain at Times'),
      'overcast': _('Overcast'),
      'partly cloudy': _('Partly Cloudy'),
      'patchy freezing drizzle possible': _('Patchy Freezing Drizzle Possible'),
      'patchy light drizzle': _('Patchy Light Drizzle'),
      'patchy light rain': _('Patchy Light Rain'),
      'patchy rain possible': _('Patchy Rain Possible'),
      'patchy sleet possible': _('Patchy Sleet Possible'),
      'patchy snow possible': _('Patchy Snow Possible'),
      'sunny': _('Sunny'),
      'thundery outbreaks possible': _('Thundery Outbreaks Possible')
    };

    if (description && (typeof conditionmap[condition] !== 'undefined')) {
      condition = conditionmap[condition];
      return condition;
    }

    return description;
  }
};
