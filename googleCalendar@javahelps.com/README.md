# Google Calendar Desklet
Google Calendar Desklet displays your agenda based on your Google Calendar in Cinnamon desktop.

You can configure the every aspect of the desklet using the configure dialog in terms of selecting calendars and configuring the look and feel. However, the agenda is displayed using text so there can be any minor issues with alignments.

For the moment, the desklet has not been tested with different displays or aspect ratios so there can be issues with scaling.

## Requirements
 - `gcalcli`

## Installation
  1. Install `gcalcli` using the following command:
  ```
  sudo apt install gcalcli
  ```

  2. Launch `gcalcli` with a parameter listfrom terminal and configure the user account
  ```
  gcalcli list
  ```
  Once you have execute the above command, `gcalcli` will open a web page and ask you to provide the permission to access your Google Calendar.

  3. Add the Google Calendar desklet and enjoy!!!

## Features
- Select events from multiple calendars of the same Google account
- Custom date range
- Customize update frequency
- Manually update the agenda by clicking on the desklet
- Customize the look and feel

The Cinnamon Desklet does not render the markup styles properly. Visting [GitHub](https://github.com/linuxmint/cinnamon-spices-desklets/tree/master/googleCalendar%40javahelps.com) will show the commands more clearly using different fonts.