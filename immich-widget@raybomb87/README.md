# Immich Widget

A desktop photo slideshow with photos from your own [Immich](https://immich.app) server (Immich 3.2 or newer).

- **Smart cropping.** Uses Immich face detection to crop each photo to the widget's shape around the people in it, so heads are not cut off.
- **Your photos, your choice.** Tick the people, albums and tags to show (with the number of photos of each), or use *On this day*, favorites, a star rating, a time span, places or Immich smart search ("beach", "snow").
- **Camera photos only.** Screenshots and saved images are skipped (optional).
- **Transitions.** Fade, slide in four directions, zoom and flip – tick several and the widget changes between them. Optional slow Ken Burns zoom towards the faces.
- **Caption you control.** Date, "5 years ago", place, the names of the people and the Immich description, each on or off, in any corner, with an optional rounded background. Country names in your own language.
- **Works offline.** Photos are cached, and a new batch is fetched on a schedule you choose.
- Several widgets can run side by side, each with its own settings.

Left-click shows the next photo, middle-click opens it in Immich. Right-click to mark it as a favorite or
to never show it again. The slideshow pauses while the mouse is over it.

## Set up

1. Right-click the widget → **Configure** and enter the server address (for example `http://192.168.1.10:2283`).
2. Make your choices on the **Photos**, **Text** and **Appearance** pages.
3. On the **Connection** page, *Permissions the key needs* lists exactly the permissions your choices need.
   Click **Open API keys in Immich**, create an API key with just those permissions and paste it into **API key**.

If you later turn on something that needs another permission, the widget says which one is missing.
The Immich server must be reachable from the computer, at home or over a VPN.

## Privacy

The widget only talks to the Immich server you enter. Photos are cached in `~/.cache/immich-widget@raybomb87/`.
*Don't show this photo again* is remembered by the widget only; nothing changes in Immich.

The example photo in the screenshot is "Loen fra Skåla" from Wikimedia Commons (CC0).
