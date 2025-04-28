import { MinioHelperM3U8 } from "../db/minioHelperM3U8";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

async function main() {
  try {
    // 初始化 MinIO 配置
    const config = {
      endPoint: process.env.MINIO_ENDPOINT || "localhost",
      port: parseInt(process.env.MINIO_PORT || "9000"),
      useSSL: process.env.MINIO_USE_SSL === "true",
      accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
      secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
    };

    const minioHelper = new MinioHelperM3U8(config);
    const bucketName = "videos";

    // 视频文件路径（替换为实际的视频文件路径）
    const videoPath = path.join(__dirname, "videos/ForBiggerMeltdowns.mp4");
    const objectName = "test.mp4";

    console.log("开始上传并转换视频...");
    const m3u8Path = await minioHelper.uploadVideoToM3U8(
      bucketName,
      objectName,
      videoPath
    );

    console.log("视频上传并转换成功!");
    console.log("M3U8文件路径:", m3u8Path);

    // 获取可访问的URL
    const url = await minioHelper.getPresignedUrl(bucketName, m3u8Path);
    console.log("播放地址:", url);
  } catch (error: any) {
    console.error("发生错误:", error.message);
  }
}

// 运行示例
main().catch(console.error);
