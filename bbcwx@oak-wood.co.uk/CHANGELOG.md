
### 3.2

* Update National Weather Service (NWS) to remove Humidity as it is no longer
  available as a property

### 3.1

* Change Weather Underground to its proper name
* Update README with weather station requirement for Weather Underground

### 3.0.9

* Update Wunderground driver

### 3.0.8

* Update README

### 3.0.7

* Update Wunderground driver

### 3.0.6

* Update Wunderground driver

### 3.0.5

* Update Wunderground driver

### 3.0.4

* Update Wunderground driver

### 3.0.3

* Update Wunderground driver to always include language parameter

### 3.0.2

* Remove trailing ampersand from API calls

### 3.0.1

* Update Wunderground driver
  * Fix import for SERVICE_STATUS_ERROR
  * Reorder params

### 3.0

* Refactor code
  * Drivers are now in individual files for easier development
* Add a 'Last Updated' timestamp above the service attribution
* Update location and API key settings to be per service
* Add a setting for displaying the region where supported
* Fix meteoblue API
* Add National Weather Service API (USA only)
* Add Open-Meteo Non-Commercial API
* Add Weather API (Free) API
* Update APIXU to weatherstack API
* Update Weather Underground API
* Remove deprecated World Weather Online (Free) API
* Remove deprecated forecast.io (Dark Sky) API
* Remove deprecated weather.com API
* Create CHANGELOG
* Update README
* Update translation template and existing translations

### 2.11

* Fix ES6 error in marknote.js
* Use calls safe for 5.4 in desklets.js
  * Replace unsafe calls for safer calls in 5.4+ (this removes the warning in
    the Desklets application UI)
    * From Util.spwanCommandLine to Gio.Subprocess
    * From Cinnamon.get_file_contents_utf8_sync to GLib.file_get_contents
* Use `var` for ES6 compatibility (removes the warnings in the logs)
* Move existing code to the directory 3.0 for backward compatibility purposes
* Whitespace cleanup within the 5.4 directory
* Remove unused import in desklet.js

### 2.10

* Add World Weather Online Premium API
* Add APIXU driver
