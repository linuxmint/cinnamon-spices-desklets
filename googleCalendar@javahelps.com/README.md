# Google Calendar Desklet

View your upcoming calendar events on your Cinnamon Desktop. This desklet uses `google-api-python-client` to pull events from Google Calendar. You can configure every aspect of the desklet using the configure dialog.

## Requirements

- Cinnamon 3.4, 3.6 or 3.8
- Python 3
- python3-pip
- python3-setuptools
- `python-dateutil`
- `google-api-python-client`
- `oauth2client`

## Installation

1. Install `pip` and `setuptools` for Python 3 using the following command:
    ```bash
    sudo apt install python3-pip python3-setuptools
    ```

2. Install `python-dateutil`, `google-api-python-client` and `oauth2client` Python modules using the following command:
    ```bash
    sudo pip3 install --upgrade python-dateutil google-api-python-client oauth2client
    ```
    If you encounter any problems, please check the [official website](https://developers.google.com/api-client-library/python/start/installation).

3. Add Google Calendar desklet

4. You should get a Google Authentication page asking for read permission. Allow the "Cinnamon Google Calendar Desklet" to read your Google Calendar events.

5. If there is a warning sign in the "Desklets" dialog, try to remove and add the desklet. If it doesn't work, a system restart may help the desklet to detect `google-api-python-client`.

## Features

- Select events from multiple calendars of the same Google account
- Custom date range
- Customize update frequency
- Manually update the agenda by clicking on the desklet
- Customize the look and feel

## FAQ

1. **How to show events only from a selected list of calendars?**

    Open your terminal and change the directory to the desklet location.
    ```shell
    cd ~/.local/share/cinnamon/desklets/googleCalendar@javahelps.com/py
    ```

    Execute the following command to see the available calendars:
    ```shell
    python3 google_calendar.py --list-calendars
    ```
    For example, I have the following caledars:
    ```text
    Friends' Birthdays
    Contacts
    Holidays in Canada
    Holidays in Sri Lanka
    ```
    Add interesting calendars, separated by comma to the "Calendar name(s)" property in the desklet configuration dialog. For example, if you want to see events only from "Friends' Birthdays" and "Holidays in Canada" your input should look like this:
    ```text
    Friends' Birthdays, Holidays in Canada
    ```

2. **How to report bugs?**

    Please open a GitHub issue at [linuxmint/cinnamon-spices-desklets](https://github.com/linuxmint/cinnamon-spices-desklets/issues). Please include the Python 3 version (`python3 -V`) of your system in addition to the details required in the issue template.