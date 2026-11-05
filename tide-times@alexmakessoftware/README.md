# Tide Times

A small Cinnamon desklet that shows predicted sea levels for your beach as a 12-hour chart, centred on the current time.

**This is a rough guide for planning a beach walk. It is not for navigation or safety decisions.** Actual sea levels vary with the weather and local geography, so always check conditions on site.

## Setup

Right-click the desklet, choose **Configure**, and enter:

- **Label**: the name shown at the top of the desklet. It is for display only and does not change the tides.
- **Latitude** and **longitude**: these choose the tides. North and east are positive, south and west are negative.

The desklet follows your Cinnamon theme. To set the background opacity, text and background colours, and corner radius yourself, turn on **Override desktop theme**.

Predictions come from the tide station nearest those coordinates. The desklet shows the station's name and distance, and warns you if it is more than 50 km away. Even a closer station may not match your beach, because the coast's shape can make a big difference.

## What it shows

- The predicted sea level for six hours either side of now, with an orange line marking the current time.
- The current level, whether the tide is rising or falling, and the next high or low water.

Heights are in metres above the station's chart datum, the baseline used by published tide tables.

Predictions refresh every 30 minutes. If a refresh fails, the desklet keeps showing the last predictions it received and says they may be out of date.

## Privacy

The desklet sends only your configured coordinates and a time range to [Open Waters](https://openwaters.io/api/tides/). There is no account, API key, tracking or automatic location detection.

## Data credits

Tide predictions are provided by the Open Waters API, using the [Slackwater database](https://github.com/openwatersio/slackwater-database). Station data comes from various sources under their own licences. For example, stations from TICON-4 (Hart-Davis, M., Dettmering, D., Seitz, F. (2025), [TICON-4: TIdal CONstants based on GESLA-4 sea-level records](https://doi.org/10.17882/109129), SEANOE) are licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and have been modified by Slackwater.
