# NVIDIA GPU Monitor Desklet

A real-time GPU monitoring desklet for Cinnamon desktop that displays GPU compute usage, memory usage, and optionally temperature over time. Multi-GPU support is currently untested.

## Features

- **Real-time monitoring** of GPU compute and memory usage
- **Multi-GPU support** - choose which GPU to monitor
- **Temperature monitoring** (optional)
- **Historical graphs** with configurable data retention
- **Customizable appearance** - colors, transparency, size
- **Percentage labels** on Y-axis for easy reading
- **Smooth animations** and hover effects
- **Error handling** with graceful degradation

## Requirements

- NVIDIA GPU
- `nvidia-smi` command-line utility installed
- Cinnamon desktop environment

## Configuration

Right-click the desklet and select "Configure" to access settings:

- **Update Interval**: How often to sample GPU data (0.1-10 seconds)
- **Data Points**: Historical data to keep (60-3600 points)
- **GPU Selection**: Choose which GPU to monitor
- **Colors**: Customize compute, memory, temperature, background colors
- **Size**: Adjust desklet dimensions
- **Display Options**: Show/hide legend and temperature

## Usage

The desklet shows:
- Real-time GPU usage percentage in the title
- Historical graph with percentage grid lines
- Color-coded lines for compute (blue), memory (orange), temperature (red)
- GPU name and current values in the title bar

## Troubleshooting

- **"NVIDIA GPU: Not Available"** - Ensure nvidia-smi is installed and working
- **No data** - Check GPU index setting matches your system
- **High CPU usage** - Increase update interval in settings

## Version History

- v1.0.0 - Initial release

## License

Open source - feel free to modify and share!
