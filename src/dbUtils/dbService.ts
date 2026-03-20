import type { PGKVDatabaseOptions, ValueType } from "./KVPostgresql";
import { PGKVDatabase } from "./KVPostgresql";
import type { SqliteKVDatabaseOptions } from "./KVSqlite";
import { SqliteKVDatabase, SqliteValueType } from "./KVSqlite";

interface CloseableDatabase {
  close(): Promise<void>;
}

function assertNonEmptyString(value: string, label: string): void {
  if (!value) {
    throw new Error(`${label} is required`);
  }
}

function createTableNameNormalizer(options?: {
  prefix?: string;
  normalizeTableName?: (tableName: string) => string;
}): (tableName: string) => string {
  const applyPrefix = (tableName: string) =>
    options?.prefix ? `${options.prefix}_${tableName}` : tableName;

  if (!options?.normalizeTableName) {
    return applyPrefix;
  }

  return (tableName: string) =>
    options.normalizeTableName!(applyPrefix(tableName));
}

export interface DatabaseManagerOptions<
  TDatabase extends CloseableDatabase,
  TKey extends string = string,
> {
  create: (resolvedKey: string) => TDatabase;
  normalizeKey?: (key: TKey) => string;
}

export class DatabaseManager<
  TDatabase extends CloseableDatabase,
  TKey extends string = string,
> {
  private readonly instances = new Map<string, TDatabase>();
  private readonly createDatabase: (resolvedKey: string) => TDatabase;
  private readonly normalizeDatabaseKey: (key: TKey) => string;

  constructor(options: DatabaseManagerOptions<TDatabase, TKey>) {
    this.createDatabase = options.create;
    this.normalizeDatabaseKey = options.normalizeKey || ((key) => key);
  }

  protected resolveKey(key: TKey): string {
    const resolvedKey = this.normalizeDatabaseKey(key);
    assertNonEmptyString(resolvedKey, "resolvedKey");
    return resolvedKey;
  }

  get size(): number {
    return this.instances.size;
  }

  public keys(): string[] {
    return Array.from(this.instances.keys());
  }

  public has(key: TKey): boolean {
    return this.instances.has(this.resolveKey(key));
  }

  public peek(key: TKey): TDatabase | undefined {
    return this.instances.get(this.resolveKey(key));
  }

  public get(key: TKey): TDatabase {
    const resolvedKey = this.resolveKey(key);
    const existingInstance = this.instances.get(resolvedKey);
    if (existingInstance) {
      return existingInstance;
    }

    const nextInstance = this.createDatabase(resolvedKey);
    this.instances.set(resolvedKey, nextInstance);
    return nextInstance;
  }

  public async delete(key: TKey): Promise<boolean> {
    const resolvedKey = this.resolveKey(key);
    const instance = this.instances.get(resolvedKey);
    if (!instance) {
      return false;
    }

    await instance.close();
    this.instances.delete(resolvedKey);
    return true;
  }

  public async destroy(): Promise<void> {
    const entries = Array.from(this.instances.entries());
    const results = await Promise.allSettled(
      entries.map(async ([resolvedKey, instance]) => {
        await instance.close();
        return resolvedKey;
      }),
    );

    const errors: string[] = [];

    results.forEach((result, index) => {
      const [resolvedKey] = entries[index]!;
      if (result.status === "fulfilled") {
        this.instances.delete(resolvedKey);
        return;
      }

      errors.push(
        `${resolvedKey}: ${
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
        }`,
      );
    });

    if (errors.length > 0) {
      throw new Error(errors.join("; "));
    }
  }
}

export interface TableDatabaseManagerOptions<
  TDatabase extends CloseableDatabase,
> extends DatabaseManagerOptions<TDatabase, string> {}

export class TableDatabaseManager<
  TDatabase extends CloseableDatabase,
> extends DatabaseManager<TDatabase, string> {
  constructor(options: TableDatabaseManagerOptions<TDatabase>) {
    super(options);
  }

  public hasTable(tableName: string): boolean {
    return this.has(tableName);
  }

  public peekTable(tableName: string): TDatabase | undefined {
    return this.peek(tableName);
  }

  public getTable(tableName: string): TDatabase {
    return this.get(tableName);
  }

  public async deleteTable(tableName: string): Promise<boolean> {
    return this.delete(tableName);
  }
}

export interface PGKVDatabaseManagerOptions {
  prefix?: string;
  normalizeTableName?: (tableName: string) => string;
  valueType?: ValueType;
  dbOptions?: PGKVDatabaseOptions;
}

export class PGKVDatabaseManager extends TableDatabaseManager<PGKVDatabase> {
  readonly dbUrl: string;
  readonly valueType: ValueType;
  readonly dbOptions?: PGKVDatabaseOptions;

  constructor(dbUrl: string, options: PGKVDatabaseManagerOptions = {}) {
    assertNonEmptyString(dbUrl, "dbUrl");

    const normalizeKey = createTableNameNormalizer({
      prefix: options.prefix,
      normalizeTableName: options.normalizeTableName,
    });
    const valueType = options.valueType || "jsonb";
    const dbOptions = options.dbOptions;

    super({
      normalizeKey,
      create: (tableName) =>
        new PGKVDatabase(dbUrl, tableName, valueType, dbOptions),
    });

    this.dbUrl = dbUrl;
    this.valueType = valueType;
    this.dbOptions = dbOptions;
  }
}

export interface SqliteKVDatabaseManagerOptions {
  normalizeTableName?: (tableName: string) => string;
  valueType?: SqliteValueType;
  dbOptions?: SqliteKVDatabaseOptions;
}

export class SqliteKVDatabaseManager extends TableDatabaseManager<SqliteKVDatabase> {
  readonly dbPath: string;
  readonly valueType: SqliteValueType;
  readonly dbOptions?: SqliteKVDatabaseOptions;

  constructor(dbPath: string, options: SqliteKVDatabaseManagerOptions = {}) {
    assertNonEmptyString(dbPath, "dbPath");

    const normalizeKey =
      options.normalizeTableName || ((tableName: string) => tableName);
    const valueType = options.valueType || SqliteValueType.JSON;
    const dbOptions = options.dbOptions;

    super({
      normalizeKey,
      create: (tableName) =>
        new SqliteKVDatabase(dbPath, tableName, valueType, dbOptions),
    });

    this.dbPath = dbPath;
    this.valueType = valueType;
    this.dbOptions = dbOptions;
  }
}
