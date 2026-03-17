/**
 * Cron 表达式使用示例
 * 演示如何计算下一次执行时间和使用各种 cron 功能
 */

import { CronHelper } from '../system/cronHelper';

// 常用的 cron 表达式示例
const cronExamples = {
  // 每分钟执行
  everyMinute: '* * * * *',
  // 每5分钟执行
  every5Minutes: '*/5 * * * *',
  // 每小时的第30分钟执行
  every30Minutes: '30 * * * *',
  // 每天凌晨2点执行
  dailyAt2AM: '0 2 * * *',
  // 每周一上午9点执行
  mondayAt9AM: '0 9 * * 1',
  // 每月1号凌晨0点执行
  monthlyFirst: '0 0 1 * *',
  // 工作日（周一到周五）早上8点执行
  weekdaysAt8AM: '0 8 * * 1-5',
  // 每年1月1日凌晨0点执行
  yearlyJan1: '0 0 1 1 *',
};

/**
 * 演示基本的 cron 功能
 */
export function demonstrateCronFeatures() {
  console.log('=== Cron 表达式功能演示 ===\n');

  // 1. 验证 cron 表达式
  console.log('1. 验证 cron 表达式:');
  Object.entries(cronExamples).forEach(([name, expression]) => {
    const isValid = CronHelper.validateCronExpression(expression);
    console.log(
      `   ${name}: ${expression} - ${isValid ? '✅ 有效' : '❌ 无效'}`,
    );
  });

  console.log('\n2. 计算下一次执行时间:');
  Object.entries(cronExamples).forEach(([name, expression]) => {
    try {
      const nextExecution = CronHelper.calculateNextExecution(expression);
      console.log(`   ${name}: ${nextExecution.toLocaleString('zh-CN')}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.log(`   ${name}: ❌ 错误 - ${errorMessage}`);
    }
  });

  console.log('\n3. 获取接下来的5次执行时间:');
  const expression = cronExamples.every5Minutes;
  try {
    const executions = CronHelper.calculateNextExecutions(expression, 5);
    console.log(`   表达式: ${expression}`);
    console.log('   接下来的5次执行时间:');
    executions.nextFive.forEach((time, index) => {
      console.log(`     ${index + 1}. ${time.toLocaleString('zh-CN')}`);
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`   ❌ 错误 - ${errorMessage}`);
  }

  console.log('\n4. Cron 表达式描述:');
  Object.entries(cronExamples).forEach(([name, expression]) => {
    try {
      const description = CronHelper.describeCron(expression);
      console.log(`   ${name}: ${description}`);
    } catch (error) {
      console.log(`   ${name}: ❌ 无法解析`);
    }
  });

  console.log('\n5. 生成 cron 表达式:');
  const generatedExpressions = [
    { name: '每天下午3点', options: { minute: 0, hour: 15 } },
    {
      name: '每月15号中午12点',
      options: { minute: 0, hour: 12, dayOfMonth: 15 },
    },
    {
      name: '每周三上午10点30分',
      options: { minute: 30, hour: 10, dayOfWeek: 3 },
    },
  ];

  generatedExpressions.forEach(({ name, options }) => {
    const expression = CronHelper.generateCronExpression(options);
    console.log(`   ${name}: ${expression}`);
  });

  console.log('\n6. 常用模板:');
  Object.entries(CronHelper.COMMON_PATTERNS).forEach(([name, pattern]) => {
    console.log(`   ${name}: ${pattern}`);
  });
}

/**
 * 演示在实际业务中的使用
 */
export function demonstrateBusinessUsage() {
  console.log('\n=== 业务场景使用示例 ===\n');

  // 任务调度示例
  const tasks = [
    {
      id: 'backup-task',
      name: '数据备份任务',
      cronExpression: '0 2 * * *', // 每天凌晨2点
    },
    {
      id: 'report-task',
      name: '生成报表任务',
      cronExpression: '0 9 * * 1', // 每周一上午9点
    },
    {
      id: 'cleanup-task',
      name: '清理临时文件任务',
      cronExpression: '*/30 * * * *', // 每30分钟
    },
  ];

  console.log('任务调度计划:');
  tasks.forEach((task) => {
    console.log(`\n📋 ${task.name} (${task.id})`);
    console.log(`   Cron: ${task.cronExpression}`);
    console.log(`   描述: ${CronHelper.describeCron(task.cronExpression)}`);

    try {
      const nextExecution = CronHelper.calculateNextExecution(
        task.cronExpression,
      );
      console.log(`   下次执行: ${nextExecution.toLocaleString('zh-CN')}`);

      const nextFive = CronHelper.calculateNextExecutions(
        task.cronExpression,
        3,
      );
      console.log('   接下来3次执行:');
      nextFive.nextFive.forEach((time, index) => {
        console.log(`     ${index + 1}. ${time.toLocaleString('zh-CN')}`);
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.log(`   ❌ 错误: ${errorMessage}`);
    }
  });
}

/**
 * 演示错误处理
 */
export function demonstrateErrorHandling() {
  console.log('\n=== 错误处理演示 ===\n');

  const invalidExpressions = [
    '* * * *', // 字段不足
    '* * * * * * *', // 字段过多
    '60 * * * *', // 分钟值超出范围
    '* 25 * * *', // 小时值超出范围
    'invalid expression', // 完全无效的表达式
  ];

  console.log('无效的 cron 表达式处理:');
  invalidExpressions.forEach((expression, index) => {
    console.log(`\n${index + 1}. 表达式: "${expression}"`);

    // 验证表达式
    const isValid = CronHelper.validateCronExpression(expression);
    console.log(`   验证结果: ${isValid ? '✅ 有效' : '❌ 无效'}`);

    // 尝试计算下次执行时间
    try {
      const nextExecution = CronHelper.calculateNextExecution(expression);
      console.log(`   下次执行: ${nextExecution.toLocaleString('zh-CN')}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.log(`   ❌ 计算错误: ${errorMessage}`);
    }
  });
}

// 如果直接运行此文件，执行演示
if (require.main === module) {
  demonstrateCronFeatures();
  demonstrateBusinessUsage();
  demonstrateErrorHandling();
}
