import { describe, expect, it } from 'vitest';

import { PGKVDatabase } from '../../src/dbUtils/KVPostgresql';

describe('PGKVDatabase cursor helpers', () => {
  it('encodes and decodes composite cursors for stable pagination', () => {
    const db = new PGKVDatabase('postgres://user:pass@localhost:5432/testdb');
    const encoded = (db as any).formatSearchCursor(
      new Date('2024-01-01T00:00:00.000Z'),
      'key-1',
    );

    expect((db as any).parseSearchCursor(encoded)).toEqual({
      value: '2024-01-01T00:00:00.000Z',
      key: 'key-1',
    });
  });

  it('keeps backward compatibility for legacy plain-string cursors', () => {
    const db = new PGKVDatabase('postgres://user:pass@localhost:5432/testdb');

    expect((db as any).parseSearchCursor('legacy-cursor')).toEqual({
      value: 'legacy-cursor',
      key: null,
    });
  });

  it('falls back to plain suffix search when reverse index data is unavailable', async () => {
    const db = new PGKVDatabase('postgres://user:pass@localhost:5432/testdb');
    const suffix_fallback = { target: { value: 1 } };

    (db as any).ensureInitialized = () => {};
    (db as any).getWithPrefix = () => ({});
    (db as any).queryBySuffix = () => suffix_fallback;

    await expect((db as any).getWithSuffixOptimized('tail')).resolves.toBe(
      suffix_fallback,
    );
  });

  it('returns a boolean from putIfAbsent without throwing', async () => {
    const db = new PGKVDatabase('postgres://user:pass@localhost:5432/testdb');

    (db as any).ensureInitialized = () => {};
    (db as any).data_source = {
      query: () => [{ key: 'user:1' }],
      isInitialized: false,
    };

    await expect(db.putIfAbsent('user:1', { value: 1 })).resolves.toBe(true);

    (db as any).data_source.query = () => [];
    await expect(db.putIfAbsent('user:1', { value: 1 })).resolves.toBe(false);
  });

  it('returns whether putIfChanged actually updated the row', async () => {
    const db = new PGKVDatabase('postgres://user:pass@localhost:5432/testdb');

    (db as any).ensureInitialized = () => {};
    (db as any).data_source = {
      query: (_query: string, params: any[]) =>
        params[1] === '{"value":2}' ? [{ key: 'user:1' }] : [],
      isInitialized: false,
    };

    await expect(db.putIfChanged('user:1', { value: 1 })).resolves.toBe(false);
    await expect(db.putIfChanged('user:1', { value: 2 })).resolves.toBe(true);
  });

  it('returns null from getIfFresh without deleting stale data', async () => {
    const db = new PGKVDatabase('postgres://user:pass@localhost:5432/testdb');
    let delete_called = false;

    (db as any).ensureInitialized = () => {};
    (db as any).delete = () => {
      delete_called = true;
      return true;
    };
    (db as any).data_source = {
      query: () => [
        {
          key: 'stale',
          value: { value: 1 },
          created_at: '2000-01-01T00:00:00.000Z',
          updated_at: '2000-01-01T00:00:00.000Z',
        },
      ],
      isInitialized: false,
    };

    await expect(db.getIfFresh('stale', 1)).resolves.toBeNull();
    expect(delete_called).toBe(false);
  });

  it('uses an idempotent merge query that skips no-op updates', async () => {
    const db = new PGKVDatabase('postgres://user:pass@localhost:5432/testdb');
    let captured_query = '';

    (db as any).ensureInitialized = () => {};
    (db as any).data_source = {
      query: (query: string) => {
        captured_query = query;
        return [];
      },
      isInitialized: false,
    };

    await expect(
      db.merge('user:1', { profile: { theme: 'dark' } }),
    ).resolves.toBe(false);

    expect(captured_query).toContain('IS DISTINCT FROM');
    expect(captured_query).toContain('jsonb_deep_merge');
  });

  it('creates a json field index only when it is missing', async () => {
    const db = new PGKVDatabase('postgres://user:pass@localhost:5432/testdb');
    const queries: string[] = [];

    (db as any).ensureInitialized = () => {};
    (db as any).data_source = {
      query: (query: string) => {
        queries.push(query);
        if (query.includes('FROM pg_indexes')) {
          return [];
        }
        return [];
      },
      isInitialized: false,
    };

    await expect(
      db.ensureJsonFieldIndex('profile.id', {
        index_name: 'IDX_kv_store_profile_id',
      }),
    ).resolves.toEqual({
      index_name: 'IDX_kv_store_profile_id',
      created: true,
      message: 'Index "IDX_kv_store_profile_id" created on table "kv_store"',
    });

    const create_index_query = queries.find((query) =>
      query.includes('CREATE INDEX IF NOT EXISTS "IDX_kv_store_profile_id"'),
    );
    expect(create_index_query).toContain(
      `ON "kv_store" ((\"value\" #>> ARRAY['profile', 'id']))`,
    );
    expect(create_index_query).toContain(
      `WHERE ("value" #>> ARRAY['profile', 'id']) IS NOT NULL`,
    );
  });

  it('returns already exists when the json field index is already present', async () => {
    const db = new PGKVDatabase('postgres://user:pass@localhost:5432/testdb');
    const queries: string[] = [];

    (db as any).ensureInitialized = () => {};
    (db as any).data_source = {
      query: (query: string) => {
        queries.push(query);
        if (query.includes('FROM pg_indexes')) {
          return [{ exists: 1 }];
        }
        return [];
      },
      isInitialized: false,
    };

    await expect(
      db.ensureJsonFieldIndex('profile.id', {
        index_name: 'IDX_kv_store_profile_id',
      }),
    ).resolves.toEqual({
      index_name: 'IDX_kv_store_profile_id',
      created: false,
      message:
        'Index "IDX_kv_store_profile_id" already exists on table "kv_store"',
    });

    expect(
      queries.some((query) =>
        query.includes('CREATE INDEX IF NOT EXISTS "IDX_kv_store_profile_id"'),
      ),
    ).toBe(false);
  });

  it('creates a numeric json field index only when it is missing', async () => {
    const db = new PGKVDatabase('postgres://user:pass@localhost:5432/testdb');
    const queries: string[] = [];

    (db as any).ensureInitialized = () => {};
    (db as any).data_source = {
      query: (query: string) => {
        queries.push(query);
        if (query.includes('FROM pg_indexes')) {
          return [];
        }
        return [];
      },
      isInitialized: false,
    };

    await expect(
      db.ensureJsonNumberFieldIndex('profile.score', {
        index_name: 'IDX_kv_store_profile_score_num',
      }),
    ).resolves.toEqual({
      index_name: 'IDX_kv_store_profile_score_num',
      created: true,
      message:
        'Index "IDX_kv_store_profile_score_num" created on table "kv_store"',
    });

    const create_index_query = queries.find((query) =>
      query.includes(
        'CREATE INDEX IF NOT EXISTS "IDX_kv_store_profile_score_num"',
      ),
    );
    expect(create_index_query).toContain(
      `THEN ("value" #>> ARRAY['profile', 'score'])::numeric`,
    );
    expect(create_index_query).toContain(`WHERE (`);
    expect(create_index_query).toContain(`IS NOT NULL`);
  });

  it('inlines json paths in queries so field indexes can be reused', async () => {
    const db = new PGKVDatabase('postgres://user:pass@localhost:5432/testdb');
    let captured_query = '';
    let captured_params: any[] = [];

    (db as any).ensureInitialized = () => {};
    (db as any).data_source = {
      query: (query: string, params: any[]) => {
        captured_query = query;
        captured_params = params;
        return [];
      },
      isInitialized: false,
    };

    await expect(
      db.searchJsonByTime(
        {
          path: 'profile.id',
          value: '123',
        },
        {
          timestamp: 0,
        },
      ),
    ).resolves.toEqual([]);

    expect(captured_query).toContain(`"value" #>> ARRAY['profile', 'id']`);
    expect(captured_params).toEqual([new Date(0), '123', 1]);
  });

  it('builds numeric comparisons with the same safe numeric expression', async () => {
    const db = new PGKVDatabase('postgres://user:pass@localhost:5432/testdb');
    let captured_query = '';
    let captured_params: any[] = [];

    (db as any).ensureInitialized = () => {};
    (db as any).data_source = {
      query: (query: string, params: any[]) => {
        captured_query = query;
        captured_params = params;
        return [];
      },
      isInitialized: false,
    };

    await expect(
      db.searchJson({
        compare: [
          {
            path: 'profile.score',
            operator: '>',
            value: 100,
          },
        ],
      }),
    ).resolves.toEqual({
      data: [],
      next_cursor: null,
    });

    expect(captured_query).toContain(
      `THEN ("value" #>> ARRAY['profile', 'score'])::numeric`,
    );
    expect(captured_params).toEqual([100]);
  });

  it('does not overwrite an existing key in addUniqueValue', async () => {
    const db = new PGKVDatabase('postgres://user:pass@localhost:5432/testdb');
    const queries: Array<{ sql: string; params: any[] }> = [];
    const query_runner = {
      connect: async () => {},
      startTransaction: async () => {},
      commitTransaction: async () => {},
      rollbackTransaction: async () => {},
      release: async () => {},
      query: (sql: string, params: any[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('pg_advisory_xact_lock')) {
          return [];
        }
        if (sql.includes('SELECT "key" FROM "kv_store" WHERE')) {
          return [];
        }
        if (sql.includes('ON CONFLICT ("key") DO NOTHING')) {
          return [];
        }
        return [];
      },
    };

    (db as any).ensureInitialized = async () => {};
    (db as any).data_source = {
      createQueryRunner: () => query_runner,
      isInitialized: false,
    };

    await expect(db.addUniqueValue('user:1', { value: 1 })).rejects.toThrow(
      'Key "user:1" already exists',
    );
    expect(
      queries.some((entry) =>
        entry.sql.includes('ON CONFLICT ("key") DO NOTHING'),
      ),
    ).toBe(true);
  });

  it('scans keys with cursor pagination', async () => {
    const db = new PGKVDatabase('postgres://user:pass@localhost:5432/testdb');
    let captured_query = '';
    let captured_params: any[] = [];

    (db as any).ensureInitialized = () => {};
    (db as any).data_source = {
      query: (query: string, params: any[]) => {
        captured_query = query;
        captured_params = params;
        return [{ key: 'item:1' }, { key: 'item:2' }, { key: 'item:3' }];
      },
      isInitialized: false,
    };

    await expect(
      db.scanKeys({ prefix: 'item:', cursor: 'item:0', limit: 2 }),
    ).resolves.toEqual({
      data: ['item:1', 'item:2'],
      next_cursor: 'item:2',
    });

    expect(captured_query).toContain(`"key" LIKE $1 ESCAPE '\\'`);
    expect(captured_query).toContain(`"key" > $2`);
    expect(captured_params).toEqual(['item:%', 'item:0', 3]);
  });

  it('aggregates paginated scanKeys results in keys()', async () => {
    const db = new PGKVDatabase('postgres://user:pass@localhost:5432/testdb');
    let call_count = 0;

    (db as any).ensureInitialized = () => {};
    (db as any).scanKeys = () => {
      call_count += 1;
      return call_count === 1
        ? { data: ['a', 'b'], next_cursor: 'b' }
        : { data: ['c'], next_cursor: null };
    };

    await expect(db.keys()).resolves.toEqual(['a', 'b', 'c']);
  });

  it('aggregates paginated scan results in unbounded getAll()', async () => {
    const db = new PGKVDatabase('postgres://user:pass@localhost:5432/testdb');
    let call_count = 0;

    (db as any).ensureInitialized = () => {};
    (db as any).scan = () => {
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
      () =>
        new PGKVDatabase(
          'postgres://user:pass@localhost:5432/testdb',
          'kv_store;DROP TABLE x',
        ),
    ).toThrow('table_name must match');
  });

  it('defaults to no extra indexes for write-optimized jsonb tables', async () => {
    const db = new PGKVDatabase('postgres://user:pass@localhost:5432/testdb');
    const queries: string[] = [];
    const query_runner = {
      hasTable: () => true,
      query: (query: string) => {
        queries.push(query);
        return [];
      },
      release: () => {},
    };

    (db as any).data_source = {
      isInitialized: true,
      getRepository: () => ({}),
      createQueryRunner: () => query_runner,
    };

    await (db as any).ensureInitialized();

    expect(
      queries.some((query) => query.includes('IDX_kv_store_created_at')),
    ).toBe(false);
    expect(
      queries.some((query) => query.includes('IDX_kv_store_updated_at')),
    ).toBe(false);
    expect(
      queries.some((query) => query.includes('IDX_kv_store_value_gin')),
    ).toBe(false);
  });

  it('creates default indexes only when explicitly enabled', async () => {
    const db = new PGKVDatabase(
      'postgres://user:pass@localhost:5432/testdb',
      'kv_store',
      'jsonb',
      {
        create_created_at_index: true,
        create_updated_at_index: true,
        create_value_index: true,
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

    (db as any).data_source = {
      isInitialized: true,
      getRepository: () => ({}),
      createQueryRunner: () => query_runner,
    };

    await (db as any).ensureInitialized();

    expect(
      queries.some((query) => query.includes('IDX_kv_store_created_at')),
    ).toBe(true);
    expect(
      queries.some((query) => query.includes('IDX_kv_store_updated_at')),
    ).toBe(true);
    expect(
      queries.some((query) => query.includes('IDX_kv_store_value_gin')),
    ).toBe(true);
  });
});
