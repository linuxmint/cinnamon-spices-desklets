// Weather API Free Driver
const UUID = 'bbcwx@oak-wood.co.uk';
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
imports.searchPath.push(`${DESKLET_DIR}/drivers`);
const wxBase = imports.wxbase;

const SERVICE_STATUS_OK = wxBase.SERVICE_STATUS_OK;

var Driver = class Driver extends wxBase.Driver {
  // initialize the driver
  constructor(stationID, apikey) {
    super(stationID, apikey);
    this.capabilities.cc.pressure_direction = false;
    this.capabilities.forecast.pressure = false;
    this.capabilities.forecast.wind_direction = false;

    this.drivertype = 'weatherapi';
    this.maxDays = 3;
    this.linkText = 'WeatherAPI.com';
    this._baseURL = 'https://api.weatherapi.com/v1/forecast.json';
    this.linkURL = 'https://www.weatherapi.com/weather/';
    this.linkIcon = {
      file: 'weatherapi',
      width: 107,
      height: 50
    };
    this.lang_map = {
      'ar': 'ar',
      'bg': 'bg',
      'bn': 'bn',
      'cs': 'cs',
      'da': 'da',
      'de': 'de',
      'el': 'el',
      'es': 'es',
      'fi': 'fi',
      'fr': 'fr',
      'hi': 'hi',
      'hu': 'hu',
      'it': 'it',
      'ja': 'ja',
      'jv': 'jv',
      'ko': 'ko',
      'mr': 'mr',
      'nl': 'nl',
      'pa': 'pa',
      'pl': 'pl',
      'pt': 'pt',
      'ro': 'ro',
      'ru': 'ru',
      'si': 'si',
      'sk': 'sk',
      'sr': 'sr',
      'sv': 'sv',
      'ta': 'ta',
      'te': 'te',
      'tr': 'tr',
      'uk': 'uk',
      'ur': 'ur',
      'vi': 'vi',
      'zh': 'zh',
      'zh_cmn': 'zh_cmn',
      'zh_hsn': 'zh_hsn',
      'zh_tw': 'zh_tw',
      'zh_wuu': 'zh_wuu',
      'zh_yue': 'zh_yue',
      'zu': 'zu'
    };
  }

  refreshData(deskletObj) {
    // reset the data object
    this._emptyData();
    if (!this.stationID || this.stationID.length < 2) {
      this._showError(deskletObj, _('Invalid location'));
      return;
    }
    if (!this.apikey) {
      this._showError(deskletObj, _('No API key provided'));
      return;
    }
    this.langcode = this.getLangCode();
    this.i18Desc = 'lang_' + this.langcode;

    let params = {
      'q': encodeURIComponent(this.stationID),
      'key': encodeURIComponent(this.apikey),
      'days': this.maxDays,
      'aqi': 'no',
      'alerts': 'no'
    };
    if (this.langcode) params['lang'] = this.langcode;

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
      global.logError(e);
      this._showError();
    }
  }

  // process the data for a forecast and populate this.data
  _parse_forecast(json) {
    this.data.city = json.location.name;
    this.data.country = json.location.country;
    this.data.wgs84.lat = json.location.lat;
    this.data.wgs84.lon = json.location.lon;

    // current conditions
    let cur = json.current;
    this.data.cc.humidity = cur.humidity;
    this.data.cc.temperature = cur.temp_c;
    this.data.cc.has_temp = true;
    this.data.cc.pressure = cur.pressure_mb;
    this.data.cc.wind_speed = cur.wind_kph;
    this.data.cc.wind_direction = cur.wind_dir;
    this.data.cc.weathertext = this._mapDescription(cur.condition.text);
    this.data.cc.visibility = cur.vis_km;
    this.data.cc.feelslike = cur.feelslike_c;
    this.data.cc.icon = this._mapicon(cur.condition.code, cur.is_day);

    // forecast days
    for (let i = 0; i < json.forecast.forecastday.length; i++) {
      let day = new Object();
      day.day = this._getDayName(new Date(json.forecast.forecastday[i].date).getUTCDay());

      let forecastday = json.forecast.forecastday[i].day;
      day.humidity = forecastday.avghumidity;
      day.maximum_temperature = forecastday.maxtemp_c;
      day.minimum_temperature = forecastday.mintemp_c;
      day.wind_speed = forecastday.maxwind_kph;
      day.weathertext = this._mapDescription(forecastday.condition.text);
      day.icon = this._mapicon(forecastday.condition.code, 1);

      this.data.days[i] = day;
    }

    // location data
    this.data.city = json.location.name;
    this.data.country = json.location.country;
    this.data.region = json.location.region;
    this.data.wgs84.lat = json.location.lat;
    this.data.wgs84.lon = json.location.lon;
  }

  _mapicon(iconcode, isDay) {
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
      '39': '45',
      '41': '46',
      '30': '29',
      '28': '27',
      '32': '31',
      '22': '21',
      '47': '38'
    };

    if (iconcode && (typeof iconmap[iconcode] !== 'undefined')) {
      icon_name = iconmap[iconcode];
    }
    // override with nighttime icons
    if ((isDay != 1) && (typeof nightmap[icon_name] !== 'undefined')) {
      icon_name = nightmap[icon_name];
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
      'heavy snow': _('Heavy Snow'),
      'ice pellets': _('Ice Pellets'),
      'light drizzle': _('Light Drizzle'),
      'light freezing rain': _('Light Freezing Rain'),
      'light rain': _('Light Rain'),
      'light rain shower': _('Light Rain Shower'),
      'light showers of ice pellets': _('Light Showers of Ice Pellets'),
      'light sleet': _('Light Sleet'),
      'light sleet showers': _('Light Sleet Showers'),
      'light snow': _('Light Snow'),
      'light snow showers': _('Light Snow Showers'),
      'mist': _('Mist'),
      'moderate or heavy freezing rain': _('Moderate or Heavy Freezing Rain'),
      'moderate or heavy rain shower': _('Moderate or Heavy Rain Shower'),
      'moderate or heavy rain with thunder': _('Moderate or Heavy Rain With Thunder'),
      'moderate or heavy showers of ice pellets': _('Moderate or Heavy Showers of Ice Pellets'),
      'moderate or heavy sleet': _('Moderate or Heavy Sleet'),
      'moderate or heavy sleet showers': _('Moderate or Heavy Sleet Showers'),
      'moderate or heavy snow showers': _('Moderate or Heavy Snow Showers'),
      'moderate or heavy snow with thunder': _('Moderate or Heavy Snow With Thunder'),
      'moderate rain': _('Moderate Rain'),
      'moderate rain at times': _('Moderate Rain at Times'),
      'moderate snow': _('Moderate Snow'),
      'overcast': _('Overcast'),
      'partly cloudy': _('Partly Cloudy'),
      'patchy freezing drizzle possible': _('Patchy Freezing Drizzle Possible'),
      'patchy heavy snow': _('Patchy Heavy Snow'),
      'patchy light drizzle': _('Patchy Light Drizzle'),
      'patchy light rain': _('Patchy Light Rain'),
      'patchy light rain with thunder': _('Patchy Light Rain With Thunder'),
      'patchy light snow': _('Patchy Light Snow'),
      'patchy light snow with thunder': _('Patchy Light Snow With Thunder'),
      'patchy moderate snow': _('Patchy Moderate Snow'),
      'patchy rain possible': _('Patchy Rain Possible'),
      'patchy sleet possible': _('Patchy Sleet Possible'),
      'patchy snow possible': _('Patchy Snow Possible'),
      'sunny': _('Sunny'),
      'thundery outbreaks possible': _('Thundery Outbreaks Possible'),
      'torrential rain shower': _('Torrential Rain Shower')
    };

    if (description && (typeof conditionmap[condition] !== 'undefined')) {
      condition = conditionmap[condition];
      return condition;
    }

    return description;
  }
};
