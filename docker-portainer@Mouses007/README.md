# Docker Manager

A Cinnamon desklet to monitor and control Docker containers — either via the [Portainer](https://portainer.io) API or directly via the local Docker CLI.

## Features

- Live container list with status indicators (running / stopped)
- Start, stop and restart containers with one click
- Works without Portainer — falls back to local `docker` CLI automatically
- Switch between two Portainer environments (e.g. local + NAS)
- Pull images and check for updates on demand
- Portainer container itself is protected (no accidental shutdown)

## Modes

### Without Portainer (docker CLI)
Leave the API token empty. The desklet reads containers directly via `docker ps`. No setup required — just make sure your user is in the `docker` group.

### With Portainer
Enter host, port and API token in the settings. Supports multiple environments (e.g. local + NAS via Portainer Agent).

## Requirements

- Docker installed locally, **or**
- A running [Portainer CE](https://portainer.io) instance (local or remote) with an API token

## Setup (Portainer mode)

1. Open Portainer → **My Account** → **Access tokens** → **Add access token**
2. Copy the generated token
3. Open the desklet settings and enter:
   - **Portainer host** (e.g. `localhost` or `192.168.1.100`)
   - **Portainer port** (default: `9000`)
   - **API token**
   - **Environment ID** (found in Portainer under *Environments*, usually `1`)

## Second Environment (optional)

To switch between two environments (e.g. local Docker and a NAS):

1. Install the [Portainer Agent](https://docs.portainer.io/admin/environments/add/docker/agent) on the second host
2. Add it as a new environment in Portainer
3. Enter its Environment ID under **Environment ID (2nd)** in the desklet settings
