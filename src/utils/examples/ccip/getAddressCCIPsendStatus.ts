import { CCIPLiteHelper } from "../../../utils/CCIPLiteHelper";
import { ccipConfig } from "./config";
import { rpcs } from "./rpcs";
const ccipLiteHelper = new CCIPLiteHelper(rpcs.shibuya);
async function main() {
  const param = {
    fromAddress: "0xbe8d7bce3677e665fb4dad74e6d9e401305f9f4d",
    toAddress: "0x285bd8c75c7647b7da1c1154776633804d4ff5ec",
    sourceRouterAddress: ccipConfig.shibuya.Router,
    destinationChainSelector: ccipConfig.minato.ChainSelector,
  };
  const status = await ccipLiteHelper.getAddressCCIPsendStatus(param);
  console.log(status);
}
main();
