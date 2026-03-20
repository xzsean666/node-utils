import "reflect-metadata";
import { DataSource, EntitySchema, Repository, Table } from "typeorm";
import type { QueryRunner } from "typeorm";

const SQLITE_SAFE_WRITE_BATCH_SIZE = 400;
const SQLITE_SAFE_IN_BATCH_SIZE = 800;
const SQLITE_BUSY_RETRY_TIMES = 3;
const SQLITE_BUSY_RETRY_DELAY_MS = 100;
const KV_SCAN_PAGE_SIZE = 1000;
const SQLITE_CURRENT_TIMESTAMP_SQL = `STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')`;

// 支持的数据类型枚举
export enum SqliteValueType {
  JSON = "json",
  TEXT = "text",
  BLOB = "blob",
  INTEGER = "integer",
  REAL = "real",
  BOOLEAN = "boolean",
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
  __rowid?: number;
  key: string;
  value: any;
  created_at?: string | Date;
  updated_at?: string | Date;
}

interface KeyScanOptions {
  cursor?: string;
  limit?: number;
  order_by?: "ASC" | "DESC";
  prefix?: string;
}

interface GetOptions {
  expire?: number;
  include_timestamps?: boolean;
}

export interface SqliteKVDatabaseOptions {
  create_created_at_index?: boolean;
  create_updated_at_index?: boolean;
}

interface ResolvedSqliteKVDatabaseOptions {
  create_created_at_index: boolean;
  create_updated_at_index: boolean;
}

function bigintHandler(_key: string, value: any) {
  return typeof value === "bigint" ? value.toString() : value;
}

function normalizeJsonValueForIdentity(value: any): any {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value == null || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return value.toJSON();
  }

  if (Buffer.isBuffer(value)) {
    return value.toJSON();
  }

  if (value instanceof Uint8Array) {
    return Array.from(value);
  }

  if (typeof value.toJSON === "function") {
    return normalizeJsonValueForIdentity(value.toJSON());
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValueForIdentity(item));
  }

  const normalized: Record<string, any> = {};
  for (const key of Object.keys(value).sort()) {
    normalized[key] = normalizeJsonValueForIdentity(value[key]);
  }
  return normalized;
}

function stableJsonStringify(value: any): string | undefined {
  return JSON.stringify(normalizeJsonValueForIdentity(value), bigintHandler);
}

function buildPrefixRangeExclusiveEnd(prefix: string): string | null {
  if (!/^[\x00-\x7F]+$/.test(prefix)) {
    return null;
  }

  const characters = Array.from(prefix);
  for (let i = characters.length - 1; i >= 0; i--) {
    const character = characters[i];
    if (!character) {
      continue;
    }

    const code_point = character.codePointAt(0);
    if (code_point == null || code_point >= 0x7f) {
      continue;
    }

    return (
      characters.slice(0, i).join("") + String.fromCodePoint(code_point + 1)
    );
  }

  return null;
}

const TYPE_HANDLERS: Record<SqliteValueType, TypeHandler> = {
  [SqliteValueType.JSON]: {
    serialize: (value: any) => stableJsonStringify(value),
    deserialize: (value: any) => (value == null ? null : JSON.parse(value)),
    column_type: "text",
  },
  [SqliteValueType.TEXT]: {
    serialize: (value: any) => String(value),
    deserialize: (value: any) => value,
    column_type: "text",
  },
  [SqliteValueType.BLOB]: {
    serialize: (value: any) => {
      if (value instanceof Buffer) return value;
      if (value instanceof Uint8Array) return Buffer.from(value);
      if (typeof value === "string") return Buffer.from(value, "utf8");
      throw new Error("BLOB type requires Buffer, Uint8Array, or string");
    },
    deserialize: (value: any) => value,
    column_type: "blob",
  },
  [SqliteValueType.INTEGER]: {
    serialize: (value: any) => {
      const num = Number(value);
      if (!Number.isInteger(num)) {
        throw new Error("INTEGER type requires integer value");
      }
      return num;
    },
    deserialize: (value: any) => (value == null ? null : Number(value)),
    column_type: "integer",
  },
  [SqliteValueType.REAL]: {
    serialize: (value: any) => Number(value),
    deserialize: (value: any) => (value == null ? null : Number(value)),
    column_type: "real",
  },
  [SqliteValueType.BOOLEAN]: {
    serialize: (value: any) => (value ? 1 : 0),
    deserialize: (value: any) => Boolean(value),
    column_type: "integer",
  },
};

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

function dedupeEntriesByKey(
  entries: Array<[string, any]>,
): Array<[string, any]> {
  const deduped = new Map<string, any>();
  for (const [key, value] of entries) {
    deduped.set(key, value);
  }
  return Array.from(deduped.entries());
}

function assertSafeIdentifier(name: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`${label} must match ^[A-Za-z_][A-Za-z0-9_]*$`);
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function isMergeableJsonObject(value: unknown): value is Record<string, any> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function deepMergeJsonValues(existing_value: any, incoming_value: any): any {
  if (
    !isMergeableJsonObject(existing_value) ||
    !isMergeableJsonObject(incoming_value)
  ) {
    return incoming_value;
  }

  const merged: Record<string, any> = { ...existing_value };

  for (const [key, incoming_child] of Object.entries(incoming_value)) {
    merged[key] =
      key in merged
        ? deepMergeJsonValues(merged[key], incoming_child)
        : incoming_child;
  }

  return merged;
}

function appendSqliteLimitOffset(
  query: string,
  params: any[],
  options?: {
    limit?: number;
    offset?: number;
  },
): string {
  const has_limit = typeof options?.limit === "number" && options.limit > 0;
  const has_offset = typeof options?.offset === "number" && options.offset > 0;

  if (has_limit) {
    query += " LIMIT ?";
    params.push(Math.floor(options!.limit!));
  } else if (has_offset) {
    query += " LIMIT -1";
  }

  if (has_offset) {
    query += " OFFSET ?";
    params.push(Math.floor(options!.offset!));
  }

  return query;
}

export class SqliteKVDatabase {
  private db!: Repository<KVEntity>;
  private data_source: DataSource;
  private initialized = false;
  private initializing_promise: Promise<void> | null = null;
  private write_lock: Promise<void> = Promise.resolve();
  private readonly options: ResolvedSqliteKVDatabaseOptions;
  private table_name: string;
  private custom_kv_store: EntitySchema<KVEntity>;
  private value_type: SqliteValueType;
  private type_handler: TypeHandler;

  constructor(
    datasource_or_url?: string,
    table_name: string = "kv_store",
    value_type: SqliteValueType = SqliteValueType.JSON,
    options?: SqliteKVDatabaseOptions,
  ) {
    assertSafeIdentifier(table_name, "table_name");
    this.table_name = table_name;
    this.value_type = value_type;
    this.type_handler = TYPE_HANDLERS[value_type];
    this.options = {
      create_created_at_index: options?.create_created_at_index !== false,
      create_updated_at_index: options?.create_updated_at_index !== false,
    };

    this.custom_kv_store = new EntitySchema<KVEntity>({
      name: table_name,
      columns: {
        key: {
          type: "varchar",
          length: 255,
          primary: true,
        },
        value: {
          type: this.type_handler.column_type as any,
          nullable: true,
        },
        created_at: {
          type: "datetime",
          createDate: true,
        },
        updated_at: {
          type: "datetime",
          updateDate: true,
        },
      },
    });

    this.data_source = new DataSource({
      type: "sqlite",
      database: datasource_or_url || ":memory:",
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
        if (message.includes("SQLITE_BUSY") && i < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay_ms));
          continue;
        }
        throw error;
      }
    }

    throw new Error(
      "Operation failed after multiple retries due to SQLITE_BUSY",
    );
  }

  private buildSelectFields(include_timestamps: boolean): string {
    const fields = ['"key"', '"value"'];
    if (include_timestamps) {
      fields.push('"created_at"', '"updated_at"');
    }
    return fields.join(", ");
  }

  private normalizeDate(value: string | Date | undefined): Date {
    if (value instanceof Date) {
      return value;
    }
    if (!value) {
      return new Date(0);
    }
    const normalized_value = value.includes("T")
      ? value
      : `${value.replace(" ", "T")}Z`;
    return new Date(normalized_value);
  }

  private formatDateForSqlite(date: Date): string {
    return date.toISOString().replace("T", " ").replace("Z", "");
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

  private async executeQuery<T = any>(
    query: string,
    params: any[] = [],
    query_runner?: QueryRunner,
  ): Promise<T> {
    if (query_runner) {
      return (await query_runner.query(query, params)) as T;
    }

    return (await this._withRetry(() =>
      this.data_source.query(query, params),
    )) as T;
  }

  private async withTransaction<T>(
    operation: (query_runner: QueryRunner) => Promise<T>,
  ): Promise<T> {
    const query_runner = this.data_source.createQueryRunner();
    await query_runner.connect();
    await query_runner.startTransaction();

    try {
      const result = await operation(query_runner);
      await query_runner.commitTransaction();
      return result;
    } catch (error) {
      await query_runner.rollbackTransaction();
      throw error;
    } finally {
      await query_runner.release();
    }
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous_lock = this.write_lock;
    let release_lock!: () => void;

    this.write_lock = new Promise<void>((resolve) => {
      release_lock = resolve;
    });

    await previous_lock;

    try {
      return await operation();
    } finally {
      release_lock();
    }
  }

  private async getRawRecordsByKeys(
    keys: string[],
    include_timestamps: boolean,
    query_runner?: QueryRunner,
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
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = await this.executeQuery<SqliteRawRecord[]>(
        `SELECT ${select_fields} FROM "${this.table_name}" WHERE "key" IN (${placeholders})`,
        chunk,
        query_runner,
      );
      records.push(...rows);
    }

    return records;
  }

  private async getRawRecordByKey(
    key: string,
    query_runner?: QueryRunner,
  ): Promise<SqliteRawRecord | null> {
    const rows = await this.executeQuery<SqliteRawRecord[]>(
      `SELECT rowid AS "__rowid", "key", "value", "created_at", "updated_at" FROM "${this.table_name}" WHERE "key" = ? LIMIT 1`,
      [key],
      query_runner,
    );
    return rows[0] || null;
  }

  private async deleteRecordIfCurrent(
    record: SqliteRawRecord,
    query_runner?: QueryRunner,
  ): Promise<boolean> {
    if (record.__rowid == null || record.updated_at == null) {
      return false;
    }

    await this.executeQuery(
      `DELETE FROM "${this.table_name}" WHERE rowid = ? AND "updated_at" = ?`,
      [record.__rowid, record.updated_at],
      query_runner,
    );

    const rows = await this.executeQuery<Array<{ count?: number | string }>>(
      `SELECT changes() AS "count"`,
      [],
      query_runner,
    );

    return Number((rows[0] as { count?: number | string })?.count || 0) > 0;
  }

  private async upsertEntries(
    entries: Array<[string, any]>,
    query_runner?: QueryRunner,
    dedupe_entries: boolean = true,
  ): Promise<void> {
    const entries_to_write = dedupe_entries
      ? dedupeEntriesByKey(entries)
      : entries;
    if (entries_to_write.length === 0) {
      return;
    }

    const safe_batch_size = normalizePositiveInteger(
      entries_to_write.length,
      SQLITE_SAFE_WRITE_BATCH_SIZE,
      SQLITE_SAFE_WRITE_BATCH_SIZE,
    );

    for (let i = 0; i < entries_to_write.length; i += safe_batch_size) {
      const batch = entries_to_write.slice(i, i + safe_batch_size);
      const values_sql: string[] = [];
      const params: any[] = [];

      for (const [key, value] of batch) {
        values_sql.push(
          `(?, ?, ${SQLITE_CURRENT_TIMESTAMP_SQL}, ${SQLITE_CURRENT_TIMESTAMP_SQL})`,
        );
        params.push(key, this.type_handler.serialize(value));
      }

      await this.executeQuery(
        `
          INSERT INTO "${this.table_name}" ("key", "value", "created_at", "updated_at")
          VALUES ${values_sql.join(", ")}
          ON CONFLICT("key") DO UPDATE SET
            "value" = excluded."value",
            "updated_at" = ${SQLITE_CURRENT_TIMESTAMP_SQL}
        `,
        params,
        query_runner,
      );
    }
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

    for (let i = 0; i < unique_keys.length; i += SQLITE_SAFE_IN_BATCH_SIZE) {
      const chunk = unique_keys.slice(i, i + SQLITE_SAFE_IN_BATCH_SIZE);
      const placeholders = chunk.map(() => "?").join(", ");
      await this.executeQuery(
        `DELETE FROM "${this.table_name}" WHERE "key" IN (${placeholders})`,
        chunk,
        query_runner,
      );
      const rows = await this.executeQuery<Array<{ count?: number | string }>>(
        `SELECT changes() AS "count"`,
        [],
        query_runner,
      );
      deleted_count += Number(
        (rows[0] as { count?: number | string })?.count || 0,
      );
    }

    return deleted_count;
  }

  private resolveGetOptions(
    options_or_expire?: number | GetOptions,
  ): Required<Pick<GetOptions, "include_timestamps">> &
    Pick<GetOptions, "expire"> {
    if (typeof options_or_expire === "number") {
      return {
        expire: options_or_expire,
        include_timestamps: false,
      };
    }

    return {
      expire: options_or_expire?.expire,
      include_timestamps: options_or_expire?.include_timestamps === true,
    };
  }

  private isExpired(created_at: Date, expire?: number): boolean {
    return (
      expire !== undefined &&
      Math.floor(Date.now() / 1000) - Math.floor(created_at.getTime() / 1000) >
        expire
    );
  }

  private serializedValuesEqual(left: any, right: any): boolean {
    if (Buffer.isBuffer(left) || left instanceof Uint8Array) {
      const right_buffer =
        Buffer.isBuffer(right) || right instanceof Uint8Array
          ? Buffer.from(right)
          : null;
      return right_buffer ? Buffer.from(left).equals(right_buffer) : false;
    }

    if (Buffer.isBuffer(right) || right instanceof Uint8Array) {
      return false;
    }

    return left === right;
  }

  private async putValueIfChanged(
    key: string,
    value: any,
    query_runner?: QueryRunner,
  ): Promise<boolean> {
    const existing_record = await this.getRawRecordByKey(key, query_runner);
    const serialized_value = this.type_handler.serialize(value);

    if (
      existing_record &&
      this.serializedValuesEqual(existing_record.value, serialized_value)
    ) {
      return false;
    }

    await this.upsertEntries([[key, value]], query_runner);
    return true;
  }

  private async getInternal<T = any>(
    key: string,
    options_or_expire?: number | GetOptions,
    delete_expired: boolean = true,
  ): Promise<T | { value: T; created_at: Date; updated_at: Date } | null> {
    await this.ensureInitialized();

    const record = await this.getRawRecordByKey(key);
    if (!record) {
      return null;
    }

    const { expire, include_timestamps } =
      this.resolveGetOptions(options_or_expire);
    const created_at = this.normalizeDate(record.created_at);

    if (this.isExpired(created_at, expire)) {
      if (delete_expired) {
        await this.withWriteLock(() => this.deleteRecordIfCurrent(record));
      }
      return null;
    }

    const deserialized_value = this.type_handler.deserialize(record.value) as T;

    if (!include_timestamps) {
      return deserialized_value;
    }

    return {
      value: deserialized_value,
      created_at,
      updated_at: this.normalizeDate(record.updated_at),
    };
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
        await this.data_source.query("PRAGMA journal_mode=WAL;");
        await this.data_source.query("PRAGMA busy_timeout=5000;");
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
                    name: "key",
                    type: "varchar",
                    length: "255",
                    isPrimary: true,
                  },
                  {
                    name: "value",
                    type: this.type_handler.column_type,
                    isNullable: true,
                  },
                  {
                    name: "created_at",
                    type: "datetime",
                    default: SQLITE_CURRENT_TIMESTAMP_SQL,
                  },
                  {
                    name: "updated_at",
                    type: "datetime",
                    default: SQLITE_CURRENT_TIMESTAMP_SQL,
                  },
                ],
              }),
            );
          }

          if (this.options.create_created_at_index) {
            await query_runner.query(
              `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_created_at" ON "${this.table_name}" ("created_at")`,
            );
          }
          if (this.options.create_updated_at_index) {
            await query_runner.query(
              `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_updated_at" ON "${this.table_name}" ("updated_at")`,
            );
          }
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
    await this.withWriteLock(() => this.upsertEntries([[key, value]]));
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
    return this.getInternal<T>(key, options_or_expire, true);
  }

  async getIfFresh<T = any>(key: string, expire: number): Promise<T | null>;
  async getIfFresh<T = any>(
    key: string,
    options: {
      expire: number;
      include_timestamps?: boolean;
    },
  ): Promise<T | { value: T; created_at: Date; updated_at: Date } | null>;
  async getIfFresh<T = any>(
    key: string,
    options_or_expire:
      | number
      | {
          expire: number;
          include_timestamps?: boolean;
        },
  ): Promise<T | { value: T; created_at: Date; updated_at: Date } | null> {
    return this.getInternal<T>(key, options_or_expire, false);
  }

  async merge(key: string, value: any): Promise<void> {
    await this.ensureInitialized();

    if (this.value_type !== SqliteValueType.JSON) {
      throw new Error(
        `Merge operation is only supported for JSON type, current type is: ${this.value_type}`,
      );
    }

    await this.withWriteLock(() =>
      this._withRetry(() =>
        this.withTransaction(async (query_runner) => {
          const rows = await this.executeQuery<SqliteRawRecord[]>(
            `SELECT "value" FROM "${this.table_name}" WHERE "key" = ? LIMIT 1`,
            [key],
            query_runner,
          );
          const existing_value =
            rows.length > 0
              ? this.type_handler.deserialize(rows[0]!.value)
              : null;
          const merged_value = deepMergeJsonValues(existing_value, value);
          const serialized_merged_value =
            this.type_handler.serialize(merged_value);

          if (
            rows.length > 0 &&
            this.serializedValuesEqual(rows[0]!.value, serialized_merged_value)
          ) {
            return;
          }

          await this.upsertEntries([[key, merged_value]], query_runner);
        }),
      ),
    );
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureInitialized();
    return this.withWriteLock(async () => (await this.deleteKeys([key])) > 0);
  }

  async add(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    if (!(await this.putIfAbsent(key, value))) {
      throw new Error(`Key "${key}" already exists`);
    }
  }

  async putIfAbsent(key: string, value: any): Promise<boolean> {
    await this.ensureInitialized();
    return this.withWriteLock(async () => {
      const rows = await this._withRetry(() =>
        this.data_source.query(
          `
            INSERT INTO "${this.table_name}" ("key", "value", "created_at", "updated_at")
            VALUES (?, ?, ${SQLITE_CURRENT_TIMESTAMP_SQL}, ${SQLITE_CURRENT_TIMESTAMP_SQL})
            ON CONFLICT("key") DO NOTHING
            RETURNING "key"
          `,
          [key, this.type_handler.serialize(value)],
        ),
      );
      return rows.length > 0;
    });
  }

  async putIfChanged(key: string, value: any): Promise<boolean> {
    await this.ensureInitialized();
    return this.withWriteLock(() =>
      this._withRetry(() =>
        this.withTransaction((query_runner) =>
          this.putValueIfChanged(key, value, query_runner),
        ),
      ),
    );
  }

  async close(): Promise<void> {
    if (this.initializing_promise) {
      await this.initializing_promise;
    }

    await this.write_lock;

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

    if (
      !options?.created_after &&
      !options?.created_before &&
      !options?.updated_after &&
      !options?.updated_before &&
      (options?.offset === undefined || options.offset <= 0) &&
      (options?.limit === undefined || options.limit <= 0)
    ) {
      const data: Record<
        string,
        T | { value: T; created_at: Date; updated_at: Date }
      > = {};
      let cursor: string | undefined;

      while (true) {
        const page = await this.scan<T>({
          cursor,
          limit: KV_SCAN_PAGE_SIZE,
          include_timestamps,
        });

        Object.assign(data, page.data);

        if (!page.next_cursor) {
          return data;
        }

        cursor = page.next_cursor;
      }
    }

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
      query += ` WHERE ${where_conditions.join(" AND ")}`;
    }
    query += ' ORDER BY "key" ASC';

    query = appendSqliteLimitOffset(query, params, options);

    const records = await this.executeQuery<SqliteRawRecord[]>(query, params);

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

    const records = await this.getRawRecordsByKeys(
      unique_keys,
      include_timestamps,
    );
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
      query += ` WHERE ${where_conditions.join(" AND ")}`;
    }
    query += ' ORDER BY "created_at" DESC';
    query += " LIMIT ?";
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
    const keys: string[] = [];
    let cursor: string | undefined;

    while (true) {
      const page = await this.scanKeys({
        cursor,
        limit: KV_SCAN_PAGE_SIZE,
      });
      keys.push(...page.data);

      if (!page.next_cursor) {
        return keys;
      }

      cursor = page.next_cursor;
    }
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

  async scanKeys(
    options?: KeyScanOptions,
  ): Promise<{ data: string[]; next_cursor: string | null }> {
    await this.ensureInitialized();

    const order_by = options?.order_by === "DESC" ? "DESC" : "ASC";
    const cursor_operator = order_by === "DESC" ? "<" : ">";
    const limit = normalizePositiveInteger(options?.limit, 100, 1000);
    const params: any[] = [];
    const where_conditions: string[] = [];

    if (options?.prefix) {
      const prefix_end = buildPrefixRangeExclusiveEnd(options.prefix);
      if (prefix_end) {
        params.push(options.prefix);
        where_conditions.push(`"key" >= ?`);
        params.push(prefix_end);
        where_conditions.push(`"key" < ?`);
      } else {
        params.push(`${escapeLikePattern(options.prefix)}%`);
        where_conditions.push(`"key" LIKE ? ESCAPE '\\'`);
      }
    }

    if (options?.cursor) {
      params.push(options.cursor);
      where_conditions.push(`"key" ${cursor_operator} ?`);
    }

    let query = `SELECT "key" FROM "${this.table_name}"`;
    if (where_conditions.length > 0) {
      query += ` WHERE ${where_conditions.join(" AND ")}`;
    }
    query += ` ORDER BY "key" ${order_by} LIMIT ?`;
    params.push(limit + 1);

    const rows = (await this.executeQuery<Array<{ key: string }>>(
      query,
      params,
    )) as Array<{ key: string }>;
    const has_more = rows.length > limit;
    const page_rows = has_more ? rows.slice(0, limit) : rows;

    return {
      data: page_rows.map((row) => row.key),
      next_cursor: has_more
        ? page_rows[page_rows.length - 1]?.key || null
        : null,
    };
  }

  async scan<T = any>(
    options?: KeyScanOptions & { include_timestamps?: boolean },
  ): Promise<{
    data: Record<string, T | { value: T; created_at: Date; updated_at: Date }>;
    next_cursor: string | null;
  }> {
    await this.ensureInitialized();

    const include_timestamps = options?.include_timestamps === true;
    const order_by = options?.order_by === "DESC" ? "DESC" : "ASC";
    const cursor_operator = order_by === "DESC" ? "<" : ">";
    const limit = normalizePositiveInteger(options?.limit, 100, 1000);
    const params: any[] = [];
    const where_conditions: string[] = [];

    if (options?.prefix) {
      const prefix_end = buildPrefixRangeExclusiveEnd(options.prefix);
      if (prefix_end) {
        params.push(options.prefix);
        where_conditions.push(`"key" >= ?`);
        params.push(prefix_end);
        where_conditions.push(`"key" < ?`);
      } else {
        params.push(`${escapeLikePattern(options.prefix)}%`);
        where_conditions.push(`"key" LIKE ? ESCAPE '\\'`);
      }
    }

    if (options?.cursor) {
      params.push(options.cursor);
      where_conditions.push(`"key" ${cursor_operator} ?`);
    }

    let query = `SELECT ${this.buildSelectFields(include_timestamps)} FROM "${this.table_name}"`;
    if (where_conditions.length > 0) {
      query += ` WHERE ${where_conditions.join(" AND ")}`;
    }
    query += ` ORDER BY "key" ${order_by} LIMIT ?`;
    params.push(limit + 1);

    const rows = await this.executeQuery<SqliteRawRecord[]>(query, params);
    const has_more = rows.length > limit;
    const page_rows = has_more ? rows.slice(0, limit) : rows;

    return {
      data: page_rows.reduce(
        (acc, record) => {
          acc[record.key] = this.formatRecordValue<T>(
            record,
            include_timestamps,
          );
          return acc;
        },
        {} as Record<
          string,
          T | { value: T; created_at: Date; updated_at: Date }
        >,
      ),
      next_cursor: has_more
        ? page_rows[page_rows.length - 1]?.key || null
        : null,
    };
  }

  async putMany(
    entries: Array<[string, any]>,
    batch_size: number = SQLITE_SAFE_WRITE_BATCH_SIZE,
  ): Promise<void> {
    await this.ensureInitialized();
    await this.withWriteLock(() =>
      this._withRetry(() =>
        this.withTransaction(async (query_runner) => {
          const safe_batch_size = normalizePositiveInteger(
            batch_size,
            SQLITE_SAFE_WRITE_BATCH_SIZE,
            SQLITE_SAFE_WRITE_BATCH_SIZE,
          );
          const deduped_entries = dedupeEntriesByKey(entries);

          for (let i = 0; i < deduped_entries.length; i += safe_batch_size) {
            await this.upsertEntries(
              deduped_entries.slice(i, i + safe_batch_size),
              query_runner,
              false,
            );
          }
        }),
      ),
    );
  }

  async deleteMany(keys: string[]): Promise<number> {
    await this.ensureInitialized();
    return this.withWriteLock(() =>
      this._withRetry(() =>
        this.withTransaction((query_runner) =>
          this.deleteKeys(keys, query_runner),
        ),
      ),
    );
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    await this.withWriteLock(() =>
      this._withRetry(() =>
        this.data_source.query(`DELETE FROM "${this.table_name}"`),
      ),
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
        throw new Error(
          `Fuzzy search not supported for ${this.value_type} type`,
        );
      }

      const rows = await this._withRetry(() =>
        this.data_source.query(
          `SELECT "key" FROM "${this.table_name}" WHERE "value" LIKE ? ESCAPE '\\' ORDER BY "key" ASC`,
          [
            `%${escapeLikePattern(String(this.type_handler.serialize(value)))}%`,
          ],
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
      order_by?: "ASC" | "DESC";
      include_timestamps?: boolean;
    },
  ): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    await this.ensureInitialized();

    if (!prefix) {
      throw new Error("Prefix cannot be empty");
    }

    const include_timestamps = options?.include_timestamps === true;
    const order_by = options?.order_by === "DESC" ? "DESC" : "ASC";
    const params: any[] = [];
    const select_fields = this.buildSelectFields(include_timestamps);
    const prefix_end = buildPrefixRangeExclusiveEnd(prefix);
    let query = `
      SELECT ${select_fields}
      FROM "${this.table_name}"
      WHERE ${
        prefix_end ? `"key" >= ? AND "key" < ?` : `"key" LIKE ? ESCAPE '\\'`
      }
      ORDER BY "key" ${order_by}
    `;

    if (prefix_end) {
      params.push(prefix, prefix_end);
    } else {
      params.push(`${escapeLikePattern(prefix)}%`);
    }

    query = appendSqliteLimitOffset(query, params, options);

    const rows = await this.executeQuery<SqliteRawRecord[]>(query, params);

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
