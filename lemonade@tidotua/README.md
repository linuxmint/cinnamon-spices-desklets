# Lemonade AI Server Desklet

A Cinnamon desklet to monitor the status of a [Lemonade AI Server](https://lemonade-server.ai) (lemonade-server.ai) running on localhost or in the local network, and to load/unload models from it.
The server itself is not a part of this desklet. Install it from the official sources or point the desklet at a remote instance.

## Requirements

- Cinnamon 5.8 (Linux Mint 21) or newer (the desklet uses Soup 3)
- A running Lemonade AI Server (localhost or LAN)
- No external tools — all HTTP requests are made with GJS/Soup

## Features

| Item | Description |
| ----------- | ----------- |
| Server status | Online/offline state, server address and version; API key and HTTP error reporting |
| Statistics | Current session context size ("Context") and tokens per second ("TPS"), shown while the server is online (0 when no model is loaded) |
| Model list | All downloaded models with their recipes; active models show the target device and a Ready/Busy/Off state |
| Load / unload | Click a model to load or unload it (with a confirmation dialog) |
| Open web UI | Clicking the Lemonade icon opens the server URL in the default browser |
| Instances | Up to 5 desklet instances |
| i18n | Translatable, includes a `po/` template |

## Settings

| Name | Type | Default | Description |
| ----------- | ----------- | ----------- | ----------- |
| Server Address | Entry | `127.0.0.1` | Server IP or domain address |
| Server Port | Spin button | `13305` | Port between 1 and 65535 |
| Version Endpoint | Entry | `v1` | API version endpoint in `vN` format |
| Server API key | Entry | *(empty)* | Optional API key. Sent as an `Authorization: Bearer` header; leave empty if the server does not require one |
| Update period | Spin button | `5` | Polling period in seconds (5–60, step 5) |
| Background color | Color | `rgb(40,40,40)` | Desklet background color |

## Status values

| Status | Meaning |
| ----------- | ----------- |
| Online | Server answers; version is shown in the header |
| Offline | No response (network error, server down, or invalid response) |
| Error: Invalid or missing API key | Server answered 401 — check the API key setting |
| HTTP Error \<code\> | Any other non-2xx answer from the server |

## Notes

- All requests are plain `http` (no TLS). If you use an API key, it is sent in the clear and stored in plain text in Cinnamon's per-desklet settings. Use the desklet only on a trusted network.
- "Context" is the current **session context** — the size of the whole conversation, not just the last message. The server exposes it per request as `cache + input + output` tokens (cached history + new input + generated output), so it grows with the conversation and refreshes on every request; it matches the session token counter shown by the client (e.g. OpenCode). "TPS" shows the live estimated tokens per second while a request is generating; when idle it shows the latest request's `tokens_per_second` — the generation speed of the last request, as reported by the backend or calculated from a streamed response. While a model is loaded it keeps that value until a new request is made; when no model is active the desklet shows 0 (same for Context).
- These numbers are per-session, not cumulative (the server's `*_total` counters are not used). They update only when a new request is made — after a model reload the server keeps the previous values until the next one.
- Context is shown in K tokens, rounded to whole K, as `NNK / NNNK (NN%)` (for example `41K / 196K (21%)`); when the effective cap is unknown only `NNK` is shown.
- The server may cap the runtime context below the model's maximum (`--ctx-size`); `/v1/models` reports the effective cap in `context_length` and the model maximum in `max_context_window`. The denominator is the `context_length` of the most recently used loaded model (`model_loaded` from `/v1/health`); since loading counts as a use, right after manually loading a second model the cap shown can still be the other model's until the first request on the newly loaded one.
- The statistics row is hidden when the server is offline; when online but no model is loaded, Context and TPS are shown as 0.
- Changing the server address, port, API version or API key resets the displayed data; the new server is queried on the next polling cycle (up to the configured update period later).

## AI use

Local LLM on the Lemonade server (llamacpp.vulkan backend and Qwen3.8-27B model) was used for the following actions:

- Stats API and output analysis, stats code implementation
- Code review
- This Readme prepare
