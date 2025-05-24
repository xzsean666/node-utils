// 需要安装: pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
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

export class S3Helper {
  private client: S3Client;
  private config: S3Config;
  private defaultBucket?: string;
  private kvdb?: IKVDatabase;

  constructor(config: S3Config, kvdb?: IKVDatabase) {
    // 合并预设配置
    const providerDefaults = PROVIDER_CONFIGS[config.provider] || {};
    this.config = { ...providerDefaults, ...config };

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
    const protocol = this.config.useSSL ?? true ? 'https' : 'http';
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
    const bucketName = bucket || this.defaultBucket;
    if (!bucketName) {
      throw new Error(
        'Bucket name is required. Provide it in the method call or set a default bucket in config.',
      );
    }
    return bucketName;
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
    } catch (error) {
      // 存储失败不应该影响上传流程，只记录错误
      console.warn(`Failed to store duplicate mapping: ${error}`);
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
      const bucketName = this.getBucketName(bucket);
      const createBucketInput: CreateBucketCommandInput = {
        Bucket: bucketName,
      };

      // 如果不是 us-east-1，需要指定位置约束
      const bucketRegion = region || this.config.region;
      if (bucketRegion && bucketRegion !== 'us-east-1') {
        createBucketInput.CreateBucketConfiguration = {
          LocationConstraint: bucketRegion as BucketLocationConstraint,
        };
      }

      const command = new CreateBucketCommand(createBucketInput);
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
    objectName: string,
    filePath: string,
    bucket?: string,
    options?: UploadOptions,
  ): Promise<FileInfo> {
    try {
      // 如果不是强制上传，先检查是否已存在
      if (!options?.forceUpload) {
        const fileMD5 = await this.calculateFileMD5(filePath);
        const existingObjectName = await this.checkDuplicate(fileMD5);
        if (existingObjectName) {
          // 验证文件是否仍然存在于S3中
          const info = await this.getFileInfo(existingObjectName, bucket);
          if (this.normalizeETag(info.etag) === fileMD5) {
            return info; // 返回已存在的文件信息
          }
        }
      }

      const fileStream = fs.createReadStream(filePath);
      const stats = await fs.promises.stat(filePath);

      const uploadResult = await this.uploadStream(
        objectName,
        fileStream,
        stats.size,
        bucket,
        options,
      );

      // 存储ETag和objectName的映射
      if (!options?.forceUpload) {
        const fileMD5 = await this.calculateFileMD5(filePath);
        await this.storeDuplicate(fileMD5, objectName);
      }

      // 直接返回文件信息，包含已知的本地文件信息
      return {
        name: objectName,
        size: stats.size,
        lastModified: stats.mtime,
        etag: uploadResult.etag,
        contentType: options?.contentType,
        metadata: options?.metadata,
      };
    } catch (error: any) {
      throw new Error(`上传文件失败: ${error.message}`);
    }
  }

  async uploadBuffer(
    objectName: string,
    buffer: Buffer,
    bucket?: string,
    options?: UploadOptions,
  ): Promise<FileInfo> {
    try {
      // 如果不是强制上传，先检查是否已存在
      if (!options?.forceUpload) {
        const bufferMD5 = await this.calculateBufferMD5(buffer);
        const existingObjectName = await this.checkDuplicate(bufferMD5);
        console.log('existingObjectName', existingObjectName);
        if (existingObjectName) {
          // 验证文件是否仍然存在于S3中
          const info = await this.getFileInfo(existingObjectName, bucket);
          const normalizedETag = this.normalizeETag(info.etag);
          console.log('Comparing ETags:', {
            normalizedETag,
            bufferMD5,
            matches: normalizedETag === bufferMD5,
          });
          if (normalizedETag === bufferMD5) {
            console.log('File already exists, returning cached info');
            return info; // 返回已存在的文件信息
          }
        }
      }

      const bucketName = this.getBucketName(bucket);
      const putObjectInput: PutObjectCommandInput = {
        Bucket: bucketName,
        Key: objectName,
        Body: buffer,
      };

      if (options?.contentType) {
        putObjectInput.ContentType = options.contentType;
      }

      if (options?.metadata) {
        putObjectInput.Metadata = options.metadata;
      }

      if (options?.acl) {
        putObjectInput.ACL = options.acl;
      }

      const command = new PutObjectCommand(putObjectInput);
      const response = await this.client.send(command);

      // 存储ETag和objectName的映射
      if (!options?.forceUpload) {
        const bufferMD5 = await this.calculateBufferMD5(buffer);
        await this.storeDuplicate(bufferMD5, objectName);
      }

      // 直接返回文件信息，使用已知信息
      return {
        name: objectName,
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
    objectName: string,
    buffer: Buffer,
    bucket?: string,
    options?: UploadOptions,
  ): Promise<FileInfo> {
    try {
      const gzipAsync = promisify(gzip);
      const compressedBuffer = await gzipAsync(buffer);

      // Append .gz extension if not already present
      const gzippedObjectName = objectName.endsWith('.gz')
        ? objectName
        : `${objectName}.gz`;

      // 设置压缩相关的选项
      const gzipOptions: UploadOptions = {
        ...options,
        contentType: options?.contentType || 'application/gzip',
        metadata: {
          ...options?.metadata,
          'content-encoding': 'gzip',
          'original-size': buffer.length.toString(),
        },
      };

      return await this.uploadBuffer(
        gzippedObjectName,
        compressedBuffer,
        bucket,
        gzipOptions,
      );
    } catch (error: any) {
      throw new Error(`上传压缩缓冲区失败: ${error.message}`);
    }
  }

  async uploadStream(
    objectName: string,
    stream: Readable,
    size?: number,
    bucket?: string,
    options?: UploadOptions,
  ): Promise<FileInfo> {
    try {
      const bucketName = this.getBucketName(bucket);
      const putObjectInput: PutObjectCommandInput = {
        Bucket: bucketName,
        Key: objectName,
        Body: stream,
      };

      if (size) {
        putObjectInput.ContentLength = size;
      }

      if (options?.contentType) {
        putObjectInput.ContentType = options.contentType;
      }

      if (options?.metadata) {
        putObjectInput.Metadata = options.metadata;
      }

      if (options?.acl) {
        putObjectInput.ACL = options.acl;
      }

      const command = new PutObjectCommand(putObjectInput);
      const response = await this.client.send(command);

      // 直接返回文件信息，使用已知信息
      return {
        name: objectName,
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
    objectName: string,
    filePath: string,
    bucket?: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    try {
      // 如果不是强制上传，先检查是否已存在
      if (!options?.forceUpload) {
        const fileMD5 = await this.calculateFileMD5(filePath);
        const existingObjectName = await this.checkDuplicate(fileMD5);
        if (existingObjectName) {
          // 验证文件是否仍然存在于S3中
          const exists = await this.fileExists(existingObjectName, bucket);
          if (exists) {
            return {
              etag: fileMD5,
              objectName: existingObjectName,
              wasUploaded: false,
            };
          }
        }
      }

      // 实际上传文件
      const fileInfo = await this.uploadFile(objectName, filePath, bucket, {
        ...options,
        forceUpload: true, // 避免重复检查
      });

      return {
        etag: fileInfo.etag,
        objectName,
        wasUploaded: true,
      };
    } catch (error: any) {
      throw new Error(`高级上传文件失败: ${error.message}`);
    }
  }

  async uploadBufferAdvanced(
    objectName: string,
    buffer: Buffer,
    bucket?: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    try {
      // 如果不是强制上传，先检查是否已存在
      if (!options?.forceUpload) {
        const bufferMD5 = await this.calculateBufferMD5(buffer);
        const existingObjectName = await this.checkDuplicate(bufferMD5);
        if (existingObjectName) {
          // 验证文件是否仍然存在于S3中
          const exists = await this.fileExists(existingObjectName, bucket);
          if (exists) {
            return {
              etag: bufferMD5,
              objectName: existingObjectName,
              wasUploaded: false,
            };
          }
        }
      }

      // 实际上传buffer
      const fileInfo = await this.uploadBuffer(objectName, buffer, bucket, {
        ...options,
        forceUpload: true, // 避免重复检查
      });

      return {
        etag: fileInfo.etag,
        objectName,
        wasUploaded: true,
      };
    } catch (error: any) {
      throw new Error(`高级上传缓冲区失败: ${error.message}`);
    }
  }

  async uploadFileGzip(
    objectName: string,
    filePath: string,
    bucket?: string,
    options?: UploadOptions,
  ): Promise<FileInfo> {
    try {
      const fileStream = fs.createReadStream(filePath);
      const gzipStream = createGzip();
      const bucketName = this.getBucketName(bucket);

      // Append .gz extension if not already present
      const gzippedObjectName = objectName.endsWith('.gz')
        ? objectName
        : `${objectName}.gz`;

      // Note: Cannot easily get the gzipped size before uploading the stream.
      // The S3 client will handle chunking and multi-part uploads if necessary.

      // Set compression related options
      const gzipOptions: UploadOptions = {
        ...options,
        contentType: options?.contentType || 'application/gzip',
        metadata: {
          ...options?.metadata,
          'content-encoding': 'gzip',
          // Optionally add original size if known, but it's not directly available from a stream
        },
      };

      return await this.uploadStream(
        gzippedObjectName,
        fileStream.pipe(gzipStream),
        undefined, // Size is unknown for gzipped stream
        bucketName,
        gzipOptions,
      );
    } catch (error: any) {
      throw new Error(`上传并压缩文件失败: ${error.message}`);
    }
  }

  // 文件下载
  async downloadFile(
    objectName: string,
    filePath: string,
    bucket?: string,
  ): Promise<void> {
    try {
      const stream = await this.downloadStream(objectName, bucket);
      const writeStream = fs.createWriteStream(filePath);

      return new Promise((resolve, reject) => {
        stream.pipe(writeStream);
        stream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);
      });
    } catch (error: any) {
      throw new Error(`下载文件失败: ${error.message}`);
    }
  }

  async downloadFileGunzip(
    objectName: string,
    filePath: string,
    bucket?: string,
  ): Promise<void> {
    try {
      const downloadStream = await this.downloadStream(objectName, bucket);
      const gunzipStream = createGunzip();

      // Determine the actual file path, removing .gz if present in objectName
      const finalFilePath =
        objectName.endsWith('.gz') && filePath.endsWith('.gz')
          ? filePath.slice(0, -3) // Remove .gz from filePath
          : filePath;

      const writeStream = fs.createWriteStream(finalFilePath);

      return new Promise((resolve, reject) => {
        downloadStream.pipe(gunzipStream).pipe(writeStream);
        downloadStream.on('error', reject);
        gunzipStream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);
      });
    } catch (error: any) {
      throw new Error(`下载并解压文件失败: ${error.message}`);
    }
  }

  async downloadBuffer(objectName: string, bucket?: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.getBucketName(bucket),
        Key: objectName,
      });
      const response = await this.client.send(command);

      const bodyContents = await response.Body!.transformToByteArray();
      return Buffer.from(bodyContents);
    } catch (error: any) {
      throw new Error(`下载到缓冲区失败: ${error.message}`);
    }
  }

  async downloadBufferGunzip(
    objectName: string,
    bucket?: string,
  ): Promise<Buffer> {
    try {
      const compressedBuffer = await this.downloadBuffer(objectName, bucket);
      const gunzipAsync = promisify(gunzip);
      const decompressedBuffer = await gunzipAsync(compressedBuffer);

      return decompressedBuffer;
    } catch (error: any) {
      throw new Error(`下载解压缓冲区失败: ${error.message}`);
    }
  }

  async downloadStream(objectName: string, bucket?: string): Promise<Readable> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.getBucketName(bucket),
        Key: objectName,
      });
      const response = await this.client.send(command);

      if (response.Body instanceof Readable) {
        return response.Body;
      } else {
        // 将其他类型转换为 Readable
        const bodyContents = await response.Body!.transformToByteArray();
        const readable = new Readable();
        readable.push(Buffer.from(bodyContents));
        readable.push(null);
        return readable;
      }
    } catch (error: any) {
      throw new Error(`获取下载流失败: ${error.message}`);
    }
  }

  // 文件信息和列表
  async getFileInfo(objectName: string, bucket?: string): Promise<FileInfo> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.getBucketName(bucket),
        Key: objectName,
      });
      const response = await this.client.send(command);

      return {
        name: objectName,
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
      const bucketName = this.getBucketName(bucket);
      const objects: S3Object[] = [];
      let continuationToken: string | undefined;

      do {
        const command = new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: prefix,
          Delimiter: recursive ? undefined : '/',
          ContinuationToken: continuationToken,
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
          for (const commonPrefix of response.CommonPrefixes) {
            objects.push({
              prefix: commonPrefix.Prefix,
              name: commonPrefix.Prefix,
            });
          }
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      return objects;
    } catch (error: any) {
      throw new Error(`列出文件失败: ${error.message}`);
    }
  }

  async fileExists(objectName: string, bucket?: string): Promise<boolean> {
    try {
      await this.getFileInfo(objectName, bucket);
      return true;
    } catch (error: any) {
      if (error.message.includes('NotFound') || error.message.includes('404')) {
        return false;
      }
      throw new Error(`检查文件存在性失败: ${error.message}`);
    }
  }

  // 新增函数：获取指定对象的 ETag
  async getObjectETag(objectName: string, bucket?: string): Promise<string> {
    try {
      const fileInfo = await this.getFileInfo(objectName, bucket);
      // ETag 通常被双引号包围，这里移除双引号以保持和 PutObjectCommand 返回的格式一致
      return fileInfo.etag.replace(/"/g, '');
    } catch (error: any) {
      throw new Error(`获取对象 ${objectName} 的 ETag 失败: ${error.message}`);
    }
  }

  // 新增函数：上传文件并返回 ETag
  async uploadFileAndGetETag(
    objectName: string,
    filePath: string,
    bucket?: string,
    options?: UploadOptions,
  ): Promise<string> {
    try {
      // uploadFile 方法返回 FileInfo，提取 etag
      const fileInfo = await this.uploadFile(
        objectName,
        filePath,
        bucket,
        options,
      );
      return fileInfo.etag;
    } catch (error: any) {
      throw new Error(
        `上传文件 ${filePath} 并获取 ETag 失败: ${error.message}`,
      );
    }
  }

  // 新增函数：计算本地文件的 MD5 Hash
  async calculateFileMD5(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => {
        hash.update(data);
      });

      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });

      stream.on('error', (err) => {
        reject(new Error(`计算文件 ${filePath} 的 MD5 失败: ${err.message}`));
      });
    });
  }

  // 新增函数：计算 Buffer 的 MD5 Hash
  async calculateBufferMD5(buffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const hash = crypto.createHash('md5');
        hash.update(buffer);
        resolve(hash.digest('hex'));
      } catch (err: any) {
        reject(new Error(`计算 Buffer 的 MD5 失败: ${err.message}`));
      }
    });
  }

  // 文件操作
  async deleteFile(objectName: string, bucket?: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.getBucketName(bucket),
        Key: objectName,
      });
      await this.client.send(command);
    } catch (error: any) {
      throw new Error(`删除文件失败: ${error.message}`);
    }
  }

  async deleteFiles(
    objectNames: string[],
    bucket?: string,
  ): Promise<BatchResult<string>> {
    const bucketName = this.getBucketName(bucket);
    const successful: string[] = [];
    const failed: Array<{ item: string; error: string }> = [];

    try {
      const command = new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: objectNames.map((key) => ({ Key: key })),
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
      for (const objectName of objectNames) {
        try {
          await this.deleteFile(objectName, bucket);
          successful.push(objectName);
        } catch (err: any) {
          failed.push({ item: objectName, error: err.message });
        }
      }
    }

    return { successful, failed };
  }

  async copyFile(
    sourceObject: string,
    destObject: string,
    sourceBucket?: string,
    destBucket?: string,
  ): Promise<void> {
    try {
      const srcBucket = this.getBucketName(sourceBucket);
      const dstBucket = this.getBucketName(destBucket);

      const command = new CopyObjectCommand({
        Bucket: dstBucket,
        Key: destObject,
        CopySource: `${srcBucket}/${sourceObject}`,
      });

      await this.client.send(command);
    } catch (error: any) {
      throw new Error(`复制文件失败: ${error.message}`);
    }
  }

  async moveFile(
    sourceObject: string,
    destObject: string,
    sourceBucket?: string,
    destBucket?: string,
  ): Promise<void> {
    try {
      // 先复制
      await this.copyFile(sourceObject, destObject, sourceBucket, destBucket);
      // 再删除源文件
      await this.deleteFile(sourceObject, sourceBucket);
    } catch (error: any) {
      throw new Error(`移动文件失败: ${error.message}`);
    }
  }

  // URL 生成
  async getPresignedDownloadUrl(
    objectName: string,
    expiry: number = 24 * 60 * 60,
    bucket?: string,
  ): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.getBucketName(bucket),
        Key: objectName,
      });

      return await getSignedUrl(this.client, command, { expiresIn: expiry });
    } catch (error: any) {
      throw new Error(`获取下载URL失败: ${error.message}`);
    }
  }

  async getPresignedUploadUrl(
    objectName: string,
    expiry: number = 24 * 60 * 60,
    bucket?: string,
  ): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.getBucketName(bucket),
        Key: objectName,
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
      const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);
      return {
        objectCount: files.length,
        totalSize,
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
      const objectNames = files.map((file) => file.name!).filter(Boolean);

      if (objectNames.length === 0) {
        return { successful: [], failed: [] };
      }

      return await this.deleteFiles(objectNames, bucket);
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
  async cleanupInvalidCache(
    bucket?: string,
    batchSize: number = 100,
  ): Promise<{ cleaned: number; failed: number }> {
    try {
      // 这个方法需要KVDatabase支持列举所有键值对
      // 由于当前接口不支持，这里提供一个基本实现框架
      console.warn(
        'cleanupInvalidCache requires KVDatabase to support iteration over all keys',
      );
      return { cleaned: 0, failed: 0 };
    } catch (error: any) {
      throw new Error(`清理失效缓存失败: ${error.message}`);
    }
  }

  // 手动移除缓存条目
  async removeCacheEntry(etag: string): Promise<void> {
    try {
      // 注意：这需要KVDatabase支持删除操作
      // 当前接口只有get和put，可能需要扩展接口
      console.warn(
        'removeCacheEntry requires KVDatabase to support delete operation',
      );
    } catch (error: any) {
      throw new Error(`移除缓存条目失败: ${error.message}`);
    }
  }
}
