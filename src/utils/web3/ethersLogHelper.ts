import { ethers, Log } from 'ethers';

interface LogFilter {
  fromBlock?: number | string;
  toBlock?: number | string;
  topics?: (string | string[] | null)[];
}

interface GetRawContractLogsParams {
  contract_addresses: string | string[];
  event_signatures: string | string[];
  filter?: {
    fromBlock?: number | string;
    toBlock?: number | string;
    topics?: (string | string[] | null)[];
  };
}

interface GetContractLogsParams {
  contract_addresses: string | string[];
  event_names?: string | string[];
  abi: any[];
  filter?: LogFilter;
  initial_batch_size?: number;
}

export { LogFilter, GetRawContractLogsParams, GetContractLogsParams };

export class EthersLogHelper {
  public web3: ethers.JsonRpcProvider;

  constructor(node_provider: string) {
    this.web3 = new ethers.JsonRpcProvider(node_provider);
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
    const { contract_addresses, event_signatures, filter = {} } = params;

    try {
      // 确保地址和事件签名都是数组格式
      const addresses = Array.isArray(contract_addresses)
        ? contract_addresses
        : [contract_addresses];
      const signatures = Array.isArray(event_signatures)
        ? event_signatures
        : [event_signatures];

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
   * 构建完整的topics数组
   */
  buildTopics(
    eventSignature: string,
    indexedArgs?: (string | number | null)[],
  ): (string | null)[] {
    const topics: (string | null)[] = [ethers.id(eventSignature)]; // topic0: 事件签名哈希

    if (indexedArgs && indexedArgs.length > 0) {
      for (const arg of indexedArgs) {
        if (arg === null) {
          topics.push(null); // null表示不过滤这个位置
        } else if (typeof arg === 'string' && arg.startsWith('0x')) {
          // 如果是地址或bytes32，直接使用（假设已经正确格式化）
          topics.push(arg);
        } else {
          // 对于其他类型的值，编码为bytes32
          const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
            ['uint256'],
            [arg],
          );
          topics.push(encoded);
        }
      }
    }

    return topics;
  }

  /**
   * 根据ABI和事件名称构建完整的topics数组（智能处理filter.topics）
   */
  buildFullTopicsForEvents(
    abi: any[],
    event_names?: string | string[],
    filterTopics?: (string | string[] | null)[],
  ): (string | string[] | null)[] | undefined {
    if (!filterTopics || filterTopics.length === 0) {
      return undefined;
    }

    // 获取所有事件ABI
    const all_event_abis = abi.filter((item: any) => item.type === 'event');

    // 如果指定了event_names，则过滤相应的事件
    const event_abis = event_names
      ? all_event_abis.filter((item: any) =>
          Array.isArray(event_names)
            ? event_names.includes(item.name)
            : item.name === event_names,
        )
      : all_event_abis;

    if (event_abis.length === 0) {
      return undefined;
    }

    // 对于多个事件，我们需要找到共同的indexed参数结构
    // 这里简化处理：假设所有事件有相同的indexed参数结构
    const firstEvent = event_abis[0];
    const indexedInputs = firstEvent.inputs.filter(
      (input: any) => input.indexed,
    );

    if (indexedInputs.length === 0) {
      return undefined;
    }

    // 生成事件topics (topic0)
    const event_topics = this.getEventTopics(event_abis);

    // 处理indexed参数
    const processedIndexedArgs: (string | null)[] = [];

    for (
      let i = 0;
      i < Math.min(filterTopics.length, indexedInputs.length);
      i++
    ) {
      const arg = filterTopics[i];
      const input = indexedInputs[i];

      if (arg === null) {
        processedIndexedArgs.push(null);
      } else {
        if (input.type === 'address') {
          // address类型：转换为32字节
          processedIndexedArgs.push(ethers.zeroPadValue(arg.toString(), 32));
        } else if (
          input.type.startsWith('uint') ||
          input.type.startsWith('int')
        ) {
          // 数值类型：编码为对应类型
          const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
            [input.type],
            [arg],
          );
          processedIndexedArgs.push(encoded);
        } else if (input.type === 'bool') {
          // 布尔类型
          const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
            ['bool'],
            [arg],
          );
          processedIndexedArgs.push(encoded);
        } else if (input.type.startsWith('bytes')) {
          // bytes类型：如果已经是0x开头，直接使用，否则编码
          if (typeof arg === 'string' && arg.startsWith('0x')) {
            processedIndexedArgs.push(ethers.zeroPadValue(arg, 32));
          } else {
            const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
              [input.type],
              [arg],
            );
            processedIndexedArgs.push(encoded);
          }
        } else {
          // 其他类型：尝试编码
          try {
            const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
              [input.type],
              [arg],
            );
            processedIndexedArgs.push(encoded);
          } catch {
            // 如果编码失败，直接转换为字符串
            processedIndexedArgs.push(arg.toString());
          }
        }
      }
    }

    // 构建完整的topics: [event_topics, ...processedIndexedArgs]
    // event_topics 是 topic0（可能包含多个事件签名）
    // processedIndexedArgs 是 topic1, topic2, topic3 等
    const fullTopics: (string | string[] | null)[] = [
      event_topics,
      ...processedIndexedArgs,
    ];
    return fullTopics;
  }

  /**
   * 获取解析后的合约日志
   */
  async getContractLogs(params: GetContractLogsParams) {
    const {
      contract_addresses,
      event_names,
      abi,
      filter = {},
      initial_batch_size = 50000,
    } = params;

    // 如果filter.topics是简单的数组（只有indexed参数），自动构建完整的topics
    let processedFilter = { ...filter };
    if (filter.topics && Array.isArray(filter.topics)) {
      const fullTopics = this.buildFullTopicsForEvents(
        abi,
        event_names,
        filter.topics,
      );
      processedFilter.topics = fullTopics;
    }

    try {
      // 1. 基础验证
      if (!contract_addresses || !abi || !Array.isArray(abi)) {
        throw new Error('合约地址和ABI数组是必需的');
      }

      const addresses = Array.isArray(contract_addresses)
        ? contract_addresses
        : [contract_addresses];

      // 2. 获取所有事件ABI
      const all_event_abis = abi.filter((item: any) => item.type === 'event');

      // 如果未指定event_names，则使用所有事件，否则过滤指定的事件
      const event_abis = event_names
        ? all_event_abis.filter((item: any) =>
            Array.isArray(event_names)
              ? event_names.includes(item.name)
              : item.name === event_names,
          )
        : all_event_abis;

      // 检查是否有匹配的事件ABI
      if (event_abis.length === 0) {
        const available_events = all_event_abis
          .map((e: any) => e.name)
          .join(', ');
        throw new Error(
          event_names
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
      let batch_size = initial_batch_size;
      const min_batch_size = 100;
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
            topics: processedFilter.topics || [event_topics],
            fromBlock: current_block,
            toBlock: end_block,
          });

          all_logs.push(...logs);
          current_block = end_block + BigInt(1);

          // 如果成功了，可以尝试增加批次大小
          if (batch_size < initial_batch_size) {
            batch_size = Math.min(batch_size * 2, initial_batch_size);
          }
        } catch (error: any) {
          console.warn(
            `获取区块 ${current_block} 至 ${end_block} 的日志失败: ${error.message}`,
          );

          // 减小批次大小并重试
          batch_size = Math.floor(batch_size / 2);

          if (batch_size < min_batch_size) {
            // 如果批次大小太小，尝试处理单个区块
            if (current_block === end_block) {
              console.error(`无法处理单个区块 ${current_block}，跳过`);
              current_block = current_block + BigInt(1);
              batch_size = initial_batch_size; // 重置批次大小
              continue;
            } else {
              // 重置为最小批次大小
              batch_size = min_batch_size;
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
  async getLogByTxHash(tx_hash: string, abi?: any) {
    const receipt = await this.web3.getTransactionReceipt(tx_hash);
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
