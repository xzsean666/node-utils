import { S3Helper, S3Provider } from '../s3Helper';

// AWS SDK v3 版本的 S3Helper 使用示例

async function awsSDKExamples() {
  console.log('=== AWS SDK v3 版本的 S3Helper 示例 ===\n');

  // 1. AWS S3 - 官方服务
  console.log('1. 连接到 AWS S3');
  const awsS3 = S3Helper.createAWS(
    process.env.AWS_ACCESS_KEY_ID || 'your-access-key',
    process.env.AWS_SECRET_ACCESS_KEY || 'your-secret-key',
    'my-test-bucket',
    'us-west-2',
  );

  // 2. Cloudflare R2 - 零出站费用
  console.log('2. 连接到 Cloudflare R2');
  const cloudflareR2 = S3Helper.createCloudflareR2(
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || 'your-access-key',
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || 'your-secret-key',
    process.env.CLOUDFLARE_ACCOUNT_ID || 'your-account-id',
    'my-r2-bucket',
  );

  // 3. Backblaze B2 - 经济实惠
  console.log('3. 连接到 Backblaze B2');
  const backblazeB2 = S3Helper.createBackblazeB2(
    process.env.B2_APPLICATION_KEY_ID || 'your-key-id',
    process.env.B2_APPLICATION_KEY || 'your-key',
    process.env.B2_ENDPOINT || 's3.us-west-002.backblazeb2.com',
    'my-b2-bucket',
  );

  // 4. MinIO - 自托管
  console.log('4. 连接到 MinIO');
  const minioS3 = S3Helper.createMinIO(
    process.env.MINIO_ACCESS_KEY || 'minioadmin',
    process.env.MINIO_SECRET_KEY || 'minioadmin',
    process.env.MINIO_ENDPOINT || 'localhost',
    'my-minio-bucket',
    false, // 本地开发通常不用 SSL
    9000,
  );

  try {
    // 使用 AWS S3 进行演示
    console.log('\n=== 基本操作演示 ===');

    // 检查 bucket 是否存在
    console.log('检查 bucket 是否存在...');
    const bucketExists = await awsS3.bucketExists();
    console.log(`Bucket 存在: ${bucketExists}`);

    if (!bucketExists) {
      console.log('创建 bucket...');
      await awsS3.createBucket();
      console.log('Bucket 创建成功');
    }

    // 上传一些测试数据
    console.log('\n=== 文件上传演示 ===');

    // 上传文本内容
    const textContent = `Hello from AWS SDK v3!
时间戳: ${new Date().toISOString()}
Provider: AWS S3
SDK: @aws-sdk/client-s3`;

    await awsS3.uploadBuffer(
      'test-file.txt',
      Buffer.from(textContent, 'utf-8'),
      undefined,
      {
        contentType: 'text/plain; charset=utf-8',
        metadata: {
          'uploaded-by': 'S3Helper',
          'sdk-version': 'aws-sdk-v3',
          example: 'true',
        },
      },
    );
    console.log('✅ 文本文件上传成功');

    // 上传 JSON 数据
    const jsonData = {
      message: 'Hello from S3Helper with AWS SDK v3',
      timestamp: new Date().toISOString(),
      features: [
        'Multi-provider support',
        'TypeScript support',
        'Batch operations',
        'Presigned URLs',
      ],
    };

    await awsS3.uploadBuffer(
      'data.json',
      Buffer.from(JSON.stringify(jsonData, null, 2), 'utf-8'),
      undefined,
      {
        contentType: 'application/json',
        metadata: {
          'data-type': 'json',
          encoding: 'utf-8',
        },
      },
    );
    console.log('✅ JSON 文件上传成功');

    // 文件信息获取
    console.log('\n=== 文件信息获取 ===');
    const fileInfo = await awsS3.getFileInfo('test-file.txt');
    console.log('📄 文件信息:', {
      name: fileInfo.name,
      size: `${fileInfo.size} bytes`,
      lastModified: fileInfo.lastModified?.toISOString(),
      contentType: fileInfo.contentType,
      metadata: fileInfo.metadata,
    });

    // 列出文件
    console.log('\n=== 文件列表 ===');
    const files = await awsS3.listFiles();
    console.log('📂 文件列表:');
    files.forEach((file) => {
      if (file.name) {
        console.log(`  - ${file.name} (${file.size} bytes)`);
      }
    });

    // 下载文件
    console.log('\n=== 文件下载 ===');
    const downloadedContent = await awsS3.downloadBuffer('test-file.txt');
    console.log('📥 下载的内容:');
    console.log(downloadedContent.toString('utf-8'));

    // 生成预签名 URL
    console.log('\n=== 预签名 URL ===');
    const downloadUrl = await awsS3.getPresignedDownloadUrl(
      'test-file.txt',
      3600,
    );
    console.log('🔗 下载 URL (1小时有效):', downloadUrl);

    const uploadUrl = await awsS3.getPresignedUploadUrl('new-upload.txt', 3600);
    console.log('🔗 上传 URL (1小时有效):', uploadUrl);

    // 文件复制
    console.log('\n=== 文件操作 ===');
    await awsS3.copyFile('test-file.txt', 'test-file-copy.txt');
    console.log('✅ 文件复制成功');

    // 存储信息
    console.log('\n=== 存储信息 ===');
    const storageInfo = await awsS3.getStorageInfo();
    console.log('📊 存储统计:', {
      objectCount: storageInfo.objectCount,
      totalSize: `${(storageInfo.totalSize / 1024).toFixed(2)} KB`,
    });

    // 清理演示文件
    console.log('\n=== 清理演示文件 ===');
    const deleteResult = await awsS3.deleteFiles([
      'test-file.txt',
      'test-file-copy.txt',
      'data.json',
    ]);
    console.log('🗑️ 删除结果:', {
      successful: deleteResult.successful.length,
      failed: deleteResult.failed.length,
    });

    console.log('\n✅ 所有演示完成！');
  } catch (error) {
    console.error('❌ 演示过程中出现错误:', error);
  }
}

// 跨服务性能比较示例
async function performanceComparison() {
  console.log('\n=== 跨服务性能比较 ===');

  const testData = Buffer.from(
    'Performance test data ' + 'x'.repeat(1000),
    'utf-8',
  );
  const testFileName = `perf-test-${Date.now()}.txt`;

  const services = [
    {
      name: 'AWS S3',
      helper: S3Helper.createAWS(
        process.env.AWS_ACCESS_KEY_ID || 'test-key',
        process.env.AWS_SECRET_ACCESS_KEY || 'test-secret',
        'test-bucket',
        'us-west-2',
      ),
    },
    {
      name: 'Cloudflare R2',
      helper: S3Helper.createCloudflareR2(
        process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || 'test-key',
        process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || 'test-secret',
        process.env.CLOUDFLARE_ACCOUNT_ID || 'test-account',
        'test-bucket',
      ),
    },
  ];

  for (const service of services) {
    try {
      console.log(`\n测试 ${service.name}:`);

      // 上传测试
      const uploadStart = Date.now();
      await service.helper.uploadBuffer(testFileName, testData);
      const uploadTime = Date.now() - uploadStart;
      console.log(`  上传耗时: ${uploadTime}ms`);

      // 下载测试
      const downloadStart = Date.now();
      await service.helper.downloadBuffer(testFileName);
      const downloadTime = Date.now() - downloadStart;
      console.log(`  下载耗时: ${downloadTime}ms`);

      // 清理
      await service.helper.deleteFile(testFileName);
      console.log(`  ✅ ${service.name} 测试完成`);
    } catch (error) {
      console.log(`  ❌ ${service.name} 测试失败:`, error);
    }
  }
}

// 高级特性演示
async function advancedFeatures() {
  console.log('\n=== 高级特性演示 ===');

  const s3 = S3Helper.createAWS(
    process.env.AWS_ACCESS_KEY_ID || 'your-key',
    process.env.AWS_SECRET_ACCESS_KEY || 'your-secret',
    'advanced-test-bucket',
    'us-west-2',
  );

  try {
    // 流式上传演示
    console.log('\n1. 流式上传演示');
    const { Readable } = require('stream');

    const dataStream = new Readable({
      read() {
        this.push(Buffer.from(`Data chunk ${Date.now()}\n`));
        // 模拟结束
        setTimeout(() => this.push(null), 100);
      },
    });

    await s3.uploadStream('stream-test.txt', dataStream);
    console.log('✅ 流式上传成功');

    // 大文件分片上传（AWS SDK v3 自动处理）
    console.log('\n2. 大文件上传（自动分片）');
    const largeData = Buffer.alloc(10 * 1024 * 1024, 'A'); // 10MB
    await s3.uploadBuffer('large-file.bin', largeData, undefined, {
      contentType: 'application/octet-stream',
      metadata: {
        'file-type': 'large-binary',
        size: largeData.length.toString(),
      },
    });
    console.log('✅ 大文件上传成功');

    // 获取底层客户端进行高级操作
    console.log('\n3. 底层客户端访问');
    const rawClient = s3.getClient();
    console.log('✅ 获取到底层 S3Client，可以进行高级操作');

    // 配置信息
    console.log('\n4. 配置信息');
    const config = s3.getConfig();
    console.log('📋 当前配置:', {
      provider: config.provider,
      endPoint: config.endPoint,
      region: config.region,
      useSSL: config.useSSL,
    });

    // 清理
    await s3.deleteFiles(['stream-test.txt', 'large-file.bin']);
    console.log('\n🗑️ 演示文件已清理');
  } catch (error) {
    console.error('❌ 高级特性演示失败:', error);
  }
}

// 主函数
async function main() {
  try {
    await awsSDKExamples();
    // await performanceComparison();
    // await advancedFeatures();
  } catch (error) {
    console.error('示例运行失败:', error);
  }
}

// 导出函数供其他模块使用
export { awsSDKExamples, performanceComparison, advancedFeatures, main };

// 如果直接运行此文件
if (require.main === module) {
  main();
}
