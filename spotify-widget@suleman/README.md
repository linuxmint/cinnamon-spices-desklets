# Spotify Widget

A Cinnamon desklet that provides desktop playback controls for Spotify with ad blocking support.

## Features

- Album art, track title, and artist display
- Play/pause, next, previous controls
- Seekable progress bar with time labels
- Volume slider (toggle with icon)
- Open/close Spotify window from desklet
- Auto-relaunches Spotify if window is closed
- Configurable colors, font scale, and widget width

## Requirements

- Spotify (Flatpak or native)
- wmctrl and xdotool
- spotify-adblock (optional, for ad blocking)

## Setup

See the full installation guide at: https://github.com/suleman-dawood/SpotifyWidget

## Usage

The desklet communicates with Spotify via the standard MPRIS2 D-Bus interface. All playback controls work without the Spotify window being visible.

Click the Spotify icon to show the full app. Click X to stop Spotify completely. Click play to relaunch.
