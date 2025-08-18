/**
 * 时间记录装饰器 - 记录函数执行时间并输出日志
 */

/**
 * 时间记录装饰器配置选项
 */
interface TimingDecoratorOptions {
  /** 日志前缀，默认为函数名 */
  prefix?: string;
  /** 是否显示详细信息（开始/结束时间），默认为 false */
  verbose?: boolean;
  /** 自定义日志函数，默认使用 console.log */
  logger?: (message: string) => void;
  /** 时间单位，默认为毫秒 */
  unit?: 'ms' | 's';
}

/**
 * 时间记录装饰器
 * @param options 配置选项
 */
export function TimingDecorator(options: TimingDecoratorOptions = {}) {
  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor,
  ) {
    const method = descriptor.value;
    const {
      prefix = propertyName,
      verbose = false,
      logger = console.log,
      unit = 'ms',
    } = options;

    descriptor.value = async function (...args: any[]) {
      const startTime = performance.now();

      if (verbose) {
        logger(`[${prefix}] 开始执行 - ${new Date().toISOString()}`);
      }

      try {
        // 处理同步和异步函数
        const result = method.apply(this, args);

        if (result && typeof result.then === 'function') {
          // 异步函数
          const asyncResult = await result;
          const endTime = performance.now();
          const duration = endTime - startTime;

          logTiming(prefix, duration, unit, logger, verbose);
          return asyncResult;
        } else {
          // 同步函数
          const endTime = performance.now();
          const duration = endTime - startTime;

          logTiming(prefix, duration, unit, logger, verbose);
          return result;
        }
      } catch (error) {
        const endTime = performance.now();
        const duration = endTime - startTime;

        logger(
          `[${prefix}] 执行失败 - 耗时: ${formatDuration(duration, unit)} - 错误: ${error}`,
        );
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * 简化版时间记录装饰器（使用默认配置）
 */
export function Timing(
  target: any,
  propertyName: string,
  descriptor: PropertyDescriptor,
) {
  return TimingDecorator()(target, propertyName, descriptor);
}

/**
 * 记录时间信息
 */
function logTiming(
  prefix: string,
  duration: number,
  unit: 'ms' | 's',
  logger: (message: string) => void,
  verbose: boolean,
) {
  const formattedDuration = formatDuration(duration, unit);

  if (verbose) {
    logger(
      `[${prefix}] 执行完成 - 耗时: ${formattedDuration} - ${new Date().toISOString()}`,
    );
  } else {
    logger(`[${prefix}] 执行耗时: ${formattedDuration}`);
  }
}

/**
 * 格式化持续时间
 */
function formatDuration(duration: number, unit: 'ms' | 's'): string {
  if (unit === 's') {
    return `${(duration / 1000).toFixed(3)}s`;
  }
  return `${duration.toFixed(2)}ms`;
}

/**
 * 函数式时间记录工具（非装饰器版本）
 */
export async function measureTime<T>(
  fn: () => T | Promise<T>,
  name: string = 'Function',
  options: Omit<TimingDecoratorOptions, 'prefix'> = {},
): Promise<T> {
  const { verbose = false, logger = console.log, unit = 'ms' } = options;

  const startTime = performance.now();

  if (verbose) {
    logger(`[${name}] 开始执行 - ${new Date().toISOString()}`);
  }

  try {
    const result = await fn();
    const endTime = performance.now();
    const duration = endTime - startTime;

    logTiming(name, duration, unit, logger, verbose);
    return result;
  } catch (error) {
    const endTime = performance.now();
    const duration = endTime - startTime;

    logger(
      `[${name}] 执行失败 - 耗时: ${formatDuration(duration, unit)} - 错误: ${error}`,
    );
    throw error;
  }
}

// 使用示例：
/*
// 1. 使用简化装饰器
class MyService {
  @Timing
  async getData() {
    // 模拟异步操作
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { data: 'example' };
  }

  @Timing
  syncMethod() {
    // 同步操作
    return 'sync result';
  }
}

// 2. 使用配置装饰器
class MyAdvancedService {
  @TimingDecorator({
    prefix: 'DatabaseQuery',
    verbose: true,
    unit: 's',
    logger: (msg) => console.log(`🕐 ${msg}`)
  })
  async queryDatabase() {
    // 数据库查询操作
    await new Promise(resolve => setTimeout(resolve, 2000));
    return { rows: [] };
  }
}

// 3. 使用函数式版本
async function example() {
  const result = await measureTime(
    async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      return 'completed';
    },
    'AsyncOperation',
    { verbose: true, unit: 's' }
  );
  console.log(result);
}
*/
