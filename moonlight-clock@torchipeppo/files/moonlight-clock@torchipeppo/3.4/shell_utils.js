// mostly (C) brightness-and-gamma-applet@cardsurf (GPL license)
// I did a little conversion and adaptation, also removed what I didn't need

const GLib = imports.gi.GLib;


class ShellOutputProcess {
        
    // bytearray_converter is a FileHandler, which was named earlier in development
    constructor(command_argv, bytearray_converter) {
        this.command_argv = command_argv;
        this.flags = GLib.SpawnFlags.SEARCH_PATH;
        this.success = false;
        this.standard_output_content = "";
        this.standard_error_content = "";
        this.pid = -1;
        this.standard_input_file_descriptor = -1;
        this.standard_output_file_descriptor = -1;
        this.standard_error_file_descriptor = -1;
        this.bytearray_converter = bytearray_converter;
    }

    spawn_sync_and_get_output() {
        this.spawn_sync();
        let output = this.get_standard_output_content();
        return output;
    }

    spawn_sync() {
        let [success, standard_output_content, standard_error_content] = GLib.spawn_sync(
            null,
            this.command_argv,
            null,
            this.flags,
            null);
        this.success = success;
        this.standard_output_content = standard_output_content;
        this.standard_error_content = standard_error_content;
    }

    get_standard_output_content() {
        return this.bytearray_converter.byte_array_to_string(this.standard_output_content);
    }

    spawn_sync_and_get_error() {
        this.spawn_sync();
        let output = this.get_standard_error_content();
        return output;
    }

    get_standard_error_content() {
        return this.bytearray_converter.byte_array_to_string(this.standard_error_content);
    }

    spawn_async() {
        let [success, pid, standard_input_file_descriptor,
             standard_output_file_descriptor, standard_error_file_descriptor] = GLib.spawn_async_with_pipes(
             null,
             this.command_argv,
             null,
             this.flags,
             null);

        this.success = success;
        this.pid = pid;
        this.standard_input_file_descriptor = standard_input_file_descriptor;
        this.standard_output_file_descriptor = standard_output_file_descriptor;
        this.standard_error_file_descriptor = standard_error_file_descriptor;
    }

};
