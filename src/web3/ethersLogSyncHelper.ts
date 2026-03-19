import {
  EthersLogHelper,
  type EthersLogHelperConfig,
  type LogFilter,
  type ParsedContractLog,
} from "./ethersLogHelper";

import { PGKVDatabase } from "../dbUtils/KVPostgresql";
import { SqliteKVDatabase } from "../dbUtils/KVSqlite";

import { memoryCache } from "../dbUtils/MemoryCache";
import { ethers, type InterfaceAbi } from "ethers";

interface KVStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  putMany(entries: Array<[string, unknown]>): Promise<void>;
  getWithPrefix<T = unknown>(
    prefix: string,
    options?: {
      limit?: number;
      offset?: number;
      order_by?: "ASC" | "DESC";
      include_timestamps?: boolean;
    },
  ): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  >;
  scan<T = unknown>(options?: {
    cursor?: string;
    limit?: number;
    order_by?: "ASC" | "DESC";
    prefix?: string;
    include_timestamps?: boolean;
  }): Promise<{
    data: Record<string, T | { value: T; created_at: Date; updated_at: Date }>;
    next_cursor: string | null;
  }>;
  close(): Promise<void>;
}

type StoredLogKeyStrategy = "legacy" | "event_block_index" | "custom";
type SyncBlockTag = "latest" | "safe" | "finalized";

interface ContractMetadata {
  start_block?: number;
  nonce?: number;
  last_sync?: number;
  key_strategy?: StoredLogKeyStrategy;
}

interface StoredLogRecord {
  blockNumber?: number;
  block_number?: number;
  args?: ArrayLike<unknown> | null;
  name?: string;
  [key: string]: unknown;
}

export interface EthersLogSyncHelperConfig extends EthersLogHelperConfig {
  sqlite_path?: string;
  postgres_path?: string;
  max_sync_block_range?: number;
  confirmations?: number;
  sync_block_tag?: SyncBlockTag;
  reuse_db_instances?: boolean;
}

export interface SyncLogsParams {
  contract_address: string;
  abi: InterfaceAbi;
  event_name?: string | string[];
  start_block?: number;
  filter?: LogFilter;
  key_generator?: (log: ParsedContractLog, nonce: number) => string;
  confirmations?: number;
  sync_block_tag?: SyncBlockTag;
}

export interface SyncLogsResult {
  logs: ParsedContractLog[];
  synced_logs: number;
  from_block: number;
  to_block: number;
  next_nonce: number;
}

export interface StoredLogsQueryResult<TLog = StoredLogRecord> {
  logs: TLog[];
  total_count: number;
  contract_address: string;
  event_name?: string;
  start_block: number;
  to_block: number;
  limit?: number;
  offset?: number;
}

export class EthersLogSyncHelper extends EthersLogHelper {
  private static readonly SAFE_IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
  private static readonly DEFAULT_KEY_STRATEGY: StoredLogKeyStrategy =
    "event_block_index";
  private static readonly LEGACY_KEY_STRATEGY: StoredLogKeyStrategy = "legacy";
  private sqlite_path?: string;
  private postgres_path?: string;
  private resolved_sqlite_path?: string;
  private readonly max_sync_block_range: number;
  private readonly default_confirmations: number;
  private readonly default_sync_block_tag: SyncBlockTag;
  private readonly reuse_db_instances: boolean;
  private readonly db_cache = new Map<string, Promise<KVStore>>();

  constructor(
    node_provider: string | ethers.BrowserProvider | ethers.JsonRpcProvider,
    configs: EthersLogSyncHelperConfig = {},
  ) {
    super(node_provider, configs);
    this.sqlite_path = configs.sqlite_path;
    this.postgres_path = configs.postgres_path;
    this.max_sync_block_range = Math.max(
      1,
      Math.floor(configs.max_sync_block_range ?? 100000),
    );
    this.default_confirmations = Math.max(
      0,
      Math.floor(configs.confirmations ?? 0),
    );
    this.default_sync_block_tag = configs.sync_block_tag ?? "latest";
    this.reuse_db_instances = configs.reuse_db_instances === true;

    if (!this.sqlite_path && !this.postgres_path) {
      this.sqlite_path = "./db/ethersLog.db";
      this.logInfo(
        "sqlite_path is not set, using default path:",
        this.sqlite_path,
      );
    }
  }

  @memoryCache(60 * 60, "ethersLogSyncHelper")
  async getChainId() {
    const network = await this.web3.getNetwork();
    return network.chainId;
  }

  async getCurrentBlock() {
    const block = await this.web3.getBlockNumber();
    return Number(block);
  }

  private async getBlockNumberByTag(tag: SyncBlockTag): Promise<number> {
    if (tag === "latest") {
      return this.getCurrentBlock();
    }

    const block = await this.web3.getBlock(tag);
    if (!block) {
      throw new Error(`无法获取 ${tag} 区块`);
    }

    return Number(block.number);
  }

  private async resolveSyncTargetBlock(options?: {
    confirmations?: number;
    sync_block_tag?: SyncBlockTag;
  }): Promise<number> {
    const syncBlockTag = options?.sync_block_tag ?? this.default_sync_block_tag;
    const confirmations = Math.max(
      0,
      Math.floor(options?.confirmations ?? this.default_confirmations),
    );
    const baseBlock = await this.getBlockNumberByTag(syncBlockTag);

    return Math.max(0, baseBlock - confirmations);
  }

  private async getResolvedSqlitePath(): Promise<string> {
    if (!this.sqlite_path) {
      throw new Error("sqlite_path is not initialized");
    }

    if (this.resolved_sqlite_path) {
      return this.resolved_sqlite_path;
    }

    const basePath = this.sqlite_path.endsWith(".db")
      ? this.sqlite_path
      : `${this.sqlite_path}.db`;
    const chainId = await this.getChainId();

    this.resolved_sqlite_path = basePath.replace(
      /(\.db)$/,
      `_${chainId.toString()}.db`,
    );

    return this.resolved_sqlite_path;
  }

  private async closeDBSafely(
    label: string,
    db: KVStore,
    force: boolean = false,
  ) {
    if (this.reuse_db_instances && !force) {
      return;
    }

    try {
      await db.close();
    } catch (error) {
      this.logWarn(`Error closing ${label}:`, error);
    }
  }

  private extractRecordValues<T>(records: Record<string, T>): T[] {
    return Object.values(records) as T[];
  }

  private isSafeIdentifier(value: string): boolean {
    return EthersLogSyncHelper.SAFE_IDENTIFIER_REGEX.test(value);
  }

  private getContractIdentityKey(contract_address: string): string {
    const normalized = contract_address.trim();
    if (ethers.isAddress(normalized)) {
      return ethers.getAddress(normalized).toLowerCase();
    }

    return normalized;
  }

  private getContractTableName(contract_address: string): string {
    const contractKey = this.getContractIdentityKey(contract_address);
    if (this.isSafeIdentifier(contractKey)) {
      return contractKey;
    }

    if (ethers.isAddress(contractKey)) {
      return `contract_${contractKey.slice(2)}`;
    }

    return `contract_${ethers.id(contractKey).slice(2, 18)}`;
  }

  private padNumericKeySegment(
    value: number | undefined,
    width: number = 20,
  ): string {
    const normalized =
      typeof value === "number" && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : 0;

    return normalized.toString().padStart(width, "0");
  }

  private getLogStorageEventName(log: ParsedContractLog): string {
    if (typeof log.name === "string" && log.name !== "") {
      return log.name;
    }

    const firstTopic = log.topics[0];
    if (typeof firstTopic === "string" && firstTopic.length > 10) {
      return `topic_${firstTopic.slice(2, 10)}`;
    }

    return "unknown";
  }

  private buildLegacyStoredLogKey(
    log: ParsedContractLog,
    nonce: number,
  ): string {
    return `${log.name ?? "unknown"}_${log.blockNumber}_${nonce}`;
  }

  private buildIndexedStoredLogKey(
    log: ParsedContractLog,
    nonce: number,
  ): string {
    const eventName = this.getLogStorageEventName(log);
    const blockNumber = this.padNumericKeySegment(log.blockNumber);
    const transactionIndex = this.padNumericKeySegment(log.transactionIndex, 10);
    const logIndex = this.padNumericKeySegment(log.index, 10);
    const transactionHash =
      typeof log.transactionHash === "string" && log.transactionHash !== ""
        ? log.transactionHash.toLowerCase()
        : `nonce_${this.padNumericKeySegment(nonce, 12)}`;

    return `event:${eventName}:${blockNumber}:${transactionIndex}:${logIndex}:${transactionHash}`;
  }

  private getEventQueryPrefix(
    event_name: string | undefined,
    key_strategy: StoredLogKeyStrategy | undefined,
  ): string | undefined {
    if (!event_name || key_strategy !== "event_block_index") {
      return undefined;
    }

    return `event:${event_name}:`;
  }

  private getBlockRangePrefix(
    start_block: number | undefined,
    to_block: number | undefined,
  ): string | undefined {
    if (
      start_block === undefined ||
      to_block === undefined ||
      start_block < 0 ||
      to_block < start_block
    ) {
      return undefined;
    }

    const startBlockKey = this.padNumericKeySegment(start_block);
    const endBlockKey = this.padNumericKeySegment(to_block);
    let prefixLength = 0;

    while (
      prefixLength < startBlockKey.length &&
      startBlockKey[prefixLength] === endBlockKey[prefixLength]
    ) {
      prefixLength++;
    }

    return prefixLength > 0
      ? startBlockKey.slice(0, prefixLength)
      : undefined;
  }

  private getStoredLogsScanPrefix(filters: {
    event_name?: string;
    start_block?: number;
    to_block?: number;
    key_strategy?: StoredLogKeyStrategy;
  }): string | undefined {
    const eventPrefix = this.getEventQueryPrefix(
      filters.event_name,
      filters.key_strategy,
    );

    if (!eventPrefix) {
      return undefined;
    }

    const blockPrefix = this.getBlockRangePrefix(
      filters.start_block,
      filters.to_block,
    );

    return blockPrefix ? `${eventPrefix}${blockPrefix}` : eventPrefix;
  }

  private isKnownKeyStrategy(
    value: unknown,
  ): value is StoredLogKeyStrategy {
    return (
      value === "legacy" ||
      value === "event_block_index" ||
      value === "custom"
    );
  }

  private getMetadataKeyStrategy(
    metadata?: ContractMetadata,
  ): StoredLogKeyStrategy | undefined {
    return this.isKnownKeyStrategy(metadata?.key_strategy)
      ? metadata.key_strategy
      : undefined;
  }

  private async isStoreEmpty(db: KVStore): Promise<boolean> {
    const page = await db.scan({ limit: 1 });
    return Object.keys(page.data).length === 0;
  }

  private async resolveKeyStrategy(
    db: KVStore,
    metadata: ContractMetadata | undefined,
    hasCustomKeyGenerator: boolean,
  ): Promise<StoredLogKeyStrategy> {
    const metadataKeyStrategy = this.getMetadataKeyStrategy(metadata);
    if (metadataKeyStrategy) {
      return metadataKeyStrategy;
    }

    if (!(await this.isStoreEmpty(db))) {
      return EthersLogSyncHelper.LEGACY_KEY_STRATEGY;
    }

    return hasCustomKeyGenerator
      ? "custom"
      : EthersLogSyncHelper.DEFAULT_KEY_STRATEGY;
  }

  private ensureKeyStrategyConsistency(
    key_strategy: StoredLogKeyStrategy,
    hasCustomKeyGenerator: boolean,
  ): void {
    if (key_strategy === "custom" && !hasCustomKeyGenerator) {
      throw new Error(
        "当前合约日志已使用自定义 key_generator 存储，后续同步必须继续提供同一个 key_generator",
      );
    }

    if (key_strategy !== "custom" && hasCustomKeyGenerator) {
      throw new Error(
        "当前合约日志已使用内置 key 策略存储，不能在已有数据上切换为自定义 key_generator",
      );
    }
  }

  private normalizeNonNegativeInteger(value?: number): number {
    if (!Number.isFinite(value) || value === undefined || value < 0) {
      return 0;
    }

    return Math.floor(value);
  }

  private normalizePositiveInteger(value?: number): number | undefined {
    if (!Number.isFinite(value) || value === undefined || value <= 0) {
      return undefined;
    }

    return Math.floor(value);
  }

  private getStoredLogBlockNumber(log: StoredLogRecord): number | undefined {
    if (
      typeof log.blockNumber === "number" &&
      Number.isFinite(log.blockNumber)
    ) {
      return log.blockNumber;
    }

    if (
      typeof log.block_number === "number" &&
      Number.isFinite(log.block_number)
    ) {
      return log.block_number;
    }

    return undefined;
  }

  private getStoredLogName(log: StoredLogRecord): string | undefined {
    return typeof log.name === "string" && log.name !== ""
      ? log.name
      : undefined;
  }

  private valuesAreEqual(left: unknown, right: unknown): boolean {
    if (left === right) {
      return true;
    }

    if (typeof left === "bigint" || typeof right === "bigint") {
      return String(left) === String(right);
    }

    if (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length
    ) {
      return left.every((value, index) =>
        this.valuesAreEqual(value, right[index]),
      );
    }

    return String(left) === String(right);
  }

  private matchesArgs(log: StoredLogRecord, args?: unknown[]): boolean {
    if (!args || args.length === 0) {
      return true;
    }

    if (!log.args) {
      return false;
    }

    const actualArgs = Array.from(log.args);
    return args.every((expected) =>
      actualArgs.some((actual) => this.valuesAreEqual(actual, expected)),
    );
  }

  private matchesStoredLogFilters(
    log: StoredLogRecord,
    filters: {
      event_name?: string;
      start_block?: number;
      to_block?: number;
      args?: unknown[];
    },
  ): boolean {
    if (
      filters.event_name &&
      this.getStoredLogName(log) !== filters.event_name
    ) {
      return false;
    }

    const block_number = this.getStoredLogBlockNumber(log);
    const start_block = filters.start_block;
    const to_block = filters.to_block;
    const hasStartBlock = start_block !== undefined;
    const hasToBlock = to_block !== undefined;

    if ((hasStartBlock || hasToBlock) && block_number === undefined) {
      return false;
    }

    if (
      hasStartBlock &&
      block_number !== undefined &&
      block_number < start_block
    ) {
      return false;
    }

    if (hasToBlock && block_number !== undefined && block_number > to_block) {
      return false;
    }

    return this.matchesArgs(log, filters.args);
  }

  private async queryStoredLogs<TLog extends StoredLogRecord>(
    db: KVStore,
    filters: {
      event_name?: string;
      start_block?: number;
      to_block?: number;
      limit?: number;
      offset?: number;
      args?: unknown[];
      prefix?: string;
    },
  ): Promise<{ logs: TLog[]; total_count: number }> {
    const offset = this.normalizeNonNegativeInteger(filters.offset);
    const limit = this.normalizePositiveInteger(filters.limit);
    let cursor: string | undefined;
    let total_count = 0;
    const logs: TLog[] = [];

    while (true) {
      const page = await db.scan<TLog>({
        cursor,
        limit: 1000,
        prefix: filters.prefix,
      });

      const pageLogs = this.extractRecordValues(
        page.data as Record<string, TLog>,
      );
      for (const log of pageLogs) {
        if (!this.matchesStoredLogFilters(log, filters)) {
          continue;
        }

        if (
          total_count >= offset &&
          (limit === undefined || logs.length < limit)
        ) {
          logs.push(log);
        }

        total_count++;
      }

      if (!page.next_cursor) {
        break;
      }

      cursor = page.next_cursor;
    }

    return {
      logs,
      total_count,
    };
  }

  private async queryStoredLogsWithoutCount<TLog extends StoredLogRecord>(
    db: KVStore,
    filters: {
      event_name?: string;
      start_block?: number;
      to_block?: number;
      limit?: number;
      offset?: number;
      args?: unknown[];
      prefix?: string;
    },
  ): Promise<TLog[]> {
    const offset = this.normalizeNonNegativeInteger(filters.offset);
    const limit = this.normalizePositiveInteger(filters.limit);
    const requiredMatches =
      limit === undefined ? undefined : offset + limit;
    let cursor: string | undefined;
    let matched_count = 0;
    const logs: TLog[] = [];

    while (true) {
      const page = await db.scan<TLog>({
        cursor,
        limit: 1000,
        prefix: filters.prefix,
      });

      const pageLogs = this.extractRecordValues(
        page.data as Record<string, TLog>,
      );
      for (const log of pageLogs) {
        if (!this.matchesStoredLogFilters(log, filters)) {
          continue;
        }

        if (matched_count >= offset) {
          logs.push(log);
        }

        matched_count++;

        if (
          requiredMatches !== undefined &&
          matched_count >= requiredMatches
        ) {
          return logs;
        }
      }

      if (!page.next_cursor) {
        break;
      }

      cursor = page.next_cursor;
    }

    return logs;
  }

  protected async createDB(table: string): Promise<KVStore> {
    if (this.postgres_path) {
      return new PGKVDatabase(this.postgres_path, table);
    }

    if (this.sqlite_path) {
      return new SqliteKVDatabase(await this.getResolvedSqlitePath(), table);
    }

    throw new Error("database is not initialized");
  }

  async getDB(table: string): Promise<KVStore> {
    if (!this.reuse_db_instances) {
      return this.createDB(table);
    }

    const cached = this.db_cache.get(table);
    if (cached) {
      return cached;
    }

    const dbPromise = this.createDB(table).catch((error) => {
      this.db_cache.delete(table);
      throw error;
    });
    this.db_cache.set(table, dbPromise);
    return dbPromise;
  }

  async closeAllDBs(): Promise<void> {
    const entries = Array.from(this.db_cache.entries());
    this.db_cache.clear();

    for (const [table, dbPromise] of entries) {
      try {
        const db = await dbPromise;
        await this.closeDBSafely(`cached DB (${table})`, db, true);
      } catch (error) {
        this.logWarn(`Error closing cached DB (${table}):`, error);
      }
    }
  }

  async getContractDB(contract_address: string): Promise<{
    db: KVStore;
    metadata_db: KVStore;
    contract_key: string;
  }> {
    const contract_key = this.getContractIdentityKey(contract_address);
    const metadata_db = await this.getDB("metadata");
    const db = await this.getDB(this.getContractTableName(contract_address));
    return {
      db,
      metadata_db,
      contract_key,
    };
  }

  async syncLogs(params: SyncLogsParams): Promise<SyncLogsResult> {
    const {
      contract_address,
      abi,
      event_name,
      start_block = 0,
      filter,
      key_generator,
      confirmations,
      sync_block_tag,
    } = params;

    const { db, metadata_db, contract_key } =
      await this.getContractDB(contract_address);

    try {
      const metadata = await metadata_db.get<ContractMetadata>(contract_key);
      const key_strategy = await this.resolveKeyStrategy(
        db,
        metadata,
        typeof key_generator === "function",
      );
      this.ensureKeyStrategyConsistency(
        key_strategy,
        typeof key_generator === "function",
      );
      const effective_start_block =
        typeof metadata?.start_block === "number"
          ? metadata.start_block
          : start_block;
      let nonce = typeof metadata?.nonce === "number" ? metadata.nonce : 0;

      const sync_target_block = await this.resolveSyncTargetBlock({
        confirmations,
        sync_block_tag,
      });
      if (effective_start_block > sync_target_block) {
        return {
          logs: [],
          synced_logs: 0,
          from_block: effective_start_block,
          to_block: sync_target_block,
          next_nonce: nonce,
        };
      }

      const to_block = Math.min(
        sync_target_block,
        effective_start_block + this.max_sync_block_range - 1,
      );

      const logs = await this.getContractLogs({
        contract_addresses: contract_address,
        event_names: event_name,
        abi,
        filter: {
          ...(filter ?? {}),
          fromBlock: effective_start_block,
          toBlock: to_block,
        },
        initial_batch_size: Math.min(this.max_sync_block_range, 10000),
      });

      const entries: Array<[string, ParsedContractLog]> = [];

      for (const log of logs) {
        const key = key_generator
          ? key_generator(log, nonce)
          : key_strategy === "event_block_index"
            ? this.buildIndexedStoredLogKey(log, nonce)
            : this.buildLegacyStoredLogKey(log, nonce);

        entries.push([key, log]);
        nonce++;
      }

      if (entries.length > 0) {
        await db.putMany(entries);
      }

      await metadata_db.put(contract_key, {
        start_block: to_block + 1,
        nonce,
        last_sync: Date.now(),
        key_strategy,
      } satisfies ContractMetadata);

      return {
        logs,
        synced_logs: logs.length,
        from_block: effective_start_block,
        to_block,
        next_nonce: nonce,
      };
    } finally {
      await this.closeDBSafely("main DB", db);
      await this.closeDBSafely("metadata DB", metadata_db);
    }
  }

  async syncLogsToCurrent(params: {
    contract_address: string;
    abi: InterfaceAbi;
    event_name?: string | string[];
    start_block?: number;
    key_generator?: (log: ParsedContractLog, nonce: number) => string;
    confirmations?: number;
    sync_block_tag?: SyncBlockTag;
  }): Promise<boolean> {
    const {
      contract_address,
      abi,
      event_name,
      start_block = 0,
      key_generator,
      confirmations,
      sync_block_tag,
    } = params;

    while (true) {
      const sync_target_block = await this.resolveSyncTargetBlock({
        confirmations,
        sync_block_tag,
      });
      const result = await this.syncLogs({
        contract_address,
        abi,
        event_name,
        start_block,
        key_generator,
        confirmations,
        sync_block_tag,
      });

      if (result.to_block >= sync_target_block) {
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async getRecentLogs(params: {
    contract_address: string;
    event_name?: string;
    block_range?: number;
  }) {
    const { contract_address, event_name, block_range } = params;
    const { db, metadata_db, contract_key } =
      await this.getContractDB(contract_address);

    try {
      const metadata = await metadata_db.get<ContractMetadata>(contract_key);
      if (
        typeof metadata?.start_block !== "number" ||
        metadata.start_block <= 0
      ) {
        return {
          logs: [],
          total_count: 0,
          contract_address,
          event_name,
          start_block: 0,
          to_block: 0,
        };
      }

      const last_synced_block = Math.max(0, metadata.start_block - 1);
      const safe_block_range = Math.max(1, Math.floor(block_range ?? 10000));
      const start_block = Math.max(0, last_synced_block - safe_block_range + 1);
      const key_strategy = await this.resolveKeyStrategy(db, metadata, false);
      const result = await this.queryStoredLogs<StoredLogRecord>(db, {
        event_name,
        start_block,
        to_block: last_synced_block,
        prefix: this.getStoredLogsScanPrefix({
          event_name,
          start_block,
          to_block: last_synced_block,
          key_strategy,
        }),
      });

      return {
        logs: result.logs,
        total_count: result.total_count,
        contract_address,
        event_name,
        start_block,
        to_block: last_synced_block,
      };
    } finally {
      await this.closeDBSafely("main DB", db);
      await this.closeDBSafely("metadata DB", metadata_db);
    }
  }

  async getAllLogs(params: {
    contract_address: string;
    event_name?: string;
    start_block?: number;
    limit?: number;
    offset?: number;
  }) {
    const { contract_address, event_name, start_block, limit, offset } = params;
    const { db, metadata_db, contract_key } =
      await this.getContractDB(contract_address);

    try {
      const metadata = await metadata_db.get<ContractMetadata>(contract_key);
      if (!metadata?.start_block) {
        return [];
      }
      const key_strategy = await this.resolveKeyStrategy(db, metadata, false);

      const logs = await this.queryStoredLogsWithoutCount<StoredLogRecord>(db, {
        event_name,
        start_block:
          start_block !== undefined
            ? this.normalizeNonNegativeInteger(start_block)
            : undefined,
        limit,
        offset,
        prefix: this.getStoredLogsScanPrefix({
          event_name,
          start_block:
            start_block !== undefined
              ? this.normalizeNonNegativeInteger(start_block)
              : undefined,
          key_strategy,
        }),
      });

      return logs;
    } finally {
      await this.closeDBSafely("main DB", db);
      await this.closeDBSafely("metadata DB", metadata_db);
    }
  }

  async getLogs(params: {
    contract_address: string;
    event_name?: string;
    start_block?: number;
    to_block?: number;
    limit?: number;
    offset?: number;
    args?: unknown[];
  }): Promise<StoredLogsQueryResult> {
    const {
      contract_address,
      event_name,
      start_block = 0,
      to_block = 0,
      limit,
      offset,
      args,
    } = params;

    const { db, metadata_db, contract_key } =
      await this.getContractDB(contract_address);

    try {
      const metadata = await metadata_db.get<ContractMetadata>(contract_key);
      const key_strategy = await this.resolveKeyStrategy(db, metadata, false);
      const result = await this.queryStoredLogs<StoredLogRecord>(db, {
        event_name,
        start_block:
          start_block > 0
            ? this.normalizeNonNegativeInteger(start_block)
            : undefined,
        to_block:
          to_block > 0 ? this.normalizeNonNegativeInteger(to_block) : undefined,
        limit,
        offset,
        args,
        prefix: this.getStoredLogsScanPrefix({
          event_name,
          start_block:
            start_block > 0
              ? this.normalizeNonNegativeInteger(start_block)
              : undefined,
          to_block:
            to_block > 0
              ? this.normalizeNonNegativeInteger(to_block)
              : undefined,
          key_strategy,
        }),
      });

      return {
        logs: result.logs,
        total_count: result.total_count,
        contract_address,
        event_name,
        start_block,
        to_block,
        limit,
        offset,
      };
    } finally {
      await this.closeDBSafely("main DB", db);
      await this.closeDBSafely("metadata DB", metadata_db);
    }
  }
}
