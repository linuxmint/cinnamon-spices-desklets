class Logger {

  constructor(id) {
    this.id = `[${id}]`;
  }

  Log(s) {
    global.log([[this.id, 'INFO'].join(' '), s].join(': '));
  }

  Error(s) {
    global.logError([[this.id, 'ERROR'].join(' '), s].join(': '));
  }

  Warn(s) {
    global.logWarning([[this.id, 'WARN'].join(' '), s].join(': '));
  }

  Debug(s) {
    global.logTrace([[this.id, 'DEBUG'].join(' '), s].join(': '));
  }
}

var New = Logger;