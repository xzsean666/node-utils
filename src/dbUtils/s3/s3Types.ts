// S3 类型定义、枚举、接口和共享常量
// 此模块无任何外部依赖，所有其他 s3 模块都依赖这个文件

// ============================================================
// Enums
// ============================================================

/** S3 服务提供商预设配置 */
export enum S3Provider {
    AWS_S3 = 'aws_s3',
    BACKBLAZE_B2 = 'backblaze_b2',
    CLOUDFLARE_R2 = 'cloudflare_r2',
    MINIO = 'minio',
    CUSTOM = 'custom',
}

/** 同步模式枚举 */
export enum SyncMode {
    LOCAL_TO_S3 = 'localToS3',
    S3_TO_LOCAL = 's3ToLocal',
    BIDIRECTIONAL = 'bidirectional',
}

/** 同步操作类型 */
export enum SyncOperation {
    UPLOAD = 'upload',
    DOWNLOAD = 'download',
    DELETE_LOCAL = 'deleteLocal',
    DELETE_S3 = 'deleteS3',
    SKIP = 'skip',
    UPDATE = 'update',
}

// ============================================================
// Core Interfaces
// ============================================================

/** KV 数据库接口 */
export interface IKVDatabase<T = any> {
    get(key: string, ttl?: number): Promise<T | null>;
    put(key: string, value: T): Promise<void>;
}

/** S3 配置接口 */
export interface S3Config {
    provider: S3Provider;
    endPoint: string;
    port?: number;
    useSSL?: boolean;
    accessKey: string;
    secretKey: string;
    region?: string;
    bucket?: string;
}

// ============================================================
// Upload / Download Interfaces
// ============================================================

/** 文件上传选项 */
export interface UploadOptions {
    contentType?: string;
    metadata?: Record<string, string>;
    acl?: 'private' | 'public-read' | 'public-read-write';
    forceUpload?: boolean;
}

/** 防重复上传的结果 */
export interface UploadResult {
    etag: string;
    objectName: string;
    wasUploaded: boolean;
}

/** 文件信息接口 */
export interface FileInfo {
    name: string;
    size?: number;
    lastModified?: Date;
    etag: string;
    contentType?: string;
    metadata?: Record<string, string>;
}

/** S3 对象信息接口 */
export interface S3Object {
    name?: string;
    prefix?: string;
    size?: number;
    etag?: string;
    lastModified?: Date;
    storageClass?: string;
}

/** 批量操作结果 */
export interface BatchResult<T> {
    successful: T[];
    failed: Array<{ item: T; error: string }>;
}

// ============================================================
// URL Generation Interfaces
// ============================================================

/** 签名URL生成选项 */
export interface GenerateUrlOptions {
    bucket?: string;
    prefix?: string;
    expiry?: number;
    downloadUrls?: boolean;
    uploadUrls?: boolean;
    includeMetadata?: boolean;
    simplify?: boolean;
}

/** 签名 URL 结果项 */
export interface SignedUrlResult {
    objectName: string;
    downloadUrl?: string;
    uploadUrl?: string;
    metadata?: {
        size?: number;
        lastModified?: Date;
        etag?: string;
        contentType?: string;
    };
    error?: string;
}

/** URL 生成汇总 */
export interface SignedUrlSummary {
    totalFiles: number;
    successfulUrls: number;
    failedUrls: number;
    outputPath?: string;
}

// ============================================================
// Folder Upload Interfaces
// ============================================================

/** 文件夹上传选项 */
export interface FolderUploadOptions extends UploadOptions {
    s3Prefix?: string;
    bucket?: string;
    depth?: number;
    advanced?: boolean;
}

/** 文件夹上传结果（基础版） */
export interface FolderUploadResult {
    successful: Array<{
        localPath: string;
        s3Key: string;
        fileInfo: FileInfo;
        wasUploaded: boolean;
    }>;
    failed: Array<{ localPath: string; error: string }>;
    totalFiles: number;
    uploadedCount: number;
    cachedCount: number;
}

/** 文件夹上传结果（高级版） */
export interface FolderUploadResultAdvanced {
    successful: Array<{
        localPath: string;
        s3Key: string;
        uploadResult: UploadResult;
    }>;
    failed: Array<{ localPath: string; error: string }>;
    totalFiles: number;
    uploadedCount: number;
    cachedCount: number;
}

// ============================================================
// Sync Interfaces
// ============================================================

/** 文件过滤器接口 */
export interface FileFilter {
    extensions?: string[];
    excludeExtensions?: string[];
    includePatterns?: RegExp[];
    excludePatterns?: RegExp[];
    minSize?: number;
    maxSize?: number;
}

/** 同步选项接口 */
export interface SyncOptions extends UploadOptions {
    syncMode?: SyncMode;
    s3Prefix?: string;
    bucket?: string;
    depth?: number;
    deleteExtraFiles?: boolean;
    overwriteExisting?: boolean;
    fileFilter?: FileFilter;
    dryRun?: boolean;
    compareBy?: 'etag' | 'size' | 'lastModified' | 'both';
}

/** 同步结果项 */
export interface SyncResultItem {
    operation: SyncOperation;
    localPath?: string;
    s3Key?: string;
    size?: number;
    error?: string;
    skipped?: boolean;
}

/** 同步结果 */
export interface SyncResult {
    summary: {
        totalFiles: number;
        uploaded: number;
        downloaded: number;
        deleted: number;
        skipped: number;
        failed: number;
        dryRun: boolean;
    };
    operations: SyncResultItem[];
    errors: Array<{ path: string; error: string }>;
}

// ============================================================
// Local File Info (used by sync & folder upload)
// ============================================================

export interface LocalFileInfo {
    localPath: string;
    relativePath: string;
    size: number;
    lastModified: Date;
}

export interface S3FileInfo {
    s3Key: string;
    relativePath: string;
    size: number;
    lastModified: Date;
    etag: string;
}

// ============================================================
// Shared Constants
// ============================================================

/** 预设的 S3 服务提供商配置 */
export const PROVIDER_CONFIGS: Record<S3Provider, Partial<S3Config>> = {
    [S3Provider.AWS_S3]: {
        endPoint: 's3.amazonaws.com',
        port: 443,
        useSSL: true,
        region: 'us-east-1',
    },
    [S3Provider.BACKBLAZE_B2]: {
        endPoint: 's3.us-west-002.backblazeb2.com',
        port: 443,
        useSSL: true,
    },
    [S3Provider.CLOUDFLARE_R2]: {
        endPoint: 'r2.cloudflarestorage.com',
        port: 443,
        useSSL: true,
    },
    [S3Provider.MINIO]: {
        endPoint: 'localhost',
        port: 9000,
        useSSL: false,
    },
    [S3Provider.CUSTOM]: {},
};

/** MIME 类型映射表 */
export const MIME_TYPE_MAP: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.tiff': 'image/tiff',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.xml': 'application/xml',
    '.zip': 'application/zip',
    '.gz': 'application/gzip',
    '.tar': 'application/x-tar',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
};

/** 支持的图片扩展名 */
export const IMAGE_EXTENSIONS = [
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.bmp',
    '.webp',
    '.svg',
    '.tiff',
    '.ico',
];

/** S3 DeleteObjects API 单次最大删除数 */
export const MAX_DELETE_OBJECTS_PER_REQUEST = 1000;
