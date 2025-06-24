// 超简单发推文示例 - 使用 twitter-api-v2 (支持代理)
import { TwitterApi } from 'twitter-api-v2';
import { HttpsProxyAgent } from 'https-proxy-agent';
import dotenv from 'dotenv';

dotenv.config();

// 配置你的Twitter API密钥 (支持代理)
const config = {
  appKey: process.env.X_CONSUMER_KEY || 'your_consumer_key',
  appSecret: process.env.X_CONSUMER_SECRET || 'your_consumer_secret',
  accessToken: process.env.X_ACCESS_TOKEN || 'your_access_token',
  accessSecret: process.env.X_ACCESS_TOKEN_SECRET || 'your_access_token_secret',
  proxyUrl: process.env.PROXY_URL, // 代理地址，如: 'http://127.0.0.1:7897'
};
const client = new TwitterApi(config);

async function main() {
  console.log(config);
  const me = await client.v2.me();
  console.log(me);
}

main();
