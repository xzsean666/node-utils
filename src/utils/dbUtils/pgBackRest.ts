import { runTerminalCmd } from '../runTerminalCmd'; // Assuming a utility function to run terminal commands exists
import { S3Helper, S3Provider } from './s3Helper';
import * as fs from 'fs';
import * as path from 'path';

interface PgBackRestConfig {
  stanza: string;
  // pgBackRest specific configuration
  backupPath?: string; // Local backup path
  archivePath?: string; // Archive path
  // Add other necessary pgBackRest configuration options here
}

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

interface PgBackRestWithR2Config extends PgBackRestConfig {
  r2?: R2Config; // Optional R2 configuration
  uploadToR2?: boolean; // Whether to upload backups to R2
  compressBeforeUpload?: boolean; // Whether to compress backups before uploading
}

interface BackupResult {
  backupId: string;
  localPath?: string;
  r2Path?: string;
  uploadResult?: any;
  timestamp: Date;
}

/**
 * Runs a pgBackRest command.
 * @param command The pgBackRest command and its arguments.
 * @returns The result of the command execution.
 * @throws Error if the command fails.
 */
async function runPgBackRestCommand(command: string[]): Promise<string> {
  const fullCommand = ['pgbackrest', ...command].join(' ');
  console.log(`Running command: ${fullCommand}`);
  try {
    // Assuming runTerminalCmd returns stdout on success and throws on error
    const result = await runTerminalCmd(fullCommand, false); // Adjust is_background as needed
    return result;
  } catch (error: any) {
    console.error(`pgBackRest command failed: ${fullCommand}`, error);
    throw new Error(
      `Failed to run pgBackRest command: ${fullCommand}. Error: ${error.message}`,
    );
  }
}

/**
 * Creates S3Helper instance for Cloudflare R2
 * @param r2Config R2 configuration
 * @returns S3Helper instance
 */
function createR2Helper(r2Config: R2Config): S3Helper {
  return S3Helper.createCloudflareR2(
    r2Config.accessKeyId,
    r2Config.secretAccessKey,
    r2Config.accountId,
    r2Config.bucket,
  );
}

/**
 * Gets the latest backup information from pgBackRest
 * @param config pgBackRest configuration
 * @returns Backup information
 */
async function getLatestBackupInfo(config: PgBackRestConfig): Promise<any> {
  const command = ['--stanza=' + config.stanza, 'info', '--output=json'];
  try {
    const result = await runPgBackRestCommand(command);
    return JSON.parse(result);
  } catch (error: any) {
    throw new Error(`Failed to get backup info: ${error.message}`);
  }
}

/**
 * Finds backup files in the backup directory
 * @param backupPath Backup directory path
 * @param backupId Backup ID to look for
 * @returns Array of backup file paths
 */
async function findBackupFiles(
  backupPath: string,
  backupId: string,
): Promise<string[]> {
  try {
    const files: string[] = [];
    const backupDir = path.join(backupPath, backupId);

    if (fs.existsSync(backupDir)) {
      const dirFiles = await fs.promises.readdir(backupDir, {
        recursive: true,
      });
      for (const file of dirFiles) {
        const filePath = path.join(backupDir, file.toString());
        const stat = await fs.promises.stat(filePath);
        if (stat.isFile()) {
          files.push(filePath);
        }
      }
    }

    return files;
  } catch (error: any) {
    throw new Error(`Failed to find backup files: ${error.message}`);
  }
}

/**
 * Uploads backup files to R2
 * @param s3Helper S3Helper instance
 * @param backupFiles Array of local backup file paths
 * @param stanza Database stanza name
 * @param backupId Backup ID
 * @param compress Whether to compress files before upload
 * @returns Upload results
 */
async function uploadBackupToR2(
  s3Helper: S3Helper,
  backupFiles: string[],
  stanza: string,
  backupId: string,
  compress: boolean = true,
): Promise<any[]> {
  const uploadResults: any[] = [];

  for (const filePath of backupFiles) {
    try {
      const fileName = path.basename(filePath);
      const r2Key = `pgbackrest/${stanza}/${backupId}/${fileName}`;

      console.log(`Uploading ${filePath} to R2 as ${r2Key}`);

      let result;
      if (compress) {
        result = await s3Helper.uploadFileGzip(r2Key, filePath);
      } else {
        result = await s3Helper.uploadFile(r2Key, filePath);
      }

      uploadResults.push({
        localPath: filePath,
        r2Key,
        result,
        compressed: compress,
      });

      console.log(`Successfully uploaded ${fileName} to R2`);
    } catch (error: any) {
      console.error(`Failed to upload ${filePath}:`, error.message);
      uploadResults.push({
        localPath: filePath,
        error: error.message,
      });
    }
  }

  return uploadResults;
}

/**
 * Performs an incremental backup using pgBackRest.
 * @param config pgBackRest with R2 configuration.
 * @returns The backup result including R2 upload information.
 * @throws Error if the backup fails.
 */
export async function performIncrementalBackup(
  config: PgBackRestWithR2Config,
): Promise<BackupResult> {
  const command = ['--stanza=' + config.stanza, 'backup', '--type=incremental'];
  console.log(`Starting incremental backup for stanza: ${config.stanza}`);

  try {
    // Perform the backup
    const backupOutput = await runPgBackRestCommand(command);
    console.log('Backup completed:', backupOutput);

    // Get backup information to find the backup ID
    const backupInfo = await getLatestBackupInfo(config);
    const latestBackup =
      backupInfo[0]?.backup?.[backupInfo[0].backup.length - 1];

    if (!latestBackup) {
      throw new Error('Could not find information about the latest backup');
    }

    const backupId = latestBackup.label;
    const result: BackupResult = {
      backupId,
      timestamp: new Date(),
    };

    // Upload to R2 if configured
    if (config.uploadToR2 && config.r2) {
      console.log('Uploading backup to Cloudflare R2...');

      const s3Helper = createR2Helper(config.r2);

      if (config.backupPath) {
        const backupFiles = await findBackupFiles(config.backupPath, backupId);

        if (backupFiles.length > 0) {
          const uploadResults = await uploadBackupToR2(
            s3Helper,
            backupFiles,
            config.stanza,
            backupId,
            config.compressBeforeUpload ?? true,
          );

          result.uploadResult = uploadResults;
          result.r2Path = `pgbackrest/${config.stanza}/${backupId}/`;

          console.log(`Backup uploaded to R2: ${result.r2Path}`);
        } else {
          console.warn('No backup files found to upload');
        }
      } else {
        console.warn('Backup path not specified, skipping file upload');
      }
    }

    return result;
  } catch (error: any) {
    throw new Error(`Incremental backup failed: ${error.message}`);
  }
}

/**
 * Downloads backup from R2 and prepares for restore
 * @param s3Helper S3Helper instance
 * @param stanza Database stanza
 * @param backupId Backup ID to download
 * @param downloadPath Local path to download files
 * @returns Downloaded file paths
 */
async function downloadBackupFromR2(
  s3Helper: S3Helper,
  stanza: string,
  backupId: string,
  downloadPath: string,
): Promise<string[]> {
  try {
    const prefix = `pgbackrest/${stanza}/${backupId}/`;
    const objects = await s3Helper.listFiles(prefix, undefined, true);
    const downloadedFiles: string[] = [];

    // Create download directory
    const localBackupDir = path.join(downloadPath, backupId);
    await fs.promises.mkdir(localBackupDir, { recursive: true });

    for (const obj of objects) {
      if (obj.name) {
        const fileName = path.basename(obj.name);
        const localPath = path.join(localBackupDir, fileName);

        console.log(`Downloading ${obj.name} to ${localPath}`);

        if (obj.name.endsWith('.gz')) {
          // Decompress if it's a gzipped file
          await s3Helper.downloadFileGunzip(obj.name, localPath);
        } else {
          await s3Helper.downloadFile(obj.name, localPath);
        }

        downloadedFiles.push(localPath);
      }
    }

    return downloadedFiles;
  } catch (error: any) {
    throw new Error(`Failed to download backup from R2: ${error.message}`);
  }
}

/**
 * Performs a restore using pgBackRest, optionally downloading from R2 first.
 * @param config pgBackRest with R2 configuration.
 * @param target Optional: restore target (e.g., time, xid, lsn, name).
 * @param options Optional: additional restore options (e.g., --delta, --force).
 * @param downloadFromR2 Whether to download backup from R2 first.
 * @param backupId Specific backup ID to restore (required if downloading from R2).
 * @returns The result of the restore command.
 * @throws Error if the restore fails.
 */
export async function performRestore(
  config: PgBackRestWithR2Config,
  target?: string,
  options: string[] = [],
  downloadFromR2: boolean = false,
  backupId?: string,
): Promise<string> {
  try {
    // Download from R2 if requested
    if (downloadFromR2 && config.r2 && backupId) {
      console.log(`Downloading backup ${backupId} from R2...`);

      const s3Helper = createR2Helper(config.r2);
      const downloadPath = config.backupPath || '/tmp/pgbackrest-restore';

      await downloadBackupFromR2(
        s3Helper,
        config.stanza,
        backupId,
        downloadPath,
      );
      console.log('Backup downloaded from R2 successfully');
    }

    // Perform the restore
    const command = ['--stanza=' + config.stanza, 'restore'];
    if (target) {
      command.push(`--target=${target}`);
    }
    command.push(...options);

    console.log(
      `Starting restore for stanza: ${config.stanza}${
        target ? `, target: ${target}` : ''
      }`,
    );

    // WARNING: Restoring typically requires the database to be shut down.
    return await runPgBackRestCommand(command);
  } catch (error: any) {
    throw new Error(`Restore failed: ${error.message}`);
  }
}

/**
 * Lists available backups, including those stored in R2
 * @param config pgBackRest with R2 configuration
 * @param includeR2 Whether to include R2 stored backups
 * @returns Backup information
 */
export async function listBackups(
  config: PgBackRestWithR2Config,
  includeR2: boolean = false,
): Promise<any> {
  try {
    // Get local backup info
    const backupInfo = await getLatestBackupInfo(config);

    if (includeR2 && config.r2) {
      console.log('Fetching R2 backup information...');
      const s3Helper = createR2Helper(config.r2);
      const prefix = `pgbackrest/${config.stanza}/`;
      const r2Objects = await s3Helper.listFiles(prefix, undefined, true);

      // Group R2 objects by backup ID
      const r2Backups: Record<string, any[]> = {};
      for (const obj of r2Objects) {
        if (obj.name) {
          const pathParts = obj.name.split('/');
          if (pathParts.length >= 3) {
            const backupId = pathParts[2];
            if (!r2Backups[backupId]) {
              r2Backups[backupId] = [];
            }
            r2Backups[backupId].push(obj);
          }
        }
      }

      // Add R2 backup info to result
      backupInfo.r2Backups = r2Backups;
    }

    return backupInfo;
  } catch (error: any) {
    throw new Error(`Failed to list backups: ${error.message}`);
  }
}

// Example Usage:
/*
async function exampleUsage() {
  const config: PgBackRestWithR2Config = {
    stanza: 'my_database_stanza',
    backupPath: '/var/lib/pgbackrest/backup/my_database_stanza',
    uploadToR2: true,
    compressBeforeUpload: true,
    r2: {
      accountId: 'your-account-id',
      accessKeyId: 'your-access-key',
      secretAccessKey: 'your-secret-key',
      bucket: 'your-backup-bucket'
    }
  };

  try {
    // Perform incremental backup with R2 upload
    console.log('Performing incremental backup...');
    const backupResult = await performIncrementalBackup(config);
    console.log('Backup completed:', backupResult);

    // List all backups including R2
    console.log('Listing backups...');
    const backups = await listBackups(config, true);
    console.log('Available backups:', backups);

    // Restore from R2 (uncomment when needed)
    // console.log('Performing restore from R2...');
    // const restoreResult = await performRestore(
    //   config,
    //   'latest',
    //   ['--delta'],
    //   true, // download from R2
    //   backupResult.backupId
    // );
    // console.log('Restore completed:', restoreResult);

  } catch (error: any) {
    console.error('Operation failed:', error.message);
  }
}

// exampleUsage();
*/
