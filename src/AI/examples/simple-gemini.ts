import { GeminiHelper } from '../GeminiHelper';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

async function main() {
  // 1. 配置
  const config = {
    // 如果需要代理，可以设置代理地址
    // proxyUrl: 'http://127.0.0.1:7897',

    // 系统指令，定义AI的行为
    systemInstruction: '你是一个有帮助的助手，请用中文回答用户的问题。',

    // 可选：选择模型，默认为 'gemini-2.0-flash-lite'
    // model: 'gemini-2.0-flash'
  };

  // 2. 创建 GeminiHelper 实例
  const apiKey = process.env.GEMINI_API_KEY || '';
  const helper = new GeminiHelper(apiKey, config);

  try {
    // 3. 发送消息并获取回复
    const response = await helper.sendMessage('请介绍一下人工智能的发展历史');
    console.log('AI回复:', response);

    // 4. 继续对话
    const followUpResponse = await helper.sendMessage('能详细说说深度学习吗？');
    console.log('AI回复:', followUpResponse);

    // 5. 获取对话历史
    const history = helper.getHistory();
    console.log('对话历史:', history);

    // 6. 清空对话历史
    helper.clearHistory();
  } catch (error) {
    console.error('发生错误:', error);
  }
}

main();
