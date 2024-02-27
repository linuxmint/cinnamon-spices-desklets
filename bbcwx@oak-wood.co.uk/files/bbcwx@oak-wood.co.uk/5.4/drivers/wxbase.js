// Base Driver
// This is overridden by drivers that actually do the work.
//
//const wxBase = imports.wxbase;
//var Driver = class Driver extends wxBase.Driver {
//  constructor(stationID, apikey) {
//    super(stationID, apikey);
//  }
//};
const ByteArray = imports.byteArray;
const GLib = imports.gi.GLib;
const GObject = imports.gi;
const Gettext = imports.gettext;
const LANGLIST = GLib.get_language_names();
const Soup = imports.gi.Soup;
const UUID = 'bbcwx@oak-wood.co.uk';

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + '/.local/share/locale');

function _(str) {
  if (str) return Gettext.dgettext(UUID, str);
}

var SERVICE_STATUS_ERROR = 0;
var SERVICE_STATUS_INIT = 1;
var SERVICE_STATUS_OK = 2;

var _httpSession;
if (Soup.MAJOR_VERSION === undefined || Soup.MAJOR_VERSION === 2) {
  _httpSession = new Soup.SessionAsync();
  Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());
} else { // version 3
  _httpSession = new Soup.Session();
}

var Driver = class Driver {
  // initialize
  constructor(stationID, apikey) {
    this.stationID = stationID;
    // API key for use in some services
    this.apikey = (typeof apikey !== 'undefined') ? apikey : '';

    // name of the driver
    this.drivertype = 'Base';
    // URL for credit link
    this.linkURL = '';
    // text for credit link
    this.linkText = '';
    this.linkIcon = false;
    // the maximum number of days of forecast supported by this driver
    this.maxDays = 1;
    // minimum allowed interval between refreshes
    // refer to each service's terms of service when setting specific values
    this.minTTL = 600;
    this.lang_map = {};

    // a list of capabilities supported by the driver
    // we set them all to true here and expect any children
    // to disable those they don't support
    this.capabilities = {
      cc: {
        feelslike: true,
        humidity: true,
        pressure: true,
        pressure_direction: true,
        temperature: true,
        visibility: true,
        weathertext: true,
        wind_direction: true,
        wind_speed: true
      },
      forecast: {
        humidity: true,
        maximum_temperature: true,
        minimum_temperature: true,
        pressure: true,
        weathertext: true,
        wind_direction: true,
        wind_speed: true
      },
      meta: {
        city: true,
        country: true,
        region: true,
        wgs84: true
      }
    };
    // ### TODO: if we later use visibility, we need to indicate if driver returns
    // a value (in km) or a descriptive string (good/fair/poor - BBC)

    this.data = new Object();
    this._emptyData();
    this.unitsInSummaries = false;
  }

  // create an empty data structure to be filled in by child drivers
  // numeric data returned should be values without units appended. The following units
  // should be used
  // Distance: km
  // Speed: km/h
  // Temperature: C
  // Pressure: mb / HPa
  // Visibility may be expressed either as a number of km or a descriptive string
  // Wind direction should be a 16 point compass bearing, eg SSW
  // Day names should be English three letter abbreviations, eg Mon, Tue
  _emptyData() {
    this.data.city = '';
    this.data.country = '';
    this.data.wgs84 = new Object();
    this.data.wgs84.lat = null;
    this.data.wgs84.lon = null;

    this.data.days = [];

    // the status of the service request
    delete this.data.status;
    this.data.status = new Object();
    // 1: waiting; 2: success; 0; failed/error
    this.data.status.cc = SERVICE_STATUS_INIT;
    this.data.status.forecast = SERVICE_STATUS_INIT;
    this.data.status.meta = SERVICE_STATUS_INIT;
    this.data.status.lasterror = false;

    // current conditions
    delete this.data.cc;
    this.data.cc = new Object();
    this.data.cc.feelslike = '';
    this.data.cc.has_temp = false;
    this.data.cc.humidity = '';
    this.data.cc.icon = '';
    this.data.cc.pressure = '';
    this.data.cc.pressure_direction = '';
    this.data.cc.temperature = '';
    this.data.cc.visibility = '';
    this.data.cc.weathertext = '';
    this.data.cc.wind_direction = '';
    this.data.cc.wind_speed = '';

    // forecast
    for (let i = 0; i < this.maxDays; i++) {
      let day = new Object();
      day.day = '';
      day.humidity = '';
      day.icon = '';
      day.maximum_temperature = '';
      day.minimum_temperature = '';
      day.pressure = '';
      day.weathertext = '';
      day.wind_direction = '';
      day.wind_speed = '';
      delete this.data.days[i];
      this.data.days[i] = day;
    };
  }

  // change the stationID
  setStation(stationID) {
    this.stationID = stationID;
  }

  // change the apikey
  setApiKey(apikey) {
    this.apikey = apikey;
  }

  // for debugging. Log the driver type
  showType() {
    global.log('Using driver type: ' + this.drivertype);
  }

  // async call to retrieve the data.
  // -> url: url to call
  // -> callback: callback function to which the retrieved data is passed
  _getWeather(url, callback, params, userAgent) {
    // debugging
    // global.log('bbcwx: calling ' + url);
    var here = this;
    if (params) {
      let glib_str_url = new GLib.String(url + '?');
      for (const [key, value] of Object.entries(params)) {
        Soup.header_g_string_append_param(glib_str_url, key, value + '&');
      }
      url = glib_str_url.str.replace(/['"']/g, '');
      url = url.replace(/\&$/, '');
    }
    let message = Soup.Message.new('GET', url);
    if (Soup.MAJOR_VERSION === undefined || Soup.MAJOR_VERSION === 2) {
      _httpSession.timeout = 10;
      _httpSession.idle_timeout = 10;
      if (userAgent) _httpSession.user_agent = userAgent;
      _httpSession.queue_message(message, function (session, message) {
        if (message.status_code == 200) {
          try { callback.call(here, message.response_body.data.toString()); } catch (e) { global.logError(e) }
        } else {
          global.logWarning('Error retrieving address ' + url + '. Status: ' + message.status_code + ': ' + message.reason_phrase);
          here.data.status.lasterror = message.status_code;
          callback.call(here, false);
        }
      });
    } else { // Soup 3.0
      _httpSession.timeout = 10;
      _httpSession.idle_timeout = 10;
      if (userAgent) _httpSession.user_agent = userAgent;
      _httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, function (session, result) {
        if (message.get_status() === 200) {
          try {
            const bytes = _httpSession.send_and_read_finish(result);
            callback.call(here, ByteArray.toString(bytes.get_data()));
          } catch (e) { global.logError(e) }
        } else {
          global.logWarning('Error retrieving address ' + url + '. Status: ' + message.get_status() + ': ' + message.get_reason_phrase());
          here.data.status.lasterror = message.get_status();
          callback.call(here, false);
        }
      });
    }
  }

  // stub function to be overridden by child classes. deskletObj is a reference
  // to the main object. It is passed to allow deskletObj.displayForecast()
  // deskletObj.displayMeta() and deskletObj.displayCurrent() to be called from
  // within callback functions.
  refreshData(deskletObj) {
  }

  // utility function to show an error message with a specified string
  _showError(deskletObj, message) {
    this.data.status.cc = SERVICE_STATUS_ERROR;
    this.data.status.forecast = SERVICE_STATUS_ERROR;
    this.data.status.meta = SERVICE_STATUS_ERROR;
    if (message) this.data.status.lasterror = message;
    if (deskletObj) {
      deskletObj.displayCurrent();
      deskletObj.displayForecast();
      deskletObj.displayMeta();
    }
  }

  // Utility function to translate direction in degrees into 16 compass points
  compassDirection(deg) {
    // Next 16 strings are for wind direction, compass points
    let directions = [_('N'), _('NNE'), _('NE'), _('ENE'), _('E'), _('ESE'), _('SE'), _('SSE'), _('S'), _('SSW'), _('SW'), _('WSW'), _('W'), _('WNW'), _('NW'), _('NNW')];
    return directions[Math.round(deg / 22.5) % directions.length];
  }

  // Get the service specific language code that best serves the current locale
  getLangCode() {
    let langlist = LANGLIST;
    let lang = '';
    for (let i = 0; i < langlist.length; i++) {
      if (langlist[i] != 'C') {
        if (langlist[i] && (typeof this.lang_map[langlist[i].toLowerCase()] !== 'undefined')) {
          lang = this.lang_map[langlist[i].toLowerCase()];
          i = langlist.length;
        }
      }
    }
    // debugging
    // global.log('bbcwx: langlist: ' + langlist.join() + '; lang: ' + lang);
    return lang;
  }

  _getDayName(i) {
    // handle Glib days, which use 1 based numbering starting with Mon
    // all the same except Sun is 7, not 0
    if (i == 7) { i = 0; }
    let days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[i];
  }

  _minArr(arr) {
    return arr.reduce(function (p, v) {
      return (p < v ? p : v);
    });
  }

  _maxArr(arr) {
    return arr.reduce(function (p, v) {
      return (p > v ? p : v);
    });
  }

  _avgArr(arr) {
    return arr.reduce(function (p, v) {
      return p + v;
    }) / arr.length;
  }

  // Utility to get a localised weather text string from a Yahoo/TWC code. This
  // function is here because both the Yahoo and TWC drivers use it
  _getWeatherTextFromYahooCode(code) {
    let wxtext = '';
    let textmap = {
      '0': _('Tornado'),
      '1': _('Tropical Storm'),
      '2': _('Hurricane'),
      '3': _('Severe Thunderstorms'),
      '4': _('Thunderstorms'),
      '5': _('Mixed Rain and Snow'),
      '6': _('Mixed Rain and Sleet'),
      '7': _('Mixed Snow and Sleet'),
      '8': _('Freezing Drizzle'),
      '9': _('Drizzle'),
      '10': _('Freezing Rain'),
      '11': _('Showers'),
      '12': _('Showers'),
      '13': _('Snow Flurries'),
      '14': _('Light Snow Showers'),
      '15': _('Blowing Snow'),
      '16': _('Snow'),
      '17': _('Hail'),
      '18': _('Sleet'),
      '19': _('Dust'),
      '20': _('Foggy'),
      '21': _('Haze'),
      '22': _('Smoky'),
      '23': _('Blustery'),
      '24': _('Windy'),
      '25': _('Cold'),
      '26': _('Cloudy'),
      '27': _('Mostly Cloudy'),
      '28': _('Mostly Cloudy'),
      '29': _('Partly Cloudy'),
      '30': _('Partly Cloudy'),
      '31': _('Clear'),
      '32': _('Sunny'),
      '33': _('Fair'),
      '34': _('Fair'),
      '35': _('Mixed Rain and Hail'),
      '36': _('Hot'),
      '37': _('Isolated Thunderstorms'),
      '38': _('Scattered Thunderstorms'),
      '39': _('Scattered Showers'),  // see http://developer.yahoo.com/forum/YDN-Documentation/Yahoo-Weather-API-Wrong-Condition-Code/1290534174000-1122fc3d-da6d-34a2-9fb9-d0863e6c5bc6
      '40': _('Scattered Showers'),
      '41': _('Heavy Snow'),
      '42': _('Scattered Snow Showers'),
      '43': _('Heavy Snow'),
      '44': _('Partly Cloudy'),
      '45': _('Thundershowers'),
      '46': _('Snow Showers'),
      '47': _('Isolated Thundershowers'),
      '3200': _('Not Available')
    }
    if (code && typeof textmap[code] !== 'undefined') {
      wxtext = textmap[code];
    }
    return wxtext;
  }
};
