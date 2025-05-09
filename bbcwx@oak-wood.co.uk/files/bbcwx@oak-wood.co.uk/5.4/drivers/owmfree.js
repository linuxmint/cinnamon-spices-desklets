// Open Weather Map Free Driver 
// Update driver for news parameters and optimized code
// BUG #1430 --> Adjust parameters endpoint URL

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
    this.capabilities.meta.region = false; // Disabled as API does not provide region

    this.drivertype = 'OWMFree';
    this.maxDays = 5;
    this.linkText = 'openweathermap.org';
    this._baseURL = 'https://api.openweathermap.org/data/2.5/';
    this.linkURL = 'https://openweathermap.org';
    
    // Language mapping
    this.lang_map = {
      'ar': 'ar',
      'bg': 'bg',
      'ca': 'ca',
      'cz': 'cz',
      'da': 'da',
      'de': 'de',
      'el': 'el',
      'en': 'en',
      'es': 'es',
      'fa': 'fa',
      'fi': 'fi',
      'fr': 'fr',
      'gl': 'gl',
      'hi': 'hi',
      'hr': 'hr',
      'hu': 'hu',
      'id': 'id',
      'it': 'it',
      'ja': 'ja',
      'kr': 'kr',
      'la': 'la',
      'lt': 'lt',
      'mk': 'mk',
      'nl': 'nl',
      'no': 'no',
      'pl': 'pl',
      'pt': 'pt',
      'pt_br': 'pt_br',
      'ro': 'ro',
      'ru': 'ru',
      'sk': 'sk',
      'sl': 'sl',
      'sr': 'sr',
      'th': 'th',
      'tr': 'tr',
      'ua': 'ua',
      'vi': 'vi',
      'zh_cn': 'zh_cn',
      'zu': 'zu'
    };
  }

  refreshData(deskletObj) {
    this._emptyData();
    this.linkURL = 'https://openweathermap.org';

    if (!this.stationID || this.stationID.length < 3) {
      this._showError(deskletObj, _('Invalid location - please enter coordinates (lat,lon) or city ID'));
      return;
    }

    if (!this.apikey) {
      this._showError(deskletObj, _('No API key provided - please get an API key from openweathermap.org'));
      return;
    }

    // Check if they are coordinates
    if (this.stationID.match(/^\-?\d+(\.\d+)?,\-?\d+(\.\d+)?$/)) {
      this.latlon = this.stationID.split(',');
      this._fetchWeatherData(deskletObj);
    } 

    // Check if it is a city ID (numbers only)
    else if (this.stationID.match(/^\d+$/)) {
      this._fetchWeatherData(deskletObj, {id: this.stationID});
    }
    else {
      this._showError(deskletObj, _('Invalid format - please use coordinates (lat,lon) or city ID'));
    }

  }

  _fetchWeatherData(deskletObj, additionalParams = {}) {
    this.langcode = this.getLangCode();

    let params = {
      'appid': encodeURIComponent(this.apikey),
      'units': 'metric',
      ...additionalParams
    };
    
    if (this.latlon) {
      params['lat'] = this.latlon[0];
      params['lon'] = this.latlon[1];
    }
    
    if (this.langcode) params['lang'] = this.langcode;

    // 5 day forecast
    let apiforecasturl = this._baseURL + 'forecast';
    this._getWeather(apiforecasturl, (weather) => {
      if (weather) {
        this._load_forecast(weather);
      }
      deskletObj.displayForecast();
      deskletObj.displayMeta();
    }, params);

    // Current conditions
    let apiccurl = this._baseURL + 'weather';
    this._getWeather(apiccurl, (weather) => {
      if (weather) {
        this._load_observations(weather);
      }
      deskletObj.displayCurrent();
    }, params);
  }

  _load_forecast(data) {
    if (!data) {
      this.data.status.forecast = SERVICE_STATUS_ERROR;
      this.data.status.meta = SERVICE_STATUS_ERROR;
      this.data.status.lasterror = 'No data received';
      return;
    }

    try {
      let json = JSON.parse(data);
      
      // Checks the response for errors
      if (json.cod && json.cod != '200') {
        this.data.status.forecast = SERVICE_STATUS_ERROR;
        this.data.status.meta = SERVICE_STATUS_ERROR;
        this.data.status.lasterror = json.message || json.cod;
        return;
      }

      // Processes city data
      if (json.city) {
        this.data.city = json.city.name;
        this.data.country = json.city.country;
        this.data.wgs84.lat = json.city.coord.lat;
        this.data.wgs84.lon = json.city.coord.lon;
        
        if (json.city.id) {
          this.linkURL = 'https://openweathermap.org/city/' + json.city.id;
        }
      }

      // Groups forecasts by day
      let dailyForecasts = {};
      let est_tz = json.city ? Math.round(json.city.coord.lon / 15) * 3600 : 0;

      for (let i = 0; i < json.list.length; i++) {
        let forecast = json.list[i];
        let forecastDate = new Date((forecast.dt + est_tz) * 1000);
        let dayKey = forecastDate.toISOString().split('T')[0]; // Format YYYY-MM-DD

        if (!dailyForecasts[dayKey]) {
          dailyForecasts[dayKey] = {
            min_temp: Infinity,
            max_temp: -Infinity,
            pressures: [],
            humidities: [],
            weathers: [],
            icons: [],
            wind_speeds: [],
            wind_directions: []
          };
        }

        // Updates minimum and maximum temperatures
        dailyForecasts[dayKey].min_temp = Math.min(dailyForecasts[dayKey].min_temp, forecast.main.temp_min);
        dailyForecasts[dayKey].max_temp = Math.max(dailyForecasts[dayKey].max_temp, forecast.main.temp_max);
        
        // Stores other data for averaging
        dailyForecasts[dayKey].pressures.push(forecast.main.pressure);
        dailyForecasts[dayKey].humidities.push(forecast.main.humidity);
        dailyForecasts[dayKey].wind_speeds.push(forecast.wind.speed);
        dailyForecasts[dayKey].wind_directions.push(forecast.wind.deg);
        
        // For time text and icon, get the one for the middle of the day period
        // Fixed: Now picks up any forecast if there is none in the middle of the day
        if (forecastDate.getHours() >= 11 && forecastDate.getHours() <= 14 || dailyForecasts[dayKey].weathers.length === 0) {
          dailyForecasts[dayKey].weathers.push(forecast.weather[0].description.ucwords());
          dailyForecasts[dayKey].icons.push(this._mapicon(forecast.weather[0].icon, forecast.weather[0].id));
        }
      }

      // Convert to array of days and get the next 5 days
      let today = new Date().toISOString().split('T')[0];
      this.data.days = Object.keys(dailyForecasts)
        .sort()
        .filter(date => date > today)
        .slice(0, 5)
        .map((date, index) => {
          let dayData = dailyForecasts[date];
          let middle = Math.floor(dayData.weathers.length / 2);
          
          return {
            day: this._getDayName(new Date(date).getDay()),
            minimum_temperature: dayData.min_temp,
            maximum_temperature: dayData.max_temp,
            pressure: this._avgArr(dayData.pressures),
            humidity: this._avgArr(dayData.humidities),
            wind_speed: this._avgArr(dayData.wind_speeds) * 3.6, // Convert m/s to km/h
            wind_direction: this.compassDirection(this._avgArr(dayData.wind_directions)),
            weathertext: dayData.weathers[middle] || dayData.weathers[0] || '', // Fallback to first prediction
            icon: dayData.icons[middle] || dayData.icons[0] || 'na' // Fallback to first icon
          };
        });

      this.data.status.forecast = SERVICE_STATUS_OK;
      this.data.status.meta = SERVICE_STATUS_OK;

    } catch (e) {
      global.logError(e);
      this.data.status.forecast = SERVICE_STATUS_ERROR;
      this.data.status.meta = SERVICE_STATUS_ERROR;
      this.data.status.lasterror = 'Data parsing error';
    }
  }

  _load_observations(data) {
    if (!data) {
      this.data.status.cc = SERVICE_STATUS_ERROR;
      this.data.status.lasterror = 'No data received';
      return;
    }

    try {
      let json = JSON.parse(data);
      
      if (json.cod && json.cod != 200) {
        this.data.status.cc = SERVICE_STATUS_ERROR;
        this.data.status.lasterror = json.message || json.cod;
        return;
      }

      // Update current data
      this.data.cc.humidity = json.main.humidity;
      this.data.cc.temperature = json.main.temp;
      this.data.cc.has_temp = true;
      this.data.cc.pressure = json.main.pressure;
      this.data.cc.wind_speed = json.wind.speed * 3.6; // Convert m/s to km/h
      this.data.cc.wind_direction = json.wind.deg ? this.compassDirection(json.wind.deg) : '';
      this.data.cc.weathertext = json.weather[0].description.ucwords();
      this.data.cc.visibility = json.visibility ? Math.round(json.visibility / 1000) : ''; // Convert meters to km
      this.data.cc.feelslike = json.main.feels_like;
      this.data.cc.icon = this._mapicon(json.weather[0].icon, json.weather[0].id);
      
      // Update city data if it didn't come from the forecast
      if (!this.data.city && json.name) {
        this.data.city = json.name;
        this.data.country = json.sys?.country || '';
      }
      
      this.data.status.cc = SERVICE_STATUS_OK;
      
    } catch (e) {
      global.logError(e);
      this.data.status.cc = SERVICE_STATUS_ERROR;
      this.data.status.lasterror = 'Data parsing error';
    }
  }

  _getDayName(dayIndex) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[dayIndex % 7];
  }

  _mapicon(iconcode, wxcode) {
    // Updated icon mapping for current API
    const iconmap = {
      '01d': '32', // clear sky day
      '01n': '31', // clear sky night
      '02d': '30', // few clouds day
      '02n': '29', // few clouds night
      '03d': '26', // scattered clouds
      '03n': '26', // scattered clouds
      '04d': '28', // broken clouds
      '04n': '27', // broken clouds night
      '09d': '39', // shower rain
      '09n': '45', // shower rain night
      '10d': '12', // rain day
      '10n': '12', // rain night
      '11d': '04', // thunderstorm
      '11n': '04', // thunderstorm
      '13d': '16', // snow
      '13n': '16', // snow
      '50d': '20', // mist
      '50n': '20'  // mist
    };

    // Timecode specific mapping
    const wxmap = {
      '200': '04', // thunderstorm with light rain
      '201': '04', // thunderstorm with rain
      '202': '04', // thunderstorm with heavy rain
      '210': '04', // light thunderstorm
      '211': '04', // thunderstorm
      '212': '04', // heavy thunderstorm
      '221': '04', // ragged thunderstorm
      '230': '04', // thunderstorm with light drizzle
      '231': '04', // thunderstorm with drizzle
      '232': '04', // thunderstorm with heavy drizzle
      '300': '09', // light intensity drizzle
      '301': '09', // drizzle
      '302': '11', // heavy intensity drizzle
      '310': '09', // light intensity drizzle rain
      '311': '09', // drizzle rain
      '312': '11', // heavy intensity drizzle rain
      '313': '39', // shower rain and drizzle
      '314': '39', // heavy shower rain and drizzle
      '321': '39', // shower drizzle
      '500': '11', // light rain
      '501': '12', // moderate rain
      '502': '12', // heavy intensity rain
      '503': '12', // very heavy rain
      '504': '12', // extreme rain
      '511': '10', // freezing rain
      '520': '39', // light intensity shower rain
      '521': '39', // shower rain
      '522': '39', // heavy intensity shower rain
      '531': '39', // ragged shower rain
      '600': '13', // light snow
      '601': '14', // snow
      '602': '16', // heavy snow
      '611': '18', // sleet
      '612': '06', // light shower sleet
      '615': '05', // light rain and snow
      '616': '05', // rain and snow
      '620': '41', // light shower snow
      '621': '41', // shower snow
      '622': '41', // heavy shower snow
      '701': '20', // mist
      '711': '22', // smoke
      '721': '22', // haze
      '731': '19', // sand/dust whirls
      '741': '20', // fog
      '751': '19', // sand
      '761': '19', // dust
      '762': '19', // volcanic ash
      '771': '23', // squalls
      '781': '00', // tornado
      '800': '32', // clear sky
      '801': '30', // few clouds
      '802': '28', // scattered clouds
      '803': '26', // broken clouds
      '804': '26'  // overcast clouds
    };

    // Night mapping for some icons
    const nightmap = {
      '39': '45', // shower rain night
      '41': '46', // snow shower night
      '30': '29', // few clouds night
      '28': '27', // broken clouds night
      '32': '31', // clear night
      '22': '21', // haze night
      '47': '38'  // isolated thundershowers night
    };

    let icon_name = 'na';

    // First try by timecode (more accurate)
    if (wxcode && wxmap[wxcode.toString()]) {
      icon_name = wxmap[wxcode.toString()];
    }
    // If not, use the icon code
    else if (iconcode && iconmap[iconcode]) {
      icon_name = iconmap[iconcode];
    }

    // Apply night mapping if it is night
    if (iconcode && iconcode.endsWith('n') && nightmap[icon_name]) {
      icon_name = nightmap[icon_name];
    }

    return icon_name;
  }

  _minArr(arr) {
    return arr.reduce((min, val) => Math.min(min, val), Infinity);
  }

  _maxArr(arr) {
    return arr.reduce((max, val) => Math.max(max, val), -Infinity);
  }

  _avgArr(arr) {
    return arr.reduce((sum, val) => sum + val, 0) / arr.length;
  }
};
