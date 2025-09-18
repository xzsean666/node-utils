import { Worker } from 'worker_threads';

type Task<T = any> = {
  func: (...args: any[]) => T | Promise<T>;
  args: any[];
  resolve?: (value: T) => void;
  reject?: (err: any) => void;
  fireAndForget?: boolean;
};

interface PoolOptions {
  minPoolSize?: number;
  maxPoolSize?: number;
}

export class WorkerPool {
  private minPoolSize: number;
  private maxPoolSize: number;
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private taskQueue: Task[] = [];

  constructor(options: PoolOptions = {}) {
    this.minPoolSize = options.minPoolSize || 2;
    this.maxPoolSize = options.maxPoolSize || 8;

    for (let i = 0; i < this.minPoolSize; i++) {
      this.addWorker();
    }
  }

  private addWorker() {
    const worker = new Worker(
      `
      const { parentPort } = require('worker_threads');
      parentPort.on('message', async ({ funcStr, args }) => {
        try {
          const func = new Function('return (' + funcStr + ')')();
          const result = await func(...args);
          parentPort.postMessage({ result });
        } catch (err) {
          parentPort.postMessage({ error: err.message });
        }
      });
    `,
      { eval: true },
    );

    worker.on('message', (msg) => this.handleMessage(worker, msg));
    worker.on('error', (err) => this.handleError(worker, err));
    worker.on('exit', () => this.handleExit(worker));

    this.workers.push(worker);
    this.idleWorkers.push(worker);
  }

  private handleMessage(worker: Worker, msg: { result?: any; error?: string }) {
    const task = (worker as any)._currentTask as Task | undefined;
    if (!task) return;

    if (!task.fireAndForget) {
      if (msg.error) task.reject?.(new Error(msg.error));
      else task.resolve?.(msg.result);
    }

    (worker as any)._currentTask = null;
    this.idleWorkers.push(worker);
    this.runNext();
  }

  private handleError(worker: Worker, err: any) {
    const task = (worker as any)._currentTask as Task | undefined;
    if (!task?.fireAndForget) task?.reject?.(err);

    this.removeWorker(worker);
    this.runNext();
  }

  private handleExit(worker: Worker) {
    this.removeWorker(worker);
    this.runNext();
  }

  private removeWorker(worker: Worker) {
    this.workers = this.workers.filter((w) => w !== worker);
    this.idleWorkers = this.idleWorkers.filter((w) => w !== worker);
    if (this.workers.length < this.minPoolSize) this.addWorker();
  }

  private runNext() {
    if (this.taskQueue.length === 0) return;
    if (
      this.idleWorkers.length === 0 &&
      this.workers.length < this.maxPoolSize
    ) {
      this.addWorker();
    }
    if (this.idleWorkers.length === 0) return;

    const worker = this.idleWorkers.shift()!;
    const task = this.taskQueue.shift()!;
    (worker as any)._currentTask = task;

    worker.postMessage({ funcStr: task.func.toString(), args: task.args });
  }

  public run<T>(
    func: (...args: any[]) => T | Promise<T>,
    ...args: any[]
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: Task<T> = { func, args, resolve, reject };
      this.taskQueue.push(task);
      this.runNext();
    });
  }

  public fireAndForget(func: (...args: any[]) => any, ...args: any[]) {
    const task: Task = { func, args, fireAndForget: true };
    this.taskQueue.push(task);
    this.runNext();
  }

  public destroy() {
    this.workers.forEach((w) => w.terminate().catch(() => {}));
    this.workers = [];
    this.idleWorkers = [];
    this.taskQueue = [];
  }
}
