# S3Helper 防重复上传功能使用示例

## 基本使用

```typescript
import { S3Helper, S3Provider, IKVDatabase } from './s3Helper';

// 实现一个简单的内存KV数据库用于演示
class SimpleKVDB implements IKVDatabase {
  private store = new Map<string, any>();

  async get(key: string): Promise<any | null> {
    return this.store.get(key) || null;
  }

  async put(key: string, value: any): Promise<void> {
    this.store.set(key, value);
  }
}

// 1. 使用防重复上传功能 - 传入KVDB
const kvdb = new SimpleKVDB();
const s3HelperWithCache = S3Helper.createAWS(
  'your-access-key',
  'your-secret-key',
  kvdb, // 传入KVDB启用防重复功能
  'us-east-1',
  'my-bucket',
);

// 2. 不使用防重复上传功能 - 不传KVDB
const s3HelperWithoutCache = S3Helper.createAWS(
  'your-access-key',
  'your-secret-key',
  undefined, // 或者不传第三个参数
  'us-east-1',
  'my-bucket',
);

// 3. 使用构造函数直接创建
const s3HelperDirect = new S3Helper(
  {
    provider: S3Provider.AWS_S3,
    endPoint: 's3.us-east-1.amazonaws.com',
    accessKey: 'your-access-key',
    secretKey: 'your-secret-key',
    region: 'us-east-1',
    bucket: 'my-bucket',
  },
  kvdb,
); // kvdb参数可选
```

## 防重复上传功能

### 1. 启用防重复上传功能（需要传入 KVDB）

```typescript
// 使用带有KVDB的实例
const s3Helper = s3HelperWithCache;

// 第一次上传
const etag1 = await s3Helper.uploadFile('test-file.txt', '/path/to/file.txt');
console.log('首次上传ETag:', etag1);

// 再次上传相同文件（会检测到重复，直接返回缓存结果）
const etag2 = await s3Helper.uploadFile('test-file-2.txt', '/path/to/file.txt');
console.log('重复上传ETag:', etag2); // 应该与etag1相同

// 强制上传（忽略重复检查）
const etag3 = await s3Helper.uploadFile(
  'test-file-3.txt',
  '/path/to/file.txt',
  undefined,
  {
    forceUpload: true,
  },
);
console.log('强制上传ETag:', etag3);
```

### 1.1. 禁用防重复上传功能（不传 KVDB）

```typescript
// 使用不带KVDB的实例
const s3Helper = s3HelperWithoutCache;

// 每次都会实际上传，不会检查重复
const etag1 = await s3Helper.uploadFile('test-file.txt', '/path/to/file.txt');
const etag2 = await s3Helper.uploadFile('test-file-2.txt', '/path/to/file.txt'); // 会实际上传

console.log('都会实际上传，ETags可能不同:', etag1, etag2);
```

### 2. 高级上传（获取详细信息）

```typescript
// 使用高级上传方法获取详细结果
const result = await s3Helper.uploadFileAdvanced(
  'test-file.txt',
  '/path/to/file.txt',
);

if (result.wasUploaded) {
  console.log('文件已上传，ETag:', result.etag);
} else {
  console.log('文件已存在，使用缓存:', result.objectName);
}
```

### 3. Buffer 上传

```typescript
const buffer = Buffer.from('Hello, World!');

// 普通buffer上传
const etag = await s3Helper.uploadBuffer('hello.txt', buffer);

// 高级buffer上传
const result = await s3Helper.uploadBufferAdvanced('hello-2.txt', buffer);
console.log('是否实际上传:', result.wasUploaded);
```

## 配置选项

### UploadOptions

```typescript
interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  acl?: 'private' | 'public-read' | 'public-read-write';
  forceUpload?: boolean; // 新增：是否强制上传，忽略重复检查
}
```

### UploadResult

```typescript
interface UploadResult {
  etag: string; // 文件的ETag
  objectName: string; // 对象名称
  wasUploaded: boolean; // true表示实际上传了，false表示从缓存中获取
}
```

## 工作原理

### 启用防重复上传（传入 KVDB）时：

1. **上传前检查**: 在文件上传前，计算文件的 MD5 哈希作为唯一标识
2. **缓存查询**: 在 KV 数据库中查询是否已存在相同 MD5 的文件
3. **存在性验证**: 如果找到缓存条目，验证 S3 中的文件是否仍然存在
4. **返回结果**: 如果文件存在且不是强制上传，直接返回缓存的对象名称
5. **实际上传**: 如果不存在或强制上传，执行实际上传并更新缓存

### 禁用防重复上传（不传 KVDB）时：

1. **直接上传**: 跳过所有重复检查，直接执行上传操作
2. **标准流程**: 按照标准 S3 上传流程处理文件

## 注意事项

1. **可选功能**: KVDB 参数现在是可选的，如果不传入则禁用防重复上传功能，直接进行标准上传

2. **KV 数据库接口**: 当前 KV 数据库接口只支持`get`和`put`操作，如需完整的缓存管理功能，建议扩展接口支持`delete`和`keys`操作

3. **存储成本**: 缓存可以有效减少重复上传，但也会占用 KV 数据库存储空间

4. **缓存一致性**: 如果 S3 中的文件被外部删除，缓存可能会失效，建议定期清理

5. **MD5 计算**: 对于大文件，MD5 计算可能耗时较长，可以考虑使用其他更快的哈希算法

6. **性能考虑**: 如果不需要防重复功能，建议不传入 KVDB 以获得更好的上传性能

## 扩展 KV 数据库接口建议

```typescript
export interface IKVDatabase<T = any> {
  get(key: string, ttl?: number): Promise<T | null>;
  put(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>; // 建议新增
  keys(pattern?: string): Promise<string[]>; // 建议新增
  clear(): Promise<void>; // 建议新增
}
```
