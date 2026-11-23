# onocoy Monitor

## Table of Contents

- [Overview](#overview)
  - [How It Works](#how-it-works)
  - [Features](#features)
  - [Screenshot](#screenshot)
- [Usage](#usage)
- [Configuration](#configuration)
- [Links](#links)
- [Author](#author)

## Overview

onocoy Monitor Desklet is a simple Cinnamon desklet that displays the live status of your onocoy reference station / node directly on your desktop, using the onocoy public monitoring API.

[onocoy](https://onocoy.com) is an open GNSS data marketplace that connects RTCM 3 / NTRIP-compliant reference stations to a global, community-powered RTK correction network. With this desklet, station operators can keep an eye on their node without having to open the web console.

### How It Works

- The desklet periodically polls the onocoy monitoring endpoints for your station / account.
- Status information (online / offline, last seen, data quality, location) is rendered as a compact desklet on the desktop.
- The display refreshes automatically at a configurable interval.

### Features

- Live status of your Onocoy reference station on your desktop.
- Automatic background refresh.
- Compact, themable layout that fits the Cinnamon look and feel.
- Easy configuration through the desklet settings menu.
- Visual look tweaks (size, colors, displayed fields).

### Screenshot

[![Screenshot](https://github.com/airtkey/cinnamon-spices-desklets/raw/master/onocoy-monitor%40alexmm/files/onocoy-monitor@alexmm/screenshot.png)](/airtkey/cinnamon-spices-desklets/blob/master/onocoy-monitor%40alexmm/files/onocoy-monitor@alexmm/screenshot.png)

## Usage

1. Add the onocoy Monitor Desklet to your desktop via the "Add Desklets" menu in Cinnamon.
2. Open the desklet settings and enter your onocoy account / station identifier.
3. The desklet will start polling the onocoy API and display the current status of your node.
4. Configure the desklet's settings — appearance, refresh interval, displayed fields, and other preferences — through the settings menu. This allows you to customize the desklet to suit your needs and preferences.

## Configuration

The desklet supports monitoring of multiple Onocoy reference stations simultaneously. The following options are available in the settings menu:

- **Add stations** — add as many stations as you like by entering the station's **MOUNTPOINT**.
- **Custom names** — give each station a custom display name for easy identification.
- **Manual refresh** — trigger an on-demand refresh at any time, independent of the automatic interval.
- **Token price display** — show the current token price in either EUR (€) or USD ($).


If you have any ideas for new features, please feel free to ask me to add them!

## Links

- Website - [airtkey.xyz](https://airtkey.xyz)
- onocoy - [https://onocoy.com](https://onocoy.com)
- onocoy Docs - [https://docs.onocoy.com](https://docs.onocoy.com)
- onocoy Console / Explorer - [https://console.onocoy.com/explorer](https://console.onocoy.com/explorer)
- onocoy Discord - [Join the Onocoy community](https://discord.com/invite/CHKxSpPQ8p)

## Author

Tech Ambassador at Onocoy

- GitHub - [@airtkey](https://github.com/airtkey)
- LinkedIn - [Alexander Gretz](https://www.linkedin.com/in/alexander-gretz-depin/)
- X / Twitter - [@AlexMultiMining](https://x.com/AlexMultiMining)
- Website - [airtkey.xyz](https://airtkey.xyz)
