#!/usr/bin/env python3
"""
sysinfo-daemon.py — background stats collector for sysinfo@paul163-ai desklet.
Writes sysinfo-paul163.json to the system temp dir every INTERVAL seconds.
Launched automatically by the desklet. Uses a pidfile to prevent duplicates.
"""

import json, os, sys, time, glob, socket, signal, atexit, tempfile

INTERVAL   = 2
_TMP       = tempfile.gettempdir()
OUT_FILE   = os.path.join(_TMP, "sysinfo-paul163.json")
ATOMIC_TMP = OUT_FILE + ".tmp"
PID_FILE   = os.path.join(_TMP, "sysinfo-paul163.pid")

# ── pidfile: prevent duplicate instances ──────────────────────────────────

def check_pidfile():
    if os.path.exists(PID_FILE):
        try:
            pid = int(open(PID_FILE).read().strip())
            # Check if that process is still running
            os.kill(pid, 0)
            # It is — exit silently, we're a duplicate
            sys.exit(0)
        except (ProcessLookupError, ValueError):
            pass  # stale pidfile — continue
    # Write our own pid
    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))

def cleanup_pidfile():
    try:
        os.unlink(PID_FILE)
    except Exception:
        pass

def handle_signal(sig, frame):
    cleanup_pidfile()
    sys.exit(0)

# ── helpers ────────────────────────────────────────────────────────────────

def read(path, default=""):
    try:
        with open(path) as f:
            return f.read().strip()
    except Exception:
        return default

def fmt_bytes(b):
    b = max(0, b)
    if b < 1024:        return f"{b:.0f} B"
    if b < 1048576:     return f"{b/1024:.1f} KB"
    if b < 1073741824:  return f"{b/1048576:.1f} MB"
    return f"{b/1073741824:.2f} GB"

def fmt_gb(kb):
    return f"{kb/1048576:.2f} GB"

# ── static info (collected once at startup) ────────────────────────────────

def collect_static():
    import re
    static = {}
    static["hostname"] = read("/etc/hostname") or socket.gethostname()
    for line in read("/etc/os-release").splitlines():
        if line.startswith("PRETTY_NAME="):
            static["os_name"] = line.split("=", 1)[1].strip('"')
            break
    try:
        import subprocess
        static["kernel"] = subprocess.check_output(
            ["uname", "-r"], text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        static["kernel"] = ""
    cpuinfo = read("/proc/cpuinfo")
    for line in cpuinfo.splitlines():
        if line.startswith("model name"):
            name = line.split(":", 1)[1].strip()
            name = re.sub(r'Intel\(R\) Core\(TM\)\s*', '', name, flags=re.I)
            name = re.sub(r'AMD\s+', '', name, flags=re.I)
            name = re.sub(r' CPU\b', '', name, flags=re.I)
            name = re.sub(r' @ [\d.]+GHz', '', name, flags=re.I)
            name = re.sub(r'\s+\d+-Core\s+Processor', '', name, flags=re.I)
            name = re.sub(r'\s+Processor$', '', name, flags=re.I)
            static["cpu_model"] = name.strip()
            break
    static["cpu_threads"] = str(cpuinfo.count("processor\t:"))
    return static

# ── dynamic collectors ─────────────────────────────────────────────────────

_cpu_prev_total = 0
_cpu_prev_idle  = 0

def collect_cpu():
    global _cpu_prev_total, _cpu_prev_idle
    result = {}
    line = read("/proc/stat").splitlines()[0]
    nums = list(map(int, line.split()[1:]))
    total = sum(nums)
    idle  = nums[3]
    if _cpu_prev_total:
        dT = total - _cpu_prev_total
        dI = idle  - _cpu_prev_idle
        if dT > 0:
            pct = 100 * (dT - dI) / dT
            result["cpu_pct"] = f"{pct:.1f}%"
            result["cpu_bar"] = round(pct)
    _cpu_prev_total = total
    _cpu_prev_idle  = idle
    freqs = []
    for p in glob.glob("/sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_cur_freq"):
        v = read(p)
        if v:
            freqs.append(int(v))
    if freqs:
        result["cpu_freq"] = f"{sum(freqs)/len(freqs)/1e6:.2f} GHz"
    best_temp = 0
    pkg_temp  = None
    for zone_dir in glob.glob("/sys/class/thermal/thermal_zone*"):
        ztype = read(f"{zone_dir}/type")
        ztemp = read(f"{zone_dir}/temp")
        if not ztemp:
            continue
        t = int(ztemp)
        if ztype == "x86_pkg_temp":
            pkg_temp = t
        if t > best_temp:
            best_temp = t
    val = pkg_temp if pkg_temp is not None else best_temp
    if val:
        result["cpu_temp"] = f"{val//1000}°C"
    return result

def collect_mem():
    kv = {}
    for line in read("/proc/meminfo").splitlines():
        parts = line.split(":")
        if len(parts) == 2:
            kv[parts[0].strip()] = int(''.join(filter(str.isdigit, parts[1])) or 0)
    total     = kv.get("MemTotal", 0)
    avail     = kv.get("MemAvailable", 0)
    used      = total - avail
    buf       = kv.get("Buffers", 0) + kv.get("Cached", 0)
    swap_tot  = kv.get("SwapTotal", 0)
    swap_free = kv.get("SwapFree", 0)
    swap_used = swap_tot - swap_free
    return {
        "ram":      f"{fmt_gb(used)} / {fmt_gb(total)}",
        "ram_bar":  round(used/total*100) if total else 0,
        "swap":     f"{fmt_gb(swap_used)} / {fmt_gb(swap_tot)}",
        "swap_bar": round(swap_used/swap_tot*100) if swap_tot else 0,
        "cache":    fmt_gb(buf),
    }

def collect_uptime():
    raw = read("/proc/uptime").split()
    if not raw:
        return {}
    secs = float(raw[0])
    d = int(secs // 86400)
    h = int((secs % 86400) // 3600)
    m = int((secs % 3600) // 60)
    s = int(secs % 60)
    uptime_str = (f"{d}d " if d else "") + f"{h}h {m}m {s}s"
    parts = read("/proc/loadavg").split()
    load_str  = f"{parts[0]}  {parts[1]}  {parts[2]}" if len(parts) >= 3 else "--"
    procs_str = "--"
    if len(parts) >= 4:
        pp = parts[3].split("/")
        procs_str = f"{pp[1]} total, {pp[0]} running" if len(pp) == 2 else "--"
    return {"uptime": uptime_str, "load": load_str, "procs": procs_str}

_net_prev_time = 0
_net_prev_rx   = 0
_net_prev_tx   = 0

def collect_network():
    global _net_prev_time, _net_prev_rx, _net_prev_tx
    result = {}
    total_rx = total_tx = 0
    for line in read("/proc/net/dev").splitlines()[2:]:
        parts = line.strip().split()
        if len(parts) < 10:
            continue
        iface = parts[0].rstrip(":")
        if iface == "lo":
            continue
        total_rx += int(parts[1])
        total_tx += int(parts[9])
    now = time.monotonic()
    if _net_prev_time > 0:
        elapsed = now - _net_prev_time
        if elapsed > 0:
            dn = max(0, (total_rx - _net_prev_rx) / elapsed)
            up = max(0, (total_tx - _net_prev_tx) / elapsed)
            result["net_down"] = f"↓ {fmt_bytes(dn)}/s"
            result["net_up"]   = f"↑ {fmt_bytes(up)}/s"
    result["net_rx"] = fmt_bytes(total_rx)
    result["net_tx"] = fmt_bytes(total_tx)
    _net_prev_time = now
    _net_prev_rx   = total_rx
    _net_prev_tx   = total_tx
    return result

def collect_disks(paths):
    result = {}
    for p in paths:
        try:
            st = os.statvfs(p)
            total = st.f_blocks * st.f_frsize
            free  = st.f_bfree  * st.f_frsize
            used  = total - free
            pct   = round(used / total * 100) if total else 0
            result[f"disk_{p}"]     = f"{used/1e9:.1f} / {total/1e9:.1f} GB"
            result[f"disk_{p}_bar"] = pct
        except Exception:
            pass
    return result

def collect_battery():
    result = {}
    bats = glob.glob("/sys/class/power_supply/BAT*")
    if not bats:
        result["bat_pct"]  = "N/A"
        result["bat_stat"] = "No battery"
        return result
    bat = bats[0]
    cap  = read(f"{bat}/capacity")
    stat = read(f"{bat}/status")
    if cap:
        result["bat_pct"] = f"{cap}%"
        result["bat_bar"] = int(cap)
    result["bat_stat"] = stat or "--"
    try:
        if stat in ("Discharging", "Charging"):
            if os.path.exists(f"{bat}/charge_now") and os.path.exists(f"{bat}/current_now"):
                now  = int(read(f"{bat}/charge_now")  or 0)
                full = int(read(f"{bat}/charge_full") or 0)
                cur  = int(read(f"{bat}/current_now") or 0)
            elif os.path.exists(f"{bat}/energy_now") and os.path.exists(f"{bat}/power_now"):
                now  = int(read(f"{bat}/energy_now")  or 0)
                full = int(read(f"{bat}/energy_full") or 0)
                cur  = int(read(f"{bat}/power_now")   or 0)
            else:
                cur = 0
            if cur > 0:
                mins = int((now/cur*60) if stat == "Discharging" else ((full-now)/cur*60))
                result["bat_time"] = f"{mins//60}h {mins%60}m"
    except Exception:
        pass
    return result

def collect_gpu():
    try:
        import subprocess
        out = subprocess.check_output(
            ["nvidia-smi",
             "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
             "--format=csv,noheader,nounits"],
            text=True, stderr=subprocess.DEVNULL, timeout=3).strip()
        import re
        parts = [p.strip() for p in out.split(",")]
        if len(parts) < 5:
            return {}
        name = re.sub(r'NVIDIA GeForce ', '', parts[0], flags=re.I)
        name = re.sub(r'NVIDIA ', '', name, flags=re.I)
        usage     = int(parts[1])
        vram_used = float(parts[2])
        vram_tot  = float(parts[3])
        temp      = int(parts[4])
        return {
            "gpu_name": name,
            "gpu_pct":  f"{usage}%",
            "gpu_bar":  usage,
            "gpu_vram": f"{vram_used/1024:.2f} / {vram_tot/1024:.2f} GB",
            "gpu_temp": f"{temp}°C",
        }
    except Exception:
        return {"gpu_name": "N/A"}

# ── main loop ──────────────────────────────────────────────────────────────

def main():
    check_pidfile()
    atexit.register(cleanup_pidfile)
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT,  handle_signal)

    static = collect_static()
    tick   = 0

    # Collect disk paths from settings if possible, else defaults
    disk_paths = sys.argv[1:] if len(sys.argv) > 1 else ["/"]

    while True:
        start = time.monotonic()
        tick += 1

        data = {"static": static}
        data.update(collect_cpu())
        data.update(collect_mem())
        data.update(collect_uptime())
        data.update(collect_network())
        data.update(collect_disks(disk_paths))

        if tick % 3 == 0:
            data.update(collect_battery())
        if tick % 5 == 0:
            data.update(collect_gpu())

        try:
            with open(ATOMIC_TMP, "w") as f:
                json.dump(data, f)
            os.replace(ATOMIC_TMP, OUT_FILE)
        except Exception as e:
            pass

        elapsed = time.monotonic() - start
        time.sleep(max(0, INTERVAL - elapsed))

if __name__ == "__main__":
    main()
