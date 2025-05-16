// BBC Weather Driver JSON API
// This driver fetches weather data from the BBC Weather API and processes it for display.

const UUID = 'bbcwx@oak-wood.co.uk';
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
imports.searchPath.push(`${DESKLET_DIR}/drivers`);
const wxBase = imports.wxbase;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext; // Import Gettext

const SERVICE_STATUS_ERROR = wxBase.SERVICE_STATUS_ERROR;
const SERVICE_STATUS_OK = wxBase.SERVICE_STATUS_OK;
const SERVICE_STATUS_INIT = wxBase.SERVICE_STATUS_INIT; // Import SERVICE_STATUS_INIT

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + '/.local/share/locale'); // Bind textdomain

function _(str) {
  if (str) {
    return Gettext.dgettext(UUID, str) ||
           Gettext.dgettext('cinnamon', str) ||
           str; // Fallback para a string original
  }
  return '';
}

var Driver = class Driver extends wxBase.Driver {
    constructor(stationID, apikey) {
        super(stationID, apikey);

        this.maxDays = 7;
        this.capabilities.meta.region = false;

        this.drivertype = 'bbc';
        this.linkText = 'bbc.co.uk/weather';
        this.linkURL = 'https://www.bbc.com/weather/';
        this.locationURL = 'https://open.live.bbc.co.uk/locator/locations';
        this.baseURL = 'https://weather-broker-cdn.api.bbci.co.uk/en/';
        this.linkIcon = {
            file: 'bbc',
            width: 120,
            height: 51
        };
        this.locationID = '';
        this.localURL = '';
    };

    async refreshData(deskletObj) {
        // reset the data object at the beginning of refresh
        //this._emptyData();
        this.data.status.cc = SERVICE_STATUS_INIT;
        this.data.status.forecast = SERVICE_STATUS_INIT;
        this.data.status.meta = SERVICE_STATUS_INIT;
        this.data.status.lasterror = false;


        try {
            // Verify station ID and determine locationID or latlon
            if (!await this._verifyID()) {
                this._showError(deskletObj, this.data.status.lasterror || _('Invalid Station ID'));
                return;
            }

            // Get metadata (location details)
            let jsonlc = await this._getAPImetadata();
            if (!jsonlc) {
                this._showError(deskletObj, this.data.status.lasterror || _('Failed to get location metadata'));
                return;
            }

            // Load location data and set this.locationID if using latlon
            if (this.latlon) {
                if (!await this._loadDataLocation(jsonlc)) {
                    this._showError(deskletObj, this.data.status.lasterror || _('Failed to process location data'));
                    return;
                }
            }

            this.linkURL = 'https://www.bbc.com/weather/' + this.locationID;

            // Get current conditions data
            let jsoncc = await this._getAPIcurrent();
            if (!jsoncc) {
                this._showError(deskletObj, this.data.status.lasterror || _('Failed to get current conditions data'));
                // Continue to try and get forecast data even if current fails
            }

            // Get forecast data
            let jsonfc = await this._getAPIforecasts();
            if (!jsonfc) {
                this._showError(deskletObj, this.data.status.lasterror || _('Failed to get forecast data'));
                // Continue to display what we have if forecast fails
            }

            // reset the data object at the beginning of refresh
            this._emptyData();

            // Load all data into this.data object
            // Pass deskletObj to _loadData for potential error display within loadData if needed,
            // although primary error display is handled above.
            await this._loadData(jsonlc, jsoncc, jsonfc, deskletObj);

            // Display data
            deskletObj.displayMeta();
            deskletObj.displayCurrent();
            deskletObj.displayForecast();

        } catch (error) {
            global.logError(`BBC Driver refreshData error: ${error.message}`);
            this._showError(deskletObj, _('An unexpected error occurred: %s').format(error.message));
        }
    }

    async _verifyID (){
        // check if we have a stationID defined
        if (!this.stationID || typeof this.stationID !== 'string') {
            this.data.status.meta = SERVICE_STATUS_ERROR;
            this.data.status.lasterror = _('Station ID not defined');
            return false;
        }
        // checks if the ID is a geographic coordinate
        // if yes, stores in latlon
        if (this.stationID.search(/^\-?\d+(\.\d+)?,\-?\d+(\.\d+)?$/) == 0) {
            let parts = this.stationID.split(',');
            this.latlon = [];
            this.latlon[0] = parseFloat(parts[0].trim());
            this.latlon[1] = parseFloat(parts[1].trim());
            this.locationID = ''; // Clear locationID if using latlon
        } else {
            this.latlon = null; // Clear latlon if using ID
            this.locationID = this.stationID;
        }
        global.log('LocationID = '+ this.locationID)
        return true;
    }

    // Helper function to wrap _getWeather in a Promise
    _getWeatherAsync(url) {
        return new Promise((resolve, reject) => {
            this._getWeather(url, (weather) => {
                if (weather) {
                    resolve(weather);
                } else {
                    // Assuming _getWeather calls callback with null/undefined on failure
                    // Or you might need to check for a specific error indicator from _getWeather
                    reject(new Error(_('Failed to retrieve data from %s').format(url)));
                }
            });
        });
    }


    async _getAPImetadata() {
        if (this.latlon) {
            this.localURL = `${this.locationURL}?la=${this.latlon[0]}&lo=${this.latlon[1]}&format=json`;
        } else if (this.locationID) {
            this.localURL = `${this.locationURL}/${this.locationID}?format=json`;
        } else {
             this.data.status.meta = SERVICE_STATUS_ERROR;
             this.data.status.lasterror = _('Location ID or coordinates not set');
             return null;
        }

        try {
            // Use the new async helper
            let weatherData = await this._getWeatherAsync(this.localURL);

            if (weatherData) {
                const json = JSON.parse(weatherData);
                // Basic check for expected structure
                if (this.latlon && (!json.response || !json.response.results || !json.response.results.results || json.response.results.results.length === 0)) {
                    this.data.status.meta = SERVICE_STATUS_ERROR;
                    this.data.status.lasterror = _('Invalid location metadata response for lat/lon');
                    return null;
                }
                if (this.locationID && (!json.response || !json.response.name)) {
                    this.data.status.meta = SERVICE_STATUS_ERROR;
                    this.data.status.lasterror = _('Invalid location metadata response for ID');
                    return null;
                }
                this.data.status.meta = SERVICE_STATUS_OK;
                return json;
            } else {
                // This else block might be redundant if _getWeatherAsync rejects on failure
                this.data.status.meta = SERVICE_STATUS_ERROR;
                this.data.status.lasterror = _('Failed to retrieve location metadata');
                return null;
            }
        } catch (error) {
            global.logError(`BBC Driver _getAPImetadata error: ${error.message}`);
            this.data.status.meta = SERVICE_STATUS_ERROR;
            // Use the error message from the rejected promise if available, otherwise a generic one
            this.data.status.lasterror = _('Error retrieving or parsing location metadata: %s').format(error.message);
            return null;
        }
    }

    async _getAPIcurrent() {
        if (!this.locationID) {
             this.data.status.cc = SERVICE_STATUS_ERROR;
             this.data.status.lasterror = _('Location ID not available for current conditions');
             return null;
        }
        let currentURL = `${this.baseURL}observation/${this.locationID}`;
        try {
            // Use the new async helper
            let weatherData = await this._getWeatherAsync(currentURL);

            if (weatherData) {
                const json = JSON.parse(weatherData);
                // Basic check for expected structure
                if (!json.observations || json.observations.length === 0) {
                    this.data.status.cc = SERVICE_STATUS_ERROR;
                    this.data.status.lasterror = _('Invalid current conditions response');
                    return null;
                }
                this.data.status.cc = SERVICE_STATUS_OK;
                return json;
            } else {
                 // This else block might be redundant if _getWeatherAsync rejects on failure
                this.data.status.cc = SERVICE_STATUS_ERROR;
                this.data.status.lasterror = _('Failed to retrieve current conditions data');
                return null;
            }
        } catch (error) {
            global.logError(`BBC Driver _getAPIcurrent error: ${error.message}`);
            this.data.status.cc = SERVICE_STATUS_ERROR;
            // Use the error message from the rejected promise if available, otherwise a generic one
            this.data.status.lasterror = _('Error retrieving or parsing current conditions data: %s').format(error.message);
            return null;
        }
    }

    async _getAPIforecasts() {
         if (!this.locationID) {
             this.data.status.forecast = SERVICE_STATUS_ERROR;
             this.data.status.lasterror = _('Location ID not available for forecast');
             return null;
         }
        let daysURL = `${this.baseURL}forecast/aggregated/${this.locationID}`;
        try {
            // Use the new async helper
            let weatherData = await this._getWeatherAsync(daysURL);

            if (weatherData) {
                const json = JSON.parse(weatherData);
                // Basic check for expected structure
                if (!json.forecasts || json.forecasts.length === 0) {
                    this.data.status.forecast = SERVICE_STATUS_ERROR;
                    this.data.status.lasterror = _('Invalid forecast response');
                    return null;
                }
                this.data.status.forecast = SERVICE_STATUS_OK;
                return json;
            } else {
                 // This else block might be redundant if _getWeatherAsync rejects on failure
                this.data.status.forecast = SERVICE_STATUS_ERROR;
                this.data.status.lasterror = _('Failed to retrieve forecast data');
                return null;
            }
        } catch (error) {
            global.logError(`BBC Driver _getAPIforecasts error: ${error.message}`);
            this.data.status.forecast = SERVICE_STATUS_ERROR;
            // Use the error message from the rejected promise if available, otherwise a generic one
            this.data.status.lasterror = _('Error retrieving or parsing forecast data: %s').format(error.message);
            return null;
        }
    }

    async _loadDataLocation(jsonlc) {
        // Request location ID data from the server
        // Check for expected fields in json.response.results.results[0]
        if (!jsonlc || !jsonlc.response || !jsonlc.response.results || !jsonlc.response.results.results || jsonlc.response.results.results.length === 0) {
            this.data.status.meta = SERVICE_STATUS_ERROR;
            this.data.status.lasterror = _('Invalid lat,lon location data structure');
            return false;
        }
        let location = jsonlc.response.results.results[0];
        // Add checks for existence before assigning
        this.locationID = location?.id ?? '';
        // Check if critical data is missing after assignment
        if (!this.locationID){
                this.data.status.meta = SERVICE_STATUS_ERROR;
                this.data.status.lasterror = _('Missing critical fields in lat,lon location data');
                return false;
        }
        global.log('LocationID = '+ this.locationID)
        this.data.status.meta = SERVICE_STATUS_OK;
        return true;
    }

    _loadMetaCoordinates(jsonlc) {
        // Request location ID data from the server
        // Check for expected fields in json.response.results.results[0]
        if (!jsonlc || !jsonlc.response || !jsonlc.response.results || !jsonlc.response.results.results || jsonlc.response.results.results.length === 0) {
            this.data.status.meta = SERVICE_STATUS_ERROR;
            this.data.status.lasterror = _('Invalid lat,lon location data structure');
            return false;
        }
        let location = jsonlc.response.results.results[0];
        // Add checks for existence before assigning
        this.data.city = location?.name ?? '';
        this.data.country = location?.country ?? '';
        this.data.wgs84 = {
            lat: location?.latitude ?? '',
            lon: location?.longitude ?? ''
        };
        // Check if critical data is missing after assignment
        if (!this.data.city || !this.data.country) {
                this.data.status.meta = SERVICE_STATUS_ERROR;
                this.data.status.lasterror = _('Missing critical fields in lat,lon location data');
                return false;
        }
        this.data.status.meta = SERVICE_STATUS_OK;
        return true;
    }

    _loadMetaFromID(jsonlc) {
         // Check for expected fields in jsonlc.response
         if (!jsonlc || !jsonlc.response) {
             this.data.status.meta = SERVICE_STATUS_ERROR;
             this.data.status.lasterror = _('Invalid ID location data structure');
             return false;
         }
         let ID = jsonlc.response;
         // Add checks for existence before assigning
         this.data.city = ID?.name ?? '';
         this.data.country = ID?.country ?? '';
         this.data.wgs84 = {
             lat: ID?.latitude ?? '',
             lon: ID?.longitude ?? ''
         }
         // Check if critical data is missing after assignment
         if (!this.data.city || !this.data.country) {
             this.data.status.meta = SERVICE_STATUS_ERROR;
             this.data.status.lasterror = _('Missing critical fields in ID location data');
             return false;
         }
         this.data.status.meta = SERVICE_STATUS_OK;
         return true;
    }


    async _loadData(jsonlc, jsoncc, jsonfc, deskletObj) {
        // Load meta data (already partially done in _loadDataLocation or _loadMetaFromID,
        // but ensure status is set if jsonlc was null)
        if (!jsonlc) {
             this.data.status.meta = SERVICE_STATUS_ERROR;
             if (!this.data.status.lasterror) this.data.status.lasterror = _('No location metadata available');
        } else if (this.data.status.meta === SERVICE_STATUS_INIT) {
             // This case should ideally not happen if _getAPImetadata and _loadDataLocation/ _loadMetaFromID work correctly,
             // but as a fallback, try to load meta data here if status is still INIT.
             if (this.latlon) {
                 this._loadMetaCoordinates(jsonlc); // Re-attempt loading location data
             } else {
                 this._loadMetaFromID(jsonlc); // Re-attempt loading meta data from ID
             }
        }

        // request current data
        if (!jsoncc || !jsoncc.observations || jsoncc.observations.length === 0) {
            this.data.status.cc = SERVICE_STATUS_ERROR;
            if (!this.data.status.lasterror) this.data.status.lasterror = _('Invalid current conditions data');
        } else {
            try {
                let obs = jsoncc.observations[0];
                if (obs) {
                    // Use nullish coalescing operator to safely assign values
                    this.data.cc.temperature = obs.temperature?.C ?? '';
                    this.data.cc.wind_speed = obs.wind?.windSpeedKph ?? '';
                    this.data.cc.wind_direction = obs.wind?.windDirectionAbbreviation ?? '';
                    this.data.cc.humidity = obs.humidityPercent ?? '';
                    this.data.cc.pressure = obs.pressureMb ?? '';
                    this.data.cc.pressure_direction = _(obs.pressureDirection) ?? '';
                    this.data.cc.visibility = _(obs.visibility) ?? '';
                    this.data.cc.has_temp = (typeof this.data.cc.temperature !== 'undefined' && this.data.cc.temperature !== ''); // Set has_temp

                // Check jsonfc for additional current data if jsoncc was missing some fields
                    if (jsonfc && jsonfc.forecasts && jsonfc.forecasts.length > 0 && jsonfc.forecasts[0].detailed && jsonfc.forecasts[0].detailed.reports && jsonfc.forecasts[0].detailed.reports.length > 0) {
                        let obsF = jsonfc.forecasts[0].detailed.reports[0];
                        if (obsF) {
                            // Use nullish coalescing operator to safely assign values
                            if (typeof this.data.cc.feelslike === 'undefined' || this.data.cc.feelslike === '') {
                                this.data.cc.feelslike = obsF.feelsLikeTemperatureC ?? '';
                            }
                            if (typeof this.data.cc.weathertext === 'undefined' || this.data.cc.weathertext === '') {
                                this.data.cc.weathertext = this._descriptionMap(_(obsF.weatherTypeText));
                            }
                            // Only update icon if jsoncc didn't provide one or if jsonfc provides a better one
                            if (typeof this.data.cc.icon === 'undefined' || this.data.cc.icon === '') {
                                const isNight = (typeof jsonfc.isNight !== 'undefined') ? jsonfc.isNight : false;
                                this.data.cc.icon = this._mapIcon(String(obsF.weatherType ?? ''), isNight); // Also check weatherType
                            }
                            if (typeof this.data.cc.pressure === 'undefined' || this.data.cc.pressure === null || this.data.cc.pressure === '') {
                                this.data.cc.pressure = obsF.pressure ?? '';
                            }
                            if (typeof this.data.cc.visibility === 'undefined' || this.data.cc.visibility === null || this.data.cc.visibility === '') {
                                this.data.cc.visibility = obsF.visibility ?? '';
                            }
                            if (typeof this.data.cc.humidity === 'undefined' || this.data.cc.humidity === null || this.data.cc.humidity === '') {
                                this.data.cc.humidity = obsF.humidity ?? '';
                            }
                            if (!this.data.cc.pressure_direction === 'undefined' || this.data.cc.pressure_direction === null ||this.data.cc.pressure_direction === '') {
                                this.data.cc.pressure_direction = _(obsF.pressureDirection) ?? '';
                            }
                        }
                    }
                }

                // If we got here, current data was processed, even if partially from jsonfc
                this.data.status.cc = SERVICE_STATUS_OK;

            } catch (e) {
                global.logError(`BBC Driver _loadData current conditions error: ${e}`);
                this.data.status.cc = SERVICE_STATUS_ERROR;
                this.data.status.lasterror = _('Error processing current conditions data: %s').format(e.message);
            };
        }


        // request forecast data
        if (!jsonfc || !jsonfc.forecasts || jsonfc.forecasts.length === 0) {
            this.data.status.forecast = SERVICE_STATUS_ERROR;
            if (!this.data.status.lasterror) this.data.status.lasterror = _('Invalid forecast data');
        } else {
            try {
                this.data.days = [];
                const isNight = (typeof jsonfc.isNight !== 'undefined') ? jsonfc.isNight : false;

                for (let i = 0; i < Math.min(this.maxDays, jsonfc.forecasts.length); i++) {
                    let day = new Object();
                    // Use _getDayName with the index for day name
                    day.day = this._getDayName(i);

                    // Extract detailed reports and summary report
                    let forecastDay = jsonfc.forecasts[i];

                    // Add checks for forecastDay and its properties
                    if (!forecastDay) {
                         global.logWarning(`BBC Driver _loadData: forecastDay is undefined for index ${i}`);
                         continue; // Skip this day if forecastDay is undefined
                    }

                    let detailedReports = (forecastDay.detailed && forecastDay.detailed.reports && Array.isArray(forecastDay.detailed.reports)) ? forecastDay.detailed.reports : [];
                    let summaryReport = (forecastDay.summary && forecastDay.summary.report) ? forecastDay.summary.report : null;

                    // Populate day object from summary report if available
                    if (summaryReport) {
                        // Use nullish coalescing operator to safely assign values
                        day.maximum_temperature = summaryReport.maxTempC ?? '';
                        day.minimum_temperature = summaryReport.minTempC ?? '';
                        day.weathertext = this._descriptionMap(summaryReport.weatherTypeText ?? '');
                        day.wind_direction = summaryReport.windDirection ?? '';
                        day.wind_speed = summaryReport.windSpeedKph ?? '';
                        if (i === 0) {
                            // For day 0, use isNight condition
                            day.icon = this._mapIcon(String(summaryReport.weatherType ?? ''), isNight); // Also check weatherType
                        } else {
                            // For days 1 to 7, do not use isNight condition
                            day.icon = this._mapIcon(String(summaryReport.weatherType ?? ''), false); // Also check weatherType
                        }
                    } else {
                        // Ensure properties exist even if summaryReport is null
                        day.maximum_temperature = '';
                        day.minimum_temperature = '';
                        day.weathertext = '';
                        day.wind_direction = '';
                        day.wind_speed = '';
                        day.icon = '';
                        global.logWarning(`BBC Driver _loadData: summaryReport is null for day ${i}`);
                    }

                    // Populate humidity and pressure from first detailed report if available
                    if (detailedReports.length > 0) {
                         let firstDetailedReport = detailedReports[0];
                         if (firstDetailedReport) {
                             // Use nullish coalescing operator to safely assign values
                             day.humidity = firstDetailedReport.humidity ?? '';
                             day.pressure = firstDetailedReport.pressure ?? '';
                         } else {
                             day.humidity = '';
                             day.pressure = '';
                             global.logWarning(`BBC Driver _loadData: firstDetailedReport is null for day ${i}`);
                         }
                    } else {
                        day.humidity = '';
                        day.pressure = '';
                         global.logWarning(`BBC Driver _loadData: detailedReports is empty or not array for day ${i}`);
                    }

                    this.data.days.push(day);
                }
                this.data.status.forecast = SERVICE_STATUS_OK;
                // If forecast data was OK, and current data failed, update cc status here
                if (this.data.status.cc === SERVICE_STATUS_INIT) {
                     this.data.status.cc = SERVICE_STATUS_ERROR;
                     if (!this.data.status.lasterror) this.data.status.lasterror = _('Current conditions data not available');
                }

            } catch (e) {
                global.logError(`BBC Driver _loadData forecast error: ${e}`);
                this.data.status.forecast = SERVICE_STATUS_ERROR;
                if (!this.data.status.lasterror) this.data.status.lasterror = _('Error processing forecast data: %s').format(e.message);
            }
        }

        // If any status is still INIT, set it to ERROR (shouldn't happen with checks above, but as a safeguard)
        if (this.data.status.meta === SERVICE_STATUS_INIT) this.data.status.meta = SERVICE_STATUS_ERROR;
        if (this.data.status.cc === SERVICE_STATUS_INIT) this.data.status.cc = SERVICE_STATUS_ERROR;
        if (this.data.status.forecast === SERVICE_STATUS_INIT) this.data.status.forecast = SERVICE_STATUS_ERROR;

        // If any status is ERROR and no specific error message was set, provide a generic one
        if ((this.data.status.meta === SERVICE_STATUS_ERROR || this.data.status.cc === SERVICE_STATUS_ERROR || this.data.status.forecast === SERVICE_STATUS_ERROR) && !this.data.status.lasterror) {
             this.data.status.lasterror = _('Failed to retrieve all weather data');
        }

        // If any status is ERROR, call _showError from here
        if (this.data.status.meta === SERVICE_STATUS_ERROR || this.data.status.cc === SERVICE_STATUS_ERROR || this.data.status.forecast === SERVICE_STATUS_ERROR) {
             this._showError(deskletObj, this.data.status.lasterror);
        }
    }

    _mapIcon(icon, isNight) {
        // Map weatherTypeText strings to icon codes based on bbc_icons.txt and icons.html
        const iconMap = {
        '1': '32',  // Sunny
        '2': '30',  // Partly Cloudy
        '3': '30',  // Sunny Intervals
        '4': '23',  // Sandstorm
        '5': '20',  // Mist
        '6': '20',  // Fog
        '7': '26',  // Light Cloud
        '8': '26d', // Thick Cloud
        '10': '11', // Light Rain Showers (day)
        '11': '09', // Drizzle
        '12': '11', // Light Rain
        '14': '12', // Heavy Rain Showers (day)
        '15': '12', // Heavy Rain
        '17': '18', // Sleet Showers (day)
        '18': '18', // Sleet
        '20': '18', // Hail Showers (day)
        '21': '18', // Hail
        '23': '13', // Light Snow Showers (day)
        '24': '13', // Light Snow
        '26': '16', // Heavy Snow Showers (day)
        '27': '16', // Heavy Snow
        '29': '04', // Thundery Showers (day)
        '30': '04', // Thunderstorms
        '31': '01', // Tropical storm
        '32': '20', // Hazy
        '33': '15', // Blowing Snow
        '34': '08', // Freezing Drizzle
        '35': '23', // Sandstorm
        '36': '26', // Light Cloud
        //'37': '16',  //Heavy Snow Showers (???)
        //'38': '', // (???)
        '39': '11'   // Light Rain
        };

        const nightIconMap = {
        '0': '31',  // Clear Sky
        '1': '31',  // Sunny
        '2': '29',  // Partly Cloudy
        '3': '29',  // Sunny Intervals
        '9': '11',  // Light Rain Showers (night)
        '13': '12', // Heavy Rain showers (night)
        '16': '18', // Sleet Showers (night)
        '19': '18', // Hail Showers (night)
        '22': '46', // Light Snow Showers (night)
        '25': '16', // Heavy Snow Showers (night)
        '28': '04'  // Thundery Showers (night)
        };

        let iconCode = 'na';
        const iconKey = icon ? icon.toString() : '';

        if (icon && (typeof iconMap[icon] !== 'undefined')) {
        iconCode = iconMap[icon];
        }

        if (isNight && (typeof nightIconMap[icon] !== 'undefined')) {
        iconCode = nightIconMap[icon];
        }
        return iconCode;
    }

    _descriptionMap(text) {
        const description = {
        'Sandstorm'         : _('Sand Storm'),
        'Light Rain Showers': _('Light Rain Shower'),
        'Heavy Rain Showers': _('Heavy Rain Shower'),
        'Sleet Showers'     : _('Sleet Shower'),
        'Hail Showers'      : _('Hail Shower'),
        'Thundery Showers'  : _('Thundery Shower')
        };
        if (!text) return '';
        // Use the local 'description' object instead of the argument 'descriptionMap'
        if (description.hasOwnProperty(text)) {
            return description[text];
        }
        return text;
    }
};
