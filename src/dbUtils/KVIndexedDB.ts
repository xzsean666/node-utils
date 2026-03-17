const KV_SCAN_PAGE_SIZE = 1000;
const INDEXEDDB_SAFE_WRITE_BATCH_SIZE = 100;
const INDEXEDDB_MAX_WRITE_BATCH_SIZE = 200;

interface IndexedDBRecord {
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

class EnhancedIndexedDB {
  private db: IDBDatabase | null = null;
  private db_name: string;
  private store_name: string;
  private version: number;
  private key_path: string;
  private initialized = false;

  constructor(
    db_name = 'LocalCache',
    store_name = 'LocalCache',
    version = 1,
    key_path = 'key',
  ) {
    this.db_name = db_name;
    this.store_name = store_name;
    this.version = version;
    this.key_path = key_path;
  }

  async initialize(): Promise<void> {
    if (this.initialized && this.db) {
      return;
    }

    this.db = await this.openIndexDB(this.db_name, this.version, this.key_path);
    this.initialized = true;
  }

  private async openIndexDB(
    db_name: string,
    version = 1,
    key_path = 'key',
  ): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB is not available in this environment'));
        return;
      }

      const request = window.indexedDB.open(db_name, version);

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = (event) => {
        reject(
          new Error(
            `Failed to open IndexedDB: ${(event.target as IDBRequest).error}`,
          ),
        );
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.store_name)) {
          db.createObjectStore(this.store_name, { keyPath: key_path });
        }

        const store = request.transaction!.objectStore(this.store_name);
        if (!store.indexNames.contains('updated_at')) {
          store.createIndex('updated_at', 'updated_at', { unique: false });
        }
        if (!store.indexNames.contains('created_at')) {
          store.createIndex('created_at', 'created_at', { unique: false });
        }
      };
    });
  }

  private async ensureInitialized(): Promise<IDBDatabase> {
    if (!this.initialized || !this.db) {
      await this.initialize();
    }

    if (!this.db) {
      throw new Error('Database initialization failed');
    }

    return this.db;
  }

  private formatRecordValue<T = any>(
    record: IndexedDBRecord,
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

  private getScanDirection(order_by?: 'ASC' | 'DESC'): IDBCursorDirection {
    return order_by === 'DESC' ? 'prev' : 'next';
  }

  private getPrefixRange(prefix?: string): IDBKeyRange | undefined {
    if (!prefix) {
      return undefined;
    }

    return window.IDBKeyRange.bound(prefix, `${prefix}\uffff`, false, true);
  }

  private getScanRange(options?: KeyScanOptions): IDBKeyRange | undefined {
    if (options?.prefix) {
      return this.getPrefixRange(options.prefix);
    }

    if (!options?.cursor) {
      return undefined;
    }

    return options.order_by === 'DESC'
      ? window.IDBKeyRange.upperBound(options.cursor, true)
      : window.IDBKeyRange.lowerBound(options.cursor, true);
  }

  private shouldSkipScannedKey(key: string, options?: KeyScanOptions): boolean {
    if (options?.prefix && !key.startsWith(options.prefix)) {
      return true;
    }

    if (!options?.cursor) {
      return false;
    }

    if (options.order_by === 'DESC') {
      return key >= options.cursor;
    }

    return key <= options.cursor;
  }

  private async getInternal<T = any>(
    key: string,
    options: {
      expire?: number;
      include_timestamps: boolean;
      delete_expired: boolean;
    },
  ): Promise<T | { value: T; created_at: Date; updated_at: Date } | null> {
    const db = await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        [this.store_name],
        options.delete_expired ? 'readwrite' : 'readonly',
      );
      const store = transaction.objectStore(this.store_name);
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result as IndexedDBRecord | undefined;

        if (!record) {
          resolve(null);
          return;
        }

        if (this.isExpired(record.created_at, options.expire)) {
          if (!options.delete_expired) {
            resolve(null);
            return;
          }

          const delete_request = store.delete(key);
          delete_request.onsuccess = () => resolve(null);
          delete_request.onerror = () =>
            reject(new Error('Failed to delete expired data'));
          return;
        }

        resolve(this.formatRecordValue<T>(record, options.include_timestamps));
      };

      request.onerror = () => reject(new Error('Failed to retrieve data'));
      transaction.onerror = () => reject(new Error('Transaction failed'));
    });
  }

  private async findByValue(
    value: any,
    first_only: boolean,
  ): Promise<any | any[]> {
    const db = await this.ensureInitialized();
    const value_str = stableStringify(value);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.store_name], 'readonly');
      const store = transaction.objectStore(this.store_name);
      const request = store.openCursor();
      const results: IndexedDBRecord[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as
          | IDBCursorWithValue
          | null;

        if (!cursor) {
          resolve(first_only ? results[0] || null : results);
          return;
        }

        const record = cursor.value as IndexedDBRecord;
        if (stableStringify(record.value) === value_str) {
          if (first_only) {
            resolve(record);
            return;
          }
          results.push(record);
        }

        cursor.continue();
      };

      request.onerror = () => reject(new Error('Failed to search by value'));
      transaction.onerror = () => reject(new Error('Transaction failed'));
    });
  }

  async put(key: string, value: any): Promise<void> {
    const db = await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.store_name], 'readwrite');
      const store = transaction.objectStore(this.store_name);
      const now = new Date();
      const get_request = store.get(key);

      get_request.onsuccess = () => {
        const existing = get_request.result as IndexedDBRecord | undefined;
        const put_request = store.put({
          key,
          value,
          created_at: existing?.created_at ?? now,
          updated_at: now,
        });

        put_request.onerror = () => reject(new Error('Failed to store data'));
      };

      get_request.onerror = () =>
        reject(new Error('Failed to check existing data'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Transaction failed'));
    });
  }

  async get<T = any>(key: string, expire?: number): Promise<T | null>;
  async get<T = any>(
    key: string,
    options?: GetOptions,
  ): Promise<T | { value: T; created_at: Date; updated_at: Date } | null>;
  async get<T = any>(
    key: string,
    options_or_expire?: number | GetOptions,
  ): Promise<T | { value: T; created_at: Date; updated_at: Date } | null> {
    if (typeof options_or_expire === 'number' || options_or_expire === undefined) {
      return this.getInternal<T>(key, {
        expire: options_or_expire,
        include_timestamps: false,
        delete_expired: true,
      });
    }

    return this.getInternal<T>(key, {
      expire: options_or_expire.expire,
      include_timestamps: options_or_expire.include_timestamps === true,
      delete_expired: true,
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

  async merge(key: string, partial_value: any): Promise<boolean> {
    const db = await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.store_name], 'readwrite');
      const store = transaction.objectStore(this.store_name);
      const get_request = store.get(key);

      get_request.onsuccess = () => {
        const existing = get_request.result as IndexedDBRecord | undefined;
        const merged_value = deepMergeJsonValues(existing?.value ?? null, partial_value);

        if (existing && areValuesEqual(existing.value, merged_value)) {
          resolve(false);
          return;
        }

        const now = new Date();
        const put_request = store.put({
          key,
          value: merged_value,
          created_at: existing?.created_at ?? now,
          updated_at: now,
        });

        put_request.onsuccess = () => resolve(true);
        put_request.onerror = () => reject(new Error('Failed to merge data'));
      };

      get_request.onerror = () =>
        reject(new Error('Failed to get existing data'));
      transaction.onerror = () => reject(new Error('Transaction failed'));
    });
  }

  async getValue(value: any): Promise<any> {
    return this.findByValue(value, true);
  }

  async isValueExists(value: any): Promise<boolean> {
    const result = await this.findByValue(value, true);
    return !!result;
  }

  async delete(key: string): Promise<boolean> {
    const db = await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.store_name], 'readwrite');
      const store = transaction.objectStore(this.store_name);
      const get_request = store.getKey(key);

      get_request.onsuccess = () => {
        if (get_request.result === undefined) {
          resolve(false);
          return;
        }

        const delete_request = store.delete(key);
        delete_request.onsuccess = () => resolve(true);
        delete_request.onerror = () => reject(new Error('Failed to delete data'));
      };

      get_request.onerror = () => reject(new Error('Failed to check existing data'));
      transaction.onerror = () => reject(new Error('Transaction failed'));
    });
  }

  async add(key: string, value: any): Promise<void> {
    if (!(await this.putIfAbsent(key, value))) {
      throw new Error(`Key "${key}" already exists`);
    }
  }

  async putIfAbsent(key: string, value: any): Promise<boolean> {
    const db = await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.store_name], 'readwrite');
      const store = transaction.objectStore(this.store_name);
      const now = new Date();
      const request = store.add({
        key,
        value,
        created_at: now,
        updated_at: now,
      });

      request.onsuccess = () => resolve(true);
      request.onerror = () => {
        const error = request.error;
        if (error?.name === 'ConstraintError') {
          resolve(false);
          return;
        }
        reject(new Error('Failed to add data'));
      };

      transaction.onerror = () => reject(new Error('Transaction failed'));
    });
  }

  async putIfChanged(key: string, value: any): Promise<boolean> {
    const db = await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.store_name], 'readwrite');
      const store = transaction.objectStore(this.store_name);
      const get_request = store.get(key);

      get_request.onsuccess = () => {
        const existing = get_request.result as IndexedDBRecord | undefined;
        if (existing && areValuesEqual(existing.value, value)) {
          resolve(false);
          return;
        }

        const now = new Date();
        const put_request = store.put({
          key,
          value,
          created_at: existing?.created_at ?? now,
          updated_at: now,
        });

        put_request.onsuccess = () => resolve(true);
        put_request.onerror = () =>
          reject(new Error('Failed to store changed data'));
      };

      get_request.onerror = () =>
        reject(new Error('Failed to check existing data'));
      transaction.onerror = () => reject(new Error('Transaction failed'));
    });
  }

  async addUniquePair(key: string, value: any): Promise<void> {
    if (!(await this.putIfAbsent(key, value))) {
      throw new Error(`Key-value pair already exists for key "${key}"`);
    }
  }

  async addUniqueValue(key: string, value: any): Promise<void> {
    if (await this.isValueExists(value)) {
      throw new Error('Value already exists in the database');
    }

    if (!(await this.putIfAbsent(key, value))) {
      throw new Error(`Key "${key}" already exists`);
    }
  }

  async close(): Promise<void> {
    if (!this.db) {
      return;
    }

    this.db.close();
    this.db = null;
    this.initialized = false;
  }

  async getAll(offset?: number, limit?: number): Promise<Map<string, any>> {
    if (typeof offset !== 'number' && typeof limit !== 'number') {
      const results = new Map<string, any>();
      let cursor: string | undefined;

      while (true) {
        const page = await this.scan({
          cursor,
          limit: KV_SCAN_PAGE_SIZE,
        });

        for (const [key, value] of Object.entries(page.data)) {
          results.set(key, value);
        }

        if (!page.next_cursor) {
          return results;
        }

        cursor = page.next_cursor;
      }
    }

    const db = await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.store_name], 'readonly');
      const store = transaction.objectStore(this.store_name);
      const request = store.openCursor();
      const results = new Map<string, any>();
      let counter = 0;

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as
          | IDBCursorWithValue
          | null;

        if (!cursor) {
          resolve(results);
          return;
        }

        if (typeof offset === 'number' && offset > 0 && counter < offset) {
          counter++;
          cursor.continue();
          return;
        }

        if (typeof limit === 'number' && limit > 0 && results.size >= limit) {
          resolve(results);
          return;
        }

        const record = cursor.value as IndexedDBRecord;
        results.set(record.key, record.value);
        counter++;
        cursor.continue();
      };

      request.onerror = () => reject(new Error('Failed to get all data'));
      transaction.onerror = () => reject(new Error('Transaction failed'));
    });
  }

  async keys(): Promise<string[]> {
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
    const db = await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.store_name], 'readonly');
      const store = transaction.objectStore(this.store_name);
      const request = store.getKey(key);

      request.onsuccess = () => resolve(request.result !== undefined);
      request.onerror = () =>
        reject(new Error('Failed to check key existence'));
      transaction.onerror = () => reject(new Error('Transaction failed'));
    });
  }

  async scanKeys(
    options?: KeyScanOptions,
  ): Promise<{ data: string[]; next_cursor: string | null }> {
    const db = await this.ensureInitialized();
    const limit = normalizePositiveInteger(options?.limit, 100, 1000);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.store_name], 'readonly');
      const store = transaction.objectStore(this.store_name);
      const request = store.openCursor(
        this.getScanRange(options),
        this.getScanDirection(options?.order_by),
      );
      const keys: string[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as
          | IDBCursorWithValue
          | null;

        if (!cursor) {
          resolve({
            data: keys,
            next_cursor: null,
          });
          return;
        }

        const key = String(cursor.primaryKey);
        if (this.shouldSkipScannedKey(key, options)) {
          cursor.continue();
          return;
        }

        keys.push(key);
        if (keys.length > limit) {
          const data = keys.slice(0, limit);
          resolve({
            data,
            next_cursor: data[data.length - 1] || null,
          });
          return;
        }

        cursor.continue();
      };

      request.onerror = () => reject(new Error('Failed to scan keys'));
      transaction.onerror = () => reject(new Error('Transaction failed'));
    });
  }

  async scan<T = any>(
    options?: KeyScanOptions & { include_timestamps?: boolean },
  ): Promise<{
    data: Record<string, T | { value: T; created_at: Date; updated_at: Date }>;
    next_cursor: string | null;
  }> {
    const db = await this.ensureInitialized();
    const limit = normalizePositiveInteger(options?.limit, 100, 1000);
    const include_timestamps = options?.include_timestamps === true;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.store_name], 'readonly');
      const store = transaction.objectStore(this.store_name);
      const request = store.openCursor(
        this.getScanRange(options),
        this.getScanDirection(options?.order_by),
      );
      const results: Array<{
        key: string;
        value: T | { value: T; created_at: Date; updated_at: Date };
      }> = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as
          | IDBCursorWithValue
          | null;

        if (!cursor) {
          resolve({
            data: results.reduce(
              (acc, entry) => {
                acc[entry.key] = entry.value;
                return acc;
              },
              {} as Record<
                string,
                T | { value: T; created_at: Date; updated_at: Date }
              >,
            ),
            next_cursor: null,
          });
          return;
        }

        const key = String(cursor.primaryKey);
        if (this.shouldSkipScannedKey(key, options)) {
          cursor.continue();
          return;
        }

        const record = cursor.value as IndexedDBRecord;
        results.push({
          key,
          value: this.formatRecordValue<T>(record, include_timestamps),
        });

        if (results.length > limit) {
          const page = results.slice(0, limit);
          resolve({
            data: page.reduce(
              (acc, entry) => {
                acc[entry.key] = entry.value;
                return acc;
              },
              {} as Record<
                string,
                T | { value: T; created_at: Date; updated_at: Date }
              >,
            ),
            next_cursor: page[page.length - 1]?.key || null,
          });
          return;
        }

        cursor.continue();
      };

      request.onerror = () => reject(new Error('Failed to scan data'));
      transaction.onerror = () => reject(new Error('Transaction failed'));
    });
  }

  async putMany(
    entries: Array<[string, any]>,
    batch_size: number = INDEXEDDB_SAFE_WRITE_BATCH_SIZE,
  ): Promise<void> {
    const db = await this.ensureInitialized();
    const deduped_entries = dedupeEntriesByKey(entries);
    const safe_batch_size = normalizePositiveInteger(
      batch_size,
      INDEXEDDB_SAFE_WRITE_BATCH_SIZE,
      INDEXEDDB_MAX_WRITE_BATCH_SIZE,
    );

    for (let i = 0; i < deduped_entries.length; i += safe_batch_size) {
      const batch = deduped_entries.slice(i, i + safe_batch_size);
      if (batch.length === 0) {
        continue;
      }

      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([this.store_name], 'readwrite');
        const store = transaction.objectStore(this.store_name);
        const now = new Date();

        for (const [key, value] of batch) {
          const get_request = store.get(key);
          get_request.onsuccess = () => {
            const existing = get_request.result as IndexedDBRecord | undefined;
            const put_request = store.put({
              key,
              value,
              created_at: existing?.created_at ?? now,
              updated_at: now,
            });

            put_request.onerror = () =>
              reject(new Error('Failed to store batch data'));
          };

          get_request.onerror = () =>
            reject(new Error('Failed to check existing data'));
        }

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(new Error('Batch transaction failed'));
      });
    }
  }

  async deleteMany(keys: string[]): Promise<number> {
    const db = await this.ensureInitialized();
    const unique_keys = Array.from(new Set(keys));
    if (unique_keys.length === 0) {
      return 0;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.store_name], 'readwrite');
      const store = transaction.objectStore(this.store_name);
      let deleted = 0;

      for (const key of unique_keys) {
        const get_request = store.getKey(key);
        get_request.onsuccess = () => {
          if (get_request.result === undefined) {
            return;
          }

          const delete_request = store.delete(key);
          delete_request.onsuccess = () => {
            deleted++;
          };
          delete_request.onerror = () =>
            reject(new Error('Failed to delete data'));
        };

        get_request.onerror = () =>
          reject(new Error('Failed to check existing data'));
      }

      transaction.oncomplete = () => resolve(deleted);
      transaction.onerror = () =>
        reject(new Error('Failed to delete multiple keys'));
    });
  }

  async clear(): Promise<void> {
    const db = await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.store_name], 'readwrite');
      const store = transaction.objectStore(this.store_name);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to clear database'));
      transaction.onerror = () => reject(new Error('Transaction failed'));
    });
  }

  async count(): Promise<number> {
    const db = await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.store_name], 'readonly');
      const store = transaction.objectStore(this.store_name);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Failed to count records'));
      transaction.onerror = () => reject(new Error('Transaction failed'));
    });
  }

  async findBoolValues(
    bool_value: boolean,
    first: boolean = true,
    order_by: 'ASC' | 'DESC' = 'ASC',
  ): Promise<string[] | string | null> {
    const db = await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.store_name], 'readonly');
      const store = transaction.objectStore(this.store_name);
      const index = store.index('created_at');
      const request = index.openCursor(undefined, this.getScanDirection(order_by));
      const results: string[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as
          | IDBCursorWithValue
          | null;

        if (!cursor) {
          resolve(first ? results[0] || null : results);
          return;
        }

        const record = cursor.value as IndexedDBRecord;
        if (record.value === bool_value) {
          if (first) {
            resolve(record.key);
            return;
          }

          results.push(record.key);
        }

        cursor.continue();
      };

      request.onerror = () =>
        reject(new Error('Failed to find boolean values'));
      transaction.onerror = () => reject(new Error('Transaction failed'));
    });
  }

  async findByUpdateTime(
    timestamp: number,
    first: boolean = true,
    type: 'before' | 'after' = 'after',
    order_by: 'ASC' | 'DESC' = 'ASC',
  ): Promise<string[] | string | null> {
    const db = await this.ensureInitialized();
    const compare_date = new Date(timestamp);
    const range =
      type === 'before'
        ? window.IDBKeyRange.upperBound(compare_date, true)
        : window.IDBKeyRange.lowerBound(compare_date, true);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.store_name], 'readonly');
      const store = transaction.objectStore(this.store_name);
      const index = store.index('updated_at');
      const request = index.openCursor(range, this.getScanDirection(order_by));
      const results: string[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as
          | IDBCursorWithValue
          | null;

        if (!cursor) {
          resolve(first ? results[0] || null : results);
          return;
        }

        const record = cursor.value as IndexedDBRecord;
        if (first) {
          resolve(record.key);
          return;
        }

        results.push(record.key);
        cursor.continue();
      };

      request.onerror = () =>
        reject(new Error('Failed to find by update time'));
      transaction.onerror = () => reject(new Error('Transaction failed'));
    });
  }

  async searchByTime(params: {
    timestamp: number;
    take?: number;
    type?: 'before' | 'after';
    order_by?: 'ASC' | 'DESC';
    time_column?: 'updated_at' | 'created_at';
  }): Promise<Array<{ key: string; value: any }>> {
    const db = await this.ensureInitialized();
    const compare_date = new Date(params.timestamp);
    const type = params.type || 'after';
    const time_column = params.time_column || 'updated_at';
    const take = normalizePositiveInteger(params.take, 1, 1000);
    const range =
      type === 'before'
        ? window.IDBKeyRange.upperBound(compare_date, true)
        : window.IDBKeyRange.lowerBound(compare_date, true);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.store_name], 'readonly');
      const store = transaction.objectStore(this.store_name);
      const index = store.index(time_column);
      const request = index.openCursor(
        range,
        this.getScanDirection(params.order_by),
      );
      const results: Array<{ key: string; value: any }> = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as
          | IDBCursorWithValue
          | null;

        if (!cursor) {
          resolve(results);
          return;
        }

        const record = cursor.value as IndexedDBRecord;
        results.push({
          key: record.key,
          value: record.value,
        });

        if (results.length >= take) {
          resolve(results);
          return;
        }

        cursor.continue();
      };

      request.onerror = () => reject(new Error('Failed to search by time'));
      transaction.onerror = () => reject(new Error('Transaction failed'));
    });
  }
}

export default EnhancedIndexedDB;
