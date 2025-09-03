# System monitor graph Desklet
Desklet to show graphs for the level of activity in various system variables including: CPU, memory, network and disks. The desklet supports multiple instances with different system variables with the idea of presenting them in a uniform way.

**NEW in v2.1**: SSH Remote Monitoring - Monitor remote systems via SSH connection with optimized connection management and multi-instance support.

<p align="center">
<img src="https://cinnamon-spices.linuxmint.com/git/desklets/system-monitor-graph@rcassani/simple.gif" width="400" align="middle"><br>
Four instances of the Desklet in action.
</p>


This project has been inspired from other Desklets such as [Disk Space](https://cinnamon-spices.linuxmint.com/desklets/view/39), [CPU Load](https://cinnamon-spices.linuxmint.com/desklets/view/44), [Simple system monitor](https://cinnamon-spices.linuxmint.com/desklets/view/29), [Network usage monitor](https://cinnamon-spices.linuxmint.com/desklets/view/15), [Top](https://cinnamon-spices.linuxmint.com/desklets/view/41), and the  [Rainmeter Win10 Widgets](https://win10widgets.com/).

## Features
### Variables to monitor (v2.1 - September 2025)

| System variable | Description | SSH Support |
| -----------     | ----------- | ----------- |
| CPU             | CPU usage in % | ✅ Full support |
| RAM             | Used RAM as % of total, and in GB | ✅ Full support |
| Swap            | Used Swap space as % of total, and in GB | ✅ Full support |
| HDD             | % of I/O activity, and free and total space in the filesystem (partition) indicated by the user | ✅ Full support |
| GPU Usage       | GPU usage in % | ✅ Full support |
| GPU Memory      | GPU memory usage in % | ✅ Full support |
| Network         | Real-time upload and download speeds with dual-line graph, configurable interface monitoring | ✅ Full support |

### SSH Remote Monitoring (v2.1)
- **Remote System Monitoring**: Monitor any system via SSH connection
- **Optimized Connections**: Shared SSH connections across multiple desklet instances
- **Intelligent Configuration**: Prevents connection attempts until SSH is properly configured
- **Multi-Instance Support**: Multiple desklets can share the same SSH connection efficiently
- **All Variables Supported**: Every monitoring function works seamlessly over SSH
- **Easy Setup**: Simple host and port configuration in desklet settings

---

# SSH Remote Monitoring Setup

The System Monitor Graph desklet v2.1+ supports monitoring remote systems via SSH connections.

## Quick Setup

1. **Enable SSH in desklet settings**
   - Check "Enable SSH monitoring"
   - Enter your SSH host (e.g., `user@hostname` or `user@192.168.1.100`)
   - Set SSH port (default: 22)

2. **SSH Requirements**
   - SSH access to target system
   - Key-based authentication recommended
   - Target system should have standard utilities (`top`, `free`, `df`, etc.)

## Features

- **Optimized Connections**: Multiple desklet instances share the same SSH connection
- **All Variables Supported**: CPU, RAM, Swap, HDD, GPU, Network monitoring
- **Intelligent Configuration**: No connection attempts until properly configured
- **Error Prevention**: Built-in validation prevents premature SSH attempts

## SSH Configuration Examples

### Basic Setup
```
SSH Host: user@remote-server.com
SSH Port: 22
```

### Custom Port
```
SSH Host: admin@192.168.1.50
SSH Port: 2222
```

### Advanced Setup
For best performance, configure SSH key-based authentication:
```bash
ssh-copy-id user@remote-server.com
```

## Troubleshooting

1. **"SSH: Sin configurar"** - Enter a valid SSH host
2. **Connection timeouts** - Check network connectivity and SSH service
3. **Permission denied** - Verify SSH credentials and key setup
4. **Missing data** - Ensure target system has required utilities installed

## Technical Details

The desklet uses SSH ControlMaster for connection optimization:
- Persistent connections (60 seconds)
- Automatic connection reuse
- Minimal overhead for multiple instances

Supported remote commands:
- CPU: `top -bn1`
- RAM/Swap: `free -m`
- HDD: `df -h`, `iostat`
- GPU: `nvidia-smi`, `rocm-smi`
- Network: `cat /proc/net/dev`


Each variable is calculated every `Refresh interval` seconds (Min. 1 s, Max. 60 s.), and the graph shows the last `Duration of the graph` period (Min. 30 s, Max. 60 min).

### Customizable visual elements
<p align="center">
<img src="https://cinnamon-spices.linuxmint.com/git/desklets/system-monitor-graph@rcassani/settings.png" width="700" align="middle"><br>
Settings for one instance of the system monitor graph Desklet.
</p>

### Screenshots
<p align="center">
<img src="https://cinnamon-spices.linuxmint.com/git/desklets/system-monitor-graph@rcassani/screenshot.png" width="900" align="middle"><br>
The Desklet is fully customizable.
</p>
<br>

<p align="center">
<img src="https://cinnamon-spices.linuxmint.com/git/desklets/system-monitor-graph@rcassani/screenshot2.png" width="900" align="middle"><br>
A simple screenshot.
</p>
<br>

<p align="center">
<img src="https://cinnamon-spices.linuxmint.com/git/desklets/system-monitor-graph@rcassani/screenshot3.png" width="900" align="middle"><br>
Another screenshot.
</p>


## TODO
- [ ] Add other variables such as CPU and GPU temperatures, battery levels for PC and peripherals.
- [x] ~~Add network monitoring support~~ (Completed in v2.0)
- [x] ~~Add SSH remote monitoring support~~ (Completed in v2.1)

### Resources
This is my first Desklet and the first time using JavaScript. Below, some resources that I used for the development of this Desklet.
* [cinnamon-spices-desklets](https://github.com/linuxmint/cinnamon-spices-desklets)
* [JavaScript Tutorial](https://www.w3schools.com/js/default.asp)
* [CJS: JavaScript bindings for Cinnamon](https://github.com/linuxmint/cjs)
* [CJS the importer](http://lira.epac.to:8080/doc/cinnamon/cinnamon-tutorials/importer.html)
* [Applet, desklet and extension settings reference](https://projects.linuxmint.com/reference/git/cinnamon-tutorials/xlet-settings.html)  and [here](https://projects.linuxmint.com/reference/git/cinnamon-tutorials/xlet-settings-ref.html)
* [GJS: JavaScript Bindings for GNOME](https://gitlab.gnome.org/GNOME/gjs/blob/master/doc/Home.md) and [here](https://gjs-docs.gnome.org/)
* [GJS examples](https://github.com/optimisme/gjs-examples)
* [Clutter API](https://gjs-docs.gnome.org/clutter4~4_api/)
* [Computing CPU usage](https://rosettacode.org/wiki/Linux_CPU_utilization)
* [Launching sequential processes from desklet](https://stackoverflow.com/questions/61147229/multiple-arguments-in-gio-subprocess)
* On [Cinnamon.get_file_contents_utf8_sync()](https://github.com/linuxmint/cinnamon-spices-desklets/issues/428)
* Default [`desklet.js` in Cinnamon](https://github.com/linuxmint/cinnamon/blob/master/js/ui/desklet.js)
* [Manual alpha blending](https://stackoverflow.com/questions/746899/how-to-calculate-an-rgb-colour-by-specifying-an-alpha-blending-amount)
* [Cairo documentation](https://www.cairographics.org/documentation/)
