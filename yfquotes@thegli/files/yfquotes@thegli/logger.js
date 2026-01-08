/**
 * Yahoo Finance Quotes: Logger
 * To see the logs use Looking Glass Tool: Alt+F2 and type 'lg'
 */

function Logger(uuid, deskletId, debugging) {
    this.init(uuid, deskletId, debugging);
}

Logger.prototype = {
    init: function(uuid, deskletId, debugging) {
        this.uuid = uuid;
        this.deskletId = deskletId;
        this.debugging = debugging;
    },

    debug: function(msg) {
        if (this.debugging) {
            global.log(this.uuid + "[" + this.deskletId + "][DEBUG]: " + msg);
        }
    },

    info: function(msg) {
        global.log(this.uuid + "[" + this.deskletId + "]: " + msg);
    },

    warning: function(msg) {
        global.logWarning(this.uuid + "[" + this.deskletId + "]: " + msg);
    },

    error: function(msg) {
        global.logError(this.uuid + "[" + this.deskletId + "]: " + msg);
    }
}

module.exports = Logger;
