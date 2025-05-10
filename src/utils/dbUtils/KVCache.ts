// 定义通用的KV存储接口
export interface IKVDatabase<T = any> {
  get(key: string, ttl?: number): Promise<T | null>;
  put(key: string, value: T): Promise<void>;
}

export function createCacheDecorator<T = any>(
  db: IKVDatabase<T>,
  defaultTTL: number = 60 // 默认60秒
) {
  return function cache(ttl: number = defaultTTL, prefix: string = "") {
    return function (
      target: any,
      propertyKey: string,
      descriptor: PropertyDescriptor
    ) {
      const originalMethod = descriptor.value;

      descriptor.value = async function (...args: any[]): Promise<T> {
        try {
          const cacheKey = `${prefix}:${propertyKey}:${JSON.stringify(
            args
          )}`.slice(0, 255);

          // 使用通用的KV存储接口
          const cached = await db.get(cacheKey, ttl);
          if (cached !== null) {
            return cached;
          }

          const result = await originalMethod.apply(this, args);
          await db.put(cacheKey, result);
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
