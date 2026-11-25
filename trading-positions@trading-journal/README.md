# AutarkTrade Positions Desklet

Shows your open positions and running bots from a self-hosted
[AutarkTrade](https://github.com/Mouses007/AutarkTrade) instance (formerly
*Crypto Trading Journal*) directly on your desktop, with live PnL — grouped by exchange.

## Features
- Open futures positions from **Bitunix** and **Bitget**, plus running **Pionex** bots
- Grouped per exchange with a per-broker summed PnL
- Per position: symbol, side, leverage, entry/mark price, unrealized & realized PnL
- **PnL in %** of the margin (toggle with the `%` button or in the settings)
- Bots: **grid profit** so far, values optionally converted to **USDT**
- **Price chart** below the table: symbol and span (24 h / 7 days) configurable,
  line or candles, with price scale and current-price marker
- Symbols link to the chart in the AutarkTrade web app; optional Bitunix button
- Optional spoken alarms (see below)
- Auto-refreshes on a configurable interval (default 30 s)
- Adjustable columns, font sizes, background opacity and width

## Requirements
- A running **AutarkTrade** instance reachable from this machine (LAN or VPN).
- An **API key** from AutarkTrade: open **Settings → Devices → External displays
  (ESP32 / Widget / Desklet)** and copy the main key. The desklet uses AutarkTrade's
  read-only, key-authenticated endpoint, so it keeps working even when the
  app's optional password protection is enabled.

## Setup
1. Add the desklet to your desktop (right-click desktop → *Add Desklets*).
2. Right-click the desklet → *Configure* and enter:
   - **Server host / IP** (e.g. `192.168.178.100`) and **port** (default `8080`)
   - **API key** (from the AutarkTrade settings above)
   - Optional: refresh interval, columns, chart, font sizes, opacity, width
3. **Encrypted (HTTPS, port 8443)** is on by default. Pair once:
   press **1. Fetch server certificate** — the desklet fetches the AutarkTrade CA over
   `http://host:8080/api/esp32/ca` and shows its SHA-256 fingerprint. Compare it with
   **Settings › General › HTTPS** in the AutarkTrade web app; only if it matches press
   **2. Fingerprint matches — pair**. From then on the desklet talks HTTPS to port 8443
   and trusts only that certificate — never the system CAs, and never falling back to
   plain HTTP. If the server's certificate changes, pair again. Switching HTTPS off sends
   the API key unencrypted (only for a trusted LAN/VPN).

## Spoken alarms (optional)
With *Speak alarms* on, the desklet reads alarms aloud with `spd-say`. For a more
natural offline voice, install [Piper](https://github.com/rhasspy/piper) to
`~/.local/share/piper/piper/` and put the voices `de_DE-thorsten-high` and/or
`en_GB-jenny_dioco-medium` (`.onnx` + `.onnx.json`) into `~/.local/share/piper/stimmen/`.
The AutarkTrade repository has `desklet/install.sh --stimme`, which does exactly that.

## Upgrading from 1.x
Your settings are kept. The desklet now also reads Bitget and shows the chart; the
server must be AutarkTrade (the successor of Crypto Trading Journal).

## Licence
MIT (`LICENSE` in the desklet folder). AutarkTrade itself is under its own licence (AGPL-3.0).
