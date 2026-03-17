import { PGKVDatabase, ValueType } from './KVPostgresql';

/**
 * PostgreSQL KVDatabase 使用示例：展示如何使用不同的值类型
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

    // 保存数组
    await db.saveArray('numbers', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // 获取数组
    const array = await db.getAllArray('numbers');
    console.log('Array:', array);
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

    // 获取随机数据
    const randomData = await db.getRandomData(2);
    console.log('Random data:', randomData);
  } finally {
    await db.close();
  }
}

async function byteaExample() {
  console.log('=== BYTEA 类型示例 ===');

  const db = new PGKVDatabase(DATABASE_URL, 'bytea_store', 'bytea');

  try {
    // 存储二进制数据
    const imageBuffer = Buffer.from('fake image data content', 'utf8');
    await db.put('image:1', imageBuffer);

    // 存储文件数据
    const fileBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]); // PNG header
    await db.put('file:png', fileBuffer);

    // 存储 Base64 解码的数据
    const base64Data = 'SGVsbG8gV29ybGQh'; // "Hello World!" in base64
    const decodedBuffer = Buffer.from(base64Data, 'base64');
    await db.put('text:encoded', decodedBuffer);

    // 获取二进制数据
    const retrievedImage = await db.get<Buffer>('image:1');
    console.log('Image data length:', retrievedImage?.length);
    console.log('Image data:', retrievedImage?.toString());

    const retrievedFile = await db.get<Buffer>('file:png');
    console.log('PNG header:', retrievedFile);

    const retrievedText = await db.get<Buffer>('text:encoded');
    console.log('Decoded text:', retrievedText?.toString());

    // 检查二进制数据是否存在
    const exists = await db.isValueExists(imageBuffer);
    console.log('Image buffer exists:', exists);

    // 获取随机二进制数据
    const randomData = await db.getRandomData(1);
    console.log('Random binary data:', randomData);
  } finally {
    await db.close();
  }
}

async function typeComparisonExample() {
  console.log('=== 类型对比示例 ===');

  const types: ValueType[] = [
    'jsonb',
    'varchar',
    'text',
    'integer',
    'boolean',
    'float',
    'bytea',
  ];

  for (const type of types) {
    const db = new PGKVDatabase(DATABASE_URL, `${type}_test`, type);

    console.log(`\n${type.toUpperCase()} 类型支持的操作:`);
    console.log('- put/get/delete:', db.isOperationSupported('put'));
    console.log('- merge:', db.isOperationSupported('merge'));
    console.log('- searchJson:', db.isOperationSupported('searchJson'));
    console.log('- findBoolValues:', db.isOperationSupported('findBoolValues'));
    console.log('- saveArray:', db.isOperationSupported('saveArray'));

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
    await byteaExample();
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
  byteaExample,
  typeComparisonExample,
  runExamples,
};
