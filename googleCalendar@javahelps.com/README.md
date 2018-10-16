# Google Calendar Desklet

View your upcoming calendar events on your Cinnamon Desktop. This desklet uses `google-api-python-client` to pull events from Google Calendar. You can configure every aspect of the desklet using the configure dialog.

## Requirements

- Cinnamon 3.4, 3.6 or 3.8
- Python 3
- Pip 3
- `google-api-python-client`

## Installation

1. Install `pip` for Python 3 using the following command:
    ```bash
    sudo apt install python3-pip
    ```

2. Install `google-api-python-client` Python module using the following command:
    ```bash
    sudo pip3 install --upgrade google-api-python-client oauth2client
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
