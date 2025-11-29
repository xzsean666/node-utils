/**
 * Cron 表达式工具类
 * 推荐安装 cron-parser 包以获得更完整的功能: pnpm add cron-parser @types/cron-parser
 */

import CronExpressionParser from 'cron-parser';

export interface CronNextExecutions {
  next: Date;
  nextFive: Date[];
  nextTimestamp: number;
  nextFiveTimestamps: number[];
}

export interface CronField {
  second?: string;
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

export class CronHelper {
  /**
   * 解析 cron 表达式并返回下一次执行时间
   * @param cronExpression cron 表达式
   * @returns 下一次执行时间
   */
  static calculateNextExecution(cronExpression: string): Date {
    try {
      const cronExpression_parsed = CronExpressionParser.parse(cronExpression);
      return cronExpression_parsed.next().toDate();
    } catch (error) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }
  }

  /**
   * 解析 cron 表达式并返回下一次执行时间的时间戳
   * @param cronExpression cron 表达式
   * @returns 下一次执行时间的 Unix 时间戳（毫秒）
   */
  static calculateNextExecutionTimestamp(cronExpression: string): number {
    return CronHelper.calculateNextExecution(cronExpression).getTime();
  }

  /**
   * 获取接下来的多次执行时间
   * @param cronExpression cron 表达式
   * @param count 获取的次数
   * @returns 执行时间数组（包含Date对象和时间戳）
   */
  static calculateNextExecutions(
    cronExpression: string,
    count = 5,
  ): CronNextExecutions {
    try {
      const cronExpression_parsed = CronExpressionParser.parse(cronExpression);

      const nextExecutions: Date[] = [];
      for (let i = 0; i < count; i++) {
        nextExecutions.push(cronExpression_parsed.next().toDate());
      }

      const nextFiveTimestamps = nextExecutions.map((date) => date.getTime());

      return {
        next: nextExecutions[0],
        nextFive: nextExecutions,
        nextTimestamp: nextFiveTimestamps[0],
        nextFiveTimestamps,
      };
    } catch (error) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }
  }

  /**
   * 验证 cron 表达式
   * @param cronExpression cron 表达式
   * @returns 是否有效
   */
  static validateCronExpression(cronExpression: string): boolean {
    try {
      CronExpressionParser.parse(cronExpression);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 解析 cron 表达式的各个字段
   * @param cronExpression cron 表达式
   * @returns 解析后的字段对象
   */
  static parseCronFields(cronExpression: string): CronField {
    const parts = cronExpression.trim().split(' ');

    if (parts.length === 5) {
      // 标准 5 字段格式: 分 时 日 月 周
      return {
        minute: parts[0],
        hour: parts[1],
        dayOfMonth: parts[2],
        month: parts[3],
        dayOfWeek: parts[4],
      };
    } else if (parts.length === 6) {
      // 6 字段格式: 秒 分 时 日 月 周
      return {
        second: parts[0],
        minute: parts[1],
        hour: parts[2],
        dayOfMonth: parts[3],
        month: parts[4],
        dayOfWeek: parts[5],
      };
    } else {
      throw new Error('Cron expression must have 5 or 6 fields');
    }
  }

  /**
   * 生成人类可读的 cron 描述
   * @param cronExpression cron 表达式
   * @returns 描述字符串
   */
  static describeCron(cronExpression: string): string {
    try {
      const fields = CronHelper.parseCronFields(cronExpression);

      // 这里是简化版描述，实际可以使用 cronstrue 包来生成更准确的描述
      let description = '';

      if (fields.minute === '*') {
        description += '每分钟';
      } else if (fields.minute.includes('/')) {
        const interval = fields.minute.split('/')[1];
        description += `每${interval}分钟`;
      } else {
        description += `在第${fields.minute}分钟`;
      }

      if (fields.hour === '*') {
        description += '的每小时';
      } else {
        description += `的${fields.hour}点`;
      }

      return description;
    } catch {
      return '无效的 cron 表达式';
    }
  }

  /**
   * 常用的 cron 表达式模板
   */
  static readonly COMMON_PATTERNS = {
    EVERY_MINUTE: '* * * * *',
    EVERY_5_MINUTES: '*/5 * * * *',
    EVERY_15_MINUTES: '*/15 * * * *',
    EVERY_30_MINUTES: '*/30 * * * *',
    EVERY_HOUR: '0 * * * *',
    EVERY_DAY_AT_MIDNIGHT: '0 0 * * *',
    EVERY_DAY_AT_NOON: '0 12 * * *',
    EVERY_WEEK_SUNDAY: '0 0 * * 0',
    EVERY_MONTH_FIRST_DAY: '0 0 1 * *',
    EVERY_YEAR_JANUARY_FIRST: '0 0 1 1 *',
  };

  /**
   * 生成 cron 表达式
   * @param options 时间选项
   * @returns cron 表达式
   */
  static generateCronExpression(options: {
    minute?: number;
    hour?: number;
    dayOfMonth?: number;
    month?: number;
    dayOfWeek?: number;
  }): string {
    const {
      minute = '*',
      hour = '*',
      dayOfMonth = '*',
      month = '*',
      dayOfWeek = '*',
    } = options;

    return `${minute} ${hour} ${dayOfMonth} ${month} ${dayOfWeek}`;
  }
}

export default CronHelper;
