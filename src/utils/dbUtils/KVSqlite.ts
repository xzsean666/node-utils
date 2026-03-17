import { DataSource, Repository, Table, In } from 'typeorm';
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

// 支持的数据类型枚举
export enum SqliteValueType {
  JSON = 'json', // 存储为text，序列化JSON
  TEXT = 'text', // 纯文本
  BLOB = 'blob', // 二进制数据
  INTEGER = 'integer', // 整数
  REAL = 'real', // 浮点数
  BOOLEAN = 'boolean', // 布尔值（存储为integer）
}

// 类型处理器接口
interface TypeHandler {
  serialize(value: any): any;
  deserialize(value: any): any;
  column_type: string;
}

// 类型处理器实现
const TYPE_HANDLERS: Record<SqliteValueType, TypeHandler> = {
  [SqliteValueType.JSON]: {
    serialize: (value: any) => JSON.stringify(value, bigintHandler),
    deserialize: (value: any) => JSON.parse(value),
    column_type: 'text',
  },
  [SqliteValueType.TEXT]: {
    serialize: (value: any) => String(value),
    deserialize: (value: any) => value,
    column_type: 'text',
  },
  [SqliteValueType.BLOB]: {
    serialize: (value: any) => {
      if (value instanceof Buffer) return value;
      if (value instanceof Uint8Array) return Buffer.from(value);
      if (typeof value === 'string') return Buffer.from(value, 'utf8');
      throw new Error('BLOB type requires Buffer, Uint8Array, or string');
    },
    deserialize: (value: any) => value,
    column_type: 'blob',
  },
  [SqliteValueType.INTEGER]: {
    serialize: (value: any) => {
      const num = Number(value);
      if (!Number.isInteger(num))
        throw new Error('INTEGER type requires integer value');
      return num;
    },
    deserialize: (value: any) => Number(value),
    column_type: 'integer',
  },
  [SqliteValueType.REAL]: {
    serialize: (value: any) => Number(value),
    deserialize: (value: any) => Number(value),
    column_type: 'real',
  },
  [SqliteValueType.BOOLEAN]: {
    serialize: (value: any) => (value ? 1 : 0),
    deserialize: (value: any) => Boolean(value),
    column_type: 'integer',
  },
};

// 添加接口定义
interface KVEntity {
  key: string;
  value: any;
  created_at: Date;
  updated_at: Date;
}

function bigintHandler(key: string, val: any) {
  if (typeof val === 'bigint') {
    return val.toString(); // 将 BigInt 转换为字符串
  }
  return val;
}

export class SqliteKVDatabase {
  private static readonly SQLITE_SAFE_WRITE_BATCH_SIZE = 400;
  private static readonly SQLITE_SAFE_IN_BATCH_SIZE = 800;
  private db: Repository<KVEntity>;
  private data_source: DataSource;
  private initialized = false;
  private initializing_promise: Promise<void> | null = null;
  private table_name: string;
  private custom_kv_store: any;
  private value_type: SqliteValueType;
  private type_handler: TypeHandler;
  private readonly query_alias = 'kv';

  constructor(
    datasource_or_url?: string,
    table_name: string = 'kv_store',
    value_type: SqliteValueType = SqliteValueType.JSON,
  ) {
    this.table_name = table_name;
    this.value_type = value_type;
    this.type_handler = TYPE_HANDLERS[value_type];

    @Entity(table_name)
    class CustomKVStore implements KVEntity {
      @PrimaryColumn('varchar', { length: 255 })
      key: string;

      @Column(this.type_handler.column_type as any)
      value: any;

      @CreateDateColumn({ type: 'datetime' })
      created_at: Date;

      @UpdateDateColumn({ type: 'datetime' })
      updated_at: Date;
    }

    this.custom_kv_store = CustomKVStore;

    this.data_source = new DataSource({
      type: 'sqlite',
      database: datasource_or_url || ':memory:',
      entities: [CustomKVStore],
      synchronize: false,
    });
  }

  private async _withRetry<T>(
    operation: () => Promise<T>,
    retries: number = 2,
    delay_ms: number = 100,
  ): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await operation();
      } catch (error: any) {
        if (error?.message?.includes('SQLITE_BUSY') && i < retries - 1) {
          console.warn(
            `SQLITE_BUSY encountered for ${this.table_name}, retrying in ${delay_ms}ms... (Attempt ${
              i + 1
            }/${retries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay_ms));
        } else {
          throw error;
        }
      }
    }
    throw new Error(
      'Operation failed after multiple retries due to SQLITE_BUSY',
    );
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized && this.data_source?.isInitialized && this.db) {
      return;
    }

    if (this.initializing_promise) {
      await this.initializing_promise;
      return;
    }

    this.initializing_promise = (async () => {
      if (!this.data_source.isInitialized) {
        await this.data_source.initialize();
        // Enable WAL mode for better concurrency
        await this.data_source.query('PRAGMA journal_mode=WAL;');
        // Let SQLite wait for a short period before surfacing SQLITE_BUSY.
        await this.data_source.query('PRAGMA busy_timeout=5000;');
      }

      this.db = this.data_source.getRepository(this.custom_kv_store);

      if (this.data_source.options.synchronize) {
        await this.data_source.synchronize();
      } else {
        const query_runner = this.data_source.createQueryRunner();
        try {
          const table_exists = await query_runner.hasTable(this.table_name);
          if (!table_exists) {
            await query_runner.createTable(
              new Table({
                name: this.table_name,
                columns: [
                  {
                    name: 'key',
                    type: 'varchar',
                    length: '255',
                    isPrimary: true,
                  },
                  {
                    name: 'value',
                    type: this.type_handler.column_type,
                  },
                  {
                    name: 'created_at',
                    type: 'datetime',
                    default: 'CURRENT_TIMESTAMP',
                  },
                  {
                    name: 'updated_at',
                    type: 'datetime',
                    default: 'CURRENT_TIMESTAMP',
                  },
                ],
              }),
            );
          }

          await query_runner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_created_at" ON "${this.table_name}" ("created_at")`,
          );
          await query_runner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_updated_at" ON "${this.table_name}" ("updated_at")`,
          );
        } finally {
          await query_runner.release();
        }
      }

      this.initialized = true;
    })();

    try {
      await this.initializing_promise;
    } finally {
      this.initializing_promise = null;
    }
  }

  private async upsertEntries(entries: Array<[string, any]>): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const normalized_entries = this.dedupeEntriesByKey(entries);
    const placeholders = normalized_entries
      .map(() => '(?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
      .join(', ');
    const parameters: any[] = [];

    for (const [key, value] of normalized_entries) {
      parameters.push(key, this.type_handler.serialize(value));
    }

    await this.data_source.query(
      `
        INSERT INTO "${this.table_name}" (key, value, created_at, updated_at)
        VALUES ${placeholders}
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = CURRENT_TIMESTAMP
      `,
      parameters,
    );
  }

  private getSafeWriteBatchSize(batch_size: number): number {
    const normalized_batch_size = this.normalizePositiveInteger(
      batch_size,
      SqliteKVDatabase.SQLITE_SAFE_WRITE_BATCH_SIZE,
    );
    return Math.max(
      1,
      Math.min(
        normalized_batch_size,
        SqliteKVDatabase.SQLITE_SAFE_WRITE_BATCH_SIZE,
      ),
    );
  }

  private getSafeInBatchSize(batch_size: number): number {
    const normalized_batch_size = this.normalizePositiveInteger(
      batch_size,
      SqliteKVDatabase.SQLITE_SAFE_IN_BATCH_SIZE,
    );
    return Math.max(
      1,
      Math.min(
        normalized_batch_size,
        SqliteKVDatabase.SQLITE_SAFE_IN_BATCH_SIZE,
      ),
    );
  }

  private normalizePositiveInteger(value: number, fallback: number): number {
    if (!Number.isFinite(value)) {
      return fallback;
    }

    return Math.max(1, Math.floor(value));
  }

  private dedupeEntriesByKey<T>(entries: Array<[string, T]>): Array<[string, T]> {
    const deduped_entries = new Map<string, T>();

    for (const [key, value] of entries) {
      if (deduped_entries.has(key)) {
        deduped_entries.delete(key);
      }
      deduped_entries.set(key, value);
    }

    return Array.from(deduped_entries.entries());
  }

  private buildSelectFields(include_timestamps: boolean = false): string[] {
    const alias = this.query_alias;
    const select_fields = [
      `${alias}.key as "key"`,
      `${alias}.value as "value"`,
    ];

    if (include_timestamps) {
      select_fields.push(
        `${alias}.created_at as "created_at"`,
        `${alias}.updated_at as "updated_at"`,
      );
    }

    return select_fields;
  }

  private formatRecordValue<T>(
    record: { created_at?: Date; updated_at?: Date },
    value: T,
    include_timestamps: boolean,
  ): T | { value: T; created_at: Date; updated_at: Date } {
    if (!include_timestamps) {
      return value;
    }

    return {
      value,
      created_at: record.created_at as Date,
      updated_at: record.updated_at as Date,
    };
  }

  private async getRawRecordsByKeys(
    keys: string[],
    include_timestamps: boolean,
  ): Promise<any[]> {
    const unique_keys = Array.from(new Set(keys));
    if (unique_keys.length === 0) {
      return [];
    }

    const alias = this.query_alias;
    const effective_batch_size = this.getSafeInBatchSize(unique_keys.length);
    const records: any[] = [];

    for (let i = 0; i < unique_keys.length; i += effective_batch_size) {
      const batch = unique_keys.slice(i, i + effective_batch_size);
      const batch_records = await this._withRetry(() =>
        this.db
          .createQueryBuilder(alias)
          .select(this.buildSelectFields(include_timestamps))
          .where(`${alias}.key IN (:...keys)`, { keys: batch })
          .getRawMany(),
      );
      records.push(...batch_records);
    }

    return records;
  }

  async put(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    await this._withRetry(() => this.upsertEntries([[key, value]]));
  }

  // 方法重载以保持向后兼容性
  async get<T = any>(key: string, expire?: number): Promise<T | null>;
  async get<T = any>(
    key: string,
    options?: {
      expire?: number;
      include_timestamps?: boolean;
    },
  ): Promise<T | { value: T; created_at: Date; updated_at: Date } | null>;
  async get<T = any>(
    key: string,
    options_or_expire?:
      | number
      | {
          expire?: number;
          include_timestamps?: boolean;
        },
  ): Promise<T | { value: T; created_at: Date; updated_at: Date } | null> {
    await this.ensureInitialized();
    const include_timestamps =
      typeof options_or_expire === 'object' &&
      options_or_expire?.include_timestamps === true;
    const records = await this.getRawRecordsByKeys([key], include_timestamps);
    const record = records[0];

    if (!record) return null;

    // 处理参数类型 - 兼容旧的expire参数和新的options对象
    let expire: number | undefined;
    let should_include_timestamps = include_timestamps;

    if (typeof options_or_expire === 'number') {
      expire = options_or_expire;
    } else if (options_or_expire && typeof options_or_expire === 'object') {
      expire = options_or_expire.expire;
      should_include_timestamps = options_or_expire.include_timestamps || false;
    }

    // 如果设置了过期时间，检查是否过期
    if (expire !== undefined) {
      const current_time = Math.floor(Date.now() / 1000);
      const created_time = Math.floor(record.created_at.getTime() / 1000);

      if (current_time - created_time > expire) {
        // 过期数据自动删除
        await this.delete(key);
        return null;
      }
    }

    const deserialized_value = this.type_handler.deserialize(record.value);

    // 如果需要包含时间戳，返回包含时间戳的对象
    if (should_include_timestamps) {
      return {
        value: deserialized_value,
        created_at: record.created_at,
        updated_at: record.updated_at,
      };
    }

    return deserialized_value;
  }

  async merge(key: string, value: any): Promise<void> {
    await this.ensureInitialized();

    // 先判断是不是JSON类型，如果不是直接抛出错误
    if (this.value_type !== SqliteValueType.JSON) {
      throw new Error(
        `Merge operation is only supported for JSON type, current type is: ${this.value_type}`,
      );
    }

    // 如果是JSON，先把原有的value取出来
    const existing_value = await this.get(key);

    let merged_value: any;
    if (existing_value === null) {
      // 如果原来没有值，直接使用新值
      merged_value = value;
    } else {
      // 检查原有值和新值是否都是对象类型，才能进行合并
      if (
        typeof existing_value === 'object' &&
        existing_value !== null &&
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(existing_value) &&
        !Array.isArray(value)
      ) {
        // 将新值与原有值合并
        merged_value = { ...existing_value, ...value };
      } else {
        // 如果不是对象类型，直接替换
        merged_value = value;
      }
    }

    // 存储合并后的值
    await this._withRetry(() => this.upsertEntries([[key, merged_value]]));
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureInitialized();
    const result = await this._withRetry(() => this.db.delete({ key }));
    return !!result.affected && result.affected > 0;
  }

  async add(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    try {
      await this._withRetry(() =>
        this.db.insert({
          key,
          value: this.type_handler.serialize(value),
        }),
      );
    } catch (error: any) {
      if (error?.message?.includes('SQLITE_CONSTRAINT')) {
        throw new Error(`Key "${key}" already exists`);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.data_source?.isInitialized) {
      await this.data_source.destroy();
    }
    this.initialized = false;
    this.initializing_promise = null;
  }

  // 获取所有键值对
  async getAll<T = any>(options?: {
    include_timestamps?: boolean;
    created_after?: Date;
    created_before?: Date;
    updated_after?: Date;
    updated_before?: Date;
    offset?: number;
    limit?: number;
  }): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    await this.ensureInitialized();
    const alias = this.query_alias;
    const include_timestamps = options?.include_timestamps === true;
    const offset = options?.offset;
    const limit = options?.limit;

    // 统一使用 queryBuilder 来支持分页
    const query_builder = this.db.createQueryBuilder(alias);

    // 添加时间筛选条件
    if (options?.created_after) {
      query_builder.andWhere(`${alias}.created_at >= :created_after`, {
        created_after: options.created_after,
      });
    }

    if (options?.created_before) {
      query_builder.andWhere(`${alias}.created_at <= :created_before`, {
        created_before: options.created_before,
      });
    }

    if (options?.updated_after) {
      query_builder.andWhere(`${alias}.updated_at >= :updated_after`, {
        updated_after: options.updated_after,
      });
    }

    if (options?.updated_before) {
      query_builder.andWhere(`${alias}.updated_at <= :updated_before`, {
        updated_before: options.updated_before,
      });
    }

    // 添加分页支持
    if (offset !== undefined) {
      query_builder.skip(offset);
    }

    if (limit !== undefined) {
      query_builder.take(limit);
    }

    // 添加排序以确保分页结果的一致性
    query_builder.orderBy(`${alias}.key`, 'ASC');

    const records = await this._withRetry(() =>
      query_builder.select(this.buildSelectFields(include_timestamps)).getRawMany(),
    );

    return records.reduce(
      (
        acc,
        record: { key: any; value: any; created_at: Date; updated_at: Date },
      ) => {
        const deserialized = this.type_handler.deserialize(record.value) as T;
        acc[record.key] = this.formatRecordValue(
          record,
          deserialized,
          include_timestamps,
        );
        return acc;
      },
      {} as Record<
        string,
        T | { value: T; created_at: Date; updated_at: Date }
      >,
    );
  }

  async getMany<T = any>(
    keys: string[],
    options?: { include_timestamps?: boolean },
  ): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date } | null>
  > {
    await this.ensureInitialized();
    if (keys.length === 0) {
      return {};
    }

    const include_timestamps = options?.include_timestamps === true;
    const unique_keys = Array.from(new Set(keys));
    const records = await this.getRawRecordsByKeys(
      unique_keys,
      include_timestamps,
    );

    // 使用Map提高查找性能，避免O(n²)复杂度
    const record_map = new Map<string, any>();
    for (const record of records) {
      try {
        const deserialized = this.type_handler.deserialize(record.value) as T;
        record_map.set(
          record.key,
          this.formatRecordValue(record, deserialized, include_timestamps),
        );
      } catch (deserialize_error: any) {
        console.warn(
          `Failed to deserialize record for key ${record.key}: ${deserialize_error.message}`,
        );
        // 设置为null而不是抛出错误，保证其他数据正常返回
        record_map.set(record.key, null);
      }
    }

    // 为所有请求的keys分配值，不存在的返回null
    const result: Record<
      string,
      T | { value: T; created_at: Date; updated_at: Date } | null
    > = {};
    for (const key of keys) {
      result[key] = record_map.get(key) ?? null;
    }

    return result;
  }

  async getRecent<T = any>(
    limit: number = 100,
    seconds: number = 0,
    options?: { include_timestamps?: boolean },
  ): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    await this.ensureInitialized();
    const include_timestamps = options?.include_timestamps === true;
    const alias = this.query_alias;
    const query_builder = this.db
      .createQueryBuilder(alias)
      .select(this.buildSelectFields(include_timestamps))
      .orderBy(`${alias}.created_at`, 'DESC')
      .take(limit);

    if (seconds > 0) {
      query_builder.where(`${alias}.created_at > :created_after`, {
        created_after: new Date(Date.now() - seconds * 1000),
      });
    }

    const records = await this._withRetry(() => query_builder.getRawMany());
    return records.reduce(
      (
        acc,
        record: { key: any; value: any; created_at: Date; updated_at: Date },
      ) => {
        const deserialized = this.type_handler.deserialize(record.value) as T;
        acc[record.key] = this.formatRecordValue(
          record,
          deserialized,
          include_timestamps,
        );
        return acc;
      },
      {} as Record<
        string,
        T | { value: T; created_at: Date; updated_at: Date }
      >,
    );
  }
  // 获取所有键
  async keys(): Promise<string[]> {
    await this.ensureInitialized();
    const alias = this.query_alias;
    const records = await this._withRetry(() =>
      this.db
        .createQueryBuilder(alias)
        .select([`${alias}.key as "key"`])
        .orderBy(`${alias}.key`, 'ASC')
        .getRawMany(),
    );
    return records.map((record: { key: any }) => record.key);
  }

  // 检查键是否存在
  async has(key: string): Promise<boolean> {
    await this.ensureInitialized();
    const record = await this.db
      .createQueryBuilder(this.query_alias)
      .select('1', 'exists')
      .where(`${this.query_alias}.key = :key`, { key })
      .limit(1)
      .getRawOne();
    return !!record;
  }

  // 批量添加键值对
  async putMany(
    entries: Array<[string, any]>,
    batch_size: number = 1000,
  ): Promise<void> {
    await this.ensureInitialized();
    const normalized_entries = this.dedupeEntriesByKey(entries);
    if (normalized_entries.length === 0) {
      return;
    }

    const effective_batch_size = this.getSafeWriteBatchSize(batch_size);

    // 分批处理大量数据
    for (let i = 0; i < normalized_entries.length; i += effective_batch_size) {
      const batch = normalized_entries.slice(i, i + effective_batch_size);
      await this._withRetry(() => this.upsertEntries(batch));
    }
  }

  // 批量删除键
  async deleteMany(keys: string[]): Promise<number> {
    await this.ensureInitialized();
    const unique_keys = Array.from(new Set(keys));
    if (unique_keys.length === 0) {
      return 0;
    }

    const effective_batch_size = this.getSafeInBatchSize(unique_keys.length);
    let affected = 0;

    for (let i = 0; i < unique_keys.length; i += effective_batch_size) {
      const batch = unique_keys.slice(i, i + effective_batch_size);
      const result = await this._withRetry(() =>
        this.db.delete({ key: In(batch) }),
      );
      affected += result.affected || 0;
    }

    return affected;
  }

  // 清空数据库
  async clear(): Promise<void> {
    await this.ensureInitialized();
    await this._withRetry(() => this.db.clear());
  }

  // 获取数据库中的记录数量
  async count(): Promise<number> {
    await this.ensureInitialized();
    return await this._withRetry(() => this.db.count());
  }

  /**
   * 根据值查找键
   * @param value 要搜索的值
   * @param exact 是否精确匹配（默认为true）
   * @returns 包含匹配值的键数组
   */
  async findByValue(value: any, exact: boolean = true): Promise<string[]> {
    await this.ensureInitialized();
    const alias = this.query_alias;

    let query_builder = this.db.createQueryBuilder(alias);

    if (exact) {
      // 根据数据类型进行精确匹配
      query_builder = query_builder.where(`${alias}.value = :value`, {
        value: this.type_handler.serialize(value),
      });
    } else {
      // 文本搜索（仅适用于文本类型）
      if (
        this.value_type === SqliteValueType.TEXT ||
        this.value_type === SqliteValueType.JSON
      ) {
        const search_value = this.type_handler.serialize(value);
        query_builder = query_builder.where(`${alias}.value LIKE :value`, {
          value: `%${search_value}%`,
        });
      } else {
        throw new Error(
          `Fuzzy search not supported for ${this.value_type} type`,
        );
      }
    }

    const results = await this._withRetry(() =>
      query_builder.select([`${alias}.key as "key"`]).getRawMany(),
    );
    return results.map((record: { key: any }) => record.key);
  }

  /**
   * 根据条件查找值
   * @param condition 查询条件函数
   * @returns 匹配条件的键值对Map
   */
  async findByCondition(
    condition: (value: any) => boolean,
  ): Promise<Map<string, any>> {
    await this.ensureInitialized();
    const alias = this.query_alias;
    const all_records = await this._withRetry(() =>
      this.db
        .createQueryBuilder(alias)
        .select([`${alias}.key as "key"`, `${alias}.value as "value"`])
        .getRawMany(),
    );
    return all_records.reduce((acc, record: { key: any; value: any }) => {
      const deserialized = this.type_handler.deserialize(record.value);
      if (condition(deserialized)) {
        acc.set(record.key, deserialized);
      }
      return acc;
    }, new Map<string, any>());
  }

  /**
   * 获取当前使用的值类型
   */
  getValueType(): SqliteValueType {
    return this.value_type;
  }

  /**
   * 获取类型处理器信息
   */
  getTypeInfo(): { value_type: SqliteValueType; column_type: string } {
    return {
      value_type: this.value_type,
      column_type: this.type_handler.column_type,
    };
  }

  /**
   * 高效获取指定前缀的所有键值对
   * 使用范围查询充分利用主键索引性能
   * @param prefix 键前缀
   * @param options 查询选项
   * @returns 匹配前缀的键值对数组
   */
  async getWithPrefix<T = any>(
    prefix: string,
    options?: {
      limit?: number;
      offset?: number;
      order_by?: 'ASC' | 'DESC';
      include_timestamps?: boolean;
    },
  ): Promise<
    Array<{
      key: string;
      value: T;
      created_at?: Date;
      updated_at?: Date;
    }>
  > {
    await this.ensureInitialized();

    if (!prefix) {
      throw new Error('Prefix cannot be empty');
    }

    const alias = this.query_alias;

    const {
      limit,
      offset,
      order_by = 'ASC',
      include_timestamps = false,
    } = options || {};

    // 根据是否需要时间戳选择字段
    const select_fields = [
      `${alias}.key as "key"`,
      `${alias}.value as "value"`,
    ];

    if (include_timestamps) {
      select_fields.push(
        `${alias}.created_at as "created_at"`,
        `${alias}.updated_at as "updated_at"`,
      );
    }

    // 使用范围查询 - 这是最高效的前缀搜索方式
    // key >= 'prefix' AND key < 'prefix' + char(255)
    // 这样可以充分利用主键的索引
    const query_builder = this.db
      .createQueryBuilder(alias)
      .select(select_fields)
      .where(`${alias}.key >= :start_prefix`, {
        start_prefix: prefix,
      })
      .andWhere(`${alias}.key < :end_prefix`, {
        end_prefix: prefix + String.fromCharCode(255), // 使用 char(255) 作为范围上限
      })
      .orderBy(`${alias}.key`, order_by);

    if (limit !== undefined) {
      query_builder.limit(limit);
    }

    if (offset !== undefined) {
      query_builder.offset(offset);
    }

    try {
      const results = await query_builder.getRawMany();

      // 反序列化值并根据选项返回时间戳
      return results.map((record) => {
        const result: any = {
          key: record.key,
          value: this.type_handler.deserialize(record.value),
        };

        if (include_timestamps) {
          result.created_at = record.created_at;
          result.updated_at = record.updated_at;
        }

        return result;
      });
    } catch (error) {
      console.error('getWithPrefix query error:', error);
      throw error;
    }
  }
}
