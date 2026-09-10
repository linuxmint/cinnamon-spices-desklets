### 1.4.0
* Read the GPU temperature from the GPU. The default sensor path for both CPU and
  GPU was thermal_zone0, a motherboard sensor, so the GPU row duplicated the CPU
  row on every install. NVIDIA cards are read via nvidia-smi, AMD and Intel via
  their hwmon entries.
* Detect the CPU sensor rather than defaulting to thermal_zone0, preferring the
  on-die sensor (coretemp/k10temp package temperature).
* Fix CPU usage calculation. It counted iowait as busy time and omitted nice, irq
  and softirq, so a slow disk read as CPU load while real work went uncounted.
* Count network traffic on physical interfaces only. Loopback, VPN and Tailscale
  interfaces were included, so traffic through a VPN was counted twice, once on
  the tunnel and again on the hardware carrying it.
* Fix network rate units. Bytes were divided by milliseconds and labelled KB, and
  the per-second part was missing from the label.
* Add a refresh interval setting, defaulting to the previous 1 second.
* Only build the settings object once. It was rebuilt on every settings change,
  leaving the previous bindings live and doubling the work each time.


### 1.3.1
* Update default scale value to 2
* Update translation files

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
