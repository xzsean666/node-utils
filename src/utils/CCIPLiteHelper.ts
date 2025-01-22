import { EthersUtils, ethers } from "./ethersUtils";
import IEVM2EVMOnRamp from "./abis/IEVM2EVMOnRamp.json";
import IRouterClientABI from "./abis/IRouterClient.json";

interface TokenAmount {
  token: string;
  amount: string | bigint;
}

interface MessageParams {
  receiver: string;
  data: string;
  token: string;
  amount: string | bigint;
  feeToken: string;
  gasLimit?: number;
}

interface CCIPMessage {
  receiver: string;
  data: string;
  tokenAmounts: TokenAmount[];
  feeToken: string;
  extraArgs: string;
}
export class CCIPLiteHelper {
  private ethersUtils: EthersUtils;

  constructor(rpcUrl: string) {
    this.ethersUtils = new EthersUtils(rpcUrl);
  }

  async sendTransaction(callData: any) {
    const txResult = await this.ethersUtils.sendTransaction(callData);
    return txResult;
  }

  async getCallData(
    sourceRouterAddress: string,
    destinationChainSelector: string,
    message: CCIPMessage
  ): Promise<any> {
    const useNative = message.feeToken === ethers.ZeroAddress;
    const fee = await this.getFee(
      sourceRouterAddress,
      destinationChainSelector,
      message
    );
    const callData = await this.ethersUtils.encodeDataByABI({
      abi: IRouterClientABI,
      functionName: "ccipSend",
      executeArgs: [destinationChainSelector, message],
      target: sourceRouterAddress,
      value: useNative ? fee : "0",
    });
    return callData;
  }

  async getFee(
    sourceRouterAddress: string,
    destinationChainSelector: string,
    message: CCIPMessage
  ): Promise<string> {
    const routerContract = await this.ethersUtils.getContract(
      sourceRouterAddress,
      IRouterClientABI
    );
    const fees = await routerContract.getFee(destinationChainSelector, message);
    return fees;
  }

  createMessage(params: MessageParams): CCIPMessage {
    let extraArgs = "";
    if (params.gasLimit) {
      extraArgs = this.createExtraArgs(params.gasLimit);
    }

    const tokenAmounts: TokenAmount[] = [
      {
        token: params.token,
        amount: params.amount,
      },
    ];

    return {
      receiver: params.receiver,
      data: params.data,
      tokenAmounts,
      feeToken: params.feeToken,
      extraArgs,
    };
  }

  createExtraArgs(gasLimit: number): string {
    const abiCoder = new ethers.AbiCoder();
    // bytes4(keccak256("CCIP EVMExtraArgsV1")) = 0x97a657c9
    const EVM_EXTRA_ARGS_V1_TAG = "0x97a657c9";
    const encodedArgs = abiCoder.encode(
      ["tuple(uint256)"], // EVMExtraArgsV1 结构体
      [[BigInt(gasLimit)]] // 只需要 gasLimit 参数
    );
    return EVM_EXTRA_ARGS_V1_TAG + encodedArgs.slice(2);
  }

  async getMessageId(txHash: string) {
    const alllogs = await this.ethersUtils.getLogByTxHash(
      txHash,
      IEVM2EVMOnRamp
    );
    const log = alllogs.find(
      (log) =>
        (log as ethers.LogDescription)?.topic ===
        "0xd0c3c799bf9e2639de44391e7f524d229b2b55f5b1ea94b2bf7da42f7243dddd"
    );
    const messageId = (log as ethers.LogDescription)?.args[0].at(-1);
    return messageId;
  }
  async getAddressCCIPsendStatus({
    fromAddress,
    toAddress,
    sourceRouterAddress,
    destinationChainSelector,
    BLOCKS_TO_SEARCH = 1000,
  }: {
    fromAddress: string;
    toAddress: string;
    sourceRouterAddress: string;
    destinationChainSelector: string;
    BLOCKS_TO_SEARCH?: number;
  }) {
    // 输入参数验证
    const addresses = [fromAddress, toAddress, sourceRouterAddress];
    if (!addresses.every((addr) => ethers.isAddress(addr))) {
      throw new Error("Invalid address provided");
    }
    if (!destinationChainSelector) {
      throw new Error("Invalid destination chain selector");
    }

    // 获取 onRamp 地址
    const routerContract = await this.ethersUtils.getContract(
      sourceRouterAddress,
      IRouterClientABI
    );

    const onRamp = await routerContract
      .getOnRamp(destinationChainSelector)
      .catch(() => {
        throw new Error("Failed to fetch onRamp address");
      });

    if (!onRamp) {
      throw new Error("OnRamp not found for the specified chain");
    }

    // 获取区块范围
    const latestBlock = await this.ethersUtils.getLatestBlockNumber();
    const fromBlock = Math.max(0, latestBlock - BLOCKS_TO_SEARCH);

    // 获取并过滤日志
    const logs = await this.ethersUtils.getContractLogs(
      onRamp,
      ["CCIPSendRequested"],
      IEVM2EVMOnRamp,
      {
        fromBlock,
        toBlock: latestBlock,
      }
    );

    // 处理匹配的交易
    const matchingTransactions = await Promise.all(
      logs
        .filter((log: any) => {
          const message = log.args[0];
          return (
            message.sender.toLowerCase() === fromAddress.toLowerCase() &&
            message.receiver.toLowerCase() === toAddress.toLowerCase()
          );
        })
        .map(async (log: any) => {
          const message = log.args[0];
          return {
            messageId: message.messageId,
            sender: message.sender,
            receiver: message.receiver,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
            tokenAmounts: message.tokenAmounts,
            fees: {
              feeToken: message.feeToken,
              feeAmount: message.feeTokenAmount,
            },
          };
        })
    );

    return matchingTransactions;
  }

  async getTransferStatus(
    messageId: string,
    destinationRouterAddress: string,
    sourceChainSelector: string,
    fromBlockNumber?: number
  ) {
    // 验证目标路由地址
    if (!ethers.isAddress(destinationRouterAddress)) {
      throw new Error(
        `参数错误: 目标路由地址 ${destinationRouterAddress} 无效`
      );
    }

    // 验证消息ID
    if (!ethers.isHexString(messageId, 32)) {
      throw new Error(`参数错误: ${messageId} 不是有效的消息ID`);
    }

    // 验证源链选择器
    if (!sourceChainSelector) {
      throw new Error("参数错误: 源链选择器缺失或无效");
    }

    // 获取所有的OffRamps
    const routerContract = await this.ethersUtils.getContract(
      destinationRouterAddress,
      IRouterClientABI
    );

    let offRamps;
    try {
      offRamps = await routerContract.getOffRamps();
    } catch (error) {
      console.log("获取 OffRamps 失败:", error);
      console.log("Router 地址:", destinationRouterAddress);
      throw new Error(`合约调用错误: 无法获取 off-ramps 信息 (${error})`);
    }

    if (!offRamps || offRamps.length === 0) {
      throw new Error("合约调用错误: 未找到任何 off-ramps");
    }
    // 过滤匹配的OffRamps
    const matchingOffRamps = offRamps
      .filter((offRamp: any) => offRamp[0].toString() === sourceChainSelector)
      .map((offRamp) => ({
        sourceChainSelector: offRamp[0].toString(),
        offRamp: offRamp[1],
      }));

    if (matchingOffRamps.length === 0) {
      throw new Error("合约调用错误: 未找到匹配的off-ramp");
    }

    // 获取起始区块
    let fromBlock = fromBlockNumber;
    if (!fromBlock) {
      const blockNumber = await this.ethersUtils.getLatestBlockNumber();
      fromBlock = blockNumber - 1000; // 默认查询最近1000个区块
    }

    // 检查每个OffRamp的状态
    for (const offRamp of matchingOffRamps) {
      const logs = await this.ethersUtils.web3.getLogs({
        address: offRamp.offRamp,
        topics: [
          ethers.id("ExecutionStateChanged(uint64,bytes32,uint8,bytes)"),
          null,
          ethers.zeroPadValue(messageId, 32),
        ],
        fromBlock,
      });

      if (logs && logs.length > 0) {
        const iface = new ethers.Interface([
          "event ExecutionStateChanged(uint64 indexed sequenceNumber, bytes32 indexed messageId, uint8 state, bytes returnData)",
        ]);
        const parsedLog = iface.parseLog(logs[0]);
        if (parsedLog?.args) {
          const state = Number(parsedLog.args[2]);
          switch (state) {
            case 0:
              return "UNTOUCHED";
            case 1:
              return "IN_PROGRESS";
            case 2:
              return "SUCCESS";
            case 3:
              return "FAILURE";
            default:
              return "UNKNOWN";
          }
        }
      }
    }
    return "UNTOUCHED"; // 默认状态
  }
}
