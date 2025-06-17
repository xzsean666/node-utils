import { TelegramClient } from 'telegram';
import { StringSession, StoreSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import type { Dialog } from 'telegram/tl/custom/dialog';

/**
 * 基础会话数据接口
 */
export interface BaseUserSessionData {
  userId?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  isAuthorized: boolean;
  lastActivity?: Date;
}

/**
 * 认证配置接口
 */
export interface AuthConfig {
  phoneNumber: () => Promise<string>;
  phoneCode: () => Promise<string>;
  password?: () => Promise<string>;
  onError?: (err: Error) => void;
}

/**
 * 代理配置接口
 */
export interface ProxyConfig {
  ip: string;
  port: number;
  MTProxy?: boolean;
  secret?: string;
  socksType?: 4 | 5;
  username?: string;
  password?: string;
}

/**
 * 代理选项接口 - 支持URL或详细配置
 */
export interface ProxyOptions {
  url?: string; // 支持 http://ip:port 或 socks5://ip:port 格式
  config?: ProxyConfig; // 详细配置
}

/**
 * 认证数据接口 - sendPhoneCode返回的对象
 */
export interface AuthData {
  tempSessionString: string;
  phoneCodeHash: string;
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  proxy?: ProxyConfig | string;
  password?: string;
}

/**
 * GramJS 基础类，用于 Telegram 用户客户端操作
 */
export class TelegramJSBase {
  client: TelegramClient;
  private sessionData: BaseUserSessionData;
  private messageHandlers: Array<
    (event: NewMessageEvent) => Promise<void> | void
  > = [];

  /**
   * 构造函数
   * @param apiId API ID from https://my.telegram.org/apps
   * @param apiHash API Hash from https://my.telegram.org/apps
   * @param sessionString 会话字符串，首次使用留空
   * @param options 客户端选项
   */
  constructor(
    private apiId: number,
    private apiHash: string,
    sessionString: string = '',
    options: {
      useStoreSession?: boolean;
      sessionName?: string;
      proxy?: ProxyConfig | string; // 支持直接传入URL字符串或配置对象
    } = {},
  ) {
    let session;

    if (options.useStoreSession && options.sessionName) {
      session = new StoreSession(options.sessionName);
    } else {
      session = new StringSession(sessionString);
    }

    // 构建代理配置
    let proxyConfig: any = undefined;
    if (options.proxy) {
      let parsedProxy: ProxyConfig;

      if (typeof options.proxy === 'string') {
        // 解析代理URL
        parsedProxy = this.parseProxyUrl(options.proxy);
      } else {
        // 使用传入的配置对象
        parsedProxy = options.proxy;
      }

      if (parsedProxy.MTProxy && parsedProxy.secret) {
        proxyConfig = {
          MTProxy: true,
          secret: parsedProxy.secret,
          ip: parsedProxy.ip,
          port: parsedProxy.port,
        };
      } else {
        proxyConfig = {
          socksType: parsedProxy.socksType || 5,
          ip: parsedProxy.ip,
          port: parsedProxy.port,
          username: parsedProxy.username,
          password: parsedProxy.password,
        };
      }
    }

    this.client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
      useWSS: options.proxy ? false : true,
      proxy: proxyConfig,
    });

    this.sessionData = {
      isAuthorized: false,
    };

    this.setupEventHandlers();
  }

  /**
   * 解析代理URL
   * @param proxyUrl 代理URL，例如 http://127.0.0.1:7987 或 socks5://user:pass@127.0.0.1:1080
   */
  public parseProxyUrl(proxyUrl: string): ProxyConfig {
    try {
      const url = new URL(proxyUrl);
      const config: ProxyConfig = {
        ip: url.hostname,
        port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
      };

      // 设置代理类型
      if (url.protocol === 'socks5:' || url.protocol === 'socks:') {
        config.socksType = 5;
      } else if (url.protocol === 'socks4:') {
        config.socksType = 4;
      } else {
        // HTTP/HTTPS 代理默认使用 SOCKS5
        config.socksType = 5;
      }

      // 解析用户名和密码
      if (url.username) {
        config.username = decodeURIComponent(url.username);
      }
      if (url.password) {
        config.password = decodeURIComponent(url.password);
      }

      return config;
    } catch (error) {
      console.error('Error parsing proxy URL:', error);
      throw new Error(`Invalid proxy URL: ${proxyUrl}`);
    }
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers() {
    this.client.addEventHandler(async (event: NewMessageEvent) => {
      for (const handler of this.messageHandlers) {
        try {
          await handler(event);
        } catch (error) {
          console.error('Error in message handler:', error);
        }
      }
    }, new NewMessage());
  }

  /**
   * 启动客户端 - 如果有session直接连接，否则进行认证
   * @param authConfig 认证配置（仅在没有session时需要）
   */
  async start(authConfig?: AuthConfig): Promise<void> {
    try {
      // 先连接
      await this.client.connect();

      // 检查是否已经有有效的session
      if (await this.client.isUserAuthorized()) {
        // 已有有效session，直接更新用户数据
        await this.updateSessionData();
        console.log('GramJS client connected with existing session');
      } else {
        // 没有有效session，需要认证
        if (!authConfig) {
          throw new Error('Authentication config required for new session');
        }

        await this.client.start({
          phoneNumber: authConfig.phoneNumber,
          password: authConfig.password,
          phoneCode: authConfig.phoneCode,
          onError:
            authConfig.onError || ((err) => console.error('Auth error:', err)),
        });

        // 更新会话数据
        await this.updateSessionData();
        console.log('GramJS client started and authenticated');
      }
    } catch (error) {
      console.error('Error starting client:', error);
      throw error;
    }
  }

  /**
   * 连接客户端（不进行认证）
   */
  async connect(): Promise<void> {
    await this.client.connect();

    if (await this.client.isUserAuthorized()) {
      await this.updateSessionData();
    }
  }

  /**
   * 断开客户端
   */
  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  /**
   * 获取会话字符串（用于保存会话）
   */
  getSession(): string {
    try {
      if (this.client.session instanceof StringSession) {
        return this.client.session.save() || '';
      }
      return '';
    } catch (error) {
      console.error('Error getting session:', error);
      return '';
    }
  }

  /**
   * 更新会话数据
   */
  private async updateSessionData(): Promise<void> {
    try {
      const me = await this.client.getMe();
      this.sessionData = {
        userId: me.id.toJSNumber(),
        username: me.username || undefined,
        firstName: me.firstName || undefined,
        lastName: me.lastName || undefined,
        phoneNumber: me.phone || undefined,
        isAuthorized: true,
        lastActivity: new Date(),
      };
    } catch (error) {
      console.error('Error updating session data:', error);
    }
  }

  /**
   * 获取当前用户信息
   */
  getUserInfo(): BaseUserSessionData {
    return { ...this.sessionData };
  }

  /**
   * 发送文本消息
   * @param entity 目标实体（用户名、电话号码或实体对象）
   * @param message 消息内容
   * @param options 发送选项
   */
  async sendMessage(
    entity: string | Api.TypeEntityLike,
    message: string,
    options: {
      parseMode?: 'html' | 'md';
      linkPreview?: boolean;
      silent?: boolean;
      replyTo?: number;
    } = {},
  ): Promise<Api.Message> {
    const result = await this.client.sendMessage(entity, {
      message,
      parseMode: options.parseMode,
      linkPreview: options.linkPreview !== false,
      silent: options.silent,
      replyTo: options.replyTo,
    });

    return result;
  }

  /**
   * 发送文件
   * @param entity 目标实体
   * @param file 文件路径或 Buffer
   * @param options 发送选项
   */
  async sendFile(
    entity: string | Api.TypeEntityLike,
    file: string | Buffer,
    options: {
      caption?: string;
      parseMode?: 'html' | 'md';
      silent?: boolean;
      replyTo?: number;
    } = {},
  ): Promise<Api.Message> {
    const result = await this.client.sendFile(entity, {
      file,
      caption: options.caption,
      parseMode: options.parseMode,
      silent: options.silent,
      replyTo: options.replyTo,
    });

    return result;
  }

  /**
   * 获取对话列表
   * @param limit 限制数量
   */
  async getDialogs(limit: number = 100): Promise<Dialog[]> {
    const dialogs = await this.client.getDialogs({ limit });
    return Array.from(dialogs);
  }

  /**
   * 获取聊天历史消息
   * @param entity 目标实体
   * @param options 获取选项
   */
  async getMessages(
    entity: string | Api.TypeEntityLike,
    options: {
      limit?: number;
      offsetId?: number;
      minId?: number;
      maxId?: number;
    } = {},
  ): Promise<Api.Message[]> {
    const messages = await this.client.getMessages(entity, {
      limit: options.limit || 100,
      offsetId: options.offsetId,
      minId: options.minId,
      maxId: options.maxId,
    });

    return messages;
  }

  /**
   * 添加消息事件处理器
   * @param handler 处理器函数
   */
  onMessage(handler: (event: NewMessageEvent) => Promise<void> | void): void {
    this.messageHandlers.push(handler);
  }

  /**
   * 调用原始 API 方法
   * @param request API 请求对象
   */
  async invoke<T extends Api.AnyRequest>(request: T): Promise<T['__response']> {
    return await this.client.invoke(request);
  }

  /**
   * 获取实体信息
   * @param entity 实体标识符
   */
  async getEntity(entity: string | Api.TypeEntityLike): Promise<any> {
    return await this.client.getEntity(entity);
  }

  /**
   * 检查是否已授权
   */
  async isAuthorized(): Promise<boolean> {
    return await this.client.isUserAuthorized();
  }

  /**
   * 下载媒体文件
   * @param message 包含媒体的消息
   * @param options 下载选项
   */
  async downloadMedia(
    message: Api.Message,
    options: {
      file?: string;
      thumb?: number;
    } = {},
  ): Promise<Buffer | string | undefined> {
    return await this.client.downloadMedia(message, options);
  }

  /**
   * 标记消息为已读
   * @param entity 目标实体
   * @param maxId 最大消息ID
   */
  async markAsRead(
    entity: string | Api.TypeEntityLike,
    maxId?: number,
  ): Promise<void> {
    await this.client.markAsRead(entity, maxId);
  }

  /**
   * 获取参与者列表（群组/频道）
   * @param entity 目标实体
   * @param options 获取选项
   */
  async getParticipants(
    entity: string | Api.TypeEntityLike,
    options: {
      limit?: number;
      search?: string;
      filter?: Api.TypeChannelParticipantsFilter;
    } = {},
  ): Promise<Api.User[]> {
    const participants = await this.client.getParticipants(entity, options);
    return participants;
  }

  /**
   * 转发消息
   * @param fromEntity 源实体
   * @param messageIds 消息ID数组
   * @param toEntity 目标实体
   */
  async forwardMessages(
    fromEntity: string | Api.TypeEntityLike,
    messageIds: number[],
    toEntity: string | Api.TypeEntityLike,
  ): Promise<Api.Message[]> {
    const result = await this.client.forwardMessages(toEntity, {
      messages: messageIds,
      fromPeer: fromEntity,
    });
    return result;
  }

  // ============ 静态方法：两步认证API ============

  /**
   * 步骤1：发送手机号请求验证码
   * @param config 配置对象
   * @param config.apiId API ID
   * @param config.apiHash API Hash
   * @param config.phoneNumber 电话号码 (格式: +1234567890)
   * @param config.proxy 代理配置（可选）
   * @param config.password 两步验证密码（可选）
   * @returns Promise<AuthData> 认证数据对象，可直接传入submitPhoneCodeAndGetSession
   */
  static async sendPhoneCode(config: {
    apiId: number;
    apiHash: string;
    phoneNumber: string;
    proxy?: ProxyConfig | string;
    password?: string;
  }): Promise<AuthData> {
    // 创建临时客户端
    const { apiId, apiHash, phoneNumber, proxy } = config;
    const { tempClient, proxyConfig } = await TelegramJSBase.createTempClient(
      apiId,
      apiHash,
      '',
      proxy,
    );

    try {
      await tempClient.connect();

      // 使用原始API发送验证码
      const result = await tempClient.invoke(
        new Api.auth.SendCode({
          phoneNumber,
          apiId,
          apiHash,
          settings: new Api.CodeSettings({
            allowFlashcall: false,
            currentNumber: false,
            allowAppHash: false,
            allowMissedCall: false,
            logoutTokens: [],
          }),
        }),
      );

      // 保存临时会话
      let tempSessionString = '';
      if (tempClient.session instanceof StringSession) {
        tempSessionString = tempClient.session.save() || '';
      }

      await tempClient.disconnect();

      return {
        tempSessionString,
        phoneCodeHash: (result as any).phoneCodeHash,
        apiId,
        apiHash,
        phoneNumber,
        proxy,
        password: config.password,
      };
    } catch (error) {
      await tempClient.disconnect();
      throw error;
    }
  }

  /**
   * 步骤2：提交验证码获取最终 session
   * @param authData 从sendPhoneCode返回的认证数据对象
   * @param phoneCode 从手机收到的验证码
   * @returns Promise<string> 最终的会话字符串
   */
  static async submitPhoneCodeAndGetSession(
    authData: AuthData,
    phoneCode: string,
  ): Promise<string> {
    // 使用临时会话创建客户端
    const { tempClient } = await TelegramJSBase.createTempClient(
      authData.apiId,
      authData.apiHash,
      authData.tempSessionString,
      authData.proxy,
    );

    try {
      await tempClient.connect();

      try {
        // 尝试使用验证码登录
        await tempClient.invoke(
          new Api.auth.SignIn({
            phoneNumber: authData.phoneNumber,
            phoneCodeHash: authData.phoneCodeHash,
            phoneCode,
          }),
        );
      } catch (error: any) {
        // 如果需要两步验证密码
        if (error.errorMessage === 'SESSION_PASSWORD_NEEDED') {
          if (!authData.password) {
            throw new Error('Two-factor authentication password required');
          }

          const passwordInfo = await tempClient.invoke(
            new Api.account.GetPassword(),
          );
          await tempClient.invoke(
            new Api.auth.CheckPassword({
              password: await (tempClient as any).computeCheck(
                passwordInfo,
                authData.password,
              ),
            }),
          );
        } else {
          throw error;
        }
      }

      // 获取最终会话字符串
      let sessionString = '';
      if (tempClient.session instanceof StringSession) {
        sessionString = tempClient.session.save() || '';
      }

      await tempClient.disconnect();
      return sessionString;
    } catch (error) {
      await tempClient.disconnect();
      throw error;
    }
  }

  /**
   * 辅助方法：创建临时客户端
   */
  private static async createTempClient(
    apiId: number,
    apiHash: string,
    sessionString: string,
    proxy?: ProxyConfig | string,
  ): Promise<{ tempClient: TelegramClient; proxyConfig: any }> {
    const tempSession = new StringSession(sessionString);

    // 处理代理配置
    let proxyConfig: any = undefined;
    if (proxy) {
      let parsedProxy: ProxyConfig;

      if (typeof proxy === 'string') {
        // 解析代理URL
        const tempInstance = new TelegramJSBase(apiId, apiHash);
        parsedProxy = tempInstance.parseProxyUrl(proxy);
      } else {
        parsedProxy = proxy;
      }

      if (parsedProxy.MTProxy && parsedProxy.secret) {
        proxyConfig = {
          MTProxy: true,
          secret: parsedProxy.secret,
          ip: parsedProxy.ip,
          port: parsedProxy.port,
        };
      } else {
        proxyConfig = {
          socksType: parsedProxy.socksType || 5,
          ip: parsedProxy.ip,
          port: parsedProxy.port,
          username: parsedProxy.username,
          password: parsedProxy.password,
        };
      }
    }

    const tempClient = new TelegramClient(tempSession, apiId, apiHash, {
      connectionRetries: 5,
      useWSS: proxy ? false : true,
      proxy: proxyConfig,
    });

    return { tempClient, proxyConfig };
  }
}
