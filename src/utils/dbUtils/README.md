# PostgreSQL Key-Value Database with Multiple Value Types

## 概述

`PGKVDatabase` 类现在支持在初始化时指定不同的值类型，提供了更灵活的数据存储选项。

## 支持的值类型

- **`jsonb`** - JSON 二进制格式（默认）- 支持所有高级功能
- **`varchar`** - 可变长度字符串（最大 255 字符）
- **`text`** - 无限长度文本
- **`integer`** - 32位整数
- **`boolean`** - 布尔值
- **`float`** - 浮点数
- **`bytea`** - 二进制数据类型，用于存储 BLOB 数据

## 基本用法

```typescript
import { PGKVDatabase, ValueType } from './KVPostgresql';

// JSONB 类型（默认）- 支持所有功能
const jsonbDB = new PGKVDatabase('postgresql://...', 'json_store', 'jsonb');

// VARCHAR 类型 - 基本字符串操作
const stringDB = new PGKVDatabase('postgresql://...', 'string_store', 'varchar');

// INTEGER 类型 - 数值操作
const intDB = new PGKVDatabase('postgresql://...', 'int_store', 'integer');

// BOOLEAN 类型 - 布尔值操作
const boolDB = new PGKVDatabase('postgresql://...', 'bool_store', 'boolean');

// BYTEA 类型 - 二进制数据操作
const blobDB = new PGKVDatabase('postgresql://...', 'blob_store', 'bytea');
```

## 功能支持矩阵

| 操作 | JSONB | VARCHAR | TEXT | INTEGER | BOOLEAN | FLOAT | BYTEA |
|------|-------|---------|------|---------|---------|-------|-------|
| `put/get/delete` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `add/has/keys` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `putMany/deleteMany` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `getAll/count/clear` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `searchByTime` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `getRandomData` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `merge` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `searchJson` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `searchJsonByTime` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `findBoolValues` | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `saveArray`* | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |

*⚠️ 表示提供基本支持，但针对 JSONB 优化

## 类型检查

使用 `isOperationSupported()` 方法检查操作是否支持：

```typescript
const db = new PGKVDatabase('postgresql://...', 'store', 'varchar');

console.log(db.isOperationSupported('merge')); // false
console.log(db.isOperationSupported('put')); // true
```

## 示例

### JSONB 类型（完整功能）

```typescript
const db = new PGKVDatabase(url, 'json_store', 'jsonb');

// 存储复杂对象
await db.put('user:1', { 
  name: 'John', 
  age: 30, 
  preferences: { theme: 'dark' }
});

// 合并更新
await db.merge('user:1', { 
  age: 31, 
  preferences: { language: 'en' }
});

// JSON 搜索
const results = await db.searchJson({
  contains: { name: 'John' }
});

// 数组操作
await db.saveArray('items', [1, 2, 3, 4, 5]);
const items = await db.getAllArray('items');
```

### VARCHAR 类型（字符串）

```typescript
const db = new PGKVDatabase(url, 'string_store', 'varchar');

await db.put('name:1', 'John Doe');
await db.put('name:2', 'Jane Smith');

const name = await db.get('name:1'); // 'John Doe'
const exists = await db.isValueExists('John Doe'); // true
```

### INTEGER 类型（数值）

```typescript
const db = new PGKVDatabase(url, 'int_store', 'integer');

await db.put('count:1', 42);
await db.put('count:2', 100);

const count = await db.get<number>('count:1'); // 42
```

### BOOLEAN 类型（布尔值）

```typescript
const db = new PGKVDatabase(url, 'bool_store', 'boolean');

await db.put('active:1', true);
await db.put('active:2', false);

// 查找所有 true 值
const trueKeys = await db.findBoolValues(true, false);
```

### BYTEA 类型（二进制数据）

```typescript
const db = new PGKVDatabase(url, 'blob_store', 'bytea');

// 存储二进制数据
const imageBuffer = Buffer.from('image data here', 'base64');
await db.put('image:1', imageBuffer);

// 存储文件数据
const fileBuffer = Buffer.from('file content');
await db.put('file:1', fileBuffer);

// 存储字符串（自动转换为 Buffer）
await db.put('text:1', 'This will be converted to Buffer');

// 存储 Uint8Array（自动转换为 Buffer）
const uint8Array = new Uint8Array([1, 2, 3, 4]);
await db.put('array:1', uint8Array);

// 获取二进制数据
const data = await db.get<Buffer>('image:1');
console.log('Data length:', data?.length);

// 检查二进制数据是否存在
const exists = await db.isValueExists(imageBuffer);

// 批量存储二进制数据
await db.putMany([
  ['doc:1', Buffer.from('Document 1')],
  ['doc:2', Buffer.from('Document 2')],
]);
```

**BYTEA 类型注意事项：**
- 自动将字符串转换为 Buffer（UTF-8 编码）
- 自动将 Uint8Array 转换为 Buffer
- 其他类型会先 JSON 序列化再转为 Buffer
- 比较操作基于二进制内容完全匹配
- 适合存储文件、图片、加密数据等二进制内容

## 迁移注意事项

1. **现有数据**：更改值类型不会自动转换现有数据
2. **索引**：JSONB 类型使用 GIN 索引，其他类型使用 B-tree 索引
3. **性能**：JSONB 类型对复杂查询优化，简单类型对基本操作优化

## 错误处理

当使用不支持的操作时，会抛出错误：

```typescript
const db = new PGKVDatabase(url, 'string_store', 'varchar');

try {
  await db.merge('key', { data: 'value' }); // 抛出错误
} catch (error) {
  console.error(error.message); 
  // "Operation 'merge' is not supported for value type 'varchar'"
}
```

## 最佳实践

1. **选择合适的类型**：根据数据特征选择最适合的值类型
2. **JSONB 优先**：对于复杂数据结构，优先使用 JSONB
3. **简单类型优化**：对于简单数据，使用对应的基本类型可以提高性能
4. **类型一致性**：在同一个表中保持值类型的一致性
5. **操作检查**：在关键操作前使用 `isOperationSupported()` 检查支持性
6. **BYTEA 使用建议**：
   - 用于存储文件、图片、文档等二进制数据
   - 对于大型二进制数据，考虑使用外部存储（如 S3）+ 引用
   - 注意 PostgreSQL 对 BYTEA 列的大小限制（通常 1GB）
7. **性能考虑**：
   - JSONB：适合复杂查询和部分更新
   - VARCHAR：适合短字符串和精确匹配
   - TEXT：适合长文本和全文搜索
   - INTEGER/FLOAT：适合数值计算和范围查询
   - BOOLEAN：适合简单的真/假标记
   - BYTEA：适合二进制数据存储，但查询性能较低

## 完整示例

参见以下文件：
- `postgresql-examples.ts` - 所有值类型的详细使用示例
- `bytea-test.ts` - BYTEA 类型的专门测试示例 