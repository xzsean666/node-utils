import { ethers, HDNodeWallet, Log } from 'ethers';
export { ethers };

interface LogFilter {
  fromBlock?: number | string;
  toBlock?: number | string;
  topics?: string[];
}
let window: any;
export class EthersUtils {
  web3!: ethers.JsonRpcProvider | ethers.BrowserProvider;
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
    if (typeof NODE_PROVIDER == 'string') {
      this.web3 = new ethers.JsonRpcProvider(NODE_PROVIDER);
    } else if (NODE_PROVIDER instanceof ethers.BrowserProvider) {
      this.web3 = NODE_PROVIDER;
    } else {
      throw new Error('Invalid NODE_PROVIDER type');
    }
  }

  public async deployContract(abi: any[], bytecode: string): Promise<any> {
    try {
      const signer = new ethers.Wallet(this.privateKey || '', this.web3);
      const factory = new ethers.ContractFactory(abi, bytecode, signer);
      const contract = await factory.deploy();
      await contract.waitForDeployment();
      console.log(`合约已部署到: ${await contract.getAddress()}`);
      return contract;
    } catch (error: any) {
      throw new Error(`部署合约失败: ${error.message}`);
    }
  }
  async getBalance(address: string): Promise<string> {
    return (await this.web3.getBalance(address)).toString();
  }
  static async getRPCStatus(
    rpcs: string[],
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
      }),
    );

    // 将结果转换为字典格式
    return statuses.reduce((acc, { rpc, blockNumber, latency }) => {
      acc[rpc] = { blockNumber, latency };
      return acc;
    }, {} as { [key: string]: { blockNumber: number; latency: number } });
  }
  static async getCurrentChainStatus(rpc: string) {
    const provider = new ethers.JsonRpcProvider(rpc);

    try {
      // Get multiple chain properties in parallel
      const [blockNumber, chainId, feeData, network, latestBlock] =
        await Promise.all([
          provider.getBlockNumber(),
          provider.getNetwork().then((network) => network.chainId),
          provider.getFeeData(),
          provider.getNetwork().then((network) => network.name),
          provider.getBlock('latest'),
        ]);

      return {
        blockNumber,
        chainId: Number(chainId),
        gasPrice: feeData.gasPrice
          ? ethers.formatUnits(feeData.gasPrice, 'gwei')
          : null,
        maxFeePerGas: feeData.maxFeePerGas
          ? ethers.formatUnits(feeData.maxFeePerGas, 'gwei')
          : null,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
          ? ethers.formatUnits(feeData.maxPriorityFeePerGas, 'gwei')
          : null,
        network: network || 'unknown',
        timestamp: latestBlock?.timestamp
          ? Number(latestBlock.timestamp)
          : null,
        latestBlockHash: latestBlock?.hash || null,
      };
    } catch (error: any) {
      throw new Error(`获取链状态失败: ${error.message}`);
    }
  }

  async getLatestBlockNumber(): Promise<number> {
    if (!this.web3) {
      throw new Error('未找到有效的Provider');
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
      throw new Error('未找到有效的Provider');
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
    step: number = 0.5,
  ) {
    if (!this.web3) {
      throw new Error('未找到有效的Provider');
    }

    let multiplier = 1;
    let lastError;

    while (multiplier <= gasPriceMultiplierMAX) {
      try {
        // 获取当前gas价格
        const currentGasPrice = await this.web3.getFeeData();
        const newGasPrice = BigInt(
          Math.floor(Number(currentGasPrice.gasPrice) * multiplier),
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
        console.log('取消交易已发送,Hash:', transaction.hash);

        return transaction;
      } catch (error: any) {
        lastError = error;
        console.log(`使用 ${multiplier}x 倍数取消失败，尝试更高的gas价格`);
        multiplier += step;
      }
    }

    throw new Error(
      `取消Pending交易失败 (尝试至 ${gasPriceMultiplierMAX}x): ${lastError?.message}`,
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
      if (input.type === 'tuple') {
        const components = input.components
          .map((comp: any) => processType(comp))
          .join(',');
        return `(${components})`;
      }
      // 处理 tuple 数组
      if (input.type === 'tuple[]') {
        const components = input.components
          .map((comp: any) => processType(comp))
          .join(',');
        return `(${components})[]`;
      }
      // 返回基本类型
      return input.type;
    };

    return events.map((event) => {
      const signature = `${event.name}(${event.inputs
        .map((input: any) => processType(input))
        .join(',')})`;
      return ethers.id(signature);
    });
  }
  getSignerAddress() {
    return new ethers.Wallet(
      this.privateKey!,
      this.web3 as ethers.JsonRpcProvider,
    ).address;
  }

  toBytes32String(text: string) {
    return ethers.zeroPadValue(ethers.toUtf8Bytes(text), 32);
  }
  deriveWallets(privateKey: string, index: number = 0) {
    if (!privateKey) {
      throw new Error('私钥不能为空');
    }

    try {
      // 创建钱包实例
      const wallet = new ethers.Wallet(privateKey);

      // 从钱包创建 HD 节点
      const hdNode = ethers.HDNodeWallet.fromSeed(wallet.privateKey);

      const path = `m/44'/60'/0'/0/${index}`;
      const derivedWallet = hdNode.derivePath(path);

      if (!(derivedWallet instanceof HDNodeWallet)) {
        throw new Error('钱包派生失败');
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
  setDeriveWallets(index: number = 0) {
    const wallet = this.deriveWallets(this.privateKey!, index);
    this.privateKey = wallet.privateKey;
    this.account = wallet.address;
  }
  getDeriveWallets(index: number = 0) {
    const wallet = this.deriveWallets(this.privateKey!, index);
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
      throw new Error('未找到有效的Provider');
    }

    try {
      let txHash: string;
      let decodedLogs: (ethers.LogDescription | null)[] | null = null;

      // 保留原有的 Provider 判断逻辑
      if (this.privateKey && this.web3 instanceof ethers.JsonRpcProvider) {
        txHash = await this.sendWithPrivateKey(
          call.target,
          call.data,
          call.value || '0',
        );
      } else if (this.web3 instanceof ethers.BrowserProvider) {
        txHash = await this.sendWithBrowserProvider(
          call.target,
          call.data,
          call.value || '0',
        );
      } else {
        txHash = await this.sendWithMetaMask(
          call.target,
          call.data,
          call.value || '0',
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
                    topics: [...log.topics],
                    data: log.data,
                  });
                } catch (e) {
                  console.warn('解析单个日志失败:', e);
                  return null;
                }
              })
              .filter(Boolean) || null;
        }
      } catch (e) {
        console.warn('解析交易日志失败:', e);
        decodedLogs = null;
      }

      return {
        target: call.target,
        success: true,
        transactionHash: txHash,
        function: call.functionName || '',
        args: call.executeArgs || [],
        decodedData: decodedLogs,
      };
    } catch (error: any) {
      console.error('交易发送失败:', error);

      // 尝试从错误中提取交易hash（特别是"already known"的情况）
      const errorInfo = this.extractHashFromTransactionError(error);
      let extractedHash = '';

      if (errorInfo.success && errorInfo.hash) {
        extractedHash = errorInfo.hash;
        console.log(`从错误中提取到交易hash: ${extractedHash}`);

        // 如果是"already known"错误，使用增强的错误处理
        if (errorInfo.isAlreadyKnown) {
          console.log('检测到already known错误，使用增强处理...');
          const enhancedResult = await this.handleAlreadyKnownError(
            error,
            call,
          );

          if (enhancedResult) {
            return enhancedResult;
          }
        }
      }

      return {
        target: call.target,
        success: false,
        transactionHash: extractedHash,
        function: call.functionName || '',
        args: call.executeArgs || [],
        decodedData: null,
        error: error,
      };
    }
  }
  private async sendWithBrowserProvider(
    to: string,
    data?: string,
    value: string = '0',
  ): Promise<string> {
    if (!this.web3 || !(this.web3 instanceof ethers.BrowserProvider)) {
      throw new Error('未找到有效的BrowserProvider');
    }

    try {
      // 获取签名者
      const signer = await this.web3.getSigner();

      // 构建交易对象
      const tx = {
        to,
        data: data?.startsWith('0x') ? data : data ? '0x' + data : undefined,
        value: value === '0' ? '0x0' : ethers.parseEther(value),
      };

      // 发送交易
      const txResponse = await signer.sendTransaction(tx);

      // 等待交易被确认
      const receipt = await txResponse.wait();

      if (!receipt) {
        throw new Error('交易未被确认');
      }

      // 返回交易哈希
      return txResponse.hash;
    } catch (error: any) {
      console.error('发送交易失败:', error);
      throw new Error(`发送交易失败: ${error.message}`);
    }
  }

  private async sendWithPrivateKey(
    to: string,
    data?: string,
    value: string = '0',
  ): Promise<string> {
    if (!this.privateKey) {
      throw new Error('Private key is required');
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
    value: string = '0',
  ): Promise<string> {
    const fromAddress = await this.getAccounts();
    const hexValue = value === '0' ? '0x0' : this.ethers.toQuantity(value);
    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [
        {
          to,
          from: fromAddress,
          data: data?.startsWith('0x') ? data : data ? '0x' + data : undefined,
          value: hexValue, // 使用转换后的十六进制值
        },
      ],
    });
    const txResponse = await this.web3.getTransaction(txHash);
    await txResponse?.wait();
    return txHash;
  }

  encodeDataByABI(params: {
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
      params.executeArgs,
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
    blockNumber?: number,
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
    executeArgs: any[] = [],
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
    executeArgs: any[],
  ) {
    const data = this.encodeDataByABI({
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
    } = {},
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
        toBlock: filter.toBlock || 'latest',
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
    filter: LogFilter = {},
    initialBatchSize: number = 50000,
  ) {
    try {
      // 1. 基础验证
      if (!contractAddresses || !abi || !Array.isArray(abi)) {
        throw new Error('合约地址和ABI数组是必需的');
      }

      const addresses = Array.isArray(contractAddresses)
        ? contractAddresses
        : [contractAddresses];
      const events = Array.isArray(eventNames) ? eventNames : [eventNames];

      // 检查事件名数组是否为空
      if (events.length === 0) {
        throw new Error('至少需要指定一个事件名');
      }

      // 2. 事件ABI过滤
      const eventAbis = abi
        .filter((item: any) => item.type === 'event')
        .filter((item: any) => events.includes(item.name));

      if (eventAbis.length === 0) {
        throw new Error('未找到指定的事件定义');
      }

      // 3. 生成事件topics
      const eventTopics = this.getEventTopics(eventAbis);

      // 4. 获取区块范围
      const currentBlockNumber = await this.web3.getBlockNumber();
      const fromBlock = BigInt(filter.fromBlock || 0);
      const toBlock =
        filter.toBlock === 'latest'
          ? BigInt(currentBlockNumber)
          : BigInt(filter.toBlock || currentBlockNumber);

      // 检查区块范围是否合理
      if (fromBlock > toBlock) {
        throw new Error(
          `起始区块 (${fromBlock}) 不能大于结束区块 (${toBlock})`,
        );
      }

      // 5. 批量处理设置
      let batchSize = initialBatchSize;
      const MIN_BATCH_SIZE = 1000;
      let currentBlock = fromBlock;
      const allLogs: Log[] = [];

      // 在循环外创建合约实例，避免重复创建
      const contractInterface = new ethers.Interface(abi);

      // 6. 批量获取日志
      while (currentBlock <= toBlock) {
        const endBlock = BigInt(
          Math.min(Number(currentBlock) + batchSize - 1, Number(toBlock)),
        );

        console.log(`获取日志: ${currentBlock} 至 ${endBlock}`);

        try {
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
        } catch (error: any) {
          console.warn(
            `获取区块 ${currentBlock} 至 ${endBlock} 的日志失败: ${error.message}`,
          );

          // 减小批次大小并重试
          batchSize = Math.floor(batchSize / 2);

          if (batchSize < MIN_BATCH_SIZE) {
            // 如果批次大小太小，尝试处理单个区块
            if (currentBlock === endBlock) {
              console.error(`无法处理单个区块 ${currentBlock}，跳过`);
              currentBlock = currentBlock + BigInt(1);
              batchSize = initialBatchSize; // 重置批次大小
              continue;
            } else {
              // 重置为最小批次大小
              batchSize = MIN_BATCH_SIZE;
            }
          }

          console.log(`减小批次大小至 ${batchSize} 并重试`);
          // 注意：这里不移动 currentBlock，让它重试当前批次
        }
      }

      // 7. 解析日志
      return allLogs
        .map((log: Log) => {
          try {
            const parsedLog = contractInterface.parseLog({
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
              error,
            );
            return {
              ...log,
              args: null,
              decoded: false,
            };
          }
        })
        .filter((log): log is NonNullable<typeof log> => log !== null);
    } catch (error: any) {
      throw new Error(`获取合约日志失败: ${error.message}`);
    }
  }

  async getLogByTxHash(txHash: string, abi?: any) {
    const receipt = await this.web3.getTransactionReceipt(txHash);
    if (!receipt) {
      throw new Error('Transaction receipt not found');
    }
    if (!abi) {
      return receipt.logs;
    }
    const iface = new ethers.Interface(abi);
    const parsedLogs = receipt.logs
      .map((log) => {
        try {
          return iface.parseLog({
            topics: [...log.topics],
            data: log.data,
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
      throw new Error('未找到有效的Provider');
    }
    // 直接使用 getAddress 规范化地址，避免 ENS 解析
    const normalizedAddress = ethers.getAddress(address);
    const contract = new ethers.Contract(normalizedAddress, abi, this.web3);
    return contract;
  }
  getContractWithSigner(address: string, abi: any) {
    if (!this.privateKey) {
      throw new Error('私钥不能为空');
    }
    const signer = new ethers.Wallet(this.privateKey, this.web3);
    const contract = new ethers.Contract(address, abi, signer);
    return contract;
  }
  formatBatchCallResult(batchResults: any[]) {
    const batchResultsFormat: any = {};
    for (const result of batchResults) {
      if (!batchResultsFormat[result.target]) {
        batchResultsFormat[result.target] = [];
      }
      batchResultsFormat[result.target].push(result);
    }
    return batchResultsFormat;
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
    batchLimit: number = 1000,
  ) {
    const IBatchCallABI = batchCallABI;

    if (!this.batchCallAddress) {
      throw new Error('BatchCallAddress not provided!');
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
        'batchStaticCall',
        [
          batchCalls.map((call) => ({
            target: call.target,
            callData: call.data,
          })),
        ],
        blockNumber,
      );

      // 解码返回结果
      const batchResults = returnData.map((data: string, index: number) => {
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
          const decodedData = this.decodeDataByABI(
            call.abi,
            call.functionName,
            data,
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
      });

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
      if (code === '0x') {
        throw new Error('供的地址不是合约地址');
      }

      // 直接获取该地址的第一笔交易记录
      const logs = await this.web3.getLogs({
        address: contractAddress,
        fromBlock: 0,
        toBlock: 'latest',
        topics: [],
      });

      if (logs.length === 0) {
        throw new Error('该合约没有产生任何的LOG。');
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
    blockNumber?: number | string,
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
    toBlock?: number | string,
  ): Promise<string[]> {
    const addresses: Set<string> = new Set();
    const eventNames = abi
      .filter((item) => item.type === 'event')
      .map((item) => item.name);

    const logs = await this.getContractLogs(
      tokenAddresses, // 直接传入地址数组
      eventNames, // 事件名称数组
      abi, // ABI
      {
        fromBlock,
        toBlock,
      },
    );

    logs.forEach((log: any) => {
      if ('args' in log && log.args) {
        if (log.args.from) addresses.add(log.args.from);
        if (log.args.to) addresses.add(log.args.to);
      }
    });

    // 移除零地址
    const blackList = [
      '0x000000000000000000000000000000000000dEaD',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000001',
    ];
    blackList.forEach((address) => addresses.delete(address));

    return Array.from(addresses);
  }

  decodeDataByABI(abi: any[], functionName: string, data: string) {
    const iface = new ethers.Interface(abi);
    // 解返回数据
    const decodedData = iface.decodeFunctionResult(functionName, data);
    return decodedData;
  }

  checkAddress(address: string): string {
    try {
      // 检查地址是否为空
      if (!address) {
        console.error('地址不能为空');
        return '';
      }

      // 检查地址格式是否正确
      if (!ethers.isAddress(address)) {
        console.error('无效的以太坊地址格式');
        return '';
      }

      // 检查地址是否为零地址
      const zeroAddress = '0x0000000000000000000000000000000000000000';
      if (address.toLowerCase() === zeroAddress.toLowerCase()) {
        console.error('不能使用零地址');
        return '';
      }

      // 返回规范化的地址
      return ethers.getAddress(address);
    } catch (error) {
      console.error('检查地址时发生错误:', error);
      return '';
    }
  }

  async getBlockTimestamp(blockNumber: number | string): Promise<number> {
    if (!this.web3) {
      throw new Error('未找到有效的Provider');
    }

    try {
      const block = await this.web3.getBlock(blockNumber);
      if (!block) {
        throw new Error('未找到指定区块');
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
    batchLimit: number = 1000,
  ) {
    const IBatchCallABI = batchCallABI;

    if (!this.batchCallAddress) {
      throw new Error('BatchCallAddress未提供！');
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
          'batchCall',
          [
            batchCalls.map((call) => ({
              target: call.target,
              callData: call.data,
            })),
          ],
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
          transactionHash: '',
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
        this.web3,
      );

      // 获取当前 gas 价格
      const feeData = await this.web3.getFeeData();
      const gasPrice = feeData.gasPrice || BigInt(0);

      // 估算 gas 限制
      const gasLimit = await contract[params.functionName].estimateGas(
        ...(params.executeArgs || []),
        {
          value: params.value ? BigInt(params.value) : undefined,
        },
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

  /**
   * 计算各种类型的hash值
   * @param params 计算参数
   * @returns 计算结果，包含hash值和可能的错误信息
   */
  calculateHash(params: {
    data?: string;
    types?: string[];
    values?: any[];
    text?: string;
    functionSignature?: string;
    eventSignature?: string;
    transaction?: {
      to: string;
      value: string;
      data: string;
      nonce: number;
      gasLimit: string;
      gasPrice: string;
    };
    type:
      | 'keccak256'
      | 'id'
      | 'solidityPacked'
      | 'transactionHash'
      | 'messageHash';
  }): {
    hash: string | null;
    success: boolean;
    error?: string;
    type: string;
  } {
    let computedHash: string | null = null;
    let errorMessage: string | undefined;

    try {
      switch (params.type) {
        case 'keccak256':
          // 计算数据的 keccak256 hash
          if (!params.data) {
            throw new Error('计算keccak256需要提供data参数');
          }
          computedHash = ethers.keccak256(params.data);
          break;

        case 'id':
          // 计算字符串的 keccak256 hash（用于函数签名、事件签名等）
          if (params.functionSignature) {
            computedHash = ethers.id(params.functionSignature);
          } else if (params.eventSignature) {
            computedHash = ethers.id(params.eventSignature);
          } else if (params.text) {
            computedHash = ethers.id(params.text);
          } else {
            throw new Error(
              '计算id hash需要提供functionSignature、eventSignature或text参数',
            );
          }
          break;

        case 'solidityPacked':
          // 计算 Solidity packed 编码后的 keccak256
          if (!params.types || !params.values) {
            throw new Error('计算solidityPacked hash需要提供types和values参数');
          }
          computedHash = ethers.solidityPackedKeccak256(
            params.types,
            params.values,
          );
          break;

        case 'transactionHash':
          // 计算交易hash
          if (!params.transaction) {
            throw new Error('计算交易hash需要提供transaction参数');
          }
          const txData = {
            to: params.transaction.to,
            value: params.transaction.value,
            data: params.transaction.data,
            nonce: params.transaction.nonce,
            gasLimit: params.transaction.gasLimit,
            gasPrice: params.transaction.gasPrice,
          };
          // 使用ethers对交易数据进行编码后计算hash
          const serialized = ethers.Transaction.from(txData).serialized;
          computedHash = ethers.keccak256(serialized);
          break;

        case 'messageHash':
          // 计算以太坊消息hash (用于签名验证等)
          if (!params.text) {
            throw new Error('计算消息hash需要提供text参数');
          }
          computedHash = ethers.hashMessage(params.text);
          break;

        default:
          throw new Error('不支持的hash类型');
      }

      return {
        hash: computedHash,
        success: true,
        type: params.type,
      };
    } catch (error: any) {
      errorMessage = error.message;

      // 即使出错，也尝试计算可能的hash值
      try {
        switch (params.type) {
          case 'keccak256':
            if (params.data) {
              computedHash = ethers.keccak256(params.data);
            }
            break;
          case 'id':
            const textToHash =
              params.functionSignature || params.eventSignature || params.text;
            if (textToHash) {
              computedHash = ethers.id(textToHash);
            }
            break;
          case 'solidityPacked':
            if (params.types && params.values) {
              computedHash = ethers.solidityPackedKeccak256(
                params.types,
                params.values,
              );
            }
            break;
          case 'transactionHash':
            if (params.transaction) {
              try {
                const txData = {
                  to: params.transaction.to,
                  value: params.transaction.value,
                  data: params.transaction.data,
                  nonce: params.transaction.nonce,
                  gasLimit: params.transaction.gasLimit,
                  gasPrice: params.transaction.gasPrice,
                };
                const serialized = ethers.Transaction.from(txData).serialized;
                computedHash = ethers.keccak256(serialized);
              } catch {
                // 如果交易数据无效，尝试计算原始数据的hash
                const rawData = JSON.stringify(params.transaction);
                computedHash = ethers.keccak256(ethers.toUtf8Bytes(rawData));
              }
            }
            break;
          case 'messageHash':
            if (params.text) {
              computedHash = ethers.hashMessage(params.text);
            }
            break;
        }
      } catch {
        // 如果在错误处理中再次失败，保持computedHash为null
      }

      return {
        hash: computedHash,
        success: false,
        error: `计算hash失败: ${errorMessage}`,
        type: params.type,
      };
    }
  }

  /**
   * 从原始交易数据计算交易hash
   * @param rawTxData 原始交易数据（十六进制字符串）
   * @returns 交易hash
   */
  calculateHashFromRawTransaction(rawTxData: string): {
    hash: string | null;
    success: boolean;
    error?: string;
    transactionDetails?: any;
  } {
    try {
      // 确保数据以0x开头
      const normalizedData = rawTxData.startsWith('0x')
        ? rawTxData
        : `0x${rawTxData}`;

      // 方法1: 使用ethers解析交易并获取hash
      try {
        const parsedTx = ethers.Transaction.from(normalizedData);
        const hash = parsedTx.hash;

        if (hash) {
          return {
            hash,
            success: true,
            transactionDetails: {
              to: parsedTx.to,
              value: parsedTx.value?.toString(),
              gasLimit: parsedTx.gasLimit?.toString(),
              gasPrice: parsedTx.gasPrice?.toString(),
              nonce: parsedTx.nonce,
              data: parsedTx.data,
              type: parsedTx.type,
            },
          };
        }
      } catch (parseError) {
        console.warn('使用Transaction.from解析失败，尝试其他方法:', parseError);
      }

      // 方法2: 直接计算keccak256 (作为备用方案)
      const directHash = ethers.keccak256(normalizedData);

      return {
        hash: directHash,
        success: true,
        transactionDetails: {
          rawData: normalizedData,
          method: 'direct_keccak256',
          note: '使用直接keccak256计算，可能不是正确的交易hash',
        },
      };
    } catch (error: any) {
      return {
        hash: null,
        success: false,
        error: `计算原始交易hash失败: ${error.message}`,
      };
    }
  }

  /**
   * 从错误信息中提取交易相关信息
   * @param error 错误对象或错误消息
   * @returns 提取的交易信息和计算出的hash
   */
  extractHashFromTransactionError(error: any): {
    hash: string | null;
    rawTransaction: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    isAlreadyKnown: boolean;
    success: boolean;
  } {
    try {
      let rawTransaction: string | null = null;
      let errorCode: string | null = null;
      let errorMessage: string | null = null;
      let hash: string | null = null;
      let isAlreadyKnown = false;

      // 解析错误信息
      const errorString =
        typeof error === 'string'
          ? error
          : error.message || JSON.stringify(error);

      // 检查是否是"already known"错误
      if (errorString.includes('already known')) {
        isAlreadyKnown = true;
      }

      // 尝试从错误中提取原始交易数据
      const rawTxMatch = errorString.match(/"0x[a-fA-F0-9]+"/g);
      if (rawTxMatch && rawTxMatch.length > 0) {
        // 找到最长的十六进制字符串，通常是原始交易数据
        rawTransaction = rawTxMatch
          .map((match) => match.replace(/"/g, ''))
          .sort((a, b) => b.length - a.length)[0];
      }

      // 尝试提取错误代码
      const codeMatch = errorString.match(/"code":\s*(-?\d+)/);
      if (codeMatch) {
        errorCode = codeMatch[1];
      }

      // 尝试提取错误消息
      const messageMatch = errorString.match(/"message":\s*"([^"]+)"/);
      if (messageMatch) {
        errorMessage = messageMatch[1];
      }

      // 如果找到了原始交易数据，计算hash
      if (rawTransaction) {
        const hashResult = this.calculateHashFromRawTransaction(rawTransaction);
        hash = hashResult.hash;
      }

      return {
        hash,
        rawTransaction,
        errorCode,
        errorMessage,
        isAlreadyKnown,
        success: true,
      };
    } catch (extractError: any) {
      return {
        hash: null,
        rawTransaction: null,
        errorCode: null,
        errorMessage: null,
        isAlreadyKnown: false,
        success: false,
      };
    }
  }

  /**
   * 等待交易被确认或查找pending交易
   * @param txHash 交易hash
   * @param maxWaitTime 最大等待时间（毫秒）
   * @param checkInterval 检查间隔（毫秒）
   * @returns 交易收据或状态信息
   */
  async waitForTransactionOrFindPending(
    txHash: string,
    maxWaitTime: number = 30000,
    checkInterval: number = 2000,
  ): Promise<{
    receipt: ethers.TransactionReceipt | null;
    transaction: ethers.TransactionResponse | null;
    status: 'confirmed' | 'pending' | 'not_found' | 'timeout';
    waitTime: number;
  }> {
    const startTime = Date.now();
    let currentTime = startTime;

    while (currentTime - startTime < maxWaitTime) {
      try {
        // 1. 尝试获取交易收据（已确认）
        const receipt = await this.web3.getTransactionReceipt(txHash);
        if (receipt) {
          return {
            receipt,
            transaction: null,
            status: 'confirmed',
            waitTime: currentTime - startTime,
          };
        }

        // 2. 尝试获取交易信息（可能在pending中）
        const transaction = await this.web3.getTransaction(txHash);
        if (transaction) {
          return {
            receipt: null,
            transaction,
            status: 'pending',
            waitTime: currentTime - startTime,
          };
        }

        // 3. 等待后再次检查
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
        currentTime = Date.now();
      } catch (error) {
        console.warn(`检查交易 ${txHash} 时出错:`, error);
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
        currentTime = Date.now();
      }
    }

    return {
      receipt: null,
      transaction: null,
      status: 'timeout',
      waitTime: maxWaitTime,
    };
  }

  /**
   * 增强的"already known"错误处理
   * @param error 错误信息
   * @param call 原始调用参数
   * @returns 处理结果
   */
  async handleAlreadyKnownError(error: any, call: any) {
    console.log('处理already known错误...');

    // 1. 提取错误信息
    const errorInfo = this.extractHashFromTransactionError(error);

    if (!errorInfo.success || !errorInfo.hash) {
      console.log('无法从错误中提取hash信息');
      return null;
    }

    const extractedHash = errorInfo.hash;
    console.log(`提取到的hash: ${extractedHash}`);
    console.log('交易详情:', errorInfo);

    // 2. 等待交易确认或查找pending状态
    console.log('等待交易确认...');
    const result = await this.waitForTransactionOrFindPending(
      extractedHash,
      60000,
      3000,
    );

    console.log(`交易状态: ${result.status}, 等待时间: ${result.waitTime}ms`);

    let decodedLogs: (ethers.LogDescription | null)[] | null = null;

    // 3. 如果交易已确认，解码日志
    if (result.status === 'confirmed' && result.receipt && call.abi) {
      try {
        const iface = new ethers.Interface(call.abi);
        decodedLogs =
          result.receipt.logs
            .map((log) => {
              try {
                return iface.parseLog({
                  topics: [...log.topics],
                  data: log.data,
                });
              } catch (e) {
                return null;
              }
            })
            .filter(Boolean) || null;
      } catch (decodeError) {
        console.warn('解码日志失败:', decodeError);
      }
    }

    // 4. 返回结果
    const success =
      result.status === 'confirmed' || result.status === 'pending';

    return {
      target: call.target,
      success,
      transactionHash: extractedHash,
      function: call.functionName || '',
      args: call.executeArgs || [],
      decodedData: decodedLogs,
      error: success
        ? `交易${result.status === 'confirmed' ? '已确认' : '待确认'}: ${
            errorInfo.errorMessage
          }`
        : `交易未找到或超时: ${errorInfo.errorMessage}`,
      transactionStatus: {
        status: result.status,
        waitTime: result.waitTime,
        hasReceipt: !!result.receipt,
        hasTransaction: !!result.transaction,
      },
    };
  }

  /**
   * 检查地址的交易状态，包括pending和最近的交易
   * @param address 要检查的地址
   * @param maxRecentTxs 检查最近的交易数量，默认10个
   * @returns 地址的交易状态报告
   */
  async checkAddressTransactionStatus(
    address: string,
    maxRecentTxs: number = 10,
    options?: {
      scanBlocks?: boolean; // 是否扫描最近区块以获取交易记录（默认false避免阻塞）
      maxBlocks?: number; // 扫描的最大区块数上限
      timeoutMs?: number; // 扫描超时时间
    },
  ): Promise<{
    address: string;
    currentNonce: number;
    onChainNonce: number;
    isPendingStuck: boolean;
    pendingCount: number;
    recentTransactions: Array<{
      hash: string;
      nonce: number;
      status: 'confirmed' | 'pending' | 'failed';
      gasPrice: string;
      gasLimit: string;
      blockNumber?: number;
      timestamp?: number;
      age?: string;
    }>;
    recommendations: string[];
    summary: {
      hasStuckTransactions: boolean;
      pendingDuration?: number;
      suggestedAction?: string;
    };
  }> {
    try {
      // 验证地址格式
      const normalizedAddress = this.checkAddress(address);
      if (!normalizedAddress) {
        throw new Error('无效的地址格式');
      }

      console.log(`=== 检查地址交易状态: ${normalizedAddress} ===`);

      // 1. 获取当前nonce（包括pending）
      const currentNonce = await this.web3.getTransactionCount(
        normalizedAddress,
        'pending',
      );

      // 2. 获取链上确认的nonce
      const onChainNonce = await this.web3.getTransactionCount(
        normalizedAddress,
        'latest',
      );

      const pendingCount = currentNonce - onChainNonce;
      const isPendingStuck = pendingCount > 0;

      console.log(
        `链上Nonce: ${onChainNonce}, 当前Nonce: ${currentNonce}, Pending: ${pendingCount}`,
      );

      // 3. 获取最近的交易记录（默认不扫描，避免阻塞）
      const recentTransactions: any[] = [];
      const scanBlocks = options?.scanBlocks ?? false;
      const maxBlocks = Math.max(1, Math.min(options?.maxBlocks ?? 200, 200));
      const scanDeadline = Date.now() + (options?.timeoutMs ?? 4000);

      if (!scanBlocks) {
        console.log('跳过区块扫描（scanBlocks=false）');
      } else {
        let currentBlockNumber = await this.web3.getBlockNumber();
        let foundTxs = 0;

        // 从最新区块开始往前搜索，带超时控制
        for (
          let blockNum = currentBlockNumber;
          blockNum > currentBlockNumber - maxBlocks && foundTxs < maxRecentTxs;
          blockNum--
        ) {
          if (Date.now() > scanDeadline) {
            console.warn('扫描超时，提前结束区块扫描');
            break;
          }
          try {
            const block = await this.web3.getBlock(blockNum, true);
            if (!block || !block.transactions) continue;

            for (const tx of block.transactions) {
              if (
                typeof tx === 'object' &&
                tx !== null &&
                'from' in tx &&
                'to' in tx
              ) {
                const transaction = tx as ethers.TransactionResponse;
                const fromMatch =
                  transaction.from?.toLowerCase() ===
                  normalizedAddress.toLowerCase();
                const toMatch =
                  transaction.to?.toLowerCase() ===
                  normalizedAddress.toLowerCase();
                if (fromMatch || toMatch) {
                  // 尽量减少额外RPC调用，收据仅在必要时查询
                  let status: 'confirmed' | 'pending' | 'failed' = 'pending';
                  try {
                    const receipt = await this.web3.getTransactionReceipt(
                      transaction.hash,
                    );
                    if (receipt) {
                      status = receipt.status === 1 ? 'confirmed' : 'failed';
                    }
                  } catch {}

                  const age = this.formatAge(
                    Date.now() / 1000 - Number(block.timestamp),
                  );

                  recentTransactions.push({
                    hash: transaction.hash,
                    nonce: transaction.nonce,
                    status,
                    gasPrice: ethers.formatUnits(
                      transaction.gasPrice || 0,
                      'gwei',
                    ),
                    gasLimit: transaction.gasLimit?.toString() || '0',
                    blockNumber: block.number,
                    timestamp: Number(block.timestamp),
                    age: age,
                  });

                  foundTxs++;
                  if (foundTxs >= maxRecentTxs) break;
                }
              }
            }
          } catch (error) {
            // 跳过无法访问的区块
            continue;
          }
        }
      }

      // 4. 检查是否有pending交易
      const pendingTxs: any[] = [];
      if (isPendingStuck) {
        // 尝试获取pending交易（这需要特殊的RPC支持）
        try {
          // 某些RPC提供者支持 txpool_content
          const pendingPool = await this.web3.send('txpool_content', []);
          const addressPending =
            pendingPool?.pending?.[normalizedAddress.toLowerCase()];

          if (addressPending) {
            Object.values(addressPending).forEach((tx: any) => {
              pendingTxs.push({
                hash: tx.hash,
                nonce: parseInt(tx.nonce, 16),
                status: 'pending' as const,
                gasPrice: ethers.formatUnits(BigInt(tx.gasPrice), 'gwei'),
                gasLimit: parseInt(tx.gas, 16).toString(),
                age: '等待中...',
              });
            });
          }
        } catch (error) {
          console.warn('无法获取pending交易详情，RPC可能不支持txpool_content');
        }
      }

      // 5. 合并并排序交易
      const allTransactions = [...recentTransactions, ...pendingTxs]
        .sort((a, b) => (b.nonce || 0) - (a.nonce || 0))
        .slice(0, maxRecentTxs);

      // 6. 分析和建议
      const recommendations: string[] = [];
      let hasStuckTransactions = false;
      let suggestedAction = '';
      let pendingDuration: number | undefined;

      if (isPendingStuck) {
        hasStuckTransactions = true;
        recommendations.push(`⚠️  发现 ${pendingCount} 笔待处理交易`);

        const oldestPending = allTransactions
          .filter((tx) => tx.status === 'pending')
          .sort((a, b) => (a.nonce || 0) - (b.nonce || 0))[0];

        if (oldestPending && oldestPending.timestamp) {
          pendingDuration = Date.now() / 1000 - oldestPending.timestamp;
          if (pendingDuration > 300) {
            // 5分钟
            recommendations.push(
              `🕐 最老的pending交易已等待 ${this.formatAge(pendingDuration)}`,
            );

            if (pendingDuration > 1800) {
              // 30分钟
              suggestedAction = 'cancel_or_speedup';
              recommendations.push('💡 建议：交易可能已卡住，考虑加速或取消');
              recommendations.push(
                `🚀 可以使用 cancelPendingTransaction(${oldestPending.nonce}) 取消`,
              );
            } else if (pendingDuration > 600) {
              // 10分钟
              suggestedAction = 'speedup';
              recommendations.push('💡 建议：可以尝试加速交易（提高gas价格）');
            }
          }
        }

        // 检查gas价格是否过低
        const pendingGasPrices = allTransactions
          .filter((tx) => tx.status === 'pending')
          .map((tx) => parseFloat(tx.gasPrice));

        if (pendingGasPrices.length > 0) {
          const avgPendingGas =
            pendingGasPrices.reduce((a, b) => a + b) / pendingGasPrices.length;
          const currentGasPrice = await this.web3.getFeeData();
          const currentGasPriceGwei = parseFloat(
            ethers.formatUnits(currentGasPrice.gasPrice || 0, 'gwei'),
          );

          if (avgPendingGas < currentGasPriceGwei * 0.8) {
            recommendations.push(
              `⛽ Pending交易gas价格较低 (${avgPendingGas.toFixed(
                2,
              )} gwei vs 当前 ${currentGasPriceGwei.toFixed(2)} gwei)`,
            );
          }
        }
      } else {
        recommendations.push('✅ 没有发现待处理的交易');
      }

      // 检查nonce gap
      const confirmedTxs = allTransactions.filter(
        (tx) => tx.status === 'confirmed',
      );
      if (confirmedTxs.length > 1) {
        for (let i = 0; i < confirmedTxs.length - 1; i++) {
          const currentNonce = confirmedTxs[i].nonce || 0;
          const nextNonce = confirmedTxs[i + 1].nonce || 0;
          if (currentNonce - nextNonce > 1) {
            recommendations.push(
              `⚠️  检测到nonce跳跃: ${nextNonce} → ${currentNonce}`,
            );
          }
        }
      }

      const summary = {
        hasStuckTransactions,
        pendingDuration,
        suggestedAction,
      };

      console.log('=== 检查完成 ===');
      console.log(`Pending交易数: ${pendingCount}`);
      console.log(`最近交易数: ${allTransactions.length}`);
      recommendations.forEach((rec) => console.log(rec));

      return {
        address: normalizedAddress,
        currentNonce,
        onChainNonce,
        isPendingStuck,
        pendingCount,
        recentTransactions: allTransactions,
        recommendations,
        summary,
      };
    } catch (error: any) {
      throw new Error(`检查地址交易状态失败: ${error.message}`);
    }
  }

  /**
   * 格式化时间差为可读格式
   * @param seconds 秒数
   * @returns 格式化的时间字符串
   */
  private formatAge(seconds: number): string {
    if (seconds < 60) return `${Math.floor(seconds)}秒前`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
    return `${Math.floor(seconds / 86400)}天前`;
  }

  /**
   * 测试已知错误信息的处理（用于调试）
   * @param errorMessage 您遇到的错误消息
   * @returns 处理结果和详细信息
   */
  async testAlreadyKnownError(errorMessage: string): Promise<{
    extraction: any;
    hashCalculation: any;
    transactionStatus: any;
    recommendations: string[];
  }> {
    console.log('=== 测试already known错误处理 ===');

    // 1. 提取错误信息
    const extraction = this.extractHashFromTransactionError(errorMessage);
    console.log('步骤1 - 错误信息提取:', extraction);

    let hashCalculation: any = null;
    let transactionStatus: any = null;
    const recommendations: string[] = [];

    // 2. 如果提取到原始交易数据，计算hash
    if (extraction.rawTransaction) {
      hashCalculation = this.calculateHashFromRawTransaction(
        extraction.rawTransaction,
      );
      console.log('步骤2 - Hash计算:', hashCalculation);

      // 3. 如果计算出hash，检查交易状态
      if (hashCalculation.hash) {
        console.log('步骤3 - 检查交易状态...');
        transactionStatus = await this.waitForTransactionOrFindPending(
          hashCalculation.hash,
          10000, // 10秒测试
          2000,
        );
        console.log('步骤3 - 交易状态:', transactionStatus);
      }
    }

    // 4. 生成建议
    if (extraction.isAlreadyKnown) {
      recommendations.push(
        '✅ 检测到"already known"错误 - 交易可能已在mempool中',
      );
    }

    if (hashCalculation?.hash) {
      recommendations.push(`✅ 计算出交易hash: ${hashCalculation.hash}`);
      recommendations.push(`🔍 在区块浏览器中搜索: ${hashCalculation.hash}`);
    }

    if (transactionStatus?.status === 'confirmed') {
      recommendations.push('✅ 交易已确认！');
    } else if (transactionStatus?.status === 'pending') {
      recommendations.push('⏳ 交易在pending状态，请等待确认');
    } else if (transactionStatus?.status === 'not_found') {
      recommendations.push('❌ 未找到交易，hash可能不正确');
    }

    if (!extraction.success) {
      recommendations.push('❌ 无法提取错误信息，请检查错误格式');
    }

    console.log('=== 建议 ===');
    recommendations.forEach((rec) => console.log(rec));

    return {
      extraction,
      hashCalculation,
      transactionStatus,
      recommendations,
    };
  }
}

export function encodeDataByABI(
  abi: any[],
  functionName: string,
  executeArgs: any[],
  target: string = '0x0000000000000000000000000000000000000000',
) {
  const iface = new ethers.Interface(abi);
  // Encode the function call
  const data = iface.encodeFunctionData(functionName, executeArgs);
  return { target, data, abi, functionName, executeArgs };
}

export function functionsWithParamTypesFromABI(abi: any[]) {
  const functionNames: string[] = [];
  const functionArgs: { [key: string]: string[] } = {};

  abi
    .filter((entry) => entry.type === 'function')
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
            internalType: 'address',
            name: 'target',
            type: 'address',
          },
          {
            internalType: 'bytes',
            name: 'callData',
            type: 'bytes',
          },
        ],
        internalType: 'struct Multicall[]',
        name: 'calls',
        type: 'tuple[]',
      },
    ],
    name: 'batchCall',
    outputs: [
      {
        internalType: 'bool[]',
        name: 'successes',
        type: 'bool[]',
      },
      {
        internalType: 'bytes[]',
        name: 'results',
        type: 'bytes[]',
      },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'target',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'string',
        name: 'reason',
        type: 'string',
      },
    ],
    name: 'CallError',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'target',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'bytes',
        name: 'data',
        type: 'bytes',
      },
    ],
    name: 'CallResult',
    type: 'event',
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: 'address',
            name: 'target',
            type: 'address',
          },
          {
            internalType: 'bytes',
            name: 'callData',
            type: 'bytes',
          },
        ],
        internalType: 'struct Multicall[]',
        name: 'calls',
        type: 'tuple[]',
      },
    ],
    name: 'batchStaticCall',
    outputs: [
      {
        internalType: 'bool[]',
        name: 'successes',
        type: 'bool[]',
      },
      {
        internalType: 'bytes[]',
        name: 'results',
        type: 'bytes[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];
