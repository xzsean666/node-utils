import {
  ethers,
  type EventFragment,
  type InterfaceAbi,
  type Log,
  type LogDescription,
  type Result,
} from "ethers";
import type { EthersTxLogger } from "./ethersTxHelper";

type SupportedProvider = ethers.JsonRpcProvider | ethers.BrowserProvider;
type EventNameInput = string | string[];
type BlockTagInput = number | bigint | string;
type IndexedArgFilterValue = string | number | bigint | boolean | null;
type IndexedArgFilter = IndexedArgFilterValue | IndexedArgFilterValue[];
type ResolvedTopicFilter = (string | string[] | null)[];

interface EventInputLike {
  type?: string;
  indexed?: boolean;
  components?: EventInputLike[] | null;
}

interface EventLike {
  name: string;
  inputs?: EventInputLike[];
}

interface LogQueryPlan {
  topics: ResolvedTopicFilter;
}

export interface LogFilter {
  fromBlock?: BlockTagInput;
  toBlock?: BlockTagInput;
  topics?: IndexedArgFilter[] | Record<string, IndexedArgFilterValue[]>;
}

export interface GetRawContractLogsParams {
  contract_addresses: string | string[];
  event_signatures: string | string[];
  filter?: {
    fromBlock?: BlockTagInput;
    toBlock?: BlockTagInput;
    topics?: ResolvedTopicFilter;
  };
  initial_batch_size?: number;
}

export interface GetContractLogsParams {
  contract_addresses: string | string[];
  event_names?: EventNameInput;
  abi: InterfaceAbi;
  filter?: LogFilter;
  initial_batch_size?: number;
}

export interface EthersLogHelperConfig {
  logger?: EthersTxLogger;
}

export interface ParsedContractLog extends Log {
  args: Result | null;
  name?: string;
  signature?: string;
  eventFragment?: EventFragment;
  decoded: boolean;
}

export type { EventNameInput };

export class EthersLogHelper {
  public web3: SupportedProvider;
  protected logger?: EthersTxLogger;
  private readonly abiCoder = ethers.AbiCoder.defaultAbiCoder();

  constructor(
    node_provider: string | ethers.BrowserProvider | ethers.JsonRpcProvider,
    config: EthersLogHelperConfig = {},
  ) {
    if (typeof node_provider === "string") {
      this.web3 = new ethers.JsonRpcProvider(node_provider);
    } else if (
      node_provider instanceof ethers.BrowserProvider ||
      node_provider instanceof ethers.JsonRpcProvider
    ) {
      this.web3 = node_provider;
    } else {
      throw new Error("Invalid node_provider type");
    }

    this.logger = config.logger;
  }

  protected logInfo(...args: unknown[]) {
    this.logger?.info?.(...args);
  }

  protected logWarn(...args: unknown[]) {
    this.logger?.warn?.(...args);
  }

  protected logError(...args: unknown[]) {
    this.logger?.error?.(...args);
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private processType(input: EventInputLike): string {
    const inputType = input.type ?? "";

    if (inputType.startsWith("tuple")) {
      const suffix = inputType.slice("tuple".length);
      const components = (input.components ?? [])
        .map((component) => this.processType(component))
        .join(",");
      return `(${components})${suffix}`;
    }

    return inputType;
  }

  private getEventSignature(event: EventFragment | EventLike): string {
    const inputs = (event.inputs ?? []).map((input) => this.processType(input));
    return `${event.name}(${inputs.join(",")})`;
  }

  private getEventTopicHash(event: EventFragment | EventLike): string {
    return ethers.id(this.getEventSignature(event));
  }

  private getEventFragments(
    abi: InterfaceAbi,
    event_names?: EventNameInput,
  ): EventFragment[] {
    const requestedNames = event_names
      ? new Set(Array.isArray(event_names) ? event_names : [event_names])
      : null;

    const iface = new ethers.Interface(abi);
    return iface.fragments
      .filter(
        (fragment): fragment is EventFragment => fragment.type === "event",
      )
      .filter(
        (fragment) =>
          requestedNames === null || requestedNames.has(fragment.name),
      );
  }

  private normalizeAddresses(addresses: string | string[]): string[] {
    const normalized = Array.isArray(addresses) ? addresses : [addresses];

    if (normalized.length === 0) {
      throw new Error("至少需要一个合约地址");
    }

    return normalized;
  }

  private normalizeEventSignatures(
    event_signatures: string | string[],
  ): string[] {
    const normalized = Array.isArray(event_signatures)
      ? event_signatures
      : [event_signatures];

    if (normalized.length === 0) {
      throw new Error("至少需要一个事件签名");
    }

    return normalized;
  }

  private requiresHashedIndexedTopic(type: string): boolean {
    return (
      type === "string" ||
      type === "bytes" ||
      type.startsWith("tuple") ||
      type.includes("[")
    );
  }

  private encodeIndexedArg(
    arg: Exclude<IndexedArgFilterValue, null>,
    type: string,
  ): string {
    if (type === "address") {
      if (typeof arg !== "string") {
        throw new Error("address 类型的 indexed 参数必须是字符串");
      }

      if (ethers.isHexString(arg, 32)) {
        return arg;
      }

      return ethers.zeroPadValue(ethers.getAddress(arg), 32);
    }

    if (this.requiresHashedIndexedTopic(type)) {
      if (typeof arg === "string" && ethers.isHexString(arg, 32)) {
        return arg;
      }

      throw new Error(
        `indexed ${type} 参数需要传入已编码/哈希后的 32-byte topic`,
      );
    }

    if (type === "bool") {
      return this.abiCoder.encode(["bool"], [arg]);
    }

    return this.abiCoder.encode([type], [arg]);
  }

  private encodeIndexedTopicSelection(
    arg: IndexedArgFilter,
    type: string,
  ): string | string[] | null {
    if (arg === null || arg === undefined) {
      return null;
    }

    if (Array.isArray(arg)) {
      return arg
        .filter(
          (value): value is Exclude<IndexedArgFilterValue, null> =>
            value !== null && value !== undefined,
        )
        .map((value) => this.encodeIndexedArg(value, type));
    }

    return this.encodeIndexedArg(arg, type);
  }

  private inferIndexedArgType(
    arg: Exclude<IndexedArgFilterValue, null>,
  ): string {
    if (typeof arg === "boolean") {
      return "bool";
    }

    if (typeof arg === "number" || typeof arg === "bigint") {
      return "uint256";
    }

    if (typeof arg === "string") {
      if (ethers.isAddress(arg)) {
        return "address";
      }

      if (ethers.isHexString(arg, 32)) {
        return "bytes32";
      }

      if (ethers.isHexString(arg)) {
        return "bytes";
      }
    }

    return "uint256";
  }

  private isExplicitTopicFilter(
    filterTopics: IndexedArgFilter[],
    eventFragments: EventFragment[],
  ): filterTopics is ResolvedTopicFilter {
    const eventTopics = new Set(this.getEventTopics(eventFragments));
    const firstTopic = filterTopics[0];

    if (Array.isArray(firstTopic)) {
      return (
        firstTopic.length > 0 &&
        firstTopic.every(
          (value) => typeof value === "string" && eventTopics.has(value),
        )
      );
    }

    return typeof firstTopic === "string" && eventTopics.has(firstTopic);
  }

  private buildTopicsForEventFragment(
    eventFragment: EventFragment,
    filterTopics?: IndexedArgFilter[],
  ): ResolvedTopicFilter {
    const indexedInputs = eventFragment.inputs.filter((input) => input.indexed);
    const processedIndexedArgs = (filterTopics ?? [])
      .slice(0, indexedInputs.length)
      .map((arg, index) => {
        const input = indexedInputs[index];
        if (!input || arg === null || arg === undefined) {
          return null;
        }

        return this.encodeIndexedTopicSelection(arg, input.type);
      });

    return [this.getEventTopicHash(eventFragment), ...processedIndexedArgs];
  }

  private buildLogQueryPlans(
    eventFragments: EventFragment[],
    filterTopics?: LogFilter["topics"],
  ): LogQueryPlan[] {
    if (!filterTopics) {
      return [
        {
          topics: [this.getEventTopics(eventFragments)],
        },
      ];
    }

    if (!Array.isArray(filterTopics)) {
      return eventFragments.flatMap((eventFragment) => {
        const filterArgs = filterTopics[eventFragment.name];
        if (!filterArgs) {
          return [];
        }

        return [
          {
            topics: this.buildTopicsForEventFragment(eventFragment, filterArgs),
          },
        ];
      });
    }

    if (this.isExplicitTopicFilter(filterTopics, eventFragments)) {
      return [{ topics: filterTopics }];
    }

    if (eventFragments.length === 1) {
      const [eventFragment] = eventFragments;
      if (!eventFragment) {
        return [];
      }

      return [
        {
          topics: this.buildTopicsForEventFragment(eventFragment, filterTopics),
        },
      ];
    }

    return eventFragments.map((eventFragment) => ({
      topics: this.buildTopicsForEventFragment(eventFragment, filterTopics),
    }));
  }

  private async resolveBlockNumber(
    blockTag: BlockTagInput | undefined,
    fallback: number,
  ): Promise<bigint> {
    if (blockTag === undefined || blockTag === null) {
      return BigInt(fallback);
    }

    if (typeof blockTag === "bigint") {
      return blockTag;
    }

    if (typeof blockTag === "number") {
      return BigInt(blockTag);
    }

    const normalized = blockTag.trim();
    if (normalized === "") {
      return BigInt(fallback);
    }

    if (normalized === "latest" || normalized === "pending") {
      return BigInt(await this.web3.getBlockNumber());
    }

    if (normalized === "earliest") {
      return 0n;
    }

    if (normalized === "safe" || normalized === "finalized") {
      const block = await this.web3.getBlock(normalized);
      if (!block) {
        throw new Error(`无法解析区块标签: ${normalized}`);
      }
      return BigInt(block.number);
    }

    return BigInt(normalized);
  }

  /**
   * 获取事件主题哈希
   */
  getEventTopics(events: Array<EventFragment | EventLike>) {
    return events.map((event) => this.getEventTopicHash(event));
  }

  /**
   * 获取原始合约日志（未解析）
   */
  async getRawContractLogs(params: GetRawContractLogsParams): Promise<Log[]> {
    const {
      contract_addresses,
      event_signatures,
      filter = {},
      initial_batch_size = 10000,
    } = params;

    try {
      const addresses = this.normalizeAddresses(contract_addresses);
      const signatures = this.normalizeEventSignatures(event_signatures);
      const topics = signatures.map((signature) => ethers.id(signature));
      const currentBlockNumber = await this.web3.getBlockNumber();
      const fromBlock = await this.resolveBlockNumber(filter.fromBlock, 0);
      const toBlock = await this.resolveBlockNumber(
        filter.toBlock,
        currentBlockNumber,
      );

      if (fromBlock > toBlock) {
        throw new Error(
          `起始区块 (${fromBlock}) 不能大于结束区块 (${toBlock})`,
        );
      }

      return await this.fetchLogsWithAdaptiveBatch({
        addresses,
        topics: [topics, ...(filter.topics ?? [])],
        fromBlock,
        toBlock,
        initialBatchSize: initial_batch_size,
      });
    } catch (error) {
      throw new Error(`获取合约日志失败: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * 构建完整的 topics 数组
   */
  buildTopics(
    eventSignature: string,
    indexedArgs?: IndexedArgFilterValue[],
  ): Array<string | null> {
    const topics: Array<string | null> = [ethers.id(eventSignature)];

    for (const arg of indexedArgs ?? []) {
      if (arg === null || arg === undefined) {
        topics.push(null);
        continue;
      }

      topics.push(this.encodeIndexedArg(arg, this.inferIndexedArgType(arg)));
    }

    return topics;
  }

  /**
   * 根据 ABI 和事件名称构建完整的 topics 数组
   */
  buildFullTopicsForEvents(
    abi: InterfaceAbi,
    event_names?: EventNameInput,
    filterTopics?: LogFilter["topics"],
  ): ResolvedTopicFilter | undefined {
    const eventFragments = this.getEventFragments(abi, event_names);
    if (eventFragments.length === 0) {
      return undefined;
    }

    if (!filterTopics) {
      return undefined;
    }

    const queryPlans = this.buildLogQueryPlans(eventFragments, filterTopics);
    if (queryPlans.length !== 1) {
      return undefined;
    }

    return queryPlans[0]?.topics;
  }

  private getLogIdentity(log: Log): string {
    return `${log.blockHash}:${log.index}`;
  }

  private compareLogsByChainPosition(left: Log, right: Log): number {
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber - right.blockNumber;
    }

    if (left.transactionIndex !== right.transactionIndex) {
      return left.transactionIndex - right.transactionIndex;
    }

    if (left.index !== right.index) {
      return left.index - right.index;
    }

    return left.transactionHash.localeCompare(right.transactionHash);
  }

  private async fetchLogsWithAdaptiveBatch(params: {
    addresses: string[];
    topics: ResolvedTopicFilter;
    fromBlock: bigint;
    toBlock: bigint;
    initialBatchSize: number;
  }): Promise<Log[]> {
    const { addresses, topics, fromBlock, toBlock, initialBatchSize } = params;
    const safeInitialBatchSize = Math.max(1, Math.floor(initialBatchSize));
    let batchSize = safeInitialBatchSize;
    let currentBlock = fromBlock;
    const logs: Log[] = [];

    while (currentBlock <= toBlock) {
      const endBlockCandidate = currentBlock + BigInt(batchSize - 1);
      const endBlock =
        endBlockCandidate < toBlock ? endBlockCandidate : toBlock;

      this.logInfo(`获取日志: ${currentBlock} 至 ${endBlock}`);

      try {
        const fetchedLogs = await this.web3.getLogs({
          address: addresses.length === 1 ? addresses[0] : addresses,
          topics,
          fromBlock: currentBlock,
          toBlock: endBlock,
        });

        logs.push(...fetchedLogs);
        currentBlock = endBlock + 1n;

        if (batchSize < safeInitialBatchSize) {
          batchSize = Math.min(batchSize * 2, safeInitialBatchSize);
        }
      } catch (error) {
        this.logWarn(
          `获取区块 ${currentBlock} 至 ${endBlock} 的日志失败: ${this.getErrorMessage(error)}`,
        );

        if (currentBlock === endBlock) {
          throw new Error(
            `无法获取区块 ${currentBlock} 的日志: ${this.getErrorMessage(error)}`,
            {
              cause: error instanceof Error ? error : undefined,
            },
          );
        }

        batchSize = Math.max(1, Math.floor(batchSize / 2));
        this.logInfo(`减小批次大小至 ${batchSize} 并重试`);
      }
    }

    return logs;
  }

  /**
   * 获取解析后的合约日志
   */
  async getContractLogs(
    params: GetContractLogsParams,
  ): Promise<ParsedContractLog[]> {
    const {
      contract_addresses,
      event_names,
      abi,
      filter = {},
      initial_batch_size = 50000,
    } = params;

    try {
      const addresses = this.normalizeAddresses(contract_addresses);
      const eventFragments = this.getEventFragments(abi, event_names);

      if (eventFragments.length === 0) {
        const availableEvents = this.getEventFragments(abi)
          .map((fragment) => fragment.name)
          .join(", ");

        throw new Error(
          event_names
            ? `未找到指定的事件定义。可用事件: ${availableEvents}`
            : "ABI 中未找到任何事件定义",
        );
      }

      const eventTopics = this.getEventTopics(eventFragments);
      const queryPlans = this.buildLogQueryPlans(eventFragments, filter.topics);
      if (queryPlans.length === 0) {
        return [];
      }

      const currentBlockNumber = await this.web3.getBlockNumber();
      const fromBlock = await this.resolveBlockNumber(filter.fromBlock, 0);
      const toBlock = await this.resolveBlockNumber(
        filter.toBlock,
        currentBlockNumber,
      );

      if (fromBlock > toBlock) {
        throw new Error(
          `起始区块 (${fromBlock}) 不能大于结束区块 (${toBlock})`,
        );
      }

      const allLogs = new Map<string, Log>();
      const contractInterface = new ethers.Interface(abi);
      const allowedEventTopics = new Set(eventTopics);

      for (const queryPlan of queryPlans) {
        const logs = await this.fetchLogsWithAdaptiveBatch({
          addresses,
          topics: queryPlan.topics,
          fromBlock,
          toBlock,
          initialBatchSize: initial_batch_size,
        });

        for (const log of logs) {
          allLogs.set(this.getLogIdentity(log), log);
        }
      }

      const parsedLogs: ParsedContractLog[] = [];
      const sortedLogs = Array.from(allLogs.values()).sort((left, right) =>
        this.compareLogsByChainPosition(left, right),
      );

      for (const log of sortedLogs) {
        const firstTopic = log.topics[0];
        if (!firstTopic || !allowedEventTopics.has(firstTopic)) {
          continue;
        }

        try {
          const parsedLog = contractInterface.parseLog({
            topics: [...log.topics],
            data: log.data,
          });

          if (!parsedLog) {
            continue;
          }

          parsedLogs.push(
            Object.assign(log, {
              args: parsedLog.args,
              name: parsedLog.name,
              signature: parsedLog.signature,
              eventFragment: parsedLog.fragment,
              decoded: true,
            }) as ParsedContractLog,
          );
        } catch (error) {
          this.logWarn(`解析日志失败 (blockNumber: ${log.blockNumber})`, error);

          parsedLogs.push(
            Object.assign(log, {
              args: null,
              decoded: false,
            }) as ParsedContractLog,
          );
        }
      }

      return parsedLogs;
    } catch (error) {
      throw new Error(`获取合约日志失败: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * 根据交易哈希获取日志
   */
  async getLogByTxHash(
    tx_hash: string,
    abi?: InterfaceAbi,
  ): Promise<ReadonlyArray<Log | LogDescription>> {
    const receipt = await this.web3.getTransactionReceipt(tx_hash);
    if (!receipt) {
      throw new Error("Transaction receipt not found");
    }

    if (!abi) {
      return receipt.logs;
    }

    const iface = new ethers.Interface(abi);

    return receipt.logs
      .map((log) => {
        try {
          return iface.parseLog({
            topics: [...log.topics],
            data: log.data,
          });
        } catch (error) {
          this.logWarn("解析日志失败", error);
          return null;
        }
      })
      .filter((log): log is LogDescription => log !== null);
  }
}
