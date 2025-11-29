import { WorkerPool } from '../workerHandler';
import path from 'path';

async function main() {
  const workerPool = new WorkerPool(4); // Create a pool with 4 workers

  const workerFilePath = path.join(__dirname, 'myWorkerFunction.js');

  try {
    // Run a task
    const sumResult = await workerPool.run(
      workerFilePath,
      'calculateSum',
      [5, 3],
    );
    console.log('Sum Result:', sumResult);

    // Run another task
    const multiplyResult = await workerPool.run(
      workerFilePath,
      'multiply',
      [4, 6],
    );
    console.log('Multiply Result:', multiplyResult);

    // Run multiple tasks concurrently
    const tasks = [
      workerPool.run(workerFilePath, 'calculateSum', [10, 20]),
      workerPool.run(workerFilePath, 'multiply', [7, 8]),
      workerPool.run(workerFilePath, 'calculateSum', [100, 50]),
      workerPool.run(workerFilePath, 'test', [100, 50]),
      workerPool.run(workerFilePath, 'get', []),
    ];

    const results = await Promise.all(tasks);
    console.log('Concurrent Results:', results);
  } catch (error) {
    console.error('Error during worker pool execution:', error);
  } finally {
    workerPool.destroy();
    console.log('Worker pool destroyed.');
  }
}

main();
