/**
 * WebSocket 帮助类
 * 提供 WebSocket 连接管理、消息发送和接收、事件处理等功能
 */
import WebSocket from "ws"; // 导入 ws 包
import { HttpsProxyAgent } from "https-proxy-agent"; // 导入代理支持

export class WssHelper {
  private ws: WebSocket | null = null;
  private url: string;
  private proxyUrl: string | null = null;
  private autoReconnect: boolean;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number;
  private reconnectInterval: number;
  private heartbeatInterval: number;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private messageListeners: Map<string, ((data: any) => void)[]> = new Map();
  private statusListeners: ((status: ConnectionStatus) => void)[] = [];

  /**
   * 连接状态枚举
   */
  public static ConnectionStatus = {
    CONNECTING: "connecting",
    CONNECTED: "connected",
    DISCONNECTED: "disconnected",
    RECONNECTING: "reconnecting",
    ERROR: "error",
  } as const;

  /**
   * 构造函数
   * @param url WebSocket 服务器地址
   * @param options 配置选项
   */
  constructor(
    url: string,
    options: {
      autoReconnect?: boolean;
      maxReconnectAttempts?: number;
      reconnectInterval?: number;
      heartbeatInterval?: number;
      proxyUrl?: string;
    } = {}
  ) {
    this.url = url;
    this.proxyUrl = options.proxyUrl || null;
    this.autoReconnect = options.autoReconnect ?? true;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.reconnectInterval = options.reconnectInterval ?? 3000;
    this.heartbeatInterval = options.heartbeatInterval ?? 30000;
  }

  /**
   * 连接 WebSocket 服务器
   * @returns 返回一个 Promise，连接成功则 resolve，否则 reject
   */
  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.notifyStatusChange(WssHelper.ConnectionStatus.CONNECTING);

        // 创建 WebSocket 连接（可能带有代理）
        if (this.proxyUrl) {
          // 使用代理创建连接
          const agent = new HttpsProxyAgent(this.proxyUrl);
          this.ws = new WebSocket(this.url, { agent });
        } else {
          // 不使用代理
          this.ws = new WebSocket(this.url);
        }

        // 设置事件处理程序
        this.ws.on("open", () => {
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.notifyStatusChange(WssHelper.ConnectionStatus.CONNECTED);
          resolve();
        });

        this.ws.on("close", () => {
          this.stopHeartbeat();
          this.notifyStatusChange(WssHelper.ConnectionStatus.DISCONNECTED);

          if (this.autoReconnect) {
            this.attemptReconnect();
          }
        });

        this.ws.on("error", (error) => {
          this.notifyStatusChange(WssHelper.ConnectionStatus.ERROR);
          reject(error);
        });

        this.ws.on("message", (data) => {
          try {
            // 将数据转换为字符串然后解析
            const message = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (error) {
            console.error("Failed to parse message:", error);
          }
        });
      } catch (error) {
        this.notifyStatusChange(WssHelper.ConnectionStatus.ERROR);
        reject(error);
      }
    });
  }

  /**
   * 发送消息
   * @param type 消息类型
   * @param data 消息数据
   */
  public send(type: string, data: any): void {
    if (!this.isConnected()) {
      throw new Error("WebSocket is not connected");
    }

    const message = JSON.stringify({
      type,
      data,
      timestamp: Date.now(),
    });

    this.ws?.send(message);
  }

  /**
   * 添加消息监听器
   * @param type 消息类型
   * @param listener 监听器回调函数
   */
  public on(type: string, listener: (data: any) => void): void {
    if (!this.messageListeners.has(type)) {
      this.messageListeners.set(type, []);
    }
    this.messageListeners.get(type)?.push(listener);
  }

  /**
   * 移除消息监听器
   * @param type 消息类型
   * @param listener 要移除的监听器回调函数
   */
  public off(type: string, listener: (data: any) => void): void {
    if (!this.messageListeners.has(type)) return;

    const listeners = this.messageListeners.get(type);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * 添加连接状态监听器
   * @param listener 状态监听器回调函数
   */
  public onStatusChange(
    listener: (
      status: (typeof WssHelper.ConnectionStatus)[keyof typeof WssHelper.ConnectionStatus]
    ) => void
  ): void {
    this.statusListeners.push(listener);
  }

  /**
   * 移除连接状态监听器
   * @param listener 要移除的状态监听器回调函数
   */
  public offStatusChange(
    listener: (
      status: (typeof WssHelper.ConnectionStatus)[keyof typeof WssHelper.ConnectionStatus]
    ) => void
  ): void {
    const index = this.statusListeners.indexOf(listener);
    if (index !== -1) {
      this.statusListeners.splice(index, 1);
    }
  }

  /**
   * 断开 WebSocket 连接
   */
  public disconnect(): void {
    this.autoReconnect = false;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * 检查连接状态
   * @returns 是否已连接
   */
  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * 处理接收到的消息
   * @param message 接收到的消息对象
   */
  private handleMessage(message: { type: string; data: any }): void {
    const { type, data } = message;

    // 处理心跳消息
    if (type === "heartbeat") {
      this.send("heartbeat-ack", {});
      return;
    }

    // 通知对应类型的监听器
    const listeners = this.messageListeners.get(type);
    if (listeners) {
      listeners.forEach((listener) => listener(data));
    }
  }

  /**
   * 开始心跳检测
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        this.send("heartbeat", {});
      }
    }, this.heartbeatInterval);
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 尝试重新连接
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn("Maximum reconnect attempts reached");
      return;
    }

    this.notifyStatusChange(WssHelper.ConnectionStatus.RECONNECTING);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      console.log(
        `Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      );
      this.connect().catch(() => {
        // 连接失败，继续尝试重连
      });
    }, this.reconnectInterval);
  }

  /**
   * 通知所有状态监听器
   * @param status 连接状态
   */
  private notifyStatusChange(
    status: (typeof WssHelper.ConnectionStatus)[keyof typeof WssHelper.ConnectionStatus]
  ): void {
    this.statusListeners.forEach((listener) => listener(status));
  }
}

// 导出连接状态类型，方便使用
export type ConnectionStatus =
  (typeof WssHelper.ConnectionStatus)[keyof typeof WssHelper.ConnectionStatus];
