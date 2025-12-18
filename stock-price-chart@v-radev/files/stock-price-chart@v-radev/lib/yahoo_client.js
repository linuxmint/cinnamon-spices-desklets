const UUID = 'stock-price-chart@v-radev';
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

imports.searchPath.unshift(`${DESKLET_DIR}/lib`);
const HttpClientModule = imports['http_client'];
const httpClient = new HttpClientModule.HttpClient();

class YahooClientDeclaration {

  _authCookie = null;
  _authCrumb = null;

  constructor() {}

  // public const INTERVAL_1_DAY = '1d';
  // public const INTERVAL_1_WEEK = '1wk';
  // public const INTERVAL_1_MONTH = '1mo';

  // FILTER_HISTORICAL = 'history';
  // FILTER_SPLITS = 'split';

  async getTickerData(ticker, interval, startDate, endDate) {
    global.log('--- Getting cookie...');

    try {
      // This was https://finance.yahoo.com/quote/AAPL/options previously
      await httpClient.request('GET', 'https://fc.yahoo.com');
    } catch (e) {
      global.log(e);

      throw e;
    }

    global.log('--- Getting crumb...');

    const crumbResponse = await httpClient.request('GET', 'https://query2.finance.yahoo.com/v1/test/getcrumb');

    global.log('---- crumb is OK');
    if ('string' === typeof crumbResponse.data && '' !== crumbResponse.data.trim() && !/\s/.test(crumbResponse.data)) {
      this._authCrumb = crumbResponse.data;
    } else if ( 'string' === typeof crumbResponse && '' !== crumbResponse.trim() && !/\s/.test(crumbResponse)) {
      this._authCrumb = crumbResponse;
    }

    global.log('---- crumb is 2 : ' + this._authCrumb);

    const periodOne = Math.floor(startDate.getTime() / 1000);
    const periodTwo = Math.floor(endDate.getTime() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/`
      + `${encodeURIComponent(ticker)}?period1=${periodOne}&`
      + `period2=${periodTwo}&interval=${interval}`
      + `&events=history&lang=en-US&region=US&crumb=${this._authCrumb}`;

    try {
      //TODO JSON.parse() the response with a new method getJson() in the httpClient that calls .request('GET', url);
      // {"chart":{"result":[{"meta":{"longName":"Apple Inc.","shortName":"Apple Inc.","chartPreviousClose":277.18,"dataGranularity":"1d","range":"","validRanges":["1d","5d","1mo","3mo","6mo","1y","2y","5y","10y","ytd","max"]},"timestamp":[1765377000,1765463400,1765549800,1765809000,1765895400],"indicators":{"quote":[{"high":[279.75,279.5899963378906,279.2200012207031,280.1499938964844,275.5],"volume":[33038300,33248000,39532900,50409100,37589700],"open":[277.75,279.1000061035156,277.8999938964844,280.1499938964844,272.82000732421875],"close":[278.7799987792969,278.0299987792969,278.2799987792969,274.1099853515625,274.6099853515625],"low":[276.44000244140625,273.80999755859375,276.82000732421875,272.8399963378906,271.7900085449219]}],"adjclose":[{"adjclose":[278.7799987792969,278.0299987792969,278.2799987792969,274.1099853515625,274.6099853515625]}]}}],"error":null}}
      return httpClient.request('GET', url);
    } catch (e) {
      global.log('-- Error on getting ticker data request.');
      global.log(e);

      throw e;
    }

    //TODO
    // return this.getHistoricalDataResponse(ticker, interval, startDate, endDate);
  }

  // private function getHistoricalDataResponse(
  //  string $symbol,
  //  string $interval,
  //  \DateTimeInterface $startDate,
  //  \DateTimeInterface $endDate,
  // ): string {
  //   $url = 'https://query{queryServer}.finance.yahoo.com/v8/finance/chart/'.urlencode($symbol).'?period1='.$startDate->getTimestamp().'&period2='.$endDate->getTimestamp().'&interval='.$interval.'&events=history';
  //   $response = $this->contextManager->request('GET', $url);
  //
  //   response gets sent to transformHistoricalDataResult();
  // }

  // public function transformHistoricalDataResult(string $responseBody): array
  // {
  //   $decoded = json_decode($responseBody, true);
  //
  //   if ((!\is_array($decoded)) || (isset($decoded['chart']['error']))) {
  //     throw new ApiException('Response is not a valid JSON', ApiException::INVALID_RESPONSE);
  //   }
  //
  //   $result = $decoded['chart']['result'][0];
  //
  //   if (0 === \count($result['indicators']['quote'][0])) {
  //     return [];
  //   }
  //
  //   $entryCount = \count($result['indicators']['quote'][0]['open']);
  //
  //   $returnArray = [];
  //   for ($i = 0; $i < $entryCount; ++$i) {
  //     $returnArray[] = $this->createHistoricalData($result, $i);
  //   }
  //
  //   return $returnArray;
  // }

  // private function createHistoricalData(array $json, int $index): HistoricalData
  // {
  //     $dateStr = date('Y-m-d', $json['timestamp'][$index]);
  //
  //     if ('0' !== $dateStr) {
  //       $date = $this->validateDate($dateStr);
  //     } else {
  //       throw new ApiException(\sprintf('Not a date in column "Date":%s', $json['timestamp'][$index]), ApiException::INVALID_VALUE);
  //     }
  //
  //     foreach (['open', 'high', 'low', 'close', 'volume'] as $column) {
  //       $columnValue = $json['indicators']['quote'][0][$column][$index];
  //       if (!is_numeric($columnValue) && 'null' !== $columnValue && !\is_null($columnValue)) {
  //         throw new ApiException(\sprintf('Not a number in column "%s": %s', $column, $column), ApiException::INVALID_VALUE);
  //       }
  //     }
  //
  //     $columnValue = $json['indicators']['adjclose'][0]['adjclose'][$index];
  //     if (!is_numeric($columnValue) && 'null' !== $columnValue && !\is_null($columnValue)) {
  //       throw new ApiException(\sprintf('Not a number in column "%s": %s', 'adjclose', 'adjclose'), ApiException::INVALID_VALUE);
  //     }
  //
  //     $open = (float) $json['indicators']['quote'][0]['open'][$index];
  //     $high = (float) $json['indicators']['quote'][0]['high'][$index];
  //     $low = (float) $json['indicators']['quote'][0]['low'][$index];
  //     $close = (float) $json['indicators']['quote'][0]['close'][$index];
  //     $volume = (int) $json['indicators']['quote'][0]['volume'][$index];
  //     $adjClose = (float) $json['indicators']['adjclose'][0]['adjclose'][$index];
  //
  //     return new HistoricalData($date, $open, $high, $low, $close, $adjClose, $volume);
  // }
}

// Export
var YahooClient = YahooClientDeclaration;
