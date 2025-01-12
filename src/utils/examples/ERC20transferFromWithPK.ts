import { ERC20Utils } from "../ERC20Utils";
import dotenv from "dotenv";
dotenv.config();
export const shibuya = {
  WstASTR: "0xe669f68ed715fea78c8e7ac22d6fa44774567437",
  WASTR: "0xbd5f3751856e11f3e80dbda567ef91eb7e874791",
};
const rpcUrl =
  process.env.RPC_URL ||
  "https://rpc.startale.com/shibuya?apikey=j0Hb3fH0xG5E4Xtm5ZgZd7Czda2nIjxh";
const privateKey = process.env.PRIVATE_KEY || "";
async function main() {
  const utils = new ERC20Utils(rpcUrl, shibuya.WstASTR, privateKey);
  const historicalGasCost = await utils.getHistoricalTransferGasCost();
  console.log("historicalGasCost", historicalGasCost);

  // const tx = await utils.transferAllNative(
  //   "0xA9Fcdc0C9e556dd8cE5C66a874F059ADbdecD09A"
  // );
  // console.log(tx);
  const tx = await utils.transferAllNative(
    "0x285bd8C75C7647b7da1C1154776633804d4ff5eC",
    "5f90dab83fc8b61f25db4157a6d81932da159b695b695b21fa0d29db41aa071d"
  );
  console.log(tx);

  //   const tx = await utils.signedTransfer({
  //     fromPrivateKey:
  //       "5f90dab83fc8b61f25db4157a6d81932da159b695b695b21fa0d29db41aa071d",
  //     toAddress: "0x285bd8C75C7647b7da1C1154776633804d4ff5eC",
  //     amount: 2000000000000000000n,
  //   });
  //   console.log(tx);

  //   const tokendetials = await utils.getTokenInfo();
  // const tx = await utils.transferFromWithPK({
  //   fromAddressPK:
  //     "5f90dab83fc8b61f25db4157a6d81932da159b695b695b21fa0d29db41aa071d",
  //   toAddress: "0x285bd8C75C7647b7da1C1154776633804d4ff5eC",
  // });
  // console.log(tx);
}

main();
