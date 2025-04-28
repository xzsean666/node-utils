import { CCIPLiteHelper } from "../../web3/CCIPLiteHelper";
import { config } from "./config";
import { ccipConfig } from "./config";
import { rpcs } from "./rpcs";
const shibuyaccipHelper = new CCIPLiteHelper(rpcs.shibuya);
const minatoaccipHelper = new CCIPLiteHelper(rpcs.minato);
async function main() {
  const blockminato = 7129000;
  const blockshibuya = 8780000;
  const messageId =
    "0x6560306c50ac36d2bef31c192cc0e74f32d44c0ce869648674768e74629642fa";
  const status = await minatoaccipHelper.getTransferStatus(
    messageId,
    ccipConfig.minato.Router,
    ccipConfig.shibuya.ChainSelector
  );
  console.log(status);
  //   const status2 = await shibuyaccipHelper.getTransferStatus(
  //     messageId,
  //     ccipConfig.shibuya.Router,
  //     ccipConfig.minato.ChainSelector
  //   );
  //   console.log(status2);
}
main();
