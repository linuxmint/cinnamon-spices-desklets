const UUID = 'stock-price-chart@v-radev';
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

imports.searchPath.unshift(`${DESKLET_DIR}/lib`);
const HttpClientModule = imports['http_client'];
const LoggerModule = imports['logger'];
const httpClient = new HttpClientModule.HttpClient();
const logger = new LoggerModule.LoggerClass();

class YahooClientDeclaration {

  _authCrumb = null;

  constructor() {}

  // public const INTERVAL_1_DAY = '1d';
  // public const INTERVAL_1_WEEK = '1wk';
  // public const INTERVAL_1_MONTH = '1mo';

  // FILTER_HISTORICAL = 'history';
  // FILTER_SPLITS = 'split';

  async getAuthCookieInHttpJar() {
    logger.log('--- Getting Yahoo auth cookie in HTTP jar.');

    try {
      await httpClient.request('GET', 'https://fc.yahoo.com');
    } catch (e) {
      logger.log(e);

      throw e;
    }
  }

  async getAuthCrumbValueInClient() {
    logger.log('--- Getting Yahoo auth crumb value.');

    try {
      const crumbResponse = await httpClient.request('GET', 'https://query2.finance.yahoo.com/v1/test/getcrumb');

      if ('string' === typeof crumbResponse.data && '' !== crumbResponse.data.trim() && !/\s/.test(crumbResponse.data)) {
        this._authCrumb = crumbResponse.data;
      } else if ('string' === typeof crumbResponse && '' !== crumbResponse.trim() && !/\s/.test(crumbResponse)) {
        this._authCrumb = crumbResponse;
      }
    } catch (e) {
      logger.log(e);

      throw e;
    }
  }

  async getTickerData(ticker, interval, startDate, endDate) {
    await this.getAuthCookieInHttpJar();

    if (!this._authCrumb) {
      await this.getAuthCrumbValueInClient();
    }

    logger.log(`--- Getting ticker data for ${ticker} from ${startDate.toISOString()} to ${endDate.toISOString()} with interval ${interval}.`);

    const periodOne = Math.floor(startDate.getTime() / 1000);
    const periodTwo = Math.floor(endDate.getTime() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/`
      + `${encodeURIComponent(ticker)}?period1=${periodOne}&`
      + `period2=${periodTwo}&interval=${interval}`
      + `&events=history&lang=en-US&region=US&crumb=${this._authCrumb}`;

    try {
      return httpClient.getJSON(url);
    } catch (e) {
      logger.log('-- Error on getting ticker data request.');
      logger.log(e);

      throw e;
    }
  }

  async getHistoricalTickerData(ticker, interval, startDate, endDate) {
    const response = await this.getTickerData(ticker, interval, startDate, endDate);

    if (response.hasOwnProperty('error') && null !== response.error) {
      logger.log('-- API Error on getting historical ticker data.');

      throw new Error(`API Error: ${response.error}.`);
    }

    if (
      !response.hasOwnProperty('chart') ||
      !response.chart.hasOwnProperty('result') ||
      0 === response.chart.result.length
    ) {
      logger.log('-- No chart result on getting historical ticker data.');

      return [];
    }

    const result = response.chart.result[0];

    if (
        !result.hasOwnProperty('timestamp') ||
        !result.hasOwnProperty('indicators') ||
        !result.indicators.hasOwnProperty('quote') ||
        0 === result.indicators.quote.length ||
        !result.indicators.quote[0].hasOwnProperty('open') ||
        0 === result.indicators.quote[0].open.length
    ) {
      logger.log('-- No historical data found in the ticker data response.');

      return [];
    }

    const itemsCount = result.indicators.quote[0].open.length;
    const historicalDataArray = [];

    for (let i = 0; i < itemsCount; i++) {
      const timestamp = result.timestamp[i];
      const date = new Date(timestamp * 1000);

      const open = result.indicators.quote[0].open[i];
      const close = result.indicators.quote[0].close[i];

      historicalDataArray.push({
        shortName: result.meta.shortName,
        date: date,
        open: this.roundAmount(open, 2, false),
        close: this.roundAmount(close, 2, false),
      });
    }

    return historicalDataArray;
  }

  roundAmount(amount, maxDecimals, strictRounding) {
    if (strictRounding) {
      return amount.toFixed(maxDecimals);
    }

    const parts = amount.toString().split('.');

    if (1 < parts.length && parts[1].length > maxDecimals) {
      return Number(amount.toFixed(maxDecimals));
    }

    return amount;
  }
}

// Export
var YahooClient = YahooClientDeclaration;
