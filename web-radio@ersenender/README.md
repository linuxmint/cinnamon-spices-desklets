# Web Radio

A small internet radio player for the desktop: play/stop, previous/next station, volume, and optionally the station list to click on. Playback uses GStreamer directly, no external player.

Next to station and track there is a small picture: the cover of the current track, otherwise the station logo. Click it to see it large. The cover is looked up by the track text at iTunes and Deezer (only for stations that send the track title, i.e. most MP3 streams, not HLS), the logo at radio-browser.info; you can also give each station its own logo. This can be switched off in the settings - then none of these requests are sent. Pictures are cached in `~/.cache/web-radio@ersenender/`.

The station list starts empty: add your stations (name and **direct stream address**, usually ending in `.mp3`, `.aac` or `.m3u8`) in the settings.

Requires GStreamer 1.0 with the usual plugins (`gir1.2-gstreamer-1.0`, `gstreamer1.0-plugins-good`), preinstalled on Linux Mint. The pictures need `curl`.

## Settings

Right-click the desklet and choose *Configure*. Besides the options above you can choose the accent colour (seven presets or your own) and the colour of the card.

## Languages

English, German and Turkish. Further translations are welcome: the template is `files/web-radio@ersenender/po/web-radio@ersenender.pot`.

## License

GPL-3.0-or-later, see `files/web-radio@ersenender/COPYING`.
