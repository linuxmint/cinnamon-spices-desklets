# Immich Widget

A desktop photo slideshow with photos from your own [Immich](https://immich.app) server.

- **Smart cropping.** Uses Immich face detection to crop each photo to the widget's shape around the people in it, so heads are not cut off.
- **Your photos, your choice.** Show all photos, only favorites, one album or one person.
- **Camera photos only.** Screenshots and saved images are skipped (optional).
- **Date and place caption** in your own language, for example *27 July 2023 · Bergen*.
- **Works offline.** Photos are cached, and a new batch is fetched on a schedule you choose.
- Several widgets can run side by side, each with its own settings.

Left-click shows the next photo. Middle-click opens the photo in Immich.

## Set up

1. In Immich, go to your profile picture → **Account Settings → API Keys → New API Key**. Give it these permissions:
   - `asset.read` and `asset.view` (required)
   - `face.read` (for cropping around faces)
   - `album.read` (only if you show one album)
   - `person.read` (only if you show one person)
2. Right-click the widget → **Configure** and enter the server address (for example `http://192.168.1.10:2283`) and the API key.

The first photos appear after a few seconds. The Immich server must be reachable from the computer, at home or over a VPN.

## Privacy

The widget only talks to the Immich server you enter. Photos are cached in `~/.cache/immich-widget@raybomb87/`.

The example photo in the screenshot is "Loen fra Skåla" from Wikimedia Commons (CC0).
