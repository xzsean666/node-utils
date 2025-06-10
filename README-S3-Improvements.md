# S3Helper 防重复上传功能改进

## 问题分析

用户正确指出了 `uploadFolderImages` 方法没有充分利用现有的防重复上传逻辑。虽然该方法内部调用了 `uploadFile`，而 `uploadFile` 确实有防重复功能，但在批量上传场景下没有明确展示重复检查的结果。

## 修复内容

### 1. 增强 `uploadFolderImages` 方法

**Before:**

```typescript
Promise<{
  successful: Array<{ localPath: string; s3Key: string; fileInfo: FileInfo }>;
  failed: Array<{ localPath: string; error: string }>;
  totalFiles: number;
}>;
```

**After:**

```typescript
Promise<{
  successful: Array<{
    localPath: string;
    s3Key: string;
    fileInfo: FileInfo;
    wasUploaded: boolean;
  }>;
  failed: Array<{ localPath: string; error: string }>;
  totalFiles: number;
  uploadedCount: number; // 实际上传的文件数量
  cachedCount: number; // 从缓存获取的文件数量
}>;
```

**改进点：**

- ✅ 增加了 `wasUploaded` 字段显示文件是否实际上传
- ✅ 增加了 `uploadedCount` 和 `cachedCount` 统计信息
- ✅ 在控制台明确显示缓存命中情况
- ✅ 提前检查重复文件，避免不必要的处理

### 2. 新增 `uploadFolderImagesAdvanced` 方法

这个方法使用 `uploadFileAdvanced` 来提供更详细的重复检查信息：

```typescript
async uploadFolderImagesAdvanced(
  localFolderPath: string,
  s3Prefix?: string,
  bucket?: string,
  options?: UploadOptions,
): Promise<{
  successful: Array<{ localPath: string; s3Key: string; uploadResult: UploadResult }>;
  failed: Array<{ localPath: string; error: string }>;
  totalFiles: number;
  uploadedCount: number;
  cachedCount: number;
}>
```

**特性：**

- ✅ 使用 `uploadFileAdvanced` 获得详细的上传结果
- ✅ 清晰区分实际上传和缓存命中
- ✅ 提供完整的 `UploadResult` 信息

### 3. 防重复上传工作原理

#### 现有机制：

1. **MD5 计算**：为每个文件计算 MD5 哈希值
2. **缓存检查**：通过 KVDB 查询是否已存在相同 MD5 的文件
3. **验证存在性**：如果找到缓存记录，验证 S3 中文件是否仍然存在
4. **ETag 对比**：对比文件的 ETag 确保文件完整性
5. **缓存更新**：上传成功后将 MD5 和对象名映射存储到 KVDB

#### 批量上传优化：

```typescript
// 检查是否启用了防重复上传
if (this.isDuplicationCheckEnabled() && !options?.forceUpload) {
  const fileMD5 = await this.calculateFileMD5(filePath);
  const existingObjectName = await this.checkDuplicate(fileMD5);

  if (existingObjectName) {
    try {
      const existingInfo = await this.getFileInfo(existingObjectName, bucket);
      if (this.normalizeETag(existingInfo.etag) === fileMD5) {
        // 文件已存在，跳过上传
        successful.push({
          localPath: filePath,
          s3Key: existingObjectName,
          fileInfo: existingInfo,
          wasUploaded: false,
        });
        cachedCount++;
        console.log(`⚡ Cached: ${filePath} -> ${existingObjectName}`);
        continue;
      }
    } catch (error) {
      // 缓存的文件不存在，继续上传
    }
  }
}
```

## 使用示例

### 基础用法

```typescript
const result = await s3Helper.uploadFolderImages('./photos', 'gallery/2024');
console.log(`总文件: ${result.totalFiles}`);
console.log(`实际上传: ${result.uploadedCount}`);
console.log(`从缓存: ${result.cachedCount}`);
console.log(`失败: ${result.failed.length}`);
```

### 高级用法

```typescript
const result = await s3Helper.uploadFolderImagesAdvanced(
  './photos',
  'gallery/2024',
);

// 查看所有从缓存获取的文件
const cachedFiles = result.successful.filter(
  (f) => !f.uploadResult.wasUploaded,
);
cachedFiles.forEach((f) => {
  console.log(`缓存命中: ${f.localPath} -> ${f.uploadResult.objectName}`);
});
```

## 控制台输出示例

```
Found 100 image files to upload
⚡ Cached: ./photos/img1.jpg -> gallery/2024/img1.jpg (already exists)
⚡ Cached: ./photos/img2.png -> gallery/2024/img2.png (already exists)
✓ Uploaded: ./photos/img3.gif -> gallery/2024/img3.gif
✓ Uploaded: ./photos/img4.webp -> gallery/2024/img4.webp
...
Upload summary: 20 uploaded, 78 from cache, 2 failed
```

## 性能优势

1. **避免重复上传**：相同文件只上传一次，后续自动从缓存获取
2. **带宽节省**：跳过已存在文件的上传过程
3. **时间节省**：大量重复文件场景下显著提升速度
4. **成本节省**：减少 S3 PUT 请求次数

## 验证机制

- **文件完整性**：通过 MD5 和 ETag 双重验证
- **存在性检查**：确保缓存指向的文件仍然存在
- **容错处理**：缓存失效时自动重新上传

## `deleteBucket` 方法

检查后确认 `deleteBucket` 方法实现正确，符合 AWS S3 API 规范：

```typescript
async deleteBucket(bucket?: string): Promise<void> {
  try {
    const command = new DeleteBucketCommand({
      Bucket: this.getBucketName(bucket),
    });
    await this.client.send(command);
  } catch (error: any) {
    throw new Error(`删除 bucket 失败: ${error.message}`);
  }
}
```

该方法没有问题，它按照 AWS SDK 标准实现了 bucket 删除功能。
