import { S3Helper, S3Provider } from '../src/utils/dbUtils/s3Helper';
import * as path from 'path';

// 示例：如何使用S3Helper的新功能

async function example() {
  // 创建S3Helper实例
  const s3Helper = new S3Helper({
    provider: S3Provider.AWS_S3,
    endPoint: 's3.amazonaws.com',
    accessKey: 'your-access-key',
    secretKey: 'your-secret-key',
    region: 'us-east-1',
    bucket: 'your-bucket-name',
  });

  try {
    // 1. 上传整个文件夹的图片
    console.log('=== 上传文件夹图片示例 ===');
    const uploadResult = await s3Helper.uploadFolderImages(
      './local-images-folder', // 本地图片文件夹路径
      'uploaded-images', // S3中的前缀（可选）
      undefined, // 使用默认bucket
      {
        acl: 'public-read', // 设置为公开读取
        metadata: {
          'uploaded-by': 's3helper-batch-upload',
          'upload-date': new Date().toISOString(),
        },
      },
    );

    console.log('Upload Results:');
    console.log(`- Total files found: ${uploadResult.totalFiles}`);
    console.log(`- Successful uploads: ${uploadResult.successful.length}`);
    console.log(`- Actually uploaded: ${uploadResult.uploadedCount}`);
    console.log(`- From cache: ${uploadResult.cachedCount}`);
    console.log(`- Failed uploads: ${uploadResult.failed.length}`);

    if (uploadResult.failed.length > 0) {
      console.log('Failed uploads:');
      uploadResult.failed.forEach((fail) => {
        console.log(`  - ${fail.localPath}: ${fail.error}`);
      });
    }

    // 2. 生成所有文件的signed URL并写入JSON
    console.log('\n=== 生成Signed URLs示例 ===');
    const urlResult = await s3Helper.generateSignedUrlsToJson(
      './signed-urls.json', // 输出JSON文件路径
      undefined, // 使用默认bucket
      'uploaded-images', // 只为这个前缀下的文件生成URL
      24 * 60 * 60, // 24小时有效期
      {
        downloadUrls: true, // 生成下载URL
        uploadUrls: false, // 不生成上传URL
        includeMetadata: true, // 包含文件元数据
      },
    );

    console.log('URL Generation Results:');
    console.log(`- Total files processed: ${urlResult.totalFiles}`);
    console.log(`- Successful URL generations: ${urlResult.successfulUrls}`);
    console.log(`- Failed URL generations: ${urlResult.failedUrls}`);
    console.log(`- Output file: ${urlResult.outputPath}`);

    // 3. 为特定文件列表生成signed URL
    console.log('\n=== 为特定文件生成Signed URLs示例 ===');
    const specificFiles = [
      'uploaded-images/photo1.jpg',
      'uploaded-images/photo2.png',
      'uploaded-images/subfolder/photo3.gif',
    ];

    const specificUrlResult = await s3Helper.generateSignedUrlsForFiles(
      specificFiles,
      './specific-files-urls.json',
      undefined,
      7 * 24 * 60 * 60, // 7天有效期
      {
        downloadUrls: true,
        uploadUrls: true, // 也生成上传URL（用于替换文件）
        includeMetadata: true,
      },
    );

    console.log('Specific Files URL Generation Results:');
    console.log(`- Total files processed: ${specificUrlResult.totalFiles}`);
    console.log(
      `- Successful URL generations: ${specificUrlResult.successfulUrls}`,
    );
    console.log(`- Failed URL generations: ${specificUrlResult.failedUrls}`);
  } catch (error) {
    console.error('Error:', error);
  }
}

// 高级使用示例
async function advancedExample() {
  const s3Helper = S3Helper.createAWS(
    'your-access-key',
    'your-secret-key',
    'your-bucket-name',
    'us-west-2',
  );

  try {
    // 使用高级批量上传方法，获得详细的重复检查信息
    const result = await s3Helper.uploadFolderImagesAdvanced(
      './photos',
      'gallery/2024',
      'my-gallery-bucket',
      {
        contentType: undefined, // 自动检测
        metadata: {
          project: 'photo-gallery',
          year: '2024',
          uploader: 'automated-script',
        },
        acl: 'public-read',
        forceUpload: false, // 使用防重复上传功能
      },
    );

    console.log('Advanced Upload Results:');
    console.log(`- Total files: ${result.totalFiles}`);
    console.log(`- Uploaded: ${result.uploadedCount}`);
    console.log(`- From cache: ${result.cachedCount}`);
    console.log(`- Failed: ${result.failed.length}`);

    // 显示从缓存中获取的文件
    const cachedFiles = result.successful.filter(
      (f) => !f.uploadResult.wasUploaded,
    );
    if (cachedFiles.length > 0) {
      console.log('\nFiles retrieved from cache:');
      cachedFiles.forEach((f) => {
        console.log(`  - ${f.localPath} -> ${f.uploadResult.objectName}`);
      });
    }

    // 生成签名URL，包含上传和下载URL
    const urlResult = await s3Helper.generateSignedUrlsToJson(
      './gallery-urls.json',
      'my-gallery-bucket',
      'gallery/2024',
      7 * 24 * 60 * 60, // 7天有效期
      {
        downloadUrls: true,
        uploadUrls: true,
        includeMetadata: true,
      },
    );

    console.log('Advanced URL Generation Results:', urlResult);
  } catch (error) {
    console.error('Advanced Example Error:', error);
  }
}

// 运行示例
if (require.main === module) {
  example()
    .then(() => console.log('\n基础示例完成'))
    .then(() => advancedExample())
    .then(() => console.log('\n高级示例完成'))
    .catch(console.error);
}

export { example, advancedExample };
