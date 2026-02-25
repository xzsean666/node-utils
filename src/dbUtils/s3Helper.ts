// 向后兼容入口 - 所有实现已迁移到 ./s3/ 目录
// 新代码请直接从 './s3' 或 './s3/s3Helper' 导入
//
// 文件拆分说明:
//   ./s3/s3Types.ts          - 类型定义、枚举、常量（无依赖）
//   ./s3/s3Helper.ts         - 核心 S3 操作（上传/下载/删除/列表/bucket 管理/防重复上传）
//   ./s3/s3UrlGenerator.ts   - 签名 URL 生成（下载 + 上传 URL，支持一次性/可重复使用）
//   ./s3/index.ts            - 统一导出入口

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
  // Classes
  S3Helper,
  S3UrlGenerator,
} from './s3';
