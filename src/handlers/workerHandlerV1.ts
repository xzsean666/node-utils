import { Worker } from 'worker_threads';
import * as crypto from 'crypto';

type Task<T = any> = {
  id: string;
  func: (...args: any[]) => T | Promise<T>;
  args: any[];
  resolve?: (value: T) => void;
  reject?: (err: any) => void;
  fireAndForget?: boolean;
  timeout?: number;
  retries?: number;
  maxRetries?: number;
};

interface PoolOptions {
  minPoolSize?: number;
  maxPoolSize?: number;
  taskTimeout?: number; // 默认任务超时时间
  maxRetries?: number; // 默认最大重试次数
}

interface ExtendedWorker extends Worker {
  _currentTask?: Task;
  _isIdle: boolean;
  _taskStartTime?: number;
}

interface WorkerMessage {
  result?: any;
  error?: string;
  taskId?: string;
}

export class WorkerPool {
  private minPoolSize: number;
  private maxPoolSize: number;
  private defaultTimeout: number;
  private defaultMaxRetries: number;

  private workers: ExtendedWorker[] = [];
  private idleWorkers: ExtendedWorker[] = [];
  private taskQueue: Task[] = [];
  private activeTasks = new Map<string, Task>();
  private functionCache = new Map<string, string>();

  constructor(options: PoolOptions = {}) {
    this.minPoolSize = options.minPoolSize || 2;
    this.maxPoolSize = options.maxPoolSize || 8;
    this.defaultTimeout = options.taskTimeout || 300000; // 300秒默认超时
    this.defaultMaxRetries = options.maxRetries || 1;

    for (let i = 0; i < this.minPoolSize; i++) {
      this.addWorker();
    }

    // 定期检查超时任务
    setInterval(() => this.checkTimeouts(), 5000);
  }

  private generateTaskId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  private getFunctionHash(func: Function): string {
    return crypto.createHash('sha256').update(func.toString()).digest('hex');
  }

  private addWorker(): ExtendedWorker {
    // 使用更安全的worker实现，避免eval
    const workerCode = `
      const { parentPort } = require('worker_threads');
      const registeredFunctions = new Map();

      parentPort.on('message', async ({ type, taskId, funcStr, funcHash, args }) => {
        try {
          if (type === 'register_function') {
            // 注册函数
            const func = new Function('return (' + funcStr + ')')();
            registeredFunctions.set(funcHash, func);
            parentPort.postMessage({ type: 'function_registered', funcHash, taskId });
            return;
          }

          if (type === 'execute_task') {
            const func = registeredFunctions.get(funcHash);
            if (!func) {
              throw new Error('Function not found. Please register function first.');
            }
            
            const result = await func(...args);
            parentPort.postMessage({ type: 'task_result', taskId, result });
          }
        } catch (err) {
          parentPort.postMessage({ 
            type: 'task_error', 
            taskId, 
            error: err.message 
          });
        }
      });
    `;

    const worker = new Worker(workerCode, { eval: true }) as ExtendedWorker;
    worker._isIdle = true;

    worker.on('message', (msg) => this.handleMessage(worker, msg));
    worker.on('error', (err) => this.handleError(worker, err));
    worker.on('exit', () => this.handleExit(worker));

    this.workers.push(worker);
    this.idleWorkers.push(worker);

    return worker;
  }

  private handleMessage(worker: ExtendedWorker, msg: any) {
    if (msg.type === 'function_registered') {
      // 函数注册完成，执行任务
      const task = this.activeTasks.get(msg.taskId);
      if (task && worker._currentTask?.id === msg.taskId) {
        worker.postMessage({
          type: 'execute_task',
          taskId: msg.taskId,
          funcHash: msg.funcHash,
          args: task.args,
        });
      }
      return;
    }

    if (msg.type === 'task_result' || msg.type === 'task_error') {
      const task = this.activeTasks.get(msg.taskId);
      if (!task || worker._currentTask?.id !== msg.taskId) return;

      if (!task.fireAndForget) {
        if (msg.type === 'task_error') {
          // 检查是否需要重试
          if (this.shouldRetry(task)) {
            this.retryTask(task);
          } else {
            task.reject?.(new Error(msg.error));
          }
        } else {
          task.resolve?.(msg.result);
        }
      }

      this.completeTask(worker, task);
    }
  }

  private handleError(worker: ExtendedWorker, err: any) {
    const task = worker._currentTask;

    if (task && !task.fireAndForget) {
      if (this.shouldRetry(task)) {
        this.retryTask(task);
      } else {
        task.reject?.(err);
      }
    }

    this.removeWorker(worker);
    this.runNext();
  }

  private handleExit(worker: ExtendedWorker) {
    const task = worker._currentTask;

    // 重新排队当前任务
    if (task) {
      if (this.shouldRetry(task)) {
        this.retryTask(task);
      } else if (!task.fireAndForget) {
        task.reject?.(new Error('Worker exited unexpectedly'));
      }
    }

    this.removeWorker(worker);
    this.runNext();
  }

  private shouldRetry(task: Task): boolean {
    const maxRetries = task.maxRetries ?? this.defaultMaxRetries;
    const currentRetries = task.retries ?? 0;
    return currentRetries < maxRetries;
  }

  private retryTask(task: Task) {
    task.retries = (task.retries ?? 0) + 1;
    this.taskQueue.unshift(task); // 优先重试
    this.runNext();
  }

  private completeTask(worker: ExtendedWorker, task: Task) {
    this.activeTasks.delete(task.id);
    worker._currentTask = undefined;
    worker._isIdle = true;
    worker._taskStartTime = undefined;

    this.idleWorkers.push(worker);
    this.runNext();
  }

  private removeWorker(worker: ExtendedWorker) {
    this.workers = this.workers.filter((w) => w !== worker);
    this.idleWorkers = this.idleWorkers.filter((w) => w !== worker);

    // 维护最小池大小
    if (this.workers.length < this.minPoolSize) {
      this.addWorker();
    }

    worker.terminate().catch(() => {});
  }

  private checkTimeouts() {
    const now = Date.now();

    for (const worker of this.workers) {
      if (worker._currentTask && worker._taskStartTime) {
        const timeout = worker._currentTask.timeout ?? this.defaultTimeout;
        if (now - worker._taskStartTime > timeout) {
          // 任务超时
          const task = worker._currentTask;

          if (!task.fireAndForget) {
            if (this.shouldRetry(task)) {
              this.retryTask(task);
            } else {
              task.reject?.(new Error('Task timeout'));
            }
          }

          // 终止超时的worker
          this.removeWorker(worker);
        }
      }
    }
  }

  private async runNext() {
    if (this.taskQueue.length === 0) return;

    // 如果没有空闲worker且未达到最大值，创建新worker
    if (
      this.idleWorkers.length === 0 &&
      this.workers.length < this.maxPoolSize
    ) {
      this.addWorker();
    }

    if (this.idleWorkers.length === 0) return;

    const worker = this.idleWorkers.shift()!;
    const task = this.taskQueue.shift()!;

    worker._currentTask = task;
    worker._isIdle = false;
    worker._taskStartTime = Date.now();

    this.activeTasks.set(task.id, task);

    // 检查函数缓存
    const funcHash = this.getFunctionHash(task.func);
    const cachedFuncStr = this.functionCache.get(funcHash);

    if (cachedFuncStr) {
      // 使用缓存的函数
      worker.postMessage({
        type: 'execute_task',
        taskId: task.id,
        funcHash,
        args: task.args,
      });
    } else {
      // 注册新函数
      const funcStr = task.func.toString();
      this.functionCache.set(funcHash, funcStr);

      worker.postMessage({
        type: 'register_function',
        taskId: task.id,
        funcStr,
        funcHash,
      });
    }
  }

  public run<T>(
    func: (...args: any[]) => T | Promise<T>,
    ...args: any[]
  ): Promise<T>;

  public run<T>(
    func: (...args: any[]) => T | Promise<T>,
    options: { timeout?: number; maxRetries?: number },
    ...args: any[]
  ): Promise<T>;

  public run<T>(
    func: (...args: any[]) => T | Promise<T>,
    optionsOrFirstArg?: any,
    ...args: any[]
  ): Promise<T> {
    let taskOptions: { timeout?: number; maxRetries?: number } = {};
    let taskArgs = args;

    if (
      optionsOrFirstArg &&
      typeof optionsOrFirstArg === 'object' &&
      ('timeout' in optionsOrFirstArg || 'maxRetries' in optionsOrFirstArg)
    ) {
      taskOptions = optionsOrFirstArg;
    } else {
      taskArgs = [optionsOrFirstArg, ...args];
    }

    return new Promise<T>((resolve, reject) => {
      const task: Task<T> = {
        id: this.generateTaskId(),
        func,
        args: taskArgs,
        resolve,
        reject,
        timeout: taskOptions.timeout,
        maxRetries: taskOptions.maxRetries,
        retries: 0,
      };

      this.taskQueue.push(task);
      this.runNext();
    });
  }

  public fireAndForget(func: (...args: any[]) => any, ...args: any[]): void;

  public fireAndForget(
    func: (...args: any[]) => any,
    options: { timeout?: number; maxRetries?: number },
    ...args: any[]
  ): void;

  public fireAndForget(
    func: (...args: any[]) => any,
    optionsOrFirstArg?: any,
    ...args: any[]
  ): void {
    let taskOptions: { timeout?: number; maxRetries?: number } = {};
    let taskArgs = args;

    if (
      optionsOrFirstArg &&
      typeof optionsOrFirstArg === 'object' &&
      ('timeout' in optionsOrFirstArg || 'maxRetries' in optionsOrFirstArg)
    ) {
      taskOptions = optionsOrFirstArg;
    } else {
      taskArgs = [optionsOrFirstArg, ...args];
    }

    const task: Task = {
      id: this.generateTaskId(),
      func,
      args: taskArgs,
      fireAndForget: true,
      timeout: taskOptions.timeout,
      maxRetries: taskOptions.maxRetries,
      retries: 0,
    };

    this.taskQueue.push(task);
    this.runNext();
  }

  public getStats() {
    return {
      totalWorkers: this.workers.length,
      idleWorkers: this.idleWorkers.length,
      busyWorkers: this.workers.length - this.idleWorkers.length,
      queuedTasks: this.taskQueue.length,
      activeTasks: this.activeTasks.size,
      functionCacheSize: this.functionCache.size,
    };
  }

  public async destroy() {
    // 清理超时检查间隔
    clearInterval(this.checkTimeouts as any);

    // 拒绝所有排队的任务
    for (const task of this.taskQueue) {
      if (!task.fireAndForget) {
        task.reject?.(new Error('WorkerPool is being destroyed'));
      }
    }

    // 拒绝所有活动任务
    for (const task of this.activeTasks.values()) {
      if (!task.fireAndForget) {
        task.reject?.(new Error('WorkerPool is being destroyed'));
      }
    }

    // 终止所有worker
    await Promise.allSettled(this.workers.map((w) => w.terminate()));

    this.workers = [];
    this.idleWorkers = [];
    this.taskQueue = [];
    this.activeTasks.clear();
    this.functionCache.clear();
  }
}

// 使用示例
export function createWorkerPool(options?: PoolOptions) {
  return new WorkerPool(options);
}
