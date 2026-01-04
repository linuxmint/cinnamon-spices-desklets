# Server Status

The Server Status Monitor is a desklet for the Cinnamon desktop environment, designed for real-time monitoring of your server statuses. It provides a quick way to check the availability and operational health of remote hosts using various verification methods.

__Key Features:__

* __Flexible Server Configuration:__ Add, edit, and remove servers from the monitoring list directly through the desklet's settings.

* __Multiple Check Types Supported:__ The desklet can monitor servers using three primary protocols:

  * __Ping:__ Checks basic network reachability of the server.

  * __HTTP/HTTPS:__ Monitors the availability of web servers and web resources.

* __Customizable Update Interval:__ Set your own interval (in seconds) for periodic server status checks.

* __Real-time Status Display:__ Each server is shown on a separate line, indicating its name and current status (OK, WARN, ERR, Checking, Timeout).

* __Customizable Appearance:__

  * __Color Schemes:__ Adjust text colors for different statuses (basic, OK, warning, error), as well as background colors for the desklet container and individual server elements.

  * __Server Visibility:__ Temporarily disable the display of specific servers within the desklet without removing them from the settings list.

* __Timeout Limits:__ Ping, HTTP/S checks include built-in timeout limits (5 seconds by default), preventing the desklet from freezing due to unresponsive servers.

* __Localization:__ The desklet supports multiple languages, ensuring ease of use for users with different linguistic preferences.

The Server Status Monitor is ideal for developers, system administrators, or anyone who needs a quick and convenient way to track the status of essential network resources directly from their Cinnamon desktop.

## Requirements

- Cinnamon 6.4
- ping
- curl

## Privacy Policy

**None of your data is collected, stored, processed or shared with the developer or any third-parties.**
