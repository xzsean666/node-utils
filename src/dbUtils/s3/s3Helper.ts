// S3Helper - 核心 S3 操作类（精简版）
// 提供 bucket 管理、文件上传/下载/删除/列表、签名 URL、防重复上传等基础能力
// 不依赖外部数据库，使用内存 Map 实现防重复上传
//
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
    type CreateBucketCommandInput,
    type PutObjectCommandInput,
    type BucketLocationConstraint,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { gzip, createGzip, createGunzip } from 'zlib';
import { promisify } from 'util';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';

import {
    type S3Config,
    type UploadOptions,
    type UploadResult,
    type FileInfo,
    type S3Object,
    type BatchResult,
    S3Provider,
    PROVIDER_CONFIGS,
    MAX_DELETE_OBJECTS_PER_REQUEST,
} from './s3Types';

export class S3Helper {
    private client: S3Client;
    private config: S3Config;
    private defaultBucket?: string;

    /**
     * 内存防重复上传缓存：MD5 -> objectName
     * 用于同一进程生命周期内避免重复上传相同内容
     */
    private dedupCache: Map<string, string> = new Map();

    constructor(config: S3Config) {
        const provider_defaults = PROVIDER_CONFIGS[config.provider] || {};
        this.config = { ...provider_defaults, ...config };

        if (
            !this.config.endPoint ||
            !this.config.accessKey ||
            !this.config.secretKey
        ) {
            throw new Error(
                'Missing required S3 configuration: endPoint, accessKey, secretKey',
            );
        }

        const protocol = (this.config.useSSL ?? true) ? 'https' : 'http';
        const default_port = this.config.useSSL !== false ? 443 : 80;
        const port = this.config.port || default_port;
        const endpoint = `${protocol}://${this.config.endPoint}${port !== default_port ? `:${port}` : ''
            }`;

        this.client = new S3Client({
            endpoint,
            region: this.config.region || 'us-east-1',
            credentials: {
                accessKeyId: this.config.accessKey,
                secretAccessKey: this.config.secretKey,
            },
            forcePathStyle: this.config.provider !== S3Provider.AWS_S3,
        });

        this.defaultBucket = config.bucket;
    }

    // ============================================================
    // 静态工厂方法
    // ============================================================

    static createAWS(
        accessKey: string,
        secretKey: string,
        bucket?: string,
        region: string = 'us-east-1',
    ): S3Helper {
        return new S3Helper({
            provider: S3Provider.AWS_S3,
            endPoint: `s3.${region}.amazonaws.com`,
            accessKey,
            secretKey,
            region,
            bucket,
        });
    }

    static createBackblazeB2(
        applicationKeyId: string,
        applicationKey: string,
        bucketEndpoint: string,
        bucket?: string,
    ): S3Helper {
        return new S3Helper({
            provider: S3Provider.BACKBLAZE_B2,
            endPoint: bucketEndpoint,
            accessKey: applicationKeyId,
            secretKey: applicationKey,
            bucket,
        });
    }

    static createCloudflareR2(
        accessKeyId: string,
        secretAccessKey: string,
        accountId: string,
        bucket?: string,
    ): S3Helper {
        return new S3Helper({
            provider: S3Provider.CLOUDFLARE_R2,
            endPoint: `${accountId}.r2.cloudflarestorage.com`,
            accessKey: accessKeyId,
            secretKey: secretAccessKey,
            bucket,
        });
    }

    static createMinIO(
        accessKey: string,
        secretKey: string,
        endPoint: string,
        bucket?: string,
        useSSL: boolean = false,
        port?: number,
    ): S3Helper {
        return new S3Helper({
            provider: S3Provider.MINIO,
            endPoint,
            port,
            useSSL,
            accessKey,
            secretKey,
            bucket,
        });
    }

    // ============================================================
    // Bucket 操作
    // ============================================================

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

    // ============================================================
    // 文件上传（内置防重复逻辑）
    // ============================================================

    /**
     * 上传本地文件到 S3
     * 默认启用防重复上传：计算文件 MD5，若内存缓存命中且 S3 上文件仍存在则跳过
     */
    async uploadFile(
        object_name: string,
        file_path: string,
        bucket?: string,
        options?: UploadOptions,
    ): Promise<UploadResult> {
        try {
            if (!options?.forceUpload) {
                const file_md5 = await this.calculateFileMD5(file_path);
                const cached = this.dedupCache.get(file_md5);
                if (cached) {
                    const exists = await this.fileExists(cached, bucket);
                    if (exists) {
                        return { etag: file_md5, objectName: cached, wasUploaded: false };
                    }
                }

                const file_info = await this.doUploadFile(object_name, file_path, bucket, options);
                this.dedupCache.set(file_md5, object_name);
                return { etag: file_info.etag, objectName: object_name, wasUploaded: true };
            }

            const file_info = await this.doUploadFile(object_name, file_path, bucket, options);
            return { etag: file_info.etag, objectName: object_name, wasUploaded: true };
        } catch (error: any) {
            throw new Error(`上传文件失败: ${error.message}`);
        }
    }

    /**
     * 上传 Buffer 到 S3
     * 默认启用防重复上传
     */
    async uploadBuffer(
        object_name: string,
        buffer: Buffer,
        bucket?: string,
        options?: UploadOptions,
    ): Promise<UploadResult> {
        try {
            if (!options?.forceUpload) {
                const buffer_md5 = this.calculateBufferMD5(buffer);
                const cached = this.dedupCache.get(buffer_md5);
                if (cached) {
                    const exists = await this.fileExists(cached, bucket);
                    if (exists) {
                        return { etag: buffer_md5, objectName: cached, wasUploaded: false };
                    }
                }

                const file_info = await this.doUploadBuffer(object_name, buffer, bucket, options);
                this.dedupCache.set(buffer_md5, object_name);
                return { etag: file_info.etag, objectName: object_name, wasUploaded: true };
            }

            const file_info = await this.doUploadBuffer(object_name, buffer, bucket, options);
            return { etag: file_info.etag, objectName: object_name, wasUploaded: true };
        } catch (error: any) {
            throw new Error(`上传缓冲区失败: ${error.message}`);
        }
    }

    /**
     * 上传 Buffer 并 gzip 压缩
     */
    async uploadBufferGzip(
        object_name: string,
        buffer: Buffer,
        bucket?: string,
        options?: UploadOptions,
    ): Promise<UploadResult> {
        try {
            const gzip_async = promisify(gzip);
            const compressed_buffer = await gzip_async(buffer);

            const gzipped_object_name = object_name.endsWith('.gz')
                ? object_name
                : `${object_name}.gz`;

            const gzip_options: UploadOptions = {
                ...options,
                contentType: options?.contentType || 'application/gzip',
                metadata: {
                    ...options?.metadata,
                    'content-encoding': 'gzip',
                    'original-size': buffer.length.toString(),
                },
            };

            return await this.uploadBuffer(gzipped_object_name, compressed_buffer, bucket, gzip_options);
        } catch (error: any) {
            throw new Error(`上传压缩缓冲区失败: ${error.message}`);
        }
    }

    /**
     * 上传流到 S3（不支持防重复，流无法预先算 MD5）
     */
    async uploadStream(
        object_name: string,
        stream: Readable,
        size?: number,
        bucket?: string,
        options?: UploadOptions,
    ): Promise<FileInfo> {
        try {
            const bucket_name = this.getBucketName(bucket);
            const put_input = this.buildPutObjectInput(bucket_name, object_name, stream, options);

            if (size) {
                put_input.ContentLength = size;
            }

            const command = new PutObjectCommand(put_input);
            const response = await this.client.send(command);

            return {
                name: object_name,
                size,
                lastModified: new Date(),
                etag: this.normalizeETag(response.ETag || ''),
                contentType: options?.contentType,
                metadata: options?.metadata,
            };
        } catch (error: any) {
            throw new Error(`上传流失败: ${error.message}`);
        }
    }

    /**
     * 上传文件并 gzip 压缩（流式处理，内存友好）
     */
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

            const gzipped_object_name = object_name.endsWith('.gz')
                ? object_name
                : `${object_name}.gz`;

            const gzip_options: UploadOptions = {
                ...options,
                contentType: options?.contentType || 'application/gzip',
                metadata: {
                    ...options?.metadata,
                    'content-encoding': 'gzip',
                },
            };

            return await this.uploadStream(
                gzipped_object_name,
                file_stream.pipe(gzip_stream),
                undefined,
                bucket_name,
                gzip_options,
            );
        } catch (error: any) {
            throw new Error(`上传并压缩文件失败: ${error.message}`);
        }
    }

    // ============================================================
    // 文件下载
    // ============================================================

    async downloadFile(
        object_name: string,
        file_path: string,
        bucket?: string,
    ): Promise<void> {
        try {
            const dir = path.dirname(file_path);
            await fs.promises.mkdir(dir, { recursive: true });

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

            const final_file_path =
                object_name.endsWith('.gz') && file_path.endsWith('.gz')
                    ? file_path.slice(0, -3)
                    : file_path;

            const dir = path.dirname(final_file_path);
            await fs.promises.mkdir(dir, { recursive: true });

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
            const gunzip_async = promisify(
                require('zlib').gunzip as typeof import('zlib').gunzip,
            );
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

    // ============================================================
    // 文件信息和列表
    // ============================================================

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
            const command = new HeadObjectCommand({
                Bucket: this.getBucketName(bucket),
                Key: object_name,
            });
            await this.client.send(command);
            return true;
        } catch (error: any) {
            if (
                error.name === 'NotFound' ||
                error.$metadata?.httpStatusCode === 404 ||
                error.name === 'NoSuchKey'
            ) {
                return false;
            }
            throw new Error(`检查文件存在性失败: ${error.message}`);
        }
    }

    async getObjectETag(object_name: string, bucket?: string): Promise<string> {
        try {
            const file_info = await this.getFileInfo(object_name, bucket);
            return file_info.etag;
        } catch (error: any) {
            throw new Error(`获取对象 ${object_name} 的 ETag 失败: ${error.message}`);
        }
    }

    // ============================================================
    // 文件操作
    // ============================================================

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

        for (
            let i = 0;
            i < object_names.length;
            i += MAX_DELETE_OBJECTS_PER_REQUEST
        ) {
            const batch = object_names.slice(i, i + MAX_DELETE_OBJECTS_PER_REQUEST);

            try {
                const command = new DeleteObjectsCommand({
                    Bucket: bucket_name,
                    Delete: {
                        Objects: batch.map((key) => ({ Key: key })),
                        Quiet: false,
                    },
                });

                const response = await this.client.send(command);

                if (response.Deleted) {
                    for (const deleted of response.Deleted) {
                        if (deleted.Key) {
                            successful.push(deleted.Key);
                        }
                    }
                }

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
                // 批量删除失败时，逐个删除
                for (const object_name of batch) {
                    try {
                        await this.deleteFile(object_name, bucket);
                        successful.push(object_name);
                    } catch (err: any) {
                        failed.push({ item: object_name, error: err.message });
                    }
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
            await this.copyFile(source_object, dest_object, source_bucket, dest_bucket);
            await this.deleteFile(source_object, source_bucket);
        } catch (error: any) {
            throw new Error(`移动文件失败: ${error.message}`);
        }
    }

    // ============================================================
    // 签名 URL
    // ============================================================

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
        contentType?: string,
    ): Promise<string> {
        try {
            const put_input: PutObjectCommandInput = {
                Bucket: this.getBucketName(bucket),
                Key: object_name,
            };

            if (contentType) {
                put_input.ContentType = contentType;
            }

            const command = new PutObjectCommand(put_input);
            return await getSignedUrl(this.client, command, { expiresIn: expiry });
        } catch (error: any) {
            throw new Error(`获取上传URL失败: ${error.message}`);
        }
    }

    // ============================================================
    // 工具方法
    // ============================================================

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

    /** 删除过期文件 */
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

            const allFiles = await this.listFiles(prefix, bucket_name, true);
            const file_objects = allFiles.filter(
                (f) => f.name && !f.name.endsWith('/'),
            );

            const expireTime = new Date(Date.now() - expireSeconds * 1000);
            const expired_files: string[] = [];

            for (const file of file_objects) {
                if (file.name && file.lastModified && file.lastModified < expireTime) {
                    expired_files.push(file.name);
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
                return result;
            }

            const deleteResult = await this.deleteFiles(expired_files, bucket_name);

            result.deletedFiles = deleteResult.successful.length;
            result.failedFiles = deleteResult.failed.length;
            result.errors = deleteResult.failed.map((f) => ({
                objectName: f.item,
                error: f.error,
            }));

            return result;
        } catch (error: any) {
            throw new Error(`删除过期文件失败: ${error.message}`);
        }
    }

    /** 获取客户端实例（高级用法） */
    getClient(): S3Client {
        return this.client;
    }

    /** 获取配置信息 */
    getConfig(): S3Config {
        return { ...this.config };
    }

    /** 清空防重复缓存 */
    clearDedupCache(): void {
        this.dedupCache.clear();
    }

    /** 获取防重复缓存大小 */
    getDedupCacheSize(): number {
        return this.dedupCache.size;
    }

    // ============================================================
    // 公开的工具方法（供 S3UrlGenerator 等使用）
    // ============================================================

    /** 获取 bucket 名称 */
    getBucketName(bucket?: string): string {
        const bucket_name = bucket || this.defaultBucket;
        if (!bucket_name) {
            throw new Error(
                'Bucket name is required. Provide it in the method call or set a default bucket in config.',
            );
        }
        return bucket_name;
    }

    /** 标准化 ETag 格式（移除双引号） */
    normalizeETag(etag: string): string {
        return etag.replace(/^"|"$/g, '');
    }

    /** 计算本地文件的 MD5 Hash */
    calculateFileMD5(file_path: string): Promise<string> {
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

    /** 计算 Buffer 的 MD5 Hash（同步） */
    calculateBufferMD5(buffer: Buffer): string {
        const md5_hash = crypto.createHash('md5');
        md5_hash.update(buffer);
        return md5_hash.digest('hex');
    }

    // ============================================================
    // 私有方法
    // ============================================================

    /** 构建 PutObjectInput */
    private buildPutObjectInput(
        bucket: string,
        key: string,
        body: Buffer | Readable,
        options?: UploadOptions,
    ): PutObjectCommandInput {
        const input: PutObjectCommandInput = {
            Bucket: bucket,
            Key: key,
            Body: body,
        };

        if (options?.contentType) {
            input.ContentType = options.contentType;
        }
        if (options?.metadata) {
            input.Metadata = options.metadata;
        }
        if (options?.acl) {
            input.ACL = options.acl;
        }

        return input;
    }

    /** 实际执行文件上传 */
    private async doUploadFile(
        object_name: string,
        file_path: string,
        bucket?: string,
        options?: UploadOptions,
    ): Promise<FileInfo> {
        const file_stream = fs.createReadStream(file_path);
        const stats = await fs.promises.stat(file_path);

        const upload_result = await this.uploadStream(
            object_name,
            file_stream,
            stats.size,
            bucket,
            options,
        );

        return {
            name: object_name,
            size: stats.size,
            lastModified: stats.mtime,
            etag: upload_result.etag,
            contentType: options?.contentType,
            metadata: options?.metadata,
        };
    }

    /** 实际执行 Buffer 上传 */
    private async doUploadBuffer(
        object_name: string,
        buffer: Buffer,
        bucket?: string,
        options?: UploadOptions,
    ): Promise<FileInfo> {
        const bucket_name = this.getBucketName(bucket);
        const put_input = this.buildPutObjectInput(bucket_name, object_name, buffer, options);

        const command = new PutObjectCommand(put_input);
        const response = await this.client.send(command);

        return {
            name: object_name,
            size: buffer.length,
            lastModified: new Date(),
            etag: this.normalizeETag(response.ETag || ''),
            contentType: options?.contentType,
            metadata: options?.metadata,
        };
    }
}
