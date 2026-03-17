import {
  SqliteKVDatabase as ModernSqliteKVDatabase,
  SqliteValueType,
} from './KVSqlite';

export class KVDatabase {
  private readonly db: ModernSqliteKVDatabase;

  constructor(datasourceOrUrl?: string, tableName: string = 'kv_store') {
    this.db = new ModernSqliteKVDatabase(
      datasourceOrUrl,
      tableName,
      SqliteValueType.JSON,
    );
  }

  async put(key: string, value: any): Promise<void> {
    await this.db.put(key, value);
  }

  async get<T = any>(
    key: string,
    expire?: number,
    deleteExpired: boolean = true,
  ): Promise<T | null> {
    if (expire !== undefined && !deleteExpired) {
      return this.db.getIfFresh<T>(key, expire);
    }

    return this.db.get<T>(key, expire);
  }

  async getIfFresh<T = any>(key: string, expire: number): Promise<T | null> {
    return this.db.getIfFresh<T>(key, expire);
  }

  async delete(key: string): Promise<boolean> {
    return this.db.delete(key);
  }

  async add(key: string, value: any): Promise<void> {
    await this.db.add(key, value);
  }

  async putIfAbsent(key: string, value: any): Promise<boolean> {
    return this.db.putIfAbsent(key, value);
  }

  async putIfChanged(key: string, value: any): Promise<boolean> {
    return this.db.putIfChanged(key, value);
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  async getAll(): Promise<Record<string, any>> {
    return this.db.getAll();
  }

  async getMany(limit: number = 10): Promise<Record<string, any>> {
    const page = await this.db.scan({
      limit,
    });
    return page.data as Record<string, any>;
  }

  async keys(): Promise<string[]> {
    return this.db.keys();
  }

  async has(key: string): Promise<boolean> {
    return this.db.has(key);
  }

  async putMany(
    entries: Array<[string, any]>,
    batchSize: number = 1000,
  ): Promise<void> {
    await this.db.putMany(entries, batchSize);
  }

  async deleteMany(keys: string[]): Promise<number> {
    return this.db.deleteMany(keys);
  }

  async clear(): Promise<void> {
    await this.db.clear();
  }

  async count(): Promise<number> {
    return this.db.count();
  }

  async findByValue(value: any, exact: boolean = true): Promise<string[]> {
    return this.db.findByValue(value, exact);
  }

  async scanKeys(options?: {
    cursor?: string;
    limit?: number;
    order_by?: 'ASC' | 'DESC';
    prefix?: string;
  }): Promise<{ data: string[]; next_cursor: string | null }> {
    return this.db.scanKeys(options);
  }

  async scan<T = any>(options?: {
    cursor?: string;
    limit?: number;
    order_by?: 'ASC' | 'DESC';
    prefix?: string;
    include_timestamps?: boolean;
  }): Promise<{
    data: Record<string, T | { value: T; created_at: Date; updated_at: Date }>;
    next_cursor: string | null;
  }> {
    return this.db.scan<T>(options);
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
    return this.db.getWithPrefix<T>(prefix, options);
  }
}
