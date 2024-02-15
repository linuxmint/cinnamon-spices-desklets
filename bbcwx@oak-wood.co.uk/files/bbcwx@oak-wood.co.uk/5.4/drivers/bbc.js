// BBC Driver
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const UUID = 'bbcwx@oak-wood.co.uk';
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
imports.searchPath.push(`${DESKLET_DIR}/drivers`);
const Marknote = imports.marknote;
const wxBase = imports.wxbase;

const SERVICE_STATUS_ERROR = wxBase.SERVICE_STATUS_ERROR;
const SERVICE_STATUS_OK = wxBase.SERVICE_STATUS_OK;

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + '/.local/share/locale');

function _(str) {
  if (str) return Gettext.dgettext(UUID, str);
}

var Driver = class Driver extends wxBase.Driver {
  // initialize the driver
  constructor(stationID) {
    super(stationID);
    this.capabilities.cc.feelslike = false;
    this.capabilities.meta.region = false;

    this.drivertype = 'BBC';
    this.maxDays = 3;
    this.linkText = 'www.bbc.co.uk/weather';
    this._baseURL = 'https://weather-broker-cdn.api.bbci.co.uk/en/';
    // this will be dynamically reset when data is loaded
    this.linkURL = 'https://www.bbc.co.uk/weather/';
  }

  refreshData(deskletObj) {
    // reset the data object
    this._emptyData();
    this.linkURL = 'https://www.bbc.co.uk/weather/';
    if (!this.stationID || this.stationID.length < 3) {
      this._showError(deskletObj, _('Invalid location'));
      return;
    }
    // process the three day forecast
    let a = this._getWeather(this._baseURL + 'forecast/rss/3day/' + this.stationID, function (weather) {
      if (weather) {
        this._load_forecast(weather);
      }
      // get the main object to update the display
      deskletObj.displayForecast();
      deskletObj.displayMeta();
    });

    // process current observations
    let b = this._getWeather(this._baseURL + 'observation/rss/' + this.stationID, function (weather) {
      if (weather) {
        this._load_observations(weather);
      }
      // get the main object to update the display
      deskletObj.displayCurrent();
    });
  }

  // process the rss for a 3dayforecast and populate this.data
  _load_forecast(rss) {
    if (!rss) {
      this.data.status.forecast = SERVICE_STATUS_ERROR;
      this.data.status.meta = SERVICE_STATUS_ERROR;
      return;
    }
    let days = [];

    let parser = new Marknote.marknote.Parser();
    let doc = parser.parse(rss);
    if (!doc) {
      this.data.status.forecast = SERVICE_STATUS_ERROR;
      this.data.status.meta = SERVICE_STATUS_ERROR;
      return;
    }
    try {
      let rootElem = doc.getRootElement();
      let channel = rootElem.getChildElement('channel');
      let location = channel.getChildElement('title').getText().split('Forecast for')[1].trim();
      this.data.city = location.split(',')[0].trim();
      this.data.country = location.split(',')[1].trim();
      this.linkURL = channel.getChildElement('link').getText();
      let items = channel.getChildElements('item');
      let geo = items[0].getChildElement('georss:point').getText();
      this.data.wgs84.lat = geo.split(' ')[0].trim();
      this.data.wgs84.lon = geo.split(' ')[1].trim();
      let desc, title;

      for (let i = 0; i < items.length; i++) {
        let data = new Object();
        desc = items[i].getChildElement('description').getText();
        title = items[i].getChildElement('title').getText();
        data.link = items[i].getChildElement('link').getText();
        data.day = title.split(':')[0].trim().substring(0, 3);
        let weathertext = title.split(':')[1].split(',')[0].trim();
        let parts = desc.split(',');
        let k, v;
        for (let b = 0; b < parts.length; b++) {
          k = parts[b].slice(0, parts[b].indexOf(':')).trim().replace(' ', '_').toLowerCase();
          v = parts[b].slice(parts[b].indexOf(':') + 1).trim();
          if (v.substr(0, 4).toLowerCase() == 'null') v = '';
          if (k == 'wind_direction' && v != '') {
            let vparts = v.split(' ');
            v = '';
            for (let c = 0; c < vparts.length; c++) {
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
      this.data.status.forecast = SERVICE_STATUS_OK;
      this.data.status.meta = SERVICE_STATUS_OK;
    } catch (e) {
      global.logError(e);
      this.data.status.forecast = SERVICE_STATUS_ERROR;
      this.data.status.meta = SERVICE_STATUS_ERROR;
    }
  }

  // take an rss feed of current observations and extract data into this.data
  _load_observations(rss) {
    if (!rss) {
      this.data.status.cc = SERVICE_STATUS_ERROR;
      return;
    }
    let parser = new Marknote.marknote.Parser();
    let doc = parser.parse(rss);
    if (!doc) {
      this.data.status.cc = SERVICE_STATUS_ERROR;
      return;
    }
    try {
      let rootElem = doc.getRootElement();
      let channel = rootElem.getChildElement('channel');
      let item = channel.getChildElement('item');
      let desc = item.getChildElement('description').getText();
      let title = item.getChildElement('title').getText();
      desc = desc.replace('mb,', 'mb|');
      this.data.cc.weathertext = title.split(':')[2].split(',')[0].trim();
      if ((this.data.cc.weathertext.toLowerCase() == 'null') || (this.data.cc.weathertext.includes('Not available'))) this.data.cc.weathertext = '';
      let parts = desc.split(',');
      for (let b = 0; b < parts.length; b++) {
        let k, v;
        k = parts[b].slice(0, parts[b].indexOf(':')).trim().replace(' ', '_').toLowerCase();
        v = parts[b].slice(parts[b].indexOf(':') + 1).trim();
        if (v.substr(0, 4).toLowerCase() == 'null') v = '';
        if (k == 'wind_direction' && v != '') {
          let vparts = v.split(' ');
          v = '';
          for (let c = 0; c < vparts.length; c++) {
            v += vparts[c].charAt(0).toUpperCase();
          }
        }
        if (k == 'pressure' && v != '') {
          let pparts = v.split('|');
          v = pparts[0].trim();
          this.data.cc.pressure_direction = _(pparts[1].trim());
        }
        this.data.cc[k] = v;
      }
      this.data.cc.icon = this._getIconFromText(this.data.cc.weathertext);
      this.data.cc.weathertext = _(this.data.cc.weathertext);
      this.data.cc.temperature = this._getTemperature(this.data.cc.temperature);
      this.data.cc.has_temp = true;
      this.data.cc.wind_speed = this._getWindspeed(this.data.cc.wind_speed);
      this.data.cc.wind_direction = _(this.data.cc.wind_direction);
      this.data.cc.humidity = this.data.cc.humidity.replace('%', '').replace('-- ', '');
      this.data.cc.pressure = this.data.cc.pressure.replace('mb', '').replace('-- ', '');
      this.data.status.cc = SERVICE_STATUS_OK;
    } catch (e) {
      global.logError(e);
      this.data.status.cc = SERVICE_STATUS_ERROR;
    }
  }

  _getIconFromText(wxtext) {
    let icon_name = 'na';
    let iconmap = {
      'clear sky': '31', //night
      'sunny': '32',
      'partly cloudy': '29',  //night
      'sunny intervals': '30',
      'sand storm': '19', // not confirmed
      'mist': '20',
      'fog': '20',
      'white cloud': '26',
      'light cloud': '26',
      'grey cloud': '26d',
      'thick cloud': '26d',
      'light rain shower': '39',
      'light rain showers': '39',
      'drizzle': '09',
      'light rain': '11',
      'heavy rain shower': '39',
      'heavy rain showers': '39',
      'heavy rain': '12',
      'sleet shower': '07',
      'sleet showers': '07',
      'sleet': '07',
      'light snow shower': '41',
      'light snow showers': '41',
      'light snow': '13',
      'heavy snow shower': '41',
      'heavy snow showers': '41',
      'heavy snow': '16',
      'thundery shower': '37',
      'thundery showers': '37',
      'thunder storm': '04',
      'thunderstorm': '04',
      'hazy': '22',
      'hail shower': '18',
      'hail showers': '18'
    };
    if (wxtext) {
      wxtext = wxtext.toLowerCase();
      if (typeof iconmap[wxtext] !== 'undefined') {
        icon_name = iconmap[wxtext];
      }
    }
    return icon_name;
  }

  _getTemperature(temp) {
    if (!temp) return '';
    let celsius = temp.slice(0, temp.indexOf('C') - 1).trim();
    if (isNaN(celsius)) return '';
    return celsius;
  }

  _getWindspeed(wind) {
    if (!wind) return '';
    let mph = wind.replace('mph', '');
    if (isNaN(mph)) return '';
    let out = mph * 1.6;
    return out;
  }

  // dummy function that exists just to list the strings
  // for translation
  _dummy() {
    let a = [
      _('Clear Sky'),
      _('Drizzle'),
      _('Fog'),
      _('Grey Cloud'),
      _('Hail Shower'),
      _('Hazy'),
      _('Heavy Rain Shower'),
      _('Heavy Rain'),
      _('Heavy Snow Shower'),
      _('Heavy Snow'),
      _('Light Cloud'),
      _('Light Rain Shower'),
      _('Light Rain'),
      _('Light Snow Shower'),
      _('Light Snow'),
      _('Mist'),
      _('Partly Cloudy'),
      _('Rain'),
      _('Sand Storm'),
      _('Sleet Shower'),
      _('Sleet'),
      _('Sunny Intervals'),
      _('Sunny'),
      _('Thick Cloud'),
      _('Thunder Storm'),
      _('Thunderstorm'),
      _('Thundery Shower'),
      _('White Cloud')
    ];
  }
};
