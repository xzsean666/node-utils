// S3 工具包 - 统一导出入口
//
// 使用示例:
//
//   import { S3Helper, S3Provider, S3Sync, S3FolderUploader, S3UrlGenerator } from './s3';
//
//   // 创建核心 helper
//   const helper = S3Helper.createCloudflareR2(accessKey, secretKey, accountId, bucket);
//
//   // 文件夹同步
//   const sync = new S3Sync(helper);
//   await sync.syncFolder('/local', { s3Prefix: 'remote' });
//
//   // 图片批量上传
//   const uploader = new S3FolderUploader(helper);
//   await uploader.uploadImages('/local/images', { s3Prefix: 'img' });
//
//   // 签名 URL 生成
//   const urlGen = new S3UrlGenerator(helper);
//   await urlGen.generateToJson('./urls.json', { simplify: true });

// 类型定义（无依赖）
export {
    // Enums
    S3Provider,
    SyncMode,
    SyncOperation,
    // Interfaces
    type IKVDatabase,
    type S3Config,
    type UploadOptions,
    type UploadResult,
    type FileInfo,
    type S3Object,
    type BatchResult,
    type GenerateUrlOptions,
    type SignedUrlResult,
    type SignedUrlSummary,
    type FolderUploadOptions,
    type FolderUploadResult,
    type FolderUploadResultAdvanced,
    type FileFilter,
    type SyncOptions,
    type SyncResultItem,
    type SyncResult,
    type LocalFileInfo,
    type S3FileInfo,
    // Constants
    PROVIDER_CONFIGS,
    MIME_TYPE_MAP,
    IMAGE_EXTENSIONS,
    MAX_DELETE_OBJECTS_PER_REQUEST,
} from './s3Types';

// 核心 Helper
export { S3Helper } from './s3Helper';

// 组合模块（互不依赖，各自仅依赖 S3Helper）
export { S3Sync } from './s3Sync';
export { S3FolderUploader } from './s3FolderUploader';
export { S3UrlGenerator } from './s3UrlGenerator';
