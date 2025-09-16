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

  getTickerData(ticker, interval, startDate, endDate) {

    // This is the URL the website uses when I switch to 1 month data
    // https://query1.finance.yahoo.com/v8/finance/chart/KR?period1=1754600400&period2=1757602800&interval=1d&includePrePost=true&events=div|split|earn&lang=en-US&region=US&source=cosaic



    //TODO
    // 1. curl -X GET "https://fc.yahoo.com"
    // 2. using the cookie jar do https://query2.finance.yahoo.com/v1/test/getcrumb
    // so I need to enable the cookie jar in the http client

    try {
      //TODO this is not json
      httpClient.get('https://fc.yahoo.com');
    } catch (e) {}

    try {
      //TODO this is not json
      const crumbResponse = httpClient.get('https://query2.finance.yahoo.com/v1/test/getcrumb');
    } catch (e) {
      console.log(e);

      throw e;
    }

    return crumbResponse;

    const crumb = 'hzRtijhAgd3';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/`
      + `${encodeURIComponent(ticker)}?period1=${startDate.getTime() / 1000}&`
      + `period2=${endDate.getTime() / 1000}&interval=${interval}`
      + `&events=history&lang=en-US&region=US&crumb=${crumb}`;

    try {
      const json = httpClient.getJSON(url);
    } catch (e) {
      console.log(e);

      throw e;
    }

    return json;

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
