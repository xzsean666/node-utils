import 'reflect-metadata';
import {
  DataSource,
  EntitySchema,
  QueryRunner,
  Repository,
  Table,
} from 'typeorm';

const POSTGRES_SAFE_WRITE_BATCH_SIZE = 5000;
const POSTGRES_SAFE_IN_BATCH_SIZE = 10000;
const DEFAULT_ARRAY_BATCH_SIZE = 1000;

export type ValueType =
  | 'jsonb'
  | 'varchar'
  | 'text'
  | 'integer'
  | 'boolean'
  | 'float'
  | 'bytea';

export type PostgreSQLValueType = ValueType;

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

interface PgRawRecord {
  key: string;
  value: any;
  created_at?: string | Date;
  updated_at?: string | Date;
}

interface ArrayMeta {
  batch_count: number;
  total_items: number;
  batch_size: number;
  last_updated: string;
}

function bigintJsonReplacer(_key: string, value: any) {
  return typeof value === 'bigint' ? value.toString() : value;
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), max);
}

function dedupeEntriesByKey(entries: Array<[string, any]>): Array<[string, any]> {
  const deduped = new Map<string, any>();
  for (const [key, value] of entries) {
    deduped.set(key, value);
  }
  return Array.from(deduped.entries());
}

export class PGKVDatabase {
  db!: Repository<KVEntity>;
  private data_source: DataSource;
  private initialized = false;
  private initializing_promise: Promise<void> | null = null;
  private table_name: string;
  private value_type: ValueType;
  private custom_kv_store: EntitySchema<KVEntity>;

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

    this.custom_kv_store = new EntitySchema<KVEntity>({
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

    this.data_source = new DataSource({
      type: 'postgres',
      url: datasource_or_url,
      entities: [this.custom_kv_store],
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
      logging: ['error'],
    });
  }

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

  private checkTypeSupport(
    operation: string,
    supported_types: ValueType[],
  ): void {
    if (!supported_types.includes(this.value_type)) {
      throw new Error(
        `Operation '${operation}' is not supported for value type '${this.value_type}'. Supported types: ${supported_types.join(', ')}`,
      );
    }
  }

  private serializeValue(value: any): any {
    if (this.value_type === 'jsonb') {
      return value;
    }
    if (this.value_type === 'bytea') {
      if (Buffer.isBuffer(value)) {
        return value;
      }
      if (typeof value === 'string') {
        return Buffer.from(value, 'utf8');
      }
      if (value instanceof Uint8Array) {
        return Buffer.from(value);
      }
      return Buffer.from(JSON.stringify(value, bigintJsonReplacer), 'utf8');
    }
    return value;
  }

  private serializeValueForWrite(value: any): any {
    if (this.value_type === 'jsonb') {
      return JSON.stringify(value, bigintJsonReplacer);
    }
    return this.serializeValue(value);
  }

  private deserializeValue(value: any): any {
    if (this.value_type === 'bytea' && Buffer.isBuffer(value)) {
      return value;
    }
    return value;
  }

  private serializeStructuredValue(value: any): any {
    const serialized = JSON.stringify(value, bigintJsonReplacer);
    if (this.value_type === 'jsonb') {
      return serialized;
    }
    if (this.value_type === 'bytea') {
      return Buffer.from(serialized, 'utf8');
    }
    return serialized;
  }

  private deserializeStructuredValue<T>(value: any): T | null {
    if (value == null) {
      return null;
    }
    if (this.value_type === 'jsonb') {
      return value as T;
    }
    if (Buffer.isBuffer(value)) {
      return JSON.parse(value.toString('utf8')) as T;
    }
    if (typeof value === 'string') {
      return JSON.parse(value) as T;
    }
    return value as T;
  }

  private buildSelectFields(include_timestamps: boolean): string {
    const fields = ['"key"', '"value"'];
    if (include_timestamps) {
      fields.push('"created_at"', '"updated_at"');
    }
    return fields.join(', ');
  }

  private normalizeDate(value: string | Date | undefined): Date {
    if (value instanceof Date) {
      return value;
    }
    return new Date(value || 0);
  }

  private formatRecordValue<T = any>(
    record: PgRawRecord,
    include_timestamps: boolean,
  ): T | { value: T; created_at: Date; updated_at: Date } {
    const value = this.deserializeValue(record.value) as T;
    if (!include_timestamps) {
      return value;
    }
    return {
      value,
      created_at: this.normalizeDate(record.created_at),
      updated_at: this.normalizeDate(record.updated_at),
    };
  }

  private mapRawRecord<T = any>(
    record: PgRawRecord,
    include_timestamps: boolean,
  ): {
    key: string;
    value: T;
    created_at?: Date;
    updated_at?: Date;
  } {
    const mapped: {
      key: string;
      value: T;
      created_at?: Date;
      updated_at?: Date;
    } = {
      key: record.key,
      value: this.deserializeValue(record.value) as T,
    };

    if (include_timestamps) {
      mapped.created_at = this.normalizeDate(record.created_at);
      mapped.updated_at = this.normalizeDate(record.updated_at);
    }

    return mapped;
  }

  private mapRawRecordsToObject<T = any>(
    records: PgRawRecord[],
    include_timestamps: boolean,
    ordered_keys?: string[],
  ): Record<string, T | { value: T; created_at: Date; updated_at: Date }> {
    const record_map = new Map(records.map((record) => [record.key, record]));
    const iteration_keys = ordered_keys || Array.from(record_map.keys());
    const result: Record<
      string,
      T | { value: T; created_at: Date; updated_at: Date }
    > = {};

    for (const key of iteration_keys) {
      const record = record_map.get(key);
      if (!record) {
        continue;
      }
      result[key] = this.formatRecordValue<T>(record, include_timestamps);
    }

    return result;
  }

  private getQueryExecutor(query_runner?: QueryRunner): {
    query: (query: string, parameters?: any[]) => Promise<any>;
  } {
    return query_runner || this.data_source;
  }

  private normalizeJsonPath(path: string): string[] {
    const trimmed = path.trim();
    if (!trimmed) {
      throw new Error('JSON path cannot be empty');
    }

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    }

    return trimmed
      .replace(/\[(\d+)\]/g, '.$1')
      .split('.')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  private buildJsonExtractTextSql(
    column_sql: string,
    path: string,
    params: any[],
  ): string {
    params.push(this.normalizeJsonPath(path));
    return `${column_sql} #>> $${params.length}::text[]`;
  }

  private buildJsonExtractSql(
    column_sql: string,
    path: string,
    params: any[],
  ): string {
    params.push(this.normalizeJsonPath(path));
    return `${column_sql} #> $${params.length}::text[]`;
  }

  private buildValueEqualsSql(column_sql: string, value: any, params: any[]): string {
    if (this.value_type === 'jsonb') {
      params.push(this.serializeValueForWrite(value));
      return `${column_sql} = $${params.length}::jsonb`;
    }

    params.push(this.serializeValue(value));
    return `${column_sql} = $${params.length}`;
  }

  private formatCursorValue(value: unknown): string | null {
    if (value == null) {
      return null;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return String(value);
  }

  private async getRawRecordsByKeys(
    keys: string[],
    include_timestamps: boolean,
    query_runner?: QueryRunner,
  ): Promise<PgRawRecord[]> {
    const unique_keys = Array.from(new Set(keys));
    if (unique_keys.length === 0) {
      return [];
    }

    const records: PgRawRecord[] = [];
    const executor = this.getQueryExecutor(query_runner);
    const select_fields = this.buildSelectFields(include_timestamps);

    for (let i = 0; i < unique_keys.length; i += POSTGRES_SAFE_IN_BATCH_SIZE) {
      const chunk = unique_keys.slice(i, i + POSTGRES_SAFE_IN_BATCH_SIZE);
      const rows = (await executor.query(
        `SELECT ${select_fields} FROM "${this.table_name}" WHERE "key" = ANY($1::varchar[])`,
        [chunk],
      )) as PgRawRecord[];
      records.push(...rows);
    }

    return records;
  }

  private async getRawRecordByKey(
    key: string,
    include_timestamps: boolean,
    query_runner?: QueryRunner,
  ): Promise<PgRawRecord | null> {
    const executor = this.getQueryExecutor(query_runner);
    const rows = (await executor.query(
      `SELECT ${this.buildSelectFields(include_timestamps)} FROM "${this.table_name}" WHERE "key" = $1 LIMIT 1`,
      [key],
    )) as PgRawRecord[];

    return rows[0] || null;
  }

  private async upsertSerializedEntries(
    entries: Array<[string, any]>,
    query_runner?: QueryRunner,
    batch_size: number = POSTGRES_SAFE_WRITE_BATCH_SIZE,
  ): Promise<void> {
    const deduped_entries = dedupeEntriesByKey(entries);
    if (deduped_entries.length === 0) {
      return;
    }

    const safe_batch_size = normalizePositiveInteger(
      batch_size,
      POSTGRES_SAFE_WRITE_BATCH_SIZE,
      POSTGRES_SAFE_WRITE_BATCH_SIZE,
    );
    const executor = this.getQueryExecutor(query_runner);

    for (let i = 0; i < deduped_entries.length; i += safe_batch_size) {
      const chunk = deduped_entries.slice(i, i + safe_batch_size);
      const values_sql: string[] = [];
      const params: any[] = [];

      for (const [key, serialized_value] of chunk) {
        const key_index = params.length + 1;
        params.push(key);
        const value_index = params.length + 1;
        params.push(serialized_value);
        const value_placeholder =
          this.value_type === 'jsonb'
            ? `$${value_index}::jsonb`
            : `$${value_index}`;
        values_sql.push(
          `($${key_index}, ${value_placeholder}, NOW(), NOW())`,
        );
      }

      await executor.query(
        `
          INSERT INTO "${this.table_name}" ("key", "value", "created_at", "updated_at")
          VALUES ${values_sql.join(', ')}
          ON CONFLICT ("key") DO UPDATE SET
            "value" = EXCLUDED."value",
            "updated_at" = NOW()
        `,
        params,
      );
    }
  }

  private async upsertEntries(
    entries: Array<[string, any]>,
    query_runner?: QueryRunner,
    batch_size: number = POSTGRES_SAFE_WRITE_BATCH_SIZE,
  ): Promise<void> {
    await this.upsertSerializedEntries(
      entries.map(([key, value]) => [key, this.serializeValueForWrite(value)]),
      query_runner,
      batch_size,
    );
  }

  private async deleteKeys(
    keys: string[],
    query_runner?: QueryRunner,
  ): Promise<number> {
    const unique_keys = Array.from(new Set(keys));
    if (unique_keys.length === 0) {
      return 0;
    }

    let deleted_count = 0;
    const executor = this.getQueryExecutor(query_runner);

    for (let i = 0; i < unique_keys.length; i += POSTGRES_SAFE_IN_BATCH_SIZE) {
      const chunk = unique_keys.slice(i, i + POSTGRES_SAFE_IN_BATCH_SIZE);
      const rows = await executor.query(
        `
          WITH deleted AS (
            DELETE FROM "${this.table_name}"
            WHERE "key" = ANY($1::varchar[])
            RETURNING 1
          )
          SELECT COUNT(*)::int AS count FROM deleted
        `,
        [chunk],
      );
      deleted_count += Number((rows[0] as { count?: number | string })?.count || 0);
    }

    return deleted_count;
  }

  private async getStructuredValue<T>(
    key: string,
    query_runner?: QueryRunner,
  ): Promise<T | null> {
    const record = await this.getRawRecordByKey(key, false, query_runner);
    if (!record) {
      return null;
    }
    return this.deserializeStructuredValue<T>(record.value);
  }

  private async getArrayMeta(
    key: string,
    query_runner?: QueryRunner,
  ): Promise<ArrayMeta | null> {
    return this.getStructuredValue<ArrayMeta>(`${key}_meta`, query_runner);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized && this.data_source.isInitialized) {
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
            true,
          );
        }

        await query_runner.query(
          `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_created_at" ON "${this.table_name}" ("created_at")`,
        );
        await query_runner.query(
          `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_updated_at" ON "${this.table_name}" ("updated_at")`,
        );

        if (this.value_type === 'jsonb') {
          await query_runner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_value_gin" ON "${this.table_name}" USING gin ("value")`,
          );
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
                  result := jsonb_set(result, ARRAY[key], jsonb_deep_merge(result->key, value));
                ELSE
                  result := jsonb_set(result, ARRAY[key], value);
                END IF;
              END LOOP;
              RETURN result;
            END;
            $$ LANGUAGE plpgsql;
          `);
        } else {
          await query_runner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_value_btree" ON "${this.table_name}" ("value")`,
          );
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

    const result = await this.data_source.query(
      `
        INSERT INTO "${this.table_name}" ("key", "value", "created_at", "updated_at")
        VALUES ($1, $2::jsonb, NOW(), NOW())
        ON CONFLICT ("key") DO UPDATE SET
          "value" = CASE
            WHEN "${this.table_name}"."value" IS NULL THEN $2::jsonb
            ELSE jsonb_deep_merge("${this.table_name}"."value", $2::jsonb)
          END,
          "updated_at" = NOW()
        RETURNING "key"
      `,
      [key, this.serializeValueForWrite(partial_value)],
    );

    return result.length > 0;
  }

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

    const record = await this.getRawRecordByKey(key, true);
    if (!record) {
      return null;
    }

    let expire: number | undefined;
    let include_timestamps = false;

    if (typeof options_or_expire === 'number') {
      expire = options_or_expire;
    } else if (options_or_expire) {
      expire = options_or_expire.expire;
      include_timestamps = options_or_expire.include_timestamps === true;
    }

    const created_at = this.normalizeDate(record.created_at);
    if (
      expire !== undefined &&
      Math.floor(Date.now() / 1000) - Math.floor(created_at.getTime() / 1000) >
        expire
    ) {
      await this.delete(key);
      return null;
    }

    if (!include_timestamps) {
      return this.deserializeValue(record.value) as T;
    }

    return {
      value: this.deserializeValue(record.value) as T,
      created_at,
      updated_at: this.normalizeDate(record.updated_at),
    };
  }

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

    const include_timestamps = options?.include_timestamps === true;
    const order_by = options?.order_by === 'DESC' ? 'DESC' : 'ASC';
    const case_sensitive = options?.case_sensitive !== false;
    const params: any[] = [prefix, `${prefix}\xFF`];
    const where_conditions = ['"key" >= $1', '"key" < $2'];

    if (options?.contains) {
      params.push(`%${options.contains}%`);
      where_conditions.push(
        `"key" ${case_sensitive ? 'LIKE' : 'ILIKE'} $${params.length}`,
      );
    }

    if (
      typeof options?.created_at_after === 'number' &&
      !Number.isNaN(options.created_at_after)
    ) {
      params.push(new Date(options.created_at_after));
      where_conditions.push(`"created_at" > $${params.length}`);
    }

    if (
      typeof options?.created_at_before === 'number' &&
      !Number.isNaN(options.created_at_before)
    ) {
      params.push(new Date(options.created_at_before));
      where_conditions.push(`"created_at" < $${params.length}`);
    }

    let query = `
      SELECT ${this.buildSelectFields(include_timestamps)}
      FROM "${this.table_name}"
      WHERE ${where_conditions.join(' AND ')}
      ORDER BY "key" ${order_by}
    `;

    if (typeof options?.limit === 'number' && options.limit > 0) {
      params.push(Math.floor(options.limit));
      query += ` LIMIT $${params.length}`;
    }

    if (typeof options?.offset === 'number' && options.offset > 0) {
      params.push(Math.floor(options.offset));
      query += ` OFFSET $${params.length}`;
    }

    const records = (await this.data_source.query(query, params)) as PgRawRecord[];
    return this.mapRawRecordsToObject<T>(records, include_timestamps);
  }

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

    const include_timestamps = options?.include_timestamps === true;
    const order_by = options?.order_by === 'DESC' ? 'DESC' : 'ASC';
    const like_operator = options?.case_sensitive === false ? 'ILIKE' : 'LIKE';
    const params: any[] = [`%${substring}%`];
    let query = `
      SELECT ${this.buildSelectFields(include_timestamps)}
      FROM "${this.table_name}"
      WHERE "key" ${like_operator} $1
      ORDER BY "key" ${order_by}
    `;

    if (typeof options?.limit === 'number' && options.limit > 0) {
      params.push(Math.floor(options.limit));
      query += ` LIMIT $${params.length}`;
    }

    if (typeof options?.offset === 'number' && options.offset > 0) {
      params.push(Math.floor(options.offset));
      query += ` OFFSET $${params.length}`;
    }

    const records = (await this.data_source.query(query, params)) as PgRawRecord[];
    return this.mapRawRecordsToObject<T>(records, include_timestamps);
  }

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

    const include_timestamps = options?.include_timestamps === true;
    const order_by = options?.order_by === 'DESC' ? 'DESC' : 'ASC';
    const like_operator = options?.case_sensitive === false ? 'ILIKE' : 'LIKE';
    const params: any[] = [`%${suffix}`];
    let query = `
      SELECT ${this.buildSelectFields(include_timestamps)}
      FROM "${this.table_name}"
      WHERE "key" ${like_operator} $1
      ORDER BY "key" ${order_by}
    `;

    if (typeof options?.limit === 'number' && options.limit > 0) {
      params.push(Math.floor(options.limit));
      query += ` LIMIT $${params.length}`;
    }

    if (typeof options?.offset === 'number' && options.offset > 0) {
      params.push(Math.floor(options.offset));
      query += ` OFFSET $${params.length}`;
    }

    const records = (await this.data_source.query(query, params)) as PgRawRecord[];
    return this.mapRawRecordsToObject<T>(records, include_timestamps);
  }

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

    const reversed_suffix = suffix.split('').reverse().join('');
    const reverse_prefix = `reverse:${reversed_suffix}`;
    const reverse_results = await this.getWithPrefix<{
      original_key: string;
      value: T;
    }>(reverse_prefix, options);

    const reverse_values = Object.values(reverse_results).map((entry) => {
      if (entry && typeof entry === 'object' && 'value' in (entry as any)) {
        return (entry as any).value as { original_key: string; value: T };
      }
      return entry as { original_key: string; value: T };
    });

    if (reverse_values.length === 0) {
      return {};
    }

    return this.getMany<T>(reverse_values.map((item) => item.original_key));
  }

  async isValueExists(value: any): Promise<boolean> {
    await this.ensureInitialized();
    const params: any[] = [];
    const where_sql = this.buildValueEqualsSql('"value"', value, params);
    const rows = await this.data_source.query(
      `SELECT 1 FROM "${this.table_name}" WHERE ${where_sql} LIMIT 1`,
      params,
    );
    return rows.length > 0;
  }

  async getValues(value: any): Promise<any> {
    await this.ensureInitialized();
    const params: any[] = [];
    const where_sql = this.buildValueEqualsSql('"value"', value, params);
    const records = (await this.data_source.query(
      `
        SELECT "key", "value", "created_at", "updated_at"
        FROM "${this.table_name}"
        WHERE ${where_sql}
        ORDER BY "key" ASC
      `,
      params,
    )) as PgRawRecord[];

    return records.map((record) => this.mapRawRecord(record, true));
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureInitialized();
    const rows = await this.data_source.query(
      `DELETE FROM "${this.table_name}" WHERE "key" = $1 RETURNING "key"`,
      [key],
    );
    return rows.length > 0;
  }

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
    const unique_keys = Array.from(new Set(keys));
    const records = await this.getRawRecordsByKeys(unique_keys, include_timestamps);
    return this.mapRawRecordsToObject<T>(records, include_timestamps, unique_keys);
  }

  async add(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    try {
      await this.data_source.query(
        `
          INSERT INTO "${this.table_name}" ("key", "value", "created_at", "updated_at")
          VALUES ($1, ${this.value_type === 'jsonb' ? '$2::jsonb' : '$2'}, NOW(), NOW())
        `,
        [key, this.serializeValueForWrite(value)],
      );
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new Error(`Key "${key}" already exists`);
      }
      throw error;
    }
  }

  async addUniquePair(key: string, value: any): Promise<void> {
    await this.ensureInitialized();

    const params: any[] = [key];
    const value_where_sql = this.buildValueEqualsSql('"value"', value, params);
    const existing = await this.data_source.query(
      `SELECT 1 FROM "${this.table_name}" WHERE "key" = $1 AND ${value_where_sql} LIMIT 1`,
      params,
    );

    if (existing.length > 0) {
      throw new Error(`Key-value pair already exists for key "${key}"`);
    }

    await this.upsertEntries([[key, value]]);
  }

  async addUniqueValue(key: string, value: any): Promise<void> {
    await this.ensureInitialized();

    const params: any[] = [];
    const value_where_sql = this.buildValueEqualsSql('"value"', value, params);
    const existing = await this.data_source.query(
      `SELECT "key" FROM "${this.table_name}" WHERE ${value_where_sql} LIMIT 1`,
      params,
    );

    if (existing.length > 0) {
      throw new Error(`Value already exists with key "${existing[0].key}"`);
    }

    await this.upsertEntries([[key, value]]);
  }

  async close(): Promise<void> {
    if (this.data_source.isInitialized) {
      await this.data_source.destroy();
    }
    this.initialized = false;
    this.initializing_promise = null;
  }

  async getAll<T = any>(options?: {
    include_timestamps?: boolean;
    offset?: number;
    limit?: number;
  }): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    await this.ensureInitialized();
    const include_timestamps = options?.include_timestamps === true;
    const params: any[] = [];
    let query = `
      SELECT ${this.buildSelectFields(include_timestamps)}
      FROM "${this.table_name}"
      ORDER BY "key" ASC
    `;

    if (typeof options?.limit === 'number' && options.limit > 0) {
      params.push(Math.floor(options.limit));
      query += ` LIMIT $${params.length}`;
    }

    if (typeof options?.offset === 'number' && options.offset > 0) {
      params.push(Math.floor(options.offset));
      query += ` OFFSET $${params.length}`;
    }

    const records = (await this.data_source.query(query, params)) as PgRawRecord[];
    return this.mapRawRecordsToObject<T>(records, include_timestamps);
  }

  async keys(): Promise<string[]> {
    await this.ensureInitialized();
    const rows = await this.data_source.query(
      `SELECT "key" FROM "${this.table_name}" ORDER BY "key" ASC`,
    );
    return (rows as Array<{ key: string }>).map((record) => record.key);
  }

  async has(key: string): Promise<boolean> {
    await this.ensureInitialized();
    const rows = await this.data_source.query(
      `SELECT 1 FROM "${this.table_name}" WHERE "key" = $1 LIMIT 1`,
      [key],
    );
    return rows.length > 0;
  }

  async putMany(
    entries: Array<[string, any]>,
    batch_size: number = POSTGRES_SAFE_WRITE_BATCH_SIZE,
  ): Promise<void> {
    await this.ensureInitialized();
    const safe_batch_size = normalizePositiveInteger(
      batch_size,
      POSTGRES_SAFE_WRITE_BATCH_SIZE,
      POSTGRES_SAFE_WRITE_BATCH_SIZE,
    );

    const query_runner = this.data_source.createQueryRunner();
    await query_runner.connect();
    await query_runner.startTransaction();

    try {
      await this.upsertEntries(dedupeEntriesByKey(entries), query_runner, safe_batch_size);
      await query_runner.commitTransaction();
    } catch (error) {
      await query_runner.rollbackTransaction();
      throw error;
    } finally {
      await query_runner.release();
    }
  }

  async deleteMany(keys: string[]): Promise<number> {
    await this.ensureInitialized();

    const query_runner = this.data_source.createQueryRunner();
    await query_runner.connect();
    await query_runner.startTransaction();

    try {
      const deleted = await this.deleteKeys(keys, query_runner);
      await query_runner.commitTransaction();
      return deleted;
    } catch (error) {
      await query_runner.rollbackTransaction();
      throw error;
    } finally {
      await query_runner.release();
    }
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    await this.data_source.query(`TRUNCATE TABLE "${this.table_name}"`);
  }

  async count(): Promise<number> {
    await this.ensureInitialized();
    const rows = await this.data_source.query(
      `SELECT COUNT(*) AS "count" FROM "${this.table_name}"`,
    );
    return Number((rows[0] as { count?: number | string })?.count || 0);
  }

  async findBoolValues(
    bool_value: boolean,
    first: boolean = true,
    order_by: 'ASC' | 'DESC' = 'ASC',
  ): Promise<string[] | string | null> {
    this.checkTypeSupport('findBoolValues', ['boolean', 'jsonb']);
    await this.ensureInitialized();

    const params: any[] = [];
    const where_sql = this.buildValueEqualsSql('"value"', bool_value, params);
    const rows = await this.data_source.query(
      `
        SELECT "key"
        FROM "${this.table_name}"
        WHERE ${where_sql}
        ORDER BY "created_at" ${order_by}
        ${first ? 'LIMIT 1' : ''}
      `,
      params,
    );

    if (first) {
      return rows.length > 0 ? rows[0].key : null;
    }

    return (rows as Array<{ key: string }>).map((record) => record.key);
  }

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

    const limit = normalizePositiveInteger(search_options.limit, 100, 1000);
    const include_timestamps = search_options.include_timestamps === true;
    const order_by = search_options.order_by === 'DESC' ? 'DESC' : 'ASC';
    const order_by_field = search_options.order_by_field || 'key';
    const order_column =
      order_by_field === 'key'
        ? '"key"'
        : order_by_field === 'created_at'
          ? '"created_at"'
          : '"updated_at"';

    const params: any[] = [];
    const where_conditions: string[] = [];

    if (search_options.contains) {
      params.push(JSON.stringify(search_options.contains, bigintJsonReplacer));
      where_conditions.push(`"value" @> $${params.length}::jsonb`);
    }

    if (search_options.compare) {
      for (const condition of search_options.compare) {
        const extract_sql = this.buildJsonExtractTextSql('"value"', condition.path, params);
        if (typeof condition.value === 'number') {
          params.push(condition.value);
          where_conditions.push(
            `NULLIF(${extract_sql}, '')::numeric ${condition.operator} $${params.length}`,
          );
          continue;
        }

        if (condition.value instanceof Date) {
          params.push(condition.value.toISOString());
          where_conditions.push(
            `NULLIF(${extract_sql}, '')::timestamptz ${condition.operator} $${params.length}::timestamptz`,
          );
          continue;
        }

        params.push(String(condition.value));
        where_conditions.push(`${extract_sql} ${condition.operator} $${params.length}`);
      }
    }

    if (search_options.text_search) {
      for (const condition of search_options.text_search) {
        const extract_sql = this.buildJsonExtractTextSql('"value"', condition.path, params);
        params.push(`%${condition.text}%`);
        where_conditions.push(
          `${extract_sql} ${condition.case_sensitive ? 'LIKE' : 'ILIKE'} $${params.length}`,
        );
      }
    }

    if (search_options.cursor) {
      const operator = order_by === 'ASC' ? '>' : '<';
      if (order_by_field === 'key') {
        params.push(search_options.cursor);
        where_conditions.push(`${order_column} ${operator} $${params.length}`);
      } else {
        params.push(new Date(search_options.cursor));
        where_conditions.push(`${order_column} ${operator} $${params.length}::timestamptz`);
      }
    }

    let query = `
      SELECT ${this.buildSelectFields(include_timestamps)}
      FROM "${this.table_name}"
    `;

    if (where_conditions.length > 0) {
      query += ` WHERE ${where_conditions.join(' AND ')}`;
    }

    query += `
      ORDER BY ${order_column} ${order_by}
      LIMIT ${limit + 1}
    `;

    const records = (await this.data_source.query(query, params)) as PgRawRecord[];
    const has_more = records.length > limit;
    const page_records = has_more ? records.slice(0, limit) : records;
    const data = page_records.map((record) => this.mapRawRecord(record, include_timestamps));
    const last_record = page_records[page_records.length - 1];

    return {
      data,
      next_cursor:
        has_more && last_record
          ? this.formatCursorValue(
              order_by_field === 'key'
                ? last_record.key
                : order_by_field === 'created_at'
                  ? this.normalizeDate(last_record.created_at)
                  : this.normalizeDate(last_record.updated_at),
            )
          : null,
    };
  }

  async findByUpdateTime(
    timestamp: number,
    first: boolean = true,
    type: 'before' | 'after' = 'after',
    order_by: 'ASC' | 'DESC' = 'ASC',
  ): Promise<string[] | string | null> {
    await this.ensureInitialized();

    const operator = type === 'before' ? '<' : '>';
    const rows = await this.data_source.query(
      `
        SELECT "key"
        FROM "${this.table_name}"
        WHERE "updated_at" ${operator} $1
        ORDER BY "updated_at" ${order_by}
        ${first ? 'LIMIT 1' : ''}
      `,
      [new Date(timestamp)],
    );

    if (first) {
      return rows.length > 0 ? rows[0].key : null;
    }

    return (rows as Array<{ key: string }>).map((record) => record.key);
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

    const include_timestamps = params.include_timestamps === true;
    const time_column = params.time_column || 'updated_at';
    const operator = (params.type || 'after') === 'before' ? '<' : '>';
    const take = normalizePositiveInteger(params.take, 1, 1000);

    const records = (await this.data_source.query(
      `
        SELECT ${this.buildSelectFields(include_timestamps)}
        FROM "${this.table_name}"
        WHERE "${time_column}" ${operator} $1
        ORDER BY "${time_column}" ${params.order_by === 'DESC' ? 'DESC' : 'ASC'}
        LIMIT $2
      `,
      [new Date(params.timestamp), take],
    )) as PgRawRecord[];

    return records.map((record) => this.mapRawRecord(record, include_timestamps));
  }

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

    const include_timestamps = time_options.include_timestamps === true;
    const time_column = time_options.time_column || 'updated_at';
    const operator = (time_options.type || 'after') === 'before' ? '<' : '>';
    const take = normalizePositiveInteger(time_options.take, 1, 1000);
    const params: any[] = [new Date(time_options.timestamp)];
    const where_conditions = [`"${time_column}" ${operator} $1`];

    if (search_options.contains) {
      params.push(JSON.stringify(search_options.contains, bigintJsonReplacer));
      where_conditions.push(`"value" @> $${params.length}::jsonb`);
    }

    if (search_options.equals) {
      params.push(JSON.stringify(search_options.equals, bigintJsonReplacer));
      where_conditions.push(`"value" = $${params.length}::jsonb`);
    }

    if (search_options.path && search_options.value !== undefined) {
      const extract_sql = this.buildJsonExtractTextSql('"value"', search_options.path, params);
      params.push(String(search_options.value));
      where_conditions.push(`${extract_sql} = $${params.length}`);
    }

    params.push(take);
    const records = (await this.data_source.query(
      `
        SELECT ${this.buildSelectFields(include_timestamps)}
        FROM "${this.table_name}"
        WHERE ${where_conditions.join(' AND ')}
        ORDER BY "${time_column}" ${time_options.order_by === 'DESC' ? 'DESC' : 'ASC'}
        LIMIT $${params.length}
      `,
      params,
    )) as PgRawRecord[];

    return records.map((record) => this.mapRawRecord(record, include_timestamps));
  }

  async saveArray(
    key: string,
    array: any[],
    options?: SaveArrayOptions,
  ): Promise<void> {
    let batch_size = normalizePositiveInteger(
      options?.batch_size,
      DEFAULT_ARRAY_BATCH_SIZE,
      POSTGRES_SAFE_WRITE_BATCH_SIZE,
    );
    const force_update_batch_size = options?.force_update_batch_size === true;
    const overwrite = options?.overwrite === true;

    if (this.value_type !== 'jsonb') {
      console.warn(
        `Warning: saveArray is optimized for JSONB type but current type is '${this.value_type}'.`,
      );
    }

    await this.ensureInitialized();

    const meta_key = `${key}_meta`;
    const existing_meta = await this.getArrayMeta(key);

    if (existing_meta && existing_meta.batch_count > 0 && !overwrite) {
      const stored_batch_size = normalizePositiveInteger(
        existing_meta.batch_size,
        DEFAULT_ARRAY_BATCH_SIZE,
        POSTGRES_SAFE_WRITE_BATCH_SIZE,
      );

      if (force_update_batch_size && stored_batch_size !== batch_size) {
        const all_data = await this.getAllArray<any>(key);
        return this.saveArray(key, [...all_data, ...array], {
          batch_size,
          overwrite: true,
        });
      }

      batch_size = stored_batch_size;
    }

    const query_runner = this.data_source.createQueryRunner();
    await query_runner.connect();
    await query_runner.startTransaction();

    try {
      const current_meta = await this.getArrayMeta(key, query_runner);

      if (overwrite && current_meta) {
        const keys_to_delete = [meta_key];
        for (let i = 0; i < current_meta.batch_count; i++) {
          keys_to_delete.push(`${key}_${i}`);
        }
        await this.deleteKeys(keys_to_delete, query_runner);
      }

      if (!overwrite && current_meta && current_meta.batch_count > 0) {
        const last_batch_index = current_meta.batch_count - 1;
        const last_batch_key = `${key}_${last_batch_index}`;
        const last_batch =
          (await this.getStructuredValue<any[]>(last_batch_key, query_runner)) || [];
        const remaining_space = Math.max(0, batch_size - last_batch.length);
        const items_for_last_batch = array.slice(0, remaining_space);
        const remaining_items = array.slice(items_for_last_batch.length);

        if (items_for_last_batch.length > 0) {
          await this.upsertSerializedEntries(
            [
              [
                last_batch_key,
                this.serializeStructuredValue([...last_batch, ...items_for_last_batch]),
              ],
            ],
            query_runner,
            1,
          );
        }

        const new_batch_entries: Array<[string, any]> = [];
        let batch_index = current_meta.batch_count;
        for (let i = 0; i < remaining_items.length; i += batch_size) {
          const batch = remaining_items.slice(i, i + batch_size);
          new_batch_entries.push([
            `${key}_${batch_index}`,
            this.serializeStructuredValue(batch),
          ]);
          batch_index += 1;
        }

        if (new_batch_entries.length > 0) {
          await this.upsertSerializedEntries(
            new_batch_entries,
            query_runner,
            batch_size,
          );
        }

        const updated_meta: ArrayMeta = {
          batch_count: current_meta.batch_count + new_batch_entries.length,
          total_items: current_meta.total_items + array.length,
          batch_size,
          last_updated: new Date().toISOString(),
        };

        await this.upsertSerializedEntries(
          [[meta_key, this.serializeStructuredValue(updated_meta)]],
          query_runner,
          1,
        );
      } else {
        const batch_entries: Array<[string, any]> = [];
        for (let i = 0; i < array.length; i += batch_size) {
          const batch = array.slice(i, i + batch_size);
          batch_entries.push([
            `${key}_${batch_entries.length}`,
            this.serializeStructuredValue(batch),
          ]);
        }

        if (batch_entries.length > 0) {
          await this.upsertSerializedEntries(
            batch_entries,
            query_runner,
            batch_size,
          );
        }

        const meta: ArrayMeta = {
          batch_count: batch_entries.length,
          total_items: array.length,
          batch_size,
          last_updated: new Date().toISOString(),
        };

        await this.upsertSerializedEntries(
          [[meta_key, this.serializeStructuredValue(meta)]],
          query_runner,
          1,
        );
      }

      await query_runner.commitTransaction();
    } catch (error) {
      await query_runner.rollbackTransaction();
      throw error;
    } finally {
      await query_runner.release();
    }
  }

  async getAllArray<T = any>(key: string): Promise<T[]> {
    await this.ensureInitialized();

    const meta = await this.getArrayMeta(key);
    if (!meta || meta.batch_count <= 0) {
      return [];
    }

    const batch_keys = Array.from(
      { length: meta.batch_count },
      (_, index) => `${key}_${index}`,
    );
    const records = await this.getRawRecordsByKeys(batch_keys, false);
    const record_map = new Map(records.map((record) => [record.key, record.value]));
    const result: T[] = [];

    for (let i = 0; i < meta.batch_count; i++) {
      const batch = this.deserializeStructuredValue<T[]>(
        record_map.get(`${key}_${i}`),
      );
      if (Array.isArray(batch)) {
        result.push(...batch);
      }
    }

    return result;
  }

  async getRecentArray<T = any>(
    key: string,
    count: number,
    offset: number = 0,
  ): Promise<T[]> {
    await this.ensureInitialized();

    if (count <= 0 || offset < 0) {
      return [];
    }

    const meta = await this.getArrayMeta(key);
    if (!meta || meta.total_items <= 0 || offset >= meta.total_items) {
      return [];
    }

    const end_index = meta.total_items - offset;
    const start_index = Math.max(0, end_index - count);
    return this.getArrayRange<T>(key, start_index, end_index);
  }

  async getArrayRange<T = any>(
    key: string,
    start_index: number,
    end_index: number,
  ): Promise<T[]> {
    await this.ensureInitialized();

    if (start_index < 0 || end_index <= start_index) {
      return [];
    }

    const meta = await this.getArrayMeta(key);
    if (!meta || meta.batch_count <= 0 || start_index >= meta.total_items) {
      return [];
    }

    const batch_size = normalizePositiveInteger(
      meta.batch_size,
      DEFAULT_ARRAY_BATCH_SIZE,
      POSTGRES_SAFE_WRITE_BATCH_SIZE,
    );
    const safe_end_index = Math.min(end_index, meta.total_items);
    const start_batch = Math.floor(start_index / batch_size);
    const end_batch = Math.floor((safe_end_index - 1) / batch_size);
    const batch_keys = Array.from(
      { length: end_batch - start_batch + 1 },
      (_, index) => `${key}_${start_batch + index}`,
    );
    const records = await this.getRawRecordsByKeys(batch_keys, false);
    const record_map = new Map(records.map((record) => [record.key, record.value]));
    const result: T[] = [];

    for (let batch_index = start_batch; batch_index <= end_batch; batch_index++) {
      const batch = this.deserializeStructuredValue<T[]>(
        record_map.get(`${key}_${batch_index}`),
      );

      if (!Array.isArray(batch) || batch.length === 0) {
        continue;
      }

      const batch_start_index = batch_index * batch_size;
      const local_start = Math.max(0, start_index - batch_start_index);
      const local_end = Math.min(batch.length, safe_end_index - batch_start_index);

      if (local_start < local_end) {
        result.push(...batch.slice(local_start, local_end));
      }
    }

    return result;
  }

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

    if (count <= 0) {
      return [];
    }

    const include_timestamps = options?.include_timestamps === true;

    if (count === 1) {
      const total = await this.count();
      if (total <= 0) {
        return [];
      }

      const offset = Math.floor(Math.random() * total);
      const rows = (await this.data_source.query(
        `
          SELECT ${this.buildSelectFields(include_timestamps)}
          FROM "${this.table_name}"
          ORDER BY "key" ASC
          LIMIT 1 OFFSET $1
        `,
        [offset],
      )) as PgRawRecord[];

      return rows.map((record) => this.mapRawRecord(record, include_timestamps));
    }

    const rows = (await this.data_source.query(
      `
        SELECT ${this.buildSelectFields(include_timestamps)}
        FROM "${this.table_name}"
        ORDER BY RANDOM()
        LIMIT $1
      `,
      [count],
    )) as PgRawRecord[];

    return rows.map((record) => this.mapRawRecord(record, include_timestamps));
  }

  getValueType(): ValueType {
    return this.value_type;
  }

  getTableName(): string {
    return this.table_name;
  }

  isOperationSupported(operation: string): boolean {
    const operation_type_map: Record<string, ValueType[]> = {
      merge: ['jsonb'],
      searchJson: ['jsonb'],
      searchJsonByTime: ['jsonb'],
      findBoolValues: ['boolean', 'jsonb'],
      saveArray: ['jsonb'],
      getAllArray: ['jsonb'],
      getRecentArray: ['jsonb'],
      getArrayRange: ['jsonb'],
    };

    const supported_types = operation_type_map[operation];
    if (!supported_types) {
      return true;
    }

    return supported_types.includes(this.value_type);
  }
}
