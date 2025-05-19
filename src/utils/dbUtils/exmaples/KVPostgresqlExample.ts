import { KVDatabase } from '../KVPostgresql';
import { config } from 'dotenv';

config();

async function main() {
  // 初始化数据库连接
  const dbUrl = process.env.DATABASE_URL || '';
  console.log('dbUrl', dbUrl);
  const db = new KVDatabase(dbUrl, 'example_kv_store');

  try {
    // 示例1: 合并新值（当键不存在时）
    async function example1() {
      const key = 'example_key1';
      const value = { name: 'test', age: 25 };

      const result = await db.merge(key, value);
      console.log('合并结果:', result);

      const retrieved = await db.get(key);
      console.log('获取的值:', retrieved);
    }

    // 示例2: 与现有值合并
    async function example2() {
      const key = 'example_key2';
      const initialValue = { name: 'test', age: 25 };
      const mergeValue = { age: 26, city: 'New York' };

      await db.put(key, initialValue);
      const result = await db.merge(key, mergeValue);
      console.log('合并结果:', result);

      const retrieved = await db.get(key);
      console.log('合并后的值:', retrieved);
    }

    // 示例3: 处理 null 值
    async function example3() {
      const key = 'example_key3';
      const initialValue = { name: 'test', age: 25 };
      const mergeValue = { age: null };

      await db.put(key, initialValue);
      const result = await db.merge(key, mergeValue);
      console.log('合并结果:', result);

      const retrieved = await db.get(key);
      console.log('包含 null 的值:', retrieved);
    }

    // 示例4: 处理嵌套对象
    async function example4() {
      const key = 'example_key4';
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
            city: 'New York',
            country: 'USA',
          },
        },
      };

      await db.put(key, initialValue);
      const result = await db.merge(key, mergeValue);
      console.log('合并结果:', result);

      const retrieved = await db.get(key);
      console.log('嵌套对象合并结果:', retrieved);
    }

    // 示例5: 处理数组
    async function example5() {
      const key = 'example_key5';
      const initialValue = {
        tags: ['tag1', 'tag2'],
        scores: [1, 2, 3],
      };
      const mergeValue = {
        tags: ['tag3'],
        scores: [4, 5],
      };

      await db.put(key, initialValue);
      const result = await db.merge(key, mergeValue);
      console.log('合并结果:', result);

      const retrieved = await db.get(key);
      console.log('数组合并结果:', retrieved);
    }

    // 运行所有示例
    console.log('运行示例1: 合并新值');
    await example1();

    console.log('\n运行示例2: 与现有值合并');
    await example2();

    console.log('\n运行示例3: 处理 null 值');
    await example3();

    console.log('\n运行示例4: 处理嵌套对象');
    await example4();

    console.log('\n运行示例5: 处理数组');
    await example5();
  } catch (error) {
    console.error('发生错误:', error);
  } finally {
    // 关闭数据库连接
    await db.close();
  }
}

// 运行主函数
main().catch(console.error);
