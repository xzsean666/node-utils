import { DataSource, Repository, Table, In, MoreThan } from 'typeorm';
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
  columnType: string;
}

// 类型处理器实现
const TYPE_HANDLERS: Record<SqliteValueType, TypeHandler> = {
  [SqliteValueType.JSON]: {
    serialize: (value: any) => JSON.stringify(value, bigintHandler),
    deserialize: (value: any) => JSON.parse(value),
    columnType: 'text',
  },
  [SqliteValueType.TEXT]: {
    serialize: (value: any) => String(value),
    deserialize: (value: any) => value,
    columnType: 'text',
  },
  [SqliteValueType.BLOB]: {
    serialize: (value: any) => {
      if (value instanceof Buffer) return value;
      if (value instanceof Uint8Array) return Buffer.from(value);
      if (typeof value === 'string') return Buffer.from(value, 'utf8');
      throw new Error('BLOB type requires Buffer, Uint8Array, or string');
    },
    deserialize: (value: any) => value,
    columnType: 'blob',
  },
  [SqliteValueType.INTEGER]: {
    serialize: (value: any) => {
      const num = Number(value);
      if (!Number.isInteger(num))
        throw new Error('INTEGER type requires integer value');
      return num;
    },
    deserialize: (value: any) => Number(value),
    columnType: 'integer',
  },
  [SqliteValueType.REAL]: {
    serialize: (value: any) => Number(value),
    deserialize: (value: any) => Number(value),
    columnType: 'real',
  },
  [SqliteValueType.BOOLEAN]: {
    serialize: (value: any) => (value ? 1 : 0),
    deserialize: (value: any) => Boolean(value),
    columnType: 'integer',
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
  private dataSource: DataSource;
  private initialized = false;
  private initializingPromise: Promise<void> | null = null;
  private tableName: string;
  private CustomKVStore: any;
  private valueType: SqliteValueType;
  private typeHandler: TypeHandler;

  constructor(
    datasourceOrUrl?: string,
    tableName: string = 'kv_store',
    valueType: SqliteValueType = SqliteValueType.JSON,
  ) {
    this.tableName = tableName;
    this.valueType = valueType;
    this.typeHandler = TYPE_HANDLERS[valueType];

    @Entity(tableName)
    class CustomKVStore implements KVEntity {
      @PrimaryColumn('varchar', { length: 255 })
      key: string;

      @Column(this.typeHandler.columnType as any)
      value: any;

      @CreateDateColumn({ type: 'datetime' })
      created_at: Date;

      @UpdateDateColumn({ type: 'datetime' })
      updated_at: Date;
    }

    this.CustomKVStore = CustomKVStore;

    this.dataSource = new DataSource({
      type: 'sqlite',
      database: datasourceOrUrl || ':memory:',
      entities: [CustomKVStore],
      synchronize: false,
    });
  }

  private async _withRetry<T>(
    operation: () => Promise<T>,
    retries: number = 2,
    delayMs: number = 100,
  ): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await operation();
      } catch (error: any) {
        if (error.message.includes('SQLITE_BUSY') && i < retries - 1) {
          console.warn(
            `SQLITE_BUSY encountered for ${this.tableName}, retrying in ${delayMs}ms... (Attempt ${
              i + 1
            }/${retries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
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
    if (this.initialized && this.dataSource?.isInitialized && this.db) {
      return;
    }

    if (this.initializingPromise) {
      await this.initializingPromise;
      return;
    }

    this.initializingPromise = (async () => {
      if (!this.dataSource.isInitialized) {
        await this.dataSource.initialize();
        // Enable WAL mode for better concurrency
        await this.dataSource.query('PRAGMA journal_mode=WAL;');
      }

      this.db = this.dataSource.getRepository(this.CustomKVStore);

      if (this.dataSource.options.synchronize) {
        await this.dataSource.synchronize();
      } else {
        const queryRunner = this.dataSource.createQueryRunner();
        try {
          const tableExists = await queryRunner.hasTable(this.tableName);
          if (!tableExists) {
            await queryRunner.createTable(
              new Table({
                name: this.tableName,
                columns: [
                  {
                    name: 'key',
                    type: 'varchar',
                    length: '255',
                    isPrimary: true,
                  },
                  {
                    name: 'value',
                    type: this.typeHandler.columnType,
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
          await queryRunner.release();
        }
      }

      this.initialized = true;
    })();

    try {
      await this.initializingPromise;
    } finally {
      this.initializingPromise = null;
    }
  }

  async put(key: string, value: any): Promise<void> {
    await this.ensureInitialized();

    await this._withRetry(() =>
      this.db.save({
        key,
        value: this.typeHandler.serialize(value),
      }),
    );
  }

  // 方法重载以保持向后兼容性
  async get<T = any>(key: string, expire?: number): Promise<T | null>;
  async get<T = any>(
    key: string,
    options?: {
      expire?: number;
      includeTimestamps?: boolean;
    },
  ): Promise<T | { value: T; created_at: Date; updated_at: Date } | null>;
  async get<T = any>(
    key: string,
    optionsOrExpire?:
      | number
      | {
          expire?: number;
          includeTimestamps?: boolean;
        },
  ): Promise<T | { value: T; created_at: Date; updated_at: Date } | null> {
    await this.ensureInitialized();
    const record = await this.db.findOne({ where: { key } });

    if (!record) return null;

    // 处理参数类型 - 兼容旧的expire参数和新的options对象
    let expire: number | undefined;
    let includeTimestamps = false;

    if (typeof optionsOrExpire === 'number') {
      expire = optionsOrExpire;
    } else if (optionsOrExpire && typeof optionsOrExpire === 'object') {
      expire = optionsOrExpire.expire;
      includeTimestamps = optionsOrExpire.includeTimestamps || false;
    }

    // 如果设置了过期时间，检查是否过期
    if (expire !== undefined) {
      const currentTime = Math.floor(Date.now() / 1000);
      const createdTime = Math.floor(record.created_at.getTime() / 1000);

      if (currentTime - createdTime > expire) {
        // 过期数据自动删除
        await this.delete(key);
        return null;
      }
    }

    const deserializedValue = this.typeHandler.deserialize(record.value);

    // 如果需要包含时间戳，返回包含时间戳的对象
    if (includeTimestamps) {
      return {
        value: deserializedValue,
        created_at: record.created_at,
        updated_at: record.updated_at,
      };
    }

    return deserializedValue;
  }

  async merge(key: string, value: any): Promise<void> {
    await this.ensureInitialized();

    // 先判断是不是JSON类型，如果不是直接抛出错误
    if (this.valueType !== SqliteValueType.JSON) {
      throw new Error(
        `Merge operation is only supported for JSON type, current type is: ${this.valueType}`,
      );
    }

    // 如果是JSON，先把原有的value取出来
    const existingValue = await this.get(key);

    let mergedValue: any;
    if (existingValue === null) {
      // 如果原来没有值，直接使用新值
      mergedValue = value;
    } else {
      // 检查原有值和新值是否都是对象类型，才能进行合并
      if (
        typeof existingValue === 'object' &&
        existingValue !== null &&
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(existingValue) &&
        !Array.isArray(value)
      ) {
        // 将新值与原有值合并
        mergedValue = { ...existingValue, ...value };
      } else {
        // 如果不是对象类型，直接替换
        mergedValue = value;
      }
    }

    // 存储合并后的值
    await this._withRetry(() => this.put(key, mergedValue));
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
        value: this.typeHandler.serialize(value),
      }),
    );
  }

  async close(): Promise<void> {
    if (this.initialized && this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
      this.initialized = false;
    }
  }

  // 获取所有键值对
  async getAll<T = any>(options?: {
    includeTimestamps?: boolean;
    createdAfter?: Date;
    createdBefore?: Date;
    updatedAfter?: Date;
    updatedBefore?: Date;
    offset?: number;
    limit?: number;
  }): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    await this.ensureInitialized();
    const includeTimestamps = options?.includeTimestamps === true;
    const offset = options?.offset;
    const limit = options?.limit;

    // 构建查询条件
    const whereConditions: any = {};

    if (options?.createdAfter) {
      whereConditions.created_at = whereConditions.created_at || {};
      whereConditions.created_at = {
        ...whereConditions.created_at,
        $gte: options.createdAfter,
      };
    }

    if (options?.createdBefore) {
      whereConditions.created_at = whereConditions.created_at || {};
      whereConditions.created_at = {
        ...whereConditions.created_at,
        $lte: options.createdBefore,
      };
    }

    if (options?.updatedAfter) {
      whereConditions.updated_at = whereConditions.updated_at || {};
      whereConditions.updated_at = {
        ...whereConditions.updated_at,
        $gte: options.updatedAfter,
      };
    }

    if (options?.updatedBefore) {
      whereConditions.updated_at = whereConditions.updated_at || {};
      whereConditions.updated_at = {
        ...whereConditions.updated_at,
        $lte: options.updatedBefore,
      };
    }

    // 统一使用 queryBuilder 来支持分页
    const queryBuilder = this.db.createQueryBuilder(this.tableName);

    // 添加时间筛选条件
    if (whereConditions.created_at) {
      if (whereConditions.created_at.$gte) {
        queryBuilder.andWhere(`${this.tableName}.created_at >= :createdAfter`, {
          createdAfter: whereConditions.created_at.$gte,
        });
      }
      if (whereConditions.created_at.$lte) {
        queryBuilder.andWhere(
          `${this.tableName}.created_at <= :createdBefore`,
          {
            createdBefore: whereConditions.created_at.$lte,
          },
        );
      }
    }

    if (whereConditions.updated_at) {
      if (whereConditions.updated_at.$gte) {
        queryBuilder.andWhere(`${this.tableName}.updated_at >= :updatedAfter`, {
          updatedAfter: whereConditions.updated_at.$gte,
        });
      }
      if (whereConditions.updated_at.$lte) {
        queryBuilder.andWhere(
          `${this.tableName}.updated_at <= :updatedBefore`,
          {
            updatedBefore: whereConditions.updated_at.$lte,
          },
        );
      }
    }

    // 添加分页支持
    if (offset !== undefined) {
      queryBuilder.skip(offset);
    }

    if (limit !== undefined) {
      queryBuilder.take(limit);
    }

    // 添加排序以确保分页结果的一致性
    queryBuilder.orderBy(`${this.tableName}.key`, 'ASC');

    const records = await queryBuilder.getMany();

    return records.reduce(
      (
        acc,
        record: { key: any; value: any; created_at: Date; updated_at: Date },
      ) => {
        const deserialized = this.typeHandler.deserialize(record.value) as T;
        acc[record.key] = includeTimestamps
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
    options?: { includeTimestamps?: boolean },
  ): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date } | null>
  > {
    await this.ensureInitialized();
    if (keys.length === 0) {
      return {};
    }

    const includeTimestamps = options?.includeTimestamps === true;

    // 优化：对于大量键的查询，分批执行避免SQL过长和锁竞争
    let records: any[] = [];
    if (keys.length > 50) {
      // 分批查询，每批50个
      const batchSize = 50;
      const allRecords: any[] = [];

      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        try {
          const batchRecords = await this._withRetry(() =>
            this.db.find({
              where: { key: In(batch) },
              cache: true, // 启用查询缓存
            }),
          );
          allRecords.push(...batchRecords);
        } catch (error: any) {
          console.warn(
            `Batch query failed for keys ${i}-${i + batchSize}: ${error.message}`,
          );
          // 继续执行其他批次
        }
      }
      records = allRecords;
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
    const recordMap = new Map<string, any>();
    for (const record of records) {
      try {
        const deserialized = this.typeHandler.deserialize(record.value) as T;
        recordMap.set(
          record.key,
          includeTimestamps
            ? {
                value: deserialized,
                created_at: record.created_at,
                updated_at: record.updated_at,
              }
            : deserialized,
        );
      } catch (deserializeError: any) {
        console.warn(
          `Failed to deserialize record for key ${record.key}: ${deserializeError.message}`,
        );
        // 设置为null而不是抛出错误，保证其他数据正常返回
        recordMap.set(record.key, null);
      }
    }

    // 为所有请求的keys分配值，不存在的返回null
    const result: Record<
      string,
      T | { value: T; created_at: Date; updated_at: Date } | null
    > = {};
    for (const key of keys) {
      result[key] = recordMap.get(key) ?? null;
    }

    return result;
  }

  async getRecent<T = any>(
    limit: number = 100,
    seconds: number = 0,
    options?: { includeTimestamps?: boolean },
  ): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    await this.ensureInitialized();
    const includeTimestamps = options?.includeTimestamps === true;
    const baseOptions: any = {
      order: { created_at: 'DESC' },
      take: limit,
    };

    if (seconds > 0) {
      baseOptions.where = {
        created_at: MoreThan(new Date(Date.now() - seconds * 1000)),
      };
    }

    const records = await this.db.find(baseOptions);
    return records.reduce(
      (
        acc,
        record: { key: any; value: any; created_at: Date; updated_at: Date },
      ) => {
        const deserialized = this.typeHandler.deserialize(record.value) as T;
        acc[record.key] = includeTimestamps
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
    batchSize: number = 1000,
  ): Promise<void> {
    await this.ensureInitialized();

    // 分批处理大量数据
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const entities = batch.map(([key, value]) => ({
        key,
        value: this.typeHandler.serialize(value),
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

    let queryBuilder = this.db.createQueryBuilder(this.tableName);

    if (exact) {
      // 根据数据类型进行精确匹配
      queryBuilder = queryBuilder.where(`value = :value`, {
        value: this.typeHandler.serialize(value),
      });
    } else {
      // 文本搜索（仅适用于文本类型）
      if (
        this.valueType === SqliteValueType.TEXT ||
        this.valueType === SqliteValueType.JSON
      ) {
        const searchValue = this.typeHandler.serialize(value);
        queryBuilder = queryBuilder.where(`value LIKE :value`, {
          value: `%${searchValue}%`,
        });
      } else {
        throw new Error(
          `Fuzzy search not supported for ${this.valueType} type`,
        );
      }
    }

    const results = await queryBuilder.getMany();
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
    const allRecords = await this.db.find();
    const matchedRecords = allRecords.filter((record: { value: any }) =>
      condition(this.typeHandler.deserialize(record.value)),
    );
    return matchedRecords.reduce((acc, record: { key: any; value: any }) => {
      acc.set(record.key, this.typeHandler.deserialize(record.value));
      return acc;
    }, new Map<string, any>());
  }

  /**
   * 获取当前使用的值类型
   */
  getValueType(): SqliteValueType {
    return this.valueType;
  }

  /**
   * 获取类型处理器信息
   */
  getTypeInfo(): { valueType: SqliteValueType; columnType: string } {
    return {
      valueType: this.valueType,
      columnType: this.typeHandler.columnType,
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
      orderBy?: 'ASC' | 'DESC';
      includeTimestamps?: boolean;
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

    const {
      limit,
      offset,
      orderBy = 'ASC',
      includeTimestamps = false,
    } = options || {};

    // 根据是否需要时间戳选择字段
    const selectFields = [
      `${this.tableName}.key as "key"`,
      `${this.tableName}.value as "value"`,
    ];

    if (includeTimestamps) {
      selectFields.push(
        `${this.tableName}.created_at as "created_at"`,
        `${this.tableName}.updated_at as "updated_at"`,
      );
    }

    // 使用范围查询 - 这是最高效的前缀搜索方式
    // key >= 'prefix' AND key < 'prefix' + char(255)
    // 这样可以充分利用主键的索引
    const queryBuilder = this.db
      .createQueryBuilder(this.tableName)
      .select(selectFields)
      .where(`${this.tableName}.key >= :startPrefix`, { startPrefix: prefix })
      .andWhere(`${this.tableName}.key < :endPrefix`, {
        endPrefix: prefix + String.fromCharCode(255), // 使用 char(255) 作为范围上限
      })
      .orderBy(`${this.tableName}.key`, orderBy);

    if (limit !== undefined) {
      queryBuilder.limit(limit);
    }

    if (offset !== undefined) {
      queryBuilder.offset(offset);
    }

    try {
      const results = await queryBuilder.getRawMany();

      // 反序列化值并根据选项返回时间戳
      return results.map((record) => {
        const result: any = {
          key: record.key,
          value: this.typeHandler.deserialize(record.value),
        };

        if (includeTimestamps) {
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
