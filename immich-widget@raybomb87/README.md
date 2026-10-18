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

## Examples

The screenshots are from a Norwegian desktop, so dates and country names are in Norwegian.

| | Settings |
| --- | --- |
| ![Ken Burns zoom towards the face](https://raw.githubusercontent.com/RayBomb87/immich-linux-cinnamon-widget/main/arbeidsfiler/screenshots/ken-burns.gif) | **Slow zoom (Ken Burns)** on: the photo zooms slowly towards the face while it is shown (played back at double speed here). One person ticked, names on, place *City, country*, background behind the text. 500 × 290 px. |
| ![One person with name](https://raw.githubusercontent.com/RayBomb87/immich-linux-cinnamon-widget/main/arbeidsfiler/screenshots/example-person.png) | **People:** one person ticked. **Text:** date format *day. month year*, place *City, country*, names of the people, background behind the text (45 %, radius 8), bottom left. 500 × 290 px, corner radius 16. |
| ![Portrait format](https://raw.githubusercontent.com/RayBomb87/immich-linux-cinnamon-widget/main/arbeidsfiler/screenshots/example-portrait.png) | Same as above, but 260 × 340 px and corner radius 28, place *City*. **Crop around faces** keeps the person in the frame. |
| ![Text top right](https://raw.githubusercontent.com/RayBomb87/immich-linux-cinnamon-widget/main/arbeidsfiler/screenshots/example-top-right.png) | **Search for:** *mountains and fjord landscape*. **Text:** top right, *How long ago* on, place *City*, text shadow, no background. |
| ![Text centred](https://raw.githubusercontent.com/RayBomb87/immich-linux-cinnamon-widget/main/arbeidsfiler/screenshots/example-centre.png) | **Text:** bottom centre, date format *month year*, place *City, country*, text size 15 pt, background 70 % with radius 20. |
| ![All transitions](https://raw.githubusercontent.com/RayBomb87/immich-linux-cinnamon-widget/main/arbeidsfiler/screenshots/transitions.gif) | **Transitions:** fade, slide left, right, up and down, zoom and flip, one after the other (*In turn*), 1100 ms. |
| ![No text](https://raw.githubusercontent.com/RayBomb87/immich-linux-cinnamon-widget/main/arbeidsfiler/screenshots/example-no-text.png) | **Show text on the photo** off. 600 × 240 px, corner radius 40. |

## Set up

1. Right-click the widget → **Configure** and enter the server address (for example `http://192.168.1.10:2283`).
2. Make your choices on the **Photos**, **Text** and **Appearance** pages.
3. On the **Connection** page, *Permissions the key needs* lists exactly the permissions your choices need.
   Click **Open API keys in Immich**, create an API key with just those permissions and paste it into **API key**.

If you later turn on something that needs another permission, the widget says which one is missing.
The Immich server must be reachable from the computer, at home or over a VPN.
Immich's machine learning must be on (it is by default) for face cropping, names and smart search.

## Privacy

The widget only talks to the Immich server you enter. Photos are cached in `~/.cache/immich-widget@raybomb87/`.
*Don't show this photo again* is remembered by the widget only; nothing changes in Immich.

The example photo in the screenshot is "Loen fra Skåla" from Wikimedia Commons (CC0).
