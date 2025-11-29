import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
import { Chain, ClobClient } from "../clobClient";

dotenvConfig({ path: resolve(__dirname, "../.env") });

async function main() {
  const host = process.env.CLOB_API_URL || "https://clob.polymarket.com/";
  const chainId = parseInt(`${process.env.CHAIN_ID || Chain.POLYGON}`) as Chain;
  const clobClient = new ClobClient(host, chainId);
  const YES =
    "17148991929546304218678959738430213065524880357303658607403556776126482126118";

  const orderbook = await clobClient.getOrderBook(YES);
  console.log("orderbook", orderbook);

  const hash = clobClient.getOrderBookHash(orderbook);
  console.log("orderbook hash", hash);
}

main();
