// 需要安装: pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
//
// S3Helper 使用示例:
//
// 1. 基本上传文件夹图片:
//    await s3Helper.uploadFolderImages('/local/images', { s3Prefix: 'uploads/images' });
//
// 2. 限制搜索深度为2层:
//    await s3Helper.uploadFolderImages('/local/images', { s3Prefix: 'uploads/images', depth: 2 });
//
// 3. 只搜索当前目录（不递归）:
//    await s3Helper.uploadFolderImages('/local/images', { s3Prefix: 'uploads/images', depth: 0 });
//
// 4. 高级上传，包含详细的 UploadResult:
//    const result = await s3Helper.uploadFolderImages('/local/images', {
//      s3Prefix: 'uploads/images',
//      depth: 1,
//      advanced: true
//    });
//    console.log(`Uploaded: ${result.uploadedCount}, Cached: ${result.cachedCount}`);
//
// 5. 自定义 bucket 和上传选项:
//    await s3Helper.uploadFolderImages('/local/images', {
//      s3Prefix: 'uploads/images',
//      bucket: 'my-custom-bucket',
//      depth: 2,
//      forceUpload: false,
//      acl: 'public-read'
//    });
//
// 6. 生成简化的签名URL（只包含objectName和downloadUrl）:
//    await s3Helper.generateSignedUrlsToJson('./urls.json', {
//      simplify: true,
//      expiry: 7 * 24 * 60 * 60
//    });
//
// 7. 删除过期文件（删除30天前的文件）:
//    const result = await s3Helper.deleteExpire(30 * 24 * 60 * 60);
//    console.log(`删除了 ${result.deletedFiles} 个过期文件`);
//
// 8. 删除指定前缀下1小时前的文件:
//    await s3Helper.deleteExpire(3600, 'my-bucket', 'temp/');
//
// 9. 为单个文件生成签名URL（简化模式）:
//    const urlResult = await s3Helper.generateSignedUrlsForFile('image.jpg', {
//      simplify: true,
//      expiry: 7 * 24 * 60 * 60
//    });
//    console.log(`Download URL: ${urlResult.downloadUrl}`);
//
// 10. 为单个文件生成完整信息（包含上传URL和元数据）:
//    const fullResult = await s3Helper.generateSignedUrlsForFile('document.pdf', {
//      downloadUrls: true,
//      uploadUrls: true,
//      includeMetadata: true,
//      expiry: 3600
//    });
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  ListBucketsCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  type _Object,
  type CreateBucketCommandInput,
  type PutObjectCommandInput,
  type GetObjectCommandOutput,
  type BucketLocationConstraint,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { gzip, gunzip, createGzip, createGunzip } from 'zlib';
import { promisify } from 'util';
import * as fs from 'fs';
import * as crypto from 'crypto'; // Import the crypto module

// S3 服务提供商预设配置
export enum S3Provider {
  AWS_S3 = 'aws_s3',
  BACKBLAZE_B2 = 'backblaze_b2',
  CLOUDFLARE_R2 = 'cloudflare_r2',
  MINIO = 'minio',
  CUSTOM = 'custom',
}
export interface IKVDatabase<T = any> {
  get(key: string, ttl?: number): Promise<T | null>;
  put(key: string, value: T): Promise<void>;
}
// S3 配置接口
export interface S3Config {
  provider: S3Provider;
  endPoint: string;
  port?: number;
  useSSL?: boolean;
  accessKey: string;
  secretKey: string;
  region?: string;
  bucket?: string; // 默认 bucket
}

// 预设的 S3 服务提供商配置
const PROVIDER_CONFIGS: Record<S3Provider, Partial<S3Config>> = {
  [S3Provider.AWS_S3]: {
    endPoint: 's3.amazonaws.com',
    port: 443,
    useSSL: true,
    region: 'us-east-1',
  },
  [S3Provider.BACKBLAZE_B2]: {
    endPoint: 's3.us-west-002.backblazeb2.com', // 默认区域，用户可自定义
    port: 443,
    useSSL: true,
  },
  [S3Provider.CLOUDFLARE_R2]: {
    endPoint: 'r2.cloudflarestorage.com', // 需要用户提供完整的端点
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

// 文件上传选项
export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  acl?: 'private' | 'public-read' | 'public-read-write';
  forceUpload?: boolean; // 是否强制上传，忽略重复检查
}

// 防重复上传的结果
export interface UploadResult {
  etag: string;
  objectName: string;
  wasUploaded: boolean; // true表示实际上传了，false表示从缓存中获取
}

// 文件信息接口
export interface FileInfo {
  name: string;
  size?: number;
  lastModified?: Date;
  etag: string;
  contentType?: string;
  metadata?: Record<string, string>;
}

// 签名URL生成选项
export interface GenerateUrlOptions {
  bucket?: string;
  prefix?: string;
  expiry?: number; // 过期时间，单位秒
  downloadUrls?: boolean; // 是否生成下载URL（默认true）
  uploadUrls?: boolean; // 是否生成上传URL（默认false）
  includeMetadata?: boolean; // 是否包含文件元数据（默认true）
  simplify?: boolean; // 是否简化输出，只返回objectName和downloadUrl（默认false）
}

// S3 对象信息接口 (替代 minio 的 BucketItem)
export interface S3Object {
  name?: string;
  prefix?: string;
  size?: number;
  etag?: string;
  lastModified?: Date;
  storageClass?: string;
}

// 批量操作结果
export interface BatchResult<T> {
  successful: T[];
  failed: Array<{ item: T; error: string }>;
}

// 文件夹上传选项
export interface FolderUploadOptions extends UploadOptions {
  s3Prefix?: string; // S3前缀路径
  bucket?: string; // 目标bucket
  depth?: number; // 搜索深度，-1 表示无限深度，0 表示只搜索当前目录，1 表示搜索当前目录及一级子目录
  advanced?: boolean; // 是否返回详细的上传结果（包含 UploadResult）
}

// 文件夹上传结果（基础版）
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

// 文件夹上传结果（高级版）
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

// 同步模式枚举
export enum SyncMode {
  LOCAL_TO_S3 = 'localToS3',
  S3_TO_LOCAL = 's3ToLocal',
  BIDIRECTIONAL = 'bidirectional',
}

// 文件过滤器接口
export interface FileFilter {
  extensions?: string[]; // 支持的文件扩展名，如 ['.jpg', '.png', '.pdf']
  excludeExtensions?: string[]; // 排除的文件扩展名
  includePatterns?: RegExp[]; // 包含的文件名模式
  excludePatterns?: RegExp[]; // 排除的文件名模式
  minSize?: number; // 最小文件大小（字节）
  maxSize?: number; // 最大文件大小（字节）
}

// 同步选项接口
export interface SyncOptions extends UploadOptions {
  syncMode?: SyncMode; // 同步模式，默认 LOCAL_TO_S3
  s3Prefix?: string; // S3前缀路径
  bucket?: string; // 目标bucket
  depth?: number; // 搜索深度，-1 表示无限深度
  deleteExtraFiles?: boolean; // 是否删除目标中不存在于源中的文件，默认 false
  overwriteExisting?: boolean; // 是否覆写已存在的文件，默认 true
  fileFilter?: FileFilter; // 文件过滤器
  dryRun?: boolean; // 试运行模式，不执行实际操作，默认 false
  compareBy?: 'etag' | 'size' | 'lastModified' | 'both'; // 文件比较方式，默认 'etag'
}

// 同步操作类型
export enum SyncOperation {
  UPLOAD = 'upload',
  DOWNLOAD = 'download',
  DELETE_LOCAL = 'deleteLocal',
  DELETE_S3 = 'deleteS3',
  SKIP = 'skip',
  UPDATE = 'update',
}

// 同步结果项
export interface SyncResultItem {
  operation: SyncOperation;
  localPath?: string;
  s3Key?: string;
  size?: number;
  error?: string;
  skipped?: boolean;
}

// 同步结果
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

export class S3Helper {
  private client: S3Client;
  private config: S3Config;
  private defaultBucket?: string;
  private kvdb?: IKVDatabase;

  constructor(config: S3Config, kvdb?: IKVDatabase) {
    // 合并预设配置
    const provider_defaults = PROVIDER_CONFIGS[config.provider] || {};
    this.config = { ...provider_defaults, ...config };

    // 验证必要配置
    if (
      !this.config.endPoint ||
      !this.config.accessKey ||
      !this.config.secretKey
    ) {
      throw new Error(
        'Missing required S3 configuration: endPoint, accessKey, secretKey',
      );
    }

    // 构建端点 URL
    const protocol = (this.config.useSSL ?? true) ? 'https' : 'http';
    const port = this.config.port || (this.config.useSSL ? 443 : 80);
    const endpoint = `${protocol}://${this.config.endPoint}${
      port !== (this.config.useSSL ? 443 : 80) ? `:${port}` : ''
    }`;

    this.client = new S3Client({
      endpoint,
      region: this.config.region || 'us-east-1',
      credentials: {
        accessKeyId: this.config.accessKey,
        secretAccessKey: this.config.secretKey,
      },
      forcePathStyle: this.config.provider !== S3Provider.AWS_S3, // 非 AWS S3 使用路径风格
    });

    this.defaultBucket = config.bucket;
    this.kvdb = kvdb;
  }

  // 静态工厂方法，快速创建不同提供商的实例
  static createAWS(
    accessKey: string,
    secretKey: string,
    bucket?: string,
    region: string = 'us-east-1',
    kvdb?: IKVDatabase,
  ): S3Helper {
    return new S3Helper(
      {
        provider: S3Provider.AWS_S3,
        endPoint: `s3.${region}.amazonaws.com`,
        accessKey,
        secretKey,
        region,
        bucket,
      },
      kvdb,
    );
  }

  static createBackblazeB2(
    applicationKeyId: string,
    applicationKey: string,
    bucketEndpoint: string,
    bucket?: string,
    kvdb?: IKVDatabase,
  ): S3Helper {
    return new S3Helper(
      {
        provider: S3Provider.BACKBLAZE_B2,
        endPoint: bucketEndpoint,
        accessKey: applicationKeyId,
        secretKey: applicationKey,
        bucket,
      },
      kvdb,
    );
  }

  static createCloudflareR2(
    accessKeyId: string,
    secretAccessKey: string,
    accountId: string,
    bucket?: string,
    kvdb?: IKVDatabase,
  ): S3Helper {
    return new S3Helper(
      {
        provider: S3Provider.CLOUDFLARE_R2,
        endPoint: `${accountId}.r2.cloudflarestorage.com`,
        accessKey: accessKeyId,
        secretKey: secretAccessKey,
        bucket,
      },
      kvdb,
    );
  }

  static createMinIO(
    accessKey: string,
    secretKey: string,
    endPoint: string,
    bucket?: string,
    useSSL: boolean = false,
    port?: number,
    kvdb?: IKVDatabase,
  ): S3Helper {
    return new S3Helper(
      {
        provider: S3Provider.MINIO,
        endPoint,
        port,
        useSSL,
        accessKey,
        secretKey,
        bucket,
      },
      kvdb,
    );
  }

  // 获取 bucket 名称（使用默认或传入的）
  private getBucketName(bucket?: string): string {
    const bucket_name = bucket || this.defaultBucket;
    if (!bucket_name) {
      throw new Error(
        'Bucket name is required. Provide it in the method call or set a default bucket in config.',
      );
    }
    return bucket_name;
  }

  // 标准化 ETag 格式（移除双引号）
  private normalizeETag(etag: string): string {
    return etag.replace(/^"|"$/g, '');
  }

  // 检查文件是否已经上传过
  private async checkDuplicate(etag: string): Promise<string | null> {
    if (!this.kvdb) {
      return null; // 没有配置KVDB，直接返回null
    }
    try {
      return await this.kvdb.get(etag);
    } catch (error) {
      // 如果获取失败，返回null，表示没有找到
      return null;
    }
  }

  // 存储文件ETag和objectName的映射
  private async storeDuplicate(
    etag: string,
    objectName: string,
  ): Promise<void> {
    if (!this.kvdb) {
      return; // 没有配置KVDB，直接返回
    }
    try {
      await this.kvdb.put(etag, objectName);
    } catch (error: any) {
      // 存储失败不应该影响上传流程，只记录错误
      console.warn(`Failed to store duplicate mapping: ${error.message}`);
    }
  }

  // Bucket 操作
  async bucketExists(bucket?: string): Promise<boolean> {
    try {
      const command = new HeadBucketCommand({
        Bucket: this.getBucketName(bucket),
      });
      await this.client.send(command);
      return true;
    } catch (error: any) {
      if (
        error.name === 'NotFound' ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      throw new Error(`检查 bucket 失败: ${error.message}`);
    }
  }

  async createBucket(bucket?: string, region?: string): Promise<void> {
    try {
      const bucket_name = this.getBucketName(bucket);
      const create_bucket_input: CreateBucketCommandInput = {
        Bucket: bucket_name,
      };

      // 如果不是 us-east-1，需要指定位置约束
      const bucket_region = region || this.config.region;
      if (bucket_region && bucket_region !== 'us-east-1') {
        create_bucket_input.CreateBucketConfiguration = {
          LocationConstraint: bucket_region as BucketLocationConstraint,
        };
      }

      const command = new CreateBucketCommand(create_bucket_input);
      await this.client.send(command);
    } catch (error: any) {
      throw new Error(`创建 bucket 失败: ${error.message}`);
    }
  }

  async deleteBucket(bucket?: string): Promise<void> {
    try {
      const command = new DeleteBucketCommand({
        Bucket: this.getBucketName(bucket),
      });
      await this.client.send(command);
    } catch (error: any) {
      throw new Error(`删除 bucket 失败: ${error.message}`);
    }
  }

  async listBuckets(): Promise<string[]> {
    try {
      const command = new ListBucketsCommand({});
      const response = await this.client.send(command);
      return response.Buckets?.map((b) => b.Name!) || [];
    } catch (error: any) {
      throw new Error(`列出 buckets 失败: ${error.message}`);
    }
  }

  // 文件上传
  async uploadFile(
    object_name: string,
    file_path: string,
    bucket?: string,
    options?: UploadOptions,
  ): Promise<FileInfo> {
    try {
      // 如果不是强制上传，先检查是否已存在
      if (!options?.forceUpload) {
        const file_md5 = await this.calculateFileMD5(file_path);
        const existing_object_name = await this.checkDuplicate(file_md5);
        if (existing_object_name) {
          // 验证文件是否仍然存在于S3中
          const info = await this.getFileInfo(existing_object_name, bucket);
          if (this.normalizeETag(info.etag) === file_md5) {
            return info; // 返回已存在的文件信息
          }
        }
      }

      const file_stream = fs.createReadStream(file_path);
      const stats = await fs.promises.stat(file_path);

      const upload_result = await this.uploadStream(
        object_name,
        file_stream,
        stats.size,
        bucket,
        options,
      );

      // 存储ETag和objectName的映射
      if (!options?.forceUpload) {
        const file_md5 = await this.calculateFileMD5(file_path);
        await this.storeDuplicate(file_md5, object_name);
      }

      // 直接返回文件信息，包含已知的本地文件信息
      return {
        name: object_name,
        size: stats.size,
        lastModified: stats.mtime,
        etag: upload_result.etag,
        contentType: options?.contentType,
        metadata: options?.metadata,
      };
    } catch (error: any) {
      throw new Error(`上传文件失败: ${error.message}`);
    }
  }

  async uploadBuffer(
    object_name: string,
    buffer: Buffer,
    bucket?: string,
    options?: UploadOptions,
  ): Promise<FileInfo> {
    try {
      // 如果不是强制上传，先检查是否已存在
      if (!options?.forceUpload) {
        const buffer_md5 = await this.calculateBufferMD5(buffer);
        const existing_object_name = await this.checkDuplicate(buffer_md5);
        console.log('existingObjectName', existing_object_name);
        if (existing_object_name) {
          // 验证文件是否仍然存在于S3中
          const info = await this.getFileInfo(existing_object_name, bucket);
          const normalized_etag = this.normalizeETag(info.etag);
          console.log('Comparing ETags:', {
            normalized_etag,
            buffer_md5,
            matches: normalized_etag === buffer_md5,
          });
          if (normalized_etag === buffer_md5) {
            console.log('File already exists, returning cached info');
            return info; // 返回已存在的文件信息
          }
        }
      }

      const bucket_name = this.getBucketName(bucket);
      const put_object_input: PutObjectCommandInput = {
        Bucket: bucket_name,
        Key: object_name,
        Body: buffer,
      };

      if (options?.contentType) {
        put_object_input.ContentType = options.contentType;
      }

      if (options?.metadata) {
        put_object_input.Metadata = options.metadata;
      }

      if (options?.acl) {
        put_object_input.ACL = options.acl;
      }

      const command = new PutObjectCommand(put_object_input);
      const response = await this.client.send(command);

      // 存储ETag和objectName的映射
      if (!options?.forceUpload) {
        const buffer_md5 = await this.calculateBufferMD5(buffer);
        await this.storeDuplicate(buffer_md5, object_name);
      }

      // 直接返回文件信息，使用已知信息
      return {
        name: object_name,
        size: buffer.length,
        lastModified: new Date(), // Buffer 没有原始修改时间，使用当前时间
        etag: this.normalizeETag(response.ETag || ''),
        contentType: options?.contentType,
        metadata: options?.metadata,
      };
    } catch (error: any) {
      throw new Error(`上传缓冲区失败: ${error.message}`);
    }
  }

  async uploadBufferGzip(
    object_name: string,
    buffer: Buffer,
    bucket?: string,
    options?: UploadOptions,
  ): Promise<FileInfo> {
    try {
      const gzip_async = promisify(gzip);
      const compressed_buffer = await gzip_async(buffer);

      // Append .gz extension if not already present
      const gzipped_object_name = object_name.endsWith('.gz')
        ? object_name
        : `${object_name}.gz`;

      // 设置压缩相关的选项
      const gzip_options: UploadOptions = {
        ...options,
        contentType: options?.contentType || 'application/gzip',
        metadata: {
          ...options?.metadata,
          'content-encoding': 'gzip',
          'original-size': buffer.length.toString(),
        },
      };

      return await this.uploadBuffer(
        gzipped_object_name,
        compressed_buffer,
        bucket,
        gzip_options,
      );
    } catch (error: any) {
      throw new Error(`上传压缩缓冲区失败: ${error.message}`);
    }
  }

  async uploadStream(
    object_name: string,
    stream: Readable,
    size?: number,
    bucket?: string,
    options?: UploadOptions,
  ): Promise<FileInfo> {
    try {
      const bucket_name = this.getBucketName(bucket);
      const put_object_input: PutObjectCommandInput = {
        Bucket: bucket_name,
        Key: object_name,
        Body: stream,
      };

      if (size) {
        put_object_input.ContentLength = size;
      }

      if (options?.contentType) {
        put_object_input.ContentType = options.contentType;
      }

      if (options?.metadata) {
        put_object_input.Metadata = options.metadata;
      }

      if (options?.acl) {
        put_object_input.ACL = options.acl;
      }

      const command = new PutObjectCommand(put_object_input);
      const response = await this.client.send(command);

      // 直接返回文件信息，使用已知信息
      return {
        name: object_name,
        size: size, // 可能为 undefined，这样就不会填写
        lastModified: new Date(), // Stream 没有原始修改时间，使用当前时间
        etag: this.normalizeETag(response.ETag || ''),
        contentType: options?.contentType,
        metadata: options?.metadata,
      };
    } catch (error: any) {
      throw new Error(`上传流失败: ${error.message}`);
    }
  }

  // 高级上传方法，返回详细结果
  async uploadFileAdvanced(
    object_name: string,
    file_path: string,
    bucket?: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    try {
      // 如果不是强制上传，先检查是否已存在
      if (!options?.forceUpload) {
        const file_md5 = await this.calculateFileMD5(file_path);
        const existing_object_name = await this.checkDuplicate(file_md5);
        if (existing_object_name) {
          // 验证文件是否仍然存在于S3中
          const exists = await this.fileExists(existing_object_name, bucket);
          if (exists) {
            return {
              etag: file_md5,
              objectName: existing_object_name,
              wasUploaded: false,
            };
          }
        }
      }

      // 实际上传文件
      const file_info = await this.uploadFile(object_name, file_path, bucket, {
        ...options,
        forceUpload: true, // 避免重复检查
      });

      return {
        etag: file_info.etag,
        objectName: object_name,
        wasUploaded: true,
      };
    } catch (error: any) {
      throw new Error(`高级上传文件失败: ${error.message}`);
    }
  }

  async uploadBufferAdvanced(
    object_name: string,
    buffer: Buffer,
    bucket?: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    try {
      // 如果不是强制上传，先检查是否已存在
      if (!options?.forceUpload) {
        const buffer_md5 = await this.calculateBufferMD5(buffer);
        const existing_object_name = await this.checkDuplicate(buffer_md5);
        if (existing_object_name) {
          // 验证文件是否仍然存在于S3中
          const exists = await this.fileExists(existing_object_name, bucket);
          if (exists) {
            return {
              etag: buffer_md5,
              objectName: existing_object_name,
              wasUploaded: false,
            };
          }
        }
      }

      // 实际上传buffer
      const file_info = await this.uploadBuffer(object_name, buffer, bucket, {
        ...options,
        forceUpload: true, // 避免重复检查
      });

      return {
        etag: file_info.etag,
        objectName: object_name,
        wasUploaded: true,
      };
    } catch (error: any) {
      throw new Error(`高级上传缓冲区失败: ${error.message}`);
    }
  }

  async uploadFileGzip(
    object_name: string,
    file_path: string,
    bucket?: string,
    options?: UploadOptions,
  ): Promise<FileInfo> {
    try {
      const file_stream = fs.createReadStream(file_path);
      const gzip_stream = createGzip();
      const bucket_name = this.getBucketName(bucket);

      // Append .gz extension if not already present
      const gzipped_object_name = object_name.endsWith('.gz')
        ? object_name
        : `${object_name}.gz`;

      // Note: Cannot easily get the gzipped size before uploading the stream.
      // The S3 client will handle chunking and multi-part uploads if necessary.

      // Set compression related options
      const gzip_options: UploadOptions = {
        ...options,
        contentType: options?.contentType || 'application/gzip',
        metadata: {
          ...options?.metadata,
          'content-encoding': 'gzip',
          // Optionally add original size if known, but it's not directly available from a stream
        },
      };

      return await this.uploadStream(
        gzipped_object_name,
        file_stream.pipe(gzip_stream),
        undefined, // Size is unknown for gzipped stream
        bucket_name,
        gzip_options,
      );
    } catch (error: any) {
      throw new Error(`上传并压缩文件失败: ${error.message}`);
    }
  }

  // 文件下载
  async downloadFile(
    object_name: string,
    file_path: string,
    bucket?: string,
  ): Promise<void> {
    try {
      const stream = await this.downloadStream(object_name, bucket);
      const write_stream = fs.createWriteStream(file_path);

      return new Promise((resolve, reject) => {
        stream.pipe(write_stream);
        stream.on('error', reject);
        write_stream.on('error', reject);
        write_stream.on('finish', resolve);
      });
    } catch (error: any) {
      throw new Error(`下载文件失败: ${error.message}`);
    }
  }

  async downloadFileGunzip(
    object_name: string,
    file_path: string,
    bucket?: string,
  ): Promise<void> {
    try {
      const download_stream = await this.downloadStream(object_name, bucket);
      const gunzip_stream = createGunzip();

      // Determine the actual file path, removing .gz if present in objectName
      const final_file_path =
        object_name.endsWith('.gz') && file_path.endsWith('.gz')
          ? file_path.slice(0, -3) // Remove .gz from filePath
          : file_path;

      const write_stream = fs.createWriteStream(final_file_path);

      return new Promise((resolve, reject) => {
        download_stream.pipe(gunzip_stream).pipe(write_stream);
        download_stream.on('error', reject);
        gunzip_stream.on('error', reject);
        write_stream.on('error', reject);
        write_stream.on('finish', resolve);
      });
    } catch (error: any) {
      throw new Error(`下载并解压文件失败: ${error.message}`);
    }
  }

  async downloadBuffer(object_name: string, bucket?: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.getBucketName(bucket),
        Key: object_name,
      });
      const response = await this.client.send(command);

      const body_contents = await response.Body!.transformToByteArray();
      return Buffer.from(body_contents);
    } catch (error: any) {
      throw new Error(`下载到缓冲区失败: ${error.message}`);
    }
  }

  async downloadBufferGunzip(
    object_name: string,
    bucket?: string,
  ): Promise<Buffer> {
    try {
      const compressed_buffer = await this.downloadBuffer(object_name, bucket);
      const gunzip_async = promisify(gunzip);
      const decompressed_buffer = await gunzip_async(compressed_buffer);

      return decompressed_buffer;
    } catch (error: any) {
      throw new Error(`下载解压缓冲区失败: ${error.message}`);
    }
  }

  async downloadStream(
    object_name: string,
    bucket?: string,
  ): Promise<Readable> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.getBucketName(bucket),
        Key: object_name,
      });
      const response = await this.client.send(command);

      if (response.Body instanceof Readable) {
        return response.Body;
      } else {
        // 将其他类型转换为 Readable
        const body_contents = await response.Body!.transformToByteArray();
        const readable = new Readable();
        readable.push(Buffer.from(body_contents));
        readable.push(null);
        return readable;
      }
    } catch (error: any) {
      throw new Error(`获取下载流失败: ${error.message}`);
    }
  }

  // 文件信息和列表
  async getFileInfo(object_name: string, bucket?: string): Promise<FileInfo> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.getBucketName(bucket),
        Key: object_name,
      });
      const response = await this.client.send(command);

      return {
        name: object_name,
        size: response.ContentLength || 0,
        lastModified: response.LastModified || new Date(),
        etag: this.normalizeETag(response.ETag || ''),
        contentType: response.ContentType,
        metadata: response.Metadata,
      };
    } catch (error: any) {
      throw new Error(`获取文件信息失败: ${error.message}`);
    }
  }

  async listFiles(
    prefix?: string,
    bucket?: string,
    recursive: boolean = false,
  ): Promise<S3Object[]> {
    try {
      const bucket_name = this.getBucketName(bucket);
      const objects: S3Object[] = [];
      let continuation_token: string | undefined;

      do {
        const command = new ListObjectsV2Command({
          Bucket: bucket_name,
          Prefix: prefix,
          Delimiter: recursive ? undefined : '/',
          ContinuationToken: continuation_token,
        });

        const response = await this.client.send(command);

        // 添加对象
        if (response.Contents) {
          for (const obj of response.Contents) {
            objects.push({
              name: obj.Key,
              size: obj.Size,
              etag: obj.ETag,
              lastModified: obj.LastModified,
              storageClass: obj.StorageClass,
            });
          }
        }

        // 添加公共前缀（文件夹）
        if (response.CommonPrefixes) {
          for (const common_prefix of response.CommonPrefixes) {
            objects.push({
              prefix: common_prefix.Prefix,
              name: common_prefix.Prefix,
            });
          }
        }

        continuation_token = response.NextContinuationToken;
      } while (continuation_token);

      return objects;
    } catch (error: any) {
      throw new Error(`列出文件失败: ${error.message}`);
    }
  }

  async fileExists(object_name: string, bucket?: string): Promise<boolean> {
    try {
      await this.getFileInfo(object_name, bucket);
      return true;
    } catch (error: any) {
      if (error.message.includes('NotFound') || error.message.includes('404')) {
        return false;
      }
      throw new Error(`检查文件存在性失败: ${error.message}`);
    }
  }

  // 新增函数：获取指定对象的 ETag
  async getObjectETag(object_name: string, bucket?: string): Promise<string> {
    try {
      const file_info = await this.getFileInfo(object_name, bucket);
      // ETag 通常被双引号包围，这里移除双引号以保持和 PutObjectCommand 返回的格式一致
      return file_info.etag.replace(/"/g, '');
    } catch (error: any) {
      throw new Error(`获取对象 ${object_name} 的 ETag 失败: ${error.message}`);
    }
  }

  // 新增函数：上传文件并返回 ETag
  async uploadFileAndGetETag(
    object_name: string,
    file_path: string,
    bucket?: string,
    options?: UploadOptions,
  ): Promise<string> {
    try {
      // uploadFile 方法返回 FileInfo，提取 etag
      const file_info = await this.uploadFile(
        object_name,
        file_path,
        bucket,
        options,
      );
      return file_info.etag;
    } catch (error: any) {
      throw new Error(
        `上传文件 ${file_path} 并获取 ETag 失败: ${error.message}`,
      );
    }
  }

  // 新增函数：计算本地文件的 MD5 Hash
  async calculateFileMD5(file_path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const md5_hash = crypto.createHash('md5');
      const file_stream = fs.createReadStream(file_path);

      file_stream.on('data', (chunk_data) => {
        md5_hash.update(chunk_data);
      });

      file_stream.on('end', () => {
        resolve(md5_hash.digest('hex'));
      });

      file_stream.on('error', (error) => {
        reject(
          new Error(`计算文件 ${file_path} 的 MD5 失败: ${error.message}`),
        );
      });
    });
  }

  // 新增函数：计算 Buffer 的 MD5 Hash
  async calculateBufferMD5(buffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const md5_hash = crypto.createHash('md5');
        md5_hash.update(buffer);
        resolve(md5_hash.digest('hex'));
      } catch (error: any) {
        reject(new Error(`计算 Buffer 的 MD5 失败: ${error.message}`));
      }
    });
  }

  // 文件操作
  async deleteFile(object_name: string, bucket?: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.getBucketName(bucket),
        Key: object_name,
      });
      await this.client.send(command);
    } catch (error: any) {
      throw new Error(`删除文件失败: ${error.message}`);
    }
  }

  async deleteFiles(
    object_names: string[],
    bucket?: string,
  ): Promise<BatchResult<string>> {
    const bucket_name = this.getBucketName(bucket);
    const successful: string[] = [];
    const failed: Array<{ item: string; error: string }> = [];

    try {
      const command = new DeleteObjectsCommand({
        Bucket: bucket_name,
        Delete: {
          Objects: object_names.map((key) => ({ Key: key })),
          Quiet: false,
        },
      });

      const response = await this.client.send(command);

      // 处理成功删除的对象
      if (response.Deleted) {
        for (const deleted of response.Deleted) {
          if (deleted.Key) {
            successful.push(deleted.Key);
          }
        }
      }

      // 处理删除失败的对象
      if (response.Errors) {
        for (const error of response.Errors) {
          if (error.Key) {
            failed.push({
              item: error.Key,
              error: error.Message || 'Unknown error',
            });
          }
        }
      }
    } catch (error: any) {
      // 如果批量删除失败，尝试逐个删除
      for (const object_name of object_names) {
        try {
          await this.deleteFile(object_name, bucket);
          successful.push(object_name);
        } catch (err: any) {
          failed.push({ item: object_name, error: err.message });
        }
      }
    }

    return { successful, failed };
  }

  async copyFile(
    source_object: string,
    dest_object: string,
    source_bucket?: string,
    dest_bucket?: string,
  ): Promise<void> {
    try {
      const src_bucket = this.getBucketName(source_bucket);
      const dst_bucket = this.getBucketName(dest_bucket);

      const command = new CopyObjectCommand({
        Bucket: dst_bucket,
        Key: dest_object,
        CopySource: `${src_bucket}/${source_object}`,
      });

      await this.client.send(command);
    } catch (error: any) {
      throw new Error(`复制文件失败: ${error.message}`);
    }
  }

  async moveFile(
    source_object: string,
    dest_object: string,
    source_bucket?: string,
    dest_bucket?: string,
  ): Promise<void> {
    try {
      // 先复制
      await this.copyFile(
        source_object,
        dest_object,
        source_bucket,
        dest_bucket,
      );
      // 再删除源文件
      await this.deleteFile(source_object, source_bucket);
    } catch (error: any) {
      throw new Error(`移动文件失败: ${error.message}`);
    }
  }

  // URL 生成
  async getPresignedDownloadUrl(
    object_name: string,
    expiry: number = 24 * 60 * 60,
    bucket?: string,
  ): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.getBucketName(bucket),
        Key: object_name,
      });

      return await getSignedUrl(this.client, command, { expiresIn: expiry });
    } catch (error: any) {
      throw new Error(`获取下载URL失败: ${error.message}`);
    }
  }

  async getPresignedUploadUrl(
    object_name: string,
    expiry: number = 24 * 60 * 60,
    bucket?: string,
  ): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.getBucketName(bucket),
        Key: object_name,
      });

      return await getSignedUrl(this.client, command, { expiresIn: expiry });
    } catch (error: any) {
      throw new Error(`获取上传URL失败: ${error.message}`);
    }
  }

  // 工具方法
  async getStorageInfo(
    bucket?: string,
  ): Promise<{ objectCount: number; totalSize: number }> {
    try {
      const files = await this.listFiles('', bucket, true);
      const total_size = files.reduce((sum, file) => sum + (file.size || 0), 0);
      return {
        objectCount: files.length,
        totalSize: total_size,
      };
    } catch (error: any) {
      throw new Error(`获取存储信息失败: ${error.message}`);
    }
  }

  // 清空 bucket (删除所有文件)
  async clearBucket(
    bucket?: string,
    prefix?: string,
  ): Promise<BatchResult<string>> {
    try {
      const files = await this.listFiles(prefix, bucket, true);
      const object_names = files.map((file) => file.name!).filter(Boolean);

      if (object_names.length === 0) {
        return { successful: [], failed: [] };
      }

      return await this.deleteFiles(object_names, bucket);
    } catch (error: any) {
      throw new Error(`清空 bucket 失败: ${error.message}`);
    }
  }

  // 获取客户端实例（高级用法）
  getClient(): S3Client {
    return this.client;
  }

  // 获取配置信息
  getConfig(): S3Config {
    return { ...this.config };
  }

  // 检查是否启用了防重复上传功能
  isDuplicationCheckEnabled(): boolean {
    return !!this.kvdb;
  }

  // 清理失效的缓存条目（当S3中的文件已被删除但缓存中仍存在时）
  cleanupInvalidCache(
    bucket?: string,
    batchSize: number = 100,
  ): Promise<{ cleaned: number; failed: number }> {
    try {
      // 这个方法需要KVDatabase支持列举所有键值对
      // 由于当前接口不支持，这里提供一个基本实现框架
      console.warn(
        'cleanupInvalidCache requires KVDatabase to support iteration over all keys',
      );
      return Promise.resolve({ cleaned: 0, failed: 0 });
    } catch (error: any) {
      throw new Error(`清理失效缓存失败: ${error.message}`);
    }
  }

  // 手动移除缓存条目
  removeCacheEntry(etag: string): Promise<void> {
    try {
      // 注意：这需要KVDatabase支持删除操作
      // 当前接口只有get和put，可能需要扩展接口
      console.warn(
        'removeCacheEntry requires KVDatabase to support delete operation',
      );
      return Promise.resolve();
    } catch (error: any) {
      throw new Error(`移除缓存条目失败: ${error.message}`);
    }
  }

  // 上传文件夹中的所有图片（统一接口，支持基础和高级模式）
  async uploadFolderImages(
    local_folder_path: string,
    options?: FolderUploadOptions,
  ): Promise<FolderUploadResult | FolderUploadResultAdvanced> {
    try {
      // 支持的图片格式
      const image_extensions = [
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

      // 解构参数
      const {
        s3Prefix: s3_prefix,
        bucket,
        depth: search_depth,
        advanced = false,
        ...upload_options
      } = options || {};

      const successful_basic: Array<{
        localPath: string;
        s3Key: string;
        fileInfo: FileInfo;
        wasUploaded: boolean;
      }> = [];

      const successful_advanced: Array<{
        localPath: string;
        s3Key: string;
        uploadResult: UploadResult;
      }> = [];

      const failed: Array<{ localPath: string; error: string }> = [];

      let uploaded_count = 0;
      let cached_count = 0;

      // 默认深度为 -1（无限深度）
      // Note: search_depth is already defined above from destructuring

      // 递归获取所有图片文件，支持深度控制
      const get_image_files = async (
        dir_path: string,
        base_path: string,
        current_depth: number = 0,
      ): Promise<string[]> => {
        const files: string[] = [];
        const items = await fs.promises.readdir(dir_path, {
          withFileTypes: true,
        });

        for (const item of items) {
          const full_path = `${dir_path}/${item.name}`;

          if (item.isDirectory()) {
            // 检查是否需要继续递归
            // search_depth === -1 表示无限深度
            // current_depth < search_depth 表示还未达到指定深度
            if (search_depth === -1 || current_depth < (search_depth || 0)) {
              const sub_files = await get_image_files(
                full_path,
                base_path,
                current_depth + 1,
              );
              files.push(...sub_files);
            }
          } else if (item.isFile()) {
            // 检查是否为图片文件
            const ext = item.name
              .toLowerCase()
              .substring(item.name.lastIndexOf('.'));
            if (image_extensions.includes(ext)) {
              files.push(full_path);
            }
          }
        }

        return files;
      };

      // 获取所有图片文件
      const image_files = await get_image_files(
        local_folder_path,
        local_folder_path,
        0,
      );

      console.log(
        `Found ${image_files.length} image files to upload (depth: ${
          search_depth === -1 ? 'unlimited' : search_depth
        }, mode: ${advanced ? 'advanced' : 'basic'})`,
      );

      // 批量上传图片
      for (const file_path of image_files) {
        try {
          // 生成S3对象名称
          const relative_path = file_path
            .replace(local_folder_path, '')
            .replace(/^\/+/, '');
          const s3_key = s3_prefix
            ? `${s3_prefix}/${relative_path}`
            : relative_path;

          // 根据文件扩展名设置content type
          const ext = file_path
            .toLowerCase()
            .substring(file_path.lastIndexOf('.'));
          const content_type_map: Record<string, string> = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.bmp': 'image/bmp',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.tiff': 'image/tiff',
            '.ico': 'image/x-icon',
          };

          const final_upload_options: UploadOptions = {
            ...upload_options,
            contentType: content_type_map[ext] || 'application/octet-stream',
          };

          if (advanced) {
            // 高级模式：使用 uploadFileAdvanced
            const upload_result = await this.uploadFileAdvanced(
              s3_key,
              file_path,
              bucket,
              final_upload_options,
            );

            successful_advanced.push({
              localPath: file_path,
              s3Key: s3_key,
              uploadResult: upload_result,
            });

            if (upload_result.wasUploaded) {
              uploaded_count++;
              console.log(`✓ Uploaded: ${file_path} -> ${s3_key}`);
            } else {
              cached_count++;
              console.log(
                `⚡ Cached: ${file_path} -> ${upload_result.objectName} (already exists)`,
              );
            }
          } else {
            // 基础模式：使用原有逻辑
            const was_uploaded = true;
            if (
              this.isDuplicationCheckEnabled() &&
              !upload_options?.forceUpload
            ) {
              // 计算文件MD5用于重复检查
              const file_md5 = await this.calculateFileMD5(file_path);
              const existing_object_name = await this.checkDuplicate(file_md5);

              if (existing_object_name) {
                // 验证文件是否仍然存在于S3中
                try {
                  const existing_info = await this.getFileInfo(
                    existing_object_name,
                    bucket,
                  );
                  if (this.normalizeETag(existing_info.etag) === file_md5) {
                    // 文件已存在且完整，跳过上传
                    successful_basic.push({
                      localPath: file_path,
                      s3Key: existing_object_name,
                      fileInfo: existing_info,
                      wasUploaded: false,
                    });
                    cached_count++;
                    console.log(
                      `⚡ Cached: ${file_path} -> ${existing_object_name} (already exists)`,
                    );
                    continue;
                  }
                } catch (error) {
                  // 如果获取文件信息失败，可能文件已被删除，继续上传
                  console.warn(
                    `Cached file ${existing_object_name} not found, will upload ${file_path}`,
                  );
                }
              }
            }

            const file_info = await this.uploadFile(
              s3_key,
              file_path,
              bucket,
              final_upload_options,
            );

            successful_basic.push({
              localPath: file_path,
              s3Key: s3_key,
              fileInfo: file_info,
              wasUploaded: was_uploaded,
            });
            uploaded_count++;

            console.log(`✓ Uploaded: ${file_path} -> ${s3_key}`);
          }
        } catch (error: any) {
          failed.push({
            localPath: file_path,
            error: error.message,
          });
          console.error(`✗ Failed to upload: ${file_path} - ${error.message}`);
        }
      }

      console.log(
        `Upload summary: ${uploaded_count} uploaded, ${cached_count} from cache, ${failed.length} failed`,
      );

      // 根据模式返回不同类型的结果
      if (advanced) {
        return {
          successful: successful_advanced,
          failed,
          totalFiles: image_files.length,
          uploadedCount: uploaded_count,
          cachedCount: cached_count,
        } as FolderUploadResultAdvanced;
      } else {
        return {
          successful: successful_basic,
          failed,
          totalFiles: image_files.length,
          uploadedCount: uploaded_count,
          cachedCount: cached_count,
        } as FolderUploadResult;
      }
    } catch (error: any) {
      throw new Error(`上传文件夹图片失败: ${error.message}`);
    }
  }

  // 生成所有文件的signed URL并写入JSON文件（支持批处理和简化模式）
  async generateSignedUrlsToJson(
    output_json_path: string,
    options?: GenerateUrlOptions & { batchSize?: number },
  ): Promise<{
    totalFiles: number;
    successfulUrls: number;
    failedUrls: number;
    outputPath: string;
  }> {
    try {
      const opts = {
        downloadUrls: true,
        uploadUrls: false,
        includeMetadata: false,
        simplify: true,
        bucket: this.defaultBucket,
        prefix: undefined,
        expiry: 7 * 24 * 60 * 60,
        batchSize: 100, // 默认批处理大小
        ...options,
      };

      // 如果启用简化模式，强制设置相关选项
      // if (opts.simplify) {
      //   opts.downloadUrls = true;
      //   opts.uploadUrls = false;
      //   opts.includeMetadata = false;
      // }

      // 获取所有文件
      const files = await this.listFiles(opts.prefix, opts.bucket, true);
      const file_objects = files.filter((f) => f.name && !f.name.endsWith('/'));

      console.log(
        `Found ${file_objects.length} files to generate URLs for (batch size: ${opts.batchSize})`,
      );

      const results: Array<{
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
      }> = [];

      let successful_urls = 0;
      let failed_urls = 0;

      // 批处理函数
      const process_batch = async (batch: typeof file_objects) => {
        const batch_promises = batch.map(async (file) => {
          try {
            const result: any = {
              objectName: file.name,
            };

            // 简化模式：只生成下载URL
            if (opts.simplify) {
              try {
                const download_url = await this.getPresignedDownloadUrl(
                  file.name!,
                  opts.expiry,
                  opts.bucket,
                );
                result.downloadUrl = download_url;
              } catch (error: any) {
                result.error = error.message;
              }
              return result;
            }

            // 完整模式：并行执行所有操作
            const operations: Promise<any>[] = [];

            // 生成下载URL
            if (opts.downloadUrls) {
              operations.push(
                this.getPresignedDownloadUrl(
                  file.name!,
                  opts.expiry,
                  opts.bucket,
                )
                  .then((url) => ({ type: 'downloadUrl', value: url }))
                  .catch((error) => ({
                    type: 'downloadUrl',
                    error: error.message,
                  })),
              );
            }

            // 生成上传URL
            if (opts.uploadUrls) {
              operations.push(
                this.getPresignedUploadUrl(file.name!, opts.expiry, opts.bucket)
                  .then((url) => ({ type: 'uploadUrl', value: url }))
                  .catch((error) => ({
                    type: 'uploadUrl',
                    error: error.message,
                  })),
              );
            }

            // 获取文件元数据
            if (opts.includeMetadata) {
              operations.push(
                this.getFileInfo(file.name!, opts.bucket)
                  .then((fileInfo) => ({
                    type: 'metadata',
                    value: {
                      size: fileInfo.size,
                      lastModified: fileInfo.lastModified,
                      etag: fileInfo.etag,
                      contentType: fileInfo.contentType,
                    },
                  }))
                  .catch((error) => ({
                    type: 'metadata',
                    error: error.message,
                  })),
              );
            }

            // 等待所有操作完成
            const operation_results = await Promise.all(operations);
            const errors: string[] = [];

            // 处理结果
            for (const opResult of operation_results) {
              if (opResult.error) {
                errors.push(`${opResult.type} failed: ${opResult.error}`);
              } else {
                if (opResult.type === 'downloadUrl') {
                  result.downloadUrl = opResult.value;
                } else if (opResult.type === 'uploadUrl') {
                  result.uploadUrl = opResult.value;
                } else if (opResult.type === 'metadata') {
                  result.metadata = opResult.value;
                }
              }
            }

            if (errors.length > 0) {
              result.error = errors.join('; ');
            }

            return result;
          } catch (error: any) {
            return {
              objectName: file.name!,
              error: error.message,
            };
          }
        });

        return await Promise.all(batch_promises);
      };

      // 分批处理文件
      for (let i = 0; i < file_objects.length; i += opts.batchSize) {
        const batch = file_objects.slice(i, i + opts.batchSize);
        const batch_number = Math.floor(i / opts.batchSize) + 1;
        const total_batches = Math.ceil(file_objects.length / opts.batchSize);

        console.log(
          `Processing batch ${batch_number}/${total_batches} (${batch.length} files)`,
        );

        try {
          const batch_results = await process_batch(batch);

          // 统计结果
          for (const result of batch_results) {
            if (result.error) {
              failed_urls++;
              console.error(
                `✗ Failed to generate URLs for: ${result.objectName} - ${result.error}`,
              );
            } else {
              successful_urls++;
              console.log(`✓ Generated URLs for: ${result.objectName}`);
            }
            results.push(result);
          }
        } catch (error: any) {
          // 如果整个批次失败，将所有文件标记为失败
          for (const file of batch) {
            results.push({
              objectName: file.name!,
              error: `Batch processing failed: ${error.message}`,
            });
            failed_urls++;
            console.error(
              `✗ Batch failed for: ${file.name} - ${error.message}`,
            );
          }
        }

        // 显示进度
        const processed = Math.min(i + opts.batchSize, file_objects.length);
        console.log(
          `Progress: ${processed}/${file_objects.length} files processed`,
        );
      }

      // 创建完整的输出对象
      const output = {
        generatedAt: new Date().toISOString(),
        bucket: this.getBucketName(opts.bucket),
        prefix: opts.prefix || '',
        expiry: opts.expiry,
        batchSize: opts.batchSize,
        options: opts,
        summary: {
          totalFiles: file_objects.length,
          successfulUrls: successful_urls,
          failedUrls: failed_urls,
        },
        files: results,
      };

      // 写入JSON文件
      await fs.promises.writeFile(
        output_json_path,
        JSON.stringify(output, null, 2),
        'utf8',
      );

      console.log(`✓ Signed URLs written to: ${output_json_path}`);
      console.log(
        `📊 Final Summary: ${successful_urls} successful, ${failed_urls} failed out of ${file_objects.length} total files`,
      );

      return {
        totalFiles: file_objects.length,
        successfulUrls: successful_urls,
        failedUrls: failed_urls,
        outputPath: output_json_path,
      };
    } catch (error: any) {
      throw new Error(`生成签名URL到JSON文件失败: ${error.message}`);
    }
  }

  // 生成单个文件的signed URL
  async generateSignedUrlsForFile(
    objectName: string,
    options?: Omit<GenerateUrlOptions, 'prefix'>,
  ): Promise<{
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
  }> {
    try {
      const opts = {
        downloadUrls: true,
        uploadUrls: false,
        includeMetadata: false,
        simplify: false,
        bucket: this.defaultBucket,
        expiry: 24 * 60 * 60,
        ...options,
      };

      // 如果启用简化模式，强制设置相关选项
      if (opts.simplify) {
        opts.downloadUrls = true;
        opts.uploadUrls = false;
        opts.includeMetadata = false;
      }

      console.log(`🔗 Generating URLs for: ${objectName}`);

      const result: any = {
        objectName,
      };

      // 首先检查文件是否存在
      const exists = await this.fileExists(objectName, opts.bucket);
      if (!exists) {
        result.error = 'File does not exist';
        console.error(`✗ File not found: ${objectName}`);
        return result;
      }

      // 简化模式：只生成下载URL
      if (opts.simplify) {
        try {
          const download_url = await this.getPresignedDownloadUrl(
            objectName,
            opts.expiry,
            opts.bucket,
          );
          result.downloadUrl = download_url;
          console.log(`✓ Generated download URL for: ${objectName}`);
        } catch (error: any) {
          result.error = error.message;
          console.error(
            `✗ Failed to generate download URL for: ${objectName} - ${error.message}`,
          );
        }
        return result;
      }

      // 完整模式：并行执行所有操作
      const operations: Promise<any>[] = [];

      // 生成下载URL
      if (opts.downloadUrls) {
        operations.push(
          this.getPresignedDownloadUrl(objectName, opts.expiry, opts.bucket)
            .then((url) => ({ type: 'downloadUrl', value: url }))
            .catch((error) => ({
              type: 'downloadUrl',
              error: error.message,
            })),
        );
      }

      // 生成上传URL
      if (opts.uploadUrls) {
        operations.push(
          this.getPresignedUploadUrl(objectName, opts.expiry, opts.bucket)
            .then((url) => ({ type: 'uploadUrl', value: url }))
            .catch((error) => ({
              type: 'uploadUrl',
              error: error.message,
            })),
        );
      }

      // 获取文件元数据
      if (opts.includeMetadata) {
        operations.push(
          this.getFileInfo(objectName, opts.bucket)
            .then((fileInfo) => ({
              type: 'metadata',
              value: {
                size: fileInfo.size,
                lastModified: fileInfo.lastModified,
                etag: fileInfo.etag,
                contentType: fileInfo.contentType,
              },
            }))
            .catch((error) => ({
              type: 'metadata',
              error: error.message,
            })),
        );
      }

      // 等待所有操作完成
      const operation_results = await Promise.all(operations);
      const errors: string[] = [];

      // 处理结果
      for (const opResult of operation_results) {
        if (opResult.error) {
          errors.push(`${opResult.type} failed: ${opResult.error}`);
        } else {
          if (opResult.type === 'downloadUrl') {
            result.downloadUrl = opResult.value;
          } else if (opResult.type === 'uploadUrl') {
            result.uploadUrl = opResult.value;
          } else if (opResult.type === 'metadata') {
            result.metadata = opResult.value;
          }
        }
      }

      if (errors.length > 0) {
        result.error = errors.join('; ');
        console.error(
          `✗ Some operations failed for: ${objectName} - ${result.error}`,
        );
      } else {
        console.log(`✓ Generated URLs for: ${objectName}`);
      }

      return result;
    } catch (error: any) {
      const errorResult = {
        objectName,
        error: error.message,
      };
      console.error(
        `✗ Failed to generate URLs for: ${objectName} - ${error.message}`,
      );
      return errorResult;
    }
  }

  // 批量生成特定文件列表的signed URL（支持批处理和简化模式）
  async generateSignedUrlsForFiles(
    object_names: string[],
    output_json_path: string,
    options?: GenerateUrlOptions & { batchSize?: number },
  ): Promise<{
    totalFiles: number;
    successfulUrls: number;
    failedUrls: number;
    outputPath: string;
  }> {
    try {
      const opts = {
        downloadUrls: true,
        uploadUrls: false,
        includeMetadata: false,
        simplify: false,
        bucket: this.defaultBucket,
        expiry: 24 * 60 * 60,
        batchSize: 25, // 默认批处理大小
        ...options,
      };

      // 如果启用简化模式，强制设置相关选项
      if (opts.simplify) {
        opts.downloadUrls = true;
        opts.uploadUrls = false;
        opts.includeMetadata = false;
      }

      console.log(
        `Generating URLs for ${object_names.length} specified files (batch size: ${opts.batchSize})`,
      );

      const results: Array<{
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
      }> = [];

      let successful_urls = 0;
      let failed_urls = 0;

      // 批处理函数
      const process_batch = async (batch: string[]) => {
        const batch_promises = batch.map(async (objectName) => {
          try {
            const result: any = {
              objectName,
            };

            // 首先检查文件是否存在
            const exists = await this.fileExists(objectName, opts.bucket);
            if (!exists) {
              return {
                objectName,
                error: 'File does not exist',
              };
            }

            // 简化模式：只生成下载URL
            if (opts.simplify) {
              try {
                const download_url = await this.getPresignedDownloadUrl(
                  objectName,
                  opts.expiry,
                  opts.bucket,
                );
                result.downloadUrl = download_url;
              } catch (error: any) {
                result.error = error.message;
              }
              return result;
            }

            // 完整模式：并行执行所有操作
            const operations: Promise<any>[] = [];

            // 生成下载URL
            if (opts.downloadUrls) {
              operations.push(
                this.getPresignedDownloadUrl(
                  objectName,
                  opts.expiry,
                  opts.bucket,
                )
                  .then((url) => ({ type: 'downloadUrl', value: url }))
                  .catch((error) => ({
                    type: 'downloadUrl',
                    error: error.message,
                  })),
              );
            }

            // 生成上传URL
            if (opts.uploadUrls) {
              operations.push(
                this.getPresignedUploadUrl(objectName, opts.expiry, opts.bucket)
                  .then((url) => ({ type: 'uploadUrl', value: url }))
                  .catch((error) => ({
                    type: 'uploadUrl',
                    error: error.message,
                  })),
              );
            }

            // 获取文件元数据
            if (opts.includeMetadata) {
              operations.push(
                this.getFileInfo(objectName, opts.bucket)
                  .then((fileInfo) => ({
                    type: 'metadata',
                    value: {
                      size: fileInfo.size,
                      lastModified: fileInfo.lastModified,
                      etag: fileInfo.etag,
                      contentType: fileInfo.contentType,
                    },
                  }))
                  .catch((error) => ({
                    type: 'metadata',
                    error: error.message,
                  })),
              );
            }

            // 等待所有操作完成
            const operation_results = await Promise.all(operations);
            const errors: string[] = [];

            // 处理结果
            for (const opResult of operation_results) {
              if (opResult.error) {
                errors.push(`${opResult.type} failed: ${opResult.error}`);
              } else {
                if (opResult.type === 'downloadUrl') {
                  result.downloadUrl = opResult.value;
                } else if (opResult.type === 'uploadUrl') {
                  result.uploadUrl = opResult.value;
                } else if (opResult.type === 'metadata') {
                  result.metadata = opResult.value;
                }
              }
            }

            if (errors.length > 0) {
              result.error = errors.join('; ');
            }

            return result;
          } catch (error: any) {
            return {
              objectName,
              error: error.message,
            };
          }
        });

        return await Promise.all(batch_promises);
      };

      // 分批处理文件
      for (let i = 0; i < object_names.length; i += opts.batchSize) {
        const batch = object_names.slice(i, i + opts.batchSize);
        const batch_number = Math.floor(i / opts.batchSize) + 1;
        const total_batches = Math.ceil(object_names.length / opts.batchSize);

        console.log(
          `Processing batch ${batch_number}/${total_batches} (${batch.length} files)`,
        );

        try {
          const batch_results = await process_batch(batch);

          // 统计结果
          for (const result of batch_results) {
            if (result.error) {
              failed_urls++;
              console.error(
                `✗ Failed to generate URLs for: ${result.objectName} - ${result.error}`,
              );
            } else {
              successful_urls++;
              console.log(`✓ Generated URLs for: ${result.objectName}`);
            }
            results.push(result);
          }
        } catch (error: any) {
          // 如果整个批次失败，将所有文件标记为失败
          for (const objectName of batch) {
            results.push({
              objectName,
              error: `Batch processing failed: ${error.message}`,
            });
            failed_urls++;
            console.error(
              `✗ Batch failed for: ${objectName} - ${error.message}`,
            );
          }
        }

        // 显示进度
        const processed = Math.min(i + opts.batchSize, object_names.length);
        console.log(
          `Progress: ${processed}/${object_names.length} files processed`,
        );
      }

      // 创建完整的输出对象
      const output = {
        generatedAt: new Date().toISOString(),
        bucket: this.getBucketName(opts.bucket),
        expiry: opts.expiry,
        batchSize: opts.batchSize,
        options: opts,
        summary: {
          totalFiles: object_names.length,
          successfulUrls: successful_urls,
          failedUrls: failed_urls,
        },
        files: results,
      };

      // 写入JSON文件
      await fs.promises.writeFile(
        output_json_path,
        JSON.stringify(output, null, 2),
        'utf8',
      );

      console.log(`✓ Signed URLs written to: ${output_json_path}`);
      console.log(
        `📊 Final Summary: ${successful_urls} successful, ${failed_urls} failed out of ${object_names.length} total files`,
      );

      return {
        totalFiles: object_names.length,
        successfulUrls: successful_urls,
        failedUrls: failed_urls,
        outputPath: output_json_path,
      };
    } catch (error: any) {
      throw new Error(`生成指定文件签名URL失败: ${error.message}`);
    }
  }

  // 文件过滤器辅助函数
  private applyFileFilter(
    file_path: string,
    file_size?: number,
    filter?: FileFilter,
  ): boolean {
    if (!filter) return true;

    const file_name = file_path.split('/').pop() || '';
    const file_ext = file_name
      .toLowerCase()
      .substring(file_name.lastIndexOf('.'));

    // 检查文件扩展名
    if (filter.extensions && filter.extensions.length > 0) {
      if (!filter.extensions.some((ext) => file_ext === ext.toLowerCase())) {
        return false;
      }
    }

    // 检查排除的文件扩展名
    if (filter.excludeExtensions && filter.excludeExtensions.length > 0) {
      if (
        filter.excludeExtensions.some((ext) => file_ext === ext.toLowerCase())
      ) {
        return false;
      }
    }

    // 检查包含模式
    if (filter.includePatterns && filter.includePatterns.length > 0) {
      if (!filter.includePatterns.some((pattern) => pattern.test(file_name))) {
        return false;
      }
    }

    // 检查排除模式
    if (filter.excludePatterns && filter.excludePatterns.length > 0) {
      if (filter.excludePatterns.some((pattern) => pattern.test(file_name))) {
        return false;
      }
    }

    // 检查文件大小
    if (file_size !== undefined) {
      if (filter.minSize && file_size < filter.minSize) {
        return false;
      }
      if (filter.maxSize && file_size > filter.maxSize) {
        return false;
      }
    }

    return true;
  }

  // 获取本地文件列表（支持深度控制和过滤）
  private async getLocalFiles(
    local_folder_path: string,
    filter?: FileFilter,
    depth: number = -1,
  ): Promise<
    Array<{
      localPath: string;
      relativePath: string;
      size: number;
      lastModified: Date;
    }>
  > {
    const files: Array<{
      localPath: string;
      relativePath: string;
      size: number;
      lastModified: Date;
    }> = [];

    const scan_directory = async (
      dir_path: string,
      base_path: string,
      current_depth: number = 0,
    ): Promise<void> => {
      const items = await fs.promises.readdir(dir_path, {
        withFileTypes: true,
      });

      for (const item of items) {
        const full_path = `${dir_path}/${item.name}`;

        if (item.isDirectory()) {
          // 检查是否需要继续递归
          if (depth === -1 || current_depth < depth) {
            await scan_directory(full_path, base_path, current_depth + 1);
          }
        } else if (item.isFile()) {
          const stats = await fs.promises.stat(full_path);
          const relative_path = full_path
            .replace(base_path, '')
            .replace(/^\/+/, '');

          // 应用文件过滤器
          if (this.applyFileFilter(relative_path, stats.size, filter)) {
            files.push({
              localPath: full_path,
              relativePath: relative_path,
              size: stats.size,
              lastModified: stats.mtime,
            });
          }
        }
      }
    };

    await scan_directory(local_folder_path, local_folder_path, 0);
    return files;
  }

  // 获取S3文件列表（支持过滤）
  private async getS3Files(
    bucket: string,
    prefix?: string,
    filter?: FileFilter,
  ): Promise<
    Array<{
      s3Key: string;
      relativePath: string;
      size: number;
      lastModified: Date;
      etag: string;
    }>
  > {
    const s3_objects = await this.listFiles(prefix, bucket, true);
    const files: Array<{
      s3Key: string;
      relativePath: string;
      size: number;
      lastModified: Date;
      etag: string;
    }> = [];

    for (const obj of s3_objects) {
      if (obj.name && !obj.name.endsWith('/')) {
        const relative_path = prefix
          ? obj.name.replace(new RegExp(`^${prefix.replace(/\/$/, '')}/`), '')
          : obj.name;

        // 应用文件过滤器
        if (this.applyFileFilter(relative_path, obj.size, filter)) {
          files.push({
            s3Key: obj.name,
            relativePath: relative_path,
            size: obj.size || 0,
            lastModified: obj.lastModified || new Date(),
            etag: this.normalizeETag(obj.etag || ''),
          });
        }
      }
    }

    return files;
  }

  // 比较文件是否相同
  private async compareFiles(
    local_file: { localPath: string; size: number; lastModified: Date },
    s3_file: { size: number; lastModified: Date; etag: string },
    compare_by: 'etag' | 'size' | 'lastModified' | 'both',
  ): Promise<boolean> {
    switch (compare_by) {
      case 'size':
        return local_file.size === s3_file.size;

      case 'lastModified':
        // 允许1秒的时间差异（考虑到精度问题）
        return (
          Math.abs(
            local_file.lastModified.getTime() - s3_file.lastModified.getTime(),
          ) <= 1000
        );

      case 'etag': {
        const local_etag = await this.calculateFileMD5(local_file.localPath);
        return local_etag === s3_file.etag;
      }

      case 'both': {
        if (local_file.size !== s3_file.size) return false;
        const local_etag_both = await this.calculateFileMD5(
          local_file.localPath,
        );
        return local_etag_both === s3_file.etag;
      }

      default:
        return false;
    }
  }

  // 同步文件夹到S3（支持双向同步）
  async syncFolderToS3(
    local_folder_path: string,
    options?: SyncOptions,
  ): Promise<SyncResult> {
    try {
      // 解构并设置默认值
      const {
        syncMode = SyncMode.LOCAL_TO_S3,
        s3Prefix,
        bucket,
        depth = -1,
        deleteExtraFiles = false,
        overwriteExisting = true,
        fileFilter,
        dryRun = false,
        compareBy = 'etag',
        ...uploadOptions
      } = options || {};

      const bucket_name = this.getBucketName(bucket);

      console.log(`🔄 Starting ${dryRun ? 'DRY RUN ' : ''}sync: ${syncMode}`);
      console.log(`📁 Local folder: ${local_folder_path}`);
      console.log(
        `🪣 S3 bucket: ${bucket_name}${s3Prefix ? ` (prefix: ${s3Prefix})` : ''}`,
      );

      const result: SyncResult = {
        summary: {
          totalFiles: 0,
          uploaded: 0,
          downloaded: 0,
          deleted: 0,
          skipped: 0,
          failed: 0,
          dryRun,
        },
        operations: [],
        errors: [],
      };

      // 获取本地文件列表
      const local_files =
        syncMode !== SyncMode.S3_TO_LOCAL
          ? await this.getLocalFiles(local_folder_path, fileFilter, depth)
          : [];

      // 获取S3文件列表
      const s3_files =
        syncMode !== SyncMode.LOCAL_TO_S3
          ? await this.getS3Files(bucket_name, s3Prefix, fileFilter)
          : [];

      console.log(
        `📊 Found ${local_files.length} local files, ${s3_files.length} S3 files`,
      );

      // 创建文件映射以便快速查找
      const local_file_map = new Map(
        local_files.map((f) => [f.relativePath, f]),
      );
      const s3_file_map = new Map(s3_files.map((f) => [f.relativePath, f]));

      // 收集所有唯一的相对路径
      const all_paths = new Set([
        ...local_files.map((f) => f.relativePath),
        ...s3_files.map((f) => f.relativePath),
      ]);

      result.summary.totalFiles = all_paths.size;

      // 处理每个文件
      for (const relative_path of all_paths) {
        const local_file = local_file_map.get(relative_path);
        const s3_file = s3_file_map.get(relative_path);

        try {
          if (local_file && s3_file) {
            // 文件在两边都存在，检查是否需要更新
            if (syncMode === SyncMode.BIDIRECTIONAL) {
              // 双向同步：比较时间戳决定哪个是最新的
              const local_newer =
                local_file.lastModified > s3_file.lastModified;

              if (overwriteExisting) {
                if (local_newer) {
                  // 本地文件更新，上传到S3
                  await this.performSyncOperation(
                    SyncOperation.UPLOAD,
                    local_file,
                    s3_file,
                    s3Prefix,
                    bucket_name,
                    uploadOptions,
                    dryRun,
                    result,
                  );
                } else if (s3_file.lastModified > local_file.lastModified) {
                  // S3文件更新，下载到本地
                  await this.performSyncOperation(
                    SyncOperation.DOWNLOAD,
                    local_file,
                    s3_file,
                    s3Prefix,
                    bucket_name,
                    uploadOptions,
                    dryRun,
                    result,
                  );
                } else {
                  // 时间戳相同，检查内容是否相同
                  const files_match = await this.compareFiles(
                    local_file,
                    s3_file,
                    compareBy,
                  );
                  if (!files_match) {
                    // 内容不同但时间戳相同，默认上传本地文件
                    await this.performSyncOperation(
                      SyncOperation.UPLOAD,
                      local_file,
                      s3_file,
                      s3Prefix,
                      bucket_name,
                      uploadOptions,
                      dryRun,
                      result,
                    );
                  } else {
                    this.addSkipOperation(local_file, s3_file, result);
                  }
                }
              } else {
                this.addSkipOperation(local_file, s3_file, result);
              }
            } else {
              // 单向同步：检查文件是否相同
              const files_match = await this.compareFiles(
                local_file,
                s3_file,
                compareBy,
              );

              if (!files_match && overwriteExisting) {
                if (syncMode === SyncMode.LOCAL_TO_S3) {
                  await this.performSyncOperation(
                    SyncOperation.UPDATE,
                    local_file,
                    s3_file,
                    s3Prefix,
                    bucket_name,
                    uploadOptions,
                    dryRun,
                    result,
                  );
                } else {
                  await this.performSyncOperation(
                    SyncOperation.DOWNLOAD,
                    local_file,
                    s3_file,
                    s3Prefix,
                    bucket_name,
                    uploadOptions,
                    dryRun,
                    result,
                  );
                }
              } else {
                this.addSkipOperation(local_file, s3_file, result);
              }
            }
          } else if (local_file && !s3_file) {
            // 文件只存在于本地
            if (
              syncMode === SyncMode.LOCAL_TO_S3 ||
              syncMode === SyncMode.BIDIRECTIONAL
            ) {
              await this.performSyncOperation(
                SyncOperation.UPLOAD,
                local_file,
                undefined,
                s3Prefix,
                bucket_name,
                uploadOptions,
                dryRun,
                result,
              );
            } else if (syncMode === SyncMode.S3_TO_LOCAL && deleteExtraFiles) {
              await this.performSyncOperation(
                SyncOperation.DELETE_LOCAL,
                local_file,
                undefined,
                s3Prefix,
                bucket_name,
                uploadOptions,
                dryRun,
                result,
              );
            }
          } else if (!local_file && s3_file) {
            // 文件只存在于S3
            if (
              syncMode === SyncMode.S3_TO_LOCAL ||
              syncMode === SyncMode.BIDIRECTIONAL
            ) {
              await this.performSyncOperation(
                SyncOperation.DOWNLOAD,
                undefined,
                s3_file,
                s3Prefix,
                bucket_name,
                uploadOptions,
                dryRun,
                result,
              );
            } else if (syncMode === SyncMode.LOCAL_TO_S3 && deleteExtraFiles) {
              await this.performSyncOperation(
                SyncOperation.DELETE_S3,
                undefined,
                s3_file,
                s3Prefix,
                bucket_name,
                uploadOptions,
                dryRun,
                result,
              );
            }
          }
        } catch (error: any) {
          result.summary.failed++;
          result.errors.push({
            path: relative_path,
            error: error.message,
          });
          console.error(
            `✗ Failed to sync: ${relative_path} - ${error.message}`,
          );
        }
      }

      // 输出同步结果总结
      this.printSyncSummary(result);

      return result;
    } catch (error: any) {
      throw new Error(`文件夹同步失败: ${error.message}`);
    }
  }

  // 执行同步操作
  private async performSyncOperation(
    operation: SyncOperation,
    local_file?: { localPath: string; relativePath: string; size: number },
    s3_file?: { s3Key: string; relativePath: string; size: number },
    s3Prefix?: string,
    bucket_name?: string,
    uploadOptions?: UploadOptions,
    dryRun?: boolean,
    result?: SyncResult,
  ): Promise<void> {
    const relative_path =
      local_file?.relativePath || s3_file?.relativePath || '';
    const s3_key = s3Prefix ? `${s3Prefix}/${relative_path}` : relative_path;

    if (!result) return;

    const result_item: SyncResultItem = {
      operation,
      localPath: local_file?.localPath,
      s3Key: s3_file?.s3Key || s3_key,
      size: local_file?.size || s3_file?.size,
    };

    if (dryRun) {
      result_item.skipped = true;
      result.operations.push(result_item);
      console.log(`[DRY RUN] Would ${operation}: ${relative_path}`);
      return;
    }

    try {
      switch (operation) {
        case SyncOperation.UPLOAD:
        case SyncOperation.UPDATE:
          if (local_file) {
            await this.uploadFile(
              s3_key,
              local_file.localPath,
              bucket_name,
              uploadOptions,
            );
            result.summary.uploaded++;
            console.log(`✓ Uploaded: ${local_file.localPath} -> ${s3_key}`);
          }
          break;

        case SyncOperation.DOWNLOAD:
          if (s3_file && local_file) {
            // 确保本地目录存在
            const local_dir = local_file.localPath.substring(
              0,
              local_file.localPath.lastIndexOf('/'),
            );
            await fs.promises.mkdir(local_dir, { recursive: true });
            await this.downloadFile(
              s3_file.s3Key,
              local_file.localPath,
              bucket_name,
            );
            result.summary.downloaded++;
            console.log(
              `✓ Downloaded: ${s3_file.s3Key} -> ${local_file.localPath}`,
            );
          }
          break;

        case SyncOperation.DELETE_LOCAL:
          if (local_file) {
            await fs.promises.unlink(local_file.localPath);
            result.summary.deleted++;
            console.log(`✓ Deleted local: ${local_file.localPath}`);
          }
          break;

        case SyncOperation.DELETE_S3:
          if (s3_file) {
            await this.deleteFile(s3_file.s3Key, bucket_name);
            result.summary.deleted++;
            console.log(`✓ Deleted S3: ${s3_file.s3Key}`);
          }
          break;
      }

      result.operations.push(result_item);
    } catch (error: any) {
      result_item.error = error.message;
      result.operations.push(result_item);
      result.summary.failed++;
      throw error;
    }
  }

  // 添加跳过操作记录
  private addSkipOperation(
    localFile?: { localPath: string; relativePath: string; size: number },
    s3File?: { s3Key: string; relativePath: string; size: number },
    result?: SyncResult,
  ): void {
    if (!result) return;

    result.summary.skipped++;
    result.operations.push({
      operation: SyncOperation.SKIP,
      localPath: localFile?.localPath,
      s3Key: s3File?.s3Key,
      size: localFile?.size || s3File?.size,
      skipped: true,
    });

    const relative_path = localFile?.relativePath || s3File?.relativePath || '';
    console.log(`⚡ Skipped (already in sync): ${relative_path}`);
  }

  // 打印同步结果总结
  private printSyncSummary(result: SyncResult): void {
    const { summary } = result;
    console.log('\n📊 Sync Summary:');
    console.log(`Total files: ${summary.totalFiles}`);
    if (summary.uploaded > 0) console.log(`✓ Uploaded: ${summary.uploaded}`);
    if (summary.downloaded > 0)
      console.log(`✓ Downloaded: ${summary.downloaded}`);
    if (summary.deleted > 0) console.log(`🗑️ Deleted: ${summary.deleted}`);
    if (summary.skipped > 0) console.log(`⚡ Skipped: ${summary.skipped}`);
    if (summary.failed > 0) console.log(`✗ Failed: ${summary.failed}`);
    if (summary.dryRun)
      console.log(`🔍 Mode: DRY RUN (no actual changes made)`);
  }

  // 删除过期文件
  async deleteExpire(
    expireSeconds: number,
    bucket?: string,
    prefix?: string,
  ): Promise<{
    totalFiles: number;
    expiredFiles: number;
    deletedFiles: number;
    failedFiles: number;
    errors: Array<{ objectName: string; error: string }>;
  }> {
    try {
      const bucket_name = this.getBucketName(bucket);

      console.log(
        `🔍 Scanning for files older than ${expireSeconds} seconds...`,
      );
      console.log(
        `🪣 Bucket: ${bucket_name}${prefix ? ` (prefix: ${prefix})` : ''}`,
      );

      // 获取所有文件列表
      const allFiles = await this.listFiles(prefix, bucket_name, true);
      const file_objects = allFiles.filter(
        (f) => f.name && !f.name.endsWith('/'),
      );

      console.log(`📁 Found ${file_objects.length} files to check`);

      // 计算过期时间阈值
      const expireTime = new Date(Date.now() - expireSeconds * 1000);
      console.log(
        `⏰ Files older than ${expireTime.toISOString()} will be deleted`,
      );

      // 过滤出过期的文件
      const expired_files: string[] = [];

      for (const file of file_objects) {
        if (file.name && file.lastModified && file.lastModified < expireTime) {
          expired_files.push(file.name);
          console.log(
            `🕒 Expired: ${file.name} (modified: ${file.lastModified.toISOString()})`,
          );
        }
      }

      const result = {
        totalFiles: file_objects.length,
        expiredFiles: expired_files.length,
        deletedFiles: 0,
        failedFiles: 0,
        errors: [] as Array<{ objectName: string; error: string }>,
      };

      if (expired_files.length === 0) {
        console.log('✨ No expired files found');
        return result;
      }

      console.log(`🗑️ Found ${expired_files.length} expired files to delete`);

      // 批量删除过期文件
      const deleteResult = await this.deleteFiles(expired_files, bucket_name);

      result.deletedFiles = deleteResult.successful.length;
      result.failedFiles = deleteResult.failed.length;
      result.errors = deleteResult.failed.map((f) => ({
        objectName: f.item,
        error: f.error,
      }));

      // 输出删除结果
      console.log(`\n📊 Delete Expire Summary:`);
      console.log(`Total files checked: ${result.totalFiles}`);
      console.log(`Expired files found: ${result.expiredFiles}`);
      console.log(`✓ Successfully deleted: ${result.deletedFiles}`);

      if (result.failedFiles > 0) {
        console.log(`✗ Failed to delete: ${result.failedFiles}`);
        result.errors.forEach((error) => {
          console.error(`  - ${error.objectName}: ${error.error}`);
        });
      }

      return result;
    } catch (error: any) {
      throw new Error(`删除过期文件失败: ${error.message}`);
    }
  }
}
