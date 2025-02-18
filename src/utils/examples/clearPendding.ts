import { EthersUtils } from "../ethersUtilsV2";
import { config } from "dotenv";
config();
const minatourl =
  "https://soneium-minato.rpc.scs.startale.com?apikey=iFYLiG7ROGg2KSst6bS7gRBIPV7rNtei";
async function main() {
  const ethersUtils = new EthersUtils(minatourl, {
    privateKey: process.env.PRIVATE_KEY,
  });
  const gasPrice = await ethersUtils.web3.getFeeData();
  console.log(gasPrice);
  const pending = await ethersUtils.cancelPendingTransaction(811);
  console.log(pending);
}

main();
