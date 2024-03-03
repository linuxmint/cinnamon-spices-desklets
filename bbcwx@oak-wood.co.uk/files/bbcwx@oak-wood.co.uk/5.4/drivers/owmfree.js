// Open Weather Map Free Driver
const UUID = 'bbcwx@oak-wood.co.uk';
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
imports.searchPath.push(`${DESKLET_DIR}/drivers`);
const wxBase = imports.wxbase;

const SERVICE_STATUS_ERROR = wxBase.SERVICE_STATUS_ERROR;
const SERVICE_STATUS_OK = wxBase.SERVICE_STATUS_OK;

var Driver = class Driver extends wxBase.Driver {
  constructor(stationID, apikey) {
    super(stationID, apikey);
    this.capabilities.cc.pressure_direction = false;
    this.capabilities.meta.region = false;

    this.drivertype = 'OWMFree';
    this.maxDays = 5;
    this.linkText = 'openweathermap.org';
    this._baseURL = 'https://api.openweathermap.org/data/2.5/';
    // this will be dynamically reset when data is loaded
    this.linkURL = 'https://openweathermap.org';
  }

  refreshData(deskletObj) {
    // reset the data object
    this._emptyData();
    this.linkURL = 'https://openweathermap.org';
    if (!this.stationID || this.stationID.length < 3) {
      this._showError(deskletObj, _('Invalid location'));
      return;
    }
    if (!this.apikey) {
      this._showError(deskletObj, _('No API key provided'));
      return;
    }

    if (this.stationID.search(/^\-?\d+(\.\d+)?,\-?\d+(\.\d+)?$/) == 0) {
      this.latlon = this.stationID.split(',');
    } else if (this.stationID.search(/^\d+$/) != 0) {
      this._showError(deskletObj, _('Invalid location format'));
      return
    }

    this.langcode = this.getLangCode();

    // process the 5 days forecast
    let apiforecasturl = this._baseURL + 'forecast/';
    let params = {
      'appid': encodeURIComponent(this.apikey),
      'units': 'metric'
    };
    if (typeof this.latlon != 'undefined') {
      params['lat'] = this.latlon[0];
      params['lon'] = this.latlon[1];
    } else {
      params['id'] = encodeURIComponent(this.stationID);
    }
    if (this.langcode) params['lang'] = this.langcode;

    let a = this._getWeather(apiforecasturl, function (weather) {
      if (weather) {
        this._load_forecast(weather);
      }
      // get the main object to update the display
      deskletObj.displayForecast();
      deskletObj.displayMeta();
    }, params);

    // process current observations
    let apiccurl = this._baseURL + 'weather';
    let b = this._getWeather(apiccurl, function (weather) {
      if (weather) {
        this._load_observations(weather);
      }
      // get the main object to update the display
      deskletObj.displayCurrent();
    }, params);
  }

  _load_forecast(data) {
    if (!data) {
      this.data.status.forecast = SERVICE_STATUS_ERROR;
      this.data.status.meta = SERVICE_STATUS_ERROR;
      return;
    }

    let json = JSON.parse(data);
    if (json.cod != '200') {
      this.data.status.forecast = SERVICE_STATUS_ERROR;
      this.data.status.meta = SERVICE_STATUS_ERROR;
      this.data.status.lasterror = json.cod;
      return;
    }

    try {
      this._parse_forecast(json);
      this.data.status.forecast = SERVICE_STATUS_OK;
      this.data.status.meta = SERVICE_STATUS_OK;
    } catch (e) {
      global.logError(e);
      this.data.status.forecast = SERVICE_STATUS_ERROR;
      this.data.status.meta = SERVICE_STATUS_ERROR;
    }
  }

  // take the current observations and extract data into this.data
  _load_observations(data) {
    if (!data) {
      this.data.status.cc = SERVICE_STATUS_ERROR;
      return;
    }
    let json = JSON.parse(data);
    if (json.cod != '200') {
      this.data.status.cc = SERVICE_STATUS_ERROR;
      this.data.status.lasterror = json.cod;
      return;
    }

    try {
      this.data.cc.humidity = json.main.humidity;
      this.data.cc.temperature = json.main.temp;
      this.data.cc.has_temp = true;
      this.data.cc.pressure = json.main.pressure;
      this.data.cc.wind_speed = json.wind.speed * 3.6;
      this.data.cc.wind_direction = this.compassDirection(json.wind.deg);
      this.data.cc.weathertext = json.weather[0].description.ucwords();
      this.data.cc.visibility = Math.round(json.visibility / 1000);
      this.data.cc.feelslike = json.main.feels_like;
      this.data.cc.icon = this._mapicon(json.weather[0].icon, json.weather[0].id);
      this.data.status.cc = SERVICE_STATUS_OK;
    } catch (e) {
      global.logError(e);
      this.data.status.cc = SERVICE_STATUS_ERROR;
    }
  }

  // process the data for a forecast and populate this.data
  _parse_forecast(json) {
    this.data.city = json.city.name;
    this.data.country = json.city.country;
    this.data.wgs84.lat = json.city.coord.lat;
    this.data.wgs84.lon = json.city.coord.lon;
    this.linkURL = 'https://openweathermap.org/city/' + json.city.id;

    // This is ugly, but to place a forecast in a particular day we need to make an effort to
    // interpret the UTC timestamps in the context of the forecast location's timezone, which
    // we don't know. So we estimate, based on longitude
    let est_tz = Math.round(json.city.coord.lon / 15) * 3600;

    let days = {};
    for (let i = 0; i < json.list.length; i++) {
      let day_name = this._getDayName(new Date((json.list[i].dt + est_tz) * 1000).getUTCDay());

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

    let today = this._getDayName(new Date().toLocaleFormat('%w'));
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
  }

  _mapicon(iconcode, wxcode) {
    // http://bugs.openweathermap.org/projects/api/wiki/Weather_Condition_Codes
    let icon_name = 'na';
    let wxmap = {
      '300': '09',
      '301': '09',
      '302': '11',
      '310': '09',
      '311': '09',
      '312': '11',
      '313': '39',
      '314': '39',
      '321': '39',
      '500': '11',
      '511': '10',
      '521': '39',
      '522': '39',
      '531': '39',
      '600': '13',
      '601': '14',
      '602': '16',
      '611': '18',
      '612': '06',
      '615': '05',
      '616': '05',
      '620': '41',
      '621': '41',
      '622': '41',
      '721': '22',
      '731': '19',
      '751': '19',
      '761': '19',
      '762': '19',
      '771': '23',
      '781': '00',
      '802': '30',
      '803': '28',
      '804': '26',
      '900': '00',
      '901': '01',
      '902': '01',
      '903': '25',
      '904': '36',
      '905': '24'
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
    let iconmap = {
      '01d': '32',
      '01n': '31',
      '02d': '34',
      '02n': '33',
      '03d': '26',
      '03n': '26',
      '04d': '28',
      '04n': '27',
      '09d': '39',
      '09n': '45',
      '10d': '12',
      '10n': '12',
      '11d': '04',
      '11n': '04',
      '13d': '16',
      '13n': '16',
      '50d': '20',
      '50n': '20'
    };
    if (iconcode && (typeof iconmap[iconcode] !== 'undefined')) {
      icon_name = iconmap[iconcode];
    }
    // override with more precise icon from the weather code if
    // we can
    if (wxcode && (typeof wxmap[wxcode] !== 'undefined')) {
      icon_name = wxmap[wxcode];
    }
    // override with nighttime icons
    if ((iconcode.charAt(2) == 'n') && (typeof nightmap[icon_name] !== 'undefined')) {
      icon_name = nightmap[icon_name];
    }
    return icon_name;
  }
};
