import { GeminiHelper } from '../GeminiHelper';
import { config } from 'dotenv';

// 加载环境变量
config();

async function testBasicGemini() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not found in environment variables');
    }

    // 测试基本聊天功能（不使用文件）
    const gemini = new GeminiHelper(apiKey, {
      model: 'gemini-2.0-flash-exp',
      systemInstruction: '你是一个有用的AI助手，请用中文回答。',
      // 不使用代理测试
      // proxyUrl: 'http://127.0.0.1:7897',
    });

    console.log('🤖 开始测试基本聊天功能...');

    // 测试基本消息
    const response1 = await gemini.sendMessage('你好，请介绍一下自己');
    console.log('👤 用户: 你好，请介绍一下自己');
    console.log('🤖 AI:', response1);
    console.log('\n');

    // 测试第二条消息（验证对话历史）
    const response2 = await gemini.sendMessage('刚才我问了什么问题？');
    console.log('👤 用户: 刚才我问了什么问题？');
    console.log('🤖 AI:', response2);
    console.log('\n');

    // 显示对话历史
    console.log('📝 对话历史:');
    console.log(JSON.stringify(gemini.getHistory(), null, 2));
  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

// 运行测试
testBasicGemini();
