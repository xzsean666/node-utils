import { IKVDatabase } from './KVCache';

interface CacheEntry<T> {
  value: T;
  expiry?: number; // timestamp when entry expires
}

export class MemoryKVDatabase<T = any> implements IKVDatabase<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private cleanupTimers = new Map<string, NodeJS.Timeout>();

  async get(key: string, ttl?: number): Promise<T | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      return Promise.resolve(null);
    }

    // Check if entry has expired
    if (entry.expiry && Date.now() > entry.expiry) {
      this.delete(key);
      return Promise.resolve(null);
    }

    // If TTL is provided and entry doesn't have expiry, check if we need to update TTL
    if (ttl && !entry.expiry) {
      entry.expiry = Date.now() + ttl * 1000;
      this.scheduleCleanup(key, ttl * 1000);
    }

    return Promise.resolve(entry.value);
  }

  async put(key: string, value: T): Promise<void> {
    // Clear any existing cleanup timer
    this.clearCleanupTimer(key);

    this.cache.set(key, { value });

    // Note: TTL is not set here - it's handled in the decorator
    return Promise.resolve();
  }

  // Helper method to set value with TTL
  async putWithTTL(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.clearCleanupTimer(key);

    const expiry = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, { value, expiry });

    this.scheduleCleanup(key, ttlSeconds * 1000);
    return Promise.resolve();
  }

  private scheduleCleanup(key: string, delayMs: number): void {
    const timer = setTimeout(() => {
      this.cache.delete(key);
      this.cleanupTimers.delete(key);
    }, delayMs);

    this.cleanupTimers.set(key, timer);
  }

  private clearCleanupTimer(key: string): void {
    const timer = this.cleanupTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(key);
    }
  }

  private delete(key: string): void {
    this.cache.delete(key);
    this.clearCleanupTimer(key);
  }

  // Additional utility methods
  clear(): void {
    this.cache.clear();
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
  }

  size(): number {
    return this.cache.size;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (entry.expiry && Date.now() > entry.expiry) {
      this.delete(key);
      return false;
    }

    return true;
  }
}

// 创建内存缓存装饰器的工厂函数
export function createMemoryCacheDecorator<T = any>(
  defaultTTL: number = 60, // 默认60秒
) {
  const db = new MemoryKVDatabase<T>();

  return function cache(ttl: number = defaultTTL, prefix: string = '') {
    return function (
      target: any,
      propertyKey: string,
      descriptor: PropertyDescriptor,
    ) {
      const originalMethod = descriptor.value;

      descriptor.value = async function (...args: any[]): Promise<T> {
        try {
          const cacheKey = `${prefix}:${propertyKey}:${JSON.stringify(
            args,
          )}`.slice(0, 255);

          // 使用内存KV存储接口
          const cached = await db.get(cacheKey, ttl);
          if (cached !== null) {
            return cached;
          }

          const result = await originalMethod.apply(this, args);
          await db.putWithTTL(cacheKey, result, ttl);
          return result;
        } catch (error) {
          // 如果缓存操作失败，直接执行原始方法
          return originalMethod.apply(this, args);
        }
      };

      return descriptor;
    };
  };
}

// 导出一个全局的内存缓存实例
export const memoryKVDatabase = new MemoryKVDatabase();

// 使用全局实例的装饰器
export function memoryCache<T = any>(ttl: number = 60, prefix: string = '') {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]): Promise<T> {
      try {
        const cacheKey = `${prefix}:${propertyKey}:${JSON.stringify(
          args,
        )}`.slice(0, 255);

        const cached = await memoryKVDatabase.get(cacheKey, ttl);
        if (cached !== null) {
          return cached;
        }

        const result = await originalMethod.apply(this, args);
        await memoryKVDatabase.putWithTTL(cacheKey, result, ttl);
        return result;
      } catch (error) {
        return originalMethod.apply(this, args);
      }
    };

    return descriptor;
  };
}

// 使用示例：
// class ExampleService {
//   @memoryCache(30) // 缓存30秒
//   async expensiveOperation(param: string): Promise<string> {
//     // 模拟耗时操作
//     await new Promise(resolve => setTimeout(resolve, 1000));
//     return `Result for ${param}: ${Date.now()}`;
//   }
//
//   @memoryCache(60, 'api') // 缓存60秒，使用前缀'api'
//   async fetchData(id: number): Promise<any> {
//     // 模拟API调用
//     await new Promise(resolve => setTimeout(resolve, 500));
//     return { id, data: `Data for ${id}`, timestamp: Date.now() };
//   }
// }
