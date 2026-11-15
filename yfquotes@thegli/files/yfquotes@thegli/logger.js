/**
 * Yahoo Finance Quotes: Logger.
 * For debug set DEBUGGING to true or create a file named DEBUG in the desklet's folder.
 */

const DEBUGGING = false;

const Gio = imports.gi.Gio;
const DeskletManager = imports.ui.deskletManager;

function Logger(uuid, deskletId) {
    this.init(uuid, deskletId);
}

Logger.prototype = {
    init(uuid, deskletId) {
        this.uuid = uuid;
        this.deskletId = deskletId;
        this.debugging = DEBUGGING || Gio.file_new_for_path(DeskletManager.deskletMeta[this.uuid].path + "/DEBUG").query_exists(null);
    },

    debug(msg) {
        if (this.debugging) {
            global.log(`${this.uuid}[${this.deskletId}][DEBUG]: ${msg}`);
        }
    },

    info(msg) {
        global.log(`${this.uuid}[${this.deskletId}]: ${msg}`);
    },

    warning(msg) {
        global.logWarning(`${this.uuid}[${this.deskletId}]: ${msg}`);
    },

    error(msg) {
        global.logError(`${this.uuid}[${this.deskletId}]: ${msg}`);
    },

    exception(context, err) {
        const exceptionDetails = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : err;
        global.logError(`${this.uuid}[${this.deskletId}]: ${context}\n${exceptionDetails}`);
    }
}

module.exports = { Logger };
