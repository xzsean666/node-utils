import { PriceService } from "../web3/priceServiceCache";
import { KVDatabase } from "../db/PGKVDatabase";

import dotenv from "dotenv";

dotenv.config();

async function priceServiceExample() {
  // 初始化服务
  const dbUrl =
    process.env.DB_URL || "postgres://sean:111111@localhost:5432/MyDB";
  const db = new KVDatabase(dbUrl, "price_cache");

  const priceService = new PriceService(db);

  try {
    // 1. 获取当前价格
    console.log("\n1. 获取 ETH 当前价格:");
    const currentPrices = await priceService.getAllPrices("ETH");
    console.log(JSON.stringify(currentPrices, null, 2));

    // // 2. 获取单个交易所价格
    // console.log("\n2. 获取 Binance ETH 价格:");
    // const binancePrice = await priceService.getPrice("ETH", "binance");
    // console.log(JSON.stringify(binancePrice, null, 2));

    // // 3. 获取历史价格
    // const oneHourAgo = 1735735801;
    // console.log("\n3. 获取一小时前的 ETH 价格:");
    // const historicalPrices = await priceService.getAllPrices("ETH", {
    //   timestamp: oneHourAgo,
    // });
    // console.log(JSON.stringify(historicalPrices, null, 2));

    // // 4. 获取平均价格
    // console.log("\n4. 获取 ETH 当前平均价格:");
    // const avgPrice = await priceService.getCurrentAveragePrice("ETH");
    // console.log(`Average price: ${avgPrice}`);

    // // 5. 测试 Token 别名
    // console.log("\n5. 测试 WETH 价格 (应该返回 ETH 价格):");
    // const wethPrices = await priceService.getAllPrices("WETH");
    // console.log(JSON.stringify(wethPrices, null, 2));
  } catch (error) {
    console.error("Error in example:", error);
  }
}

// 运行示例
priceServiceExample().then(() => console.log("\nExample completed"));
