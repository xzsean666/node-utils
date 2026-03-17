import { MinioHelper } from './minioHelper';
import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import CryptoJS from 'crypto-js';

export class MinioHelperM3U8 extends MinioHelper {
  private tempDir: string;
  private readonly TEMP_FILE_MAX_AGE = 24 * 60 * 60 * 1000;
  constructor(config: any) {
    super(config);
    // 创建临时目录用于存储转码文件
    this.tempDir = path.join(os.tmpdir(), 'video-transcoding');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  // 上传m3u8文件及其ts文件
  async uploadM3U8WithSegments(
    bucketName: string,
    m3u8Path: string,
    tsFilesDir: string,
    targetDir: string,
  ): Promise<void> {
    try {
      const m3u8Content = await fs.promises.readFile(m3u8Path, 'utf-8');

      // 解析并上传 ts 文件
      const tsFiles = m3u8Content
        .split('\n')
        .filter((line) => line.endsWith('.ts'))
        .map((line) => line.trim());

      // 上传所有 ts 文件到指定目录
      for (const tsFile of tsFiles) {
        const tsPath = path.join(tsFilesDir, tsFile);
        const targetPath = `${targetDir}/${tsFile}`;
        await this.uploadFile(bucketName, targetPath, tsPath);
      }

      // 上传 m3u8 文件到指定目录
      const targetM3u8Path = `${targetDir}/playlist.m3u8`;
      await this.uploadFile(bucketName, targetM3u8Path, m3u8Path);
    } catch (error: any) {
      throw new Error(`上传M3U8文件失败: ${error.message}`);
    }
  }

  // 获取m3u8播放地址
  async getM3U8PlaybackUrl(
    bucketName: string,
    m3u8Name: string,
    expiry: number = 24 * 60 * 60,
  ): Promise<string> {
    try {
      const m3u8Content = await this.client.getObject(bucketName, m3u8Name);
      const content = await streamToString(m3u8Content);

      const lines = content.split('\n');
      const m3u8Dir = path.dirname(m3u8Name);

      const updatedLines = await Promise.all(
        lines.map(async (line) => {
          if (line.endsWith('.ts')) {
            // 使用相对路径构建ts文件路径，避免重复的目录名
            const tsFileName = line.trim();
            const tsPath = path.join(m3u8Dir, tsFileName);

            // 获取预签名URL
            const tsUrl = await this.getPresignedUrl(
              bucketName,
              tsPath,
              expiry,
            );
            return line.replace(tsFileName, tsUrl);
          }
          return line;
        }),
      );
      // 创建一个临时的 m3u8 文件
      const tempM3u8Path = path.join(this.tempDir, `temp-${Date.now()}.m3u8`);
      await fs.promises.writeFile(tempM3u8Path, updatedLines.join('\n'));

      // 使用唯一的临时文件名来避免冲突
      const tempM3u8Name = `temp/${Date.now()}-${path.basename(m3u8Name)}`;
      await this.uploadFile(bucketName, tempM3u8Name, tempM3u8Path);

      // 清理临时文件
      fs.unlinkSync(tempM3u8Path);

      // 返回临时 m3u8 文件的 URL
      return await this.getPresignedUrl(bucketName, tempM3u8Name, expiry);
    } catch (error: any) {
      throw new Error(`获取M3U8播放地址失败: ${error.message}`);
    }
  }
  // 添加清理临时文件的方法
  async cleanupTempFiles(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.tempDir);
      const now = Date.now();

      for (const file of files) {
        if (file.startsWith('temp-') && file.endsWith('.m3u8')) {
          const filePath = path.join(this.tempDir, file);
          const stats = await fs.promises.stat(filePath);

          // 如果文件超过24小时就删除
          if (now - stats.mtimeMs > this.TEMP_FILE_MAX_AGE) {
            await fs.promises.unlink(filePath);
            console.log(`已删除过期临时文件: ${filePath}`);
          }
        }
      }
    } catch (error: any) {
      console.error(`清理临时文件失败: ${error.message}`);
    }
  }

  async getM3U8PlayUrlByHash(
    bucketName: string,
    hash: string,
  ): Promise<string> {
    const m3u8Path = `videos/${hash}/hls/playlist.m3u8`;
    return await this.getM3U8PlaybackUrl(bucketName, m3u8Path, 24 * 60 * 60);
  }
  async calculateFileHash(input: File | string): Promise<string> {
    const md5Hash = CryptoJS.algo.MD5.create();
    const chunkSize = 10 * 1024 * 1024; // 10MB chunks

    if (input instanceof File) {
      // 处理浏览器的 File 对象
      let offset = 0;
      while (offset < input.size) {
        const chunk = await input
          .slice(offset, offset + chunkSize)
          .arrayBuffer();
        md5Hash.update(CryptoJS.lib.WordArray.create(chunk));
        offset += chunkSize;
      }
    } else {
      // 处理文件路径
      const fileStats = await fs.promises.stat(input);
      const fileHandle = await fs.promises.open(input, 'r');
      let bytesRead = 0;

      while (bytesRead < fileStats.size) {
        const buffer = Buffer.alloc(
          Math.min(chunkSize, fileStats.size - bytesRead),
        );
        await fileHandle.read(buffer, 0, buffer.length, bytesRead);
        md5Hash.update(CryptoJS.lib.WordArray.create(buffer));
        bytesRead += buffer.length;
      }

      await fileHandle.close();
    }

    return md5Hash.finalize().toString();
  }

  async uploadVideoToM3U8(
    bucketName: string,
    objectName: string,
    targetPath: string,
  ): Promise<string> {
    try {
      // 1. 计算文件的 MD5
      const md5Hash = await this.calculateFileHash(targetPath);

      // 2. 构建存储路径
      const baseDir = `videos/${md5Hash}`;
      const originalVideoPath = `${baseDir}/${path.basename(objectName)}`;
      const hlsDir = `${baseDir}/hls`;

      // 3. 检查是否已存在相同文件
      const exists = await this.objectExists(bucketName, originalVideoPath);
      if (exists) {
        // 如果文件已存在，直接返回 HLS 路径
        return `${hlsDir}/playlist.m3u8`;
      }

      // 4. 上传原始视频
      await this.uploadFile(bucketName, originalVideoPath, targetPath);

      // 5. 创建临时目录用于转码
      const outputDir = path.join(this.tempDir, `output-${Date.now()}`);
      fs.mkdirSync(outputDir, { recursive: true });
      const m3u8Path = path.join(outputDir, 'playlist.m3u8');

      // 6. 执行转码
      await this.convertToM3U8(targetPath, outputDir, m3u8Path);

      // 7. 上传转码后的文件
      await this.uploadM3U8WithSegments(
        bucketName,
        m3u8Path,
        outputDir,
        hlsDir,
      );

      // 8. 清理临时文件
      fs.rmSync(outputDir, { recursive: true });

      return `${hlsDir}/playlist.m3u8`;
    } catch (error: any) {
      throw new Error(`视频转码上传失败: ${error.message}`);
    }
  }

  // 新增：检查对象是否存在
  private async objectExists(
    bucketName: string,
    objectName: string,
  ): Promise<boolean> {
    try {
      await this.client.statObject(bucketName, objectName);
      return true;
    } catch (error) {
      return false;
    }
  }

  // 新增视频转码方法
  async transcodeVideoToM3U8(
    bucketName: string,
    videoKey: string,
    targetPath?: string,
  ): Promise<string> {
    try {
      // 1. 从MinIO下载原始视频
      const tempVideoPath = path.join(this.tempDir, `input-${Date.now()}.mp4`);
      await this.downloadFile(bucketName, videoKey, tempVideoPath);

      // 2. 创建输出目录
      const outputDir = path.join(this.tempDir, `output-${Date.now()}`);
      fs.mkdirSync(outputDir, { recursive: true });

      // 3. 设置输出m3u8文件路径
      const m3u8Path = path.join(outputDir, 'playlist.m3u8');

      // 4. 执行转码
      await this.convertToM3U8(tempVideoPath, outputDir, m3u8Path);

      // 5. 设置目标路径
      const finalTargetPath =
        targetPath || `transcoded/${path.parse(videoKey).name}`;

      // 6. 上传转码后的文件到MinIO
      await this.uploadM3U8WithSegments(
        bucketName,
        m3u8Path,
        outputDir,
        finalTargetPath,
      );

      // 7. 清理临时文件
      fs.rmSync(tempVideoPath);
      fs.rmSync(outputDir, { recursive: true });

      return `${finalTargetPath}/playlist.m3u8`;
    } catch (error: any) {
      throw new Error(`视频转码失败: ${error.message}`);
    }
  }

  private convertToM3U8(
    inputPath: string,
    outputDir: string,
    m3u8Path: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-codec:v libx264', // 视频编码器
          '-codec:a aac', // 音频编码器
          '-hls_time 10', // 每个片段的时长（秒）
          '-hls_list_size 0', // 保留所有片段
          '-f hls', // HLS格式输出
          '-hls_segment_filename', // 设置ts文件名格式
          path.join(outputDir, 'segment%d.ts'),
        ])
        .output(m3u8Path)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });
  }
}

// 辅助函数：将流转换为字符串
function streamToString(stream: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on('data', (chunk: any) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}
