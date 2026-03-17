import { DataSource, Repository, Table, In, QueryRunner } from 'typeorm';
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
  batch_size?: number;
  force_update_batch_size?: boolean;
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
 *   text_search: [
 *     { path: 'english_only', text: 'legal document', case_sensitive: false }
 *   ],
 *   include_timestamps: true
 * });
 *
 * // 混合搜索条件
 * await jsonbDB.searchJson({
 *   contains: { status: 'active' },
 *   text_search: [{ path: 'content', text: 'search term', case_sensitive: false }],
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
 * const resultWithTimestamp = await jsonbDB.get('user:1', { include_timestamps: true });
 * // 返回: { value: { name: 'John', age: 30 }, created_at: Date, updated_at: Date }
 *
 * // 2. 兼容旧的 expire 参数
 * const result = await jsonbDB.get('user:1', 3600); // 3600秒过期时间
 *
 * // 3. 同时使用过期时间和时间戳选项
 * const resultFull = await jsonbDB.get('user:1', {
 *   expire: 3600,
 *   include_timestamps: true
 * });
 *
 * // 4. 前缀查询时包含时间戳
 * const usersWithTimestamp = await jsonbDB.getWithPrefix('user:', {
 *   include_timestamps: true,
 *   limit: 10
 * });
 * // 返回: [{ key: 'user:1', value: {...}, created_at: Date, updated_at: Date }]
 *
 * // 5. 包含查询时包含时间戳
 * const containsResults = await jsonbDB.getWithContains('user', {
 *   include_timestamps: true,
 *   limit: 5
 * });
 *
 * // 6. 后缀查询时包含时间戳
 * const suffixResults = await jsonbDB.getWithSuffix(':1', {
 *   include_timestamps: true
 * });
 *
 * // 7. 批量获取时包含时间戳
 * const manyResults = await jsonbDB.getMany(['user:1', 'user:2'], {
 *   include_timestamps: true
 * });
 *
 * // 8. 随机数据时包含时间戳
 * const randomResults = await jsonbDB.getRandomData(3, {
 *   include_timestamps: true
 * });
 *
 * // 9. 时间搜索时包含时间戳
 * const timeResults = await jsonbDB.searchByTime({
 *   timestamp: Date.now() - 24 * 60 * 60 * 1000, // 24小时前
 *   type: 'after',
 *   include_timestamps: true,
 *   take: 10
 * });
 *
 * // 10. JSON和时间复合搜索时包含时间戳 (仅JSONB类型)
 * const jsonTimeResults = await jsonbDB.searchJsonByTime(
 *   { contains: { status: 'active' } },
 *   {
 *     timestamp: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7天前
 *     type: 'after',
 *     include_timestamps: true,
 *     take: 20
 *   }
 * );
 */
export class PGKVDatabase {
  private static readonly POSTGRES_SAFE_WRITE_BATCH_SIZE = 5000;
  private static readonly POSTGRES_SAFE_IN_BATCH_SIZE = 10000;
  db: Repository<KVEntity>;
  private data_source: DataSource;
  private initialized = false;
  private initializing_promise: Promise<void> | null = null;
  private table_name: string;
  private value_type: ValueType;
  private custom_kv_store: any;
  private readonly query_alias = 'kv';

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

    @Entity(table_name)
    class CustomKVStore implements KVEntity {
      @PrimaryColumn('varchar', { length: 255 })
      key: string;

      @Column(this.getColumnType(value_type))
      value: any;

      @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
      created_at: Date;

      @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
      updated_at: Date;
    }

    this.custom_kv_store = CustomKVStore;

    this.data_source = new DataSource({
      type: 'postgres',
      url: datasource_or_url,
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
        `Operation '${operation}' is not supported for value type '${
          this.value_type
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

  private serializeValueForWrite(value: any): any {
    if (this.value_type === 'jsonb') {
      return JSON.stringify(value);
    }

    return this.serializeValue(value);
  }

  private normalizeJsonPath(path: string): string[] {
    const segments = path
      .split('.')
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length === 0) {
      throw new Error('JSON path cannot be empty');
    }

    return segments;
  }

  private buildJsonExtractTextSql(
    column_expression: string,
    param_index: number,
  ): string {
    return `jsonb_extract_path_text(${column_expression}, VARIADIC $${param_index}::text[])`;
  }

  private buildJsonExtractSql(
    column_expression: string,
    param_index: number,
  ): string {
    return `jsonb_extract_path(${column_expression}, VARIADIC $${param_index}::text[])`;
  }

  private getSafeWriteBatchSize(batch_size: number): number {
    const normalized_batch_size = this.normalizePositiveInteger(
      batch_size,
      PGKVDatabase.POSTGRES_SAFE_WRITE_BATCH_SIZE,
    );
    return Math.max(
      1,
      Math.min(
        normalized_batch_size,
        PGKVDatabase.POSTGRES_SAFE_WRITE_BATCH_SIZE,
      ),
    );
  }

  private getSafeInBatchSize(batch_size: number): number {
    const normalized_batch_size = this.normalizePositiveInteger(
      batch_size,
      PGKVDatabase.POSTGRES_SAFE_IN_BATCH_SIZE,
    );
    return Math.max(
      1,
      Math.min(
        normalized_batch_size,
        PGKVDatabase.POSTGRES_SAFE_IN_BATCH_SIZE,
      ),
    );
  }

  private normalizePositiveInteger(value: number, fallback: number): number {
    if (!Number.isFinite(value)) {
      return fallback;
    }

    return Math.max(1, Math.floor(value));
  }

  private buildSelectFields(include_timestamps: boolean = false): string[] {
    const alias = this.query_alias;
    const select_fields = [
      `${alias}.key as "key"`,
      `${alias}.value as "value"`,
    ];

    if (include_timestamps) {
      select_fields.push(
        `${alias}.created_at as "created_at"`,
        `${alias}.updated_at as "updated_at"`,
      );
    }

    return select_fields;
  }

  private mapRawRecord<T = any>(
    record: any,
    include_timestamps: boolean = false,
  ): {
    key: string;
    value: T;
    created_at?: Date;
    updated_at?: Date;
  } {
    const result: {
      key: string;
      value: T;
      created_at?: Date;
      updated_at?: Date;
    } = {
      key: record.key,
      value: this.deserializeValue(record.value),
    };

    if (include_timestamps) {
      result.created_at = record.created_at;
      result.updated_at = record.updated_at;
    }

    return result;
  }

  private dedupeEntriesByKey<T>(entries: Array<[string, T]>): Array<[string, T]> {
    const deduped_entries = new Map<string, T>();

    for (const [key, value] of entries) {
      if (deduped_entries.has(key)) {
        deduped_entries.delete(key);
      }
      deduped_entries.set(key, value);
    }

    return Array.from(deduped_entries.entries());
  }

  private async getRawRecordsByKeys(
    keys: string[],
    select_fields: string[],
  ): Promise<any[]> {
    const unique_keys = Array.from(new Set(keys));
    if (unique_keys.length === 0) {
      return [];
    }

    const alias = this.query_alias;
    const effective_batch_size = this.getSafeInBatchSize(unique_keys.length);
    const records: any[] = [];

    for (let i = 0; i < unique_keys.length; i += effective_batch_size) {
      const batch = unique_keys.slice(i, i + effective_batch_size);
      const batch_records = await this.db
        .createQueryBuilder(alias)
        .select(select_fields)
        .where(`${alias}.key IN (:...keys)`, { keys: batch })
        .getRawMany();
      records.push(...batch_records);
    }

    return records;
  }

  private async upsertEntries(
    entries: Array<[string, any]>,
    query_runner?: QueryRunner,
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const serialized_entries = this.dedupeEntriesByKey(entries).map(([key, value]) => [
      key,
      this.serializeValueForWrite(value),
    ]) as Array<[string, any]>;

    await this.upsertSerializedEntries(serialized_entries, query_runner);
  }

  private async upsertSerializedEntries(
    entries: Array<[string, any]>,
    query_runner?: QueryRunner,
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const normalized_entries = this.dedupeEntriesByKey(entries);

    const values_sql: string[] = [];
    const parameters: any[] = [];
    let param_index = 1;

    for (const [key, value] of normalized_entries) {
      values_sql.push(`($${param_index}, $${param_index + 1}, NOW(), NOW())`);
      parameters.push(key, value);
      param_index += 2;
    }

    const executor = query_runner ?? this.data_source;
    await executor.query(
      `
        INSERT INTO "${this.table_name}" (key, value, created_at, updated_at)
        VALUES ${values_sql.join(',')}
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = NOW()
      `,
      parameters,
    );
  }

  private async deleteKeys(
    keys: string[],
    query_runner?: QueryRunner,
  ): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }

    const unique_keys = Array.from(new Set(keys));
    const effective_batch_size = this.getSafeInBatchSize(unique_keys.length);
    let affected = 0;

    for (let i = 0; i < unique_keys.length; i += effective_batch_size) {
      const batch = unique_keys.slice(i, i + effective_batch_size);
      const result = query_runner
        ? await query_runner.manager.delete(this.custom_kv_store, {
            key: In(batch),
          })
        : await this.db.delete({ key: In(batch) });
      affected += result.affected || 0;
    }

    return affected;
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
        }

        // 无论表是否已存在，都确保索引存在
        if (this.value_type === 'jsonb') {
          try {
            await query_runner.query(
              `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_value_gin" ON "${this.table_name}" USING gin (value);`,
            );
          } catch (err) {
            console.warn(`创建索引失败，可能已存在: ${err}`);
          }
        } else {
          try {
            await query_runner.query(
              `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_value_btree" ON "${this.table_name}" (value);`,
            );
          } catch (err) {
            console.warn(`创建索引失败，可能已存在: ${err}`);
          }
        }

        try {
          await query_runner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_created_at" ON "${this.table_name}" ("created_at")`,
          );
          await query_runner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_updated_at" ON "${this.table_name}" ("updated_at")`,
          );
        } catch (err) {
          console.warn(`创建时间索引失败，可能已存在: ${err}`);
        }

        // 只为 JSONB 类型创建 jsonb_deep_merge 函数
        if (this.value_type === 'jsonb') {
          await query_runner.query(`
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
    })();

    try {
      await this.initializing_promise;
    } finally {
      this.initializing_promise = null;
    }
  }

  async put(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    await this.upsertEntries([[key, value]]);
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
    const include_timestamps =
      typeof options_or_expire === 'object' &&
      options_or_expire?.include_timestamps === true;
    const records = await this.getRawRecordsByKeys(
      [key],
      this.buildSelectFields(include_timestamps),
    );
    const record = records[0];

    if (!record) return null;

    // 处理参数类型 - 兼容旧的expire参数和新的options对象
    let expire: number | undefined;
    let should_include_timestamps = include_timestamps;

    if (typeof options_or_expire === 'number') {
      expire = options_or_expire;
    } else if (options_or_expire && typeof options_or_expire === 'object') {
      expire = options_or_expire.expire;
      should_include_timestamps = options_or_expire.include_timestamps || false;
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
    if (should_include_timestamps) {
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
   * @returns 匹配前缀的键值对数组
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
    Array<{
      key: string;
      value: T;
      created_at?: Date;
      updated_at?: Date;
    }>
  > {
    await this.ensureInitialized();
    const alias = this.query_alias;

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

    // 始终使用高效的范围查询 - 充分利用主键的 B-tree 索引
    // key >= 'prefix' AND key < 'prefix' + '\xFF'
    const query_builder = this.db
      .createQueryBuilder(alias)
      .select(this.buildSelectFields(include_timestamps))
      .where(`${alias}.key >= :start_prefix`, {
        start_prefix: prefix,
      })
      .andWhere(`${alias}.key < :end_prefix`, {
        end_prefix: prefix + '\xFF', // 使用 \xFF 作为范围上限
      })
      .orderBy(`${alias}.key`, order_by);

    // 添加时间过滤条件
    if (created_at_after !== undefined) {
      if (!isNaN(created_at_after) && created_at_after > 0) {
        query_builder.andWhere(
          `${alias}.created_at > :created_at_after`,
          {
            created_at_after: new Date(created_at_after),
          },
        );
      }
    }

    if (created_at_before !== undefined) {
      if (!isNaN(created_at_before) && created_at_before > 0) {
        query_builder.andWhere(
          `${alias}.created_at < :created_at_before`,
          {
            created_at_before: new Date(created_at_before),
          },
        );
      }
    }

    if (contains) {
      const like_operator = case_sensitive ? 'LIKE' : 'ILIKE';
      query_builder.andWhere(`${alias}.key ${like_operator} :contains_pattern`, {
        contains_pattern: `%${contains}%`,
      });
    }

    if (limit !== undefined) {
      query_builder.limit(limit);
    }

    if (offset !== undefined) {
      query_builder.offset(offset);
    }

    try {
      const results = await query_builder.getRawMany();
      return results.map((record) =>
        this.mapRawRecord<T>(record, include_timestamps),
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
   * @returns 匹配的键值对数组
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
    Array<{
      key: string;
      value: T;
      created_at?: Date;
      updated_at?: Date;
    }>
  > {
    await this.ensureInitialized();
    const alias = this.query_alias;

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

    const like_operator = case_sensitive ? 'LIKE' : 'ILIKE';
    const query_builder = this.db
      .createQueryBuilder(alias)
      .select(this.buildSelectFields(include_timestamps))
      .where(`${alias}.key ${like_operator} :pattern`, {
        pattern: `%${substring}%`,
      })
      .orderBy(`${alias}.key`, order_by);

    if (limit !== undefined) {
      query_builder.limit(limit);
    }

    if (offset !== undefined) {
      query_builder.offset(offset);
    }

    try {
      const results = await query_builder.getRawMany();
      return results.map((record) =>
        this.mapRawRecord<T>(record, include_timestamps),
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
   * @returns 匹配的键值对数组
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
    Array<{
      key: string;
      value: T;
      created_at?: Date;
      updated_at?: Date;
    }>
  > {
    await this.ensureInitialized();
    const alias = this.query_alias;

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

    const like_operator = case_sensitive ? 'LIKE' : 'ILIKE';
    const query_builder = this.db
      .createQueryBuilder(alias)
      .select(this.buildSelectFields(include_timestamps))
      .where(`${alias}.key ${like_operator} :pattern`, {
        pattern: `%${suffix}`,
      })
      .orderBy(`${alias}.key`, order_by);

    if (limit !== undefined) {
      query_builder.limit(limit);
    }

    if (offset !== undefined) {
      query_builder.offset(offset);
    }

    try {
      const results = await query_builder.getRawMany();
      return results.map((record) =>
        this.mapRawRecord<T>(record, include_timestamps),
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
  ): Promise<Array<{ key: string; value: T }>> {
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
    if (reverse_results.length === 0) {
      return [];
    }

    const original_keys = reverse_results.map((r) => r.value.original_key);
    const original_data = await this.getMany<T>(original_keys);

    return original_data;
  }

  async isValueExists(value: any): Promise<boolean> {
    await this.ensureInitialized();
    const alias = this.query_alias;

    if (this.value_type === 'jsonb') {
      const existing = await this.db
        .createQueryBuilder(alias)
        .select('1', 'exists')
        .where(`${alias}.value = :value::jsonb`, {
          value: JSON.stringify(value),
        })
        .limit(1)
        .getRawOne();
      return !!existing;
    } else if (this.value_type === 'bytea') {
      // 对于 bytea 类型，使用二进制比较
      const serialized_value = this.serializeValue(value);
      const existing = await this.db
        .createQueryBuilder(alias)
        .select('1', 'exists')
        .where(`${alias}.value = :value`, {
          value: serialized_value,
        })
        .limit(1)
        .getRawOne();
      return !!existing;
    } else {
      // 对于非 JSONB 类型，直接比较值
      const existing = await this.db
        .createQueryBuilder(alias)
        .select('1', 'exists')
        .where(`${alias}.value = :value`, {
          value: this.serializeValue(value),
        })
        .limit(1)
        .getRawOne();
      return !!existing;
    }
  }

  async getValues(value: any): Promise<any> {
    await this.ensureInitialized();
    const alias = this.query_alias;
    const query_builder = this.db
      .createQueryBuilder(alias)
      .select(this.buildSelectFields(true));

    if (this.value_type === 'jsonb') {
      query_builder.where(`${alias}.value = :value::jsonb`, {
        value: JSON.stringify(value),
      });
    } else if (this.value_type === 'bytea') {
      query_builder.where(`${alias}.value = :value`, {
        value: this.serializeValue(value),
      });
    } else {
      query_builder.where(`${alias}.value = :value`, {
        value: this.serializeValue(value),
      });
    }

    const records = await query_builder.getRawMany();
    return records.map((record) => this.mapRawRecord(record, true));
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

    const { include_timestamps = false } = options || {};
    const unique_keys = Array.from(new Set(keys));
    const key_order = new Map(
      unique_keys.map((key, index) => [key, index] as const),
    );
    const records = await this.getRawRecordsByKeys(
      unique_keys,
      this.buildSelectFields(include_timestamps),
    );

    records.sort(
      (a, b) => (key_order.get(a.key) ?? 0) - (key_order.get(b.key) ?? 0),
    );

    return records.map((record) =>
      this.mapRawRecord<T>(record, include_timestamps),
    );
  }

  async add(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    try {
      await this.db.insert({
        key,
        value: this.serializeValue(value),
      });
    } catch (error: any) {
      if (error?.code === '23505' || error?.driverError?.code === '23505') {
        throw new Error(`Key "${key}" already exists`);
      }
      throw error;
    }
  }

  async addUniquePair(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    const alias = this.query_alias;

    if (this.value_type === 'jsonb') {
      const existing = await this.db
        .createQueryBuilder(alias)
        .select('1', 'exists')
        .where(`${alias}.key = :key`, { key })
        .andWhere(`${alias}.value = :value::jsonb`, {
          value: JSON.stringify(value),
        })
        .limit(1)
        .getRawOne();

      if (existing) {
        throw new Error(`Key-value pair already exists for key "${key}"`);
      }
    } else if (this.value_type === 'bytea') {
      const existing = await this.db
        .createQueryBuilder(alias)
        .select('1', 'exists')
        .where(`${alias}.key = :key`, { key })
        .andWhere(`${alias}.value = :value`, {
          value: this.serializeValue(value),
        })
        .limit(1)
        .getRawOne();

      if (existing) {
        throw new Error(`Key-value pair already exists for key "${key}"`);
      }
    } else {
      const existing = await this.db
        .createQueryBuilder(alias)
        .select('1', 'exists')
        .where(`${alias}.key = :key`, { key })
        .andWhere(`${alias}.value = :value`, {
          value: this.serializeValue(value),
        })
        .limit(1)
        .getRawOne();

      if (existing) {
        throw new Error(`Key-value pair already exists for key "${key}"`);
      }
    }

    await this.upsertEntries([[key, value]]);
  }

  async addUniqueValue(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    const alias = this.query_alias;

    if (this.value_type === 'jsonb') {
      const existing = await this.db
        .createQueryBuilder(alias)
        .select(`${alias}.key`, 'key')
        .where(`${alias}.value = :value::jsonb`, { value: JSON.stringify(value) })
        .limit(1)
        .getRawOne();

      if (existing) {
        const existing_key = existing.key;
        throw new Error(`Value already exists with key "${existing_key}"`);
      }
    } else if (this.value_type === 'bytea') {
      const existing = await this.db
        .createQueryBuilder(alias)
        .select(`${alias}.key`, 'key')
        .where(`${alias}.value = :value`, {
          value: this.serializeValue(value),
        })
        .limit(1)
        .getRawOne();

      if (existing) {
        const existing_key = existing.key;
        throw new Error(`Value already exists with key "${existing_key}"`);
      }
    } else {
      const existing = await this.db
        .createQueryBuilder(alias)
        .select(`${alias}.key`, 'key')
        .where(`${alias}.value = :value`, {
          value: this.serializeValue(value),
        })
        .limit(1)
        .getRawOne();

      if (existing) {
        const existing_key = existing.key;
        throw new Error(`Value already exists with key "${existing_key}"`);
      }
    }

    await this.upsertEntries([[key, value]]);
  }

  async close(): Promise<void> {
    if (this.data_source?.isInitialized) {
      await this.data_source.destroy();
    }
    this.initialized = false;
    this.initializing_promise = null;
  }

  // 获取所有键值对，支持分页
  async getAll(offset?: number, limit?: number): Promise<Map<string, any>> {
    await this.ensureInitialized();
    const alias = this.query_alias;
    const query_builder = this.db
      .createQueryBuilder(alias)
      .select(this.buildSelectFields())
      .orderBy(`${alias}.key`, 'ASC');

    if (typeof offset === 'number') {
      query_builder.skip(offset);
    }

    if (typeof limit === 'number') {
      query_builder.take(limit);
    }

    const records = await query_builder.getRawMany();
    return new Map(
      records.map((record) => [record.key, this.deserializeValue(record.value)]),
    );
  }

  // 获取所有键
  async keys(): Promise<string[]> {
    await this.ensureInitialized();
    const alias = this.query_alias;
    const records = await this.db
      .createQueryBuilder(alias)
      .select([`${alias}.key as "key"`])
      .orderBy(`${alias}.key`, 'ASC')
      .getRawMany();
    return records.map((record: { key: any }) => record.key);
  }

  // 检查键是否存在
  async has(key: string): Promise<boolean> {
    await this.ensureInitialized();
    const record = await this.db
      .createQueryBuilder(this.query_alias)
      .select('1', 'exists')
      .where(`${this.query_alias}.key = :key`, { key })
      .limit(1)
      .getRawOne();
    return !!record;
  }

  // 批量添加键值对
  async putMany(
    entries: Array<[string, any]>,
    batch_size: number = 1000,
  ): Promise<void> {
    await this.ensureInitialized();
    const normalized_entries = this.dedupeEntriesByKey(entries);
    if (normalized_entries.length === 0) {
      return;
    }

    const effective_batch_size = this.getSafeWriteBatchSize(batch_size);

    const query_runner = this.data_source.createQueryRunner();
    await query_runner.connect();
    await query_runner.startTransaction();

    try {
      for (let i = 0; i < normalized_entries.length; i += effective_batch_size) {
        const batch = normalized_entries.slice(i, i + effective_batch_size);
        await this.upsertEntries(batch, query_runner);
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
    if (keys.length === 0) {
      return 0;
    }
    const query_runner = this.data_source.createQueryRunner();
    await query_runner.connect();
    await query_runner.startTransaction();

    try {
      const affected = await this.deleteKeys(keys, query_runner);
      await query_runner.commitTransaction();
      return affected;
    } catch (error) {
      await query_runner.rollbackTransaction();
      throw error;
    } finally {
      await query_runner.release();
    }
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
    const alias = this.query_alias;

    const query_builder = this.db
      .createQueryBuilder(alias)
      .select(`${alias}.key`, 'key')
      .orderBy(`${alias}.created_at`, order_by);

    if (this.value_type === 'jsonb') {
      query_builder.where(`${alias}.value = :value::jsonb`, {
        value: JSON.stringify(bool_value),
      });
    } else {
      query_builder.where(`${alias}.value = :value`, { value: bool_value });
    }

    if (first) {
      const result = await query_builder.getRawOne();
      return result ? result.key : null;
    }

    const results = await query_builder.getRawMany();
    return results.map((result: { key: string }) => result.key);
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

    const limit = Math.max(1, search_options.limit ?? 100);
    const include_timestamps = search_options.include_timestamps || false;
    const order_by = search_options.order_by === 'DESC' ? 'DESC' : 'ASC';
    const order_by_field =
      search_options.order_by_field === 'created_at' ||
      search_options.order_by_field === 'updated_at'
        ? search_options.order_by_field
        : 'key';

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
      if (
        search_options.contains &&
        Object.keys(search_options.contains).length > 0
      ) {
        where_conditions.push(`value @> $${param_index}::jsonb`);
        params.push(JSON.stringify(search_options.contains));
        param_index++;
      }

      // 处理 compare 条件（比较操作）
      if (search_options.compare) {
        search_options.compare.forEach((condition) => {
          const path_segments = this.normalizeJsonPath(condition.path);
          const extract_json_sql = this.buildJsonExtractSql('value', param_index);
          const extract_sql = this.buildJsonExtractTextSql(
            'value',
            param_index,
          );
          params.push(path_segments);
          param_index++;

          let compare_sql = `${extract_sql} ${condition.operator} $${param_index}`;
          if (
            typeof condition.value === 'number' &&
            Number.isFinite(condition.value)
          ) {
            compare_sql = `jsonb_typeof(${extract_json_sql}) = 'number' AND (${extract_sql})::numeric ${condition.operator} $${param_index}`;
            params.push(condition.value);
          } else if (condition.value instanceof Date) {
            compare_sql = `jsonb_typeof(${extract_json_sql}) = 'string' AND (${extract_sql})::timestamptz ${condition.operator} $${param_index}`;
            params.push(condition.value.toISOString());
          } else {
            params.push(String(condition.value));
          }

          where_conditions.push(compare_sql);
          param_index++;
        });
      }

      // 处理 text_search 条件（LIKE/ILIKE 搜索）
      if (search_options.text_search) {
        search_options.text_search.forEach((text_condition) => {
          const path_segments = this.normalizeJsonPath(text_condition.path);
          const extract_sql = this.buildJsonExtractTextSql(
            'value',
            param_index,
          );
          params.push(path_segments);
          param_index++;
          const like_operator = text_condition.case_sensitive
            ? 'LIKE'
            : 'ILIKE';
          where_conditions.push(
            `COALESCE(${extract_sql}, '') ${like_operator} $${param_index}`,
          );
          params.push(`%${text_condition.text}%`);
          param_index++;
        });
      }

      // 处理游标分页
      if (search_options.cursor) {
        const cursor_operator = order_by === 'DESC' ? '<' : '>';
        if (order_by_field === 'key') {
          where_conditions.push(`key ${cursor_operator} $${param_index}`);
        } else {
          where_conditions.push(
            `${order_by_field} ${cursor_operator} $${param_index}`,
          );
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
    const alias = this.query_alias;

    const operator = type === 'before' ? '<' : '>';

    const query = this.db
      .createQueryBuilder(alias)
      .select(`${alias}.key`, 'key')
      .where(`${alias}.updated_at ${operator} :timestamp`, {
        timestamp: new Date(timestamp),
      })
      .orderBy(`${alias}.updated_at`, order_by);

    if (first) {
      const result = await query.getRawOne();
      return result ? result.key : null;
    }

    const results = await query.getRawMany();
    return results.map((result: { key: string }) => result.key);
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
    const alias = this.query_alias;
    const time_column = params.time_column || 'updated_at';
    const include_timestamps = params.include_timestamps || false;
    const normalized_take =
      params.take === undefined
        ? 1
        : Math.max(0, Math.floor(Number(params.take) || 0));

    if (normalized_take <= 0) {
      return [];
    }

    const query_builder = this.db
      .createQueryBuilder(alias)
      .select(this.buildSelectFields(include_timestamps));

    const operator = (params.type || 'after') === 'before' ? '<' : '>';
    query_builder.where(`${alias}.${time_column} ${operator} :timestamp`, {
      timestamp: new Date(params.timestamp),
    });

    query_builder.orderBy(`${alias}.${time_column}`, params.order_by || 'ASC');
    query_builder.limit(normalized_take);
    try {
      const results = await query_builder.getRawMany();
      return results.map((record) =>
        this.mapRawRecord(record, include_timestamps),
      );
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
    const alias = this.query_alias;
    const time_column = time_options.time_column || 'updated_at';
    const include_timestamps = time_options.include_timestamps || false;
    const normalized_take =
      time_options.take === undefined
        ? 1
        : Math.max(0, Math.floor(Number(time_options.take) || 0));

    if (normalized_take <= 0) {
      return [];
    }

    const query_builder = this.db
      .createQueryBuilder(alias)
      .select(this.buildSelectFields(include_timestamps));

    const operator = (time_options.type || 'after') === 'before' ? '<' : '>';
    query_builder.where(`${alias}.${time_column} ${operator} :timestamp`, {
      timestamp: new Date(time_options.timestamp),
    });

    if (search_options.contains) {
      query_builder.andWhere(`${alias}.value @> :contains::jsonb`, {
        contains: JSON.stringify(search_options.contains),
      });
    }

    if (search_options.equals) {
      query_builder.andWhere(`${alias}.value = :equals::jsonb`, {
        equals: JSON.stringify(search_options.equals),
      });
    }

    if (search_options.path && search_options.value !== undefined) {
      const path_segments = this.normalizeJsonPath(search_options.path);
      query_builder.andWhere(
        `jsonb_extract_path_text(${alias}.value, VARIADIC :path::text[]) = :value`,
        {
          path: path_segments,
          value: String(search_options.value),
        },
      );
    }

    query_builder
      .orderBy(`${alias}.${time_column}`, time_options.order_by || 'ASC')
      .limit(normalized_take);

    try {
      const results = await query_builder.getRawMany();
      return results.map((record) =>
        this.mapRawRecord(record, include_timestamps),
      );
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
    batch_size = this.normalizePositiveInteger(batch_size, 1000);
    const requested_batch_size = batch_size;
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
      const stored_batch_size = this.normalizePositiveInteger(
        existing_meta.batch_size || 1000,
        1000,
      );

      // Determine which batch size to use
      let active_batch_size = stored_batch_size;

      // Handle batch size change if requested
      if (
        force_update_batch_size &&
        requested_batch_size !== stored_batch_size
      ) {
        console.log(
          `Updating batch size from ${stored_batch_size} to ${requested_batch_size}`,
        );
        active_batch_size = requested_batch_size;

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
            batch_size: requested_batch_size,
            overwrite: true,
          }); // Recursively call with overwrite true for rebatching
        }
      } else if (requested_batch_size !== stored_batch_size) {
        console.warn(
          `Warning: Provided batch_size (${requested_batch_size}) differs from originally stored batch_size (${stored_batch_size}). Using stored value. Set force_update_batch_size=true to change batch size.`,
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
        const last_batch_record = await query_runner.manager
          .createQueryBuilder(this.custom_kv_store, this.query_alias)
          .select([`${this.query_alias}.value as "value"`])
          .where(`${this.query_alias}.key = :key`, { key: last_batch_key })
          .getRawOne();
        const last_batch =
          this.deserializeValue(last_batch_record?.value) || [];

        // Calculate how many more items can fit in the last batch
        const remaining_space = batch_size - last_batch.length;

        // Prepare all statements before execution for better performance
        const statements: string[] = [];
        const parameters: any[][] = [];

        // Items to add to the last batch
        const items_for_last_batch =
          remaining_space > 0 ? array.slice(0, remaining_space) : [];
        // Items for new batches
        const remaining_items =
          remaining_space > 0 ? array.slice(remaining_space) : array;

        // Update the last batch if needed
        if (items_for_last_batch.length > 0) {
          const updated_last_batch = [...last_batch, ...items_for_last_batch];
          statements.push(`
            UPDATE "${this.table_name}" 
            SET value = $1, updated_at = NOW()
            WHERE key = $2
          `);
          const serialized_value =
            this.value_type === 'jsonb'
              ? JSON.stringify(updated_last_batch)
              : String(updated_last_batch);
          parameters.push([serialized_value, last_batch_key]);
        }

        // Create new batches for remaining items
        let new_batches_count = 0;
        const new_batch_entries: Array<[string, any]> = [];

        if (remaining_items.length > 0) {
          for (let i = 0; i < remaining_items.length; i += batch_size) {
            const batch_data = remaining_items.slice(i, i + batch_size);
            const batch_key = `${key}_${existing_batch_count + new_batches_count}`;
            const serialized_value =
              this.value_type === 'jsonb'
                ? JSON.stringify(batch_data)
                : String(batch_data);
            new_batch_entries.push([batch_key, serialized_value]);
            new_batches_count++;
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

        // Execute update statements first
        for (let i = 0; i < statements.length; i++) {
          await query_runner.query(statements[i], parameters[i]);
        }

        if (new_batch_entries.length > 0) {
          const insert_batch_size = this.getSafeWriteBatchSize(
            new_batch_entries.length,
          );
          for (let i = 0; i < new_batch_entries.length; i += insert_batch_size) {
            await this.upsertSerializedEntries(
              new_batch_entries.slice(i, i + insert_batch_size),
              query_runner,
            );
          }
        }

        await this.upsertSerializedEntries([[meta_key, serialized_meta]], query_runner);

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
          await this.deleteKeys(keys_to_delete, query_runner);
        }

        // Create new batches for the array
        const new_batch_entries: Array<[string, any]> = [];
        let batch_count = 0;

        for (let i = 0; i < array.length; i += batch_size) {
          const batch_data = array.slice(i, i + batch_size);
          const batch_key = `${key}_${batch_count}`;
          const serialized_value =
            this.value_type === 'jsonb'
              ? JSON.stringify(batch_data)
              : String(batch_data);
          new_batch_entries.push([batch_key, serialized_value]);
          batch_count++;
        }

        if (new_batch_entries.length > 0) {
          const insert_batch_size = this.getSafeWriteBatchSize(
            new_batch_entries.length,
          );
          for (let i = 0; i < new_batch_entries.length; i += insert_batch_size) {
            await this.upsertSerializedEntries(
              new_batch_entries.slice(i, i + insert_batch_size),
              query_runner,
            );
          }
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

        await this.upsertSerializedEntries([[meta_key, serialized_meta]], query_runner);

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

    const batch_count = Math.max(0, Math.floor(Number(meta?.batch_count) || 0));

    if (!meta || batch_count === 0) {
      return [];
    }

    // Optimize by fetching multiple batches in a single query
    const batch_keys = Array.from(
      { length: batch_count },
      (_, i) => `${key}_${i}`,
    );

    // Use IN clause to fetch all batches at once
    const records = await this.getRawRecordsByKeys(batch_keys, [
      `${this.query_alias}.key as "key"`,
      `${this.query_alias}.value as "value"`,
    ]);

    // Map results to a map for faster lookup
    const batch_map = new Map(
      records.map((record) => [record.key, record.value]),
    );

    // Combine all batches in order
    const all_data: T[] = [];
    for (let i = 0; i < batch_count; i++) {
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
    const normalized_count = Math.max(0, Math.floor(Number(count) || 0));
    const normalized_offset = Math.max(0, Math.floor(Number(offset) || 0));

    // Get metadata
    const meta_key = `${key}_meta`;
    const meta = await this.get(meta_key);
    const batch_count = Math.max(0, Math.floor(Number(meta?.batch_count) || 0));
    const total_items = Math.max(0, Math.floor(Number(meta?.total_items) || 0));

    if (!meta || batch_count === 0 || normalized_count <= 0) {
      return [];
    }

    // If count + offset is greater than total items, adjust offset
    if (normalized_offset >= total_items) {
      return [];
    }

    // Get batch size from metadata or use default for backward compatibility
    const batch_size = this.normalizePositiveInteger(meta.batch_size || 1000, 1000);

    // Calculate total items to fetch (count + offset)
    const total_needed = normalized_count + normalized_offset;

    // If total needed is greater than total items, fetch all and handle offset in memory
    if (total_needed >= total_items) {
      const all_items = await this.getAllArray<T>(key);
      return all_items.slice(
        Math.max(0, all_items.length - total_needed),
        all_items.length - normalized_offset,
      );
    }

    // Calculate which batches we need
    let items_needed = total_needed;
    let start_batch = batch_count - 1;

    // Calculate how many batches we need to fetch from the end
    const needed_batches: string[] = [];
    while (items_needed > 0 && start_batch >= 0) {
      needed_batches.push(`${key}_${start_batch}`);
      items_needed -=
        start_batch === batch_count - 1
          ? total_items % batch_size || batch_size
          : batch_size;
      start_batch--;
    }

    // Fetch all needed batches in a single query
    const records = await this.getRawRecordsByKeys(needed_batches, [
      `${this.query_alias}.key as "key"`,
      `${this.query_alias}.value as "value"`,
    ]);

    const batch_map = new Map(records.map((record) => [record.key, record.value]));

    // Process results
    const all_recent_items: T[] = [];
    let remaining_count = total_needed;

    for (let i = batch_count - 1; i >= 0; i--) {
      const batch_key = `${key}_${i}`;
      if (!batch_map.has(batch_key)) {
        continue;
      }

      const batch = batch_map.get(batch_key) || [];

      if (batch.length <= remaining_count) {
        all_recent_items.unshift(...batch);
        remaining_count -= batch.length;
      } else {
        const start_index = batch.length - remaining_count;
        const recent_from_batch = batch.slice(start_index);
        all_recent_items.unshift(...recent_from_batch);
        remaining_count = 0;
      }

      if (remaining_count <= 0) {
        break;
      }
    }

    // Apply offset and return the requested count
    return all_recent_items.slice(
      0,
      Math.max(0, all_recent_items.length - normalized_offset),
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
    const normalized_start_index = Math.max(
      0,
      Math.floor(Number(start_index) || 0),
    );
    let normalized_end_index = Math.max(
      0,
      Math.floor(Number(end_index) || 0),
    );

    // Validate inputs
    if (normalized_end_index <= normalized_start_index) {
      return [];
    }

    // Get metadata
    const meta_key = `${key}_meta`;
    const meta = await this.get(meta_key);

    const batch_count = Math.max(0, Math.floor(Number(meta?.batch_count) || 0));
    const total_items = Math.max(0, Math.floor(Number(meta?.total_items) || 0));

    if (!meta || batch_count === 0) {
      return [];
    }

    // Adjust end index if it exceeds total items
    normalized_end_index = Math.min(normalized_end_index, total_items);

    if (normalized_start_index >= total_items) {
      return [];
    }

    // Get batch size from metadata or use default for backward compatibility
    const batch_size = this.normalizePositiveInteger(
      meta.batch_size || 1000,
      1000,
    );

    // Calculate which batches we need
    const start_batch = Math.floor(normalized_start_index / batch_size);
    const end_batch = Math.floor((normalized_end_index - 1) / batch_size);

    // Create a list of needed batch keys
    const batch_keys = Array.from(
      { length: end_batch - start_batch + 1 },
      (_, i) => `${key}_${start_batch + i}`,
    );

    // Fetch all needed batches in a single query
    const records = await this.getRawRecordsByKeys(batch_keys, [
      `${this.query_alias}.key as "key"`,
      `${this.query_alias}.value as "value"`,
    ]);

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
      const local_start_index = Math.max(
        0,
        normalized_start_index - batch_start_index,
      );
      const local_end_index = Math.min(
        batch.length,
        normalized_end_index - batch_start_index,
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
    const alias = this.query_alias;

    const { include_timestamps = false } = options || {};
    const normalized_count = Math.floor(count);

    if (!Number.isFinite(normalized_count) || normalized_count <= 0) {
      return [];
    }

    if (normalized_count === 1) {
      const total_records = await this.db.count();
      if (total_records <= 0) {
        return [];
      }

      const random_offset =
        total_records === 1 ? 0 : Math.floor(Math.random() * total_records);
      const result = await this.db
        .createQueryBuilder(alias)
        .select(this.buildSelectFields(include_timestamps))
        .orderBy(`${alias}.key`, 'ASC')
        .offset(random_offset)
        .limit(1)
        .getRawMany();

      if (result.length > 0) {
        return result.map((record) =>
          this.mapRawRecord(record, include_timestamps),
        );
      }
    }

    // 使用 ORDER BY RANDOM() 获取随机记录
    const results = await this.db
      .createQueryBuilder(alias)
      .select(this.buildSelectFields(include_timestamps))
      .orderBy('RANDOM()')
      .limit(normalized_count)
      .getRawMany();

    return results.map((record) => this.mapRawRecord(record, include_timestamps));
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
