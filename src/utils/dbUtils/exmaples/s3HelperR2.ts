import { S3Helper, S3Provider } from '../s3Helper';
import dotenv from 'dotenv';
import { SqliteKVDatabase } from '../KVSqlite';

dotenv.config();

// AWS SDK v3 版本的 S3Helper 使用示例
const kvdb = new SqliteKVDatabase('./db/r2test.db');

async function awsSDKExamples() {
  // 2. Cloudflare R2 - 零出站费用
  console.log('2. 连接到 Cloudflare R2');
  const awsS3 = S3Helper.createCloudflareR2(
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || 'your-access-key',
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || 'your-secret-key',
    process.env.CLOUDFLARE_ACCOUNT_ID || 'your-account-id',
    'pgbackup',
    kvdb,
  );

  try {
    // 使用 AWS S3 进行演示
    // 上传 JSON 数据
    const jsonData = {
      message: 'Hello from S3Helper with AWS SDK v3 7779',
      features: [
        'Multi-provider support',
        'TypeScript support',
        'Batch operations',
        'Presigned URLs',
      ],
    };
    const res = await awsS3.uploadBufferGzip(
      'data12.json',
      Buffer.from(JSON.stringify(jsonData, null, 2), 'utf-8'),
    );
    console.log(res);
    // const res = await awsS3.getObjectETag('data1.json');
    // console.log(res);
    // const res2 = await awsS3.getPresignedDownloadUrl('data1.json');
    // console.log(res2);
  } catch (error) {
    console.error('❌ 演示过程中出现错误:', error);
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
export { awsSDKExamples, main };

// 如果直接运行此文件
if (require.main === module) {
  main();
}
