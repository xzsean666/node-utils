import { EthersUtils } from "../ethersUtilsV2";

import { IERC20 } from "../abis";

const minatourl =
  "https://soneium-minato.rpc.scs.startale.com?apikey=iFYLiG7ROGg2KSst6bS7gRBIPV7rNtei";
async function main() {
  try {
    const config = {
      BatchCallAddress: "0x074fa7Cb9Be97Af868C1ADd8A6015cdFa97Baf2C", // 这里需要填入实际的 BatchCall 合约地址
    };

    const ethersUtils = new EthersUtils(minatourl, config);

    // 准备要批量调用的合约地址和方法
    const tokens = [
      "0xF58D03279bf699b31404CDe9FAC8Dd205744d515",
      "0x2D12A08Fd8f324e4B1A8d96502D4e11b45d1FF76",
      "0x262ADB1D33B4893aa7C35CD42729410a605A9E6C",
      "0x826972E3A8aCD9ce8085987bDCe1D8f96fbEc82E",
      "0x83337Aba444F49977787f4A314bd087e5a0A3ab2",
      "0x79ac315a1E948D12889117790005Fc79DAb22B9f",
    ];
    const userAddress = "0x4Ccfdec256DBdc605E713E695f9126da823250b5"; // 用户地址

    // 为所有代币编码调用数据并准备批量调用参数
    const calls = await Promise.all(
      tokens.map(async (tokenAddress) => {
        return await ethersUtils.encodeDataByABI({
          abi: IERC20,
          functionName: "balanceOf",
          executeArgs: [userAddress],
          target: tokenAddress,
        });
      })
    );
    const calls1 = await Promise.all(
      tokens.map(async (tokenAddress) => {
        return await ethersUtils.encodeDataByABI({
          abi: IERC20,
          functionName: "totalSupply",
          executeArgs: [],
          target: tokenAddress,
        });
      })
    );

    console.log("开始批量调用...");

    // 执行批量调用
    const results = await ethersUtils.batchReadCall(calls);
    const results1 = await ethersUtils.batchReadCall(calls1);
    console.log("批量调用结果:", results);
    console.log("批量调用结果:", results1);
  } catch (error) {
    console.error("批量调用失败:", error);
  }
}

main().catch(console.error);
