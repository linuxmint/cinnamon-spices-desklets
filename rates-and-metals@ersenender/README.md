# Rates and Metals

Exchange rates and precious metal prices as a compact list. Choose the base currency (EUR, USD, TRY, GBP, CHF), which of 19 currencies and 4 metals (gold, silver, platinum, palladium) are shown and in which order, the direction of the rate, and the unit for metals (gram, troy ounce, kilogram).

- **History line** per row: the last 30 days at a glance, green when rising, red when falling.
- **Change in percent** compared with the previous day, 7 days ago or 30 days ago.
- **Amount to convert**: show the value of any amount instead of 1 (100 EUR = ... USD).
- Optional **nisab** row: the value of 80.18 g of gold (nisab for zakat according to Diyanet).
- The tooltips add both directions of the rate and the 30-day low and high.

The history of the metals grows with every day the desklet was running, because that source has no history.

Sources: currencies are the daily reference rates of the European Central Bank via [frankfurter.dev](https://frankfurter.dev/), metals come from [gold-api.com](https://gold-api.com/). Both are free and need no key. These are reference values, not prices you can trade at.

Requires `python3` (standard library only).

## Settings

Right-click the desklet and choose *Configure*. Besides the options above you can choose the accent colour (seven presets or your own) and the colour of the card.

## Languages

English, German and Turkish. Further translations are welcome: the template is `files/rates-and-metals@ersenender/po/rates-and-metals@ersenender.pot`.

## License

GPL-3.0-or-later, see `files/rates-and-metals@ersenender/COPYING`.
