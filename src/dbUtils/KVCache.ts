// 定义通用的KV存储接口
export interface IKVDatabase<T = any> {
  get(key: string, ttl?: number): Promise<T | null>;
  put(key: string, value: T): Promise<void>;
}

// JSON 序列化辅助函数，处理特殊类型
function jsonFallback(_key: string, value: any): any {
  if (value instanceof Set) {
    return { __type: 'Set', data: Array.from(value) };
  }
  if (value instanceof Map) {
    return { __type: 'Map', data: Array.from(value.entries()) };
  }
  if (typeof value === 'bigint') {
    return { __type: 'BigInt', data: value.toString() };
  }
  if (value instanceof Date) {
    return { __type: 'Date', data: value.toISOString() };
  }
  if (value instanceof RegExp) {
    return { __type: 'RegExp', data: value.toString() };
  }
  if (Buffer.isBuffer(value)) {
    return { __type: 'Buffer', data: value.toString('base64') };
  }
  return value;
}

// 生成缓存键
function makeCacheKey(
  func_name: string,
  prefix: string,
  args: any[],
  kwargs?: Record<string, any>,
): string {
  let payload: string;
  try {
    const data = kwargs ? [args, kwargs] : args;
    payload = JSON.stringify(data, jsonFallback);
  } catch {
    payload = String(args);
  }

  const base = prefix ? `${prefix}:${func_name}:${payload}` : `${func_name}:${payload}`;
  return base.slice(0, 255);
}

/**
 * 异步锁管理器
 * 管理每个缓存 key 的异步锁，防止并发重复计算
 */
export class AsyncLockManager {
  private _locks: Map<string, Promise<void>> = new Map();
  private _lock_resolvers: Map<string, () => void> = new Map();
  private _max_locks: number;

  constructor(max_locks: number = 10000) {
    this._max_locks = max_locks;
  }

  /**
   * 获取指定 key 的锁
   * 如果锁已被持有，等待锁释放
   * 返回一个 release 函数用于释放锁
   */
  async acquireLock(key: string): Promise<() => void> {
    // 等待现有锁释放
    while (this._locks.has(key)) {
      await this._locks.get(key);
    }

    // 创建新锁
    let resolver: () => void;
    const lock_promise = new Promise<void>((resolve) => {
      resolver = resolve;
    });

    this._locks.set(key, lock_promise);
    this._lock_resolvers.set(key, resolver!);

    // 清理过多的锁
    this._cleanup();

    // 返回释放函数
    return () => {
      const stored_resolver = this._lock_resolvers.get(key);
      if (stored_resolver) {
        stored_resolver();
        this._locks.delete(key);
        this._lock_resolvers.delete(key);
      }
    };
  }

  /**
   * 清理过多的锁（简单策略：超过阈值时清空未使用的锁）
   */
  private _cleanup(): void {
    if (this._locks.size > this._max_locks) {
      // 清空所有锁（简单策略）
      this._locks.clear();
      this._lock_resolvers.clear();
    }
  }

  /**
   * 获取当前锁的数量
   */
  get size(): number {
    return this._locks.size;
  }
}

// 全局锁管理器
const global_lock_manager = new AsyncLockManager();

/**
 * 缓存装饰器选项
 */
export interface CacheOptions {
  /** 缓存 TTL（秒） */
  ttl?: number;
  /** 缓存键前缀 */
  prefix?: string;
  /** 是否使用锁防止并发重复计算（仅对异步函数有效） */
  use_lock?: boolean;
}

/**
 * 创建 KV 缓存装饰器工厂
 *
 * @param db KV 数据库实例
 * @param default_ttl 默认缓存 TTL（秒）
 * @param default_use_lock 默认是否使用锁
 * @returns 缓存装饰器工厂函数
 *
 * @example
 * ```typescript
 * const cache = createKvCache(db_instance, 60, true);
 *
 * class MyService {
 *   @cache({ ttl: 120, prefix: 'user' })
 *   async get_user(id: string) {
 *     // 耗时操作
 *   }
 *
 *   @cache({ ttl: 300, prefix: 'data', use_lock: false })
 *   async get_data(key: string) {
 *     // 轻量操作，不需要锁
 *   }
 * }
 * ```
 */
export function createCacheDecorator<T = any>(
  db: IKVDatabase<T>,
  default_ttl: number = 60,
  default_use_lock: boolean = true,
) {
  const lock_manager = global_lock_manager;

  return function cache(options: CacheOptions = {}) {
    const { ttl = default_ttl, prefix = '', use_lock = default_use_lock } = options;

    return function (
      target: any,
      property_key: string,
      descriptor: PropertyDescriptor,
    ) {
      const original_method = descriptor.value;
      const func_name = `${target.constructor?.name || 'Anonymous'}.${property_key}`;

      // 检测是否为异步函数
      const is_async =
        original_method.constructor.name === 'AsyncFunction' ||
        original_method[Symbol.toStringTag] === 'AsyncFunction';

      if (is_async && use_lock) {
        // 异步函数 + 锁：防止并发重复计算
        descriptor.value = async function (...args: any[]): Promise<T> {
          const cache_key = makeCacheKey(func_name, prefix, args);

          // 快速路径：先检查缓存（无锁）
          try {
            const cached = await db.get(cache_key, ttl);
            if (cached !== null) {
              return cached;
            }
          } catch {
            // 缓存读取失败，继续执行
          }

          // 获取锁
          const release = await lock_manager.acquireLock(cache_key);

          try {
            // 双重检查：等待锁期间可能其他请求已经计算完成
            try {
              const cached = await db.get(cache_key, ttl);
              if (cached !== null) {
                return cached;
              }
            } catch {
              // 缓存读取失败，继续执行
            }

            // 执行原始方法
            const result = await original_method.apply(this, args);

            // 存入缓存
            try {
              await db.put(cache_key, result);
            } catch {
              // 缓存写入失败，忽略
            }

            return result;
          } finally {
            // 释放锁
            release();
          }
        };
      } else if (is_async) {
        // 异步函数（无锁）
        descriptor.value = async function (...args: any[]): Promise<T> {
          const cache_key = makeCacheKey(func_name, prefix, args);

          try {
            const cached = await db.get(cache_key, ttl);
            if (cached !== null) {
              return cached;
            }
          } catch {
            // 缓存读取失败，继续执行
          }

          const result = await original_method.apply(this, args);

          try {
            await db.put(cache_key, result);
          } catch {
            // 缓存写入失败，忽略
          }

          return result;
        };
      } else {
        // 同步函数（无需锁，本身是阻塞的）
        // 注意：由于 db.get/put 是异步的，这里需要返回 Promise
        descriptor.value = async function (...args: any[]): Promise<T> {
          const cache_key = makeCacheKey(func_name, prefix, args);

          try {
            const cached = await db.get(cache_key, ttl);
            if (cached !== null) {
              return cached;
            }
          } catch {
            // 缓存读取失败，继续执行
          }

          const result = original_method.apply(this, args);

          try {
            await db.put(cache_key, result);
          } catch {
            // 缓存写入失败，忽略
          }

          return result;
        };
      }

      return descriptor;
    };
  };
}

/**
 * 创建函数缓存包装器（非装饰器模式）
 *
 * @param db KV 数据库实例
 * @param fn 要缓存的函数
 * @param options 缓存选项
 * @returns 带缓存的函数
 *
 * @example
 * ```typescript
 * const cached_fetch = wrapWithCache(
 *   db,
 *   async (url: string) => fetch(url).then(r => r.json()),
 *   { ttl: 300, prefix: 'api', use_lock: true }
 * );
 *
 * const data = await cached_fetch('https://api.example.com/data');
 * ```
 */
export function wrapWithCache<TArgs extends any[], TResult>(
  db: IKVDatabase<TResult>,
  fn: (...args: TArgs) => Promise<TResult>,
  options: CacheOptions & { func_name?: string } = {},
): (...args: TArgs) => Promise<TResult> {
  const {
    ttl = 60,
    prefix = '',
    use_lock = true,
    func_name = fn.name || 'anonymous',
  } = options;
  const lock_manager = global_lock_manager;

  if (use_lock) {
    return async (...args: TArgs): Promise<TResult> => {
      const cache_key = makeCacheKey(func_name, prefix, args);

      // 快速路径
      try {
        const cached = await db.get(cache_key, ttl);
        if (cached !== null) {
          return cached;
        }
      } catch {
        // 忽略
      }

      const release = await lock_manager.acquireLock(cache_key);

      try {
        // 双重检查
        try {
          const cached = await db.get(cache_key, ttl);
          if (cached !== null) {
            return cached;
          }
        } catch {
          // 忽略
        }

        const result = await fn(...args);

        try {
          await db.put(cache_key, result);
        } catch {
          // 忽略
        }

        return result;
      } finally {
        release();
      }
    };
  }

  return async (...args: TArgs): Promise<TResult> => {
    const cache_key = makeCacheKey(func_name, prefix, args);

    try {
      const cached = await db.get(cache_key, ttl);
      if (cached !== null) {
        return cached;
      }
    } catch {
      // 忽略
    }

    const result = await fn(...args);

    try {
      await db.put(cache_key, result);
    } catch {
      // 忽略
    }

    return result;
  };
}

