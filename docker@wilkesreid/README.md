# Docker

A Cinnamon desklet that displays Docker containers on your desktop with start/stop controls and docker-compose group management.

## Features

- Live container status with automatic refresh
- Start/stop individual containers
- Docker Compose group detection with "Start All" / "Stop All" controls
- Configurable refresh interval, widget size, and visibility of stopped containers

## Requirements

- Docker installed and running
- Your user added to the `docker` group if it isn't already (`sudo usermod -aG docker $USER`, then log out and back in)

## Settings

- **Refresh interval** — How often to poll Docker (default: 10 seconds)
- **Show stopped containers** — Toggle visibility of non-running containers
- **Widget width / height** — Resize the desklet to fit your desktop

## Attribution

[Docker](https://icons8.com/icon/22813/docker) icon by [Icons8](https://icons8.com)
