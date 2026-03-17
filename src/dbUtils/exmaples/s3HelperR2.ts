import { S3Helper, S3UrlGenerator } from '../s3Helper';
import dotenv from 'dotenv';

dotenv.config();

// Cloudflare R2 使用示例
async function awsSDKExamples() {
  console.log('连接到 Cloudflare R2');
  const r2 = S3Helper.createCloudflareR2(
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || 'your-access-key',
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || 'your-secret-key',
    process.env.CLOUDFLARE_ACCOUNT_ID || 'your-account-id',
    'arts400',
  );

  try {
    // 使用 S3UrlGenerator 生成签名 URL 到 JSON
    const urlGen = new S3UrlGenerator(r2);
    const res = await urlGen.generateToJson(
      'src/utils/dbUtils/exmaples/arts_converted.json',
    );
    console.log(res);
  } catch (error) {
    console.error('❌ 演示过程中出现错误:', error);
  }
}

// 主函数
async function main() {
  try {
    await awsSDKExamples();
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
