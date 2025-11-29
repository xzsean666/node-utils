import { createCacheDecorator} from "./KVCache"
import { SqljsKVDatabase } from "./KVSqljs";

export const cache = createCacheDecorator<any>(new SqljsKVDatabase('./db/cache.db'));