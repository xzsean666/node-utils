import {
  DataSource,
  EntityTarget,
  Repository,
  FindOptionsWhere,
  FindManyOptions,
  ObjectLiteral,
  DeepPartial,
} from "typeorm";
import "reflect-metadata";

export class PostgresqlDbHelper<T extends ObjectLiteral> {
  private repository: Repository<T>;
  private dataSource: DataSource;
  private entityClass: EntityTarget<T>;
  private dbUrl: string;
  private initialized: boolean = false;

  /**
   * 创建一个通用的PostgreSQL数据库助手
   * @param entityClass 当前操作的实体类
   * @param dbUrl 数据库连接URL
   */
  constructor(
    entityClass: EntityTarget<T>,
    dbUrl: string = "postgres://postgres:postgres@localhost:5432/postgres"
  ) {
    this.entityClass = entityClass;
    this.dbUrl = dbUrl;
    this.initialize();
  }

  /**
   * 初始化数据库连接和仓库
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    // 创建数据源
    this.dataSource = new DataSource({
      type: "postgres",
      url: this.dbUrl,
      entities: [this.entityClass] as any,
      synchronize: process.env.NODE_ENV !== "production", // 生产环境中需谨慎使用
      logging: false,
    });

    // 初始化连接
    if (!this.dataSource.isInitialized) {
      await this.dataSource.initialize();
      console.log("数据库连接已成功建立");
    }

    // 获取仓库
    this.repository = this.dataSource.getRepository(this.entityClass);
    this.initialized = true;
  }

  /**
   * 确保已初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * 创建一个新实体
   * @param entityData 实体数据
   * @returns 创建的实体
   */
  public async put(entityData: DeepPartial<T>): Promise<T> {
    await this.ensureInitialized();
    const entity = this.repository.create(entityData);
    return await this.repository.save(entity as T);
  }

  /**
   * 通过ID查找实体
   * @param id 实体ID
   * @returns 找到的实体或null
   */
  public async getById(id: number | string): Promise<T | null> {
    await this.ensureInitialized();
    return await this.repository.findOneBy({
      id,
    } as unknown as FindOptionsWhere<T>);
  }

  /**
   * 通过条件查找单个实体
   * @param where 查询条件
   * @returns 找到的实体或null
   */
  public async getOne(where: FindOptionsWhere<T>): Promise<T | null> {
    await this.ensureInitialized();
    return await this.repository.findOneBy(where);
  }

  /**
   * 通过条件查找多个实体
   * @param options 查询选项
   * @returns 实体数组
   */
  public async get(options?: FindManyOptions<T>): Promise<T[]> {
    await this.ensureInitialized();
    return await this.repository.find(options);
  }
  /**
   * 通过条件更新实体
   * @param where 查询条件
   * @param partialEntity 要更新的实体部分数据
   * @returns 更新操作结果
   */
  public async updateById(
    id: number | string,
    partialEntity: DeepPartial<T>
  ): Promise<boolean> {
    await this.ensureInitialized();
    const result = await this.repository.update(id, partialEntity as any);
    return result.affected ? result.affected > 0 : false;
  }

  /**
   * 通过条件更新实体
   * @param where 查询条件
   * @param partialEntity 要更新的实体部分数据
   * @returns 更新操作结果
   */
  public async update(
    where: FindOptionsWhere<T>,
    partialEntity: DeepPartial<T>
  ): Promise<boolean> {
    await this.ensureInitialized();
    const result = await this.repository.update(where, partialEntity as any);
    return result.affected ? result.affected > 0 : false;
  }

  /**
   * 删除实体
   * @param id 实体ID
   * @returns 删除操作结果
   */
  public async delete(id: number | string): Promise<boolean> {
    await this.ensureInitialized();
    const result = await this.repository.delete(id);
    return result.affected ? result.affected > 0 : false;
  }

  /**
   * 计数
   * @param where 查询条件
   * @returns 符合条件的实体数量
   */
  public async count(where?: FindOptionsWhere<T>): Promise<number> {
    await this.ensureInitialized();
    return await this.repository.count({ where } as any);
  }

  /**
   * 批量保存实体
   * @param entities 实体数组
   * @returns 保存的实体数组
   */
  public async saveMany(entities: DeepPartial<T>[]): Promise<T[]> {
    await this.ensureInitialized();
    const createdEntities = entities.map((entity) =>
      this.repository.create(entity)
    );
    return await this.repository.save(createdEntities as T[]);
  }

  /**
   * 自定义查询
   * @param query SQL查询字符串
   * @param parameters 查询参数
   * @returns 查询结果
   */
  public async executeCustomQuery(
    query: string,
    parameters?: any[]
  ): Promise<any> {
    await this.ensureInitialized();
    return await this.dataSource.query(query, parameters);
  }

  /**
   * 获取原始仓库实例
   * 可用于执行更复杂的操作
   */
  public async getRepository(): Promise<Repository<T>> {
    await this.ensureInitialized();
    return this.repository;
  }

  /**
   * 获取数据源实例
   */
  public async getDataSource(): Promise<DataSource> {
    await this.ensureInitialized();
    return this.dataSource;
  }

  /**
   * 关闭数据库连接
   */
  public async close(): Promise<void> {
    if (this.dataSource && this.dataSource.isInitialized) {
      await this.dataSource.destroy();
      this.initialized = false;
      console.log("数据库连接已关闭");
    }
  }
}
