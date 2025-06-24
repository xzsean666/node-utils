import { TwitterApi } from 'twitter-api-v2';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as https from 'https';
import * as http from 'http';

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

    // 配置全局代理 - 通过 monkey patching 覆盖 HTTP 请求方法
    if (config.proxyUrl) {
      console.log(`🔗 使用代理: ${config.proxyUrl}`);
      const proxyAgent = new HttpsProxyAgent(config.proxyUrl);

      // 保存原始的 request 方法
      const originalHttpsRequest = https.request;
      const originalHttpRequest = http.request;

      // 覆盖 https.request 方法
      (https as any).request = function (options: any, callback?: any) {
        if (typeof options === 'string') {
          options = new URL(options);
        }
        // 使用代理 agent
        options.agent = proxyAgent;
        return originalHttpsRequest.call(this, options, callback);
      };

      // 覆盖 http.request 方法
      (http as any).request = function (options: any, callback?: any) {
        if (typeof options === 'string') {
          options = new URL(options);
        }
        // 使用代理 agent
        options.agent = proxyAgent;
        return originalHttpRequest.call(this, options, callback);
      };

      console.log(`✅ 已通过 monkey patching 设置全局代理`);
    }

    // 创建配置对象
    const twitterConfig: any = {
      appKey: config.appKey,
      appSecret: config.appSecret,
      accessToken: config.accessToken,
      accessSecret: config.accessSecret,
    };

    // 仍然保留原有的代理配置作为备用
    if (config.proxyUrl) {
      const proxyAgent = new HttpsProxyAgent(config.proxyUrl);
      twitterConfig.requestConfig = {
        httpAgent: proxyAgent,
        httpsAgent: proxyAgent,
      };
    }

    this.client = new TwitterApi(twitterConfig);
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
