import { KVDatabase } from '../KVPostgresql';
import { config } from 'dotenv';

config();

describe('KVDatabase merge tests', () => {
  let db: KVDatabase;
  const TEST_TABLE = 'test_kv_store';

  beforeAll(async () => {
    // 使用测试数据库连接
    db = new KVDatabase(process.env.DATABASE_URL || '', TEST_TABLE);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.clear();
  });

  test('should merge new value when key does not exist', async () => {
    const key = 'test_key';
    const value = { name: 'test', age: 25 };

    const result = await db.merge(key, value);
    expect(result).toBe(true);

    const retrieved = await db.get(key);
    expect(retrieved).toEqual(value);
  });

  test('should merge with existing value', async () => {
    const key = 'test_key';
    const initialValue = { name: 'test', age: 25 };
    const mergeValue = { age: 26, city: 'New York' };
    const expectedValue = { name: 'test', age: 26, city: 'New York' };

    await db.put(key, initialValue);
    const result = await db.merge(key, mergeValue);
    expect(result).toBe(true);

    const retrieved = await db.get(key);
    expect(retrieved).toEqual(expectedValue);
  });

  test('should handle null values correctly', async () => {
    const key = 'test_key';
    const initialValue = { name: 'test', age: 25 };
    const mergeValue = { age: null };

    await db.put(key, initialValue);
    const result = await db.merge(key, mergeValue);
    expect(result).toBe(true);

    const retrieved = await db.get(key);
    expect(retrieved).toEqual({ name: 'test', age: null });
  });

  test('should handle nested objects', async () => {
    const key = 'test_key';
    const initialValue = {
      user: {
        name: 'test',
        address: {
          city: 'Old City',
        },
      },
    };
    const mergeValue = {
      user: {
        address: {
          country: 'USA',
        },
      },
    };
    const expectedValue = {
      user: {
        name: 'test',
        address: {
          city: 'Old City',
          country: 'USA',
        },
      },
    };

    await db.put(key, initialValue);
    const result = await db.merge(key, mergeValue);
    expect(result).toBe(true);

    const retrieved = await db.get(key);
    expect(retrieved).toEqual(expectedValue);
  });

  test('should handle arrays in objects', async () => {
    const key = 'test_key';
    const initialValue = {
      tags: ['tag1', 'tag2'],
      scores: [1, 2, 3],
    };
    const mergeValue = {
      tags: ['tag3'],
      scores: [4, 5],
    };
    const expectedValue = {
      tags: ['tag3'],
      scores: [4, 5],
    };

    await db.put(key, initialValue);
    const result = await db.merge(key, mergeValue);
    expect(result).toBe(true);

    const retrieved = await db.get(key);
    expect(retrieved).toEqual(expectedValue);
  });
});
