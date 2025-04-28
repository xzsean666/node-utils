import { CCIPHelper } from "../../web3/CCIPHelper";
import { config } from "./config";
const ccipHelper = new CCIPHelper(config);
import { CCIPLiteHelper } from "../../web3/CCIPLiteHelper";
import { rpcs } from "./rpcs";
const ccipLiteHelper = new CCIPLiteHelper(rpcs.minato);
async function main() {
  const blockminato = 7129000;
  const blockshibuya = 8780000;

  const messageId = await ccipHelper.getMessageId(
    "0x3e8d8ea2bc24726846ec0e6c50ef40e7e105ffca49ecd197a9909257a54da25b"
  );
  console.log(messageId);
  const messgeID2 = await ccipLiteHelper.getMessageId(
    "0x3e8d8ea2bc24726846ec0e6c50ef40e7e105ffca49ecd197a9909257a54da25b"
  );
  console.log(messgeID2);
}
main();
