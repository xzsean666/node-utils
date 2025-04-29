import { Client, BucketItem, CopyConditions } from "minio";

interface MinioConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
}

export class MinioHelper {
  public client: Client;

  constructor(config: MinioConfig) {
    this.client = new Client({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
  }

  // 检查 bucket 是否存在
  async bucketExists(bucketName: string): Promise<boolean> {
    try {
      return await this.client.bucketExists(bucketName);
    } catch (error: any) {
      throw new Error(`检查 bucket 失败: ${error}`);
    }
  }

  // 创建 bucket
  async createBucket(bucketName: string): Promise<void> {
    try {
      await this.client.makeBucket(bucketName);
    } catch (error: any) {
      throw new Error(`创建 bucket 失败: ${error.message}`);
    }
  }

  // 上传文件
  async uploadFile(
    bucketName: string,
    objectName: string,
    filePath: string
  ): Promise<void> {
    try {
      await this.client.fPutObject(bucketName, objectName, filePath);
    } catch (error: any) {
      throw new Error(`上传文件失败: ${error.message}`);
    }
  }

  // 获取文件信息
  async statObject(bucketName: string, objectName: string) {
    try {
      return await this.client.statObject(bucketName, objectName);
    } catch (error: any) {
      throw new Error(`获取文件信息失败: ${error.message}`);
    }
  }

  // 列出 bucket 中的所有文件
  async listObjects(
    bucketName: string,
    prefix?: string
  ): Promise<BucketItem[]> {
    try {
      const stream = this.client.listObjects(bucketName, prefix);
      const files: BucketItem[] = [];

      return new Promise((resolve, reject) => {
        stream.on("data", (obj: BucketItem) => files.push(obj));
        stream.on("error", reject);
        stream.on("end", () => resolve(files));
      });
    } catch (error: any) {
      throw new Error(`列出文件失败: ${error.message}`);
    }
  }

  // 下载文件
  async downloadFile(
    bucketName: string,
    objectName: string,
    filePath: string
  ): Promise<void> {
    try {
      await this.client.fGetObject(bucketName, objectName, filePath);
    } catch (error: any) {
      throw new Error(`下载文件失败: ${error.message}`);
    }
  }

  // 删除文件
  async deleteFile(bucketName: string, objectName: string): Promise<void> {
    try {
      await this.client.removeObject(bucketName, objectName);
    } catch (error: any) {
      throw new Error(`删除文件失败: ${error.message}`);
    }
  }

  // 删除 bucket
  async deleteBucket(bucketName: string): Promise<void> {
    try {
      await this.client.removeBucket(bucketName);
    } catch (error: any) {
      throw new Error(`删除 bucket 失败: ${error.message}`);
    }
  }

  // 获取文件的临时URL
  async getPresignedUrl(
    bucketName: string,
    objectName: string,
    expiry: number = 24 * 60 * 60
  ): Promise<string> {
    try {
      return await this.client.presignedGetObject(
        bucketName,
        objectName,
        expiry
      );
    } catch (error: any) {
      throw new Error(`获取临时URL失败: ${error.message}`);
    }
  }

  // 复制文件
  async copyObject(
    sourceBucket: string,
    sourceObject: string,
    destBucket: string,
    destObject: string
  ): Promise<void> {
    try {
      const conds = new CopyConditions();
      await this.client.copyObject(
        destBucket,
        destObject,
        `/${sourceBucket}/${sourceObject}`,
        conds
      );
    } catch (error: any) {
      throw new Error(`复制文件失败: ${error.message}`);
    }
  }
}
