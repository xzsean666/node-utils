import { KVDatabase } from './SqliteKVDB';

export function createCacheDecorator<T = any>(
  db: KVDatabase,
  defaultTTL: number = 60, // 默认60秒
) {
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

          // 直接使用 KVDatabase 的 get 方法的缓存功能
          const cached = await db.get<T>(cacheKey, ttl);
          if (cached !== null) {
            return cached;
          }

          const result = await originalMethod.apply(this, args);
          await db.put(cacheKey, result);
          return result;
        } catch (error) {
          console.error('Cache operation failed:', error);
          return originalMethod.apply(this, args);
        }
      };

      return descriptor;
    };
  };
}
