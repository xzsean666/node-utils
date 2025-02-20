import axios from 'axios';

interface SystemMetrics {
  current: {
    cpu: {
      total: number;
      details: { [key: string]: number };
    };
    memory: any;
  };
  average: {
    cpu: number;
    memory: any;
  };
}

export class NetDataHelper {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = `${baseUrl}/api/v1`;
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
  async getDiskUsage() {
    try {
      const response = await axios.get(
        `${this.baseUrl}/data?chart=disk_space._`,
      );
      return response.data;
    } catch (error) {
      console.error('获取磁盘使用情况失败:', error);
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
      console.log(memoryAvg);

      return {
        current: {
          cpu: {
            total: Number(currentCpuTotal.toFixed(2)),
            details: {
              user: cpuData.data[0][1],
              system: cpuData.data[0][2],
              nice: cpuData.data[0][3],
              iowait: cpuData.data[0][4],
              irq: cpuData.data[0][5],
              softirq: cpuData.data[0][6],
              steal: cpuData.data[0][7],
              guest: cpuData.data[0][8],
              guest_nice: cpuData.data[0][9],
            },
          },
          memory: {
            total: totalMemory,
            free: freeMemory,
            used: usedMemory,
            cached: cachedMemory,
            buffers: buffersMemory,
            usedPercentage: Number(
              ((usedMemory / totalMemory) * 100).toFixed(2),
            ),
          },
        },
        average: {
          cpu: cpuAvg,
          memory: memoryAvg,
        },
      };
    } catch (error) {
      console.error('获取系统指标失败:', error);
      throw error;
    }
  }
}
