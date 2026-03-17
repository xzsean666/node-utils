import { DataSource, Repository, Table, In } from 'typeorm';
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

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

export class KVDatabase {
  private db: Repository<KVEntity>;
  private dataSource: DataSource;
  private initialized = false;
  private tableName: string;
  private CustomKVStore: any;

  constructor(datasourceOrUrl?: string, tableName: string = 'kv_store') {
    this.tableName = tableName;

    @Entity(tableName)
    class CustomKVStore implements KVEntity {
      @PrimaryColumn('varchar', { length: 255 })
      key: string;

      @Column('text')
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
                    type: 'text',
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
      value: JSON.stringify(value, bigintHandler),
    });
  }

  async get<T = any>(
    key: string,
    expire?: number,
    deleteExpired: boolean = true,
  ): Promise<T | null> {
    await this.ensureInitialized();
    const record = await this.db.findOne({ where: { key } });

    if (!record) return null;

    // 如果设置了过期时间，检查是否过期
    if (expire !== undefined) {
      const currentTime = Math.floor(Date.now() / 1000);
      const createdTime = Math.floor(record.created_at.getTime() / 1000);

      if (currentTime - createdTime > expire) {
        // 可选：删除过期数据
        if (deleteExpired) {
          await this.delete(key);
        }
        return null;
      }
    }

    return JSON.parse(record.value);
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
      value: JSON.stringify(value, bigintHandler),
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
    return records.reduce(
      (acc, record: { key: any; value: any }) => {
        acc[record.key] = JSON.parse(record.value);
        return acc;
      },
      {} as Record<string, any>,
    );
  }

  async getMany(limit: number = 10): Promise<Record<string, any>> {
    await this.ensureInitialized();
    const records = await this.db.find({ take: limit });
    return records.reduce(
      (acc, record: { key: any; value: any }) => {
        acc[record.key] = JSON.parse(record.value);
        return acc;
      },
      {} as Record<string, any>,
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
        value: JSON.stringify(value),
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
      // SQLite 的 JSON 查询语法
      queryBuilder = queryBuilder.where(`value = :value`, {
        value: JSON.stringify(value),
      });
    } else {
      // SQLite 的文本搜索
      const searchValue =
        typeof value === 'string' ? value : JSON.stringify(value);
      queryBuilder = queryBuilder.where(`value LIKE :value`, {
        value: `%${searchValue}%`,
      });
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
      condition(JSON.parse(record.value)),
    );
    return matchedRecords.reduce((acc, record: { key: any; value: any }) => {
      acc.set(record.key, JSON.parse(record.value));
      return acc;
    }, new Map<string, any>());
  }
}
