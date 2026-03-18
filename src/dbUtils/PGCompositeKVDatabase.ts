import 'reflect-metadata';
import { DataSource, EntitySchema, Table } from 'typeorm';
import type { DataSourceOptions, Repository } from 'typeorm';

import type {
  JsonFieldIndexDefinition,
  JsonNumberFieldIndexDefinition,
  PGKVDatabaseOptions,
  ValueType,
} from './KVPostgresql';

const POSTGRES_SAFE_WRITE_BATCH_SIZE = 5000;
const POSTGRES_SAFE_IN_BATCH_SIZE = 10000;

export type CompositeKeyColumnType =
  | 'varchar'
  | 'text'
  | 'integer'
  | 'bigint'
  | 'boolean'
  | 'float'
  | 'timestamptz';

export interface CompositeKeyColumnDefinition {
  name: string;
  type?: CompositeKeyColumnType;
  length?: number;
}

export interface PGCompositeKVDatabaseOptions extends PGKVDatabaseOptions {
  value_type?: ValueType;
  track_timestamps?: boolean;
}

interface ResolvedPGCompositeKVDatabaseOptions {
  create_created_at_index: boolean;
  create_updated_at_index: boolean;
  create_value_index: boolean;
  json_field_indexes: JsonFieldIndexDefinition[];
  json_number_field_indexes: JsonNumberFieldIndexDefinition[];
  value_type: ValueType;
  track_timestamps: boolean;
}

export type CompositeKeyPart = string | number | bigint | boolean | Date;
export type CompositeKeyInput = Record<string, CompositeKeyPart>;

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

function assertSafeIdentifier(name: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`${label} must match ^[A-Za-z_][A-Za-z0-9_]*$`);
  }
}

export class PGCompositeKVDatabase {
  db!: Repository<Record<string, any>>;
  private data_source: DataSource;
  private readonly data_source_options: DataSourceOptions;
  private readonly options: ResolvedPGCompositeKVDatabaseOptions;
  private initialized = false;
  private initializing_promise: Promise<void> | null = null;
  private readonly table_name: string;
  private readonly value_type: ValueType;
  private readonly track_timestamps: boolean;
  private readonly key_columns: CompositeKeyColumnDefinition[];
  private readonly entity_schema: EntitySchema<Record<string, any>>;

  constructor(
    datasource_or_url: string,
    table_name: string,
    key_columns: CompositeKeyColumnDefinition[],
    options?: PGCompositeKVDatabaseOptions,
  ) {
    assertSafeIdentifier(table_name, 'table_name');
    if (!datasource_or_url) {
      throw new Error('datasource_or_url is required');
    }
    if (!Array.isArray(key_columns) || key_columns.length === 0) {
      throw new Error('key_columns must contain at least one column');
    }

    const normalized_key_columns = key_columns.map((column, index) => {
      assertSafeIdentifier(column.name, `key_columns[${index}].name`);
      const type = column.type || 'text';
      if (type === 'varchar') {
        const length = column.length ?? 255;
        if (!Number.isInteger(length) || length <= 0) {
          throw new Error(
            `key_columns[${index}].length must be a positive integer`,
          );
        }
        return {
          ...column,
          type,
          length,
        };
      }
      return {
        ...column,
        type,
      };
    });

    if (
      new Set(normalized_key_columns.map((column) => column.name)).size !==
      normalized_key_columns.length
    ) {
      throw new Error('key_columns must not contain duplicate names');
    }

    this.table_name = table_name;
    this.value_type = options?.value_type || 'jsonb';
    this.track_timestamps = options?.track_timestamps === true;
    this.key_columns = normalized_key_columns;
    this.options = {
      track_timestamps: this.track_timestamps,
      create_created_at_index:
        this.track_timestamps && options?.create_created_at_index === true,
      create_updated_at_index:
        this.track_timestamps && options?.create_updated_at_index === true,
      create_value_index: options?.create_value_index === true,
      json_field_indexes: options?.json_field_indexes || [],
      json_number_field_indexes: options?.json_number_field_indexes || [],
      value_type: this.value_type,
    };

    const columns: Record<string, any> = {};
    for (const column of this.key_columns) {
      columns[column.name] = {
        type:
          column.type === 'varchar'
            ? 'varchar'
            : this.getCompositeKeyColumnType(column.type || 'text'),
        ...(column.type === 'varchar'
          ? { length: String(column.length ?? 255) }
          : {}),
        primary: true,
      };
    }

    columns.value = {
      type: this.getPostgreSQLColumnType(this.value_type),
      nullable: true,
    };

    if (this.track_timestamps) {
      columns.created_at = {
        type: 'timestamptz',
        createDate: true,
        name: 'created_at',
      };
      columns.updated_at = {
        type: 'timestamptz',
        updateDate: true,
        name: 'updated_at',
      };
    }

    this.entity_schema = new EntitySchema<Record<string, any>>({
      name: table_name,
      columns,
    });

    this.data_source_options = {
      type: 'postgres',
      url: datasource_or_url,
      entities: [this.entity_schema],
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

  private getCompositeKeyColumnType(type: CompositeKeyColumnType): string {
    switch (type) {
      case 'varchar':
        return 'varchar';
      case 'text':
        return 'text';
      case 'integer':
        return 'integer';
      case 'bigint':
        return 'bigint';
      case 'boolean':
        return 'boolean';
      case 'float':
        return 'float';
      case 'timestamptz':
        return 'timestamptz';
      default:
        return 'text';
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

  private normalizeDate(value: string | Date | undefined): Date {
    if (value instanceof Date) {
      return value;
    }
    return new Date(value || 0);
  }

  private coerceKeyPart(
    column: CompositeKeyColumnDefinition,
    value: CompositeKeyPart,
  ): CompositeKeyPart {
    switch (column.type) {
      case 'integer':
      case 'float':
        if (typeof value === 'number') {
          return value;
        }
        if (typeof value === 'string' && value.trim() !== '') {
          return Number(value);
        }
        break;
      case 'bigint':
        if (typeof value === 'bigint') {
          return value.toString();
        }
        if (typeof value === 'number') {
          return Math.trunc(value).toString();
        }
        if (typeof value === 'string' && value.trim() !== '') {
          return value;
        }
        break;
      case 'boolean':
        if (typeof value === 'boolean') {
          return value;
        }
        break;
      case 'timestamptz': {
        const date = value instanceof Date ? value : new Date(value);
        if (!Number.isNaN(date.getTime())) {
          return date;
        }
        break;
      }
      case 'varchar':
      case 'text':
      default:
        if (typeof value === 'string') {
          return value;
        }
        if (
          typeof value === 'number' ||
          typeof value === 'boolean' ||
          typeof value === 'bigint'
        ) {
          return String(value);
        }
        break;
    }

    throw new Error(`Invalid value for composite key column "${column.name}"`);
  }

  private normalizeKeyInput(key: CompositeKeyInput): CompositeKeyInput {
    if (!key || typeof key !== 'object' || Array.isArray(key)) {
      throw new Error('Composite key must be an object');
    }

    const normalized_key: CompositeKeyInput = {};
    for (const column of this.key_columns) {
      const value = key[column.name];
      if (value === undefined) {
        throw new Error(`Composite key is missing column "${column.name}"`);
      }
      normalized_key[column.name] = this.coerceKeyPart(column, value);
    }

    return normalized_key;
  }

  private getCompositeKeyIdentity(key: CompositeKeyInput): string {
    const normalized_key = this.normalizeKeyInput(key);
    return JSON.stringify(
      this.key_columns.map((column) => [
        column.name,
        normalized_key[column.name],
      ]),
      bigintJsonReplacer,
    );
  }

  private getOrderedKeyValues(key: CompositeKeyInput): any[] {
    const normalized_key = this.normalizeKeyInput(key);
    return this.key_columns.map((column) => normalized_key[column.name]);
  }

  private buildSelectFields(include_timestamps: boolean): string {
    const fields = this.key_columns.map((column) => `"${column.name}"`);
    fields.push('"value"');
    if (include_timestamps && this.track_timestamps) {
      fields.push('"created_at"', '"updated_at"');
    }
    return fields.join(', ');
  }

  private buildPrimaryKeyWhereSql(start_index: number = 1): string {
    return this.key_columns
      .map((column, index) => `"${column.name}" = $${start_index + index}`)
      .join(' AND ');
  }

  private buildJoinConditionSql(
    left_alias: string,
    right_alias: string,
  ): string {
    return this.key_columns
      .map(
        (column) =>
          `${left_alias}."${column.name}" = ${right_alias}."${column.name}"`,
      )
      .join(' AND ');
  }

  private buildConflictColumnsSql(): string {
    return this.key_columns.map((column) => `"${column.name}"`).join(', ');
  }

  private getCompositeBatchSize(): number {
    return Math.max(
      1,
      Math.floor(POSTGRES_SAFE_IN_BATCH_SIZE / (this.key_columns.length + 1)),
    );
  }

  private formatRecordValue<T = any>(
    record: Record<string, any>,
    include_timestamps: boolean,
  ): T | { value: T; created_at: Date; updated_at: Date } {
    const value = this.deserializeValue(record.value) as T;
    if (!include_timestamps || !this.track_timestamps) {
      return value;
    }
    return {
      value,
      created_at: this.normalizeDate(record.created_at),
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
      if (!this.data_source) {
        this.data_source = new DataSource(this.data_source_options);
      }

      if (!this.data_source.isInitialized) {
        await this.data_source.initialize();
      }

      this.db = this.data_source.getRepository(this.entity_schema);

      const query_runner = this.data_source.createQueryRunner();
      try {
        const table_exists = await query_runner.hasTable(this.table_name);
        if (!table_exists) {
          const columns = this.key_columns.map((column) => ({
            name: column.name,
            type: this.getCompositeKeyColumnType(column.type || 'text'),
            ...(column.type === 'varchar'
              ? { length: String(column.length ?? 255) }
              : {}),
            isPrimary: true,
          }));

          columns.push({
            name: 'value',
            type: this.getPostgreSQLColumnType(this.value_type),
            isNullable: true,
          });

          if (this.track_timestamps) {
            columns.push(
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
            );
          }

          await query_runner.createTable(
            new Table({
              name: this.table_name,
              columns,
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
        if (this.options.create_value_index) {
          if (this.value_type === 'jsonb') {
            await query_runner.query(
              `CREATE INDEX IF NOT EXISTS "IDX_${this.table_name}_value_gin" ON "${this.table_name}" USING gin ("value")`,
            );
          } else {
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

  async put(key: CompositeKeyInput, value: any): Promise<void> {
    await this.ensureInitialized();

    const params = this.getOrderedKeyValues(key);
    const value_index = params.length + 1;
    params.push(this.serializeValueForWrite(value));
    const value_sql =
      this.value_type === 'jsonb'
        ? `$${value_index}::jsonb`
        : `$${value_index}`;
    const insert_columns = [
      ...this.key_columns.map((column) => `"${column.name}"`),
      '"value"',
      ...(this.track_timestamps ? ['"created_at"', '"updated_at"'] : []),
    ];
    const insert_values = [
      ...params.slice(0, value_index - 1).map((_, index) => `$${index + 1}`),
      value_sql,
      ...(this.track_timestamps ? ['NOW()', 'NOW()'] : []),
    ];
    const update_set = this.track_timestamps
      ? `"value" = EXCLUDED."value", "updated_at" = NOW()`
      : `"value" = EXCLUDED."value"`;

    await this.data_source.query(
      `
        INSERT INTO "${this.table_name}" (${insert_columns.join(', ')})
        VALUES (${insert_values.join(', ')})
        ON CONFLICT (${this.buildConflictColumnsSql()}) DO UPDATE SET
          ${update_set}
      `,
      params,
    );
  }

  async putIfAbsent(key: CompositeKeyInput, value: any): Promise<boolean> {
    await this.ensureInitialized();

    const params = this.getOrderedKeyValues(key);
    const value_index = params.length + 1;
    params.push(this.serializeValueForWrite(value));
    const value_sql =
      this.value_type === 'jsonb'
        ? `$${value_index}::jsonb`
        : `$${value_index}`;
    const insert_columns = [
      ...this.key_columns.map((column) => `"${column.name}"`),
      '"value"',
      ...(this.track_timestamps ? ['"created_at"', '"updated_at"'] : []),
    ];
    const insert_values = [
      ...params.slice(0, value_index - 1).map((_, index) => `$${index + 1}`),
      value_sql,
      ...(this.track_timestamps ? ['NOW()', 'NOW()'] : []),
    ];
    const rows = await this.data_source.query(
      `
        INSERT INTO "${this.table_name}" (${insert_columns.join(', ')})
        VALUES (${insert_values.join(', ')})
        ON CONFLICT (${this.buildConflictColumnsSql()}) DO NOTHING
        RETURNING 1
      `,
      params,
    );

    return rows.length > 0;
  }

  async putIfChanged(key: CompositeKeyInput, value: any): Promise<boolean> {
    await this.ensureInitialized();

    const params = this.getOrderedKeyValues(key);
    const value_index = params.length + 1;
    params.push(this.serializeValueForWrite(value));
    const value_sql =
      this.value_type === 'jsonb'
        ? `$${value_index}::jsonb`
        : `$${value_index}`;
    const insert_columns = [
      ...this.key_columns.map((column) => `"${column.name}"`),
      '"value"',
      ...(this.track_timestamps ? ['"created_at"', '"updated_at"'] : []),
    ];
    const insert_values = [
      ...params.slice(0, value_index - 1).map((_, index) => `$${index + 1}`),
      value_sql,
      ...(this.track_timestamps ? ['NOW()', 'NOW()'] : []),
    ];
    const update_set = this.track_timestamps
      ? `"value" = EXCLUDED."value", "updated_at" = NOW()`
      : `"value" = EXCLUDED."value"`;
    const rows = await this.data_source.query(
      `
        INSERT INTO "${this.table_name}" (${insert_columns.join(', ')})
        VALUES (${insert_values.join(', ')})
        ON CONFLICT (${this.buildConflictColumnsSql()}) DO UPDATE SET
          ${update_set}
        WHERE "${this.table_name}"."value" IS DISTINCT FROM EXCLUDED."value"
        RETURNING 1
      `,
      params,
    );

    return rows.length > 0;
  }

  async get<T = any>(key: CompositeKeyInput): Promise<T | null>;
  async get<T = any>(
    key: CompositeKeyInput,
    options: { include_timestamps?: boolean },
  ): Promise<T | { value: T; created_at: Date; updated_at: Date } | null>;
  async get<T = any>(
    key: CompositeKeyInput,
    options?: { include_timestamps?: boolean },
  ): Promise<T | { value: T; created_at: Date; updated_at: Date } | null> {
    await this.ensureInitialized();

    const include_timestamps =
      options?.include_timestamps === true && this.track_timestamps;
    const rows = await this.data_source.query(
      `
        SELECT ${this.buildSelectFields(include_timestamps)}
        FROM "${this.table_name}"
        WHERE ${this.buildPrimaryKeyWhereSql()}
        LIMIT 1
      `,
      this.getOrderedKeyValues(key),
    );

    if (rows.length === 0) {
      return null;
    }

    return this.formatRecordValue<T>(rows[0], include_timestamps);
  }

  async getMany<T = any>(
    keys: CompositeKeyInput[],
    options?: { include_timestamps?: boolean },
  ): Promise<
    Array<T | { value: T; created_at: Date; updated_at: Date } | null>
  > {
    if (keys.length === 0) {
      return [];
    }

    await this.ensureInitialized();
    const include_timestamps =
      options?.include_timestamps === true && this.track_timestamps;
    const results: Array<
      T | { value: T; created_at: Date; updated_at: Date } | null
    > = new Array(keys.length).fill(null);
    const batch_size = this.getCompositeBatchSize();

    for (let i = 0; i < keys.length; i += batch_size) {
      const chunk = keys.slice(i, i + batch_size);
      const params: any[] = [];
      const values_sql: string[] = [];
      const requested_columns = [
        '"__ord"',
        ...this.key_columns.map((column) => `"${column.name}"`),
      ];

      chunk.forEach((key, index) => {
        const ordered_values = this.getOrderedKeyValues(key);
        const placeholders: string[] = [];

        params.push(index);
        placeholders.push(`$${params.length}`);

        for (const value of ordered_values) {
          params.push(value);
          placeholders.push(`$${params.length}`);
        }

        values_sql.push(`(${placeholders.join(', ')})`);
      });

      const rows = await this.data_source.query(
        `
          WITH requested (${requested_columns.join(', ')}) AS (
            VALUES ${values_sql.join(', ')}
          )
          SELECT requested."__ord", t.*, (t."${this.key_columns[0]!.name}" IS NOT NULL) AS "__found"
          FROM requested
          LEFT JOIN "${this.table_name}" t
            ON ${this.buildJoinConditionSql('t', 'requested')}
          ORDER BY requested."__ord" ASC
        `,
        params,
      );

      for (const row of rows) {
        const index = Number(row.__ord);
        if (!row.__found) {
          results[i + index] = null;
          continue;
        }
        results[i + index] = this.formatRecordValue<T>(row, include_timestamps);
      }
    }

    return results;
  }

  async has(key: CompositeKeyInput): Promise<boolean> {
    await this.ensureInitialized();

    const rows = await this.data_source.query(
      `
        SELECT 1
        FROM "${this.table_name}"
        WHERE ${this.buildPrimaryKeyWhereSql()}
        LIMIT 1
      `,
      this.getOrderedKeyValues(key),
    );

    return rows.length > 0;
  }

  async delete(key: CompositeKeyInput): Promise<boolean> {
    await this.ensureInitialized();

    const rows = await this.data_source.query(
      `
        DELETE FROM "${this.table_name}"
        WHERE ${this.buildPrimaryKeyWhereSql()}
        RETURNING 1
      `,
      this.getOrderedKeyValues(key),
    );

    return rows.length > 0;
  }

  async putMany(
    entries: Array<[CompositeKeyInput, any]>,
    batch_size: number = POSTGRES_SAFE_WRITE_BATCH_SIZE,
  ): Promise<void> {
    await this.ensureInitialized();

    const deduped_entries = new Map<string, [CompositeKeyInput, any]>();
    for (const [key, value] of entries) {
      deduped_entries.set(this.getCompositeKeyIdentity(key), [key, value]);
    }

    const safe_batch_size = normalizePositiveInteger(
      batch_size,
      POSTGRES_SAFE_WRITE_BATCH_SIZE,
      POSTGRES_SAFE_WRITE_BATCH_SIZE,
    );
    const insert_columns = [
      ...this.key_columns.map((column) => `"${column.name}"`),
      '"value"',
      ...(this.track_timestamps ? ['"created_at"', '"updated_at"'] : []),
    ];
    const update_set = this.track_timestamps
      ? `"value" = EXCLUDED."value", "updated_at" = NOW()`
      : `"value" = EXCLUDED."value"`;
    const deduped_values = Array.from(deduped_entries.values());

    for (let i = 0; i < deduped_values.length; i += safe_batch_size) {
      const chunk = deduped_values.slice(i, i + safe_batch_size);
      const params: any[] = [];
      const values_sql: string[] = [];

      for (const [key, value] of chunk) {
        const ordered_values = this.getOrderedKeyValues(key);
        const placeholders: string[] = [];

        for (const ordered_value of ordered_values) {
          params.push(ordered_value);
          placeholders.push(`$${params.length}`);
        }

        params.push(this.serializeValueForWrite(value));
        placeholders.push(
          this.value_type === 'jsonb'
            ? `$${params.length}::jsonb`
            : `$${params.length}`,
        );

        if (this.track_timestamps) {
          placeholders.push('NOW()', 'NOW()');
        }

        values_sql.push(`(${placeholders.join(', ')})`);
      }

      await this.data_source.query(
        `
          INSERT INTO "${this.table_name}" (${insert_columns.join(', ')})
          VALUES ${values_sql.join(', ')}
          ON CONFLICT (${this.buildConflictColumnsSql()}) DO UPDATE SET
            ${update_set}
        `,
        params,
      );
    }
  }

  async deleteMany(keys: CompositeKeyInput[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }

    await this.ensureInitialized();

    let deleted_count = 0;
    const deduped_keys = Array.from(
      new Map(
        keys.map((key) => [this.getCompositeKeyIdentity(key), key]),
      ).values(),
    );
    const batch_size = this.getCompositeBatchSize();
    const requested_columns = this.key_columns.map(
      (column) => `"${column.name}"`,
    );

    for (let i = 0; i < deduped_keys.length; i += batch_size) {
      const chunk = deduped_keys.slice(i, i + batch_size);
      const params: any[] = [];
      const values_sql: string[] = [];

      for (const key of chunk) {
        const ordered_values = this.getOrderedKeyValues(key);
        const placeholders: string[] = [];
        for (const ordered_value of ordered_values) {
          params.push(ordered_value);
          placeholders.push(`$${params.length}`);
        }
        values_sql.push(`(${placeholders.join(', ')})`);
      }

      const rows = await this.data_source.query(
        `
          WITH requested (${requested_columns.join(', ')}) AS (
            VALUES ${values_sql.join(', ')}
          ),
          deleted AS (
            DELETE FROM "${this.table_name}" t
            USING requested
            WHERE ${this.buildJoinConditionSql('t', 'requested')}
            RETURNING 1
          )
          SELECT COUNT(*)::int AS count FROM deleted
        `,
        params,
      );

      deleted_count += Number(
        (rows[0] as { count?: number | string })?.count || 0,
      );
    }

    return deleted_count;
  }

  async count(): Promise<number> {
    await this.ensureInitialized();
    const rows = await this.data_source.query(
      `SELECT COUNT(*) AS "count" FROM "${this.table_name}"`,
    );
    return Number((rows[0] as { count?: number | string })?.count || 0);
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    await this.data_source.query(`TRUNCATE TABLE "${this.table_name}"`);
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

  getTableName(): string {
    return this.table_name;
  }

  getValueType(): ValueType {
    return this.value_type;
  }

  getKeyColumns(): CompositeKeyColumnDefinition[] {
    return [...this.key_columns];
  }
}
