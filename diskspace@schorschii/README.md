# Disk Space Desklet
- displays the usage of a filesystem, swap or RAM
- monitors MD RAID and ZFS pool status (optional)
- thick, thin and compact design

## Installation
- please make sure the "Ubuntu" font is installed

## Remote File System
You can also monitor a remote filesystem (via SSH/SMB). You only need to mount the filesystem from within your file manager (e.g. Nemo) and set the "Filesystem to be monitored" in the desklet seetings to the mount point of the remote file system.

## RAID / ZFS Monitor
Enable "Show RAID / ZFS status" in the settings to automatically detect if your filesystem resides on an MD RAID array or ZFS pool.

- **MD RAID**: Reads status from `/sys/block/mdX/md/` — shows state (clean, resync, degraded, etc.) and rebuild progress
- **ZFS**: Uses `zpool status -j` — shows pool state and scrub/resilver progress

Status indicator:
- ✓ = healthy
- ⚠ = warning (rebuilding, degraded)
- ✗ = error (faulted, offline)

Requirements:
- Python 3 (standard on most Linux systems)
- `zfsutils-linux` package (for ZFS monitoring, optional)
