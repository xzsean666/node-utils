import { CCIPHelper } from "../../web3/CCIPHelper";
import { config } from "./config";
const ccipHelper = new CCIPHelper(config);
async function main() {
  const blockminato = 7129000;
  const blockshibuya = 8780000;

  const logs = await ccipHelper.getOnRampDBLogs(blockshibuya, "latest");
  //   console.log(logs);
  console.log(logs[0]?.args);
  console.log(logs.length);
  //   const logs2 = await ccipHelper.getOffRampDBLogs(8786371, "latest");
  //   console.log(logs2);
  //   console.log(logs2.length);
}
main();
