import { ethers, Log } from 'ethers';

interface LogFilter {
  fromBlock?: number | string;
  toBlock?: number | string;
  topics?: string[];
}

interface GetRawContractLogsParams {
  contractAddresses: string | string[];
  eventSignatures: string | string[];
  filter?: {
    fromBlock?: number | string;
    toBlock?: number | string;
    topics?: string[];
  };
}

interface GetContractLogsParams {
  contractAddresses: string | string[];
  eventNames?: string | string[];
  abi: any[];
  filter?: LogFilter;
  initialBatchSize?: number;
}

export { LogFilter, GetRawContractLogsParams, GetContractLogsParams };

export class EthersLogHelper {
  public web3: ethers.JsonRpcProvider;

  constructor(NODE_PROVIDER: string) {
    this.web3 = new ethers.JsonRpcProvider(NODE_PROVIDER);
  }

  /**
   * 获取事件主题哈希
   */
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

  /**
   * 获取原始合约日志（未解析）
   */
  async getRawContractLogs(params: GetRawContractLogsParams) {
    const { contractAddresses, eventSignatures, filter = {} } = params;

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

  /**
   * 获取解析后的合约日志
   */
  async getContractLogs(params: GetContractLogsParams) {
    const {
      contractAddresses,
      eventNames,
      abi,
      filter = {},
      initialBatchSize = 50000,
    } = params;

    try {
      // 1. 基础验证
      if (!contractAddresses || !abi || !Array.isArray(abi)) {
        throw new Error('合约地址和ABI数组是必需的');
      }

      const addresses = Array.isArray(contractAddresses)
        ? contractAddresses
        : [contractAddresses];

      // 2. 获取所有事件ABI
      const allEventAbis = abi.filter((item: any) => item.type === 'event');

      // 如果未指定eventNames，则使用所有事件，否则过滤指定的事件
      const eventAbis = eventNames
        ? allEventAbis.filter((item: any) =>
            Array.isArray(eventNames)
              ? eventNames.includes(item.name)
              : item.name === eventNames,
          )
        : allEventAbis;

      // 检查是否有匹配的事件ABI
      if (eventAbis.length === 0) {
        const availableEvents = allEventAbis.map((e: any) => e.name).join(', ');
        throw new Error(
          eventNames
            ? `未找到指定的事件定义。可用事件: ${availableEvents}`
            : 'ABI中未找到任何事件定义',
        );
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
      const MIN_BATCH_SIZE = 100;
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

            if (
              !parsedLog ||
              !eventAbis.some((abi) => abi.name === parsedLog.name)
            ) {
              return null;
            }

            return {
              ...log,
              args: parsedLog.args,
              name: parsedLog.name,
              signature: parsedLog.signature,
              eventFragment: parsedLog.fragment,
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

  /**
   * 根据交易哈希获取日志
   */
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
}
