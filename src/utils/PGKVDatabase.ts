import { DataSource, Repository, Table, In } from "typeorm";
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

// 添加接口定义
interface KVEntity {
  key: string;
  value: any;
  created_at: Date;
  updated_at: Date;
}

export class KVDatabase {
  private db: Repository<KVEntity>;
  private dataSource: DataSource;
  private initialized = false;
  private tableName: string;
  private CustomKVStore: any;

  constructor(datasourceOrUrl: string, tableName: string = "kv_store") {
    this.tableName = tableName;

    @Entity(tableName)
    class CustomKVStore implements KVEntity {
      @PrimaryColumn("varchar", { length: 255 })
      key: string;

      @Column("jsonb")
      value: any;

      @CreateDateColumn({ type: "timestamptz", name: "created_at" })
      created_at: Date;

      @UpdateDateColumn({ type: "timestamptz", name: "updated_at" })
      updated_at: Date;
    }

    this.CustomKVStore = CustomKVStore;

    this.dataSource = new DataSource({
      type: "postgres",
      url: datasourceOrUrl,
      entities: [CustomKVStore],
      synchronize: false,
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.dataSource.initialize();
      this.db = this.dataSource.getRepository(this.CustomKVStore);

      // 手动创建表和索引
      const queryRunner = this.dataSource.createQueryRunner();
      try {
        const tableExists = await queryRunner.hasTable(this.tableName);
        if (!tableExists) {
          await queryRunner.createTable(
            new Table({
              name: this.tableName,
              columns: [
                {
                  name: "key",
                  type: "varchar",
                  length: "255",
                  isPrimary: true,
                },
                {
                  name: "value",
                  type: "jsonb",
                  isNullable: true,
                },
                {
                  name: "created_at",
                  type: "timestamptz",
                  default: "CURRENT_TIMESTAMP",
                },
                {
                  name: "updated_at",
                  type: "timestamptz",
                  default: "CURRENT_TIMESTAMP",
                },
              ],
            }),
            true // ifNotExists: true
          );

          // 创建 GIN 索引
          try {
            await queryRunner.query(
              `CREATE INDEX IF NOT EXISTS "IDX_${this.tableName}_value_gin" ON "${this.tableName}" USING gin (value);`
            );
          } catch (err) {
            console.warn(`创建索引失败，可能已存在: ${err}`);
          }
        }
      } finally {
        await queryRunner.release();
      }

      this.initialized = true;
    }
  }

  async put(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    await this.db.save({
      key,
      value,
    });
  }
  async merge(key: string, partialValue: any): Promise<boolean> {
    await this.ensureInitialized();

    const result = await this.db
      .createQueryBuilder()
      .update(this.CustomKVStore)
      .set({
        value: () => `value || :newValue::jsonb`,
      })
      .where("key = :key", { key })
      .setParameter("newValue", JSON.stringify(partialValue))
      .execute();

    return !!result.affected && result.affected > 0;
  }

  async get<T = any>(key: string, expire?: number): Promise<T | null> {
    await this.ensureInitialized();
    const record = await this.db.findOne({ where: { key } });

    if (!record) return null;

    // 如果设置了过期时间，检查是否过期
    if (expire !== undefined) {
      const currentTime = Math.floor(Date.now() / 1000);
      const createdTime = Math.floor(record.created_at.getTime() / 1000);
      if (currentTime - createdTime > expire) {
        // 可选：删除过期数据
        await this.delete(key);
        return null;
      }
    }

    return record.value;
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
      value,
    });
  }

  async close(): Promise<void> {
    if (this.initialized && this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
      this.initialized = false;
    }
  }

  // 获取所有键值对
  async getAll(): Promise<Map<string, any>> {
    await this.ensureInitialized();
    const records = await this.db.find();
    return new Map(
      records.map((record: { key: any; value: any }) => [
        record.key,
        record.value,
      ])
    );
  }

  // 获取所有键
  async keys(): Promise<string[]> {
    await this.ensureInitialized();
    const records = await this.db.find({ select: ["key"] });
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
    batchSize: number = 1000
  ): Promise<void> {
    await this.ensureInitialized();

    // 分批处理大量数据
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const entities = batch.map(([key, value]) => ({
        key,
        value,
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
   * 查找布尔值记录
   * @param boolValue true 或 false
   * @param first 是否只返回第一条记录
   * @param orderBy 排序方式 'ASC' 或 'DESC'
   * @returns 如果 first 为 true 返回单个键或 null，否则返回键数组
   */
  async findBoolValues(
    boolValue: boolean,
    first: boolean = true,
    orderBy: "ASC" | "DESC" = "ASC"
  ): Promise<string[] | string | null> {
    await this.ensureInitialized();

    const queryBuilder = this.db
      .createQueryBuilder(this.tableName)
      .select([
        `${this.tableName}.key as "key"`,
        `${this.tableName}.value as "value"`,
      ])
      .where("value = :value::jsonb", {
        value: JSON.stringify(boolValue),
      })
      .orderBy("created_at", orderBy);

    if (first) {
      const result = await queryBuilder.getRawOne();
      return result ? result.key : null;
    }

    const results = await queryBuilder.getRawMany();
    return results;
  }

  /**
   * 高级 JSON 搜索
   * @param searchOptions 搜索选项
   */
  async searchJson(searchOptions: {
    contains?: object; // 包含的 JSON
    equals?: object; // 完全匹配的 JSON
    path?: string; // JSON 路径
    value?: any; // 路径对应的值
    take?: number;
  }): Promise<any[]> {
    await this.ensureInitialized();

    let queryBuilder = this.db
      .createQueryBuilder(this.tableName)
      .select([
        `${this.tableName}.key as "key"`,
        `${this.tableName}.value as "value"`,
      ]);

    if (searchOptions.contains) {
      queryBuilder = queryBuilder.andWhere(`value @> :contains::jsonb`, {
        contains: JSON.stringify(searchOptions.contains),
      });
    }

    if (searchOptions.equals) {
      queryBuilder = queryBuilder.andWhere(`value = :equals::jsonb`, {
        equals: JSON.stringify(searchOptions.equals),
      });
    }

    if (searchOptions.path && searchOptions.value !== undefined) {
      queryBuilder = queryBuilder.andWhere(`value #>> :path = :value`, {
        path: `{${searchOptions.path}}`,
        value: String(searchOptions.value),
      });
    }

    queryBuilder = queryBuilder.take(searchOptions.take || 100);

    const results = await queryBuilder.getRawMany();
    return results;
  }

  /**
   * 查找更新时间在指定时间前后的记录
   * @param timestamp 时间戳（毫秒）
   * @param type 'before' 或 'after'
   * @param first 是否只返回第一条记录
   * @param orderBy 排序方式
   */
  async findByUpdateTime(
    timestamp: number,
    first: boolean = true,
    type: "before" | "after" = "after",
    orderBy: "ASC" | "DESC" = "ASC"
  ): Promise<string[] | string | null> {
    await this.ensureInitialized();

    const operator = type === "before" ? "<" : ">";

    const query = this.db
      .createQueryBuilder(this.tableName)
      .select([
        `${this.tableName}.key as "key"`,
        `${this.tableName}.value as "value"`,
      ])
      .where(`updated_at ${operator} :timestamp`, {
        timestamp: new Date(timestamp),
      })
      .orderBy("updated_at", orderBy);

    if (first) {
      const result = await query.getRawOne();
      return result ? result.key : null;
    }

    const results = await query.getRawMany();
    return results;
  }

  async searchByTime(params: {
    timestamp: number;
    take?: number;
    type?: "before" | "after";
    orderBy?: "ASC" | "DESC";
    timeColumn?: "updated_at" | "created_at";
  }): Promise<Array<{ key: string; value: any }>> {
    await this.ensureInitialized();
    const timeColumn = params.timeColumn || "updated_at";
    let queryBuilder = this.db
      .createQueryBuilder()
      .select([
        `${this.tableName}.key as "key"`,
        `${this.tableName}.value as "value"`,
      ])
      .from(this.tableName, this.tableName);

    const operator = (params.type || "after") === "before" ? "<" : ">";
    queryBuilder.where(
      `${this.tableName}.${timeColumn} ${operator} :timestamp`,
      {
        timestamp: new Date(params.timestamp),
      }
    );

    queryBuilder.orderBy(
      `${this.tableName}.${timeColumn}`,
      params.orderBy || "ASC"
    );
    queryBuilder.limit(params.take || 1);
    try {
      const results = await queryBuilder.getRawMany();
      return results;
    } catch (error) {
      console.error("查询错误:", queryBuilder.getSql());
      console.error("查询参数:", queryBuilder.getParameters());
      throw error;
    }
  }

  /**
   * 优化后的 JSON 和时间复合搜索
   */
  async searchJsonByTime(
    searchOptions: {
      contains?: object;
      equals?: object;
      path?: string;
      value?: any;
    },
    timeOptions: {
      timestamp: number;
      take?: number;
      type?: "before" | "after";
      orderBy?: "ASC" | "DESC";
      timeColumn?: "updated_at" | "created_at";
    }
  ): Promise<Array<{ key: string; value: any }>> {
    await this.ensureInitialized();
    const timeColumn = timeOptions.timeColumn || "updated_at";
    let queryBuilder = this.db
      .createQueryBuilder()
      .select([
        `${this.tableName}.key as "key"`,
        `${this.tableName}.value as "value"`,
      ])
      .from(this.tableName, this.tableName);

    const operator = (timeOptions.type || "after") === "before" ? "<" : ">";
    queryBuilder.where(
      `${this.tableName}.${timeColumn} ${operator} :timestamp`,
      {
        timestamp: new Date(timeOptions.timestamp),
      }
    );

    if (searchOptions.contains) {
      queryBuilder.andWhere(`${this.tableName}.value @> :contains::jsonb`, {
        contains: JSON.stringify(searchOptions.contains),
      });
    }

    if (searchOptions.equals) {
      queryBuilder.andWhere(`${this.tableName}.value = :equals::jsonb`, {
        equals: JSON.stringify(searchOptions.equals),
      });
    }

    if (searchOptions.path && searchOptions.value !== undefined) {
      queryBuilder.andWhere(`${this.tableName}.value #>> :path = :value`, {
        path: `{${searchOptions.path}}`,
        value: String(searchOptions.value),
      });
    }

    queryBuilder
      .orderBy(`${this.tableName}.${timeColumn}`, timeOptions.orderBy || "ASC")
      .limit(timeOptions.take || 1);

    try {
      const results = await queryBuilder.getRawMany();
      return results;
    } catch (error) {
      console.error("Query error:", queryBuilder.getSql());
      console.error("Query parameters:", queryBuilder.getParameters());
      throw error;
    }
  }
}
