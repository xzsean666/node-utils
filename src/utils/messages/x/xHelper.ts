// Note: this package is an external package, it isn't bundled with Node.
import { HttpsProxyAgent } from 'https-proxy-agent';
import { TwitterApi } from 'twitter-api-v2';

export interface TwitterAPIConfig {
  // 传统的API Keys方式 (超简单！)
  appKey: string; // Consumer Key
  appSecret: string; // Consumer Secret
  accessToken: string; // Access Token
  accessSecret: string; // Access Token Secret
  // 代理设置 (可选)
  proxyUrl?: string; // 如: 'http://127.0.0.1:7897' 或 'http://username:password@127.0.0.1:7897'
}

export class TwitterAPIHelper {
  private client: TwitterApi;

  constructor(config: TwitterAPIConfig) {
    if (
      !config.appKey ||
      !config.appSecret ||
      !config.accessToken ||
      !config.accessSecret
    ) {
      throw new Error(
        'All Twitter API credentials are required: appKey, appSecret, accessToken, accessSecret',
      );
    }

    // 创建认证配置对象
    const credentials = {
      appKey: config.appKey,
      appSecret: config.appSecret,
      accessToken: config.accessToken,
      accessSecret: config.accessSecret,
    };

    // 按照官方例子配置代理 - 只有明确提供 proxyUrl 时才使用
    if (config.proxyUrl) {
      console.log(`🔗 使用代理: ${config.proxyUrl}`);

      // create an instance of the `HttpsProxyAgent` class with the proxy server information
      const httpAgent = new HttpsProxyAgent(config.proxyUrl);

      // 第二个参数才是配置选项
      this.client = new TwitterApi(credentials, { httpAgent });

      console.log(`✅ 已配置代理: ${config.proxyUrl}`);
    } else {
      // 不使用代理
      this.client = new TwitterApi(credentials);
    }
  }

  // 发推文 - 超简单！
  async createTweet(text: string) {
    try {
      console.log(
        `🔄 正在发送推文: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
      );
      const response = await this.client.v2.tweet(text);
      console.log(`✅ 推文发送成功! ID: ${response.data.id}`);
      return response;
    } catch (error) {
      console.error(`❌ 发送推文失败:`, error);
      throw new Error(
        `Failed to create tweet: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 获取推文
  async getTweet(tweetId: string) {
    try {
      const response = await this.client.v2.singleTweet(tweetId);
      return response;
    } catch (error) {
      throw new Error(
        `Failed to get tweet: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 搜索推文
  async searchTweets(query: string, maxResults: number = 10) {
    try {
      const response = await this.client.v2.search(query, {
        max_results: maxResults,
      });
      return response;
    } catch (error) {
      throw new Error(
        `Failed to search tweets: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 获取自己的用户信息
  async getMe() {
    try {
      const response = await this.client.v2.me();
      return response;
    } catch (error) {
      throw new Error(
        `Failed to get user info: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 根据用户名获取用户信息
  async getUserByUsername(username: string) {
    try {
      const response = await this.client.v2.userByUsername(username);
      return response;
    } catch (error) {
      throw new Error(
        `Failed to get user by username: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// 导出便捷函数
export function createTwitterAPIHelper(
  config: TwitterAPIConfig,
): TwitterAPIHelper {
  return new TwitterAPIHelper(config);
}

// 超简单发推文！
export async function quickTweet(config: TwitterAPIConfig, text: string) {
  const twitter = new TwitterAPIHelper(config);
  return twitter.createTweet(text);
}

// 快速搜索
export async function quickSearch(
  config: TwitterAPIConfig,
  query: string,
  maxResults: number = 10,
) {
  const twitter = new TwitterAPIHelper(config);
  return twitter.searchTweets(query, maxResults);
}

// 快速获取用户信息
export async function quickUserInfo(
  config: TwitterAPIConfig,
  username: string,
) {
  const twitter = new TwitterAPIHelper(config);
  return twitter.getUserByUsername(username);
}
