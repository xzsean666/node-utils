import { EthersUtils } from "../ethersUtils";
import { ethers } from "ethers";

// ERC20代币的基础ABI
const ERC20_ABI = [
  {
    constant: false,
    inputs: [
      {
        name: "from",
        type: "address",
      },
      {
        name: "to",
        type: "address",
      },
      {
        name: "value",
        type: "uint256",
      },
    ],
    name: "transferFrom",
    outputs: [
      {
        name: "",
        type: "bool",
      },
    ],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      {
        name: "_to",
        type: "address",
      },
      {
        name: "_value",
        type: "uint256",
      },
    ],
    name: "transfer",
    outputs: [
      {
        name: "",
        type: "bool",
      },
    ],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      {
        name: "spender",
        type: "address",
      },
      {
        name: "amount",
        type: "uint256",
      },
    ],
    name: "approve",
    outputs: [
      {
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
];

async function batchERC20Transfer() {
  try {
    // 初始化EthersUtils
    const ethersUtils = new EthersUtils(
      "https://bsc-testnet-rpc.publicnode.com", // 替换为你的RPC URL
      {
        privateKey:
          "0xa010561d0ee36587adb4c9d81f4d19d84dc8b2246a9b7b8fd0665d1f8b15d844",
        batchCallAddress: "0x6d8B018833495b79805171e716030b807e08090E", // 替换为你的BatchCall合约地址
      }
    );
    const toRecipients = "0xD9Df2f0be7c8f42De89dDE8869D0090Af57490ce";
    const testTokenAddress = "0x397E696881DA1b85834BD7b6289925f8B9a1ee8a";
    // 首先授权BatchCall合约
    // console.log("正在授权BatchCall合约...");
    // const approveData = await ethersUtils.encodeDataByABI(
    //   ERC20_ABI,
    //   "approve",
    //   [ethersUtils.batchCallAddress, ethers.MaxUint256],
    //   testTokenAddress
    // );

    // await ethersUtils.excuteWriteContract(
    //   testTokenAddress,
    //   ERC20_ABI,
    //   "approve",
    //   [ethersUtils.batchCallAddress, ethers.MaxUint256]
    // );
    // console.log("授权完成");

    // 转账参数示例
    const transfers = [
      {
        tokenAddress: testTokenAddress, // 代币合约地址1
        to: toRecipients, // 接收地址1
        amount: "6000000000000000000", // 1个代币（假设18位小数）
      },
      {
        tokenAddress: "0x285bd8C75C7647b7da1C1154776633804d4ff5eC", // 代币合约地址2
        to: toRecipients, // 接收地址2
        amount: "9000000000000000000", // 0.5个代币
      },
      {
        tokenAddress: testTokenAddress, // 代币合约地址2
        to: toRecipients, // 接收地址2
        amount: "7000000000000000000", // 0.5个代币
      },
    ];

    // 构建批量调用参数
    const calls = await Promise.all(
      transfers.map(async (transfer) => {
        // 编码 transferFrom 函数调用
        const { data } = await ethersUtils.encodeDataByABI(
          ERC20_ABI,
          "transferFrom",
          [
            ethersUtils.getSignerAddress(), // from 参数，当前用户地址
            transfer.to, // to 参数
            transfer.amount, // amount 参数
          ],
          transfer.tokenAddress
        );

        return {
          target: transfer.tokenAddress,
          data,
          abi: ERC20_ABI,
          functionName: "transferFrom",
          excuteArgs: [
            ethersUtils.getSignerAddress(),
            transfer.to,
            transfer.amount,
          ],
        };
      })
    );

    console.log("开始执行批量转账...");
    // 执行批量转账
    const results = await ethersUtils.batchWriteCall(calls);
    console.log(results);

    // 处理结果
    // results.forEach((result, index) => {
    //   if (result.success) {
    //     console.log(`转账成功 #${index + 1}:`);
    //     console.log(`- 代币地址: ${result.target}`);
    //     console.log(`- 接收地址: ${result.args[0]}`);
    //     console.log(`- 金额: ${ethers.formatEther(result.args[1])} 代币`);
    //     console.log(`- 交易哈希: ${result.transactionHash}`);
    //   } else {
    //     console.error(`转账失败 #${index + 1}:`);
    //     console.error(`- 代币地址: ${result.target}`);
    //     console.error(`- 接收地址: ${result.args[0]}`);
    //     console.error(`- 金额: ${ethers.formatEther(result.args[1])} 代币`);
    //   }
    // });
  } catch (error: any) {
    console.error("批量转账失败:", error.message);
  }
}

// 使用示例
async function main() {
  await batchERC20Transfer();
}

main().catch(console.error);
