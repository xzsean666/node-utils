import { EthersUtils, ethers } from "./ethersUtilsV2";
import IEVM2EVMOnRamp from "../web3config/abis/IEVM2EVMOnRamp.json";
import IRouterClientABI from "../web3config/abis/IRouterClient.json";

interface TokenAmount {
  token?: string;
  amount?: string | bigint;
}

interface MessageParams {
  receiver: string;
  data: string;
  token?: string;
  amount?: string | bigint;
  feeToken?: string;
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
  ethersUtils: EthersUtils;

  constructor(rpcUrl: string, privateKey?: string) {
    this.ethersUtils = new EthersUtils(rpcUrl, {
      privateKey,
    });
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
    return fees.toString();
  }

  createMessage(params: MessageParams): CCIPMessage {
    if (!params.receiver) {
      throw new Error("Receiver address is required");
    }

    // Encode the receiver address using abi.encode
    const abiCoder = new ethers.AbiCoder();
    const formattedReceiver = abiCoder.encode(
      ["address"],
      [ethers.getAddress(params.receiver)]
    );

    // Only add tokenAmount if token or amount is provided
    const tokenAmounts: TokenAmount[] = [];
    if (params.token || params.amount) {
      let formattedToken = ethers.ZeroAddress;
      if (params.token) {
        try {
          formattedToken = ethers.getAddress(params.token);
        } catch (error) {
          throw new Error("Invalid token address format");
        }
      }

      tokenAmounts.push({
        token: formattedToken,
        amount: BigInt(params.amount || "0"),
      });
    }

    return {
      receiver: formattedReceiver,
      data: params.data || "0x",
      tokenAmounts,
      feeToken: params.feeToken
        ? ethers.getAddress(params.feeToken)
        : ethers.ZeroAddress,
      extraArgs: "0x",
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
    const receipt = await this.ethersUtils.web3.getTransactionReceipt(txHash);
    const log = alllogs.find(
      (log) =>
        (log as ethers.LogDescription)?.topic ===
        "0xd0c3c799bf9e2639de44391e7f524d229b2b55f5b1ea94b2bf7da42f7243dddd"
    );
    const messageId = (log as ethers.LogDescription)?.args[0].at(-1);
    const result = {
      messageId,
      blockNumber: Number(receipt?.blockNumber) || 0,
    };
    return result;
  }
  async getAddressCCIPsendStatus({
    fromAddress,
    toAddress,
    sourceRouterAddress,
    destinationChainSelector,
    BLOCKS_TO_SEARCH = 1000,
  }: {
    fromAddress?: string;
    toAddress?: string;
    sourceRouterAddress: string;
    destinationChainSelector: string;
    BLOCKS_TO_SEARCH?: number;
  }) {
    // 输入参数验证 - 只验证必填地址
    const addresses = [sourceRouterAddress];
    if (fromAddress) addresses.push(fromAddress);
    if (toAddress) addresses.push(toAddress);

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
    // console.log(logs[0]);

    // 处理匹配的交易
    const matchingTransactions = await Promise.all(
      logs
        .filter((log: any) => {
          const message = log.args[0];
          const fromMatch =
            !fromAddress ||
            message.sender.toLowerCase() === fromAddress.toLowerCase();
          const toMatch =
            !toAddress ||
            message.receiver.toLowerCase() === toAddress.toLowerCase();
          return fromMatch && toMatch;
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
            data: message.data,
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
    BLOCKS_TO_SEARCH = 1000
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
    const latestBlock = await this.ethersUtils.getLatestBlockNumber();
    const fromBlock = Math.max(0, latestBlock - BLOCKS_TO_SEARCH);
    let status: any = {};
    status.state = "UNTOUCHED";
    // 检查每个OffRamp的状态
    for (const offRamp of matchingOffRamps) {
      const logs = (
        await this.ethersUtils.web3.getLogs({
          address: offRamp.offRamp,
          topics: [
            ethers.id("ExecutionStateChanged(uint64,bytes32,uint8,bytes)"),
            null,
            ethers.zeroPadValue(messageId, 32),
          ],
          fromBlock,
        })
      ).reverse();

      if (logs && logs.length > 0) {
        const iface = new ethers.Interface([
          "event ExecutionStateChanged(uint64 indexed sequenceNumber, bytes32 indexed messageId, uint8 state, bytes returnData)",
        ]);
        const parsedLog = iface.parseLog(logs[0]);
        status.blockNumber = logs[0].blockNumber;
        status.messageId = parsedLog?.args[1];
        status.transactionHash = logs[0].transactionHash;
        if (parsedLog?.args) {
          const state = Number(parsedLog.args[2]);
          switch (state) {
            case 0:
              return status;
            case 1:
              status.state = "IN_PROGRESS";
              return status;
            case 2:
              status.state = "SUCCESS";
              return status;
            case 3:
              status.state = "FAILURE";
              return status;
            default:
              status.state = "UNKNOWN";
              return status;
          }
        }
      }
    }
    return status; // 默认状态
  }
}
