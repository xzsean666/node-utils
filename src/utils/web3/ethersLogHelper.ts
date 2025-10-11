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
    const process_type = (input: any): string => {
      // 处理基础 tuple 类型
      if (input.type === 'tuple') {
        const components = input.components
          .map((comp: any) => process_type(comp))
          .join(',');
        return `(${components})`;
      }
      // 处理 tuple 数组
      if (input.type === 'tuple[]') {
        const components = input.components
          .map((comp: any) => process_type(comp))
          .join(',');
        return `(${components})[]`;
      }
      // 返回基本类型
      return input.type;
    };

    return events.map((event) => {
      const signature = `${event.name}(${event.inputs
        .map((input: any) => process_type(input))
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
      const all_event_abis = abi.filter((item: any) => item.type === 'event');

      // 如果未指定eventNames，则使用所有事件，否则过滤指定的事件
      const event_abis = eventNames
        ? all_event_abis.filter((item: any) =>
            Array.isArray(eventNames)
              ? eventNames.includes(item.name)
              : item.name === eventNames,
          )
        : all_event_abis;

      // 检查是否有匹配的事件ABI
      if (event_abis.length === 0) {
        const available_events = all_event_abis
          .map((e: any) => e.name)
          .join(', ');
        throw new Error(
          eventNames
            ? `未找到指定的事件定义。可用事件: ${available_events}`
            : 'ABI中未找到任何事件定义',
        );
      }

      // 3. 生成事件topics
      const event_topics = this.getEventTopics(event_abis);

      // 4. 获取区块范围
      const current_block_number = await this.web3.getBlockNumber();
      const from_block = BigInt(filter.fromBlock || 0);
      const to_block =
        filter.toBlock === 'latest'
          ? BigInt(current_block_number)
          : BigInt(filter.toBlock || current_block_number);

      // 检查区块范围是否合理
      if (from_block > to_block) {
        throw new Error(
          `起始区块 (${from_block}) 不能大于结束区块 (${to_block})`,
        );
      }

      // 5. 批量处理设置
      let batch_size = initialBatchSize;
      const MIN_BATCH_SIZE = 100;
      let current_block = from_block;
      const all_logs: Log[] = [];

      // 在循环外创建合约实例，避免重复创建
      const contract_interface = new ethers.Interface(abi);

      // 6. 批量获取日志
      while (current_block <= to_block) {
        const end_block = BigInt(
          Math.min(Number(current_block) + batch_size - 1, Number(to_block)),
        );

        console.log(`获取日志: ${current_block} 至 ${end_block}`);

        try {
          const logs = await this.web3.getLogs({
            address: addresses,
            topics: [event_topics, ...(filter.topics || [])],
            fromBlock: current_block,
            toBlock: end_block,
          });

          all_logs.push(...logs);
          current_block = end_block + BigInt(1);

          // 如果成功了，可以尝试增加批次大小
          if (batch_size < initialBatchSize) {
            batch_size = Math.min(batch_size * 2, initialBatchSize);
          }
        } catch (error: any) {
          console.warn(
            `获取区块 ${current_block} 至 ${end_block} 的日志失败: ${error.message}`,
          );

          // 减小批次大小并重试
          batch_size = Math.floor(batch_size / 2);

          if (batch_size < MIN_BATCH_SIZE) {
            // 如果批次大小太小，尝试处理单个区块
            if (current_block === end_block) {
              console.error(`无法处理单个区块 ${current_block}，跳过`);
              current_block = current_block + BigInt(1);
              batch_size = initialBatchSize; // 重置批次大小
              continue;
            } else {
              // 重置为最小批次大小
              batch_size = MIN_BATCH_SIZE;
            }
          }

          console.log(`减小批次大小至 ${batch_size} 并重试`);
          // 注意：这里不移动 current_block，让它重试当前批次
        }
      }

      // 7. 解析日志
      return all_logs
        .map((log: Log) => {
          try {
            const parsed_log = contract_interface.parseLog({
              topics: [...log.topics],
              data: log.data,
            });

            if (
              !parsed_log ||
              !event_abis.some((abi) => abi.name === parsed_log.name)
            ) {
              return null;
            }

            return {
              ...log,
              args: parsed_log.args,
              name: parsed_log.name,
              signature: parsed_log.signature,
              eventFragment: parsed_log.fragment,
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
    const parsed_logs = receipt.logs
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
    return parsed_logs;
  }
}
