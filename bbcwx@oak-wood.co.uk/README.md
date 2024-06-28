WEATHER
=======

The Weather desklet displays current and forecast weather on your Cinnamon
desktop. It has plenty of options for configuring how it looks and comes with
a selection of great weather icons, or you can use your own. For those who
like to keep an eye on the weather in several locations, it supports multiple
instances.

At present, the Weather desklet can work with data from:

* BBC **{bbc}**
* meteoblue **{meteoblue}** *
* National Weather Service (USA Only) **{nws}**
* Open-Meteo Non-commercial **{openmeteo}**
* Open Weather Map Free **{owmfree}** *
* Open Weather Map **{owm}** *
* Weather API Free **{weatherapi}** *
* weatherstack **{weatherstack}** *
* World Weather Online **{wwo}** *
* Weather Underground **{wunderground}** * <sup>+

\* A valid API key is required for this service to work.

<sup>+</sup> Weather Underground requires a weather station for access to the
API and an API key.

The Weather desklet includes translations for a growing number of languages.

CONFIGURATION
-------------

Each service requires a valid location parameter and an API key where
required. A valid location parameter can take many forms:

* **Latitude and longitude:** You can provide a latitude and longitude. These
  should be decimals, separated by a comma, with positive being north or east.
  For example, to configure Central London as a location, located at 51.51N,
  0.13W, enter `51.51,-0.13`.
* **Location:** You can specify the location using City/Country or City,
  Country or City, Region, Country, where the region would be a state for the
  United States for example. Some valid examples: `Houston, TX`,
  `Paris/France`, `Chicago, IL, US`.
* **Location code/Station ID:** This is a location code that is specific to
  the service. To configure the desklet using one of these, you would need to
  visit the site (you can click using the link at the bottom of the desklet)
  and after searching for your desired location, the website address will have
  the location you can use. Some examples: `2643743`, `zmw:00000.16.03541`,
  `KMAHANOV10`.
* **Autodetection:** The location can be automatically determined by the
  service based on your IP address. Some examples: `auto:ip`, `fetch:ip`.

The location parameters per service:

* **BBC**
  * Location code
* **meteoblue**
  * Latitude and longitude (up to four decimals)
* **National Weather Service**
  * Latitude and longitude (up to four decimals)
* **Open-Meteo Non-commercial**
  * Latitude and longitude (up to five decimals)
* **Open Weather Map Free**
  * Latitude and longitude (up to two decimals)
  * Location code
* **Open Weather Map**
  * Latitude and longitude (up to two decimals)
  * Location code
* **Weather API Free**
  * Latitude and longitude (up to four decimals)
  * Location
  * Autodetection (`auto:ip`)
  * Location code
* **weatherstack**
  * Location
  * Latitude and longitude (up to four decimals)
  * Autodetection (`fetch:ip`)
* **World Weather Online**
  * Location
  * Latitude and longitude (up to three decimals)
* **Weather Underground**
  * Station ID, such as `KAZTUCSO539`
  * Geocode - latitude and longitude (up to two decimals)

### REFRESH TIME

This option allows for setting the period between refreshing forecasts. The
default of 30 minutes should be adequate for most purposes. Please consider
the impact of lower refresh times on the service provider's servers and do not
use lower refresh periods unless you have a very good reason. In order to
comply with the terms of use of some providers, the Weather desklet will
override low settings in some cases and enforce a minimum.

FUNCTIONALITY
-------------

<details>
  <summary>Supported Features</summary>

|                          |   bbc   |   meteoblue   |   nws   |   openmeteo   |   owmfree   |   owm   |   weatherapi   |   weatherstack   |   wwo   |   wunderground   |
| :----------------------: |   :-:   |   :-------:   |   :-:   |   :-------:   |   :-----:   |   :-:   |   :--------:   |   :----------:   |   :-:   |   :----------:   |
| **Icons**                |❕<sup>1 |      ✅       |   ❌    |      ✅       |     ✅      |   ✅    |      ✅        |    ❕<sup>2      |   ✅    |        ✅        |
|                          |         |               |         |               |             |         |                |                  |         |                  |
| **Forecast Days**        |    3    |       7       |    6    |   16<sup>3    |      5      |16<sup>3 |       3        |        7         |    7    |        4         |
|                          |         |               |         |               |             |         |                |                  |         |                  |
| **Display Capabilities** |         |               |         |               |             |         |                |                  |         |                  |
|                          |         |               |         |               |             |         |                |                  |         |                  |
| Current Weather          |         |               |         |               |             |         |                |                  |         |                  |
| humidity                 |   ✅    |       ❌      |   ❌    |      ✅       |     ✅      |   ✅    |       ✅       |        ✅        |   ✅    |        ✅        |
| temperature              |   ✅    |       ✅      |   ✅    |      ✅       |     ✅      |   ✅    |       ✅       |        ✅        |   ✅    |        ✅        |
| pressure                 |   ✅    |       ❌      |   ❌    |      ✅       |     ✅      |   ✅    |       ✅       |        ✅        |   ✅    |        ❌        |
| pressure direction       |   ✅    |       ❌      |   ❌    |      ❌       |     ❌      |   ❌    |       ❌       |        ❌        |   ❌    |        ❌        |
| wind speed               |   ✅    |       ✅      |   ✅    |      ✅       |     ✅      |   ✅    |       ✅       |        ✅        |   ✅    |        ✅        |
| wind direction           |   ✅    |       ✅      |   ✅    |      ✅       |     ✅      |   ✅    |       ✅       |        ✅        |   ✅    |        ✅        |
| weather text             |   ✅    |       ✅      |   ✅    |      ✅       |     ✅      |   ✅    |       ✅       |        ✅        |   ✅    |        ✅        |
| visibility               |   ✅    |       ❌      |   ❌    |      ❌       |     ✅      |   ✅    |       ✅       |        ✅        |   ✅    |        ❌        |
| feels like               |   ❌    |       ❌      |   ❌    |      ✅       |     ✅      |   ✅    |       ✅       |        ✅        |   ✅    |        ✅        |
|                          |         |               |         |               |             |         |                |                  |         |                  |
| Forecasts                |         |               |         |               |             |         |                |                  |         |                  |
| humidity                 |   ✅    |       ✅      |   ❌    |      ❌       |     ✅      |   ✅    |       ✅       |        ❌        |   ✅    |        ✅        |
| max temperature          |   ✅    |       ✅      |   ✅    |      ✅       |     ✅      |   ✅    |       ✅       |        ✅        |   ✅    |        ✅        |
| min temperature          |   ✅    |       ✅      |   ✅    |      ✅       |     ✅      |   ✅    |       ✅       |        ✅        |   ✅    |        ✅        |
| pressure                 |   ✅    |       ✅      |   ❌    |      ❌       |     ✅      |   ✅    |       ❌       |        ❌        |   ✅    |        ❌        |
| wind speed               |   ✅    |       ✅      |   ✅    |      ✅       |     ✅      |   ✅    |       ✅       |        ❌        |   ✅    |        ✅        |
| wind direction           |   ✅    |       ✅      |   ✅    |      ✅       |     ✅      |   ✅    |       ❌       |        ❌        |   ✅    |        ✅        |
| weather text             |   ✅    |       ✅      |   ✅    |      ✅       |     ✅      |   ✅    |       ✅       |        ❌        |   ✅    |        ✅        |
|                          | **bbc** | **meteoblue** | **nws** | **openmeteo** | **owmfree** | **owm** | **weatherapi** | **weatherstack** | **wwo** | **wunderground** |
<!--|                          |         |               |         |               |             |         |                |                  |         |                  |-->
<!--|                          |   bbc   |   meteoblue   |   nws   |   openmeteo   |   owmfree   |   owm   |   weatherapi   |   weatherstack   |   wwo   |   wunderground   |-->

<sup>1</sup> BBC has partial support for icons.

<sup>2</sup> weatherstack doesn't support forecast icons.

<sup>3</sup> The desklet has a maximum of 7 days even if the service supports
more than that.

</details>

COMPATIBILITY
-------------

> [!NOTE]
> On the first upgrade to version 3.0 of this desklet, it may be required to restart Cinnamon.

CREDITS
-------

### CODE

The Weather desklet was originally written by [Chris
Hastie](https://www.oak-wood.co.uk/) and released under the [GNU General
Public License version 3](https://www.gnu.org/licenses/gpl-3.0.html). Prior to
that, it was originally a fork of Loganj's AccuWeather Desklet, which is
released under the “use it as you like” license. Copyright © 2014–2018 Chris
Hastie, 2013 Loganj. The Open Weather Map Free driver was contributed by
Kallys.

### ICONS

* The colourful, flat colourful, light, dark, flat white, and flat black icons
are based on the [plain weather
icons](https://www.deviantart.com/merlinthered/art/plain-weather-icons-157162192)
by [Merlin The Red](https://www.deviantart.com/merlinthered). They are
licensed under the [Creative Commons Attribution-NonCommercial-ShareAlike
license](https://creativecommons.org/licenses/by-nc-sa/3.0/) and are copyright
© 2010 Merlin the Red.
* The [VCloud
icons](https://www.deviantart.com/vclouds/art/VClouds-Weather-Icons-179152045)
are copyright © 2010 [VClouds](https://www.deviantart.com/vclouds) and are
licensed under the [Creative Commons Attribution-NonCommercial-ShareAlike
license](https://creativecommons.org/licenses/by-nc-sa/3.0/).
* The Weezle icons are copyright © 2010
[d3stroy](https://www.deviantart.com/d3stroy) and are licensed under the
[Creative Commons Attribution-No Derivatives
license](https://creativecommons.org/licenses/by-nd/3.0/).
* The [Novacon
icons](https://www.deviantart.com/digitalchet/art/Novacons-Weather-Icons-13133337)
are copyright © 2004 [digitalchet](https://www.deviantart.com/digitalchet) and
are licensed under the [Creative Commons Attribution-NonCommercial-ShareAlike
license](https://creativecommons.org/licenses/by-nc-sa/3.0/).
* The [Meteocon icons](https://www.alessioatzeni.com/meteocons/) are copyright © [Alessio Atzeni](https://www.alessioatzeni.com/) and are licensed under a custom license.
* The [Sketchy
icons](https://www.deviantart.com/azuresol/art/Sketchy-Weather-Icons-135079063)
are copyright © 2006 [AzureSol](https://www.deviantart.com/azuresol) and are
licensed under the [Creative Commons Attribution-NonCommercial-ShareAlike
license](https://creativecommons.org/licenses/by-nc-sa/3.0/).
