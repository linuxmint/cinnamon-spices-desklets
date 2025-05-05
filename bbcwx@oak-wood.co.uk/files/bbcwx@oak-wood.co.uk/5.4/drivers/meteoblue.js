// Meteoblue Driver - Updated driver for meteoblue API V2
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const UUID = 'bbcwx@oak-wood.co.uk';
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
imports.searchPath.push(`${DESKLET_DIR}/drivers`);
const wxBase = imports.wxbase;

const SERVICE_STATUS_OK = wxBase.SERVICE_STATUS_OK;
const SERVICE_STATUS_ERROR = wxBase.SERVICE_STATUS_ERROR;

// endpoint with the data city,region,country,asl
const LOCATION_SEARCH_URL = 'https://www.meteoblue.com/en/server/search/query3';

// 10,000,000 credits per day on the free apikey
// 12,000 credits per query with basic-1h and basic-day 
// 833 queries per day - 1 query every 2 minutes
const WEATHER_API_URL = 'https://my.meteoblue.com/packagesV2/basic-1h_basic-day';			

// Ensure the import path is correct
try {
    imports.searchPath.unshift(`${DESKLET_DIR}/drivers`);
    const wxBase = imports.wxbase;
} catch (e) {
    global.logError(`Failed to import wxbase: ${e}`);
}

// Internationalization configuration
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + '/.local/share/locale');

function _(str) {
    return str ? Gettext.dgettext(UUID, str) : '';
}

var Driver = class Driver extends wxBase.Driver {
  // initialize the driver
    constructor(stationID, apikey) {
        super(stationID, apikey);
        this._destroyed = false;
        this._locationData = null;
        
        this.drivertype = 'meteoblue';
        this.maxDays = 7;
        this.minTTL = 600;
        this.linkText = 'meteoblue.com';
        this.linkIcon = {
            file: 'meteoblue',
            width: 59,
            height: 20
        };

        // Override only necessary capabilities
        this.capabilities.cc.visibility = false;
        this.capabilities.cc.pressure_direction = false;
        this.capabilities.meta.elevation = true;
    }

	//Cleaning
    destroy() {
        this._destroyed = true;		// Flag for destruction control
        this._locationData = null;
        super.destroy();
    }

    refreshData(deskletObj) {
        if (this._destroyed) return;

        this._emptyData();
        
        if (!this._validateCoordinates(this.stationID)) {
            this._showError(deskletObj, _('Invalid location coordinates'));
            return;
        }

        if (!this.apikey) {
            this._showError(deskletObj, _('API key required'));
            return;
        }

        this._fetchLocationData(() => {
            this._fetchWeatherData(deskletObj);
        });
    }

    _fetchLocationData(callback) {
        const [lat, lon] = this.stationID.split(',');
        const params = {
            query: `${lat} ${lon}`,
            apikey: this.apikey
        };

		// Search location information
        this._getWeather(LOCATION_SEARCH_URL, (locationData) => {
            if (this._destroyed) return;
            
            try {
                if (locationData) {
                    const result = JSON.parse(locationData);
                    if (result?.results?.[0]) {
                        const loc = result.results[0];
                        this._locationData = {
                            name: loc.name || '',
                            country: loc.country || '',
                            region: loc.admin1 || '',
                            elevation: Math.round(loc.elevation) || 0,
                            urlCoord: result.urlCoord || this._formatCoords(lat, lon),
                            coords: {
                                lat: parseFloat(lat),
                                lon: parseFloat(lon)
                            }
                        };
                    }
                }
            } catch (e) {
                global.logWarning('Location data error: ' + e);
            } finally {
                callback();
            }
        }, params);
    }

    _fetchWeatherData(deskletObj) {
        if (!this._locationData) {
            this._showError(deskletObj, _('Location data not available'));
            return;
        }

        const params = {
            apikey: this.apikey,
            lat: this._locationData.coords.lat,
            lon: this._locationData.coords.lon,
            asl: this._locationData.elevation,
            format: 'json',
            // Get units from schema with default values
            temperature: this._mapUnit(deskletObj.tunits, 'temp'),
            windspeed: this._mapUnit(deskletObj.wunits, 'wind'),
            pressure: this._mapUnit(deskletObj.punits, 'pressure'),
            tz: 'UTC',
            lang: this.getLangCode() || 'en'
        };

        this._getWeather(WEATHER_API_URL, (weather) => {
            if (this._destroyed) return;
            
            if (!weather) {
                this._showError(deskletObj, _('No weather data received'));
                return;
            }

            try {
                const json = this._parseResponse(weather);
                this._validateWeatherData(json);
                this._processWeatherResponse(json, deskletObj);
            } catch (e) {
                global.logError('Weather error: ' + e.message);
                this._showError(deskletObj, e.userMessage || _('Weather data error'));
            }
        }, params, 'Meteoblue-API/V2');
    }

    _parseResponse(weather) {
        try {
            return JSON.parse(weather);
        } catch (e) {
            throw {
                message: 'Invalid JSON response',
                userMessage: _('Invalid data from server')
            };
        }
    }

    _validateWeatherData(json) {
        if (!json || typeof json !== 'object') {
            throw {
                message: 'Invalid API response structure',
                userMessage: _('Invalid weather data format')
            };
        }

        if (json.code && json.code !== 200) {
            throw {
                message: json.error_message || 'API error',
                userMessage: _('Service unavailable')
            };
        }

        if (!json.data_1h || !json.data_day) {
            throw {
                message: 'Missing data fields',
                userMessage: _('Incomplete weather data')
            };
        }
    }

    _processWeatherResponse(json, deskletObj) {
        // Process current conditions from data_1h
        this._processCurrentData(json.data_1h);
        
        // Process forecast from data_day
        this._processForecastData(json.data_day);
        
        // Update metadata
        this._updateMetadata();
        
        // Safe UI update
        this._safeUIUpdate(deskletObj);
    }

	// Current metadata
    _processCurrentData(data1h) {
        const now = new Date();
        const currentHour = now.getUTCHours();
        const currentIndex = currentHour; // Assuming data is hourly starting at 00:00
        
        this.data.cc = {
            temperature: data1h.temperature[currentIndex],
            feelslike: data1h.felttemperature[currentIndex],
            humidity: data1h.relativehumidity[currentIndex],
            pressure: data1h.sealevelpressure[currentIndex],
            wind_speed: data1h.windspeed[currentIndex],
            wind_direction: this.compassDirection(data1h.winddirection[currentIndex]),
            weathertext: this._getWxTxt(data1h.pictocode[currentIndex]),
            icon: this._mapicon(
                data1h.pictocode[currentIndex],
                data1h.isdaylight[currentIndex]
            ),
            has_temp: data1h.temperature[currentIndex] !== null
        };

        this.data.status.cc = this.data.cc.temperature !== null ? 
            SERVICE_STATUS_OK : SERVICE_STATUS_ERROR;
    }

	// Forecast metadata
    _processForecastData(dataDay) {
        const daysToShow = Math.min(dataDay.time.length, this.maxDays);
        this.data.days = [];

        for (let i = 0; i < daysToShow; i++) {
            this.data.days[i] = {
                day: this._getDayName(new Date(dataDay.time[i]).getUTCDay()),
                maximum_temperature: dataDay.temperature_max[i],
                minimum_temperature: dataDay.temperature_min[i],
                pressure: dataDay.sealevelpressure_mean[i],
                humidity: dataDay.relativehumidity_mean[i],
                wind_speed: dataDay.windspeed_mean[i],
                wind_direction: this.compassDirection(dataDay.winddirection[i]),
                weathertext: this._getWxTxt(dataDay.pictocode[i]),
                icon: this._mapicon(dataDay.pictocode[i], true)
            };
        }

        this.data.status.forecast = this.data.days.length > 0 ? 
            SERVICE_STATUS_OK : SERVICE_STATUS_ERROR;
    }

	// Stores location data
    _updateMetadata() {
        if (this._locationData) {
            this.data.city = this._locationData.name;
            this.data.country = this._locationData.country;
            this.data.region = this._locationData.region;
            this.data.wgs84 = this._locationData.coords;
            this.data.elevation = this._locationData.elevation;
            // https://www.meteoblue.com/en/weather/week/52.275N-1.597E
            this.linkURL = `https://www.meteoblue.com/en/weather/week/${this._locationData.urlCoord}`;
        }
        this.data.status.meta = SERVICE_STATUS_OK;
    }

	// Update status
    _safeUIUpdate(deskletObj) {
        if (!deskletObj || this._destroyed) return;

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (!this._destroyed && deskletObj) {
                deskletObj.displayForecast();
                deskletObj.displayCurrent();
                deskletObj.displayMeta();
            }
            return false;
        });
    }

	// Map units from the schema to values ​​expected by the meteoblue API
    _mapUnit(value, type) {
        const maps = {
            temp: { 
            'C': 'C', 
            'F': 'F' 
            },
            wind: { 
            'mph': 'mph', 
            'kph': 'kmh', 		// meteoblue expects 'kmh' but schema uses 'kph'
            'knots': 'kn', 		// meteoblue expects 'kn' but schema uses 'knots'
            'mps': 'ms-1' 		// meteoblue expects 'mps' but schema uses 'ms-1'
            },
            pressure: { 
            'mb': 'hPa', 		// meteoblue expects 'hPa' but schema uses 'mb'
            'in': 'inhg', 		// meteoblue expects 'inhg' but schema uses 'in'
            'mm': 'mmhg', 		// meteoblue expects 'mmgh' but schema uses 'mm'
            'kpa': 'kPa' 		// meteoblue expects 'kPa' but schema uses 'kpa'
            }
        };
        return maps[type][value] || Object.values(maps[type])[0];
    }

    _validateCoordinates(coords) {
        return coords && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(coords);
    }

    _formatCoords(lat, lon) {
        const latNum = parseFloat(lat);
        const lonNum = parseFloat(lon);
        const latDir = latNum >= 0 ? 'N' : 'S';
        const lonDir = lonNum >= 0 ? 'E' : 'W';
        return `${Math.abs(latNum).toFixed(2)}${latDir}${Math.abs(lonNum).toFixed(2)}${lonDir}`;
    }

    _getWxTxt(pictocode) {
        const textmap = {
            '1': _('Clear Sky'), 
            '2': _('Fair'), 
            '3': _('Partly Cloudy'),
            '4': _('Cloudy'), 
            '5': _('Fog'), 
            '6': _('Rain'),
            '7': _('Showers'), 
            '8': _('Thundery Shower'), 
            '9': _('Snow'),
            '10': _('Snow Showers'), 
            '11': _('Mixed Rain and Snow'),
            '12': _('Light Rain'), 
            '13': _('Light Snow'), 
            '14': _('Rain'),
            '15': _('Snow'), 
            '16': _('Light Rain'), 
            '17': _('Light Snow')
        };
        return pictocode ? textmap[pictocode] || '' : '';
    }

    _mapicon(iconcode, isDay) {
        const iconmapday = {
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

        const iconmapnight = {
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

        return iconcode ? (isDay ? iconmapday : iconmapnight)[iconcode] || 'na' : 'na';
    }
};
