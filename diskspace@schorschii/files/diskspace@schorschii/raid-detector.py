#!/usr/bin/env python3
"""
RAID and ZFS status detector for diskspace@schorschii Cinnamon desklet.

Given a filesystem path, automatically detects if it resides on MD RAID or ZFS
and returns the status.

Usage:
    python3 raid-detector.py /path/to/filesystem

Output (JSON):
    {
        "detected": "mdraid" | "zfs" | "none",
        "mdraid": { ... },       // only if detected == "mdraid"
        "zfs": { ... },          // only if detected == "zfs"
        "status": "ok" | "warning" | "error",
        "message": "..."
    }
"""

import json
import os
import sys
import subprocess
import re
from pathlib import Path


def find_block_device(mount_point):
    """Find the underlying block device for a mount point."""
    try:
        result = subprocess.run(
            ["findmnt", "-n", "-o", "SOURCE", mount_point],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Fallback: parse /proc/mounts
    try:
        mounts = Path("/proc/mounts").read_text()
        for line in mounts.splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[1] == mount_point:
                return parts[0]
    except FileNotFoundError:
        pass

    return None


def get_mdraid_status(device):
    """Get MD RAID status from sysfs for a given block device."""
    # Normalize device: /dev/md0 -> md0, /dev/md0p1 -> md0, /dev/md/raid0 -> md/raid0
    dev_name = device.replace("/dev/", "")

    # Extract MD device name, stripping partition suffix (e.g., md0p1 -> md0)
    md_match = re.match(r'(md\d+)', dev_name)
    if not md_match:
        return None
    dev_name = md_match.group(1)

    sysfs_path = Path(f"/sys/block/{dev_name}/md")
    if not sysfs_path.exists():
        return None

    result = {
        "device": dev_name,
        "state": "unknown",
        "progress": 0,
        "speed": "",
        "degraded": 0,
        "total_disks": 0,
        "raid_level": "unknown"
    }

    try:
        result["state"] = (sysfs_path / "array_state").read_text().strip()
    except (IOError, OSError) as e:
        result["state"] = "error"
        result["message"] = str(e)
        return result

    # Read individual values - each in its own try/except
    try:
        result["degraded"] = int((sysfs_path / "degraded").read_text().strip())
    except (ValueError, FileNotFoundError, IOError, OSError):
        pass

    try:
        result["total_disks"] = int((sysfs_path / "raid_disks").read_text().strip())
    except (ValueError, FileNotFoundError, IOError, OSError):
        pass

    try:
        result["raid_level"] = (sysfs_path / "level").read_text().strip()
    except (FileNotFoundError, IOError, OSError):
        pass

    # Read sync action and progress
    try:
        sync_action = (sysfs_path / "sync_action").read_text().strip()
    except (FileNotFoundError, IOError, OSError):
        sync_action = "idle"

    if sync_action != "idle":
        result["state"] = sync_action
        # Read progress from /proc/mdstat
        try:
            mdstat = Path("/proc/mdstat").read_text()
            match = re.search(r'\[.*?\]\s+([\d.]+)%', mdstat)
            if match:
                result["progress"] = float(match.group(1))
            speed_match = re.search(r'speed=\s*(\d+)K/sec', mdstat)
            if speed_match:
                speed_k = int(speed_match.group(1))
                if speed_k >= 1024:
                    result["speed"] = str(round(speed_k / 1024, 1)) + " MB/s"
                else:
                    result["speed"] = str(speed_k) + " KB/s"
        except (FileNotFoundError, IOError, OSError):
            pass

    return result


def get_zfs_status(mount_point):
    """Check if mount_point is on a ZFS pool and get status."""
    try:
        result = subprocess.run(
            ["zfs", "get", "-H", "-o", "value", "name", mount_point],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode != 0:
            return None

        dataset = result.stdout.strip()
        if not dataset or dataset == "-":
            return None

        # Get pool name (first component of dataset)
        pool = dataset.split("/")[0]

        # Get pool status
        proc = subprocess.run(
            ["zpool", "status", "-j", pool],
            capture_output=True, text=True, timeout=10
        )

        zfs_result = {
            "pool": pool,
            "dataset": dataset,
            "state": "unknown",
            "scan": {
                "type": "none",
                "state": "none",
                "progress": 0,
                "eta": ""
            }
        }

        if proc.returncode != 0:
            zfs_result["state"] = "error"
            zfs_result["message"] = proc.stderr.strip()
            return zfs_result

        zfs_data = json.loads(proc.stdout)

        # zpool status -j wraps pools under "pools" key
        pools = zfs_data.get("pools", zfs_data)
        if pool not in pools:
            zfs_result["state"] = "unknown"
            return zfs_result

        pool_data = pools[pool]
        zfs_result["state"] = pool_data.get("state", "unknown")

        # Handle both "scan" (older) and "scan_stats" (newer) formats
        scan = pool_data.get("scan_stats", pool_data.get("scan", {}))
        if scan and scan.get("state") not in ("none", None, ""):
            # "function" in scan_stats maps to "type" in scan
            zfs_result["scan"]["type"] = (scan.get("function") or scan.get("type", "unknown")).lower()
            scan_state = scan.get("state", "unknown").lower()
            # Map scan states
            if scan_state == "scanning":
                zfs_result["scan"]["state"] = "in_progress"
            elif scan_state in ("finished", "completed"):
                zfs_result["scan"]["state"] = "completed"
            else:
                zfs_result["scan"]["state"] = scan_state

            # Progress from scan_stats
            if "stats" in scan:
                stats = scan["stats"]
                total = stats.get("total", 0)
                processed = stats.get("processed", 0)
                if total > 0:
                    zfs_result["scan"]["progress"] = round((processed / total) * 100, 1)
            elif "to_examine" in scan and "examined" in scan:
                # Alternative: calculate from to_examine/examined strings like "2.80T"
                pass  # Would need string parsing, skip for now

            # ETA
            if "eta" in scan:
                zfs_result["scan"]["eta"] = scan["eta"]

        return zfs_result

    except FileNotFoundError:
        return None
    except subprocess.TimeoutExpired:
        return None
    except json.JSONDecodeError:
        return None
    except Exception:
        return None


def get_btrfs_status(mount_point):
    """Check if mount_point is a Btrfs filesystem with RAID profile."""
    try:
        # Check filesystem type
        result = subprocess.run(
            ["findmnt", "-n", "-o", "FSTYPE", mount_point],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode != 0 or result.stdout.strip() != "btrfs":
            return None

        # Get RAID profile from btrfs filesystem df
        df_result = subprocess.run(
            ["btrfs", "filesystem", "df", mount_point],
            capture_output=True, text=True, timeout=5
        )
        if df_result.returncode != 0:
            return None

        btrfs_result = {
            "mount": mount_point,
            "state": "ok",
            "data_profile": "unknown",
            "metadata_profile": "unknown",
            "devices": 0,
            "errors": 0
        }

        # Parse RAID profiles from df output
        # Example: "Data, RAID1: total=1.80TiB, used=1.20TiB"
        for line in df_result.stdout.splitlines():
            line = line.strip()
            if line.startswith("Data,"):
                profile = line.split(",")[1].split(":")[0].strip()
                btrfs_result["data_profile"] = profile
            elif line.startswith("Metadata,"):
                profile = line.split(",")[1].split(":")[0].strip()
                btrfs_result["metadata_profile"] = profile

        # Count devices
        show_result = subprocess.run(
            ["btrfs", "filesystem", "show", mount_point],
            capture_output=True, text=True, timeout=5
        )
        if show_result.returncode == 0:
            device_count = 0
            for line in show_result.stdout.splitlines():
                if line.strip().startswith("devid"):
                    device_count += 1
            btrfs_result["devices"] = device_count

        # Check device errors
        stats_result = subprocess.run(
            ["btrfs", "device", "stats", mount_point],
            capture_output=True, text=True, timeout=5
        )
        if stats_result.returncode == 0:
            for line in stats_result.stdout.splitlines():
                # Example: "/dev/sda1, write_errors:0, read_errors:0, flush_errors:0, corruption_errors:0, generation_errors:0"
                for part in line.split(","):
                    part = part.strip()
                    if "_errors:" in part:
                        try:
                            count = int(part.split(":")[1])
                            btrfs_result["errors"] += count
                        except (ValueError, IndexError):
                            pass

        # Determine state
        if btrfs_result["errors"] > 0:
            btrfs_result["state"] = "warning"

        return btrfs_result

    except FileNotFoundError:
        return None
    except subprocess.TimeoutExpired:
        return None
    except Exception:
        return None


def determine_status(mdraid, zfs, btrfs):
    """Determine overall status."""
    if mdraid:
        state = mdraid.get("state", "")
        if state == "error":
            return "error"
        elif state in ("resync", "recover", "reshape", "check"):
            return "warning"
        elif mdraid.get("degraded", 0) > 0:
            return "warning"
        elif state not in ("clean", "active"):
            return "warning"

    if zfs:
        state = zfs.get("state", "")
        if state in ("FAULTED", "OFFLINE"):
            return "error"
        elif state == "DEGRADED":
            return "warning"
        elif zfs.get("scan", {}).get("state") == "in_progress":
            return "warning"

    if btrfs:
        if btrfs.get("errors", 0) > 0:
            return "warning"

    return "ok"


def generate_message(mdraid, zfs, btrfs, status):
    """Generate user-friendly status message."""
    if status == "ok":
        if mdraid:
            level = mdraid.get("raid_level", "unknown")
            return mdraid["device"] + " (" + level + ") - OK"
        elif zfs:
            return "ZFS " + zfs["pool"] + " - ONLINE"
        elif btrfs:
            return "Btrfs " + btrfs["data_profile"] + " - OK"
        return "OK"

    if status == "warning":
        parts = []
        if mdraid:
            state = mdraid.get("state", "")
            if state in ("resync", "recover", "reshape", "check"):
                parts.append(mdraid["device"] + ": " + state + " (" + str(round(mdraid["progress"], 1)) + "%)")
            elif mdraid.get("degraded", 0) > 0:
                parts.append(mdraid["device"] + ": degraded (" + str(mdraid["degraded"]) + " disk(s))")
        if zfs:
            if zfs.get("scan", {}).get("state") == "in_progress":
                scan = zfs["scan"]
                parts.append("ZFS " + zfs["pool"] + ": " + scan["type"] + " (" + str(round(scan["progress"], 1)) + "%)")
            elif zfs.get("state") == "DEGRADED":
                parts.append("ZFS " + zfs["pool"] + ": degraded")
        if btrfs and btrfs.get("errors", 0) > 0:
            parts.append("Btrfs: " + str(btrfs["errors"]) + " errors")
        return "; ".join(parts) if parts else "Warning"

    parts = []
    if mdraid and mdraid.get("state") == "error":
        parts.append(mdraid["device"] + ": " + mdraid.get("message", "error"))
    if zfs and zfs.get("state") in ("FAULTED", "OFFLINE", "error"):
        parts.append("ZFS " + zfs["pool"] + ": " + zfs["state"])
    return "; ".join(parts) if parts else "Error"


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"detected": "none", "status": "ok", "message": "No path given"}))
        sys.exit(0)

    mount_point = sys.argv[1]
    if not os.path.exists(mount_point):
        mount_point = "/"

    output = {
        "detected": "none",
        "status": "ok",
        "message": ""
    }

    # Find underlying block device
    block_device = find_block_device(mount_point)

    # Check MD RAID
    if block_device:
        mdraid = get_mdraid_status(block_device)
        if mdraid:
            output["detected"] = "mdraid"
            output["mdraid"] = mdraid

    # Check ZFS
    zfs = get_zfs_status(mount_point)
    if zfs:
        if output["detected"] == "none":
            output["detected"] = "zfs"
        output["zfs"] = zfs

    # Check Btrfs RAID
    btrfs = get_btrfs_status(mount_point)
    if btrfs:
        if output["detected"] == "none":
            output["detected"] = "btrfs"
        output["btrfs"] = btrfs

    output["status"] = determine_status(
        output.get("mdraid"),
        output.get("zfs"),
        output.get("btrfs")
    )
    output["message"] = generate_message(
        output.get("mdraid"),
        output.get("zfs"),
        output.get("btrfs"),
        output["status"]
    )

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
