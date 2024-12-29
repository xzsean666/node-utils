import { ethers, HDNodeWallet } from "ethers";
import detectEthereumProvider from "@metamask/detect-provider";

declare global {
  interface Window {
    ethereum: any;
  }
}

export class EthersUtils {
  web3: ethers.JsonRpcProvider | ethers.BrowserProvider;
  NODE_PROVIDER?: string;
  private privateKey?: string;
  account?: string;
  config?: any;
  batchCallAddress?: string;
  constructor(NODE_PROVIDER?: string, config?: any) {
    this.NODE_PROVIDER = NODE_PROVIDER;
    this.privateKey = config?.privateKey;
    this.config = config;
    this.batchCallAddress = config?.batchCallAddress;

    if (NODE_PROVIDER) {
      this.web3 = new ethers.JsonRpcProvider(NODE_PROVIDER);
    } else {
      this.web3 = null as any;
      this.init();
    }
  }

  private async init() {
    this.web3 = await this.setup();
  }

  private async setup(): Promise<ethers.BrowserProvider> {
    const provider = await detectEthereumProvider();

    if (!provider || provider !== window.ethereum) {
      throw new Error("MetaMask未安装或检测到多个钱包插件");
    }

    if (!provider.isMetaMask) {
      throw new Error("请安装MetaMask钱包");
    }

    return new ethers.BrowserProvider(window.ethereum);
  }

  async getLatestBlockNumber(): Promise<number> {
    if (!this.web3) {
      throw new Error("未找到有效的Provider");
    }
    try {
      const blockNumber = await this.web3.getBlockNumber();
      return blockNumber;
    } catch (error: any) {
      throw new Error(`获取最新区块号失败: ${error.message}`);
    }
  }
  async getStorageAt(contractAddress: string, slot: string): Promise<string> {
    if (!this.web3) {
      throw new Error("未找到有效的Provider");
    }
    try {
      const data = await this.web3.getStorage(contractAddress, slot);
      return data;
    } catch (error: any) {
      throw new Error(`获取存储槽数据失败: ${error.message}`);
    }
  }

  async getAccounts() {
    if (this.privateKey && this.web3 instanceof ethers.JsonRpcProvider) {
      const wallet = new ethers.Wallet(this.privateKey);
      return wallet.address;
    } else {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      this.account = accounts[0];
      return this.account;
    }
  }
  getEventTopics(events: any[]) {
    return events.map((event) => {
      const signature = `${event.name}(${event.inputs
        .map((input) => input.type)
        .join(",")})`;
      return ethers.id(signature);
    });
  }
  getSignerAddress() {
    return new ethers.Wallet(
      this.privateKey!,
      this.web3 as ethers.JsonRpcProvider
    ).address;
  }

  toBytes32String(text: string) {
    return ethers.zeroPadValue(ethers.toUtf8Bytes(text), 32);
  }
  async deriveWallets(privateKey: string, index: number = 0) {
    if (!privateKey) {
      throw new Error("私钥不能为空");
    }

    try {
      // 创建钱包实例
      const wallet = new ethers.Wallet(privateKey);

      // 从钱包创建 HD 节点
      const hdNode = ethers.HDNodeWallet.fromSeed(wallet.privateKey);

      const path = `m/44'/60'/0'/0/${index}`;
      const derivedWallet = hdNode.derivePath(path);

      if (!(derivedWallet instanceof HDNodeWallet)) {
        throw new Error("钱包派生失败");
      }

      return {
        address: derivedWallet.address,
        privateKey: derivedWallet.privateKey,
        path,
      };
    } catch (error: any) {
      throw new Error(`派生钱包失败: ${error.message}`);
    }
  }
  async setDeriveWallets(index: number = 0) {
    const wallet = await this.deriveWallets(this.privateKey!, index);
    this.privateKey = wallet.privateKey;
    this.account = wallet.address;
  }
  // 设置私钥
  setPrivateKey(privateKey: string) {
    this.privateKey = privateKey;
  }
  setNODE_PROVIDER(NODE_PROVIDER: string) {
    this.NODE_PROVIDER = NODE_PROVIDER;
  }

  async sendTransaction(
    to: string,
    data?: string,
    value: string = "0"
  ): Promise<string> {
    if (!this.web3) {
      throw new Error("未找到有效的Provider");
    }

    try {
      if (this.privateKey && this.web3 instanceof ethers.JsonRpcProvider) {
        return await this.sendWithPrivateKey(to, data, value);
      } else {
        return await this.sendWithMetaMask(to, data, value);
      }
    } catch (error: any) {
      throw new Error(`交易发送失败: ${error.message}`);
    }
  }

  private async sendWithPrivateKey(
    to: string,
    data?: string,
    value: string = "0"
  ): Promise<string> {
    const signer = new ethers.Wallet(
      this.privateKey!,
      this.web3 as ethers.JsonRpcProvider
    );
    const tx = await signer.sendTransaction({
      to,
      data,
      value: ethers.parseEther(value),
    });

    await tx.wait();
    return tx.hash;
  }

  private async sendWithMetaMask(
    to: string,
    data?: string,
    value: string = "0"
  ): Promise<string> {
    const fromAddress = await this.getAccounts();
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          to,
          from: fromAddress,
          data: data?.startsWith("0x") ? data : data ? "0x" + data : undefined,
          value: ethers.parseEther(value).toString(),
        },
      ],
    });

    const txResponse = await this.web3.getTransaction(txHash);
    await txResponse?.wait();
    return txHash;
  }

  async encodeDataByABI(
    abi: any[],
    functionName: string,
    excuteArgs: any[],
    target: string = "0x0000000000000000000000000000000000000000"
  ) {
    const iface = new ethers.Interface(abi);
    // Encode the function call
    const data = iface.encodeFunctionData(functionName, excuteArgs);
    return { target, data, abi, functionName, excuteArgs };
  }

  async excuteReadContract(
    contractAddress: string,
    abi: any,
    functionName: any,
    excuteArgs: any[] | undefined = [],
    blockNumber?: number
  ) {
    const contract = new ethers.Contract(contractAddress, abi, this.web3);

    try {
      const overrides = blockNumber ? { blockTag: blockNumber } : {};
      const result = await contract[functionName](...excuteArgs, overrides);
      return result;
    } catch (error: any) {
      console.error(`Error reading contract data from ${functionName}:`, error);
      throw error;
    }
  }
  async excuteCallStaticContract(
    contractAddress: string,
    abi: any,
    functionName: string,
    excuteArgs: any[] = []
  ) {
    try {
      const contract = new ethers.Contract(contractAddress, abi, this.web3);
      return await contract[functionName].staticCall(...excuteArgs);
    } catch (error: any) {
      throw new Error(`静态调用合约失败 (${functionName}): ${error.message}`);
    }
  }

  async excuteWriteContract(
    contractAddress: string,
    abi: any,
    functionName: string,
    excuteArgs: any[]
  ) {
    const data = await this.encodeDataByABI(abi, functionName, excuteArgs);
    const txhash = await this.sendTransaction(contractAddress, data.data);
    return txhash;
  }
  async getRawContractLogs(
    contractAddresses: string | string[],
    eventSignatures: string | string[],
    filter: {
      fromBlock?: number | string;
      toBlock?: number | string;
      topics?: string[];
    } = {}
  ) {
    try {
      // 确保地址和事件签名都是数组格式
      const addresses = Array.isArray(contractAddresses)
        ? contractAddresses
        : [contractAddresses];
      const signatures = Array.isArray(eventSignatures)
        ? eventSignatures
        : [eventSignatures];

      const topics = signatures.map((signature) => ethers.id(signature));
      const logs = await this.web3.getLogs({
        address: addresses,
        topics: [topics, ...(filter.topics || [])],
        fromBlock: filter.fromBlock || 0,
        toBlock: filter.toBlock || "latest",
      });

      return logs;
    } catch (error: any) {
      throw new Error(`获取合约日志失败: ${error.message}`);
    }
  }

  async getContractLogs(
    contractAddresses: string | string[],
    eventNames: string | string[],
    abi: any[],
    filter: {
      fromBlock?: number | string;
      toBlock?: number | string;
      topics?: string[];
    } = {}
  ) {
    try {
      // 确保地址和事件名都是数组格式
      const addresses = Array.isArray(contractAddresses)
        ? contractAddresses
        : [contractAddresses];

      // 过滤出事件 ABI
      const eventAbis = abi.filter((item) => item.type === "event");

      // 使用 getEventTopics 获取事件主题
      const topics = [this.getEventTopics(eventAbis)];

      const logs = await this.web3.getLogs({
        address: addresses,
        topics: [...topics, ...(filter.topics || [])],
        fromBlock: filter.fromBlock || 0,
        toBlock: filter.toBlock || "latest",
      });

      // 创建合约接口用于解析日志
      const iface = new ethers.Interface(abi);

      return logs.map((log) => {
        try {
          const parsedLog = iface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          return {
            ...log,
            args: parsedLog?.args,
            name: parsedLog?.name,
            signature: parsedLog?.signature,
          };
        } catch (error) {
          console.warn(`解析日志失败:`, error);
          return log;
        }
      });
    } catch (error: any) {
      throw new Error(`获取合约日志失败: ${error.message}`);
    }
  }

  async getContract(address: string, abi: any) {
    if (!this.web3) {
      throw new Error("未找到有效的Provider");
    }
    // 直接使用 getAddress 规范化地址，避免 ENS 解析
    const normalizedAddress = ethers.getAddress(address);
    const contract = new ethers.Contract(normalizedAddress, abi, this.web3);
    return contract;
  }

  async batchReadCall(
    calls: Array<{
      target: string;
      data: string;
      abi: any[];
      functionName: string;
      excuteArgs: any[];
    }>,
    blockNumber?: number,
    batchLimit: number = 1000
  ) {
    const IBatchCallABI = batchCallABI;

    if (!this.batchCallAddress) {
      throw new Error("BatchCallAddress not provided!");
    }

    const results: Array<{
      target: string;
      success: boolean;
      decodedData: any;
      function: string;
      args: any[];
    }> = [];
    // 按batchLimit分批处理
    for (let i = 0; i < calls.length; i += batchLimit) {
      const batchCalls = calls.slice(i, i + batchLimit);
      console.log(`处理批次 ${i / batchLimit + 1}, 大小: ${batchCalls.length}`);

      // 执行批量调用
      const [successes, returnData] = await this.excuteReadContract(
        this.batchCallAddress,
        IBatchCallABI,
        "batchStaticCall",
        [
          batchCalls.map((call) => ({
            target: call.target,
            callData: call.data,
          })),
        ],
        blockNumber
      );

      // 解码返回结果
      const batchResults = await Promise.all(
        returnData.map(async (data: string, index: number) => {
          const call = batchCalls[index];

          if (!successes[index]) {
            return {
              target: call.target,
              success: false,
              decodedData: null,
              function: call.functionName,
              args: call.excuteArgs,
            };
          }

          try {
            const decodedData = await this.decodeDataByABI(
              call.abi,
              call.functionName,
              data
            );
            return {
              target: call.target,
              success: true,
              decodedData,
              function: call.functionName,
              args: call.excuteArgs,
            };
          } catch (error) {
            console.warn(`解码数据失败 (${call.functionName}):`, error);
            return {
              target: call.target,
              success: true,
              decodedData: data,
              function: call.functionName,
              args: call.excuteArgs,
            };
          }
        })
      );

      results.push(...batchResults);
    }

    return results;
  }

  async getContractCreationInfo(contractAddress: string): Promise<{
    timestamp: number;
    blockNumber: number;
    transactionHash: string;
  }> {
    try {
      // 验证地址是否为合约
      const code = await this.web3.getCode(contractAddress);
      if (code === "0x") {
        throw new Error("供的地址不是合约地址");
      }

      // 直接获取该地址的第一笔交易记录
      const logs = await this.web3.getLogs({
        address: contractAddress,
        fromBlock: 0,
        toBlock: "latest",
        topics: [],
      });

      if (logs.length === 0) {
        throw new Error("该合约没有产生任何的LOG。");
      }

      // 获取最早的交易记录
      const firstLog = logs[0];
      const block = await this.web3.getBlock(firstLog.blockNumber);
      return {
        timestamp: Number(block?.timestamp),
        blockNumber: firstLog.blockNumber,
        transactionHash: firstLog.transactionHash,
      };
    } catch (error: any) {
      throw new Error(`获取合约创建时失败: ${error.message}`);
    }
  }

  // 添加一个新的方法用于在特定区块调用合约方法
  async callContractMethodAtBlock(
    contract: ethers.Contract,
    methodName: string,
    args: any[] = [],
    blockNumber?: number | string
  ) {
    try {
      if (blockNumber) {
        return await contract[methodName](...args, { blockTag: blockNumber });
      }
      return await contract[methodName](...args);
    } catch (error: any) {
      throw new Error(`调用合约方法失败 (${methodName}): ${error.message}`);
    }
  }
  /**
   * 获取指定币在指定区块区间内的事件相关地址
   * @param tokenAddresses 代币地址数组
   * @param fromBlock 起始区块
   * @param toBlock 束区块
   * @param abi 可选的合约 ABI，如果不传则使用默认的 EVENTS ABI
   * @returns Promise<string[]> 返回涉及的地址数组
   */
  public async getTokenEventsAddresses(
    tokenAddresses: string[],
    abi: any[],
    fromBlock?: number,
    toBlock?: number | string
  ): Promise<string[]> {
    const addresses: Set<string> = new Set();
    const eventNames = abi
      .filter((item) => item.type === "event")
      .map((item) => item.name);

    const logs = await this.getContractLogs(
      tokenAddresses, // 直接传入地址数组
      eventNames, // 事件名称数组
      abi, // ABI
      {
        fromBlock,
        toBlock,
      }
    );

    logs.forEach((log: any) => {
      if ("args" in log && log.args) {
        if (log.args.from) addresses.add(log.args.from);
        if (log.args.to) addresses.add(log.args.to);
      }
    });

    // 移除零地址
    const blackList = [
      "0x000000000000000000000000000000000000dEaD",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000001",
    ];
    blackList.forEach((address) => addresses.delete(address));

    return Array.from(addresses);
  }

  async decodeDataByABI(abi: any[], functionName: string, data: string) {
    const iface = new ethers.Interface(abi);
    // 解返回数据
    const decodedData = iface.decodeFunctionResult(functionName, data);
    return decodedData;
  }

  async checkAddress(address: string): Promise<string> {
    try {
      // 检查地址是否为空
      if (!address) {
        console.error("地址不能为空");
        return "";
      }

      // 检查地址格式是否正确
      if (!ethers.isAddress(address)) {
        console.error("无效的以太坊地址格式");
        return "";
      }

      // 检查地址是否为零地址
      const zeroAddress = "0x0000000000000000000000000000000000000000";
      if (address.toLowerCase() === zeroAddress.toLowerCase()) {
        console.error("不能使用零地址");
        return "";
      }

      // 返回规范化的地址
      return ethers.getAddress(address);
    } catch (error) {
      console.error("检查地址时发生错误:", error);
      return "";
    }
  }

  async getBlockTimestamp(blockNumber: number | string): Promise<number> {
    if (!this.web3) {
      throw new Error("未找到有效的Provider");
    }

    try {
      const block = await this.web3.getBlock(blockNumber);
      if (!block) {
        throw new Error("未找到指定区块");
      }
      return Number(block.timestamp);
    } catch (error: any) {
      throw new Error(`获取区块时间戳失败: ${error.message}`);
    }
  }

  async batchWriteCall(
    calls: Array<{
      target: string;
      data: string;
      abi: any[];
      functionName: string;
      excuteArgs: any[];
    }>,
    batchLimit: number = 1000
  ) {
    const IBatchCallABI = batchCallABI;

    if (!this.batchCallAddress) {
      throw new Error("BatchCallAddress未提供！");
    }

    const results: Array<{
      target: string;
      success: boolean;
      transactionHash: string;
      function: string;
      args: any[];
    }> = [];

    // 按batchLimit分批处理
    for (let i = 0; i < calls.length; i += batchLimit) {
      const batchCalls = calls.slice(i, i + batchLimit);
      console.log(`处理批次 ${i / batchLimit + 1}, 大小: ${batchCalls.length}`);

      try {
        // 执行批量调用
        const txHash = await this.excuteWriteContract(
          this.batchCallAddress,
          IBatchCallABI,
          "batchCall",
          [
            batchCalls.map((call) => ({
              target: call.target,
              callData: call.data,
            })),
          ]
        );

        // 为每个调用添加结果
        const batchResults = batchCalls.map((call) => ({
          target: call.target,
          success: true,
          transactionHash: txHash,
          function: call.functionName,
          args: call.excuteArgs,
        }));

        results.push(...batchResults);
      } catch (error: any) {
        console.error(`批量写入调用失败:`, error);

        // 为失败的批次中的所有调用添加失败结果
        const failedResults = batchCalls.map((call) => ({
          target: call.target,
          success: false,
          transactionHash: "",
          function: call.functionName,
          args: call.excuteArgs,
        }));

        results.push(...failedResults);
        throw new Error(`批量写入调用失败: ${error.message}`);
      }
    }

    return results;
  }
}

export async function encodeDataByABI(
  abi: any[],
  functionName: string,
  excuteArgs: any[],
  target: string = "0x0000000000000000000000000000000000000000"
) {
  const iface = new ethers.Interface(abi);
  // Encode the function call
  const data = iface.encodeFunctionData(functionName, excuteArgs);
  return { target, data, abi, functionName, excuteArgs };
}

export async function functionsWithParamTypesFromABI(abi: any[]) {
  const functionNames: string[] = [];
  const functionArgs: { [key: string]: string[] } = {};

  abi
    .filter((entry) => entry.type === "function")
    .forEach((func) => {
      const paramTypes = func.inputs.map((input: any) => input.type);
      functionNames.push(func.name);
      functionArgs[func.name] = paramTypes;
    });

  return { functionNames, functionArgs };
}
export const batchCallABI = [
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "target",
            type: "address",
          },
          {
            internalType: "bytes",
            name: "callData",
            type: "bytes",
          },
        ],
        internalType: "struct Multicall[]",
        name: "calls",
        type: "tuple[]",
      },
    ],
    name: "batchCall",
    outputs: [
      {
        internalType: "bool[]",
        name: "successes",
        type: "bool[]",
      },
      {
        internalType: "bytes[]",
        name: "results",
        type: "bytes[]",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "target",
        type: "address",
      },
      {
        indexed: false,
        internalType: "string",
        name: "reason",
        type: "string",
      },
    ],
    name: "CallError",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "target",
        type: "address",
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "data",
        type: "bytes",
      },
    ],
    name: "CallResult",
    type: "event",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "target",
            type: "address",
          },
          {
            internalType: "bytes",
            name: "callData",
            type: "bytes",
          },
        ],
        internalType: "struct Multicall[]",
        name: "calls",
        type: "tuple[]",
      },
    ],
    name: "batchStaticCall",
    outputs: [
      {
        internalType: "bool[]",
        name: "successes",
        type: "bool[]",
      },
      {
        internalType: "bytes[]",
        name: "results",
        type: "bytes[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];
