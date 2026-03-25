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

## Note to users and developers

This desklet was created with the support of AI technologies.

## Note to localizers

Translations use standard Gettext `.po` files in `files/calendarium@kami911/po/`.
To compile translations:
```
cd /path/to/cinnamon-spices-desklets
./cinnamon-spices-makepot calendarium@kami911
```

To add a new UI language:
1. Run `cinnamon-spices-makepot calendarium@kami911`
2. Create `po/XX.po` based on `po/calendarium@kami911.pot`

### Contributing Name Days

To add name day data for a new language, open a pull request with:

1. `files/calendarium@kami911/data/namedays/XX.json` — map of `"MM-DD": ["Name1", …]` entries
2. A new option added to the `nameday-locale` key in `settings-schema.json`

> **Note:** Do not edit files inside the installed desklet directory directly — those changes will be overwritten the next time the desklet is updated.

### Contributing Traditional Month Names

To add traditional month names for a new language, open a pull request with:

1. A new `xx: […]` array added to `Localization.TRADITIONAL_MONTHS` in `lib/localization.js`
2. A new option added to the `traditional-lang` key in `settings-schema.json`

> **Note:** Do not edit files inside the installed desklet directory directly — those changes will be overwritten the next time the desklet is updated.

## License

GPL-3.0
