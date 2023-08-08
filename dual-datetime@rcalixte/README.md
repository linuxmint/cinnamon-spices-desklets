DUAL DATETIME
=============

This is a simple desklet to display two datetime strings, defaulting to the time
and date. The size and format of each are configurable by changing the values
in the settings.

DESCRIPTION
-----------

Adjust the following options for each datetime value using the settings:

* Time Format
* Time Alignment (per Layout)
* Font
* Color
* Size

Additional desklet options include:

* Fixed Width
* Layout (Vertical or Horizontal)
* Show Decorations
* Background Color

The datetime format are from the JavaScript `toLocaleFormat` function and the
possible values can be found locally in the terminal with:

```bash
  $> man date
```

or online at:
[date Manual](https://man7.org/linux/man-pages/man1/date.1.html)

It is also possible to test string outputs in the terminal using the `date`
command and then copy the desired option to the settings input:

```bash
  $ date +"%-H:%M"
  14:27
```

For example, to add seconds to the first time format, append `:%S` like so:

```json
  "Format": "%-H:%M:%S"
```

CONFIGURATION
-------------

It is possible to set a single datetime string for both the time and date if
desired. If the `Format` field is blank for either format field, that value will
not be displayed.

COMPATIBILITY
-------------

This applet has been tested to be compatible with Cinnamon 5.6+ but is
supported for Cinnamon 5.4+.
