// National Weather Service Driver
const UUID = 'bbcwx@oak-wood.co.uk';
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
imports.searchPath.push(`${DESKLET_DIR}/drivers`);
const wxBase = imports.wxbase;

const SERVICE_STATUS_ERROR = wxBase.SERVICE_STATUS_ERROR;
const SERVICE_STATUS_OK = wxBase.SERVICE_STATUS_OK;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

var Driver = class Driver extends wxBase.Driver {
  // initialize the driver
  constructor(stationID, version) {
    super(stationID);
    this.capabilities.cc.feelslike = false;
    this.capabilities.cc.humidity = false;
    this.capabilities.cc.pressure = false;
    this.capabilities.cc.pressure_direction = false;
    this.capabilities.cc.visibility = false;
    this.capabilities.forecast.humidity = false;
    this.capabilities.forecast.pressure = false;
    this.capabilities.meta.country = false;
    this.capabilities.meta.wgs84 = false;

    this.drivertype = 'NWS';
    this.version = version;
    this.maxDays = 6;
    this.linkText = 'National Weather Service';
    this._baseURL = 'https://api.weather.gov/';
    // this will be dynamically reset when data is loaded
    this.linkURL = 'https://www.weather.gov/';
  }

  refreshData(deskletObj) {
    // reset the data object
    this._emptyData();
    this.linkURL = 'https://www.weather.gov/';
    if (!this.stationID || this.stationID.length < 3 || this.stationID.search(/^\-?\d+(\.\d+)?,\-?\d+(\.\d+)?$/) != 0) {
      this._showError(deskletObj, _('Invalid location'));
      return;
    }
    this.userAgent = (`${UUID}: ${this.version}`, 'https://github.com/linuxmint/cinnamon-spices-desklets/issues');
    if (this.stationID.search(/^\-?\d+(\.\d+)?,\-?\d+(\.\d+)?$/) == 0) {
      let latlon = this.stationID.split(',');
      let apiurl = this._baseURL + 'points/' + latlon[0] + ',' + latlon[1];
      let params = { 'units': 'si' };

      try {
        let a = this._getWeather(apiurl, function (response) {
          if (response) {
            let properties = JSON.parse(response).properties;
            // location data
            this.data.city = properties.relativeLocation.properties.city;
            this.data.region = properties.relativeLocation.properties.state;
            this.data.wgs84.lat = properties.relativeLocation.geometry.coordinates[1];
            this.data.wgs84.lon = properties.relativeLocation.geometry.coordinates[0];
            this.data.status.meta = SERVICE_STATUS_OK;
            let b = this._getWeather(properties.forecast, function (weather) {
              this._load_forecast(weather);
              // get the main object to update the display
              deskletObj.displayCurrent();
              deskletObj.displayForecast();
              deskletObj.displayMeta();
            }, params, this.userAgent);
          } else {
            this._showError(deskletObj, _('Invalid location'));
          }
        }, null, this.userAgent);
      } catch (e) {
        this._showError(deskletObj, e);
        global.logError(e);
      }
    } else {
      this._showError(deskletObj, _('Invalid location'));
    }
  }

  _load_forecast(data) {
    if (!data) {
      this.data.status.cc = SERVICE_STATUS_ERROR;
      this.data.status.forecast = SERVICE_STATUS_ERROR;
      return;
    }

    let json = JSON.parse(data);

    if (typeof json.status !== 'undefined') {
      this._showError(null, json.title);
      global.logError(json.title);
      return;
    }

    try {
      this._parse_forecast(json);
      this.data.status.cc = SERVICE_STATUS_OK;
      this.data.status.forecast = SERVICE_STATUS_OK;
      this.data.status.meta = SERVICE_STATUS_OK;
    } catch (e) {
      this._showError(null, e);
      global.logError(e);
    }
  }

  // process the data for a forecast and populate this.data
  _parse_forecast(json) {
    this.linkURL = 'https://forecast.weather.gov/MapClick.php?textField1=' + this.data.wgs84.lat + '&textField2=' + this.data.wgs84.lon;

    // current conditions
    var periods = json.properties.periods;
    var index = 0;
    var day_name = periods[0].name;
    if (day_name != 'Tonight' && day_name != 'Overnight') var index = 1;
    this.data.cc.temperature = periods[0].temperature;
    this.data.cc.has_temp = true;
    this.data.cc.wind_speed = periods[0].windSpeed.split(' ')[0];
    this.data.cc.wind_direction = periods[0].windDirection;
    this.data.cc.weathertext = periods[0].shortForecast;
    this.data.cc.icon = ' ';

    // forecast days
    var day_count = 0;
    for (let i = index + 1; i < periods.length - 1; i += 2) {
      let day = new Object();
      day.day = periods[i].name.slice(0, 3);
      if (!DAYS.includes(day.day)) day.day = periods[i + 1].name.slice(0, 3);

      let forecastday = periods[i];
      let forecastnight = periods[i + 1];
      day.maximum_temperature = forecastday.temperature;
      day.minimum_temperature = forecastnight.temperature;
      day.wind_speed = forecastday.windSpeed.split(' ')[0];
      day.wind_direction = forecastday.windDirection;
      day.weathertext = forecastday.shortForecast;
      day.icon = ' ';

      this.data.days[day_count] = day;
      day_count += 1;
    }
  }
};
