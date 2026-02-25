// S3 工具包 - 统一导出入口
//
// 使用示例:
//
//   import { S3Helper, S3Provider, S3UrlGenerator } from './s3';
//
//   // 创建核心 helper
//   const helper = S3Helper.createCloudflareR2(accessKey, secretKey, accountId, bucket);
//
//   // 上传文件（自动防重复）
//   const result = await helper.uploadFile('remote/key.txt', '/local/file.txt');
//
//   // 签名 URL 生成
//   const urlGen = new S3UrlGenerator(helper);
//
//   // 生成下载 URL
//   const downloadResult = await urlGen.generateForFile('remote/key.txt');
//
//   // 生成一次性上传 URL
//   const uploadResult = await urlGen.generateOneTimeUploadUrl('uploads', 'photo.jpg', {
//     expiry: 3600,
//     contentType: 'image/jpeg',
//   });
//
//   // 生成可重复使用的上传 URL
//   const reusableResult = await urlGen.generateReusableUploadUrl('avatars/user.png', {
//     expiry: 86400,
//   });

// 类型定义（无依赖）
export {
    // Enums
    S3Provider,
    // Interfaces
    type S3Config,
    type UploadOptions,
    type UploadResult,
    type FileInfo,
    type S3Object,
    type BatchResult,
    type GenerateUrlOptions,
    type SignedUrlResult,
    type SignedUrlSummary,
    type PresignedUploadUrlOptions,
    type PresignedUploadUrlResult,
    // Constants
    PROVIDER_CONFIGS,
    MIME_TYPE_MAP,
    MAX_DELETE_OBJECTS_PER_REQUEST,
    ContentType,
    type ContentTypeValue,
} from './s3Types';

// 核心 Helper
export { S3Helper } from './s3Helper';

// URL 生成器
export { S3UrlGenerator } from './s3UrlGenerator';
