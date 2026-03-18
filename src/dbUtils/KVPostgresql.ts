import { createHash } from 'node:crypto';
import 'reflect-metadata';
import { DataSource, EntitySchema, Table } from 'typeorm';
import type { DataSourceOptions, QueryRunner, Repository } from 'typeorm';

const POSTGRES_SAFE_WRITE_BATCH_SIZE = 5000;
const POSTGRES_SAFE_IN_BATCH_SIZE = 10000;
const KV_SCAN_PAGE_SIZE = 1000;
const POSTGRES_NUMERIC_REGEX =
  '^[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?$';

export type ValueType =
  | 'jsonb'
  | 'varchar'
  | 'text'
  | 'integer'
  | 'boolean'
  | 'float'
  | 'bytea';

export type PostgreSQLValueType = ValueType;

export interface PGKVDatabaseOptions {
  create_created_at_index?: boolean;
  create_updated_at_index?: boolean;
  create_value_index?: boolean;
  json_field_indexes?: JsonFieldIndexDefinition[];
  json_number_field_indexes?: JsonNumberFieldIndexDefinition[];
}

export interface EnsureJsonFieldIndexOptions {
  index_name?: string;
  where_not_null?: boolean;
}

export type EnsureJsonNumberFieldIndexOptions = EnsureJsonFieldIndexOptions;

export interface JsonFieldIndexDefinition
  extends EnsureJsonFieldIndexOptions {
  path: string;
}

export interface JsonNumberFieldIndexDefinition
  extends EnsureJsonNumberFieldIndexOptions {
  path: string;
}

export interface EnsureJsonFieldIndexResult {
  index_name: string;
  created: boolean;
  message: string;
}

interface ResolvedPGKVDatabaseOptions {
  create_created_at_index: boolean;
  create_updated_at_index: boolean;
  create_value_index: boolean;
  json_field_indexes: JsonFieldIndexDefinition[];
  json_number_field_indexes: JsonNumberFieldIndexDefinition[];
}

interface KVEntity {
  key: string;
  value: any;
  created_at: Date;
  updated_at: Date;
}

interface PgRawRecord {
  key: string;
  value: any;
  created_at?: string | Date;
  updated_at?: string | Date;
}

interface ParsedSearchCursor {
  value: string;
  key: string | null;
}

interface KeyScanOptions {
  cursor?: string;
  limit?: number;
  order_by?: 'ASC' | 'DESC';
  prefix?: string;
}

interface GetOptions {
  expire?: number;
  include_timestamps?: boolean;
}

function bigintJsonReplacer(_key: string, value: any) {
  return typeof value === 'bigint' ? value.toString() : value;
}

function normalizeJsonValueForIdentity(value: any): any {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value == null || typeof value !== 'object') {
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

  if (typeof value.toJSON === 'function') {
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

function stableJsonIdentityString(value: any): string {
  return JSON.stringify(normalizeJsonValueForIdentity(value));
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
  return value.replace(/[\\%_]/g, '\\$&');
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export class PGKVDatabase {
  db!: Repository<KVEntity>;
  private data_source: DataSource;
  private readonly data_source_options: DataSourceOptions;
  private readonly options: ResolvedPGKVDatabaseOptions;
  private initialized = false;
  private initializing_promise: Promise<void> | null = null;
  private table_name: string;
  private value_type: ValueType;
  private custom_kv_store: EntitySchema<KVEntity>;

  constructor(
    datasource_or_url?: string,
    table_name: string = 'kv_store',
    value_type: ValueType = 'jsonb',
    options?: PGKVDatabaseOptions,
  ) {
    assertSafeIdentifier(table_name, 'table_name');
    this.table_name = table_name;
    this.value_type = value_type;
    this.options = {
      create_created_at_index: options?.create_created_at_index === true,
      create_updated_at_index: options?.create_updated_at_index === true,
      create_value_index: options?.create_value_index === true,
      json_field_indexes: options?.json_field_indexes || [],
      json_number_field_indexes: options?.json_number_field_indexes || [],
    };
    this.validateConfiguredJsonIndexOptions();

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

    this.data_source_options = {
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
    };
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

  private getValueIdentity(value: any): string {
    if (this.value_type === 'jsonb') {
      return `${this.value_type}:${stableJsonIdentityString(value)}`;
    }

    const serialized_value = this.serializeValueForWrite(value);

    if (
      Buffer.isBuffer(serialized_value) ||
      serialized_value instanceof Uint8Array
    ) {
      return `${this.value_type}:buffer:${Buffer.from(serialized_value).toString('base64')}`;
    }

    if (serialized_value instanceof Date) {
      return `${this.value_type}:date:${serialized_value.toISOString()}`;
    }

    return `${this.value_type}:${String(serialized_value)}`;
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

  private buildJsonPathSql(path: string | string[]): string {
    const normalized_path = Array.isArray(path)
      ? path
      : this.normalizeJsonPath(path);
    return `ARRAY[${normalized_path
      .map((part) => `'${escapeSqlLiteral(part)}'`)
      .join(', ')}]`;
  }

  private buildJsonExtractTextSql(
    column_sql: string,
    path: string | string[],
    _params: any[],
  ): string {
    return `${column_sql} #>> ${this.buildJsonPathSql(path)}`;
  }

  private buildJsonExtractSql(
    column_sql: string,
    path: string | string[],
    _params: any[],
  ): string {
    return `${column_sql} #> ${this.buildJsonPathSql(path)}`;
  }

  private buildJsonFieldIndexName(path: string | string[]): string {
    const normalized_path = Array.isArray(path)
      ? path
      : this.normalizeJsonPath(path);
    const readable_path = normalized_path
      .map((part) => part.replace(/[^A-Za-z0-9_]+/g, '_'))
      .join('_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    const hash = createHash('sha1')
      .update(`${this.table_name}:${normalized_path.join('.')}`)
      .digest('hex')
      .slice(0, 10);
    const base_name = `IDX_${this.table_name}_value_${readable_path || 'field'}`;
    const truncated_base = base_name
      .slice(0, Math.max(1, 63 - hash.length - 1))
      .replace(/_+$/g, '');
    return `${truncated_base}_${hash}`;
  }

  private buildJsonNumberFieldIndexName(path: string | string[]): string {
    const normalized_path = Array.isArray(path)
      ? path
      : this.normalizeJsonPath(path);
    const readable_path = normalized_path
      .map((part) => part.replace(/[^A-Za-z0-9_]+/g, '_'))
      .join('_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    const hash = createHash('sha1')
      .update(`${this.table_name}:number:${normalized_path.join('.')}`)
      .digest('hex')
      .slice(0, 10);
    const base_name = `IDX_${this.table_name}_value_num_${readable_path || 'field'}`;
    const truncated_base = base_name
      .slice(0, Math.max(1, 63 - hash.length - 1))
      .replace(/_+$/g, '');
    return `${truncated_base}_${hash}`;
  }

  private validateConfiguredJsonIndexOptions(): void {
    if (
      this.value_type !== 'jsonb' &&
      (this.options.json_field_indexes.length > 0 ||
        this.options.json_number_field_indexes.length > 0)
    ) {
      throw new Error(
        'json_field_indexes and json_number_field_indexes require value_type "jsonb"',
      );
    }
  }

  private buildJsonFieldIndexStatement(
    path: string | string[],
    options?: EnsureJsonFieldIndexOptions,
  ): {
    index_name: string;
    create_sql: string;
  } {
    const normalized_path = Array.isArray(path)
      ? path
      : this.normalizeJsonPath(path);
    const index_name =
      options?.index_name || this.buildJsonFieldIndexName(normalized_path);
    assertSafeIdentifier(index_name, 'index_name');

    const extract_sql = this.buildJsonExtractTextSql(
      '"value"',
      normalized_path,
      [],
    );
    const where_clause =
      options?.where_not_null === false
        ? ''
        : ` WHERE (${extract_sql}) IS NOT NULL`;

    return {
      index_name,
      create_sql: `
        CREATE INDEX IF NOT EXISTS "${index_name}"
        ON "${this.table_name}" ((${extract_sql}))
        ${where_clause}
      `,
    };
  }

  private buildJsonNumberFieldIndexStatement(
    path: string | string[],
    options?: EnsureJsonNumberFieldIndexOptions,
  ): {
    index_name: string;
    create_sql: string;
  } {
    const normalized_path = Array.isArray(path)
      ? path
      : this.normalizeJsonPath(path);
    const index_name =
      options?.index_name ||
      this.buildJsonNumberFieldIndexName(normalized_path);
    assertSafeIdentifier(index_name, 'index_name');

    const extract_sql = this.buildJsonExtractTextSql(
      '"value"',
      normalized_path,
      [],
    );
    const numeric_value_sql = this.buildSafeNumericValueSql(extract_sql);
    const where_clause =
      options?.where_not_null === false
        ? ''
        : ` WHERE (${numeric_value_sql}) IS NOT NULL`;

    return {
      index_name,
      create_sql: `
        CREATE INDEX IF NOT EXISTS "${index_name}"
        ON "${this.table_name}" ((${numeric_value_sql}))
        ${where_clause}
      `,
    };
  }

  private async createConfiguredJsonIndexes(
    query_runner: QueryRunner,
  ): Promise<void> {
    for (const index_definition of this.options.json_field_indexes) {
      const { create_sql } = this.buildJsonFieldIndexStatement(
        index_definition.path,
        index_definition,
      );
      await query_runner.query(create_sql);
    }

    for (const index_definition of this.options.json_number_field_indexes) {
      const { create_sql } = this.buildJsonNumberFieldIndexStatement(
        index_definition.path,
        index_definition,
      );
      await query_runner.query(create_sql);
    }
  }

  private async hasIndex(index_name: string): Promise<boolean> {
    const rows = await this.data_source.query(
      `
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = ANY(current_schemas(false))
          AND tablename = $1
          AND indexname = $2
        LIMIT 1
      `,
      [this.table_name, index_name],
    );
    return rows.length > 0;
  }

  private buildValueEqualsSql(
    column_sql: string,
    value: any,
    params: any[],
  ): string {
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
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }
    if (typeof value === 'symbol') {
      return value.toString();
    }
    if (typeof value === 'function') {
      return value.name || '[function]';
    }

    return JSON.stringify(value, bigintJsonReplacer);
  }

  private parseSearchCursor(cursor: string): ParsedSearchCursor {
    try {
      const parsed = JSON.parse(cursor) as Partial<ParsedSearchCursor>;
      if (parsed && typeof parsed.value === 'string') {
        return {
          value: parsed.value,
          key: typeof parsed.key === 'string' ? parsed.key : null,
        };
      }
    } catch {
      // Backward compatibility for legacy plain-string cursors.
    }

    return {
      value: cursor,
      key: null,
    };
  }

  private resolveGetOptions(
    options_or_expire?: number | GetOptions,
  ): Required<Pick<GetOptions, 'include_timestamps'>> &
    Pick<GetOptions, 'expire'> {
    if (typeof options_or_expire === 'number') {
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

  private async getInternal<T = any>(
    key: string,
    options_or_expire?: number | GetOptions,
    delete_expired: boolean = true,
  ): Promise<T | { value: T; created_at: Date; updated_at: Date } | null> {
    await this.ensureInitialized();

    const record = await this.getRawRecordByKey(key, true);
    if (!record) {
      return null;
    }

    const { expire, include_timestamps } =
      this.resolveGetOptions(options_or_expire);
    const created_at = this.normalizeDate(record.created_at);

    if (this.isExpired(created_at, expire)) {
      if (delete_expired) {
        await this.deleteRecordIfCurrent(record);
      }
      return null;
    }

    const deserialized_value = this.deserializeValue(record.value) as T;

    if (!include_timestamps) {
      return deserialized_value;
    }

    return {
      value: deserialized_value,
      created_at,
      updated_at: this.normalizeDate(record.updated_at),
    };
  }

  private formatSearchCursor(value: unknown, key?: string): string | null {
    const formatted_value = this.formatCursorValue(value);
    if (formatted_value == null) {
      return null;
    }

    if (!key) {
      return formatted_value;
    }

    return JSON.stringify({
      value: formatted_value,
      key,
    });
  }

  private buildSafeNumericCompareSql(
    extract_sql: string,
    operator: '>' | '<' | '>=' | '<=' | '=' | '!=',
    parameter_index: number,
  ): string {
    const numeric_value_sql = this.buildSafeNumericValueSql(extract_sql);
    return `(${numeric_value_sql}) ${operator} $${parameter_index}`;
  }

  private buildSafeNumericValueSql(extract_sql: string): string {
    return `
      CASE
        WHEN ${extract_sql} ~ '${POSTGRES_NUMERIC_REGEX}'
        THEN (${extract_sql})::numeric
        ELSE NULL
      END
    `;
  }

  private buildSafeTimestampCompareSql(
    extract_sql: string,
    operator: '>' | '<' | '>=' | '<=' | '=' | '!=',
    parameter_index: number,
  ): string {
    return `
      CASE
        WHEN ${extract_sql} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$'
        THEN (${extract_sql})::timestamptz ${operator} $${parameter_index}::timestamptz
        ELSE FALSE
      END
    `;
  }

  private async deleteRecordIfCurrent(
    record: PgRawRecord,
    query_runner?: QueryRunner,
  ): Promise<boolean> {
    if (record.created_at == null || record.updated_at == null) {
      return false;
    }

    const executor = this.getQueryExecutor(query_runner);
    const rows = await executor.query(
      `
        DELETE FROM "${this.table_name}"
        WHERE "key" = $1
          AND "created_at" = $2::timestamptz
          AND "updated_at" = $3::timestamptz
        RETURNING "key"
      `,
      [
        record.key,
        this.normalizeDate(record.created_at),
        this.normalizeDate(record.updated_at),
      ],
    );

    return rows.length > 0;
  }

  private async acquireTransactionLock(
    query_runner: QueryRunner,
    lock_key: string,
  ): Promise<void> {
    await query_runner.query(
      `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [this.table_name, lock_key],
    );
  }

  private async queryBySuffix<T = any>(
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
    const include_timestamps = options?.include_timestamps === true;
    const order_by = options?.order_by === 'DESC' ? 'DESC' : 'ASC';
    const like_operator = options?.case_sensitive === false ? 'ILIKE' : 'LIKE';
    const params: any[] = [`%${escapeLikePattern(suffix)}`];
    let query = `
      SELECT ${this.buildSelectFields(include_timestamps)}
      FROM "${this.table_name}"
      WHERE "key" ${like_operator} $1 ESCAPE '\\'
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

    const records = await this.data_source.query(query, params);
    return this.mapRawRecordsToObject<T>(records, include_timestamps);
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
        values_sql.push(`($${key_index}, ${value_placeholder}, NOW(), NOW())`);
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
      deleted_count += Number(
        (rows[0] as { count?: number | string })?.count || 0,
      );
    }

    return deleted_count;
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
      if (!this.data_source) {
        this.data_source = new DataSource(this.data_source_options);
      }

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

        if (this.value_type === 'jsonb') {
          if (this.options.create_value_index) {
            await query_runner.query(
              `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_value_gin" ON "${this.table_name}" USING gin ("value")`,
            );
          }
          await this.createConfiguredJsonIndexes(query_runner);
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
          if (this.options.create_value_index) {
            await query_runner.query(
              `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_value_btree" ON "${this.table_name}" ("value")`,
            );
          }
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

  async ensureJsonFieldIndex(
    path: string,
    options?: EnsureJsonFieldIndexOptions,
  ): Promise<EnsureJsonFieldIndexResult> {
    this.checkTypeSupport('ensureJsonFieldIndex', ['jsonb']);
    await this.ensureInitialized();

    const normalized_path = this.normalizeJsonPath(path);
    const { index_name, create_sql } = this.buildJsonFieldIndexStatement(
      normalized_path,
      options,
    );

    if (await this.hasIndex(index_name)) {
      return {
        index_name,
        created: false,
        message: `Index "${index_name}" already exists on table "${this.table_name}"`,
      };
    }

    await this.data_source.query(create_sql);

    return {
      index_name,
      created: true,
      message: `Index "${index_name}" created on table "${this.table_name}"`,
    };
  }

  async ensureJsonNumberFieldIndex(
    path: string,
    options?: EnsureJsonNumberFieldIndexOptions,
  ): Promise<EnsureJsonFieldIndexResult> {
    this.checkTypeSupport('ensureJsonNumberFieldIndex', ['jsonb']);
    await this.ensureInitialized();

    const normalized_path = this.normalizeJsonPath(path);
    const { index_name, create_sql } = this.buildJsonNumberFieldIndexStatement(
      normalized_path,
      options,
    );

    if (await this.hasIndex(index_name)) {
      return {
        index_name,
        created: false,
        message: `Index "${index_name}" already exists on table "${this.table_name}"`,
      };
    }

    await this.data_source.query(create_sql);

    return {
      index_name,
      created: true,
      message: `Index "${index_name}" created on table "${this.table_name}"`,
    };
  }

  async merge(key: string, partial_value: any): Promise<boolean> {
    this.checkTypeSupport('merge', ['jsonb']);
    await this.ensureInitialized();

    const merged_value_sql = `
      CASE
        WHEN "${this.table_name}"."value" IS NULL THEN EXCLUDED."value"
        ELSE jsonb_deep_merge("${this.table_name}"."value", EXCLUDED."value")
      END
    `;
    const result = await this.data_source.query(
      `
        INSERT INTO "${this.table_name}" ("key", "value", "created_at", "updated_at")
        VALUES ($1, $2::jsonb, NOW(), NOW())
        ON CONFLICT ("key") DO UPDATE SET
          "value" = ${merged_value_sql},
          "updated_at" = NOW()
        WHERE "${this.table_name}"."value" IS DISTINCT FROM ${merged_value_sql}
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
    const like_operator = case_sensitive ? 'LIKE' : 'ILIKE';
    const params: any[] = [`${escapeLikePattern(prefix)}%`];
    const where_conditions = [`"key" ${like_operator} $1 ESCAPE '\\'`];

    if (options?.contains) {
      params.push(`%${escapeLikePattern(options.contains)}%`);
      where_conditions.push(
        `"key" ${like_operator} $${params.length} ESCAPE '\\'`,
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

    const records = await this.data_source.query(query, params);
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

    const reversed_suffix = Array.from(suffix).reverse().join('');
    const reverse_prefix = `reverse:${reversed_suffix}`;
    const reverse_results = await this.getWithPrefix<{
      original_key: string;
      value: T;
    }>(reverse_prefix, options);

    if (Object.keys(reverse_results).length === 0) {
      return this.queryBySuffix<T>(suffix, options);
    }

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
    const records = await this.getRawRecordsByKeys(
      unique_keys,
      include_timestamps,
    );
    return this.mapRawRecordsToObject<T>(
      records,
      include_timestamps,
      unique_keys,
    );
  }

  async add(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    if (!(await this.putIfAbsent(key, value))) {
      throw new Error(`Key "${key}" already exists`);
    }
  }

  async putIfAbsent(key: string, value: any): Promise<boolean> {
    await this.ensureInitialized();

    const rows = await this.data_source.query(
      `
        INSERT INTO "${this.table_name}" ("key", "value", "created_at", "updated_at")
        VALUES ($1, ${this.value_type === 'jsonb' ? '$2::jsonb' : '$2'}, NOW(), NOW())
        ON CONFLICT ("key") DO NOTHING
        RETURNING "key"
      `,
      [key, this.serializeValueForWrite(value)],
    );

    return rows.length > 0;
  }

  async putIfChanged(key: string, value: any): Promise<boolean> {
    await this.ensureInitialized();

    const rows = await this.data_source.query(
      `
        INSERT INTO "${this.table_name}" ("key", "value", "created_at", "updated_at")
        VALUES ($1, ${this.value_type === 'jsonb' ? '$2::jsonb' : '$2'}, NOW(), NOW())
        ON CONFLICT ("key") DO UPDATE SET
          "value" = EXCLUDED."value",
          "updated_at" = NOW()
        WHERE "${this.table_name}"."value" IS DISTINCT FROM EXCLUDED."value"
        RETURNING "key"
      `,
      [key, this.serializeValueForWrite(value)],
    );

    return rows.length > 0;
  }

  async addUniquePair(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    if (!(await this.putIfChanged(key, value))) {
      throw new Error(`Key-value pair already exists for key "${key}"`);
    }
  }

  async addUniqueValue(key: string, value: any): Promise<void> {
    await this.ensureInitialized();

    const query_runner = this.data_source.createQueryRunner();
    await query_runner.connect();
    await query_runner.startTransaction();

    try {
      await this.acquireTransactionLock(
        query_runner,
        `value:${this.getValueIdentity(value)}`,
      );

      const params: any[] = [];
      const value_where_sql = this.buildValueEqualsSql(
        '"value"',
        value,
        params,
      );
      const existing = await query_runner.query(
        `SELECT "key" FROM "${this.table_name}" WHERE ${value_where_sql} LIMIT 1`,
        params,
      );

      if (existing.length > 0) {
        throw new Error(`Value already exists with key "${existing[0].key}"`);
      }

      const rows = await query_runner.query(
        `
          INSERT INTO "${this.table_name}" ("key", "value", "created_at", "updated_at")
          VALUES ($1, ${this.value_type === 'jsonb' ? '$2::jsonb' : '$2'}, NOW(), NOW())
          ON CONFLICT ("key") DO NOTHING
          RETURNING "key"
        `,
        [key, this.serializeValueForWrite(value)],
      );

      if (rows.length === 0) {
        throw new Error(`Key "${key}" already exists`);
      }

      await query_runner.commitTransaction();
    } catch (error) {
      await query_runner.rollbackTransaction();
      throw error;
    } finally {
      await query_runner.release();
    }
  }

  async close(): Promise<void> {
    if (this.initializing_promise) {
      await this.initializing_promise;
    }

    if (this.data_source?.isInitialized) {
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

    if (
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

    const records = await this.data_source.query(query, params);
    return this.mapRawRecordsToObject<T>(records, include_timestamps);
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

  async scanKeys(
    options?: KeyScanOptions,
  ): Promise<{ data: string[]; next_cursor: string | null }> {
    await this.ensureInitialized();

    const order_by = options?.order_by === 'DESC' ? 'DESC' : 'ASC';
    const cursor_operator = order_by === 'DESC' ? '<' : '>';
    const limit = normalizePositiveInteger(options?.limit, 100, 1000);
    const params: any[] = [];
    const where_conditions: string[] = [];

    if (options?.prefix) {
      params.push(`${escapeLikePattern(options.prefix)}%`);
      where_conditions.push(`"key" LIKE $${params.length} ESCAPE '\\'`);
    }

    if (options?.cursor) {
      params.push(options.cursor);
      where_conditions.push(`"key" ${cursor_operator} $${params.length}`);
    }

    let query = `SELECT "key" FROM "${this.table_name}"`;
    if (where_conditions.length > 0) {
      query += ` WHERE ${where_conditions.join(' AND ')}`;
    }
    params.push(limit + 1);
    query += ` ORDER BY "key" ${order_by} LIMIT $${params.length}`;

    const rows = await this.data_source.query(query, params);
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
    const order_by = options?.order_by === 'DESC' ? 'DESC' : 'ASC';
    const cursor_operator = order_by === 'DESC' ? '<' : '>';
    const limit = normalizePositiveInteger(options?.limit, 100, 1000);
    const params: any[] = [];
    const where_conditions: string[] = [];

    if (options?.prefix) {
      params.push(`${escapeLikePattern(options.prefix)}%`);
      where_conditions.push(`"key" LIKE $${params.length} ESCAPE '\\'`);
    }

    if (options?.cursor) {
      params.push(options.cursor);
      where_conditions.push(`"key" ${cursor_operator} $${params.length}`);
    }

    let query = `SELECT ${this.buildSelectFields(include_timestamps)} FROM "${this.table_name}"`;
    if (where_conditions.length > 0) {
      query += ` WHERE ${where_conditions.join(' AND ')}`;
    }
    params.push(limit + 1);
    query += ` ORDER BY "key" ${order_by} LIMIT $${params.length}`;

    const rows = await this.data_source.query(query, params);
    const has_more = rows.length > limit;
    const page_rows = has_more ? rows.slice(0, limit) : rows;

    return {
      data: this.mapRawRecordsToObject<T>(page_rows, include_timestamps),
      next_cursor: has_more
        ? page_rows[page_rows.length - 1]?.key || null
        : null,
    };
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
      await this.upsertEntries(
        dedupeEntriesByKey(entries),
        query_runner,
        safe_batch_size,
      );
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
    const select_fields =
      !include_timestamps && order_by_field !== 'key'
        ? `${this.buildSelectFields(false)}, ${order_column}`
        : this.buildSelectFields(include_timestamps);
    const order_by_clause =
      order_by_field === 'key'
        ? `${order_column} ${order_by}`
        : `${order_column} ${order_by}, "key" ${order_by}`;

    const params: any[] = [];
    const where_conditions: string[] = [];

    if (search_options.contains) {
      params.push(JSON.stringify(search_options.contains, bigintJsonReplacer));
      where_conditions.push(`"value" @> $${params.length}::jsonb`);
    }

    if (search_options.compare) {
      for (const condition of search_options.compare) {
        const extract_sql = this.buildJsonExtractTextSql(
          '"value"',
          condition.path,
          params,
        );
        if (typeof condition.value === 'number') {
          params.push(condition.value);
          where_conditions.push(
            this.buildSafeNumericCompareSql(
              extract_sql,
              condition.operator,
              params.length,
            ),
          );
          continue;
        }

        if (condition.value instanceof Date) {
          params.push(condition.value.toISOString());
          where_conditions.push(
            this.buildSafeTimestampCompareSql(
              extract_sql,
              condition.operator,
              params.length,
            ),
          );
          continue;
        }

        params.push(String(condition.value));
        where_conditions.push(
          `${extract_sql} ${condition.operator} $${params.length}`,
        );
      }
    }

    if (search_options.text_search) {
      for (const condition of search_options.text_search) {
        const extract_sql = this.buildJsonExtractTextSql(
          '"value"',
          condition.path,
          params,
        );
        params.push(`%${escapeLikePattern(condition.text)}%`);
        where_conditions.push(
          `${extract_sql} ${condition.case_sensitive ? 'LIKE' : 'ILIKE'} $${params.length} ESCAPE '\\'`,
        );
      }
    }

    if (search_options.cursor) {
      const parsed_cursor = this.parseSearchCursor(search_options.cursor);
      const operator = order_by === 'ASC' ? '>' : '<';
      if (order_by_field === 'key') {
        params.push(parsed_cursor.value);
        where_conditions.push(`${order_column} ${operator} $${params.length}`);
      } else {
        params.push(new Date(parsed_cursor.value));
        const cursor_value_index = params.length;

        if (parsed_cursor.key) {
          params.push(parsed_cursor.key);
          const cursor_key_index = params.length;
          where_conditions.push(
            `(${order_column} ${operator} $${cursor_value_index}::timestamptz OR (${order_column} = $${cursor_value_index}::timestamptz AND "key" ${operator} $${cursor_key_index}))`,
          );
        } else {
          where_conditions.push(
            `${order_column} ${operator} $${cursor_value_index}::timestamptz`,
          );
        }
      }
    }

    let query = `
      SELECT ${select_fields}
      FROM "${this.table_name}"
    `;

    if (where_conditions.length > 0) {
      query += ` WHERE ${where_conditions.join(' AND ')}`;
    }

    query += `
      ORDER BY ${order_by_clause}
      LIMIT ${limit + 1}
    `;

    const records = await this.data_source.query(query, params);
    const has_more = records.length > limit;
    const page_records = has_more ? records.slice(0, limit) : records;
    const data = page_records.map((record) =>
      this.mapRawRecord(record, include_timestamps),
    );
    const last_record = page_records[page_records.length - 1];

    return {
      data,
      next_cursor:
        has_more && last_record
          ? order_by_field === 'key'
            ? this.formatSearchCursor(last_record.key)
            : this.formatSearchCursor(
                order_by_field === 'created_at'
                  ? this.normalizeDate(last_record.created_at)
                  : this.normalizeDate(last_record.updated_at),
                last_record.key,
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

    const records = await this.data_source.query(
      `
        SELECT ${this.buildSelectFields(include_timestamps)}
        FROM "${this.table_name}"
        WHERE "${time_column}" ${operator} $1
        ORDER BY "${time_column}" ${params.order_by === 'DESC' ? 'DESC' : 'ASC'}
        LIMIT $2
      `,
      [new Date(params.timestamp), take],
    );

    return records.map((record) =>
      this.mapRawRecord(record, include_timestamps),
    );
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
      const extract_sql = this.buildJsonExtractTextSql(
        '"value"',
        search_options.path,
        params,
      );
      params.push(String(search_options.value));
      where_conditions.push(`${extract_sql} = $${params.length}`);
    }

    params.push(take);
    const records = await this.data_source.query(
      `
        SELECT ${this.buildSelectFields(include_timestamps)}
        FROM "${this.table_name}"
        WHERE ${where_conditions.join(' AND ')}
        ORDER BY "${time_column}" ${time_options.order_by === 'DESC' ? 'DESC' : 'ASC'}
        LIMIT $${params.length}
      `,
      params,
    );

    return records.map((record) =>
      this.mapRawRecord(record, include_timestamps),
    );
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
      ensureJsonFieldIndex: ['jsonb'],
      ensureJsonNumberFieldIndex: ['jsonb'],
    };

    const supported_types = operation_type_map[operation];
    if (!supported_types) {
      return true;
    }

    return supported_types.includes(this.value_type);
  }
}
