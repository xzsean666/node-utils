import { CCIPLiteHelper } from "../../CCIPLiteHelper";
import { rpcs } from "./rpcs";
import ccip from "./ccip.json";

const ccipLiteHelper = new CCIPLiteHelper(rpcs.soneium);

const ccipBridge = "0x6f9d07e9e974da5b3f57a6b092eb524f176162e4";

async function main() {
  const logs = await ccipLiteHelper.getAddressCCIPsendStatus({
    toAddress: ccipBridge,
    sourceRouterAddress: ccip.soneium.router,
    destinationChainSelector: ccip.astar.chainSelector,
    BLOCKS_TO_SEARCH: 10000,
  });
  console.log(logs);
}

main();
