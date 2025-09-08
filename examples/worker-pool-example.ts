import { createWorkerPool } from '../src/utils/handlers/workerHandler-optimized.js';

// 创建worker池
const pool = createWorkerPool({
  minPoolSize: 2,
  maxPoolSize: 8,
  taskTimeout: 10000, // 10秒超时
  maxRetries: 2, // 最大重试2次
});

async function main() {
  try {
    console.log('=== 基本使用示例 ===');

    // 基本任务执行
    const result1 = await pool.run((x: number, y: number) => x + y, 10, 20);
    console.log('加法结果:', result1); // 30

    // 异步任务
    const result2 = await pool.run(async (delay: number) => {
      return new Promise((resolve) => {
        setTimeout(() => resolve(`延迟${delay}ms完成`), delay);
      });
    }, 1000);
    console.log('异步任务结果:', result2);

    console.log('\n=== 带选项的任务执行 ===');

    // 带超时和重试选项的任务
    const result3 = await pool.run(
      (n: number) => {
        if (Math.random() > 0.7) throw new Error('随机失败');
        return n * 2;
      },
      { timeout: 5000, maxRetries: 3 },
      15,
    );
    console.log('带重试的任务结果:', result3);

    console.log('\n=== Fire and Forget 任务 ===');

    // 不需要等待结果的任务
    pool.fireAndForget((msg: string) => {
      console.log('后台任务执行:', msg);
    }, 'Hello from background task!');

    console.log('\n=== 批量任务 ===');

    // 并行执行多个任务
    const tasks = Array.from({ length: 5 }, (_, i) =>
      pool.run((index: number) => {
        const result = index * index;
        return { index, result };
      }, i),
    );

    const results = await Promise.all(tasks);
    console.log('批量任务结果:', results);

    console.log('\n=== 统计信息 ===');
    console.log('Pool状态:', pool.getStats());

    // 等待一下让fire and forget任务完成
    await new Promise((resolve) => setTimeout(resolve, 100));

    console.log('\n=== CPU密集型任务示例 ===');

    // CPU密集型任务
    const cpuTask = await pool.run((n: number) => {
      function fibonacci(num: number): number {
        if (num <= 1) return num;
        return fibonacci(num - 1) + fibonacci(num - 2);
      }
      return fibonacci(n);
    }, 35);

    console.log('斐波那契数列结果:', cpuTask);
  } catch (error) {
    console.error('执行出错:', error);
  } finally {
    // 清理资源
    console.log('\n=== 清理资源 ===');
    await pool.destroy();
    console.log('WorkerPool已销毁');
  }
}

// 错误处理示例
async function errorHandlingExample() {
  const pool = createWorkerPool({ maxRetries: 1 });

  try {
    // 会失败的任务
    await pool.run(() => {
      throw new Error('故意失败的任务');
    });
  } catch (error) {
    console.log('捕获到错误:', error.message);
  }

  // 超时任务
  try {
    await pool.run(
      () => {
        // 模拟长时间运行的任务
        return new Promise((resolve) => {
          setTimeout(() => resolve('完成'), 15000);
        });
      },
      { timeout: 2000 }, // 2秒超时
    );
  } catch (error) {
    console.log('超时错误:', error.message);
  }

  await pool.destroy();
}

if (require.main === module) {
  main()
    .then(() => {
      console.log('\n=== 错误处理示例 ===');
      return errorHandlingExample();
    })
    .catch(console.error);
}
