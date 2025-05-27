import { S3Helper, S3Config, S3Provider } from './s3Helper';
import * as dotenv from 'dotenv';
import { exec, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

// Function to get PostgreSQL configuration from environment variables
function getPGConfig(): PGConfig {
  const { PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD } = process.env;

  if (!PG_HOST || !PG_PORT || !PG_DATABASE || !PG_USER) {
    throw new Error(
      'Missing required PostgreSQL environment variables: PG_HOST, PG_PORT, PG_DATABASE, PG_USER',
    );
  }

  return {
    host: PG_HOST,
    port: parseInt(PG_PORT, 10),
    database: PG_DATABASE,
    user: PG_USER,
    password: PG_PASSWORD, // Be cautious with storing passwords directly in .env, especially in production
  };
}

// Function to get S3 configuration from environment variables
function getS3Config(): S3Config {
  const {
    S3_PROVIDER,
    S3_ENDPOINT,
    S3_PORT,
    S3_USESSL,
    S3_ACCESS_KEY,
    S3_SECRET_KEY,
    S3_REGION,
    S3_BUCKET,
  } = process.env;

  if (
    !S3_PROVIDER ||
    !S3_ENDPOINT ||
    !S3_ACCESS_KEY ||
    !S3_SECRET_KEY ||
    !S3_BUCKET
  ) {
    throw new Error(
      'Missing required S3 environment variables: S3_PROVIDER, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET',
    );
  }

  // Map string provider to enum, default to CUSTOM if unknown
  const provider = Object.values(S3Provider).includes(S3_PROVIDER as S3Provider)
    ? (S3_PROVIDER as S3Provider)
    : S3Provider.CUSTOM;

  return {
    provider: provider,
    endPoint: S3_ENDPOINT,
    port: S3_PORT ? parseInt(S3_PORT, 10) : undefined,
    useSSL: S3_USESSL ? S3_USESSL.toLowerCase() === 'true' : undefined,
    accessKey: S3_ACCESS_KEY,
    secretKey: S3_SECRET_KEY,
    region: S3_REGION,
    bucket: S3_BUCKET,
  };
}

// Function to perform a full backup and upload to S3
async function performFullBackupAndUpload() {
  try {
    const pgConfig = getPGConfig();
    const s3Config = getS3Config();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `postgresql_full_backup_${timestamp}.sql`;
    const backupFilePath = path.join(__dirname, backupFileName); // Save locally first

    console.log(`Starting PostgreSQL full backup to ${backupFilePath}...`);

    // Construct the pg_dump command
    // Using PGPASSWORD environment variable for security
    const pgDumpCommand = `pg_dump -h ${pgConfig.host} -p ${pgConfig.port} -U ${pgConfig.user} -d ${pgConfig.database} -F p -b -v`;

    // Set PGPASSWORD environment variable for the command
    const envWithPassword = { ...process.env, PGPASSWORD: pgConfig.password };

    // Execute pg_dump and pipe output to a file
    const dumpProcess = spawn(pgDumpCommand, {
      shell: true,
      env: envWithPassword,
    });
    const outputStream = fs.createWriteStream(backupFilePath);

    dumpProcess.stdout.pipe(outputStream);

    dumpProcess.stderr.on('data', (data) => {
      console.error(`pg_dump stderr: ${data}`);
    });

    await new Promise<void>((resolve, reject) => {
      dumpProcess.on('error', (err) => {
        console.error('Failed to start pg_dump process:', err);
        reject(err);
      });

      dumpProcess.on('close', (code) => {
        if (code === 0) {
          console.log('pg_dump completed successfully.');
          resolve();
        } else {
          console.error(`pg_dump process exited with code ${code}`);
          reject(new Error(`pg_dump failed with code ${code}`));
        }
      });

      outputStream.on('error', (err) => {
        console.error('Failed to write backup file:', err);
        reject(err);
      });
    });

    console.log(
      `Uploading ${backupFileName} to S3 bucket ${s3Config.bucket}...`,
    );

    const s3Helper = new S3Helper(s3Config);

    // Use uploadFileGzip for efficiency
    const s3ObjectKey = `backups/full/${backupFileName}.gz`;
    const uploadResult = await s3Helper.uploadFileGzip(
      s3ObjectKey,
      backupFilePath,
      s3Config.bucket,
    );

    console.log(
      `Upload complete. S3 Object: ${uploadResult.name}, ETag: ${uploadResult.etag}`,
    );

    // Clean up local backup file
    console.log(`Cleaning up local backup file: ${backupFilePath}`);
    await fs.promises.unlink(backupFilePath);
    console.log('Local backup file deleted.');
  } catch (error: any) {
    console.error('Backup and upload failed:', error.message);
    // In a real application, you would add more robust error handling and alerting
  }
}

// Example usage (you would typically run this via a cron job or scheduler)
// performFullBackupAndUpload();

// Optional: Export the function if you plan to import it elsewhere
export { performFullBackupAndUpload, getPGConfig, getS3Config };
