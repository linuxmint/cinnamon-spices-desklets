# Calendarium

A rich, highly customizable calendar and astronomical information desklet for the Cinnamon Desktop.

## Features

- **Date & Time** — Customizable strftime format, 12/24-hour, optional seconds
- **Traditional Month Names** — Old Hungarian, Old English (Anglo-Saxon), Old German
- **Moon Phase** — Locally calculated phase, symbol, name, and age in days
- **Sunrise & Sunset** — Locally calculated from configurable coordinates (default: Budapest)
- **Western Zodiac** — Sign with Unicode symbol
- **Chinese Zodiac** — Year animal and element
- **New Year Countdown** — Days until next January 1st
- **Name Days** — Today plus up to 5 days lookahead (Hungarian, German, English datasets)
- **Wikipedia** *(opt-in, internet required)* — On-this-day births & deaths, article of the day

## Installation

Copy or symlink the `files/calendarium@kami911/` directory to:
```
~/.local/share/cinnamon/desklets/calendarium@kami911/
```

Then right-click the Cinnamon desktop → Add Desklets → Calendarium.

## Localization

Translations use standard Gettext `.po` files in `files/calendarium@kami911/po/`.
To compile translations:
```
cd /path/to/cinnamon-spices-desklets
./cinnamon-spices-makepot calendarium@kami911
```

To add a new UI language:
1. Create `po/XX.po` based on `po/calendarium@kami911.pot`
2. Run `cinnamon-spices-makepot calendarium@kami911`

## Extending Name Days

1. Create `files/calendarium@kami911/data/namedays/XX.json` with `{ "MM-DD": ["Name1"] }` format
2. Add `"Language Name": "xx"` to the `nameday-locale` options in `settings-schema.json`

## Extending Traditional Month Names

1. Add a new `xx: [...]` array to `Localization.TRADITIONAL_MONTHS` in `lib/localization.js`
2. Add the option to `traditional-lang` in `settings-schema.json`

## License

GPL-3.0
