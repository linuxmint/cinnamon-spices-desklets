
class LoggerClassDeclaration {
  constructor() {
    this._logger = () => {};
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
