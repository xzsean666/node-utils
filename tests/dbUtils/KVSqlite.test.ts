import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SqliteKVDatabase, SqliteValueType } from '../../src/dbUtils/KVSqlite';

describe('SqliteKVDatabase regressions', () => {
  let db: SqliteKVDatabase;
  let db_path: string;

  beforeEach(() => {
    fs.mkdirSync(path.join(process.cwd(), '.tmp'), { recursive: true });
    db_path = path.join(
      process.cwd(),
      '.tmp',
      `kvsqlite-test-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
    );
    db = new SqliteKVDatabase(db_path, 'kv_store', SqliteValueType.JSON);
  });

  afterEach(async () => {
    await db.close();
    try {
      fs.unlinkSync(db_path);
    } catch {
      // ignore cleanup failures in tests
    }
  });

  it('supports offset-only getAll queries', async () => {
    await db.put('a', { value: 1 });
    await db.put('b', { value: 2 });
    await db.put('c', { value: 3 });

    const rows = await db.getAll({ offset: 1 });

    expect(Object.keys(rows)).toEqual(['b', 'c']);
  });

  it('matches prefix queries for unicode keys', async () => {
    await db.put('ab中', { value: 1 });
    await db.put('abz', { value: 2 });
    await db.put('ab%', { value: 3 });
    await db.put('other', { value: 4 });

    const rows = await db.getWithPrefix('ab');

    expect(Object.keys(rows)).toEqual(['ab%', 'abz', 'ab中']);
  });

  it('treats prefix search input as literal text', async () => {
    await db.put('ab%', { value: 1 });
    await db.put('abz', { value: 2 });

    const rows = await db.getWithPrefix('ab%');

    expect(Object.keys(rows)).toEqual(['ab%']);
  });

  it('returns a boolean from putIfAbsent without overwriting existing values', async () => {
    expect(await db.putIfAbsent('user:1', { value: 1 })).toBe(true);
    expect(await db.putIfAbsent('user:1', { value: 2 })).toBe(false);
    expect(await db.get('user:1')).toEqual({ value: 1 });
  });

  it('returns whether putIfChanged actually wrote new data', async () => {
    await db.put('user:1', { value: 1 });

    expect(await db.putIfChanged('user:1', { value: 1 })).toBe(false);
    expect(await db.putIfChanged('user:1', { value: 2 })).toBe(true);
    expect(await db.get('user:1')).toEqual({ value: 2 });
  });

  it('treats fuzzy LIKE searches as literal text', async () => {
    const text_db_path = path.join(
      process.cwd(),
      '.tmp',
      `kvsqlite-text-test-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
    );
    const text_db = new SqliteKVDatabase(
      text_db_path,
      'text_store',
      SqliteValueType.TEXT,
    );

    try {
      await text_db.put('literal', '100% match');
      await text_db.put('wildcard', '1000 match');

      expect(await text_db.findByValue('100%', false)).toEqual(['literal']);
    } finally {
      await text_db.close();
      try {
        fs.unlinkSync(text_db_path);
      } catch {
        // ignore cleanup failures in tests
      }
    }
  });

  it('serializes concurrent merges on the same instance', async () => {
    await db.put('merge-key', { base: true });

    await Promise.all([
      db.merge('merge-key', { left: 1 }),
      db.merge('merge-key', { right: 2 }),
    ]);

    expect(await db.get('merge-key')).toEqual({
      base: true,
      left: 1,
      right: 2,
    });
  });

  it('deep merges nested JSON objects', async () => {
    await db.put('user:1', {
      name: 'John',
      preferences: {
        theme: 'dark',
        notifications: {
          email: true,
        },
      },
    });

    await db.merge('user:1', {
      preferences: {
        notifications: {
          push: true,
        },
        language: 'en',
      },
    });

    expect(await db.get('user:1')).toEqual({
      name: 'John',
      preferences: {
        theme: 'dark',
        notifications: {
          email: true,
          push: true,
        },
        language: 'en',
      },
    });
  });

  it('returns null from getIfFresh without deleting stale data', async () => {
    await db.put('stale', { value: 1 });
    await (db as any).data_source.query(
      `UPDATE "kv_store" SET "created_at" = ?, "updated_at" = ? WHERE "key" = ?`,
      ['2000-01-01 00:00:00', '2000-01-01 00:00:00', 'stale'],
    );

    await expect(db.getIfFresh('stale', 1)).resolves.toBeNull();
    await expect(db.has('stale')).resolves.toBe(true);
  });

  it('keeps get(expire) cleanup behavior for stale rows', async () => {
    await db.put('expired', { value: 1 });
    await (db as any).data_source.query(
      `UPDATE "kv_store" SET "created_at" = ?, "updated_at" = ? WHERE "key" = ?`,
      ['2000-01-01 00:00:00', '2000-01-01 00:00:00', 'expired'],
    );

    await expect(db.get('expired', 1)).resolves.toBeNull();
    await expect(db.has('expired')).resolves.toBe(false);
  });

  it('wraps putMany in a transaction across batches', async () => {
    const integer_db_path = path.join(
      process.cwd(),
      '.tmp',
      `kvsqlite-integer-test-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
    );
    const integer_db = new SqliteKVDatabase(
      integer_db_path,
      'integer_store',
      SqliteValueType.INTEGER,
    );

    try {
      await expect(
        integer_db.putMany(
          [
            ['first', 1],
            ['second', 1.5],
          ],
          1,
        ),
      ).rejects.toThrow('INTEGER type requires integer value');

      expect(await integer_db.count()).toBe(0);
      expect(await integer_db.has('first')).toBe(false);
    } finally {
      await integer_db.close();
      try {
        fs.unlinkSync(integer_db_path);
      } catch {
        // ignore cleanup failures in tests
      }
    }
  });

  it('scans keys and values with cursor pagination', async () => {
    await db.put('item:1', { value: 1 });
    await db.put('item:2', { value: 2 });
    await db.put('item:3', { value: 3 });
    await db.put('other:1', { value: 4 });

    const key_page_1 = await db.scanKeys({ prefix: 'item:', limit: 2 });
    expect(key_page_1).toEqual({
      data: ['item:1', 'item:2'],
      next_cursor: 'item:2',
    });

    const key_page_2 = await db.scanKeys({
      prefix: 'item:',
      cursor: key_page_1.next_cursor || undefined,
      limit: 2,
    });
    expect(key_page_2).toEqual({
      data: ['item:3'],
      next_cursor: null,
    });

    const value_page = await db.scan<{ value: number }>({
      prefix: 'item:',
      limit: 2,
    });
    expect(value_page).toEqual({
      data: {
        'item:1': { value: 1 },
        'item:2': { value: 2 },
      },
      next_cursor: 'item:2',
    });
  });

  it('aggregates paginated scanKeys results in keys()', async () => {
    let call_count = 0;
    (db as any).scanKeys = async () => {
      call_count += 1;
      return call_count === 1
        ? { data: ['a', 'b'], next_cursor: 'b' }
        : { data: ['c'], next_cursor: null };
    };

    await expect(db.keys()).resolves.toEqual(['a', 'b', 'c']);
  });

  it('aggregates paginated scan results in unbounded getAll()', async () => {
    let call_count = 0;
    (db as any).scan = async () => {
      call_count += 1;
      return call_count === 1
        ? {
            data: {
              a: { value: 1 },
              b: { value: 2 },
            },
            next_cursor: 'b',
          }
        : {
            data: {
              c: { value: 3 },
            },
            next_cursor: null,
          };
    };

    await expect(db.getAll()).resolves.toEqual({
      a: { value: 1 },
      b: { value: 2 },
      c: { value: 3 },
    });
  });

  it('rejects unsafe table names', () => {
    expect(
      () => new SqliteKVDatabase(':memory:', 'kv_store;DROP TABLE x'),
    ).toThrow('table_name must match');
  });

  it('stores sqlite timestamps with fractional seconds', async () => {
    await db.put('time:key', { value: 1 });

    const rows = await (db as any).data_source.query(
      `SELECT "created_at", "updated_at" FROM "kv_store" WHERE "key" = ?`,
      ['time:key'],
    );

    expect(rows[0].created_at).toMatch(/\.\d{3}$/);
    expect(rows[0].updated_at).toMatch(/\.\d{3}$/);
  });

  it('allows disabling sqlite timestamp indexes during initialization', async () => {
    const sqlite = new SqliteKVDatabase(
      ':memory:',
      'kv_store',
      SqliteValueType.JSON,
      {
        create_created_at_index: false,
        create_updated_at_index: false,
      },
    );
    const queries: string[] = [];
    const query_runner = {
      hasTable: () => true,
      query: (query: string) => {
        queries.push(query);
        return [];
      },
      release: () => {},
    };

    (sqlite as any).data_source = {
      isInitialized: true,
      getRepository: () => ({}),
      createQueryRunner: () => query_runner,
      options: { synchronize: false },
    };

    await (sqlite as any).ensureInitialized();

    expect(
      queries.some((query) => query.includes('IDX_kv_store_created_at')),
    ).toBe(false);
    expect(
      queries.some((query) => query.includes('IDX_kv_store_updated_at')),
    ).toBe(false);
  });
});
