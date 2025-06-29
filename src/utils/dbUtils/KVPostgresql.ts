import { DataSource, Repository, Table, In } from 'typeorm';
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

// 添加值类型定义
export type ValueType =
  | 'jsonb'
  | 'varchar'
  | 'text'
  | 'integer'
  | 'boolean'
  | 'float'
  | 'bytea'; // 添加 bytea 类型用于二进制数据

// 添加接口定义
interface KVEntity {
  key: string;
  value: any;
  created_at: Date;
  updated_at: Date;
}

interface SaveArrayOptions {
  batchSize?: number;
  forceUpdateBatchSize?: boolean;
  overwrite?: boolean;
}

/**
 * PostgreSQL Key-Value 数据库类，支持多种值类型
 *
 * 使用示例：
 *
 * // JSONB 类型 - 支持所有高级功能
 * const jsonbDB = new PGKVDatabase('postgresql://...', 'json_store', 'jsonb');
 * await jsonbDB.put('user:1', { name: 'John', age: 30 });
 * await jsonbDB.merge('user:1', { email: 'john@example.com' });
 *
 * // 高级搜索功能示例
 * // 精确匹配搜索
 * await jsonbDB.searchJson({ contains: { name: 'John' } });
 *
 * // 文本包含搜索（推荐用于搜索功能）
 * await jsonbDB.searchJson({
 *   textSearch: [
 *     { path: 'english_only', text: 'legal document', caseSensitive: false }
 *   ],
 *   includeTimestamps: true
 * });
 *
 * // 混合搜索条件
 * await jsonbDB.searchJson({
 *   contains: { status: 'active' },
 *   textSearch: [{ path: 'content', text: 'search term', caseSensitive: false }],
 *   compare: [{ path: 'priority', operator: '>=', value: 5 }],
 *   limit: 20
 * });
 *
 * // VARCHAR 类型 - 基本字符串操作
 * const stringDB = new PGKVDatabase('postgresql://...', 'string_store', 'varchar');
 * await stringDB.put('name:1', 'John Doe');
 *
 * // INTEGER 类型 - 数值操作
 * const intDB = new PGKVDatabase('postgresql://...', 'int_store', 'integer');
 * await intDB.put('count:1', 42);
 *
 * // BOOLEAN 类型 - 布尔值操作
 * const boolDB = new PGKVDatabase('postgresql://...', 'bool_store', 'boolean');
 * await boolDB.put('active:1', true);
 * await boolDB.findBoolValues(true);
 *
 * // BYTEA 类型 - 二进制数据操作
 * const blobDB = new PGKVDatabase('postgresql://...', 'blob_store', 'bytea');
 * await blobDB.put('file:1', Buffer.from('binary data'));
 *
 * // 新增：时间戳功能使用示例
 *
 * // 1. 获取单个值时包含时间戳
 * const resultWithTimestamp = await jsonbDB.get('user:1', { includeTimestamps: true });
 * // 返回: { value: { name: 'John', age: 30 }, created_at: Date, updated_at: Date }
 *
 * // 2. 兼容旧的 expire 参数
 * const result = await jsonbDB.get('user:1', 3600); // 3600秒过期时间
 *
 * // 3. 同时使用过期时间和时间戳选项
 * const resultFull = await jsonbDB.get('user:1', {
 *   expire: 3600,
 *   includeTimestamps: true
 * });
 *
 * // 4. 前缀查询时包含时间戳
 * const usersWithTimestamp = await jsonbDB.getWithPrefix('user:', {
 *   includeTimestamps: true,
 *   limit: 10
 * });
 * // 返回: [{ key: 'user:1', value: {...}, created_at: Date, updated_at: Date }]
 *
 * // 5. 包含查询时包含时间戳
 * const containsResults = await jsonbDB.getWithContains('user', {
 *   includeTimestamps: true,
 *   limit: 5
 * });
 *
 * // 6. 后缀查询时包含时间戳
 * const suffixResults = await jsonbDB.getWithSuffix(':1', {
 *   includeTimestamps: true
 * });
 *
 * // 7. 批量获取时包含时间戳
 * const manyResults = await jsonbDB.getMany(['user:1', 'user:2'], {
 *   includeTimestamps: true
 * });
 *
 * // 8. 随机数据时包含时间戳
 * const randomResults = await jsonbDB.getRandomData(3, {
 *   includeTimestamps: true
 * });
 *
 * // 9. 时间搜索时包含时间戳
 * const timeResults = await jsonbDB.searchByTime({
 *   timestamp: Date.now() - 24 * 60 * 60 * 1000, // 24小时前
 *   type: 'after',
 *   includeTimestamps: true,
 *   take: 10
 * });
 *
 * // 10. JSON和时间复合搜索时包含时间戳 (仅JSONB类型)
 * const jsonTimeResults = await jsonbDB.searchJsonByTime(
 *   { contains: { status: 'active' } },
 *   {
 *     timestamp: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7天前
 *     type: 'after',
 *     includeTimestamps: true,
 *     take: 20
 *   }
 * );
 */
export class PGKVDatabase {
  db: Repository<KVEntity>;
  private dataSource: DataSource;
  private initialized = false;
  private tableName: string;
  private valueType: ValueType;
  private CustomKVStore: any;

  constructor(
    datasourceOrUrl: string,
    tableName: string = 'kv_store',
    valueType: ValueType = 'jsonb',
  ) {
    this.tableName = tableName;
    this.valueType = valueType;

    @Entity(tableName)
    class CustomKVStore implements KVEntity {
      @PrimaryColumn('varchar', { length: 255 })
      key: string;

      @Column(this.getColumnType(valueType))
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

  /**
   * 根据值类型获取 TypeORM 列类型配置
   */
  private getColumnType(valueType: ValueType): any {
    switch (valueType) {
      case 'jsonb':
        return 'jsonb';
      case 'varchar':
        return { type: 'varchar', length: 255 };
      case 'text':
        return 'text';
      case 'integer':
        return 'integer';
      case 'boolean':
        return 'boolean';
      case 'float':
        return 'float';
      case 'bytea':
        return 'bytea';
      default:
        return 'jsonb';
    }
  }

  /**
   * 根据值类型获取 PostgreSQL 列定义
   */
  private getPostgreSQLColumnType(valueType: ValueType): string {
    switch (valueType) {
      case 'jsonb':
        return 'jsonb';
      case 'varchar':
        return 'varchar(255)';
      case 'text':
        return 'text';
      case 'integer':
        return 'integer';
      case 'boolean':
        return 'boolean';
      case 'float':
        return 'float';
      case 'bytea':
        return 'bytea';
      default:
        return 'jsonb';
    }
  }

  /**
   * 检查当前操作是否支持指定的值类型
   */
  private checkTypeSupport(
    operation: string,
    supportedTypes: ValueType[],
  ): void {
    if (!supportedTypes.includes(this.valueType)) {
      throw new Error(
        `Operation '${operation}' is not supported for value type '${
          this.valueType
        }'. Supported types: ${supportedTypes.join(', ')}`,
      );
    }
  }

  /**
   * 根据值类型处理值的序列化
   */
  private serializeValue(value: any): any {
    if (this.valueType === 'jsonb') {
      return value; // TypeORM 会自动处理 JSONB
    } else if (this.valueType === 'bytea') {
      // 确保二进制数据是 Buffer 类型
      if (Buffer.isBuffer(value)) {
        return value;
      } else if (typeof value === 'string') {
        // 如果是字符串，转换为 Buffer
        return Buffer.from(value, 'utf8');
      } else if (value instanceof Uint8Array) {
        // 如果是 Uint8Array，转换为 Buffer
        return Buffer.from(value);
      } else {
        // 其他类型尝试 JSON 序列化后转为 Buffer
        return Buffer.from(JSON.stringify(value), 'utf8');
      }
    }
    return value;
  }

  /**
   * 根据值类型处理值的反序列化
   */
  private deserializeValue(value: any): any {
    if (this.valueType === 'bytea' && Buffer.isBuffer(value)) {
      return value; // 保持 Buffer 类型
    }
    return value; // TypeORM 会自动处理类型转换
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
                  type: this.getPostgreSQLColumnType(this.valueType),
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

          // 只为 JSONB 类型创建 GIN 索引
          if (this.valueType === 'jsonb') {
            try {
              await queryRunner.query(
                `CREATE INDEX IF NOT EXISTS "IDX_${this.tableName}_value_gin" ON "${this.tableName}" USING gin (value);`,
              );
            } catch (err) {
              console.warn(`创建索引失败，可能已存在: ${err}`);
            }
          } else {
            // 为其他类型创建 B-tree 索引
            try {
              await queryRunner.query(
                `CREATE INDEX IF NOT EXISTS "IDX_${this.tableName}_value_btree" ON "${this.tableName}" (value);`,
              );
            } catch (err) {
              console.warn(`创建索引失败，可能已存在: ${err}`);
            }
          }
        }

        // 只为 JSONB 类型创建 jsonb_deep_merge 函数
        if (this.valueType === 'jsonb') {
          await queryRunner.query(`
            DROP FUNCTION IF EXISTS jsonb_deep_merge(jsonb, jsonb);
            
            CREATE OR REPLACE FUNCTION jsonb_deep_merge(a jsonb, b jsonb)
            RETURNS jsonb AS $$
            DECLARE
              result jsonb;
              key text;
              value jsonb;
            BEGIN
              result := a;
              FOR key, value IN SELECT * FROM jsonb_each(b)
              LOOP
                IF jsonb_typeof(result->key) = 'object' AND jsonb_typeof(value) = 'object' THEN
                  result := jsonb_set(result, array[key], jsonb_deep_merge(result->key, value));
                ELSE
                  result := jsonb_set(result, array[key], value);
                END IF;
              END LOOP;
              RETURN result;
            END;
            $$ LANGUAGE plpgsql;
          `);
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
      value: this.serializeValue(value),
    });
  }

  async merge(key: string, partialValue: any): Promise<boolean> {
    this.checkTypeSupport('merge', ['jsonb']);
    await this.ensureInitialized();

    const query = `
      INSERT INTO "${this.tableName}" (key, value, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (key) DO UPDATE
      SET value = CASE
        WHEN "${this.tableName}".value IS NULL THEN $2::jsonb
        ELSE jsonb_deep_merge("${this.tableName}".value, $2::jsonb)
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
        // 可选：删除过期数据
        await this.delete(key);
        return null;
      }
    }

    const deserializedValue = this.deserializeValue(record.value);

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

  /**
   * 高效获取指定前缀的所有键值对
   * 使用范围查询充分利用主键索引性能，contains过滤在应用层执行以保持高性能
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
      contains?: string;
      caseSensitive?: boolean;
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
      contains,
      caseSensitive = true,
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

    // 始终使用高效的范围查询 - 充分利用主键的 B-tree 索引
    // key >= 'prefix' AND key < 'prefix' + '\xFF'
    const queryBuilder = this.db
      .createQueryBuilder(this.tableName)
      .select(selectFields)
      .where(`${this.tableName}.key >= :startPrefix`, { startPrefix: prefix })
      .andWhere(`${this.tableName}.key < :endPrefix`, {
        endPrefix: prefix + '\xFF', // 使用 \xFF 作为范围上限
      })
      .orderBy(`${this.tableName}.key`, orderBy);

    // 如果有 contains 过滤，不在数据库层限制 limit 和 offset
    // 在应用层过滤后再应用分页，确保结果准确性
    if (!contains) {
      // 只有在没有 contains 过滤时才在数据库层应用分页
      if (limit !== undefined) {
        queryBuilder.limit(limit);
      }

      if (offset !== undefined) {
        queryBuilder.offset(offset);
      }
    }

    try {
      const results = await queryBuilder.getRawMany();

      // 反序列化值
      let processedResults = results.map((record) => {
        const result: any = {
          key: record.key,
          value: this.deserializeValue(record.value),
        };

        if (includeTimestamps) {
          result.created_at = record.created_at;
          result.updated_at = record.updated_at;
        }

        return result;
      });

      // 如果有 contains 条件，在应用层进行高效过滤
      if (contains) {
        const searchTerm = caseSensitive ? contains : contains.toLowerCase();
        processedResults = processedResults.filter((record) => {
          const keyToSearch = caseSensitive
            ? record.key
            : record.key.toLowerCase();
          return keyToSearch.includes(searchTerm);
        });

        // 应用原始的 offset 和 limit
        if (offset !== undefined) {
          processedResults = processedResults.slice(offset);
        }
        if (limit !== undefined) {
          processedResults = processedResults.slice(0, limit);
        }
      }

      return processedResults;
    } catch (error) {
      console.error('getWithPrefix query error:', error);
      throw error;
    }
  }

  /**
   * 获取键包含指定子串的所有键值对
   * 注意：此方法性能较差，建议优先使用 getWithPrefix
   * @param substring 键中包含的子串
   * @param options 查询选项
   * @returns 匹配的键值对数组
   */
  async getWithContains<T = any>(
    substring: string,
    options?: {
      limit?: number;
      offset?: number;
      orderBy?: 'ASC' | 'DESC';
      caseSensitive?: boolean;
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

    if (!substring) {
      throw new Error('Substring cannot be empty');
    }

    const {
      limit,
      offset,
      orderBy = 'ASC',
      caseSensitive = true,
      includeTimestamps = false,
    } = options || {};

    // 警告：这种查询无法利用主键索引，性能较差
    console.warn(
      `Performance Warning: getWithContains('${substring}') will scan all records. Consider using getWithPrefix() if possible.`,
    );

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

    const likeOperator = caseSensitive ? 'LIKE' : 'ILIKE';
    const queryBuilder = this.db
      .createQueryBuilder(this.tableName)
      .select(selectFields)
      .where(`${this.tableName}.key ${likeOperator} :pattern`, {
        pattern: `%${substring}%`,
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

      return results.map((record) => {
        const result: any = {
          key: record.key,
          value: this.deserializeValue(record.value),
        };

        if (includeTimestamps) {
          result.created_at = record.created_at;
          result.updated_at = record.updated_at;
        }

        return result;
      });
    } catch (error) {
      console.error('getWithContains query error:', error);
      throw error;
    }
  }

  /**
   * 获取键以指定后缀结尾的所有键值对
   * 注意：此方法性能很差，因为无法利用标准B-tree索引
   * @param suffix 键的后缀
   * @param options 查询选项
   * @returns 匹配的键值对数组
   */
  async getWithSuffix<T = any>(
    suffix: string,
    options?: {
      limit?: number;
      offset?: number;
      orderBy?: 'ASC' | 'DESC';
      caseSensitive?: boolean;
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

    if (!suffix) {
      throw new Error('Suffix cannot be empty');
    }

    const {
      limit,
      offset,
      orderBy = 'ASC',
      caseSensitive = true,
      includeTimestamps = false,
    } = options || {};

    // 警告：后缀查询性能最差，无法利用B-tree索引
    console.warn(
      `Performance Warning: getWithSuffix('${suffix}') requires full table scan. Consider using reverse index or redesigning key structure.`,
    );

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

    const likeOperator = caseSensitive ? 'LIKE' : 'ILIKE';
    const queryBuilder = this.db
      .createQueryBuilder(this.tableName)
      .select(selectFields)
      .where(`${this.tableName}.key ${likeOperator} :pattern`, {
        pattern: `%${suffix}`,
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

      return results.map((record) => {
        const result: any = {
          key: record.key,
          value: this.deserializeValue(record.value),
        };

        if (includeTimestamps) {
          result.created_at = record.created_at;
          result.updated_at = record.updated_at;
        }

        return result;
      });
    } catch (error) {
      console.error('getWithSuffix query error:', error);
      throw error;
    }
  }

  /**
   * 高性能后缀查询的替代方案 - 使用反向键查询
   * 需要在存储时同时存储反向键，空间换时间
   * @param suffix 后缀
   * @param options 查询选项
   * @returns 匹配的键值对数组
   */
  async getWithSuffixOptimized<T = any>(
    suffix: string,
    options?: {
      limit?: number;
      offset?: number;
      orderBy?: 'ASC' | 'DESC';
    },
  ): Promise<Array<{ key: string; value: T }>> {
    await this.ensureInitialized();

    if (!suffix) {
      throw new Error('Suffix cannot be empty');
    }

    // 反向后缀变成前缀查询
    const reversedSuffix = suffix.split('').reverse().join('');
    const reversePrefix = `reverse:${reversedSuffix}`;

    console.log(
      `Using optimized suffix query with reverse index prefix: ${reversePrefix}`,
    );

    // 使用前缀查询查找反向键
    const reverseResults = await this.getWithPrefix<{
      originalKey: string;
      value: T;
    }>(reversePrefix, options);

    // 根据反向键结果获取原始数据
    if (reverseResults.length === 0) {
      return [];
    }

    const originalKeys = reverseResults.map((r) => r.value.originalKey);
    const originalData = await this.getMany<T>(originalKeys);

    return originalData;
  }

  async isValueExists(value: any): Promise<boolean> {
    await this.ensureInitialized();

    if (this.valueType === 'jsonb') {
      const existing = await this.db
        .createQueryBuilder()
        .where('value = :value::jsonb', { value: JSON.stringify(value) })
        .getOne();
      return !!existing;
    } else if (this.valueType === 'bytea') {
      // 对于 bytea 类型，使用二进制比较
      const serializedValue = this.serializeValue(value);
      const existing = await this.db.findOne({
        where: { value: serializedValue },
      });
      return !!existing;
    } else {
      // 对于非 JSONB 类型，直接比较值
      const existing = await this.db.findOne({
        where: { value: this.serializeValue(value) },
      });
      return !!existing;
    }
  }

  async getValues(value: any): Promise<any> {
    await this.ensureInitialized();

    if (this.valueType === 'jsonb') {
      // Use proper JSONB comparison with query builder
      const existing = await this.db
        .createQueryBuilder()
        .where('value = :value::jsonb', { value: JSON.stringify(value) })
        .getMany();
      return existing;
    } else if (this.valueType === 'bytea') {
      // 对于 bytea 类型，使用二进制比较
      const serializedValue = this.serializeValue(value);
      const existing = await this.db.find({
        where: { value: serializedValue },
      });
      return existing;
    } else {
      // 对于非 JSONB 类型，直接比较值
      const existing = await this.db.find({
        where: { value: this.serializeValue(value) },
      });
      return existing;
    }
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureInitialized();
    const result = await this.db.delete({ key });
    return !!result.affected && result.affected > 0;
  }

  /**
   * 获取多个键的值
   * @param keys 键数组
   * @param options 查询选项
   * @returns 键值对数组
   */
  async getMany<T = any>(
    keys: string[],
    options?: {
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
    if (!keys || keys.length === 0) {
      return [];
    }
    await this.ensureInitialized();

    const { includeTimestamps = false } = options || {};

    // 根据是否需要时间戳选择要查询的字段
    const selectFields: (keyof KVEntity)[] = ['key', 'value'];
    if (includeTimestamps) {
      selectFields.push('created_at', 'updated_at');
    }

    const records = await this.db.findBy({
      key: In(keys),
    });

    // Deserialize values if necessary
    return records.map((record) => {
      const result: any = {
        key: record.key,
        value: this.deserializeValue(record.value),
      };

      if (includeTimestamps) {
        result.created_at = record.created_at;
        result.updated_at = record.updated_at;
      }

      return result;
    });
  }

  async add(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    const existing = await this.db.findOne({ where: { key } });
    if (existing) {
      throw new Error(`Key "${key}" already exists`);
    }
    await this.db.save({
      key,
      value: this.serializeValue(value),
    });
  }

  async addUniquePair(key: string, value: any): Promise<void> {
    await this.ensureInitialized();

    if (this.valueType === 'jsonb') {
      // Use a proper JSONB comparison query
      const existing = await this.db
        .createQueryBuilder()
        .where('key = :key', { key })
        .andWhere('value = :value::jsonb', { value: JSON.stringify(value) })
        .getOne();

      if (existing) {
        throw new Error(`Key-value pair already exists for key "${key}"`);
      }
    } else if (this.valueType === 'bytea') {
      // 对于 bytea 类型，使用二进制比较
      const serializedValue = this.serializeValue(value);
      const existing = await this.db.findOne({
        where: {
          key,
          value: serializedValue,
        },
      });

      if (existing) {
        throw new Error(`Key-value pair already exists for key "${key}"`);
      }
    } else {
      // 对于非 JSONB 类型，直接比较
      const existing = await this.db.findOne({
        where: {
          key,
          value: this.serializeValue(value),
        },
      });

      if (existing) {
        throw new Error(`Key-value pair already exists for key "${key}"`);
      }
    }

    await this.db.save({
      key,
      value: this.serializeValue(value),
    });
  }

  async addUniqueValue(key: string, value: any): Promise<void> {
    await this.ensureInitialized();

    if (this.valueType === 'jsonb') {
      // Use proper JSONB comparison with query builder
      const existing = await this.db
        .createQueryBuilder()
        .where('value = :value::jsonb', { value: JSON.stringify(value) })
        .getOne();

      if (existing) {
        const existingKey = existing.key;
        throw new Error(`Value already exists with key "${existingKey}"`);
      }
    } else if (this.valueType === 'bytea') {
      // 对于 bytea 类型，使用二进制比较
      const serializedValue = this.serializeValue(value);
      const existing = await this.db.findOne({
        where: { value: serializedValue },
      });

      if (existing) {
        const existingKey = existing.key;
        throw new Error(`Value already exists with key "${existingKey}"`);
      }
    } else {
      // 对于非 JSONB 类型，直接比较值
      const existing = await this.db.findOne({
        where: { value: this.serializeValue(value) },
      });

      if (existing) {
        const existingKey = existing.key;
        throw new Error(`Value already exists with key "${existingKey}"`);
      }
    }

    await this.db.save({
      key,
      value: this.serializeValue(value),
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
          .map(([key, value]) => {
            let serializedValue: string;
            if (this.valueType === 'jsonb') {
              serializedValue = `'${JSON.stringify(value)}'`;
            } else if (this.valueType === 'bytea') {
              // 对于 bytea 类型，使用 bytea 字面量语法
              const buffer = this.serializeValue(value);
              serializedValue = `'\\x${buffer.toString('hex')}'`;
            } else {
              serializedValue = `'${String(value)}'`;
            }
            return `('${key}', ${serializedValue}, NOW(), NOW())`;
          })
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
   * 查找布尔值记录 - 仅支持 boolean 和 jsonb 类型
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
    this.checkTypeSupport('findBoolValues', ['boolean', 'jsonb']);
    await this.ensureInitialized();

    const queryBuilder = this.db
      .createQueryBuilder(this.tableName)
      .select([
        `${this.tableName}.key as "key"`,
        `${this.tableName}.value as "value"`,
      ])
      .orderBy('created_at', orderBy);

    if (this.valueType === 'jsonb') {
      queryBuilder.where('value = :value::jsonb', {
        value: JSON.stringify(boolValue),
      });
    } else {
      queryBuilder.where('value = :value', { value: boolValue });
    }

    if (first) {
      const result = await queryBuilder.getRawOne();
      return result ? result.key : null;
    }

    const results = await queryBuilder.getRawMany();
    return results;
  }

  /**
   * 高级 JSON 搜索 - 仅支持 JSONB 类型
   * @param searchOptions 搜索选项
   */
  /**
   * 高级 JSON 搜索 - 仅支持 JSONB 类型
   * @param searchOptions 搜索选项
   * @returns 搜索结果和分页游标
   *
   * 使用示例：
   *
   * // 精确匹配
   * await db.searchJson({
   *   contains: { status: 'active' },
   *   limit: 10
   * });
   *
   * // 比较操作
   * await db.searchJson({
   *   compare: [
   *     { path: 'age', operator: '>', value: 18 },
   *     { path: 'name', operator: '=', value: 'John' }
   *   ]
   * });
   *
   * // 文本包含搜索（LIKE/ILIKE）
   * await db.searchJson({
   *   textSearch: [
   *     { path: 'english_only', text: 'legal document', caseSensitive: false },
   *     { path: 'description', text: 'important', caseSensitive: true }
   *   ],
   *   includeTimestamps: true
   * });
   *
   * // 混合搜索
   * await db.searchJson({
   *   contains: { status: 'active' },
   *   textSearch: [{ path: 'content', text: 'search term', caseSensitive: false }],
   *   compare: [{ path: 'priority', operator: '>=', value: 5 }],
   *   limit: 20,
   *   includeTimestamps: true
   * });
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
    textSearch?: Array<{
      path: string;
      text: string;
      caseSensitive?: boolean;
    }>;
    includeTimestamps?: boolean;
    orderBy?: 'ASC' | 'DESC';
    orderByField?: 'key' | 'created_at' | 'updated_at';
  }): Promise<{
    data: any[];
    nextCursor: string | null;
  }> {
    this.checkTypeSupport('searchJson', ['jsonb']);
    await this.ensureInitialized();

    const limit = searchOptions.limit || 100;
    const includeTimestamps = searchOptions.includeTimestamps || false;
    const orderBy = searchOptions.orderBy || 'ASC';
    const orderByField = searchOptions.orderByField || 'key';

    // 使用原生SQL查询，更直接地访问数据库
    try {
      // 根据是否需要时间戳选择字段
      const selectFields = includeTimestamps
        ? 'key, value, created_at, updated_at'
        : 'key, value';

      let query = `SELECT ${selectFields} FROM "${this.tableName}"`;
      const params: any[] = [];
      let paramIndex = 1;

      // 构建WHERE子句
      const whereConditions: string[] = [];

      // 处理 contains 条件（精确匹配）
      if (searchOptions.contains) {
        Object.entries(searchOptions.contains).forEach(([key, value]) => {
          whereConditions.push(`value->>'${key}' = $${paramIndex}`);
          params.push(String(value));
          paramIndex++;
        });
      }

      // 处理 compare 条件（比较操作）
      if (searchOptions.compare) {
        searchOptions.compare.forEach((condition) => {
          whereConditions.push(
            `value->>'${condition.path}' ${condition.operator} $${paramIndex}`,
          );
          params.push(String(condition.value));
          paramIndex++;
        });
      }

      // 处理 textSearch 条件（LIKE/ILIKE 搜索）
      if (searchOptions.textSearch) {
        searchOptions.textSearch.forEach((textCondition) => {
          const likeOperator = textCondition.caseSensitive ? 'LIKE' : 'ILIKE';
          whereConditions.push(
            `value->>'${textCondition.path}' ${likeOperator} $${paramIndex}`,
          );
          params.push(`%${textCondition.text}%`);
          paramIndex++;
        });
      }

      // 处理游标分页
      if (searchOptions.cursor) {
        if (orderByField === 'key') {
          whereConditions.push(`key > $${paramIndex}`);
        } else {
          whereConditions.push(`${orderByField} > $${paramIndex}`);
        }
        params.push(searchOptions.cursor);
        paramIndex++;
      }

      // 添加WHERE子句（如果有条件）
      if (whereConditions.length > 0) {
        query += ` WHERE ${whereConditions.join(' AND ')}`;
      }

      // 添加排序和分页
      query += ` ORDER BY ${orderByField} ${orderBy} LIMIT ${limit + 1}`;

      const results = await this.db.query(query, params);

      const hasMore = results.length > limit;
      const data = results.slice(0, limit);
      const nextCursor =
        hasMore && data.length > 0 ? data[data.length - 1][orderByField] : null;

      // 如果不需要时间戳，移除时间戳字段（保持向后兼容）
      if (!includeTimestamps) {
        data.forEach((item: any) => {
          delete item.created_at;
          delete item.updated_at;
        });
      }

      return {
        data,
        nextCursor,
      };
    } catch (error) {
      console.error('SearchJson query error:', error);
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
    includeTimestamps?: boolean;
  }): Promise<
    Array<{
      key: string;
      value: any;
      created_at?: Date;
      updated_at?: Date;
    }>
  > {
    await this.ensureInitialized();
    const timeColumn = params.timeColumn || 'updated_at';
    const includeTimestamps = params.includeTimestamps || false;

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

    const queryBuilder = this.db
      .createQueryBuilder()
      .select(selectFields)
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
      return results.map((record) => {
        const result: any = {
          key: record.key,
          value: this.deserializeValue(record.value),
        };

        if (includeTimestamps) {
          result.created_at = record.created_at;
          result.updated_at = record.updated_at;
        }

        return result;
      });
    } catch (error) {
      console.error('查询错误:', queryBuilder.getSql());
      console.error('查询参数:', queryBuilder.getParameters());
      throw error;
    }
  }

  /**
   * 优化后的 JSON 和时间复合搜索 - 仅支持 JSONB 类型
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
      includeTimestamps?: boolean;
    },
  ): Promise<
    Array<{
      key: string;
      value: any;
      created_at?: Date;
      updated_at?: Date;
    }>
  > {
    this.checkTypeSupport('searchJsonByTime', ['jsonb']);
    await this.ensureInitialized();
    const timeColumn = timeOptions.timeColumn || 'updated_at';
    const includeTimestamps = timeOptions.includeTimestamps || false;

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

    const queryBuilder = this.db
      .createQueryBuilder()
      .select(selectFields)
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
      return results.map((record) => {
        const result: any = {
          key: record.key,
          value: this.deserializeValue(record.value),
        };

        if (includeTimestamps) {
          result.created_at = record.created_at;
          result.updated_at = record.updated_at;
        }

        return result;
      });
    } catch (error) {
      console.error('Query error:', queryBuilder.getSql());
      console.error('Query parameters:', queryBuilder.getParameters());
      throw error;
    }
  }

  /**
   * Saves an array by splitting it into batches - 主要支持 JSONB 类型，其他类型提供基本支持
   * If the key already exists, appends the new items to the existing array unless overwrite is true
   * @param key The base key for the array
   * @param array The array to save
   * @param options Optional configuration including batchSize, forceUpdateBatchSize, and overwrite
   */
  async saveArray(
    key: string,
    array: any[],
    options?: SaveArrayOptions,
  ): Promise<void> {
    let { batchSize = 1000 } = options || {};
    const { forceUpdateBatchSize = false, overwrite = false } = options || {};

    // 数组功能主要针对 JSONB 设计，但也支持其他类型的简单数组
    if (this.valueType !== 'jsonb') {
      console.warn(
        `Warning: saveArray is optimized for JSONB type but current type is '${this.valueType}'. Complex array operations may not work as expected.`,
      );
    }

    await this.ensureInitialized();

    // Cache key construction to avoid string concatenation in loops
    const metaKey = `${key}_meta`;
    const existingMeta = await this.get(metaKey);

    // If key exists, append the new items to existing array, unless overwrite is true
    if (existingMeta && existingMeta.batchCount > 0 && !overwrite) {
      const existingBatchCount = existingMeta.batchCount;
      const existingTotalItems = existingMeta.totalItems;

      // Get stored batch size or use default if not found (for backward compatibility)
      const storedBatchSize = existingMeta.batchSize || 1000;

      // Determine which batch size to use
      let activeBatchSize = storedBatchSize;

      // Handle batch size change if requested
      if (forceUpdateBatchSize && 1000 !== storedBatchSize) {
        console.log(`Updating batch size from ${storedBatchSize} to 1000`);
        activeBatchSize = 1000;

        // We need to rebalance all batches if the batch size changes
        // This will require a full rebuild - we'll need to get all data,
        // rebatch it, and save it back with the new batch size
        if (existingTotalItems > 0) {
          // Get all existing data
          const allData = await this.getAllArray<any>(key);

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
          return this.saveArray(key, array, {
            batchSize: 1000,
            overwrite: true,
          }); // Recursively call with overwrite true for rebatching
        }
      } else if (1000 !== storedBatchSize) {
        console.warn(
          `Warning: Provided batchSize (${1000}) differs from originally stored batchSize (${storedBatchSize}). Using stored value. Set forceUpdateBatchSize=true to change batch size.`,
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
          const serializedValue =
            this.valueType === 'jsonb'
              ? JSON.stringify(updatedLastBatch)
              : String(updatedLastBatch);
          parameters.push([serializedValue, lastBatchKey]);
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
            const serializedValue =
              this.valueType === 'jsonb'
                ? JSON.stringify(batchData)
                : String(batchData);
            bulkParams.push(batchKey, serializedValue);
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
        const serializedMeta =
          this.valueType === 'jsonb'
            ? JSON.stringify(updatedMeta)
            : // For non-jsonb/bytea types, ensure the value is stringifiable, or throw error
              // If valueType is not jsonb and the value is an object, serialize it as JSON string
              typeof updatedMeta === 'object'
              ? JSON.stringify(updatedMeta)
              : String(updatedMeta); // Stringify primitive types for other types

        statements.push(`
          INSERT INTO "${this.tableName}" (key, value, created_at, updated_at)
          VALUES ($1, $2, NOW(), NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `);
        parameters.push([metaKey, serializedMeta]);

        // Execute all statements in a single transaction
        for (let i = 0; i < statements.length; i++) {
          await queryRunner.query(statements[i], parameters[i]);
        }

        await queryRunner.commitTransaction();
      } catch (err) {
        await queryRunner.rollbackTransaction();
        console.error('Failed to save array with key:', key, err);
        throw err;
      } finally {
        await queryRunner.release();
      }
    } else {
      // If key does not exist or overwrite is true, create a new array
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        // Delete all existing batch records and metadata if overwrite is true
        if (overwrite) {
          const keysToDelete = [metaKey];
          if (existingMeta && existingMeta.batchCount > 0) {
            for (let i = 0; i < existingMeta.batchCount; i++) {
              keysToDelete.push(`${key}_${i}`);
            }
          }
          if (keysToDelete.length > 0) {
            await this.deleteMany(keysToDelete);
          }
        }

        // Create new batches for the array
        const bulkValues: string[] = [];
        const bulkParams: any[] = [];
        let paramIndex = 1;
        let batchCount = 0;

        for (let i = 0; i < array.length; i += batchSize) {
          const batchData = array.slice(i, i + batchSize);
          const batchKey = `${key}_${batchCount}`;

          bulkValues.push(`($${paramIndex}, $${paramIndex + 1}, NOW(), NOW())`);
          const serializedValue =
            this.valueType === 'jsonb'
              ? JSON.stringify(batchData)
              : String(batchData);
          bulkParams.push(batchKey, serializedValue);
          paramIndex += 2;
          batchCount++;
        }

        if (bulkValues.length > 0) {
          await queryRunner.query(
            `
            INSERT INTO "${this.tableName}" (key, value, created_at, updated_at)
            VALUES ${bulkValues.join(',')}
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
          `,
            bulkParams,
          );
        }

        // Save metadata
        const metaData = {
          batchCount: batchCount,
          totalItems: array.length,
          batchSize: batchSize, // Store batch size in metadata
          lastUpdated: new Date().toISOString(),
        };
        const serializedMeta =
          this.valueType === 'jsonb'
            ? JSON.stringify(metaData)
            : // For non-jsonb/bytea types, ensure the value is stringifiable, or throw error
              // If valueType is not jsonb and the value is an object, serialize it as JSON string
              typeof metaData === 'object'
              ? JSON.stringify(metaData)
              : String(metaData); // Stringify primitive types for other types

        await queryRunner.query(
          `
          INSERT INTO "${this.tableName}" (key, value, created_at, updated_at)
          VALUES ($1, $2, NOW(), NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `,
          [metaKey, serializedMeta],
        );

        await queryRunner.commitTransaction();
      } catch (err) {
        await queryRunner.rollbackTransaction();
        console.error('Failed to save array with key:', key, err);
        throw err;
      } finally {
        await queryRunner.release();
      }
    }
  }

  /**
   * Gets the complete array stored under a given key by fetching all its batches.
   * @param key The base key for the array.
   * @returns A promise that resolves to the complete array.
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
   * @param offset Number of items to skip from the end (default: 0)
   * @returns The most recent items from the array
   */
  async getRecentArray<T = any>(
    key: string,
    count: number,
    offset: number = 0,
  ): Promise<T[]> {
    await this.ensureInitialized();

    // Get metadata
    const metaKey = `${key}_meta`;
    const meta = await this.get(metaKey);

    if (!meta || !meta.batchCount || count <= 0) {
      return [];
    }

    // If count + offset is greater than total items, adjust offset
    if (offset >= meta.totalItems) {
      return [];
    }

    // Get batch size from metadata or use default for backward compatibility
    const batchSize = meta.batchSize || 1000;

    // Calculate total items to fetch (count + offset)
    const totalNeeded = count + offset;

    // If total needed is greater than total items, fetch all and handle offset in memory
    if (totalNeeded >= meta.totalItems) {
      const allItems = await this.getAllArray<T>(key);
      return allItems.slice(
        Math.max(0, allItems.length - totalNeeded),
        allItems.length - offset,
      );
    }

    // Calculate which batches we need
    let itemsNeeded = totalNeeded;
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
    const allRecentItems: T[] = [];
    let remainingCount = totalNeeded;

    for (const record of records) {
      const batch = record.value || [];

      if (batch.length <= remainingCount) {
        allRecentItems.unshift(...batch);
        remainingCount -= batch.length;
      } else {
        const startIndex = batch.length - remainingCount;
        const recentFromBatch = batch.slice(startIndex);
        allRecentItems.unshift(...recentFromBatch);
        remainingCount = 0;
      }

      if (remainingCount <= 0) break;
    }

    // Apply offset and return the requested count
    return allRecentItems.slice(0, Math.max(0, allRecentItems.length - offset));
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
   * @param options 查询选项
   * @returns 随机记录数组
   */
  async getRandomData(
    count: number = 1,
    options?: {
      includeTimestamps?: boolean;
    },
  ): Promise<
    Array<{
      key: string;
      value: any;
      created_at?: Date;
      updated_at?: Date;
    }>
  > {
    await this.ensureInitialized();

    const { includeTimestamps = false } = options || {};

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

    // 使用 ORDER BY RANDOM() 获取随机记录
    const results = await this.db
      .createQueryBuilder(this.tableName)
      .select(selectFields)
      .orderBy('RANDOM()')
      .limit(count)
      .getRawMany();

    return results.map((record) => {
      const result: any = {
        key: record.key,
        value: this.deserializeValue(record.value),
      };

      if (includeTimestamps) {
        result.created_at = record.created_at;
        result.updated_at = record.updated_at;
      }

      return result;
    });
  }

  /**
   * 获取当前配置的值类型
   */
  getValueType(): ValueType {
    return this.valueType;
  }

  /**
   * 获取表名
   */
  getTableName(): string {
    return this.tableName;
  }

  /**
   * 检查是否支持指定的操作
   */
  isOperationSupported(operation: string): boolean {
    const operationTypeMap: Record<string, ValueType[]> = {
      merge: ['jsonb'],
      searchJson: ['jsonb'],
      searchJsonByTime: ['jsonb'],
      findBoolValues: ['boolean', 'jsonb'],
      saveArray: ['jsonb'], // 主要支持，但其他类型也有基本支持
      getAllArray: ['jsonb'], // 主要支持，但其他类型也有基本支持
      getRecentArray: ['jsonb'], // 主要支持，但其他类型也有基本支持
      getArrayRange: ['jsonb'], // 主要支持，但其他类型也有基本支持
    };

    const supportedTypes = operationTypeMap[operation];
    if (!supportedTypes) {
      return true; // 未列出的操作默认支持所有类型
    }

    return supportedTypes.includes(this.valueType);
  }
}
