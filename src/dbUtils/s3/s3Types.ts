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

// ============================================================
// Core Interfaces
// ============================================================

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
    /** 设为 true 跳过防重复检查，强制上传 */
    forceUpload?: boolean;
}

/** 上传结果（含防重复检测信息） */
export interface UploadResult {
    etag: string;
    objectName: string;
    /** true=实际上传了, false=命中缓存跳过 */
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

/** 签名URL生成选项（下载/查看） */
export interface GenerateUrlOptions {
    bucket?: string;
    prefix?: string;
    /** URL 有效期（秒），默认 86400（24 小时） */
    expiry?: number;
    downloadUrls?: boolean;
    uploadUrls?: boolean;
    includeMetadata?: boolean;
    simplify?: boolean;
}

/** 预签名上传 URL 选项 */
export interface PresignedUploadUrlOptions {
    bucket?: string;
    /** URL 有效期（秒），默认 3600（1小时） */
    expiry?: number;
    /** 限制上传的 Content-Type */
    contentType?: string;
    /** 上传文件的最大大小（字节），仅部分 provider 支持 */
    maxSize?: number;
    /** 自定义元数据 */
    metadata?: Record<string, string>;
}

/** 预签名上传 URL 结果 */
export interface PresignedUploadUrlResult {
    /** 上传使用的 presigned URL */
    uploadUrl: string;
    /** S3 中的 object key */
    objectName: string;
    /** URL 过期时间 */
    expiresAt: Date;
    /** URL 有效期（秒） */
    expirySeconds: number;
    /** 是否为一次性 URL（使用了唯一 key） */
    oneTime: boolean;
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

/** S3 DeleteObjects API 单次最大删除数 */
export const MAX_DELETE_OBJECTS_PER_REQUEST = 1000;

// ============================================================
// ContentType 常量（代替手写 MIME 字符串）
// 用法: contentType: ContentType.GZIP  →  'application/gzip'
// IDE 会提供完整自动补全，不用担心拼写错误
// ============================================================

/** 常用 MIME 类型常量，配合 contentType 字段使用 */
export const ContentType = {
    // 图片
    JPEG: 'image/jpeg',
    PNG: 'image/png',
    GIF: 'image/gif',
    WEBP: 'image/webp',
    SVG: 'image/svg+xml',
    BMP: 'image/bmp',
    TIFF: 'image/tiff',
    ICO: 'image/x-icon',

    // 文档
    PDF: 'application/pdf',
    TEXT: 'text/plain',
    HTML: 'text/html',
    CSS: 'text/css',
    CSV: 'text/csv',

    // 数据 / 脚本
    JSON: 'application/json',
    XML: 'application/xml',
    JS: 'application/javascript',
    WASM: 'application/wasm',

    // 压缩 / 归档
    GZIP: 'application/gzip',
    ZIP: 'application/zip',
    TAR: 'application/x-tar',
    BROTLI: 'application/x-brotli',
    SEVEN_ZIP: 'application/x-7z-compressed',

    // 音视频
    MP4: 'video/mp4',
    WEBM: 'video/webm',
    MP3: 'audio/mpeg',
    WAV: 'audio/wav',
    OGG: 'audio/ogg',
    AAC: 'audio/aac',

    // 字体
    WOFF: 'font/woff',
    WOFF2: 'font/woff2',
    TTF: 'font/ttf',

    // 二进制流（通用）
    BINARY: 'application/octet-stream',

    // 表单
    FORM: 'application/x-www-form-urlencoded',
    MULTIPART: 'multipart/form-data',
} as const;

/** ContentType 值类型，可用于函数参数约束 */
export type ContentTypeValue = (typeof ContentType)[keyof typeof ContentType];

