// S3Sync - 文件夹同步工具
// 使用组合模式，依赖 S3Helper 实例的公开 API，不依赖 s3UrlGenerator / s3FolderUploader

import * as fs from 'fs';
import * as path from 'path';
import { S3Helper } from './s3Helper';
import {
    SyncMode,
    SyncOperation,
    type FileFilter,
    type SyncOptions,
    type SyncResult,
    type SyncResultItem,
    type UploadOptions,
    type LocalFileInfo,
    type S3FileInfo,
} from './s3Types';

export class S3Sync {
    private helper: S3Helper;

    constructor(helper: S3Helper) {
        this.helper = helper;
    }

    /**
     * 同步文件夹到 S3（支持双向同步）
     *
     * @example
     * const sync = new S3Sync(s3Helper);
     *
     * // 本地 -> S3
     * await sync.syncFolder('/local/folder', { s3Prefix: 'remote/prefix' });
     *
     * // S3 -> 本地
     * await sync.syncFolder('/local/folder', {
     *   syncMode: SyncMode.S3_TO_LOCAL,
     *   s3Prefix: 'remote/prefix',
     * });
     *
     * // 双向同步（试运行）
     * await sync.syncFolder('/local/folder', {
     *   syncMode: SyncMode.BIDIRECTIONAL,
     *   s3Prefix: 'remote/prefix',
     *   dryRun: true,
     * });
     */
    async syncFolder(
        local_folder_path: string,
        options?: SyncOptions,
    ): Promise<SyncResult> {
        try {
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

            const bucket_name = this.helper.getBucketName(bucket);

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
                    ? await this.helper.getLocalFiles(local_folder_path, fileFilter, depth)
                    : [];

            // 获取 S3 文件列表
            const s3_files =
                syncMode !== SyncMode.LOCAL_TO_S3
                    ? await this.getS3Files(bucket_name, s3Prefix, fileFilter)
                    : [];

            console.log(
                `📊 Found ${local_files.length} local files, ${s3_files.length} S3 files`,
            );

            // 创建文件映射
            const local_file_map = new Map(
                local_files.map((f) => [f.relativePath, f]),
            );
            const s3_file_map = new Map(s3_files.map((f) => [f.relativePath, f]));

            // 收集所有唯一相对路径
            const all_paths = Array.from(new Set([
                ...local_files.map((f) => f.relativePath),
                ...s3_files.map((f) => f.relativePath),
            ]));

            result.summary.totalFiles = all_paths.length;

            for (const relative_path of all_paths) {
                const local_file = local_file_map.get(relative_path);
                const s3_file = s3_file_map.get(relative_path);

                try {
                    if (local_file && s3_file) {
                        await this.handleBothExist(
                            local_file,
                            s3_file,
                            syncMode,
                            overwriteExisting,
                            compareBy,
                            s3Prefix,
                            bucket_name,
                            uploadOptions,
                            dryRun,
                            result,
                        );
                    } else if (local_file && !s3_file) {
                        await this.handleLocalOnly(
                            local_file,
                            syncMode,
                            deleteExtraFiles,
                            s3Prefix,
                            bucket_name,
                            local_folder_path,
                            uploadOptions,
                            dryRun,
                            result,
                        );
                    } else if (!local_file && s3_file) {
                        await this.handleS3Only(
                            s3_file,
                            syncMode,
                            deleteExtraFiles,
                            local_folder_path,
                            bucket_name,
                            dryRun,
                            result,
                        );
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

            this.printSyncSummary(result);
            return result;
        } catch (error: any) {
            throw new Error(`文件夹同步失败: ${error.message}`);
        }
    }

    // ============================================================
    // 私有方法
    // ============================================================

    /** 获取 S3 文件列表（支持过滤） */
    private async getS3Files(
        bucket: string,
        prefix?: string,
        filter?: FileFilter,
    ): Promise<S3FileInfo[]> {
        const s3_objects = await this.helper.listFiles(prefix, bucket, true);
        const files: S3FileInfo[] = [];

        for (const obj of s3_objects) {
            if (obj.name && !obj.name.endsWith('/')) {
                const relative_path = prefix
                    ? obj.name.replace(new RegExp(`^${prefix.replace(/\/$/, '')}/`), '')
                    : obj.name;

                if (
                    this.helper.applyFileFilter(relative_path, obj.size, filter)
                ) {
                    files.push({
                        s3Key: obj.name,
                        relativePath: relative_path,
                        size: obj.size || 0,
                        lastModified: obj.lastModified || new Date(),
                        etag: this.helper.normalizeETag(obj.etag || ''),
                    });
                }
            }
        }

        return files;
    }

    /** 比较文件是否相同 */
    private async compareFiles(
        local_file: { localPath: string; size: number; lastModified: Date },
        s3_file: { size: number; lastModified: Date; etag: string },
        compare_by: 'etag' | 'size' | 'lastModified' | 'both',
    ): Promise<boolean> {
        switch (compare_by) {
            case 'size':
                return local_file.size === s3_file.size;

            case 'lastModified':
                return (
                    Math.abs(
                        local_file.lastModified.getTime() -
                        s3_file.lastModified.getTime(),
                    ) <= 1000
                );

            case 'etag': {
                const local_etag = await this.helper.calculateFileMD5(
                    local_file.localPath,
                );
                return local_etag === s3_file.etag;
            }

            case 'both': {
                if (local_file.size !== s3_file.size) return false;
                const local_etag = await this.helper.calculateFileMD5(
                    local_file.localPath,
                );
                return local_etag === s3_file.etag;
            }

            default:
                return false;
        }
    }

    /** 处理两边都存在的文件 */
    private async handleBothExist(
        local_file: LocalFileInfo,
        s3_file: S3FileInfo,
        syncMode: SyncMode,
        overwriteExisting: boolean,
        compareBy: 'etag' | 'size' | 'lastModified' | 'both',
        s3Prefix: string | undefined,
        bucket_name: string,
        uploadOptions: UploadOptions,
        dryRun: boolean,
        result: SyncResult,
    ): Promise<void> {
        if (syncMode === SyncMode.BIDIRECTIONAL) {
            const local_newer = local_file.lastModified > s3_file.lastModified;

            if (overwriteExisting) {
                if (local_newer) {
                    await this.performOperation(
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
                    await this.performOperation(
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
                    const files_match = await this.compareFiles(
                        local_file,
                        s3_file,
                        compareBy,
                    );
                    if (!files_match) {
                        await this.performOperation(
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
            // 单向同步
            const files_match = await this.compareFiles(
                local_file,
                s3_file,
                compareBy,
            );

            if (!files_match && overwriteExisting) {
                const op =
                    syncMode === SyncMode.LOCAL_TO_S3
                        ? SyncOperation.UPDATE
                        : SyncOperation.DOWNLOAD;

                await this.performOperation(
                    op,
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
    }

    /** 处理仅本地存在的文件 */
    private async handleLocalOnly(
        local_file: LocalFileInfo,
        syncMode: SyncMode,
        deleteExtraFiles: boolean,
        s3Prefix: string | undefined,
        bucket_name: string,
        local_folder_path: string,
        uploadOptions: UploadOptions,
        dryRun: boolean,
        result: SyncResult,
    ): Promise<void> {
        if (
            syncMode === SyncMode.LOCAL_TO_S3 ||
            syncMode === SyncMode.BIDIRECTIONAL
        ) {
            await this.performOperation(
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
            await this.performOperation(
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
    }

    /** 处理仅 S3 存在的文件 */
    private async handleS3Only(
        s3_file: S3FileInfo,
        syncMode: SyncMode,
        deleteExtraFiles: boolean,
        local_folder_path: string,
        bucket_name: string,
        dryRun: boolean,
        result: SyncResult,
    ): Promise<void> {
        if (
            syncMode === SyncMode.S3_TO_LOCAL ||
            syncMode === SyncMode.BIDIRECTIONAL
        ) {
            // 构造 local file info（用于下载）
            const local_file: LocalFileInfo = {
                localPath: path.join(local_folder_path, s3_file.relativePath),
                relativePath: s3_file.relativePath,
                size: s3_file.size,
                lastModified: s3_file.lastModified,
            };

            await this.performOperation(
                SyncOperation.DOWNLOAD,
                local_file,
                s3_file,
                undefined,
                bucket_name,
                {},
                dryRun,
                result,
            );
        } else if (syncMode === SyncMode.LOCAL_TO_S3 && deleteExtraFiles) {
            await this.performOperation(
                SyncOperation.DELETE_S3,
                undefined,
                s3_file,
                undefined,
                bucket_name,
                {},
                dryRun,
                result,
            );
        }
    }

    /** 执行同步操作 */
    private async performOperation(
        operation: SyncOperation,
        local_file?: LocalFileInfo,
        s3_file?: S3FileInfo,
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
                        await this.helper.uploadFile(
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
                        await this.helper.downloadFile(
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
                        await this.helper.deleteFile(s3_file.s3Key, bucket_name);
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

    /** 添加跳过操作记录 */
    private addSkipOperation(
        localFile?: LocalFileInfo,
        s3File?: S3FileInfo,
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

        const relative_path =
            localFile?.relativePath || s3File?.relativePath || '';
        console.log(`⚡ Skipped (already in sync): ${relative_path}`);
    }

    /** 打印同步结果总结 */
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
}
