import { KVDatabase } from "./SqliteKVDB";

export function createCacheDecorator(
  db: KVDatabase,
  defaultTTL: number = 1 * 60 * 1000
) {
  return function cache(ttl: number = defaultTTL, prefix: string = "") {
    return function (
      target: any,
      propertyKey: string,
      descriptor: PropertyDescriptor
    ) {
      const originalMethod = descriptor.value;

      descriptor.value = async function (...args: any[]) {
        try {
          const cacheKey = `${prefix}:${propertyKey}:${JSON.stringify(
            args
          )}`.slice(0, 255);

          const cached = await db.get<{ value: any; timestamp: number }>(
            cacheKey
          );

          const now = Date.now();

          if (cached && now - cached.timestamp < ttl) {
            return cached.value;
          }

          const result = await originalMethod.apply(this, args);

          await db.put(cacheKey, {
            value: result,
            timestamp: now,
          });

          return result;
        } catch (error) {
          console.error("Cache operation failed:", error);
          return originalMethod.apply(this, args);
        }
      };

      return descriptor;
    };
  };
}
