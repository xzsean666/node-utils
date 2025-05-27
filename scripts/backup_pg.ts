import { S3Helper, S3Config, S3Provider } from '../src/utils/dbUtils/s3Helper';
import { exec } from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';

const execAsync = promisify(exec);
const unlinkAsync = promisify(fs.unlink);

// --- Configuration --- //
// Load configuration from environment variables or a config file
// Example using environment variables:
const dbConfig = {
  database: process.env.PGDATABASE || 'mydatabase',
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || '5432',
  user: process.env.PGUSER || 'myuser',
  password: process.env.PGPASSWORD || 'mypassword',
};

const s3Config: S3Config = {
  provider: (process.env.S3_PROVIDER as S3Provider) || S3Provider.AWS_S3,
  endPoint: process.env.S3_ENDPOINT || '',
  port: process.env.S3_PORT ? parseInt(process.env.S3_PORT, 10) : undefined,
  useSSL: process.env.S3_USE_SSL
    ? process.env.S3_USE_SSL === 'true'
    : undefined,
  accessKey: process.env.S3_ACCESS_KEY || '',
  secretKey: process.env.S3_SECRET_KEY || '',
  region: process.env.S3_REGION || undefined,
  bucket: process.env.S3_BUCKET || '',
};

const backupFileName = `backup_${dbConfig.database}_${new Date()
  .toISOString()
  .replace(/[:.-]/g, '')}.sqlc`;
const localBackupPath = `/tmp/${backupFileName}`;

// Optional: If you have a KV database for duplication check
// const kvdb = YourKVDatabaseInstance; // Replace with your KV database instance if any
// const s3Helper = new S3Helper(s3Config, kvdb);

const s3Helper = new S3Helper(s3Config);

// --- Backup Function --- //
async function backupAndUpload(): Promise<void> {
  console.log(`Starting backup of database: ${dbConfig.database}`);

  // 1. Run pg_dump
  // Ensure PG environment variables are set for pg_dump to connect
  const pgDumpCommand = `pg_dump -Fc -f ${localBackupPath} -d ${dbConfig.database}`;
  console.log(`Executing command: ${pgDumpCommand}`);

  try {
    const { stdout, stderr } = await execAsync(pgDumpCommand, {
      env: {
        ...process.env,
        PGPASSWORD: dbConfig.password, // Pass password via env var for security
      },
    });

    if (stdout) console.log(`pg_dump stdout: ${stdout}`);
    if (stderr) console.error(`pg_dump stderr: ${stderr}`);

    console.log(`Backup created successfully at: ${localBackupPath}`);

    // 2. Upload to S3
    console.log(
      `Uploading ${localBackupPath} to S3 bucket "${s3Config.bucket}" as "${backupFileName}"`,
    );
    const uploadResult = await s3Helper.uploadFileAdvanced(
      backupFileName,
      localBackupPath,
      s3Config.bucket,
    );

    if (uploadResult.wasUploaded) {
      console.log(
        `Upload successful. Object name: ${uploadResult.objectName}, ETag: ${uploadResult.etag}`,
      );
    } else {
      console.log(
        `File already exists on S3 (ETag match). Object name: ${uploadResult.objectName}, ETag: ${uploadResult.etag}`,
      );
    }
  } catch (error: any) {
    console.error(`Backup or upload failed: ${error.message}`);
  } finally {
    // 3. Clean up local backup file
    if (fs.existsSync(localBackupPath)) {
      console.log(`Cleaning up local backup file: ${localBackupPath}`);
      try {
        await unlinkAsync(localBackupPath);
        console.log('Local backup file removed.');
      } catch (cleanupError: any) {
        console.error(
          `Failed to remove local backup file: ${cleanupError.message}`,
        );
      }
    }
  }
}

// --- Execute --- //
backupAndUpload();
