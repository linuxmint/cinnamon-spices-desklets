# Calendar

A month calendar with week numbers - one month, or three months side by side or stacked. Holidays and appointments are marked and listed below, with the distance to each (today, tomorrow, in 5 d).

- **Calendar subscriptions**: add the address of any `.ics` file on the web (`webcal://` works too) - the public holidays of your country, school holidays, or your own online calendar. They are fetched every six hours with `curl` and cached, so the last state is shown offline.
- Timed and recurring entries are read as well (daily, weekly, monthly, yearly, with interval, count and end date); times are converted to your local time.
- An iCalendar **file** can be imported too, and you can enter your own days in the settings.
- **New moon and full moon** can be marked (calculated, no network).
- The week starts on Monday or Sunday.

Public holidays are built in for **Germany** (all 16 federal states, nationwide only, or none); for other countries use a subscription.

The subscriptions need `curl`.

## Settings

Right-click the desklet and choose *Configure*. Besides the options above you can choose the accent colour (seven presets or your own) and the colour of the card.

## Languages

English, German and Turkish. Further translations are welcome: the template is `files/calendar-sheet@ersenender/po/calendar-sheet@ersenender.pot`.

## License

GPL-3.0-or-later, see `files/calendar-sheet@ersenender/COPYING`.
