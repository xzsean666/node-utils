import { PGKVDatabase } from './KVPostgresql';

/**
 * BYTEA 类型功能测试示例
 */

async function testByteaFunctionality() {
  const DATABASE_URL =
    process.env.DATABASE_URL ||
    'postgresql://username:password@localhost:5432/database';
  const db = new PGKVDatabase(DATABASE_URL, 'bytea_test', 'bytea');

  try {
    console.log('=== BYTEA 功能测试 ===');

    // 测试 1: 存储和获取 Buffer
    console.log('\n测试 1: Buffer 存储');
    const buffer1 = Buffer.from('Hello World!', 'utf8');
    await db.put('test:buffer', buffer1);
    const retrieved1 = await db.get<Buffer>('test:buffer');
    console.log('原始:', buffer1);
    console.log('获取:', retrieved1);
    console.log('相等:', buffer1.equals(retrieved1!));

    // 测试 2: 存储和获取二进制数据
    console.log('\n测试 2: 二进制数据存储');
    const binaryData = Buffer.from([0x01, 0x02, 0x03, 0x04, 0xff, 0xfe]);
    await db.put('test:binary', binaryData);
    const retrieved2 = await db.get<Buffer>('test:binary');
    console.log('原始二进制:', binaryData);
    console.log('获取二进制:', retrieved2);
    console.log('相等:', binaryData.equals(retrieved2!));

    // 测试 3: 存储字符串（自动转换为 Buffer）
    console.log('\n测试 3: 字符串自动转换');
    await db.put('test:string', 'This is a string');
    const retrieved3 = await db.get<Buffer>('test:string');
    console.log('原始字符串: "This is a string"');
    console.log('获取 Buffer:', retrieved3);
    console.log('转回字符串:', retrieved3?.toString());

    // 测试 4: Base64 数据处理
    console.log('\n测试 4: Base64 数据');
    const base64String = 'SGVsbG8gQmFzZTY0IQ=='; // "Hello Base64!"
    const base64Buffer = Buffer.from(base64String, 'base64');
    await db.put('test:base64', base64Buffer);
    const retrieved4 = await db.get<Buffer>('test:base64');
    console.log('Base64 原文:', base64Buffer.toString());
    console.log('获取后解码:', retrieved4?.toString());

    // 测试 5: 检查值是否存在
    console.log('\n测试 5: 值存在性检查');
    const exists = await db.isValueExists(buffer1);
    console.log('Buffer 存在:', exists);

    // 测试 6: 获取所有匹配的值
    console.log('\n测试 6: 获取匹配值');
    const matchingValues = await db.getValues(binaryData);
    console.log('匹配的值数量:', matchingValues.length);

    // 测试 7: 批量操作
    console.log('\n测试 7: 批量操作');
    const batchData: Array<[string, Buffer]> = [
      ['batch:1', Buffer.from('Batch 1')],
      ['batch:2', Buffer.from('Batch 2')],
      ['batch:3', Buffer.from([0xaa, 0xbb, 0xcc])],
    ];
    await db.putMany(batchData);

    for (const [key] of batchData) {
      const value = await db.get<Buffer>(key);
      console.log(`${key}:`, value?.toString() || value);
    }

    // 测试 8: 获取所有数据
    console.log('\n测试 8: 获取所有数据');
    const allData = await db.getAll();
    console.log('总记录数:', allData.size);

    // 测试 9: 随机数据
    console.log('\n测试 9: 随机数据');
    const randomData = await db.getRandomData(2);
    randomData.forEach((item, index) => {
      console.log(
        `随机数据 ${index + 1}:`,
        item.key,
        '长度:',
        (item.value as Buffer)?.length,
      );
    });

    console.log('\n=== 所有测试完成 ===');
  } catch (error) {
    console.error('测试失败:', error);
  } finally {
    await db.close();
  }
}

// 运行测试
if (require.main === module) {
  testByteaFunctionality().catch(console.error);
}

export { testByteaFunctionality };
