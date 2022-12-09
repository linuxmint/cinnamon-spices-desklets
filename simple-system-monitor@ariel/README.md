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

edit `.local/share/cinnamon/desklets/simple-system-monitor@ariel/metadata.json`  
specify a appropriate file path to `"thermal-file":`  

example: Ryzen CPU is `"/sys/devices/pci0000:00/0000:00:18.3/hwmon/hwmon3/temp1_input"`

**"GPU" shows incorrect value**

edit `.local/share/cinnamon/desklets/simple-system-monitor@ariel/metadata.json`  
specify a appropriate file path to `"thermal-file-gpu":`   

example: Radeon GPU is `"/sys/devices/pci0000:00/0000:00:03.1/0000:06:00.0/hwmon/hwmon1/temp1_input"`

**Change font color**

edit `.local/share/cinnamon/desklets/simple-system-monitor@ariel/4.0/stylesheet.css`  
add `"color:"` to `".mainContainer"`  

example: `color: rgba(255, 144, 0, 1.0);`

**Change font size**

edit `.local/share/cinnamon/desklets/simple-system-monitor@ariel/4.0/stylesheet.css`  
add `"font-size:"` to `".mainContainer"`  

example: `font-size: 1.2em;`

**Change background color**

edit `.local/share/cinnamon/desklets/simple-system-monitor@ariel/4.0/stylesheet.css`  
add `"background-color:"` to `".mainContainer"`  

example: `background-color: rgba(90, 90, 90, 1.0);`

**Change background color to transparent**

edit `.local/share/cinnamon/desklets/simple-system-monitor@ariel/metadata.json`  
set `"prevent-decorations"` to `true`  

example: `"prevent-decorations": true,`
