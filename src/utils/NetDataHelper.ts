import axios from 'axios';

interface SystemMetrics {
  current: {
    cpu: any;
    memory: any;
    network: any;
    diskio: any;
    disk: any;
  };
  average: {
    cpu: any;
    memory: any;
    network: any;
    diskio: any;
    disk: any;
  };
}

export class NetDataHelper {
  baseUrl: string;
  domain: string;

  constructor(baseUrl: string) {
    this.baseUrl = `${baseUrl}/api/v1`;
    this.domain = baseUrl.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
  }

  async getAllCharts() {
    const response = await axios.get(`${this.baseUrl}/charts`);
    return response.data;
  }
  /**
   * 获取系统基础信息
   */
  async getSystemInfo() {
    try {
      const response = await axios.get(`${this.baseUrl}/info`);
      return response.data;
    } catch (error) {
      console.error('获取系统信息失败:', error);
      throw error;
    }
  }

  /**
   * 获取CPU使用率
   */
  async getCPUUsage() {
    try {
      const response = await axios.get(`${this.baseUrl}/data?chart=system.cpu`);
      return response.data;
    } catch (error) {
      console.error('获取CPU使用率失败:', error);
      throw error;
    }
  }

  /**
   * 获取内存使用情况
   */
  async getMemoryUsage() {
    try {
      const response = await axios.get(`${this.baseUrl}/data?chart=system.ram`);
      return response.data;
    } catch (error) {
      console.error('获取内存使用情况失败:', error);
      throw error;
    }
  }

  /**
   * 获取磁盘使用情况
   */
  async getDiskIO() {
    try {
      const response = await axios.get(`${this.baseUrl}/data?chart=system.io`);
      return response.data;
    } catch (error) {
      console.error('Failed to get disk usage:', error);
      throw error;
    }
  }
  async getAverageDiskIO() {
    const data = await this.getDiskIO();
    const dataCount = data.data.length;
    let count60 = 0; // 添加计数器用于计算平均值
    let average60 = { read: 0, write: 0 };
    let average600 = { read: 0, write: 0 };
    for (const item of data.data) {
      if (count60 <= 60) {
        average60.read += item[1];
        average60.write += item[2];
        count60++;
      }
      average600.read += item[1];
      average600.write += item[2];
    }
    return {
      average60: {
        read: Number((average60.read / 60).toFixed(2)) || 0,
        write: Math.abs(Number((average60.write / 60).toFixed(2))) || 0,
      },
      average600: {
        read: Number((average600.read / dataCount).toFixed(2)) || 0,
        write: Math.abs(Number((average600.write / dataCount).toFixed(2))) || 0,
      },
    };
  }
  async getDiskUsage() {
    try {
      const response = await axios.get(
        `${this.baseUrl}/data?chart=disk_space./&format=json&points=1`,
      );

      const data = response.data;
      if (!data || !data.data || !data.data[0]) {
        throw new Error('Invalid disk space data');
      }

      // 正确解析数据顺序：[timestamp, avail, used, reserved]
      const [timestamp, avail, used] = data.data[0];
      const total = used + avail;
      const used_percent = (used / total) * 100;

      return {
        used_percent: Number(used_percent.toFixed(2)),
        avail,
        used,
        total,
      };
    } catch (error) {
      console.error('Failed to get disk space usage:', error);
      throw error;
    }
  }

  /**
   * 获取网络流量信息
   */
  async getNetworkTraffic() {
    try {
      const response = await axios.get(`${this.baseUrl}/data?chart=system.net`);
      return response.data;
    } catch (error) {
      console.error('获取网络流量信息失败:', error);
      throw error;
    }
  }
  async getAverageNetworkTraffic() {
    try {
      let average60 = { received: 0, sent: 0 };
      let average600 = { received: 0, sent: 0 };
      const data = await this.getNetworkTraffic();
      const dataCount = data.data.length;
      let count60 = 0; // 添加计数器用于计算平均值

      for (const item of data.data) {
        // 修改条件：只统计最近60秒的数据
        if (count60 <= 60) {
          average60.received += item[1];
          average60.sent += item[2];
          count60++;
        }
        average600.received += item[1];
        average600.sent += item[2];
      }

      return {
        average60: {
          received: Number((average60.received / 60).toFixed(2)) || 0,
          sent: Math.abs(Number((average60.sent / 60).toFixed(2))) || 0,
        },
        average600: {
          received: Number((average600.received / dataCount).toFixed(2)) || 0,
          sent: Math.abs(Number((average600.sent / dataCount).toFixed(2))) || 0,
        },
      };
    } catch (error) {
      console.error('Failed to get network traffic info:', error);
      throw error;
    }
  }
  /**
   * 获取CPU平均使用率
   * @param cpuData getCPUUsage()的结果
   * @returns 平均使用率（百分比）
   */
  async getCPUAverageUsage(cpuData: any) {
    try {
      const { data } = cpuData;

      if (Array.isArray(data) && data.length > 0) {
        // 计算所有时间点的CPU使用总和
        const totalUsage = data.reduce((acc, point) => {
          // 跳过第一个时间戳，把所有CPU使用率加起来
          const usageSum = point
            .slice(1)
            .reduce((sum: number, val: number) => sum + val, 0);
          return acc + usageSum;
        }, 0);

        // 计算平均值：总和 / 数据点数量
        return Number((totalUsage / data.length).toFixed(2));
      }
      return 0;
    } catch (error) {
      console.error('获取CPU平均使用率失败:', error);
      throw error;
    }
  }

  /**
   * 获取内存平均使用率
   * @param memData getMemoryUsage()的结果
   * @returns 平均使用内存量（MB）
   */
  getMemoryAverageUsage(memData: any) {
    try {
      const { data } = memData;

      if (Array.isArray(data) && data.length > 0) {
        // 计算平均空闲内存
        const avgFree =
          data.reduce((acc, point) => acc + point[1], 0) / data.length;

        // 计算平均使用内存
        const avgUsed =
          data.reduce((acc, point) => acc + point[2], 0) / data.length;

        // 计算平均缓存
        const avgCached =
          data.reduce((acc, point) => acc + point[3], 0) / data.length;

        // 计算平均缓冲区
        const avgBuffers =
          data.reduce((acc, point) => acc + point[4], 0) / data.length;

        // 计算总内存
        const totalRam = avgFree + avgUsed + avgCached + avgBuffers;

        return {
          total: Number(totalRam.toFixed(2)),
          free: Number(avgFree.toFixed(2)),
          used: Number(avgUsed.toFixed(2)),
          cached: Number(avgCached.toFixed(2)),
          buffers: Number(avgBuffers.toFixed(2)),
          usedPercentage: Number(((avgUsed / totalRam) * 100).toFixed(2)),
        };
      }

      return {
        total: 0,
        free: 0,
        used: 0,
        cached: 0,
        buffers: 0,
        usedPercentage: 0,
      };
    } catch (error) {
      console.error('计算内存平均使用率失败:', error);
      throw error;
    }
  }

  /**
   * 获取系统综合指标（当前值和平均值）
   * @param points 平均值的数据点数量
   * @param duration 平均值的时间范围（秒）
   */
  async getSystemMetrics(
    points: number = 60,
    duration: number = 300,
  ): Promise<SystemMetrics> {
    try {
      const cpuData = await this.getCPUUsage();
      // 处理当前 CPU 数据：跳过时间戳，计算所有 CPU 使用率之和
      const currentCpuTotal = cpuData.data[0]
        .slice(1)
        .reduce((sum: number, val: number) => sum + val, 0);

      // 获取当前内存使用情况
      const memResponse = await this.getMemoryUsage();
      const memData = memResponse.data[0];
      const freeMemory = memData[1]; // 空闲内存
      const usedMemory = memData[2]; // 已使用内存
      const cachedMemory = memData[3]; // 缓存
      const buffersMemory = memData[4]; // 缓冲区
      const totalMemory =
        freeMemory + usedMemory + cachedMemory + buffersMemory; // 总内存

      // 获取CPU平均值
      const cpuAvg = await this.getCPUAverageUsage(cpuData);

      // 获取内存平均值
      const memoryAvg = this.getMemoryAverageUsage(memResponse);

      const networkAvg = await this.getAverageNetworkTraffic();

      const diskIOAvg = await this.getAverageDiskIO();
      const diskUsage = await this.getDiskUsage();
      return {
        current: {
          cpu: {
            data: Number(currentCpuTotal.toFixed(2)),
            symbol: '%',
          },
          memory: {
            data: Number(((usedMemory / totalMemory) * 100).toFixed(2)),
            symbol: '%',
          },
          network: {
            data: networkAvg.average60,
            symbol: 'Kb/s',
          },
          diskio: {
            data: diskIOAvg.average60,
            symbol: 'Kb/s',
          },
          disk: {
            data: diskUsage.used_percent,
            symbol: '%',
          },
        },
        average: {
          cpu: { data: cpuAvg, symbol: '%' },
          memory: { data: memoryAvg.usedPercentage, symbol: '%' },
          network: { data: networkAvg.average600, symbol: 'Kb/s' },
          diskio: { data: diskIOAvg.average600, symbol: 'Kb/s' },
          disk: { data: diskUsage.used_percent, symbol: '%' },
        },
      };
    } catch (error) {
      console.error('获取系统指标失败:', error);
      throw error;
    }
  }
}
