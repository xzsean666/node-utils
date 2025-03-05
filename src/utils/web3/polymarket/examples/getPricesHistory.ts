import { ethers } from "ethers";
import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
import {
  ApiKeyCreds,
  Chain,
  ClobClient,
  PriceHistoryFilterParams,
  PriceHistoryInterval,
} from "../clobClient";

dotenvConfig({ path: resolve(__dirname, "../.env") });

async function main() {
  const wallet = new ethers.Wallet(`${process.env.PRIVATE_KEY_TEST}`);
  const chainId = parseInt(`${process.env.CHAIN_ID || Chain.POLYGON}`) as Chain;
  console.log(`Address: ${await wallet.getAddress()}, chainId: ${chainId}`);

  const host = process.env.CLOB_API_URL || "https://clob.polymarket.com/";
  const creds: ApiKeyCreds = {
    key: `${process.env.CLOB_API_KEY}`,
    secret: `${process.env.CLOB_SECRET}`,
    passphrase: `${process.env.CLOB_PASS_PHRASE}`,
  };
  const clobClient = new ClobClient(host, chainId);

  const YES_TOKEN_ID =
    "17148991929546304218678959738430213065524880357303658607403556776126482126118";
  const NO_TOKEN_ID =
    "113944511437047286070977074222535617181404611267671592896303826271480616303572";

  const yes_prices_history = await clobClient.getPricesHistory({
    startTs: new Date().getTime() / 1000 - 1000,
    endTs: new Date().getTime() / 1000,
    market: YES_TOKEN_ID,
  } as PriceHistoryFilterParams);

  console.log(yes_prices_history);

  const no_prices_history = await clobClient.getPricesHistory({
    startTs: new Date().getTime() / 1000 - 1000,
    endTs: new Date().getTime() / 1000,
    market: NO_TOKEN_ID,
  } as PriceHistoryFilterParams);

  console.log(no_prices_history);

  // intervals
  // ONE HOUR
  const one_hour_history = await clobClient.getPricesHistory({
    market: YES_TOKEN_ID,
    interval: PriceHistoryInterval.ONE_HOUR,
    fidelity: 1,
  } as PriceHistoryFilterParams);

  console.log(one_hour_history);

  // SIX HOURS
  const six_hours_history = await clobClient.getPricesHistory({
    market: YES_TOKEN_ID,
    interval: PriceHistoryInterval.SIX_HOURS,
    fidelity: 3,
  } as PriceHistoryFilterParams);

  console.log(six_hours_history);

  // ONE DAY
  const one_day_history = await clobClient.getPricesHistory({
    market: YES_TOKEN_ID,
    interval: PriceHistoryInterval.ONE_DAY,
    fidelity: 5,
  } as PriceHistoryFilterParams);

  console.log(one_day_history);

  // ONE WEEK
  const one_week_history = await clobClient.getPricesHistory({
    market: YES_TOKEN_ID,
    interval: PriceHistoryInterval.ONE_WEEK,
    fidelity: 10,
  } as PriceHistoryFilterParams);

  console.log(one_week_history);
}

main();
