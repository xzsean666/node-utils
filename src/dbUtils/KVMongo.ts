import { Collection, MongoClient } from 'mongodb';

const KV_SCAN_PAGE_SIZE = 1000;
const MONGO_SAFE_WRITE_BATCH_SIZE = 1000;

interface MongoKVRecord {
  key: string;
  value: any;
  created_at: Date;
  updated_at: Date;
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
  delete_expired?: boolean;
}

type CompareOperator = '>' | '<' | '>=' | '<=' | '=' | '!=';

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

function isNodeBuffer(value: unknown): value is Buffer {
  return typeof Buffer !== 'undefined' && Buffer.isBuffer(value);
}

function isMergeableJsonObject(value: unknown): value is Record<string, any> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !isNodeBuffer(value) &&
    !(value instanceof Uint8Array) &&
    !(value instanceof Date) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function deepMergeJsonValues(existing_value: any, incoming_value: any): any {
  if (!isMergeableJsonObject(existing_value) || !isMergeableJsonObject(incoming_value)) {
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

function normalizeComparableValue(value: any): any {
  if (value instanceof Date) {
    return {
      __type: 'Date',
      value: value.toISOString(),
    };
  }

  if (isNodeBuffer(value)) {
    return {
      __type: 'Buffer',
      value: Array.from(value.values()),
    };
  }

  if (value instanceof Uint8Array) {
    return {
      __type: 'Uint8Array',
      value: Array.from(value),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeComparableValue(item));
  }

  if (isMergeableJsonObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key] = normalizeComparableValue(value[key]);
          return acc;
        },
        {} as Record<string, any>,
      );
  }

  return value;
}

function stableStringify(value: any): string {
  return JSON.stringify(normalizeComparableValue(value));
}

function areValuesEqual(left: any, right: any): boolean {
  return stableStringify(left) === stableStringify(right);
}

function appendNestedEqualsFilters(
  base_path: string,
  value: any,
  query: Record<string, any>,
): void {
  if (isMergeableJsonObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      appendNestedEqualsFilters(`${base_path}.${key}`, child, query);
    }
    return;
  }

  query[base_path] = value;
}

function toMongoCompareOperator(operator: CompareOperator): string {
  switch (operator) {
    case '>':
      return '$gt';
    case '<':
      return '$lt';
    case '>=':
      return '$gte';
    case '<=':
      return '$lte';
    case '=':
      return '$eq';
    case '!=':
      return '$ne';
  }
}

export class MongoKVDatabase {
  private client: MongoClient;
  private collection!: Collection<MongoKVRecord>;
  private initialized = false;
  private collection_name: string;

  constructor(connectionString: string, collectionName: string = 'kv_store') {
    this.collection_name = collectionName;
    this.client = new MongoClient(connectionString, {
      maxPoolSize: 50,
      minPoolSize: 5,
      connectTimeoutMS: 3000,
      socketTimeoutMS: 15000,
      serverSelectionTimeoutMS: 15000,
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.client.connect();
    this.collection = this.client
      .db()
      .collection<MongoKVRecord>(this.collection_name);

    await this.collection.createIndex({ key: 1 }, { unique: true });
    await this.collection.createIndex({ value: 1 });
    await this.collection.createIndex({ created_at: 1 });
    await this.collection.createIndex({ updated_at: 1 });

    this.initialized = true;
  }

  private formatRecordValue<T = any>(
    record: MongoKVRecord,
    include_timestamps: boolean,
  ): T | { value: T; created_at: Date; updated_at: Date } {
    const value = record.value as T;
    if (!include_timestamps) {
      return value;
    }

    return {
      value,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
  }

  private isExpired(created_at: Date, expire?: number): boolean {
    return (
      expire !== undefined &&
      Math.floor(Date.now() / 1000) - Math.floor(created_at.getTime() / 1000) >
        expire
    );
  }

  private async deleteRecordIfCurrent(
    record: Pick<MongoKVRecord, 'key' | 'created_at' | 'updated_at'>,
  ): Promise<boolean> {
    const result = await this.collection.deleteOne({
      key: record.key,
      created_at: record.created_at,
      updated_at: record.updated_at,
    });

    return result.deletedCount > 0;
  }

  private buildKeyQuery(options?: KeyScanOptions): Record<string, any> {
    if (!options?.prefix && !options?.cursor) {
      return {};
    }

    const order_by = options?.order_by === 'DESC' ? 'DESC' : 'ASC';
    const key_query: Record<string, string> = {};
    const prefix_upper_bound = options?.prefix
      ? `${options.prefix}\uffff`
      : undefined;

    if (options?.prefix) {
      key_query.$gte = options.prefix;
      key_query.$lt = prefix_upper_bound!;
    }

    if (options?.cursor) {
      if (order_by === 'DESC') {
        key_query.$lt =
          prefix_upper_bound === undefined || options.cursor < prefix_upper_bound
            ? options.cursor
            : prefix_upper_bound;
      } else {
        key_query.$gt = options.cursor;
      }
    }

    return {
      key: key_query,
    };
  }

  private async getInternal<T = any>(
    key: string,
    options: {
      expire?: number;
      include_timestamps: boolean;
      delete_expired: boolean;
    },
  ): Promise<T | { value: T; created_at: Date; updated_at: Date } | null> {
    await this.ensureInitialized();

    const record = await this.collection.findOne(
      { key },
      {
        projection: {
          _id: 0,
          key: 1,
          value: 1,
          created_at: 1,
          updated_at: 1,
        },
      },
    );

    if (!record) {
      return null;
    }

    if (this.isExpired(record.created_at, options.expire)) {
      if (options.delete_expired) {
        await this.deleteRecordIfCurrent(record);
      }
      return null;
    }

    return this.formatRecordValue<T>(record, options.include_timestamps);
  }

  private buildTimeQuery(
    timestamp: number,
    type: 'before' | 'after',
    time_column: 'updated_at' | 'created_at',
  ): Record<string, any> {
    return {
      [time_column]: {
        [type === 'before' ? '$lt' : '$gt']: new Date(timestamp),
      },
    };
  }

  async put(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    const now = new Date();

    await this.collection.updateOne(
      { key },
      {
        $set: {
          key,
          value,
          updated_at: now,
        },
        $setOnInsert: {
          created_at: now,
        },
      },
      { upsert: true },
    );
  }

  async get<T = any>(
    key: string,
    expire?: number,
    deleteExpired?: boolean,
  ): Promise<T | null>;
  async get<T = any>(
    key: string,
    options?: GetOptions,
  ): Promise<T | { value: T; created_at: Date; updated_at: Date } | null>;
  async get<T = any>(
    key: string,
    options_or_expire?: number | GetOptions,
    delete_expired: boolean = true,
  ): Promise<T | { value: T; created_at: Date; updated_at: Date } | null> {
    if (typeof options_or_expire === 'number' || options_or_expire === undefined) {
      return this.getInternal<T>(key, {
        expire: options_or_expire,
        include_timestamps: false,
        delete_expired,
      });
    }

    return this.getInternal<T>(key, {
      expire: options_or_expire.expire,
      include_timestamps: options_or_expire.include_timestamps === true,
      delete_expired: options_or_expire.delete_expired !== false,
    });
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
    if (typeof options_or_expire === 'number') {
      return this.getInternal<T>(key, {
        expire: options_or_expire,
        include_timestamps: false,
        delete_expired: false,
      });
    }

    return this.getInternal<T>(key, {
      expire: options_or_expire.expire,
      include_timestamps: options_or_expire.include_timestamps === true,
      delete_expired: false,
    });
  }

  async merge(key: string, partialValue: any): Promise<boolean> {
    await this.ensureInitialized();

    const existing = await this.collection.findOne(
      { key },
      {
        projection: {
          _id: 0,
          key: 1,
          value: 1,
          created_at: 1,
          updated_at: 1,
        },
      },
    );

    const merged_value = deepMergeJsonValues(existing?.value ?? null, partialValue);
    if (existing && areValuesEqual(existing.value, merged_value)) {
      return false;
    }

    await this.put(key, merged_value);
    return true;
  }

  async getValue(value: any): Promise<any> {
    await this.ensureInitialized();
    return this.collection.findOne(
      { value },
      {
        projection: {
          _id: 0,
          key: 1,
          value: 1,
          created_at: 1,
          updated_at: 1,
        },
      },
    );
  }

  async isValueExists(value: any): Promise<boolean> {
    await this.ensureInitialized();
    const existing = await this.collection.findOne(
      { value },
      {
        projection: { _id: 1 },
      },
    );
    return existing !== null;
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureInitialized();
    const result = await this.collection.deleteOne({ key });
    return result.deletedCount > 0;
  }

  async add(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    if (!(await this.putIfAbsent(key, value))) {
      throw new Error(`Key "${key}" already exists`);
    }
  }

  async putIfAbsent(key: string, value: any): Promise<boolean> {
    await this.ensureInitialized();
    const now = new Date();

    const result = await this.collection.updateOne(
      { key },
      {
        $setOnInsert: {
          key,
          value,
          created_at: now,
          updated_at: now,
        },
      },
      { upsert: true },
    );

    return result.upsertedCount > 0;
  }

  async putIfChanged(key: string, value: any): Promise<boolean> {
    await this.ensureInitialized();

    const existing = await this.collection.findOne(
      { key },
      {
        projection: {
          _id: 0,
          value: 1,
        },
      },
    );

    if (existing && areValuesEqual(existing.value, value)) {
      return false;
    }

    await this.put(key, value);
    return true;
  }

  async addUniquePair(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    if (!(await this.putIfAbsent(key, value))) {
      throw new Error(`Key-value pair already exists for key "${key}"`);
    }
  }

  async addUniqueValue(key: string, value: any): Promise<void> {
    await this.ensureInitialized();

    const existing = await this.collection.findOne(
      { value },
      {
        projection: {
          _id: 0,
          key: 1,
        },
      },
    );

    if (existing) {
      throw new Error(`Value already exists with key "${existing.key}"`);
    }

    const now = new Date();
    try {
      await this.collection.insertOne({
        key,
        value,
        created_at: now,
        updated_at: now,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new Error(`Key "${key}" already exists`);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    await this.client.close();
    this.initialized = false;
  }

  async getAll<T = any>(
    offset?: number,
    limit?: number,
    options?: { include_timestamps?: boolean },
  ): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  > {
    await this.ensureInitialized();

    if (typeof offset === 'number' || typeof limit === 'number') {
      const include_timestamps = options?.include_timestamps === true;
      const cursor = this.collection
        .find(
          {},
          {
            projection: include_timestamps
              ? {
                  _id: 0,
                  key: 1,
                  value: 1,
                  created_at: 1,
                  updated_at: 1,
                }
              : {
                  _id: 0,
                  key: 1,
                  value: 1,
                },
          },
        )
        .sort({ key: 1 });

      if (typeof offset === 'number' && offset > 0) {
        cursor.skip(Math.floor(offset));
      }

      if (typeof limit === 'number' && limit > 0) {
        cursor.limit(Math.floor(limit));
      }

      const records = (await cursor.toArray()) as MongoKVRecord[];
      return records.reduce(
        (
          acc: Record<
            string,
            T | { value: T; created_at: Date; updated_at: Date }
          >,
          record: MongoKVRecord,
        ) => {
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
      );
    }

    const results: Record<
      string,
      T | { value: T; created_at: Date; updated_at: Date }
    > = {};
    let cursor: string | undefined;

    while (true) {
      const page = await this.scan<T>({
        cursor,
        limit: KV_SCAN_PAGE_SIZE,
        include_timestamps: options?.include_timestamps,
      });
      Object.assign(results, page.data);

      if (!page.next_cursor) {
        return results;
      }

      cursor = page.next_cursor;
    }
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
    const existing = await this.collection.findOne(
      { key },
      {
        projection: { _id: 1 },
      },
    );
    return existing !== null;
  }

  async scanKeys(
    options?: KeyScanOptions,
  ): Promise<{ data: string[]; next_cursor: string | null }> {
    await this.ensureInitialized();

    const limit = normalizePositiveInteger(options?.limit, 100, 1000);
    const order_by = options?.order_by === 'DESC' ? 'DESC' : 'ASC';
    const records = (await this.collection
      .find(this.buildKeyQuery(options), {
        projection: {
          _id: 0,
          key: 1,
        },
      })
      .sort({ key: order_by === 'DESC' ? -1 : 1 })
      .limit(limit + 1)
      .toArray()) as Array<Pick<MongoKVRecord, 'key'>>;

    const has_more = records.length > limit;
    const page_records = has_more ? records.slice(0, limit) : records;

    return {
      data: page_records.map((record: Pick<MongoKVRecord, 'key'>) => record.key),
      next_cursor: has_more ? page_records[page_records.length - 1]?.key || null : null,
    };
  }

  async scan<T = any>(
    options?: KeyScanOptions & {
      include_timestamps?: boolean;
    },
  ): Promise<{
    data: Record<string, T | { value: T; created_at: Date; updated_at: Date }>;
    next_cursor: string | null;
  }> {
    await this.ensureInitialized();

    const limit = normalizePositiveInteger(options?.limit, 100, 1000);
    const include_timestamps = options?.include_timestamps === true;
    const order_by = options?.order_by === 'DESC' ? 'DESC' : 'ASC';
    const records = (await this.collection
      .find(this.buildKeyQuery(options), {
        projection: include_timestamps
          ? {
              _id: 0,
              key: 1,
              value: 1,
              created_at: 1,
              updated_at: 1,
            }
          : {
              _id: 0,
              key: 1,
              value: 1,
            },
      })
      .sort({ key: order_by === 'DESC' ? -1 : 1 })
      .limit(limit + 1)
      .toArray()) as MongoKVRecord[];

    const has_more = records.length > limit;
    const page_records = has_more ? records.slice(0, limit) : records;

    return {
      data: page_records.reduce(
        (
          acc: Record<
            string,
            T | { value: T; created_at: Date; updated_at: Date }
          >,
          record: MongoKVRecord,
        ) => {
          acc[record.key] = this.formatRecordValue<T>(record, include_timestamps);
          return acc;
        },
        {} as Record<
          string,
          T | { value: T; created_at: Date; updated_at: Date }
        >,
      ),
      next_cursor: has_more ? page_records[page_records.length - 1]?.key || null : null,
    };
  }

  async putMany(
    entries: Array<[string, any]>,
    batchSize: number = MONGO_SAFE_WRITE_BATCH_SIZE,
  ): Promise<void> {
    await this.ensureInitialized();

    const deduped_entries = dedupeEntriesByKey(entries);
    const safe_batch_size = normalizePositiveInteger(
      batchSize,
      MONGO_SAFE_WRITE_BATCH_SIZE,
      MONGO_SAFE_WRITE_BATCH_SIZE,
    );

    for (let i = 0; i < deduped_entries.length; i += safe_batch_size) {
      const batch = deduped_entries.slice(i, i + safe_batch_size);
      const now = new Date();
      const operations = batch.map(([key, value]) => ({
        updateOne: {
          filter: { key },
          update: {
            $set: {
              key,
              value,
              updated_at: now,
            },
            $setOnInsert: {
              created_at: now,
            },
          },
          upsert: true,
        },
      }));

      if (operations.length > 0) {
        await this.collection.bulkWrite(operations);
      }
    }
  }

  async deleteMany(keys: string[]): Promise<number> {
    await this.ensureInitialized();

    const unique_keys = Array.from(new Set(keys));
    if (unique_keys.length === 0) {
      return 0;
    }

    const result = await this.collection.deleteMany({
      key: { $in: unique_keys },
    });
    return result.deletedCount;
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    await this.collection.deleteMany({});
  }

  async count(): Promise<number> {
    await this.ensureInitialized();
    return this.collection.estimatedDocumentCount();
  }

  async findBoolValues(
    boolValue: boolean,
    first: boolean = true,
    orderBy: 'ASC' | 'DESC' = 'ASC',
  ): Promise<string[] | string | null> {
    await this.ensureInitialized();

    const sort_value = orderBy === 'ASC' ? 1 : -1;
    if (first) {
      const record = await this.collection.findOne(
        { value: boolValue },
        {
          projection: {
            _id: 0,
            key: 1,
          },
          sort: {
            created_at: sort_value,
          },
        },
      );
      return record?.key || null;
    }

    const results = (await this.collection
      .find(
        { value: boolValue },
        {
          projection: {
            _id: 0,
            key: 1,
          },
        },
      )
      .sort({ created_at: sort_value })
      .toArray()) as Array<Pick<MongoKVRecord, 'key'>>;

    return results.map((record: Pick<MongoKVRecord, 'key'>) => record.key);
  }

  async searchJson(searchOptions: {
    contains?: object;
    limit?: number;
    cursor?: string;
    compare?: Array<{
      path: string;
      operator: CompareOperator;
      value: number | string | Date;
    }>;
  }): Promise<{
    data: any[];
    nextCursor: string | null;
  }> {
    await this.ensureInitialized();

    const limit = normalizePositiveInteger(searchOptions.limit, 100, 1000);
    const query: Record<string, any> = {};

    if (searchOptions.contains) {
      appendNestedEqualsFilters('value', searchOptions.contains, query);
    }

    if (searchOptions.compare) {
      for (const condition of searchOptions.compare) {
        query[`value.${condition.path}`] = {
          [toMongoCompareOperator(condition.operator)]: condition.value,
        };
      }
    }

    if (searchOptions.cursor) {
      query.key = {
        ...(query.key || {}),
        $gt: searchOptions.cursor,
      };
    }

    const results = (await this.collection
      .find(query, {
        projection: {
          _id: 0,
          key: 1,
          value: 1,
          created_at: 1,
          updated_at: 1,
        },
      })
      .sort({ key: 1 })
      .limit(limit + 1)
      .toArray()) as MongoKVRecord[];

    const has_more = results.length > limit;
    const data = has_more ? results.slice(0, limit) : results;

    return {
      data,
      nextCursor: has_more ? data[data.length - 1]?.key || null : null,
    };
  }

  async findByUpdateTime(
    timestamp: number,
    first: boolean = true,
    type: 'before' | 'after' = 'after',
    orderBy: 'ASC' | 'DESC' = 'ASC',
  ): Promise<string[] | string | null> {
    await this.ensureInitialized();

    const query = this.buildTimeQuery(timestamp, type, 'updated_at');
    const sort_value = orderBy === 'ASC' ? 1 : -1;

    if (first) {
      const record = await this.collection.findOne(query, {
        projection: {
          _id: 0,
          key: 1,
        },
        sort: {
          updated_at: sort_value,
        },
      });
      return record?.key || null;
    }

    const results = (await this.collection
      .find(query, {
        projection: {
          _id: 0,
          key: 1,
        },
      })
      .sort({ updated_at: sort_value })
      .toArray()) as Array<Pick<MongoKVRecord, 'key'>>;

    return results.map((record: Pick<MongoKVRecord, 'key'>) => record.key);
  }

  async searchByTime(params: {
    timestamp: number;
    take?: number;
    type?: 'before' | 'after';
    orderBy?: 'ASC' | 'DESC';
    timeColumn?: 'updated_at' | 'created_at';
  }): Promise<Array<{ key: string; value: any }>> {
    await this.ensureInitialized();

    const time_column = params.timeColumn || 'updated_at';
    const sort_value = (params.orderBy || 'ASC') === 'DESC' ? -1 : 1;

    return this.collection
      .find(this.buildTimeQuery(params.timestamp, params.type || 'after', time_column), {
        projection: {
          _id: 0,
          key: 1,
          value: 1,
        },
      })
      .sort({ [time_column]: sort_value })
      .limit(normalizePositiveInteger(params.take, 1, 1000))
      .toArray();
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
    },
  ): Promise<Array<{ key: string; value: any }>> {
    await this.ensureInitialized();

    const time_column = timeOptions.timeColumn || 'updated_at';
    const query = this.buildTimeQuery(
      timeOptions.timestamp,
      timeOptions.type || 'after',
      time_column,
    );

    if (searchOptions.contains) {
      appendNestedEqualsFilters('value', searchOptions.contains, query);
    }

    if (searchOptions.equals) {
      query.value = searchOptions.equals;
    }

    if (searchOptions.path && searchOptions.value !== undefined) {
      query[`value.${searchOptions.path}`] = searchOptions.value;
    }

    return this.collection
      .find(query, {
        projection: {
          _id: 0,
          key: 1,
          value: 1,
        },
      })
      .sort({ [time_column]: (timeOptions.orderBy || 'ASC') === 'DESC' ? -1 : 1 })
      .limit(normalizePositiveInteger(timeOptions.take, 1, 1000))
      .toArray();
  }
}
