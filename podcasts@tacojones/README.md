# Podcasts

Follows podcast feeds and plays their latest episodes, right on the desktop.

![The desklet, listing episodes of three podcasts, one of them playing](screenshot.png)

## Use

1. Add the desklet: System Settings → Desklets → Podcasts → Add.
2. Right-click it → Configure, and add each podcast's feed (RSS) address. A name is optional;
   the feed's own title is used otherwise.
3. Click an episode to play it. Below the list are a progress bar to drag, click or scroll,
   back and forward 10 seconds, pause and stop, and the elapsed and total time.

Each podcast shows its latest episodes (2 by default; Configure → Episodes shown per feed), each
with how long ago it came out, its date and its length. Scroll the list with the mouse wheel.

## Resume where you stopped

Stop or pause part way through an episode, and next time you play it, it carries on from there,
a few seconds early to pick up the thread. The list shows how much of it is left. Finish an
episode, or stop within its last 30 seconds, and it starts from the beginning again. The places
of the 1000 most recently played episodes are kept in
`~/.local/state/podcasts@tacojones/positions.json`.

## Feeds

The feeds are checked again every hour by default (Configure → Check feeds every), or at once
with Refresh in its right-click menu, which also shows when they were last checked. A feed that
can't be loaded says why in the list. RSS feeds only: Atom feeds aren't supported yet.

It starts with a few podcasts to try: BBC Global News Podcast, 99% Invisible, In Our Time,
Radiolab, NASA's Houston We Have a Podcast and LINUX Unplugged. Remove or add any in Configure.

## Appearance

Configure also sets the size, the corner radius, and the background's opacity, down to none at
all so the episodes sit straight on the wallpaper. The colours come from your Cinnamon theme
(System Settings → Themes → Desktop), with podcast titles in its accent colour, and change with
it. Each feed's cover art shows beside its title (Configure → Show cover art); it is downloaded
once into `~/.cache/podcasts@tacojones/`.

## Sound

Its sound shows as "Podcasts" in System Settings → Sound → Applications, with a volume of its
own. If an episode can't be played, the reason stays in the player until you play another or
Close it.

## Requirements

Playback uses GStreamer's `playbin`, and episodes stream through the HTTP source in
`gstreamer1.0-plugins-good`. Mint installs both by default.
