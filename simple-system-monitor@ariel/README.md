## Simple system monitor
Shows some system status values.
- CPU usage
- Memory usage
- Network speed(Download, Upload)
- Temperature(CPU, GPU) see Tips

## Update history
1.1.0
- Add GPU Temperature.
- Adjust layout. (Labels: right to left, Values: left to right)
- Adjust value format to avoid wobbling. ("CPU" "Memory" fixed decimal point to 2 digits)
- Adjust value format to avoid wobbling. ("Download" "Upload" fixed decimal point to 1 digits in unit is "MB")

1.0.0
- Initial Release.

## Tips
**"Temperature" shows incorrect value**  

Edit `.local/share/cinnamon/desklets/simple-system-monitor@ariel/metadata.json`  
Specify a appropriate file path to `"thermal-file":`  

Example: Ryzen CPU is `"/sys/devices/pci0000:00/0000:00:18.3/hwmon/hwmon2/temp1_input"`

**"GPU" shows incorrect value**

Edit `.local/share/cinnamon/desklets/simple-system-monitor@ariel/metadata.json`  
Specify a appropriate file path to `"thermal-file-gpu":`   

Example: Radeon GPU is `"/sys/devices/pci0000:00/0000:00:03.1/0000:06:00.0/hwmon/hwmon1/temp1_input"`

**Change font color**

Edit `.local/share/cinnamon/desklets/simple-system-monitor@ariel/4.0/stylesheet.css`  
Add `"color:"` to `".mainContainer"`  

Example: `color: rgba(255, 144, 0, 1.0);`

**Change font size**

Edit `.local/share/cinnamon/desklets/simple-system-monitor@ariel/4.0/stylesheet.css`  
Add `"font-size:"` to `".mainContainer"`  

Example: `font-size: 1.2em;`

**Change background color**

Edit `.local/share/cinnamon/desklets/simple-system-monitor@ariel/4.0/stylesheet.css`  
Add `"background-color:"` to `".mainContainer"`  

Example: `background-color: rgba(90, 90, 90, 1.0);`

**Change background color to transparent**

Edit `.local/share/cinnamon/desklets/simple-system-monitor@ariel/metadata.json`  
Set `"prevent-decorations"` to `true`  

Example: `"prevent-decorations": true,`

**Back to previous layout**

Edit `.local/share/cinnamon/desklets/simple-system-monitor@ariel/4.0/stylesheet.css`  
Set `"text-align: right"` to `".title"`  
Set `"text-align: left"` to `".value"`  
