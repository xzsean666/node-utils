import { GeminiHelper } from '../GeminiHelper';
import dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error('GEMINI_API_KEY is required');
}

async function main() {
  console.log('=== 示例 1: 在系统指令中包含图片 ===');
  try {
    // 在系统指令中包含一张参考图片
    const gemini1 = new GeminiHelper(apiKey!, {
      proxyUrl: 'http://127.0.0.1:7897',
      systemInstruction:
        '你是一个专业的图像分析助手。请根据系统中提供的参考图片来分析用户上传的图片，并进行对比分析。',
      //   systemFiles: [
      //     path.join(__dirname, './533d3e505e296223848960c36e421372.png'), // 参考图片
      //   ],
    });

    const response1 = await gemini1.sendMessage(
      '请分析并描述系统中的参考图片有什么特点',
      // path.join(__dirname, './533d3e505e296223848960c36e421372.png'),
    );
    console.log('AI回复:', response1);
  } catch (error) {
    console.error('图片分析失败:', error);
    console.log('请确保在 src/utils/examples/images/ 目录下有参考图片文件');
  }
}

main().catch(console.error);
