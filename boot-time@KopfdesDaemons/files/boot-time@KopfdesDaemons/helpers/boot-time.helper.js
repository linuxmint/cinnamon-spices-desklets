const GLib = imports.gi.GLib;

class BootTimeHelper {
  static async getBootTime() {
    const out = await new Promise((resolve, reject) => {
      try {
        let [success, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
          null,
          ["sh", "-c", "LC_ALL=C systemd-analyze"],
          null,
          GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
          null
        );
        GLib.close(stdin);
        GLib.close(stderr);
        GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, (pid, status) => {
          GLib.spawn_close_pid(pid);
        });
        let channel = GLib.IOChannel.unix_new(stdout);
        let output = "";
        GLib.io_add_watch(channel, GLib.PRIORITY_DEFAULT, GLib.IOCondition.IN | GLib.IOCondition.HUP, (channel, condition) => {
          if (condition & GLib.IOCondition.IN) {
            let [status, data] = channel.read_to_end();
            if (data) output += data.toString();
          }
          if (condition & GLib.IOCondition.HUP) {
            channel.shutdown(true);
            resolve(output);
            return false;
          }
          return true;
        });
      } catch (e) {
        reject(e);
      }
    });
    if (out) {
      const bootNotFinishedRegex = /Bootup is not yet finished/;
      if (out.match(bootNotFinishedRegex)) throw new Error("Bootup is not yet finished");

      const timeRegex = /((?:\d+min\s+)?[\d.]+s)/;

      const firmware = out.match(new RegExp(`${timeRegex.source}\\s+\\(firmware\\)`));
      const loader = out.match(new RegExp(`${timeRegex.source}\\s+\\(loader\\)`));
      const kernel = out.match(new RegExp(`${timeRegex.source}\\s+\\(kernel\\)`));
      const userspace = out.match(new RegExp(`${timeRegex.source}\\s+\\(userspace\\)`));
      const total = out.match(new RegExp(`=\\s+${timeRegex.source}`));
      const graphical = out.match(new RegExp(`graphical\\.target reached after\\s+${timeRegex.source}`));

      return [
        { name: "Firmware", label: _("Firmware:"), value: firmware ? firmware[1] : null },
        { name: "Loader", label: _("Loader:"), value: loader ? loader[1] : null },
        { name: "Kernel", label: _("Kernel:"), value: kernel ? kernel[1] : null },
        { name: "Userspace", label: _("Userspace:"), value: userspace ? userspace[1] : null },
        { name: "Total", label: _("Total:"), value: total ? total[1] : null },
        { name: "Graphical", label: _("Graphical:"), value: graphical ? graphical[1] : null },
      ];
    }
    throw new Error("No output");
  }
}
