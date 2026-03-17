import { SqliteKVDatabase, SqliteValueType } from './KVSqlite';
import { PGKVDatabase, ValueType } from './KVPostgresql';

// SQLite 使用示例
async function sqliteExamples() {
  console.log('=== SQLite KVDB Examples ===');

  // 1. JSON 类型 (默认)
  const jsonDb = new SqliteKVDatabase(
    './data.db',
    'json_table',
    SqliteValueType.JSON,
  );
  await jsonDb.put('user1', {
    name: 'Alice',
    age: 30,
    roles: ['admin', 'user'],
  });
  const user = await jsonDb.get('user1');
  console.log('JSON value:', user);

  // 2. TEXT 类型
  const textDb = new SqliteKVDatabase(
    './data.db',
    'text_table',
    SqliteValueType.TEXT,
  );
  await textDb.put('message1', 'Hello, World!');
  const message = await textDb.get('message1');
  console.log('Text value:', message);

  // 3. BLOB 类型 (二进制数据)
  const blobDb = new SqliteKVDatabase(
    './data.db',
    'blob_table',
    SqliteValueType.BLOB,
  );
  const buffer = Buffer.from('Binary data content', 'utf8');
  await blobDb.put('file1', buffer);
  const retrievedBuffer = await blobDb.get('file1');
  console.log('BLOB value:', retrievedBuffer);

  // 4. INTEGER 类型
  const intDb = new SqliteKVDatabase(
    './data.db',
    'int_table',
    SqliteValueType.INTEGER,
  );
  await intDb.put('score1', 1000);
  const score = await intDb.get('score1');
  console.log('Integer value:', score, typeof score);

  // 5. REAL 类型 (浮点数)
  const realDb = new SqliteKVDatabase(
    './data.db',
    'real_table',
    SqliteValueType.REAL,
  );
  await realDb.put('temperature1', 23.5);
  const temp = await realDb.get('temperature1');
  console.log('Real value:', temp, typeof temp);

  // 6. BOOLEAN 类型
  const boolDb = new SqliteKVDatabase(
    './data.db',
    'bool_table',
    SqliteValueType.BOOLEAN,
  );
  await boolDb.put('enabled1', true);
  const enabled = await boolDb.get('enabled1');
  console.log('Boolean value:', enabled, typeof enabled);

  // 类型信息查询
  console.log('JSON DB Type Info:', jsonDb.getTypeInfo());
  console.log('Text DB Type Info:', textDb.getTypeInfo());

  // 清理
  await jsonDb.close();
  await textDb.close();
  await blobDb.close();
  await intDb.close();
  await realDb.close();
  await boolDb.close();
}

// PostgreSQL 使用示例
async function postgresExamples() {
  console.log('\n=== PostgreSQL KVDB Examples ===');

  const connectionString =
    process.env.POSTGRES_URL ||
    'postgresql://user:password@localhost:5432/testdb';

  // 1. JSONB 类型 (默认)
  const jsonbDb = new PGKVDatabase(
    connectionString,
    'jsonb_table',
    'jsonb',
  );
  await jsonbDb.put('product1', {
    name: 'Laptop',
    price: 999.99,
    specs: { cpu: 'Intel i7', ram: '16GB' },
    tags: ['electronics', 'computer'],
  });
  const product = await jsonbDb.get('product1');
  console.log('JSONB value:', product);

  // JSONB merge 操作
  await jsonbDb.merge('product1', {
    specs: { storage: '512GB SSD' },
    inStock: true,
  });
  const mergedProduct = await jsonbDb.get('product1');
  console.log('Merged JSONB value:', mergedProduct);

  // 2. TEXT 类型
  const textDb = new PGKVDatabase(
    connectionString,
    'text_table',
    'text',
  );
  await textDb.put('description1', 'This is a detailed product description...');
  const description = await textDb.get('description1');
  console.log('Text value:', description);

  // 3. BYTEA 类型 (二进制数据)
  const byteaDb = new PGKVDatabase(
    connectionString,
    'bytea_table',
    'bytea',
  );
  const imageBuffer = Buffer.from('fake image data', 'utf8');
  await byteaDb.put('image1', imageBuffer);
  const retrievedImage = await byteaDb.get('image1');
  console.log('BYTEA value length:', retrievedImage?.length);

  // 4. INTEGER 类型
  const intDb = new PGKVDatabase(
    connectionString,
    'int_table',
    'integer',
  );
  await intDb.put('counter1', 42);
  const counter = await intDb.get('counter1');
  console.log('Integer value:', counter, typeof counter);

  // 5. BOOLEAN 类型
  const boolDb = new PGKVDatabase(
    connectionString,
    'bool_table',
    'boolean',
  );
  await boolDb.put('isActive1', true);
  const isActive = await boolDb.get('isActive1');
  console.log('Boolean value:', isActive, typeof isActive);

  // 6. FLOAT 类型
  const floatDb = new PGKVDatabase(
    connectionString,
    'float_table',
    'float',
  );
  await floatDb.put('ratio1', 0.618);
  const ratio = await floatDb.get('ratio1');
  console.log('Float value:', ratio, typeof ratio);

  // 类型支持检查
  console.log('JSONB supports merge:', jsonbDb.isOperationSupported('merge'));
  console.log('TEXT supports merge:', textDb.isOperationSupported('merge'));

  // 类型信息
  console.log('JSONB value type:', jsonbDb.getValueType());
  console.log('FLOAT value type:', floatDb.getValueType());

  // 清理
  await jsonbDb.close();
  await textDb.close();
  await byteaDb.close();
  await intDb.close();
  await boolDb.close();
  await floatDb.close();
}

// 错误处理示例
async function errorHandlingExamples() {
  console.log('\n=== Error Handling Examples ===');

  // SQLite 类型错误示例
  const intDb = new SqliteKVDatabase(
    ':memory:',
    'test_table',
    SqliteValueType.INTEGER,
  );

  try {
    await intDb.put('invalid_int', 'not a number');
  } catch (error: any) {
    console.log('SQLite Integer type error:', error.message);
  }

  // PostgreSQL 类型错误示例
  if (process.env.POSTGRES_URL) {
    const intDb = new PGKVDatabase(
      process.env.POSTGRES_URL,
      'test_pg_int',
      'integer',
    );

    try {
      await intDb.put('invalid_int', 'not-a-valid-int');
    } catch (error: any) {
      console.log('PostgreSQL Integer type error:', error.message);
    }

    // 不支持的操作示例
    const textDb = new PGKVDatabase(
      process.env.POSTGRES_URL,
      'test_text',
      'text',
    );

    try {
      await textDb.merge('key1', { data: 'value' });
    } catch (error: any) {
      console.log('Unsupported merge operation error:', error.message);
    }

    await intDb.close();
    await textDb.close();
  }

  await intDb.close();
}

// 主函数
async function main() {
  try {
    await sqliteExamples();

    // 只有在有 PostgreSQL 连接字符串时才运行 PostgreSQL 示例
    if (process.env.POSTGRES_URL) {
      await postgresExamples();
    } else {
      console.log('\nSkipping PostgreSQL examples - POSTGRES_URL not set');
    }

    await errorHandlingExamples();

    console.log('\n=== All examples completed ===');
  } catch (error) {
    console.error('Example error:', error);
  }
}

// 导出示例函数
export { sqliteExamples, postgresExamples, errorHandlingExamples, main };

// 如果直接运行此文件，执行示例
if (require.main === module) {
  main();
}

/**
 * 使用示例：展示如何使用不同的值类型
 */

// 数据库连接字符串
const DATABASE_URL = 'postgresql://username:password@localhost:5432/database';

async function jsonbExample() {
  console.log('=== JSONB 类型示例 ===');

  const db = new PGKVDatabase(DATABASE_URL, 'jsonb_store', 'jsonb');

  try {
    // 存储复杂对象
    await db.put('user:1', {
      name: 'John Doe',
      age: 30,
      email: 'john@example.com',
      preferences: {
        theme: 'dark',
        notifications: true,
      },
    });

    // 合并更新
    await db.merge('user:1', {
      age: 31,
      preferences: {
        language: 'en',
      },
    });

    // JSON 搜索
    const results = await db.searchJson({
      contains: { name: 'John' },
      limit: 10,
    });

    console.log('Search results:', results);

    // 用前缀建模一个集合
    await db.putMany([
      ['numbers:1', { value: 1 }],
      ['numbers:2', { value: 2 }],
      ['numbers:3', { value: 3 }],
    ]);

    const numbers = await db.scan({ prefix: 'numbers:' });
    console.log('Numbers:', numbers);
  } finally {
    await db.close();
  }
}

async function varcharExample() {
  console.log('=== VARCHAR 类型示例 ===');

  const db = new PGKVDatabase(DATABASE_URL, 'varchar_store', 'varchar');

  try {
    // 存储字符串
    await db.put('name:1', 'John Doe');
    await db.put('name:2', 'Jane Smith');

    // 获取值
    const name = await db.get('name:1');
    console.log('Name:', name);

    // 检查值是否存在
    const exists = await db.isValueExists('John Doe');
    console.log('Value exists:', exists);

    // 批量操作
    await db.putMany([
      ['city:1', 'New York'],
      ['city:2', 'Los Angeles'],
      ['city:3', 'Chicago'],
    ]);

    const allData = await db.getAll();
    console.log('All data:', Array.from(allData.entries()));
  } finally {
    await db.close();
  }
}

async function integerExample() {
  console.log('=== INTEGER 类型示例 ===');

  const db = new PGKVDatabase(DATABASE_URL, 'integer_store', 'integer');

  try {
    // 存储整数
    await db.put('count:1', 42);
    await db.put('count:2', 100);
    await db.put('count:3', 0);

    // 获取值
    const count = await db.get<number>('count:1');
    console.log('Count:', count, typeof count);

    // 按时间搜索
    const recent = await db.searchByTime({
      timestamp: Date.now() - 60000, // 1分钟前
      take: 5,
      type: 'after',
    });

    console.log('Recent integers:', recent);
  } finally {
    await db.close();
  }
}

async function booleanExample() {
  console.log('=== BOOLEAN 类型示例 ===');

  const db = new PGKVDatabase(DATABASE_URL, 'boolean_store', 'boolean');

  try {
    // 存储布尔值
    await db.put('active:1', true);
    await db.put('active:2', false);
    await db.put('enabled:1', true);

    // 查找布尔值
    const trueKeys = await db.findBoolValues(true, false);
    console.log('True values:', trueKeys);

    const falseKey = await db.findBoolValues(false, true);
    console.log('First false value key:', falseKey);

    // 检查操作支持
    console.log('Supports merge:', db.isOperationSupported('merge')); // false
    console.log(
      'Supports findBoolValues:',
      db.isOperationSupported('findBoolValues'),
    ); // true
  } finally {
    await db.close();
  }
}

async function floatExample() {
  console.log('=== FLOAT 类型示例 ===');

  const db = new PGKVDatabase(DATABASE_URL, 'float_store', 'float');

  try {
    // 存储浮点数
    await db.put('price:1', 19.99);
    await db.put('price:2', 29.95);
    await db.put('temperature', 36.5);

    // 获取值
    const price = await db.get<number>('price:1');
    console.log('Price:', price, typeof price);

    const allPrices = await db.scan();
    console.log('All prices:', allPrices);
  } finally {
    await db.close();
  }
}

async function typeComparisonExample() {
  console.log('=== 类型对比示例 ===');

  const types: ValueType[] = [
    'jsonb',
    'varchar',
    'integer',
    'boolean',
    'float',
  ];

  for (const type of types) {
    const db = new PGKVDatabase(DATABASE_URL, `${type}_test`, type);

    console.log(`\n${type.toUpperCase()} 类型支持的操作:`);
    console.log('- put/get/delete:', db.isOperationSupported('put'));
    console.log('- merge:', db.isOperationSupported('merge'));
    console.log('- searchJson:', db.isOperationSupported('searchJson'));
    console.log('- findBoolValues:', db.isOperationSupported('findBoolValues'));
    console.log('- scan:', db.isOperationSupported('scan'));

    await db.close();
  }
}

// 运行示例
async function runExamples() {
  try {
    await jsonbExample();
    await varcharExample();
    await integerExample();
    await booleanExample();
    await floatExample();
    await typeComparisonExample();
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// 导出示例函数
export {
  jsonbExample,
  varcharExample,
  integerExample,
  booleanExample,
  floatExample,
  typeComparisonExample,
  runExamples,
};
