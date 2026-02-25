import 'reflect-metadata';
import {
  DataSource,
  Repository,
  Table,
  In,
  EntitySchema,
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
  batch_size?: number;
  force_update_batch_size?: boolean;
  overwrite?: boolean;
}

export class PGKVDatabase {
  db!: Repository<KVEntity>;
  private data_source: DataSource;
  private initialized = false;
  private table_name: string;
  private value_type: ValueType;
  private custom_kv_store: any;

  constructor(
    datasource_or_url?: string,
    table_name: string = 'kv_store',
    value_type: ValueType = 'jsonb',
  ) {
    this.table_name = table_name;
    this.value_type = value_type;
    if (!datasource_or_url) {
      throw new Error('datasource_or_url is required');
    }

    console.log(`[PGKVDatabase] Creating instance for table: ${table_name}`);

    const CustomKVStore = new EntitySchema<KVEntity>({
      name: table_name,
      columns: {
        key: {
          type: 'varchar',
          length: 255,
          primary: true,
        },
        value: {
          type: this.getPostgreSQLColumnType(value_type) as any,
          nullable: true,
        },
        created_at: {
          type: 'timestamptz',
          createDate: true,
          name: 'created_at',
        },
        updated_at: {
          type: 'timestamptz',
          updateDate: true,
          name: 'updated_at',
        },
      },
    });

    this.custom_kv_store = CustomKVStore;

    this.data_source = new DataSource({
      type: 'postgres',
      url: datasource_or_url,
      entities: [CustomKVStore],
      synchronize: false,
      extra: {
        max: 10,
        min: 2,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 3000,
        statement_timeout: 15000,
        query_timeout: 15000,
        keepAlive: true,
        keepAliveInitialDelay: 10000,
        maxUses: 7500,
      },
      logging: ['error', 'warn', 'info'],
    });
  }

  /**
   * 根据值类型获取 TypeORM 列类型配置
   */
  private getColumnType(value_type: ValueType): any {
    switch (value_type) {
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
  private getPostgreSQLColumnType(value_type: ValueType): string {
    switch (value_type) {
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
    supported_types: ValueType[],
  ): void {
    if (!supported_types.includes(this.value_type)) {
      throw new Error(
        `Operation '${operation}' is not supported for value type '${this.value_type
        }'. Supported types: ${supported_types.join(', ')}`,
      );
    }
  }

  /**
   * 根据值类型处理值的序列化
   */
  private serializeValue(value: any): any {
    if (this.value_type === 'jsonb') {
      return value; // TypeORM 会自动处理 JSONB
    } else if (this.value_type === 'bytea') {
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
    if (this.value_type === 'bytea' && Buffer.isBuffer(value)) {
      return value; // 保持 Buffer 类型
    }
    return value; // TypeORM 会自动处理类型转换
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      console.log(`[PGKVDatabase] Initializing DataSource for ${this.table_name}...`);
      try {
        await this.data_source.initialize();
        console.log(`[PGKVDatabase] DataSource initialized for ${this.table_name}`);
      } catch (e) {
        console.error(`[PGKVDatabase] Failed to initialize DataSource for ${this.table_name}:`, e);
        throw e;
      }
      this.db = this.data_source.getRepository(this.custom_kv_store);

      // 手动创建表和索引
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
                  type: this.getPostgreSQLColumnType(this.value_type),
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
          if (this.value_type === 'jsonb') {
            try {
              await query_runner.query(
                `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_value_gin" ON "${this.table_name}" USING gin (value);`,
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.warn(`创建索引失败，可能已存在: ${message}`);
            }
          } else {
            // 为其他类型创建 B-tree 索引
            try {
              await query_runner.query(
                `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_value_btree" ON "${this.table_name}" (value);`,
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.warn(`创建索引失败，可能已存在: ${message}`);
            }
          }
        }

        // 只为 JSONB 类型创建 jsonb_deep_merge 函数
        if (this.value_type === 'jsonb') {
          await query_runner.query(`
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
        await query_runner.release();
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

  async merge(key: string, partial_value: any): Promise<boolean> {
    this.checkTypeSupport('merge', ['jsonb']);
    await this.ensureInitialized();

    const query = `
      INSERT INTO "${this.table_name}" (key, value, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (key) DO UPDATE
      SET value = CASE
        WHEN "${this.table_name}".value IS NULL THEN $2::jsonb
        ELSE jsonb_deep_merge("${this.table_name}".value, $2::jsonb)
      END,
      updated_at = NOW()
      RETURNING value
    `;

    const result = await this.db.query(query, [
      key,
      JSON.stringify(partial_value),
    ]);

    return !!result?.length;
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
        // 可选：删除过期数据
        await this.delete(key);
        return null;
      }
    }

    const deserialized_value = this.deserializeValue(record.value);

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

  /**
   * 高效获取指定前缀的所有键值对
   * 使用范围查询充分利用主键索引性能，contains过滤在应用层执行以保持高性能
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
      contains?: string;
      case_sensitive?: boolean;
      created_at_after?: number;
      created_at_before?: number;
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
      contains,
      case_sensitive = true,
      created_at_after,
      created_at_before,
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

    // 始终使用高效的范围查询 - 充分利用主键的 B-tree 索引
    // key >= 'prefix' AND key < 'prefix' + '\xFF'
    const query_builder = this.db
      .createQueryBuilder(this.table_name)
      .select(select_fields)
      .where(`${this.table_name}.key >= :start_prefix`, {
        start_prefix: prefix,
      })
      .andWhere(`${this.table_name}.key < :end_prefix`, {
        end_prefix: prefix + '\xFF', // 使用 \xFF 作为范围上限
      })
      .orderBy(`${this.table_name}.key`, order_by);

    // 添加时间过滤条件
    if (created_at_after !== undefined) {
      if (!isNaN(created_at_after) && created_at_after > 0) {
        query_builder.andWhere(
          `${this.table_name}.created_at > :created_at_after`,
          {
            created_at_after: new Date(created_at_after),
          },
        );
      }
    }

    if (created_at_before !== undefined) {
      if (!isNaN(created_at_before) && created_at_before > 0) {
        query_builder.andWhere(
          `${this.table_name}.created_at < :created_at_before`,
          {
            created_at_before: new Date(created_at_before),
          },
        );
      }
    }

    // 检查是否有时间过滤条件，如果有则忽略 limit 和 offset
    const has_time_filter =
      created_at_after !== undefined || created_at_before !== undefined;

    // 如果有 contains 过滤或时间过滤，不在数据库层限制 limit 和 offset
    // 在应用层过滤后再应用分页，确保结果准确性
    if (!contains && !has_time_filter) {
      // 只有在没有 contains 过滤和时间过滤时才在数据库层应用分页
      if (limit !== undefined) {
        query_builder.limit(limit);
      }

      if (offset !== undefined) {
        query_builder.offset(offset);
      }
    }

    try {
      const results = await query_builder.getRawMany();

      // 反序列化值
      let processed_results = results.map((record) => ({
        key: record.key,
        value: this.deserializeValue(record.value) as T,
        created_at: record.created_at,
        updated_at: record.updated_at,
      }));

      // 如果有 contains 条件，在应用层进行高效过滤
      if (contains) {
        const search_term = case_sensitive ? contains : contains.toLowerCase();
        processed_results = processed_results.filter((record) => {
          const key_to_search = case_sensitive
            ? record.key
            : record.key.toLowerCase();
          return key_to_search.includes(search_term);
        });
      }

      // 如果有时间过滤或 contains 过滤，在应用层应用 offset 和 limit
      if (contains || has_time_filter) {
        // 应用原始的 offset 和 limit
        if (offset !== undefined) {
          processed_results = processed_results.slice(offset);
        }
        if (limit !== undefined) {
          processed_results = processed_results.slice(0, limit);
        }
      }

      return processed_results.reduce(
        (
          acc,
          record: {
            key: string;
            value: T;
            created_at: Date;
            updated_at: Date;
          },
        ) => {
          acc[record.key] = include_timestamps
            ? {
              value: record.value,
              created_at: record.created_at,
              updated_at: record.updated_at,
            }
            : record.value;
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

  /**
   * 获取键包含指定子串的所有键值对
   * 注意：此方法性能较差，建议优先使用 getWithPrefix
   * @param substring 键中包含的子串
   * @param options 查询选项
   * @returns 匹配的键值对对象
   */
  async getWithContains<T = any>(
    substring: string,
    options?: {
      limit?: number;
      offset?: number;
      order_by?: 'ASC' | 'DESC';
      case_sensitive?: boolean;
      include_timestamps?: boolean;
    },
  ): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    await this.ensureInitialized();

    if (!substring) {
      throw new Error('Substring cannot be empty');
    }

    const {
      limit,
      offset,
      order_by = 'ASC',
      case_sensitive = true,
      include_timestamps = false,
    } = options || {};

    // 警告：这种查询无法利用主键索引，性能较差
    console.warn(
      `Performance Warning: getWithContains('${substring}') will scan all records. Consider using getWithPrefix() if possible.`,
    );

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

    const like_operator = case_sensitive ? 'LIKE' : 'ILIKE';
    const query_builder = this.db
      .createQueryBuilder(this.table_name)
      .select(select_fields)
      .where(`${this.table_name}.key ${like_operator} :pattern`, {
        pattern: `%${substring}%`,
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
          const value = this.deserializeValue(record.value) as T;
          acc[record.key] = include_timestamps
            ? {
              value,
              created_at: record.created_at,
              updated_at: record.updated_at,
            }
            : value;
          return acc;
        },
        {} as Record<
          string,
          T | { value: T; created_at: Date; updated_at: Date }
        >,
      );
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
   * @returns 匹配的键值对对象
   */
  async getWithSuffix<T = any>(
    suffix: string,
    options?: {
      limit?: number;
      offset?: number;
      order_by?: 'ASC' | 'DESC';
      case_sensitive?: boolean;
      include_timestamps?: boolean;
    },
  ): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    await this.ensureInitialized();

    if (!suffix) {
      throw new Error('Suffix cannot be empty');
    }

    const {
      limit,
      offset,
      order_by = 'ASC',
      case_sensitive = true,
      include_timestamps = false,
    } = options || {};

    // 警告：后缀查询性能最差，无法利用B-tree索引
    console.warn(
      `Performance Warning: getWithSuffix('${suffix}') requires full table scan. Consider using reverse index or redesigning key structure.`,
    );

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

    const like_operator = case_sensitive ? 'LIKE' : 'ILIKE';
    const query_builder = this.db
      .createQueryBuilder(this.table_name)
      .select(select_fields)
      .where(`${this.table_name}.key ${like_operator} :pattern`, {
        pattern: `%${suffix}`,
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
          const value = this.deserializeValue(record.value) as T;
          acc[record.key] = include_timestamps
            ? {
              value,
              created_at: record.created_at,
              updated_at: record.updated_at,
            }
            : value;
          return acc;
        },
        {} as Record<
          string,
          T | { value: T; created_at: Date; updated_at: Date }
        >,
      );
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
      order_by?: 'ASC' | 'DESC';
    },
  ): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    await this.ensureInitialized();

    if (!suffix) {
      throw new Error('Suffix cannot be empty');
    }

    // 反向后缀变成前缀查询
    const reversed_suffix = suffix.split('').reverse().join('');
    const reverse_prefix = `reverse:${reversed_suffix}`;

    console.log(
      `Using optimized suffix query with reverse index prefix: ${reverse_prefix}`,
    );

    // 使用前缀查询查找反向键
    const reverse_results = await this.getWithPrefix<{
      original_key: string;
      value: T;
    }>(reverse_prefix, options);

    // 根据反向键结果获取原始数据
    const reverse_values = Object.values(reverse_results).map((entry) => {
      if (entry && typeof entry === 'object' && 'value' in (entry as any)) {
        return (entry as any).value as { original_key: string; value: T };
      }
      return entry as { original_key: string; value: T };
    });

    if (reverse_values.length === 0) {
      return {};
    }

    const original_keys = reverse_values.map((r) => r.original_key);
    const original_data = await this.getMany<T>(original_keys);

    return original_data;
  }

  async isValueExists(value: any): Promise<boolean> {
    await this.ensureInitialized();

    if (this.value_type === 'jsonb') {
      const existing = await this.db
        .createQueryBuilder()
        .where('value = :value::jsonb', { value: JSON.stringify(value) })
        .getOne();
      return !!existing;
    } else if (this.value_type === 'bytea') {
      // 对于 bytea 类型，使用二进制比较
      const serialized_value = this.serializeValue(value);
      const existing = await this.db.findOne({
        where: { value: serialized_value },
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

    if (this.value_type === 'jsonb') {
      // Use proper JSONB comparison with query builder
      const existing = await this.db
        .createQueryBuilder()
        .where('value = :value::jsonb', { value: JSON.stringify(value) })
        .getMany();
      return existing;
    } else if (this.value_type === 'bytea') {
      // 对于 bytea 类型，使用二进制比较
      const serialized_value = this.serializeValue(value);
      const existing = await this.db.find({
        where: { value: serialized_value },
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
      include_timestamps?: boolean;
    },
  ): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    if (!keys || keys.length === 0) {
      return {};
    }
    await this.ensureInitialized();

    const include_timestamps = options?.include_timestamps === true;

    const records = await this.db.findBy({
      key: In(keys),
    });

    return records.reduce(
      (acc, record) => {
        const value = this.deserializeValue(record.value) as T;
        acc[record.key] = include_timestamps
          ? {
            value,
            created_at: record.created_at,
            updated_at: record.updated_at,
          }
          : value;
        return acc;
      },
      {} as Record<
        string,
        T | { value: T; created_at: Date; updated_at: Date }
      >,
    );
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

    if (this.value_type === 'jsonb') {
      // Use a proper JSONB comparison query
      const existing = await this.db
        .createQueryBuilder()
        .where('key = :key', { key })
        .andWhere('value = :value::jsonb', { value: JSON.stringify(value) })
        .getOne();

      if (existing) {
        throw new Error(`Key-value pair already exists for key "${key}"`);
      }
    } else if (this.value_type === 'bytea') {
      // 对于 bytea 类型，使用二进制比较
      const serialized_value = this.serializeValue(value);
      const existing = await this.db.findOne({
        where: {
          key,
          value: serialized_value,
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

    if (this.value_type === 'jsonb') {
      // Use proper JSONB comparison with query builder
      const existing = await this.db
        .createQueryBuilder()
        .where('value = :value::jsonb', { value: JSON.stringify(value) })
        .getOne();

      if (existing) {
        const existing_key = existing.key;
        throw new Error(`Value already exists with key "${existing_key}"`);
      }
    } else if (this.value_type === 'bytea') {
      // 对于 bytea 类型，使用二进制比较
      const serialized_value = this.serializeValue(value);
      const existing = await this.db.findOne({
        where: { value: serialized_value },
      });

      if (existing) {
        const existing_key = existing.key;
        throw new Error(`Value already exists with key "${existing_key}"`);
      }
    } else {
      // 对于非 JSONB 类型，直接比较值
      const existing = await this.db.findOne({
        where: { value: this.serializeValue(value) },
      });

      if (existing) {
        const existing_key = existing.key;
        throw new Error(`Value already exists with key "${existing_key}"`);
      }
    }

    await this.db.save({
      key,
      value: this.serializeValue(value),
    });
  }

  async close(): Promise<void> {
    if (this.initialized && this.data_source?.isInitialized) {
      await this.data_source.destroy();
      this.initialized = false;
    }
  }

  // 获取所有键值对，支持分页
  async getAll<T = any>(options?: {
    include_timestamps?: boolean;
    offset?: number;
    limit?: number;
  }): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    await this.ensureInitialized();
    const include_timestamps = options?.include_timestamps === true;
    const find_options: any = {
      order: { key: 'ASC' },
    };

    if (typeof options?.offset === 'number') {
      find_options.skip = options.offset;
    }

    if (typeof options?.limit === 'number') {
      find_options.take = options.limit;
    }

    const records = await this.db.find(find_options);
    return records.reduce(
      (acc, record) => {
        const value = this.deserializeValue(record.value) as T;
        acc[record.key] = include_timestamps
          ? {
            value,
            created_at: record.created_at,
            updated_at: record.updated_at,
          }
          : value;
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

    const query_runner = this.data_source.createQueryRunner();
    await query_runner.connect();
    await query_runner.startTransaction();

    try {
      // 使用 VALUES 语法构建批量插入语句
      for (let i = 0; i < entries.length; i += batch_size) {
        const batch = entries.slice(i, i + batch_size);
        const valuePlaceholders: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        batch.forEach(([key, value]) => {
          let serialized_value: string;
          if (this.value_type === 'jsonb') {
            serialized_value = JSON.stringify(value);
          } else if (this.value_type === 'bytea') {
            const buffer = this.serializeValue(value);
            serialized_value = buffer.toString('hex');
          } else {
            serialized_value = String(value);
          }
          valuePlaceholders.push(`($${paramIndex}, $${paramIndex + 1}, NOW(), NOW())`);
          params.push(key, serialized_value);
          paramIndex += 2;
        });


        await query_runner.query(`
          INSERT INTO "${this.table_name}" (key, value, created_at, updated_at)
          VALUES ${valuePlaceholders.join(',')}
          ON CONFLICT (key)
          DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = EXCLUDED.updated_at
        `, params);
      }

      await query_runner.commitTransaction();
    } catch (error) {
      await query_runner.rollbackTransaction();
      throw error;
    } finally {
      await query_runner.release();
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
   * @param bool_value true 或 false
   * @param first 是否只返回第一条记录
   * @param order_by 排序方式 'ASC' 或 'DESC'
   * @returns 如果 first 为 true 返回单个键或 null，否则返回键数组
   */
  async findBoolValues(
    bool_value: boolean,
    first: boolean = true,
    order_by: 'ASC' | 'DESC' = 'ASC',
  ): Promise<string[] | string | null> {
    this.checkTypeSupport('findBoolValues', ['boolean', 'jsonb']);
    await this.ensureInitialized();

    const query_builder = this.db
      .createQueryBuilder(this.table_name)
      .select([
        `${this.table_name}.key as "key"`,
        `${this.table_name}.value as "value"`,
      ])
      .orderBy('created_at', order_by);

    if (this.value_type === 'jsonb') {
      query_builder.where('value = :value::jsonb', {
        value: JSON.stringify(bool_value),
      });
    } else {
      query_builder.where('value = :value', { value: bool_value });
    }

    if (first) {
      const result = await query_builder.getRawOne();
      return result ? result.key : null;
    }

    const results = await query_builder.getRawMany();
    return results;
  }

  /**
   * 高级 JSON 搜索 - 仅支持 JSONB 类型
   * @param search_options 搜索选项
   */
  /**
   * 高级 JSON 搜索 - 仅支持 JSONB 类型
   * @param search_options 搜索选项
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
   *   text_search: [
   *     { path: 'english_only', text: 'legal document', case_sensitive: false },
   *     { path: 'description', text: 'important', case_sensitive: true }
   *   ],
   *   include_timestamps: true
   * });
   *
   * // 混合搜索
   * await db.searchJson({
   *   contains: { status: 'active' },
   *   text_search: [{ path: 'content', text: 'search term', case_sensitive: false }],
   *   compare: [{ path: 'priority', operator: '>=', value: 5 }],
   *   limit: 20,
   *   include_timestamps: true
   * });
   */
  async searchJson(search_options: {
    contains?: object;
    limit?: number;
    cursor?: string;
    compare?: Array<{
      path: string;
      operator: '>' | '<' | '>=' | '<=' | '=' | '!=';
      value: number | string | Date;
    }>;
    text_search?: Array<{
      path: string;
      text: string;
      case_sensitive?: boolean;
    }>;
    include_timestamps?: boolean;
    order_by?: 'ASC' | 'DESC';
    order_by_field?: 'key' | 'created_at' | 'updated_at';
  }): Promise<{
    data: any[];
    next_cursor: string | null;
  }> {
    this.checkTypeSupport('searchJson', ['jsonb']);
    await this.ensureInitialized();

    const limit = search_options.limit || 100;
    const include_timestamps = search_options.include_timestamps || false;
    const order_by = search_options.order_by || 'ASC';
    const order_by_field = search_options.order_by_field || 'key';

    // 使用原生SQL查询，更直接地访问数据库
    try {
      // 根据是否需要时间戳选择字段
      const select_fields = include_timestamps
        ? 'key, value, created_at, updated_at'
        : 'key, value';

      let query = `SELECT ${select_fields} FROM "${this.table_name}"`;
      const params: any[] = [];
      let param_index = 1;

      // 构建WHERE子句
      const where_conditions: string[] = [];

      // 处理 contains 条件（精确匹配）
      if (search_options.contains) {
        Object.entries(search_options.contains).forEach(([key, value]) => {
          where_conditions.push(`value->>'${key}' = $${param_index}`);
          params.push(String(value));
          param_index++;
        });
      }

      // 处理 compare 条件（比较操作）
      if (search_options.compare) {
        search_options.compare.forEach((condition) => {
          where_conditions.push(
            `value->>'${condition.path}' ${condition.operator} $${param_index}`,
          );
          params.push(String(condition.value));
          param_index++;
        });
      }

      // 处理 text_search 条件（LIKE/ILIKE 搜索）
      if (search_options.text_search) {
        search_options.text_search.forEach((text_condition) => {
          const like_operator = text_condition.case_sensitive
            ? 'LIKE'
            : 'ILIKE';
          where_conditions.push(
            `value->>'${text_condition.path}' ${like_operator} $${param_index}`,
          );
          params.push(`%${text_condition.text}%`);
          param_index++;
        });
      }

      // 处理游标分页
      if (search_options.cursor) {
        if (order_by_field === 'key') {
          where_conditions.push(`key > $${param_index}`);
        } else {
          where_conditions.push(`${order_by_field} > $${param_index}`);
        }
        params.push(search_options.cursor);
        param_index++;
      }

      // 添加WHERE子句（如果有条件）
      if (where_conditions.length > 0) {
        query += ` WHERE ${where_conditions.join(' AND ')}`;
      }

      // 添加排序和分页
      query += ` ORDER BY ${order_by_field} ${order_by} LIMIT ${limit + 1}`;

      const results = await this.db.query(query, params);

      const has_more = results.length > limit;
      const data = results.slice(0, limit);
      const next_cursor =
        has_more && data.length > 0
          ? data[data.length - 1][order_by_field]
          : null;

      // 如果不需要时间戳，移除时间戳字段（保持向后兼容）
      if (!include_timestamps) {
        data.forEach((item: any) => {
          delete item.created_at;
          delete item.updated_at;
        });
      }

      return {
        data,
        next_cursor,
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
   * @param order_by 排序方式
   */
  async findByUpdateTime(
    timestamp: number,
    first: boolean = true,
    type: 'before' | 'after' = 'after',
    order_by: 'ASC' | 'DESC' = 'ASC',
  ): Promise<string[] | string | null> {
    await this.ensureInitialized();

    const operator = type === 'before' ? '<' : '>';

    const query = this.db
      .createQueryBuilder(this.table_name)
      .select([
        `${this.table_name}.key as "key"`,
        `${this.table_name}.value as "value"`,
      ])
      .where(`updated_at ${operator} :timestamp`, {
        timestamp: new Date(timestamp),
      })
      .orderBy('updated_at', order_by);

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
    order_by?: 'ASC' | 'DESC';
    time_column?: 'updated_at' | 'created_at';
    include_timestamps?: boolean;
  }): Promise<
    Array<{
      key: string;
      value: any;
      created_at?: Date;
      updated_at?: Date;
    }>
  > {
    await this.ensureInitialized();
    const time_column = params.time_column || 'updated_at';
    const include_timestamps = params.include_timestamps || false;

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

    const query_builder = this.db
      .createQueryBuilder()
      .select(select_fields)
      .from(this.table_name, this.table_name);

    const operator = (params.type || 'after') === 'before' ? '<' : '>';
    query_builder.where(
      `${this.table_name}.${time_column} ${operator} :timestamp`,
      {
        timestamp: new Date(params.timestamp),
      },
    );

    query_builder.orderBy(
      `${this.table_name}.${time_column}`,
      params.order_by || 'ASC',
    );
    query_builder.limit(params.take || 1);
    try {
      const results = await query_builder.getRawMany();
      return results.map((record) => {
        const result: any = {
          key: record.key,
          value: this.deserializeValue(record.value),
        };

        if (include_timestamps) {
          result.created_at = record.created_at;
          result.updated_at = record.updated_at;
        }

        return result;
      });
    } catch (error) {
      console.error('查询错误:', query_builder.getSql());
      console.error('查询参数:', query_builder.getParameters());
      throw error;
    }
  }

  /**
   * 优化后的 JSON 和时间复合搜索 - 仅支持 JSONB 类型
   */
  async searchJsonByTime(
    search_options: {
      contains?: object;
      equals?: object;
      path?: string;
      value?: any;
    },
    time_options: {
      timestamp: number;
      take?: number;
      type?: 'before' | 'after';
      order_by?: 'ASC' | 'DESC';
      time_column?: 'updated_at' | 'created_at';
      include_timestamps?: boolean;
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
    const time_column = time_options.time_column || 'updated_at';
    const include_timestamps = time_options.include_timestamps || false;

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

    const query_builder = this.db
      .createQueryBuilder()
      .select(select_fields)
      .from(this.table_name, this.table_name);

    const operator = (time_options.type || 'after') === 'before' ? '<' : '>';
    query_builder.where(
      `${this.table_name}.${time_column} ${operator} :timestamp`,
      {
        timestamp: new Date(time_options.timestamp),
      },
    );

    if (search_options.contains) {
      query_builder.andWhere(`${this.table_name}.value @> :contains::jsonb`, {
        contains: JSON.stringify(search_options.contains),
      });
    }

    if (search_options.equals) {
      query_builder.andWhere(`${this.table_name}.value = :equals::jsonb`, {
        equals: JSON.stringify(search_options.equals),
      });
    }

    if (search_options.path && search_options.value !== undefined) {
      query_builder.andWhere(`${this.table_name}.value #>> :path = :value`, {
        path: `{${search_options.path}}`,
        value: String(search_options.value),
      });
    }

    query_builder
      .orderBy(
        `${this.table_name}.${time_column}`,
        time_options.order_by || 'ASC',
      )
      .limit(time_options.take || 1);

    try {
      const results = await query_builder.getRawMany();
      return results.map((record) => {
        const result: any = {
          key: record.key,
          value: this.deserializeValue(record.value),
        };

        if (include_timestamps) {
          result.created_at = record.created_at;
          result.updated_at = record.updated_at;
        }

        return result;
      });
    } catch (error) {
      console.error('Query error:', query_builder.getSql());
      console.error('Query parameters:', query_builder.getParameters());
      throw error;
    }
  }

  /**
   * Saves an array by splitting it into batches - 主要支持 JSONB 类型，其他类型提供基本支持
   * If the key already exists, appends the new items to the existing array unless overwrite is true
   * @param key The base key for the array
   * @param array The array to save
   * @param options Optional configuration including batch_size, force_update_batch_size, and overwrite
   */
  async saveArray(
    key: string,
    array: any[],
    options?: SaveArrayOptions,
  ): Promise<void> {
    let { batch_size = 1000 } = options || {};
    const { force_update_batch_size = false, overwrite = false } =
      options || {};

    // 数组功能主要针对 JSONB 设计，但也支持其他类型的简单数组
    if (this.value_type !== 'jsonb') {
      console.warn(
        `Warning: saveArray is optimized for JSONB type but current type is '${this.value_type}'. Complex array operations may not work as expected.`,
      );
    }

    await this.ensureInitialized();

    // Cache key construction to avoid string concatenation in loops
    const meta_key = `${key}_meta`;
    const existing_meta = await this.get(meta_key);

    // If key exists, append the new items to existing array, unless overwrite is true
    if (existing_meta && existing_meta.batch_count > 0 && !overwrite) {
      const existing_batch_count = existing_meta.batch_count;
      const existing_total_items = existing_meta.total_items;

      // Get stored batch size or use default if not found (for backward compatibility)
      const stored_batch_size = existing_meta.batch_size || 1000;

      // Determine which batch size to use
      let active_batch_size = stored_batch_size;

      // Handle batch size change if requested
      if (force_update_batch_size && 1000 !== stored_batch_size) {
        console.log(`Updating batch size from ${stored_batch_size} to 1000`);
        active_batch_size = 1000;

        // We need to rebalance all batches if the batch size changes
        // This will require a full rebuild - we'll need to get all data,
        // rebatch it, and save it back with the new batch size
        if (existing_total_items > 0) {
          // Get all existing data
          const all_data = await this.getAllArray<any>(key);

          // Delete all existing batch records and metadata
          const keys_to_delete = [meta_key];
          for (let i = 0; i < existing_batch_count; i++) {
            keys_to_delete.push(`${key}_${i}`);
          }
          await this.deleteMany(keys_to_delete);

          // Prepend existing data to the new data being saved
          array = [...all_data, ...array];

          // Continue to the "else" branch which will create a new array
          // with the new batch size
          return this.saveArray(key, array, {
            batch_size: 1000,
            overwrite: true,
          }); // Recursively call with overwrite true for rebatching
        }
      } else if (1000 !== stored_batch_size) {
        console.warn(
          `Warning: Provided batch_size (${1000}) differs from originally stored batch_size (${stored_batch_size}). Using stored value. Set force_update_batch_size=true to change batch size.`,
        );
      }

      // Use the determined batch size
      batch_size = active_batch_size;

      const query_runner = this.data_source.createQueryRunner();
      await query_runner.connect();
      await query_runner.startTransaction();

      try {
        // Get the last batch which might not be full
        const last_batch_key = `${key}_${existing_batch_count - 1}`;
        const last_batch = (await this.get(last_batch_key)) || [];

        // Calculate how many more items can fit in the last batch
        const remaining_space = batch_size - last_batch.length;

        // Prepare all statements before execution for better performance
        const statements: Array<{ query: string; params: any[] }> = [];

        // Items to add to the last batch
        const items_for_last_batch =
          remaining_space > 0 ? array.slice(0, remaining_space) : [];
        // Items for new batches
        const remaining_items =
          remaining_space > 0 ? array.slice(remaining_space) : array;

        // Update the last batch if needed
        if (items_for_last_batch.length > 0) {
          const updated_last_batch = [...last_batch, ...items_for_last_batch];
          const serialized_value =
            this.value_type === 'jsonb'
              ? JSON.stringify(updated_last_batch)
              : String(updated_last_batch);
          statements.push({
            query: `
            UPDATE "${this.table_name}" 
            SET value = $1, updated_at = NOW()
            WHERE key = $2
          `,
            params: [serialized_value, last_batch_key],
          });
        }

        // Create new batches for remaining items
        let new_batches_count = 0;

        // Build bulk insert if possible instead of individual inserts
        if (remaining_items.length > 0) {
          const bulk_values: string[] = [];
          const bulk_params: any[] = [];
          let param_index = 1;

          for (let i = 0; i < remaining_items.length; i += batch_size) {
            const batch_data = remaining_items.slice(i, i + batch_size);
            const batch_key = `${key}_${existing_batch_count + new_batches_count}`;

            bulk_values.push(
              `($${param_index}, $${param_index + 1}, NOW(), NOW())`,
            );
            const serialized_value =
              this.value_type === 'jsonb'
                ? JSON.stringify(batch_data)
                : String(batch_data);
            bulk_params.push(batch_key, serialized_value);
            param_index += 2;
            new_batches_count++;
          }

          if (bulk_values.length > 0) {
            statements.push({
              query: `
              INSERT INTO "${this.table_name
                }" (key, value, created_at, updated_at)
              VALUES ${bulk_values.join(',')}
            `,
              params: bulk_params,
            });
          }
        }

        // Update metadata
        const new_total_items = existing_total_items + array.length;
        const new_batch_count = existing_batch_count + new_batches_count;

        const updated_meta = {
          batch_count: new_batch_count,
          total_items: new_total_items,
          batch_size: batch_size, // Store batch size in metadata
          last_updated: new Date().toISOString(),
        };
        const serialized_meta =
          this.value_type === 'jsonb'
            ? JSON.stringify(updated_meta)
            : // For non-jsonb/bytea types, ensure the value is stringifiable, or throw error
            // If valueType is not jsonb and the value is an object, serialize it as JSON string
            typeof updated_meta === 'object'
              ? JSON.stringify(updated_meta)
              : String(updated_meta); // Stringify primitive types for other types

        statements.push({
          query: `
          INSERT INTO "${this.table_name}" (key, value, created_at, updated_at)
          VALUES ($1, $2, NOW(), NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `,
          params: [meta_key, serialized_meta],
        });

        // Execute all statements in a single transaction
        for (const statement of statements) {
          await query_runner.query(statement.query, statement.params);
        }

        await query_runner.commitTransaction();
      } catch (err) {
        await query_runner.rollbackTransaction();
        console.error('Failed to save array with key:', key, err);
        throw err;
      } finally {
        await query_runner.release();
      }
    } else {
      // If key does not exist or overwrite is true, create a new array
      const query_runner = this.data_source.createQueryRunner();
      await query_runner.connect();
      await query_runner.startTransaction();

      try {
        // Delete all existing batch records and metadata if overwrite is true
        if (overwrite) {
          const keys_to_delete = [meta_key];
          if (existing_meta && existing_meta.batch_count > 0) {
            for (let i = 0; i < existing_meta.batch_count; i++) {
              keys_to_delete.push(`${key}_${i}`);
            }
          }
          if (keys_to_delete.length > 0) {
            await this.deleteMany(keys_to_delete);
          }
        }

        // Create new batches for the array
        const bulk_values: string[] = [];
        const bulk_params: any[] = [];
        let param_index = 1;
        let batch_count = 0;

        for (let i = 0; i < array.length; i += batch_size) {
          const batch_data = array.slice(i, i + batch_size);
          const batch_key = `${key}_${batch_count}`;

          bulk_values.push(
            `($${param_index}, $${param_index + 1}, NOW(), NOW())`,
          );
          const serialized_value =
            this.value_type === 'jsonb'
              ? JSON.stringify(batch_data)
              : String(batch_data);
          bulk_params.push(batch_key, serialized_value);
          param_index += 2;
          batch_count++;
        }

        if (bulk_values.length > 0) {
          await query_runner.query(
            `
            INSERT INTO "${this.table_name}" (key, value, created_at, updated_at)
            VALUES ${bulk_values.join(',')}
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
          `,
            bulk_params,
          );
        }

        // Save metadata
        const meta_data = {
          batch_count: batch_count,
          total_items: array.length,
          batch_size: batch_size, // Store batch size in metadata
          last_updated: new Date().toISOString(),
        };
        const serialized_meta =
          this.value_type === 'jsonb'
            ? JSON.stringify(meta_data)
            : // For non-jsonb/bytea types, ensure the value is stringifiable, or throw error
            // If valueType is not jsonb and the value is an object, serialize it as JSON string
            typeof meta_data === 'object'
              ? JSON.stringify(meta_data)
              : String(meta_data); // Stringify primitive types for other types

        await query_runner.query(
          `
          INSERT INTO "${this.table_name}" (key, value, created_at, updated_at)
          VALUES ($1, $2, NOW(), NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `,
          [meta_key, serialized_meta],
        );

        await query_runner.commitTransaction();
      } catch (err) {
        await query_runner.rollbackTransaction();
        console.error('Failed to save array with key:', key, err);
        throw err;
      } finally {
        await query_runner.release();
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
    const meta_key = `${key}_meta`;
    const meta = await this.get(meta_key);

    if (!meta || !meta.batch_count) {
      return [];
    }

    // Optimize by fetching multiple batches in a single query
    const batch_keys = Array.from(
      { length: meta.batch_count },
      (_, i) => `${key}_${i}`,
    );

    // Use IN clause to fetch all batches at once
    const records = await this.db.find({
      where: { key: In(batch_keys) },
      order: { key: 'ASC' },
    });

    // Map results to a map for faster lookup
    const batch_map = new Map(
      records.map((record) => [record.key, record.value]),
    );

    // Combine all batches in order
    const all_data: T[] = [];
    for (let i = 0; i < meta.batch_count; i++) {
      const batch_key = `${key}_${i}`;
      const batch = batch_map.get(batch_key) || [];
      all_data.push(...batch);
    }

    return all_data;
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
    const meta_key = `${key}_meta`;
    const meta = await this.get(meta_key);

    if (!meta || !meta.batch_count || count <= 0) {
      return [];
    }

    // If count + offset is greater than total items, adjust offset
    if (offset >= meta.total_items) {
      return [];
    }

    // Get batch size from metadata or use default for backward compatibility
    const batch_size = meta.batch_size || 1000;

    // Calculate total items to fetch (count + offset)
    const total_needed = count + offset;

    // If total needed is greater than total items, fetch all and handle offset in memory
    if (total_needed >= meta.total_items) {
      const all_items = await this.getAllArray<T>(key);
      return all_items.slice(
        Math.max(0, all_items.length - total_needed),
        all_items.length - offset,
      );
    }

    // Calculate which batches we need
    let items_needed = total_needed;
    let start_batch = meta.batch_count - 1;

    // Calculate how many batches we need to fetch from the end
    const needed_batches: string[] = [];
    while (items_needed > 0 && start_batch >= 0) {
      needed_batches.push(`${key}_${start_batch}`);
      items_needed -=
        start_batch === meta.batch_count - 1
          ? meta.total_items % batch_size || batch_size
          : batch_size;
      start_batch--;
    }

    // Fetch all needed batches in a single query
    const records = await this.db.find({
      where: { key: In(needed_batches) },
      order: { key: 'DESC' },
    });

    // Process results
    const all_recent_items: T[] = [];
    let remaining_count = total_needed;

    for (const record of records) {
      const batch = record.value || [];

      if (batch.length <= remaining_count) {
        all_recent_items.unshift(...batch);
        remaining_count -= batch.length;
      } else {
        const start_index = batch.length - remaining_count;
        const recent_from_batch = batch.slice(start_index);
        all_recent_items.unshift(...recent_from_batch);
        remaining_count = 0;
      }

      if (remaining_count <= 0) break;
    }

    // Apply offset and return the requested count
    return all_recent_items.slice(
      0,
      Math.max(0, all_recent_items.length - offset),
    );
  }

  /**
   * Retrieves items from a saved array based on index range
   * @param key The base key for the array
   * @param start_index The starting index (inclusive)
   * @param end_index The ending index (exclusive)
   * @returns The items in the specified range
   */
  async getArrayRange<T = any>(
    key: string,
    start_index: number,
    end_index: number,
  ): Promise<T[]> {
    await this.ensureInitialized();

    // Validate inputs
    if (start_index < 0 || end_index <= start_index) {
      return [];
    }

    // Get metadata
    const meta_key = `${key}_meta`;
    const meta = await this.get(meta_key);

    if (!meta || !meta.batch_count) {
      return [];
    }

    // Adjust end index if it exceeds total items
    end_index = Math.min(end_index, meta.total_items);

    if (start_index >= meta.total_items) {
      return [];
    }

    // Get batch size from metadata or use default for backward compatibility
    const batch_size = meta.batch_size || 1000; // Use stored batch size instead of hardcoded value

    // Calculate which batches we need
    const start_batch = Math.floor(start_index / batch_size);
    const end_batch = Math.floor((end_index - 1) / batch_size);

    // Create a list of needed batch keys
    const batch_keys = Array.from(
      { length: end_batch - start_batch + 1 },
      (_, i) => `${key}_${start_batch + i}`,
    );

    // Fetch all needed batches in a single query
    const records = await this.db.find({
      where: { key: In(batch_keys) },
      order: { key: 'ASC' },
    });

    // Map results to a map for faster lookup
    const batch_map = new Map(
      records.map((record) => [record.key, record.value]),
    );

    // Process results
    const result: T[] = [];
    for (let i = start_batch; i <= end_batch; i++) {
      const batch_key = `${key}_${i}`;
      const batch = batch_map.get(batch_key) || [];

      // Calculate start and end positions within this batch
      const batch_start_index = i * batch_size;
      const local_start_index = Math.max(0, start_index - batch_start_index);
      const local_end_index = Math.min(
        batch.length,
        end_index - batch_start_index,
      );

      // Add the relevant portion of this batch to our result
      if (local_start_index < local_end_index) {
        result.push(...batch.slice(local_start_index, local_end_index));
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
      include_timestamps?: boolean;
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

    const { include_timestamps = false } = options || {};

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

    // 使用 ORDER BY RANDOM() 获取随机记录
    const results = await this.db
      .createQueryBuilder(this.table_name)
      .select(select_fields)
      .orderBy('RANDOM()')
      .limit(count)
      .getRawMany();

    return results.map((record) => {
      const result: any = {
        key: record.key,
        value: this.deserializeValue(record.value),
      };

      if (include_timestamps) {
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
    return this.value_type;
  }

  /**
   * 获取表名
   */
  getTableName(): string {
    return this.table_name;
  }

  /**
   * 检查是否支持指定的操作
   */
  isOperationSupported(operation: string): boolean {
    const operation_type_map: Record<string, ValueType[]> = {
      merge: ['jsonb'],
      searchJson: ['jsonb'],
      searchJsonByTime: ['jsonb'],
      findBoolValues: ['boolean', 'jsonb'],
      saveArray: ['jsonb'], // 主要支持，但其他类型也有基本支持
      getAllArray: ['jsonb'], // 主要支持，但其他类型也有基本支持
      getRecentArray: ['jsonb'], // 主要支持，但其他类型也有基本支持
      getArrayRange: ['jsonb'], // 主要支持，但其他类型也有基本支持
    };

    const supported_types = operation_type_map[operation];
    if (!supported_types) {
      return true; // 未列出的操作默认支持所有类型
    }

    return supported_types.includes(this.value_type);
  }
}
