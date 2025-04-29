import { KVDatabase } from "./PGKVDatabase";

export function createCacheDecorator(
  db: KVDatabase,
  defaultTTL: number = 5 * 60 * 1000
) {
  return function cache(prefix: string = "", ttl: number = defaultTTL) {
    return function (
      target: any,
      propertyKey: string,
      descriptor: PropertyDescriptor
    ) {
      const originalMethod = descriptor.value;

      descriptor.value = async function (...args: any[]) {
        const cacheKey = `${prefix}:${propertyKey}:${JSON.stringify(args)}`;

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
      };

      return descriptor;
    };
  };
}
