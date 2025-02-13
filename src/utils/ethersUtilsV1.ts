import { ethers, HDNodeWallet, Log } from "ethers";
export { ethers };

interface LogFilter {
  fromBlock?: number | string;
  toBlock?: number | string;
  topics?: string[];
}
export class EthersUtils {
  web3: ethers.JsonRpcProvider | ethers.BrowserProvider;
  NODE_PROVIDER?: string | ethers.BrowserProvider;
  private privateKey?: string;
  account?: string;
  config?: any;
  batchCallAddress?: string;
  ethers: typeof ethers;
  constructor(NODE_PROVIDER: string | ethers.BrowserProvider, config?: any) {
    this.NODE_PROVIDER = NODE_PROVIDER;
    this.privateKey = config?.privateKey;
    this.config = config;
    this.batchCallAddress = config?.batchCallAddress;
    this.ethers = ethers;
    if (typeof NODE_PROVIDER == "string") {
      this.web3 = new ethers.JsonRpcProvider(NODE_PROVIDER);
    } else if (NODE_PROVIDER instanceof ethers.BrowserProvider) {
      this.web3 = NODE_PROVIDER;
    }
  }

  public async deployContract(abi: any[], bytecode: string): Promise<any> {
    try {
      const signer = new ethers.Wallet(this.privateKey || "", this.web3);
      const factory = new ethers.ContractFactory(abi, bytecode, signer);
      const contract = await factory.deploy();
      await contract.waitForDeployment();
      console.log(`合约已部署到: ${await contract.getAddress()}`);
      return contract;
    } catch (error) {
      throw new Error(`部署合约失败: ${error}`);
    }
  }
  async getBalance(address: string): Promise<string> {
    return (await this.web3.getBalance(address)).toString();
  }
  static async getRPCStatus(
    rpcs: string[]
  ): Promise<{ [key: string]: { blockNumber: number; latency: number } }> {
    const statuses = await Promise.all(
      rpcs.map(async (rpc) => {
        const startTime = Date.now(); // 记录开始时间
        const provider = new ethers.JsonRpcProvider(rpc);
        let blockNumber: number;
        let latency: number;

        try {
          blockNumber = await provider.getBlockNumber();
          latency = Date.now() - startTime; // 计算延迟
        } catch (error) {
          blockNumber = 0; // 如果出错，设置区块号为0
          latency = 0; // 如果出错，延迟为0
        }

        return { rpc, blockNumber, latency };
      })
    );

    // 将结果转换为字典格式
    return statuses.reduce((acc, { rpc, blockNumber, latency }) => {
      acc[rpc] = { blockNumber, latency };
      return acc;
    }, {} as { [key: string]: { blockNumber: number; latency: number } });
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
  async cancelPendingTransaction(
    nonce: number,
    gasPriceMultiplierMAX: number = 10,
    step: number = 0.5
  ) {
    if (!this.web3) {
      throw new Error("未找到有效的Provider");
    }

    let multiplier = 1;
    let lastError;

    while (multiplier <= gasPriceMultiplierMAX) {
      try {
        // 获取当前gas价格
        const currentGasPrice = await this.web3.getFeeData();
        const newGasPrice = BigInt(
          Math.floor(Number(currentGasPrice.gasPrice) * multiplier)
        );

        console.log(`尝试取消交易，当前gas倍数: ${multiplier}x`);

        // 构建空交易
        const tx = {
          to: await this.getAccounts(), // 发送给自己
          value: 0,
          nonce: nonce,
          gasLimit: 21000, // 基本转账的gas限制
          gasPrice: newGasPrice,
        };

        // 发送交易
        let signer;
        if (this.privateKey) {
          signer = new ethers.Wallet(this.privateKey, this.web3);
        } else {
          signer = await this.web3.getSigner();
        }

        const transaction = await signer.sendTransaction(tx);
        console.log("取消交易已发送,Hash:", transaction.hash);

        return transaction;
      } catch (error: any) {
        lastError = error;
        console.log(`使用 ${multiplier}x 倍数取消失败，尝试更高的gas价格`);
        multiplier += step;
      }
    }

    throw new Error(
      `取消Pending交易失败 (尝试至 ${gasPriceMultiplierMAX}x): ${lastError?.message}`
    );
  }

  async getAccounts() {
    if (this.privateKey && this.web3 instanceof ethers.JsonRpcProvider) {
      const wallet = new ethers.Wallet(this.privateKey);
      return wallet.address;
    } else if (this.web3 instanceof ethers.BrowserProvider) {
      try {
        const signer = await this.web3.getSigner();
        return await signer.getAddress();
      } catch (error: any) {
        throw new Error(`获取浏览器账户失败: ${error.message}`);
      }
    }
  }
  getEventTopics(events: any[]) {
    const processType = (input: any): string => {
      // 处理基础 tuple 类型
      if (input.type === "tuple") {
        const components = input.components
          .map((comp: any) => processType(comp))
          .join(",");
        return `(${components})`;
      }
      // 处理 tuple 数组
      if (input.type === "tuple[]") {
        const components = input.components
          .map((comp: any) => processType(comp))
          .join(",");
        return `(${components})[]`;
      }
      // 返回基本类型
      return input.type;
    };

    return events.map((event) => {
      const signature = `${event.name}(${event.inputs
        .map((input: any) => processType(input))
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
  async getDeriveWallets(index: number = 0) {
    const wallet = await this.deriveWallets(this.privateKey!, index);
    return wallet;
  }
  // 设置私钥
  setPrivateKey(privateKey: string) {
    this.privateKey = privateKey;
  }
  setNODE_PROVIDER(NODE_PROVIDER: string) {
    this.NODE_PROVIDER = NODE_PROVIDER;
  }

  async sendTransaction(call: {
    target: string;
    data?: string;
    value?: string;
    abi?: any[];
    functionName?: string;
    executeArgs?: any[];
  }): Promise<{
    target: string;
    success: boolean;
    transactionHash: string;
    function: string;
    args: any[];
    decodedData?: (ethers.LogDescription | null)[] | null;
    error?: any;
  }> {
    if (!this.web3) {
      throw new Error("未找到有效的Provider");
    }

    try {
      let txHash: string;
      let decodedLogs: (ethers.LogDescription | null)[] | null = null;

      // 保留原有的 Provider 判断逻辑
      if (this.privateKey && this.web3 instanceof ethers.JsonRpcProvider) {
        txHash = await this.sendWithPrivateKey(
          call.target,
          call.data,
          call.value || "0"
        );
      } else if (this.web3 instanceof ethers.BrowserProvider) {
        txHash = await this.sendWithBrowserProvider(
          call.target,
          call.data,
          call.value || "0"
        );
      } else {
        txHash = await this.sendWithMetaMask(
          call.target,
          call.data,
          call.value || "0"
        );
      }

      // 获取交易收据并解码日志
      const receipt = await this.web3.getTransactionReceipt(txHash);

      try {
        if (call.abi) {
          const iface = new ethers.Interface(call.abi);
          decodedLogs =
            receipt?.logs
              .map((log) => {
                try {
                  return iface.parseLog({
                    topics: [...(log as ethers.Log).topics],
                    data: (log as ethers.Log).data,
                  });
                } catch (e) {
                  console.warn("解析单个日志失败:", e);
                  return null;
                }
              })
              .filter(Boolean) || null;
        }
      } catch (e) {
        console.warn("解析交易日志失败:", e);
        decodedLogs = null;
      }

      return {
        target: call.target,
        success: true,
        transactionHash: txHash,
        function: call.functionName || "",
        args: call.executeArgs || [],
        decodedData: decodedLogs,
      };
    } catch (error: any) {
      console.error("交易发送失败:", error);
      return {
        target: call.target,
        success: false,
        transactionHash: "",
        function: call.functionName || "",
        args: call.executeArgs || [],
        decodedData: null,
        error: error,
      };
    }
  }
  private async sendWithBrowserProvider(
    to: string,
    data?: string,
    value: string = "0"
  ): Promise<string> {
    if (!this.web3 || !(this.web3 instanceof ethers.BrowserProvider)) {
      throw new Error("未找到有效的BrowserProvider");
    }

    try {
      // 获取签名者
      const signer = await this.web3.getSigner();

      // 构建交易对象
      const tx = {
        to,
        data: data?.startsWith("0x") ? data : data ? "0x" + data : undefined,
        value: value === "0" ? "0x0" : ethers.parseEther(value),
      };

      // 发送交易
      const txResponse = await signer.sendTransaction(tx);

      // 等待交易被确认
      const receipt = await txResponse.wait();

      if (!receipt) {
        throw new Error("交易未被确认");
      }

      // 返回交易哈希
      return txResponse.hash;
    } catch (error: any) {
      console.error("发送交易失败:", error);
      throw new Error(`发送交易失败: ${error.message}`);
    }
  }

  private async sendWithPrivateKey(
    to: string,
    data?: string,
    value: string = "0"
  ): Promise<string> {
    if (!this.privateKey) {
      throw new Error("Private key is required");
    }
    const signer = new ethers.Wallet(this.privateKey, this.web3);
    const tx = await signer.sendTransaction({
      to,
      data,
      value: value,
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
    const hexValue = value === "0" ? "0x0" : this.ethers.toQuantity(value);
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          to,
          from: fromAddress,
          data: data?.startsWith("0x") ? data : data ? "0x" + data : undefined,
          value: hexValue, // 使用转换后的十六进制值
        },
      ],
    });
    const txResponse = await this.web3.getTransaction(txHash);
    await txResponse?.wait();
    return txHash;
  }

  async encodeDataByABI(params: {
    abi: any[];
    functionName: string;
    executeArgs: any[];
    target: string;
    value?: string;
  }) {
    const iface = new ethers.Interface(params.abi);
    // Encode the function call
    const data = iface.encodeFunctionData(
      params.functionName,
      params.executeArgs
    );
    return {
      target: params.target,
      data,
      abi: params.abi,
      functionName: params.functionName,
      executeArgs: params.executeArgs,
      value: params.value,
    };
  }

  async excuteReadContract(
    contractAddress: string,
    abi: any,
    functionName: any,
    executeArgs: any[] | undefined = [],
    blockNumber?: number
  ) {
    const contract = new ethers.Contract(contractAddress, abi, this.web3);

    try {
      const overrides = blockNumber ? { blockTag: blockNumber } : {};
      const result = await contract[functionName](...executeArgs, overrides);
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
    executeArgs: any[] = []
  ) {
    try {
      const contract = new ethers.Contract(contractAddress, abi, this.web3);
      return await contract[functionName].staticCall(...executeArgs);
    } catch (error: any) {
      throw new Error(`静态调用合约失败 (${functionName}): ${error.message}`);
    }
  }

  async excuteWriteContract(
    contractAddress: string,
    abi: any,
    functionName: string,
    executeArgs: any[]
  ) {
    const data = await this.encodeDataByABI({
      abi: abi,
      functionName: functionName,
      executeArgs: executeArgs,
      target: contractAddress,
    });
    const txResult = await this.sendTransaction(data);
    return txResult;
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
    abi: any,
    filter: LogFilter = {},
    initialBatchSize: number = 50000
  ) {
    try {
      // 1. 基础验证
      if (!contractAddresses || !abi) {
        throw new Error("合约地址和ABI是必需的");
      }

      const addresses = Array.isArray(contractAddresses)
        ? contractAddresses
        : [contractAddresses];
      const events = Array.isArray(eventNames) ? eventNames : [eventNames];

      // 2. 事件ABI过滤
      const abiArray = Array.isArray(abi) ? abi : [abi];
      const eventAbis = abiArray
        .filter((item: any) => item.type === "event")
        .filter((item: any) => events.includes(item.name));

      if (eventAbis.length === 0) {
        throw new Error("未找到指定的事件定义");
      }
      // 3. 生成事件topics
      const eventTopics = this.getEventTopics(eventAbis);
      // 4. 获取区块范围
      const fromBlock = BigInt(filter.fromBlock || 0);
      const toBlock =
        filter.toBlock === "latest"
          ? await this.web3.getBlockNumber()
          : BigInt(filter.toBlock || (await this.web3.getBlockNumber()));

      // 5. 批量处理设置
      let batchSize = initialBatchSize;
      const MIN_BATCH_SIZE = 1000;
      let currentBlock = fromBlock;
      const allLogs: Log[] = [];

      // 6. 批量获取日志
      while (currentBlock <= toBlock) {
        try {
          const endBlock = BigInt(
            Math.min(Number(currentBlock) + batchSize - 1, Number(toBlock))
          );

          console.log(`获取日志: ${currentBlock} 至 ${endBlock}`);

          const logs = await this.web3.getLogs({
            address: addresses,
            topics: [eventTopics, ...(filter.topics || [])],
            fromBlock: currentBlock,
            toBlock: endBlock,
          });

          allLogs.push(...logs);
          currentBlock = endBlock + BigInt(1);

          // 如果成功了，可以尝试增加批次大小
          if (batchSize < initialBatchSize) {
            batchSize = Math.min(batchSize * 2, initialBatchSize);
          }
        } catch (error) {
          console.warn(
            `获取区块 ${currentBlock} 至 ${
              currentBlock + BigInt(batchSize)
            } 的日志失败`
          );

          // 减小批次大小并重试
          batchSize = Math.floor(batchSize / 2);

          if (batchSize < MIN_BATCH_SIZE) {
            throw new Error(
              `批次大小 ${batchSize} 小于最小值 ${MIN_BATCH_SIZE}`
            );
          }

          console.log(`减小批次大小至 ${batchSize} 并重试`);
          continue;
        }
      }

      // 7. 解析日志

      const contract = new ethers.Contract(addresses[0], abi, this.web3);
      return allLogs
        .map((log: Log) => {
          try {
            const parsedLog = contract.interface.parseLog({
              topics: [...log.topics],
              data: log.data,
            });

            if (!parsedLog || !events.includes(parsedLog.name)) {
              return null;
            }

            return {
              ...log,
              args: parsedLog.args,
              name: parsedLog.name,
              signature: parsedLog.signature,
              eventFragment: parsedLog.fragment,
              decoded: true,
            };
          } catch (error) {
            console.warn(
              `解析日志失败 (blockNumber: ${log.blockNumber}):`,
              error
            );
            return {
              ...log,
              args: null,
              decoded: false,
            };
          }
        })
        .filter(Boolean);
    } catch (error: any) {
      throw new Error(`获取合约日志失败: ${error.message}`);
    }
  }

  async getLogByTxHash(txHash: string, abi?: any) {
    const receipt = await this.web3.getTransactionReceipt(txHash);
    if (!receipt) {
      throw new Error("Transaction receipt not found");
    }
    if (!abi) {
      return receipt.logs;
    }
    const iface = new ethers.Interface(abi);
    const parsedLogs = receipt.logs
      .map((log) => {
        try {
          return iface.parseLog({
            topics: [...(log as ethers.Log).topics],
            data: (log as ethers.Log).data,
          });
        } catch (error) {
          console.warn(`解析日志失败:`, error);
          return null;
        }
      })
      .filter(Boolean);
    return parsedLogs;
  }

  getContract(address: string, abi: any) {
    if (!this.web3) {
      throw new Error("未找到有效的Provider");
    }
    // 直接使用 getAddress 规范化地址，避免 ENS 解析
    const normalizedAddress = ethers.getAddress(address);
    const contract = new ethers.Contract(normalizedAddress, abi, this.web3);
    return contract;
  }
  async getContractWithSigner(address: string, abi: any) {
    if (!this.privateKey) {
      throw new Error("私钥不能为空");
    }
    const signer = new ethers.Wallet(this.privateKey, this.web3);
    const contract = new ethers.Contract(address, abi, signer);
    return contract;
  }

  async batchReadCall(
    calls: Array<{
      target: string;
      data: string;
      abi: any[];
      functionName: string;
      executeArgs: any[];
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
              args: call.executeArgs,
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
              args: call.executeArgs,
            };
          } catch (error) {
            console.warn(`解码数据失败 (${call.functionName}):`, error);
            return {
              target: call.target,
              success: true,
              decodedData: data,
              function: call.functionName,
              args: call.executeArgs,
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
      executeArgs: any[];
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
        const txResult = await this.excuteWriteContract(
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

        const batchResults = batchCalls.map((call) => ({
          target: call.target,
          success: true,
          transactionHash: txResult.transactionHash,
          function: call.functionName,
          args: call.executeArgs,
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
          args: call.executeArgs,
        }));

        results.push(...failedResults);
        throw new Error(`批量写入调用失败: ${error.message}`);
      }
    }

    return results;
  }
  async estimateGasCost(params: {
    target: string;
    abi: any[];
    functionName: string;
    executeArgs?: any[];
    value?: string;
  }): Promise<{
    gasLimit: bigint;
    gasPrice: bigint;
    estimatedCost: bigint;
  }> {
    try {
      const contract = new ethers.Contract(
        params.target,
        params.abi,
        this.web3
      );

      // 获取当前 gas 价格
      const feeData = await this.web3.getFeeData();
      const gasPrice = feeData.gasPrice || BigInt(0);

      // 估算 gas 限制
      const gasLimit = await contract[params.functionName].estimateGas(
        ...(params.executeArgs || []),
        {
          value: params.value ? BigInt(params.value) : undefined,
        }
      );

      // 计算预估成本 (gasLimit * gasPrice)
      const estimatedCost = gasLimit * gasPrice;

      return {
        gasLimit,
        gasPrice,
        estimatedCost,
      };
    } catch (error: any) {
      throw new Error(`估算gas成本失败: ${error.message}`);
    }
  }
}

export async function encodeDataByABI(
  abi: any[],
  functionName: string,
  executeArgs: any[],
  target: string = "0x0000000000000000000000000000000000000000"
) {
  const iface = new ethers.Interface(abi);
  // Encode the function call
  const data = iface.encodeFunctionData(functionName, executeArgs);
  return { target, data, abi, functionName, executeArgs };
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
