import { DataSource, Repository, Table } from "typeorm";
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

  constructor(dbPath: string, tableName: string = "kv_store") {
    this.tableName = tableName;

    @Entity(tableName)
    class CustomKVStore implements KVEntity {
      @PrimaryColumn("varchar", { length: 255 })
      key: string;

      // SQLite不支持jsonb，使用text存储JSON字符串
      @Column("text", {
        transformer: {
          to: (value: any) => JSON.stringify(value),
          from: (value: string) => JSON.parse(value),
        },
      })
      value: any;

      @CreateDateColumn({ type: "datetime", name: "created_at" })
      created_at: Date;

      @UpdateDateColumn({ type: "datetime", name: "updated_at" })
      updated_at: Date;
    }

    this.CustomKVStore = CustomKVStore;

    this.dataSource = new DataSource({
      type: "sqlite",
      database: dbPath,
      entities: [CustomKVStore],
      synchronize: false,
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.dataSource.initialize();
      this.db = this.dataSource.getRepository(this.CustomKVStore);

      if (!this.dataSource.options.synchronize) {
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
                    type: "text",
                  },
                  {
                    name: "created_at",
                    type: "datetime",
                    default: "CURRENT_TIMESTAMP",
                  },
                  {
                    name: "updated_at",
                    type: "datetime",
                    default: "CURRENT_TIMESTAMP",
                  },
                ],
              })
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
      value,
    });
  }

  async get<T = any>(key: string): Promise<T | null> {
    await this.ensureInitialized();
    const record = await this.db.findOne({ where: { key } });
    return record ? record.value : null;
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureInitialized();
    const result = await this.db.delete({ key });
    return !!result.affected && result.affected > 0;
  }

  async has(key: string): Promise<boolean> {
    await this.ensureInitialized();
    return (await this.db.count({ where: { key } })) > 0;
  }

  async getAll(): Promise<Map<string, any>> {
    await this.ensureInitialized();
    const records = await this.db.find();
    return new Map(records.map((record) => [record.key, record.value]));
  }

  async keys(): Promise<string[]> {
    await this.ensureInitialized();
    const records = await this.db.find({ select: ["key"] });
    return records.map((record) => record.key);
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    await this.db.clear();
  }

  async close(): Promise<void> {
    if (this.initialized && this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
      this.initialized = false;
    }
  }

  async findByValue(value: any, exact: boolean = true): Promise<string[]> {
    await this.ensureInitialized();
    let queryBuilder = this.db.createQueryBuilder(this.tableName);

    if (exact) {
      // SQLite的JSON比较
      queryBuilder = queryBuilder.where(`json(value) = json(:value)`, {
        value: JSON.stringify(value),
      });
    } else {
      // SQLite的模糊匹配
      const searchValue =
        typeof value === "string" ? value : JSON.stringify(value);
      queryBuilder = queryBuilder.where(`value LIKE :value`, {
        value: `%${searchValue}%`,
      });
    }

    const results = await queryBuilder.getMany();
    return results.map((record: { key: any }) => record.key);
  }
}
