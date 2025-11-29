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

    // 获取可访问的URL
    const url = await minioHelper.getM3U8PlayUrlByHash(
      "videos",
      "9e87559cba36e6d07f7435c2a8081b3a"
    );
    console.log("播放地址:", url);
  } catch (error: any) {
    console.error("发生错误:", error.message);
  }
}

// 运行示例
main().catch(console.error);
