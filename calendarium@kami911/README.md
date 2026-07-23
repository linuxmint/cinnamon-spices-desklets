# Calendarium

A rich, highly customizable calendar and astronomical information desklet for the Cinnamon Desktop.

## Features

- **Date & Time** — Customizable strftime format, 12/24-hour, optional seconds
- **Calendar Highlights** — Day of year, ISO week number, month progress, New Year countdown
- **Traditional Month Names** — Old Hungarian, Old English (Anglo-Saxon), Old German
- **Folk Calendar Sayings** — Traditional folk weather/calendar lore for today
- **National Holidays** — Public holidays, weekends, upcoming-holiday lookahead, and active/upcoming seasonal periods (e.g. Advent, Lent)
- **Moon Phase** — Locally calculated phase, symbol, name, and age in days, plus moonrise/moonset
- **Sunrise & Sunset** — Locally calculated from configurable coordinates (default: Budapest), plus offline city search and up to 3 additional cities with local time / UTC offset
- **Equinox & Solstice** — Countdown to the next seasonal event
- **Western Zodiac** — Sign with Unicode symbol
- **Chinese Zodiac** — Year animal and element
- **Name Days** — Today plus up to 10 days lookahead, optional two-column layout (Hungarian, German, English, French, Spanish, Italian datasets)
- **Alternate Calendars** — Julian, Hebrew, Islamic, and Persian date display
- **Wikipedia** *(opt-in, internet required)* — On-this-day events/births/deaths and article of the day, with rotation, caching, and automatic English fallback
- **Appearance** — Configurable icon size, text scale, and background opacity

Available in Hungarian, German, English, French, Spanish, and Italian.

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
