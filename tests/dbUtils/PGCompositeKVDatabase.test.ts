import { describe, expect, it } from 'vitest';

import { PGCompositeKVDatabase } from '../../src/dbUtils/PGCompositeKVDatabase';

describe('PGCompositeKVDatabase', () => {
  it('defaults to a lean schema without extra indexes', async () => {
    const db = new PGCompositeKVDatabase(
      'postgres://user:pass@localhost:5432/testdb',
      'order_state',
      [
        { name: 'chain_id', type: 'integer' },
        { name: 'order_id', type: 'bigint' },
      ],
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
      queries.some((query) => query.includes('IDX_order_state_created_at')),
    ).toBe(false);
    expect(
      queries.some((query) => query.includes('IDX_order_state_updated_at')),
    ).toBe(false);
    expect(
      queries.some((query) => query.includes('IDX_order_state_value_gin')),
    ).toBe(false);
  });

  it('upserts rows by composite primary key', async () => {
    const db = new PGCompositeKVDatabase(
      'postgres://user:pass@localhost:5432/testdb',
      'order_state',
      [
        { name: 'chain_id', type: 'integer' },
        { name: 'account_id', type: 'bigint' },
        { name: 'order_id', type: 'bigint' },
      ],
    );
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

    await db.put(
      {
        chain_id: 1,
        account_id: '7',
        order_id: '42',
      },
      { status: 'open' },
    );

    expect(captured_query).toContain(
      'ON CONFLICT ("chain_id", "account_id", "order_id") DO UPDATE SET',
    );
    expect(captured_params).toEqual([1, '7', '42', '{"status":"open"}']);
  });

  it('gets many rows in input order with nulls for misses', async () => {
    const db = new PGCompositeKVDatabase(
      'postgres://user:pass@localhost:5432/testdb',
      'order_state',
      [
        { name: 'chain_id', type: 'integer' },
        { name: 'order_id', type: 'bigint' },
      ],
      {
        track_timestamps: true,
      },
    );

    (db as any).ensureInitialized = () => {};
    (db as any).data_source = {
      query: () => [
        {
          __ord: 0,
          __found: true,
          chain_id: 1,
          order_id: '10',
          value: { status: 'open' },
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-02T00:00:00.000Z',
        },
        {
          __ord: 1,
          __found: false,
          chain_id: null,
          order_id: null,
          value: null,
          created_at: null,
          updated_at: null,
        },
      ],
      isInitialized: false,
    };

    await expect(
      db.getMany(
        [
          { chain_id: 1, order_id: '10' },
          { chain_id: 1, order_id: '11' },
        ],
        { include_timestamps: true },
      ),
    ).resolves.toEqual([
      {
        value: { status: 'open' },
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        updated_at: new Date('2024-01-02T00:00:00.000Z'),
      },
      null,
    ]);
  });

  it('rejects duplicate composite key column names', () => {
    expect(
      () =>
        new PGCompositeKVDatabase(
          'postgres://user:pass@localhost:5432/testdb',
          'order_state',
          [
            { name: 'chain_id', type: 'integer' },
            { name: 'chain_id', type: 'bigint' },
          ],
        ),
    ).toThrow('key_columns must not contain duplicate names');
  });
});
