import {
  PGKVDatabase as ModernPGKVDatabase,
  type ValueType,
} from './KVPostgresql';

export class KVDatabase {
  private readonly db: ModernPGKVDatabase;

  constructor(datasourceOrUrl: string, tableName: string = 'kv_store') {
    this.db = new ModernPGKVDatabase(datasourceOrUrl, tableName, 'jsonb');
  }

  async put(key: string, value: any): Promise<void> {
    await this.db.put(key, value);
  }

  async merge(key: string, partialValue: any): Promise<boolean> {
    return this.db.merge(key, partialValue);
  }

  async get<T = any>(key: string, expire?: number): Promise<T | null> {
    return this.db.get<T>(key, expire);
  }

  async getIfFresh<T = any>(key: string, expire: number): Promise<T | null> {
    return this.db.getIfFresh<T>(key, expire);
  }

  async isValueExists(value: any): Promise<boolean> {
    return this.db.isValueExists(value);
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

  async addUniquePair(key: string, value: any): Promise<void> {
    await this.db.addUniquePair(key, value);
  }

  async addUniqueValue(key: string, value: any): Promise<void> {
    await this.db.addUniqueValue(key, value);
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  async getAll(
    offset?: number,
    limit?: number,
  ): Promise<Map<string, any>> {
    const records = await this.db.getAll({
      offset,
      limit,
    });
    return new Map(Object.entries(records));
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

  async findBoolValues(
    boolValue: boolean,
    first: boolean = true,
    orderBy: 'ASC' | 'DESC' = 'ASC',
  ): Promise<string[] | string | null> {
    return this.db.findBoolValues(boolValue, first, orderBy);
  }

  async searchJson(searchOptions: {
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
    nextCursor: string | null;
  }> {
    const result = await this.db.searchJson(searchOptions);
    return {
      data: result.data,
      nextCursor: result.next_cursor,
    };
  }

  async findByUpdateTime(
    timestamp: number,
    first: boolean = true,
    type: 'before' | 'after' = 'after',
    orderBy: 'ASC' | 'DESC' = 'ASC',
  ): Promise<string[] | string | null> {
    return this.db.findByUpdateTime(timestamp, first, type, orderBy);
  }

  async searchByTime(params: {
    timestamp: number;
    take?: number;
    type?: 'before' | 'after';
    orderBy?: 'ASC' | 'DESC';
    timeColumn?: 'updated_at' | 'created_at';
    include_timestamps?: boolean;
  }): Promise<
    Array<{
      key: string;
      value: any;
      created_at?: Date;
      updated_at?: Date;
    }>
  > {
    return this.db.searchByTime({
      timestamp: params.timestamp,
      take: params.take,
      type: params.type,
      order_by: params.orderBy,
      time_column: params.timeColumn,
      include_timestamps: params.include_timestamps,
    });
  }

  async searchJsonByTime(
    searchOptions: {
      contains?: object;
      equals?: object;
      path?: string;
      value?: any;
    },
    timeOptions: {
      timestamp: number;
      take?: number;
      type?: 'before' | 'after';
      orderBy?: 'ASC' | 'DESC';
      timeColumn?: 'updated_at' | 'created_at';
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
    return this.db.searchJsonByTime(searchOptions, {
      timestamp: timeOptions.timestamp,
      take: timeOptions.take,
      type: timeOptions.type,
      order_by: timeOptions.orderBy,
      time_column: timeOptions.timeColumn,
      include_timestamps: timeOptions.include_timestamps,
    });
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
      contains?: string;
      case_sensitive?: boolean;
      created_at_after?: number;
      created_at_before?: number;
    },
  ): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    return this.db.getWithPrefix<T>(prefix, options);
  }

  isOperationSupported(operation: string): boolean {
    return this.db.isOperationSupported(operation);
  }

  getValueType(): ValueType {
    return this.db.getValueType();
  }
}
