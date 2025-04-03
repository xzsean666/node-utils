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

export class KVDatabase {
  private db: Repository<KVEntity>;
  private dataSource: DataSource;
  private initialized = false;
  private tableName: string;
  private CustomKVStore: any;

  constructor(datasourceOrUrl: string, tableName: string = 'kv_store') {
    this.tableName = tableName;

    @Entity(tableName)
    class CustomKVStore implements KVEntity {
      @PrimaryColumn('varchar', { length: 255 })
      key: string;

      @Column('jsonb')
      value: any;

      @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
      created_at: Date;

      @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
      updated_at: Date;
    }

    this.CustomKVStore = CustomKVStore;

    this.dataSource = new DataSource({
      type: 'postgres',
      url: datasourceOrUrl,
      entities: [CustomKVStore],
      synchronize: false,
      extra: {
        max: 50,
        min: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 3000,
        statement_timeout: 15000,
        query_timeout: 15000,
        keepAlive: true,
        keepAliveInitialDelay: 10000,
        poolSize: 100,
        maxUses: 7500,
      },
      logging: ['error', 'warn'],
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
                  name: 'key',
                  type: 'varchar',
                  length: '255',
                  isPrimary: true,
                },
                {
                  name: 'value',
                  type: 'jsonb',
                  isNullable: true,
                },
                {
                  name: 'created_at',
                  type: 'timestamptz',
                  default: 'CURRENT_TIMESTAMP',
                },
                {
                  name: 'updated_at',
                  type: 'timestamptz',
                  default: 'CURRENT_TIMESTAMP',
                },
              ],
            }),
            true, // ifNotExists: true
          );

          // 创建 GIN 索引
          try {
            await queryRunner.query(
              `CREATE INDEX IF NOT EXISTS "IDX_${this.tableName}_value_gin" ON "${this.tableName}" USING gin (value);`,
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

  private async ensureJsonbDeepMergeFunction(): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    try {
      await queryRunner.query(`
        CREATE OR REPLACE FUNCTION jsonb_deep_merge(orig jsonb, delta jsonb)
        RETURNS jsonb LANGUAGE sql AS $$
          SELECT 
            jsonb_object_agg(
              COALESCE(k1, k2),
              CASE
                WHEN (v1 ? 'type' AND v1->>'type' = 'object') AND (v2 ? 'type' AND v2->>'type' = 'object')
                THEN jsonb_deep_merge(v1, v2)
                ELSE COALESCE(v2, v1)
              END
            )
          FROM jsonb_each(orig) e1(k1, v1)
          FULL OUTER JOIN jsonb_each(delta) e2(k2, v2) ON k1 = k2;
        $$;
      `);
    } finally {
      await queryRunner.release();
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

    const query = `
      INSERT INTO "${this.tableName}" (key, value, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (key) DO UPDATE
      SET value = CASE
        WHEN "${this.tableName}".value IS NULL THEN $2::jsonb
        ELSE "${this.tableName}".value || $2::jsonb
      END,
      updated_at = NOW()
      RETURNING value
    `;

    const result = await this.db.query(query, [
      key,
      JSON.stringify(partialValue),
    ]);

    return !!result?.length;
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
  async getValue(value: any): Promise<any> {
    await this.ensureInitialized();
    // Use proper JSONB comparison with query builder
    const existing = await this.db
      .createQueryBuilder()
      .where('value = :value::jsonb', { value: JSON.stringify(value) })
      .getOne();
    return existing;
  }
  async isValueExists(value: any): Promise<boolean> {
    await this.ensureInitialized();
    const existing = await this.db
      .createQueryBuilder()
      .where('value = :value::jsonb', { value: JSON.stringify(value) })
      .getOne();
    return !!existing;
  }
  async getValues(value: any): Promise<any> {
    await this.ensureInitialized();
    // Use proper JSONB comparison with query builder
    const existing = await this.db
      .createQueryBuilder()
      .where('value = :value::jsonb', { value: JSON.stringify(value) })
      .getMany();
    return existing;
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
  async addUniquePair(key: string, value: any): Promise<void> {
    await this.ensureInitialized();

    // Use a proper JSONB comparison query
    const existing = await this.db
      .createQueryBuilder()
      .where('key = :key', { key })
      .andWhere('value = :value::jsonb', { value: JSON.stringify(value) })
      .getOne();

    if (existing) {
      throw new Error(`Key-value pair already exists for key "${key}"`);
    }

    await this.db.save({
      key,
      value,
    });
  }
  async addUniqueValue(key: string, value: any): Promise<void> {
    await this.ensureInitialized();

    // Use proper JSONB comparison with query builder
    const existing = await this.db
      .createQueryBuilder()
      .where('value = :value::jsonb', { value: JSON.stringify(value) })
      .getOne();

    if (existing) {
      const existingKey = existing.key;
      throw new Error(`Value already exists with key "${existingKey}"`);
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

  // 获取所有键值对，支持分页
  async getAll(offset?: number, limit?: number): Promise<Map<string, any>> {
    await this.ensureInitialized();
    const options: any = {};

    if (typeof offset === 'number') {
      options.offset = offset;
    }

    if (typeof limit === 'number') {
      options.limit = limit;
    }

    const records = await this.db.find(options);
    return new Map(
      records.map((record: { key: any; value: any }) => [
        record.key,
        record.value,
      ]),
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

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 使用 VALUES 语法构建批量插入语句
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        const values = batch
          .map(
            ([key, value]) =>
              `('${key}', '${JSON.stringify(value)}', NOW(), NOW())`,
          )
          .join(',');

        await queryRunner.query(`
          INSERT INTO "${this.tableName}" (key, value, created_at, updated_at)
          VALUES ${values}
          ON CONFLICT (key) 
          DO UPDATE SET 
            value = EXCLUDED.value,
            updated_at = EXCLUDED.updated_at
        `);
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
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
    orderBy: 'ASC' | 'DESC' = 'ASC',
  ): Promise<string[] | string | null> {
    await this.ensureInitialized();

    const queryBuilder = this.db
      .createQueryBuilder(this.tableName)
      .select([
        `${this.tableName}.key as "key"`,
        `${this.tableName}.value as "value"`,
      ])
      .where('value = :value::jsonb', {
        value: JSON.stringify(boolValue),
      })
      .orderBy('created_at', orderBy);

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
    contains?: object;
    limit?: number;
    cursor?: string;
    compare?: Array<{
      path: string;
      operator: '>' | '<' | '>=' | '<=' | '=' | '!=';
      value: number | string | Date;
    }>;
  }): Promise<{
    data: any[];
    nextCursor: string | null;
  }> {
    await this.ensureInitialized();

    const limit = searchOptions.limit || 100;

    const queryBuilder = this.db
      .createQueryBuilder(this.tableName)
      .select([
        `${this.tableName}.key as "key"`,
        `${this.tableName}.value as "value"`,
        `${this.tableName}.created_at as "created_at"`,
        `${this.tableName}.updated_at as "updated_at"`,
      ])
      .take(limit + 1);

    if (searchOptions.contains) {
      const containsJson = JSON.stringify(searchOptions.contains);
      if (Object.keys(searchOptions.contains).length === 1) {
        const [key, value] = Object.entries(searchOptions.contains)[0];
        queryBuilder.andWhere(`value->:key = :value::jsonb`, {
          key,
          value: JSON.stringify(value),
        });
      } else {
        queryBuilder.andWhere(`value @> :contains::jsonb`, {
          contains: containsJson,
        });
      }
    }

    // 添加比较操作的支持
    if (searchOptions.compare) {
      searchOptions.compare.forEach((condition, index) => {
        const paramKey = `value${index}`;
        const jsonPath = `{${condition.path}}`;

        // 处理日期类型
        let compareValue = condition.value;
        if (condition.value instanceof Date) {
          compareValue = condition.value.toISOString();
        }

        // 使用 #>> 操作符提取 JSON 路径的值，然后进行比较
        // 对于数字类型，使用 (value #>> :path)::numeric 进行转换
        // 对于日期类型，使用 (value #>> :path)::timestamp 进行转换
        const isNumeric = typeof compareValue === 'number';
        const isDate = condition.value instanceof Date;

        const castType = isNumeric ? 'numeric' : isDate ? 'timestamp' : 'text';
        queryBuilder.andWhere(
          `(${this.tableName}.value #>> :path${index})::${castType} ${condition.operator} :${paramKey}`,
          {
            [`path${index}`]: jsonPath,
            [paramKey]: compareValue,
          },
        );
      });
    }

    if (searchOptions.cursor) {
      queryBuilder
        .andWhere(`${this.tableName}.key > :cursor`, {
          cursor: searchOptions.cursor,
        })
        .orderBy(`${this.tableName}.key`, 'ASC')
        .useIndex(`${this.tableName}_pkey`);
    }

    try {
      const results = await queryBuilder.getMany();

      const hasMore = results.length > limit;
      const data = results.slice(0, limit);
      const nextCursor = hasMore ? data[data.length - 1].key : null;

      return {
        data,
        nextCursor,
      };
    } catch (error) {
      console.error('Query error:', queryBuilder.getSql());
      console.error('Query parameters:', queryBuilder.getParameters());
      throw error;
    }
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
    type: 'before' | 'after' = 'after',
    orderBy: 'ASC' | 'DESC' = 'ASC',
  ): Promise<string[] | string | null> {
    await this.ensureInitialized();

    const operator = type === 'before' ? '<' : '>';

    const query = this.db
      .createQueryBuilder(this.tableName)
      .select([
        `${this.tableName}.key as "key"`,
        `${this.tableName}.value as "value"`,
      ])
      .where(`updated_at ${operator} :timestamp`, {
        timestamp: new Date(timestamp),
      })
      .orderBy('updated_at', orderBy);

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
    type?: 'before' | 'after';
    orderBy?: 'ASC' | 'DESC';
    timeColumn?: 'updated_at' | 'created_at';
  }): Promise<Array<{ key: string; value: any }>> {
    await this.ensureInitialized();
    const timeColumn = params.timeColumn || 'updated_at';
    const queryBuilder = this.db
      .createQueryBuilder()
      .select([
        `${this.tableName}.key as "key"`,
        `${this.tableName}.value as "value"`,
      ])
      .from(this.tableName, this.tableName);

    const operator = (params.type || 'after') === 'before' ? '<' : '>';
    queryBuilder.where(
      `${this.tableName}.${timeColumn} ${operator} :timestamp`,
      {
        timestamp: new Date(params.timestamp),
      },
    );

    queryBuilder.orderBy(
      `${this.tableName}.${timeColumn}`,
      params.orderBy || 'ASC',
    );
    queryBuilder.limit(params.take || 1);
    try {
      const results = await queryBuilder.getRawMany();
      return results;
    } catch (error) {
      console.error('查询错误:', queryBuilder.getSql());
      console.error('查询参数:', queryBuilder.getParameters());
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
      type?: 'before' | 'after';
      orderBy?: 'ASC' | 'DESC';
      timeColumn?: 'updated_at' | 'created_at';
    },
  ): Promise<Array<{ key: string; value: any }>> {
    await this.ensureInitialized();
    const timeColumn = timeOptions.timeColumn || 'updated_at';
    const queryBuilder = this.db
      .createQueryBuilder()
      .select([
        `${this.tableName}.key as "key"`,
        `${this.tableName}.value as "value"`,
      ])
      .from(this.tableName, this.tableName);

    const operator = (timeOptions.type || 'after') === 'before' ? '<' : '>';
    queryBuilder.where(
      `${this.tableName}.${timeColumn} ${operator} :timestamp`,
      {
        timestamp: new Date(timeOptions.timestamp),
      },
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
      .orderBy(`${this.tableName}.${timeColumn}`, timeOptions.orderBy || 'ASC')
      .limit(timeOptions.take || 1);

    try {
      const results = await queryBuilder.getRawMany();
      return results;
    } catch (error) {
      console.error('Query error:', queryBuilder.getSql());
      console.error('Query parameters:', queryBuilder.getParameters());
      throw error;
    }
  }

  /**
   * Saves an array by splitting it into batches
   * If the key already exists, appends the new items to the existing array
   * @param key The base key for the array
   * @param array The array to save
   * @param batchSize Maximum items per batch (default: 1000)
   * @param forceUpdateBatchSize If true, will update the batch size even if already initialized
   */
  async saveArray(
    key: string,
    array: any[],
    batchSize: number = 1000,
    forceUpdateBatchSize: boolean = false,
  ): Promise<void> {
    await this.ensureInitialized();

    // Cache key construction to avoid string concatenation in loops
    const metaKey = `${key}_meta`;
    const existingMeta = await this.get(metaKey);

    // If key exists, append the new items to existing array
    if (existingMeta && existingMeta.batchCount > 0) {
      const existingBatchCount = existingMeta.batchCount;
      const existingTotalItems = existingMeta.totalItems;

      // Get stored batch size or use default if not found (for backward compatibility)
      const storedBatchSize = existingMeta.batchSize || batchSize;

      // Determine which batch size to use
      let activeBatchSize = storedBatchSize;

      // Handle batch size change if requested
      if (forceUpdateBatchSize && batchSize !== storedBatchSize) {
        console.log(
          `Updating batch size from ${storedBatchSize} to ${batchSize}`,
        );
        activeBatchSize = batchSize;

        // We need to rebalance all batches if the batch size changes
        // This will require a full rebuild - we'll need to get all data,
        // rebatch it, and save it back with the new batch size
        if (existingTotalItems > 0) {
          // Get all existing data
          const allData = await this.getAllArray(key);

          // Delete all existing batch records and metadata
          const keysToDelete = [metaKey];
          for (let i = 0; i < existingBatchCount; i++) {
            keysToDelete.push(`${key}_${i}`);
          }
          await this.deleteMany(keysToDelete);

          // Prepend existing data to the new data being saved
          array = [...allData, ...array];

          // Continue to the "else" branch which will create a new array
          // with the new batch size
          return this.saveArray(key, array, batchSize);
        }
      } else if (batchSize !== storedBatchSize) {
        console.warn(
          `Warning: Provided batchSize (${batchSize}) differs from originally stored batchSize (${storedBatchSize}). Using stored value. Set forceUpdateBatchSize=true to change batch size.`,
        );
      }

      // Use the determined batch size
      batchSize = activeBatchSize;

      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        // Get the last batch which might not be full
        const lastBatchKey = `${key}_${existingBatchCount - 1}`;
        const lastBatch = (await this.get(lastBatchKey)) || [];

        // Calculate how many more items can fit in the last batch
        const remainingSpace = batchSize - lastBatch.length;

        // Prepare all statements before execution for better performance
        const statements: string[] = [];
        const parameters: any[][] = [];

        // Items to add to the last batch
        const itemsForLastBatch =
          remainingSpace > 0 ? array.slice(0, remainingSpace) : [];
        // Items for new batches
        const remainingItems =
          remainingSpace > 0 ? array.slice(remainingSpace) : array;

        // Update the last batch if needed
        if (itemsForLastBatch.length > 0) {
          const updatedLastBatch = [...lastBatch, ...itemsForLastBatch];
          statements.push(`
            UPDATE "${this.tableName}" 
            SET value = $1, updated_at = NOW()
            WHERE key = $2
          `);
          parameters.push([JSON.stringify(updatedLastBatch), lastBatchKey]);
        }

        // Create new batches for remaining items
        let newBatchesCount = 0;

        // Build bulk insert if possible instead of individual inserts
        if (remainingItems.length > 0) {
          const bulkValues: string[] = [];
          const bulkParams: any[] = [];
          let paramIndex = 1;

          for (let i = 0; i < remainingItems.length; i += batchSize) {
            const batchData = remainingItems.slice(i, i + batchSize);
            const batchKey = `${key}_${existingBatchCount + newBatchesCount}`;

            bulkValues.push(
              `($${paramIndex}, $${paramIndex + 1}, NOW(), NOW())`,
            );
            bulkParams.push(batchKey, JSON.stringify(batchData));
            paramIndex += 2;
            newBatchesCount++;
          }

          if (bulkValues.length > 0) {
            statements.push(`
              INSERT INTO "${
                this.tableName
              }" (key, value, created_at, updated_at)
              VALUES ${bulkValues.join(',')}
            `);
            parameters.push(bulkParams);
          }
        }

        // Update metadata
        const newTotalItems = existingTotalItems + array.length;
        const newBatchCount = existingBatchCount + newBatchesCount;

        const updatedMeta = {
          batchCount: newBatchCount,
          totalItems: newTotalItems,
          batchSize: batchSize, // Store batch size in metadata
          lastUpdated: new Date().toISOString(),
        };

        statements.push(`
          UPDATE "${this.tableName}" 
          SET value = $1, updated_at = NOW()
          WHERE key = $2
        `);
        parameters.push([JSON.stringify(updatedMeta), metaKey]);

        // Execute all prepared statements
        for (let i = 0; i < statements.length; i++) {
          await queryRunner.query(statements[i], parameters[i]);
        }

        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
    }
    // Key doesn't exist, create new array storage
    else {
      // Calculate batch count
      const batchCount = Math.ceil(array.length / batchSize);

      // Create metadata record
      const metaValue = {
        batchCount,
        totalItems: array.length,
        batchSize: batchSize, // Store batch size in metadata
        lastUpdated: new Date().toISOString(),
      };

      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        // Prepare bulk insert using parameterized queries instead of string concatenation
        const bulkParams: any[] = [];
        const placeholders: string[] = [];
        let paramIndex = 1;

        // Add metadata entry
        placeholders.push(`($${paramIndex}, $${paramIndex + 1}, NOW(), NOW())`);
        bulkParams.push(metaKey, JSON.stringify(metaValue));
        paramIndex += 2;

        // Add batch entries
        for (let i = 0; i < batchCount; i++) {
          const start = i * batchSize;
          const end = Math.min(start + batchSize, array.length);
          const batchData = array.slice(start, end);
          const batchKey = `${key}_${i}`;

          placeholders.push(
            `($${paramIndex}, $${paramIndex + 1}, NOW(), NOW())`,
          );
          bulkParams.push(batchKey, JSON.stringify(batchData));
          paramIndex += 2;
        }

        // Single query for all inserts
        await queryRunner.query(
          `
          INSERT INTO "${this.tableName}" (key, value, created_at, updated_at)
          VALUES ${placeholders.join(',')}
        `,
          bulkParams,
        );

        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
    }
  }

  /**
   * Retrieves all batches of a saved array and combines them
   * @param key The base key for the array
   * @returns The complete array
   */
  async getAllArray<T = any>(key: string): Promise<T[]> {
    await this.ensureInitialized();

    // Get metadata
    const metaKey = `${key}_meta`;
    const meta = await this.get(metaKey);

    if (!meta || !meta.batchCount) {
      return [];
    }

    // Optimize by fetching multiple batches in a single query
    const batchKeys = Array.from(
      { length: meta.batchCount },
      (_, i) => `${key}_${i}`,
    );

    // Use IN clause to fetch all batches at once
    const records = await this.db.find({
      where: { key: In(batchKeys) },
      order: { key: 'ASC' },
    });

    // Map results to a map for faster lookup
    const batchMap = new Map(
      records.map((record) => [record.key, record.value]),
    );

    // Combine all batches in order
    const allData: T[] = [];
    for (let i = 0; i < meta.batchCount; i++) {
      const batchKey = `${key}_${i}`;
      const batch = batchMap.get(batchKey) || [];
      allData.push(...batch);
    }

    return allData;
  }

  /**
   * Retrieves the most recent items from a saved array
   * @param key The base key for the array
   * @param count Number of recent items to retrieve
   * @returns The most recent items from the array
   */
  async getRecentArray<T = any>(key: string, count: number): Promise<T[]> {
    await this.ensureInitialized();

    // Get metadata
    const metaKey = `${key}_meta`;
    const meta = await this.get(metaKey);

    if (!meta || !meta.batchCount || count <= 0) {
      return [];
    }

    // If count is greater than total items, return all items
    if (count >= meta.totalItems) {
      return this.getAllArray<T>(key);
    }

    // Get batch size from metadata or use default for backward compatibility
    const batchSize = meta.batchSize || 1000;

    // Calculate which batches we need
    let itemsNeeded = count;
    let startBatch = meta.batchCount - 1;

    // Calculate how many batches we need to fetch from the end
    const neededBatches: string[] = [];
    while (itemsNeeded > 0 && startBatch >= 0) {
      neededBatches.push(`${key}_${startBatch}`);
      itemsNeeded -=
        startBatch === meta.batchCount - 1
          ? meta.totalItems % batchSize || batchSize
          : batchSize;
      startBatch--;
    }

    // Fetch all needed batches in a single query
    const records = await this.db.find({
      where: { key: In(neededBatches) },
      order: { key: 'DESC' },
    });

    // Process results
    const recentItems: T[] = [];
    let remainingCount = count;

    for (const record of records) {
      const batch = record.value || [];

      if (batch.length <= remainingCount) {
        recentItems.unshift(...batch);
        remainingCount -= batch.length;
      } else {
        const startIndex = batch.length - remainingCount;
        const recentFromBatch = batch.slice(startIndex);
        recentItems.unshift(...recentFromBatch);
        remainingCount = 0;
      }

      if (remainingCount <= 0) break;
    }

    return recentItems;
  }

  /**
   * Retrieves items from a saved array based on index range
   * @param key The base key for the array
   * @param startIndex The starting index (inclusive)
   * @param endIndex The ending index (exclusive)
   * @returns The items in the specified range
   */
  async getArrayRange<T = any>(
    key: string,
    startIndex: number,
    endIndex: number,
  ): Promise<T[]> {
    await this.ensureInitialized();

    // Validate inputs
    if (startIndex < 0 || endIndex <= startIndex) {
      return [];
    }

    // Get metadata
    const metaKey = `${key}_meta`;
    const meta = await this.get(metaKey);

    if (!meta || !meta.batchCount) {
      return [];
    }

    // Adjust end index if it exceeds total items
    endIndex = Math.min(endIndex, meta.totalItems);

    if (startIndex >= meta.totalItems) {
      return [];
    }

    // Get batch size from metadata or use default for backward compatibility
    const batchSize = meta.batchSize || 1000; // Use stored batch size instead of hardcoded value

    // Calculate which batches we need
    const startBatch = Math.floor(startIndex / batchSize);
    const endBatch = Math.floor((endIndex - 1) / batchSize);

    // Create a list of needed batch keys
    const batchKeys = Array.from(
      { length: endBatch - startBatch + 1 },
      (_, i) => `${key}_${startBatch + i}`,
    );

    // Fetch all needed batches in a single query
    const records = await this.db.find({
      where: { key: In(batchKeys) },
      order: { key: 'ASC' },
    });

    // Map results to a map for faster lookup
    const batchMap = new Map(
      records.map((record) => [record.key, record.value]),
    );

    // Process results
    const result: T[] = [];
    for (let i = startBatch; i <= endBatch; i++) {
      const batchKey = `${key}_${i}`;
      const batch = batchMap.get(batchKey) || [];

      // Calculate start and end positions within this batch
      const batchStartIndex = i * batchSize;
      const localStartIndex = Math.max(0, startIndex - batchStartIndex);
      const localEndIndex = Math.min(batch.length, endIndex - batchStartIndex);

      // Add the relevant portion of this batch to our result
      if (localStartIndex < localEndIndex) {
        result.push(...batch.slice(localStartIndex, localEndIndex));
      }
    }

    return result;
  }

  /**
   * 获取指定数量的随机记录
   * @param count 需要获取的随机记录数量
   * @returns 随机记录数组
   */
  async getRandomData(
    count: number = 1,
  ): Promise<Array<{ key: string; value: any }>> {
    await this.ensureInitialized();

    // 使用 ORDER BY RANDOM() 获取随机记录
    const results = await this.db
      .createQueryBuilder(this.tableName)
      .select([
        `${this.tableName}.key as "key"`,
        `${this.tableName}.value as "value"`,
      ])
      .orderBy('RANDOM()')
      .limit(count)
      .getRawMany();

    return results;
  }
}
