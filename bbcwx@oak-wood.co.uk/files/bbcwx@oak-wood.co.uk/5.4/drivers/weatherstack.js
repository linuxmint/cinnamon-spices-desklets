/*
* weatherstack.js - Driver for the bbcwx desklet that gets weather data
* from the Weatherstack API (https://weatherstack.com).
*
*Key features:
* - Support for free and paid plans
* - Automatic day/night icons
* - Robust error handling
* - Internationalization
*/

const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const UUID = 'bbcwx@oak-wood.co.uk';
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
imports.searchPath.push(`${DESKLET_DIR}/drivers`);
const wxBase = imports.wxbase;

const SERVICE_STATUS_OK = wxBase.SERVICE_STATUS_OK;

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + '/.local/share/locale');

function _(str) {
  return Gettext.dgettext(UUID, str) || str;
}

var Driver = class Driver extends wxBase.Driver {
  constructor(stationID, apikey) {
    super(stationID, apikey);
    
    // Configuration of driver capabilities
    this.capabilities.cc.pressure_direction = false;
    this.capabilities.forecast.humidity = false;
    this.capabilities.forecast.pressure = false;
    this.capabilities.forecast.wind_speed = false;
    this.capabilities.forecast.wind_direction = false;
    this.capabilities.forecast.weathertext = false;

    this.drivertype = 'weatherstack';
    
    // Weatherstack supports up to 14 days for paid plans
    this.maxDays = 1; //Default value, will be adjusted after check
    
    this.linkText = 'weatherstack';
    this.linkURL = 'https://weatherstack.com';
    this._baseURL = 'https://api.weatherstack.com/current';
    this._forecastURL = 'https://api.weatherstack.com/forecast';
    
    // 1-hour limit for free plans
    this.minTTL = 3600; // Default value, will be adjusted after check

    this.isFreePlan = true; // Assumes free plan until check
    this.hasForecast = false;
  }

  refreshData(deskletObj) {
  	// Initializes with free settings (more conservative)
    this._setFreePlan();
    
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
    
    // Common Parameters
    let params = {
      'access_key': this.apikey,
      'query': this.stationID,
      'units': 'm' // Metric for consistency with wxbase
    };
    
    if (this.langcode) params.language = this.langcode;

    // First search for current data
    this._getWeather(this._baseURL, (data) => {
      if (!data) {
        this._showError(deskletObj, _('Failed to get weather data'));
        return;
      }

      try {
        const json = JSON.parse(data);
        this._processCurrentData(json);
        
        // Checks if it is incompatible plan error
        if (json.error && json.error.code === 105) {
          this.isFreePlan = true;
          this.hasForecast = false;
          global.logWarning("Weatherstack: Free plan detected - forecast disabled");
        }

        // Processes current data even if there is error 105
        this._processCurrentData(json);
        
        // If it is not free plan, try to seek forecast
        if (!this.isFreePlan && this.hasForecast) {
          this._getWeather(this._forecastURL, (forecastData) => {
            if (forecastData) {
              this._processForecastData(forecastData);
            }
            deskletObj.displayForecast();
            deskletObj.displayCurrent();
            deskletObj.displayMeta();
          }, {...params, forecast_days: this.maxDays});
        } else {
          deskletObj.displayForecast();
          deskletObj.displayCurrent();
          deskletObj.displayMeta();
        }
      } catch (e) {
        this._showError(deskletObj, _('Error processing weather data'));
        global.logError(e);
      }
    }, params);
  }

  _processCurrentData(json) {
    // Error verification of API
    if (json.error) {
    	if (json.error && json.error.code !== 105) {	// Code 105 = flat does not support feature
    		this._setFreePlan();
            global.logWarning("Weatherstack: Free plan detected");
        } else {
      		throw new Error(json.error.info || _('API error'));
    	}
    	} else {
        	// If there was no error 105 and has forecast_days available, takes on paid plan
        	if (json.forecast && json.forecast.forecast_days) {
            	this._setPaidPlan();
            }
        }

    const current = json.current || {};
    const location = json.location || {};
    const isDay = current.is_day === 'yes';
    
    this.data.cc = {
      temperature: current.temperature,
      has_temp: current.temperature !== undefined,
      feelslike: current.feelslike,
      humidity: current.humidity,
      pressure: current.pressure,
      wind_speed: current.wind_speed,
      wind_direction: current.wind_dir,
      weathertext: this._mapDescription(current.weather_descriptions?.[0]),
      visibility: current.visibility,
      icon: this._mapIcon(current.weather_code, isDay)
    };

    this.data.city = location.name;
    this.data.region = location.region;
    this.data.country = location.country;
    this.data.wgs84 = {
      lat: location.lat,
      lon: location.lon
    };

    this.data.status.cc = SERVICE_STATUS_OK;
    this.data.status.meta = SERVICE_STATUS_OK;
  }


  //Configure parameters for free plane
  _setFreePlan() {
   	this.isFreePlan = true;
	this.hasForecast = false;
	this.maxDays = 1;
	this.minTTL = 3600; // 1 hour for free plans
	global.log("Configure for FREE plane: maxDays=1, minTTL=3600");
  }

  //Configure parameters for paid plan
  _setPaidPlan() {
    this.isFreePlan = false;
    this.hasForecast = true;
    this.maxDays = 7; // Supports up to 14 days
    this.minTTL = 900; // 15 minutes for paid plans
    global.log("Configure for PAID plane: maxDays=7, minTTL=900");
  }

  _processForecastData(data) {
    try {
      const json = JSON.parse(data);
      if (json.error) {
        // If there is error 105 in the forecast, disables for future calls
        if (json.error.code === 105) {
          this.isFreePlan = true;
          this.hasForecast = false;
        }
        return;
      }

      let dayCount = 0;
      for (const [date, dayData] of Object.entries(json.forecast || {})) {
        if (dayCount >= this.maxDays) break;
        
        this.data.days[dayCount] = {
          day: this._getDayName(new Date(date).getUTCDay()),
          minimum_temperature: dayData.mintemp,
          maximum_temperature: dayData.maxtemp,
          icon: this._mapIcon(dayData.condition, true), // Assumes day for forecast
          weathertext: this._mapDescription(dayData.condition)
        };
        dayCount++;
      }
      
      this.data.status.forecast = SERVICE_STATUS_OK;
    } catch (e) {
      global.logError("Error processing forecast data: " + e);
    }
  }

  _mapIcon(iconcode, isDay) {
    // Completer mapping of condition codes for icons
    const iconMapDay = {
      '113': '32', // Sunny/Clear
      '116': '30', // Partly cloudy
      '119': '26', // Cloudy
      '122': '26', // Overcast
      '143': '20', // Mist
      '176': '39', // Patchy rain possible
      '179': '13', // Patchy snow possible
      '182': '06', // Patchy sleet possible
      '185': '08', // Patchy freezing drizzle possible
      '200': '38', // Thundery outbreaks possible
      '227': '15', // Blowing snow
      '230': '15', // Blizzard
      '248': '20', // Fog
      '260': '20', // Freezing fog
      '263': '09', // Patchy light drizzle
      '266': '09', // Light drizzle
      '281': '08', // Freezing drizzle
      '284': '08', // Heavy freezing drizzle
      '293': '09', // Patchy light rain
      '296': '09', // Light rain
      '299': '11', // Moderate rain at times
      '302': '11', // Moderate rain
      '305': '12', // Heavy rain at times
      '308': '12', // Heavy rain
      '311': '08', // Light freezing rain
      '314': '08', // Moderate or heavy freezing rain
      '317': '06', // Light sleet
      '320': '06', // Moderate or heavy sleet
      '323': '13', // Patchy light snow
      '326': '13', // Light snow
      '329': '14', // Patchy moderate snow
      '332': '14', // Moderate snow
      '335': '16', // Patchy heavy snow
      '338': '16', // Heavy snow
      '350': '18', // Ice pellets
      '353': '39', // Light rain shower
      '356': '39', // Moderate or heavy rain shower
      '359': '39', // Torrential rain shower
      '362': '18', // Light sleet showers
      '365': '18', // Moderate or heavy sleet showers
      '368': '13', // Light snow showers
      '371': '16', // Moderate or heavy snow showers
      '374': '18', // Light showers of ice pellets
      '377': '18', // Moderate or heavy showers of ice pellets
      '386': '37', // Patchy light rain with thunder
      '389': '04', // Moderate or heavy rain with thunder
      '392': '13', // Patchy light snow with thunder
      '395': '16'  // Moderate or heavy snow with thunder
    };

    const iconMapNight = {
      '113': '31', // Clear night
      '116': '29', // Partly cloudy night
      '119': '26', // Cloudy (same as day)
      '122': '26', // Overcast (same as day)
      '143': '20', // Mist (same as day)
      '176': '45', // Patchy rain possible night
      '179': '46', // Patchy snow possible night
      '182': '46', // Patchy sleet possible night
      '185': '46', // Patchy freezing drizzle possible night
      '200': '47', // Thundery outbreaks possible night
      '227': '15', // Blowing snow (same as day)
      '230': '15', // Blizzard (same as day)
      '248': '20', // Fog (same as day)
      '260': '20', // Freezing fog (same as day)
      '263': '09', // Patchy light drizzle (same as day)
      '266': '09', // Light drizzle (same as day)
      '281': '08', // Freezing drizzle (same as day)
      '284': '08', // Heavy freezing drizzle (same as day)
      '293': '09', // Patchy light rain (same as day)
      '296': '09', // Light rain (same as day)
      '299': '11', // Moderate rain at times (same as day)
      '302': '11', // Moderate rain (same as day)
      '305': '12', // Heavy rain at times (same as day)
      '308': '12', // Heavy rain (same as day)
      '311': '08', // Light freezing rain (same as day)
      '314': '08', // Moderate or heavy freezing rain (same as day)
      '317': '06', // Light sleet (same as day)
      '320': '06', // Moderate or heavy sleet (same as day)
      '323': '13', // Patchy light snow (same as day)
      '326': '13', // Light snow (same as day)
      '329': '14', // Patchy moderate snow (same as day)
      '332': '14', // Moderate snow (same as day)
      '335': '16', // Patchy heavy snow (same as day)
      '338': '16', // Heavy snow (same as day)
      '350': '18', // Ice pellets (same as day)
      '353': '45', // Light rain shower night
      '356': '45', // Moderate or heavy rain shower night
      '359': '45', // Torrential rain shower night
      '362': '18', // Light sleet showers (same as day)
      '365': '18', // Moderate or heavy sleet showers (same as day)
      '368': '13', // Light snow showers (same as day)
      '371': '16', // Moderate or heavy snow showers (same as day)
      '374': '18', // Light showers of ice pellets (same as day)
      '377': '18', // Moderate or heavy showers of ice pellets (same as day)
      '386': '47', // Patchy light rain with thunder night
      '389': '47', // Moderate or heavy rain with thunder night
      '392': '46', // Patchy light snow with thunder night
      '395': '46'  // Moderate or heavy snow with thunder night
    };
    
    return iconcode ? (isDay ? iconMapDay : iconMapNight)[iconcode] || 'na' : 'na';
  }

  _mapDescription(description) {
    if (!description) return '';
    
    // Standardizes the description for mapping
    const desc = typeof description === 'string' ? 
      description.toLowerCase() : 
      (description[0] ? description[0].toLowerCase() : '');
    
    const descriptionMap = {
      'sunny': _('Sunny'),
      'clear': _('Clear'),
      'partly cloudy': _('Partly Cloudy'),
      'cloudy': _('Cloudy'),
      'overcast': _('Overcast'),
      'mist': _('Mist'),
      'fog': _('Fog'),
      'freezing fog': _('Freezing Fog'),
      'patchy rain possible': _('Patchy Rain Possible'),
      'light rain': _('Light Rain'),
      'moderate rain': _('Moderate Rain'),
      'heavy rain': _('Heavy Rain'),
      'light snow': _('Light Snow'),
      'moderate snow': _('Moderate Snow'),
      'heavy snow': _('Heavy Snow'),
      'light sleet': _('Light Sleet'),
      'moderate sleet': _('Moderate Sleet'),
      'light rain shower': _('Light Rain Shower'),
      'moderate rain shower': _('Moderate Rain Shower'),
      'heavy rain shower': _('Heavy Rain Shower'),
      'thundery outbreaks possible': _('Thundery Outbreaks Possible'),
      'blizzard': _('Blizzard')
    };
    
    return descriptionMap[desc] || description;
  }
};
