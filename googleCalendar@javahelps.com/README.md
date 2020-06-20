# Google Calendar Desklet

View your upcoming calendar events on your Cinnamon Desktop. This desklet uses `gcalendar` to pull events from Google Calendar. You can configure every aspect of the desklet using the configure dialog.

## Requirements

- Cinnamon 3.4, 3.6, 3.8, 4.0, 4.2, 4.4, or 4.6
- `gcalendar`

## Installation

1. Install `gcalendar`:

    [gcalendar](https://github.com/slgobinath/gcalendar) is a Free and Open Source Software developed by the same developer to read Google Calendar events from the terminal.

    **Linux Mint:**

    ```bash
    sudo add-apt-repository ppa:slgobinath/gcalendar
    sudo apt update
    sudo apt install gcalendar
    ```

    **Arch:**

    ```bash
    yay -S gcalendar
    ```

    OR

    ```bash
    packer -S gcalendar
    ```

    **Disclaimer:** [ppa:slgobinath/gcalendar](https://launchpad.net/~slgobinath/+archive/ubuntu/gcalendar) and [AUR gcalendar](https://aur.archlinux.org/packages/gcalendar) are my (the developer of this desklet) own repositories that are not monitored by the Linux Mint team, and user installs it at their own discretion.

    I am providing the PPA and AUR to make the installation process simple. However, if you have any concerns with adding a PPA or installing from AUR, you can also install `gcalendar` from [PyPi](https://pypi.org/project/gcalendar/) or from the source code.

    **Install From PyPi:**

    ```bash
    sudo apt install python3-pip python3-setuptools python3-dateutil python3-oauth2client python3-googleapi
    pip3 install gcalendar
    ```

    **Install From Source:**

    ```bash
    sudo apt install python3-pip python3-setuptools python3-dateutil python3-oauth2client python3-googleapi git
    git clone https://github.com/slgobinath/gcalendar.git
    cd gcalendar
    pip3 install -e .
    ```

    For more information, please visit the `gcalendar` [GitHub Repository](https://github.com/slgobinath/gcalendar).

2. Authorize `gcalendar` to read your calendar.

    Just run `gcalendar` from the terminal. It will open Google Calendar OAuth page in your default browser.

    ```bash
    gcalendar
    ```

    For more details, see this YouTube video: [gcalendar Authorization](https://www.youtube.com/watch?v=mwU8AQmzIPE&feature). After authorizing gcalendar, you should see your calendar events printed in the terminal.

3. Download and add this desklet.

4. If there is a warning sign in the "Desklets" dialog, try to remove and add the desklet again. If it doesn't work, a system restart may help the desklet to detect `gcalendar`.

## Features

- Select events from multiple calendars of the same Google account
- Custom date range
- Customize update frequency
- Manually update the agenda by clicking on the desklet
- Customize the look and feel
- Multiple account support (Using `gcalendar --account`)

## FAQ

1. **How to manually refresh the desklet?**

    Just click on the desklet. It will retrieve fresh events from Google Calendar.

2. **What does "No events found..." mean?**

    It means you do not have any events in the selected time interval. By default, the desklet retrieves events for the next `7` days. You can modify it by adjusting the "Number of days to include (days)" property in the configuration dialog.
    If that doesn't work, please ensure that you have some events in your Google Calendar by visiting the official [website](https://calendar.google.com/calendar).

3. **What does "Unable to retrieve events..." mean?**

    It means the desklet could not retrieve any events and there is a possible error. Please report the bug with the output of `gcalendar` command at [gcalendar issues](https://github.com/slgobinath/gcalendar/issues).

4. **How to report bugs?**

    Please open a GitHub issue at [linuxmint/cinnamon-spices-desklets](https://github.com/linuxmint/cinnamon-spices-desklets/issues) if the desklet doesn't work as expected. Any gcalendar specific bugs must be reported at [gcalendar issues](https://github.com/slgobinath/gcalendar/issues).

5. **Can I use my own client id and client secrets?**

    You can use your own credentials but use them with `gcalendar --client-id xxx --client-secret yyy` to authorize before using them in the desklet.

6. **I love this desklet/gcalendar and want to appreciate it. How can I express it?**

    It is a great pleasure to see someone likes your work. Though I am the [core developer](https://github.com/slgobinath), there are other contributors contributing to this desklet by fixing bugs and translating it into other languages. If you like the desklet, please show it to the world by login to the [CINNAMON spices](https://cinnamon-spices.linuxmint.com/) website and clicking the <kbd>Like it</kbd> button. I also appreciate it, if you can [buy me a coffee](https://paypal.me/slgobinath)!

## Privacy Policy

**None of your data is collected, stored, processed or shared with the developer or any third-parties.** For more information, please check the detailed [privacy policy](https://www.javahelps.com/p/gcalendar.html#privacy-policy).
