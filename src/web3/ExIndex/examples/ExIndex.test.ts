import { ExIndex, ExchangeName, TradeStatisticsPeriod } from '../ExIndex';
import { BinanceAPIHelper } from '../../binance/BinanceAPIHelper';
import { KVDatabase } from '../../../dbUtils/SqliteKVDB';
const kvdb = new KVDatabase('./db/binance.db', 'test');
const config = {
  apiKey: 'MNEgG5dZoGIOIEgeJuJMKizeI9626hnnfE0U82iNDMxfP4UHCyighdLEiZ59hT0h',
  apiSecret: '7D9xutK53HabPcngC9nfTZ6p7fv3bANDSPU2oFpi6Et1In8cL5EDbrtBZbsar0mi',
  isTestnet: true, // or false for mainnet
};
// 合约
const config1 = {
  apiKey: 'a5480bb1f661b6d585b0c093bef63286f8cba6d9a8d4ee13becf4516061e7a68',
  apiSecret: 'adb7bf676e3fd567c1c56096410e646cdca2d98658589982d5659d8603b3f0be',
  isTestnet: true, // or false for mainnet
};

const binanceAPIHelper = new BinanceAPIHelper(config);
const binanceAPIHelper1 = new BinanceAPIHelper(config1);
const allSymbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];

const exIndex = new ExIndex([
  { name: ExchangeName.BINANCE, apiHelper: binanceAPIHelper1 },
  // { name: ExchangeName.BINANCE, apiHelper: binanceAPIHelper1 },
]);

async function main() {
  const accountInfo = await exIndex.getUnifiedPositions();
  console.log(accountInfo);
  const accountInfowithPriceChange =
    await exIndex.getUnifiedPositionsWithPriceHistory(accountInfo, kvdb);
  console.log(accountInfowithPriceChange);

  // const history = await exIndex.getFuturesTradingHistory(ExchangeName.BINANCE);

  // console.log(history);
  // const stateChange = await exIndex.getFuturesAccountStateChanges(
  //   ExchangeName.BINANCE,
  //   60 * 24
  // );
  // console.log(stateChange);
  // const statistics = exIndex.getTradeStatistics(history, {
  //   period: TradeStatisticsPeriod.WEEK,
  // });
  // console.log(statistics);
}

main();
