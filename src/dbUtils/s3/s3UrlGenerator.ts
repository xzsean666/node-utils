// S3UrlGenerator - 签名 URL 生成器
// 支持生成下载 URL 和上传 URL（一次性 / 可重复使用），均可设置有效期
// 使用组合模式，依赖 S3Helper 实例的公开 API

import * as fs from 'fs';
import * as crypto from 'crypto';
import { S3Helper } from './s3Helper';
import type {
    GenerateUrlOptions,
    SignedUrlResult,
    SignedUrlSummary,
    PresignedUploadUrlOptions,
    PresignedUploadUrlResult,
} from './s3Types';

export class S3UrlGenerator {
    private helper: S3Helper;

    constructor(helper: S3Helper) {
        this.helper = helper;
    }

    // ============================================================
    // 上传 URL 生成
    // ============================================================

    /**
     * 生成一次性上传 URL
     *
     * S3 预签名 URL 在生成时必须确定 object key（这是签名的一部分，不可更改）。
     * 本方法通过服务端生成 UUID key 来实现「调用方无需预先知道文件名」的效果：
     * 服务端决定 key，客户端只管往 uploadUrl 上传文件，上传成功后用 objectName 访问结果。
     *
     * @param prefix  - S3 路径前缀，如 `'uploads/images'`；传空字符串则不加前缀
     * @param options - 上传选项（含可选的 fileName 和 ext）
     *   - `fileName`：文件名（如 `'photo.jpg'`），会拼在 UUID 后面，可省略
     *   - `ext`：扩展名（如 `'.jpg'`），fileName 省略时可单独指定，如 `'.jpg'`
     *   - `expiry`：有效期（秒），默认 3600
     *   - `contentType`：限制客户端只能上传指定 MIME 类型
     * @returns 包含 `uploadUrl`（客户端用于 PUT）和 `objectName`（上传成功后的访问路径）
     *
     * @example
     * // 指定文件名（UUID 前缀防覆盖）
     * const r1 = await urlGen.generateOneTimeUploadUrl('uploads', {
     *   fileName: 'photo.jpg',
     *   expiry: 3600,
     *   contentType: 'image/jpeg',
     * });
     * // r1.objectName -> 'uploads/<uuid>-photo.jpg'
     *
     * // 只指定扩展名，不关心文件名
     * const r2 = await urlGen.generateOneTimeUploadUrl('uploads/avatars', {
     *   ext: '.png',
     *   expiry: 1800,
     * });
     * // r2.objectName -> 'uploads/avatars/<uuid>.png'
     *
     * // 完全不指定文件名，纯 UUID key
     * const r3 = await urlGen.generateOneTimeUploadUrl('uploads/raw', {
     *   expiry: 600,
     * });
     * // r3.objectName -> 'uploads/raw/<uuid>'
     */
    async generateOneTimeUploadUrl(
        prefix: string,
        options?: PresignedUploadUrlOptions & {
            /** 文件名（如 'photo.jpg'），会拼在 UUID 后面 */
            fileName?: string;
            /** 扩展名（如 '.jpg'），fileName 省略时可单独指定 */
            ext?: string;
        },
    ): Promise<PresignedUploadUrlResult> {
        const expiry = options?.expiry ?? 3600;
        const uuid = crypto.randomUUID();

        // 构建 key 尾部：优先用 fileName，其次用 ext，最后纯 UUID
        const suffix = options?.fileName
            ? `-${options.fileName}`
            : options?.ext
                ? `${options.ext.startsWith('.') ? options.ext : `.${options.ext}`}`
                : '';

        const key = `${uuid}${suffix}`;
        const object_name = prefix ? `${prefix}/${key}` : key;

        try {
            const upload_url = await this.helper.getPresignedUploadUrl(
                object_name,
                expiry,
                options?.bucket,
                options?.contentType,
            );

            return {
                uploadUrl: upload_url,
                objectName: object_name,
                expiresAt: new Date(Date.now() + expiry * 1000),
                expirySeconds: expiry,
                oneTime: true,
            };
        } catch (error: any) {
            throw new Error(`生成一次性上传URL失败: ${error.message}`);
        }
    }

    /**
     * 生成可重复使用的上传 URL
     * 使用固定的 S3 key，在有效期内可反复使用同一 URL 上传（会覆盖同名文件）
     *
     * @param objectName - 固定的 S3 object key
     * @param options - 上传选项
     * @returns 包含上传 URL 和元信息的结果
     *
     * @example
     * const urlGen = new S3UrlGenerator(s3Helper);
     * const result = await urlGen.generateReusableUploadUrl('avatars/user-123.png', {
     *   expiry: 86400, // 24 小时内可反复使用
     *   contentType: 'image/png',
     * });
     */
    async generateReusableUploadUrl(
        objectName: string,
        options?: PresignedUploadUrlOptions,
    ): Promise<PresignedUploadUrlResult> {
        const expiry = options?.expiry ?? 3600;

        try {
            const upload_url = await this.helper.getPresignedUploadUrl(
                objectName,
                expiry,
                options?.bucket,
                options?.contentType,
            );

            return {
                uploadUrl: upload_url,
                objectName: objectName,
                expiresAt: new Date(Date.now() + expiry * 1000),
                expirySeconds: expiry,
                oneTime: false,
            };
        } catch (error: any) {
            throw new Error(`生成可重复使用上传URL失败: ${error.message}`);
        }
    }

    /**
     * 批量生成一次性上传 URL
     *
     * @param prefix - S3 key 前缀
     * @param items  - 文件描述列表，每项传给 `generateOneTimeUploadUrl` 的 options
     * @param shared - 共享选项（expiry / contentType / bucket），会被 items 中的选项覆盖
     * @returns 每个文件的上传 URL 结果数组
     *
     * @example
     * // 批量指定文件名
     * const results = await urlGen.generateBatchOneTimeUploadUrls('uploads', [
     *   { fileName: 'photo1.jpg', contentType: 'image/jpeg' },
     *   { fileName: 'photo2.png', contentType: 'image/png' },
     *   { ext: '.pdf' },          // 只指定扩展名
     *   {},                       // 纯 UUID key
     * ], { expiry: 7200 });
     */
    async generateBatchOneTimeUploadUrls(
        prefix: string,
        items: Array<PresignedUploadUrlOptions & { fileName?: string; ext?: string }>,
        shared?: PresignedUploadUrlOptions,
    ): Promise<PresignedUploadUrlResult[]> {
        return Promise.all(
            items.map((item) =>
                this.generateOneTimeUploadUrl(prefix, { ...shared, ...item }),
            ),
        );
    }

    // ============================================================
    // 下载 URL 生成
    // ============================================================

    /**
     * 为单个文件生成签名下载 URL
     */
    async generateForFile(
        objectName: string,
        options?: Omit<GenerateUrlOptions, 'prefix'>,
    ): Promise<SignedUrlResult> {
        const opts = this.resolveOptions(options);

        try {
            const exists = await this.helper.fileExists(objectName, opts.bucket);
            if (!exists) {
                return { objectName, error: 'File does not exist' };
            }

            return await this.generateUrlsForObject(objectName, opts);
        } catch (error: any) {
            return { objectName, error: error.message };
        }
    }

    // ============================================================
    // 批量生成（写入 JSON）
    // ============================================================

    /**
     * 为 bucket 中所有文件生成签名 URL 并写入 JSON
     */
    async generateToJson(
        output_json_path: string,
        options?: GenerateUrlOptions & { batchSize?: number },
    ): Promise<SignedUrlSummary> {
        const opts = this.resolveOptions(options);
        const batch_size = (options as any)?.batchSize || 100;

        try {
            const files = await this.helper.listFiles(opts.prefix, opts.bucket, true);
            const file_objects = files
                .filter((f) => f.name && !f.name.endsWith('/'))
                .map((f) => f.name!);

            const { results, successful_urls, failed_urls } =
                await this.processBatches(file_objects, opts, batch_size);

            const output = {
                generatedAt: new Date().toISOString(),
                bucket: this.helper.getBucketName(opts.bucket),
                prefix: opts.prefix || '',
                expiry: opts.expiry,
                batchSize: batch_size,
                summary: {
                    totalFiles: file_objects.length,
                    successfulUrls: successful_urls,
                    failedUrls: failed_urls,
                },
                files: results,
            };

            await fs.promises.writeFile(
                output_json_path,
                JSON.stringify(output, null, 2),
                'utf8',
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

    /**
     * 批量为指定文件列表生成签名 URL 并写入 JSON
     */
    async generateForFilesToJson(
        object_names: string[],
        output_json_path: string,
        options?: GenerateUrlOptions & { batchSize?: number },
    ): Promise<SignedUrlSummary> {
        const opts = this.resolveOptions(options);
        const batch_size = (options as any)?.batchSize || 25;

        try {
            const { results, successful_urls, failed_urls } =
                await this.processBatches(object_names, opts, batch_size, true);

            const output = {
                generatedAt: new Date().toISOString(),
                bucket: this.helper.getBucketName(opts.bucket),
                expiry: opts.expiry,
                batchSize: batch_size,
                summary: {
                    totalFiles: object_names.length,
                    successfulUrls: successful_urls,
                    failedUrls: failed_urls,
                },
                files: results,
            };

            await fs.promises.writeFile(
                output_json_path,
                JSON.stringify(output, null, 2),
                'utf8',
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

    // ============================================================
    // 私有方法
    // ============================================================

    /** 解析默认选项 */
    private resolveOptions(
        options?: Partial<GenerateUrlOptions>,
    ): Required<
        Pick<GenerateUrlOptions, 'downloadUrls' | 'uploadUrls' | 'includeMetadata' | 'simplify' | 'expiry'>
    > &
        Pick<GenerateUrlOptions, 'bucket' | 'prefix'> {
        const opts = {
            downloadUrls: true,
            uploadUrls: false,
            includeMetadata: false,
            simplify: false,
            expiry: 24 * 60 * 60,
            ...options,
        };

        if (opts.simplify) {
            opts.downloadUrls = true;
            opts.uploadUrls = false;
            opts.includeMetadata = false;
        }

        return opts;
    }

    /** 为单个对象生成签名 URL（核心逻辑） */
    private async generateUrlsForObject(
        objectName: string,
        opts: ReturnType<typeof this.resolveOptions>,
    ): Promise<SignedUrlResult> {
        const result: SignedUrlResult = { objectName };

        // 简化模式：只生成下载 URL
        if (opts.simplify) {
            try {
                result.downloadUrl = await this.helper.getPresignedDownloadUrl(
                    objectName,
                    opts.expiry,
                    opts.bucket,
                );
            } catch (error: any) {
                result.error = error.message;
            }
            return result;
        }

        // 完整模式：并行执行
        const operations: Promise<
            { type: string; value?: any; error?: string }
        >[] = [];

        if (opts.downloadUrls) {
            operations.push(
                this.helper
                    .getPresignedDownloadUrl(objectName, opts.expiry, opts.bucket)
                    .then((url) => ({ type: 'downloadUrl', value: url }))
                    .catch((e) => ({ type: 'downloadUrl', error: e.message })),
            );
        }

        if (opts.uploadUrls) {
            operations.push(
                this.helper
                    .getPresignedUploadUrl(objectName, opts.expiry, opts.bucket)
                    .then((url) => ({ type: 'uploadUrl', value: url }))
                    .catch((e) => ({ type: 'uploadUrl', error: e.message })),
            );
        }

        if (opts.includeMetadata) {
            operations.push(
                this.helper
                    .getFileInfo(objectName, opts.bucket)
                    .then((info) => ({
                        type: 'metadata',
                        value: {
                            size: info.size,
                            lastModified: info.lastModified,
                            etag: info.etag,
                            contentType: info.contentType,
                        },
                    }))
                    .catch((e) => ({ type: 'metadata', error: e.message })),
            );
        }

        const operation_results = await Promise.all(operations);
        const errors: string[] = [];

        for (const opResult of operation_results) {
            if (opResult.error) {
                errors.push(`${opResult.type} failed: ${opResult.error}`);
            } else if (opResult.type === 'downloadUrl') {
                result.downloadUrl = opResult.value;
            } else if (opResult.type === 'uploadUrl') {
                result.uploadUrl = opResult.value;
            } else if (opResult.type === 'metadata') {
                result.metadata = opResult.value;
            }
        }

        if (errors.length > 0) {
            result.error = errors.join('; ');
        }

        return result;
    }

    /** 批量处理文件 */
    private async processBatches(
        objectNames: string[],
        opts: ReturnType<typeof this.resolveOptions>,
        batchSize: number,
        checkExists: boolean = false,
    ): Promise<{
        results: SignedUrlResult[];
        successful_urls: number;
        failed_urls: number;
    }> {
        const results: SignedUrlResult[] = [];
        let successful_urls = 0;
        let failed_urls = 0;

        for (let i = 0; i < objectNames.length; i += batchSize) {
            const batch = objectNames.slice(i, i + batchSize);

            try {
                const batch_promises = batch.map(async (objectName) => {
                    try {
                        if (checkExists) {
                            const exists = await this.helper.fileExists(
                                objectName,
                                opts.bucket,
                            );
                            if (!exists) {
                                return { objectName, error: 'File does not exist' } as SignedUrlResult;
                            }
                        }

                        return await this.generateUrlsForObject(objectName, opts);
                    } catch (error: any) {
                        return { objectName, error: error.message } as SignedUrlResult;
                    }
                });

                const batch_results = await Promise.all(batch_promises);

                for (const result of batch_results) {
                    if (result.error) {
                        failed_urls++;
                    } else {
                        successful_urls++;
                    }
                    results.push(result);
                }
            } catch (error: any) {
                for (const objectName of batch) {
                    results.push({
                        objectName,
                        error: `Batch processing failed: ${error.message}`,
                    });
                    failed_urls++;
                }
            }
        }

        return { results, successful_urls, failed_urls };
    }
}
