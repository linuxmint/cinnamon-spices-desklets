// World Weather Online Premium Driver
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

    this.drivertype = 'WWOPremium';
    this.maxDays = 7;
    this.linkText = 'World Weather Online';
    // see http =//developer.worldweatheronline.com/free_api_terms_of_use;
    // point 3
    this.minTTL = 3600;
    this._baseURL = 'https://api.worldweatheronline.com/premium/v1/';
    // this will be dynamically reset when data is loaded
    this.linkURL = 'https://www.worldweatheronline.com';
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
      'zh_cn': 'zh',
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
    this.linkURL = 'https://www.worldweatheronline.com';
    if (!this.stationID || this.stationID.length < 3) {
      this._showError(deskletObj, _('Invalid location'));
      return;
    }
    if (!this.apikey) {
      this._showError(deskletObj, _('No API key provided'));
      return;
    }
    this.langcode = this.getLangCode();
    this.i18Desc = 'lang_' + this.langcode;

    let apiurl = this._baseURL + 'weather.ashx';
    let params = {
      'q': encodeURIComponent(this.stationID),
      'key': encodeURIComponent(this.apikey),
      'format': 'json',
      'tp': '24',
      'extra': 'localObsTime%2CisDayTime',
      'num_of_days': '7',
      'includelocation': 'yes'
    };
    if (this.langcode) params['lang'] = this.langcode;

    // process the forecast
    let a = this._getWeather(apiurl, function (weather) {
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

    if (typeof json.data.error !== 'undefined') {
      this._showError(null, json.data.error[0].msg);
      global.logWarning('Error from World Weather Online Premium: ' + json.data.error[0].msg);
      return;
    }

    try {
      let days = json.data.weather;

      for (let i = 0; i < days.length; i++) {
        let day = new Object();
        day.day = this._getDayName(new Date(days[i].date).getUTCDay());
        day.minimum_temperature = days[i].mintempC;
        day.maximum_temperature = days[i].maxtempC;
        day.wind_speed = days[i].hourly[0].windspeedKmph;
        day.wind_direction = days[i].hourly[0].winddir16Point;
        day.humidity = days[i].hourly[0].humidity;
        day.pressure = days[i].hourly[0].pressure;
        day.feelslike = days[i].hourly[0].FeelsLikeC;
        if (typeof days[i].hourly[0][this.i18Desc] !== 'undefined' && days[i].hourly[0][this.i18Desc][0].value) {
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
      this.data.cc.has_temp = true;
      this.data.cc.pressure = cc.pressure;
      this.data.cc.wind_speed = cc.windspeedKmph;
      this.data.cc.feelslike = cc.FeelsLikeC;
      this.data.cc.wind_direction = cc.winddir16Point;
      let dt = cc.localObsDateTime.split(/\-|\s/);
      if (typeof cc[this.i18Desc] !== 'undefined' && cc[this.i18Desc][0].value) {
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
        this.linkURL = 'https://www.worldweatheronline.com/v2/weather.aspx?q=' + encodeURIComponent(this.stationID);
      }

      this.data.status.meta = SERVICE_STATUS_OK;
      this.data.status.cc = SERVICE_STATUS_OK;
      this.data.status.forecast = SERVICE_STATUS_OK;
    } catch (e) {
      this._showError();
      global.logError(e);
    }
  }

  _mapicon(iconcode, recommendedIcon) {
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
    if ((recommendedIcon.indexOf('night') > -1) && (typeof nightmap[icon_name] !== 'undefined')) {
      icon_name = nightmap[icon_name];
    }
    return icon_name;
  }
};
