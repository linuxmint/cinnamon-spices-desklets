const GLib = imports.gi.GLib;
const FileHandlerBase = require("./file_handler_base")

// making this a class just to keep a door open in the off-chance that
// the encoding of the text files needs to be configurable
class FileHandler extends FileHandlerBase.FileHandlerBase {
    constructor(uuid, desklet_id) {
        super(uuid, desklet_id);
        this.text_decoder = new TextDecoder();
        // this.settings = new Settings.DeskletSettings(this, uuid, desklet_id);
    }

    byte_array_to_string(ba) {
        return this.text_decoder.decode(ba);
    }
}
