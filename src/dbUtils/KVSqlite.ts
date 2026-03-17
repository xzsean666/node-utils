import 'reflect-metadata';
import { DataSource, EntitySchema, Repository, Table } from 'typeorm';

const SQLITE_SAFE_WRITE_BATCH_SIZE = 400;
const SQLITE_SAFE_IN_BATCH_SIZE = 800;
const SQLITE_BUSY_RETRY_TIMES = 3;
const SQLITE_BUSY_RETRY_DELAY_MS = 100;

// 支持的数据类型枚举
export enum SqliteValueType {
  JSON = 'json',
  TEXT = 'text',
  BLOB = 'blob',
  INTEGER = 'integer',
  REAL = 'real',
  BOOLEAN = 'boolean',
}

interface TypeHandler {
  serialize(value: any): any;
  deserialize(value: any): any;
  column_type: string;
}

interface KVEntity {
  key: string;
  value: any;
  created_at: Date;
  updated_at: Date;
}

interface SqliteRawRecord {
  key: string;
  value: any;
  created_at?: string | Date;
  updated_at?: string | Date;
}

const TYPE_HANDLERS: Record<SqliteValueType, TypeHandler> = {
  [SqliteValueType.JSON]: {
    serialize: (value: any) => JSON.stringify(value, bigintHandler),
    deserialize: (value: any) => (value == null ? null : JSON.parse(value)),
    column_type: 'text',
  },
  [SqliteValueType.TEXT]: {
    serialize: (value: any) => String(value),
    deserialize: (value: any) => value,
    column_type: 'text',
  },
  [SqliteValueType.BLOB]: {
    serialize: (value: any) => {
      if (value instanceof Buffer) return value;
      if (value instanceof Uint8Array) return Buffer.from(value);
      if (typeof value === 'string') return Buffer.from(value, 'utf8');
      throw new Error('BLOB type requires Buffer, Uint8Array, or string');
    },
    deserialize: (value: any) => value,
    column_type: 'blob',
  },
  [SqliteValueType.INTEGER]: {
    serialize: (value: any) => {
      const num = Number(value);
      if (!Number.isInteger(num)) {
        throw new Error('INTEGER type requires integer value');
      }
      return num;
    },
    deserialize: (value: any) => (value == null ? null : Number(value)),
    column_type: 'integer',
  },
  [SqliteValueType.REAL]: {
    serialize: (value: any) => Number(value),
    deserialize: (value: any) => (value == null ? null : Number(value)),
    column_type: 'real',
  },
  [SqliteValueType.BOOLEAN]: {
    serialize: (value: any) => (value ? 1 : 0),
    deserialize: (value: any) => Boolean(value),
    column_type: 'integer',
  },
};

function bigintHandler(_key: string, value: any) {
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

export class SqliteKVDatabase {
  private db!: Repository<KVEntity>;
  private data_source: DataSource;
  private initialized = false;
  private initializing_promise: Promise<void> | null = null;
  private table_name: string;
  private custom_kv_store: EntitySchema<KVEntity>;
  private value_type: SqliteValueType;
  private type_handler: TypeHandler;

  constructor(
    datasource_or_url?: string,
    table_name: string = 'kv_store',
    value_type: SqliteValueType = SqliteValueType.JSON,
  ) {
    this.table_name = table_name;
    this.value_type = value_type;
    this.type_handler = TYPE_HANDLERS[value_type];

    this.custom_kv_store = new EntitySchema<KVEntity>({
      name: table_name,
      columns: {
        key: {
          type: 'varchar',
          length: 255,
          primary: true,
        },
        value: {
          type: this.type_handler.column_type as any,
          nullable: true,
        },
        created_at: {
          type: 'datetime',
          createDate: true,
        },
        updated_at: {
          type: 'datetime',
          updateDate: true,
        },
      },
    });

    this.data_source = new DataSource({
      type: 'sqlite',
      database: datasource_or_url || ':memory:',
      entities: [this.custom_kv_store],
      synchronize: false,
    });
  }

  private async _withRetry<T>(
    operation: () => Promise<T>,
    retries: number = SQLITE_BUSY_RETRY_TIMES,
    delay_ms: number = SQLITE_BUSY_RETRY_DELAY_MS,
  ): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await operation();
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('SQLITE_BUSY') && i < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay_ms));
          continue;
        }
        throw error;
      }
    }

    throw new Error('Operation failed after multiple retries due to SQLITE_BUSY');
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
    if (!value) {
      return new Date(0);
    }
    const normalized_value = value.includes('T')
      ? value
      : `${value.replace(' ', 'T')}Z`;
    return new Date(normalized_value);
  }

  private formatDateForSqlite(date: Date): string {
    return date.toISOString().replace('T', ' ').replace('Z', '');
  }

  private formatRecordValue<T = any>(
    record: SqliteRawRecord,
    include_timestamps: boolean,
  ): T | { value: T; created_at: Date; updated_at: Date } {
    const value = this.type_handler.deserialize(record.value) as T;
    if (!include_timestamps) {
      return value;
    }
    return {
      value,
      created_at: this.normalizeDate(record.created_at),
      updated_at: this.normalizeDate(record.updated_at),
    };
  }

  private async getRawRecordsByKeys(
    keys: string[],
    include_timestamps: boolean,
  ): Promise<SqliteRawRecord[]> {
    const unique_keys = Array.from(new Set(keys));
    if (unique_keys.length === 0) {
      return [];
    }

    const records: SqliteRawRecord[] = [];
    const select_fields = this.buildSelectFields(include_timestamps);
    const chunk_size = SQLITE_SAFE_IN_BATCH_SIZE;

    for (let i = 0; i < unique_keys.length; i += chunk_size) {
      const chunk = unique_keys.slice(i, i + chunk_size);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = await this._withRetry(() =>
        this.data_source.query(
          `SELECT ${select_fields} FROM "${this.table_name}" WHERE "key" IN (${placeholders})`,
          chunk,
        ),
      );
      records.push(...rows);
    }

    return records;
  }

  private async upsertEntries(entries: Array<[string, any]>): Promise<void> {
    const deduped_entries = dedupeEntriesByKey(entries);
    if (deduped_entries.length === 0) {
      return;
    }

    const safe_batch_size = normalizePositiveInteger(
      deduped_entries.length,
      SQLITE_SAFE_WRITE_BATCH_SIZE,
      SQLITE_SAFE_WRITE_BATCH_SIZE,
    );

    for (let i = 0; i < deduped_entries.length; i += safe_batch_size) {
      const batch = deduped_entries.slice(i, i + safe_batch_size);
      const values_sql: string[] = [];
      const params: any[] = [];

      for (const [key, value] of batch) {
        values_sql.push('(?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)');
        params.push(key, this.type_handler.serialize(value));
      }

      await this._withRetry(() =>
        this.data_source.query(
          `
            INSERT INTO "${this.table_name}" ("key", "value", "created_at", "updated_at")
            VALUES ${values_sql.join(', ')}
            ON CONFLICT("key") DO UPDATE SET
              "value" = excluded."value",
              "updated_at" = CURRENT_TIMESTAMP
          `,
          params,
        ),
      );
    }
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
        await this.data_source.query('PRAGMA journal_mode=WAL;');
        await this.data_source.query('PRAGMA busy_timeout=5000;');
      }

      this.db = this.data_source.getRepository(this.custom_kv_store);

      if (this.data_source.options.synchronize) {
        await this.data_source.synchronize();
      } else {
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
                    type: this.type_handler.column_type,
                    isNullable: true,
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

          await query_runner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_created_at" ON "${this.table_name}" ("created_at")`,
          );
          await query_runner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_updated_at" ON "${this.table_name}" ("updated_at")`,
          );
        } finally {
          await query_runner.release();
        }
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

    const rows = await this._withRetry(() =>
      this.data_source.query(
        `SELECT "key", "value", "created_at", "updated_at" FROM "${this.table_name}" WHERE "key" = ? LIMIT 1`,
        [key],
      ),
    );
    const record = rows[0] as SqliteRawRecord | undefined;

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
      return this.type_handler.deserialize(record.value) as T;
    }

    return {
      value: this.type_handler.deserialize(record.value) as T,
      created_at,
      updated_at: this.normalizeDate(record.updated_at),
    };
  }

  async merge(key: string, value: any): Promise<void> {
    await this.ensureInitialized();

    if (this.value_type !== SqliteValueType.JSON) {
      throw new Error(
        `Merge operation is only supported for JSON type, current type is: ${this.value_type}`,
      );
    }

    const existing_value = await this.get(key);
    let merged_value = value;

    if (
      existing_value &&
      typeof existing_value === 'object' &&
      typeof value === 'object' &&
      !Array.isArray(existing_value) &&
      !Array.isArray(value)
    ) {
      merged_value = { ...existing_value, ...value };
    }

    await this.upsertEntries([[key, merged_value]]);
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureInitialized();
    await this._withRetry(() =>
      this.data_source.query(
        `DELETE FROM "${this.table_name}" WHERE "key" = ?`,
        [key],
      ),
    );
    const rows = await this._withRetry(() =>
      this.data_source.query('SELECT changes() AS "count"'),
    );
    return Number((rows[0] as { count?: number | string })?.count || 0) > 0;
  }

  async add(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    try {
      await this._withRetry(() =>
        this.data_source.query(
          `
            INSERT INTO "${this.table_name}" ("key", "value", "created_at", "updated_at")
            VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `,
          [key, this.type_handler.serialize(value)],
        ),
      );
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('UNIQUE constraint failed') ||
        message.includes('SQLITE_CONSTRAINT')
      ) {
        throw new Error(`Key "${key}" already exists`);
      }
      throw error;
    }
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
    created_after?: Date;
    created_before?: Date;
    updated_after?: Date;
    updated_before?: Date;
    offset?: number;
    limit?: number;
  }): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    await this.ensureInitialized();
    const include_timestamps = options?.include_timestamps === true;
    const select_fields = this.buildSelectFields(include_timestamps);
    const where_conditions: string[] = [];
    const params: any[] = [];

    if (options?.created_after) {
      where_conditions.push('"created_at" >= ?');
      params.push(this.formatDateForSqlite(options.created_after));
    }
    if (options?.created_before) {
      where_conditions.push('"created_at" <= ?');
      params.push(this.formatDateForSqlite(options.created_before));
    }
    if (options?.updated_after) {
      where_conditions.push('"updated_at" >= ?');
      params.push(this.formatDateForSqlite(options.updated_after));
    }
    if (options?.updated_before) {
      where_conditions.push('"updated_at" <= ?');
      params.push(this.formatDateForSqlite(options.updated_before));
    }

    let query = `SELECT ${select_fields} FROM "${this.table_name}"`;
    if (where_conditions.length > 0) {
      query += ` WHERE ${where_conditions.join(' AND ')}`;
    }
    query += ' ORDER BY "key" ASC';

    if (typeof options?.limit === 'number' && options.limit > 0) {
      query += ' LIMIT ?';
      params.push(Math.floor(options.limit));
    }
    if (typeof options?.offset === 'number' && options.offset > 0) {
      query += ' OFFSET ?';
      params.push(Math.floor(options.offset));
    }

    const records = (await this._withRetry(() =>
      this.data_source.query(query, params),
    )) as SqliteRawRecord[];

    return records.reduce(
      (acc, record) => {
        acc[record.key] = this.formatRecordValue<T>(record, include_timestamps);
        return acc;
      },
      {} as Record<
        string,
        T | { value: T; created_at: Date; updated_at: Date }
      >,
    );
  }

  async getMany<T = any>(
    keys: string[],
    options?: { include_timestamps?: boolean },
  ): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    await this.ensureInitialized();
    const include_timestamps = options?.include_timestamps === true;
    const unique_keys = Array.from(new Set(keys));

    if (unique_keys.length === 0) {
      return {};
    }

    const records = await this.getRawRecordsByKeys(unique_keys, include_timestamps);
    const record_map = new Map(records.map((record) => [record.key, record]));
    const result: Record<
      string,
      T | { value: T; created_at: Date; updated_at: Date }
    > = {};

    for (const key of unique_keys) {
      const record = record_map.get(key);
      if (!record) {
        continue;
      }
      result[key] = this.formatRecordValue<T>(record, include_timestamps);
    }

    return result;
  }

  async getRecent<T = any>(
    limit: number = 100,
    seconds: number = 0,
    options?: { include_timestamps?: boolean },
  ): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    await this.ensureInitialized();
    const include_timestamps = options?.include_timestamps === true;
    const select_fields = this.buildSelectFields(include_timestamps);
    const params: any[] = [];
    const where_conditions: string[] = [];

    if (seconds > 0) {
      where_conditions.push('"created_at" >= ?');
      params.push(
        this.formatDateForSqlite(new Date(Date.now() - seconds * 1000)),
      );
    }

    let query = `SELECT ${select_fields} FROM "${this.table_name}"`;
    if (where_conditions.length > 0) {
      query += ` WHERE ${where_conditions.join(' AND ')}`;
    }
    query += ' ORDER BY "created_at" DESC';
    query += ' LIMIT ?';
    params.push(normalizePositiveInteger(limit, 100, Number.MAX_SAFE_INTEGER));

    const records = (await this._withRetry(() =>
      this.data_source.query(query, params),
    )) as SqliteRawRecord[];

    return records.reduce(
      (acc, record) => {
        acc[record.key] = this.formatRecordValue<T>(record, include_timestamps);
        return acc;
      },
      {} as Record<
        string,
        T | { value: T; created_at: Date; updated_at: Date }
      >,
    );
  }

  async keys(): Promise<string[]> {
    await this.ensureInitialized();
    const records = await this._withRetry(() =>
      this.data_source.query(
        `SELECT "key" FROM "${this.table_name}" ORDER BY "key" ASC`,
      ),
    );
    return (records as Array<{ key: string }>).map((record) => record.key);
  }

  async has(key: string): Promise<boolean> {
    await this.ensureInitialized();
    const rows = await this._withRetry(() =>
      this.data_source.query(
        `SELECT 1 AS "exists" FROM "${this.table_name}" WHERE "key" = ? LIMIT 1`,
        [key],
      ),
    );
    return rows.length > 0;
  }

  async putMany(
    entries: Array<[string, any]>,
    batch_size: number = SQLITE_SAFE_WRITE_BATCH_SIZE,
  ): Promise<void> {
    await this.ensureInitialized();
    const safe_batch_size = normalizePositiveInteger(
      batch_size,
      SQLITE_SAFE_WRITE_BATCH_SIZE,
      SQLITE_SAFE_WRITE_BATCH_SIZE,
    );
    const deduped_entries = dedupeEntriesByKey(entries);

    for (let i = 0; i < deduped_entries.length; i += safe_batch_size) {
      await this.upsertEntries(deduped_entries.slice(i, i + safe_batch_size));
    }
  }

  async deleteMany(keys: string[]): Promise<number> {
    await this.ensureInitialized();
    const unique_keys = Array.from(new Set(keys));
    if (unique_keys.length === 0) {
      return 0;
    }

    let deleted_count = 0;
    for (let i = 0; i < unique_keys.length; i += SQLITE_SAFE_IN_BATCH_SIZE) {
      const chunk = unique_keys.slice(i, i + SQLITE_SAFE_IN_BATCH_SIZE);
      const placeholders = chunk.map(() => '?').join(', ');
      await this._withRetry(() =>
        this.data_source.query(
          `DELETE FROM "${this.table_name}" WHERE "key" IN (${placeholders})`,
          chunk,
        ),
      );
      const rows = await this._withRetry(() =>
        this.data_source.query('SELECT changes() AS "count"'),
      );
      deleted_count += Number(
        (rows[0] as { count?: number | string })?.count || 0,
      );
    }

    return deleted_count;
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    await this._withRetry(() =>
      this.data_source.query(`DELETE FROM "${this.table_name}"`),
    );
  }

  async count(): Promise<number> {
    await this.ensureInitialized();
    const rows = await this._withRetry(() =>
      this.data_source.query(
        `SELECT COUNT(*) AS "count" FROM "${this.table_name}"`,
      ),
    );
    return Number((rows[0] as { count: number | string }).count || 0);
  }

  async findByValue(value: any, exact: boolean = true): Promise<string[]> {
    await this.ensureInitialized();

    if (!exact) {
      if (
        this.value_type !== SqliteValueType.TEXT &&
        this.value_type !== SqliteValueType.JSON
      ) {
        throw new Error(`Fuzzy search not supported for ${this.value_type} type`);
      }

      const rows = await this._withRetry(() =>
        this.data_source.query(
          `SELECT "key" FROM "${this.table_name}" WHERE "value" LIKE ? ORDER BY "key" ASC`,
          [`%${this.type_handler.serialize(value)}%`],
        ),
      );
      return (rows as Array<{ key: string }>).map((record) => record.key);
    }

    const rows = await this._withRetry(() =>
      this.data_source.query(
        `SELECT "key" FROM "${this.table_name}" WHERE "value" = ? ORDER BY "key" ASC`,
        [this.type_handler.serialize(value)],
      ),
    );
    return (rows as Array<{ key: string }>).map((record) => record.key);
  }

  async findByCondition(
    condition: (value: any) => boolean,
  ): Promise<Map<string, any>> {
    await this.ensureInitialized();
    const rows = (await this._withRetry(() =>
      this.data_source.query(
        `SELECT "key", "value" FROM "${this.table_name}" ORDER BY "key" ASC`,
      ),
    )) as Array<{ key: string; value: any }>;

    const result = new Map<string, any>();
    for (const record of rows) {
      const deserialized = this.type_handler.deserialize(record.value);
      if (condition(deserialized)) {
        result.set(record.key, deserialized);
      }
    }

    return result;
  }

  getValueType(): SqliteValueType {
    return this.value_type;
  }

  getTypeInfo(): { value_type: SqliteValueType; column_type: string } {
    return {
      value_type: this.value_type,
      column_type: this.type_handler.column_type,
    };
  }

  async getWithPrefix<T = any>(
    prefix: string,
    options?: {
      limit?: number;
      offset?: number;
      order_by?: 'ASC' | 'DESC';
      include_timestamps?: boolean;
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
    const params: any[] = [prefix, `${prefix}${String.fromCharCode(255)}`];
    const select_fields = this.buildSelectFields(include_timestamps);
    let query = `
      SELECT ${select_fields}
      FROM "${this.table_name}"
      WHERE "key" >= ? AND "key" < ?
      ORDER BY "key" ${order_by}
    `;

    if (typeof options?.limit === 'number' && options.limit > 0) {
      query += ' LIMIT ?';
      params.push(Math.floor(options.limit));
    }
    if (typeof options?.offset === 'number' && options.offset > 0) {
      query += ' OFFSET ?';
      params.push(Math.floor(options.offset));
    }

    const rows = (await this._withRetry(() =>
      this.data_source.query(query, params),
    )) as SqliteRawRecord[];

    return rows.reduce(
      (acc, record) => {
        acc[record.key] = this.formatRecordValue<T>(record, include_timestamps);
        return acc;
      },
      {} as Record<
        string,
        T | { value: T; created_at: Date; updated_at: Date }
      >,
    );
  }
}
