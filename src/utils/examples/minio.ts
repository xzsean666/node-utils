import { MinioHelper } from "../minioHelper";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

async function main() {
  try {
    // 初始化 MinIO 客户端
    const config = {
      endPoint: process.env.MINIO_ENDPOINT || "localhost",
      port: parseInt(process.env.MINIO_PORT || "9000"),
      useSSL: process.env.MINIO_USE_SSL === "true",
      accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
      secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
    };
    const minioHelper = new MinioHelper(config);

    const bucketName = "test-bucket";
    const filePath = path.join(__dirname, "images/test.jpeg"); // 替换为实际的文件路径
    const objectName = "uploaded/test.txt";

    // 确保 bucket 存在
    const bucketExists = await minioHelper.bucketExists(bucketName);
    if (!bucketExists) {
      console.log(`创建 bucket: ${bucketName}`);
      await minioHelper.createBucket(bucketName);
    }

    // 上传文件
    console.log("开始上传文件...");
    await minioHelper.uploadFile(bucketName, objectName, filePath);
    console.log("文件上传成功!");

    // 获取文件信息
    console.log("获取文件信息...");
    const stats = await minioHelper.statObject(bucketName, objectName);
    console.log("文件信息:", stats);

    // 列出 bucket 中的所有文件
    console.log("列出 bucket 中的所有文件:");
    const files = await minioHelper.listObjects(bucketName);
    files.forEach((file) => {
      console.log(`- ${file.name} (大小: ${file.size} 字节)`);
    });
    const url = await minioHelper.getPresignedUrl(bucketName, objectName);
    console.log("文件访问链接:", url);
  } catch (error: any) {
    console.error("发生错误:", error.message);
  }
}

// 运行示例
main().catch(console.error);
