import { S3Helper, S3Provider } from '../s3Helper';

// 示例：如何使用通用 S3 Helper 连接不同的服务提供商

async function examples() {
  // 1. AWS S3 (使用工厂方法)
  const awsS3 = S3Helper.createAWS(
    'your-access-key',
    'your-secret-key',
    'my-bucket', // 默认 bucket
    'us-west-2', // 区域
  );

  // 2. AWS S3 (使用构造函数)
  const awsS3Manual = new S3Helper({
    provider: S3Provider.AWS_S3,
    endPoint: 's3.us-west-2.amazonaws.com',
    accessKey: 'your-access-key',
    secretKey: 'your-secret-key',
    region: 'us-west-2',
    bucket: 'my-bucket',
  });

  // 3. Backblaze B2
  const b2 = S3Helper.createBackblazeB2(
    'your-application-key-id',
    'your-application-key',
    's3.us-west-002.backblazeb2.com', // 你的 B2 bucket 端点
    'my-b2-bucket',
  );

  // 4. Cloudflare R2
  const r2 = S3Helper.createCloudflareR2(
    'your-access-key-id',
    'your-secret-access-key',
    'your-account-id', // Cloudflare 账户 ID
    'my-r2-bucket',
  );

  // 5. MinIO (本地或自建)
  const minio = S3Helper.createMinIO(
    'minio-access-key',
    'minio-secret-key',
    'localhost', // 或你的 MinIO 服务器地址
    'my-minio-bucket',
    false, // 是否使用 SSL
    9000, // 端口
  );

  // 6. 自定义 S3 兼容服务
  const customS3 = new S3Helper({
    provider: S3Provider.CUSTOM,
    endPoint: 'your-custom-s3-endpoint.com',
    port: 443,
    useSSL: true,
    accessKey: 'your-access-key',
    secretKey: 'your-secret-key',
    region: 'custom-region',
    bucket: 'my-custom-bucket',
  });

  // 基本操作示例
  try {
    // 检查并创建 bucket
    if (!(await awsS3.bucketExists())) {
      await awsS3.createBucket();
      console.log('Bucket 创建成功');
    }

    // 上传文件
    await awsS3.uploadFile('test.txt', '/path/to/local/file.txt', undefined, {
      contentType: 'text/plain',
      metadata: { 'custom-key': 'custom-value' },
    });
    console.log('文件上传成功');

    // 上传 Buffer
    const buffer = Buffer.from('Hello, S3!', 'utf-8');
    await awsS3.uploadBuffer('hello.txt', buffer, undefined, {
      contentType: 'text/plain',
    });

    // 检查文件是否存在
    const exists = await awsS3.fileExists('test.txt');
    console.log('文件存在:', exists);

    // 获取文件信息
    const fileInfo = await awsS3.getFileInfo('test.txt');
    console.log('文件信息:', fileInfo);

    // 列出文件
    const files = await awsS3.listFiles('test', undefined, true);
    console.log(
      '文件列表:',
      files.map((f) => f.name),
    );

    // 下载文件到 Buffer
    const downloadedBuffer = await awsS3.downloadBuffer('hello.txt');
    console.log('下载内容:', downloadedBuffer.toString());

    // 获取预签名下载 URL
    const downloadUrl = await awsS3.getPresignedDownloadUrl('test.txt', 3600); // 1小时有效期
    console.log('下载 URL:', downloadUrl);

    // 获取预签名上传 URL
    const uploadUrl = await awsS3.getPresignedUploadUrl('new-file.txt', 3600);
    console.log('上传 URL:', uploadUrl);

    // 复制文件
    await awsS3.copyFile('test.txt', 'test-copy.txt');
    console.log('文件复制成功');

    // 移动文件
    await awsS3.moveFile('test-copy.txt', 'moved-file.txt');
    console.log('文件移动成功');

    // 批量删除文件
    const deleteResult = await awsS3.deleteFiles([
      'moved-file.txt',
      'hello.txt',
    ]);
    console.log('删除结果:', deleteResult);

    // 获取存储信息
    const storageInfo = await awsS3.getStorageInfo();
    console.log('存储信息:', storageInfo);

    // 列出所有 buckets
    const buckets = await awsS3.listBuckets();
    console.log('所有 buckets:', buckets);
  } catch (error) {
    console.error('操作失败:', error);
  }
}

// 跨服务迁移示例
async function migrationExample() {
  // 从 AWS S3 迁移到 Cloudflare R2
  const sourceS3 = S3Helper.createAWS(
    'aws-key',
    'aws-secret',
    'source-bucket',
    'us-east-1',
  );
  const targetR2 = S3Helper.createCloudflareR2(
    'r2-key',
    'r2-secret',
    'account-id',
    'target-bucket',
  );

  try {
    // 列出源文件
    const sourceFiles = await sourceS3.listFiles('', undefined, true);
    console.log(`发现 ${sourceFiles.length} 个文件需要迁移`);

    // 逐个迁移文件
    for (const file of sourceFiles) {
      if (file.name) {
        // 从源下载
        const buffer = await sourceS3.downloadBuffer(file.name);

        // 上传到目标
        await targetR2.uploadBuffer(file.name, buffer, undefined, {
          contentType: file.name.endsWith('.jpg') ? 'image/jpeg' : undefined,
        });

        console.log(`迁移完成: ${file.name}`);
      }
    }

    console.log('迁移完成！');
  } catch (error) {
    console.error('迁移失败:', error);
  }
}

// 多存储同步示例
async function multiStorageSync() {
  const primary = S3Helper.createAWS(
    'aws-key',
    'aws-secret',
    'primary-bucket',
    'us-east-1',
  );
  const backup1 = S3Helper.createBackblazeB2(
    'b2-key-id',
    'b2-key',
    'b2-endpoint',
    'backup-bucket',
  );
  const backup2 = S3Helper.createMinIO(
    'minio-key',
    'minio-secret',
    'minio.local',
    'backup-bucket',
    false,
    9000,
  );

  const storages = [primary, backup1, backup2];
  const fileName = 'important-file.txt';
  const content = Buffer.from('重要数据', 'utf-8');

  try {
    // 同时上传到所有存储
    const uploadPromises = storages.map((storage) =>
      storage.uploadBuffer(fileName, content, undefined, {
        contentType: 'text/plain',
        metadata: { 'sync-timestamp': new Date().toISOString() },
      }),
    );

    await Promise.all(uploadPromises);
    console.log('文件已同步到所有存储');

    // 验证所有存储都有该文件
    const existsChecks = await Promise.all(
      storages.map((storage) => storage.fileExists(fileName)),
    );

    console.log('文件存在性检查:', existsChecks); // 应该都是 true
  } catch (error) {
    console.error('同步失败:', error);
  }
}

export { examples, migrationExample, multiStorageSync };
