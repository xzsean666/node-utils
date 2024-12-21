// import { GateioService } from "node-utils-sean/dist/src/utils/gateioService";
import { GateioService } from "node-utils-sean/dist/src";
const gateioService = new GateioService();

async function main() {
  const price = await gateioService.getPrice("BTC");
  console.log(price);
}

main();
