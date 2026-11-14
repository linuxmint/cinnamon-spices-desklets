# NVIDIA GPU & CPU Monitor & Fan Control

A Cinnamon desklet that displays GPU temperature, CPU temperature, and GPU fan speed, with manual fan control buttons (Auto / 100%).
It was entirely vibe coded so any feedback is welcomed!

## Requirements
- NVIDIA proprietary drivers
- To use manual fan control (100%), you must enable Coolbits in Xorg configuration:
  `sudo nvidia-xconfig --cool-bits=4`
