
### 3.0.8

* Updated README

### 3.0.7

* Updated Wunderground driver

### 3.0.6

* Updated Wunderground driver

### 3.0.5

* Updated Wunderground driver

### 3.0.4

* Updated Wunderground driver

### 3.0.3

* Updated Wunderground driver to always include language parameter

### 3.0.2

* Removed trailing ampersand from API calls

### 3.0.1

* Updated Wunderground driver
  * Fixed import for SERVICE_STATUS_ERROR
  * Reordered params

### 3.0

* Refactored code
  * Drivers are now in individual files for easier development
* Added a last updated timestamp above the service attribution
* Updated location and API key settings to be per service
* Added a setting for displaying the region where supported
* Fixed meteoblue API
* Added National Weather Service API (USA only)
* Added Open-Meteo Non-Commercial API
* Added Weather API (Free) API
* Updated APIXU to weatherstack API
* Updated Weather Underground API
* Removed deprecated World Weather Online (Free) API
* Removed deprecated forecast.io (Dark Sky) API
* Removed deprecated weather.com API
* Created CHANGELOG
* Updated README
* Updated translation template and existing translations

### 2.11

* Fixed ES6 error in marknote.js
* Used calls safe for 5.4 in desklets.js
  * Replaced unsafe calls for safer calls in 5.4+ (this removes the warning in
    the Desklets application UI)
    * From Util.spwanCommandLine to Gio.Subprocess
    * From Cinnamon.get_file_contents_utf8_sync to GLib.file_get_contents
* Used var for ES6 compatibility (removes the warnings in the logs)
* Moved existing code to the directory 3.0 for backward compatibility purposes
* Whitespace cleaned up within the 5.4 directory
* Removed unused import in desklet.js

### 2.10

* Added World Weather Online Premium API
* Added APIXU driver
