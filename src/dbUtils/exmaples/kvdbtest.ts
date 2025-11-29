import { SqliteKVDatabase } from '../KVSqlite';

const kvDatabase = new SqliteKVDatabase('./db/test.db');

kvDatabase.put('test', 'test');

console.log(kvDatabase.get('test'));
