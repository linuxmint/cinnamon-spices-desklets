#!/usr/bin/env python3
"""Per-app CPU usage sampler for the power-users desklet. Prints JSON.

CPU time of every process is diffed against the previous call (state kept in
~/.cache/power-users.json), so the window is "since last call". Processes are
grouped into apps by climbing the parent chain until a shell, terminal or the
session manager is reached. Short-lived processes that exit between two calls
are not seen, so numbers are a lower bound.
"""

import json
import os
import sys
import time

CLK = os.sysconf("SC_CLK_TCK")
STATE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "power-users@malnon-labs.json")
PS = "/sys/class/power_supply"
STOP = {"systemd", "cinnamon", "cinnamon-sessio", "cinnamon-launc", "init", "bash", "fish",
        "zsh", "sh", "dash", "gnome-terminal-", "sshd", "login", "dbus-daemon", "(sd-pam)",
        "tmux: server", "screen", "xdg-desktop-por", "lightdm", "cinnamon-launch",
        "gdm", "sddm", "gnome-session-b", "gnome-shell", "plasmashell", "xfce4-session",
        "mate-session", "lxsession", "systemd-logind", "kwin_x11", "kwin_wayland"}
ALIAS = {"firefox-bin": "Firefox", "firefox": "Firefox",
         "Xorg": "Display server (Xorg)", "cinnamon": "Cinnamon desktop",
         "brave": "Brave", "code": "VS Code", "codium": "VSCodium", "steam": "Steam",
         "rsync": "rsync / backup", "timeshift": "Timeshift", "gnome-terminal-": "Terminal"}


def snapshot():
    procs = {}
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            with open(f"/proc/{name}/stat") as f:
                raw = f.read()
        except OSError:
            continue
        head, _, rest = raw.rpartition(")")
        comm = head.split("(", 1)[1]
        p = rest.split()
        try:
            procs[int(name)] = {"comm": comm, "ppid": int(p[1]), "jiff": int(p[11]) + int(p[12]),
                                "start": p[19]}
        except (IndexError, ValueError):
            continue
    return procs


def root_of(pid, procs):
    seen = 0
    while seen < 30:
        parent = procs[pid]["ppid"]
        if parent <= 1 or parent not in procs or procs[parent]["comm"] in STOP:
            return pid
        pid = parent
        seen += 1
    return pid


def label(pid, procs):
    comm = procs[pid]["comm"]
    if procs[pid]["ppid"] == 2 or pid == 2:
        return "Kernel threads"
    if comm in ALIAS:
        return ALIAS[comm]
    if comm.startswith("python"):
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                args = [a.decode(errors="replace") for a in f.read().split(b"\0") if a]
            for a in args[1:]:
                if not a.startswith("-"):
                    return os.path.basename(a)
        except OSError:
            pass
    return comm


def find_bat():
    try:
        for n in sorted(os.listdir(PS)):
            with open(f"{PS}/{n}/type") as f:
                if f.read().strip() != "Battery":
                    continue
            try:
                with open(f"{PS}/{n}/scope") as f:
                    if f.read().strip() == "Device":
                        continue
            except OSError:
                pass
            return n
    except OSError:
        pass
    return None


BAT = find_bat()


def read_bat(name):
    if not BAT:
        return ""
    try:
        with open(f"{PS}/{BAT}/{name}") as f:
            return f.read().strip()
    except OSError:
        return ""


def watts():
    p = int(read_bat("power_now") or 0)
    if p:
        return p / 1e6
    i, v = int(read_bat("current_now") or 0), int(read_bat("voltage_now") or 0)
    return abs(i) * v / 1e12


def main():
    now = time.time()
    cur = snapshot()
    prev = None
    try:
        with open(STATE) as f:
            prev = json.load(f)
        if now - prev["t"] > 600 or now - prev["t"] < 1:
            prev = None
    except (OSError, ValueError, KeyError):
        prev = None
    if prev is None:
        time.sleep(3)
        old, t0 = cur, now
        cur, now = snapshot(), time.time()
    else:
        old = {int(k.split(":")[0]): {"jiff": v, "start": k.split(":")[1]} for k, v in prev["procs"].items()}
        t0 = prev["t"]
    window = max(now - t0, 0.5)

    groups = {}
    for pid, p in cur.items():
        o = old.get(pid)
        if not o or o["start"] != p["start"]:
            continue
        delta = p["jiff"] - o["jiff"]
        if delta <= 0:
            continue
        root = root_of(pid, cur)
        g = groups.setdefault(label(root, cur), {"jiff": 0, "pids": 0})
        g["jiff"] += delta
        g["pids"] += 1

    try:
        with open(STATE, "w") as f:
            json.dump({"t": now, "procs": {f"{pid}:{p['start']}": p["jiff"] for pid, p in cur.items()}}, f)
    except OSError:
        pass

    rows = [{"name": n, "cpu": g["jiff"] / CLK / window * 100, "pids": g["pids"]} for n, g in groups.items()]
    rows = sorted([r for r in rows if r["cpu"] >= 0.3], key=lambda r: -r["cpu"])[:10]
    power = watts()
    print(json.dumps({"has_battery": BAT is not None, "discharging": read_bat("status") == "Discharging", "power_w": power,
                      "window": window, "total_cpu": sum(r["cpu"] for r in rows), "rows": rows}))


if __name__ == "__main__":
    main()
