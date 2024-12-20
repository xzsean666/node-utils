import { GateioService } from "node-utils-sean/src/utils/gateioService";

async function main() {
  const gateioService = new GateioService();
  const price = await gateioService.getPrice("BTC");
  console.log(price);
}

// 执行 main 函数并处理可能的错误
main().catch((error) => {
  console.error("Error:", error);
});
