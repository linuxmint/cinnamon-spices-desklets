# System monitor graph Desklet
Desklet to show graphs for the level of activity in various system variables including: CPU, memory, network and disks. The desklet supports multiple instances with different system variables with the idea of presenting them in a uniform way.

<p align="center">
<img src="https://cinnamon-spices.linuxmint.com/git/desklets/system-monitor-graph@rcassani/simple.gif" width="400" align="middle"><br>
Four instances of the Desklet in action.
</p>


This project has been inspired from other Desklets such as [Disk Space](https://cinnamon-spices.linuxmint.com/desklets/view/39), [CPU Load](https://cinnamon-spices.linuxmint.com/desklets/view/44), [Simple system monitor](https://cinnamon-spices.linuxmint.com/desklets/view/29), [Network usage monitor](https://cinnamon-spices.linuxmint.com/desklets/view/15), [Top](https://cinnamon-spices.linuxmint.com/desklets/view/41), and the  [Rainmeter Win10 Widgets](https://win10widgets.com/).

## Features
### Variables to monitor (v2.0 - July 2025)

| System variable | Description |
| -----------     | ----------- |
| CPU             | CPU usage in % |
| RAM             | Used RAM as % of total, and in GB |
| Swap            | Used Swap space as % of total, and in GB |
| HDD             | % of I/O activity, and free and total space in the filesystem (partition)  indicated by the user |
| GPU Usage       | GPU usage in % |
| GPU Memory      | GPU memory usage in % |
| Network         | Real-time upload and download speeds with dual-line graph, configurable interface monitoring |

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
- [ ] Add other variables such as ~~network~~, CPU and GPU temperatures, battery levels for PC and peripherals.

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
