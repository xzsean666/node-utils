# S3Helper 新功能使用指南

## 新增功能

### 1. 批量上传文件夹图片 (`uploadFolderImages`)

这个方法可以递归扫描本地文件夹，找到所有图片文件并批量上传到 S3。

#### 支持的图片格式

- `.jpg`, `.jpeg`
- `.png`
- `.gif`
- `.bmp`
- `.webp`
- `.svg`
- `.tiff`
- `.ico`

#### 使用方法

```typescript
const result = await s3Helper.uploadFolderImages(
  './local-images', // 本地文件夹路径
  'photos/2024', // S3前缀（可选）
  'my-bucket', // bucket名称（可选，使用默认）
  {
    acl: 'public-read', // ACL设置
    metadata: {
      // 自定义元数据
      project: 'gallery',
      'upload-date': new Date().toISOString(),
    },
  },
);

console.log(`上传了 ${result.successful.length} 个文件`);
console.log(`失败了 ${result.failed.length} 个文件`);
```

#### 返回结果

```typescript
{
  successful: Array<{ localPath: string; s3Key: string; fileInfo: FileInfo }>;
  failed: Array<{ localPath: string; error: string }>;
  totalFiles: number;
}
```

### 2. 生成所有文件的 Signed URL (`generateSignedUrlsToJson`)

为 bucket 中的所有文件（或指定前缀的文件）生成 signed URL 并保存到 JSON 文件。

#### 使用方法

```typescript
const result = await s3Helper.generateSignedUrlsToJson(
  './urls.json', // 输出JSON文件路径
  'my-bucket', // bucket名称（可选）
  'photos/', // 文件前缀（可选）
  24 * 60 * 60, // URL有效期（秒，默认24小时）
  {
    downloadUrls: true, // 生成下载URL
    uploadUrls: false, // 生成上传URL
    includeMetadata: true, // 包含文件元数据
  },
);
```

#### 生成的 JSON 文件结构

```json
{
  "generatedAt": "2024-01-01T00:00:00.000Z",
  "bucket": "my-bucket",
  "prefix": "photos/",
  "expiry": 86400,
  "options": {
    "downloadUrls": true,
    "uploadUrls": false,
    "includeMetadata": true
  },
  "summary": {
    "totalFiles": 10,
    "successfulUrls": 9,
    "failedUrls": 1
  },
  "files": [
    {
      "objectName": "photos/image1.jpg",
      "downloadUrl": "https://...",
      "metadata": {
        "size": 1024000,
        "lastModified": "2024-01-01T00:00:00.000Z",
        "etag": "abc123",
        "contentType": "image/jpeg"
      }
    }
  ]
}
```

### 3. 为特定文件生成 Signed URL (`generateSignedUrlsForFiles`)

为指定的文件列表生成 signed URL。

#### 使用方法

```typescript
const files = ['photos/image1.jpg', 'photos/image2.png', 'documents/file.pdf'];

const result = await s3Helper.generateSignedUrlsForFiles(
  files, // 文件列表
  './specific-urls.json', // 输出文件
  'my-bucket', // bucket（可选）
  7 * 24 * 60 * 60, // 7天有效期
  {
    downloadUrls: true,
    uploadUrls: true, // 也生成上传URL用于替换
    includeMetadata: true,
  },
);
```

## 完整使用示例

```typescript
import { S3Helper, S3Provider } from './src/utils/dbUtils/s3Helper';

async function main() {
  // 创建S3Helper实例
  const s3Helper = S3Helper.createAWS(
    'your-access-key',
    'your-secret-key',
    'your-bucket-name',
    'us-east-1',
  );

  try {
    // 1. 上传本地图片文件夹
    console.log('开始上传图片...');
    const uploadResult = await s3Helper.uploadFolderImages(
      './my-photos',
      'gallery/2024',
      undefined,
      { acl: 'public-read' },
    );

    console.log(
      `上传完成：${uploadResult.successful.length}/${uploadResult.totalFiles}`,
    );

    // 2. 生成所有文件的访问URL
    console.log('生成访问URL...');
    const urlResult = await s3Helper.generateSignedUrlsToJson(
      './photo-urls.json',
      undefined,
      'gallery/2024',
      24 * 60 * 60, // 24小时有效
    );

    console.log(
      `URL生成完成：${urlResult.successfulUrls}/${urlResult.totalFiles}`,
    );
    console.log(`结果保存在：${urlResult.outputPath}`);
  } catch (error) {
    console.error('操作失败：', error);
  }
}

main();
```

## 注意事项

1. **权限要求**：确保 S3 凭证有足够的权限进行文件上传和读取操作
2. **文件大小**：大文件上传会自动使用多部分上传
3. **错误处理**：方法会捕获单个文件的错误，不会因为一个文件失败而停止整个操作
4. **Content-Type**：图片文件会自动设置正确的 Content-Type
5. **防重复上传**：如果配置了 KVDB，会自动检测重复文件
6. **URL 有效期**：Signed URL 有时间限制，过期后需要重新生成

## 错误处理

```typescript
try {
  const result = await s3Helper.uploadFolderImages('./photos', 'gallery');

  // 检查是否有失败的文件
  if (result.failed.length > 0) {
    console.log('以下文件上传失败：');
    result.failed.forEach((fail) => {
      console.log(`${fail.localPath}: ${fail.error}`);
    });
  }
} catch (error) {
  console.error('批量上传失败：', error.message);
}
```
