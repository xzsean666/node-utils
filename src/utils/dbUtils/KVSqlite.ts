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

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.dataSource.initialize();
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
    }
  }

  async put(key: string, value: any): Promise<void> {
    await this.ensureInitialized();

    await this.db.save({
      key,
      value: this.typeHandler.serialize(value),
    });
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

  async delete(key: string): Promise<boolean> {
    await this.ensureInitialized();
    const result = await this.db.delete({ key });
    return !!result.affected && result.affected > 0;
  }

  async add(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    const existing = await this.db.findOne({ where: { key } });
    if (existing) {
      throw new Error(`Key "${key}" already exists`);
    }
    await this.db.save({
      key,
      value: this.typeHandler.serialize(value),
    });
  }

  async close(): Promise<void> {
    if (this.initialized && this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
      this.initialized = false;
    }
  }

  // 获取所有键值对
  async getAll(): Promise<Record<string, any>> {
    await this.ensureInitialized();
    const records = await this.db.find();
    return records.reduce((acc, record: { key: any; value: any }) => {
      acc[record.key] = this.typeHandler.deserialize(record.value);
      return acc;
    }, {} as Record<string, any>);
  }

  async getMany(limit: number = 10): Promise<Record<string, any>> {
    await this.ensureInitialized();
    const records = await this.db.find({ take: limit });
    return records.reduce((acc, record: { key: any; value: any }) => {
      acc[record.key] = this.typeHandler.deserialize(record.value);
      return acc;
    }, {} as Record<string, any>);
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
      await this.db.save(entities);
    }
  }

  // 批量删除键
  async deleteMany(keys: string[]): Promise<number> {
    await this.ensureInitialized();
    const result = await this.db.delete({ key: In(keys) });
    return result.affected || 0;
  }

  // 清空数据库
  async clear(): Promise<void> {
    await this.ensureInitialized();
    await this.db.clear();
  }

  // 获取数据库中的记录数量
  async count(): Promise<number> {
    await this.ensureInitialized();
    return await this.db.count();
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
