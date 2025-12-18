class LoggerClassDeclaration {
  constructor() {
    this._logger = () => {};
    this._logger = global.log; // Uncomment to enable debugging
  }

  setLogger(logger) {
    this._logger = logger;
  }

  log(string) {
    this._logger('---- ' + string);
  }
}

// Export
var LoggerClass = LoggerClassDeclaration;
