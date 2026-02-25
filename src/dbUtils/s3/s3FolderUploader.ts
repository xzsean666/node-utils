// S3FolderUploader - 文件夹上传工具
// 使用组合模式，依赖 S3Helper 实例的公开 API，不依赖 s3Sync / s3UrlGenerator

import * as fs from 'fs';
import * as path from 'path';
import { S3Helper } from './s3Helper';
import type {
    UploadOptions,
    FolderUploadOptions,
    FolderUploadResult,
    FolderUploadResultAdvanced,
    FileInfo,
    UploadResult,
} from './s3Types';
import { IMAGE_EXTENSIONS, MIME_TYPE_MAP } from './s3Types';

export class S3FolderUploader {
    private helper: S3Helper;

    constructor(helper: S3Helper) {
        this.helper = helper;
    }

    /**
     * 上传文件夹中的所有图片（支持基础和高级模式）
     *
     * @example
     * // 基础模式
     * const uploader = new S3FolderUploader(s3Helper);
     * await uploader.uploadImages('/local/images', { s3Prefix: 'uploads/images' });
     *
     * // 高级模式
     * const result = await uploader.uploadImages('/local/images', {
     *   s3Prefix: 'uploads/images',
     *   advanced: true,
     *   depth: 2,
     * });
     */
    async uploadImages(
        local_folder_path: string,
        options?: FolderUploadOptions,
    ): Promise<FolderUploadResult | FolderUploadResultAdvanced> {
        try {
            const {
                s3Prefix: s3_prefix,
                bucket,
                depth: search_depth = -1,
                advanced = false,
                ...upload_options
            } = options || {};

            const successful_basic: FolderUploadResult['successful'] = [];
            const successful_advanced: FolderUploadResultAdvanced['successful'] = [];
            const failed: Array<{ localPath: string; error: string }> = [];
            let uploaded_count = 0;
            let cached_count = 0;

            // 获取所有图片文件
            const image_files = await this.getImageFiles(
                local_folder_path,
                search_depth,
            );

            console.log(
                `Found ${image_files.length} image files to upload (depth: ${search_depth === -1 ? 'unlimited' : search_depth
                }, mode: ${advanced ? 'advanced' : 'basic'})`,
            );

            for (const file_path of image_files) {
                try {
                    const relative_path = path.relative(local_folder_path, file_path);
                    const s3_key = s3_prefix
                        ? `${s3_prefix}/${relative_path}`
                        : relative_path;

                    const ext = path.extname(file_path).toLowerCase();
                    const final_upload_options: UploadOptions = {
                        ...upload_options,
                        contentType: MIME_TYPE_MAP[ext] || 'application/octet-stream',
                    };

                    if (advanced) {
                        const upload_result = await this.helper.uploadFileAdvanced(
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
                        // 基础模式：直接使用 uploadFile（内部已有重复检查逻辑）
                        const file_info = await this.helper.uploadFile(
                            s3_key,
                            file_path,
                            bucket,
                            final_upload_options,
                        );

                        // 判断是否为缓存结果（name 不等于 s3_key 说明命中重复检查）
                        const was_uploaded = file_info.name === s3_key;

                        successful_basic.push({
                            localPath: file_path,
                            s3Key: was_uploaded ? s3_key : file_info.name,
                            fileInfo: file_info,
                            wasUploaded: was_uploaded,
                        });

                        if (was_uploaded) {
                            uploaded_count++;
                            console.log(`✓ Uploaded: ${file_path} -> ${s3_key}`);
                        } else {
                            cached_count++;
                            console.log(
                                `⚡ Cached: ${file_path} -> ${file_info.name} (already exists)`,
                            );
                        }
                    }
                } catch (error: any) {
                    failed.push({
                        localPath: file_path,
                        error: error.message,
                    });
                    console.error(
                        `✗ Failed to upload: ${file_path} - ${error.message}`,
                    );
                }
            }

            console.log(
                `Upload summary: ${uploaded_count} uploaded, ${cached_count} from cache, ${failed.length} failed`,
            );

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

    // ============================================================
    // 私有方法
    // ============================================================

    /** 递归获取所有图片文件（支持深度控制） */
    private async getImageFiles(
        dir_path: string,
        max_depth: number,
        current_depth: number = 0,
    ): Promise<string[]> {
        const files: string[] = [];
        const items = await fs.promises.readdir(dir_path, {
            withFileTypes: true,
        });

        for (const item of items) {
            const full_path = path.join(dir_path, item.name);

            if (item.isDirectory()) {
                if (max_depth === -1 || current_depth < max_depth) {
                    const sub_files = await this.getImageFiles(
                        full_path,
                        max_depth,
                        current_depth + 1,
                    );
                    files.push(...sub_files);
                }
            } else if (item.isFile()) {
                const ext = path.extname(item.name).toLowerCase();
                if (IMAGE_EXTENSIONS.includes(ext)) {
                    files.push(full_path);
                }
            }
        }

        return files;
    }
}
