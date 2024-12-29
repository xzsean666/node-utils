import { EthersUtils } from "../ethersUtils";
import dotenv from "dotenv";

// 加载环境变量
dotenv.config();

async function walletDerivationExample() {
  try {
    // 从环境变量获取主私钥
    const masterPrivateKey = process.env.PRIVATE_KEY;

    if (!masterPrivateKey) {
      throw new Error("请在 .env 文件中设置 PRIVATE_KEY");
    }
    const nodeProvider = process.env.NODE_PROVIDER;

    // 初始化 EthersUtils
    const ethersUtils = new EthersUtils(nodeProvider, {
      BatchCallAddress: "0x074fa7Cb9Be97Af868C1ADd8A6015cdFa97Baf2C",
      privateKey: masterPrivateKey,
    });
    // ethersUtils.setPrivateKey(masterPrivateKey);

    // 派生前5个钱包地址
    console.log("开始派生钱包...");

    for (let i = 0; i < 5; i++) {
      const derivedWallet = await ethersUtils.deriveWallets(
        masterPrivateKey,
        i
      );
      console.log(`\n钱包 #${i}:`);
      console.log(`路径: ${derivedWallet.path}`);
      console.log(`地址: ${derivedWallet.address}`);
      // 出于安全考虑，生产环境建议不要打印私钥
      console.log(`私钥: ${derivedWallet.privateKey}`);
    }

    // 设置第3个派生钱包作为当前钱包
    console.log("\n设置第3个派生钱包作为当前钱包");
    await ethersUtils.setDeriveWallets(3);
    console.log(`当前账户地址: ${ethersUtils.account}`);
  } catch (error: any) {
    console.error("派生钱包时发生错误:", error.message);
  }
}

// 运行示例
walletDerivationExample().catch(console.error);
