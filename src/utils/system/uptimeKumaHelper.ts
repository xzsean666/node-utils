import { io } from 'socket.io-client';

export interface UptimeKumaConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  token?: string;
}

interface MonitorStatus {
  uptime: number;
  downtime: number;
  ping: number;
  avgPing: number;
  lastPing: number;
  lastCheck: string;
  lastUp: string;
  lastDown: string;
}

interface Monitor {
  id: number;
  name: string;
  status: MonitorStatus;
  [key: string]: any; // 允许其他属性
}

type MonitorInProgress = Omit<Monitor, 'uptime' | 'stats'> & {
  uptime?: Partial<Monitor['uptime']>;
  stats?: Partial<Monitor['stats']>;
};

export class UptimeKumaHelper {
  private socket: any;
  private connected: boolean = false;
  private connectPromise: Promise<void>;
  private config: UptimeKumaConfig;
  private token: string | null = null;

  constructor(config: UptimeKumaConfig) {
    this.config = config;
    this.token = config.token || null;
    this.socket = io(config.baseUrl);

    this.connectPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Socket connection timeout'));
      }, 10000);

      this.socket.on('connect', async () => {
        this.connected = true;
        clearTimeout(timeout);
        try {
          if (this.token) {
            await this.loginByToken(this.token);
          } else if (this.config.username && this.config.password) {
            await this.login();
          } else {
            throw new Error('Neither token nor credentials provided');
          }
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      this.socket.on('connect_error', (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
    });
  }

  private async login(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.emit(
        'login',
        {
          username: this.config.username,
          password: this.config.password,
        },
        (response: any) => {
          if (response.ok) {
            this.token = response.token;
            resolve();
          } else if (response.tokenRequired) {
            reject(new Error('2FA token required'));
          } else {
            reject(new Error(response.msg || 'Login failed'));
          }
        },
      );
    });
  }

  private async loginByToken(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.emit('loginByToken', token, (response: any) => {
        if (response.ok) {
          this.token = token;
          resolve();
        } else {
          reject(new Error(response.msg || 'Token login failed'));
        }
      });
    });
  }

  async logout(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.emit('logout', (response: any) => {
        this.token = null;
        resolve();
      });
    });
  }

  private async waitForConnection(): Promise<void> {
    if (this.connected) return;
    await this.connectPromise;
  }

  private async emitAsync(event: string, ...args: any[]): Promise<any> {
    await this.waitForConnection();

    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('Socket not connected'));
        return;
      }

      this.socket.emit(event, ...args, (response: any) => {
        if (response.ok) {
          resolve(response.data || response);
        } else {
          reject(new Error(response.msg || 'Unknown error'));
        }
      });
    });
  }

  async getMonitors(): Promise<Monitor[]> {
    return new Promise((resolve, reject) => {
      let monitors: Monitor[] = [];
      let heartbeatListReceived = new Set();

      this.socket.once('monitorList', async (data: any) => {
        if (typeof data === 'object') {
          monitors = Object.values(data).map((monitor: any) => ({
            ...monitor,
            status: {
              uptime: 0,
              downtime: 0,
              ping: 0,
              avgPing: 0,
              lastPing: 0,
              lastCheck: '',
              lastUp: '',
              lastDown: '',
            },
          }));

          // 为每个监控请求心跳列表
          monitors.forEach((monitor) => {
            if (monitor && monitor.id) {
              this.socket.emit('getHeartbeatList', monitor.id, 24);
            }
          });
        } else {
          monitors = [];
        }

        if (!monitors || monitors.length === 0) {
          resolve(monitors);
          return;
        }
      });

      // 监听心跳列表数据
      this.socket.on(
        'heartbeatList',
        (monitorId: number, heartbeatList: any[]) => {
          heartbeatListReceived.add(monitorId);
          const monitor = monitors.find((m) => m.id === Number(monitorId));
          if (monitor && heartbeatList && heartbeatList.length > 0) {
            // 计算平均响应时间
            const avgPing =
              heartbeatList.reduce((sum, hb) => sum + (hb.ping || 0), 0) /
              heartbeatList.length;

            // 计算24小时在线率
            const totalBeats = heartbeatList.length;
            const upBeats = heartbeatList.filter(
              (hb) => hb.status === 1,
            ).length;
            const uptimePercentage = (upBeats / totalBeats) * 100;

            // 获取最新的心跳
            const latestHeartbeat = heartbeatList[heartbeatList.length - 1];

            // 获取最后一次宕机时间
            const lastDown =
              heartbeatList.reverse().find((hb) => hb.status === 0)?.time || '';

            // 更新状态信息
            monitor.status = {
              uptime: uptimePercentage,
              downtime: 100 - uptimePercentage,
              ping: latestHeartbeat.ping || 0,
              avgPing: avgPing,
              lastPing: latestHeartbeat.time || '',
              lastCheck: latestHeartbeat.time || '',
              lastUp: latestHeartbeat.status === 1 ? latestHeartbeat.time : '',
              lastDown: lastDown,
            };
          }

          // 检查是否所有监控的心跳数据都已收到
          if (heartbeatListReceived.size === monitors.length) {
            resolve(monitors);
          }
        },
      );

      // 设置超时保护
      setTimeout(() => {
        resolve(monitors);
      }, 20000);

      this.emitAsync('getMonitorList').catch(reject);
    });
  }

  async getMonitorStatus(monitorId: number): Promise<Monitor> {
    const response = await this.emitAsync('getMonitor', monitorId);
    return response.monitor;
  }

  async createMonitor(data: {
    name: string;
    type: string;
    url: string;
    interval?: number;
    retryInterval?: number;
  }): Promise<any> {
    return this.emitAsync('addMonitor', data);
  }

  async updateMonitor(monitorId: number, data: any): Promise<any> {
    return this.emitAsync('editMonitor', {
      id: monitorId,
      ...data,
    });
  }

  async deleteMonitor(monitorId: number): Promise<any> {
    return this.emitAsync('deleteMonitor', monitorId);
  }

  async pauseMonitor(monitorId: number): Promise<any> {
    return this.emitAsync('pauseMonitor', monitorId);
  }

  async resumeMonitor(monitorId: number): Promise<any> {
    return this.emitAsync('resumeMonitor', monitorId);
  }

  async getMonitorBeats(monitorId: number, period: number): Promise<any> {
    return this.emitAsync('getMonitorBeats', monitorId, period);
  }

  async clearEvents(monitorId: number): Promise<any> {
    return this.emitAsync('clearEvents', monitorId);
  }

  async clearHeartbeats(monitorId: number): Promise<any> {
    return this.emitAsync('clearHeartbeats', monitorId);
  }

  async close(): Promise<void> {
    if (this.socket) {
      this.socket.disconnect();
      this.socket.close();
      this.connected = false;
      this.socket = null;
    }
  }
}
