// 向后兼容入口 - 所有实现已迁移到 ./s3/ 目录
// 新代码请直接从 './s3' 或 './s3/s3Helper' 导入
//
// 文件拆分说明:
//   ./s3/s3Types.ts          - 类型定义、枚举、常量（无依赖）
//   ./s3/s3Helper.ts         - 核心 S3 操作（上传/下载/删除/列表/bucket 管理）
//   ./s3/s3Sync.ts           - 文件夹同步（组合 S3Helper）
//   ./s3/s3FolderUploader.ts - 图片批量上传（组合 S3Helper）
//   ./s3/s3UrlGenerator.ts   - 签名 URL 生成（组合 S3Helper）
//   ./s3/index.ts            - 统一导出入口

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
  // Classes
  S3Helper,
  S3Sync,
  S3FolderUploader,
  S3UrlGenerator,
} from './s3';
