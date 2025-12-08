import { createCacheDecorator } from './KVCache';
import { SqliteKVDatabase } from './KVSqlite';

export const cache = createCacheDecorator<any>(
  new SqliteKVDatabase('./db/cache.db'),
);
