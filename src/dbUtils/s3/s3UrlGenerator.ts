// S3UrlGenerator - 签名 URL 生成器
// 使用组合模式，依赖 S3Helper 实例的公开 API，不依赖 s3Sync / s3FolderUploader

import * as fs from 'fs';
import { S3Helper } from './s3Helper';
import type { GenerateUrlOptions, SignedUrlResult, SignedUrlSummary } from './s3Types';

export class S3UrlGenerator {
    private helper: S3Helper;

    constructor(helper: S3Helper) {
        this.helper = helper;
    }

    // ============================================================
    // 单个文件
    // ============================================================

    /** 为单个文件生成签名 URL */
    async generateForFile(
        objectName: string,
        options?: Omit<GenerateUrlOptions, 'prefix'>,
    ): Promise<SignedUrlResult> {
        const opts = this.resolveOptions(options);

        try {
            console.log(`🔗 Generating URLs for: ${objectName}`);

            // 先检查文件是否存在
            const exists = await this.helper.fileExists(objectName, opts.bucket);
            if (!exists) {
                console.error(`✗ File not found: ${objectName}`);
                return { objectName, error: 'File does not exist' };
            }

            return await this.generateUrlsForObject(objectName, opts);
        } catch (error: any) {
            console.error(
                `✗ Failed to generate URLs for: ${objectName} - ${error.message}`,
            );
            return { objectName, error: error.message };
        }
    }

    // ============================================================
    // 批量生成（写入 JSON）
    // ============================================================

    /** 为 bucket 中所有文件生成签名 URL 并写入 JSON */
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

            console.log(
                `Found ${file_objects.length} files to generate URLs for (batch size: ${batch_size})`,
            );

            const { results, successful_urls, failed_urls } =
                await this.processBatches(file_objects, opts, batch_size);

            // 写入 JSON 文件
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

    /** 批量为指定文件列表生成签名 URL 并写入 JSON */
    async generateForFilesToJson(
        object_names: string[],
        output_json_path: string,
        options?: GenerateUrlOptions & { batchSize?: number },
    ): Promise<SignedUrlSummary> {
        const opts = this.resolveOptions(options);
        const batch_size = (options as any)?.batchSize || 25;

        try {
            console.log(
                `Generating URLs for ${object_names.length} specified files (batch size: ${batch_size})`,
            );

            const { results, successful_urls, failed_urls } =
                await this.processBatches(
                    object_names,
                    opts,
                    batch_size,
                    true, // checkExists
                );

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

    /** 为单个对象生成签名 URL（核心逻辑，只执行一次） */
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
                console.log(`✓ Generated download URL for: ${objectName}`);
            } catch (error: any) {
                result.error = error.message;
                console.error(
                    `✗ Failed to generate download URL for: ${objectName} - ${error.message}`,
                );
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
            console.error(
                `✗ Some operations failed for: ${objectName} - ${result.error}`,
            );
        } else {
            console.log(`✓ Generated URLs for: ${objectName}`);
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
            const batch_number = Math.floor(i / batchSize) + 1;
            const total_batches = Math.ceil(objectNames.length / batchSize);

            console.log(
                `Processing batch ${batch_number}/${total_batches} (${batch.length} files)`,
            );

            try {
                const batch_promises = batch.map(async (objectName) => {
                    try {
                        // 如果需要检查文件是否存在
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
                        console.error(
                            `✗ Failed to generate URLs for: ${result.objectName} - ${result.error}`,
                        );
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
                    console.error(
                        `✗ Batch failed for: ${objectName} - ${error.message}`,
                    );
                }
            }

            const processed = Math.min(i + batchSize, objectNames.length);
            console.log(
                `Progress: ${processed}/${objectNames.length} files processed`,
            );
        }

        return { results, successful_urls, failed_urls };
    }
}
