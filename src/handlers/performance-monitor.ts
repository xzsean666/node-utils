/**
 * 性能监控和诊断工具
 * 用于排查GraphQL响应时间问题
 */

export interface PerformanceReport {
  requestId: string;
  method: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  steps: Array<{
    name: string;
    startTime: number;
    endTime: number;
    duration: number;
  }>;
  metadata?: Record<string, any>;
}

export class PerformanceMonitor {
  private static reports: Map<string, PerformanceReport> = new Map();
  private static slowRequests: PerformanceReport[] = [];

  /**
   * 开始性能监控
   */
  static startMonitoring(
    method: string,
    metadata?: Record<string, any>,
  ): string {
    const requestId = Math.random().toString(36).substr(2, 12);
    const report: PerformanceReport = {
      requestId,
      method,
      startTime: performance.now(),
      steps: [],
      metadata,
    };

    this.reports.set(requestId, report);
    return requestId;
  }

  /**
   * 记录步骤
   */
  static recordStep(requestId: string, stepName: string, duration: number) {
    const report = this.reports.get(requestId);
    if (report) {
      report.steps.push({
        name: stepName,
        startTime: report.startTime,
        endTime: report.startTime + duration,
        duration,
      });
    }
  }

  /**
   * 结束监控
   */
  static endMonitoring(requestId: string): PerformanceReport | null {
    const report = this.reports.get(requestId);
    if (report) {
      report.endTime = performance.now();
      report.duration = report.endTime - report.startTime;

      // 如果耗时超过1秒，记录为慢请求
      if (report.duration > 1000) {
        this.slowRequests.push({ ...report });
        // 只保留最近50个慢请求
        if (this.slowRequests.length > 50) {
          this.slowRequests.shift();
        }
      }

      this.reports.delete(requestId);
      return report;
    }
    return null;
  }

  /**
   * 获取慢请求报告
   */
  static getSlowRequestsReport(): PerformanceReport[] {
    return [...this.slowRequests];
  }

  /**
   * 获取性能统计
   */
  static getPerformanceStats() {
    const slowRequests = this.getSlowRequestsReport();
    const now = Date.now();

    // 最近5分钟的慢请求
    const recentSlowRequests = slowRequests.filter(
      (req) => req.startTime > now - 5 * 60 * 1000,
    );

    return {
      totalSlowRequests: slowRequests.length,
      recentSlowRequests: recentSlowRequests.length,
      avgDurationOfSlowRequests:
        slowRequests.length > 0
          ? slowRequests.reduce((sum, req) => sum + (req.duration || 0), 0) /
            slowRequests.length
          : 0,
      topSlowMethods: this.getTopSlowMethods(slowRequests),
    };
  }

  private static getTopSlowMethods(requests: PerformanceReport[]) {
    const methodStats = new Map<
      string,
      { count: number; totalDuration: number }
    >();

    requests.forEach((req) => {
      const existing = methodStats.get(req.method) || {
        count: 0,
        totalDuration: 0,
      };
      existing.count++;
      existing.totalDuration += req.duration || 0;
      methodStats.set(req.method, existing);
    });

    return Array.from(methodStats.entries())
      .map(([method, stats]) => ({
        method,
        count: stats.count,
        avgDuration: stats.totalDuration / stats.count,
      }))
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, 5);
  }

  /**
   * 清理旧数据
   */
  static cleanup() {
    const now = Date.now();
    // 清理超过1小时的慢请求记录
    this.slowRequests = this.slowRequests.filter(
      (req) => req.startTime > now - 60 * 60 * 1000,
    );
  }
}

// 自动清理，每30分钟执行一次
setInterval(
  () => {
    PerformanceMonitor.cleanup();
  },
  30 * 60 * 1000,
);

/**
 * 性能监控装饰器
 */
export function performanceMonitor(methodName?: string) {
  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const monitoredMethodName =
      methodName || `${target.constructor.name}.${propertyName}`;

    descriptor.value = async function (...args: any[]) {
      const requestId = PerformanceMonitor.startMonitoring(
        monitoredMethodName,
        {
          arguments: args.map((arg) =>
            typeof arg === 'object' ? '[object]' : arg,
          ),
        },
      );

      try {
        const result = await originalMethod.apply(this, args);
        const report = PerformanceMonitor.endMonitoring(requestId);

        if (report && report.duration! > 1000) {
          console.warn(
            `[性能监控] ${monitoredMethodName} 慢请求警告 - 耗时: ${report.duration!.toFixed(2)}ms`,
          );
        }

        return result;
      } catch (error) {
        PerformanceMonitor.endMonitoring(requestId);
        throw error;
      }
    };

    return descriptor;
  };
}
