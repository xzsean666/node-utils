# S3 Helper - 通用 S3 兼容存储工具

## 概述

`S3Helper` 是一个通用的 S3 兼容存储工具类，支持多种云存储服务提供商，包括：

- **AWS S3** - Amazon 的对象存储服务
- **Backblaze B2** - 经济实惠的云存储
- **Cloudflare R2** - 无出站费用的对象存储
- **MinIO** - 自托管的 S3 兼容存储
- **其他 S3 兼容服务** - 支持任何 S3 API 兼容的存储服务

## 特性

- ✅ 统一的 API 接口，支持所有 S3 兼容服务
- ✅ 工厂方法快速创建不同提供商的实例
- ✅ 支持文件、Buffer、Stream 多种上传方式
- ✅ 批量操作支持
- ✅ 预签名 URL 生成
- ✅ 文件复制、移动、删除操作
- ✅ 完整的 TypeScript 类型支持
- ✅ 错误处理和中文错误消息

## 安装

确保项目已安装 AWS SDK v3 依赖：

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
# 或
yarn add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
# 或
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### 为什么使用 AWS SDK v3？

- ✅ **官方支持** - Amazon 官方维护的 SDK
- ✅ **更好的 TypeScript 支持** - 完整的类型定义
- ✅ **模块化设计** - 只引入需要的功能，减少包大小
- ✅ **更好的 S3 兼容服务支持** - 原生支持各种 S3 兼容服务
- ✅ **性能优化** - 更好的性能和错误处理

## 快速开始

### 1. AWS S3

```typescript
import { S3Helper } from 'node-utils-sean';

// 使用工厂方法（推荐）
const s3 = S3Helper.createAWS(
  'your-access-key',
  'your-secret-key',
  'us-west-2', // 区域
  'my-bucket', // 可选的默认 bucket
);

// 或使用构造函数
const s3Manual = new S3Helper({
  provider: S3Provider.AWS_S3,
  endPoint: 's3.us-west-2.amazonaws.com',
  accessKey: 'your-access-key',
  secretKey: 'your-secret-key',
  region: 'us-west-2',
  bucket: 'my-bucket',
});
```

### 2. Backblaze B2

```typescript
const b2 = S3Helper.createBackblazeB2(
  'your-application-key-id',
  'your-application-key',
  's3.us-west-002.backblazeb2.com', // 你的 B2 端点
  'my-b2-bucket',
);
```

### 3. Cloudflare R2

```typescript
const r2 = S3Helper.createCloudflareR2(
  'your-access-key-id',
  'your-secret-access-key',
  'your-account-id', // Cloudflare 账户 ID
  'my-r2-bucket',
);
```

### 4. MinIO

```typescript
const minio = S3Helper.createMinIO(
  'localhost', // MinIO 服务器地址
  'minio-access-key',
  'minio-secret-key',
  false, // 是否使用 SSL
  9000, // 端口
  'my-minio-bucket',
);
```

### 5. 自定义 S3 兼容服务

```typescript
const customS3 = new S3Helper({
  provider: S3Provider.CUSTOM,
  endPoint: 'your-s3-compatible-endpoint.com',
  port: 443,
  useSSL: true,
  accessKey: 'your-access-key',
  secretKey: 'your-secret-key',
  region: 'custom-region',
  bucket: 'my-bucket',
});
```

## 基本操作

### Bucket 操作

```typescript
// 检查 bucket 是否存在
const exists = await s3.bucketExists('my-bucket');

// 创建 bucket
await s3.createBucket('new-bucket', 'us-west-2');

// 列出所有 buckets
const buckets = await s3.listBuckets();

// 删除 bucket
await s3.deleteBucket('old-bucket');
```

### 文件上传

```typescript
// 上传本地文件
await s3.uploadFile('remote-file.txt', '/path/to/local/file.txt', 'my-bucket', {
  contentType: 'text/plain',
  metadata: { 'custom-key': 'custom-value' },
});

// 上传 Buffer
const buffer = Buffer.from('Hello, World!', 'utf-8');
await s3.uploadBuffer('hello.txt', buffer, 'my-bucket', {
  contentType: 'text/plain',
});

// 上传 Stream
const stream = fs.createReadStream('/path/to/file');
const size = fs.statSync('/path/to/file').size;
await s3.uploadStream('stream-file.txt', stream, size, 'my-bucket');
```

### 文件下载

```typescript
// 下载到本地文件
await s3.downloadFile(
  'remote-file.txt',
  '/path/to/local/file.txt',
  'my-bucket',
);

// 下载到 Buffer
const buffer = await s3.downloadBuffer('remote-file.txt', 'my-bucket');

// 获取下载流
const stream = await s3.downloadStream('remote-file.txt', 'my-bucket');
```

### 文件信息和列表

```typescript
// 获取文件信息
const fileInfo = await s3.getFileInfo('file.txt', 'my-bucket');
console.log(fileInfo.size, fileInfo.lastModified);

// 列出文件
const files = await s3.listFiles('prefix/', 'my-bucket', true); // recursive

// 检查文件是否存在
const exists = await s3.fileExists('file.txt', 'my-bucket');
```

### 文件操作

```typescript
// 删除单个文件
await s3.deleteFile('file.txt', 'my-bucket');

// 批量删除文件
const result = await s3.deleteFiles(['file1.txt', 'file2.txt'], 'my-bucket');
console.log(result.successful, result.failed);

// 复制文件
await s3.copyFile('source.txt', 'dest.txt', 'source-bucket', 'dest-bucket');

// 移动文件
await s3.moveFile('old-name.txt', 'new-name.txt', 'my-bucket');
```

### 预签名 URL

```typescript
// 生成下载 URL（24小时有效）
const downloadUrl = await s3.getPresignedDownloadUrl(
  'file.txt',
  24 * 60 * 60,
  'my-bucket',
);

// 生成上传 URL（1小时有效）
const uploadUrl = await s3.getPresignedUploadUrl(
  'new-file.txt',
  3600,
  'my-bucket',
);
```

### 工具方法

```typescript
// 获取存储信息
const info = await s3.getStorageInfo('my-bucket');
console.log(`文件数量: ${info.objectCount}, 总大小: ${info.totalSize} 字节`);

// 清空 bucket
const result = await s3.clearBucket('my-bucket', 'prefix/'); // 可选前缀
```

## 高级用法

### 默认 Bucket

设置默认 bucket 后，可以省略 bucket 参数：

```typescript
const s3 = S3Helper.createAWS('key', 'secret', 'us-west-2', 'default-bucket');

// 这些操作都会使用默认 bucket
await s3.uploadFile('file.txt', '/path/to/file');
await s3.downloadFile('file.txt', '/path/to/download');
await s3.deleteFile('file.txt');
```

### 跨服务迁移

```typescript
// 从 AWS S3 迁移到 Cloudflare R2
const sourceS3 = S3Helper.createAWS(
  'aws-key',
  'aws-secret',
  'us-east-1',
  'source-bucket',
);
const targetR2 = S3Helper.createCloudflareR2(
  'r2-key',
  'r2-secret',
  'account-id',
  'target-bucket',
);

const files = await sourceS3.listFiles('', undefined, true);
for (const file of files) {
  if (file.name) {
    const buffer = await sourceS3.downloadBuffer(file.name);
    await targetR2.uploadBuffer(file.name, buffer);
    console.log(`迁移完成: ${file.name}`);
  }
}
```

### 多存储同步

```typescript
const storages = [
  S3Helper.createAWS('aws-key', 'aws-secret', 'us-east-1', 'backup'),
  S3Helper.createBackblazeB2('b2-key-id', 'b2-key', 'b2-endpoint', 'backup'),
  S3Helper.createMinIO(
    'minio.local',
    'minio-key',
    'minio-secret',
    false,
    9000,
    'backup',
  ),
];

const content = Buffer.from('重要数据', 'utf-8');

// 同时上传到所有存储
await Promise.all(
  storages.map((storage) =>
    storage.uploadBuffer('important.txt', content, undefined, {
      metadata: { 'sync-timestamp': new Date().toISOString() },
    }),
  ),
);
```

### 获取底层客户端

```typescript
// 获取 minio 客户端实例，用于高级操作
const minioClient = s3.getClient();

// 获取配置信息
const config = s3.getConfig();
```

## 错误处理

所有方法都会抛出带有中文描述的错误：

```typescript
try {
  await s3.uploadFile('file.txt', '/nonexistent/path');
} catch (error) {
  console.error(error.message); // "上传文件失败: ENOENT: no such file or directory"
}
```

## 配置各服务提供商

### AWS S3 配置

1. 在 AWS IAM 中创建用户和访问密钥
2. 为用户分配适当的 S3 权限
3. 使用访问密钥 ID 和秘密访问密钥

### Backblaze B2 配置

1. 在 Backblaze B2 控制台创建应用程序密钥
2. 获取密钥 ID 和密钥值
3. 从 bucket 详情页面获取 S3 兼容端点

### Cloudflare R2 配置

1. 在 Cloudflare 控制台启用 R2
2. 创建 R2 API 令牌
3. 使用账户 ID 和 API 令牌

### MinIO 配置

1. 安装并运行 MinIO 服务器
2. 设置访问密钥和秘密密钥
3. 配置正确的端点和端口

## 类型定义

```typescript
interface S3Config {
  provider: S3Provider;
  endPoint: string;
  port?: number;
  useSSL?: boolean;
  accessKey: string;
  secretKey: string;
  region?: string;
  bucket?: string;
}

interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  acl?: 'private' | 'public-read' | 'public-read-write';
}

interface FileInfo {
  name: string;
  size: number;
  lastModified: Date;
  etag: string;
  contentType?: string;
  metadata?: Record<string, string>;
}

interface BatchResult<T> {
  successful: T[];
  failed: Array<{ item: T; error: string }>;
}
```

## 注意事项

1. **端点配置**：不同服务的端点格式不同，请参考各服务的文档
2. **权限设置**：确保 API 密钥有足够的权限执行所需操作
3. **区域设置**：AWS S3 需要正确的区域配置
4. **SSL 设置**：生产环境建议启用 SSL
5. **错误处理**：始终使用 try-catch 处理异步操作

## 完整示例

查看 `src/utils/dbUtils/examples/s3HelperExample.ts` 文件获取更多完整的使用示例。
