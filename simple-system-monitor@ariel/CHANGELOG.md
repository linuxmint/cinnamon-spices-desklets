
### 1.3.0
* Remove potential ellipsis in titles and values
* Fix missing import

### 1.2.0
* Add options to minimize the need for manual file updates:
  * Title/value alignment
  * Temperature units
  * Font size
  * Font color
  * Font family
  * Desklet fixed width
  * Background transparency/color
  * Custom path(s) to CPU/GPU sensor files
  * Display GPU

### 1.1.0
* Add GPU Temperature
* Adjust layout
  * Titles: from right to left
  * Values: from left to right
* Adjust value format to avoid wobbling
  * "CPU" and "Memory" are now fixed to 2 decimal point digits
  * "Download" and "Upload" are now fixed to 1 decimal point 1 digit if the unit is "MB"

### 1.0.0
* Initial release
* Institute changelog - currently only in desklet.js
* Changes for Cinnamon 4.0 and higher to avoid segfaults when old Network Manager Library is no longer available by using multiversion with folder 4.0
  * Comment out or delete all references to NetworkManager
  * Replace calls to NetworkManager with equivalent calls to NM
  * Change logError messages to not reference NetworkManager  
