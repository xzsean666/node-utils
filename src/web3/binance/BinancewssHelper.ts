import WebSocket from "ws";
import EventEmitter from "events";
import * as https from "https";
import * as http from "http";

export interface BinanceStreamConfig {
  streams: string[];
  isTestnet?: boolean;
  directUrl?: string;
  reconnectOnClose?: boolean;
  requestTimeout?: number;
  connectionTimeout?: number;
  enableHeartbeat?: boolean;
  heartbeatInterval?: number;
  proxy?: string;
}

export interface BinanceStreamMessage {
  stream: string;
  data: any;
  time?: number;
}

export class BinanceWssHelper extends EventEmitter {
  private ws: WebSocket | null = null;
  private baseUrl: string;
  private streams: string[];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 3000;
  private pingInterval: NodeJS.Timeout | null = null;
  private isConnected = false;
  private directUrl?: string;
  private reconnectOnClose: boolean;
  private requestTimeout: number;
  private connectionTimeout: number;
  private enableHeartbeat: boolean;
  private heartbeatInterval: number;
  private proxy?: string;
  private connectionTimer?: NodeJS.Timeout;

  constructor(config: BinanceStreamConfig) {
    super();
    this.streams = config.streams;
    this.directUrl = config.directUrl;
    this.baseUrl = config.isTestnet
      ? "wss://stream.binancefuture.com/stream?streams="
      : "wss://fstream.binance.com/stream?streams=";
    this.reconnectOnClose = config.reconnectOnClose !== false;
    this.requestTimeout = config.requestTimeout || 30000;
    this.connectionTimeout = config.connectionTimeout || 10000;
    this.enableHeartbeat = config.enableHeartbeat !== false;
    this.heartbeatInterval = config.heartbeatInterval || 30000;
    this.proxy = config.proxy;

    console.log(`BinanceWssHelper initialized with base URL: ${this.baseUrl}`);
    if (this.directUrl) {
      console.log(`Using direct URL: ${this.directUrl}`);
    }
  }

  /**
   * Connect to Binance WebSocket streams
   */
  public connect(): void {
    if (this.isConnected) {
      console.warn("WebSocket is already connected");
      return;
    }

    let streamUrl;
    if (this.directUrl) {
      streamUrl = this.directUrl;
    } else {
      streamUrl = `${this.baseUrl}${this.streams.join("/")}`;
    }
    console.log(`Connecting to WebSocket URL: ${streamUrl}`);

    try {
      // 连接之前检查是否可以访问 Binance
      this.checkConnection(streamUrl)
        .then((canConnect) => {
          if (!canConnect) {
            console.warn(
              "Unable to ping Binance server, but still trying to connect"
            );
          }

          // 创建 WebSocket 实例
          const wsOptions: WebSocket.ClientOptions = {
            handshakeTimeout: this.connectionTimeout,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            },
          };

          // 如果设置了代理
          if (this.proxy) {
            const proxyUrl = new URL(this.proxy);
            wsOptions.agent = proxyUrl.protocol.startsWith("https")
              ? new https.Agent({
                  host: proxyUrl.hostname,
                  port: Number(proxyUrl.port),
                })
              : new http.Agent({
                  host: proxyUrl.hostname,
                  port: Number(proxyUrl.port),
                });
          }

          this.ws = new WebSocket(streamUrl, wsOptions);

          // 设置连接超时
          this.connectionTimer = setTimeout(() => {
            if (!this.isConnected && this.ws) {
              console.error(
                `WebSocket connection timeout after ${this.connectionTimeout}ms`
              );
              this.ws.terminate();
              this.emit("error", new Error("Connection timeout"));
            }
          }, this.connectionTimeout);

          this.ws.on("open", () => {
            console.log("WebSocket connection established");
            this.isConnected = true;
            this.reconnectAttempts = 0;

            // 清除连接超时计时器
            if (this.connectionTimer) {
              clearTimeout(this.connectionTimer);
              this.connectionTimer = undefined;
            }

            this.emit("connected");

            // Start ping interval to keep connection alive
            if (this.enableHeartbeat) {
              this.pingInterval = setInterval(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                  this.ws.ping();
                }
              }, this.heartbeatInterval);
            }
          });

          this.ws.on("pong", () => {
            console.log("Received pong from server");
          });

          this.ws.on("message", (data: WebSocket.Data) => {
            try {
              console.log(
                `Raw message received: ${data.toString().substring(0, 200)}...`
              );
              const message = JSON.parse(
                data.toString()
              ) as BinanceStreamMessage;
              message.time = Date.now();

              this.emit("message", message);

              // Also emit events for specific stream types
              if (message.stream) {
                this.emit(message.stream, message.data);
              }
            } catch (error) {
              console.error("Error parsing WebSocket message:", error);
              console.error(
                "Raw message data:",
                data.toString().substring(0, 200)
              );
            }
          });

          this.ws.on("error", (error) => {
            console.error("WebSocket error:", error);
            this.emit("error", error);
          });

          this.ws.on("close", (code, reason) => {
            console.log(`WebSocket connection closed: ${code} ${reason}`);
            this.isConnected = false;

            // 清除计时器
            if (this.connectionTimer) {
              clearTimeout(this.connectionTimer);
              this.connectionTimer = undefined;
            }

            if (this.pingInterval) {
              clearInterval(this.pingInterval);
              this.pingInterval = null;
            }

            this.emit("disconnected", { code, reason });

            if (this.reconnectOnClose) {
              this.reconnect();
            }
          });

          // Add a timeout to check connection status
          setTimeout(() => {
            if (!this.isConnected) {
              console.log(
                "WebSocket connection hasn't been established after 5 seconds"
              );
            }
          }, 5000);
        })
        .catch((error) => {
          console.error("Error checking connection:", error);
        });
    } catch (error) {
      console.error("Error creating WebSocket connection:", error);
    }
  }

  /**
   * Check if we can connect to Binance server
   */
  private async checkConnection(url: string): Promise<boolean> {
    try {
      // 解析 URL 获取主机名
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname;

      return new Promise((resolve) => {
        const req = https.request(
          {
            hostname,
            port: 443,
            path: "/",
            method: "HEAD",
            timeout: 5000,
          },
          (res) => {
            resolve(res.statusCode !== undefined);
          }
        );

        req.on("error", () => {
          resolve(false);
        });

        req.on("timeout", () => {
          req.destroy();
          resolve(false);
        });

        req.end();
      });
    } catch (error) {
      console.error("Error checking connection:", error);
      return false;
    }
  }

  /**
   * Reconnect to WebSocket after connection is closed
   */
  private reconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnection attempts reached");
      this.emit("reconnect_failed");
      return;
    }

    this.reconnectAttempts++;
    console.log(
      `Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
    );

    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  /**
   * Close the WebSocket connection
   */
  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = undefined;
    }

    this.isConnected = false;
    console.log("WebSocket connection closed");
  }

  /**
   * Check if WebSocket is connected
   */
  public isWebSocketConnected(): boolean {
    return (
      this.isConnected &&
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN
    );
  }

  /**
   * Add a new stream to the existing connection
   * @param stream Stream name to add
   */
  public addStream(stream: string): void {
    if (this.streams.includes(stream)) {
      console.warn(`Stream ${stream} is already subscribed`);
      return;
    }

    this.streams.push(stream);
    if (this.isConnected) {
      // Need to reconnect to apply new streams
      this.disconnect();
      this.connect();
    }
  }

  /**
   * Remove a stream from the existing connection
   * @param stream Stream name to remove
   */
  public removeStream(stream: string): void {
    const index = this.streams.indexOf(stream);
    if (index === -1) {
      console.warn(`Stream ${stream} is not subscribed`);
      return;
    }

    this.streams.splice(index, 1);
    if (this.isConnected && this.streams.length > 0) {
      // Need to reconnect to apply stream changes
      this.disconnect();
      this.connect();
    } else if (this.streams.length === 0) {
      this.disconnect();
    }
  }
}
