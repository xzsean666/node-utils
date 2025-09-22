import { Worker, isMainThread, parentPort } from 'worker_threads';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

type Task = {
  taskId: string;
  jsFilePath: string;
  funcName: string;
  args: any[];
};

export class WorkerPool {
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private taskQueue: Task[] = [];
  private maxWorkers: number;
  private activeTasks = new Map<
    string,
    { resolve: (value: any) => void; reject: (err: any) => void }
  >();

  constructor(maxWorkers = os.cpus().length) {
    this.maxWorkers = maxWorkers;
  }

  private spawnWorker() {
    const worker = new Worker(__filename);
    worker.on('message', (msg) => {
      const { taskId, result, error } = msg;
      const taskPromise = this.activeTasks.get(taskId);
      if (taskPromise) {
        this.activeTasks.delete(taskId);
        if (error) taskPromise.reject(new Error(error));
        else taskPromise.resolve(result);
      }
      this.idleWorkers.push(worker);
      this.next();
    });

    worker.on('error', (err) => {
      console.error('Worker error:', err);
    });

    this.idleWorkers.push(worker);
    this.workers.push(worker);
  }

  private next() {
    if (!this.idleWorkers.length || !this.taskQueue.length) return;
    const worker = this.idleWorkers.pop()!;
    const task = this.taskQueue.shift()!;
    worker.postMessage(task);
  }

  run(jsFilePath: string, funcName: string, args: any[]) {
    return new Promise((resolve, reject) => {
      const taskId = randomUUID();
      this.activeTasks.set(taskId, { resolve, reject });
      const task: Task = {
        taskId,
        jsFilePath,
        funcName,
        args,
      };
      this.taskQueue.push(task);
      if (this.workers.length < this.maxWorkers) this.spawnWorker();
      this.next();
    });
  }

  destroy() {
    for (const w of this.workers) w.terminate();
  }
}

// Worker 逻辑放在文件底部
if (!isMainThread) {
  parentPort!.on('message', async (task: Task) => {
    const { taskId, jsFilePath, funcName, args } = task;
    try {
      const mod = require(path.resolve(jsFilePath));
      if (!(funcName in mod)) throw new Error(`Function ${funcName} not found`);
      const result = await mod[funcName](...args);
      parentPort!.postMessage({ taskId, result });
    } catch (err: any) {
      parentPort!.postMessage({ taskId, error: err.message });
    }
  });
}
