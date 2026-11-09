# Google Calendar Desklet

View your upcoming calendar events on your Cinnamon Desktop. You can configure every aspect of the desklet using the configure dialog.

Everything the desklet needs to talk to Google Calendar ships with it — there is nothing to download or install from outside the Spices repository.

## Requirements

- Cinnamon 3.4, 3.6, 3.8, 4.0, 4.2, 4.4, or 4.6
- Python 3, which is already installed on Linux Mint
- Four Python libraries from your distribution's own repositories: `python3-googleapi`, `python3-oauth2client`, `python3-httplib2` and `python3-dateutil`

The desklet checks for those libraries when it starts and offers to install any that are missing, using your system's package manager. You will be asked for your password, as with any other software installation.

**Supported releases:** Linux Mint 21 and 22, LMDE 6, and other distributions that still package `python3-oauth2client`.

`python3-oauth2client` was removed from Debian in 2024 and is not available on LMDE 7 or on releases based on Ubuntu 26.04 and later, so the desklet cannot work there yet. This is a limitation of `gcalendar`, which the desklet bundles; it will be fixed when `gcalendar` moves to the `google-auth` libraries.

## Setup

1. Add the desklet to your desktop.

2. If the desklet reports that components are missing, click it and confirm the installation.

3. Right-click the desklet and choose **Authorize Google account** (there is also a button in the configuration dialog). Your browser opens Google's sign-in page.

4. Grant read-only access to your calendars. Google will warn that the application is not verified — this is expected for desktop applications distributed as source, and you can continue. Once you approve, the desklet fills in by itself.

5. Optionally, open the configuration dialog and press **Fill in the list bellow with the names of all my calendars**, then tick the calendars you want to see.

## Multiple Google accounts

Authorize each account in turn, then use the **gcalendar Account ID** setting to choose which one the desklet displays. No terminal is needed.

## Features

- Select events from multiple calendars of the same Google account
- Custom date range
- Customize update frequency
- Manually update the agenda by clicking on the desklet
- Customize the look and feel
- Multiple account support

## Privacy

**None of your data is collected, stored, processed or shared with the developer or any third parties.**

- The desklet talks to Google and to nobody else.
- It asks for read-only access to your calendars. It cannot create, change or delete anything.
- Your authorization is stored on your own computer, under `~/.config/gcalendar/`, and is sent only to Google.
- There is no telemetry of any kind.
- To withdraw access at any time, visit [Google account permissions](https://myaccount.google.com/permissions).

## Upgrading from an older version

Earlier versions of this desklet required a separate `gcalendar` program to be installed on your system. That is no longer the case — everything the desklet needs is now included, and your existing authorization continues to work without any action from you.

If you installed `gcalendar` previously, this desklet no longer uses it. Whether to keep or remove it, and any software repository you added for it, is entirely up to you.

## FAQ

1. **How to manually refresh the desklet?**

    Just click on the desklet. It will retrieve fresh events from Google Calendar.

2. **What does "No events found..." mean?**

    It means you do not have any events in the selected time interval. By default, the desklet retrieves events for the next `7` days. You can modify it by adjusting the "Number of days to include (days)" property in the configuration dialog.
    If that doesn't work, please ensure that you have some events in your Google Calendar by visiting the official [website](https://calendar.google.com/calendar).

3. **What does "Unable to retrieve events..." mean?**

    It means the desklet could not retrieve any events and there is a possible error. Look in Looking Glass (<kbd>Alt</kbd>+<kbd>F2</kbd>, then `lg`) or `~/.xsession-errors` for details, and please report the bug.

4. **How to report bugs?**

    Please open a GitHub issue at [linuxmint/cinnamon-spices-desklets](https://github.com/linuxmint/cinnamon-spices-desklets/issues) if the desklet doesn't work as expected.

5. **Can I use my own client id and client secrets?**

    Yes. Enter them in the **Client Id** and **Client secret** fields in the configuration dialog, then authorize again — an authorization belongs to the credentials that created it.

6. **I love this desklet and want to appreciate it. How can I express it?**

    It is a great pleasure to see someone likes your work. Though I am the [core developer](https://github.com/slgobinath), there are other contributors contributing to this desklet by fixing bugs and translating it into other languages. If you like the desklet, please show it to the world by login to the [CINNAMON spices](https://cinnamon-spices.linuxmint.com/) website and clicking the <kbd>Like it</kbd> button. I also appreciate it, if you can [buy me a coffee](https://paypal.me/slgobinath)!

## Credits and license

This desklet is free software released under the GNU General Public License, version 3 or later.

The `gcalendar` directory is an unmodified copy of [gcalendar](https://github.com/slgobinath/gcalendar) at commit `9986389`, by Gobinath Loganathan, also released under the GPL version 3 or later. Its license is included alongside it.
