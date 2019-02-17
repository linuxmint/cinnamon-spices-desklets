# Google Calendar Desklet

View your upcoming calendar events on your Cinnamon Desktop. This desklet uses `google-api-python-client` to pull events from Google Calendar. You can configure every aspect of the desklet using the configure dialog.

## Requirements

- Cinnamon 3.4, 3.6, 3.8 or 4.0
- Python 3
- python3-pip
- python3-setuptools
- `python-dateutil`
- `google-api-python-client`
- `oauth2client`

## Installation

1. Install dependencies using the following command:
    ```bash
    sudo apt install python3-pip python3-setuptools python3-dateutil python3-oauth2client python3-googleapi
    ```

2. Install `python-dateutil`, `google-api-python-client` and `oauth2client` Python modules using the following command:
    ```bash
    sudo pip3 install --upgrade python-dateutil google-api-python-client oauth2client
    ```
    If you encounter any problems, please check the [official website](https://developers.google.com/api-client-library/python/start/installation).

3. Add Google Calendar desklet

4. You should get a Google Authentication page asking for reading permission. Allow the "Cinnamon Google Calendar Desklet" to read your Google Calendar events.

5. If there is a warning sign in the "Desklets" dialog, try to remove and add the desklet again. If it doesn't work, a system restart may help the desklet to detect `google-api-python-client`.

## Features

- Select events from multiple calendars of the same Google account
- Custom date range
- Customize update frequency
- Manually update the agenda by clicking on the desklet
- Customize the look and feel

## FAQ

1. **I want to manually update the desklet now. How can I do that?**

    Just click on the desklet. It will retrieve fresh events from Google Calendar.

2. **How to show events only from a selected list of calendars?**

    Execute the following command to see the available calendars:
    ```shell
    python3 ~/.local/share/cinnamon/desklets/googleCalendar@javahelps.com/py/google_calendar.py --list-calendars
    ```
    For example, I have the following calendars:
    ```text
    Friends' Birthdays
    Contacts
    Holidays in Canada
    Holidays in Sri Lanka
    ```
    Add interesting calendars, separated by a comma to the "Calendar name(s)" property in the desklet configuration dialog. For example, if you want to see events only from "Friends' Birthdays" and "Holidays in Canada" your input should look like this:
    ```text
    Friends' Birthdays, Holidays in Canada
    ```

    **NOTE:** Leaving the "Calendar name(s)" empty means you want to retrieve events from all calendars.

3. **My desklet shows "No events found...". What does it mean?**

    It means you do not have any events in the selected time interval. By default, the desklet retrieves events for the next `7` days. You can modify it by adjusting the "Number of days to include (days)" property in the configuration dialog.
    If that doesn't work, please ensure that you have some events in your Google Calendar by visiting the official [website](https://calendar.google.com/calendar).

    If there are events between the selected time period, something wrong with the desklet. Please report the bug with the output of `google_calendar.py` script. More details on how to report a bug are given below.

4. **My desklet shows "Unable to retrieve events...". What does it mean?**

    It means the desklet could not retrieve any events and there is a possible error. Please report the bug with the output of `google_calendar.py` script. More details on how to report a bug are given below.

5. **How to report bugs?**

    Please open a GitHub issue at [linuxmint/cinnamon-spices-desklets](https://github.com/linuxmint/cinnamon-spices-desklets/issues). Please include the Python 3 version (`python3 -V`) of your system in addition to the details required in the issue template.
    Reporting the output of the following command also helpful to trace the problem. However, please replace any personal information printed in the console by some random characters.
    ```shell
    python3 ~/.local/share/cinnamon/desklets/googleCalendar@javahelps.com/py/google_calendar.py
    ```

6. **I have encountered the following issue with `sudo pip3 install --upgrade python-dateutil google-api-python-client oauth2client` command. How can I fix it?**
    ```shell
    Traceback (most recent call last):
    File "/usr/bin/pip3", line 9, in <module>
        from pip import main
    ImportError: cannot import name 'main'
    ```

    It is a problem with your existing pip command. Please reinstall it using the following command:
    ```shell
    sudo python3 -m pip uninstall pip && sudo apt install python3-pip --reinstall
    ```

7. **How can I switch my Google Account to a new one?**

    Enter the following command in a terminal and just click on the desklet.
    ```shell
    rm ~/.cinnamon/configs/googleCalendar@javahelps.com/calendar.dat
    ```

8. **I love this desklet and want to appreciate it. How can I express it?**

    It is a great pleasure to see someone likes your work. Though I am the [core developer](https://github.com/slgobinath), there are other contributors contributing to this desklet by fixing bugs and translating it into other languages. If you like the desklet, please show it to the world by login to the [CINNAMON spices](https://cinnamon-spices.linuxmint.com/) website and clicking the <kbd>Like it</kbd> button. I also appreciate it, if you can [buy me a coffee](https://paypal.me/slgobinath)!