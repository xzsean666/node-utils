import { BinanceAPIHelper } from "../BinanceAPIHelper";
import dotenv from "dotenv";

dotenv.config();
// API_KEY = "a5480bb1f661b6d585b0c093bef63286f8cba6d9a8d4ee13becf4516061e7a68"
// SECRET = "adb7bf676e3fd567c1c56096410e646cdca2d98658589982d5659d8603b3f0be"

// 11:54
// API_KEY = "MNEgG5dZoGIOIEgeJuJMKizeI9626hnnfE0U82iNDMxfP4UHCyighdLEiZ59hT0h"
// SECRET = "7D9xutK53HabPcngC9nfTZ6p7fv3bANDSPU2oFpi6Et1In8cL5EDbrtBZbsar0mi"
// 现货
const config = {
  apiKey: "MNEgG5dZoGIOIEgeJuJMKizeI9626hnnfE0U82iNDMxfP4UHCyighdLEiZ59hT0h",
  apiSecret: "7D9xutK53HabPcngC9nfTZ6p7fv3bANDSPU2oFpi6Et1In8cL5EDbrtBZbsar0mi",
  isTestnet: true, // or false for mainnet
};
// 合约
const config1 = {
  apiKey: "a5480bb1f661b6d585b0c093bef63286f8cba6d9a8d4ee13becf4516061e7a68",
  apiSecret: "adb7bf676e3fd567c1c56096410e646cdca2d98658589982d5659d8603b3f0be",
  isTestnet: true, // or false for mainnet
};

const binanceAPIHelper = new BinanceAPIHelper(config);
const binanceAPIHelper1 = new BinanceAPIHelper(config1);
const allSymbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];

async function main() {
  const result = await binanceAPIHelper.checkAPIKeyAndSecret();
  if (result.spot) {
    console.log("现货账号有效");
  }
  if (result.futures) {
    console.log("合约账号有效");
  }
  // const accountInfo = await binanceAPIHelper.getAccountInfo();
  // console.log(accountInfo);
  // const spotTradingHistory = await binanceAPIHelper.getAllSpotTradingHistory(
  //   allSymbols,
  //   { fromId: 1684018 }
  // );
  // console.log(spotTradingHistory);
  // const accountFuturesInfo = await binanceAPIHelper1.getFuturesAccountInfo();
  // console.log(accountFuturesInfo);
  // const futuresTradingHistory =
  //   await binanceAPIHelper1.getAllFuturesTradingHistory();
  // console.log(futuresTradingHistory);
  // const currentAccountStates =
  //   await binanceAPIHelper1.getCurrentFuturesAccountState();
  // console.log(currentAccountStates);
  // 获取过去30分钟的账户变化
  // const changes = await binanceAPIHelper1.getFuturesAccountStateChanges(
  //   60 * 24
  // );
  // console.log(changes);
  // const currentAccountStates =
  //   await binanceAPIHelper1.getCurrentFuturesAccountState();
  // console.log(currentAccountStates);
}

main();
