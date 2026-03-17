/**
 * Cron 功能测试
 * 验证 cron-parser 是否正常工作并返回正确的时间戳
 */

import { CronHelper } from '../system/cronHelper';

console.log('🧪 测试 Cron 功能...\n');

// 测试基本功能
const testExpressions = [
  '*/5 * * * *', // 每5分钟
  '0 9 * * 1-5', // 工作日上午9点
  '30 14 * * *', // 每天下午2:30
  '0 0 1 * *', // 每月1号凌晨
];

testExpressions.forEach((cron, index) => {
  console.log(`${index + 1}. 测试表达式: ${cron}`);

  try {
    // 验证表达式
    const isValid = CronHelper.validateCronExpression(cron);
    console.log(`   ✅ 验证结果: ${isValid ? '有效' : '无效'}`);

    if (isValid) {
      // 获取下一次执行时间
      const nextDate = CronHelper.calculateNextExecution(cron);
      console.log(`   📅 下次执行: ${nextDate.toLocaleString('zh-CN')}`);

      // 获取时间戳
      const timestamp = CronHelper.calculateNextExecutionTimestamp(cron);
      console.log(`   ⏰ 时间戳: ${timestamp}`);

      // 验证时间戳转换
      const restoredDate = new Date(timestamp);
      console.log(`   🔄 还原时间: ${restoredDate.toLocaleString('zh-CN')}`);
      console.log(
        `   ✅ 时间匹配: ${nextDate.getTime() === timestamp ? '是' : '否'}`,
      );

      // 获取多次执行时间
      const executions = CronHelper.calculateNextExecutions(cron, 3);
      console.log(`   📊 接下来3次执行:`);
      executions.nextFive.forEach((date, i) => {
        console.log(
          `      ${i + 1}. ${date.toLocaleString('zh-CN')} (${date.getTime()})`,
        );
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`   ❌ 错误: ${errorMessage}`);
  }

  console.log(); // 空行
});

// 测试无效表达式
console.log('❌ 测试无效表达式:');
const invalidExpressions = [
  '* * * *', // 字段不足
  '60 * * * *', // 分钟超出范围
  'invalid', // 完全无效
];

invalidExpressions.forEach((cron, index) => {
  console.log(`${index + 1}. ${cron}`);
  const isValid = CronHelper.validateCronExpression(cron);
  console.log(`   结果: ${isValid ? '✅ 有效' : '❌ 无效'} (应该无效)`);
});

console.log('\n🎉 测试完成！');

// 时间戳优势演示
console.log('\n📈 时间戳优势演示:');
const now = Date.now();
const nextExecution = CronHelper.calculateNextExecutionTimestamp('0 12 * * *');

console.log(`当前时间戳: ${now}`);
console.log(`下次执行时间戳: ${nextExecution}`);
console.log(`时间差(分钟): ${Math.round((nextExecution - now) / (1000 * 60))}`);
console.log(
  `时间差(小时): ${Math.round((nextExecution - now) / (1000 * 60 * 60))}`,
);

// 显示常用模板
console.log('\n📋 常用 Cron 模板:');
Object.entries(CronHelper.COMMON_PATTERNS).forEach(([name, pattern]) => {
  try {
    const next = CronHelper.calculateNextExecution(pattern);
    console.log(`${name}: ${pattern} -> ${next.toLocaleString('zh-CN')}`);
  } catch (error) {
    console.log(`${name}: ${pattern} -> ❌ 错误`);
  }
});
