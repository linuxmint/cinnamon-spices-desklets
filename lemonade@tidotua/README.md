# Lemonade AI Server Desklet
Desklet allows to monitor status and make simple actions with Lemonade AI Server (lemonade-server.ai), that hosted on localhost or in the local network.
Server itself not a part of this desklet. Please install it from official sources or use remote instance.

## Requirements

- curl

## Features

| Item            | Description |
| -----------     | ----------- |
| Server status   | Server state (online/offline), address, version |


## Settings

| Name        | Type        | Description |
| ----------- | ----------- |-----------  |
| Server      | URL         | URL to the local server. Default is http://127.0.0.1:13305/ |
| API key     | String      | Secret string key received from server owner to be able to use server API. Can be empty if you use localhost  |

