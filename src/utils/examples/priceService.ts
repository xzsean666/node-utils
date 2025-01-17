import { PriceService } from "../priceService";

async function runPriceServiceExample() {
  // 创建 PriceService 实例
  const priceService = new PriceService();

  try {
    console.log("=== 价格服务示例 ===\n");
    const token = "ASTR";
    // 示例1: 获取单个交易所的当前价格
    console.log(`1. 获取 Binance ${token} 当前价格:`);
    const ethPrice = await priceService.getPrice(token, "binance");
    console.log(ethPrice);
    console.log();

    // 示例2: 获取所有交易所的当前价格
    console.log(`2. 获取所有交易所 ${token} 当前价格:`);
    const allBtcPrices = await priceService.getAllPrices(token);
    console.log(JSON.stringify(allBtcPrices, null, 2));
    console.log();

    // 示例3: 获取平均价格
    console.log(`3. 获取 ${token} 当前平均价格:`);
    const avgPrice = await priceService.getCurrentAveragePrice(token);
    console.log(`平均价格: $${avgPrice}`);
    console.log();

    // 示例4: 获取历史价格
    const timestamp = Math.floor(Date.now() / 1000) - 3600; // 1小时前
    console.log(
      `4. 获取 ${token} 一小时前的价格 (${new Date(
        timestamp * 1000
      ).toISOString()})`
    );
    const historicalPrices = await priceService.getHistoricalPrices(token, [
      timestamp,
    ]);
    console.log(JSON.stringify(historicalPrices, null, 2));
    console.log();

    // 示例5: 测试 token 名称标准化
    console.log(`5. 获取 ${token} 价格 (应该返回 ${token} 的价格):`);
    const wethPrice = await priceService.getPrice(token, "binance");
    console.log(wethPrice);
  } catch (error) {
    console.error("运行示例时发生错误:", error);
  }
}

// 运行示例
runPriceServiceExample().catch(console.error);
