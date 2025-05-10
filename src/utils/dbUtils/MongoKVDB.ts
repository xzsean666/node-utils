import { MongoClient, Collection } from "mongodb";

export class MongoKVDB {
  private client: MongoClient;
  private collection: Collection;
  private initialized = false;
  private collectionName: string;

  constructor(connectionString: string, collectionName: string = "kv_store") {
    this.collectionName = collectionName;
    this.client = new MongoClient(connectionString, {
      maxPoolSize: 50,
      minPoolSize: 5,
      connectTimeoutMS: 3000,
      socketTimeoutMS: 15000,
      serverSelectionTimeoutMS: 15000,
      keepAlive: true,
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.client.connect();
      this.collection = this.client.db().collection(this.collectionName);

      // 创建索引
      await this.collection.createIndex({ key: 1 }, { unique: true });
      await this.collection.createIndex({ value: 1 });
      await this.collection.createIndex({ created_at: 1 });
      await this.collection.createIndex({ updated_at: 1 });

      this.initialized = true;
    }
  }

  async put(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    const now = new Date();
    await this.collection.updateOne(
      { key },
      {
        $set: {
          key,
          value,
          updated_at: now,
        },
        $setOnInsert: {
          created_at: now,
        },
      },
      { upsert: true }
    );
  }

  async merge(key: string, partialValue: any): Promise<boolean> {
    await this.ensureInitialized();
    const now = new Date();
    const result = await this.collection.updateOne(
      { key },
      {
        $set: {
          value: { $mergeObjects: ["$value", partialValue] },
          updated_at: now,
        },
        $setOnInsert: {
          created_at: now,
        },
      },
      { upsert: true }
    );
    return result.acknowledged;
  }

  async get<T = any>(
    key: string,
    expire?: number,
    deleteExpired: boolean = true
  ): Promise<T | null> {
    await this.ensureInitialized();
    const record = await this.collection.findOne({ key });

    if (!record) return null;

    if (expire !== undefined) {
      const currentTime = Math.floor(Date.now() / 1000);
      const createdTime = Math.floor(record.created_at.getTime() / 1000);
      if (currentTime - createdTime > expire) {
        if (deleteExpired) {
          await this.delete(key);
        }
        return null;
      }
    }
    return record.value;
  }

  async getValue(value: any): Promise<any> {
    await this.ensureInitialized();
    return await this.collection.findOne({ value });
  }

  async isValueExists(value: any): Promise<boolean> {
    await this.ensureInitialized();
    const count = await this.collection.countDocuments({ value });
    return count > 0;
  }

  async getValues(value: any): Promise<any[]> {
    await this.ensureInitialized();
    return await this.collection.find({ value }).toArray();
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureInitialized();
    const result = await this.collection.deleteOne({ key });
    return result.deletedCount > 0;
  }

  async add(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    const now = new Date();
    try {
      await this.collection.insertOne({
        key,
        value,
        created_at: now,
        updated_at: now,
      });
    } catch (error) {
      if ((error as any).code === 11000) {
        // MongoDB duplicate key error
        throw new Error(`Key "${key}" already exists`);
      }
      throw error;
    }
  }

  async addUniquePair(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    const now = new Date();
    try {
      await this.collection.insertOne({
        key,
        value,
        created_at: now,
        updated_at: now,
      });
    } catch (error) {
      if ((error as any).code === 11000) {
        throw new Error(`Key-value pair already exists for key "${key}"`);
      }
      throw error;
    }
  }

  async addUniqueValue(key: string, value: any): Promise<void> {
    await this.ensureInitialized();
    const existing = await this.collection.findOne({ value });
    if (existing) {
      throw new Error(`Value already exists with key "${existing.key}"`);
    }

    const now = new Date();
    await this.collection.insertOne({
      key,
      value,
      created_at: now,
      updated_at: now,
    });
  }

  async close(): Promise<void> {
    if (this.initialized) {
      await this.client.close();
      this.initialized = false;
    }
  }

  async getAll(offset?: number, limit?: number): Promise<Map<string, any>> {
    await this.ensureInitialized();
    const cursor = this.collection.find().sort({ key: 1 });

    if (typeof offset === "number") {
      cursor.skip(offset);
    }

    if (typeof limit === "number") {
      cursor.limit(limit);
    }

    const records = await cursor.toArray();
    const batchMap = new Map<string, any[]>(
      records.map((record) => [record.key, record.value])
    );
    return batchMap;
  }

  async keys(): Promise<string[]> {
    await this.ensureInitialized();
    const records = await this.collection
      .find({}, { projection: { key: 1, _id: 0 } })
      .toArray();
    return records.map((record) => record.key);
  }

  async has(key: string): Promise<boolean> {
    await this.ensureInitialized();
    const count = await this.collection.countDocuments({ key });
    return count > 0;
  }

  async putMany(
    entries: Array<[string, any]>,
    batchSize: number = 1000
  ): Promise<void> {
    await this.ensureInitialized();
    const now = new Date();

    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const operations = batch.map(([key, value]) => ({
        updateOne: {
          filter: { key },
          update: {
            $set: {
              key,
              value,
              updated_at: now,
            },
            $setOnInsert: {
              created_at: now,
            },
          },
          upsert: true,
        },
      }));

      await this.collection.bulkWrite(operations);
    }
  }

  async deleteMany(keys: string[]): Promise<number> {
    await this.ensureInitialized();
    const result = await this.collection.deleteMany({ key: { $in: keys } });
    return result.deletedCount;
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    await this.collection.deleteMany({});
  }

  async count(): Promise<number> {
    await this.ensureInitialized();
    return await this.collection.countDocuments();
  }

  async findBoolValues(
    boolValue: boolean,
    first: boolean = true,
    orderBy: "ASC" | "DESC" = "ASC"
  ): Promise<string[] | string | null> {
    await this.ensureInitialized();
    const cursor = this.collection
      .find({ value: boolValue })
      .sort({ created_at: orderBy === "ASC" ? 1 : -1 });

    if (first) {
      const result = await cursor.limit(1).toArray();
      return result.length > 0 ? result[0].key : null;
    }

    const results = await cursor.toArray();
    return results.map((record) => record.key);
  }

  async searchJson(searchOptions: {
    contains?: object;
    limit?: number;
    cursor?: string;
    compare?: Array<{
      path: string;
      operator: ">" | "<" | ">=" | "<=" | "=" | "!=";
      value: number | string | Date;
    }>;
  }): Promise<{
    data: any[];
    nextCursor: string | null;
  }> {
    await this.ensureInitialized();
    const limit = searchOptions.limit || 100;
    const query: any = {};

    if (searchOptions.contains) {
      query.value = {
        $all: Object.entries(searchOptions.contains).map(([k, v]) => ({
          [k]: v,
        })),
      };
    }

    if (searchOptions.compare) {
      searchOptions.compare.forEach((condition) => {
        const operator =
          condition.operator === "!=" ? "$ne" : `$${condition.operator}`;
        query[`value.${condition.path}`] = { [operator]: condition.value };
      });
    }

    if (searchOptions.cursor) {
      query.key = { $gt: searchOptions.cursor };
    }

    const cursor = this.collection
      .find(query)
      .sort({ key: 1 })
      .limit(limit + 1);

    const results = await cursor.toArray();
    const hasMore = results.length > limit;
    const data = results.slice(0, limit);
    const nextCursor =
      hasMore && data.length > 0 ? data[data.length - 1].key : null;

    return {
      data,
      nextCursor,
    };
  }

  async findByUpdateTime(
    timestamp: number,
    first: boolean = true,
    type: "before" | "after" = "after",
    orderBy: "ASC" | "DESC" = "ASC"
  ): Promise<string[] | string | null> {
    await this.ensureInitialized();
    const operator = type === "before" ? "$lt" : "$gt";
    const cursor = this.collection
      .find({ updated_at: { [operator]: new Date(timestamp) } })
      .sort({ updated_at: orderBy === "ASC" ? 1 : -1 });

    if (first) {
      const result = await cursor.limit(1).toArray();
      return result.length > 0 ? result[0].key : null;
    }

    const results = await cursor.toArray();
    return results.map((record) => record.key);
  }

  async searchByTime(params: {
    timestamp: number;
    take?: number;
    type?: "before" | "after";
    orderBy?: "ASC" | "DESC";
    timeColumn?: "updated_at" | "created_at";
  }): Promise<Array<{ key: string; value: any }>> {
    await this.ensureInitialized();
    const timeColumn = params.timeColumn || "updated_at";
    const operator = (params.type || "after") === "before" ? "$lt" : "$gt";
    const cursor = this.collection
      .find({ [timeColumn]: { [operator]: new Date(params.timestamp) } })
      .sort({ [timeColumn]: params.orderBy === "DESC" ? -1 : 1 })
      .limit(params.take || 1);

    return await cursor.toArray();
  }

  async searchJsonByTime(
    searchOptions: {
      contains?: object;
      equals?: object;
      path?: string;
      value?: any;
    },
    timeOptions: {
      timestamp: number;
      take?: number;
      type?: "before" | "after";
      orderBy?: "ASC" | "DESC";
      timeColumn?: "updated_at" | "created_at";
    }
  ): Promise<Array<{ key: string; value: any }>> {
    await this.ensureInitialized();
    const timeColumn = timeOptions.timeColumn || "updated_at";
    const operator = (timeOptions.type || "after") === "before" ? "$lt" : "$gt";

    const query: any = {
      [timeColumn]: { [operator]: new Date(timeOptions.timestamp) },
    };

    if (searchOptions.contains) {
      query.value = {
        $all: Object.entries(searchOptions.contains).map(([k, v]) => ({
          [k]: v,
        })),
      };
    }

    if (searchOptions.equals) {
      query.value = searchOptions.equals;
    }

    if (searchOptions.path && searchOptions.value !== undefined) {
      query[`value.${searchOptions.path}`] = searchOptions.value;
    }

    const cursor = this.collection
      .find(query)
      .sort({ [timeColumn]: timeOptions.orderBy === "DESC" ? -1 : 1 })
      .limit(timeOptions.take || 1);

    return await cursor.toArray();
  }

  async saveArray(
    key: string,
    array: any[],
    batchSize: number = 1000,
    forceUpdateBatchSize: boolean = false
  ): Promise<void> {
    await this.ensureInitialized();
    const metaKey = `${key}_meta`;
    const now = new Date();

    const existingMeta = await this.get(metaKey);
    if (existingMeta && existingMeta.batchCount > 0) {
      const existingBatchCount = existingMeta.batchCount;
      const existingTotalItems = existingMeta.totalItems;
      const storedBatchSize = existingMeta.batchSize || batchSize;

      if (forceUpdateBatchSize && batchSize !== storedBatchSize) {
        // 需要重新组织数据
        const allData = await this.getAllArray(key);
        const keysToDelete = [metaKey];
        for (let i = 0; i < existingBatchCount; i++) {
          keysToDelete.push(`${key}_${i}`);
        }
        await this.deleteMany(keysToDelete);
        array = [...allData, ...array];
      } else {
        batchSize = storedBatchSize;
      }

      const lastBatchKey = `${key}_${existingBatchCount - 1}`;
      const lastBatch = (await this.get(lastBatchKey)) || [];
      const remainingSpace = batchSize - lastBatch.length;

      const itemsForLastBatch =
        remainingSpace > 0 ? array.slice(0, remainingSpace) : [];
      const remainingItems =
        remainingSpace > 0 ? array.slice(remainingSpace) : array;

      if (itemsForLastBatch.length > 0) {
        await this.put(lastBatchKey, [...lastBatch, ...itemsForLastBatch]);
      }

      let newBatchesCount = 0;
      for (let i = 0; i < remainingItems.length; i += batchSize) {
        const batchData = remainingItems.slice(i, i + batchSize);
        const batchKey = `${key}_${existingBatchCount + newBatchesCount}`;
        await this.put(batchKey, batchData);
        newBatchesCount++;
      }

      const newTotalItems = existingTotalItems + array.length;
      const newBatchCount = existingBatchCount + newBatchesCount;

      await this.put(metaKey, {
        batchCount: newBatchCount,
        totalItems: newTotalItems,
        batchSize: batchSize,
        lastUpdated: now.toISOString(),
      });
    } else {
      const batchCount = Math.ceil(array.length / batchSize);
      const metaValue = {
        batchCount,
        totalItems: array.length,
        batchSize,
        lastUpdated: now.toISOString(),
      };

      await this.put(metaKey, metaValue);

      for (let i = 0; i < batchCount; i++) {
        const start = i * batchSize;
        const end = Math.min(start + batchSize, array.length);
        const batchData = array.slice(start, end);
        const batchKey = `${key}_${i}`;
        await this.put(batchKey, batchData);
      }
    }
  }

  async getAllArray<T = any>(key: string): Promise<T[]> {
    await this.ensureInitialized();
    const metaKey = `${key}_meta`;
    const meta = await this.get(metaKey);

    if (!meta || !meta.batchCount) {
      return [];
    }

    const batchKeys = Array.from(
      { length: meta.batchCount },
      (_, i) => `${key}_${i}`
    );
    const records = await this.collection
      .find({ key: { $in: batchKeys } })
      .sort({ key: 1 })
      .toArray();

    const batchMap = new Map<string, any[]>(
      records.map((record) => [record.key, record.value])
    );
    const allData: T[] = [];

    for (let i = 0; i < meta.batchCount; i++) {
      const batchKey = `${key}_${i}`;
      const batch = batchMap.get(batchKey) || [];
      allData.push(...batch);
    }

    return allData;
  }

  async getRecentArray<T = any>(key: string, count: number): Promise<T[]> {
    await this.ensureInitialized();
    const metaKey = `${key}_meta`;
    const meta = await this.get(metaKey);

    if (!meta || !meta.batchCount || count <= 0) {
      return [];
    }

    if (count >= meta.totalItems) {
      return this.getAllArray<T>(key);
    }

    const batchSize = meta.batchSize || 1000;
    let itemsNeeded = count;
    let startBatch = meta.batchCount - 1;
    const neededBatches: string[] = [];

    while (itemsNeeded > 0 && startBatch >= 0) {
      neededBatches.push(`${key}_${startBatch}`);
      itemsNeeded -=
        startBatch === meta.batchCount - 1
          ? meta.totalItems % batchSize || batchSize
          : batchSize;
      startBatch--;
    }

    const records = await this.collection
      .find({ key: { $in: neededBatches } })
      .sort({ key: -1 })
      .toArray();

    const recentItems: T[] = [];
    let remainingCount = count;

    for (const record of records) {
      const batch = record.value || [];

      if (batch.length <= remainingCount) {
        recentItems.unshift(...batch);
        remainingCount -= batch.length;
      } else {
        const startIndex = batch.length - remainingCount;
        const recentFromBatch = batch.slice(startIndex);
        recentItems.unshift(...recentFromBatch);
        remainingCount = 0;
      }

      if (remainingCount <= 0) break;
    }

    return recentItems;
  }

  async getArrayRange<T = any>(
    key: string,
    startIndex: number,
    endIndex: number
  ): Promise<T[]> {
    await this.ensureInitialized();

    if (startIndex < 0 || endIndex <= startIndex) {
      return [];
    }

    const metaKey = `${key}_meta`;
    const meta = await this.get(metaKey);

    if (!meta || !meta.batchCount) {
      return [];
    }

    endIndex = Math.min(endIndex, meta.totalItems);

    if (startIndex >= meta.totalItems) {
      return [];
    }

    const batchSize = meta.batchSize || 1000;
    const startBatch = Math.floor(startIndex / batchSize);
    const endBatch = Math.floor((endIndex - 1) / batchSize);

    const batchKeys = Array.from(
      { length: endBatch - startBatch + 1 },
      (_, i) => `${key}_${startBatch + i}`
    );

    const records = await this.collection
      .find({ key: { $in: batchKeys } })
      .sort({ key: 1 })
      .toArray();

    const batchMap = new Map<string, any[]>(
      records.map((record) => [record.key, record.value])
    );
    const result: T[] = [];

    for (let i = startBatch; i <= endBatch; i++) {
      const batchKey = `${key}_${i}`;
      const batch = batchMap.get(batchKey) || [];
      const batchStartIndex = i * batchSize;
      const localStartIndex = Math.max(0, startIndex - batchStartIndex);
      const localEndIndex = Math.min(batch.length, endIndex - batchStartIndex);

      if (localStartIndex < localEndIndex) {
        result.push(...batch.slice(localStartIndex, localEndIndex));
      }
    }

    return result;
  }

  async getRandomData(
    count: number = 1
  ): Promise<Array<{ key: string; value: any }>> {
    await this.ensureInitialized();
    return await this.collection
      .aggregate([
        { $sample: { size: count } },
        { $project: { _id: 0, key: 1, value: 1 } },
      ])
      .toArray();
  }
}
