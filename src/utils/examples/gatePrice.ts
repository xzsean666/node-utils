import { GateioService } from "../gateioService";

async function main() {
  // 创建 GateioService 实例
  // 1. 不使用缓存的例子
  const serviceWithoutCache = new GateioService();

  // 2. 使用缓存的例子
  const serviceWithCache = new GateioService({
    dbUrl: "postgres://sean:111111@localhost:5432/MyDB",
    tableName: "price_cache",
  });

  try {
    // 获取当前价格的例子
    // console.log("获取 BTC 当前价格...");
    // const btcPrice = await serviceWithoutCache.getPrice("BTC");
    // console.log(`BTC 当前价格: $${btcPrice}`);

    // 获取历史价格的例子
    let timestamp = Math.floor(Date.now() / 1000) - 3600; // 一小时前
    console.log(timestamp);
    timestamp = 1734582922;
    console.log(
      `获取 ETH 在 ${new Date(timestamp * 1000).toLocaleString()} 的价格...`
    );
    const ethHistoricalPrice = await serviceWithCache.getPrice(
      "ETH",
      timestamp
    );
    console.log(`ETH 历史价格: $${ethHistoricalPrice}`);

    // // 测试特殊代币处理
    // console.log("获取 WETH 价格（将自动转换为 ETH）...");
    // const wethPrice = await serviceWithCache.getPrice("WETH");
    // console.log(`WETH 价格: $${wethPrice}`);

    // // 测试 USDT 价格
    // const usdtPrice = await serviceWithCache.getPrice("USDT");
    // console.log(`USDT 价格: $${usdtPrice}`); // 应该返回 1
  } catch (error) {
    console.error("发生错误:", error);
  }
}

// 运行示例
main().catch(console.error);
