import 'reflect-metadata';
import 'reflect-metadata';
import { DataSource, Repository, Table, In, MoreThan, Like, EntitySchema } from 'typeorm';
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
  private db: Repository<KVEntity>;
  private data_source: DataSource;
  private initialized = false;
  private initializing_promise: Promise<void> | null = null;
  private table_name: string;
  private custom_kv_store: any;
  private value_type: SqliteValueType;
  private type_handler: TypeHandler;

  constructor(
    datasource_or_url?: string,
    table_name: string = 'kv_store',
    value_type: SqliteValueType = SqliteValueType.JSON,
  ) {
    this.table_name = table_name;
    this.value_type = value_type;
    this.type_handler = TYPE_HANDLERS[value_type];

    // 使用 EntitySchema 替代装饰器定义的类，解决 Reflect.getMetadata 问题
    const CustomKVStore = new EntitySchema<KVEntity>({
      name: table_name,
      columns: {
        key: {
          type: 'varchar',
          length: 255,
          primary: true,
        },
        value: {
          type: this.type_handler.column_type as any,
          nullable: true,
        },
        created_at: {
          type: 'datetime',
          createDate: true,
        },
        updated_at: {
          type: 'datetime',
          updateDate: true,
        },
      },
    });

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
        if (error.message.includes('SQLITE_BUSY') && i < retries - 1) {
          console.warn(
            `SQLITE_BUSY encountered for ${this.table_name}, retrying in ${delay_ms}ms... (Attempt ${i + 1
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

  async put(key: string, value: any): Promise<void> {
    await this.ensureInitialized();

    await this._withRetry(() =>
      this.db.save({
        key,
        value: this.type_handler.serialize(value),
      }),
    );
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
    const record = await this.db.findOne({ where: { key } });

    if (!record) return null;

    // 处理参数类型 - 兼容旧的expire参数和新的options对象
    let expire: number | undefined;
    let include_timestamps = false;

    if (typeof options_or_expire === 'number') {
      expire = options_or_expire;
    } else if (options_or_expire && typeof options_or_expire === 'object') {
      expire = options_or_expire.expire;
      include_timestamps = options_or_expire.include_timestamps || false;
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
    if (include_timestamps) {
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
    await this._withRetry(() => this.put(key, merged_value));
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureInitialized();
    const result = await this._withRetry(() => this.db.delete({ key }));
    return !!result.affected && result.affected > 0;
  }

  async add(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    const existing = await this.db.findOne({ where: { key } });
    if (existing) {
      throw new Error(`Key "${key}" already exists`);
    }
    await this._withRetry(() =>
      this.db.save({
        key,
        value: this.type_handler.serialize(value),
      }),
    );
  }

  async close(): Promise<void> {
    if (this.initialized && this.data_source?.isInitialized) {
      await this.data_source.destroy();
      this.initialized = false;
    }
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
    const include_timestamps = options?.include_timestamps === true;
    const offset = options?.offset;
    const limit = options?.limit;

    // 构建查询条件
    const where_conditions: any = {};

    if (options?.created_after) {
      where_conditions.created_at = where_conditions.created_at || {};
      where_conditions.created_at = {
        ...where_conditions.created_at,
        $gte: options.created_after,
      };
    }

    if (options?.created_before) {
      where_conditions.created_at = where_conditions.created_at || {};
      where_conditions.created_at = {
        ...where_conditions.created_at,
        $lte: options.created_before,
      };
    }

    if (options?.updated_after) {
      where_conditions.updated_at = where_conditions.updated_at || {};
      where_conditions.updated_at = {
        ...where_conditions.updated_at,
        $gte: options.updated_after,
      };
    }

    if (options?.updated_before) {
      where_conditions.updated_at = where_conditions.updated_at || {};
      where_conditions.updated_at = {
        ...where_conditions.updated_at,
        $lte: options.updated_before,
      };
    }

    // 统一使用 queryBuilder 来支持分页
    const query_builder = this.db.createQueryBuilder(this.table_name);

    // 添加时间筛选条件
    if (where_conditions.created_at) {
      if (where_conditions.created_at.$gte) {
        query_builder.andWhere(
          `${this.table_name}.created_at >= :created_after`,
          {
            created_after: where_conditions.created_at.$gte,
          },
        );
      }
      if (where_conditions.created_at.$lte) {
        query_builder.andWhere(
          `${this.table_name}.created_at <= :created_before`,
          {
            created_before: where_conditions.created_at.$lte,
          },
        );
      }
    }

    if (where_conditions.updated_at) {
      if (where_conditions.updated_at.$gte) {
        query_builder.andWhere(
          `${this.table_name}.updated_at >= :updated_after`,
          {
            updated_after: where_conditions.updated_at.$gte,
          },
        );
      }
      if (where_conditions.updated_at.$lte) {
        query_builder.andWhere(
          `${this.table_name}.updated_at <= :updated_before`,
          {
            updated_before: where_conditions.updated_at.$lte,
          },
        );
      }
    }

    // 添加分页支持
    if (offset !== undefined) {
      query_builder.skip(offset);
    }

    if (limit !== undefined) {
      query_builder.take(limit);
    }

    // 添加排序以确保分页结果的一致性
    query_builder.orderBy(`${this.table_name}.key`, 'ASC');

    const records = await query_builder.getMany();

    return records.reduce(
      (
        acc,
        record: { key: any; value: any; created_at: Date; updated_at: Date },
      ) => {
        const deserialized = this.type_handler.deserialize(record.value) as T;
        acc[record.key] = include_timestamps
          ? {
            value: deserialized,
            created_at: record.created_at,
            updated_at: record.updated_at,
          }
          : deserialized;
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
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    await this.ensureInitialized();
    if (keys.length === 0) {
      return {};
    }

    const include_timestamps = options?.include_timestamps === true;

    // 优化：对于大量键的查询，分批执行避免SQL过长和锁竞争
    let records: any[] = [];
    if (keys.length > 50) {
      // 分批查询，每批50个
      const batch_size = 50;
      const all_records: any[] = [];

      for (let i = 0; i < keys.length; i += batch_size) {
        const batch = keys.slice(i, i + batch_size);
        try {
          const batch_records = await this._withRetry(() =>
            this.db.find({
              where: { key: In(batch) },
              cache: true, // 启用查询缓存
            }),
          );
          all_records.push(...batch_records);
        } catch (error: any) {
          console.warn(
            `Batch query failed for keys ${i}-${i + batch_size}: ${error.message}`,
          );
          // 继续执行其他批次
        }
      }
      records = all_records;
    } else {
      // 小批量直接查询
      records = await this._withRetry(() =>
        this.db.find({
          where: { key: In(keys) },
          cache: true, // 启用查询缓存
        }),
      );
    }

    // 使用Map提高查找性能，避免O(n²)复杂度
    const record_map = new Map<
      string,
      T | { value: T; created_at: Date; updated_at: Date }
    >();
    for (const record of records) {
      try {
        const deserialized = this.type_handler.deserialize(record.value) as T;
        record_map.set(
          record.key,
          include_timestamps
            ? {
              value: deserialized,
              created_at: record.created_at,
              updated_at: record.updated_at,
            }
            : deserialized,
        );
      } catch (deserialize_error: any) {
        console.warn(
          `Failed to deserialize record for key ${record.key}: ${deserialize_error.message}`,
        );
      }
    }

    const result: Record<
      string,
      T | { value: T; created_at: Date; updated_at: Date }
    > = {};
    for (const [key, value] of record_map) {
      result[key] = value;
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
    const base_options: any = {
      order: { created_at: 'DESC' },
      take: limit,
    };

    if (seconds > 0) {
      base_options.where = {
        created_at: MoreThan(new Date(Date.now() - seconds * 1000)),
      };
    }

    const records = await this.db.find(base_options);
    return records.reduce(
      (
        acc,
        record: { key: any; value: any; created_at: Date; updated_at: Date },
      ) => {
        const deserialized = this.type_handler.deserialize(record.value) as T;
        acc[record.key] = include_timestamps
          ? {
            value: deserialized,
            created_at: record.created_at,
            updated_at: record.updated_at,
          }
          : deserialized;
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
    const records = await this.db.find({ select: ['key'] });
    return records.map((record: { key: any }) => record.key);
  }

  // 检查键是否存在
  async has(key: string): Promise<boolean> {
    await this.ensureInitialized();
    return (await this.db.count({ where: { key } })) > 0;
  }

  // 批量添加键值对
  async putMany(
    entries: Array<[string, any]>,
    batch_size: number = 1000,
  ): Promise<void> {
    await this.ensureInitialized();

    // 分批处理大量数据
    for (let i = 0; i < entries.length; i += batch_size) {
      const batch = entries.slice(i, i + batch_size);
      const entities = batch.map(([key, value]) => ({
        key,
        value: this.type_handler.serialize(value),
      }));
      await this._withRetry(() => this.db.save(entities));
    }
  }

  // 批量删除键
  async deleteMany(keys: string[]): Promise<number> {
    await this.ensureInitialized();
    const result = await this._withRetry(() =>
      this.db.delete({ key: In(keys) }),
    );
    return result.affected || 0;
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

    let query_builder = this.db.createQueryBuilder(this.table_name);

    if (exact) {
      // 根据数据类型进行精确匹配
      query_builder = query_builder.where(`value = :value`, {
        value: this.type_handler.serialize(value),
      });
    } else {
      // 文本搜索（仅适用于文本类型）
      if (
        this.value_type === SqliteValueType.TEXT ||
        this.value_type === SqliteValueType.JSON
      ) {
        const search_value = this.type_handler.serialize(value);
        query_builder = query_builder.where(`value LIKE :value`, {
          value: `%${search_value}%`,
        });
      } else {
        throw new Error(
          `Fuzzy search not supported for ${this.value_type} type`,
        );
      }
    }

    const results = await query_builder.getMany();
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
    const all_records = await this.db.find();
    const matched_records = all_records.filter((record: { value: any }) =>
      condition(this.type_handler.deserialize(record.value)),
    );
    return matched_records.reduce((acc, record: { key: any; value: any }) => {
      acc.set(record.key, this.type_handler.deserialize(record.value));
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
   * @returns 匹配前缀的键值对对象
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
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    await this.ensureInitialized();

    if (!prefix) {
      throw new Error('Prefix cannot be empty');
    }

    const {
      limit,
      offset,
      order_by = 'ASC',
      include_timestamps = false,
    } = options || {};

    // 根据是否需要时间戳选择字段
    const select_fields = [
      `${this.table_name}.key as "key"`,
      `${this.table_name}.value as "value"`,
    ];

    if (include_timestamps) {
      select_fields.push(
        `${this.table_name}.created_at as "created_at"`,
        `${this.table_name}.updated_at as "updated_at"`,
      );
    }

    // 使用范围查询 - 这是最高效的前缀搜索方式
    // key >= 'prefix' AND key < 'prefix' + char(255)
    // 这样可以充分利用主键的索引
    const query_builder = this.db
      .createQueryBuilder(this.table_name)
      .select(select_fields)
      .where(`${this.table_name}.key >= :start_prefix`, {
        start_prefix: prefix,
      })
      .andWhere(`${this.table_name}.key < :end_prefix`, {
        end_prefix: prefix + String.fromCharCode(255), // 使用 char(255) 作为范围上限
      })
      .orderBy(`${this.table_name}.key`, order_by);

    if (limit !== undefined) {
      query_builder.limit(limit);
    }

    if (offset !== undefined) {
      query_builder.offset(offset);
    }

    try {
      const results = await query_builder.getRawMany();

      // 反序列化值并根据选项返回时间戳
      return results.reduce(
        (
          acc,
          record: {
            key: string;
            value: any;
            created_at: Date;
            updated_at: Date;
          },
        ) => {
          const deserialized = this.type_handler.deserialize(
            record.value,
          ) as T;
          acc[record.key] = include_timestamps
            ? {
              value: deserialized,
              created_at: record.created_at,
              updated_at: record.updated_at,
            }
            : deserialized;
          return acc;
        },
        {} as Record<
          string,
          T | { value: T; created_at: Date; updated_at: Date }
        >,
      );
    } catch (error) {
      console.error('getWithPrefix query error:', error);
      throw error;
    }
  }
}
