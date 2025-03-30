const GLib = imports.gi.GLib;

// making this a class just to keep a door open in the off-chance that
// the encoding of the text files needs to be configurable
class FileHandlerBase {
    constructor(uuid, desklet_id) {
        this.uuid = uuid;
        // this.settings = new Settings.DeskletSettings(this, uuid, desklet_id);
    }

    get_file_text(fname) {
        return this.byte_array_to_string(GLib.file_get_contents(fname)[1]);
    }

    get_path_to_file(local_path) {
        let absolute_dir = imports.ui.deskletManager.deskletMeta[this.uuid].path;
        while (absolute_dir) {
            if (GLib.file_test(absolute_dir + "/" + local_path, GLib.FileTest.EXISTS)) {
                return absolute_dir + "/" + local_path;
            }
            let last_slash_index = absolute_dir.lastIndexOf("/");
            if (last_slash_index == -1 || absolute_dir.endsWith(this.uuid)) {
                break;
            }
            absolute_dir = absolute_dir.substring(0, last_slash_index);
        }
        return null
    }
}
