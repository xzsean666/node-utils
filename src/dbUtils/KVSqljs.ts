import initSqlJs, { Database, SqlJsStatic, SqlValue } from 'sql.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// createRequire and dirname are provided by the bundle banner for ESM compatibility
declare const require: NodeRequire;
declare const __dirname: string;
declare function dirname(path: string): string;

// 支持的数据类型枚举
export enum SqljsValueType {
  JSON = 'json', // 存储为text，序列化JSON
  TEXT = 'text', // 纯文本
  BLOB = 'blob', // 二进制数据
  INTEGER = 'integer', // 整数
  REAL = 'real', // 浮点数
  BOOLEAN = 'boolean', // 布尔值（存储为integer）
}

// 类型处理器接口
interface TypeHandler {
  serialize(value: any): SqlValue;
  deserialize(value: any): any;
  column_type: string;
}

// 类型处理器实现
const TYPE_HANDLERS: Record<SqljsValueType, TypeHandler> = {
  [SqljsValueType.JSON]: {
    serialize: (value: any) => JSON.stringify(value, bigintHandler),
    deserialize: (value: any) => JSON.parse(value),
    column_type: 'text',
  },
  [SqljsValueType.TEXT]: {
    serialize: (value: any) => String(value),
    deserialize: (value: any) => value,
    column_type: 'text',
  },
  [SqljsValueType.BLOB]: {
    serialize: (value: any) => {
      if (value instanceof Uint8Array) return value;
      if (value instanceof Buffer) return value;
      if (typeof value === 'string') return Buffer.from(value, 'utf8');
      throw new Error('BLOB type requires Buffer, Uint8Array, or string');
    },
    deserialize: (value: any) => value,
    column_type: 'blob',
  },
  [SqljsValueType.INTEGER]: {
    serialize: (value: any) => {
      const num = Number(value);
      if (!Number.isInteger(num))
        throw new Error('INTEGER type requires integer value');
      return num;
    },
    deserialize: (value: any) => Number(value),
    column_type: 'integer',
  },
  [SqljsValueType.REAL]: {
    serialize: (value: any) => Number(value),
    deserialize: (value: any) => Number(value),
    column_type: 'real',
  },
  [SqljsValueType.BOOLEAN]: {
    serialize: (value: any) => (value ? 1 : 0),
    deserialize: (value: any) => Boolean(value),
    column_type: 'integer',
  },
};

// 添加接口定义
interface KVEntity {
  key: string;
  value: any;
  created_at: Date;
  updated_at: Date;
}

function bigintHandler(key: string, val: any) {
  if (typeof val === 'bigint') {
    return val.toString();
  }
  return val;
}

export class SqljsKVDatabase {
  private static sql_instance_promise: Promise<SqlJsStatic> | null = null;
  private db: Database | null = null;
  private initialized = false;
  private initializing_promise: Promise<void> | null = null;
  private table_name: string;
  private file_path?: string;
  private value_type: SqljsValueType;
  private type_handler: TypeHandler;

  constructor(
    file_path?: string,
    table_name: string = 'kv_store',
    value_type: SqljsValueType = SqljsValueType.JSON,
  ) {
    this.file_path = file_path;
    this.table_name = table_name;
    this.value_type = value_type;
    this.type_handler = TYPE_HANDLERS[value_type];
  }

  private static getSqlInstance(): Promise<SqlJsStatic> {
    if (!SqljsKVDatabase.sql_instance_promise) {
      SqljsKVDatabase.sql_instance_promise = initSqlJs({
        locateFile: (file) => {
          try {
            return require.resolve(`sql.js/dist/${file}`);
          } catch {
            return file;
          }
        },
      });
    }
    return SqljsKVDatabase.sql_instance_promise;
  }

  private escapeIdentifier(name: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Invalid identifier: ${name}`);
    }
    return `"${name}"`;
  }

  private async loadDatabase(): Promise<Uint8Array | null> {
    if (!this.file_path) return null;
    try {
      const data = await readFile(this.file_path);
      return new Uint8Array(data);
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        await mkdir(dirname(this.file_path), { recursive: true });
        return null;
      }
      throw error;
    }
  }

  private async persist(): Promise<void> {
    if (!this.file_path || !this.db) return;
    const data = this.db.export();
    await mkdir(dirname(this.file_path), { recursive: true });
    await writeFile(this.file_path, data);
  }

  private ensureTable(): void {
    const table = this.escapeIdentifier(this.table_name);
    const column_type = this.type_handler.column_type.toUpperCase();
    const create_sql = `
      CREATE TABLE IF NOT EXISTS ${table} (
        key TEXT PRIMARY KEY,
        value ${column_type},
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_${this.table_name}_created_at ON ${table}(created_at);
      CREATE INDEX IF NOT EXISTS idx_${this.table_name}_updated_at ON ${table}(updated_at);
    `;
    this.assertDb().run(create_sql);
  }

  private assertDb(): Database {
    if (!this.db) throw new Error('Database is not initialized');
    return this.db;
  }

  private parseDate(value: any): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  }

  private nowTimestamp(): string {
    return new Date().toISOString();
  }

  private rowToEntity<T = any>(
    row: any,
  ): {
    key: string;
    value: T;
    created_at: Date;
    updated_at: Date;
  } {
    return {
      key: String(row.key),
      value: this.type_handler.deserialize(row.value) as T,
      created_at: this.parseDate(row.created_at),
      updated_at: this.parseDate(row.updated_at),
    };
  }

  private getSingleRow(sql: string, params: SqlValue[] = []): any | null {
    const stmt = this.assertDb().prepare(sql);
    try {
      stmt.bind(params as any);
      if (stmt.step()) {
        return stmt.getAsObject();
      }
      return null;
    } finally {
      stmt.free();
    }
  }

  private getRows(sql: string, params: SqlValue[] = []): any[] {
    const stmt = this.assertDb().prepare(sql);
    const rows: any[] = [];
    try {
      stmt.bind(params as any);
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized && this.db) return;
    if (this.initializing_promise) {
      await this.initializing_promise;
      return;
    }

    this.initializing_promise = (async () => {
      const SQL = await SqljsKVDatabase.getSqlInstance();
      const existing = await this.loadDatabase();
      this.db = existing ? new SQL.Database(existing) : new SQL.Database();
      this.ensureTable();
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
    const now = this.nowTimestamp();
    const table = this.escapeIdentifier(this.table_name);
    this.assertDb().run(
      `INSERT INTO ${table} (key, value, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      [key, this.type_handler.serialize(value), now, now],
    );
    await this.persist();
  }

  async get<T = any>(key: string, expire?: number): Promise<T | null>;
  async get<T = any>(
    key: string,
    options?: { expire?: number; include_timestamps?: boolean },
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
    const table = this.escapeIdentifier(this.table_name);
    const row = this.getSingleRow(
      `SELECT key, value, created_at, updated_at FROM ${table} WHERE key = ? LIMIT 1`,
      [key],
    );

    if (!row) return null;

    let expire: number | undefined;
    let include_timestamps = false;

    if (typeof options_or_expire === 'number') {
      expire = options_or_expire;
    } else if (options_or_expire && typeof options_or_expire === 'object') {
      expire = options_or_expire.expire;
      include_timestamps = options_or_expire.include_timestamps || false;
    }

    const entity = this.rowToEntity<T>(row);

    if (expire !== undefined) {
      const current_time = Math.floor(Date.now() / 1000);
      const created_time = Math.floor(entity.created_at.getTime() / 1000);
      if (current_time - created_time > expire) {
        await this.delete(key);
        return null;
      }
    }

    if (include_timestamps) {
      return {
        value: entity.value,
        created_at: entity.created_at,
        updated_at: entity.updated_at,
      };
    }

    return entity.value;
  }

  async merge(key: string, value: any): Promise<void> {
    await this.ensureInitialized();

    if (this.value_type !== SqljsValueType.JSON) {
      throw new Error(
        `Merge operation is only supported for JSON type, current type is: ${this.value_type}`,
      );
    }

    const existing_value = await this.get(key);
    let merged_value: any;

    if (existing_value === null) {
      merged_value = value;
    } else if (
      typeof existing_value === 'object' &&
      existing_value !== null &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(existing_value) &&
      !Array.isArray(value)
    ) {
      merged_value = { ...existing_value, ...value };
    } else {
      merged_value = value;
    }

    await this.put(key, merged_value);
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureInitialized();
    const table = this.escapeIdentifier(this.table_name);
    this.assertDb().run(`DELETE FROM ${table} WHERE key = ?`, [key]);
    const deleted = this.assertDb().getRowsModified() > 0;
    if (deleted) {
      await this.persist();
    }
    return deleted;
  }

  async add(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    if (await this.has(key)) {
      throw new Error(`Key "${key}" already exists`);
    }
    const now = this.nowTimestamp();
    const table = this.escapeIdentifier(this.table_name);
    this.assertDb().run(
      `INSERT INTO ${table} (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      [key, this.type_handler.serialize(value), now, now],
    );
    await this.persist();
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.persist();
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
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
    const where_clauses: string[] = [];
    const params: SqlValue[] = [];
    const table = this.escapeIdentifier(this.table_name);

    if (options?.created_after) {
      where_clauses.push('created_at >= ?');
      params.push(options.created_after.toISOString());
    }

    if (options?.created_before) {
      where_clauses.push('created_at <= ?');
      params.push(options.created_before.toISOString());
    }

    if (options?.updated_after) {
      where_clauses.push('updated_at >= ?');
      params.push(options.updated_after.toISOString());
    }

    if (options?.updated_before) {
      where_clauses.push('updated_at <= ?');
      params.push(options.updated_before.toISOString());
    }

    let sql = `SELECT key, value, created_at, updated_at FROM ${table}`;
    if (where_clauses.length > 0) {
      sql += ` WHERE ${where_clauses.join(' AND ')}`;
    }
    sql += ` ORDER BY key ASC`;

    if (options?.limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    if (options?.offset !== undefined) {
      sql += options.limit === undefined ? ` LIMIT -1 OFFSET ?` : ` OFFSET ?`;
      params.push(options.offset);
    }

    const records = this.getRows(sql, params);

    return records.reduce(
      (
        acc,
        record: { key: any; value: any; created_at: Date; updated_at: Date },
      ) => {
        const deserialized = this.type_handler.deserialize(record.value) as T;
        acc[record.key] = include_timestamps
          ? {
              value: deserialized,
              created_at: this.parseDate(record.created_at),
              updated_at: this.parseDate(record.updated_at),
            }
          : deserialized;
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
    if (keys.length === 0) return {};
    const include_timestamps = options?.include_timestamps === true;
    const table = this.escapeIdentifier(this.table_name);
    const batch_size = 50;
    const all_records: any[] = [];

    for (let i = 0; i < keys.length; i += batch_size) {
      const batch = keys.slice(i, i + batch_size);
      const placeholders = batch.map(() => '?').join(', ');
      const sql = `SELECT key, value, created_at, updated_at FROM ${table} WHERE key IN (${placeholders})`;
      const records = this.getRows(sql, batch);
      all_records.push(...records);
    }

    const record_map = new Map<
      string,
      T | { value: T; created_at: Date; updated_at: Date }
    >();

    for (const record of all_records) {
      try {
        const deserialized = this.type_handler.deserialize(record.value) as T;
        record_map.set(
          record.key,
          include_timestamps
            ? {
                value: deserialized,
                created_at: this.parseDate(record.created_at),
                updated_at: this.parseDate(record.updated_at),
              }
            : deserialized,
        );
      } catch (error: any) {
        console.warn(
          `Failed to deserialize record for key ${record.key}: ${error.message}`,
        );
      }
    }

    const result: Record<
      string,
      T | { value: T; created_at: Date; updated_at: Date }
    > = {};
    for (const [key, value] of record_map) {
      result[key] = value;
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
    const params: SqlValue[] = [];
    const table = this.escapeIdentifier(this.table_name);
    let sql = `SELECT key, value, created_at, updated_at FROM ${table}`;

    if (seconds > 0) {
      sql += ` WHERE created_at >= ?`;
      params.push(new Date(Date.now() - seconds * 1000).toISOString());
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const records = this.getRows(sql, params);
    return records.reduce(
      (
        acc,
        record: { key: any; value: any; created_at: Date; updated_at: Date },
      ) => {
        const deserialized = this.type_handler.deserialize(record.value) as T;
        acc[record.key] = include_timestamps
          ? {
              value: deserialized,
              created_at: this.parseDate(record.created_at),
              updated_at: this.parseDate(record.updated_at),
            }
          : deserialized;
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
    const table = this.escapeIdentifier(this.table_name);
    const records = this.getRows(`SELECT key FROM ${table} ORDER BY key ASC`);
    return records.map((record) => String(record.key));
  }

  async has(key: string): Promise<boolean> {
    await this.ensureInitialized();
    const table = this.escapeIdentifier(this.table_name);
    const row = this.getSingleRow(
      `SELECT 1 as found FROM ${table} WHERE key = ? LIMIT 1`,
      [key],
    );
    return !!row;
  }

  async putMany(
    entries: Array<[string, any]>,
    batch_size: number = 1000,
  ): Promise<void> {
    await this.ensureInitialized();
    const table = this.escapeIdentifier(this.table_name);
    const db = this.assertDb();
    for (let i = 0; i < entries.length; i += batch_size) {
      const batch = entries.slice(i, i + batch_size);
      db.run('BEGIN TRANSACTION;');
      try {
        const stmt = db.prepare(
          `INSERT INTO ${table} (key, value, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
        );
        for (const [key, value] of batch) {
          const now = this.nowTimestamp();
          stmt.run([key, this.type_handler.serialize(value), now, now]);
        }
        stmt.free();
        db.run('COMMIT;');
      } catch (error) {
        db.run('ROLLBACK;');
        throw error;
      }
    }
    await this.persist();
  }

  async deleteMany(keys: string[]): Promise<number> {
    await this.ensureInitialized();
    const table = this.escapeIdentifier(this.table_name);
    const db = this.assertDb();
    let deleted = 0;
    const batch_size = 200;

    for (let i = 0; i < keys.length; i += batch_size) {
      const batch = keys.slice(i, i + batch_size);
      const placeholders = batch.map(() => '?').join(', ');
      db.run(`DELETE FROM ${table} WHERE key IN (${placeholders})`, batch);
      deleted += db.getRowsModified();
    }

    if (deleted > 0) {
      await this.persist();
    }
    return deleted;
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    const table = this.escapeIdentifier(this.table_name);
    this.assertDb().run(`DELETE FROM ${table}`);
    if (this.assertDb().getRowsModified() > 0) {
      await this.persist();
    }
  }

  async count(): Promise<number> {
    await this.ensureInitialized();
    const table = this.escapeIdentifier(this.table_name);
    const row = this.getSingleRow(`SELECT COUNT(*) as count FROM ${table}`) as {
      count: number;
    };
    return Number(row?.count ?? 0);
  }

  async findByValue(value: any, exact: boolean = true): Promise<string[]> {
    await this.ensureInitialized();
    const table = this.escapeIdentifier(this.table_name);
    const serialized = this.type_handler.serialize(value);

    if (exact) {
      const rows = this.getRows(`SELECT key FROM ${table} WHERE value = ?`, [
        serialized,
      ]);
      return rows.map((row) => String(row.key));
    }

    if (
      this.value_type === SqljsValueType.TEXT ||
      this.value_type === SqljsValueType.JSON
    ) {
      const rows = this.getRows(`SELECT key FROM ${table} WHERE value LIKE ?`, [
        `%${serialized}%`,
      ]);
      return rows.map((row) => String(row.key));
    }

    throw new Error(`Fuzzy search not supported for ${this.value_type} type`);
  }

  async findByCondition(
    condition: (value: any) => boolean,
  ): Promise<Map<string, any>> {
    await this.ensureInitialized();
    const table = this.escapeIdentifier(this.table_name);
    const records = this.getRows(`SELECT key, value FROM ${table}`);
    const matched = records.filter((record) =>
      condition(this.type_handler.deserialize(record.value)),
    );
    return matched.reduce((acc, record) => {
      acc.set(record.key, this.type_handler.deserialize(record.value));
      return acc;
    }, new Map<string, any>());
  }

  getValueType(): SqljsValueType {
    return this.value_type;
  }

  getTypeInfo(): { value_type: SqljsValueType; column_type: string } {
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

    const {
      limit,
      offset,
      order_by = 'ASC',
      include_timestamps = false,
    } = options || {};

    const table = this.escapeIdentifier(this.table_name);
    const params: SqlValue[] = [prefix, prefix + String.fromCharCode(255)];
    let sql = `SELECT key, value, created_at, updated_at FROM ${table}
      WHERE key >= ? AND key < ?
      ORDER BY key ${order_by}`;

    if (limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(limit);
    }
    if (offset !== undefined) {
      sql += limit === undefined ? ` LIMIT -1 OFFSET ?` : ` OFFSET ?`;
      params.push(offset);
    }

    const results = this.getRows(sql, params);
    return results.reduce(
      (
        acc,
        record: { key: string; value: any; created_at: any; updated_at: any },
      ) => {
        const deserialized = this.type_handler.deserialize(record.value) as T;
        acc[record.key] = include_timestamps
          ? {
              value: deserialized,
              created_at: this.parseDate(record.created_at),
              updated_at: this.parseDate(record.updated_at),
            }
          : deserialized;
        return acc;
      },
      {} as Record<
        string,
        T | { value: T; created_at: Date; updated_at: Date }
      >,
    );
  }
}
