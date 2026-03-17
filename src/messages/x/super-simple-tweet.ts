// 超简单发推文示例 - 使用 twitter-api-v2
import { TwitterApi } from 'twitter-api-v2';
import dotenv from 'dotenv';

dotenv.config();

// 配置你的Twitter API密钥
const config = {
  appKey: process.env.X_CONSUMER_KEY || 'your_consumer_key',
  appSecret: process.env.X_CONSUMER_SECRET || 'your_consumer_secret',
  accessToken: process.env.X_ACCESS_TOKEN || 'your_access_token',
  accessSecret: process.env.X_ACCESS_TOKEN_SECRET || 'your_access_token_secret',
  proxyUrl: process.env.X_PROXY_URL || 'http://127.0.0.1:7897',
};

// 创建Twitter客户端
const client = new TwitterApi(config);

async function sendTweet(text: string) {
  try {
    console.log('发送推文:', text);
    const result = await client.v2.tweet(text);
    console.log('推文发送成功:', result.data);
    return result;
  } catch (error) {
    console.error('发送推文失败:', error);
    throw error;
  }
}

async function main() {
  try {
    // 获取当前用户信息
    const me = await client.v2.me();
    console.log('当前用户:', me.data);

    // 发送推文示例
    // const tweetText = `Hello World! 这是一条测试推文 ${new Date().toLocaleString()}`;
    // await sendTweet(tweetText);

    // 更多发推文例子
    // await sendTweet('这是另一条推文 🚀');
    // await sendTweet('支持中文和表情符号 😊 #test #nodejs');
    // await sendTweet('分享一些有趣的内容！#coding #javascript');
  } catch (error) {
    console.error('执行失败:', error);
  }
}

// 如果直接运行此文件，执行main函数
if (require.main === module) {
  main();
}

// 导出函数供其他模块使用
export { sendTweet, client };
