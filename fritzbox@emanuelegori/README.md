# FRITZ!Box Status desklet

Displays operational parameters of a FRITZ!Box router on the Cinnamon desktop,
using unauthenticated TR-064 / IGD UPnP LAN endpoints on port 49000.

Each parameter is individually toggleable from the desklet configuration dialog.

## Supported parameters

- Model name (from `/tr64desc.xml`)
- Firmware version (from `/tr64desc.xml`)
- WAN physical link status
- WAN access type (DSL / Ethernet / Cable / LTE / 5G)
- Negotiated max down/up rates
- Internet connection status
- Last connection error
- Connection uptime
- Public IP address
- Total bytes received / sent
- Instantaneous throughput (down / up)
- Firmware update availability

### How to read the values

Some displayed values do not match the "online counters" page of the FRITZ!Box
UI, because they refer to different reset events:

- **Uptime**: time since the last Internet (IP) connection renegotiation
  (`GetStatusInfo.NewUptime` from `WANIPConnection:1`). It is **not** the box
  power-on time: it resets whenever the WAN session reconnects (PPP re-login,
  DHCP renew failure, line drop, etc.). In the FRITZ!Box UI you can see the
  same information in **Internet → Overview** as "Connected since YYYY-MM-DD HH:MM".
- **Total received / sent**: cumulative byte counters of the WAN interface
  (`GetAddonInfos.NewX_AVM_DE_TotalBytesReceived64 / Sent64`). These reset
  only on **router reboot** or on a manual counter reset. They are **not** the
  "today" counters shown in the FRITZ!Box UI online counters page, which are
  aggregated internally and are not exposed over TR-064 / IGD UPnP.
- **Instantaneous throughput**: current up/down rate reported by the router
  itself (`NewByteReceiveRate / NewByteSendRate`, bytes per second). The
  FRITZ!Box UI samples at ~5 s intervals, so matching it exactly requires
  setting the desklet polling interval to 5 s as well.

## Requirements

- A FRITZ!Box router reachable on the LAN (default: `fritz.box:49000`)
- TR-064 enabled on the router (default)

No AVM account, no login, and no credentials are required: all queries use the
UPnP IGD service which exposes read-only information on the LAN.

## Settings

- **Connection**: host, port, polling interval, request timeout
- **Parameters**: one checkbox per displayed value
- **Style**: font, text/label/background/border colors, transparency, border width

## Tested on

- FRITZ!Box 6850 LTE, FRITZ!OS 8.25

The same IGD UPnP endpoints are implemented across the FRITZ!Box lineup, so the
desklet should work on most DSL / fiber / cable / LTE models without changes.

## License

GPLv2 or later.
